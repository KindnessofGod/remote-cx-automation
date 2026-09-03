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
// WHOSE DECISION THIS API CARRIES — READ THIS BEFORE ADDING A CALLER
// (2026-08-30)
//
// Remote's own work-authorization lifecycle has THREE stages, and only the
// middle one is a decision anybody can make through an API at all. Verified
// against developer.remote.com on 2026-08-30:
//
//   1. THE EMPLOYEE SUBMITS the request.
//   2. THE CUSTOMER'S MANAGER APPROVES OR DECLINES IT. The schema calls this
//      party `employer_approver` (its example address is `user0@company.com`)
//      and carries `employer_special_instructions`, "Special instructions from
//      the employer" — so this is the CUSTOMER's own person, not a Remote one.
//      `PATCH /v1/work-authorization-requests/{id}` accepts exactly two status
//      values, `approved_by_manager` and `declined_by_manager`, in both
//      documented variants of the call.
//   3. REMOTE'S OWN MOBILITY TEAM REVIEWS the employer-approved request —
//      `approved_by_remote` / `declined_by_remote`. THERE IS NO ENDPOINT FOR
//      THIS ANYWHERE. Remote's entire work-authorization surface is four
//      endpoints: two GETs and two PATCHes, and neither PATCH accepts either
//      of those two values.
//
// `POST /api/authorizations/:id/approve|decline` therefore performs STAGE 2 —
// the customer's decision — because `submitWorkationApproval()` turns it into
// that PATCH. It is a legitimate route for a caller that is genuinely acting
// FOR THE EMPLOYER: the customer-facing work-authorization surface, or a test
// standing in for one. It is NOT a route for a Remote CX specialist working a
// Zendesk ticket, and the ZAF sidebar no longer calls it — see the by-ticket
// route below, which is the sidebar's, and which now reports the case as not
// actionable there for that reason.
//
// STAGE 3 IS NOW RECORDED HERE — `POST /api/authorizations/:id/mobility-review`,
// added 2026-08-31, and it does NOT contradict the paragraph above.
//
// This section used to say a stage-3 control "would be worse still: there is
// nothing for it to call, so it could only ever report success having changed
// nothing at Remote." The API fact is unchanged and is still why there is no
// PATCH on that path. What was wrong was the conclusion — that the only two
// options were a button that lies and no button at all. There is a third, and
// it is the one the project owner asked for: record the review HERE, durably,
// under a named person, and SAY that it went nowhere else.
//
// The failure CLAUDE.md §6 describes is a control that reports success having
// changed nothing *while its reader believes something changed*. That belief is
// what `mobilityReview.notice` removes: the same sentence appears on the panel
// before the click, in the audit row, on the employee's own status page and on
// the document the employee collects. Nothing anywhere writes
// `approved_by_remote`, and `submitMobilityReview()` has no Remote client to
// write it with.
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { evaluateAuthorizationActionability, settledFacts } from "./approvalPolicy.js";
import { submitWorkationApproval, submitMobilityReview } from "./workflow.js";
// STAGE 3 — Remote's own mobility review, recorded here and never sent to
// Remote. See ./mobilityReview.js's header; the route is below the two GETs.
import { describeMobilityReview, MOBILITY_REVIEW_NOTICE } from "./mobilityReview.js";
import { readMobilityReview } from "./mobilityReviewLog.js";
import { readEmployerApprover } from "./employerDecisionLog.js";
import { classifyRisk, describeRiskPosture } from "../shared/riskEngine.js";
import { readJsonBody } from "../shared/httpBody.js";
import { resolveApprover, resolveReader } from "../shared/approverAuth.js";
import { describeDecidingGate, describeGateLadder } from "./policyEngine.js";
import { extractWorkationFactors, NEVER_EXTRACTED_FIELDS } from "./intakeExtractor.js";
import { describeDecisionBasis, requesterParties } from "./decisionFacts.js";
import { readLinkedRequest } from "./linkedRequest.js";
import { readEmployerPresence } from "./employerPresence.js";
import { describeEmployee, readEmploymentForSubject } from "../shared/employeeSubject.js";
import { byTicketAccountRefusal } from "../shared/byTicketAccountGuard.js";

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

      // GET /api/authorizations/by-ticket/:externalRef — THE ZAF SIDEBAR'S
      // ROUTE. It is keyed by a Zendesk ticket id, which only Remote's own CX
      // staff hold: an employer looking at their own request in Remote's
      // product has an authorization id and no ticket, and reads the /:id
      // sibling below. That is what makes it safe for this route — and only
      // this route — to answer the actionability question for the surface it
      // serves rather than for the case in the abstract. See
      // sidebarActionability() and the file header.
      //
      // Must come before the generic /:id route below, since "by-ticket" would
      // otherwise be read as an authorization id.
      if (req.method === "GET" && isPath(parts, ["api", "authorizations", "by-ticket"]) && parts[3] && parts.length === 4) {
        const authorizationRow = await authorizationStore.findByExternalRef(parts[3]);
        // ACCOUNT COLLISION GUARD — a bare ticket number means nothing without the
        // account it was issued by. See src/shared/byTicketAccountGuard.js.
        const foreignAccount = byTicketAccountRefusal(authorizationRow, parts[3]);
        if (foreignAccount) return send(res, 404, foreignAccount);
        if (!authorizationRow) return send(res, 404, { found: false });
        const actionability = evaluateAuthorizationActionability({ authorizationRow });
        // STAGE 3, READ BEFORE THE ANSWER IS COMPOSED. Whether this screen is
        // open to a decision now depends on two facts neither the row nor the
        // approval policy holds: has the EMPLOYER approved, and is Remote's own
        // review already on record. The second lives in `audit_log`
        // (./mobilityReviewLog.js explains why it has no column).
        const mobilityReview = describeMobilityReview({
          authorizationRow,
          review: await readMobilityReview({ audit, authorizationId: authorizationRow.id }),
        });
        // WHO THE EMPLOYER'S APPROVER WAS, IN WORDS. Same reason as the
        // mobility review directly above, one stage earlier: the display name
        // has no column on `uc04_authorizations`, so on a pooled deployment
        // `approverName` arrives null and the panel could only say "Approved by
        // admin_jane". The name is on the append-only audit row
        // (./employerDecisionLog.js). The store's own value always wins — this
        // fills a null and never overwrites a fact the row already holds.
        if (!authorizationRow.approverName || !authorizationRow.approverTitle) {
          const approver = await readEmployerApprover({ audit, authorizationId: authorizationRow.id });
          if (approver) {
            authorizationRow.approverName = authorizationRow.approverName ?? approver.name;
            authorizationRow.approverTitle = authorizationRow.approverTitle ?? approver.title;
            authorizationRow.approverCompany = authorizationRow.approverCompany ?? approver.company;
          }
        }
        // ONE READ OF THE EMPLOYMENT, TWO CONSUMERS — the subject block and
        // dimension 4's document finding. See readEmploymentForSubject().
        const subjectRead = await readEmploymentForSubject({ remote, employmentId: authorizationRow.employmentId });
        // AND ONE READ OF THE REMOTE REQUEST THIS DECISION IS ABOUT (W-1). The
        // id is durable (`work_authorization_id`); what it SAID never was, so
        // the panel printed "no document" over a request carrying a travel
        // document number. Read live for the same reason the employee card is:
        // a snapshot cannot answer what Remote says now, and two adjacent
        // blocks with opposite freshness semantics teach a reader to trust
        // neither. Fail-soft by construction (./linkedRequest.js) — it cannot
        // throw, and nothing on this path can change a decision.
        const linkedRequest = await readLinkedRequest({
          remote,
          workAuthorizationId: authorizationRow.workAuthorizationId ?? null,
        });
        // AND THE ONE TREATY CONDITION THAT IS COMPUTABLE. Art. 15(2)(b) asks
        // whether the employer is resident in the DESTINATION; where the
        // destination is a country the customer itself has a company in, that
        // condition fails on day one and the exemption is gone regardless of
        // the day count. The panel has been printing a caveat admitting it
        // measures none of (b) or (c); this answers the reachable half.
        // See ./employerPresence.js — it never flags, never blocks, and fails
        // to UNKNOWN rather than to "no entity there".
        const employerPresence = await readEmployerPresence({
          remote,
          companyId: subjectRead.employment?.company_id ?? null,
          destinationCountry:
            authorizationRow.risk?.normalized?.destinationCountry ??
            authorizationRow.factors?.destination?.country ??
            null,
        });
        return send(res, 200, {
          found: true,
          authorization: authorizationRow,
          employee: await employeeView(authorizationRow, remote, subjectRead),
          // THE EMPLOYEE'S OWN ACCOUNT OF THE TRIP, in their words on Remote's
          // form — and an explicit state when there is no linked request rather
          // than an absent key, which a panel renders as nothing at all.
          remoteRequest: linkedRequest,
          // WHERE THE CUSTOMER HAS COMPANIES — the client's entities, never
          // Remote's. Reading one of these as "the employer" is K16.
          employerPresence,
          // WHO FILED IT, in the one shape all nine publish. See
          // src/shared/requesterSubject.js: a request is made by one party ABOUT
          // another and the identity gate is a comparison between them, so
          // "Requester: admin_jane" alone cannot be used to judge whether the
          // request is even coherent. It is the same computation `basis.requester`
          // carries (requesterParties(), one source), lifted to the top level
          // because that is where every other use case's is and a sidebar needs
          // one path, not a special case for UC-04.
          requester: requesterParties({ authorizationRow }),
          // THE WHOLE OF STAGE 3, AS DATA. The bundle renders it and composes no
          // verdict of its own — `notice` in particular is a server-side string
          // constant, so no client can paraphrase "this is not sent to Remote"
          // into something softer.
          mobilityReview,
          ...describeRiskPosture("UC-04", authorizationRow.flags ?? []),
          // LEGACY ALIAS, and the field the defect was made of. `tier` here has
          // always been the ESCALATED case risk, never the use case's tier —
          // see src/shared/riskEngine.js's header. It is kept because deployed
          // clients and existing tests read it; `caseRisk` above is the same
          // value under a name that means only that. Nothing new should read it.
          tier: classifyRisk("UC-04", authorizationRow.flags ?? []).tier,
          // NOT `actionability.allowed`, AND THAT IS THE WHOLE FIX (2026-08-30).
          // `actionable` is the one field the sidebar reads to decide whether a
          // control exists, and on this route the honest answer is always no:
          // the employer's approval is the customer's own (stage 2) and
          // Remote's own review has no endpoint at all (stage 3). See the file
          // header for the verified lifecycle, and sidebarActionability() for
          // the words a specialist actually reads.
          //
          // ONE EXCEPTION SINCE 2026-08-31, AND IT IS NOT A REVERSAL: once the
          // EMPLOYER has approved, Remote's own mobility review (stage 3) IS
          // this screen's decision, and it is recorded here rather than sent
          // anywhere. `sidebarActionability()` opens only for that, only after
          // stage 2, and says in the reviewer's own words what it does and does
          // not do.
          ...sidebarActionability(actionability, mobilityReview),
          // THE SAME SETTLED DECISION, AS FIELDS. `actionableReason` is one
          // string because a client that can only render one needs one; a
          // client that can lay out who/when/note/whether-Remote-was-updated
          // separately should not have to take them apart again. Null while the
          // authorization is still open — there is nothing settled to describe.
          settled: settledFacts(authorizationRow),
          ...describeDecision(authorizationRow, subjectRead.employment, linkedRequest),
        });
      }

      // GET /api/authorizations/:id — THE EMPLOYER-SIDE READ. Deliberately
      // NOT given the sidebar's treatment above: a caller holding an
      // authorization id is the customer-facing surface, and `actionable`
      // there is the real stage-2 question, answered by the approval policy as
      // it always has been. Flipping it here as well would leave `actionable`
      // carrying no information anywhere and would break the one surface that
      // may legitimately act.
      if (req.method === "GET" && isPath(parts, ["api", "authorizations"]) && parts[2] && parts.length === 3) {
        const authorizationRow = await authorizationStore.findById(parts[2]);
        if (!authorizationRow) return send(res, 404, { found: false });
        const actionability = evaluateAuthorizationActionability({ authorizationRow });
        // ONE READ OF THE EMPLOYMENT, TWO CONSUMERS — the subject block and
        // dimension 4's document finding. See readEmploymentForSubject().
        const subjectRead = await readEmploymentForSubject({ remote, employmentId: authorizationRow.employmentId });
        // AND ONE READ OF THE REMOTE REQUEST THIS DECISION IS ABOUT (W-1). The
        // id is durable (`work_authorization_id`); what it SAID never was, so
        // the panel printed "no document" over a request carrying a travel
        // document number. Read live for the same reason the employee card is:
        // a snapshot cannot answer what Remote says now, and two adjacent
        // blocks with opposite freshness semantics teach a reader to trust
        // neither. Fail-soft by construction (./linkedRequest.js) — it cannot
        // throw, and nothing on this path can change a decision.
        const linkedRequest = await readLinkedRequest({
          remote,
          workAuthorizationId: authorizationRow.workAuthorizationId ?? null,
        });
        // AND THE ONE TREATY CONDITION THAT IS COMPUTABLE. Art. 15(2)(b) asks
        // whether the employer is resident in the DESTINATION; where the
        // destination is a country the customer itself has a company in, that
        // condition fails on day one and the exemption is gone regardless of
        // the day count. The panel has been printing a caveat admitting it
        // measures none of (b) or (c); this answers the reachable half.
        // See ./employerPresence.js — it never flags, never blocks, and fails
        // to UNKNOWN rather than to "no entity there".
        const employerPresence = await readEmployerPresence({
          remote,
          companyId: subjectRead.employment?.company_id ?? null,
          destinationCountry:
            authorizationRow.risk?.normalized?.destinationCountry ??
            authorizationRow.factors?.destination?.country ??
            null,
        });
        return send(res, 200, {
          found: true,
          authorization: authorizationRow,
          employee: await employeeView(authorizationRow, remote, subjectRead),
          // THE EMPLOYEE'S OWN ACCOUNT OF THE TRIP, in their words on Remote's
          // form — and an explicit state when there is no linked request rather
          // than an absent key, which a panel renders as nothing at all.
          remoteRequest: linkedRequest,
          // WHERE THE CUSTOMER HAS COMPANIES — the client's entities, never
          // Remote's. Reading one of these as "the employer" is K16.
          employerPresence,
          // WHO FILED IT, in the one shape all nine publish. See
          // src/shared/requesterSubject.js: a request is made by one party ABOUT
          // another and the identity gate is a comparison between them, so
          // "Requester: admin_jane" alone cannot be used to judge whether the
          // request is even coherent. It is the same computation `basis.requester`
          // carries (requesterParties(), one source), lifted to the top level
          // because that is where every other use case's is and a sidebar needs
          // one path, not a special case for UC-04.
          requester: requesterParties({ authorizationRow }),
          // STAGE 3, READ-ONLY ON THIS ROUTE. The employer's own surface does
          // not perform Remote's mobility review and gets no control for it —
          // `actionable` below is, and stays, the stage-2 question. It is
          // PUBLISHED because the employer is entitled to see that the trip they
          // approved has (or has not) since been reviewed, and where that review
          // is recorded.
          mobilityReview: describeMobilityReview({
            authorizationRow,
            review: await readMobilityReview({ audit, authorizationId: authorizationRow.id }),
          }),
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
          ...describeDecision(authorizationRow, subjectRead.employment, linkedRequest),
        });
      }

      // ---------------------------------------------------------------------
      // POST /api/authorizations/:id/mobility-review   body: {action, approver, note}
      // ---------------------------------------------------------------------
      // STAGE 3 — REMOTE'S OWN MOBILITY REVIEW, AND THE ONE DECISION THIS
      // SCREEN MAKES. `action` is `clear` or `decline`. Read
      // ./mobilityReview.js's header before touching this; the short version:
      //
      //   · It is recorded in THIS system — a durable `audit_log` row naming
      //     the reviewer — and it is NEVER sent to Remote. `submitMobilityReview()`
      //     takes no Remote client at all, so that is a property of the call
      //     graph and not of anyone's discipline.
      //   · It is refused unless the CUSTOMER'S MANAGER has already approved
      //     (`employer_approval_not_recorded`), because stage 3 reviews what
      //     stage 2 approved and a clearance on an unapproved request would
      //     leave a record — and a document — asserting an approval that never
      //     happened.
      //   · The reviewer's identity comes from resolveApprover(), exactly as
      //     the employer route below: a signed ZAF claim where the posture
      //     requires one, never a name in the body (CLAUDE.md §3 directive 3).
      //   · Entitlement is threaded through and consulted LAST, inside the
      //     policy, where it can only ever refuse.
      //
      // IT MUST COME BEFORE THE `/:id/:action` ROUTE BELOW, which matches any
      // third segment: without this ordering `mobility-review` would be read as
      // an approval verb, fail `normalizeDecisionAction()` and answer
      // `unknown_action` — a live stage-3 clearance reported as a typo.
      //
      // `parts.length === 4` is EXACT, so no sub-path is served from here.
      if (req.method === "POST" && isPath(parts, ["api", "authorizations"]) && parts[3] === "mobility-review" && parts.length === 4) {
        const body = await readJsonBody(req);
        const identity = resolveApprover({ req, body, requireSignedIdentity, zafVerifier });
        if (!identity.ok) {
          return send(res, identity.status, { ok: false, code: identity.code, reason: identity.reason });
        }
        const result = await submitMobilityReview(
          {
            authorizationId: parts[2],
            action: typeof body.action === "string" ? body.action.trim() : body.action,
            reviewer: identity.approver,
            note: body.note ?? "",
          },
          { audit, authorizationStore, entitlement }
        );
        return send(res, result.status, result);
      }

      // POST /api/authorizations/:id/approve | /decline   body: {approver, note}
      //
      // WHO MAY LEGITIMATELY CALL THIS: a caller acting FOR THE EMPLOYER.
      // submitWorkationApproval() turns this into
      // `PATCH /v1/work-authorization-requests/{id}` with
      // `approved_by_manager` / `declined_by_manager`, which Remote defines as
      // the CUSTOMER's manager's decision (file header, verified 2026-08-30).
      // The customer-facing work-authorization surface is that caller. A Remote
      // CX specialist in Zendesk is not, and the ZAF sidebar stopped posting
      // here on 2026-08-30 — it has no `post` at all for UC-04 now.
      //
      // THE ROUTE IS KEPT RATHER THAN DELETED, on purpose. Removing it would
      // remove the only way the employer's decision can be made in this system
      // at all, which is a worse defect than the one being fixed: the customer
      // would lose the stage Remote's API actually supports, and
      // src/approvalqueue/approvalRoutes.js would be naming an endpoint that
      // does not exist. What was wrong was never the capability — it was the
      // SIDEBAR exercising it and stamping a Remote CX name on it.
      //
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

/* ---------------------------------------------------------------------------
 * WHY THE SIDEBAR IS TOLD "NO", IN THE WORDS A SPECIALIST READS
 * ---------------------------------------------------------------------------
 * A missing button and a broken button look identical, so the absence has to be
 * stated rather than left as a gap. These are the strings that state it. They
 * are composed HERE, server-side, and rendered verbatim by the sidebar — the
 * bundle composes no verdict of its own (test/zafApp.test.js pins that).
 */

/** Why no work-authorization decision is taken on Remote's own CX screen. */
export const CX_SIDEBAR_NO_DECISION =
  "No work-authorization decision is made on this screen. The employer's approval belongs to the customer: " +
  "their own manager approves or declines the trip in Remote's product, and that is the only " +
  "work-authorization decision Remote's API accepts. Remote's own mobility review comes after it — this " +
  "screen records that review, in this system, once the employer has approved — but Remote publishes " +
  "no endpoint for that stage, so it is never sent to Remote and Remote's own systems will not show it. " +
  "Until the employer has decided, what this screen is for is the prepared case above: the facts, the risk " +
  "posture and the gate ladder, ready for whoever does decide.";

/**
 * The sidebar's answer to "is this open to a decision here?"
 *
 * THE DEFAULT IS STILL NO, AND THE ONE YES IS NARROW. Called with one argument
 * — or with a stage-3 block that is not open — this is exactly what it has
 * always been: `actionable: false`, the case's own refusal first, the surface
 * sentence after it. It opens for exactly one state: the customer's manager has
 * already approved (stage 2, `employerApprovalState()`), and Remote's own
 * mobility review (stage 3) has not yet been recorded.
 *
 * WHY THAT IS NOT THE DEFECT THIS FUNCTION WAS WRITTEN TO FIX. The 2026-08-30
 * defect was the sidebar making the CUSTOMER'S decision under a Remote CX
 * agent's name — the button PATCHed `approved_by_manager`, which Remote's own
 * schema gives to `employer_approver`. That is still refused here and always
 * will be: `employerActionable` republishes the stage-2 answer under a field
 * name that draws no button, and nothing on this route can reach
 * `submitWorkationApproval()`. What opens is a different decision, made by a
 * different party, at a later stage, and written to a different place — this
 * system's own audit log, because Remote publishes no endpoint for it.
 *
 * AND THE ABSENCE OF THE REMOTE WRITE IS STILL SAID, not left as a gap. On an
 * open case `actionableReason` IS the notice (./mobilityReview.js's
 * MOBILITY_REVIEW_NOTICE), so a reviewer reads what recording it does and does
 * not do before they click, in the same field a refusal would have used.
 *
 * @param {{allowed: boolean, reason: string|null}} actionability
 * @param {{openHere?: boolean, detail?: string, notice?: string}|null} [mobilityReview]
 *   the stage-3 block from describeMobilityReview(). Omitted (or not open) keeps
 *   the original behaviour byte for byte.
 */
export function sidebarActionability(actionability, mobilityReview = null) {
  const caseReason = actionability.allowed ? null : actionability.reason;

  if (mobilityReview?.openHere) {
    return {
      actionable: true,
      actionableReason: mobilityReview.detail || mobilityReview.notice || MOBILITY_REVIEW_NOTICE,
      // THE EMPLOYER'S ANSWER IS STILL PUBLISHED AND IS STILL "no". A settled
      // row cannot be approved again, which is precisely why stage 3 is now
      // reachable — the two never both open.
      employerActionable: actionability.allowed,
      employerActionableReason: actionability.reason,
    };
  }

  return {
    actionable: false,
    actionableReason: [caseReason, CX_SIDEBAR_NO_DECISION].filter(Boolean).join(" "),
    employerActionable: actionability.allowed,
    employerActionableReason: actionability.reason,
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
function describeDecision(row, employment = null, linkedRequest = null) {
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
    // `employment` is the record this panel already read for its subject block
    // — passed so dimension 4 ("Immigration authorization on file") reports the
    // documents Remote actually holds. Until 2026-08-31 its evidence row was
    // the hard-coded string "none" on a record that had already been fetched.
    // Null is a state of its own, not an absence of documents.
    // `linkedRequest` reaches dimension 4 for the same reason `employment`
    // does: the travel document number it carries is [CONFIRMED] on Remote's
    // own request schema, was already being fetched at decision time, and was
    // thrown away. It does not clear that dimension and no branch lets it.
    basis: describeDecisionBasis({ authorizationRow: row, employment, linkedRequest }),
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
function employeeView(authorizationRow, remote, read = null) {
  return describeEmployee({
    remote,
    employmentId: authorizationRow.employmentId,
    fields: ["full_name", "job_title", "status", "contract_type", "country_code"],
    // ONE GET SERVES BOTH BLOCKS ON THIS PANEL (2026-08-31). The subject rows
    // here and dimension 4's document finding are two readings of the same
    // record; see readEmploymentForSubject()'s header for why the read was
    // split out rather than performed twice or re-derived.
    read,
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
