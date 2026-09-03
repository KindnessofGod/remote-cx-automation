// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// three terminal Zendesk nodes on UC-05's live graph (WORKFLOW_UC05_ID):
// "Flag Awaiting HR Ops Sign-off", "Escalate Resignation Ticket" and
// "Unrecognised Resignation Decision"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is STRUCTURALLY BLIND to it. All
// three of these nodes therefore had their prose typed once into a node
// parameter, written onto real customers' tickets, read back by no check and
// versioned by nothing. `test/n8nUc05Parity.test.js` cannot see it either, by
// its own design: parity compares DECISIONS, and a node that reaches the right
// verdict and describes it in false words passes every time.
//
// The correct note now exists where it can be checked: `composeInternalNote()`
// in `workflows/nodes-uc05/noticePeriodGates.js`, a file `npm run
// verify-deployed` diffs byte for byte. These nodes' job shrinks to
// interpolating one field. Same split, same reasoning, as UC-01
// (workflows/nodes/composeInternalNote.js) and UC-04
// (workflows/nodes-uc04/terminalZendeskNodesSpec.js).
//
// ---------------------------------------------------------------------------
// WHAT EACH OLD SENTENCE GOT WRONG, AND HOW BADLY
// ---------------------------------------------------------------------------
//
// 1. "No Remote write exists for resignations — the signed-off report IS the
//    durable artifact."  ("Flag Awaiting HR Ops Sign-off")
//
//    THE HIGHEST-SEVERITY ITEM HERE: it is a claim about REMOTE'S PLATFORM
//    that this project's own spec RETRACTED ten days before this file was
//    written, still being told to a specialist on live tickets.
//
//    `PUT /v1/resignations/{offboarding_request_id}/validate` EXISTS, scope
//    `resignation:write` — Remote's own `llms.txt`
//    (`docs/REMOTE-API-INDEX.txt:330`) and developer.remote.com, read
//    2026-08-21 — and its request body is shaped almost exactly like this use
//    case's sign-off form. `docs/use-cases/UC-05.md` §1 has carried the
//    correction banner since that date: *"The stated reason is false and the
//    rule still stands … It is a policy choice."*
//
//    This is CLAUDE.md §3's substitution ladder failing at RUNG 1 — the rung
//    that is never overridden by a lower one. Three times this project recorded
//    a Sandbox or spec-pack limitation as a fact about Remote's platform, and
//    TWO OF THE THREE turned out to exist (`docs/00-FOUNDATION.md` §2a). A
//    Sandbox that refuses is rung 2 failing, not rung 1 answering.
//
//    THE BEHAVIOUR IS RIGHT AND DOES NOT CHANGE: this system writes nothing.
//    What changes is the stated reason — from a false claim about Remote's API
//    to a true claim about our own capability and choice (no `resignation:write`
//    scope, no `offboarding_request_id`, no decision to adopt it; adopting it
//    would convert a report into an execution). Same operational outcome, and a
//    specialist can no longer repeat the false half to a customer.
//
//    DELETING THE SENTENCE WAS THE OTHER OPTION AND IT WAS WORSE: it is the
//    only line that answers the question the sign-off screen raises — why is a
//    signature the end of the road here? A gap invites the reader to assume.
//
// 2. "AI prepared discrepancy report …" / "AI summary — ESCALATED".
//
//    NEITHER IS AI, AND THE GRAPH PROVES IT. Read live 2026-08-31:
//    `WORKFLOW_UC05_ID` has 16 nodes and exactly ONE http call, to Remote.
//    There is no LLM node anywhere on it. The figures come from a statutory
//    notice table and arithmetic; the letter reading is `ruleBasedExtraction()`
//    — regex date matching that tags itself `source: 'rule_based_fallback'`.
//
//    This inverts prime directive 1 (*LLMs interpret; deterministic code
//    decides*) in the direction that costs the most: it invites an HR Ops
//    specialist to distrust a statutory notice table because they were told a
//    model wrote it. The composed note names the reader that produced the
//    extraction instead.
//
// 3. "discrepancy report", on the node reached ONLY when there is no
//    discrepancy.  ("Flag Awaiting HR Ops Sign-off")
//
//    That node sits on `prepared_for_signoff`, which is the `else` of
//    `if (notice.discrepancy === 'earlier_than_statutory')`
//    (noticePeriodGates.js's policy block). The word appeared exactly where a
//    discrepancy is guaranteed ABSENT, and was missing from the escalate note
//    where one is guaranteed PRESENT. It is a notice-period report.
//
// 4. "No report was prepared for sign-off."  ("Escalate Resignation Ticket")
//
//    True of seven of the ten escalate reasons and MISLEADING for three.
//    `REPORT_ABSENCE_ACCURACY` below is that count as data, one row per
//    reason, so this header's claim is checkable rather than assertable. On
//    `statutory_discrepancy` and `pto_balance_unusable` the notice period is
//    fully computed before the branch, and `Create Resignation Record` writes
//    the `notice` and `payout` columns on EVERY decision (read live off that
//    node, 2026-08-31). The arithmetic is durable and in the row; what is
//    absent is the sign-off PATH. Those are precisely the two escalations
//    where the specialist most needs to know the numbers are already there.
//
// 5. `status: "pending"` on "Flag Awaiting HR Ops Sign-off". SEE BELOW —
//    the one non-prose change in this file, argued at SIGNOFF_STATUS.
//
// ---------------------------------------------------------------------------
// WHAT THIS CHANGE DOES *NOT* FIX — say it here, not in a report nobody reads
// ---------------------------------------------------------------------------
//
// Nothing in `src/uc05/` is touched. `src/uc05/workflow.js`'s own Zendesk note
// text is a separate call site with its own wording and is outside this pass;
// if it carries the same retracted claim it needs its own change. The
// FORBIDDEN_PHRASES list below guards the NODE BLOB — the expression a human
// types — which is what this file owns. It cannot guard the RENDERED text, and
// it does not try to.
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
//     the other — the exact collision recorded in escalationQueueTagSpec.js's
//     own header;
//   * a cross-spec test in test/n8nUc05TerminalZendeskNodes.test.js holds the
//     two `updateFields` blocks equal by ASSERTION rather than by import. An
//     import would remove the duplication and also the failure message: a
//     dropped field would propagate silently and consistently. This way a
//     divergence names itself and says which field.
//
// `Flag Awaiting HR Ops Sign-off` correctly has NO queue tag: it is not an
// escalation, `isEscalation('prepared_for_signoff')` is false, and `routingTag`
// therefore already IS the queue tag.
//
// ---------------------------------------------------------------------------
// TWO CHECKS HOLD THIS FILE, against different authorities:
//   1. test/n8nUc05TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//      Holds the constants below against CAPTURED SNAPSHOTS of the three live
//      nodes (read from the n8n API on 2026-08-31, `versionId ===
//      activeVersionId === 9363495e-df77-4110-a844-040fd978e35c`) and against
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

export const SIGNOFF_NODE_NAME = "Flag Awaiting HR Ops Sign-off";
export const ESCALATE_NODE_NAME = "Escalate Resignation Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Resignation Decision";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC05_WORKFLOW_ID = "WORKFLOW_UC05_ID";
export const GATES_NODE_NAME = "Notice Period Gates";
export const RECORD_NODE_NAME = "Create Resignation Record";

/** All three, in the order `Route by Decision` fans out to them. */
export const TERMINAL_NODE_NAMES = Object.freeze([SIGNOFF_NODE_NAME, ESCALATE_NODE_NAME, UNRECOGNISED_NODE_NAME]);

/**
 * The composed note, read off `Notice Period Gates` BY NODE NAME rather than
 * off `$json`.
 *
 * `$json` at these three nodes is whatever `Assign Routing` last emitted, and
 * `Assign Routing` spreads the Supabase insert response it received upstream
 * (`const ctx = $json …` in workflows/nodes/assignRouting.js) — it does not
 * carry the gates' fields at all. Every other expression on all three nodes
 * already addresses `$('Notice Period Gates')` for the same reason.
 *
 * GETTING THIS WRONG IS SILENT. An n8n expression that dereferences a field
 * nothing produces renders as an EMPTY STRING on a fully green execution — the
 * same shape as `verify-traces`'s dead-probe-name check, and as the 401 that
 * reported success because the header was present but empty. The ticket would
 * get an internal note consisting of the routing sentence and nothing else, and
 * every layer would report success.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Notice Period Gates').item.json.internalNote }}";

/**
 * The row id, APPENDED in the expression rather than composed into
 * `internalNote`, because it does not exist when the gates run — `Create
 * Resignation Record` is three nodes downstream. Same split, same reason, as
 * the routing sentence below and as UC-04's `flagAwaitingApproval.parameters.json`.
 *
 * It is on ALL THREE nodes, including the unrecognised one, because the record
 * is written on every branch: the graph is
 * `Gates → Claim → Carry Context After Claim → Create Resignation Record →
 * Append Audit Log → Assign Routing → Route by Decision` (read live
 * 2026-08-31), so every terminal node is downstream of the insert. The
 * unrecognised branch is where a human most needs the row id, and it is the one
 * branch that never had it.
 */
export const RECORD_ID_INTERPOLATION = "{{ $('Create Resignation Record').item.json.id }}";

/**
 * The routing sentence, appended for the same reason: it is produced DOWNSTREAM
 * of the gates. `Assign Routing` has not run when the gates run, so the group
 * and tags it resolves do not exist yet.
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
export const INTERNAL_NOTE_EXPRESSION =
  "=" + INTERNAL_NOTE_INTERPOLATION + "\n\nResignation record: " + RECORD_ID_INTERPOLATION + "\n" + ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live nodes. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $('Notice Period Gates').item.json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14, owned by workflows/nodes/escalationQueueTagSpec.js and
 * repeated here so this file's `targetParameters` can be pasted without
 * reverting that fix. NOT asserted by the checker below — see the tag-ownership
 * block in this file's header.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/** The per-decision outcome tags, UNCHANGED. Machine markers for a STATE. */
export const SIGNOFF_TAG = "uc05_prepared_for_signoff";
export const ESCALATED_TAG = "uc05_escalated";
export const EXCEPTION_TAG = "uc05_exception";

/**
 * THE ONE NON-PROSE CHANGE IN THIS FILE, AND THE ARGUMENT FOR IT.
 *
 * `Flag Awaiting HR Ops Sign-off` set `status: "pending"`. In Zendesk, PENDING
 * means *waiting on the requester*. The requester here is the RESIGNING
 * EMPLOYEE, who has nothing left to do — the ball is entirely with HR Ops, a
 * Remote-side group, who have to read a prepared report and sign it.
 *
 * UC-05 WAS THE OUTLIER, NOT THE OTHERS. UC-06's `Flag Awaiting Dual Approval`
 * and UC-09's equivalent both already use `open` for the same situation (read
 * live 2026-08-31). UC-04's `Flag Awaiting Specialist Approval` correctly uses
 * `pending`, and the difference is the whole point: a UC-04 work authorization
 * really is waiting on somebody outside Remote — the customer's own manager, in
 * Remote's product — while a UC-05 report is waiting on a Remote agent.
 *
 * WHAT LEAVING IT WOULD COST, concretely and not in principle: requester-wait
 * SLA clocks stop while the work sits with us, so the queue's own ageing
 * understates it; and any "auto-solve pending tickets after N days" automation
 * — a standard Zendesk business rule — eventually closes a ticket nobody was
 * ever going to reply to, taking a prepared, durable, audited report with it.
 * That is §7's honest-gaps failure shape: a hand-off that exists everywhere
 * except where the human looks.
 *
 * The other two are `open` and stay `open`: both ARE queued work for a human
 * here, which is exactly the distinction `pending` would erase.
 */
export const SIGNOFF_STATUS = "open";
export const ESCALATE_STATUS = "open";
export const UNRECOGNISED_STATUS = "open";

/** The status the sign-off node USED to carry — kept so the test can prove the change. */
export const SIGNOFF_STATUS_BEFORE_FIX = "pending";

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
 * does not and cannot guard the RENDERED note.
 *
 * "discrepancy report" is listed even though the phrase is not false everywhere
 * — a discrepancy report is a real thing this use case can produce. It is
 * forbidden IN A NODE PARAMETER because the only node that ever typed it was
 * the one reached exclusively when there is no discrepancy, and the composed
 * note says "notice-period report" for that branch and names the discrepancy
 * where there is one.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "no remote write exists",
  "ai prepared",
  "ai summary",
  "ai drafted",
  "discrepancy report",
  "no report was prepared for sign-off",
]);

/**
 * The 8 escalate reasons `noticePeriodGates.js` can produce, with a verdict on
 * the sentence this change retires: "No report was prepared for sign-off."
 *
 * As DATA rather than as a paragraph, so the header's "misleading for 3 of 10"
 * is a count a test can take. `noticeComputed` is true when
 * `computeNoticePeriod()` ran AND produced a `noticeEndDate`; the three
 * country-rule reasons reach the calculator and it returns without one, which
 * is not the same as having figures.
 *
 * Nothing here is read by a gate. It is evidence for a prose change, kept next
 * to the prose it justifies.
 */
export const REPORT_ABSENCE_ACCURACY = Object.freeze([
  { reason: "identity_not_verified", noticeComputed: false, accurate: true, why: "the run stops at gate 1; notice and payout are both null on the row" },
  { reason: "employee_not_active", noticeComputed: false, accurate: true, why: "the run stops at gate 2 before any calculation" },
  { reason: "missing_seniority_date", noticeComputed: false, accurate: true, why: "no start date, so tenure — which every bracket is chosen by — cannot be derived" },
  { reason: "unsupported_country", noticeComputed: false, accurate: true, why: "the calculator ran and returned no noticeEndDate; there is no figure to sign off" },
  { reason: "no_statutory_notice_period", noticeComputed: false, accurate: true, why: "a sourced finding that the statute is silent, not a computed period" },
  { reason: "no_statutory_notice_during_probation", noticeComputed: false, accurate: true, why: "a sourced statutory finding that no notice runs during the probationary period (Código do Trabalho art. 114.º(1)), so there is no end date and no figure to sign off" },
  { reason: "no_matching_notice_bracket", noticeComputed: false, accurate: true, why: "the country's table has no bracket for this tenure, so no end date was produced" },
  {
    reason: "statutory_discrepancy",
    noticeComputed: true,
    accurate: false,
    why: "MISLEADING — the notice period, its end date, the tenure and the proposed date are all computed before this branch and Create Resignation Record writes them. What is absent is the sign-off PATH, not the report. This is the escalation where the arithmetic matters most",
  },
  {
    reason: "remote_notice_below_statutory",
    noticeComputed: true,
    accurate: false,
    why: "MISLEADING — the statutory notice period, its end date and Remote's own days_of_notice are ALL on the row before this branch. The whole finding IS a comparison of two computed figures, so 'no report was prepared' is the least accurate thing that can be said about it",
  },
  {
    reason: "pto_balance_unusable",
    noticeComputed: true,
    accurate: false,
    why: "MISLEADING — the notice period is fully computed and durable; only the PTO TOTAL is deliberately not, and saying 'no report was prepared' hides the half that was",
  },
]);

/**
 * The complete target `parameters` block for each node, as data. This is what a
 * deploy has to produce; the checkers below are what check it produced it.
 *
 * `authentication` and `operation` are carried unchanged from the live nodes
 * and repeated here rather than omitted, because a spec that lists only the
 * fields it changes cannot be pasted, and a spec that cannot be pasted gets
 * hand-assembled — which is how the prose these nodes carried got there.
 */
export const SIGNOFF_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: Object.freeze({
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: SIGNOFF_STATUS,
    tags: Object.freeze([SIGNOFF_TAG, ROUTING_TAG_EXPRESSION]),
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
    // Queue tag before the routing tag, exactly as escalationQueueTagSpec.js
    // already has it deployed. Present so this block can be pasted; NOT
    // asserted by the checker — see the tag-ownership block in the header.
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

/**
 * One row per node: everything the parameterised checker needs. Keyed by node
 * NAME because that is what n8n and STRUCTURAL_MAPPINGS both address nodes by.
 */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [SIGNOFF_NODE_NAME]: Object.freeze({ name: SIGNOFF_NODE_NAME, parameters: SIGNOFF_PARAMETERS }),
  [ESCALATE_NODE_NAME]: Object.freeze({ name: ESCALATE_NODE_NAME, parameters: ESCALATE_PARAMETERS }),
  [UNRECOGNISED_NODE_NAME]: Object.freeze({ name: UNRECOGNISED_NODE_NAME, parameters: UNRECOGNISED_PARAMETERS }),
});

/**
 * Node-parameter check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs) and for the hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning
 * as `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js and
 * as UC-04's equivalent: a deploy tool that APPENDS to this expression produces
 * strictly more than the spec asks for, and calling that a regression is how
 * two of this repo's own tools came to disagree and turn `verify-deployed` red
 * on three healthy nodes. The regression this actually guards is the
 * interpolation being GONE — replaced by a hand-typed sentence, which is
 * precisely the state all three nodes were in until 2026-08-31 and which no
 * check could see.
 *
 * TAGS ARE ALSO CONTAINMENT, and the queue tag is deliberately not among the
 * tags checked — escalationQueueTagSpec.js owns that dimension on all fourteen
 * affected nodes across nine graphs.
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
        `unversioned, uncheckable, and is how this node came to tell a specialist that Remote publishes no ` +
        `resignation write ten days after this project's own spec retracted that claim`
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
        `without it the ticket names no uc05_resignations row, so a specialist cannot find the notice and payout ` +
        `figures the decision is about`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc05/terminalZendeskNodesSpec.js's header for what that sentence claims and why it is ` +
          `false, misleading, or attached to the one branch where it cannot be true`
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
        `${JSON.stringify(want.updateFields.status)}` +
        (spec.name === SIGNOFF_NODE_NAME && uf.status === SIGNOFF_STATUS_BEFORE_FIX
          ? ` — "pending" is Zendesk's "waiting on the REQUESTER", and the requester here is the resigning employee, ` +
            `who has nothing left to do. The work is with HR Ops. Leaving it pending stops the requester-wait SLA ` +
            `clock and exposes the ticket to any "auto-solve pending after N days" rule on the account`
          : ` — "pending" is Zendesk's "waiting on somebody who is not us" and "open" is queued work for an agent ` +
            `here; the two are not interchangeable`)
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
export function signoffNodeIssues(node) {
  return terminalZendeskNodeIssues(node, SIGNOFF_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}

/** @param {object} node @returns {string[]} */
export function unrecognisedNodeIssues(node) {
  return terminalZendeskNodeIssues(node, UNRECOGNISED_NODE_NAME);
}
