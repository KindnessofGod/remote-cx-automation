// ---------------------------------------------------------------------------
// uc06AmendmentPayload.test.js
//   The amendment payload is built AGAINST THE SCHEMA, not against a fixture
// ---------------------------------------------------------------------------
// WHAT WAS WRONG
// `buildAmendmentPayload()` emitted four fixed keys — {job_title, weekly_hours,
// base_salary, currency} — chosen to match `src/remote/mockServer.js`'s
// `COUNTRY_SCHEMAS` (`{required: ["job_title", "weekly_hours"]}`) rather than
// anything Remote serves. Against a real country form that payload is wrong in
// BOTH directions at once:
//
//   - it omits six of the seven required fields, and
//   - three of its four keys are not properties of the form at all, which
//     declares `additionalProperties: false`.
//
// So `schema_invalid` fired on every live amendment, ahead of the payroll gate,
// and UC-06 was not reachable end to end. Same defect class as UC-03's alpha-3
// country list and UC-06's own invented `/v1/company-payroll-runs` URL: the
// fixture agreed with the code and neither agreed with Remote.
//
// THE LIVE CAPTURES BELOW ARE VERBATIM, 2026-08-18, gateway.remote-sandbox.com
// with this container's REMOTE_API_TOKEN. They are pinned here rather than read
// from the mock for exactly the reason above — the mock is not evidence about
// Remote, it is evidence about this repo.
//
// WHY THIS FILE LEADS WITH A POSITIVE ASSERTION
// A payload builder that emits nothing usable and a payload builder that is
// correctly refusing produce identical output on every fail-closed test. Only
// "this input MUST reach dual_approval_required" tells them apart — the lesson
// that cost this project the most (CLAUDE.md §5, UC-03's dead country gate).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, buildAmendmentPayload } from "../src/uc06/policyEngine.js";

// --- LIVE CAPTURE 1 ---------------------------------------------------------
// GET /v1/countries/NLD/employment_basic_information -> 200
// Identical `required` on GBR/USA/CAN/PRT/SGP; DEU adds "mobile_number" and
// FRA adds "ack_non_eligible_job_titles". [CONFIRMED]
const LIVE_NLD_BASIC_INFO = {
  additionalProperties: false,
  required: [
    "has_seniority_date",
    "name",
    "job_title",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ],
  properties: Object.fromEntries(
    [
      "has_seniority_date",
      "job_title",
      "login_email",
      "name",
      "personal_email",
      "provisional_start_date",
      "seniority_date",
      "tax_job_category",
      "tax_servicing_countries",
      "work_email",
    ].map((k) => [k, {}])
  ),
};

// --- LIVE CAPTURE 2 ---------------------------------------------------------
// GET /v1/contract-amendments/schema?employment_id=<NL id>&country_code=NLD -> 200
// This is the form a CONTRACT AMENDMENT is actually validated against, and it
// is the only one of the two that has a salary or an hours field at all. UC-06
// does not fetch it yet — that needs a `src/remote/restClient.js` method, which
// is why the gap test at the bottom of this file still stands — but the payload
// builder must already be correct against it, because being correct against
// "whatever schema arrived" is the whole point of the fix. [CONFIRMED]
const LIVE_NLD_CONTRACT_AMENDMENT = {
  additionalProperties: false,
  required: [
    "annual_gross_salary",
    "effective_date",
    "job_title",
    "role_description",
    "contract_duration_type",
    "work_schedule",
    "work_hours_per_week",
  ],
  properties: Object.fromEntries(
    [
      "additional_comments",
      "annual_gross_salary",
      "contract_duration_type",
      "contract_end_date",
      "default_weekly_hours",
      "effective_date",
      "experience_level",
      "job_title",
      "reason_for_change",
      "role_description",
      "work_hours_per_week",
      "work_schedule",
    ].map((k) => [k, {}])
  ),
};

// The minimal shape `src/remote/mockServer.js` serves: a bare `required` list,
// no `properties`, no `additionalProperties`. An OPEN schema — it says what must
// be present and nothing at all about what is allowed.
const OPEN_MOCK_SCHEMA = { required: ["job_title", "weekly_hours"] };

// A cycle that comfortably covers the effective date, so nothing downstream of
// the schema gate can be the reason a test fails.
const CYCLE = [{ id: "nl_jun_main", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-20" }];
const NOW = "2026-06-01T09:00:00Z";
const EFFECTIVE = "2026-06-15";

const JOB_TITLE_CHANGE = { jobTitle: { oldValue: "Content Writer", newValue: "Senior Content Writer" } };
const SALARY_CHANGE = { salary: { oldAmount: 36000, newAmount: 39000, currency: "EUR" } };

// A live NL employment, as `normalizeEmployment()` surfaces it TODAY plus the
// four `basic_information` fields it currently drops. Values are the real ones
// from employment 293527ed-b8af-4fc2-a4ad-1cb87cda1641 (Anna van Vliet, NL,
// active) — see the gap test at the end for what today's record really carries.
const NL_EMPLOYMENT_FULL = {
  status: "active",
  company_id: "co_amend_01",
  country_code: "NL",
  full_name: "Anna van Vliet",
  job_title: "Content Writer",
  start_date: "2022-10-03",
  base_salary: 3600000,
  currency: "EUR",
  weekly_hours: 24,
  // Present on the live record's `basic_information` block, absent from the
  // normalized record today.
  has_seniority_date: "no",
  tax_servicing_countries: ["NLD"],
  tax_job_category: "professional",
  login_email: "personal",
};

const run = (over = {}) =>
  evaluate({
    identityVerified: true,
    employment: NL_EMPLOYMENT_FULL,
    countrySchema: LIVE_NLD_BASIC_INFO,
    changes: JOB_TITLE_CHANGE,
    requestedEffectiveDate: EFFECTIVE,
    now: NOW,
    payrollCycles: CYCLE,
    ...over,
  });

// ---------------------------------------------------------------------------
// THE POSITIVE ASSERTION
// ---------------------------------------------------------------------------

test("POSITIVE — a job-title amendment for a real country reaches dual_approval_required", () => {
  // Against the REAL Dutch form, not the mock's two-field stand-in. Every one of
  // the seven required fields is sourced from the employment record or from the
  // change itself; nothing is invented. This is the assertion that proves the
  // gate is satisfiable, and the one that no amount of fail-closed testing
  // could ever have produced.
  const r = run();
  assert.equal(r.decision, "dual_approval_required", `expected dual approval, got ${r.reason} ${JSON.stringify(r.flags)}`);
  assert.equal(r.reason, "all_gates_passed");
});

test("POSITIVE — the payload is the FULL next state, sourced field by field", () => {
  const r = run();
  assert.deepEqual(r.payload, {
    job_title: "Senior Content Writer", // the amended value
    name: "Anna van Vliet", //             <- employment.full_name
    provisional_start_date: "2022-10-03", // <- employment.start_date
    has_seniority_date: "no",
    tax_servicing_countries: ["NLD"],
    tax_job_category: "professional",
    login_email: "personal",
  });
});

test("POSITIVE — a closed schema gets NO key it does not declare", () => {
  // `additionalProperties: false` means an undeclared key is a rejection, not a
  // harmless extra. The old builder sent three of them on every request.
  const r = run();
  const declared = new Set(Object.keys(LIVE_NLD_BASIC_INFO.properties));
  for (const key of Object.keys(r.payload)) {
    assert.ok(declared.has(key), `${key} is not a property of the real form`);
  }
  for (const key of ["weekly_hours", "base_salary", "currency"]) {
    assert.ok(!(key in r.payload), `${key} must not be sent to a form that does not declare it`);
  }
});

// ---------------------------------------------------------------------------
// A CHANGE THE FORM CANNOT EXPRESS IS ITS OWN REFUSAL
// ---------------------------------------------------------------------------

test("a salary change against a form with no salary field escalates change_not_expressible", () => {
  // The employment_basic_information form has no salary property at all — live
  // NL/DE/FR/US/CA/GB/PT/SG all agree. Silently dropping the amount and passing
  // schema validation on the leftovers would approve a SALARY_INCREASE whose
  // amount appears nowhere in the validated payload. Naming the refusal is the
  // only honest option, and it makes the wrong-form problem loud instead of
  // arriving as a misleading `schema_invalid`.
  const r = run({ changes: SALARY_CHANGE });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "change_not_expressible");
  assert.ok(r.flags.includes("unexpressible_salary"));
});

test("the SAME salary change against the real contract-amendment form is expressible", () => {
  const r = run({
    countrySchema: LIVE_NLD_CONTRACT_AMENDMENT,
    changes: { ...SALARY_CHANGE, weeklyHours: { oldValue: 24, newValue: 32 } },
  });
  // Money ×100 on the way out, on the field name Remote's own form uses.
  assert.equal(r.payload.annual_gross_salary, 3900000);
  assert.equal(r.payload.work_hours_per_week, 32);
  assert.equal(r.payload.job_title, "Content Writer"); // carried through unchanged
  assert.equal(r.payload.effective_date, EFFECTIVE); //  from the request itself
  assert.ok(!("base_salary" in r.payload), "the mock's field name is not this form's field name");
});

// ---------------------------------------------------------------------------
// WHAT COULD NOT BE SOURCED — recorded, never invented
// ---------------------------------------------------------------------------

test("HONEST GAP — the record normalizeEmployment() returns TODAY still cannot satisfy the form", () => {
  // This is the live NL employment as UC-06 actually receives it: every field
  // `normalizeEmployment()` surfaces, and nothing else. Four required fields
  // have no source on it, so the amendment escalates naming exactly those four.
  // That is the remaining half of this finding and it lives in
  // `src/remote/restClient.js`, which this pass does not own.
  const asNormalizedToday = {
    status: "active",
    company_id: "co_amend_01",
    country_code: "NL",
    full_name: "Anna van Vliet",
    job_title: "Content Writer",
    start_date: "2022-10-03",
    email: "nld-demo-employee-monthly-12@rempel-paucek-4c3wac.com",
    legal_entity_id: "le_1",
    probation: false,
    contract_type: "global_payroll_employee",
  };
  const r = run({ employment: asNormalizedToday });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "schema_invalid");
  assert.deepEqual(r.flags, [
    "schema_invalid",
    "missing_has_seniority_date",
    "missing_tax_servicing_countries",
    "missing_tax_job_category",
    "missing_login_email",
  ]);
  // The three that ARE sourceable really were carried through — this test is
  // about the four that are not, not about the builder giving up.
  assert.equal(r.payload.name, "Anna van Vliet");
  assert.equal(r.payload.provisional_start_date, "2022-10-03");
  assert.equal(r.payload.job_title, "Senior Content Writer");
});

// ---------------------------------------------------------------------------
// THE OPEN (MOCK) SCHEMA IS UNCHANGED — a regression guard, not an endorsement
// ---------------------------------------------------------------------------

test("an OPEN schema still produces exactly the payload it always did", () => {
  // A schema with no `properties` block says what must be present and nothing
  // about what is allowed. JSON Schema's own default for a missing
  // `additionalProperties` is permissive, so refusing keys here would be this
  // repo inventing a constraint — the move that caused the bug in the first
  // place. Today's four keys stay.
  const r = run({ countrySchema: OPEN_MOCK_SCHEMA, changes: SALARY_CHANGE });
  assert.equal(r.decision, "dual_approval_required");
  assert.deepEqual(r.payload, {
    job_title: "Content Writer",
    weekly_hours: 24,
    base_salary: 3900000,
    currency: "EUR",
  });
});

test("an open schema still carries through any OTHER required field it can source", () => {
  const r = run({ countrySchema: { required: ["job_title", "name", "provisional_start_date"] } });
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.payload.name, "Anna van Vliet");
  assert.equal(r.payload.provisional_start_date, "2022-10-03");
});

// ---------------------------------------------------------------------------
// buildAmendmentPayload() directly — the seam the gates read
// ---------------------------------------------------------------------------

test("buildAmendmentPayload reports which requested changes the schema cannot express", () => {
  const built = buildAmendmentPayload({
    employment: NL_EMPLOYMENT_FULL,
    changes: { ...SALARY_CHANGE, weeklyHours: { oldValue: 24, newValue: 32 } },
    countrySchema: LIVE_NLD_BASIC_INFO,
    requestedEffectiveDate: EFFECTIVE,
  });
  assert.deepEqual(built.unexpressible, ["weeklyHours", "salary"]);
});

// ---------------------------------------------------------------------------
// A FIGURE NOBODY GAVE IS MISSING, NOT ZERO — and never a crash (F-31)
// ---------------------------------------------------------------------------
// `src/remoteui/`'s salary inputs are not `required` and its `num()` correctly
// yields NaN -> JSON null, so a blank amount genuinely reaches the gates. There
// `toRemoteInteger(null)` THREW, out of buildAmendmentPayload(), 44 lines before
// createAmendment() and 63 before audit.log() — so the request produced HTTP 500
// and ZERO audit rows. That is the third instance of the fail-open-into-silence
// shape fixed in 85816e7 (UC-05, F-28) and 7c5153b (UC-07, F-29): every other
// gate failure in this system fails closed to a durable, audited escalate.
//
// The fix is the same one, and deliberately NOT a default: coercing an absent
// amount to 0 would draft a SALARY_DECREASE to zero for a human to one-click
// approve. Classify before arithmetic; an amount we cannot derive is refused and
// named, never invented (prime directive 1, and the money ×100 invariant).
// ---------------------------------------------------------------------------

// The live contract-amendment `required` list minus the three fields no source
// exists for today — role_description, contract_duration_type and work_schedule
// all live on `contract_details`, which `normalizeEmployment()` drops. Trimmed
// so the tests below assert the SALARY path rather than re-testing the
// normalizer gap the HONEST GAP test above already pins.
const LIVE_NLD_AMENDMENT_SOURCEABLE = {
  ...LIVE_NLD_CONTRACT_AMENDMENT,
  required: ["annual_gross_salary", "effective_date", "job_title", "work_hours_per_week"],
};

const runSalary = (salary) => run({ changes: { salary }, countrySchema: LIVE_NLD_CONTRACT_AMENDMENT });

test("F-31: a blank salary escalates with a named reason instead of throwing", () => {
  const r = runSalary({ oldAmount: 36000, newAmount: null, currency: "EUR" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "change_value_underivable");
  assert.ok(r.flags.includes("underivable_salary_newAmount"));
});

test("F-31: undefined and NaN amounts are refused the same way", () => {
  for (const newAmount of [undefined, NaN]) {
    const r = runSalary({ oldAmount: 36000, newAmount, currency: "EUR" });
    assert.equal(r.reason, "change_value_underivable", `newAmount=${String(newAmount)}`);
  }
});

test("F-31: a QUOTED amount is refused, not coerced — that is how a 100x error gets in", () => {
  // Same reasoning as UC-05's reconcilePtoPayout() and UC-09 finding F-05.
  const r = runSalary({ oldAmount: 36000, newAmount: "39000", currency: "EUR" });
  assert.equal(r.reason, "change_value_underivable");
  assert.ok(r.flags.includes("underivable_salary_newAmount"));
});

test("F-31: the refusal is never a silent zero", () => {
  const r = runSalary({ oldAmount: 36000, newAmount: null, currency: "EUR" });
  assert.ok(!("annual_gross_salary" in r.payload), "no fabricated amount reaches the payload");
});

test("F-31: a blank job title and a blank hours value are refused too", () => {
  const blankTitle = run({ changes: { jobTitle: { oldValue: "Content Writer", newValue: "" } } });
  assert.equal(blankTitle.reason, "change_value_underivable");
  assert.ok(blankTitle.flags.includes("underivable_jobTitle_newValue"));

  const blankHours = run({
    countrySchema: LIVE_NLD_CONTRACT_AMENDMENT,
    changes: { weeklyHours: { oldValue: 24, newValue: null } },
  });
  assert.equal(blankHours.reason, "change_value_underivable");
  assert.ok(blankHours.flags.includes("underivable_weeklyHours_newValue"));
});

test("F-31 POSITIVE: a real figure still reaches dual_approval_required", () => {
  // The assertion that keeps the refusal from becoming a gate that refuses
  // everything — BUILD-LOG §3.30's lesson, and the reason UC-03's dead country
  // gate survived as long as it did.
  const r = run({
    countrySchema: LIVE_NLD_AMENDMENT_SOURCEABLE,
    changes: { salary: { oldAmount: 36000, newAmount: 39000, currency: "EUR" } },
  });
  assert.equal(r.decision, "dual_approval_required", `got ${r.reason} ${JSON.stringify(r.flags)}`);
  assert.equal(r.payload.annual_gross_salary, 3900000); // money ×100, still
});

test("F-31: hours legitimately arrive as a STRING from Remote and must not be refused", () => {
  // Live `contract_details.work_hours_per_week` is "24" — a quoted number is
  // this field's real shape, unlike a money amount. Refusing it would be this
  // repo inventing a constraint the API contradicts.
  const r = run({
    countrySchema: LIVE_NLD_AMENDMENT_SOURCEABLE,
    changes: { salary: SALARY_CHANGE.salary, weeklyHours: { oldValue: "24", newValue: "32" } },
  });
  assert.equal(r.decision, "dual_approval_required", `got ${r.reason}`);
  assert.equal(r.payload.work_hours_per_week, "32");
});
