// ---------------------------------------------------------------------------
// nodeCoverageRatchet.test.js — hermetic proof that scripts/lib/
// nodeCoverage.mjs actually catches a newly-unguarded node, and never fails
// on shrinkage
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-rqeo)
//
// scripts/verify-deployed-nodes.mjs needs a live N8N_API_KEY to run at all,
// so nothing in it (or anything it imports the network-fetch parts of) can
// be exercised by `npm test`. The COVERAGE/RATCHET logic itself — "which live
// nodes does neither table cover" and "which of those are new since the
// committed baseline" — is pure (scripts/lib/nodeCoverage.mjs takes plain
// objects, no fetch), so it is tested here the same way
// test/n8nRouteByDecisionParity.test.js tests structuralNodeIssues(): against
// small hand-built fixtures shaped exactly like `GET /api/v1/workflows/:id`
// returns, with the real functions this bead wrote — not restated logic that
// could share a bug with them.
//
// The two things this bead's acceptance criteria demand of the ratchet are
// each their own test below, proven in BOTH directions (a harness nobody has
// watched fail is not a ratchet): a brand-new live node not in the baseline
// FAILS, naming the node; and shrinking the baseline (because a node became
// covered) NEVER fails.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coveredNodeNames,
  uncheckedNodes,
  ratchetViolations,
  loadBaseline,
} from "../scripts/lib/nodeCoverage.mjs";

const WF_ID = "wf-fixture-1";

const MAPPINGS = [{ workflowId: WF_ID, workflow: "Fixture Workflow", node: "Gate Node", file: "irrelevant.js" }];
const STRUCTURAL_MAPPINGS = [{ workflowId: WF_ID, workflow: "Fixture Workflow", node: "Switch Node", type: "n8n-nodes-base.switch" }];

function fixtureWorkflow(nodeNames) {
  return { nodes: nodeNames.map((name) => ({ name, type: "n8n-nodes-base.noOp" })) };
}

// ---------------------------------------------------------------------------
// coveredNodeNames / uncheckedNodes
// ---------------------------------------------------------------------------

test("coveredNodeNames returns exactly the MAPPINGS+STRUCTURAL_MAPPINGS node names for one workflowId", () => {
  const names = coveredNodeNames(WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS);
  assert.deepEqual([...names].sort(), ["Gate Node", "Switch Node"]);
});

test("coveredNodeNames ignores rows for a different workflowId", () => {
  const names = coveredNodeNames("some-other-workflow", MAPPINGS, STRUCTURAL_MAPPINGS);
  assert.deepEqual([...names], []);
});

test("uncheckedNodes: a node with no MAPPINGS/STRUCTURAL_MAPPINGS row is unchecked, covered ones are not", () => {
  const workflow = fixtureWorkflow(["Gate Node", "Switch Node", "Mystery Node"]);
  const unchecked = uncheckedNodes(workflow, WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS);
  assert.deepEqual(unchecked, [{ workflowId: WF_ID, node: "Mystery Node", type: "n8n-nodes-base.noOp" }]);
});

test("uncheckedNodes: a Code node WITH jsCode but no MAPPINGS row is STILL unchecked — the checker never reads its jsCode either way", () => {
  const workflow = {
    nodes: [
      { name: "Gate Node", type: "n8n-nodes-base.code" },
      { name: "Orphan Code Node", type: "n8n-nodes-base.code", parameters: { jsCode: "return [{json:{}}];" } },
    ],
  };
  const unchecked = uncheckedNodes(workflow, WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS);
  assert.deepEqual(unchecked, [{ workflowId: WF_ID, node: "Orphan Code Node", type: "n8n-nodes-base.code" }]);
});

test("uncheckedNodes: a fully covered workflow reports nothing", () => {
  const workflow = fixtureWorkflow(["Gate Node", "Switch Node"]);
  assert.deepEqual(uncheckedNodes(workflow, WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS), []);
});

test("uncheckedNodes: an empty/missing node list reports nothing rather than throwing", () => {
  assert.deepEqual(uncheckedNodes({}, WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS), []);
  assert.deepEqual(uncheckedNodes(undefined, WF_ID, MAPPINGS, STRUCTURAL_MAPPINGS), []);
});

// ---------------------------------------------------------------------------
// ratchetViolations — THE RATCHET ITSELF, both directions
// ---------------------------------------------------------------------------

test("RATCHET CAUGHT: a brand-new unchecked node absent from the baseline is a violation, named", () => {
  const baseline = [{ workflowId: WF_ID, node: "Already Known Debt", type: "n8n-nodes-base.noOp" }];
  const unchecked = [
    { workflowId: WF_ID, node: "Already Known Debt", type: "n8n-nodes-base.noOp" },
    { workflowId: WF_ID, node: "Freshly Added Node", type: "n8n-nodes-base.httpRequest" },
  ];
  const violations = ratchetViolations(unchecked, baseline);
  assert.deepEqual(violations, [{ workflowId: WF_ID, node: "Freshly Added Node", type: "n8n-nodes-base.httpRequest" }]);
});

test("RATCHET CAUGHT: a node quietly dropped from MAPPINGS (now unchecked, never baselined) is a violation", () => {
  // Simulates rca-kq7w's shape: a node that WAS covered loses its row. It
  // becomes unchecked for the first time, so — correctly — it was never in
  // the baseline either.
  const baseline = [];
  const unchecked = [{ workflowId: WF_ID, node: "Append Audit Log", type: "n8n-nodes-base.supabase" }];
  assert.deepEqual(ratchetViolations(unchecked, baseline), unchecked);
});

test("RATCHET CAUGHT: hand-deleting a baseline entry for a still-live, still-uncovered node is a violation", () => {
  // "Removing a name from the baseline without covering it must fail" — the
  // acceptance criterion's own wording, proved directly: same unchecked set,
  // baseline missing the one entry that used to cover it.
  const unchecked = [{ workflowId: WF_ID, node: "Reply + Solve Ticket", type: "n8n-nodes-base.zendesk" }];
  assert.deepEqual(ratchetViolations(unchecked, []), unchecked);
  assert.deepEqual(
    ratchetViolations(unchecked, [{ workflowId: WF_ID, node: "Reply + Solve Ticket", type: "n8n-nodes-base.zendesk" }]),
    []
  );
});

test("RATCHET NEVER FAILS on shrinkage: a node that becomes covered simply stops appearing in `unchecked`, and its stale baseline entry is harmless", () => {
  const baseline = [
    { workflowId: WF_ID, node: "Now Covered Node", type: "n8n-nodes-base.code" },
    { workflowId: WF_ID, node: "Still Unchecked Node", type: "n8n-nodes-base.noOp" },
  ];
  // "Now Covered Node" gained a MAPPINGS row, so it no longer appears in this
  // run's `unchecked` set at all — the baseline still names it, and that must
  // not fail.
  const unchecked = [{ workflowId: WF_ID, node: "Still Unchecked Node", type: "n8n-nodes-base.noOp" }];
  assert.deepEqual(ratchetViolations(unchecked, baseline), []);
});

test("RATCHET NEVER FAILS: an empty unchecked set against any baseline is always clean", () => {
  assert.deepEqual(ratchetViolations([], []), []);
  assert.deepEqual(ratchetViolations([], [{ workflowId: WF_ID, node: "X", type: "n8n-nodes-base.noOp" }]), []);
});

test("ratchetViolations keys on workflowId + node name, not type — a live type change on an already-baselined node is not by itself a NEW violation (STRUCTURAL_MAPPINGS' own `type` check is what catches that, for nodes that ARE covered)", () => {
  const baseline = [{ workflowId: WF_ID, node: "Renamed Type Node", type: "n8n-nodes-base.code" }];
  const unchecked = [{ workflowId: WF_ID, node: "Renamed Type Node", type: "n8n-nodes-base.function" }];
  assert.deepEqual(ratchetViolations(unchecked, baseline), []);
});

test("ratchetViolations distinguishes the same node name across two different workflows", () => {
  const baseline = [{ workflowId: "wf-a", node: "Append Audit Log", type: "n8n-nodes-base.supabase" }];
  const unchecked = [
    { workflowId: "wf-a", node: "Append Audit Log", type: "n8n-nodes-base.supabase" },
    { workflowId: "wf-b", node: "Append Audit Log", type: "n8n-nodes-base.supabase" },
  ];
  assert.deepEqual(ratchetViolations(unchecked, baseline), [
    { workflowId: "wf-b", node: "Append Audit Log", type: "n8n-nodes-base.supabase" },
  ]);
});

// ---------------------------------------------------------------------------
// loadBaseline
// ---------------------------------------------------------------------------

test("loadBaseline reads and parses a real committed baseline file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "baseline-test-"));
  const file = join(dir, "baseline.json");
  await writeFile(file, JSON.stringify([{ workflowId: "x", node: "y", type: "n8n-nodes-base.noOp" }]));
  try {
    const loaded = await loadBaseline(file);
    assert.deepEqual(loaded, [{ workflowId: "x", node: "y", type: "n8n-nodes-base.noOp" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadBaseline returns [] for a missing file rather than throwing — a fresh checkout with no baseline yet must not crash", async () => {
  const loaded = await loadBaseline("/nonexistent/path/does-not-exist.json");
  assert.deepEqual(loaded, []);
});

test("loadBaseline throws loudly on a malformed baseline (not a JSON array) rather than silently treating it as empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "baseline-test-"));
  const file = join(dir, "baseline.json");
  await writeFile(file, JSON.stringify({ not: "an array" }));
  try {
    await assert.rejects(() => loadBaseline(file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// the REAL committed baseline — shape checks, so a hand-edit of it (adding a
// row without the right fields, or a duplicate) is caught by `npm test`
// without needing N8N_API_KEY
// ---------------------------------------------------------------------------

test("the committed baseline (scripts/lib/unguarded-node-baseline.json) is a well-formed array of {workflowId, node, type} with no duplicate (workflowId, node) pairs", async () => {
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pathJoin } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const baselinePath = pathJoin(__dirname, "..", "scripts", "lib", "unguarded-node-baseline.json");
  const baseline = await loadBaseline(baselinePath);

  assert.ok(baseline.length > 0, "expected the committed baseline to be non-empty");

  const seen = new Set();
  for (const entry of baseline) {
    assert.equal(typeof entry.workflowId, "string");
    assert.ok(entry.workflowId.length > 0);
    assert.equal(typeof entry.node, "string");
    assert.ok(entry.node.length > 0);
    assert.equal(typeof entry.type, "string");
    assert.ok(entry.type.length > 0);

    const key = `${entry.workflowId} ${entry.node}`;
    assert.ok(!seen.has(key), `duplicate baseline entry for ${entry.workflowId} / ${entry.node}`);
    seen.add(key);
  }
});
