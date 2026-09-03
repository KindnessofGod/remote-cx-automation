// ---------------------------------------------------------------------------
// n8nReplyOutOfScope.test.js — the detector for UC-01's one customer-facing
// literal must be shown failing before it is trusted to pass
// ---------------------------------------------------------------------------
// HERMETIC. The live node is held against a snapshot captured from
// `GET /api/v1/workflows/WORKFLOW_UC01_ID` on 2026-08-31, plus deliberately
// mutated copies, so the checker is proved able to fail without touching the
// production graph that answers real customers in order to prove it.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPLY_OUT_OF_SCOPE_NODE_NAME,
  REPLY_OUT_OF_SCOPE_NODE_TYPE,
  REPLY_OUT_OF_SCOPE_PARAMETERS,
  REPLY_OUT_OF_SCOPE_TEXT,
  OUT_OF_SCOPE_TAG,
  ROUTING_TAG_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  FORBIDDEN_PHRASES,
  replyOutOfScopeIssues,
} from "../workflows/nodes/replyOutOfScopeSpec.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const targetNode = () => ({
  name: REPLY_OUT_OF_SCOPE_NODE_NAME,
  type: REPLY_OUT_OF_SCOPE_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(REPLY_OUT_OF_SCOPE_PARAMETERS)),
});

/** The live node, verbatim, 2026-08-31. THE NEGATIVE CONTROL. */
const LIVE_BEFORE_FIX = {
  name: "Reply Out of Scope",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      publicReply:
        "I'm sorry, I only handle employment verification requests. If you need a standard employment verification letter, please let me know.",
      tags: ["uc01_out_of_scope_replied", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

test("the target parameters pass the checker", () => {
  assert.deepEqual(replyOutOfScopeIssues(targetNode()), []);
});

test("NEGATIVE CONTROL: the node as deployed today is rejected, for the right reasons", () => {
  const issues = replyOutOfScopeIssues(LIVE_BEFORE_FIX);
  assert.ok(issues.length >= 2, `expected several failures, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => i.includes("publicReply is")), "the retired text must be flagged");
  assert.ok(
    issues.some((i) => i.toLowerCase().includes("please let me know")),
    "the promise that the sender comes back must be flagged BY NAME — that is the defect, not the wording generally"
  );
});

test("NEGATIVE CONTROL: each regression is caught on its own", () => {
  const mutate = (patch) => {
    const n = targetNode();
    n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
    return replyOutOfScopeIssues(n);
  };

  // Markup in a plain-text field — the failure that delivered escaped HTML to a
  // customer on a green run.
  assert.ok(mutate({ publicReply: "<p>Out of scope.</p>" }).some((i) => i.includes("PLAIN TEXT")));
  // The loop-guard tag dropped: the trigger re-fires on the customer's reply.
  assert.ok(mutate({ tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes("re-fires")));
  // The group dropped: the reply lands in the account default and the sentence
  // "a member of the team will pick it up" stops being true.
  assert.ok(mutate({ group: undefined }).some((i) => i.includes("human queue")));
  // A status set: solving or pending takes the ticket out of the queue the
  // reply just promised.
  assert.ok(mutate({ status: "solved" }).some((i) => i.includes("must stay UNSET")));
  // And a node that is entirely absent must not read as clean.
  assert.ok(replyOutOfScopeIssues(undefined).length > 0);
});

test("the reply says what wrote it, and does not promise that thing comes back", () => {
  const text = REPLY_OUT_OF_SCOPE_TEXT.toLowerCase();
  assert.ok(text.includes("automatically"), "a customer must be able to tell an automation answered them");
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!text.includes(phrase), `the retired phrasing "${phrase}" is back`);
  }
  // The positive half: it must still tell the customer what to DO. A refusal
  // that removes the dead promise and offers nothing in its place is worse than
  // the sentence it replaced — src/uc01/selfServiceLetter.js's header records
  // this repo shipping a deflection that pointed nowhere.
  assert.match(REPLY_OUT_OF_SCOPE_TEXT, /reply and say so/);
  assert.match(REPLY_OUT_OF_SCOPE_TEXT, /member of the team will pick it up/);
});

test("the customer-facing text is plain and carries no internal vocabulary", () => {
  assert.ok(!/<[a-z!/]/i.test(REPLY_OUT_OF_SCOPE_TEXT), "publicReply is plain text; n8n escapes markup silently");
  assert.equal(
    findHarnessVocabulary(REPLY_OUT_OF_SCOPE_TEXT),
    null,
    "no bead id, criterion id or src/ path may reach a customer"
  );
  // Negative control on the detector itself — rca-1qju was nearly closed twice
  // on a confident zero from a half-broken instrument.
  assert.ok(findHarnessVocabulary("see rca-1bk and VC-11") !== null, "the hygiene detector is not actually detecting");
});
