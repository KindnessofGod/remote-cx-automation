// ---------------------------------------------------------------------------
// n8nUpdateAuditLogWithLetterParity.test.js — rca-9lrm, the n8n counterpart
// of rca-5vdx (commit 7e02e6c) — GROUND 1 of the round-7 UC-01 verdict
// ---------------------------------------------------------------------------
// "Append Audit Log" used to write `letterIssued: $json.decision ===
// 'auto_resolve'` — a BELIEF stamped onto the decision row before "Render
// Letter"/"Prepare Document"/"Persist Document" (all downstream of "Route by
// Decision", itself downstream of "Append Audit Log") had even attempted to
// render or store anything. A render/persist failure left a row claiming a
// letter that never existed; one of round 7's disputed evidence rows (E-61,
// ref 113) went through exactly this path — its attempts list n8n.run.
//
// See workflows/nodes/updateAuditLogWithLetterSpec.js's header for the full
// design: "Append Audit Log" now always writes the honest default
// (`letterIssued: false, letterDocumentId: null, letterContentHash: null`),
// and THIS node — "Update Audit Log With Letter" — sits strictly between
// "Persist Document" and "Carry Context After Persist Document" on the
// auto_resolve branch, patching the SAME row to `letterIssued: true` plus the
// real `letterDocumentId`/`letterContentHash`, but ONLY once a real
// `documents` row exists. `letterIssued: true` is therefore unreachable
// without a corroborating document, with no new failure-handling graph
// surgery required — if rendering or persisting fails, this node simply
// never runs, and the row stays exactly what it already honestly said.
//
// Same discipline as every other "no jsCode" structural node test in this
// suite (test/n8nPersistDocumentParity.test.js is the closest sibling): a
// committed SNAPSHOT of the live node, mutated to prove the checker actually
// catches drift, hermetically — no n8n access, no risk to the graph that
// answers real Zendesk tickets.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import {
  NODE_NAME,
  NODE_TYPE,
  TABLE_ID,
  OPERATION,
  UPSTREAM_NODE,
  DOWNSTREAM_NODE,
  FIELDS,
  FILTER_KEY,
  FILTER_VALUE_EXPRESSION,
  updateAuditLogWithLetterParamIssues,
} from "../workflows/nodes/updateAuditLogWithLetterSpec.js";

/**
 * Captured verbatim from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on
 * 2026-08-23, immediately after rca-9lrm's deploy (`versionId ===
 * activeVersionId` — see the bead's close notes for the exact version id).
 */
const LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE = {
  name: "Update Audit Log With Letter",
  type: "n8n-nodes-base.supabase",
  typeVersion: 1,
  position: [2836, 140],
  credentials: { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } },
  parameters: {
    resource: "row",
    operation: "update",
    tableId: "audit_log",
    filterType: "manual",
    matchType: "anyFilter",
    filters: {
      conditions: [{ keyName: "id", condition: "eq", keyValue: "={{ $('Append Audit Log').first().json.id }}" }],
    },
    dataToSend: "defineBelow",
    fieldsUi: {
      fieldValues: [
        {
          fieldId: "details",
          fieldValue:
            "={{ Object.assign({}, $('Append Audit Log').first().json.details, { letterIssued: true, letterDocumentId: $('Persist Document').first().json.id, letterContentHash: $('Persist Document').first().json.content_hash }) }}",
        },
      ],
    },
  },
};

function nodeWith(parameterOverrides) {
  return {
    ...LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE,
    parameters: { ...LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE.parameters, ...parameterOverrides },
  };
}

const CONNECTIONS = {
  [UPSTREAM_NODE]: { main: [[{ node: NODE_NAME }]] },
  [NODE_NAME]: { main: [[{ node: DOWNSTREAM_NODE }]] },
};

const ENTRY = {
  node: NODE_NAME,
  type: NODE_TYPE,
  checkParams: updateAuditLogWithLetterParamIssues,
  expectedOutputs: [DOWNSTREAM_NODE],
  expectedInputs: [UPSTREAM_NODE],
};

test("sanity: NODE_NAME/NODE_TYPE/TABLE_ID/OPERATION/FIELDS match the captured snapshot", () => {
  assert.equal(NODE_NAME, "Update Audit Log With Letter");
  assert.equal(NODE_TYPE, "n8n-nodes-base.supabase");
  assert.equal(TABLE_ID, "audit_log");
  assert.equal(OPERATION, "update");
  assert.equal(UPSTREAM_NODE, "Persist Document");
  assert.equal(DOWNSTREAM_NODE, "Carry Context After Persist Document");
  assert.equal(FIELDS.length, 1);
  assert.equal(FILTER_KEY, "id");
  assert.equal(FILTER_VALUE_EXPRESSION, "={{ $('Append Audit Log').first().json.id }}");
});

test("the captured live snapshot matches the spec exactly, wiring included (today's real baseline is green)", () => {
  const workflow = { nodes: [LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), []);
});

// --- now induce real drift shapes, one at a time, and prove each is caught ---

test("DRIFT CAUGHT: the node removed entirely", () => {
  const workflow = { nodes: [], connections: {} };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.deepEqual(issues, [
    'no node named "Update Audit Log With Letter" — either it was renamed/removed in n8n, or this entry is stale',
  ]);
});

test("DRIFT CAUGHT: tableId repointed off audit_log", () => {
  const workflow = { nodes: [nodeWith({ tableId: "documents" })], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.includes('tableId is "documents", expected "audit_log"')));
});

test("DRIFT CAUGHT: operation silently changed off update (e.g. accidentally rebuilt as a create — would INSERT a second row instead of patching the first)", () => {
  const workflow = { nodes: [nodeWith({ operation: "create" })], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.includes('operation is "create", expected "update"')));
});

test("THE REGRESSION THIS NODE EXISTS TO PREVENT: filter dropped or widened (e.g. an empty filter would patch EVERY audit_log row to letterIssued:true)", () => {
  const workflow = { nodes: [nodeWith({ filters: { conditions: [] } })], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.includes('filter condition on "id" is missing')));
});

test("DRIFT CAUGHT: filter keyValue repointed off the just-inserted row's own id", () => {
  const fieldValues = { conditions: [{ keyName: "id", condition: "eq", keyValue: "={{ $json.id }}" }] };
  const workflow = { nodes: [nodeWith({ filters: fieldValues })], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.startsWith("filter keyValue is") && i.includes("$json.id")));
});

test("THE CORE REGRESSION: details patch reverted to claim letterIssued without a real document (letterDocumentId hard-coded rather than read off Persist Document)", () => {
  const regressed = {
    fieldValues: [
      { fieldId: "details", fieldValue: "={{ Object.assign({}, $('Append Audit Log').first().json.details, { letterIssued: true, letterDocumentId: 'placeholder', letterContentHash: null }) }}" },
    ],
  };
  const workflow = { nodes: [nodeWith({ fieldsUi: regressed })], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.startsWith('field "details" is')));
});

test("DRIFT CAUGHT: wired to the wrong place (e.g. spliced in before Persist Document instead of after — would read a stale/undefined document id)", () => {
  const wrongWiring = {
    [UPSTREAM_NODE]: { main: [[{ node: "Reply + Solve Ticket" }]] },
    [NODE_NAME]: { main: [[{ node: DOWNSTREAM_NODE }]] },
  };
  const workflow = { nodes: [LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE], connections: wrongWiring };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => i.includes('upstream node "Persist Document" does not connect')));
});

test("green again: the same snapshot, unmutated, passes after every drift test above ran red", () => {
  const workflow = { nodes: [LIVE_UPDATE_AUDIT_LOG_WITH_LETTER_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), []);
});
