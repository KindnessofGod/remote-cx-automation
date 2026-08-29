// ---------------------------------------------------------------------------
// upstreamFailure.test.js — a failed read must never be recorded as a refusal
// ---------------------------------------------------------------------------
// WHAT THIS PINS
//
// Four n8n graphs carry `onError: continueRegularOutput` on their Remote HTTP
// nodes, which reports `executionStatus: "success"` and passes an ERROR OBJECT
// downstream in place of data. Live on 2026-08-17 that produced three
// `audit_log` rows (UC-02 exec 4218, UC-06 exec 4232, UC-09 exec 4238) whose
// recorded reason was `identity_not_verified` — for runs where nothing about
// identity had failed and Remote had answered 404/403.
//
// Reading those rows, a policy refusal and an API outage are the same record.
// The tests below pin the three properties that fix requires:
//
//   1. DETECTION — the error item is recognised from its REAL shape, read off
//      execution 4218 rather than guessed, and ordinary data is never mistaken
//      for it.
//   2. FAIL CLOSED — an upstream failure can only ever make a decision
//      stricter. It can never turn a refusal into an approval. Asserted
//      against all three real policy engines, on inputs that otherwise pass
//      every gate.
//   3. ATTRIBUTION — the reason names the failed READ, not a gate that never
//      really ran, and it ranks in the metrics layer as its own exception
//      reason instead of being lumped in with `identity_not_verified`.
//
// Hermetic: pure functions only, no network, no LLM, no database.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeUpstreamError,
  findUpstreamFailure,
  upstreamVerdict,
  isUpstreamReason,
  REASON_UPSTREAM_NOT_FOUND,
  REASON_UPSTREAM_UNAVAILABLE,
} from "../src/shared/upstreamFailure.js";
import { evaluate as evaluateUc02 } from "../src/uc02/policyEngine.js";
import { evaluate as evaluateUc06 } from "../src/uc06/policyEngine.js";
import { evaluate as evaluateUc09, INCENTIVE_REQUIRED_FIELDS } from "../src/uc09/policyEngine.js";
import { rankExceptionReasons } from "../src/metrics/compute.js";

// ---------------------------------------------------------------------------
// Fixtures copied verbatim out of live n8n execution data
// (GET /api/v1/executions/4218?includeData=true). The stack trace is trimmed;
// every other field is exactly what n8n emitted.
// ---------------------------------------------------------------------------
const LIVE_404_ITEM = {
  error: {
    message: '404 - "{\\"message\\":\\"Employment not found\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 404\n    at settle (...)",
    code: "ERR_BAD_REQUEST",
    status: 404,
  },
};
const LIVE_403_ITEM = {
  error: {
    message: '403 - "{\\"message\\":\\"Forbidden, invalid role for this endpoint\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 403\n    at settle (...)",
    code: "ERR_BAD_REQUEST",
    status: 403,
  },
};

// --- 1. detection ----------------------------------------------------------

test("the live 404 error item is detected as an authoritative not_found", () => {
  const failure = describeUpstreamError(LIVE_404_ITEM, "employment");
  assert.equal(failure.call, "employment");
  assert.equal(failure.status, 404);
  assert.equal(failure.kind, "not_found");
  assert.match(failure.message, /Employment not found/);
});

test("the live 403 error item is detected as unreachable, NOT as a missing record", () => {
  // The distinction that matters: a 403 says nothing whatsoever about whether
  // the record exists. Treating it as "not found" would be inventing an answer.
  const failure = describeUpstreamError(LIVE_403_ITEM, "expense_categories");
  assert.equal(failure.status, 403);
  assert.equal(failure.kind, "unreachable");
});

test("a transport error with no status is unreachable, and its flag says so", () => {
  const failure = describeUpstreamError({ error: { message: "socket hang up", name: "Error" } }, "employment");
  assert.equal(failure.status, null);
  assert.equal(failure.kind, "unreachable");
  assert.deepEqual(upstreamVerdict(failure).flags, [REASON_UPSTREAM_UNAVAILABLE, "upstream_employment_error"]);
});

test("ordinary Remote data is never mistaken for a failed fetch", () => {
  assert.equal(describeUpstreamError({ data: { employment: { id: "e1" } } }, "employment"), null);
  assert.equal(describeUpstreamError({ employment: { id: "e1" } }, "employment"), null);
  assert.equal(describeUpstreamError(null, "employment"), null);
  assert.equal(describeUpstreamError([], "employment"), null);
  // A real payload that happens to carry its own `error` field alongside
  // `data` is a response, not n8n's error item.
  assert.equal(describeUpstreamError({ data: { employment: {} }, error: null }, "employment"), null);
});

test("the flag pairs the call with the status, so details name what to go and fix", () => {
  assert.deepEqual(upstreamVerdict(describeUpstreamError(LIVE_403_ITEM, "expense_categories")).flags, [
    REASON_UPSTREAM_UNAVAILABLE,
    "upstream_expense_categories_403",
  ]);
  assert.deepEqual(upstreamVerdict(describeUpstreamError(LIVE_404_ITEM, "employment")).flags, [
    REASON_UPSTREAM_NOT_FOUND,
    "upstream_employment_404",
  ]);
});

test("findUpstreamFailure/isUpstreamReason are total on junk input", () => {
  assert.equal(findUpstreamFailure(null, "employment"), null);
  assert.equal(findUpstreamFailure([null, undefined], "employment"), null);
  assert.equal(upstreamVerdict(null), null);
  assert.equal(isUpstreamReason("identity_not_verified"), false);
  assert.equal(isUpstreamReason(REASON_UPSTREAM_NOT_FOUND), true);
  assert.equal(isUpstreamReason(REASON_UPSTREAM_UNAVAILABLE), true);
});

// ---------------------------------------------------------------------------
// 2. FAIL CLOSED — the property that makes this change safe to ship.
//
// Each block builds inputs that pass every gate, confirms the clean decision,
// then re-runs with each upstream failure injected. The decision must move to
// `escalate` every time. Nothing here can turn a refusal into an approval,
// because nothing here has a branch that returns an approval at all.
// ---------------------------------------------------------------------------

const cleanUc02 = () => ({
  identityVerified: true,
  employmentActive: true,
  // The REAL Remote expense shape — `total_amount`/`lines`/`vat_amount` do not
  // exist on one (see src/uc02/policyEngine.js's header). A clean claim needs a
  // receipt, matching currency objects on both sides, and converted figures
  // equal to the originals.
  expense: {
    employment_id: "emp_1",
    status: "pending",
    title: "Team lunch",
    amount: 4000,
    currency: { code: "USD", name: "United States Dollar", symbol: "$" },
    converted_amount: 4000,
    converted_currency: { code: "USD", name: "United States Dollar", symbol: "$" },
    tax_amount: 330,
    converted_tax_amount: 330,
    expense_date: "2026-07-02",
    receipts: [{ id: "file-1", name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }],
  },
  expenseOwned: true,
  duplicate: null,
  categoryValid: true,
  classification: { categoryId: "cat_meals", confidence: 0.95, source: "llm" },
  policyCap: 50000,
});

test("UC-02: a clean claim auto-approves, and EVERY upstream failure stops it", () => {
  assert.equal(evaluateUc02(cleanUc02()).decision, "auto_approve");

  for (const failure of [
    { call: "employment", status: 404, kind: "not_found" },
    { call: "employment", status: 403, kind: "unreachable" },
    { call: "expense", status: 500, kind: "unreachable" },
    { call: "expense_categories", status: 403, kind: "unreachable" },
  ]) {
    const result = evaluateUc02({ ...cleanUc02(), upstreamFailures: [failure] });
    assert.notEqual(result.decision, "auto_approve", `${failure.call} ${failure.status} must not auto-approve`);
    assert.equal(result.decision, "escalate");
    assert.ok(isUpstreamReason(result.reason), `expected an upstream reason, got ${result.reason}`);
  }
});

const cleanUc06 = () => ({
  identityVerified: true,
  employment: { id: "emp_1", status: "active", company_id: "co_1", country_code: "US", job_title: "Dev", weekly_hours: 40, base_salary: 500000, currency: "USD" },
  countrySchema: { required: ["job_title"] },
  changes: { jobTitle: { oldValue: "Dev", newValue: "Senior Dev" } },
  requestedEffectiveDate: "2026-09-05",
  now: "2026-08-01T00:00:00.000Z",
  payrollCycles: [{ id: "pr_1", period_start: "2026-09-01", period_end: "2026-09-30", cutoff_date: "2026-09-20T17:00:00Z" }],
});

test("UC-06: a clean amendment opens dual approval, and EVERY upstream failure stops it", () => {
  assert.equal(evaluateUc06(cleanUc06()).decision, "dual_approval_required");

  for (const failure of [
    { call: "employment", status: 404, kind: "not_found" },
    { call: "employment", status: 502, kind: "unreachable" },
    { call: "payroll_runs", status: 403, kind: "unreachable" },
  ]) {
    const result = evaluateUc06({ ...cleanUc06(), upstreamFailures: [failure] });
    assert.notEqual(result.decision, "dual_approval_required", `${failure.call} must not open an approval`);
    assert.equal(result.decision, "escalate");
    assert.ok(isUpstreamReason(result.reason), `expected an upstream reason, got ${result.reason}`);
  }
});

const cleanUc09 = () => ({
  identityVerified: true,
  employment: { id: "emp_1", status: "active", company_id: "co_1", country_code: "US" },
  incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
  adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
  now: "2026-08-01T00:00:00.000Z",
});

test("UC-09: an upstream failure can never open an approval slot on the money path", () => {
  const clean = evaluateUc09(cleanUc09());
  assert.equal(clean.decision, "dual_approval_required");
  assert.equal(clean.approvalSlotsRequired, 2);

  for (const failure of [
    { call: "employment", status: 404, kind: "not_found" },
    { call: "employment", status: 403, kind: "unreachable" },
  ]) {
    const result = evaluateUc09({ ...cleanUc09(), upstreamFailures: [failure] });
    assert.equal(result.decision, "escalate");
    // The floor-of-2 invariant is about how many humans must approve; this is
    // the stronger statement that NO approval path is offered at all, and that
    // no payload exists for anyone to approve.
    assert.equal(result.approvalSlotsRequired, 0);
    assert.equal(result.payload, null);
    assert.ok(isUpstreamReason(result.reason));
  }
});

// ---------------------------------------------------------------------------
// 3. ATTRIBUTION — the exact misattribution the live rows recorded.
// ---------------------------------------------------------------------------

test("UC-02: a 404'd employment no longer reads as an identity refusal", () => {
  // Execution 4218 exactly: the webhook DID carry a valid authenticated
  // session, so identity would have passed on a good fetch — but the swallowed
  // 404 left `employment` null, which makes `identityVerified` false by
  // construction, and the audit row blamed identity.
  const before = evaluateUc02({ ...cleanUc02(), identityVerified: false, employmentActive: false });
  assert.equal(before.reason, "identity_not_verified");

  const after = evaluateUc02({
    ...cleanUc02(),
    identityVerified: false,
    employmentActive: false,
    upstreamFailures: [{ call: "employment", status: 404, kind: "not_found" }],
  });
  assert.equal(after.reason, REASON_UPSTREAM_NOT_FOUND);
  assert.deepEqual(after.flags, [REASON_UPSTREAM_NOT_FOUND, "upstream_employment_404"]);
});

test("UC-02: a 403'd category list is not the classifier's fault", () => {
  const before = evaluateUc02({ ...cleanUc02(), categoryValid: false });
  assert.equal(before.reason, "category_unverified");

  const after = evaluateUc02({
    ...cleanUc02(),
    categoryValid: false,
    upstreamFailures: [{ call: "expense_categories", status: 403, kind: "unreachable" }],
  });
  assert.equal(after.reason, REASON_UPSTREAM_UNAVAILABLE);
  assert.equal(after.decision, "escalate");
});

test("UC-02: a genuine 404 on the claim keeps its own precise reason, plus the status", () => {
  // A 404 IS an authoritative answer about the claim, and `expense_not_found`
  // already names it exactly — so this gate is NOT taken over by the generic
  // upstream reason. The flag records where the answer came from.
  const notFound = evaluateUc02({
    ...cleanUc02(),
    expense: null,
    upstreamFailures: [{ call: "expense", status: 404, kind: "not_found" }],
  });
  assert.equal(notFound.reason, "expense_not_found");
  assert.deepEqual(notFound.flags, ["expense_not_found", "upstream_expense_404"]);

  // A 500 is not an answer about the claim at all, so it does take over.
  const broken = evaluateUc02({
    ...cleanUc02(),
    expense: null,
    upstreamFailures: [{ call: "expense", status: 500, kind: "unreachable" }],
  });
  assert.equal(broken.reason, REASON_UPSTREAM_UNAVAILABLE);
});

test("UC-06: a swallowed employment read no longer masks the real upstream problem", () => {
  const after = evaluateUc06({
    ...cleanUc06(),
    identityVerified: false,
    employment: null,
    countrySchema: null,
    upstreamFailures: [
      { call: "employment", status: 404, kind: "not_found" },
      { call: "country_schema", status: 404, kind: "not_found" },
    ],
  });
  assert.equal(after.reason, REASON_UPSTREAM_NOT_FOUND);
  assert.deepEqual(after.flags, [REASON_UPSTREAM_NOT_FOUND, "upstream_employment_404"]);
});

test("UC-06: an unfetchable country schema keeps its reason and gains the status", () => {
  const result = evaluateUc06({
    ...cleanUc06(),
    countrySchema: null,
    upstreamFailures: [{ call: "country_schema", status: 403, kind: "unreachable" }],
  });
  assert.equal(result.reason, "country_schema_unavailable");
  assert.deepEqual(result.flags, ["country_schema_unavailable", "upstream_country_schema_403"]);
});

test("UC-06: a failed payroll-calendar read is not 'no matching payroll cycle'", () => {
  // Both produce an empty cycle list, and they mean opposite things: one is a
  // fact about the company's calendar, the other is the absence of a calendar.
  const before = evaluateUc06({ ...cleanUc06(), payrollCycles: [] });
  assert.equal(before.reason, "no_matching_payroll_cycle");

  const after = evaluateUc06({
    ...cleanUc06(),
    payrollCycles: [],
    upstreamFailures: [{ call: "payroll_runs", status: 500, kind: "unreachable" }],
  });
  assert.equal(after.reason, REASON_UPSTREAM_UNAVAILABLE);
});

test("UC-09: a 404'd employment reads as the failed read, not as an unverified requester", () => {
  const before = evaluateUc09({ ...cleanUc09(), identityVerified: false, employment: null });
  assert.equal(before.reason, "identity_not_verified");
  assert.deepEqual(before.flags, ["unverified_requester"]);

  const after = evaluateUc09({
    ...cleanUc09(),
    identityVerified: false,
    employment: null,
    upstreamFailures: [{ call: "employment", status: 404, kind: "not_found" }],
  });
  assert.equal(after.reason, REASON_UPSTREAM_NOT_FOUND);
  assert.deepEqual(after.flags, [REASON_UPSTREAM_NOT_FOUND, "upstream_employment_404"]);
});

test("an upstream failure ranks as its own exception reason in the metrics layer", () => {
  // The point of the dashboard's top exception row is that it names the next
  // thing to engineer. Three outages filed under `identity_not_verified` send
  // an engineer to read the identity gate; filed under their own reason they
  // send them to the Remote credential. Same count either way — only the
  // label decides whether the number is useful.
  const cases = [
    { useCase: "UC-02", decision: "escalate", reason: REASON_UPSTREAM_UNAVAILABLE },
    { useCase: "UC-02", decision: "escalate", reason: REASON_UPSTREAM_UNAVAILABLE },
    { useCase: "UC-02", decision: "escalate", reason: REASON_UPSTREAM_UNAVAILABLE },
    { useCase: "UC-02", decision: "escalate", reason: "identity_not_verified" },
    { useCase: "UC-02", decision: "escalate", reason: REASON_UPSTREAM_NOT_FOUND },
    { useCase: "UC-02", decision: "auto_resolve", reason: "all_gates_passed" },
  ];
  const ranked = rankExceptionReasons(cases);
  assert.equal(ranked[0].reason, REASON_UPSTREAM_UNAVAILABLE);
  assert.equal(ranked[0].count, 3);
  // Distinct rows, never merged into the identity bucket.
  const identity = ranked.find((r) => r.reason === "identity_not_verified");
  assert.equal(identity.count, 1);
  assert.ok(ranked.some((r) => r.reason === REASON_UPSTREAM_NOT_FOUND));
});
