// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// three terminal Zendesk nodes on UC-06's live graph (WORKFLOW_UC06_ID):
// "Flag Awaiting Dual Approval", "Escalate Amendment Ticket" and
// "Unrecognised Amendment Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is STRUCTURALLY BLIND to it. All
// three of these nodes therefore had their prose typed once into a node
// parameter, written onto real customers' tickets, read back by no check and
// versioned by nothing. `test/n8nUc06Parity.test.js` cannot see it either, by
// its own design: parity compares DECISIONS, and a node that reaches the right
// verdict and describes it in false words passes every time.
//
// The correct note now exists where it can be checked: `composeInternalNote()`
// in `workflows/nodes-uc06/amendmentGates.js`, a file `npm run verify-deployed`
// diffs byte for byte. These nodes' job shrinks to interpolating one field.
// Same split, same reasoning, as UC-01 (workflows/nodes/composeInternalNote.js)
// and UC-04 (workflows/nodes-uc04/terminalZendeskNodesSpec.js).
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG, AND HOW BADLY
// ---------------------------------------------------------------------------
//
// 1. "AI drafted amendment …" / "AI summary — ESCALATED".
//
//    NEITHER IS AI, AND THE GRAPH PROVES IT. Read live 2026-08-31:
//    `WORKFLOW_UC06_ID` has 18 nodes and three http calls, ALL of them to
//    Remote. There is no LLM node anywhere on it. The "AI drafted amendment"
//    is `draftSummaryTemplate()` — a string concatenation of values the
//    requester supplied — and every gate below it is a comparison.
//
//    This inverts prime directive 1 (*LLMs interpret; deterministic code
//    decides*) in the direction that costs the most: it invites a payroll
//    specialist to distrust a cutoff-lock comparison because they were told a
//    model produced it. The composed note names the reader instead.
//
// 2. "this request needs manual payroll/HR handling and will not go through
//    dual approval."  ("Escalate Amendment Ticket")
//
//    ACCURATE FOR 6 OF THE 12 REACHABLE ESCALATE REASONS. `ESCALATION_REASON_
//    ACCURACY` below is that count as data, one row per reason, so this
//    header's claim is checkable rather than assertable.
//
//    THE WORK ORDER FOR THIS CHANGE SAID "~5 of 12" AND SIX IS THE MEASURED
//    ANSWER — the five payroll ones plus `employee_not_active`, which is a
//    genuine HR record-keeping question a human at Remote owns. Recorded
//    rather than rounded: the direction makes the retired sentence slightly
//    LESS wrong than assumed, and quietly adopting the more damning number
//    would be the same failure this change exists to fix.
//
//    The three classes it IS false for:
//
//    - `identity_not_verified` — an AUTHENTICATION finding. Nothing about the
//      amendment was assessed. Payroll Ops cannot fix it by hand and should not
//      try; the remedy is a session, not a contract.
//    - `upstream_record_not_found` / `upstream_unavailable` /
//      `country_schema_unavailable` — a REMOTE API FAILURE.
//      `src/shared/upstreamFailure.js` exists precisely so these are NOT
//      mistaken for policy refusals — and this sentence undid that at the last
//      hop, telling the team who read the ticket that a 502 from Remote was
//      their manual work.
//    - `change_value_underivable` / `schema_invalid` — MALFORMED OR INCOMPLETE
//      INPUT. The remedy is the requester re-stating the change, not a
//      specialist keying it in on a contract amendment.
//
//    SHARPENED BY ROUTING, WHICH IS WHY THIS IS NOT COSMETIC. UC-06's row in
//    `src/shared/escalationRouting.js` has NO `escalationGroup` — `group` and
//    the escalation destination are BOTH Payroll Ops. So an upstream 502 lands
//    in Payroll Ops' own queue carrying a note that tells Payroll Ops it is
//    theirs to do by hand. Same shape as UC-04's retired "Blocked by the risk
//    matrix or employer permission", one use case over.
//
// 3. "awaiting dual approval (Customer Admin + Payroll Specialist)".
//    ("Flag Awaiting Dual Approval")
//
//    NAMES TWO ROLES AND NOT WHERE EITHER ACTS, ON A SURFACE WHERE THAT
//    MATTERS. `customer_admin` is EMPLOYER-side — "customer" means Remote's
//    customer, and `docs/use-cases/UC-06.md` §5 says so explicitly ("§2's actor
//    row gives it away by contrast: 'Customer Admin + REMOTE Payroll
//    specialist', where only the second is qualified"). But the only surface
//    that renders both slots is the ZAF sidebar — a Zendesk AGENT surface — and
//    `docs/ZENDESK-ACCOUNT.md` records that this account holds two agent seats,
//    both the project owner's. No customer-side seat exists.
//
//    So a Zendesk agent reading "awaiting dual approval (Customer Admin +
//    Payroll Specialist)" may reasonably conclude both slots are theirs to
//    fill — which collapses a CROSS-ORGANISATIONAL dual control into two Remote
//    employees while every control still reports satisfied. That is the worst
//    kind of control failure: the four-eyes floor holds, two distinct names
//    appear, and the separation the control exists for is gone.
//
//    THE MECHANISM IS NOT CHANGED HERE, AND MUST NOT BE. That the employer's
//    signature is a separate act from the employer's consent — and that slot 1
//    is therefore filled on the employer's side — is a DECIDED product call:
//    `qa/HUMAN-DECISIONS-REQUIRED.md` §F1, recorded as `[A-4]`, answered
//    2026-08-21 ("two acts"), on the argument that a control resting on a
//    demonstration surface disappears when the real Remote intake replaces it.
//    What was missing was not a gate but a SENTENCE. The composed note now
//    names who fills each slot and on whose side, quoting
//    `src/uc06/dualApprovalPolicy.js`'s own `requester_cannot_approve` refusal
//    text, so the ambiguity cannot be read into it.
//
// ---------------------------------------------------------------------------
// WHAT THIS CHANGE DOES *NOT* FIX — say it here, not in a report nobody reads
// ---------------------------------------------------------------------------
//
// Nothing in `src/uc06/` or `zaf-app/` is touched. The ZAF sidebar still
// renders both role blocks side by side on a Zendesk agent surface; this change
// makes the ticket say who each one belongs to, and does not stop an entitled
// agent from pressing either button. Whether `APPROVER_ROLES` should refuse
// `uc06:customer_admin` to every Remote agent is a provisioning decision, not a
// prose one, and is out of this pass's scope.
//
// `draftSummaryTemplate()`'s own output still rides into the note via
// `summary`. It is deterministic and it is the requester's own figures, so it
// carries no false claim — but it is not guarded by FORBIDDEN_PHRASES, which
// guards the NODE BLOB (the expression a human types), not the rendered text.
//
// ---------------------------------------------------------------------------
// TAG OWNERSHIP — READ THIS BEFORE ADDING AN ASSERTION
// ---------------------------------------------------------------------------
//
// `workflows/nodes/escalationQueueTagSpec.js` owns the QUEUE TAG on the
// `Escalate *` and `Unrecognised *` nodes of all nine graphs (rca-iih7 / D-14).
// This file owns the PROSE and the per-decision marker tag. So:
//
//   * `ESCALATE_PARAMETERS` / `UNRECOGNISED_PARAMETERS` below carry the queue
//     tag, byte-identical to that spec, so either file can be used to deploy
//     without reverting the other;
//   * `terminalZendeskNodeIssues()` deliberately DOES NOT ASSERT IT. Two
//     checkers asserting one field is how a fix in one lands as a failure in
//     the other;
//   * a cross-spec test in test/n8nUc06TerminalZendeskNodes.test.js holds the
//     two `updateFields` blocks equal by ASSERTION rather than by import — an
//     import would remove the duplication and also the failure message.
//
// `Flag Awaiting Dual Approval` correctly has NO queue tag:
// `isEscalation('dual_approval_required')` is false, so `routingTag` already IS
// the queue tag.
//
// ---------------------------------------------------------------------------
// TWO CHECKS HOLD THIS FILE, against different authorities:
//   1. test/n8nUc06TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against CAPTURED SNAPSHOTS of the three live
//      nodes (read from the n8n API on 2026-08-31, `versionId ===
//      activeVersionId === 4f597d35-bacf-41b3-88ea-7713a6b17522`) and against
//      deliberately mutated copies, so each detector is proven able to FAIL
//      before it is trusted to pass.
//   2. `scripts/lib/deployedNodeMappings.mjs`'s STRUCTURAL_MAPPINGS, wired
//      separately — `npm run verify-deployed` runs these checkers against the
//      LIVE nodes. A snapshot cannot notice a hand edit made in the n8n editor
//      tomorrow, and a live check cannot run in `npm test` at all.
// ---------------------------------------------------------------------------

export const APPROVAL_NODE_NAME = "Flag Awaiting Dual Approval";
export const ESCALATE_NODE_NAME = "Escalate Amendment Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Amendment Decision";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC06_WORKFLOW_ID = "WORKFLOW_UC06_ID";
export const GATES_NODE_NAME = "Amendment Gates";
export const RECORD_NODE_NAME = "Create Amendment Record";

/** All three, in the order `Route by Decision` fans out to them. */
export const TERMINAL_NODE_NAMES = Object.freeze([APPROVAL_NODE_NAME, ESCALATE_NODE_NAME, UNRECOGNISED_NODE_NAME]);

/**
 * The composed note, read off `Amendment Gates` BY NODE NAME rather than off
 * `$json`.
 *
 * `$json` at these three nodes is whatever `Assign Routing` last emitted, and
 * `Assign Routing` spreads the Supabase insert response it received upstream —
 * it does not carry the gates' fields at all. Every other expression on all
 * three nodes already addresses `$('Amendment Gates')` for the same reason.
 *
 * GETTING THIS WRONG IS SILENT. An n8n expression that dereferences a field
 * nothing produces renders as an EMPTY STRING on a fully green execution — the
 * same shape as `verify-traces`'s dead-probe-name check, and as the 401 that
 * reported success because the header was present but empty.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Amendment Gates').item.json.internalNote }}";

/**
 * The row id, APPENDED in the expression rather than composed into
 * `internalNote`, because it does not exist when the gates run — `Create
 * Amendment Record` is three nodes downstream.
 *
 * On ALL THREE nodes: the graph is `Gates → Claim → Carry Context After Claim →
 * Create Amendment Record → Append Audit Log → Assign Routing → Route by
 * Decision` (read live 2026-08-31), so every terminal node is downstream of the
 * insert. The unrecognised branch is where a human most needs the row id, and
 * it is the one branch that never had it.
 */
export const RECORD_ID_INTERPOLATION = "{{ $('Create Amendment Record').item.json.id }}";

/** Produced DOWNSTREAM of the gates, so it cannot be composed into the note. */
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/**
 * The exact `updateFields.internalNote` all three nodes must carry. Identical
 * across the three ON PURPOSE: the per-decision difference is composed inside
 * `composeInternalNote()`, which is diffed byte for byte by
 * `npm run verify-deployed`, rather than typed three times into three node
 * parameters where three copies drift independently. That drift is not
 * hypothetical — it is what produced the three different wrong sentences this
 * file exists to retire.
 */
export const INTERNAL_NOTE_EXPRESSION =
  "=" + INTERNAL_NOTE_INTERPOLATION + "\n\nAmendment record: " + RECORD_ID_INTERPOLATION + "\n" + ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $('Amendment Gates').item.json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14, owned by workflows/nodes/escalationQueueTagSpec.js and
 * repeated here so this file's target blocks can be pasted without reverting
 * that fix. NOT asserted by the checker — see the tag-ownership block above.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/** The per-decision outcome tags, UNCHANGED. Machine markers for a STATE. */
export const APPROVAL_TAG = "uc06_awaiting_approval";
export const ESCALATED_TAG = "uc06_escalated";
export const EXCEPTION_TAG = "uc06_exception";

/**
 * ALL THREE ARE `open`, AND ALL THREE ARE UNCHANGED.
 *
 * Every one of these decisions is queued work for a human at Remote: two
 * approval slots to fill, an escalation to work, or an unrecognised decision to
 * triage. `pending` is Zendesk's "waiting on the requester", and the requester
 * is not who any of these is waiting on.
 *
 * Named here rather than omitted because UC-05's sign-off node carried
 * `pending` for exactly this situation and had to be corrected in the same
 * pass — UC-06 was already right, and a spec that only lists what it changes
 * cannot record that.
 */
export const APPROVAL_STATUS = "open";
export const ESCALATE_STATUS = "open";
export const UNRECOGNISED_STATUS = "open";

/**
 * THE PHRASES THAT MUST NEVER COME BACK, checked as substrings of the whole
 * `updateFields` blob rather than of one field — the 2026-08-29 Zendesk
 * migration's own lesson is that a field-by-field walk misses the copy hiding
 * inside a string inside another field.
 *
 * Case-insensitive, matched on the SPACED form only, because these are prose
 * phrases and no identifier in this repo contains them.
 *
 * "needs manual payroll" is listed as the STEM of the full sentence so that a
 * shortened retype does not slip through. "awaiting dual approval (customer
 * admin" is listed with its opening parenthesis because the phrase "awaiting
 * dual approval" on its own is TRUE and useful — what is forbidden is naming
 * the two roles with no surface, which is what the parenthetical did.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "ai drafted",
  "ai summary",
  "ai prepared",
  "needs manual payroll",
  "manual payroll/hr handling",
  "awaiting dual approval (customer admin",
]);

/**
 * The 12 reachable escalate reasons, with a verdict on the sentence this change
 * retires: "this request needs manual payroll/HR handling and will not go
 * through dual approval."
 *
 * As DATA rather than as a paragraph, so the header's "6 of 12" is a count a
 * test can take. Read off `workflows/nodes-uc06/amendmentGates.js` on
 * 2026-08-31: ten authored by the ordered gates, plus the two from
 * `upstreamVerdict()`, which `src/shared/upstreamFailure.js` owns and which
 * therefore have no rung in either GATE_SEQUENCE.
 *
 * `kind` must agree with `ESCALATION_CLASS` in the gates body — the test reads
 * both and compares them, rather than either restating the other.
 *
 * Nothing here is read by a gate. It is evidence for a prose change, kept next
 * to the prose it justifies.
 */
export const ESCALATION_REASON_ACCURACY = Object.freeze([
  {
    reason: "identity_not_verified",
    kind: "authentication",
    accurate: false,
    why: "an authentication finding — nothing about the amendment was assessed, so there is nothing to handle manually. The remedy is a session, not a contract",
  },
  {
    reason: "upstream_record_not_found",
    kind: "upstream_outage",
    accurate: false,
    why: "a Remote API 404. src/shared/upstreamFailure.js exists so this is not mistaken for a policy refusal, and this sentence undid that at the last hop",
  },
  {
    reason: "upstream_unavailable",
    kind: "upstream_outage",
    accurate: false,
    why: "a Remote API 403/5xx/transport failure — the request was never evaluated, so there is no refusal to overturn",
  },
  {
    reason: "country_schema_unavailable",
    kind: "upstream_outage",
    accurate: false,
    why: "the country form could not be READ. Telling Payroll Ops to handle it manually points them at a contract when the problem is an HTTP call",
  },
  {
    reason: "change_value_underivable",
    kind: "request_malformed",
    accurate: false,
    why: "the requester stated a value that is not a value. Keying a corrected one in on their behalf substitutes our reading of what they meant for theirs, on a contract change",
  },
  {
    reason: "schema_invalid",
    kind: "request_malformed",
    accurate: false,
    why: "a required field is missing from the record the amendment would produce — the requester supplies it, not the specialist",
  },
  {
    reason: "employee_not_active",
    kind: "payroll_or_hr",
    accurate: true,
    why: "a record-keeping question a human at Remote genuinely owns",
  },
  {
    reason: "change_not_expressible",
    kind: "payroll_or_hr",
    accurate: true,
    why: "the country's form cannot carry the change at all, so a human has to decide how else it is made",
  },
  {
    reason: "ambiguous_payroll_cycle",
    kind: "payroll_or_hr",
    accurate: true,
    why: "which cycle governs is the payroll specialist's to settle — the gate says so in its own words",
  },
  {
    reason: "no_matching_payroll_cycle",
    kind: "payroll_or_hr",
    accurate: true,
    why: "no run for the change to land in; a human decides what happens to the effective date",
  },
  {
    reason: "cutoff_date_unknown",
    kind: "payroll_or_hr",
    accurate: true,
    why: "a person has to establish the real lock time",
  },
  {
    reason: "cutoff_lock_passed",
    kind: "payroll_or_hr",
    accurate: true,
    why: "a retroactive correction, which is a decision a human takes rather than a re-draft",
  },
]);

/**
 * The complete target `parameters` block for each node, as data. This is what a
 * deploy has to produce; the checkers below are what check it produced it.
 */
export const APPROVAL_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: Object.freeze({
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: APPROVAL_STATUS,
    tags: Object.freeze([APPROVAL_TAG, ROUTING_TAG_EXPRESSION]),
  }),
});

export const ESCALATE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: Object.freeze({
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: ESCALATE_STATUS,
    tags: Object.freeze([ESCALATED_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION]),
  }),
});

export const UNRECOGNISED_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: Object.freeze({
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: UNRECOGNISED_STATUS,
    tags: Object.freeze([EXCEPTION_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION]),
  }),
});

/** One row per node, keyed by node NAME — what n8n addresses nodes by. */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [APPROVAL_NODE_NAME]: Object.freeze({ name: APPROVAL_NODE_NAME, parameters: APPROVAL_PARAMETERS }),
  [ESCALATE_NODE_NAME]: Object.freeze({ name: ESCALATE_NODE_NAME, parameters: ESCALATE_PARAMETERS }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({ name: UNRECOGNISED_NODE_NAME, parameters: UNRECOGNISED_PARAMETERS }),
});

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs) and for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note and on the tags — same relaxation and
 * same reasoning as UC-04's equivalent and as
 * `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js: a
 * deploy tool that APPENDS produces strictly more than the spec asks for, and
 * calling that a regression is how two of this repo's own tools came to
 * disagree and turn `verify-deployed` red on three healthy nodes. The
 * regression this guards is the interpolation being GONE — replaced by a
 * hand-typed sentence, which is precisely the state all three nodes were in
 * until 2026-08-31 and which no check could see.
 *
 * @param {object} node the live node, as returned by GET /api/v1/workflows/{id}
 * @param {string} [nodeName] the spec to check against; defaults to `node.name`
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function terminalZendeskNodeIssues(node, nodeName) {
  const issues = [];
  const key = nodeName ?? node?.name;
  const spec = TERMINAL_NODE_SPECS[key];
  if (!spec) {
    return [
      `no terminal-node spec for ${JSON.stringify(key)} — expected one of ${JSON.stringify(TERMINAL_NODE_NAMES)}. ` +
        `A node checked against no spec is a node nobody is checking, which is the state this file exists to end`,
    ];
  }

  const want = spec.parameters;
  const uf = node?.parameters?.updateFields ?? {};

  if (typeof uf.internalNote !== "string" || !uf.internalNote.includes(INTERNAL_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote is ${JSON.stringify(uf.internalNote)}, expected to interpolate ` +
        `${JSON.stringify(INTERNAL_NOTE_INTERPOLATION)} — the regression is an inline hand-typed note here, which is ` +
        `unversioned, uncheckable, and is how this node came to tell Payroll Ops that a 502 from Remote was their ` +
        `manual work`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(ROUTING_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(ROUTING_NOTE_INTERPOLATION)} — ` +
        `the routing sentence is produced downstream of the gates, so it cannot be composed into internalNote and ` +
        `has to be appended here; without it the ticket never says which team owns it`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(RECORD_ID_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(RECORD_ID_INTERPOLATION)} — ` +
        `without it the ticket names no uc06_amendments row, so neither approver can find the amendment they are ` +
        `being asked to sign`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc06/terminalZendeskNodesSpec.js's header for what that sentence claims and for how many ` +
          `of the twelve reachable escalate reasons it is false`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  // The queue tag is skipped ON PURPOSE — see the tag-ownership block above.
  for (const tag of want.updateFields.tags) {
    if (tag === QUEUE_TAG_EXPRESSION) continue;
    if (!tags.includes(tag)) {
      issues.push(
        `${spec.name}: updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}`
      );
    }
  }

  if (uf.group !== want.updateFields.group) {
    issues.push(
      `${spec.name}: updateFields.group is ${JSON.stringify(uf.group)}, expected ` +
        `${JSON.stringify(want.updateFields.group)} — absent lands the ticket in the account's default Support group ` +
        `(§7's honest-gaps items 7–8)`
    );
  }

  if (uf.status !== want.updateFields.status) {
    issues.push(
      `${spec.name}: updateFields.status is ${JSON.stringify(uf.status)}, expected ` +
        `${JSON.stringify(want.updateFields.status)} — every UC-06 terminal decision is queued work for a human at ` +
        `Remote, and "pending" is Zendesk's "waiting on the requester"`
    );
  }

  if (node?.parameters?.id !== want.id) {
    issues.push(
      `${spec.name}: parameters.id is ${JSON.stringify(node?.parameters?.id)}, expected ${JSON.stringify(want.id)} — ` +
        `this is which TICKET gets written to, and a wrong-but-resolving reference is §7's honest-gaps item 23`
    );
  }

  return issues;
}

/** @param {object} node @returns {string[]} */
export function approvalNodeIssues(node) {
  return terminalZendeskNodeIssues(node, APPROVAL_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
