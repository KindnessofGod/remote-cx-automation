// ---------------------------------------------------------------------------
// n8nTraceCollector.test.js — the n8n trace collector, executed for real
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// workflows/nodes/collectTraceSteps.js is the n8n half of §4 invariant 7 (the
// two-level audit): it turns one execution's external calls into `audit_trace`
// rows. It is a Code node body, so nothing imports it and a syntax or semantics
// break would ship green — the same risk class that once turned `/https?:\/\//`
// into a regex followed by a comment and silently sent every ticket to human
// review. This runs the ACTUAL deployed source in a vm sandbox with n8n's
// globals faked.
//
// It also pins the two properties that make the trace worth having:
//   1. the rows are COMPARABLE with the ones AuditLogger.logTraceStep() writes
//      from the Node path — same columns, same usage field names — because a
//      trace split across two incompatible shapes is two half-traces;
//   2. the collector cannot throw. It is observability hanging off a live
//      decision path, and a body that throws on an unexpected shape would be a
//      logging bug that pages a human about a customer request.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { describeUpstreamError } from "../src/shared/upstreamFailure.js";
import { AuditLogger } from "../src/shared/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "..", "workflows", "nodes", "collectTraceSteps.js");
const source = readFileSync(SOURCE_PATH, "utf8");

/**
 * Execute the real node body.
 *
 * @param {object} opts
 * @param {object|null} opts.auditRow  what `Append Audit Log` returned, or null
 *   to simulate the node being absent (the collector must survive that).
 * @param {Record<string, object[]>} opts.nodes  node name -> one json per RUN.
 *   An absent key is a node this graph does not have: $() throws, exactly as
 *   n8n's own accessor does for an unknown or unexecuted node.
 */
function runCollector({ auditRow = {}, nodes = {} } = {}) {
  const sandbox = {
    $: (name) => {
      if (name === "Append Audit Log") {
        if (auditRow === null) throw new Error(`No node called "${name}"`);
        return { first: () => ({ json: auditRow }) };
      }
      const runs = nodes[name];
      if (!runs) throw new Error(`No node called "${name}"`);
      return {
        all: (_branch, runIndex) => {
          if (runIndex >= runs.length) throw new Error("Referenced node is unexecuted");
          return [{ json: runs[runIndex] }];
        },
      };
    },
    $workflow: { id: "wf_test", name: "UC-TEST" },
    $execution: { id: "9999" },
  };

  const result = vm.runInNewContext(`(function () {\n${source}\n})()`, sandbox, { timeout: 5000 });
  // Cross-realm objects: JSON round-trip so deepEqual compares content, not
  // prototype identity — and so the test sees what n8n passes between nodes.
  return JSON.parse(JSON.stringify(result));
}

const AUDIT_ROW = {
  id: "11111111-2222-3333-4444-555555555555",
  at: "2026-08-17T10:00:00+00:00",
  use_case: "UC-01",
  action: "auto_resolve",
  actor: "someone@example.com",
  risk_tier: "low",
  details: { externalRef: "42", reason: "all_gates_passed" },
};

/** n8n's `onError: continueRegularOutput` item, as read off a live execution. */
const upstreamError = (status, message) => ({
  error: { message, name: "NodeApiError", status },
});

const llmResponse = {
  id: "chatcmpl-x",
  model: "gpt-4o-mini-2024-07-18",
  choices: [{ message: { content: "{}" } }],
  usage: { prompt_tokens: 215, completion_tokens: 42, total_tokens: 257 },
};

test("emits an anchor row plus one row per traced call that ran", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: {
      "Classify Request (LLM)": [llmResponse],
      "Fetch Employment (Remote)": [{ data: { employment: { id: "e1" } } }],
    },
  });

  assert.deepEqual(
    rows.map((r) => r.json.call),
    ["n8n.run", "openai.classify", "remote.employment"]
  );
  // Every row is bound to the decision row it belongs to — the whole point of
  // the FK, and the only thing that makes the trace joinable.
  for (const r of rows) assert.equal(r.json.parent_id, AUDIT_ROW.id);
});

test("a graph that lacks a traced node simply skips it — no throw, no empty row", () => {
  // UC-07 makes no external calls at all before its durable write.
  const rows = runCollector({ auditRow: { ...AUDIT_ROW, use_case: "UC-07", action: "escalate" } });
  assert.deepEqual(rows.map((r) => r.json.call), ["n8n.run"]);
  assert.equal(rows[0].json.ok, true);
  assert.equal(rows[0].json.details.tracedCalls, 0);
});

test("a swallowed upstream failure is recorded as ok:false with its status", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: {
      "Fetch Employment (Remote)": [upstreamError(404, '404 - "Employment not found"')],
      "Fetch Expense Categories (Remote)": [upstreamError(403, "403 - missing scopes")],
    },
  });

  const employment = rows.find((r) => r.json.call === "remote.employment").json;
  assert.equal(employment.ok, false);
  assert.equal(employment.details.httpStatus, 404);
  assert.match(employment.error, /Employment not found/);

  const categories = rows.find((r) => r.json.call === "remote.expense_categories").json;
  assert.equal(categories.details.httpStatus, 403);

  // THE POINT OF THE WHOLE EXERCISE: the decision row says "an upstream call
  // failed"; the trace says which ones, how many, and what each answered.
  const anchor = rows[0].json;
  assert.equal(anchor.call, "n8n.run");
  assert.equal(anchor.ok, false);
  assert.equal(anchor.details.failedCalls, 2);
});

test("failure detection agrees with src/shared/upstreamFailure.js", () => {
  // Two copies of the same recognition rule (a Code node cannot import), so
  // they are pinned against each other — the same discipline n8nParity.test.js
  // applies to the gates.
  const cases = [
    upstreamError(404, "gone"),
    upstreamError(403, "forbidden"),
    { error: "socket hang up" },
    { data: { employment: {} } },
    { data: { employment: {} }, error: "not a failed fetch" },
    { choices: [] },
  ];

  for (const raw of cases) {
    const rows = runCollector({
      auditRow: AUDIT_ROW,
      nodes: { "Fetch Employment (Remote)": [raw] },
    });
    const row = rows.find((r) => r.json.call === "remote.employment").json;
    const expected = describeUpstreamError(raw, "employment");
    assert.equal(row.ok, expected === null, `ok mismatch for ${JSON.stringify(raw)}`);
    if (expected) {
      assert.equal(row.details.httpStatus ?? null, expected.status);
    }
  }
});

test("LLM usage is recorded under the field names the cost model reads", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: { "Classify Request (LLM)": [llmResponse] },
  });
  const usage = rows.find((r) => r.json.call === "openai.classify").json.details.usage;

  // src/metrics/compute.js's computeLlmCost() reads exactly these, and
  // src/shared/llm.js's tagUsage() writes exactly these from the Node path.
  assert.deepEqual(usage, {
    model: "gpt-4o-mini-2024-07-18",
    promptTokens: 215,
    completionTokens: 42,
    totalTokens: 257,
  });
  // byUseCase in the cost model buckets on this.
  assert.equal(rows[0].json.details.useCase, "UC-01");
});

test("a failed LLM attempt records no usage — nothing was returned to price", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: { "Classify Request (LLM)": [upstreamError(429, "rate limited")] },
  });
  const row = rows.find((r) => r.json.call === "openai.classify").json;
  assert.equal(row.ok, false);
  assert.equal(row.details.usage, undefined);
});

test("a node that ran twice produces attempts 1 and 2, not two attempt-1 rows", () => {
  // findRedundantCalls() distinguishes a legitimate retry sequence from a
  // genuine duplicate by whether the attempts are exactly 1..n. Deriving the
  // number from the run index rather than hard-coding 1 is what makes that
  // distinction real on the n8n path.
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: {
      "Fetch Employment (Remote)": [upstreamError(500, "boom"), { data: { employment: {} } }],
    },
  });
  const attempts = rows.filter((r) => r.json.call === "remote.employment").map((r) => r.json.attempt);
  assert.deepEqual(attempts, [1, 2]);
});

test("every row carries the execution pointer, and says which path wrote it", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: { "Fetch Employment (Remote)": [{ data: {} }] },
  });
  for (const r of rows) {
    assert.equal(r.json.details.source, "n8n");
    assert.equal(r.json.details.executionId, "9999");
    assert.equal(r.json.details.workflowId, "wf_test");
    assert.equal(r.json.details.externalRef, "42");
    // Item pairing: a Code node returning bare objects breaks $('Node').item
    // downstream, and the failure surfaces nowhere near this node.
    assert.deepEqual(r.pairedItem, { item: 0 });
  }
});

test("the collector never throws, whatever it is handed", () => {
  // It hangs off a live decision path. A logging bug must not become a customer
  // incident, so every degenerate input still yields rows (or none) — not an
  // exception.
  assert.doesNotThrow(() => runCollector({ auditRow: null }));
  assert.doesNotThrow(() => runCollector({ auditRow: {} }));
  assert.doesNotThrow(() =>
    runCollector({ auditRow: { id: "x", details: "not an object" }, nodes: { "Fetch Employment (Remote)": [null] } })
  );

  // With no audit row there is no parent to bind to. An orphan trace row is
  // still better than losing the evidence: parent_id is nullable on purpose.
  const orphan = runCollector({ auditRow: null });
  assert.equal(orphan[0].json.parent_id, null);
});

test("rows map onto the same audit_trace columns the Node path writes", () => {
  const rows = runCollector({
    auditRow: AUDIT_ROW,
    nodes: { "Fetch Employment (Remote)": [{ data: {} }] },
  });

  // The Node path's in-memory entry, for the same table.
  const audit = new AuditLogger();
  const nodeEntry = audit.logTraceStep({
    call: "classify.askJson",
    attempt: 1,
    ok: true,
    parentId: AUDIT_ROW.id,
    details: { usage: null },
  });

  // audit_trace's real columns, minus the two Postgres fills in (id, at).
  const COLUMNS = ["parent_id", "call", "attempt", "ok", "error", "details"];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row.json).sort(), [...COLUMNS].sort());
  }

  // Same information, same column meanings — the n8n row uses the DB's
  // snake_case because it goes straight into the insert, the Node row uses
  // camelCase because it also lives in memory.
  assert.equal(typeof nodeEntry.parentId, "string");
  assert.equal(typeof rows[0].json.parent_id, "string");
  assert.equal(typeof nodeEntry.attempt, "number");
  assert.equal(typeof rows[0].json.attempt, "number");
  assert.equal(typeof nodeEntry.ok, "boolean");
  assert.equal(typeof rows[0].json.ok, "boolean");
});
