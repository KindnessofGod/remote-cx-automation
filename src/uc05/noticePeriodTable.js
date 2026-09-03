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
//   PL  — Kodeks pracy art. 36 §1: tenure-bracketed (2 weeks / 1 month /
//         3 months), mutual under art. 32 §1. Exercises TWO anchor rules from
//         one statutory sentence — art. 30 §2¹ lands a monthly period on the
//         last day of a month and a weekly one on a Saturday — and is why a
//         bracket may override its row's anchor at all. This bullet said
//         "1st-of-month anchor" until 2026-09-02; that was the opposite end of
//         the boundary and it moved every Polish date by a day.
//   IN  — Shops & Establishments Act varies by state. Contractual notice
//         is the binding source in practice; statutory defaults exist by
//         tenure for the rare case it is omitted. Conservative interpretation.
//   PH  — Labor Code Art. 297: 30 calendar days default; 15 days during
//         probation.
//   MX  — Federal Labor Law Art. 161: 30 calendar days default; waived
//         entirely when the employee is hired for a fixed term <= 6 months
//         (we do not model that here — we treat probation as a simple
//         "during probation" boolean from the employment record).
//   CA  — NO STATUTORY MINIMUM QUANTITY on a resigning employee, and this
//         bullet described invented brackets ("customary notice is 1-2 weeks by
//         tenure") until 2026-09-02. The 0 / 7 / 14 figures were removed the
//         same day; see the row itself, and note that the row is NOT the same
//         finding as the US one beside it — Québec's Civil Code binds either
//         party (D-44), it simply states a standard rather than a number.
//   PT  — 30 calendar days (<=2y tenure) / 60 calendar days (>2y tenure).
//         DURING PROBATION the resigning employee owes NOTHING — art. 114.º(1),
//         "sem aviso prévio". The "15-day probation default" this bullet used to
//         name was the EMPLOYER's figure and had been repealed even for them;
//         it was removed 2026-09-02 and the statutory zero is now branched on
//         rather than recorded and ignored.
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
 * @property {"month_15"|"month_end"|"month_1st"|"week_saturday"|"continuous"|null} anchorRule
 * @property {boolean} [noStatutoryMinimum]  true = SOURCED absence. The country
 *   IS covered by this table; what the table holds for it is the finding that no
 *   statutory notice period binds a resigning employee, so the notice owed comes
 *   from the contract — which this system does not hold and cannot read.
 *   Deliberately NOT expressible as `noticeDays: 0`: see this file's header.
 * @property {boolean} [noticeStandardWithoutNumber]  true = at least one
 *   jurisdiction inside this country imposes notice on the resigning employee by
 *   ENACTED LAW but states a STANDARD rather than a quantity, so there is nothing
 *   to bracket and nothing to compute. Canada only (Québec, CCQ art. 2091,
 *   D-44). It always travels WITH `noStatutoryMinimum`, and the pair is what
 *   keeps Canada from being described in the words that fit the United States:
 *   "the notice owed comes from the contract" is false in Québec, where art. 2092
 *   makes the remedy non-renounceable.
 * @property {boolean} [noStatutoryProbationNotice]  true = the statute
 *   POSITIVELY provides that no notice is owed during the probationary period —
 *   Portugal only (art. 114.º(1), "sem aviso prévio", D-03). It is not the same
 *   as `probation: null`, which means only that this table holds no separate
 *   probation rule. Consumed by computeNoticePeriod(), which produces no end date
 *   for it at all rather than falling through to the ordinary bracket.
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
 * @property {"month_15"|"month_end"|"month_1st"|"week_saturday"|"continuous"|null} [anchorRule]
 *   overrides the ROW's anchor for this bracket alone. Poland is the case: art.
 *   30 §2¹ ends a monthly notice period at a month end and a weekly one on a
 *   Saturday, so one country needs two rules keyed on the bracket. Both halves
 *   of that subsection are modelled as of 2026-09-02 — `week_saturday` was the
 *   missing one, and while it was missing this override carried `continuous`
 *   and the row said so rather than borrowing the monthly rule.
 * @property {number} [tenureMinDays]  the lower bound IN DAYS, for a statute that
 *   states its threshold in weeks rather than months. Consulted INSTEAD of
 *   `tenureMinMonths` when present, because thirteen weeks is not three months
 *   and rounding it to either side is wrong in a direction: 2.99 months rejects
 *   an employee who has served exactly thirteen weeks, and 3 months makes them
 *   wait five days for an entitlement the statute has already given them.
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
    // THE WRONG PARTY'S OBLIGATION, FOR THE THIRD TIME IN THIS FILE — corrected
    // 2026-09-02 against ERA 1996 s.86 as published by legislation.gov.uk
    // (D-41), retrieved for this correction.
    //
    // WHAT WAS HERE: the eight-bracket ladder above, rising to 84 days, cited
    // as "Employment Rights Act 1996 §86 (sliding scale)". **s.86(1) is the
    // EMPLOYER'S sliding scale.** s.86(2) is what a resigning employee owes:
    //
    //     "The notice required to be given by an employee who has been
    //      continuously employed for one month or more to terminate his
    //      contract of employment is not less than one week."
    //
    // Flat. One week. It does not rise with service. An employee at 43 months
    // was told they owed 21 days against a statutory 7; at 121 months, 84 days
    // against 7 — TWELVE TIMES the obligation, on a document HR Ops signs, and
    // an employee who acts on it loses eleven weeks of a start date they have
    // already accepted.
    //
    // ONCE IS A MISTAKE; TWICE IS THE METHOD — CONTRADICTIONS.md C-20's own
    // words, written when this same employer/employee inversion was caught for
    // Portugal and the Netherlands. Nobody re-ran that check against GB. Two
    // independent reviewers found it on the same day from opposite ends: an HR
    // operations specialist reading the table, and an employee reading their
    // own result panel.
    //
    // THE CITATION NOW NAMES THE SUBSECTION, and that is not pedantry. "§86"
    // beside a number invited trust: a named Act and section reads as though
    // somebody had checked. Saying nothing would have sent a reader to the
    // source; saying "§86" stopped them.
    //
    // BELOW ONE MONTH THERE IS NO BRACKET, DELIBERATELY. s.86(2) attaches at
    // one month's continuous employment, so under that the statute imposes
    // nothing and this table holds no rule — `no_matching_notice_bracket`,
    // which routes to a human. A `noticeDays: 0` row here would assert that
    // nothing is owed, which is a claim about the CONTRACT that this system
    // does not hold and has not read.
    brackets: [
      { tenureMinMonths: 1, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: "continuous",
    sourceCitation:
      "Employment Rights Act 1996 s. 86(2) — one week, flat, from one month's continuous employment. s. 86(1)'s sliding scale is the EMPLOYER's and does not bind a resigning employee.",
    evidence: "[CONFIRMED — statute, D-41, legislation.gov.uk, retrieved 2026-09-02]",
  },
  IE: {
    countryCode: "IE",
    countryName: "Ireland",
    basis: "statutory",
    unit: "calendar",
    // THE NUMBER WAS RIGHT AND THE CITATION POINTED AT THE WRONG SUBSECTION —
    // corrected 2026-09-02 against D-42 (irishstatutebook.ie).
    //
    // s.4 is the EMPLOYER's notice (the 1/2/4/6/8-week ladder). The employee's
    // is **s.6**: not less than one week, from thirteen weeks' continuous
    // service. One week is what this row already said, so nothing an employee
    // was told changed — but a citation naming the employer's subsection is the
    // same class of error as GB's above, and it is the one that let GB's live
    // for weeks. A right answer under a wrong citation is a right answer nobody
    // can check.
    //
    // THIRTEEN WEEKS IS NOT THREE MONTHS, and the row now says so rather than
    // rounding. 13 weeks = 91 days = 2.99 months, so an employee at exactly
    // thirteen weeks — the moment the entitlement attaches — fell in the
    // `0-2 months` bracket and was told they owed nothing. The threshold is
    // expressed in the statute's own unit and the floor moved with it; the
    // sub-threshold row is REMOVED rather than set to zero, for the same reason
    // as GB: below the threshold the statute is silent, which is not the same
    // claim as "no notice is owed".
    brackets: [
      // THIRTEEN WEEKS, IN DAYS, BECAUSE THAT IS THE UNIT s.6 USES.
      // `tenureMinMonths` is carried alongside for any reader or consumer that
      // only understands months; `tenureMinDays` is what the selector reads.
      { tenureMinMonths: 3, tenureMinDays: 91, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: "continuous",
    sourceCitation:
      "Minimum Notice and Terms of Employment Act 1973 s. 6 — one week, from thirteen weeks' continuous service. s. 4 is the EMPLOYER's ladder and does not bind a resigning employee.",
    evidence: "[CONFIRMED — statute, D-42, irishstatutebook.ie, retrieved 2026-09-02]",
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
    // MONTHS AS MONTHS, AND THE ANCHOR TURNED THE RIGHT WAY UP — corrected
    // 2026-09-02 against D-43 (Kodeks pracy, api.sejm.gov.pl).
    //
    // THREE THINGS WERE WRONG AND THE BRACKETS WERE NOT AMONG THEM. art. 36 §1's
    // periods and boundaries were right, and art. 32 §1 makes them MUTUAL, so
    // unlike GB and IE this row had the correct party all along.
    //
    // 1. `noticeDays: 30` and `noticeDays: 90` for periods the statute states in
    //    MONTHS. This file's own NL note says why that is not a rounding
    //    convenience — "30 days is not the same quantity" — and NL was already
    //    written as `noticeMonths: 1` for exactly this reason. A one-month
    //    notice starting 31 January does not end 2 March.
    //
    // 2. `anchorRule: "month_1st"` returned the FIRST of the following month as
    //    a LAST WORKING DAY. art. 30 §2¹ ends a monthly notice period on the
    //    LAST DAY of a calendar month, so every Polish answer this system gave
    //    was one day past a date that cannot be a last working day under the
    //    rule it claimed to implement. Measured before the fix: 79 months'
    //    service ended 2027-01-01.
    //
    // 3. The anchor was applied to the two-week bracket as well, which art. 30
    //    §2¹ governs differently — a notice period stated in WEEKS ends on a
    //    SATURDAY. `month_end` is wrong for it in the other direction.
    //
    // THE SATURDAY RULE IS NOW BUILT (2026-09-02) — this comment previously said
    // it was not, and that was the honest state at the time rather than the
    // finished one. art. 30 §2¹ states BOTH landing rules in one sentence:
    //
    //   "Okres wypowiedzenia umowy o pracę obejmujący tydzień lub miesiąc albo
    //    ich wielokrotność kończy się odpowiednio W SOBOTĘ lub w ostatnim dniu
    //    miesiąca."
    //
    // A period comprising a week or a multiple of weeks ends on a SATURDAY. The
    // two-week bracket is a multiple of a week, so `week_saturday` is its rule
    // with exactly the same statutory force as `month_end` has for the other
    // two — they are one subsection, not a rule and an approximation of one.
    // `applyAnchor()` in noticePeriodCalculator.js is where it lives, and it
    // moves the date FORWARD only: a notice period may be lengthened to reach
    // its statutory landing day and may never be shortened to it.
    //
    // ONE ANCHOR PER ROW is no longer the shape this table has — a bracket may
    // override its row's anchor (see NoticeBracket.anchorRule above), which is
    // what Poland needed and what the previous revision of this comment
    // correctly said the table could not yet express.
    brackets: [
      // `week_saturday` OVERRIDES THE ROW'S `month_end` — art. 30 §2¹ ends a
      // WEEKLY period on a Saturday. Both halves of that sentence are now
      // modelled; neither is a note on a return value nobody reads.
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 14, anchorRule: "week_saturday" }, // <6 months — art. 36 §1 pkt 1
      { tenureMinMonths: 6, tenureMaxMonths: 35, noticeMonths: 1 }, // ≥6 months — art. 36 §1 pkt 2
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeMonths: 3 }, // ≥3 years — art. 36 §1 pkt 3
    ],
    probation: null,
    anchorRule: "month_end",
    sourceCitation:
      "Kodeks pracy art. 36 §1, mutual under art. 32 §1 — two weeks / one month / three months at under six months, six months, and three years' service. art. 30 §2¹ ends a notice period stated in months on the LAST DAY of a calendar month, and one stated in weeks on the following SATURDAY; both are applied.",
    evidence: "[CONFIRMED — statute, D-43, api.sejm.gov.pl, retrieved 2026-09-02]",
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
    // THE FABRICATED BRACKETS ARE GONE (2026-09-02), and this row is now the
    // same SOURCED ABSENCE the US row is.
    //
    // WHAT IT USED TO DO. `basis: "customary"` with invented `0 / 7 / 14` day
    // brackets — numbers nobody retrieved, on a document HR Ops signs. A
    // Canadian with six weeks' service produced, in one rendered sentence:
    //
    //   "0 days' notice under Common-law customary notice (no statutory
    //    employee minimum; varies by province), running 2026-09-02 to
    //    2026-09-02, on 1 months of service."
    //
    // Three contradictions in one line: it states a notice period of ZERO; the
    // citation inside the same sentence says there is no statutory minimum; and
    // the record flag said `statutoryMinimumExists: true` on a row whose own
    // basis was `customary`. The last working day printed was the day of
    // submission. This file's own header forbids the first of those outright —
    // "Deliberately NOT expressible as `noticeDays: 0`" — and this row did it
    // anyway.
    //
    // NOT A DISCOVERY. `CONTRADICTIONS.md` C-30 recorded the decision to remove
    // these brackets on 2026-08-21 and closed with "**Not yet built**; the CA
    // row still emits 0 / 7 / 14 in the tree." It stayed unbuilt for twelve
    // days while Canada sat in the four-country demo set. Found again
    // 2026-09-02 by an HR operations specialist, who called it a fabricated
    // number on a sign-off form — which is what it was.
    //
    // WHY `noStatutoryMinimum` AND NOT DELETING THE ROW. Deleting it makes
    // Canada `unsupported_country`, which this system carefully means as "a gap
    // in OUR table, saying nothing about that country's law". That would be a
    // false modesty: the absence of a statutory minimum on a RESIGNING employee
    // is a finding about the law, and the three states are kept apart on
    // purpose (they go to three different desks). `no_statutory_notice_period`
    // is the honest one and it is what C-30 decided.
    //
    // ~~EVIDENCE TAG DELIBERATELY WITHHELD until the retrieval lands.~~ THE
    // RETRIEVAL LANDED THE SAME DAY, and this row now carries the tag it was
    // waiting for. Two provinces were read, from their own authorities:
    // **D-05** (Ontario, Employment Standards Act 2000 Part XV, King's Printer)
    // and **D-44** (Québec, Code civil arts. 2091–2092, Éditeur officiel).
    //
    // THE REFUSAL WORDING NEEDED A QUÉBEC VARIANT, AND WITHOUT ONE IT WAS FALSE
    // FOR A WHOLE PROVINCE (2026-09-02). The citation on this row said the notice
    // owed "is contractual or common-law reasonable notice". D-44's own table
    // takes that sentence apart clause by clause:
    //
    //   * Québec is a CIVIL-LAW jurisdiction. There is no common law of
    //     reasonable notice there to fall back on.
    //   * **CCQ art. 2091 binds *chacune des parties*** — either party. A
    //     resigning Québec employee owes a *délai de congé* as a matter of
    //     ENACTED LAW, not of contract.
    //   * **art. 2092**: the employee *"ne peut renoncer"* to the indemnity for
    //     insufficient notice — so it is not even a term the contract may
    //     bargain away, which is the strongest possible refutation of "it comes
    //     from the contract".
    //
    // WHAT SURVIVES, AND WHY THIS IS STILL `noStatutoryMinimum`. Art. 2091
    // states a STANDARD, not a quantity: reasonable time, weighed on the nature
    // of the employment, the circumstances and the duration of service. There is
    // no minimum number of days to apply, so this table has nothing to hold and
    // the behaviour is unchanged and correct — refuse to compute, escalate to a
    // human. D-44 says it in terms: *"A refusal is the right answer to a
    // reasonableness test; a number never is."* What changes is the SENTENCE the
    // refusal carries, which a person reads and acts on.
    //
    // THE PROVINCE IS NOT READ, AND THE CITATION SAYS SO RATHER THAN PICKING
    // ONE. Nothing in this system resolves a Canadian employment to a province,
    // and guessing from an address field would be the invented-proxy failure
    // (CLAUDE.md §7, UC-03's alpha-3 comparison). So both regimes are stated and
    // the reader is told which fact decides between them.
    //
    // TWO PROVINCES OF THIRTEEN. D-44's own "still open" section is the reason
    // this stays a refusal rather than becoming a table: two provinces, two
    // opposite answers, is the strongest available evidence that "varies by
    // province" cannot be resolved into one national rule — and the weakest
    // possible basis for choosing which of the two to encode.
    basis: "none",
    unit: "none",
    noStatutoryMinimum: true,
    // THE FIELD THAT KEEPS CANADA FROM BEING DESCRIBED AS THE UNITED STATES.
    // Both rows carry `noStatutoryMinimum: true` and they are NOT the same
    // finding: the US row means no statute addresses a resigning employee at all,
    // this one means at least one province's statute does and states no number.
    // Read by the calculator and surfaced by the policy engine and the panel;
    // never keyed on the country code, so the next civil-law jurisdiction added
    // needs no new branch anywhere.
    noticeStandardWithoutNumber: true,
    // EMPTY ON PURPOSE, same as the US row: a bracket of any width with any
    // number would be a statutory quantity, and there is not one to state.
    brackets: [],
    probation: null,
    anchorRule: null,
    sourceCitation:
      "No statutory minimum notice PERIOD runs against a resigning employee under the Canada Labour Code or the provincial employment standards Acts — those notice provisions bind the EMPLOYER on termination (Ontario ESA 2000 s. 54/57 is expressly \"No employer shall terminate\"). What the resigning employee owes then depends on the province, which this system does not read: in the COMMON-LAW provinces it is contractual or common-law reasonable notice, and this system does not hold the contract; in QUÉBEC it is statutory and mutual — Code civil art. 2091 requires either party to give a délai de congé in reasonable time, judged on the nature of the employment, its circumstances and the duration of service, and art. 2092 makes the employee's remedy for insufficient notice non-renounceable. Neither regime states a number of days, which is why this is a refusal rather than a figure.",
    evidence:
      "[CONFIRMED — statutes, D-05 (Ontario ESA 2000 Part XV, King's Printer) and D-44 (Québec, Code civil arts. 2091–2092, Éditeur officiel), both retrieved 2026-09-02. Two provinces of thirteen; the federal Code is D-04.]",
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
    // DURING PROBATION THE EMPLOYEE OWES NOTHING, and this row said fifteen days
    // — corrected 2026-09-02 against D-03/D-02 (Código do Trabalho, DRE),
    // re-retrieved and re-hashed byte-identical for this correction.
    //
    // **art. 114.º(1): during the período experimental either party may
    // terminate "sem aviso prévio"** — without notice. The 7 / 15 / 30-day
    // figures elsewhere in art. 114.º are the EMPLOYER'S, and 15 was raised to
    // 30 by Lei n.º 13/2023 in any case, so the number here was the wrong
    // party's AND out of date. The fourth employer/employee inversion this file
    // has held; CONTRADICTIONS.md C-20 records it as still open.
    //
    // THE CITATION POINTED AT AN ARTICLE THAT HAS NO PROBATION RULE IN IT.
    // The row cited art. 400.º(1) — the 30/60-day tenure split — beside a
    // probation figure that comes from art. 114.º. A reader following it would
    // find no such rule and be unable to tell whether they had misread the
    // article or the code had.
    //
    // THIS PATH WAS DEAD UNTIL F-36 WAS FIXED, which is how a known-wrong row
    // survived: making the probation gates reachable activated it.
    //
    // `null`, NOT `noticeDays: 0`. Same rule as every other absence in this
    // file: a zero is a quantity and would render as one. A null probation
    // entry makes pickBracket() fall through to the ordinary bracket, which is
    // wrong in the other direction — so the row states the absence explicitly
    // instead, and the policy engine reads `noStatutoryProbationNotice` to
    // escalate rather than compute.
    //
    // ~~Until that field is consumed (its own unit of work, named in the
    // citation), a probationer is answered by the ordinary bracket~~ — **IT IS
    // CONSUMED AS OF 2026-09-02.** `computeNoticePeriod()` branches on it above
    // `pickBracket()` and returns no end date at all, and `policyEngine.js`
    // reports `no_statutory_notice_during_probation`. The visible contradiction
    // this comment used to describe as "the safer of the two failures" — 30 days
    // printed beside a citation saying zero — no longer reaches a screen.
    //
    // AND IT IS STILL NOT A ZERO ON THE PANEL, for a reason that is in the
    // statute's own first clause: art. 114.º(1) opens *"salvo acordo escrito em
    // contrário"* — unless otherwise agreed in writing. The statutory default is
    // no notice; a written contract may displace it; this system does not hold
    // the contract. So the outcome is the same shape as the US and Canadian
    // rows: a sourced statutory finding, an unread instrument that could override
    // it, and a human told both rather than handed a number.
    probation: null,
    noStatutoryProbationNotice: true,
    anchorRule: "continuous",
    sourceCitation:
      "Código do Trabalho art. 400.º(1) — 30 or 60 days, split on \"até dois anos ou mais de dois anos\". DURING PROBATION art. 114.º(1) lets either party terminate sem aviso prévio, so a resigning employee owes NOTHING and no statutory end date is computed; the 7/15/30-day figures in art. 114.º are the employer's. The article says \"salvo acordo escrito em contrário\", so a written contract may require notice where the statute does not — and this system holds no contract, which is why a probationer is escalated rather than told they may leave today.",
    // ONE `evidence` KEY, NOT TWO. This row carried the field twice from
    // 2026-09-02 until later the same day; the second literal silently shadowed
    // the first, so the row advertised the 2026-08-19 D-02 retrieval and the
    // D-03 probation retrieval that the corrections above actually rest on was
    // invisible to every reader and every consumer. Duplicate keys in an object
    // literal are legal JavaScript and warn nowhere.
    evidence: "[CONFIRMED — statute, D-02 (art. 400.º, retrieved 2026-08-19) and D-03 (art. 114.º, re-retrieved and re-hashed 2026-09-02), DRE]",
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
export function pickBracket(rule, tenureMonths, onProbation = false, tenureDays = null) {
  if (!rule) return null;
  const pool = onProbation && rule.probation ? [rule.probation] : rule.brackets;
  if (!pool || !pool.length) return null;

  // BELOW THE TABLE ENTIRELY is a real and different answer, and it is checked
  // first. Ireland's lowest bracket starts at 3 months, so one month's service
  // matches nothing — `no_matching_notice_bracket`, which is a gap in OUR table
  // and goes to a different desk from "this country sets no minimum".
  // THE TABLE'S OWN FLOOR, IN WHICHEVER UNIT THE STATUTE USES. Ireland's
  // entitlement attaches at THIRTEEN WEEKS (MNTEA 1973 s.6), which is 91 days
  // and is not three months — so the floor is compared in days where the row
  // states one, and in months everywhere else. Expressing it as "2.99 months"
  // was tried and rejected: an employee at exactly thirteen weeks measured 2.97
  // months and was refused the entitlement the statute had just given them.
  const floorDays = pool[0]?.tenureMinDays;
  if (typeof floorDays === "number") {
    if (!Number.isFinite(tenureDays) || tenureDays < floorDays) return null;
  } else {
    const tableFloor = pool[0]?.tenureMinMonths ?? -Infinity;
    if (Math.floor(tenureMonths) < tableFloor) return null;
  }

  // THE UPPER BOUND ALONE, WALKED IN ORDER — and the reason is that
  // `tenureMonths` is no longer an integer (2026-09-02, see
  // tenureMonthsExactBetween()).
  //
  // The old test was `tenure >= min && tenure <= max`, which is exactly right
  // for whole months and opens a GAP the moment the value can be fractional.
  // Portugal's brackets are `max: 24` then `min: 25`: contiguous over integers,
  // and two years and fifteen days (24.5) falls between them and matches
  // nothing. That would turn a wrong answer into a spurious escalation — better
  // than the wrong answer, and still not the right one.
  //
  // Because the brackets ascend and do not overlap, the FIRST one whose upper
  // bound still admits this tenure is the correct one, and consulting the lower
  // bound again cannot change which that is. The table floor above is what the
  // lower bounds were really doing. Ascending order is asserted by test rather
  // than assumed here, because a table written out of order would make this
  // silently pick the wrong row.
  return pool.find((b) => tenureMonths <= (b.tenureMaxMonths ?? Infinity)) ?? null;
}
