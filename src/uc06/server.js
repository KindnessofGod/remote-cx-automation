// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-06's dual-approval flow
// ---------------------------------------------------------------------------
// WHY A SEPARATE SERVER FROM src/review/server.js
// Same reasoning as amendmentStore.js being a separate store: review/server.js
// is shaped for ONE decision per case (a single approve/decline, one approver
// header). UC-06 needs two independently-identified role slots, filled
// possibly days apart by different people, and neither slot alone executes
// anything. Rather than overload the existing endpoints with a "role"
// parameter that the review policy was never designed to carry, this is its
// own small API following the identical shape (node:http, dependency-injected,
// every credential held here and never in a browser bundle).
//
// NOT YET WIRED TO A ZAF PANEL — see docs/BUILD-LOG.md §3.9 / §5 item 12. The
// shared zaf-app/assets/main.js renders exactly one approve/decline pair per
// case, driven by a single `currentUser` as the approver; making it also
// handle "which of two roles is this agent acting as" is a real UI design
// question (a role selector? two panels? a query param?) that deserves its
// own deliberate pass rather than a rushed generalization of an already-
// working, tested shared shell. This server is complete and tested on its
// own terms in the meantime — reachable via curl/Postman/a future panel.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { evaluateAmendmentActionability, settledFacts } from "./dualApprovalPolicy.js";
import { handoffFor } from "../shared/escalationRouting.js";
import { submitAmendmentApproval } from "./workflow.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder } from "./policyEngine.js";
import { describeAmendmentBasis } from "./decisionFacts.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";
import { remoteFor } from "../shared/remoteWorld.js";

/**
 * @param {object} deps
 * @param {import("./amendmentStore.js").AmendmentStore} deps.amendmentStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {string} [deps.allowedOrigin]
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Built by the CLI / deployment from the
 *   SAME posture that decides requireSignedIdentity, and `null` here by default
 *   for the same reason zafVerifier is: a handler invents no credential source
 *   of its own. Consulted inside the approval policy, after every existing
 *   refusal, and able only to refuse.
 */
export function createUc06Handler({ amendmentStore, audit, remote, allowedOrigin = "*", requireSignedIdentity = false, zafVerifier = null, entitlement = null }) {
  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    cors(res, allowedOrigin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method === "GET" && parts[0] === "healthz") {
      return send(res, 200, { ok: true });
    }

    // READ GATE — the same signed identity a write requires, off the same flag.
    //
    // WHY. This route returns an employment id, the requester's real email
    // address, the decision, its reason and its flags. That was reachable with
    // no credential at all on the public deployment, over sequential integer
    // ticket ids, because the signed-identity mechanism was only ever applied
    // to POST. Authenticating the write and publishing the read protects the
    // audit log's attribution while giving away what the audit log is about.
    //
    // GET ONLY, on purpose: a POST is gated one layer down by resolveApprover(),
    // which is strictly stricter (it must also resolve an approver identity)
    // and would only be run twice for no gain.
    //
    // `healthz` above is deliberately outside this — it carries no customer
    // data and is how an operator establishes the service is alive at all.
    if (req.method === "GET") {
      const readGate = resolveReader({ req, requireSignedIdentity, zafVerifier });
      if (!readGate.ok) {
        return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
      }
    }

    try {
      // GET /api/amendments — every processed amendment, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "amendments"]) && parts.length === 2) {
        return send(res, 200, { amendments: amendmentStore.list() });
      }

      // GET /api/amendments/by-ticket/:externalRef — for the ZAF sidebar,
      // which is opened in the context of a Zendesk ticket, not an amendment
      // id. Must come before the generic /:id route below since "by-ticket"
      // would otherwise be read as an amendment id.
      if (req.method === "GET" && isPath(parts, ["api", "amendments", "by-ticket"]) && parts[3] && parts.length === 4) {
        const amendmentRow = await amendmentStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(amendmentRow, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!amendmentRow) return send(res, 404, { found: false });
        const actionability = evaluateAmendmentActionability({ amendmentRow });
        return send(res, 200, {
          found: true,
          amendment: amendmentRow,
          ...(await employeeAndRequester(amendmentRow, remote)),
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. They used to
          // share the key `tier`, which is how the sidebar came to print the 🔴
          // "no execution path exists" guarantee over a working Approve button on a
          // 🟡 use case having a slightly risky day. See src/shared/riskEngine.js.
          ...describeRiskPosture("UC-06", amendmentRow.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
          // it. Nothing new should.
          tier: classifyRisk("UC-06", amendmentRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          // THE SETTLED DECISION, AS FACTS — null while the amendment is open.
          // Its `badge` is what the sidebar puts at the top of the panel once
          // both signatures (or one decline) have landed; without it the header
          // read "Awaiting dual approval" over an executed row (2026-09-02).
          settled: settledFacts(amendmentRow),
          // WHO OWNS IT WHEN IT IS NOT OPEN HERE. On an escalation the panel
          // used to print the two approval slots as "Held by", which is the
          // wrong answer to "who owns this now"; the routing table's answer is
          // Payroll Ops, and it is read from there rather than restated.
          handoff: handoffFor({ useCase: "UC-06", decision: amendmentRow.decision ?? null }),
          ...describeDecision(amendmentRow),
        });
      }

      // GET /api/amendments/:id
      if (req.method === "GET" && isPath(parts, ["api", "amendments"]) && parts[2] && parts.length === 3) {
        const amendmentRow = await amendmentStore.findById(parts[2]);
        if (!amendmentRow) return send(res, 404, { found: false });
        const actionability = evaluateAmendmentActionability({ amendmentRow });
        return send(res, 200, {
          found: true,
          amendment: amendmentRow,
          ...(await employeeAndRequester(amendmentRow, remote)),
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. They used to
          // share the key `tier`, which is how the sidebar came to print the 🔴
          // "no execution path exists" guarantee over a working Approve button on a
          // 🟡 use case having a slightly risky day. See src/shared/riskEngine.js.
          ...describeRiskPosture("UC-06", amendmentRow.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
          // it. Nothing new should.
          tier: classifyRisk("UC-06", amendmentRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          // THE SETTLED DECISION, AS FACTS — null while the amendment is open.
          // Its `badge` is what the sidebar puts at the top of the panel once
          // both signatures (or one decline) have landed; without it the header
          // read "Awaiting dual approval" over an executed row (2026-09-02).
          settled: settledFacts(amendmentRow),
          // WHO OWNS IT WHEN IT IS NOT OPEN HERE. On an escalation the panel
          // used to print the two approval slots as "Held by", which is the
          // wrong answer to "who owns this now"; the routing table's answer is
          // Payroll Ops, and it is read from there rather than restated.
          handoff: handoffFor({ useCase: "UC-06", decision: amendmentRow.decision ?? null }),
          ...describeDecision(amendmentRow),
        });
      }

      // POST /api/amendments/:id/approve | /decline   body: {role, approver, note}
      //   `/deny` is STILL ROUTED as the legacy spelling — the segment is not
      //   whitelisted here, and submitAmendmentApproval() canonicalises it.
      if (req.method === "POST" && isPath(parts, ["api", "amendments"]) && parts[2] && parts[3]) {
        const action = parts[3];
        const body = await readJsonBody(req);

        // IDENTITY BEFORE ACTION (finding F-20). `body.approver` used to be
        // handed straight to the approval policy as the human who signed, so
        // an unauthenticated curl could name anyone — including someone with
        // the authority this gate exists to require — and the audit log
        // recorded that name as fact. resolveApprover() is the one shared
        // decision about where an identity may come from; with
        // requireSignedIdentity on it is a verified RS256 claim and nothing
        // else, and it refuses rather than degrading when misconfigured.
        const identity = resolveApprover({ req, body, requireSignedIdentity, zafVerifier });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }

        const result = await submitAmendmentApproval(
          { amendmentId: parts[2], role: body.role, action, approver: identity.approver, note: body.note ?? "" },
          { remote, audit, amendmentStore, entitlement }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc06-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * The reason slug in plain words, the whole ordered ladder, and the facts each
 * of the TWO approvers is deciding on.
 *
 * UC-06 published none of this until 2026-08-19 — its view carried the raw
 * `reason` and nothing that explained it, alone among the medium-tier three.
 * The slug is NOT replaced: it is the exact string in `audit_log`, in the
 * metrics exception ranking and in the n8n port, so it stays as the thing
 * somebody greps, with the meaning beside it.
 *
 * `basis` is the part this use case needs most and had least of. Its dual
 * control is two people answering DIFFERENT questions — the customer admin
 * about the contract change, the payroll specialist about whether payroll can
 * carry it — and a shared blob serves neither. See src/uc06/decisionFacts.js's
 * header and docs/CORRECTIONS-LOG.md C-27 / pattern P7.
 *
 * All three degrade honestly: null / [] / null rather than a guess.
 */
function describeDecision(row) {
  return {
    decidedBy: describeDecidingGate(row?.reason),
    gateLadder: describeGateLadder(row?.reason),
    basis: describeAmendmentBasis({ amendmentRow: row }),
  };
}

/**
 * WHOSE CONTRACT IS BEING AMENDED, and who asked for it.
 *
 * TWO different people read this screen — the customer admin and the payroll
 * specialist — and both are being asked to sign the same change to one named
 * person's contract. Five facts:
 *
 *   full_name      Who. Two approvers, one uuid, until now.
 *   status         The write (`PUT …/basic-information`) refuses a non-active
 *                  employment and the gate admits only `active`, so this is
 *                  what the approve button will re-check.
 *   job_title      The FROM side of the change whenever the amendment touches a
 *                  title, and context for it when it does not.
 *   contract_type  Which country form applies at all is a function of the
 *                  engagement type; a contractor amendment is not the same
 *                  document.
 *   country_code   The single input to
 *                  `/v1/countries/{code}/employment_basic_information`, which
 *                  is the schema every gate here validates against. When it is
 *                  null the gate escalates `country_schema_unavailable`, and
 *                  this row is where a reader can see why.
 *
 * MONEY IS ON THIS SCREEN AND IS NOT IN THIS BLOCK, and the distinction is the
 * point. UC-06's decision genuinely turns on salary — so the OLD and NEW values
 * are published from the amendment row, where they are the subject of the
 * change and carry their own currency and ×100 scaling. Adding a third pay
 * figure here, read from a different record on a different axis, would invite a
 * comparison nothing in the system makes.
 *
 * REJECTED: `start_date` — no UC-06 gate reads tenure.
 */
async function employeeAndRequester(row, remote) {
  // THE SAME WORLD THE ROW WAS DECIDED IN (2026-09-02). A row filed through the
  // Remote-product stand-in (`source: "remoteui"`) or the portal was decided
  // against the in-process mock; reading its employee from the gateway Sandbox
  // answered "NO SUCH EMPLOYMENT RECORD" on every one of ten live cases, in a
  // headed card two inches above "Every check passed … what is left is the
  // signature". remoteFor() is what the approve path already used for its
  // freshness re-check; the panel's read now asks the same question first.
  const remoteForRow = remoteFor(remote, row.source);
  return {
    employee: await describeEmployee({
      remote: remoteForRow,
      employmentId: row.employmentId,
      fields: ["full_name", "job_title", "status", "contract_type", "country_code"],
    }),
    requester: describeRequesterParties({
      filerId: row.requester,
      subjectEmploymentId: row.employmentId ?? null,
      identityVerified: !(row.flags ?? []).includes("identity_not_verified"),
      source: row.source ?? null,
      externalRef: row.externalRef ?? null,
      model: {
        authenticatedState: "authenticated_company_actor",
        authenticatedFinding: (who) =>
          `Requested by ${who}, an authenticated admin acting for the company — never by the employee, whose part in UC-06 is consent rather than request. The company id the session carried is not kept on this row, so which company that admin was authenticated for cannot be read back here.`,
        unauthenticatedFinding:
          "No authenticated admin. The amendment arrived without a session carrying an admin id and the workflow recorded the literal value 'unauthenticated'. On the Zendesk intake path this is EXPECTED and correct — a ticket requester is an authenticated person but not an authenticated company-admin session, which is what this gate needs.",
        onBehalfFinding: (who, about) =>
          `Requested by ${who} about employment ${about} — an administrator acting on an employee's contract, which is the only shape UC-06 has. Whether the employee has consented is a separate record, not this one.`,
        identityChecks:
          "that the requester is an authenticated admin for the company this employment belongs to",
        identityVerifiedFinding:
          "Verified: the session's company id matched the company on the employment. That is an authorisation to act for this company — it is not evidence about who the person behind the session is.",
        identityUnverifiedFinding:
          "NOT verified. Either no session carried a company id, or the employment record could not be read, or the two companies differed — and the row does not record which. This is a failure to confirm, not a finding that the requester was unauthorised.",
      },
    }),
  };
}

function cors(res, allowedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ZAF-Approver, X-ZAF-Token");
  res.setHeader("Vary", "Origin");
}

function isPath(parts, expected) {
  return expected.every((segment, i) => parts[i] === segment);
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Start the API on `port`. Returns the http.Server once listening. */
export function startUc06Server(deps, port = 4021) {
  const server = createServer(createUc06Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
