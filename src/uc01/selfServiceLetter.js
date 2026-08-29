// ---------------------------------------------------------------------------
// selfServiceLetter.js  —  L-14: the destination G-2's deflection promises
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// G-2's deflection tells a signed-in employee "the standard employment
// verification letter is available directly from the Requests tab in your
// account, and it's issued in seconds" (refusalCopy.js's
// `self_service_available` message). Until this existed, that sentence
// pointed at a destination this repository had never built — the portal (the
// stand-in for Remote's own product surfaces) had no UC-01 request type at
// all, so an employee who followed the deflection's own advice found nothing
// to click.
//
// THIS IS NOT `handleVerificationTicket()` RUN A SECOND WAY. It is a
// deliberately SEPARATE, SIMPLER function — the stand-in for Remote's own
// native flow, which G-2's whole design premise is that Remote ALREADY
// SERVES "in seconds", with no ticket, no LLM classification, and no
// third-party consent regime, because the requester is already authenticated
// and asking about themself. Routing this through the ticket-driven workflow
// would be routing a native, already-solved flow back through the very
// support channel it exists to bypass — the loop this repository's history
// records G-2 shipped alone would create (see policyEngine.js's own
// reasoning for why G-1 and G-2 land in one commit).
//
// WHAT IT SHARES WITH THE TICKET-DRIVEN PATH, AND WHY THOSE THREE THINGS
// SPECIFICALLY: `engagementEligibility.js` (G-1 — Remote must actually be
// this person's legal employer), `REQUIRED_LETTER_FIELDS`
// (policyEngine.js — the record must state every fact the letter prints),
// and `letter.js` (the ONE template, so the no-compensation guarantee is
// never a second copy of itself). These are the only three facts common to
// BOTH channels; everything else about the ticket-driven path (the
// classifier, the third-party consent regime, over-scope disclosure) has no
// analogue here because a self-service click carries none of the ambiguity a
// free-text ticket does — the requester is already known, and there is no
// text to classify.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   - No LLM anywhere. There is nothing to interpret: a click is not a
//     sentence, and the only free-text field a real Requests-tab flow would
//     carry (if any) plays no part in whether the letter issues.
//   - No third-party path. Self-service is, by definition, the SELF path —
//     an authenticated employee acting on their own record. A third party
//     has no Remote session to authenticate this way, and the third-party
//     door (L-12) is the deliberately separate, deliberately unauthenticated
//     surface for that channel.
//   - It re-verifies identity itself rather than trusting a caller's claim —
//     the session's own employment id must equal the one being asked about,
//     the same prime-directive-#3 discipline every other gate in this
//     repository already applies.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { classifyEngagement } from "./engagementEligibility.js";
import { REQUIRED_LETTER_FIELDS } from "./policyEngine.js";
import { renderLetterHtml } from "./letter.js";
import { claimExternalRef, findClaimDecision } from "../shared/workflowClaims.js";
import { isUpstreamReason } from "../shared/upstreamFailure.js";

/**
 * @param {object} args
 * @param {string} args.employmentId   which employee the letter is about
 * @param {object|null} args.session   `{authenticatedEmploymentId}` — the
 *   ONLY authenticated signal this function accepts; there is no
 *   `authenticatedEmail` fallback here, because a real Requests-tab click
 *   only ever happens from inside an authenticated Remote session.
 * @param {string} [args.externalRef]  an optional caller-supplied reference.
 *   There is no ticket here to derive one from, and rca-nr4i/D-20 found that
 *   nothing ever supplied one either: every self-service issuance reached
 *   `audit_log` with `externalRef: null`, so nothing distinguished twelve
 *   genuine requests from one processed twelve times, and the exactly-once
 *   ledger had nothing to claim. When a caller supplies one it is used as
 *   given (unchanged); when none is supplied, one is GENERATED here, so every
 *   issuance is traceable back the same way every other portal submission's
 *   is (src/auditview/readStore.js looks decisions up by
 *   `details->>'externalRef'`, by name, across every use case).
 * @param {object} deps
 * @param {import("../remote/restClient.js").RemoteClient} deps.remote
 * @param {import("../shared/audit.js").AuditLogger} deps.audit
 * @param {import("../shared/caseStore.js").CaseStore} [deps.caseStore]  optional —
 *   when supplied, a `cases`/`documents` row is written so the letter shows
 *   up in "My requests" (src/portal/), exactly like every other portal
 *   submission. Omitted, the letter still issues; it is simply not listed
 *   anywhere afterwards.
 * @returns {Promise<{ok:true, status:200, letterHtml:string, caseId:string|null, externalRef:string, duplicate?:true, duplicateWindowExpiresAt?:string}
 *   |{ok:false, status:number, code:string, reason:string}>}
 *   `duplicate: true` (D-26) means this call joined an issuance already
 *   claimed within the last hour rather than creating a second one — the
 *   returned `letterHtml`/`externalRef` are the FIRST issuance's, not a new
 *   one, and no second case/document/audit row was written. When `duplicate`
 *   is set, `duplicateWindowExpiresAt` (rca-0jya/R7-41) names the ISO instant
 *   the hourly bucket below rolls over — the moment a request from this same
 *   employee stops joining this one and is issued fresh. Nothing before this
 *   surfaced that instant anywhere, so a requester who hit the join had no way
 *   to tell "held for now" from "held forever."
 */
export async function issueSelfServiceLetter(
  { employmentId, session, externalRef = null },
  { remote, audit, caseStore = null }
) {
  // IDENTITY FIRST, AND IT IS THE ONLY GATE THAT MAY EVER REFUSE THIS
  // SILENTLY-ISH — no employment fact is read before this passes.
  if (!session || !session.authenticatedEmploymentId || session.authenticatedEmploymentId !== employmentId) {
    return {
      ok: false,
      status: 403,
      code: "not_your_employment",
      reason: "You may only request your own employment verification letter this way.",
    };
  }

  const employment = await remote.getEmployment(employmentId);

  // G-1's second Remote read (rca-bdz): is this employment currently
  // mid-offboarding? Same guard as `src/uc01/workflow.js`'s STEP 2a — only
  // asked when there is an employment to ask about, and degrades safely for
  // a fake `remote` that predates this method.
  const offboarding = employment && typeof remote.listOffboardingsForEmployment === "function"
    ? await remote.listOffboardingsForEmployment(employmentId)
    : null;

  // G-1, ported rather than restated: Remote must actually be this person's
  // legal employer, checked BEFORE anything about status or completeness.
  const engagement = classifyEngagement(employment, offboarding);
  if (!engagement.eligible) {
    // THE OFFBOARDING READ ITSELF FAILED — a temporary "we could not check",
    // not a finding about this engagement. A 409 with the generic message
    // below would tell an ordinary active employee their engagement is
    // permanently ineligible, which is false; 503 says what actually
    // happened and that trying again (or the usual support channel) makes
    // sense.
    if (isUpstreamReason(engagement.reason)) {
      return {
        ok: false,
        status: 503,
        code: engagement.reason,
        reason:
          "We couldn't confirm something we need before issuing this letter. Please try again shortly, or raise it through the usual support channel.",
      };
    }
    return {
      ok: false,
      status: 409,
      code: engagement.reason,
      reason:
        "This letter is not available through self-service for this engagement. Raise it through the usual support channel instead.",
    };
  }

  if (!employment || employment.status !== "active") {
    return {
      ok: false,
      status: 409,
      code: "employee_not_active",
      reason: "A standard employment verification letter can only be issued for an active employment.",
    };
  }

  const missingFields = REQUIRED_LETTER_FIELDS.filter(
    (f) => employment[f] == null || String(employment[f]).trim() === ""
  );
  if (missingFields.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "incomplete_employment_record",
      reason: "Your employment record is missing a fact this letter has to state as fact. Raise it through the usual support channel instead.",
    };
  }

  const legalEntity = await remote.getLegalEntity(employment.legal_entity_id, employment.company_id);

  // rca-nr4i / D-20: GENERATE one rather than writing null. Self-service has
  // no ticket to borrow a reference from, but "no ticket" is not "no
  // reference" — every other zero-ticket path in this repository (the
  // third-party door, `src/thirdparty/server.js`) mints one the same way, for
  // the same reason: a decision with no reference is a decision nobody can
  // trace back to the click that produced it, or claim exactly-once against.
  const ref = externalRef ?? randomUUID();

  // D-26: THE SAME "MINT A FRESH ID PER SUBMISSION" BUG D-20 FIXED IN THE
  // TRACEABILITY HALF, STILL PRESENT IN THE DEDUPE HALF.
  //
  // D-20 stopped this function writing `externalRef: null` -- every issuance
  // is now traceable. It did not stop a rapid resubmit from producing a
  // SECOND, fully independent issuance: `ref` above is a fresh randomUUID()
  // whenever the caller supplies none, which is the common case, and a fresh
  // random id can never collide with itself. Production confirmed the cost:
  // the portal's submit button showed "Running the real gates..." for ~15s
  // with no progress signal, the employee assumed it had hung, and the
  // resubmit created duplicate ticket #118 (D-26).
  //
  // `intakeKey` is content-derived and time-bucketed, the same construction
  // `src/thirdparty/server.js` uses for the identical bug on that surface,
  // claimed through the SAME `workflow_claims` PRIMARY KEY every other use
  // case's exactly-once guarantee rests on (workflowClaims.js's own header:
  // "THE GUARANTEE IS THE PRIMARY KEY, NOT THIS CODE").
  //
  // Bucketed rather than permanent, and for a DIFFERENT reason than the
  // third-party door's: this endpoint's entire premise is "issued in
  // seconds, any time you like" (see the file header) -- a permanent key
  // would silently refuse a genuinely new letter a returning employee asks
  // for next month. An hour catches the accidental rapid resubmit and lets
  // a later, deliberate re-issue through.
  const intakeBucket = Math.floor(Date.now() / SELF_SERVICE_DUPLICATE_WINDOW_MS);
  const intakeKey = `self-service-letter:${employmentId}:${intakeBucket}`;
  const intakeClaim = await claimExternalRef({
    pgPool: caseStore?.pgPool ?? null,
    useCase: "UC-01",
    externalRef: intakeKey,
    decision: ref,
  });

  if (!intakeClaim.claimed) {
    // rca-0jya (R7-41): the window this join fell inside, named rather than
    // left implicit. `intakeBucket` is THIS call's own bucket — the one the
    // key above just matched against an existing claim on — so its boundary
    // is the boundary both calls share, not a guess about when the FIRST
    // call happened.
    const duplicateWindowExpiresAt = new Date((intakeBucket + 1) * SELF_SERVICE_DUPLICATE_WINDOW_MS).toISOString();
    // MAKE THE SECOND SUBMISSION SAFE, NOT MERELY DISCOURAGED (D-26 item 3).
    // No second case row, no second document row, no second audit row --
    // renderLetterHtml() is a pure function of the (unchanged) employment
    // record, so it is safe to render it again and hand it back under the
    // reference the FIRST call was actually given, rather than minting one
    // that would resolve to no case at all.
    const joinedRef =
      (await findClaimDecision({ pgPool: caseStore?.pgPool ?? null, useCase: "UC-01", externalRef: intakeKey })) ?? ref;
    // Look the FIRST call's own case back up so the portal's "My requests" /
    // letter-download reader (letterOnUc01Case()) still finds a case rather
    // than reading `caseId: null` and rendering nothing — the join should be
    // transparent to the requester, not a second, worse response.
    const joinedCase =
      caseStore && typeof caseStore.findByExternalRef === "function"
        ? await caseStore.findByExternalRef(joinedRef, "UC-01")
        : null;
    // rca-tlb2 (R7-20): the reference rendered ONTO the letter must be the
    // one this response actually reports (`joinedRef`, the FIRST issuance's),
    // never the locally-minted `ref` this particular call would have used had
    // it not joined an existing one.
    const letterHtml = renderLetterHtml(employment, legalEntity, { reference: joinedRef });
    return {
      ok: true,
      status: 200,
      letterHtml,
      caseId: joinedCase?.id ?? null,
      externalRef: joinedRef,
      duplicate: true,
      duplicateWindowExpiresAt,
    };
  }

  // rca-tlb2 (R7-20): rendered only now, once `ref` is confirmed to be THIS
  // issuance's own reference (the claim above succeeded) — the same reference
  // returned to the caller and shown on the portal, so the document and the
  // screen agree on what to quote.
  const letterHtml = renderLetterHtml(employment, legalEntity, { reference: ref });

  let caseId = null;
  let letterDocument = null;
  if (caseStore && typeof caseStore.createCase === "function") {
    const caseRow = caseStore.createCase({
      useCase: "UC-01",
      source: "portal",
      externalRef: ref,
      employmentId,
      requester: session.authenticatedEmploymentId,
      decision: "auto_resolve",
      reason: "self_service_all_gates_passed",
      flags: [],
      status: "resolved",
    });
    caseId = caseRow.id;
    if (typeof caseStore.createDocument === "function") {
      letterDocument = caseStore.createDocument({ caseId, type: "employment_verification_letter", content: letterHtml });
    }
  }

  // DURABLE, before the response — the same ordering invariant 4 requires
  // everywhere in this repository.
  await audit.logDurable({
    useCase: "UC-01",
    action: "auto_resolve",
    actor: session.authenticatedEmploymentId,
    riskTier: "low",
    details: {
      caseId,
      employmentId,
      source: "portal",
      externalRef: ref,
      reason: "self_service_all_gates_passed",
      // rca-nr4i / D-19: unlike UC-01's ticket-driven audit row
      // (src/uc01/workflow.js — where `letterIssued` is a belief recorded
      // BEFORE the letter is rendered or posted), this IS an observed fact
      // by the time this row is written: `letterHtml` above is the whole
      // answer, rendered and validated already, and it rides in the SAME
      // synchronous return as this write — the caller receives it in this
      // same HTTP response, so there is no separate "post" step that could
      // fail unseen the way a later Zendesk call could.
      //
      // rca-5vdx: still corroborated, not merely observed — `letterDocument`
      // is the row `createDocument()` returned just above, and `letterIssued`
      // reports its existence rather than a fixed `true`, so a caseStore
      // without `createDocument` (or a future failure to persist it) cannot
      // silently keep claiming a letter it never recorded.
      letterIssued: Boolean(letterDocument),
      letterDocumentId: letterDocument?.id ?? null,
      letterContentHash: letterDocument?.contentHash ?? null,
    },
  });

  return { ok: true, status: 200, letterHtml, caseId, externalRef: ref };
}

/** D-26: an hour, argued at the intake-key call site above. */
const SELF_SERVICE_DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
