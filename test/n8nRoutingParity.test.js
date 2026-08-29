// ---------------------------------------------------------------------------
// n8nRoutingParity.test.js — the escalation-routing table must mean the same
// thing in `src/` and in the n8n Code node that copies it
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// When a case escalates or otherwise needs a human, the responsible team has to
// receive the Zendesk ticket — assigned to a group, not merely tagged. The
// mapping `useCase -> { group, tags, priority }` is a single source of truth
// living in `src/`. An n8n Code node cannot import from `src/` (it has no module
// resolution at all), so the nine live graphs must carry a COPY of that table.
//
// This repo has paid for duplicated decision logic before, which is why
// `test/n8nParity.test.js` executes `workflows/nodes/gates.js` against
// `src/uc01/policyEngine.js`. A routing table is the same hazard one layer over:
// two copies, one gets edited, and the symptom is a ticket landing in the wrong
// team's queue — which nothing goes red about, because the automation still
// "succeeded".
//
// WHAT IS PROVED TODAY vs WHEN THE MAPPING LANDS
//
// The mapping module and the node port are being built separately. This file is
// deliberately written so it is NOT vacuous in the meantime:
//
//   1. The HARNESS ITSELF is exercised now, against fixtures — a fixture table
//      plus a fixture port body. Those tests prove `runRoutingNode()` really
//      executes a node body, really compares it against a table, and really
//      DETECTS drift. A harness that has never caught a difference is not known
//      to be able to.
//   2. The REAL parity test runs the moment both files exist, deriving its cases
//      from the real table rather than restating them, so no one has to remember
//      to extend it. Until then it reports as skipped with the reason — an
//      honest "not checked yet", never a green "checked and fine".
//
// Deriving the cases from the table rather than listing them here is the same
// discipline `scripts/verify-trace-nodes.mjs` follows when it lifts TRACED_CALLS
// out of the deployed body: a local restatement would share any typo with the
// thing it is supposed to be checking, and compare equal.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoPath = (...p) => join(__dirname, "..", ...p);

// The two halves this file holds against each other. Both are produced by work
// that is still in flight; see the header. Names are asserted, not guessed at
// call time, so a rename fails loudly here instead of silently skipping.
const MODULE_PATH = repoPath("src", "shared", "escalationRouting.js");
const PORT_PATH = repoPath("workflows", "nodes", "assignRouting.js");

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

/**
 * Execute an n8n Code node body and return its routing output as plain JSON.
 *
 * The body is wrapped in a function because an n8n Code node ends in a bare
 * `return`, which is only legal inside one — this is exactly what n8n does.
 *
 * The result is JSON round-tripped before it is returned. Objects built inside
 * a `node:vm` context belong to a different realm, so their Array/Object
 * prototypes are not the ones `assert.deepEqual` compares against, and every
 * comparison would fail on prototype identity rather than on content. The round
 * trip also mirrors what n8n itself does between nodes, so the test sees the
 * shape production sees.
 *
 * @param {string} source   the Code node body
 * @param {object} context  the decision context the node reads (`$json`)
 * @returns {object} the single emitted item's `json`
 */
function runRoutingNode(source, context) {
  const sandbox = {
    $json: context,
    $input: { first: () => ({ json: context }) },
    // Graphs address earlier nodes by name; the routing node only ever needs
    // the decision context, so every lookup resolves to it. An unexpected name
    // throws rather than silently returning undefined.
    $: (nodeName) => {
      if (typeof nodeName !== "string" || nodeName.length === 0) {
        throw new Error(`Unexpected $() lookup for ${JSON.stringify(nodeName)}`);
      }
      return { first: () => ({ json: context }), item: { json: context } };
    },
  };

  const wrapped = `(function () {\n${source}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  assert.ok(Array.isArray(result), "a Code node must return an array of items");
  assert.equal(result.length, 1, "the routing node emits exactly one item");
  return JSON.parse(JSON.stringify(result[0].json));
}

/**
 * One table row -> the three fields this test compares, for a given decision.
 *
 * `src/shared/escalationRouting.js` used to carry ONE tag per row, spelled
 * `escalation_<team>`, and the portal pushed it onto every ticket it raised —
 * so a routine `ready_for_approval` reached Zendesk labelled an escalation and,
 * on UC-04, addressed to the Tier-2 legal queue. The row now carries two: the
 * owning team's `queueTag` (every ticket) and the `escalationTag` (escalations
 * only), plus an optional `escalationGroup` for UC-04, the one use case whose
 * spec names a different team for the two paths.
 *
 * So this function needs the DECISION, not just the row — the same input the
 * port reads. Normalising here rather than in either copy is deliberate: this
 * test compares MEANING, and a spelling difference between a source module and
 * a transport format is not drift. Rows that carry a flat `tags` array (the
 * fixtures below) pass straight through.
 */
function routeFields(route, { escalated = true } = {}) {
  if (Array.isArray(route.tags)) return { group: route.group, tags: route.tags, priority: route.priority };
  if (route.queueTag) {
    return {
      group: escalated && route.escalationGroup ? route.escalationGroup : route.group,
      tags: escalated ? [route.queueTag, route.escalationTag] : [route.queueTag],
      priority: route.priority,
    };
  }
  return { group: route.group, tags: route.tag ? [route.tag] : [], priority: route.priority };
}

/**
 * The comparison the real test makes, factored out so the fixtures below can
 * exercise the very same code path rather than an approximation of it.
 *
 * Compares only the three routing fields. The node passes the rest of the
 * decision context through untouched, and asserting on that would make this
 * test fail for reasons that have nothing to do with routing.
 *
 * @returns {{useCase: string, expected: object, actual: object}[]} one row per case
 */
function collectRoutingRows(source, table, { decision = "escalate" } = {}) {
  const escalated = /^escalat/i.test(decision);
  return Object.keys(table).map((useCase) => {
    const route = table[useCase];
    const emitted = runRoutingNode(source, { useCase, decision });
    return {
      useCase,
      expected: routeFields(route, { escalated }),
      actual: {
        group: emitted.zendeskGroup,
        tags: emitted.zendeskTags,
        priority: emitted.zendeskPriority,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 1. The harness, proved against fixtures — runs today
// ---------------------------------------------------------------------------

/**
 * A stand-in for the real table, in the shape the real one is contracted to
 * have: keyed by use case, each value carrying a Zendesk group, tags and a
 * priority. Two entries is enough — the point is to prove the mechanism, and a
 * larger fixture would only restate it.
 */
const FIXTURE_TABLE = {
  "UC-04": { group: "Mobility", tags: ["uc04"], priority: "high" },
  "UC-09": { group: "Payroll", tags: ["uc09"], priority: "urgent" },
};

/** A stand-in port body that agrees with FIXTURE_TABLE. */
const FIXTURE_PORT = `
const TABLE = {
  "UC-04": { group: "Mobility", tags: ["uc04"], priority: "high" },
  "UC-09": { group: "Payroll", tags: ["uc09"], priority: "urgent" },
};
const route = TABLE[$json.useCase] || null;
return [{
  json: Object.assign({}, $json, {
    zendeskGroup: route ? route.group : null,
    zendeskTags: route ? route.tags : [],
    zendeskPriority: route ? route.priority : null,
  }),
  pairedItem: { item: 0 },
}];
`;

/** The same body with ONE group changed — the drift this harness must catch. */
const FIXTURE_PORT_DRIFTED = FIXTURE_PORT.replace('group: "Payroll"', 'group: "Support"');

// ---------------------------------------------------------------------------
// THE IDS ARE GENERATED TWICE AND MUST NOT DRIFT
// ---------------------------------------------------------------------------
// The n8n node and the Node services each need to turn a group NAME into a
// group_id, and neither can look it up at request time: the graphs would need
// an HTTP Request node per workflow (n8n strips credentials from those on
// create), and the services' shared Zendesk client deliberately holds the least
// privilege its ticket path needs, which has no `read` scope — so the portal's
// live lookup 403s and every escalation came back TAGGED BUT UNASSIGNED.
// Observed live: ticket #38 carried `escalation_finance_ops` and sat in nobody's
// queue.
//
// So the ids are resolved once, by scripts/sync-zendesk-group-ids.mjs, into two
// files in one pass. Two files means two chances to drift, and drift here is
// invisible until real work lands in the wrong team's queue — which is why this
// compares them rather than trusting the script to have written both.

test("the baked group ids are identical in the n8n port and the shared module", async () => {
  const { ESCALATION_GROUP_IDS } = await import("../src/shared/escalationGroupIds.js");
  const port = readFileSync(PORT_PATH, "utf8");
  const block = port.slice(port.indexOf("const GROUP_IDS = {"), port.indexOf("};", port.indexOf("const GROUP_IDS = {")));

  for (const [name, id] of Object.entries(ESCALATION_GROUP_IDS)) {
    assert.ok(
      block.includes(`${JSON.stringify(name)}: ${id},`),
      `the n8n port and src/shared/escalationGroupIds.js disagree about ${name} — re-run npm run sync-groups`
    );
  }
  // And the other direction, so a name in the port but not the module is caught
  // too: one map with an extra team routes work the other silently drops.
  const namesInPort = [...block.matchAll(/"([^"]+)":\s*(\d+),/g)].map((m) => m[1]);
  assert.deepEqual(namesInPort.sort(), Object.keys(ESCALATION_GROUP_IDS).sort());
});

test("groupIdFor answers null for a group this account does not have", async () => {
  // Null is the honest answer and callers must tag-and-say-so on it. Guessing
  // an id would assign real work to the wrong queue, which is worse than an
  // unassigned ticket that says it is unassigned.
  const { groupIdFor } = await import("../src/shared/escalationGroupIds.js");
  assert.equal(groupIdFor("A Team That Does Not Exist"), null);
  assert.equal(groupIdFor(""), null);
  assert.equal(groupIdFor(null), null);
  assert.equal(groupIdFor(undefined), null);
});

test("harness: runRoutingNode executes a node body and returns plain JSON", () => {
  const out = runRoutingNode(FIXTURE_PORT, { useCase: "UC-04", decision: "escalate" });

  assert.equal(out.zendeskGroup, "Mobility");
  assert.deepEqual(out.zendeskTags, ["uc04"]);
  assert.equal(out.zendeskPriority, "high");
  // Cross-realm proof: a value that survived the round trip compares by content.
  assert.equal(Object.getPrototypeOf(out.zendeskTags), Array.prototype);
  // The node passes its input through rather than replacing it.
  assert.equal(out.decision, "escalate");
});

test("harness: an unrouted use case yields an explicit null, never a wrong group", () => {
  const out = runRoutingNode(FIXTURE_PORT, { useCase: "UC-XX", decision: "escalate" });

  // Failing closed here means the ticket keeps whatever group it already had and
  // a human still sees it, rather than being handed to an unrelated team.
  assert.equal(out.zendeskGroup, null);
  assert.deepEqual(out.zendeskTags, []);
  assert.equal(out.zendeskPriority, null);
});

test("harness: a port that agrees with its table reports no drift", () => {
  const rows = collectRoutingRows(FIXTURE_PORT, FIXTURE_TABLE);

  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.deepEqual(row.actual, row.expected, `${row.useCase} should agree`);
  }
});

test("harness: a port that has drifted from its table is DETECTED", () => {
  const rows = collectRoutingRows(FIXTURE_PORT_DRIFTED, FIXTURE_TABLE);
  const mismatched = rows.filter(
    (r) => JSON.stringify(r.actual) !== JSON.stringify(r.expected)
  );

  // This is the assertion that makes the three tests above worth anything: the
  // harness is known to fail when the two copies disagree, so its silence when
  // the real files arrive is informative rather than merely reassuring.
  assert.equal(mismatched.length, 1, "the single drifted group must be caught");
  assert.equal(mismatched[0].useCase, "UC-09");
  assert.equal(mismatched[0].actual.group, "Support");
  assert.equal(mismatched[0].expected.group, "Payroll");
});

// ---------------------------------------------------------------------------
// 2. The real parity check — completes itself the moment both files exist
// ---------------------------------------------------------------------------

const modulePresent = existsSync(MODULE_PATH);
const portPresent = existsSync(PORT_PATH);

// Deliberately NOT skipped when only ONE half exists: a port with no source of
// truth, or a table nothing copies, is a real reportable defect rather than a
// "not ready yet", so the assertions below run and fail loudly in that case.
test(
  "the deployed routing port agrees with src/shared/escalationRouting.js for every use case",
  {
    skip:
      !modulePresent && !portPresent
        ? "neither src/shared/escalationRouting.js nor workflows/nodes/assignRouting.js exists yet — routing parity is NOT checked"
        : false,
  },
  async () => {
    assert.ok(
      modulePresent,
      `${PORT_PATH} exists but ${MODULE_PATH} does not — the n8n port has no ` +
        "source of truth to be checked against, which is the duplicated-table " +
        "hazard this file exists to prevent"
    );
    assert.ok(
      portPresent,
      `${MODULE_PATH} exists but ${PORT_PATH} does not — the nine live graphs ` +
        "carry no copy of the routing table, so no ticket is being assigned"
    );

    const mod = await import(pathToFileURL(MODULE_PATH).href);

    // Discover the table by contract rather than by guessing at call time. If
    // the mapping module names its export something else, this fails with a
    // message saying exactly what is needed — which is the right outcome, and
    // far better than a lookup quietly yielding undefined and every comparison
    // passing against nothing.
    // `ESCALATION_ROUTES` is the name the module actually shipped with; the
    // other three were the names this harness was drafted against before it
    // existed. All four are accepted rather than one renamed, because a rename
    // in either file would then break the OTHER copy's consumers for no reason.
    const table = mod.ESCALATION_ROUTES || mod.ESCALATION_ROUTING || mod.ROUTING || mod.default || null;

    assert.ok(
      table && typeof table === "object" && Object.keys(table).length > 0,
      `${MODULE_PATH} must export a non-empty routing table as ` +
        "`ESCALATION_ROUTES` (or `ESCALATION_ROUTING`, or `ROUTING`, or a " +
        "default export), keyed by use case, each value carrying " +
        "{ group, tag|tags, priority }"
    );

    const source = readFileSync(PORT_PATH, "utf8");

    // BOTH HAND-OFF SHAPES, because the table now answers differently for each
    // and only checking one would leave the other free to drift. That is not
    // hypothetical: the reason the table gained a second tag is that the single
    // one was applied to every decision, and a parity check driving only
    // `escalate` could never have seen it.
    for (const decision of ["escalate", "ready_for_approval"]) {
      for (const row of collectRoutingRows(source, table, { decision })) {
        assert.deepEqual(
          row.actual,
          row.expected,
          `${row.useCase} on \`${decision}\`: the n8n port and the routing table disagree. ` +
            "Edit both, or regenerate the port."
        );
      }
    }
  }
);

test("a routine decision is NOT tagged as an escalation, and does not go to the escalation team", async () => {
  // The defect, pinned in both copies at once. `ready_for_approval` is UC-04's
  // ordinary one-click specialist gate — the medium-tier design working. It used
  // to reach Zendesk tagged `escalation_mobility_legal_t2` and addressed to the
  // Tier-2 legal queue UC-04.md §5 reserves for an unconfirmed dimension.
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  const source = readFileSync(PORT_PATH, "utf8");

  const routine = runRoutingNode(source, { useCase: "UC-04", decision: "ready_for_approval" });
  assert.equal(routine.zendeskGroup, "Mobility Specialists");
  assert.deepEqual(routine.zendeskTags, ["queue_mobility_specialists"]);
  assert.equal(routine.routing.escalated, false);
  assert.ok(
    !routine.zendeskTags.some((t) => t.startsWith("escalation_")),
    "a routine approval must carry no escalation tag — that tag is what a support org reports on"
  );

  // The module says the same thing, which is the half a graph read cannot prove.
  const handoff = mod.handoffFor({ useCase: "UC-04", decision: "ready_for_approval" });
  assert.deepEqual(handoff.tags, routine.zendeskTags);
  assert.equal(handoff.group, routine.zendeskGroup);
  assert.equal(handoff.escalationTag, null);

  // And the routing that must NOT be dropped: the owning team's tag is still
  // there, so the review is routable. This is why "only tag escalations" was
  // the wrong fix.
  const review = runRoutingNode(source, { useCase: "UC-02", decision: "human_review" });
  assert.deepEqual(review.zendeskTags, ["queue_finance_ops"]);
  assert.equal(review.zendeskGroup, "Finance Ops");

  // An escalation carries BOTH: still Finance Ops's work, additionally an
  // escalation.
  const escalated = runRoutingNode(source, { useCase: "UC-02", decision: "escalate" });
  assert.deepEqual(escalated.zendeskTags, ["queue_finance_ops", "escalation_finance_ops"]);
});

test("a decision the port cannot classify is treated as an ESCALATION, not as routine", async () => {
  // The fail-closed direction, and it is the opposite of the defect above. The
  // bug was a KNOWN routine decision being called an escalation; an unknown one
  // is a missing signal, and demoting it to routine would let an unclassifiable
  // UC-04 case land with a specialist as a one-click approve — which UC-04.md
  // §8 forbids outright.
  const mod = await import(pathToFileURL(MODULE_PATH).href);
  const source = readFileSync(PORT_PATH, "utf8");

  const blank = runRoutingNode(source, { useCase: "UC-04" });
  assert.equal(blank.zendeskGroup, "Mobility & Legal (Tier-2)");
  assert.deepEqual(blank.zendeskTags, ["queue_mobility_specialists", "escalation_mobility_legal_t2"]);
  assert.equal(mod.isEscalation(undefined), true);
  assert.equal(mod.isEscalation(""), true);
  assert.equal(mod.isEscalation("escalate"), true);
  assert.equal(mod.isEscalation("ready_for_approval"), false);
  assert.equal(mod.isEscalation("human_review"), false);
  assert.equal(mod.isEscalation("route_to_uc04"), false);
});

// ---------------------------------------------------------------------------
// 3. The paths PRODUCTION takes, which section 2 above never exercises
// ---------------------------------------------------------------------------
// The parity check drives the port with `$json.useCase` set. No live graph puts
// a use case on the item: each writes a literal `use_case` into `audit_log` and
// the routing node reads it back off that row. So the resolution production
// actually uses would be entirely untested by section 2 — the same shape as
// this repo's most expensive recurring lesson, where a path that structurally
// cannot work is indistinguishable from one behaving correctly.
//
// These use a richer sandbox that answers per NODE NAME, so `$json` and
// `$('Append Audit Log')` can disagree, exactly as they do in every graph.

/** Run the real port body with distinct `$json` and per-node data. */
/**
 * Blank out the GENERATED group-id table, reproducing a real and important
 * state: an account where the groups have not been created yet. It used to be
 * reproducible for free, because the table WAS empty — then the groups were
 * provisioned and the table filled, and this fallback stopped being exercised
 * by accident. A path that only gets tested while nobody has run setup is a
 * path that stops being tested the moment somebody does, which is precisely
 * when a fresh account still needs it to work.
 */
function withoutGroupIds(source) {
  const start = source.indexOf("const GROUP_IDS = {");
  const end = source.indexOf("};", start);
  assert.ok(start !== -1 && end !== -1, "GROUP_IDS block not found — the port's shape changed");
  return source.slice(0, start) + "const GROUP_IDS = {" + source.slice(end);
}

function runWithNodes(context, nodes, { groupIds = true } = {}) {
  const source = groupIds ? readFileSync(PORT_PATH, "utf8") : withoutGroupIds(readFileSync(PORT_PATH, "utf8"));
  const sandbox = {
    $json: context,
    $input: { first: () => ({ json: context }) },
    $: (nodeName) => {
      if (!Object.prototype.hasOwnProperty.call(nodes, nodeName)) {
        // n8n throws for a node that is not an executed ancestor. The port must
        // survive that rather than blow up a run over a missing lookup.
        throw new Error(`No node named "${nodeName}"`);
      }
      const json = nodes[nodeName];
      return { first: () => ({ json }), item: { json } };
    },
  };
  const result = vm.runInNewContext(`(function () {\n${source}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const portReady = existsSync(PORT_PATH);
const needsPort = { skip: portReady ? false : `${PORT_PATH} does not exist yet` };

test("the port resolves its use case from the audit row, which is the only source production has", needsPort, () => {
  // `$json` here is what the Supabase insert response looks like on UC-04/05/
  // 06/07/08, where the routing node sits directly after `Append Audit Log`.
  const auditRow = { id: "a1", use_case: "UC-07", action: "escalate" };
  const out = runWithNodes(auditRow, { "Append Audit Log": auditRow });

  assert.equal(out.routing.useCase, "UC-07");
  assert.equal(out.zendeskGroup, "Mobility Legal (Tier-3)");
  // `action` on the audit row IS the decision — every workflow.js writes
  // `action: result.decision` — which is how the port classifies the hand-off
  // on the five graphs where this node reads the Supabase insert response and
  // there is no `decision` column to read.
  assert.equal(out.routing.decision, "escalate");
  assert.deepEqual(out.zendeskTags, ["queue_mobility_legal_t3", "escalation_mobility_legal_t3"]);
});

test("the port resolves the audit row even when $json is an unrelated decision context", needsPort, () => {
  // UC-01/02/03/09: `Carry Context Forward` restores the GATES output, which
  // carries no use case at all. The audit row is the only thing that knows.
  const gatesContext = { decision: "escalate", reason: "identity_not_verified", externalRef: "123" };
  const out = runWithNodes(gatesContext, {
    "Append Audit Log": { id: "a2", use_case: "UC-09" },
  });

  assert.equal(out.routing.useCase, "UC-09");
  assert.equal(out.zendeskGroup, "Payroll Ops");
  // The decision context survives — every downstream Switch and Zendesk node
  // still reads it off `$json`.
  assert.equal(out.decision, "escalate");
  assert.equal(out.externalRef, "123");
});

test("handoffUseCase routes UC-03's route_to_uc04 branch to UC-04's team, not UC-03's", needsPort, () => {
  const routed = runWithNodes(
    { decision: "route_to_uc04", handoffUseCase: "UC-04" },
    { "Append Audit Log": { use_case: "UC-03" } }
  );
  const ordinary = runWithNodes(
    { decision: "escalate" },
    { "Append Audit Log": { use_case: "UC-03" } }
  );

  // The whole point: same workflow, same audit row, different owning team.
  assert.equal(routed.routing.routingKey, "UC-04");
  // AND it lands with UC-04's SPECIALIST, not its Tier-2 legal escalation team.
  // `route_to_uc04` is a hand-off between use cases, not a case the automation
  // gave up on — before the tag/team split it arrived tagged
  // `escalation_mobility_legal_t2` in the legal queue.
  assert.equal(routed.zendeskGroup, "Mobility Specialists");
  assert.deepEqual(routed.zendeskTags, ["queue_mobility_specialists"]);
  assert.equal(routed.routing.escalated, false);
  assert.equal(ordinary.routing.routingKey, "UC-03");
  assert.equal(ordinary.zendeskGroup, "Travel & Mobility Support");
  assert.deepEqual(ordinary.zendeskTags, ["queue_travel_support", "escalation_travel_support"]);
});

test("a group that does not exist yields NO assignment and a note saying so, never a wrong group", needsPort, () => {
  // Run the port with the generated table blanked, which is what any account
  // looks like before scripts/setup-zendesk-groups.mjs is run. The groups on
  // THIS account now exist, so the fallback is no longer reachable by default —
  // it has to be constructed, or it silently stops being covered.
  const out = runWithNodes({ decision: "escalate" }, { "Append Audit Log": { use_case: "UC-06" } }, { groupIds: false });

  assert.equal(out.routing.intendedGroup, "Payroll Ops");
  assert.equal(out.routing.assigned, false);
  assert.equal(out.routing.groupId, null);
  // '' and not null: the Zendesk node does `if (updateFields.group)`, and an
  // expression rendering `null` arrives as the truthy STRING "null".
  assert.equal(out.zendeskGroupId, "");
  // The tags are still applied, so a trigger can route on them even unassigned.
  assert.deepEqual(out.zendeskTags, ["queue_payroll_ops", "escalation_payroll_ops"]);
  assert.equal(out.routingTag, "escalation_payroll_ops");
  assert.match(out.routingNote, /ASSIGNMENT SKIPPED/);
  assert.match(out.routingNote, /Payroll Ops/);
  assert.match(out.routingNote, /setup-zendesk-groups\.mjs/);
});

test("an unroutable run says it could not route, and assigns nothing", needsPort, () => {
  const noUseCase = runWithNodes({}, {});
  assert.equal(noUseCase.zendeskGroup, null);
  assert.equal(noUseCase.zendeskGroupId, "");
  assert.deepEqual(noUseCase.zendeskTags, []);
  // Never an empty tag element: an unroutable ticket must be findable. And
  // `queue_unrouted`, not `escalation_unrouted` — a run that could not identify
  // its own use case has said nothing about whether it escalated, so a tag
  // claiming it did would be counted by the reporting the tag split exists to
  // make honest.
  assert.equal(noUseCase.routingTag, "queue_unrouted");
  assert.match(noUseCase.routingNote, /could not determine its own use case/);

  const unknownUseCase = runWithNodes({}, { "Append Audit Log": { use_case: "UC-99" } });
  assert.equal(unknownUseCase.zendeskGroup, null);
  assert.match(unknownUseCase.routingNote, /no owning team is defined for UC-99/);
});

test("the port sets pairedItem, without which $('…Gates').item stops resolving downstream", needsPort, () => {
  const source = readFileSync(PORT_PATH, "utf8");
  const sandbox = {
    $json: {},
    $input: { first: () => ({ json: {} }) },
    $: () => ({ first: () => ({ json: {} }), item: { json: {} } }),
  };
  const result = vm.runInNewContext(`(function () {\n${source}\n})()`, sandbox, { timeout: 5000 });

  // Six of the nine graphs address their gates node as $('X').item from a
  // Zendesk node downstream of this one, and that resolves through item
  // pairing. Losing it breaks those expressions, not this node.
  // Round-tripped, because a value built inside a node:vm context is
  // cross-realm and deepEqual compares prototype identity, not content.
  assert.deepEqual(JSON.parse(JSON.stringify(result[0].pairedItem)), { item: 0 });
});
