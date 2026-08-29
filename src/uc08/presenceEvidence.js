// ---------------------------------------------------------------------------
// presenceEvidence.js  —  the records a presence-day count was taken FROM
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `computePresenceDays()` answers "how many days", and it answers it very
// carefully — union not sum, explicit NOT_EVALUATED, named problems. What it
// does NOT carry is what the number is a count OF:
//
//     presenceDays: { days: 92, periodsCounted: 1, status: "COUNTED" }
//
// 92 days in which country? Between which two dates? Out of how many supplied
// records, and what happened to the ones that did not count? A Tax Operations
// specialist reading that row beside a citation of the 183-day rule has the
// figure and none of the basis for it — and "92" is exactly the kind of number
// that gets acted on. This is the C-27 pattern (P7, "said less than it knew"):
// every one of those facts was in the workflow's hand when the count was taken
// and none of them survived into the dossier.
//
// WHY IT IS A SEPARATE FUNCTION AND NOT EXTRA FIELDS ON computePresenceDays()
// Two reasons, and the second is the load-bearing one.
//   1. Separation of concerns: the calculator answers one question and has four
//      hard-won correctness rules in its header. Widening its return widens
//      what every caller must reason about.
//   2. PARITY. `workflows/nodes-uc08/buildDossier.js` carries its own copy of
//      the calculator and `test/n8nUc08Parity.test.js` compares the two returns
//      with deepEqual. Adding a field to the calculator would break that
//      comparison against a file this pass may not edit. The evidence block is
//      a NEW dossier key instead, so both copies still agree on the count while
//      the Node path additionally records what the count was taken from.
//      A row written by the n8n path simply has no `presenceEvidence`, and
//      dossierView.js says so in plain words rather than implying the basis was
//      checked and found empty.
//
// NOTHING HERE RECOMPUTES THE COUNT. The day figure always comes from
// computePresenceDays(); this module only re-walks the same inputs to say which
// record contributed what. It is pure, takes no dependency of any kind, and —
// like everything else in src/uc08/ — cannot write anywhere.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Same UTC-midnight day index the calculator uses, so the two cannot disagree. */
function toDayIndex(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(`${value}`.trim());
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

function normalizeCountry(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

/** A day index back to "YYYY-MM-DD" — used only to report the clipped range. */
function toIsoDate(dayIndex) {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The basis for a presence-day count: what it was a count of, and which of the
 * supplied records did or did not contribute.
 *
 * @param {object} args
 * @param {Array<{country?:string,startDate?:string,endDate?:string}>} [args.presencePeriods]
 * @param {string|null} args.country      the jurisdiction the count was taken in
 * @param {string|null} args.windowStart  "YYYY-MM-DD"
 * @param {string|null} args.windowEnd    "YYYY-MM-DD" (inclusive)
 * @returns {{
 *   country: string|null,
 *   windowStart: string|null,
 *   windowEnd: string|null,
 *   windowLengthDays: number|null,
 *   recordsSupplied: number,
 *   recordsCounted: number,
 *   periods: Array<object>
 * }}
 */
export function buildPresenceEvidence({ presencePeriods = [], country = null, windowStart = null, windowEnd = null } = {}) {
  const target = normalizeCountry(country);
  const winStart = toDayIndex(windowStart);
  const winEnd = toDayIndex(windowEnd);

  // A window whose ends cannot be read has no length. Reported as null, never
  // as 0 — a zero-length window reads as "we looked at nothing", which is a
  // different and much more alarming statement than "we could not read the
  // dates you gave us".
  const windowLengthDays =
    winStart !== null && winEnd !== null && winEnd >= winStart ? winEnd - winStart + 1 : null;

  const supplied = Array.isArray(presencePeriods) ? presencePeriods : [];
  const periods = supplied.map((period) => describePeriod(period, { target, winStart, winEnd }));

  return {
    country: target,
    windowStart: windowStart ?? null,
    windowEnd: windowEnd ?? null,
    windowLengthDays,
    recordsSupplied: supplied.length,
    recordsCounted: periods.filter((p) => p.counted).length,
    periods,
  };
}

/**
 * One supplied record, and what became of it. `counted: false` always carries
 * an `excludedBecause` — a record that silently vanished is exactly the defect
 * F-40 was (a half-entered stay deleted upstream, and a confident 92-day count
 * printed from what was left).
 */
function describePeriod(period, { target, winStart, winEnd }) {
  const rawCountry = period?.country ?? null;
  const periodCountry = normalizeCountry(rawCountry);
  const base = {
    country: periodCountry ?? (rawCountry === null || rawCountry === undefined ? null : String(rawCountry)),
    startDate: period?.startDate ?? null,
    endDate: period?.endDate ?? null,
    counted: false,
    countedStartDate: null,
    countedEndDate: null,
    countedDays: null,
    excludedBecause: null,
  };

  if (periodCountry === null) {
    return { ...base, excludedBecause: "the country on this record could not be read" };
  }

  const start = toDayIndex(period?.startDate);
  const end = toDayIndex(period?.endDate);
  if (start === null || end === null) {
    return { ...base, excludedBecause: "the dates on this record could not be read" };
  }
  if (end < start) {
    return { ...base, excludedBecause: "this record ends before it starts" };
  }
  if (periodCountry !== target) {
    return {
      ...base,
      excludedBecause: target
        ? `this record is for ${periodCountry}, and the count was taken in ${target}`
        : "no country was named for the count, so no record could be matched to it",
    };
  }
  if (winStart === null || winEnd === null) {
    return { ...base, excludedBecause: "the evaluated window could not be read, so no overlap could be taken" };
  }

  const overlapStart = Math.max(start, winStart);
  const overlapEnd = Math.min(end, winEnd);
  if (overlapStart > overlapEnd) {
    return { ...base, excludedBecause: "this record falls entirely outside the evaluated window" };
  }

  // The clipped range, not the record's own range: a stay running past the
  // window contributes only its overlap, and printing the record's own dates
  // beside the count would not add up.
  //
  // `countedDays` is this record's own contribution BEFORE the union is taken.
  // It is deliberately not summed anywhere: two records covering the same day
  // each report that day, and adding them is the exact double-count
  // presenceCalculator.js's rule 1 exists to prevent. It is here so a
  // specialist can see which record put which stretch of calendar into the
  // count, not so anyone can re-total it.
  return {
    ...base,
    counted: true,
    countedStartDate: toIsoDate(overlapStart),
    countedEndDate: toIsoDate(overlapEnd),
    countedDays: overlapEnd - overlapStart + 1,
  };
}
