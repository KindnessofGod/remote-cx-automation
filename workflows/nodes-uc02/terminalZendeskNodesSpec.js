// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// FIVE terminal Zendesk nodes on UC-02's live graph (WORKFLOW_UC02_ID):
// "Resolve Expense Ticket", "Flag Blocked Expense", "Flag Expense For Review",
// "Escalate Expense Ticket" and "Unrecognised Expense Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it. The
// prose these five nodes write onto real customers' tickets was typed once into
// a node parameter, versioned by nothing and read back by no check. This is the
// same shape of defect, and the same fix, as UC-01's `composeInternalNote.js`
// and UC-04's `workflows/nodes-uc04/terminalZendeskNodesSpec.js`: compose the
// note in `workflows/nodes-uc02/expenseGates.js` — a file `verify-deployed`
// diffs byte for byte — and have every node interpolate one field.
//
// `test/n8nUc02Parity.test.js` cannot cover this either, by its own design: it
// compares DECISIONS. A node that reaches the right verdict and describes it in
// false words passes it every time.
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG, AND HOW BADLY
// ---------------------------------------------------------------------------
//
// 1. "No auto-approval issued."  ("Escalate Expense Ticket")
//
//    MISLEADING for 3 of the 6 reachable escalate reasons.
//    ESCALATE_REASON_EVALUATED below is that count as data, one row per reason,
//    so the claim in this header is checkable rather than assertable, and a
//    seventh reason added tomorrow fails a test rather than quietly inheriting
//    a sentence written before it existed.
//
//    All three Remote reads on this graph carry `onError:
//    continueRegularOutput` (read live off `WORKFLOW_UC02_ID` on 2026-08-31),
//    which is what makes `upstream_unavailable` and `upstream_record_not_found`
//    genuinely reachable rather than theoretical — a failed read reports
//    `success` and hands the gates an error object in place of the record.
//    `src/uc02/policyEngine.js`'s GATE_SEQUENCE says of those two: *"Remote's
//    API could not be reached, so this expense was never evaluated. Nothing has
//    been decided about it either way."* And of `identity_not_verified`:
//    *"nothing about the expense was disclosed or decided."*
//
//    Saying "no auto-approval issued" about a claim NOBODY ASSESSED implies an
//    assessment ran and came back negative. A Finance Ops agent reads it as a
//    refusal on the merits and goes looking for the merit; there is none to
//    find, and the thing that actually needs doing (an outage, a bad employment
//    id, an unverifiable requester) is one layer up.
//
// 2. "Automation produced an unrecognised decision (…). Routed to a human
//    rather than dropped."  ("Unrecognised Expense Decision")
//
//    True at the Zendesk layer and DIRECTLY CONTRADICTED by the sidebar.
//    `src/uc02/reviewPolicy.js`'s `evaluateExpenseActionability()` (line 196)
//    refuses any row whose `decision !== "human_review"`, and its fallback
//    refusal reads *"it was never routed to Finance Ops, so it has no review
//    path here."* So the ticket tells the human it has been routed to them and
//    the panel tells the same human it never was. One ticket, two surfaces,
//    opposite claims.
//
//    The composed note says what actually happened instead: the gates emit
//    exactly four decisions and this run emitted none of them, which is an
//    AUTOMATION FAULT and not a decision about the expense.
//
// 3. "This claim was blocked, not approved."  ("Flag Blocked Expense") and
//    "AI summary — decision: human_review (…)"  ("Flag Expense For Review")
//
//    Neither is false; both stop one sentence short of the thing the reader
//    needs. Four of the five nodes assign the ticket to the owning team, and
//    only `human_review` has a review path — so on `blocked`, `escalate` and
//    the unrecognised fallback the ticket lands in a queue where nothing on it
//    is open to that queue's approve or decline. Every non-review note now
//    carries that clause, in the sidebar's own terms, so the two surfaces agree
//    for the first time.
//
// 4. "AI summary — …"  (three of the five nodes)
//
//    UC-02 DOES have a real LLM node ("Classify Expense (LLM)"), so "AI" is
//    defensible here in a way it is not on UC-07 — and it is still dropped from
//    all three, judged per node rather than as a blanket:
//
//    | node | "AI summary" | why |
//    |---|---|---|
//    | `Flag Blocked Expense` | FALSE | both reachable `blocked` reasons (`expense_not_pending`, gate 5; `duplicate_submission`, gate 6) are decided BEFORE gate 7 reads the classifier at all |
//    | `Escalate Expense Ticket` | FALSE | every reachable escalate reason is gate 0–4, all before the classifier is read |
//    | `Flag Expense For Review` | TRUE OF SOME, FALSE OF OTHERS | `category_unverified` (7), `policy_cap_unknown` (12) and `low_confidence` (13) rest on the classification; gates 8–11 and 14 do not |
//
//    Replaced by something strictly more informative and never false: the note
//    names `classification.source` (`llm` / `rule_based_fallback`) and the
//    confidence figure, then states — in `describeDecidingGate()`'s own ported
//    words — whether the run ever reached the gate that reads that figure. A
//    reader can now tell "the model decided this" from "the model was consulted
//    and overruled" from "the model played no part in this outcome".
//
// 5. "Your expense claim has been automatically approved."
//    ("Resolve Expense Ticket" — the one CUSTOMER-FACING string on this graph)
//
//    VERIFIED TRUE, AND IT STAYS. This node is reachable only downstream of
//    `Approve Expense (Remote)` — the real `PATCH /v1/expenses/:id` — and that
//    node carries NO `onError` (read live), so a failed write aborts the branch
//    and this reply is never sent. What is ADDED is the figure: an employee
//    used to receive a bare "approved" with no amount, which is the one thing
//    the person it is about cannot check.
//
//    IT STAYS PLAIN TEXT. n8n's Zendesk node sends `publicReply` as plain text
//    and SILENTLY ESCAPES HTML — its `internalNote` sibling is the one
//    documented "(Accepts HTML)". UC-01 delivered an entire letter to a
//    customer as literal `&lt;!doctype html&gt;…` source on a fully green run
//    because of exactly this (CLAUDE.md §4). `CUSTOMER_FACING_NODES` below and
//    `test/n8nUc02TerminalZendeskNodes.test.js` both hold that: no tag, no
//    entity, and no harness vocabulary either.
//
// ---------------------------------------------------------------------------
// THREE PROPERTIES OF THE OLD NODES THAT ARE DELIBERATELY PRESERVED
// ---------------------------------------------------------------------------
//
// These are the things UC-02's nodes already got RIGHT and that UC-04's did
// not, so they are written down as things to protect rather than left to be
// re-derived:
//
// 1. THE RAW REASON IS ALWAYS INTERPOLATED, never enumerated. Every retired
//    note printed `$json.reason` rather than naming causes, which made it
//    structurally immune to UC-04's over-narrow-enumeration defect (a sentence
//    naming a cause that is right for 5 of 12 inputs). `composeInternalNote()`
//    keeps that: its "Assessment:" line prints `reason` verbatim, ALWAYS, and
//    the gate ladder is an addition to it and never a substitute. An
//    unrecognised reason gets `describeDecidingGate()`'s honest "cannot be
//    stated" rather than a nearby rung's words.
// 2. NO TEAM NAME IS HAND-TYPED. `routingNote`, appended by the node, is the
//    one place a team is named, and it is named off the routing table.
//    STATED BECAUSE IT COSTS SOMETHING: `src/uc02/reviewPolicy.js`'s own
//    refusals DO say "Finance Ops", so the composed note quotes them with that
//    phrase dropped rather than byte-for-byte. The alternative is a second copy
//    of a team name sitting six words from the routing table's copy of it —
//    which is precisely the failure `docs/ESCALATION-DESTINATIONS.md` §2.2
//    records for UC-04 ("one team, four spellings, none of them the group's
//    name").
// 3. THE GATE ORDER IS src's, POSITION FOR POSITION, 0–15. The ported
//    GATE_SEQUENCE inside `expenseGates.js` was GENERATED from
//    `src/uc02/policyEngine.js`'s export rather than retyped, and the test
//    holds the two byte-equal.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DOES *NOT* OWN — say it here, not in a report nobody reads
// ---------------------------------------------------------------------------
//
// THE QUEUE TAG (rca-iih7 / D-14) IS NOT THIS FILE'S. `Escalate Expense
// Ticket` and `Unrecognised Expense Decision` already carry
// `={{ $('Assign Routing').item.json.routing.queueTag }}` on the live graph,
// deployed by the pass that owns
// `workflows/nodes/escalationQueueTagSpec.js` — which covers fourteen nodes
// across eight graphs. The tags in this file's targets are copied from that
// spec's rows so a deploy from either cannot drop one, and
// `terminalZendeskNodeIssues()` DELIBERATELY DOES NOT assert the queue tag: two
// checkers asserting one field is how a fix in one lands as a failure in the
// other. A cross-spec test holds the two tables equal instead.
//
// THE TWO SPECS DISAGREE ABOUT `internalNote`, ON PURPOSE AND VISIBLY.
// `escalationQueueTagSpec.js`'s `targetParameters` for UC-02's two nodes carry
// the PRE-CHANGE prose, because that file captured the live graph before this
// change existed. **Publishing its `targetParameters` wholesale for those two
// nodes would revert this one.** For UC-02, take its `tags` array and nothing
// else — `DEPLOY-2026-08-31.md` in this directory says so at the point of use,
// and the cross-spec test asserts the divergence is confined to that one field
// so a drift in `group`, `status` or `id` still names itself.
//
// STRUCTURAL_MAPPINGS IS NOT WIRED HERE. `scripts/lib/` is outside this pass's
// ownership, so `npm run verify-deployed` does not yet run the checkers below
// against the live nodes. Until it does, check 1 (the hermetic test) holds the
// constants against a snapshot and nothing holds the deployment against the
// constants — the deploy doc's "Reading it back" section is that check, by
// hand, and it is a named follow-up rather than a silent gap.
//
// ---------------------------------------------------------------------------
// TWO CHECKS HOLD THIS FILE, against different authorities:
//   1. test/n8nUc02TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against CAPTURED SNAPSHOTS of the five live
//      nodes (read from `GET /api/v1/workflows/WORKFLOW_UC02_ID` on 2026-08-31,
//      `versionId === activeVersionId ===
//      fe90bbff-c0cf-4fdb-8554-9b70c54858bf`) and against deliberately mutated
//      copies, so each detector is proven able to FAIL before it is trusted to
//      pass.
//   2. `scripts/lib/deployedNodeMappings.mjs`'s STRUCTURAL_MAPPINGS, once
//      wired — see above. A snapshot cannot notice a hand edit made in the n8n
//      editor tomorrow, and a live check cannot run in `npm test` at all
//      (`verify-deployed` exits 2 without an `N8N_API_KEY`).
// ---------------------------------------------------------------------------

export const RESOLVE_NODE_NAME = "Resolve Expense Ticket";
export const BLOCKED_NODE_NAME = "Flag Blocked Expense";
export const REVIEW_NODE_NAME = "Flag Expense For Review";
export const ESCALATE_NODE_NAME = "Escalate Expense Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Expense Decision";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC02_WORKFLOW_ID = "WORKFLOW_UC02_ID";

/** All five, in the order `Route by Decision` fans out to them. */
export const TERMINAL_NODE_NAMES = Object.freeze([
  RESOLVE_NODE_NAME,
  BLOCKED_NODE_NAME,
  REVIEW_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
]);

/**
 * The one node an EMPLOYEE reads. Kept as a set rather than as a comparison
 * against a name literal, so the hygiene rules below (plain text, no harness
 * vocabulary) are applied by membership and a second customer-facing node
 * added later inherits them instead of being missed.
 */
export const CUSTOMER_FACING_NODES = Object.freeze([RESOLVE_NODE_NAME]);

/**
 * The composed note, read off `Expense Gates` BY NODE NAME and with `.first()`
 * rather than `.item`.
 *
 * NOT `$json`, for the same reason UC-04's spec gives: at four of these nodes
 * `$json` is whatever `Assign Routing` emitted and at the fifth it is
 * `Carry Context After Approve`'s output. Both happen to spread the gates'
 * fields today, which is exactly what makes `$json` the wrong thing to depend
 * on — the day one of those Code nodes stops spreading, the expression renders
 * as an EMPTY STRING on a fully green execution and every layer reports
 * success. Same silent shape as `verify-traces`'s dead-probe-name check and as
 * the 401 that reported success because the header was present but empty.
 *
 * `.first()` AND NOT `.item`, which is a departure from UC-04 and is deliberate.
 * `.item` resolves through n8n's pairedItem chain, and the chain from
 * `Expense Gates` to these nodes is eight hops long and crosses a Supabase node
 * with `onError: continueRegularOutput`, an HTTP node and four Code nodes. If
 * any link drops its pairing, `.item` throws "Paired item data unavailable" and
 * the node FAILS — which on `Resolve Expense Ticket` means a customer whose
 * expense was really approved receives nothing at all. `.first()` needs no
 * pairing, this graph is single-item by construction (one webhook delivery, one
 * item), and `.first()` is already the established form for reaching this node
 * on this graph: `Carry Context Forward` and `Carry Context After Approve` both
 * do `$('Expense Gates').first().json`.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Expense Gates').first().json.internalNote }}";

/**
 * The customer's reply, from the same node and by the same rule. Composed
 * upstream so the money figure in it is produced by the file that holds the
 * money, not by an expression doing arithmetic in a node parameter.
 */
export const CUSTOMER_REPLY_INTERPOLATION = "{{ $('Expense Gates').first().json.customerReply }}";

/**
 * The routing sentence is APPENDED in the expression rather than composed into
 * `internalNote`, because it is produced DOWNSTREAM of `Expense Gates` —
 * `Assign Routing` has not run when the gates run, so the group and the tags it
 * resolves do not exist yet.
 *
 * `.item` here, UNCHANGED from the four live nodes that already carry it and
 * that have been proven working by real executions (10162, 10292). It is not
 * "corrected" to `.first()`: those four expressions are not the regression this
 * file exists to fix, and rewriting a proven expression to match a new one is
 * how a prose change becomes an outage.
 */
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/**
 * The same sentence for `Resolve Expense Ticket` ALONE, which has never carried
 * a routing interpolation and is therefore getting a new expression rather than
 * keeping a proven one. A new expression on the branch that answers the
 * customer takes the pairing-free form — see INTERNAL_NOTE_INTERPOLATION.
 */
export const ROUTING_NOTE_INTERPOLATION_UNPAIRED = "{{ $('Assign Routing').first().json.routingNote }}";

/**
 * The exact `updateFields.internalNote` the four non-approve nodes must carry.
 * Identical across the four ON PURPOSE: the per-decision difference is composed
 * inside `composeInternalNote()`, which is diffed byte for byte by
 * `npm run verify-deployed`, rather than typed four times into four node
 * parameters where four copies drift independently. That drift is not
 * hypothetical — it is what produced the four different wrong sentences this
 * file exists to retire.
 */
export const INTERNAL_NOTE_EXPRESSION = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION;

/** The same, for the one node whose expressions are new. */
export const RESOLVE_INTERNAL_NOTE_EXPRESSION =
  "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION_UNPAIRED;

/** The customer-facing reply, whole. Nothing is appended to it. */
export const PUBLIC_REPLY_EXPRESSION = "=" + CUSTOMER_REPLY_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14's expression, ALREADY LIVE on the escalate and unrecognised
 * nodes. Reproduced here so the targets in this file are complete and pasteable
 * — a spec that lists only the fields it changes cannot be pasted, and a spec
 * that cannot be pasted gets hand-assembled, which is how the prose these nodes
 * carried got there. It is deliberately NOT asserted by the checkers below:
 * `workflows/nodes/escalationQueueTagSpec.js` owns that dimension.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/** The per-decision outcome tags, UNCHANGED. Machine markers for a STATE. */
export const AUTO_APPROVED_TAG = "uc02_auto_approved";
export const BLOCKED_TAG = "uc02_blocked";
export const REVIEW_TAG = "uc02_human_review";
export const ESCALATED_TAG = "uc02_escalated";
export const EXCEPTION_TAG = "uc02_exception";

/**
 * Statuses, UNCHANGED, and worth one line each because "fixing" them is a
 * plausible-looking wrong move.
 *
 * `auto_approve` is `solved` — the automation answered the customer and there
 * is nothing left for anyone to do.
 *
 * `blocked` and `human_review` are `pending`. For `human_review` that is
 * Zendesk's "waiting on somebody who is not us" applied to the reviewer's own
 * queue; for `blocked` it is a request waiting on the requester to re-file or
 * on nobody at all. `open` would put a blocked claim in an agent's active view
 * claiming it is workable, which is the contradiction defect 3 is about.
 *
 * `escalate` and the unrecognised fallback are `open` — both ARE queued work
 * for a human here, which is exactly the distinction `pending` would erase.
 */
export const RESOLVE_STATUS = "solved";
export const BLOCKED_STATUS = "pending";
export const REVIEW_STATUS = "pending";
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
 * cannot guard the RENDERED text, which is `composeInternalNote()`'s output —
 * that is guarded by the test executing the composer directly.
 *
 * `"ai summary"` is listed even though `"ai summary — escalated"` would also
 * catch the escalate node's copy: the stem is what a shortened retype would
 * produce, and both firing on one string is two messages for one defect, which
 * is the harmless direction.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "no auto-approval issued",
  "ai summary",
  "routed to a human rather than dropped",
  "this claim was blocked, not approved",
]);

/**
 * The 6 reachable `escalate` reasons, with a verdict on the sentence this
 * change retires: "No auto-approval issued."
 *
 * As DATA rather than as a paragraph, so the header's "3 of 6" is a count a
 * test can take rather than a claim a reader has to trust. Read off
 * `workflows/nodes-uc02/expenseGates.js` on 2026-08-31: two from
 * `upstreamVerdict()` (which always returns `decision: 'escalate'`) and four
 * from `evaluate()`'s own literal returns.
 *
 * `evaluated` means SOMETHING ABOUT THIS CLAIM WAS ACTUALLY ASSESSED — not that
 * it was assessed favourably. `misleading` is the verdict on the retired
 * sentence, and it is `true` exactly where "no auto-approval issued" implies an
 * assessment that did not happen. Nothing here is read by a gate; it is
 * evidence for a prose change, kept next to the prose it justifies.
 */
export const ESCALATE_REASON_EVALUATED = Object.freeze([
  {
    reason: "upstream_unavailable",
    source: "upstreamVerdict() — any of the three Remote reads",
    evaluated: false,
    misleading: true,
    why: "GATE_SEQUENCE's own words: \"Remote's API could not be reached, so this expense was never evaluated. Nothing has been decided about it either way.\" Reachable because all three Remote reads carry onError: continueRegularOutput, so a failed read reports success and hands the gates an error object",
  },
  {
    reason: "upstream_record_not_found",
    source: "upstreamVerdict() — employment or expense-categories read",
    evaluated: false,
    misleading: true,
    why: "an authoritative 404 about the EMPLOYMENT, not an answer about the expense — GATE_SEQUENCE: \"there was nothing to check this expense against\". No amount was compared to anything",
  },
  {
    reason: "identity_not_verified",
    source: "gate 1",
    evaluated: false,
    misleading: true,
    why: "GATE_SEQUENCE: \"nothing about the expense was disclosed or decided.\" A failure to VERIFY the submitter, not a finding about the claim",
  },
  {
    reason: "employee_not_active",
    source: "gate 2",
    evaluated: true,
    misleading: false,
    why: "an answer about the employment the claim rides on — true, and it says nothing a reader could act on, which is why the composed note names the gate instead",
  },
  {
    reason: "expense_not_found",
    source: "gate 3",
    evaluated: true,
    misleading: false,
    why: "an authoritative answer about the expense itself: no such record at Remote",
  },
  {
    reason: "expense_employment_mismatch",
    source: "gate 4",
    evaluated: true,
    misleading: false,
    why: "the claim exists and belongs to somebody else — a real finding about it, though still not an assessment of the spend",
  },
]);

/**
 * The complete target `parameters` block for each node, as data. This is what a
 * deploy has to produce; the checkers below are what check it produced it.
 *
 * `authentication`, `operation` and `id` are carried unchanged from the live
 * nodes and repeated here rather than omitted, for the reason given above: a
 * spec that cannot be pasted gets hand-assembled.
 */

/**
 * THE CUSTOMER-FACING NODE, and the only one gaining `internalNote` as a NEW
 * field rather than as a replacement.
 *
 * SEPARABLE, AND MARKED SO IN THE DEPLOY DOC. An auto-approved ticket carries
 * no internal record at all today — the one decision on this graph that MOVED
 * MONEY is also the one nobody can reconstruct from the ticket. Adding the
 * composed note fixes that at no risk (`.first()` needs no pairing) and it is
 * strictly an addition, so it can be dropped from the deploy without touching
 * anything else if the operator wants the smallest possible change.
 *
 * `group` is deliberately NOT added. This node has never set one, and assigning
 * a solved auto-approved ticket to a queue is a ROUTING change wearing a prose
 * change's clothes.
 */
export const RESOLVE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    publicReply: PUBLIC_REPLY_EXPRESSION,
    internalNote: RESOLVE_INTERNAL_NOTE_EXPRESSION,
    status: RESOLVE_STATUS,
    tags: [AUTO_APPROVED_TAG],
  },
});

export const BLOCKED_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: BLOCKED_STATUS,
    // No queue tag: `isEscalation('blocked')` is false, so `routingTag` already
    // IS the queue tag and a second copy would be redundant. Matches
    // escalationQueueTagSpec.js's own reasoning for UC-04's blocked node —
    // which is why that spec has no row for this one either.
    tags: [BLOCKED_TAG, ROUTING_TAG_EXPRESSION],
  },
});

export const REVIEW_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    // The retired expression ended `… {{ $json.receiptNote || '' }}`, which is
    // why gate 8b's receipt comparison reached a reviewer on THIS branch and
    // nowhere else. It is now folded into `composeInternalNote()` and therefore
    // appears on all five.
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: REVIEW_STATUS,
    tags: [REVIEW_TAG, ROUTING_TAG_EXPRESSION],
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
    // ALREADY LIVE. Copied from escalationQueueTagSpec.js's row so a deploy
    // from this file cannot drop it; not asserted by the checker below, because
    // that file owns the dimension.
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
    tags: [EXCEPTION_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * One row per node: everything the parameterised checker needs. Keyed by node
 * NAME because that is what n8n and STRUCTURAL_MAPPINGS both address nodes by.
 */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [RESOLVE_NODE_NAME]: Object.freeze({ name: RESOLVE_NODE_NAME, parameters: RESOLVE_PARAMETERS }),
  [BLOCKED_NODE_NAME]: Object.freeze({ name: BLOCKED_NODE_NAME, parameters: BLOCKED_PARAMETERS }),
  [REVIEW_NODE_NAME]: Object.freeze({ name: REVIEW_NODE_NAME, parameters: REVIEW_PARAMETERS }),
  [ESCALATE_NODE_NAME]: Object.freeze({ name: ESCALATE_NODE_NAME, parameters: ESCALATE_PARAMETERS }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({ name: UNRECOGNISED_NODE_NAME, parameters: UNRECOGNISED_PARAMETERS }),
});

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs, once wired) and for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning
 * as `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js: a
 * deploy tool that APPENDS to this expression is producing strictly more than
 * the spec asks for, and calling that a regression is how two of this repo's own
 * tools came to disagree and turn `verify-deployed` red on three healthy nodes.
 * The regression this actually guards is the interpolation being GONE — replaced
 * by a hand-typed sentence, which is precisely the state all five nodes were in
 * until 2026-08-31 and which no check could see.
 *
 * TAGS ARE ALSO CONTAINMENT. An EXTRA tag is not refused — most concretely,
 * `uc_processed` (the intake-trigger loop guard argued for in
 * flagAwaitingApprovalSpec.js) may be added to all five without this checker
 * going red. What is refused is a tag going MISSING.
 *
 * THE QUEUE TAG IS NOT CHECKED HERE. See this file's header:
 * `workflows/nodes/escalationQueueTagSpec.js` owns it across fourteen nodes on
 * eight graphs, and two checkers asserting one field is how a fix in one lands
 * as a failure in the other.
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
  const wantUf = want.updateFields;

  if (typeof uf.internalNote !== "string" || !uf.internalNote.includes(INTERNAL_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote is ${JSON.stringify(uf.internalNote)}, expected to interpolate ` +
        `${JSON.stringify(INTERNAL_NOTE_INTERPOLATION)} — the regression is an inline hand-typed note here, which is ` +
        `unversioned, uncheckable, and is how this node came to describe a decision in words the sidebar contradicts`
    );
  }

  // Which routing form this node takes is per-node: four keep the `.item` form
  // they were already proven on, and `Resolve Expense Ticket`'s expression is
  // new, so it takes the pairing-free one. Read off the target rather than
  // hardcoded, so adding a sixth node cannot silently pick the wrong one.
  const wantRouting = wantUf.internalNote.includes(ROUTING_NOTE_INTERPOLATION_UNPAIRED)
    ? ROUTING_NOTE_INTERPOLATION_UNPAIRED
    : ROUTING_NOTE_INTERPOLATION;
  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(wantRouting)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(wantRouting)} — ` +
        `the routing sentence is produced downstream of the gates, so it cannot be composed into internalNote and ` +
        `has to be appended here; without it the ticket never says which team owns it`
    );
  }

  // The customer-facing reply, on the one node that has one.
  if (CUSTOMER_FACING_NODES.includes(spec.name)) {
    if (uf.publicReply !== wantUf.publicReply) {
      issues.push(
        `${spec.name}: updateFields.publicReply is ${JSON.stringify(uf.publicReply)}, expected ` +
          `${JSON.stringify(wantUf.publicReply)} — this is the ONE string on this graph an employee reads, and it is ` +
          `sent as PLAIN TEXT (n8n silently escapes HTML in publicReply), so it is composed upstream rather than typed here`
      );
    }
  } else if (uf.publicReply !== undefined) {
    issues.push(
      `${spec.name}: updateFields.publicReply is set to ${JSON.stringify(uf.publicReply)} — this node is not ` +
        `customer-facing, and a reply here would send a decision straight to the employee with no human between`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc02/terminalZendeskNodesSpec.js's header for what that sentence claims and why it is ` +
          `misleading or contradicted by the sidebar`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of wantUf.tags) {
    // The queue tag is owned by escalationQueueTagSpec.js, not by this file.
    if (tag === QUEUE_TAG_EXPRESSION) continue;
    if (!tags.includes(tag)) {
      issues.push(
        `${spec.name}: updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}`
      );
    }
  }

  if (uf.group !== wantUf.group) {
    issues.push(
      `${spec.name}: updateFields.group is ${JSON.stringify(uf.group)}, expected ` +
        `${JSON.stringify(wantUf.group)} — absent lands the ticket in the account's default Support group ` +
        `(§7's honest-gaps items 7–8)`
    );
  }

  if (uf.status !== wantUf.status) {
    issues.push(
      `${spec.name}: updateFields.status is ${JSON.stringify(uf.status)}, expected ` +
        `${JSON.stringify(wantUf.status)} — "pending" is Zendesk's "waiting on somebody who is not us", "open" is ` +
        `queued work for an agent here, and "solved" says the automation already answered; the three are not interchangeable`
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
export function resolveNodeIssues(node) {
  return terminalZendeskNodeIssues(node, RESOLVE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function blockedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, BLOCKED_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function reviewNodeIssues(node) {
  return terminalZendeskNodeIssues(node, REVIEW_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
