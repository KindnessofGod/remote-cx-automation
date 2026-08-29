// ---------------------------------------------------------------------------
// updateAuditLogWithLetterSpec.js — the single versioned source of truth for
// the "Update Audit Log With Letter" Supabase node on UC-01's live graph
// (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-9lrm, the n8n counterpart of rca-5vdx / commit
// 7e02e6c — GROUND 1 of the round-7 UC-01 verdict)
//
// "Append Audit Log" used to write `letterIssued: $json.decision ===
// 'auto_resolve'` — a BELIEF stamped onto the decision row before
// "Render Letter"/"Prepare Document"/"Persist Document" (all three still
// downstream of "Route by Decision", itself downstream of "Append Audit
// Log") had even attempted to render or store anything. A render or persist
// failure left a row claiming a letter that never existed, and one of
// round 7's disputed evidence rows (E-61, ref 113) went through exactly
// this path (see qa/evidence/UC-01/2026-08-23-uc01-e2e-7/ops/FINDINGS.md).
//
// Rather than reordering the whole fan-out ahead of "Route by Decision" —
// which would require restructuring how EVERY decision (not just
// auto_resolve) reaches an audit write, and adding new failure-handling
// branches to preserve "a durable decision row exists even when rendering
// fails" — this node is an "equivalent restructuring" (the bead's own
// words): "Append Audit Log" now always writes the honest default
// (`letterIssued: false, letterDocumentId: null, letterContentHash: null`,
// see workflows/nodes/appendAuditLogSpec.js), and THIS node sits
// immediately after "Persist Document" on the auto_resolve branch only,
// patching that SAME `audit_log` row to `letterIssued: true` plus the real
// `letterDocumentId`/`letterContentHash` — but only once "Persist Document"
// has actually returned a real inserted `documents` row.
//
// This makes `letterIssued: true` impossible to observe unless a real
// `documents` row exists, with no new error-handling graph surgery needed:
// "Append Audit Log" still runs first, unconditionally, on every branch, so
// the decision row is always durable before any document work is even
// attempted — and if "Render Letter", "Prepare Document" or "Persist
// Document" fails, this node simply never runs, leaving the row exactly
// what it already honestly said: no letter.
//
// Same field names as the Node.js fix (src/uc01/workflow.js STEP 7a) and
// the same UC-03 spelling (`letterDocument`/`letterContentHash`,
// src/uc03/`).
//
// SAME "no jsCode" SHAPE AS ITS SIBLINGS ("Persist Document", "Append Audit
// Log" itself, "Route by Decision", the webhook trigger, the three Zendesk
// close nodes) — scripts/verify-deployed-nodes.mjs's jsCode-diffing MAPPINGS
// is structurally blind to a Supabase node, so this file plus the
// STRUCTURAL_MAPPINGS row that reads it (scripts/lib/deployedNodeMappings.mjs)
// and test/n8nUpdateAuditLogWithLetterParity.test.js are the guard —
// shipped WITH this node, not as a follow-up bead.
// ---------------------------------------------------------------------------

export const NODE_NAME = "Update Audit Log With Letter";
export const NODE_TYPE = "n8n-nodes-base.supabase";
export const TABLE_ID = "audit_log";
export const OPERATION = "update";

/** Immediately upstream on the live graph. */
export const UPSTREAM_NODE = "Persist Document";

/**
 * Immediately downstream — the SAME context-restoring node "Persist
 * Document" used to feed directly (workflows/nodes/persistDocumentSpec.js's
 * own DOWNSTREAM_NODE), because this node is a Supabase update whose own
 * output replaces $json with the updated row, exactly like every other
 * Supabase node on this graph. "Carry Context After Persist Document" reads
 * `$('Prepare Document').first().json` BY NAME, not off $json, so it is
 * unaffected by which Supabase node ran immediately before it.
 */
export const DOWNSTREAM_NODE = "Carry Context After Persist Document";

/**
 * The one field this node writes: the SAME `audit_log.details` column
 * "Append Audit Log" wrote moments earlier, patched with the three letter
 * facts. The expression reads the ORIGINAL row's `details` (via `$('Append
 * Audit Log')`, not `$json`) so every other fact that row carries —
 * externalRef, classification, identity, requesterType, flags, reason —
 * survives the update untouched; only the three letter fields change.
 */
export const FIELDS = [
  {
    fieldId: "details",
    fieldValue:
      "={{ Object.assign({}, $('Append Audit Log').first().json.details, { letterIssued: true, letterDocumentId: $('Persist Document').first().json.id, letterContentHash: $('Persist Document').first().json.content_hash }) }}",
  },
];

/**
 * The filter that targets exactly the row "Append Audit Log" just inserted,
 * by its real Postgres id — never by a business key, since a retried run
 * on the SAME external ref never reaches this node twice (the idempotency
 * claim already stopped a redelivery upstream of "Append Audit Log").
 */
export const FILTER_KEY = "id";
export const FILTER_VALUE_EXPRESSION = "={{ $('Append Audit Log').first().json.id }}";

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs): does the live node's tableId,
 * operation, filter and field expressions match the constants above exactly?
 *
 * Modelled on `persistDocumentParamIssues` (workflows/nodes/persistDocumentSpec.js).
 *
 * @param {object} node the live "Update Audit Log With Letter" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function updateAuditLogWithLetterParamIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};
  if (p.tableId !== TABLE_ID) issues.push(`tableId is ${JSON.stringify(p.tableId)}, expected ${JSON.stringify(TABLE_ID)}`);
  if (p.operation !== OPERATION) issues.push(`operation is ${JSON.stringify(p.operation)}, expected ${JSON.stringify(OPERATION)}`);

  const conditions = p.filters?.conditions ?? [];
  const cond = conditions[0];
  if (!cond) {
    issues.push(`filter condition on "${FILTER_KEY}" is missing`);
  } else {
    if (cond.keyName !== FILTER_KEY) issues.push(`filter keyName is ${JSON.stringify(cond.keyName)}, expected ${JSON.stringify(FILTER_KEY)}`);
    if (cond.condition !== "eq") issues.push(`filter condition operator is ${JSON.stringify(cond.condition)}, expected "eq"`);
    if (cond.keyValue !== FILTER_VALUE_EXPRESSION) {
      issues.push(`filter keyValue is ${JSON.stringify(cond.keyValue)}, expected ${JSON.stringify(FILTER_VALUE_EXPRESSION)}`);
    }
  }
  if (conditions.length !== 1) issues.push(`filter has ${conditions.length} condition(s), expected 1`);

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
