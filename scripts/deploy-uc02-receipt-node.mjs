#!/usr/bin/env node
/**
 * deploy-uc02-receipt-node.mjs — splice "Read Receipt (API)" into UC-02.
 *
 * [E-1] on the Zendesk path. ONE node, between "Classify Expense (LLM)" and
 * "Expense Gates", calling our own tested endpoint rather than reimplementing
 * the extraction in a Code node — see src/uc02/receiptFromTicket.js's header
 * for why that trade was made.
 *
 * WHAT MAKES THIS SAFE TO RE-RUN
 * - Idempotent: if the node already exists its parameters are updated in place
 *   and the wiring is only changed if it is wrong.
 * - It refuses to guess. If the splice point has moved it exits 2 rather than
 *   attaching the node somewhere plausible.
 * - onError: continueRegularOutput. Our API being unreachable must NEVER abort
 *   a UC-02 run: the gates read an unrecognised response as "nobody tried" and
 *   decide exactly as they did before receipts were read. Refusing every claim
 *   during an outage would be a self-inflicted outage of the green tier.
 * - It PUBLISHES, and reads the graph back to prove it.
 *
 * USAGE
 *   NODE_USE_ENV_PROXY=1 node scripts/deploy-uc02-receipt-node.mjs [--dry-run]
 */
import "dotenv/config";
import process from "node:process";

const DRY = process.argv.includes("--dry-run");
const BASE = (process.env.N8N_BASE_URL || "").replace(/[./]+$/, "");
const KEY = process.env.N8N_API_KEY;
const API = process.env.CX_API_BASE_URL || "https://remote-cx-apis.vercel.app";
const WORKFLOW = "WORKFLOW_UC02_ID";
const NODE = "Read Receipt (API)";
const UP = "Classify Expense (LLM)";
const DOWN = "Expense Gates";

if (!BASE || !KEY) {
  console.error("CANNOT DEPLOY: N8N_BASE_URL / N8N_API_KEY not set.\nExiting 2 — this is NOT a success.");
  process.exit(2);
}
const H = { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" };
const ALLOWED_SETTINGS = ["executionOrder","saveDataErrorExecution","saveDataSuccessExecution","saveManualExecutions","saveExecutionProgress","executionTimeout","errorWorkflow","timezone","callerPolicy","callerIds"];

const wf = await (await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, { headers: H })).json();
const up = wf.nodes.find((n) => n.name === UP);
const down = wf.nodes.find((n) => n.name === DOWN);
if (!up || !down) {
  console.error(`✖ splice point missing (${UP} → ${DOWN}). The graph changed shape — refusing to guess.`);
  process.exit(2);
}

// The ticket id is the external ref the normalize node already derived. Read by
// node name because $json at this point is the classifier's response.
const params = {
  method: "POST",
  url: `${API}/uc02/api/receipts/read-from-ticket`,
  sendHeaders: true,
  headerParameters: {
    parameter: [{ name: "X-YOUR-WEBHOOK-TOKEN", value: "={{ $env.N8N_WEBHOOK_TOKEN }}" }],
  },
  sendBody: true,
  specifyBody: "json",
  jsonBody: "={{ JSON.stringify({ ticketId: $('Normalize Expense Submission').item.json.externalRef }) }}",
  options: {},
};

let node = wf.nodes.find((n) => n.name === NODE);
if (!node) {
  node = {
    name: NODE,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    // Same y as the node it feeds, so it cannot change the canvas-position
    // ordering the trace branch depends on (CLAUDE.md §6).
    position: [Math.round((up.position[0] + down.position[0]) / 2), down.position[1]],
    parameters: params,
    onError: "continueRegularOutput",
    alwaysOutputData: true,
  };
  wf.nodes.push(node);
  console.log(`  + added ${NODE}`);
} else {
  node.parameters = params;
  node.onError = "continueRegularOutput";
  node.alwaysOutputData = true;
  console.log(`  = ${NODE} already present — parameters refreshed`);
}

const outs = wf.connections[UP]?.main?.[0] ?? [];
const idx = outs.findIndex((c) => c.node === DOWN);
if (idx !== -1) {
  outs[idx] = { node: NODE, type: "main", index: 0 };
  console.log(`  → rewired ${UP} → ${NODE}`);
} else if (!outs.some((c) => c.node === NODE)) {
  console.error(`  ✖ ${UP} connects to neither ${DOWN} nor ${NODE} — refusing to guess.`);
  process.exit(2);
} else {
  console.log(`  = ${UP} already feeds ${NODE}`);
}
wf.connections[NODE] = { main: [[{ node: DOWN, type: "main", index: 0 }]] };

if (DRY) {
  console.log("\n  DRY RUN — nothing written.");
  process.exit(0);
}

const settings = Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k)));
const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, {
  method: "PUT", headers: H,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!put.ok) {
  console.error(`✖ PUT → ${put.status} ${(await put.text()).slice(0, 300)}`);
  process.exit(2);
}
const act = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}/activate`, { method: "POST", headers: H });

// READ IT BACK. A success flag is not evidence (CLAUDE.md §7b).
const back = await (await fetch(`${BASE}/api/v1/workflows/${WORKFLOW}`, { headers: H })).json();
const live = back.nodes.find((n) => n.name === NODE);
const feeds = (back.connections[NODE]?.main?.[0] ?? []).map((c) => c.node);
const fedBy = Object.entries(back.connections).filter(([, o]) => (o.main ?? []).some((g) => (g ?? []).some((c) => c.node === NODE))).map(([n]) => n);
console.log(`\n  activate ${act.status}`);
console.log(`  read back: node present=${Boolean(live)} onError=${live?.onError} fedBy=[${fedBy}] feeds=[${feeds}]`);
console.log(`  published: ${back.versionId === back.activeVersionId}`);

const ok = live && live.onError === "continueRegularOutput" && feeds.includes(DOWN) && fedBy.includes(UP) && back.versionId === back.activeVersionId;
if (!ok) {
  console.error("✖ the read-back does not match what was sent. Exiting 2.");
  process.exit(2);
}
console.log("✔ live");
