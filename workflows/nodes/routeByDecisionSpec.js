// ---------------------------------------------------------------------------
// routeByDecisionSpec.js — the single versioned source of truth for the
// `Route by Decision` switch node on UC-01's live graph (WORKFLOW_UC01_ID)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (rca-vqe)
//
// `Route by Decision` is an n8n SWITCH node. Every other deployed-node check
// this repo has (`scripts/verify-deployed-nodes.mjs`'s MAPPINGS,
// `test/n8nParity.test.js`) works by diffing a `jsCode` string — a switch has
// none, so both were structurally blind to it, and nothing versioned its rule
// set anywhere in the repo either. rca-c73 found the live consequence: the
// switch had rules for 3 of the 7 decisions `workflows/nodes/gates.js` can
// emit, and the other three fell to the `Unrecognised Decision` fallback for
// as long as nobody happened to read the live graph by hand.
//
// This file is the ONE place the switch's rule set is written down as data,
// so two separate checks can each hold it against a different authority:
//
//   1. test/n8nRouteByDecisionParity.test.js (hermetic, no network) parses the
//      decision-value LITERALS out of workflows/nodes/gates.js and asserts
//      every one is either routed here (RULES) or explicitly named as
//      HANDLED_UPSTREAM_OF_SWITCH — so "a gate starts emitting a value
//      nothing routes" fails on every commit, with no n8n credentials at all.
//      This is the exact rca-c73 shape, caught the moment it recurs.
//   2. scripts/verify-deployed-nodes.mjs (live, needs N8N_API_KEY) reads the
//      LIVE `Route by Decision` node and its connections and asserts they
//      match RULES/FALLBACK below exactly — the compared decision string, the
//      output key, and which node each output actually reaches — so a hand
//      edit through the n8n UI or an MCP call that adds, removes or repoints
//      a rule fails a deploy check instead of surviving until a real customer
//      hits the fallback.
//
// `out_of_scope` is the one gates.js decision this switch never sees at all:
// rca-1bk intercepted it with an `Out of Scope?` IF node, and it is listed in
// HANDLED_UPSTREAM_OF_SWITCH rather than RULES so check 1 above does not
// misreport it as unrouted, and so a REGRESSION — someone routing it through
// the switch after all, or removing the IF branch without adding a switch
// rule for it — is still visible: either shape leaves `out_of_scope` absent
// from both RULES and a correct upstream note, which fails loudly rather than
// silently degrading to "unrecognised".
//
// **The branch's POSITION relative to `Claim Ticket (Idempotency)` moved
// after rca-1bk shipped it, and this is the second time that history
// matters.** rca-1bk originally placed `Out of Scope?` BEFORE every durable
// write, including the claim — see
// qa/handoffs/UC-01/0004-rca-1bk-out-of-scope-branch.md. That left
// `out_of_scope` with no idempotency barrier at all, and a redelivered
// Zendesk trigger (real tickets #86/#91, F-3) replayed the whole branch on
// every redelivery — 21 and 17 identical public replies, stopped only by
// Zendesk's own HTTP 429. rca-qdc (commit 93884e7) moved `Out of Scope?` to
// sit AFTER `Claim Ticket (Idempotency)`/`Carry Context After Claim` instead
// — see qa/handoffs/UC-01/0008-rca-qdc-out-of-scope-loop.md — so a
// redelivery now dies at `Duplicate Delivery — Stop` like every other
// decision, and added a `uc01_out_of_scope_replied` tag on `Reply Out of
// Scope` as a second, independent guard (the live Zendesk trigger's
// single-fire condition excludes it). Proven live on ticket #92: exactly one
// execution, one `workflow_claims` row, one reply. **Reverting to the
// pre-rca-qdc ordering reintroduces F-3 — do not move this branch ahead of
// the claim node again.**
// ---------------------------------------------------------------------------

/**
 * Ordered: the index of an entry in this array IS the switch's output index
 * (0-based) — n8n Switch nodes evaluate rules in array order and this is the
 * same order `RULES.map(...)` must produce when comparing against the live
 * `connections["Route by Decision"].main` array.
 */
export const RULES = [
  { decision: "auto_resolve", target: "Fetch Legal Entity (Remote)" },
  { decision: "human_review", target: "Flag for Specialist Review" },
  { decision: "escalate", target: "Escalate Ticket" },
  { decision: "blocked", target: "Prepare Refusal Reply" },
  { decision: "awaiting_employee_consent", target: "Prepare Refusal Reply" },
  { decision: "deflected_to_self_service", target: "Prepare Refusal Reply" },
];

/**
 * The switch's own `options` block (`fallbackOutput`/`renameFallbackOutput`),
 * plus the node the renamed fallback output actually reaches — this is the
 * `Unrecognised Decision` internal-note hand-off, and it is where a decision
 * with neither a RULES entry nor an upstream intercept silently lands today.
 */
export const FALLBACK = {
  fallbackOutput: "extra",
  outputKey: "unrecognised",
  target: "Unrecognised Decision",
};

/**
 * Decisions gates.js can emit that never reach this switch at all, because
 * something upstream intercepts them first. Each entry names the node that
 * does the intercepting and why, so a reader — or a future check — can go
 * verify it directly rather than trust this comment.
 */
export const HANDLED_UPSTREAM_OF_SWITCH = {
  out_of_scope: {
    via: "Out of Scope?",
    note:
      "rca-1bk (VC-11/D3) built the branch; rca-qdc (F-3, commit 93884e7) " +
      "moved it downstream of Claim Ticket (Idempotency)/Carry Context " +
      "After Claim so a redelivery dies at Duplicate Delivery — Stop " +
      "instead of posting another reply, and added the " +
      "uc01_out_of_scope_replied tag as a second guard. Never reaches " +
      "Route by Decision, on purpose — see " +
      "qa/handoffs/UC-01/0004-rca-1bk-out-of-scope-branch.md and " +
      "qa/handoffs/UC-01/0008-rca-qdc-out-of-scope-loop.md.",
  },
};

export const SWITCH_NODE_NAME = "Route by Decision";
