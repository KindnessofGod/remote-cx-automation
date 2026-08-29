// ---------------------------------------------------------------------------
// workflow.js  —  UC-01 orchestration (this IS the n8n workflow, in code)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// This function runs the UC-01 steps in order. Each step below corresponds to
// ONE node in the n8n version (see docs/N8N-MAPPING.md). Writing it as plain
// code first makes the logic testable and easy to understand; you then rebuild
// the same sequence visually in n8n for the portfolio.
//
// The sequence (from docs/use-cases/UC-01.md, section 5):
//   1. classify the request (LLM seam)
//   2. fetch authoritative data from Remote (via the REST client)
//   3. verify requester identity
//   4. run the deterministic policy gates
//   5. route: auto-resolve | human review | escalate
//   6. record the case (operational state) + review queue + document
//   7. audit everything (immutable history)
//
// cases/review_queue/documents (caseStore.js) vs audit_log (audit.js): the
// case row is the CURRENT state of a request (its `status` changes as a
// specialist works it) — audit_log is the immutable log of every event that
// ever happened to it. Never conflate the two: never update an audit_log row,
// never treat a cases row as history.
// ---------------------------------------------------------------------------

import { classifyRequest } from "./classifier.js";
import { verifyRequester } from "../shared/identity.js";
import { refusalReplyFor } from "./refusalCopy.js";
import { deriveRequesterType } from "./requesterType.js";

/**
 * Escape prose for the one HTML fallback below. Local and four lines rather
 * than imported: letter.js does not export its own, and reaching into that file
 * for a helper would couple the refusal path to the letter template — the one
 * module this build is explicitly forbidden to go near.
 */
function escapeHtmlText(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
import { evaluate, describeDecidingGate, describeDecisionFacts } from "./policyEngine.js";
import { formatFactsForNote } from "../shared/decisionFacts.js";
import { handoffFor } from "../shared/escalationRouting.js";
import { resolveGroupAssignment, describeAssignment } from "../shared/groupAssignment.js";
import { renderLetterHtml } from "./letter.js";
import { classifyRisk } from "../shared/riskEngine.js";
import { isUndeliverable } from "../outbox/server.js";

/** Initial `cases.status` for each policy decision — see caseStore.js. */
/**
 * How much of an out-of-scope requester's text reaches `audit_trace`.
 *
 * Named rather than inlined so the number is arguable: it is a DISCLOSURE
 * bound, not a formatting choice, and the text it bounds was written by
 * somebody who reached the wrong channel and may say anything.
 */
export const OUT_OF_SCOPE_EXCERPT_CHARS = 160;

const INITIAL_STATUS_BY_DECISION = {
  auto_resolve: "resolved",
  human_review: "pending_review",
  escalate: "escalated",
  // G-1/G-2. Both are TERMINAL and neither is a review: `blocked` is a refusal
  // the requester was given an actionable answer to, and
  // `deflected_to_self_service` is a redirect to a flow that serves them in
  // seconds. Neither creates a review_queue entry, so neither ever grows an
  // approve control — the safe path must not double as a dismiss button, and a
  // refusal nobody can override is the point rather than an oversight.
  blocked: "closed_ineligible",
  deflected_to_self_service: "closed_deflected",
  // G-3. NOT a review — nobody in HR/support owns this row (VC-06's "not a
  // refusal" cuts both ways: it is also not a queue item for a specialist).
  // The person who acts on it is the EMPLOYEE, via the consent surface (L-13),
  // reading `consent_records` directly rather than `review_queue` — which is
  // also why no `createReviewQueueEntry()` call below fires for this decision.
  awaiting_employee_consent: "awaiting_consent",
};

/**
 * Handle one employment-verification ticket end to end.
 * @param {object} ticket
 * @param {string} ticket.text            ticket body
 * @param {object|null} [ticket.session]  authenticated session ({authenticatedEmploymentId}) or null
 * @param {string} ticket.employmentId    which employee the request is ABOUT
 * @param {boolean} [ticket.hasAttachment]
 * @param {string} [ticket.requestingParty] G-3/L-12: who a THIRD PARTY says
 *   they are (the third-party door's structured field). Never read for a
 *   `self` request. Together with `purpose`, scopes the consent lookup
 *   (L-8) — see caseStore.js's `findConsentArtifact()`.
 * @param {string} [ticket.purpose]       G-3/L-12: what the third party says
 *   the disclosure is FOR.
 * @param {string} [ticket.returnAddress] G-4/F1: how to reach the third party
 *   once L-19's ageing window passes (src/thirdparty/agedNotice.js). Never
 *   read by any gate and never used to widen what the door discloses at
 *   submission time — carried straight onto the case row and nowhere else.
 * @param {string} [ticket.source]        e.g. "zendesk" (default). "third_party_door"
 *   (see src/uc01/requesterType.js's `UNAUTHENTICATED_SOURCES`) forces the
 *   third-party regime regardless of `session`.
 * @param {string} [ticket.externalRef]   the Zendesk ticket id, or a generated
 *   reference for a non-Zendesk channel. OPTIONAL for every outcome except
 *   `auto_resolve`, which REFUSES without one (STEP 5b, rca-fawf/R7-26): a
 *   letter issued against no reference can never be traced back to the request
 *   that asked for it, and cannot be claimed in the exactly-once ledger
 *   either, so a redelivery would issue a second one unopposed.
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} deps.caseStore
 * @param {import("../zendesk/restClient.js").ZendeskClient} [deps.zendesk] when supplied
 *   AND ticket.source === "zendesk" AND ticket.externalRef is set, the outcome is
 *   posted back to the real ticket (letter + resolve, or an internal note + tags).
 *   Optional — tests/demo/scenarios never pass one, so nothing here ever calls
 *   a real Zendesk API by accident.
 * @param {typeof classifyRequest} [deps.classify] override the classifier (tests/demo
 *   inject classifyRequestRuleBased so they never depend on ambient OPENAI_API_KEY)
 * @param {(html: string) => Promise<Buffer>} [deps.renderPdf] OPTIONAL. When
 *   supplied and the outcome is `auto_resolve` (a letter was rendered), also
 *   render that letter to a PDF buffer and return it as `letterPdf`. Defaults
 *   to undefined — nothing calls a real renderer unless a caller explicitly
 *   asks for one, matching the injectable-seam pattern `classify`/`zendesk`
 *   already use here. This keeps `npm test`/every existing consumer
 *   unaffected: no PDF is ever rendered, `letterPdf` is simply absent from
 *   the result, and `letterHtml` keeps being returned exactly as today. See
 *   `src/pdf/render.js`'s `renderPdfFromHtml` for the real implementation —
 *   pass that in (or a fake, in tests) to opt in.
 * @returns {Promise<{decision:string, letterHtml?:string, letterPdf?:Buffer, flags:string[], reason:string, caseId:string}>}
 */
export async function handleVerificationTicket(
  ticket,
  { remote, audit, caseStore, zendesk = null, classify = classifyRequest, renderPdf = undefined }
) {
  // STEP 1 — understand the request (the only LLM step in UC-01)
  // The audit logger is handed to the classifier so the LLM attempt itself is
  // traceable (§4 invariant 7). The trace has no parent row yet — it is bound
  // to this decision by the audit.log() in STEP 7 below.
  const classification = await classify({ text: ticket.text, hasAttachment: ticket.hasAttachment }, { audit });

  // STEP 2 — fetch authoritative data (never trust the ticket for facts)
  const employment = await remote.getEmployment(ticket.employmentId);

  // STEP 2a — G-1's SECOND Remote read (rca-bdz): is this employment currently
  // mid-offboarding? The employment record's own `status` stays `active` for
  // the whole time notice is being served, so this is the read that makes
  // that fact visible at all — see engagementEligibility.js's header. Only
  // when there is an employment to ask about: an absent record already
  // defers this whole gate (classifyEngagement's own `!employment` guard),
  // and asking Remote about offboardings for an id it just 404'd on would be
  // a wasted call answering a question nobody needs answered.
  const offboarding = employment && typeof remote.listOffboardingsForEmployment === "function"
    ? await remote.listOffboardingsForEmployment(ticket.employmentId)
    : null;

  // STEP 2b — WHO IS ASKING, decided here and not by the model (L-10, DRIFT-119).
  //
  // `requesterType` selects the whole disclosure regime, so it is derived from
  // the channel and from whether the authenticated signal matches the record.
  // The classifier's answer is kept as corroboration that may only ever tighten
  // self -> third_party. See requesterType.js's header for why the asymmetry is
  // the control.
  const requesterIdentity = deriveRequesterType({
    session: ticket.session ?? null,
    employment,
    source: ticket.source ?? null,
    classifierRequesterType: classification.requesterType,
  });

  // STEP 2c — L-8: THE CONSENT ARTIFACT LOOKUP, replacing the retired
  // `ticket.consentOnRecord` boolean everywhere it used to be consulted.
  //
  // Only third-party requests ever need this — `findConsentArtifact()` scopes
  // by employment id, requesting party AND purpose (VC-30: a standing "yes to
  // anyone, forever" cannot be represented), so a self-request never looks
  // one up and `consentRecord` stays null for it. Degrades safely exactly like
  // `claimExternalRef()` above it: an unconfigured/legacy store without this
  // method behaves as "no record found", which is the safe (pending) default.
  const consentRecord =
    requesterIdentity.requesterType === "third_party" && typeof caseStore.findConsentArtifact === "function"
      ? await caseStore.findConsentArtifact({
          employmentId: ticket.employmentId,
          requestingParty: ticket.requestingParty ?? null,
          purpose: ticket.purpose ?? null,
          // PER-ENQUIRY. Without this the gate accepted a consent granted for
          // an EARLIER enquiry from the same party for the same purpose, so a
          // second request was decided against a permission the employee gave
          // once and was never asked about again. This enquiry's own reference
          // is the scope; the same enquiry re-decided (the consent-grant
          // advance, the door's reopen) carries it unchanged and still matches.
          enquiryReference: ticket.doorReference ?? ticket.externalRef ?? null,
        })
      : null;

  // STEP 3 — verify identity from the authenticated signal (never a claim)
  const identity = verifyRequester({
    session: ticket.session ?? null,
    employment,
    requesterType: requesterIdentity.requesterType,
    consentRecord,
  });

  // STEP 4 — deterministic decision
  // `session` reaches the gates because G-2 needs it: the deflection may only
  // fire on a POSITIVE signal that this requester can reach Remote's own
  // self-service flow, and an authenticated Remote session is the only such
  // signal UC-01 holds. See gate 8 in policyEngine.js.
  const outcome = evaluate({
    employment,
    // The classification the gates see carries the DERIVED requesterType, so no
    // gate can read the model's opinion by accident. The model's own answer is
    // not discarded — it travels as `classifierRequesterType` and reaches the
    // audit row, so a disagreement is readable after the fact rather than lost.
    classification: { ...classification, requesterType: requesterIdentity.requesterType, classifierRequesterType: requesterIdentity.classifierOpinion },
    identity,
    session: ticket.session ?? null,
    offboarding,
  });

  // (risk tier is derived from the flags; useful for logging/routing)
  const risk = classifyRisk("UC-01", outcome.flags);

  // WHAT THE REVIEWER NEEDS, computed once here from the same inputs the gates
  // compared, and carried to every surface that reports this decision.
  //
  // UC-01 is 🟢: it auto-resolves the clean cases, so the ONLY part of it a
  // human ever sees is an exception — and until now that human received
  // `AI summary — decision: human_review (over_scope_request). Flags:
  // over_scope_disclosure_requested.` That sentence is true, it is the C-27
  // shape exactly, and it made the specialist go and reconstruct from the
  // ticket the very facts this function had just finished comparing.
  //
  // `decidedBy` is derivable from the reason alone, so a renderer holding only a
  // stored row can recompute it; it is included on the result anyway because the
  // Zendesk note is built here and there is nowhere else for it to come from.
  // `decisionFacts` is null on the auto path — nothing was refused, so there are
  // no figures behind a refusal.
  const decidedBy = describeDecidingGate(outcome.reason);
  const decisionFacts = describeDecisionFacts({
    reason: outcome.reason,
    employment,
    // `requestingParty`/`purpose` come from the TICKET, not the classifier —
    // the third-party door (L-12) is a structured form, not free text for a
    // model to read. Folded into the `classification` object only for this
    // display call, never into what the gates above compared (they never see
    // them): describeDecisionFacts() is the one reader for whom a third
    // party's name and purpose are safe to show (see its own `case
    // "awaiting_employee_consent"` comment) and it takes only one bundle of
    // fields to read from.
    classification: { ...classification, requestingParty: ticket.requestingParty ?? null, purpose: ticket.purpose ?? null },
    identity,
  });

  // THE ANSWER THE REQUESTER READS, for the outcomes that have one.
  //
  // Null for every outcome a specialist answers by hand — `human_review` and
  // `escalate` are answered by a person writing to the person, and a template
  // there would be worse than silence. A caller must read null as "a human
  // answers this", never as "send nothing". See refusalCopy.js's header.
  const requesterReply = refusalReplyFor(outcome.reason);

  // THE ACTOR ON EVERY AUDIT ROW. It used to read `authenticatedEmploymentId`
  // alone, which is null on every Zendesk-sourced request — so the live path's
  // rows recorded "unauthenticated" for requesters Zendesk had authenticated
  // perfectly well. That is the SAME defect commit 761cd79 fixed in UC-02's and
  // UC-03's audit nodes, reintroduced here by omission rather than by copying:
  // the field was right when the only session shape was a Remote one, and never
  // revisited when the n8n path started emitting an email. Falls back in
  // strength order and says which signal answered by its shape.
  const requester =
    ticket.session?.authenticatedEmploymentId ??
    ticket.session?.authenticatedEmail ??
    "unauthenticated";

  // PROVENANCE — carried on EVERY audit row this function writes.
  //
  // `externalRef` is the reference the requester was actually shown, and
  // `src/auditview/readStore.js` looks a decision up by `details->>'externalRef'`
  // BY NAME. A row without it is a decision no human can find from the one id
  // they hold — which is exactly how a portal submission whose Zendesk hand-off
  // failed became invisible: the decision row existed and could not be reached.
  // `source` answers "which surface produced this", the question the audit
  // trail could not answer at all.
  //
  // Both stay null when the caller genuinely supplied none (a demo run, a
  // direct call). Defaulting either would be worse than leaving it empty: a
  // fabricated reference makes the viewer's lookup return a trail that is not
  // the requester's. Note `ticket.source` is NOT defaulted to "zendesk" here
  // even though the case row does — the Zendesk write below already treats an
  // absent source as "not Zendesk", and a provenance field must record what
  // happened rather than what usually happens.
  const externalRef = ticket.externalRef ?? null;
  const source = ticket.source ?? null;

  // STEP 5b — AN UNREFERENCED auto_resolve IS REFUSED, NOT RECORDED
  // (rca-fawf / R7-26; ruling recorded in qa/HUMAN-DECISIONS-REQUIRED.md §K3).
  //
  // Round 7 found three `auto_resolve` rows carrying `externalRef: null` — no
  // ticket, no portal reference, nothing tying the letter to a request anybody
  // made. "Which request produced this letter?" had no answer, and the row was
  // the only place the answer could have lived.
  //
  // THE OWNER RULED THAT SUCH A DECISION IS NOT LEGITIMATE, and declined the
  // cheaper branch (let it stand, attribute it with `source` + `caseId`).
  // Attribution says what KIND of surface produced a decision; only a
  // reference names WHICH REQUEST, and a letter that states someone's
  // employment to a bank is exactly the artifact that has to be traceable back
  // to the person who asked for it.
  //
  // REFUSING IS ALSO THE ONLY BRANCH THAT CLOSES THE SECOND CONSEQUENCE, and
  // that one is a live duplicate risk rather than a bookkeeping complaint. The
  // idempotency claim immediately below runs only `&& ticket.externalRef` —
  // there is nothing to key a claim on without a reference — so an
  // unreferenced decision skipped the exactly-once ledger ENTIRELY and a
  // redelivery would have issued a second letter with nothing in its way.
  // That is the defect real ticket #5 already caused once (two `audit_log`
  // rows 30µs apart plus a duplicate public letter). A refusal writes nothing,
  // sends nothing, and claims nothing, so it is idempotent by construction:
  // redeliver it a thousand times and the outcome is a thousand identical
  // refusals.
  //
  // NARROW ON PURPOSE — `auto_resolve` only. Every other decision either hands
  // the request to a named human who is holding the request itself, or refuses
  // it outright; `auto_resolve` is the one outcome where this function acts on
  // the requester's behalf, unsupervised and irreversibly, and it is the only
  // outcome the ruling covers. Widening this to every unreferenced request
  // would refuse work no one has ruled on.
  //
  // Shaped exactly like the `out_of_scope` refusal below it: ONE standalone
  // `audit_trace` row and nothing else. Not an `audit_log` decision row —
  // writing one would be doing the very thing this guard refuses to do (a
  // decision row nothing can be traced to). `logStandaloneTraceStep` and not
  // `logTraceStep` for the same reason it gives there: no `audit_log` parent
  // exists on this path, and a parentless entry from the ordinary method waits
  // forever to be adopted (DRIFT-121). Awaited, because the trace is the ONLY
  // record that this request was ever seen.
  if (outcome.decision === "auto_resolve" && !externalRef) {
    await audit.logStandaloneTraceStep({
      call: "uc01.unreferenced_auto_resolve",
      // `ok: false` — this is a refused request, not a served one. The
      // out-of-scope trace records `ok: true` because reaching the wrong
      // channel is a normal event that the gate handled correctly; arriving
      // with no reference at all is a caller defect, and the rate of it is
      // something somebody should be able to see going up.
      ok: false,
      details: {
        externalRef: null,
        source,
        employmentId: ticket.employmentId ?? null,
        // What WOULD have happened, so the row says what was withheld rather
        // than only that something was. `flags` is empty on this path by
        // definition (any flag would have moved the decision off auto_resolve),
        // and is carried anyway so the shape matches every other trace row.
        withheldDecision: outcome.decision,
        withheldReason: outcome.reason,
        reason: "unreferenced_request",
        flags: outcome.flags,
      },
    });

    return {
      // A decision string of its own, not a reused one. `blocked` is G-1's
      // engagement refusal and `out_of_scope` is the classifier's — both are
      // statements ABOUT THE REQUEST, and this is a statement about the
      // DELIVERY, so folding it into either would make two different failures
      // report the same cause and corrupt the rate of both.
      decision: "refused",
      reason: "unreferenced_request",
      flags: [...outcome.flags, "unreferenced_request"],
      // No case row was created and none should have been — so `caseId` is
      // null for the same reason `out_of_scope` returns null, and for once
      // that absence is the whole point rather than missing data.
      caseId: null,
      classification,
      identity,
      reply:
        "This request could not be processed because it arrived without a reference. " +
        "Please re-submit it through a channel that issues one, so the answer can be traced back to the request.",
    };
  }

  // STEP 6 (pre) — IDEMPOTENCY CLAIM (finding F-24; parity with the n8n graph
  // fixed by rca-qdc/93884e7, owner-ratified in rca-jsv — see DRIFT-003's
  // final entry in qa/SPEC-DRIFT-INDEX.md).
  //
  // This is not defensive programming for a hypothetical. Real Zendesk ticket
  // #5 received three near-simultaneous trigger invocations and produced two
  // audit_log rows 30 MICROSECONDS apart plus a duplicate verification letter
  // posted publicly to the customer. Zendesk retries webhook deliveries, and a
  // trigger can fire more than once on rapid ticket updates, so duplicate
  // delivery is a normal event to design for rather than an anomaly.
  //
  // The claim now runs BEFORE the out_of_scope branch as well as before the
  // case row, the audit row and any Zendesk action — everything after this
  // point is either a record of a decision or a customer-facing act (the
  // out_of_scope reply included), and all of it must happen exactly once.
  // Before this, out_of_scope returned above (old STEP 5) with no claim at
  // all, so a redelivered out-of-scope ticket re-ran the whole gate chain and
  // wrote a second `audit_trace` row every time — the same unbounded-reply
  // shape F-3 found on the n8n path, just with a trace row standing in for
  // the duplicate customer reply. `claimExternalRef` is backed by a primary
  // key in Postgres (workflow_claims, keyed by use case + ref), so two
  // concurrent callers cannot both win: the database, not application code,
  // is what makes this atomic. The same ledger backs the n8n graph's own
  // claim node, so the two execution paths cannot duplicate each other's work
  // either.
  //
  // Degrades safely: an unconfigured store (tests, offline demos) returns
  // `claimed: true` and behaves exactly as before, so this adds no new
  // dependency to the hermetic suite.
  if (typeof caseStore.claimExternalRef === "function" && ticket.externalRef) {
    const claim = await caseStore.claimExternalRef(ticket.externalRef, outcome.decision, "UC-01");
    if (!claim.claimed) {
      // Someone else is already handling this ticket (out_of_scope included —
      // `existingCaseId` is simply null there, since out_of_scope creates no
      // case row). Return their decision rather than an error: the caller
      // asked "what happened to this ticket", and the honest answer is the
      // decision that was already made.
      return {
        decision: outcome.decision,
        reason: outcome.reason,
        flags: outcome.flags,
        classification,
        identity,
        decidedBy,
        decisionFacts,
        caseId: claim.existingCaseId ?? null,
        duplicate: true,
        duplicateOf: ticket.externalRef,
      };
    }
  }

  // STEP 6 (out_of_scope) — refused after the claim, before any case/audit
  // row (moved from the old STEP 5, which sat ahead of the claim above — see
  // the parity note on the claim block itself).
  if (outcome.decision === "out_of_scope") {
    // ONE TRACE ROW, AND NOTHING ELSE (L-18, VC-31; owner answer D3, "ensure
    // that there are traces of everything").
    //
    // §5d's "create no case" is right and "write no audit" was reading the
    // first as implying the second. They are different tables and different
    // claims: a `cases` row says SOMEBODY OWNS THIS, which is false here and
    // would put an unworkable item in a queue; an `audit_trace` row says THIS
    // HAPPENED, which is true and is the only way the out-of-scope RATE is
    // computable at all. Before this, "the gate ran and correctly wrote
    // nothing" and "the gate never ran" produced identical evidence — which is
    // the shape DRIFT-003 is about.
    //
    // `logStandaloneTraceStep` and not `logTraceStep`: this path writes no
    // `audit_log` row, and a parentless entry from the ordinary method waits
    // forever for one to adopt it (DRIFT-121). Awaited, because on this path
    // the trace is the ONLY record the request was ever seen.
    //
    // THE EXCERPT IS BOUNDED ON PURPOSE. *Trace everything* and *disclose
    // nothing you were not asked to* are both true and the second is the one
    // that fails quietly: this text is from somebody who wrote to the wrong
    // channel, and may be about anything at all. 160 characters is enough to
    // tell a reader what KIND of request keeps arriving here — which is the
    // question the rate exists to answer — and not enough to make this table a
    // copy of the ticket body.
    const excerpt = String(ticket.text ?? "").slice(0, OUT_OF_SCOPE_EXCERPT_CHARS);
    await audit.logStandaloneTraceStep({
      call: "uc01.out_of_scope",
      ok: true,
      details: {
        externalRef: ticket.externalRef ?? null,
        source: ticket.source ?? null,
        confidence: classification.confidence ?? null,
        classificationSource: classification.source ?? null,
        intent: classification.intent ?? null,
        excerpt,
        excerptTruncated: String(ticket.text ?? "").length > OUT_OF_SCOPE_EXCERPT_CHARS,
      },
    });

    return {
      decision: "out_of_scope",
      reply: "I'm sorry, I only handle employment verification requests. If you need a standard employment verification letter, please let me know.",
      flags: outcome.flags,
      reason: outcome.reason,
      caseId: null,
      classification,
      // `decidedBy` and not `decisionFacts`: the ladder rung says plainly that
      // nothing was recorded and no queue holds this, which is the one thing a
      // reader of an out-of-scope refusal needs and would otherwise have to
      // infer from an absence (P9 — an absence is not a statement). There are no
      // figures behind it, so `describeDecisionFacts` returns null and this
      // result does not carry an empty bundle that would read like missing data.
      decidedBy,
    };
  }

  // STEP 6a — record the case: the current-state row a specialist/ZAF sidebar
  // would actually query (never the immutable audit_log for that).
  const caseRow = caseStore.createCase({
    useCase: "UC-01",
    source: ticket.source ?? "zendesk",
    externalRef: ticket.externalRef ?? null,
    employmentId: ticket.employmentId,
    requester,
    // E4-F17 (rca-0nm) — `requestingParty`/`purpose` were already folded into
    // an AD HOC copy of `classification` for describeDecisionFacts() above
    // (STEP 4's comment explains why they come from the TICKET, never the
    // classifier), but that copy was never the one persisted here — so
    // review/service.js's approve path, reading the PERSISTED classification
    // back off the case row to decide whose request the letter states, always
    // found `requestingParty` absent and rendered "issued upon the employee's
    // request" even when a bank or landlord had asked. Persisting the same
    // two fields here, not a new column, is the whole fix: `classification`
    // is already JSONB, and every other reader of this object (the ZAF panel,
    // the metrics layer) only ever reads keys it already expects.
    //
    // rca-9pzo (R7-39): `identity` is folded in the same way, for the same
    // reason. The audit_log row this function writes at STEP 7 already
    // carries `identity.verified`/`identity.reason` (the structured outcome
    // of `verifyRequester()`, STEP 3 above) — but a case that reaches
    // human_review/escalate is decided a second time, later, by a specialist
    // in review/service.js, and that decision's own audit row had nothing to
    // read the original identity check from except the reviewer's own
    // free-text note ("Requester verified as the employee named on the
    // record…") — an assertion no field could contradict if it were wrong.
    // Persisting `identity` here is what lets review/service.js record, on
    // the human-decision row, the SAME structured block the automation
    // computed and the approver acted on — not a second, independent guess.
    classification: {
      ...classification,
      requestingParty: ticket.requestingParty ?? null,
      purpose: ticket.purpose ?? null,
      identity,
      // THE REFERENCE THE ENQUIRER WAS ACTUALLY SHOWN, kept where the relink
      // cannot reach it. `caseStore.linkTicket()` (STEP 8's third-party
      // branch) OVERWRITES `external_ref` with the Zendesk ticket id the
      // moment a specialist can act on the case — correct, because that is
      // the record's reference from then on, and it is what the ZAF sidebar
      // looks a case up by. But it is not what the third party holds: they
      // hold the UUID the door minted and printed on their acknowledgement,
      // and after the relink nothing in `cases` carried it any more. It
      // survived only in two audit rows, which is a poor thing to make a
      // lookup depend on. Stored here rather than in a new column because
      // `classification` is already JSONB and every reader of it takes only
      // the keys it expects. Third-party door only; null everywhere else.
      // `doorReference` is passed SEPARATELY on a re-decide. When a granted
      // consent reopens an enquiry the workflow needs a fresh `externalRef` —
      // the original is already claimed by the first run, and claimExternalRef()
      // would (correctly) refuse the second as a duplicate delivery, which is
      // how the reopen silently wrote nothing the first time it was tried. The
      // enquirer's own reference is unchanged and travels here instead.
      ...(ticket.source === "third_party_door" && (ticket.doorReference ?? ticket.externalRef)
        ? {
            doorReference: String(ticket.doorReference ?? ticket.externalRef),
            // THE ENQUIRER'S OWN CLAIMS, persisted as claims. They were read
            // straight off `ticket` by the hand-off note (STEP 8) and stored
            // nowhere, which was fine while the note was written by the same
            // call that received them. It stopped being fine when a granted
            // consent began re-deciding the case later, from the record alone:
            // the second run had no `subjectName` and the specialist's note
            // said "not recorded" about a name the enquirer had actually given.
            // Named `claimed*` because that is what they are — an
            // unauthenticated stranger's assertion, never a record match.
            claimedSubjectName: ticket.subjectName ?? null,
            claimedSubjectDateOfBirth: ticket.subjectDateOfBirth ?? null,
            claimedStartDate: ticket.subjectClaimedStartDate ?? null,
          }
        : {}),
    },
    ticketText: ticket.text ?? null,
    decision: outcome.decision,
    reason: outcome.reason,
    flags: outcome.flags,
    status: INITIAL_STATUS_BY_DECISION[outcome.decision],
    // G-4/F1: recorded for EVERY third-party-door case regardless of outcome
    // (pending, refused, or about nobody Remote has a record of) — not only
    // the awaiting_employee_consent branch — because the later aged-notice
    // sweep (src/thirdparty/agedNotice.js) must treat all three the same way
    // (VC-32 Amendment 2) and can only do that if all three carry the same
    // field. Null on every non-third-party-door ticket.
    returnAddress: ticket.returnAddress ?? null,
  });

  // STEP 6b — human_review/escalate outcomes need a specialist queue entry
  if (outcome.decision === "human_review" || outcome.decision === "escalate") {
    caseStore.createReviewQueueEntry({ caseId: caseRow.id });
  }

  // STEP 6c — G-3/L-9: THE PENDING CONSENT ROW, CREATED ONLY NOW.
  //
  // "consent_records.case_id is NOT NULL, FK to cases.id — THE CASE MUST
  // EXIST FIRST" (this bead's own dispatch note). STEP 2c's lookup ran
  // BEFORE any case existed, because a decision has to be made before
  // anything is durably recorded; this creates the row the NEXT ask (or the
  // employee's own read, L-13) will find.
  //
  // Only when: (1) this decision genuinely is the pending one, (2) no row was
  // already found (a second ask for the exact same party+purpose finds and
  // reuses the existing pending row rather than piling up duplicates — the
  // same "one artifact per scoped question" rule `findConsentArtifact()`
  // enforces on the read side), and (3) the third party actually supplied a
  // requesting party AND a purpose — without both, nothing scoped could ever
  // be looked up again, so recording an unscoped row would create an artifact
  // nobody could ever find or grant against.
  if (
    outcome.decision === "awaiting_employee_consent" &&
    !consentRecord &&
    ticket.requestingParty &&
    ticket.purpose &&
    typeof caseStore.createConsentRecord === "function"
  ) {
    caseStore.createConsentRecord({
      caseId: caseRow.id,
      consentType: "third_party_verification",
      status: "pending",
      source: ticket.source ?? null,
      requestingParty: ticket.requestingParty,
      purpose: ticket.purpose,
    });
  }

  // STEP 7a — render the letter and persist it as a documents row BEFORE the
  // decision is audited. rca-5vdx / GROUND 1: `letterIssued: true` used to be
  // a bare belief derived from `outcome.decision === "auto_resolve"` — true
  // on the audit row even on a run where rendering below then failed, and
  // uncorroborated by anything even when it succeeded. A Live Feed row is now
  // required to prove what it claims: `letterIssued` is set from
  // `Boolean(letterDocument)`, and whenever it is true the SAME row carries
  // `letterDocumentId` + `letterContentHash` naming the exact `documents` row
  // (mirrors UC-03's `letterDocument`/`letterContentHash`, `uc03/
  // workflow.js`'s STEP 6c/7 — same shape, not a second spelling of it).
  //
  // The render failure is CAUGHT, not thrown, here — the decision still has
  // to reach the record below even when this fails, which is the invariant
  // this step used to run downstream of the audit write to protect. Nothing
  // is lost: `letterRenderError` is carried to STEP 7 below, which writes the
  // decision row first (correctly reporting no letter), then re-raises the
  // failure as its own durable `letter_render_failed` row, exactly the
  // ["auto_resolve", "letter_render_failed"] order this file already commits
  // to.
  let letterHtml;
  let letterPdf;
  let letterDocument = null;
  let letterRenderError = null;
  if (outcome.decision === "auto_resolve") {
    try {
      const legalEntity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);
      // rca-tlb2 (R7-20): the letter must carry the same reference the
      // requester was shown, so it can be quoted by anyone the requester
      // forwards it to.
      letterHtml = renderLetterHtml(employment, legalEntity, { reference: externalRef });
      // Optional PDF rendering (see the `renderPdf` JSDoc above): only runs
      // when a caller explicitly supplied a renderer. Nothing here calls a
      // real browser by default, so every existing caller/test is unaffected.
      if (renderPdf) {
        letterPdf = await renderPdf(letterHtml);
      }
      // STEP 7b — a rendered letter is a generated document tied to the case.
      // Kept, not discarded: `createDocument()`'s id + sha256 are what STEP 7
      // below attaches to the decision row, so `letterIssued: true` is never
      // written without a real artifact behind it.
      letterDocument = caseStore.createDocument({ caseId: caseRow.id, type: "employment_verification_letter", content: letterHtml });
    } catch (err) {
      letterRenderError = err;
    }
  }

  // STEP 7 — audit the decision, DURABLY, before anything customer-facing.
  //
  // WHY logDurable() AND WHY HERE. This used to be a fire-and-forget
  // audit.log(), whose Supabase write happens in the background and whose
  // failure is swallowed — while the very next step posted the letter publicly
  // and solved the ticket. With a failing audit backend the customer got a
  // letter and the ticket was closed with no record that any decision had ever
  // been made. That is the exact inversion of the ordering this project
  // documents as its own lesson and that UC-02 already follows: the log has to
  // be DURABLE before the irreversible action, so a failure here refuses the
  // action instead of orphaning it. An await that rejects propagates — no
  // letter is posted, no ticket is solved, and the case row above is still
  // there for a specialist to work by hand.
  //
  // rca-nr4i / D-19, and rca-5vdx after it: read as "issued" this row is
  // still written before Zendesk (STEP 8, further below) — that ordering is
  // unchanged (invariant 4: durable before irreversible) — but it is no
  // longer a belief about the DECISION. `letterHtml`/`letterDocument` above
  // are already resolved (rendered and persisted, or failed) by the time this
  // write happens, so `letterIssued` here reports what actually exists, not
  // what the decision predicts. A delivery failure downstream of this row
  // (the Zendesk post itself) is still a separate concern the row cannot see
  // — that either throws (surfacing as an n8n `ops_alerts` row under this
  // SAME `externalRef`, joinable in /audit's bug-audit view) or this whole
  // function's caller sees the rejection directly. `selfServiceLetter.js`'s
  // OWN row is not this same shape — there, the letter HTML rides in the
  // SAME synchronous response as the decision. See that file's own comment.
  await audit.logDurable({
    useCase: "UC-01",
    action: outcome.decision,
    actor: requester,
    riskTier: risk.tier,
    details: {
      caseId: caseRow.id,
      externalRef,
      source,
      employmentId: ticket.employmentId,
      classification,
      identity,
      // VC-29's audit line: the DETERMINISTIC source of `requesterType`, kept
      // distinct from the classifier's opinion, so a later disagreement between
      // the two is readable rather than lost. A silent override teaches nobody
      // anything, and a model that is systematically wrong about who is asking
      // is a fact worth having.
      requesterType: {
        value: requesterIdentity.requesterType,
        source: requesterIdentity.source,
        basis: requesterIdentity.basis,
        classifierOpinion: requesterIdentity.classifierOpinion,
        disagreesWithClassifier: requesterIdentity.disagreesWithClassifier,
      },
      flags: outcome.flags,
      reason: outcome.reason,
      // rca-5vdx: corroborated, not asserted — `Boolean(letterDocument)` can
      // only be true when STEP 7a above actually created a `documents` row,
      // never merely because the decision was `auto_resolve`.
      letterIssued: Boolean(letterDocument),
      letterDocumentId: letterDocument?.id ?? null,
      letterContentHash: letterDocument?.contentHash ?? null,
      // K7 (owner ruling, 2026-08-23, rca-trg6): (b) WARN, DON'T BLOCK.
      // auto_resolve still proceeds against an address this project cannot
      // deliver to — refusing would turn the entire live demo path red, since
      // every Sandbox persona currently carries a `.example.com`/`.test`
      // address. What changes is that the row stops IMPLYING a letter
      // arrived: `deliverable` is the SAME reserved-domain detector
      // src/outbox/server.js uses to build the live inbox view
      // (`isUndeliverable`, reused rather than forked), applied to the
      // employment record's own email — the address a Zendesk-sourced
      // ticket's requester actually is. `null` on every non-`auto_resolve`
      // row: no letter was composed, so deliverability of one is not a fact
      // about that decision.
      deliverable: outcome.decision === "auto_resolve" ? !isUndeliverable(employment.email) : null,
      // G-3/VC-06: present only for a third-party request, and safe here —
      // this row is read by an operator via the Live Feed (VC-22), never by
      // the third party who asked. `consentRecordId` is null until a row
      // exists to reference (identity.js sets it from the lookup/the row
      // this same request may just have created above).
      ...(requesterIdentity.requesterType === "third_party"
        ? {
            consent: {
              requestingParty: ticket.requestingParty ?? null,
              purpose: ticket.purpose ?? null,
              consentRecordId: identity.consentRecordId ?? null,
            },
          }
        : {}),
    },
  });

  // STEP 7c — the render failure, if any, is raised now: the decision row
  // above is durable first (test 23's ["auto_resolve", "letter_render_failed"]
  // order, unchanged), and only then is the failure itself audited and
  // rethrown with context rather than the raw error a 404-shaped response
  // produced. Nothing customer-facing has run, and the decision + the
  // failure are both on the record.
  if (letterRenderError) {
    await audit.logDurable({
      useCase: "UC-01",
      action: "letter_render_failed",
      actor: requester,
      riskTier: risk.tier,
      details: {
        caseId: caseRow.id,
        externalRef,
        source,
        employmentId: ticket.employmentId,
        legalEntityId: employment.legal_entity_id ?? null,
        error: letterRenderError?.message ?? String(letterRenderError),
      },
    });
    throw new Error(
      `UC-01 letter rendering failed for case ${caseRow.id} (employment ${ticket.employmentId}): ${letterRenderError?.message ?? letterRenderError}`,
      { cause: letterRenderError }
    );
  }

  // STEP 7d — WHOSE QUEUE IS THIS?
  //
  // A decision that names no owning team is a slower way of dropping the case.
  // Until this existed, a UC-01 outcome raised through THIS path reached Zendesk
  // carrying `verification_exception` and nothing else — no `queue_*` tag, no
  // `escalation_*` tag, no group — while the identical decision through the n8n
  // graph was tagged and assigned by its `Assign Routing` node. Two execution
  // paths, one of which silently dropped the hand-off: nothing went red, the
  // decision was right, the letter was right, and the ticket landed in an
  // undifferentiated queue. docs/ESCALATION-DESTINATIONS.md §2.5 found it.
  //
  // THE TABLE IS CONSULTED, NEVER RESTATED. `handoffFor()` is the same function
  // the portal calls and the same table `workflows/nodes/assignRouting.js`
  // ports; the owning team's name is typed in exactly one file in this
  // repository and this is not it.
  //
  // IT IS DOWNSTREAM OF THE DECISION AND OF THE DURABLE AUDIT WRITE, in that
  // order and deliberately. `outcome` is already fixed and already recorded by
  // the time this runs, so routing cannot change what was decided and cannot
  // lose a record: a routing failure below costs a ticket its group, never a
  // decision its audit row.
  const handoff = handoffFor({ useCase: "UC-01", decision: outcome.decision });

  // STEP 8 — close the loop with the customer/specialist on the real ticket.
  // Not caught/backgrounded like the caseStore writes above: this IS the
  // customer-facing action for the auto path, so a failure here should
  // propagate rather than be silently swallowed. Our internal case/document/
  // audit records above are already durable regardless of whether this
  // succeeds — a specialist can still work the case row by hand if it fails.
  let ticketAssignment = null;
  if (zendesk && ticket.source === "zendesk" && ticket.externalRef) {
    if (requesterReply) {
      // G-1 / G-2. The requester gets a real answer in their own words and the
      // ticket is SOLVED, because nobody is waiting for it: `blocked` is a
      // refusal we can already stand behind and `deflected_to_self_service`
      // points at a flow that serves them in seconds. Neither is a hand-off, so
      // no group is looked up and no queue slot is taken — the whole point of
      // G-1 is that somebody Remote cannot serve is told so within seconds
      // rather than waiting in a queue to be told it by a person (§15).
      //
      // NO `documents` ROW EXISTS ON THIS PATH, and that is DRIFT-074's actual
      // control rather than a side effect: refusing to SEND a bad letter still
      // leaves the bad letter rendered, hashed and stored if it was rendered at
      // all. It is not rendered — `letterHtml` is only ever assigned inside the
      // `auto_resolve` branch above — so there is nothing to store.
      //
      // The `replyAndSolve` guard: the real client (src/zendesk/restClient.js)
      // has that method; the hand-rolled test fakes across ~10 test files
      // predate it and expose only `resolveWithLetter`. Both post a public
      // comment and solve, so the outcome is identical either way; the fallback
      // escapes the prose into a paragraph because that sibling takes HTML.
      const tags = handoff ? handoff.tags : [];
      if (typeof zendesk.replyAndSolve === "function") {
        await zendesk.replyAndSolve(ticket.externalRef, requesterReply, { tags });
      } else {
        await zendesk.resolveWithLetter(
          ticket.externalRef,
          `<p>${escapeHtmlText(requesterReply).replace(/\n\n/g, "</p><p>")}</p>`,
          { tags }
        );
      }
    } else if (outcome.decision === "auto_resolve" && letterHtml) {
      // THE QUEUE TAG GOES ON THE AUTO-RESOLVED TICKET TOO, AND SO DOES THE
      // GROUP — owner decision, 2026-08-22 (mail rcc-wisp-u36ja, F-6/rca-1rx).
      //
      // The tag: `queue_hr_ops` answers "whose work was this?" and an
      // escalation RATE needs a denominator — the split in
      // escalationRouting.js only buys an honest ratio (`escalation_*` over
      // `queue_*`) if the resolved cases carry the queue tag as well. Tagging
      // only the exceptions would put the rate back at a constant 100%.
      //
      // The group: this file used to argue there is no hand-off to make and
      // no group belongs on a solved ticket nobody is waiting for. The
      // evaluator surfaced that as arguable — VC-01/§13 read the SAME group
      // assignment onto a solved auto-resolve ticket as onto an escalated
      // one — and the owner ruled directly: assign HR Ops here too, the same
      // team the human_review branch below already resolves through
      // `resolveGroupAssignment`. One code path for group resolution, so the
      // missing-group case keeps its existing "assignment skipped" behaviour
      // for free rather than a second, divergent implementation.
      ticketAssignment = await resolveGroupAssignment({ handoff, zendesk, useCase: "UC-01" });
      await zendesk.resolveWithLetter(ticket.externalRef, letterHtml, {
        tags: ticketAssignment.routingTags,
        groupId: ticketAssignment.groupId,
      });
    } else {
      // A HUMAN HAS TO PICK THIS UP, so this is where the group lookup belongs.
      // Never a group CREATE — see `resolveGroupAssignment`'s header and
      // `ZendeskClient.listGroups()`. When the group is absent the ticket is
      // tagged anyway and told, in words, that assignment was skipped and why:
      // `Mobility Specialists` and `Local HR & Legal` are genuinely absent from
      // the live account today, so this is the ordinary path for two of the
      // nine, not a hypothetical.
      ticketAssignment = await resolveGroupAssignment({ handoff, zendesk, useCase: "UC-01" });

      // The automation's own outcome tag FIRST, then the routing tags. Order is
      // readability only; `verification_exception` is what UC-01.md §5c names
      // and what the live Zendesk trigger's guard reads, so it keeps its place
      // rather than being replaced by the newer, use-case-agnostic vocabulary.
      const tags = [
        ...(outcome.decision === "escalate" ? ["verification_exception"] : []),
        ...ticketAssignment.routingTags,
      ];
      // THE NOTE IS THE PRODUCT, for a 🟢 use case.
      //
      // Everything else UC-01 does is invisible to a person: the clean requests
      // are answered and solved with nobody looking. This internal note is the
      // entire human-facing surface, it is read by somebody who by definition
      // has the hard case, and it used to be three slugs. It now leads with what
      // the deciding gate MEANS in plain words (C-22), then carries the figures
      // that gate compared (C-27), then the slugs — which stay, because they are
      // what `audit_log`, the metrics ranking and the n8n port all key on, and a
      // specialist grepping for `over_scope_request` must still find it here.
      const note =
        `AI summary — decision: ${outcome.decision} (${outcome.reason}). ` +
        `Flags: ${outcome.flags.length ? outcome.flags.join(", ") : "none"}.` +
        (decidedBy ? ` Decided at gate ${decidedBy.position} of ${decidedBy.total} (${decidedBy.gate}): ${decidedBy.means}` : "") +
        formatFactsForNote(decisionFacts) +
        // WHO THIS IS BEING HANDED TO, said out loud on the ticket. §2.4 of
        // docs/ESCALATION-DESTINATIONS.md is the other half of this defect: a
        // UC-01 exception note told the reader the decision, the reason and the
        // figures, and never once told them whose queue it was — so it could
        // not be read as a hand-off at all. The sentence comes from the same
        // resolved assignment the `group_id` below comes from, so what the
        // ticket SAYS and where the ticket WENT cannot drift apart.
        `\n\nRouting — ${describeAssignment(ticketAssignment)}`;
      await zendesk.flagForReview(ticket.externalRef, {
        note,
        tags,
        groupId: ticketAssignment.groupId,
      });
    }
  } else if (
    zendesk &&
    ticket.source === "third_party_door" &&
    ticket.externalRef &&
    (outcome.decision === "human_review" || outcome.decision === "escalate")
  ) {
    // rca-52q / E3-F9 — "the third-party disclosure decision reaches no
    // specialist." The door's own `externalRef` is a `randomUUID()`
    // (src/thirdparty/server.js), never a real Zendesk ticket, so the branch
    // above never fires for this source — it only ever UPDATES a ticket the
    // request already arrived on. There is nothing to update here; a ticket
    // has to be CREATED, exactly the shape src/portal/ticketing.js's
    // `raiseTicketIfNeeded()`/`linkTicket()` already use for every other
    // non-Zendesk-originated decision that needs a human. Same mechanism,
    // not a second one — and the only two decisions a third party can ever
    // reach this far with are `human_review`/`third_party_request` (consent
    // granted) and `escalate`/`employee_not_active` (consent granted, but the
    // record is no longer active). `blocked` (consent refused) and
    // `awaiting_employee_consent` (nobody has answered yet) are deliberately
    // excluded — the employee, not a specialist, owns both of those (G-1/G-3
    // above), and creating a ticket for either would be exactly the
    // zero-touch-with-consent shape §5's third-party step 5 forbids in the
    // other direction: a hand-off with nothing yet to hand off.
    //
    // TWO CONSTRAINTS FROM THE EVALUATOR, BOTH HELD HERE:
    //   1. This is a HAND-OFF, not a second place a disclosure gets DECIDED —
    //      it only raises a ticket for a decision `evaluate()` already made,
    //      above, before any of this ran. The sidebar stays the only place a
    //      specialist decides what may be disclosed.
    //   2. The ticket SUBJECT carries no employment fact (E3-F12 is the
    //      sibling leak — the sidebar showing a subject's facts on an
    //      unverified case). The internal NOTE may: it is read only by the
    //      specialist this is being handed to, inside Zendesk, which is the
    //      entire reason it exists.
    ticketAssignment = await resolveGroupAssignment({ handoff, zendesk, useCase: "UC-01" });
    const tags = [
      "third_party_door",
      ...(outcome.decision === "escalate" ? ["verification_exception"] : []),
      ...ticketAssignment.routingTags,
    ];
    // E4-F16 (rca-0nm) — ticket #108: this hand-off used to end at "Routing —
    // …" with no action line at all. A specialist who approved in the ZAF
    // sidebar got the panel's own hint ("solves the ticket"), issued the
    // letter, and the ticket went `solved` — true of THIS internal ticket,
    // and easy to read as "done" when the requesting party (who never sees
    // this ticket — VC-33) has actually heard nothing. Only `human_review`
    // ever reaches an approve control that issues a letter here; `escalate`
    // (employee_not_active, consent granted) never does, so it gets its own
    // sentence rather than a promise of a letter that cannot be issued.
    const actionLine =
      outcome.decision === "human_review"
        ? `\n\nApproving in the ZAF sidebar issues the ${outcome.reason === "over_scope_request" ? "CUSTOMIZED" : "standard"} verification letter and solves this INTERNAL ticket — ` +
          `the requester on this ticket is the door itself, never ${ticket.requestingParty ?? "the third party"} who ` +
          `actually asked, so nothing is sent to them automatically. Once approved, send the letter to ` +
          `${ticket.returnAddress ?? "the return address above"} yourself; until you do, they have been told nothing ` +
          `beyond the door's fixed acknowledgement.`
        : `\n\nThis employment is not active, so no letter can be issued on this ticket at all — see the gate meaning ` +
          `above for what to do instead. Nothing has been, or will be, sent to the requesting party from here.`;
    const note =
      `AI summary — decision: ${outcome.decision} (${outcome.reason}). ` +
      `Flags: ${outcome.flags.length ? outcome.flags.join(", ") : "none"}.` +
      (decidedBy ? ` Decided at gate ${decidedBy.position} of ${decidedBy.total} (${decidedBy.gate}): ${decidedBy.means}` : "") +
      formatFactsForNote(decisionFacts) +
      `\n\nThis request arrived through the third-party consent door, not Zendesk. The requesting party is never ` +
      `shown this ticket or anything about it — they were sent one fixed acknowledgement regardless of ` +
      `what this decided. This is the first time a human is being told about it.` +
      // WHAT THE ENQUIRER CLAIMED, LABELLED AS A CLAIM. `subjectName` was
      // typed into an unauthenticated public form (src/thirdparty/server.js)
      // by someone this system has not identified, so it is reported here as
      // an assertion and never as a fact Remote holds — the specialist reading
      // this note is the first person able to tell the two apart. It is here
      // because it is the ONLY thing that tells them whose permission to go
      // and ask, which is Remote's own published condition for answering a
      // third party at all ("after receiving permission from you (the
      // employee)", support.remote.com 19201215338509). It is never matched
      // against the record and never used to find anybody: resolving a person
      // by name is the question VC-33 refuses.
      `\n\nName the enquirer gave for the person: ${ticket.subjectName ?? "not recorded"} — THEIR CLAIM, not a record match; ` +
      `nothing here was resolved by name.` +
      // THE FACTS THE APPLICANT GAVE THE BANK, laid out for the one person who
      // can check them. A verification request is never "does anyone called X
      // work for you" — it is "your employee told us these things, confirm
      // them", which is how Fannie Mae's Form 1005 and every tenant-
      // referencing form are built. None of these was matched against
      // anything: the employment was resolved by the Remote Employee ID and
      // by nothing else. A mismatch here is a signal FOR THE SPECIALIST, and
      // deliberately not a gate — refusing on it would tell an enquirer, by
      // the shape of the refusal, that they had guessed part of it right.
      `\n\nDate of birth given: ${ticket.subjectDateOfBirth ?? "not recorded"}. ` +
      `Start date they were told: ${ticket.subjectClaimedStartDate ?? "not stated"}. ` +
      `BOTH ARE CLAIMS from an unauthenticated enquirer — check them against the record before you disclose ` +
      `anything, and treat a mismatch as a reason to stop rather than a detail to correct.` +
      `\n\nEmployment id: ${ticket.employmentId ?? "not recorded"}. Requesting party: ${ticket.requestingParty ?? "not recorded"}. ` +
      `Purpose stated: ${ticket.purpose ?? "not recorded"}. Return address on file: ${ticket.returnAddress ?? "not recorded"}.` +
      actionLine +
      `\n\nRouting — ${describeAssignment(ticketAssignment)}`;
    try {
      const created = await zendesk.createTicket({
        // NO EMPLOYMENT FACT — constraint 2 above. "awaiting specialist
        // review" is true of every ticket this branch ever creates; the
        // decision and everything about the person it concerns lives in the
        // internal note, never the subject line.
        subject: "UC-01 — third-party disclosure request awaiting specialist review",
        comment: {
          html_body: `<p>${escapeHtmlText(note).replace(/\n\n/g, "</p><p>")}</p>`,
          public: false,
        },
        tags,
        ...(ticketAssignment.groupId ? { group_id: ticketAssignment.groupId } : {}),
      });
      if (created?.id) {
        // Repoint the case's own reference at the ticket that now carries it —
        // the SAME method (`caseStore.linkTicket()`) the portal's join uses,
        // so the ZAF sidebar's by-ticket lookup finds this case exactly as it
        // finds a portal-originated one. The UUID the door minted is still the
        // requester's own reference (they never see the ticket id — VC-33);
        // this is the record's, and it changes the moment a human can act on
        // it, same as every other non-Zendesk hand-off in this repository.
        if (typeof caseStore.linkTicket === "function") {
          await caseStore.linkTicket(caseRow.id, String(created.id));
        }
        ticketAssignment.ticketId = String(created.id);
        // THE RELINK EVENT — R7-29/rca-czpn. `linkTicket()` just above replaced
        // the case row's own `external_ref` with this ticket id, exactly what
        // src/portal/server.js's `recordTicketRelink()` does for every other
        // non-Zendesk hand-off — but until now nothing here said so. UC-03
        // already emits `portal_reference_relinked` for the identical fact
        // ("the two references name the same request"); this branch performed
        // the same silent substitution with no audit trail of its own. Neither
        // the requesting party nor the specialist ever holds `caseRow.id`
        // (VC-33 keeps it that way on purpose), so the reference each of them
        // actually holds — the door's minted UUID, and the ticket id — needs a
        // row that ties the two together, findable by either one via
        // `details->>'externalRef'` / `details->>'recordedRef'`, the same
        // fields `src/approvalqueue/queueStore.js`'s `ticketLinks()` already
        // reads off every OTHER use case's relink rows.
        audit.log({
          useCase: "UC-01",
          action: "portal_reference_relinked",
          actor: requester,
          riskTier: risk.tier,
          details: {
            caseId: caseRow.id,
            recordId: caseRow.id,
            externalRef,
            recordedRef: String(created.id),
            ticketId: String(created.id),
            source,
            reason: outcome.reason,
            note:
              `This request was submitted through the third-party door under reference ${externalRef} and handed to ` +
              `a specialist as Zendesk ticket ${created.id}. Its stored record now carries ${created.id} as its ` +
              `reference, so anything decided about it from here on is filed under ${created.id}. The two ` +
              "references name the same request.",
          },
        });
        audit.log({
          useCase: "UC-01",
          action: "third_party_handoff_ticket_created",
          actor: requester,
          riskTier: risk.tier,
          details: {
            caseId: caseRow.id,
            // externalRef/source: the reference the requester (here, the
            // third party) was actually shown — the UUID the door minted,
            // NOT the ticket id this row is announcing. `readStore.js` looks
            // a row up by exactly this field, and it must resolve for the
            // ORIGINAL reference, not only the new one.
            externalRef,
            source,
            ticketId: String(created.id),
            decision: outcome.decision,
            reason: outcome.reason,
            tags,
          },
        });
      }
    } catch (err) {
      // Never lose the decision to a hand-off failure — same rule as every
      // other non-fatal write in this file (letter_render_failed above,
      // src/portal/server.js's portal_ticket_creation_failed). The decision
      // and its durable audit row (STEP 7) already exist; what failed is only
      // the specialist ever being told about it, and that failure must itself
      // be findable rather than only reaching a console log nobody watches.
      audit.log({
        useCase: "UC-01",
        action: "third_party_handoff_ticket_failed",
        actor: requester,
        riskTier: risk.tier,
        details: {
          caseId: caseRow.id,
          externalRef,
          source,
          decision: outcome.decision,
          reason: outcome.reason,
          error: err?.message ?? String(err),
        },
      });
    }
  }

  const result = {
    decision: outcome.decision,
    letterHtml,
    // WHAT THE REQUESTER WAS ACTUALLY TOLD, in their own words. Null when a
    // specialist answers by hand. Every non-Zendesk surface (the portal, the
    // playground, the chat demo) renders this rather than re-deriving copy from
    // the reason slug — which is how a slug reaches a customer.
    requesterReply,
    flags: outcome.flags,
    reason: outcome.reason,
    caseId: caseRow.id,
    // THE CLASSIFICATION THIS DECISION WAS MADE ON, which this result used to
    // omit entirely — UC-03 already fixed the identical omission on its own
    // result and gave the reason: five of UC-01's gates read this object, and a
    // caller could see none of it. In particular `source` answers "did the model
    // or the fallback rules read this ticket?", which changes how much weight a
    // reviewer gives every other field here (§4 invariant 8 — the tag belongs on
    // the RESULT, not only in a table nobody reading the decision will open).
    classification,
    // WHICH SIGNAL PROVED (or failed to prove) WHO WAS ASKING. `flags` carries
    // `identity_<reason>` on a refusal and nothing at all on a pass, so a
    // successful identity check was previously unreportable.
    identity,
    // WHO WAS ASKING, and how that was decided. Deterministic (L-10) — the
    // model's answer is carried beside it, never in place of it.
    requesterType: requesterIdentity,
    // Where in the order this stopped, and what that rung means in plain words.
    decidedBy,
    // The figures the deciding gate compared. Null when nothing was refused.
    decisionFacts,
    // WHOSE QUEUE THIS IS, as decided from the table — reported whether or not
    // a Zendesk ticket was ever touched, because it is a property of the
    // DECISION and every surface that shows a decision should be able to name
    // the team. Null only if UC-01 loses its row in escalationRouting.js.
    routing: handoff
      ? { intendedGroup: handoff.group, escalated: handoff.escalated, tags: handoff.tags }
      : null,
    // WHAT ACTUALLY HAPPENED TO THE TICKET, which is a different claim and must
    // not be inferred from the one above: a route can exist while the account
    // has no such group. Null when no Zendesk hand-off ran at all (auto-resolve,
    // or no client configured) — an absence, stated as one, rather than an
    // `assigned: false` that would read as a failed assignment.
    ticketAssignment,
  };
  // Only present when a caller supplied `renderPdf` AND a letter was actually
  // rendered — never an `undefined`-valued key on the default (no-PDF) path,
  // so existing consumers/tests that only assert specific fields see no
  // shape change at all.
  if (letterPdf !== undefined) result.letterPdf = letterPdf;
  return result;
}
