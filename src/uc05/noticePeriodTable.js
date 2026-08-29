// ---------------------------------------------------------------------------
// noticePeriodTable.js  —  Statutory notice periods, country x tenure
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// UC-05's whole judgment rests on one fact: in this country, with this much
// continuous service, how many days of notice does the EMPLOYEE owe the
// EMPLOYER? That number is jurisdiction-specific, tenure-bracketed, and
// statutory — not a model call, not a guess, not something a free-text
// resignation letter is the source of. It is what this table encodes.
//
// SCOPE — DELIBERATELY NARROW (00-FOUNDATION.md §4 invariant 9)
// Remote serves 90+ countries. A portfolio project cannot prioritise by real
// per-country volume (no public data). Instead, this table covers the fixed
// 9-country list chosen for **rule-shape diversity** so every branch the
// architecture needs gets exercised at least once:
//
//   UK  — minimum tied to continuous service in months (sliding scale, not a
//         single day-threshold). Proves the system escalates rather than
//         guessing a number it doesn't have.
//   IE  — 1-week statutory minimum for 13+ weeks of service. Contractual
//         notice typically overrides (1-3 months) — we still compute the
//         statutory floor so a discrepancy against the contract can be
//         flagged.
//   DE  — 4 weeks calendar days, anchored to the 15th or end of month.
//         Statutory probation (up to 6 months) reduces to 2 weeks.
//   PL  — Labor Code Art. 36: tenure-bracketed (2w / 1m / 3m), with
//         1st-of-month anchor for monthly notices — exercises a different
//         anchor rule from DE.
//   IN  — Shops & Establishments Act varies by state. Contractual notice
//         is the binding source in practice; statutory defaults exist by
//         tenure for the rare case it is omitted. Conservative interpretation.
//   PH  — Labor Code Art. 297: 30 calendar days default; 15 days during
//         probation.
//   MX  — Federal Labor Law Art. 161: 30 calendar days default; waived
//         entirely when the employee is hired for a fixed term <= 6 months
//         (we do not model that here — we treat probation as a simple
//         "during probation" boolean from the employment record).
//   CA  — Common-law jurisdiction, 0 statutory minimum. Customary notice
//         is 1-2 weeks by tenure; we still compute a customary floor for
//         a discrepancy check, NOT a statutory one. Tagged honestly.
//   PT  — 30 calendar days (<=2y tenure) / 60 calendar days (>2y tenure);
//         15-day probation default.
//
// TWO COUNTRIES WERE ADDED 2026-08-20, AND THEY WERE ADDED FOR A DIFFERENT
// REASON FROM THE NINE ABOVE — not rule-shape diversity, but because the
// demonstrable country set (docs/DEMO-COUNTRIES.md) is NL / PT / CA / US and
// the table covered only two of the four. Both are also the first rows in this
// file whose statute this repository has actually RETRIEVED and can show you:
//
//   NL  — ONE MONTH, FLAT, regardless of tenure (BW art. 7:672 lid 4), ending
//         at the end of a calendar month (lid 1). The tenure-banded 1/2/3/4-
//         month ladder that is the first thing you see in art. 672 is the
//         EMPLOYER's obligation (lid 2) and modelling it here would report the
//         wrong party's duty as the employee's — see CONTRADICTIONS.md C-14.
//         This is also the only month-denominated row in the table; see the
//         `noticeMonths` note on NoticeBracket below for why 30 days is not a
//         safe substitute for "one month".
//   US  — NO STATUTORY MINIMUM AT ALL on the resigning employee, stated
//         positively rather than left as an absence. `noStatutoryMinimum: true`
//         is a THIRD state, distinct both from a bracket and from this
//         country not being in the table. It is NOT a zero-day notice period:
//         zero is a quantity a reader can act on and it would say the employee
//         owes nothing, which is a claim about their CONTRACT that no source
//         here supports. See CONTRADICTIONS.md C-29 and UC-05.md §7a.
//
// Anything outside this list is NOT in this table on purpose. The
// policy engine treats "country not in table" as `unsupported_country` and
// escalates — the correct behaviour per 00-FOUNDATION.md §4 invariant 9,
// which says "any country outside this list falls through to escalate-by-
// default — correct behavior per every UC that touches country rules, not
// a gap."
//
// EVERY FIGURE HERE IS A SIMPLIFICATION OF PUBLIC STATUTORY PROVISIONS.
// Nothing in this file has been verified by a labour lawyer, and the
// numbers should not be quoted to a customer. The point of building the
// table is to exercise the SYSTEM that does the calculation, not to
// produce legally binding notice periods. UC-05.md §11: "Calculation
// accuracy vs. specialist" is the metric that closes this gap.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} NoticeRule
 * @property {string} countryCode          ISO 3166-1 alpha-2
 * @property {string} countryName
 * @property {"statutory"|"customary"|"none"} basis  "statutory" = written law,
 *   "customary" = common-law convention, "none" = a sourced finding that no
 *   statutory minimum runs against the resigning employee at all. "none" is a
 *   POSITIVE claim about the law and always travels with `noStatutoryMinimum`.
 * @property {"calendar"|"working"|"none"} unit   how the days are counted
 * @property {NoticeBracket[]} brackets    EMPTY when `noStatutoryMinimum` is true —
 *   there is nothing to bracket, and an empty array is what says so
 * @property {NoticeBracket|null} probation     rules during statutory probation
 * @property {"month_15"|"month_end"|"month_1st"|"continuous"|null} anchorRule
 * @property {boolean} [noStatutoryMinimum]  true = SOURCED absence. The country
 *   IS covered by this table; what the table holds for it is the finding that no
 *   statutory notice period binds a resigning employee, so the notice owed comes
 *   from the contract — which this system does not hold and cannot read.
 *   Deliberately NOT expressible as `noticeDays: 0`: see this file's header.
 * @property {string} sourceCitation       short tag identifying the source rule
 * @property {string} [evidence]           the provenance tag from the vendored
 *   document behind the row — `[CONFIRMED]` for a statute we retrieved and can
 *   quote, `[INFERRED]` for a negative established by argument from scope.
 *   Present only on rows whose source is actually in
 *   docs/knowledge/layer-1-statutory/; its absence is itself informative.
 */

/**
 * @typedef {object} NoticeBracket
 * @property {number|null} tenureMinMonths   inclusive lower bound, null = -infinity
 * @property {number|null} tenureMaxMonths   inclusive upper bound, null = +infinity
 * @property {number|null} [noticeDays]      the period, when the statute states it in DAYS
 * @property {number|null} [noticeMonths]    the period, when the statute states it in MONTHS
 * @property {boolean} [probation]          when true, this bracket applies during probation only
 *
 * EXACTLY ONE OF `noticeDays` / `noticeMonths` IS SET, and which one is a fact
 * about the statute rather than a unit preference. BW art. 7:672(4) says "één
 * maand" and 30 days is not the same quantity: a resignation filed on the 1st of
 * a 31-day month, taken as 30 days and then snapped to the end of that month by
 * art. 672(1), lands on the 31st of the SAME month — a full month early. Adding
 * one calendar month first gives the 1st of the next month, and the anchor then
 * gives its end, which is the answer the article produces. Every other row in
 * this table states its period in days because its statute does.
 * `test/uc05NoticeCountries.test.js` pins the one-of-two invariant.
 */

/** The country table. ISO 3166-1 alpha-2 codes as keys. */
export const NOTICE_PERIOD_TABLE = {
  GB: {
    countryCode: "GB",
    countryName: "United Kingdom",
    basis: "statutory",
    unit: "calendar",
    // Employment Rights Act 1996 §86: 1 week after 1 month of service,
    // 1 additional week per full year of service up to 12 years (capped at
    // 12 weeks). Modeled here as a sliding bracket; the calculator picks
    // the matching row.
    brackets: [
      { tenureMinMonths: 1, tenureMaxMonths: 24, noticeDays: 7 },
      { tenureMinMonths: 25, tenureMaxMonths: 36, noticeDays: 14 },
      { tenureMinMonths: 37, tenureMaxMonths: 48, noticeDays: 21 },
      { tenureMinMonths: 49, tenureMaxMonths: 60, noticeDays: 28 },
      { tenureMinMonths: 61, tenureMaxMonths: 72, noticeDays: 35 },
      { tenureMinMonths: 73, tenureMaxMonths: 84, noticeDays: 42 },
      { tenureMinMonths: 85, tenureMaxMonths: 120, noticeDays: 56 },
      { tenureMinMonths: 121, tenureMaxMonths: null, noticeDays: 84 },
    ],
    probation: null,
    anchorRule: "continuous",
    sourceCitation: "Employment Rights Act 1996 §86 (sliding scale)",
  },
  IE: {
    countryCode: "IE",
    countryName: "Ireland",
    basis: "statutory",
    unit: "calendar",
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 2, noticeDays: 0 }, // <13 weeks continuous service -> no statutory notice
      { tenureMinMonths: 3, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: "continuous",
    sourceCitation: "Minimum Notice and Terms of Employment Act 1973 §4",
  },
  DE: {
    countryCode: "DE",
    countryName: "Germany",
    basis: "statutory",
    unit: "calendar",
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 28 }, // 4 weeks (§622 BGB)
    ],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 14 },
    anchorRule: "month_15",
    sourceCitation: "BGB §622 (4 weeks, 15th/end of month; 2 weeks during probation)",
  },
  PL: {
    countryCode: "PL",
    countryName: "Poland",
    basis: "statutory",
    unit: "calendar",
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 14 }, // <6 months
      { tenureMinMonths: 6, tenureMaxMonths: 35, noticeDays: 30 }, // 6 months - 3 years
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeDays: 90 }, // >3 years
    ],
    probation: null,
    // 2-week notices end on a Saturday; 1- and 3-month notices start on the
    // 1st of the following month (Kodeks Pracy art. 36 §1). We model the
    // 1st-of-month rule for the monthly/quarterly brackets and pass the
    // 2-week rule as a note on the calculator's return value.
    anchorRule: "month_1st",
    sourceCitation: "Kodeks Pracy art. 36 §1 (tenure-bracketed, 1st-of-month anchor for monthly notices)",
  },
  IN: {
    countryCode: "IN",
    countryName: "India",
    basis: "statutory",
    unit: "calendar",
    // Shops & Establishments acts are state-specific. We follow the
    // federal-default posture: a contractual notice (typically 30-90 days)
    // is the binding source; in its absence the Industrial Employment
    // (Standing Orders) defaults are: 1 day (<26 weeks), 1 week (26w-2y),
    // 2 weeks (2-5y), 4 weeks (>5y). These are "defaults" not "statutory
    // floors" — flagged in `basis: "statutory"` honestly because they are
    // enacted rules, but with a comment in the audit row that they only
    // apply when no contract notice is in place.
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 1 },
      { tenureMinMonths: 6, tenureMaxMonths: 23, noticeDays: 7 },
      { tenureMinMonths: 24, tenureMaxMonths: 59, noticeDays: 14 },
      { tenureMinMonths: 60, tenureMaxMonths: null, noticeDays: 28 },
    ],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 7 },
    anchorRule: "continuous",
    sourceCitation: "Industrial Employment (Standing Orders) defaults (apply only absent a contract notice)",
  },
  PH: {
    countryCode: "PH",
    countryName: "Philippines",
    basis: "statutory",
    unit: "calendar",
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 30 }], // Labor Code Art. 297
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 15 },
    anchorRule: "continuous",
    sourceCitation: "Labor Code of the Philippines Art. 297 (30 days, 15 days during probation)",
  },
  MX: {
    countryCode: "MX",
    countryName: "Mexico",
    basis: "statutory",
    unit: "calendar",
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 30 }], // LFT Art. 161
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 15 },
    anchorRule: "continuous",
    sourceCitation: "Ley Federal del Trabajo Art. 161 (30 days, reduced during probation)",
  },
  CA: {
    countryCode: "CA",
    countryName: "Canada",
    basis: "customary", // honest: 0 statutory minimum at common law; these are customary figures
    unit: "calendar",
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 2, noticeDays: 0 },
      { tenureMinMonths: 3, tenureMaxMonths: 35, noticeDays: 7 },
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeDays: 14 },
    ],
    probation: null,
    anchorRule: "continuous",
    sourceCitation: "Common-law customary notice (no statutory employee minimum; varies by province)",
  },
  PT: {
    countryCode: "PT",
    countryName: "Portugal",
    basis: "statutory",
    unit: "calendar",
    // BOUNDARY CORRECTED 2026-08-20 (CONTRADICTIONS.md C-18). This split at 23
    // months, so an employee at EXACTLY two years' service was told they owed
    // 60 days. Art. 400.º(1) splits on "até dois anos ou mais de dois anos" —
    // UP TO two years inclusive against MORE than two — so 24 months is 30
    // days, and the table's answer was double the statute's. It erred against
    // the employee, and it was invisible: no fixture in this repository tested
    // a tenure of exactly two years, so the code and the fixtures agreed.
    // `test/uc05NoticeCountries.test.js` now tests 23, 24 and 25 months.
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 24, noticeDays: 30 }, // up to 2 years INCLUSIVE
      { tenureMinMonths: 25, tenureMaxMonths: null, noticeDays: 60 }, // more than 2 years
    ],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 },
    anchorRule: "continuous",
    sourceCitation: "Código do Trabalho art. 400.º(1) (30 / 60 days by tenure; probation reduced)",
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19; D-02]",
  },

  // -------------------------------------------------------------------------
  // NL — the flat month, and the ladder that is NOT the employee's
  // -------------------------------------------------------------------------
  // BW art. 7:672 opens with a tenure-banded 1/2/3/4-month ladder (lid 2) and
  // that ladder is the EMPLOYER's. The employee's obligation is lid 4, and it
  // is one month regardless of tenure. A row written from "the first numbers in
  // the article" models the wrong party and reports it as the employee's duty —
  // CONTRADICTIONS.md C-14, and the same trap C-20 records this table having
  // already fallen into once for Portugal. Once is a mistake; the second time is
  // the method, which is why this row carries the warning in the code and not
  // only in the corpus.
  //
  // ONE MONTH, NOT 30 DAYS: see the `noticeMonths` note on NoticeBracket.
  // END OF MONTH, NOT +N DAYS: art. 672(1), "tegen het einde van de maand".
  //   This is the first row in the table to use `month_end`, a value that has
  //   sat in the anchorRule type union since the file was written with nothing
  //   pointing at it.
  //
  // WHAT THIS ROW DOES NOT SAY, and both are carried as caveats rather than
  // branches because neither is readable from a Remote employment record:
  //   * art. 672(8) — a written contract may EXTEND the employee's month to as
  //     much as six. The month is a statutory default, not a floor.
  //   * art. 672(5) — where the volume of work is not fixed (an on-call
  //     contract, art. 628a(9)), the notice is FOUR DAYS, or as little as 24
  //     hours under a collective agreement, and the end-of-month anchor does
  //     not apply at all. D-40, CONTRADICTIONS.md C-28. Branching on
  //     `work_hours_per_week` would be a proxy this repo invented for a
  //     statutory test, which is the UC-03 failure shape (CLAUDE.md §7).
  NL: {
    countryCode: "NL",
    countryName: "Netherlands",
    basis: "statutory",
    unit: "calendar",
    brackets: [
      // No tenure dimension AT ALL, and its absence is the finding.
      { tenureMinMonths: 0, tenureMaxMonths: null, noticeMonths: 1 },
    ],
    // The BW sets no separate probationary notice for the employee. Art. 7:676
    // governs the proeftijd and is not encoded here; a null probation entry
    // means `pickBracket()` falls through to the ordinary bracket, which is the
    // honest behaviour for "we hold no separate probation rule" — it is not an
    // assertion that none exists.
    probation: null,
    anchorRule: "month_end",
    sourceCitation: "Burgerlijk Wetboek art. 7:672 lid 4 (one month, flat) with lid 1 (end-of-month anchor)",
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19; D-01, D-40]",
  },

  // -------------------------------------------------------------------------
  // US — a sourced absence, said out loud
  // -------------------------------------------------------------------------
  // THIS IS NOT A ZERO-DAY NOTICE PERIOD AND IT IS NOT AN EMPTY ROW. It is the
  // finding that no statutory minimum notice binds a resigning employee, which
  // means the notice owed comes from the CONTRACT — a document this system does
  // not hold, cannot read, and must never imply it has checked.
  //
  // Three outcomes have to stay distinguishable downstream, and they do
  // (`statutoryMinimumExists` on the calculator's result is the field that
  // carries it — true / false / null):
  //   * not in this table          -> we hold no rule; the law may require anything
  //   * noStatutoryMinimum: true   -> sourced: no statutory minimum; read the contract
  //   * a bracket                  -> we hold a rule and it produced a date
  //
  // THE EVIDENCE IS WEAKER THAN EVERY OTHER ROW'S AND THE ROW SAYS SO. D-06 is
  // an argument from SCOPE, not a citation that states the negative: WARN
  // requires 60 days' notice FROM EMPLOYERS of 100+ on plant closings and mass
  // layoffs, which delimits the federal field without addressing what a
  // resigning employee owes. State mini-WARN statutes and contractual notice
  // are both untouched by it. That weakness is why this outcome ESCALATES
  // rather than reaching prepared_for_signoff — the argument is in UC-05.md
  // §7a and CONTRADICTIONS.md C-29.
  US: {
    countryCode: "US",
    countryName: "United States",
    basis: "none",
    unit: "none",
    noStatutoryMinimum: true,
    // EMPTY ON PURPOSE. A bracket here — of any width, with any number —
    // would be a statutory quantity, and there is not one to state.
    brackets: [],
    probation: null,
    anchorRule: null,
    sourceCitation:
      "No federal statutory minimum notice runs against a resigning employee; WARN (29 U.S.C. ch. 23) binds employers of 100+ on mass layoffs only. Notice owed is contractual, and this system does not hold the contract.",
    evidence: "[INFERRED — argument from scope; D-06, US DOL, retrieved 2026-08-19]",
  },
};

/**
 * @returns {string[]} the ISO codes the table knows about
 */
export function supportedCountryCodes() {
  return Object.keys(NOTICE_PERIOD_TABLE);
}

/**
 * True when the table's answer for this country is the SOURCED FINDING that no
 * statutory minimum notice binds a resigning employee.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INLINE `rule.noStatutoryMinimum === true`
 * AT EACH CALL SITE: it is checked in three places (the calculator, the policy
 * engine's gate ladder, and the n8n port), and the one thing that must never
 * happen is for one of them to read a missing field as false-in-a-different-
 * sense. `null` (we hold no rule at all) and `false` (we hold a rule and it has
 * brackets) both mean "not this outcome" — but they mean completely different
 * things one layer up, and keeping the coercion in one place is what stops the
 * distinction being re-derived slightly differently three times.
 *
 * @param {NoticeRule|null|undefined} rule
 * @returns {boolean}
 */
export function hasNoStatutoryMinimum(rule) {
  return Boolean(rule && rule.noStatutoryMinimum === true);
}

/**
 * Pick the statutory notice rule for a given country. The table knows only the
 * countries listed above — every other country returns null and the policy
 * engine treats that as `unsupported_country` (escalate).
 *
 * A NON-NULL RETURN IS NOT THE SAME CLAIM AS "we can compute a notice period".
 * The US row is a rule whose content is that there is no statutory period; see
 * `hasNoStatutoryMinimum()`.
 *
 * @param {string} countryCode  ISO 3166-1 alpha-2
 * @returns {NoticeRule|null}
 */
export function getNoticeRule(countryCode) {
  if (!countryCode) return null;
  return NOTICE_PERIOD_TABLE[countryCode.toUpperCase()] ?? null;
}

/**
 * Choose the bracket matching a tenure-in-months, preferring the
 * probation rule if the employee is on probation (the probation rule
 * REPLACES the regular bracket, not augments it — a statutory probation
 * period shortens notice, it does not add a second notice on top).
 *
 * Returns null for a `noStatutoryMinimum` country, because its `brackets` array
 * is empty — and the CALLER must have already branched on that, since "no
 * bracket matched this tenure" and "this country has no statutory period" are
 * different answers that this function cannot tell apart from its return value
 * alone. The calculator branches first, above the call; the null here is a
 * backstop, not the mechanism.
 *
 * @param {NoticeRule} rule
 * @param {number} tenureMonths
 * @param {boolean} [onProbation]
 * @returns {NoticeBracket|null}
 */
export function pickBracket(rule, tenureMonths, onProbation = false) {
  if (!rule) return null;
  const pool = onProbation && rule.probation ? [rule.probation] : rule.brackets;
  return pool.find((b) => {
    const min = b.tenureMinMonths ?? -Infinity;
    const max = b.tenureMaxMonths ?? Infinity;
    return tenureMonths >= min && tenureMonths <= max;
  }) ?? null;
}
