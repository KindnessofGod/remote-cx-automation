// ---------------------------------------------------------------------------
// escalationQueueTagSpec.js — the versioned target shape for the FOURTEEN
// terminal Zendesk nodes on UC-02…UC-09 that still carry rca-iih7 / D-14:
// eight `Escalate *` nodes and six `Unrecognised * Decision` nodes
// ---------------------------------------------------------------------------
// THE DEFECT, IN ONE SENTENCE
//
// On the escalation path the ticket's internal note asserts TWO Zendesk tags
// while the ticket receives ONE, and the missing one is the tag the owning
// team's own Zendesk view is built on.
//
// WHERE IT COMES FROM (workflows/nodes/assignRouting.js, deployed
// byte-identical to all nine graphs — `npm run verify-deployed`, 0 drifted)
//
//   const escalated  = isEscalation(decision);                   // /^escalat/i
//   const routeTags  = route ? (escalated ? [route.queueTag, route.escalationTag]
//                                         : [route.queueTag]) : [];
//   assignmentNote   = 'Assigned to ' + intendedGroup + ' (Zendesk group ' +
//                      groupId + '), tagged ' + routeTags.join(', ') + '.';
//   routingTag: route ? (escalated ? route.escalationTag : route.queueTag)
//                     : 'queue_unrouted'
//
// `routingNote` (the note) enumerates BOTH tags. `routingTag` (the value a
// terminal Zendesk node actually appends) is "the most specific tag" — when
// `escalated` is true that is the escalation marker ALONE. Every node below
// carries `updateFields.tags = ["<uc>_<marker>", routingTag]`, so the queue tag
// named in the note never lands on the ticket. Both halves are correct in
// isolation; the sentence they produce together is false.
//
// THE LIVE CONSEQUENCE — this is not cosmetic
//
// A Zendesk view built on `queue_<team>` (the tag the note names, and the tag
// `docs/APPROVAL-QUEUE.md` and the routing table both treat as "this team owns
// it") does not match the ticket at all. On UC-01, before the fix, nine real
// escalations carried `escalation_hr_ops` and never `queue_hr_ops`: the
// decision was correct, durable and audited, the note told the specialist which
// queue it was in, and HR Ops' own view was empty. That is §7's honest-gaps
// failure shape — a hand-off that exists everywhere except where the human
// looks — and exactly what §16 item 2 exists to catch: an artifact asserting a
// fact about itself that the destination does not back up.
//
// --- THE ASYMMETRY: TWO NODE TYPES, TWO DIFFERENT REASONS, TWO DIFFERENT
// --- STRENGTHS OF EVIDENCE. DO NOT FLATTEN THESE INTO ONE CLAIM.
//
// `Escalate *` (8 nodes) — wrong on EVERY escalation. The decision string
//   starts with "escalat", `isEscalation()` matches, `escalated` is always
//   true on this branch. EVIDENCE: nine observed live tickets on UC-01
//   (rca-iih7), each carrying `escalation_hr_ops` and never `queue_hr_ops`.
//   This is a measured defect with a known blast radius.
//
// `Unrecognised * Decision` (6 nodes) — wrong ONLY when the decision is
//   MISSING or unreadable, and NOT when it is a present-but-unknown string.
//   `isEscalation('weird_new_decision')` is FALSE, so on the input these nodes
//   were built for, `escalated` is false, `routeTags` is `[queueTag]`,
//   `routingTag` already resolves to the queue tag, and the note's single-tag
//   sentence is true of the ticket. But `isEscalation()` returns TRUE for a
//   missing, empty or non-string decision, and these six nodes sit on `Route by
//   Decision`'s FALLBACK output — which is precisely where a run with no
//   readable decision lands. On that input the defect reproduces identically.
//   EVIDENCE: no live instance has been observed. It is reachable-by-
//   construction, not measured.
//
//   Measured, so the two branches are written down rather than argued about:
//     isEscalation("escalate")           -> true
//     isEscalation("weird_new_decision") -> false
//     isEscalation(null | undefined | "" | 123) -> true
//
// HOW THE NARROW CASE WAS NEARLY DISMISSED, AND WHAT MADE THE DIFFERENCE
//
// The work order for this file said, in good faith, that the `Unrecognised *`
// nodes were already correct "because an unrecognised decision does not match
// /^escalat/i" — reasoning about what an unrecognised decision PROBABLY IS.
// That is true of the string case and says nothing about the null branch. What
// settled it was reading `isEscalation()` itself, whose own comment
// (assignRouting.js:87-96) explains the null branch on purpose: *"A missing or
// unrecognisable decision counts as an ESCALATION… an unknown decision is a
// missing signal, and a missing signal takes the stronger treatment."* That is
// CORRECT behaviour — demoting an unclassifiable UC-04 case to routine would
// offer it to a specialist as a one-click approval, which UC-04.md §8 forbids —
// and it is exactly what makes the fallback node's note wrong. The confirming
// evidence was already deployed: UC-01's rca-iih7 fix covers BOTH its
// `Escalate Ticket` AND its `Unrecognised Decision` (read live 2026-08-31,
// both carry the queue-tag expression), which no argument about decision
// strings would have predicted.
//
// The transferable part: the question was not "what is an unrecognised
// decision?" but "what does the function that branches on it do with the input
// this node actually receives?" — answered by reading the branch, not the name.
//
// WHY `MAPPINGS` CANNOT SEE ANY OF THIS
//
// These are `n8n-nodes-base.zendesk` "update ticket" nodes. They carry NO
// `jsCode`, so scripts/verify-deployed-nodes.mjs's MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to all
// fourteen, by construction. Same shape as rca-vqe (the `Route by Decision`
// switch), rca-uim (the `Persist Document` Supabase node), rca-ibh (the webhook
// trigger) and rca-zu3 (UC-01's own three close nodes). Until this file existed
// there was no repo artifact backing these fourteen nodes' parameters at all,
// so a hand edit reverting the fix would pass every check and
// `npm run verify-deployed` would keep reporting "0 drifted".
//
// WHY UC-01 IS NOT IN THIS TABLE
//
// rca-iih7 / D-14 was FOUND AND FIXED ON UC-01 ALONE, on 2026-08-22, live and
// by hand — on both of its affected nodes. Its target shape lives in
// workflows/nodes/escalationCloseNodesSpec.js (`NOTE_NODE_QUEUE_TAG_EXPRESSION`
// and the rca-iih7 paragraph in that file's header) and is already held by
// STRUCTURAL_MAPPINGS plus a hermetic parity test. The fix was never
// generalised to the other eight graphs. Two specs asserting the same node
// would be two places to update and one place to forget.
//
// WHY UC-07 AND UC-08 CONTRIBUTE ONE NODE EACH, NOT TWO
//
// Neither graph has an `Unrecognised *` node at all — read live 2026-08-31,
// their ONLY `n8n-nodes-base.zendesk` node is the escalation one. Both are 🔴
// use cases whose every decision is an escalation, so there is no second
// terminal branch to be unrecognised on. 8 + 6 = 14, and the six missing rows
// are an absence in the graphs, not an omission here.
//
// OVERLAPPING SPECS ON UC-03, UC-04, UC-05, UC-06 AND UC-09 — DELIBERATE
//
// UC-09's two rows were reconciled the same day and on the same terms
// (workflows/nodes-uc09/terminalZendeskNodesSpec.js). Its `Escalate Adjustment
// Ticket` is the sharpest instance of the revert-by-publish hazard in this
// table: the captured sentence told Payroll Ops the request "needs manual
// payroll handling", which is true of 1 of that graph's 8 reachable escalate
// reasons and FALSE of `identity_not_verified` — the only one that has actually
// fired in production (executions 9279 / ticket 135, 9942 / ticket 5), where
// the gate's own words are "Money never starts moving on a request whose origin
// is unverified." Publishing this file wholesale with the old string would put
// an invitation to pay by hand back onto a request nothing verified.
//
// UPDATED 2026-08-31: UC-05's and UC-06's three terminal Zendesk nodes each
// gained a prose spec of their own that day —
// workflows/nodes-uc05/terminalZendeskNodesSpec.js and
// workflows/nodes-uc06/terminalZendeskNodesSpec.js — on the same split of
// ownership described below for UC-04: those files own `internalNote`, this
// file owns the queue tag on all fourteen nodes. FOUR ROWS IN THIS TABLE HAVE
// THEREFORE HAD THEIR CAPTURED `internalNote` UPDATED to the composed-note
// expression (UC-05's Escalate + Unrecognised, UC-06's Escalate +
// Unrecognised). They are NOT live-captures any more and are marked as such at
// the row. The alternative — leaving the pre-change prose here — is the
// revert-by-publish hazard the UC-04 paragraph below describes, and it was
// observed rather than theorised: publishing this file wholesale would have
// put "this request needs manual payroll/HR handling" back onto Payroll Ops'
// tickets. `escalationQueueTagIssues()` reads `tags` only and is unaffected
// either way.
//
// UC-04's `Escalate Workation Ticket` and `Unrecognised Workation Decision` are
// ALSO covered by workflows/nodes-uc04/terminalZendeskNodesSpec.js. THE SPLIT
// OF OWNERSHIP IS: that spec owns the PROSE (`updateFields.internalNote`, which
// it rewrites to read the gates node's composed note); this spec owns the QUEUE
// TAG, on all fourteen nodes. `escalationQueueTagIssues()` therefore inspects
// `tags` ONLY and never `internalNote`, `group`, `status` or `id` — two
// checkers asserting one field is how a fix in one lands as a failure in the
// other.
//
// TWO THINGS A READER MUST KNOW BEFORE PASTING UC-04's TWO ROWS, both read
// live on 2026-08-31 rather than assumed:
//
//   1. That spec ALSO declares its own `QUEUE_TAG_EXPRESSION` (byte-identical
//      to this file's) for those same two nodes, so the queue-tag dimension is
//      asserted twice today. The overlap is known and is being reconciled by
//      the coordinator once both land; it is recorded here rather than quietly
//      deduplicated, because a silently-dropped assertion is worse than a
//      duplicated one.
//   2. THIS FILE'S CAPTURED `internalNote` FOR UC-04'S TWO NODES IS THE
//      PRE-CHANGE PROSE and does not match that spec's target. If the UC-04
//      prose change lands first, publishing this file's `targetParameters`
//      wholesale for those two nodes would REVERT it. For UC-04, take the
//      `tags` array and nothing else — the deploy doc says so at the point of
//      use. The checker is unaffected either way, because it does not read the
//      field.
// ---------------------------------------------------------------------------

/** @typedef {"escalate" | "unrecognised"} TerminalNodeKind */
/** @typedef {{useCase: string, kind: TerminalNodeKind, workflowId: string, workflow: string, workflowName: string, node: string, markerTag: string, targetParameters: object, targetUpdateFields: object}} QueueTagNode */

export const ZENDESK_NODE_TYPE = "n8n-nodes-base.zendesk";

/**
 * rca-iih7 / D-14's fix. `routing.queueTag` is the OWNING team's tag
 * regardless of escalation state — the tag the note's own
 * "tagged queue_x, escalation_x" sentence names first, and the tag a team's
 * Zendesk view is built on.
 *
 * Read off `$('Assign Routing')` BY NODE NAME rather than off `$json`: every
 * one of these fourteen nodes is reached through `Route by Decision`, so
 * `$json` at that point is whatever the gates/audit node last emitted and does
 * not carry the routing block. Read as `routing.queueTag` rather than as
 * `zendeskTags[0]` so that a future reordering of that array cannot silently
 * repoint this expression at the escalation marker — the exact value it exists
 * to be different from.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/**
 * The tag each node already applies: "the most specific tag wins"
 * (assignRouting.js). On the escalation path it is `escalation_<team>`; it is
 * NOT a substitute for the queue tag, it is the other half of the pair the note
 * claims. Checked here so that a fix which REPLACES it with the queue tag —
 * losing the escalation marker and with it the ability to tell an escalation
 * from a routine hand-off — fails as loudly as the absence it was fixing.
 *
 * Note this expression is CORRECT AND UNCHANGED on all fourteen nodes. On a
 * present-but-unknown decision reaching an `Unrecognised *` node it resolves to
 * the queue tag, which then appears twice in `tags`; Zendesk tags are a set, so
 * a duplicate is a no-op. That is the cost of covering the null branch, and it
 * is cheaper than the alternative (a node that is right on one input and silent
 * on the other).
 */
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * Deep-freezes an object literal so a consumer cannot mutate the target shape
 * it is being checked against. Hand-rolled rather than imported: this file is
 * read by scripts/ (ESM .mjs), by test/ and, in spirit, by whoever is holding
 * the deploy doc — a dependency here would be one more thing to keep working.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * The fourteen nodes, and the exact `parameters` each must carry after the fix.
 *
 * EVERY FIELD OTHER THAN `tags` WAS READ LIVE ON 2026-08-31 AND IS REPRODUCED
 * VERBATIM. That is deliberate and it is the reason this table is per-node
 * rather than a single shared shape: `id` differs between graphs (UC-02/UC-03
 * read `$json.externalRef`; UC-04/05/06/07/08/09 each read it off their OWN
 * gates node by name), and `internalNote` is a different sentence on every one
 * of the fourteen. A "target" that normalised those away would turn this file
 * into a source of drift instead of a guard against it.
 *
 * The ONLY edit applied to the live capture is the insertion of
 * QUEUE_TAG_EXPRESSION immediately before ROUTING_TAG_EXPRESSION in `tags`.
 * Nothing else changes.
 *
 * `markerTag` is the branch's own per-use-case tag and it differs by KIND:
 * `<uc>_escalated` on the eight escalation nodes, `<uc>_exception` on the six
 * unrecognised ones. Stored per entry rather than derived from `useCase`,
 * because deriving it would encode an assumption about the naming that only
 * happens to hold today.
 *
 * @type {ReadonlyArray<QueueTagNode>}
 */
const TERMINAL_NODE_ENTRIES = [
  {
    useCase: "UC-02",
    kind: "escalate",
    workflowId: "WORKFLOW_UC02_ID",
    workflow: "UC-02 — Expense & Receipt Validation",
    workflowName: "RCX UC-02 🟢 Expense & Receipt Validation",
    node: "Escalate Expense Ticket",
    markerTag: "uc02_escalated",
    // Read live 2026-08-31; graph versionId c63460d2-0048-4624-8c7e-11bddd66e53e (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI summary — ESCALATED: {{ $json.reason }}. Flags: {{ $json.flags.join(\", \") || \"none\" }}. No auto-approval issued. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc02_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-02",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC02_ID",
    workflow: "UC-02 — Expense & Receipt Validation",
    workflowName: "RCX UC-02 🟢 Expense & Receipt Validation",
    node: "Unrecognised Expense Decision",
    markerTag: "uc02_exception",
    // Read live 2026-08-31; graph versionId c63460d2-0048-4624-8c7e-11bddd66e53e (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=Automation produced an unrecognised decision ({{ $json.decision }}). Routed to a human rather than dropped. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc02_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-03",
    kind: "escalate",
    workflowId: "WORKFLOW_UC03_ID",
    workflow: "UC-03 — Travel Letter / Workation Router",
    workflowName: "RCX UC-03 🟢 Travel Letter / Workation Router",
    node: "Escalate Travel Ticket",
    markerTag: "uc03_escalated",
    // Read live 2026-08-31; graph versionId 2be9074f-879b-43f7-a03f-45cc4a92146e (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        // SUPERSEDED 2026-08-31 by workflows/nodes-uc03/terminalZendeskNodesSpec.js,
        // in the same shape and for the same reason as UC-04's two rows above:
        // UC-03's terminal prose moved into composeInternalNote() in
        // workflows/nodes-uc03/travelRouterGates.js, a file verify-deployed
        // diffs byte for byte. The retired sentence here was TRUE ("No letter
        // was issued") — what was wrong on this node was the FLAGS it printed
        // (four fabricated `letter_missing_*` findings on every run, fixed
        // upstream by b5227da). It is superseded anyway, because a hand-typed
        // note is unversioned whether or not today's wording happens to be
        // right. Held equal to that spec by a cross-spec test in
        // test/n8nUc03TerminalZendeskNodes.test.js, so publishing from either
        // file cannot revert the other.
        //
        // NOTE THE `$json` FORM, which differs from UC-04's `$('Workation
        // Gates')`. That is a fact about the two graphs, not a typo: UC-03 has a
        // `Carry Context Forward` node between the Supabase write and `Assign
        // Routing`, so `$json` here IS the gates' output. See that spec's
        // INTERNAL_NOTE_INTERPOLATION for the full argument, including why
        // `.item` would be the riskier form on this graph.
        "internalNote": "={{ $json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc03_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-03",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC03_ID",
    workflow: "UC-03 — Travel Letter / Workation Router",
    workflowName: "RCX UC-03 🟢 Travel Letter / Workation Router",
    node: "Unrecognised Travel Decision",
    markerTag: "uc03_exception",
    // Read live 2026-08-31; graph versionId 2be9074f-879b-43f7-a03f-45cc4a92146e (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        // SUPERSEDED 2026-08-31 — see the note on `Escalate Travel Ticket`
        // above. This node's retired sentence was not FALSE, just unversioned,
        // and it discarded everything the gates body knows about the run.
        "internalNote": "={{ $json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc03_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-04",
    kind: "escalate",
    workflowId: "WORKFLOW_UC04_ID",
    workflow: "UC-04 — Work Authorization / Workation",
    workflowName: "RCX UC-04 🟡 Work Authorization / Workation",
    node: "Escalate Workation Ticket",
    markerTag: "uc04_escalated",
    // Read live 2026-08-31; graph versionId 2db372e4-e35a-4ac4-b547-7a25e27aa067 (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Workation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Workation Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc04_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-04",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC04_ID",
    workflow: "UC-04 — Work Authorization / Workation",
    workflowName: "RCX UC-04 🟡 Work Authorization / Workation",
    node: "Unrecognised Workation Decision",
    markerTag: "uc04_exception",
    // Read live 2026-08-31; graph versionId 2db372e4-e35a-4ac4-b547-7a25e27aa067 (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Workation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Workation Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc04_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-05",
    kind: "escalate",
    workflowId: "WORKFLOW_UC05_ID",
    workflow: "UC-05 — Resignation Notice Calculation",
    workflowName: "RCX UC-05 🟡 Resignation Notice Calculation",
    node: "Escalate Resignation Ticket",
    markerTag: "uc05_escalated",
    // Read live 2026-08-31; graph versionId 5e611ae5-e9f6-4174-ac00-9bafb1a713eb (active: true).
    // `internalNote` UPDATED 2026-08-31 to the composed-note expression owned by
    // workflows/nodes-uc05/terminalZendeskNodesSpec.js — it is no longer the live
    // capture. Held equal to that spec by a cross-spec test in
    // test/n8nUc05TerminalZendeskNodes.test.js.
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Notice Period Gates').item.json.internalNote }}\n\nResignation record: {{ $('Create Resignation Record').item.json.id }}\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc05_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-05",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC05_ID",
    workflow: "UC-05 — Resignation Notice Calculation",
    workflowName: "RCX UC-05 🟡 Resignation Notice Calculation",
    node: "Unrecognised Resignation Decision",
    markerTag: "uc05_exception",
    // Read live 2026-08-31; graph versionId 5e611ae5-e9f6-4174-ac00-9bafb1a713eb (active: true).
    // `internalNote` UPDATED 2026-08-31 to the composed-note expression owned by
    // workflows/nodes-uc05/terminalZendeskNodesSpec.js — it is no longer the live
    // capture. Held equal to that spec by a cross-spec test in
    // test/n8nUc05TerminalZendeskNodes.test.js.
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Notice Period Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Notice Period Gates').item.json.internalNote }}\n\nResignation record: {{ $('Create Resignation Record').item.json.id }}\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc05_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-06",
    kind: "escalate",
    workflowId: "WORKFLOW_UC06_ID",
    workflow: "UC-06 — Contract Amendment / Payroll Cutoff",
    workflowName: "RCX UC-06 🟡 Contract Amendment / Payroll Cutoff",
    node: "Escalate Amendment Ticket",
    markerTag: "uc06_escalated",
    // Read live 2026-08-31; graph versionId d9b937f1-3147-4b06-9241-c1e19ec98421 (active: true).
    // `internalNote` UPDATED 2026-08-31 to the composed-note expression owned by
    // workflows/nodes-uc06/terminalZendeskNodesSpec.js — it is no longer the live
    // capture. Held equal to that spec by a cross-spec test in
    // test/n8nUc06TerminalZendeskNodes.test.js.
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Amendment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Amendment Gates').item.json.internalNote }}\n\nAmendment record: {{ $('Create Amendment Record').item.json.id }}\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc06_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-06",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC06_ID",
    workflow: "UC-06 — Contract Amendment / Payroll Cutoff",
    workflowName: "RCX UC-06 🟡 Contract Amendment / Payroll Cutoff",
    node: "Unrecognised Amendment Decision",
    markerTag: "uc06_exception",
    // Read live 2026-08-31; graph versionId d9b937f1-3147-4b06-9241-c1e19ec98421 (active: true).
    // `internalNote` UPDATED 2026-08-31 to the composed-note expression owned by
    // workflows/nodes-uc06/terminalZendeskNodesSpec.js — it is no longer the live
    // capture. Held equal to that spec by a cross-spec test in
    // test/n8nUc06TerminalZendeskNodes.test.js.
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Amendment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "={{ $('Amendment Gates').item.json.internalNote }}\n\nAmendment record: {{ $('Create Amendment Record').item.json.id }}\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc06_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-07",
    kind: "escalate",
    workflowId: "WORKFLOW_UC07_ID",
    workflow: "UC-07 — Global Mobility / Permanent Relocation",
    workflowName: "RCX UC-07 🔴 Global Mobility / Permanent Relocation",
    node: "Escalate Relocation Ticket",
    markerTag: "uc07_escalated",
    // Read live 2026-08-31; graph versionId 8bfc1ff3-5bbb-4d03-8ab4-153863b54a34 (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Relocation Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Relocation Gates').item.json.dossier.narrative }} RESEARCH SUPPORT ONLY, not a decision to proceed. For review by a qualified Remote Mobility Legal specialist. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc07_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-08",
    kind: "escalate",
    workflowId: "WORKFLOW_UC08_ID",
    workflow: "UC-08 — Cross-Border Tax & Social Security",
    workflowName: "RCX UC-08 🔴 Cross-Border Tax & Social Security",
    node: "Escalate Tax Inquiry Ticket",
    markerTag: "uc08_escalated",
    // Read live 2026-08-31; graph versionId baeb0144-d8de-4a50-a942-6a8163b5b6bf (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Build Dossier').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        "internalNote": "=AI research dossier {{ $('Create Dossier Record').item.json.id }} — {{ $('Build Dossier').item.json.narrative }} RESEARCH SUPPORT ONLY, not a determination. For review by a qualified Remote Tax Operations specialist. {{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc08_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-09",
    kind: "escalate",
    workflowId: "WORKFLOW_UC09_ID",
    workflow: "UC-09 — Off-Cycle Payroll Adjustment",
    workflowName: "RCX UC-09 🔴 Off-Cycle Payroll Adjustment",
    node: "Escalate Adjustment Ticket",
    markerTag: "uc09_escalated",
    // Read live 2026-08-31; graph versionId c24a7713-7d8c-4679-bb38-d08a70f85c2b (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        // RECONCILED 2026-08-31 with workflows/nodes-uc09/terminalZendeskNodesSpec.js,
        // which owns UC-09's terminal-node PROSE. The captured value here was
        // "=AI summary -- ESCALATED: … this request needs manual payroll handling,
        // no approval path was offered. …" — accurate for 1 of the 8 reachable
        // escalate reasons and FALSE for `identity_not_verified`, the one that has
        // actually fired in production (executions 9279 and 9942). Publishing this
        // row wholesale with the old string would revert that fix; the cross-spec
        // test in test/n8nUc09TerminalZendeskNodes.test.js holds the two equal so a
        // divergence names itself instead of propagating.
        "internalNote": "={{ $('Adjustment Gates').item.json.internalNote }}\n\nAdjustment record: {{ $('Create Adjustment Record').item.json.id }}\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc09_escalated",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },
  {
    useCase: "UC-09",
    kind: "unrecognised",
    workflowId: "WORKFLOW_UC09_ID",
    workflow: "UC-09 — Off-Cycle Payroll Adjustment",
    workflowName: "RCX UC-09 🔴 Off-Cycle Payroll Adjustment",
    node: "Unrecognised Adjustment Decision",
    markerTag: "uc09_exception",
    // Read live 2026-08-31; graph versionId c24a7713-7d8c-4679-bb38-d08a70f85c2b (active: true).
    targetParameters: deepFreeze({
      "authentication": "oAuth2",
      "operation": "update",
      "id": "={{ $('Adjustment Gates').item.json.externalRef }}",
      "updateFields": {
        "group": "={{ $('Assign Routing').item.json.zendeskGroupId }}",
        // RECONCILED 2026-08-31 — see the note on this graph's escalate row above.
        // The captured sentence was not false, only unversioned and inert; the
        // composed note says the same thing plus what was and was not decided.
        "internalNote": "={{ $('Adjustment Gates').item.json.internalNote }}\n\n{{ $('Assign Routing').item.json.routingNote }}",
        "status": "open",
        "tags": [
          "uc09_exception",
          "={{ $('Assign Routing').item.json.routing.queueTag }}",
          "={{ $('Assign Routing').item.json.routingTag }}"
        ]
      }
    }),
  },];

/**
 * The exported table. The name says "escalation" because that is the PATH all
 * fourteen sit on when the defect occurs — `isEscalation()` is true for every
 * input that reaches them wrongly — not because every node is named
 * `Escalate *`. Six of them are not.
 *
 * `targetUpdateFields` is the SAME frozen object as
 * `targetParameters.updateFields`, not a copy — one shape, two names, so a
 * reader who only cares about the tag array cannot end up comparing against a
 * stale duplicate of it.
 *
 * @type {ReadonlyArray<QueueTagNode>}
 */
export const ESCALATION_QUEUE_TAG_NODES = Object.freeze(
  TERMINAL_NODE_ENTRIES.map((entry) =>
    Object.freeze(Object.assign({}, entry, { targetUpdateFields: entry.targetParameters.updateFields }))
  )
);

/** The eight `Escalate *` rows — wrong on every escalation, nine observed live tickets. */
export const ESCALATE_NODES = Object.freeze(ESCALATION_QUEUE_TAG_NODES.filter((e) => e.kind === "escalate"));

/** The six `Unrecognised *` rows — wrong only on a missing/unreadable decision, none observed. */
export const UNRECOGNISED_NODES = Object.freeze(ESCALATION_QUEUE_TAG_NODES.filter((e) => e.kind === "unrecognised"));

/** Node name -> spec entry. Names are unique across the eight graphs. */
const BY_NODE_NAME = new Map(ESCALATION_QUEUE_TAG_NODES.map((e) => [e.node, e]));

/**
 * @param {string} nodeName
 * @returns {QueueTagNode | null}
 */
export function specForNode(nodeName) {
  return BY_NODE_NAME.get(nodeName) ?? null;
}

// --- ORDERING: CHECKED ON THE TARGETS, NOT ON THE LIVE NODE -----------------
//
// The targets above all place QUEUE_TAG_EXPRESSION immediately BEFORE
// ROUTING_TAG_EXPRESSION, matching UC-01's already-fixed `Escalate Ticket` and
// `Unrecognised Decision` exactly, and matching the order the note itself
// enumerates them in (`routeTags.join(', ')` is `queueTag, escalationTag`).
// That rule is pinned by test/n8nEscalationQueueTag.test.js against these
// frozen constants.
//
// `escalationQueueTagIssues()` deliberately does NOT check it, and this is a
// judgement rather than an oversight. A Zendesk tag list is a SET: order
// carries no behaviour, so a node with both tags in the other order is
// functionally identical and its note is equally true. Making order an issue
// would mean `npm run verify-deployed` going red on a node that is correct —
// and this repo has already paid for exactly that shape once, when
// `webhookResponseParamIssues()` compared strictly against a value n8n prunes
// and reported nine healthy graphs as DRIFTED with a message naming a closed
// finding as reopened (see webhookResponseSpec.js's RESPONSE_MODE_NODE_DEFAULT).
// A deploy check that can cry wolf about cosmetics is a deploy check people
// start overriding, which costs the real findings it also carries.
//
// So: order is a property of the TARGET (asserted hermetically, where being
// wrong costs nothing but a test), not of the LIVE NODE (where being wrong
// would block a deploy over readability).

/**
 * rca-iih7 / D-14 for the fourteen terminal Zendesk nodes. Three hard checks,
 * each for a failure with a different live symptom:
 *
 *   1. QUEUE_TAG_EXPRESSION absent — THE defect. The note claims the queue tag
 *      and the ticket does not carry it, so the owning team's Zendesk view is
 *      empty while the hand-off looks complete everywhere else.
 *   2. ROUTING_TAG_EXPRESSION absent — the over-correction. Replacing the
 *      routing tag with the queue tag makes the note true again and destroys
 *      the distinction between an escalation and a routine hand-off, which
 *      `routing.escalated` and the tag split exist to keep.
 *   3. `markerTag` absent — the per-use-case branch marker (`<uc>_escalated` or
 *      `<uc>_exception`) that the intake trigger's `not_includes` loop guard
 *      and every UC-scoped view key on. Its loss re-opens a ticket to its own
 *      intake trigger.
 *
 * IT DOES NOT INSPECT `internalNote`, `group`, `status` or `id`. That is the
 * orthogonality this file's header describes: UC-04's terminal-node prose is
 * owned by workflows/nodes-uc04/terminalZendeskNodesSpec.js, and two checkers
 * asserting one field is how a fix in one lands as a failure in the other.
 *
 * A node whose NAME is not one of the fourteen is itself an issue: this checker
 * is wired per-node in STRUCTURAL_MAPPINGS, so an unrecognised name means the
 * mapping and this table have drifted apart, and silently returning "no issues"
 * there would be a check that cannot fail.
 *
 * @param {object} node the live terminal Zendesk node (`GET /api/v1/workflows/:id`'s shape)
 * @returns {string[]} issue descriptions; empty means the node carries the fix
 */
export function escalationQueueTagIssues(node) {
  const issues = [];
  const name = node?.name;
  const spec = typeof name === "string" ? specForNode(name) : null;

  if (!spec) {
    return [
      `node ${JSON.stringify(name)} is not one of the ${ESCALATION_QUEUE_TAG_NODES.length} ` +
        `terminal Zendesk nodes this spec covers — the caller and ` +
        `workflows/nodes/escalationQueueTagSpec.js have drifted apart`,
    ];
  }

  if (node?.type !== ZENDESK_NODE_TYPE) {
    issues.push(`node type is ${JSON.stringify(node?.type)}, expected ${JSON.stringify(ZENDESK_NODE_TYPE)}`);
  }

  const tags = Array.isArray(node?.parameters?.updateFields?.tags) ? node.parameters.updateFields.tags : [];
  const shown = JSON.stringify(node?.parameters?.updateFields?.tags);

  if (!tags.includes(QUEUE_TAG_EXPRESSION)) {
    issues.push(
      `${spec.node}: updateFields.tags is ${shown}, expected to include ${JSON.stringify(QUEUE_TAG_EXPRESSION)} — ` +
        `D-14's regression is this tag ABSENT, so the note's own "tagged queue_x, escalation_x" claim is ` +
        `false on the ticket and the owning team's Zendesk view does not find its own escalation`
    );
  }
  if (!tags.includes(ROUTING_TAG_EXPRESSION)) {
    issues.push(
      `${spec.node}: updateFields.tags is ${shown}, expected to include ${JSON.stringify(ROUTING_TAG_EXPRESSION)} — ` +
        `without it an escalation is indistinguishable from a routine hand-off to the same team`
    );
  }
  if (!tags.includes(spec.markerTag)) {
    issues.push(
      `${spec.node}: updateFields.tags is ${shown}, expected to include ${JSON.stringify(spec.markerTag)} — ` +
        `the per-use-case branch marker the intake trigger's not_includes loop guard keys on`
    );
  }

  return issues;
}
