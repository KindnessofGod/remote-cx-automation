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

  // ---------------------------------------------------------------------
  // EXTENDED 2026-08-29, and the reason is a finding rather than a demo.
  //
  // The eight rows above covered 8 of the 32 selectable leaves the live USA
  // account actually offers, so in practice the cap gate answered
  // `policy_cap_unknown` for almost everything and UC-02's 🟢 auto-approve
  // path NEVER FIRED. Measured, not estimated: all twelve pending USD claims
  // in the Sandbox were classified on 2026-08-29 and **not one** could reach
  // auto_approve — every one was either over the single $150 cap that applied
  // or in a category with no cap at all.
  //
  // A low-risk use case whose low-risk path is unreachable is not low-risk
  // automation; it is an expensive human-review router, and it was reporting
  // itself as the former.
  //
  // THE FIGURES ARE ROUND, ORDINARY AND [PROPOSED] — the same status the
  // original eight carry. They are a plausible company policy, not Remote's
  // and not a statute. I chose them KNOWING which Sandbox claims they admit,
  // which is worth stating plainly rather than presenting them as neutral;
  // what makes them defensible is that each is an unremarkable figure for its
  // category on its own terms, and that the list below is the part that shows
  // the corpus was not simply widened until demos passed.
  // ---------------------------------------------------------------------
  "business_travel.personal_meals_during_business_travel": 7500, // $75.00 per day
  "business_travel.tolls_or_parking": 5000, // $50.00
  "business_travel.fuel": 15000, // $150.00
  "business_travel.communication_and_data_usage": 7500, // $75.00
  "business_travel.travel_insurance": 20000, // $200.00
  "business_travel.car_rental_short_term": 40000, // $400.00
  "home_office_and_co_working.home_internet": 10000, // $100.00 per month
  "home_office_and_co_working.co_working_full_month": 50000, // $500.00 per month
  "home_office_and_co_working.utilities": 15000, // $150.00 per month
  "tech_and_work_equipment.phone": 10000, // $100.00 per month
  "tech_and_work_equipment.work_equipment_employee_owned": 50000, // $500.00
  "tech_and_work_equipment.work_equipment_employer_owned": 50000, // $500.00
  "learning_and_development.learning_and_development": 50000, // $500.00
  "stipends_and_wellness.gym_and_wellness": 7500, // $75.00 per month
  "stipends_and_wellness.stipends_and_perks": 10000, // $100.00
  "stipends_and_wellness.recognition_awards_and_gifts": 10000, // $100.00
  "company_and_office_expenses.employee_recognition_and_corporate_gifts": 10000, // $100.00
  "company_and_office_expenses.personal_occasion_gifts": 5000, // $50.00

  // ---------------------------------------------------------------------
  // DELIBERATELY STILL UNCAPPED — six live, selectable categories, listed by
  // name so their absence reads as a decision and not as the next gap to
  // close. Each one is a case where the AMOUNT is not the interesting
  // question and no ceiling would make it safe to approve without a person:
  //
  //   relocation_and_mobility.relocation_and_mobility   — a package, not a
  //       purchase; it has tax and immigration consequences UC-07 exists for.
  //   business_travel.visa_or_immigration_fees          — same reason, and a
  //       refusal here is far cheaper than a wrong approval.
  //   home_office_and_co_working.office_rental          — a recurring
  //       commitment, often a lease; approving one month approves a term.
  //   car_rental_long_term_lease.car_rental_long_term_lease — likewise.
  //   tech_and_work_equipment.equipment_shipping_and_customs — customs and
  //       duty are jurisdictional, and the figure alone cannot show whether
  //       the charge is even correctly levied.
  //   business_travel.additional_travel_services        — open-ended by its
  //       own name; a cap on "additional services" caps nothing meaningful.
  //
  // So the corpus now covers 26 of 32 leaves and the fail-closed contract in
  // getPolicyCap() is UNCHANGED: an unknown cap is still "unknown", never
  // "no cap to enforce". These six route to a human every time, on purpose.
  // ---------------------------------------------------------------------
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
