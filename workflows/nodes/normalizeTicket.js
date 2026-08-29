// ---------------------------------------------------------------------------
// normalizeTicket.js — body of the "Normalize Ticket" n8n Code node
// ---------------------------------------------------------------------------
// Mirrors src/zendesk/normalizeTicket.js: a pure mapping from a Zendesk ticket
// to this system's internal shape, plus the request body for the one LLM call.
//
// Throws rather than defaulting when the Remote employment id is missing. An
// unidentifiable verification request must never proceed automatically —
// silently guessing which employee a ticket is about is a disclosure risk, not
// a convenience.
// ---------------------------------------------------------------------------

// ACCOUNT-SPECIFIC. A custom-field id does not survive a Zendesk account
// change: this was 99900000000006 on the retired your-subdomain account, and that
// field does not exist at all on your-subdomain, so every ticket threw here. If
// this node starts refusing every ticket, check the field id before anything
// else. Must match ZENDESK_EMPLOYMENT_ID_FIELD_ID in the app's environment.
//
// This file held the retired id while the DEPLOYED node held the current one —
// drift in the opposite direction to the rest of this directory, and a reason
// to diff both ways rather than assuming the repo is always ahead.
const EMPLOYMENT_FIELD_ID = 9990000000001;
const body = $input.first().json.body ?? $input.first().json;
const ticket = body.ticket ?? body;
const customFields = ticket.custom_fields ?? [];
const employmentField = customFields.find((f) => Number(f.id) === EMPLOYMENT_FIELD_ID);
const employmentId = employmentField?.value;
if (!employmentId) {
  throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
}
const text = [ticket.subject, ticket.description].filter(Boolean).join('\n\n');

// IDENTITY SOURCE. A Zendesk ticket carries no Remote session, so we use the
// next-best authenticated signal: the requester Zendesk itself authenticated.
// Read from the ticket's requester object, NEVER from an email address typed
// into the ticket body — a claimed address proves nothing. gates.js matches it
// against the Remote record and fails closed if either side is missing.
const requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;

const normalized = {
  source: 'zendesk',
  externalRef: String(ticket.id),
  employmentId: String(employmentId),
  text,
  hasAttachment: Boolean(ticket.attachments?.length),
  session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
  // G-3/L-8: NO `consentOnRecord` FIELD HERE ANY MORE — this node runs
  // BEFORE the consent lookup, which is a Supabase node reading
  // `consent_records` that would sit between this node and "Identity +
  // Policy Gates" (see gates.js's own header for why it cannot be Code-node
  // logic). That node — not yet wired into this graph, see L-15/L-20 — is
  // what would populate `consentRecord` on the item gates.js reads. A ticket
  // that never reaches such a node simply carries no `consentRecord`, which
  // gates.js treats identically to "no matching row" — the safe (pending)
  // default.
};

// requestedFields is NOT optional here. The gates node routes an over-scope
// disclosure request (salary, manager name, home address, …) to a human, and
// that gate can only fire on a field the model was actually asked to produce —
// while this prompt omitted it, the gate was dead code in production and a
// ticket saying "include my salary" auto-resolved. The downstream validator
// now rejects a response without it (falling back to the rule-based
// classifier, which detects the fields deterministically), so the prompt and
// the validator have to agree. Mirrors SYSTEM_PROMPT in src/uc01/classifier.js.
// rca-1bk (found live, not by a fixture): this prompt's JSON schema offered
// only "standard_letter"|"non_standard" — "out_of_scope" was never a value the
// model was told it could return, so the real OpenAI call could not produce it
// no matter what the ticket said, and gates.js's out_of_scope branch (and the
// VC-11 fix wired in the same commit) was unreachable by any live LLM
// classification. Confirmed live: execution 6672/6673, real tickets #69/#70,
// text with zero employment content, model answered "non_standard" both times
// because that was the only non-standard option on offer. Brought back to
// parity with src/uc01/classifier.js's SYSTEM_PROMPT, which has always
// included it (VALID_INTENTS there was never the bug; this prompt was).
const systemPrompt = 'You classify employment-verification tickets for an Employer-of-Record platform. Return ONLY JSON: {"intent":"standard_letter"|"non_standard"|"out_of_scope","hasExternalUrl":boolean,"requesterType":"self"|"third_party","confidence":number,"requestedFields":["field_name",...]}. "intent" is "out_of_scope" if the text is not about employment verification at all (e.g. greetings, weather, password resets, expense claims, IT support) — be strict: only employment / proof of employment / verification letters stay in scope. requesterType is third_party ONLY when the SENDER is not the employee. An employee saying "my bank needs proof" is still self. requestedFields lists any fields the requester explicitly asks the letter to include beyond a standard verification letter, in lowercase snake_case — e.g. "salary", "compensation", "manager_name", "phone_number", "home_address", "ssn", "performance", "job_duties", "end_date", "working_hours". Return an empty array if none are asked for, but ALWAYS include the key.';

return [{ json: { ...normalized, openaiBody: { model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: normalized.text }] } } }];
