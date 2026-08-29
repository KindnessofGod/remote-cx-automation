// ---------------------------------------------------------------------------
// carryContextForward.js — body of the "Carry Context Forward" n8n Code node
// ---------------------------------------------------------------------------
// Sits immediately after "Append Audit Log" (a Supabase insert whose own
// response replaces $json with the inserted row, not our decision context)
// and restores that context for everything downstream — Assign Routing,
// Route by Decision, both letter renderers, and every Zendesk node on every
// branch.
//
// rca-uim / DRIFT-086: this node now ALSO carries `caseId` forward — the id
// Postgres assigned to the row "Persist Case" wrote, three nodes upstream.
// Nothing between here and there exposes it: "Carry Context After Records"
// discards "Persist Case"'s response the exact same way this node discards
// "Append Audit Log"'s. Without it, "Prepare Document" (on the auto_resolve
// branch, between "Render Letter" and "Reply + Solve Ticket") has no
// `documents.case_id` to write — a NOT NULL foreign key onto `cases.id`.
//
// n8n's Supabase row-create node returns the inserted row, not `{success:
// true}` — "Collect Trace Steps" relies on the identical fact to recover
// `audit_log.id` as `$('Append Audit Log').first().json.id`, and that FK
// (`audit_trace.parent_id`) is proven populated in production. So
// `$('Persist Case').first().json.id` is Postgres's real id for the row this
// execution just wrote, not a guess.
//
// `caseId` is read by NAME (`$('Persist Case')`), not from this node's own
// $json input, for the same reason the rest of this node already works that
// way: "Persist Case" ran earlier in this same execution regardless of which
// branch is live, so it is addressable, and reading it by name is immune to
// whatever "Append Audit Log"'s response shape happens to be.
// ---------------------------------------------------------------------------

return [
  {
    json: Object.assign({}, $('Identity + Policy Gates').first().json, {
      caseId: $('Persist Case').first().json.id ?? null,
    }),
  },
];
