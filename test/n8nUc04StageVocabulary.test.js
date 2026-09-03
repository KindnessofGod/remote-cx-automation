// ---------------------------------------------------------------------------
// n8nUc04StageVocabulary.test.js — UC-04's n8n graph must name the right
// decider for each of the three stages
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-04 has three deciders (docs/use-cases/UC-04.md §1a, corrected 2026-08-30):
// the employee files, THE CUSTOMER'S OWN MANAGER approves or declines in
// Remote's own product, and Remote's Mobility Team records its own review
// afterwards in the ZAF sidebar — a review Remote publishes no endpoint for, so
// it is recorded in this system and never transmitted.
//
// `docs/BUILD-LOG.md` §3.108 fixed three registers that still named a Remote
// mobility specialist as the person making the CUSTOMER'S decision
// (`src/approvalqueue/awaiting.js`, `src/approvalqueue/approvalRoutes.js`,
// `src/auditview/humanDecision.js`) and closed with "`workflows/nodes-uc04/`
// knows nothing about stage 3 — the n8n graph is untouched". This test is that
// gap closed, and it guards the thing that made it expensive: the wrong actor
// was named in PROSE, on a real customer's Zendesk ticket, and prose is exactly
// what `test/n8nUc04Parity.test.js` cannot see. That test compares DECISIONS —
// by design, and its own header says so — so a node that reaches the right
// verdict and describes it to the wrong person passes it every time.
//
// TWO THINGS ARE PINNED, AND THEY PULL IN OPPOSITE DIRECTIONS ON PURPOSE:
//   1. the DECISION vocabulary must NOT move (`ready_for_approval`,
//      `all_gates_passed`, `approvalRoute === "specialist_approval"`), because
//      it is a machine token compared against src/uc04/policyEngine.js;
//   2. the HUMAN-FACING vocabulary must name the customer's manager and
//      Remote's own product, and must never again claim a mobility specialist
//      approves this.
//
// HERMETIC. No n8n credentials, no network. The live node's parameters are held
// against a SNAPSHOT captured from the n8n API on 2026-08-31 (WORKFLOW_UC04_ID,
// versionId === activeVersionId === 50e33f3c-23bc-4e1c-b1d3-016751e57744), and
// the pre-fix copy of that snapshot is kept as the negative control — a
// detector that has never been shown failing is a detector nobody has tested.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import {
  FLAG_AWAITING_NODE_NAME,
  FLAG_AWAITING_NODE_TYPE,
  FLAG_AWAITING_PARAMETERS,
  INTERNAL_NOTE_INTERPOLATION,
  RECORD_ID_INTERPOLATION,
  ROUTING_NOTE_INTERPOLATION,
  ZENDESK_GROUP_EXPRESSION,
  ROUTING_TAG_EXPRESSION,
  OUTCOME_TAG,
  AWAITING_EMPLOYER_TAG,
  TICKET_STATUS,
  FORBIDDEN_PHRASES,
  flagAwaitingApprovalIssues,
} from "../workflows/nodes-uc04/flagAwaitingApprovalSpec.js";
import { findHarnessVocabulary } from "../src/zendesk/ticketHygiene.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = join(__dirname, "..", "workflows", "nodes-uc04");
const gatesSource = readFileSync(join(NODES_DIR, "workationGates.js"), "utf8");

// ---------------------------------------------------------------------------
// Running the real node body, same sandbox shape as test/n8nUc04Parity.test.js
// ---------------------------------------------------------------------------

function runGates({ request, employmentResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName !== "Normalize Workation Request") throw new Error(`Unexpected $() lookup for "${nodeName}"`);
      return { first: () => ({ json: request }) };
    },
    $input: { first: () => ({ json: employmentResponse }) },
  };
  const result = vm.runInNewContext(`(function () {\n${gatesSource}\n})()`, sandbox, { timeout: 5000 });
  // JSON round-trip: node:vm results are cross-realm, and n8n itself
  // round-trips between nodes.
  return JSON.parse(JSON.stringify(result[0].json));
}

const employmentResponse = (over = {}) => ({
  data: {
    employment: { id: "emp_active_001", status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true }, ...over },
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
    // DE -> MX with a work permit raises zero matrix flags, so this is the
    // clean `ready_for_approval` shape rather than one carrying advisory noise.
    destination: { country: "MX" },
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "work_permit",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
  },
};

const requestFor = (over = {}) => ({ ...baseRequest, ...over, factors: { ...baseRequest.factors, ...(over.factors ?? {}) } });

const readyRun = () => runGates({ request: requestFor(), employmentResponse: employmentResponse() });

const escalateRun = () =>
  runGates({
    request: requestFor({
      factors: { destination: { country: "GB" }, visaType: "business_visa", jobDuties: "executive", hasContractSigningAuthority: true, endDate: "2026-09-10" },
    }),
    employmentResponse: employmentResponse(),
  });

const blockedRun = () =>
  runGates({
    request: requestFor({
      factors: { homeCountry: "US", nationality: "US", visaType: "esta_usa", endDate: "2026-09-10" },
    }),
    employmentResponse: employmentResponse(),
  });

// ---------------------------------------------------------------------------
// 1. The decision vocabulary did NOT move
// ---------------------------------------------------------------------------

test("the decision vocabulary is untouched — only the prose changed", () => {
  const out = readyRun();
  assert.equal(out.decision, "ready_for_approval");
  assert.equal(out.reason, "all_gates_passed");
  assert.deepEqual(out.flags, []);
  assert.equal(out.riskTier, "medium");
  // THE TOKEN STAYS. It is a machine value, it is never rendered, it is
  // persisted by no node on this graph, and src/uc04/workflow.js emits the
  // identical string — renaming it here would make the two copies of one
  // decision disagree about a field while changing nothing a human reads.
  assert.equal(out.approvalRoute, "specialist_approval");
});

// ---------------------------------------------------------------------------
// 2. The summary names the right decider
// ---------------------------------------------------------------------------

test("the ready_for_approval summary names the customer's own manager and Remote's product", () => {
  const { summary } = readyRun();
  assert.match(summary, /the customer's own manager/);
  assert.match(summary, /Remote's own product/);
  assert.match(summary, /\/remoteui work-authorizations/);
  // The half a reader most needs and is least likely to infer.
  assert.match(summary, /no Zendesk agent can make it/);
  // Stage 3 named, and named as recorded-not-transmitted.
  assert.match(summary, /Remote's Mobility Team/);
  assert.match(summary, /never sent to Remote/);
});

test("the summary never again claims a mobility specialist approves this", () => {
  for (const run of [readyRun, escalateRun, blockedRun]) {
    const { summary, internalNote } = run();
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(
        !summary.toLowerCase().includes(phrase.toLowerCase()),
        `summary still contains ${JSON.stringify(phrase)}: ${summary}`
      );
      assert.ok(
        !internalNote.toLowerCase().includes(phrase.toLowerCase()),
        `internalNote still contains ${JSON.stringify(phrase)}`
      );
    }
  }
});

test("the summary is byte-stable — deterministic template, never an LLM call", () => {
  assert.equal(readyRun().summary, readyRun().summary);
  assert.equal(readyRun().internalNote, readyRun().internalNote);
});

// ---------------------------------------------------------------------------
// 3. `awaitingDecision` — who this is waiting on, as data
// ---------------------------------------------------------------------------

test("awaitingDecision names stage 2 and says the decision is not taken in Zendesk", () => {
  const a = readyRun().awaitingDecision;
  assert.equal(a.stage, 2);
  assert.match(a.actor, /customer's own manager/);
  assert.match(a.surface, /remoteui/);
  assert.equal(a.decidedInZendesk, false, "stage 2 is the customer's, made in Remote's product");
  assert.equal(a.writesToRemote, true, "stage 2 is the one work-authorization write Remote's API accepts");
});

test("awaitingDecision does not claim stage 2 for a decision that never reaches it", () => {
  const esc = escalateRun().awaitingDecision;
  assert.equal(esc.stage, null);
  assert.equal(esc.decidedInZendesk, true, "an escalation IS worked in Zendesk, by Mobility Legal Tier-2");
  assert.equal(esc.writesToRemote, false);

  const blk = blockedRun().awaitingDecision;
  assert.equal(blk.stage, null);
  assert.equal(blk.writesToRemote, false);
  assert.match(blk.actor, /nobody/, "a blocked request is a hard stop nobody approves");
});

// ---------------------------------------------------------------------------
// 4. The composed internal note — the prepared case
// ---------------------------------------------------------------------------

test("the internal note prepares the case and decides nothing", () => {
  const { internalNote } = readyRun();
  assert.match(internalNote, /PREPARED this case and decided nothing/);
  // All three stages, in order, each with its actor.
  assert.match(internalNote, /1 · The employee files the request/);
  assert.match(internalNote, /2 · The customer's own manager approves or declines it/);
  assert.match(internalNote, /3 · Remote's Mobility Team then records its own review/);
  // Remote's API fact, stated as a fact about REMOTE and not about our
  // permissions — see src/remoteui/workAuthPolicy.js's STAGE_3_NOTE.
  assert.match(internalNote, /approved_by_manager and declined_by_manager/);
  assert.match(internalNote, /Remote publishes no endpoint for that stage/);
  assert.match(internalNote, /never sent to Remote/);
  // The verbs, kept apart.
  assert.match(internalNote, /clear \/ decline, never approve/);
  // It POINTS at the prepared case rather than reproducing it — the four
  // dimensions and the gate ladder are src/uc04/decisionFacts.js's, and a
  // second copy in a Code node would be kept in step by nothing.
  assert.match(internalNote, /the four dimensions, the risk posture and the gate ladder/);
  assert.match(internalNote, /Remote CX Review sidebar/);
});

test("the note carries the decision's own facts, not a template with blanks", () => {
  const ready = readyRun();
  assert.match(ready.internalNote, /Assessment: ready_for_approval \(all_gates_passed\)\. Risk-matrix level: low\. Flags: none\./);

  const esc = escalateRun();
  assert.equal(esc.decision, "escalate");
  assert.match(esc.internalNote, /Assessment: escalate \(high_risk_pair\)\. Risk-matrix level: high\. Flags: pe_risk_dape\./);
  // An escalation must not tell anyone the employer is being asked for
  // something — nobody has been.
  assert.match(esc.internalNote, /Neither stage 2 nor stage 3 is reached/);

  const blk = blockedRun();
  assert.equal(blk.decision, "blocked");
  assert.match(blk.internalNote, /no approval here could override it/);
  assert.match(blk.internalNote, /Neither stage 2 nor stage 3 is reached/);
});

test("the note carries no harness vocabulary — it goes on a real customer's ticket", () => {
  // Same guard `npm run verify-ticket-hygiene` applies to the live queue, run
  // here on text that has not reached a ticket yet. A bead id or a criterion id
  // leaking into a customer-visible internal note is the exact failure that
  // check exists for; catching it before deploy costs nothing.
  for (const run of [readyRun, escalateRun, blockedRun]) {
    const { internalNote, summary } = run();
    assert.equal(findHarnessVocabulary(internalNote), null, `harness vocabulary in the internal note: ${internalNote}`);
    assert.equal(findHarnessVocabulary(summary), null, `harness vocabulary in the summary: ${summary}`);
  }
});

// ---------------------------------------------------------------------------
// 5. The Zendesk node's spec, and the dead-reference class it guards
// ---------------------------------------------------------------------------

test("the note expression names a field the gates node really emits", () => {
  // THE FAILURE THIS CATCHES IS SILENT IN PRODUCTION. An n8n expression that
  // dereferences a field nothing produces renders as an EMPTY STRING on a fully
  // green execution — the same shape as `verify-traces`'s dead-probe-name check
  // (§7 item 6) and as the 401 that reported success because the header was
  // present but empty. The interpolation and the emitting field are asserted
  // against each other rather than each being asserted to look plausible.
  const field = INTERNAL_NOTE_INTERPOLATION.match(/item\.json\.(\w+)/)?.[1];
  assert.equal(field, "internalNote");
  const out = readyRun();
  assert.equal(typeof out[field], "string");
  assert.ok(out[field].length > 200, "the composed note is not an empty or stub string");
});

test("the parameters JSON file and the spec constant cannot drift", () => {
  const onDisk = JSON.parse(readFileSync(join(NODES_DIR, "flagAwaitingApproval.parameters.json"), "utf8"));
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(FLAG_AWAITING_PARAMETERS)));
});

/** The target node, as it must look after the deploy in DEPLOY-2026-08-31.md. */
const targetNode = () => ({
  name: FLAG_AWAITING_NODE_NAME,
  type: FLAG_AWAITING_NODE_TYPE,
  parameters: JSON.parse(JSON.stringify(FLAG_AWAITING_PARAMETERS)),
});

/**
 * THE LIVE NODE AS IT STANDS, captured from
 * `GET /api/v1/workflows/WORKFLOW_UC04_ID` on 2026-08-31, verbatim. This is the
 * NEGATIVE CONTROL: the checker must reject it, and must reject it for the
 * right reasons, or it is a checker that would have reported the defect clean.
 */
const LIVE_NODE_BEFORE_FIX = {
  name: "Flag Awaiting Specialist Approval",
  type: "n8n-nodes-base.zendesk",
  parameters: {
    authentication: "oAuth2",
    operation: "update",
    id: "={{ $('Workation Gates').item.json.externalRef }}",
    updateFields: {
      group: "={{ $('Assign Routing').item.json.zendeskGroupId }}",
      internalNote:
        "=AI drafted workation authorization {{ $('Create Authorization Record').item.json.id }} — awaiting ONE mobility specialist's approval. {{ $('Workation Gates').item.json.summary }} Flags: {{ $('Workation Gates').item.json.flags.join(\", \") || \"none\" }}. {{ $('Assign Routing').item.json.routingNote }}",
      status: "pending",
      tags: ["uc04_ready_for_approval", "={{ $('Assign Routing').item.json.routingTag }}"],
    },
  },
};

test("the target parameters pass the checker", () => {
  assert.deepEqual(flagAwaitingApprovalIssues(targetNode()), []);
});

test("NEGATIVE CONTROL: the checker rejects the node as it is deployed today", () => {
  const issues = flagAwaitingApprovalIssues(LIVE_NODE_BEFORE_FIX);
  assert.ok(issues.length >= 3, `expected the live node to fail on several counts, got: ${JSON.stringify(issues)}`);
  assert.ok(
    issues.some((i) => i.includes("internalNote")),
    "the hand-typed inline note must be flagged"
  );
  assert.ok(
    issues.some((i) => i.includes("one mobility specialist")),
    "the false claim about who approves must be flagged by name"
  );
  assert.ok(
    issues.some((i) => i.includes(AWAITING_EMPLOYER_TAG)),
    "the missing who-is-it-waiting-on tag must be flagged"
  );
});

test("NEGATIVE CONTROL: each single regression is caught on its own", () => {
  const mutate = (patch) => {
    const n = targetNode();
    n.parameters.updateFields = { ...n.parameters.updateFields, ...patch };
    return flagAwaitingApprovalIssues(n);
  };

  // The interpolation replaced by an inline sentence — the exact state the
  // node was in, and the one no existing check could see.
  assert.ok(mutate({ internalNote: "=Awaiting one mobility specialist's approval." }).length >= 2);
  // The interpolation kept but a stale phrase reintroduced alongside it.
  assert.ok(
    mutate({ internalNote: `=${INTERNAL_NOTE_INTERPOLATION} Awaiting specialist approval.` }).some((i) =>
      i.includes("awaiting specialist approval")
    )
  );
  // Tags dropped, one at a time.
  assert.ok(mutate({ tags: [AWAITING_EMPLOYER_TAG, ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(OUTCOME_TAG)));
  assert.ok(mutate({ tags: [OUTCOME_TAG, ROUTING_TAG_EXPRESSION] }).some((i) => i.includes(AWAITING_EMPLOYER_TAG)));
  assert.ok(mutate({ tags: [OUTCOME_TAG, AWAITING_EMPLOYER_TAG] }).some((i) => i.includes("routingTag")));
  // Group assignment dropped — the §7 items 7–8 failure: a correct hand-off
  // that lands in the account's default group and reaches nobody's queue.
  assert.ok(mutate({ group: undefined }).some((i) => i.includes("group")));
  // Status flipped to "open" — "pending" is Zendesk's "waiting on somebody who
  // is not us", which is exactly what a stage-2 request is.
  assert.ok(mutate({ status: "open" }).some((i) => i.includes("status")));
  // And a node that is entirely absent must not read as clean.
  assert.ok(flagAwaitingApprovalIssues(undefined).length > 0);
});

test("the deploy note and the spec agree on the tag set", () => {
  const md = readFileSync(join(NODES_DIR, "DEPLOY-2026-08-31.md"), "utf8");
  for (const tag of [OUTCOME_TAG, AWAITING_EMPLOYER_TAG]) {
    assert.ok(md.includes(tag), `DEPLOY-2026-08-31.md does not mention ${tag}`);
  }
  assert.ok(md.includes(INTERNAL_NOTE_INTERPOLATION), "the deploy note does not carry the expression it tells the operator to paste");
  assert.ok(md.includes(RECORD_ID_INTERPOLATION));
  assert.ok(md.includes(ROUTING_NOTE_INTERPOLATION));
  assert.ok(md.includes(ZENDESK_GROUP_EXPRESSION));
  assert.ok(md.includes(`\`${TICKET_STATUS}\``));
});

// ---------------------------------------------------------------------------
// THE WIRING ITSELF — because a checker nothing calls is a checker that passes
// ---------------------------------------------------------------------------
// Everything above proves `flagAwaitingApprovalIssues()` can tell a good node
// from a bad one. None of it proves anything RUNS it against the deployment.
// For the whole of 2026-08-31 that was the actual state: the detector existed,
// was tested, caught all four defects on the live node — and
// `npm run verify-deployed` never called it, because the node had no
// STRUCTURAL_MAPPINGS row and sat in unguarded-node-baseline.json as accepted
// debt. "0 drifted" stayed true and stayed meaningless, which is the exact
// failure scripts/lib/nodeCoverage.mjs was written for.
//
// These three tests hold the wiring. They import the mapping tables from
// deployedNodeMappings.mjs, which is side-effect-free and does NOT fetch n8n —
// the same import test/claimNodeContract.test.js and test/traceNodeContract.js
// already rely on, so this stays hermetic.

const { STRUCTURAL_MAPPINGS } = await import("../scripts/lib/deployedNodeMappings.mjs");
const baseline = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../scripts/lib/unguarded-node-baseline.json"), "utf8")
);

test("verify-deployed has a STRUCTURAL_MAPPINGS row for this node", () => {
  const row = STRUCTURAL_MAPPINGS.find(
    (m) => m.workflowId === "WORKFLOW_UC04_ID" && m.node === FLAG_AWAITING_NODE_NAME
  );
  assert.ok(row, `no STRUCTURAL_MAPPINGS row for ${FLAG_AWAITING_NODE_NAME} — the live node is guarded by nothing`);
  assert.equal(row.type, FLAG_AWAITING_NODE_TYPE);
  assert.equal(row.specFile, "workflows/nodes-uc04/flagAwaitingApprovalSpec.js");
  // The row must carry THE REAL CHECKER, not a placeholder that returns [].
  // Asserted by running it, not by comparing function identity: a row wired to
  // some other function that happens to be named the same would pass identity
  // and fail this.
  assert.equal(typeof row.checkParams, "function");
  assert.deepEqual(row.checkParams(targetNode()), []);
  assert.ok(
    row.checkParams(LIVE_NODE_BEFORE_FIX).length >= 3,
    "the row's checkParams does not reject the known-bad node — it is not the real checker"
  );
});

test("the node is no longer baselined as accepted-unguarded debt", () => {
  // ratchetViolations() keys off the LIVE unchecked set, so a leftover baseline
  // entry is harmless residue rather than an error — which is precisely why it
  // has to be asserted here instead. A stale entry would silently re-accept the
  // node as debt the moment the STRUCTURAL_MAPPINGS row above were removed,
  // turning the ratchet's "new unguarded node" alarm off for the one node this
  // whole file exists to guard.
  const stale = baseline.find((e) => e.workflowId === "WORKFLOW_UC04_ID" && e.node === FLAG_AWAITING_NODE_NAME);
  assert.equal(
    stale,
    undefined,
    "Flag Awaiting Specialist Approval is still in unguarded-node-baseline.json; remove it, or the coverage ratchet will not notice if its STRUCTURAL_MAPPINGS row is ever dropped"
  );
});

test("the row pins the ready_for_approval branch, and pins the node terminal", () => {
  const row = STRUCTURAL_MAPPINGS.find(
    (m) => m.workflowId === "WORKFLOW_UC04_ID" && m.node === FLAG_AWAITING_NODE_NAME
  );
  // Output 0 of "Route by Decision" IS the ready_for_approval branch (read live
  // from WORKFLOW_UC04_ID on 2026-08-31: rules are 0:ready_for_approval,
  // 1:blocked, 2:escalate, fallback:unrecognised). structuralNodeIssues()'s
  // expectedInputs check reads main[0] specifically, so this assertion is what
  // stops the awaiting-your-manager note being wired to a BLOCKED trip.
  assert.deepEqual(row.expectedInputs, ["Route by Decision"]);
  // Terminal. A node downstream of a customer-facing Zendesk write has to be
  // declared here rather than appearing quietly.
  assert.deepEqual(row.expectedOutputs, []);
});

test("the graph names the escalation group as the ACCOUNT spells it, everywhere", () => {
  // FOUND ON A REAL TICKET (79, execution driven 2026-08-31). The internal note
  // named the team THREE times in TWO spellings: the summary sentence and the
  // appended routing sentence said `Mobility & Legal (Tier-2)` — the live group
  // name, id 99900000000009 — while composeInternalNote()'s own stage-2 line
  // said `Mobility Legal Tier-2`, which is not a group name anywhere in the
  // account. A specialist searching the string the ticket handed them finds
  // nothing under it. docs/ESCALATION-DESTINATIONS.md §2.2 has been recording
  // this class ("one team, four spellings, none of them the group's name")
  // since before this node existed.
  //
  // Asserted on the FILE, comments and all, deliberately: the wrong spelling is
  // allowed to survive in a comment explaining why it is wrong, so this checks
  // the executable lines only.
  const body = readFileSync(join(NODES_DIR, "workationGates.js"), "utf8");
  const offenders = body
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => line.includes("Mobility Legal Tier-2") && !line.trimStart().startsWith("//"));
  assert.deepEqual(
    offenders,
    [],
    `these executable lines still carry a group name that does not exist:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`
  );
  // And the positive half — the correct spelling must actually be there, or an
  // over-eager deletion would pass the check above by naming no team at all.
  assert.ok(body.includes("Mobility & Legal (Tier-2)"), "the graph no longer names the escalation team at all");
});
