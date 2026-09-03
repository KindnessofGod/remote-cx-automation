// ---------------------------------------------------------------------------
// noticeReconciliation.js  —  Remote's `days_of_notice` against our statute
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `GET /v1/resignations/{offboarding_request_id}` publishes **`days_of_notice`**,
// described by Remote as *"The number of calendar days of notice required based
// on the contract terms and local labor laws"* — and until this file was written
// **no code in this repository read it**. `docs/use-cases/UC-05.md` §3 records
// that ("Not read by any code in this repository"), the acceptance contract
// tracks it as `[N-5]`, and `qa/SPEC-DRIFT-INDEX.md` DRIFT-095 states the cost:
// *"the comparison performed today is statute vs. what the employee asked for;
// the one that carries the risk is statute vs. what the employer is about to
// accept."*
//
// THE POINT IS THE DISAGREEMENT, NOT A BETTER NUMBER. Remote's figure is
// **blended** — contract terms AND local labour law, in one integer, with no
// field saying which of the two produced it. Ours is **statute-only** and names
// its statute. In EOR work the contractual notice is usually the LONGER of the
// two and is the binding instrument, so a system that computes a statutory floor
// and presents it as "the answer" is wrong in the ordinary case and dangerously
// wrong in the rare one — where a contract sits BELOW the floor.
//
// SO NEITHER FIGURE IS PREFERRED HERE, AND THE REFUSAL TO PREFER ONE IS THE
// PRODUCT. This module returns both figures, both provenances, and a verdict.
// It never returns "the notice period". `governing` is deliberately a small,
// closed vocabulary in which THREE of the four values are not a choice at all:
//
//   "agreed"                      the two figures are the same; there is nothing to choose
//   "remote_notice_satisfies_both"  Remote's is longer, and serving the longer
//                                 period also serves the statutory minimum — that
//                                 is arithmetic, not a ruling on which instrument
//                                 governs, and it is why this outcome does not
//                                 escalate
//   "undetermined"                the statute figure is LONGER, so no single
//                                 period satisfies both, and which instrument
//                                 governs is a question of law this system does
//                                 not answer. It escalates
//   null                          no comparison was made; see notComparedReason
//
// WHY A MONTH IS NEVER COMPARED TO A DAY COUNT. `noticePeriodTable.js`'s
// `NoticeBracket` note is categorical: a rule the statute states in MONTHS has
// no statutory day count, and 30 is not it (BW art. 7:672(4)'s "één maand",
// Kodeks pracy art. 36 § 1's "1 miesiąc"). Turning one month into 30 days here,
// purely so a subtraction can happen, would manufacture exactly the false
// precision the calculator refuses to print — and it would do it inside a
// comparison whose ONLY output is a claim that two numbers differ. So a
// month-denominated statute yields `not_compared` /
// `statute_figure_not_a_day_count`, which is a smaller answer and a true one.
//
// AN ABSENCE IS NOT AN AGREEMENT. Every non-comparison names WHICH SIDE was
// missing and why. `qa/contracts/UC-05-acceptance.md` §6: *"Never a silent
// one-sided answer presented as a comparison."*
//
// PURE. No I/O, no clock, no decision. `policyEngine.js` decides; this describes.
// ---------------------------------------------------------------------------

/** How Remote's figure is described wherever it is shown. Its blend is the point. */
export const REMOTE_PROVENANCE =
  "Remote's own resignation record (`days_of_notice`) — Remote states this is the notice required " +
  "based on the CONTRACT TERMS AND local labour law together. Remote publishes no field saying which " +
  "of the two produced it.";

/** How ours is described. The statute is named by the caller; this is the class. */
export const STATUTE_PROVENANCE =
  "This system's own statutory notice table, derived from the statute named beside it and from " +
  "length of service alone. It has read no contract.";

const isDayCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * Hold Remote's blended `days_of_notice` against the statute-derived figure.
 *
 * @param {object} args
 * @param {number|null} [args.statuteDays]      the statutory quantity IN DAYS, or null
 * @param {number|null} [args.statuteMonths]    the statutory quantity IN MONTHS, or null
 * @param {string|null} [args.statuteQuantity]  "30 days" / "1 month" — words, for prose
 * @param {string|null} [args.statuteCitation]  the statute, as the table names it
 * @param {*} [args.remoteDaysOfNotice]         whatever the resignation record carried;
 *   validated here rather than trusted, because it arrives from an API response
 * @param {string|null} [args.remoteRecordRef]  the offboarding_request_id it was read from
 * @returns {object} the reconciliation block, always — never null
 */
export function reconcileNoticeFigures({
  statuteDays = null,
  statuteMonths = null,
  statuteQuantity = null,
  statuteCitation = null,
  remoteDaysOfNotice = null,
  remoteRecordRef = null,
} = {}) {
  const remoteSide = {
    // NULL UNLESS IT IS A USABLE DAY COUNT. A string "30", a float, a negative
    // — none of them is a number of days, and coercing any of them would make
    // this function's one output (a claim that two figures differ, or agree) rest
    // on a value nobody read as written.
    daysOfNotice: isDayCount(remoteDaysOfNotice) ? remoteDaysOfNotice : null,
    provenance: REMOTE_PROVENANCE,
    recordRef: remoteRecordRef ?? null,
  };
  const statuteSide = {
    days: isDayCount(statuteDays) ? statuteDays : null,
    months: Number.isFinite(statuteMonths) ? statuteMonths : null,
    quantity: statuteQuantity ?? null,
    provenance: statuteCitation ? `${STATUTE_PROVENANCE} Statute applied: ${statuteCitation}` : STATUTE_PROVENANCE,
  };

  const notCompared = (notComparedReason, missingSide, sentence) => ({
    compared: false,
    verdict: "not_compared",
    notComparedReason,
    missingSide,
    remote: remoteSide,
    statute: statuteSide,
    differenceDays: null,
    governing: null,
    sentence,
  });

  // ORDER MATTERS AND IT IS THE ORDER OF BLAME. Our own missing figure is
  // checked first: reporting "Remote sent us nothing" while WE produced nothing
  // either would point a specialist at Remote for our gap.
  if (statuteSide.days === null && statuteSide.months === null) {
    return notCompared(
      "no_statutory_figure",
      "statute",
      "No statutory notice figure was produced, so there is nothing to hold Remote's own figure against. " +
        "This is not a finding that the two agree.",
    );
  }
  if (statuteSide.days === null) {
    return notCompared(
      "statute_figure_not_a_day_count",
      null,
      `The statute states this notice period as ${statuteSide.quantity ?? "a number of months"}, not as a number of days, ` +
        "and a month is not thirty days — so it cannot be subtracted from Remote's day count without inventing a figure " +
        "neither source states. Both figures are shown; the comparison is deliberately not made.",
    );
  }
  if (remoteDaysOfNotice === null || remoteDaysOfNotice === undefined) {
    return notCompared(
      "remote_figure_absent",
      "remote",
      "Remote's own notice figure (`days_of_notice`) was not read for this resignation, so the statutory figure " +
        "shown here stands alone. It has NOT been checked against the notice Remote and the contract between them " +
        "require, and an absence is not an agreement.",
    );
  }
  if (remoteSide.daysOfNotice === null) {
    return notCompared(
      "remote_figure_unreadable",
      "remote",
      `Remote's resignation record carried a \`days_of_notice\` value this system could not read as a number of days ` +
        `(${JSON.stringify(remoteDaysOfNotice)}), so no comparison was made. This is a failed read, not a finding that the ` +
        "two figures agree.",
    );
  }

  const differenceDays = remoteSide.daysOfNotice - statuteSide.days;
  const both = `Remote's record requires ${remoteSide.daysOfNotice} days of notice; the statute this system applied requires ${statuteSide.quantity ?? `${statuteSide.days} days`}.`;

  if (differenceDays === 0) {
    return {
      compared: true,
      verdict: "agree",
      notComparedReason: null,
      missingSide: null,
      remote: remoteSide,
      statute: statuteSide,
      differenceDays: 0,
      governing: "agreed",
      // SHOWN EVEN THOUGH THEY AGREE. An agreement the reader cannot see is not
      // evidence to them — qa/contracts/UC-05-acceptance.md §6, `[N-6]`.
      sentence: `${both} They agree, and both are shown because an agreement nobody can see is not evidence of one.`,
    };
  }
  if (differenceDays > 0) {
    return {
      compared: true,
      verdict: "remote_longer",
      notComparedReason: null,
      missingSide: null,
      remote: remoteSide,
      statute: statuteSide,
      differenceDays,
      governing: "remote_notice_satisfies_both",
      // THE CONSERVATIVE DIRECTION, and the same reasoning as
      // `later_than_statutory`: more notice than the statutory minimum breaches
      // nothing. The likely cause is a contract term above the floor, which is
      // lawful and is the ordinary case in EOR work.
      sentence:
        `${both} Remote's is ${differenceDays} days LONGER — most likely a contractual notice period above the statutory ` +
        "floor, which is lawful. Serving Remote's longer period also serves the statutory minimum, so there is nothing " +
        "here to choose between: the statutory figure is a floor, not a ceiling, and it is not the answer on its own.",
    };
  }
  return {
    compared: true,
    verdict: "statute_longer",
    notComparedReason: null,
    missingSide: null,
    remote: remoteSide,
    statute: statuteSide,
    differenceDays,
    governing: "undetermined",
    // THE CASE THIS WHOLE MODULE EXISTS FOR. Nothing else in this system would
    // notice a blended figure sitting BELOW the statutory floor, and no single
    // period satisfies both — so this is the one verdict that cannot be settled
    // by arithmetic and must not be settled here.
    sentence:
      `${both} Remote's is ${Math.abs(differenceDays)} days SHORTER than the statutory minimum this system computed. ` +
      "The two cannot both be satisfied. Which instrument governs is a question of law, and this system does not answer " +
      "it: it holds no contract, and Remote's figure does not say whether the contract or the statute produced it.",
  };
}
