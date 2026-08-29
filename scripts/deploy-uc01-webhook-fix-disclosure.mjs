#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-uc01-webhook-fix-disclosure.mjs — stop the production webhook from
// echoing the employment record back to an unauthenticated caller (F-4)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, RATHER THAN `npm run deploy-node`
//
// deploy-node.mjs writes a file's bytes into an existing node's `jsCode` and
// stops. The "Zendesk Ticket Webhook" trigger node has no jsCode at all — its
// disclosure lives in `parameters.responseMode`/`parameters.options`, plain
// JSON config, not a Code node body. This edits those parameters directly
// from workflows/nodes/webhookResponseSpec.js (the one place the target shape
// is written down as data), then publishes and reads the result back.
//
// THE FIX, IN ONE SENTENCE: `responseMode: "lastNode"` -> `"onReceived"`, so
// the HTTP response is sent the instant the request is accepted — before any
// downstream node has produced anything a response could leak. See
// webhookResponseSpec.js's header for the full disclosure this closes and
// what this bead deliberately does NOT do (add authentication — filed
// separately, a coordinated change with the Zendesk-side caller).
//
// THREE POST-CONDITIONS, all checked after the write, none inferred from a 200:
//   1. PARAMS.  responseMode/options.responseData, re-read from n8n, match
//               webhookResponseSpec.js exactly (via webhookResponseParamIssues).
//   2. LIVE.    activeVersionId === versionId (a REST PUT publishes in place;
//               the n8n MCP's update_workflow only drafts — CLAUDE.md §6).
//   3. REACHABLE. httpMethod/path are unchanged, so the same production URL
//               Zendesk already calls keeps accepting traffic.
//
// Idempotent and re-runnable: if the deployed graph already matches, it
// writes nothing and exits 0.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 N8N_BASE_URL=... N8N_API_KEY=... \
//     node scripts/deploy-uc01-webhook-fix-disclosure.mjs [--check]
//
//   --check   verify only; never write. Exit 1 if production is out of date.
//
// Exit codes: 0 in sync, 1 drifted/failed, 2 could not tell (config/transport).
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import {
  NODE_NAME,
  NODE_TYPE,
  HTTP_METHOD,
  PATH,
  RESPONSE_MODE,
  RESPONSE_DATA,
  webhookResponseParamIssues,
} from "../workflows/nodes/webhookResponseSpec.js";

const WORKFLOW_ID = "WORKFLOW_UC01_ID";
const WORKFLOW_NAME = "UC-01 — Employment Verification";

const rawBase = process.env.N8N_BASE_URL ?? "";
const BASE = rawBase.replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
const CHECK_ONLY = process.argv.includes("--check");

if (!BASE || !KEY) {
  console.error("deploy-uc01-webhook-fix-disclosure: set N8N_BASE_URL and N8N_API_KEY. Exiting 2.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

async function getWorkflow() {
  const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET /workflows/${WORKFLOW_ID} → ${res.status} ${res.statusText}. Exiting 2.`);
    process.exit(2);
  }
  return res.json();
}

let wf = await getWorkflow();
const isLive = () => wf.versionId && wf.versionId === wf.activeVersionId;

console.log(`${WORKFLOW_NAME} (${WORKFLOW_ID})`);
console.log(`  active:          ${wf.active}`);
console.log(`  versionId:       ${wf.versionId}`);
console.log(`  activeVersionId: ${wf.activeVersionId}`);

const nodeByName = (name) => (wf.nodes ?? []).find((n) => n.name === name);

let node = nodeByName(NODE_NAME);
if (!node) {
  console.error(`✖ no node named "${NODE_NAME}" — cannot edit a node that does not exist. Exiting 2.`);
  process.exit(2);
}
if (node.type !== NODE_TYPE) {
  console.error(`✖ "${NODE_NAME}" has type ${JSON.stringify(node.type)}, expected ${JSON.stringify(NODE_TYPE)}. Exiting 2.`);
  process.exit(2);
}

let issues = webhookResponseParamIssues(node);

if (issues.length === 0 && isLive()) {
  console.log("= already deployed and live — nothing written.");
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error("✖ production is out of date (--check: nothing written):");
  for (const i of issues) console.error(`    - ${i}`);
  if (!isLive()) console.error("    - draft is not the active version");
  process.exit(1);
}

console.log("Diagnosed before write:");
for (const i of issues) console.log(`    - ${i}`);

// --- mutate a fresh copy of the fetched graph -------------------------------
// Only the response-transport parameters change. httpMethod/path are left
// exactly as read, so the change cannot accidentally move the production URL.
node.parameters = {
  httpMethod: node.parameters?.httpMethod ?? HTTP_METHOD,
  path: node.parameters?.path ?? PATH,
  responseMode: RESPONSE_MODE,
  options: { responseData: RESPONSE_DATA },
};
// Drop a stale top-level `responseData` (only meaningful under "lastNode") if
// a previous edit left one — webhookResponseParamIssues flags it if present.
delete node.parameters.responseData;

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];
const settings = Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k)));

const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!put.ok) {
  console.error(`✖ PUT → ${put.status} ${(await put.text()).slice(0, 500)}`);
  process.exit(1);
}
console.log(`→ wrote "${NODE_NAME}" (responseMode: lastNode -> onReceived, options.responseData: ${JSON.stringify(RESPONSE_DATA)})`);

wf = await getWorkflow();

if (!isLive()) {
  const act = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: "POST", headers: H });
  if (!act.ok) {
    console.error(`✖ activate → ${act.status} ${(await act.text()).slice(0, 300)}`);
    process.exit(1);
  }
  wf = await getWorkflow();
  console.log("→ activated explicitly (the PUT alone had not promoted the draft)");
}

// --- post-conditions, all read back from production -------------------------
let failed = 0;

const finalNode = (wf.nodes ?? []).find((n) => n.name === NODE_NAME);
const finalIssues = webhookResponseParamIssues(finalNode);
if (finalIssues.length > 0) {
  failed++;
  console.error(`✖ PARAMS: the live "${NODE_NAME}" does not match the spec:`);
  for (const i of finalIssues) console.error(`    - ${i}`);
} else {
  console.log(`✔ PARAMS: "${NODE_NAME}" matches workflows/nodes/webhookResponseSpec.js`);
}

if (!isLive()) {
  failed++;
  console.error(`✖ LIVE: activeVersionId (${wf.activeVersionId}) !== versionId (${wf.versionId}) — production runs the OLD graph`);
} else {
  console.log(`✔ LIVE: activeVersionId === versionId (${wf.versionId})`);
}
if (wf.active !== true) {
  failed++;
  console.error("✖ LIVE: the workflow is not active — its webhook will not accept traffic");
}

if (finalNode?.parameters?.httpMethod !== HTTP_METHOD || finalNode?.parameters?.path !== PATH) {
  failed++;
  console.error(
    `✖ REACHABLE: httpMethod/path changed (${finalNode?.parameters?.httpMethod} ${finalNode?.parameters?.path}), ` +
      `expected ${HTTP_METHOD} ${PATH} — the production URL Zendesk calls would move`
  );
} else {
  console.log(`✔ REACHABLE: ${HTTP_METHOD} /webhook/${PATH} unchanged`);
}

process.exit(failed === 0 ? 0 : 1);
