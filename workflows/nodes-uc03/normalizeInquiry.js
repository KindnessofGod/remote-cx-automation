// ---------------------------------------------------------------------------
// normalizeInquiry.js — body of UC-03's "Normalize Inquiry" n8n Code node
// ---------------------------------------------------------------------------
// TWO INTAKE SHAPES, one normalized output:
//   1. A Zendesk webhook ticket — {ticket:{id, subject, description,
//      custom_fields:[{id,value}], requester:{email}}}. The real inbound
//      support channel.
//   2. The direct API shape ({employmentId, text, session, externalRef}) used
//      by the Remote-product-side submission and every existing dry-run.
//
// Throws rather than defaulting when the Remote employment id is missing — an
// unidentifiable travel inquiry must never proceed automatically.
//
// FIELD ID 9990000000001 is the "Remote Employment ID" custom field on the
// CURRENT Zendesk account (`your-subdomainhelp`, migrated 2026-08-29). Neither
// retired account's id (99900000000006, then 9990000000001) exists here.
// ---------------------------------------------------------------------------

const EMPLOYMENT_FIELD_ID = 9990000000001;

const raw = $input.first().json.body ?? $input.first().json;
const ticket = raw.ticket ?? null;

let normalized;
if (ticket) {
  const customFields = ticket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === EMPLOYMENT_FIELD_ID);
  const employmentId = employmentField?.value;
  if (!employmentId) {
    throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
  }
  // IDENTITY SOURCE. A Zendesk ticket carries no Remote session, so we use the
  // next-best authenticated signal: the requester Zendesk itself authenticated.
  // Read from the ticket's requester object, NEVER from an email address typed
  // into the ticket body — a claimed address proves nothing. Travel Router
  // Gates matches it against the Remote record and fails closed on any gap.
  const requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;
  normalized = {
    employmentId: String(employmentId),
    session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
    text: [ticket.subject, ticket.description].filter(Boolean).join('\n\n'),
    externalRef: String(ticket.id),
    source: 'zendesk',
  };
} else {
  const body = raw;
  if (!body.employmentId) {
    throw new Error('Travel inquiry has no employmentId. Refusing to guess.');
  }
  normalized = {
    employmentId: String(body.employmentId),
    session: body.session && body.session.authenticatedEmploymentId
      ? { authenticatedEmploymentId: String(body.session.authenticatedEmploymentId) }
      : null,
    text: String(body.text ?? ''),
    externalRef: body.externalRef ? String(body.externalRef) : null,
    source: body.source ? String(body.source) : 'webhook',
  };
}

const systemPrompt = 'You classify employee business-travel / workation inquiries for an Employer-of-Record platform. The key routing question is NOT duration: it is whether the employee will actively perform their normal job duties while physically present in the destination country. NO -> business_travel. YES -> work_authorization. Return ONLY JSON: {"intent":"business_travel"|"work_authorization","destinationCountry":string|null (ISO 3166-1 alpha-2),"startDate":string|null ("YYYY-MM-DD"),"endDate":string|null ("YYYY-MM-DD"),"formalLetterRequested":boolean,"confidence":number (0-1)}. formalLetterRequested is true only when the employee explicitly asks for a formal travel letter (also called a travel support letter) / invitation / visa letter.';

return [{
  json: {
    ...normalized,
    openaiBody: {
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: normalized.text },
      ],
    },
  },
}];
