#!/usr/bin/env node
// ---------------------------------------------------------------------------
// add-trace-nodes.mjs — give the nine n8n graphs a per-attempt audit trace
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES
//
// §4 invariant 7 says the audit is two-level: `audit_log` records the decision,
// `audit_trace` records every LLM/API ATTEMPT underneath it, so that "why did
// this fail at 3am" is answerable. The Node app has done both since issue #26.
// The nine n8n graphs — the path that actually serves customer traffic — wrote
// only the decision row, and `audit_trace` had zero rows from n8n.
//
// A decision-level summary is genuinely not enough. `upstreamFailure.js` records
// swallowed failures into `audit_log.details.upstreamFailures`, which says the
// employment read 404'd. It cannot say whether that was one 403 or forty,
// whether a retry sequence ran, or what the LLM call cost. `findRedundantCalls()`
// in src/metrics/compute.js exists to detect duplicate calls FROM the trace, and
// until now it had nothing from n8n to read.
//
// WHAT GETS ADDED, PER GRAPH
//
//   Append Audit Log ──┬──> (existing successor, unchanged)
//                      └──> Collect Trace Steps ──> Append Audit Trace
//
// A SECOND branch off the audit node, not an insertion between two nodes. That
// distinction is the whole safety argument:
//
//   * Nothing was placed between a gate and a durable write, so the claim →
//     carry → first-durable-write chain that scripts/verify-claim-nodes.mjs
//     guards is byte-for-byte what it was.
//   * No existing connection was removed or rerouted, so no expression that
//     addresses a node by name ($('…Gates').item) changed meaning.
//   * The branch is terminal and strictly downstream of the audit write and of
//     the idempotency claim. It reads; it can route nothing.
//   * Both new nodes carry onError: continueRegularOutput, and the Code node
//     returns [] rather than throwing on anything it does not recognise. A
//     Supabase outage during tracing cannot fail a customer's request.
//
// THE TRACE BRANCH RUNS FIRST, AND THAT IS NOT A DETAIL. Under executionOrder v1
// n8n queues branches by canvas position, top-left first, and an error anywhere
// aborts the run before the queue drains. The first deploy put these two nodes
// BELOW the graph — execution 4325 then failed at `Reply + Solve Ticket` (a
// non-numeric ticket id) and the trace branch never executed at all. The run
// that loses its trace was precisely the run that needed one.
//
// So they sit ABOVE every existing node and the branch is taken before the
// customer-facing one. The cost is the Supabase insert's latency (~0.5s) ahead
// of the Zendesk reply; the architecture already pays that shape of cost on
// purpose — `Append Audit Log` runs before `Route by Decision` so the decision
// is durable before any outward act. A trace that only survives the happy path
// is not observability.
//
// ONE BODY FOR ALL NINE. workflows/nodes/collectTraceSteps.js is deployed
// byte-identical everywhere: the use case, decision, reason and external ref are
// read back off the audit row that was just written, the workflow and execution
// ids come from n8n's globals, and traced calls are found by probing a fixed
// candidate list and skipping nodes a graph does not have. Nine near-identical
// bodies would drift one edit at a time; one body drifts nowhere, and
// scripts/verify-deployed-nodes.mjs checks all nine against the same file.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 node scripts/add-trace-nodes.mjs [--only UC-01] [--publish]
//
// Declarative, not one-shot: it makes each graph MATCH the spec. A workflow
// missing the nodes gets them; one that has them gets its body and parameters
// repaired in place, so a correction can be rolled out the same way the first
// deploy went out.
//
// A REST PUT PUBLISHES IN PLACE on an already-active workflow. --publish only
// re-activates and then compares versionId against activeVersionId, which is the
// only thing that answers "is this live?".
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rawBase = process.env.N8N_BASE_URL ?? "";
// A trailing dot is a legal DNS root label, so the host resolves — and then
// fails TLS with a bare "fetch failed" that points at nothing.
const BASE = rawBase.replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error("add-trace-nodes: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const SUPABASE_CRED = { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } };

const AUDIT = "Append Audit Log";
const COLLECT = "Collect Trace Steps";
const WRITE = "Append Audit Trace";
const BODY_FILE = "workflows/nodes/collectTraceSteps.js";

const TARGETS = [
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

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

/**
 * The Supabase insert. Each field is a whole-string expression so n8n resolves
 * it to a NATIVE type — `attempt` must reach Postgres as an integer, `ok` as a
 * boolean and `details` as jsonb, not as their string spellings.
 *
 * `id` and `at` are left unset and rely on the table's own gen_random_uuid() /
 * now() defaults, the same choice the audit node already makes.
 */
const WRITE_PARAMETERS = {
  resource: "row",
  operation: "create",
  tableId: "audit_trace",
  dataToSend: "defineBelow",
  fieldsUi: {
    fieldValues: [
      { fieldId: "parent_id", fieldValue: "={{ $json.parent_id }}" },
      { fieldId: "call", fieldValue: "={{ $json.call }}" },
      { fieldId: "attempt", fieldValue: "={{ $json.attempt }}" },
      { fieldId: "ok", fieldValue: "={{ $json.ok }}" },
      { fieldId: "error", fieldValue: "={{ $json.error }}" },
      { fieldId: "details", fieldValue: "={{ $json.details }}" },
    ],
  },
};

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;
const publish = process.argv.includes("--publish");

const jsCode = await readFile(path.join(ROOT, BODY_FILE), "utf8");

let failed = 0;

for (const t of TARGETS) {
  if (only && t.uc !== only) continue;

  const res = await fetch(`${BASE}/api/v1/workflows/${t.id}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ ${t.uc}: GET → ${res.status}`);
    failed++;
    continue;
  }
  const wf = await res.json();

  const audit = wf.nodes.find((n) => n.name === AUDIT);
  if (!audit) {
    console.error(`✖ ${t.uc}: no "${AUDIT}" node — nothing to hang a trace off.`);
    failed++;
    continue;
  }

  // ABOVE everything else. Position IS execution order under v1, and a trace
  // branch queued behind the customer-facing one is lost on exactly the runs
  // that fail — see the header. A lane of its own also keeps the decision path
  // readable along its original line for whoever opens the graph at 3am.
  const minY = Math.min(...wf.nodes.filter((n) => n.name !== COLLECT && n.name !== WRITE).map((n) => n.position[1]));
  const [ax] = audit.position;
  const laneY = minY - 220;

  const collect = wf.nodes.find((n) => n.name === COLLECT);
  const write = wf.nodes.find((n) => n.name === WRITE);
  const before = JSON.stringify([
    collect?.parameters, collect?.position, write?.parameters, write?.position, wf.connections[AUDIT],
  ]);

  if (collect) {
    collect.parameters = { jsCode };
    collect.onError = "continueRegularOutput";
    collect.position = [ax, laneY];
  } else {
    wf.nodes.push({
      name: COLLECT,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [ax, laneY],
      // Observability must never be able to break a decision. This node is
      // downstream of the audit write and terminal; continuing on error means
      // even a body that throws leaves the run untouched.
      onError: "continueRegularOutput",
      parameters: { jsCode },
    });
  }

  if (write) {
    write.parameters = WRITE_PARAMETERS;
    write.credentials = SUPABASE_CRED;
    write.onError = "continueRegularOutput";
    write.position = [ax + 220, laneY];
  } else {
    wf.nodes.push({
      name: WRITE,
      type: "n8n-nodes-base.supabase",
      typeVersion: 1,
      position: [ax + 220, laneY],
      credentials: SUPABASE_CRED,
      onError: "continueRegularOutput",
      parameters: WRITE_PARAMETERS,
    });
  }

  // ADD a target to the audit node's existing output — never replace it. The
  // existing successor keeps its connection exactly as it was; that is what
  // makes this change unable to alter a decision.
  const auditConn = wf.connections[AUDIT] ?? { main: [[]] };
  if (!auditConn.main) auditConn.main = [[]];
  if (!auditConn.main[0]) auditConn.main[0] = [];
  if (!auditConn.main[0].some((c) => c.node === COLLECT)) {
    auditConn.main[0].push({ node: COLLECT, type: "main", index: 0 });
  }
  wf.connections[AUDIT] = auditConn;
  wf.connections[COLLECT] = { main: [[{ node: WRITE, type: "main", index: 0 }]] };
  // Deliberately no connection out of WRITE. The branch ends here.

  const after = JSON.stringify([
    wf.nodes.find((n) => n.name === COLLECT).parameters,
    wf.nodes.find((n) => n.name === COLLECT).position,
    wf.nodes.find((n) => n.name === WRITE).parameters,
    wf.nodes.find((n) => n.name === WRITE).position,
    wf.connections[AUDIT],
  ]);
  if (collect && write && before === after) {
    console.log(`= ${t.uc} already matches the spec`);
    continue;
  }
  console.log(`${collect ? "~" : "→"} ${t.uc} trace branch ${collect ? "repaired" : "added"} off "${AUDIT}"`);

  const put = await fetch(`${BASE}/api/v1/workflows/${t.id}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: Object.fromEntries(
        Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
      ),
    }),
  });
  if (!put.ok) {
    console.error(`✖ ${t.uc}: PUT → ${put.status} ${(await put.text()).slice(0, 300)}`);
    failed++;
    continue;
  }
  console.log(`✔ ${t.uc} saved`);

  if (publish) {
    const act = await fetch(`${BASE}/api/v1/workflows/${t.id}/activate`, { method: "POST", headers: H });
    if (!act.ok) {
      console.error(`✖ ${t.uc}: activate → ${act.status}`);
      failed++;
      continue;
    }
    const done = await act.json();
    // An update writes a draft. Only this comparison answers "is it live?".
    const live = done.versionId === done.activeVersionId;
    console.log(
      `${live ? "✔" : "✖"} ${t.uc} published — draft ${String(done.versionId).slice(0, 8)} / production ${String(done.activeVersionId).slice(0, 8)}`
    );
    if (!live) failed++;
  }
}

process.exit(failed ? 1 : 0);
