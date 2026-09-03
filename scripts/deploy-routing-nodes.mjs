#!/usr/bin/env node
// ---------------------------------------------------------------------------
// deploy-routing-nodes.mjs — put the `Assign Routing` node into the nine live
// graphs, and make every human-facing Zendesk update consume it
// ---------------------------------------------------------------------------
// WHY A SCRIPT AND NOT 26 HAND EDITS
//
// The change is one added node, one rewired connection and one added parameter
// on each of 26 Zendesk nodes, across nine live workflows. Done by hand that is
// 35 edits against production, each one a chance to mistype a node name into an
// expression that then resolves to nothing — silently, because a ticket that
// fails to be assigned looks exactly like a ticket nobody assigned.
//
// This derives every value from `src/shared/escalationRouting.js` and from the
// LIVE graph it is editing, and it is idempotent: run it twice and the second
// run reports `=` for everything.
//
// TWO THINGS IT REFUSES TO GUESS
//
//   1. WHICH NODES ARE HUMAN-FACING. Three of the 29 Zendesk write nodes end an
//      AUTO path — UC-01/UC-03's `Reply + Solve Ticket` and UC-02's `Resolve
//      Expense Ticket`. Assigning a solved ticket to a team queue manufactures
//      work that does not exist, so those three are named here and skipped, and
//      the script asserts it touched exactly 26. A count that drifts means a
//      graph changed shape and this table is stale — which must fail loudly
//      rather than quietly assign one more or one fewer.
//   2. WHERE THE NEW NODE GOES ON THE CANVAS. n8n orders a fan-out by canvas
//      Y-POSITION, not by the connection array (CLAUDE.md §6), and reordering
//      the array is silently a no-op. Five of these graphs fan out from
//      `Append Audit Log` to a trace branch AND to the branch this node joins;
//      the trace branch must keep running first. So the node is placed at the
//      Y OF THE NODE IT FEEDS, read from the live graph, never at a tidy
//      constant. `--dry-run` prints the coordinate and the sibling Ys so that
//      ordering can be checked before anything is written.
//
// USAGE
//   node scripts/deploy-routing-nodes.mjs --dry-run          # report, write nothing
//   node scripts/deploy-routing-nodes.mjs --only UC-07       # one graph
//   node scripts/deploy-routing-nodes.mjs                    # all nine, in risk order
//
// A `PUT /api/v1/workflows/{id}` PUBLISHES IN PLACE on this API (CLAUDE.md §6),
// so there is no promote step and no second look at the diff. This script
// therefore re-reads every graph afterwards and checks three things before
// calling a deploy done: the body matches the file BYTE FOR BYTE, every Zendesk
// node it touched really carries `updateFields.group`, and
// `activeVersionId === versionId` — the only thing that answers "is this live?"
// ---------------------------------------------------------------------------

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // deploy verb fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESCALATION_ROUTES } from "../src/shared/escalationRouting.js";
import { outputForSplicedNode } from "./lib/graphReachability.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT_FILE = "workflows/nodes/assignRouting.js";
const NODE_NAME = "Assign Routing";

// The expression every human-facing Zendesk node gains. Addressed BY NODE NAME
// rather than `$json`, deliberately: the nine graphs disagree about what `$json`
// holds on a branch (UC-01/02/03/09 restore the gates context through `Carry
// Context Forward`; the rest read `$('…Gates').item` directly), and a named-node
// accessor is the one form that works identically on all nine. It resolves
// through item pairing, which is why the routing node sets `pairedItem`.
const GROUP_EXPR = `={{ $('${NODE_NAME}').item.json.zendeskGroupId }}`;
const TAG_EXPR = `={{ $('${NODE_NAME}').item.json.routingTag }}`;
const NOTE_EXPR = `{{ $('${NODE_NAME}').item.json.routingNote }}`;

const BASE = (process.env.N8N_BASE_URL ?? "").replace(/[/.]+$/, "");
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error("deploy-routing-nodes: set N8N_BASE_URL and N8N_API_KEY.");
  process.exit(2);
}
const H = { "X-N8N-API-KEY": KEY, "content-type": "application/json", accept: "application/json" };

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlyIndex = argv.indexOf("--only");
const only = onlyIndex !== -1 ? argv[onlyIndex + 1] : null;

/**
 * Deploy order is risk order, lowest first: UC-07 and UC-08 have no branch at
 * all (one node, one constant, the smallest possible edit); UC-09 is the money
 * path and goes last.
 *
 * `splice` names the ONE existing connection the routing node is inserted into.
 * `skip` names the auto-path Zendesk nodes that must NOT be assigned.
 */
const GRAPHS = [
  { useCase: "UC-07", id: "WORKFLOW_UC07_ID", splice: ["Append Audit Log", "Escalate Relocation Ticket"], skip: [] },
  { useCase: "UC-08", id: "WORKFLOW_UC08_ID", splice: ["Append Audit Log", "Escalate Tax Inquiry Ticket"], skip: [] },
  { useCase: "UC-05", id: "WORKFLOW_UC05_ID", splice: ["Append Audit Log", "Route by Decision"], skip: [] },
  { useCase: "UC-03", id: "WORKFLOW_UC03_ID", splice: ["Carry Context Forward", "Route by Decision"], skip: ["Reply + Solve Ticket"] },
  { useCase: "UC-02", id: "WORKFLOW_UC02_ID", splice: ["Carry Context Forward", "Route by Decision"], skip: ["Resolve Expense Ticket"] },
  { useCase: "UC-01", id: "WORKFLOW_UC01_ID", splice: ["Carry Context Forward", "Route by Decision"], skip: ["Reply + Solve Ticket"] },
  { useCase: "UC-04", id: "WORKFLOW_UC04_ID", splice: ["Append Audit Log", "Route by Decision"], skip: [] },
  { useCase: "UC-06", id: "WORKFLOW_UC06_ID", splice: ["Append Audit Log", "Route by Decision"], skip: [] },
  { useCase: "UC-09", id: "WORKFLOW_UC09_ID", splice: ["Carry Context Forward", "Route by Decision"], skip: [] },
];

/**
 * Every human-facing Zendesk node across the nine. Asserted, not counted after
 * the fact. 26 before that pass; 27 after, because of the UC-06 fix below.
 *
 * RAISED TO 29 on 2026-08-29, and the reason is recorded rather than the number
 * quietly bumped — the whole point of asserting a count is that somebody has to
 * justify changing it. UC-01 gained two human-facing Zendesk nodes AFTER this
 * constant was written (`d64dc83`, 2026-08-19): `Reply Out of Scope` and
 * `Reply + Close (No Hand-off)`, both from `ef1f3ba` on 2026-08-22, which gave
 * UC-01's three unrouted decisions their own leaf nodes. Both are genuinely
 * human-facing and both must be assigned, so 29 is the correct expectation and
 * 27 was simply a week out of date.
 *
 * Verified before changing it: the live Zendesk-node sets on all nine graphs
 * are IDENTICAL to the snapshots in qa/evidence/n8n-graph-snapshots/2026-08-28,
 * so no graph changed shape during the Zendesk account migration that surfaced
 * this — the guard was already stale and would have fired for anyone running
 * this script since 08-22.
 */
const EXPECTED_HUMAN_FACING = 29;

/**
 * PRE-EXISTING DEFECT, FIXED HERE: UC-06's `unrecognised` fallback shared
 * `Escalate Amendment Ticket` with the real `escalate` branch, so a run that
 * produced an unrecognised decision got an internal note beginning
 * "AI summary — ESCALATED: …" — describing a decision the gates never reached,
 * and reading `{{ …reason }}`/`{{ …flags }}` off an outcome that has neither.
 * Every other branching graph already has a distinct `Unrecognised …` node.
 *
 * It is fixed in this pass rather than filed because the fix is one leaf node
 * and one switch output, it is the shape the other seven already use verbatim,
 * and leaving it means the routing change would attach a team to a note that
 * misstates why the ticket is in front of them. Its y=576 sits below the
 * escalate branch and nothing is downstream of it, so the fan-out ordering rule
 * is untouched.
 */
const UC06_FALLBACK_NODE = {
  name: "Unrecognised Amendment Decision",
  type: "n8n-nodes-base.zendesk",
  typeVersion: 1,
  position: [2456, 576],
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    resource: "ticket",
    id: "={{ $('Amendment Gates').item.json.externalRef }}",
    updateFields: {
      internalNote:
        "=Automation produced an unrecognised decision ({{ $('Amendment Gates').item.json.decision }}). Routed to a human rather than dropped.",
      status: "open",
      tags: ["uc06_exception"],
    },
  },
};

// The public API rejects read-only fields on write, and returns `settings` keys
// (availableInMCP, binaryMode) it then refuses on write. Echoing back what was
// read fails; this is the same whitelist scripts/deploy-node.mjs uses.
const ALLOWED_SETTINGS = [
  "executionOrder", "saveDataErrorExecution", "saveDataSuccessExecution", "saveManualExecutions",
  "saveExecutionProgress", "executionTimeout", "errorWorkflow", "timezone", "callerPolicy", "callerIds",
];

async function getWorkflow(id) {
  const res = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: H });
  if (!res.ok) throw new Error(`GET ${id} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function putWorkflow(wf) {
  const body = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: Object.fromEntries(Object.entries(wf.settings ?? {}).filter(([k]) => ALLOWED_SETTINGS.includes(k))),
  };
  const res = await fetch(`${BASE}/api/v1/workflows/${wf.id}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${wf.id} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function activate(id) {
  const res = await fetch(`${BASE}/api/v1/workflows/${id}/activate`, { method: "POST", headers: H });
  if (!res.ok) throw new Error(`activate ${id} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const source = await readFile(path.join(ROOT, PORT_FILE), "utf8");

let touchedZendesk = 0;
let failed = 0;

for (const graph of GRAPHS) {
  if (only && graph.useCase !== only) continue;

  const wf = await getWorkflow(graph.id);
  const [upName, downName] = graph.splice;
  const up = wf.nodes.find((n) => n.name === upName);
  const down = wf.nodes.find((n) => n.name === downName);
  if (!up || !down) {
    console.error(`✖ ${graph.useCase}: splice point missing (${upName} → ${downName}). The graph changed shape.`);
    failed++;
    continue;
  }

  const route = ESCALATION_ROUTES[graph.useCase];
  console.log(
    `\n=== ${graph.useCase} ${graph.id} — ${route.group} (${route.queueTag})` +
      `${route.escalationGroup ? `, escalating to ${route.escalationGroup}` : ""} (${route.escalationTag}) ===`
  );
  console.log(`  version ${String(wf.versionId).slice(0, 8)} / active ${String(wf.activeVersionId).slice(0, 8)}`);

  // --- 0. UC-06's mislabelled fallback (see UC06_FALLBACK_NODE) -------------
  if (graph.useCase === "UC-06") {
    const outs06 = wf.connections["Route by Decision"]?.main ?? [];
    if (!wf.nodes.some((n) => n.name === UC06_FALLBACK_NODE.name)) {
      const escalate = wf.nodes.find((n) => n.name === "Escalate Amendment Ticket");
      // Credentials are copied from the sibling rather than named here — this
      // script must not know a credential id, and the sibling's is by
      // definition the right one for this account.
      wf.nodes.push({ ...UC06_FALLBACK_NODE, credentials: escalate?.credentials });
      console.log(`  + added ${UC06_FALLBACK_NODE.name} (was sharing the ESCALATED note)`);
    }
    // Output index 2 is the fallback. Only that one moves; index 1 (the real
    // `escalate`) keeps pointing at the escalate node.
    if (outs06[2]?.[0]?.node === "Escalate Amendment Ticket") {
      outs06[2] = [{ node: UC06_FALLBACK_NODE.name, type: "main", index: 0 }];
      console.log(`  → fallback output rewired to ${UC06_FALLBACK_NODE.name}`);
    } else {
      console.log(`  = fallback output already distinct`);
    }
  }

  // --- 1. the node itself, at the Y of the node it feeds ---------------------
  const position = [Math.round((up.position[0] + down.position[0]) / 2), down.position[1]];
  const siblings = (wf.connections[upName]?.main?.[0] ?? [])
    .map((c) => wf.nodes.find((n) => n.name === c.node))
    .filter(Boolean)
    .map((n) => `${n.name}@y=${n.position[1]}`);
  console.log(`  fan-out from ${upName}: [${siblings.join(", ")}]`);
  console.log(`  ${NODE_NAME} → (${position[0]}, ${position[1]})  [y matches ${downName}, so trace still runs first]`);

  let node = wf.nodes.find((n) => n.name === NODE_NAME);
  if (!node) {
    node = { name: NODE_NAME, type: "n8n-nodes-base.code", typeVersion: 2, position, parameters: { jsCode: source } };
    wf.nodes.push(node);
    console.log(`  + added ${NODE_NAME}`);
  } else {
    const same = node.parameters?.jsCode === source && node.position?.[1] === position[1];
    node.position = position;
    node.parameters = { ...node.parameters, jsCode: source };
    console.log(`  ${same ? "=" : "→"} ${NODE_NAME} body ${source.length} bytes`);
  }

  // --- 2. rewire: upstream → Assign Routing → downstream ---------------------
  // ONLY the one connection named in `splice` moves. Every other branch out of
  // the upstream node — the trace branch above all — is left exactly as it was.
  const outs = wf.connections[upName]?.main?.[0] ?? [];
  const idx = outs.findIndex((c) => c.node === downName);
  if (idx !== -1) {
    outs[idx] = { node: NODE_NAME, type: "main", index: 0 };
    console.log(`  → rewired ${upName} → ${NODE_NAME}`);
  } else if (!outs.some((c) => c.node === NODE_NAME)) {
    console.error(`  ✖ ${upName} does not connect to ${downName}, and not to ${NODE_NAME} either — refusing to guess.`);
    failed++;
    continue;
  }
  // DO NOT CLOBBER A LONGER PATH. This used to assign unconditionally, which is
  // right the first time and destructive every time after: on 2026-08-29 UC-01's
  // live chain was `Assign Routing → Compose Internal Note → Route by Decision`,
  // and re-running this rewrote it to go direct, orphaning "Compose Internal
  // Note" — a node with no inbound edge, which silently never runs. Nothing
  // showed it: this script printed "wiring ok", the graph stayed active and
  // published, and executions kept succeeding. What was lost was the reasoning
  // in the escalation note, i.e. F-11 defeated by unplugging the note's author
  // rather than by editing the note.
  const rewired = outputForSplicedNode(wf.connections, NODE_NAME, downName);
  if (rewired) {
    wf.connections[NODE_NAME] = rewired;
  } else {
    const via = (wf.connections[NODE_NAME]?.main?.[0] ?? []).map((c) => c.node).join(", ");
    console.log(`  = ${NODE_NAME} already reaches ${downName} via [${via}] — left as is`);
  }

  // --- 3. every human-facing Zendesk node consumes it ------------------------
  const zendesk = wf.nodes.filter((n) => n.type === "n8n-nodes-base.zendesk");
  for (const z of zendesk) {
    if (graph.skip.includes(z.name)) {
      console.log(`  · ${z.name} — AUTO path, deliberately not assigned`);
      continue;
    }
    if (z.parameters?.jsonParameters) {
      // The JSON form is where a hand-written comment object can lose
      // `public: false` and post internal analysis to the customer. Phase 1
      // does not convert anything to it, and does not edit anything already in
      // it either — it reports and moves on.
      console.log(`  ! ${z.name} — uses updateFieldsJson; left untouched (see the port's header)`);
      continue;
    }
    const uf = z.parameters.updateFields ?? {};
    const tags = Array.isArray(uf.tags) ? uf.tags.slice() : [];
    // The note is where "assignment was skipped, and here is why" is said in
    // words. A tag alone cannot say it: a specialist opening the ticket sees
    // the note, and a missing group would otherwise be indistinguishable from
    // a ticket nobody got round to assigning. `internalNote` is the field
    // n8n sends as `html_body` with `public: false` supplied by the node
    // itself, so appending here cannot leak internal analysis to the customer
    // — which is exactly why this pass does not touch the JSON form.
    const note = typeof uf.internalNote === "string" ? uf.internalNote : null;
    const nextNote = note && !note.includes(NOTE_EXPR) ? `${note} ${NOTE_EXPR}` : note;
    // MERGED, never assigned over: `updateFields.tags` REPLACES the ticket's
    // tags (there is no additional_tags on this node), so dropping the existing
    // outcome tag here would silently delete it from the ticket.
    if (!tags.includes(TAG_EXPR)) tags.push(TAG_EXPR);
    const before = JSON.stringify(z.parameters.updateFields ?? {});
    z.parameters = {
      ...z.parameters,
      updateFields: { ...uf, group: GROUP_EXPR, tags, ...(nextNote ? { internalNote: nextNote } : {}) },
    };
    const changed = before !== JSON.stringify(z.parameters.updateFields);
    console.log(`  ${changed ? "→" : "="} ${z.name} — group + routing tag${nextNote ? " + note" : ""}`);
    touchedZendesk++;
  }

  if (dryRun) {
    console.log("  (dry run — nothing written)");
    continue;
  }

  // --- 4. write, then verify against the graph rather than the response ------
  await putWorkflow(wf);
  let after = await getWorkflow(graph.id);
  if (after.versionId !== after.activeVersionId) {
    await activate(graph.id);
    after = await getWorkflow(graph.id);
  }

  const deployed = after.nodes.find((n) => n.name === NODE_NAME);
  const bodyOk = deployed?.parameters?.jsCode === source;
  const wiredOk =
    (after.connections[upName]?.main?.[0] ?? []).some((c) => c.node === NODE_NAME) &&
    (after.connections[NODE_NAME]?.main?.[0] ?? []).some((c) => c.node === downName);
  const posOk = deployed?.position?.[1] === position[1];
  const consumers = after.nodes.filter(
    (n) => n.type === "n8n-nodes-base.zendesk" && !graph.skip.includes(n.name) && !n.parameters?.jsonParameters
  );
  const consumeOk = consumers.every((n) => n.parameters?.updateFields?.group === GROUP_EXPR);
  const liveOk = after.versionId === after.activeVersionId;

  const ok = bodyOk && wiredOk && posOk && consumeOk && liveOk;
  console.log(
    `  ${ok ? "✔" : "✖"} body ${bodyOk ? "byte-identical" : "DIFFERS"} · wiring ${wiredOk ? "ok" : "BAD"} · ` +
      `y ${posOk ? "ok" : "MOVED"} · ${consumers.length} consumers ${consumeOk ? "ok" : "MISSING group"} · ` +
      `${liveOk ? `LIVE (${String(after.activeVersionId).slice(0, 8)})` : "NOT PUBLISHED"}`
  );
  if (!ok) failed++;
}

if (!only) {
  console.log(`\n${touchedZendesk} human-facing Zendesk node(s) wired.`);
  if (touchedZendesk !== EXPECTED_HUMAN_FACING) {
    console.error(
      `✖ expected ${EXPECTED_HUMAN_FACING}. A different count means a graph changed shape and this script's\n` +
        "  skip-list is stale — which must fail loudly, not assign one node more or fewer."
    );
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);
