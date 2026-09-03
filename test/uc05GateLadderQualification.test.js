// ---------------------------------------------------------------------------
// uc05GateLadderQualification.test.js — "reached" is not "evaluated"
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describeGateLadder, qualifyGateLadder } from "../src/uc05/policyEngine.js";

const ladder = () => describeGateLadder("all_gates_passed");

test("with Remote's figure unread, the reconciliation rung is not_evaluated — and nothing else changes", () => {
  const row = { notice: { reconciliation: { verdict: "not_compared" } } };
  const before = ladder();
  const after = qualifyGateLadder(before, row);
  const rung = after.find((r) => r.gate === "notice_reconciliation");
  assert.equal(rung.status, "not_evaluated");
  assert.match(rung.qualification, /not read/);
  for (const [a, b] of before.map((r, i) => [r, after[i]])) {
    if (a.gate === "notice_reconciliation") continue;
    assert.deepEqual(a, b, `${a.gate} was altered`);
  }
  assert.equal(after.length, before.length);
});

test("with a real comparison, the rung stays passed", () => {
  for (const verdict of ["agree", "remote_longer", "statute_longer"]) {
    const after = qualifyGateLadder(ladder(), { notice: { reconciliation: { verdict } } });
    assert.equal(after.find((r) => r.gate === "notice_reconciliation").status, "passed", verdict);
  }
});

test("a rung that did not pass in the first place is never touched, and a missing row is tolerated", () => {
  const escalated = describeGateLadder("remote_notice_below_statutory");
  const after = qualifyGateLadder(escalated, { notice: { reconciliation: { verdict: "statute_longer" } } });
  assert.deepEqual(after, escalated);
  assert.deepEqual(qualifyGateLadder(ladder(), null), ladder());
  assert.deepEqual(qualifyGateLadder(ladder(), {}), ladder());
});

test("the UC-05 view applies the qualification, so the sidebar cannot receive the position-only ladder", () => {
  const server = readFileSync(new URL("../src/uc05/server.js", import.meta.url), "utf8");
  assert.match(server, /gateLadder: qualifyGateLadder\(describeGateLadder\(row\?\.reason\), row\)/);
});
