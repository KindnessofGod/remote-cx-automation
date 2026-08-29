// ---------------------------------------------------------------------------
// normalizeInquiry.js — body of the "Normalize Inquiry" n8n Code node
// ---------------------------------------------------------------------------
// Pure mapping from the webhook payload to UC-08's internal ticket shape,
// plus the request body for the one LLM call (inquiry-type + jurisdiction
// labeling — never a residency/withholding/coverage conclusion, per
// src/uc08/inquiryParser.js's own header).
//
// TWO INPUT SHAPES, one output shape:
//   (a) a REAL Zendesk webhook body — {ticket: {id, subject, description,
//       custom_fields: [{id, value}], requester: {email}}}. Until 2026-08-15
//       this node could not read that shape at all: it looked for a flat
//       `body.text`/`body.employmentId`, so an inbound ticket produced an
//       empty inquiry with a null employment id and the dossier was built
//       from nothing. Mirrors workflows/nodes/normalizeTicket.js (UC-01).
//   (b) the flat structured shape used by the Remote-side/API callers, which
//       also carries the presence periods and evaluation window Zendesk has
//       no field for.
//
// Throws rather than defaulting when a Zendesk-sourced ticket carries no
// Remote employment id — same "refuse rather than guess" rule as UC-01.
// ---------------------------------------------------------------------------

// "Remote Employment ID" custom field on the LIVE `your-subdomain` account.
// The retired account's id (99900000000006) does not exist here.
const EMPLOYMENT_FIELD_ID = 9990000000001;

const body = $input.first().json.body ?? $input.first().json;
const ticket = body.ticket ?? (body.custom_fields || body.requester ? body : null);

let text;
let employmentId;
let externalRef;
let source;
let requesterEmail;

if (ticket) {
  const customFields = ticket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === EMPLOYMENT_FIELD_ID);
  employmentId = employmentField && employmentField.value ? String(employmentField.value) : null;
  if (!employmentId) {
    throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
  }
  text = [ticket.subject, ticket.description].filter(Boolean).join('\n\n');
  externalRef = ticket.id !== undefined && ticket.id !== null ? String(ticket.id) : null;
  source = 'zendesk';
  // IDENTITY SOURCE. A Zendesk ticket carries no Remote session, so the
  // next-best authenticated signal is the requester Zendesk itself
  // authenticated — NEVER an address typed into the ticket body.
  requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;
} else {
  text = String(body.text ?? '');
  employmentId = body.employmentId ? String(body.employmentId) : null;
  externalRef = body.externalRef ? String(body.externalRef) : null;
  source = body.source ? String(body.source) : 'webhook';
  requesterEmail = body.session?.authenticatedEmail ?? null;
}

const normalized = {
  text,
  employmentId,
  externalRef,
  source,
  session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
  presencePeriods: Array.isArray(body.presencePeriods) ? body.presencePeriods : [],
  targetCountry: body.targetCountry ? String(body.targetCountry) : null,
  windowStart: body.windowStart ? String(body.windowStart) : null,
  windowEnd: body.windowEnd ? String(body.windowEnd) : null,
};

const systemPrompt = 'You classify inbound cross-border tax/social-security inquiries for an Employer-of-Record platform.\nRead the ticket text and return ONLY a JSON object with exactly these fields:\n{\n  "inquiryType": "dual_residency" | "withholding" | "totalization" | "other",\n  "jurisdictions": string[]  // ISO 3166-1 alpha-2 country codes mentioned or clearly implied\n}\nRules:\n- You are labeling the REQUEST, not answering it. Never state a residency, withholding, or coverage conclusion.\n- "jurisdictions" should list only countries the text actually names or unambiguously implies.\nReturn strict JSON, no prose, no markdown fences.';

return [{
  json: {
    ...normalized,
    openaiBody: {
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: 'Ticket text:\n"""' + text + '"""' },
      ],
    },
  },
}];
