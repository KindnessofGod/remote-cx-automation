// ---------------------------------------------------------------------------
// n8nUc06Parity.test.js — the n8n "Amendment Gates" Code node and
// policyEngine.js/changeParser.js/cutoffEngine.js must agree
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as test/n8nParity.test.js for UC-01: UC-06's decision logic
// exists twice — once as src/uc06/{policyEngine,changeParser,cutoffEngine}.js
// and once as the "Amendment Gates" Code node in workflows/uc-06 (n8n workflow
// WORKFLOW_UC06_ID, built but NOT activated). This test executes the ACTUAL
// node body (workflows/nodes-uc06/amendmentGates.js) in a sandbox and asserts
// it reaches the same decision/reason/flags/amendmentType/status as the real
// Node functions, for every scenario, so the two copies cannot drift apart
// unnoticed — and so a broken node body (the escaping bug class documented in
// workflows/README.md) fails a test instead of failing a live amendment.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate } from "../src/uc06/policyEngine.js";
import { amendmentType } from "../src/uc06/changeParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc06", "amendmentGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

import { normalizeEmployment } from "../src/remote/restClient.js";
import { LIVE_EMPLOYMENT_DE, LIVE_EMPLOYMENT_CA, withoutAlpha2 } from "./fixtures/remoteEmployment.js";
import { CONTRACT_AMENDMENT_SCHEMAS } from "../src/remote/fixtures/contractAmendmentSchemas.js";

/**
 * Run the n8n "Amendment Gates" Code node body with n8n's globals mocked.
 * Mirrors runGatesNode() in n8nParity.test.js.
 */
function runAmendmentGatesNode({
  request,
  employmentResponse,
  countrySchemaResponse,
  payrollRunsResponse,
  payrollRunsPages,
}) {
  // The payroll read is PAGINATED on the live node, so its predecessor hands
  // the gates ONE ITEM PER PAGE. `payrollRunsPages` is the honest shape;
  // `payrollRunsResponse` stays as the single-page convenience every existing
  // scenario uses.
  const pages = payrollRunsPages ?? [payrollRunsResponse];
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Amendment Request") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      if (nodeName === "Fetch Country Schema (Remote)") return { first: () => ({ json: countrySchemaResponse }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // $input — the immediate predecessor: Fetch Payroll Runs (Remote)
    $input: {
      all: () => pages.map((json) => ({ json })),
      first: () => ({ json: pages[0] }),
    },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON — same cross-realm reasoning as n8nParity.test.js.
  return JSON.parse(JSON.stringify(result[0].json));
}

/** The real Remote API shape (nested under data.employment), mock-server-flat fields. */
const employmentResponse = (over = {}) => ({
  data: {
    employment: {
      id: "emp_active_001",
      status: "active",
      company_id: "co_amend_01",
      country_code: "NG",
      job_title: "Senior Engineer",
      weekly_hours: 40,
      base_salary: 5000000,
      currency: "USD",
      ...over,
    },
  },
});

const countrySchemaResponse = (required = ["job_title", "weekly_hours"]) => ({ data: { required } });

/** What the "Fetch Country Schema (Remote)" node yields when the endpoint
 *  404s — no `data` at all. Finding F-15: both implementations must read this
 *  as "no schema" and escalate, never as "a schema requiring nothing". */
const missingCountrySchemaResponse = () => ({});

/** One page of `GET /v1/payroll-runs`. Every row carries the nested
 *  `country.alpha_2_code` the LIVE endpoint carries, because the node now
 *  narrows the company-wide calendar on exactly that field — a fixture without
 *  it would agree with a broken filter instead of with Remote. `NG` matches the
 *  synthetic employment used by the scenarios below. */
const payrollRunsResponse = (runs) => ({
  data: {
    total_count: 2,
    // The live endpoint reports `total_pages: 1` while later pages still return
    // rows, so it is present here and deliberately wrong — a client that starts
    // trusting it must fail a test rather than read a truncated calendar in
    // production.
    total_pages: 1,
    current_page: 1,
    payroll_runs: runs ?? [
      { id: "run_2026_06", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-10", process_date: "2026-06-15", pay_date: "2026-06-30" },
      { id: "run_2026_07", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10", process_date: "2026-07-15", pay_date: "2026-07-31" },
    ],
  },
});

/** A cycle in the live row shape. Defaults are the real Sandbox June cycles. */
const cycle = (over) => ({
  id: "cycle",
  status: "processing",
  type: "main",
  country: { code: "NGA", name: "Nigeria", alpha_2_code: "NG" },
  period_start: "2026-06-01",
  period_end: "2026-06-30",
  cutoff_date: "2026-06-20",
  ...over,
});

/** The five countries and periods the LIVE Sandbox calendar actually carries,
 *  copied from `GET /v1/payroll-runs` on 2026-08-18. The point of the shape is
 *  the overlap: SG/FR/NL/US June periods all contain 2026-06-15, and their
 *  cutoffs differ by a fortnight. */
const LIVE_JUNE_CALENDAR = [
  cycle({ id: "sg_jun", country: { code: "SGP", name: "Singapore", alpha_2_code: "SG" }, period_start: "2026-06-01", period_end: "2026-06-26", cutoff_date: "2026-06-06", status: "waiting_for_customer_approval" }),
  cycle({ id: "fr_jun", country: { code: "FRA", name: "France", alpha_2_code: "FR" }, cutoff_date: "2026-06-20" }),
  cycle({ id: "us_jun", country: { code: "USA", name: "United States", alpha_2_code: "US" }, cutoff_date: "2026-06-20" }),
  cycle({ id: "ca_jun", country: { code: "CAN", name: "Canada", alpha_2_code: "CA" }, period_start: "2026-06-15", period_end: "2026-06-30", cutoff_date: "2026-06-20" }),
];

const pageOf = (runs, over = {}) => ({
  data: { total_count: runs.length, total_pages: 1, current_page: 1, payroll_runs: runs, ...over },
});

const requestFor = (changes, over = {}) => ({
  employmentId: "emp_active_001",
  session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
  changes,
  requestedEffectiveDate: "2026-07-15",
  reasonText: "",
  externalRef: "4001",
  source: "webhook",
  now: "2026-06-20",
  ...over,
});

const SALARY_CHANGE = { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } };

const SCENARIOS = [
  {
    name: "before cutoff, identity verified -> dual_approval_required",
    changes: SALARY_CHANGE,
  },
  {
    name: "cutoff already passed -> escalate",
    changes: SALARY_CHANGE,
    requestOver: { requestedEffectiveDate: "2026-06-15" },
  },
  {
    name: "within 48h of cutoff -> urgent_cutoff flag, still dual_approval_required",
    changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
    requestOver: { now: "2026-07-09" },
  },
  {
    name: "no matching payroll cycle -> escalate",
    changes: SALARY_CHANGE,
    requestOver: { requestedEffectiveDate: "2026-12-25" },
  },
  {
    name: "unverified identity (company mismatch) -> escalate",
    changes: SALARY_CHANGE,
    requestOver: { session: { companyId: "co_other", authenticatedAdminId: "admin_jane" } },
  },
  {
    name: "no session at all -> escalate",
    changes: SALARY_CHANGE,
    requestOver: { session: null },
  },
  {
    name: "employee not active -> escalate",
    changes: SALARY_CHANGE,
    employmentOver: { status: "terminated" },
  },
  {
    name: "schema invalid (missing required field) -> escalate",
    changes: { jobTitle: { oldValue: "Senior Engineer", newValue: "" } },
    countrySchemaOver: ["job_title", "weekly_hours"],
  },
  {
    name: "F-15 country schema unavailable (endpoint 404) -> escalate in both, never a vacuous pass",
    changes: SALARY_CHANGE,
    countrySchemaMissing: true,
  },
  {
    name: "F-26b unreadable cutoff_date -> escalate in both, never a silent 'not passed'",
    changes: SALARY_CHANGE,
    payrollRunsOver: [
      { id: "run_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "TBC", process_date: "2026-07-15", pay_date: "2026-07-31" },
    ],
  },
  {
    name: "F-26a zone-less cutoff timestamp -> both implementations agree, and on UTC",
    changes: SALARY_CHANGE,
    requestOver: { requestedEffectiveDate: "2026-09-20", now: "2026-09-05T14:00:00Z" },
    payrollRunsOver: [
      { id: "run_2026_09", period_start: "2026-09-01", period_end: "2026-09-30", cutoff_date: "2026-09-05 17:00:00", process_date: "2026-09-15", pay_date: "2026-09-30" },
    ],
  },
  {
    name: "job title change -> JOB_TITLE_CHANGE",
    changes: { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } },
  },
  {
    name: "composite change (salary + hours) -> COMPOSITE",
    changes: { ...SALARY_CHANGE, weeklyHours: { oldValue: 40, newValue: 32 } },
  },
  {
    name: "salary decrease -> SALARY_DECREASE",
    changes: { salary: { oldAmount: 60000, newAmount: 50000, currency: "USD" } },
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n Amendment Gates match policyEngine — ${scenario.name}`, () => {
    const request = requestFor(scenario.changes, scenario.requestOver ?? {});
    const empResponse = employmentResponse(scenario.employmentOver ?? {});
    const schemaResponse = scenario.countrySchemaMissing
      ? missingCountrySchemaResponse()
      : countrySchemaResponse(scenario.countrySchemaOver ?? undefined);
    const runsResponse = payrollRunsResponse(scenario.payrollRunsOver);

    const fromN8n = runAmendmentGatesNode({
      request,
      employmentResponse: empResponse,
      countrySchemaResponse: schemaResponse,
      payrollRunsResponse: runsResponse,
    });

    const identityVerified = Boolean(
      request.session && fromN8n.employment && request.session.companyId === fromN8n.employment.company_id
    );

    const fromPolicyEngine = evaluate({
      identityVerified,
      employment: fromN8n.employment,
      countrySchema: fromN8n.countrySchema,
      changes: scenario.changes,
      requestedEffectiveDate: request.requestedEffectiveDate,
      now: request.now,
      // The node's OWN paged/deduped/country-filtered calendar, for the same
      // reason `employment` and `countrySchema` above are the node's own: in the
      // reference implementation that narrowing is done by
      // RemoteClient.listPayrollRuns() BEFORE evaluate() ever sees the list, so
      // handing evaluate() the raw pages here would be comparing the two halves
      // of different pipelines.
      payrollCycles: fromN8n.payrollCycles,
    });

    assert.equal(fromN8n.decision, fromPolicyEngine.decision, "decision differs");
    assert.equal(fromN8n.reason, fromPolicyEngine.reason, "reason differs");
    assert.deepEqual(fromN8n.flags, fromPolicyEngine.flags, "flags differ");
    assert.equal(fromN8n.amendmentType, amendmentType(scenario.changes), "amendmentType differs");
    assert.deepEqual(fromN8n.payload, fromPolicyEngine.payload ?? null, "payload differs");
  });
}

test("the n8n node body parses and returns n8n's item shape", () => {
  const out = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE),
    employmentResponse: employmentResponse(),
    countrySchemaResponse: countrySchemaResponse(),
    payrollRunsResponse: payrollRunsResponse(),
  });
  assert.equal(typeof out.decision, "string");
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.status, "pending_dual_approval");
  assert.match(out.summary, /salary from 50000 to 60000 USD/);
});

test("both n8n Code node bodies are syntactically valid", () => {
  // Same guard as n8nParity.test.js's equivalent — a Code node body is just a
  // string to n8n, so a broken one deploys happily and only fails mid-execution.
  const bodies = ["normalizeAmendmentRequest.js", "amendmentGates.js"];
  for (const file of bodies) {
    const src = readFileSync(join(__dirname, "..", "workflows", "nodes-uc06", file), "utf8");
    assert.doesNotThrow(() => new Function(src), `${file} does not compile`);
  }
});

// ---------------------------------------------------------------------------
// SWALLOWED UPSTREAM FAILURES + THE IDENTITY CONSTRUCTION SITE
// ---------------------------------------------------------------------------
// All three Remote nodes in this graph carry `onError: continueRegularOutput`,
// so a failed fetch reports success and hands the gates an error item. Live
// execution 4232 swallowed three 404s and recorded `identity_not_verified`.
//
// The second defect these pin is the one the first was hiding: the gates used
// to build a placeholder employment (`id` backfilled from the request,
// `company_id` defaulted to null), which a session carrying a null companyId
// matched — `null === null` — so identity PASSED on a record that was never
// loaded, and the run stopped one gate later on `employee_not_active`. An
// identity control whose correctness depends on a downstream gate is not a
// control. See workflows/nodes-uc06/amendmentGates.js's construction-site note.
// ---------------------------------------------------------------------------

const LIVE_404_ITEM = {
  error: {
    message: '404 - "{\\"message\\":\\"Employment not found\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 404",
    code: "ERR_BAD_REQUEST",
    status: 404,
  },
};

test("parity: execution 4232's swallowed 404s report the failed read, not an identity refusal", () => {
  const request = requestFor({ jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } });
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: LIVE_404_ITEM,
    countrySchemaResponse: LIVE_404_ITEM,
    payrollRunsResponse: LIVE_404_ITEM,
  });

  assert.notEqual(fromN8n.reason, "identity_not_verified");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.deepEqual(fromN8n.flags, ["upstream_record_not_found", "upstream_employment_404"]);
  assert.deepEqual(
    fromN8n.upstreamFailures.map((f) => [f.call, f.status, f.kind]),
    [
      ["employment", 404, "not_found"],
      ["country_schema", 404, "not_found"],
      ["payroll_runs", 404, "not_found"],
    ]
  );
  // No usable record means null, never a placeholder built from the request.
  assert.equal(fromN8n.employment, null);

  const real = evaluate({
    identityVerified: false,
    employment: null,
    countrySchema: null,
    changes: request.changes,
    requestedEffectiveDate: request.requestedEffectiveDate,
    now: request.now,
    payrollCycles: [],
    upstreamFailures: fromN8n.upstreamFailures,
  });
  assert.equal(fromN8n.decision, real.decision);
  assert.equal(fromN8n.reason, real.reason);
  assert.deepEqual(fromN8n.flags, real.flags);
});

test("a null-vs-null company match must stop at the IDENTITY gate, not one gate later", () => {
  // Remote answered 200 with an empty envelope — no error item to detect, so
  // this is the identity defect on its own, with the upstream fix out of the
  // picture. The distinction being pinned: the run must refuse BECAUSE identity
  // failed, not because a status gate happened to catch it afterwards.
  const request = requestFor(
    { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } },
    { session: { companyId: null, authenticatedAdminId: null } }
  );
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: { data: {} },
    countrySchemaResponse: countrySchemaResponse(),
    payrollRunsResponse: payrollRunsResponse(),
  });

  assert.equal(fromN8n.reason, "identity_not_verified");
  assert.notEqual(fromN8n.reason, "employee_not_active", "identity must not be rescued by the status gate");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.employment, null);
});

test("a real employment whose company_id is null still fails identity", () => {
  // Defence in depth inside the comparison, independent of the construction
  // site: a genuine record can carry a null company_id too, and matching it
  // against a null session companyId proves nothing.
  const request = requestFor(
    { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } },
    { session: { companyId: null, authenticatedAdminId: null } }
  );
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: employmentResponse({ company_id: null }),
    countrySchemaResponse: countrySchemaResponse(),
    payrollRunsResponse: payrollRunsResponse(),
  });
  assert.equal(fromN8n.reason, "identity_not_verified");
  assert.notEqual(fromN8n.employment, null, "a real record is still carried forward");
});

test("a healthy run records no upstream failures and still opens dual approval", () => {
  const fromN8n = runAmendmentGatesNode({
    request: requestFor({ jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } }),
    employmentResponse: employmentResponse(),
    countrySchemaResponse: countrySchemaResponse(),
    payrollRunsResponse: payrollRunsResponse(),
  });
  assert.deepEqual(fromN8n.upstreamFailures, []);
  assert.equal(fromN8n.decision, "dual_approval_required");
});

// ---------------------------------------------------------------------------
// THE ALPHA-3 DEFECT (finding F-27) — the country code this node carries forward
// ---------------------------------------------------------------------------
// UC-06's per-country schema is fetched from
// `/v1/countries/{code}/employment_basic_information`, and `{code}` must be the
// ALPHA-2 form. The live API nests `country: {code: "DEU", alpha_2_code: "DE"}`
// — `code` is ALPHA-3, and there is no top-level `country_code` on the record at
// all. This node's old chain (`country_code ?? country.alpha_2_code ??
// country.code`) had a written-down path that placed "DEU" into that field.
//
// Fixtures below are REAL Sandbox records copied verbatim
// (test/fixtures/remoteEmployment.js). A fixture that agrees with the code
// instead of with the API cannot fail when the code is wrong about the API,
// which is exactly how the flat synthetic `country_code: "NG"` record used by
// every other test in this file kept this defect invisible.
const liveEmploymentResponse = (record) => ({ data: { employment: record } });

/** A request whose session matches the REAL record's real company_id. */
const requestForLiveRecord = (record, changes, over = {}) =>
  requestFor(changes, {
    employmentId: record.id,
    session: { companyId: record.company_id, authenticatedAdminId: "admin_jane" },
    ...over,
  });

// ---------------------------------------------------------------------------
// THE REAL CONTRACT-AMENDMENT FORM — closed, with conditionals both copies must
// resolve identically.
// ---------------------------------------------------------------------------
// Every scenario above feeds an OPEN schema (`{required: [...]}` and nothing
// else), which is the shape the mock used to serve and the shape under which
// two implementations can disagree about `properties`,
// `additionalProperties: false` and `allOf` without any test noticing. These
// four run the LIVE NLD form — captured verbatim from
// gateway.remote-sandbox.com on 2026-08-18 — against a LIVE-SHAPED employment
// record, and assert the two copies agree field for field on the payload, not
// merely on the decision.
const LIVE_NL_EMPLOYMENT = {
  id: "emp_nl_amend_001",
  status: "active",
  company_id: "co_amend_01",
  full_name: "Jan Willem Bakker",
  job_title: "Senior Software Engineer",
  country: { code: "NLD", name: "Netherlands", alpha_2_code: "NL" },
  active_contract_id: "ctr_nl_amend_001",
  basic_information: {
    name: "Jan Willem Bakker",
    job_title: "Senior Software Engineer",
    login_email: "personal",
    provisional_start_date: "2023-10-01",
    tax_servicing_countries: [],
    tax_job_category: null,
    has_seniority_date: null,
  },
  contract_details: {
    annual_gross_salary: 7200000,
    compensation_currency_code: "EUR",
    contract_duration_type: "fixed_term",
    contract_end_date: "2028-06-26",
    role_description: "Responsible for contributing to team projects.",
    // A STRING, exactly as one live NL record stores it — the API refuses a
    // string here (422 "Type mismatch. Expected Number but got String"), so
    // both copies must coerce it to the type the schema declares.
    work_hours_per_week: "40",
    work_schedule: "full_time",
    holiday_allowance: "On top of salary",
  },
};

const nlCycles = () =>
  pageOf([
    cycle({
      id: "nl_jul",
      country: { code: "NLD", alpha_2_code: "NL" },
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      cutoff_date: "2026-07-20",
    }),
  ]);

/** Run BOTH copies against the real form and return the pair. */
function runRealForm(changes, over = {}) {
  const request = requestFor(changes, {
    employmentId: LIVE_NL_EMPLOYMENT.id,
    session: { companyId: LIVE_NL_EMPLOYMENT.company_id, authenticatedAdminId: "admin_jane" },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
    ...over,
  });
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: { data: { employment: LIVE_NL_EMPLOYMENT } },
    countrySchemaResponse: { data: CONTRACT_AMENDMENT_SCHEMAS.NLD },
    payrollRunsPages: [nlCycles()],
  });
  const fromRef = evaluate({
    identityVerified: true,
    employment: normalizeEmployment(LIVE_NL_EMPLOYMENT),
    countrySchema: CONTRACT_AMENDMENT_SCHEMAS.NLD,
    changes,
    requestedEffectiveDate: request.requestedEffectiveDate,
    now: request.now,
    payrollCycles: fromN8n.payrollCycles,
  });
  return { fromN8n, fromRef: JSON.parse(JSON.stringify(fromRef)) };
}

test("REAL FORM, POSITIVE: a salary amendment reaches dual approval in BOTH copies, with the same payload", () => {
  const { fromN8n, fromRef } = runRealForm({ salary: { oldAmount: 72000, newAmount: 78000, currency: "EUR" } });

  assert.equal(fromN8n.decision, "dual_approval_required");
  assert.equal(fromN8n.reason, "all_gates_passed");
  assert.equal(fromRef.decision, "dual_approval_required");
  assert.equal(fromRef.reason, "all_gates_passed");

  // Field for field, on the form's OWN names — this is the assertion that would
  // have failed for the whole life of the {job_title, weekly_hours, base_salary,
  // currency} payload, and that no fail-closed test could ever have made.
  assert.deepEqual(fromN8n.payload, {
    annual_gross_salary: 7800000, // 78,000.00 × 100, integer — the API rejects a float
    effective_date: "2026-07-15",
    job_title: "Senior Software Engineer",
    role_description: "Responsible for contributing to team projects.",
    contract_duration_type: "fixed_term",
    work_schedule: "full_time",
    work_hours_per_week: 40, // coerced from the STRING the record stores
    contract_end_date: "2028-06-26", // added by the fixed_term conditional
  });
  assert.deepEqual(fromRef.payload, fromN8n.payload);
  // The closed form's own vocabulary only — an undeclared key is a live 422
  // ("base_salary: is not accepted"), not a harmless extra.
  assert.ok(!("base_salary" in fromN8n.payload));
  assert.ok(!("weekly_hours" in fromN8n.payload));
});

test("REAL FORM: the fixed_term conditional is resolved by BOTH copies, not just the top-level required list", () => {
  const indefinite = {
    ...LIVE_NL_EMPLOYMENT,
    contract_details: { ...LIVE_NL_EMPLOYMENT.contract_details, contract_duration_type: "indefinite", contract_end_date: undefined },
  };
  const request = requestFor({ jobTitle: { oldValue: "Senior Software Engineer", newValue: "Staff Engineer" } }, {
    employmentId: indefinite.id,
    session: { companyId: indefinite.company_id, authenticatedAdminId: "admin_jane" },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
  });
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: { data: { employment: indefinite } },
    countrySchemaResponse: { data: CONTRACT_AMENDMENT_SCHEMAS.NLD },
    payrollRunsPages: [nlCycles()],
  });
  const fromRef = evaluate({
    identityVerified: true,
    employment: normalizeEmployment(indefinite),
    countrySchema: CONTRACT_AMENDMENT_SCHEMAS.NLD,
    changes: { jobTitle: { oldValue: "Senior Software Engineer", newValue: "Staff Engineer" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
    payrollCycles: fromN8n.payrollCycles,
  });

  // Live, an indefinite Dutch amendment answers
  // 422 {"contract_duration_type_ack":["can't be blank"],
  //      "non_compete_clause_apply":["can't be blank"]}
  // — both human decisions, neither on any record. Escalating BY NAME is the
  // only honest answer, and the two copies must name the same fields.
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "schema_invalid");
  assert.ok(fromN8n.flags.includes("missing_contract_duration_type_ack"), JSON.stringify(fromN8n.flags));
  assert.ok(fromN8n.flags.includes("missing_non_compete_clause_apply"), JSON.stringify(fromN8n.flags));
  assert.deepEqual(fromRef.flags, fromN8n.flags);
  assert.ok(!("contract_end_date" in fromN8n.payload), "the else branch FORBIDS contract_end_date on an indefinite contract");
});

test("REAL FORM: a salary DECREASE demands the two attestations no record carries, in BOTH copies", () => {
  const { fromN8n, fromRef } = runRealForm({ salary: { oldAmount: 72000, newAmount: 66000, currency: "EUR" } });
  assert.equal(fromN8n.amendmentType, "SALARY_DECREASE");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "schema_invalid");
  assert.ok(fromN8n.flags.includes("missing_salary_decrease_reason"), JSON.stringify(fromN8n.flags));
  assert.ok(fromN8n.flags.includes("missing_was_employee_informed"), JSON.stringify(fromN8n.flags));
  assert.deepEqual(fromRef.flags, fromN8n.flags);
});

test("REAL FORM: a stated decrease reason and informed-flag let the decrease through, in BOTH copies", () => {
  const { fromN8n, fromRef } = runRealForm({
    salary: {
      oldAmount: 72000,
      newAmount: 66000,
      currency: "EUR",
      decreaseReason: "role_change_or_demotion",
      employeeInformed: "yes",
    },
  });
  assert.equal(fromN8n.decision, "dual_approval_required");
  assert.equal(fromN8n.payload.salary_decrease_reason, "role_change_or_demotion");
  assert.equal(fromN8n.payload.was_employee_informed, "yes");
  assert.deepEqual(fromRef.payload, fromN8n.payload);
});

test("POSITIVE: a real German employment carries the ALPHA-2 code forward, never 'DEU'", () => {
  const record = LIVE_EMPLOYMENT_DE;
  assert.equal(record.country.code, "DEU", "fixture guard: the live record really does carry the alpha-3 form");
  assert.equal(record.country_code, undefined, "fixture guard: there is no top-level country_code on a live record");

  const fromN8n = runAmendmentGatesNode({
    request: requestForLiveRecord(record, { jobTitle: { oldValue: "Financial Advisor", newValue: "Senior Financial Advisor" } }),
    employmentResponse: liveEmploymentResponse(record),
    // Only job_title is required here, because the live record leaves
    // weekly_hours/base_salary null and this test is about the COUNTRY code,
    // not about the schema gate that a null hours field would (correctly) trip.
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    // A DE calendar, because the node now narrows by country: the default NG
    // fixture would (correctly) leave this record with no governing cycle.
    payrollRunsResponse: pageOf([cycle({ id: "de_jul", country: { code: "DEU", alpha_2_code: "DE" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-20" })]),
  });

  // The load-bearing assertion — "DE" is what `/v1/countries/{code}/…` accepts.
  assert.equal(fromN8n.employment.country_code, "DE");
  assert.notEqual(fromN8n.employment.country_code, "DEU");

  // And the run really does reach the approval path, so this is a POSITIVE
  // test: it would still pass if the gate below it were dead, but it fails the
  // moment the country code stops resolving — which is the pairing this
  // project learned it needs (a fail-closed assertion alone cannot tell a
  // cautious gate from a structurally dead one).
  assert.equal(fromN8n.decision, "dual_approval_required");
  assert.equal(fromN8n.reason, "all_gates_passed");

  // Parity: the reference implementation, fed the SAME real record through the
  // real normalizeEmployment(), reaches the same code.
  assert.equal(normalizeEmployment(record).country_code, fromN8n.employment.country_code);
});

test("a real Canadian employment resolves 'CA', not 'CAN' — the fix is not DE-specific", () => {
  const record = LIVE_EMPLOYMENT_CA;
  const fromN8n = runAmendmentGatesNode({
    request: requestForLiveRecord(record, { jobTitle: { oldValue: "Financial Manager", newValue: "Finance Director" } }),
    employmentResponse: liveEmploymentResponse(record),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf([cycle({ id: "ca_jul", country: { code: "CAN", alpha_2_code: "CA" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-20" })]),
  });
  assert.equal(fromN8n.employment.country_code, "CA");
  // Positive, not just a string check: the CA calendar really is the one used.
  assert.equal(fromN8n.decision, "dual_approval_required");
  assert.deepEqual(fromN8n.payrollCycles.map((c) => c.id), ["ca_jul"]);
  assert.equal(normalizeEmployment(record).country_code, "CA");
});

test("FAIL CLOSED: an alpha-3-only record yields null, and a null country escalates country_schema_unavailable", () => {
  // The same real German record with `country.alpha_2_code` deleted and nothing
  // else changed. "DEU" cannot be compared or put in a URL, so the node must
  // yield null rather than a wrong string — and in the live graph a country
  // that cannot be resolved is a schema that cannot be fetched, which is the
  // `missingCountrySchemaResponse()` shape below (finding F-15: no schema is
  // NOT a schema requiring nothing).
  const record = withoutAlpha2(LIVE_EMPLOYMENT_DE);
  const fromN8n = runAmendmentGatesNode({
    request: requestForLiveRecord(record, { jobTitle: { oldValue: "Financial Advisor", newValue: "Senior Financial Advisor" } }),
    employmentResponse: liveEmploymentResponse(record),
    countrySchemaResponse: missingCountrySchemaResponse(),
    payrollRunsResponse: payrollRunsResponse(),
  });

  assert.equal(fromN8n.employment.country_code, null, "an alpha-3-only record must yield null, never 'DEU'");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "country_schema_unavailable");
  assert.ok(fromN8n.flags.includes("country_schema_unavailable"));

  // A null country never widens anything: no approval path is opened.
  assert.notEqual(fromN8n.decision, "dual_approval_required");

  // Parity with the reference implementation's own answer for the same record.
  assert.equal(normalizeEmployment(record).country_code, null);
});

test("a lowercase or padded alpha-2 code is canonicalised, not rejected", () => {
  // normalizeCountryCode() upper-cases and trims before the shape check, and
  // this port must too — a " de " reaching the schema URL as itself is a 404
  // and a spurious escalation.
  const record = { ...LIVE_EMPLOYMENT_DE, country: { ...LIVE_EMPLOYMENT_DE.country, alpha_2_code: " de " } };
  const fromN8n = runAmendmentGatesNode({
    request: requestForLiveRecord(record, { jobTitle: { oldValue: "Financial Advisor", newValue: "Senior Financial Advisor" } }),
    employmentResponse: liveEmploymentResponse(record),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf([cycle({ id: "de_jul", country: { code: "DEU", alpha_2_code: "DE" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-20" })]),
  });
  assert.equal(fromN8n.employment.country_code, "DE");
  assert.equal(fromN8n.decision, "dual_approval_required");
});

// ---------------------------------------------------------------------------
// THE PAYROLL CALENDAR — the wrong URL, and the wrong-country answer under it
// ---------------------------------------------------------------------------
// The node used to read `$input.first().json?.data?.payroll_runs ?? []` from an
// HTTP node pointed at `/v1/company-payroll-runs?company_id=…`, a path Remote
// does not have. It 404'd on every live run, `onError: continueRegularOutput`
// reported that 404 as a success, and the gate escalated
// `upstream_payroll_runs_404` — indistinguishable from a cautious gate.
//
// EVERY FAIL-CLOSED ASSERTION IN THIS FILE PASSED THROUGHOUT THAT ENTIRE LIFE.
// That is the whole reason the tests below are POSITIVE ones: a use case that
// structurally cannot succeed and one that is refusing correctly produce the
// same output, and only "this input MUST reach a cutoff decision, from THIS
// country's cycle" tells them apart.
// ---------------------------------------------------------------------------

/** Live NL: TWO cycles covering the same June period, cutoffs ten days apart. */
const NL_JUNE_AMBIGUOUS = [
  cycle({ id: "nl_jun_main", type: "main", status: "processing", country: { code: "NLD", alpha_2_code: "NL" }, cutoff_date: "2026-06-20" }),
  cycle({ id: "nl_jun_one_off", type: "one_off", status: "completed", country: { code: "NLD", alpha_2_code: "NL" }, cutoff_date: "2026-06-10" }),
];

const inCountry = (alpha2, alpha3) => employmentResponse({ country: { code: alpha3, alpha_2_code: alpha2 } });

/** Same calendar, same effective date, same clock — only the country differs. */
const runAgainstLiveCalendar = (alpha2, alpha3, over = {}) =>
  runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10", ...over }),
    employmentResponse: inCountry(alpha2, alpha3),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf(LIVE_JUNE_CALENDAR),
  });

test("POSITIVE: a French amendment locks to France's cutoff, not to Singapore's", () => {
  const fr = runAgainstLiveCalendar("FR", "FRA");

  // The load-bearing assertion. Unfiltered, `.find()` returns sg_jun — whose
  // 6 June cutoff has already passed on 10 June — and the amendment would have
  // been refused as retroactive using another jurisdiction's payroll lock.
  assert.equal(fr.cutoff.cycle.id, "fr_jun");
  assert.deepEqual(fr.payrollCycles.map((c) => c.id), ["fr_jun"]);
  assert.equal(fr.decision, "dual_approval_required");
  assert.equal(fr.reason, "all_gates_passed");
  assert.deepEqual(fr.upstreamFailures, [], "a 200 from the real path records no failure");
});

test("POSITIVE, same calendar and same date: a Singaporean amendment IS past its cutoff", () => {
  // The pair is the point: one input must succeed and one must fail, out of the
  // SAME company-wide calendar. A filter that returned everything, or nothing,
  // would satisfy one direction alone.
  const sg = runAgainstLiveCalendar("SG", "SGP");
  assert.deepEqual(sg.payrollCycles.map((c) => c.id), ["sg_jun"]);
  assert.equal(sg.decision, "escalate");
  assert.equal(sg.reason, "cutoff_lock_passed");
});

test("the country-filtered calendar is what policyEngine would decide on", () => {
  // Parity in the direction that matters: the reference implementation, handed
  // this node's own narrowed list (which is what RemoteClient.listPayrollRuns()
  // hands it in production), reaches the identical verdict.
  for (const [alpha2, alpha3] of [["FR", "FRA"], ["SG", "SGP"], ["CA", "CAN"]]) {
    const fromN8n = runAgainstLiveCalendar(alpha2, alpha3);
    const real = evaluate({
      identityVerified: true,
      employment: fromN8n.employment,
      countrySchema: fromN8n.countrySchema,
      changes: SALARY_CHANGE,
      requestedEffectiveDate: "2026-06-15",
      now: "2026-06-10",
      payrollCycles: fromN8n.payrollCycles,
    });
    assert.equal(fromN8n.decision, real.decision, `${alpha2} decision differs`);
    assert.equal(fromN8n.reason, real.reason, `${alpha2} reason differs`);
    assert.deepEqual(fromN8n.flags, real.flags, `${alpha2} flags differ`);
  }
});

test("a country with no cycle of its own escalates honestly, and NOT as an upstream failure", () => {
  // The calendar was read perfectly; it simply contains nothing for Germany.
  // "We read it and none governs" and "we could not read it" are different
  // facts, and only the second is an upstream failure.
  const de = runAgainstLiveCalendar("DE", "DEU");
  assert.deepEqual(de.payrollCycles, []);
  assert.equal(de.decision, "escalate");
  assert.equal(de.reason, "no_matching_payroll_cycle");
  assert.deepEqual(de.upstreamFailures, []);
});

test("PAGINATION: a cycle that only exists on page 2 is still found", () => {
  // The live endpoint reports `total_pages: 1` while page 2 still returns rows.
  // A client that believed it would read a calendar missing half its cycles and
  // report "no cycle governs this date" — a positive claim out of a short read.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsPages: [
      pageOf(LIVE_JUNE_CALENDAR.filter((c) => c.id !== "fr_jun"), { total_pages: 1, current_page: 1 }),
      pageOf([LIVE_JUNE_CALENDAR.find((c) => c.id === "fr_jun")], { total_pages: 1, current_page: 2 }),
      pageOf([], { total_pages: 1, current_page: 3 }),
    ],
  });
  assert.deepEqual(fromN8n.payrollCycles.map((c) => c.id), ["fr_jun"]);
  assert.equal(fromN8n.decision, "dual_approval_required");
});

test("PAGINATION: a page-1-only read would have gotten this wrong", () => {
  // The same fixture with only page 1, proving the assertion above is about
  // pagination and not about the filter incidentally working.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsPages: [pageOf(LIVE_JUNE_CALENDAR.filter((c) => c.id !== "fr_jun"))],
  });
  assert.equal(fromN8n.reason, "no_matching_payroll_cycle");
});

test("DEDUPE: the same cycle repeated across pages is one cycle, not an ambiguity", () => {
  // A full live walk returns 34 rows for 17 distinct ids. Left undeduped, the
  // repeat looks like two cycles covering one period — which the ambiguity gate
  // below would (wrongly) escalate.
  const fr = LIVE_JUNE_CALENDAR.find((c) => c.id === "fr_jun");
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsPages: [pageOf([fr, fr]), pageOf([fr])],
  });
  assert.deepEqual(fromN8n.payrollCycles.map((c) => c.id), ["fr_jun"]);
  assert.equal(fromN8n.decision, "dual_approval_required");
});

test("a row with no id is kept, never silently dropped", () => {
  // A dropped cycle reads downstream as "no cycle governs this date" — a claim,
  // not an absence. Matches RemoteClient.listPayrollRuns()'s anon-key rule.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf([{ ...LIVE_JUNE_CALENDAR.find((c) => c.id === "fr_jun"), id: undefined }]),
  });
  assert.equal(fromN8n.payrollCycles.length, 1);
  assert.equal(fromN8n.decision, "dual_approval_required");
});

test("FAIL CLOSED: no usable alpha-2 country means no cutoff is guessed", () => {
  // An alpha-3-only record reaching the payroll gate — which it can, because the
  // graph's schema URL uses the alpha-3 `country.code` and therefore succeeds.
  // The company-wide calendar cannot be narrowed, so the gate must refuse rather
  // than hand this employee whichever country sorted first.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: employmentResponse({ country_code: null, country: { code: "FRA" } }),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf(LIVE_JUNE_CALENDAR),
  });

  assert.equal(fromN8n.employment.country_code, null);
  assert.deepEqual(fromN8n.payrollCycles, [], "an unnarrowable calendar is never passed on unfiltered");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.deepEqual(fromN8n.flags, ["upstream_record_not_found", "upstream_payroll_runs_404"]);
  assert.equal(fromN8n.cutoff, null, "no cutoff is computed at all");

  // Same verdict as the reference implementation, whose listPayrollRuns()
  // returns null for the same condition and whose workflow.js records it as
  // exactly this failure.
  const real = evaluate({
    identityVerified: true,
    employment: fromN8n.employment,
    countrySchema: fromN8n.countrySchema,
    changes: SALARY_CHANGE,
    requestedEffectiveDate: "2026-06-15",
    now: "2026-06-10",
    payrollCycles: [],
    upstreamFailures: fromN8n.upstreamFailures,
  });
  assert.equal(fromN8n.decision, real.decision);
  assert.equal(fromN8n.reason, real.reason);
  assert.deepEqual(fromN8n.flags, real.flags);
});

test("FAIL CLOSED: an unreadable page is not an empty calendar", () => {
  // Finding F-15's shape, at the calendar: coercing an unusable body to []
  // turns "we could not read it" into "there are none", which the cutoff gate
  // then reports as a fact about the company's payroll.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsPages: [pageOf(LIVE_JUNE_CALENDAR), { data: { payroll_runs: "not-an-array" } }],
  });
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.notEqual(fromN8n.reason, "no_matching_payroll_cycle");
});

test("a failure on page 2 is reported, not quietly truncated", () => {
  // A calendar cut short by a mid-walk 404 looks exactly like a complete
  // calendar with fewer cycles in it.
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-10" }),
    employmentResponse: inCountry("FR", "FRA"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsPages: [pageOf(LIVE_JUNE_CALENDAR.filter((c) => c.id !== "fr_jun")), LIVE_404_ITEM],
  });
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.deepEqual(fromN8n.flags, ["upstream_record_not_found", "upstream_payroll_runs_404"]);
  assert.equal(fromN8n.upstreamFailures.length, 1);
  assert.equal(fromN8n.upstreamFailures[0].call, "payroll_runs");
});

// ---------------------------------------------------------------------------
// THE OVERLAPPING-CYCLE AMBIGUITY — a DELIBERATE divergence from the reference
// ---------------------------------------------------------------------------
// Live NL carries two cycles covering the same June period with cutoffs ten
// days apart (a `main` run locking 06-20 and a `one_off` run locking 06-10).
// Country filtering cannot separate them, and picking one needs a status/type
// rule that Remote's reference does not confirm.
//
// BOTH COPIES NOW ESCALATE. The port had this gate first and the reference took
// the first covering cycle, a one-directional divergence pinned here in both
// directions so it could not outlive its reason. That handoff is closed: the
// gate landed in src/uc06/cutoffEngine.js (cyclesCovering, distinctCutoffCount)
// and src/uc06/policyEngine.js, and the divergence test below has been replaced
// by its opposite — an assertion that the two agree, decision, reason, flags and
// recorded candidates alike.
// ---------------------------------------------------------------------------

const runAmbiguousNl = (over = {}) =>
  runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-01", ...over }),
    employmentResponse: inCountry("NL", "NLD"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf(NL_JUNE_AMBIGUOUS),
  });

test("AMBIGUITY: two NL cycles covering one period with different cutoffs escalate", () => {
  const fromN8n = runAmbiguousNl();
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "ambiguous_payroll_cycle");
  assert.deepEqual(fromN8n.flags, ["ambiguous_payroll_cycle"]);
  // No coin-flip cutoff is recorded anywhere a human or a later gate could read
  // it back as the answer.
  assert.equal(fromN8n.cutoff.cycle, null);
  assert.equal(fromN8n.cutoff.cutoffUnknown, true);
  assert.deepEqual(
    fromN8n.cutoff.ambiguousCycles.map((c) => [c.id, c.type, c.cutoff_date]),
    [["nl_jun_main", "main", "2026-06-20"], ["nl_jun_one_off", "one_off", "2026-06-10"]]
  );
});

test("AMBIGUITY: the reference implementation now refuses to choose too", () => {
  // The replacement for the divergence pin that used to sit here. It asserted
  // `real.reason === "all_gates_passed"` while the port escalated, so that the
  // day the reference gained the gate the pin would FAIL and be removed rather
  // than the divergence quietly outliving its reason. That day is today.
  const fromN8n = runAmbiguousNl();
  const real = evaluate({
    identityVerified: true,
    employment: fromN8n.employment,
    countrySchema: fromN8n.countrySchema,
    changes: SALARY_CHANGE,
    requestedEffectiveDate: "2026-06-15",
    now: "2026-06-01",
    payrollCycles: NL_JUNE_AMBIGUOUS,
  });
  assert.equal(real.decision, "escalate");
  assert.equal(real.reason, "ambiguous_payroll_cycle");
  assert.deepEqual(real.flags, fromN8n.flags);
  assert.equal(real.cutoff.cycle, null, "neither copy records a coin-flip cutoff");
  // Both record the same candidates, in the same order, so a human opening the
  // amendment row sees the same two runs whichever path produced it.
  assert.deepEqual(
    JSON.parse(JSON.stringify(real.cutoff.ambiguousCycles)),
    JSON.parse(JSON.stringify(fromN8n.cutoff.ambiguousCycles))
  );
});

test("AMBIGUITY: cycles that AGREE on the cutoff are not ambiguous", () => {
  // Two covering cycles with the same lock answer the only question this gate
  // asks identically, so a human adds nothing and the run proceeds.
  const agreeing = NL_JUNE_AMBIGUOUS.map((c) => ({ ...c, cutoff_date: "2026-06-20" }));
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-01" }),
    employmentResponse: inCountry("NL", "NLD"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf(agreeing),
  });
  assert.equal(fromN8n.decision, "dual_approval_required");
});

test("AMBIGUITY: one readable and one unreadable cutoff is a disagreement", () => {
  const mixed = [NL_JUNE_AMBIGUOUS[0], { ...NL_JUNE_AMBIGUOUS[1], cutoff_date: "TBC" }];
  const fromN8n = runAmendmentGatesNode({
    request: requestFor(SALARY_CHANGE, { requestedEffectiveDate: "2026-06-15", now: "2026-06-01" }),
    employmentResponse: inCountry("NL", "NLD"),
    countrySchemaResponse: countrySchemaResponse(["job_title"]),
    payrollRunsResponse: pageOf(mixed),
  });
  assert.equal(fromN8n.reason, "ambiguous_payroll_cycle");
});

// ---------------------------------------------------------------------------
// THE PAYLOAD IS BUILT AGAINST THE SCHEMA THAT ARRIVED — both copies, alike
// ---------------------------------------------------------------------------
// `buildAmendmentPayload()` used to emit four fixed keys taken from the mock's
// COUNTRY_SCHEMAS. Against the REAL Dutch form — required [has_seniority_date,
// name, job_title, provisional_start_date, tax_servicing_countries,
// tax_job_category, login_email], `additionalProperties: false` [CONFIRMED
// live 2026-08-18] — six required fields were missing and three of the four
// keys sent were not properties of the form at all. Every scenario above uses
// the mock's OPEN `{required: [...]}` shape, which cannot tell the old builder
// from the new one, so the closed live shape is exercised here explicitly.
// ---------------------------------------------------------------------------

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

/** An NL employment in the LIVE shape — the country-form fields sit on a
 *  `basic_information` block, exactly as `GET /v1/employments/{id}` returns
 *  them (employment 293527ed-…, Anna van Vliet, NL, active, read 2026-08-18).
 *  `has_seniority_date`/`tax_job_category` are "no"/"professional" here rather
 *  than the live nulls, because this fixture is about a COMPLETE record; the
 *  live nulls are what test/uc06AmendmentPayload.test.js's gap test pins. */
const NL_FULL_EMPLOYMENT = employmentResponse({
  country: { code: "NLD", alpha_2_code: "NL" },
  full_name: "Anna van Vliet",
  base_salary: 3600000,
  currency: "EUR",
  weekly_hours: 24,
  basic_information: {
    name: "Anna van Vliet",
    job_title: "Content Writer",
    login_email: "personal",
    provisional_start_date: "2022-10-03",
    tax_servicing_countries: ["NLD"],
    tax_job_category: "professional",
    has_seniority_date: "no",
    mobile_number: "+31623498765",
  },
});

const runAgainstLiveForm = (changes) => {
  const request = requestFor(changes, { requestedEffectiveDate: "2026-06-15", now: "2026-06-01" });
  const fromN8n = runAmendmentGatesNode({
    request,
    employmentResponse: NL_FULL_EMPLOYMENT,
    countrySchemaResponse: { data: LIVE_NLD_BASIC_INFO },
    payrollRunsResponse: pageOf([cycle({ id: "nl_jun", country: { code: "NLD", alpha_2_code: "NL" }, cutoff_date: "2026-06-20" })]),
  });
  const real = evaluate({
    identityVerified: true,
    employment: fromN8n.employment,
    countrySchema: fromN8n.countrySchema,
    changes,
    requestedEffectiveDate: request.requestedEffectiveDate,
    now: request.now,
    payrollCycles: fromN8n.payrollCycles,
  });
  return { fromN8n, real: JSON.parse(JSON.stringify(real)) };
};

test("LIVE FORM: a job-title amendment reaches dual_approval_required in BOTH copies", () => {
  // The positive assertion. A gate that can never pass and a gate refusing
  // correctly are indistinguishable on every fail-closed test above.
  const { fromN8n, real } = runAgainstLiveForm({
    jobTitle: { oldValue: "Content Writer", newValue: "Senior Content Writer" },
  });
  assert.equal(fromN8n.decision, "dual_approval_required", `port: ${fromN8n.reason}`);
  assert.equal(real.decision, "dual_approval_required", `reference: ${real.reason}`);
  assert.deepEqual(fromN8n.payload, real.payload);
  assert.deepEqual(fromN8n.payload, {
    job_title: "Senior Content Writer",
    name: "Anna van Vliet",
    provisional_start_date: "2022-10-03",
    has_seniority_date: "no",
    tax_servicing_countries: ["NLD"],
    tax_job_category: "professional",
    login_email: "personal",
  });
});

test("LIVE FORM: neither copy sends a key the closed form does not declare", () => {
  const { fromN8n, real } = runAgainstLiveForm({
    jobTitle: { oldValue: "Content Writer", newValue: "Senior Content Writer" },
  });
  for (const payload of [fromN8n.payload, real.payload]) {
    for (const key of ["weekly_hours", "base_salary", "currency"]) {
      assert.ok(!(key in payload), `${key} is not a property of employment_basic_information`);
    }
  }
});

test("LIVE FORM: a salary change the form cannot express escalates in BOTH copies", () => {
  const { fromN8n, real } = runAgainstLiveForm(SALARY_CHANGE);
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "change_not_expressible");
  assert.deepEqual(fromN8n.flags, ["change_not_expressible", "unexpressible_salary"]);
  assert.equal(real.reason, fromN8n.reason);
  assert.deepEqual(real.flags, fromN8n.flags);
});

// ---------------------------------------------------------------------------
// F-31 — a figure nobody gave is missing, not zero, and never a crash
// ---------------------------------------------------------------------------
// `toRemoteInteger(null)` threw out of the gates node, which runs BEFORE Claim
// Ticket and Append Audit Log — so a blank salary from the request portal lost
// the decision entirely: HTTP 500, no claim row, no amendment row, no audit
// row. Third instance of the shape fixed in 85816e7 (UC-05) and 7c5153b
// (UC-07). Both copies must now refuse it identically.
// ---------------------------------------------------------------------------

test("F-31: a blank salary escalates identically in BOTH copies, and neither throws", () => {
  const { fromN8n, real } = runAgainstLiveForm({ salary: { oldAmount: 36000, newAmount: null, currency: "EUR" } });
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "change_value_underivable");
  assert.deepEqual(fromN8n.flags, ["change_value_underivable", "underivable_salary_newAmount"]);
  assert.equal(real.reason, fromN8n.reason);
  assert.deepEqual(real.flags, fromN8n.flags);
  // The type is not asserted to be an increase — `null >= null` is true in JS,
  // which is exactly how a no-op used to be labelled SALARY_INCREASE.
  assert.equal(fromN8n.amendmentType, "SALARY_CHANGE_UNDETERMINED");
  assert.equal(real.amendmentType, fromN8n.amendmentType);
});

test("F-31: a quoted amount is refused in BOTH copies rather than coerced", () => {
  const { fromN8n, real } = runAgainstLiveForm({ salary: { oldAmount: 36000, newAmount: "39000", currency: "EUR" } });
  assert.equal(fromN8n.reason, "change_value_underivable");
  assert.equal(real.reason, fromN8n.reason);
  assert.deepEqual(real.payload, fromN8n.payload);
  assert.ok(!("annual_gross_salary" in fromN8n.payload), "no coerced amount reaches the payload");
  assert.ok(!("base_salary" in fromN8n.payload), "and no old figure is carried under the changed key");
});
