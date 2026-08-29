#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-uc01-consent-lookup.mjs — splice the "Lookup Consent Records"
// Supabase node into UC-01's live graph, and prove it got there
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, RATHER THAN `npm run deploy-node` (rca-wn30 / R7-18 / K4)
//
// deploy-node.mjs writes a file's bytes into an EXISTING node and stops. This
// bead adds a NEW node and rewires two connections around it, which is outside
// what a node-by-name body write can do — and that is precisely why R7-18 sat
// open: `qa/HUMAN-DECISIONS-REQUIRED.md` §K4 calls it "a graph-shape change no
// Code-node edit can make". §K4 authorised exactly one such change, on this
// graph, for this lookup, and nothing else.
//
// WHAT IT DOES
//   1. adds/updates "Lookup Consent Records" (Supabase getAll on
//      `consent_records`, joined to `cases` by employment id — see
//      workflows/nodes/consentLookupSpec.js for every parameter and why);
//   2. writes workflows/nodes/gates.js into "Identity + Policy Gates", which
//      in the same commit stops reading the employment off `$input` (this new
//      node now occupies it) and starts reading the consent rows;
//   3. rewires Fetch Employment (Remote) -> Lookup Consent Records ->
//      Identity + Policy Gates.
//
// FOUR POST-CONDITIONS, all read back from production, none inferred from a
// 200 — §K4's own warning is that "an MCP write addressed to a nested key can
// report success, bump activeVersionId, and deploy nothing":
//   1. BYTES.     "Identity + Policy Gates", re-read from n8n, matches the file.
//   2. LIVE.      activeVersionId === versionId (a REST PUT publishes in place;
//                 the n8n MCP's update_workflow only drafts — CLAUDE.md §6).
//   3. STRUCTURE. Both STRUCTURAL_MAPPINGS entries for this change
//                 (scripts/lib/deployedNodeMappings.mjs) report zero issues
//                 against the graph as it now stands — including the two
//                 node-level flags (`alwaysOutputData`, `onError`) and the
//                 no-bypass check on "Fetch Employment (Remote)".
//   4. CREDENTIAL. The new node carries the same supabaseApi credential every
//                 other Supabase node on this graph carries, lifted off
//                 "Append Audit Log" rather than hard-coded, so a rotation
//                 only ever happens once, in n8n.
//
// USAGE (no npm alias — package.json was owned by another agent in this
// round, and a one-shot splice does not earn a permanent verb anyway; it is
// idempotent, so a re-run on an up-to-date graph writes nothing and exits 0):
//
//   NODE_USE_ENV_PROXY=1 node scripts/deploy-uc01-consent-lookup.mjs [--check]
//
// Exits 2 — never 0 — when it cannot reach n8n, so a skipped run can never be
// misread as a passing one. `--check` diagnoses and writes nothing.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NODE_NAME,
  NODE_TYPE,
  TABLE_ID,
  RESOURCE,
  OPERATION,
  UPSTREAM_NODE,
  DOWNSTREAM_NODE,
  FILTER_TYPE,
  FILTER_STRING,
  RETURN_ALL,
  LIMIT,
} from "../workflows/nodes/consentLookupSpec.js";
import { STRUCTURAL_MAPPINGS, structuralNodeIssues } from "./lib/deployedNodeMappings.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_ID = "WORKFLOW_UC01_ID";
const WORKFLOW_NAME = "UC-01 — Employment Verification";
const GATES_FILE = "workflows/nodes/gates.js";
const CREDENTIAL_DONOR_NODE = "Append Audit Log";
const CHECK_ONLY = process.argv.includes("--check");

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error("deploy-uc01-consent-lookup: set N8N_BASE_URL and N8N_API_KEY. Exiting 2.");
  process.exit(2);
}
const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

async function getWorkflow() {
  const res = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, { headers: H });
  if (!res.ok) {
    console.error(`✖ GET ${WORKFLOW_ID} → ${res.status} ${(await res.text()).slice(0, 200)}. Exiting 2.`);
    process.exit(2);
  }
  return res.json();
}

/** Trailing-newline-insensitive compare, the same normalisation deploy-node uses. */
const normalize = (s) => (s ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");

/** The two STRUCTURAL_MAPPINGS rows this change is guarded by. */
const GUARD_ENTRIES = STRUCTURAL_MAPPINGS.filter(
  (m) => m.workflowId === WORKFLOW_ID && (m.node === NODE_NAME || m.node === UPSTREAM_NODE)
);

function diagnose(wf, gatesFile) {
  const issues = [];
  for (const entry of GUARD_ENTRIES) {
    for (const i of structuralNodeIssues(wf, entry)) issues.push(`${entry.node}: ${i}`);
  }
  const gates = (wf.nodes ?? []).find((n) => n.name === DOWNSTREAM_NODE);
  if (!gates) issues.push(`no node named "${DOWNSTREAM_NODE}"`);
  else if (normalize(gates.parameters?.jsCode) !== normalize(gatesFile)) {
    issues.push(`"${DOWNSTREAM_NODE}" body differs from ${GATES_FILE}`);
  }
  return issues;
}

const gatesFile = await readFile(path.join(ROOT, GATES_FILE), "utf8");
let wf = await getWorkflow();
const isLive = () => wf.versionId && wf.versionId === wf.activeVersionId;

console.log(`${WORKFLOW_NAME} (${WORKFLOW_ID})`);
console.log(`  active:          ${wf.active}`);
console.log(`  versionId:       ${wf.versionId}`);
console.log(`  activeVersionId: ${wf.activeVersionId}`);
console.log(`  nodes:           ${(wf.nodes ?? []).length}`);

let issues = diagnose(wf, gatesFile);
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

const fetchEmployment = nodeByName(UPSTREAM_NODE);
const gatesNode = nodeByName(DOWNSTREAM_NODE);
if (!fetchEmployment || !gatesNode) {
  console.error(`✖ missing "${UPSTREAM_NODE}" or "${DOWNSTREAM_NODE}" — cannot splice. Exiting 2.`);
  process.exit(2);
}

const donor = nodeByName(CREDENTIAL_DONOR_NODE);
const supabaseCredential = donor?.credentials?.supabaseApi;
if (!supabaseCredential) {
  console.error(`✖ could not read the Supabase credential off "${CREDENTIAL_DONOR_NODE}". Exiting 2.`);
  process.exit(2);
}

let lookup = nodeByName(NODE_NAME);
if (!lookup) {
  lookup = {
    id: randomUUID(),
    name: NODE_NAME,
    type: NODE_TYPE,
    typeVersion: 1,
    // Midway between the two nodes it splices, on their own y. A fan-out's
    // branch order is decided by canvas position (CLAUDE.md §6), so a node
    // spliced into a LINEAR run must not be given a y of its own — this one
    // shares 288 with the whole spine for that reason.
    position: [
      Math.round((fetchEmployment.position[0] + gatesNode.position[0]) / 2),
      fetchEmployment.position[1],
    ],
    parameters: {},
  };
  wf.nodes.push(lookup);
}
lookup.credentials = { supabaseApi: supabaseCredential };
lookup.parameters = {
  resource: RESOURCE,
  operation: OPERATION,
  tableId: TABLE_ID,
  returnAll: RETURN_ALL,
  limit: LIMIT,
  filterType: FILTER_TYPE,
  filterString: FILTER_STRING,
};
// Both load-bearing; see consentLookupSpec.js's header. Without the first, a
// zero-row lookup emits nothing and the gates never run — UC-01 would answer
// NOTHING for every employee with no consent row, which is nearly all of them.
lookup.alwaysOutputData = true;
lookup.onError = "continueRegularOutput";

gatesNode.parameters = { ...gatesNode.parameters, jsCode: gatesFile };

// Rewire: Fetch Employment (Remote) -> Lookup Consent Records -> Identity + Policy Gates
wf.connections[UPSTREAM_NODE] = { main: [[{ node: NODE_NAME, type: "main", index: 0 }]] };
wf.connections[NODE_NAME] = { main: [[{ node: DOWNSTREAM_NODE, type: "main", index: 0 }]] };

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];
const settings = Object.fromEntries(
  Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))
);

const put = await fetch(`${BASE}/api/v1/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: H,
  body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
});
if (!put.ok) {
  console.error(`✖ PUT → ${put.status} ${(await put.text()).slice(0, 500)}`);
  process.exit(1);
}
console.log("→ wrote the updated graph (1 node added/updated, 1 node body written, 2 connections rewired)");

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

const finalGates = (wf.nodes ?? []).find((n) => n.name === DOWNSTREAM_NODE);
if (normalize(finalGates?.parameters?.jsCode) !== normalize(gatesFile)) {
  console.error(`✖ BYTES: "${DOWNSTREAM_NODE}" read back from n8n does not match ${GATES_FILE}`);
  failed++;
} else {
  console.log(`✔ BYTES: "${DOWNSTREAM_NODE}" matches ${GATES_FILE} (${gatesFile.length} bytes)`);
}

const finalLookup = (wf.nodes ?? []).find((n) => n.name === NODE_NAME);
if (!finalLookup?.credentials?.supabaseApi?.id) {
  console.error(`✖ CREDENTIAL: "${NODE_NAME}" read back with no supabaseApi credential attached`);
  failed++;
} else {
  console.log(
    `✔ CREDENTIAL: "${NODE_NAME}" carries supabaseApi ${finalLookup.credentials.supabaseApi.id}` +
      ` ("${finalLookup.credentials.supabaseApi.name}")`
  );
}

const structural = diagnose(wf, gatesFile).filter((i) => !i.startsWith(`"${DOWNSTREAM_NODE}" body`));
if (structural.length) {
  console.error("✖ STRUCTURE: the guard entries still report issues against the LIVE graph:");
  for (const i of structural) console.error(`    - ${i}`);
  failed++;
} else {
  console.log(`✔ STRUCTURE: ${GUARD_ENTRIES.length} guard entr(y|ies) clean against the live graph`);
}

if (!isLive()) {
  console.error(`✖ LIVE: activeVersionId (${wf.activeVersionId}) !== versionId (${wf.versionId}) — production runs the OLD graph`);
  failed++;
} else {
  console.log(`✔ LIVE: activeVersionId === versionId (${wf.versionId})`);
}

console.log(`  nodes now: ${(wf.nodes ?? []).length}`);
process.exit(failed ? 1 : 0);
