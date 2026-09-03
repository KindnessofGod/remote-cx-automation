// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// FIVE terminal Zendesk nodes on UC-03's live graph (WORKFLOW_UC03_ID):
// "Reply + Solve Ticket", "Flag For Formal Letter Review",
// "Escalate Travel Ticket", "Route To UC-04" and "Unrecognised Travel Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it. All
// five of UC-03's terminal Zendesk nodes are baselined as unguarded in
// `scripts/lib/unguarded-node-baseline.json` for exactly that reason, and so
// was the Code node that writes the CUSTOMER-FACING reply. So the prose UC-03
// puts on real tickets was versioned by nothing, typed once into a node
// parameter, and read back by no check.
//
// `test/n8nUc03Parity.test.js` cannot cover it either, by its own design: it
// compares DECISIONS. A node that reaches the right verdict and then describes
// it in false words passes it every time — which is what happened.
//
// Same shape, same fix, as `workflows/nodes-uc04/terminalZendeskNodesSpec.js`
// one use case over: compose the note in the gates body (a file
// `verify-deployed` diffs byte for byte) and have every Zendesk node
// interpolate it.
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG, AND HOW BADLY
// ---------------------------------------------------------------------------
//
// 1. "…reply to this ticket and a specialist will review and issue it."
//    ("Render Informational Answer" -> "Reply + Solve Ticket", PUBLIC)
//
//    THE HIGHEST-SEVERITY OF THE FIVE, because it is the only one a CUSTOMER
//    reads, and it is a FALSE INSTRUCTION: doing what it says produces nothing.
//    The graph claims `(UC-03, <ticket id>)` in `workflow_claims` before its
//    first durable write, so a reply that re-triggers it is a duplicate
//    delivery and stops silently at `Duplicate Delivery — Stop`.
//    `docs/use-cases/UC-03.md` already quotes this sentence and calls it
//    "advice to do the one thing that produces nothing" — it had been recorded
//    as a defect in the documentation for longer than the fix took, because
//    nothing read the node. That body now lives in
//    `workflows/nodes-uc03/renderInformationalAnswer.js`, which is the first
//    time it has been in this repository at all.
//
//    AND THE OBVIOUS REPLACEMENT IS ALSO WRONG. `src/uc03/letter.js`'s own
//    `renderInformationalAnswer()` now closes with the OPPOSITE promise — accept
//    the offer and the letter "is written and issued to you straight away" —
//    which is true on the Node/portal path and unbackable here: accepting is
//    `POST /api/cases/:id/request-letter`, which needs a `cases` row, and THIS
//    GRAPH WRITES NO `cases` ROW (three Supabase nodes, read live: `audit_log`,
//    `workflow_claims`, `audit_trace`). See that file's header for the full
//    argument and for why the two paths must differ on exactly one paragraph.
//
// 2. "Formal travel support letter DRAFTED text is available in the UC-03 app;
//    NOT auto-issued — specialist sign-off required."
//    ("Flag For Formal Letter Review")
//
//    FALSE ON 100% OF REACHABLE INPUTS, in three separate ways:
//
//    - NOTHING IS DRAFTED. This graph has no letter-render node. Measured, not
//      assumed: `verify-deployed`'s own node list for WORKFLOW_UC03_ID holds no
//      node that renders or persists a document.
//    - THE "UC-03 APP" HAS NEVER HELD IT. The ZAF panel and
//      `GET /uc03/api/cases/by-ticket/:ref` resolve a `cases` row; this graph
//      writes none, so that route answers `404 {"found": false}` for every
//      ticket this graph decides. The note pointed a specialist at a screen
//      that has never had anything on it for an n8n-decided run.
//    - "SPECIALIST SIGN-OFF REQUIRED" IS THE ONE THING THE PROJECT REFUSES
//      HERE for the branch that used to be this node's only reachable input:
//      `src/uc03/signoffPolicy.js`'s `describeUnconfirmed()` says of
//      `low_confidence` that "a formal letter built from an extraction the
//      router itself refused to trust is not something anybody can responsibly
//      sign". So the ticket asked for a signature the policy layer forbids.
//
//    WHICH REASONS ACTUALLY REACH IT — and the answer MOVED on 2026-08-31,
//    which is why it is recorded as data below (REACHABLE_HUMAN_REVIEW_REASONS)
//    rather than as a sentence. `Route by Decision` sends `human_review` here,
//    and `route()` can return `human_review` for three reasons:
//      * `confidence_unknown` — UNREACHABLE on this graph. `isValidClassification`
//        requires a numeric confidence, and the rule-based fallback always emits
//        one (0.9 / 0.6 / 0.3), so `typeof confidence !== 'number'` cannot hold.
//      * `low_confidence` — reachable (the 0.3 rung: nothing recognised).
//      * `formal_letter_requested` — REACHABLE, and now the COMMON case. It was
//        not, before `b5227da` put `full_name` / `job_title` / `contract_type` /
//        `start_date` on the gates body's normalized employment: until then
//        `assessLetterScope()` reported four `letter_missing_*` findings on
//        EVERY run and every letter request escalated `letter_scope_exceeded`
//        instead. Driven after that commit, a complete record asking for a
//        standard letter lands `human_review / formal_letter_requested` with
//        flags `[formal_letter_requested, letterhead_unavailable]`, because this
//        graph has no `Fetch Legal Entity (Remote)` node so
//        `readLetterheadAvailable()` returns false.
//
//    So the honest note is the one the run's own flags support: NO LETTER WAS
//    WRITTEN and none is waiting for a signature, because there was no
//    letterhead — which `composeInternalNote()` now says, resolving the ported
//    gate meaning's two-way ambiguity from `letterhead_unavailable` rather than
//    leaving the reader to guess.
//
//    THE NODE NAME AND THE `uc03_formal_letter_review` TAG ARE DELIBERATELY NOT
//    RENAMED, even though both now describe a review of something that does not
//    exist. `src/surfaceverify/registries/index.js` and others may key on them,
//    and a tag rename is a live-queue migration, not a prose fix. Flagged as a
//    follow-up rather than done here.
//
// 3. "AI summary — ESCALATED: {{reason}}. Flags: {{flags}}. No letter was
//    issued." ("Escalate Travel Ticket")
//
//    THE SENTENCE IS TRUE and is KEPT. "No letter was issued" holds for all ten
//    reachable `escalate` reasons. What was wrong here was the FLAGS it printed,
//    and that root cause is fixed upstream: before `b5227da` the note reported
//    `letter_missing_full_name`, `letter_missing_job_title`,
//    `letter_missing_contract_type` and `letter_missing_start_date` on every
//    run, for every employee, however complete the Remote record — four
//    fabricated findings about a customer's record, on a real ticket.
//    RE-DRIVEN on this pass against a complete record: no `letter_missing_*`
//    flag is emitted, and against a deliberately incomplete one they still are
//    (negative control). `test/n8nUc03TerminalZendeskNodes.test.js` pins both
//    directions.
//
// 4. "…UC-04 owns its own compliance case; this event is recorded for
//    inspection only, never dispatched automatically." ("Route To UC-04")
//
//    TRUE IN BOTH HALVES AND KEPT. What was missing is everything about what
//    happens NOW. The ticket carries no `uc04_*` tag, so UC-04's own intake
//    trigger (which conditions on `uc04_test`) cannot fire on it; no
//    `uc04_authorizations` row exists; and no `cases` row exists on either use
//    case, so BOTH sidebars answer 404. The composed note now names the actor
//    and the surface — the travelling employee, in Remote's own Request Hub —
//    in the words `src/uc03/workflow.js`'s review-queue note and
//    `src/uc03/signoffPolicy.js`'s `describeNoSignoffPath()` already use to the
//    other audience, and lists what UC-04 needs that a travel message never
//    states, from `UC04_INPUTS_UC03_CANNOT_SOURCE` rather than retyped.
//
// 5. "Automation produced an unrecognised decision (…). Routed to a human
//    rather than dropped." ("Unrecognised Travel Decision")
//
//    Not false — just unversioned, and it discards everything the gates body
//    knows. It trips no forbidden phrase, and the test says so rather than
//    pretending the defect is the same shape as the others.
//
// ---------------------------------------------------------------------------
// "AI" — JUDGED PER NODE, AND THE ANSWER IS "PER RUN" INSTEAD
// ---------------------------------------------------------------------------
//
// Three of the five notes opened "AI summary — ". UC-03 does have a real
// `Classify Inquiry (LLM)` node, so the word is defensible on this graph in a
// way it would not be on UC-05 — but it was still not a fact about any
// PARTICULAR run: the model's output is validated against a strict shape and
// ANY failure falls back verbatim to the deterministic rules, which is the
// ordinary case here (every hermetic scenario in `test/n8nUc03Parity.test.js`
// takes it). And on `Route To UC-04` the note's content is a handoff event
// assembled from fields already read — deterministic, not summarised by
// anything, so "AI summary" was wrong there in kind and not just in degree.
//
// `classification.source` already records which reader answered, per run. So
// `composeInternalNote()` states that instead: "AI-ASSISTED: a language model
// read the request text into a classification on this run (source: llm)" or
// "NO MODEL WAS USED on this run…". It is checkable, it is per-run, and it
// tells a reader how much to trust the reading — which the blanket word never
// did.
//
// ---------------------------------------------------------------------------
// KNOWN AND DELIBERATELY NOT FIXED HERE
// ---------------------------------------------------------------------------
//
// * `src/uc03/policyEngine.js` says "Global Mobility owns it" / "Global
//   Mobility weighs it" in four rendered strings while `Assign Routing` sends
//   UC-03's tickets to `Travel & Mobility Support`. Those strings reach the
//   PORTAL surfaces; THE GRAPH IS CLEAN OF THEM, and this change keeps it that
//   way — `composeInternalNote()` ports the gate meanings verbatim EXCEPT for
//   one declared substitution on exactly those two strings, because porting
//   them as-is would put one team, twice, in two names, six words apart on a
//   real ticket (the defect already recorded for UC-04 at
//   `docs/ESCALATION-DESTINATIONS.md` §2.2). Fixing the src-side wording is a
//   separate call — that document argues a straight rename would make the
//   sentences contradict themselves. `FORBIDDEN_PHRASES` below guards the node
//   blob against the string coming back.
// * `Reply + Solve Ticket` sets no `group`, so an auto-resolved UC-03 ticket
//   lands in the account's default `Support` group. That is §7's honest-gaps
//   items 7–8 in miniature and it is a PARAMETER change on a node this pass
//   otherwise leaves alone; named here as a follow-up rather than bundled in.
// * The node name `Flag For Formal Letter Review` and the tag
//   `uc03_formal_letter_review` both now describe a review of a document that
//   does not exist. Renaming either is a live-queue migration with readers
//   outside this file (`src/surfaceverify/registries/index.js`); follow-up.
//
// ---------------------------------------------------------------------------
// TWO CHECKS HOLD THIS FILE, against different authorities — same discipline as
// UC-04's:
//   1. test/n8nUc03TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against CAPTURED SNAPSHOTS of the five live
//      nodes (read from GET /api/v1/workflows/WORKFLOW_UC03_ID on 2026-08-31,
//      `versionId === activeVersionId === 63ceb10d-0ec3-4fa4-926a-e3eb1cb84b38`)
//      and against deliberately mutated copies, so each detector is proven able
//      to FAIL before it is trusted to pass.
//   2. `scripts/lib/deployedNodeMappings.mjs`'s STRUCTURAL_MAPPINGS, wired
//      SEPARATELY and NOT BY THIS PASS. Check 1 holds the constants against a
//      snapshot; check 2 holds the deployment against the constants. Neither
//      substitutes for the other: a snapshot cannot notice a hand edit made in
//      the n8n editor tomorrow, and a live check cannot run in `npm test` at all
//      (verify-deployed exits 2 without an N8N_API_KEY).
// ---------------------------------------------------------------------------

export const REPLY_NODE_NAME = "Reply + Solve Ticket";
export const LETTER_REVIEW_NODE_NAME = "Flag For Formal Letter Review";
export const ESCALATE_NODE_NAME = "Escalate Travel Ticket";
export const ROUTE_UC04_NODE_NAME = "Route To UC-04";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Travel Decision";

export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC03_WORKFLOW_ID = "WORKFLOW_UC03_ID";

/** The Code node whose body is the CUSTOMER-facing reply, and its new file. */
export const RENDER_NODE_NAME = "Render Informational Answer";
export const RENDER_NODE_TYPE = "n8n-nodes-base.code";
export const RENDER_NODE_FILE = "workflows/nodes-uc03/renderInformationalAnswer.js";

/** All five Zendesk nodes, in the order `Route by Decision` outputs them. */
export const TERMINAL_NODE_NAMES = Object.freeze([
  REPLY_NODE_NAME,
  LETTER_REVIEW_NODE_NAME,
  ESCALATE_NODE_NAME,
  ROUTE_UC04_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
]);

/** The four that carry an internal note. `Reply + Solve Ticket` posts a PUBLIC reply and no note. */
export const NOTE_NODE_NAMES = Object.freeze([
  LETTER_REVIEW_NODE_NAME,
  ESCALATE_NODE_NAME,
  ROUTE_UC04_NODE_NAME,
  UNRECOGNISED_NODE_NAME,
]);

/**
 * The composed note, read off `$json` — NOT off `$('Travel Router Gates')`.
 *
 * THIS IS THE ONE PLACE UC-03 DELIBERATELY DIVERGES FROM UC-04'S SPEC, and the
 * divergence is a fact about the two graphs rather than a style choice:
 *
 *   * On UC-04, `Assign Routing` sits directly downstream of a Supabase node and
 *     spreads that node's INSERT RESPONSE, so `$json` at its terminal nodes
 *     carries none of the gates' fields — every expression there has to address
 *     `$('Workation Gates')` by name.
 *   * On UC-03 there is a `Carry Context Forward` node between the Supabase
 *     write and `Assign Routing` (`return [{ json: $('Travel Router Gates')
 *     .first().json }]`), and `Assign Routing` spreads ITS input. So `$json` at
 *     UC-03's terminal nodes IS the gates' output plus the routing fields. That
 *     is not inferred: all five live nodes already read `$json.externalRef`,
 *     `$json.decision`, `$json.reason` and `$json.flags`, and the graph has run
 *     green (execution 404, real audit row).
 *
 * AND `$('Travel Router Gates').item` WOULD BE THE RISKIER FORM HERE, not the
 * safer one. `.item` resolves through item pairing, and `Carry Context Forward`
 * returns a bare `[{json}]` with NO explicit `pairedItem` — precisely what its
 * sibling `Carry Context After Claim` sets `pairedItem` for, with a comment
 * saying an unpaired Code node "breaks the chain" and that the failure "looks
 * like 'can't determine which item to use', nowhere near the node that actually
 * caused it".
 *
 * GETTING THIS WRONG IS SILENT EITHER WAY. An n8n expression that dereferences
 * a field nothing produces renders as an EMPTY STRING on a fully green
 * execution — the same shape as `verify-traces`'s dead-probe-name check.
 * `test/n8nUc03TerminalZendeskNodes.test.js` therefore does not assert the
 * expression "looks right": it runs the real `travelRouterGates.js`,
 * `carryContextForward` and `assignRouting.js` bodies in sequence and asserts
 * `internalNote` survives to what `$json` is at these nodes.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $json.internalNote }}";

/**
 * The routing sentence is APPENDED in the expression rather than composed into
 * `internalNote`, because it is produced DOWNSTREAM of the gates — `Assign
 * Routing` has not run when the gates run, so the group and tags it resolves do
 * not exist yet. Same split, same reason, as UC-04's spec.
 */
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/**
 * The exact `updateFields.internalNote` all four note-carrying nodes must carry.
 * Identical across the four ON PURPOSE: the per-decision difference is composed
 * inside `composeInternalNote()`, which `npm run verify-deployed` diffs byte for
 * byte, rather than typed four times into four node parameters where four copies
 * drift independently. That drift is not hypothetical — it is what produced the
 * four different sentences this file exists to retire.
 */
export const INTERNAL_NOTE_EXPRESSION = "=" + INTERNAL_NOTE_INTERPOLATION + "\n\n" + ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * The owning-team tag. PRESENT IN THE TARGETS and DELIBERATELY NOT ASSERTED BY
 * THE CHECKER BELOW.
 *
 * That dimension is owned across all fourteen affected nodes on all nine graphs
 * by `workflows/nodes/escalationQueueTagSpec.js` (rca-iih7 / D-14), which is
 * wired into `verify-deployed` separately. Two checkers asserting one field is
 * how a fix in one lands as a failure in the other — the orthogonality UC-04's
 * pair already documents. It appears here only so the paste-ready `parameters`
 * blocks below are COMPLETE, and a cross-spec test holds the two files equal for
 * the two nodes both describe.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/** The customer-facing reply, read off the Code node immediately upstream. */
export const PUBLIC_REPLY_EXPRESSION = "={{ $json.informationalAnswer }}";

/** The per-decision outcome tags, UNCHANGED. Machine markers for a STATE. */
export const AUTO_RESOLVED_TAG = "uc03_auto_resolved";
export const LETTER_REVIEW_TAG = "uc03_formal_letter_review";
export const ESCALATED_TAG = "uc03_escalated";
export const ROUTED_UC04_TAG = "uc03_routed_uc04";
export const EXCEPTION_TAG = "uc03_exception";

/**
 * Statuses, UNCHANGED, and worth a line because "fixing" them is a
 * plausible-looking wrong move.
 *
 * `Reply + Solve Ticket` is `solved` — the 🟢 zero-touch outcome.
 *
 * `Flag For Formal Letter Review` is `pending` — Zendesk's "waiting on somebody
 * who is not us". It is the RIGHT status for the reachable case even though the
 * old note described it wrongly: with no letterhead the request is waiting on an
 * employing-entity record being fixed, not on a Remote agent's signature.
 *
 * The other three are `open` — all three ARE queued work for a human here, which
 * is exactly the distinction `pending` would erase.
 */
export const REPLY_STATUS = "solved";
export const LETTER_REVIEW_STATUS = "pending";
export const ESCALATE_STATUS = "open";
export const ROUTE_UC04_STATUS = "open";
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
 * SCOPE, STATED: this guards the EXPRESSION a human types into a node. It does
 * not and cannot guard the rendered text — the composed note is guarded instead
 * by being in a file `verify-deployed` diffs, and the customer-facing reply by
 * `workflows/nodes-uc03/renderInformationalAnswer.js` being the same.
 *
 * Stems are listed alongside full sentences deliberately, so a shortened retype
 * does not slip through; both firing on one string is two messages for one
 * defect, which is the harmless direction.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  // 1 — the false instruction to the CUSTOMER.
  "reply to this ticket and a specialist",
  "a specialist will review and issue",
  // 2 — the three false claims on the letter-review node.
  "drafted text is available",
  "in the uc-03 app",
  "not auto-issued",
  "specialist sign-off required",
  // The src-side team name that names no Zendesk group on this account, kept
  // out of the graph. See "KNOWN AND DELIBERATELY NOT FIXED HERE" above.
  "global mobility",
]);

/**
 * Which reasons can actually reach `Flag For Formal Letter Review`, as DATA
 * rather than as a paragraph — because the answer MOVED on 2026-08-31 and a
 * sentence would have gone stale silently.
 *
 * `reachable` was established by DRIVING `workflows/nodes-uc03/
 * travelRouterGates.js` in a `node:vm` sandbox on that date, not by reading it.
 * Nothing here is read by a gate; it is evidence for a prose change, kept next
 * to the prose it justifies, and `test/n8nUc03TerminalZendeskNodes.test.js`
 * re-derives it by driving the body rather than trusting this table.
 */
export const REACHABLE_HUMAN_REVIEW_REASONS = Object.freeze([
  {
    reason: "confidence_unknown",
    reachable: false,
    why: "isValidClassification() requires `typeof confidence === 'number'`, and classifyTravelRuleBased() always emits one (0.9 / 0.6 / 0.3). No input can make `typeof confidence !== 'number'` hold at the gate",
  },
  {
    reason: "low_confidence",
    reachable: true,
    why: "the 0.3 rung — no destination, no date and no travel signal recognised in the text",
  },
  {
    reason: "formal_letter_requested",
    reachable: true,
    why: "the COMMON case since b5227da put full_name / job_title / contract_type / start_date on the normalized employment. A complete record asking for a standard letter now passes letter scope and stops at the letterhead, because this graph has no `Fetch Legal Entity (Remote)` node — flags [formal_letter_requested, letterhead_unavailable]. Before that commit every letter request escalated `letter_scope_exceeded` on four fabricated `letter_missing_*` findings, and `low_confidence` was this node's only reachable input",
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

/**
 * UNCHANGED IN EVERY FIELD. The defect on this branch is in the Code node
 * upstream (`Render Informational Answer`), not here — so this entry exists to
 * PIN the node rather than to change it, and the checker's forbidden-phrase
 * sweep now covers a node that previously had no check of any kind.
 */
export const REPLY_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    publicReply: PUBLIC_REPLY_EXPRESSION,
    status: REPLY_STATUS,
    tags: [AUTO_RESOLVED_TAG],
  },
});

export const LETTER_REVIEW_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: LETTER_REVIEW_STATUS,
    tags: [LETTER_REVIEW_TAG, ROUTING_TAG_EXPRESSION],
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
    // The queue tag is owned by workflows/nodes/escalationQueueTagSpec.js and is
    // present here only so this block is pasteable. The checker below does not
    // assert it.
    tags: [ESCALATED_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

export const ROUTE_UC04_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: ROUTE_UC04_STATUS,
    // NO QUEUE TAG, and it is not an oversight: `isEscalation('route_to_uc04')`
    // is false, so `routingTag` already IS the queue tag on this branch —
    // and for THIS branch alone the queue tag is UC-04's, because
    // `handoffUseCase` repoints `Assign Routing`'s lookup key. A second copy
    // would be redundant. This node is not one of the fourteen
    // escalationQueueTagSpec.js covers.
    tags: [ROUTED_UC04_TAG, ROUTING_TAG_EXPRESSION],
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
    // Queue tag present for the same reason as the escalate node: owned
    // elsewhere, pasteable here, not asserted by this file's checker.
    tags: [EXCEPTION_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * One row per node: everything the parameterised checker needs. Keyed by node
 * NAME because that is what n8n and STRUCTURAL_MAPPINGS both address nodes by.
 *
 * `checkedTags` is `parameters.updateFields.tags` MINUS `QUEUE_TAG_EXPRESSION`.
 * The subtraction is computed rather than written out, so the two lists cannot
 * disagree about anything except the one tag this file does not own.
 */
const withoutQueueTag = (tags) => Object.freeze(tags.filter((t) => t !== QUEUE_TAG_EXPRESSION));

export const TERMINAL_NODE_SPECS = Object.freeze({
  [REPLY_NODE_NAME]: Object.freeze({
    name: REPLY_NODE_NAME,
    parameters: REPLY_PARAMETERS,
    carriesNote: false,
    checkedTags: withoutQueueTag(REPLY_PARAMETERS.updateFields.tags),
  }),
  [LETTER_REVIEW_NODE_NAME]: Object.freeze({
    name: LETTER_REVIEW_NODE_NAME,
    parameters: LETTER_REVIEW_PARAMETERS,
    carriesNote: true,
    checkedTags: withoutQueueTag(LETTER_REVIEW_PARAMETERS.updateFields.tags),
  }),
  [ESCALATE_NODE_NAME]: Object.freeze({
    name: ESCALATE_NODE_NAME,
    parameters: ESCALATE_PARAMETERS,
    carriesNote: true,
    checkedTags: withoutQueueTag(ESCALATE_PARAMETERS.updateFields.tags),
  }),
  [ROUTE_UC04_NODE_NAME]: Object.freeze({
    name: ROUTE_UC04_NODE_NAME,
    parameters: ROUTE_UC04_PARAMETERS,
    carriesNote: true,
    checkedTags: withoutQueueTag(ROUTE_UC04_PARAMETERS.updateFields.tags),
  }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({
    name: UNRECOGNISED_NODE_NAME,
    parameters: UNRECOGNISED_PARAMETERS,
    carriesNote: true,
    checkedTags: withoutQueueTag(UNRECOGNISED_PARAMETERS.updateFields.tags),
  }),
});

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs) and for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning as
 * `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js and
 * UC-04's checker: a deploy tool that APPENDS to this expression is producing
 * strictly more than the spec asks for, and calling that a regression is how two
 * of this repo's own tools came to disagree and turn `verify-deployed` red on
 * three healthy nodes. The regression this actually guards is the interpolation
 * being GONE — replaced by a hand-typed sentence, which is precisely the state
 * all four note nodes were in until 2026-08-31 and which no check could see.
 *
 * TAGS ARE ALSO CONTAINMENT, and the queue tag is not among them (see
 * QUEUE_TAG_EXPRESSION above). An EXTRA tag is not refused; what is refused is a
 * tag going MISSING.
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

  if (spec.carriesNote) {
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
  } else {
    // `Reply + Solve Ticket`. An internal note appearing here would not be
    // wrong, but a PUBLIC REPLY disappearing would be the whole branch going
    // silent on a green run, so that is what is asserted.
    if (uf.publicReply !== PUBLIC_REPLY_EXPRESSION) {
      issues.push(
        `${spec.name}: updateFields.publicReply is ${JSON.stringify(uf.publicReply)}, expected ` +
          `${JSON.stringify(PUBLIC_REPLY_EXPRESSION)} — this is the ONLY text on this graph a customer reads, and an ` +
          `expression that resolves to nothing posts an empty reply on a fully green execution`
      );
    }
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc03/terminalZendeskNodesSpec.js's header for what that sentence claims and why it is ` +
          `false, unbackable or unsearchable`
      );
    }
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of spec.checkedTags) {
    if (!tags.includes(tag)) {
      issues.push(
        `${spec.name}: updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}` +
          (tag === ROUTING_TAG_EXPRESSION
            ? ` — without it an escalation is indistinguishable from a routine hand-off to the same team`
            : ` — the per-use-case branch marker the intake trigger's not_includes loop guard keys on`)
      );
    }
  }

  const wantGroup = want.updateFields.group;
  if (wantGroup !== undefined && uf.group !== wantGroup) {
    issues.push(
      `${spec.name}: updateFields.group is ${JSON.stringify(uf.group)}, expected ` +
        `${JSON.stringify(wantGroup)} — absent lands the ticket in the account's default Support group ` +
        `(§7's honest-gaps items 7–8)`
    );
  }

  if (uf.status !== want.updateFields.status) {
    issues.push(
      `${spec.name}: updateFields.status is ${JSON.stringify(uf.status)}, expected ` +
        `${JSON.stringify(want.updateFields.status)} — "pending" is Zendesk's "waiting on somebody who is not us", ` +
        `"open" is queued work for an agent here and "solved" is finished; the three are not interchangeable`
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
export function replyNodeIssues(node) {
  return terminalZendeskNodeIssues(node, REPLY_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function letterReviewNodeIssues(node) {
  return terminalZendeskNodeIssues(node, LETTER_REVIEW_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function routeUc04NodeIssues(node) {
  return terminalZendeskNodeIssues(node, ROUTE_UC04_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
