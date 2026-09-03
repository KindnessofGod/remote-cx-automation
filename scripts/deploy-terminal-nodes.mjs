// ---------------------------------------------------------------------------
// deploy-terminal-nodes.mjs — publish the terminal Zendesk nodes' parameters
// from their versioned specs, and CHECK THE DESTINATION rather than the PUT
// ---------------------------------------------------------------------------
// WHY THIS SCRIPT EXISTS RATHER THAN A HAND EDIT PER NODE
//
// The 2026-08-31 audit found wrong prose on terminal Zendesk nodes across seven
// graphs. A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/deploy-node.mjs` — which publishes ONE Code-node body from ONE file
// — cannot touch them. They were typed by hand into node parameters, which is
// exactly how they came to be wrong and unversioned.
//
// TWO THINGS THIS DOES THAT A HAND EDIT DOES NOT:
//
//   1. It reads the target out of the spec file, so the deployed node and the
//      thing `npm run verify-deployed` checks it against cannot disagree —
//      they are the same object.
//   2. It READS THE NODE BACK and runs the spec's own checker against what the
//      API returned. A PUT that answers 200 has told you the request was
//      accepted, not that the graph changed: `CLAUDE.md` §6 records a whole
//      class of this ("a pinned node reports success having done nothing";
//      "check the destination, never the run status"). Every mutation here is
//      verified from the read, and a non-empty issue list is a failure even
//      when the PUT was clean.
//
// SETTINGS WHITELIST. n8n RETURNS settings keys on read that it REFUSES on
// write — a straight round-trip answers `400 settings must NOT have additional
// properties`. Same list `scripts/deploy-node.mjs` uses; keep them in step.
//
// Exits 2 — never 0 — when it cannot reach n8n, so a skipped run can never be
// misread as a passing one. Same contract as every other verify/deploy script
// here.
// ---------------------------------------------------------------------------

import "dotenv/config";

const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution",
  "saveManualExecutions", "saveExecutionProgress", "executionTimeout",
  "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[.\/]+$/, "");
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error("N8N_BASE_URL / N8N_API_KEY unset — cannot reach n8n. Exiting 2, not 0.");
  process.exit(2);
}
const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json" };

/**
 * Every spec that owns terminal-Zendesk-node parameters, and the checker it
 * exports. Add a row when a use case gains one. `nodes` is a list of
 * `{ node, parameters, check }`.
 */
async function collectTargets() {
  const targets = new Map(); // "workflowId|node" -> {parameters, checks: []}
  const add = (workflowId, node, parameters, check) => {
    const key = `${workflowId}|${node}`;
    const prev = targets.get(key);
    if (prev) {
      // Two specs may own DIFFERENT DIMENSIONS of one node (prose vs the D-14
      // queue tag). They are held equal by a cross-spec test, so a disagreement
      // here means that test is missing or stale — refuse rather than pick.
      if (JSON.stringify(prev.parameters) !== JSON.stringify(parameters)) {
        throw new Error(
          `two specs disagree about ${key}. Publishing either would revert the other; ` +
            `fix both in one change and add a cross-spec test.`
        );
      }
      prev.checks.push(check);
      return;
    }
    targets.set(key, { workflowId, node, parameters, checks: [check] });
  };

  for (const path of process.argv.slice(2)) {
    const mod = await import(path.startsWith("/") ? path : `../${path}`.replace("../", `${process.cwd()}/`));
    if (typeof mod.collectDeployTargets === "function") {
      for (const t of mod.collectDeployTargets()) add(t.workflowId, t.node, t.parameters, t.check);
      continue;
    }
    // Convention fallback: a spec exporting DEPLOY_TARGETS.
    for (const t of mod.DEPLOY_TARGETS ?? []) add(t.workflowId, t.node, t.parameters, t.check);
  }
  return [...targets.values()];
}

const targets = await collectTargets();
if (targets.length === 0) {
  console.error("no deploy targets collected — pass spec module paths as arguments. Exiting 2.");
  process.exit(2);
}

const byWorkflow = new Map();
for (const t of targets) {
  if (!byWorkflow.has(t.workflowId)) byWorkflow.set(t.workflowId, []);
  byWorkflow.get(t.workflowId).push(t);
}

let failures = 0;
for (const [workflowId, nodes] of byWorkflow) {
  const res = await fetch(`${BASE}/api/v1/workflows/${workflowId}`, { headers: H });
  if (!res.ok) { console.error(`✘ ${workflowId} GET ${res.status}`); failures++; continue; }
  const wf = await res.json();

  let changed = 0;
  for (const t of nodes) {
    const node = (wf.nodes ?? []).find((n) => n.name === t.node);
    if (!node) { console.error(`  ✘ ${workflowId} "${t.node}" NOT FOUND`); failures++; continue; }
    // ONLY updateFields is replaced. `credentials`, `typeVersion`, `position`,
    // `onError` and the node id are left exactly as the live graph has them —
    // an inbound credential swap is one of the ways this repo has nearly
    // broken production before (CLAUDE.md §6, the httpHeaderAuth dropdown).
    node.parameters = { ...node.parameters, ...t.parameters };
    changed++;
  }

  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))),
  };
  const put = await fetch(`${BASE}/api/v1/workflows/${workflowId}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (!put.ok) { console.error(`  ✘ ${workflowId} PUT ${put.status}: ${(await put.text()).slice(0, 200)}`); failures++; continue; }

  // THE READ-BACK. This, not the PUT's status, is the evidence.
  const after = await (await fetch(`${BASE}/api/v1/workflows/${workflowId}`, { headers: H })).json();
  const issues = [];
  for (const t of nodes) {
    const live = (after.nodes ?? []).find((n) => n.name === t.node);
    for (const check of t.checks) issues.push(...check(live).map((i) => `${t.node}: ${i}`));
  }
  const published = after.versionId === after.activeVersionId;
  const ok = issues.length === 0 && published;
  if (!ok) failures++;
  console.log(
    `${ok ? "✔" : "✘"} ${workflowId} — ${changed} node(s) | active ${after.active} | ` +
      `versionId===activeVersionId ${published} | issues after read-back: ${issues.length}`
  );
  for (const i of issues) console.log(`      ${i.slice(0, 200)}`);
}

if (failures > 0) { console.error(`\n${failures} workflow(s) failed. Exiting 1.`); process.exit(1); }
console.log("\nAll targets deployed and verified from the read-back.");
