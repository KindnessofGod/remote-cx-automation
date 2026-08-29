// ---------------------------------------------------------------------------
// renderLetter.js — body of the "Render Letter" n8n Code node
// ---------------------------------------------------------------------------
// Mirrors src/uc01/letter.js. Only reached on the auto_resolve branch.
//
// The field list here is a hard whitelist, and that is the security control:
// compensation can never appear in a letter regardless of what a request asks
// for or what the classifier missed. Structural enforcement beats a text
// pattern check that has to notice the word "salary".
//
// BROUGHT UP TO letter.js's FACTS 2026-08-21 (L-16, DRIFT-085).
//
// Until then this node rendered FOUR rows — name, status, start date, contract
// type — where letter.js renders SEVEN, and the divergence was not cosmetic:
//   * no "is employed by <entity>" sentence, so the document asserted nothing
//     about who the employer is;
//   * no `Employer of Record` row at all;
//   * no `On probation` row, so a probationary employee's letter read exactly
//     like a confirmed one;
//   * no `Job title` row;
//   * the raw `contract_type` code printed verbatim, so a real Sandbox record
//     put `eor` in front of a bank instead of "Employer of Record (EOR)
//     employee", and an unrecognised code printed unmarked as if it were a
//     label.
//
// THIS NODE IS THE LIVE PATH. Every letter any real customer has received came
// from here, so the deployed graph was issuing the LESSER of the two documents
// while the repository's tests all exercised the fuller one. test/n8nParity's
// letter-fact comparison (L-1) now renders both from one fixture and compares
// the facts, so the two cannot drift again without a red test.
//
// It is a FACT comparison and not a byte comparison, deliberately: the markup
// legitimately differs (letter.js is a styled page for PDF rendering, this is
// a compact body posted as a Zendesk html_body), and demanding byte equality
// would force one of them to be wrong for its own medium.
//
// E4-F17 (rca-0nm) — the provenance sentence below now mirrors letter.js's
// `requestingParty` option, kept in parity even though THIS node currently
// never receives one: it is reached only on `auto_resolve` (this file's own
// first line), which is always the employee's own request — the
// `third_party_request` reason that DOES need the other sentence reaches
// `human_review`, and the third-party door that produces it is not
// trigger-driven at all (docs/…/FINDINGS.md's "Not defects" note). Ported
// anyway, and tested (test/thirdPartyLetter.test.js), so a future graph that
// does wire the door through n8n inherits a renderer that already gets this
// right, instead of rediscovering the F-17 defect one execution path later.
// ---------------------------------------------------------------------------

const ctx = $input.first().json;
const e = ctx.employment;
const legalEntity = ctx.legalEntity ?? {};
const requestingPartyRaw = ctx.classification && typeof ctx.classification.requestingParty === 'string' ? ctx.classification.requestingParty : null;
const requestingParty = requestingPartyRaw && requestingPartyRaw.trim() ? requestingPartyRaw.trim() : null;
// rca-tlb2 (R7-20): mirrors letter.js's `options.reference` — the reference
// the requester was shown ("the one to quote when asking anyone to trace
// it") was, until now, printed nowhere on the document. `ctx.externalRef` is
// carried through the whole graph from `normalizeTicket.js` (`gates.js`
// passes it on at line ~403), so it is already present by the time this node
// runs; omitted, not blanked, when absent — same convention as job title.
const referenceRaw = ctx.externalRef;
const reference =
  (typeof referenceRaw === 'string' || typeof referenceRaw === 'number') && String(referenceRaw).trim()
    ? String(referenceRaw).trim()
    : null;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Port of contractTypeLabel() in src/shared/contractTypes.js. Inlined because
// an n8n Code node has no imports. An unrecognised code is PRINTED AND MARKED
// rather than hidden — the raw value survives so it can be grepped and quoted
// in a bug report, and the marker is what stops a reader taking a slug for an
// answer.
const CONTRACT_TYPE_LABELS = {
  contractor: 'Contractor',
  eor: 'Employer of Record (EOR) employee',
  global_payroll: 'Global Payroll employee',
  global_payroll_employee: 'Global Payroll employee',
  employee: 'Employee',
  full_time: 'Full-time',
  part_time: 'Part-time',
};
function contractTypeLabel(raw, absent) {
  if (typeof raw !== 'string' || raw.trim() === '') return absent;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === 'not_determined') return absent;
  const name = CONTRACT_TYPE_LABELS[trimmed.toLowerCase()];
  if (name) return name;
  return trimmed + ' (unrecognised code)';
}

// FAILS CLOSED ON A MISSING LEGAL ENTITY, and this is a DEPLOY-BLOCKING
// DEPENDENCY rather than a defensive nicety.
//
// The letter now says "<person> is employed by <entity>" and carries an
// Employer of Record row, so it names a legal employer as a matter of fact. The
// deployed graph WORKFLOW_UC01_ID has NO legal-entity fetch node — 24 nodes,
// none of them reading /v1/legal-entities — so `ctx.legalEntity` is absent
// there today.
//
// Defaulting to a plausible string ("Remote") would put an invented employer
// name into a document going to a bank, a landlord or an immigration officer,
// which is DRIFT-074's defect wearing different clothes: a false attestation
// about a legal relationship, produced by a system that never looked. So this
// throws instead. The n8n run errors at a node whose status a human reads, the
// audit row for the decision is already durable (it is written upstream, by
// design), and no letter is posted.
//
// BEFORE DEPLOYING THIS FILE the graph needs a `Fetch Legal Entity (Remote)`
// node between `Route by Decision` and `Render Letter`, passing
// `{name, address|country_code}` through as `legalEntity` — mirroring
// `getLegalEntity(employment.legal_entity_id, employment.company_id)` in
// src/uc01/workflow.js STEP 7a. Deploying without it turns every auto_resolve
// into a failed run. That is the correct direction to fail, and it is stated
// here rather than discovered in production.
if (!legalEntity || !legalEntity.name) {
  throw new Error(
    'Render Letter: no legal entity was supplied, so the employer this letter would name is unknown. '
    + 'Add a Fetch Legal Entity node upstream. Refusing to name an employer we did not read.'
  );
}
const entityName = legalEntity.name;
const entityLocation = legalEntity.address || legalEntity.country_code || '';
const contract = contractTypeLabel(e.contract_type, 'not recorded');
const today = new Date().toISOString().slice(0, 10);

// Job title is CONDITIONAL, exactly as in letter.js: its absence removes the
// row rather than leaving a blank one. A blank row in a document that goes to
// an immigration officer reads as a stated fact about a named person.
const jobTitleRow = e.job_title
  ? '<tr><th>Job title</th><td>' + esc(e.job_title) + '</td></tr>'
  : '';

const letterHtml = [
  '<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:640px">',
  '<h1>' + esc(entityName) + '</h1>',
  '<p>' + (entityLocation ? esc(entityLocation) : 'Employer of Record') + '</p>',
  '<p>' + today + '</p>',
  '<p><strong>Employment Verification Letter</strong></p>',
  '<p>To Whom It May Concern,</p>',
  '<p>This letter confirms that <strong>' + esc(e.full_name) + '</strong> is employed by <strong>'
    + esc(entityName) + '</strong> in the capacity detailed below. '
    + (requestingParty
        ? "This letter is issued upon a request from <strong>" + esc(requestingParty) + "</strong>, with the employee's consent, for employment verification purposes."
        : "This letter is issued upon the employee's request for employment verification purposes.")
    + '</p>',
  '<table>',
  reference ? '<tr><th>Reference</th><td>' + esc(reference) + '</td></tr>' : '',
  '<tr><th>Employee name</th><td>' + esc(e.full_name) + '</td></tr>',
  jobTitleRow,
  '<tr><th>Employment status</th><td>' + esc(e.status) + '</td></tr>',
  '<tr><th>Contract type</th><td>' + esc(contract) + '</td></tr>',
  '<tr><th>Start date</th><td>' + esc(e.start_date) + '</td></tr>',
  '<tr><th>On probation</th><td>' + (e.probation ? 'Yes' : 'No') + '</td></tr>',
  '<tr><th>Employer of Record</th><td>' + esc(entityName) + (entityLocation ? ', ' + esc(entityLocation) : '') + '</td></tr>',
  '</table>',
  '<p>This verification covers the standard employment facts listed above only. '
    + 'Financial details and other confidential employment terms are not disclosed in this letter.</p>',
  '</body></html>',
].join('');

return [{ json: { ...ctx, letterHtml, letterIssued: true } }];
