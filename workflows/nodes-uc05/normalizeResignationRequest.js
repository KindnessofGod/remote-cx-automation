// ---------------------------------------------------------------------------
// normalizeResignationRequest.js — body of UC-05's "Normalize Resignation
// Request" n8n Code node
// ---------------------------------------------------------------------------
// Accepts BOTH intake shapes and normalizes them to the one internal shape the
// "Notice Period Gates" node already consumes:
//
//   A. Zendesk ticket webhook — { ticket: { id, subject, description,
//      attachments, custom_fields: [{id, value}], requester: { email } } }
//   B. Remote-native structured webhook — { employmentId, letterText, ... }
//      (the original shape; behaviour unchanged)
//
// A resignation arriving as a Zendesk ticket is the NORMAL case for UC-05 — the
// subject + description ARE the resignation letter, which is exactly what the
// gates node's deterministic date extractor is built to read.
//
// RUNS INSIDE N8N'S SANDBOX: no imports, no network, no module system.
// ---------------------------------------------------------------------------

// The "Remote Employment ID" custom field on the CURRENT Zendesk account
// (your-subdomain). The retired account's field was 99900000000006.
const ZENDESK_EMPLOYMENT_FIELD_ID = 9990000000001;

// `now` MUST leave this node as a calendar day, never a full timestamp.
//
// This used to emit `new Date().toISOString()`. The downstream notice
// calculator treats a string `now` as already-normalised and feeds it straight
// into date arithmetic, so a timestamp reached fromIsoDate() and threw
// `Invalid YYYY-MM-DD date: 2026-08-16T13:05:20.171Z`, crashing the run.
//
// It only ever fired on the path where everything else succeeded -- verified
// identity, active employee, a start date present, and a country inside the
// 9-country table -- so every live resignation escalated at an earlier gate and
// never reached it. Normalising here is the right home for the fix regardless:
// this node's whole job is to hand downstream one clean internal shape, and
// "a date" is part of that shape. The calculator also guards itself now, in
// both copies, because two independent guards is the correct amount for a value
// that ends up as a legal date on an HR document.
function toCalendarDay(value) {
  if (value) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
    if (match) return match[1];
  }
  return new Date().toISOString().slice(0, 10);
}

const raw = $input.first().json.body ?? $input.first().json;
const ticket = raw.ticket ?? null;

if (ticket) {
  const customFields = ticket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === ZENDESK_EMPLOYMENT_FIELD_ID);
  const employmentId = employmentField ? employmentField.value : null;
  if (!employmentId) {
    throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
  }

  // IDENTITY SOURCE — the requester Zendesk itself authenticated, NEVER an
  // address in the letter text. A resignation letter is precisely the kind of
  // free text an impersonator controls end to end.
  const requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;

  return [{
    json: {
      employmentId: String(employmentId),
      session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
      // The ticket text IS the letter. The gates node extracts the proposed last
      // working day from it deterministically (ISO + long-form + US + short
      // formats) and compares it against the STATUTORY date it derives itself —
      // the extracted date is never the decision, only one side of a comparison.
      letterText: [ticket.subject, ticket.description].filter(Boolean).join('\n\n'),
      timeOffBalances: Array.isArray(raw.timeOffBalances) ? raw.timeOffBalances : [],
      currency: raw.currency ? String(raw.currency) : 'USD',
      proposedEndDate: raw.proposedEndDate ? String(raw.proposedEndDate) : null,
      reason: raw.reason ? String(raw.reason) : null,
      externalRef: String(ticket.id),
      source: 'zendesk',
      now: toCalendarDay(raw.now),
    },
  }];
}

// --- B. Remote-native structured webhook (original behaviour, unchanged) ----
const body = raw;
if (!body.employmentId) {
  // rca-nr4i / D-22: name the reference when one was submitted, even though
  // employmentId (the very thing that would let a normal row identify this
  // request) is what is missing. Without this, the ops_alerts row this throw
  // produces carries a workflow name, a node and an n8n execution id, and
  // nothing that says WHICH request it was or who was waiting on it.
  throw new Error(
    'Resignation request' + (body.externalRef ? ' (ref ' + body.externalRef + ')' : '') +
    ' has no employmentId. Refusing to guess.'
  );
}
const session = body.session && body.session.authenticatedEmploymentId
  ? { authenticatedEmploymentId: String(body.session.authenticatedEmploymentId) }
  : null;
return [{
  json: {
    employmentId: String(body.employmentId),
    session,
    letterText: body.letterText ? String(body.letterText) : '',
    timeOffBalances: Array.isArray(body.timeOffBalances) ? body.timeOffBalances : [],
    currency: body.currency ? String(body.currency) : 'USD',
    proposedEndDate: body.proposedEndDate ? String(body.proposedEndDate) : null,
    reason: body.reason ? String(body.reason) : null,
    externalRef: body.externalRef ? String(body.externalRef) : null,
    source: body.source ? String(body.source) : 'webhook',
    now: toCalendarDay(body.now),
  },
}];
