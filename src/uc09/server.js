// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-09's multi-approval flow
// ---------------------------------------------------------------------------
// WHY A SEPARATE SERVER FROM src/review/server.js
// Same reasoning as adjustmentStore.js being a separate store: review/server.js
// is shaped for ONE decision per case (a single approve/deny, one approver
// header). UC-09 needs UP TO THREE independently-identified role slots, filled
// possibly days apart by different people, and the AI never executes alone.
// Rather than overload the existing endpoints with a "role" parameter that
// the review policy was never designed to carry, this is its own small API
// following the identical shape (node:http, dependency-injected, every
// credential held here and never in a browser bundle).
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { evaluateAdjustmentActionability } from "./multiApprovalPolicy.js";
import { submitAdjustmentApproval } from "./workflow.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder } from "./policyEngine.js";
import { describeAdjustment } from "./approvalView.js";
import { describeAdjustmentBasis } from "./decisionFacts.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

/**
 * @param {object} deps
 * @param {import("./adjustmentStore.js").AdjustmentStore} deps.adjustmentStore
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
export function createUc09Handler({ adjustmentStore, audit, remote, allowedOrigin = "*", requireSignedIdentity = false, zafVerifier = null, entitlement = null }) {
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
      // GET /api/adjustments — every processed adjustment, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "adjustments"]) && parts.length === 2) {
        return send(res, 200, { adjustments: adjustmentStore.list() });
      }

      // GET /api/adjustments/by-ticket/:externalRef — for the ZAF sidebar,
      // which is opened in the context of a Zendesk ticket, not an adjustment
      // id. Must come before the generic /:id route below since "by-ticket"
      // would otherwise be read as an adjustment id.
      if (req.method === "GET" && isPath(parts, ["api", "adjustments", "by-ticket"]) && parts[3] && parts.length === 4) {
        const adjustmentRow = await adjustmentStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(adjustmentRow, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!adjustmentRow) return send(res, 404, { found: false });
        const actionability = evaluateAdjustmentActionability({ adjustmentRow });
        return send(res, 200, {
          found: true,
          adjustment: adjustmentRow,
          ...(await employeeAndRequester(adjustmentRow, remote)),
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. UC-09 is
          // the reason they cannot be one field: it is 🔴-framed and it
          // deliberately HAS an execution path, behind a floor-of-2 multi-role
          // approval. A sidebar that reads "high" as "no execution path exists"
          // — which is what it did — prints the 🔴 architectural guarantee over
          // this use case's own working Approve buttons, on the money path.
          // `executionModel: "multi_role_approval"` is what it reads instead.
          // See src/shared/riskEngine.js's header.
          ...describeRiskPosture("UC-09", adjustmentRow.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests
          // read it. Nothing new should.
          tier: classifyRisk("UC-09", adjustmentRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          ...describeDecision(adjustmentRow),
          ...describeAdjustment(adjustmentRow),
        });
      }

      // GET /api/adjustments/:id
      if (req.method === "GET" && isPath(parts, ["api", "adjustments"]) && parts[2] && parts.length === 3) {
        const adjustmentRow = await adjustmentStore.findById(parts[2]);
        if (!adjustmentRow) return send(res, 404, { found: false });
        const actionability = evaluateAdjustmentActionability({ adjustmentRow });
        return send(res, 200, {
          found: true,
          adjustment: adjustmentRow,
          ...(await employeeAndRequester(adjustmentRow, remote)),
          // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. UC-09 is
          // the reason they cannot be one field: it is 🔴-framed and it
          // deliberately HAS an execution path, behind a floor-of-2 multi-role
          // approval. A sidebar that reads "high" as "no execution path exists"
          // — which is what it did — prints the 🔴 architectural guarantee over
          // this use case's own working Approve buttons, on the money path.
          // `executionModel: "multi_role_approval"` is what it reads instead.
          // See src/shared/riskEngine.js's header.
          ...describeRiskPosture("UC-09", adjustmentRow.flags ?? []),
          // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests
          // read it. Nothing new should.
          tier: classifyRisk("UC-09", adjustmentRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          ...describeDecision(adjustmentRow),
          ...describeAdjustment(adjustmentRow),
        });
      }

      // POST /api/adjustments/:id/approve | /deny   body: {role, approver, note}
      if (req.method === "POST" && isPath(parts, ["api", "adjustments"]) && parts[2] && parts[3]) {
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

        const result = await submitAdjustmentApproval(
          { adjustmentId: parts[2], role: body.role, action, approver: identity.approver, note: body.note ?? "" },
          { remote, audit, adjustmentStore, entitlement }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc09-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
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
 * each rung marked passed / decided / not_reached. That matters most here:
 * UC-09's successful outcomes are phrased "…needs dual/triple approval", which
 * reads like an objection and is not one, and the ladder makes plain that
 * every earlier gate passed.
 *
 * Both are null/[] for a reason with no row rather than a guess — see
 * src/shared/gateLadder.js.
 */
function describeDecision(row) {
  return {
    decidedBy: describeDecidingGate(row?.reason),
    gateLadder: describeGateLadder(row?.reason),
    // WHAT THE SIGNATURE TURNS ON, not just where the decision stopped. UC-09
    // shipped the ladder and no basis at all — the only 🟡/🔴 approval screen
    // in the repo in that state, and the one where a mistake is a real payment.
    // `basis` carries the seven independent dimensions (the figure and its ×100
    // scaling, the record Remote would receive, the signature floor and who is
    // outstanding, the three risk drivers separately, and whether the employment
    // has been re-read), each with its own honest state — including the fact
    // that one of the three reasons for a third signature is an UNSOURCED
    // three-country list. Rendered by the shell's renderDecisionBasis().
    // See src/uc09/decisionFacts.js and docs/CORRECTIONS-LOG.md C-27 / P7.
    basis: describeAdjustmentBasis({ adjustmentRow: row }),
  };
}

/**
 * WHO IS BEING PAID, and who asked for the payment.
 *
 * This is the money path — a real off-cycle payment behind a floor-of-two
 * multi-role approval — so it is the screen where a uuid instead of a name is
 * least defensible. Four facts:
 *
 *   full_name      Who receives the money. Nothing else on this view said it.
 *   status         Paying someone who has left, off-cycle, is the classic
 *                  error AND the classic fraud, and it is the one the rest of
 *                  this view could not show.
 *   contract_type  A contractor is not paid through payroll; an off-cycle
 *                  payroll adjustment against a contractor engagement is a
 *                  finding in itself.
 *   country_code   UC-09's own high-tax list is read against it, and it is the
 *                  jurisdiction the payment lands in.
 *
 * WHY THE EMPLOYEE'S SALARY IS NOT HERE, and this is the sharpest of the nine
 * rejections. The obvious argument for it is a plausibility check: is a 50,000
 * adjustment reasonable for someone paid 30,000? That want is real — and it is
 * a COMPARISON, which is a gate, not a display field. Publishing base pay
 * beside the adjustment amount would ask an approver to make a proportionality
 * judgement this system has never made, has no threshold for, and cannot
 * record the result of — on two figures that may be in different currencies and
 * are both ×100-scaled integers. If UC-09 ought to have a proportionality gate
 * then that is its own reviewed unit of work with its own tests, exactly as
 * CLAUDE.md §3 and the statutory-corpus discipline require. Until it exists,
 * the honest screen shows the amount being paid — which IS published, from the
 * adjustment row, as the subject of the decision — and not a second number to
 * eyeball against it.
 *
 * REJECTED for the ordinary reason: `job_title` and `start_date`; no UC-09 gate
 * reads either.
 */
async function employeeAndRequester(row, remote) {
  return {
    employee: await describeEmployee({
      remote,
      employmentId: row.employmentId,
      fields: ["full_name", "status", "contract_type", "country_code"],
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
          `Requested by ${who}, an authenticated admin acting for the company. The four-eyes floor exists precisely because this is one party asking for a payment to another: the requester can never also be the approver, and the role entitlement check runs on top of that.`,
        unauthenticatedFinding:
          "No authenticated admin. The request arrived without a session carrying an admin id and the workflow recorded the literal value 'unauthenticated', so nobody is identified as having asked for this payment.",
        onBehalfFinding: (who, about) =>
          `Requested by ${who} for a payment to employment ${about} — one party asking that another be paid, which is the shape the floor of two approvers is built around.`,
        identityChecks:
          "that the requester is authenticated and that the session's company id equals the company on this employment record",
        identityVerifiedFinding:
          "Verified: the session's company id matched the company on the employment. That is an authorisation to act for this company — it is not evidence about who the person behind the session is, which is why a second, different approver is required regardless.",
        identityUnverifiedFinding:
          "NOT verified. Either no session carried a company id, or the employment record could not be read, or the two companies differed. This is a failure to confirm, not a finding that the requester was unauthorised — and no payment can be released on it either way.",
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
export function startUc09Server(deps, port = 4055) {
  const server = createServer(createUc09Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}