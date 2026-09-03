// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-05's resignation handling
// ---------------------------------------------------------------------------
// WHY THIS IS SHAPED LIKE src/uc06/server.js
// Same node:http + dependency-injected + every-credential-held-here pattern
// as the sibling APIs (uc06, uc08, review). The only routes:
//   GET  /api/resignations/:id
//   GET  /api/resignations/by-ticket/:externalRef
//   POST /api/resignations/:id/signoff
//   POST /api/resignations/:id/decline
// No intake route — UC-05's intake is the Remote-native webhook path
// (00-FOUNDATION.md §2: "Remote-native webhook" entry for 02, 04, 05, 06,
// 09). When the Remote product surfaces one, the workflow is the entry
// point; the API here is the human-facing read/signoff surface, not the
// intake. This matches the spec's [PROPOSED] framing: UC-05's webhook
// source has not been confirmed to exist yet, the same way UC-06's
// amendment-request endpoint hasn't.
//
// NO REMOTE WRITE ROUTE — BY DESIGN
// UC-05.md §3 and the ticket both note that no Remote write endpoint for
// resignations is confirmed to exist. This server therefore has no
// PATCH/POST route that would invoke one. The sign-off action records
// HR Ops's sign-off in the store + audit log; downstream systems (not
// this one) act on the signed-off report. Adding a write route here
// would be exactly the invented-endpoint failure mode 00-FOUNDATION.md
// §9's evidence-hierarchy discipline is meant to prevent.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { evaluateResignationActionability } from "./signoffPolicy.js";
import { submitResignationApproval } from "./workflow.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder, qualifyGateLadder } from "./policyEngine.js";
import { describeSignoffBasis } from "./decisionFacts.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

/**
 * @param {object} deps
 * @param {import("./resignationStore.js").ResignationStore} deps.resignationStore
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
export function createUc05Handler({ resignationStore, audit, remote, allowedOrigin = "*", requireSignedIdentity = false, zafVerifier = null, entitlement = null }) {
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
      // GET /api/resignations — every processed resignation, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "resignations"]) && parts.length === 2) {
        return send(res, 200, { resignations: await resignationStore.list() });
      }

      // GET /api/resignations/by-ticket/:externalRef — for the ZAF sidebar,
      // opened in the context of a Zendesk ticket. Must come before the
      // generic /:id route below since "by-ticket" would otherwise be read
      // as a resignation id.
      if (req.method === "GET" && isPath(parts, ["api", "resignations", "by-ticket"]) && parts[3] && parts.length === 4) {
        const row = await resignationStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(row, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!row) return send(res, 404, { found: false });
        const actionability = evaluateResignationActionability({ resignationRow: row });
        const parties = await employeeAndRequester(row, remote);
        const employeeNow = parties.employee ?? null;
        return send(res, 200, {
          found: true,
          resignation: row,
          ...parties,
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. They used to
          // share the key `tier`, which is how the sidebar came to print the 🔴
          // "no execution path exists" guarantee over a working Approve button on a
          // 🟡 use case having a slightly risky day. See src/shared/riskEngine.js.
          ...describeRiskPosture("UC-05", row.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
          // it. Nothing new should.
          tier: classifyRisk("UC-05", row.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          ...describeDecision(row, employeeNow),
        });
      }

      // GET /api/resignations/:id
      if (req.method === "GET" && isPath(parts, ["api", "resignations"]) && parts[2] && parts.length === 3) {
        const row = await resignationStore.findById(parts[2]);
        if (!row) return send(res, 404, { found: false });
        const actionability = evaluateResignationActionability({ resignationRow: row });
        return send(res, 200, {
          found: true,
          resignation: row,
          ...(await employeeAndRequester(row, remote)),
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. They used to
          // share the key `tier`, which is how the sidebar came to print the 🔴
          // "no execution path exists" guarantee over a working Approve button on a
          // 🟡 use case having a slightly risky day. See src/shared/riskEngine.js.
          ...describeRiskPosture("UC-05", row.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
          // it. Nothing new should.
          tier: classifyRisk("UC-05", row.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          ...describeDecision(row),
        });
      }

      // POST /api/resignations/:id/signoff   body: {approver, note}
      // POST /api/resignations/:id/decline   body: {approver, note}
      //   `/deny` is STILL ROUTED as the legacy spelling — the segment is not
      //   whitelisted here, and submitResignationApproval() canonicalises it.
      if (req.method === "POST" && isPath(parts, ["api", "resignations"]) && parts[2] && parts[3]) {
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

        const result = await submitResignationApproval(
          { resignationId: parts[2], action, approver: identity.approver, note: body.note ?? "" },
          { remote, audit, resignationStore, entitlement }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc05-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * The reason slug in plain words, plus where it sits in the gate order.
 *
 * The slug itself is NOT replaced — it stays on the row, because it is the
 * exact string in `audit_log`, in the metrics exception ranking and in the n8n
 * port, and therefore the thing somebody searches by. `decidedBy` carries the
 * meaning beside it, and `gateLadder` carries the whole ordered sequence with
 * each rung marked passed / decided / not_reached, so HR Ops can see how far
 * the calculation got rather than only where it stopped.
 *
 * Both are null/[] for a reason with no row rather than a guess — see
 * src/shared/gateLadder.js.
 */
function describeDecision(row, employeeNow = null) {
  return {
    decidedBy: describeDecidingGate(row?.reason),
    // POSITION SAYS REACHED; ONLY THE ROW SAYS EVALUATED. See qualifyGateLadder().
    gateLadder: qualifyGateLadder(describeGateLadder(row?.reason), row),
    // THE DERIVATION, not just the verdict. The ladder says which gate decided;
    // it cannot say which statute produced the date, over what tenure, how many
    // days short the proposal falls, or what the payout comes to in money a
    // person can read. Signing off IS this use case's execution, so the figures
    // being signed have to travel with it. See src/uc05/decisionFacts.js and
    // docs/CORRECTIONS-LOG.md C-27 / pattern P7.
    basis: describeSignoffBasis({ resignationRow: row, employeeNow }),
  };
}

/**
 * WHOSE RESIGNATION THIS IS, and who filed it.
 *
 * HR Ops is signing off a notice period and a PTO payout. Five facts:
 *
 *   full_name      Who. The signed-off report is about a named person and the
 *                  screen showed a uuid.
 *   status         The calculation presumes an employment that is ending, not
 *                  one that has already ended.
 *   contract_type  `noticePeriodTable.js` is STATUTORY EMPLOYMENT law. For a
 *                  contractor the answer comes from the contract, and
 *                  `decisionFacts.js` already says this system "does not hold
 *                  contracts and has not read one" — so which of the two a
 *                  person is decides whether the number on the screen has a
 *                  statute behind it at all.
 *   country_code   The single input that selects the notice table.
 *   start_date     Tenure is what selects the BRACKET inside that table, and
 *                  it is the field UC-05 needs the stand-in for
 *                  (`basic_information.start_date`) because the raw Sandbox
 *                  returns undefined.
 *
 * THESE ARE THE RECORD AS IT IS NOW; `notice` on the row carries the country,
 * the tenure and the probation flag AS THEY WERE when the calculation ran.
 * Both are wanted and neither replaces the other — a signer who sees them
 * disagree has found something worth stopping for, and nothing in this system
 * compares them.
 *
 * REJECTED: `job_title` (no notice table anywhere reads a title) and pay. The
 * PTO payout figure IS money and IS this decision's subject, and it is already
 * published from the row; the employee's salary is a different number that no
 * gate here reads, and no registry field for it exists.
 */
async function employeeAndRequester(row, remote) {
  return {
    employee: await describeEmployee({
      remote,
      employmentId: row.employmentId,
      fields: ["full_name", "status", "contract_type", "country_code", "start_date"],
    }),
    requester: describeRequesterParties({
      filerId: row.requester,
      subjectEmploymentId: row.employmentId ?? null,
      identityVerified: !(row.flags ?? []).includes("identity_not_verified"),
      source: row.source ?? null,
      externalRef: row.externalRef ?? null,
      model: {
        authenticatedState: "authenticated_employee_session",
        authenticatedFinding: (who) =>
          `Filed from a session authenticated for employment ${who}. UC-05's session carries an employee's OWN employment id, so this value names an employee rather than an administrator.`,
        unauthenticatedFinding:
          "No authenticated session. The resignation arrived without one and the workflow recorded the literal value 'unauthenticated', so nobody is identified as having filed it and the identity gate refused at position 1.",
        selfFinding:
          "The session's employment id and the resignation's employment id are the same value, so this was filed by the employee it is about.",
        onBehalfFinding: (who, about) =>
          `The session was authenticated for employment ${who} but this resignation is about employment ${about}. UC-05's gate admits HR acting with the employee's consent, and this row does not record a consent artifact — so which of the two this is cannot be read back here.`,
        identityChecks:
          "that the person filing the resignation is the employee it is about, or HR acting with their consent",
        identityVerifiedFinding:
          "Verified: the filer was matched to the employee the resignation concerns (or to HR acting for them). That is an authenticated filing — it is not evidence about who was at the keyboard.",
        identityUnverifiedFinding:
          "NOT verified. We could not confirm the filer is the employee this resignation concerns, or HR acting for them, so no notice period was calculated. This is a failure to VERIFY — it is not a finding that the filing is fraudulent.",
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
export function startUc05Server(deps, port = 4053) {
  const server = createServer(createUc05Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
