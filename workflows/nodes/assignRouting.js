// ---------------------------------------------------------------------------
// assignRouting.js — "Assign Routing", the one Code node body all nine graphs
// run so an escalated ticket reaches the team that owns it
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A tag is a label something COULD route on. Assignment is the hand-off. Until
// this node existed, the nine live graphs tagged and annotated 26 human-facing
// Zendesk updates and assigned none of them: a UC-09 off-cycle payroll
// escalation (real money, triple approval) and a UC-01 auto-resolved
// verification landed in the same undifferentiated queue.
//
// The Node/portal path already routes — src/portal/server.js and
// src/uc01/workflow.js both call src/shared/groupAssignment.js's
// resolveGroupAssignment(), which consults src/shared/escalationRouting.js,
// looks the group up and reports on the ticket when it could not. This body is
// that same behaviour on the n8n path. An n8n Code node has no module
// resolution, so it cannot import either module; the copy below is therefore
// held against the original by test/n8nRoutingParity.test.js, which executes
// THIS FILE in a node:vm sandbox and compares its output field by field. Same
// discipline as workflows/nodes/gates.js.
//
// A DRIFTED ROUTING TABLE IS QUIETER THAN A DRIFTED GATE. A drifted gate makes a
// wrong decision, and the decision is in the audit log. A drifted routing table
// sends a correct decision to the wrong team, and nothing anywhere goes red.
//
// ONE BODY, NINE GRAPHS. Nothing here is per-workflow. The use case is read off
// the audit row this node sits downstream of — the same row `Collect Trace
// Steps` reads for exactly the same reason: it is the record that exists, and
// reading it needs no $('…Gates').item lookup that item pairing could break.
//
// WHAT THIS NODE DOES NOT DO
//
//   - It never creates a Zendesk group. Group creation is an outward,
//     hard-to-undo act on a live account and belongs to
//     scripts/setup-zendesk-groups.mjs, run deliberately. When the group does
//     not exist this node still emits the routing TAG and a note saying, in
//     words, that assignment was skipped and why. Visible failure, never silent.
//   - It never changes a decision. It is pure computation downstream of both the
//     idempotency claim and the audit write, so it cannot lose a record, and it
//     reads the decision without ever writing one.
//   - It does not set priority. `priority` is absent from the n8n Zendesk node's
//     `updateFields` entirely; only the `updateFieldsJson` form can set it, and
//     that form is where hand-writing the comment object can drop
//     `public: false` and post the AI's internal analysis publicly to the
//     customer. `zendeskPriority` is emitted (and parity-checked) so the table
//     stays whole and phase 2 is a graph change rather than a code change — but
//     no Zendesk node consumes it today. Saying so here is the point: an emitted
//     field nobody reads is exactly the kind of thing that looks finished.
// ---------------------------------------------------------------------------

// --- src/shared/escalationRouting.js, ported verbatim ------------------------
// Keyed by use case, which is right for 28 of the 29 Zendesk write nodes. The
// 29th — UC-03's `route_to_uc04` branch — is handled by resolving the KEY
// before the lookup (see ROUTING KEY below), not by adding a second table.
//
// TWO TAGS PER ROW, NOT ONE, and the reason is the whole point of this
// revision. `queueTag` names the owning TEAM and goes on every ticket;
// `escalationTag` says the automation gave up and goes on only when the
// decision really is an escalation. They were one string, applied to
// everything, so a routine `ready_for_approval` reached Zendesk labelled
// `escalation_mobility_legal_t2` — an escalation claim, addressed to the
// Tier-2 legal queue, about the healthy medium-tier path. `escalationGroup`
// exists for the same reason, on the two use cases whose specs name a
// different team for the two paths: UC-04 (§5/§8, Mobility/Legal Tier-2) and
// UC-05 (§8 sends a statutory discrepancy to Local HR/Legal, while §15's
// "single HR Ops sign-off" is the ordinary path). Full argument in the module.
//
// `Local HR & Legal` has NO id in GROUP_IDS below, and that is the correct
// current state rather than an omission: the group does not exist in the live
// account yet. Its escalations therefore take the tag-and-say-so path — the
// ticket still carries `queue_hr_ops`, so HR Ops's own view still finds it —
// until `scripts/setup-zendesk-groups.mjs` creates it and `npm run sync-groups`
// regenerates the block.
const ROUTES = {
  'UC-01': { group: 'HR Ops', queueTag: 'queue_hr_ops', escalationTag: 'escalation_hr_ops', priority: 'normal' },
  'UC-02': { group: 'Finance Ops', queueTag: 'queue_finance_ops', escalationTag: 'escalation_finance_ops', priority: 'normal' },
  'UC-03': { group: 'Travel & Mobility Support', queueTag: 'queue_travel_support', escalationTag: 'escalation_travel_support', priority: 'normal' },
  'UC-04': { group: 'Mobility Specialists', queueTag: 'queue_mobility_specialists', escalationGroup: 'Mobility & Legal (Tier-2)', escalationTag: 'escalation_mobility_legal_t2', priority: 'high' },
  'UC-05': { group: 'HR Ops', queueTag: 'queue_hr_ops', escalationGroup: 'Local HR & Legal', escalationTag: 'escalation_local_hr_legal', priority: 'normal' },
  'UC-06': { group: 'Payroll Ops', queueTag: 'queue_payroll_ops', escalationTag: 'escalation_payroll_ops', priority: 'high' },
  'UC-07': { group: 'Mobility Legal (Tier-3)', queueTag: 'queue_mobility_legal_t3', escalationTag: 'escalation_mobility_legal_t3', priority: 'high' },
  'UC-08': { group: 'Tax Operations', queueTag: 'queue_tax_operations', escalationTag: 'escalation_tax_operations', priority: 'high' },
  'UC-09': { group: 'Payroll Ops', queueTag: 'queue_payroll_ops', escalationTag: 'escalation_payroll_ops', priority: 'urgent' },
};

// src/shared/escalationRouting.js's isEscalation(), ported verbatim. A missing
// or unrecognisable decision counts as an ESCALATION — the opposite of the
// defect above, which was a KNOWN routine decision being called one. An unknown
// decision is a missing signal, and a missing signal takes the stronger
// treatment; demoting it to routine would let an unclassifiable UC-04 case land
// with a specialist as a one-click approval, which UC-04.md §8 forbids.
function isEscalation(decision) {
  if (typeof decision !== 'string' || decision.trim() === '') return true;
  return /^escalat/i.test(decision.trim());
}

// --- GENERATED: Zendesk group name -> group_id, resolved from the live account
// Regenerate with `npm run sync-groups` (scripts/sync-zendesk-group-ids.mjs)
// AFTER `scripts/setup-zendesk-groups.mjs` has created the groups, then deploy
// this file. IDs are assigned by Zendesk per account, so they cannot live in
// src/shared/escalationRouting.js — that module is the source of truth for
// WHICH TEAM, and a numeric id is an environment fact about one Zendesk
// instance. Keeping the resolved ids in this deployment artifact is what lets
// the deployed body stay byte-identical to a file in the repo, which is what
// `npm run verify-deployed` checks.
//
// An empty map is a real, expected state: it means no per-team group exists yet
// and every route below falls to the tag-and-say-so path.
const GROUP_IDS = {
  "Finance Ops": 6168404929055,
  "HR Ops": 6168404929823,
  "Local HR & Legal": 9990000000002,
  "Mobility & Legal (Tier-2)": 6168394286495,
  "Mobility Legal (Tier-3)": 6168424846751,
  "Mobility Specialists": 9990000000003,
  "Payroll Ops": 6168442797343,
  "Tax Operations": 6168394287519,
  "Travel & Mobility Support": 6168404930335,
};
// --- END GENERATED ---

const ctx = $json && typeof $json === 'object' ? $json : {};

/** Read a node's first output item, or {} when the node is absent/unexecuted. */
function firstJson(nodeName) {
  try {
    const got = $(nodeName).first();
    return (got && got.json) || {};
  } catch (err) {
    return {};
  }
}

// --- WHICH USE CASE IS THIS? ------------------------------------------------
// The audit row is the primary source and the only one present in production:
// every one of the nine graphs writes a literal `use_case` into `audit_log`
// immediately upstream of this node, and the Supabase create operation returns
// the inserted row. `$json` is checked first only so an explicit context can
// override it — which is what the parity harness supplies, and what a future
// graph that carries the use case on the item would supply.
const auditRow = firstJson('Append Audit Log');
const useCase = ctx.useCase || ctx.use_case || auditRow.use_case || auditRow.useCase || null;

// --- ROUTING KEY: whose queue, which is not always whose workflow ------------
// UC-03's `route_to_uc04` decision means "this travel inquiry is really a work
// authorization case"; its own Zendesk note already says "UC-04 owns its own
// compliance case". That work belongs to UC-04's team. It is the one place in
// all nine graphs where the responsible team is not a function of the executing
// use case, and a node keying only on `useCase` would hand a work-authorization
// case to the travel-letter queue with nothing going red.
//
// `handoffUseCase` is set by the gates node that DECIDED the handoff
// (workflows/nodes-uc03/travelRouterGates.js, alongside the handoff event it
// already builds), never inferred here from a decision string. That keeps the
// exception at the site that knows about it and keeps this body a pure lookup —
// the alternative, an `if (decision === 'route_to_uc04')` here, would be a
// second routing rule living apart from the first.
const handoffUseCase = typeof ctx.handoffUseCase === 'string' ? ctx.handoffUseCase : null;
const routingKey = handoffUseCase || useCase;

const route = routingKey && Object.prototype.hasOwnProperty.call(ROUTES, routingKey) ? ROUTES[routingKey] : null;

// --- IS THIS AN ESCALATION, OR THE HUMAN GATE WORKING? ----------------------
// The decision context is checked first ($json, restored by `Carry Context
// Forward` on the graphs that have one), then the audit row this node sits
// downstream of. `action` is the audit row's own column and every workflow.js
// writes `action: result.decision` into it, so it is the decision under another
// name — which matters, because on UC-04/05/06/07/08 the routing node reads the
// Supabase insert RESPONSE, where `decision` is not a column.
const decision =
  (typeof ctx.decision === 'string' && ctx.decision) ||
  (typeof auditRow.decision === 'string' && auditRow.decision) ||
  (typeof auditRow.action === 'string' && auditRow.action) ||
  null;
const escalated = isEscalation(decision);

// UC-04 is the only row that sends the two paths to different teams.
const intendedGroup = route ? (escalated && route.escalationGroup ? route.escalationGroup : route.group) : null;

// The owning team's tag is on every ticket; the escalation marker only when the
// decision really is one. Both, for an escalation: it is still that team's work.
const routeTags = route ? (escalated ? [route.queueTag, route.escalationTag] : [route.queueTag]) : [];

// A group id of 0 is not a Zendesk group; only a positive integer is.
const rawGroupId = intendedGroup && Object.prototype.hasOwnProperty.call(GROUP_IDS, intendedGroup) ? GROUP_IDS[intendedGroup] : null;
const groupId = typeof rawGroupId === 'number' && Number.isInteger(rawGroupId) && rawGroupId > 0 ? rawGroupId : null;

// --- WHAT THE TICKET IS TOLD ------------------------------------------------
// SAME VOCABULARY AS src/shared/groupAssignment.js's resolveGroupAssignment()/
// describeAssignment() — NOT src/portal/server.js, which used to carry its own
// copy of this same logic and stopped when rca-ee04 deleted that copy in
// favour of calling the shared module directly. This comment used to point at
// that now-deleted block; naming groupAssignment.js instead is the fix rather
// than merely a wording tidy, because a reader reconciling this port against
// "the same wording elsewhere" would otherwise reconcile against nothing.
//
// An n8n Code node has no module resolution (see this file's header), so it
// cannot `import` that module the way src/portal/server.js now does — it has
// to keep its own port, same as ROUTES/GROUP_IDS above. What CAN be ported is
// the SPLIT: `skippedReason` states what happened to the ticket,
// `operatorRemedy` states what an operator does about it (null when there is
// nothing to do). Kept as two separate values here, exactly as
// groupAssignment.js keeps them as two separate fields, rather than one string
// that merely happens to read similarly today. This node's only reader is the
// internal note (composeInternalNote.js) — never a requester surface, per this
// bead's own scope finding — so both halves are joined below into one
// sentence, the same way describeAssignment() joins them for ITS
// internal-note callers.
let skippedReason;
let operatorRemedy = null;
if (!routingKey) {
  skippedReason = 'this run could not determine its own use case, so the ticket was not assigned to a team.';
} else if (!route) {
  skippedReason =
    'no owning team is defined for ' +
    routingKey +
    ' in src/shared/escalationRouting.js, so this ticket was not assigned to one.';
} else if (!groupId) {
  skippedReason =
    'the Zendesk group "' +
    intendedGroup +
    '" does not exist in this account, so this ticket was tagged ' +
    routeTags.join(', ') +
    ' but NOT assigned.';
  operatorRemedy = 'Run scripts/setup-zendesk-groups.mjs to create the groups, then re-deploy the routing node.';
} else {
  skippedReason = null;
}

const remedySuffix = operatorRemedy ? ' ' + operatorRemedy : '';
let assignmentNote;
if (!route) {
  assignmentNote = 'ROUTING SKIPPED — ' + skippedReason + remedySuffix;
} else if (!groupId) {
  assignmentNote = 'ASSIGNMENT SKIPPED — ' + skippedReason + remedySuffix;
} else {
  assignmentNote =
    'Assigned to ' + intendedGroup + ' (Zendesk group ' + groupId + '), tagged ' + routeTags.join(', ') + '.';
}

const routing = {
  useCase: useCase,
  routingKey: routingKey,
  handoffUseCase: handoffUseCase,
  decision: decision,
  // Stated rather than left to be inferred from the tag list: "a human is
  // expected to look" and "the automation could not finish" are different
  // hand-offs, and the single old tag made them indistinguishable.
  escalated: route ? escalated : null,
  intendedGroup: intendedGroup,
  assigned: Boolean(groupId),
  groupId: groupId,
  queueTag: route ? route.queueTag : null,
  escalationTag: route && escalated ? route.escalationTag : null,
  tags: routeTags,
  priority: route ? route.priority : null,
  // The two halves, kept apart — same fields, same names, as
  // src/shared/groupAssignment.js's GroupAssignment shape, so the two ports
  // can be compared field by field rather than only by their joined string.
  skippedReason: skippedReason,
  operatorRemedy: operatorRemedy,
  note: assignmentNote,
};

return [
  {
    json: Object.assign({}, ctx, {
      // The three fields test/n8nRoutingParity.test.js holds against the table.
      zendeskGroup: intendedGroup,
      // '' and not null: the Zendesk node does `if (updateFields.group)`, so a
      // falsy value skips assignment cleanly. An expression that renders `null`
      // arrives as the STRING "null", which is truthy, and Zendesk answers 400.
      zendeskGroupId: groupId === null ? '' : groupId,
      zendeskTags: routeTags,
      zendeskPriority: route ? route.priority : null,
      // The single tag each Zendesk node appends to its OWN tag array. Separate
      // from `zendeskTags` above on purpose, and never empty: `zendeskTags`
      // mirrors the table exactly (empty when there is no route, which is what
      // the parity test pins), while this one is a value going onto a real
      // ticket, where an empty element is a silent no-op. An unroutable run
      // therefore lands tagged `queue_unrouted` — the failure is a thing a human
      // can search for, not an absence. It was `escalation_unrouted` until the
      // vocabulary split: a run that could not identify its own use case has
      // said nothing about whether it escalated, and a tag claiming it did would
      // be counted by the same reporting the split exists to make honest.
      //
      // THE MOST SPECIFIC TAG WINS HERE. An escalation appends the escalation
      // marker (the queue tag rides along in `zendeskTags`); a routine hand-off
      // appends the queue tag, because for it that IS the specific answer.
      routingTag: route ? (escalated ? route.escalationTag : route.queueTag) : 'queue_unrouted',
      // The full picture, for the internal note and for anyone reading the run.
      routing: routing,
      routingNote: assignmentNote,
    }),
    // Explicit, because several graphs address earlier nodes as
    // $('…Gates').item, which resolves through item pairing — the same reason
    // `Carry Context After Claim` sets it.
    pairedItem: { item: 0 },
  },
];
