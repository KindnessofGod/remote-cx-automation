// ---------------------------------------------------------------------------
// n8nRouteByDecisionParity.test.js — the UC-01 switch's rule set has a real
// source of truth, and drift from it is caught with no n8n access at all
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-vqe)
//
// `Route by Decision` is an n8n SWITCH node. Every deployed-node check this
// repo had (`scripts/verify-deployed-nodes.mjs`'s MAPPINGS, this file's own
// sibling `test/n8nParity.test.js`) worked by diffing a `jsCode` string — a
// switch has none, so both were structurally blind to it, and nothing
// versioned its rule set anywhere in the repo either. rca-c73 found the live
// consequence: the switch had rules for 3 of the 7 decisions
// `workflows/nodes/gates.js` can emit, and the other three fell to the
// `Unrecognised Decision` fallback for as long as nobody happened to read the
// live graph by hand — a whole class of specified terminal outcome, silently
// downgraded to "a human looks at it", while `npm run verify-deployed` kept
// reporting "0 drifted".
//
// TWO THINGS THIS FILE PROVES, AND NEITHER NEEDS N8N_API_KEY
//
//   1. "a gate starts emitting a value nothing routes" (part 1 below) — parses
//      the decision-value LITERALS straight out of workflows/nodes/gates.js
//      and asserts every one is accounted for by
//      workflows/nodes/routeByDecisionSpec.js, either as a switch rule or as
//      a named upstream intercept. This is the exact rca-c73 shape.
//   2. "the checker scripts/verify-deployed-nodes.mjs runs against the LIVE
//      graph actually detects drift" (part 2 below) — the same
//      `structuralNodeIssues()`/`switchRuleIssues()` functions the live
//      script calls, run here against a SNAPSHOT of the real
//      `Route by Decision` node captured live from `WORKFLOW_UC01_ID` on
//      2026-08-22 (the baseline this bead started from — see the bead body's
//      "BASELINE" note), plus deliberately mutated copies of that same
//      snapshot. Proven red before proven green, same discipline
//      test/n8nRoutingParity.test.js already uses (FIXTURE_PORT /
//      FIXTURE_PORT_DRIFTED) — a harness that has never caught a difference
//      is not known to be able to.
//
// Mutating the SNAPSHOT rather than the live production graph is deliberate:
// `Route by Decision` decides how a real, currently-arriving Zendesk ticket
// gets answered. Proving the checker fires does not require putting a wrong
// rule in front of a real customer for the seconds it would take to revert
// it — the pure functions in scripts/lib/structuralNodeChecks.mjs are the
// same code either way, so a captured-and-mutated fixture proves exactly as
// much about the CHECKER as a live edit-and-revert would, with none of the
// blast radius. `npm run verify-deployed` (which DOES hit the live graph, and
// is exercised separately — see the bead's own live-run evidence) is what
// proves the CURRENT deployment matches; this file proves the DETECTOR works.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RULES, FALLBACK, HANDLED_UPSTREAM_OF_SWITCH, SWITCH_NODE_NAME } from "../workflows/nodes/routeByDecisionSpec.js";
import { structuralNodeIssues, switchRuleIssues } from "../scripts/lib/structuralNodeChecks.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes", "gates.js");

// ---------------------------------------------------------------------------
// Part 1 — gates.js's decision values vs. the spec, hermetically
// ---------------------------------------------------------------------------

/**
 * Extract every decision-value STRING LITERAL gates.js can produce, lifted
 * out of the deployed body's own source rather than restated by hand here —
 * a local restatement would share any typo with the thing this test exists
 * to check, and compare equal to it (the same reasoning
 * scripts/verify-trace-nodes.mjs uses for TRACED_CALLS).
 *
 * Matches `decision: 'x'` (object literal, e.g. the early `engagement`
 * returns) and `decision = 'x'` (assignment). Deliberately does NOT match
 * `decision === 'x'` (a comparison, not a production — `outOfScopeTrace`'s
 * guard) or `engagement.decision` (a read of an already-produced value, not
 * a new one).
 */
function extractGatesDecisions(source) {
  const found = new Set();
  const re = /\bdecision\s*[:=]\s*'([a-zA-Z_]+)'/g;
  let m;
  while ((m = re.exec(source))) found.add(m[1]);
  return found;
}

test("extractGatesDecisions finds an assignment/object-literal decision, not a comparison or a property read", () => {
  const fixture = `
    let decision, reason;
    decision = engagement.decision;
    if (decision === 'out_of_scope') { doSomething(); }
    return { decision: 'blocked', reason: 'x' };
    decision = 'human_review';
  `;
  assert.deepEqual(extractGatesDecisions(fixture), new Set(["blocked", "human_review"]));
});

test("induced drift: a decision gates.js emits but RULES has forgotten IS caught (proved red before the real file is checked green)", () => {
  const fakeGatesSource = `
    return { decision: 'blocked', reason: 'x' };
    decision = 'a_decision_nobody_routes';
  `;
  const emitted = extractGatesDecisions(fakeGatesSource);
  const routed = new Set(RULES.map((r) => r.decision));
  const upstream = new Set(Object.keys(HANDLED_UPSTREAM_OF_SWITCH));
  const unrouted = [...emitted].filter((d) => !routed.has(d) && !upstream.has(d));

  assert.deepEqual(unrouted, ["a_decision_nobody_routes"], "the harness must catch an unrouted decision");
});

test("workflows/nodes/gates.js: every decision it can emit is routed by a switch rule or a named upstream intercept", () => {
  const source = readFileSync(GATES_PATH, "utf8");
  const emitted = extractGatesDecisions(source);

  const routed = new Set(RULES.map((r) => r.decision));
  const upstream = new Set(Object.keys(HANDLED_UPSTREAM_OF_SWITCH));

  // This is the rca-c73 shape, caught in CI from now on: a decision with
  // neither a RULES entry nor a documented upstream intercept is a decision
  // that falls to the "Unrecognised Decision" internal-note hand-off for a
  // value qa/contracts/UC-01-acceptance.md §6 names as a terminal outcome.
  for (const decision of emitted) {
    assert.ok(
      routed.has(decision) || upstream.has(decision),
      `gates.js can emit "${decision}", but neither ${SWITCH_NODE_NAME}'s RULES ` +
        `(workflows/nodes/routeByDecisionSpec.js) nor HANDLED_UPSTREAM_OF_SWITCH ` +
        `name it — it falls to the "${FALLBACK.outputKey}" fallback in production. ` +
        "Add a switch rule (and deploy it), or document the upstream intercept."
    );
  }

  // And the other direction: a spec entry for a decision gates.js can no
  // longer produce means the spec has drifted from the gate without anyone
  // noticing — same failure mode, opposite party at fault.
  for (const decision of routed) {
    assert.ok(
      emitted.has(decision),
      `${SWITCH_NODE_NAME} routes "${decision}" per the spec, but gates.js does ` +
        "not appear to be able to emit it any more."
    );
  }
  for (const decision of upstream) {
    assert.ok(
      emitted.has(decision),
      `HANDLED_UPSTREAM_OF_SWITCH names "${decision}", but gates.js does not ` +
        "appear to emit it any more."
    );
  }
});

test("no decision is claimed by both a switch rule and an upstream intercept", () => {
  const routed = new Set(RULES.map((r) => r.decision));
  for (const decision of Object.keys(HANDLED_UPSTREAM_OF_SWITCH)) {
    assert.ok(!routed.has(decision), `"${decision}" is claimed by both RULES and HANDLED_UPSTREAM_OF_SWITCH`);
  }
});

test("RULES has no duplicate decision values", () => {
  const decisions = RULES.map((r) => r.decision);
  assert.deepEqual(decisions, [...new Set(decisions)]);
});

// ---------------------------------------------------------------------------
// Part 2 — the live-deploy checker itself, proved against a real captured
// snapshot plus deliberately mutated copies
// ---------------------------------------------------------------------------

/**
 * The LIVE `Route by Decision` node and its connections, captured verbatim
 * from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on 2026-08-22 — the exact
 * baseline this bead started from (`versionId === activeVersionId ==
 * "9670a25f-1351-4a5d-a414-6f80de2d77fd"`, six rules, per the bead body's own
 * "BASELINE" note). Committed rather than fetched live so this test is
 * hermetic; a real snapshot rather than a hand-typed guess so a pass here
 * means something about the actual production shape, not an idealisation of
 * it — the same reasoning UC-07's decision pass gives for committing Sandbox
 * captures (docs/BUILD-LOG.md §3.85, DRIFT-104).
 */
const LIVE_SWITCH_NODE = {
  id: "48beb97c-9251-4af4-8bcb-0ac8b06075bd",
  name: "Route by Decision",
  type: "n8n-nodes-base.switch",
  typeVersion: 3.4,
  position: [1936, 256],
  parameters: {
    rules: {
      values: [
        "auto_resolve", "human_review", "escalate", "blocked", "awaiting_employee_consent", "deflected_to_self_service",
      ].map((decision, i) => ({
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
          conditions: [
            {
              leftValue: "={{ $json.decision }}",
              operator: { type: "string", operation: "equals" },
              rightValue: decision,
              id: `fixture-rule-${i}`,
            },
          ],
          combinator: "and",
        },
        renameOutput: true,
        outputKey: decision,
      })),
    },
    options: { fallbackOutput: "extra", renameFallbackOutput: "unrecognised" },
  },
};

const LIVE_CONNECTIONS = {
  "Route by Decision": {
    main: [
      [{ node: "Fetch Legal Entity (Remote)", type: "main", index: 0 }],
      [{ node: "Flag for Specialist Review", type: "main", index: 0 }],
      [{ node: "Escalate Ticket", type: "main", index: 0 }],
      [{ node: "Prepare Refusal Reply", type: "main", index: 0 }],
      [{ node: "Prepare Refusal Reply", type: "main", index: 0 }],
      [{ node: "Prepare Refusal Reply", type: "main", index: 0 }],
      [{ node: "Unrecognised Decision", type: "main", index: 0 }],
    ],
  },
};

function liveWorkflow(nodeOverride = {}, connectionsOverride = LIVE_CONNECTIONS) {
  return {
    nodes: [{ ...LIVE_SWITCH_NODE, ...nodeOverride, parameters: { ...LIVE_SWITCH_NODE.parameters, ...nodeOverride.parameters } }],
    connections: connectionsOverride,
  };
}

const STRUCTURAL_ENTRY = {
  node: SWITCH_NODE_NAME,
  type: "n8n-nodes-base.switch",
  checkParams: (node) => switchRuleIssues(node, { RULES, FALLBACK }),
  expectedOutputs: [...RULES.map((r) => r.target), FALLBACK.target],
};

test("the captured live snapshot matches the spec exactly (today's real baseline is green)", () => {
  const issues = structuralNodeIssues(liveWorkflow(), STRUCTURAL_ENTRY);
  assert.deepEqual(issues, []);
});

// --- now induce real drift shapes, one at a time, and prove each is caught ---

test("DRIFT CAUGHT: a rule repointed to the wrong node (the exact rca-c73 shape) fails structuralNodeIssues", () => {
  const drifted = {
    ...LIVE_CONNECTIONS,
    "Route by Decision": {
      main: [
        ...LIVE_CONNECTIONS["Route by Decision"].main.slice(0, 3),
        // `blocked` (output 3) silently repointed at the fallback hand-off
        // instead of "Prepare Refusal Reply" — a rule that still COMPARES the
        // right value, and still routes nowhere useful. This is what makes it
        // dangerous: reading the rule condition alone would say it is fine.
        [{ node: "Unrecognised Decision", type: "main", index: 0 }],
        ...LIVE_CONNECTIONS["Route by Decision"].main.slice(4),
      ],
    },
  };

  const before = structuralNodeIssues(liveWorkflow(), STRUCTURAL_ENTRY);
  const after = structuralNodeIssues(liveWorkflow({}, drifted), STRUCTURAL_ENTRY);

  assert.deepEqual(before, [], "sanity: the undrifted snapshot is clean");
  assert.equal(after.length, 1, "exactly the repointed output should be flagged");
  assert.match(after[0], /output 3 connects to "Unrecognised Decision", expected "Prepare Refusal Reply"/);
});

test("DRIFT CAUGHT: a rule removed from the live switch (fewer rules than the spec) fails structuralNodeIssues", () => {
  const droppedRule = {
    parameters: {
      rules: { values: LIVE_SWITCH_NODE.parameters.rules.values.slice(0, 5) }, // drop deflected_to_self_service
    },
  };
  const droppedConnections = {
    "Route by Decision": { main: LIVE_CONNECTIONS["Route by Decision"].main.slice(0, 5).concat([LIVE_CONNECTIONS["Route by Decision"].main[6]]) },
  };

  const after = structuralNodeIssues(liveWorkflow(droppedRule, droppedConnections), STRUCTURAL_ENTRY);

  assert.ok(
    after.some((i) => i.includes('rule 5 ("deflected_to_self_service") is missing')),
    `expected a "rule missing" issue, got: ${JSON.stringify(after)}`
  );
  assert.ok(after.some((i) => i.includes("switch has 5 rule(s), spec (RULES) has 6")));
});

test("DRIFT CAUGHT: a rule's compared value edited (e.g. a typo introduced live) fails structuralNodeIssues", () => {
  const values = LIVE_SWITCH_NODE.parameters.rules.values.map((v, i) =>
    i === 4
      ? {
          ...v,
          conditions: {
            ...v.conditions,
            conditions: [{ ...v.conditions.conditions[0], rightValue: "awaiting_employe_consent" }], // dropped an "e"
          },
        }
      : v
  );
  const after = structuralNodeIssues(liveWorkflow({ parameters: { rules: { values } } }), STRUCTURAL_ENTRY);

  assert.ok(
    after.some((i) => i.includes('rule 4 routes "awaiting_employe_consent", expected "awaiting_employee_consent"')),
    `expected the mistyped value to be flagged, got: ${JSON.stringify(after)}`
  );
});

test("DRIFT CAUGHT: the fallback silently repointed at a real node fails structuralNodeIssues", () => {
  const drifted = {
    "Route by Decision": {
      main: [
        ...LIVE_CONNECTIONS["Route by Decision"].main.slice(0, 6),
        // Someone rewires "unrecognised" straight at auto_resolve's target —
        // an unrecognised decision would then be treated as a clean pass.
        [{ node: "Fetch Legal Entity (Remote)", type: "main", index: 0 }],
      ],
    },
  };
  const after = structuralNodeIssues(liveWorkflow({}, drifted), STRUCTURAL_ENTRY);

  assert.ok(
    after.some((i) => i.includes('output 6 connects to "Fetch Legal Entity (Remote)", expected "Unrecognised Decision"')),
    `expected the fallback repoint to be flagged, got: ${JSON.stringify(after)}`
  );
});

test("DRIFT CAUGHT: the node renamed/removed in n8n (mapping stale) fails structuralNodeIssues", () => {
  const renamed = liveWorkflow({ name: "Route by Decision (v2)" });
  const after = structuralNodeIssues(renamed, STRUCTURAL_ENTRY);

  assert.deepEqual(after, [
    'no node named "Route by Decision" — either it was renamed/removed in n8n, or this entry is stale',
  ]);
});

test("DRIFT CAUGHT: the node's n8n type changed (e.g. rebuilt as an IF) fails structuralNodeIssues", () => {
  const retyped = liveWorkflow({ type: "n8n-nodes-base.if" });
  const after = structuralNodeIssues(retyped, STRUCTURAL_ENTRY);

  assert.ok(after.some((i) => i.includes('type is "n8n-nodes-base.if", expected "n8n-nodes-base.switch"')));
});

test("green again: the same snapshot, unmutated, passes after every drift test above ran red", () => {
  // Guards against a fixture mutated in place by an earlier test (none of the
  // helpers above mutate LIVE_SWITCH_NODE/LIVE_CONNECTIONS — this pins that).
  const issues = structuralNodeIssues(liveWorkflow(), STRUCTURAL_ENTRY);
  assert.deepEqual(issues, []);
});
