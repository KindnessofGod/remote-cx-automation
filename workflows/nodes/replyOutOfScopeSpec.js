// ---------------------------------------------------------------------------
// replyOutOfScopeSpec.js — the versioned source of truth for UC-01's
// `Reply Out of Scope` Zendesk node on WORKFLOW_UC01_ID
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// This is the only CUSTOMER-FACING sentence on UC-01's graph that is a literal
// typed into a node parameter. A Zendesk node carries no `jsCode`, so
// `scripts/lib/deployedNodeMappings.mjs`'s MAPPINGS cannot see it, and it sat
// in `scripts/lib/unguarded-node-baseline.json` — a message sent to real
// customers, versioned by nothing.
//
// WHAT IT SAID, until 2026-08-31:
//
//   "I'm sorry, I only handle employment verification requests. If you need a
//    standard employment verification letter, please let me know."
//
// Nothing in it is FALSE, which is why it survived an audit that was looking
// for false claims. Two things are wrong with it anyway.
//
// 1. FIRST PERSON SINGULAR. A customer reads "I'm sorry, I only handle…" as a
//    named human agent declining them. It is an automation. The repo's whole
//    posture is that a reader must be able to tell what decided — every audit
//    row is tagged `source: "llm"` / `"rule_based_fallback"`, the letter says
//    what it is — and the one message a customer actually receives was the
//    place that did not say.
//
// 2. "PLEASE LET ME KNOW" PROMISES THE SAME "I". It does not come back. Read
//    live from trigger 99900000000009 on 2026-08-31, the intake guard is
//    `current_tags not_includes uc01_auto_resolved uc01_human_review
//    verification_exception uc01_out_of_scope_replied` — and this node applies
//    `uc01_out_of_scope_replied`. So the automation is switched off for that
//    ticket permanently and a reply reaches a HUMAN, not the "I" that wrote it.
//
//    That is not a dead end — the node also sets `group` from `Assign Routing`
//    and leaves `status` unset, so the ticket stays open in a real queue and a
//    person does see it. Checked before writing this, because the interesting
//    version of this finding would have been a reply that reached nobody, and
//    it is worth recording that it is NOT that. What is wrong is narrower:
//    the sentence names the wrong responder.
//
// THE PRECEDENT THIS REPO ALREADY PAID FOR is one level over —
// `src/uc01/selfServiceLetter.js`'s header: "an employee who followed the
// deflection's own advice found nothing at all". A deflection that points
// somewhere is the whole job of a deflection.
//
// WHY THE TEXT IS A CONSTANT HERE RATHER THAN COMPOSED IN A CODE NODE, unlike
// every internal note fixed on 2026-08-31: this reply has no per-decision
// content. It is one sentence for one outcome, and the branch that reaches it
// is `out_of_scope`, full stop. Routing it through a composer would add a node
// to a production graph to interpolate a string that never varies.
// ---------------------------------------------------------------------------

export const REPLY_OUT_OF_SCOPE_NODE_NAME = "Reply Out of Scope";
export const REPLY_OUT_OF_SCOPE_NODE_TYPE = "n8n-nodes-base.zendesk";
export const UC01_WORKFLOW_ID = "WORKFLOW_UC01_ID";

/** Applied by this node, and named in the intake trigger's `not_includes` guard. */
export const OUT_OF_SCOPE_TAG = "uc01_out_of_scope_replied";
export const ROUTING_TAG_EXPRESSION = "={{ $('Assign Routing').item.json.routingTag }}";
export const ZENDESK_GROUP_EXPRESSION = "={{ $('Assign Routing').item.json.zendeskGroupId }}";

/**
 * PLAIN TEXT, and it must stay plain text.
 *
 * n8n's `publicReply` is the plain-text field and silently ESCAPES HTML — its
 * `internalNote` sibling is the one documented "(Accepts HTML)". UC-01 already
 * shipped a letter to a customer as literal `&lt;!doctype html&gt;…` source on a
 * fully "successful" run because of exactly this. No tags, no entities.
 */
export const REPLY_OUT_OF_SCOPE_TEXT =
  "This request was read automatically, and it falls outside what this automation " +
  "answers — it handles employment verification requests only.\n\n" +
  "If you need a standard employment verification letter, reply and say so and a " +
  "member of the team will pick it up from here. Nothing further happens " +
  "automatically on this ticket.";

/** The exact `updateFields` the live node must carry. */
export const REPLY_OUT_OF_SCOPE_PARAMETERS = Object.freeze({
  authentication: "oAuth2",
  operation: "update",
  id: "={{ $json.externalRef }}",
  updateFields: {
    group: ZENDESK_GROUP_EXPRESSION,
    publicReply: REPLY_OUT_OF_SCOPE_TEXT,
    tags: [OUT_OF_SCOPE_TAG, ROUTING_TAG_EXPRESSION],
  },
});

/**
 * PHRASES THAT MUST NOT COME BACK.
 *
 * The first three are the retired sentence. The fourth is the class rather
 * than the instance: any first-person-singular self-reference in a message a
 * customer receives from an automation. Checked case-insensitively against the
 * whole `updateFields` blob, not one field — the 2026-08-29 Zendesk migration's
 * lesson is that a field-by-field walk misses the copy hiding inside a string
 * inside another field.
 */
export const FORBIDDEN_PHRASES = Object.freeze([
  "i only handle",
  "please let me know",
  "i'm sorry, i",
]);

/**
 * @param {object} node the live "Reply Out of Scope" node
 * @returns {string[]} issue descriptions; empty means it matches
 */
export function replyOutOfScopeIssues(node) {
  const issues = [];
  const uf = node?.parameters?.updateFields ?? {};

  if (uf.publicReply !== REPLY_OUT_OF_SCOPE_TEXT) {
    issues.push(
      `updateFields.publicReply is ${JSON.stringify(uf.publicReply)}, expected the versioned text. This is the ` +
        `one message on this graph a CUSTOMER receives; an edit here reaches a real person and is versioned by ` +
        `nothing unless it goes through this file`
    );
  }

  // Equality above already pins the text; this catches the case where someone
  // ALSO updates the constant, which equality alone would happily accept.
  const blob = JSON.stringify(uf ?? {}).toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (blob.includes(phrase)) {
      issues.push(
        `updateFields still contains ${JSON.stringify(phrase)} — this reply is written BY AN AUTOMATION, and the ` +
          `"I" it promises does not come back: this node applies ${OUT_OF_SCOPE_TAG}, which the intake trigger's ` +
          `not_includes guard excludes, so a human picks the reply up and not the sender`
      );
    }
  }

  // HTML in a plain-text field is the UC-01 failure that delivered escaped
  // markup to a customer on a green run.
  if (typeof uf.publicReply === "string" && /<[a-z!/]/i.test(uf.publicReply)) {
    issues.push(
      `updateFields.publicReply contains markup. n8n's publicReply is PLAIN TEXT and silently escapes HTML — the ` +
        `customer receives the source, on a run that reports success`
    );
  }

  const tags = Array.isArray(uf.tags) ? uf.tags : [];
  for (const tag of [OUT_OF_SCOPE_TAG, ROUTING_TAG_EXPRESSION]) {
    if (!tags.includes(tag)) {
      issues.push(
        `updateFields.tags is ${JSON.stringify(uf.tags)}, expected to include ${JSON.stringify(tag)}` +
          (tag === OUT_OF_SCOPE_TAG
            ? ` — without it the intake trigger re-fires on the customer's reply and answers them again (F-3)`
            : "")
      );
    }
  }

  if (uf.group !== ZENDESK_GROUP_EXPRESSION) {
    issues.push(
      `updateFields.group is ${JSON.stringify(uf.group)}, expected ${JSON.stringify(ZENDESK_GROUP_EXPRESSION)} — ` +
        `this is what makes the reply reach a human queue rather than the account default, and it is the reason ` +
        `"a member of the team will pick it up" is a true sentence`
    );
  }

  if ("status" in uf) {
    issues.push(
      `updateFields.status is ${JSON.stringify(uf.status)} — it must stay UNSET. Solving or pending this ticket ` +
        `takes it out of the queue the reply just promised would pick it up`
    );
  }

  return issues;
}
