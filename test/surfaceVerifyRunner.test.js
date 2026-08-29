// ---------------------------------------------------------------------------
// surfaceVerifyRunner.test.js — the fact loop iterates ALL registered
// surfaces, not a fixed/hand-picked list
// ---------------------------------------------------------------------------
// This is the regression guard for the ONE structural property rca-tcj names
// as the thing that actually matters: "A fact is declared ONCE and asserted
// on EVERY surface in the registry ... E4-F14 exists because that loop was
// executed by a human and had one iteration."
//
// Entirely offline — fake surfaces, fake facts, no network, no git, no
// browser. It proves the LOOP's shape, not any one fact's correctness (that
// is qa/contracts/UC-01-acceptance.md §13 plus the individual fact tests in
// src/surfaceverify/facts.js's own callers).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { runFactLoop, overallExitCode } from "../src/surfaceverify/runner.js";

function fakeSurface(id) {
  const calls = [];
  return {
    id,
    contract: `fake surface ${id}`,
    audience: "test",
    calls,
    async textFor(scenario) {
      calls.push(scenario.reason);
      return `text-from-${id}-for-${scenario.reason}`;
    },
  };
}

function fakeFact(id, { appliesToScenario = () => true } = {}) {
  const calls = [];
  return {
    id,
    calls,
    appliesToScenario,
    evaluate(surfaceId, text, scenario) {
      calls.push({ surfaceId, scenario: scenario.reason });
      return { verdict: "pass", detail: `checked ${surfaceId}` };
    },
  };
}

const SCENARIOS = [
  { reason: "reason_a", decision: { id: "d1", externalRef: "1", employmentId: "e1" } },
  { reason: "reason_b", decision: { id: "d2", externalRef: "2", employmentId: "e2" } },
];

test("the fact loop calls EVERY fact against EVERY surface for EVERY scenario — no surface is skipped", async () => {
  const surfaceA = fakeSurface("surfaceA");
  const surfaceB = fakeSurface("surfaceB");
  const surfaceC = fakeSurface("surfaceC"); // added last — must still be reached, unconditionally
  const factX = fakeFact("factX");
  const factY = fakeFact("factY");

  const { rows } = await runFactLoop({
    scenarios: SCENARIOS,
    surfaces: { surfaceA, surfaceB, surfaceC },
    facts: [factX, factY],
    resolveSubject: async () => null,
  });

  // 2 facts x 3 surfaces x 2 scenarios = 12 rows, no fewer.
  assert.equal(rows.length, 12, "every fact x surface x scenario combination must produce a row");

  // Every surface was actually read, for every scenario — this is the E4-F14
  // regression shape: a surface silently left out of the loop produces zero
  // calls here while everything else still looks complete.
  for (const surface of [surfaceA, surfaceB, surfaceC]) {
    assert.equal(surface.calls.length, 2, `${surface.id} must be read once per scenario`);
    assert.deepEqual(surface.calls.sort(), ["reason_a", "reason_b"]);
  }

  // Every fact was checked against every surface for every scenario.
  for (const fact of [factX, factY]) {
    assert.equal(fact.calls.length, 6, `${fact.id} must be evaluated against every surface x scenario pair`);
    const bySurface = new Set(fact.calls.map((c) => c.surfaceId));
    assert.deepEqual(bySurface, new Set(["surfaceA", "surfaceB", "surfaceC"]), `${fact.id} must reach all three surfaces, not a subset`);
  }
});

test("a fact that does not apply to a scenario's reason is recorded as 'na' for every surface, without calling evaluate", async () => {
  const surfaceA = fakeSurface("surfaceA");
  const scopedFact = fakeFact("scopedFact", { appliesToScenario: (s) => s.reason === "reason_a" });

  const { rows } = await runFactLoop({
    scenarios: SCENARIOS,
    surfaces: { surfaceA },
    facts: [scopedFact],
    resolveSubject: async () => null,
  });

  assert.equal(rows.length, 2);
  const forA = rows.find((r) => r.scenario === "reason_a");
  const forB = rows.find((r) => r.scenario === "reason_b");
  assert.equal(forA.verdict, "pass");
  assert.equal(forB.verdict, "na");
  assert.equal(scopedFact.calls.length, 1, "evaluate must only run when the fact applies");
});

test("a surface that throws while reading is 'unreadable', never silently 'na' or 'pass'", async () => {
  const brokenSurface = {
    id: "broken",
    contract: "x",
    audience: "x",
    async textFor() {
      throw new Error("simulated read failure — network down");
    },
  };
  const fact = fakeFact("anyFact");

  const { rows } = await runFactLoop({
    scenarios: [SCENARIOS[0]],
    surfaces: { brokenSurface },
    facts: [fact],
    resolveSubject: async () => null,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "unreadable");
  assert.match(rows[0].detail, /simulated read failure/);
  assert.equal(fact.calls.length, 0, "evaluate must not run against text that could not be read");
});

test("overallExitCode: 0 clean, 1 when any fail, 2 when any unreadable (2 dominates)", () => {
  assert.equal(overallExitCode([{ verdict: "pass" }, { verdict: "na" }]), 0);
  assert.equal(overallExitCode([{ verdict: "pass" }, { verdict: "fail" }]), 1);
  assert.equal(overallExitCode([{ verdict: "fail" }, { verdict: "unreadable" }]), 2);
  assert.equal(overallExitCode([{ verdict: "pass" }, { verdict: "unreadable" }]), 2);
});

test("a real fact's null-text handling is fact-specific, not defaulted by the loop", async () => {
  // The loop itself must not decide what `text === null` means — that is
  // rule 1's other half: a required-success fact treats "nothing rendered" as
  // a FAILURE (C-16 shape), while a withholding fact treats it as a PASS
  // (nothing shown = nothing disclosed). Both are exercised here with a
  // surface that always returns null, proving the loop defers entirely to
  // the fact's own evaluate().
  const nullSurface = { id: "nullSurface", contract: "x", audience: "x", async textFor() { return null; } };

  const strictFact = {
    id: "strict",
    appliesToScenario: () => true,
    evaluate(surfaceId, text) {
      return text === null ? { verdict: "fail", detail: "nothing rendered" } : { verdict: "pass", detail: "ok" };
    },
  };
  const lenientFact = {
    id: "lenient",
    appliesToScenario: () => true,
    evaluate(surfaceId, text) {
      return text === null ? { verdict: "pass", detail: "nothing to disclose" } : { verdict: "fail", detail: "disclosed" };
    },
  };

  const { rows } = await runFactLoop({
    scenarios: [SCENARIOS[0]],
    surfaces: { nullSurface },
    facts: [strictFact, lenientFact],
    resolveSubject: async () => null,
  });

  assert.equal(rows.find((r) => r.fact === "strict").verdict, "fail");
  assert.equal(rows.find((r) => r.fact === "lenient").verdict, "pass");
});
