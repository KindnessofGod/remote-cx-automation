// ---------------------------------------------------------------------------
// deployedNodeMappings.mjs — the canonical MAPPINGS / STRUCTURAL_MAPPINGS
// tables, importable without triggering a live n8n fetch
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS (rca-rqeo)
//
// These two tables used to live inline in scripts/verify-deployed-nodes.mjs,
// which is fine for that script (it is the only consumer) right up until a
// SECOND consumer needs them without also running the live check — which is
// exactly what a coverage/inventory tool needs: "which live nodes are NOT in
// these tables" has to know the tables without fetching n8n or exiting 2 when
// N8N_API_KEY is unset. verify-deployed-nodes.mjs itself now imports from
// here too, so there is exactly one copy of "what do we check" — a script
// that only READS this file (an inventory generator, a test) cannot drift
// from the script that actually enforces it, because they share the same
// array objects.
// ---------------------------------------------------------------------------

import { RULES as ROUTE_RULES, FALLBACK as ROUTE_FALLBACK, SWITCH_NODE_NAME } from "../../workflows/nodes/routeByDecisionSpec.js";
import {
  NODE_NAME as PERSIST_DOCUMENT_NODE_NAME,
  NODE_TYPE as PERSIST_DOCUMENT_NODE_TYPE,
  UPSTREAM_NODE as PERSIST_DOCUMENT_UPSTREAM_NODE,
  DOWNSTREAM_NODE as PERSIST_DOCUMENT_DOWNSTREAM_NODE,
  FINAL_TARGET_NODE as PERSIST_DOCUMENT_FINAL_TARGET_NODE,
  persistDocumentParamIssues,
} from "../../workflows/nodes/persistDocumentSpec.js";
import {
  NODE_NAME as WEBHOOK_NODE_NAME,
  NODE_TYPE as WEBHOOK_NODE_TYPE,
  webhookResponseParamIssues,
} from "../../workflows/nodes/webhookResponseSpec.js";
import {
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
  REPLY_CLOSE_NODE_NAME,
  ZENDESK_NODE_TYPE as ESCALATION_CLOSE_NODE_TYPE,
  noteNodeParamIssues,
  replyCloseParamIssues,
} from "../../workflows/nodes/escalationCloseNodesSpec.js";
import {
  NODE_NAME as APPEND_AUDIT_LOG_NODE_NAME,
  NODE_TYPE as APPEND_AUDIT_LOG_NODE_TYPE,
  appendAuditLogParamIssues,
} from "../../workflows/nodes/appendAuditLogSpec.js";
import {
  NODE_NAME as UPDATE_AUDIT_LOG_WITH_LETTER_NODE_NAME,
  NODE_TYPE as UPDATE_AUDIT_LOG_WITH_LETTER_NODE_TYPE,
  UPSTREAM_NODE as UPDATE_AUDIT_LOG_WITH_LETTER_UPSTREAM_NODE,
  DOWNSTREAM_NODE as UPDATE_AUDIT_LOG_WITH_LETTER_DOWNSTREAM_NODE,
  updateAuditLogWithLetterParamIssues,
} from "../../workflows/nodes/updateAuditLogWithLetterSpec.js";
import {
  NODE_NAME as CONSENT_LOOKUP_NODE_NAME,
  NODE_TYPE as CONSENT_LOOKUP_NODE_TYPE,
  UPSTREAM_NODE as CONSENT_LOOKUP_UPSTREAM_NODE,
  DOWNSTREAM_NODE as CONSENT_LOOKUP_DOWNSTREAM_NODE,
  consentLookupParamIssues,
} from "../../workflows/nodes/consentLookupSpec.js";
import { structuralNodeIssues, switchRuleIssues } from "./structuralNodeChecks.mjs";

/**
 * Every deployed Code node that is supposed to be a copy of a file in this
 * repo. Add a row whenever a workflow gains a Code node backed by a real file.
 */
export const MAPPINGS = [
  // All FOUR UC-01 Code nodes, not just the gates. Checking one node was how
  // the 2026-08-16 outage happened twice over: the gates were synced, the two
  // nodes upstream were not, and the mismatch between them disabled
  // auto-resolve entirely. A partial mapping is a checker that reports success
  // about the part you already fixed.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Normalize Ticket",
    file: "workflows/nodes/normalizeTicket.js",
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Validate Classification",
    file: "workflows/nodes/validateClassification.js",
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Identity + Policy Gates",
    file: "workflows/nodes/gates.js",
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Render Letter",
    file: "workflows/nodes/renderLetter.js",
  },
  // rca-dy0 — the node Render Letter's own throw was written to require. Not
  // in the original four: it did not exist until the deploy-blocking gap it
  // closes was found.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Normalize Legal Entity",
    file: "workflows/nodes/normalizeLegalEntity.js",
  },
  // rca-c73 — the node blocked/awaiting_employee_consent/deflected_to_self_service
  // needed before "Route by Decision" could route them instead of losing them
  // to the Unrecognised Decision fallback.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Prepare Refusal Reply",
    file: "workflows/nodes/prepareRefusalReply.js",
  },
  // rca-uim — DRIFT-086: the auto_resolve chain posted the letter with no
  // durable copy. "Carry Context Forward" never had a backing file at all
  // (none of the three "Carry Context ..." nodes do); it gets one now
  // because this bead has to edit its body anyway, to carry `caseId`
  // forward from "Persist Case" for "Prepare Document"/"Persist Document"
  // (the latter a Supabase node with no jsCode — see STRUCTURAL_MAPPINGS
  // below and workflows/nodes/persistDocumentSpec.js) to write.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Carry Context Forward",
    file: "workflows/nodes/carryContextForward.js",
  },
  // F-7 (rca-1rx) — the human_review internal note was three fields and a raw
  // slug; this node ports policyEngine.js's GATE_SEQUENCE/describeDecisionFacts
  // verbatim so the note carries the same "means" sentence and figures the
  // ZAF sidebar and the Node execution path already do. See its own header.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Compose Internal Note",
    file: "workflows/nodes/composeInternalNote.js",
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Prepare Document",
    file: "workflows/nodes/prepareDocument.js",
  },
  // rca-uim, found by this bead's OWN live proof (execution 6703, ticket
  // #77): "Persist Document" is a Supabase row-create node, so its output
  // replaces $json with the inserted `documents` row — "Reply + Solve
  // Ticket" cannot read `externalRef`/`letterHtml` off it directly. See
  // workflows/nodes/persistDocumentSpec.js's DOWNSTREAM_NODE comment.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Carry Context After Persist Document",
    file: "workflows/nodes/carryContextAfterPersistDocument.js",
  },
  {
    workflowId: "WORKFLOW_UC06_ID",
    workflow: "UC-06 — Contract Amendment / Payroll Cutoff",
    node: "Amendment Gates",
    file: "workflows/nodes-uc06/amendmentGates.js",
  },
  {
    workflowId: "WORKFLOW_UC06_ID",
    workflow: "UC-06 — Contract Amendment / Payroll Cutoff",
    node: "Normalize Amendment Request",
    file: "workflows/nodes-uc06/normalizeAmendmentRequest.js",
  },
  {
    workflowId: "WORKFLOW_UC08_ID",
    workflow: "UC-08 — Cross-Border Tax & Social Security",
    node: "Build Dossier",
    file: "workflows/nodes-uc08/buildDossier.js",
  },
  {
    workflowId: "WORKFLOW_UC08_ID",
    workflow: "UC-08 — Cross-Border Tax & Social Security",
    node: "Normalize Inquiry",
    file: "workflows/nodes-uc08/normalizeInquiry.js",
  },
  { workflowId: "WORKFLOW_UC02_ID", workflow: "UC-02 — Expense & Receipt Validation", node: "Normalize Expense Submission", file: "workflows/nodes-uc02/normalizeExpenseSubmission.js" },
  { workflowId: "WORKFLOW_UC02_ID", workflow: "UC-02 — Expense & Receipt Validation", node: "Prepare Classification Prompt", file: "workflows/nodes-uc02/prepareClassificationPrompt.js" },
  { workflowId: "WORKFLOW_UC02_ID", workflow: "UC-02 — Expense & Receipt Validation", node: "Expense Gates", file: "workflows/nodes-uc02/expenseGates.js" },
  { workflowId: "WORKFLOW_UC03_ID", workflow: "UC-03 — Travel Support Letter / Workation Router", node: "Normalize Inquiry", file: "workflows/nodes-uc03/normalizeInquiry.js" },
  { workflowId: "WORKFLOW_UC03_ID", workflow: "UC-03 — Travel Support Letter / Workation Router", node: "Travel Router Gates", file: "workflows/nodes-uc03/travelRouterGates.js" },
  { workflowId: "WORKFLOW_UC04_ID", workflow: "UC-04 — Work Authorization / Workation", node: "Normalize Workation Request", file: "workflows/nodes-uc04/normalizeWorkationRequest.js" },
  { workflowId: "WORKFLOW_UC04_ID", workflow: "UC-04 — Work Authorization / Workation", node: "Workation Gates", file: "workflows/nodes-uc04/workationGates.js" },
  { workflowId: "WORKFLOW_UC05_ID", workflow: "UC-05 — Resignation Notice Calculation", node: "Normalize Resignation Request", file: "workflows/nodes-uc05/normalizeResignationRequest.js" },
  { workflowId: "WORKFLOW_UC05_ID", workflow: "UC-05 — Resignation Notice Calculation", node: "Notice Period Gates", file: "workflows/nodes-uc05/noticePeriodGates.js" },
  { workflowId: "WORKFLOW_UC07_ID", workflow: "UC-07 — Global Mobility / Permanent Relocation", node: "Normalize Relocation Request", file: "workflows/nodes-uc07/normalizeRelocationRequest.js" },
  { workflowId: "WORKFLOW_UC07_ID", workflow: "UC-07 — Global Mobility / Permanent Relocation", node: "Relocation Gates", file: "workflows/nodes-uc07/relocationGates.js" },
  { workflowId: "WORKFLOW_UC09_ID", workflow: "UC-09 — Off-Cycle Payroll Adjustment", node: "Normalize Adjustment Request", file: "workflows/nodes-uc09/normalizeAdjustmentRequest.js" },
  { workflowId: "WORKFLOW_UC09_ID", workflow: "UC-09 — Off-Cycle Payroll Adjustment", node: "Adjustment Gates", file: "workflows/nodes-uc09/adjustmentGates.js" },

  // The per-attempt audit trace (§4 invariant 7), deployed byte-identical to all
  // nine graphs from ONE file — it reads the use case, decision and external ref
  // back off the audit row it hangs from, so nothing in it is per-workflow.
  // Nine rows against one file is the point: if the body is ever hand-edited in
  // the n8n UI for one use case, that graph drifts and this says which.
  { workflowId: "WORKFLOW_UC01_ID", workflow: "UC-01 — Employment Verification", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC02_ID", workflow: "UC-02 — Expense & Receipt Validation", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC03_ID", workflow: "UC-03 — Travel Support Letter / Workation Router", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC04_ID", workflow: "UC-04 — Work Authorization / Workation", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC05_ID", workflow: "UC-05 — Resignation Notice Calculation", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC06_ID", workflow: "UC-06 — Contract Amendment / Payroll Cutoff", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC07_ID", workflow: "UC-07 — Global Mobility / Permanent Relocation", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC08_ID", workflow: "UC-08 — Cross-Border Tax & Social Security", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  { workflowId: "WORKFLOW_UC09_ID", workflow: "UC-09 — Off-Cycle Payroll Adjustment", node: "Collect Trace Steps", file: "workflows/nodes/collectTraceSteps.js" },
  // The escalation-routing port, byte-identical on all nine — one body, nine
  // graphs, exactly like Collect Trace Steps above. A drifted copy here does
  // not make a wrong decision; it sends a correct one to the wrong team, and
  // nothing goes red. That is precisely why it needs a deployed-body check and
  // not only test/n8nRoutingParity.test.js.
  { workflowId: "WORKFLOW_UC01_ID", workflow: "UC-01 — Employment Verification", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC02_ID", workflow: "UC-02 — Expense & Receipt Validation", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC03_ID", workflow: "UC-03 — Travel Support Letter / Workation Router", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC04_ID", workflow: "UC-04 — Work Authorization / Workation", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC05_ID", workflow: "UC-05 — Resignation Notice Calculation", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC06_ID", workflow: "UC-06 — Contract Amendment / Payroll Cutoff", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC07_ID", workflow: "UC-07 — Global Mobility / Permanent Relocation", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC08_ID", workflow: "UC-08 — Cross-Border Tax & Social Security", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
  { workflowId: "WORKFLOW_UC09_ID", workflow: "UC-09 — Off-Cycle Payroll Adjustment", node: "Assign Routing", file: "workflows/nodes/assignRouting.js" },
];

/**
 * Nodes that carry NO jsCode at all — MAPPINGS above (which diffs
 * `parameters.jsCode`) is structurally blind to them, which is exactly how
 * rca-c73 happened: `Route by Decision` (a Switch node) had rules for 3 of
 * the 7 decisions `workflows/nodes/gates.js` can emit, and `npm run
 * verify-deployed` reported "0 drifted" throughout, because the switch was
 * never one of the nodes it was comparing.
 *
 * Each entry's `checkParams`/`expectedOutputs` are checked by
 * `structuralNodeIssues()` (scripts/lib/structuralNodeChecks.mjs), which is
 * generic across node types on purpose — see that file's header. Add a row
 * here whenever a workflow gains a structural node (Switch, IF, Supabase, …)
 * whose live shape needs to be held against a repo-side spec.
 */
export const STRUCTURAL_MAPPINGS = [
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: SWITCH_NODE_NAME,
    type: "n8n-nodes-base.switch",
    specFile: "workflows/nodes/routeByDecisionSpec.js",
    checkParams: (node) => switchRuleIssues(node, { RULES: ROUTE_RULES, FALLBACK: ROUTE_FALLBACK }),
    expectedOutputs: [...ROUTE_RULES.map((r) => r.target), ROUTE_FALLBACK.target],
  },
  // rca-uim — DRIFT-086. A Supabase "create row" node has no jsCode, so it is
  // as invisible to MAPPINGS above as the switch node was to rca-c73. This
  // checks it exists, targets `documents`, carries the right field
  // expressions (workflows/nodes/persistDocumentSpec.js), and sits strictly
  // between "Render Letter" and "Reply + Solve Ticket" — the position that IS
  // the fix, since a Persist Document node that existed anywhere else on the
  // graph would not guarantee the letter is durable before it is posted.
  //
  // rca-9lrm: `expectedOutputs` now points at "Update Audit Log With Letter",
  // not straight at "Carry Context After Persist Document" — that new node
  // sits strictly between the two (see updateAuditLogWithLetterSpec.js). A
  // hand edit that bypasses it (repointing "Persist Document" straight back
  // at the context restorer) is exactly the shape of drift this row exists
  // to catch, and would silently reintroduce GROUND 1.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: PERSIST_DOCUMENT_NODE_NAME,
    type: PERSIST_DOCUMENT_NODE_TYPE,
    specFile: "workflows/nodes/persistDocumentSpec.js",
    checkParams: persistDocumentParamIssues,
    expectedOutputs: [UPDATE_AUDIT_LOG_WITH_LETTER_NODE_NAME],
    expectedInputs: [PERSIST_DOCUMENT_UPSTREAM_NODE],
  },
  // rca-9lrm — GROUND 1's n8n fix. "Update Audit Log With Letter" is a
  // Supabase "update row" node with no jsCode, the same invisible-to-MAPPINGS
  // shape as every sibling above. Checks it exists, targets `audit_log` with
  // `operation: update` filtered on the row "Append Audit Log" just inserted,
  // carries the right `details` patch expression
  // (workflows/nodes/updateAuditLogWithLetterSpec.js), and sits strictly
  // between "Persist Document" and "Carry Context After Persist Document" —
  // the position that IS the fix, since `letterIssued: true` must never be
  // reachable except downstream of a real `documents` row.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: UPDATE_AUDIT_LOG_WITH_LETTER_NODE_NAME,
    type: UPDATE_AUDIT_LOG_WITH_LETTER_NODE_TYPE,
    specFile: "workflows/nodes/updateAuditLogWithLetterSpec.js",
    checkParams: updateAuditLogWithLetterParamIssues,
    expectedOutputs: [UPDATE_AUDIT_LOG_WITH_LETTER_DOWNSTREAM_NODE],
    expectedInputs: [UPDATE_AUDIT_LOG_WITH_LETTER_UPSTREAM_NODE],
  },
  // The other half of the same drift shape: "Persist Document"'s own
  // expectedInputs check above proves "Prepare Document" connects TO it, but
  // says nothing about whether "Render Letter" ALSO still connects straight
  // to "Reply + Solve Ticket" in parallel (n8n allows a node's output to fan
  // out to more than one target) — the exact bypass this bead closed. Checked
  // via `expectedOutputs`'s own count assertion: a second, extra connection
  // makes `actualCount` (2) disagree with `expectedOutputs.length` (1).
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: "Render Letter",
    type: "n8n-nodes-base.code",
    specFile: "workflows/nodes/persistDocumentSpec.js",
    expectedOutputs: [PERSIST_DOCUMENT_UPSTREAM_NODE],
  },
  // Closes the chain: "Carry Context After Persist Document" (MAPPINGS above
  // checks its bytes) must itself reach the customer-facing action, and reach
  // ONLY it — this is the node whose absence (execution 6703, ticket #77)
  // meant "Reply + Solve Ticket" read $json.externalRef off the `documents`
  // insert response instead of the restored context.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: PERSIST_DOCUMENT_DOWNSTREAM_NODE,
    type: "n8n-nodes-base.code",
    specFile: "workflows/nodes/persistDocumentSpec.js",
    expectedOutputs: [PERSIST_DOCUMENT_FINAL_TARGET_NODE],
  },
  // rca-ibh — F-4. The trigger node has no jsCode either, so it was as
  // invisible to MAPPINGS above as the Switch and Supabase nodes were before
  // it. Checks that the live node still responds `onReceived` (not the
  // disclosing `lastNode`) with the fixed acknowledgement body — see
  // workflows/nodes/webhookResponseSpec.js for the full defect.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: WEBHOOK_NODE_NAME,
    type: WEBHOOK_NODE_TYPE,
    specFile: "workflows/nodes/webhookResponseSpec.js",
    checkParams: webhookResponseParamIssues,
  },
  // rca-zu3, guarding rca-947's F-11/F-13 fix. Three more Zendesk "update
  // ticket" nodes with no jsCode — the same shape as every other entry in
  // this list — whose live parameters were hand-edited (via the n8n API,
  // not a Code node body) and had no repo file to diff against at all before
  // this. See workflows/nodes/escalationCloseNodesSpec.js's header for what
  // each fixed and why a hand-revert of either would otherwise pass silently.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: ESCALATE_NODE_NAME,
    type: ESCALATION_CLOSE_NODE_TYPE,
    specFile: "workflows/nodes/escalationCloseNodesSpec.js",
    checkParams: noteNodeParamIssues,
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: UNRECOGNISED_NODE_NAME,
    type: ESCALATION_CLOSE_NODE_TYPE,
    specFile: "workflows/nodes/escalationCloseNodesSpec.js",
    checkParams: noteNodeParamIssues,
  },
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: REPLY_CLOSE_NODE_NAME,
    type: ESCALATION_CLOSE_NODE_TYPE,
    specFile: "workflows/nodes/escalationCloseNodesSpec.js",
    checkParams: replyCloseParamIssues,
  },
  // rca-2ix1, guarding rca-kq7w's fix — the 4th node of this exact shape
  // (rca-uim, rca-ibh, rca-zu3 before it). "Append Audit Log" is a Supabase
  // node with no jsCode; rca-kq7w wired `details.requesterType` to the
  // top-level DERIVED value `gates.js` builds, and nothing checked it. See
  // workflows/nodes/appendAuditLogSpec.js's header for what is and is not
  // asserted here and why.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: APPEND_AUDIT_LOG_NODE_NAME,
    type: APPEND_AUDIT_LOG_NODE_TYPE,
    specFile: "workflows/nodes/appendAuditLogSpec.js",
    checkParams: appendAuditLogParamIssues,
  },
  // rca-wn30 / R7-18, guarding the ONE production graph-shape change
  // qa/HUMAN-DECISIONS-REQUIRED.md §K4 authorised: the "Lookup Consent
  // Records" Supabase node. Fifth node of this exact shape (rca-uim, rca-ibh,
  // rca-zu3, rca-2ix1 before it) and the first one whose absence was the
  // defect rather than whose parameters were. Checks the table, the join
  // filter, the ordering, AND the two node-level flags (`alwaysOutputData`,
  // `onError`) that keep a zero-row lookup or an unreachable Supabase from
  // ending the branch before "Identity + Policy Gates" ever runs — see
  // workflows/nodes/consentLookupSpec.js's header.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: CONSENT_LOOKUP_NODE_NAME,
    type: CONSENT_LOOKUP_NODE_TYPE,
    specFile: "workflows/nodes/consentLookupSpec.js",
    checkParams: consentLookupParamIssues,
    expectedOutputs: [CONSENT_LOOKUP_DOWNSTREAM_NODE],
    expectedInputs: [CONSENT_LOOKUP_UPSTREAM_NODE],
  },
  // The other half of the same drift shape, exactly as "Render Letter" guards
  // "Persist Document" above: `expectedInputs` on the row above proves "Fetch
  // Employment (Remote)" connects TO the lookup, and says nothing about
  // whether it ALSO still connects straight to "Identity + Policy Gates" in
  // parallel. That bypass would put the gates back on a $input they can read
  // (so nothing would error) with the consent rows unreachable — R7-18
  // returning, silently, with every consentRecordId null again.
  {
    workflowId: "WORKFLOW_UC01_ID",
    workflow: "UC-01 — Employment Verification",
    node: CONSENT_LOOKUP_UPSTREAM_NODE,
    type: "n8n-nodes-base.httpRequest",
    specFile: "workflows/nodes/consentLookupSpec.js",
    expectedOutputs: [CONSENT_LOOKUP_NODE_NAME],
  },
];

/**
 * Structural checks need the fetched `workflow` object AND an entry from
 * STRUCTURAL_MAPPINGS above; re-exported here so a consumer of this module
 * (verify-deployed-nodes.mjs, or a coverage tool) never needs to import
 * scripts/lib/structuralNodeChecks.mjs separately just to run them.
 */
export { structuralNodeIssues, switchRuleIssues };
