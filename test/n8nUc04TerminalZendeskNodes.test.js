// ---------------------------------------------------------------------------
// n8nUc04TerminalZendeskNodes.test.js — UC-04's three remaining terminal
// Zendesk nodes must interpolate the composed note, not carry hand-typed prose
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `workflows/nodes-uc04/workationGates.js`'s `composeInternalNote()` has emitted
// a correct, stage-aware note for EVERY decision since 2026-08-31 — including
// `blocked`, `escalate` and the unrecognised fallback — and only one of the four
// terminal Zendesk nodes consumed it. The other three kept sentences typed into
// a node parameter, which no check in this repository can see: a Zendesk node
// carries no `jsCode`, so `verify-deployed`'s body diff is structurally blind to
// it, and all four sat in `scripts/lib/unguarded-node-baseline.json` as accepted
// debt.
//
// `test/n8nUc04Parity.test.js` cannot cover this either, by its own design: it
// compares DECISIONS. A node that reaches the right verdict and describes it in
// false words passes it every time.
//
// HERMETIC. No network, no n8n key. The three live nodes are held here as
// verbatim snapshots captured from `GET /api/v1/workflows/WORKFLOW_UC04_ID` on
// 2026-08-31 (`versionId === activeVersionId ===
// 50e33f3c-23bc-4e1c-b1d3-016751e57744`) and used as NEGATIVE CONTROLS — a
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
  BLOCKED_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  TERMINAL_NODE_TYPE,
  TERMINAL_NODE_NAMES,
  TERMINAL_NODE_SPECS,
  BLOCKED_PARAMETERS,
  ESCALATE_PARAMETERS,
  UNRECOGNISED_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  INTERNAL_NOTE_EXPRESSION,
  TICKET_ID_EXPRESSION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  QUEUE_TAG_EXPRESSION,
  BLOCKED_TAG,
  ESCALATED_TAG,
  EXCEPTION_TAG,
  BLOCKED_STATUS,
  ESCALATE_STATUS,
  UNRECOGNISED_STATUS,
  FORBIDDEN_PHRASES,
  BLOCKED_REASON_ACCURACY,
  terminalZendeskNodeIssues,
  blockedNodeIssues,
  escalateNodeIssues,
  unrecognisedNodeIssues,
} from "../workflows/nodes-uc04/terminalZendeskNodesSpec.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc04");

// ---------------------------------------------------------------------------
// The live nodes, verbatim. THE NEGATIVE CONTROLS.
// ---------------------------------------------------------------------------

const LIVE_BLOCKED_BEFORE_FIX = {
  name: "Flag Blocked Workation",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Workation Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI summary — decision: blocked ({{ $('Workation Gates').item.json.reason }}). Flags: {{ $('Workation Gates').item.json.flags.join(\", \") || \"none\" }}. Blocked by the risk matrix or employer permission — not open to approval here. {{ $('Assign Routing').item.json.routingNote }}",
      status: "pending",
      tags: ["uc04_blocked", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_ESCALATE_BEFORE_FIX = {
  name: "Escalate Workation Ticket",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Workation Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI summary — ESCALATED to Mobility Legal Tier-2: {{ $('Workation Gates').item.json.reason }}. Flags: {{ $('Workation Gates').item.json.flags.join(\", \") || \"none\" }}. Not open to 1-click approval here. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: ["uc04_escalated", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

const LIVE_UNRECOGNISED_BEFORE_FIX = {
  name: "Unrecognised Workation Decision",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Workation Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=Automation produced an unrecognised decision ({{ $('Workation Gates').item.json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
      status: "open",
      tags: ["uc04_exception", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

/** The three nodes as they must look after the deploy. */
const targetNode = (name) => ({
  name,
  type: TERMINAL_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[name].parameters)),
});

// ---------------------------------------------------------------------------
// 1. The targets pass
// ---------------------------------------------------------------------------

test("all three target parameter blocks pass their own checker", () => {
  assert.deepEqual(blockedNodeIssues(targetNode(BLOCKED_NODE_NAME)), []);
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
  // no opinion about must NOT return [], because [] is what
  // `verify-deployed` reads as "checked and clean".
  const issues = terminalZendeskNodeIssues({ name: "Some Other Zendesk Node", parameters: {} });
  assert.ok(issues.length > 0);
  assert.match(issues[0], /no terminal-node spec/);
  assert.ok(terminalZendeskNodeIssues(undefined).length > 0);
});

test("all three interpolate the same expression — the difference is composed upstream", () => {
  for (const params of [BLOCKED_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.equal(params.updateFields.internalNote, INTERNAL_NOTE_EXPRESSION);
    assert.ok(params.updateFields.internalNote.includes(INTERNAL_NOTE_INTERPOLATION));
    assert.ok(params.updateFields.internalNote.includes(ROUTING_NOTE_INTERPOLATION));
    // Addressed BY NODE NAME, never off `$json` — at these nodes `$json` is
    // whatever `Assign Routing` emitted, which spreads a Supabase insert
    // response and carries none of the gates' fields. The wrong form yields an
    // EMPTY note on a green execution.
    assert.ok(params.updateFields.internalNote.includes("$('Workation Gates')"));
    assert.ok(!/\{\{\s*\$json\.internalNote/.test(params.updateFields.internalNote));
  }
});

test("the unchanged fields really are unchanged", () => {
  for (const params of [BLOCKED_PARAMETERS, ESCALATE_PARAMETERS, UNRECOGNISED_PARAMETERS]) {
    assert.equal(params.authentication, "oAuth2");
    assert.equal(params.operation, "update");
    assert.equal(params.id, TICKET_ID_EXPRESSION);
    assert.equal(params.updateFields.group, ZENDESK_GROUP_EXPRESSION);
    assert.ok(params.updateFields.tags.includes(ROUTING_TAG_EXPRESSION));
  }
  assert.equal(BLOCKED_PARAMETERS.updateFields.status, BLOCKED_STATUS);
  assert.equal(BLOCKED_PARAMETERS.updateFields.status, "pending");
  assert.equal(ESCALATE_PARAMETERS.updateFields.status, ESCALATE_STATUS);
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.status, UNRECOGNISED_STATUS);
  assert.equal(ESCALATE_PARAMETERS.updateFields.status, "open");
  assert.equal(UNRECOGNISED_PARAMETERS.updateFields.status, "open");
  assert.ok(BLOCKED_PARAMETERS.updateFields.tags.includes(BLOCKED_TAG));
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(ESCALATED_TAG));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(EXCEPTION_TAG));
});

// ---------------------------------------------------------------------------
// 2. rca-iih7 / D-14 — the queue tag, on the escalate node ONLY
// ---------------------------------------------------------------------------

test("the escalate node carries the queue tag, positioned before the routing tag", () => {
  const tags = ESCALATE_PARAMETERS.updateFields.tags;
  assert.ok(tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(
    tags.indexOf(QUEUE_TAG_EXPRESSION) < tags.indexOf(ROUTING_TAG_EXPRESSION),
    "the owning-team tag comes first, exactly as UC-01's Escalate Ticket carries it"
  );
  assert.deepEqual(tags, [ESCALATED_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION]);
});

test("only the BLOCKED node omits the queue tag — for it routingTag already IS the queue tag", () => {
  // CORRECTED 2026-08-31. This test used to assert that the unrecognised node
  // omitted the tag too, on the reasoning that a non-escalate decision leaves
  // `escalated` false so `routingTag` already resolves to the queue tag. That
  // holds for `blocked` and for a present-but-unknown decision STRING. It does
  // NOT hold for the input the fallback output actually receives most
  // dangerously: `isEscalation()` returns TRUE for a missing, empty or
  // non-string decision — "a missing signal takes the stronger treatment", its
  // own comment — so on that run routeTags is [queueTag, escalationTag],
  // routingTag is the escalation marker alone, and the note claims a tag the
  // ticket never gets. UC-01's fix covers both its escalate and its
  // unrecognised node, which is the confirming evidence.
  //
  // Measured, not reasoned about:
  //   isEscalation('escalate')            -> true
  //   isEscalation('blocked')             -> false
  //   isEscalation('weird_new_decision')  -> false
  //   isEscalation(null|undefined|''|123) -> true
  assert.ok(
    !BLOCKED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION),
    "isEscalation('blocked') is false, so a second copy of the queue tag would be redundant"
  );
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
});

test("the queue tag is read by node name, not by indexing zendeskTags", () => {
  // `zendeskTags[0]` happens to be the queue tag today; a reordering of that
  // array would silently repoint the expression at the escalation tag and the
  // ticket would carry it twice while still missing the queue tag.
  assert.equal(QUEUE_TAG_EXPRESSION, "={{ $('Assign Routing').item.json.routing.queueTag }}");
  assert.ok(!QUEUE_TAG_EXPRESSION.includes("zendeskTags"));
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE CONTROLS — the live nodes must be REJECTED, by name
// ---------------------------------------------------------------------------

test("NEGATIVE CONTROL: the blocked node as deployed today is rejected, for the right reasons", () => {
  const issues = blockedNodeIssues(LIVE_BLOCKED_BEFORE_FIX);
  assert.ok(issues.length >= 2, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the hand-typed inline note must be flagged"
  );
  assert.ok(
    issues.some((i) => i.includes("blocked by the risk matrix or employer permission")),
    "the claim that is accurate for only 5 of 12 blocked reasons must be flagged BY NAME"
  );
  // The status, group and tags on this node were already right — the checker
  // must not manufacture failures on fields the deploy does not touch.
  assert.ok(!issues.some((i) => i.includes("updateFields.status")));
  assert.ok(!issues.some((i) => i.includes("updateFields.group")));
});

test("NEGATIVE CONTROL: the escalate node as deployed today is rejected, for the right reasons", () => {
  const issues = escalateNodeIssues(LIVE_ESCALATE_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected several failures, got: ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)));
  assert.ok(
    issues.some((i) => i.includes("not open to 1-click approval")),
    "the sentence implying a slower Zendesk approval exists must be flagged BY NAME"
  );
  assert.ok(
    issues.some((i) => i.includes("mobility legal tier-2")),
    "the group name that does not exist must be flagged BY NAME — the live group is Mobility & Legal (Tier-2)"
  );
  assert.ok(
    issues.some((i) => i.includes(QUEUE_TAG_EXPRESSION)),
    "D-14: the missing owning-team tag must be flagged"
  );
});

test("NEGATIVE CONTROL: the unrecognised node as deployed today is rejected", () => {
  const issues = unrecognisedNodeIssues(LIVE_UNRECOGNISED_BEFORE_FIX);
  assert.ok(issues.length >= 1, `expected a failure, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote") && i.includes(INTERNAL_NOTE_INTERPOLATION)),
    "the hand-typed inline note must be flagged"
  );
  // This one's prose is not FALSE — it is just unversioned and it discards
  // everything composeInternalNote() knows. So it trips no forbidden phrase,
  // and the test says so rather than pretending the defect is the same shape.
  assert.ok(!issues.some((i) => FORBIDDEN_PHRASES.some((p) => i.includes(p))));
});

test("NEGATIVE CONTROL: every live node fails, and no live node passes as a different node's spec", () => {
  for (const live of [LIVE_BLOCKED_BEFORE_FIX, LIVE_ESCALATE_BEFORE_FIX, LIVE_UNRECOGNISED_BEFORE_FIX]) {
    assert.ok(terminalZendeskNodeIssues(live).length > 0, `${live.name} must be rejected`);
  }
  // Cross-checking a node against the wrong spec must also fail — the escalate
  // target has `status: open` and three tags, the blocked spec wants `pending`
  // and its own tag, so a mix-up in STRUCTURAL_MAPPINGS is loud rather than
  // silent.
  assert.ok(blockedNodeIssues(targetNode(ESCALATE_NODE_NAME)).length > 0);
  assert.ok(escalateNodeIssues(targetNode(BLOCKED_NODE_NAME)).length > 0);
});

// ---------------------------------------------------------------------------
// 4. Per-regression mutations — each one caught on its own
// ---------------------------------------------------------------------------

const mutate = (name, patch) => {
  const n = targetNode(name);
  n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
  return terminalZendeskNodeIssues(n, name);
};

test("the interpolation replaced by an inline sentence is caught, on all three", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const issues = mutate(name, { internalNote: "=AI summary — decision: blocked. Routed to a human." });
    assert.ok(
      issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)),
      `${name}: an inline note must be refused`
    );
  }
});

test("a forbidden phrase reintroduced ALONGSIDE a correct interpolation is still caught", () => {
  // The subtle regression: somebody keeps the interpolation and appends the old
  // sentence back "for context". The note is then both correct and false.
  const issues = mutate(BLOCKED_NODE_NAME, {
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nBlocked by the risk matrix or employer permission — not open to approval here.`,
  });
  assert.ok(!issues.some((i) => i.includes(INTERNAL_NOTE_INTERPOLATION)), "the interpolation itself is present");
  assert.ok(issues.some((i) => i.includes("blocked by the risk matrix")));

  const esc = mutate(ESCALATE_NODE_NAME, {
    internalNote: `${INTERNAL_NOTE_EXPRESSION}\n\nESCALATED to Mobility Legal Tier-2. Not open to 1-click approval here.`,
  });
  assert.ok(esc.some((i) => i.includes("mobility legal tier-2")));
  assert.ok(esc.some((i) => i.includes("not open to 1-click approval")));
});

test("a forbidden phrase hidden in ANOTHER updateFields field is still caught", () => {
  // The 2026-08-29 Zendesk migration's lesson: a field-by-field walk misses the
  // copy inside a string inside another field. The check reads the whole blob.
  const issues = mutate(BLOCKED_NODE_NAME, { tags: [BLOCKED_TAG, ROUTING_TAG_EXPRESSION, "one mobility specialist"] });
  assert.ok(issues.some((i) => i.includes("one mobility specialist")));
});

test("the routing sentence dropped from the expression is caught", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const issues = mutate(name, { internalNote: `=${INTERNAL_NOTE_INTERPOLATION}` });
    assert.ok(issues.some((i) => i.includes(ROUTING_NOTE_INTERPOLATION)), name);
  }
});

test("each tag dropped is caught, one at a time", () => {
  assert.ok(mutate(BLOCKED_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(BLOCKED_TAG)));
  assert.ok(mutate(BLOCKED_NODE_NAME, { tags: [BLOCKED_TAG] }).some((i) => i.includes("routingTag")));

  assert.ok(
    mutate(ESCALATE_NODE_NAME, { tags: [QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(ESCALATED_TAG))
  );
  assert.ok(
    mutate(ESCALATE_NODE_NAME, { tags: [ESCALATED_TAG, ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(QUEUE_TAG_EXPRESSION))
  );
  assert.ok(
    mutate(ESCALATE_NODE_NAME, { tags: [ESCALATED_TAG, QUEUE_TAG_EXPRESSION] }).some((i) => i.includes("routingTag"))
  );

  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { tags: [ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(EXCEPTION_TAG)));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { tags: [EXCEPTION_TAG] }).some((i) => i.includes("routingTag")));

  // And tags gone entirely, or not an array at all.
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(mutate(name, { tags: undefined }).length > 0, name);
    assert.ok(mutate(name, { tags: "uc04_blocked" }).length > 0, name);
  }
});

test("an EXTRA tag is not a regression — the loop guard must be addable without going red", () => {
  // `uc_processed` is argued for in flagAwaitingApprovalSpec.js and, if applied,
  // must be applied to all four terminal nodes. A checker that refused it would
  // make the safe change look like drift.
  for (const name of TERMINAL_NODE_NAMES) {
    const withGuard = [...TERMINAL_NODE_SPECS[name].parameters.updateFields.tags, "uc_processed"];
    assert.deepEqual(mutate(name, { tags: withGuard }), [], name);
  }
});

test("the group dropped is caught — otherwise the ticket lands in the default Support group", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(mutate(name, { group: undefined }).some((i) => i.includes("group")), name);
    assert.ok(mutate(name, { group: "={{ $json.zendeskGroupId }}" }).some((i) => i.includes("group")), name);
  }
});

test("the status flipped is caught, in both directions", () => {
  assert.ok(mutate(BLOCKED_NODE_NAME, { status: "open" }).some((i) => i.includes("status")));
  assert.ok(mutate(ESCALATE_NODE_NAME, { status: "pending" }).some((i) => i.includes("status")));
  assert.ok(mutate(UNRECOGNISED_NODE_NAME, { status: "solved" }).some((i) => i.includes("status")));
});

test("the ticket id repointed is caught", () => {
  for (const name of TERMINAL_NODE_NAMES) {
    const n = targetNode(name);
    n.parameters.id = "={{ $json.externalRef }}";
    assert.ok(terminalZendeskNodeIssues(n, name).some((i) => i.includes("parameters.id")), name);
  }
});

// ---------------------------------------------------------------------------
// 5. The interpolation names a field the gates node really emits
// ---------------------------------------------------------------------------

const gatesSource = readFileSync(join(NODES_DIR, "workationGates.js"), "utf8");

function runGates({ request, employmentResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName !== "Normalize Workation Request") throw new Error(`Unexpected $() lookup for "${nodeName}"`);
      return { first: () => ({ json: request }) };
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  // node:vm results are cross-realm; n8n round-trips between nodes too.
  return JSON.parse(JSON.stringify(result[0].json));
}

const employmentResponse = () => ({
  data: {
    employment: {
      id: "emp_active_001",
      status: "active",
      company_id: "co_amend_01",
      custom_fields: { workation_permission: true },
    },
  },
});

const baseRequest = {
  employmentId: "emp_active_001",
  session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
  externalRef: "4001",
  source: "webhook",
  now: "2026-08-15",
  travelHistory: [],
  factors: {
    homeCountry: "DE",
    nationality: "DE",
    destination: { country: "MX" },
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "work_permit",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  },
};

const requestFor = (over = {}) => ({ ...baseRequest, ...over, factors: { ...baseRequest.factors, ...(over.factors ?? {}) } });

const blockedRun = () =>
  runGates({
    request: requestFor({ factors: { homeCountry: "US", nationality: "US", visaType: "esta_usa", endDate: "2026-09-10" } }),
    employmentResponse: employmentResponse(),
  });

const escalateRun = () =>
  runGates({
    request: requestFor({
      factors: {
        destination: { country: "GB" },
        visaType: "business_visa",
        jobDuties: "executive",
        hasContractSigningAuthority: true,
        endDate: "2026-09-10",
      },
    }),
    employmentResponse: employmentResponse(),
  });

const factorsInvalidRun = () =>
  runGates({ request: requestFor({ factors: { visaType: "nonsense" } }), employmentResponse: employmentResponse() });

test("the interpolated field is one the gates body really emits, for every decision these nodes serve", () => {
  // THE FAILURE THIS CATCHES IS SILENT IN PRODUCTION. An expression that
  // dereferences a field nothing produces renders as an EMPTY STRING on a fully
  // green execution. The interpolation and the emitting field are asserted
  // against each other rather than each being asserted to look plausible.
  const field = INTERNAL_NOTE_INTERPOLATION.match(/item\.json\.(\w+)/)?.[1];
  assert.equal(field, "internalNote");
  for (const run of [blockedRun, escalateRun, factorsInvalidRun]) {
    const out = run();
    assert.equal(typeof out[field], "string");
    assert.ok(out[field].length > 200, `the composed note is empty or a stub for ${out.decision}/${out.reason}`);
  }
});

test("the composed note is stage-aware for exactly the decisions these three nodes carry", () => {
  const blk = blockedRun();
  assert.equal(blk.decision, "blocked");
  assert.match(blk.internalNote, /Neither stage 2 nor stage 3 is reached/);
  assert.match(blk.internalNote, /no approval here could override it/);

  const esc = escalateRun();
  assert.equal(esc.decision, "escalate");
  assert.match(esc.internalNote, /Neither stage 2 nor stage 3 is reached/);

  // The decision's own facts, so nothing the old hand-typed notes carried is
  // LOST by interpolating: the old blocked note printed reason + flags, and the
  // old unrecognised note printed the decision. All three are in the composed
  // note's Assessment line.
  assert.match(blk.internalNote, /Assessment: blocked \(visitor_visa_active_work_forbidden\)/);
  assert.match(blk.internalNote, /Flags: visitor_visa_blocks_remote_work/);
  assert.match(esc.internalNote, /Assessment: escalate \(high_risk_pair\)/);
});

test("the blocked note does not describe a form error as a decision on the merits", () => {
  // `factors_invalid` — the reason the retired sentence was most wrong about.
  const fi = factorsInvalidRun();
  assert.equal(fi.decision, "blocked");
  assert.equal(fi.reason, "factors_invalid");
  // THE EVIDENCE FOR THE HEADER'S CLAIM, taken from the body rather than
  // asserted about it: `risk` is literally null, so classifyRisk() never ran
  // and nothing was refused on merit. "Blocked by the risk matrix" is FALSE
  // here, and this is the reason the portal's own visa options produce.
  assert.equal(fi.risk, null, "classifyRisk() is never called for a form error");
  assert.match(fi.internalNote, /Assessment: blocked \(factors_invalid\)/);
  assert.match(fi.internalNote, /Risk-matrix level: unknown/);
});

// ---------------------------------------------------------------------------
// 6. The 12 blocked reasons, as data
// ---------------------------------------------------------------------------

test("BLOCKED_REASON_ACCURACY covers every reason the gates body can emit as blocked", () => {
  // Read out of the body rather than restated, so a new blocked reason added to
  // workationGates.js fails this test instead of quietly leaving the table
  // behind — the same reason `verify-traces` lifts TRACED_CALLS out of the
  // deployed body rather than keeping a local copy.
  const emitted = new Set([...gatesSource.matchAll(/reasons\.push\('([a-z0-9_]+)'\)/g)].map((m) => m[1]));
  emitted.add("employer_permission_not_granted");
  emitted.add("factors_invalid");
  const tabled = new Set(BLOCKED_REASON_ACCURACY.map((r) => r.reason));

  for (const reason of emitted) {
    assert.ok(tabled.has(reason), `BLOCKED_REASON_ACCURACY does not cover ${reason}`);
  }
  for (const reason of tabled) {
    assert.ok(emitted.has(reason), `BLOCKED_REASON_ACCURACY names ${reason}, which the gates body cannot emit`);
  }
  assert.equal(BLOCKED_REASON_ACCURACY.length, 12);
});

test("the retired sentence was accurate for a minority of them — the count the header claims", () => {
  const accurate = BLOCKED_REASON_ACCURACY.filter((r) => r.accurate);
  assert.equal(accurate.length, 5, "four risk-matrix refusals on merit, plus the employer-permission one");
  // The two the header calls out by name.
  assert.equal(BLOCKED_REASON_ACCURACY.find((r) => r.reason === "factors_invalid").accurate, false);
  assert.equal(BLOCKED_REASON_ACCURACY.find((r) => r.reason === "sanctioned_region").accurate, false);
  // Every row carries its evidence; a table of verdicts with no reasons is an
  // opinion.
  for (const row of BLOCKED_REASON_ACCURACY) {
    assert.ok(row.why && row.why.length > 20, `${row.reason} has no stated why`);
    assert.ok(row.source, `${row.reason} does not say where it comes from`);
  }
});

// ---------------------------------------------------------------------------
// 7. Ticket hygiene — this text goes on a real customer's ticket
// ---------------------------------------------------------------------------

test("none of the three target notes carries harness vocabulary", () => {
  // Same guard `npm run verify-ticket-hygiene` applies to the live queue, run
  // here on text that has not reached a ticket yet. A bead id or a criterion id
  // leaking into an internal note is the exact failure that check exists for.
  for (const name of TERMINAL_NODE_NAMES) {
    const uf = TERMINAL_NODE_SPECS[name].parameters.updateFields;
    assert.equal(findHarnessVocabulary(uf.internalNote), null, `${name}: harness vocabulary in the note expression`);
    for (const tag of uf.tags) {
      assert.equal(findHarnessVocabulary(tag), null, `${name}: harness vocabulary in tag ${tag}`);
    }
  }
});

test("neither does the note the gates body composes for these decisions", () => {
  for (const run of [blockedRun, escalateRun, factorsInvalidRun]) {
    const { internalNote } = run();
    assert.equal(findHarnessVocabulary(internalNote), null, `harness vocabulary in the composed note: ${internalNote}`);
  }
});

// ---------------------------------------------------------------------------
// 8. The deploy note and the spec cannot disagree
// ---------------------------------------------------------------------------

test("the deploy note carries exactly what it tells the operator to paste", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31-terminal-nodes.md"), "utf8");
  for (const name of TERMINAL_NODE_NAMES) {
    assert.ok(md.includes(name), `the deploy note does not mention ${name}`);
  }
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION), "the deploy note does not carry the note interpolation");
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(QUEUE_TAG_EXPRESSION), "the deploy note does not carry D-14's queue-tag expression");
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(TICKET_ID_EXPRESSION));
  for (const tag of [BLOCKED_TAG, ESCALATED_TAG, EXCEPTION_TAG]) {
    assert.ok(md.includes(tag), `the deploy note does not mention ${tag}`);
  }

  // The JSON blocks in the deploy note must BE the spec, not a retyping of it.
  // A paste-ready block that has drifted from the checker is worse than none:
  // an operator follows it and `verify-deployed` then reports the drift they
  // were told to create.
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 3, "expected one paste-ready JSON block per node");
  const wanted = TERMINAL_NODE_NAMES.map((n) => JSON.parse(JSON.stringify(TERMINAL_NODE_SPECS[n].parameters.updateFields)));
  assert.deepEqual(blocks, wanted);
});

// ---------------------------------------------------------------------------
// THE CROSS-SPEC PIN — two specs describe UC-04's escalate and unrecognised
// nodes, and neither may silently revert the other
// ---------------------------------------------------------------------------
// UC-04's `Escalate Workation Ticket` and `Unrecognised Workation Decision` are
// covered by TWO spec files, on purpose and along different dimensions:
//
//   this file                                  — the PROSE (internalNote), and
//                                                the per-decision marker tag
//   workflows/nodes/escalationQueueTagSpec.js  — the QUEUE TAG, across all
//                                                fourteen nodes on all nine
//                                                graphs that share the defect
//
// Splitting them is right: the queue-tag finding (rca-iih7) is a nine-graph
// problem and does not belong inside a UC-04 file, while the wrong-actor prose
// is UC-04's alone. The hazard is that BOTH files carry a full
// `targetParameters` block for these two nodes, because either can be used to
// deploy them — so a publish from the stale one reverts the other's fix. That
// is not hypothetical: when these two specs were written in parallel, this
// file's copy carried the corrected note and no queue tag on the unrecognised
// node, while the other's carried the queue tag and the PRE-correction note.
// Publishing either wholesale would have undone the other.
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
      (e) => e.workflowId === "WORKFLOW_UC04_ID" && e.node === nodeName
    );
    assert.ok(other, `escalationQueueTagSpec.js has no row for "${nodeName}" — the queue-tag fix would miss it`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(other.targetParameters.updateFields)),
      JSON.parse(JSON.stringify(params.updateFields)),
      `the two specs disagree about "${nodeName}". Deploying from either would revert the other; fix both, in one change.`
    );
  });
}

test("cross-spec: the queue tag is on escalate and unrecognised, and NOT on blocked", () => {
  // The asymmetry is measured, not assumed. isEscalation() returns true for a
  // missing/empty/non-string decision — which is what reaches the fallback
  // output — and false for 'blocked'. So the unrecognised node needs the tag
  // and the blocked node does not.
  assert.ok(ESCALATE_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(UNRECOGNISED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION));
  assert.ok(
    !BLOCKED_PARAMETERS.updateFields.tags.includes(QUEUE_TAG_EXPRESSION),
    "a blocked decision leaves escalated false, so routingTag already IS the queue tag"
  );
});
