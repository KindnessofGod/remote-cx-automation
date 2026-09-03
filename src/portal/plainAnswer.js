// ---------------------------------------------------------------------------
// plainAnswer.js  —  the answer to the question they asked, before the machinery
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Somebody asks "I'm travelling to Spain for a client meeting from 14 September
// to 2 October — can you confirm business travel is fine?" and gets back a
// panel that opens with a status chip and a decision string, then the gate
// ladder, then a facts table, then flags. The answer to their actual question
// is in there. It is not the first thing, and it is not in a sentence.
//
// The project owner put it plainly: "when the user asks a question, I would
// love there to be a quick answer, so that the person doesn't need to scroll
// down indefinitely and then go through a section that is 1000% not user
// friendly."
//
// So this module writes one or two sentences that go at the top of the result:
// what happened to THEIR request, in their words. The machinery stays exactly
// where it is — a specialist and an auditor both need the ladder, the facts and
// the flags — and it stays BELOW.
//
// ---------------------------------------------------------------------------
// THE THREE RULES IT IS WRITTEN AGAINST
// ---------------------------------------------------------------------------
//
// 1. IT SAYS WHAT HAPPENED TO THEM, NOT WHAT THE SYSTEM DID. "Decision:
//    auto_resolve" is a fact about our pipeline. "Yes — a trip like this to
//    Spain needs nothing further from Remote" is an answer to a person.
//
// 2. IT NEVER OVERSTATES. A `human_review` is not a yes. An escalation is not
//    a no. Where the honest answer is "somebody has to look at this", it says
//    that and it says who — and the who comes from
//    src/shared/escalationRouting.js, never from a name typed here, because a
//    hand-typed team name is exactly how `Local HR Legal` came to appear in
//    five places in src/uc05/ for a team that existed nowhere.
//
// 3. IT DOES NOT REPEAT THE SECTION BELOW IT. The paragraph directly under this
//    summary is the deciding gate's `means` — the system's account of WHY it
//    concluded what it did. This module composes from the decision CLASS, the
//    use case's own noun, the execution path and a destination, and
//    test/portalPlainAnswer.test.js pins the non-repetition by asserting no
//    summary ever contains the `means` printed beneath it.
//
//    IT NOW READS THE `reason` FOR EXACTLY TWO THINGS, AND BOTH ARE THE SAME
//    EXCEPTION, WORTH STATING RATHER THAN SLIPPING IN. The second is
//    REFUSAL_BLOCKS: a `blocked` decision is one CLASS covering outcomes whose
//    next actions are opposites — nobody can change a sanctioned destination,
//    the EMPLOYER can grant a missing workation permission, and the REQUESTER
//    can correct a field on the form themselves — and one sentence composed
//    from the class told all three that there was no next action at all. It
//    reads the reason the same way the first exception does: membership of a
//    named table, never a parse, and a reason with no row composes exactly as
//    it did before.
//
//    THE FIRST EXCEPTION, AND THE FALSE SENTENCE THAT BOUGHT IT. Earlier
//    revisions of this header said the module never touched `reason` at all.
//    That was true
//    and it produced a false sentence: an employee asked for a travel letter
//    for a visa appointment, the letter WAS written and issued to them, and
//    this module told them "a business trip like this one to Germany needs
//    nothing further from Remote" — because `all_gates_passed` (an
//    informational answer, nothing produced) and `standard_letter_issued` (a
//    document written and handed over) are the same decision CLASS. The class
//    has no shape for "an act was performed", and no amount of care in the
//    wording of a class can invent one. So the reason is consulted for
//    MEMBERSHIP OF A NAMED SET (ISSUED_ARTIFACTS and REFUSAL_BLOCKS below) and
//    for nothing else: it is never parsed, never pattern-matched, and its
//    `means` is never restated. A reason in neither set composes exactly as
//    before.
//
// ---------------------------------------------------------------------------
// WHY IT RUNS ON THE SERVER, AND WHAT THAT BUYS
// ---------------------------------------------------------------------------
// src/portal/assets/app.js re-derives no policy — it renders what it is given
// (test/portalCopy.test.js and its siblings pin this). A summary computed in
// the browser would have to compare decision strings to choose its verb, which
// is the one thing that page must never do. So the sentence is composed here
// and printed there with textContent.
//
// It also settles how a country NAME reaches the page. `countryLabel()` lives
// in src/shared/countryNames.js and a browser asset cannot import it; shipping
// a code→name map into app.js would be the second country list that module's
// own header warns about. Because the sentence is finished before it leaves the
// server, the page receives "Spain" and never learns what `ES` means. Codes
// still decide — every gate, every audit row and every payload keeps the code.
//
// THIS MODULE IS PURE AND SURFACE-AGNOSTIC: strings in, strings out, no I/O, no
// clock, no store, and nothing in it knows the portal exists. It lives under
// src/portal/ because the portal is what needed it first; the ZAF sidebar wants
// the same sentence over the same facts and can import it unchanged, or it can
// move to src/shared/ the day a second surface calls it. Either way there is
// one place the wording lives, which is the point.
//
// IT DECIDES NOTHING. If this file were deleted, every gate in the system would
// behave identically and every record would be written the same way.
// ---------------------------------------------------------------------------

import { countryLabel } from "../shared/countryNames.js";
import { handoffFor } from "../shared/escalationRouting.js";
// The FIELD names a UC-04 refusal could not read, in the words the form uses
// for them. It lives in src/uc04/ for the same reason VISA_TYPE_WORDS and
// JOB_DUTY_WORDS do — the vocabulary a UC-04 decision is explained in belongs
// with UC-04, so the sidebar and this page read one table — and it is used here
// for MEMBERSHIP only, exactly as ISSUED_ARTIFACTS below is: a flag the table
// does not name is dropped, never guessed at.
import { factorIssueWords } from "../uc04/decisionFacts.js";

/**
 * @typedef {object} PlainAnswer
 * @property {string} lead   the answer, one sentence, in the reader's words
 * @property {string|null} next  what happens now or what would change it — one
 *   sentence, and null whenever the lead already carries it or the section
 *   below would say it again
 * @property {"answered"|"waiting"|"refused"|"escalated"|"redirected"|"compiled"} shape
 *   which of the six kinds of outcome this is. Presentation only — the page
 *   uses it to pick a tone, exactly as DECISION_DOT picks a colour, and the
 *   words above never depend on the page recognising it.
 */

// ---------------------------------------------------------------------------
// THE DECISION CLASSES
// ---------------------------------------------------------------------------
// Every decision string the seven portal workflows can produce, grouped by what
// it MEANS FOR THE REQUESTER. Written out rather than pattern-matched: the
// grouping is the whole of this module's judgement and it should be readable in
// one screen.
//
//   auto_approve / auto_resolve      UC-02, UC-03 — finished, and in their favour
//   blocked                          UC-02, UC-04 — finished, and against them
//   human_review                     UC-02, UC-03 — a person was always going to look
//   ready_for_approval               UC-04
//   prepared_for_signoff             UC-05
//   off_cycle_adjustment_required    UC-09
//   route_to_uc04                    UC-03 — not answered; a different request
//   escalate                         all seven — the automation stopped
//
// The three names that appear in app.js's DECISION_DOT and nowhere in the seven
// portal workflows (`dual_approval_required`, `triple_approval_required`) are
// listed anyway: UC-06 and UC-09's approval paths use them elsewhere in this
// repository, and a decision that arrives here unlisted is treated as an
// escalation (see classify()), which is the safe direction but a worse sentence
// than the one it deserves.
const WAITING_DECISIONS = new Set([
  "human_review",
  "ready_for_approval",
  "prepared_for_signoff",
  "dual_approval_required",
  "triple_approval_required",
  "off_cycle_adjustment_required",
]);

const ANSWERED_DECISIONS = new Set(["auto_approve", "auto_resolve"]);

// ---------------------------------------------------------------------------
// THE OUTCOMES THAT ARE ALSO AN ACT
// ---------------------------------------------------------------------------
// An `answered` outcome can mean two different things to the person who filed
// the request, and only one of them is "nothing further is needed":
//
//   A CLEARANCE — every check passed and there is nothing to do. UC-03's
//                 `all_gates_passed` is this: an informational answer.
//   AN ACT      — every check passed AND something was produced and handed
//                 over. UC-03's `standard_letter_issued` is this: the formal
//                 travel letter was written, hashed, stored on the case and
//                 issued with nobody in the path.
//
// Telling the second reader the first sentence is not a shade of emphasis. The
// employee whose bug report prompted this row asked for a visa support letter,
// was told their trip "needs nothing further from Remote", and concluded — in
// their own words — that they never got the letter and that nothing had read
// their request at all. The letter existed the whole time.
//
// WHY THIS IS A TABLE AND NOT AN `if`. The next outcome of this kind will not
// be UC-03's, and a special case for one string is a special case somebody has
// to notice and copy. A row is the whole of what a new one costs.
//
// WHY THERE IS EXACTLY ONE ROW TODAY, which is the honest answer and not a
// placeholder. Across the seven portal workflows only three reasons reach the
// `answered` class at all: UC-02's `all_gates_passed` (auto_approve), UC-03's
// `all_gates_passed` and UC-03's `standard_letter_issued`. UC-02's IS an act —
// money was approved at Remote — and its own sentence has said so since it was
// written, so moving it here would change nothing and cost a sentence. The
// other two are the pair above. No category is invented here for an outcome
// that does not exist in the code.
//
// KEYED BY USE CASE AS WELL AS REASON, for the same argument the exactly-once
// ledger keys `(use_case, external_ref)`: a reason string is a name inside one
// policy engine, not a name in this repository, and two engines are free to
// reach for the same word.
const ISSUED_ARTIFACTS = Object.freeze({
  "UC-03:standard_letter_issued": {
    // What the reader asked for, in the noun they used.
    artifact: "travel letter",
    // Where it is. The letter is collectable from the result itself and from
    // "My requests" — src/uc03/letterDelivery.js decides whether this reader
    // may have it, and the surface renders the control from that verdict, so
    // this clause describes the offer rather than making one.
    handedOver: "it is ready for you to open or save",
    // WHAT NOTHING ELSE ON THE PANEL SAYS. The letter offer's own note (for
    // the case where a letter still has to be ASKED for) says a letter "is
    // issued only after a Travel & Mobility Support specialist signs it off".
    // On this outcome nobody signed anything, and a reader who has just been
    // handed a document is entitled to know it did not skip a step.
    next: "Nobody had to approve the trip or sign the letter — it was issued as soon as every check passed.",
  },
});

/** The row for this outcome, or null when the outcome produced nothing. */
function issuedArtifactFor(useCase, reason) {
  const word = typeof reason === "string" ? reason.trim() : "";
  if (!word) return null;
  return ISSUED_ARTIFACTS[`${useCase}:${word}`] ?? null;
}

// ---------------------------------------------------------------------------
// THE REFUSALS, AND THE ONE THING EACH OF THEM LEAVES THE READER TO DO
// ---------------------------------------------------------------------------
// The project owner filed a UC-04 request for Portugal and was told, in full:
//
//   "No — this request, for Portugal, was refused outright, and nothing was
//    sent to Remote."
//   "Nothing is waiting on anybody: a hard block is never put in a queue for a
//    person to overturn."
//
// His reply was three words long: "why was this refused tell the user."
//
// He is right, and the cause is structural rather than a badly written
// sentence. The `refused` branch composed from the decision CLASS alone, and
// `blocked` is one class covering outcomes whose NEXT ACTIONS are opposites:
//
//   sanctioned_region              nobody can change this, ever
//   employer_permission_not_granted  their EMPLOYER can change this
//   factors_invalid                THEY can change this, themselves, now
//
// Nothing / ask somebody / fix it yourself, collapsed into one sentence saying
// there is no next action at all. On `factors_invalid` the second sentence was
// not merely unhelpful but false as the reader would hear it: "a hard block is
// never put in a queue for a person to overturn" is true, and the fix needs
// neither a queue nor a person — it needs one corrected field.
//
// THE MECHANISM IS THE ONE ISSUED_ARTIFACTS ALREADY ESTABLISHED, and that is
// deliberate rather than convenient. The reason is read for MEMBERSHIP OF A
// NAMED SET and for nothing else: never parsed, never pattern-matched, never
// tested for a substring. A reason with no row composes exactly as it did
// before this table existed, which is what keeps UC-02's two hard blocks (and
// UC-04's `risk_matrix_blocked`, a slug the matrix cannot actually produce)
// correct without a wording anyone has driven them to check.
//
// KEYED BY USE CASE AS WELL AS REASON, for the reason ISSUED_ARTIFACTS is: a
// reason string is a name inside one policy engine, not a name in this
// repository.
//
// WHAT A ROW MAY NOT DO, in the two directions this is easy to get wrong:
//   - It may not turn a precondition into a promise. `employer_permission_not_granted`
//     says the employer sets the permission AND that setting it makes the
//     request assessable rather than approved — nothing about the destination
//     or the dates was looked at, so there is no assessment to be encouraged by.
//   - It may not soften a refusal that genuinely has no recourse.
//     `sanctioned_region` keeps saying so plainly. An encouraging vagueness
//     there would be worse than the sentence it replaced.
//   - It may not name a team. Rule 2 above: the who comes from
//     src/shared/escalationRouting.js, never from a name typed here — and on a
//     hard block the honest answer is that there is no who.
//
// `next` CARRIES THE "NOTHING WAS SENT" REASSURANCE, not the lead, and that is
// the one thing that moved. The fallback lead still ends with it; a row's lead
// ends on the REASON, because a sentence that finishes on our plumbing after
// naming four form fields reads as if the plumbing were the fifth.
const REFUSAL_BLOCKS = Object.freeze({
  // -- the three the report was about ---------------------------------------
  // ENGAGEMENT ELIGIBILITY (2026-09-03). Five classes, five different next
  // steps, because "you are not eligible" without a route onward is a dead end
  // — and in three of these four cases Remote publishes the route.
  "UC-03:engagement_not_eor_contractor": {
    because:
      "because you are engaged through Remote as an independent contractor, and Remote's travel support letter is issued for employees it is the legal employer of",
    // ONE SENTENCE. The portal allows a one-sentence lead and a one-sentence
    // follow-up, so this carries the REMEDY and nothing else — why Remote
    // cannot issue the letter is already the lead's own clause.
    next: "What usually works instead is your contract together with your invoice or payment history, which is what most consulates accept from a contractor.",
  },
  "UC-03:engagement_not_eor_direct": {
    because:
      "because Remote administers your payroll, but the company you work for is your legal employer",
    next: "The letter has to come from your own employer's HR or People team, who are the party that can attest to the employment an embassy is asking about.",
  },
  "UC-03:engagement_onboarding_incomplete": {
    because: "because your onboarding has not finished yet",
    next: "This is a wait rather than a refusal — a travel letter states your employment as an established fact, so ask again once onboarding has finished.",
  },
  "UC-03:eor_status_unknown": {
    because: "because the engagement type on the employment record could not be read",
    next: "Nothing was decided about the trip itself, and somebody needs to look at the employment record before it can be.",
  },
  "UC-03:engagement_offboarding": {
    because: "because this employment is in the process of ending",
    next: "The facts a travel letter would state are changing right now, so a person will pick this up — tell them if you have a deadline for the trip.",
  },
  "UC-04:sanctioned_region": {
    because: "because the destination is on the sanctioned or restricted list",
    next: "Nothing you or the employer can do changes this one — no approval here can grant it, no further detail will help, and nothing was sent to Remote, so there is nobody to ask and nothing to correct.",
  },
  "UC-04:employer_permission_not_granted": {
    because: "because this employee's employer has not granted them permission to work from another country",
    next: "The employer sets that permission on the employee's Remote record, and it is a precondition rather than the decision — nothing about the destination or the dates was looked at here, so setting it makes this request assessable, not approved.",
  },
  "UC-04:factors_invalid": {
    because: "because some of the details it needs could not be read",
    // The one row that names the fields, when the decision's flags carry them.
    // See factorIssueWords() in src/uc04/decisionFacts.js and the `flags`
    // argument below: a requester told "some of your details could not be read"
    // still cannot act, and one told WHICH box can.
    listsFields: true,
    next: "Nobody is reviewing it and nothing was sent to Remote — this is not a refusal a person has to overturn: complete the details the form asks for, submit it again, and it will be assessed.",
    nextWithFields: "Nobody is reviewing it and nothing was sent to Remote — this is not a refusal a person has to overturn: fill those boxes in on the form, submit it again, and it will be assessed.",
  },

  // -- the rest of UC-04's hard blocks, swept for the same defect -----------
  // Every one of these used to read "a hard block is never put in a queue for a
  // person to overturn", and on five of them the fix is a field on the form the
  // reader is already looking at.
  "UC-04:same_country_workation": {
    because: "because the destination given is the country this employee already works from, so there is no work abroad to authorise",
    next: "Nobody is reviewing it and nothing was sent to Remote — if the destination on the form was not the one meant, correct it and submit again.",
  },
  "UC-04:visitor_visa_active_work_forbidden": {
    because: "because the travel document named on it is a visitor document, which does not permit working while in the country",
    next: "No approval here can make that lawful, and nothing was sent to Remote — the trip has to be re-submitted on a document that permits work before it can be assessed at all.",
  },
  "UC-04:us_requires_work_permit": {
    because: "because working there requires a work permit and this request does not name one",
    next: "Nobody is reviewing it and nothing was sent to Remote — the request has to be re-submitted once a work permit is held, which lets it be assessed rather than granting it.",
  },
  "UC-04:ca_requires_work_permit": {
    because: "because working there requires a work permit and this request does not name one",
    next: "Nobody is reviewing it and nothing was sent to Remote — the request has to be re-submitted once a work permit is held, which lets it be assessed rather than granting it.",
  },
  "UC-04:schengen_90_180_exceeded": {
    because: "because adding this trip would take the employee past the 90 days in any 180 that the Schengen rules allow",
    next: "That limit is set by law rather than by Remote, so no approval here can grant it and there is nobody to ask — only a shorter trip, or a later one, changes the count.",
  },
  "UC-04:invalid_date": {
    because: "because at least one of the travel dates is not a real date, so nothing about the trip could be counted",
    next: "Nobody is reviewing it and nothing was sent to Remote — correct the dates on the form and submit it again.",
  },
  "UC-04:end_before_start": {
    because: "because the end date falls before the start date, so the trip as described cannot happen",
    next: "Nobody is reviewing it and nothing was sent to Remote — put the dates the right way round on the form and submit it again.",
  },
  "UC-04:start_in_past": {
    because: "because the trip starts in the past, and work authorisation is not granted retroactively",
    next: "Nobody is reviewing it and nothing was sent to Remote — if the dates were mistyped, correct them and submit again; if the trip has already happened, this form is not the way to record it.",
  },
  "UC-04:travel_history_unreadable": {
    because: "because one of the earlier stays given with it could not be read, so the day counts behind both limits could not be taken",
    next: "Nobody is reviewing it and nothing was sent to Remote — correct or remove that stay on the form and submit it again.",
  },
});

/** "a, b and c" — a list in a sentence, not a bulleted one. */
function listOf(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What this refusal was, and what follows from it — or null when no row names
 * it, in which case the caller keeps the sentence it always had.
 *
 * @param {string} useCase
 * @param {unknown} reason
 * @param {unknown} flags  the decision's flags, read for MEMBERSHIP of
 *   src/uc04/decisionFacts.js's FACTOR_ISSUE_WORDS and nothing else. Absent or
 *   unusable costs the field names and changes nothing else, which is why it is
 *   optional: the sentence is still correct and still says who can act.
 * @returns {{because:string, next:string}|null}
 */
function refusalFor(useCase, reason, flags) {
  const word = typeof reason === "string" ? reason.trim() : "";
  if (!word) return null;
  const row = REFUSAL_BLOCKS[`${useCase}:${word}`] ?? null;
  if (!row) return null;

  const fields = row.listsFields ? factorIssueWords(flags) : [];
  if (fields.length === 0) return { because: row.because, next: row.next };
  return {
    // The list sits in a dash clause so the sentence still ENDS on the reason
    // rather than trailing off into a comma list.
    because: `${row.because} — ${listOf(fields)}`,
    next: row.nextWithFields ?? row.next,
  };
}

/**
 * Which of the six shapes this outcome is.
 *
 * ORDER MATTERS, and the first check is the one that would otherwise be wrong.
 * UC-07 and UC-08 always answer `escalate`, and reading that as "a specialist
 * will now decide it" would be the single most misleading sentence this module
 * could produce: nobody decides those, here or anywhere, because
 * handleRelocationReview() and handleTaxInquiry() take no write-capable client
 * at all. The execution path is the fact, so it is consulted first.
 *
 * AN UNRECOGNISED DECISION IS AN ESCALATION, never an answer — the same
 * fail-closed direction isEscalation() takes in src/shared/escalationRouting.js,
 * and for the same reason: the cost of calling a routine outcome an escalation
 * is a sentence that reads more cautiously than it needed to, and the cost of
 * the reverse is telling somebody yes when nobody said yes.
 */
function classify(decision, executionPath) {
  if (executionPath === "none") return "compiled";
  const word = typeof decision === "string" ? decision.trim() : "";
  if (ANSWERED_DECISIONS.has(word)) return "answered";
  if (word === "blocked") return "refused";
  if (word === "route_to_uc04") return "redirected";
  if (WAITING_DECISIONS.has(word)) return "waiting";
  return "escalated";
}

// ---------------------------------------------------------------------------
// WHAT EACH USE CASE'S REQUEST IS CALLED, TO THE PERSON WHO FILED IT
// ---------------------------------------------------------------------------
// Not `recordLabel`. That is what OUR store calls the row it wrote — "Case",
// "Dossier", "Work authorization request" — and it is the right label on a
// tracking table, where a person is looking for the record. In a sentence
// answering "what happened to my request?", the noun has to be the thing they
// think they sent.
//
// `answered` and `refused` are only written where a use case can actually reach
// them: UC-02 and UC-03 can auto-resolve, UC-02 and UC-04 can hard-block, and
// no other combination exists in the seven policy engines. A missing entry is
// not a gap to fill in later — see sentenceFor(), which falls back to a plainer
// sentence built from the noun rather than inventing a specific one.
const REQUESTS = Object.freeze({
  "UC-02": { noun: "expense claim", possessive: "your expense claim" },
  "UC-03": { noun: "travel question", possessive: "your travel question" },
  "UC-04": { noun: "request to work from another country", possessive: "this request" },
  "UC-05": { noun: "resignation", possessive: "this resignation" },
  "UC-07": { noun: "relocation review", possessive: "this relocation" },
  "UC-08": { noun: "tax question", possessive: "this question" },
  "UC-09": { noun: "off-cycle payment", possessive: "this payment" },
});

/**
 * The answer, and what follows from it.
 *
 * Every argument is a field the server already publishes on the result envelope
 * — nothing here reads a store, and nothing here recomputes a verdict.
 *
 * @param {object} args
 * @param {string} args.useCase        "UC-02" … "UC-09"
 * @param {unknown} args.decision      the decision the workflow returned
 * @param {string} args.executionPath  requestTypes.js's `executionPath`
 * @param {unknown} [args.reason]      the reason slug the workflow returned.
 *   Consulted for ONE question only — did this outcome PRODUCE something (see
 *   ISSUED_ARTIFACTS) — and never for what it means. Omitting it costs the
 *   sentence about the artifact and changes nothing else, which is why it is
 *   optional: a caller that does not have one still gets a correct summary.
 * @param {unknown} [args.flags]      the decision's flags. Consulted for ONE
 *   question only — which FIELDS a `factors_invalid` refusal could not read —
 *   by membership of src/uc04/decisionFacts.js's FACTOR_ISSUE_WORDS. Never
 *   parsed, never matched by prefix, and no flag outside that table can reach a
 *   sentence. Omitting it costs the field names and changes nothing else.
 * @param {string} [args.recordLabel]  requestTypes.js's `recordLabel`
 * @param {unknown} [args.placeCode]   the ISO alpha-2 this request is ABOUT —
 *   a destination, a target jurisdiction — when the envelope carries one.
 *   A CODE, deliberately: the name is looked up here, at the point of
 *   rendering, and nowhere else (src/shared/countryNames.js's own rule).
 * @returns {PlainAnswer}
 */
export function plainAnswer({
  useCase,
  decision,
  executionPath,
  reason = null,
  flags = null,
  recordLabel = "record",
  placeCode = null,
}) {
  const shape = classify(decision, executionPath);
  const request = REQUESTS[useCase] ?? { noun: "request", possessive: "this request" };
  // null, not "not stated": an unnameable or absent code drops the clause
  // entirely rather than printing a placeholder mid-sentence.
  const place = placeCode ? withArticle(countryLabel(placeCode, null)) : null;
  // WHOSE QUEUE, from the routing table and never from a name typed here.
  // `handoffFor` picks the escalation team over the routine one when the
  // decision really is an escalation, which is a distinction UC-04 and UC-05
  // both draw and which a sentence written by hand would flatten.
  const team = handoffFor({ useCase, decision })?.group ?? null;

  // WHAT THIS OUTCOME PRODUCED, when it produced anything. Consulted only on
  // the `answered` branch; a lookup miss is the ordinary case and returns null.
  const issued = shape === "answered" ? issuedArtifactFor(useCase, reason) : null;

  // WHICH REFUSAL THIS IS, when a row names it. Resolved here rather than in
  // sentenceFor() for the same reason `issued` is: the wording branch below
  // renders what it is handed and looks nothing up, so there is one place a
  // reason is read and one place it can be read wrongly.
  const refusal = shape === "refused" ? refusalFor(useCase, reason, flags) : null;

  return { shape, ...sentenceFor({ shape, useCase, request, place, team, recordLabel, issued, refusal, flags }) };
}

/**
 * The wording, per shape.
 *
 * ONE SENTENCE EACH, AND AT MOST TWO IN TOTAL. The whole point is that a reader
 * gets their answer without scrolling; a summary that runs to a paragraph is the
 * thing it replaced, moved up the page. test/portalPlainAnswer.test.js measures
 * this over the real rendered output rather than trusting the writing.
 *
 * WHY `next` IS SO OFTEN NULL. The result panel below this summary already
 * carries "what happens now" twice — nextStep()'s old sentence used to say it
 * generically and trackingHint() says where the answer will appear. A summary
 * that said it a third time would be the defect this whole change exists to
 * fix, committed by the fix. So `next` is written only where it carries
 * something nothing else on the panel does: what a hard refusal means for the
 * request (nobody is reviewing it), what a 🔴 dossier is (nothing is being
 * decided, here or anywhere), and — on the one outcome that also carries an
 * offer — which of the two things in front of the reader the "nobody has to
 * approve it" applies to. See the UC-03 branch for that last one; it is a
 * sentence a panel did not need and a dialog does.
 */
function sentenceFor({ shape, useCase, request, place, team, recordLabel, issued = null, refusal = null, flags = null }) {
  switch (shape) {
    // -- ANSWERED: finished, and in their favour ---------------------------
    // The only two use cases that reach this are UC-02 and UC-03, and their
    // answers are genuinely different things — one is money approved, the other
    // is a question answered — so a shared sentence would be vaguer than either.
    case "answered":
      // AN ACT COMES FIRST, because "nothing further is needed" is false of
      // one. See ISSUED_ARTIFACTS: the sentence names the thing that was
      // produced, says where it is, and leaves WHY it was produced to the
      // paragraph below — the same division every other branch here keeps.
      if (issued) {
        return {
          lead: place
            ? `Yes — your ${issued.artifact} for ${place} has been written and issued, and ${issued.handedOver}.`
            : `Yes — your ${issued.artifact} has been written and issued, and ${issued.handedOver}.`,
          next: issued.next,
        };
      }
      if (useCase === "UC-02") {
        return {
          lead: "Yes — your expense claim passed every check and was approved at Remote, with nobody needing to look at it.",
          next: null,
        };
      }
      if (useCase === "UC-03") {
        return {
          // "needs nothing further from Remote" and not "you can travel", which
          // would be a claim about the destination's entry rules that this
          // system has never checked and does not hold. It is the one-sentence
          // form of the operative line in the answer UC-03 itself wrote:
          // "Short-term business travel of this kind requires no additional
          // action on the Remote platform."
          //
          // THE CLAUSE THAT BECAME A SENTENCE, and why. This lead used to end
          // "…, and nobody has to approve it." — one sentence, correct on a
          // panel. It is now also the TITLE of the dialog every result opens
          // with, and directly beneath it in that dialog sits the letter
          // recommendation, which says the letter "is issued only after a
          // Travel & Mobility Support specialist signs it off". Read a screen
          // apart those are two facts about two different things; read four
          // lines apart, "nobody has to approve it" followed by "a specialist
          // signs it off" reads as a contradiction, and the reader has to work
          // out which "it" is which. So the clause is its own sentence and it
          // names what it is about — the TRIP. The letter is a separate thing
          // to ask for and it is separately signed.
          lead: place
            ? `Yes — a business trip like this one to ${place} needs nothing further from Remote.`
            : "Yes — a business trip like this one needs nothing further from Remote.",
          next: "Nobody has to approve the trip itself.",
        };
      }
      return { lead: `Yes — ${request.possessive} was settled automatically and nobody had to look at it.`, next: null };

    // -- REFUSED: finished, and against them -------------------------------
    // The one shape where rule 1 asks for a second sentence: what is blocked,
    // and what would change it.
    //
    // THIS BRANCH USED TO ANSWER THE SECOND HALF WITH "nothing here", FOR EVERY
    // REFUSAL THERE IS. That was written against `sanctioned_region`, where it
    // is exactly right, and it was then applied to a class containing
    // `employer_permission_not_granted` (the employer can change it) and
    // `factors_invalid` (the requester can change it themselves, on the form
    // in front of them, in a minute). See REFUSAL_BLOCKS above for the report
    // that found it. A refusal whose reason is named is also the fastest way to
    // see a bug in whatever produced it: the person who filed the Portugal
    // request spent his time guessing at visa types because the sentence told
    // him only that a wall existed.
    case "refused":
      // A REASON WITH A ROW SAYS WHICH WALL IT IS AND WHO CAN MOVE IT. A reason
      // without one falls through to the sentence below, unchanged — that
      // fallback is correct wherever it is reached and it is the safe direction:
      // a refusal described in general terms is unhelpful, and a refusal
      // described wrongly is acted on.
      if (refusal) {
        return {
          lead: place
            ? `No — this request, for ${place}, was refused ${refusal.because}.`
            : `No — ${request.possessive} was refused ${refusal.because}.`,
          next: refusal.next,
        };
      }
      return {
        // NOT "<country> is blocked". That sentence was written first and it is
        // false on three of UC-04's four hard blocks: `same_country_workation`
        // refuses because home and destination match, and
        // `schengen_90_180_exceeded` refuses on a day count — Spain is not
        // blocked in either case, and telling a traveller it is would be a
        // fabricated jurisdiction finding sitting above the real reason. The
        // place is named as what the request was ABOUT and nothing more; WHY it
        // was refused is the paragraph directly below, which is where a reason
        // belongs.
        lead: place
          ? `No — this request, for ${place}, was refused outright, and nothing was sent to Remote.`
          : `No — ${request.possessive} was refused outright, and nothing was sent to Remote.`,
        next: "Nothing is waiting on anybody: a hard block is never put in a queue for a person to overturn.",
      };

    // -- WAITING: a person was always going to look ------------------------
    // The distinction from `escalated` is real and worth keeping: here the
    // automation did its job and prepared the case for the human gate that the
    // tier requires. Nothing went wrong.
    case "waiting":
      return { lead: waitingLead({ useCase, request, place, team }), next: null };

    // -- ESCALATED: the automation stopped ---------------------------------
    // Deliberately NOT "a specialist is reviewing it", which is the `waiting`
    // sentence. This one could not be judged automatically, and that is a
    // different thing to have happened to your request.
    //
    // IT NAMES THE PLACE, AND NAMES IT THE WAY THE REFUSAL ABOVE DOES: as what
    // the request was ABOUT, never as why it stopped. That distinction is the
    // whole of the wording. The escalation that prompted this clause is an
    // archived employee asking about a trip to Spain — decided at
    // `employment_status`, gate 2 of 13, which has not looked at a destination
    // and never will — so "we could not judge Spain" would be a jurisdiction
    // finding invented above the real reason, which is the defect the `refused`
    // branch already carries a paragraph about. A comma clause states the
    // subject and claims nothing.
    //
    // WITHOUT A PLACE IT IS THE SENTENCE IT ALWAYS WAS. `place` is null both
    // when the request has no country and when the router could not read one —
    // and on UC-03 the second is a real outcome (`destination_unknown`), where
    // silence is the honest answer: a summary must not name a country nothing
    // in the decision could name.
    case "escalated": {
      // D-04. This is the one escalation whose OWN classifier flagged a second
      // possibility: the text may not be about travel at all — a landlord, a
      // lease, a proof-of-employment ask (round-6 evidence). Calling it "your
      // travel question" here is the exact defect D-04 reports: an employee
      // who wrote "I'm not travelling" was told their travel question could
      // not be judged. This branch names the uncertainty honestly instead of
      // asserting a category the classifier itself is unsure of, and gives the
      // one thing the person actually needs — where the instant self-service
      // letter is, in case that is what they were asking for.
      if (Array.isArray(flags) && flags.includes("possible_non_travel_request")) {
        return {
          lead: team
            ? `Not decided here — this didn't read as a travel request, so it has gone to ${team} for a person to work out what you actually need.`
            : "Not decided here — this didn't read as a travel request, so it is with a specialist to work out what you actually need.",
          next: "If you were asking for a standard employment verification letter, you can get one instantly from the “Get your standard employment verification letter” card.",
        };
      }
      const subject = place ? `${request.possessive}, about ${place},` : request.possessive;
      return {
        lead: team
          ? `Not decided here — ${subject} could not be judged automatically, so it has gone to ${team} for a person to work through.`
          : `Not decided here — ${subject} could not be judged automatically, so it is with a specialist to work through.`,
        next: null,
      };
    }

    // -- REDIRECTED: UC-03's routing ---------------------------------------
    // NO `next`. The offer that follows this summary — promoted to a modal by
    // fef494b — is the action, and it carries its own headline and its own
    // button. A second sentence here proposing the same step would be two
    // interruptions competing to be first.
    case "redirected":
      // ANSWER THE QUESTION THEY ASKED, THEN SAY WHAT IT TAKES.
      //
      // This used to open "Not answered — this was read as working from
      // Portugal rather than travelling there, and that is a different request
      // from a business trip." Someone had asked, in plain words, "can I do my
      // normal job from there?" — and was told which of our internal categories
      // their question had landed in. Every clause of it was about US: what we
      // read, how we classify, which of our request types theirs is not.
      //
      // "Not answered" is also false as they would hear it. Something WAS
      // answered — that working from another country needs permission first —
      // and that is the single most useful thing they can be told. What is
      // undecided is whether the permission will be granted, which is a
      // different sentence and belongs in the second one.
      //
      // It must not overstate in the other direction either. This router
      // decides nothing about eligibility: some destinations are refused
      // outright at the next stage. So the first sentence states the
      // REQUIREMENT (true, and the reason a travel letter is the wrong
      // instrument), and the second states that the DECISION has not been made
      // (also true, and what stops "you need permission" being read as "you
      // have it").
      //
      // THE SPLIT IS NOT COSMETIC. A first draft of this put both sentences in
      // `lead` and set `next` to null, on the grounds that the recommendation
      // card beneath already carries the ACTION. The card does — and that is
      // not what the second sentence says. It says the DECISION has not been
      // made, which is a status, not an action, and repeats nothing.
      //
      // Two sentences in `lead` also broke this module's own invariant, which
      // the suite pins: the lead is exactly one sentence because it is the one
      // thing a hurried reader is guaranteed to read, and `next` is where the
      // qualifying sentence belongs. Writing the qualifier into the lead pushes
      // the reader past the answer to reach it — the opposite of the reason the
      // lead exists.
      return {
        lead: place
          ? `Working from ${place} needs permission before you go — a travel letter does not cover it, because you would be doing your normal job there rather than visiting.`
          : "Working from another country needs permission before you go — a travel letter does not cover it, because you would be doing your normal job there rather than visiting.",
        next: "Whether it is allowed has not been decided yet; that is what the work authorization request settles.",
      };

    // -- COMPILED: 🔴, and nothing is waiting -------------------------------
    // This carries the guarantee the result panel used to state in nextStep():
    // nobody approves this here, and on this pair nobody approves it anywhere.
    // It is the sentence that must survive every rewrite of this file.
    case "compiled":
    default: {
      const artifact = String(recordLabel || "record").toLowerCase();
      return {
        lead: place
          ? `This is not a yes or a no — a ${artifact} covering ${place} has been put together for ${team ?? "a specialist"} to read.`
          : `This is not a yes or a no — a ${artifact} has been put together for ${team ?? "a specialist"} to read.`,
        next: "Nothing approves or declines it, here or anywhere else in this system — the dossier is the outcome, and the specialist works from it.",
      };
    }
  }
}

/**
 * "Not yet — X has it", said in the terms of the thing that is waiting.
 *
 * Each of these names something the reader cannot see from the decision word:
 * that a letter exists but has not gone out, that one named specialist owns the
 * request rather than a queue, that a calculation is what is being confirmed,
 * that the money has not moved. The team name is the routing table's.
 */
function waitingLead({ useCase, request, place, team }) {
  const who = team ?? "a specialist";
  switch (useCase) {
    case "UC-02":
      return `Not yet — your expense claim is with ${who}, and a person there decides whether it is paid.`;
    case "UC-03":
      // Covers both ways UC-03 waits: a formal letter drafted and held, and a
      // request the router did not trust its own reading of. "Nothing goes out
      // until a specialist has read it" is true of both, and it is the fact a
      // person who asked for a letter most needs.
      return `Not yet — ${request.possessive} is with ${who}, and nothing goes out until a specialist has read it.`;
    case "UC-04":
      return place
        ? `Not yet — the request to work from ${place} is prepared and waiting on one specialist at ${who} to approve or decline it.`
        : `Not yet — the request is prepared and waiting on one specialist at ${who} to approve or decline it.`;
    case "UC-05":
      return `Not yet — the notice period and the payout have been worked out, and ${who} has to confirm them before anything is final.`;
    case "UC-09":
      return `Not yet — this payment is waiting on its approvals at ${who}, and no money moves until every one of them is recorded.`;
    default:
      return `Not yet — ${request.possessive} is with ${who}, and a person there decides it.`;
  }
}

/**
 * "the Netherlands", not "Netherlands".
 *
 * WHY THIS IS HERE AND NOT IN src/shared/countryNames.js. That module answers
 * "what is this country called" — a name, for a label, a table cell, a chip.
 * This is a question about a SENTENCE: several country names are grammatically
 * plural or descriptive and take a definite article when they appear after a
 * preposition, and two of this project's four demo countries are among them
 * ("work from the United States", "a dossier covering the Netherlands"). The
 * name is not what changes; the sentence around it is. So the article is added
 * by the thing writing the sentence, and `countryName()` stays a name.
 *
 * PATTERN, NOT A LIST, and the word boundaries are load-bearing: `Islands?`
 * must not match Iceland, Ireland, Finland, Greenland or Thailand, and \b is
 * what stops it. The five stems cover the forms English actually articles —
 * plurals ("the Philippines", "the Maldives", "the Comoros"), island groups
 * ("the Cayman Islands"), and the compound state names ("the United Kingdom",
 * "the Dominican Republic", "the United Arab Emirates", "the Federated States
 * of Micronesia").
 *
 * IT IS ONLY EVER COSMETIC. Nothing compares this string, nothing stores it,
 * and a name this pattern gets wrong reads slightly oddly and changes no
 * decision — which is the whole reason a heuristic is acceptable here and would
 * not be acceptable anywhere a code is chosen.
 */
function withArticle(name) {
  if (!name) return null;
  return /\b(Islands?|Republic|Emirates|Kingdom|States|Netherlands|Philippines|Bahamas|Gambia|Maldives|Comoros|Seychelles|Isle of Man)\b/.test(name)
    ? `the ${name}`
    : name;
}
