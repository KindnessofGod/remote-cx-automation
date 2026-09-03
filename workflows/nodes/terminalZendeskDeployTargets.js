// ---------------------------------------------------------------------------
// terminalZendeskDeployTargets.js — ONE table pairing every terminal Zendesk
// node on the nine graphs with the spec that owns its parameters and the
// checker(s) that must pass after it is published
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// By 2026-08-31 the terminal Zendesk nodes were owned by NINE spec files:
// seven per-use-case `terminalZendeskNodesSpec.js`, plus
// `escalationQueueTagSpec.js` (rca-iih7 / D-14, fourteen nodes across eight
// graphs) and `replyOutOfScopeSpec.js`. Two consumers need the same pairing —
// `scripts/deploy-terminal-nodes.mjs`, which publishes the parameters, and
// `scripts/lib/deployedNodeMappings.mjs`, which checks them on the live graph.
// Written out twice, those two lists drift, and a node that falls out of one
// of them is a node that is deployed but unchecked or checked but never
// deployed. Both failures are silent.
//
// THE ORTHOGONALITY THIS ENCODES, because it is the whole reason two specs can
// name one node without either being redundant:
//
//   - a per-use-case `terminalZendeskNodesSpec.js` owns the node's PROSE
//     (`internalNote`, `publicReply`) and its status/group/id expressions;
//   - `escalationQueueTagSpec.js` owns ONE dimension of `updateFields.tags`
//     on the fourteen escalate/unrecognised nodes, and deliberately inspects
//     nothing else (see its `escalationQueueTagIssues()` header).
//
// So a node covered by both gets ONE parameters object — the per-use-case
// spec's, which is the fuller one — and BOTH checkers run against the graph
// after the read-back. That is stricter than picking a winner and it cannot
// silently revert either: `assertQueueTagPreserved()` below fails at import
// time if a per-use-case spec's own parameters ever stop satisfying D-14.
//
// WHAT IS NOT HERE, and why:
//   - UC-01's `Escalate Ticket` / `Unrecognised Decision` / `Reply + Close`,
//     owned by `escalationCloseNodesSpec.js` and already wired into
//     STRUCTURAL_MAPPINGS on their own rows. They were fixed first and are the
//     reason D-14 was found; folding them in now would churn a working row.
//   - UC-04's `Flag Awaiting Specialist Approval`, owned by
//     `flagAwaitingApprovalSpec.js`. It is not a decision-branch terminal node
//     in the sense the per-use-case specs use, and it carries the only
//     `expectedInputs` assertion that predates this file.
//   - UC-08's terminal PROSE. `Escalate Tax Inquiry Ticket` appears below with
//     D-14 parameters only: it is the one node of the twenty-six whose
//     sentence has NOT been audited against its use case's contract. Recorded
//     as an open gap rather than implied to be covered.
// ---------------------------------------------------------------------------

import * as UC02 from "../nodes-uc02/terminalZendeskNodesSpec.js";
import * as UC03 from "../nodes-uc03/terminalZendeskNodesSpec.js";
import * as UC04 from "../nodes-uc04/terminalZendeskNodesSpec.js";
import * as UC05 from "../nodes-uc05/terminalZendeskNodesSpec.js";
import * as UC06 from "../nodes-uc06/terminalZendeskNodesSpec.js";
import * as UC07 from "../nodes-uc07/terminalZendeskNodesSpec.js";
import * as UC09 from "../nodes-uc09/terminalZendeskNodesSpec.js";
import {
  ESCALATION_QUEUE_TAG_NODES,
  escalationQueueTagIssues,
  ZENDESK_NODE_TYPE,
} from "./escalationQueueTagSpec.js";
import {
  REPLY_OUT_OF_SCOPE_NODE_NAME,
  REPLY_OUT_OF_SCOPE_NODE_TYPE,
  REPLY_OUT_OF_SCOPE_PARAMETERS,
  replyOutOfScopeIssues,
  UC01_WORKFLOW_ID,
} from "./replyOutOfScopeSpec.js";

/**
 * The seven use cases whose terminal Zendesk prose is versioned in a spec file.
 *
 * `workflowId` is read off each spec's own `UC0N_WORKFLOW_ID` export rather
 * than restated here — a second copy of a workflow id is how a deploy lands on
 * the wrong graph, and this repo has already published to the wrong place once
 * by trusting a restated identifier (CLAUDE.md §4's field-id migration).
 */
const PER_USE_CASE = [
  { useCase: "UC-02", workflow: "UC-02 — Expense & Receipt Validation", spec: UC02, workflowId: UC02.UC02_WORKFLOW_ID, specFile: "workflows/nodes-uc02/terminalZendeskNodesSpec.js" },
  { useCase: "UC-03", workflow: "UC-03 — Travel Support Letter / Workation Router", spec: UC03, workflowId: UC03.UC03_WORKFLOW_ID, specFile: "workflows/nodes-uc03/terminalZendeskNodesSpec.js" },
  { useCase: "UC-04", workflow: "UC-04 — Work Authorization / Workation", spec: UC04, workflowId: UC04.UC04_WORKFLOW_ID, specFile: "workflows/nodes-uc04/terminalZendeskNodesSpec.js" },
  { useCase: "UC-05", workflow: "UC-05 — Resignation Notice Calculation", spec: UC05, workflowId: UC05.UC05_WORKFLOW_ID, specFile: "workflows/nodes-uc05/terminalZendeskNodesSpec.js" },
  { useCase: "UC-06", workflow: "UC-06 — Contract Amendment / Payroll Cutoff", spec: UC06, workflowId: UC06.UC06_WORKFLOW_ID, specFile: "workflows/nodes-uc06/terminalZendeskNodesSpec.js" },
  { useCase: "UC-07", workflow: "UC-07 — Global Mobility / Permanent Relocation", spec: UC07, workflowId: UC07.UC07_WORKFLOW_ID, specFile: "workflows/nodes-uc07/terminalZendeskNodesSpec.js" },
  { useCase: "UC-09", workflow: "UC-09 — Off-Cycle Payroll Adjustment", spec: UC09, workflowId: UC09.UC09_WORKFLOW_ID, specFile: "workflows/nodes-uc09/terminalZendeskNodesSpec.js" },
];

/**
 * The upstream node feeding each terminal node — FOR THE EIGHT THAT SIT ON
 * OUTPUT INDEX ZERO, AND ONLY THOSE.
 *
 * THIS IS A LIMITATION OF THE CHECKER, NOT A CHOICE ABOUT WHAT IS WORTH
 * ASSERTING, and getting it wrong has already cost a red `verify-deployed` run
 * on a correctly-wired graph. `structuralNodeIssues()`'s `expectedInputs` reads
 * `connections[upstream].main[0]` — output index ZERO only. A node hanging off
 * `Route by Decision`'s output 1, 2, 3 or the fallback is therefore reported
 * as unconnected by a check that is itself wrong, which is how the first
 * version of UC-04's `Flag Blocked Workation` row failed a healthy graph.
 *
 * Every entry below was READ OFF THE LIVE GRAPH on 2026-08-31 and is stated
 * here rather than derived from it — a value copied out of the thing it checks
 * is not a check. The remaining eighteen nodes get no `expectedInputs` at all,
 * so WHICH BRANCH FEEDS WHICH TERMINAL NODE IS STILL CHECKED BY NOTHING for
 * them: a `Route by Decision` rule reorder that pointed the blocked note at an
 * escalated trip would be silent. Closing that needs an output-index parameter
 * on `expectedInputs`, or a per-use-case route spec (`routeByDecisionSpec.js`'s
 * RULES are UC-01's seven decisions; UC-02 emits four, UC-04 three). Named as
 * the residual gap rather than left for the next reader to rediscover by
 * making the same wrong assertion.
 *
 * @type {Readonly<Record<string, string>>}
 */
const OUTPUT_ZERO_UPSTREAM = Object.freeze({
  [`${UC02.UC02_WORKFLOW_ID}|${UC02.RESOLVE_NODE_NAME}`]: "Carry Context After Approve",
  [`${UC03.UC03_WORKFLOW_ID}|${UC03.REPLY_NODE_NAME}`]: UC03.RENDER_NODE_NAME,
  [`${UC05.UC05_WORKFLOW_ID}|${UC05.SIGNOFF_NODE_NAME}`]: "Route by Decision",
  [`${UC06.UC06_WORKFLOW_ID}|${UC06.APPROVAL_NODE_NAME}`]: "Route by Decision",
  [`${UC07.UC07_WORKFLOW_ID}|${UC07.ESCALATE_NODE_NAME}`]: "Assign Routing",
  [`${UC09.UC09_WORKFLOW_ID}|${UC09.DUAL_NODE_NAME}`]: "Route by Decision",
  ["WORKFLOW_UC08_ID|Escalate Tax Inquiry Ticket"]: "Assign Routing",
  [`${UC01_WORKFLOW_ID}|${REPLY_OUT_OF_SCOPE_NODE_NAME}`]: "Write Out-of-Scope Trace",
});

/** `workflowId|node` for each of the fourteen nodes escalationQueueTagSpec owns. */
const D14_BY_KEY = new Map(ESCALATION_QUEUE_TAG_NODES.map((e) => [`${e.workflowId}|${e.node}`, e]));

/**
 * Runs several checkers over one live node and concatenates their issues.
 *
 * Concatenation rather than short-circuit on purpose: a node can be wrong in
 * the prose dimension AND the tag dimension at once, and reporting only the
 * first turns one deploy into two.
 *
 * @param {Array<(node: object) => string[]>} checks
 * @returns {(node: object) => string[]}
 */
function composeChecks(checks) {
  return (node) => checks.flatMap((check) => check(node));
}

const targets = [];

for (const entry of PER_USE_CASE) {
  const { spec } = entry;
  for (const node of spec.TERMINAL_NODE_NAMES) {
    const key = `${entry.workflowId}|${node}`;
    const checks = [(live) => spec.terminalZendeskNodeIssues(live, node)];
    if (D14_BY_KEY.has(key)) checks.push(escalationQueueTagIssues);
    targets.push({
      useCase: entry.useCase,
      workflow: entry.workflow,
      workflowId: entry.workflowId,
      node,
      type: spec.TERMINAL_NODE_TYPE,
      specFile: D14_BY_KEY.has(key)
        ? `${entry.specFile} + workflows/nodes/escalationQueueTagSpec.js`
        : entry.specFile,
      parameters: spec.TERMINAL_NODE_SPECS[node].parameters,
      check: composeChecks(checks),
      expectedInputs: OUTPUT_ZERO_UPSTREAM[key] ? [OUTPUT_ZERO_UPSTREAM[key]] : undefined,
    });
  }
}

// UC-08's escalate node — the one D-14 node with no per-use-case prose spec.
// Its parameters come from escalationQueueTagSpec's live capture with the queue
// tag inserted, so publishing it changes TAGS AND NOTHING ELSE. Its
// `internalNote` is the hand-typed sentence it has always carried, unaudited.
for (const e of ESCALATION_QUEUE_TAG_NODES) {
  const key = `${e.workflowId}|${e.node}`;
  if (targets.some((t) => `${t.workflowId}|${t.node}` === key)) continue;
  targets.push({
    useCase: e.useCase,
    workflow: e.workflow,
    workflowId: e.workflowId,
    node: e.node,
    type: ZENDESK_NODE_TYPE,
    specFile: "workflows/nodes/escalationQueueTagSpec.js",
    parameters: e.targetParameters,
    check: escalationQueueTagIssues,
    expectedInputs: OUTPUT_ZERO_UPSTREAM[key] ? [OUTPUT_ZERO_UPSTREAM[key]] : undefined,
    proseUnaudited: true,
  });
}

// UC-01's `Reply Out of Scope` — the customer-facing node the 2026-08-31 audit
// found telling a real requester their question was "out of scope" in the
// automation's own vocabulary.
targets.push({
  useCase: "UC-01",
  workflow: "UC-01 — Employment Verification",
  workflowId: UC01_WORKFLOW_ID,
  node: REPLY_OUT_OF_SCOPE_NODE_NAME,
  type: REPLY_OUT_OF_SCOPE_NODE_TYPE,
  specFile: "workflows/nodes/replyOutOfScopeSpec.js",
  parameters: REPLY_OUT_OF_SCOPE_PARAMETERS,
  check: replyOutOfScopeIssues,
  expectedInputs: [OUTPUT_ZERO_UPSTREAM[`${UC01_WORKFLOW_ID}|${REPLY_OUT_OF_SCOPE_NODE_NAME}`]],
});

/**
 * THE ANTI-REVERT ASSERTION, run at import time rather than only in a test.
 *
 * Thirteen of the fourteen D-14 nodes now take their parameters from a
 * per-use-case spec. If a prose edit there ever drops the queue-tag expression,
 * publishing it would REVERT rca-iih7 on that node — the exact failure the
 * per-use-case specs' own headers warn about in the other direction. A test
 * would catch it; a test that nobody runs before a deploy would not. This
 * throws on import, so `scripts/deploy-terminal-nodes.mjs` cannot even start.
 */
for (const t of targets) {
  const key = `${t.workflowId}|${t.node}`;
  if (!D14_BY_KEY.has(key)) continue;
  const issues = escalationQueueTagIssues({ name: t.node, type: t.type, parameters: t.parameters });
  if (issues.length > 0) {
    throw new Error(
      `${t.specFile} would REVERT rca-iih7 / D-14 on ${key}: ${issues.join("; ")}`
    );
  }
}

/** @type {ReadonlyArray<object>} every terminal Zendesk node, its parameters and its checker(s). */
export const TERMINAL_ZENDESK_TARGETS = Object.freeze(targets.map((t) => Object.freeze(t)));

/**
 * Deploy rows for `scripts/deploy-terminal-nodes.mjs`.
 * @returns {Array<{workflowId: string, node: string, parameters: object, check: (node: object) => string[]}>}
 */
export function collectDeployTargets() {
  return TERMINAL_ZENDESK_TARGETS.map(({ workflowId, node, parameters, check }) => ({
    workflowId,
    node,
    parameters,
    check,
  }));
}

/**
 * Rows for `STRUCTURAL_MAPPINGS` in scripts/lib/deployedNodeMappings.mjs.
 *
 * `expectedOutputs: []` on every row pins each node TERMINAL. That is a real
 * assertion and not boilerplate: a node wired downstream of a customer-facing
 * Zendesk write is a change that should have to be declared, and on UC-02's
 * `Resolve Expense Ticket` — the one node in this table that moves money and
 * replies publicly — anything appended after it runs on a ticket the customer
 * has already been told is settled.
 *
 * @returns {Array<object>}
 */
export function structuralMappingRows() {
  return TERMINAL_ZENDESK_TARGETS.map((t) => {
    const row = {
      workflowId: t.workflowId,
      workflow: t.workflow,
      node: t.node,
      type: t.type,
      specFile: t.specFile,
      checkParams: t.check,
      expectedOutputs: [],
    };
    if (t.expectedInputs) row.expectedInputs = t.expectedInputs;
    return row;
  });
}
