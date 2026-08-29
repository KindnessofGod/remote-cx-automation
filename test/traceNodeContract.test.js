// ---------------------------------------------------------------------------
// traceNodeContract.test.js — the trace-branch deployment contract, pinned
// offline
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE LIVE CHECKER
//
// Three files have to agree for `audit_trace` to receive a single row from n8n:
//
//   workflows/nodes/collectTraceSteps.js  decides which columns a row HAS
//   scripts/add-trace-nodes.mjs           builds the Supabase node that WRITES them
//   scripts/verify-trace-nodes.mjs        checks the deployment, live
//
// scripts/verify-trace-nodes.mjs asks the question that finally matters — is the
// branch wired, terminal, positioned above the graph, and published? It needs
// n8n credentials and the network, so it can never run in `npm test`, and a
// check that only runs when someone remembers to run it is a check that stops
// running.
//
// This file pins the half that CAN be proved with nothing but the repo: that
// those three files describe the SAME deployment. Every mismatch below is silent
// in production — the decision still lands, the customer still gets an answer,
// and rows are simply missing or columns are simply null. Nothing goes red.
//
// The sharpest case is the column contract. The collector emits a `details`
// object; the Supabase node lists the fields it will write. If the collector
// gains a column the node does not set, that column is null on every row from
// here on and the only symptom is a query that quietly returns nothing.
//
// What is deliberately NOT pinned here: whether the table, credential id and
// position rule are RIGHT. Asserting those against the same files that define
// them would restate the scripts' constants back to themselves. Whether they
// match the live graph and the live Supabase table is the checker's job.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { MAPPINGS } from "../scripts/lib/deployedNodeMappings.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (...p) => readFileSync(join(__dirname, "..", ...p), "utf8");

const ADD = repoFile("scripts", "add-trace-nodes.mjs");
const VERIFY_TRACES = repoFile("scripts", "verify-trace-nodes.mjs");
const COLLECTOR = repoFile("workflows", "nodes", "collectTraceSteps.js");

/**
 * Lift an array literal out of a script by name.
 *
 * These scripts run network calls at module scope, so they cannot be imported —
 * doing so would fire real requests from `npm test`, which is exactly the
 * hermeticity failure this suite exists to prevent. Reading the source and
 * evaluating just the literal keeps the test offline while still reading the
 * real thing rather than a copy of it.
 */
function arrayLiteral(source, name, where) {
  const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`).exec(source);
  assert.ok(
    m,
    `could not find "const ${name} = [...]" in ${where} — the extraction below is now blind, which is worse than a failure`
  );
  return new Function(`return ${m[1]}`)();
}

/** Run the real collector body and return the rows it emits. */
function runCollector(auditRow) {
  const sandbox = {
    $: (name) => {
      if (name === "Append Audit Log") return { first: () => ({ json: auditRow }) };
      throw new Error(`No node called "${name}"`);
    },
    $workflow: { id: "wf_test", name: "UC-TEST" },
    $execution: { id: "9999" },
  };
  const result = vm.runInNewContext(`(function () {\n${COLLECTOR}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result));
}

const AUDIT_ROW = {
  id: "11111111-2222-3333-4444-555555555555",
  use_case: "UC-01",
  action: "auto_resolve",
  details: { externalRef: "42", reason: "all_gates_passed" },
};

// --- the three files describe the same nine graphs -------------------------

test("1. the builder and the checker cover exactly UC-01…UC-09", () => {
  const added = arrayLiteral(ADD, "TARGETS", "add-trace-nodes.mjs");
  const checked = arrayLiteral(VERIFY_TRACES, "TRACE_TARGETS", "verify-trace-nodes.mjs");

  const expected = ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"];
  assert.deepEqual(added.map((t) => t.uc).sort(), expected, "the builder must deploy to all nine");
  assert.deepEqual(checked.map((t) => t.uc).sort(), expected, "the checker must check all nine");
});

test("2. the builder and the checker point at the same workflow ids", () => {
  const added = arrayLiteral(ADD, "TARGETS", "add-trace-nodes.mjs");
  const checked = arrayLiteral(VERIFY_TRACES, "TRACE_TARGETS", "verify-trace-nodes.mjs");

  const byUc = (list) => Object.fromEntries(list.map((t) => [t.uc, t.id]));
  // A checker pointed at a different graph than the builder deploys to reports
  // healthy about a workflow nobody is maintaining, while the real one rots.
  assert.deepEqual(byUc(checked), byUc(added));
});

test("3. verify-deployed-nodes.mjs body-checks the collector on all nine", () => {
  const added = arrayLiteral(ADD, "TARGETS", "add-trace-nodes.mjs");
  // The body diff and the wiring check are two different questions, and both
  // must cover every graph — a body verified on eight graphs is a graph running
  // untested code.
  //
  // rca-rqeo moved MAPPINGS out of verify-deployed-nodes.mjs (which cannot be
  // imported — it runs network calls at module scope) into scripts/lib/
  // deployedNodeMappings.mjs, a side-effect-free module. That module CAN be
  // imported directly, so this reads the real table rather than regex-scraping
  // verify-deployed-nodes.mjs's source for a literal that no longer lives there.
  const mapped = MAPPINGS.filter((m) => m.node === "Collect Trace Steps").map((m) => m.workflowId);
  assert.deepEqual(mapped.sort(), added.map((t) => t.id).sort());
});

// --- the column contract ----------------------------------------------------

test("4. every column the collector emits is a field the write node sets", () => {
  const rows = runCollector(AUDIT_ROW);
  assert.ok(rows.length > 0, "the collector must always emit at least the anchor row");

  const emitted = new Set();
  for (const r of rows) for (const k of Object.keys(r.json)) emitted.add(k);

  const m = /const WRITE_PARAMETERS = ({[\s\S]*?\n};)/.exec(ADD);
  assert.ok(m, 'could not find "const WRITE_PARAMETERS = {...}" in add-trace-nodes.mjs');
  const params = new Function(`return ${m[1].replace(/;$/, "")}`)();
  const written = new Set(params.fieldsUi.fieldValues.map((f) => f.fieldId));

  for (const col of emitted) {
    assert.ok(
      written.has(col),
      `the collector emits "${col}" but the Supabase node never sets it — that column is null on every row, ` +
        `and the only symptom is a query that quietly returns nothing`
    );
  }
});

test("5. the write node sets no field the collector never emits", () => {
  const rows = runCollector(AUDIT_ROW);
  const emitted = new Set();
  for (const r of rows) for (const k of Object.keys(r.json)) emitted.add(k);

  const m = /const WRITE_PARAMETERS = ({[\s\S]*?\n};)/.exec(ADD);
  const params = new Function(`return ${m[1].replace(/;$/, "")}`)();

  for (const f of params.fieldsUi.fieldValues) {
    assert.ok(
      emitted.has(f.fieldId),
      `the Supabase node writes "${f.fieldId}" from $json.${f.fieldId}, which the collector never emits — ` +
        `it will resolve to undefined on every row`
    );
  }
});

test("6. the checker's expected column list matches what the collector emits", () => {
  const rows = runCollector(AUDIT_ROW);
  const emitted = new Set();
  for (const r of rows) for (const k of Object.keys(r.json)) emitted.add(k);

  const fields = arrayLiteral(VERIFY_TRACES, "TRACE_FIELDS", "verify-trace-nodes.mjs");
  // If the checker's list falls behind the collector, it green-lights a
  // deployment that drops a column — the checker becomes the thing that hides
  // the defect it exists to find.
  assert.deepEqual(fields.sort(), [...emitted].sort());
});

// --- the three names that must be spelled identically in both scripts -------

test("7. the builder and the checker name the same three nodes", () => {
  const constOf = (source, name) => {
    const m = new RegExp(`const ${name} = "([^"]+)";`).exec(source);
    assert.ok(m, `could not find const ${name} in the source`);
    return m[1];
  };
  // n8n addresses nodes by name. A one-character difference means the checker
  // looks for a node the builder never created and reports it missing forever —
  // or worse, looks at nothing and reports success.
  for (const name of ["AUDIT", "COLLECT", "WRITE"]) {
    assert.equal(constOf(VERIFY_TRACES, name), constOf(ADD, name), `${name} differs between the two scripts`);
  }
});

test("8. the checker reads TRACED_CALLS out of the deployed body, not a copy", () => {
  // The point of check 7 in the checker is to catch a probe-name typo. If it
  // compared a list restated in its own source, a typo present in both would
  // pass — so it must extract the list from the body it fetched from n8n.
  const m = /const TRACED_CALLS = (\[[\s\S]*?\n\]);/.exec(COLLECTOR);
  assert.ok(m, "collectTraceSteps.js must declare TRACED_CALLS as a literal the checker can lift");

  const probes = new Function(`return ${m[1]}`)();
  assert.ok(probes.length > 0);
  for (const p of probes) {
    assert.equal(typeof p.node, "string", "every probe needs a node name to look up");
    assert.equal(typeof p.call, "string", "every probe needs the call name it records");
  }

  assert.ok(
    /function tracedCallNodes\(/.test(VERIFY_TRACES),
    "verify-trace-nodes.mjs must lift TRACED_CALLS from the fetched body — restating it here would pass on a shared typo"
  );
  // It may MENTION the name (its extractor regex has to), but it must never
  // declare the array itself. That literal is the copy the check exists to
  // avoid: a typo present in both would compare equal and pass.
  assert.ok(
    !/const TRACED_CALLS = \[/.test(VERIFY_TRACES),
    "verify-trace-nodes.mjs must NOT declare its own TRACED_CALLS array — that is the copy the check exists to avoid"
  );
});

test("9. the trace branch is built as an addition, never a replacement", () => {
  // The single most dangerous edit this script could make is to REPLACE the
  // audit node's existing successor rather than adding to it: the graph would
  // stop routing, stop replying and stop resolving tickets, while every node
  // still reported green. Pin the shape of the connection edit.
  assert.ok(
    /auditConn\.main\[0\]\.push\(/.test(ADD),
    "the builder must PUSH onto the audit node's existing targets"
  );
  assert.ok(
    !/wf\.connections\[AUDIT\]\s*=\s*{\s*main:\s*\[\[\s*{\s*node:\s*COLLECT/.test(ADD),
    "the builder must never assign the audit node a fresh single-target connection"
  );
  // And the branch must end at the write — nothing may hang off it.
  assert.ok(
    /wf\.connections\[COLLECT\] = { main: \[\[{ node: WRITE/.test(ADD),
    "the builder must wire COLLECT → WRITE"
  );
  assert.ok(
    !/wf\.connections\[WRITE\]\s*=/.test(ADD),
    "the builder must never give WRITE an outgoing connection — the trace branch is terminal"
  );
});

test("11. the builder places the trace lane ABOVE the graph, not below it", () => {
  // THE RULE THAT ALREADY COST A DEPLOYMENT. Under executionOrder v1 n8n queues
  // branches by canvas position, top-left first — not by the connections array.
  // The first deploy put these nodes below the graph; execution 4325 then failed
  // at a Zendesk node and the trace branch never ran, because an error aborts
  // the run before n8n drains its branch queue. The run that loses its trace is
  // precisely the run that needed one.
  //
  // scripts/verify-trace-nodes.mjs checks the deployed positions. This checks
  // the arithmetic that produces them, so a regression fails in `npm test`
  // rather than surviving until someone runs the live checker.
  const m = /const laneY = minY ([-+]) (\d+);/.exec(ADD);
  assert.ok(m, 'could not find "const laneY = minY ± N;" in add-trace-nodes.mjs');
  assert.equal(
    m[1],
    "-",
    "laneY must SUBTRACT from the topmost node's y — a positive offset puts the trace branch below the graph, " +
      "where it is queued after the customer-facing branch and lost on exactly the runs that failed"
  );
  assert.ok(Number(m[2]) > 0, "the offset must be a real distance, not zero");

  // And the lane must be derived from the graph's own topmost node, never a
  // constant: a fixed y that happens to be above today's layout stops being
  // above it the moment a node is added.
  assert.ok(
    /const minY = Math\.min\(\.\.\.wf\.nodes/.test(ADD),
    "laneY must be computed from the actual topmost node in the fetched graph"
  );
});

test("10. both trace nodes are built unable to fail a run", () => {
  // Observability must never be able to break a decision. Both nodes carry
  // onError: continueRegularOutput, and the collector returns [] rather than
  // throwing — belt and braces, because this branch runs BEFORE the
  // customer-facing one and an unguarded throw there would abort the request.
  //
  // The builder has two paths per node — CREATE (an object literal, `onError:`)
  // and REPAIR of a node already deployed (an assignment, `.onError =`). Both
  // must set it: a repair that silently dropped the guard would re-arm the
  // hazard on every graph the script has already fixed, which is the path that
  // runs every time after the first.
  const created = [...ADD.matchAll(/onError: "continueRegularOutput"/g)].length;
  const repaired = [...ADD.matchAll(/\.onError = "continueRegularOutput"/g)].length;
  assert.equal(created, 2, `expected both nodes guarded on the create path, found ${created}`);
  assert.equal(repaired, 2, `expected both nodes guarded on the repair path, found ${repaired}`);
});
