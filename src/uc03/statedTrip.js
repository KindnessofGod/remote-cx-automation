// ---------------------------------------------------------------------------
// statedTrip.js  —  what the TRAVELLER said, beside what the MODEL read
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// `docs/TRAVEL-LETTER-INPUTS.md` §3 established the fact this module is built
// on, and it is worth stating in full because it is easy to misread as a
// smaller thing: the destination and the two travel dates the formal travel
// letter prints ALREADY come from the employee. They are not Remote's facts and
// never were. They simply arrive as prose, are read out of that prose by
// `classifyTravelInquiry()`, and are then printed on a document that — since the
// standard letter began issuing on the 🟢 path — nobody reads before the
// consulate does.
//
//   "Asking for the two dates and the destination as fields does not add a
//    question the employee is not already answering — it moves the answer off a
//    model's reading and onto the employee's own keystroke, on the one path
//    where nobody reads the document before the consulate does." (§3)
//
// So this is not new intake. It is the same three facts, taken from the person
// whose facts they are.
//
// ---------------------------------------------------------------------------
// AN OVERRIDE, NEVER A PRECONDITION — THE PROPERTY THIS WHOLE FILE IS FOR
// ---------------------------------------------------------------------------
// A stated value REPLACES the classifier's reading of that one field. An absent
// one leaves the classifier's reading exactly as it was. Nothing here can make a
// request fail that would have succeeded without it, and §6.5's table names the
// first thing to check: the archived-employee scenario must still refuse at rung
// 2 with every field filled in, because rung 2 is about the EMPLOYMENT RECORD
// and no field on any form speaks to it. If filling the fields ever changes that
// outcome, the fields have become a gate.
//
// That is also why the merge writes into the classification's own fields rather
// than adding a parallel input to `evaluate()`. Every destination gate, the
// day-count and the letter's rows all read `classification.destinationCountry` /
// `.startDate` / `.endDate`; a second channel would mean each gate choosing
// which of two sources to believe, in nine places, forever. One value per field,
// and a separate, explicit record of WHO SAID IT.
//
// ---------------------------------------------------------------------------
// A VALUE THAT IS NOT THE SHAPE IT CLAIMS IS TREATED AS ABSENT, NEVER COERCED
// ---------------------------------------------------------------------------
// The repository's standing rule (`pickAlpha2()` in src/remote/restClient.js,
// `readAnnualGrossSalary()` in src/uc03/letter.js, `computeCumulativeDays()`'s
// `problems` array in src/shared/): an unusable value yields NOTHING and says so,
// because a missing value gets investigated and a wrong one gets acted on. A
// three-letter "destination", a `"14/09/2026"`, a pair that runs backwards —
// each falls back to the classifier's reading for that field and is RECORDED in
// `problems`. Recorded, not swallowed: an input we discarded is a thing the
// person believes they told us.
//
// Nothing here validates MEANING. "Is DE two letters" is this module's question;
// "is DE a country Remote's registry knows, and may this person go there" is the
// gates' question, several rungs down, and answering it here would quietly turn
// the field into the precondition the section above forbids.
//
// PURE. No store, no clock, no network, no LLM.
// ---------------------------------------------------------------------------

import { isWellFormedCountryCode, normalizeCountryCode } from "../shared/countryCodes.js";

/**
 * The longest addressee this system will put on a letter.
 *
 * A real consular addressee is a post's name and city — "Consulate General of
 * Spain, Amsterdam" is 34 characters. The cap is generous against that and
 * small against a paste of somebody's whole visa appointment email, which is
 * the realistic failure. OVER THE CAP IS REFUSED, NOT TRUNCATED: a truncated
 * consulate name is a silent alteration of a consular document, while falling
 * back to "To Whom It May Concern" is — per `docs/TRAVEL-LETTER-INPUTS.md` §7 —
 * never wrong.
 */
export const STATED_ADDRESSEE_MAX_LENGTH = 120;

/** The fields a requester may state. Order is the order they are reported in. */
export const STATED_FIELDS = Object.freeze(["destinationCountry", "startDate", "endDate", "addressee"]);

/**
 * Where a value on the decided classification came from.
 *
 * Three values, and the third is not a tidy default: "the person did not say and
 * the model did not read one" is a different fact from either of the others, and
 * a reader who cannot see it will assume the model was asked and answered.
 */
export const PROVENANCE = Object.freeze({
  STATED: "requester_stated",
  CLASSIFIED: "classifier_read",
  ABSENT: "absent",
});

/**
 * What each provenance means to a person reading a decision. Used by
 * `describeDecisionFacts()` so the note beside a figure says who asserted it.
 */
export const PROVENANCE_NOTES = Object.freeze({
  [PROVENANCE.STATED]:
    "the employee entered this themselves on the request — it is their own statement of their trip, not a reading of their words",
  [PROVENANCE.CLASSIFIED]:
    "read out of the employee's own words rather than entered as a field, and nobody has confirmed it against a booking, an invitation or any other record",
  [PROVENANCE.ABSENT]: "neither entered on the request nor readable from what the employee wrote",
});

/**
 * Is this an ISO `YYYY-MM-DD` date that exists in the calendar?
 *
 * ONE DATE RULE FOR BOTH READERS, which is why this lives here and is imported
 * by `classifier.js` rather than written twice. The person's keystroke and the
 * model's string are checked by the same function, so "the shape we accept"
 * cannot come to mean two things depending on which of them supplied the value.
 *
 * The round-trip is what makes it a CALENDAR check and not just a pattern one:
 * `2026-02-31` matches the regex, and `new Date("2026-02-31T00:00:00Z")` rolls
 * forward to March, so comparing the round-trip back to the input rejects it.
 * `Date.parse()` alone is not enough anywhere in this file — it accepts
 * `"Sept 14 2026"` and `"09/14/2026"` happily, and the second is read in US
 * order, which is a six-month error on a consular document rather than a
 * rejection.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The addressee as it may be rendered, or null with the reason it may not.
 *
 * Exported and used at BOTH ends — the intake merge below and
 * `renderTravelLetterHtml()` — so a caller that reaches the renderer directly
 * gets the same rule as one that came through a form. Whitespace is collapsed
 * because this renders as one line; control characters are dropped because they
 * are never part of a consulate's name and are a way to make a rendered line
 * read as two.
 *
 * It does NOT escape. Escaping is the renderer's job and belongs at the moment
 * of interpolation (`src/shared/html.js`), not at intake — a value escaped here
 * would be double-escaped there and would show a consulate the string `&amp;`.
 *
 * @param {unknown} value
 * @returns {{addressee: string|null, code: string|null}}
 */
export function normaliseStatedAddressee(value) {
  if (value === null || value === undefined) return { addressee: null, code: null };
  if (typeof value !== "string") return { addressee: null, code: "addressee_not_text" };
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "") return { addressee: null, code: null };
  if (cleaned.length > STATED_ADDRESSEE_MAX_LENGTH) return { addressee: null, code: "addressee_too_long" };
  return { addressee: cleaned, code: null };
}

/** What each problem code is, in the words of somebody who has to act on it. */
const PROBLEM_DETAIL = Object.freeze({
  destination_not_alpha2:
    "The destination given with the request is not a two-letter country code, so it was not used. The country read " +
    "from the employee's own words was kept instead.",
  date_not_iso:
    "The date given with the request is not a real YYYY-MM-DD calendar date, so it was not used. The date read from " +
    "the employee's own words was kept instead.",
  stated_dates_reversed:
    "The two dates given with the request end before they begin, so neither was used. The dates read from the " +
    "employee's own words were kept instead.",
  merged_dates_reversed:
    "After combining what was entered with what was read from the request, the trip ends before it begins. No " +
    "length could be counted from that pair, so the trip's duration is unknown rather than wrong.",
  addressee_too_long: `The addressee given with the request is longer than ${STATED_ADDRESSEE_MAX_LENGTH} characters, so it was not used and the letter opens "To Whom It May Concern". It was NOT shortened — a truncated consulate name on a consular document is worse than none.`,
  addressee_not_text: "The addressee given with the request was not text, so it was not used.",
});

/** Human labels, so a problem can be shown without a slug. */
const PROBLEM_LABEL = Object.freeze({
  destinationCountry: "Destination entered on the request",
  startDate: "First day entered on the request",
  endDate: "Last day entered on the request",
  dates: "Dates entered on the request",
  addressee: "Addressee entered on the request",
});

/**
 * How much of an unusable value is echoed back.
 *
 * Some of it, because "your destination was not usable" without saying what was
 * received sends the reader to look at a form they have already left. Not all of
 * it, because this string lands in an append-only audit table and a rejected
 * input is by definition one nothing has vouched for.
 */
const ECHO_LIMIT = 60;

function echo(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > ECHO_LIMIT ? `${text.slice(0, ECHO_LIMIT)}…` : text;
}

function problem(field, code, received) {
  return {
    field,
    code,
    label: PROBLEM_LABEL[field] ?? field,
    detail: PROBLEM_DETAIL[code] ?? "This value was not the shape it claimed, so it was not used.",
    received: received === undefined || received === null ? null : echo(received),
  };
}

/** A stated alpha-2 destination, or null with a problem recorded. */
function readStatedCountry(value, problems) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  if (!isWellFormedCountryCode(value)) {
    problems.push(problem("destinationCountry", "destination_not_alpha2", value));
    return null;
  }
  return normalizeCountryCode(value);
}

/** A stated ISO date, or null with a problem recorded. */
function readStatedDate(field, value, problems) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  if (!isIsoCalendarDate(value)) {
    problems.push(problem(field, "date_not_iso", value));
    return null;
  }
  return value;
}

/**
 * Merge what the requester stated over what the classifier read.
 *
 * @param {object|null} classification  the classifier's output, untouched when
 *   there is nothing to merge
 * @param {object|null|undefined} stated  `ticket.stated` — absent, null,
 *   undefined and `{}` all mean "the requester stated nothing", and all of them
 *   return the classification byte-identical with `statedTrip: null`
 * @returns {{classification: object|null, statedTrip: {provenance: Record<string,string>,
 *   addressee: string|null, problems: Array<object>}|null}}
 */
export function mergeStatedTrip(classification, stated) {
  if (!stated || typeof stated !== "object" || Array.isArray(stated)) {
    return { classification, statedTrip: null };
  }
  const anySupplied = STATED_FIELDS.some((field) => {
    const value = stated[field];
    if (value === null || value === undefined) return false;
    return !(typeof value === "string" && value.trim() === "");
  });
  // NOTHING SUPPLIED IS NOTHING HAPPENED. Not "a merge that changed nothing" —
  // this returns the caller's own object, so a decision made without a form is
  // indistinguishable, down to the bytes, from one made before this file
  // existed. That is the property the override rule above is tested on.
  if (!anySupplied) return { classification, statedTrip: null };

  const problems = [];
  const destinationCountry = readStatedCountry(stated.destinationCountry, problems);
  let startDate = readStatedDate("startDate", stated.startDate, problems);
  let endDate = readStatedDate("endDate", stated.endDate, problems);

  // A PAIR THAT RUNS BACKWARDS DISCARDS BOTH HALVES, not the later one. Which of
  // the two is the mistake is not knowable from here — somebody who typed the
  // return date into the first box has both fields wrong in a way no rule can
  // untangle — so neither is trusted and the classifier's reading of the prose,
  // which at least came from one sentence, stands for both.
  if (startDate && endDate && endDate < startDate) {
    problems.push(problem("dates", "stated_dates_reversed", `${startDate} → ${endDate}`));
    startDate = null;
    endDate = null;
  }

  const { addressee, code: addresseeProblem } = normaliseStatedAddressee(stated.addressee);
  if (addresseeProblem) problems.push(problem("addressee", addresseeProblem, stated.addressee));

  const base = classification && typeof classification === "object" ? classification : {};
  const merged = { ...base };
  if (destinationCountry) merged.destinationCountry = destinationCountry;
  if (startDate) merged.startDate = startDate;
  if (endDate) merged.endDate = endDate;

  // ONE STATED HALF PLUS ONE READ HALF CAN STILL PRODUCE AN IMPOSSIBLE TRIP, and
  // it is recorded rather than repaired. `computeDurationDays()` returns null for
  // a reversed pair, so the gate refuses `duration_unknown` — which is the honest
  // outcome and reaches a person — but the reason alone would tell them the dates
  // were unreadable when in fact both were read and they disagree.
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) {
    problems.push(problem("dates", "merged_dates_reversed", `${merged.startDate} → ${merged.endDate}`));
  }

  const provenanceOf = (statedValue, mergedValue) =>
    statedValue ? PROVENANCE.STATED : mergedValue ? PROVENANCE.CLASSIFIED : PROVENANCE.ABSENT;

  const statedTrip = {
    provenance: {
      destinationCountry: provenanceOf(destinationCountry, merged.destinationCountry),
      startDate: provenanceOf(startDate, merged.startDate),
      endDate: provenanceOf(endDate, merged.endDate),
      // A classifier never produces an addressee — there is no such field in its
      // output schema and deliberately so (§6.3) — so this one is only ever the
      // person's or nobody's.
      addressee: addressee ? PROVENANCE.STATED : PROVENANCE.ABSENT,
    },
    addressee,
    problems,
  };

  // CARRIED ON THE CLASSIFICATION ITSELF, not only returned beside it. The
  // classification is what `cases.classification` persists and what
  // `carryClassificationForward()` copies when an employee accepts the letter
  // offer, so a provenance recorded anywhere else would be lost on exactly the
  // decision that issues the document — the one where "who said this date?" is
  // the question worth being able to answer.
  merged.statedTrip = statedTrip;

  return { classification: merged, statedTrip };
}
