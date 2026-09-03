// ---------------------------------------------------------------------------
// n8nUc09TerminalZendeskNodes.test.js — UC-09's four terminal Zendesk nodes
// must interpolate the composed note, not carry hand-typed prose, and the note
// they interpolate must not invite a manual payment on a request nothing
// verified
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so `verify-deployed`'s
// body diff is structurally blind to it, and all four of UC-09's terminal nodes
// carried sentences typed once into a node parameter and read back by nothing.
// `test/n8nUc09Parity.test.js` cannot cover them either, by its own design: it
// compares DECISIONS, and a node that reaches the right verdict and describes
// it in false words passes it every time.
//
// TWO DIFFERENT THINGS ARE CHECKED HERE, and neither substitutes for the other:
//
//   1. THE NODE PARAMETERS — that the four nodes interpolate the composed note
//      instead of restating it. Guards a hand edit in the n8n editor.
//   2. THE COMPOSED TEXT ITSELF — by EXECUTING the gates body in a node:vm
//      sandbox and reading the note it produces for every reachable escalate
//      reason. Guards a drift in the prose, which check 1 cannot see at all
//      because check 1 only ever sees `{{ … }}`.
//
// HERMETIC. No network, no n8n key. The four live nodes are held below as
// verbatim snapshots captured from `GET /api/v1/workflows/WORKFLOW_UC09_ID` on
// 2026-08-31 (`versionId === activeVersionId ===
// 5d35be9a-aaf8-4e4f-8185-3f3e31fa3273`, 18 nodes, `active: true`) and used as
// NEGATIVE CONTROLS — a detector that has never been shown failing is a
// detector nobody has tested, and this repo has twice closed a finding on a
// confident zero from a half-broken detector.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  DUAL_NODE_NAME,
  TRIPLE_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  UC09_WORKFLOW_ID,
  DUAL_PARAMETERS,
  TRIPLE_PARAMETERS,
  ESCALATE_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  RECORD_ID_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  INTERNAL_NOTE_EXPRESSION_WITH_RECORD,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  DUAL_TAG,
  TRIPLE_TAG,
  ESCALATED_TAG,
  EXCEPTION_TAG,
  TERMINAL_STATUS,
  FORBIDDEN_PHRASES,
  ESCALATE_REASON_ACCURACY,
  THIRD_SIGNATURE_ACCURACY,
  terminalZendeskNodeIssues,
  flagAwaitingDualApprovalIssues,
  flagAwaitingTripleApprovalIssues,
  escalateAdjustmentTicketIssues,
  unrecognisedAdjustmentDecisionIssues,
} from "../workflows/nodes-uc09/terminalZendeskNodesSpec.js";
import { GATE_SEQUENCE as REAL_GATE_SEQUENCE } from "../src/uc09/policyEngine.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc09", "adjustmentGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const LIVE_DUAL_BEFORE_FIX = {
  name: DUAL_NODE_NAME,
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Adjustment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI drafted off-cycle adjustment {{ $('Create Adjustment Record').item.json.id }} -- awaiting dual approval (requester + approver). {{ $('Adjustment Gates').item.json.summary }} Flags: {{ $('Adjustment Gates').item.json.flags.join(\", \") || \"none\" }}. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: ["uc09_awaiting_dual_approval", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_TRIPLE_BEFORE_FIX = {
  name: TRIPLE_NODE_NAME,
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Adjustment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI drafted off-cycle adjustment {{ $('Create Adjustment Record').item.json.id }} -- HIGH RISK, awaiting TRIPLE approval (requester + approver + payment_releaser). {{ $('Adjustment Gates').item.json.summary }} Flags: {{ $('Adjustment Gates').item.json.flags.join(\", \") || \"none\" }}. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: ["uc09_awaiting_triple_approval", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_ESCALATE_BEFORE_FIX = {
  name: ESCALATE_NODE_NAME,
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Adjustment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI summary -- ESCALATED: {{ $('Adjustment Gates').item.json.reason }}. Flags: {{ $('Adjustment Gates').item.json.flags.join(\", \") || \"none\" }}. Adjustment record {{ $('Create Adjustment Record').item.json.id }} created for reference; this request needs manual payroll handling, no approval path was offered. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      // The queue tag is ALREADY on the live node (rca-iih7 / D-14 landed
      // before this pass). It is reproduced so this control differs from the
      // target in the PROSE only, which is what this spec owns.
      tags: [
        "uc09_escalated",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_UNRECOGNISED_BEFORE_FIX = {
  name: UNRECOGNISED_NODE_NAME,
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Adjustment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=Automation produced an unrecognised decision ({{ $('Adjustment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc09_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_AS_CAPTURED = [
  LIVE_DUAL_BEFORE_FIX,
  LIVE_TRIPLE_BEFORE_FIX,
  LIVE_ESCALATE_BEFORE_FIX,
  LIVE_UNRECOGNISED_BEFORE_FIX,
];

/** The four nodes as they must look after the deploy. */
const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

// ---------------------------------------------------------------------------
// Running the real gates body — the only way to see the TEXT rather than the
// interpolation. Same sandbox shape as test/n8nUc09Parity.test.js.
// ---------------------------------------------------------------------------

function runGates(ticket, employment, employmentItem = undefined) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Adjustment Request") return { first: () => ({ json: ticket }) };
      if (nodeName === "Fetch Employment (Remote)") {
        return { first: () => ({ json: employmentItem === undefined ? { data: { employment } } : employmentItem }) };
      }
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const activeEmployment = (over = {}) => ({
  id: "emp_test_1",
  status: "active",
  company_id: "co_test",
  country_code: "US",
  ...over,
});

const ticketFor = (adjustmentRequest, over = {}) => ({
  employmentId: "emp_test_1",
  session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
  adjustmentRequest,
  requestText: "",
  reasonText: "",
  externalRef: "ext_1",
  source: "webhook",
  now: "2026-08-03T00:00:00.000Z",
  ...over,
});

const GOOD_ADJUSTMENT = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };

/**
 * One reachable input per escalate reason. Every one of the eight in
 * ESCALATE_REASON_ACCURACY is produced by driving the REAL gates body — never
 * by hand-constructing a reason string, which would prove only that the
 * composer handles inputs nothing can generate.
 */
const ESCALATE_INPUTS = {
  upstream_record_not_found: () =>
    runGates(ticketFor(GOOD_ADJUSTMENT), null, { error: { status: 404, message: "not found" } }),
  upstream_unavailable: () =>
    runGates(ticketFor(GOOD_ADJUSTMENT), null, { error: { status: 503, message: "upstream down" } }),
  identity_not_verified: () => runGates(ticketFor(GOOD_ADJUSTMENT, { session: null }), activeEmployment()),
  employment_not_active: () => runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment({ status: "terminated" })),
  invalid_adjustment_structure: () =>
    runGates(ticketFor({ type: "bonus", amount: 500000, currency: "USD" }), activeEmployment()),
  // A FRACTIONAL amount is the reachable route to schema_invalid, and finding
  // it is worth one comment. validateAdjustment() accepts it (a number, > 0),
  // prepareIncentivePayload() then refuses it (`Number.isInteger`) and returns
  // NULL, so every required field is missing and gate 4 decides. The money
  // guard fires afterwards and does NOT relabel it, because
  // `amountIsFirstFailure` is false for an escalate whose reason is not
  // `invalid_adjustment_structure` — first failure wins. Anything that reaches
  // this composer must be reachable by driving the real gates; a hand-built
  // reason string would prove only that the composer handles inputs nothing can
  // generate.
  schema_invalid: () => runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 500000.5 }), activeEmployment()),
  unparseable_amount: () => runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: "500000" }), activeEmployment()),
  amount_not_extracted: () =>
    runGates(ticketFor(GOOD_ADJUSTMENT, { requestText: "please pay the relocation top-up of $12,500.00" }), activeEmployment()),
};

// ---------------------------------------------------------------------------
// 1. The targets pass
// ---------------------------------------------------------------------------

test("all four target parameter blocks pass their own checker", () => {
  assert.deepEqual(flagAwaitingDualApprovalIssues(targetNode(DUAL_NODE_NAME)), []);
  assert.deepEqual(flagAwaitingTripleApprovalIssues(targetNode(TRIPLE_NODE_NAME)), []);
  assert.deepEqual(escalateAdjustmentTicketIssues(targetNode(ESCALATE_NODE_NAME)), []);
  assert.deepEqual(unrecognisedAdjustmentDecisionIssues(targetNode(UNRECOGNISED_NODE_NAME)), []);
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

test("all four interpolate the same composed note — the difference is composed upstream", () => {
  for (const params of [DUAL_PARAMETERS, TRIPLE_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.ok(params.updateFields.internalNote.includes(INTERNAL_NOTE_INTERPOLATION));
    assert.ok(params.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION));
    // Addressed BY NODE NAME, never off `$json` — at these nodes `$json` is
    // whatever `Assign Routing` emitted, which spreads a Supabase insert
    // response and carries none of the gates' fields. The wrong form yields an
    // EMPTY note on a green execution.
    assert.ok(params.updateFields.internalNote.includes("$('Adjustment Gates')"));
    assert.ok(!/\{\{\s*\$json\.internalNote/.test(params.updateFields.internalNote));
  }
  assert.equal(DUAL_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION_WITH_RECORD);
  assert.equal(TRIPLE_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION_WITH_RECORD);
  assert.equal(ESCALATE_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION_WITH_RECORD);
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
});

test("the three nodes that carried the adjustment record id still carry it", () => {
  for (const params of [DUAL_PARAMETERS, TRIPLE_PARAMETERS, ESCALATE_PARAMETERS]) {
    assert.ok(params.updateFields.internalNote.includes(RECORD_ID_INTERPOLATION));
  }
  // The unrecognised node never carried it and this pass does not add it — a
  // scope decision recorded in the spec, not a claim that it would be wrong.
  assert.ok(!UNRECOGNISED_PARAMETERS.updateFields.internalNote.includes(RECORD_ID_INTERPOLATION));
});

test("the unchanged fields really are unchanged", () => {
  for (const params of [DUAL_PARAMETERS, TRIPLE_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.equal(params.authentication, "oAuth2");
    assert.equal(params.operation, "update");
    assert.equal(params.id, TICKET_ID_EXPRESSION);
    assert.equal(params.updateFields.group, ZENDESK_GROUP_EXPRESSION);
    assert.equal(params.updateFields.status, TERMINAL_STATUS);
    assert.equal(params.updateFields.status, "open");
    assert.ok(params.updateFields.tags.includes(ROUTING_TAG_EXPRESSION));
  }
  assert.ok(DUAL_PARAMETERS.updateFields.tags.includes(DUAL_TAG));
  assert.ok(TRIPLE_PARAMETERS.updateFields.tags.includes(TRIPLE_TAG));
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(ESCALATED_TAG));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(EXCEPTION_TAG));
});

test("the checker does NOT assert the queue tag — that dimension is another spec's", () => {
  // Two checkers asserting one field is how a fix in one lands as a failure in
  // the other. Proven by removing the queue tag from the escalate target and
  // confirming THIS checker stays silent about it.
  const stripped = targetNode(ESCALATE_NODE_NAME);
  stripped.parameters.updateFields.tags = stripped.parameters.updateFields.tags.filter(
    (t) => t !== QUEUE_TAG_EXPRESSION
  );
  assert.deepEqual(escalateAdjustmentTicketIssues(stripped), []);
  for (const spec of Object.values(TERMINAL_NODE_SPECS)) {
    assert.ok(!spec.assertedTags.includes(QUEUE_TAG_EXPRESSION), `${spec.name} must not assert the queue tag`);
  }
});

// ---------------------------------------------------------------------------
// 2. NEGATIVE CONTROLS — the live nodes must be REJECTED, by name
// ---------------------------------------------------------------------------

test("NEGATIVE CONTROL: the dual-approval node as deployed today is rejected", () => {
  const issues = flagAwaitingDualApprovalIssues(LIVE_DUAL_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the hand-typed inline note must be flagged"
  );
  assert.ok(issues.some((i) => i.includes("ai drafted")), '"AI drafted" must be flagged — this graph has no LLM node');
  assert.ok(
    issues.some((i) => i.includes("awaiting dual approval (requester + approver)")),
    "the two-ROLES claim must be flagged — DRIFT-050 is about two PEOPLE"
  );
  // Status, group, id and tags on this node were already right — the checker
  // must not manufacture failures on fields the deploy does not touch.
  assert.ok(!issues.some((i) => i.includes("updateFields.status")));
  assert.ok(!issues.some((i) => i.includes("updateFields.group")));
  assert.ok(!issues.some((i) => i.includes("updateFields.tags")));
  assert.ok(!issues.some((i) => i.includes("parameters.id")));
});

test("NEGATIVE CONTROL: the triple-approval node as deployed today is rejected", () => {
  const issues = flagAwaitingTripleApprovalIssues(LIVE_TRIPLE_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(
    issues.some((i) => i.includes("high risk")),
    "the unconditional HIGH RISK headline must be flagged BY NAME — two of the four triggers are not risk findings"
  );
  assert.ok(issues.some((i) => i.includes("ai drafted")));
});

test("NEGATIVE CONTROL: the escalate node as deployed today is rejected, and the severe phrase is named", () => {
  const issues = escalateAdjustmentTicketIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(
    issues.some((i) => i.includes("needs manual payroll handling")),
    "the phrase that invited a manual payment on an unverified request must be flagged BY NAME"
  );
  assert.ok(issues.some((i) => i.includes("ai summary")));
  // The queue tag is on this live node already; the checker must not claim
  // credit for it or complain about it.
  assert.ok(!issues.some((i) => i.includes("queueTag")));
});

test("NEGATIVE CONTROL: the unrecognised node as deployed today is rejected", () => {
  const issues = unrecognisedAdjustmentDecisionIssues(LIVE_UNRECOGNISED_BEFORE_FIX);
  // This one's sentence is not FALSE — it is unversioned and inert. The single
  // failure is the missing interpolation, and that is the honest count: a
  // detector that manufactured extra failures here would be overstating.
  assert.equal(issues.length, 1, JSON.stringify(issues));
  assert.ok(issues[0].includes(INTERNAL_NOTE_INTERPOLATION));
});

test("NEGATIVE CONTROL: every live node is rejected by the parameterised checker too", () => {
  for (const live of LIVE_AS_CAPTURED) {
    assert.ok(terminalZendeskNodeIssues(live).length > 0, `${live.name} must not pass as captured`);
  }
});

// ---------------------------------------------------------------------------
// 3. Per-regression mutations of the TARGET — each detector shown failing
// ---------------------------------------------------------------------------

const mutate = (name, fn) => {
  const node = targetNode(name);
  fn(node);
  return terminalZendeskNodeIssues(node, name);
};

test("REGRESSION: replacing the interpolation with an inline sentence fails", () => {
  const issues = mutate(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote =
      "=ESCALATED: {{ $('Adjustment Gates').item.json.reason }}. {{ $('Assign Routing').item.json.routingNote }}";
  });
  assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
});

test("REGRESSION: reading the note off $json instead of the gates node fails", () => {
  // The silent one. `$json` at these nodes is Assign Routing's output, which
  // carries no gates fields, so this renders an EMPTY note on a green run.
  const issues = mutate(DUAL_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = n.parameters.updateFields.internalNote.replace(
      INTERNAL_NOTE_INTERPOLATION,
      "{{ $json.internalNote }}"
    );
  });
  assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
});

test("REGRESSION: dropping the routing sentence fails", () => {
  const issues = mutate(TRIPLE_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION;
  });
  assert.ok(issues.some((i) => i.includes(ROUTING_NOTE_INTERPOLATION)));
});

test("REGRESSION: dropping the adjustment record id fails on the three nodes that carry it", () => {
  for (const name of [DUAL_NODE_NAME, TRIPLE_NODE_NAME, ESCALATE_NODE_NAME]) {
    const issues = mutate(name, (n) => {
      n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION;
    });
    assert.ok(issues.some((i) => i.includes(RECORD_ID_INTERPOLATION)), name);
  }
  // And does NOT fire on the node that never carried it — a check that demands
  // a field the spec does not want is a check that turns verify-deployed red on
  // a correct node.
  assert.deepEqual(unrecognisedAdjustmentDecisionIssues(targetNode(UNRECOGNISED_NODE_NAME)), []);
});

test("REGRESSION: a forbidden phrase reintroduced anywhere in updateFields fails", () => {
  for (const phrase of FORBIDDEN_PHRASES) {
    // Hidden inside a DIFFERENT field, which is the 2026-08-29 migration's own
    // lesson: a field-by-field walk misses the copy inside a string inside
    // another field.
    const issues = mutate(ESCALATE_NODE_NAME, (n) => {
      n.parameters.updateFields.tags = [...n.parameters.updateFields.tags, `note:${phrase}`];
    });
    assert.ok(issues.some((i) => i.includes(phrase)), `"${phrase}" was not detected`);
  }
});

test("REGRESSION: the marker tag, the routing tag, the group, the status and the ticket id each fail on their own", () => {
  assert.ok(
    mutate(DUAL_NODE_NAME, (n) => {
      n.parameters.updateFields.tags = [ROUTING_TAG_EXPRESSION];
    }).some((i) => i.includes(DUAL_TAG))
  );
  assert.ok(
    mutate(TRIPLE_NODE_NAME, (n) => {
      n.parameters.updateFields.tags = [TRIPLE_TAG];
    }).some((i) => i.includes(ROUTING_TAG_EXPRESSION))
  );
  assert.ok(
    mutate(ESCALATE_NODE_NAME, (n) => {
      delete n.parameters.updateFields.group;
    }).some((i) => i.includes("updateFields.group"))
  );
  assert.ok(
    mutate(UNRECOGNISED_NODE_NAME, (n) => {
      n.parameters.updateFields.status = "pending";
    }).some((i) => i.includes("updateFields.status"))
  );
  assert.ok(
    mutate(DUAL_NODE_NAME, (n) => {
      n.parameters.id = "={{ $json.externalRef }}";
    }).some((i) => i.includes("parameters.id"))
  );
});

// ---------------------------------------------------------------------------
// 4. THE COMPOSED TEXT — the check the node-parameter checker structurally
//    cannot make
// ---------------------------------------------------------------------------

test("the gates body composes a note for EVERY decision, so all four nodes can read one", () => {
  const runs = [
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment()),
    runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment()),
    runGates(ticketFor(GOOD_ADJUSTMENT, { session: null }), activeEmployment()),
  ];
  for (const r of runs) {
    assert.equal(typeof r.internalNote, "string");
    assert.ok(r.internalNote.length > 200, `note too short to be useful: ${r.internalNote}`);
  }
});

test('THE HEADLINE FIX: "manual payroll handling" appears for NO reason at all, including the one it was true of', () => {
  // It is not that the phrase is right for `employment_not_active` and wrong
  // for the rest — it is that the retired sentence was an INSTRUCTION on a
  // ticket. The accurate remedy for that one reason is stated in the ladder's
  // own reviewed words ("handled by Payroll directly"), which the next test
  // asserts. This one asserts the invitation is gone everywhere.
  assert.equal(Object.keys(ESCALATE_INPUTS).length, ESCALATE_REASON_ACCURACY.length);
  for (const [reason, build] of Object.entries(ESCALATE_INPUTS)) {
    const run = build();
    assert.equal(run.decision, "escalate", `${reason}: expected an escalate run`);
    assert.equal(run.reason, reason, `${reason}: the input no longer produces this reason`);
    assert.ok(
      !/manual payroll handling/i.test(run.internalNote),
      `${reason}: the note still invites manual payroll handling`
    );
    assert.ok(
      !/no approval path was offered/i.test(run.internalNote),
      `${reason}: "offered" implies a choice was made available; none was opened`
    );
  }
});

test("employment_not_active DOES get the reviewed sentence about Payroll handling it directly", () => {
  const run = ESCALATE_INPUTS.employment_not_active();
  assert.equal(run.reason, "employment_not_active");
  assert.match(
    run.internalNote,
    /A payment owed to someone who has left is a different process, handled by Payroll directly\./,
    "the one reason where the retired sentence was accurate must still say so, in the ladder's own words"
  );
});

test("identity_not_verified says money never starts moving, and never the opposite", () => {
  // The reason that HAS fired in production — executions 9279 (ticket 135) and
  // 9942 (ticket 5). This is the assertion the whole pass exists for.
  const run = ESCALATE_INPUTS.identity_not_verified();
  assert.equal(run.reason, "identity_not_verified");
  assert.match(run.internalNote, /Money never starts moving on a request whose origin is unverified\./);
  assert.match(run.internalNote, /no approval path was ever opened/);
  assert.match(run.internalNote, /Signatures required before any payment: 0\./);
  assert.ok(!/handled by Payroll directly/i.test(run.internalNote));
  assert.ok(!/manual/i.test(run.internalNote));
});

test("the four escalate reasons with no ladder rung say so instead of inventing a meaning", () => {
  const noRung = ESCALATE_REASON_ACCURACY.filter((r) => !r.hasLadderRung).map((r) => r.reason);
  assert.equal(noRung.length, 4);
  for (const reason of noRung) {
    const build = ESCALATE_INPUTS[reason];
    assert.ok(build, `no reachable input recorded for ${reason}`);
    const run = build();
    assert.equal(run.reason, reason);
    assert.match(
      run.internalNote,
      new RegExp(`No row in this use case's gate sequence describes the reason "${reason}"`),
      `${reason}: expected the reviewed "no rung" sentence, not an invented meaning`
    );
    // And it must still say the load-bearing thing about what did not happen.
    assert.match(run.internalNote, /There is no route from here to a payment/);
  }
});

test("the four reasons WITH a rung print that rung's own words, not a paraphrase", () => {
  const withRung = ESCALATE_REASON_ACCURACY.filter((r) => r.hasLadderRung);
  assert.equal(withRung.length, 4);
  for (const row of withRung) {
    const build = ESCALATE_INPUTS[row.reason];
    assert.ok(build, `no reachable input recorded for ${row.reason}`);
    const run = build();
    const real = REAL_GATE_SEQUENCE.find((g) => g.reason === row.reason);
    assert.ok(real, `${row.reason} is missing from src/uc09/policyEngine.js's GATE_SEQUENCE`);
    assert.ok(
      run.internalNote.includes(real.means),
      `${row.reason}: the note's sentence has drifted from src/uc09/policyEngine.js's own \`means\``
    );
  }
});

test("the ported GATE_SEQUENCE means are byte-identical to src/uc09/policyEngine.js's", () => {
  // The port is only worth having if it cannot drift. Position 5 is the ONE
  // deliberate exception: the real `means` continues into a paragraph reciting
  // all three third-signature triggers on every case, which is the
  // unconditional-assertion defect in longer form. The note names the trigger
  // that actually fired instead — so the ported text must be a PREFIX of the
  // real one, never a rewording of it.
  for (const real of REAL_GATE_SEQUENCE) {
    if (real.reason === "high_risk_adjustment_needs_triple_approval") {
      assert.ok(
        real.means.startsWith(
          "The adjustment is sound but carries a high-risk factor, so it needs THREE separate people before it can be paid: the requester, an approver, and a payment releaser. This is not a refusal — it is the request being routed to a larger signature set. Nothing has been paid."
        ),
        "the truncated port must remain a verbatim PREFIX of the real means"
      );
      continue;
    }
    assert.ok(gatesSource.includes(real.means), `${real.reason}: means has drifted between src/ and the n8n port`);
  }
});

// ---------------------------------------------------------------------------
// 5. THE THIRD SIGNATURE — named, and never called a risk finding when it is not
// ---------------------------------------------------------------------------

test("a JPY adjustment is NOT called high risk — it is called unmeasured", () => {
  // HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY holds one row (USD), so every non-USD
  // adjustment lands on `high_amount_threshold_not_comparable`. Under the old
  // note a JPY 500 bonus rendered as "HIGH RISK".
  const run = runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 50000, currency: "JPY" }), activeEmployment());
  assert.equal(run.decision, "triple_approval_required");
  assert.ok(run.flags.includes("high_amount_threshold_not_comparable"));
  assert.match(run.internalNote, /NO RISK FINDING WAS MADE\./);
  assert.match(run.internalNote, /THIS IS NOT A RISK FINDING/);
  assert.match(run.internalNote, /it is unmeasured, and an unmeasured amount costs a third signature/);
  // The floor is unchanged — the note says what was found, not what is required.
  assert.equal(run.approvalSlotsRequired, 3);
  assert.match(run.internalNote, /Signatures required before any payment: 3\./);
});

test("a DE/FR/IT adjustment names the unsourced heuristic as unsourced", () => {
  const run = runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment({ country_code: "DE" }));
  assert.equal(run.decision, "triple_approval_required");
  assert.match(run.internalNote, /NO RISK FINDING WAS MADE\./);
  assert.match(run.internalNote, /UNSOURCED heuristic with no publishing authority behind it/);
  assert.match(run.internalNote, /an illustration rather than as a compliance determination/);
});

test("the two genuine triggers ARE reported as findings", () => {
  const overLine = runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment());
  assert.ok(overLine.flags.includes("high_amount_risk"));
  assert.match(overLine.internalNote, /A high-value or manual-tax factor was found on this adjustment:/);
  assert.ok(!/NO RISK FINDING WAS MADE/.test(overLine.internalNote));

  const taxed = runGates(ticketFor({ ...GOOD_ADJUSTMENT, taxAdjustment: true }), activeEmployment());
  assert.ok(taxed.flags.includes("manual_tax_adjustment"));
  assert.match(taxed.internalNote, /A high-value or manual-tax factor was found on this adjustment:/);
});

test("a finding alongside an absence is reported as a finding, not softened", () => {
  // A genuine trigger must not be diluted by a co-occurring unmeasured one.
  const run = runGates(
    ticketFor({ ...GOOD_ADJUSTMENT, currency: "JPY", taxAdjustment: true }),
    activeEmployment({ country_code: "FR" })
  );
  assert.equal(run.decision, "triple_approval_required");
  assert.match(run.internalNote, /A high-value or manual-tax factor was found on this adjustment:/);
  assert.ok(!/NO RISK FINDING WAS MADE/.test(run.internalNote));
  // …and both absences are still NAMED, each with its own health warning.
  assert.match(run.internalNote, /high_amount_threshold_not_comparable/);
  assert.match(run.internalNote, /high_tax_compliance_risk/);
  assert.match(run.internalNote, /manual_tax_adjustment/);
});

test("THIRD_SIGNATURE_ACCURACY matches what assessRisk() can actually flag", () => {
  // The table is evidence for a prose change and must stay in step with the
  // code it describes; a stale row here is a confident claim about a trigger
  // that no longer exists.
  assert.equal(THIRD_SIGNATURE_ACCURACY.length, 4);
  assert.equal(THIRD_SIGNATURE_ACCURACY.filter((r) => r.assessed).length, 2);
  for (const row of THIRD_SIGNATURE_ACCURACY) {
    assert.ok(gatesSource.includes(`'${row.flag}'`), `${row.flag} is not raised anywhere in the gates body`);
    assert.ok(row.why && row.why.length > 20, `${row.flag} has no stated why`);
  }
});

// ---------------------------------------------------------------------------
// 6. THE TWO APPROVAL NOTES — segregation of duties, and where the signature is
// ---------------------------------------------------------------------------

test("both approval notes state segregation of duties as PEOPLE, not roles", () => {
  for (const run of [
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment()),
    runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment()),
  ]) {
    assert.match(run.internalNote, /distinct PEOPLE, not just distinct roles/);
    assert.match(run.internalNote, /may sign the requester slot and NO OTHER/);
    assert.match(run.internalNote, /requester_cannot_approve_own_adjustment/);
    assert.match(run.internalNote, /same_person_cannot_fill_multiple_roles/);
  }
});

test("both approval notes say WHERE the signature is taken, and that the requester cannot reach it", () => {
  for (const run of [
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment()),
    runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment()),
  ]) {
    assert.match(run.internalNote, /UC-09 panel of the Remote CX Review sidebar on this ticket/);
    // `deny`, not `decline` — approvalRoutes.js's own warning.
    assert.match(run.internalNote, /approve \/ deny — deny, never decline/);
    assert.match(run.internalNote, /NO SURFACE ON WHICH TO SIGN/);
  }
});

test("the floor of two is stated as a floor, on both approval notes", () => {
  const dual = runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment());
  assert.equal(dual.approvalSlotsRequired, 2);
  assert.match(dual.internalNote, /2 separate people must sign before any money moves/);
  assert.match(dual.internalNote, /no risk score can take it below two/);

  const triple = runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment());
  assert.equal(triple.approvalSlotsRequired, 3);
  assert.match(triple.internalNote, /3 separate people must sign before any money moves/);
});

// ---------------------------------------------------------------------------
// 7. "AI" — the word this graph has no node to justify
// ---------------------------------------------------------------------------

test("no composed note claims anything was drafted by a model, and each says why not", () => {
  const runs = [
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment()),
    runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment()),
    runGates(ticketFor(GOOD_ADJUSTMENT, { session: null }), activeEmployment()),
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment({ status: "terminated" })),
  ];
  for (const run of runs) {
    assert.ok(!/\bAI\b/.test(run.internalNote), `the note still says "AI": ${run.internalNote.slice(0, 120)}`);
    assert.match(run.internalNote, /runs no language model at any step/);
  }
});

// ---------------------------------------------------------------------------
// 8. The money glyph, and what was deliberately left alone
// ---------------------------------------------------------------------------

test("no currency glyph is printed beside a currency code", () => {
  const jpy = runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 50000, currency: "JPY" }), activeEmployment());
  assert.ok(!jpy.summary.includes("$"), `a dollar sign beside a JPY code: ${jpy.summary}`);
  assert.match(jpy.summary, /500\.00 JPY/);
  assert.ok(!jpy.internalNote.includes("$"), "the composed note must not reintroduce the glyph either");

  const usd = runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment());
  assert.match(usd.summary, /5000\.00 USD/);
});

test("the gates body says, at the site, what it did NOT fix about money and why", () => {
  // A stated non-fix that nobody can find is a non-fix nobody knows about. This
  // asserts the reasoning stays next to the line it is about.
  assert.match(gatesSource, /zero-minor-unit currency/i);
  assert.match(gatesSource, /prime directive 4/);
  assert.match(gatesSource, /gross\/net/i);
});

// ---------------------------------------------------------------------------
// 9. The accuracy table is evidence, so it has to be true
// ---------------------------------------------------------------------------

test("ESCALATE_REASON_ACCURACY covers exactly the eight reachable escalate reasons, 1 of them accurate", () => {
  assert.equal(ESCALATE_REASON_ACCURACY.length, 8);
  assert.equal(ESCALATE_REASON_ACCURACY.filter((r) => r.accurate).length, 1);
  assert.equal(ESCALATE_REASON_ACCURACY.find((r) => r.accurate).reason, "employment_not_active");
  for (const row of ESCALATE_REASON_ACCURACY) {
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
    assert.ok(row.source, `${row.reason} does not say where it comes from`);
    // Every reason must be a string the gates body can actually produce.
    assert.ok(gatesSource.includes(`'${row.reason}'`), `${row.reason} is not produced anywhere in the gates body`);
    // And the rung claim must match src/uc09/policyEngine.js, not this file's memory.
    const hasRung = REAL_GATE_SEQUENCE.some((g) => g.reason === row.reason);
    assert.equal(row.hasLadderRung, hasRung, `${row.reason}: hasLadderRung disagrees with GATE_SEQUENCE`);
  }
});

// ---------------------------------------------------------------------------
// 10. Ticket hygiene — this text goes on a real customer's ticket
// ---------------------------------------------------------------------------

test("neither the target expressions nor the composed notes carry harness vocabulary", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    for (const tag of uf.tags) {
      assert.equal(findHarnessVocabulary(tag), null, `${name}: harness vocabulary in tag ${tag}`);
    }
  }
  for (const build of Object.values(ESCALATE_INPUTS)) {
    const { internalNote } = build();
    assert.equal(findHarnessVocabulary(internalNote), null, `harness vocabulary in a composed note: ${internalNote}`);
  }
  for (const run of [
    runGates(ticketFor(GOOD_ADJUSTMENT), activeEmployment()),
    runGates(ticketFor({ ...GOOD_ADJUSTMENT, amount: 1500000 }), activeEmployment()),
  ]) {
    assert.equal(findHarnessVocabulary(run.internalNote), null);
  }
});

// ---------------------------------------------------------------------------
// 11. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(__dirname, "..", "workflows", "nodes-uc09", "DEPLOY-2026-08-31.md"), "utf8");
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(md.includes(name), `the deploy note does not mention ${name}`);
  }
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(RECORD_ID_INTERPOLATION));
  assert.ok(md.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  assert.ok(md.includes(UC09_WORKFLOW_ID));
  for (const tag of [DUAL_TAG, TRIPLE_TAG, ESCALATED_TAG, EXCEPTION_TAG]) {
    assert.ok(md.includes(tag), `the deploy note does not mention ${tag}`);
  }

  // The JSON blocks in the deploy note must BE the spec, not a retyping of it.
  // A paste-ready block that has drifted from the checker is worse than none:
  // an operator follows it and `verify-deployed` then reports the drift they
  // were told to create.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 4, "expected one paste-ready JSON block per node");
  const wanted = TERMINAL_NODE_NAMES.map((n) =>
    JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields))
  );
  assert.deepEqual(blocks, wanted);
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe UC-09's escalate and unrecognised
// nodes, and neither may silently revert the other
// ---------------------------------------------------------------------------
// `Escalate Adjustment Ticket` and `Unrecognised Adjustment Decision` are
// covered by TWO spec files, on purpose and along different dimensions:
//
//   this file                                  — the PROSE (internalNote) and
//                                                the per-decision marker tag
//   workflows/nodes/escalationQueueTagSpec.js  — the QUEUE TAG, across all
//                                                fourteen nodes on all eight
//                                                graphs that share the defect
//
// Splitting them is right: the queue-tag finding (rca-iih7 / D-14) is an
// eight-graph problem and does not belong inside a UC-09 file, while the
// wrong-remedy prose is UC-09's alone. The hazard is that BOTH files carry a
// full `targetParameters` block for these two nodes, because either can be used
// to deploy them — so a publish from the stale one reverts the other's fix.
//
// Held equal by assertion rather than by one file importing the other. An
// import would remove the duplication but also the failure message: a dropped
// field would simply propagate, silently and consistently. This way a
// divergence names itself and says which field.
const { ESCALATION_QUEUE_TAG_NODES } = await import("../workflows/nodes/escalationQueueTagSpec.js");

for (const [nodeName, params] of [
  [ESCALATE_NODE_NAME, ESCALATE_PARAMETERS],
  [UNRECOGNISED_NODE_NAME, UNRECOGNISED_PARAMETERS],
]) {
  test(`cross-spec: "${nodeName}" is described identically in both specs`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find(
      (e) => e.workflowId === UC09_WORKFLOW_ID && e.node === nodeName
    );
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetParameters.updateFields)),
      JSON.parse(JSON.stringify(params.updateFields)),
      `the two specs disagree about "${nodeName}". Deploying from either would revert the other; fix both, in one change.`
    );
  });
}

test("cross-spec: the queue tag is on escalate and unrecognised, and NOT on the two approval nodes", () => {
  // The asymmetry is measured, not assumed. assignRouting.js's isEscalation()
  // matches /^escalat/i and returns true for a missing/empty/non-string
  // decision — which is what reaches the fallback output — and false for
  // 'dual_approval_required' / 'triple_approval_required'. So the unrecognised
  // node needs the tag and the two approval nodes do not: on their branch
  // routingTag ALREADY resolves to the queue tag.
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  for (const params of [DUAL_PARAMETERS, TRIPLE_PARAMETERS]) {
    assert.ok(
      !params.updateFields.tags.includes(QUEUE_TAG_EXPRESSION),
      "an approval decision leaves escalated false, so routingTag already IS the queue tag"
    );
  }
});
