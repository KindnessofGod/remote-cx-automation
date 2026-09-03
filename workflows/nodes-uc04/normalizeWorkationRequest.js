// ---------------------------------------------------------------------------
// normalizeWorkationRequest.js — body of UC-04's "Normalize Workation Request"
// n8n Code node
// ---------------------------------------------------------------------------
// Accepts BOTH intake shapes and normalizes them to the one internal shape the
// "Workation Gates" node already consumes:
//
//   A. Zendesk ticket webhook — { ticket: { id, subject, description,
//      attachments, custom_fields: [{id, value}], requester: { email } } }
//   B. Remote-native structured webhook — { employmentId, factors, ... }
//      (the original shape; behaviour unchanged)
//
// It lives as a real .js file for the reason documented on every other node
// body in this repo: a template literal inside the workflow builder collapses
// escapes silently, and a silently-broken normalizer routes every request to
// the wrong place while every execution stays green.
//
// RUNS INSIDE N8N'S SANDBOX: no imports, no network, no module system.
// ---------------------------------------------------------------------------

// The "Remote Employment ID" custom field on the CURRENT Zendesk account
// (your-subdomain). The retired account's field was 99900000000006 — carrying that
// id forward makes every inbound ticket throw at the first node.
const ZENDESK_EMPLOYMENT_FIELD_ID = 9990000000001;

const raw = $input.first().json.body ?? $input.first().json;
const ticket = raw.ticket ?? null;

if (ticket) {
  const customFields = ticket.custom_fields ?? [];
  const employmentField = customFields.find((f) => Number(f.id) === ZENDESK_EMPLOYMENT_FIELD_ID);
  const employmentId = employmentField ? employmentField.value : null;
  if (!employmentId) {
    // Same rule as UC-01's normalizeTicket.js: silently guessing which employee
    // a ticket is about is a disclosure risk, not a convenience.
    throw new Error('Ticket ' + ticket.id + ' has no Remote employment id. Refusing to guess.');
  }

  // IDENTITY SOURCE. A Zendesk ticket carries no Remote session, so we use the
  // next-best authenticated signal: the requester Zendesk itself authenticated.
  // NEVER an address typed into the ticket body — a claimed address proves
  // nothing. The gates node matches this against the email on the authoritative
  // Remote record and fails closed if either side is missing.
  const requesterEmail = ticket.requester?.email ?? ticket.via?.source?.from?.address ?? null;

  // FACTORS. A free-text ticket carries no structured visa / job-duty facts,
  // and this node will not infer them: an LLM deciding "is this a work permit?"
  // would make a model the SOURCE of a compliance fact, which prime directive #1
  // exists to prevent. Structured factors may ride alongside the ticket when an
  // intake form collected them; otherwise `{}` flows on and the deterministic
  // factor gate returns `blocked / factors_invalid` naming each missing factor.
  // That is a durable, audited decision plus a human-readable note — strictly
  // better than throwing here, which would leave no record of the request at all.
  const factors = raw.factors && typeof raw.factors === 'object' ? raw.factors : {};

  return [{
    json: {
      employmentId: String(employmentId),
      session: requesterEmail ? { authenticatedEmail: String(requesterEmail).toLowerCase() } : null,
      factors,
      travelHistory: Array.isArray(raw.travelHistory) ? raw.travelHistory : [],
      reasonText: [ticket.subject, ticket.description].filter(Boolean).join('\n\n'),
      externalRef: String(ticket.id),
      source: 'zendesk',
      now: raw.now ? String(raw.now) : new Date().toISOString(),
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
    'Workation request' + (body.externalRef ? ' (ref ' + body.externalRef + ')' : '') +
    ' has no employmentId. Refusing to guess.'
  );
}
if (!body.factors || typeof body.factors !== 'object') {
  throw new Error('Workation request has no structured factors. Refusing to guess visa/duty facts from free text.');
}
// SESSION. Two authenticated relationships reach this gate, and until
// 2026-08-30 this node could only express one of them.
//
// THE DEFECT THAT WAS FOUND BY DRIVING, NOT BY TESTING. `workationGates.js`
// gained an employee-subject leg — a traveller may file their own request, which
// is how Remote's own object works (`user` submits, `employer_approver`
// decides). The gate reads `session.authenticatedEmploymentId`. This node never
// built one, so it stripped the field on the way in and the new leg was DEAD IN
// PRODUCTION the moment it was deployed: present in the body, unreachable by any
// input. The parity test feeds the gates node a session directly, so the
// normalizer was never in the loop and nothing went red.
//
// Whitelisted field by field rather than passed through, because this object is
// the one thing downstream treats as authenticated: anything spread in here from
// a request body would be a claim wearing a session's clothes. Each id is kept
// only when it is a non-empty string, so a `null`/`""` can never meet another
// `null`/`""` at the gate and compare equal — the `null === null` shape that has
// already passed two identity gates in this repo.
const rawSession = body.session && typeof body.session === 'object' ? body.session : null;
const sessionId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const adminCompany = sessionId(rawSession && rawSession.companyId);
const adminId = sessionId(rawSession && rawSession.authenticatedAdminId);
const subjectEmployment = sessionId(rawSession && rawSession.authenticatedEmploymentId);

let session = null;
if (adminCompany && adminId) {
  // The company admin filing on an employee's behalf — the original shape,
  // unchanged, and still requiring BOTH halves.
  session = { companyId: adminCompany, authenticatedAdminId: adminId };
}
if (subjectEmployment) {
  // The employee filing about themselves. Additive: an admin session that also
  // carries a subject id keeps its company, and the gate tries both legs.
  session = { ...(session || {}), authenticatedEmploymentId: subjectEmployment };
}
return [{
  json: {
    employmentId: String(body.employmentId),
    session,
    factors: body.factors,
    travelHistory: Array.isArray(body.travelHistory) ? body.travelHistory : [],
    reasonText: body.reasonText ? String(body.reasonText) : '',
    externalRef: body.externalRef ? String(body.externalRef) : null,
    source: body.source ? String(body.source) : 'webhook',
    now: body.now ? String(body.now) : new Date().toISOString(),
  },
}];
