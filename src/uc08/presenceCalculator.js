// ---------------------------------------------------------------------------
// presenceCalculator.js  —  Deterministic physical-presence day counting
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Cross-border tax/residency questions (the 183-day rule, dual-residency
// tie-breakers) turn on a plain fact: how many days was this person
// physically present in a given country within a given window? That's pure
// date arithmetic — no LLM anywhere near it, per docs/use-cases/UC-08.md §7
// ("Physical-presence day computation") and §6 ("must NOT... assert
// residency/withholding conclusions" — this function computes a NUMBER, it
// does not conclude anything about tax residency).
//
// `presencePeriods` is assumed already resolved from Remote's time-off/travel
// custom fields upstream (docs/use-cases/UC-08.md §3 tags this [CONFIRMED]
// generally, but doesn't specify a verified endpoint shape) — kept as
// structured input here rather than inventing an unverified fetch, the same
// simplification UC-06 makes for proposedChanges.
//
// THREE CORRECTNESS RULES THIS FILE EXISTS TO HOLD (each one was a real bug):
//
//   1. DAYS ARE A UNION, NOT A SUM. Presence periods arrive from more than one
//      upstream source (time-off records, workation custom fields), so the same
//      calendar day routinely appears twice. Adding each period's length made
//      two overlapping periods covering one year report 366 days in a 366-day
//      window — roughly double the truth, in the direction that invents a
//      183-day breach a tax specialist would then act on. Days are now merged
//      into non-overlapping intervals and each calendar day counts once.
//
//   2. AN UNPARSEABLE DATE IS NOT A DATE. `new Date("not-a-date")` is Invalid
//      Date, and every comparison against it is false — so a garbage period
//      used to silently clamp to the window boundary and contribute a
//      fabricated day count that looked exactly like a real one. Per this
//      repo's own rule ("a wrong number gets acted on while a missing one gets
//      investigated"), the result is now an explicit NOT_EVALUATED with
//      `days: null` and the offending inputs named, never a plausible number.
//
//   3. COUNTRY MATCHING IS NORMALIZED. Exact, case-sensitive, untrimmed
//      matching meant "de" or "DE " dropped every period for Germany and
//      returned 0 days — the failure direction that HIDES a 183-day breach.
//      Both sides are now trimmed and upper-cased before comparison.
//
//   4. NO RECORDS IS NOT ZERO DAYS. An empty `presencePeriods` used to produce
//      a confident "0 distinct days in GB" — an assertion about where someone
//      was, computed from nothing, rendered beside a 183-day citation. It is
//      now NOT_EVALUATED. Records that exist and do not match still count zero,
//      because that is a finding rather than an absence. See the guard below.
//
// Dates are parsed as UTC midnight, never through the local-time constructor,
// so a day count cannot shift with the server's timezone (the same trap UC-06's
// payroll cutoff pays for separately).
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "counted" | "not evaluated" — an explicit state, never an implied one. */
export const PRESENCE_COUNTED = "COUNTED";
export const PRESENCE_NOT_EVALUATED = "NOT_EVALUATED";

/**
 * Parse a "YYYY-MM-DD" (or any ISO) date to a whole UTC day index, or null.
 * Day index = days since the epoch, so interval maths is plain integers and
 * no DST/timezone offset can move a boundary by one day.
 * @param {unknown} value
 * @returns {number|null}
 */
function toDayIndex(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(`${value}`.trim());
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

/** Trim + upper-case a country code so "de", "DE " and "DE" are one country. */
function normalizeCountry(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

/**
 * Count the DISTINCT calendar days spent in one country inside one window.
 *
 * @param {object} args
 * @param {Array<{country: string, startDate: string, endDate: string}>} args.presencePeriods
 * @param {string} args.country          the jurisdiction being evaluated, e.g. "DE"
 * @param {string} args.windowStart      "YYYY-MM-DD" — start of the window being evaluated
 * @param {string} args.windowEnd        "YYYY-MM-DD" — end of the window (inclusive)
 * @returns {{days: number|null, periodsCounted: number, status: string, problems: string[]}}
 *   `status: "COUNTED"` with a number, or `status: "NOT_EVALUATED"` with
 *   `days: null` and `problems` naming every input that could not be read.
 *   Callers must render the NOT_EVALUATED case as "not computed" — never as 0.
 */
export function computePresenceDays({ presencePeriods, country, windowStart, windowEnd }) {
  const problems = [];

  const winStart = toDayIndex(windowStart);
  const winEnd = toDayIndex(windowEnd);
  if (winStart === null) problems.push(`unparseable windowStart: ${JSON.stringify(windowStart)}`);
  if (winEnd === null) problems.push(`unparseable windowEnd: ${JSON.stringify(windowEnd)}`);
  if (winStart !== null && winEnd !== null && winEnd < winStart) {
    problems.push(`window ends before it starts: ${windowStart} → ${windowEnd}`);
  }

  const target = normalizeCountry(country);
  if (target === null) problems.push(`unparseable country: ${JSON.stringify(country)}`);

  // RULE 4 — NO RECORDS IS NOT ZERO DAYS. Asked to count presence in GB with an
  // empty `presencePeriods`, this used to return `{days: 0, status: COUNTED}`,
  // and the portal rendered it as "0 distinct day(s) in GB between 2026-01-01
  // and 2026-12-31". That is a positive claim — this person was not in the UK —
  // derived from no evidence at all, printed next to a citation of the 183-day
  // rule, in a dossier whose entire purpose is to inform a tax specialist. It
  // fails in the direction that HIDES a breach, which is the same direction
  // rule 3 above exists to close.
  //
  // Note what this does NOT refuse: records that exist and simply do not match.
  // Five travel records, none of them GB, genuinely IS zero days in GB, and a
  // period that falls outside the window genuinely contributes nothing to that
  // window. Those stay a counted zero, because they are a finding. Only an
  // empty evidence base becomes NOT_EVALUATED — "we have no travel records" and
  // "the records we have show no UK presence" are different facts, and only one
  // of them is safe for a specialist to act on.
  if ((presencePeriods ?? []).length === 0) {
    problems.push("no presence records were supplied, so no days could be counted");
  }

  /** @type {Array<[number, number]>} inclusive [start, end] day-index intervals */
  const intervals = [];
  let periodsCounted = 0;

  for (const period of presencePeriods ?? []) {
    const periodCountry = normalizeCountry(period?.country);
    if (periodCountry === null) {
      // An unreadable country is not "a different country" — refusing to count
      // it silently is exactly the direction that hides a breach.
      problems.push(`unparseable period country: ${JSON.stringify(period?.country)}`);
      continue;
    }

    const start = toDayIndex(period?.startDate);
    const end = toDayIndex(period?.endDate);
    if (start === null || end === null) {
      // Reported even for another country: an unreadable record is a data
      // problem worth surfacing, and we cannot be sure whose country it is
      // when the rest of the row is malformed.
      problems.push(
        `unparseable period dates for ${periodCountry}: ${JSON.stringify(period?.startDate)} → ${JSON.stringify(period?.endDate)}`
      );
      continue;
    }
    if (end < start) {
      problems.push(`period ends before it starts for ${periodCountry}: ${period.startDate} → ${period.endDate}`);
      continue;
    }

    if (periodCountry !== target) continue;
    if (winStart === null || winEnd === null) continue; // window already unusable

    const overlapStart = Math.max(start, winStart);
    const overlapEnd = Math.min(end, winEnd);
    if (overlapStart > overlapEnd) continue; // no overlap with the window at all

    intervals.push([overlapStart, overlapEnd]);
    periodsCounted += 1;
  }

  if (problems.length > 0) {
    // Explicit absence. A tax specialist chases a blank; they act on a number.
    return { days: null, periodsCounted, status: PRESENCE_NOT_EVALUATED, problems };
  }

  // UNION, not sum: merge overlapping/adjacent-overlapping intervals so a day
  // recorded by two upstream sources is still one day.
  intervals.sort((a, b) => a[0] - b[0]);
  let days = 0;
  let curStart = null;
  let curEnd = null;
  for (const [start, end] of intervals) {
    if (curStart === null) {
      curStart = start;
      curEnd = end;
    } else if (start <= curEnd + 1) {
      // Overlapping OR directly abutting — either way the union is contiguous.
      if (end > curEnd) curEnd = end;
    } else {
      days += curEnd - curStart + 1;
      curStart = start;
      curEnd = end;
    }
  }
  if (curStart !== null) days += curEnd - curStart + 1;

  return { days, periodsCounted, status: PRESENCE_COUNTED, problems };
}
