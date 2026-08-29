// ---------------------------------------------------------------------------
// remotePayrollMoney.test.js — a documented `integer` that arrives as a quoted
// string, on the money path
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS. `GET /v1/payroll-runs` documents `total_payroll_cost`
// as `"type": "integer"` and returns `"total_payroll_cost": "15103469"` — a
// string [CONFIRMED live 2026-08-19, same token, same container].
//
// There is no consumer today, and that is exactly why the boundary is the
// place to fix it. `src/shared/money.js` refuses a string BY DESIGN
// (`fromRemoteInteger("15103469")` throws), and that refusal is correct — it
// is the ×100 invariant working. What it does not do is tell the next
// developer where the fix belongs, and the cheapest-looking repair at the call
// site is `Number(x)` sitting next to somebody's arithmetic: a second copy of
// the money convention, which is the one thing money.js exists to prevent.
//
// So the parse lives in money.js, the client applies it once, and nothing
// downstream ever sees a money value whose type depends on which endpoint
// answered.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { RemoteClient, normalizePayrollRun } from "../src/remote/restClient.js";
import { parseRemoteMinorUnits, fromRemoteInteger, formatMoney } from "../src/shared/money.js";
import { startMockServer } from "../src/remote/mockServer.js";

// One live row, verbatim (2026-08-19). Note the string.
const LIVE_RUN = {
  id: "60855884-dc15-4371-ad8f-5610c3dcd317",
  status: "completed",
  type: "main",
  country: { code: "SGP", name: "Singapore", alpha_2_code: "SG" },
  currency_code: "SGD",
  period_end: "2026-04-26",
  period_start: "2026-04-01",
  cutoff_date: "2026-04-06",
  expected_payout_date: "2026-04-26",
  approval_date: "2026-04-17",
  total_payroll_cost: "15103469",
};

test("POSITIVE: the live string becomes an integer money.js will actually accept", () => {
  const run = normalizePayrollRun(LIVE_RUN);

  assert.equal(run.total_payroll_cost, 15103469);
  assert.equal(typeof run.total_payroll_cost, "number");
  assert.equal(run.total_payroll_cost_raw, "15103469", "the original is kept, so a null stays attributable");

  // The whole point, stated as the thing a consumer does: this used to throw.
  assert.equal(fromRemoteInteger(run.total_payroll_cost), 151034.69);
  assert.equal(formatMoney(run.total_payroll_cost, run.currency_code), "151,034.69 SGD");
  assert.throws(() => fromRemoteInteger(LIVE_RUN.total_payroll_cost), TypeError, "…and it still throws on the raw string");

  // Every other field survives untouched.
  assert.equal(run.cutoff_date, "2026-04-06");
  assert.equal(run.country.alpha_2_code, "SG");
});

test("an unreadable amount is NULL, and null is never zero", () => {
  for (const bad of ["", "  ", "n/a", "1.5", "1e3", "0x10", null, undefined, {}, []]) {
    const run = normalizePayrollRun({ ...LIVE_RUN, total_payroll_cost: bad });
    assert.equal(run.total_payroll_cost, null, `${JSON.stringify(bad)} must not become a number`);
    assert.notEqual(run.total_payroll_cost, 0, "`Number(\"\")` is 0 — the most dangerous coercion there is for money");
  }
  // A genuine zero is still a zero, so the null does not swallow a real value.
  assert.equal(normalizePayrollRun({ total_payroll_cost: "0" }).total_payroll_cost, 0);
});

test("parseRemoteMinorUnits refuses everything Number() would have accepted", () => {
  assert.equal(parseRemoteMinorUnits("15103469"), 15103469);
  assert.equal(parseRemoteMinorUnits(15103469), 15103469);
  assert.equal(parseRemoteMinorUnits("-500"), -500, "a correction can be negative");
  assert.equal(parseRemoteMinorUnits(" 42 "), 42, "surrounding whitespace is transport, not data");

  for (const bad of ["1.5", 1.5, "", " ", "1e3", "0x10", "12,345", "12 345", true, null, [], {}, NaN, Infinity]) {
    assert.equal(parseRemoteMinorUnits(bad), null, `${String(bad)}`);
  }
  // Beyond 2^53-1 a JS number is no longer the value that was sent.
  assert.equal(parseRemoteMinorUnits("9007199254740993"), null);
});

test("the CLIENT applies it — a caller of listPayrollRunsResult never sees the string", async () => {
  const server = await startMockServer(0);
  const { port } = server.address();
  try {
    const client = new RemoteClient({ baseUrl: `http://localhost:${port}` });
    const { payrollRuns, error } = await client.listPayrollRunsResult({ countryCode: "NL" });

    assert.equal(error, null);
    assert.ok(payrollRuns.length > 0, "the mock's Dutch calendar must be readable, or this proves nothing");
    for (const run of payrollRuns) {
      assert.ok(
        run.total_payroll_cost === null || Number.isInteger(run.total_payroll_cost),
        `${run.id}: money leaves this client as an integer or as null, never as a string`
      );
      assert.ok("total_payroll_cost_raw" in run, `${run.id}: the raw value is carried for attribution`);
    }
    // At least one real figure, so this is not passing on an all-null calendar.
    assert.ok(payrollRuns.some((r) => Number.isInteger(r.total_payroll_cost)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the MOCK serves the string the live API serves", async () => {
  const server = await startMockServer(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/v1/payroll-runs?page=1&page_size=100`);
    const rows = (await res.json()).data.payroll_runs;
    const withCost = rows.filter((r) => r.total_payroll_cost !== null && r.total_payroll_cost !== undefined);
    assert.ok(withCost.length > 0);
    for (const row of withCost) {
      assert.equal(
        typeof row.total_payroll_cost,
        "string",
        `${row.id}: live sends a quoted string here; a mock that sends a number hides the whole defect`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("normalizePayrollRun is a no-op on anything that is not a row", () => {
  assert.equal(normalizePayrollRun(null), null);
  assert.equal(normalizePayrollRun(undefined), undefined);
  assert.equal(normalizePayrollRun("nonsense"), "nonsense");
});
