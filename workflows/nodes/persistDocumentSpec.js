// ---------------------------------------------------------------------------
// persistDocumentSpec.js — the single versioned source of truth for the
// "Persist Document" Supabase node on UC-01's live graph (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-uim / DRIFT-086)
//
// "Persist Document" is a Supabase node with NO jsCode — same shape as
// "Route by Decision" (rca-vqe's routeByDecisionSpec.js), and for the same
// reason this needs its own file: scripts/verify-deployed-nodes.mjs's
// MAPPINGS diffs a `jsCode` string, so it is structurally blind to a node
// that has none. Before this bead there was no persist step here at all —
// Render Letter posted straight to Reply + Solve Ticket, and every letter a
// real customer received left no durable copy (see the bead's own evidence).
//
// This file is the ONE place the node's target shape is written down as
// data, held against it by two separate checks:
//
//   1. scripts/deploy-uc01-persist-document.mjs builds the live node's
//      `parameters` directly from FIELDS below (not by re-typing the field
//      list a second time), so the deployed node and this spec cannot drift
//      from each other at deploy time.
//   2. scripts/verify-deployed-nodes.mjs's STRUCTURAL_MAPPINGS reads the
//      LIVE node back and asserts its tableId/operation/field expressions
//      and its position in the chain (strictly between UPSTREAM_NODE and
//      DOWNSTREAM_NODE) match this file — so a hand edit through the n8n UI
//      that repoints, drops, or waters down a field fails a deploy check
//      instead of silently reaching production. This is exactly the rca-c73
//      shape (a live edit invisible to every jsCode-based check) applied to
//      a Supabase node instead of a Switch node.
//   3. test/uc01PersistDocumentStructure.test.js proves this AGAINST A
//      COMMITTED SNAPSHOT of the live node — plus deliberately mutated
//      copies of it — hermetically, with no n8n access, the same discipline
//      test/n8nRouteByDecisionParity.test.js already uses for the switch.
// ---------------------------------------------------------------------------

export const NODE_NAME = "Persist Document";
export const NODE_TYPE = "n8n-nodes-base.supabase";
export const TABLE_ID = "documents";
export const OPERATION = "create";

/**
 * The n8n Supabase node's OWN default for `operation`, which is the same value
 * this spec wants. That coincidence is a trap, and it is the same one
 * webhookResponseSpec.js's RESPONSE_MODE_NODE_DEFAULT documents (f5336c3).
 *
 * n8n PRUNES any parameter equal to the node default before saving, so a node
 * saved THROUGH THE EDITOR stores no `operation` key at all — and comparing
 * `p.operation` strictly then reports a CORRECT node as drifted.
 *
 * Confirmed on 2026-08-28, three ways:
 *   1. n8n's own source — packages/nodes-base/nodes/Supabase/RowDescription.ts,
 *      `rowOperations[0].default === 'create'` (the Supabase node is
 *      unversioned; typeVersion 1 is the only version).
 *   2. The live graph — scripts/deploy-uc01-persist-document.mjs writes
 *      `resource`, `operation` and `dataToSend` explicitly via an API PUT
 *      (which prunes nothing), yet WORKFLOW_UC01_ID's "Persist Document" now
 *      carries only `["tableId","fieldsUi"]`. All SEVEN row-create Supabase
 *      nodes on that graph carry exactly that pair, while "Update Audit Log
 *      With Letter" — whose `operation: "update"` is NOT the default — keeps
 *      its key. Defaults pruned, non-defaults retained: the editor's signature.
 *   3. Behaviourally — in execution 9592 (unpinned, 2026-08-28) "Append Audit
 *      Log", "Persist Case" and "Claim Ticket (Idempotency)" all have the same
 *      key-pruned shape and all INSERTED rows, returning the generated `id`.
 *      Absent `operation` is `create` at runtime, not "unset".
 *
 * So: ABSENT MEANS DEFAULT, never "unset". Read through this constant.
 * `resource` ("row") and `dataToSend` ("defineBelow") are pruned for the same
 * reason and are deliberately NOT asserted here — appendAuditLogSpec.js's
 * header already records why asserting a key that has never been present is a
 * false alarm rather than a guard.
 */
export const OPERATION_NODE_DEFAULT = "create";

/**
 * Ordered `{fieldId, fieldValue}` pairs the live node's
 * `parameters.fieldsUi.fieldValues` must contain, one per `documents` column
 * this project ever writes: `case_id` (the NOT NULL FK onto `cases.id`,
 * threaded forward by "Carry Context Forward" from "Persist Case"'s own
 * insert response — nothing else on this graph exposes it), `type` (the
 * fixed string src/shared/caseStore.js#createDocument() and
 * src/uc01/workflow.js STEP 7b both use, "employment_verification_letter"),
 * `content` (the rendered letter, read straight off the context rather than
 * re-derived), and `content_hash` (computed by "Prepare Document",
 * immediately upstream, with the dependency-free sha256 CLAUDE.md §6 already
 * requires for an n8n Code node).
 */
export const FIELDS = [
  { fieldId: "case_id", fieldValue: "={{ $json.caseId }}" },
  { fieldId: "type", fieldValue: "={{ $json.documentType }}" },
  { fieldId: "content", fieldValue: "={{ $json.letterHtml }}" },
  { fieldId: "content_hash", fieldValue: "={{ $json.documentContentHash }}" },
];

/** Immediately upstream on the live graph — never Render Letter directly. */
export const UPSTREAM_NODE = "Prepare Document";

/**
 * The context-restoring node this chain eventually reaches. NOT "Reply +
 * Solve Ticket" directly — "Persist Document" is a Supabase row-create node,
 * so (like "Persist Case" and "Append Audit Log" before it) its OWN output
 * replaces $json with the inserted `documents` row, not the decision
 * context. Found live, not by inspection: the bead's own real-execution
 * proof (execution 6703, ticket #77) showed "Reply + Solve Ticket" reading
 * `$json.externalRef` / `$json.letterHtml` off that row — both absent — and
 * Zendesk refusing the update ("id must be an integer") before it could post
 * a reply with an undefined body. "Carry Context After Persist Document"
 * restores the context (from "Prepare Document", by name — same pattern as
 * "Carry Context After Claim"/"Carry Context After Records").
 *
 * rca-9lrm: NO LONGER immediately downstream of "Persist Document" itself —
 * "Update Audit Log With Letter" (workflows/nodes/updateAuditLogWithLetterSpec.js)
 * now sits strictly between the two, patching `audit_log.details` to name the
 * document this node's own insert just created. This constant still names the
 * right NODE (it is unaffected by what feeds it), just no longer the
 * immediately-adjacent one — see the "Persist Document" STRUCTURAL_MAPPINGS
 * row in scripts/lib/deployedNodeMappings.mjs for the updated wiring.
 */
export const DOWNSTREAM_NODE = "Carry Context After Persist Document";

/** The customer-facing action the whole chain exists to precede. */
export const FINAL_TARGET_NODE = "Reply + Solve Ticket";

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs): does the live node's tableId,
 * operation and field expressions match FIELDS above exactly?
 *
 * @param {object} node the live "Persist Document" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function persistDocumentParamIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};
  if (p.tableId !== TABLE_ID) issues.push(`tableId is ${JSON.stringify(p.tableId)}, expected ${JSON.stringify(TABLE_ID)}`);
  // `?? OPERATION_NODE_DEFAULT` — see that constant. An absent key is the n8n
  // editor having pruned a default-valued parameter, NOT an unset one. An
  // explicitly wrong value (e.g. "update", which would overwrite instead of
  // adding a row) still fails, because `??` only fills `undefined`/`null`.
  const operation = p.operation ?? OPERATION_NODE_DEFAULT;
  if (operation !== OPERATION) {
    issues.push(
      `operation is ${JSON.stringify(p.operation)} (effectively ${JSON.stringify(operation)}), ` +
        `expected ${JSON.stringify(OPERATION)}`
    );
  }

  const values = p.fieldsUi?.fieldValues ?? [];
  for (const field of FIELDS) {
    const actual = values.find((v) => v.fieldId === field.fieldId);
    if (!actual) {
      issues.push(`field "${field.fieldId}" is missing`);
    } else if (actual.fieldValue !== field.fieldValue) {
      issues.push(`field "${field.fieldId}" is ${JSON.stringify(actual.fieldValue)}, expected ${JSON.stringify(field.fieldValue)}`);
    }
  }
  const extra = values.filter((v) => !FIELDS.some((f) => f.fieldId === v.fieldId));
  for (const e of extra) issues.push(`unexpected extra field "${e.fieldId}"`);

  return issues;
}
