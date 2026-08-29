#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-trace-nodes.mjs — is the two-level audit actually in force?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// §4 invariant 7 says the audit is two-level: `audit_log` records the decision,
// `audit_trace` records every LLM/API ATTEMPT underneath it. The nine graphs got
// that second level from scripts/add-trace-nodes.mjs, as a terminal branch:
//
//   Append Audit Log ──┬──> (existing successor, unchanged)
//                      └──> Collect Trace Steps ──> Append Audit Trace
//
// scripts/verify-deployed-nodes.mjs already checks that the Code node BODY
// deployed in each graph is byte-identical to workflows/nodes/collectTraceSteps
// .js. That is the easy half. Everything else about this branch can be wrong
// while the body is perfect, and every one of those failures is SILENT — the
// decision still lands, the customer still gets their answer, and the only
// symptom is that `audit_trace` is quietly missing rows nobody looks for until
// 3am. This checks the half a body diff cannot see.
//
// WHAT IS CHECKED, AND WHY EACH ONE MATTERS
//
//   1. Both nodes exist, and hang off "Append Audit Log" — not off the gates.
//      `parent_id` is audit_trace's FK onto audit_log.id, and the only way to
//      have that id is to read it back off the Supabase insert response. A
//      branch moved upstream produces rows with a null parent: orphans that
//      record the calls but no longer say which decision they belong to.
//
//   2. The audit node's ORIGINAL successor is still connected. This branch was
//      added ALONGSIDE the decision path, never in front of it. If a later edit
//      leaves the audit node pointing only at the trace collector, the graph
//      stops routing, stops replying, and stops resolving tickets — while every
//      node still reports green.
//
//   3. The trace branch is TERMINAL — nothing hangs off "Append Audit Trace".
//      Observability that can route is no longer observability; it is a gate
//      nobody reviewed.
//
//   4. Both nodes carry onError: continueRegularOutput. A Supabase blip during
//      tracing must never fail a customer's request. Without this, the cheapest
//      node in the graph can abort the most important one.
//
//   5. THE POSITION RULE, which is the one that already cost a deployment.
//      Under executionOrder v1 n8n queues branches by CANVAS POSITION, top-left
//      first — not by the order of the connections array. The first deploy put
//      these two nodes below the graph; execution 4325 then failed at a Zendesk
//      node and the trace branch never ran at all, because an error aborts the
//      run before n8n drains its branch queue. The run that loses its trace is
//      precisely the run that needed one. So the two nodes must sit strictly
//      ABOVE every other node in the graph, and nothing in the JSON says so —
//      which is exactly why it needs a checker rather than a comment.
//
//   6. The Supabase node writes to `audit_trace` with the right credential and
//      one field per real column. A `tableId` typo deploys happily and throws
//      per-execution into a swallowed error, so the graph looks healthy and the
//      table stays empty.
//
//   7. Every entry in the collector's TRACED_CALLS list matches a real node
//      name in at least one of the nine graphs. The collector probes nodes by
//      NAME and treats "no such node" as "this graph does not make that call",
//      so a typo is indistinguishable from an absence: that call is simply
//      never traced anywhere, forever, with no error. This is the only check
//      that can catch it, because it is the only place that sees the list and
//      all nine graphs at once.
//
//   8. And the half that is easiest to miss: is any of this LIVE? A REST PUT
//      publishes in place, `mcp__n8n__update_workflow` writes a draft, and this
//      project has already lost sessions to a fix that was correct, deployed,
//      and not running. versionId vs activeVersionId is the only comparison
//      that answers it.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 npm run verify-traces
//   NODE_USE_ENV_PROXY=1 node scripts/verify-trace-nodes.mjs
//
// NODE_USE_ENV_PROXY=1 is REQUIRED in this container. Node's global fetch
// ignores HTTPS_PROXY, and anything that goes direct is refused with
// `403 Host not in allowlist` — a message that reads like an allowlist problem
// even when the host is allowlisted and curl reaches it in the same shell.
//
// Exits 0 when every graph traces and is published, 1 on any defect, 2 on a
// config or transport problem. The three are distinct on purpose: "the trace is
// broken" and "I could not tell you whether the trace is broken" are different
// answers, and neither CI nor a human may read the second as a pass.
// ---------------------------------------------------------------------------

import "dotenv/config";   // credentials live in .env; without this this check
                          // exits 2 on a machine that HAS them, and an exit 2 is
                          // indistinguishable from genuinely being unable to reach
                          // n8n — the confusion this file exists to prevent

const AUDIT = "Append Audit Log";
const COLLECT = "Collect Trace Steps";
const WRITE = "Append Audit Trace";

const TRACE_TABLE = "audit_trace";
const SUPABASE_CRED_ID = "CRED_SUPABASE";

/** Every column collectTraceSteps.js emits. `id`/`at` default in Postgres. */
const TRACE_FIELDS = ["parent_id", "call", "attempt", "ok", "error", "details"];

/**
 * The nine graphs that must carry a trace branch — the same nine
 * scripts/add-trace-nodes.mjs deploys to. test/traceNodeContract.test.js
 * asserts the two lists stay identical, so this cannot quietly stop covering
 * one while the adder keeps deploying to it.
 */
const TRACE_TARGETS = [
  { uc: "UC-01", id: "WORKFLOW_UC01_ID" },
  { uc: "UC-02", id: "WORKFLOW_UC02_ID" },
  { uc: "UC-03", id: "WORKFLOW_UC03_ID" },
  { uc: "UC-04", id: "WORKFLOW_UC04_ID" },
  { uc: "UC-05", id: "WORKFLOW_UC05_ID" },
  { uc: "UC-06", id: "WORKFLOW_UC06_ID" },
  { uc: "UC-07", id: "WORKFLOW_UC07_ID" },
  { uc: "UC-08", id: "WORKFLOW_UC08_ID" },
  { uc: "UC-09", id: "WORKFLOW_UC09_ID" },
];

const rawBase = process.env.N8N_BASE_URL ?? "";
// A trailing dot is a legal DNS root label, so the host resolves — and then
// fails TLS with a bare "fetch failed" that points at nothing.
const BASE = rawBase.replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error(
    "verify-trace-nodes: set N8N_BASE_URL and N8N_API_KEY.\n" +
      "Exiting 2, not 1: this is 'I could not check', not 'the check failed'."
  );
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, accept: "application/json" };

/**
 * The node names collectTraceSteps.js probes, read out of the deployed body
 * rather than restated here. Restating them would make this check compare the
 * list against a copy of itself and pass on a typo present in both.
 */
function tracedCallNodes(jsCode) {
  const m = /const TRACED_CALLS = (\[[\s\S]*?\n\]);/.exec(jsCode ?? "");
  if (!m) return null;
  try {
    return new Function(`return ${m[1]}`)().map((c) => c.node);
  } catch {
    return null;
  }
}

let checked = 0;
let defective = 0;
let unpublished = 0;
/** Union across all nine graphs, for check 7. */
const allNodeNames = new Set();
/** The TRACED_CALLS list, taken from whichever graph we read first. */
let tracedNodes = null;

for (const t of TRACE_TARGETS) {
  const res = await fetch(`${BASE}/api/v1/workflows/${t.id}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ ${t.uc}: GET → ${res.status}. Cannot check this graph.`);
    process.exit(2);
  }
  const wf = await res.json();
  checked++;

  const problems = [];
  const notes = [];
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  for (const n of wf.nodes) allNodeNames.add(n.name);

  const audit = byName.get(AUDIT);
  const collect = byName.get(COLLECT);
  const write = byName.get(WRITE);

  // --- 1. the branch exists and hangs off the audit node ------------------
  if (!audit) problems.push(`no "${AUDIT}" node — there is nothing to hang a trace off, and no parent id to point at`);
  if (!collect) problems.push(`missing "${COLLECT}"`);
  if (!write) problems.push(`missing "${WRITE}"`);

  const auditOut = wf.connections?.[AUDIT]?.main?.[0] ?? [];
  const auditTargets = auditOut.map((c) => c.node);
  if (audit && collect && !auditTargets.includes(COLLECT)) {
    problems.push(`"${AUDIT}" does not connect to "${COLLECT}" — the branch is orphaned and will never run`);
  }

  // --- 2. the decision path off the audit node survived --------------------
  const decisionTargets = auditTargets.filter((n) => n !== COLLECT);
  if (audit && decisionTargets.length === 0) {
    problems.push(
      `"${AUDIT}" now leads ONLY to the trace branch — the decision path is gone. ` +
        `This branch is an addition, never a replacement.`
    );
  }

  // --- 3. collect → write, and the branch ends there -----------------------
  const collectTargets = (wf.connections?.[COLLECT]?.main?.[0] ?? []).map((c) => c.node);
  if (collect && write && !collectTargets.includes(WRITE)) {
    problems.push(`"${COLLECT}" does not connect to "${WRITE}" — steps are collected and then dropped`);
  }
  const writeTargets = (wf.connections?.[WRITE]?.main ?? []).flat().map((c) => c.node);
  if (writeTargets.length > 0) {
    problems.push(
      `"${WRITE}" leads on to ${writeTargets.map((n) => `"${n}"`).join(", ")} — the trace branch must be terminal. ` +
        `Observability that can route is a gate nobody reviewed.`
    );
  }

  // --- 4. neither node may be able to fail a run ---------------------------
  for (const n of [collect, write]) {
    if (n && n.onError !== "continueRegularOutput") {
      problems.push(
        `"${n.name}" has onError: ${n.onError ?? "(unset — defaults to stopping the run)"}. ` +
          `A trace failure must never fail a customer's request.`
      );
    }
  }

  // --- 5. the position rule — canvas order IS execution order --------------
  const others = wf.nodes.filter((n) => n.name !== COLLECT && n.name !== WRITE);
  if (others.length && collect && write) {
    const minOtherY = Math.min(...others.map((n) => n.position[1]));
    const traceY = Math.max(collect.position[1], write.position[1]);
    if (traceY >= minOtherY) {
      problems.push(
        `trace branch sits at y=${traceY}, NOT above the rest of the graph (topmost other node y=${minOtherY}). ` +
          `Under executionOrder v1 n8n queues branches by canvas position, so this branch now runs AFTER the ` +
          `customer-facing one — and an error there aborts the run before the queue drains. The trace is lost on ` +
          `exactly the executions that failed. This is how execution 4325 lost its trace.`
      );
    }
  }

  // --- 6. the write really targets audit_trace -----------------------------
  if (write) {
    const p = write.parameters ?? {};
    if (p.tableId !== TRACE_TABLE) {
      problems.push(`"${WRITE}" writes to table "${p.tableId}", not "${TRACE_TABLE}"`);
    }
    if (p.operation !== "create" || p.resource !== "row") {
      problems.push(`"${WRITE}" is ${p.resource}/${p.operation}, not row/create — a trace row may only ever be inserted`);
    }
    const fields = (p.fieldsUi?.fieldValues ?? []).map((f) => f.fieldId);
    for (const col of TRACE_FIELDS) {
      if (!fields.includes(col)) problems.push(`"${WRITE}" never sets "${col}" — that column will be null on every row`);
    }
    const credId = write.credentials?.supabaseApi?.id;
    if (credId !== SUPABASE_CRED_ID) {
      problems.push(`"${WRITE}" uses Supabase credential ${credId ?? "(none)"}, expected ${SUPABASE_CRED_ID}`);
    }
  }

  // --- 7. gather the collector's probe list for the cross-graph check ------
  if (collect && tracedNodes === null) {
    tracedNodes = tracedCallNodes(collect.parameters?.jsCode);
    if (tracedNodes === null) {
      notes.push(`could not read TRACED_CALLS out of the deployed body — check 7 is blind this run`);
    }
  }

  // --- 8. is any of this live? --------------------------------------------
  if (!wf.active) {
    problems.push(`workflow is NOT active — a trace branch in a graph that serves no traffic records nothing`);
  }
  if (wf.versionId && wf.activeVersionId && wf.versionId !== wf.activeVersionId) {
    unpublished++;
    problems.push(
      `UNPUBLISHED — draft ${String(wf.versionId).slice(0, 8)} ≠ production ${String(wf.activeVersionId).slice(0, 8)}. ` +
        `Everything above describes the DRAFT; production is running something else.`
    );
  } else if (wf.active && !wf.activeVersionId) {
    problems.push(`active but reports no activeVersionId — cannot confirm the draft is what runs`);
  }

  if (problems.length) {
    defective++;
    console.error(`\n✖ ${t.uc}  ${wf.name ?? t.id}`);
    for (const p of problems) console.error(`    · ${p}`);
  } else {
    console.log(`✔ ${t.uc}  ${AUDIT} → ${COLLECT} → ${WRITE}   (terminal, above, published, active)`);
    for (const n of notes) console.log(`    note: ${n}`);
  }
}

// --- 7 (cross-graph). A probe name matching nothing anywhere is a typo, and
// a typo here is a call that is silently never traced in any graph, forever.
let deadProbes = 0;
if (tracedNodes) {
  const dead = tracedNodes.filter((n) => !allNodeNames.has(n));
  if (dead.length) {
    deadProbes = dead.length;
    console.error(
      `\n✖ TRACED_CALLS names ${dead.length} node(s) that exist in none of the nine graphs:\n` +
        dead.map((n) => `    · "${n}"`).join("\n") +
        `\n    The collector treats an unknown node as "this graph does not make that call", so a\n` +
        `    typo is indistinguishable from an absence: that call is never traced and never errors.`
    );
  } else {
    console.log(`\n✔ all ${tracedNodes.length} TRACED_CALLS probe names match a real node in at least one graph`);
  }
}

console.log(
  `\n${checked} workflow${checked === 1 ? "" : "s"} checked · ${defective} defective · ` +
    `${unpublished} with unpublished changes · ${deadProbes} dead probe name${deadProbes === 1 ? "" : "s"}.`
);

if (defective > 0 || deadProbes > 0) {
  console.error(
    "\n`audit_trace` is what answers 'was that one 403 or forty' at 3am. Every defect\n" +
      "above is silent in production: the decision still lands, the customer still gets\n" +
      "an answer, and the rows simply never appear. Fix the graph(s), then PUBLISH —\n" +
      "an update writes a draft, it does not go live."
  );
  process.exit(1);
}
