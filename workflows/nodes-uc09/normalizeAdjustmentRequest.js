// ---------------------------------------------------------------------------
// normalizeAdjustmentRequest.js — body of the "Normalize Adjustment Request"
// n8n Code node
// ---------------------------------------------------------------------------
// TWO INPUT SHAPES, one output shape:
//   (a) a REAL Zendesk webhook body — {ticket: {id, subject, description,
//       custom_fields: [{id, value}], requester: {email}}}. Until 2026-08-15
//       this node could only read a flat `body.employmentId`, so every inbound
//       ticket threw "Refusing to guess" at the very first node and nothing
//       downstream ever ran. Mirrors workflows/nodes/normalizeTicket.js.
//   (b) the flat structured shape the Remote-product/API callers post, which
//       carries `adjustmentRequest` (already Remote-scaled) and a real Remote
//       session.
//
// IDENTITY, and why a Zendesk-sourced request is deliberately left unverified:
// policyEngine.js's identity gate is `session.companyId === employment.
// company_id`. A Zendesk ticket carries no Remote company id — only the email
// address Zendesk itself authenticated. That email is recorded as the actor,
// but it does NOT satisfy the company-match gate, so a ticket-sourced
// adjustment escalates as `identity_not_verified` instead of being offered an
// approval path. That is the fail-closed outcome, not a gap to patch: deriving
// the company id from the employment record we are about to gate against would
// be self-verifying identity. The trusted path for a payment figure remains a
// structured submission from the Remote product.
//
// Never reads an email address out of the ticket body — a claimed address
// proves nothing.
// ---------------------------------------------------------------------------

// "Remote Employment ID" custom field on the LIVE `your-subdomain` account.
// The retired account's id (99900000000006) does not exist here.
const EMPLOYMENT_FIELD_ID = 9990000000001;

const body = $input.first().json.body ?? $input.first().json;
const zTicket = body.ticket ?? (body.custom_fields || body.requester ? body : null);

let employmentId;
let requestText;
let adjustmentRequest;
let reasonText;
let externalRef;
let source;
let session;

if (zTicket) {
  const customFields = zTicket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === EMPLOYMENT_FIELD_ID);
  employmentId = employmentField && employmentField.value ? String(employmentField.value) : null;
  if (!employmentId) {
    throw new Error('Ticket ' + zTicket.id + ' has no Remote employment id. Refusing to guess.');
  }
  requestText = [zTicket.subject, zTicket.description].filter(Boolean).join('\n\n');
  if (!requestText.trim()) {
    throw new Error('Ticket ' + zTicket.id + ' has no request text. Refusing to guess.');
  }
  adjustmentRequest = null;
  reasonText = '';
  externalRef = zTicket.id !== undefined && zTicket.id !== null ? String(zTicket.id) : null;
  source = 'zendesk';
  const requesterEmail = zTicket.requester?.email ?? zTicket.via?.source?.from?.address ?? null;
  session = requesterEmail
    ? {
        authenticatedEmail: String(requesterEmail).toLowerCase(),
        // Explicitly null, not omitted: the company-match gate must see a
        // missing company id and fail closed.
        companyId: null,
        authenticatedAdminId: null,
      }
    : null;
} else {
  if (!body.employmentId) {
    throw new Error('Adjustment request has no employmentId. Refusing to guess.');
  }
  if (!body.adjustmentRequest && !(body.requestText && String(body.requestText).trim())) {
    throw new Error('Adjustment request has neither a structured adjustmentRequest nor requestText. Refusing to guess.');
  }
  employmentId = String(body.employmentId);
  requestText = body.requestText ? String(body.requestText) : '';
  adjustmentRequest = body.adjustmentRequest ?? null;
  reasonText = body.reasonText ? String(body.reasonText) : '';
  externalRef = body.externalRef ? String(body.externalRef) : null;
  source = body.source ? String(body.source) : 'webhook';
  session = body.session && body.session.companyId && body.session.authenticatedAdminId
    ? { companyId: String(body.session.companyId), authenticatedAdminId: String(body.session.authenticatedAdminId) }
    : null;
}

return [{
  json: {
    employmentId,
    session,
    adjustmentRequest,
    requestText,
    reasonText,
    externalRef,
    source,
    now: new Date().toISOString(),
  },
}];
