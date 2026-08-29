// ---------------------------------------------------------------------------
// disclosureFields.js — what a specialist may authorise onto a letter, and
//                       what each one is actually worth on this record
// ---------------------------------------------------------------------------
// WHY THIS EXISTS  (owner decision, 2026-08-28)
//
// Until today, "approve" on an over-scope UC-01 request meant *"issue the
// STANDARD letter anyway"*. The requester asked for their salary, a specialist
// pressed Approve, and the letter that went out was the same salary-free
// standard letter they would have got by clicking a button — the extra field
// was never disclosed and nothing on the screen said so plainly. Worse, the
// reviewer surface deliberately carried the field NAME and never the VALUE
// (rca-iih7 / D-16), so the specialist was asked to authorise a disclosure they
// could not see.
//
// That was a coherent design and it is now retired, because it answered the
// wrong question. Remote's own product has TWO documents, not one
// (docs/UC01-INTAKE-FIELDS.md §2/§4, from Remote's help centre):
//
//   the STANDARD letter    — instant, templated, self-service, no human
//   the CUSTOMIZED letter  — "None of these templates fits my needs", prepared
//                            by a person, delivered later
//
// So "the standard letter never states salary" and "an authorised customized
// letter may" are not in tension: they are two documents. The invariant this
// repository has always held is preserved exactly — `renderLetterHtml()` with
// no authorised fields is byte-identical to what it always produced — and the
// new behaviour lives on the other side of a human decision.
//
// THE THREE PROPERTIES THAT MAKE THIS SAFE, and each is enforced here rather
// than asked for politely:
//
//   1. NOTHING IS TYPED. Every value below is READ from the Remote record. A
//      specialist cannot correct, round or supply a figure; there is no input.
//      The letter states what Remote holds or it states nothing.
//   2. NOTHING IS INFERRED. Each reader returns null rather than a guess, and
//      an unavailable field is shown as unavailable to the specialist BEFORE
//      they decide — so "approve" can never quietly mean "issue a letter with
//      a blank where the salary was".
//   3. THE SET IS CLOSED. `AUTHORISABLE_FIELDS` is the whole universe. A
//      request naming something outside it (bank details, home address,
//      passport number, medical) is unauthorisable BY CONSTRUCTION: no code
//      path can add it, because no reader exists for it.
// ---------------------------------------------------------------------------

import { formatMoney } from "../shared/money.js";
import { readAnnualGrossSalary, readWeeklyHours, readContractEnd } from "../shared/employmentFacts.js";

/**
 * The four fields a specialist may release onto a customized letter.
 *
 * IN CONTRACT VOCABULARY (`salary`, not `compensation`) — the same words
 * `FIELD_VOCABULARY` in policyEngine.js translates the classifier's output
 * into, so a specialist reading "asked for: salary" and this list side by side
 * sees one word for one field. See that constant for why two vocabularies
 * exist and why neither side was renamed.
 *
 * CHOSEN BY THE PROJECT OWNER on 2026-08-28, and every one of them is a fact
 * Remote's own template already contemplates: article 8429306915085 lists
 * full/part time and a termination date among the standard template's
 * contents, and `job_title` is already rendered by our letter today. `salary`
 * is the only genuine addition, and it is the one that was asked for.
 */
export const AUTHORISABLE_FIELDS = Object.freeze(["salary", "job_title", "working_hours", "end_date"]);

/**
 * The reasons on which an approval is allowed to disclose anything at all.
 *
 * THIS CONSTANT EXISTS BECAUSE ITS ABSENCE WAS A REAL DEFECT, found by an
 * adversarial read of the first version and reproduced before it was fixed.
 *
 * `evaluate()` returns at the FIRST gate that fires, and three `human_review`
 * reasons sit ABOVE the over-scope gate: `third_party_request` (gate 4),
 * `artifact_present` (gate 6) and `non_standard_request` (gate 7);
 * `over_scope_request` is gate 9. All four are approvable, and the classifier
 * fills `requestedFields` regardless of which gate stopped the ladder.
 *
 * The first version gated the SIDEBAR on `reason === "over_scope_request"` and
 * gated the LETTER on nothing. So: a bank asks through the third-party door for
 * *"employment and annual gross salary"*, consent is on record, gate 4 fires.
 * The sidebar shows consent facts and no salary row — there is nothing to see
 * and nothing to weigh. The specialist approves. `requestedFields` still says
 * `compensation`, so the letter states the salary and goes out as a public
 * reply, to a third party, with the one control the whole design rests on — a
 * named human who saw the figure — never having run.
 *
 * ONE PREDICATE, BOTH SURFACES. `src/review/server.js` asks it before showing
 * values and `src/review/service.js` asks it before releasing any, so the
 * screen and the document cannot answer differently. Two conditions that must
 * agree, written twice, is exactly how they came to disagree.
 *
 * NARROW ON PURPOSE. Widening this set is not a code change, it is a decision
 * about what a specialist may release on each kind of request, and each
 * addition needs the sidebar to have something coherent to show for it first.
 */
export const DISCLOSURE_REASONS = Object.freeze(["over_scope_request"]);

/**
 * May an approval on this case disclose beyond the standard letter?
 *
 * FAILS CLOSED on anything it does not recognise — an unknown or absent reason
 * discloses nothing, which is the same direction every other unknown in this
 * module takes.
 *
 * @param {string|null|undefined} reason
 * @returns {boolean}
 */
export function approvalMayDisclose(reason) {
  return typeof reason === "string" && DISCLOSURE_REASONS.includes(reason);
}

/**
 * Fields the STANDARD letter already prints, so authorising them adds nothing.
 *
 * Exactly one today: `job_title`. `src/uc01/letter.js` has rendered it since
 * before any of this existed, while `STANDARD_LETTER_FIELDS` does not contain
 * it — a disagreement that file's own header has recorded for weeks as
 * "conservative rather than dangerous", because it costs a needless review and
 * never a disclosure.
 *
 * It stopped being harmless the moment approvals began appending rows: the
 * first customized letter rendered **Job title twice**, once from the template
 * and once from the authorisation. Deduplicating silently would have been
 * worse than the duplicate — the sidebar would offer "Job title — released if
 * approved" over a field that is released either way, which is a control that
 * does nothing pretending to be a decision.
 *
 * So the field is named here, excluded from the appended rows, and SAID
 * DIFFERENTLY on the reviewer's screen: it is already on the letter, and the
 * specialist should know their click is not what puts it there.
 *
 * ALIGNING THE TWO LISTS IS THE REAL FIX AND IT IS NOT THIS CHANGE. Remote's
 * own template does not list a job title either (article 8429306915085), so
 * dropping the row would match the product and shrink the whitelist. It also
 * means editing `workflows/nodes-uc01`'s letter body — L-16 deliberately added
 * this same row there to reach parity (`test/n8nParity.test.js`) — and
 * republishing production. Recorded rather than done by halves.
 */
const ALREADY_ON_STANDARD_LETTER = Object.freeze(["job_title"]);

/**
 * What an AUTHORISED field says when the record cannot support it.
 *
 * REPORTED 2026-08-28, from a real ticket. The requester wrote *"my contract
 * has no end date"* — asking the letter to CONFIRM that. The record carries
 * neither a `contract_end_date` nor a `contract_duration_type`, so the reader
 * returned null, the field was dropped, and the letter went out saying nothing
 * about it at all. The requester asked a question and received silence.
 *
 * DROPPING THE ROW IS THE MORE DANGEROUS OF THE TWO OPTIONS, and this is the
 * argument rather than a preference. `readContractEnd()`'s own header already
 * says why: a letter that omits the end date because it was unreadable, sitting
 * beside a letter that omits it because the contract is permanent, teaches its
 * reader that OMISSION MEANS PERMANENT. That is exactly the inference a mortgage
 * underwriter draws, and exactly the one this system must not invite. Silence is
 * not neutral on a document whose whole purpose is attestation.
 *
 * So an authorised field always gets its row, and the row says which of the
 * three things is true. The wording is deliberately not "None" and not "N/A":
 *
 *   "None — this is an indefinite contract"  the record STATES there is no end
 *   "Not recorded on the employment record"  we do not know
 *   "2028-06-26"                             we know
 *
 * "N/A" collapses the first two, which is the collapse this constant exists to
 * prevent. This is the same rule `describeEmployee()` applies on the reviewer's
 * screen — an absent field renders as a NAMED ABSENCE, never a blank, because a
 * blank is indistinguishable from a value that is genuinely empty.
 *
 * IT IS NOT A FABRICATION and it is worth being explicit about that, because
 * every other rule in this file forbids stating what the record does not hold.
 * This states that the record does not hold it, which is a fact about the
 * record and one we can vouch for completely.
 */
export const NOT_RECORDED = "Not recorded on the employment record";

/** Human labels, used on both the reviewer surface and the letter itself. */
const LABELS = Object.freeze({
  salary: "Annual gross salary",
  job_title: "Job title",
  working_hours: "Contracted hours",
  end_date: "Contract end date",
});

/**
 * One reader per authorisable field. Each returns a STRING for the letter, or
 * null when the record does not carry it.
 *
 * Deliberately a table and not a switch: adding a field means adding a reader,
 * and a field with no reader is not authorisable at all — which is property 3
 * above, enforced by the shape of this object rather than by a check somebody
 * has to remember to write.
 */
const READERS = Object.freeze({
  salary(employment) {
    const salary = readAnnualGrossSalary(employment);
    // "per year" is stated, never implied. `annual_gross_salary` is annual and
    // a bare figure on a letter invites a monthly reading — a 12× error on a
    // document that goes to a mortgage underwriter.
    return salary ? `${formatMoney(salary.minorUnits, salary.currency)} per year (gross)` : null;
  },
  job_title(employment) {
    const title = employment?.job_title;
    return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
  },
  working_hours(employment) {
    const hours = readWeeklyHours(employment);
    return hours === null ? null : `${hours} hours per week`;
  },
  end_date(employment) {
    const end = readContractEnd(employment);
    if (!end) return null;
    // The indefinite case is an ANSWER, not an absence — see readContractEnd()'s
    // own header for why collapsing the two would teach a reader that a missing
    // row means a permanent contract.
    return end.kind === "indefinite" ? "None — this is an indefinite contract" : end.date;
  },
});

/**
 * What this record can actually say about one requested field.
 *
 * @param {object|null} employment
 * @param {string} field  a field name in CONTRACT vocabulary
 * @returns {{field: string, label: string, authorisable: boolean, available: boolean, value: string|null, why: string|null}}
 */
export function readDisclosure(employment, field) {
  // `Object.hasOwn`, not `??` — F-21's pattern. `field` is caller-supplied and
  // reaches here from an LLM's `requestedFields`, so a value of "constructor"
  // or "toString" resolves through the prototype chain to a FUNCTION, which is
  // not undefined and therefore survives `??`. It leaks nothing (the
  // authorisable check below still refuses), but it would print
  // `function Object() { [native code] }` as a field label on the reviewer's
  // screen and in the durable ticket note.
  const label = Object.hasOwn(LABELS, field) ? LABELS[field] : field;
  if (!AUTHORISABLE_FIELDS.includes(field)) {
    return {
      field,
      label,
      authorisable: false,
      available: false,
      value: null,
      // NAMED, not merely refused. "Not something this system will ever put on
      // a letter" and "we could not read it from the record" are different
      // answers and lead to different next actions — the first is a redirect to
      // another channel, the second is a data problem to chase.
      why: "Not a field this system will release on a letter, whatever is decided here.",
    };
  }
  const value = READERS[field](employment);
  return {
    field,
    label,
    authorisable: true,
    alreadyOnStandardLetter: ALREADY_ON_STANDARD_LETTER.includes(field),
    available: value !== null,
    value,
    why:
      value === null
        ? `The employment record does not carry this. The letter will still carry the row, stating "${NOT_RECORDED}" — a named absence rather than a silence.`
        : null,
  };
}

/**
 * Every requested field, resolved. Order is preserved from the request, so a
 * specialist reads them in the order they were asked for.
 *
 * @param {object|null} employment
 * @param {string[]} fields
 */
export function readDisclosures(employment, fields) {
  return (Array.isArray(fields) ? fields : []).filter((f) => typeof f === "string").map((f) => readDisclosure(employment, f));
}

/**
 * The fields an approval on this case would actually put on the letter.
 *
 * THE INTERSECTION OF THREE THINGS, and every one of them can shrink it:
 * what was asked for, what this system will ever release, and what the record
 * can actually support today. Nothing else may widen it — in particular the
 * approver's `note` is never consulted, because a disclosure decided by prose
 * is a disclosure nobody can audit.
 *
 * @param {object|null} employment
 * @param {string[]} requestedFields  CONTRACT vocabulary
 * @returns {{field: string, label: string, value: string}[]}
 */
export function authorisableDisclosures(employment, requestedFields) {
  return readDisclosures(employment, requestedFields)
    .filter((d) => d.authorisable && !d.alreadyOnStandardLetter)
    .map(({ field, label, value }) => ({ field, label, value: value ?? NOT_RECORDED }));
}
