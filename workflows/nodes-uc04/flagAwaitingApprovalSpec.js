// ---------------------------------------------------------------------------
// flagAwaitingApprovalSpec.js — the single versioned source of truth for the
// `Flag Awaiting Specialist Approval` Zendesk node on UC-04's live graph
// (WORKFLOW_UC04_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it, and
// `scripts/lib/unguarded-node-baseline.json` records exactly that: all four of
// UC-04's terminal Zendesk nodes are baselined as unguarded. So the text this
// node writes onto a real customer's ticket was versioned by NOTHING. It was
// typed once, into a node parameter, and read back by no check.
//
// AND IT WAS WRONG. Until 2026-08-31 it wrote:
//
//   "AI drafted workation authorization {id} — awaiting ONE mobility
//    specialist's approval."
//
// A `ready_for_approval` UC-04 request is not awaiting a mobility specialist.
// It is awaiting THE CUSTOMER'S OWN MANAGER, in Remote's own product, and it
// is the one work-authorization decision Remote's API accepts (`PATCH` takes
// exactly `approved_by_manager` / `declined_by_manager`). No Zendesk agent can
// make it: `src/uc04/approvalPolicy.js` refuses them, and the UC-04 sidebar
// panel offers no approve control at all. So the ticket was instructing a
// Remote specialist to do something every other layer of this system refuses.
// UC-04.md §1a is the corrected model; `docs/BUILD-LOG.md` §3.108 is the pass
// that fixed the three other registers carrying the same defect
// (`src/approvalqueue/awaiting.js`, `src/approvalqueue/approvalRoutes.js`,
// `src/auditview/humanDecision.js`). The n8n graph was the last copy.
//
// THE FIX MOVES THE PROSE OUT OF THE NODE AND INTO A FILE. `Workation Gates`
// now composes `internalNote` (see workationGates.js's composeInternalNote()),
// and this node interpolates it — the same shape UC-01 already uses, where
// `Compose Internal Note` feeds `updateFields.internalNote = "={{
// $json.internalNote }}"` (workflows/nodes/escalationCloseNodesSpec.js). That
// is not cosmetic: `npm run verify-deployed` diffs the gates body byte for
// byte, so from now on the sentence a customer's ticket carries is covered by
// a check, and a hand edit in the n8n editor that replaces the interpolation
// with an inline string fails `flagAwaitingApprovalIssues()` below.
//
// TWO CHECKS HOLD THIS FILE, deliberately against different authorities:
//   1. test/n8nUc04StageVocabulary.test.js — hermetic, no n8n credentials.
//      Holds the constants below against a CAPTURED SNAPSHOT of the live node
//      (read from the n8n API on 2026-08-31, `versionId === activeVersionId
//      === 50e33f3c-23bc-4e1c-b1d3-016751e57744`) and against deliberately
//      mutated copies of it, so the detector is proven able to fail before it
//      is trusted to pass.
//   2. `scripts/lib/deployedNodeMappings.mjs`'s STRUCTURAL_MAPPINGS — WIRED
//      2026-08-31. `npm run verify-deployed` now runs
//      `flagAwaitingApprovalIssues()` against the LIVE node on every check, and
//      the node's entry in `scripts/lib/unguarded-node-baseline.json` was
//      removed in the same change, so the coverage ratchet would report it as a
//      new unguarded node if the row were ever dropped. Check 1 holds the
//      constants against a snapshot; check 2 holds the deployment against the
//      constants. Neither substitutes for the other — a snapshot cannot notice
//      a hand edit made in the n8n editor tomorrow, and a live check cannot run
//      in `npm test` at all (verify-deployed exits 2 without an N8N_API_KEY).
// ---------------------------------------------------------------------------

export const FLAG_AWAITING_NODE_NAME = "Flag Awaiting Specialist Approval";
export const FLAG_AWAITING_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC04_WORKFLOW_ID = "WORKFLOW_UC04_ID";

/**
 * The composed note, read off `Workation Gates` BY NODE NAME rather than off
 * `$json`.
 *
 * `$json` at this point in the graph is whatever `Assign Routing` last emitted,
 * and `Assign Routing` spreads the SUPABASE INSERT RESPONSE it received from
 * `Append Audit Log` (`const ctx = $json ...` in workflows/nodes/assignRouting.js)
 * — it does not carry the gates' fields at all. Every other expression on this
 * node already addresses `$('Workation Gates')` for the same reason; getting
 * this wrong yields an empty note on a green execution.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Workation Gates').item.json.internalNote }}";

/**
 * The record id and the routing sentence are APPENDED in the expression rather
 * than composed into `internalNote`, because both are produced DOWNSTREAM of
 * `Workation Gates` — the authorization row does not exist when the gates run,
 * and `Assign Routing` has not run either. Same split, same reason, as
 * `deploy-routing-nodes.mjs` appending the routing sentence to UC-01's two note
 * nodes.
 */
export const RECORD_ID_INTERPOLATION = "{{ $('Create Authorization Record').item.json.id }}";
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/** The exact `updateFields.internalNote` this node must carry. */
export const INTERNAL_NOTE_EXPRESSION =
  "=" +
  INTERNAL_NOTE_INTERPOLATION +
  "\n\nWork authorization record: " +
  RECORD_ID_INTERPOLATION +
  "\n" +
  ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live node. Kept here so a regression on it is visible too. */
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * UNCHANGED, AND THE REASON IS WORTH ONE LINE. Zendesk's `pending` means
 * "waiting on somebody who is not us". For a UC-04 request that is now exactly
 * true and was only accidentally true before: the ticket is waiting on the
 * CUSTOMER'S manager, outside Remote entirely. Do not "fix" it to `open`.
 */
export const TICKET_STATUS = "pending";

/**
 * The outcome tag, UNCHANGED. `src/surfaceverify/registries/index.js` names
 * `uc04_ready_for_approval` in its `autoResolveTags`, so renaming it here would
 * break a registry in a file this pass does not own — and the tag is a machine
 * marker for a STATE, which is genuinely `ready_for_approval`. What was wrong
 * was the prose claiming who that state waits on, not the state.
 */
export const OUTCOME_TAG = "uc04_ready_for_approval";

/**
 * ADDED 2026-08-31, and additive on purpose. `uc04_ready_for_approval` says
 * WHICH STATE; this says WHO IT WAITS ON, which is the fact no tag on this
 * ticket has ever carried and the one a Zendesk view needs to separate "waiting
 * on the customer" from "waiting on us". A view built on the state tag alone
 * puts work nobody in Zendesk can do into a Remote agent's queue — §7's
 * honest-gaps items 7–11 in a different costume.
 *
 * NOT a rename, so nothing that reads the old tag breaks.
 */
export const AWAITING_EMPLOYER_TAG = "uc04_awaiting_employer_approval";

/**
 * The complete target `parameters` block, as data. This is what a deploy has to
 * produce; `flagAwaitingApprovalIssues()` below is what checks it produced it.
 */
export const FLAG_AWAITING_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: "={{ $('Workation Gates').item.json.externalRef }}",
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: TICKET_STATUS,
    tags: [OUTCOME_TAG, AWAITING_EMPLOYER_TAG, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * THE PHRASES THAT MUST NEVER COME BACK. Each is a claim the corrected model
 * makes false, and each is checked as a substring of the whole `updateFields`
 * blob rather than of one field — the 2026-08-29 Zendesk migration's own
 * lesson is that a field-by-field walk misses the copy hiding inside a string
 * inside another field.
 *
 * Case-insensitive, and matched on the SPACED form only, because these are
 * prose phrases and no identifier in this repo contains them.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "mobility specialist's approval",
  "one mobility specialist",
  "awaiting specialist approval",
  "specialist will approve",
]);

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs) and for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning
 * as `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js: a
 * deploy tool that APPENDS to this expression is producing strictly more than
 * the spec asks for, and calling that a regression is how two of this repo's
 * own tools came to disagree and turn `verify-deployed` red on three healthy
 * nodes. The regression this actually guards is the interpolation being GONE —
 * replaced by a hand-typed sentence, which is precisely the state this node
 * was in until 2026-08-31 and which no check could see.
 *
 * @param {object} node the live "Flag Awaiting Specialist Approval" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function flagAwaitingApprovalIssues(node) {
  const issues = [];
  const uf = node?.parameters?.updateFields ?? {};

  if (typeof uf.internalNote !== "string" || !uf.internalNote.includes(INTERNAL_NOTE_INTERPOLATION)) {
    issues.push(
      `updateFields.internalNote is ${JSON.stringify(uf.internalNote)}, expected to interpolate ` +
        `${JSON.stringify(INTERNAL_NOTE_INTERPOLATION)} — the regression is an inline hand-typed note here, ` +
        `which is unversioned, uncheckable, and is how this node came to tell a Remote specialist that a ` +
        `request waiting on the customer's own manager was awaiting theirs`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(uf ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `updateFields still contains ${JSON.stringify(phrase)} — a UC-04 ready_for_approval request waits on ` +
          `the customer's own manager in Remote's product, not on a Remote mobility specialist (UC-04.md §1a)`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of [OUTCOME_TAG, AWAITING_EMPLOYER_TAG, ROUTING_TAG_EXPRESSION]) {
    if (!tags.includes(tag)) {
      issues.push(`updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}`);
    }
  }

  if (uf.group !== ZENDESK_GROUP_EXPRESSION) {
    issues.push(`updateFields.group is ${JSON.stringify(uf.group)}, expected ${JSON.stringify(ZENDESK_GROUP_EXPRESSION)}`);
  }

  if (uf.status !== TICKET_STATUS) {
    issues.push(
      `updateFields.status is ${JSON.stringify(uf.status)}, expected ${JSON.stringify(TICKET_STATUS)} — ` +
        `"pending" is Zendesk's "waiting on somebody who is not us", which is what this ticket is`
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// A SEPARATE, SEPARABLE SECOND CHANGE — the intake trigger's loop guard
// ---------------------------------------------------------------------------
// MEASURED 2026-08-31, from the live Zendesk trigger and all nine live graphs.
//
// UC-04's intake trigger (`99900000000009`) fires when a ticket carries
// `uc04_test` + the employment field and does NOT carry any of
// `uc_processed uc01_auto_resolved verification_exception`. Nothing anywhere
// sets `uc_processed`: grepped across all nine deployed graphs on 2026-08-31,
// **0 occurrences**. The loop guard exists on all nine triggers and is fed by
// nothing.
//
// The consequence on UC-04 specifically: this node's own ticket update — new
// tags, `status: pending`, a group — re-satisfies the trigger's conditions, so
// the graph re-fires itself. The second delivery is harmless in the DURABLE
// sense (`Claim Ticket (Idempotency)` conflicts and it stops at
// `Duplicate Delivery — Stop`), which is why nothing has ever gone red. It is
// not free: every re-fire runs `Fetch Employment (Remote)` FIRST, before the
// claim, and that node has no `onError`, so a dead employment id turns an
// already-processed ticket's next comment into an errored run — which
// `RCX OPS · Error Alerts` turns into a durable `ops_alerts` row and a Telegram
// push. A page for a ticket that was correctly finished days ago.
//
// APPLY THIS TO ALL FOUR TERMINAL ZENDESK NODES OR TO NONE. Tagging only the
// approval branch leaves `blocked`, `escalate` and `unrecognised` re-firing,
// which is a half-fix that reads like a whole one.
//
// THE RISK, NAMED: `uc_processed` is in every one of the nine triggers'
// `not_includes` lists, so a ticket carrying it is excluded from ALL NINE
// intakes. That is only reachable for a ticket that also carries a second
// `uc0N_test` tag, which nothing produces today — but UC-03 does route work on
// to UC-04, and if that hand-off ever becomes tag-driven this becomes the thing
// that silently drops it. It is a live-graph change, so it is stated here as a
// recommendation with its evidence rather than folded into the change above.
export const LOOP_GUARD_TAG = "uc_processed";
export const LOOP_GUARD_TARGET_NODES = Object.freeze([
  "Flag Awaiting Specialist Approval",
  "Flag Blocked Workation",
  "Escalate Workation Ticket",
  "Unrecognised Workation Decision",
]);
