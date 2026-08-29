// ---------------------------------------------------------------------------
// policyCaps.js  —  UC-02 per-category spend caps (the policy-cap gate's data)
// ---------------------------------------------------------------------------
// WHY THIS IS A SMALL TABLE, NOT A RAG RETRIEVER
// UC-02.md §3 lists "Company expense policy" as a [PROPOSED] Policy RAG index
// — the repo has no such index for expenses. The honest interim is exactly
// what UC-08's treaty retriever did before issue #29 gave it embeddings: a
// small, hand-curated, clearly-labelled corpus. The caps below are that
// corpus — mock policy numbers ([PROPOSED], not drawn from any real Remote
// customer policy) keyed by the category ids the mock server returns, so the
// deterministic gate in policyEngine.js has something real to compare against
// instead of silently approving everything.
//
// MONEY: every cap is an integer ×100, matching Remote's representation —
// 50000 means $500.00. Comparing in the integer domain is what keeps the
// gate free of floating-point drift (00-FOUNDATION.md §4 invariant #1).
//
// KEYED BY THE REAL API'S `code`, NOT BY AN INVENTED ID. These keys used to be
// `cat_meals`/`cat_travel`/… — ids that existed only in this repo's mock. A
// real Remote category row has no `id` field at all; its stable identifier is
// `code` (e.g. "business_travel.accommodation"), which is also what the API
// itself uses to reference a parent. Every code below was read from the live
// sandbox on 2026-08-17, not invented — an unknown key here fails closed
// (see getPolicyCap), so a typo costs a human review, never a wrong cap.
// ---------------------------------------------------------------------------

/**
 * The currency every cap in this corpus is denominated in.
 *
 * WHY THIS HAS TO EXIST AT ALL. The caps below are bare integers: 50000 means
 * 500.00 of *something*. Until this constant existed, `policyEngine.js`
 * compared them against `expense.amount`, which is in the expense's ORIGINAL
 * currency — and the live account bills in EUR, USD, CAD, SGD and GBP. So a
 * £1,000 expense (`amount: 100000` in pence) was measured against a $500 cap as
 * though pence were cents. The comparison always ran, always produced an
 * answer, and was wrong for every employee not paid in the corpus's currency.
 *
 * The engine now compares against `converted_amount` — "the expense amount
 * converted to the company's billing currency" — and refuses to enforce the cap
 * at all when the billing currency is not this one (`policy_cap_currency_
 * mismatch`, a human review). Refusing to compare is the honest outcome when
 * the two numbers are not in the same units; a cap corpus per currency is real
 * policy data this repo does not have and must not invent.
 *
 * [PROPOSED] like the caps themselves — see the header.
 */
export const POLICY_CAP_CURRENCY = "USD";

// Object.create(null) — NOT an object literal. A literal inherits from
// Object.prototype, so POLICY_CAPS["constructor"] / ["toString"] /
// ["valueOf"] return inherited FUNCTIONS rather than undefined, and a
// `?? null` lookup happily hands one back as if it were a cap. A
// prototype-less bag (and the Map below) makes that class of lookup
// impossible rather than merely unlikely.
export const POLICY_CAPS = Object.assign(Object.create(null), {
  "work_meals_and_entertainment.internal_meals_and_entertainment": 50000, // $500.00
  "work_meals_and_entertainment.external_meals_and_entertainment": 30000, // $300.00
  "business_travel.accommodation": 100000, // $1,000.00
  "business_travel.travel_long_distance": 100000, // $1,000.00
  "business_travel.local_transportation": 20000, // $200.00
  "home_office_and_co_working.co_working_part_time_or_daily": 25000, // $250.00
  "tech_and_work_equipment.software_and_subscriptions": 20000, // $200.00
  "company_and_office_expenses.office_supplies_and_shipping": 15000, // $150.00
  // NOTE the real, selectable categories deliberately ABSENT from this table
  // (personal_occasion_gifts, relocation_and_mobility, visa_or_immigration_fees
  // and the rest of the live list's 32 leaves). They are not oversights: the
  // live account offers far more categories than any hand-curated corpus will
  // cover, and the F-12 contract below turns every one of them into a human
  // review rather than an unbounded approval. That gap IS the design.
});

/** Own-key-only lookup table — a Map has no prototype chain to walk. */
const CAPS = new Map(Object.entries(POLICY_CAPS));

/**
 * The spend cap for a category, or null when the corpus defines none.
 *
 * FAIL-CLOSED CONTRACT (finding F-12): null here means "UNKNOWN cap", never
 * "no cap to enforce". The corpus covers five categories; a real Remote
 * account can return many more, and the gate that reads this
 * (policyEngine.js's cap gate) must route an unknown cap to a human rather
 * than approve an unbounded amount. Every other unknown in this project
 * fails closed; this one used to be the exception.
 *
 * @param {string|null} categoryId
 * @returns {number|null} cap in integer ×100, or null when unknown
 */
export function getPolicyCap(categoryId) {
  if (typeof categoryId !== "string" || !categoryId) return null;
  const cap = CAPS.get(categoryId);
  // Guard the VALUE too: only a real, finite, non-negative integer ×100 is a
  // cap. Anything else is an unknown, and unknowns fail closed.
  return Number.isSafeInteger(cap) && cap >= 0 ? cap : null;
}
