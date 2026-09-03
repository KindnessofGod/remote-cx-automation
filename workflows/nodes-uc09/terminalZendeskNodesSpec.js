// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// FOUR terminal Zendesk nodes on UC-09's live graph (WORKFLOW_UC09_ID):
// "Flag Awaiting Dual Approval", "Flag Awaiting Triple Approval",
// "Escalate Adjustment Ticket" and "Unrecognised Adjustment Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it. So the
// text these four nodes write onto real customers' tickets was versioned by
// NOTHING: typed once into a node parameter, read back by no check.
// `test/n8nUc09Parity.test.js` cannot see it either, by its own design — it
// compares DECISIONS, and a node that reaches the right verdict and describes
// it in false words passes it every time. Same shape, same fix, as UC-04's
// `flagAwaitingApprovalSpec.js` + `terminalZendeskNodesSpec.js` and UC-01's
// `escalationCloseNodesSpec.js`.
//
// THE FIX MOVES THE PROSE OUT OF THE NODES AND INTO A FILE.
// `composeInternalNote()` in `workflows/nodes-uc09/adjustmentGates.js` now emits
// a per-decision `internalNote` for EVERY decision, and these four nodes
// interpolate it. That is not cosmetic: `npm run verify-deployed` diffs the
// gates body byte for byte, so from now on the sentence a ticket carries is
// covered by a check, and a hand edit that replaces the interpolation with an
// inline string fails the checkers below.
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG — all four read live off
// WORKFLOW_UC09_ID on 2026-08-31 (`versionId === activeVersionId ===
// 5d35be9a-aaf8-4e4f-8185-3f3e31fa3273`, 18 nodes, `active: true`)
// ---------------------------------------------------------------------------
//
// 1. "…this request needs MANUAL PAYROLL HANDLING, no approval path was
//    offered."  ("Escalate Adjustment Ticket")
//
//    THE SEVERE ONE, AND THE ONLY ONE ALREADY ON REAL TICKETS. It is a true
//    description of exactly ONE of the eight reachable escalate reasons —
//    `employment_not_active`, whose own ladder rung says the payment "is a
//    different process, handled by Payroll directly". ESCALATE_REASON_ACCURACY
//    below is that count as data, one row per reason, so "1 of 8" is a number a
//    test can take rather than a claim a reader has to trust.
//
//    The reason that has actually FIRED in production is
//    `identity_not_verified` — executions 9279 (ticket 135) and 9942
//    (ticket 5), both real, both driven by a real inbound Zendesk ticket. On
//    that path `evaluate()` returns `approvalSlotsRequired: 0` under the
//    comment "no approval path for unverified requests", and
//    src/uc09/policyEngine.js's rung reads: "Money never starts moving on a
//    request whose origin is unverified." So the ticket invited Payroll Ops to
//    move money BY HAND on a request whose origin the gate had just refused to
//    verify — the exact bypass the gate exists to prevent, printed as an
//    instruction, on the one use case in this repository where money moves.
//
// 2. "HIGH RISK, awaiting TRIPLE approval (requester + approver +
//    payment_releaser)"  ("Flag Awaiting Triple Approval")
//
//    Asserted unconditionally. FOUR things raise the floor to three and only
//    TWO of them are risk findings — see THIRD_SIGNATURE_ACCURACY below.
//    `HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY` states ONE line, in USD, so EVERY
//    non-USD adjustment raises the floor via
//    `high_amount_threshold_not_comparable`, which src/uc09/policyEngine.js
//    calls "unmeasured": "an unmeasured amount costs a third signature rather
//    than buying two." A JPY 500 bonus rendered as HIGH RISK. And
//    `high_tax_compliance_risk` (on ['DE','FR','IT']) is called "an UNSOURCED
//    heuristic with no publishing authority behind it" by that same file.
//    Structurally the same defect as UC-04's "Risk-matrix level: unknown.
//    Blocked by the risk matrix" — a computation named as the cause of a
//    determination it did not make.
//
// 3. "(requester + approver)" / "(requester + approver + payment_releaser)"
//    ("Flag Awaiting Dual Approval", "Flag Awaiting Triple Approval")
//
//    Two ROLES. Two roles are exactly what the pre-DRIFT-050 code accepted from
//    ONE human: `adjustmentRow.requester` — the column recording who asked for
//    the money — was compared to nothing, so the filer could sign their own
//    request as `approver` and the floor of two still read satisfied. The rule
//    is live at src/uc09/multiApprovalPolicy.js:171 and the note has to say so,
//    because a note that says "two roles" teaches the reader the old model.
//    Neither node said where the signature is taken either, and UC-09.md §1
//    records that the Customer Admin the spec names as `requester` HAS NO
//    SURFACE ON WHICH TO SIGN — the control renders only in the ZAF sidebar (a
//    Zendesk AGENT surface) and in the UC-09 CLI.
//
// 4. THREE OF THE FOUR SAID "AI" — "AI drafted off-cycle adjustment…" twice
//    and "AI summary -- ESCALATED…" once.
//
//    UC-09's graph has NO LANGUAGE MODEL NODE. Read live: 18 nodes, zero of
//    type `openai`/`langchain`, and `summary` is built by a deterministic
//    template in the gates body. Calling deterministic arithmetic "AI drafted"
//    inverts prime directive 1 and invites a specialist to distrust the one
//    part of this decision that cannot have hallucinated. Dropped.
//
// ---------------------------------------------------------------------------
// WHAT THIS CHANGE DOES *NOT* FIX — say it here, not in a report nobody reads
// ---------------------------------------------------------------------------
//
// * `composeInternalNote()` embeds `summary`, and `summary` is rendered in
//   MAJOR UNITS BY DIVIDING BY 100. That is wrong for a zero-minor-unit
//   currency (JPY, KRW, VND …): 500 JPY renders as "5.00 JPY". The hard-coded
//   `$` beside the currency code WAS fixed in the same pass (a JPY bonus read
//   "$500.00 JPY"); the exponent was NOT, because fixing it needs ISO 4217's
//   per-currency minor-unit table, which this repository does not have and must
//   not invent — prime directive 4, and money is the one thing the substitution
//   ladder forbids fabricating outright. The gates body says so at the site.
//
// * `summary` also omits the gross/net clause src/uc09/workflow.js appends
//   ("gross" / "net" / "with no gross/net basis stated — do not sign without
//   it"). That divergence predates this change and belongs with the
//   request-text echo the same function adds, as one parity pass over the whole
//   summary template rather than folded into a prose fix.
//
// * NOTHING HERE IS WIRED INTO `scripts/lib/deployedNodeMappings.mjs`'s
//   STRUCTURAL_MAPPINGS, so `npm run verify-deployed` does not yet run these
//   checkers against the live nodes, and the four nodes' rows in
//   `scripts/lib/unguarded-node-baseline.json` are untouched. That wiring is
//   out of this pass's ownership (`scripts/lib/*` is off limits to it) and is a
//   one-line-per-node follow-up with a known site — the same two-check
//   discipline UC-04 already has. Until it lands, check 1 below (hermetic) is
//   the only one running, and it holds the CONSTANTS against a snapshot rather
//   than holding the DEPLOYMENT against the constants. Those are different
//   claims and only one of them is currently made.
//
// ---------------------------------------------------------------------------
// OVERLAPPING SPEC — `workflows/nodes/escalationQueueTagSpec.js`
// ---------------------------------------------------------------------------
//
// Two of these four nodes — `Escalate Adjustment Ticket` and
// `Unrecognised Adjustment Decision` — are ALSO covered by
// `workflows/nodes/escalationQueueTagSpec.js`, which owns the QUEUE-TAG
// dimension (rca-iih7 / D-14) across fourteen nodes on eight graphs. THE SPLIT
// OF OWNERSHIP IS: that spec owns the tags; this spec owns the PROSE. So
// `terminalZendeskNodeIssues()` below asserts the node's own MARKER tag and the
// routing tag and DELIBERATELY DOES NOT ASSERT THE QUEUE TAG — two checkers
// asserting one field is how a fix in one lands as a failure in the other.
//
// The hazard the split creates is that both files carry a full
// `targetParameters` block for those two nodes, because either can be used to
// deploy them, so a publish from the stale one reverts the other's fix. Held
// equal by a cross-spec assertion in test/n8nUc09TerminalZendeskNodes.test.js
// rather than by one file importing the other: an import would remove the
// duplication and also the failure message, so a dropped field would propagate
// silently and consistently. This way a divergence names itself.
//
// The two `Flag Awaiting …` nodes are NOT in that spec and correctly get NO
// queue tag from this one either: `isEscalation()` matches /^escalat/i, so it
// is false for `dual_approval_required` and `triple_approval_required`,
// `routeTags` is `[queueTag]`, and `routingTag` ALREADY RESOLVES TO the queue
// tag. A second copy would be redundant rather than wrong. Same measured
// reasoning as UC-04's `Flag Blocked Workation`.
//
// ---------------------------------------------------------------------------
// TWO CHECKS ARE INTENDED TO HOLD THIS FILE, against different authorities —
// same discipline as UC-04's two specs. ONLY THE FIRST IS WIRED TODAY:
//   1. test/n8nUc09TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against VERBATIM SNAPSHOTS of the four live
//      nodes and against deliberately mutated copies, so each detector is
//      proven able to FAIL before it is trusted to pass.
//   2. STRUCTURAL_MAPPINGS in scripts/lib/deployedNodeMappings.mjs — NOT WIRED,
//      see "WHAT THIS CHANGE DOES NOT FIX" above. A snapshot cannot notice a
//      hand edit made in the n8n editor tomorrow, and a live check cannot run
//      in `npm test` at all (verify-deployed exits 2 without an N8N_API_KEY),
//      so neither substitutes for the other.
// ---------------------------------------------------------------------------

export const DUAL_NODE_NAME = "Flag Awaiting Dual Approval";
export const TRIPLE_NODE_NAME = "Flag Awaiting Triple Approval";
export const ESCALATE_NODE_NAME = "Escalate Adjustment Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Adjustment Decision";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC09_WORKFLOW_ID = "WORKFLOW_UC09_ID";

/** All four, in the order `Route by Decision` fans out to them. */
export const TERMINAL_NODE_NAMES = Object.freeze([
  DUAL_NODE_NAME,
  TRIPLE_NODE_NAME,
  ESCALATE_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
]);

/**
 * The composed note, read off `Adjustment Gates` BY NODE NAME rather than off
 * `$json`.
 *
 * `$json` at these four nodes is whatever `Assign Routing` last emitted, and
 * `Assign Routing` spreads the SUPABASE INSERT RESPONSE it received upstream
 * (`const ctx = $json …` in workflows/nodes/assignRouting.js) — it does not
 * carry the gates' fields at all. Every other expression on all four nodes
 * already addresses `$('Adjustment Gates')` for exactly this reason.
 *
 * GETTING THIS WRONG IS SILENT. An n8n expression that dereferences a field
 * nothing produces renders as an EMPTY STRING on a fully green execution — the
 * same shape as `verify-traces`'s dead-probe-name check, and as the 401 that
 * reported success because the header was present but empty. The ticket would
 * get an internal note consisting of the routing sentence and nothing else, and
 * every layer would report success.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Adjustment Gates').item.json.internalNote }}";

/**
 * The adjustment record id and the routing sentence are APPENDED in the
 * expression rather than composed into `internalNote`, because both are
 * produced DOWNSTREAM of `Adjustment Gates` — the `uc09_adjustments` row does
 * not exist when the gates run, and `Assign Routing` has not run either. Same
 * split, same reason, as UC-04's `flagAwaitingApprovalSpec.js` and as
 * `deploy-routing-nodes.mjs` appending the routing sentence to UC-01's two note
 * nodes.
 */
export const RECORD_ID_INTERPOLATION = "{{ $('Create Adjustment Record').item.json.id }}";
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/**
 * The `updateFields.internalNote` for the three nodes that already carried the
 * adjustment record id (dual, triple, escalate). Keeping it is deliberate:
 * losing the pointer to the durable row would be a regression in the opposite
 * direction from the one this file fixes.
 */
export const INTERNAL_NOTE_EXPRESSION_WITH_RECORD =
  "=" +
  INTERNAL_NOTE_INTERPOLATION +
  "\n\nAdjustment record: " +
  RECORD_ID_INTERPOLATION +
  "\n" +
  ROUTING_NOTE_INTERPOLATION;

/**
 * The `updateFields.internalNote` for `Unrecognised Adjustment Decision`, which
 * has never carried the record id.
 *
 * NOT ADDED HERE, and the omission is a scope decision rather than a judgement
 * that it would be wrong: `Create Adjustment Record` does run on this branch
 * (it is upstream of `Route by Decision` on every path), so the interpolation
 * would resolve. But this pass owns the PROSE, and quietly adding a field to a
 * node while claiming to fix its sentence is how a spec becomes a place changes
 * hide. Named in DEPLOY-2026-08-31.md as a one-line follow-up.
 */
export const INTERNAL_NOTE_EXPRESSION = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $('Adjustment Gates').item.json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14's queue tag, present on the escalate and unrecognised nodes.
 *
 * DECLARED HERE ONLY SO THE TARGETS CAN BE PASTED WHOLE, AND DELIBERATELY NOT
 * ASSERTED BY THE CHECKER BELOW. `workflows/nodes/escalationQueueTagSpec.js`
 * owns this dimension across all fourteen affected nodes; the cross-spec test
 * holds the two files' targets equal so neither can silently revert the other.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/**
 * The per-decision outcome tags, UNCHANGED. Machine markers for a STATE, and
 * the state was never what was wrong — what was wrong was the prose claiming
 * what that state means and who it waits on.
 */
export const DUAL_TAG = "uc09_awaiting_dual_approval";
export const TRIPLE_TAG = "uc09_awaiting_triple_approval";
export const ESCALATED_TAG = "uc09_escalated";
export const EXCEPTION_TAG = "uc09_exception";

/**
 * Statuses, UNCHANGED, and all four are `open`. Worth one line because
 * "fixing" one to `pending` is a plausible-looking wrong move: Zendesk's
 * `pending` means "waiting on somebody who is not us", and every one of these
 * four IS queued work for a human on this side — two waiting on signatures
 * taken in the ZAF sidebar, two waiting on a specialist. UC-04's blocked and
 * ready_for_approval nodes are `pending` because those genuinely wait on the
 * customer's own manager; nothing on UC-09 does.
 */
export const TERMINAL_STATUS = "open";

/**
 * THE PHRASES THAT MUST NEVER COME BACK, checked as substrings of the whole
 * `updateFields` blob rather than of one field — the 2026-08-29 Zendesk
 * migration's own lesson is that a field-by-field walk misses the copy hiding
 * inside a string inside another field.
 *
 * Case-insensitive, matched on the SPACED form only, because these are prose
 * phrases and no identifier in this repo contains them. `"high risk"` is listed
 * with a space for the same reason: the composed note says "high-risk factor"
 * and "high-value line", both hyphenated, so the guard cannot fire on the
 * correct text.
 *
 * SCOPE, STATED: this guards the EXPRESSION a human types into the node, which
 * is what this file owns. It cannot guard the RENDERED note — that is held by
 * test/n8nUc09TerminalZendeskNodes.test.js, which executes the gates body and
 * asserts over the text `composeInternalNote()` actually produces for each of
 * the eight escalate reasons. Two different checks, because the two failures
 * are different: a hand edit here, and a drift there.
 *
 * The stem "manual payroll handling" is listed alongside the full sentence
 * deliberately, so a shortened retype does not slip through; both firing on one
 * string is two messages for one defect, which is the harmless direction.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "needs manual payroll handling",
  "manual payroll handling",
  "high risk",
  "ai drafted",
  "ai summary",
  "ai-drafted",
  // The unconditional role-pair claim. Two ROLES read as two PEOPLE, which is
  // precisely what DRIFT-050 established they are not — see this file's header,
  // defect 3.
  "awaiting dual approval (requester + approver)",
]);

/**
 * The EIGHT reachable `escalate` reasons, with a verdict on the sentence this
 * change retires: "this request needs manual payroll handling, no approval path
 * was offered."
 *
 * As DATA rather than as a paragraph, so the header's "1 of 8" is a count a
 * test can take rather than a claim a reader has to trust. Read off
 * `workflows/nodes-uc09/adjustmentGates.js` on 2026-08-31: two from the ported
 * `upstreamVerdict()` (which runs BEFORE evaluate()'s own gates), four from
 * `evaluate()`'s ordered gates, and two from the money guard that runs AFTER
 * evaluate() returns.
 *
 * `accurate` means the retired sentence was a true description of what a human
 * should now do. Nothing here is read by a gate; it is evidence for a prose
 * change, kept next to the prose it justifies.
 *
 * NOTE THE FOUR WITH `hasLadderRung: false`. `unparseable_amount` and
 * `amount_not_extracted` are produced by the money guard after evaluate() has
 * returned, and the two upstream reasons before it runs at all, so none of the
 * four appears in src/uc09/policyEngine.js's GATE_SEQUENCE and
 * `describeDecidingGate()` returns null for all four. That is not a defect in
 * this note — it is the ladder's own gap, and `amount_not_extracted` is
 * UC-09's most-ticketed refusal ("3 observed, all 3 ticketed",
 * src/surfaceverify/registries/index.js), so it is the common case rather than
 * the exotic one. The composer says so in the reviewed words
 * src/portal/server.js already uses for exactly this gap, instead of inventing
 * a meaning nobody reviewed.
 */
export const ESCALATE_REASON_ACCURACY = Object.freeze([
  {
    reason: "upstream_record_not_found",
    source: "upstreamVerdict(), before evaluate()",
    hasLadderRung: false,
    accurate: false,
    why: "Remote answered 404 for the employment, so nothing about this request was assessed. Telling Payroll Ops to handle the payment by hand on a record Remote says does not exist is the opposite of the remedy",
  },
  {
    reason: "upstream_unavailable",
    source: "upstreamVerdict(), before evaluate()",
    hasLadderRung: false,
    accurate: false,
    why: "the employment read was never evaluated — a 403/5xx/transport failure. The request has not been refused and has not been assessed; it needs retrying, not paying manually",
  },
  {
    reason: "identity_not_verified",
    source: "evaluate() gate 1",
    hasLadderRung: true,
    accurate: false,
    why: "THE ONE THAT HAS ACTUALLY FIRED (executions 9279 and 9942, both real tickets). approvalSlotsRequired is 0 under the comment 'no approval path for unverified requests', and the rung reads 'Money never starts moving on a request whose origin is unverified.' Inviting manual payment here is the exact bypass the gate exists to prevent",
  },
  {
    reason: "employment_not_active",
    source: "evaluate() gate 2",
    hasLadderRung: true,
    accurate: true,
    why: "the ONLY accurate one. Its own rung says 'A payment owed to someone who has left is a different process, handled by Payroll directly' — so the retired sentence and the ladder agree here and nowhere else",
  },
  {
    reason: "invalid_adjustment_structure",
    source: "evaluate() gate 3",
    hasLadderRung: true,
    accurate: false,
    why: "the request could not be READ well enough to have merits assessed. It needs re-submitting with the missing fields, not paying by hand from an unreadable instruction",
  },
  {
    reason: "schema_invalid",
    source: "evaluate() gate 4",
    hasLadderRung: true,
    accurate: false,
    why: "the payload Remote would receive is missing a required field. The rung's own point is that approvals are deliberately NOT collected for something unpayable; 'handle it manually' recreates by hand the write the schema check just refused",
  },
  {
    reason: "unparseable_amount",
    source: "money guard, after evaluate()",
    hasLadderRung: false,
    accurate: false,
    why: "the amount arrived as a non-integer (typically a quoted numeric string) and was NOT coerced. This is somebody's integration bug; the remedy is a corrected structured submission",
  },
  {
    reason: "amount_not_extracted",
    source: "money guard, after evaluate()",
    hasLadderRung: false,
    accurate: false,
    why: "the free-text parser refused to guess a figure (there is no LLM in a Code node, and the deleted regex once turned $12,500.00 into $3.00). UC-09's most-ticketed refusal. The remedy the summary already names is 'a human must supply the amount as structured input' — which is not the same act as paying it manually",
  },
]);

/**
 * The FOUR triggers that raise the approval floor to three, and whether each is
 * a RISK FINDING. Evidence for retiring the unconditional "HIGH RISK" headline;
 * read off `assessRisk()` in adjustmentGates.js on 2026-08-31 and cross-checked
 * against src/uc09/policyEngine.js's own words.
 *
 * `assessed: false` is NOT a claim that the third signature is unnecessary. The
 * floor may only ever go UP, and an unknown going up is the design. What
 * changes is what the ticket CLAIMS, not what the gate REQUIRES.
 */
export const THIRD_SIGNATURE_ACCURACY = Object.freeze([
  {
    flag: "high_amount_risk",
    assessed: true,
    why: "the amount was compared with a stated policy figure for its own currency and came out above it — a finding",
  },
  {
    flag: "manual_tax_adjustment",
    assessed: true,
    why: "a hand-entered withholding change, which is the failure mode this use case exists to gate — a finding",
  },
  {
    flag: "high_amount_threshold_not_comparable",
    assessed: false,
    why: "HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY holds exactly one row (USD), so EVERY non-USD adjustment lands here. policyEngine.js: 'it is unmeasured, and an unmeasured amount costs a third signature rather than buying two.' A JPY 500 bonus rendered as HIGH RISK",
  },
  {
    flag: "high_tax_compliance_risk",
    assessed: false,
    why: "a hard-coded ['DE','FR','IT'] list that policyEngine.js itself calls 'an UNSOURCED heuristic with no publishing authority behind it', to be read 'as an illustration rather than as a compliance determination'",
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
export const DUAL_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION_WITH_RECORD,
    status: TERMINAL_STATUS,
    // No queue tag: isEscalation('dual_approval_required') is false, so
    // routingTag ALREADY resolves to the queue tag and a second copy would be
    // redundant. Measured, not assumed — assignRouting.js's isEscalation()
    // matches /^escalat/i.
    tags: [DUAL_TAG, ROUTING_TAG_EXPRESSION],
  },
});

export const TRIPLE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION_WITH_RECORD,
    status: TERMINAL_STATUS,
    tags: [TRIPLE_TAG, ROUTING_TAG_EXPRESSION],
  },
});

export const ESCALATE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION_WITH_RECORD,
    status: TERMINAL_STATUS,
    // rca-iih7 / D-14's queue tag, ALREADY LIVE on this node (read back
    // 2026-08-31) and owned by workflows/nodes/escalationQueueTagSpec.js.
    // Reproduced so the block can be pasted whole; NOT asserted by the checker.
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
    status: TERMINAL_STATUS,
    tags: [EXCEPTION_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * One row per node: everything the parameterised checker needs. Keyed by node
 * NAME because that is what n8n and STRUCTURAL_MAPPINGS both address nodes by.
 *
 * `assertedTags` is the subset of `parameters.updateFields.tags` THIS checker
 * is responsible for. It excludes QUEUE_TAG_EXPRESSION on purpose — see this
 * file's "OVERLAPPING SPEC" header. Stored per row rather than derived by
 * filtering, so that adding a tag to a target does not silently add an
 * assertion nobody decided to make.
 */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [DUAL_NODE_NAME]: Object.freeze({
    name: DUAL_NODE_NAME,
    parameters: DUAL_PARAMETERS,
    assertedTags: Object.freeze([DUAL_TAG, ROUTING_TAG_EXPRESSION]),
  }),
  [TRIPLE_NODE_NAME]: Object.freeze({
    name: TRIPLE_NODE_NAME,
    parameters: TRIPLE_PARAMETERS,
    assertedTags: Object.freeze([TRIPLE_TAG, ROUTING_TAG_EXPRESSION]),
  }),
  [ESCALATE_NODE_NAME]: Object.freeze({
    name: ESCALATE_NODE_NAME,
    parameters: ESCALATE_PARAMETERS,
    assertedTags: Object.freeze([ESCALATED_TAG, ROUTING_TAG_EXPRESSION]),
  }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({
    name: UNRECOGNISED_NODE_NAME,
    parameters: UNRECOGNISED_PARAMETERS,
    assertedTags: Object.freeze([EXCEPTION_TAG, ROUTING_TAG_EXPRESSION]),
  }),
});

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs, not yet wired — see the header) and
 * for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning
 * as `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js: a
 * deploy tool that APPENDS to this expression is producing strictly more than
 * the spec asks for, and calling that a regression is how two of this repo's
 * own tools came to disagree and turn `verify-deployed` red on three healthy
 * nodes. The regression this actually guards is the interpolation being GONE —
 * replaced by a hand-typed sentence, which is precisely the state all four
 * nodes were in until 2026-08-31 and which no check could see.
 *
 * TAGS ARE ALSO CONTAINMENT, and only over `assertedTags`. An EXTRA tag is not
 * refused — most concretely, the queue tag on the two nodes that carry it, and
 * `uc_processed` (the intake-trigger loop guard argued for in UC-04's
 * flagAwaitingApprovalSpec.js) if it is ever added to all four. What is refused
 * is an asserted tag going MISSING.
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
        `unversioned, uncheckable, and is how this node came to describe a payroll decision in words the gates body ` +
        `already contradicted`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(ROUTING_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(ROUTING_NOTE_INTERPOLATION)} — ` +
        `the routing sentence is produced downstream of the gates, so it cannot be composed into internalNote and ` +
        `has to be appended here; without it the ticket never says which team owns it`
    );
  }

  if (
    typeof uf.internalNote === "string" &&
    want.updateFields.internalNote.includes(RECORD_ID_INTERPOLATION) &&
    !uf.internalNote.includes(RECORD_ID_INTERPOLATION)
  ) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(RECORD_ID_INTERPOLATION)} — ` +
        `this node carried the durable uc09_adjustments row id before the prose fix and must still carry it; ` +
        `losing the pointer to the record is a regression in the other direction`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc09/terminalZendeskNodesSpec.js's header for what that phrase claims and why it is ` +
          `false, unassessed, or a description of a language model this graph does not contain`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of spec.assertedTags) {
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
        `${JSON.stringify(want.updateFields.status)} — every UC-09 terminal state is queued work for a human on ` +
        `this side, and Zendesk's "pending" means "waiting on somebody who is not us"`
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
export function flagAwaitingDualApprovalIssues(node) {
  return terminalZendeskNodeIssues(node, DUAL_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function flagAwaitingTripleApprovalIssues(node) {
  return terminalZendeskNodeIssues(node, TRIPLE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateAdjustmentTicketIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedAdjustmentDecisionIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
