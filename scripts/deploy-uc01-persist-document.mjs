#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-uc01-persist-document.mjs — put a durable copy of the letter into
// production, and prove it got there
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, RATHER THAN `npm run deploy-node`
//
// deploy-node.mjs writes a file's bytes into an EXISTING node and stops. This
// bead (rca-uim / DRIFT-086) needs more than that: the live auto_resolve chain
// was `Render Letter -> Reply + Solve Ticket` with nothing between rendering
// the letter and posting it, so the fix is two NEW nodes (a Code node that
// hashes the letter, a Supabase node that writes it) spliced into the middle
// of that chain, plus one existing Code node ("Carry Context Forward")
// edited so the new Supabase node has a case_id to write. Adding nodes and
// rewiring connections is outside what deploy-node.mjs's node-by-name lookup
// can do.
//
// WHY "Carry Context Forward" HAS ITS OWN FILE NOW. It never had one — none of
// the three "Carry Context ..." nodes do; they were hand-authored only in the
// live graph, invisible to `npm run verify-deployed`'s jsCode MAPPINGS. This
// bead has to edit its body anyway (to carry `caseId` forward from "Persist
// Case"), so the edit is made through a real file
// (workflows/nodes/carryContextForward.js) and that file is registered in
// verify-deployed-nodes.mjs's MAPPINGS below, per CLAUDE.md §6's rule that a
// node body is never a template literal typed into a builder. The other two
// "Carry Context ..." nodes are untouched and stay as they were — expanding
// their coverage is not this bead's job.
//
// THREE POST-CONDITIONS, all checked after the write, none inferred from a 200:
//   1. BYTES.    Both edited/added Code node bodies, re-read from n8n, match
//                their files exactly.
//   2. LIVE.     activeVersionId === versionId (a REST PUT publishes in place;
//                the n8n MCP's update_workflow only drafts — CLAUDE.md §6).
//   3. STRUCTURE. "Persist Document" exists, is a Supabase node targeting the
//                `documents` table, and sits strictly between "Render Letter"
//                and "Reply + Solve Ticket" — read back from the live graph's
//                connections, not assumed from the write succeeding. This is
//                the same class of check scripts/lib/structuralNodeChecks.mjs
//                runs for `Route by Decision` (rca-vqe), reused here via
//                structuralNodeIssues() rather than re-invented.
//
// Idempotent and re-runnable: if the deployed graph already matches (bytes,
// live, structure), it writes nothing and exits 0.
//
// USAGE
//   NODE_USE_ENV_PROXY=1 N8N_BASE_URL=... N8N_API_KEY=... \
//     node scripts/deploy-uc01-persist-document.mjs [--check]
//
//   --check   verify only; never write. Exit 1 if production is out of date.
//
// Exit codes: 0 in sync, 1 drifted/failed, 2 could not tell (config/transport).
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { structuralNodeIssues } from "./lib/structuralNodeChecks.mjs";
import {
  NODE_NAME as PERSIST_DOCUMENT_NODE,
  NODE_TYPE as PERSIST_DOCUMENT_TYPE,
  TABLE_ID as PERSIST_DOCUMENT_TABLE_ID,
  OPERATION as PERSIST_DOCUMENT_OPERATION,
  FIELDS as PERSIST_DOCUMENT_FIELDS,
  UPSTREAM_NODE as PERSIST_DOCUMENT_UPSTREAM,
  DOWNSTREAM_NODE,
  FINAL_TARGET_NODE,
  persistDocumentParamIssues,
} from "../workflows/nodes/persistDocumentSpec.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WORKFLOW_ID = "WORKFLOW_UC01_ID";
const WORKFLOW_NAME = "UC-01 — Employment Verification";

const CARRY_CONTEXT_FORWARD = { node: "Carry Context Forward", file: "workflows/nodes/carryContextForward.js" };
const PREPARE_DOCUMENT = { node: PERSIST_DOCUMENT_UPSTREAM, file: "workflows/nodes/prepareDocument.js" };
const CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT = { node: DOWNSTREAM_NODE, file: "workflows/nodes/carryContextAfterPersistDocument.js" };

const UPSTREAM_NODE = "Render Letter";

const rawBase = process.env.N8N_BASE_URL ?? "";
const BASE = rawBase.replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
const CHECK_ONLY = process.argv.includes("--check");

if (!BASE || !KEY) {
  console.error("deploy-uc01-persist-document: set N8N_BASE_URL and N8N_API_KEY. Exiting 2.");
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

const carryContextForwardFile = normalize(await readFile(path.join(ROOT, CARRY_CONTEXT_FORWARD.file), "utf8"));
const prepareDocumentFile = normalize(await readFile(path.join(ROOT, PREPARE_DOCUMENT.file), "utf8"));
const carryContextAfterPersistDocumentFile = normalize(await readFile(path.join(ROOT, CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.file), "utf8"));

/** Everything true of the target shape, read off a fetched workflow object. */
function diagnose(wf) {
  const nodeByName = (name) => (wf.nodes ?? []).find((n) => n.name === name);
  const issues = [];

  const ccf = nodeByName(CARRY_CONTEXT_FORWARD.node);
  if (!ccf) issues.push(`no node named "${CARRY_CONTEXT_FORWARD.node}"`);
  else if (normalize(ccf.parameters?.jsCode) !== carryContextForwardFile) issues.push(`"${CARRY_CONTEXT_FORWARD.node}" body drifted from ${CARRY_CONTEXT_FORWARD.file}`);

  const prep = nodeByName(PREPARE_DOCUMENT.node);
  if (!prep) issues.push(`no node named "${PREPARE_DOCUMENT.node}"`);
  else if (normalize(prep.parameters?.jsCode) !== prepareDocumentFile) issues.push(`"${PREPARE_DOCUMENT.node}" body drifted from ${PREPARE_DOCUMENT.file}`);

  const restore = nodeByName(CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node);
  if (!restore) issues.push(`no node named "${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node}"`);
  else if (normalize(restore.parameters?.jsCode) !== carryContextAfterPersistDocumentFile) issues.push(`"${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node}" body drifted from ${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.file}`);

  const persist = nodeByName(PERSIST_DOCUMENT_NODE);
  if (!persist) {
    issues.push(`no node named "${PERSIST_DOCUMENT_NODE}"`);
  } else {
    const structural = structuralNodeIssues(wf, {
      node: PERSIST_DOCUMENT_NODE,
      type: PERSIST_DOCUMENT_TYPE,
      checkParams: persistDocumentParamIssues,
      expectedOutputs: [DOWNSTREAM_NODE],
      expectedInputs: [PREPARE_DOCUMENT.node],
    });
    issues.push(...structural);
  }

  // The chain must run THROUGH the new nodes — Render Letter must no longer
  // connect straight to Reply + Solve Ticket, and the restore node must sit
  // between "Persist Document" (whose own Supabase response overwrites
  // $json) and "Reply + Solve Ticket" (which needs the real ctx back).
  const upstreamOut = wf.connections?.[UPSTREAM_NODE]?.main?.[0] ?? [];
  if (!upstreamOut.some((c) => c.node === PREPARE_DOCUMENT.node)) {
    issues.push(`"${UPSTREAM_NODE}" does not connect to "${PREPARE_DOCUMENT.node}"`);
  }
  if (upstreamOut.some((c) => c.node === FINAL_TARGET_NODE)) {
    issues.push(`"${UPSTREAM_NODE}" still connects directly to "${FINAL_TARGET_NODE}" (bypassing the persist step)`);
  }
  const prepOut = wf.connections?.[PREPARE_DOCUMENT.node]?.main?.[0] ?? [];
  if (!prepOut.some((c) => c.node === PERSIST_DOCUMENT_NODE)) {
    issues.push(`"${PREPARE_DOCUMENT.node}" does not connect to "${PERSIST_DOCUMENT_NODE}"`);
  }
  const restoreOut = wf.connections?.[CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node]?.main?.[0] ?? [];
  if (!restoreOut.some((c) => c.node === FINAL_TARGET_NODE)) {
    issues.push(`"${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node}" does not connect to "${FINAL_TARGET_NODE}"`);
  }

  return issues;
}

let wf = await getWorkflow();
const isLive = () => wf.versionId && wf.versionId === wf.activeVersionId;

console.log(`${WORKFLOW_NAME} (${WORKFLOW_ID})`);
console.log(`  active:          ${wf.active}`);
console.log(`  versionId:       ${wf.versionId}`);
console.log(`  activeVersionId: ${wf.activeVersionId}`);

let issues = diagnose(wf);

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

const nodeByName = (name) => (wf.nodes ?? []).find((n) => n.name === name);

const ccf = nodeByName(CARRY_CONTEXT_FORWARD.node);
if (!ccf) {
  console.error(`✖ no node named "${CARRY_CONTEXT_FORWARD.node}" — cannot edit a node that does not exist. Exiting 2.`);
  process.exit(2);
}
ccf.parameters = { ...ccf.parameters, jsCode: await readFile(path.join(ROOT, CARRY_CONTEXT_FORWARD.file), "utf8") };

const renderLetter = nodeByName(UPSTREAM_NODE);
const replyAndSolve = nodeByName(FINAL_TARGET_NODE);
if (!renderLetter || !replyAndSolve) {
  console.error(`✖ missing "${UPSTREAM_NODE}" or "${FINAL_TARGET_NODE}" — cannot splice. Exiting 2.`);
  process.exit(2);
}

let prepareDocumentNode = nodeByName(PREPARE_DOCUMENT.node);
if (!prepareDocumentNode) {
  prepareDocumentNode = {
    id: randomUUID(),
    name: PREPARE_DOCUMENT.node,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [renderLetter.position[0] + 72, renderLetter.position[1]],
    parameters: {},
  };
  wf.nodes.push(prepareDocumentNode);
}
prepareDocumentNode.parameters = {
  ...prepareDocumentNode.parameters,
  jsCode: await readFile(path.join(ROOT, PREPARE_DOCUMENT.file), "utf8"),
};

let persistDocumentNode = nodeByName(PERSIST_DOCUMENT_NODE);
if (!persistDocumentNode) {
  persistDocumentNode = {
    id: randomUUID(),
    name: PERSIST_DOCUMENT_NODE,
    type: PERSIST_DOCUMENT_TYPE,
    typeVersion: 1,
    position: [prepareDocumentNode.position[0] + 72, prepareDocumentNode.position[1]],
    credentials: {},
  };
  wf.nodes.push(persistDocumentNode);
}
// Same credential every other Supabase node on this graph uses (rca-uim reads
// it off "Append Audit Log" rather than hard-coding it, so a credential
// rotation only ever has to happen once, in n8n, and this script picks it up
// on the next run).
const auditLogNode = nodeByName("Append Audit Log");
const supabaseCredential = auditLogNode?.credentials?.supabaseApi;
if (!supabaseCredential) {
  console.error('✖ could not read the Supabase credential off "Append Audit Log". Exiting 2.');
  process.exit(2);
}
persistDocumentNode.credentials = { supabaseApi: supabaseCredential };
persistDocumentNode.parameters = {
  resource: "row",
  operation: PERSIST_DOCUMENT_OPERATION,
  tableId: PERSIST_DOCUMENT_TABLE_ID,
  dataToSend: "defineBelow",
  fieldsUi: { fieldValues: PERSIST_DOCUMENT_FIELDS },
};

// "Persist Document" is a Supabase row-create node: its OWN output replaces
// $json with the inserted `documents` row, exactly like "Persist Case" and
// "Append Audit Log" upstream of it — so "Reply + Solve Ticket" cannot read
// straight off it. This restore node is what "Carry Context Forward"/"Carry
// Context After Claim"/"Carry Context After Records" already are for their
// own Supabase predecessors. Found by this bead's own live proof (execution
// 6703, ticket #77) BEFORE this script's first deploy landed it — see
// workflows/nodes/persistDocumentSpec.js's DOWNSTREAM_NODE comment.
let restoreNode = nodeByName(CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node);
if (!restoreNode) {
  restoreNode = {
    id: randomUUID(),
    name: CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [persistDocumentNode.position[0] + 72, persistDocumentNode.position[1]],
    parameters: {},
  };
  wf.nodes.push(restoreNode);
}
restoreNode.parameters = {
  ...restoreNode.parameters,
  jsCode: await readFile(path.join(ROOT, CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.file), "utf8"),
};

// Rewire: Render Letter -> Prepare Document -> Persist Document ->
//         Carry Context After Persist Document -> Reply + Solve Ticket
wf.connections[UPSTREAM_NODE] = { main: [[{ node: PREPARE_DOCUMENT.node, type: "main", index: 0 }]] };
wf.connections[PREPARE_DOCUMENT.node] = { main: [[{ node: PERSIST_DOCUMENT_NODE, type: "main", index: 0 }]] };
wf.connections[PERSIST_DOCUMENT_NODE] = { main: [[{ node: CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node, type: "main", index: 0 }]] };
wf.connections[CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node] = { main: [[{ node: FINAL_TARGET_NODE, type: "main", index: 0 }]] };

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
console.log("→ wrote the updated graph (3 nodes added/updated, 1 node edited, connections rewired)");

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

const finalCcf = (wf.nodes ?? []).find((n) => n.name === CARRY_CONTEXT_FORWARD.node);
const ccfDiff = firstDifference(carryContextForwardFile, normalize(finalCcf?.parameters?.jsCode));
if (ccfDiff) {
  failed++;
  console.error(`✖ BYTES: "${CARRY_CONTEXT_FORWARD.node}" differs from ${CARRY_CONTEXT_FORWARD.file} at line ${ccfDiff.line}`);
  console.error(`    file:     ${ccfDiff.expected}`);
  console.error(`    deployed: ${ccfDiff.deployed}`);
} else {
  console.log(`✔ BYTES: "${CARRY_CONTEXT_FORWARD.node}" is byte-identical to ${CARRY_CONTEXT_FORWARD.file}`);
}

const finalPrep = (wf.nodes ?? []).find((n) => n.name === PREPARE_DOCUMENT.node);
const prepDiff = firstDifference(prepareDocumentFile, normalize(finalPrep?.parameters?.jsCode));
if (prepDiff) {
  failed++;
  console.error(`✖ BYTES: "${PREPARE_DOCUMENT.node}" differs from ${PREPARE_DOCUMENT.file} at line ${prepDiff.line}`);
  console.error(`    file:     ${prepDiff.expected}`);
  console.error(`    deployed: ${prepDiff.deployed}`);
} else {
  console.log(`✔ BYTES: "${PREPARE_DOCUMENT.node}" is byte-identical to ${PREPARE_DOCUMENT.file}`);
}

const finalRestore = (wf.nodes ?? []).find((n) => n.name === CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node);
const restoreDiff = firstDifference(carryContextAfterPersistDocumentFile, normalize(finalRestore?.parameters?.jsCode));
if (restoreDiff) {
  failed++;
  console.error(`✖ BYTES: "${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node}" differs from ${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.file} at line ${restoreDiff.line}`);
  console.error(`    file:     ${restoreDiff.expected}`);
  console.error(`    deployed: ${restoreDiff.deployed}`);
} else {
  console.log(`✔ BYTES: "${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.node}" is byte-identical to ${CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT.file}`);
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

const finalIssues = diagnose(wf);
if (finalIssues.length > 0) {
  failed++;
  console.error("✖ STRUCTURE: the live graph does not match the target shape:");
  for (const i of finalIssues) console.error(`    - ${i}`);
} else {
  console.log(`✔ STRUCTURE: "${PERSIST_DOCUMENT_NODE}" exists, targets "documents", and sits strictly between "${UPSTREAM_NODE}" and "${FINAL_TARGET_NODE}" (via "${DOWNSTREAM_NODE}")`);
}

process.exit(failed === 0 ? 0 : 1);
