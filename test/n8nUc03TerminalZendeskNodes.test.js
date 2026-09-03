// ---------------------------------------------------------------------------
// n8nUc03TerminalZendeskNodes.test.js — UC-03's five terminal Zendesk nodes
// must interpolate the composed note, and the one string a CUSTOMER reads must
// stop telling them to do something that produces nothing
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-03's five terminal Zendesk nodes each carried a sentence typed into a node
// parameter, and the Code node that writes the customer-facing reply had no repo
// file at all. A Zendesk node carries no `jsCode`, so `verify-deployed`'s body
// diff is structurally blind to it; all six sat in
// `scripts/lib/unguarded-node-baseline.json` as accepted debt. So the least
// checked strings in this project were the ones that reach real people.
//
// `test/n8nUc03Parity.test.js` cannot cover this either, by its own design: it
// compares DECISIONS. A node that reaches the right verdict and describes it in
// false words passes it every time — which is exactly what happened, 61/61
// green, over a note that told a specialist to open a screen that has never held
// anything for an n8n-decided run and a public reply that told a customer to
// reply to a ticket the graph will refuse as a duplicate delivery.
//
// HERMETIC. No network, no n8n key. The five live nodes and the live Code-node
// body are held here as verbatim snapshots captured from
// `GET /api/v1/workflows/WORKFLOW_UC03_ID` on 2026-08-31 (`versionId ===
// activeVersionId === 63ceb10d-0ec3-4fa4-926a-e3eb1cb84b38`) and used as
// NEGATIVE CONTROLS — a detector that has never been shown failing is a detector
// nobody has tested, and this repo has twice closed a finding on a confident zero
// from a half-broken detector.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  REPLY_NODE_NAME,
  LETTER_REVIEW_NODE_NAME,
  ESCALATE_NODE_NAME,
  ROUTE_UC04_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  NOTE_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  REPLY_PARAMETERS,
  LETTER_REVIEW_PARAMETERS,
  ESCALATE_PARAMETERS,
  ROUTE_UC04_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  PUBLIC_REPLY_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  AUTO_RESOLVED_TAG,
  LETTER_REVIEW_TAG,
  ESCALATED_TAG,
  ROUTED_UC04_TAG,
  EXCEPTION_TAG,
  REPLY_STATUS,
  LETTER_REVIEW_STATUS,
  ESCALATE_STATUS,
  ROUTE_UC04_STATUS,
  UNRECOGNISED_STATUS,
  FORBIDDEN_PHRASES,
  REACHABLE_HUMAN_REVIEW_REASONS,
  terminalZendeskNodeIssues,
  replyNodeIssues,
  letterReviewNodeIssues,
  escalateNodeIssues,
  routeUc04NodeIssues,
  unrecognisedNodeIssues,
} from "../workflows/nodes-uc03/terminalZendeskNodesSpec.js";
import { escalationQueueTagIssues, ESCALATION_QUEUE_TAG_NODES } from "../workflows/nodes/escalationQueueTagSpec.js";
import { GATE_SEQUENCE } from "../src/uc03/policyEngine.js";
import { UC04_INPUTS_UC03_CANNOT_SOURCE } from "../src/uc03/uc04Intake.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc03");
const SHARED_NODES_DIR = join(__dirname, "..", "workflows", "nodes");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const LIVE_REPLY_BEFORE_FIX = {
  name: "Reply + Solve Ticket",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      publicReply: "={{ $json.informationalAnswer }}",
      status: "solved",
      tags: ["uc03_auto_resolved"],
    },
  },
};

const LIVE_LETTER_REVIEW_BEFORE_FIX = {
  name: "Flag For Formal Letter Review",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        '=AI summary — decision: {{ $json.decision }} ({{ $json.reason }}). Flags: {{ $json.flags.join(", ") || "none" }}. Formal travel support letter DRAFTED text is available in the UC-03 app; NOT auto-issued — specialist sign-off required. {{ $(\'Assign Routing\').item.json.routingNote }}',
      status: "pending",
      tags: ["uc03_formal_letter_review", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_ESCALATE_BEFORE_FIX = {
  name: "Escalate Travel Ticket",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        '=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(", ") || "none" }}. No letter was issued. {{ $(\'Assign Routing\').item.json.routingNote }}',
      status: "open",
      tags: [
        "uc03_escalated",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_ROUTE_UC04_BEFORE_FIX = {
  name: "Route To UC-04",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        '=AI summary — ROUTED to UC-04 (work authorization): {{ $json.reason }}. Handoff event: {{ $json.handoffEvent ? $json.handoffEvent.event_type : "none" }} → destination {{ $json.handoffEvent ? $json.handoffEvent.destination_country : "unknown" }}. UC-04 owns its own compliance case; this event is recorded for inspection only, never dispatched automatically. {{ $(\'Assign Routing\').item.json.routingNote }}',
      status: "open",
      tags: ["uc03_routed_uc04", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_UNRECOGNISED_BEFORE_FIX = {
  name: "Unrecognised Travel Decision",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc03_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_NODES = [
  LIVE_REPLY_BEFORE_FIX,
  LIVE_LETTER_REVIEW_BEFORE_FIX,
  LIVE_ESCALATE_BEFORE_FIX,
  LIVE_ROUTE_UC04_BEFORE_FIX,
  LIVE_UNRECOGNISED_BEFORE_FIX,
];

/** The five nodes as they must look after the deploy. */
const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

// ---------------------------------------------------------------------------
// 1. The targets pass
// ---------------------------------------------------------------------------

test("all five target parameter blocks pass their own checker", () => {
  assert.deepEqual(replyNodeIssues(targetNode(REPLY_NODE_NAME)), []);
  assert.deepEqual(letterReviewNodeIssues(targetNode(LETTER_REVIEW_NODE_NAME)), []);
  assert.deepEqual(escalateNodeIssues(targetNode(ESCALATE_NODE_NAME)), []);
  assert.deepEqual(routeUc04NodeIssues(targetNode(ROUTE_UC04_NODE_NAME)), []);
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

test("all four note nodes interpolate the same expression — the difference is composed upstream", () => {
  for (const name of NOTE_NODE_NAMES) {
    const note = TERMINAL_NODE_SPECS[name].parameters.updateFields.internalNote;
    assert.equal(note, INTERNAL_NOTE_EXPRESSION, name);
    assert.ok(note.includes(INTERNAL_NOTE_INTERPOLATION));
    assert.ok(note.includes(ROUTING_NOTE_INTERPOLATION));
  }
  // And the fifth carries no note and a PUBLIC reply instead.
  assert.equal(REPLY_PARAMETERS.updateFields.internalNote, undefined);
  assert.equal(REPLY_PARAMETERS.updateFields.publicReply, PUBLIC_REPLY_EXPRESSION);
});

test("the note is read off $json, NOT off $('Travel Router Gates') — and that is a fact about this graph", () => {
  // UC-04's sibling spec addresses its gates node BY NAME because `Assign
  // Routing` there spreads a Supabase insert response. UC-03 has a `Carry
  // Context Forward` node in between, so `$json` here IS the gates' output —
  // proved by execution below, not by this assertion. What this assertion pins
  // is that the two forms have not been mixed up: `.item` would resolve through
  // item pairing, and `Carry Context Forward` sets no explicit `pairedItem`.
  assert.equal(INTERNAL_NOTE_INTERPOLATION, "{{ $json.internalNote }}");
  assert.ok(!INTERNAL_NOTE_INTERPOLATION.includes("Travel Router Gates"));
  // The routing sentence DOES address a node by name, because `Assign Routing`
  // sets `pairedItem` explicitly and its fields are not on `$json` at all until
  // it has run.
  assert.ok(ROUTING_NOTE_INTERPOLATION.includes("$('Assign Routing')"));
});

test("the unchanged fields really are unchanged", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const params = TERMINAL_NODE_SPECS[name].parameters;
    assert.equal(params.authentication, "oAuth2");
    assert.equal(params.operation, "update");
    assert.equal(params.id, TICKET_ID_EXPRESSION);
  }
  for (const name of NOTE_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(uf.group, ZENDESK_GROUP_EXPRESSION);
    assert.ok(uf.tags.includes(ROUTING_TAG_EXPRESSION));
  }
  // `Reply + Solve Ticket` sets NO group. That is a real gap (an auto-resolved
  // UC-03 ticket lands in the account's default Support group) and it is named
  // as a follow-up in the spec header rather than silently changed here — so
  // the assertion records the current state honestly instead of asserting the
  // state somebody would prefer.
  assert.equal(REPLY_PARAMETERS.updateFields.group, undefined);

  assert.equal(REPLY_PARAMETERS.updateFields.status, REPLY_STATUS);
  assert.equal(REPLY_PARAMETERS.updateFields.status, "solved");
  assert.equal(LETTER_REVIEW_PARAMETERS.updateFields.status, LETTER_REVIEW_STATUS);
  assert.equal(LETTER_REVIEW_PARAMETERS.updateFields.status, "pending");
  assert.equal(ESCALATE_PARAMETERS.updateFields.status, ESCALATE_STATUS);
  assert.equal(ROUTE_UC04_PARAMETERS.updateFields.status, ROUTE_UC04_STATUS);
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.status, UNRECOGNISED_STATUS);

  assert.ok(REPLY_PARAMETERS.updateFields.tags.includes(AUTO_RESOLVED_TAG));
  assert.ok(LETTER_REVIEW_PARAMETERS.updateFields.tags.includes(LETTER_REVIEW_TAG));
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(ESCALATED_TAG));
  assert.ok(ROUTE_UC04_PARAMETERS.updateFields.tags.includes(ROUTED_UC04_TAG));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(EXCEPTION_TAG));
});

// ---------------------------------------------------------------------------
// 2. THE QUEUE TAG IS SOMEBODY ELSE'S DIMENSION — asserted, not assumed
// ---------------------------------------------------------------------------

test("this checker does NOT police the queue tag, and escalationQueueTagSpec does", () => {
  // The orthogonality this pass depends on. Two checkers asserting one field is
  // how a fix in one lands as a failure in the other; so the split is proved
  // rather than described — drop the queue tag and THIS checker must stay
  // silent while the other one names it.
  const stripped = targetNode(ESCALATE_NODE_NAME);
  stripped.parameters.updateFields.tags = stripped.parameters.updateFields.tags.filter(
    (t) => t !== QUEUE_TAG_EXPRESSION
  );
  assert.deepEqual(escalateNodeIssues(stripped), [], "the queue tag is not this file's business");
  const other = escalationQueueTagIssues(stripped);
  assert.ok(
    other.some((i) => i.includes("routing.queueTag")),
    "escalationQueueTagSpec must be the one that catches it"
  );
});

test("the queue tag is nevertheless present in the pasteable blocks, on exactly the two nodes that own it", () => {
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  // `Route To UC-04` is NOT one of escalationQueueTagSpec's fourteen:
  // `isEscalation('route_to_uc04')` is false, so `routingTag` already IS the
  // queue tag on that branch — and for that branch alone it is UC-04's queue
  // tag, because `handoffUseCase` repoints Assign Routing's lookup key.
  assert.ok(!ROUTE_UC04_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(!REPLY_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(!LETTER_REVIEW_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE CONTROLS — the live nodes must be REJECTED, by name
// ---------------------------------------------------------------------------

test("NEGATIVE CONTROL: the letter-review node as deployed today is rejected, for the right reasons", () => {
  const issues = letterReviewNodeIssues(LIVE_LETTER_REVIEW_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the hand-typed inline note must be flagged"
  );
  assert.ok(
    issues.some((i) => i.includes("drafted text is available")),
    "the claim that nothing on this graph drafts must be flagged BY NAME"
  );
  assert.ok(
    issues.some((i) => i.includes("in the uc-03 app")),
    "the pointer at a screen that answers 404 for this run must be flagged BY NAME"
  );
  assert.ok(
    issues.some((i) => i.includes("specialist sign-off required")),
    "the signature src/uc03/signoffPolicy.js refuses must be flagged BY NAME"
  );
  // The status, group and tags on this node were already right — the checker
  // must not manufacture failures on fields the deploy does not touch.
  assert.ok(!issues.some((i) => i.includes("updateFields.status")));
  assert.ok(!issues.some((i) => i.includes("updateFields.group")));
});

test("NEGATIVE CONTROL: the escalate and route nodes as deployed today are rejected for the note, not the prose", () => {
  // Both of these carried a sentence that is TRUE. The defect is that it is
  // hand-typed and unversioned, and the test says so rather than pretending the
  // defect is the same shape as the letter-review node's.
  for (const live of [LIVE_ESCALATE_BEFORE_FIX, LIVE_ROUTE_UC04_BEFORE_FIX, LIVE_UNRECOGNISED_BEFORE_FIX]) {
    const issues = terminalZendeskNodeIssues(live);
    assert.ok(issues.length >= 1, `${live.name}: expected a failure, got none`);
    assert.ok(
      issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
      `${live.name}: the hand-typed inline note must be flagged`
    );
    assert.ok(
      !issues.some((i) => FORBIDDEN_PHRASES.some((p) => i.includes(p))),
      `${live.name}: its prose is not false, so no forbidden phrase should fire`
    );
  }
});

test("NEGATIVE CONTROL: the reply node as deployed today PASSES — its defect is one node upstream", () => {
  // The honest result, and it is the point of capturing this node at all: the
  // Zendesk node was never wrong. The false instruction to the customer lived in
  // the Code node that feeds it, which is why a parameter-level check alone
  // would have declared this branch clean. The guard for that string is
  // `workflows/nodes-uc03/renderInformationalAnswer.js` existing as a file
  // `verify-deployed` can diff, plus the assertions in section 6 below.
  assert.deepEqual(replyNodeIssues(LIVE_REPLY_BEFORE_FIX), []);
});

test("NEGATIVE CONTROL: no live node passes as a DIFFERENT node's spec", () => {
  // A mix-up in STRUCTURAL_MAPPINGS must be loud rather than silent.
  assert.ok(letterReviewNodeIssues(targetNode(ESCALATE_NODE_NAME)).length > 0);
  assert.ok(escalateNodeIssues(targetNode(LETTER_REVIEW_NODE_NAME)).length > 0);
  assert.ok(replyNodeIssues(targetNode(ESCALATE_NODE_NAME)).length > 0);
});

// ---------------------------------------------------------------------------
// 4. Per-regression mutations — each one caught on its own
// ---------------------------------------------------------------------------

const mutate = (name, patch) => {
  const n = targetNode(name);
  n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
  return terminalZendeskNodeIssues(n, name);
};

test("the interpolation replaced by an inline sentence is caught, on all four note nodes", () => {
  for (const name of NOTE_NODE_NAMES) {
    const issues = mutate(name, { internalNote: "=AI summary — decision: escalate. Routed to a human." });
    assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)), `${name}: an inline note must be refused`);
  }
});

test("a forbidden phrase reintroduced ALONGSIDE a correct interpolation is still caught", () => {
  // The subtle regression: somebody keeps the interpolation and appends the old
  // sentence back "for context". The note is then both correct and false.
  const issues = mutate(LETTER_REVIEW_NODE_NAME, {
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nFormal travel support letter DRAFTED text is available in the UC-03 app; NOT auto-issued — specialist sign-off required.`,
  });
  assert.ok(!issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)), "the interpolation itself is present");
  assert.ok(issues.some((i) => i.includes("drafted text is available")));
  assert.ok(issues.some((i) => i.includes("specialist sign-off required")));
  assert.ok(issues.some((i) => i.includes("not auto-issued")));
});

test("the CUSTOMER-facing sentence pasted into an internal note is caught too", () => {
  // It has no business in an internal note either, and this is the shape the
  // phrase would come back in if somebody "restored" the old wording from the
  // ticket rather than from git.
  const issues = mutate(ESCALATE_NODE_NAME, {
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nIf you need a formal letter, reply to this ticket and a specialist will review and issue it.`,
  });
  assert.ok(issues.some((i) => i.includes("reply to this ticket and a specialist")));
  assert.ok(issues.some((i) => i.includes("a specialist will review and issue")));
});

test("a forbidden phrase hidden in ANOTHER updateFields field is still caught", () => {
  // The 2026-08-29 Zendesk migration's lesson: a field-by-field walk misses the
  // copy inside a string inside another field. The check reads the whole blob.
  const issues = mutate(ESCALATE_NODE_NAME, {
    tags: [ESCALATED_TAG, ROUTING_TAG_EXPRESSION, "global mobility"],
  });
  assert.ok(issues.some((i) => i.includes("global mobility")));
});

test("the routing sentence dropped from the expression is caught", () => {
  for (const name of NOTE_NODE_NAMES) {
    const issues = mutate(name, { internalNote: `=${INTERNAL_NOTE_INTERPOLATION}` });
    assert.ok(issues.some((i) => i.includes(ROUTING_NOTE_INTERPOLATION)), name);
  }
});

test("the public reply dropped or repointed is caught — the branch would go silent on a green run", () => {
  assert.ok(mutate(REPLY_NODE_NAME, { publicReply: undefined }).some((i) => i.includes("publicReply")));
  assert.ok(
    mutate(REPLY_NODE_NAME, { publicReply: "={{ $json.answer }}" }).some((i) => i.includes("publicReply")),
    "a field name nothing produces renders as an EMPTY STRING, not as an error"
  );
});

test("each tag dropped is caught, one at a time", () => {
  assert.ok(mutate(REPLY_NODE_NAME, { tags: [] }).some((i) => i.includes(AUTO_RESOLVED_TAG)));
  assert.ok(mutate(LETTER_REVIEW_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(LETTER_REVIEW_TAG)));
  assert.ok(mutate(LETTER_REVIEW_NODE_NAME, { tags: [LETTER_REVIEW_TAG] }).some((i) => i.includes("routingTag")));
  assert.ok(mutate(ESCALATE_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(ESCALATED_TAG)));
  assert.ok(mutate(ROUTE_UC04_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(ROUTED_UC04_TAG)));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(EXCEPTION_TAG)));

  // And tags gone entirely, or not an array at all.
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(mutate(name, { tags: undefined }).length > 0, name);
    assert.ok(mutate(name, { tags: "uc03_escalated" }).length > 0, name);
  }
});

test("an EXTRA tag is not a regression — the loop guard must be addable without going red", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const withGuard = [...TERMINAL_NODE_SPECS[name].parameters.updateFields.tags, "uc_processed"];
    assert.deepEqual(mutate(name, { tags: withGuard }), [], name);
  }
});

test("the group dropped is caught on the four nodes that set one", () => {
  for (const name of NOTE_NODE_NAMES) {
    assert.ok(mutate(name, { group: undefined }).some((i) => i.includes("group")), name);
    assert.ok(mutate(name, { group: "={{ $json.zendeskGroupId }}" }).some((i) => i.includes("group")), name);
  }
  // …and NOT manufactured on the one that sets none. A checker that demanded a
  // group here would refuse the live node for a gap this pass deliberately did
  // not close.
  assert.deepEqual(mutate(REPLY_NODE_NAME, { group: undefined }), []);
});

test("the status flipped is caught, in every direction", () => {
  assert.ok(mutate(REPLY_NODE_NAME, { status: "open" }).some((i) => i.includes("status")));
  assert.ok(mutate(LETTER_REVIEW_NODE_NAME, { status: "open" }).some((i) => i.includes("status")));
  assert.ok(mutate(ESCALATE_NODE_NAME, { status: "pending" }).some((i) => i.includes("status")));
  assert.ok(mutate(ROUTE_UC04_NODE_NAME, { status: "solved" }).some((i) => i.includes("status")));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { status: "solved" }).some((i) => i.includes("status")));
});

test("the ticket id repointed is caught", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const n = targetNode(name);
    n.parameters.id = "={{ $('Travel Router Gates').item.json.externalRef }}";
    assert.ok(terminalZendeskNodeIssues(n, name).some((i) => i.includes("parameters.id")), name);
  }
});

// ---------------------------------------------------------------------------
// 5. The interpolation names a field that really reaches `$json` at these nodes
// ---------------------------------------------------------------------------
//
// THE FAILURE THIS CATCHES IS SILENT IN PRODUCTION. An n8n expression that
// dereferences a field nothing produces renders as an EMPTY STRING on a fully
// green execution. So the chain is EXECUTED rather than reasoned about: the real
// `travelRouterGates.js`, the live `Carry Context Forward` body (captured
// verbatim below — it has no repo file), and the real `assignRouting.js`, in the
// order the graph runs them.

const gatesSource = readFileSync(join(NODES_DIR, "travelRouterGates.js"), "utf8");
const assignRoutingSource = readFileSync(join(SHARED_NODES_DIR, "assignRouting.js"), "utf8");

// `Carry Context Forward`, read live off WORKFLOW_UC03_ID on 2026-08-31. It has
// no file in this repository — it is one of the nodes
// `scripts/lib/unguarded-node-baseline.json` baselines as unguarded — so it is
// captured here rather than imported. It is the whole reason `$json` at UC-03's
// terminal nodes carries the gates' fields at all.
const LIVE_CARRY_CONTEXT_FORWARD = `return [{ json: $('Travel Router Gates').first().json }];`;

const CODES = ["DE", "EE", "ES", "FR", "GB", "IE", "IN", "IT", "MX", "NG", "NL", "PH", "PL", "PT", "US"];
const countries = () => CODES.map((c) => ({ country_code: c, name: c }));

const COMPLETE_EMP = {
  id: "emp_active_001",
  status: "active",
  country_code: "NG",
  full_name: "Amara Okafor",
  job_title: "Senior Engineer",
  contract_type: "full_time",
  start_date: "2022-03-01",
};
const SESSION = { authenticatedEmploymentId: "emp_active_001" };
const requestFor = (text, over = {}) => ({
  employmentId: "emp_active_001",
  session: SESSION,
  externalRef: "3001",
  text,
  ...over,
});

function runGates({ request, employment = COMPLETE_EMP, classification, legalEntity }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Inquiry") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: { data: { employment } } }) };
      if (nodeName === "Fetch Countries (Remote)") return { first: () => ({ json: { data: { countries: countries() } } }) };
      if (nodeName === "Fetch Legal Entity (Remote)") {
        // The node is NOT on the live graph, and `$()` THROWS for a node that is
        // not on the canvas — which is exactly what `readLetterheadAvailable()`
        // catches. Modelled faithfully rather than returned as null.
        if (!legalEntity) throw new Error("no such node");
        return { first: () => ({ json: { data: { legal_entity: legalEntity } } }) };
      }
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    $input: { first: () => ({ json: classification ?? { choices: [] } }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  // node:vm results are cross-realm; n8n round-trips between nodes too.
  return JSON.parse(JSON.stringify(result[0].json));
}

/** Run the graph's real Code nodes in order and return what `$json` is at the terminal Zendesk nodes. */
function runToTerminalJson(args) {
  const gatesOut = runGates(args);
  const carried = JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        `(function () {\n${LIVE_CARRY_CONTEXT_FORWARD}\n})()`,
        { $: (n) => ({ first: () => ({ json: gatesOut }) }) },
        { timeout: 5000 }
      )[0].json
    )
  );
  const routed = vm.runInNewContext(
    `(function () {\n${assignRoutingSource}\n})()`,
    {
      $json: carried,
      $: (nodeName) => {
        if (nodeName === "Append Audit Log") return { first: () => ({ json: { use_case: "UC-03" } }) };
        throw new Error(`Unexpected $() lookup for "${nodeName}"`);
      },
    },
    { timeout: 5000 }
  );
  return JSON.parse(JSON.stringify(routed[0].json));
}

const LETTER_TEXT =
  "I want a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.";
const PLAIN_TEXT = "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?";
const UC04_TEXT = "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?";
const SANCTIONED_TEXT = "Business trip to Iran from 2026-09-01 to 2026-09-10";
const SCOPE_TEXT =
  "Please send a travel support letter for Germany from 2026-09-20 to 2026-09-26 addressed to the consulate.";

test("`$json.internalNote` really is populated where these nodes read it", () => {
  const field = INTERNAL_NOTE_INTERPOLATION.match(/\$json\.(\w+)/)?.[1];
  assert.equal(field, "internalNote");
  for (const text of [PLAIN_TEXT, LETTER_TEXT, UC04_TEXT, SANCTIONED_TEXT, SCOPE_TEXT]) {
    const atNode = runToTerminalJson({ request: requestFor(text) });
    assert.equal(typeof atNode[field], "string", text);
    assert.ok(atNode[field].length > 400, `the composed note is empty or a stub for ${atNode.decision}/${atNode.reason}`);
    // And the routing sentence the expression appends really is there too.
    assert.equal(typeof atNode.routingNote, "string");
    assert.ok(atNode.routingNote.length > 0);
  }
});

test("`Reply + Solve Ticket` reads a field its own predecessor really emits", () => {
  const renderSource = readFileSync(join(NODES_DIR, "renderInformationalAnswer.js"), "utf8");
  const gatesOut = runGates({ request: requestFor(PLAIN_TEXT) });
  const rendered = JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        `(function () {\n${renderSource}\n})()`,
        { $: (n) => ({ first: () => ({ json: gatesOut }) }) },
        { timeout: 5000 }
      )[0].json
    )
  );
  const field = PUBLIC_REPLY_EXPRESSION.match(/\$json\.(\w+)/)?.[1];
  assert.equal(field, "informationalAnswer");
  assert.equal(typeof rendered[field], "string");
  assert.ok(rendered[field].length > 200);
  assert.equal(rendered.externalRef, "3001", "and the id expression's field survives the render node too");
});

// ---------------------------------------------------------------------------
// 6. THE CUSTOMER-FACING BODY — plain text, no false instruction, no harness
// ---------------------------------------------------------------------------

const renderSource = readFileSync(join(NODES_DIR, "renderInformationalAnswer.js"), "utf8");
const liveRenderSource = readFileSync(join(__dirname, "fixtures", "uc03LiveRenderInformationalAnswer.txt"), "utf8");

function renderBody(source, text = PLAIN_TEXT) {
  const gatesOut = runGates({ request: requestFor(text) });
  const out = vm.runInNewContext(
    `(function () {\n${source}\n})()`,
    { $: (n) => ({ first: () => ({ json: gatesOut }) }) },
    { timeout: 5000 }
  );
  return JSON.parse(JSON.stringify(out[0].json)).informationalAnswer;
}

test("NEGATIVE CONTROL: the LIVE render body really does tell the customer to reply to the ticket", () => {
  // Without this, "the new body does not contain the sentence" proves only that
  // the detector never fires. The retired body is captured verbatim from the
  // live graph and rendered through the same harness.
  const live = renderBody(liveRenderSource);
  assert.match(live, /reply to this ticket and a specialist will review and issue it/);
});

test("the new render body no longer tells the customer to do the one thing that produces nothing", () => {
  const body = renderBody(renderSource);
  assert.doesNotMatch(body, /reply to this ticket and a specialist/i);
  assert.doesNotMatch(body, /a specialist will review and issue/i);
  // And it does not swap in src/uc03/letter.js's promise either, which is
  // unbackable on this path: accepting the offer is
  // POST /api/cases/:id/request-letter and this graph writes no `cases` row.
  assert.doesNotMatch(body, /accept the travel-letter offer/i);
  assert.doesNotMatch(body, /issued to you straight away/i);
  // What it says instead, and each clause is a claim about THIS path.
  assert.match(body, /separate request rather than a reply here/);
  assert.match(body, /replying to it does not start a letter request/);
  assert.match(body, /Request Hub/);
});

test("the customer-facing body is PLAIN TEXT — publicReply silently escapes HTML", () => {
  // UC-01 shipped a rendered HTML letter through `publicReply` and the customer
  // received literal `&lt;!doctype html&gt;…` on a fully "successful" run.
  // Checked on the RENDERED body, not on the source, because the source is
  // allowed to contain whatever a comment contains.
  for (const text of [PLAIN_TEXT, LETTER_TEXT]) {
    const body = renderBody(renderSource, text);
    assert.doesNotMatch(body, /<\/?[a-z][a-z0-9]*\b[^>]*>/i, "an HTML tag in a publicReply body");
    assert.doesNotMatch(body, /&(?:lt|gt|amp|quot|#\d+);/i, "an HTML entity in a publicReply body");
  }
});

test("the customer-facing body carries no harness vocabulary and no money", () => {
  for (const text of [PLAIN_TEXT, LETTER_TEXT, SCOPE_TEXT]) {
    const body = renderBody(renderSource, text);
    assert.equal(findHarnessVocabulary(body), null, `harness vocabulary in a customer reply: ${body}`);
    // UC-03's standing invariant: an informational answer never states pay.
    assert.doesNotMatch(body, /salary|compensation|gross amount/i);
  }
  // The mandatory travel disclaimer survives the rewrite.
  assert.match(renderBody(renderSource), /not legal or immigration advice/);
});

test("the retired sentence is one of FORBIDDEN_PHRASES, so it cannot come back through a node parameter either", () => {
  const live = renderBody(liveRenderSource).toLowerCase();
  assert.ok(
    FORBIDDEN_PHRASES.some((p) => live.includes(p.toLowerCase())),
    "the customer-facing defect must also be spelled in the node-parameter guard"
  );
});

// ---------------------------------------------------------------------------
// 7. WHAT THE COMPOSED NOTE SAYS — the four defects, per decision
// ---------------------------------------------------------------------------

const noteFor = (text, over = {}) => runGates({ request: requestFor(text), ...over });

test("the letter-review branch no longer claims a draft exists, and says what is really owed", () => {
  const run = noteFor(LETTER_TEXT);
  assert.equal(run.decision, "human_review");
  assert.equal(run.reason, "formal_letter_requested");
  assert.ok(run.flags.includes("letterhead_unavailable"));
  assert.match(run.internalNote, /NO LETTER WAS WRITTEN AND NONE IS WAITING FOR A SIGNATURE/);
  assert.match(run.internalNote, /no letter-render node and writes no documents row/);
  assert.match(run.internalNote, /fix to the employing-entity record and a re-run — not a signature/);
  // The three retired claims, absent.
  assert.doesNotMatch(run.internalNote, /DRAFTED text is available/i);
  assert.doesNotMatch(run.internalNote, /UC-03 app/i);
  assert.doesNotMatch(run.internalNote, /specialist sign-off required/i);
});

test("every branch says where it is worked, because the sidebar answers 404 for an n8n-decided ticket", () => {
  for (const text of [LETTER_TEXT, SANCTIONED_TEXT, SCOPE_TEXT]) {
    const run = noteFor(text);
    assert.match(run.internalNote, /creates no cases row/, `${run.decision}/${run.reason}`);
    assert.match(run.internalNote, /answer 404 for this ticket/, `${run.decision}/${run.reason}`);
  }
});

test("the escalate branch keeps the one retired sentence that was TRUE", () => {
  const run = noteFor(SANCTIONED_TEXT);
  assert.equal(run.decision, "escalate");
  assert.match(run.internalNote, /No letter was issued\./);
});

test("the UC-04 hand-off names the actor, the surface, and the three things that do not exist", () => {
  const run = noteFor(UC04_TEXT);
  assert.equal(run.decision, "route_to_uc04");
  // The claim that was already true, kept.
  assert.match(run.internalNote, /RECORDED FOR INSPECTION and dispatched to nothing/);
  // What was missing.
  assert.match(run.internalNote, /WHO ACTS NEXT: the travelling employee, in Remote's own Request Hub/);
  assert.match(run.internalNote, /no uc04_\* tag/);
  assert.match(run.internalNote, /no uc04_authorizations row was created/);
  assert.match(run.internalNote, /both sidebars answer 404/);
  assert.match(run.internalNote, /OUTREACH, not a signature/);
  for (const label of UC04_INPUTS_UC03_CANNOT_SOURCE) {
    assert.ok(run.internalNote.includes(label), `the note does not name "${label}"`);
  }
});

test('"AI" is judged per RUN, not asserted per node', () => {
  // The rule-based path — every hermetic scenario takes it — must not claim a
  // model read anything.
  const ruleRun = noteFor(UC04_TEXT);
  assert.equal(ruleRun.classification.source, "rule_based_fallback");
  assert.match(ruleRun.internalNote, /NO MODEL WAS USED on this run/);
  assert.doesNotMatch(ruleRun.internalNote, /^AI summary/m);
  // And on this branch specifically, the handoff event is stated as
  // deterministic — it is assembled from fields already read, which is what the
  // retired "AI summary — ROUTED" opening got wrong in kind, not degree.
  assert.match(ruleRun.internalNote, /deterministically built from fields already read, not summarised by a model/);

  // The LLM path must say so.
  const llmRun = runGates({
    request: requestFor(PLAIN_TEXT),
    classification: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "business_travel",
              destinationCountry: "ES",
              startDate: "2026-09-14",
              endDate: "2026-10-02",
              formalLetterRequested: false,
              confidence: 0.95,
            }),
          },
        },
      ],
    },
  });
  assert.equal(llmRun.classification.source, "llm");
  assert.match(llmRun.internalNote, /AI-ASSISTED: a language model read the request text/);
});

test("the note withholds the subject when the decision's own verdict is that we do not know who is asking", () => {
  const run = runGates({ request: requestFor(PLAIN_TEXT, { session: null }) });
  assert.equal(run.reason, "identity_not_verified");
  assert.match(run.internalNote, /subject details withheld/);
  assert.doesNotMatch(run.internalNote, /Amara Okafor/);
  // The identity facts themselves stay — they are what makes the note actionable.
  assert.match(run.internalNote, /Identity signal used:/);
});

// ---------------------------------------------------------------------------
// 8. THE FABRICATED FLAGS — fixed upstream, verified here in BOTH directions
// ---------------------------------------------------------------------------

test("no letter_missing_* flag fires on a complete employment record", () => {
  // Before b5227da the gates body carried only id / status / country_code /
  // email, so `assessLetterScope()` reported four missing template fields on
  // EVERY run and the escalate note printed four fabricated findings about a
  // real customer's record. Driven, not read.
  const run = noteFor(SCOPE_TEXT);
  const fabricated = run.flags.filter((f) => /^letter_missing_/.test(f));
  assert.deepEqual(fabricated, [], `fabricated record findings: ${JSON.stringify(fabricated)}`);
  assert.match(run.internalNote, /Flags: letter_scope_exceeded, letter_addressee_specified\./);
});

test("NEGATIVE CONTROL: they still fire on a record that really is incomplete", () => {
  // Otherwise the assertion above would pass just as happily if the whole
  // letter-scope check had been deleted.
  const run = runGates({
    request: requestFor(LETTER_TEXT),
    // A REAL contract_type, so the run REACHES the letter-scope rung this
    // control is about. UC-03's engagement gate (2026-09-03) sits ahead of it
    // and fails closed on an unreadable engagement — see the test below, which
    // is the other half of that and the reason this line changed.
    employment: { id: "emp_active_001", status: "active", country_code: "NG", contract_type: "full_time" },
  });
  assert.equal(run.reason, "letter_scope_exceeded");
  for (const field of ["full_name", "job_title", "start_date"]) {
    assert.ok(run.flags.includes(`letter_missing_${field}`), `letter_missing_${field} must still be reachable`);
  }
});

test("a record with NO contract type is refused rather than described as \"unknown\" — the finding above it is closed", () => {
  // THIS TEST REPLACES A PINNED OPEN FINDING, and the finding is worth keeping
  // in words because it is what changed. The control above used to end:
  //
  //   "BOTH the port and normalizeEmployment() default contract_type to the
  //    literal string 'unknown', so blank() never sees it empty and
  //    letter_missing_contract_type is UNREACHABLE on either execution path. A
  //    record with no contract type therefore produces a letter row reading
  //    'unknown' rather than a refusal. Out of this pass's scope."
  //
  // It is in scope now and it is closed, though not the way that note
  // imagined: `letter_missing_contract_type` is still unreachable, because the
  // engagement gate refuses the whole request BEFORE the letter is scoped. The
  // reader-facing outcome is the one the finding wanted — a record whose
  // engagement nobody can read produces a refusal, not a document with the
  // word "unknown" printed on it as though it were a contract type.
  const run = runGates({
    request: requestFor(LETTER_TEXT),
    employment: { id: "emp_active_001", status: "active", country_code: "NG" },
  });
  assert.equal(run.employment.contract_type, "unknown", "the default is unchanged; what changed is what is DONE with it");
  assert.equal(run.decision, "blocked");
  assert.equal(run.reason, "eor_status_unknown");
  assert.ok(run.flags.includes("engagement_unreadable"));
  assert.ok(!run.flags.includes("letter_missing_contract_type"), "still unreachable — the request never reaches the letter scope");
});

// ---------------------------------------------------------------------------
// 9. REACHABILITY — the table is re-derived by driving the body, not trusted
// ---------------------------------------------------------------------------

test("REACHABLE_HUMAN_REVIEW_REASONS matches what the gates body can actually emit", () => {
  const emitted = new Set(
    [...gatesSource.matchAll(/decision: 'human_review', flags, reason: '([a-z0-9_]+)'/g)].map((m) => m[1])
  );
  const tabled = new Set(REACHABLE_HUMAN_REVIEW_REASONS.map((r) => r.reason));
  assert.deepEqual([...emitted].sort(), [...tabled].sort());
  for (const row of REACHABLE_HUMAN_REVIEW_REASONS) {
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
  }
});

test("formal_letter_requested IS reachable — the brief this pass started from said it was not", () => {
  // Recorded because the answer MOVED. `b5227da` (the four employment fields)
  // landed hours before this pass and made the standard-letter path reachable
  // for the first time; until then every letter request escalated
  // `letter_scope_exceeded` on fabricated findings and `low_confidence` was this
  // node's only reachable input. Driven, so the claim cannot go stale silently.
  const run = noteFor(LETTER_TEXT);
  assert.equal(run.decision, "human_review");
  assert.equal(run.reason, "formal_letter_requested");
  assert.deepEqual(run.flags, ["formal_letter_requested", "letterhead_unavailable"]);
  assert.equal(REACHABLE_HUMAN_REVIEW_REASONS.find((r) => r.reason === "formal_letter_requested").reachable, true);
});

test("low_confidence is reachable and confidence_unknown is not", () => {
  const lowConf = noteFor("hello");
  assert.equal(lowConf.decision, "human_review");
  assert.equal(lowConf.reason, "low_confidence");

  // `confidence_unknown` needs `typeof confidence !== 'number'` at the gate. The
  // validator refuses a non-numeric confidence from the model, and the
  // rule-based fallback it then uses always emits one — so no input reaches it.
  // Shown rather than asserted: a model answer with a STRING confidence.
  const stringConfidence = runGates({
    request: requestFor(PLAIN_TEXT),
    classification: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "business_travel",
              destinationCountry: "ES",
              startDate: "2026-09-14",
              endDate: "2026-10-02",
              formalLetterRequested: false,
              confidence: "high",
            }),
          },
        },
      ],
    },
  });
  assert.equal(stringConfidence.classification.source, "rule_based_fallback");
  assert.equal(typeof stringConfidence.classification.confidence, "number");
  assert.notEqual(stringConfidence.reason, "confidence_unknown");
  assert.equal(REACHABLE_HUMAN_REVIEW_REASONS.find((r) => r.reason === "confidence_unknown").reachable, false);
});

// ---------------------------------------------------------------------------
// 10. THE PORTED PROSE IS THE REFERENCE PROSE
// ---------------------------------------------------------------------------

test("every ported gate meaning is byte-identical to src/uc03/policyEngine.js's, after ONE declared substitution", () => {
  // The port exists because an n8n Code node cannot import. What makes a copy
  // safe is that it is COMPARED, not that it was careful.
  const substitutions = [...gatesSource.matchAll(/\{ from: '([^']+)', to: '([^']+)' \}/g)].map((m) => ({
    from: m[1],
    to: m[2],
  }));
  assert.equal(substitutions.length, 1, "one declared rewrite, and adding a second must be a reviewed change");
  assert.equal(substitutions[0].from, "Global Mobility");

  // The port carries src's string VERBATIM in the source and applies the
  // substitution at runtime, so this compares the bytes rather than the result —
  // which is the stronger comparison: a rewrite that happened to render the same
  // text from a different sentence would pass a rendered-output check and fail
  // this one.
  for (const row of GATE_SEQUENCE) {
    assert.ok(
      gatesSource.includes(row.means),
      `the ported \`means\` for ${row.reason} is not byte-identical to src/uc03/policyEngine.js's`
    );
  }

  // …and the two that name a team are the two wrapped in the declared rewrite,
  // so the substitution cannot be silently bypassed by porting one of them raw.
  for (const row of GATE_SEQUENCE) {
    const wrapped = gatesSource.includes(`applyNoteMeansSubstitutions(\n      '${row.means}'`) ||
      gatesSource.includes(`applyNoteMeansSubstitutions(\n      "${row.means}"`);
    assert.equal(
      wrapped,
      row.means.includes(substitutions[0].from),
      `${row.reason}: a meaning naming "${substitutions[0].from}" must be wrapped, and one that does not must not be`
    );
  }
});

test("the declared substitution has no dead entries, and no ported meaning still names the wrong team", () => {
  // A substitution that fires on nothing is a rule nobody is following; a
  // substitution that misses is the defect it exists to prevent. Both are
  // checked on the RENDERED notes, which is where the string would reach a
  // ticket.
  const fired = GATE_SEQUENCE.filter((r) => r.means.includes("Global Mobility"));
  assert.equal(fired.length, 2, "two src meanings name Global Mobility — sanctioned_region and duration_over_cap");
  const run = noteFor(SANCTIONED_TEXT);
  assert.doesNotMatch(run.internalNote, /Global Mobility/);
  assert.match(run.internalNote, /the team this ticket is routed to owns it/);
});

test("every reason the gates body can return has a rung in the ported ladder", () => {
  // Read out of route()'s own body rather than the whole file: `reason:` also
  // appears on the identity object (`no_employment_record`,
  // `session_employment_mismatch`), which is a different vocabulary and is
  // reported separately in the note's identity line.
  const routeBody = gatesSource.slice(
    gatesSource.indexOf("function route({"),
    gatesSource.indexOf("// composeInternalNote() — the Zendesk internal note")
  );
  assert.ok(routeBody.length > 1000, "failed to slice route()'s body — the anchors have moved");
  const emitted = new Set([...routeBody.matchAll(/reason: '([a-z0-9_]+)'/g)].map((m) => m[1]));
  assert.ok(emitted.size >= 10, `only ${emitted.size} reasons found — the extraction is not extracting`);
  const laddered = new Set(GATE_SEQUENCE.map((r) => r.reason));
  for (const reason of emitted) {
    // The two upstream-failure reasons come from the ported upstreamFailure.js
    // and are not UC-03 gate rungs; they are excluded by name rather than by a
    // loose filter, so a NEW unladdered reason still fails this.
    if (reason === "upstream_record_not_found" || reason === "upstream_unavailable") continue;
    assert.ok(laddered.has(reason), `${reason} has no rung — the note would print no gate meaning for it`);
  }
});

test("the ported UC-04 input list is src's list, in src's order", () => {
  const ported = gatesSource.match(/const UC04_INPUTS_UC03_CANNOT_SOURCE = \[([\s\S]*?)\];/)[1];
  for (const label of UC04_INPUTS_UC03_CANNOT_SOURCE) {
    assert.ok(ported.includes(label), `the port does not carry "${label}"`);
  }
  assert.equal(UC04_INPUTS_UC03_CANNOT_SOURCE.length, 4);
});

// ---------------------------------------------------------------------------
// 11. Ticket hygiene — this text goes on a real customer's ticket
// ---------------------------------------------------------------------------

test("no target note expression or tag carries harness vocabulary", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    if (uf.internalNote) {
      assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    }
    for (const tag of uf.tags) {
      assert.equal(findHarnessVocabulary(tag), null, `${name}: harness vocabulary in tag ${tag}`);
    }
  }
});

test("neither does the note the gates body composes, on any decision", () => {
  for (const text of [PLAIN_TEXT, LETTER_TEXT, UC04_TEXT, SANCTIONED_TEXT, SCOPE_TEXT]) {
    const { internalNote } = noteFor(text);
    assert.equal(findHarnessVocabulary(internalNote), null, `harness vocabulary in the composed note: ${internalNote}`);
  }
});

// ---------------------------------------------------------------------------
// 12. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31.md"), "utf8");
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(md.includes(name), `the deploy note does not mention ${name}`);
  }
  assert.ok(md.includes("Render Informational Answer"), "the deploy note does not mention the Code node");
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION), "the deploy note does not carry the note interpolation");
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  for (const tag of [AUTO_RESOLVED_TAG, LETTER_REVIEW_TAG, ESCALATED_TAG, ROUTED_UC04_TAG, EXCEPTION_TAG]) {
    assert.ok(md.includes(tag), `the deploy note does not mention ${tag}`);
  }

  // The JSON blocks in the deploy note must BE the spec, not a retyping of it. A
  // paste-ready block that has drifted from the checker is worse than none: an
  // operator follows it and `verify-deployed` then reports the drift they were
  // told to create.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, TERMINAL_NODE_NAMES.length, "expected one paste-ready JSON block per node");
  const wanted = TERMINAL_NODE_NAMES.map((n) =>
    JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields))
  );
  assert.deepEqual(blocks, wanted);
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe UC-03's escalate and unrecognised
// nodes, and neither may silently revert the other
// ---------------------------------------------------------------------------
// `Escalate Travel Ticket` and `Unrecognised Travel Decision` are covered by TWO
// spec files, on purpose and along different dimensions:
//
//   this file                                  — the PROSE (internalNote) and
//                                                the per-decision marker tag
//   workflows/nodes/escalationQueueTagSpec.js  — the QUEUE TAG, across all
//                                                fourteen nodes on all nine
//                                                graphs that share the defect
//
// Splitting them is right: the queue-tag finding is a nine-graph problem and
// does not belong inside a UC-03 file, while the wrong-prose finding is UC-03's
// alone. The hazard is that BOTH files carry a full `targetParameters` block for
// these two nodes, because either can be used to deploy them — so a publish from
// the stale one reverts the other's fix.
//
// Held equal by assertion rather than by one file importing the other. An import
// would remove the duplication but also the failure message: a dropped field
// would simply propagate, silently and consistently. This way a divergence names
// itself and says which field.

for (const [nodeName, params] of [
  [ESCALATE_NODE_NAME, ESCALATE_PARAMETERS],
  [UNRECOGNISED_NODE_NAME, UNRECOGNISED_PARAMETERS],
]) {
  test(`cross-spec: "${nodeName}" is described identically in both specs`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find((e) => e.workflowId === "WORKFLOW_UC03_ID" && e.node === nodeName);
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetParameters.updateFields)),
      JSON.parse(JSON.stringify(params.updateFields)),
      `the two specs disagree about "${nodeName}". Deploying from either would revert the other; fix both, in one change.`
    );
    assert.equal(other.targetParameters.id, params.id);
  });
}

test("cross-spec: the three nodes escalationQueueTagSpec does NOT cover are the three that do not need it", () => {
  const covered = ESCALATION_QUEUE_TAG_NODES.filter((e) => e.workflowId === "WORKFLOW_UC03_ID").map((e) => e.node);
  assert.deepEqual(covered.sort(), [ESCALATE_NODE_NAME, UNRECOGNISED_NODE_NAME].sort());
  // `Reply + Solve Ticket` sets no group and no routing tag at all;
  // `Flag For Formal Letter Review` and `Route To UC-04` are non-escalation
  // branches, so `routingTag` already resolves to the queue tag on them.
  for (const name of [REPLY_NODE_NAME, LETTER_REVIEW_NODE_NAME, ROUTE_UC04_NODE_NAME]) {
    assert.ok(!covered.includes(name), `${name} is not one of the fourteen`);
  }
});
