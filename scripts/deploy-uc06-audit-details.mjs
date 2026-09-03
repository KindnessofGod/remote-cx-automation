#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-uc06-audit-details.mjs — publish UC-06's `Append Audit Log` details
// expression from workflows/nodes-uc06/appendAuditLogSpec.js and prove it
// from the read-back.
// ---------------------------------------------------------------------------
// ONE node parameter on ONE graph. A REST `PUT /api/v1/workflows/{id}`
// publishes in place (CLAUDE.md §6), so this is a production change the moment
// it returns 200 — which is why the script rewrites nothing but the one field,
// carries every other node and connection through untouched, and refuses to
// report success on anything but a byte-identical read-back with
// `versionId === activeVersionId`.
//
// Exit codes: 0 deployed and verified · 1 deployed but the read-back differs
// (or the PUT failed) · 2 could not reach n8n at all — never 0 for "skipped",
// so a skipped deploy can never be misread as a landed one.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { WORKFLOW_ID, NODE_NAME, DETAILS_EXPRESSION, appendAuditLogParamIssues } from "../workflows/nodes-uc06/appendAuditLogSpec.js";

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[./]+$/, "");
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error("N8N_BASE_URL / N8N_API_KEY unset — cannot reach n8n. Exiting 2, not 0.");
  process.exit(2);
}
const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

// The same allow-list scripts/deploy-terminal-nodes.mjs uses: n8n rejects a
// PUT carrying read-only settings back at it.
const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

const dryRun = process.argv.includes("--dry-run");

let wf;
try {
  const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H });
  if (!res.ok) {
    console.error(`GET ${WORKFLOW_ID} → HTTP ${res.status}. Exiting 2.`);
    process.exit(2);
  }
  wf = await res.json();
} catch (err) {
  console.error(`Could not reach n8n: ${err.message}. Exiting 2.`);
  process.exit(2);
}

const node = (wf.nodes ?? []).find((n) => n.name === NODE_NAME);
if (!node) {
  console.error(`Node "${NODE_NAME}" not found on ${WORKFLOW_ID}. Exiting 1.`);
  process.exit(1);
}
const before = appendAuditLogParamIssues(node);
console.log(`${WORKFLOW_ID} · "${NODE_NAME}" — issues before: ${before.length}`);
for (const i of before) console.log(`    ${i}`);
if (before.length === 0) {
  console.log("Already matches the spec; nothing to publish.");
  process.exit(0);
}
if (dryRun) {
  console.log("--dry-run: not publishing.");
  process.exit(0);
}

const values = node.parameters.fieldsUi.fieldValues;
const details = values.find((v) => v.fieldId === "details");
details.fieldValue = DETAILS_EXPRESSION;

const body = {
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))),
};
const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
if (!put.ok) {
  console.error(`PUT ${WORKFLOW_ID} → HTTP ${put.status}: ${(await put.text()).slice(0, 300)}. Exiting 1.`);
  process.exit(1);
}

const after = await (await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H })).json();
const live = (after.nodes ?? []).find((n) => n.name === NODE_NAME);
const issues = appendAuditLogParamIssues(live);
const published = after.versionId === after.activeVersionId;
const ok = issues.length === 0 && published;
console.log(
  `${ok ? "✔" : "✘"} ${WORKFLOW_ID} — active ${after.active} | versionId===activeVersionId ${published} | ` +
    `issues after read-back: ${issues.length}`
);
for (const i of issues) console.log(`    ${i}`);
process.exit(ok ? 0 : 1);
