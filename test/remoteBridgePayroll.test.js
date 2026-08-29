// ---------------------------------------------------------------------------
// remoteBridgePayroll.test.js  —  the projected payroll calendar
// ---------------------------------------------------------------------------
// The Sandbox's payroll calendar stopped in mid-2026, so every future effective
// date reaches `noMatchingCycle` and UC-06 can only ever be demonstrated
// refusing. The stand-in continues each country's own cadence past its last
// real cycle so the APPROVAL half is reachable too.
//
// That is a dangerous kind of help, so the tests below are mostly about what it
// must NOT do: never touch a real row, never project into a period the real
// calendar already covers, never invent money, and never continue a one-off as
// if it were a cadence.
//
// And one of them is the opposite shape on purpose. This project has been
// bitten repeatedly by gates that could only refuse — a use case that
// structurally cannot succeed is indistinguishable from one being appropriately
// cautious, and no amount of fail-closed testing tells them apart. So the last
// test asserts a September amendment MUST find a cycle with a live cutoff.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectPayrollCalendar,
  measureStreams,
  coverageFrontier,
} from "../src/remotebridge/payrollProjection.js";
import { evaluateCutoff } from "../src/uc06/cutoffEngine.js";
import { createBridge } from "../src/remotebridge/server.js";

const US = { code: "USA", name: "United States", alpha_2_code: "US" };
const SG = { code: "SGP", name: "Singapore", alpha_2_code: "SG" };
const NL = { code: "NLD", name: "Netherlands", alpha_2_code: "NL" };

// Mirrors the live shape audited 2026-08-18: US pays on period_end with a +19d
// cutoff, SG ends mid-month and pays BEFORE period_end, NL carries a one_off
// run that reaches a month further than its own main stream.
const REAL = [
  { id: "us-05", status: "completed", type: "main", country: US, currency_code: "USD", period_start: "2026-05-01", period_end: "2026-05-31", cutoff_date: "2026-05-20", expected_payout_date: "2026-05-31", approval_date: "2026-05-26", total_payroll_cost: "15103469" },
  { id: "us-06", status: "processing", type: "main", country: US, currency_code: "USD", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-20", expected_payout_date: "2026-06-30", approval_date: "2026-06-25", total_payroll_cost: "15220100" },
  { id: "sg-06", status: "completed", type: "main", country: SG, currency_code: "SGD", period_start: "2026-06-01", period_end: "2026-06-26", cutoff_date: "2026-06-06", expected_payout_date: "2026-06-22", approval_date: "2026-06-17", total_payroll_cost: "9000000" },
  { id: "nl-06", status: "processing", type: "main", country: NL, currency_code: "EUR", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-20", expected_payout_date: "2026-06-30", approval_date: "2026-06-25", total_payroll_cost: "7000000" },
  { id: "nl-07-oneoff", status: "preparing", type: "one_off", country: NL, currency_code: "EUR", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10", expected_payout_date: "2026-07-25", approval_date: null, total_payroll_cost: null },
];

const NOW = new Date("2026-08-18T12:00:00Z");
const project = (cycles = REAL, opts = {}) =>
  projectPayrollCalendar(cycles, { now: NOW, horizonMonths: 6, ...opts });

test("no real cycle is modified, dropped or reordered", () => {
  const before = JSON.stringify(REAL);
  const { projected } = project();
  assert.equal(JSON.stringify(REAL), before, "the caller's rows must not be mutated");
  for (const row of projected) {
    assert.ok(row.id.startsWith("standin-"), `projected rows must be self-identifying: ${row.id}`);
  }
  const realIds = new Set(REAL.map((r) => r.id));
  assert.ok(projected.every((p) => !realIds.has(p.id)), "a projection must never collide with a real id");
});

test("only periods AFTER a country's last real period_end are projected", () => {
  const { projected } = project();
  const frontier = coverageFrontier(REAL);

  for (const row of projected) {
    const startMs = Date.parse(`${row.period_start}T00:00:00Z`);
    const edge = frontier.get(row.country.alpha_2_code);
    assert.ok(startMs > edge, `${row.id} starts ${row.period_start}, at or before the real frontier`);
  }

  // NL's frontier is set by its one_off July run, so NL resumes in AUGUST even
  // though its own main stream stops in June. Projecting NL July would have
  // manufactured a second cycle over a period Remote already describes.
  const nlMonths = projected.filter((p) => p.country.alpha_2_code === "NL").map((p) => p.period_start);
  assert.ok(!nlMonths.includes("2026-07-01"), "NL July is already covered by a real one_off run");
  assert.ok(nlMonths.includes("2026-08-01"), "NL should resume the month after its real frontier");
});

test("a one_off run is never continued as a cadence", () => {
  const { projected, notes } = project();
  assert.ok(projected.every((p) => p.type === "main"), "only main streams may be projected");
  assert.ok(
    notes.some((n) => n.includes("one_off") && n.includes("not projected")),
    "the refusal to project a one-off must be stated, not silent"
  );
});

test("never invents money or an approval that has not happened", () => {
  const { projected } = project();
  assert.ok(projected.length > 0);
  for (const row of projected) {
    assert.equal(row.total_payroll_cost, null, `${row.id} must not carry an invented payroll cost`);
    assert.equal(row.approval_date, null, `${row.id} must not claim an approval`);
  }
});

test("the payout anchor is measured per country, not assumed", () => {
  const { projected } = project();
  // US pays on period_end live, so a projected US cycle must pay on the last
  // day of its own month — not period_start + 29 days, which walks off
  // month-end and would have paid July on the 30th.
  const usSep = projected.find((p) => p.id === "standin-us-2026-09");
  assert.equal(usSep.period_end, "2026-09-30");
  assert.equal(usSep.expected_payout_date, "2026-09-30");

  // SG genuinely pays before its period ends, so its offset must be preserved
  // rather than snapped to period_end.
  const sgSep = projected.find((p) => p.id === "standin-sg-2026-09");
  assert.equal(sgSep.period_end, "2026-09-26");
  assert.equal(sgSep.expected_payout_date, "2026-09-22");
  assert.notEqual(sgSep.expected_payout_date, sgSep.period_end);
});

test("the cutoff offset is the one the country actually uses", () => {
  const { projected } = project();
  assert.equal(projected.find((p) => p.id === "standin-us-2026-09").cutoff_date, "2026-09-20"); // +19d
  assert.equal(projected.find((p) => p.id === "standin-sg-2026-09").cutoff_date, "2026-09-06"); // +5d
});

test("a horizon of 0 disables projection entirely", () => {
  const { projected } = project(REAL, { horizonMonths: 0 });
  assert.deepEqual(projected, [], "horizon 0 must reproduce the raw Sandbox calendar");
});

test("streams are measured from each country's most recent real cycle", () => {
  const streams = measureStreams(REAL);
  assert.equal(streams.get("US|main").cycle.id, "us-06", "the LATEST US cycle sets the cadence");
  assert.equal(streams.get("US|main").cutoffOffsetDays, 19);
  assert.equal(streams.get("SG|main").cutoffOffsetDays, 5);
});

// ---------------------------------------------------------------------------
// The positive test. Everything above proves the stand-in is restrained; this
// one proves it is USEFUL — that UC-06's approval path is reachable at all.
// ---------------------------------------------------------------------------
test("POSITIVE: a September amendment finds a live cutoff once the calendar is continued", () => {
  const effective = "2026-09-15";

  const raw = evaluateCutoff({ requestedEffectiveDate: effective, now: NOW, payrollCycles: REAL });
  assert.equal(raw.noMatchingCycle, true, "against the raw Sandbox calendar this MUST refuse — that is the contrast take");

  const { projected } = project();
  const usCalendar = [...REAL, ...projected].filter((c) => c.country.alpha_2_code === "US");
  const withStandin = evaluateCutoff({ requestedEffectiveDate: effective, now: NOW, payrollCycles: usCalendar });

  assert.equal(withStandin.noMatchingCycle, false, "a cycle must now cover the date");
  assert.equal(withStandin.cutoffAlreadyPassed, false, "its lock must still be in the future");
  assert.equal(withStandin.cutoffUnknown, false);
  assert.equal(withStandin.cycle.cutoff_date, "2026-09-20");
  assert.ok(withStandin.hoursUntilCutoff > 48, "and comfortably outside the urgent window");
});

test("POSITIVE: the same continued calendar still refuses a cycle whose lock has passed", () => {
  const { projected } = project();
  const usCalendar = [...REAL, ...projected].filter((c) => c.country.alpha_2_code === "US");
  // 2026-08-25 sits in the projected August cycle, whose cutoff (08-20) is
  // already behind NOW (08-18)... it is not. It is two days ahead, which is the
  // urgent window — a third distinct state, and the one hardest to stage.
  const urgent = evaluateCutoff({ requestedEffectiveDate: "2026-08-25", now: NOW, payrollCycles: usCalendar });
  assert.equal(urgent.noMatchingCycle, false);
  assert.equal(urgent.cutoffAlreadyPassed, false);
  assert.equal(urgent.urgentWithin48h, true, "48h from the lock is its own decision path");

  // And a real June date still lands on the real June cycle, lock long gone.
  const past = evaluateCutoff({ requestedEffectiveDate: "2026-06-15", now: NOW, payrollCycles: usCalendar });
  assert.equal(past.cycle.id, "us-06", "a real cycle must still win where one exists");
  assert.equal(past.cutoffAlreadyPassed, true);
});

// ---------------------------------------------------------------------------
// Through the HTTP surface.
// ---------------------------------------------------------------------------
function fakePayrollFetch(rows) {
  return async () =>
    new Response(JSON.stringify({ data: { payroll_runs: rows } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

async function withBridge(opts, fn) {
  const server = createBridge({ quiet: true, clock: () => NOW, ...opts });
  await new Promise((r) => server.listen(0, r));
  try {
    return await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("the bridge discloses every projected cycle in the header and the body", async () => {
  await withBridge({ fetchImpl: fakePayrollFetch(REAL), projectionHorizonMonths: 6 }, async (base) => {
    const res = await fetch(`${base}/v1/payroll-runs?page=1&page_size=100`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(Number(res.headers.get("x-standin-projected-cycles")) > 0);
    assert.ok(body._standin.note.includes("standin-"), "the note must name the id prefix a reader will see");
    assert.equal(body._standin.realCycleCount, REAL.length);
    assert.ok(body._standin.projectedCycleIds.length > 0);

    const returned = body.data.payroll_runs;
    for (const real of REAL) {
      assert.deepEqual(returned.find((r) => r.id === real.id), real, `${real.id} must come back byte-identical`);
    }
  });
});

test("an EMPTY page stays empty, so the client's pager still terminates", async () => {
  // RemoteClient.listPayrollRuns() loops until it sees an empty page. Appending
  // projections to one would make every call run to its 50-page ceiling.
  await withBridge({ fetchImpl: fakePayrollFetch([]), projectionHorizonMonths: 6 }, async (base) => {
    const body = await (await fetch(`${base}/v1/payroll-runs?page=2&page_size=100`)).json();
    assert.deepEqual(body.data.payroll_runs, [], "an empty page must be passed through untouched");
    assert.equal(body._standin, undefined, "and must not be dressed up as enriched");
  });
});

test("the payroll route still refuses writes", async () => {
  await withBridge({ fetchImpl: fakePayrollFetch(REAL) }, async (base) => {
    const res = await fetch(`${base}/v1/payroll-runs`, { method: "POST" });
    assert.equal(res.status, 405, "a stand-in that accepted writes could fake a payroll state change");
  });
});
