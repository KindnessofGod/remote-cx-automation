// ---------------------------------------------------------------------------
// n8nUc02TerminalZendeskNodes.test.js — UC-02's five terminal Zendesk nodes
// must interpolate the composed prose, not carry hand-typed sentences
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so `verify-deployed`'s
// body diff is structurally blind to it and all five of UC-02's terminal nodes
// wrote unversioned prose onto real customers' tickets. `test/n8nUc02Parity.test.js`
// cannot cover it either, by its own design: it compares DECISIONS, and a node
// that reaches the right verdict and describes it in false words passes it
// every time.
//
// This file holds two different things against each other, and the split
// matters:
//
//   1. THE NODE PARAMETERS — the expressions a human types into n8n. Held
//      against `workflows/nodes-uc02/terminalZendeskNodesSpec.js`, and against
//      the FIVE LIVE NODES AS CAPTURED, which are used as NEGATIVE CONTROLS. A
//      detector that has never been shown failing is a detector nobody has
//      tested, and this repo has twice closed a finding on a confident zero
//      from a half-broken detector.
//   2. THE RENDERED PROSE — what `composeInternalNote()` actually produces. The
//      spec's `FORBIDDEN_PHRASES` guard the expression and CANNOT see the
//      rendered text (UC-04's spec header says so about its own equivalent, and
//      is right). So the composer is lifted out of the gates body and executed
//      here, per decision, per escalate-reason class.
//
// HERMETIC. No network, no n8n key. The five live nodes are verbatim snapshots
// captured from `GET /api/v1/workflows/WORKFLOW_UC02_ID` on 2026-08-31
// (`versionId === activeVersionId === fe90bbff-c0cf-4fdb-8554-9b70c54858bf`,
// 30 nodes, `active: true`).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  RESOLVE_NODE_NAME,
  BLOCKED_NODE_NAME,
  REVIEW_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  CUSTOMER_FACING_NODES,
  RESOLVE_PARAMETERS,
  BLOCKED_PARAMETERS,
  REVIEW_PARAMETERS,
  ESCALATE_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  CUSTOMER_REPLY_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION_UNPAIRED,
  INTERNAL_NOTE_EXPRESSION,
  RESOLVE_INTERNAL_NOTE_EXPRESSION,
  PUBLIC_REPLY_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  AUTO_APPROVED_TAG,
  BLOCKED_TAG,
  REVIEW_TAG,
  ESCALATED_TAG,
  EXCEPTION_TAG,
  RESOLVE_STATUS,
  BLOCKED_STATUS,
  REVIEW_STATUS,
  ESCALATE_STATUS,
  UNRECOGNISED_STATUS,
  FORBIDDEN_PHRASES,
  ESCALATE_REASON_EVALUATED,
  UC02_WORKFLOW_ID,
  terminalZendeskNodeIssues,
  resolveNodeIssues,
  blockedNodeIssues,
  reviewNodeIssues,
  escalateNodeIssues,
  unrecognisedNodeIssues,
} from "../workflows/nodes-uc02/terminalZendeskNodesSpec.js";
import { GATE_SEQUENCE, CONFIDENCE_GATE_POSITION } from "../src/uc02/policyEngine.js";
import { evaluateExpenseActionability } from "../src/uc02/reviewPolicy.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc02", "expenseGates.js");
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc02");
const gatesSource = readFileSync(GATES_PATH, "utf8");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const live = (name, updateFields, id = "={{ $json.externalRef }}") => ({
  name,
  type: "n8n-nodes-base.zendesk",
  parameters: { authentication: "oAuth2", operation: "update", id, updateFields },
});

const LIVE_RESOLVE_BEFORE_FIX = live(RESOLVE_NODE_NAME, {
  publicReply: "Your expense claim has been automatically approved.",
  status: "solved",
  tags: ["uc02_auto_approved"],
});

const LIVE_BLOCKED_BEFORE_FIX = live(BLOCKED_NODE_NAME, {
  group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  internalNote:
    "=AI summary — decision: blocked ({{ $json.reason }}). Flags: {{ $json.flags.join(\", \") || \"none\" }}. This claim was blocked, not approved. {{ $('Assign Routing').item.json.routingNote }}",
  status: "pending",
  tags: ["uc02_blocked", "={{ $('Assign Routing').item.json.routingTag }}"],
});

const LIVE_REVIEW_BEFORE_FIX = live(REVIEW_NODE_NAME, {
  group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  internalNote:
    "=AI summary — decision: human_review ({{ $json.reason }}). Flags: {{ $json.flags.join(\", \") || \"none\" }}. No auto-approval issued. {{ $('Assign Routing').item.json.routingNote }} {{ $json.receiptNote || '' }}",
  status: "pending",
  tags: ["uc02_human_review", "={{ $('Assign Routing').item.json.routingTag }}"],
});

const LIVE_ESCALATE_BEFORE_FIX = live(ESCALATE_NODE_NAME, {
  group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  internalNote:
    "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No auto-approval issued. {{ $('Assign Routing').item.json.routingNote }}",
  status: "open",
  tags: [
    "uc02_escalated",
    "={{ $('Assign Routing').item.json.routing.queueTag }}",
    "={{ $('Assign Routing').item.json.routingTag }}",
  ],
});

const LIVE_UNRECOGNISED_BEFORE_FIX = live(UNRECOGNISED_NODE_NAME, {
  group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
  internalNote:
    "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
  status: "open",
  tags: [
    "uc02_exception",
    "={{ $('Assign Routing').item.json.routing.queueTag }}",
    "={{ $('Assign Routing').item.json.routingTag }}",
  ],
});

const LIVE_NODES = [
  LIVE_RESOLVE_BEFORE_FIX,
  LIVE_BLOCKED_BEFORE_FIX,
  LIVE_REVIEW_BEFORE_FIX,
  LIVE_ESCALATE_BEFORE_FIX,
  LIVE_UNRECOGNISED_BEFORE_FIX,
];

/** The five nodes as they must look after the deploy. */
const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

// ---------------------------------------------------------------------------
// The composer, lifted out of the deployed body.
// ---------------------------------------------------------------------------
// EXTRACTED, never re-declared here: a local restatement would share any typo
// and compare equal to itself — the same reason `verify-traces` lifts
// TRACED_CALLS out of the deployed node rather than keeping a copy. The block
// is delimited by two sentinel comments in expenseGates.js and is written to be
// self-contained; if it ever reaches outward for a binding, the lift throws a
// ReferenceError here rather than failing silently in production.

const BEGIN = "// COMPOSED TICKET PROSE — BEGIN";
const END = "// COMPOSED TICKET PROSE — END";

function liftedComposer() {
  const b = gatesSource.indexOf(BEGIN);
  const e = gatesSource.indexOf(END);
  assert.ok(b > 0 && e > b, "the COMPOSED TICKET PROSE sentinels are gone from expenseGates.js");
  return new Function(
    gatesSource.slice(b, e) +
      "\nreturn { GATE_SEQUENCE, CONFIDENCE_GATE_POSITION, describeDecidingGate, composeInternalNote, " +
      "composeCustomerReply, ESCALATE_NOT_EVALUATED_REASONS, KNOWN_DECISIONS, POLICY_CAP_CURRENCY_LABEL };"
  )();
}

const composer = liftedComposer();

const FACTS = Object.freeze({
  classification: { categoryId: "business_travel.fuel", source: "llm", confidence: 0.93 },
  categoryValid: true,
  policyCap: 15000,
  amount: 12500,
  currency: "USD",
  convertedAmount: 12500,
  convertedCurrency: "USD",
  receiptNote: null,
});

const noteFor = (decision, reason, flags = []) =>
  composer.composeInternalNote({ ...FACTS, decision, reason, flags });

// ---------------------------------------------------------------------------
// 1. The targets pass
// ---------------------------------------------------------------------------

test("all five target parameter blocks pass their own checker", () => {
  assert.deepEqual(resolveNodeIssues(targetNode(RESOLVE_NODE_NAME)), []);
  assert.deepEqual(blockedNodeIssues(targetNode(BLOCKED_NODE_NAME)), []);
  assert.deepEqual(reviewNodeIssues(targetNode(REVIEW_NODE_NAME)), []);
  assert.deepEqual(escalateNodeIssues(targetNode(ESCALATE_NODE_NAME)), []);
  assert.deepEqual(unrecognisedNodeIssues(targetNode(UNRECOGNISED_NODE_NAME)), []);
});

test("the parameterised checker resolves its spec from the node's own name", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.deepEqual(terminalZendeskNodeIssues(targetNode(name)), [], name);
  }
});

test("a node with no spec is refused rather than passed", () => {
  // The failure this guards is a wiring one: a checker pointed at a node it has
  // no opinion about must NOT return [], because [] is what `verify-deployed`
  // reads as "checked and clean".
  const issues = terminalZendeskNodeIssues({ name: "Some Other Zendesk Node", parameters: {} });
  assert.ok(issues.length > 0);
  assert.match(issues[0], /no terminal-node spec/);
  assert.ok(terminalZendeskNodeIssues(undefined).length > 0);
});

test("all five interpolate the same note field — the difference is composed upstream", () => {
  for (const params of [
    RESOLVE_PARAMETERS,
    BLOCKED_PARAMETERS,
    REVIEW_PARAMETERS,
    ESCALATE_PARAMETERS,
    UNRECOGNISED_PARAMETERS,
  ]) {
    assert.ok(params.updateFields.internalNote.includes(INTERNAL_NOTE_INTERPOLATION));
    // Addressed BY NODE NAME, never off `$json`. At four of these nodes `$json`
    // is Assign Routing's output and at the fifth it is Carry Context After
    // Approve's; both spread the gates' fields TODAY, which is exactly what
    // makes `$json` the wrong thing to depend on. The wrong form yields an
    // EMPTY note on a fully green execution.
    assert.ok(params.updateFields.internalNote.includes("$('Expense Gates')"));
    assert.ok(!/\{\{\s*\$json\.internalNote/.test(params.updateFields.internalNote));
    // `.first()`, not `.item`: the pairedItem chain from Expense Gates to these
    // nodes is eight hops and crosses a node with onError:
    // continueRegularOutput. A broken chain makes `.item` THROW, which on the
    // customer-facing node means a real approval delivering no reply at all.
    assert.ok(params.updateFields.internalNote.includes("$('Expense Gates').first()"));
  }
  assert.equal(BLOCKED_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.equal(REVIEW_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.equal(ESCALATE_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  assert.equal(RESOLVE_PARAMETERS.updateFields.internalNote, RESOLVE_INTERNAL_NOTE_EXPRESSION);
});

test("the four proven routing expressions keep `.item`; only the new one takes `.first()`", () => {
  // Rewriting a proven expression to match a new one is how a prose change
  // becomes an outage. The four nodes that already carry
  // `$('Assign Routing').item.json.routingNote` have been exercised by real
  // executions; `Resolve Expense Ticket` has never carried one at all.
  for (const params of [BLOCKED_PARAMETERS, REVIEW_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.ok(params.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION));
    assert.ok(!params.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION_UNPAIRED));
  }
  assert.ok(RESOLVE_PARAMETERS.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION_UNPAIRED));
  assert.ok(!RESOLVE_PARAMETERS.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION));
});

test("the unchanged fields really are unchanged", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const params = TERMINAL_NODE_SPECS[name].parameters;
    assert.equal(params.authentication, "oAuth2");
    assert.equal(params.operation, "update");
    assert.equal(params.id, TICKET_ID_EXPRESSION);
  }
  for (const params of [BLOCKED_PARAMETERS, REVIEW_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.equal(params.updateFields.group, ZENDESK_GROUP_EXPRESSION);
    assert.ok(params.updateFields.tags.includes(ROUTING_TAG_EXPRESSION));
  }
  // The one node that has never set a group keeps not setting one — assigning a
  // solved auto-approved ticket to a queue is a routing change, not a prose one.
  assert.equal(RESOLVE_PARAMETERS.updateFields.group, undefined);
  assert.deepEqual(RESOLVE_PARAMETERS.updateFields.tags, [AUTO_APPROVED_TAG]);
  assert.equal(RESOLVE_PARAMETERS.updateFields.status, RESOLVE_STATUS);
  assert.equal(BLOCKED_PARAMETERS.updateFields.status, BLOCKED_STATUS);
  assert.equal(REVIEW_PARAMETERS.updateFields.status, REVIEW_STATUS);
  assert.equal(ESCALATE_PARAMETERS.updateFields.status, ESCALATE_STATUS);
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.status, UNRECOGNISED_STATUS);
  assert.ok(BLOCKED_PARAMETERS.updateFields.tags.includes(BLOCKED_TAG));
  assert.ok(REVIEW_PARAMETERS.updateFields.tags.includes(REVIEW_TAG));
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(ESCALATED_TAG));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(EXCEPTION_TAG));
});

test("exactly one node is customer-facing, and only it carries a publicReply", () => {
  assert.deepEqual(CUSTOMER_FACING_NODES, [RESOLVE_NODE_NAME]);
  assert.equal(RESOLVE_PARAMETERS.updateFields.publicReply, PUBLIC_REPLY_EXPRESSION);
  assert.ok(PUBLIC_REPLY_EXPRESSION.includes(CUSTOMER_REPLY_INTERPOLATION));
  for (const params of [BLOCKED_PARAMETERS, REVIEW_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.equal(params.updateFields.publicReply, undefined);
  }
});

test("a publicReply added to a non-customer-facing node is caught", () => {
  // The regression that matters: a decision reaching the employee with no human
  // between. It cannot be caught by containment, so it is checked as an
  // equality against `undefined`.
  const n = targetNode(ESCALATE_NODE_NAME);
  n.parameters.updateFields.publicReply = "=Your claim was escalated.";
  assert.ok(terminalZendeskNodeIssues(n, ESCALATE_NODE_NAME).some((i) => i.includes("publicReply")));
});

// ---------------------------------------------------------------------------
// 2. NEGATIVE CONTROLS — the live nodes must be REJECTED, by name
// ---------------------------------------------------------------------------

test("NEGATIVE CONTROL: every one of the five live nodes is rejected", () => {
  for (const node of LIVE_NODES) {
    assert.ok(terminalZendeskNodeIssues(node).length > 0, `${node.name} must be rejected`);
  }
});

test("NEGATIVE CONTROL: the escalate node's 'No auto-approval issued' is flagged BY NAME", () => {
  const issues = escalateNodeIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(
    issues.some((i) => i.includes("no auto-approval issued")),
    "the sentence that is misleading for 3 of the 6 reachable escalate reasons must be flagged BY NAME"
  );
  assert.ok(issues.some((i) => i.includes("ai summary")));
  // Its tags, group and status were already right — the checker must not
  // manufacture failures on fields the deploy does not touch.
  assert.ok(!issues.some((i) => i.includes("updateFields.status")));
  assert.ok(!issues.some((i) => i.includes("updateFields.group")));
  assert.ok(!issues.some((i) => i.includes("updateFields.tags")));
});

test("NEGATIVE CONTROL: the unrecognised node's sidebar-contradicting sentence is flagged BY NAME", () => {
  const issues = unrecognisedNodeIssues(LIVE_UNRECOGNISED_BEFORE_FIX);
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(
    issues.some((i) => i.includes("routed to a human rather than dropped")),
    "the claim the sidebar directly contradicts must be flagged BY NAME"
  );
});

test("NEGATIVE CONTROL: the blocked and review nodes are rejected for their own reasons", () => {
  const blocked = blockedNodeIssues(LIVE_BLOCKED_BEFORE_FIX);
  assert.ok(blocked.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(blocked.some((i) => i.includes("this claim was blocked, not approved")));
  assert.ok(blocked.some((i) => i.includes("ai summary")));

  const review = reviewNodeIssues(LIVE_REVIEW_BEFORE_FIX);
  assert.ok(review.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(review.some((i) => i.includes("ai summary")));
  assert.ok(review.some((i) => i.includes("no auto-approval issued")));
});

test("NEGATIVE CONTROL: the customer-facing node is rejected for the reply AND the missing note", () => {
  const issues = resolveNodeIssues(LIVE_RESOLVE_BEFORE_FIX);
  assert.ok(
    issues.some((i) => i.includes("publicReply")),
    "the hand-typed reply must be flagged — it is the only string on this graph an employee reads"
  );
  assert.ok(
    issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the auto-approved ticket carries no internal record at all today"
  );
});

test("NEGATIVE CONTROL: no live node passes as a different node's spec", () => {
  // A mix-up in STRUCTURAL_MAPPINGS must be loud rather than silent: the
  // escalate target has `status: open`, the blocked spec wants `pending`, and
  // the resolve spec wants a publicReply nothing else may have.
  assert.ok(blockedNodeIssues(targetNode(ESCALATE_NODE_NAME)).length > 0);
  assert.ok(escalateNodeIssues(targetNode(BLOCKED_NODE_NAME)).length > 0);
  assert.ok(resolveNodeIssues(targetNode(REVIEW_NODE_NAME)).length > 0);
  assert.ok(reviewNodeIssues(targetNode(RESOLVE_NODE_NAME)).length > 0);
});

// ---------------------------------------------------------------------------
// 3. Per-regression mutations — each one caught on its own
// ---------------------------------------------------------------------------

const mutate = (name, patch) => {
  const n = targetNode(name);
  n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
  return terminalZendeskNodeIssues(n, name);
};

test("the interpolation replaced by an inline sentence is caught, on all five", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const issues = mutate(name, { internalNote: "=AI summary — decision: blocked. Routed to a human." });
    assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)), `${name}: an inline note must be refused`);
  }
});

test("a forbidden phrase reintroduced ALONGSIDE a correct interpolation is still caught", () => {
  // The subtle regression: somebody keeps the interpolation and appends the old
  // sentence back "for context". The note is then both correct and misleading.
  const issues = mutate(ESCALATE_NODE_NAME, {
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nNo auto-approval issued.`,
  });
  assert.ok(!issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)), "the interpolation itself is present");
  assert.ok(issues.some((i) => i.includes("no auto-approval issued")));
});

test("a forbidden phrase hidden in ANOTHER updateFields field is still caught", () => {
  // The 2026-08-29 Zendesk migration's lesson: a field-by-field walk misses the
  // copy inside a string inside another field. The check reads the whole blob.
  const issues = mutate(BLOCKED_NODE_NAME, {
    tags: [BLOCKED_TAG, ROUTING_TAG_EXPRESSION, "no auto-approval issued"],
  });
  assert.ok(issues.some((i) => i.includes("no auto-approval issued")));
});

test("the routing sentence dropped from the expression is caught, in the right form per node", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const issues = mutate(name, { internalNote: `=${INTERNAL_NOTE_INTERPOLATION}` });
    assert.ok(issues.some((i) => i.includes("routingNote")), name);
  }
  // And the WRONG form is caught too: pasting the `.item` expression onto the
  // node whose target is `.first()` (or vice versa) is the likeliest hand edit.
  assert.ok(
    mutate(RESOLVE_NODE_NAME, { internalNote: INTERNAL_NOTE_EXPRESSION }).some((i) =>
      i.includes(ROUTING_NOTE_INTERPOLATION_UNPAIRED)
    )
  );
  assert.ok(
    mutate(ESCALATE_NODE_NAME, { internalNote: RESOLVE_INTERNAL_NOTE_EXPRESSION }).some((i) =>
      i.includes(ROUTING_NOTE_INTERPOLATION)
    )
  );
});

test("the customer reply replaced by a hand-typed sentence is caught", () => {
  const issues = mutate(RESOLVE_NODE_NAME, { publicReply: "Your expense claim has been automatically approved." });
  assert.ok(issues.some((i) => i.includes("publicReply")));
});

test("each tag dropped is caught, one at a time", () => {
  assert.ok(mutate(RESOLVE_NODE_NAME, { tags: [] }).some((i) => i.includes(AUTO_APPROVED_TAG)));
  assert.ok(mutate(BLOCKED_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(BLOCKED_TAG)));
  assert.ok(mutate(BLOCKED_NODE_NAME, { tags: [BLOCKED_TAG] }).some((i) => i.includes("routingTag")));
  assert.ok(mutate(REVIEW_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(REVIEW_TAG)));
  assert.ok(mutate(ESCALATE_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(ESCALATED_TAG)));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(EXCEPTION_TAG)));
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(mutate(name, { tags: undefined }).length > 0, name);
    assert.ok(mutate(name, { tags: "uc02_blocked" }).length > 0, name);
  }
});

test("the QUEUE TAG is NOT asserted here — escalationQueueTagSpec.js owns it", () => {
  // Two checkers asserting one field is how a fix in one lands as a failure in
  // the other. Dropping the queue tag must leave THIS checker silent (the
  // cross-spec test and that file's own checker are what catch it), and must
  // not make it noisy either.
  assert.deepEqual(
    mutate(ESCALATE_NODE_NAME, { tags: [ESCALATED_TAG, ROUTING_TAG_EXPRESSION] }),
    [],
    "this checker must have no opinion about the queue tag"
  );
  assert.deepEqual(mutate(UNRECOGNISED_NODE_NAME, { tags: [EXCEPTION_TAG, ROUTING_TAG_EXPRESSION] }), []);
});

test("an EXTRA tag is not a regression — the loop guard must be addable without going red", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const withGuard = [...TERMINAL_NODE_SPECS[name].parameters.updateFields.tags, "uc_processed"];
    assert.deepEqual(mutate(name, { tags: withGuard }), [], name);
  }
});

test("the group dropped is caught on the four nodes that set one", () => {
  for (const name of [BLOCKED_NODE_NAME, REVIEW_NODE_NAME, ESCALATE_NODE_NAME, UNRECOGNISED_NODE_NAME]) {
    assert.ok(mutate(name, { group: undefined }).some((i) => i.includes("group")), name);
    assert.ok(mutate(name, { group: "={{ $json.zendeskGroupId }}" }).some((i) => i.includes("group")), name);
  }
  // And a group ADDED to the node that has never had one is caught too — it is
  // a routing change wearing a prose change's clothes.
  assert.ok(mutate(RESOLVE_NODE_NAME, { group: ZENDESK_GROUP_EXPRESSION }).some((i) => i.includes("group")));
});

test("the status flipped is caught, in every direction", () => {
  assert.ok(mutate(RESOLVE_NODE_NAME, { status: "open" }).some((i) => i.includes("status")));
  assert.ok(mutate(BLOCKED_NODE_NAME, { status: "open" }).some((i) => i.includes("status")));
  assert.ok(mutate(REVIEW_NODE_NAME, { status: "solved" }).some((i) => i.includes("status")));
  assert.ok(mutate(ESCALATE_NODE_NAME, { status: "pending" }).some((i) => i.includes("status")));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { status: "solved" }).some((i) => i.includes("status")));
});

test("the ticket id repointed is caught", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const n = targetNode(name);
    n.parameters.id = "={{ $('Expense Gates').item.json.externalRef }}";
    assert.ok(terminalZendeskNodeIssues(n, name).some((i) => i.includes("parameters.id")), name);
  }
});

// ---------------------------------------------------------------------------
// 4. The interpolations name fields the gates node really emits
// ---------------------------------------------------------------------------

test("`internalNote` and `customerReply` are really emitted by the gates body", () => {
  // THE FAILURE THIS CATCHES IS SILENT IN PRODUCTION. An n8n expression that
  // dereferences a field nothing produces renders as an EMPTY STRING on a fully
  // green execution. The interpolation and the emitting field are asserted
  // against each other rather than each being asserted to look plausible.
  const noteField = INTERNAL_NOTE_INTERPOLATION.match(/json\.(\w+)/)?.[1];
  const replyField = CUSTOMER_REPLY_INTERPOLATION.match(/json\.(\w+)/)?.[1];
  assert.equal(noteField, "internalNote");
  assert.equal(replyField, "customerReply");
  // The gates body returns them on its output object.
  assert.match(gatesSource, /^\s{4}internalNote,$/m, "expenseGates.js does not emit internalNote");
  assert.match(gatesSource, /^\s{4}customerReply,$/m, "expenseGates.js does not emit customerReply");
});

// ---------------------------------------------------------------------------
// 5. The ported gate ladder is src's, position for position
// ---------------------------------------------------------------------------

test("the ported GATE_SEQUENCE is byte-equal to src/uc02/policyEngine.js's", () => {
  // It was GENERATED from that export rather than retyped. This is what stops
  // it drifting afterwards — and it is a stronger check than "the order looks
  // right", which is what the gate ladder claim in the header would otherwise
  // rest on.
  assert.deepEqual(composer.GATE_SEQUENCE, JSON.parse(JSON.stringify(GATE_SEQUENCE)));
  assert.equal(composer.CONFIDENCE_GATE_POSITION, CONFIDENCE_GATE_POSITION);
  assert.equal(new Set(composer.GATE_SEQUENCE.map((g) => g.position)).size, 16, "sixteen rungs, 0–15");
});

test("the ported cap-currency label matches the constant the cap gate uses", () => {
  // A duplicated constant that can drift silently is worse than none. The
  // composer's copy exists only because the lifted block must not reach
  // outward; this holds it equal to the outer one.
  const outer = gatesSource.match(/^const POLICY_CAP_CURRENCY = '([A-Z]+)';$/m)?.[1];
  assert.ok(outer, "POLICY_CAP_CURRENCY is gone from expenseGates.js");
  assert.equal(composer.POLICY_CAP_CURRENCY_LABEL, outer);
});

test("an unrecognised reason is described as unstateable, never as a nearby gate", () => {
  // The property the retired notes had by accident (they only ever printed
  // `$json.reason`) and that the composer must keep on purpose: a wrong
  // attribution is worse than an absent one.
  const gate = composer.describeDecidingGate("a_reason_no_rung_has");
  assert.equal(gate.position, null);
  assert.match(gate.note, /cannot be stated/);
  const note = noteFor("escalate", "a_reason_no_rung_has", []);
  assert.match(note, /Which gate decided this cannot be stated/);
  // …and the raw reason is STILL printed, always.
  assert.match(note, /\(a_reason_no_rung_has\)/);
});

test("the raw reason is printed verbatim for every decision — property 1", () => {
  for (const [decision, reason] of [
    ["auto_approve", "all_gates_passed"],
    ["human_review", "over_policy_cap"],
    ["blocked", "duplicate_submission"],
    ["escalate", "identity_not_verified"],
    ["something_new", "made_up_reason"],
  ]) {
    assert.match(noteFor(decision, reason), new RegExp(`\\(${reason}\\)`), `${decision}/${reason}`);
  }
});

test("no team name is hand-typed into the composed note — property 2", () => {
  // `routingNote`, appended by the node off the routing table, is the ONE place
  // a team is named. A second copy six words from it is the failure
  // docs/ESCALATION-DESTINATIONS.md §2.2 records for UC-04.
  const TEAM_SPELLINGS = [
    "Finance Ops",
    "Finance Operations",
    "HR Ops",
    "Mobility",
    "Tier-2",
    "Tier-3",
    "queue_",
    "escalation_",
  ];
  for (const [decision, reason] of [
    ["auto_approve", "all_gates_passed"],
    ["human_review", "over_policy_cap"],
    ["blocked", "expense_not_pending"],
    ["escalate", "upstream_unavailable"],
    ["escalate", "expense_not_found"],
    ["nonsense", "nonsense"],
  ]) {
    const note = noteFor(decision, reason);
    for (const spelling of TEAM_SPELLINGS) {
      assert.ok(!note.includes(spelling), `${decision}/${reason} names a team: ${spelling}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. The escalate split — the defect this change exists for
// ---------------------------------------------------------------------------

test("ESCALATE_REASON_EVALUATED covers exactly the reasons the gates body emits as escalate", () => {
  // Read out of the body rather than restated, so a seventh escalate reason
  // added to expenseGates.js fails this test instead of quietly inheriting
  // whichever branch it lands in — the same reason `verify-traces` lifts
  // TRACED_CALLS out of the deployed body rather than keeping a local copy.
  const emitted = new Set(
    [...gatesSource.matchAll(/decision:\s*'escalate',\s*reason:\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
  );
  // The two that come through upstreamVerdict(), which always returns
  // `decision: 'escalate'` with the reason held in a constant.
  for (const re of [/const REASON_UPSTREAM_NOT_FOUND = '([a-z0-9_]+)'/, /const REASON_UPSTREAM_UNAVAILABLE = '([a-z0-9_]+)'/]) {
    const m = gatesSource.match(re);
    assert.ok(m, `${re} is gone from expenseGates.js`);
    emitted.add(m[1]);
  }

  const tabled = new Set(ESCALATE_REASON_EVALUATED.map((r) => r.reason));
  for (const reason of emitted) {
    assert.ok(tabled.has(reason), `ESCALATE_REASON_EVALUATED does not cover ${reason}`);
  }
  for (const reason of tabled) {
    assert.ok(emitted.has(reason), `ESCALATE_REASON_EVALUATED names ${reason}, which the gates body cannot emit`);
  }
  assert.equal(ESCALATE_REASON_EVALUATED.length, 6);
});

test("the retired sentence was misleading for exactly 3 of the 6 — the count the header claims", () => {
  const misleading = ESCALATE_REASON_EVALUATED.filter((r) => r.misleading);
  assert.equal(misleading.length, 3);
  // `misleading` and `evaluated` are the same split seen from two sides; if
  // they ever disagree, one of the two was edited without the other.
  for (const row of ESCALATE_REASON_EVALUATED) {
    assert.equal(row.misleading, !row.evaluated, `${row.reason}: misleading and evaluated disagree`);
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
    assert.ok(row.source, `${row.reason} does not say where it comes from`);
  }
});

test("the composer's not-evaluated list IS the table's, not a second opinion", () => {
  const fromTable = ESCALATE_REASON_EVALUATED.filter((r) => !r.evaluated).map((r) => r.reason).sort();
  assert.deepEqual([...composer.ESCALATE_NOT_EVALUATED_REASONS].sort(), fromTable);
});

test("a never-evaluated escalation says so, and does not claim an assessment ran", () => {
  for (const reason of composer.ESCALATE_NOT_EVALUATED_REASONS) {
    const note = noteFor("escalate", reason, [reason]);
    assert.match(note, /NEVER EVALUATED/, reason);
    assert.match(note, /nothing to overturn/, reason);
    assert.ok(!note.includes("No auto-approval issued"), reason);
  }
});

test("an evaluated escalation gets a different sentence — the split is real", () => {
  for (const row of ESCALATE_REASON_EVALUATED.filter((r) => r.evaluated)) {
    const note = noteFor("escalate", row.reason, [row.reason]);
    assert.ok(!note.includes("NEVER EVALUATED"), row.reason);
    assert.match(note, /stopped before any assessment of the spend ran/, row.reason);
  }
});

// ---------------------------------------------------------------------------
// 7. The ticket and the sidebar must not contradict each other
// ---------------------------------------------------------------------------

test("every non-review note says nothing there is open to an approve or a decline", () => {
  // src/uc02/reviewPolicy.js's evaluateExpenseActionability() refuses every row
  // whose decision is not `human_review`. Asserted against THAT FUNCTION rather
  // than against a restatement of it, so the note and the panel cannot drift.
  for (const decision of ["auto_approve", "blocked", "escalate", "an_unrecognised_decision"]) {
    const verdict = evaluateExpenseActionability({ expenseRow: { decision, status: "flagged" } });
    assert.equal(verdict.allowed, false, `the sidebar unexpectedly allows ${decision}`);
    const note = noteFor(decision, decision === "escalate" ? "expense_not_found" : "expense_not_pending");
    assert.match(
      note,
      /carries no approve\/decline control at all/,
      `${decision}: the ticket does not say what the sidebar will say`
    );
  }
});

test("the human_review note points at the control the sidebar really offers", () => {
  const verdict = evaluateExpenseActionability({ expenseRow: { decision: "human_review", status: "flagged" } });
  assert.equal(verdict.allowed, true);
  const note = noteFor("human_review", "over_policy_cap", ["over_policy_cap"]);
  assert.match(note, /approve, decline or hold/);
  assert.match(note, /A decline must state a reason/);
  assert.ok(!note.includes("carries no approve/decline control at all"));
});

test("the unrecognised note calls it an automation fault, not an expense decision", () => {
  const note = noteFor("weird_new_decision", "weird_new_reason");
  assert.match(note, /AUTOMATION FAULT/);
  assert.match(note, /Nothing has been decided about the expense itself/);
  assert.match(note, /raise the automation fault/);
  // The four decisions are named from the composer's own list, so the sentence
  // cannot claim a set the gates no longer emit.
  assert.deepEqual(composer.KNOWN_DECISIONS, ["auto_approve", "human_review", "blocked", "escalate"]);
  for (const d of composer.KNOWN_DECISIONS) assert.ok(note.includes(d));
});

// ---------------------------------------------------------------------------
// 8. Money, and the one string a customer reads
// ---------------------------------------------------------------------------

test("the customer reply names the amount, is plain text, and exists only on auto_approve", () => {
  const reply = composer.composeCustomerReply({
    decision: "auto_approve",
    convertedAmount: 12500,
    convertedCurrency: "USD",
  });
  assert.match(reply, /125\.00 USD/);
  assert.match(reply, /has been automatically approved/, "the verified-true claim stays");
  // PLAIN TEXT. n8n's Zendesk node sends publicReply as plain text and silently
  // escapes HTML — UC-01 delivered a whole letter as literal `&lt;!doctype…`
  // source on a green run because of this.
  assert.ok(!/[<>]/.test(reply), `the reply contains markup characters: ${reply}`);
  assert.ok(!/&[a-z]+;|&#\d+;/i.test(reply), "the reply contains an HTML entity");
  for (const decision of ["human_review", "blocked", "escalate", "nonsense"]) {
    assert.equal(composer.composeCustomerReply({ decision, convertedAmount: 12500, convertedCurrency: "USD" }), null);
  }
});

test("money is never fabricated — an unreadable amount drops the clause, it does not print a zero", () => {
  for (const bad of [null, undefined, NaN, "12500", 125.5]) {
    const reply = composer.composeCustomerReply({ decision: "auto_approve", convertedAmount: bad, convertedCurrency: "USD" });
    assert.match(reply, /^Your expense claim has been automatically approved\./, String(bad));
    assert.ok(!/0\.00/.test(reply), String(bad));
    assert.ok(!reply.includes("USD"), String(bad));
  }
  // And the same rule inside the note.
  const note = composer.composeInternalNote({
    ...FACTS,
    decision: "human_review",
    reason: "invalid_amount",
    flags: ["invalid_amount"],
    amount: null,
    convertedAmount: null,
    policyCap: null,
  });
  assert.ok(!/Claimed:/.test(note), "an unreadable claim amount must not be printed at all");
  assert.match(note, /Spend cap recorded for that category: none\./);
});

test("a cap is labelled in the cap corpus's own currency, not the claim's", () => {
  // gate 12's `policy_cap_currency_mismatch` exists precisely because the two
  // can differ; labelling a USD cap "150.00 EUR" would print a figure that does
  // not exist anywhere.
  const note = composer.composeInternalNote({
    ...FACTS,
    decision: "human_review",
    reason: "policy_cap_currency_mismatch",
    flags: ["policy_cap_currency_mismatch"],
    currency: "EUR",
    convertedCurrency: "EUR",
  });
  assert.match(note, /Spend cap recorded for that category: 150\.00 USD\./);
  assert.match(note, /Claimed: 125\.00 EUR\./);
});

test("both money figures appear even when they agree", () => {
  const note = noteFor("auto_approve", "all_gates_passed");
  assert.match(note, /Claimed: 125\.00 USD\./);
  assert.match(note, /Converted: 125\.00 USD\./);
});

test("the note states the figures as facts, never as a comparison that happened", () => {
  // An earlier draft wrote "the figure the cap gate compares" beside the
  // converted amount — a claim that a comparison RAN, false on every escalate,
  // and it sat two lines under "No amount was compared against any policy cap".
  const note = noteFor("escalate", "identity_not_verified", ["identity_not_verified"]);
  assert.ok(!/cap gate compares/.test(note));
});

// ---------------------------------------------------------------------------
// 9. What replaced "AI summary"
// ---------------------------------------------------------------------------

test("the note never says 'AI summary', and names the reader that actually classified", () => {
  for (const [decision, reason] of [
    ["blocked", "duplicate_submission"],
    ["escalate", "identity_not_verified"],
    ["human_review", "low_confidence"],
    ["auto_approve", "all_gates_passed"],
  ]) {
    const note = noteFor(decision, reason);
    assert.ok(!/AI summary/i.test(note), `${decision}/${reason}`);
    assert.match(note, /reported by llm at confidence 0\.93/, `${decision}/${reason}`);
  }
});

test("the note says whether the classifier's confidence was consulted at all", () => {
  // The sentence that replaces the blanket "AI" label, and the reason it is an
  // improvement rather than a deletion: a reader can tell "the model decided
  // this" from "the model played no part in this outcome".
  const early = noteFor("blocked", "duplicate_submission", ["duplicate_submission"]);
  assert.match(early, /it played no part in this outcome/);
  const late = noteFor("human_review", "low_confidence", ["low_confidence"]);
  assert.match(late, /reached the classifier-confidence gate, so the confidence figure below was consulted/);
  // Gate 6 is before gate 13; gate 13 is not.
  assert.equal(composer.describeDecidingGate("duplicate_submission").confidenceConsulted, false);
  assert.equal(composer.describeDecidingGate("low_confidence").confidenceConsulted, true);
});

test("the receipt reading reaches every branch, not just human_review", () => {
  // It used to ride on `Flag Expense For Review`'s own `{{ $json.receiptNote }}`
  // and therefore reached a reviewer on one of five branches.
  const receiptNote = "Receipt reads: Cafe, 68.55 USD, dated 2026-05-15. Claim records: 125.00 USD, dated 2026-05-15.";
  for (const decision of ["auto_approve", "human_review", "blocked", "escalate", "nonsense"]) {
    const note = composer.composeInternalNote({ ...FACTS, decision, reason: "expense_not_pending", flags: [], receiptNote });
    assert.ok(note.includes(receiptNote), decision);
  }
  // …and an absent reading adds nothing rather than an empty paragraph.
  assert.ok(!/\n\n\n/.test(noteFor("blocked", "expense_not_pending")));
});

// ---------------------------------------------------------------------------
// 10. Ticket hygiene — this text goes on a real customer's ticket
// ---------------------------------------------------------------------------

test("no target expression carries harness vocabulary", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    if (uf.publicReply) assert.equal(findHarnessVocabulary(uf.publicReply), null, `${name}: in the reply`);
    for (const tag of uf.tags) assert.equal(findHarnessVocabulary(tag), null, `${name}: in tag ${tag}`);
  }
});

test("neither does the composed note, for any decision", () => {
  for (const [decision, reason] of [
    ["auto_approve", "all_gates_passed"],
    ["human_review", "receipt_does_not_support_claim"],
    ["blocked", "duplicate_submission"],
    ["escalate", "upstream_record_not_found"],
    ["escalate", "expense_employment_mismatch"],
    ["mystery", "mystery"],
  ]) {
    const note = noteFor(decision, reason);
    assert.equal(findHarnessVocabulary(note), null, `harness vocabulary for ${decision}/${reason}: ${note}`);
  }
});

test("the CUSTOMER-FACING reply carries no harness vocabulary and no markup", () => {
  // The strictest of the three, because it is the only one an employee reads.
  const reply = composer.composeCustomerReply({ decision: "auto_approve", convertedAmount: 25805, convertedCurrency: "USD" });
  assert.equal(findHarnessVocabulary(reply), null, reply);
  assert.ok(!/[<>]/.test(reply));
  assert.ok(!/&[a-z]+;|&#\d+;/i.test(reply));
  assert.match(reply, /258\.05 USD/);
});

// ---------------------------------------------------------------------------
// 11. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31.md"), "utf8");
  for (const name of TERMINAL_NODE_NAMES) assert.ok(md.includes(name), `the deploy note does not mention ${name}`);
  assert.ok(md.includes(UC02_WORKFLOW_ID));
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION));
  assert.ok(md.includes(CUSTOMER_REPLY_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION_UNPAIRED));
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  for (const tag of [AUTO_APPROVED_TAG, BLOCKED_TAG, REVIEW_TAG, ESCALATED_TAG, EXCEPTION_TAG]) {
    assert.ok(md.includes(tag), `the deploy note does not mention ${tag}`);
  }

  // The JSON blocks in the deploy note must BE the spec, not a retyping of it.
  // A paste-ready block that has drifted from the checker is worse than none:
  // an operator follows it and `verify-deployed` then reports the drift they
  // were told to create.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 5, "expected one paste-ready JSON block per node");
  // Matched by CONTENT rather than by position: the deploy note is ordered by
  // the order it is safe to apply the changes in (the customer-facing node
  // last), which is not TERMINAL_NODE_NAMES' order and should not be forced to
  // be. Every node must have exactly one block and every block exactly one
  // node, so a duplicated or missing block still fails.
  const wanted = TERMINAL_NODE_NAMES.map((n) => ({
    name: n,
    json: JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields),
  }));
  const seen = new Set();
  for (const block of blocks) {
    const hit = wanted.find((w) => w.json === JSON.stringify(block));
    assert.ok(hit, `a paste-ready block in the deploy note matches no node's spec:\n${JSON.stringify(block, null, 2)}`);
    assert.ok(!seen.has(hit.name), `${hit.name}'s block appears twice`);
    seen.add(hit.name);
  }
  assert.deepEqual([...seen].sort(), TERMINAL_NODE_NAMES.slice().sort());
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe UC-02's escalate and unrecognised
// nodes, and neither may silently revert the other
// ---------------------------------------------------------------------------
// `Escalate Expense Ticket` and `Unrecognised Expense Decision` are covered by
// TWO spec files, on purpose and along different dimensions:
//
//   this file's spec                           — the PROSE (internalNote), the
//                                                marker tag, group, status, id
//   workflows/nodes/escalationQueueTagSpec.js  — the QUEUE TAG, across all
//                                                fourteen nodes on all eight
//                                                graphs that share rca-iih7
//
// Splitting them is right: the queue-tag finding is an eight-graph problem and
// does not belong inside a UC-02 file, while the misleading prose is UC-02's
// alone. The hazard is that BOTH files carry a full `targetParameters` block
// for these two nodes, because either can be used to deploy them.
//
// THE TWO DELIBERATELY DISAGREE ON EXACTLY ONE FIELD. That file captured the
// live graph BEFORE this change, so its `internalNote` is the pre-change prose
// — publishing its `targetParameters` wholesale would revert this change. The
// test below pins the divergence to that one field, so a drift in `group`,
// `status`, `id` or `tags` still names itself, and so the day somebody
// reconciles the two the assertion flips to an equality rather than silently
// passing.
const { ESCALATION_QUEUE_TAG_NODES } = await import("../workflows/nodes/escalationQueueTagSpec.js");

for (const [nodeName, params] of [
  [ESCALATE_NODE_NAME, ESCALATE_PARAMETERS],
  [UNRECOGNISED_NODE_NAME, UNRECOGNISED_PARAMETERS],
]) {
  test(`cross-spec: "${nodeName}" — the TAGS agree exactly`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find(
      (e) => e.workflowId === UC02_WORKFLOW_ID && e.node === nodeName
    );
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetUpdateFields.tags)),
      JSON.parse(JSON.stringify(params.updateFields.tags)),
      `the two specs disagree about "${nodeName}"'s tags. Deploying from either would revert the other; fix both, in one change.`
    );
    assert.ok(params.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  });

  test(`cross-spec: "${nodeName}" — everything but the note agrees, and the note differs KNOWINGLY`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find(
      (e) => e.workflowId === UC02_WORKFLOW_ID && e.node === nodeName
    );
    for (const field of ["group", "status"]) {
      assert.equal(other.targetUpdateFields[field], params.updateFields[field], `${nodeName}.${field}`);
    }
    assert.equal(other.targetParameters.id, params.id, `${nodeName}.id`);
    // The one deliberate divergence. If it ever disappears the two specs have
    // been reconciled, which is good — and this test must be turned into an
    // equality then rather than left asserting a difference that no longer
    // exists.
    assert.notEqual(
      other.targetUpdateFields.internalNote,
      params.updateFields.internalNote,
      `${nodeName}: escalationQueueTagSpec.js now matches this spec's note. Reconciled — change this assertion to an equality.`
    );
    assert.ok(
      !other.targetUpdateFields.internalNote.includes(INTERNAL_NOTE_INTERPOLATION),
      `${nodeName}: escalationQueueTagSpec.js carries the PRE-CHANGE prose, as documented. Take its tags array only.`
    );
  });
}

test("cross-spec: the blocked and review nodes are in neither table by design", () => {
  // `isEscalation('blocked')` and `isEscalation('human_review')` are both
  // false, so `routingTag` already IS the queue tag on those two branches and a
  // second copy would be redundant. Their absence from the queue-tag table is a
  // decision, not an omission.
  for (const nodeName of [BLOCKED_NODE_NAME, REVIEW_NODE_NAME, RESOLVE_NODE_NAME]) {
    assert.equal(
      ESCALATION_QUEUE_TAG_NODES.find((e) => e.workflowId === UC02_WORKFLOW_ID && e.node === nodeName),
      undefined,
      `${nodeName} unexpectedly appears in escalationQueueTagSpec.js — the two files' ownership has shifted`
    );
  }
  assert.ok(!BLOCKED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(!REVIEW_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
});
