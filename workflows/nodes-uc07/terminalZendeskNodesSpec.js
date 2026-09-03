// ---------------------------------------------------------------------------
// terminalZendeskNodesSpec.js — the single versioned source of truth for the
// ONE terminal Zendesk node on UC-07's live graph (WORKFLOW_UC07_ID):
// "Escalate Relocation Ticket"
// ---------------------------------------------------------------------------
// WHY THERE IS ONLY ONE
//
// UC-07 is 🔴, and every run escalates: `relocationGates.js` sets
// `const decision = 'escalate'` and the graph has no Switch or IF node anywhere
// (twelve nodes, read live on 2026-08-31). So there is no second terminal
// branch to be blocked, approved or unrecognised on. That is the same reason
// `workflows/nodes/escalationQueueTagSpec.js` gives for UC-07 contributing one
// row to its table rather than two — an absence in the graph, not an omission
// in a spec.
//
// WHY THIS FILE EXISTS AT ALL
//
// A Zendesk "update ticket" node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to it. The
// sentence this node wrote onto a Tier-3 specialist's ticket was typed once
// into a node parameter, versioned by nothing and read back by no check.
//
// ---------------------------------------------------------------------------
// WHAT THE OLD SENTENCE GOT WRONG — two defects in one string
// ---------------------------------------------------------------------------
// The live `updateFields.internalNote`, captured verbatim:
//
//   "=AI research dossier {{ $('Create Dossier Record').item.json.id }} —
//    {{ $('Relocation Gates').item.json.dossier.narrative }} RESEARCH SUPPORT
//    ONLY, not a decision to proceed. For review by a qualified Remote Mobility
//    Legal specialist. {{ $('Assign Routing').item.json.routingNote }}"
//
// 1. IT DROPPED HALF THE DISCLAIMER — AND THE HALF IT DROPPED COVERS EXACTLY
//    WHAT THE NOTE THEN PRINTS.
//
//    The canonical string is a dossier FIELD, `framing`, written identically by
//    `workflows/nodes-uc07/relocationGates.js`'s `buildDossier()` and by
//    `src/uc07/dossierBuilder.js` line 228:
//
//      "RESEARCH SUPPORT ONLY — not a relocation decision or a legal,
//       immigration, or tax determination. For review by a qualified Mobility
//       Legal specialist (Tier-3)."
//
//    The node's paraphrase kept "not a decision to proceed" and silently
//    dropped "or a legal, immigration, or tax determination". So a Tier-3
//    specialist was told the dossier is not a go/no-go and was NOT told that
//    its immigration and tax content is not a determination — while the very
//    next thing the note prints is that content: the narrative enumerates
//    `UC07_IMMIGRATION_REQUIRED`, `UC07_TAX_RESIDENCY_REVIEW_REQUIRED` and
//    `UC07_PE_RISK_REVIEW_REQUIRED` in prose, and the dossier's
//    `requiredActions` are literally `IMMIGRATION_ASSESSMENT`, `PE_REVIEW`,
//    `TAX_REVIEW`.
//
//    `framing` is stored in `uc07_dossiers.dossier` and rendered in the ZAF
//    panel. It had never been written to the ticket at all.
//
//    THE FIX IS NOT A BETTER PARAPHRASE. `composeInternalNote()` interpolates
//    `dossier.framing` VERBATIM, so the sentence exists in exactly one place
//    and the ticket, the stored row and the ZAF panel carry the same words by
//    construction rather than by anyone remembering to update three copies.
//
// 2. "AI research dossier" IS FALSE ON THIS PATH.
//
//    `WORKFLOW_UC07_ID` has TWELVE nodes and NOT ONE of them is an LLM call —
//    webhook, two Code nodes, four Supabase, one Zendesk, one NoOp, the trace
//    pair, and Assign Routing. Everything the note prints is deterministic:
//    `draftNarrativeTemplate()` is a template, `retrieveMobilityGuidance()` is
//    keyword matching over a local corpus, and `faithfulness` is the explicit
//    `{verdict: "not_evaluated"}` sentinel precisely because no judge can run in
//    a Code node.
//
//    `src/uc07/workflow.js` DOES have an LLM `draftNarrative()` seam — but this
//    note only ever rides the n8n graph, where that seam does not exist. So the
//    label oversold a deterministic artifact to the one reader whose whole job
//    is to weigh how much of it to trust. Dropped; the composed note states the
//    provenance of each part instead (`parseSource`, "a deterministic
//    template", "keyword match over a local reference corpus").
//
// ---------------------------------------------------------------------------
// UC-07 IS 🔴 — THE GUARANTEE THIS NODE MUST NOT WEAKEN
// ---------------------------------------------------------------------------
// No execution path may exist, and that holds today in three places at once:
// this graph has no decision branch, `src/uc07/dossierStore.js` has one write
// method and zero mutation methods, and the UC-07 API has no POST route.
// A ticket note is a FOURTH surface where the guarantee could be given away —
// not in code, in prose, by telling a specialist that something here can be
// approved, authorised or proceeded with.
//
// So: NOTHING `composeInternalNote()` AUTHORS USES AN APPROVE / AUTHORISE /
// PROCEED / SIGN-OFF VERB, IN ANY FORM, EVEN NEGATED. That is asserted by
// `test/n8nUc07TerminalZendeskNodes.test.js` over the composed note with
// `narrative` and `framing` subtracted — those two are
// `src/uc07/dossierBuilder.js`'s own reviewed sentences, quoted verbatim, and
// they use those verbs precisely to NEGATE them ("That is NOT an approval —
// this use case has no execution path, and a human decides"). A bare verb scan
// over the whole note would fire on exactly the disclaimers the note exists to
// carry. The scan is therefore pointed at the words this repo chooses here,
// which is what it can control. The same scan runs over this file's target
// `updateFields`.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DOES *NOT* OWN
// ---------------------------------------------------------------------------
// THE QUEUE TAG (rca-iih7 / D-14) IS NOT THIS FILE'S. This node already carries
// `={{ $('Assign Routing').item.json.routing.queueTag }}` on the live graph,
// deployed by the pass that owns `workflows/nodes/escalationQueueTagSpec.js`.
// The tags in this file's target are copied from that spec's row so a deploy
// from either cannot drop one, and `escalateNodeIssues()` DELIBERATELY DOES NOT
// assert the queue tag: two checkers asserting one field is how a fix in one
// lands as a failure in the other. A cross-spec test holds the two rows equal
// on every field except `internalNote`, where they differ on purpose —
// **publishing that file's `targetParameters` wholesale would revert this
// change.** Take its `tags` array and nothing else.
//
// STRUCTURAL_MAPPINGS IS NOT WIRED HERE. `scripts/lib/` is outside this pass's
// ownership, so `npm run verify-deployed` does not yet run `escalateNodeIssues()`
// against the live node. The deploy doc's "Reading it back" section is that
// check, by hand, and it is a named follow-up rather than a silent gap.
//
// ---------------------------------------------------------------------------
// THE CHECK THAT DOES HOLD THIS FILE
//   test/n8nUc07TerminalZendeskNodes.test.js — hermetic, no n8n credentials.
//   Holds the constants below against a CAPTURED SNAPSHOT of the live node
//   (read from `GET /api/v1/workflows/WORKFLOW_UC07_ID` on 2026-08-31,
//   `versionId === activeVersionId === 3f8983a9-2aed-44f2-90c6-af773fc2e446`)
//   and against deliberately mutated copies, so each detector is proven able to
//   FAIL before it is trusted to pass.
// ---------------------------------------------------------------------------

export const ESCALATE_NODE_NAME = "Escalate Relocation Ticket";
export const TERMINAL_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC07_WORKFLOW_ID = "WORKFLOW_UC07_ID";

/** One node. The array exists so the checker and the test iterate rather than special-case. */
export const TERMINAL_NODE_NAMES = Object.freeze([ESCALATE_NODE_NAME]);

/**
 * The composed note, read off `Relocation Gates` BY NODE NAME.
 *
 * NOT `$json`: at this node `$json` is whatever `Assign Routing` emitted.
 * `Assign Routing` happens to spread its own input today, which is precisely
 * what makes `$json` the wrong thing to depend on — the day it stops, the
 * expression renders as an EMPTY STRING on a fully green execution and every
 * layer reports success.
 *
 * `.item` and not `.first()`, UNCHANGED from the live node, which already
 * addresses `$('Relocation Gates').item.json.externalRef` and
 * `.item.json.dossier.narrative` and has been proven working by real
 * executions (10710). UC-02's sibling spec takes `.first()` for its own graph
 * and says why; the difference is that UC-02's chain is eight hops and crosses
 * a node with `onError: continueRegularOutput`, while this one is a straight
 * line of five and is already proven on `.item`. Rewriting a proven expression
 * to match a different graph's is how a prose change becomes an outage.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $('Relocation Gates').item.json.internalNote }}";

/**
 * The dossier record id, and the routing sentence. Both are APPENDED in the
 * expression rather than composed into `internalNote`, because both are
 * produced by nodes DOWNSTREAM of `Relocation Gates`: the Supabase insert has
 * not run when the gates run, so the row id does not exist yet, and
 * `Assign Routing` has not run either.
 *
 * `DOSSIER_REF_LABEL` is the only hand-typed prose left on this node, and it is
 * three words long on purpose. It is a label for a value that cannot be
 * composed upstream — not a description of anything, so there is nothing in it
 * to be wrong about. It is a named constant rather than a literal inside the
 * expression so the test can assert on it.
 */
export const DOSSIER_REF_LABEL = "Dossier record:";
export const DOSSIER_REF_INTERPOLATION = "{{ $('Create Dossier Record').item.json.id }}";
export const ROUTING_NOTE_INTERPOLATION = "{{ $('Assign Routing').item.json.routingNote }}";

/**
 * The exact `updateFields.internalNote` the node must carry.
 *
 * The note first, the record reference second, the routing sentence last —
 * because the note ends with "WHERE THIS IS WORKED", which the routing sentence
 * is the answer to.
 */
export const INTERNAL_NOTE_EXPRESSION =
  "=" +
  INTERNAL_NOTE_INTERPOLATION +
  "\n\n" +
  DOSSIER_REF_LABEL +
  " " +
  DOSSIER_REF_INTERPOLATION +
  "\n\n" +
  ROUTING_NOTE_INTERPOLATION;

/** Unchanged from the live node. Kept here so a regression on them is visible too. */
export const TICKET_ID_EXPRESSION = "={{ $('Relocation Gates').item.json.externalRef }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";

/**
 * rca-iih7 / D-14's expression, ALREADY LIVE on this node. Reproduced so the
 * target here is complete and pasteable; deliberately NOT asserted by the
 * checker below — `workflows/nodes/escalationQueueTagSpec.js` owns it.
 */
export const QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

export const ESCALATED_TAG = "uc07_escalated";

/**
 * `open`, UNCHANGED. This IS queued work for a human — the whole of UC-07 is —
 * and `pending` would say the ticket is waiting on somebody who is not us.
 */
export const ESCALATE_STATUS = "open";

/**
 * THE PHRASES THAT MUST NEVER COME BACK, checked as substrings of the whole
 * `updateFields` blob rather than of one field — the 2026-08-29 Zendesk
 * migration's own lesson is that a field-by-field walk misses the copy hiding
 * inside a string inside another field.
 *
 * `"not a decision to proceed"` is the paraphrase itself; `"research support
 * only"` is listed because the WHOLE disclaimer must arrive as `framing`'s own
 * interpolated value and never as a retyped literal, and a retype would start
 * with those three words. Both firing on one string is two messages for one
 * defect, which is the harmless direction.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "ai research dossier",
  "not a decision to proceed",
  "research support only",
]);

/**
 * The verbs that must not appear in anything this repository AUTHORS for this
 * ticket. Scanned over the target `updateFields` and over the scaffolding of
 * the composed note (that is, the note with `narrative` and `framing`
 * subtracted — see this file's header for why the subtraction is not a
 * loophole).
 *
 * Written as one case-insensitive source string per concept rather than as
 * whole words, so `approval`, `approves`, `authorisation`, `authorized`,
 * `proceeding` and `signed off` are all caught by the stem. `\b` is not used on
 * the left: these appear inside `_`-separated tokens too.
 */
export const FORBIDDEN_DECISION_VERBS = Object.freeze([
  "approv",
  "authoris",
  "authoriz",
  "proceed",
  "sign off",
  "signed off",
  "sign-off",
  "go ahead",
  "go-ahead",
  "greenlight",
  "green light",
]);

/**
 * @param {string} text
 * @returns {string|null} the first forbidden verb stem found, or null
 */
export function findDecisionVerb(text) {
  const haystack = String(text ?? "").toLowerCase();
  for (const stem of FORBIDDEN_DECISION_VERBS) {
    if (haystack.includes(stem)) return stem;
  }
  return null;
}

/**
 * The complete target `parameters` block, as data. `authentication`,
 * `operation` and `id` are carried unchanged from the live node and repeated
 * here rather than omitted, because a spec that lists only the fields it
 * changes cannot be pasted, and a spec that cannot be pasted gets
 * hand-assembled — which is how the prose on this node got there.
 *
 * NO `publicReply`, AND THAT IS LOAD-BEARING. Nothing on this graph replies to
 * the requester: the customer-facing acknowledgement lives on the dossier as
 * `customerFacingAcknowledgement` and is sent, if at all, by whoever works the
 * request. A reply field added here would put a 🔴 dossier's contents in front
 * of the requester with no specialist between.
 */
export const ESCALATE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: TICKET_ID_EXPRESSION,
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    internalNote: INTERNAL_NOTE_EXPRESSION,
    status: ESCALATE_STATUS,
    // ALREADY LIVE. Copied from escalationQueueTagSpec.js's row so a deploy
    // from this file cannot drop it; not asserted by the checker below.
    tags: [ESCALATED_TAG, QUEUE_TAG_EXPRESSION, ROUTING_TAG_EXPRESSION],
  },
});

/** Keyed by node NAME because that is what n8n addresses nodes by. */
export const TERMINAL_NODE_SPECS = Object.freeze({
  [ESCALATE_NODE_NAME]: Object.freeze({ name: ESCALATE_NODE_NAME, parameters: ESCALATE_PARAMETERS }),
});

/**
 * Node-parameter check for `structuralNodeIssues()` (once wired) and for the
 * hermetic test.
 *
 * CONTAINMENT, NOT EQUALITY, on the note — same relaxation and same reasoning
 * as `noteNodeParamIssues()` in workflows/nodes/escalationCloseNodesSpec.js. The
 * regression this guards is the interpolation being GONE, replaced by a
 * hand-typed sentence, which is the state this node was in until 2026-08-31.
 *
 * @param {object} node the live node, as returned by GET /api/v1/workflows/{id}
 * @param {string} [nodeName]
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
        `how the dossier's own framing sentence came to be paraphrased with its second half missing`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(ROUTING_NOTE_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not append ${JSON.stringify(ROUTING_NOTE_INTERPOLATION)} — ` +
        `the routing sentence is produced downstream of the gates, so it has to be appended here; without it the ` +
        `note's "WHERE THIS IS WORKED" paragraph names no team at all`
    );
  }

  if (typeof uf.internalNote === "string" && !uf.internalNote.includes(DOSSIER_REF_INTERPOLATION)) {
    issues.push(
      `${spec.name}: updateFields.internalNote does not carry ${JSON.stringify(DOSSIER_REF_INTERPOLATION)} — ` +
        `the row id is produced by the Supabase insert downstream of the gates, so it cannot be composed upstream, ` +
        `and without it the ticket cannot be tied back to the dossier a specialist is meant to open`
    );
  }

  if (uf.publicReply !== undefined) {
    issues.push(
      `${spec.name}: updateFields.publicReply is set to ${JSON.stringify(uf.publicReply)} — nothing on a 🔴 graph ` +
        `may reply to the requester. The dossier's customerFacingAcknowledgement is sent by whoever works the ` +
        `request, with a specialist in between`
    );
  }

  // The whole blob, not one field — see FORBIDDEN_PHRASES.
  const blob = JSON.stringify(node?.parameters?.updateFields ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase.toLowerCase())) {
      issues.push(
        `${spec.name}: updateFields still contains ${JSON.stringify(phrase)} — see ` +
          `workflows/nodes-uc07/terminalZendeskNodesSpec.js's header. The disclaimer must arrive as the dossier's ` +
          `own \`framing\` field, verbatim, never as a paraphrase or a retyped literal`
      );
    }
  }

  // 🔴: nothing this node's own parameters say may imply a decision is
  // available. The composed note's scaffolding is scanned separately, by the
  // test, because it is not visible from here.
  const verb = findDecisionVerb(blob);
  if (verb) {
    issues.push(
      `${spec.name}: updateFields contains the decision verb ${JSON.stringify(verb)} — UC-07 is 🔴 and no execution ` +
        `path may exist; nothing written onto this ticket may imply anyone can approve, authorise or proceed with it`
    );
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
      `${spec.name}: updateFields.group is ${JSON.stringify(uf.group)}, expected ${JSON.stringify(wantUf.group)} — ` +
        `absent lands the ticket in the account's default Support group (§7's honest-gaps items 7–8)`
    );
  }

  if (uf.status !== wantUf.status) {
    issues.push(
      `${spec.name}: updateFields.status is ${JSON.stringify(uf.status)}, expected ${JSON.stringify(wantUf.status)} — ` +
        `"open" is queued work for an agent here, which every UC-07 ticket is`
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
export function escalateNodeIssues(node) {
  return terminalZendeskNodeIssues(node, ESCALATE_NODE_NAME);
}
