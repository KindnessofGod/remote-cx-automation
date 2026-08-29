// ---------------------------------------------------------------------------
// uc06.test.js  —  The 6 UC-06 scenarios from docs/use-cases/UC-06.md §12
// ---------------------------------------------------------------------------
// Same shape as uc01.test.js: run the whole workflow against the mock Remote
// server so the pieces are proven together, not just in isolation. No LLM
// call ever happens here — changeParser.draftSummary() falls back to its
// deterministic template whenever OPENAI_API_KEY isn't set, exactly like
// UC-01's classifier, so `npm test` stays hermetic regardless of environment.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest, submitAmendmentApproval } from "../src/uc06/workflow.js";
import { evaluateCutoff, parseUtcInstant } from "../src/uc06/cutoffEngine.js";
import { amendmentType, draftSummary } from "../src/uc06/changeParser.js";
import { evaluate as evaluatePolicy } from "../src/uc06/policyEngine.js";
import { evaluateAmendmentActionability } from "../src/uc06/dualApprovalPolicy.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4018); // test-only port
  remote = new RemoteClient({ baseUrl: "http://localhost:4018" });
});
after(() => server && server.close());

let audit;
let amendmentStore;

beforeEach(() => {
  audit = new AuditLogger();
  amendmentStore = new AmendmentStore();
});

// THE FILER IS NOT `admin_jane`, AND THAT IS THE POINT (DRIFT-098 `[A-1]`,
// 2026-08-29). This fixture used to submit as `admin_jane` and then approve
// slot 1 as `admin_jane`, which is the self-approval UC-06.md §8 forbids
// ("neither of them the person who filed the request") — the suite encoded the
// defect as expected behaviour, which is exactly what the drift register
// predicted it would. `admin_omar` is the console operator who FILES; the
// approver strings below are unchanged, because slot 1 belongs to the
// employer's signing representative, a different person from the admin USER who
// operates the console (src/remoteui/roles.js). See
// test/uc06RequesterCannotApprove.test.js for the guard itself.
const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" };

// This suite's own scenarios are about the gates, not draft prose — inject the
// deterministic template directly so no test here ever makes a real, retried
// LLM call just because OPENAI_API_KEY happens to be set in its environment
// (real hazard: this exact repo's own devcontainer carries one — see #31/#32).
// Runs the REAL draftSummary() forced into its unconfigured (template)
// branch, rather than hand-duplicating the template's exact wording here —
// guarantees identical output to production's own fallback, never a
// hand-maintained string that could silently drift from it.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
// Same reasoning as fakeDraftSummary above — never a real, unretried LLM call
// for the faithfulness judge either (issue #27).
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function submit(overrides = {}) {
  return handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      ...overrides,
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

// ---------------------------------------------------------------------------
// 1. Comp change before cutoff -> dual approve -> PATCH
// ---------------------------------------------------------------------------

test("1. comp change well before cutoff -> dual_approval_required, then both approve -> executes the PATCH", async () => {
  // Uses its own dedicated employment (emp_nl_amend_003) since this test PATCHes
  // real state — see the mock server's comment on that fixture.
  const r = await submit({ employmentId: "emp_nl_amend_003" });
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.amendmentType, "SALARY_INCREASE");
  assert.deepEqual(r.flags, []);

  const first = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(first.ok, true);
  assert.equal(first.code, "approved_awaiting_second");

  const second = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  assert.equal(second.ok, true);
  assert.equal(second.code, "executed");

  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "executed");

  // The real write landed with the money correctly scaled — see scenario 5 too.
  //
  // ASSERTED ON WHAT REMOTE ANSWERED, not on the employment record. UC-06's
  // write is `POST /v1/contract-amendments`, which files an amendment REQUEST
  // — the employment record does not change until the amendment is approved
  // on Remote's side, so re-reading the employee here would prove nothing
  // either way. Live 2026-08-18, that response's `changes` block carried
  // `{"compensation.amount":{"current":7500000,"previous":7200000}}` for a real
  // amendment on an active Dutch employment; the mock reproduces that capture.
  assert.equal(amendment.remoteResult.contract_amendment.status, "submitted");
  assert.deepEqual(amendment.remoteResult.contract_amendment.changes["compensation.amount"], {
    current: 6000000, // 60,000.00 × 100
    previous: 5000000, // the record's own current salary, not the request's claim
  });
});

// ---------------------------------------------------------------------------
// 2. Effective date after lock -> blocked/escalated
// ---------------------------------------------------------------------------

test("2. requested cycle's cutoff already passed -> escalate, no approval path offered", async () => {
  const r = await submit({ requestedEffectiveDate: "2026-06-15", now: "2026-06-20" }); // June cycle's cutoff was June 10
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "cutoff_lock_passed");
  assert.ok(r.flags.includes("retroactive_change"));

  const attempt = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, "not_awaiting_approval");
});

// ---------------------------------------------------------------------------
// 3. Within-48h request -> urgent alert flag
// ---------------------------------------------------------------------------

test("3. within 48h of the applicable cutoff -> still dual_approval_required, flagged urgent_cutoff", async () => {
  const r = await submit({ requestedEffectiveDate: "2026-07-15", now: "2026-07-09" }); // July cutoff is July 10, 24h away
  assert.equal(r.decision, "dual_approval_required");
  assert.ok(r.flags.includes("urgent_cutoff"));
});

// ---------------------------------------------------------------------------
// 4. Country-specific field validation
// ---------------------------------------------------------------------------

test("4. a country schema requiring a field the record lacks -> escalate, schema_invalid", () => {
  // Pure unit test of the gate itself: an employment record missing
  // weekly_hours, against NG's real required list (["job_title",
  // "weekly_hours"]) — proving the dynamic per-country gate actually blocks
  // a payload it shouldn't allow, not just that the code path exists.
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", currency: "USD", base_salary: 5000000 };
  const r = evaluatePolicy({
    identityVerified: true,
    employment,
    countrySchema: { required: ["job_title", "weekly_hours"] },
    changes: { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
    payrollCycles: [],
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "schema_invalid");
  assert.ok(r.flags.includes("missing_weekly_hours"));
});

// ---------------------------------------------------------------------------
// 5. Money scaling correctness
// ---------------------------------------------------------------------------

test("5. money scaling: a human $60,000 figure reaches Remote as the integer 6000000", async () => {
  const r = await submit({
    changes: { salary: { oldAmount: 50000, newAmount: 72500.5, currency: "USD" } },
    employmentId: "emp_nl_amend_001",
  });
  const amendment = await amendmentStore.findById(r.amendmentId);
  // `annual_gross_salary`, not `base_salary` — the CONTRACT AMENDMENT form's
  // own name for the field, and the only name it accepts (live: an undeclared
  // `base_salary` key answers `422 {"base_salary":["is not accepted"]}`).
  assert.equal(amendment.payload.annual_gross_salary, 7250050); // 72,500.50 × 100, integer
});

// ---------------------------------------------------------------------------
// 6. One approver only -> not executed
// ---------------------------------------------------------------------------

test("6. only one of the two roles approves -> amendment stays pending, no PATCH", async () => {
  const r = await submit();
  const result = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  assert.equal(result.code, "approved_awaiting_second");
  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "pending_dual_approval");
  assert.equal(amendment.executedAt, null);
});

// ---------------------------------------------------------------------------
// Edge cases beyond the 6 documented scenarios
// ---------------------------------------------------------------------------

test("identity: no session -> escalate, identity_not_verified", async () => {
  const r = await submit({ session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("identity: session company does not match employment's company -> escalate", async () => {
  const r = await submit({ session: { companyId: "co_other", authenticatedAdminId: "admin_jane" } });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("employment: terminated employee -> escalate, employee_not_active", async () => {
  const r = await submit({ employmentId: "emp_terminated_002" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("a role cannot approve the same amendment twice", async () => {
  const r = await submit();
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  const second = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "role_already_approved");
});

test("either role declining stops the amendment without executing", async () => {
  const r = await submit();
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  const declined = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "decline", approver: "payroll_sam", note: "budget frozen" },
    { remote, audit, amendmentStore }
  );
  assert.equal(declined.ok, true);
  assert.equal(declined.code, "declined");
  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "declined");
  assert.equal(amendment.declinedBy.approver, "payroll_sam");
  assert.equal(amendment.executedAt, null);
  assert.ok(audit.forUseCase("UC-06").some((e) => e.action === "amendment_declined"));
});

// POSITIVE — the installed ZAF bundle posts `deny`. It must keep stopping the
// amendment, and it must record the canonical word.
test("the LEGACY `deny` verb still declines an amendment, recording `declined`", async () => {
  const r = await submit();
  const declined = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "deny", approver: "payroll_sam", note: "legacy bundle" },
    { remote, audit, amendmentStore }
  );
  assert.equal(declined.ok, true, "an installed ZAF bundle posting /deny must not 400");
  assert.equal(declined.code, "declined");
  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "declined");
  assert.equal(amendment.executedAt, null);
  assert.ok(audit.forUseCase("UC-06").some((e) => e.action === "amendment_declined"));
});

test("an unrecognised verb is still refused, alias map notwithstanding", async () => {
  const r = await submit();
  const refused = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "denyish", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "unknown_action");
});

test("freshness re-check: employment goes inactive between creation and the second approval -> execution blocked", async () => {
  // Own dedicated employment (see mock server comment) since this test
  // deliberately mutates status — must not leak into later tests.
  const r = await submit({ employmentId: "emp_nl_amend_003" });
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );

  // Simulate the employee being terminated in the interim.
  await remote.patchEmploymentBasicInformation("emp_nl_amend_003", { status: "terminated" });

  const second = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "employment_no_longer_active");

  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "pending_dual_approval"); // never marked executed
});

test("the same approver identity cannot fill both dual-approval slots", async () => {
  // Regression test: found live via `npm run uc06-api` — nothing authenticates
  // `approver` (it is a free-text request-body field, unlike UC-01's
  // ZAF-signed header), so before this fix one person typing their own name
  // into both role fields could single-handedly clear "dual" control.
  const r = await submit();
  const first = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(first.ok, true);
  assert.equal(first.code, "approved_awaiting_second");

  const second = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "same_person_cannot_fill_both_roles");
  assert.equal(second.status, 409);

  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.status, "pending_dual_approval", "still only one slot filled, never executed");
  assert.equal(amendment.payrollApproval, null);

  // A DIFFERENT approver in the second slot still works — proves the fix
  // targets identity, not merely "a second approve call at all".
  const third = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  assert.equal(third.ok, true);
  assert.equal(third.code, "executed");
});

test("the refused same-approver attempt is itself audited (an identified actor, not swallowed silently)", async () => {
  const r = await submit();
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  const refusal = audit.forUseCase("UC-06").find((e) => e.action === "amendment_approve_refused");
  assert.ok(refusal, "the refusal is recorded, not just returned to the caller");
  assert.equal(refusal.actor, "admin_jane");
  assert.equal(refusal.details.refusalCode, "same_person_cannot_fill_both_roles");
});

// ---------------------------------------------------------------------------
// Audit honesty for a payroll cycle that may be REAL Sandbox data or a demo
// continuation of it (src/remotebridge/payrollProjection.js, a different use
// case's stand-in — UC-06 only consumes whatever `payrollCycles` it is
// handed). A projected cycle self-identifies with a `_standin` marker; before
// this fix the audit row recorded only `cutoffCycle: <id>`, leaving an
// auditor unable to tell a real cycle from a projected one without knowing
// the undocumented `standin-` id-prefix convention.
// ---------------------------------------------------------------------------

test("audit log: a REAL payroll cycle (no _standin marker) is recorded as not projected", async () => {
  // The default employee (emp_nl_amend_001, NL) is used deliberately, not
  // emp_active_001 — the latter has no country schema configured in this
  // mock, so the workflow escalates on country_schema_unavailable before
  // ever reaching the cutoff engine (cutoffCycle stays null because that
  // code path never runs), and the real HTTP 404 round-trip against the
  // local mock server made the test needlessly slow on top of asserting
  // the wrong thing.
  const r = await submit({});
  const entry = audit.forUseCase("UC-06").find((e) => e.details?.amendmentId === r.amendmentId);
  assert.ok(entry, "the decision was audited");
  assert.equal(entry.details.cutoffCycleProjected, false);
  assert.equal(entry.details.cutoffCycleStandin, null);
  assert.equal(entry.details.cutoffCycle, "run_nl_2026_07", "the real cycle id from the mock's fixed NL calendar");
});

test("audit log: a PROJECTED payroll cycle (carrying _standin) is explicitly flagged, not left to an id-prefix convention", async () => {
  // A minimal fake `remote` — only the three methods handleAmendmentRequest()
  // calls — standing in for what a real deployment behind the payroll
  // stand-in proxy would return: a cycle shaped exactly like
  // payrollProjection.js's output, `_standin` marker included.
  const projectedCycle = {
    id: "standin-us-2026-09",
    status: "preparing",
    type: "main",
    country: { alpha_2_code: "US" },
    currency_code: "USD",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    cutoff_date: "2026-09-10",
    expected_payout_date: "2026-09-30",
    approval_date: null,
    total_payroll_cost: null,
    _standin: { projected: true, derivedFrom: "run_2026_06", cadence: "period_start +9d = cutoff, measured from that country's last real cycle" },
  };
  const fakeRemote = {
    getEmployment: async () => ({ status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, base_salary: 5000000, currency: "USD", country_code: "US" }),
    getCountrySchema: async () => ({ required: [] }),
    listPayrollRuns: async () => ({ payroll_runs: [projectedCycle] }),
  };

  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_active_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-09-15",
      now: "2026-08-20",
    },
    { remote: fakeRemote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(r.decision, "dual_approval_required");

  const entry = audit.forUseCase("UC-06").find((e) => e.details?.amendmentId === r.amendmentId);
  assert.ok(entry);
  assert.equal(entry.details.cutoffCycle, "standin-us-2026-09");
  assert.equal(entry.details.cutoffCycleProjected, true, "an auditor must not have to infer this from the id prefix");
  assert.deepEqual(entry.details.cutoffCycleStandin, projectedCycle._standin);
});

test("audit log carries both approvals and the execution, in order", async () => {
  const r = await submit();
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    { remote, audit, amendmentStore }
  );
  const actions = audit.forUseCase("UC-06").map((e) => e.action);
  assert.deepEqual(actions, ["dual_approval_required", "amendment_approved", "amendment_approved", "amendment_executed"]);
});

// ---------------------------------------------------------------------------
// Pure-function unit coverage (no I/O) — cutoffEngine + changeParser
// ---------------------------------------------------------------------------

test("amendmentType() is deterministic, not an LLM call", () => {
  assert.equal(amendmentType({ salary: { oldAmount: 50000, newAmount: 60000 } }), "SALARY_INCREASE");
  assert.equal(amendmentType({ salary: { oldAmount: 60000, newAmount: 50000 } }), "SALARY_DECREASE");
  assert.equal(amendmentType({ jobTitle: { oldValue: "a", newValue: "b" } }), "JOB_TITLE_CHANGE");
  assert.equal(amendmentType({ weeklyHours: { oldValue: 40, newValue: 32 } }), "WORKING_HOURS_CHANGE");
  assert.equal(amendmentType({ salary: {}, jobTitle: {} }), "COMPOSITE");
  assert.equal(amendmentType({}), "OTHER");
});

test("evaluateCutoff() with no matching payroll cycle is flagged rather than guessed", () => {
  const r = evaluateCutoff({ requestedEffectiveDate: "2027-01-15", now: "2026-06-20", payrollCycles: [] });
  assert.equal(r.noMatchingCycle, true);
  assert.equal(r.cycle, null);
});

// ---------------------------------------------------------------------------
// F-15 — the per-country schema gate must not pass vacuously on a 404.
//
// `validateAgainstSchema(payload, {required: []})` returns valid for ANY
// payload, so returning that stand-in when the schema endpoint 404s made
// invariant #2 ("dynamic per-country schema validation before any write") a
// gate that always opened. The distinction these tests pin is between a
// schema that genuinely requires nothing and no schema at all — the two used
// to be the same empty array.
// ---------------------------------------------------------------------------

test("F-15 restClient: a 404 from the country-schema endpoint returns null, NOT {required: []}", async () => {
  const missing = await remote.getCountrySchema("ZZ"); // no such country on the mock
  assert.equal(missing, null, "an unfetchable schema must be distinguishable from an empty one");

  // A REAL SCHEMA STILL COMES BACK INTACT — and its `required` list is now the
  // LIVE `employment_basic_information` form, captured verbatim 2026-08-18 from
  // gateway.remote-sandbox.com. It used to read `["job_title","weekly_hours"]`,
  // two names that appear in no Remote form anywhere: the mock and
  // buildAmendmentPayload() agreed with each other and neither agreed with the
  // API. Note what this form does NOT contain — there is no salary property and
  // no hours property — which is why UC-06 no longer validates against it.
  const present = await remote.getCountrySchema("NG");
  assert.deepEqual(present.required, [
    "has_seniority_date",
    "name",
    "job_title",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ]);
  assert.equal(present.additionalProperties, false, "the live form is CLOSED — an undeclared key is a rejection");
  assert.ok(!("annual_gross_salary" in present.properties), "this form cannot express a salary at all");
  assert.ok(!("work_hours_per_week" in present.properties), "nor hours");
});

// ---------------------------------------------------------------------------
// THE FORM UC-06 ACTUALLY USES — and the fact that it is a different one.
// ---------------------------------------------------------------------------
test("the contract-amendment form is a DIFFERENT form, and it is the one that can express an amendment", async () => {
  const schema = await remote.getContractAmendmentSchema("emp_nl_amend_001", "NL");
  assert.ok(schema, "an active NL employment has a contract-amendment form");
  // Live NLD `required`, verbatim 2026-08-18.
  assert.deepEqual(schema.required, [
    "annual_gross_salary",
    "effective_date",
    "job_title",
    "role_description",
    "contract_duration_type",
    "work_schedule",
    "work_hours_per_week",
  ]);
  assert.equal(schema.properties.annual_gross_salary.type, "integer", "money is an integer — ×100, enforced by the API");
  assert.equal(schema.properties.work_hours_per_week.type, "number");

  // NGA and USA answer 500 live — there is no form to copy and none is
  // invented, so an amendment for those countries escalates rather than
  // validating against a plausible-looking stand-in.
  assert.equal(await remote.getContractAmendmentSchema("emp_active_001", "NG"), null);
});

test("F-15 gate: a null (unavailable) schema escalates instead of validating", () => {
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, currency: "USD", base_salary: 5000000 };
  const r = evaluatePolicy({
    identityVerified: true,
    employment,
    countrySchema: null,
    changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
    payrollCycles: [
      { id: "run_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" },
    ],
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "country_schema_unavailable");
  assert.ok(r.flags.includes("country_schema_unavailable"));
  assert.ok(r.payload, "the drafted payload is still attached for the human who picks this up");
});

test("F-15 gate: an unusable schema shape (required is not an array) escalates too", () => {
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, currency: "USD", base_salary: 5000000 };
  for (const countrySchema of [undefined, {}, { required: null }, { required: "job_title" }]) {
    const r = evaluatePolicy({
      identityVerified: true,
      employment,
      countrySchema,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      payrollCycles: [{ id: "run_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" }],
    });
    assert.equal(r.decision, "escalate", `${JSON.stringify(countrySchema)} must not validate`);
    assert.equal(r.reason, "country_schema_unavailable");
  }
});

test("F-15 gate: a schema that GENUINELY requires no fields still validates — the two empty cases are not conflated", () => {
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, currency: "USD", base_salary: 5000000 };
  const r = evaluatePolicy({
    identityVerified: true,
    employment,
    countrySchema: { required: [] }, // fetched successfully; this country requires nothing extra
    changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
    payrollCycles: [{ id: "run_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" }],
  });
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.reason, "all_gates_passed");
});

test("F-15 end to end: an employment whose country has no schema escalates rather than passing with zero flags", async () => {
  // The REAL client against the REAL mock — `getCountrySchema("ZZ")` genuinely
  // 404s here, so this exercises the whole 404 -> null -> escalate chain, not
  // a hand-stubbed null. Only the country code is overridden.
  const remoteUnknownCountry = {
    getEmployment: async (id) => ({ ...(await remote.getEmployment(id)), country_code: "ZZ" }),
    getCountrySchema: (code) => remote.getCountrySchema(code),
    getContractAmendmentSchema: (id, code) => remote.getContractAmendmentSchema(id, code),
    listPayrollRuns: (companyId) => remote.listPayrollRuns(companyId),
    createContractAmendment: (args, opts) => remote.createContractAmendment(args, opts),
  };
  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote: remoteUnknownCountry, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "country_schema_unavailable");
  assert.notDeepEqual(r.flags, [], "the old behaviour was 'passed with zero flags' — that is the regression");
});

// ---------------------------------------------------------------------------
// F-26 — payroll-cutoff timing: (a) parse as UTC, (b) fail closed on an
// unreadable cutoff.
// ---------------------------------------------------------------------------

const ZONELESS_CYCLE = [
  { id: "run_2026_09", period_start: "2026-09-01", period_end: "2026-09-30", cutoff_date: "2026-09-05 17:00:00" },
];

test("F-26a: a zone-less cutoff is parsed as UTC, not the server's local zone", () => {
  assert.equal(parseUtcInstant("2026-09-05 17:00:00"), Date.parse("2026-09-05T17:00:00Z"));
  assert.equal(parseUtcInstant("2026-09-05T17:00:00"), Date.parse("2026-09-05T17:00:00Z"));
  assert.equal(parseUtcInstant("2026-09-05"), Date.parse("2026-09-05T00:00:00Z"));
  // A value that DOES carry a zone is authoritative and left alone.
  assert.equal(parseUtcInstant("2026-09-05T17:00:00+02:00"), Date.parse("2026-09-05T15:00:00Z"));
  assert.equal(parseUtcInstant("2026-09-05T17:00:00Z"), Date.parse("2026-09-05T17:00:00Z"));
  assert.ok(Number.isNaN(parseUtcInstant("next Tuesday")));
});

test("F-26a: the SAME amendment reaches the SAME cutoff verdict in UTC, US Pacific and Tokyo", () => {
  // The defect: `new Date("2026-09-05 17:00:00")` is parsed in the host's
  // local zone, so this exact input flipped between blocked and approvable
  // depending on which machine ran it. `now` sits 3h before the cutoff in
  // UTC — inside the 48h urgent window, cutoff NOT passed — but 6h AFTER it
  // if the cutoff is read as Tokyo local, which is the flip.
  const args = { requestedEffectiveDate: "2026-09-20", now: "2026-09-05T14:00:00Z", payrollCycles: ZONELESS_CYCLE };
  const originalTz = process.env.TZ;
  const seen = [];
  try {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney"]) {
      process.env.TZ = tz;
      const r = evaluateCutoff(args);
      seen.push({ tz, passed: r.cutoffAlreadyPassed, urgent: r.urgentWithin48h, hours: r.hoursUntilCutoff });
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }

  for (const s of seen) {
    assert.equal(s.passed, false, `${s.tz}: the cutoff has not passed`);
    assert.equal(s.urgent, true, `${s.tz}: 3h out is inside the 48h urgent window`);
    assert.equal(s.hours, 3, `${s.tz}: hoursUntilCutoff is a payroll fact, not a host fact`);
  }
});

test("F-26a: the policy decision itself is host-timezone independent", () => {
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, currency: "USD", base_salary: 5000000 };
  const evaluateIn = (tz) => {
    const originalTz = process.env.TZ;
    process.env.TZ = tz;
    try {
      return evaluatePolicy({
        identityVerified: true,
        employment,
        countrySchema: { required: ["job_title", "weekly_hours"] },
        changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
        requestedEffectiveDate: "2026-09-20",
        now: "2026-09-05T14:00:00Z",
        payrollCycles: ZONELESS_CYCLE,
      });
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  };
  const utc = evaluateIn("UTC");
  const tokyo = evaluateIn("Asia/Tokyo");
  const pacific = evaluateIn("America/Los_Angeles");

  assert.equal(utc.decision, "dual_approval_required");
  assert.deepEqual(utc.flags, ["urgent_cutoff"]);
  assert.deepEqual(tokyo, utc, "Tokyo must reach a byte-identical verdict");
  assert.deepEqual(pacific, utc, "US Pacific must reach a byte-identical verdict");
});

test("F-26b: an unreadable cutoff_date fails CLOSED — cutoffUnknown, never a silent 'not passed'", () => {
  for (const bad of ["not a date", "", null, undefined, "2026-13-45 99:99:99", {}]) {
    const r = evaluateCutoff({
      requestedEffectiveDate: "2026-09-20",
      now: "2026-09-05T14:00:00Z",
      payrollCycles: [{ id: "run_2026_09", period_start: "2026-09-01", period_end: "2026-09-30", cutoff_date: bad }],
    });
    assert.equal(r.cutoffUnknown, true, `cutoff_date ${JSON.stringify(bad)} is unknown, not clear`);
    assert.equal(r.cutoffAlreadyPassed, false);
    assert.equal(r.urgentWithin48h, false);
    assert.equal(r.hoursUntilCutoff, null, "NaN must not leak out as a number");
    assert.ok(r.cycle, "the cycle itself was still matched — only its lock time is unknown");
  }
});

test("F-26b: an unknown cutoff escalates instead of offering the dual-approval path", () => {
  const employment = { status: "active", company_id: "co_amend_01", job_title: "Senior Engineer", weekly_hours: 40, currency: "USD", base_salary: 5000000 };
  const r = evaluatePolicy({
    identityVerified: true,
    employment,
    countrySchema: { required: ["job_title", "weekly_hours"] },
    changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
    requestedEffectiveDate: "2026-09-20",
    now: "2026-09-05T14:00:00Z",
    payrollCycles: [{ id: "run_2026_09", period_start: "2026-09-01", period_end: "2026-09-30", cutoff_date: "whenever" }],
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "cutoff_date_unknown");
  assert.ok(r.flags.includes("cutoff_date_unknown"));
});

test("F-26b: an unreadable `now` fails closed the same way — the clock is an input too", () => {
  const r = evaluateCutoff({
    requestedEffectiveDate: "2026-09-20",
    now: "sometime",
    payrollCycles: ZONELESS_CYCLE,
  });
  assert.equal(r.cutoffUnknown, true);
  assert.equal(r.cutoffAlreadyPassed, false);
  assert.equal(r.urgentWithin48h, false);
});

// ---------------------------------------------------------------------------
// draftSummary()'s retry wiring (issue #32, §4 invariant 10) — same
// discipline as classifier.js's classifyRequest(), verified here for UC-06's
// own LLM seam. Fake askJson/isConfigured/backoff, never a real network call.
// ---------------------------------------------------------------------------

test("draftSummary retries a failing LLM call before falling back to the template", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await draftSummary(
    { changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } }, requestedEffectiveDate: "2027-01-01" },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        throw new Error("connection refused");
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "template");
  assert.equal(attempts, 3, "3 attempts (§4 invariant 10) before the template fallback");
  const traces = audit.entries.filter((e) => e.call === "changeParser.draftSummary");
  assert.equal(traces.length, 3, "one trace entry per attempt, a retry is visible in the record");
  assert.ok(traces.every((t) => t.ok === false));
});

test("draftSummary succeeds on a retry and tags source 'llm', with a 2-attempt trace", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await draftSummary(
    { changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } }, requestedEffectiveDate: "2027-01-01" },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient");
        return { summary: "Salary increases to $60,000, effective 2027-01-01." };
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "llm");
  assert.match(r.summary, /60,000/);
  const traces = audit.entries.filter((e) => e.call === "changeParser.draftSummary");
  assert.equal(traces.length, 2, "a 2-attempt success produces 2 trace entries, not a hidden single one");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[1].ok, true);
});

// ---------------------------------------------------------------------------
// Narrative-faithfulness judge (issue #27) — purely informational verdict
// attached to the amendment record for the specialist to see. Injections
// follow classifier.js's DI shape: a fake `askJson` + `isConfigured: () =>
// true` drive the real judgeNarrative() code path through one verdict, so
// the LLM seam is exercised, not stubbed at the workflow boundary.
// ---------------------------------------------------------------------------

import { judgeNarrative } from "../src/shared/narrativeJudge.js";

function judgedAmendment(fakeAsk) {
  const judge = (args) => judgeNarrative(args, { askJson: fakeAsk, isConfigured: () => true });
  return handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge }
  );
}

test("narrative judge: a 'faithful' LLM verdict is attached to the amendment and changes no decision", async () => {
  const fakeAsk = async () => ({ verdict: "faithful", reason: "no drift" });
  const r = await judgedAmendment(fakeAsk);
  assert.equal(r.decision, "dual_approval_required", "faithfulness verdict never changes the decision");
  assert.equal(r.amendmentType, "SALARY_INCREASE");
  assert.equal(r.faithfulness.verdict, "faithful");
  assert.equal(r.faithfulness.reason, "no drift");

  const amendment = await amendmentStore.findById(r.amendmentId);
  assert.equal(amendment.faithfulness.verdict, "faithful", "verdict is attached to the stored amendment row");
});

test("narrative judge: a 'not_faithful' verdict is surfaced to the specialist but blocks nothing", async () => {
  const fakeAsk = async () => ({ verdict: "not_faithful", reason: "summary states a salary figure not present in the structured inputs" });
  const r = await judgedAmendment(fakeAsk);
  // The decision tree is untouched by the verdict — proving this is the whole
  // point of the judge being informational-only, never a second gate.
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.faithfulness.verdict, "not_faithful");
  assert.match(r.faithfulness.reason, /not present/);

  // Pending approval path stays the same; a specialist can still approve.
  const attempt = await submitAmendmentApproval(
    { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    { remote, audit, amendmentStore }
  );
  assert.equal(attempt.ok, true);
  assert.equal(attempt.code, "approved_awaiting_second", "the verdict does not gate, block, or alter the approval flow");
});

test("narrative judge: unconfigured (the hermetic default) attaches an explicit 'not_evaluated' state, never blocks and never fabricates", async () => {
  // Explicitly forced unconfigured — never relies on ambient .env state (this
  // devcontainer happens to carry a real, broken OPENAI_API_KEY; see #31/#32).
  const judge = (args) => judgeNarrative(args, { isConfigured: () => false });
  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge }
  );
  assert.equal(r.faithfulness.verdict, "not_evaluated");
  assert.equal(r.faithfulness.reason, null);
});

// ---------------------------------------------------------------------------
// F-09 (CRITICAL) — concurrent approvals must not double-PATCH payroll
// ---------------------------------------------------------------------------
// UC-06's version of the same race: both approvals landing together each saw
// "both slots filled" and each ran on to the Remote write, so
// one amendment produced two real payroll writes. Fired here with Promise.all,
// which is the only way to reproduce it — sequential calls never could.
// ---------------------------------------------------------------------------

test("F-09. two approvals fired with Promise.all apply the amendment exactly ONCE", async () => {
  // Default fixture: this test intercepts the write, so it never files a real
  // amendment and needs no dedicated employment of its own.
  const r = await submit();
  assert.equal(r.decision, "dual_approval_required");

  const patches = [];
  const countingRemote = {
    getEmployment: (id) => remote.getEmployment(id),
    getCountrySchema: (c) => remote.getCountrySchema(c),
    getContractAmendmentSchema: (id, c) => remote.getContractAmendmentSchema(id, c),
    listPayrollRuns: (c) => remote.listPayrollRuns(c),
    getContractAmendmentSchema: (id, c) => remote.getContractAmendmentSchema(id, c),
    createContractAmendment: async (args, opts) => {
      patches.push({ id: args.employmentId, payload: args.contractAmendment, idempotencyKey: opts?.idempotencyKey ?? null });
      await new Promise((resolve) => setImmediate(resolve)); // a real write yields
      return { contract_amendment: { id: "amd_test", status: "submitted", changes: {} } };
    },
  };
  const deps = { remote: countingRemote, audit, amendmentStore };

  const results = await Promise.all([
    submitAmendmentApproval(
      { amendmentId: r.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane", note: "ok" },
      deps
    ),
    submitAmendmentApproval(
      { amendmentId: r.amendmentId, role: "payroll_specialist", action: "approve", approver: "spec_sam", note: "ok" },
      deps
    ),
  ]);

  assert.equal(patches.length, 1, `expected exactly one payroll write, got ${patches.length}`);
  assert.equal(results.filter((x) => x.code === "executed").length, 1);
  for (const x of results) {
    assert.ok(["executed", "approved_awaiting_second", "execution_already_claimed"].includes(x.code), x.code);
  }

  // Both signatures are still on the record — execution was serialised, not
  // one approval discarded.
  const row = await amendmentStore.findById(r.amendmentId);
  assert.equal(row.status, "executed");
  assert.ok(row.adminApproval && row.payrollApproval);

  // F-18: the one write it did make carried a stable idempotency key.
  assert.equal(patches[0].idempotencyKey, r.amendmentId);
});

test("F-09. amendmentStore.claimForExecution is a compare-and-set only one caller wins", async () => {
  const r = await submit();
  const claims = await Promise.all([
    amendmentStore.claimForExecution(r.amendmentId),
    amendmentStore.claimForExecution(r.amendmentId),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await amendmentStore.findById(r.amendmentId)).status, "executing");

  // While claimed, the amendment is not actionable — and says why, rather
  // than reporting itself as already executed.
  const verdict = evaluateAmendmentActionability({ amendmentRow: await amendmentStore.findById(r.amendmentId) });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "execution_in_progress");

  await amendmentStore.releaseExecutionClaim(r.amendmentId);
  assert.equal((await amendmentStore.findById(r.amendmentId)).status, "pending_dual_approval");
});

test("amendmentType() refuses to call a no-op an increase (F-31)", () => {
  // `null >= null` is `0 >= 0` — true — so an amendment stating NO figures used
  // to be typed SALARY_INCREASE. That is a comparison operator answering a
  // question it was never asked. An amendment with no stated amounts is one
  // whose type cannot be determined, and it must say so.
  assert.equal(amendmentType({ salary: { oldAmount: null, newAmount: null } }), "SALARY_CHANGE_UNDETERMINED");
  assert.equal(amendmentType({ salary: {} }), "SALARY_CHANGE_UNDETERMINED");
  assert.equal(amendmentType({ salary: { oldAmount: 50000, newAmount: undefined } }), "SALARY_CHANGE_UNDETERMINED");
  assert.equal(amendmentType({ salary: { oldAmount: 50000, newAmount: NaN } }), "SALARY_CHANGE_UNDETERMINED");
  // A quoted amount compares as a STRING ("9" >= "10" is true), so it is refused
  // here for the same reason buildAmendmentPayload() refuses it.
  assert.equal(amendmentType({ salary: { oldAmount: "50000", newAmount: "60000" } }), "SALARY_CHANGE_UNDETERMINED");
  // And the real cases are untouched.
  assert.equal(amendmentType({ salary: { oldAmount: 50000, newAmount: 60000 } }), "SALARY_INCREASE");
  assert.equal(amendmentType({ salary: { oldAmount: 60000, newAmount: 50000 } }), "SALARY_DECREASE");
  assert.equal(amendmentType({ salary: { oldAmount: 50000, newAmount: 50000 } }), "SALARY_INCREASE");
});
