// ---------------------------------------------------------------------------
// appendAuditLogSpec.js — UC-06's `Append Audit Log` Supabase node, as data
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS (2026-09-02). The n8n graph `WORKFLOW_UC06_ID` writes
// its decision row from a Supabase node whose `details` field is an n8n
// EXPRESSION typed into a node parameter — not a Code node, so
// `npm run verify-deployed` was structurally blind to it and nothing in this
// repository stated what it should say. The expert review of the live path
// found the rows it wrote carried `cutoffCycle: "standin-nl-2026-10"` with NO
// `cutoffCycleProjected` and NO `cutoffCycleStandin` — the two fields
// src/uc06/workflow.js has written since 2026-08-18 so that an auditor is TOLD
// a cycle was projected rather than left to infer it from an id prefix. Contract
// §8 invariant 13, held on one execution path and not the other.
//
// This is the one authority for that expression. scripts/deploy-uc06-audit-
// details.mjs publishes it and reads it back; appendAuditLogParamIssues() is
// what the read-back is checked with, and a test pins the two disclosure keys
// so a later edit cannot drop them again.
//
// EVERY VALUE IS READ OFF THE GATES NODE'S OWN OUTPUT. `cutoff.cycle` is the
// calendar row the twin chose, carried verbatim (the bridge's `_standin` block
// rides on it); `source` is the intake path the webhook normaliser recorded, or
// `n8n` when it recorded none — never a literal claiming a channel this node
// cannot know.
// ---------------------------------------------------------------------------

export const WORKFLOW_ID = "WORKFLOW_UC06_ID";
export const NODE_NAME = "Append Audit Log";
export const NODE_TYPE = "n8n-nodes-base.supabase";
export const TABLE_ID = "audit_log";

const G = "$('Amendment Gates').item.json";

export const DETAILS_EXPRESSION =
  `={{ ({ amendmentId: $('Create Amendment Record').item.json.id, externalRef: ${G}.externalRef, ` +
  `source: ${G}.source || 'n8n', employmentId: ${G}.employmentId, amendmentType: ${G}.amendmentType, ` +
  `changes: ${G}.changes, reason: ${G}.reason, flags: ${G}.flags, requestedEffectiveDate: ${G}.requestedEffectiveDate, ` +
  `cutoffCycle: ${G}.cutoff && ${G}.cutoff.cycle ? ${G}.cutoff.cycle.id : null, ` +
  `cutoffCycleProjected: Boolean(${G}.cutoff && ${G}.cutoff.cycle && (${G}.cutoff.cycle._standin || String(${G}.cutoff.cycle.id || '').indexOf('standin-') === 0)), ` +
  `cutoffCycleStandin: ${G}.cutoff && ${G}.cutoff.cycle && ${G}.cutoff.cycle._standin ? ${G}.cutoff.cycle._standin : null, ` +
  `summary: ${G}.summary ?? null, ` +
  `payrollCountry: ${G}.employment ? ${G}.employment.country_code : null, ` +
  `payrollCycleIds: (${G}.payrollCycles ?? []).map(c => c.id), upstreamFailures: ${G}.upstreamFailures }) }}`;

/** The keys the deployed expression MUST carry; the read-back is checked against these. */
export const REQUIRED_DETAIL_KEYS = Object.freeze([
  "amendmentId",
  "externalRef",
  "source",
  "employmentId",
  "amendmentType",
  "changes",
  "reason",
  "flags",
  "requestedEffectiveDate",
  "cutoffCycle",
  "cutoffCycleProjected",
  "cutoffCycleStandin",
  "summary",
  "payrollCountry",
  "payrollCycleIds",
  "upstreamFailures",
]);

/**
 * @param {object|null|undefined} node  the live node as the n8n REST API returns it
 * @returns {string[]} issues; empty means the node matches this spec
 */
export function appendAuditLogParamIssues(node) {
  const issues = [];
  if (!node) return ["node is missing"];
  if (node.type !== NODE_TYPE) issues.push(`type is ${JSON.stringify(node.type)}, expected ${JSON.stringify(NODE_TYPE)}`);
  const p = node.parameters ?? {};
  if (p.tableId !== TABLE_ID) issues.push(`tableId is ${JSON.stringify(p.tableId)}, expected ${JSON.stringify(TABLE_ID)}`);
  const values = p.fieldsUi?.fieldValues ?? [];
  const details = values.find((v) => v.fieldId === "details");
  if (!details) {
    issues.push('field "details" is missing');
  } else if (details.fieldValue !== DETAILS_EXPRESSION) {
    issues.push('field "details" differs from the spec');
    for (const key of REQUIRED_DETAIL_KEYS) {
      if (!String(details.fieldValue).includes(`${key}:`)) issues.push(`field "details" does not write ${key}`);
    }
  }
  return issues;
}
