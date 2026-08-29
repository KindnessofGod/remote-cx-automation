// ---------------------------------------------------------------------------
// appendAuditLogSpec.js — the single versioned source of truth for the
// "Append Audit Log" Supabase node on UC-01's live graph (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-2ix1, the 4th bead in this exact shape)
//
// "Append Audit Log" is a Supabase node with NO jsCode — the same shape as
// "Route by Decision" (rca-vqe), "Persist Document" (rca-uim / DRIFT-086),
// the webhook trigger (rca-ibh / F-4) and the three Zendesk close nodes
// (rca-zu3 / E3-F11/E3-F13). scripts/verify-deployed-nodes.mjs's MAPPINGS
// diffs a `jsCode` string, so it is structurally blind to a node that has
// none — a live hand-edit through the n8n UI passes every check silently.
//
// rca-kq7w fixed a real gap here: this node's `details` field carried no
// `requesterType` at all, so VC-29's identity-basis fact never reached
// `audit_log`. The fix wired `details.requesterType` to
// `$json.requesterType` — the DETERMINISTIC value
// `workflows/nodes/gates.js` builds from `requesterIdentity.requesterType`
// (gates.js:421-427), kept distinct from the classifier's raw, unmutated
// opinion still sitting on `classification.requesterType`. That fix shipped
// with NO guard: this file, and the STRUCTURAL_MAPPINGS row in
// scripts/verify-deployed-nodes.mjs that reads it, are the guard. Without
// them, a hand-edit that reverts `requesterType` to bind
// `classification.requesterType` instead of the top-level derived value —
// silently re-introducing the exact gap rca-kq7w closed — passes
// `npm run verify-deployed` with "0 drifted", because nothing was comparing
// this node's fields at all.
//
// Checked two ways, same discipline as every sibling spec above:
//   1. scripts/verify-deployed-nodes.mjs's STRUCTURAL_MAPPINGS reads the
//      LIVE node back and asserts its tableId and every field expression —
//      including `details`, checked as one exact string, so ANY change to
//      what it binds (not just `requesterType`) is caught — matches this
//      file exactly.
//   2. test/n8nAppendAuditLogParity.test.js proves this against a COMMITTED
//      SNAPSHOT of the live node (captured 2026-08-22, immediately after
//      rca-kq7w's fix — versionId === activeVersionId ==
//      "8055040f-d3ab-4596-bd0a-4d0dea5b9c20") plus deliberately mutated
//      copies of it, hermetically, with no n8n access — proven red before
//      green, including the EXACT regression this bead exists to prevent
//      (`details.requesterType` repointed back at
//      `$json.classification.requesterType`).
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT
//
// The live node carries no `resource`/`operation`/`dataToSend` parameters at
// all — unlike "Persist Document" and "Persist Case", which have
// `resource: "row"`, `operation: "create"`, `dataToSend: "defineBelow"`
// explicitly set. That is the REAL live shape (captured 2026-08-22), not an
// omission in this file: asserting an `operation` field that has never been
// present on this node would make the checker permanently red on a
// currently-correct deployment, which is worse than not checking it at all.
// If a future republish adds those keys, `persistDocumentParamIssues`'s
// pattern (workflows/nodes/persistDocumentSpec.js) is the one to copy then.
//
// This spec also does not assert the node's position in the connection chain
// (upstream/downstream), unlike some siblings above. "Append Audit Log" fans
// its single output to TWO nodes on purpose ("Carry Context Forward" and
// "Collect Trace Steps"), and `structuralNodeIssues()`'s `expectedOutputs`
// check (scripts/lib/structuralNodeChecks.mjs) treats any second wire on one
// output index as unconditional drift — correct for every other entry in
// STRUCTURAL_MAPPINGS, which are all single-target, and wrong for this one.
// Extending that shared checker to model an intentional multi-target fan-out
// is out of scope for this bead; the FIELD-level guard is what closes the
// actual regression rca-kq7w fixed. If this node's position needs pinning
// later, that is its own bead, not a silent addition here.
//
// rca-8hl8 / R7-27 — the audit row had no `caseId` and no `source`. Four
// decisions on four employments in five seconds read as one batch exercise or
// four independent requests with no way to tell which; there was also no way
// to join a row here back to its `cases` row at all. The Node path already
// writes both (src/uc01/workflow.js's `details.caseId`/`details.source`).
// Both are now available at this point in the n8n graph without any rewiring:
// `Persist Case` (id `3108e9ed-40cf-475b-974e-ef2d78dc9808`) already runs
// BEFORE this node — `Persist Case → Carry Context After Records → Append
// Audit Log` — so `caseId` is read from its Supabase insert response via
// `$('Persist Case').first().json.id`, the same lookup `Queue Gate —
// Specialist Needed?` already uses for the identical reason
// (scripts/add-uc01-case-nodes.mjs). `source` is `$json.source`, carried
// through unchanged from `Normalize Ticket` (`source: 'zendesk'`) the whole
// way — same fallback `Persist Case`'s own `source` field already uses
// (`|| 'zendesk'`), same default the Node path applies (`ticket.source ??
// "zendesk"`).
//
// rca-9lrm — GROUND 1, the n8n counterpart of rca-5vdx (commit 7e02e6c).
// `letterIssued` used to be written here as `$json.decision === 'auto_resolve'`
// — a BELIEF derived from the decision, stamped onto the row at the moment
// this node runs, which is BEFORE "Render Letter"/"Prepare Document"/
// "Persist Document" (three nodes downstream of "Route by Decision", itself
// downstream of this node — see workflows/README.md's "Audit ordering"
// section) have even attempted to render or store anything. A render or
// persist failure on that branch left a row claiming a letter that never
// existed, and at least one round-7 disputed evidence row (E-61, ref 113)
// went through exactly this path.
//
// FIXED WITHOUT MOVING THIS NODE (an "equivalent restructuring", per the
// bead's own text) rather than reordering the whole fan-out ahead of
// "Route by Decision": this node now writes `letterIssued: false,
// letterDocumentId: null, letterContentHash: null` unconditionally — never a
// claim, only ever the honest default — and a NEW node,
// "Update Audit Log With Letter" (workflows/nodes/updateAuditLogWithLetterSpec.js),
// sits immediately after "Persist Document" on the auto_resolve branch and
// patches THIS SAME `audit_log` row to `letterIssued: true` plus the real
// `letterDocumentId`/`letterContentHash` — but ONLY once "Persist Document"
// has actually returned a real inserted `documents` row. Two properties fall
// out of this for free, with no new failure-handling branch required:
//   1. The decision row is ALWAYS durable before any document work starts —
//      this node still runs first, unconditionally, on every branch.
//   2. `letterIssued: true` is IMPOSSIBLE to observe unless a real `documents`
//      row was actually created — if "Render Letter", "Prepare Document" or
//      "Persist Document" fails, the update node never runs, and the row
//      this node wrote stays exactly what it says: no letter.
// Same field names as the Node.js fix (src/uc01/workflow.js STEP 7a) and the
// same UC-03 spelling (`letterDocument`/`letterContentHash`).
// ---------------------------------------------------------------------------

export const NODE_NAME = "Append Audit Log";
export const NODE_TYPE = "n8n-nodes-base.supabase";
export const TABLE_ID = "audit_log";

/**
 * Ordered `{fieldId, fieldValue}` pairs the live node's
 * `parameters.fieldsUi.fieldValues` must contain — one per `audit_log`
 * column this node writes. `details` is the field rca-kq7w changed and the
 * one most worth guarding: it is checked as ONE exact string, so a
 * regression that repoints `requesterType` at
 * `$json.classification.requesterType` (the classifier's raw, unreconciled
 * opinion — see gates.js:413-427) instead of the top-level derived value
 * fails this check even though both are technically "a requesterType".
 */
export const FIELDS = [
  { fieldId: "use_case", fieldValue: "UC-01" },
  { fieldId: "action", fieldValue: "={{ $json.decision }}" },
  {
    fieldId: "actor",
    fieldValue: '={{ $json.session ? $json.session.authenticatedEmail : "unauthenticated" }}',
  },
  { fieldId: "risk_tier", fieldValue: "={{ $json.riskTier }}" },
  {
    fieldId: "details",
    fieldValue:
      "={{ ({ caseId: $('Persist Case').first().json.id, externalRef: $json.externalRef, source: $json.source || 'zendesk', employmentId: $json.employmentId, classification: $json.classification, identity: $json.identity, requesterType: $json.requesterType, flags: $json.flags, reason: $json.reason, letterIssued: false, letterDocumentId: null, letterContentHash: null }) }}",
  },
];

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs): does the live node's tableId and
 * field expressions match FIELDS above exactly?
 *
 * Modelled on `persistDocumentParamIssues`
 * (workflows/nodes/persistDocumentSpec.js) minus the `operation` check — see
 * this file's header for why that field is deliberately not asserted here.
 *
 * @param {object} node the live "Append Audit Log" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function appendAuditLogParamIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};
  if (p.tableId !== TABLE_ID) {
    issues.push(`tableId is ${JSON.stringify(p.tableId)}, expected ${JSON.stringify(TABLE_ID)}`);
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
