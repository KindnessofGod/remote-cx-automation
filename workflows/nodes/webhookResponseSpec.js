// ---------------------------------------------------------------------------
// webhookResponseSpec.js — the single versioned source of truth for what the
// "Zendesk Ticket Webhook" trigger node is allowed to hand back over HTTP, on
// UC-01's live graph (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-ibh / F-4, rca-4v5's live E2E finding)
//
// The webhook node had no authentication AND `responseMode: "lastNode"` — n8n
// echoes whatever the workflow's last-executed node produced back to the HTTP
// caller. On this graph the last node before a Zendesk write can be
// `Identity + Policy Gates`'s own output (when a downstream node errors, as it
// did on the captured probe under a duplicate `workflow_claims` key), which
// carries the FULL employment record (`full_name`, `email`, `job_title`,
// `start_date`, `legal_entity_id`) and the internal `openaiBody` sent to
// OpenAI. An unauthenticated caller who names any employment id gets all of
// it back, regardless of what the policy gates decided — see
// qa/evidence/UC-01/2026-08-22-uc01-e2e/shared/webhook-unauth-probe2.json.
//
// SCOPE, DELIBERATELY NARROW. This bead fixes the TRANSPORT disclosure only:
// the webhook now responds immediately, before the gates ever run, with a
// fixed acknowledgement body that names nothing about any case. The real
// caller (a Zendesk trigger) never reads the response, so switching
// `responseMode` away from `lastNode` changes nothing it depends on.
//
// F-4's SECOND HALF — authentication — WAS CLOSED SEPARATELY on 2026-08-27,
// and the reason it was a separate change is the reason it worked: adding a
// credential without updating the Zendesk-side caller in the same breath
// breaks the entry point, because a Zendesk webhook that fails once
// circuit-breaks and cannot be repaired. The order that avoids it is Zendesk
// first, n8n second. All nine graphs now carry `authentication: "headerAuth"`
// against one shared secret; `npm run verify-webhook-auth` proves each one
// answers 403 to an unauthenticated POST and creates no execution. Full
// record, including the three traps this cost: docs/WEBHOOK-AUTH.md.
//
// THIS FILE STILL DOES NOT CHECK AUTHENTICATION, on purpose. It is the spec
// for what the node may hand BACK; the verifier above is the spec for who may
// get IN. Two questions, two checks — folding them together would mean a
// disclosure regression and a lock regression could mask each other.
//
// This file is the ONE place the node's target shape is written down as data,
// held against it by two separate checks, the same discipline
// persistDocumentSpec.js and routeByDecisionSpec.js already use for their own
// no-jsCode nodes:
//
//   1. scripts/deploy-uc01-webhook-fix-disclosure.mjs builds the live node's
//      `parameters` directly from the constants below, so the deployed node
//      and this spec cannot drift from each other at deploy time.
//   2. scripts/verify-deployed-nodes.mjs's STRUCTURAL_MAPPINGS reads the LIVE
//      node back and asserts `responseMode`/`options.responseData` still
//      match this file — so a hand edit through the n8n UI that reverts to
//      `lastNode` (re-opening the disclosure) fails a deploy check instead of
//      silently reaching production.
// ---------------------------------------------------------------------------

export const NODE_NAME = "Zendesk Ticket Webhook";
export const NODE_TYPE = "n8n-nodes-base.webhook";

/** Unchanged by this fix — the production URL Zendesk's trigger already calls. */
export const HTTP_METHOD = "POST";
export const PATH = "uc-01-verification";

/**
 * `onReceived` sends the HTTP response the instant the request is accepted,
 * before a single downstream node (Normalize Ticket, the OpenAI call, the
 * policy gates, ...) has run — so there is no case data in existence yet for
 * the response to leak. The workflow still runs to completion afterward
 * (audit rows, Zendesk updates); only what goes back over THIS connection
 * changes. Contrast `lastNode`, which is what disclosed the record.
 */
export const RESPONSE_MODE = "onReceived";

/**
 * The n8n Webhook node's OWN default for `responseMode`, which is the same
 * value this spec wants. That coincidence is a trap, and it cost a live
 * false alarm on 2026-08-27.
 *
 * n8n's editor PRUNES any parameter equal to the node default before saving,
 * so a node configured to "Immediately" THROUGH THE UI stores no
 * `responseMode` key at all — exactly the shape this file is trying to
 * enforce. Comparing `p.responseMode` against RESPONSE_MODE directly then
 * reports a CORRECT node as defective, with a message naming the F-4
 * disclosure as open while it is in fact closed.
 *
 * It stayed hidden until now because every one of the nine webhook nodes had
 * only ever been written by an API `PUT` (scripts/deploy-uc01-webhook-fix-
 * disclosure.mjs), which stores values verbatim and prunes nothing. The first
 * hand edit in the n8n editor changed the stored shape on all nine at once.
 *
 * So: ABSENT MEANS DEFAULT, never "unset". Read through this constant.
 */
export const RESPONSE_MODE_NODE_DEFAULT = "onReceived";

/**
 * A fixed string, not an expression — it must never be able to interpolate
 * anything from the incoming request or from a node output. `noResponseBody`
 * (empty 200) would also close the disclosure; a minimal literal ack is kept
 * instead so a caller polling for the request to have been accepted (a retry
 * harness, a future health check) still gets a real 200 body to key off.
 */
export const RESPONSE_DATA = '{"status":"received"}';

/**
 * Node-type-specific check for `structuralNodeIssues()`
 * (scripts/lib/structuralNodeChecks.mjs): does the live node still accept
 * traffic on the same method/path, and does it respond WITHOUT echoing any
 * node output?
 *
 * @param {object} node the live "Zendesk Ticket Webhook" node
 * @returns {string[]} issue descriptions; empty means the params match
 */
export function webhookResponseParamIssues(node) {
  const issues = [];
  const p = node?.parameters ?? {};

  if (p.httpMethod !== HTTP_METHOD) {
    issues.push(`httpMethod is ${JSON.stringify(p.httpMethod)}, expected ${JSON.stringify(HTTP_METHOD)}`);
  }
  if (p.path !== PATH) {
    issues.push(`path is ${JSON.stringify(p.path)}, expected ${JSON.stringify(PATH)}`);
  }
  // `?? RESPONSE_MODE_NODE_DEFAULT` — see that constant. An absent key is the
  // n8n editor having pruned a default-valued parameter, NOT an unset one.
  const responseMode = p.responseMode ?? RESPONSE_MODE_NODE_DEFAULT;
  if (responseMode !== RESPONSE_MODE) {
    issues.push(
      `responseMode is ${JSON.stringify(p.responseMode)} (effectively ${JSON.stringify(responseMode)}), ` +
        `expected ${JSON.stringify(RESPONSE_MODE)} — ` +
        `"lastNode" is the disclosure this spec exists to keep closed (F-4)`
    );
  }
  if (p.options?.responseData !== RESPONSE_DATA) {
    issues.push(`options.responseData is ${JSON.stringify(p.options?.responseData)}, expected ${JSON.stringify(RESPONSE_DATA)}`);
  }
  // The top-level `responseData` parameter only has meaning under
  // `responseMode: "lastNode"` (it picks allEntries/firstEntryJson/etc.). Its
  // presence here would be a leftover from a reverted edit, and worth naming
  // even though n8n itself ignores it under "onReceived".
  if (p.responseData !== undefined) {
    issues.push(`top-level responseData is set (${JSON.stringify(p.responseData)}) — a leftover from "lastNode" mode, should be absent`);
  }

  return issues;
}
