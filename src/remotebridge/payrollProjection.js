// ---------------------------------------------------------------------------
// payrollProjection.js  —  continuing the Sandbox's payroll calendar past its
//                          last seeded cycle, and never further than that
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Remote's Sandbox ships a real, correctly-shaped payroll calendar that simply
// STOPPED. Audited live 2026-08-18 against gateway.remote-sandbox.com, all 34
// rows, five countries:
//
//   SG  last period_end 2026-06-26      CA  last period_end 2026-06-30
//   FR  last period_end 2026-06-30      NL  last period_end 2026-07-31
//   US  last period_end 2026-06-30
//
// Today is later than every one of those. So `evaluateCutoff()` asks "which
// cycle covers this effective date?", finds none, and UC-06 escalates with
// `noMatchingCycle` — correctly, every single time, for every future date.
// That is the gate working, and it is also a demo that can only ever show the
// refusal half of the use case.
//
// THE HONESTY RULE, inherited verbatim from enrichment.js and rotated one
// dimension: that module may only fill a FIELD the Sandbox left empty; this one
// may only append a PERIOD the Sandbox's calendar leaves uncovered. A real
// cycle is never modified, never reordered, never replaced, and always wins.
// Only dates after a country's last real `period_end` are eligible at all.
//
// AND THE PROJECTION IS MEASURED, NOT INVENTED. Every value below is derived
// from that country's own last real cycle — its period length, its cutoff
// offset, its payout offset, its country object. September's US cycle is
// arithmetic on real June data, not a number someone liked the look of. The
// one-line defence of this file is:
//
//     every real cycle is untouched and always wins; the projected ones
//     continue the Sandbox's own observed cadence past its last seeded month.
//
// WHAT IS DELIBERATELY NOT PROJECTED, because projecting it would be a claim
// rather than a continuation:
//
//   * `one_off` runs. A one-off is by definition not a cadence, so continuing
//     it as a monthly series would manufacture a recurrence Remote never
//     asserted. Live, NL's July rows are all one_off — those stay exactly where
//     they are, and NL's projections resume from its `main` stream. This also
//     avoids fabricating the overlapping-cutoff ambiguity that cutoffEngine.js
//     escalates on: real NL June genuinely has two cutoffs ten days apart, and
//     that ambiguity should be observed, never synthesized.
//   * `total_payroll_cost`. A future cycle has not run, so it has no cost, and
//     inventing money is the one thing this project's directives forbid outright.
//     Left null.
//   * `approval_date`. Nobody has approved a cycle that has not happened. Null.
//
// KNOWN SIMPLIFICATION, stated rather than hidden: Canada runs SEMI-monthly
// live (1->17 and 15->31 both appear). Only the stream's most recent cycle is
// continued, so CA projections carry the second-half cadence and the first half
// of each projected month stays uncovered. A CA effective date of the 5th
// therefore still reaches `noMatchingCycle`. That is a gap in demo coverage,
// not a wrong answer.
// ---------------------------------------------------------------------------

/** Marker key set on every projected row, so a row is self-identifying even
 *  when read alone, out of its response envelope, in a log or an audit payload. */
export const STANDIN_ROW_KEY = "_standin";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a UTC calendar date. Returns null on anything else —
 *  a date this cannot read is a date this must not project from. */
function parseDay(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends, which Date.UTC silently rolls forward.
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, ms };
}

function fmtDay(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Advance a (year, month) pair by `k` months. */
function addMonths(y, m, k) {
  const zero = y * 12 + (m - 1) + k;
  return { y: Math.floor(zero / 12), m: (zero % 12) + 1 };
}

/** The same calendar day in a month `k` later, clamped to that month's length
 *  so 31 January + 1 month is 28/29 February rather than rolling into March. */
function shiftDay(day, k) {
  const { y, m } = addMonths(day.y, day.m, k);
  const clamped = Math.min(day.d, lastDayOfMonth(y, m));
  return { y, m, d: clamped, ms: Date.UTC(y, m - 1, clamped) };
}

function daysBetween(aMs, bMs) {
  return Math.round((aMs - bMs) / DAY_MS);
}

/**
 * Group real cycles into per-(country, type) streams and measure each one's
 * cadence from its most recent cycle.
 *
 * @param {object[]} cycles raw rows as `GET /v1/payroll-runs` returned them
 * @returns {Map<string, object>} keyed `${alpha2}|${type}`
 */
export function measureStreams(cycles) {
  const streams = new Map();

  for (const cycle of cycles ?? []) {
    const alpha2 = cycle?.country?.alpha_2_code;
    const start = parseDay(cycle?.period_start);
    const end = parseDay(cycle?.period_end);
    // A row this cannot read is skipped for MEASUREMENT only. It still counts
    // toward the country's coverage below, because an unreadable cycle is not
    // an absent one and must not open a period up for projection.
    if (!alpha2 || !start || !end) continue;

    const type = cycle.type ?? "main";
    const key = `${alpha2}|${type}`;
    const prior = streams.get(key);
    if (!prior || start.ms > prior.start.ms) {
      streams.set(key, { alpha2, type, cycle, start, end });
    }
  }

  for (const stream of streams.values()) {
    const { cycle, start, end } = stream;
    const cutoff = parseDay(cycle.cutoff_date);
    const payout = parseDay(cycle.expected_payout_date);
    stream.cutoffOffsetDays = cutoff ? daysBetween(cutoff.ms, start.ms) : null;
    stream.payoutOffsetDays = payout ? daysBetween(payout.ms, start.ms) : null;
    // Four of the five live countries pay on the last day of the period, so
    // their payout is anchored to `period_end`, not to a day count from the
    // start. Projecting those as "+29 days" would quietly walk the payout off
    // month-end (July would pay on the 30th). SG is the counter-example that
    // makes the distinction necessary: it ends 06-26 and pays 06-22, so its
    // payout really is an offset. Measure which one this stream is.
    stream.payoutTracksPeriodEnd = Boolean(payout) && payout.ms === end.ms;
    stream.endIsMonthEnd = end.d === lastDayOfMonth(end.y, end.m);
    stream.endMonthLag = (end.y * 12 + end.m) - (start.y * 12 + start.m);
  }

  return streams;
}

/**
 * The last real `period_end` per country — the boundary past which that
 * country's calendar is empty, and the ONLY region this module may write into.
 * An unreadable `period_end` is treated as covering nothing, which is the
 * conservative direction: it can only ever shrink the projected range.
 *
 * @param {object[]} cycles
 * @returns {Map<string, number>} alpha-2 -> last period_end in ms
 */
export function coverageFrontier(cycles) {
  const frontier = new Map();
  for (const cycle of cycles ?? []) {
    const alpha2 = cycle?.country?.alpha_2_code;
    const end = parseDay(cycle?.period_end);
    if (!alpha2 || !end) continue;
    const prior = frontier.get(alpha2);
    if (prior === undefined || end.ms > prior) frontier.set(alpha2, end.ms);
  }
  return frontier;
}

/**
 * Continue each country's `main` cadence forward through the horizon.
 *
 * @param {object[]} realCycles       rows exactly as upstream returned them
 * @param {object}   [opts]
 * @param {Date|string|number} [opts.now]           defaults to the clock
 * @param {number}   [opts.horizonMonths]           how far past `now` to project
 * @returns {{projected: object[], notes: string[]}}
 */
export function projectPayrollCalendar(realCycles, { now = new Date(), horizonMonths = 12 } = {}) {
  const streams = measureStreams(realCycles);
  const frontier = coverageFrontier(realCycles);
  const projected = [];
  const notes = [];

  // A horizon of 0 means DISABLED, and it has to mean that here rather than
  // only in the caller: without this the loop below still fills the gap between
  // a country's frontier and today, so "projection off" would silently still
  // project July and August. This is the switch that makes the raw-Sandbox
  // refusal reproducible through the bridge instead of only against the
  // gateway, so it must be exact.
  if (!Number.isFinite(horizonMonths) || horizonMonths <= 0) {
    return { projected: [], notes: ["projection disabled (horizon <= 0)"] };
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(nowMs)) return { projected: [], notes: ["unreadable `now`; nothing projected"] };
  const horizonEnd = new Date(nowMs);
  const horizon = addMonths(horizonEnd.getUTCFullYear(), horizonEnd.getUTCMonth() + 1, horizonMonths);
  const horizonMs = Date.UTC(horizon.y, horizon.m - 1, lastDayOfMonth(horizon.y, horizon.m));

  for (const stream of streams.values()) {
    if (stream.type !== "main") {
      notes.push(`${stream.alpha2}: \`${stream.type}\` stream not projected (a one-off is not a cadence)`);
      continue;
    }
    if (stream.cutoffOffsetDays === null) {
      // Without a readable cutoff there is no lock to project, and a cycle with
      // no cutoff makes cutoffEngine.js fail closed anyway. Skipping keeps the
      // absence honest instead of dressing it as a cycle.
      notes.push(`${stream.alpha2}: last real cycle has no readable cutoff_date; not projected`);
      continue;
    }

    const countryFrontier = frontier.get(stream.alpha2);
    let emitted = 0;

    for (let k = 1; k <= horizonMonths + 24; k += 1) {
      const start = shiftDay(stream.start, k);
      if (start.ms > horizonMs) break;
      // THE RULE, enforced here: a projected period may not begin on or before
      // the last day the real calendar already covers for this country.
      if (countryFrontier !== undefined && start.ms <= countryFrontier) continue;

      const endBase = shiftDay(stream.end, k);
      const endDay = stream.endIsMonthEnd
        ? lastDayOfMonth(endBase.y, endBase.m)
        : endBase.d;

      const cutoffMs = start.ms + stream.cutoffOffsetDays * DAY_MS;
      const cutoff = new Date(cutoffMs);
      const payout = stream.payoutTracksPeriodEnd
        ? new Date(Date.UTC(endBase.y, endBase.m - 1, endDay))
        : stream.payoutOffsetDays === null
          ? null
          : new Date(start.ms + stream.payoutOffsetDays * DAY_MS);

      const period = `${String(start.y).padStart(4, "0")}-${String(start.m).padStart(2, "0")}`;
      projected.push({
        id: `standin-${stream.alpha2.toLowerCase()}-${period}`,
        status: "preparing",
        type: "main",
        // The country object is COPIED from the real cycle, not rebuilt — the
        // client filters on `country.alpha_2_code`, and a hand-written country
        // block is exactly the kind of invented shape this repo keeps paying for.
        country: stream.cycle.country,
        currency_code: stream.cycle.currency_code ?? null,
        period_start: fmtDay(start.y, start.m, start.d),
        period_end: fmtDay(endBase.y, endBase.m, endDay),
        cutoff_date: fmtDay(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, cutoff.getUTCDate()),
        expected_payout_date: payout
          ? fmtDay(payout.getUTCFullYear(), payout.getUTCMonth() + 1, payout.getUTCDate())
          : null,
        approval_date: null,     // nobody approved a cycle that has not run
        total_payroll_cost: null, // never invent money
        [STANDIN_ROW_KEY]: {
          projected: true,
          derivedFrom: stream.cycle.id ?? null,
          cadence: `period_start +${stream.cutoffOffsetDays}d = cutoff, measured from that country's last real cycle`,
        },
      });
      emitted += 1;
    }

    if (emitted) {
      notes.push(
        `${stream.alpha2}: ${emitted} cycle(s) projected past ${
          countryFrontier === undefined ? "an empty calendar" : new Date(countryFrontier).toISOString().slice(0, 10)
        }, continuing ${stream.cycle.period_start}->${stream.cycle.period_end} (cutoff +${stream.cutoffOffsetDays}d)`
      );
    }
  }

  projected.sort((a, b) => (a.period_start < b.period_start ? -1 : a.period_start > b.period_start ? 1 : a.id < b.id ? -1 : 1));
  return { projected, notes };
}
