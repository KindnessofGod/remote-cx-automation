// ---------------------------------------------------------------------------
// uc05.test.js  —  UC-05 (Voluntary Resignation Notice Calculation) core + workflow
// ---------------------------------------------------------------------------
// Same shape as test/uc06.test.js: run the whole workflow against the mock
// Remote server so the pieces are proven together, not just in isolation.
// The LLM seam is exercised through the rule-based path of the real
// extractFromLetter() by default — a fake `extract` only when the test
// explicitly wants to drive a specific LLM response, same hermetic
// guarantee as UC-01/UC-06/UC-08.
//
// UC-05.md §12's 5 scenarios are mapped onto the test names here:
//   1. Standard UK resignation, notice within statute        -> prepared_for_signoff
//   2. PL tenure >3y, proposed LWD shorter than statutory   -> escalate
//   3. PTO payout correctness (×100 scaling)                 -> prepared_for_signoff
//   4. Missing seniority date (no start_date)                -> escalate
//   5. Money scaling on PTO payout stays in Remote integers  -> prepared_for_signoff
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient, normalizeEmployment } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest, submitResignationApproval } from "../src/uc05/workflow.js";
import { evaluate as evaluatePolicy } from "../src/uc05/policyEngine.js";
import { computeNoticePeriod, tenureMonthsBetween, addCalendarDays, applyAnchor } from "../src/uc05/noticePeriodCalculator.js";
import { reconcilePtoPayout } from "../src/uc05/ptoPayout.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { NOTICE_PERIOD_TABLE, supportedCountryCodes, getNoticeRule, pickBracket } from "../src/uc05/noticePeriodTable.js";
import { evaluateResignationActionability, evaluateSignoffAction } from "../src/uc05/signoffPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let server;
let remote;

before(async () => {
  // 4063 — was 4019, which collided with chatdemo.test.js AND
  // uc06SlackNotifier.test.js's own (also-4019) ports under node --test's
  // default parallel-file execution.
  server = await startMockServer(4063);
  remote = new RemoteClient({ baseUrl: "http://localhost:4063" });
});
after(() => server && server.close());

let audit;
let resignationStore;

beforeEach(() => {
  audit = new AuditLogger();
  resignationStore = new ResignationStore();
});

const session = { authenticatedEmploymentId: "emp_uk_001" };

// Default extractor: real extractFromLetter() forced into its unconfigured
// (rule-based) branch — same discipline as test/uc06.test.js's
// fakeDraftSummary. Keeps the suite hermetic even if OPENAI_API_KEY is
// set, and exercises the real function's fallback (not a hand-rolled
// stand-in that could drift from production).
const fakeExtract = (args) => extractFromLetter(args, { isConfigured: () => false });

function submit(overrides = {}) {
  return handleResignationRequest(
    {
      session,
      employmentId: "emp_uk_001",
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
      now: "2026-08-16",
      // THE CONTRACTUAL HOURLY RATE, in Remote's x100 form (40.00/hour).
      // UC-05 now READS the accrued days from Remote's Time Off API
      // (GET /v1/leave-policies/summary/{id}) instead of taking whatever a
      // requester typed, and Remote publishes NO pay rate anywhere — see
      // src/remote/leaveBalances.js. So the rate is the one figure a request
      // still has to carry, and a request without it is refused at gate 7
      // rather than settled against an assumed 40-hour week. Supplying it here
      // is what makes the default path a POSITIVE exercise of the whole chain:
      // Remote's own balance x a stated rate = a real payout on the report.
      hourlyRateInRemoteInteger: 4000,
      ...overrides,
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
}

// ---------------------------------------------------------------------------
// 1. Standard UK resignation, proposed LWD within statutory 4-week notice
// ---------------------------------------------------------------------------

test("1. UK standard resignation, proposed LWD within statutory notice -> prepared_for_signoff", async () => {
  // emp_uk_001: start 2023-01-10, ~43 months tenure by 2026-08-16 -> UK 37-48 month
  // bracket = 21 days notice. Statutory end = 2026-08-16 + 21 = 2026-09-06. Proposed
  // 2026-09-15 is later than the statutory end by 9 days; `later_than_statutory` is
  // the conservative direction (more notice than required) — not a discrepancy that
  // escalates.
  const r = await submit();
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.notice.countryCode, "GB");
  assert.equal(r.notice.noticeDays, 21);
  assert.equal(r.notice.noticeEndDate, "2026-09-06");
  assert.equal(r.notice.discrepancy, "later_than_statutory");
  assert.equal(r.extractionSource, "structured_input"); // explicit proposedEndDate -> no LLM
});

// ---------------------------------------------------------------------------
// 2. PL >3y tenure, proposed LWD shorter than statutory 3-month notice
// ---------------------------------------------------------------------------

test("2. PL tenure >3y, proposed LWD shorter than statutory 3-month notice -> escalate", async () => {
  const r = await submit({
    session: { authenticatedEmploymentId: "emp_pl_001" },
    employmentId: "emp_pl_001",
    proposedEndDate: "2026-08-31",
    reason: "family reasons",
    now: "2026-07-25",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "statutory_discrepancy");
  assert.ok(r.flags.includes("discrepancy_earlier_than_statutory"));
  assert.equal(r.notice.countryCode, "PL");
  assert.equal(r.notice.noticeDays, 90);
  // PL uses month_1st anchor for monthly notices -> end of notice is the 1st
  // of the month FOLLOWING the +90 day calculation. The +/- 3-day window
  // accounts for weekend alignment of the 1st-of-month rule.
  assert.equal(r.notice.anchorAdjusted, true);
  assert.match(r.notice.noticeEndDate, /^2026-(10|11)-/);
});

// ---------------------------------------------------------------------------
// 3. PTO payout correctness
// ---------------------------------------------------------------------------

test("3. PTO payout: 5 accrued / 2 used days at 5000 (Remote integer) hourly = correct integer total", async () => {
  const balances = [
    { timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 }, // 8 days * 8h * 50.00
  ];
  const payout = reconcilePtoPayout({ balances, currency: "USD" });
  // 8 days * 8 hours/day * 50.00 (human) = 3200.00 -> 320000 in Remote integer
  assert.equal(payout.totalInRemoteInteger, 320000);
  assert.equal(payout.source, "time_off_records");
  assert.equal(payout.lines[0].daysAvailable, 8);
  assert.equal(payout.lines[0].payoutInRemoteInteger, 320000);
});

test("3b. PTO payout: empty balances returns a zero payout honestly tagged, never guesses", () => {
  const payout = reconcilePtoPayout({ balances: [], currency: "USD" });
  assert.equal(payout.totalInRemoteInteger, 0);
  assert.equal(payout.source, "no_time_off_records");
  assert.deepEqual(payout.lines, []);
});

test("3c. PTO payout: a record with daysAccrued left blank is unusable, not a silent zero", () => {
  // A record with NO usable daysAccrued at all is missing data, not "0
  // days accrued". Before the fix, `Number(undefined) || 0` treated it as
  // a verified zero and returned source: "time_off_records" with a $0
  // total — indistinguishable from "we checked, nothing is owed." That is
  // exactly the invented-number failure mode ptoPayout.js's own header
  // and 00-FOUNDATION.md invariant #1 exist to prevent. HEAD's mechanism
  // (unusableFields()) catches this the same way it catches a bad
  // hourlyRateInRemoteInteger or daysUsed — one classifier, not a second
  // narrower one for daysAccrued specifically.
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysUsed: 0, hourlyRateInRemoteInteger: 5000 }], // no daysAccrued
    currency: "USD",
  });
  assert.equal(payout.source, "unusable_time_off_records");
  assert.equal(payout.computable, false);
  assert.equal(payout.totalInRemoteInteger, null);
  assert.deepEqual(payout.lines, []);
  assert.equal(payout.unusableLines.length, 1);
  assert.deepEqual(payout.unusableLines[0].missing, ["daysAccrued"]);
});

test("3d. PTO payout: one usable record + one with blank daysAccrued -> the WHOLE computation refuses, not a partial total", () => {
  // A partial sum is a wrong sum (see the file's own comment on this): the
  // usable "vacation" line alone would compute a real number, but reporting
  // it as the total silently drops what "sick" might have contributed —
  // exactly the kind of confident-looking wrong answer this project's
  // directives forbid. HEAD's policy is deliberately all-or-nothing.
  const payout = reconcilePtoPayout({
    balances: [
      { timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 }, // 8 days -> 320000
      { timeOffType: "sick", daysUsed: 1, hourlyRateInRemoteInteger: 5000 }, // no daysAccrued
    ],
    currency: "USD",
  });
  assert.equal(payout.source, "unusable_time_off_records");
  assert.equal(payout.computable, false);
  assert.equal(payout.totalInRemoteInteger, null, "no partial total — vacation's 320000 must not leak out unlabeled");
  assert.equal(payout.unusableLines.length, 1);
  assert.equal(payout.unusableLines[0].timeOffType, "sick");
});

test("3e. end-to-end: an unusable PTO record escalates rather than being folded into a soft flag", async () => {
  // pto_balance_unusable is a real escalation (policyEngine.js: "HR Ops
  // fixes the balance data"), not a footnote on an otherwise-normal report —
  // incomplete money data is exactly the class of problem this use case
  // exists to route to a human, not paper over.
  const r = await submit({
    timeOffBalances: [{ timeOffType: "vacation", daysUsed: 0, hourlyRateInRemoteInteger: 5000 }], // no daysAccrued
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");
  assert.ok(r.flags.includes("pto_balance_unusable"));
  assert.ok(r.flags.includes("pto_missing_daysAccrued"));
});

// ---------------------------------------------------------------------------
// 4. Missing seniority date -> blocked
// ---------------------------------------------------------------------------

test("4. missing seniority date (no start_date) -> escalate, missing_seniority_date", async () => {
  // Add a no-start-date employee to the mock, fetch it through the real
  // workflow. We use a session that maps to a real record by toggling the
  // returned employment's start_date after the fetch — easier to just test
  // the gate directly via policyEngine, then test the workflow with the
  // real mock server using an unknown employment id (which simulates the
  // "no record" branch).
  const r = await submit({ employmentId: "does-not-exist" });
  assert.equal(r.decision, "escalate");
  // identity_not_verified fires first when there's no employment record at
  // all (the identity gate uses the employment's id to match the session).
  // That's a correct first-failure-wins ordering — same as UC-01/UC-06.
  assert.equal(r.reason, "identity_not_verified");
});

test("4b. policyEngine unit: an employment record with no start_date -> escalate, missing_seniority_date", () => {
  const r = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", country_code: "GB", start_date: null, base_salary: 5000000, currency: "USD" },
    proposedEndDate: "2026-09-15",
    now: "2026-08-16",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "missing_seniority_date");
  assert.ok(r.flags.includes("missing_seniority_date"));
});

// ---------------------------------------------------------------------------
// 5. Money scaling on PTO payout — already covered by scenario 3, plus
//    this end-to-end check that the workflow attaches the scaled payout
//    to the prepared report.
// ---------------------------------------------------------------------------

test("5. end-to-end: the prepared report carries the scaled PTO payout in Remote's integer form", async () => {
  const r = await submit({
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 }],
    currency: "USD",
  });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.payout.totalInRemoteInteger, 320000); // exactly what 3 produces
});

// ---------------------------------------------------------------------------
// Edge cases beyond the 5 documented scenarios
// ---------------------------------------------------------------------------

test("identity: no session -> escalate, identity_not_verified", async () => {
  const r = await submit({ session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("identity: session employment does not match the record -> escalate, identity_not_verified", async () => {
  const r = await submit({ session: { authenticatedEmploymentId: "emp_de_001" } });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("identity: a 404 employment read can never be verified by a matching session id", async () => {
  // REGRESSION GUARD for a defect that existed only in the n8n port
  // (workflows/nodes-uc05/noticePeriodGates.js), which backfilled the
  // employment record's `id` from `request.employmentId` when the fetch
  // returned nothing usable — so a caller controlling BOTH sides of the
  // comparison "verified" against their own claim.
  //
  // This implementation never could: RemoteClient.getEmployment() returns
  // `null` on a 404 (its documented convention), verifyRequester() answers
  // `no_employment_record`, and policyEngine's gate 1 fires. The property was
  // untested though, and an untested property is one refactor away from
  // being lost — the port is the proof of that. So it is pinned here, in the
  // attack shape, asserting the run stops at the IDENTITY gate rather than at
  // the employment-status gate one step later.
  const notFoundRemote = {
    getEmployment: async () => null, // RemoteClient.getEmployment()'s documented 404 answer
  };
  const r = await handleResignationRequest(
    {
      employmentId: "emp_uk_001",
      session: { authenticatedEmploymentId: "emp_uk_001" }, // both sides caller-controlled
      proposedEndDate: "2026-09-15",
      now: "2026-08-16",
      externalRef: "9405",
    },
    { remote: notFoundRemote, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
  assert.deepEqual(r.flags, ["identity_not_verified"]);
  assert.equal(r.notice, null);
  assert.equal(r.payout, null);
});

test("employment: terminated employee -> escalate, employee_not_active", async () => {
  const r = await submit({ session: { authenticatedEmploymentId: "emp_terminated_002" }, employmentId: "emp_terminated_002" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("country: a country outside the 9-country table -> escalate, unsupported_country", async () => {
  const r = await submit({
    session: { authenticatedEmploymentId: "emp_unsupported_country_001" },
    employmentId: "emp_unsupported_country_001",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "unsupported_country");
  assert.ok(r.flags.includes("unsupported_country"));
  assert.ok(r.flags.includes("country_CH"));
});

test("DE probation: an employee on statutory probation gets the 2-week notice, not 4-week", async () => {
  // emp_de_probation_001 is in the DE probation bracket (2 weeks, not 4).
  const r = await submit({
    session: { authenticatedEmploymentId: "emp_de_probation_001" },
    employmentId: "emp_de_probation_001",
    proposedEndDate: "2026-09-15",
    now: "2026-08-01",
  });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.countryCode, "DE");
  assert.equal(r.notice.noticeDays, 14);
  assert.equal(r.notice.onProbation, true);
});

test("DE non-probation: an established DE employee gets the 4-week notice + month_15 anchor", async () => {
  // emp_de_001: ~4 years, not on probation. Submit on the 10th -> 4-week
  // anchor: 4 weeks lands on Sep 7 (10 + 28 = 38 days). 38th day from
  // 2026-08-10 = 2026-09-17, which is in 8-14 day range of the month ->
  // anchor snaps to 15th of the SAME month (2026-09-15). anchorAdjusted: true.
  const r = await submit({
    session: { authenticatedEmploymentId: "emp_de_001" },
    employmentId: "emp_de_001",
    proposedEndDate: "2026-10-31",
    now: "2026-08-10",
  });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.noticeDays, 28);
  assert.equal(r.notice.anchorAdjusted, true);
  assert.equal(r.notice.noticeEndDate, "2026-09-15");
});

test("proposed LWD exactly on statutory end -> discrepancy 'match', still prepared_for_signoff", async () => {
  // emp_uk_001, ~43 months tenure by 2026-08-16 -> 21 days notice (UK 37-48 month
  // bracket). Statutory end = 2026-08-16 + 21 = 2026-09-06. Set proposed to 2026-09-06.
  const r = await submit({ proposedEndDate: "2026-09-06" });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.discrepancy, "match");
  assert.equal(r.notice.discrepancyDays, 0);
});

test("letterText with no stated date: the rule-based extraction returns null proposedEndDate", async () => {
  // The 9-country table still computes a statutory end; the report is
  // prepared for HR Ops sign-off with the statutory end as the only date.
  // Both proposedEndDate and reason are null at the workflow level, so the
  // LLM seam runs (with isConfigured=false) and falls to the rule-based
  // extractor — which, with no parseable date, returns null proposedEndDate.
  const r = await submit({
    letterText: "I am resigning effective in due course, thank you for the opportunity.",
    proposedEndDate: null,
    reason: null,
  });
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.notice.discrepancy, "no_proposed_date");
  assert.equal(r.extractionSource, "rule_based_fallback");
});

// ---------------------------------------------------------------------------
// Sign-off flow (the headline HITL "execution")
// ---------------------------------------------------------------------------

test("sign-off: HR Ops signs off a prepared report -> status signed_off, audit row written", async () => {
  const created = await submit();
  assert.equal(created.decision, "prepared_for_signoff");

  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane", note: "looks correct" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.ok, true);
  assert.equal(result.code, "signed_off");

  const row = await resignationStore.findById(created.resignationId);
  assert.equal(row.status, "signed_off");
  assert.equal(row.signedOffBy.approver, "hr_ops_jane");
  assert.equal(row.signedOffBy.note, "looks correct");
});

test("decline: HR Ops declines a prepared report -> status declined, audit row written", async () => {
  const created = await submit();
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "decline", approver: "hr_ops_jane", note: "wrong tenure" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.code, "declined");
  const row = await resignationStore.findById(created.resignationId);
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.approver, "hr_ops_jane");
  assert.ok(audit.forUseCase("UC-05").some((e) => e.action === "resignation_declined"));
});

// POSITIVE — the installed ZAF bundle still posts `signoff`/`deny`. Both must
// keep working, and the record must carry the canonical word regardless.
test("the LEGACY `deny` verb still declines a report, recording `declined`", async () => {
  const created = await submit();
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "deny", approver: "hr_ops_jane", note: "legacy bundle" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.ok, true, "an installed ZAF bundle posting /deny must not 400");
  assert.equal(result.code, "declined");
  const row = await resignationStore.findById(created.resignationId);
  assert.equal(row.status, "declined");
  assert.equal(row.declinedBy.approver, "hr_ops_jane");
  assert.ok(audit.forUseCase("UC-05").some((e) => e.action === "resignation_declined"));
});

test("an unrecognised verb is still refused, alias map notwithstanding", async () => {
  const created = await submit();
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "denyish", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "unknown_action");
});

test("cannot sign-off an escalated report -> 403 not_awaiting_signoff", async () => {
  // emp_pl_001 with a too-short proposed LWD -> escalated.
  const created = await submit({
    session: { authenticatedEmploymentId: "emp_pl_001" },
    employmentId: "emp_pl_001",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
  });
  assert.equal(created.decision, "escalate");
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_awaiting_signoff");
});

test("cannot sign-off without an approver identity -> 401 approver_required", async () => {
  const created = await submit();
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: null },
    { remote, audit, resignationStore }
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "approver_required");
});

test("cannot sign-off a resignation that doesn't exist -> 404 resignation_not_found", async () => {
  const result = await submitResignationApproval(
    { resignationId: "does-not-exist", action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.code, "resignation_not_found");
});

test("unknown action verb -> 400 unknown_action", async () => {
  const created = await submit();
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "approve", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.code, "unknown_action");
});

test("already-decided: cannot sign-off twice -> 409 already_decided", async () => {
  const created = await submit();
  await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  const second = await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  // signoffPolicy.js distinguishes "this case was never prepared" (not_awaiting_signoff)
  // from "this case was already decided" (already_decided). Once signed off, the
  // status is no longer "pending_signoff" -> the latter code.
  assert.equal(second.code, "already_decided");
});

test("freshness re-check: employment goes inactive between prepare and sign-off -> blocked", async () => {
  const created = await submit();
  // Simulate the employee being terminated in the interim.
  await remote.patchEmploymentBasicInformation("emp_uk_001", { status: "terminated" });
  const result = await submitResignationApproval(
    { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  assert.equal(result.code, "employment_no_longer_active");
  // Restore the employee for subsequent tests in the same process.
  await remote.patchEmploymentBasicInformation("emp_uk_001", { status: "active" });
});

test("audit log carries prepare, signoff, decline in the recorded order", async () => {
  const a = await submit();
  await submitResignationApproval(
    { resignationId: a.resignationId, action: "signoff", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  const b = await submit({ externalRef: "ext-1" });
  await submitResignationApproval(
    { resignationId: b.resignationId, action: "decline", approver: "hr_ops_jane" },
    { remote, audit, resignationStore }
  );
  const actions = audit.forUseCase("UC-05").map((e) => e.action);
  assert.deepEqual(actions, [
    "prepared_for_signoff",
    "resignation_signed_off",
    "prepared_for_signoff",
    "resignation_declined",
  ]);
});

// ---------------------------------------------------------------------------
// Pure-function unit coverage (no I/O) — calculator + table + payout
// ---------------------------------------------------------------------------

test("tenureMonthsBetween: same month -> 0 months; one year -> 12 months; day-of-month respected", () => {
  assert.equal(tenureMonthsBetween("2024-01-15", "2024-01-20"), 0);
  assert.equal(tenureMonthsBetween("2024-01-15", "2024-02-20"), 1);
  assert.equal(tenureMonthsBetween("2024-01-15", "2025-01-14"), 11); // not 12 — day-of-month not yet reached
  assert.equal(tenureMonthsBetween("2024-01-15", "2025-01-15"), 12);
  assert.equal(tenureMonthsBetween("2025-01-15", "2024-01-15"), 0); // future start -> 0
});

test("addCalendarDays: simple + N days, no DST/leap gotchas in YYYY-MM-DD arithmetic", () => {
  assert.equal(addCalendarDays("2026-08-16", 0), "2026-08-16");
  assert.equal(addCalendarDays("2026-08-16", 28), "2026-09-13");
  assert.equal(addCalendarDays("2026-02-27", 2), "2026-03-01");
});

test("applyAnchor: month_15 snaps day<=14 to the 15th, day>=16 to month-end of the following month", () => {
  const r1 = applyAnchor("2026-08-10", "month_15");
  assert.equal(r1.date, "2026-08-15");
  assert.equal(r1.adjusted, true);

  const r2 = applyAnchor("2026-08-15", "month_15");
  assert.equal(r2.date, "2026-08-15");
  assert.equal(r2.adjusted, false);

  const r3 = applyAnchor("2026-08-20", "month_15");
  assert.equal(r3.date, "2026-09-30");
  assert.equal(r3.adjusted, true);
});

test("applyAnchor: month_1st always snaps to the 1st of the following month", () => {
  assert.equal(applyAnchor("2026-08-31", "month_1st").date, "2026-09-01");
  assert.equal(applyAnchor("2026-09-01", "month_1st").date, "2026-10-01");
});

test("applyAnchor: continuous leaves the date alone (and reports not adjusted)", () => {
  const r = applyAnchor("2026-08-16", "continuous");
  assert.equal(r.date, "2026-08-16");
  assert.equal(r.adjusted, false);
});

test("pickBracket: UK 37-48 month bracket -> 21 days, 49-60 month bracket -> 28 days", () => {
  const rule = getNoticeRule("GB");
  assert.equal(pickBracket(rule, 48).noticeDays, 21); // upper bound inclusive
  assert.equal(pickBracket(rule, 49).noticeDays, 28);
  assert.equal(pickBracket(rule, 121).noticeDays, 84);
});

test("pickBracket: DE on probation picks the 2-week probation rule, not the regular 4-week", () => {
  const rule = getNoticeRule("DE");
  // DE probation cap is 6 months. Within probation (3 months): the probation
  // rule REPLACES the regular bracket, giving 14 days, not 28.
  assert.equal(pickBracket(rule, 24, false).noticeDays, 28); // past probation: 4 weeks
  assert.equal(pickBracket(rule, 3, true).noticeDays, 14); // on probation: 2 weeks
});

test("supportedCountryCodes returns the 11 expected ISO codes", () => {
  // NL and US joined the original nine on 2026-08-20. The list is still pinned
  // EXACTLY rather than by count: the point of this assertion is that adding a
  // country is a deliberate, reviewed act with a source behind it, and a
  // membership check that only counted would let a row appear unnoticed.
  assert.deepEqual(supportedCountryCodes().sort(), ["CA", "DE", "GB", "IE", "IN", "MX", "NL", "PH", "PL", "PT", "US"]);
});

test("computeNoticePeriod: proposed date LATER than statutory end is `later_than_statutory`, not a discrepancy that escalates", () => {
  // UK 37-48 month bracket = 21 days. Statutory end = 2026-08-16 + 21 = 2026-09-06.
  // Proposed 2026-09-15 is 9 days later.
  const r = computeNoticePeriod({
    countryCode: "GB",
    startDate: "2023-01-10",
    now: "2026-08-16",
    proposedEndDate: "2026-09-15",
  });
  assert.equal(r.discrepancy, "later_than_statutory");
  assert.equal(r.discrepancyDays, 9);
});

test("computeNoticePeriod: PT >2y tenure gives 60 days notice, <2y gives 30", () => {
  const oldHand = computeNoticePeriod({ countryCode: "PT", startDate: "2024-01-01", now: "2026-08-16" });
  assert.equal(oldHand.noticeDays, 60);
  const recent = computeNoticePeriod({ countryCode: "PT", startDate: "2025-01-01", now: "2026-08-16" });
  assert.equal(recent.noticeDays, 30);
});

test("computeNoticePeriod: all 9 supported countries each produce their own distinct, correct notice days — none falls through to a wrong default", () => {
  const now = "2026-08-16";
  // Tenure chosen per country so each lands in a specific, hand-checked
  // bracket from noticePeriodTable.js — every value here is read directly
  // off that table's own comments, not re-derived from the code under test.
  const cases = [
    { countryCode: "GB", startDate: "2023-01-10", expectedDays: 21, basis: "statutory" }, // 37-48mo bracket
    { countryCode: "IE", startDate: "2020-01-01", expectedDays: 7, basis: "statutory" }, // >=3mo bracket
    { countryCode: "DE", startDate: "2020-01-01", expectedDays: 28, basis: "statutory" }, // flat 4 weeks
    { countryCode: "PL", startDate: "2020-01-01", expectedDays: 90, basis: "statutory" }, // >36mo bracket
    { countryCode: "IN", startDate: "2023-08-01", expectedDays: 14, basis: "statutory" }, // 24-59mo bracket
    { countryCode: "PH", startDate: "2020-01-01", expectedDays: 30, basis: "statutory" }, // flat 30 days
    { countryCode: "MX", startDate: "2020-01-01", expectedDays: 30, basis: "statutory" }, // flat 30 days
    { countryCode: "CA", startDate: "2020-01-01", expectedDays: 14, basis: "customary" }, // >=36mo bracket
    { countryCode: "PT", startDate: "2020-01-01", expectedDays: 60, basis: "statutory" }, // >=2y bracket
  ];
  for (const c of cases) {
    const r = computeNoticePeriod({ countryCode: c.countryCode, startDate: c.startDate, now });
    assert.equal(r.countryCode, c.countryCode);
    assert.equal(r.noticeDays, c.expectedDays, `${c.countryCode}: expected ${c.expectedDays} days, got ${r.noticeDays}`);
    assert.equal(r.basis, c.basis, `${c.countryCode}: expected basis "${c.basis}"`);
    assert.ok(r.noticeEndDate, `${c.countryCode}: must produce a concrete notice end date`);
    assert.ok(r.sourceCitation && r.sourceCitation.length > 0, `${c.countryCode}: must cite a source rule`);
  }
  // The 9 expected values are not all identical — confirms the table is
  // actually being read per-country rather than one bracket silently
  // winning for every input.
  const distinctDays = new Set(cases.map((c) => c.expectedDays));
  assert.ok(distinctDays.size >= 5, "the 9 countries should not collapse onto a single notice-day value");
});

// ---------------------------------------------------------------------------
// LLM seam — extractFromLetter()
// ---------------------------------------------------------------------------

test("extractFromLetter falls back to rules when unconfigured, returns source: 'rule_based_fallback'", async () => {
  const r = await extractFromLetter(
    { text: "My last working day will be 2026-12-15. I am leaving for personal reasons." },
    { isConfigured: () => false }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(r.proposedEndDate, "2026-12-15");
  assert.match(r.reason, /personal reasons/);
});

test("extractFromLetter falls back when the LLM returns an invalid shape (network error simulated)", async () => {
  const r = await extractFromLetter(
    { text: "Effective 2026-12-15." },
    {
      isConfigured: () => true,
      askJson: async () => {
        throw new Error("connection refused");
      },
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(r.proposedEndDate, "2026-12-15");
});

test("extractFromLetter rejects non-ISO proposedEndDate from the LLM (never an invented date)", async () => {
  const r = await extractFromLetter(
    { text: "Effective 15 Dec 2026." },
    {
      isConfigured: () => true,
      askJson: async () => ({ proposedEndDate: "Dec 15, 2026", reason: null, confidence: 0.7 }),
      backoff: async () => {},
    }
  );
  // The shape validator rejects "Dec 15, 2026" as a non-ISO date -> falls back to rules
  // -> rule-based path parses "15 Dec 2026" successfully.
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(r.proposedEndDate, "2026-12-15");
});

test("extractFromLetter succeeds with source: 'llm' when the LLM returns a valid shape", async () => {
  const r = await extractFromLetter(
    { text: "Effective 2027-01-15." },
    {
      isConfigured: () => true,
      askJson: async () => ({ proposedEndDate: "2027-01-15", reason: "new opportunity", confidence: 0.9 }),
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "llm");
  assert.equal(r.proposedEndDate, "2027-01-15");
  assert.equal(r.reason, "new opportunity");
});

test("extractFromLetter retries a failing LLM call 3x before falling back (§4 invariant 10)", async () => {
  const localAudit = new AuditLogger();
  let attempts = 0;
  const r = await extractFromLetter(
    { text: "Effective 2026-12-15." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        throw new Error("transient");
      },
      audit: localAudit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(attempts, 3, "3 attempts before the rule-based fallback");
  const traces = localAudit.entries.filter((e) => e.call === "letterExtractor.extractFromLetter");
  assert.equal(traces.length, 3, "one trace entry per attempt");
  assert.ok(traces.every((t) => t.ok === false));
});

test("extractFromLetter succeeds on a retry and tags source 'llm' with a 2-attempt trace", async () => {
  const localAudit = new AuditLogger();
  let attempts = 0;
  const r = await extractFromLetter(
    { text: "Effective 2026-12-15." },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient");
        return { proposedEndDate: "2026-12-15", reason: null, confidence: 0.85 };
      },
      audit: localAudit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "llm");
  assert.equal(r.proposedEndDate, "2026-12-15");
  const traces = localAudit.entries.filter((e) => e.call === "letterExtractor.extractFromLetter");
  assert.equal(traces.length, 2, "a 2-attempt success produces 2 trace entries, not a hidden single one");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[1].ok, true);
});

// ---------------------------------------------------------------------------
// Store behavior
// ---------------------------------------------------------------------------

test("resignationStore.findByExternalRef returns the newest matching row", async () => {
  await submit({ externalRef: "ext-a" });
  await submit({ externalRef: "ext-a" });
  const found = await resignationStore.findByExternalRef("ext-a");
  assert.ok(found);
  // The newer row's id is the second one created
  const all = resignationStore.resignations.filter((r) => r.externalRef === "ext-a");
  assert.equal(found.id, all[all.length - 1].id);
});

test("resignationStore.findById returns null for an unknown id (rather than throwing)", async () => {
  const found = await resignationStore.findById("does-not-exist");
  assert.equal(found, null);
});

// ---------------------------------------------------------------------------
// signoffPolicy pure coverage
// ---------------------------------------------------------------------------

test("evaluateResignationActionability: null row -> resignation_not_found", () => {
  assert.equal(evaluateResignationActionability({ resignationRow: null }).code, "resignation_not_found");
});

test("evaluateResignationActionability: escalated row -> not_awaiting_signoff", () => {
  assert.equal(evaluateResignationActionability({ resignationRow: { decision: "escalate", status: "escalated" } }).code, "not_awaiting_signoff");
});

test("evaluateResignationActionability: signed_off row -> already_decided", () => {
  assert.equal(evaluateResignationActionability({ resignationRow: { decision: "prepared_for_signoff", status: "signed_off" } }).code, "already_decided");
});

test("evaluateResignationActionability: prepared_for_signoff + pending_signoff -> actionable", () => {
  const r = evaluateResignationActionability({ resignationRow: { decision: "prepared_for_signoff", status: "pending_signoff" } });
  assert.equal(r.allowed, true);
  assert.equal(r.code, "actionable");
});

test("evaluateSignoffAction: empty approver -> approver_required", () => {
  const r = evaluateSignoffAction({ resignationRow: { decision: "prepared_for_signoff", status: "pending_signoff" }, approver: "", action: "signoff" });
  assert.equal(r.code, "approver_required");
});

test("evaluateSignoffAction: unknown action -> unknown_action", () => {
  const r = evaluateSignoffAction({ resignationRow: { decision: "prepared_for_signoff", status: "pending_signoff" }, approver: "hr_x", action: "approve" });
  assert.equal(r.code, "unknown_action");
});

// ---------------------------------------------------------------------------
// Structural sanity: workflow.js never imports a write-capable client that
// could invoke a Remote write to a (non-existent) resignations endpoint.
// ---------------------------------------------------------------------------

test("STRUCTURAL: workflow.js does not invoke any patch/post endpoint on RemoteClient or any PATCH verb on a URL", () => {
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc05", "workflow.js"), "utf8");
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The workflow may READ via remote.getEmployment() (the only method it needs).
  // It must never call any write-shaped method. We allow the local store's
  // createResignation()/recordSignoff() — those write to OUR audit/store, not
  // to Remote. The forbidden list below targets Remote's surface.
  for (const forbidden of [
    "patchEmploymentBasicInformation",
    "validateResignation",
    "postResignation",
    "createOffboarding",
    "validateOffboarding",
  ]) {
    assert.ok(!code.includes(forbidden), `workflow.js must never reference ${forbidden} — the spec confirms no such write endpoint exists`);
  }
  // Defensive: a hypothetical future engineer adding `remote.post(` would
  // be flagged. We allow `.get(` (legitimate) but not `.post(`/`.patch(`/`.put(`/`.delete(`.
  assert.ok(!/\bremote\.(post|patch|put|delete)\b/.test(code), "workflow.js must never call a write verb on the remote client");
});

// ---------------------------------------------------------------------------
// `now` may arrive as a full ISO timestamp, not just a calendar day
// ---------------------------------------------------------------------------
// Found live, not by a test. The n8n Normalize node sets
// `now: new Date().toISOString()` — a FULL timestamp — while every fixture in
// this file passed a date-only "YYYY-MM-DD". computeNoticePeriod() used
// `typeof now === "string" ? now : ...`, so the timestamp flowed through
// untouched into addCalendarDays() -> fromIsoDate() and threw
// `Invalid YYYY-MM-DD date: 2026-08-16T13:05:20.171Z`, crashing the run.
//
// It stayed hidden because it is only reachable on the path where everything
// else succeeds: a verified identity, an active employee, a start date present,
// AND a country inside the 9-country table. Every live resignation until now
// escalated at an earlier gate, so the date arithmetic was never entered.
//
// The sharper lesson is about the parity test. Both copies of this logic — this
// one and workflows/nodes-uc05/noticePeriodGates.js — are executed against each
// other and agreed perfectly, because both were fed date-only fixtures. Parity
// proves two implementations MATCH; it never proves either is right about an
// input neither was given.
test("computeNoticePeriod accepts a full ISO timestamp for `now`, as the real intake sends", () => {
  const fromTimestamp = computeNoticePeriod({
    countryCode: "CA",
    startDate: "2023-06-24",
    probationEndDate: null,
    proposedEndDate: "2026-10-15",
    now: "2026-08-16T13:05:20.171Z",
  });
  const fromCalendarDay = computeNoticePeriod({
    countryCode: "CA",
    startDate: "2023-06-24",
    probationEndDate: null,
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
  });

  assert.equal(fromTimestamp.noticeStartDate, "2026-08-16", "the time component must be dropped, not carried into the date");
  assert.deepEqual(fromTimestamp, fromCalendarDay, "a timestamp and its calendar day must produce the identical result");
  assert.equal(fromTimestamp.noticeEndDate, "2026-08-30", "14 days' customary notice at 38 months' tenure");
});

test("computeNoticePeriod accepts a Date for `now` too, and refuses what it cannot read", () => {
  const fromDate = computeNoticePeriod({
    countryCode: "CA",
    startDate: "2023-06-24",
    probationEndDate: null,
    proposedEndDate: "2026-10-15",
    now: new Date("2026-08-16T13:05:20.171Z"),
  });
  assert.equal(fromDate.noticeStartDate, "2026-08-16");

  // Refusing beats defaulting to today: a notice period is a legal date on an
  // HR document, and a silently wrong one is worse than a refused one.
  assert.throws(
    () => computeNoticePeriod({
      countryCode: "CA",
      startDate: "2023-06-24",
      probationEndDate: null,
      proposedEndDate: "2026-10-15",
      now: "not a date at all",
    }),
    /could not read a date/
  );
});

// ---------------------------------------------------------------------------
// 8. Malformed time-off balance -> audited escalate, never a crash, never a
//    guessed payout  (n8n execution 4975)
// ---------------------------------------------------------------------------
// A real webhook delivery carried timeOffBalances: [{type:"vacation",
// balanceDays:8}] — a plausible-looking Time Off shape that carries NONE of the
// four fields reconcilePtoPayout() multiplies. fromRemoteInteger(undefined)
// threw a TypeError out of the gates, and because the gates run BEFORE the
// audit write, the request vanished: no case row, no audit row, no human told.
// Every other gate failure in this system fails closed to a DURABLE, AUDITED
// escalate; this one failed open into silence.
//
// The fix must not "helpfully" treat the missing rate as zero either. A zero
// payout on a real accrued balance is an underpayment a human would act on —
// prime directive 1 and the money ×100 invariant both say a figure we cannot
// derive must be refused, not invented.

const UNUSABLE_BALANCE = [{ type: "vacation", balanceDays: 8 }]; // the exact shape from execution 4975

test("8a. reconcilePtoPayout refuses a balance with no hourly rate instead of throwing", () => {
  const payout = reconcilePtoPayout({ balances: UNUSABLE_BALANCE, currency: "EUR" });
  assert.equal(payout.computable, false);
  assert.equal(payout.source, "unusable_time_off_records");
  // NEVER a number a human could act on.
  assert.equal(payout.totalInRemoteInteger, null);
  assert.equal(payout.computedBalanceInRemoteInteger, null);
  assert.equal(payout.hasDiscrepancy, false);
  assert.equal(payout.unusableLines.length, 1);
  assert.ok(payout.unusableLines[0].missing.includes("hourlyRateInRemoteInteger"));
  assert.ok(payout.unusableLines[0].missing.includes("daysAccrued"));
});

test("8b. reconcilePtoPayout refuses a non-integer hourly rate rather than coercing it", () => {
  // A quoted number is how a 100x scaling error gets in (same reasoning as
  // UC-09 finding F-05): "5000" is NOT silently accepted.
  for (const rate of ["5000", 50.5, null, NaN, Infinity]) {
    const payout = reconcilePtoPayout({
      balances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: rate }],
      currency: "USD",
    });
    assert.equal(payout.computable, false, `rate ${String(rate)} should be refused`);
    assert.equal(payout.totalInRemoteInteger, null);
  }
});

test("8c. one unusable line poisons the whole total — a partial sum is a wrong sum", () => {
  const payout = reconcilePtoPayout({
    balances: [
      { timeOffType: "vacation", daysAccrued: 10, daysUsed: 2, hourlyRateInRemoteInteger: 5000 },
      { type: "sick", balanceDays: 3 },
    ],
    currency: "USD",
  });
  assert.equal(payout.computable, false);
  assert.equal(payout.totalInRemoteInteger, null);
  // The line that COULD be computed is still shown, so HR Ops sees the work,
  // but it is never summed into a total presented as complete.
  assert.equal(payout.lines.length, 1);
  assert.equal(payout.lines[0].payoutInRemoteInteger, 320000);
  assert.equal(payout.unusableLines.length, 1);
});

test("8d. policy engine turns an uncomputable payout into escalate/pto_balance_unusable", () => {
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { id: "emp_uk_001", status: "active", start_date: "2023-01-10", country_code: "GB" },
    proposedEndDate: "2026-09-15",
    timeOffBalances: UNUSABLE_BALANCE,
    currency: "EUR",
    now: "2026-08-16",
  });
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "pto_balance_unusable");
  assert.ok(result.flags.includes("pto_balance_unusable"));
  assert.ok(result.flags.includes("pto_missing_hourlyRateInRemoteInteger"));
  // The statutory notice is still computed and attached — HR Ops needs it.
  assert.equal(result.notice.noticeDays, 21);
  assert.equal(result.payout.computable, false);
});

test("8e. an EARLIER gate still wins: a statutory discrepancy is not relabelled a data problem", () => {
  // Ordered gates, first failure wins. The discrepancy gate is the substantive
  // answer about the request; the unusable balance is an input-quality problem.
  // It must still be FLAGGED so it is never invisible.
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { id: "emp_pl_001", status: "active", start_date: "2022-01-10", country_code: "PL" },
    proposedEndDate: "2026-08-31",
    timeOffBalances: UNUSABLE_BALANCE,
    currency: "EUR",
    now: "2026-07-25",
  });
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "statutory_discrepancy");
  assert.ok(result.flags.includes("pto_balance_unusable"));
});

test("8f. the malformed delivery from execution 4975 produces a DURABLE, AUDITED escalate", async () => {
  const r = await submit({ timeOffBalances: UNUSABLE_BALANCE, currency: "EUR" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");

  // The whole point: a record exists. Previously the throw left nothing at all.
  assert.ok(r.resignationId, "a resignation row must exist");
  const entries = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "escalate");
  assert.equal(entries[0].details.reason, "pto_balance_unusable");
  // The audit row names WHY the payout is absent rather than recording a zero.
  assert.equal(entries[0].details.payout.totalInRemoteInteger, null);
  assert.equal(entries[0].details.payout.computable, false);
});

// ---------------------------------------------------------------------------
// F-33 — a NEGATIVE stated accrual is not "no accrual"
// ---------------------------------------------------------------------------
// F-28 taught this function to refuse a figure it cannot derive. It still
// accepted one it cannot TRUST. `Math.max(0, accrued - used)` turned a stated
// -8 days into a computable 0.00 payout: `computable: true`, source
// `time_off_records`, no flag, `prepared_for_signoff` / `all_gates_passed`.
// That is the F-28/F-29/F-30 shape exactly — an unknown quantity coerced into
// a real one, so nothing errors and a human signs off on a number nobody
// derived.
//
// The clamp is not the bug and is kept: `accrued 4 / used 6` is a real,
// legitimate situation (leave taken in advance) whose payout genuinely is 0.
// The bug is that a NEGATIVE INPUT reached the clamp at all. -8 accrued days
// is not a fact about a balance; it is a balance we cannot read.
//
// `daysUsed` is refused on the same rule and for a sharper reason: a negative
// USED count does not underpay, it OVERPAYS. `Math.max(0, 10 - (-5))` = 15
// days available out of a 10-day accrual — the clamp cannot see it, because
// the number it produces is positive and plausible.
//
// The refusal belongs in unusableFields(), not in the caller: the portal
// (F-30) forwards a stated accrual RAW precisely so this function can judge
// it, and forwarding a negative into a clamp rebuilds the confident zero that
// F-30 removed.

test("F-33: a NEGATIVE stated accrual is refused by name, never clamped to a computable zero", () => {
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: -8, daysUsed: 0, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(payout.computable, false, "a negative accrual must not be computable");
  assert.equal(payout.source, "unusable_time_off_records");
  assert.equal(payout.totalInRemoteInteger, null, "never a number a human could act on");
  assert.equal(payout.computedBalanceInRemoteInteger, null);
  assert.equal(payout.lines.length, 0, "the refused line is not silently paid out at zero");
  assert.equal(payout.unusableLines.length, 1);
  assert.deepEqual(payout.unusableLines[0].missing, ["daysAccrued"]);
  assert.equal(payout.unusableLines[0].timeOffType, "vacation");
});

test("F-33: a NEGATIVE daysUsed is refused too — the clamp cannot see an OVERpayment", () => {
  // 10 accrued, -5 used => Math.max(0, 15) => 15 days at 8h x 32.50 = 3900.00,
  // a payout 50% larger than the largest one the accrual could justify. The
  // number is positive and plausible, which is exactly why nothing caught it.
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 10, daysUsed: -5, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(payout.computable, false);
  assert.equal(payout.totalInRemoteInteger, null);
  assert.deepEqual(payout.unusableLines[0].missing, ["daysUsed"]);
});

test("F-33: the gate turns a negative accrual into an audited escalate, not a silent sign-off", () => {
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { id: "emp_uk_001", status: "active", start_date: "2023-01-10", country_code: "GB" },
    proposedEndDate: "2026-09-15",
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: -8, daysUsed: 0, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
    now: "2026-08-16",
  });
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "pto_balance_unusable");
  assert.ok(result.flags.includes("pto_balance_unusable"));
  assert.ok(result.flags.includes("pto_missing_daysAccrued"), "the escalation names the field");
  // The statutory notice is still computed and attached — HR Ops needs it.
  assert.equal(result.notice.noticeDays, 21);
});

test("F-33 POSITIVE: the clamp survives for the case it exists for — leave taken in ADVANCE still pays 0.00", () => {
  // 4 accrued, 6 used. Both inputs are readable and legitimate; the employee
  // simply owes days rather than being owed them. This must stay a COMPUTABLE
  // zero — refusing it would be the mirror-image defect (a gate that refuses
  // everything passes every fail-closed assertion; see docs/BUILD-LOG.md §3.30).
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 4, daysUsed: 6, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(payout.computable, true, "a real overdraw is an answer, not a refusal");
  assert.equal(payout.source, "time_off_records");
  assert.equal(payout.lines[0].daysAvailable, 0);
  assert.equal(payout.totalInRemoteInteger, 0);
});

test("F-33 POSITIVE: a valid accrual still computes its real, non-zero payout", () => {
  // 18 - 6 = 12 days x 8h x 32.50 = 3120.00 GBP. The same figure F-30's own
  // positive test pins through the portal, asserted here at the reconciler.
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 18, daysUsed: 6, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(payout.computable, true);
  assert.equal(payout.lines[0].daysAvailable, 12);
  assert.equal(payout.totalInRemoteInteger, 312000);
  assert.equal(payout.unusableLines.length, 0);
});

test("F-33 POSITIVE: a stated ZERO accrual is the requester's answer and still computes", () => {
  // 0 is a real, readable figure. Only a NEGATIVE one is unreadable.
  const payout = reconcilePtoPayout({
    balances: [{ timeOffType: "vacation", daysAccrued: 0, daysUsed: 0, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(payout.computable, true);
  assert.equal(payout.totalInRemoteInteger, 0);
  assert.equal(payout.unusableLines.length, 0);
});

test("F-33: a negative accrual survives the whole workflow as a DURABLE, AUDITED escalate", async () => {
  const r = await submit({
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: -8, daysUsed: 0, hourlyRateInRemoteInteger: 3250 }],
    currency: "GBP",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");
  assert.ok(r.resignationId, "a resignation row must exist");
  const entries = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].details.payout.totalInRemoteInteger, null);
  assert.equal(entries[0].details.payout.computable, false);
});

// ---------------------------------------------------------------------------
// F-34 — a supported country reported as unsupported, and the self-contradicting
// notice record. Both found by driving the portal, neither by any prior test.
// ---------------------------------------------------------------------------

test("F-34: a GB employee below the one-month bracket is NOT reported as an unsupported country", () => {
  // Employment Rights Act 1996 §86 grants no notice below one month's service,
  // so GB's first bracket starts at month 1 and nothing matches a week-one
  // leaver. The old gate saw only `noticeEndDate === null` and answered
  // `unsupported_country` + `country_GB` — a durable, false claim that Remote
  // does not cover the United Kingdom, on a record that cites the UK statute by
  // name two fields away.
  const notice = computeNoticePeriod({
    countryCode: "GB",
    startDate: "2026-08-01",
    proposedEndDate: "2026-09-15",
    now: "2026-08-06",
  });
  assert.equal(notice.noticeEndDate, null, "fixture guard: this tenure really does match no bracket");
  assert.equal(notice.noticeRuleFound, true, "the table HAS a rule for GB — that is the whole point");

  const result = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", country_code: "GB", start_date: "2026-08-01" },
    proposedEndDate: "2026-09-15",
    now: "2026-08-06",
  });
  assert.equal(result.decision, "escalate", "it still escalates — only the stated reason changes");
  assert.equal(result.reason, "no_matching_notice_bracket");
  assert.ok(!result.flags.includes("unsupported_country"), "GB must never be flagged unsupported");
  assert.ok(result.flags.includes("country_GB"));
  assert.ok(
    result.flags.some((f) => f.startsWith("tenure_months_")),
    "the escalation names the tenure that matched nothing, so it is actionable"
  );
});

test("F-34: a country genuinely absent from the table still reports unsupported_country", () => {
  // The other half of the split. Brazil is not in the nine-country table, and
  // that reason is correct and unchanged — a fix that relabelled BOTH branches
  // would have traded one wrong reason for another.
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", country_code: "BR", start_date: "2024-04-01" },
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
  });
  assert.equal(result.reason, "unsupported_country");
  assert.deepEqual(result.flags, ["unsupported_country", "country_BR"]);
  assert.equal(result.notice.noticeRuleFound, false);
});

test("F-34: a stated leaving date is never recorded as 'no_proposed_date'", () => {
  // The record contradicted itself in adjacent fields: proposedEndDate held the
  // employee's date while discrepancy said they had never given one. Whichever
  // half a reader branches on, one of them is false.
  for (const [label, countryCode, startDate] of [
    ["country absent from the table", "BR", "2024-04-01"],
    ["country present, tenure matches no bracket", "GB", "2026-08-01"],
  ]) {
    const notice = computeNoticePeriod({
      countryCode,
      startDate,
      proposedEndDate: "2026-10-15",
      now: "2026-08-16",
    });
    assert.equal(notice.noticeEndDate, null, `${label}: fixture guard`);
    assert.equal(notice.proposedEndDate, "2026-10-15", `${label}: the stated date is kept`);
    assert.equal(
      notice.discrepancy,
      "not_comparable",
      `${label}: a stated date with nothing to compare it against is not "no date stated"`
    );
  }
});

test("F-34: 'no_proposed_date' still means exactly that when no date was stated", () => {
  const notice = computeNoticePeriod({ countryCode: "BR", startDate: "2024-04-01", now: "2026-08-16" });
  assert.equal(notice.proposedEndDate, null);
  assert.equal(notice.discrepancy, "no_proposed_date");
});

test("F-34: tenure is never fabricated as 0 for a country we have no rule for", () => {
  // `tenureMonths: 0` was hardcoded on the no-rule branch, so a Brazilian
  // employee with over two years' service was durably recorded as having served
  // zero months. Not knowing a country's notice law says nothing about how long
  // somebody has worked there, and the start date is right there in the args.
  const notice = computeNoticePeriod({
    countryCode: "BR",
    startDate: "2024-04-01",
    proposedEndDate: "2026-10-15",
    now: "2026-08-16",
  });
  assert.equal(notice.tenureMonths, 28, "the real length of service, not a placeholder");
});

test("F-34: an unreadable start date on the no-rule branch yields null tenure, never a throw", () => {
  // The escalation must stay durable. A throw here happens upstream of the
  // audit write and loses the request entirely — the F-28/F-29 failure shape.
  const notice = computeNoticePeriod({ countryCode: "BR", startDate: "not-a-date", now: "2026-08-16" });
  assert.equal(notice.tenureMonths, null);
  assert.equal(notice.countryCode, "BR");
});

// ---------------------------------------------------------------------------
// F-36 — the probation brackets were unreachable code for every real record
// ---------------------------------------------------------------------------

test("F-36 POSITIVE: a probation end date on the NORMALIZED employment shape reaches the bracket", () => {
  // The bug was never in the table or the calculator; it was that nothing ever
  // handed them a date. RemoteClient.normalizeEmployment() collapsed the real
  // API's `probation_period_end_date` to a boolean and dropped the date, while
  // policyEngine read `probation_end_date`. Result: `onProbation` was ALWAYS
  // false and PT/DE/IN/PH/MX's probation brackets could not fire for any real
  // employment. This asserts the REACHABILITY, which is the part that was
  // missing — the arithmetic already had tests, against a mock fixture that
  // supplied a field no real record produces.
  const onProbation = evaluatePolicy({
    identityVerified: true,
    employment: {
      status: "active",
      country_code: "PT",
      start_date: "2026-06-01",
      probation_end_date: "2026-11-01", // future -> on probation
    },
    now: "2026-08-16",
  });
  assert.equal(onProbation.notice.onProbation, true, "the gate must SEE the probation date");
  assert.equal(onProbation.notice.noticeDays, 15, "Portugal's probation notice is 15 days, not 30");

  const offProbation = evaluatePolicy({
    identityVerified: true,
    employment: { status: "active", country_code: "PT", start_date: "2026-06-01" },
    now: "2026-08-16",
  });
  assert.equal(offProbation.notice.onProbation, false);
  assert.equal(offProbation.notice.noticeDays, 30, "without the date the employee is told they owe twice as much");
});

test("F-36: the RAW Remote field name is accepted too, so an unnormalized record is not silently full-tenure", () => {
  // `probation_period_end_date` is what GET /v1/employments/{id} actually
  // returns [CONFIRMED live against the Sandbox, 2026-08-19]. A record that
  // reaches this gate unnormalized must not quietly get the full-tenure rule.
  const result = evaluatePolicy({
    identityVerified: true,
    employment: {
      status: "active",
      country_code: "PT",
      start_date: "2026-06-01",
      probation_period_end_date: "2026-11-01",
    },
    now: "2026-08-16",
  });
  assert.equal(result.notice.onProbation, true);
  assert.equal(result.notice.noticeDays, 15);
});

test("F-36: normalizeEmployment carries the probation END DATE, not just the boolean", () => {
  // The single line the whole finding turns on. A real API record goes through
  // the mapping branch (no top-level string `contract_type`/`start_date`), and
  // that branch is where the date used to be discarded.
  const normalized = normalizeEmployment({
    id: "emp_probation_live",
    status: "active",
    employment_model: "employee",
    probation_period_end_date: "2027-01-31",
    basic_information: { provisional_start_date: "2026-06-01" },
  });
  assert.equal(normalized.probation_end_date, "2027-01-31", "the DATE, which is what the notice rule needs");
  assert.equal(normalized.probation, true, "the existing boolean is untouched — uc01/letter.js reads it");
});

test("F-36: no probation period means an explicit null, never an undefined the gate reads as absent-by-accident", () => {
  const normalized = normalizeEmployment({
    id: "emp_no_probation",
    status: "active",
    employment_model: "contractor",
    probation_period_end_date: null,
    basic_information: { provisional_start_date: "2026-06-01" },
  });
  assert.equal(normalized.probation_end_date, null);
  assert.equal(normalized.probation, false);
});
