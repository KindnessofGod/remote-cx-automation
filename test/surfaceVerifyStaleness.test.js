// ---------------------------------------------------------------------------
// surfaceVerifyStaleness.test.js — GAP 1 (rca-h7v): a stale scenario reports
// as STALE (exit 2, "could not tell"), never as a live FAIL.
// ---------------------------------------------------------------------------
// "The newest example of a scenario predates the deploy that could have
// changed the surface it is judging" -> the honest verdict is not FAIL and
// not PASS, it is STALE. This is the exit-2 doctrine applied one level up.
//
// Entirely offline: `getCommitTimestamp` takes an injectable exec function so
// this never shells out to real git, and `markStaleFailures`/`isScenarioStale`
// are pure functions over plain dates.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { getCommitTimestamp, isScenarioStale, markStaleFailures } from "../src/surfaceverify/staleness.js";
import { overallExitCode } from "../src/surfaceverify/runner.js";

test("getCommitTimestamp parses `git log --format=%cI` output into a Date, via an injected exec", () => {
  const fakeExec = (cmd, args) => {
    assert.equal(cmd, "git");
    assert.deepEqual(args, ["log", "-1", "--format=%cI", "HEAD"]);
    return "2026-08-22T13:20:58+00:00\n";
  };
  const at = getCommitTimestamp({ ref: "HEAD", execImpl: fakeExec });
  assert.equal(at.toISOString(), "2026-08-22T13:20:58.000Z");
});

test("getCommitTimestamp throws (never invents a date) when git produces no output", () => {
  const fakeExec = () => "";
  assert.throws(() => getCommitTimestamp({ ref: "deadbeef", execImpl: fakeExec }), /no output/i);
});

test("isScenarioStale: a decision made BEFORE the deploy time is stale", () => {
  const deployTime = new Date("2026-08-22T13:20:58Z");
  assert.equal(isScenarioStale("2026-08-22T07:37:34Z", deployTime), true);
});

test("isScenarioStale: a decision made AFTER the deploy time is NOT stale", () => {
  const deployTime = new Date("2026-08-22T13:20:58Z");
  assert.equal(isScenarioStale("2026-08-22T13:25:00Z", deployTime), false);
});

test("isScenarioStale: an unparsable timestamp is never invented as stale", () => {
  const deployTime = new Date("2026-08-22T13:20:58Z");
  assert.equal(isScenarioStale("not-a-real-date", deployTime), false);
});

test("markStaleFailures: a FAIL on a stale scenario becomes 'stale', a FAIL on a fresh scenario stays 'fail'", () => {
  const deployTime = new Date("2026-08-22T13:20:58Z");
  const scenarios = [
    { reason: "stale_reason", decision: { id: "d1", at: "2026-08-22T07:37:34Z" } },
    { reason: "fresh_reason", decision: { id: "d2", at: "2026-08-22T13:25:00Z" } },
  ];
  const rows = [
    { fact: "f1", surface: "s1", scenario: "stale_reason", verdict: "fail", detail: "pre-fix note found" },
    { fact: "f1", surface: "s1", scenario: "fresh_reason", verdict: "fail", detail: "genuinely broken" },
    { fact: "f1", surface: "s1", scenario: "stale_reason", verdict: "pass", detail: "unaffected" },
  ];

  const marked = markStaleFailures(rows, scenarios, deployTime);

  const staleFail = marked.find((r) => r.scenario === "stale_reason" && r.detail.includes("pre-fix"));
  const freshFail = marked.find((r) => r.scenario === "fresh_reason");
  const staleUnrelatedPass = marked.find((r) => r.scenario === "stale_reason" && r.verdict === "pass");

  assert.equal(staleFail.verdict, "stale", "a FAIL whose evidence predates the deploy must be downgraded to 'stale', not reported as a live defect");
  assert.match(staleFail.detail, /STALE/);
  assert.equal(freshFail.verdict, "fail", "a FAIL whose evidence postdates the deploy must remain a real fail");
  assert.ok(staleUnrelatedPass, "non-fail verdicts on a stale scenario are left alone");
  assert.equal(staleUnrelatedPass.verdict, "pass");
});

test("markStaleFailures: a scenario with no matching row-side reason is left untouched (no crash on unknown reasons)", () => {
  const deployTime = new Date("2026-08-22T13:20:58Z");
  const rows = [{ fact: "f1", surface: "s1", scenario: "unregistered_reason", verdict: "fail", detail: "x" }];
  const marked = markStaleFailures(rows, [], deployTime);
  assert.equal(marked[0].verdict, "fail");
});

test("overallExitCode treats 'stale' the same as 'unreadable' — it dominates a plain fail", () => {
  assert.equal(overallExitCode([{ verdict: "pass" }, { verdict: "stale" }]), 2);
  assert.equal(overallExitCode([{ verdict: "fail" }, { verdict: "stale" }]), 2, "a stale reading must never let a run claim only exit 1's confidence");
});
