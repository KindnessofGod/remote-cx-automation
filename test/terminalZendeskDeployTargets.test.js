// ---------------------------------------------------------------------------
// terminalZendeskDeployTargets.test.js — the COMPLETENESS guard on the one
// table that both publishes and checks every terminal Zendesk node
// ---------------------------------------------------------------------------
// WHAT THIS PROTECTS, and it is not the contents of any one node's prose (each
// per-use-case spec has its own test for that). It is the PAIRING:
//
//   scripts/deploy-terminal-nodes.mjs  publishes from TERMINAL_ZENDESK_TARGETS
//   scripts/lib/deployedNodeMappings.mjs  checks from structuralMappingRows()
//
// A node that falls out of the table is deployed by nothing AND checked by
// nothing, and both failures are silent — which is exactly how the fourteen
// D-14 nodes survived after UC-01's was fixed: the fix was real, and no list
// said the other eight graphs had the same node. So the assertions below are
// derived from the SPECS THEMSELVES (`TERMINAL_NODE_NAMES`,
// `ESCALATION_QUEUE_TAG_NODES`) rather than from a count typed in here. A test
// that restates a number cannot tell coverage going up from coverage going
// down — `portalCopy.test.js` asserted `7` request types and could not see that
// UC-01's card had never had any (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TERMINAL_ZENDESK_TARGETS,
  collectDeployTargets,
  structuralMappingRows,
} from "../workflows/nodes/terminalZendeskDeployTargets.js";
import { ESCALATION_QUEUE_TAG_NODES, escalationQueueTagIssues } from "../workflows/nodes/escalationQueueTagSpec.js";
import { REPLY_OUT_OF_SCOPE_NODE_NAME, UC01_WORKFLOW_ID } from "../workflows/nodes/replyOutOfScopeSpec.js";
import { MAPPINGS, STRUCTURAL_MAPPINGS } from "../scripts/lib/deployedNodeMappings.mjs";

import * as UC02 from "../workflows/nodes-uc02/terminalZendeskNodesSpec.js";
import * as UC03 from "../workflows/nodes-uc03/terminalZendeskNodesSpec.js";
import * as UC04 from "../workflows/nodes-uc04/terminalZendeskNodesSpec.js";
import * as UC05 from "../workflows/nodes-uc05/terminalZendeskNodesSpec.js";
import * as UC06 from "../workflows/nodes-uc06/terminalZendeskNodesSpec.js";
import * as UC07 from "../workflows/nodes-uc07/terminalZendeskNodesSpec.js";
import * as UC09 from "../workflows/nodes-uc09/terminalZendeskNodesSpec.js";

const PER_UC = [
  [UC02, UC02.UC02_WORKFLOW_ID],
  [UC03, UC03.UC03_WORKFLOW_ID],
  [UC04, UC04.UC04_WORKFLOW_ID],
  [UC05, UC05.UC05_WORKFLOW_ID],
  [UC06, UC06.UC06_WORKFLOW_ID],
  [UC07, UC07.UC07_WORKFLOW_ID],
  [UC09, UC09.UC09_WORKFLOW_ID],
];

const key = (o) => `${o.workflowId}|${o.node}`;
const TARGET_KEYS = new Set(TERMINAL_ZENDESK_TARGETS.map(key));

test("every node named by a per-use-case terminal spec has a deploy target", () => {
  for (const [spec, workflowId] of PER_UC) {
    for (const node of spec.TERMINAL_NODE_NAMES) {
      assert.ok(
        TARGET_KEYS.has(`${workflowId}|${node}`),
        `${workflowId} "${node}" is named by its spec's TERMINAL_NODE_NAMES but has no row in ` +
          `terminalZendeskDeployTargets.js — it would be published by nothing and checked by nothing`
      );
    }
  }
});

test("every node escalationQueueTagSpec covers has a deploy target", () => {
  for (const entry of ESCALATION_QUEUE_TAG_NODES) {
    assert.ok(
      TARGET_KEYS.has(key(entry)),
      `${entry.useCase} "${entry.node}" carries rca-iih7 / D-14 and has no deploy target`
    );
  }
});

test("UC-01's Reply Out of Scope — the one customer-facing node outside the per-UC specs", () => {
  assert.ok(TARGET_KEYS.has(`${UC01_WORKFLOW_ID}|${REPLY_OUT_OF_SCOPE_NODE_NAME}`));
});

test("no (workflowId, node) is claimed twice", () => {
  assert.equal(TARGET_KEYS.size, TERMINAL_ZENDESK_TARGETS.length);
});

test("every target's own parameters satisfy its own checker", () => {
  for (const t of TERMINAL_ZENDESK_TARGETS) {
    const issues = t.check({ name: t.node, type: t.type, parameters: t.parameters });
    assert.deepEqual(issues, [], `${key(t)} would be published in a state its own checker refuses: ${issues.join("; ")}`);
  }
});

// NEGATIVE CONTROL. The assertion above is only worth anything if the checkers
// can fail — a composed check that silently returned [] for everything would
// pass it. Emptying `tags` is the one mutation every checker in the table
// reacts to.
test("the composed checkers actually fail on a broken node", () => {
  for (const t of TERMINAL_ZENDESK_TARGETS) {
    const broken = {
      name: t.node,
      type: t.type,
      parameters: { ...t.parameters, updateFields: { ...t.parameters.updateFields, tags: [] } },
    };
    assert.ok(t.check(broken).length > 0, `${key(t)}'s checker accepted a node with no tags at all`);
  }
});

// THE ANTI-REVERT PROPERTY, stated as a test as well as thrown at import time.
// Thirteen of the fourteen D-14 nodes take their parameters from a
// per-use-case PROSE spec. An edit there that dropped the queue-tag expression
// would REVERT rca-iih7 on that node the next time it is published — the note
// would again claim a queue tag the ticket never receives, and the owning
// team's Zendesk view would again be empty on its own escalations.
test("no prose spec's parameters would revert D-14", () => {
  const d14 = new Set(ESCALATION_QUEUE_TAG_NODES.map(key));
  let covered = 0;
  for (const t of TERMINAL_ZENDESK_TARGETS) {
    if (!d14.has(key(t))) continue;
    covered++;
    assert.deepEqual(
      escalationQueueTagIssues({ name: t.node, type: t.type, parameters: t.parameters }),
      [],
      `${key(t)}'s parameters would revert rca-iih7 / D-14`
    );
  }
  assert.equal(covered, ESCALATION_QUEUE_TAG_NODES.length);
});

test("collectDeployTargets() carries parameters and a checker for every target", () => {
  const rows = collectDeployTargets();
  assert.equal(rows.length, TERMINAL_ZENDESK_TARGETS.length);
  for (const r of rows) {
    assert.equal(typeof r.check, "function");
    assert.ok(r.parameters && typeof r.parameters === "object");
    assert.ok(TARGET_KEYS.has(key(r)));
  }
});

test("structuralMappingRows() pins every terminal node TERMINAL", () => {
  const rows = structuralMappingRows();
  assert.equal(rows.length, TERMINAL_ZENDESK_TARGETS.length);
  for (const r of rows) {
    assert.deepEqual(r.expectedOutputs, [], `${key(r)} is not pinned terminal`);
    assert.equal(typeof r.checkParams, "function");
    assert.ok(r.specFile.includes("Spec.js"), `${key(r)} names no spec file`);
  }
});

// THE WIRING ITSELF. The table can be complete and still reach nothing:
// `verify-deployed` reads STRUCTURAL_MAPPINGS, not this module.
test("every deploy target is wired into STRUCTURAL_MAPPINGS", () => {
  const wired = new Set(STRUCTURAL_MAPPINGS.map(key));
  for (const t of TERMINAL_ZENDESK_TARGETS) {
    assert.ok(wired.has(key(t)), `${key(t)} has a deploy target but no STRUCTURAL_MAPPINGS row — published, unchecked`);
  }
});

// A Zendesk "update ticket" node carries no `jsCode`, so a MAPPINGS row for one
// could never match. Two tables owning one node is the drift shape this whole
// aggregator exists to remove.
test("no terminal Zendesk node is also claimed by the jsCode MAPPINGS table", () => {
  const codeNodes = new Set(MAPPINGS.map(key));
  for (const t of TERMINAL_ZENDESK_TARGETS) {
    assert.ok(!codeNodes.has(key(t)), `${key(t)} is in BOTH MAPPINGS and the terminal table`);
  }
});

test("expectedInputs is asserted only where the upstream sits on output index 0", () => {
  // `structuralNodeIssues()` reads connections[upstream].main[0]. Claiming an
  // input for a node on output 1/2/3/fallback fails a correctly-wired graph —
  // measured, on UC-04's `Flag Blocked Workation`, the first time this row was
  // written. Eight of the twenty-six qualify; the rest must carry none.
  const withInputs = TERMINAL_ZENDESK_TARGETS.filter((t) => t.expectedInputs);
  assert.equal(withInputs.length, 8);
  for (const t of withInputs) {
    assert.equal(t.expectedInputs.length, 1);
    assert.equal(typeof t.expectedInputs[0], "string");
    assert.ok(t.expectedInputs[0].length > 0);
  }
});
