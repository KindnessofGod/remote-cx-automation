// ---------------------------------------------------------------------------
// n8nEscalationCloseNodesParity.test.js — proves the F-11/F-13 regression
// guard (rca-zu3) can actually detect drift, hermetically, with no n8n access
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// "Escalate Ticket", "Unrecognised Decision" and "Reply + Close (No Hand-off)"
// are n8n Zendesk "update ticket" nodes — no jsCode, so
// scripts/verify-deployed-nodes.mjs's MAPPINGS (which diffs a `jsCode`
// string) is structurally blind to all three, the same shape
// test/n8nRouteByDecisionParity.test.js, test/n8nPersistDocumentParity.test.js
// and test/n8nWebhookResponseParity.test.js already guard against for their
// own no-jsCode nodes. rca-947 fixed two live findings on these nodes
// (F-11: internalNote reverted from an inline string to
// "={{ $json.internalNote }}"; F-13: "Reply + Close" gained `group` and the
// `verification_exception` tag) by editing live parameters directly — there
// is no repo file backing the edit itself, so nothing proved the CHECK could
// catch a revert of either fix.
//
// This file runs `noteNodeParamIssues()` / `replyCloseParamIssues()`
// (workflows/nodes/escalationCloseNodesSpec.js, via
// scripts/lib/structuralNodeChecks.mjs's generic `structuralNodeIssues()`)
// against SNAPSHOTS of the real nodes captured live from `WORKFLOW_UC01_ID` on
// 2026-08-22 (versionId === activeVersionId ===
// 2c97b013-4e81-432a-972d-a3145920380f, read back after rca-947's publish) —
// plus deliberately mutated copies reverting each fix — proving both that
// today's real baseline is green AND that the detector fires. "npm run
// verify-deployed" (which DOES hit the live graph) is what proves the CURRENT
// deployment matches; this file proves the DETECTOR works, so a check that
// can never fail is not mistaken for one that guards anything (the exact
// defect this bead exists to close — it has now shipped three times in this
// repo: DRIFT-086, F-4, and F-11/F-13).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import {
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  REPLY_CLOSE_NODE_NAME,
  ZENDESK_NODE_TYPE,
  INTERNAL_NOTE_EXPRESSION,
  NOTE_NODE_ROUTING_TAG_EXPRESSION,
  NOTE_NODE_QUEUE_TAG_EXPRESSION,
  NOTE_NODE_ZENDESK_GROUP_EXPRESSION,
  REPLY_CLOSE_ZENDESK_GROUP_EXPRESSION,
  REPLY_CLOSE_ROUTING_TAG_EXPRESSION,
  VERIFICATION_EXCEPTION_TAG,
  noteNodeParamIssues,
  replyCloseParamIssues,
} from "../workflows/nodes/escalationCloseNodesSpec.js";

/**
 * Captured live from `WORKFLOW_UC01_ID` on 2026-08-22, after rca-iih7/D-14's
 * publish (versionId === activeVersionId === fc19c42b-12e7-4bf3-aafb-a4e15ebd7021).
 * `tags` gained `NOTE_NODE_QUEUE_TAG_EXPRESSION` — see that constant's own
 * comment for why the pre-existing snapshot (routingTag alone) was the D-14 bug.
 */
const ESCALATE_SNAPSHOT = {
  id: "96e59800-30dc-4a71-89a0-9951ce885518",
  name: ESCALATE_NODE_NAME,
  type: ZENDESK_NODE_TYPE,
  typeVersion: 1,
  position: [2336, 384],
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      internalNote: "={{ $json.internalNote }}",
      status: "open",
      tags: [
        "verification_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
    },
  },
};

/**
 * Captured live from `WORKFLOW_UC01_ID` on 2026-08-22, after rca-iih7/D-14's
 * publish (versionId === activeVersionId === fc19c42b-12e7-4bf3-aafb-a4e15ebd7021).
 */
const UNRECOGNISED_SNAPSHOT = {
  id: "7824992c-70eb-4dcd-b0a0-7be40cc6447d",
  name: UNRECOGNISED_NODE_NAME,
  type: ZENDESK_NODE_TYPE,
  typeVersion: 1,
  position: [2336, 576],
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      internalNote: "={{ $json.internalNote }}",
      status: "open",
      tags: [
        "verification_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
    },
  },
};

/** Captured live from `WORKFLOW_UC01_ID` on 2026-08-22, after rca-947's publish. */
const REPLY_CLOSE_SNAPSHOT = {
  id: "9c3d9a5e-1a2b-4e3f-8b7a-replyclose01",
  name: REPLY_CLOSE_NODE_NAME,
  type: ZENDESK_NODE_TYPE,
  typeVersion: 1,
  position: [2560, 768],
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    resource: "ticket",
    id: "={{ $json.externalRef }}",
    updateFields: {
      publicReply: "={{ $json.requesterReply }}",
      status: "solved",
      tags: ["verification_exception", "={{ $json.routingTag }}"],
      group: "={{ $json.zendeskGroupId }}",
    },
  },
};

function workflowOf(node) {
  return { nodes: [node], connections: {} };
}

function withUpdateFields(snapshot, patch) {
  return {
    ...snapshot,
    parameters: {
      ...snapshot.parameters,
      updateFields: { ...snapshot.parameters.updateFields, ...patch },
    },
  };
}

const NOTE_ENTRY = (name) => ({ node: name, type: ZENDESK_NODE_TYPE, checkParams: noteNodeParamIssues });
const REPLY_CLOSE_ENTRY = { node: REPLY_CLOSE_NODE_NAME, type: ZENDESK_NODE_TYPE, checkParams: replyCloseParamIssues };

test("sanity: the spec constants match the captured snapshots exactly", () => {
  assert.equal(ESCALATE_SNAPSHOT.parameters.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.equal(UNRECOGNISED_SNAPSHOT.parameters.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.ok(ESCALATE_SNAPSHOT.parameters.updateFields.tags.includes(NOTE_NODE_ROUTING_TAG_EXPRESSION));
  assert.ok(ESCALATE_SNAPSHOT.parameters.updateFields.tags.includes(NOTE_NODE_QUEUE_TAG_EXPRESSION));
  assert.equal(ESCALATE_SNAPSHOT.parameters.updateFields.group, NOTE_NODE_ZENDESK_GROUP_EXPRESSION);
  assert.equal(REPLY_CLOSE_SNAPSHOT.parameters.updateFields.group, REPLY_CLOSE_ZENDESK_GROUP_EXPRESSION);
  assert.ok(REPLY_CLOSE_SNAPSHOT.parameters.updateFields.tags.includes(REPLY_CLOSE_ROUTING_TAG_EXPRESSION));
  assert.ok(REPLY_CLOSE_SNAPSHOT.parameters.updateFields.tags.includes(VERIFICATION_EXCEPTION_TAG));
});

// --- today's real baseline is green -----------------------------------------

test("Escalate Ticket: the captured live snapshot matches the spec exactly (F-11 is fixed)", () => {
  assert.deepEqual(structuralNodeIssues(workflowOf(ESCALATE_SNAPSHOT), NOTE_ENTRY(ESCALATE_NODE_NAME)), []);
});

test("Unrecognised Decision: the captured live snapshot matches the spec exactly (F-11 is fixed)", () => {
  assert.deepEqual(structuralNodeIssues(workflowOf(UNRECOGNISED_SNAPSHOT), NOTE_ENTRY(UNRECOGNISED_NODE_NAME)), []);
});

test("Reply + Close (No Hand-off): the captured live snapshot matches the spec exactly (F-13 is fixed)", () => {
  assert.deepEqual(structuralNodeIssues(workflowOf(REPLY_CLOSE_SNAPSHOT), REPLY_CLOSE_ENTRY), []);
});

// --- DRIFT CAUGHT: reverting F-11 -------------------------------------------

test('DRIFT CAUGHT: Escalate Ticket internalNote reverted to an inline composed string (F-11\'s original defect)', () => {
  const mutated = withUpdateFields(ESCALATE_SNAPSHOT, {
    internalNote:
      "AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags }}. No letter was issued. {{ routingNote }}",
  });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(ESCALATE_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes("F-11")), issues.join("; "));
});

test("DRIFT CAUGHT: Unrecognised Decision internalNote reverted to an inline composed string (F-11's original defect)", () => {
  const mutated = withUpdateFields(UNRECOGNISED_SNAPSHOT, {
    internalNote:
      "AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags }}. No letter was issued. {{ routingNote }}",
  });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(UNRECOGNISED_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes("F-11")), issues.join("; "));
});

test("DRIFT CAUGHT: Escalate Ticket internalNote emptied out entirely", () => {
  const mutated = withUpdateFields(ESCALATE_SNAPSHOT, { internalNote: "" });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(ESCALATE_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("internalNote")), issues.join("; "));
});

test("DRIFT CAUGHT: Escalate Ticket loses its routing group binding", () => {
  const mutated = withUpdateFields(ESCALATE_SNAPSHOT, { group: undefined });
  delete mutated.parameters.updateFields.group;
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(ESCALATE_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("updateFields.group")), issues.join("; "));
});

test("DRIFT CAUGHT: Unrecognised Decision loses the verification_exception tag", () => {
  const mutated = withUpdateFields(UNRECOGNISED_SNAPSHOT, {
    tags: ["={{ $('Assign Routing').item.json.routing.queueTag }}", "={{ $('Assign Routing').item.json.routingTag }}"],
  });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(UNRECOGNISED_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("updateFields.tags")), issues.join("; "));
});

// --- DRIFT CAUGHT: reverting D-14 (rca-iih7) --------------------------------

test("DRIFT CAUGHT: Escalate Ticket reverts to the D-14 bug — escalation tag only, no queue tag", () => {
  const mutated = withUpdateFields(ESCALATE_SNAPSHOT, {
    tags: ["verification_exception", "={{ $('Assign Routing').item.json.routingTag }}"],
  });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(ESCALATE_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("updateFields.tags") && i.includes("D-14")), issues.join("; "));
});

test("DRIFT CAUGHT: Unrecognised Decision reverts to the D-14 bug — escalation tag only, no queue tag", () => {
  const mutated = withUpdateFields(UNRECOGNISED_SNAPSHOT, {
    tags: ["verification_exception", "={{ $('Assign Routing').item.json.routingTag }}"],
  });
  const issues = structuralNodeIssues(workflowOf(mutated), NOTE_ENTRY(UNRECOGNISED_NODE_NAME));
  assert.ok(issues.some((i) => i.includes("updateFields.tags") && i.includes("D-14")), issues.join("; "));
});

// --- DRIFT CAUGHT: reverting F-13 -------------------------------------------

test("DRIFT CAUGHT: Reply + Close group field removed (F-13's original defect — falls back to the default Support group)", () => {
  const mutated = { ...REPLY_CLOSE_SNAPSHOT, parameters: { ...REPLY_CLOSE_SNAPSHOT.parameters, updateFields: { ...REPLY_CLOSE_SNAPSHOT.parameters.updateFields } } };
  delete mutated.parameters.updateFields.group;
  const issues = structuralNodeIssues(workflowOf(mutated), REPLY_CLOSE_ENTRY);
  assert.ok(issues.some((i) => i.includes("updateFields.group") && i.includes("F-13")), issues.join("; "));
});

test("DRIFT CAUGHT: Reply + Close tags reverted to routing-tag-only (F-13's original defect — drops out of the trigger's loop guard)", () => {
  const mutated = withUpdateFields(REPLY_CLOSE_SNAPSHOT, {
    tags: ["={{ $json.routingTag }}"],
  });
  const issues = structuralNodeIssues(workflowOf(mutated), REPLY_CLOSE_ENTRY);
  assert.ok(
    issues.some((i) => i.includes("updateFields.tags") && i.includes("loop guard")),
    issues.join("; ")
  );
});

test("DRIFT CAUGHT: Reply + Close group repointed at a hand-typed literal instead of the routed expression", () => {
  const mutated = withUpdateFields(REPLY_CLOSE_SNAPSHOT, { group: "6151578998431" });
  const issues = structuralNodeIssues(workflowOf(mutated), REPLY_CLOSE_ENTRY);
  assert.ok(issues.some((i) => i.includes("updateFields.group")), issues.join("; "));
});

// --- basic existence/type coverage ------------------------------------------

test("DRIFT CAUGHT: Escalate Ticket removed entirely", () => {
  const issues = structuralNodeIssues({ nodes: [], connections: {} }, NOTE_ENTRY(ESCALATE_NODE_NAME));
  assert.ok(issues[0].includes("no node named"));
});

test("DRIFT CAUGHT: Reply + Close rebuilt as a different node type with the same name", () => {
  const mutated = { ...REPLY_CLOSE_SNAPSHOT, type: "n8n-nodes-base.httpRequest" };
  const issues = structuralNodeIssues(workflowOf(mutated), REPLY_CLOSE_ENTRY);
  assert.ok(issues.some((i) => i.includes("type is")), issues.join("; "));
});

// ---------------------------------------------------------------------------
// The 2026-08-29 relaxation, and proof it did not weaken what it guards.
// ---------------------------------------------------------------------------
// Two of this repo's own tools disagreed about these three fields:
// `deploy-routing-nodes.mjs` APPENDS the routing sentence to the note and sets
// the group by node name on all 29 human-facing Zendesk nodes, while this spec
// demanded exact equality with the pre-routing form. `verify-deployed` went red
// on three healthy nodes as a result.
//
// The checks now test the property each regression is actually about —
// containment for F-11, presence for F-13 — so these tests exist to prove the
// original regressions still fail.
// ---------------------------------------------------------------------------

import {
  noteNodeParamIssues as _noteIssues,
  replyCloseParamIssues as _replyIssues,
  INTERNAL_NOTE_EXPRESSION as _NOTE_EXPR,
  NOTE_NODE_ROUTING_TAG_EXPRESSION as _ROUTE_TAG,
  NOTE_NODE_QUEUE_TAG_EXPRESSION as _QUEUE_TAG,
  NOTE_NODE_ZENDESK_GROUP_EXPRESSION as _BY_NAME_GROUP,
  REPLY_CLOSE_ZENDESK_GROUP_EXPRESSION as _JSON_GROUP,
  REPLY_CLOSE_ROUTING_TAG_EXPRESSION as _REPLY_TAG,
  VERIFICATION_EXCEPTION_TAG as _EXC_TAG,
} from "../workflows/nodes/escalationCloseNodesSpec.js";

const noteNode = (internalNote, group = _BY_NAME_GROUP) => ({
  parameters: { updateFields: { internalNote, group, tags: [_EXC_TAG, _ROUTE_TAG, _QUEUE_TAG] } },
});
const replyNode = (group) => ({
  parameters: { updateFields: { group, tags: [_EXC_TAG, _REPLY_TAG] } },
});

test("F-11 — the LIVE appended form is accepted", () => {
  const live = "={{ $json.internalNote }} {{ $('Assign Routing').item.json.routingNote }}";
  assert.deepEqual(_noteIssues(noteNode(live)), [], "the deployed note form is reported as drift");
});

test("F-11 — the bare form is still accepted too", () => {
  assert.deepEqual(_noteIssues(noteNode(_NOTE_EXPR)), []);
});

test("F-11 — THE REGRESSION STILL FAILS: a hand-typed note that drops the composer", () => {
  // This is the actual F-11 defect: a syntactically valid inline string that
  // looks like a summary and silently loses the gate-by-gate reasoning.
  const handTyped = "=Decision: {{ $json.decision }}. Reason: {{ $json.reason }}.";
  const issues = _noteIssues(noteNode(handTyped));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /F-11/);
});

test("F-11 — an ABSENT note still fails", () => {
  for (const bad of [undefined, null, "", 42]) {
    assert.ok(_noteIssues(noteNode(bad)).length >= 1, `${JSON.stringify(bad)} was accepted as a note`);
  }
});

test("F-13 — BOTH sources of the group id are accepted", () => {
  assert.deepEqual(_replyIssues(replyNode(_JSON_GROUP)), [], "the $json form is reported as drift");
  assert.deepEqual(_replyIssues(replyNode(_BY_NAME_GROUP)), [], "the by-name form is reported as drift");
});

test("F-13 — THE REGRESSION STILL FAILS: the group field absent", () => {
  // The defect this guard exists for: no group, so the ticket lands in the
  // account's default Support group and reaches nobody's queue.
  const issues = _replyIssues(replyNode(undefined));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /F-13/);
  assert.match(issues[0], /default Support group/);
});

test("F-13 — an arbitrary expression is NOT accepted", () => {
  // Relaxing to "either of two known sources" must not become "anything".
  assert.ok(_replyIssues(replyNode("={{ $json.somethingElse }}")).length >= 1);
  assert.ok(_replyIssues(replyNode("12345")).length >= 1, "a hard-coded group id was accepted");
});
