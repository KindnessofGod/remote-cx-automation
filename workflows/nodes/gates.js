// ---------------------------------------------------------------------------
// gates.js — body of the "Identity + Policy Gates" n8n Code node
// ---------------------------------------------------------------------------
// This is the deterministic core of UC-01 in n8n: identity verification and the
// ordered policy gates, in ONE node so the decision logic stays in one place
// exactly as it does in src/uc01/policyEngine.js.
//
// It lives as a real .js file rather than a string inside the workflow builder
// for two reasons:
//   1. Escaping. When this body was first embedded as a template literal, `\n`
//      and `\/` silently collapsed — one produced a literal newline inside a
//      string literal (a syntax error), the other turned /https?:\/\// into
//      /https?:/// which JavaScript reads as a regex followed by a comment, so
//      a boolean became a RegExp object and every ticket would have routed to
//      human review. A real file cannot have that class of bug.
//   2. Testability. test/n8nParity.test.js executes THIS FILE and asserts it
//      reaches the same decision as policyEngine.evaluate() for every scenario,
//      so the n8n copy and the Node copy cannot drift apart unnoticed.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` and `$input` are
// provided by n8n (and mocked by the parity test).
// ---------------------------------------------------------------------------

const ctx = $('Validate Classification').first().json;
const classification = ctx.classification;

// rca-wn30: THE EMPLOYMENT RECORD IS NOW READ BY NODE NAME, NOT OFF $input.
//
// "Lookup Consent Records" (the Supabase node K4 authorised, see the consent
// block below) sits between "Fetch Employment (Remote)" and this node, so
// `$input` here is that node's own PostgREST response — rows, not an
// employment. Reading the Remote response by name is what makes the lookup
// insertable at all, and it is the same cross-node accessor this file already
// uses one line up for `ctx`. `.first()` needs no item pairing, so it is
// unaffected by a Supabase node emitting a different number of items than it
// received.
//
// Falls back to `$input` when the named node is unreachable — n8n's `$()`
// THROWS for a node that does not exist or has not run, and a graph without
// the fetch node ahead of this one is not a state this file should turn into
// a hard failure. The fallback is also what keeps every non-graph caller of
// this body (test/n8nParity.test.js's vm sandbox, and any future harness)
// working against the shape they already feed it.
function readEmploymentResponse() {
  try {
    return $('Fetch Employment (Remote)').first().json;
  } catch (e) {
    return $input.first().json;
  }
}

// normalizeEmployment() — the real API nests what the mock keeps flat.
const employmentResponse = readEmploymentResponse();
const raw = employmentResponse?.data?.employment ?? employmentResponse?.data ?? {};
const basic = raw.basic_information ?? {};
const probationEnd = raw.probation_period_end_date ?? null;
const employmentEmail = basic.email ?? basic.personal_email ?? raw.email ?? raw.personal_email ?? null;
const employment = {
  id: raw.id ?? ctx.employmentId,
  status: raw.status ?? 'unknown',
  full_name: basic.name ?? raw.full_name ?? null,
  // The real API has NO `start_date` field anywhere — the date lives on
  // `provisional_start_date`, at the top level and duplicated on
  // basic_information. This read used to look only for `start_date`, so on
  // every real Sandbox record it produced null, and the letter printed a blank
  // where the start date belongs. The demo stand-in "fixed" that by inventing a
  // `basic_information.start_date` field, which hid the mapping error behind a
  // shape Remote does not return. Mirrors normalizeEmployment() in
  // src/remote/restClient.js, which had this right all along.
  start_date: basic.provisional_start_date ?? raw.provisional_start_date
    ?? basic.start_date ?? raw.start_date ?? null,
  contract_type: raw.employment_model ?? raw.contract_type ?? null,
  probation: probationEnd ? new Date(probationEnd) > new Date() : Boolean(raw.probation),
  legal_entity_id: raw.engaged_by_legal_entity_id ?? raw.legal_entity_id ?? null,
  company_id: raw.company_id ?? null,
  email: employmentEmail ? String(employmentEmail).toLowerCase() : null,
  // rca-dy0: found live, not by a fixture. Mirrors normalizeEmployment() in
  // src/remote/restClient.js (`job_title: basicInfo.job_title ?? raw.job_title
  // ?? null`), which the Node path already reads. Without this line the field
  // was simply never on `employment` here, so renderLetter.js's L-16 "Job
  // title" row — added specifically to close that gap — was dead code on the
  // n8n path: a real Sandbox employee with a job title on record (Alex Morgan,
  // "Content Writer Wizard") got a letter with no Job title row at all, and
  // nothing before a live execution could have shown that — the parity test
  // feeds both renderers one fixed EMPLOYMENT object and never exercises this
  // extraction step. `policyEngine.js`'s completeness gate deliberately does
  // not require job_title (letter.js already guards the row's absence), so
  // adding it here changes what the letter can print, never what a gate decides.
  job_title: basic.job_title ?? raw.job_title ?? null,
  // F-7 (rca-1rx): the internal note needs "who this is about" to include a
  // country, and nothing upstream of the human_review branch ever fetches
  // /v1/countries (only the auto_resolve branch's Normalize Legal Entity node
  // does, for the legal entity's address). Read straight off the raw record
  // instead — mirrors normalizeEmployment()'s country_code in
  // src/remote/restClient.js — and fail closed to null on anything that is
  // not a plain 2-letter code, never a guess.
  country_code: (() => {
    const raw3 = raw.country?.alpha_2_code ?? raw.country_code ?? raw.country?.code ?? null;
    return typeof raw3 === 'string' && /^[A-Za-z]{2}$/.test(raw3.trim()) ? raw3.trim().toUpperCase() : null;
  })(),
};

// --- identity: an authenticated signal, never a claim ----------------------
// A Zendesk ticket carries no Remote session, so the authenticated signal is
// the ticket's requester — who Zendesk itself authenticated — matched against
// the email on the authoritative Remote record. Never an address typed into
// the ticket body. Fails CLOSED: any missing piece means unverified.
//
// G-3 / VC-30: `ctx.consentRecord` is the ARTIFACT (a consent_records row, or
// null), not a boolean — an n8n Code node has no imports, so the completeness
// rule src/shared/consentArtifact.js states is reimplemented inline here
// rather than shared. It must stay byte-for-byte the same DECISION as that
// file: granted-and-complete verifies, denied refuses (blocked, not
// escalate), anything else — no row, or an incomplete one — is PENDING, never
// a refusal (VC-06). See that file's header for why an incomplete "granted"
// row is treated as pending rather than trusted or refused.
//
// rca-wn30 / R7-18 / K4 — THE LOOKUP NOW EXISTS. For the whole life of this
// file until 2026-08-23, the paragraph here said `ctx.consentRecord` "IS NOT
// YET POPULATED BY THIS GRAPH", because `L-8`'s lookup is a Supabase node and
// adding one is a graph SHAPE change no Code-node edit can make (L-15/L-20/
// L-21). The measured consequence was R7-18: 22 of 100 live feed rows carried
// `identity_awaiting_employee_consent` and NONE carried a `consentRecordId`,
// while the row's own prose told the reviewer to "see the consent request's
// own age before assuming it needs a nudge" — an instruction that could not
// be followed. `qa/HUMAN-DECISIONS-REQUIRED.md` §K4 authorised exactly one
// production graph-shape change to close it: the "Lookup Consent Records"
// Supabase node, wired `Fetch Employment (Remote) -> Lookup Consent Records ->
// Identity + Policy Gates` (workflows/nodes/consentLookupSpec.js).
//
// TWO READS OF THE SAME ROWS, AND THE ASYMMETRY IS THE CONTROL.
//
//   `consentRecord`        — the artifact that DECIDES. Scoped to employment
//                            AND requesting party AND purpose, byte-for-byte
//                            the rule `caseStore.findConsentArtifact()` runs
//                            in SQL on the Node path. A party or purpose the
//                            request did not state matches NOTHING (VC-30: a
//                            standing "yes to anyone, forever" cannot be
//                            represented), so on a Zendesk ticket — which
//                            carries neither — this stays null and NO gate
//                            outcome changes. That is deliberate: this bead
//                            fixes a missing POINTER, not a missing grant.
//   `pendingConsentRequest` — the POINTER, and nothing else. The
//                            longest-waiting UNANSWERED ask naming this
//                            employment, scoped by employment id alone,
//                            exactly `caseStore.findConsentRequestsForEmployee()`
//                            (L-13/L-19) — the read that already exists for
//                            the employee's own consent surface. It is read
//                            ONLY on a branch that has ALREADY decided to
//                            wait, so it can never verify a disclosure and
//                            never refuse one. It cannot reach
//                            `isConsentRowGranted`/`isConsentRowDenied` at
//                            all; grep this file and see.
//
// Widening the DECIDING read to "any consent this employee ever gave" would
// let a grant to one bank for one purpose clear a different bank's enquiry.
// Leaving the POINTER scoped to a party+purpose the channel cannot supply
// would have shipped a node that provably never matches — the "unwired
// parameter that always reads as absent" trap the G-1 comment below names.
// Both reads come from ONE node's rows, which is also what keeps the
// authorisation's scope ("this graph, this lookup") honest.
function isConsentRowComplete(row) {
  return Boolean(row) && row.grantedByEmploymentId != null && row.requestingParty != null
    && row.purpose != null && row.grantedAt != null;
}
function isConsentRowGranted(row) {
  return Boolean(row) && row.status === 'granted' && isConsentRowComplete(row);
}
function isConsentRowDenied(row) {
  return Boolean(row) && row.status === 'denied';
}

/**
 * Every `consent_records` row the lookup node returned for this employment,
 * oldest first (the node orders `created_at.asc`, matching L-19's "the
 * longest-waiting request is what the employee sees first").
 *
 * Degrades to `[]` in three different ways, all of them the SAFE (pending)
 * direction and all of them indistinguishable from "this employee has no
 * consent rows":
 *   - the node is absent or has not run — `$()` THROWS, caught here;
 *   - the node matched nothing — `alwaysOutputData` makes it emit one empty
 *     item, which carries no `id` and is dropped below;
 *   - Supabase was unreachable — `onError: continueRegularOutput` makes it
 *     emit an `{error: …}` item, which also carries no `id`.
 * A consent lookup that fails must never be able to produce a disclosure, and
 * the only thing it can produce here is a longer wait.
 */
function readConsentRows() {
  let items;
  try {
    items = $('Lookup Consent Records').all();
  } catch (e) {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normaliseConsentRow(item && item.json))
    .filter(Boolean);
}

/**
 * Supabase hands back the table's own snake_case columns; `caseStore.js`'s
 * `CONSENT_SELECT_COLUMNS` aliases the same columns to camelCase, and this
 * file's three predicates above are written against the camelCase spelling
 * because that is the shape `src/shared/consentArtifact.js` states the rule
 * in. Accepting BOTH spellings is what lets one predicate serve a row from
 * the graph and a row handed in on `ctx` without either side re-stating the
 * completeness rule. A row with no `id` is not a row (see readConsentRows).
 */
function normaliseConsentRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id ?? null;
  if (id == null) return null;
  return {
    id: id,
    createdAt: row.createdAt ?? row.created_at ?? null,
    caseId: row.caseId ?? row.case_id ?? null,
    consentType: row.consentType ?? row.consent_type ?? null,
    status: row.status ?? null,
    source: row.source ?? null,
    evidenceReference: row.evidenceReference ?? row.evidence_reference ?? null,
    requestingParty: row.requestingParty ?? row.requesting_party ?? null,
    purpose: row.purpose ?? null,
    grantedByEmploymentId: row.grantedByEmploymentId ?? row.granted_by_employment_id ?? null,
    grantedBySignal: row.grantedBySignal ?? row.granted_by_signal ?? null,
    grantedAt: row.grantedAt ?? row.granted_at ?? null,
  };
}

/**
 * `matchesParty()` from caseStore.js, inlined: trimmed, case-insensitive
 * equality, and BOTH SIDES ABSENT IS NEVER A MATCH — an unscoped question
 * cannot have a scoped answer. That last clause is the whole of VC-30 on this
 * path: a Zendesk ticket states no party and no purpose, so it can never
 * match a grant, however many grants this employee has given.
 */
function matchesConsentScope(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * `caseStore.findConsentArtifact()`'s contract, applied to rows already
 * scoped to this employment by the node's own PostgREST filter: the MOST
 * RECENT row matching this requesting party AND this purpose, or null.
 * `rows` arrives oldest-first, so the last match is the most recent one.
 */
function selectScopedConsentRecord(rows, requestingParty, purpose) {
  if (!requestingParty || !purpose) return null;
  let found = null;
  for (const row of rows) {
    if (matchesConsentScope(row.requestingParty, requestingParty)
      && matchesConsentScope(row.purpose, purpose)) {
      found = row;
    }
  }
  return found;
}

/**
 * `caseStore.findConsentRequestsForEmployee()`'s first element: the oldest
 * row that is neither granted-and-complete nor denied — "pending" in exactly
 * the three-state sense src/shared/consentArtifact.js defines, applied to
 * what the employee still has to answer. Oldest rather than newest because
 * L-19 ages the LONGEST-WAITING ask, and that is the one the reviewer is
 * being told to look at before nudging.
 */
function oldestPendingConsentRequest(rows) {
  for (const row of rows) {
    if (!isConsentRowGranted(row) && !isConsentRowDenied(row)) return row;
  }
  return null;
}

const session = ctx.session ?? null;
const consentRows = readConsentRows();
// `ctx.consentRecord` still wins where a caller supplied the artifact
// outright (that is the seam src/uc01/workflow.js's STEP 2c uses, and every
// scenario in test/n8nParity.test.js). The lookup fills it only when nobody
// did — never overrides it.
const consentRecord = ctx.consentRecord
  ?? selectScopedConsentRecord(consentRows, ctx.requestingParty ?? null, ctx.purpose ?? null);
const pendingConsentRequest = oldestPendingConsentRequest(consentRows);
// R7-18's field. The deciding artifact names itself when there is one;
// otherwise the longest-waiting unanswered ask does. Null only when this
// employment genuinely has no consent row at all — which is now a fact about
// the database rather than a fact about the graph's shape.
const pendingConsentRecordId = consentRecord
  ? consentRecord.id
  : (pendingConsentRequest ? pendingConsentRequest.id : null);

// --- rca-43z / DRIFT-119 / VC-29: WHO IS ASKING, deterministically derived --
// Port of deriveRequesterType() (src/uc01/requesterType.js), inlined because
// an n8n Code node has no imports. Until this landed, the live path decided
// the whole disclosure regime from `classification.requesterType` — a TEXT
// HEURISTIC in validateClassification.js
// (`/(this is|we are|on behalf of)/`) that DEFAULTS TO self when no
// third-party phrase is present, the exact inverse of VC-29's fail-closed
// rule ("an absent or unparseable requesterType from the classifier fails
// closed to third party, never to self"). src/uc01/workflow.js already
// derives from session+record on the Node path; this ports the SAME rule —
// byte-for-byte the same regime logic — so the surface that actually serves
// Zendesk tickets stops trusting the model for a decision prime directive #3
// reserves for an authenticated signal. The classifier's own opinion is kept
// on `classification` UNCHANGED below (never mutated) — audit and the
// internal note read it exactly as the Node path's `describeDecisionFacts()`
// does, from the untouched original, while ONLY the two gate checks below use
// the derived value. Held against the original by test/n8nParity.test.js and
// test/uc01RequesterType.test.js.
const UNAUTHENTICATED_SOURCES = ['third_party_door', 'anonymous', 'public'];
function deriveRequesterTypeNode({ session, employment, source, classifierRequesterType }) {
  const opinion = classifierRequesterType === 'self' || classifierRequesterType === 'third_party'
    ? classifierRequesterType
    : null;

  let derived;
  if (source && UNAUTHENTICATED_SOURCES.indexOf(String(source)) !== -1) {
    derived = { requesterType: 'third_party', basis: 'unauthenticated_channel' };
  } else if (!session) {
    derived = { requesterType: 'third_party', basis: 'no_authenticated_signal' };
  } else if (!employment) {
    derived = { requesterType: 'third_party', basis: 'no_employment_record' };
  } else if (session.authenticatedEmploymentId) {
    derived = session.authenticatedEmploymentId === employment.id
      ? { requesterType: 'self', basis: 'session_matches_employment' }
      : { requesterType: 'third_party', basis: 'session_names_another_employment' };
  } else if (session.authenticatedEmail) {
    const recordEmail = typeof employment.email === 'string' ? employment.email.trim().toLowerCase() : null;
    derived = !recordEmail
      ? { requesterType: 'third_party', basis: 'no_email_on_employment_record' }
      : String(session.authenticatedEmail).trim().toLowerCase() === recordEmail
        ? { requesterType: 'self', basis: 'requester_email_matches_employment' }
        : { requesterType: 'third_party', basis: 'requester_email_does_not_match' };
  } else {
    derived = { requesterType: 'third_party', basis: 'unrecognised_session_shape' };
  }

  // The classifier may only ever TIGHTEN toward third_party, and an absent or
  // unparseable answer FAILS CLOSED to third_party — both asymmetries stated
  // explicitly rather than left to a `||`, exactly as requesterType.js states
  // them, because the asymmetry IS the control.
  let requesterType = derived.requesterType;
  let basis = derived.basis;
  if (opinion === 'third_party' && requesterType === 'self') {
    requesterType = 'third_party';
    basis = 'classifier_raised_to_third_party';
  }
  if (opinion === null && requesterType === 'self') {
    requesterType = 'third_party';
    basis = 'classifier_requester_type_unreadable';
  }

  return {
    requesterType,
    basis,
    source: 'deterministic',
    classifierOpinion: opinion,
    disagreesWithClassifier: opinion !== null && opinion !== requesterType,
  };
}
const requesterIdentity = deriveRequesterTypeNode({
  session,
  employment,
  source: ctx.source ?? null,
  classifierRequesterType: classification.requesterType,
});

let identity;
if (requesterIdentity.requesterType === 'third_party') {
  // Parity with src/shared/identity.js: THIRD PARTY IS TESTED FIRST, ahead of
  // whether `employment` resolved at all — VC-33 requires a real employee with
  // no consent, a real employee who refused, and a person who does not exist
  // at Remote to be indistinguishable from outside, and testing the regime
  // before the record is what keeps all three on the same path.
  if (isConsentRowGranted(consentRecord)) {
    identity = { verified: true, pending: false, reason: 'third_party_with_consent', consentRecordId: consentRecord.id };
  } else if (isConsentRowDenied(consentRecord)) {
    identity = { verified: false, pending: false, reason: 'third_party_consent_denied', consentRecordId: consentRecord.id };
  } else if (session && (session.authenticatedEmploymentId || session.authenticatedEmail)) {
    identity = { verified: false, pending: true, reason: 'awaiting_employee_consent_other_employee_signed_in', consentRecordId: pendingConsentRecordId };
  } else {
    identity = { verified: false, pending: true, reason: 'awaiting_employee_consent', consentRecordId: pendingConsentRecordId };
  }
} else if (!session) {
  identity = { verified: false, pending: false, reason: 'no_authenticated_requester' };
} else if (!employment.email) {
  identity = { verified: false, pending: false, reason: 'no_email_on_employment_record' };
} else if (session.authenticatedEmail !== employment.email) {
  identity = { verified: false, pending: false, reason: 'requester_employment_mismatch' };
} else {
  identity = { verified: true, pending: false, reason: 'requester_matches_employment' };
}

// --- G-1: engagement eligibility, FIRST, ahead of identity -----------------
// Port of src/uc01/engagementEligibility.js. Inlined rather than imported
// because an n8n Code node has no imports at all; test/n8nParity.test.js
// executes this file and asserts it reaches the same verdict as the real
// function, so the two cannot drift apart unnoticed.
//
// Eligibility is a property of the RECORD, identity of the REQUESTER, so this
// runs first: an ineligible request is refused having disclosed nothing. Before
// it existed a contractor passed every gate below and received a letter saying
// Remote employs them, on this exact live path (ticket #6). See DRIFT-074.
//
// rca-bdz, STILL OPEN HERE. `src/uc01/engagementEligibility.js`'s
// classifyEngagement() was extended 2026-08-23 to take a second Remote read
// (GET /v1/offboardings/employments/{id}) so an employment whose `status`
// stays "active" while an offboarding runs in the background is no longer
// invisible to G-1. THIS PORT DOES NOT HAVE THAT FIX — it is a graph-shape
// change (a new HTTP node calling that endpoint, wired ahead of this one),
// not a Code-node body edit, so it could not be made from this file alone.
// Do not "fix" this by adding an offboarding parameter here without also
// adding and wiring the node that would supply it — an unwired parameter
// that always reads as absent is worse than this comment, because it would
// look fixed on inspection.
const EOR_ENGAGEMENTS = ['eor', 'eor_employee', 'employee', 'full_time', 'part_time'];
const NON_EOR_ENGAGEMENTS = {
  contractor: 'engagement_not_eor_contractor',
  independent_contractor: 'engagement_not_eor_contractor',
  global_payroll: 'engagement_not_eor_direct',
  global_payroll_employee: 'engagement_not_eor_direct',
  direct: 'engagement_not_eor_direct',
  direct_employee: 'engagement_not_eor_direct',
  hris_employee: 'engagement_not_eor_direct',
  // The create-side spelling of direct_employee — see the src copy's comment.
  hris: 'engagement_not_eor_direct',
};
const ONBOARDING_STATUSES = ['created', 'initiated', 'pending', 'invited', 'onboarding', 'pre_hire'];
const OFFBOARDING_STATUSES = ['offboarding', 'notice', 'serving_notice', 'leaving', 'termination_pending'];
const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function classifyEngagement(rec) {
  if (!rec) return { eligible: true, engagement: null };
  const st = lower(rec.status);
  if (OFFBOARDING_STATUSES.indexOf(st) !== -1) {
    return { eligible: false, decision: 'escalate', reason: 'engagement_offboarding', flag: 'engagement_status_' + st, engagement: lower(rec.contract_type) || null };
  }
  const eng = lower(rec.contract_type);
  if (!eng || eng === 'unknown') {
    return { eligible: false, decision: 'blocked', reason: 'eor_status_unknown', flag: 'engagement_unreadable', engagement: eng || null };
  }
  if (NON_EOR_ENGAGEMENTS[eng]) {
    return { eligible: false, decision: 'blocked', reason: NON_EOR_ENGAGEMENTS[eng], flag: 'engagement_' + eng, engagement: eng };
  }
  if (EOR_ENGAGEMENTS.indexOf(eng) === -1) {
    return { eligible: false, decision: 'blocked', reason: 'eor_status_unknown', flag: 'engagement_unrecognised_' + eng, engagement: eng };
  }
  if (ONBOARDING_STATUSES.indexOf(st) !== -1) {
    return { eligible: false, decision: 'blocked', reason: 'engagement_onboarding_incomplete', flag: 'engagement_status_' + st, engagement: eng };
  }
  return { eligible: true, engagement: eng };
}

const engagement = classifyEngagement(employment);

// --- policyEngine.js: ordered gates ---------------------------------------
const CONFIDENCE_THRESHOLD = 0.85;
// Fields the letter prints as fact and cannot render without. `job_title` is
// excluded (its row is conditional) and `status` is excluded (already proved
// "active" above). Mirrors REQUIRED_LETTER_FIELDS in src/uc01/policyEngine.js.
const REQUIRED_LETTER_FIELDS = ['full_name', 'start_date', 'contract_type'];

// Prompt/dataset vocabulary -> contract vocabulary. Mirrors FIELD_VOCABULARY in
// src/uc01/policyEngine.js: the frozen prompt teaches "compensation", VC-09
// requires "salary" reach the specialist, and neither side is renamed.
// The n8n port of src/uc01/requestedFieldVocabulary.js — a Code node cannot
// import. Kept in step by test/n8nParity.test.js; if you add a synonym in one,
// add it in the other in the SAME edit.
//
// It grew from a single entry on 2026-08-28: the classifier's prompt names
// `compensation` as the only permitted spelling and the live model returned
// `gross_annual_salary`, which fell through the map and through
// AUTHORISABLE_FIELDS and was reported to a specialist as "never released".
// A frozen prompt is a request, not validation.
const REQUESTED_FIELD_SYNONYMS = {
  compensation: 'salary', compensation_amount: 'salary', salary: 'salary',
  gross_salary: 'salary', annual_salary: 'salary', gross_annual_salary: 'salary',
  annual_gross_salary: 'salary', salary_amount: 'salary', base_salary: 'salary',
  gross_pay: 'salary', pay: 'salary', current_pay: 'salary', wage: 'salary',
  wages: 'salary', income: 'salary', remuneration: 'salary',
  working_hours: 'working_hours', work_hours: 'working_hours', hours: 'working_hours',
  hours_per_week: 'working_hours', weekly_hours: 'working_hours',
  work_hours_per_week: 'working_hours', contracted_hours: 'working_hours',
  working_hours_per_week: 'working_hours',
  end_date: 'end_date', contract_end: 'end_date', contract_end_date: 'end_date',
  end_of_contract: 'end_date', contract_duration: 'end_date', contract_term: 'end_date',
  job_title: 'job_title', title: 'job_title', position: 'job_title',
  role: 'job_title', job_role: 'job_title',
};
function canonicaliseRequestedField(field) {
  if (typeof field !== 'string') return '';
  const cleaned = field.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.hasOwn(REQUESTED_FIELD_SYNONYMS, cleaned) ? REQUESTED_FIELD_SYNONYMS[cleaned] : cleaned;
}

const STANDARD_LETTER_FIELDS = [
  'full_name', 'start_date', 'contract_type', 'probation', 'status', 'legal_entity'
];
const flags = [];
let decision, reason;
if (!engagement.eligible) {
  flags.push(engagement.flag);
  decision = engagement.decision; reason = engagement.reason;
} else if (!identity.verified) {
  // G-3: three outcomes, not one. Pending is NOT a refusal (VC-06); a denied
  // consent is a terminal `blocked`, never `escalate` (VC-08) — there is
  // nothing left for a specialist to look at once the employee has said no.
  // Everything else is the ORIGINAL identity refusal this gate has always
  // reported. Mirrors src/uc01/policyEngine.js's gate 1 exactly (parity test).
  if (identity.pending) {
    flags.push('identity_' + identity.reason);
    decision = 'awaiting_employee_consent'; reason = 'awaiting_employee_consent';
  } else if (identity.reason === 'third_party_consent_denied') {
    flags.push('consent_refused');
    decision = 'blocked'; reason = 'consent_refused';
  } else {
    flags.push('identity_' + identity.reason);
    decision = 'escalate'; reason = 'identity_not_verified';
  }
} else if (employment.status !== 'active') {
  flags.push('employment_status_' + employment.status);
  decision = 'escalate'; reason = 'employee_not_active';
} else if (requesterIdentity.requesterType === 'third_party') {
  flags.push('third_party_request');
  decision = 'human_review'; reason = 'third_party_request';
} else if (classification.intent === 'out_of_scope') {
  flags.push('out_of_scope');
  decision = 'out_of_scope'; reason = 'out_of_scope';
} else {
  // Record artifact signals BEFORE deciding — an early return would drop the
  // very flags that explain the decision.
  if (classification.hasAttachment) flags.push('has_attachment');
  if (classification.hasExternalUrl) flags.push('external_url');
  if (flags.length > 0) {
    decision = 'human_review'; reason = 'artifact_present';
  } else if (
    // OVER-SCOPE IS CHECKED BEFORE THE GENERIC NON-STANDARD REFUSAL, mirroring
    // src/uc01/policyEngine.js. Both send the request to a human, so the
    // decision is identical either way — what differs is what the specialist is
    // told. `non_standard_request` says only "this was not a plain letter";
    // `over_scope_request` names the field that cannot be disclosed, which is
    // what VC-09 requires reach the review surface.
    //
    // The reorder landed in src/ and not here, so the live n8n path recorded
    // the generic reason for every over-scope ticket. The parity test could not
    // see it: its fixtures set one condition at a time, and this needs a
    // non-standard intent AND a requested field together.
    (() => {
      const r = classification.requestedFields;
      if (!Array.isArray(r) || r.some(f => typeof f !== 'string')) {
        flags.push('requested_fields_unknown');
        decision = 'human_review'; reason = 'over_scope_undetermined';
        return true;
      }
      const over = r.map(canonicaliseRequestedField)
                    .filter(f => !STANDARD_LETTER_FIELDS.includes(f));
      if (over.length > 0) {
        flags.push('over_scope_disclosure_requested');
        decision = 'human_review'; reason = 'over_scope_request';
        return true;
      }
      return false;
    })()
  ) {
    // decided inside the predicate above
  } else if (classification.intent !== 'standard_letter') {
    flags.push('non_standard_request');
    decision = 'human_review'; reason = 'non_standard_request';
  } else {
    // FAIL CLOSED on both remaining gates. `requestedFields ?? []` used to
    // read a missing key as "nothing over-scope was asked for", and
    // `undefined < 0.85` / `NaN < 0.85` are both FALSE — so a classification
    // that answered neither question auto-resolved. Absent is not "no".
    // Mirrors src/uc01/policyEngine.js steps 5 and 6 exactly (parity test).
    const requested = classification.requestedFields;
    const confidence = classification.confidence;
    if (!Array.isArray(requested) || requested.some(f => typeof f !== 'string')) {
      flags.push('requested_fields_unknown');
      decision = 'human_review'; reason = 'over_scope_undetermined';
    } else {
      const overScope = requested.filter(f => !STANDARD_LETTER_FIELDS.includes(f));
      if (overScope.length > 0) {
        flags.push('over_scope_disclosure_requested');
        decision = 'human_review'; reason = 'over_scope_request';
      } else if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
        flags.push('confidence_unknown');
        decision = 'human_review'; reason = 'confidence_unknown';
      } else if (confidence < CONFIDENCE_THRESHOLD) {
        flags.push('low_confidence');
        decision = 'human_review'; reason = 'low_confidence';
      } else {
        // Gate 7 — the record must be complete enough to state every fact the
        // letter prints. escapeHtml() maps null to "", so a missing start date
        // rendered a BLANK row in a document sent to a bank or an immigration
        // officer, with the run reporting auto_resolve / all_gates_passed.
        // Mirrors src/uc01/policyEngine.js step 7 exactly (parity test).
        const missingFields = REQUIRED_LETTER_FIELDS.filter(
          f => employment[f] == null || String(employment[f]).trim() === ''
        );
        if (missingFields.length > 0) {
          flags.push('incomplete_employment_record');
          decision = 'human_review'; reason = 'incomplete_employment_record';
        } else if (session && session.authenticatedEmploymentId) {
          // --- G-2: self-service deflection. Port of policyEngine.js gate 8.
          // Only fires on a POSITIVE signal that this requester can reach
          // Remote's own Requests tab — an authenticated Remote session. A
          // requester identified by the weaker Zendesk-email signal reached us
          // by raising a ticket, which is evidence they did NOT use that flow,
          // so they get the letter exactly as before. Deflecting everyone here
          // would make auto_resolve unreachable in production while every
          // negative test stayed green (VC-25).
          flags.push('self_service_available');
          decision = 'deflected_to_self_service'; reason = 'self_service_available';
        } else {
          decision = 'auto_resolve'; reason = 'all_gates_passed';
        }
      }
    }
  }
}

// --- rca-fawf / R7-26: AN UNREFERENCED auto_resolve IS REFUSED HERE --------
//
// The n8n half of src/uc01/workflow.js's STEP 5b. Ruling: qa/HUMAN-DECISIONS-
// REQUIRED.md §K3 — an `auto_resolve` carrying no `externalRef` is not a
// legitimate decision, because nothing can ever say which request produced the
// letter, and because the "Claim Ticket (Idempotency)" node immediately
// downstream has no key to claim, so a redelivery would issue a second letter
// with nothing in its way.
//
// WHY THIS NODE, AND WHY A THROW.
//
// This is the LAST node on the graph before anything durable or outward
// happens. The live wiring is
//
//   Identity + Policy Gates -> Claim Ticket (Idempotency)
//     -> Carry Context After Claim -> Out of Scope? -> Persist Case
//     -> ... -> Append Audit Log -> ... -> Route by Decision -> Zendesk
//
// so every other candidate site is already downstream of a write. Refusing by
// merely SETTING a decision would not work: only `out_of_scope` has a branch
// that bypasses `Persist Case`, and every other value — including any new one
// — still flows through `Persist Case` and `Append Audit Log` and writes
// exactly the untraceable row this guard exists to prevent. Adding a fourth
// bypass branch is a graph-SHAPE change, which §K4 authorised once, for the
// consent lookup, and for nothing else.
//
// A throw stops the run here: no claim, no `cases` row, no `audit_log` row, no
// `documents` row, no Zendesk reply. The refusal is still DURABLY RECORDED —
// `RCX OPS · Error Alerts` (WORKFLOW_OPS_IDX) fires on a failed run of any of
// the nine and writes an `ops_alerts` row naming this node, the execution and
// `audit_durable` — and it is idempotent by construction, because a
// redelivery re-runs the same refusal and still writes and sends nothing.
//
// NOT A POLICY GATE, and deliberately placed AFTER the ladder rather than
// inside it. `externalRef` is a property of the DELIVERY, not of the
// employment, the requester or the request, so it is not something
// src/uc01/policyEngine.js should ever weigh — which is why its parity twin
// lives in src/uc01/workflow.js's orchestration and not in the gate chain, and
// why test/n8nParity.test.js keeps comparing the two ladders unchanged. Narrow
// on purpose: `auto_resolve` only, the one outcome this graph acts on the
// requester's behalf for, unsupervised and irreversibly.
if (decision === 'auto_resolve' && !ctx.externalRef) {
  throw new Error(
    'uc01_unreferenced_auto_resolve: refusing to auto-resolve a request that carries no externalRef — ' +
    'the decision could not be traced to a request, and the idempotency claim has no key, ' +
    'so a redelivery would issue a second letter (rca-fawf / K3).'
  );
}

// riskEngine.js: any flag pushes a low-tier case up a tier.
const riskTier = flags.length > 0 ? 'medium' : 'low';

// --- L-18: the out-of-scope trace, prepared here and NOT YET WRITTEN --------
//
// The Node path writes exactly one `audit_trace` row for an out-of-scope
// refusal and nothing else (VC-31). This node cannot do the equivalent, and the
// reason is a GRAPH SHAPE rather than a Code-node limitation:
//
//   Identity + Policy Gates -> Claim Ticket -> Persist Case -> ...
//     -> Append Audit Log -> ... -> Route by Decision
//
// Every persistence node runs BEFORE the routing switch, so on the deployed
// graph an out-of-scope ticket already writes a `workflow_claims` row, a
// `cases` row and an `audit_log` row, and then falls through to
// `Unrecognised Decision`. VC-11 requires ZERO rows in `cases`, `review_queue`,
// `documents` and `audit_log` for exactly this outcome, and the Node path
// honours it. The two paths therefore disagree about an INVARIANT, not about a
// reason slug — the same class as DRIFT-118, one layer out in the graph.
//
// Closing it needs an out-of-scope branch taken immediately after this node,
// bypassing the persistence spine and ending at a trace write. That is a
// republish of WORKFLOW_UC01_ID, which the bead dispatching this work forbids.
//
// What this node CAN do is emit the payload that branch will carry, so the
// graph change is a wiring job and not a second authoring of the excerpt rule.
// The bound is the same 160 characters, and for the same reason: *trace
// everything* and *disclose nothing you were not asked to* are both true, and
// the text of a request that reached the wrong channel may be about anything.
const OUT_OF_SCOPE_EXCERPT_CHARS = 160;
const rawText = String(ctx.text ?? '');
const outOfScopeTrace = decision === 'out_of_scope' ? {
  call: 'uc01.out_of_scope',
  attempt: 1,
  ok: true,
  parent_id: null,
  details: {
    externalRef: ctx.externalRef ?? null,
    source: ctx.source ?? null,
    confidence: classification.confidence ?? null,
    classificationSource: classification.source ?? null,
    intent: classification.intent ?? null,
    excerpt: rawText.slice(0, OUT_OF_SCOPE_EXCERPT_CHARS),
    excerptTruncated: rawText.length > OUT_OF_SCOPE_EXCERPT_CHARS,
  },
} : null;

// VC-29's audit line, in the same shape src/uc01/workflow.js writes to
// `audit_log.details.requesterType` — the DETERMINISTIC source, kept distinct
// from the classifier's raw opinion (still intact, unmutated, on
// `classification` above) so a disagreement between the two is readable
// rather than lost. Mapped into the "Append Audit Log" Supabase node's
// `details` field as of rca-kq7w (2026-08-22, live on WORKFLOW_UC01_ID,
// versionId === activeVersionId == "8055040f-d3ab-4596-bd0a-4d0dea5b9c20"),
// guarded against silent regression by
// workflows/nodes/appendAuditLogSpec.js (rca-2ix1). `outOfScopeTrace` above
// remains unmapped — see its own comment.
const requesterType = {
  value: requesterIdentity.requesterType,
  source: requesterIdentity.source,
  basis: requesterIdentity.basis,
  classifierOpinion: requesterIdentity.classifierOpinion,
  disagreesWithClassifier: requesterIdentity.disagreesWithClassifier,
};

return [{ json: { ...ctx, employment, identity, decision, reason, flags, riskTier, outOfScopeTrace, requesterType } }];
