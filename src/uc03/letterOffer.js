// ---------------------------------------------------------------------------
// letterOffer.js  —  The letter an answered inquiry is allowed to become
// ---------------------------------------------------------------------------
// THE OBSERVATION THIS EXISTS FOR
//
// An employee who writes "I'm travelling to Spain for a client meeting from 14
// September to 2 October, can you confirm business travel is fine?" passes
// every gate, reaches `auto_resolve / all_gates_passed`, and is answered
// informationally. If they then discover they need a letter — for a visa
// appointment, or to hand to a border officer — they have had to submit a
// SECOND request, phrased so the classifier detects a letter ask, and it starts
// from the beginning: classify again, read the record again, decide again.
//
// Production says that friction is not hypothetical. `documents` holds three
// `travel_informational_response` rows and zero `travel_support_letter` rows.
// Nobody has ever got a letter out of this system.
//
// Everything the letter needs is already established at the moment the answer
// is sent: identity verified against the authoritative record, employment read
// and active, destination and dates classified confidently, every gate passed.
// So the answer OFFERS the letter, and accepting the offer re-runs the same
// gates on the same classification with the letter flag set.
//
// ---------------------------------------------------------------------------
// THE OFFER IS NOT THE LETTER, AND THIS FILE IS STILL WHERE THAT LINE IS DRAWN
// ---------------------------------------------------------------------------
// THIS SECTION USED TO SAY THE OPPOSITE OF WHAT IT NOW SAYS, AND THE OLD
// WORDING IS WORTH KEEPING IN VIEW. It read: "the formal travel letter is
// deliberately NOT on the 🟢 path ... accepting an offer produces a DRAFTED
// letter and a `review_queue` row, waiting for `submitTravelLetterSignoff()`.
// It skips the retyping, not the signature." Every clause of that was true of
// every path when it was written.
//
// What changed is a decision, not a discovery: a STANDARD letter, for a
// traveller every gate above the letter rung has qualified, on a trip inside the
// duration cap, is now issued by the gate with nobody in the path. So accepting
// an offer produces exactly what typing the request out again would produce —
// which is now `auto_resolve / standard_letter_issued`, a rendered letter and a
// resolved case. It still skips the retyping and nothing else.
//
// WHAT THIS FILE STILL DOES NOT DO, and the line that has not moved: it renders
// nothing, issues nothing and delivers nothing. `acceptTravelLetterOffer()`
// re-runs `handleTravelInquiry()` and returns what came back. Every gate runs
// again against a freshly-read employment record, and the letter rung decides
// afresh — an employee terminated since Tuesday escalates, a destination that
// has left the registry escalates, and an employing entity that cannot be read
// stops for a person with no document written.
//
// ---------------------------------------------------------------------------
// WHY ACCEPTING PRODUCES A NEW CASE RATHER THAN REOPENING THE OLD ONE
// ---------------------------------------------------------------------------
// The alternative was to move the existing case from `resolved` back to
// `pending_review` and rewrite its decision. Rejected, for five reasons that
// are all about what the rest of the system already assumes:
//
//   1. `cases.decision` would have to change from `auto_resolve` to
//      `human_review`, destroying the record of the decision that produced the
//      informational answer THE CUSTOMER ALREADY HAS. `src/metrics/compute.js`
//      counts decisions off these rows, so a 🟢 auto-resolve rate would fall
//      retroactively for work that was done correctly.
//   2. `audit_log` is append-only, so history would carry two decision rows
//      either way. One case row rewritten in place would then disagree with its
//      own history — and the audit log is the thing we tell people to trust.
//   3. Two documents of different kinds (the answer and the letter) would hang
//      off one case whose single `decision` column can only describe one of
//      them.
//   4. The approval queue reports what is waiting by joining `cases` to
//      `review_queue`. A resolved case has no queue row; one would have to be
//      minted after the fact against a row whose recorded decision was
//      "resolved, nobody needed".
//   5. Two decisions were genuinely made, at two different times, about two
//      different questions — "may I travel?" and "will you certify it?". One
//      row per decision is the shape every other part of this repo is built on.
//
// The link between them is not lost: the letter case carries
// `offerAcceptedFrom` into its own audit row, and its classification carries
// `formalLetterRequestedVia: "offer_accepted"` so a reader can never mistake a
// flag a PERSON set for something a classifier read.
//
// ---------------------------------------------------------------------------
// THE IDEMPOTENCY KEY IS THE REASON THIS FILE HAS A CLAIM-REF FUNCTION
// ---------------------------------------------------------------------------
// `workflow_claims` is keyed `(use_case, external_ref)`, and the informational
// answer already claimed the ticket. A second decision under the same ref is
// refused as a duplicate delivery — the letter would be silently dropped and
// the employee would be told nothing, which is the worst of the three possible
// outcomes. UC-04 hit the same wall from the other side (`src/uc04/
// textIntake.js`) and solved it by making the clarification turn write nothing
// at all, so it consumed no claim. That answer is not available here: BOTH
// turns are decisions and both must be recorded.
//
// So the ticket id and the claim key stop being the same string. The ticket id
// stays on the case row — it is where the customer's conversation is, and it is
// what Zendesk and the sidebar look things up by. The claim is taken under
// `<ref>#letter`, which is a different delivery of a different request and is
// keyed as one. A double-click therefore produces one letter, not two, by the
// same primary key that protects everything else.
// ---------------------------------------------------------------------------

/**
 * Recorded on the carried-forward classification, in place of the value a
 * classifier would have produced. `formalLetterRequested` is documented as the
 * classifier's reading of the request text; on this path it is not — a person
 * clicked. Saying which is not decoration: `classification` is what a reviewer
 * opens to ask "who decided that, and how sure were they?", and a `true` that
 * arrived from a button must not read as a `true` that arrived from a model.
 */
export const OFFER_ACCEPTED = "offer_accepted";

/** The `cases.decision` / `cases.reason` pair an offer can be made on. */
export const OFFERABLE_DECISION = "auto_resolve";
export const OFFERABLE_REASON = "all_gates_passed";

export const OFFER_REFUSALS = {
  case_not_found: { status: 404, reason: "No UC-03 case exists with this id." },
  no_offer_on_this_case: {
    status: 409,
    reason: "This request was not answered with an informational reply, so there is no letter offer to accept.",
  },
  classification_not_recorded: {
    status: 409,
    reason:
      "The reading of the original request is not stored on this case, so there is nothing to carry forward and a " +
      "letter would have to be built from facts nobody has re-checked. Ask for the letter as a fresh request instead.",
  },
  offer_already_accepted: {
    status: 409,
    reason:
      "The formal travel letter has already been requested for this trip. Open that request to see what came of " +
      "it — it was either issued to you or it is with a specialist.",
  },
  session_required: {
    status: 401,
    reason:
      "A travel letter is issued to the employee it is about, so accepting the offer needs the same authenticated " +
      "session the original request was verified with.",
  },
  not_the_traveller: {
    status: 403,
    reason: "A travel letter may only be requested by the employee it is about.",
  },
};

/**
 * The exactly-once key for the letter this case's offer would produce.
 *
 * NOT the ticket id, and see the header for why. Null when the case carries no
 * external reference at all — `claimExternalRef()` already treats a missing ref
 * as "cannot be a duplicate delivery of anything" and proceeds, and inventing a
 * key here would give one surface a guarantee the others do not share.
 *
 * @param {object|null} caseRow
 * @returns {string|null}
 */
export function letterClaimRef(caseRow) {
  const ref = caseRow?.externalRef;
  return ref == null || ref === "" ? null : `${ref}#letter`;
}

/**
 * The classification the letter decision is taken on: the ORIGINAL reading,
 * with the letter flag set and marked as having been set by a person.
 *
 * NOTHING IS RE-CLASSIFIED, AND THAT IS A SAFETY PROPERTY, not a saving. A
 * fresh model read of the same text could return a different destination, a
 * different date, or a lower confidence — and the employee would then be
 * agreeing to a letter about a trip they never saw described. The figures in
 * the letter are the figures already shown to them in the informational answer.
 *
 * The confidence figure travels with it, so `evaluate()`'s confidence gate runs
 * again on the same number and the letter cannot be reached from a reading the
 * router would refuse to trust. That is the second of two independent guards;
 * the first is that only `all_gates_passed` is offerable at all, and the third
 * is that `workflow.js` drafts a letter only when the RE-RUN's own reason comes
 * back `formal_letter_requested`.
 *
 * @param {object|null} classification
 * @returns {object|null}
 */
export function carryClassificationForward(classification, { acceptedFrom = null } = {}) {
  if (!classification || typeof classification !== "object") return null;
  return {
    ...classification,
    formalLetterRequested: true,
    formalLetterRequestedVia: OFFER_ACCEPTED,
    // WHICH ANSWER THIS LETTER CONTINUES — a durable parent link, and it is
    // load-bearing rather than decorative.
    //
    // "Has this offer already been taken?" used to be answered by looking up
    // the newest case sharing the answered case's REFERENCE. That worked only
    // while both rows kept the same reference, and they no longer do: once the
    // letter request raises a Zendesk ticket, `linkTicket()` repoints the
    // letter case at the ticket id (src/portal/ticketing.js explains why the
    // ticket follows the trip). The two rows then share no reference at all,
    // the lookup finds nothing, and a second accept reads as a first one.
    //
    // A parent id survives every relink, because a case id is never rewritten.
    // It also makes the refusal name the exact case rather than the newest row
    // that happened to share a string.
    offerAcceptedFrom: acceptedFrom ?? null,
  };
}

/** Was this case created by somebody accepting an offer? */
export function isOfferAcceptance(caseRow) {
  return caseRow?.classification?.formalLetterRequestedVia === OFFER_ACCEPTED;
}

/**
 * Is this case the letter request made by accepting THAT case's offer?
 *
 * Both halves are required. `isOfferAcceptance()` alone says only that some
 * offer was accepted, and one traveller can have several trips open at once —
 * matching on that alone would refuse a second, unrelated letter request as a
 * duplicate of the first.
 *
 * @param {object|null} caseRow
 * @param {string|null} parentCaseId
 */
export function isAcceptanceOf(caseRow, parentCaseId) {
  if (!parentCaseId || !isOfferAcceptance(caseRow)) return false;
  return caseRow.classification.offerAcceptedFrom === parentCaseId;
}

/**
 * May this case's offer be accepted at all — and, when it may not, what IS the
 * situation? Pure: no store, no clock, no network.
 *
 * @param {object} args
 * @param {object|null} args.caseRow          the `cases` row (camelCase)
 * @param {object|null} [args.followOnCase]   the newest case sharing this
 *   ticket, when the caller could look one up. Supplied rather than fetched so
 *   this stays pure. It is a DISPLAY input, not the control: two simultaneous
 *   accepts are stopped by `workflow_claims`' primary key, not by this check.
 * @param {object|null} [args.session]        the authenticated session offering
 *   to accept, when there is one
 * @returns {{allowed:boolean, code:string, reason:string, status:number}}
 */
export function evaluateLetterOffer({ caseRow, followOnCase = null, session = null }) {
  if (!caseRow) return refuseOffer("case_not_found");

  if (caseRow.decision !== OFFERABLE_DECISION || caseRow.reason !== OFFERABLE_REASON) {
    return refuseOffer("no_offer_on_this_case", { reason: describeNoOffer(caseRow) });
  }

  // A case whose reading was never stored cannot have it carried forward. This
  // is reachable in one real place and it is not a hypothetical: a case written
  // by the n8n graph, read back here by an API process that never saw the run.
  // Refusing by name beats building a letter out of an empty object.
  if (!caseRow.classification || typeof caseRow.classification !== "object") {
    return refuseOffer("classification_not_recorded");
  }

  if (followOnCase && isOfferAcceptance(followOnCase) && followOnCase.id !== caseRow.id) {
    return refuseOffer("offer_already_accepted", {
      reason:
        `${OFFER_REFUSALS.offer_already_accepted.reason} It is case ${followOnCase.id}` +
        `${followOnCase.status ? `, currently ${followOnCase.status}` : ""}.`,
    });
  }

  // IDENTITY. Checked here only so a bad caller gets a clean refusal instead of
  // a whole escalated case row; it is NOT the control, and it must not be read
  // as one — it compares a caller-supplied session against a value stored on
  // the row, which is the "verify a claim against itself" shape this repo has
  // had to fix four times. The control is `verifyRequester()` inside the
  // re-run, against the record freshly read from Remote. Both run; only the
  // second one decides.
  if (session !== null) {
    if (!session?.authenticatedEmploymentId) return refuseOffer("session_required");
    if (session.authenticatedEmploymentId !== caseRow.employmentId) return refuseOffer("not_the_traveller");
  }

  return {
    allowed: true,
    code: "offer_open",
    status: 200,
    reason:
      "Every gate passed, so the same trip can be certified in a formal travel letter — written from this decision " +
      "and issued straight away, unless the employing entity's record cannot be read.",
  };
}

/**
 * The offer as a surface should render it: what it produces, what it will still
 * need, and the facts it would carry forward.
 *
 * THE FACTS ARE HERE ON PURPOSE. The whole point is that the employee does not
 * restate the trip — which means the offer has to SHOW them the trip it is
 * about, or accepting it is agreeing to a document they have not read. They are
 * the same three values the informational answer already told them.
 *
 * @param {object} args  same as evaluateLetterOffer()
 * @returns {{offered:boolean, code:string, reason:string, caseId:string|null,
 *   label?:string, produces?:string, requiresSignoff?:boolean,
 *   accept?:{method:string, path:string}, carries?:object}}
 */
export function describeLetterOffer({ caseRow, followOnCase = null, session = null }) {
  const verdict = evaluateLetterOffer({ caseRow, followOnCase, session });
  if (!verdict.allowed) {
    return { offered: false, code: verdict.code, reason: verdict.reason, caseId: caseRow?.id ?? null };
  }

  const c = caseRow.classification ?? {};
  return {
    offered: true,
    code: verdict.code,
    reason: verdict.reason,
    caseId: caseRow.id,
    label: "Request a formal travel letter for this trip",
    // EVERY ROW THE LETTER WILL CONTAIN, NAMED BEFORE THE CLICK — and base
    // compensation named among them rather than glossed as "employment
    // details". This became load-bearing the day the standard letter began
    // issuing itself: with a specialist in the path there was a person who read
    // the document before anyone else did, and there is not any more. The row a
    // person is most likely to object to is their own pay, `letterScope.js`'s
    // `omission_requested` marker exists to route exactly that objection to
    // somebody who can write the letter by hand, and a marker only fires on an
    // ask. Nobody asks about a row they were never told was there.
    //
    // THE PAY ROW IS NAMED, BUT NO LONGER PROMISED — and the difference is a
    // defect, not a hedge. It read "…and your base compensation", flatly, to
    // everyone. `src/uc03/letter.js` states an ANNUAL GROSS SALARY, which
    // Remote holds for an EOR employment and does not hold for a contractor:
    // a contractor's record carries a per-period RATE whose ×100 scale this
    // repository has not established, so the letter deliberately prints
    // nothing for it. Every contractor who accepted this offer was therefore
    // promised a row their document could not carry — the same defect as a
    // letter silently omitting what the offer said it would state, arriving
    // from the other side.
    //
    // It is still NAMED, which is the half the paragraph above is about and the
    // half that must not be lost.
    //
    // WHY THE WORDING IS CONDITIONAL RATHER THAN COMPUTED. This function is
    // given a case row, not an employment record — the salary lives on the
    // Remote read, which the offer has never seen. Stating the condition in
    // the employee's own terms is true for both engagement types today;
    // reading it off the record would need the employment plumbed in through
    // every caller, which is its own unit of work.
    produces:
      "A letter on the employing entity's letterhead, for a visa appointment or a border check. It states your " +
      "name, job title, employment status, contract type, employment start date, the employing entity and the " +
      "jurisdiction it is registered in, and the destination and travel dates. If your employment record holds an " +
      "annual gross salary, it states that too, as a yearly figure in your contract's currency; a contractor's rate " +
      "is recorded differently and the letter does not state it. It does not state an addressee, a passport number, " +
      "who bears the costs, or anything in another language.",
    // STATED BEFORE THE CLICK, not discovered after it. An offer that reads as
    // "get a letter" and then produces a wait is a worse experience than the
    // one it replaced.
    // THIS USED TO SAY `true`, AND IT WAS TRUE OF EVERY PATH WHEN IT WAS
    // WRITTEN. It is not any more: a standard letter for a trip that cleared
    // every gate is now written and issued by the gate itself, with nobody in
    // the path. The one thing that can still hold it up is the LETTERHEAD — an
    // employing entity Remote cannot return has nothing to write on, and that
    // case stops for a person with no document. So the offer promises the
    // ordinary outcome and names the exception, rather than promising a wait
    // that usually will not happen.
    requiresSignoff: false,
    signoffNote:
      "It is written and issued to you straight away — every check needed for it has already passed on this " +
      "request. The one thing that can hold it up is your employing entity's record: if that cannot be read, " +
      "there is no letterhead to write on and a Travel & Mobility Support specialist picks it up instead.",
    accept: { method: "POST", path: `/api/cases/${caseRow.id}/request-letter` },
    carries: {
      destinationCountry: c.destinationCountry ?? null,
      startDate: c.startDate ?? null,
      endDate: c.endDate ?? null,
      // Shown so a wrong reading is corrected BEFORE it reaches a document a
      // consulate will read, rather than by the specialist at sign-off.
      correction: "If any of these is wrong, send the correction as a new request rather than accepting this offer.",
    },
  };
}

/**
 * A case that carries no offer, described by what it actually is.
 *
 * Every branch names the state rather than only denying the button — the same
 * rule `signoffPolicy.js`'s `describeNoSignoffPath()` follows, and for the same
 * reason: "not available" tells a reader nothing they can act on.
 */
export function describeNoOffer(caseRow) {
  const row = caseRow ?? {};

  // THE LETTER IS ALREADY IN THEIR HANDS. Without this branch an issued case
  // fell through to the default — "this request was not answered with an
  // informational reply, so there is no letter offer to accept" — which is
  // literally true and tells the reader the opposite of what happened.
  if (row.decision === "auto_resolve" && row.reason === "standard_letter_issued") {
    // WHICH OF THE TWO WAYS IT GOT HERE, because they are different sentences to
    // the reader: one case IS the offer, taken; the other never had an offer
    // because the letter was asked for in the first breath.
    return isOfferAcceptance(row)
      ? "This case IS the letter request — it was created by accepting the offer, and the letter has already been " +
        "written and issued. There is no offer to accept because it has already been taken, and nothing is waiting " +
        "on anybody: the document is attached to this case."
      : "The travel letter for this trip has already been written and issued — it was asked for in the request " +
        "itself, every gate passed, and the 🟢 path issued it with no signature needed. There is no offer to accept " +
        "because there is nothing left to ask for; the letter is attached to this case.";
  }

  if (row.decision === "human_review" && row.reason === "formal_letter_requested") {
    // ONE STATE, ONE CAUSE, since the standard letter began issuing itself: the
    // letter was asked for and the trip qualifies, but the employing entity
    // could not be read, so NOTHING WAS WRITTEN. Both sentences below used to
    // say "drafted ... awaiting sign-off", which is now the one thing this case
    // never is.
    return isOfferAcceptance(row)
      ? "This case IS the letter request — it was created by accepting the offer. No letter was written: the employing entity could not be read, so there was no letterhead to write on, and Travel & Mobility Support has it."
      : "A formal travel letter was already asked for in the request itself. None was written — the employing entity could not be read, so there was no letterhead — and Travel & Mobility Support has it. There is no offer to accept because the letter has already been asked for.";
  }

  if (row.decision === "human_review") {
    return (
      "The router could not trust its reading of this request, so nothing was decided about the trip and there is " +
      "nothing to certify. A person confirms what is being asked and the request is re-run; a letter offer here " +
      "would be offering to certify a trip nobody has established."
    );
  }

  if (row.decision === "route_to_uc04") {
    return (
      "This is a work-authorisation question, not a travel one, and UC-03 deliberately decided nothing about the " +
      "trip itself — not the destination and not the duration. A travel letter certifies business travel, so there " +
      "is nothing here it could truthfully say. The employee raises a work-authorisation request in Remote's own " +
      "Request Hub."
    );
  }

  if (row.decision === "escalate" && row.reason === "letter_scope_exceeded") {
    return (
      "A formal travel letter was already asked for on this request, and it is not the standard one — the request " +
      "asks for something the template cannot express, so nothing was drafted and Travel & Mobility Support is " +
      "writing it. There is no offer to accept: the letter has been asked for, and what is missing is a person's " +
      "words, not the employee's permission."
    );
  }

  if (row.decision === "escalate") {
    return (
      "This request was escalated rather than answered, so no gate ever cleared the trip. A letter offer would be " +
      "offering to certify travel that a specialist has not yet been able to confirm — the specialist working the " +
      "escalation is the one who decides what, if anything, can be issued."
    );
  }

  return OFFER_REFUSALS.no_offer_on_this_case.reason;
}

/** @param {keyof OFFER_REFUSALS} code */
export function refuseOffer(code, extra = {}) {
  const { status, reason } = OFFER_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
