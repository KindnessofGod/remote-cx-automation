// ---------------------------------------------------------------------------
// remoteLeaveBalances.test.js  —  the Time Off read, and the two traps in it
// ---------------------------------------------------------------------------
// UC-05.md §7 has promised "accrued PTO payout reconciliation from Time Off
// API" since the spec was written. Until `src/remote/leaveBalances.js`,
// `grep -rn "leave-policies\|timeoff-balances" src/` returned no consumer at
// all — so the days multiplied into a resignation settlement were whatever the
// requester typed into a form.
//
// EVERY EXPECTED VALUE BELOW IS A LIVE VALUE. The payloads are copied from
// `GET /v1/leave-policies/summary/{employment_id}` on gateway.remote-sandbox.com,
// read 2026-08-19 across all 112 Sandbox employments (46 leave policies). They
// are not composed to make the code look right — which is the failure mode this
// whole area of the repo has paid for twice (F-27's `country_code`, the payroll
// calendar's `process_date`).
//
// THE TWO ASSERTIONS THAT MATTER MOST ARE BOTH ABOUT MONEY IN THE SAME ROW:
//   - `balance` must be READ, not recomputed. On the live record mirrored here,
//     `annual_entitlement - used` is 25 days and `balance` is 13.75. Deriving
//     it overpays by 11.25 days while every internal check still agrees.
//   - `days` and `hours` are components of ONE quantity. Reading `days` alone
//     turns 13.75 into 13 — an underpayment, quiet, and in the employer's
//     favour.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  quantityToDays,
  normalizeLeaveBalances,
  LEAVE_BALANCE_SOURCE,
  UNAVAILABLE_UNLIMITED,
  UNAVAILABLE_NO_DAYS,
  UNAVAILABLE_NO_HOURS_PER_DAY,
} from "../src/remote/leaveBalances.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer, LEAVE_POLICY_SUMMARIES } from "../src/remote/mockServer.js";

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

/**
 * The live row for Sandbox employment 33db8dbb, copied verbatim. Its numbers
 * are the whole argument of this file: 30 days entitled for the year, 5 used,
 * 18d 6h accrued so far, 13d 6h left.
 */
const LIVE_ROW = {
  used: { type: "limited", hours: 0, days: 5 },
  balance: { type: "limited", hours: 6, days: 13 },
  taken: { type: "limited", hours: 0, days: 5 },
  leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
  upcoming_requested: { type: "limited", hours: 0, days: 0 },
  upcoming_approved: { type: "limited", hours: 0, days: 0 },
  pending_approval: { type: "limited", hours: 0, days: 0 },
  current_entitlement: { type: "limited", hours: 6, days: 18 },
  booked: { type: "limited", hours: 0, days: 0 },
  annual_entitlement: { type: "limited", hours: 0, days: 30 },
  annual_balance: { type: "limited", hours: 0, days: 25 },
  working_hours_per_day: 8,
};

// ---------------------------------------------------------------------------
// quantityToDays — days and hours are ONE quantity
// ---------------------------------------------------------------------------

test("a day/hour pair is one quantity, folded at the row's own working_hours_per_day", () => {
  assert.deepEqual(quantityToDays({ type: "limited", hours: 6, days: 13 }, 8), { days: 13.75, unavailable: null });
  assert.deepEqual(quantityToDays({ type: "limited", hours: 4, days: 5 }, 8), { days: 5.5, unavailable: null });
});

test("an hours remainder is never truncated away — with no hours-per-day the line is REFUSED", () => {
  // Truncating to 13 whole days is an underpayment that nothing downstream can
  // see: 13 is a plausible number, and no gate fires on a plausible number.
  const truncated = quantityToDays({ type: "limited", hours: 6, days: 13 }, null);
  assert.equal(truncated.days, null);
  assert.equal(truncated.unavailable, UNAVAILABLE_NO_HOURS_PER_DAY);
  assert.notEqual(truncated.days, 13, "the whole point: it must not silently become 13");
});

test("a zero hours remainder needs no conversion, so a missing hours-per-day is not fatal", () => {
  assert.deepEqual(quantityToDays({ type: "limited", hours: 0, days: 12 }, undefined), {
    days: 12,
    unavailable: null,
  });
});

test("an UNLIMITED balance has no number to pay out, and is refused rather than read as zero", () => {
  // The schema permits this shape; no live instance exists (all 46 policies
  // read "limited"). Asserted with an explicit literal for exactly that reason
  // — putting an unlimited row into the mock would be serving a payload Remote
  // has never sent.
  const q = quantityToDays({ type: "unlimited" }, 8);
  assert.equal(q.days, null);
  assert.equal(q.unavailable, UNAVAILABLE_UNLIMITED);
});

test("a missing days key is an absence, not a zero", () => {
  assert.deepEqual(quantityToDays({ type: "limited", hours: 0 }, 8), { days: null, unavailable: UNAVAILABLE_NO_DAYS });
  assert.deepEqual(quantityToDays(null, 8), { days: null, unavailable: UNAVAILABLE_NO_DAYS });
});

test("a NEGATIVE balance is carried through as negative, so the reconciler can refuse it", () => {
  // Live, 4 of the 46 leave policies carry one — an employee who has taken more
  // leave than has accrued. Clamping it here would rebuild finding F-33 one
  // layer upstream of the guard that exists for it.
  assert.deepEqual(quantityToDays({ type: "limited", hours: 0, days: -9 }, 8), { days: -9, unavailable: null });
});

// ---------------------------------------------------------------------------
// normalizeLeaveBalances — the payout base is READ, never recomputed
// ---------------------------------------------------------------------------

test("THE PAYOUT BASE IS `balance` — never annual_entitlement minus used", () => {
  const [line] = normalizeLeaveBalances([LIVE_ROW]);
  assert.equal(line.daysAvailable, 13.75);

  // The figure a plausible-looking reconciliation would have produced instead.
  const derived = LIVE_ROW.annual_entitlement.days - LIVE_ROW.used.days;
  assert.equal(derived, 25, "fixture precondition: the two really do disagree on this record");
  assert.notEqual(line.daysAvailable, derived, "25 days would be an 11.25-day overpayment on one employee");

  // `annual_balance` is the field that IS the derived remainder. Named here so
  // the next person to look for it does not rediscover the trap.
  assert.equal(LIVE_ROW.annual_balance.days, derived);
});

test("the components are carried as context, so a specialist can see what was NOT used as the base", () => {
  const [line] = normalizeLeaveBalances([LIVE_ROW]);
  assert.deepEqual(line.reportedByRemote, {
    balanceDays: 13,
    balanceHours: 6,
    usedDays: 5,
    takenDays: 5,
    currentEntitlementDays: 18,
    annualEntitlementDays: 30,
    annualBalanceDays: 25,
  });
});

test("the line's identity is the stable leave_type, not the localised display name", () => {
  // Live, the French records call the same policy "Congés N". A display label
  // is not an identifier, and keying anything on one makes a use case behave
  // differently per locale.
  const [line] = normalizeLeaveBalances([
    { ...LIVE_ROW, leave_policy: { name: "Congés N", unit: "days", description: null, leave_type: "paid_time_off" } },
  ]);
  assert.equal(line.timeOffType, "paid_time_off");
  assert.equal(line.policyName, "Congés N");
});

test("every line is tagged with where its days came from", () => {
  const [line] = normalizeLeaveBalances([LIVE_ROW]);
  assert.equal(line.source, LEAVE_BALANCE_SOURCE);
  assert.equal(line.workingHoursPerDay, 8);
});

test("NO RATE IS EVER INVENTED — a line carries one only when a caller supplies it", () => {
  const [bare] = normalizeLeaveBalances([LIVE_ROW]);
  assert.equal("hourlyRateInRemoteInteger" in bare, false, "Remote publishes no pay rate on any endpoint");

  const [rated] = normalizeLeaveBalances([LIVE_ROW], { hourlyRateInRemoteInteger: 4000 });
  assert.equal(rated.hourlyRateInRemoteInteger, 4000);

  // A non-integer is not a rate. Silently accepting "4000" is how a 100x
  // scaling error gets in (the reasoning behind UC-09's finding F-05).
  const [quoted] = normalizeLeaveBalances([LIVE_ROW], { hourlyRateInRemoteInteger: "4000" });
  assert.equal("hourlyRateInRemoteInteger" in quoted, false);
});

test("an unreadable payload is NULL, not an empty balance list", () => {
  // "This employee has no leave policies" and "we never read their leave
  // policies" are opposite facts. Coercing the second into the first is what
  // lets a settlement quietly report nothing owed.
  for (const bad of [null, undefined, "", 0, { data: [] }, { error: "nope" }]) {
    assert.equal(normalizeLeaveBalances(bad), null, `input ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(normalizeLeaveBalances([]), [], "an empty ARRAY is a real answer and stays one");
});

// ---------------------------------------------------------------------------
// RemoteClient.listLeavePolicySummary — and the mock's fidelity to the API
// ---------------------------------------------------------------------------

test("listLeavePolicySummary returns the rows for a known employment", async () => {
  const rows = await remote.listLeavePolicySummary("emp_uk_001");
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].leave_policy.leave_type, "paid_time_off");
  assert.deepEqual(rows[0].balance, { type: "limited", hours: 6, days: 13 });
});

test("listLeavePolicySummary answers NULL on a 404 — an unread balance, not an empty one", async () => {
  assert.equal(await remote.listLeavePolicySummary("emp_does_not_exist"), null);
});

test("an employment with no leave policies answers with an empty ARRAY, which is a real answer", async () => {
  assert.deepEqual(await remote.listLeavePolicySummary("emp_active_003"), []);
});

test("the mock serves the array DIRECTLY under `data` — the live envelope, checked over raw HTTP", async () => {
  // The same class of check test/remoteShapeFidelity.test.js runs on
  // /v1/countries, and for the same reason: the countries fixture invented a
  // `{data: {countries: […]}}` envelope, the client tolerated it, and UC-03
  // could not succeed in production for the life of the project.
  const res = await fetch(`${baseUrl}/v1/leave-policies/summary/emp_uk_001`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.data), "the array sits directly under `data`");
  assert.equal("leave_policies" in body, false);
  assert.equal(Array.isArray(body.data) && "leave_policies" in body.data, false);
});

test("no fixture row carries a key the live endpoint has never sent", () => {
  // A mock may serve a SUBSET of the real keys; it may never serve a key the
  // real API does not have. That asymmetry is the whole contract of a mock —
  // "swap the base URL and nothing else changes".
  const LIVE_ROW_KEYS = new Set(Object.keys(LIVE_ROW));
  const LIVE_QUANTITY_KEYS = new Set(["type", "hours", "days"]);
  const LIVE_POLICY_KEYS = new Set(["name", "unit", "description", "leave_type"]);

  for (const [employmentId, rows] of Object.entries(LEAVE_POLICY_SUMMARIES)) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        assert.ok(LIVE_ROW_KEYS.has(key), `${employmentId}: unknown row key ${key}`);
      }
      for (const key of Object.keys(row.leave_policy)) {
        assert.ok(LIVE_POLICY_KEYS.has(key), `${employmentId}: unknown leave_policy key ${key}`);
      }
      for (const [key, value] of Object.entries(row)) {
        if (key === "leave_policy" || key === "working_hours_per_day") continue;
        for (const qKey of Object.keys(value)) {
          assert.ok(LIVE_QUANTITY_KEYS.has(qKey), `${employmentId}.${key}: unknown quantity key ${qKey}`);
        }
        assert.ok(
          value.type === "limited" || value.type === "unlimited",
          `${employmentId}.${key}: live, a quantity's type is "limited" (116 policies) or "unlimited" (one, 7b769e51)`
        );
        if (value.type === "unlimited") {
          assert.deepEqual(Object.keys(value), ["type"], "the live unlimited quantity carries NO days and NO hours");
        }
      }
    }
  }
});

test("the fixture set reproduces the live traps rather than a tidy version of them", () => {
  // A fixture that only carries whole days and non-negative balances tests a
  // world that does not exist. Both properties are asserted so that "simplify
  // the fixtures" cannot quietly remove the cases the code exists for.
  const allRows = Object.values(LEAVE_POLICY_SUMMARIES).flat();
  assert.ok(
    allRows.some((r) => r.balance.hours !== 0),
    "at least one fixture must carry an hours remainder"
  );
  assert.ok(
    allRows.some((r) => r.balance.days < 0),
    "at least one fixture must carry a negative balance — live, 4 of 46 policies do"
  );
  assert.ok(
    allRows.some((r) => r.annual_entitlement.days - r.used.days !== r.balance.days),
    "at least one fixture must be one where recomputing the base gives the WRONG answer"
  );
  assert.ok(
    allRows.some((r) => r.annual_entitlement.type === "unlimited"),
    "at least one fixture must be the unlimited-PTO shape — live employment 7b769e51 really is one"
  );
  assert.ok(
    allRows.some((r) => r.leave_policy.unit === "hours"),
    "at least one fixture must carry an hours-unit policy — live, 4 of 117 do"
  );
});
