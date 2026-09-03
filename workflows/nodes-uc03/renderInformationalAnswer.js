// ---------------------------------------------------------------------------
// renderInformationalAnswer.js — body of the "Render Informational Answer"
// n8n Code node on UC-03's graph (WORKFLOW_UC03_ID)
// ---------------------------------------------------------------------------
// THIS IS THE ONLY TEXT ON THIS GRAPH THAT A CUSTOMER READS. Everything else
// UC-03 writes to Zendesk is an internal note. It is handed to
// "Reply + Solve Ticket" as `informationalAnswer` and posted with the Zendesk
// node's `publicReply`.
//
// WHY THIS FILE EXISTS AT ALL. Until 2026-08-31 this node's body lived ONLY on
// the live graph — it had no file, so `scripts/lib/deployedNodeMappings.mjs`'s
// MAPPINGS could not diff it and `scripts/lib/unguarded-node-baseline.json`
// carried it as accepted debt. The customer-facing sentence below was therefore
// the least-checked string in the whole project, and it was WRONG:
//
//     "If you need a formal travel support letter (for a visa application or
//      port-of-entry), reply to this ticket and a specialist will review and
//      issue it."
//
// A REPLY TO THIS TICKET PRODUCES NOTHING. The graph claims
// `(UC-03, <ticket id>)` in `workflow_claims` before its first durable write,
// so a reply that re-triggers it is a duplicate delivery and stops silently at
// `Duplicate Delivery — Stop`. `docs/use-cases/UC-03.md` §"What was built"
// already quotes this sentence and calls it "advice to do the one thing that
// produces nothing" — it had been quoted as a defect in the documentation for
// longer than it took to fix, because nothing read the node.
//
// --- WHY THIS DOES NOT SAY WHAT src/uc03/letter.js SAYS ---------------------
//
// `renderInformationalAnswer()` in `src/uc03/letter.js` now closes with the
// OPPOSITE promise: accept the travel-letter offer on this request and the
// letter "is written and issued to you straight away". That is TRUE ON THE NODE
// / PORTAL PATH and UNBACKABLE HERE, and the difference is structural rather
// than a wording drift:
//
//   * Accepting the offer is `POST /api/cases/:id/request-letter`. It needs a
//     `cases` row to name.
//   * THIS GRAPH WRITES NO `cases` ROW. Its only durable writes are
//     `audit_log`, `workflow_claims` and `audit_trace` (read live off
//     WORKFLOW_UC03_ID on 2026-08-31 — three Supabase nodes, no more). So there
//     is no case id to post to, and `GET /uc03/api/cases/by-ticket/:ref`
//     answers `{"found": false}` for every ticket this graph decides.
//   * This graph also has no letter-render node, so even a decision of
//     `standard_letter_issued` produces no document here.
//
// Copying src's sentence would therefore replace one false promise with
// another — a customer told the letter is already on its way, on a path that
// wrote nothing. THE TWO PATHS MUST DIFFER ON THIS ONE PARAGRAPH, and this
// comment is here so the next reader does not "fix" the divergence by
// harmonising them. Everything ABOVE that paragraph is kept in step with
// `src/uc03/letter.js` deliberately.
//
// --- PLAIN TEXT, AND IT MUST STAY PLAIN TEXT -------------------------------
//
// The Zendesk node's `publicReply` is PLAIN TEXT and SILENTLY ESCAPES HTML.
// UC-01 was burned by exactly this: a rendered letter went out as literal
// `&lt;!doctype html&gt;…` on a fully "successful" run that delivered garbage
// to the customer, visible nowhere in n8n's status (CLAUDE.md §4, "Live
// resources"). `internalNote`'s sibling is the field documented as accepting
// HTML; `publicReply` is not. So: no tags, no entities, no markdown that
// depends on rendering. `test/n8nUc03TerminalZendeskNodes.test.js` asserts the
// rendered body contains no HTML tag.
//
// It also asserts the body carries no harness vocabulary
// (`src/zendesk/ticketHygiene.js`) — bead ids and criterion ids must never
// reach a real customer, and this is the one string on this graph that goes to
// one.
//
// PURE, AND IT DECIDES NOTHING. It reads a decision already made and renders
// prose. It cannot change what was decided, and it must never throw: an n8n
// Code node that throws aborts the branch, and this one sits AFTER the audit
// write but BEFORE the customer ever hears anything.
// ---------------------------------------------------------------------------

// Mirrors src/uc03/letter.js's renderInformationalAnswer() + withDisclaimer(..., "travel").
// AUTO path only: plain text, zero-touch, deterministic. No compensation, no
// legal conclusion -- entry requirements are the destination authority's to set.
const ctx = $('Travel Router Gates').first().json;
const c = ctx.classification;

const COUNTRY_NAMES = {
  ES: 'Spain', DE: 'Germany', FR: 'France', PT: 'Portugal', IT: 'Italy',
  NL: 'Netherlands', IE: 'Ireland', PL: 'Poland', GB: 'United Kingdom',
  US: 'United States', CA: 'Canada', IN: 'India', PH: 'Philippines',
  MX: 'Mexico', NG: 'Nigeria', EE: 'Estonia',
};
const destination = COUNTRY_NAMES[c.destinationCountry] || c.destinationCountry;
const windowStr = c.startDate && c.endDate ? (c.startDate + ' to ' + c.endDate) : null;
const durationLine = ctx.durationDays ? ' (' + ctx.durationDays + ' days)' : '';

const TRAVEL_DISCLAIMER = 'This is general information only and not legal or immigration advice. Entry requirements are set by the destination country and can change; please confirm current rules before you travel.';

// THE PARAGRAPH THIS FILE EXISTS FOR. Three claims, each of which is true of
// THIS execution path and checkable:
//   1. a formal travel letter is a SEPARATE REQUEST, not a reply here;
//   2. a reply to this ticket does not start one -- the ticket is already
//      recorded as handled, and the graph's own idempotency claim means a
//      re-trigger stops at `Duplicate Delivery -- Stop`;
//   3. where to raise it -- Remote's own Request Hub, which is the surface
//      src/uc03/workflow.js and src/uc03/signoffPolicy.js already name to the
//      specialist for the sibling UC-04 hand-off.
// It promises no timeline, names no individual reviewer, and does not say a
// specialist "will issue it" -- on this path nobody has been told anything.
const LETTER_PARAGRAPH = 'If you need a formal travel support letter for this trip (for a visa appointment or a port-of-entry check), it is a separate request rather than a reply here. This ticket has already been recorded as answered, so replying to it does not start a letter request. Raise one in Remote\'s Request Hub and it is handled on its own.';

const body = 'Thank you for your inquiry about business travel to ' + destination + (windowStr ? ', ' + windowStr : '') + durationLine + '.\n\n' +
  'Based on the details of your request, here is a summary:\n' +
  '  - Destination: ' + destination + ' (' + c.destinationCountry + ')\n' +
  (windowStr ? '  - Travel period: ' + windowStr + '\n' : '') +
  '  - Duration: ' + (ctx.durationDays ? ctx.durationDays + ' days' : 'not stated') + '\n\n' +
  'Short-term business travel of this kind requires no additional action on the Remote platform. Entry requirements for the destination country vary and are set by its authorities -- please confirm current visa and entry rules before you travel.\n\n' +
  LETTER_PARAGRAPH + '\n\n---\n' + TRAVEL_DISCLAIMER;

return [{ json: { ...ctx, informationalAnswer: body } }];
