// ---------------------------------------------------------------------------
// normalizeAmendmentRequest.js — body of the "Normalize Amendment Request" n8n Code node
// ---------------------------------------------------------------------------
// TWO intake shapes reach this node, and they are NOT interchangeable:
//
//  1. A structured amendment event (src/remoteui/ — the Remote-product
//     stand-in). The webhook payload IS the amendment form. src/uc06/
//     changeParser.js's own header explains why: an LLM must never be the
//     source of a salary figure that could reach a real payroll write, so
//     `changes` has to arrive already structured. This node maps and validates
//     presence; it invents nothing.
//
//  2. A raw Zendesk ticket webhook ({ticket:{id, subject, description,
//     custom_fields, requester}}). A ticket carries free text, NOT a
//     structured amendment. So `changes` is left DELIBERATELY EMPTY and the
//     session is left null — a Zendesk requester is an authenticated person,
//     but it is not an authenticated company-admin session, and UC-06's
//     identity gate matches session.companyId against the employment's
//     company_id. Both facts are absent, so the gates fail closed and the
//     request escalates to a human with an audit row and an internal note.
//     Nothing is parsed out of the ticket body into a payroll value, and no
//     write path opens: the real PATCH still only fires from
//     submitAmendmentApproval() once BOTH approval slots are filled.
//
// The employment id still comes from the ticket's custom field, never from a
// guess — same "refuse rather than guess" rule as UC-01's normalizeTicket.js.
// ---------------------------------------------------------------------------

// your-subdomain's "Remote Employment ID" custom field. The retired account's id
// (99900000000006) does not exist here — a stale value makes every inbound
// ticket throw at this node.
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

  // IDENTITY SOURCE. Read from the requester Zendesk itself authenticated,
  // NEVER from an email address typed into the ticket body — a claimed address
  // proves nothing. Recorded for the audit trail only; it is not promoted to a
  // company-admin session, so the identity gate still fails closed.
  const requesterEmail = zendeskTicket.requester?.email ?? zendeskTicket.via?.source?.from?.address ?? null;

  return [{
    json: {
      employmentId: String(employmentId),
      session: null,
      requesterEmail: requesterEmail ? String(requesterEmail).toLowerCase() : null,
      changes: {},
      requestedEffectiveDate: null,
      reasonText: [zendeskTicket.subject, zendeskTicket.description].filter(Boolean).join('\n\n'),
      externalRef: String(zendeskTicket.id),
      source: 'zendesk',
      intake: 'zendesk_unstructured',
      now: new Date().toISOString(),
    },
  }];
}

if (!raw.employmentId) {
  // rca-nr4i / D-22: name the reference when one was submitted, even though
  // employmentId (the very thing that would let a normal row identify this
  // request) is what is missing. Without this, the ops_alerts row this throw
  // produces carries a workflow name, a node and an n8n execution id, and
  // nothing that says WHICH request it was or who was waiting on it.
  throw new Error(
    'Amendment request' + (raw.externalRef ? ' (ref ' + raw.externalRef + ')' : '') +
    ' has no employmentId. Refusing to guess.'
  );
}
if (!raw.changes || typeof raw.changes !== 'object') {
  throw new Error('Amendment request has no structured changes. Refusing to parse free text into a payroll write.');
}
if (!raw.requestedEffectiveDate) {
  throw new Error('Amendment request has no requestedEffectiveDate.');
}

const session = raw.session && raw.session.companyId && raw.session.authenticatedAdminId
  ? { companyId: String(raw.session.companyId), authenticatedAdminId: String(raw.session.authenticatedAdminId) }
  : null;

const normalized = {
  employmentId: String(raw.employmentId),
  session,
  requesterEmail: null,
  changes: raw.changes,
  requestedEffectiveDate: String(raw.requestedEffectiveDate),
  reasonText: raw.reasonText ? String(raw.reasonText) : '',
  externalRef: raw.externalRef ? String(raw.externalRef) : null,
  source: raw.source ? String(raw.source) : 'webhook',
  intake: 'structured',
  now: new Date().toISOString(),
};

return [{ json: normalized }];
