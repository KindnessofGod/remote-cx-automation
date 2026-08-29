// ---------------------------------------------------------------------------
// n8nAppendAuditLogParity.test.js — rca-2ix1, guarding rca-kq7w's fix; now
// also guarding rca-9lrm's fix
// ---------------------------------------------------------------------------
// "Append Audit Log" is a Supabase node with no jsCode — the 4th node found
// in this exact shape (rca-uim's "Persist Document", rca-ibh's webhook
// trigger, rca-zu3's three Zendesk close nodes, now this one): a live
// parameter edit that `scripts/verify-deployed-nodes.mjs`'s jsCode-diffing
// MAPPINGS is structurally blind to. rca-kq7w wired this node's `details`
// field to carry `requesterType`, sourced from the DETERMINISTIC top-level
// value `workflows/nodes/gates.js` builds (gates.js:421-427) — not from
// `classification.requesterType`, the classifier's raw, unreconciled
// opinion. See workflows/nodes/appendAuditLogSpec.js's header for the full
// account of why that distinction matters and what this test does NOT cover
// (the node's position in the connection chain — deliberately out of scope,
// explained there).
//
// rca-9lrm — GROUND 1: `details.letterIssued` used to be `$json.decision ===
// 'auto_resolve'`, a BELIEF stamped before any letter was rendered or
// stored. This node now always writes the honest default (`letterIssued:
// false, letterDocumentId: null, letterContentHash: null`); a NEW node,
// "Update Audit Log With Letter" (test/n8nUpdateAuditLogWithLetterParity.test.js),
// patches the SAME row true only once a real `documents` row exists. The
// snapshot below and the regression test further down are updated for that.
//
// Mutating a committed SNAPSHOT rather than the live graph is the same
// discipline test/n8nPersistDocumentParity.test.js and
// test/n8nRouteByDecisionParity.test.js already use: `structuralNodeIssues()`
// is pure data-in/issues-out, so this proves the CHECKER catches drift with
// no risk of touching the graph that answers real Zendesk tickets. The bead
// separately proves the LIVE deployment matches, by running
// `npm run verify-deployed` against production itself (recorded in the
// bead's close notes, not here).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import { NODE_NAME, NODE_TYPE, TABLE_ID, FIELDS, appendAuditLogParamIssues } from "../workflows/nodes/appendAuditLogSpec.js";

/**
 * Captured verbatim from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on
 * 2026-08-23, read back by rca-8hl8 immediately after deploying its fix live
 * (`versionId === activeVersionId` — see the bead's close notes for the exact
 * version id).
 */
const LIVE_APPEND_AUDIT_LOG_NODE = {
  id: "fd4412a7-3101-4d76-b6c9-2c4f3f16f643",
  name: "Append Audit Log",
  type: "n8n-nodes-base.supabase",
  typeVersion: 1,
  position: [1600, 288],
  credentials: { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } },
  parameters: {
    tableId: "audit_log",
    fieldsUi: {
      fieldValues: [
        { fieldId: "use_case", fieldValue: "UC-01" },
        { fieldId: "action", fieldValue: "={{ $json.decision }}" },
        {
          fieldId: "actor",
          fieldValue: '={{ $json.session ? $json.session.authenticatedEmail : "unauthenticated" }}',
        },
        { fieldId: "risk_tier", fieldValue: "={{ $json.riskTier }}" },
        {
          fieldId: "details",
          fieldValue:
            "={{ ({ caseId: $('Persist Case').first().json.id, externalRef: $json.externalRef, source: $json.source || 'zendesk', employmentId: $json.employmentId, classification: $json.classification, identity: $json.identity, requesterType: $json.requesterType, flags: $json.flags, reason: $json.reason, letterIssued: false, letterDocumentId: null, letterContentHash: null }) }}",
        },
      ],
    },
  },
};

function nodeWith(parameterOverrides) {
  return {
    ...LIVE_APPEND_AUDIT_LOG_NODE,
    parameters: { ...LIVE_APPEND_AUDIT_LOG_NODE.parameters, ...parameterOverrides },
  };
}

const ENTRY = {
  node: NODE_NAME,
  type: NODE_TYPE,
  checkParams: appendAuditLogParamIssues,
};

test("sanity: NODE_NAME/NODE_TYPE/TABLE_ID match the captured snapshot", () => {
  assert.equal(NODE_NAME, "Append Audit Log");
  assert.equal(NODE_TYPE, "n8n-nodes-base.supabase");
  assert.equal(TABLE_ID, "audit_log");
  assert.equal(FIELDS.length, 5);
});

test("the captured live snapshot matches the spec exactly (today's real baseline is green)", () => {
  assert.deepEqual(structuralNodeIssues({ nodes: [LIVE_APPEND_AUDIT_LOG_NODE] }, ENTRY), []);
});

// --- now induce real drift shapes, one at a time, and prove each is caught ---

test("DRIFT CAUGHT: the node removed entirely", () => {
  const issues = structuralNodeIssues({ nodes: [] }, ENTRY);
  assert.deepEqual(issues, ['no node named "Append Audit Log" — either it was renamed/removed in n8n, or this entry is stale']);
});

test("DRIFT CAUGHT: tableId repointed off audit_log (e.g. a copy/paste from another Supabase node)", () => {
  const issues = structuralNodeIssues({ nodes: [nodeWith({ tableId: "documents" })] }, ENTRY);
  assert.ok(issues.some((i) => i.includes('tableId is "documents", expected "audit_log"')));
});

test("THE REGRESSION THIS BEAD EXISTS TO PREVENT: details.requesterType reverted from the top-level derived value back to classification.requesterType (rca-kq7w's exact fix, undone)", () => {
  const regressedDetails =
    "={{ ({ externalRef: $json.externalRef, employmentId: $json.employmentId, classification: $json.classification, identity: $json.identity, requesterType: $json.classification.requesterType, flags: $json.flags, reason: $json.reason, letterIssued: false, letterDocumentId: null, letterContentHash: null }) }}";
  const fieldValues = LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues.map((f) =>
    f.fieldId === "details" ? { ...f, fieldValue: regressedDetails } : f
  );
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.ok(
    issues.some((i) => i.startsWith('field "details" is') && i.includes("classification.requesterType")),
    `expected the regression to be flagged, got: ${JSON.stringify(issues)}`
  );
});

test("THE REGRESSION rca-9lrm EXISTS TO PREVENT: letterIssued reverted to the pre-corroboration belief (decision === 'auto_resolve', written before any letter exists)", () => {
  const regressedDetails =
    "={{ ({ externalRef: $json.externalRef, employmentId: $json.employmentId, classification: $json.classification, identity: $json.identity, requesterType: $json.requesterType, flags: $json.flags, reason: $json.reason, letterIssued: $json.decision === 'auto_resolve' }) }}";
  const fieldValues = LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues.map((f) =>
    f.fieldId === "details" ? { ...f, fieldValue: regressedDetails } : f
  );
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.ok(
    issues.some((i) => i.startsWith('field "details" is') && i.includes("auto_resolve")),
    `expected GROUND 1's regression to be flagged, got: ${JSON.stringify(issues)}`
  );
});

test("THE REGRESSION rca-8hl8 EXISTS TO PREVENT: details.caseId/source dropped (R7-27's exact defect, undone) — decisions become indistinguishable again", () => {
  const regressedDetails =
    "={{ ({ externalRef: $json.externalRef, employmentId: $json.employmentId, classification: $json.classification, identity: $json.identity, requesterType: $json.requesterType, flags: $json.flags, reason: $json.reason, letterIssued: false, letterDocumentId: null, letterContentHash: null }) }}";
  const fieldValues = LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues.map((f) =>
    f.fieldId === "details" ? { ...f, fieldValue: regressedDetails } : f
  );
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.equal(issues.length, 1);
  assert.ok(issues[0].startsWith('field "details" is'), `expected the regression to be flagged, got: ${JSON.stringify(issues)}`);
  assert.ok(!regressedDetails.includes("caseId"), "sanity: the regressed string genuinely lacks caseId");
  assert.ok(!regressedDetails.includes("source:"), "sanity: the regressed string genuinely lacks source");
});

test("DRIFT CAUGHT: details field dropped entirely (VC-29's audit fact, and everything else it carries, silently lost)", () => {
  const fieldValues = LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues.filter((f) => f.fieldId !== "details");
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.ok(issues.some((i) => i.includes('field "details" is missing')));
});

test("DRIFT CAUGHT: risk_tier field silently repointed (e.g. to a stale ctx.tier typo)", () => {
  const fieldValues = LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues.map((f) =>
    f.fieldId === "risk_tier" ? { ...f, fieldValue: "={{ $json.tier }}" } : f
  );
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.ok(issues.some((i) => i.includes('field "risk_tier" is "={{ $json.tier }}"')));
});

test("DRIFT CAUGHT: an unexpected extra field appears (e.g. a hand-added column no code writes elsewhere)", () => {
  const fieldValues = [...LIVE_APPEND_AUDIT_LOG_NODE.parameters.fieldsUi.fieldValues, { fieldId: "notes", fieldValue: "={{ 'x' }}" }];
  const issues = structuralNodeIssues({ nodes: [nodeWith({ fieldsUi: { fieldValues } })] }, ENTRY);
  assert.ok(issues.some((i) => i.includes('unexpected extra field "notes"')));
});

test("DRIFT CAUGHT: the node's n8n type changed (e.g. rebuilt as a Code node that never actually writes)", () => {
  const issues = structuralNodeIssues({ nodes: [{ ...LIVE_APPEND_AUDIT_LOG_NODE, type: "n8n-nodes-base.code" }] }, ENTRY);
  assert.ok(issues.some((i) => i.includes('type is "n8n-nodes-base.code", expected "n8n-nodes-base.supabase"')));
});

test("green again: the same snapshot, unmutated, passes after every drift test above ran red", () => {
  assert.deepEqual(structuralNodeIssues({ nodes: [LIVE_APPEND_AUDIT_LOG_NODE] }, ENTRY), []);
});
