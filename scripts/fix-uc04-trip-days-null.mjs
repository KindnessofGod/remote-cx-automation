#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fix-uc04-trip-days-null.mjs — a trip length nobody derived is null, not 0
// ---------------------------------------------------------------------------
// WHAT WAS WRONG IN THE LIVE GRAPH — finding F-32
//
// `Create Authorization Record` wrote `trip_days` from
//
//   {{ $('Workation Gates').item.json.risk ? …risk.tripDays : 0 }}
//
// `risk` is null on FOUR of UC-04's decision paths — identity refused,
// employee not active, employer permission absent, factors malformed — because
// the policy engine returns before the matrix runs. Every one of those wrote an
// explicit **0** into an integer column, asserting a duration that was never
// computed. `Append Audit Log`, one node further down the same spine, already
// wrote `: null` for the identical value, so the two durable records of one
// decision disagreed and neither knew it.
//
// It is the same defect class as UC-05's F-28, UC-07's F-29 and the portal's
// F-30: a quantity that is UNKNOWN coerced into a quantity that is ZERO. Zero
// is a real answer to a real question, so nothing errors, nothing flags, and a
// human reads a confident figure nobody derived. Here it is not even a figure a
// real trip can produce — the count is inclusive, so the shortest possible trip
// is 1 day, and 0 was only ever reachable by not knowing.
//
// The node body's own coercions (`tripDurationDays()` returning 0 for dates it
// could not read, and `tripDays: risk?.tripDays ?? 0` in the summary call) are
// fixed in workflows/nodes-uc04/workationGates.js and deployed with
// scripts/deploy-node.mjs. This script fixes the one that lives only in the
// graph's own parameters, where no parity test can see it.
//
// WHY NOT A NEW ESCALATE GATE INSTEAD
// The routing was already correct in every one of these cases (blocked /
// escalate, each under its own accurate reason, each durably audited). Adding a
// gate would add no safety and would relabel a correctly-named refusal as a
// data problem — the mistake F-28's own gate-ordering note warns against. Only
// the number was lying, so only the number changes.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 node scripts/fix-uc04-trip-days-null.mjs [--publish]
//
// Declarative and idempotent: it makes the graph MATCH the expression below
// rather than applying a one-shot patch, so re-running it is a no-op.
//
// `PUT /api/v1/workflows/{id}` PUBLISHES IN PLACE on this API (unlike the MCP's
// update_workflow, which writes a draft). The verification below re-reads the
// workflow afterwards and asserts `activeVersionId === versionId` — the only
// thing that answers "is this live?" (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs

// The trailing dot on N8N_BASE_URL is real and must be stripped: raw requests
// against the dotted host return 200 with a zero-byte body for every path and
// silently produce no execution.
const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error("fix-uc04-trip-days-null: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const WORKFLOW = "WORKFLOW_UC04_ID"; // UC-04 — Work Authorization / Workation
const RECORD_NODE = "Create Authorization Record";
const FIELD = "trip_days";

// The one change. `null` where the old expression said `0`.
const TRIP_DAYS =
  "={{ $('Workation Gates').item.json.risk ? $('Workation Gates').item.json.risk.tripDays : null }}";

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };
const publish = process.argv.includes("--publish");

const ALLOWED_SETTINGS = [
  "executionOrder",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "saveManualExecutions",
  "saveExecutionProgress",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "callerPolicy",
  "callerIds",
];

async function get() {
  const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET ${WORKFLOW} → ${res.status}`);
    process.exit(1);
  }
  return res.json();
}

const nodeNamed = (wf, name) => {
  const node = (wf.nodes ?? []).find((n) => n.name === name);
  if (!node) {
    console.error(`✖ ${WORKFLOW}: no node named "${name}"`);
    process.exit(1);
  }
  return node;
};

const wf = await get();
const field = (nodeNamed(wf, RECORD_NODE).parameters?.fieldsUi?.fieldValues ?? []).find(
  (f) => f.fieldId === FIELD
);
if (!field) {
  console.error(`✖ ${RECORD_NODE}: no "${FIELD}" field to update`);
  process.exit(1);
}
if (field.fieldValue === TRIP_DAYS) {
  console.log("= already matches spec");
} else {
  console.log(`  → ${RECORD_NODE}.${FIELD}: 0 -> null when the matrix never ran`);
  console.log(`    was: ${field.fieldValue}`);
}
field.fieldValue = TRIP_DAYS;

const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, {
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
  console.error(`✖ PUT ${WORKFLOW} → ${put.status} ${(await put.text()).slice(0, 400)}`);
  process.exit(1);
}
console.log(`✔ saved ${WORKFLOW}`);

if (publish) {
  const act = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}/activate`, { method: "POST", headers: H });
  if (!act.ok) {
    console.error(`✖ activate ${WORKFLOW} → ${act.status} ${(await act.text()).slice(0, 300)}`);
    process.exit(1);
  }
}

// --- verify against what n8n reports, never against the write's status code --
const after = await get();
const deployed = (nodeNamed(after, RECORD_NODE).parameters?.fieldsUi?.fieldValues ?? []).find(
  (f) => f.fieldId === FIELD
);
const live = after.versionId === after.activeVersionId;

const checks = [
  [`${RECORD_NODE}.${FIELD} writes null when risk is absent`, deployed?.fieldValue === TRIP_DAYS],
  [`no ": 0" coercion left in ${FIELD}`, !/:\s*0\s*\}\}/.test(deployed?.fieldValue ?? "")],
  [`draft ${String(after.versionId).slice(0, 8)} is the ACTIVE version`, live],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "✔" : "✖"} ${label}`);
  if (!pass) ok = false;
}
if (!live) {
  console.log(`  production is ${String(after.activeVersionId).slice(0, 8)} — re-run with --publish`);
}
process.exit(ok ? 0 : 1);
