// ---------------------------------------------------------------------------
// policyEngine.js  —  UC-09 business logic: when to require dual/triple approval
// ---------------------------------------------------------------------------
// WHY THIS EXISTS  
// The deterministic logic that decides how many approvals are required for each
// off-cycle payroll adjustment. Unlike UC-06 which has a fixed 2-person dual
// approval, UC-09 implements the "floor of 2 + possible escalation to 3"
// pattern described in the spec: every adjustment needs at least 2 people
// (requester + approver), but higher-risk ones (e.g. over threshold amounts)
// need 3 (requester + approver + payment_releaser). Critical invariant: the
// AI itself may never execute anything, regardless of risk score — only the
// human approval floor can vary.
// ---------------------------------------------------------------------------

import { validateAgainstSchema } from "../shared/schemaValidator.js";
import { findUpstreamFailure, upstreamVerdict } from "../shared/upstreamFailure.js";
import { bindGateDescriptions } from "../shared/gateLadder.js";

// Fields a valid incentive payload must carry before any approval slot is
// offered — exactly what prepareIncentivePayload() below always populates.
// NOT Remote's employment_basic_information schema (job_title/weekly_hours,
// what remote.getCountrySchema() returns) — that's the schema for UC-06's
// *basic-information* PATCH, a completely different Remote write than the
// `POST /v1/incentives` this use case makes. There is no incentive-specific
// schema ENDPOINT to fetch, so this is a fixed, code-defined requirement list
// rather than an invented fetch. workflow.js used to pass UC-06's schema
// straight through here, which meant every real incentive payload failed
// `schema_invalid` on job_title/weekly_hours it has no business carrying.
//
// THIS LIST IS NOW REMOTE'S OWN, COPIED FROM THE SCHEMA, NOT GUESSED.
// `[CONFIRMED 2026-08-19]` `CreateOneTimeIncentiveParams.required` on
// `POST /v1/incentives` reads, verbatim and in this order:
//   ["type", "amount", "amount_tax_type", "employment_id", "effective_date"]
// It previously read `["employment_id","type","amount","currency"]`, wrong in
// BOTH directions at once, which is worse than having no validator:
//   - it REQUIRED `currency`, which is not a property of
//     `CommonIncentiveParams` or `CreateOneTimeIncentiveParams` at all.
//     `[CONFIRMED]` *"Incentives use the currency of the employment specified
//     provided in the `employment_id` field"*, and the amount is *"The amount
//     (in the currency of the employment)"*. Remote ignores anything we say
//     about currency.
//   - it OMITTED `amount_tax_type` and `effective_date`, both of which Remote
//     requires. So the gate handed out a green light on a payload Remote would
//     have rejected — the specific failure mode of a validator that disagrees
//     with the API it is validating for.
export const INCENTIVE_REQUIRED_FIELDS = ["type", "amount", "amount_tax_type", "employment_id", "effective_date"];

// ---------------------------------------------------------------------------
// The risk thresholds, EXPORTED — because an approver is entitled to the number
// ---------------------------------------------------------------------------
// These two used to be local literals inside assessRisk(), so the only thing
// that ever reached a human was the flag string `high_amount_risk`. That is
// C-27 on the money path: the system holds the amount, the threshold, the
// overage and the percentage — it cannot raise the flag without all four — and
// told a payment releaser only that an adjustment was "high amount". They are
// exported so approvalView.js can state the actual figures WITHOUT keeping a
// second copy of them; a second copy of a threshold is a copy that drifts, and
// a wrong explanation of a right refusal reads exactly like a right one.
//
// Both remain the gate's OWN values: nothing here changes what assessRisk()
// decides, only what a reader is told about the decision.

/**
 * THE CURRENCY THE HIGH-VALUE THRESHOLD IS DENOMINATED IN.
 *
 * This constant is the whole fix for a defect that made the threshold below
 * mean nothing at all. `assessRisk()` compared `adjustment.amount > 1000000`
 * with no currency check anywhere, so one line meant "10,000 of whatever unit
 * arrived": 10,000 JPY (~USD 65) and 10,000 USD summoned exactly the same
 * number of signatures, and 10,001 JPY summoned three. Worse, `approvalView.js`
 * rendered the threshold as `formatMoney(threshold, theRequestsCurrency)`, so
 * the screen a payment releaser reads printed "€10,000.00 high-value threshold"
 * — a denomination the gate did not have and had never checked. The comparison
 * always ran, always produced an answer, and was wrong for every employee not
 * paid in this one currency. Exactly the shape of UC-02's policy-cap bug
 * (`src/uc02/policyCaps.js`'s header), one use case over and on the path that
 * actually moves money.
 *
 * WHY `USD`. It is not a conversion and not a guess about FX: it is the
 * denomination the existing repo-defined policy figure was always written in
 * (every seeded request, every demo fixture and every worked example in this
 * use case's docs states the line as $10,000.00), now stated instead of
 * assumed. It matches `POLICY_CAP_CURRENCY` in `src/uc02/policyCaps.js` for the
 * same reason.
 */
export const HIGH_AMOUNT_THRESHOLD_CURRENCY = "USD";

/**
 * Remote ×100 integer, in `HIGH_AMOUNT_THRESHOLD_CURRENCY`. Above this
 * (strictly), a third signature is required.
 *
 * Kept as its own export because it is the BASE line every other entry in the
 * table below is constrained against — see `HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY`.
 */
export const HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER = 1000000;

/**
 * The high-value line, per currency — and the rule for adding a row.
 *
 * ONE ENTRY, BECAUSE ONE POLICY FIGURE EXISTS. The obvious "fix" for a
 * currency-blind threshold is to convert: hold one line in USD and divide by an
 * exchange rate. **That is forbidden here and the reason is not stylistic.** An
 * FX rate is a value with a source, a timestamp and a bid/ask — this repository
 * has none of those, cannot fetch one on the request path without making a
 * payment control depend on a third-party quote, and must never hard-code one.
 * A hard-coded rate is a manufactured value on the one code path in this
 * repository that POSTs money, which is the exact class of defect
 * `prepareIncentivePayload()` below already refuses twice (the manufactured
 * zero, the manufactured gross/net reading).
 *
 * WHAT MAY BE ADDED HERE, AND WHAT MAY NOT.
 *   MAY:     a STATED POLICY FIGURE — "the business has decided that in EUR the
 *            high-value line is €8,000.00" — carrying whoever stated it. A
 *            policy figure is a business rule; it needs an owner, not a rate.
 *   MAY NOT: `EUR: Math.round(1000000 / rate)`, or the same numeral copied
 *            across currencies (`EUR: 1000000`), which is an exchange rate of
 *            1.0 wearing a policy figure's clothes.
 *
 * THE CONSTRAINT ON ANY ROW ADDED. Every entry must be **less than or equal
 * to** `HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER`. A higher line would let an
 * amount that used to require three signatures require only two — a REDUCTION
 * in the approval requirement, which is the one direction this gate may never
 * move. `test/uc09ApprovalFloor.test.js` asserts it over the table itself, so
 * a row that breaks it fails the suite rather than quietly loosening a money
 * control.
 *
 * `Object.create(null)`, NOT an object literal — the same lesson
 * `src/uc02/policyCaps.js` records: a literal inherits from `Object.prototype`,
 * so `TABLE["constructor"]` hands back a FUNCTION that a `?? null` lookup
 * happily treats as a threshold. The Map below has no prototype chain to walk.
 */
export const HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY = Object.freeze(
  Object.assign(Object.create(null), {
    [HIGH_AMOUNT_THRESHOLD_CURRENCY]: HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
  })
);

const THRESHOLDS_BY_CURRENCY = new Map(Object.entries(HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY));

/**
 * `"usd"` / `" USD "` -> `"USD"`; anything that is not a currency code -> null.
 * A code we cannot read is not a code we may compare.
 */
export function normalizeCurrencyCode(currency) {
  if (typeof currency !== "string") return null;
  const code = currency.trim().toUpperCase();
  return code ? code : null;
}

/**
 * The high-value line for a currency, or **null when no policy figure exists
 * for it**.
 *
 * NULL MEANS "CANNOT BE COMPARED", NEVER "NO LINE TO CLEAR" — the same
 * fail-closed contract `policyCapFor()` carries in UC-02. `assessRisk()` reads
 * a null here as an unknown and raises the signature requirement to its
 * maximum; it must never be read as an amount that came in under the line.
 *
 * @param {string|null|undefined} currency
 * @returns {number|null} Remote ×100 integer, or null
 */
export function highAmountThresholdFor(currency) {
  const code = normalizeCurrencyCode(currency);
  if (!code) return null;
  const threshold = THRESHOLDS_BY_CURRENCY.get(code);
  return Number.isInteger(threshold) ? threshold : null;
}

/**
 * Countries whose payroll-tax complexity raises the signature floor to three —
 * AND, inseparably, the fact that this list has no authority behind it.
 *
 * -------------------------------------------------------------------------
 * THIS IS AN UNSOURCED HEURISTIC DRIVING A REAL MONEY CONTROL, AND IT NOW SAYS SO
 * -------------------------------------------------------------------------
 * It was `["DE", "FR", "IT"] // Hypothetical high-tax-complexity countries` —
 * three country codes somebody chose, deciding how many humans must sign before
 * a real payment leaves a real account. `docs/KNOWLEDGE-SOURCES.md` §1 Test B
 * names it as the clearest instance in this repository of *"if this were wrong,
 * nothing would catch it"*, and §12 item 2 gives the remedy: **bind it to a
 * source, or make it impossible to read as a compliance determination.** There
 * is no source, so this is the second.
 *
 * WHICH DIRECTION THE HARM RUNS, BECAUSE IT IS THE OPPOSITE OF THE OBVIOUS ONE.
 * For DE/FR/IT the list fails SAFE: it only ever RAISES the signature count, and
 * `Math.max(2, …)` means no entry here can ever lower it. The danger is the
 * inverse — a genuinely high-complexity jurisdiction that is simply **not on
 * this list** gets two signatures where it should get three, silently, and
 * nothing anywhere told anyone the list was a guess. An approver seeing
 * `high_tax_compliance_risk` had no way to know; the only record of the basis
 * was a source comment they will never read.
 *
 * WHY NOT JUST ADD MORE COUNTRIES. Because a longer invented list is the same
 * defect with more rows, and it would look more authoritative while being no
 * better founded. `docs/KNOWLEDGE-SOURCES.md` L1-13 sets the bar this would have
 * to clear (a named authority, a version, an effective date, an owner and a
 * review date); `requiredForARealVersion` below records it as a requirement
 * rather than leaving it as a comment.
 *
 * WHAT DOES NOT CHANGE. The gate's behaviour: the same three codes, the same
 * flag string, the same escalation to three. Renaming the flag was considered
 * and rejected — it is compared field-for-field against
 * `workflows/nodes-uc09/adjustmentGates.js` (test/n8nUc09Parity.test.js), so a
 * rename here alone is a silent divergence between the two execution paths,
 * which is a worse defect than the one being fixed. The basis travels beside the
 * flag instead: on `evaluate()`'s return, in the audit row, and on the API view
 * the approver actually reads.
 */
export const HIGH_TAX_COMPLEXITY_HEURISTIC = Object.freeze({
  countries: Object.freeze(["DE", "FR", "IT"]),
  /** `sourced` | `unsourced_heuristic` — the one field a reader must not miss. */
  basis: "unsourced_heuristic",
  authority: null,
  version: null,
  retrievedOn: null,
  reviewDue: null,
  provenance:
    "Illustrative only, with no authority behind it. These three country codes were chosen to demonstrate a " +
    "jurisdiction risk dimension. They are not a researched statement about German, French or Italian payroll-tax " +
    "law, and the absence of a country from this list is NOT a finding that its payroll tax is simple.",
  requiredForARealVersion: Object.freeze([
    "a named publishing authority for the complexity assessment",
    "a version or effective date for the list as published",
    "the date this copy was retrieved from that authority",
    "a named owner and a review date, with an alert when the review date passes",
  ]),
});

/**
 * The bare code list, for the gate. Kept as its own export so the gate reads a
 * plain array while everything that REPORTS the gate reads the provenance
 * beside it — one definition, two views, no second copy to drift.
 */
export const HIGH_TAX_COMPLEXITY_COUNTRIES = HIGH_TAX_COMPLEXITY_HEURISTIC.countries;

// `AmountTaxType`, the enum on the required `amount_tax_type` field.
// `[CONFIRMED]` — and this is a MONEY field, not a naming one. Remote:
//   "`gross` indicates that the amount given is the amount to be paid before
//    taxes are subtracted. `net` indicates that the amount which will be paid
//    to the employee after taxes. Remote will gross this up to ensure the
//    taxes are included and employee receives the amount requested without
//    further reduction."
// So the SAME integer moves a DIFFERENT amount of money out of the company's
// account depending on this one word. The field we used to send —
// `tax_calculation_method: "automatic"` — is not a member of anything Remote
// defines, and `automatic` is not a reading of the amount; it is a claim about
// who does the arithmetic. There is no safe default here, which is why nothing
// in this file supplies one: an unstated gross/net is the same class of
// manufactured value as the manufactured zero prepareIncentivePayload() below
// already refuses, and it is a manufactured value of the more expensive kind.
export const AMOUNT_TAX_TYPES = Object.freeze(["gross", "net"]);

// `CreateOneTimeIncentiveParams.type`, all 21 members, `[CONFIRMED 2026-08-19]`
// read off the OpenAPI on Remote's own `post_v1_incentives` page. Checked
// BEFORE approvals are collected, because a type Remote does not know is a 422
// waiting at the end of a two- or three-person signature process — the request
// would be refused after the humans had already spent their time on it, at the
// one moment nobody is watching for a schema error. The recurring resource
// publishes a DIFFERENT list (20 members, no `signing_bonus`); this is the
// one-time list, which is the resource UC-09 writes to.
export const INCENTIVE_TYPES = Object.freeze([
  "acting_up_allowance",
  "allowance",
  "car_allowance",
  "health_and_wellness_allowance",
  "internet_allowance",
  "meal_allowance",
  "on_call_allowance",
  "parenthood_allowance",
  "phone_allowance",
  "relocation_allowance",
  "travel_allowance",
  "work_from_home_allowance",
  "bonus",
  "holiday_bonus",
  "referral_bonus",
  "retention_bonus",
  "commission",
  "other",
  "overtime",
  "stipend",
  "signing_bonus",
]);

/**
 * Evaluate a proposed off-cycle payroll adjustment request against all
 * deterministic gates. Never makes an API call or hits a database.
 * @param {object} args
 * @param {boolean} args.identityVerified  — matched employment record to session
 * @param {object} args.employment  — fetched from Remote
 * @param {object} args.incentiveSchema  — required-fields schema the incentive
 *   payload is checked against, `{required: string[]}` shape. Callers should
 *   pass `{required: INCENTIVE_REQUIRED_FIELDS}` (see workflow.js) — this
 *   function stays generic/testable rather than importing its own default.
 * @param {object} args.adjustment  — proposed adjustment (amount, type, etc.)
 * @param {string} args.now  — ISO timestamp for current time
 * @param {Array<{call:string,status:number|null,kind:string,message:string}>} [args.upstreamFailures]
 *   Reads that FAILED rather than returned data (shared/upstreamFailure.js).
 *   Defaults to `[]`, so every existing caller and test is unaffected. On this
 *   use case in particular an entry can only ever REFUSE: every path it can
 *   take returns `approvalSlotsRequired: 0` and `payload: null`, so a swallowed
 *   fetch can never reach the money write.
 * @returns {object} result with decision, reason, flags, and required approval count
 */
export function evaluate({ identityVerified, employment, incentiveSchema, adjustment, now, upstreamFailures = [] }) {
  // Gate 0 — the employment read, ahead of identity. This is the whole
  // employment-shaped input to this use case: identity, the active check, the
  // country risk flags and the payload's `employment_id` all come from it.
  // Live execution 4238 recorded `identity_not_verified` / `unverified_requester`
  // for an adjustment whose employment fetch had 404'd — a payroll decision
  // filed under the wrong cause.
  const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, "employment"));
  if (employmentFailure) {
    return { ...employmentFailure, approvalSlotsRequired: 0, payload: null };
  }

  if (!identityVerified) {
    return {
      decision: "escalate",
      reason: "identity_not_verified",
      flags: ["unverified_requester"],
      approvalSlotsRequired: 0, // no approval path for unverified requests
      payload: null,
    };
  }

  if (!employment || employment.status !== "active") {
    return {
      decision: "escalate",
      reason: "employment_not_active",
      flags: ["inactive_employment"],
      approvalSlotsRequired: 0,
      payload: null,
    };
  }

  // Basic validation of adjustment structure
  const validationErrors = validateAdjustment(adjustment);
  if (validationErrors.length > 0) {
    return {
      decision: "escalate",
      reason: "invalid_adjustment_structure",
      flags: ["invalid_structure", ...validationErrors],
      approvalSlotsRequired: 0,
      payload: null,
    };
  }

  // Prepare the incentive payload and validate it against the employment's
  // country schema BEFORE any approval slot is offered — an adjustment that
  // can't legally be written to Remote has no business collecting human
  // sign-off first (same ordering as src/uc06/policyEngine.js).
  const payload = prepareIncentivePayload(adjustment, employment);
  const schemaCheck = validateAgainstSchema(payload, incentiveSchema);
  if (!schemaCheck.valid) {
    return {
      decision: "escalate",
      reason: "schema_invalid",
      flags: ["schema_invalid", ...schemaCheck.missing.map((f) => `missing_${f}`)],
      approvalSlotsRequired: 0,
      payload,
    };
  }

  // Calculate required approval slots based on risk factors
  const riskEvaluation = assessRisk(adjustment, employment);

  // The floor is ALWAYS >= 2 (requester + approver) per spec - never let AI execute alone
  // Risk may increase this to 3 (requester + approver + payment_releaser), never decrease below 2
  const approvalSlotsRequired = Math.max(2, riskEvaluation.minApprovalSlots);

  // Determine decision based on approval requirements
  let decision = "off_cycle_adjustment_required";
  let reason = "adjustment_needs_approval";

  if (approvalSlotsRequired >= 3) {
    decision = "triple_approval_required";
    reason = "high_risk_adjustment_needs_triple_approval";
  } else if (approvalSlotsRequired === 2) {
    decision = "dual_approval_required";
    reason = "standard_adjustment_needs_dual_approval";
  }

  return {
    decision,
    reason,
    flags: [...riskEvaluation.flags],
    approvalSlotsRequired,
    payload,
    // WHERE EACH RISK DIMENSION'S ANSWER CAME FROM. A new key rather than new
    // flags, so `flags` stays byte-identical to the n8n port's (parity), while
    // the one dimension driven by an unsourced list can no longer reach an
    // approver looking like a compliance determination. Purely descriptive:
    // nothing in this file, in workflow.js, or in multiApprovalPolicy.js reads
    // it back — `approvalSlotsRequired` is still the only thing that sizes the
    // signature set, and `Math.max(2, …)` above still floors it at two.
    riskBasis: riskEvaluation.riskBasis,
  };
}

/**
 * Validate the basic structure of an adjustment request
 * @param {object} adjustment
 * @returns {string[]} array of validation error flags
 */
function validateAdjustment(adjustment) {
  const errors = [];
  
  if (!adjustment) {
    errors.push("missing_adjustment_object");
    return errors;
  }
  
  if (!adjustment.type) {
    errors.push("missing_adjustment_type");
  }
  
  if (!adjustment.amount || typeof adjustment.amount !== 'number' || adjustment.amount <= 0) {
    errors.push("invalid_amount");
  }
  
  // `type` must be one Remote actually accepts. Without this the request
  // collects two or three human signatures and THEN 422s at the write, which
  // is the worst place to discover a schema error: the humans are gone, the
  // row says `executing`, and the failure looks like an outage rather than a
  // malformed request. `relocation_topup` and `retroactive_pay` — both of
  // which this repo's own parser used to emit — are not members.
  if (adjustment.type && !INCENTIVE_TYPES.includes(adjustment.type)) {
    errors.push("unsupported_incentive_type");
  }

  // `currency` stays part of OUR request record even though Remote has no such
  // field: the human-readable summary an approver signs prints it, and a bare
  // "5000" with no unit is not something anyone should be asked to approve.
  // It is deliberately NOT in INCENTIVE_REQUIRED_FIELDS and NOT in the
  // payload — see prepareIncentivePayload() below.
  if (!adjustment.currency) {
    errors.push("missing_currency");
  }

  // gross vs net, required by Remote, and NEVER defaulted. See
  // AMOUNT_TAX_TYPES above: the same integer pays a different amount under
  // each reading, so "the requester did not say" has to stop the request
  // rather than pick one. This is the only gate in this file whose absence
  // would have been silently paid for in cash.
  if (!adjustment.amountTaxType) {
    errors.push("missing_amount_tax_type");
  } else if (!AMOUNT_TAX_TYPES.includes(adjustment.amountTaxType)) {
    errors.push("invalid_amount_tax_type");
  }

  // Validate date if provided. `processingDate` is OURS — Remote's incentive
  // schema has no `processing_date` property [CONFIRMED, the 12 properties of
  // `Incentive` exhaustively], and the field we used to send under that name
  // went nowhere. It is kept on the request record because a human asking for
  // "pay this in the March run" is stating something real; it simply is not
  // part of the write. Remote decides payout timing from `effective_date`:
  // *"the incentive is not paid out on the effective date, but during the next
  // payroll cycle."*
  if (adjustment.processingDate) {
    const date = new Date(adjustment.processingDate);
    if (isNaN(date.getTime())) {
      errors.push("invalid_processing_date");
    }
  }

  return errors;
}

/**
 * Assess risk factors to determine approval requirements
 * @param {object} adjustment
 * @param {object} employment
 * @returns {object} with minApprovalSlots and risk flags
 */
function assessRisk(adjustment, employment) {
  const flags = [];
  let minApprovalSlots = 2; // Base requirement is always at least 2

  // -------------------------------------------------------------------------
  // High amount risk — and FIRST, whether the amount can be compared at all
  // -------------------------------------------------------------------------
  // The line is denominated (HIGH_AMOUNT_THRESHOLD_CURRENCY); the request's
  // amount is a bare ×100 integer in whatever currency the request states. Two
  // integers in different units are not comparable, and a comparison that runs
  // anyway does not fail loudly — it returns `false` and waves the request
  // through with two signatures.
  //
  // WHICH DIRECTION AN UNKNOWN GOES. Up. A currency with no stated policy
  // figure raises the requirement to the maximum this gate can ask for, so
  // "we could not tell whether this is a high-value payment" costs a third
  // signature rather than buying a cheaper one. This mirrors UC-02's
  // `policy_cap_currency_mismatch`, which refuses to enforce a cap it cannot
  // denominate and sends the claim to a human instead of approving it.
  //
  // THE HONEST LIMIT OF THIS COMPARISON, STATED RATHER THAN PAPERED OVER.
  // `adjustment.currency` is a label the REQUESTER supplied. Remote does not
  // use it — "Incentives use the currency of the employment" — so the currency
  // that will actually be paid comes off the employment record, and a live
  // `GET /v1/employments/{id}` carries no currency field at all (the live
  // fixtures in test/fixtures/remoteEmployment.js have none). Reading it off
  // the employment where the MOCK happens to carry one would make the mock and
  // the live API behave differently at a money gate, which is the
  // fixture-agrees-with-the-code trap this repository keeps paying for. So the
  // stated code is what is compared, and `riskBasis` below records that it is a
  // claim rather than an authenticated fact — a named gap, not a silent one.
  const statedCurrency = normalizeCurrencyCode(adjustment.currency);
  const highAmountThreshold = highAmountThresholdFor(statedCurrency);
  const thresholdComparable = highAmountThreshold !== null;

  if (!thresholdComparable) {
    flags.push("high_amount_threshold_not_comparable");
    minApprovalSlots = 3;
  } else if (adjustment.amount > highAmountThreshold) {
    flags.push("high_amount_risk");
    minApprovalSlots = 3;
  }


  // Manual tax adjustment risk - triggers 3-person approval
  if (adjustment.taxAdjustment) {
    flags.push("manual_tax_adjustment");
    minApprovalSlots = 3;
  }
  
  // Special types get flagged for visibility, but stay at the floor of 2
  // unless amount/tax/country risk above already pushed to 3 — a type alone
  // isn't grounds to raise the floor per the spec's own risk factors.
  // `relocation_allowance` is Remote's name for what this list called
  // `relocation_topup`; the old names are kept because they are persisted in
  // existing rows and flags, but they can no longer ARRIVE — validateAdjustment()
  // now refuses any type outside INCENTIVE_TYPES. Added rather than swapped so
  // no historical flag stops being recognised.
  const sensitiveTypes = ["bonus", "commission", "relocation_allowance", "relocation_topup", "retroactive_pay"];
  if (sensitiveTypes.includes(adjustment.type)) {
    flags.push(`sensitive_type_${adjustment.type}`);
  }
  
  // Country-specific risk based on employment
  const highRiskCountries = HIGH_TAX_COMPLEXITY_COUNTRIES;
  const countryOnHeuristicList = highRiskCountries.includes(employment.country_code);
  if (countryOnHeuristicList) {
    flags.push("high_tax_compliance_risk");
    if (minApprovalSlots < 3) {
      minApprovalSlots = 3; // Increase to 3 for high-tax-complexity countries for major adjustments
    }
  }

  // -------------------------------------------------------------------------
  // WHERE EACH DIMENSION'S ANSWER CAME FROM — a NEW return key, not a new flag
  // -------------------------------------------------------------------------
  // `flags` is compared field-for-field against the n8n port
  // (test/n8nUc09Parity.test.js), so adding an entry there would break parity
  // with a file this change may not edit — and a silent divergence between the
  // two execution paths is a worse defect than the one being closed. The basis
  // travels as its own key instead, which nothing compares and everything that
  // reports the decision can read.
  //
  // BOTH OUTCOMES ARE REPORTED, and that is the point. A country absent from an
  // unsourced list has NOT been "assessed and found low-risk" — nothing assessed
  // it. Recording only the trigger would leave the absence reading as a pass,
  // which is the same collapse `docs/GATES.md` draws between `passed` and
  // `not_reached`, one layer up.
  const riskBasis = [
    {
      dimension: "adjustment_value",
      flag: "high_amount_risk",
      triggered: flags.includes("high_amount_risk"),
      basis: "repo_defined_threshold",
      authority: null,
      // THE THRESHOLD'S OWN DENOMINATION, beside the currency it was compared
      // against. Recorded separately and never merged: printing the line in the
      // REQUEST's currency is what made a USD figure read as "€10,000.00" on
      // the approval screen, claiming a denomination the gate had never checked.
      thresholdCurrency: HIGH_AMOUNT_THRESHOLD_CURRENCY,
      thresholdRemoteInteger: thresholdComparable ? highAmountThreshold : null,
      statedCurrency,
      comparable: thresholdComparable,
      // The `false` case is its OWN outcome, not a quiet variant of "under the
      // line" — a dimension that could not run has approved of nothing, the
      // same passed/not_reached distinction docs/GATES.md draws one layer up.
      notComparableFlag: thresholdComparable ? null : "high_amount_threshold_not_comparable",
      currencyProvenance: "requester_stated",
      note: thresholdComparable
        ? `A fixed threshold of ${highAmountThreshold} (Remote ×100) in ${HIGH_AMOUNT_THRESHOLD_CURRENCY}, defined in ` +
          "this repository. It is a stated policy value, not a statutory one — it is deterministic and auditable, and " +
          `no external authority publishes it. The request states ${statedCurrency}, so the two figures are in the ` +
          "same unit and the comparison is meaningful. Note that the currency is a label the REQUESTER supplied: " +
          "Remote pays incentives in the currency of the employment and ignores anything we say about currency, so " +
          "a mislabelled request would be compared against the wrong line."
        : `NOT COMPARED. The high-value line is stated only in ${HIGH_AMOUNT_THRESHOLD_CURRENCY} ` +
          `(${HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER}, Remote ×100), and this request is denominated in ` +
          `${statedCurrency ?? "no stated currency"}. No policy figure exists for it, and converting one would need ` +
          "an exchange rate this system does not have and must not invent on a payment gate. So the amount was NOT " +
          "found to be under the line — it was never measured against a line at all, and the signature requirement " +
          "was raised to three because an unknown on this dimension costs a third pair of eyes rather than buying " +
          "two. To make this dimension measurable, a stated policy figure for this currency must be added to the " +
          "high-value threshold by whoever owns the policy.",
    },
    {
      dimension: "manual_tax_adjustment",
      flag: "manual_tax_adjustment",
      triggered: flags.includes("manual_tax_adjustment"),
      basis: "request_field",
      authority: null,
      note: "Read directly from the request itself — a fact the requester stated, not an inference this system drew.",
    },
    {
      dimension: "jurisdiction_tax_complexity",
      flag: "high_tax_compliance_risk",
      triggered: countryOnHeuristicList,
      basis: HIGH_TAX_COMPLEXITY_HEURISTIC.basis,
      authority: HIGH_TAX_COMPLEXITY_HEURISTIC.authority,
      countriesInScope: [...HIGH_TAX_COMPLEXITY_HEURISTIC.countries],
      observedCountryCode: employment?.country_code ?? null,
      note: countryOnHeuristicList
        ? `The employment's country is on an UNSOURCED list (${HIGH_TAX_COMPLEXITY_HEURISTIC.countries.join(", ")}), ` +
          "which raised the signature requirement to three. " +
          HIGH_TAX_COMPLEXITY_HEURISTIC.provenance
        : "The employment's country is NOT on this list — which is not the same as its payroll tax having been " +
          "assessed as simple. The list is unsourced, so a country's absence from it carries no finding at all. " +
          HIGH_TAX_COMPLEXITY_HEURISTIC.provenance,
      requiredForARealVersion: [...HIGH_TAX_COMPLEXITY_HEURISTIC.requiredForARealVersion],
    },
  ];

  return {
    riskBasis,
    minApprovalSlots,
    flags
  };
}

/**
 * Prepare the incentive payload for `POST /v1/incentives`.
 *
 * THE SHAPE IS REMOTE'S, FIELD FOR FIELD — `CreateOneTimeIncentiveParams` =
 * `CommonIncentiveParams` {amount, amount_tax_type, effective_date, note} plus
 * {employment_id, type, period_start, period_end}. `[CONFIRMED 2026-08-19]`
 * from the OpenAPI on Remote's own page, and corroborated live: all 53 records
 * on `GET /v1/incentives` carry exactly these keys and no others.
 *
 * Four fields that used to be here have gone, and none of them was cosmetic:
 *   - `currency` — not a property. Remote pays in the employment's currency.
 *   - `description` → `note` — the real field, *"An optional note describing
 *     the reason or context for this incentive."*
 *   - `processing_date` — not a property; nothing consumed it at Remote.
 *   - `tax_calculation_method: "automatic"` → `amount_tax_type: gross|net`,
 *     the required field it stood in for, carrying a meaning it did not have.
 *
 * @param {object} adjustment
 * @param {object} employment
 * @returns {object|null} formatted incentive payload, or null when a value
 *   nobody supplied would have had to be invented to build one
 */
function prepareIncentivePayload(adjustment, employment) {
  // The active-employment gate above returns escalate for a null employment, so
  // reaching here with one means a caller wired a path that skipped it. Reading
  // `.id` off null then threw a TypeError from inside the payload builder — on
  // the one use case that moves real money, and (like every crash) before any
  // audit row existed. The simulator hit this 27 times in 10,000 runs by
  // supplying an employment id the Remote API does not resolve, which is an
  // ordinary production event, not an exotic one.
  //
  // Returning null is the honest signal: there is no payload to build without an
  // employment, and the caller must treat that as "cannot execute" rather than
  // receiving a half-formed object with employment_id: undefined that would be
  // POSTed to Remote and rejected — or worse, accepted against the wrong record.
  if (!employment || !employment.id) return null;

  // NO AMOUNT, NO PAYLOAD. This guard lived only in workflow.js's duplicate of
  // this function, so the two copies disagreed about the one thing that
  // matters. The line it replaced manufactured a zero out of null, undefined
  // and "" — `0 || 0` is 0 — producing a perfectly well-formed $0.00 incentive
  // on the one code path in this repo that POSTs money. A figure nobody
  // supplied must stay missing: a wrong number gets acted on, a missing one
  // gets investigated.
  if (!Number.isInteger(adjustment.amount)) return null;

  // NO GROSS/NET, NO PAYLOAD — the same rule one field over, and the more
  // expensive one. Defaulting this to either member would silently choose how
  // much money leaves the account (see AMOUNT_TAX_TYPES). validateAdjustment()
  // above already refuses an adjustment without it; this is the second lock,
  // so that a caller reaching the builder by some other route still cannot
  // produce a payload carrying an invented tax reading.
  if (!AMOUNT_TAX_TYPES.includes(adjustment.amountTaxType)) return null;

  const payload = {
    employment_id: employment.id,
    type: adjustment.type || "bonus",
    // Already in Remote's ×100 integer form (shared/money.js). Remote:
    // "if the incentive you're offering is EUR 500.25, you would specify
    // `50025` as the amount for this field." Same convention, so nothing is
    // rescaled here.
    amount: adjustment.amount,
    amount_tax_type: adjustment.amountTaxType,
    effective_date: adjustment.effectiveDate || new Date().toISOString().split('T')[0], // YYYY-MM-DD
    note: adjustment.description || `Off-cycle ${adjustment.type}`,
  };

  // Optional and nullable at Remote; sent only when the request actually names
  // a period, so the payload never carries a key with an invented value.
  if (adjustment.periodStart) payload.period_start = adjustment.periodStart;
  if (adjustment.periodEnd) payload.period_end = adjustment.periodEnd;

  return payload;
}

// Export for tests
export { validateAdjustment, assessRisk, prepareIncentivePayload };

// ---------------------------------------------------------------------------
// GATE_SEQUENCE  —  what each reason MEANS, and where in the order it sits
// ---------------------------------------------------------------------------
// Derived by reading evaluate() above top to bottom. One row per REASON, in
// the order evaluate() can produce them; `checks` is the PASSING condition and
// `means` is what it is to a person when that reason is the one that decided.
// The raw slug stays visible beside the prose — it is the string in
// `audit_log`, the metrics exception ranking and the n8n port.
//
// TWO THINGS READING THE ORDER REVEALED, both recorded here rather than
// quietly smoothed over:
//
// 1. UC-09 has NO `all_gates_passed`. Its two success outcomes are
//    `standard_adjustment_needs_dual_approval` and
//    `high_risk_adjustment_needs_triple_approval`. Both are successes — the
//    adjustment is in order and is now collecting the signatures it needs.
//    Neither is a refusal, and a reader who assumes the "…needs…" phrasing is
//    an objection will misread every well-formed UC-09 case there is.
//
// 2. `adjustment_needs_approval` (position 7) is STRUCTURALLY UNREACHABLE. It
//    is the initial value of `reason` before the branch, and the branch is
//    exhaustive because `approvalSlotsRequired` is `Math.max(2, …)` — it can
//    never be below 2, so either the `>= 3` or the `=== 2` arm always fires.
//    It has a rung because the drift guard scrapes the source and would
//    otherwise fail, and because a rung that says "you should never see this"
//    is more useful than a slug with no explanation at all. It is left in the
//    code untouched: the same dead default exists in
//    workflows/nodes-uc09/adjustmentGates.js and the two are parity-tested, so
//    removing it here alone is a divergence, not a cleanup.
// ---------------------------------------------------------------------------
export const GATE_SEQUENCE = Object.freeze([
  {
    position: 1,
    reason: "identity_not_verified",
    gate: "identity",
    checks: "the requester is authenticated and matched to this employment record",
    means:
      "We could not confirm the requester is authorised for this employment, so no approval path was opened at all — not even the first signature slot. Money never starts moving on a request whose origin is unverified. This is a failure to VERIFY, not a finding that the requester is an impostor.",
  },
  {
    position: 2,
    reason: "employment_not_active",
    gate: "employment_status",
    checks: "the employment record exists and is active",
    means:
      "The employment record is missing or not active, so there is no live payroll to make an off-cycle payment against. A payment owed to someone who has left is a different process, handled by Payroll directly.",
  },
  {
    position: 3,
    reason: "invalid_adjustment_structure",
    gate: "request_completeness",
    checks:
      "the adjustment names a type Remote accepts, a positive amount, a currency, whether that amount is gross or net, and (where one is given) a real processing date",
    means:
      "The adjustment request is incomplete or malformed — the flags recorded with this case name which part. It has not been refused on its merits; it could not be read well enough to have merits assessed.",
  },
  {
    position: 4,
    reason: "schema_invalid",
    gate: "payload_schema",
    checks: "the payment record we would send to Remote carries every field Remote requires",
    means:
      "The payment record that would be sent to Remote is missing a required field, so it could never be written even if every approver signed it. Approvals are deliberately not collected for something that cannot be executed — asking three people to sign an unpayable request wastes their time and hides the real problem.",
  },
  {
    position: 5,
    reason: "high_risk_adjustment_needs_triple_approval",
    gate: "approval_sizing",
    checks:
      "the adjustment carries no high-risk factor — an amount that can be compared with the high-value threshold and comes in under it, no manual tax adjustment, and not a country on the (unsourced) high-tax-complexity list",
    means:
      "The adjustment is sound but carries a high-risk factor, so it needs THREE separate people before it can be paid: the requester, an approver, and a payment releaser. This is not a refusal — it is the request being routed to a larger signature set. Nothing has been paid. Three things can require the third signature: an adjustment value over the high-value line (or one that could not be compared with it at all), a manual tax adjustment, or an employment in a country on the high-tax-complexity list. Which of them fired is named under \"Why this number\" in the signatures panel, and two of them come with a health warning. The high-tax-complexity country list is an UNSOURCED heuristic with no publishing authority behind it, so read that dimension as an illustration rather than as a compliance determination. And the value dimension can fire because the amount COULD NOT BE COMPARED at all: the high-value line is stated only in one currency, so a request in any other currency is not judged small or large — it is unmeasured, and an unmeasured amount costs a third signature rather than buying two.",
  },
  {
    position: 6,
    reason: "standard_adjustment_needs_dual_approval",
    gate: "approval_sizing",
    checks: "every gate above passed and no high-risk factor applies",
    means:
      "The adjustment is in order and needs the standard two people — a requester and an approver — before it can be paid. This is the normal successful outcome, not an objection. Nothing has been paid yet, and the automation itself can never pay it: two named humans have to.",
  },
  {
    position: 7,
    reason: "adjustment_needs_approval",
    gate: "outcome",
    checks: "—",
    means:
      "A placeholder the gates cannot actually produce: the required-approver count is floored at two, so one of the two rungs above always decides first. Seeing this on a real case means the approval floor has been changed and this ladder is out of date — report it rather than explaining it to the requester.",
  },
]);

const descriptions = bindGateDescriptions(GATE_SEQUENCE);

/**
 * Which gate decided this outcome, and what that means in plain words.
 * Returns null for a reason with no row — see shared/gateLadder.js.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeDecidingGate = descriptions.describeDecidingGate;

/**
 * The whole ordered ladder, each rung marked passed / decided / not_reached.
 * @param {string} reason  the slug evaluate() returned
 */
export const describeGateLadder = descriptions.describeGateLadder;