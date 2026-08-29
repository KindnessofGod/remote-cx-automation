#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-node.mjs — push a Code node body from its file into n8n, verbatim
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Every drift incident in this project traces back to a node body being
// retyped rather than copied. Hand-transcribing a few KB of JavaScript into a
// JSON string is how the deployed gates ended up three fixes behind the file,
// and how a stale prompt survived next to a synced gate long enough to disable
// UC-01 entirely.
//
// This reads the file and writes exactly those bytes. There is no step where a
// human or a model retypes the code, so that class of bug cannot recur.
//
// USAGE
//   node scripts/deploy-node.mjs <workflowId> "<Node Name>" <file> [more triples...]
//   node scripts/deploy-node.mjs --publish <workflowId> ...   (activate after)
//
// Verify afterwards with `npm run verify-deployed`, which compares the same
// files against what n8n reports and also checks the draft is actually live.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error("deploy-node: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const publish = argv[0] === "--publish";
const rest = publish ? argv.slice(1) : argv;

if (rest.length < 3 || rest.length % 3 !== 0) {
  console.error('usage: deploy-node.mjs [--publish] <workflowId> "<Node Name>" <file> [...]');
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

// Group the triples by workflow so each one is read once, mutated, and written
// once. Writing per-node would race its own earlier write.
const jobs = new Map();
for (let i = 0; i < rest.length; i += 3) {
  const [workflowId, nodeName, file] = [rest[i], rest[i + 1], rest[i + 2]];
  if (!jobs.has(workflowId)) jobs.set(workflowId, []);
  jobs.get(workflowId).push({ nodeName, file });
}

for (const [workflowId, updates] of jobs) {
  const res = await fetch(`${BASE}/api/v1/workflows/${workflowId}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET ${workflowId} → ${res.status}`);
    process.exit(1);
  }
  const wf = await res.json();

  for (const { nodeName, file } of updates) {
    const node = (wf.nodes ?? []).find((n) => n.name === nodeName);
    if (!node) {
      console.error(`✖ ${workflowId}: no node named "${nodeName}"`);
      process.exit(1);
    }
    const source = await readFile(path.join(ROOT, file), "utf8");
    const before = node.parameters?.jsCode ?? "";
    node.parameters = { ...node.parameters, jsCode: source };
    console.log(
      `  ${before === source ? "=" : "→"} ${nodeName}  ←  ${file} (${source.length} bytes)`
    );
  }

  // The public API rejects read-only fields on write, so send only what it
  // owns — and `settings` is whitelisted too: n8n returns keys on read
  // (availableInMCP, binaryMode) that it refuses on write with
  // "must NOT have additional properties". Echoing back what was read fails.
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
  const settings = Object.fromEntries(
    Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
  );
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings,
  };
  const put = await fetch(`${BASE}/api/v1/workflows/${workflowId}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify(body),
  });
  if (!put.ok) {
    console.error(`✖ PUT ${workflowId} → ${put.status} ${(await put.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✔ saved ${workflowId}`);

  if (publish) {
    const act = await fetch(`${BASE}/api/v1/workflows/${workflowId}/activate`, {
      method: "POST",
      headers: H,
    });
    if (!act.ok) {
      console.error(`✖ activate ${workflowId} → ${act.status}`);
      process.exit(1);
    }
    const after = await act.json();
    const live = after.versionId === after.activeVersionId;
    console.log(
      `${live ? "✔" : "✖"} published ${workflowId} — draft ${String(after.versionId).slice(0, 8)} / ` +
        `production ${String(after.activeVersionId).slice(0, 8)}`
    );
    if (!live) process.exit(1);
  }
}
