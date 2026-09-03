// ---------------------------------------------------------------------------
// statedDates.js — is a date GROUNDED in what the requester actually wrote?
// ---------------------------------------------------------------------------
// WHY THIS IS SHARED AND NOT A PROPERTY OF ONE USE CASE (2026-08-30)
//
// UC-04 has had this rule since it was built, stated in `intakeExtractor.js`'s
// own words: "REFUSE a date whose year nobody wrote." Its header then argued
// that UC-03 did not need the same care, because "UC-03's dates feed a day
// count on a 🟢 router" while UC-04's feed the Schengen 90-in-180 hard block
// where "the year IS the answer".
//
// THAT ARGUMENT WAS TRUE WHEN IT WAS WRITTEN AND IS NOT TRUE NOW. Traced
// 2026-08-30, UC-03's `classification.startDate` reaches two further places:
//
//   1. `renderTravelLetterHtml({ startDate })` — printed as "Travel dates" on a
//      travel support letter addressed to a destination authority, issued on
//      `auto_resolve` with NO human signature (UC-03 is 🟢).
//   2. the UC-03 -> UC-04 continuation prefill, where it arrives in the form
//      the traveller is about to submit.
//
// So a year the requester never typed can be printed on a consular document
// and can seed the very Schengen arithmetic UC-04's copy of this rule exists to
// protect. Found by driving the portal: "three weeks in September" — no day, no
// year — produced `2023-09-01`/`2023-09-30`, three years in the past, from a
// model asked in its own prompt to "never invent dates".
//
// The prompt saying "never invent dates" is not a control. Prime directive #1:
// an LLM may interpret, deterministic code decides. This file is the decider,
// and it is deliberately a check on THE TEXT rather than a question to the
// model — a model that invents a date will also affirm that it did not.
//
// WHAT IT DOES NOT DO. It does not check formats, and nothing here should grow
// into that: `uc03/classifier.js` carries a standing comment explaining that
// tightening date SHAPE breaks `computeDurationDays()` without touching the
// real problem, which is provenance rather than syntax.
// ---------------------------------------------------------------------------

import { asLowerText } from "./text.js";

/**
 * A real `YYYY-MM-DD` calendar date — not merely something shaped like one.
 * `2026-02-30` matches the pattern and is not a date.
 */
export function isRealIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Every distinct four-digit year written in the text, in appearance order. */
export function yearsMentioned(text) {
  const seen = [];
  for (const m of asLowerText(text).matchAll(/\b(20\d{2})\b/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/**
 * GROUNDING CHECK — may this date be used at all?
 *
 * The year it claims must be WRITTEN IN THE REQUEST. Nothing weaker works:
 * a "is it in the past" test catches the 2023 that surfaced this and sails
 * straight past an invented 2027, because the defect is not a direction, it is
 * a component nobody stated.
 *
 * Deliberately says nothing about the day or the month. A requester who writes
 * "14 September 2026" has stated all three; one who writes "September 2026" has
 * stated a year, and the day a reader supplies from that is a narrower and more
 * visible guess than a year — it lands in an editable, labelled field, and on a
 * letter beside a date the reader can see. Refusing the year is where the line
 * pays for itself, and it is the line UC-04 already drew.
 *
 * @param {unknown} text  the requester's own words
 * @param {unknown} iso   the candidate date
 * @returns {boolean}
 */
export function isDateGroundedInText(text, iso) {
  if (!isRealIsoDate(iso)) return false;
  return yearsMentioned(text).includes(iso.slice(0, 4));
}
