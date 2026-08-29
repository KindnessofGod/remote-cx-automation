// ---------------------------------------------------------------------------
// server.js  —  The HTTP API for UC-04's specialist-approval flow
// ---------------------------------------------------------------------------
// WHY A SEPARATE SERVER FROM src/review/server.js
// Same reasoning as src/uc06/server.js: review/server.js is shaped for ONE
// decision per case (a single approve/decline, one approver header). UC-04 is
// shaped the same way (single mobility specialist), so technically it
// WOULD fit review's API — but its domain (work authorization, not
// employment verification) and its data shape (factors, risk matrix, the
// PATCH-on-approve of a separate work-authorization record) are different
// enough that a separate small API is clearer than overloading review's
// endpoints with case-specific fields. This follows the identical shape
// (node:http, dependency-injected, every credential held here and never in a
// browser bundle) as src/uc06/server.js and src/uc08/server.js.
//
// NOT YET WIRED TO A ZAF PANEL — see docs/BUILD-LOG.md roadmap; the same
// reasoning as UC-06: the shared zaf-app/assets/main.js renders one
// approve/decline pair per case driven by a single currentUser as the
// approver. UC-04's row shape is a different dossier than UC-01/UC-06's,
// and wiring a ZAF panel to it is a real UI design question that deserves
// its own deliberate pass. This server is complete and tested on its own
// terms in the meantime — reachable via curl/Postman/a future panel.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { evaluateAuthorizationActionability, settledFacts } from "./approvalPolicy.js";
import { submitWorkationApproval } from "./workflow.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder } from "./policyEngine.js";
import { extractWorkationFactors, NEVER_EXTRACTED_FIELDS } from "./intakeExtractor.js";
import { describeDecisionBasis, requesterParties } from "./decisionFacts.js";
import { describeEmployee } from "../shared/employeeSubject.js";

/**
 * @param {object} deps
 * @param {import("./authorizationStore.js").AuthorizationStore} deps.authorizationStore
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {string} [deps.allowedOrigin]
 * @param {{check: Function}|null} [deps.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Built by the CLI / deployment from the
 *   SAME posture that decides requireSignedIdentity, and `null` here by default
 *   for the same reason zafVerifier is: a handler invents no credential source
 *   of its own. Consulted inside the approval policy, after every existing
 *   refusal, and able only to refuse.
 * @param {typeof extractWorkationFactors} [deps.extract]  the free-text reader
 *   behind POST /api/intake/extract. Defaults to the real one, so production is
 *   unaffected — and injectable BECAUSE IT HAS TO BE: without this seam a test
 *   that so much as hits that route makes a real, retried OpenAI call whenever
 *   OPENAI_API_KEY is set, which is exactly what this devcontainer's own .env
 *   does (§6, issues #32/#27). Caught here by a 913ms route test before it
 *   shipped, which is the third time this hazard has appeared in this repo.
 */
export function createUc04Handler({ authorizationStore, audit, remote, allowedOrigin = "*", requireSignedIdentity = false, zafVerifier = null, entitlement = null, extract = extractWorkationFactors }) {
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
      // GET /api/authorizations — every processed authorization, newest first.
      if (req.method === "GET" && isPath(parts, ["api", "authorizations"]) && parts.length === 2) {
        return send(res, 200, { authorizations: authorizationStore.list() });
      }

      // GET /api/authorizations/by-ticket/:externalRef — for the ZAF sidebar,
      // which is opened in the context of a Zendesk ticket, not an
      // authorization id. Must come before the generic /:id route below
      // since "by-ticket" would otherwise be read as an authorization id.
      if (req.method === "GET" && isPath(parts, ["api", "authorizations", "by-ticket"]) && parts[3] && parts.length === 4) {
        const authorizationRow = await authorizationStore.findByExternalRef(parts[3]);
        if (!authorizationRow) return send(res, 404, { found: false });
        const actionability = evaluateAuthorizationActionability({ authorizationRow });
        return send(res, 200, {
          found: true,
          authorization: authorizationRow,
          employee: await employeeView(authorizationRow, remote),
          // WHO FILED IT, in the one shape all nine publish. See
          // src/shared/requesterSubject.js: a request is made by one party ABOUT
          // another and the identity gate is a comparison between them, so
          // "Requester: admin_jane" alone cannot be used to judge whether the
          // request is even coherent. It is the same computation `basis.requester`
          // carries (requesterParties(), one source), lifted to the top level
          // because that is where every other use case's is and a sidebar needs
          // one path, not a special case for UC-04.
          requester: requesterParties({ authorizationRow }),
          ...describeRiskPosture("UC-04", authorizationRow.flags ?? []),
          // LEGACY ALIAS, and the field the defect was made of. `tier` here has
          // always been the ESCALATED case risk, never the use case's tier —
          // see src/shared/riskEngine.js's header. It is kept because deployed
          // clients and existing tests read it; `caseRisk` above is the same
          // value under a name that means only that. Nothing new should read it.
          tier: classifyRisk("UC-04", authorizationRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          // THE SAME SETTLED DECISION, AS FIELDS. `actionableReason` is one
          // string because a client that can only render one needs one; a
          // client that can lay out who/when/note/whether-Remote-was-updated
          // separately should not have to take them apart again. Null while the
          // authorization is still open — there is nothing settled to describe.
          settled: settledFacts(authorizationRow),
          ...describeDecision(authorizationRow),
        });
      }

      // GET /api/authorizations/:id
      if (req.method === "GET" && isPath(parts, ["api", "authorizations"]) && parts[2] && parts.length === 3) {
        const authorizationRow = await authorizationStore.findById(parts[2]);
        if (!authorizationRow) return send(res, 404, { found: false });
        const actionability = evaluateAuthorizationActionability({ authorizationRow });
        return send(res, 200, {
          found: true,
          authorization: authorizationRow,
          employee: await employeeView(authorizationRow, remote),
          // WHO FILED IT, in the one shape all nine publish. See
          // src/shared/requesterSubject.js: a request is made by one party ABOUT
          // another and the identity gate is a comparison between them, so
          // "Requester: admin_jane" alone cannot be used to judge whether the
          // request is even coherent. It is the same computation `basis.requester`
          // carries (requesterParties(), one source), lifted to the top level
          // because that is where every other use case's is and a sidebar needs
          // one path, not a special case for UC-04.
          requester: requesterParties({ authorizationRow }),
          ...describeRiskPosture("UC-04", authorizationRow.flags ?? []),
          // LEGACY ALIAS — see the note on the by-ticket route above.
          tier: classifyRisk("UC-04", authorizationRow.flags ?? []).tier,
          actionable: actionability.allowed,
          actionableReason: actionability.reason,
          // THE SAME SETTLED DECISION, AS FIELDS. `actionableReason` is one
          // string because a client that can only render one needs one; a
          // client that can lay out who/when/note/whether-Remote-was-updated
          // separately should not have to take them apart again. Null while the
          // authorization is still open — there is nothing settled to describe.
          settled: settledFacts(authorizationRow),
          ...describeDecision(authorizationRow),
        });
      }

      // POST /api/authorizations/:id/approve | /decline   body: {approver, note}
      //   `/deny` is STILL ROUTED as the legacy spelling — the segment is not
      //   whitelisted here, and submitWorkationApproval() canonicalises it, so
      //   the installed ZAF bundle keeps working until it is re-uploaded.
      if (req.method === "POST" && isPath(parts, ["api", "authorizations"]) && parts[2] && parts[3]) {
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

        const result = await submitWorkationApproval(
          { authorizationId: parts[2], action, approver: identity.approver, note: body.note ?? "" },
          { remote, audit, authorizationStore, entitlement }
        );
        return send(res, result.status, result);
      }

      // POST /api/intake/extract   body: {text}
      //
      // THE FRONT DOOR, AND DELIBERATELY ONLY HALF OF IT. This route READS a
      // workation request out of a person's own words and returns the
      // candidates plus everything still outstanding. It decides nothing,
      // touches no Remote record, writes no row and claims no external ref.
      //
      // WHY THERE IS NO `POST /api/intake/submit` HERE, and it is not an
      // omission. `handleWorkationTextRequest()` needs an authenticated
      // `session` whose `companyId` is compared against the employment's — that
      // is UC-04's identity gate. Over HTTP the only place a session could come
      // from is the request body, and an identity taken from the body is a
      // CLAIM, which CLAUDE.md §3 directive 3 forbids outright ("identity comes
      // from an authenticated signal, never a claim"). This API has no session
      // source of its own; the surfaces that do — the portal, which resolves a
      // persona server-side, and any future chat client — hold one already and
      // call `handleWorkationTextRequest()` in process, exactly as the portal
      // already calls `handleWorkationRequest()`. Publishing a submit route
      // that trusted a body-supplied session would hand anyone who can set a
      // JSON field the ability to file authenticated workation decisions
      // against real employments, which is the same shape as the finding that
      // closed on 2026-08-18 (every GET served unauthenticated).
      //
      // The read gate is the same one the GETs above use, for the same reason
      // and off the same flag: on a durable/public deployment this costs an LLM
      // call per request, and an unauthenticated LLM endpoint is somebody
      // else's budget.
      if (req.method === "POST" && isPath(parts, ["api", "intake", "extract"]) && parts.length === 3) {
        const gate = resolveReader({ req, requireSignedIdentity, zafVerifier });
        if (!gate.ok) {
          return send(res, gate.status, { ok: false, code: gate.code, reason: gate.reason });
        }
        const body = await readJsonBody(req);
        if (typeof body.text !== "string" || !body.text.trim()) {
          return send(res, 400, { ok: false, code: "text_required", reason: "Send the request in the requester's own words as `text`." });
        }
        const extraction = await extract({ text: body.text });
        return send(res, 200, {
          ok: true,
          ...extraction,
          // WHAT NO MESSAGE CAN EVER SUPPLY, stated on every response rather
          // than only when it happens to be missing — a caller building an
          // intake surface needs to know these four are asked for separately
          // BY DESIGN, not that this particular message failed to mention them.
          neverExtracted: NEVER_EXTRACTED_FIELDS,
          // NOTHING HAS BEEN DECIDED. No gate has run: no identity check, no
          // employment read, no sanctions check. A caller must not render this
          // as an outcome.
          decided: false,
        });
      }

      return send(res, 404, { ok: false, code: "no_such_route", path: url.pathname });
    } catch (err) {
      console.error(`[uc04-api] ${req.method} ${url.pathname} failed: ${err.stack}`);
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
 * each rung marked passed / decided / not_reached, so a specialist can see how
 * far the request got rather than only where it stopped — which for UC-04 also
 * distinguishes "a human must weigh this" from "no approval can grant this."
 *
 * Both are null/[] for a reason with no row rather than a guess — see
 * src/shared/gateLadder.js.
 */
function describeDecision(row) {
  return {
    decidedBy: describeDecidingGate(row?.reason),
    gateLadder: describeGateLadder(row?.reason),
    // WHAT THE SPECIALIST IS ACTUALLY WEIGHING, not merely which gate stopped
    // the run. The ladder answers "where did this stop and what does that
    // mean"; it cannot answer "is this trip all right", which is the question
    // an approve/decline button is asking. `basis` carries the four independent
    // dimensions UC-04.md §7 forbids collapsing into a score, each with the
    // figures behind it — and, where a figure is genuinely not held, an explicit
    // unknown naming what it would take. See src/uc04/decisionFacts.js's header
    // and docs/CORRECTIONS-LOG.md C-27 / pattern P7.
    basis: describeDecisionBasis({ authorizationRow: row }),
  };
}

/**
 * WHO THIS IS ABOUT — five facts, each argued from the decision they serve.
 *
 * The mobility specialist is deciding whether this person may work from this
 * destination for these dates. Until now the panel handed them `employmentId`,
 * a UUID, and `basis.requester` told them in so many words that the employment
 * record was "not retained" — so the four dimensions UC-04.md §7 forbids
 * collapsing were being weighed against a subject nobody could see.
 *
 *   full_name      Who. There is no version of this decision that does not
 *                  need it, and it was the field the project owner missed
 *                  first.
 *   status         `submitWorkationApproval()` re-reads the employment and
 *                  REFUSES `employment_no_longer_active` before it PATCHes.
 *                  This is that same read, shown before the click rather than
 *                  after it, so an approver cannot be surprised by their own
 *                  button.
 *   contract_type  Dimension 1 (treaty/totalization) and dimension 2 (PE
 *                  sensitivity) both land differently for an EOR employee and
 *                  a contractor. `describeRequester()` names the engagement
 *                  type as a fact it cannot read; this is where it is read.
 *   country_code   The sharpest of the five. `basis.requester.subject
 *                  .statedHomeCountry` says of itself: "It is not read from the
 *                  Remote employment record and is never compared to it, so a
 *                  wrong country here is not caught anywhere." Publishing the
 *                  record's own country beside the stated one puts that
 *                  comparison in front of the one party who can make it. It
 *                  adds NO gate — nothing here compares them; a human does.
 *   job_title      Dimension 2 is role/activity PE-sensitivity, and the request
 *                  carries a job-duty category the requester SELECTED. The
 *                  title on the record is the only independent evidence about
 *                  the role this system holds.
 *
 * REJECTED, and why. `start_date`: tenure is not one of the four dimensions and
 * nothing in `riskMatrix.js` reads it. `email`: the identity gate already
 * compared the addresses and recorded its verdict; printing both invites a
 * reader to re-adjudicate it. Compensation, hours, currency: no UC-04 gate
 * reads pay, and CLAUDE.md §3 makes money on a screen a decision rather than a
 * default — `src/shared/employeeSubject.js` has no money field for any caller
 * to ask for, and a test pins that this view publishes none.
 */
function employeeView(authorizationRow, remote) {
  return describeEmployee({
    remote,
    employmentId: authorizationRow.employmentId,
    fields: ["full_name", "job_title", "status", "contract_type", "country_code"],
  });
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
export function startUc04Server(deps, port = 4052) {
  const server = createServer(createUc04Handler(deps));
  // Bound how long a connection may sit open, so a slow/hostile client can't
  // exhaust server resources. headersTimeout < requestTimeout, per Node's
  // own constraint (headers are a prefix of the full request).
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
