// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-02's expense intake + review queue
// ---------------------------------------------------------------------------
// WHY A SEPARATE SERVER
// Same reasoning as uc06/server.js: this is the automation's own intake/review
// surface, not Remote's and not Zendesk's. One POST intake route runs the real
// workflow (so the API never duplicates a gate), and GET routes let the ZAF
// Finance Ops panel read an expense back.
//
// THIS HEADER USED TO SAY "there is deliberately NO approve/deny route here",
// and `view()` below hard-set `actionable: false` with the reason "routed to a
// Finance Ops review queue outside this API". That queue did not exist —
// anywhere. UC-02.md §6 has always specified the opposite ("route to Finance
// Ops (ZAF) -> PATCH status: declined (with reason) or hold"), so a flagged
// expense was landing in `uc02_expenses` with `status: "flagged"`, rendering
// read-only in the sidebar, and no control in this system could resolve it.
// The contradiction is settled in favour of §6; see src/uc02/reviewPolicy.js's
// header for the full reasoning and for why there are three verbs rather than
// two. `actionable` is now the real verdict of a pure policy function, and the
// three POST routes below are gated by that same function.
//
// Every credential lives here / in the workflow, never in a browser bundle.
//
// ---------------------------------------------------------------------------
// AUTHENTICATION ON THE WRITE PATH — finding F-08, and why it works this way
// ---------------------------------------------------------------------------
// POST /api/expenses used to take the caller's identity straight out of the
// request body (`session: body.session ?? null`) with no authentication in
// front of it, so anyone who could reach the port could approve any expense as
// anyone — a real PATCH, real money. That is the exact inversion of prime
// directive #3 ("identity comes from an authenticated signal, never a claim").
//
// The fix REUSES the mechanism src/review/server.js already has rather than
// inventing a second one: a signed identity token in `X-ZAF-Token`, verified
// by src/review/zafAuth.js (RS256, algorithm pinned before anything else,
// fails closed on every ambiguous case). The one difference is which expense is
// read — this endpoint needs the submitter's EMPLOYMENT ID, not an agent
// email, so the injected verifier must be built with identityClaimPaths that
// resolve to it (UC02_IDENTITY_CLAIM_PATHS below is that list). The verified
// value becomes the session; `body.session` is never consulted in this mode,
// so a valid signature can never be paired with a claimed identity.
//
// The three configurations, exhaustively — the DEFAULT is the secure one:
//
//   requireSignedIdentity | allowUnauthenticatedDemo | behaviour
//   ----------------------|--------------------------|----------------------
//   true (DEFAULT)        | false (DEFAULT)          | token required and
//                         |                          | verified; body.session
//                         |                          | ignored entirely
//   false                 | false                    | every POST refused —
//                         |                          | turning the check off
//                         |                          | is NOT a way to turn
//                         |                          | authentication off
//   any                   | true (DEV ONLY)          | body.session trusted,
//                         |                          | startup banner logged,
//                         |                          | responses tagged
//                         |                          | authMode
//
// Nothing here degrades silently: the ONLY way to accept an unauthenticated
// identity claim is to name it, and naming it prints a banner on every start
// (warnIfUnauthenticatedDemo, below) and marks every response it produces.
//
// AND ON THE READ PATH TOO — this comment used to end here, saying "the GET
// routes stay open, deliberately: they are a read-only view of a local demo
// store, they change no state and hold no credential." The first half of that
// was true and the conclusion did not follow. On the public deployment those
// same routes were serving an employment id, a requester's real email address
// and a full decision record to anyone who asked, over sequential integer
// ticket ids — a read-only view of real data is still a disclosure. Reads are
// now gated by `requireSignedReads`/`readVerifier` below, which carry the
// deployment's posture flag and the ordinary agent-identity verifier. They
// default OFF, so a credential-free `npm run uc02-api` still reads exactly as
// it did.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { handleExpenseSubmission, submitExpenseReview } from "./workflow.js";
import {
  evaluateExpenseActionability,
  describeOutcome,
  ACTION_ALIASES as REVIEW_ACTION_ALIASES,
  ACTIONS as REVIEW_ACTIONS,
} from "./reviewPolicy.js";
import { describeDecidingGate, describeGateLadder, describeDecisionFacts } from "./policyEngine.js";
import { readReceiptFromTicket } from "./receiptFromTicket.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { validateAgainstSchema } from "../shared/schemaValidator.js";
import { describeEmployee } from "../shared/employeeSubject.js";
import { describeRequesterParties } from "../shared/requesterSubject.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

const SUBMISSION_SCHEMA = { required: ["expenseId", "employmentId"] };

/**
 * Expense paths tried, in order, to read the submitter's EMPLOYMENT ID out of a
 * verified token — pass these as `identityClaimPaths` to createZafVerifier()
 * (src/review/zafAuth.js) when wiring a verifier for this endpoint. Most
 * specific first; the generic `sub` is last because it is the weakest of the
 * three.
 */
export const UC02_IDENTITY_CLAIM_PATHS = ["employmentId", "employment_id", "sub"];

/**
 * @param {object} deps
 * @param {import("./expenseStore.js").ExpenseStore} deps.expenseStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {typeof handleExpenseSubmission} [deps.submit]  override for tests
 * @param {string} [deps.allowedOrigin]
 * @param {boolean} [deps.requireSignedIdentity]  DEFAULTS TO TRUE — see header
 * @param {{verify: (token: string) => object}|null} [deps.identityVerifier]
 *   required whenever requireSignedIdentity is on. Injected, never constructed
 *   in here, so tests drive it with a locally generated keypair and no network.
 * @param {boolean} [deps.allowUnauthenticatedDemo]  DEV ONLY — see the header
 * @param {boolean} [deps.requireSignedReviews]  gates the three Finance Ops
 *   review routes. Defaults to `requireSignedReads` — the deployment posture —
 *   never to a laxer value of its own.
 * @param {{verify: (token: string) => object}|null} [deps.reviewVerifier]
 *   the agent-identity verifier for those routes; defaults to `readVerifier`.
 */
export function createUc02Handler({
  expenseStore,
  audit,
  remote,
  // [E-1] the Zendesk path. All three are absent by default, and the route
  // answers 503 `receipt_reader_not_configured` rather than pretending — a
  // deployment without them behaves exactly as it did before receipts existed.
  zendesk = null,
  receiptReader = null,
  downloadAttachment = null,
  receiptTicketToken = null,
  submit = handleExpenseSubmission,
  allowedOrigin = "*",
  // DELIBERATELY NOT `requireSignedIdentity` — that name is already taken here
  // by the write gate below, it defaults to TRUE, and it is bound to a verifier
  // built with UC02_IDENTITY_CLAIM_PATHS (an employment id, not an agent
  // email). Reusing it for reads would refuse every GET on a fresh clone and
  // check the wrong claim. This pair carries the DEPLOYMENT's posture flag and
  // the ordinary agent-identity verifier, and defaults to open so
  // `npm run uc02-api` still works with no credentials.
  requireSignedReads = false,
  readVerifier = null,
  // The Finance Ops REVIEW gate (§6). Defaults to the deployment-posture pair
  // above rather than to `false`, so this use case can never end up with a
  // laxer default than UC-04/05/06/09 — those receive `requireSignedIdentity`
  // straight from readPosture(), and `requireSignedReads` is the same value
  // under the name this file was already forced to use for it.
  requireSignedReviews = requireSignedReads,
  reviewVerifier = readVerifier,
  requireSignedIdentity = true,
  identityVerifier = null,
  allowUnauthenticatedDemo = false,
}) {
  const demoMode = allowUnauthenticatedDemo === true;
  warnIfUnauthenticatedDemo(demoMode);

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
    // GET ONLY, on purpose, and here that is load-bearing rather than tidy:
    // this file's POST gate verifies a token against UC02_IDENTITY_CLAIM_PATHS
    // (an employment id), while `readVerifier` resolves an agent email. Running
    // the read gate on the POST too would reject a perfectly good submission
    // token for carrying the wrong claim.
    //
    // `healthz` above is deliberately outside this — it carries no customer
    // data and is how an operator establishes the service is alive at all.
    if (req.method === "GET") {
      const readGate = resolveReader({ req, requireSignedIdentity: requireSignedReads, zafVerifier: readVerifier });
      if (!readGate.ok) {
        return send(res, readGate.status, { ok: false, code: readGate.code, reason: readGate.reason });
      }
    }

    try {
      // POST /api/receipts/read-from-ticket — [E-1], the Zendesk path.
      //
      // WHO CALLS THIS: the UC-02 n8n graph, once, between normalising the
      // ticket and running the gates. It exists so the graph does NOT need four
      // nodes and a third copy of the extraction schema in a Code node — the
      // logic here is already tested, and n8n stays a router.
      //
      // AUTHENTICATED WITH THE WEBHOOK SECRET, deliberately reusing
      // `X-YOUR-WEBHOOK-TOKEN` rather than minting another. n8n already holds
      // that credential for all nine graphs, it is rotated by a documented
      // procedure, and a second secret would be a second thing to rotate and
      // forget. This route reads a ticket and spends a paid vision call, so it
      // must not be open.
      //
      // IT DECIDES NOTHING. It returns the transcription; gate 8b compares.
      if (req.method === "POST" && isPath(parts, ["api", "receipts", "read-from-ticket"]) && parts.length === 3) {
        if (!receiptTicketToken) {
          // Fail closed, and say which kind of "no": an unconfigured route must
          // not look like a bad token to whoever is debugging it at 2am.
          return send(res, 503, { ok: false, code: "receipt_reader_not_configured" });
        }
        const supplied = req.headers["X-YOUR-WEBHOOK-TOKEN"];
        if (!supplied || String(supplied) !== String(receiptTicketToken)) {
          return send(res, 401, { ok: false, code: "webhook_token_required" });
        }

        const body = await readJsonBody(req);
        const reading = await readReceiptFromTicket(
          { ticketId: body.ticketId },
          { zendesk, download: downloadAttachment, readReceipt: receiptReader }
        );
        return send(res, 200, {
          ok: true,
          source: reading.source,
          reason: reading.reason,
          extracted: reading.extracted,
          attachment: reading.attachment ? { fileName: reading.attachment.fileName, contentType: reading.attachment.contentType } : null,
        });
      }

      // POST /api/expenses — submit an expense for the real workflow to process.
      // body: {expenseId, employmentId, session?, receiptHash?, externalRef?, source?}
      if (req.method === "POST" && isPath(parts, ["api", "expenses"]) && parts.length === 2) {
        // AUTHENTICATE FIRST — before the body is even validated, so an
        // unauthenticated caller learns nothing about the submission schema
        // and no work is done on their behalf (F-08).
        const auth = authenticate(req, { demoMode, requireSignedIdentity, identityVerifier });
        if (!auth.ok) return send(res, 401, { ok: false, code: auth.code, reason: auth.reason });

        const body = await readJsonBody(req);
        const check = validateAgainstSchema(body, SUBMISSION_SCHEMA);
        if (!check.valid) {
          return send(res, 400, { ok: false, code: "missing_fields", missing: check.missing });
        }
        // In the authenticated mode `auth.session` is built from the VERIFIED
        // expense and body.session is discarded; only the demo mode falls back
        // to the caller's own expense, and says so in the response.
        const session = auth.session ?? (demoMode ? body.session ?? null : null);
        const result = await submit(
          {
            expenseId: body.expenseId,
            employmentId: body.employmentId,
            session,
            receiptHash: body.receiptHash ?? null,
            externalRef: body.externalRef ?? null,
            source: body.source ?? "api",
          },
          { remote, audit, expenseStore }
        );
        return send(res, 200, { ok: true, authMode: auth.authMode, ...result });
      }

      // GET /api/expenses — every processed submission, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "expenses"]) && parts.length === 2) {
        return send(res, 200, { expenses: expenseStore.list() });
      }

      // GET /api/expenses/by-ticket/:externalRef — for a future ZAF panel,
      // opened in the context of a ticket, not a store id. Must come before
      // the generic /:id route since "by-ticket" would otherwise be read as an id.
      if (req.method === "GET" && isPath(parts, ["api", "expenses", "by-ticket"]) && parts[3] && parts.length === 4) {
        const row = await expenseStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(row, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!row) return send(res, 404, { found: false });
        return send(res, 200, { ...view(row), ...(await employeeAndRequester(row, remote)) });
      }

      // GET /api/expenses/:id
      if (req.method === "GET" && isPath(parts, ["api", "expenses"]) && parts[2] && parts.length === 3) {
        const row = await expenseStore.findById(parts[2]);
        if (!row) return send(res, 404, { found: false });
        return send(res, 200, { ...view(row), ...(await employeeAndRequester(row, remote)) });
      }

      // POST /api/expenses/:id/approve | /decline | /hold
      //   body: {approver|reviewer, note}
      //
      // §6's Finance Ops decision. THREE verbs, not two — see reviewPolicy.js
      // for why `hold` exists and why it writes nothing to Remote.
      //
      // `/release` is STILL ROUTED, as the legacy spelling of `/approve`
      // (REVIEW_ACTION_ALIASES). The path segment has to be matched here or
      // the request never reaches the handler that would normalise it, and a
      // deployed ZAF bundle posting the old path would get a 404
      // `no_such_route` — a rename taking the approve button offline for
      // everyone who has not re-uploaded the app. submitExpenseReview()
      // canonicalises it, so the audit row, the stored `review_action` and the
      // response `code` all say `approve` whichever path was called.
      //
      // IDENTITY BEFORE ACTION (finding F-20), through the SAME shared
      // mechanism and the SAME posture flag as UC-04/05/06/09. Deliberately
      // `requireSignedReviews`/`reviewVerifier` and NOT this file's
      // `requireSignedIdentity`/`identityVerifier`: that pair gates the
      // SUBMITTER and is bound to UC02_IDENTITY_CLAIM_PATHS (an employment
      // id). A Finance Ops specialist is an agent, identified by the ordinary
      // agent-identity verifier, exactly as UC-04's approver is. Running the
      // submitter's gate here would reject every real reviewer for carrying
      // the wrong claim.
      //
      // The default is NOT laxer for this use case: both parameters default to
      // the deployment-posture pair (`requireSignedReads`/`readVerifier`),
      // which deps.js sets from readPosture() — durable store attached OR
      // publicly reachable => signed identity required.
      if (
        req.method === "POST" &&
        isPath(parts, ["api", "expenses"]) &&
        parts[2] &&
        parts[3] &&
        parts.length === 4 &&
        (REVIEW_ACTIONS.has(parts[3]) ||
          Object.prototype.hasOwnProperty.call(REVIEW_ACTION_ALIASES, parts[3]))
      ) {
        const body = await readJsonBody(req);
        const identity = resolveApprover({
          req,
          body,
          requireSignedIdentity: requireSignedReviews,
          zafVerifier: reviewVerifier,
        });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }

        const result = await submitExpenseReview(
          {
            storeId: parts[2],
            action: parts[3],
            // `body.reviewer` is accepted as an alias only in the unsigned
            // demo posture, where resolveApprover() reads `body.approver`;
            // in the signed posture the verified claim is the only source and
            // neither field is consulted at all.
            reviewer: identity.approver ?? body.reviewer ?? null,
            note: body.note ?? "",
          },
          { remote, audit, expenseStore }
        );
        return send(res, result.status, result);
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc02-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
      return send(res, 500, { ok: false, code: "internal_error", reason: err.message });
    }
  };
}

/**
 * Decide who is submitting, or refuse (finding F-08). Pure apart from reading
 * headers, so the whole policy is one small readable function rather than a
 * branch buried in the route.
 *
 * @returns {{ok:true, session:object|null, authMode:string}
 *          |{ok:false, code:string, reason:string}}
 */
function authenticate(req, { demoMode, requireSignedIdentity, identityVerifier }) {
  if (demoMode) {
    // The ONLY unauthenticated path, and it is opt-in, banner-logged and
    // labelled on every response it produces.
    return { ok: true, session: null, authMode: "unauthenticated_demo" };
  }

  if (!requireSignedIdentity) {
    // Turning the check off is not a way to turn authentication off — that
    // would recreate F-08 with an innocuous-looking config flag.
    return {
      ok: false,
      code: "signed_identity_required",
      reason:
        "requireSignedIdentity is false but allowUnauthenticatedDemo is not set; this endpoint refuses rather than accepting an unauthenticated identity claim.",
    };
  }

  const token = req.headers["x-zaf-token"];
  if (!token) {
    return {
      ok: false,
      code: "signed_identity_required",
      reason: "This endpoint requires a signed identity token in X-ZAF-Token, and none was supplied.",
    };
  }
  if (!identityVerifier) {
    // A verifier with nothing to verify against must refuse, never fall back
    // to trusting the body — the same rule src/review/server.js applies.
    return {
      ok: false,
      code: "signed_identity_not_configured",
      reason: "This endpoint requires a signed identity token, but no verifier is configured. See src/review/zafAuth.js.",
    };
  }

  const verdict = identityVerifier.verify(token);
  if (!verdict || !verdict.ok) {
    return { ok: false, code: verdict?.code ?? "invalid_token", reason: verdict?.reason ?? "Token verification failed." };
  }
  // The verified claim is the ONLY source of identity here. `body.session`
  // is never read in this mode.
  return {
    ok: true,
    session: { authenticatedEmploymentId: verdict.approver },
    authMode: "signed_identity",
  };
}

/**
 * Print an unmissable banner when the endpoint is started with authentication
 * disabled. Loud on purpose: a demo flag that can be left on by accident in a
 * deployment is how F-08 comes back.
 */
export function warnIfUnauthenticatedDemo(enabled) {
  if (!enabled) return;
  const line = "!".repeat(78);
  console.warn(`\n${line}`);
  console.warn("!! UC-02 API STARTED WITH AUTHENTICATION DISABLED (allowUnauthenticatedDemo)");
  console.warn("!! POST /api/expenses will TRUST the identity in the request body.");
  console.warn("!! Anyone who can reach this port can submit as anyone. LOCAL DEMO USE ONLY.");
  console.warn("!! Unset UC02_ALLOW_UNAUTHENTICATED_DEMO to require a signed X-ZAF-Token.");
  console.warn(`${line}\n`);
}

/**
 * The view of one processed submission, including whether a Finance Ops
 * specialist may act on it right now.
 *
 * `actionable` USED TO BE A HARD-CODED `false`, with the reason "routed to a
 * Finance Ops review queue outside this API". That queue existed nowhere. The
 * field is now the real verdict of evaluateExpenseActionability(), which is
 * the same pure function the POST routes below consult before permitting
 * anything — so the sidebar can never offer a control the API would refuse,
 * and can never hide one it would allow. (UC-04/UC-05/UC-06 already work this
 * way; UC-02 was the odd one out because it had no decision to gate.)
 */
/**
 * WHO THIS CLAIM IS FROM, and who filed it.
 *
 * Finance Ops is deciding whether to reimburse a person. Three facts, each
 * argued from that decision rather than added because the record carried it:
 *
 *   full_name     Who is being paid. It was `emp_active_001` until now.
 *   status        Reimbursing someone who has left is the failure this row
 *                 exists to make visible; nothing else on the view says it.
 *   country_code  UC-02's category caps ARE per-country — `listExpenseCategories()`
 *                 takes a country code and returns 36/33/32/32 different rows
 *                 for NLD/PRT/CAN/USA — so the country is what makes "over the
 *                 cap" a meaningful sentence at all.
 *
 * REJECTED: `job_title` and `start_date` (no UC-02 gate reads either, and a
 * claim's legitimacy does not turn on seniority), `contract_type` (arguable —
 * contractors usually invoice rather than claim — but no gate reads it, and a
 * field on a screen that nothing compares is how a reader comes to believe a
 * check happened). MONEY: the claimed amount, the cap, the overage and the
 * percentage are already published as `decisionFacts` — they are the SUBJECT of
 * this decision. The employee's own pay is not, and no registry field for it
 * exists (src/shared/employeeSubject.js).
 *
 * WHY `requester` REPORTS `not_recorded`, AND WHY THAT IS THE RIGHT ANSWER.
 * `expenseStore.js` says it in its own words: there is no requester column,
 * because an expense's requester is definitionally its owner — the identity
 * gate's entire job is "the submitter is the employee on the record". So there
 * is no second party to name, and the block says so rather than copying the
 * employment id into a slot the store never filled.
 */
async function employeeAndRequester(row, remote) {
  return {
    employee: await describeEmployee({
      remote,
      employmentId: row.employmentId,
      fields: ["full_name", "status", "country_code"],
    }),
    requester: describeRequesterParties({
      filerId: null,
      subjectEmploymentId: row.employmentId ?? null,
      identityVerified: !(row.flags ?? []).includes("identity_not_verified"),
      source: row.source ?? null,
      externalRef: row.externalRef ?? null,
      model: {
        notRecordedFinding:
          "UC-02 keeps no requester column, and that is deliberate rather than missing: an expense belongs to the employee who incurred it, and the identity gate's entire job is to confirm the submitter IS that employee. There is no second party to name here.",
        identityChecks: "that the submitter is the employee on the record",
        identityVerifiedFinding:
          "Verified: the submitter was matched to the employee on the record. That confirms the claim was filed by its owner — it is not evidence about who was at the keyboard.",
        identityUnverifiedFinding:
          "NOT verified. The submitter could not be matched to the employee on the record, so nothing about the expense was disclosed or decided. This is a failure to confirm, not a finding of fraud.",
      },
    }),
  };
}

function view(row) {
  const actionability = evaluateExpenseActionability({ expenseRow: row });
  return {
    found: true,
    expense: row,
    // THE USE CASE'S TIER AND THIS REQUEST'S RISK, NAMED APART. They used to
    // share the key `tier`, which is how the sidebar came to print the 🔴
    // "no execution path exists" guarantee over a working Approve button on a
    // 🟡 use case having a slightly risky day. See src/shared/riskEngine.js.
    ...describeRiskPosture("UC-02", row.flags ?? []),
    // LEGACY ALIAS for `caseRisk` — deployed clients and existing tests read
    // it. Nothing new should.
    tier: classifyRisk("UC-02", row.flags ?? []).tier,
    actionable: actionability.allowed,
    actionableReason: actionability.reason,
    // THE OUTCOME, IN REMOTE'S OWN STATUS VOCABULARY — computed here for the
    // same reason `actionable` and `decidedBy` are. Whether an expense counts as
    // approved is a judgement over three fields (`status`, `remoteResult`,
    // `reviewAction`), one of which is a legacy spelling on live rows, and two
    // of which must NOT be collapsed: a recorded human approval whose PATCH
    // never landed is not an approved expense. The sidebar prints
    // `outcome.label` and `outcome.detail` verbatim and derives nothing.
    // See describeOutcome()'s header in reviewPolicy.js.
    outcome: describeOutcome(row),
    // WHICH GATE DECIDED, computed here from the policy engine's own ordering
    // rather than in the sidebar. The ZAF panel prints the stored
    // `confidence` beside the decision, and that juxtaposition is misleading
    // whenever the run stopped before gate 13: ownership is gate 4, confidence
    // is gate 13, first failure wins. A reader must be able to tell what
    // actually decided, and the browser must not be the thing deriving it
    // ("the shell renders, the API decides").
    decidedBy: describeDecidingGate(row.reason),
    // The order the position above refers to, so a reader of this API is not
    // left to infer a fifteen-rung sequence from one number. Same reasoning as
    // the portal's copy: see describeGateLadder()'s header.
    gateLadder: describeGateLadder(row.reason),
    // WHAT THE GATE REFUSED ABOUT, and the reason this route was the emptiest
    // surface in UC-02. `decidedBy` says the expense is over its category cap;
    // `gateLadder` says how far the run got. Neither names the amount, the cap,
    // the overage or the percentage — the four figures C-27 was raised about —
    // because a stored row held none of them. It does now (`decision_evidence`),
    // so the specialist opening this the next morning sees exactly what the
    // submitter saw at the moment of the decision.
    //
    // Null for a row written before the column existed, which is the honest
    // answer: the figures were genuinely not recorded then, and inventing a
    // bundle of blanks would read like a decision made on missing data rather
    // than like a decision whose data was not kept.
    decisionFacts: describeDecisionFacts({ reason: row.reason, evidence: row.decisionEvidence ?? null }),
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
export function startUc02Server(deps, port = 4050) {
  const server = createServer(createUc02Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
