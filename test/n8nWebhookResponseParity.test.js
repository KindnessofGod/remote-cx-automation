// ---------------------------------------------------------------------------
// n8nWebhookResponseParity.test.js — the fix for F-4 (unauthenticated webhook
// echoing the full employment record) is checkable with no n8n access at all
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-ibh)
//
// "Zendesk Ticket Webhook" is an n8n WEBHOOK trigger node — no jsCode, so
// every jsCode-diffing check in this repo (scripts/verify-deployed-nodes.mjs's
// MAPPINGS, test/n8nParity.test.js) was structurally blind to it, the same
// shape rca-vqe found for the Switch node and rca-uim found for the Supabase
// node. Before this bead the node's `responseMode` was `"lastNode"`: n8n
// echoed whatever the workflow's last-executed node produced back over the
// unauthenticated HTTP connection — on the captured live probe
// (qa/evidence/UC-01/2026-08-22-uc01-e2e/shared/webhook-unauth-probe2.json)
// that was the full employment record (full_name, email, job_title,
// start_date, legal_entity_id) plus the internal openaiBody, regardless of
// what the policy gates decided.
//
// Same discipline as test/n8nRouteByDecisionParity.test.js and
// test/n8nPersistDocumentParity.test.js: `webhookResponseParamIssues()`
// (scripts/lib/structuralNodeChecks.mjs's generic `structuralNodeIssues()`
// caller, from workflows/nodes/webhookResponseSpec.js) runs here against a
// SNAPSHOT of the real node captured live from `WORKFLOW_UC01_ID` on
// 2026-08-22, AFTER scripts/deploy-uc01-webhook-fix-disclosure.mjs's fix —
// proving both that today's real baseline is green and that a revert back to
// `lastNode` (re-opening the disclosure) is caught, hermetically, with no
// N8N_API_KEY needed. `npm run verify-deployed` (which DOES hit the live
// graph) is what proves the CURRENT deployment matches; this file proves the
// DETECTOR works.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import {
  NODE_NAME,
  NODE_TYPE,
  HTTP_METHOD,
  PATH,
  RESPONSE_MODE,
  RESPONSE_MODE_NODE_DEFAULT,
  RESPONSE_DATA,
  webhookResponseParamIssues,
} from "../workflows/nodes/webhookResponseSpec.js";

/**
 * Captured live from `WORKFLOW_UC01_ID` on 2026-08-22, immediately after
 * scripts/deploy-uc01-webhook-fix-disclosure.mjs published the fix (read back
 * via `GET /api/v1/workflows/WORKFLOW_UC01_ID`, `activeVersionId ===
 * versionId` confirmed at capture time — see the bead's close note for the
 * exact versionId).
 */
const SNAPSHOT_NODE = {
  parameters: {
    httpMethod: "POST",
    path: "uc-01-verification",
    responseMode: "onReceived",
    options: { responseData: '{"status":"received"}' },
  },
  id: "150733ec-3759-4873-848e-dcf39eb28694",
  name: "Zendesk Ticket Webhook",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2.1,
  position: [0, 288],
  webhookId: "00000000-0000-4000-8000-00000000n8n0",
};

function liveWorkflow(overrideNode) {
  const node = overrideNode ? { ...SNAPSHOT_NODE, ...overrideNode } : SNAPSHOT_NODE;
  return { nodes: [node], connections: {} };
}

const WEBHOOK_ENTRY = {
  node: NODE_NAME,
  type: NODE_TYPE,
  checkParams: webhookResponseParamIssues,
};

test("sanity: NODE_NAME/NODE_TYPE/HTTP_METHOD/PATH match the captured snapshot", () => {
  assert.equal(SNAPSHOT_NODE.name, NODE_NAME);
  assert.equal(SNAPSHOT_NODE.type, NODE_TYPE);
  assert.equal(SNAPSHOT_NODE.parameters.httpMethod, HTTP_METHOD);
  assert.equal(SNAPSHOT_NODE.parameters.path, PATH);
  assert.equal(SNAPSHOT_NODE.parameters.responseMode, RESPONSE_MODE);
  assert.equal(SNAPSHOT_NODE.parameters.options.responseData, RESPONSE_DATA);
});

test("the captured live snapshot matches the spec exactly (today's real baseline is green — F-4 is closed)", () => {
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), WEBHOOK_ENTRY), []);
});

test('DRIFT CAUGHT: responseMode reverted to "lastNode" (THIS BEAD\'S ORIGINAL DEFECT — F-4, the full employment record disclosed to any unauthenticated caller)', () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ parameters: { ...SNAPSHOT_NODE.parameters, responseMode: "lastNode" } }),
    WEBHOOK_ENTRY
  );
  assert.ok(issues.some((i) => i.includes("responseMode") && i.includes("lastNode")), issues.join("; "));
});

test("DRIFT CAUGHT: options.responseData edited away from the fixed acknowledgement (e.g. reintroducing an expression that could interpolate node output)", () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ parameters: { ...SNAPSHOT_NODE.parameters, options: { responseData: "={{ $json }}" } } }),
    WEBHOOK_ENTRY
  );
  assert.ok(issues.some((i) => i.includes("responseData")), issues.join("; "));
});

test("DRIFT CAUGHT: a stale top-level responseData left over from a reverted lastNode edit", () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ parameters: { ...SNAPSHOT_NODE.parameters, responseData: "firstEntryJson" } }),
    WEBHOOK_ENTRY
  );
  assert.ok(issues.some((i) => i.includes("top-level responseData")), issues.join("; "));
});

test("DRIFT CAUGHT: path silently moved off the production URL Zendesk's trigger calls", () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ parameters: { ...SNAPSHOT_NODE.parameters, path: "uc-01-verification-v2" } }),
    WEBHOOK_ENTRY
  );
  assert.ok(issues.some((i) => i.includes("path")), issues.join("; "));
});

test("DRIFT CAUGHT: the node removed entirely", () => {
  const issues = structuralNodeIssues({ nodes: [], connections: {} }, WEBHOOK_ENTRY);
  assert.ok(issues[0].includes("no node named"));
});

test("DRIFT CAUGHT: the node's n8n type changed (e.g. rebuilt as a different trigger with the same name)", () => {
  const issues = structuralNodeIssues(liveWorkflow({ type: "n8n-nodes-base.httpTrigger" }), WEBHOOK_ENTRY);
  assert.ok(issues.some((i) => i.includes("type is")));
});

// ---------------------------------------------------------------------------
// The n8n EDITOR prunes default-valued parameters — absent means default
// ---------------------------------------------------------------------------
// Found live on 2026-08-27. All nine graphs' webhook nodes were reconfigured
// to "Immediately" by hand in the n8n editor, and every one of them came back
// from `GET /api/v1/workflows/{id}` with NO `responseMode` key at all:
//
//   raw keys = ['httpMethod', 'options', 'path']
//
// n8n strips a parameter equal to the node's own default before saving, and
// the Webhook node's default for `responseMode` IS "onReceived". So the
// correctly-configured shape and the pruned shape are the same shape, and a
// strict `!==` against RESPONSE_MODE called all nine defective while naming
// F-4 — the disclosure — as open. It had never fired before because those
// nodes had only ever been written by an API `PUT`, which prunes nothing.
//
// The negative control below is the load-bearing half: absent must pass AND
// an explicit "lastNode" must still fail, or this fix has simply disarmed the
// detector it was meant to correct.
// ---------------------------------------------------------------------------

test("sanity: the spec's expected mode IS the node default — which is exactly why absent is ambiguous", () => {
  assert.equal(RESPONSE_MODE_NODE_DEFAULT, RESPONSE_MODE);
});

test("REGRESSION (2026-08-27): a node configured through the n8n EDITOR omits responseMode entirely, and that is CORRECT — not drift", () => {
  const pruned = { httpMethod: HTTP_METHOD, path: PATH, options: { responseData: RESPONSE_DATA } };
  assert.equal("responseMode" in pruned, false, "precondition: the key is genuinely absent");
  assert.deepEqual(
    structuralNodeIssues(liveWorkflow({ parameters: pruned }), WEBHOOK_ENTRY),
    [],
    "an editor-saved node with the disclosure CLOSED must not be reported as defective"
  );
});

test('NEGATIVE CONTROL: treating absent as the default must NOT stop an explicit "lastNode" being caught', () => {
  const reverted = {
    httpMethod: HTTP_METHOD,
    path: PATH,
    responseMode: "lastNode",
    options: { responseData: RESPONSE_DATA },
  };
  const issues = structuralNodeIssues(liveWorkflow({ parameters: reverted }), WEBHOOK_ENTRY);
  assert.equal(issues.length > 0, true, "an explicit lastNode revert must still fail");
  assert.match(issues.join(" "), /F-4/, "and must still name the disclosure it reopens");
});

test("a THIRD mode is caught too — absent-means-default must not become allow-anything", () => {
  const other = {
    httpMethod: HTTP_METHOD,
    path: PATH,
    responseMode: "responseNode",
    options: { responseData: RESPONSE_DATA },
  };
  assert.equal(structuralNodeIssues(liveWorkflow({ parameters: other }), WEBHOOK_ENTRY).length > 0, true);
});
