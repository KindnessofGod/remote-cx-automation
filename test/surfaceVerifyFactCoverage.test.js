// ---------------------------------------------------------------------------
// surfaceVerifyFactCoverage.test.js — GAP 2 (rca-h7v): a fact with no
// scenario must not be indistinguishable from a passing one.
// ---------------------------------------------------------------------------
// "The runner must report, separately from the grid and in words: facts
// exercised on zero scenarios: ... / facts exercised on exactly one scenario:
// ... and a fact that is REQUIRED ... and was exercised zero times must FAIL
// the run, not report na. An unexercised required check is not a neutral
// outcome."
//
// This test constructs the unexercised-fact case ITSELF (a registry where a
// required fact matches no scenario) rather than reading it off the current
// live grid — a test that merely re-asserts today's registry proves nothing
// (the "parity test fed the disputed value" trap this repo has paid for
// twice already).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFactCoverage } from "../src/surfaceverify/runner.js";

function row(fact, surface, scenario, verdict) {
  return { fact, surface, scenario, verdict, detail: `${fact}/${surface}/${scenario}: ${verdict}` };
}

test("a REQUIRED fact exercised on zero scenarios produces a FAIL row, never a silent na", () => {
  const facts = [
    { id: "requiredButUnexercised", required: true, appliesToScenario: () => true },
    { id: "someOtherFact", required: false, appliesToScenario: () => true },
  ];
  // Every row for the required fact is "na" — it never produced a determinate
  // verdict on any scenario, the exact shape the bug report describes.
  const rows = [
    row("requiredButUnexercised", "surfaceA", "reasonX", "na"),
    row("requiredButUnexercised", "surfaceB", "reasonX", "na"),
    row("someOtherFact", "surfaceA", "reasonX", "pass"),
  ];

  const { coverageFailRows, zeroScenarioFacts } = analyzeFactCoverage(rows, facts);

  assert.ok(zeroScenarioFacts.includes("requiredButUnexercised"));
  assert.equal(coverageFailRows.length, 1, "the required-and-unexercised fact must produce exactly one synthetic FAIL row");
  assert.equal(coverageFailRows[0].fact, "requiredButUnexercised");
  assert.equal(coverageFailRows[0].verdict, "fail");
  assert.match(coverageFailRows[0].detail, /REQUIRED/);
  assert.match(coverageFailRows[0].detail, /zero scenarios/i);
});

test("a NON-required fact exercised on zero scenarios is reported in words but does NOT fail the run", () => {
  const facts = [{ id: "optionalUnexercised", required: false, appliesToScenario: () => true }];
  const rows = [row("optionalUnexercised", "surfaceA", "reasonX", "na")];

  const { coverageFailRows, zeroScenarioFacts } = analyzeFactCoverage(rows, facts);

  assert.deepEqual(zeroScenarioFacts, ["optionalUnexercised"]);
  assert.equal(coverageFailRows.length, 0, "a fact that never opted into required:true must not fail the run just for being unexercised");
});

test("a fact exercised on exactly one scenario is named in words, distinct from zero", () => {
  const facts = [{ id: "onceOnly", required: true, appliesToScenario: () => true }];
  const rows = [
    row("onceOnly", "surfaceA", "reasonX", "pass"),
    row("onceOnly", "surfaceB", "reasonX", "na"), // same scenario, different surface — still counts as ONE scenario
    row("onceOnly", "surfaceA", "reasonY", "na"), // reasonY never got a determinate verdict
  ];

  const { coverageFailRows, zeroScenarioFacts, oneScenarioFacts } = analyzeFactCoverage(rows, facts);

  assert.deepEqual(oneScenarioFacts, ["onceOnly"]);
  assert.deepEqual(zeroScenarioFacts, [], "a fact exercised once must not also appear in the zero list");
  assert.equal(coverageFailRows.length, 0, "required-and-exercised-at-least-once must not fail");
});

test("'na' and 'unreadable' verdicts do not count as the fact being exercised", () => {
  const facts = [{ id: "neverDeterminate", required: true, appliesToScenario: () => true }];
  const rows = [
    row("neverDeterminate", "surfaceA", "reasonX", "na"),
    row("neverDeterminate", "surfaceB", "reasonX", "unreadable"),
  ];

  const { coverageFailRows, zeroScenarioFacts } = analyzeFactCoverage(rows, facts);

  assert.deepEqual(zeroScenarioFacts, ["neverDeterminate"]);
  assert.equal(coverageFailRows.length, 1, "unreadable is the surface refusing to say, not the fact answering — it must not rescue a required fact from zero exercise");
});

test("a fact exercised on two or more scenarios appears in neither the zero nor the one list", () => {
  const facts = [{ id: "wellExercised", required: true, appliesToScenario: () => true }];
  const rows = [
    row("wellExercised", "surfaceA", "reasonX", "pass"),
    row("wellExercised", "surfaceA", "reasonY", "fail"),
  ];

  const { coverageFailRows, zeroScenarioFacts, oneScenarioFacts } = analyzeFactCoverage(rows, facts);

  assert.deepEqual(zeroScenarioFacts, []);
  assert.deepEqual(oneScenarioFacts, []);
  assert.equal(coverageFailRows.length, 0);
});
