// ---------------------------------------------------------------------------
// normalizeExpenseSubmission.js — body of UC-02's "Normalize Expense
// Submission" n8n Code node
// ---------------------------------------------------------------------------
// TWO INTAKE SHAPES, one normalized output:
//   1. A Zendesk webhook ticket — {ticket:{id, subject, description,
//      attachments, custom_fields:[{id,value}], requester:{email}}}. This is
//      the real inbound support channel.
//   2. The direct API shape ({expenseId, employmentId, session, ...}) that the
//      Remote-product-side submission and every existing test/dry-run uses.
//
// Throws rather than defaulting whenever a required identifier is missing. An
// expense whose employee or expense record cannot be established must
// never proceed automatically — guessing is a money risk, not a convenience.
//
// FIELD ID 9990000000001 is the "Remote Employment ID" custom field on the
// CURRENT Zendesk account (`your-subdomain`, created 2026-08-15). The retired
// account's id (99900000000006) does not exist here — using it makes every
// inbound ticket throw at this node.
// ---------------------------------------------------------------------------

const EMPLOYMENT_FIELD_ID = 9990000000001;

const raw = $input.first().json.body ?? $input.first().json;
const ticket = raw.ticket ?? null;

if (ticket) {
  const customFields = ticket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === EMPLOYMENT_FIELD_ID);
  const employmentId = employmentField?.value;
  if (!employmentId) {
    throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
  }

  const text = [ticket.subject, ticket.description].filter(Boolean).join('\n\n');

  // WHICH expense. A Zendesk ticket carries no expense-id custom field, so the
  // id is read from the ticket text — a resource reference, NOT an identity
  // expense: the "expense belongs to this employment" gate downstream still
  // proves ownership against the authoritative Remote record, so naming
  // someone else's expense id cannot approve it. No id at all means refuse.
  const explicit = text.match(/\bexpense\s*(?:id|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,})\b/i);
  const token = text.match(/\b((?:exp|expense)[_-][A-Za-z0-9_-]+)\b/i);
  const expenseId = explicit ? explicit[1] : token ? token[1] : null;
  if (!expenseId) {
    throw new Error('Ticket ' + ticket.id + ' names no expense id. Refusing to guess.');
  }

  // IDENTITY SOURCE. A Zendesk ticket carries no Remote session, so we use the
  // next-best authenticated signal: the requester Zendesk itself authenticated.
  // Read from the ticket's requester object, NEVER from an email address typed
  // into the ticket body — a claimed address proves nothing. Expense Gates
  // matches it against the Remote record and fails closed if either side is
  // missing.
  const requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;

  return [{
    json: {
      expenseId: String(expenseId),
      employmentId: String(employmentId),
      session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
      receiptHash: null,
      hasAttachment: Boolean(ticket.attachments?.length),
      externalRef: String(ticket.id),
      source: 'zendesk',
    },
  }];
}

const body = raw;
if (!body.expenseId) {
  throw new Error('Expense submission has no expenseId. Refusing to guess.');
}
if (!body.employmentId) {
  throw new Error('Expense submission has no employmentId. Refusing to guess.');
}
const session = body.session && body.session.authenticatedEmploymentId
  ? { authenticatedEmploymentId: String(body.session.authenticatedEmploymentId) }
  : null;
return [{ json: {
  expenseId: String(body.expenseId),
  employmentId: String(body.employmentId),
  session,
  receiptHash: body.receiptHash ? String(body.receiptHash) : null,
  externalRef: body.externalRef ? String(body.externalRef) : null,
  source: body.source ? String(body.source) : 'webhook',
} }];
