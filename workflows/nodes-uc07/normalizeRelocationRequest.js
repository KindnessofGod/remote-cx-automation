// ---------------------------------------------------------------------------
// normalizeRelocationRequest.js — body of the "Normalize Relocation Request" node
// ---------------------------------------------------------------------------
// UC-07 is 🔴: this graph compiles a research dossier and escalates. It has no
// execution path at all, so normalization is deliberately thin — nothing read
// here can ever reach a write.
//
// TWO intake shapes reach this node:
//
//  1. A raw Zendesk ticket webhook ({ticket:{id, subject, description,
//     custom_fields, requester}}) — the real inbound path. The employment id
//     comes from the ticket's Remote Employment ID custom field, never from a
//     guess (same rule as UC-01's normalizeTicket.js), and the dossier's free
//     text is subject + description.
//
//  2. A direct structured POST ({text, employmentId, externalRef, plan}) —
//     how src/uc07 and the test harness drive it.
//
// `plan` carries the structured relocation facts (dates, salary integers,
// confirmations). It is NEVER inferred from ticket free text: an invented
// destination start date would silently change a feasibility verdict. A
// Zendesk-originated request therefore arrives with an empty plan, which the
// gates surface as MISSING_TIMELINE / review flags rather than a false PROCEED.
// ---------------------------------------------------------------------------

// your-subdomain's "Remote Employment ID" custom field. The retired account's id
// (99900000000006) does not exist here.
const ZENDESK_EMPLOYMENT_FIELD_ID = 9990000000001;

const raw = $input.first().json.body ?? $input.first().json;
const zendeskTicket = raw.ticket && raw.ticket.id !== undefined ? raw.ticket : null;

if (zendeskTicket) {
  const customFields = zendeskTicket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === ZENDESK_EMPLOYMENT_FIELD_ID);
  const employmentId = employmentField?.value;
  if (!employmentId) {
    throw new Error('Ticket ' + zendeskTicket.id + ' has no Remote employment id. Refusing to guess.');
  }

  // IDENTITY SOURCE: the requester Zendesk itself authenticated, never an
  // address typed into the ticket body.
  const requesterEmail = zendeskTicket.requester?.email ?? zendeskTicket.via?.source?.from?.address ?? null;

  return [{
    json: {
      text: [zendeskTicket.subject, zendeskTicket.description].filter(Boolean).join('\n\n'),
      employmentId: String(employmentId),
      externalRef: String(zendeskTicket.id),
      source: 'zendesk',
      requesterEmail: requesterEmail ? String(requesterEmail).toLowerCase() : null,
      plan: {},
    },
  }];
}

return [{
  json: {
    text: String(raw.text ?? ''),
    employmentId: raw.employmentId ? String(raw.employmentId) : null,
    externalRef: raw.externalRef ? String(raw.externalRef) : null,
    source: raw.source ? String(raw.source) : 'webhook',
    requesterEmail: raw.requesterEmail ? String(raw.requesterEmail).toLowerCase() : null,
    plan: raw.plan && typeof raw.plan === 'object' ? raw.plan : {},
  },
}];
