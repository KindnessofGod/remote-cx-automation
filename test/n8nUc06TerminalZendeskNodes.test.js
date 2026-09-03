// ---------------------------------------------------------------------------
// n8nUc06TerminalZendeskNodes.test.js — UC-06's three terminal Zendesk nodes
// must interpolate the composed note, and the escalate note must stop telling
// Payroll Ops that a Remote outage is their manual work
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `workflows/nodes-uc06/amendmentGates.js`'s `composeInternalNote()` emits a
// decision-aware note for EVERY branch. Until 2026-08-31 none of the three
// terminal Zendesk nodes consumed it: each carried a sentence typed into a node
// parameter, which no check in this repository can see. A Zendesk node has no
// `jsCode`, so `verify-deployed`'s body diff is structurally blind to it, and
// `test/n8nUc06Parity.test.js` cannot cover it either, by its own design — it
// compares DECISIONS, and a node that reaches the right verdict and describes
// it in false words passes every time.
//
// THE TEST THIS FILE EXISTS FOR is the twelve-reason sweep near the bottom: for
// every escalate reason the gates can produce, the note must never tell Payroll
// Ops to handle an upstream outage or an identity failure by hand. UC-06's
// routing row has no `escalationGroup`, so the escalation lands in Payroll Ops'
// own queue — the sentence and the destination compounded each other.
//
// HERMETIC. No network, no n8n key. The three live nodes are held here as
// verbatim snapshots captured from `GET /api/v1/workflows/WORKFLOW_UC06_ID` on
// 2026-08-31 (`versionId === activeVersionId ===
// 4f597d35-bacf-41b3-88ea-7713a6b17522`) and used as NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  APPROVAL_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  APPROVAL_PARAMETERS,
  ESCALATE_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  RECORD_ID_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  APPROVAL_TAG,
  ESCALATED_TAG,
  EXCEPTION_TAG,
  APPROVAL_STATUS,
  ESCALATE_STATUS,
  UNRECOGNISED_STATUS,
  FORBIDDEN_PHRASES,
  ESCALATION_REASON_ACCURACY,
  UC06_WORKFLOW_ID,
  terminalZendeskNodeIssues,
  approvalNodeIssues,
  escalateNodeIssues,
  unrecognisedNodeIssues,
} from "../workflows/nodes-uc06/terminalZendeskNodesSpec.js";
import { GATE_SEQUENCE as SRC_GATE_SEQUENCE } from "../src/uc06/policyEngine.js";
import { REFUSALS } from "../src/uc06/dualApprovalPolicy.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc06", "amendmentGates.js");
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc06");
const gatesSource = readFileSync(GATES_PATH, "utf8");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const LIVE_APPROVAL_BEFORE_FIX = {
  name: APPROVAL_NODE_NAME,
  type: TERMINAL_NODE_TYPE,
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Amendment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI drafted amendment {{ $('Create Amendment Record').item.json.id }} — awaiting dual approval (Customer Admin + Payroll Specialist). {{ $('Amendment Gates').item.json.summary }} Flags: {{ $('Amendment Gates').item.json.flags.join(\", \") || \"none\" }}. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: ["uc06_awaiting_approval", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_ESCALATE_BEFORE_FIX = {
  name: ESCALATE_NODE_NAME,
  type: TERMINAL_NODE_TYPE,
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Amendment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI summary — ESCALATED: {{ $('Amendment Gates').item.json.reason }}. Flags: {{ $('Amendment Gates').item.json.flags.join(\", \") || \"none\" }}. Amendment record {{ $('Create Amendment Record').item.json.id }} created for reference; this request needs manual payroll/HR handling and will not go through dual approval. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc06_escalated",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_UNRECOGNISED_BEFORE_FIX = {
  name: UNRECOGNISED_NODE_NAME,
  type: TERMINAL_NODE_TYPE,
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Amendment Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=Automation produced an unrecognised decision ({{ $('Amendment Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc06_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_BEFORE_FIX = {
  [APPROVAL_NODE_NAME]: LIVE_APPROVAL_BEFORE_FIX,
  [ESCALATE_NODE_NAME]: LIVE_ESCALATE_BEFORE_FIX,
  [UNRECOGNISED_NODE_NAME]: LIVE_UNRECOGNISED_BEFORE_FIX,
};

const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

function mutated(name, mutate) {
  const node = targetNode(name);
  mutate(node);
  return node;
}

// ---------------------------------------------------------------------------
// Running the real gates body
// ---------------------------------------------------------------------------

function runGates({ request, employmentResponse, countrySchemaResponse, payrollRunsResponse }) {
  const pages = [payrollRunsResponse];
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Amendment Request") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      if (nodeName === "Fetch Country Schema (Remote)") return { first: () => ({ json: countrySchemaResponse }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    $input: { all: () => pages.map((json) => ({ json })), first: () => ({ json: pages[0] }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const employment = (over = {}) => ({
  data: {
    employment: {
      id: "emp_amend_001",
      status: "active",
      company_id: "co_amend_01",
      country_code: "NG",
      full_name: "Ana Silva",
      job_title: "Senior Engineer",
      weekly_hours: 40,
      base_salary: 5000000,
      currency: "USD",
      ...over,
    },
  },
});

const schema = (required = ["job_title", "weekly_hours"]) => ({ data: { required } });

const runs = (rows) => ({
  data: {
    total_count: 2,
    total_pages: 1,
    current_page: 1,
    payroll_runs: rows ?? [
      { id: "run_2026_06", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-10" },
      { id: "run_2026_07", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" },
    ],
  },
});

const request = (changes, over = {}) => ({
  employmentId: "emp_amend_001",
  session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
  changes,
  requestedEffectiveDate: "2026-07-15",
  reasonText: "",
  externalRef: "88",
  source: "webhook",
  now: "2026-06-20",
  ...over,
});

const HOURS = { weeklyHours: { oldValue: 40, newValue: 32 } };

const base = () => ({ employmentResponse: employment(), countrySchemaResponse: schema(), payrollRunsResponse: runs() });

/**
 * ONE FIXTURE PER REACHABLE ESCALATE REASON, plus the approval path.
 *
 * Every entry is DRIVEN through the real gates body and the test asserts the
 * fixture reached the reason it claims — a fixture that silently lands on a
 * different gate would otherwise let a reason go untested while the sweep
 * reported twelve.
 */
const REASON_FIXTURES = {
  identity_not_verified: () => runGates({ ...base(), request: request(HOURS, { session: { companyId: "co_other" } }) }),
  employee_not_active: () => runGates({ ...base(), employmentResponse: employment({ status: "terminated" }), request: request(HOURS) }),
  upstream_record_not_found: () => runGates({ ...base(), employmentResponse: { error: { message: "not found", status: 404 } }, request: request(HOURS) }),
  upstream_unavailable: () => runGates({ ...base(), employmentResponse: { error: { message: "bad gateway", status: 502 } }, request: request(HOURS) }),
  country_schema_unavailable: () => runGates({ ...base(), countrySchemaResponse: {}, request: request(HOURS) }),
  change_value_underivable: () => runGates({ ...base(), request: request({ weeklyHours: { oldValue: 40, newValue: "" } }) }),
  // A CLOSED form — `properties` plus `additionalProperties: false` — is what
  // makes a change unexpressible. `{required: [...]}` alone does NOT: JSON
  // Schema's own default there is permissive, and inventing a constraint from
  // a bare `required` list is the exact move buildAmendmentPayload()'s
  // schemaVocabulary() refuses to make. The first version of this fixture used
  // `schema(["job_title"])` and quietly reached `dual_approval_required`
  // instead — caught by the "every fixture reaches the reason it claims" test
  // above, which is why that test is written before the sweep rather than
  // after it.
  change_not_expressible: () =>
    runGates({
      ...base(),
      countrySchemaResponse: { data: { required: ["job_title"], properties: { job_title: {} }, additionalProperties: false } },
      request: request({ weeklyHours: { oldValue: 40, newValue: 32 } }),
    }),
  schema_invalid: () => runGates({ ...base(), countrySchemaResponse: schema(["job_title", "weekly_hours", "contract_end_date"]), request: request(HOURS) }),
  ambiguous_payroll_cycle: () =>
    runGates({
      ...base(),
      payrollRunsResponse: runs([
        { id: "ng_a", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" },
        { id: "ng_b", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-25" },
      ]),
      request: request(HOURS),
    }),
  no_matching_payroll_cycle: () => runGates({ ...base(), request: request(HOURS, { requestedEffectiveDate: "2026-12-25" }) }),
  cutoff_date_unknown: () =>
    runGates({
      ...base(),
      payrollRunsResponse: runs([
        { id: "ng_bad", country: { code: "NGA", alpha_2_code: "NG" }, period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: null },
      ]),
      request: request(HOURS),
    }),
  cutoff_lock_passed: () => runGates({ ...base(), request: request(HOURS, { requestedEffectiveDate: "2026-06-15" }) }),
};

const approvalRun = () => runGates({ ...base(), request: request(HOURS) });

// ---------------------------------------------------------------------------
// 1. The targets pass their own checkers
// ---------------------------------------------------------------------------

test("every target node passes its own checker", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.deepEqual(terminalZendeskNodeIssues(targetNode(name)), [], `${name} should be clean`);
  }
});

test("the three named wrappers agree with the parameterised checker", () => {
  assert.deepEqual(approvalNodeIssues(targetNode(APPROVAL_NODE_NAME)), []);
  assert.deepEqual(escalateNodeIssues(targetNode(ESCALATE_NODE_NAME)), []);
  assert.deepEqual(unrecognisedNodeIssues(targetNode(UNRECOGNISED_NODE_NAME)), []);
});

test("a node with no spec is refused rather than silently passed", () => {
  const issues = terminalZendeskNodeIssues({ name: "Some Other Zendesk Node", parameters: {} });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /no terminal-node spec/);
});

// ---------------------------------------------------------------------------
// 2. THE NEGATIVE CONTROLS — every live node is rejected, by name
// ---------------------------------------------------------------------------

for (const name of TERMINAL_NODE_NAMES) {
  test(`the live "${name}" (as captured 2026-08-31) is REJECTED`, () => {
    const issues = terminalZendeskNodeIssues(LIVE_BEFORE_FIX[name]);
    assert.ok(issues.length > 0, `${name}: the checker passed the very node this change exists to replace`);
    assert.ok(
      issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
      `${name}: the missing composed-note interpolation was not among the issues: ${JSON.stringify(issues)}`
    );
  });
}

test("the live approval node is rejected for BOTH of its defects", () => {
  const issues = approvalNodeIssues(LIVE_APPROVAL_BEFORE_FIX);
  assert.ok(issues.some((i) => i.toLowerCase().includes("ai drafted")), JSON.stringify(issues));
  assert.ok(
    issues.some((i) => i.toLowerCase().includes("awaiting dual approval (customer admin")),
    `the two-roles-no-surface parenthetical was not flagged: ${JSON.stringify(issues)}`
  );
});

test("the live escalate node is rejected for the wrong-hand-off sentence", () => {
  const issues = escalateNodeIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.some((i) => i.toLowerCase().includes("ai summary")));
  assert.ok(issues.some((i) => i.toLowerCase().includes("needs manual payroll")));
});

test("the live unrecognised node carries no forbidden phrase and is STILL rejected", () => {
  const blob = JSON.stringify(LIVE_UNRECOGNISED_BEFORE_FIX.parameters.updateFields).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!blob.includes(phrase.toLowerCase()), `unexpected forbidden phrase in the control: ${phrase}`);
  }
  assert.ok(unrecognisedNodeIssues(LIVE_UNRECOGNISED_BEFORE_FIX).length > 0);
});

// ---------------------------------------------------------------------------
// 3. Per-regression mutations
// ---------------------------------------------------------------------------

test("REGRESSION: the composed-note interpolation replaced by hand-typed prose", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=ESCALATED. {{ $('Assign Routing').item.json.routingNote }}";
  });
  assert.ok(escalateNodeIssues(node).some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
});

test("REGRESSION: the routing sentence dropped", () => {
  const node = mutated(APPROVAL_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\nAmendment record: " + RECORD_ID_INTERPOLATION;
  });
  assert.ok(approvalNodeIssues(node).some((i) => i.includes(ROUTING_NOTE_INTERPOLATION)));
});

test("REGRESSION: the record id dropped", () => {
  const node = mutated(APPROVAL_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION + "\n" + ROUTING_NOTE_INTERPOLATION;
  });
  assert.ok(approvalNodeIssues(node).some((i) => i.includes(RECORD_ID_INTERPOLATION)));
});

test("REGRESSION: status flipped to pending", () => {
  const node = mutated(APPROVAL_NODE_NAME, (n) => {
    n.parameters.updateFields.status = "pending";
  });
  const issues = approvalNodeIssues(node);
  assert.ok(issues.some((i) => i.includes("updateFields.status")));
  assert.ok(issues.some((i) => i.includes("waiting on the requester")));
});

test("REGRESSION: the group expression dropped", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    delete n.parameters.updateFields.group;
  });
  assert.ok(escalateNodeIssues(node).some((i) => i.includes("updateFields.group")));
});

test("REGRESSION: the marker tag dropped", () => {
  const node = mutated(UNRECOGNISED_NODE_NAME, (n) => {
    n.parameters.updateFields.tags = n.parameters.updateFields.tags.filter((t) => t !== EXCEPTION_TAG);
  });
  assert.ok(unrecognisedNodeIssues(node).some((i) => i.includes(EXCEPTION_TAG)));
});

test("REGRESSION: the ticket id repointed", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.id = "={{ $json.externalRef }}";
  });
  assert.ok(escalateNodeIssues(node).some((i) => i.includes("parameters.id")));
});

test("REGRESSION: a forbidden phrase re-typed in a DIFFERENT field", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.subject = "needs manual payroll/HR handling";
  });
  assert.ok(escalateNodeIssues(node).some((i) => i.toLowerCase().includes("needs manual payroll")));
});

test("an EXTRA tag is not a regression, but a missing one is", () => {
  const node = mutated(APPROVAL_NODE_NAME, (n) => {
    n.parameters.updateFields.tags = n.parameters.updateFields.tags.concat(["uc_processed"]);
  });
  assert.deepEqual(approvalNodeIssues(node), []);
});

test("the checker does NOT assert the queue tag — escalationQueueTagSpec.js owns it", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.tags = n.parameters.updateFields.tags.filter((t) => t !== QUEUE_TAG_EXPRESSION);
  });
  assert.deepEqual(escalateNodeIssues(node), []);
});

// ---------------------------------------------------------------------------
// 4. THE TWELVE-REASON SWEEP — the reason this file exists
// ---------------------------------------------------------------------------

test("every fixture reaches the reason it claims", () => {
  // A fixture that silently lands on a different gate would let a reason go
  // untested while the sweep below reported twelve. Asserted first, so the
  // sweep's coverage is a fact rather than an intention.
  for (const [reason, run] of Object.entries(REASON_FIXTURES)) {
    const out = run();
    assert.equal(out.decision, "escalate", `${reason}: fixture did not escalate`);
    assert.equal(out.reason, reason, `${reason}: fixture reached ${out.reason} instead`);
  }
});

test("the sweep covers exactly the twelve reasons the accuracy table names", () => {
  assert.deepEqual(
    Object.keys(REASON_FIXTURES).sort(),
    ESCALATION_REASON_ACCURACY.map((r) => r.reason).sort()
  );
  assert.equal(ESCALATION_REASON_ACCURACY.length, 12);
});

test("NO escalate note tells Payroll Ops to handle an upstream outage or an identity failure by hand", () => {
  // THE HEADLINE ASSERTION. The retired sentence said "this request needs
  // manual payroll/HR handling" on all twelve; it is true of five.
  const MANUAL = /needs manual payroll\/HR handling/;
  for (const [reason, run] of Object.entries(REASON_FIXTURES)) {
    const row = ESCALATION_REASON_ACCURACY.find((r) => r.reason === reason);
    const note = run().internalNote;
    if (row.kind === "payroll_or_hr") {
      assert.match(note, MANUAL, `${reason}: this one genuinely IS manual work and the note no longer says so`);
    } else {
      assert.ok(!MANUAL.test(note), `${reason} (${row.kind}): the note still claims manual payroll/HR handling`);
    }
  }
});

test("each non-payroll class gets its OWN sentence, naming what it really is", () => {
  const EXPECTED = {
    authentication: /This is an AUTHENTICATION finding, not a payroll one/,
    upstream_outage: /This is a REMOTE API FAILURE, not a decision about the amendment/,
    request_malformed: /This is a MALFORMED OR INCOMPLETE REQUEST/,
  };
  for (const [reason, run] of Object.entries(REASON_FIXTURES)) {
    const row = ESCALATION_REASON_ACCURACY.find((r) => r.reason === reason);
    if (row.kind === "payroll_or_hr") continue;
    assert.match(run().internalNote, EXPECTED[row.kind], `${reason} did not get its ${row.kind} sentence`);
  }
});

test("an upstream outage never claims a payroll cycle was looked at", () => {
  // "NOT EVALUATED" is not "none found". Asserting an absence nothing checked
  // is the same defect one level down.
  for (const reason of ["upstream_record_not_found", "upstream_unavailable", "identity_not_verified", "country_schema_unavailable"]) {
    const note = REASON_FIXTURES[reason]().internalNote;
    assert.match(note, /Payroll cycle: NOT EVALUATED/, `${reason}`);
    assert.ok(!/none on record covers/.test(note), `${reason}: claims a lookup that never happened`);
  }
  assert.match(REASON_FIXTURES.no_matching_payroll_cycle().internalNote, /none on record covers the requested effective date/);
});

test("the two upstream reasons say plainly that no gate authored them", () => {
  for (const reason of ["upstream_record_not_found", "upstream_unavailable"]) {
    const note = REASON_FIXTURES[reason]().internalNote;
    assert.match(note, /No gate in this ladder authored that reason/, reason);
    assert.ok(!/Decided at gate/.test(note), `${reason}: claims a gate decided it`);
  }
});

test("no branch of the composed note claims AI", () => {
  const runsAll = [approvalRun, ...Object.values(REASON_FIXTURES)];
  for (const run of runsAll) {
    const note = run().internalNote;
    assert.ok(!/\bAI (summary|drafted|prepared)\b/i.test(note), `"AI" claim in: ${note}`);
  }
  assert.match(approvalRun().internalNote, /no language model runs on this workflow/);
});

// ---------------------------------------------------------------------------
// 5. The dual-approval note names both parties AND their surfaces
// ---------------------------------------------------------------------------

test("the approval note says who fills each slot and on whose side", () => {
  const note = approvalRun().internalNote;
  assert.match(note, /Employer signature \(the customer_admin slot\)/);
  assert.match(note, /This is the CUSTOMER's side of the relationship, not Remote's/);
  assert.match(note, /A Remote agent must not fill it on their behalf/);
  assert.match(note, /Remote payroll specialist \(the payroll_specialist slot\)/);
  assert.match(note, /it is the slot a Remote agent fills/);
  assert.match(note, /The person who filed this amendment may fill neither/);
});

test("the slot description is dualApprovalPolicy.js's own words, quoted not paraphrased", () => {
  // The one place in this repository that says who fills each slot, written to
  // be read by whoever is being refused. Quoting it keeps the ticket and the
  // sidebar saying the same thing about the same amendment.
  const quoted = REFUSALS.requester_cannot_approve.reason.replace(/^The person who filed this amendment cannot approve it\. /, "");
  assert.ok(approvalRun().internalNote.includes(quoted), `the note does not quote: ${quoted}`);
});

test("the escalate branch quotes dualApprovalPolicy.js's not_awaiting_approval refusal", () => {
  const generic = REFUSALS.not_awaiting_approval.reason;
  assert.ok(REASON_FIXTURES.cutoff_lock_passed().internalNote.includes(generic), `the escalate note does not quote: ${generic}`);
});

test("identity_not_verified withholds the subject's details", () => {
  const note = REASON_FIXTURES.identity_not_verified().internalNote;
  assert.match(note, /subject details withheld/);
  assert.ok(!note.includes("Ana Silva"), note);
});

test("an upstream failure withholds the subject rather than printing normalizer defaults", () => {
  // The normalized employment fills its gaps with defaults, so a swallowed
  // fetch leaves a plausible-looking object. Printing it would present a
  // default as a record.
  for (const reason of ["upstream_record_not_found", "upstream_unavailable"]) {
    const note = REASON_FIXTURES[reason]().internalNote;
    assert.match(note, /anything shown here would be defaults rather than the record/, reason);
  }
});

test("the opening sentence is decision-aware and never claims a prepared amendment", () => {
  assert.match(approvalRun().internalNote, /^UC-06 contract amendment — this automation has PREPARED an amendment/);
  for (const reason of ["identity_not_verified", "upstream_unavailable"]) {
    const note = REASON_FIXTURES[reason]().internalNote;
    assert.match(note, /^UC-06 contract amendment — this automation has ESCALATED/, reason);
    assert.ok(!/has PREPARED an amendment/.test(note), reason);
  }
});

// ---------------------------------------------------------------------------
// 6. The ported prose is the SOURCE's prose, read from both sides
// ---------------------------------------------------------------------------

test("every ported `means` is byte-identical to src/uc06/policyEngine.js's", () => {
  // A Code node cannot import, so the ladder is copied. This reads BOTH and
  // compares, rather than restating either.
  //
  // THE SOURCE IS DE-ESCAPED FIRST, and only for `\'` -> `'`. The ported rows
  // are single-quoted JS string literals, so every apostrophe in the prose is
  // stored as `\'` and a raw substring test would report a byte-identical copy
  // as drifted. That normalisation is EXACT and reversible — it undoes the
  // quoting of the literal, not the text. Do not widen it to strip whitespace
  // or punctuation; that would make the check pass on a paraphrase, which is
  // the only thing it exists to catch.
  const deEscaped = gatesSource.replace(/\\'/g, "'");
  for (const row of SRC_GATE_SEQUENCE) {
    assert.ok(
      deEscaped.includes(row.means),
      `the n8n gates body does not carry src/uc06/policyEngine.js's \`means\` for "${row.reason}" verbatim`
    );
  }
});

test("the ported ladder covers every rung src has, and the two upstream reasons have none in either", () => {
  assert.equal(SRC_GATE_SEQUENCE.length, 11);
  const rungReasons = SRC_GATE_SEQUENCE.map((r) => r.reason);
  for (const upstream of ["upstream_record_not_found", "upstream_unavailable"]) {
    assert.ok(!rungReasons.includes(upstream), `${upstream} unexpectedly has a rung in src`);
  }
});

test("the accuracy table's `kind` agrees with the gates body's own ESCALATION_CLASS", () => {
  // Two copies of the same classification, held equal by reading both. The
  // gates body's copy is the one that selects the sentence; this table is the
  // evidence for the prose change. A drift between them would mean the header's
  // "5 of 12" described a classification the note no longer uses.
  for (const row of ESCALATION_REASON_ACCURACY) {
    const re = new RegExp(`reason: '${row.reason}', kind: '${row.kind}'`);
    assert.match(gatesSource, re, `ESCALATION_CLASS in the gates body does not classify ${row.reason} as ${row.kind}`);
  }
});

test("ESCALATION_REASON_ACCURACY: 6 of 12 accurate, and every row states why", () => {
  // SIX, NOT FIVE — and the discrepancy is worth keeping rather than rounding.
  // The work order for this change said "accurate for ~5 of 12 reachable
  // reasons". Classifying every reason one at a time gives SIX: the five
  // payroll ones plus `employee_not_active`, which is a genuine HR
  // record-keeping question a human at Remote owns. The direction matters — it
  // makes the retired sentence slightly LESS wrong than the brief assumed, and
  // a register that quietly adopted the more damning number would be doing the
  // same thing this whole change is against.
  const accurate = ESCALATION_REASON_ACCURACY.filter((r) => r.accurate);
  assert.equal(accurate.length, 6, "the header claims the retired sentence was accurate for 6 of the 12");
  for (const row of ESCALATION_REASON_ACCURACY) {
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
    assert.equal(row.accurate, row.kind === "payroll_or_hr", `${row.reason}: accuracy and kind disagree`);
  }
});

// ---------------------------------------------------------------------------
// 7. Ticket hygiene
// ---------------------------------------------------------------------------

test("neither the node expressions nor the composed notes carry harness vocabulary", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    for (const tag of uf.tags) assert.equal(findHarnessVocabulary(tag), null, `${name}: harness vocabulary in tag ${tag}`);
  }
  for (const run of [approvalRun, ...Object.values(REASON_FIXTURES)]) {
    const note = run().internalNote;
    assert.equal(findHarnessVocabulary(note), null, `harness vocabulary in the composed note: ${note}`);
  }
});

// ---------------------------------------------------------------------------
// 8. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31.md"), "utf8");
  for (const name of TERMINAL_NODE_NAMES) assert.ok(md.includes(name), `the deploy note does not mention ${name}`);
  assert.ok(md.includes(UC06_WORKFLOW_ID), "the deploy note does not name the workflow");
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(RECORD_ID_INTERPOLATION));
  assert.ok(md.includes(QUEUE_TAG_EXPRESSION), "the deploy note does not carry D-14's queue-tag expression");
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  for (const tag of [APPROVAL_TAG, ESCALATED_TAG, EXCEPTION_TAG]) assert.ok(md.includes(tag), `missing ${tag}`);

  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 3, "expected one paste-ready JSON block per node");
  const wanted = TERMINAL_NODE_NAMES.map((n) => JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields)));
  assert.deepEqual(blocks, wanted);
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN
// ---------------------------------------------------------------------------
// Same hazard, same remedy, as test/n8nUc04TerminalZendeskNodes.test.js's own
// cross-spec pin. BOTH files carry a full target block for these two nodes,
// because either can be used to deploy them — so a publish from the stale one
// reverts the other's fix. Held equal by ASSERTION rather than by import: an
// import would remove the duplication but also the failure message.
const { ESCALATION_QUEUE_TAG_NODES } = await import("../workflows/nodes/escalationQueueTagSpec.js");

for (const [nodeName, params] of [
  [ESCALATE_NODE_NAME, ESCALATE_PARAMETERS],
  [UNRECOGNISED_NODE_NAME, UNRECOGNISED_PARAMETERS],
]) {
  test(`cross-spec: "${nodeName}" is described identically in both specs`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find((e) => e.workflowId === UC06_WORKFLOW_ID && e.node === nodeName);
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetParameters.updateFields)),
      JSON.parse(JSON.stringify(params.updateFields)),
      `the two specs disagree about "${nodeName}". Deploying from either would revert the other; fix both, in one change.`
    );
  });
}

test("cross-spec: the queue tag is on escalate and unrecognised, and NOT on the approval node", () => {
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(
    !APPROVAL_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION),
    "dual_approval_required leaves escalated false, so routingTag already IS the queue tag"
  );
});

test("all three statuses are open, and all three were already open before this change", () => {
  assert.equal(APPROVAL_STATUS, "open");
  assert.equal(ESCALATE_STATUS, "open");
  assert.equal(UNRECOGNISED_STATUS, "open");
  for (const name of TERMINAL_NODE_NAMES) {
    assert.equal(LIVE_BEFORE_FIX[name].parameters.updateFields.status, "open", `${name} was not already open`);
  }
});

test("INTERNAL_NOTE_EXPRESSION is what the three specs actually carry", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.equal(TERMINAL_NODE_SPECS[name].parameters.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  }
});
