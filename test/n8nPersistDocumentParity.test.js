// ---------------------------------------------------------------------------
// n8nPersistDocumentParity.test.js — rca-uim / DRIFT-086
// ---------------------------------------------------------------------------
// L-15 / DRIFT-086: the live UC-01 auto_resolve chain was
// `Render Letter -> Reply + Solve Ticket` — the letter was composed, posted
// publicly, and NEVER STORED. See scripts/deploy-uc01-persist-document.mjs's
// own header and workflows/nodes/persistDocumentSpec.js for the full account.
//
// THREE THINGS THIS FILE PROVES, NEITHER NEEDS N8N ACCESS
//
//   1. "Carry Context Forward", "Prepare Document" and "Carry Context After
//      Persist Document" — the three Code nodes that make the fix work — are
//      CORRECT, run hermetically in a node:vm sandbox exactly like every
//      other Code-node parity test in this repo (test/uc01LetterParity.test.js
//      is the model). This covers the hand-written sha256 (byte-equal to
//      node:crypto's createHash("sha256") across boundary lengths and
//      Unicode — the exact thing
//      workflows/nodes-uc02/deriveReceiptFingerprint.js's own tests check for
//      its copy), the fail-closed guards, and — the actual bug, twice —
//      that `caseId` reaches "Prepare Document" at all, and that
//      "Reply + Solve Ticket" gets the real ctx back rather than reading off
//      "Persist Document"'s own Supabase insert response.
//   2. "the live-deploy checker (scripts/verify-deployed-nodes.mjs) actually
//      detects drift on THIS node" — the same
//      structuralNodeIssues()/persistDocumentParamIssues() functions the
//      live script calls, run here against a SNAPSHOT of the real
//      "Persist Document"/"Render Letter"/"Carry Context After Persist
//      Document" nodes and connections captured live from
//      `WORKFLOW_UC01_ID` on 2026-08-22 immediately after this bead's own
//      SECOND deploy (`versionId === activeVersionId ==
//      "f4b15f93-b4ac-4180-a61f-15922fbbea33"`, 35 nodes — see the deploy
//      script's own post-condition output), plus deliberately mutated copies
//      of that snapshot — proven red before proven green, same discipline
//      test/n8nRouteByDecisionParity.test.js already uses.
//   3. THE MISSING-RESTORE-NODE BUG ITSELF, reproduced from a real execution.
//      The bead's FIRST deploy (missing "Carry Context After Persist
//      Document") reached production and was driven by a real ticket
//      (#77) before this test caught it: "Persist Document" is a Supabase
//      row-create node, so its own output REPLACES $json with the inserted
//      `documents` row, and "Reply + Solve Ticket" read `$json.externalRef`/
//      `$json.letterHtml` off THAT row — both undefined. Zendesk refused the
//      update ("id must be an integer") before a reply with an undefined
//      body could be posted, which is what surfaced it; had the id merely
//      been well-formed the customer would have received a broken reply.
//      Verified independently in Postgres, not just in n8n: the `documents`
//      row itself IS correct — `content_hash` recomputed by Postgres's own
//      `digest()` matches the stored `content` byte for byte (case
//      `d5c90c4c-1d48-417b-8b1f-1c99669704d3`, document
//      `9b930add-eae3-431e-9125-9c28e3555aab`) — so the bug was purely in
//      what ran BETWEEN two correct nodes, which is exactly the class of bug
//      a single-node hermetic test cannot see and only a real execution (or
//      the two-node chain test below) can.
//
// Mutating the SNAPSHOT rather than the live graph is deliberate, and for the
// same reason rca-vqe's sibling test gives: `structuralNodeIssues()` is pure
// data-in/issues-out, so a captured-and-mutated fixture proves exactly as
// much about the CHECKER as a live edit-and-revert would, with none of the
// risk of a real customer's letter briefly having nowhere to be posted.
// `npm run verify-deployed` (exercised separately, live) is what proves the
// CURRENT deployment matches; this file proves the DETECTOR works.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { structuralNodeIssues } from "../scripts/lib/structuralNodeChecks.mjs";
import {
  NODE_NAME,
  NODE_TYPE,
  TABLE_ID,
  OPERATION,
  OPERATION_NODE_DEFAULT,
  UPSTREAM_NODE,
  DOWNSTREAM_NODE,
  FINAL_TARGET_NODE,
  persistDocumentParamIssues,
} from "../workflows/nodes/persistDocumentSpec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, "..", rel), "utf8");

// ---------------------------------------------------------------------------
// Part 1 — the two Code nodes, run hermetically
// ---------------------------------------------------------------------------

function runCode(file, sandboxExtras) {
  const body = read(file);
  const sandbox = Object.assign({ console }, sandboxExtras);
  vm.createContext(sandbox);
  const result = vm.runInContext(`(function(){${body}})()`, sandbox);
  return JSON.parse(JSON.stringify(result));
}

function runCarryContextForward({ gatesJson, persistCaseJson }) {
  const nodes = {
    "Identity + Policy Gates": { first: () => ({ json: gatesJson }) },
    "Persist Case": { first: () => ({ json: persistCaseJson }) },
  };
  return runCode("workflows/nodes/carryContextForward.js", { $: (name) => nodes[name] });
}

test('"Carry Context Forward" restores the gates context AND adds caseId from "Persist Case"', () => {
  const out = runCarryContextForward({
    gatesJson: { decision: "auto_resolve", employmentId: "e1", externalRef: "42" },
    persistCaseJson: { id: "case-uuid-123", use_case: "UC-01" },
  });
  assert.deepEqual(out, [
    { json: { decision: "auto_resolve", employmentId: "e1", externalRef: "42", caseId: "case-uuid-123" } },
  ]);
});

test('"Carry Context Forward" carries caseId as null rather than crashing if Persist Case returned none', () => {
  const out = runCarryContextForward({
    gatesJson: { decision: "human_review" },
    persistCaseJson: {}, // no id — should not happen live, but must not throw
  });
  assert.equal(out[0].json.caseId, null);
});

function runPrepareDocument(json) {
  return runCode("workflows/nodes/prepareDocument.js", { $input: { first: () => ({ json }) } });
}

test('"Prepare Document" stamps the fixed type and a sha256 hash of letterHtml, preserving the rest of the context', () => {
  const ctx = { caseId: "case-1", letterHtml: "<p>hello</p>", employmentId: "e1", decision: "auto_resolve" };
  const out = runPrepareDocument(ctx);
  assert.equal(out[0].json.documentType, "employment_verification_letter");
  assert.equal(out[0].json.documentContentHash, createHash("sha256").update("<p>hello</p>", "utf8").digest("hex"));
  // Everything else on ctx survives, including caseId and letterHtml itself —
  // "Persist Document"'s field expressions read $json.caseId/$json.letterHtml
  // directly, not a renamed copy.
  assert.equal(out[0].json.caseId, "case-1");
  assert.equal(out[0].json.letterHtml, "<p>hello</p>");
  assert.equal(out[0].json.employmentId, "e1");
});

test('"Prepare Document"\'s hand-written sha256 is byte-equal to node:crypto across boundary lengths and Unicode', () => {
  const cases = [
    "a",
    "héllo wörld 日本語 😀",
    "x".repeat(55),
    "x".repeat(56), // sha256's padding boundary
    "x".repeat(57),
    "x".repeat(64), // one full block
    "x".repeat(1000),
    "<!doctype html><html><body>employment verification letter with an unpaired surrogate \uD800 in it</body></html>",
  ];
  for (const content of cases) {
    const out = runPrepareDocument({ caseId: "c1", letterHtml: content });
    const expected = createHash("sha256").update(content, "utf8").digest("hex");
    assert.equal(out[0].json.documentContentHash, expected, `mismatch for ${JSON.stringify(content.slice(0, 30))}`);
  }
});

test('"Prepare Document" FAILS CLOSED — no caseId throws rather than posting a letter with nothing to store it under', () => {
  assert.throws(() => runPrepareDocument({ letterHtml: "<p>x</p>" }), /no caseId on context/);
});

test('"Prepare Document" FAILS CLOSED — missing or empty letterHtml throws rather than storing an empty document', () => {
  assert.throws(() => runPrepareDocument({ caseId: "c1" }), /no letterHtml on context/);
  assert.throws(() => runPrepareDocument({ caseId: "c1", letterHtml: "" }), /no letterHtml on context/);
});

test('"Prepare Document"\'s {type, content, contentHash} shape matches src/shared/caseStore.js#createDocument() for the SAME content', async () => {
  // Both execution paths must write the SAME document.type string and the
  // SAME hash algorithm for the same letter, or a specialist reading
  // `documents` cannot tell the two paths' rows apart or trust content_hash
  // as a genuine integrity check across them.
  const { CaseStore } = await import("../src/shared/caseStore.js");
  const store = new CaseStore();
  const caseRow = store.createCase({
    useCase: "UC-01",
    externalRef: "1",
    employmentId: "e1",
    decision: "auto_resolve",
    reason: "ok",
    flags: [],
    status: "resolved",
  });
  const letterHtml = "<!doctype html><html><body>Employment Verification Letter</body></html>";
  const nodeDoc = store.createDocument({ caseId: caseRow.id, type: "employment_verification_letter", content: letterHtml });

  const n8nOut = runPrepareDocument({ caseId: caseRow.id, letterHtml });

  assert.equal(n8nOut[0].json.documentType, nodeDoc.type);
  assert.equal(n8nOut[0].json.documentContentHash, nodeDoc.contentHash);
});

function runCarryContextAfterPersistDocument({ persistDocumentJson, prepareDocumentJson }) {
  const nodes = { "Prepare Document": { first: () => ({ json: prepareDocumentJson }) } };
  // `$json` (this node's own input — the raw Supabase insert response) is
  // deliberately given to the sandbox but never read by the real body, which
  // reads `$('Prepare Document')` by name instead. It is passed here so the
  // fixture below is honest about what a live execution would actually hand
  // this node, even though the fix never touches it.
  return runCode("workflows/nodes/carryContextAfterPersistDocument.js", { $json: persistDocumentJson, $: (name) => nodes[name] });
}

test('"Carry Context After Persist Document" restores externalRef/letterHtml from "Prepare Document", NOT from its own $json (the Supabase insert response)', () => {
  const prepareDocumentJson = {
    externalRef: "77",
    letterHtml: "<p>Employment Verification Letter</p>",
    caseId: "case-1",
    employmentId: "e1",
    decision: "auto_resolve",
  };
  // Exactly the shape "Persist Document" actually returns in production
  // (execution 6703): the inserted `documents` row, with none of the above.
  const supabaseInsertResponse = {
    id: "9b930add-eae3-431e-9125-9c28e3555aab",
    created_at: "2026-08-22T03:19:09.921334+00:00",
    case_id: "case-1",
    type: "employment_verification_letter",
    content: "<p>Employment Verification Letter</p>",
    content_hash: "36b3ed87d1d488ec29c1677b07d0ef26cc21faacc22e39d8208a1d11b97dafde",
  };
  const out = runCarryContextAfterPersistDocument({ persistDocumentJson: supabaseInsertResponse, prepareDocumentJson });
  assert.deepEqual(out, [{ json: prepareDocumentJson }]);
  // The specific field Zendesk refused on in production, reproduced here so
  // a regression fails a fast hermetic test instead of a real ticket:
  assert.equal(out[0].json.externalRef, "77", 'without the fix this reads undefined off the Supabase row, which is why Zendesk answered "id must be an integer"');
  assert.equal(out[0].json.letterHtml, "<p>Employment Verification Letter</p>");
});

test('REGRESSION REPRODUCTION: without "Carry Context After Persist Document", "Reply + Solve Ticket" would read externalRef/letterHtml straight off the Supabase insert response — both undefined (the exact production defect, ticket #77 / execution 6703)', () => {
  // Simulates the WRONG wiring this bead's first deploy shipped: Persist
  // Document -> Reply + Solve Ticket directly, with no restore node between
  // them. $json for the downstream node is simply whatever the upstream
  // node returned — there is no separate mechanism to "carry" it, which is
  // exactly why a restore node is required rather than optional plumbing.
  const persistDocumentOutput = {
    id: "9b930add-eae3-431e-9125-9c28e3555aab",
    case_id: "case-1",
    type: "employment_verification_letter",
    content: "<p>x</p>",
    content_hash: "abc123",
  };
  // "Reply + Solve Ticket"'s own expressions, evaluated the way n8n would:
  const idExpression = persistDocumentOutput.externalRef;
  const bodyExpression = persistDocumentOutput.letterHtml;
  assert.equal(idExpression, undefined, "reproduces the undefined ticket id Zendesk refused with \"id must be an integer\"");
  assert.equal(bodyExpression, undefined, "reproduces the undefined reply body the customer would have received had the id not been refused first");
});

// ---------------------------------------------------------------------------
// Part 2 — the live-deploy checker, proved against a real captured snapshot
// plus deliberately mutated copies
// ---------------------------------------------------------------------------

/**
 * Captured verbatim from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on
 * 2026-08-22, immediately after this bead's own
 * scripts/deploy-uc01-persist-document.mjs run
 * (`versionId === activeVersionId == "6ede7449-ed47-4353-aa56-9b6fd5d39e7d"`,
 * 34 nodes — see the deploy script's own post-condition output). Committed
 * rather than fetched live so this test is hermetic.
 */
const LIVE_PERSIST_DOCUMENT_NODE = {
  id: "9cdfeb43-6c8a-46cb-bf68-4ff10fc09da9",
  name: "Persist Document",
  type: "n8n-nodes-base.supabase",
  typeVersion: 1,
  position: [2800, 0],
  credentials: { supabaseApi: { id: "CRED_SUPABASE", name: "remote" } },
  parameters: {
    resource: "row",
    operation: "create",
    tableId: "documents",
    dataToSend: "defineBelow",
    fieldsUi: {
      fieldValues: [
        { fieldId: "case_id", fieldValue: "={{ $json.caseId }}" },
        { fieldId: "type", fieldValue: "={{ $json.documentType }}" },
        { fieldId: "content", fieldValue: "={{ $json.letterHtml }}" },
        { fieldId: "content_hash", fieldValue: "={{ $json.documentContentHash }}" },
      ],
    },
  },
};

/**
 * THE SAME NODE, CAPTURED AGAIN ON 2026-08-28 — after a hand save in the n8n
 * EDITOR (versionId "bd216ae4-a15d-4ed7-8445-67e67f84fddc", 38 nodes, active).
 *
 * `resource`, `operation` and `dataToSend` are gone because each equalled the
 * Supabase node's own default and n8n prunes those before saving. Nothing
 * about the node's behaviour changed: all SEVEN row-create Supabase nodes on
 * that graph now carry exactly `["tableId","fieldsUi"]`, and in execution 9592
 * (unpinned) three of them — "Append Audit Log", "Persist Case", "Claim Ticket
 * (Idempotency)" — INSERTED rows and returned the generated `id`, so absent
 * `operation` is `create` at runtime. Meanwhile "Update Audit Log With Letter"
 * KEPT its `operation` key, because "update" is not the default.
 *
 * A checker that read absent as "unset" reported this correct node as drifted.
 * Both snapshots are kept on purpose: the API-written one above (explicit
 * values, what a deploy script writes) and this UI-written one must BOTH read
 * green, because either can be what the next `verify-deployed` sees.
 */
const LIVE_PERSIST_DOCUMENT_NODE_UI_SAVED = {
  ...LIVE_PERSIST_DOCUMENT_NODE,
  parameters: {
    tableId: "documents",
    fieldsUi: LIVE_PERSIST_DOCUMENT_NODE.parameters.fieldsUi,
  },
};

const LIVE_RENDER_LETTER_NODE = {
  id: "2dd45f39-6315-45a4-b9b8-6c5d7fa8736b",
  name: "Render Letter",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2656, 0],
};

/**
 * Captured verbatim from `GET /api/v1/workflows/WORKFLOW_UC01_ID` on
 * 2026-08-22, after this bead's SECOND deploy — the one that added this node
 * once the first deploy's real-execution proof (ticket #77) showed
 * "Reply + Solve Ticket" reading undefined off "Persist Document"'s own
 * Supabase response.
 */
const LIVE_CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT_NODE = {
  id: "0f900502-08c5-4f30-8623-7c80b07240e4",
  name: "Carry Context After Persist Document",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2872, 0],
};

const LIVE_CONNECTIONS = {
  "Render Letter": { main: [[{ node: "Prepare Document", type: "main", index: 0 }]] },
  "Prepare Document": { main: [[{ node: "Persist Document", type: "main", index: 0 }]] },
  "Persist Document": { main: [[{ node: "Carry Context After Persist Document", type: "main", index: 0 }]] },
  "Carry Context After Persist Document": { main: [[{ node: "Reply + Solve Ticket", type: "main", index: 0 }]] },
};

function liveWorkflow({ persistDocumentOverride = {}, renderLetterOverride = {}, restoreOverride = {}, connections = LIVE_CONNECTIONS } = {}) {
  return {
    nodes: [
      {
        ...LIVE_PERSIST_DOCUMENT_NODE,
        ...persistDocumentOverride,
        parameters: { ...LIVE_PERSIST_DOCUMENT_NODE.parameters, ...persistDocumentOverride.parameters },
      },
      { ...LIVE_RENDER_LETTER_NODE, ...renderLetterOverride },
      { ...LIVE_CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT_NODE, ...restoreOverride },
    ],
    connections,
  };
}

/**
 * Same as `liveWorkflow()` but starting from the UI-SAVED (pruned) capture, so
 * a negative control can set ONE parameter to a genuinely wrong explicit value
 * without silently reintroducing the pruned keys around it.
 */
function uiSavedWorkflow(parameterOverrides = {}) {
  return {
    nodes: [
      {
        ...LIVE_PERSIST_DOCUMENT_NODE_UI_SAVED,
        parameters: { ...LIVE_PERSIST_DOCUMENT_NODE_UI_SAVED.parameters, ...parameterOverrides },
      },
      LIVE_RENDER_LETTER_NODE,
      LIVE_CARRY_CONTEXT_AFTER_PERSIST_DOCUMENT_NODE,
    ],
    connections: LIVE_CONNECTIONS,
  };
}

const PERSIST_DOCUMENT_ENTRY = {
  node: NODE_NAME,
  type: NODE_TYPE,
  checkParams: persistDocumentParamIssues,
  expectedOutputs: [DOWNSTREAM_NODE],
  expectedInputs: [UPSTREAM_NODE],
};

const RENDER_LETTER_ENTRY = {
  node: "Render Letter",
  type: "n8n-nodes-base.code",
  expectedOutputs: [UPSTREAM_NODE],
};

const RESTORE_ENTRY = {
  node: DOWNSTREAM_NODE,
  type: "n8n-nodes-base.code",
  expectedOutputs: [FINAL_TARGET_NODE],
};

test("sanity: NODE_NAME/TABLE_ID/OPERATION match the captured snapshot", () => {
  assert.equal(NODE_NAME, "Persist Document");
  assert.equal(TABLE_ID, "documents");
  assert.equal(OPERATION, "create");
});

test("the captured live snapshot matches the spec exactly (today's real baseline is green)", () => {
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), PERSIST_DOCUMENT_ENTRY), []);
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), RENDER_LETTER_ENTRY), []);
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), RESTORE_ENTRY), []);
});

test("the UI-SAVED live snapshot ALSO matches — absent means default, never unset", () => {
  const p = LIVE_PERSIST_DOCUMENT_NODE_UI_SAVED.parameters;
  assert.deepEqual(Object.keys(p), ["tableId", "fieldsUi"]);
  assert.equal(p.operation, undefined);
  assert.deepEqual(structuralNodeIssues(uiSavedWorkflow(), PERSIST_DOCUMENT_ENTRY), []);
});

test("the read-through default is the n8n NODE default, and it equals what this spec wants", () => {
  // Verified against n8n's own source on 2026-08-28: the Supabase node is
  // unversioned and RowDescription.ts's `operation` default is 'create'. If
  // that ever stops matching OPERATION, the read-through becomes a hole and
  // this test is what says so.
  assert.equal(OPERATION_NODE_DEFAULT, "create");
  assert.equal(OPERATION_NODE_DEFAULT, OPERATION);
});

// --- now induce real drift shapes, one at a time, and prove each is caught ---

test("DRIFT CAUGHT: the node removed entirely", () => {
  const wf = { nodes: [LIVE_RENDER_LETTER_NODE], connections: LIVE_CONNECTIONS };
  const issues = structuralNodeIssues(wf, PERSIST_DOCUMENT_ENTRY);
  assert.deepEqual(issues, ['no node named "Persist Document" — either it was renamed/removed in n8n, or this entry is stale']);
});

test("DRIFT CAUGHT: tableId repointed away from documents (e.g. a copy/paste from Append Audit Log)", () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ persistDocumentOverride: { parameters: { tableId: "audit_log" } } }),
    PERSIST_DOCUMENT_ENTRY
  );
  assert.ok(issues.some((i) => i.includes('tableId is "audit_log", expected "documents"')));
});

test("DRIFT CAUGHT: operation changed off create (e.g. to update — would silently overwrite instead of adding a row)", () => {
  const issues = structuralNodeIssues(
    liveWorkflow({ persistDocumentOverride: { parameters: { operation: "update" } } }),
    PERSIST_DOCUMENT_ENTRY
  );
  assert.ok(issues.some((i) => i.includes('operation is "update" (effectively "update"), expected "create"')));
});

test("DRIFT CAUGHT: content field silently repointed off the real letter (e.g. to a stale ctx.letter typo)", () => {
  const fieldValues = LIVE_PERSIST_DOCUMENT_NODE.parameters.fieldsUi.fieldValues.map((f) =>
    f.fieldId === "content" ? { ...f, fieldValue: "={{ $json.letter }}" } : f
  );
  const issues = structuralNodeIssues(
    liveWorkflow({ persistDocumentOverride: { parameters: { fieldsUi: { fieldValues } } } }),
    PERSIST_DOCUMENT_ENTRY
  );
  assert.ok(issues.some((i) => i.includes('field "content" is "={{ $json.letter }}"')));
});

test("DRIFT CAUGHT: case_id field dropped entirely (would fail every insert on the NOT NULL FK, or worse, be silently omitted)", () => {
  const fieldValues = LIVE_PERSIST_DOCUMENT_NODE.parameters.fieldsUi.fieldValues.filter((f) => f.fieldId !== "case_id");
  const issues = structuralNodeIssues(
    liveWorkflow({ persistDocumentOverride: { parameters: { fieldsUi: { fieldValues } } } }),
    PERSIST_DOCUMENT_ENTRY
  );
  assert.ok(issues.some((i) => i.includes('field "case_id" is missing')));
});

test('DRIFT CAUGHT: repointed to run BEFORE "Render Letter" instead of after (would try to persist a letter that does not exist yet)', () => {
  const drifted = {
    "Render Letter": { main: [[{ node: "Reply + Solve Ticket", type: "main", index: 0 }]] }, // bypasses Prepare Document
    "Persist Document": { main: [[{ node: "Reply + Solve Ticket", type: "main", index: 0 }]] },
  };
  const issues = structuralNodeIssues(liveWorkflow({ connections: drifted }), PERSIST_DOCUMENT_ENTRY);
  assert.ok(issues.some((i) => i.includes('upstream node "Prepare Document" does not connect to "Persist Document"')));
});

test('DRIFT CAUGHT: "Persist Document" repointed straight at "Reply + Solve Ticket", skipping "Carry Context After Persist Document" (THIS BEAD\'S OWN FIRST DEPLOY — production ran this shape for real, ticket #77, execution 6703, before the restore node existed)', () => {
  const drifted = {
    ...LIVE_CONNECTIONS,
    "Persist Document": { main: [[{ node: "Reply + Solve Ticket", type: "main", index: 0 }]] },
  };
  const issues = structuralNodeIssues(liveWorkflow({ connections: drifted }), PERSIST_DOCUMENT_ENTRY);
  assert.ok(
    issues.some((i) => i.includes('output 0 connects to "Reply + Solve Ticket", expected "Carry Context After Persist Document"')),
    `expected the skipped restore node to be flagged, got: ${JSON.stringify(issues)}`
  );
});

test('DRIFT CAUGHT: "Render Letter" repointed straight at "Reply + Solve Ticket", bypassing the persist step entirely (the ORIGINAL bug, DRIFT-086 itself)', () => {
  const drifted = { "Render Letter": { main: [[{ node: "Reply + Solve Ticket", type: "main", index: 0 }]] } };
  const issues = structuralNodeIssues(liveWorkflow({ connections: drifted }), RENDER_LETTER_ENTRY);
  assert.ok(
    issues.some((i) => i.includes('output 0 connects to "Reply + Solve Ticket", expected "Prepare Document"')),
    `expected the bypass to be flagged, got: ${JSON.stringify(issues)}`
  );
});

test('DRIFT CAUGHT: "Render Letter" fans out to BOTH "Prepare Document" and "Reply + Solve Ticket" (a live edit that adds a bypass without removing the fix — the ticket gets a letter posted by the OLD wire while the new persist step also runs, or races it)', () => {
  const drifted = {
    "Render Letter": {
      main: [
        [
          { node: "Prepare Document", type: "main", index: 0 },
          { node: "Reply + Solve Ticket", type: "main", index: 0 },
        ],
      ],
    },
  };
  const issues = structuralNodeIssues(liveWorkflow({ connections: drifted }), RENDER_LETTER_ENTRY);
  // The FIRST wire still matches ("Prepare Document"), so this is checking
  // that the EXTRA wire is what gets flagged — not a wrong-target report,
  // which is what the previous test already covers.
  assert.ok(
    issues.some((i) => i.includes('output 0 also connects to "Reply + Solve Ticket"')),
    `expected the extra fan-out wire to be flagged, got: ${JSON.stringify(issues)}`
  );
});

test("DRIFT CAUGHT: the node's n8n type changed (e.g. rebuilt as a Code node that never actually writes)", () => {
  const issues = structuralNodeIssues(liveWorkflow({ persistDocumentOverride: { type: "n8n-nodes-base.code" } }), PERSIST_DOCUMENT_ENTRY);
  assert.ok(issues.some((i) => i.includes('type is "n8n-nodes-base.code", expected "n8n-nodes-base.supabase"')));
});

test("DRIFT CAUGHT: the restore node itself removed/renamed", () => {
  const wf = { nodes: [LIVE_PERSIST_DOCUMENT_NODE, LIVE_RENDER_LETTER_NODE], connections: LIVE_CONNECTIONS };
  const issues = structuralNodeIssues(wf, RESTORE_ENTRY);
  assert.deepEqual(issues, [
    'no node named "Carry Context After Persist Document" — either it was renamed/removed in n8n, or this entry is stale',
  ]);
});

test('DRIFT CAUGHT: the restore node repointed away from "Reply + Solve Ticket"', () => {
  const drifted = {
    ...LIVE_CONNECTIONS,
    "Carry Context After Persist Document": { main: [[{ node: "Unrecognised Decision", type: "main", index: 0 }]] },
  };
  const issues = structuralNodeIssues(liveWorkflow({ connections: drifted }), RESTORE_ENTRY);
  assert.ok(issues.some((i) => i.includes('output 0 connects to "Unrecognised Decision", expected "Reply + Solve Ticket"')));
});

test("green again: the same snapshot, unmutated, passes after every drift test above ran red", () => {
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), PERSIST_DOCUMENT_ENTRY), []);
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), RENDER_LETTER_ENTRY), []);
  assert.deepEqual(structuralNodeIssues(liveWorkflow(), RESTORE_ENTRY), []);
});

// --- NEGATIVE CONTROLS: reading absent as default must not become
// --- "accept anything". Each starts from the PRUNED live shape and sets ONE
// --- key to a genuinely wrong EXPLICIT value.

test("NEGATIVE CONTROL: operation explicitly 'update' on the UI-saved node is still caught", () => {
  const issues = structuralNodeIssues(uiSavedWorkflow({ operation: "update" }), PERSIST_DOCUMENT_ENTRY);
  assert.deepEqual(issues, ['operation is "update" (effectively "update"), expected "create"']);
});

test("NEGATIVE CONTROL: operation explicitly 'getAll' — a read where a write belongs, no letter ever stored", () => {
  const issues = structuralNodeIssues(uiSavedWorkflow({ operation: "getAll" }), PERSIST_DOCUMENT_ENTRY);
  assert.deepEqual(issues, ['operation is "getAll" (effectively "getAll"), expected "create"']);
});

test("NEGATIVE CONTROL: everything else still checked on the UI-saved shape (tableId is not defaultable to ours)", () => {
  const issues = structuralNodeIssues(uiSavedWorkflow({ tableId: "audit_log" }), PERSIST_DOCUMENT_ENTRY);
  assert.deepEqual(issues, ['tableId is "audit_log", expected "documents"']);
});
