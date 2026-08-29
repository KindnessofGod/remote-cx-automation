// ---------------------------------------------------------------------------
// noticePeriodCalculator.js  —  Statutory notice end-date computation
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-05's headline artifact is a number (the statutory notice period) and a
// date (the last day the employee must work). Neither is a guess, neither
// comes from an LLM, neither is read from the resignation letter. They are
// pure functions of: the country rule, the employee's start date, and the
// current date. Same "deterministic logic over LLM" split as every other
// use case in this repo (00-FOUNDATION.md §1, invariant #1).
//
// `now` is always an explicit argument, never `new Date()` read internally —
// same discipline as uc06/cutoffEngine.js: a function that reads the system
// clock itself cannot be tested deterministically. Callers pass real
// `Date.now()` in production and a fixed timestamp in tests.
//
// ANCHOR RULES
// Different countries anchor the END of notice to different points in the
// calendar (UC-05 V2 research §Country Notices, 00-FOUNDATION.md §4
// invariant 9). Supported values:
//   "continuous"  -> endDate = startDate + N days (UK, IE, IN, PH, MX, CA, PT)
//   "month_15"    -> 15th of the month notice falls in, or end of month if
//                    it falls on the 1st-14th (DE statutory default — §622 BGB)
//   "month_1st"   -> 1st of the month following submission (NL/CZ/PL model;
//                    we apply it to PL's 1- and 3-month notices, and pass
//                    the 2-week special case back as a flag)
//   "month_end"   -> the last day of the month the raw end falls in (NL — BW
//                    art. 7:672 lid 1, "opzegging geschiedt tegen het einde van
//                    de maand"). It had been in the anchorRule type union since
//                    this file was written with nothing using it; the NL row
//                    added 2026-08-20 is what it was for.
//
// MONTH-DENOMINATED PERIODS
// A bracket states its period in `noticeDays` OR in `noticeMonths`, and which
// one is a fact about the statute, not a unit preference. Only NL is
// month-denominated today. It matters because the two are NOT interchangeable
// under a month_end anchor: a resignation filed 2026-10-01, taken as 30 days,
// ends 2026-10-31 — which IS a month end, so the anchor leaves it alone, and
// the employee is told their notice ends inside the month they resigned in.
// Adding one CALENDAR month gives 2026-11-01, whose month end is 2026-11-30 —
// the answer art. 672 actually produces. The divergence is a full month and it
// only shows up when notice is filed early in a 31-day month, which is why a
// "close enough" 30 would have passed every hand-picked fixture.
//
// WHAT THIS IS NOT
// Not the legal final word on a notice period — a labour lawyer with
// jurisdiction-specific training is. This is a structured calculation that
// produces a SPECIFIC number from a SPECIFIC table; if a customer's case is
// more complex than the table can model, the discrepancy flag (policyEngine
// .js) escalates it to HR Ops. UC-05.md §11 ("calculation accuracy vs.
// specialist") is the metric that closes the gap.
// ---------------------------------------------------------------------------

import { getNoticeRule, pickBracket, hasNoStatutoryMinimum } from "./noticePeriodTable.js";

/**
 * @typedef {object} NoticePeriodResult
 * @property {string} countryCode            ISO 3166-1 alpha-2
 * @property {"statutory"|"customary"} basis  from the rule
 * @property {"calendar"|"working"} unit     from the rule
 * @property {string} sourceCitation         from the rule
 * @property {number} tenureMonths
 * @property {boolean} onProbation
 * @property {number|null} noticeDays        days the employee owes (statutory
 *   minimum), when the statute states the period in DAYS. `null` when the rule is
 *   month-denominated (NL) or when the country has no statutory minimum at all
 *   (US) — in both cases there is no day figure to state, and inventing one is
 *   how a reader ends up acting on a number no authority published.
 * @property {string} noticeStartDate        "YYYY-MM-DD" — submission date for the
 *   purposes of the calculation (passes through unchanged in continuous mode,
 *   snapped to 1st/15th in month-anchored modes)
 * @property {string} noticeEndDate          "YYYY-MM-DD" — last day of the notice period
 * @property {string|null} proposedEndDate   "YYYY-MM-DD" — what the employee asked for, if any
 * @property {number|null} discrepancyDays   positive = proposed LATER than statutory end,
 *   negative = proposed EARLIER than statutory end, 0 = exact match, null = no
 *   comparison was possible
 * @property {"match"|"earlier_than_statutory"|"later_than_statutory"|"no_proposed_date"|"not_comparable"} discrepancy
 *   `no_proposed_date` means the employee stated NO leaving date. `not_comparable`
 *   means they stated one and we could not produce a statutory end to measure it
 *   against. Those are different facts about different people and must never
 *   share a label — see the note on NOT_COMPARABLE below.
 * @property {boolean} noticeRuleFound       true when the table had a rule for
 *   this country at all. Lets the policy engine tell "we do not cover this country"
 *   apart from "we cover it and this tenure fell outside every bracket" — two
 *   escalations that go to different desks and read very differently to a human.
 * @property {boolean|null} statutoryMinimumExists  THE THIRD STATE, and the reason
 *   this field exists rather than a second boolean beside `noticeRuleFound`:
 *     `null`  — we hold no rule for this country, so we do not know whether one
 *               exists. Honest ignorance. Pairs with `noticeRuleFound: false`.
 *     `false` — SOURCED: no statutory minimum binds a resigning employee here.
 *               A positive finding about the law, not an absence of data. What
 *               is owed comes from the contract, which this system does not hold.
 *     `true`  — a statutory period exists; either a bracket matched (and there is
 *               a `noticeEndDate`) or none did (and there is not).
 *   Collapsing `false` into `null` is exactly the defect this field was added to
 *   fix: every American resignation used to escalate as `unsupported_country`,
 *   which is a durable, false claim that the United States is outside Remote's
 *   coverage. See CONTRADICTIONS.md C-29.
 * @property {number|null} noticeMonths      the statutory period where the statute
 *   states it in months (NL). `null` on every day-denominated rule.
 * @property {string|null} noticeQuantity    the statutory quantity as words —
 *   "30 days", "1 month". THIS, not `noticeDays`, is what prose should render:
 *   a month-denominated rule has no statutory day count, and `noticeDays` is
 *   `null` for it precisely so that nothing can print a day figure the statute
 *   never stated.
 * @property {boolean} anchorAdjusted        true when month_15 / month_1st moved the end date
 *   away from a plain "+N days" result — informational, not a flag
 */

/**
 * How to label the comparison when there is no statutory end date to compare
 * against.
 *
 * WHY THIS EXISTS AT ALL — a defect found by driving the portal, not by a test.
 * Both no-result branches below used to hardcode `discrepancy: "no_proposed_date"`
 * while faithfully passing the employee's stated date through in the SAME object.
 * A Brazilian resignation stating 15 October 2026 produced, on screen and in the
 * durable `uc05_resignations.notice` column, the line:
 *
 *     PROPOSED VS. STATUTORY   2026-10-15 — no_proposed_date
 *
 * The record contradicts itself in adjacent fields, and the half a downstream
 * reader is most likely to branch on is the false half. Anything counting
 * "resignations where the employee never said when they were leaving" counted
 * this one, and the escalation team is told to chase a date that is already there.
 *
 * `no_proposed_date` is now reserved for its literal meaning. When a date WAS
 * stated and no statutory end exists, the honest answer is that the two are not
 * comparable — which is a reason to escalate, exactly as before, but for the
 * true reason.
 *
 * @param {string|null|undefined} proposedEndDate
 */
function unmeasuredDiscrepancy(proposedEndDate) {
  return proposedEndDate ? "not_comparable" : "no_proposed_date";
}

/**
 * Tenure in whole months, or `null` if the inputs cannot answer the question.
 *
 * Used only on the no-rule path, where the caller is already going to escalate.
 * The point is to record what we DO know (this person's length of service is a
 * fact about them, independent of whether we know their country's notice law)
 * without letting a bad date turn a clean, durable escalation into a throw —
 * a throw here happens BEFORE the audit write and loses the request entirely,
 * which is the F-28/F-29 failure shape this repo has paid for twice.
 *
 * @param {string|null|undefined} startDate
 * @param {string|number|Date} now
 * @returns {number|null}
 */
function safeTenureMonths(startDate, now) {
  if (!startDate) return null;
  try {
    const months = tenureMonthsBetween(startDate, toCalendarDay(now));
    // NaN, NOT just a throw. tenureMonthsBetween() builds Dates and subtracts
    // them, so an unparseable start date produces `Math.max(0, NaN)` === NaN
    // rather than an exception — a number-typed non-answer, which is the worse
    // of the two failures: it serialises to JSON as `null` (so it LOOKS like an
    // honest absence) while any arithmetic downstream silently propagates it.
    // Number.isFinite is the check that catches both NaN and ±Infinity.
    return Number.isFinite(months) ? months : null;
  } catch {
    return null;
  }
}

/** Whole months between two ISO dates, inclusive of the start month, exclusive of "now". */
export function tenureMonthsBetween(startDate, now) {
  const start = new Date(startDate);
  const ref = new Date(now);
  let months = (ref.getUTCFullYear() - start.getUTCFullYear()) * 12 + (ref.getUTCMonth() - start.getUTCMonth());
  // If the day-of-month has not yet passed in the current month, the
  // partial month hasn't fully elapsed — count one back.
  if (ref.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** YYYY-MM-DD string for a Date (UTC). */
function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD string into a Date at UTC midnight. */
function fromIsoDate(iso) {
  if (!iso) return null;
  // Accept a full ISO-8601 timestamp by taking its date part. Callers upstream
  // hand us whatever the ticket carried, and "2026-09-15T00:00:00.000Z" is a
  // correct date that this function used to reject outright — the simulator
  // crashed real resignation requests on exactly that shape. The time component
  // is deliberately discarded rather than honoured: statutory notice is counted
  // in whole calendar days, so a timestamp's hour must never be able to move a
  // legally-significant date across a day boundary.
  const text = typeof iso === "string" ? iso.trim().slice(0, 10) : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) throw new RangeError(`Invalid YYYY-MM-DD date: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const parsed = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC happily rolls 2026-02-29 into 2026-03-01 and 2026-13-45 into the
  // following year. A silently shifted date is far more dangerous here than a
  // rejected one: it would produce a confident, wrong notice-period answer that
  // reads entirely plausible. Round-tripping catches every such rollover.
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    throw new RangeError(`Invalid calendar date: ${iso}`);
  }
  return parsed;
}

/** Add N calendar days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addCalendarDays(isoDate, days) {
  const d = fromIsoDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/**
 * Add N CALENDAR months to a YYYY-MM-DD string, clamping the day-of-month to the
 * target month's last day.
 *
 * THE CLAMP IS THE WHOLE FUNCTION. `setUTCMonth(m + 1)` on 31 October produces
 * 1 December, because JavaScript rolls a day-of-month the target month does not
 * have into the following month instead of clamping it. One month after 31
 * October is 30 November — and under a `month_end` anchor the difference is not
 * one day, it is a whole extra month of notice, since 1 December's month end is
 * 31 December while 30 November's is itself. A silently rolled date here is a
 * legal date on an HR document that reads entirely plausible, which is the
 * failure mode `fromIsoDate()` above already refuses for input dates.
 *
 * @param {string} isoDate
 * @param {number} months
 * @returns {string} YYYY-MM-DD
 */
export function addCalendarMonths(isoDate, months) {
  const d = fromIsoDate(isoDate);
  const targetYear = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + months;
  // Day 0 of month N+1 is the last day of month N.
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfTarget);
  return toIsoDate(new Date(Date.UTC(targetYear, targetMonth, day)));
}

/**
 * The statutory quantity as words, for prose that must not print a day count the
 * statute never stated.
 *
 * Returns null when the bracket states neither — which the table's own
 * one-of-two invariant makes unreachable, so a null here means the table has
 * drifted rather than that the rule is unusual.
 *
 * @param {{noticeDays?:number|null, noticeMonths?:number|null}} bracket
 * @returns {string|null}
 */
function quantityText(bracket) {
  if (Number.isFinite(bracket?.noticeMonths)) {
    return `${bracket.noticeMonths} month${bracket.noticeMonths === 1 ? "" : "s"}`;
  }
  if (Number.isFinite(bracket?.noticeDays)) {
    return `${bracket.noticeDays} day${bracket.noticeDays === 1 ? "" : "s"}`;
  }
  return null;
}

/**
 * Apply a country-specific anchor rule to a calculated end date, returning
 * the post-anchor end date. The "before" date is the start of the count
 * period; the "rawEnd" is what plain "+N days" would have given.
 * @param {string} rawEnd
 * @param {"continuous"|"month_15"|"month_1st"|"month_end"|null} anchorRule
 */
export function applyAnchor(rawEnd, anchorRule) {
  if (!anchorRule || anchorRule === "continuous") return { date: rawEnd, adjusted: false };
  const d = fromIsoDate(rawEnd);
  if (anchorRule === "month_15") {
    // BGB §622: termination on the 15th or the last day of a calendar month.
    // If rawEnd falls on day 1-14, the date is moved to day 15 of the same
    // month. Day 15 itself is already a permitted termination date, so it
    // is left alone. Day 16-end is moved to the last day of the FOLLOWING
    // month. (DE probationary 2-week notice is exempt from this rule; the
    // calculator handles that special case via `rawEnd`.)
    const day = d.getUTCDate();
    if (day < 15) {
      return { date: toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15))), adjusted: true };
    }
    if (day === 15) {
      return { date: toIsoDate(d), adjusted: false };
    }
    const lastDayOfNextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
    return { date: toIsoDate(lastDayOfNextMonth), adjusted: true };
  }
  if (anchorRule === "month_1st") {
    // 1st of the month FOLLOWING the raw end.
    return { date: toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))), adjusted: true };
  }
  if (anchorRule === "month_end") {
    // BW art. 7:672 lid 1: "Opzegging geschiedt tegen het einde van de maand."
    // The last day of the month the raw end falls in — which for a raw end that
    // IS already a month end is that same date, so `adjusted` is false and the
    // reader is not told a rule moved a date it did not move.
    //
    // NOT "the month after". The one calendar month required by lid 4 has
    // already been added upstream, so the only job here is to carry the
    // resulting date forward to the month boundary lid 1 requires. Adding a
    // month here as well would double the notice period, and the two limbs read
    // similarly enough that it is an easy mistake to make in either direction.
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const date = toIsoDate(lastDay);
    return { date, adjusted: date !== rawEnd };
  }
  return { date: rawEnd, adjusted: false };
}

/**
 * Reduce any accepted "now" to a YYYY-MM-DD calendar day.
 *
 * Accepts a Date, a date-only string, or a full ISO timestamp, because callers
 * legitimately supply all three: tests pass "2026-08-16", the n8n intake passes
 * new Date().toISOString(), and the Node workflow passes a Date. Taking the
 * date part of a UTC timestamp gives the same answer as
 * `new Date(v).toISOString().slice(0, 10)` did for the Date branch, so this
 * changes no existing behaviour -- it only stops the string branch smuggling a
 * time component into date arithmetic.
 *
 * Throws on anything it cannot reduce, rather than defaulting to today: a
 * notice period silently computed from the wrong day is a legal date on an HR
 * document, and a wrong one is worse than a refused one.
 *
 * @param {string|Date|number} now
 * @returns {string} YYYY-MM-DD
 */
export function toCalendarDay(now) {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new TypeError("toCalendarDay received an invalid Date");
    return now.toISOString().slice(0, 10);
  }
  if (typeof now === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(now.trim());
    if (match) return match[1];
    throw new TypeError(`toCalendarDay could not read a date from ${JSON.stringify(now)}`);
  }
  const coerced = new Date(now);
  if (Number.isNaN(coerced.getTime())) {
    throw new TypeError(`toCalendarDay could not read a date from ${JSON.stringify(now)}`);
  }
  return coerced.toISOString().slice(0, 10);
}

/**
 * Compute the statutory notice end date and the discrepancy vs. the
 * employee's proposed last working day, if one was supplied.
 *
 * @param {object} args
 * @param {string} args.countryCode          ISO 3166-1 alpha-2 — falls through
 *   to `unsupported_country` if not in the 9-country table
 * @param {string} args.startDate            "YYYY-MM-DD" — employment start date
 * @param {string} [args.probationEndDate]   "YYYY-MM-DD" — if now < probationEndDate, the
 *   employee is treated as on probation and the probation rule (if any) applies
 * @param {string} [args.proposedEndDate]    "YYYY-MM-DD" — the employee's stated last
 *   working day; omitted when the resignation letter was unclear
 * @param {string|number|Date} args.now      submission time, explicit
 * @returns {NoticePeriodResult}
 */
export function computeNoticePeriod({ countryCode, startDate, probationEndDate, proposedEndDate, now }) {
  const rule = getNoticeRule(countryCode);
  if (!rule) {
    return {
      countryCode: (countryCode ?? "").toUpperCase(),
      basis: "unknown",
      unit: "unknown",
      // NO COUNT IN THIS STRING. It read "the 9-country statutory notice table"
      // until 2026-08-20, when the table stopped being nine countries — a
      // number baked into a sentence a human reads, in the one branch that
      // exists to say we do not cover something. Both copies of this string
      // move together or test/n8nUc05Parity.test.js goes red, which is the
      // check that the n8n port did not keep quoting the old figure.
      //
      // AND NO APOSTROPHE IN IT. The n8n copy of this string is single-quoted,
      // so "this system's table" terminated the literal there and took the
      // whole Code node body with it — every one of the 43 parity assertions
      // went red at once, which reads like a logic regression and is a quoting
      // one. The wording avoids the character rather than escaping it, because
      // the two copies must stay byte-comparable by eye.
      sourceCitation: "Country not in the statutory notice table this system holds.",
      // TENURE IS NOT ZERO JUST BECAUSE WE HAVE NO RULE.
      // This used to be a hardcoded `0`, so a Brazilian employee with five
      // years' service was recorded — durably, in the column HR Ops reads — as
      // having served 0 months. Not knowing the notice rule for a country says
      // nothing at all about how long someone has worked there, and the start
      // date needed to answer it is right here in the arguments. It is computed
      // defensively because an unparseable start date must not turn a clean
      // escalation into a throw: the country gate below is going to escalate
      // this request either way, and it should do so with a durable record.
      tenureMonths: safeTenureMonths(startDate, now),
      onProbation: false,
      // STILL 0, AND STILL WRONG — the one field in this file left as it was.
      // "We have no rule for this country" is not "this employee owes no
      // notice", and 0 is the most dangerous default a reader could act on.
      // It stays because the n8n port (workflows/nodes-uc05/noticePeriodGates.js)
      // returns 0 here too and test/n8nUc05Parity.test.js compares this exact
      // field for §12.5 — changing one copy alone turns a real cross-path
      // guard red. Both copies have to move together. Until they do, nothing
      // RENDERS the number: every consumer keys off `noticeEndDate === null`
      // (see ptoNoticeLine() in src/portal/server.js), so the 0 is inert
      // rather than displayed. Tracked in docs/BUILD-LOG.md §3.41.
      noticeDays: 0,
      noticeStartDate: null,
      noticeEndDate: null,
      proposedEndDate: proposedEndDate ?? null,
      discrepancyDays: null,
      discrepancy: unmeasuredDiscrepancy(proposedEndDate),
      noticeRuleFound: false,
      // NULL, NOT FALSE. We hold no rule for this country, so we do not know
      // whether a statutory minimum exists. `false` is reserved for the sourced
      // finding that none does (the US row) — collapsing the two is the exact
      // defect this field was added to fix. CONTRADICTIONS.md C-29.
      statutoryMinimumExists: null,
      noticeMonths: null,
      noticeQuantity: null,
      anchorAdjusted: false,
    };
  }

  // -------------------------------------------------------------------------
  // NO STATUTORY MINIMUM — a sourced finding, not a missing one
  // -------------------------------------------------------------------------
  // Branched BEFORE any tenure or bracket work, because there is nothing to
  // bracket: the country's `brackets` array is empty, and running the ordinary
  // path would land in the "no bracket matched this tenure" branch below and
  // report `no_matching_notice_bracket` — which says somebody should extend the
  // table's low end, when the truth is that the table is already complete for
  // this country and the answer lives in a contract.
  //
  // WHAT IS DELIBERATELY NOT ZERO HERE:
  //   * `noticeDays` is null, not 0. Zero is a quantity a reader can act on, and
  //     it says the employee owes no notice — a claim about their CONTRACT that
  //     no source behind this row supports. The row's whole content is that the
  //     STATUTE is silent; contractual silence is a different question nobody
  //     here has asked.
  //   * `tenureMonths` is the real figure. Length of service is a fact about the
  //     person and does not stop being knowable because their country sets no
  //     statutory notice — the same point the unsupported-country branch above
  //     had to be corrected on once already.
  //   * `noticeEndDate` is null, and the discrepancy is `not_comparable` rather
  //     than `match` whenever a date was proposed. There is no statutory end to
  //     measure a proposed leaving date against, so the honest answer is that
  //     the two are not comparable — NEVER that they agree.
  if (hasNoStatutoryMinimum(rule)) {
    return {
      countryCode: rule.countryCode,
      basis: rule.basis,
      unit: rule.unit,
      sourceCitation: rule.sourceCitation,
      tenureMonths: safeTenureMonths(startDate, now),
      onProbation: false,
      noticeDays: null,
      noticeStartDate: null,
      noticeEndDate: null,
      proposedEndDate: proposedEndDate ?? null,
      discrepancyDays: null,
      discrepancy: unmeasuredDiscrepancy(proposedEndDate),
      // TRUE — the table DOES hold a rule for this country. What it holds is the
      // finding that no statutory period exists. Reporting `false` here would
      // put this case back on the `unsupported_country` path it was added to get
      // it off.
      noticeRuleFound: true,
      statutoryMinimumExists: false,
      noticeMonths: null,
      noticeQuantity: null,
      anchorAdjusted: false,
    };
  }

  // NORMALISE `now` TO A CALENDAR DAY BEFORE ANY ARITHMETIC.
  //
  // This used to be `typeof now === "string" ? now : ...`, which passed a
  // string straight through. That is fine for a test fixture supplying
  // "2026-08-16", and wrong for the real intake: the n8n Normalize node sets
  // `now: new Date().toISOString()`, a FULL timestamp. It flowed through
  // untouched into addCalendarDays() -> fromIsoDate(), which threw
  // `Invalid YYYY-MM-DD date: 2026-08-16T13:05:20.171Z` and crashed the run.
  //
  // The bug was unreachable until recently, which is why nothing caught it:
  // every live resignation escalated at an EARLIER gate (no start_date on the
  // Sandbox record, or a country outside the 9-country table), so the date
  // arithmetic was never entered. Both copies of this logic -- here and in the
  // n8n Code node -- were parity-tested against each other using date-only
  // fixtures, so they agreed perfectly and were both wrong about production
  // input. Parity proves two implementations MATCH, never that either is right.
  const nowIso = toCalendarDay(now);
  const tenureMonths = startDate ? tenureMonthsBetween(startDate, nowIso) : 0;
  const onProbation = Boolean(probationEndDate && new Date(probationEndDate) > new Date(nowIso));
  const bracket = pickBracket(rule, tenureMonths, onProbation);
  if (!bracket) {
    // WE HAVE THE COUNTRY'S RULE AND THIS TENURE FELL OUTSIDE EVERY BRACKET.
    // `noticeRuleFound: true` is what stops the policy engine reporting this as
    // `unsupported_country` — which it used to, because both no-result paths
    // arrive here with `noticeEndDate === null` and the gate could not tell
    // them apart. See policyEngine.js gate 4 for what that cost.
    //
    // It is reachable without anything exotic: GB's first bracket starts at 1
    // month (Employment Rights Act 1996 §86 grants no notice below that), so a
    // UK employee resigning in week one has no bracket. So does anyone still
    // inside a probation period longer than their country's probation bracket
    // caps — PT allows up to 240 days while the bracket caps at 5 months.
    return {
      countryCode: rule.countryCode,
      basis: rule.basis,
      unit: rule.unit,
      sourceCitation: rule.sourceCitation,
      tenureMonths,
      onProbation,
      noticeDays: 0,
      noticeStartDate: nowIso,
      noticeEndDate: null,
      proposedEndDate: proposedEndDate ?? null,
      discrepancyDays: null,
      discrepancy: unmeasuredDiscrepancy(proposedEndDate),
      noticeRuleFound: true,
      // TRUE — this country DOES have a statutory notice period; none of its
      // brackets covers this tenure. Distinct from the `false` above, which says
      // the country has no statutory period at all.
      statutoryMinimumExists: true,
      noticeMonths: null,
      noticeQuantity: null,
      anchorAdjusted: false,
    };
  }

  // Notice starts the day after submission (UC-05 V2 research §"Notice
  // Start Date"). For continuous anchors, end = start + N days. For month
  // anchors, the day-of-month is irrelevant; the rule snaps to the 1st /
  // 15th / month-end of the relevant month. We model "start + N days"
  // first then apply the anchor.
  const rawStart = nowIso;
  // A bracket states its period in DAYS or in MONTHS, and which one is a fact
  // about the statute rather than a unit preference — see the NoticeBracket
  // note in noticePeriodTable.js. Only NL is month-denominated today. The
  // branch is on `noticeMonths` being a real number rather than on the country,
  // so a second month-denominated statute needs no change here.
  const rawEnd = Number.isFinite(bracket.noticeMonths)
    ? addCalendarMonths(rawStart, bracket.noticeMonths)
    : addCalendarDays(rawStart, bracket.noticeDays);
  const { date: noticeEndDate, adjusted: anchorAdjusted } = applyAnchor(rawEnd, rule.anchorRule);

  // Discrepancy: how does the proposed LWD compare to the statutory end?
  let discrepancyDays = null;
  let discrepancy = "no_proposed_date";
  if (proposedEndDate) {
    const proposed = fromIsoDate(proposedEndDate);
    const statutory = fromIsoDate(noticeEndDate);
    discrepancyDays = Math.round((proposed.getTime() - statutory.getTime()) / (1000 * 60 * 60 * 24));
    if (discrepancyDays < 0) discrepancy = "earlier_than_statutory";
    else if (discrepancyDays > 0) discrepancy = "later_than_statutory";
    else discrepancy = "match";
  }

  return {
    countryCode: rule.countryCode,
    basis: rule.basis,
    unit: rule.unit,
    sourceCitation: rule.sourceCitation,
    tenureMonths,
    onProbation,
    // NULL, NOT A DERIVED DAY COUNT, on a month-denominated rule. The span this
    // calculation produced for NL is knowable (subtract the dates) and is NOT
    // the statutory quantity — art. 7:672(4) says "one month", and printing a
    // day figure beside `basis: "statutory"` would attribute a number to the
    // statute that the statute does not state. `noticeQuantity` is what prose
    // renders; see decisionFacts.js header rule 2b.
    noticeDays: Number.isFinite(bracket.noticeDays) ? bracket.noticeDays : null,
    noticeMonths: Number.isFinite(bracket.noticeMonths) ? bracket.noticeMonths : null,
    noticeQuantity: quantityText(bracket),
    statutoryMinimumExists: true,
    noticeStartDate: rawStart,
    noticeEndDate,
    proposedEndDate: proposedEndDate ?? null,
    discrepancyDays,
    discrepancy,
    noticeRuleFound: true,
    anchorAdjusted,
  };
}
