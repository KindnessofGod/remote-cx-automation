// ---------------------------------------------------------------------------
// carryContextAfterPersistDocument.js — body of the "Carry Context After
// Persist Document" n8n Code node
// ---------------------------------------------------------------------------
// rca-uim / DRIFT-086, found by the bead's OWN live proof (execution 6703,
// ticket #77): "Persist Document" is a Supabase row-create node, so — same
// as "Persist Case" and "Append Audit Log" before it — its output REPLACES
// $json with the inserted `documents` row (`{id, created_at, case_id, type,
// content, content_hash}`), not the decision context. Without this node,
// "Reply + Solve Ticket" read `$json.externalRef` and `$json.letterHtml` off
// THAT row — both absent — and posted with `id: undefined`. Zendesk refused
// the update ("id must be an integer"), which is what caught this: the
// document itself was written correctly (verified independently in
// Postgres — `content_hash` matches the stored `content` byte for byte),
// but had this update NOT been refused, the customer would have received a
// reply with an undefined/empty body. A real execution is what surfaced
// this; the hermetic parity tests below could not have, because they each
// exercise one node's `$input`/`$` in isolation and this bug is purely
// about what n8n threads BETWEEN two real nodes.
//
// Same restore pattern as "Carry Context After Claim" and "Carry Context
// After Records": read by NAME off the last node that actually held the
// full context, rather than off this node's own $json input.
// "Prepare Document" is that node — it received ctx (via "Render Letter" ->
// "Normalize Legal Entity" -> "Assign Routing" -> "Carry Context Forward")
// and returned `Object.assign({}, ctx, {documentType, documentContentHash})`,
// so everything "Reply + Solve Ticket" needs (`externalRef`, `letterHtml`)
// is still on it.
// ---------------------------------------------------------------------------

return [{ json: $('Prepare Document').first().json }];
