// ---------------------------------------------------------------------------
// n8nEscalationQueueTag.test.js — proves the rca-iih7 / D-14 guard for the
// FOURTEEN terminal Zendesk nodes on UC-02…UC-09 (eight `Escalate *`, six
// `Unrecognised *`) can actually detect the live defect, hermetically, with no
// n8n access and no network
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// workflows/nodes/escalationQueueTagSpec.js is a target shape for fourteen
// `n8n-nodes-base.zendesk` nodes that carry no `jsCode`, so
// scripts/verify-deployed-nodes.mjs's MAPPINGS is structurally blind to them
// (same shape as rca-vqe, rca-uim, rca-ibh and rca-zu3). A spec with no test
// behind it is a check nobody has watched fail — the defect this repo has now
// shipped four times (DRIFT-086, F-4, F-11/F-13, and D-14 itself, which
// survived on eight graphs precisely because UC-01's fix had a guard and the
// other eight had nothing).
//
// So this file runs `escalationQueueTagIssues()` against BOTH:
//
//   1. the fourteen TARGETS (must be clean), and
//   2. the fourteen nodes EXACTLY AS THEY ARE DEPLOYED TODAY, captured live on
//      2026-08-31 from `GET /api/v1/workflows/:id` — which must every one be
//      REJECTED, by name. Those fourteen are the live bug; a checker that
//      passes them is a checker that would have reported "0 drifted" on the
//      very defect it was written for.
//
// THE TWO HALVES ARE NOT THE SAME CLAIM, and the tests below keep them apart:
// the eight `Escalate *` nodes are wrong on EVERY escalation (nine observed
// live tickets on UC-01, rca-iih7); the six `Unrecognised *` nodes are wrong
// ONLY when the decision is missing or unreadable — `isEscalation()` returns
// true for null/undefined/""/non-string, and these six sit on `Route by
// Decision`'s fallback output — with no live instance observed. Same fix, very
// different evidence. See the spec file's header.
//
// `npm run verify-deployed` is what proves the CURRENT deployment matches.
// This file proves the DETECTOR works, without touching a production graph
// that answers real Zendesk tickets in order to prove it.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESCALATION_QUEUE_TAG_NODES,
  ESCALATE_NODES,
  UNRECOGNISED_NODES,
  QUEUE_TAG_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  ZENDESK_NODE_TYPE,
  escalationQueueTagIssues,
  specForNode,
} from "../workflows/nodes/escalationQueueTagSpec.js";
import {
  ESCALATE_NODE_NAME as UC01_ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME as UC01_UNRECOGNISED_NODE_NAME,
  NOTE_NODE_QUEUE_TAG_EXPRESSION,
  NOTE_NODE_ROUTING_TAG_EXPRESSION,
} from "../workflows/nodes/escalationCloseNodesSpec.js";

/**
 * THE LIVE BUG, captured verbatim from the eight production graphs on
 * 2026-08-31 (all `active: true`). `tags` is `["<uc>_<marker>", routingTag]` on
 * every one — the queue tag the internal note claims is absent from all
 * fourteen. These are the negative controls: if the checker ever passes one of
 * them, the checker is broken, not the graph.
 */
const LIVE_AS_CAPTURED_2026_08_31 = [
  {
    "name": "Escalate Expense Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No auto-approval issued. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc02_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Expense Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc02_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Travel Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No letter was issued. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc03_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Travel Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc03_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Workation Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Workation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED to Mobility Legal Tier-2: {{ $('Workation Gates').item.json.reason }}. Flags: {{ $('Workation Gates').item.json.flags.join(\", \") || \"none\" }}. Not open to 1-click approval here. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc04_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Workation Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Workation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $('Workation Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc04_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Resignation Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED: {{ $('Notice Period Gates').item.json.reason }}. Flags: {{ $('Notice Period Gates').item.json.flags.join(\", \") || \"none\" }}. No report was prepared for sign-off. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc05_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Resignation Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $('Notice Period Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc05_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Amendment Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Amendment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED: {{ $('Amendment Gates').item.json.reason }}. Flags: {{ $('Amendment Gates').item.json.flags.join(\", \") || \"none\" }}. Amendment record {{ $('Create Amendment Record').item.json.id }} created for reference; this request needs manual payroll/HR handling and will not go through dual approval. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc06_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Amendment Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Amendment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $('Amendment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc06_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Relocation Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Relocation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Relocation Gates').item.json.dossier.narrative }} RESEARCH SUPPORT ONLY, not a decision to proceed. For review by a qualified Remote Mobility Legal specialist. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc07_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Tax Inquiry Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Build Dossier').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Build Dossier').item.json.narrative }} RESEARCH SUPPORT ONLY, not a determination. For review by a qualified Remote Tax Operations specialist. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc08_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Escalate Adjustment Ticket",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary -- ESCALATED: {{ $('Adjustment Gates').item.json.reason }}. Flags: {{ $('Adjustment Gates').item.json.flags.join(\", \") || \"none\" }}. Adjustment record {{ $('Create Adjustment Record').item.json.id }} created for reference; this request needs manual payroll handling, no approval path was offered. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc09_escalated",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },
  {
    "name": "Unrecognised Adjustment Decision",
    "type": "n8n-nodes-base.zendesk",
    "parameters": {
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $('Adjustment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc09_exception",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }
  },];

/** Deep clone, so a mutation control cannot leak into another test. */
const clone = (value) => JSON.parse(JSON.stringify(value));

/** A live-shaped node object built from a spec entry's frozen target. */
function targetNode(entry) {
  return { name: entry.node, type: ZENDESK_NODE_TYPE, parameters: clone(entry.targetParameters) };
}

// --- 1. THE TARGETS ARE CLEAN ----------------------------------------------

test("every target in the spec passes the checker", () => {
  assert.equal(ESCALATION_QUEUE_TAG_NODES.length, 14);
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    assert.deepEqual(
      escalationQueueTagIssues(targetNode(entry)),
      [],
      `${entry.workflow} / ${entry.node} target should be clean`
    );
  }
});

test("all eight `Escalate *` targets pass", () => {
  assert.equal(ESCALATE_NODES.length, 8);
  for (const entry of ESCALATE_NODES) {
    assert.match(entry.node, /^Escalate /);
    assert.match(entry.markerTag, /^uc0\d_escalated$/);
    assert.deepEqual(escalationQueueTagIssues(targetNode(entry)), [], entry.node);
  }
});

test("all six `Unrecognised *` targets pass", () => {
  // Widened after the original eight-node scope was found wrong: these six are
  // affected on the null branch of `isEscalation()`, which is exactly the input
  // `Route by Decision`'s fallback output receives. Their marker is
  // `<uc>_exception`, not `<uc>_escalated` — a different tag, so a checker that
  // derived the marker from `useCase` would have flagged all six.
  assert.equal(UNRECOGNISED_NODES.length, 6);
  for (const entry of UNRECOGNISED_NODES) {
    assert.match(entry.node, /^Unrecognised /);
    assert.match(entry.markerTag, /^uc0\d_exception$/);
    assert.deepEqual(escalationQueueTagIssues(targetNode(entry)), [], entry.node);
  }
});

test("every target carries all three tags, and the queue tag precedes the routing tag", () => {
  // Order is asserted HERE and deliberately NOT inside the checker — see the
  // ORDERING comment in escalationQueueTagSpec.js. A Zendesk tag list is a set,
  // so order carries no behaviour; it is held on the frozen targets (where
  // being wrong costs a test) rather than on the live node (where it would
  // block a deploy over readability, the mistake webhookResponseSpec.js's
  // RESPONSE_MODE_NODE_DEFAULT was added to undo).
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    const tags = entry.targetUpdateFields.tags;
    assert.equal(tags[0], entry.markerTag, `${entry.node}: per-UC branch marker should lead`);
    const q = tags.indexOf(QUEUE_TAG_EXPRESSION);
    const r = tags.indexOf(ROUTING_TAG_EXPRESSION);
    assert.ok(q > -1 && r > -1, `${entry.node}: both expressions present`);
    assert.ok(q < r, `${entry.node}: queue tag must precede routing tag, matching UC-01's fixed nodes`);
    assert.equal(tags.length, 3, `${entry.node}: exactly the three tags, nothing else added`);
  }
});

test("targetUpdateFields is the same frozen object as targetParameters.updateFields", () => {
  // One shape, two names — never a copy, which would be a second place for the
  // tag array to drift.
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    assert.equal(entry.targetUpdateFields, entry.targetParameters.updateFields);
    assert.ok(Object.isFrozen(entry.targetUpdateFields));
    assert.ok(Object.isFrozen(entry.targetUpdateFields.tags));
  }
});

test("every target preserves the live group / status / internalNote / id verbatim", () => {
  // The fix inserts ONE tag. If any other field differs from what was read
  // live, publishing this target would silently change something nobody
  // reviewed — the exact risk of a "target shape" that was retyped rather than
  // captured. (UC-04's two rows are the one place where that captured prose is
  // knowingly superseded by another spec — see the spec header. This assertion
  // still holds, because it compares against the SAME capture.)
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    const live = LIVE_AS_CAPTURED_2026_08_31.find((n) => n.name === entry.node);
    assert.ok(live, `${entry.node} must have a live capture to compare against`);
    assert.equal(entry.targetParameters.id, live.parameters.id);
    assert.equal(entry.targetParameters.authentication, live.parameters.authentication);
    assert.equal(entry.targetParameters.operation, live.parameters.operation);
    assert.equal(entry.targetUpdateFields.group, live.parameters.updateFields.group);
    assert.equal(entry.targetUpdateFields.status, live.parameters.updateFields.status);
    // internalNote: verbatim for EIGHT of the fourteen. UC-04's two, UC-09's two
    // and UC-03's two are the documented exceptions — a per-use-case spec replaces their
    // hand-typed prose with a composed-note interpolation, because the
    // sentences they carried named the WRONG DECIDER (UC-04: a Remote mobility
    // specialist, for a decision only the customer's own manager can make) or
    // invited the WRONG ACT (UC-09: manual payroll handling, on a request whose
    // origin the gate had just refused to verify). Exempting them here rather
    // than relaxing the assertion for all fourteen: the point of this check is
    // that nothing changes unreviewed, and "reviewed elsewhere, by name" is the
    // only reason to skip it. Each of those specs carries a cross-spec test
    // asserting the two files agree field for field, so an exemption cannot
    // hide a divergence.
    //
    // UC-09's two rows joined the exemption on 2026-08-31, for the same reason
    // and with the same evidence trail. `Escalate Adjustment Ticket`'s captured
    // sentence told Payroll Ops the request "needs manual payroll handling" —
    // accurate for 1 of its 8 reachable escalate reasons and FALSE for
    // `identity_not_verified`, the one that has actually fired in production
    // (executions 9279 / ticket 135 and 9942 / ticket 5). Inviting a manual
    // payment on a request whose origin the gate refused to verify is the exact
    // bypass that gate exists to prevent. Superseded by
    // `workflows/nodes-uc09/terminalZendeskNodesSpec.js`, whose own cross-spec
    // test holds the two files equal field for field.
    //
    // UC-03's two rows joined on 2026-08-31, and they carry the interpolation in
    // a DIFFERENT FORM — `{{ $json.internalNote }}`, not
    // `{{ $('…Gates').item.json.internalNote }}`. That is a fact about the
    // graph, not a typo: UC-03 has a `Carry Context Forward` node between the
    // Supabase write and `Assign Routing`, so `$json` at its terminal nodes IS
    // the gates' output — which is why all five of its live nodes already read
    // `$json.reason` and `$json.flags`, and why `.item` would be the RISKIER
    // form there (`Carry Context Forward` sets no explicit `pairedItem`). The
    // table therefore holds the interpolation string itself rather than deriving
    // it from a node name, so a graph whose shape differs cannot be described
    // wrongly by a convenient default. `Escalate Travel Ticket`'s retired
    // sentence was TRUE; what was false on UC-03 was the letter-review node
    // ("DRAFTED text is available in the UC-03 app") and the CUSTOMER-facing
    // reply ("reply to this ticket and a specialist will review and issue it",
    // on a graph whose own idempotency claim makes a reply a no-op). Superseded
    // by `workflows/nodes-uc03/terminalZendeskNodesSpec.js`, whose own
    // cross-spec test holds the two files equal field for field.
    //
    // UC-05's and UC-06's two rows each joined on 2026-08-31, same mechanism,
    // and UC-05's is the most consequential exemption in this table because the
    // retired sentence was not merely imprecise — it was a RETRACTED CLAIM
    // ABOUT REMOTE'S PLATFORM. `Flag Awaiting HR Ops Sign-off` said "No Remote
    // write exists for resignations"; `PUT /v1/resignations/{offboarding_
    // request_id}/validate` exists (Remote's own llms.txt, read 2026-08-21) and
    // docs/use-cases/UC-05.md §1 corrected it the same day. That node is not in
    // this table — only the escalate and unrecognised ones are — but the same
    // pass replaced all three, and `Escalate Resignation Ticket`'s own retired
    // sentence ("No report was prepared for sign-off") is false for 2 of its 8
    // escalate reasons, the two where the notice figures ARE computed and
    // durable on the row. UC-06's ("needs manual payroll/HR handling") is
    // accurate for 6 of its 12 and told Payroll Ops that a Remote API outage
    // was their manual work — on a graph whose escalation destination IS
    // Payroll Ops, because UC-06's routing row has no separate escalationGroup.
    // Superseded by `workflows/nodes-uc05/terminalZendeskNodesSpec.js` and
    // `workflows/nodes-uc06/terminalZendeskNodesSpec.js`, each with its own
    // cross-spec test holding the two files equal field for field.
    const COMPOSED_NOTE_EXEMPT = {
      WORKFLOW_UC04_ID: { interpolation: "{{ $('Workation Gates').item.json.internalNote }}", retired: "mobility specialist" },
      WORKFLOW_UC09_ID: { interpolation: "{{ $('Adjustment Gates').item.json.internalNote }}", retired: "manual payroll handling" },
      WORKFLOW_UC03_ID: { interpolation: "{{ $json.internalNote }}", retired: "drafted text is available" },
      WORKFLOW_UC05_ID: { interpolation: "{{ $('Notice Period Gates').item.json.internalNote }}", retired: "no report was prepared for sign-off" },
      WORKFLOW_UC06_ID: { interpolation: "{{ $('Amendment Gates').item.json.internalNote }}", retired: "needs manual payroll/hr handling" },
    };
    const exempt = COMPOSED_NOTE_EXEMPT[entry.workflowId];
    if (exempt) {
      assert.ok(
        entry.targetUpdateFields.internalNote.includes(exempt.interpolation),
        `${entry.node}: this target must carry the composed-note interpolation, not the retired prose`
      );
      assert.ok(
        !entry.targetUpdateFields.internalNote.toLowerCase().includes(exempt.retired),
        `${entry.node}: the retired prose ("${exempt.retired}") must not come back`
      );
    } else {
      assert.equal(entry.targetUpdateFields.internalNote, live.parameters.updateFields.internalNote);
    }
    assert.deepEqual(
      entry.targetUpdateFields.tags.filter((t) => t !== QUEUE_TAG_EXPRESSION),
      live.parameters.updateFields.tags,
      `${entry.node}: the ONLY difference from live must be the inserted queue tag`
    );
  }
});

// --- 2. NEGATIVE CONTROLS: ALL FOURTEEN LIVE NODES ARE REJECTED -------------

for (const live of LIVE_AS_CAPTURED_2026_08_31) {
  test(`NEGATIVE CONTROL — live-as-captured "${live.name}" is rejected (queue tag absent)`, () => {
    const issues = escalationQueueTagIssues(clone(live));
    assert.equal(issues.length, 1, `expected exactly the queue-tag issue, got ${JSON.stringify(issues)}`);
    assert.match(issues[0], /routing\.queueTag/);
    assert.match(issues[0], /D-14's regression is this tag ABSENT/);
    assert.ok(issues[0].startsWith(live.name + ":"), "the issue must name the node it is about");
  });
}

test("all fourteen live captures are rejected — none slips through", () => {
  assert.equal(LIVE_AS_CAPTURED_2026_08_31.length, 14);
  const passing = LIVE_AS_CAPTURED_2026_08_31.filter((n) => escalationQueueTagIssues(clone(n)).length === 0);
  assert.deepEqual(passing, [], "no live node may pass before the fix is published");
});

test("the six live `Unrecognised *` captures are rejected as a group", () => {
  // Called out separately from the eight because this half was nearly left out
  // of the spec entirely. If a future pass narrows the table back to the
  // `Escalate *` nodes, this test fails by name rather than by a count.
  const live = LIVE_AS_CAPTURED_2026_08_31.filter((n) => /^Unrecognised /.test(n.name));
  assert.equal(live.length, 6);
  for (const n of live) {
    assert.equal(escalationQueueTagIssues(clone(n)).length, 1, n.name);
  }
});

// --- 3. THE OTHER TWO REGRESSIONS FIRE TOO ----------------------------------

test("a node missing the routing tag is rejected (the over-correction)", () => {
  // Replacing routingTag with queueTag makes the note true again and destroys
  // the escalation/routine distinction the tag split exists to keep.
  const entry = ESCALATION_QUEUE_TAG_NODES[0];
  const node = targetNode(entry);
  node.parameters.updateFields.tags = node.parameters.updateFields.tags.filter((t) => t !== ROUTING_TAG_EXPRESSION);
  const issues = escalationQueueTagIssues(node);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /json\.routingTag/);
  assert.match(issues[0], /indistinguishable from a routine hand-off/);
});

test("a node missing its per-UC branch marker is rejected (the loop-guard tag)", () => {
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    const node = targetNode(entry);
    node.parameters.updateFields.tags = node.parameters.updateFields.tags.filter((t) => t !== entry.markerTag);
    const issues = escalationQueueTagIssues(node);
    assert.equal(issues.length, 1, `${entry.node}: expected exactly the marker issue`);
    assert.match(issues[0], new RegExp(entry.markerTag));
    assert.match(issues[0], /not_includes loop guard/);
  }
});

test("a node with no tags at all is rejected on all three counts", () => {
  const node = targetNode(ESCALATION_QUEUE_TAG_NODES[0]);
  delete node.parameters.updateFields.tags;
  assert.equal(escalationQueueTagIssues(node).length, 3);
});

test("a node of the wrong type is rejected", () => {
  const node = targetNode(ESCALATION_QUEUE_TAG_NODES[0]);
  node.type = "n8n-nodes-base.noOp";
  const issues = escalationQueueTagIssues(node);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /node type is/);
});

test("an unrecognised node name is an issue, never a silent pass", () => {
  // The checker is wired per node in STRUCTURAL_MAPPINGS. An unknown name means
  // the mapping and this table have drifted apart; returning [] there would be
  // a check that cannot fail.
  const issues = escalationQueueTagIssues({ name: "Not A Node", type: ZENDESK_NODE_TYPE, parameters: {} });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /is not one of the 14 terminal Zendesk nodes/);
  assert.equal(specForNode("Not A Node"), null);
});

test("the checker never inspects internalNote, group, status or id", () => {
  // The orthogonality with workflows/nodes-uc04/terminalZendeskNodesSpec.js,
  // asserted rather than promised: that spec owns UC-04's terminal-node prose,
  // this one owns the queue tag. Mangling every field it does not own must
  // change nothing.
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    const node = targetNode(entry);
    node.parameters.updateFields.internalNote = "=totally different prose";
    node.parameters.updateFields.group = "={{ $json.somethingElse }}";
    node.parameters.updateFields.status = "solved";
    node.parameters.id = "={{ $json.other }}";
    assert.deepEqual(escalationQueueTagIssues(node), [], `${entry.node}: only tags are this spec's business`);
  }
});

// --- 4. THE TABLE'S BOUNDARIES ---------------------------------------------

test("the spec covers exactly 14 nodes — 8 escalate + 6 unrecognised — and UC-01 is NOT among them", () => {
  assert.equal(ESCALATION_QUEUE_TAG_NODES.length, 14);
  assert.equal(ESCALATE_NODES.length, 8);
  assert.equal(UNRECOGNISED_NODES.length, 6);
  assert.equal(new Set(ESCALATION_QUEUE_TAG_NODES.map((e) => e.node)).size, 14);
  assert.deepEqual(
    [...new Set(ESCALATION_QUEUE_TAG_NODES.map((e) => e.workflowId))].length,
    8,
    "fourteen nodes across the eight non-UC-01 graphs"
  );

  // UC-01's two nodes are absent BECAUSE THEY ARE ALREADY FIXED. rca-iih7 /
  // D-14 was found on UC-01 and patched there alone on 2026-08-22 — on BOTH
  // `Escalate Ticket` and `Unrecognised Decision`, which is the confirming
  // evidence that the unrecognised half of this table belongs in it. Their
  // target shape is owned by workflows/nodes/escalationCloseNodesSpec.js and
  // already held by STRUCTURAL_MAPPINGS plus
  // test/n8nEscalationCloseNodesParity.test.js. Two specs asserting the same
  // node would be two places to update and one place to forget.
  assert.equal(specForNode(UC01_ESCALATE_NODE_NAME), null);
  assert.equal(specForNode(UC01_UNRECOGNISED_NODE_NAME), null);
  assert.ok(!ESCALATION_QUEUE_TAG_NODES.some((e) => e.workflowId === "WORKFLOW_UC01_ID"));
});

test("UC-07 and UC-08 appear only in the escalate half — neither graph HAS an `Unrecognised *` node", () => {
  // Read live 2026-08-31: `WORKFLOW_UC07_ID` and `WORKFLOW_UC08_ID` each carry
  // exactly ONE `n8n-nodes-base.zendesk` node, the escalation one. Both are 🔴
  // use cases where every decision is an escalation, so there is no second
  // terminal branch to be unrecognised on. 8 + 6 = 14: the two missing rows are
  // an absence in the graphs, not an omission in this table.
  for (const uc of ["UC-07", "UC-08"]) {
    assert.equal(ESCALATE_NODES.filter((e) => e.useCase === uc).length, 1, `${uc} has one escalate node`);
    assert.equal(UNRECOGNISED_NODES.filter((e) => e.useCase === uc).length, 0, `${uc} has no unrecognised node`);
  }
  assert.deepEqual(
    UNRECOGNISED_NODES.map((e) => e.useCase),
    ["UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-09"]
  );
  assert.deepEqual(
    ESCALATE_NODES.map((e) => e.useCase),
    ["UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"]
  );
});

test("this spec's expressions are byte-identical to UC-01's already-fixed ones", () => {
  // The whole point is that the fourteen become the shape UC-01 already has. If
  // these two files ever disagree about the expression, one of the nine graphs
  // is being held to a different standard than the other eight — which is how
  // D-14 survived on eight graphs in the first place.
  assert.equal(QUEUE_TAG_EXPRESSION, NOTE_NODE_QUEUE_TAG_EXPRESSION);
  assert.equal(ROUTING_TAG_EXPRESSION, NOTE_NODE_ROUTING_TAG_EXPRESSION);
});

test("`isEscalation()`'s null branch — the reason the six unrecognised nodes are in scope", () => {
  // assignRouting.js:93-96, reproduced verbatim rather than imported: the file
  // is an n8n Code node body with a bare top-level `return`, so it cannot be
  // imported by a test. This is the branch that was nearly reasoned past — the
  // original scope said the `Unrecognised *` nodes were safe "because an
  // unrecognised decision does not match /^escalat/i", which is true of the
  // STRING case and silent about the null one.
  const isEscalation = (decision) => {
    if (typeof decision !== "string" || decision.trim() === "") return true;
    return /^escalat/i.test(decision.trim());
  };

  // The escalate half: always true, hence "wrong on every escalation".
  assert.equal(isEscalation("escalate"), true);
  assert.equal(isEscalation("escalated"), true);

  // The unrecognised half, both branches. A present-but-unknown string is NOT
  // an escalation, so those runs are already correct today.
  assert.equal(isEscalation("weird_new_decision"), false);
  assert.equal(isEscalation("human_review"), false);

  // ...but a missing or unreadable decision IS, and `Route by Decision`'s
  // fallback output is exactly where such a run lands. assignRouting.js's own
  // comment says why it fails this way — "a missing signal takes the stronger
  // treatment" — which is correct behaviour, and is precisely what makes the
  // fallback node's internal note wrong.
  for (const missing of [null, undefined, "", "   ", 123, {}]) {
    assert.equal(isEscalation(missing), true, `isEscalation(${JSON.stringify(missing)}) must be true`);
  }
});
