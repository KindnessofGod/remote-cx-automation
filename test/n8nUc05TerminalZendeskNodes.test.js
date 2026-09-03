// ---------------------------------------------------------------------------
// n8nUc05TerminalZendeskNodes.test.js — UC-05's three terminal Zendesk nodes
// must interpolate the composed note, not carry hand-typed prose — and one of
// them must stop telling a specialist that Remote publishes no resignation
// write
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `workflows/nodes-uc05/noticePeriodGates.js`'s `composeInternalNote()` emits a
// decision-aware note for EVERY branch. Until 2026-08-31 none of the three
// terminal Zendesk nodes consumed it: each carried a sentence typed into a node
// parameter, which no check in this repository can see. A Zendesk node has no
// `jsCode`, so `verify-deployed`'s body diff is structurally blind to it, and
// `test/n8nUc05Parity.test.js` cannot cover it either, by its own design — it
// compares DECISIONS, and a node that reaches the right verdict and describes
// it in false words passes every time.
//
// THE HIGHEST-SEVERITY THING IT COVERS is not a formatting defect. "No Remote
// write exists for resignations" is a claim about REMOTE'S PLATFORM that
// docs/use-cases/UC-05.md §1 retracted on 2026-08-21 — the endpoint exists,
// the boundary is a policy choice — and it was still on live tickets ten days
// later. CLAUDE.md §3's substitution ladder, failing at rung 1.
//
// HERMETIC. No network, no n8n key. The three live nodes are held here as
// verbatim snapshots captured from `GET /api/v1/workflows/WORKFLOW_UC05_ID` on
// 2026-08-31 (`versionId === activeVersionId ===
// 9363495e-df77-4110-a844-040fd978e35c`) and used as NEGATIVE CONTROLS — a
// detector that has never been shown failing is a detector nobody has tested,
// and this repo has twice closed a finding on a confident zero from a
// half-broken detector.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  SIGNOFF_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  SIGNOFF_PARAMETERS,
  ESCALATE_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  RECORD_ID_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  SIGNOFF_TAG,
  ESCALATED_TAG,
  EXCEPTION_TAG,
  SIGNOFF_STATUS,
  SIGNOFF_STATUS_BEFORE_FIX,
  ESCALATE_STATUS,
  UNRECOGNISED_STATUS,
  FORBIDDEN_PHRASES,
  REPORT_ABSENCE_ACCURACY,
  UC05_WORKFLOW_ID,
  terminalZendeskNodeIssues,
  signoffNodeIssues,
  escalateNodeIssues,
  unrecognisedNodeIssues,
} from "../workflows/nodes-uc05/terminalZendeskNodesSpec.js";
import { GATE_SEQUENCE as SRC_GATE_SEQUENCE } from "../src/uc05/policyEngine.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc05", "noticePeriodGates.js");
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc05");
const gatesSource = readFileSync(GATES_PATH, "utf8");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const LIVE_SIGNOFF_BEFORE_FIX = {
  name: SIGNOFF_NODE_NAME,
  type: TERMINAL_NODE_TYPE,
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Notice Period Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI prepared discrepancy report {{ $('Create Resignation Record').item.json.id }} — awaiting HR Ops sign-off. Statutory notice end: {{ $('Notice Period Gates').item.json.notice ? $('Notice Period Gates').item.json.notice.noticeEndDate : \"unknown\" }}. Flags: {{ $('Notice Period Gates').item.json.flags.join(\", \") || \"none\" }}. No Remote write exists for resignations — the signed-off report IS the durable artifact. {{ $('Assign Routing').item.json.routingNote }}",
      status: "pending",
      tags: ["uc05_prepared_for_signoff", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_ESCALATE_BEFORE_FIX = {
  name: ESCALATE_NODE_NAME,
  type: TERMINAL_NODE_TYPE,
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Notice Period Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI summary — ESCALATED: {{ $('Notice Period Gates').item.json.reason }}. Flags: {{ $('Notice Period Gates').item.json.flags.join(\", \") || \"none\" }}. No report was prepared for sign-off. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc05_escalated",
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
    id: "={{ $('Notice Period Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=Automation produced an unrecognised decision ({{ $('Notice Period Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: [
        "uc05_exception",
        "={{ $('Assign Routing').item.json.routing.queueTag }}",
        "={{ $('Assign Routing').item.json.routingTag }}",
      ],
    },
  },
};

const LIVE_BEFORE_FIX = {
  [SIGNOFF_NODE_NAME]: LIVE_SIGNOFF_BEFORE_FIX,
  [ESCALATE_NODE_NAME]: LIVE_ESCALATE_BEFORE_FIX,
  [UNRECOGNISED_NODE_NAME]: LIVE_UNRECOGNISED_BEFORE_FIX,
};

/** The node a deploy is supposed to produce, built FROM the spec. */
const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

/** A deep clone with one path mutated — for the per-regression controls. */
function mutated(name, mutate) {
  const node = targetNode(name);
  mutate(node);
  return node;
}

// ---------------------------------------------------------------------------
// Running the real gates body — the note under test is composed, not typed
// ---------------------------------------------------------------------------

function runGates({ request, employmentResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Resignation Request") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentResponse }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const employment = (over = {}) => ({
  data: {
    employment: {
      id: "emp_pt_001",
      status: "active",
      country_code: "PT",
      start_date: "2023-01-10",
      full_name: "Ana Silva",
      job_title: "Senior Engineer",
      contract_type: "employee",
      ...over,
    },
  },
});

const GOOD_BALANCE = [{ type: "vacation", daysAccrued: 10, daysTaken: 0, hourlyRateInRemoteInteger: 2500, hoursPerDay: 8 }];

const request = (over = {}) => ({
  employmentId: "emp_pt_001",
  externalRef: "77",
  now: "2026-08-31T09:00:00Z",
  session: { authenticatedEmploymentId: "emp_pt_001" },
  currency: "EUR",
  timeOffBalances: GOOD_BALANCE,
  ...over,
});

const preparedRun = () => runGates({ request: request(), employmentResponse: employment() });
const discrepancyRun = () => runGates({ request: request({ proposedEndDate: "2026-09-05" }), employmentResponse: employment() });
const identityRun = () => runGates({ request: request({ session: { authenticatedEmploymentId: "someone_else" } }), employmentResponse: employment() });
const unsupportedRun = () => runGates({ request: request(), employmentResponse: employment({ country_code: "ZZ" }) });
const ptoUnusableRun = () =>
  runGates({ request: request({ timeOffBalances: [{ type: "vacation", daysAccrued: 10 }] }), employmentResponse: employment() });
// Remote's own `days_of_notice` BELOW the statutory figure. Ana Silva has served
// more than two years, so Código do Trabalho art. 400.º(1) gives 60 days; a
// record saying 30 is a blended contract-and-statute figure sitting under the
// statutory floor, which is the one case the reconciliation exists to catch.
const remoteBelowStatutoryRun = () =>
  runGates({ request: request({ remoteDaysOfNotice: 30, offboardingRequestId: "ofb_77" }), employmentResponse: employment() });

// ---------------------------------------------------------------------------
// 1. The targets pass their own checkers
// ---------------------------------------------------------------------------

test("every target node passes its own checker", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.deepEqual(terminalZendeskNodeIssues(targetNode(name)), [], `${name} should be clean`);
  }
});

test("the three named wrappers agree with the parameterised checker", () => {
  assert.deepEqual(signoffNodeIssues(targetNode(SIGNOFF_NODE_NAME)), []);
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

test("the live sign-off node is rejected for the RETRACTED CLAIM specifically", () => {
  // Not "it fails somewhere" — it must fail on this sentence, because this
  // sentence is the reason the change is urgent rather than tidy.
  const issues = signoffNodeIssues(LIVE_SIGNOFF_BEFORE_FIX);
  assert.ok(
    issues.some((i) => i.toLowerCase().includes("no remote write exists")),
    `expected a "no Remote write exists" issue, got: ${JSON.stringify(issues)}`
  );
  assert.ok(issues.some((i) => i.toLowerCase().includes("ai prepared")));
  assert.ok(issues.some((i) => i.toLowerCase().includes("discrepancy report")));
});

test("the live sign-off node is rejected for status: pending", () => {
  const issues = signoffNodeIssues(LIVE_SIGNOFF_BEFORE_FIX);
  const statusIssue = issues.find((i) => i.includes("updateFields.status"));
  assert.ok(statusIssue, `no status issue raised: ${JSON.stringify(issues)}`);
  assert.match(statusIssue, /waiting on the REQUESTER/);
  assert.match(statusIssue, /auto-solve pending/);
});

test("the live escalate node is rejected for both of its false phrases", () => {
  const issues = escalateNodeIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.some((i) => i.toLowerCase().includes("ai summary")));
  assert.ok(issues.some((i) => i.toLowerCase().includes("no report was prepared for sign-off")));
});

test("the live unrecognised node carries no forbidden phrase and is STILL rejected", () => {
  // The interesting control: this node's sentence is not false, it is just
  // unversioned and thin. A checker that only looked for bad phrases would
  // pass it, and the composed note would stay unread on this branch forever.
  const blob = JSON.stringify(LIVE_UNRECOGNISED_BEFORE_FIX.parameters.updateFields).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!blob.includes(phrase.toLowerCase()), `unexpected forbidden phrase in the control: ${phrase}`);
  }
  assert.ok(unrecognisedNodeIssues(LIVE_UNRECOGNISED_BEFORE_FIX).length > 0);
});

// ---------------------------------------------------------------------------
// 3. Per-regression mutations — each detector shown failing on its own defect
// ---------------------------------------------------------------------------

test("REGRESSION: the composed-note interpolation replaced by hand-typed prose", () => {
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=ESCALATED. {{ $('Assign Routing').item.json.routingNote }}";
  });
  const issues = escalateNodeIssues(node);
  assert.ok(issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)));
});

test("REGRESSION: the routing sentence dropped", () => {
  const node = mutated(SIGNOFF_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\nResignation record: " + RECORD_ID_INTERPOLATION;
  });
  assert.ok(signoffNodeIssues(node).some((i) => i.includes(ROUTING_NOTE_INTERPOLATION)));
});

test("REGRESSION: the record id dropped", () => {
  const node = mutated(SIGNOFF_NODE_NAME, (n) => {
    n.parameters.updateFields.internalNote = "=" + INTERNAL_NOTE_INTERPOLATION + "\n" + ROUTING_NOTE_INTERPOLATION;
  });
  assert.ok(signoffNodeIssues(node).some((i) => i.includes(RECORD_ID_INTERPOLATION)));
});

test("REGRESSION: status reverted to pending on the sign-off node", () => {
  const node = mutated(SIGNOFF_NODE_NAME, (n) => {
    n.parameters.updateFields.status = SIGNOFF_STATUS_BEFORE_FIX;
  });
  assert.ok(signoffNodeIssues(node).some((i) => i.includes("updateFields.status")));
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

test("REGRESSION: a forbidden phrase re-typed anywhere in updateFields", () => {
  // Inside a DIFFERENT field from the one it was originally in — the 2026-08-29
  // migration's lesson is that a field-by-field walk misses the copy hiding
  // inside a string inside another field.
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.subject = "AI summary — no Remote write exists for resignations";
  });
  const issues = escalateNodeIssues(node);
  assert.ok(issues.some((i) => i.toLowerCase().includes("no remote write exists")));
});

test("an EXTRA tag is not a regression, but a missing one is", () => {
  // Containment, not equality — a deploy that adds `uc_processed` (the
  // intake-trigger loop guard) must not turn verify-deployed red.
  const node = mutated(SIGNOFF_NODE_NAME, (n) => {
    n.parameters.updateFields.tags = n.parameters.updateFields.tags.concat(["uc_processed"]);
  });
  assert.deepEqual(signoffNodeIssues(node), []);
});

test("the checker does NOT assert the queue tag — escalationQueueTagSpec.js owns it", () => {
  // Two checkers asserting one field is how a fix in one lands as a failure in
  // the other. Proven by removing it and expecting silence FROM THIS FILE.
  const node = mutated(ESCALATE_NODE_NAME, (n) => {
    n.parameters.updateFields.tags = n.parameters.updateFields.tags.filter((t) => t !== QUEUE_TAG_EXPRESSION);
  });
  assert.deepEqual(escalateNodeIssues(node), []);
});

// ---------------------------------------------------------------------------
// 4. The composed note itself — the claims this change exists to make
// ---------------------------------------------------------------------------

test("no branch of the composed note repeats the retracted claim about Remote", () => {
  for (const run of [preparedRun, discrepancyRun, identityRun, unsupportedRun, ptoUnusableRun]) {
    const note = run().internalNote;
    assert.ok(!/no remote write exists/i.test(note), `retracted claim in: ${note}`);
    assert.ok(!/\bAI (summary|prepared|drafted)\b/i.test(note), `"AI" claim in: ${note}`);
  }
});

test("the sign-off note states the boundary as a POLICY CHOICE and names the endpoint", () => {
  const note = preparedRun().internalNote;
  assert.match(note, /PUT \/v1\/resignations\/\{offboarding_request_id\}\/validate/);
  assert.match(note, /resignation:write/);
  assert.match(note, /policy choice, not an absence in Remote's API/);
  assert.match(note, /signed-off report is this system's durable artifact/);
});

test("the sign-off branch says notice-period report and never discrepancy report", () => {
  const out = preparedRun();
  assert.equal(out.decision, "prepared_for_signoff");
  assert.ok(!/discrepancy report/i.test(out.internalNote), out.internalNote);
  assert.match(out.internalNote, /notice-period report/);
});

test("the discrepancy branch NAMES the discrepancy the sign-off branch cannot have", () => {
  const out = discrepancyRun();
  assert.equal(out.reason, "statutory_discrepancy");
  assert.match(out.internalNote, /DISCREPANCY: the resignation proposes 2026-09-05/);
  // The signed day count is deliberately NOT restated in prose — it is
  // negative, and "-55 day(s) EARLIER" reads as 55 days LATE.
  assert.ok(!/-\d+ day\(s\) EARLIER/.test(out.internalNote), out.internalNote);
});

test("the two escalations that DO have figures say so; the ones that do not, do not", () => {
  const withFigures = [discrepancyRun(), ptoUnusableRun()];
  for (const out of withFigures) {
    assert.equal(out.decision, "escalate");
    assert.match(out.internalNote, /Statutory notice end: \d{4}-\d{2}-\d{2}/);
    assert.match(out.internalNote, /already computed and durable on the resignation record/);
    assert.ok(!/No report was prepared for sign-off/i.test(out.internalNote));
  }
  for (const out of [identityRun(), unsupportedRun()]) {
    assert.equal(out.decision, "escalate");
    assert.ok(!/already computed and durable/.test(out.internalNote), out.internalNote);
  }
});

test("no balances supplied: the note says 'not known' — never '0.00 USD (from no_time_off_records)'", () => {
  // The record carries totalInRemoteInteger: 0 for an empty list (arithmetic,
  // not a finding), and this note printed it as a settlement of nothing in a
  // currency nobody stated, with the reason hidden in an enum. Same defect the
  // sidebar row had; same words as the portal.
  const out = runGates({ request: request({ timeOffBalances: [], currency: undefined }), employmentResponse: employment() });
  assert.equal(out.decision, "prepared_for_signoff");
  assert.match(out.internalNote, /PTO payout: not known/);
  assert.match(out.internalNote, /not a finding that nothing is owed/);
  assert.doesNotMatch(out.internalNote, /0\.00/, "a zero nobody worked out reached a customer's ticket");
  assert.doesNotMatch(out.internalNote, /USD/, "a currency nobody stated reached a customer's ticket");
  assert.doesNotMatch(out.internalNote, /no_time_off_records/, "an enum is not an explanation");
});

test("pto_balance_unusable refuses to let a blank payout read as 'nothing is owed'", () => {
  const out = ptoUnusableRun();
  assert.equal(out.reason, "pto_balance_unusable");
  assert.match(out.internalNote, /PTO payout: NOT COMPUTED/);
  assert.match(out.internalNote, /not "nothing is owed"/);
});

test("identity_not_verified withholds the subject's details", () => {
  const out = identityRun();
  assert.equal(out.reason, "identity_not_verified");
  assert.match(out.internalNote, /subject details withheld/);
  assert.ok(!out.internalNote.includes("Ana Silva"), out.internalNote);
  assert.ok(!out.internalNote.includes("Senior Engineer"), out.internalNote);
});

test("the opening sentence is decision-aware and never claims a report that does not exist", () => {
  assert.match(preparedRun().internalNote, /^UC-05 resignation notice — this automation has COMPUTED/);
  for (const out of [identityRun(), unsupportedRun()]) {
    assert.match(out.internalNote, /^UC-05 resignation notice — this automation has ESCALATED\./);
    assert.ok(!/has COMPUTED a statutory notice period and PREPARED/.test(out.internalNote), out.internalNote);
  }
});

test("the note names which reader produced the extraction, and says no model runs here", () => {
  const note = preparedRun().internalNote;
  assert.match(note, /read by: rule_based_fallback/);
  assert.match(note, /no language model runs on this workflow/);
});

// ---------------------------------------------------------------------------
// 5. The ported prose is the SOURCE's prose, read from both sides
// ---------------------------------------------------------------------------

test("every ported `means` is byte-identical to src/uc05/policyEngine.js's", () => {
  // A Code node cannot import, so the ladder is copied. This is what keeps the
  // copy honest: it reads BOTH and compares, rather than restating either.
  //
  // ONE ROW IS NOT A LITERAL ON EITHER SIDE and must be checked differently.
  // `statutory_discrepancy`'s `means` interpolates the escalation team from the
  // routing table (over there via a template literal, here via a `prefix` +
  // `means` pair), so it is not a contiguous string in either FILE. It is
  // checked against the RENDERED note instead — which is the stronger check
  // anyway, because that is the text a specialist actually reads.
  //
  // THE SOURCE IS DE-ESCAPED BEFORE COMPARING, and only for `\\'` → `'`. The
  // ported rows are single-quoted JS string literals, so every apostrophe in
  // the prose is stored as `\\'` — "This employee\\'s country" — and a raw
  // substring test would report a byte-identical copy as drifted. This is the
  // one normalisation that is safe here because it is EXACT and reversible: it
  // is undoing the quoting of the literal, not smoothing the text. Do not
  // widen it to strip whitespace or punctuation; that would make the check
  // pass on a paraphrase, which is the only thing it exists to catch.
  const deEscaped = gatesSource.replace(/\\'/g, "'");
  // TWO RUNGS ARE BUILT RATHER THAN LITERAL, as of 2026-09-02, and both for the
  // same reason: they name the desk, and the desk is the routing table's answer
  // rather than a name typed into either file. Neither is a contiguous string in
  // EITHER source, so both are checked against the RENDERED note — which is the
  // stronger check anyway, because that is the text a specialist actually reads.
  // Everything else is compared byte for byte.
  const INTERPOLATED = new Map([
    ["statutory_discrepancy", discrepancyRun],
    ["remote_notice_below_statutory", remoteBelowStatutoryRun],
  ]);
  for (const row of SRC_GATE_SEQUENCE) {
    if (INTERPOLATED.has(row.reason)) continue;
    assert.ok(
      deEscaped.includes(row.means),
      `the n8n gates body does not carry src/uc05/policyEngine.js's \`means\` for "${row.reason}" verbatim`
    );
  }
  for (const [reason, run] of INTERPOLATED) {
    const interpolated = SRC_GATE_SEQUENCE.find((r) => r.reason === reason);
    assert.ok(interpolated, `src/uc05/policyEngine.js no longer has a ${reason} rung`);
    const out = run();
    assert.equal(out.reason, reason, `the fixture for ${reason} did not reach it — it produced ${out.reason}`);
    assert.ok(
      out.internalNote.includes(interpolated.means),
      `the rendered note does not carry policyEngine.js's ${reason} \`means\` verbatim`
    );
  }
});

test("the escalation team in the node body is the routing table's, not a hand-typed name", async () => {
  const { escalationTeamFor } = await import("../src/shared/escalationRouting.js");
  const team = escalationTeamFor("UC-05");
  assert.equal(team, "Local HR & Legal");
  assert.ok(gatesSource.includes(`const ESCALATION_TEAM = '${team}';`), "the ported constant is not the table's answer");
  assert.match(discrepancyRun().internalNote, new RegExp(team.replace(/&/g, "&")));
});

test("the sign-off refusal text is signoffPolicy.js's own, quoted not paraphrased", async () => {
  // The two surfaces must say the same thing about the same case. The shared
  // clause is asserted rather than the whole sentence, because signoffPolicy.js
  // itself has two spellings of it — the generic REFUSALS entry ends the
  // sentence with a full stop, and describeNoSignoffPath() continues it with
  // "; the escalation is worked on its own ticket." The note quotes the
  // continued form, so the assertion is on what both contain.
  const { refuse } = await import("../src/uc05/signoffPolicy.js");
  const generic = refuse("not_awaiting_signoff").reason;
  const shared = "not prepared for sign-off — it has no sign-off path here";
  assert.ok(generic.includes(shared), `signoffPolicy.js's refusal no longer contains: ${shared}`);
  const note = discrepancyRun().internalNote;
  assert.ok(note.includes(shared), `the escalate note does not quote: ${shared}`);
  assert.ok(note.includes("the escalation is worked on its own ticket"));
});

// ---------------------------------------------------------------------------
// 6. The accuracy table is evidence, and it has to agree with reality
// ---------------------------------------------------------------------------

test("REPORT_ABSENCE_ACCURACY covers 10 escalate reasons and 3 of them are inaccurate", () => {
  // WAS 8 AND 2 UNTIL 2026-09-02. Two escalate reasons were added that day —
  // `no_statutory_notice_during_probation` (the statute gives a resigning
  // probationer no notice period at all) and `remote_notice_below_statutory`
  // (Remote's own days_of_notice sits under the statutory floor) — and the
  // second of them is a THIRD case where "no report was prepared for sign-off"
  // is misleading: its entire content is two computed figures held against each
  // other, both durable on the row.
  assert.equal(REPORT_ABSENCE_ACCURACY.length, 10);
  const inaccurate = REPORT_ABSENCE_ACCURACY.filter((r) => !r.accurate).map((r) => r.reason);
  assert.deepEqual(inaccurate.sort(), ["pto_balance_unusable", "remote_notice_below_statutory", "statutory_discrepancy"]);
  for (const row of REPORT_ABSENCE_ACCURACY) {
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
  }
});

test("REPORT_ABSENCE_ACCURACY's noticeComputed column matches what real runs produce", () => {
  // The table is evidence for a prose change, so it must not be a claim nobody
  // checked. Driven for the reasons this test can reach.
  const observed = {
    statutory_discrepancy: discrepancyRun(),
    pto_balance_unusable: ptoUnusableRun(),
    identity_not_verified: identityRun(),
    unsupported_country: unsupportedRun(),
    remote_notice_below_statutory: remoteBelowStatutoryRun(),
  };
  for (const [reason, out] of Object.entries(observed)) {
    const row = REPORT_ABSENCE_ACCURACY.find((r) => r.reason === reason);
    assert.ok(row, `no accuracy row for ${reason}`);
    assert.equal(out.reason, reason, `the fixture for ${reason} did not reach it`);
    const computed = Boolean(out.notice && out.notice.noticeEndDate);
    assert.equal(computed, row.noticeComputed, `${reason}: table says noticeComputed=${row.noticeComputed}, run says ${computed}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Ticket hygiene — this text goes on a real customer's ticket
// ---------------------------------------------------------------------------

test("neither the node expressions nor the composed notes carry harness vocabulary", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    for (const tag of uf.tags) assert.equal(findHarnessVocabulary(tag), null, `${name}: harness vocabulary in tag ${tag}`);
  }
  for (const run of [preparedRun, discrepancyRun, identityRun, unsupportedRun, ptoUnusableRun]) {
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
  assert.ok(md.includes(UC05_WORKFLOW_ID), "the deploy note does not name the workflow");
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(RECORD_ID_INTERPOLATION));
  assert.ok(md.includes(QUEUE_TAG_EXPRESSION), "the deploy note does not carry D-14's queue-tag expression");
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  for (const tag of [SIGNOFF_TAG, ESCALATED_TAG, EXCEPTION_TAG]) assert.ok(md.includes(tag), `missing ${tag}`);

  // The JSON blocks must BE the spec, not a retyping of it. A paste-ready block
  // that has drifted from the checker is worse than none: an operator follows
  // it and `verify-deployed` then reports the drift they were told to create.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 3, "expected one paste-ready JSON block per node");
  const wanted = TERMINAL_NODE_NAMES.map((n) => JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields)));
  assert.deepEqual(blocks, wanted);
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe UC-05's escalate and unrecognised
// nodes, and neither may silently revert the other
// ---------------------------------------------------------------------------
// Same hazard, same remedy, as test/n8nUc04TerminalZendeskNodes.test.js's own
// cross-spec pin. BOTH files carry a full target block for these two nodes,
// because either can be used to deploy them — so a publish from the stale one
// reverts the other's fix. Held equal by ASSERTION rather than by one file
// importing the other: an import would remove the duplication but also the
// failure message, and a dropped field would propagate silently and
// consistently. This way a divergence names itself and says which field.
const { ESCALATION_QUEUE_TAG_NODES } = await import("../workflows/nodes/escalationQueueTagSpec.js");

for (const [nodeName, params] of [
  [ESCALATE_NODE_NAME, ESCALATE_PARAMETERS],
  [UNRECOGNISED_NODE_NAME, UNRECOGNISED_PARAMETERS],
]) {
  test(`cross-spec: "${nodeName}" is described identically in both specs`, () => {
    const other = ESCALATION_QUEUE_TAG_NODES.find((e) => e.workflowId === UC05_WORKFLOW_ID && e.node === nodeName);
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetParameters.updateFields)),
      JSON.parse(JSON.stringify(params.updateFields)),
      `the two specs disagree about "${nodeName}". Deploying from either would revert the other; fix both, in one change.`
    );
  });
}

test("cross-spec: the queue tag is on escalate and unrecognised, and NOT on the sign-off node", () => {
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(
    !SIGNOFF_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION),
    "prepared_for_signoff leaves escalated false, so routingTag already IS the queue tag"
  );
});

test("the three statuses are what the spec says, and only the sign-off one moved", () => {
  assert.equal(SIGNOFF_STATUS, "open");
  assert.equal(SIGNOFF_STATUS_BEFORE_FIX, "pending");
  assert.equal(ESCALATE_STATUS, "open");
  assert.equal(UNRECOGNISED_STATUS, "open");
  assert.equal(LIVE_ESCALATE_BEFORE_FIX.parameters.updateFields.status, ESCALATE_STATUS);
  assert.equal(LIVE_UNRECOGNISED_BEFORE_FIX.parameters.updateFields.status, UNRECOGNISED_STATUS);
  assert.equal(LIVE_SIGNOFF_BEFORE_FIX.parameters.updateFields.status, SIGNOFF_STATUS_BEFORE_FIX);
});

test("INTERNAL_NOTE_EXPRESSION is what the three specs actually carry", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.equal(TERMINAL_NODE_SPECS[name].parameters.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
  }
});
