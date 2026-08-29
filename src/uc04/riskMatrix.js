// ---------------------------------------------------------------------------
// riskMatrix.js  —  Deterministic origin→destination risk classification
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-04's automation boundary (per docs/use-cases/UC-04.md §1/§5) is HITL: AI
// prepares a structured dossier + risk-scores it, a mobility specialist
// approves. The risk score is a real, defensible answer to "how much
// regulatory and corporate exposure does this workation create?", not a vibe
// the LLM picked up from the requester's tone. It is built entirely from the
// five structured factors (ticket input): nationality, home country, travel
// history, visa type, job duties — never from free-text reasoning, which
// would let an LLM be the source of a regulatory conclusion.
//
// WHY NO 30-DAY HARD CUTOFF
// The original spec carried a "Hard lock if days > 30" line in §7. The
// ticket for this build explicitly retired that number: it is not a real
// statutory threshold (Schengen is 90/180, US tourist is zero, US/UK totalization
// is 183, Romania DNV is 183, Estonia DNV has its own income test), and
// encoding a single fictional number into the matrix would be the opposite
// of "deterministic" — the matrix instead surfaces the country- and visa-
// specific considerations the specialist must weigh. The cumulative day
// counter is still computed (it informs `medium` vs `low`), but a stand-alone
// 30-day cliff is not.
//
// SHAPE
// Pure function over the structured input. No I/O, no LLM, no `Date.now()`
// reads (caller passes `now`). Same discipline as src/uc06/policyEngine.js
// and src/uc01/policyEngine.js — testable in isolation, no infrastructure.
//
// COUNTRY CODES ARE NORMALISED ONCE, AT THE TOP OF classifyRisk()
// Every rule below is a case-sensitive `Set.has()` or `=== "US"`. Before the
// normalisation, a destination of `"us"` matched none of them and walked past
// BOTH work-permit hard blocks and the Schengen 90/180 block (finding F-13).
// The codes are therefore run through src/shared/countryCodes.js's
// normalizeCountryCode() once, on entry, and every rule below reads the
// normalised locals — never `args.destinationCountry` directly. Adding a
// comparison against the raw argument re-opens the bypass.
//
// AN UNRECOGNISED DESTINATION ESCALATES; IT DOES NOT PASS
// docs/use-cases/UC-04.md §3: "Any other destination falls through to
// escalate-by-default, which is correct behavior, not a gap." The matrix used
// to do the opposite — a destination it had no rule for raised no flag, so it
// scored `low` and became `ready_for_approval` (finding F-14: ZZ, TH, RU, IR,
// KP, "United States" and "1" all reached the specialist's 1-click path at
// risk `low`). A matrix that knows nothing about a country has not cleared it;
// it has failed to evaluate it, and those are opposite conclusions.
//
// A RESTRICTED JURISDICTION IS BLOCKED, NOT "UNEVALUATED"
// Until 2026-08-18 this matrix had no jurisdiction screen at all, so a
// workation request to Iran, Russia or North Korea came back
// `destination_out_of_scope` -> `high` -> escalate: the same verdict, in the
// same words, as a request to Montenegro. Two things were wrong with that.
// First, the reason a specialist read said "this matrix has no rules for that
// country", when the truth is "that destination is restricted" — the exact
// defect class this repo has already paid for twice (a control that fails
// closed only by accident of a later gate, and a reason string nobody can act
// on). Second, and materially: `escalate` was one of the two decisions
// src/uc04/workflow.js created a REAL Remote work-authorization record for
// (`createWorkAuthorization`, status `pending_mobility`); `blocked` was not. So
// a sanctioned-destination request produced a platform write. That create was
// REMOVED 2026-08-19 — there is no `POST /v1/work-authorization-requests`, and
// the status it sent was not a member of Remote's enum either — so the write it
// describes never actually reached Remote. The reasoning for placing this gate
// FIRST is unchanged and if anything stronger: `escalate` still resolves a real
// Remote request and can still reach a specialist's one-click approve, and
// `blocked` still resolves nothing at all. Remote's own
// OpenAPI types a work authorization's `destination_country` as the `Country`
// schema — "A supported country on Remote", i.e. a row of `GET /v1/countries`
// ([CONFIRMED], developer.remote.com/reference/get_v1_work-authorization-requests.md,
// fetched 2026-08-18) — and every code in the set below is ABSENT from that
// registry (verified live the same day, 224 rows). The record we were creating
// was one Remote's own model cannot represent.
//
// The screen is deliberately NOT `eor_onboarding: true`. That flag says
// whether Remote can *employ* someone in a country (91 of the 224 rows); it
// says nothing about whether an already-employed person may work from there
// for three weeks. Gating on it would block Martinique for a French employee
// and Montenegro for a German one. See
// docs/research/COUNTRY-SUPPORT-SEMANTICS.md §5 and §10 — and the positive
// test in test/uc04.test.js that fails if anyone later "tightens" this to the
// EOR flag.
// ---------------------------------------------------------------------------

import { normalizeCountryCode, normalizeCountrySet, isWellFormedCountryCode } from "../shared/countryCodes.js";
import { SANCTIONED_OR_RESTRICTED } from "../uc03/policyEngine.js";

/** Allowed visa types — anything else is treated as "other" (flagged). */
export const VISA_TYPES = Object.freeze({
  schengen_short_stay: "schengen_short_stay",  // 90/180 visa-free / short-stay Schengen
  esta_usa: "esta_usa",                         // US ESTA / visa-waiver (tourist, NOT work)
  digital_nomad_visa: "digital_nomad_visa",     // formal DNV (Estonia, Romania, Portugal, etc.)
  tourist_visa: "tourist_visa",                 // generic short-term tourist
  business_visa: "business_visa",               // formal short-term business visa
  work_permit: "work_permit",                   // formal work permit / visa
  other: "other",
});

/** Allowed job-duty categories — the ones with material PE/tax exposure are first. */
export const JOB_DUTY_CATEGORIES = Object.freeze({
  engineering: "engineering",   // coding, devops, QA
  support: "support",           // customer support, content
  operations: "operations",     // ops, project, finance
  sales: "sales",               // account exec, BD — negotiations create DAPE exposure
  legal: "legal",               // in-house legal — review/negotiate
  executive: "executive",       // C-suite — extreme DAPE / economic-employer exposure
  other: "other",
});

/**
 * EXPORTED so a describer can state WHICH rule applied without re-listing the
 * member states. src/uc04/decisionFacts.js needs the same predicate this file's
 * Schengen block uses (`SCHENGEN.has(dest) && nationality && !DNV_COUNTRIES.has(dest)`)
 * to say whether the 90/180 limit was in play at all — and a second copy of a
 * 29-country list is a list that drifts. Exporting a constant changes no
 * behaviour and nothing about the n8n port, which reads its own copy.
 */
export const SCHENGEN = new Set([
  "AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS",
  "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI",
  "ES", "SE", "CH",
]);

const EU_EEA_FOR_A1 = new Set([
  // EU/EEA member states whose social-security coordination is governed by
  // Regulation 883/2004 — an A1 certificate of coverage is the right tool.
  // Switzerland and the UK (post-transition) are added by separate agreements;
  // the matrix flags them as "covered" but not via the EU regulation's A1 path.
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO",
]);

/**
 * Destinations this matrix treats as running a formal digital-nomad-visa scheme.
 *
 * READ THE DIRECTION THIS ACTS IN BEFORE READING THE LIST. Membership does not
 * ADD a check — it SUPPRESSES one. The Schengen 90/180 block below is skipped
 * entirely for a destination in this set, on the reasoning that a formal DNV is
 * a residence permission sitting outside the short-stay allowance the 90/180
 * rule governs. So a wrong entry here does not make UC-04 more cautious; it
 * makes it silently less cautious, and the resulting run looks exactly like a
 * trip that was assessed and cleared.
 *
 * `docs/KNOWLEDGE-SOURCES.md` L1-07 names this precisely: "Five codes (EE, PT,
 * RO, CR, MX), no citation, no thresholds, and it *suppresses* the Schengen
 * check for those destinations. A suppression driven by an uncited list is Test
 * B's failure mode with the sign flipped." Test B is that catalogue's safety
 * net — *if the answer were wrong, would anything downstream catch it?* Here,
 * nothing would.
 *
 * THE LIST IS NOT CHANGED HERE, AND LENGTHENING IT WOULD NOT BE A FIX. There is
 * no source for a longer one, and inventing more codes is the same defect with
 * more entries. What changes is that the suppression now STATES ITSELF wherever
 * it is reported (src/uc04/decisionFacts.js), so a specialist reading "the
 * Schengen limit was not applied" can see that the reason is a five-entry
 * curated list nobody has sourced — rather than mistaking an excused check for
 * a passed one.
 *
 * @see DNV_COUNTRIES_PROVENANCE for what a real version of this table needs.
 */
export const DNV_COUNTRIES = new Set(["EE", "PT", "RO", "CR", "MX"]);

/**
 * What this table is, and what it would take for it to be a sourced one.
 *
 * A trailing `// the curated list the matrix knows about` was the whole of its
 * documentation, which is a comment rather than a recorded requirement — nobody
 * can act on it and no reader downstream ever sees it. This is exported so the
 * describer can print the basis beside the suppression, and so the gap is a
 * thing in the repository rather than a thing in a code comment.
 *
 * `authority`, `version` and `reviewedOn` are all null ON PURPOSE. A placeholder
 * date or a plausible-looking authority would be exactly the manufactured value
 * this project has paid for repeatedly; null is the honest state and it is what
 * makes the requirement visible.
 */
export const DNV_COUNTRIES_PROVENANCE = Object.freeze({
  table: "DNV_COUNTRIES",
  status: "[PROPOSED] — illustrative, no authority",
  authority: null,
  version: null,
  reviewedOn: null,
  effect: "suppresses",
  effectDetail:
    "A destination in this set skips the Schengen 90/180 check entirely. Membership removes a control rather than adding one, so a wrong entry fails open.",
  basis:
    "A curated five-entry list carried in src/uc04/riskMatrix.js. No publishing authority, no version, no review date, and no record of the income or duration thresholds each scheme actually imposes.",
  needsForAVersionedTable: Object.freeze([
    "A named publishing authority per destination — Estonia PPA, Portugal AIMA (D8), Romania IGI, and the equivalent for every other entry.",
    "A version or publication date for the scheme as read, since DNV schemes change income thresholds annually and are occasionally suspended.",
    "A review date and a named owner, with an alert when the review date passes — docs/KNOWLEDGE-SOURCES.md L1-07 calls this the honest control and notes it is a staffing answer, not an engineering one.",
    "The scheme's own thresholds (income floor, insurance, maximum duration), so membership becomes a condition the request is checked against rather than a blanket exemption.",
  ]),
  reference: "docs/KNOWLEDGE-SOURCES.md L1-07",
});

/**
 * Destinations UC-04 refuses outright, whatever the visa, the duties or the
 * specialist's opinion.
 *
 * IMPORTED, NOT COPIED — and that is the point. This is the same set UC-03's
 * router blocks on (`src/uc03/policyEngine.js`), because it answers a question
 * about a jurisdiction, not about a use case: whether Remote's own country
 * registry excludes it. Two copies of a restricted-jurisdiction list is a
 * restricted-jurisdiction list that drifts, and a control that is right in one
 * file and stale in another is worse than one control, because it reads as two.
 * Its proper long-term home is `src/shared/` alongside countryCodes.js — it
 * lives in UC-03 today only because that is where it was first needed, and
 * moving it was outside this pass's file scope. Import direction is the only
 * cost; the alternative was duplication.
 *
 * Verified live 2026-08-18: all ten codes are absent from the 224 rows of
 * `GET /v1/countries`, whose stated membership rule is "the countries present
 * in the list are the ones where creating a company is allowed" ([CONFIRMED]).
 */
export const RESTRICTED_JURISDICTIONS = SANCTIONED_OR_RESTRICTED;

/**
 * The curated 9-country scope of `00-FOUNDATION.md` §4.8, named explicitly in
 * UC-04.md §3 ("UK, Ireland, Germany, Poland, India, Philippines, Mexico,
 * Canada, Portugal"), plus the US — which the matrix carries a specific hard
 * rule for even though it is outside the curated list.
 */
const CURATED_SCOPE = new Set(["GB", "IE", "DE", "PL", "IN", "PH", "MX", "CA", "PT", "US"]);

/**
 * Every destination this matrix has an actual rule about. A destination
 * outside it is not "low risk" — it is unevaluated, and UC-04.md §3 says
 * unevaluated escalates. Built from the sets above rather than hand-listed so
 * that adding a country to any rule set automatically brings it in scope, and
 * a country can never be "in scope" without a rule that mentions it.
 */
export const KNOWN_DESTINATIONS = new Set([
  ...SCHENGEN,
  ...EU_EEA_FOR_A1,
  ...DNV_COUNTRIES,
  ...CURATED_SCOPE,
]);

const NON_TREATY_PAIRS = new Set([
  // Pairs known to lack a bilateral totalization / DTAA from the curated
  // 9-country scope; the matrix escalates them as "non_treaty_pair" rather
  // than guessing.
  //
  // THIS IS A KNOWN-GAP LIST, NOT A COVERAGE LIST, and the difference is the
  // whole point. Membership means "we know there is no treaty". Absence means
  // "we have not looked" — it does NOT mean covered. The comment here used to
  // claim anything unlisted was "treated as treaty unknown (medium) by
  // default", which is not what happens: the block below pushes a flag ONLY on
  // a member, so an unlisted pair produces no flag, no consideration and no
  // effect on the level at all. That is a comment naming a mechanism that was
  // not doing the work — the same shape as letter.js's no-salary comment
  // crediting STANDARD_LETTER_FIELDS, a file it never imported.
  //
  // The behaviour is deliberately unchanged: inventing a "medium" for every
  // unlisted pair would fabricate a finding out of an absence, and there are
  // ~250 countries against seven known gaps. What changed is that the absence
  // is now REPORTED as `unknown` by src/uc04/decisionFacts.js, so a specialist
  // can tell "no gap on record" from "confirmed covered" — which nothing
  // downstream could do before, because both looked like silence.
  "IN_US", "PH_US", "MX_CA", "IN_CA", "PH_CA", "IN_GB", "PH_GB",
]);

// ---------------------------------------------------------------------------
// DAY ARITHMETIC — three defects fixed 2026-08-20, all in one function
// ---------------------------------------------------------------------------
// `computeCumulativeDays()` decides whether a traveller is over the Schengen
// 90/180 allowance and over the 183-day tax-residency watch. It was wrong in
// three separate ways, and two of them were invisible from inside.
//
//   1. AN UNREADABLE DATE SILENTLY CLEARED AN OVERSTAY. `Math.max(NaN, winStart)`
//      is NaN, the `end < start` guard never tripped (`NaN < NaN` is false), and
//      `days` became NaN — at which point BOTH `days + tripDays > 90` and
//      `> 183` are false, because NaN loses every comparison. A 123-day Spanish
//      stay plus one row with a blank end date scored `low` with no reasons and
//      no flags. THE DISGUISE IS THE WORST PART: NaN serialises to `null`
//      through JSON, so the durable row and the API read "not computed" rather
//      than "computed wrong" — the manufactured-zero pattern (F-32) rotated into
//      a manufactured ABSENCE, wearing the costume of an honest one. Meanwhile
//      `periodsCounted` still said 2, so the record asserted that two stays were
//      looked at and nothing came of it.
//
//      The portal now refuses such rows at intake (`travel_history_unreadable`),
//      but the front door is not the gate: the n8n path and any direct API
//      caller reach this arithmetic unguarded. It now refuses for itself, and
//      `classifyRisk()` turns that refusal into a hard block rather than
//      reading a null as a zero.
//
//   2. OVERLAPPING STAYS DOUBLE-COUNTED. `{ES, May 1–31}` + `{ES, May 10–Jun 10}`
//      returned 63 for 41 distinct days. Days are a UNION, not a sum — the same
//      correctness rule `src/uc08/presenceCalculator.js` states as its rule 1 and
//      this file's own comment already claimed to share ("same shape as
//      src/uc08/presenceCalculator.js"). It was not the same shape. Inflating
//      toward a limit errs toward refusal, which is the safer direction and still
//      a wrong number on a screen that prints it as precise.
//
//   3. THE SCHENGEN WINDOW WAS PER-TRIP; THE REGULATION IS PER-DAY-OF-STAY.
//      See `schengenPeakDays()` below and finding C-1.
//
// WHAT THIS DELIBERATELY DOES NOT COPY FROM UC-08. `computePresenceDays()`
// treats an EMPTY period list as NOT_EVALUATED (its rule 4), because a UC-08
// dossier asserting "0 days in GB" from no evidence is a claim about where
// somebody was. UC-04 is the opposite case: a workation request with no prior
// stays is the ordinary case, the portal states plainly that 0-over-0 is a floor
// rather than a count, and making it NOT_EVALUATED would block every request
// anyone ever files. An empty history is COUNTED at zero here, on purpose.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** "the count is a number" | "the count could not be taken" — explicit, never implied. */
export const DAYS_COUNTED = "COUNTED";
export const DAYS_NOT_EVALUATED = "NOT_EVALUATED";

/** Reg. (EU) 2016/399 art. 6(1), via docs/knowledge/layer-1-statutory/D-07. */
export const SCHENGEN_LIMIT_DAYS = 90;
export const SCHENGEN_WINDOW_DAYS = 180;

/**
 * Parse a "YYYY-MM-DD" (or any ISO) date to a whole UTC day index, or null.
 * Day index = days since the epoch, so interval maths is plain integers and no
 * DST or timezone offset can move a boundary by one day. Copied in shape from
 * src/uc08/presenceCalculator.js's `toDayIndex()` for exactly that reason.
 * @param {unknown} value
 * @returns {number|null}
 */
function toDayIndex(value) {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(`${value}`.trim());
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

/** A day index back to "YYYY-MM-DD", for reporting a window or a peak day. */
function toDateString(dayIndex) {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Every row of a stated travel history that the day counter cannot read, named.
 *
 * EXPORTED because `classifyRisk()` needs the same answer BEFORE it knows which
 * window it is counting over, and because the refusal has to name the row — a
 * `blocked` verdict whose reason is "one of your prior stays is unreadable" and
 * cannot say which is a refusal nobody can act on.
 *
 * A row is reported whatever country it names. That is deliberate and it is
 * `computePresenceDays()`'s own rule: when the dates of a row are malformed we
 * cannot be confident the rest of the row is sound either, and silently
 * dropping a row is how a count that is missing a period gets presented as a
 * count. The portal's intake guard already refuses on the same basis.
 *
 * @param {unknown} travelHistory
 * @returns {string[]} human-readable descriptions, empty when every row is readable
 */
export function travelHistoryProblems(travelHistory) {
  const problems = [];
  if (travelHistory == null) return problems;
  if (!Array.isArray(travelHistory)) {
    problems.push(`travel history is not a list: ${JSON.stringify(travelHistory)}`);
    return problems;
  }
  travelHistory.forEach((period, i) => {
    const label = `prior stay ${i + 1}`;
    // WELL-FORMED, NOT MERELY NON-EMPTY — and the difference was 80 days.
    //
    // `normalizeCountryCode()` trims and upper-cases and nothing else, so
    // "Netherlands" survives it as "NETHERLANDS": truthy, past this guard, and
    // then compared with `Set.has()` against two-letter codes it can never
    // equal. The stay matched nothing, contributed nothing, and the result came
    // back `status: "COUNTED"`, `problems: []`, `periodsCounted: 0` — a count
    // asserting it happened, over a history it had silently discarded. Verified
    // 2026-08-20: the same 80-day stay reads 80 as "NL" and 0 as "Netherlands",
    // with no complaint either way (docs/DEMO-COUNTRIES.md §8, TH-14/TH-15).
    //
    // That is the failure direction this file exists to refuse. An overstay
    // written in words CLEARS, and clearing is the answer nobody investigates —
    // the same shape as the NaN that `73920c9` removed one function over, and
    // as UC-03's alpha-3 comparison that could never match.
    //
    // `isWellFormedCountryCode()` has sat unused in src/shared/countryCodes.js,
    // one import line away, since it was written. A validator nothing calls is
    // a validator that is not running.
    const country = isWellFormedCountryCode(period?.country) ? normalizeCountryCode(period?.country) : null;
    if (!country) {
      problems.push(`${label}: unreadable country ${JSON.stringify(period?.country)}`);
    }
    const start = toDayIndex(period?.startDate);
    const end = toDayIndex(period?.endDate);
    if (start === null || end === null) {
      problems.push(
        `${label}: unreadable dates ${JSON.stringify(period?.startDate)} → ${JSON.stringify(period?.endDate)}`
      );
      return;
    }
    if (end < start) {
      problems.push(`${label}: the stay ends (${period.endDate}) before it starts (${period.startDate})`);
    }
  });
  return problems;
}

/**
 * Merge inclusive [start, end] day-index intervals into disjoint ones, so a
 * calendar day recorded by two overlapping stays is still one day. Abutting
 * intervals are merged too; for a distinct-day COUNT that changes nothing, and
 * it keeps the list short. Same routine as `computePresenceDays()`.
 * @param {Array<[number, number]>} intervals
 * @returns {Array<[number, number]>} sorted, disjoint, non-abutting
 */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  /** @type {Array<[number, number]>} */
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Distinct days of `intervals` (already merged) falling inside [from, to]. */
function daysInWindow(intervals, from, to) {
  let days = 0;
  for (const [start, end] of intervals) {
    const overlapStart = Math.max(start, from);
    const overlapEnd = Math.min(end, to);
    if (overlapStart <= overlapEnd) days += overlapEnd - overlapStart + 1;
  }
  return days;
}

/**
 * Count the DISTINCT days in [windowStart, windowEnd] that an employee has
 * already spent in `country` per their `travelHistory`. Inclusive of both ends
 * (Reg. (EU) 2016/399 art. 6(2), D-07: the date of entry is the first day of
 * stay and the date of exit the last), clipped to the window — a period that
 * straddles the window edge counts for the in-window slice only.
 *
 * Pure arithmetic, no LLM. Re-implemented here rather than importing UC-08's
 * calculator so uc04 stays a self-contained module the suite can exercise
 * without loading UC-08's dossier-builder dependencies — but the two now really
 * do agree on the three things that matter: a union rather than a sum, an
 * explicit NOT_EVALUATED rather than a plausible number, and normalised country
 * matching on both sides.
 *
 * @param {object} args
 * @param {Array<{country:string, startDate:string, endDate:string}>} args.travelHistory
 * @param {string} args.country
 * @param {string} args.windowStart  "YYYY-MM-DD"
 * @param {string} args.windowEnd    "YYYY-MM-DD"
 * @returns {{days:number|null, periodsCounted:number, status:string, problems:string[]}}
 *   `status: "COUNTED"` with a number, or `status: "NOT_EVALUATED"` with
 *   `days: null` and `problems` naming every input that could not be read.
 *   Callers must render the NOT_EVALUATED case as "not computed" and must never
 *   let it reach a comparison — `null > 90` is false, which is the whole bug.
 */
export function computeCumulativeDays({ travelHistory, country, windowStart, windowEnd }) {
  const problems = travelHistoryProblems(travelHistory);

  const winStart = toDayIndex(windowStart);
  const winEnd = toDayIndex(windowEnd);
  if (winStart === null) problems.push(`unreadable windowStart: ${JSON.stringify(windowStart)}`);
  if (winEnd === null) problems.push(`unreadable windowEnd: ${JSON.stringify(windowEnd)}`);
  if (winStart !== null && winEnd !== null && winEnd < winStart) {
    problems.push(`window ends before it starts: ${windowStart} → ${windowEnd}`);
  }

  // Normalised on BOTH sides: a travel-history entry recorded as "es" must count
  // towards a Schengen 90/180 window for "ES", or the overstay block (finding
  // F-13) is bypassed by the history rather than by the destination.
  const target = normalizeCountryCode(country);
  // No usable country means no comparison is meaningful. This used to return
  // `{days: 0}` — a counted zero derived from a blank, which is the same
  // manufactured value the rest of this file exists to refuse.
  if (!target) problems.push(`unreadable country: ${JSON.stringify(country)}`);

  /** @type {Array<[number, number]>} */
  const intervals = [];
  let periodsCounted = 0;
  if (problems.length === 0) {
    for (const p of travelHistory ?? []) {
      if (normalizeCountryCode(p?.country) !== target) continue;
      const start = Math.max(/** @type {number} */ (toDayIndex(p.startDate)), winStart);
      const end = Math.min(/** @type {number} */ (toDayIndex(p.endDate)), winEnd);
      if (end < start) continue; // no overlap with the window at all
      intervals.push([start, end]);
      periodsCounted++;
    }
  }

  if (problems.length > 0) {
    // Explicit absence. A specialist chases a blank; they act on a number.
    return { days: null, periodsCounted: 0, status: DAYS_NOT_EVALUATED, problems };
  }

  // UNION, not sum — see defect 2 in this section's header.
  const days = daysInWindow(mergeIntervals(intervals), winStart, winEnd);
  return { days, periodsCounted, status: DAYS_COUNTED, problems };
}

/**
 * The Schengen short-stay allowance as Regulation (EU) 2016/399 actually states
 * it — the PEAK number of days of stay in any 180-day period ending on a day of
 * this trip, against the 90-day limit.
 *
 * THE SOURCE, QUOTED. `docs/knowledge/layer-1-statutory/D-07-eu-schengen-borders-code-2016-399.md`
 * carries art. 6(1) verbatim from the consolidated text `02016R0399 — EN —
 * 12.10.2025 — 006.001`:
 *
 *   "For intended stays on the territory of the Member States of a duration of
 *    no more than 90 days in any 180-day period, WHICH ENTAILS CONSIDERING THE
 *    180-DAY PERIOD PRECEDING EACH DAY OF STAY …"
 *
 * and art. 6(2):
 *
 *   "the date of entry shall be considered as the first day of stay … and the
 *    date of exit … as the last day of stay"
 *
 * WHAT THIS REPLACES (finding C-1). The old computation took ONE trailing
 * 180-day window anchored at the trip's start, counted the prior stays inside
 * it, added the trip's whole length, and compared that to 90. That is a
 * different computation from the one the article describes, and the divergence
 * is largest for exactly the multi-week workations UC-04 exists for. Worked
 * example, pinned in test/uc04.test.js:
 *
 *   Prior ES stay 2026-03-06 → 2026-05-04 (60 days), trip 2026-09-01 →
 *   2026-10-30 (60 days).
 *     per-trip window [2026-03-05, 2026-09-01]:  60 prior + 60 trip = 120 of 90
 *                                                → BLOCKED
 *     per day of stay, art. 6(1):                peak 61 of 90 on 2026-09-01
 *                                                → compliant
 *
 *   A compliant stay refused by 59 days.
 *
 * DIRECTION OF THE CHANGE, STATED HONESTLY. For a history whose stays all end
 * before the trip begins, the per-day peak is never GREATER than the old
 * single-window total: at any day D the window can hold at most the same prior
 * days and at most as many trip days. So this change can clear a request the old
 * arithmetic blocked and can never block one it cleared. That makes it a
 * RELAXATION, which is only defensible because it is what the regulation says —
 * hence the quotation above, and hence every previously-blocking scenario was
 * re-checked rather than assumed still blocking.
 *
 * WHAT IS NOT CHANGED HERE, deliberately:
 *   - The count is taken per destination country, which art. 6(1a) makes the
 *     NON-EES behaviour (finding C-3). Unchanged, and still reported as a
 *     caveat beside the figure.
 *   - Art. 6(2) also excludes stay authorised under a residence permit or
 *     long-stay visa from the count (finding C-2). This function has no
 *     representation of a permit, and `DNV_COUNTRIES` approximates the
 *     exclusion by attaching it to the DESTINATION rather than to the traveller
 *     holding the permit. That table and its suppression are a separately
 *     tracked gap and are deliberately untouched.
 *
 * @param {object} args
 * @param {Array<{country:string, startDate:string, endDate:string}>} args.travelHistory
 * @param {string} args.country    normalised destination code
 * @param {string} args.tripStart  "YYYY-MM-DD"
 * @param {string} args.tripEnd    "YYYY-MM-DD"
 * @returns {{
 *   status:string, peakDays:number|null, peakDate:string|null,
 *   window:{from:string,to:string,spanDays:number}|null,
 *   limit:number, windowDays:number, breached:boolean, problems:string[]
 * }}  `breached` is FALSE when the count could not be taken; the caller must
 *     read `status`, never `breached` alone. Callers in this file refuse before
 *     they get here, which is what makes that safe.
 */
export function schengenPeakDays({ travelHistory, country, tripStart, tripEnd }) {
  const problems = travelHistoryProblems(travelHistory);
  const target = normalizeCountryCode(country);
  if (!target) problems.push(`unreadable country: ${JSON.stringify(country)}`);
  const start = toDayIndex(tripStart);
  const end = toDayIndex(tripEnd);
  if (start === null) problems.push(`unreadable trip start: ${JSON.stringify(tripStart)}`);
  if (end === null) problems.push(`unreadable trip end: ${JSON.stringify(tripEnd)}`);
  if (start !== null && end !== null && end < start) {
    problems.push(`the trip ends (${tripEnd}) before it starts (${tripStart})`);
  }

  const base = { limit: SCHENGEN_LIMIT_DAYS, windowDays: SCHENGEN_WINDOW_DAYS, problems };
  if (problems.length > 0) {
    return { ...base, status: DAYS_NOT_EVALUATED, peakDays: null, peakDate: null, window: null, breached: false };
  }

  // Every day of stay in this destination that could fall inside any window:
  // the stated prior stays PLUS the requested trip itself, unioned so a stay a
  // requester restated does not count twice.
  /** @type {Array<[number, number]>} */
  const stays = [[/** @type {number} */ (start), /** @type {number} */ (end)]];
  for (const p of travelHistory ?? []) {
    if (normalizeCountryCode(p?.country) !== target) continue;
    stays.push([
      /** @type {number} */ (toDayIndex(p.startDate)),
      /** @type {number} */ (toDayIndex(p.endDate)),
    ]);
  }
  const merged = mergeIntervals(stays);

  // Scan every day of stay. Once D reaches tripStart + 180 the window
  // [D-179, D] lies entirely inside the trip and holds exactly 180 days, and
  // stays there for the rest of the trip — so scanning past that point can
  // discover nothing new, and the bound is a proof rather than a guess.
  const scanEnd = Math.min(/** @type {number} */ (end), /** @type {number} */ (start) + SCHENGEN_WINDOW_DAYS);
  let peakDays = 0;
  let peakDay = /** @type {number} */ (start);
  for (let day = /** @type {number} */ (start); day <= scanEnd; day++) {
    const from = day - (SCHENGEN_WINDOW_DAYS - 1); // a 180-day period ending on, and including, this day of stay
    const count = daysInWindow(merged, from, day);
    if (count > peakDays) {
      peakDays = count;
      peakDay = day;
    }
  }

  return {
    ...base,
    status: DAYS_COUNTED,
    peakDays,
    peakDate: toDateString(peakDay),
    window: {
      from: toDateString(peakDay - (SCHENGEN_WINDOW_DAYS - 1)),
      to: toDateString(peakDay),
      spanDays: SCHENGEN_WINDOW_DAYS,
    },
    breached: peakDays > SCHENGEN_LIMIT_DAYS,
  };
}

/**
 * How many days does the requested workation itself span? Pure arithmetic,
 * no LLM. Both endpoints inclusive, matching how Remote counts work
 * authorizations (a 1-day trip = start == end, not 0 days).
 *
 * RETURNS null WHEN NO LENGTH CAN BE STATED — finding F-32.
 * This used to return 0 for dates it could not read ("next Tuesday"), for
 * dates that were absent entirely, and for a pair the wrong way round. None of
 * those is a trip of zero days. Zero is a real answer to a real question, so
 * nothing errored and nothing flagged, and the record a specialist read
 * asserted a duration nobody had derived — the same class as UC-05's F-28,
 * UC-07's F-29 and the portal's F-30. Note that 0 is not even a value a real
 * trip can take: the count is inclusive, so the shortest possible trip is 1.
 *
 * `null` says "not derived"; 0 says "derived, and it came to zero". A reader
 * investigates the first and acts on the second (CLAUDE.md §9). Callers that
 * display the value must render the absence, not the number.
 *
 * @param {string} startDate  "YYYY-MM-DD"
 * @param {string} endDate    "YYYY-MM-DD"
 * @returns {number|null} inclusive day count, or null when it cannot be derived
 */
export function tripDurationDays(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Classify a (origin, destination) pair plus the worker's circumstances into
 * one of "low" | "medium" | "high" | "blocked", with the deterministic
 * reasons attached. Pure function — same reasoning as the other policy
 * engines in this repo: the rules live in code, are unit-testable without
 * any I/O, and never depend on ambient state.
 *
 * @param {object} args
 * @param {string} args.homeCountry           ISO 3166-1 alpha-2, the worker's primary work country
 * @param {string} args.destinationCountry    ISO 3166-1 alpha-2, where the workation is requested
 * @param {string} args.nationality           ISO 3166-1 alpha-2, the worker's passport country
 * @param {string} args.visaType              one of VISA_TYPES
 * @param {string} args.jobDuties             one of JOB_DUTY_CATEGORIES
 * @param {boolean} args.hasContractSigningAuthority
 * @param {string} args.startDate             "YYYY-MM-DD"
 * @param {string} args.endDate               "YYYY-MM-DD"
 * @param {string} args.now                   "YYYY-MM-DD" — used only for "request is in the past"
 * @param {Array<{country:string, startDate:string, endDate:string}>} [args.travelHistory]
 * @returns {{
 *   riskLevel: "low"|"medium"|"high"|"blocked",
 *   reasons: string[],
 *   flags: string[],
 *   tripDays: number|null,
 *   cumulativeDays: {days:number, periodsCounted:number}|null,
 *   considerations: string[]
 * }}
 */
export function classifyRisk(args) {
  const {
    homeCountry: rawHomeCountry,
    destinationCountry: rawDestinationCountry,
    nationality: rawNationality,
    visaType,
    jobDuties,
    hasContractSigningAuthority,
    startDate,
    endDate,
    now,
    travelHistory = [],
    // Caller-overridable, same shape as UC-03's `sanctionedRegions`, so a
    // workflow that DOES read `GET /v1/countries` can pass the registry's own
    // exclusions in rather than relying on the static default. UC-04's
    // workflow does not fetch the registry today (see the note in
    // policyEngine.js), which is why the default is the static set and not an
    // empty one: an empty default would make this gate silently vacuous, which
    // is precisely the failure mode this whole change exists to remove.
    restrictedJurisdictions = RESTRICTED_JURISDICTIONS,
  } = args;

  // THE boundary. Everything below reads these three, never the raw args —
  // see the file header's note on finding F-13.
  const homeCountry = normalizeCountryCode(rawHomeCountry);
  const destinationCountry = normalizeCountryCode(rawDestinationCountry);
  const nationality = normalizeCountryCode(rawNationality);

  const reasons = [];
  const flags = [];
  const considerations = [];

  // Hard blocks first — these cannot be overridden by an approval, only by
  // re-submitting with corrected input.
  //
  // The jurisdiction screen goes FIRST in this group because `reasons[0]` is
  // what policyEngine.js reports as the decision's reason, and a restricted
  // destination is the headline: "we cannot support work from this
  // jurisdiction" is the answer, and "your dates are the wrong way round" is
  // not, even when both are true. Normalised on both sides (the key and the
  // set) — a lowercase "ir" that matched nothing was finding F-13, and it is
  // the same one-line mistake here as it was in UC-03.
  if (destinationCountry && normalizeCountrySet(restrictedJurisdictions).has(destinationCountry)) {
    reasons.push("sanctioned_region");
    flags.push("sanctioned_region");
  }

  if (homeCountry === destinationCountry) {
    reasons.push("same_country_workation");
    flags.push("same_country");
  }

  if (visaType === VISA_TYPES.esta_usa || visaType === VISA_TYPES.tourist_visa) {
    // The US ESTA and any short-term tourist visa are visitor-only — they
    // forbid active remote work in the host country, regardless of how short
    // the stay. This is the matrix's most-cited "blocked" rule: it is the
    // difference between "the request needs more review" and "the request is
    // asking for something illegal as worded."
    reasons.push("visitor_visa_active_work_forbidden");
    flags.push("visitor_visa_blocks_remote_work");
  }

  if (Number.isNaN(new Date(startDate).getTime()) || Number.isNaN(new Date(endDate).getTime())) {
    reasons.push("invalid_date");
    flags.push("invalid_dates");
  } else if (new Date(endDate) < new Date(startDate)) {
    reasons.push("end_before_start");
    flags.push("invalid_dates");
  }

  // AN UNREADABLE PRIOR STAY IS A HARD BLOCK, NOT A QUIET ZERO.
  // This is the gate half of the NaN defect written up at the top of the day
  // arithmetic section. `computeCumulativeDays()` now refuses for itself and
  // returns `days: null`; a null reaching either threshold below would compare
  // FALSE against both 90 and 183 and clear the request, which is the original
  // bug wearing a tidier type. So the refusal is turned into a decision HERE,
  // once, before any window is chosen — and it names the row, because "one of
  // your prior stays is unreadable" without saying which is a refusal nobody
  // can act on. `blocked` rather than `escalate` on purpose: this is the same
  // "re-submit with corrected input" shape as `invalid_date`, and it is the
  // verdict the portal's own intake guard already returns by this name.
  const historyProblems = travelHistoryProblems(travelHistory);
  if (historyProblems.length > 0) {
    reasons.push("travel_history_unreadable");
    flags.push("travel_history_unreadable");
  }

  if (new Date(startDate) < new Date(now)) {
    reasons.push("start_in_past");
    flags.push("start_in_past");
  }

  // null when the dates could not be read at all, or run backwards (F-32).
  // Every input that produces a null has ALREADY pushed a reason above
  // (`invalid_date` / `end_before_start`), so the blocked return immediately
  // below always fires first and the two `+ tripDays` sums further down can
  // never see it. That is asserted by test/uc04.test.js's "F-32 STRUCTURAL"
  // case rather than guarded here: defensively guarding an unreachable path is
  // how a codebase stops telling the truth about what can happen
  // (docs/BUILD-LOG.md §3.31). If someone ever moves a threshold above that
  // return, the test fails rather than the arithmetic silently reading null
  // as zero.
  const tripDays = tripDurationDays(startDate, endDate);

  if (reasons.length > 0) {
    return { riskLevel: "blocked", reasons, flags, tripDays, cumulativeDays: null, schengen: null, travelHistoryProblems: historyProblems, considerations, normalized: { homeCountry, destinationCountry, nationality } };
  }

  // --- Schengen visa-free 90/180 window (statutory, not invented) --------
  // The window is now the one Reg. (EU) 2016/399 art. 6(1) describes — "the
  // 180-day period preceding EACH day of stay" — rather than a single window
  // anchored at the trip's start. See schengenPeakDays()'s header for the
  // quoted source (D-07), the worked example, and what is deliberately NOT
  // changed (the DNV suppression on the line below, C-2's permit exclusion,
  // and C-3's per-country counting).
  //
  // `schengen` is carried on the result because the figure the matrix computes
  // used to die with the function that computed it: decisionFacts.js reported
  // the Schengen row with `measured: null` and its own `whatItWouldTake` named
  // this exact fix ("the Schengen total carried on `risk`"). A limit reported
  // without the measurement behind it is a rule a reader already knew.
  let schengen = null;
  if (SCHENGEN.has(destinationCountry) && nationality && !DNV_COUNTRIES.has(destinationCountry)) {
    schengen = schengenPeakDays({
      travelHistory,
      country: destinationCountry,
      tripStart: startDate,
      tripEnd: endDate,
    });
    // `status` is COUNTED by construction: every input that could make it
    // NOT_EVALUATED — an unreadable prior stay, an unreadable or reversed trip
    // date — has already pushed a reason above and returned `blocked`. Asserted
    // by test rather than guarded here, the same convention as `tripDays`
    // above: defensively guarding an unreachable path is how a codebase stops
    // telling the truth about what can happen (docs/BUILD-LOG.md §3.31), and if
    // someone moves this block above that return the test fails loudly instead
    // of `null > 90` quietly clearing an overstay.
    if (schengen.breached) {
      reasons.push("schengen_90_180_exceeded");
      flags.push("schengen_overstay");
    } else if (visaType !== VISA_TYPES.schengen_short_stay && visaType !== VISA_TYPES.business_visa) {
      // Reaching for a "schengen_short_stay" or formal business visa is
      // fine on a short Schengen workation; an unknown/other visa in
      // Schengen is a medium flag, not a block.
      flags.push("schengen_visa_unverified");
    }
  }

  // --- US / Canada work-permit gate ---------------------------------------
  if (destinationCountry === "US" && visaType !== VISA_TYPES.work_permit) {
    reasons.push("us_requires_work_permit");
    flags.push("us_requires_work_permit");
  }
  if (destinationCountry === "CA" && visaType !== VISA_TYPES.work_permit) {
    reasons.push("ca_requires_work_permit");
    flags.push("ca_requires_work_permit");
  }

  if (reasons.length > 0) {
    // `schengen` is NOT nulled here: when the Schengen block is what refused,
    // the peak it measured is the evidence for the refusal, and dropping it
    // would leave a `schengen_90_180_exceeded` with no figure behind it — which
    // is the state decisionFacts.js had to apologise for in prose.
    return { riskLevel: "blocked", reasons, flags, tripDays, cumulativeDays: null, schengen, travelHistoryProblems: historyProblems, considerations, normalized: { homeCountry, destinationCountry, nationality } };
  }

  // --- Destination outside everything the matrix knows about ---------------
  // UC-04.md §3's escalate-by-default rule (finding F-14). This is NOT a
  // block: the request may well be fine, and a mobility specialist is exactly
  // the person to say so. It is a refusal to present an unevaluated country
  // as a cleared one on a 1-click approval screen. It also catches a
  // destination that is not a country code at all ("United States", "1") —
  // those cannot be in the set either, so no separate format rule is needed.
  if (!KNOWN_DESTINATIONS.has(destinationCountry)) {
    considerations.push("destination_outside_curated_scope");
    flags.push("destination_out_of_scope");
  }

  // --- Now the soft-risk ordering: which consideration pushes the trip
  // from "low" to "medium" or "high". These do NOT block — they escalate
  // for human attention.
  if (hasContractSigningAuthority || jobDuties === JOB_DUTY_CATEGORIES.executive) {
    considerations.push("contract_signing_or_executive_role");
    flags.push("pe_risk_dape");
  }
  if (jobDuties === JOB_DUTY_CATEGORIES.sales || jobDuties === JOB_DUTY_CATEGORIES.legal) {
    considerations.push("client_negotiation_role");
    flags.push("pe_risk_dape");
  }

  // A1-covered EU/EEA pair — social-security coordination is the right tool,
  // so the worker isn't creating a fresh local payroll liability. The matrix
  // notes it but does not move the level; the spec calls for the A1 cert to
  // be a follow-up, not a gate.
  if (EU_EEA_FOR_A1.has(homeCountry) && EU_EEA_FOR_A1.has(destinationCountry) && homeCountry !== destinationCountry) {
    considerations.push("eu_eea_a1_path");
    flags.push("a1_certificate_recommended");
  }

  // Non-treaty pair (one we know is unsigned) — bump to medium.
  const pairKey = `${nationality}_${destinationCountry}`;
  if (NON_TREATY_PAIRS.has(pairKey)) {
    considerations.push("non_treaty_pair");
    flags.push("non_treaty_pair");
  }

  // Long cumulative presence pushes toward medium (tax-residency watch).
  // We compute the trailing 365-day window, same shape as UC-08's calculator
  // for the same reason.
  //
  // This one stays anchored at the trip start ON PURPOSE. 183-in-365 is not a
  // statute — it is this system's own screening line, applied uniformly to
  // every destination (decisionFacts.js says so on the row it prints, and C-12
  // records that the four national residence tests it stands in for are
  // differently shaped, one of which counts no days at all). The per-day-of-stay
  // reading above is Reg. (EU) 2016/399's own words about ITS OWN allowance;
  // carrying it across to a threshold no instrument states would be inventing a
  // method for a rule that has none.
  //
  // `cumulativeDays.days` is a number here for the same structural reason
  // `schengen.status` is COUNTED: an unreadable prior stay returned `blocked`
  // long before this line. Pinned by test, not by a guard.
  let cumulativeDays = null;
  if (destinationCountry && homeCountry !== destinationCountry) {
    const startMs = new Date(startDate).getTime();
    const winStart = new Date(startMs - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const winEnd = startDate;
    cumulativeDays = computeCumulativeDays({ travelHistory, country: destinationCountry, windowStart: winStart, windowEnd: winEnd });
    if (cumulativeDays.days + tripDays > 183) {
      considerations.push("approaching_tax_residency_threshold");
      flags.push("tax_residency_watch");
    }
  }

  // Order the level: "high" if any PE-risk flag OR an unevaluated
  // destination, then "medium" if any non-treaty / tax-watch flag, then
  // "low". Pure ordering, no LLM. "high" is what policyEngine.js turns into
  // an escalation, which is the whole point of the out-of-scope flag.
  let riskLevel = "low";
  if (flags.includes("pe_risk_dape") || flags.includes("destination_out_of_scope")) riskLevel = "high";
  else if (
    flags.includes("non_treaty_pair") ||
    flags.includes("tax_residency_watch") ||
    flags.includes("schengen_visa_unverified")
  )
    riskLevel = "medium";

  return {
    riskLevel,
    reasons,
    flags,
    tripDays,
    cumulativeDays,
    // The Schengen peak this trip actually reached, and the 180-day window that
    // produced it — null when the allowance never governed the trip (outside
    // Schengen, no nationality stated) or was suppressed by DNV_COUNTRIES.
    // decisionFacts.js reports it; nothing re-derives it.
    schengen,
    // Empty on every decision that got this far, by construction — a non-empty
    // list is a `blocked` above. Carried anyway so the shape is the same on
    // every return and a reader never has to know which branch produced the row.
    travelHistoryProblems: historyProblems,
    considerations,
    // The canonical codes every rule above actually judged. Its consumer used to
    // be a Remote write that no longer exists; it is now the destination
    // workflow.js MATCHES a Remote work-authorization request on, so dropping it
    // would stop " es " resolving a record that says "ES" — a failure that
    // presents as an absence rather than a mismatch.
    normalized: { homeCountry, destinationCountry, nationality },
  };
}
