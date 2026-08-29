#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-deployed-nodes.mjs — does n8n actually run the code we tested?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The gates existed in THREE copies, not two, and nothing caught it.
//
//   1. src/uc01/policyEngine.js      — the Node app
//   2. workflows/nodes/gates.js      — the n8n Code node body, as a file
//   3. the body actually deployed in n8n
//
// test/n8nParity.test.js proves (1) and (2) agree. Nothing proved (3) matched
// (2), and on 2026-08-16 it did not: the deployed body was missing the
// over-scope disclosure gate (F-17), the fail-closed confidence check (F-19)
// and out_of_scope routing. All three fixes were written, reviewed, tested,
// committed and pushed — and none of them were running for a single customer.
//
// A parity test between two files you control is the easy half. The half that
// matters is whether the thing serving traffic is either of them. That is what
// this script checks, and it is why a deploy is not done when the commit lands.
//
// USAGE
//   N8N_BASE_URL=https://... N8N_API_KEY=... node scripts/verify-deployed-nodes.mjs
//
// Exits 0 when every mapping matches, 1 on any drift, 2 on a config/transport
// problem. The three exit codes are distinct on purpose: "the deployment is
// wrong" and "I could not tell you whether the deployment is wrong" are
// different answers, and CI must not treat the second as a pass.
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this the
                          // check exits 2 on a machine that HAS them, and an
                          // exit 2 is indistinguishable from a real inability
                          // to reach n8n — the failure this file exists to avoid
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { structuralNodeIssues, MAPPINGS, STRUCTURAL_MAPPINGS } from "./lib/deployedNodeMappings.mjs";
import { uncheckedNodes, ratchetViolations, loadBaseline } from "./lib/nodeCoverage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "scripts/lib/unguarded-node-baseline.json");

// Strip trailing slashes AND a trailing dot. A dot is a legal DNS root label,
// so `host.example.org.` resolves — but it does not match the TLS certificate,
// and the failure surfaces as a bare "fetch failed" with nothing pointing at
// the URL. Warn rather than fix silently: a malformed value in the environment
// is worth knowing about even when it is recoverable.
const rawBase = process.env.N8N_BASE_URL ?? "";
const BASE = rawBase.replace(/[/.]+$/, "");
if (BASE !== rawBase.replace(/\/+$/, "")) {
  console.warn(
    `note: N8N_BASE_URL has a trailing dot (${rawBase}). Using ${BASE}.\n` +
      `      Worth correcting at the source — as provided it fails TLS.`
  );
}
const KEY = process.env.N8N_API_KEY;

if (!BASE || !KEY) {
  console.error(
    "verify-deployed-nodes: set N8N_BASE_URL and N8N_API_KEY.\n" +
      "This check cannot run without them, and a skipped check must never look\n" +
      "like a passing one — exiting 2."
  );
  process.exit(2);
}

/**
 * Compare ignoring only trailing whitespace per line and a trailing newline.
 * Everything else — including comments — is significant: a comment that has
 * drifted is a comment that is now lying to whoever reads the node in the n8n
 * UI, which is exactly the audience least able to check it against the repo.
 */
const normalize = (s) =>
  String(s ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");

function firstDifference(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      return {
        line: i + 1,
        expected: al[i] ?? "(file has no such line)",
        deployed: bl[i] ?? "(deployed body has no such line)",
      };
    }
  }
  return null;
}

async function fetchWorkflow(id) {
  const res = await fetch(`${BASE}/api/v1/workflows/${id}`, {
    headers: { "X-N8N-API-KEY": KEY, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET /workflows/${id} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Strip comments and blank lines, so a difference can be reported as
 * behaviour-changing or merely editorial. Both are drift and both fail — but
 * "the comments disagree" and "the logic disagrees" need different urgency at
 * 3am, and a checker that cannot tell them apart gets ignored.
 */
const codeOnly = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1").trim())
    .filter(Boolean)
    .join("\n");

let drifted = 0;
let checked = 0;
let unpublished = 0;
let totalLiveNodes = 0;
let totalUncheckedNodes = 0;
let ratchetFailures = 0;

// The committed "already knew about this" list — see scripts/lib/
// unguarded-node-baseline.json's own header. Loading it BEFORE the fetch loop
// means a missing/malformed baseline is reported once, not once per workflow.
const baseline = await loadBaseline(BASELINE_PATH);

// One fetch per workflow, not per node. Structural entries can name a
// workflowId no jsCode MAPPINGS row touches, so both feed the same fetch set.
const byWorkflow = new Map();
for (const m of MAPPINGS) {
  if (!byWorkflow.has(m.workflowId)) byWorkflow.set(m.workflowId, []);
  byWorkflow.get(m.workflowId).push(m);
}
for (const m of STRUCTURAL_MAPPINGS) {
  if (!byWorkflow.has(m.workflowId)) byWorkflow.set(m.workflowId, []);
}
const workflowNameFor = (workflowId) =>
  MAPPINGS.find((m) => m.workflowId === workflowId)?.workflow ??
  STRUCTURAL_MAPPINGS.find((m) => m.workflowId === workflowId)?.workflow ??
  workflowId;

for (const [workflowId, mappings] of byWorkflow) {
  let workflow;
  try {
    workflow = await fetchWorkflow(workflowId);
  } catch (err) {
    console.error(`✖ ${workflowNameFor(workflowId)}: could not read the workflow — ${err.message}`);
    process.exit(2);
  }

  for (const m of mappings) {
    const node = (workflow.nodes ?? []).find((n) => n.name === m.node);
    if (!node) {
      console.error(
        `✖ ${m.workflow}: no node named "${m.node}". Either it was renamed in n8n ` +
          `or this script's mapping is stale — both are drift.`
      );
      drifted++;
      continue;
    }

    const expected = normalize(await readFile(path.join(ROOT, m.file), "utf8"));
    const deployed = normalize(node.parameters?.jsCode);
    checked++;

    if (expected === deployed) {
      console.log(`✔ ${m.node}  ←  ${m.file}`);
      continue;
    }

    drifted++;
    const editorial = codeOnly(expected) === codeOnly(deployed);
    const diff = firstDifference(expected, deployed);
    console.error(`\n✖ DRIFT${editorial ? " (comments only)" : " — CODE DIFFERS"} — ${m.workflow} / ${m.node}`);
    console.error(`  file:     ${m.file}`);
    console.error(`  first difference at line ${diff.line}:`);
    console.error(`    in file:     ${diff.expected}`);
    console.error(`    deployed:    ${diff.deployed}`);
    if (!editorial) {
      console.error(
        `  The parity test covers the FILE. This node is what runs. They disagree,\n` +
          `  so whatever the tests prove, they are not proving it about production.`
      );
    }
  }

  // STRUCTURAL NODES — no jsCode, so the loop above never touches them.
  // Checked against the same fetched `workflow` object, no extra request.
  for (const entry of STRUCTURAL_MAPPINGS) {
    if (entry.workflowId !== workflowId) continue;

    const issues = structuralNodeIssues(workflow, entry);
    checked++;

    if (issues.length === 0) {
      console.log(`✔ ${entry.node} (${entry.type})  ←  ${entry.specFile}`);
      continue;
    }

    drifted++;
    console.error(`\n✖ DRIFT — ${entry.workflow} / ${entry.node} (structural, no jsCode)`);
    console.error(`  spec:     ${entry.specFile}`);
    for (const issue of issues) console.error(`    - ${issue}`);
    console.error(
      `  No parity test between two files can see this — this node has no jsCode\n` +
        `  body at all. Redeploy the rule set / wiring to match the spec, or update\n` +
        `  the spec if the live change was intentional.`
    );
  }

  // COVERAGE — every live node NEITHER diffed (MAPPINGS) NOR structurally
  // checked (STRUCTURAL_MAPPINGS) at all. This is what makes "0 drifted" above
  // meaningless on its own: it only ever describes the nodes this script
  // looked at, and a node in this list is one it never opened. Printed on
  // EVERY run, including a fully clean one — see this file's header incident
  // list, all four of which shipped unguarded while "0 drifted" read as "the
  // deployment is fine."
  const unchecked = uncheckedNodes(workflow, workflowId, MAPPINGS, STRUCTURAL_MAPPINGS);
  totalLiveNodes += (workflow.nodes ?? []).length;
  totalUncheckedNodes += unchecked.length;
  if (unchecked.length > 0) {
    console.log(
      `\n✱ UNCHECKED — ${workflowNameFor(workflowId)}: ${unchecked.length} of ` +
        `${(workflow.nodes ?? []).length} live node(s) have no MAPPINGS or STRUCTURAL_MAPPINGS ` +
        `row — not diffed, not structurally checked, not looked at:`
    );
    for (const n of unchecked) console.log(`    - ${n.node} (${n.type})`);
  }

  // THE RATCHET — an unchecked node absent from the committed baseline is
  // either freshly added to the live graph, or a node that USED TO be checked
  // and quietly lost its MAPPINGS/STRUCTURAL_MAPPINGS row. Both are exactly
  // the shape every incident in this file's header is. Today's known debt is
  // pre-seeded into the baseline (see docs/DEPLOYED-NODE-COVERAGE.md for the
  // inventory it was generated from), so this does NOT fail on the nodes
  // already unchecked as of this bead — only on a NEW one.
  for (const violation of ratchetViolations(unchecked, baseline)) {
    ratchetFailures++;
    console.error(
      `\n✖ RATCHET — ${workflowNameFor(violation.workflowId)} / ${violation.node} (${violation.type})\n` +
        `  is unchecked and NOT in the committed baseline\n` +
        `  (scripts/lib/unguarded-node-baseline.json). Either it is a newly added\n` +
        `  node that needs a MAPPINGS/STRUCTURAL_MAPPINGS row, or a row that used to\n` +
        `  cover it was removed — both are the drift this ratchet exists to catch.\n` +
        `  If this is genuinely accepted debt, add it to the baseline file with a\n` +
        `  reason and cite it in docs/DEPLOYED-NODE-COVERAGE.md.`
    );
  }

  // THE SECOND HALF OF THE QUESTION, and the one that is easy to miss.
  //
  // n8n's REST API returns the DRAFT's nodes. So every ✔ above means "the file
  // matches the draft" — which says nothing about what is serving traffic. A
  // workflow with unpublished changes can pass every node comparison while
  // production runs something else entirely. Only file == draft AND
  // versionId == activeVersionId together mean the tested code is live.
  if (workflow.versionId && workflow.activeVersionId && workflow.versionId !== workflow.activeVersionId) {
    unpublished++;
    console.error(
      `\n✖ UNPUBLISHED — ${workflowNameFor(workflowId)}\n` +
        `  draft:      ${workflow.versionId}\n` +
        `  production: ${workflow.activeVersionId}\n` +
        `  The node checks above compared the DRAFT. Production is running a\n` +
        `  different version, so those ticks do not describe live behaviour.`
    );
  }
}

console.log(
  `\n${checked} node${checked === 1 ? "" : "s"} checked · ${drifted} drifted · ` +
    `${unpublished} workflow${unpublished === 1 ? "" : "s"} with unpublished changes · ` +
    `${totalUncheckedNodes} of ${totalLiveNodes} live nodes NOT checked at all (no MAPPINGS or ` +
    `STRUCTURAL_MAPPINGS row) · ${ratchetFailures} new unguarded node${ratchetFailures === 1 ? "" : "s"} ` +
    `failing the ratchet.`
);

if (totalUncheckedNodes > 0 && ratchetFailures === 0) {
  console.log(
    `\nnote: ${totalUncheckedNodes} unchecked node(s) above are ACCEPTED DEBT, pinned in\n` +
      `scripts/lib/unguarded-node-baseline.json and inventoried in\n` +
      `docs/DEPLOYED-NODE-COVERAGE.md. "0 drifted" describes only the ${checked} node(s)\n` +
      `this run actually compared — it is not a claim about the other ${totalUncheckedNodes}.`
  );
}

if (drifted > 0 || unpublished > 0 || ratchetFailures > 0) {
  if (drifted > 0) {
    console.error("\nRedeploy the drifted node(s) from their files.");
  }
  if (unpublished > 0) {
    console.error("Publish the workflow(s) above — an update writes a draft, it does not go live.");
  }
  if (ratchetFailures > 0) {
    console.error(
      "A new unguarded node appeared above (see the RATCHET line(s)) — add coverage or baseline it, on purpose."
    );
  }
  process.exit(1);
}
