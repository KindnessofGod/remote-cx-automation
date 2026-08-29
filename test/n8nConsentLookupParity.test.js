// ---------------------------------------------------------------------------
// n8nConsentLookupParity.test.js — rca-wn30 / R7-18 / D-11, the structural
// guard for the ONE production graph-shape change §K4 authorised
// ---------------------------------------------------------------------------
// 22 of 100 live feed rows carried `identity_awaiting_employee_consent` and
// NONE carried a `consentRecordId`, while the row's own prose told the
// reviewer to "see the consent request's own age before assuming it needs a
// nudge". The cause was not a wrong parameter on a node — it was the ABSENCE
// of a node: all 37 live nodes of WORKFLOW_UC01_ID were enumerated and none
// read `consent_records`, so `ctx.consentRecord` was undefined on every run
// and gates.js could only ever answer null.
//
// `qa/HUMAN-DECISIONS-REQUIRED.md` §K4 declined "stop printing the prose" and
// authorised adding the node. This file is what stops it silently going away
// again — a Supabase node has no jsCode, so scripts/verify-deployed-nodes.mjs's
// byte-diffing MAPPINGS is structurally blind to it (rca-uim, rca-ibh,
// rca-zu3, rca-2ix1 are the four previous incidents of exactly that shape).
//
// The DECISION-level guard — that the rows actually change what gates.js
// emits — lives in test/n8nParity.test.js, which executes the real node body
// and asserts on its returned output. This file guards the other half: that
// the node exists, reads the right table through the right join, and is wired
// strictly between "Fetch Employment (Remote)" and "Identity + Policy Gates"
// with no bypass. Both halves are needed: a correct body reading a node that
// is not there emits nulls, and a correctly-wired node feeding a body that
// ignores it does too.
//
// Same discipline as every other "no jsCode" structural node test in this
// suite (test/n8nUpdateAuditLogWithLetterParity.test.js is the closest
// sibling): a committed SNAPSHOT of the live node, mutated to prove the
// checker actually catches drift, hermetically — no n8n access, no risk to
// the graph that answers real Zendesk tickets.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import {
  NODE_NAME,
  NODE_TYPE,
  TABLE_ID,
  RESOURCE,
  OPERATION,
  UPSTREAM_NODE,
  DOWNSTREAM_NODE,
  FILTER_TYPE,
  FILTER_STRING,
  RETURN_ALL,
  LIMIT,
  RESOURCE_NODE_DEFAULT,
  RETURN_ALL_NODE_DEFAULT,
  LIMIT_NODE_DEFAULT,
  SELECT_COLUMNS,
  ORDER_BY,
  consentLookupParamIssues,
} from "../workflows/nodes/consentLookupSpec.js";

/**
 * Captured verbatim from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on
 * 2026-08-23, immediately after this bead's deploy — versionId ===
 * activeVersionId === "0d4694e3-81c7-4fe5-857e-c7e5ad2c8907", 38 nodes.
 * Proven on that same graph by executions 7568 (third party, pending,
 * `consentRecordId: 1eda679c-…`) and 7570 (self, auto_resolve, letter
 * rendered and persisted), both unpinned.
 */
const LIVE_CONSENT_LOOKUP_NODE = {
  id: "090cc95b-0862-429f-ae80-e104922b0aa6",
  name: "Lookup Consent Records",
  type: "n8n-nodes-base.supabase",
  typeVersion: 1,
  position: [1008, 288],
  parameters: {
    resource: "row",
    operation: "getAll",
    tableId: "consent_records",
    returnAll: false,
    limit: 50,
    filterType: "string",
    filterString:
      "=select=id,created_at,case_id,consent_type,status,source,evidence_reference,requesting_party,purpose,granted_by_employment_id,granted_by_signal,granted_at,cases!inner(employment_id)&cases.employment_id=eq.{{ String($('Validate Classification').first().json.employmentId || '').replace(/[^A-Za-z0-9_-]/g, '') }}&order=created_at.asc",
  },
  credentials: { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } },
  alwaysOutputData: true,
  onError: "continueRegularOutput",
};

/**
 * THE SAME NODE, CAPTURED AGAIN ON 2026-08-28 — after a hand save in the n8n
 * EDITOR, which is why three keys have vanished (versionId
 * "bd216ae4-a15d-4ed7-8445-67e67f84fddc", 38 nodes, active).
 *
 * `resource`, `returnAll` and `limit` are absent because each equalled the
 * Supabase node's own default and n8n prunes those before saving; `operation`
 * and `filterType`, whose values are NOT defaults, survived. Nothing about the
 * node's behaviour changed — execution 9592 ran this exact shape and returned
 * 3 `consent_records` rows. A checker that read absent as "unset" reported
 * this node as drifted, which is the false alarm
 * consentLookupSpec.js's *_NODE_DEFAULT constants exist to stop.
 *
 * Both snapshots are kept on purpose: the API-written one above (explicit
 * values) and this UI-written one must BOTH read green, because either can be
 * what the next `verify-deployed` sees.
 */
const LIVE_CONSENT_LOOKUP_NODE_UI_SAVED = {
  ...LIVE_CONSENT_LOOKUP_NODE,
  parameters: {
    operation: "getAll",
    tableId: "consent_records",
    filterType: "string",
    filterString: LIVE_CONSENT_LOOKUP_NODE.parameters.filterString,
  },
};

function nodeWith(overrides) {
  return { ...LIVE_CONSENT_LOOKUP_NODE, ...overrides };
}
function nodeWithParams(parameterOverrides) {
  return nodeWith({
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE.parameters, ...parameterOverrides },
  });
}

const CONNECTIONS = {
  [UPSTREAM_NODE]: { main: [[{ node: NODE_NAME }]] },
  [NODE_NAME]: { main: [[{ node: DOWNSTREAM_NODE }]] },
};

const ENTRY = {
  node: NODE_NAME,
  type: NODE_TYPE,
  checkParams: consentLookupParamIssues,
  expectedOutputs: [DOWNSTREAM_NODE],
  expectedInputs: [UPSTREAM_NODE],
};

/** The companion no-bypass entry on the upstream HTTP node. */
const UPSTREAM_ENTRY = {
  node: UPSTREAM_NODE,
  type: "n8n-nodes-base.httpRequest",
  expectedOutputs: [NODE_NAME],
};

const LIVE_UPSTREAM_NODE = { name: UPSTREAM_NODE, type: "n8n-nodes-base.httpRequest", parameters: {} };

test("sanity: the spec constants say what this bead's design says", () => {
  assert.equal(NODE_NAME, "Lookup Consent Records");
  assert.equal(NODE_TYPE, "n8n-nodes-base.supabase");
  assert.equal(TABLE_ID, "consent_records");
  assert.equal(RESOURCE, "row");
  assert.equal(OPERATION, "getAll");
  assert.equal(UPSTREAM_NODE, "Fetch Employment (Remote)");
  assert.equal(DOWNSTREAM_NODE, "Identity + Policy Gates");
  assert.equal(FILTER_TYPE, "string");
  assert.equal(RETURN_ALL, false);
  assert.equal(LIMIT, 50);
  assert.equal(ORDER_BY, "created_at.asc", "oldest first — L-19 ages the LONGEST-waiting ask");
});

test("the filter joins through `cases`, because consent_records carries no employment id of its own", () => {
  assert.match(SELECT_COLUMNS, /cases!inner\(employment_id\)/);
  assert.match(FILTER_STRING, /&cases\.employment_id=eq\./);
  // Every column caseStore.js's CONSENT_SELECT_COLUMNS reads, so gates.js can
  // apply the SAME completeness rule to a row from the graph as to one handed
  // in on ctx. A column dropped here is a grant that silently reads incomplete.
  for (const col of [
    "id", "created_at", "case_id", "consent_type", "status", "source",
    "evidence_reference", "requesting_party", "purpose",
    "granted_by_employment_id", "granted_by_signal", "granted_at",
  ]) {
    assert.ok(SELECT_COLUMNS.split(",").includes(col), `select is missing ${col}`);
  }
});

test("the employment id is scrubbed before it becomes part of a PostgREST filter", () => {
  // A PostgREST filter value is not parameterised, and this id arrives from a
  // Zendesk custom field — i.e. from something a human typed. A comma or a
  // parenthesis in it re-shapes the query rather than failing it.
  assert.match(FILTER_STRING, /replace\(\/\[\^A-Za-z0-9_-\]\/g, ''\)/);
  // and it is read from "Validate Classification" BY NAME, never off $json —
  // $json here is the employment fetch's response, which has no employmentId.
  assert.match(FILTER_STRING, /\$\('Validate Classification'\)\.first\(\)\.json\.employmentId/);
});

test("the captured live snapshot matches the spec exactly, wiring included (today's real baseline is green)", () => {
  const workflow = { nodes: [LIVE_CONSENT_LOOKUP_NODE, LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), []);
  assert.deepEqual(structuralNodeIssues(workflow, UPSTREAM_ENTRY), []);
});

test("the UI-SAVED live snapshot ALSO matches — absent means default, never unset", () => {
  // The whole point. n8n pruned resource/returnAll/limit because each equalled
  // the node default; the node is byte-for-byte correct in behaviour.
  const p = LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters;
  assert.deepEqual(Object.keys(p), ["operation", "tableId", "filterType", "filterString"]);
  assert.equal(p.resource, undefined);
  assert.equal(p.returnAll, undefined);
  assert.equal(p.limit, undefined);

  const workflow = { nodes: [LIVE_CONSENT_LOOKUP_NODE_UI_SAVED, LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), []);
});

test("the read-through defaults are the n8n NODE defaults, and they equal what this spec wants", () => {
  // Verified against n8n's own source on 2026-08-28 (Supabase node, unversioned):
  //   Supabase.node.ts   resource  default 'row'
  //   RowDescription.ts  returnAll default false
  //   RowDescription.ts  limit     default 50
  // If any of these ever stops matching the spec's wanted value, the
  // read-through becomes a hole and this test is what says so.
  assert.equal(RESOURCE_NODE_DEFAULT, "row");
  assert.equal(RETURN_ALL_NODE_DEFAULT, false);
  assert.equal(LIMIT_NODE_DEFAULT, 50);
  assert.equal(RESOURCE_NODE_DEFAULT, RESOURCE);
  assert.equal(RETURN_ALL_NODE_DEFAULT, RETURN_ALL);
  assert.equal(LIMIT_NODE_DEFAULT, LIMIT);
});

// --- now induce real drift shapes, one at a time, and prove each is caught ---

test("THE REGRESSION THIS NODE EXISTS TO PREVENT: the node removed entirely (R7-18's original state)", () => {
  const workflow = { nodes: [LIVE_UPSTREAM_NODE], connections: {} };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), [
    'no node named "Lookup Consent Records" — either it was renamed/removed in n8n, or this entry is stale',
  ]);
});

test("THE SILENT ONE: alwaysOutputData turned off — a zero-row lookup would stop the whole decision", () => {
  const workflow = {
    nodes: [nodeWith({ alwaysOutputData: false }), LIVE_UPSTREAM_NODE],
    connections: CONNECTIONS,
  };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /alwaysOutputData is false, expected true/);
  assert.match(issues[0], /"Identity \+ Policy Gates" never runs/);
});

test("THE OTHER SILENT ONE: onError reverted to the default — an unreachable Supabase would stop the decision", () => {
  const workflow = { nodes: [nodeWith({ onError: undefined }), LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /onError is undefined, expected "continueRegularOutput"/);
});

test("DRIFT CAUGHT: tableId repointed off consent_records", () => {
  const workflow = { nodes: [nodeWithParams({ tableId: "cases" }), LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), ['tableId is "cases", expected "consent_records"']);
});

test("DRIFT CAUGHT: operation silently changed off getAll (e.g. rebuilt as a create — would WRITE a consent row)", () => {
  const workflow = { nodes: [nodeWithParams({ operation: "create" }), LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), ['operation is "create", expected "getAll"']);
});

test("VC-30: the join filter dropped — an unscoped lookup would return EVERY employee's consent rows", () => {
  const workflow = {
    nodes: [nodeWithParams({ filterString: "=select=*&order=created_at.asc" }), LIVE_UPSTREAM_NODE],
    connections: CONNECTIONS,
  };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^filterString is /);
});

test("DRIFT CAUGHT: filterType switched to the manual condition builder, which cannot express the join at all", () => {
  const workflow = { nodes: [nodeWithParams({ filterType: "manual" }), LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => /filterType is "manual", expected "string"/.test(i)));
});

test("DRIFT CAUGHT: ordering reversed — L-19 would nudge the NEWEST ask instead of the longest-waiting one", () => {
  const workflow = {
    nodes: [
      nodeWithParams({ filterString: FILTER_STRING.replace("created_at.asc", "created_at.desc") }),
      LIVE_UPSTREAM_NODE,
    ],
    connections: CONNECTIONS,
  };
  assert.equal(structuralNodeIssues(workflow, ENTRY).length, 1);
});

test("DRIFT CAUGHT: returnAll flipped on — one Zendesk ticket would issue an unbounded number of PostgREST requests", () => {
  const workflow = { nodes: [nodeWithParams({ returnAll: true }), LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), [
    "returnAll is true (effectively true), expected false",
  ]);
});

test("DRIFT CAUGHT: spliced somewhere else on the graph (the rows would be unreachable and every consentRecordId null again)", () => {
  const workflow = {
    nodes: [LIVE_CONSENT_LOOKUP_NODE, LIVE_UPSTREAM_NODE],
    connections: {
      [UPSTREAM_NODE]: { main: [[{ node: DOWNSTREAM_NODE }]] },
      [NODE_NAME]: { main: [[{ node: "Append Audit Log" }]] },
    },
  };
  const issues = structuralNodeIssues(workflow, ENTRY);
  assert.ok(issues.some((i) => /output 0 connects to "Append Audit Log", expected "Identity \+ Policy Gates"/.test(i)));
  assert.ok(issues.some((i) => /upstream node "Fetch Employment \(Remote\)" does not connect to "Lookup Consent Records"/.test(i)));
});

test("THE BYPASS: Fetch Employment (Remote) fanned back out to the gates in parallel — checked by its own entry", () => {
  // The lookup's own expectedInputs still passes here (the wire to it exists),
  // so without the upstream entry this shape is invisible: the gates would
  // read an employment off $input, nothing would error, and the consent rows
  // would simply never be consulted — R7-18 returning silently.
  const workflow = {
    nodes: [LIVE_CONSENT_LOOKUP_NODE, LIVE_UPSTREAM_NODE],
    connections: {
      [UPSTREAM_NODE]: { main: [[{ node: NODE_NAME }, { node: DOWNSTREAM_NODE }]] },
      [NODE_NAME]: { main: [[{ node: DOWNSTREAM_NODE }]] },
    },
  };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), [], "the lookup's own entry sees nothing wrong");
  const issues = structuralNodeIssues(workflow, UPSTREAM_ENTRY);
  assert.ok(issues.some((i) => /also connects to "Identity \+ Policy Gates"/.test(i)), issues.join(" | "));
});

// --- NEGATIVE CONTROLS: reading absent as default must not become
// --- "accept anything". Each of these starts from the PRUNED live shape and
// --- sets ONE key to a genuinely wrong EXPLICIT value.

test("NEGATIVE CONTROL: returnAll explicitly true on the UI-saved node is still caught", () => {
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, returnAll: true },
  };
  assert.deepEqual(structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY), [
    "returnAll is true (effectively true), expected false",
  ]);
});

test("NEGATIVE CONTROL: limit raised off 50 on the UI-saved node is still caught", () => {
  // 1000 is where PostgREST's own pagination caveats start; the point is only
  // that an explicit non-default value is never silently accepted.
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, limit: 1000 },
  };
  assert.deepEqual(structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY), [
    "limit is 1000 (effectively 1000), expected 50",
  ]);
});

test("NEGATIVE CONTROL: limit dropped to 1 — a real consent row beyond the first would be invisible", () => {
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, limit: 1 },
  };
  assert.deepEqual(structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY), [
    "limit is 1 (effectively 1), expected 50",
  ]);
});

test("NEGATIVE CONTROL: resource explicitly set to something other than row is still caught", () => {
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, resource: "storage" },
  };
  assert.deepEqual(structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY), [
    'resource is "storage" (effectively "storage"), expected "row"',
  ]);
});

test("NEGATIVE CONTROL: operation is NOT read through a default — absent would mean create, i.e. a WRITE", () => {
  // "getAll" is not the Supabase node's default operation ("create" is), so
  // this key can never legitimately be pruned. Absent here is a real defect.
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, operation: undefined },
  };
  assert.deepEqual(structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY), [
    'operation is undefined, expected "getAll"',
  ]);
});

test("NEGATIVE CONTROL: everything else still checked on the UI-saved shape (the join filter is not defaultable)", () => {
  const node = {
    ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED,
    parameters: { ...LIVE_CONSENT_LOOKUP_NODE_UI_SAVED.parameters, filterString: "=select=*" },
  };
  const issues = structuralNodeIssues({ nodes: [node, LIVE_UPSTREAM_NODE], connections: CONNECTIONS }, ENTRY);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^filterString is /);
});

test("green again: the same snapshot, unmutated, passes after every drift test above ran red", () => {
  const workflow = { nodes: [LIVE_CONSENT_LOOKUP_NODE, LIVE_UPSTREAM_NODE], connections: CONNECTIONS };
  assert.deepEqual(structuralNodeIssues(workflow, ENTRY), []);
  assert.deepEqual(structuralNodeIssues(workflow, UPSTREAM_ENTRY), []);
  assert.deepEqual(consentLookupParamIssues(LIVE_CONSENT_LOOKUP_NODE), []);
});
