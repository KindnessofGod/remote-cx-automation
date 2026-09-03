// ---------------------------------------------------------------------------
// escalationCloseNodesSpec.js — the single versioned source of truth for the
// three Zendesk "update ticket" nodes E3-F11/E3-F13 fixed on UC-01's live
// graph (WORKFLOW_UC01_ID): "Escalate Ticket", "Unrecognised Decision" and
// "Reply + Close (No Hand-off)"
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-zu3, guarding rca-947's fix)
//
// rca-947 fixed two live findings by editing inline node PARAMETERS, not a
// jsCode body:
//
//   F-11 — "Escalate Ticket" and "Unrecognised Decision" had
//          updateFields.internalNote as a hand-typed three-field string. It
//          now reads updateFields.internalNote = "={{ $json.internalNote }}"
//          — the SAME expression that already consumes "Compose Internal
//          Note"'s gate-by-gate reasoning for the human_review branch (F-7).
//   F-13 — "Reply + Close (No Hand-off)" had no `group` field at all (every
//          ticket it touched landed in the account's default Support group)
//          and its `tags` array carried only the routing tag, not
//          `verification_exception` — so this branch sat outside the live
//          Zendesk trigger's `not_includes` loop guard.
//
// None of these three nodes carries `jsCode`, so scripts/verify-deployed-
// nodes.mjs's MAPPINGS (which diffs `parameters.jsCode` against a repo file)
// is structurally blind to all three, by construction — exactly the shape
// rca-vqe found for the "Route by Decision" switch, rca-uim found for the
// "Persist Document" Supabase node, and rca-ibh found for the webhook
// trigger. A hand edit through the n8n UI (or a future MCP call) that reverts
// either fix would pass every existing check and "npm run verify-deployed"
// would keep reporting "0 drifted" — the exact failure mode rca-947's own
// commit (85dfcb8, a PROOF.md and nothing else) left open: there is no repo
// file backing these parameters, so there was nothing for MAPPINGS to compare
// against even in principle.
//
// This file is the ONE place these three nodes' target shape is written down
// as data, held against it by two separate checks, the same discipline
// persistDocumentSpec.js / routeByDecisionSpec.js / webhookResponseSpec.js
// already use for their own no-jsCode nodes:
//
//   1. scripts/verify-deployed-nodes.mjs's STRUCTURAL_MAPPINGS reads the LIVE
//      nodes back and asserts their `updateFields` match the constants below
//      exactly — so a hand edit that reverts F-11 (back to an inline string)
//      or F-13 (drops `group`, or drops `verification_exception` from
//      `tags`) fails a deploy check instead of silently reaching production.
//   2. test/n8nEscalationCloseNodesParity.test.js proves this AGAINST A
//      COMMITTED SNAPSHOT of the live nodes (captured 2026-08-22, after
//      rca-947's publish — versionId === activeVersionId ===
//      2c97b013-4e81-432a-972d-a3145920380f) — plus deliberately mutated
//      copies of it — hermetically, with no N8N_API_KEY needed, proving the
//      detector itself can fail before trusting it to run against production.
//
// rca-iih7 / D-14 (round-6 S2, 2026-08-22 later the same day): the snapshot
// above was itself missing something the checker never asked about. "Escalate
// Ticket" and "Unrecognised Decision" always run on the escalation path (see
// NOTE_NODE_QUEUE_TAG_EXPRESSION's own comment), so `routingTag` there is
// always the escalation marker — `tags` carried `escalation_hr_ops` and never
// `queue_hr_ops`, on every one of the nine live escalations a round-6
// specialist opened. The note this same composer writes claims BOTH tags
// ("tagged queue_hr_ops, escalation_hr_ops") — a claim the ticket did not
// back up, and the exact failure §16 item 2 exists to catch. Re-patched live
// and re-snapshotted below.
// ---------------------------------------------------------------------------

export const ESCALATE_NODE_NAME = "Escalate Ticket";
export const UNRECOGNISED_NODE_NAME = "Unrecognised Decision";
export const REPLY_CLOSE_NODE_NAME = "Reply + Close (No Hand-off)";
export const ZENDESK_NODE_TYPE = "n8n-nodes-base.zendesk";

/**
 * F-11: what "Escalate Ticket" and "Unrecognised Decision" must read their
 * note from. Anything else — most dangerously a syntactically-valid inline
 * string that LOOKS like a summary — is the regression: it silently stops
 * carrying "Compose Internal Note"'s gate-by-gate reasoning (the deciding
 * gate, the figures compared, the "means" sentence) that F-7 built and #98
 * already proved live.
 */
export const INTERNAL_NOTE_EXPRESSION = "={{ $json.internalNote }}";

/**
 * The part of the expression above that must SURVIVE. See noteNodeParamIssues()
 * for why the check is containment rather than equality.
 */
export const INTERNAL_NOTE_INTERPOLATION = "{{ $json.internalNote }}";

/**
 * F-11: both note nodes route through "Compose Internal Note" -> "Assign
 * Routing" -> "Route by Decision", so they read the routing tag/group off
 * "Assign Routing" BY NAME rather than off `$json` directly — `$json` at
 * that point in the graph is whatever "Compose Internal Note" last emitted,
 * which does not carry these two fields.
 */
export const NOTE_NODE_ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";
export const NOTE_NODE_ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";

/**
 * rca-iih7 / D-14. `routingTag` above is "the most specific tag" — for these
 * two nodes that is ALWAYS the escalation marker (`isEscalation()` treats an
 * unrecognised decision as an escalation too, and both nodes only ever run on
 * that path), so `tags` carried `escalation_hr_ops` and never `queue_hr_ops`.
 * Every note this composer writes says "tagged queue_hr_ops, escalation_hr_ops"
 * (composeInternalNote.js's routingNote, itself built from `Assign Routing`'s
 * own `routing.note`) — so the ticket claimed a tag it did not carry, and a
 * queue built from the tag the note names showed nothing (§16 item 2, exactly
 * the failure `docs/APPROVAL-QUEUE.md` exists to catch). `routing.queueTag` is
 * the OWNING team's tag regardless of escalation state — read by node name
 * rather than reusing `zendeskTags[0]`, so a future reordering of that array
 * cannot silently repoint this expression at the wrong element.
 */
export const NOTE_NODE_QUEUE_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routing.queueTag }}";

/**
 * F-13: "Reply + Close (No Hand-off)" sits on the `blocked` /
 * `awaiting_employee_consent` / `deflected_to_self_service` branch, straight
 * off "Prepare Refusal Reply" — so it reads `$json` directly rather than by
 * node name, unlike the two nodes above.
 */
export const REPLY_CLOSE_ZENDESK_GROUP_EXPRESSION = "={{ $json.zendeskGroupId }}";

/** Both accepted sources for the routed group id — see replyCloseParamIssues(). */
export const REPLY_CLOSE_ZENDESK_GROUP_EXPRESSIONS = Object.freeze([
  REPLY_CLOSE_ZENDESK_GROUP_EXPRESSION,
  NOTE_NODE_ZENDESK_GROUP_EXPRESSION,
]);
export const REPLY_CLOSE_ROUTING_TAG_EXPRESSION = "={{ $json.routingTag }}";

/**
 * F-13: the tag that puts this branch inside the live Zendesk trigger's
 * (`9990000000004`) `not_includes` loop guard. Its ABSENCE was the
 * regression — a ticket that reaches this node without it can be re-picked
 * up by the same trigger on its next update.
 */
export const VERIFICATION_EXCEPTION_TAG = "verification_exception";

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs): F-11 for "Escalate Ticket" and
 * "Unrecognised Decision" — does the live node's `updateFields.internalNote`
 * still read the composer's output, and does it still carry the routing
 * tag/group it always had (unchanged by rca-947, checked here so a
 * regression on THOSE fields is not mistaken for "this spec only covers
 * F-11")?
 *
 * @param {object} node the live "Escalate Ticket" or "Unrecognised Decision" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function noteNodeParamIssues(node) {
  const issues = [];
  const uf = node?.parameters?.updateFields ?? {};

  // MUST CARRY the composed note; need not be ONLY the composed note.
  //
  // Relaxed from exact equality on 2026-08-29, and the reason matters because
  // loosening a regression guard usually weakens it. F-11's regression is the
  // note being REPLACED by a hand-typed inline string, which LOSES "Compose
  // Internal Note"'s gate-by-gate reasoning. `deploy-routing-nodes.mjs` now
  // APPENDS the routing sentence to these nodes on all nine graphs, producing
  // "={{ $json.internalNote }} {{ $('Assign Routing').item.json.routingNote }}"
  // — strictly MORE than the spec demanded, never less. Exact equality called
  // that a regression, so two of this repo's own tools disagreed and
  // `verify-deployed` went red on three healthy nodes.
  //
  // Containment is the property F-11 actually cares about, and it still fails
  // on the thing F-11 was written for: a note that does not interpolate
  // `$json.internalNote` at all.
  if (typeof uf.internalNote !== "string" || !uf.internalNote.includes(INTERNAL_NOTE_INTERPOLATION)) {
    issues.push(
      `updateFields.internalNote is ${JSON.stringify(uf.internalNote)}, expected to interpolate ` +
        `${JSON.stringify(INTERNAL_NOTE_INTERPOLATION)} — F-11's regression is an inline composed ` +
        `string here, which silently stops carrying "Compose Internal Note"'s reasoning`
    );
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  if (!tags.includes(VERIFICATION_EXCEPTION_TAG)) {
    issues.push(`updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(VERIFICATION_EXCEPTION_TAG)}`);
  }
  if (!tags.includes(NOTE_NODE_ROUTING_TAG_EXPRESSION)) {
    issues.push(`updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(NOTE_NODE_ROUTING_TAG_EXPRESSION)}`);
  }
  if (!tags.includes(NOTE_NODE_QUEUE_TAG_EXPRESSION)) {
    issues.push(
      `updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(NOTE_NODE_QUEUE_TAG_EXPRESSION)} — ` +
        `D-14's regression is this tag ABSENT, so the note's own "tagged queue_hr_ops, escalation_hr_ops" claim is false on the ticket`
    );
  }

  if (uf.group !== NOTE_NODE_ZENDESK_GROUP_EXPRESSION) {
    issues.push(`updateFields.group is ${JSON.stringify(uf.group)}, expected ${JSON.stringify(NOTE_NODE_ZENDESK_GROUP_EXPRESSION)}`);
  }

  return issues;
}

/**
 * Node-type-specific check for `structuralNodeIssues()`: F-13 for
 * "Reply + Close (No Hand-off)" — does the live node still assign the routed
 * group, and does `tags` still carry both `verification_exception` (the loop
 * guard) and the routing tag?
 *
 * @param {object} node the live "Reply + Close (No Hand-off)" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function replyCloseParamIssues(node) {
  const issues = [];
  const uf = node?.parameters?.updateFields ?? {};

  // EITHER SOURCE of the routed group id is accepted; ABSENT is not.
  //
  // F-13's regression, stated in this file's own header, is the field being
  // missing so the ticket lands in the account's default Support group. Reading
  // the id off `$json` or off "Assign Routing" by name are two ways of getting
  // the same value, and `deploy-routing-nodes.mjs` writes the by-name form.
  // Proven live on 2026-08-29: ticket 15 (`blocked`/`engagement_not_eor_
  // contractor`) was solved into HR Ops `99900000000009`, not the default group
  // `99900000000009`, through the by-name form.
  if (!REPLY_CLOSE_ZENDESK_GROUP_EXPRESSIONS.includes(uf.group)) {
    issues.push(
      `updateFields.group is ${JSON.stringify(uf.group)}, expected one of ` +
        `${JSON.stringify(REPLY_CLOSE_ZENDESK_GROUP_EXPRESSIONS)} — ` +
        `F-13's regression is this field ABSENT, which lands the ticket in the account's default Support group`
    );
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  if (!tags.includes(VERIFICATION_EXCEPTION_TAG)) {
    issues.push(
      `updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(VERIFICATION_EXCEPTION_TAG)} — ` +
        `without it this branch sits outside the live trigger's not_includes loop guard`
    );
  }
  if (!tags.includes(REPLY_CLOSE_ROUTING_TAG_EXPRESSION)) {
    issues.push(`updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(REPLY_CLOSE_ROUTING_TAG_EXPRESSION)}`);
  }

  return issues;
}
