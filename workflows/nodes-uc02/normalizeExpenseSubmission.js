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
// CURRENT Zendesk account (`your-subdomainhelp`, migrated 2026-08-29). Neither
// retired account's id (99900000000006, then 9990000000001) exists here — using it makes every
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
  //
  // WIDENED 2026-08-29. This used to accept ONLY `expense id: X` / `expense #X`
  // and an `exp_`/`expense-` prefixed token. A real employee writing the most
  // natural sentence there is — "please review my expense claim
  // 724ffc63-98f8-..." — was refused, because "claim" is not "id". Measured on
  // live ticket 13, which named a genuine Sandbox expense and was still turned
  // away.
  //
  // WHY WIDENING IS SAFE, and it is worth being precise because loosening an
  // identifier match usually is not. Naming the wrong expense CANNOT approve
  // anything: "this expense belongs to this employment" is re-proved downstream
  // against the authoritative Remote record, and an id that resolves to someone
  // else's expense — or to nothing — is refused there. So the cost of a false
  // positive is a refusal with a slightly less precise reason, while the cost of
  // a false NEGATIVE is a real employee being told their claim does not name a
  // claim. Those are not symmetric.
  //
  // The ONE thing that must never happen is picking up the EMPLOYMENT id, which
  // is a UUID sitting in the same ticket and would send the ownership gate a
  // record id of the wrong kind. It is excluded explicitly at every tier below
  // rather than hoped away.
  const notTheEmployment = (v) => v && String(v).toLowerCase() !== String(employmentId).toLowerCase();

  // TIER 1 — an EXPLICIT label. Preferred, and the only tier allowed to settle
  // a ticket that names more than one id: "Expense ID: X" is a person telling
  // us which one they mean, which is exactly the signal ambiguity lacks.
  const explicit = text.match(
    /\b(?:expense|claim|reimbursement)\s*(?:id|no\.?|number|ref(?:erence)?|#)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{4,})\b/i
  );

  // TIER 2 — a self-identifying token, e.g. `exp_123`, `expense-9af`.
  const token = text.match(/\b((?:exp|expense)[_-][A-Za-z0-9_-]+)\b/i);

  // TIER 3 — the natural sentence, e.g. "my expense claim <id>". One of those
  // nouns, up to four filler words, then the id.
  //
  // THE CANDIDATE MUST LOOK LIKE AN ID, NOT MERELY BE LONG. An earlier draft of
  // this accepted `[A-Za-z0-9][A-Za-z0-9_-]{7,}`, and on "Expense claim / My
  // employment id is ..." it extracted the WORD "employment" — any English word
  // of eight letters matched. A candidate must now be a UUID, or contain a
  // digit and be at least eight characters, which no ordinary word is.
  const ID_SHAPE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9][A-Za-z0-9_-]{7,}';
  const nearby = text.match(new RegExp('\\b(?:expense|claim|reimbursement)\\b(?:\\s+\\w+){0,4}\\s+(' + ID_SHAPE + ')\\b', 'i'));

  // TIER 4 — a bare id with no noun at all.
  const bare = [...new Set((text.match(new RegExp('\\b(?:' + ID_SHAPE + ')\\b', 'gi')) || [])
    .map((u) => u.toLowerCase()))].filter(notTheEmployment);

  // AMBIGUITY IS REFUSED, NOT RESOLVED — and this is checked ACROSS the tiers
  // rather than inside the last one. The subject and the description are
  // matched as one string, so a noun in the subject ("Expense claim") can reach
  // a number in the description; without this, a ticket naming two different
  // ids had the first one picked by tier 3 while tier 4 would rightly have
  // refused. Guessing which claim someone meant is a money risk.
  //
  // An explicit label (tier 1) or a self-identifying token (tier 2) overrides
  // this, because both are the requester naming one id on purpose.
  const labelled = [explicit && explicit[1], token && token[1]].find(notTheEmployment) || null;
  const expenseId = labelled
    || (bare.length > 1 ? null : [nearby && nearby[1], bare.length === 1 ? bare[0] : null].find(notTheEmployment) || null);

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
