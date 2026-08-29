#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-uc04-jurisdiction-screen.mjs — put UC-04's sanctions screen into
// production, and prove it got there
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, RATHER THAN `npm run deploy-node`
//
// deploy-node.mjs writes a file's bytes into a node and stops. That is the
// right shape for a routine sync, and it is not enough here, because the thing
// being deployed is a compliance control and the interesting failure is silent.
//
// Until this ran, src/uc04/riskMatrix.js blocked a workation to a restricted
// jurisdiction and the LIVE graph did not: it escalated, and `escalate` is one
// of the two decisions src/uc04/workflow.js creates a real Remote
// work-authorization record for. So the gap was not "a decision string is
// wrong" — it was a platform write happening for a destination that must never
// get one. A deploy that reports success while leaving that in place is worse
// than one that fails.
//
// Hence three post-conditions, all checked after the write, none inferred from
// the write returning 200:
//
//   1. BYTES. The deployed jsCode is re-read and compared to the file. n8n has
//      corrupted a node body on this project before (a regex collapsed into a
//      line comment and every ticket routed to human review while the
//      automation resolved nothing), and it did so while reporting success.
//   2. LIVE. `activeVersionId === versionId`. Two tools point at this API with
//      opposite defaults — a REST PUT publishes in place, the n8n MCP writes a
//      draft — so "did the update succeed" and "is the update running" are
//      different questions and only the second one matters.
//   3. SEMANTICS. The restricted set is parsed back OUT of the deployed body
//      and compared, member for member, to the set src/ actually blocks on.
//      Byte equality against the local file cannot catch the case where the
//      local file itself has drifted from src/; the parity test covers that in
//      CI, and this covers it against production.
//
// Idempotent and re-runnable: if the deployed bytes already match and the graph
// is already live, it writes nothing and exits 0.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 N8N_BASE_URL=... N8N_API_KEY=... \
//     node scripts/deploy-uc04-jurisdiction-screen.mjs [--check]
//
//   --check   verify only; never write. Exit 1 if production is out of date.
//
// Exit codes: 0 in sync, 1 drifted/failed, 2 could not tell (config or
// transport). The third is separate on purpose — "the deployment is wrong" and
// "I could not determine whether the deployment is wrong" are different
// answers, and neither is a pass.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { RESTRICTED_JURISDICTIONS } from "../src/uc04/riskMatrix.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The one thing this script deploys. Declarative so a re-run is a no-op and so
 * the target is reviewable without reading any control flow.
 */
const TARGET = {
  workflowId: "WORKFLOW_UC04_ID",
  workflow: "UC-04 — Work Authorization / Workation",
  node: "Workation Gates",
  file: "workflows/nodes-uc04/workationGates.js",
};

// The trailing dot in N8N_BASE_URL as provided fails TLS; every script in this
// directory strips it rather than making the caller remember.
const rawBase = process.env.N8N_BASE_URL ?? "";
const BASE = rawBase.replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
const CHECK_ONLY = process.argv.includes("--check");

if (!BASE || !KEY) {
  console.error("deploy-uc04-jurisdiction-screen: set N8N_BASE_URL and N8N_API_KEY. Exiting 2.");
  process.exit(2);
}

const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

async function getWorkflow() {
  const res = await fetch(`${BASE}/api/v1/workflows/${TARGET.workflowId}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET /workflows/${TARGET.workflowId} → ${res.status} ${res.statusText}. Exiting 2.`);
    process.exit(2);
  }
  return res.json();
}

/** Byte comparison, tolerating only trailing whitespace and a trailing newline. */
const normalize = (s) =>
  String(s ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");

function firstDifference(expected, deployed) {
  const a = expected.split("\n");
  const b = deployed.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return { line: i + 1, expected: a[i] ?? "(file ends here)", deployed: b[i] ?? "(deployed body ends here)" };
    }
  }
  return null;
}

/**
 * Read the restricted set out of a node body by evaluating just that
 * expression. Paren-matched rather than regex-terminated so reformatting the
 * literal cannot silently make this check vacuous — a compliance check that
 * quietly stops checking is the failure mode this whole script is about.
 */
function restrictedSetIn(body, label) {
  const decl = "const RESTRICTED_JURISDICTIONS = ";
  const at = body.indexOf(decl);
  if (at === -1) return { ok: false, why: `${label} declares no RESTRICTED_JURISDICTIONS — the screen is absent` };
  const start = at + decl.length;
  let depth = 0;
  let i = start;
  for (; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) break;
  }
  if (depth !== 0 || i >= body.length) return { ok: false, why: `${label}: could not parse the set literal` };
  try {
    return { ok: true, codes: [...vm.runInNewContext(body.slice(start, i + 1))].sort() };
  } catch (err) {
    return { ok: false, why: `${label}: the set literal did not evaluate — ${err.message}` };
  }
}

const file = await readFile(path.join(ROOT, TARGET.file), "utf8");
const expected = normalize(file);
const srcCodes = [...RESTRICTED_JURISDICTIONS].sort();

let wf = await getWorkflow();
const nodeOf = (w) => (w.nodes ?? []).find((n) => n.name === TARGET.node);

if (!nodeOf(wf)) {
  console.error(`✖ ${TARGET.workflow}: no node named "${TARGET.node}". Renamed in n8n, or this target is stale. Exiting 2.`);
  process.exit(2);
}

const bytesMatch = () => normalize(nodeOf(wf).parameters?.jsCode) === expected;
const isLive = () => wf.versionId && wf.versionId === wf.activeVersionId;

console.log(`${TARGET.workflow} (${TARGET.workflowId}) · node "${TARGET.node}"`);
console.log(`  active:            ${wf.active}`);
console.log(`  bytes match file:  ${bytesMatch()}`);
console.log(`  versionId:         ${wf.versionId}`);
console.log(`  activeVersionId:   ${wf.activeVersionId}`);

if (bytesMatch() && isLive()) {
  console.log("= already deployed and live — nothing written.");
} else if (CHECK_ONLY) {
  console.error("✖ production is out of date (--check: nothing written).");
  process.exit(1);
} else {
  const node = nodeOf(wf);
  node.parameters = { ...node.parameters, jsCode: file };

  // The public API rejects read-only fields on write, and returns keys under
  // `settings` that it refuses to accept back. Send only what it owns.
  const ALLOWED_SETTINGS = [
    "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
    "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
    "errorWorkflow", "timezone", "callerPolicy", "callerIds",
  ];
  const settings = Object.fromEntries(
    Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
  );

  const put = await fetch(`${BASE}/api/v1/workflows/${TARGET.workflowId}`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
  });
  if (!put.ok) {
    console.error(`✖ PUT → ${put.status} ${(await put.text()).slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`→ wrote ${file.length} bytes into "${TARGET.node}"`);

  wf = await getWorkflow();

  // A PUT on this API publishes in place, but "publishes in place" is a claim
  // about the server, not a guarantee — if the draft did not become the active
  // version, say so and activate explicitly rather than reporting a deploy.
  if (!isLive()) {
    const act = await fetch(`${BASE}/api/v1/workflows/${TARGET.workflowId}/activate`, { method: "POST", headers: H });
    if (!act.ok) {
      console.error(`✖ activate → ${act.status} ${(await act.text()).slice(0, 300)}`);
      process.exit(1);
    }
    wf = await getWorkflow();
    console.log("→ activated explicitly (the PUT alone had not promoted the draft)");
  }
}

// --- post-conditions, all read back from production ------------------------
let failed = 0;

const deployedBody = nodeOf(wf).parameters?.jsCode ?? "";
const diff = firstDifference(expected, normalize(deployedBody));
if (diff) {
  failed++;
  console.error(`✖ BYTES: deployed body differs from ${TARGET.file} at line ${diff.line}`);
  console.error(`    file:     ${diff.expected}`);
  console.error(`    deployed: ${diff.deployed}`);
} else {
  console.log(`✔ BYTES: deployed body is byte-identical to ${TARGET.file} (${deployedBody.length} bytes)`);
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

const deployedSet = restrictedSetIn(deployedBody, "the deployed body");
if (!deployedSet.ok) {
  failed++;
  console.error(`✖ SEMANTICS: ${deployedSet.why}`);
} else if (deployedSet.codes.length === 0) {
  failed++;
  console.error("✖ SEMANTICS: the deployed restricted set is EMPTY — the screen is vacuous in production");
} else if (JSON.stringify(deployedSet.codes) !== JSON.stringify(srcCodes)) {
  failed++;
  console.error("✖ SEMANTICS: production blocks a different set of jurisdictions than src/uc04/riskMatrix.js");
  console.error(`    src:      ${srcCodes.join(", ")}`);
  console.error(`    deployed: ${deployedSet.codes.join(", ")}`);
} else {
  console.log(`✔ SEMANTICS: production blocks exactly src/'s ${srcCodes.length} jurisdictions (${srcCodes.join(", ")})`);
}

process.exit(failed === 0 ? 0 : 1);
