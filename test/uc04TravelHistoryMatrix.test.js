// ---------------------------------------------------------------------------
// uc04TravelHistoryMatrix.test.js
//
// The standing guard on docs/DEMO-COUNTRIES.md §8 — the travel-history matrix
// that exercises UC-04's day arithmetic (the Schengen 90/180 peak measured per
// day of stay, the 183-in-365 residency watch, the union-not-sum overlap rule,
// and the refusal on a stay that cannot be read).
//
// WHY IT EXISTS. §8 publishes a figure per scenario, and every one of them was
// OBSERVED by running scripts/uc04-travel-history-matrix.mjs. An observation is
// only worth writing down if it stays true: a change to the window, the union
// rule or the refusal would make the document false, and the first person to
// find out would be whoever is filming a demo against it. This is the same
// standing-guard pattern test/uc04.test.js's "D3 DEMO GUARD" established for
// §3's rows.
//
// It pins the ARITHMETIC half only, and is hermetic: pure functions, no
// network, no employment record. The decision half needs a live Sandbox
// employment and lives in the script, which must never be imported by
// `npm test` (CLAUDE.md §6).
//
// The inputs are RESTATED here rather than imported from the script, for the
// same reason the script must not be imported: a test that reaches the network
// to find out what it should assert is not a test. Restating them is the cost,
// and the figures below are what makes the restatement checkable.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRisk,
  schengenPeakDays,
  computeCumulativeDays,
  tripDurationDays,
  travelHistoryProblems,
  VISA_TYPES,
  JOB_DUTY_CATEGORIES,
} from "../src/uc04/riskMatrix.js";

const BASE = {
  startDate: "2026-09-07",
  endDate: "2026-09-27", // 21 days inclusive
  visaType: VISA_TYPES.schengen_short_stay,
  jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
  now: "2026-08-20",
};

/** CA→NL: inside Schengen, not in DNV_COUNTRIES, so the 90/180 check governs. */
const nl = (travelHistory) =>
  classifyRisk({ ...BASE, homeCountry: "CA", nationality: "CA", destinationCountry: "NL", travelHistory });

/** GB→CA on a work permit: outside Schengen, so only the 183 watch is in play. */
const ca = (travelHistory) =>
  classifyRisk({
    ...BASE,
    homeCountry: "GB",
    nationality: "GB",
    destinationCountry: "CA",
    visaType: VISA_TYPES.work_permit,
    travelHistory,
  });

const H = (startDate, endDate, country = "NL") => ({ country, startDate, endDate });

test("§8 TH-00: no prior stays is a COUNTED floor of zero, not NOT_EVALUATED", () => {
  // Deliberately unlike UC-08's presence calculator, whose empty-list rule is
  // NOT_EVALUATED. A workation request with no prior stays is the ordinary
  // case; refusing it would block every request anyone ever files.
  const r = nl([]);
  assert.equal(r.riskLevel, "low");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.tripDays, 21);
  assert.equal(r.cumulativeDays.status, "COUNTED");
  assert.equal(r.cumulativeDays.days, 0);
  assert.equal(r.cumulativeDays.periodsCounted, 0);
  assert.equal(r.schengen.peakDays, 21);
  assert.equal(r.schengen.peakDate, "2026-09-27");
  assert.equal(r.schengen.window.from, "2026-04-01");
  assert.equal(r.schengen.breached, false);
});

test("§8 TH-01: a real count that changes nothing — 31 of 90, no flag moves", () => {
  const r = nl([H("2026-08-01", "2026-08-10")]);
  assert.equal(r.schengen.peakDays, 31);
  assert.equal(r.cumulativeDays.days, 10);
  assert.equal(r.cumulativeDays.periodsCounted, 1);
  assert.deepEqual(r.flags, []);
  assert.equal(r.riskLevel, "low");
});

test("§8 TH-02/TH-03: 88 of 90 clears and 91 of 90 blocks — both sides of the line", () => {
  const under = nl([H("2026-05-01", "2026-07-06")]); // 67 prior days
  assert.equal(under.schengen.peakDays, 88);
  assert.equal(under.schengen.breached, false);
  assert.equal(under.riskLevel, "low");

  const over = nl([H("2026-05-01", "2026-07-09")]); // 70 prior days
  assert.equal(over.schengen.peakDays, 91);
  assert.equal(over.schengen.breached, true);
  assert.equal(over.riskLevel, "blocked");
  assert.equal(over.reasons[0], "schengen_90_180_exceeded");
  // The figure survives the refusal it caused: dropping it would leave a
  // `schengen_90_180_exceeded` with no evidence behind it.
  assert.equal(over.schengen.peakDate, "2026-09-27");
});

test("§8 TH-04: a 100-day trip breaches on its own days of stay, with no history at all", () => {
  const r = nl([]);
  assert.equal(r.riskLevel, "low", "the 21-day control must clear, or this test proves nothing");
  const long = classifyRisk({
    ...BASE,
    homeCountry: "CA",
    nationality: "CA",
    destinationCountry: "NL",
    endDate: "2026-12-15",
    travelHistory: [],
  });
  assert.equal(long.tripDays, 100);
  assert.equal(long.schengen.peakDays, 100);
  assert.equal(long.schengen.peakDate, "2026-12-15");
  assert.equal(long.riskLevel, "blocked");
  assert.equal(long.reasons[0], "schengen_90_180_exceeded");
});

test("§8 TH-05: the per-day window CLEARS a trip the per-trip window blocked — 61 against 120", () => {
  // The divergence the C-1 fix exists for, end to end. `73920c9` states that
  // for a history ending before the trip starts the per-day peak can never
  // EXCEED the per-trip total; §8 asked whether an input exists where the two
  // reach different VERDICTS, and this is it.
  const history = [H("2026-03-06", "2026-05-04")]; // 60 days
  const factors = {
    ...BASE,
    homeCountry: "CA",
    nationality: "CA",
    destinationCountry: "NL",
    startDate: "2026-09-01",
    endDate: "2026-10-30", // 60 days
    travelHistory: history,
  };
  const r = classifyRisk(factors);
  assert.equal(r.tripDays, 60);
  assert.equal(r.schengen.peakDays, 61);
  assert.equal(r.schengen.peakDate, "2026-09-01");
  assert.equal(r.schengen.window.from, "2026-03-06");
  assert.equal(r.schengen.breached, false);
  assert.equal(r.riskLevel, "low");

  // The old per-trip window, reconstructed: one trailing 180 days anchored at
  // the trip start, prior days plus the whole trip against 90.
  const perTrip = computeCumulativeDays({
    travelHistory: history,
    country: "NL",
    windowStart: "2026-03-05",
    windowEnd: "2026-09-01",
  });
  assert.equal(perTrip.days + 60, 120, "the pre-73920c9 total §8.2 publishes");
  assert.ok(perTrip.days + 60 > 90, "so the old arithmetic blocked a trip the regulation clears");
});

test("§8 TH-06: overlapping stays are a union of 41, not a sum of 63 — and the difference decides", () => {
  const history = [H("2026-05-01", "2026-05-31"), H("2026-05-10", "2026-06-10")];
  assert.equal(tripDurationDays("2026-05-01", "2026-05-31"), 31);
  assert.equal(tripDurationDays("2026-05-10", "2026-06-10"), 32);

  const r = classifyRisk({
    ...BASE,
    homeCountry: "CA",
    nationality: "CA",
    destinationCountry: "NL",
    endDate: "2026-10-21", // 45 days
    travelHistory: history,
  });
  assert.equal(r.tripDays, 45);
  assert.equal(r.cumulativeDays.days, 41, "31 + 32 stated days overlap by 22; 41 are distinct");
  assert.equal(r.cumulativeDays.periodsCounted, 2);
  assert.equal(r.schengen.peakDays, 86);
  assert.equal(r.schengen.breached, false);
  assert.equal(r.riskLevel, "low");
  // 63 summed + 45 = 108, which is the verdict the pre-fix arithmetic reached.
  assert.ok(31 + 32 + 45 > 90, "the sum this row exists to disprove would have blocked it");
});

test("§8 TH-07/TH-08: the 180-day boundary, and a peak that lands MID-TRIP", () => {
  const inside = nl([H("2026-04-01", "2026-04-10")]);
  assert.equal(inside.schengen.peakDays, 31);
  assert.equal(inside.schengen.peakDate, "2026-09-27");
  assert.equal(inside.schengen.window.from, "2026-04-01");

  const outside = nl([H("2026-03-22", "2026-03-31")]);
  assert.equal(outside.schengen.peakDays, 21, "ten days that no peaking window can reach");
  // The interesting half: the peak is NOT the trip's last day. The stay is in
  // the window early in the trip and out of it by the end, so the count
  // plateaus and the FIRST day reaching the maximum is mid-trip. A
  // start-anchored window cannot produce this row at all.
  assert.equal(outside.schengen.peakDate, "2026-09-17");
  assert.equal(outside.schengen.window.from, "2026-03-22");
  // Same stay, still fully inside the 365-day residency window.
  assert.equal(outside.cumulativeDays.days, 10);
});

test("§8 TH-09/TH-10: the 183-in-365 watch fires at 184 and not at 183", () => {
  const at = ca([H("2026-01-20", "2026-06-30", "CA")]); // 162 prior days
  assert.equal(at.cumulativeDays.days, 162);
  assert.equal(at.cumulativeDays.days + at.tripDays, 183);
  assert.ok(!at.flags.includes("tax_residency_watch"), "183 is not > 183");
  assert.equal(at.riskLevel, "low");
  assert.equal(at.schengen, null, "Canada is outside Schengen; no allowance governed this trip");

  const over = ca([H("2026-01-19", "2026-06-30", "CA")]); // 163 prior days
  assert.equal(over.cumulativeDays.days + over.tripDays, 184);
  assert.ok(over.flags.includes("tax_residency_watch"));
  assert.equal(over.riskLevel, "medium", "a watch is a finding for the specialist, not a refusal");
  assert.deepEqual(over.reasons, [], "and it must never become a reason");
});

test("§8 TH-11/12/13: three unreadable shapes, each refused and each NAMING its row", () => {
  const cases = [
    {
      id: "TH-11",
      history: [H("2026-03-01", "2026-07-01"), H("2026-05-01", "")],
      problem: 'prior stay 2: unreadable dates "2026-05-01" → ""',
    },
    {
      id: "TH-12",
      history: [H("2026-07-01", "2026-03-01")],
      problem: "prior stay 1: the stay ends (2026-03-01) before it starts (2026-07-01)",
    },
    {
      id: "TH-13",
      history: [H("2026-03-01", "2026-07-01", "")],
      problem: 'prior stay 1: unreadable country ""',
    },
  ];
  for (const c of cases) {
    assert.deepEqual(travelHistoryProblems(c.history), [c.problem], c.id);
    const r = nl(c.history);
    assert.equal(r.riskLevel, "blocked", c.id);
    assert.equal(r.reasons[0], "travel_history_unreadable", c.id);
    assert.ok(r.flags.includes("travel_history_unreadable"), c.id);
    // Neither count may be presented as taken. `null` is not `0`: a reader
    // investigates the first and acts on the second.
    assert.equal(r.cumulativeDays, null, c.id);
    assert.equal(r.schengen, null, c.id);
    assert.deepEqual(r.travelHistoryProblems, [c.problem], c.id);
  }
});

test("§8 TH-11: the refusal is not mistakable for an absence of data", () => {
  // The disguise `73920c9` removed: NaN serialises to null through JSON, so a
  // computed-wrong figure read as a not-computed one, while periodsCounted
  // still asserted that two stays had been looked at.
  const counted = computeCumulativeDays({
    travelHistory: [],
    country: "NL",
    windowStart: "2025-09-07",
    windowEnd: "2026-09-07",
  });
  assert.equal(counted.status, "COUNTED");
  assert.equal(counted.days, 0);

  const refused = computeCumulativeDays({
    travelHistory: [H("2026-03-01", "2026-07-01"), H("2026-05-01", "")],
    country: "NL",
    windowStart: "2025-09-07",
    windowEnd: "2026-09-07",
  });
  assert.equal(refused.status, "NOT_EVALUATED");
  assert.equal(refused.days, null);
  assert.equal(refused.periodsCounted, 0, "never a count of periods it declined to count");
  assert.notEqual(refused.status, counted.status, "an empty history and an unreadable one must not read alike");
});

test("§8 TH-14/TH-15: a stay in another Schengen state is dropped by design — and so is a country NAME, which is not", () => {
  // TH-14: correct and documented. The count is per destination country
  // (finding C-3), so 80 Spanish days do not touch a Dutch allowance.
  const otherState = nl([H("2026-05-01", "2026-07-19", "ES")]);
  assert.equal(otherState.schengen.peakDays, 21);
  assert.equal(otherState.cumulativeDays.days, 0);
  assert.equal(otherState.cumulativeDays.periodsCounted, 0);
  assert.deepEqual(travelHistoryProblems([H("2026-05-01", "2026-07-19", "ES")]), []);

  // TH-15: the SAME 80 days, named rather than coded. This WAS the open defect
  // in docs/DEMO-COUNTRIES.md §8.3.2, and the assertion here was written to
  // fail the moment somebody fixed it — "when this is fixed, this line fails
  // first". It did, within the hour. That is the tripwire working, and it is
  // why an open defect is worth pinning as it behaves rather than leaving a
  // note: a silent change nobody notices is the thing being guarded against,
  // in both directions.
  //
  // Fixed by making the guard test WELL-FORMEDNESS rather than non-emptiness
  // (`isWellFormedCountryCode()`, which had sat unused in the same shared
  // module). The contrast with TH-14 is the whole point and is asserted below:
  // a stay in a DIFFERENT country is dropped and that is correct; a stay whose
  // country cannot be read at all now refuses the count instead of clearing it.
  const named = nl([H("2026-05-01", "2026-07-19", "Netherlands")]);
  assert.deepEqual(
    travelHistoryProblems([H("2026-05-01", "2026-07-19", "Netherlands")]),
    ['prior stay 1: unreadable country "Netherlands"'],
    "an unreadable country names the row it came from"
  );
  // The refusal is reached BEFORE any window is chosen, which is the ordering
  // 73920c9 established: `classifyRisk()` turns an unreadable history into a
  // hard block first, so neither threshold can read a null. So there is no
  // count and no Schengen figure to inspect here — their absence IS the result.
  assert.equal(named.riskLevel, "blocked");
  assert.deepEqual(named.reasons, ["travel_history_unreadable"]);
  assert.equal(named.cumulativeDays, null, "no count is attempted over a history it cannot read");
  assert.equal(named.schengen, null, "and no window is chosen either");
  assert.notEqual(
    named.riskLevel,
    otherState.riskLevel,
    "a requester who named the destination in words must NOT be indistinguishable from one who named a different country"
  );
});

// ===========================================================================
// §8.3.1 — A REFUSED MEASUREMENT MUST NOT READ AS A CLEARED ONE
// ===========================================================================
//
// The row a specialist actually reads. `classifyRisk()` blocks on an unreadable
// history BEFORE choosing a window, so `risk.schengen` is null — which was
// indistinguishable, in describeDecisionBasis(), from a row decided before the
// matrix carried the figure at all. Both fell to the same branch, and that
// branch said "Within the limit" over a fabricated 180-day window, on a request
// the system had just blocked. Every false statement pointed the same way.
test("§8.3.1: an unreadable history leaves the Schengen limit NOT ASSESSED, never within it", async () => {
  const { classifyRisk } = await import("../src/uc04/riskMatrix.js");
  const { describeDecisionBasis } = await import("../src/uc04/decisionFacts.js");

  const factors = {
    homeCountry: "CA", destinationCountry: "NL", nationality: "CA",
    visaType: "schengen_short_stay", jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-07", endDate: "2026-09-27",
    travelHistory: [{ country: "NL", startDate: "2026-03-01", endDate: "" }],
  };
  const risk = classifyRisk(factors);
  assert.equal(risk.riskLevel, "blocked");
  assert.deepEqual(risk.reasons, ["travel_history_unreadable"]);

  const basis = describeDecisionBasis({
    authorizationRow: {
      decision: "blocked", reason: "travel_history_unreadable",
      risk_level: risk.riskLevel, flags: risk.reasons, factors, risk,
    },
  });
  const row = basis.measurements.find((m) => m.key === "schengen_90_180");
  assert.ok(row, "the row still renders — silence would be its own concealment");
  assert.equal(row.state, "not_assessed", "not within_limit: nothing was measured");
  assert.equal(row.breached, false);
  assert.equal(row.measured, null);
  assert.equal(row.window, null, "a window nothing measured over is the same lie in a smaller font");
  assert.match(row.note, /Not measured, and therefore not cleared/);
  assert.doesNotMatch(row.note, /predates the matrix/, "this decision predates nothing");
  assert.doesNotMatch(row.note, /Within the limit/);
});

// The contrast case, so the fix cannot be read as "always refuse".
test("§8.3.1: a readable history still reports a real peak and a real window", async () => {
  const { classifyRisk } = await import("../src/uc04/riskMatrix.js");
  const { describeDecisionBasis } = await import("../src/uc04/decisionFacts.js");
  const factors = {
    homeCountry: "CA", destinationCountry: "NL", nationality: "CA",
    visaType: "schengen_short_stay", jobDuties: "engineering",
    hasContractSigningAuthority: false,
    startDate: "2026-09-07", endDate: "2026-09-27",
    travelHistory: [{ country: "NL", startDate: "2026-08-01", endDate: "2026-08-10" }],
  };
  const risk = classifyRisk(factors);
  const basis = describeDecisionBasis({
    authorizationRow: {
      decision: "ready_for_approval", reason: "all_gates_passed",
      risk_level: risk.riskLevel, flags: risk.reasons, factors, risk,
    },
  });
  const row = basis.measurements.find((m) => m.key === "schengen_90_180");
  assert.equal(row.state, "within_limit");
  assert.equal(row.measured, 31, "the figure from §8's TH-01");
  assert.ok(row.window && row.window.from && row.window.to);
});
