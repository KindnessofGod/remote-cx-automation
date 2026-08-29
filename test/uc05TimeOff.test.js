// ---------------------------------------------------------------------------
// uc05TimeOff.test.js  —  UC-05's PTO days now have a source
// ---------------------------------------------------------------------------
// WHAT CHANGED, AND WHY IT NEEDED ITS OWN FILE
//
// UC-05.md §7 promises "accrued PTO payout reconciliation from Time Off API".
// Until this work, `grep -rn "leave-policies\|timeoff-balances" src/` returned
// no consumer: the days multiplied into a resignation settlement were whatever
// the requester typed into a form, on a document an employee signs. Every other
// unsourced figure in this system escalates to a human who can check it; this
// one had a signature line under it.
//
// THE POSITIVE TESTS ARE THE POINT OF THIS FILE. A gate that refuses correctly
// and a gate that structurally cannot succeed are indistinguishable from
// outside (docs/BUILD-LOG.md §3.30), and every refusal below was already
// reachable before the read existed. So the first two tests assert a REAL
// PAYOUT, arithmetic and all, computed from a Remote-shaped balance — and the
// second one asserts the exact figure a truncating implementation would
// produce, so "close enough" fails.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { describeSignoffBasis } from "../src/uc05/decisionFacts.js";
import { reconcilePtoPayout } from "../src/uc05/ptoPayout.js";
import { normalizeLeaveBalances } from "../src/remote/leaveBalances.js";
import { fromRemoteInteger } from "../src/shared/money.js";

// AN EPHEMERAL PORT, not a registered one. `src/shared/ports.js` reserves a
// band per surface precisely so a running demo and `npm test` can never fight
// over a socket; letting the OS choose sidesteps the question entirely, and a
// port nobody wrote down is a port nobody can collide with.
let server;
let remote;
let baseUrl;

before(async () => {
  server = await startMockServer(0);
  baseUrl = `http://localhost:${server.address().port}`;
  remote = new RemoteClient({ baseUrl });
});
after(() => server && server.close());

let audit;
let resignationStore;

beforeEach(() => {
  audit = new AuditLogger();
  resignationStore = new ResignationStore();
});

const fakeExtract = (args) => extractFromLetter(args, { isConfigured: () => false });

/** 40.00 per hour, in Remote's integer form. Supplied by the caller, always. */
const RATE = 4000;

function submit(overrides = {}, deps = {}) {
  return handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_uk_001" },
      employmentId: "emp_uk_001",
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
      now: "2026-08-16",
      ...overrides,
    },
    { remote, audit, resignationStore, extract: fakeExtract, ...deps }
  );
}

// ---------------------------------------------------------------------------
// POSITIVE — a payout computed from Remote's own balance
// ---------------------------------------------------------------------------

test("POSITIVE: Remote's own balance x a supplied rate produces a real, correct payout", async () => {
  // emp_uk_001's leave-policy fixture mirrors live Sandbox record 33db8dbb:
  //   balance = 13 days 6 hours, working_hours_per_day = 8  ->  13.75 days
  //   13.75 days x 8 h/day = 110 hours;  110 x 40.00 = 4,400.00
  const r = await submit({ hourlyRateInRemoteInteger: RATE });

  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.payout.computable, true);
  assert.equal(r.payout.source, "time_off_records");
  assert.equal(r.payout.lines.length, 1);
  assert.equal(r.payout.lines[0].daysAvailable, 13.75);
  assert.equal(r.payout.lines[0].payoutInRemoteInteger, 440000);
  assert.equal(r.payout.totalInRemoteInteger, 440000);
  assert.equal(fromRemoteInteger(r.payout.totalInRemoteInteger), 4400);
});

test("POSITIVE: the hours remainder is paid, not truncated — 13.75 days, never 13", async () => {
  // The failing implementation reads `balance.days` and drops `balance.hours`.
  // It produces 13 days -> 104 hours -> 4,160.00: a plausible number, 240.00
  // short, in the employer's favour, with no gate anywhere that fires on it.
  const r = await submit({ hourlyRateInRemoteInteger: RATE });
  const truncated = 13 * 8 * RATE;
  assert.equal(truncated, 416000, "fixture precondition: the truncated figure really is different");
  assert.notEqual(r.payout.totalInRemoteInteger, truncated);
  assert.equal(r.payout.totalInRemoteInteger, 440000);
});

test("POSITIVE: the days are tagged as Remote's, not the requester's", async () => {
  // The whole defect this closes is a number with no provenance. A figure that
  // is now right but still unattributable would have closed it invisibly.
  const r = await submit({ hourlyRateInRemoteInteger: RATE });
  assert.equal(r.ptoSource, "remote_leave_policy_summary");
  assert.equal(r.payout.lines[0].daysSource, "remote_leave_policy_summary");
  assert.equal(r.payout.lines[0].hoursPerDay, 8, "the row's own working_hours_per_day, not this repo's default");

  const [row] = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(row.details.ptoSource, "remote_leave_policy_summary");
  assert.equal(row.details.ptoUpstreamFailure, null);
});

test("POSITIVE: two leave policies on one employment are both read and both totalled", async () => {
  // emp_de_001 mirrors the French shape: a localised "Congés N" policy at
  // 5 days 4 hours (= 5.5 days) plus a zero "Time off" policy.
  const r = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_de_001" },
      employmentId: "emp_de_001",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: RATE,
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.payout.lines.length, 2);
  assert.deepEqual(
    r.payout.lines.map((l) => l.daysAvailable),
    [5.5, 0]
  );
  assert.equal(r.payout.totalInRemoteInteger, 5.5 * 8 * RATE);
});

test("POSITIVE: the currency comes off the employment record when the caller names none", async () => {
  // `contract_details.compensation_currency_code` is [CONFIRMED] live on the
  // NL/US/CA records ("EUR"/"USD"/"CAD"). The old `currency = "USD"` default
  // labelled every settlement USD, so a euro figure printed under a dollar
  // sign. Naming a currency is not arithmetic, so preferring Remote's asserts
  // nothing new — it only stops this system asserting something false.
  const germanRecord = {
    id: "emp_stub_de",
    status: "active",
    country_code: "DE",
    start_date: "2022-06-01",
    email: "stub@berlin.test",
    contract_details: { annual_gross_salary: 6800000, compensation_currency_code: "EUR", work_hours_per_week: 40 },
  };
  const stub = {
    getEmployment: async () => germanRecord,
    listLeavePolicySummary: async () => [
      {
        used: { type: "limited", hours: 0, days: 0 },
        balance: { type: "limited", hours: 0, days: 10 },
        taken: { type: "limited", hours: 0, days: 0 },
        leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
        upcoming_requested: { type: "limited", hours: 0, days: 0 },
        upcoming_approved: { type: "limited", hours: 0, days: 0 },
        pending_approval: { type: "limited", hours: 0, days: 0 },
        current_entitlement: { type: "limited", hours: 0, days: 10 },
        booked: { type: "limited", hours: 0, days: 0 },
        annual_entitlement: { type: "limited", hours: 0, days: 20 },
        annual_balance: { type: "limited", hours: 0, days: 20 },
        working_hours_per_day: 8,
      },
    ],
  };
  const r = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_stub_de" },
      employmentId: "emp_stub_de",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: RATE,
    },
    { remote: stub, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.payout.currency, "EUR");
  assert.equal(r.payout.totalInRemoteInteger, 10 * 8 * RATE);

  // An explicitly-named currency still wins: a caller that named one is stating
  // a fact about its own numbers.
  const named = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_stub_de" },
      employmentId: "emp_stub_de",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
      currency: "GBP",
      hourlyRateInRemoteInteger: RATE,
    },
    { remote: stub, audit, resignationStore: new ResignationStore(), extract: fakeExtract }
  );
  assert.equal(named.payout.currency, "GBP");
});

// ---------------------------------------------------------------------------
// THE REFUSALS — each one a different fact
// ---------------------------------------------------------------------------

test("no rate supplied: the days are known, the money is not, and the report says exactly that", async () => {
  // Remote publishes no hourly or daily rate on any endpoint. An assumed
  // 40-hour week would turn `annual_gross_salary` into a confident number
  // nobody supplied, printed as money on a document the employee signs.
  const r = await submit();
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");
  assert.ok(r.flags.includes("pto_missing_hourlyRateInRemoteInteger"));
  assert.equal(r.payout.totalInRemoteInteger, null, "an absence of a figure, never a figure of zero");

  const row = await resignationStore.findById(r.resignationId);
  const basis = describeSignoffBasis({ resignationRow: row });
  assert.match(basis.payout.sentence, /came from Remote's Time Off API/);
  assert.match(basis.payout.sentence, /Remote does not publish/);
  const unknown = basis.unknowns.find((u) => u.what === "The accrued-PTO payout");
  assert.match(unknown.whatItWouldTake, /contractual hourly rate/);
  assert.match(
    unknown.whatItWouldTake,
    /cannot be sourced by reading harder/,
    "the action is a person supplying a rate, not another read of an endpoint that does not exist"
  );
});

test("a NEGATIVE live balance is refused, never settled at zero", async () => {
  // emp_pl_001 mirrors live record 09b65526: entitlement 10, used 19,
  // balance -9. Live, 4 of the Sandbox's 46 leave policies look like this.
  const r = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_pl_001" },
      employmentId: "emp_pl_001",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: RATE,
      externalRef: "uc05-negative-balance",
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");
  assert.ok(r.flags.includes("pto_missing_daysAvailable"));
  assert.equal(r.payout.totalInRemoteInteger, null);
  assert.equal(r.payout.lines.length, 0, "no partial line may carry a payout for an unreadable balance");

  // DURABLE AND AUDITED. The F-28 rule: a refusal is only a refusal if somebody
  // is told about it.
  const rows = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details.reason, "pto_balance_unusable");
  assert.equal(rows[0].details.externalRef, "uc05-negative-balance");
});

test("a FAILED read is an escalation, not a quiet nil — we asked and got no answer", async () => {
  // The difference this preserves: "no balances were mentioned" settles at
  // nothing and reaches sign-off; "we asked Remote about this employee's
  // accrued leave and it did not answer" is a question for a human.
  const deadRemote = {
    getEmployment: (id) => remote.getEmployment(id),
    listLeavePolicySummary: async () => null, // the client's documented 404 answer
  };
  const r = await submit({ hourlyRateInRemoteInteger: RATE }, { remote: deadRemote });

  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "pto_balance_unusable");
  assert.equal(r.ptoSource, "remote_leave_policy_summary_unreadable");

  const [row] = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(row.details.ptoUpstreamFailure.call, "leave_policy_summary");
  assert.equal(row.details.ptoUpstreamFailure.kind, "not_found");
  assert.equal(row.details.ptoUpstreamFailure.status, 404);

  const basis = describeSignoffBasis({ resignationRow: await resignationStore.findById(r.resignationId) });
  assert.match(basis.payout.sentence, /could not be read from Remote at all/);
  assert.match(basis.payout.sentence, /not a finding that\s+no leave is owed/);
});

test("a THROWING read is reported as unreachable, and the request is still recorded", async () => {
  // The read sits upstream of the audit write. A throw here loses a resignation
  // with no record that anyone filed one — finding F-28's exact shape.
  const angryRemote = {
    getEmployment: (id) => remote.getEmployment(id),
    listLeavePolicySummary: async () => {
      throw new Error("Remote API /v1/leave-policies/summary/x failed: 503");
    },
  };
  const r = await submit({ hourlyRateInRemoteInteger: RATE, externalRef: "uc05-503" }, { remote: angryRemote });

  assert.equal(r.decision, "escalate");
  const [row] = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(row.details.ptoUpstreamFailure.kind, "unreachable");
  assert.equal(row.details.ptoUpstreamFailure.status, null, "a 503 says nothing about this employee's leave");
  assert.equal(row.details.externalRef, "uc05-503");
});

// ---------------------------------------------------------------------------
// PRECEDENCE — what the read must NOT do
// ---------------------------------------------------------------------------

test("balances the caller supplied are used unchanged — the read never overrides a stated figure", async () => {
  // The portal form holds its own numbers. A read that silently replaced them
  // would make the form a lie about what was decided.
  const r = await submit({
    timeOffBalances: [{ timeOffType: "vacation", daysAccrued: 5, daysUsed: 2, hourlyRateInRemoteInteger: 5000 }],
  });
  assert.equal(r.ptoSource, "caller_supplied");
  assert.equal(r.payout.lines[0].daysAvailable, 3);
  assert.equal(r.payout.totalInRemoteInteger, 3 * 8 * 5000);
  assert.equal(r.decision, "prepared_for_signoff");
});

test("a client with no Time Off method behaves exactly as it did before the read existed", async () => {
  // Every hand-built fake `remote` in the suite lands here. Wiring the read
  // must not turn each of them into an escalation for a capability they were
  // never asked to have.
  const oldRemote = { getEmployment: (id) => remote.getEmployment(id) };
  const r = await submit({}, { remote: oldRemote });
  assert.equal(r.ptoSource, "not_read");
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.payout.source, "no_time_off_records");

  const basis = describeSignoffBasis({ resignationRow: await resignationStore.findById(r.resignationId) });
  assert.match(basis.payout.sentence, /not a finding that nothing is owed/);
});

test("an employment with genuinely no leave policies is a confirmed nil, not a failed read", async () => {
  const r = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_active_003" },
      employmentId: "emp_active_003",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.ptoSource, "remote_leave_policy_summary");
  // The country gate owns this record's decision (NG is not in the statutory
  // notice table), which is fine — what is asserted here is that the READ
  // succeeded and produced an empty balance list rather than a failure.
  assert.equal(r.payout, null);
  const [row] = audit.entries.filter((e) => e.useCase === "UC-05");
  assert.equal(row.details.ptoUpstreamFailure, null);
});

test("an UNLIMITED-PTO policy is refused, never settled at the zero its balance reports", async () => {
  // emp_unsupported_country_001 mirrors live employment 7b769e51: the
  // entitlement is `{type: "unlimited"}` with no `days` key, while `balance` is
  // an ordinary `limited` ZERO. Reading `balance` alone turns "how many days
  // does an unlimited scheme owe on termination" — a statutory question this
  // repo does not hold an answer to — into a confident 0.00 final settlement.
  const rows = await remote.listLeavePolicySummary("emp_unsupported_country_001");
  assert.deepEqual(rows[0].annual_entitlement, { type: "unlimited" }, "fixture precondition");
  assert.equal(rows[0].balance.days, 0, "and its balance really does report a plain zero");

  const balances = normalizeLeaveBalances(rows);
  assert.equal(balances[0].daysAvailable, null);
  assert.equal(balances[0].unavailable, "unlimited_balance");

  const payout = reconcilePtoPayout({ balances, currency: "USD" });
  assert.equal(payout.computable, false);
  assert.equal(payout.totalInRemoteInteger, null, "an unanswerable question, not a payout of zero");
  assert.equal(payout.unusableLines[0].reason, "unlimited_balance");
  assert.ok(payout.unusableLines[0].missing.includes("daysAvailable"));
});

test("an HOURS-UNIT policy still resolves through the same {days, hours} pair", async () => {
  // Live, `leave_policy.unit` reads "hours" on the Italian ex_festivita/rol
  // entitlements — and those rows express their balance exactly like every
  // other: 1 day 5 hours = 1.625 days at this row's own 8 hours a day.
  const r = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_de_probation_001" },
      employmentId: "emp_de_probation_001",
      proposedEndDate: "2026-12-31",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: RATE,
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
  assert.equal(r.decision, "prepared_for_signoff");
  assert.equal(r.payout.lines[0].timeOffType, "ex_festivita");
  assert.equal(r.payout.lines[0].daysAvailable, 1.625);
  assert.equal(r.payout.totalInRemoteInteger, 1.625 * 8 * RATE);
});
