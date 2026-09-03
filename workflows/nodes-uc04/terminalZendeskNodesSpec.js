// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// three REMAINING terminal Zendesk nodes on UC-04's live graph
// (WORKFLOW_UC04_ID): "Flag Blocked Workation", "Escalate Workation Ticket"
// and "Unrecognised Workation Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it. All
// four of UC-04's terminal Zendesk nodes were baselined as unguarded in
// `scripts/lib/unguarded-node-baseline.json` for exactly that reason. On
// 2026-08-31 `flagAwaitingApprovalSpec.js` closed the FOURTH one; this file is
// the other three, and it is the same shape of defect three times over: prose
// typed once into a node parameter, written onto real customers' tickets, read
// back by no check and versioned by nothing.
//
// THE CORRECT NOTE ALREADY EXISTED, DEPLOYED, AND NOTHING READ IT.
// `composeInternalNote()` in workflows/nodes-uc04/workationGates.js emits a
// stage-aware `internalNote` for EVERY decision — `ready_for_approval`,
// `escalate`, `blocked`, and the unrecognised fallback — and says so in its own
// comment ("so the other three Zendesk terminal nodes can adopt `internalNote`
// without this file changing again"). Only the approval node consumed it. The
// other three kept their hand-typed sentences, so the graph was carrying two
// descriptions of the same decision, one of them correct and unread.
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG, AND HOW BADLY
// ---------------------------------------------------------------------------
//
// 1. "Blocked by the risk matrix or employer permission — not open to approval
//    here."  ("Flag Blocked Workation")
//
//    Accurate for 5 of the 12 reachable `blocked` reasons. BLOCKED_REASON_
//    ACCURACY below is that count as data, one row per reason, so the claim in
//    this header is checkable rather than assertable. The two that matter:
//
//    - `factors_invalid` — FALSE. `risk` is literally `null`; classifyRisk() is
//      never called, so nothing was computed and nothing was refused on merit.
//      The request was rejected on its FORM. This is likely the most common
//      blocked reason in practice: the portal's own visa options have produced
//      it, and the ladder itself describes the class as "needs re-submitting…
//      not a refusal a person overturns".
//    - `sanctioned_region` — FALSE. It comes off the jurisdiction screen at the
//      head of classifyRisk(), before any origin→destination matrix lookup; the
//      risk PAIR is never consulted and `riskLevel` is the literal string
//      `blocked` rather than a matrix level. A jurisdiction fact, not a risk
//      classification.
//
//    MISLEADING for the five form errors — `same_country_workation`,
//    `invalid_date`, `end_before_start`, `travel_history_unreadable`,
//    `start_in_past`. Each needs re-submitting. Telling a specialist the risk
//    matrix refused it invites them to look for a risk decision to overturn,
//    and there is none to find.
//
// 2. "Not open to 1-click approval here."  ("Escalate Workation Ticket")
//
//    True, and it implies something false: that a SLOWER approval exists in
//    Zendesk. None does, for ANY UC-04 decision, on ANY surface. Measured
//    rather than assumed:
//      - `src/uc04/approvalPolicy.js` refuses with `not_awaiting_approval`;
//      - the ZAF UC-04 panel has no `renderActions` at all — there is no
//        control to press;
//      - `/remoteui` diverts blocked rows out of its own list and 404s a direct
//        POST.
//    So the ticket was inviting a specialist to find the non-1-click route,
//    which does not exist. `composeInternalNote()` says the true thing instead:
//    neither stage 2 nor stage 3 is reached, and nobody is being asked.
//
// 3. "ESCALATED to Mobility Legal Tier-2".  ("Escalate Workation Ticket")
//
//    Names a group that DOES NOT EXIST. The live group is
//    `Mobility & Legal (Tier-2)`, id 99900000000009
//    (`src/shared/escalationGroupIds.js`). The note then appends `routingNote`,
//    which spells it correctly off the routing table — so ONE PARAGRAPH NAMES
//    ONE TEAM TWICE, SIX WORDS APART, IN TWO SPELLINGS, one of them
//    unsearchable in Zendesk. Already recorded at
//    `docs/ESCALATION-DESTINATIONS.md` §2.2, "UC-04 — one team, four spellings,
//    none of them the group's name".
//
// ---------------------------------------------------------------------------
// WHAT THIS CHANGE DOES *NOT* FIX — say it here, not in a report nobody reads
// ---------------------------------------------------------------------------
//
// `composeInternalNote()` embeds `summary`, and `summary` comes from
// `draftSummaryTemplate()` in the SAME file, whose `blocked` and `escalate`
// branches still read:
//
//     "Blocked by the risk matrix — not open to approval here."
//     "Escalated to Mobility Legal Tier-2; not open to 1-click approval here."
//
// VERIFIED by executing the current body: a `factors_invalid` run renders
// "Risk-matrix level: unknown. Blocked by the risk matrix — not open to
// approval here." — the note contradicting itself inside one line. So
// interpolating the composed note removes the node's OWN copy of these
// sentences and leaves the copy that rides in via `summary`. The ticket text
// still carries "Mobility Legal Tier-2" and "not open to 1-click approval
// here".
//
// NOT FIXED HERE ON PURPOSE: workationGates.js is being edited in parallel and
// a second edit would conflict. It is a follow-up with a known site —
// `draftSummaryTemplate()`'s `blocked` / `escalate` branches, which mirror
// `src/uc04/requestParser.js`'s wording and should move with it. FORBIDDEN_
// PHRASES below therefore guards the NODE BLOB (the expression a human types),
// which is what this file owns; it cannot and does not guard the rendered text.
//
// ---------------------------------------------------------------------------
// THE ONE BEHAVIOURAL ADDITION: rca-iih7 / D-14 on the escalate node
// ---------------------------------------------------------------------------
//
// `Assign Routing` sets `routeTags = escalated ? [queueTag, escalationTag] :
// [queueTag]` and builds `routingNote` from `routeTags.join(', ')` — so on an
// escalation the note CLAIMS both tags were applied. But `routingTag`, the
// single value these nodes append, resolves to `escalationTag` ALONE when
// escalated. For UC-04 that means the ticket claims
// `queue_mobility_specialists, escalation_mobility_legal_t2` and carries only
// the second. A Zendesk view built on the tag the note names shows nothing —
// the failure `docs/APPROVAL-QUEUE.md` exists to catch, and the identical
// finding already fixed on UC-01's "Escalate Ticket" (see
// `workflows/nodes/escalationCloseNodesSpec.js`'s NOTE_NODE_QUEUE_TAG_
// EXPRESSION) and never generalised to the other graphs.
//
// So `Escalate Workation Ticket` — and ONLY it — also appends
// `{{ $('Assign Routing').item.json.routing.queueTag }}`. For `blocked` and
// the unrecognised fallback, `isEscalation()` is false, `routingTag` already IS
// the queue tag, and a second copy would be redundant.
//
// ONE CAVEAT, STATED BECAUSE IT IS NOT AIRTIGHT: `isEscalation()` returns TRUE
// for a missing or blank decision — which is precisely the input that can reach
// the unrecognised branch. Today the gates emit one of four non-empty strings
// so it cannot happen, but if it ever did, "Unrecognised Workation Decision"
// would inherit the same D-14 gap. Left alone rather than pre-emptively
// patched: adding the queue tag to a node whose `routingTag` is ALREADY the
// queue tag on every reachable input would make the redundant case the normal
// one, and this repo has paid twice for guards that assert a condition nobody
// can observe. Named here so the next reader does not have to re-derive it.
//
// ---------------------------------------------------------------------------
// TWO CHECKS HOLD THIS FILE, against different authorities — same discipline as
// flagAwaitingApprovalSpec.js:
//   1. test/n8nUc04TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against CAPTURED SNAPSHOTS of the three live
//      nodes (read from the n8n API on 2026-08-31, `versionId ===
//      activeVersionId === 50e33f3c-23bc-4e1c-b1d3-016751e57744`) and against
//      deliberately mutated copies, so each detector is proven able to FAIL
//      before it is trusted to pass.
//   2. `scripts/lib/deployedNodeMappings.mjs`'s STRUCTURAL_MAPPINGS, wired
//      separately — `npm run verify-deployed` runs these checkers against the
//      LIVE nodes. Check 1 holds the constants against a snapshot; check 2
//      holds the deployment against the constants. Neither substitutes for the
//      other: a snapshot cannot notice a hand edit made in the n8n editor
//      tomorrow, and a live check cannot run in `npm test` at all
//      (verify-deployed exits 2 without an N8N_API_KEY).
// ---------------------------------------------------------------------------

export const BLOCKED_NODE_NAME = "Flag Blocked Workation";
export const ESCALATE_NODE_NAME = "Escalate Workation Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Workation Decision";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC04_WORKFLOW_ID = "WORKFLOW_UC04_ID";

/** All three, in the order they appear on the canvas. */
export const TERMINAL_NODE_NAMES = Object.freeze([BLOCKED_NODE_NAME, ESCALATE_NODE_NAME, UNRECOGNISED_NODE_NAME]);

/**
 * The composed note, read off `Workation Gates` BY NODE NAME rather than off
 * `$json`.
 *
 * `$json` at these three nodes is whatever `Assign Routing` last emitted, and
 * `Assign Routing` spreads the SUPABASE INSERT RESPONSE it received upstream
 * (`const ctx = $json …` in workflows/nodes/assignRouting.js) — it does not
 * carry the gates' fields at all. Every other expression on all three nodes
 * already addresses `$('Workation Gates')` for the same reason.
 *
 * GETTING THIS WRONG IS SILENT. An n8n expression that dereferences a field
 * nothing produces renders as an EMPTY STRING on a fully green execution — the
 * same shape as `verify-traces`'s dead-probe-name check and as the 401 that
 * reported success because the header was present but empty. The ticket would
 * get an internal note consisting of the routing sentence and nothing else, and
 * every layer would report success.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Workation Gates').item.json.internalNote }}";

/**
 * The routing sentence is APPENDED in the expression rather than composed into
 * `internalNote`, because it is produced DOWNSTREAM of `Workation Gates` —
 * `Assign Routing` has not run when the gates run, so the group and the tags it
 * resolves do not exist yet. Same split, same reason, as
 * `flagAwaitingApprovalSpec.js` and as `deploy-routing-nodes.mjs` appending it
 * to UC-01's two note nodes.
 */
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
export const INTERNAL_NOTE_EXPRESSION = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $('Workation Gates').item.json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14. The OWNING team's tag regardless of escalation state, read
 * by node name rather than by indexing `zendeskTags[0]`, so a future reordering
 * of that array cannot silently repoint this expression at the wrong element.
 * Escalate node only — see this file's header for why the other two do not get
 * it and why that decision is not airtight.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/** The per-decision outcome tags, UNCHANGED. Machine markers for a STATE. */
export const BLOCKED_TAG = "uc04_blocked";
export const ESCALATED_TAG = "uc04_escalated";
export const EXCEPTION_TAG = "uc04_exception";

/**
 * Statuses, UNCHANGED, and worth one line each because "fixing" them is a
 * plausible-looking wrong move.
 *
 * `blocked` is `pending` — Zendesk's "waiting on somebody who is not us". A
 * blocked request is waiting on the requester to re-submit or on nobody at all;
 * either way it is not queued work for a Remote agent, and `open` would put it
 * in an agent's active view claiming otherwise.
 *
 * `escalate` and the unrecognised fallback are `open` — both ARE queued work
 * for a human here, which is exactly the distinction `pending` would erase.
 */
export const BLOCKED_STATUS = "pending";
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
 * SCOPE, STATED: this guards the EXPRESSION a human types into the node. It
 * does not and cannot guard the RENDERED note — `summary` still carries
 * "Blocked by the risk matrix" and "not open to 1-click approval here" from
 * `draftSummaryTemplate()`. See this file's header.
 *
 * The stem "blocked by the risk matrix" is listed alongside the full sentence
 * deliberately, so a shortened retype does not slip through; both firing on one
 * string is two messages for one defect, which is the harmless direction.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "blocked by the risk matrix or employer permission",
  "blocked by the risk matrix",
  "not open to 1-click approval",
  "one mobility specialist",
  "mobility specialist's approval",
  // Not a false claim about WHO, but a name no Zendesk search resolves. The
  // live group is `Mobility & Legal (Tier-2)` (99900000000009).
  // docs/ESCALATION-DESTINATIONS.md §2.2.
  "mobility legal tier-2",
]);

/**
 * The 12 reachable `blocked` reasons, with a verdict on the sentence this
 * change retires: "Blocked by the risk matrix or employer permission."
 *
 * As DATA rather than as a paragraph, so the header's "5 of 12" is a count a
 * test can take rather than a claim a reader has to trust. Read off
 * `workflows/nodes-uc04/workationGates.js` on 2026-08-31: two from the ordered
 * gates (`employer_permission_not_granted`, `factors_invalid`) and ten from
 * `classifyRisk()`'s two hard-block returns.
 *
 * `accurate` means the retired sentence was a true description of why the
 * request stopped. Nothing here is read by a gate; it is evidence for a prose
 * change, kept next to the prose it justifies.
 */
export const BLOCKED_REASON_ACCURACY = Object.freeze([
  {
    reason: "employer_permission_not_granted",
    source: "gate 3",
    accurate: true,
    why: "the sentence's second clause names it outright",
  },
  {
    reason: "factors_invalid",
    source: "gate 4",
    accurate: false,
    why: "risk is literally null — classifyRisk() is never called, so nothing was computed and nothing was refused on merit. A form error, and likely the most common blocked reason in practice",
  },
  {
    reason: "sanctioned_region",
    source: "classifyRisk hard block",
    accurate: false,
    why: "emitted by the jurisdiction screen at the head of classifyRisk(), before any origin→destination lookup; the risk pair is never consulted and riskLevel is the literal string 'blocked'",
  },
  {
    reason: "same_country_workation",
    source: "classifyRisk hard block",
    accurate: false,
    why: "misleading — a form error; there is no workation to assess when home and destination are the same country",
  },
  {
    reason: "visitor_visa_active_work_forbidden",
    source: "classifyRisk hard block",
    accurate: true,
    why: "a refusal on the merits of the visa the traveller holds",
  },
  {
    reason: "invalid_date",
    source: "classifyRisk hard block",
    accurate: false,
    why: "misleading — an unparseable date; needs re-submitting, not overturning",
  },
  {
    reason: "end_before_start",
    source: "classifyRisk hard block",
    accurate: false,
    why: "misleading — a form error; needs re-submitting, not overturning",
  },
  {
    reason: "travel_history_unreadable",
    source: "classifyRisk hard block",
    accurate: false,
    why: "misleading — an unreadable prior stay, deliberately a hard block rather than a quiet zero (C-1); nothing about the trip was refused",
  },
  {
    reason: "start_in_past",
    source: "classifyRisk hard block",
    accurate: false,
    why: "misleading — a form error; needs re-submitting, not overturning",
  },
  {
    reason: "schengen_90_180_exceeded",
    source: "classifyRisk second hard block",
    accurate: true,
    why: "a statutory refusal on the merits — Reg. (EU) 2016/399 art. 6(1)",
  },
  {
    reason: "us_requires_work_permit",
    source: "classifyRisk second hard block",
    accurate: true,
    why: "a refusal on the merits of the destination/visa pair",
  },
  {
    reason: "ca_requires_work_permit",
    source: "classifyRisk second hard block",
    accurate: true,
    why: "a refusal on the merits of the destination/visa pair",
  },
]);

/**
 * The complete target `parameters` block for each node, as data. This is what a
 * deploy has to produce; the checkers below are what check it produced it.
 *
 * `authentication`, `operation` and `id` are carried unchanged from the live
 * nodes and repeated here rather than omitted, because a spec that lists only
 * the fields it changes cannot be pasted, and a spec that cannot be pasted gets
 * hand-assembled — which is how the prose these nodes carried got there.
 */
export const BLOCKED_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: BLOCKED_STATUS,
    tags: [BLOCKED_TAG, ROUTING_TAG_EXPRESSION],
  },
});

export const ESCALATE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: ESCALATE_STATUS,
    // rca-iih7 / D-14 — the queue tag before the routing tag, exactly as UC-01's
    // "Escalate Ticket" already carries it.
    tags: [ESCALATED_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

export const UNRECOGNISED_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: UNRECOGNISED_STATUS,
    // QUEUE TAG ADDED 2026-08-31, after the reasoning that withheld it was
    // shown wrong. It was omitted because a blocked or unrecognised decision
    // leaves `escalated` false, so `routingTag` already IS the queue tag. True
    // of a present-but-unknown decision STRING; false of the input this node
    // actually receives most dangerously — `isEscalation()` returns TRUE for a
    // missing, empty or non-string decision ("a missing signal takes the
    // stronger treatment", its own comment), and the fallback output is exactly
    // where such a run lands. On that input routeTags is [queueTag,
    // escalationTag] and routingTag is the escalation marker alone, so the
    // note claims a tag the ticket never gets — the rca-iih7 defect verbatim.
    // UC-01's fix covers BOTH its escalate and its unrecognised node, read live,
    // which is the confirming evidence. `Flag Blocked Workation` correctly does
    // NOT get it: isEscalation('blocked') is false, measured.
    // The tag dimension across all fourteen affected nodes is owned by
    // workflows/nodes/escalationQueueTagSpec.js; the two specs are held equal
    // for UC-04's two nodes by a cross-spec test rather than by one importing
    // the other, so a drop on either side names itself.
    tags: [EXCEPTION_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * One row per node: everything the parameterised checker needs. Keyed by node
 * NAME because that is what n8n and STRUCTURAL_MAPPINGS both address nodes by.
 */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [BLOCKED_NODE_NAME]: Object.freeze({ name: BLOCKED_NODE_NAME, parameters: BLOCKED_PARAMETERS }),
  [ESCALATE_NODE_NAME]: Object.freeze({ name: ESCALATE_NODE_NAME, parameters: ESCALATE_PARAMETERS }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({ name: UNRECOGNISED_NODE_NAME, parameters: UNRECOGNISED_PARAMETERS }),
});

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
 * replaced by a hand-typed sentence, which is precisely the state all three
 * nodes were in until 2026-08-31 and which no check could see.
 *
 * TAGS ARE ALSO CONTAINMENT. An EXTRA tag is not refused — most concretely,
 * `uc_processed` (the intake-trigger loop guard argued for in
 * flagAwaitingApprovalSpec.js) may be added to all four terminal nodes without
 * this checker going red, and a queue tag on the blocked/unrecognised nodes is
 * redundant rather than wrong. What is refused is a tag going MISSING.
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
        `unversioned, uncheckable, and is how this node came to describe a decision in words the gates body already ` +
        `contradicted`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(ROUTING_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(ROUTING_NOTE_INTERPOLATION)} — ` +
        `the routing sentence is produced downstream of the gates, so it cannot be composed into internalNote and ` +
        `has to be appended here; without it the ticket never says which team owns it`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc04/terminalZendeskNodesSpec.js's header for what that sentence claims and why it is ` +
          `false or unsearchable`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of want.updateFields.tags) {
    if (!tags.includes(tag)) {
      issues.push(
        `${spec.name}: updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}` +
          (tag === QUEUE_TAG_EXPRESSION
            ? ` — D-14's regression is this tag ABSENT, so routingNote's own "tagged queue_mobility_specialists, ` +
              `escalation_mobility_legal_t2" claim is false on the ticket and a view built on the queue tag shows nothing`
            : "")
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
        `${JSON.stringify(want.updateFields.status)} — "pending" is Zendesk's "waiting on somebody who is not us" and ` +
        `"open" is queued work for an agent here; the two are not interchangeable`
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
export function blockedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, BLOCKED_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
