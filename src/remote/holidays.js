// ---------------------------------------------------------------------------
// holidays.js  —  Remote's public-holiday calendar, and the union nobody makes
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `GET /v1/countries/{alpha3}/holidays/{year}` answers TWO DIFFERENT QUESTIONS
// depending on whether `country_subdivision_code` is present, and neither
// answer is the one a business-day calculation needs:
//
//   /v1/countries/CAN/holidays/2026                            -> 5 rows
//   /v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ON -> 4 rows
//
// and the second set is DISJOINT from the first — not a filtered view of it,
// not a superset. Live, 2026-08-19, same token, same container:
//
//   CAN national : 01-01 New Year · 04-03 Good Friday · 07-01 Canada Day ·
//                  09-07 Labour Day · 12-25 Christmas
//   CA-ON        : 02-16 Family Day · 05-18 Victoria Day ·
//                  10-12 Thanksgiving · 12-26 Boxing Day (observed 12-28)
//
// So an Ontario employee's real 2026 calendar is the UNION — **9 days**.
// Querying without the subdivision yields 5 and loses Family Day; querying
// with it yields 4 and loses Canada Day. **Neither call errors**, both return
// a plausible well-formed list, and whichever one a caller happens to make
// looks authoritative. A notice period, a payroll cutoff or an onboarding lead
// time computed from either single call is simply wrong, in a direction that
// depends on which call was made — the failure mode L1-10 named in advance:
// *"a business-day count that silently includes a public holiday produces a
// date that is simply wrong and looks right."*
//
// THE DISJOINTNESS IS NOT A CANADA QUIRK. Checked live across four more
// countries, and the subdivision response carried ONLY subdivision-additional
// days every time: ES-MD 4 (none of Spain's national 8), DE-BY 4, GB-SCT 3
// (none of the UK's national 6), CA-QC 3, CA-BC 6. Union counts therefore:
// Ontario 9, Quebec 8, British Columbia 11, Madrid 12, Scotland 9. The merge
// below still de-duplicates defensively — one overlapping row would otherwise
// be counted twice as a working day lost — but no overlap has been observed.
//
// THE UNITED STATES: THE SPLIT DOES NOT APPLY, AND THAT IS A FINDING, NOT AN
// ABSENCE OF ONE. `USA/holidays/2026` returns the 11 FEDERAL days, and every
// state probed returns **200 with zero rows** — US-CA, US-NY, US-TX. Remote
// serves no state-level holidays at all, so for a US employee the national
// call IS the whole answer. State holidays that genuinely exist (California's
// Cesar Chavez Day, for one) are simply not in Remote's data, which is a fact
// about the carrier, not about the state — a caller must not read the empty
// subdivision list as "this state has no extra days off".
//
// AN INVALID SUBDIVISION IS A 400, WHICH IS WHAT MAKES THE EMPTY LIST READABLE
// `?country_subdivision_code=CA-ZZ` and `=Ontario` both answer
// **400 `{"message":"Country Subdivision is invalid"}`** [CONFIRMED live]. So
// the two cases an earlier capture called indistinguishable are in fact
// distinguishable at the transport: a 200 with `[]` means Remote recognises
// the subdivision and serves no extra days for it, while an unrecognised code
// never reaches that branch. That is why an empty SUBDIVISION list is treated
// as a fact below, and an empty NATIONAL list is treated as a failure.
//
// WHY AN EMPTY NATIONAL LIST IS A FAILURE. `NLD/holidays/2027` answers
// **200 `{"data":[]}`** — a year Remote has not populated, four months away
// [CONFIRMED live]. No country has zero public holidays, so an empty national
// list is never a fact about the country; it is the calendar not being there
// yet. Returning it as `[]` would hand a business-day calculator a confident
// "no holidays this year" — precisely the `listPayrollRuns()` mistake
// (a 404 coerced to `{payroll_runs: []}`) rebuilt out of a 200.
//
// This module is PURE — no I/O, no client — so both execution paths can share
// it and an n8n Code node can carry a copy without importing anything.
// `src/remote/restClient.js` owns the HTTP; this owns the arithmetic.
// ---------------------------------------------------------------------------

/**
 * The date a holiday is actually taken: `observed_day` when Remote supplies
 * one, otherwise `day`.
 *
 * `observed_day` is schema-nullable while `day` is required, and null here
 * means "observed on the day itself", not "missing data" — so `??`, never a
 * truthiness test. AND THE FALLBACK IS NOT DECORATION: Ontario's Boxing Day
 * 2026 is `day: "2026-12-26"`, `observed_day: "2026-12-28"` [CONFIRMED live].
 * A calculator reading `day` would give an Ontario employee a working
 * Monday the 28th that is in fact a holiday. An earlier capture of the four
 * NATIONAL calendars found `observed_day === day` on all 40 rows and recorded
 * the fallback as unexercised; it is exercised the moment a subdivision is
 * involved, which is the only reason this is a named function.
 *
 * @param {{day?: string, observed_day?: string|null}} row
 * @returns {string|null} ISO date, or null if the row carries no usable date
 */
export function observedDate(row) {
  if (!row || typeof row !== "object") return null;
  const observed = typeof row.observed_day === "string" ? row.observed_day : null;
  const day = typeof row.day === "string" ? row.day : null;
  return observed ?? day;
}

/**
 * Merge a national holiday list with a subdivision list into the one calendar
 * that actually governs an employee, sorted by date.
 *
 * DE-DUPLICATED ON `day` + `name`, not on `day` alone. Two genuinely different
 * holidays can fall on one date (Ontario's Thanksgiving and the USA's Columbus
 * Day both sit on 2026-10-12 in Remote's own data, in different countries —
 * within one country the collision is rarer but not impossible), and merging
 * them would under-count. Conversely the same row appearing in both lists must
 * count once. Neither call has been observed to overlap the other, so this is
 * defensive rather than load-bearing — stated plainly so nobody later "fixes"
 * it into a day-keyed dedupe on the assumption that it is doing nothing.
 *
 * @param {object[]} national
 * @param {object[]} [subdivision]
 * @returns {object[]} one calendar, ascending by `day`
 */
export function mergeHolidayCalendars(national, subdivision = []) {
  const seen = new Map();
  for (const row of [...(national ?? []), ...(subdivision ?? [])]) {
    if (!row || typeof row !== "object") continue;
    const key = `${row.day ?? ""}|${row.name ?? ""}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()].sort((a, b) => String(a.day ?? "").localeCompare(String(b.day ?? "")));
}

/**
 * The distinct dates a calendar takes off work, ascending — the shape a
 * business-day counter wants, and the one place `observed_day ?? day` is
 * applied so a counter never has to know the rule.
 *
 * Distinct DATES, not rows: two holidays observed on one day cost one working
 * day, and counting them twice is the same wrong-date-that-looks-right this
 * module exists to prevent.
 *
 * @param {object[]} rows
 * @returns {string[]} unique ISO dates, ascending
 */
export function holidayDates(rows) {
  const dates = new Set();
  for (const row of rows ?? []) {
    const date = observedDate(row);
    if (date) dates.add(date);
  }
  return [...dates].sort();
}
