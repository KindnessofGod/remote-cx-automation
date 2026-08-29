// ---------------------------------------------------------------------------
// amendmentGates.js — body of the "Amendment Gates" n8n Code node
// ---------------------------------------------------------------------------
// This is UC-06's deterministic core in n8n: identity -> employment active ->
// dynamic schema -> payroll cutoff, in ONE node so the decision logic stays
// in one place, exactly as src/uc06/policyEngine.js does. It also ports
// changeParser.amendmentType() (deterministic, no LLM) and cutoffEngine.js's
// evaluateCutoff() verbatim.
//
// test/n8nParity.test.js executes THIS FILE and asserts it reaches the same
// decision as policyEngine.evaluate() for every scenario, same discipline as
// UC-01's gates.js — see that file's header for the bug class this guards
// against (a template-literal escape collapsing silently).
//
// draftSummary() is NOT ported here as an LLM call — n8n uses the
// deterministic template fallback from src/uc06/changeParser.js directly.
// The LLM-authored summary is display/audit text only (never read back into
// a decision), so using the template here trades a cosmetic nicety for one
// fewer HTTP dependency and one fewer thing to keep in parity.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` and `$input` are
// provided by n8n (and mocked by the parity test).
// ---------------------------------------------------------------------------

const request = $('Normalize Amendment Request').first().json;

// --- shared/upstreamFailure.js, ported verbatim (a Code node cannot import) --
// All three Remote nodes in this graph carry `onError: continueRegularOutput`,
// so a failed fetch reports success and hands THIS node an error object instead
// of a record. In live execution 4232 all three 404'd, every one was swallowed,
// and the recorded reason was `identity_not_verified` — a refusal the gates
// never actually made. See src/shared/upstreamFailure.js; the parity test
// proves this copy agrees with it.
const UPSTREAM_NOT_FOUND = 'not_found';
const UPSTREAM_UNREACHABLE = 'unreachable';
const REASON_UPSTREAM_NOT_FOUND = 'upstream_record_not_found';
const REASON_UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

function describeUpstreamError(raw, call) {
  if (!raw || typeof raw !== 'object') return null;
  if (!('error' in raw)) return null;
  if ('data' in raw) return null;
  const err = raw.error;
  if (typeof err === 'string') {
    return { call, status: null, kind: UPSTREAM_UNREACHABLE, message: err.slice(0, 200) };
  }
  if (!err || typeof err !== 'object') return null;
  const numeric = Number(err.status ?? err.httpCode ?? err.statusCode);
  const status = Number.isInteger(numeric) ? numeric : null;
  const message =
    typeof err.message === 'string' ? err.message.slice(0, 200) : String(err.name ?? 'upstream call failed');
  return { call, kind: status === 404 ? UPSTREAM_NOT_FOUND : UPSTREAM_UNREACHABLE, status, message };
}

function findUpstreamFailure(failures, call) {
  if (!Array.isArray(failures)) return null;
  for (const failure of failures) {
    if (failure && failure.call === call) return failure;
  }
  return null;
}

function upstreamVerdict(failure) {
  if (!failure) return null;
  const reason = failure.kind === UPSTREAM_NOT_FOUND ? REASON_UPSTREAM_NOT_FOUND : REASON_UPSTREAM_UNAVAILABLE;
  return {
    decision: 'escalate',
    reason,
    flags: [reason, 'upstream_' + failure.call + '_' + (failure.status === null ? 'error' : failure.status)],
  };
}

// THE PAYROLL READ IS PAGINATED, so it arrives as one item PER PAGE, not one
// item (see the calendar section further down, and the pagination settings on
// the "Fetch Payroll Runs (Remote)" node). A failure on page 3 truncates the
// calendar exactly as fatally as a failure on page 1 — and a truncated
// calendar reads downstream as "no cycle governs this date", which is a
// positive claim built out of a short read. So every page item is inspected,
// not just the first, and the earliest failure is the one reported.
function firstPayrollPageFailure(items) {
  for (let i = 0; i < items.length; i++) {
    const failure = describeUpstreamError(items[i] && items[i].json, 'payroll_runs');
    if (failure) return failure;
  }
  return null;
}

const payrollPages = $input.all();

// Built in gate order, so the first entry is the earliest-failing read.
const upstreamFailures = [
  describeUpstreamError($('Fetch Employment (Remote)').first().json, 'employment'),
  describeUpstreamError($('Fetch Country Schema (Remote)').first().json, 'country_schema'),
  firstPayrollPageFailure(payrollPages),
].filter(Boolean);

const empRaw = $('Fetch Employment (Remote)').first().json?.data?.employment ?? $('Fetch Employment (Remote)').first().json?.data ?? {};

// --- shared/countryCodes.js + restClient.js's pickAlpha2(), INLINED --------
// An n8n Code node cannot import, so this helper is copied into all three
// gate bodies — workflows/nodes-uc05/noticePeriodGates.js,
// nodes-uc06/amendmentGates.js and nodes-uc09/adjustmentGates.js. It MIRRORS
// src/remote/restClient.js's pickAlpha2() (which composes
// shared/countryCodes.js's normalizeCountryCode() + isWellFormedCountryCode())
// and is kept BYTE-IDENTICAL in all three so the ports cannot drift apart.
//
// WHY A SHAPE CHECK AND NOT ONE MORE `??` FALLBACK — finding F-27. The live
// API nests `country: {code: "DEU", name: "Germany", alpha_2_code: "DE"}`:
// `code` is the ALPHA-3 form, and there is NO top-level `country_code` on the
// record at all (confirmed against a live GET /v1/employments/{id} on
// 2026-08-17; the one flat `country_code` the record does carry, on
// billing_address_details, is alpha-3 too). The old chain
// `country_code ?? country.alpha_2_code ?? country.code` therefore placed
// "DEU"/"CAN" into a field that is only ever compared against two-letter
// values — UC-05's statutory notice table, UC-06's
// /v1/countries/{code}/employment_basic_information lookup, UC-09's
// ["DE","FR","IT"] high-tax list, which raises the approval floor from 2 to 3.
// Nothing crashes: every such comparison is simply false, forever, and the gate
// fails closed — indistinguishable from working correctly, which is exactly how
// UC-03's dead supported-countries gate survived the project's whole life.
//
// An alpha-3 code is not an alpha-2 code we can salvage: converting needs a
// 249-entry table this repo does not have and must not invent (prime directive
// #4). So an unusable code becomes NULL, never a wrong string — and null is
// what every consumer already reads as "not confirmed": UC-05 escalates
// unsupported_country, UC-06 escalates country_schema_unavailable, UC-09 keeps
// its approval floor at two. A missing value gets investigated; a wrong one
// gets acted on.
function pickAlpha2(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  }
  return null;
}

const basicInfo = (empRaw && empRaw.basic_information) || {};

// NO USABLE RECORD MEANS `null`, NOT A PLACEHOLDER — the same construction-site
// fix UC-03 and UC-09 took. Backfilling `id` from `request.employmentId` and
// defaulting `company_id` to null made the identity gate satisfiable by two
// absent values (`null === null`), so a failed or empty employment read got
// PAST identity and stopped one gate later on `employee_not_active` — an
// accidental fail-closed rather than a control. Reproduced in a sandbox before
// this fix. `null` is what `RemoteClient.getEmployment()` returns on a 404, so
// this matches the reference implementation instead of inventing a shape; the
// gates below already handle a null employment, and no other node in this graph
// dereferences `$json.employment`.
const employment = empRaw && empRaw.id
  ? {
      id: empRaw.id,
      status: empRaw.status ?? 'unknown',
      company_id: empRaw.company_id ?? null,
      // Candidate ORDER and shape-checking match src/remote/restClient.js's
      // normalizeEmployment() exactly. `country.code` is consulted last and
      // passes only if it happens to already be two letters — "DEU" is skipped,
      // which is the point. See pickAlpha2() above.
      country_code: pickAlpha2([empRaw.country?.alpha_2_code, empRaw.country_code, empRaw.country?.code]),
      job_title: basicInfo.job_title ?? empRaw.job_title ?? null,
      weekly_hours: empRaw.weekly_hours ?? null,
      base_salary: empRaw.base_salary ?? null,
      currency: empRaw.currency ?? null,
      // --- the fields a REAL country form requires -------------------------
      // Live, `GET /v1/employments/{id}` nests these on a `basic_information`
      // block: {name, job_title, login_email, provisional_start_date,
      // tax_servicing_countries, tax_job_category, has_seniority_date,
      // mobile_number, personal_email, work_email, seniority_date}
      // [CONFIRMED 2026-08-18 on NL/DE/FR employments]. Six of them are
      // required by `employment_basic_information`, and without them
      // buildAmendmentPayload() cannot produce a complete next-state record —
      // which is why `schema_invalid` fired on every live amendment.
      //
      // THIS IS DELIBERATELY WIDER THAN src/remote/restClient.js's
      // normalizeEmployment(), which drops the whole block. Every other field
      // above matches it exactly; these do not, because the reference
      // normalizer is out of this pass's scope and leaving the production
      // graph unable to complete an amendment would be the worse trade. The
      // asymmetry is one-directional (the graph can source MORE, never
      // something different) and it disappears the moment normalizeEmployment()
      // carries the block through. test/n8nUc06Parity.test.js feeds THIS object
      // into the reference gates, so the two still decide identically.
      full_name: empRaw.full_name ?? basicInfo.name ?? null,
      start_date: basicInfo.provisional_start_date ?? empRaw.provisional_start_date ?? null,
      has_seniority_date: basicInfo.has_seniority_date ?? empRaw.has_seniority_date ?? null,
      tax_servicing_countries: basicInfo.tax_servicing_countries ?? empRaw.tax_servicing_countries ?? null,
      tax_job_category: basicInfo.tax_job_category ?? empRaw.tax_job_category ?? null,
      login_email: basicInfo.login_email ?? empRaw.login_email ?? null,
      mobile_number: basicInfo.mobile_number ?? empRaw.mobile_number ?? null,
      // THE TWO BLOCKS AS REMOTE SENDS THEM, unflattened — now matching
      // src/remote/restClient.js's normalizeEmployment(), which carries the
      // same pair. The contract-amendment form uses the SAME field names
      // contract_details does (annual_gross_salary, work_hours_per_week,
      // work_schedule, contract_duration_type, contract_end_date,
      // role_description, experience_level, compensation_currency_code — all
      // name-identical, verified against seven countries' live forms), so
      // sourceValue() below looks a required field up under its own name and
      // no mapping table is invented anywhere. The asymmetry this comment used
      // to record ("deliberately WIDER than normalizeEmployment()") is closed:
      // the two normalizers now carry the same fields.
      basic_information: empRaw.basic_information ?? null,
      contract_details: empRaw.contract_details ?? null,
      // `amendment_contract_id` for POST /v1/contract-amendments. Read but not
      // used by this node — the write happens after dual approval, in the Node
      // path — and carried so the graph's downstream nodes and audit row can
      // see which contract a decision was made against.
      active_contract_id: empRaw.active_contract_id ?? null,
    }
  : null;

// A schema we could not fetch is NOT a schema with no required fields
// (finding F-15): `{required: []}` validates any payload at all, so the old
// `?? []` fallback turned invariant #2 into a gate that always opened. null
// here, escalate below — same rule as RemoteClient.getCountrySchema() and
// src/uc06/policyEngine.js.
// THE FORM IS `GET /v1/contract-amendments/schema?employment_id=&country_code=`,
// not `/v1/countries/{ALPHA3}/employment_basic_information`. That older form has
// NO salary property and NO hours property at all, so it structurally cannot
// express the amendment this use case exists to make, and the only write verb
// it has refuses `active` employments (the one status this graph's gate 2
// admits). Both [CONFIRMED live 2026-08-18] — see
// src/remote/restClient.js's getContractAmendmentSchema() for the captures.
const schemaRaw = $('Fetch Country Schema (Remote)').first().json?.data ?? null;
// The WHOLE schema is carried, not just `required`. Narrowing it to
// `{required}` threw away `properties` and `additionalProperties: false`, which
// is precisely what tells buildAmendmentPayload() which field names this form
// accepts and that an undeclared key is a rejection rather than a harmless
// extra. Live, every country form declares both [CONFIRMED 2026-08-18].
const countrySchema = schemaRaw && Array.isArray(schemaRaw.required) ? schemaRaw : null;

// --- restClient.listPayrollRuns(), PORTED: paginate, dedupe, filter --------
//
// THIS NODE USED TO READ `$input.first().json?.data?.payroll_runs ?? []` — one
// page, no dedupe, no country filter — from an HTTP node pointed at
// `/v1/company-payroll-runs?company_id=…`, WHICH IS NOT A PATH REMOTE HAS.
// Remote's index lists the operation as *"List Company Payroll Runs"* with
// reference id `get_v1_payroll-runs`: the TITLE was mistaken for the URL. The
// wrong path 404s, `onError: continueRegularOutput` reports that 404 as a
// SUCCESS carrying an error object, and the gate below escalated
// `upstream_payroll_runs_404` — every live run, while looking exactly like a
// cautious gate doing its job. See src/remote/restClient.js's
// listPayrollRuns() header for the live evidence (commit cd445f0).
//
// REPOINTING THE URL ALONE WOULD HAVE BEEN WORSE THAN THE DEAD GATE. Three
// live facts, all [CONFIRMED] against gateway.remote-sandbox.com 2026-08-18:
//
//   1. THE ENDPOINT TAKES NO FILTERS. `company_id`, `country_code`, `country`
//      and `status` each answer 422 `"Unexpected field"`. The company comes
//      from the token's scope; the company id this graph passed for months
//      was never sent anywhere. So the narrowing has to happen HERE.
//   2. THE CALENDAR IS COMPANY-WIDE AND MULTI-COUNTRY — live it spans SG, FR,
//      CA, NL and US, with 49 overlapping period pairs. `evaluateCutoff()`
//      takes the FIRST cycle whose period contains the effective date, so an
//      unfiltered calendar would hand a French employee Singapore's 6 April
//      cutoff instead of France's 20 April one: a visible failure traded for a
//      silent wrong answer about payroll timing.
//   3. `total_pages` LIES — it reports 1 while later pages still return rows —
//      and ROWS REPEAT (34 rows for 17 distinct ids in one walk). So paging
//      stops on an EMPTY PAGE, never on `total_pages`, and rows are deduped by
//      id. A row with no id is KEPT under a colliding-with-nothing key: a
//      dropped cycle reads as "no cycle governs this date", which is a claim,
//      not an absence.
//
// The filter axis is `country.alpha_2_code` — the same axis pickAlpha2() above
// puts on `employment.country_code`, so no alpha-3 conversion table is
// invented to compare them (prime directive #4).
function mergePayrollPages(items) {
  const byId = new Map();
  for (let page = 0; page < items.length; page++) {
    const body = items[page] && items[page].json;
    // A failed page is already recorded in upstreamFailures above and escalates
    // before any of this is read; skipping it here keeps a 403 on page 2 from
    // ALSO being reported as an unreadable shape.
    if (describeUpstreamError(body, 'payroll_runs')) continue;
    const batch = body && body.data ? body.data.payroll_runs : undefined;
    // An unusable shape is NOT an empty calendar, for the same reason a failed
    // fetch is not (finding F-15): coercing it to [] turns "we could not read
    // it" into "there are none", which the cutoff gate then reports as a fact.
    if (!Array.isArray(batch)) return null;
    for (let i = 0; i < batch.length; i++) {
      const run = batch[i];
      if (!run) continue;
      const key = run.id !== undefined && run.id !== null ? 'id:' + run.id : 'anon:' + page + ':' + byId.size;
      if (!byId.has(key)) byId.set(key, run);
    }
  }
  return Array.from(byId.values());
}

const mergedPayrollRuns = mergePayrollPages(payrollPages);
const payrollCountry = employment ? employment.country_code : null;

let payrollCycles = [];
let payrollUnusableReason = null;
if (mergedPayrollRuns === null) {
  payrollUnusableReason =
    'the payroll calendar answered in a shape this gate cannot read — an unreadable page is not an empty calendar';
} else if (!payrollCountry) {
  // FAIL CLOSED ON NO USABLE COUNTRY. Without an alpha-2 code the company-wide
  // calendar cannot be narrowed to this employee, and the honest reading of
  // that is "we cannot say which cycle governs", never "here is the first one
  // that happened to sort first". This is exactly what RemoteClient
  // .listPayrollRuns() returns null for, and what src/uc06/workflow.js already
  // records as a payroll_runs failure — the behaviour is unchanged from today,
  // it is the SUCCESS path beside it that this rewrite makes reachable.
  payrollUnusableReason =
    'the employment carries no usable ISO 3166-1 alpha-2 country, so the company-wide multi-country calendar cannot be narrowed to this employee';
} else {
  payrollCycles = mergedPayrollRuns.filter(
    (run) => pickAlpha2([run && run.country && run.country.alpha_2_code]) === payrollCountry
  );
}

if (payrollUnusableReason && !findUpstreamFailure(upstreamFailures, 'payroll_runs')) {
  // `status: 404` and `kind: 'not_found'` are what src/uc06/workflow.js records
  // for the same condition, and matching it is what keeps this port's reason
  // and flags identical to the reference implementation's. It is the imprecise
  // part of that shape — nothing 404'd on the no-country path, we simply cannot
  // ask the right question — so the MESSAGE says which of the two it was, and
  // that message is what lands in audit_log.details. Changing the status would
  // have to change src/shared/upstreamFailure.js's vocabulary for both paths at
  // once; a divergence introduced here alone would be worse than the imprecision.
  upstreamFailures.push({
    call: 'payroll_runs',
    status: 404,
    kind: UPSTREAM_NOT_FOUND,
    message: payrollUnusableReason.slice(0, 200),
  });
}

// --- identity: an authenticated signal, never a claim -----------------------
// Defence in depth on top of the construction fix: BOTH sides must carry a real
// company id. Two absent values matching proves nothing.
const session = request.session;
const identityVerified = Boolean(
  session && session.companyId && employment && employment.company_id && session.companyId === employment.company_id
);

// --- changeParser.amendmentType() — deterministic, NOT an LLM call ---------
const CHANGE_FIELDS = ['salary', 'jobTitle', 'weeklyHours'];
function amendmentType(changes) {
  const present = CHANGE_FIELDS.filter((f) => changes && changes[f] !== undefined);
  if (present.length === 0) return 'OTHER';
  if (present.length > 1) return 'COMPOSITE';
  const field = present[0];
  if (field === 'salary') {
    // Increase-vs-decrease is only a FACT when both amounts are real numbers
    // (finding F-31). `null >= null` is `0 >= 0` — true — so an amendment
    // stating no figures used to be typed SALARY_INCREASE. Quoted amounts are
    // refused too: `>=` on strings compares lexically ("9" >= "10" is true).
    const oldAmount = changes.salary.oldAmount;
    const newAmount = changes.salary.newAmount;
    const realAmount = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!realAmount(oldAmount) || !realAmount(newAmount)) return 'SALARY_CHANGE_UNDETERMINED';
    return newAmount >= oldAmount ? 'SALARY_INCREASE' : 'SALARY_DECREASE';
  }
  if (field === 'jobTitle') return 'JOB_TITLE_CHANGE';
  if (field === 'weeklyHours') return 'WORKING_HOURS_CHANGE';
  return 'OTHER';
}

// --- money.js: toRemoteInteger() ---------------------------------------------
function toRemoteInteger(humanAmount) {
  if (typeof humanAmount !== 'number' || Number.isNaN(humanAmount)) {
    throw new TypeError('toRemoteInteger expected a number, got ' + humanAmount);
  }
  return Math.round(humanAmount * 100);
}

// --- policyEngine.js: buildAmendmentPayload() — full next-state, not a diff -
//
// THE PAYLOAD IS BUILT AGAINST THE SCHEMA THAT ARRIVED, NOT AGAINST A FIXTURE.
// This used to emit four fixed keys — {job_title, weekly_hours, base_salary,
// currency} — the field names in src/remote/mockServer.js's COUNTRY_SCHEMAS,
// not Remote's. Live, GET /v1/countries/NLD/employment_basic_information
// returns required [has_seniority_date, name, job_title,
// provisional_start_date, tax_servicing_countries, tax_job_category,
// login_email] with additionalProperties FALSE [CONFIRMED 2026-08-18], so six
// of seven required fields were missing AND three of the four keys sent are not
// properties of that form at all. schema_invalid fired on every live amendment,
// ahead of the payroll gate.
//
// Sourced from the employment record: job_title, name (<- full_name),
// provisional_start_date (<- start_date), the salary/hours/currency trio, and
// effective_date (<- the request's own requestedEffectiveDate).
// NOT sourceable, because normalizeEmployment() does not surface them:
// has_seniority_date, tax_servicing_countries, tax_job_category, login_email,
// mobile_number. They are read under their own names anyway so a widened
// normalizer needs no change here; until then they surface as missing_<field>,
// never as a defaulted or guessed value.
//
// See src/uc06/policyEngine.js's header for the full note, including why the
// right form is actually GET /v1/contract-amendments/schema.
const CARRY_THROUGH = {
  job_title: (e) => e.job_title,
  name: (e) => e.full_name ?? e.name,
  provisional_start_date: (e) => e.start_date ?? e.provisional_start_date,
  base_salary: (e) => e.base_salary,
  annual_gross_salary: (e) => e.base_salary,
  currency: (e) => e.currency,
  compensation_currency_code: (e) => e.currency,
  weekly_hours: (e) => e.weekly_hours,
  work_hours_per_week: (e) => e.weekly_hours,
  effective_date: (e, ctx) => ctx.requestedEffectiveDate,
  has_seniority_date: (e) => e.has_seniority_date,
  tax_servicing_countries: (e) => e.tax_servicing_countries,
  tax_job_category: (e) => e.tax_job_category,
  login_email: (e) => e.login_email,
  mobile_number: (e) => e.mobile_number,
  // A SALARY DECREASE needs two things no record can supply, enforced by Remote
  // from the CURRENT contract rather than through the schema's allOf. Live
  // 2026-08-18, identical payloads on NL employment 293527ed-…:
  //   3900000 (increase) -> 200 · 3600000 (no change) -> 200
  //   3300000 (decrease) -> 422 {"salary_decrease_reason":["can't be blank"],
  //                              "was_employee_informed":["can't be blank"]}
  // Both are human judgements. Read from the request; when it is silent they
  // surface as missing_<field> and the amendment escalates naming them.
  salary_decrease_reason: (e, ctx) => (ctx.changes && ctx.changes.salary ? ctx.changes.salary.decreaseReason : undefined),
  was_employee_informed: (e, ctx) => (ctx.changes && ctx.changes.salary ? ctx.changes.salary.employeeInformed : undefined),
};

// ONE required field -> its value, looked up under its own name. An explicit
// CARRY_THROUGH entry first (those encode a rename the API itself performs —
// the form's `name` is the record's `full_name`), then the record's own blocks:
// top level, basic_information, contract_details. All three are Remote's
// vocabulary, so a hit is Remote agreeing with Remote rather than this file
// guessing. A field none of them carries returns undefined and is left OUT;
// validateAgainstSchema() then names it, which is the whole mechanism for "we
// do not have this value" and must stay the only one.
function sourceValue(field, employment, ctx) {
  const e = employment || {};
  if (Object.prototype.hasOwnProperty.call(CARRY_THROUGH, field)) {
    const explicit = CARRY_THROUGH[field](e, ctx);
    if (usableValue(explicit)) return explicit;
  }
  if (usableValue(e[field])) return e[field];
  const basic = e.basic_information || {};
  if (usableValue(basic[field])) return basic[field];
  const contract = e.contract_details || {};
  if (usableValue(contract[field])) return contract[field];
  return undefined;
}

// Coerce a value THE RECORD supplied to the type THE SCHEMA declares — only in
// that direction. Live, contract_details.work_hours_per_week is the STRING "24"
// on one NL record and the NUMBER 40 on another, while the form declares
// {"type":"number"} and the API enforces it: 24 -> 200, "24" -> 422 "Type
// mismatch. Expected Number but got String." So submitting Remote's own value
// back verbatim is rejected by Remote. NOT applied to a requested change: a
// quoted "39000" from a request portal is still refused outright by
// CHANGE_TARGETS, because that string is unvalidated human input and coercing
// it is how a 100x scaling error gets in.
function coerceToSchemaType(value, field, countrySchema) {
  const props = countrySchema && countrySchema.properties ? countrySchema.properties : null;
  const spec = props ? props[field] : null;
  const declared = spec ? spec.type : undefined;
  const types = Array.isArray(declared) ? declared : [declared];
  if (typeof value !== 'string' || value.trim() === '') return value;
  if (types.indexOf('number') === -1 && types.indexOf('integer') === -1) return value;
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  if (types.indexOf('integer') !== -1 && types.indexOf('number') === -1 && !Number.isInteger(num)) return value;
  return num;
}

// Resolve the schema's own allOf if/then/else rules against a candidate
// payload. NOT optional: validateAgainstSchema() checks the top-level required
// list, and the API enforces the conditionals too, in BOTH directions. Live
// 2026-08-18 on active NL employments:
//   fixed_term -> contract_end_date "can't be blank"
//   part_time  -> default_weekly_hours + part_time_salary_confirmation
//   full_time  -> part_time_salary_confirmation "must be empty"
// The supported subset is exactly what the live forms use: if.properties.<f>.const
// (with if.required), then/else required lists, and then/else properties.<f>:
// false meaning "this branch forbids the field". A rule this does not understand
// is SKIPPED rather than guessed at. x-jsf-logic (JSONLogic computed minimums)
// is NOT evaluated — a real gap, and the write fails loudly against it rather
// than this node re-implementing a rules engine.
function effectiveSchema(countrySchema, payload) {
  const base = Array.isArray(countrySchema && countrySchema.required) ? countrySchema.required : [];
  const required = new Set(base);
  const forbidden = new Set();
  const rules = Array.isArray(countrySchema && countrySchema.allOf) ? countrySchema.allOf : [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== 'object' || !rule.if) continue;
    const holds = matchesCondition(rule.if, payload);
    if (holds === null) continue; // not understood -> neither branch. See below.
    const branch = holds ? rule.then : rule.else;
    if (!branch || typeof branch !== 'object') continue;
    if (Array.isArray(branch.required)) {
      for (let j = 0; j < branch.required.length; j++) required.add(branch.required[j]);
    }
    if (branch.properties && typeof branch.properties === 'object') {
      const names = Object.keys(branch.properties);
      for (let j = 0; j < names.length; j++) {
        if (branch.properties[names[j]] === false) forbidden.add(names[j]);
      }
    }
  }
  // A field cannot be both. `then.required` is an explicit statement about THIS
  // branch; a `false` from a different rule's branch yields to it.
  required.forEach((field) => forbidden.delete(field));
  return { required: Array.from(required), forbidden: forbidden };
}

// `true`, `false`, or `null` for "this rule uses something we do not model".
//
// THE NULL IS THE WHOLE POINT, learned the expensive way. Returning `false` for
// an unrecognised condition quietly selects the `else` branch — and `else` is
// where these forms put their PROHIBITIONS. The live Dutch rule is
//     if   annual_gross_salary <= 7199999   (one cent below the current salary)
//     then required [salary_decrease_reason, was_employee_informed]
//     else those two are FORBIDDEN
// so a resolver that did not understand `maximum` took `else` and concluded a
// salary DECREASE must not carry a decrease reason — the exact inversion of what
// Remote requires. Proven in production: execution 5098, a 72,000 -> 66,000
// amendment, passed the schema gate with neither attestation. "Not understood"
// and "false" are different answers and must stay different.
//
// MODELLED: `const`, the numeric bounds maximum/minimum/exclusiveMaximum/
// exclusiveMinimum, and `if.required`. The bounds are how Remote expresses "is
// this a decrease" and "is this below the statutory floor", materialised per
// employment — which is why the schema endpoint takes an employment id.
//
// An ABSENT value never satisfies a condition, which is what makes an unsourced
// field fall to `else` rather than silently opening `then`.
const NUMERIC_BOUNDS = {
  maximum: (v, b) => v <= b,
  minimum: (v, b) => v >= b,
  exclusiveMaximum: (v, b) => v < b,
  exclusiveMinimum: (v, b) => v > b,
};
const BOUND_NAMES = Object.keys(NUMERIC_BOUNDS);

function matchesCondition(condition, payload) {
  const props = condition.properties;
  let holds = true;
  if (props && typeof props === 'object') {
    const names = Object.keys(props);
    for (let i = 0; i < names.length; i++) {
      const spec = props[names[i]];
      if (!spec || typeof spec !== 'object') return null;
      const bounds = BOUND_NAMES.filter((k) => typeof spec[k] === 'number');
      const hasConst = 'const' in spec;
      if (!hasConst && bounds.length === 0) return null; // not modelled -> skip the rule
      const value = payload ? payload[names[i]] : undefined;
      if (hasConst && value !== spec.const) holds = false;
      for (let j = 0; j < bounds.length; j++) {
        // A non-number can never satisfy a numeric bound, and that is not an
        // unmodelled rule — it is a payload that fails this branch.
        if (typeof value !== 'number' || !NUMERIC_BOUNDS[bounds[j]](value, spec[bounds[j]])) holds = false;
      }
    }
  }
  if (Array.isArray(condition.required)) {
    for (let i = 0; i < condition.required.length; i++) {
      if (!usableValue(payload ? payload[condition.required[i]] : undefined)) holds = false;
    }
  }
  return holds;
}

// The FIRST alias a schema declares wins, so the schema names the field and
// this list never does. `companion` marks a value riding with another change (a
// currency belongs to an amount); a form with no field for it is not refusing
// the amendment, so it is skipped silently.
//
// A VALUE IS CLASSIFIED BEFORE ANY ARITHMETIC RUNS (finding F-31, the same shape
// as UC-05's F-28 and UC-07's F-29). `toRemoteInteger(null)` THREW out of this
// node, upstream of Claim Ticket and Append Audit Log, so a blank salary lost
// the decision entirely instead of failing closed to a durable, audited
// escalate. The refusal is not a default: coercing an absent amount to 0 would
// draft a decrease-to-zero for a human to one-click approve, and a quoted
// "39000" is refused rather than coerced because that is how a 100x scaling
// error gets in. HOURS ARE LOOSER THAN MONEY on purpose — live
// contract_details.work_hours_per_week is the STRING "24".
const realNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const presentValue = (v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));

const CHANGE_TARGETS = [
  { key: 'jobTitle', field: 'newValue', aliases: ['job_title'], legacy: 'job_title', stated: (c) => c.jobTitle.newValue, derivable: (v) => typeof v === 'string' && v.trim() !== '', value: (v) => v },
  { key: 'weeklyHours', field: 'newValue', aliases: ['work_hours_per_week', 'weekly_hours'], legacy: 'weekly_hours', stated: (c) => c.weeklyHours.newValue, derivable: presentValue, value: (v) => v },
  { key: 'salary', field: 'newAmount', aliases: ['annual_gross_salary', 'base_salary'], legacy: 'base_salary', stated: (c) => c.salary.newAmount, derivable: realNumber, value: (v) => toRemoteInteger(v) },
  { key: 'salary', field: 'currency', companion: true, aliases: ['compensation_currency_code', 'currency'], legacy: 'currency', stated: (c) => c.salary.currency, derivable: presentValue, value: (v) => v },
];

const LEGACY_CARRY = ['job_title', 'weekly_hours', 'base_salary', 'currency'];

// `properties` present -> those names are what the form accepts.
// `additionalProperties === false` -> anything else is a REJECTION.
// Neither -> the schema states requirements and says nothing about what is
// allowed; JSON Schema's own default there is permissive, so inventing a
// constraint would be the very move that caused this bug. The mock's
// {required: [...]} shape is that case.
function schemaVocabulary(countrySchema) {
  const required = Array.isArray(countrySchema && countrySchema.required) ? countrySchema.required : [];
  const props = countrySchema ? countrySchema.properties : null;
  const hasProps = Boolean(props) && typeof props === 'object' && !Array.isArray(props);
  const declared = new Set((hasProps ? Object.keys(props) : []).concat(required));
  return { required, declared, closed: hasProps && countrySchema.additionalProperties === false };
}

function usableValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function buildAmendmentPayload(emp, changes, countrySchema, requestedEffectiveDate) {
  const e = emp || {};
  const chg = changes || {};
  const ctx = { requestedEffectiveDate: requestedEffectiveDate, changes: chg };
  const vocab = schemaVocabulary(countrySchema);

  const payload = {};
  const unexpressible = [];
  const underivable = [];
  const refused = new Set();

  for (let i = 0; i < CHANGE_TARGETS.length; i++) {
    const target = CHANGE_TARGETS[i];
    if (!chg[target.key]) continue;

    // Classify BEFORE arithmetic. A companion is not reported: a currency
    // nobody stated is simply omitted, and validateAgainstSchema() names it as
    // missing_<field> if the form requires it.
    const stated = target.stated(chg);
    if (!target.derivable(stated)) {
      if (!target.companion) {
        underivable.push(target.key + '.' + target.field);
        // The field this amendment was ABOUT is barred from carry-through
        // below: filling it with the CURRENT salary would put the old figure
        // under the very key the requester meant to change, in a row whose
        // point is that the new figure is unknown.
        for (let j = 0; j < target.aliases.length; j++) refused.add(target.aliases[j]);
        refused.add(target.legacy);
      }
      continue;
    }

    let name = null;
    for (let j = 0; j < target.aliases.length; j++) {
      if (vocab.declared.has(target.aliases[j])) { name = target.aliases[j]; break; }
    }
    if (!name && !vocab.closed) name = target.legacy;
    if (!name) {
      // A form that cannot express this change must not silently drop it and
      // then pass validation on the leftovers — that approves a SALARY_INCREASE
      // whose amount appears nowhere in the validated payload.
      if (!target.companion && unexpressible.indexOf(target.key) === -1) unexpressible.push(target.key);
      continue;
    }
    payload[name] = target.value(stated);
  }

  const carry = (names) => {
    for (let i = 0; i < names.length; i++) {
      const field = names[i];
      if (field in payload || refused.has(field)) continue;
      const value = sourceValue(field, e, ctx);
      if (usableValue(value)) payload[field] = coerceToSchemaType(value, field, countrySchema);
      // Not usable -> left out on purpose; validateAgainstSchema() reports it as
      // missing_<field>, the gate that already exists for exactly this.
    }
  };
  const baseCarry = vocab.closed ? vocab.required : Array.from(new Set(vocab.required.concat(LEGACY_CARRY)));
  carry(baseCarry);

  // The conditionals, resolved against what the payload now says — AFTER the
  // carry above, because which branch applies depends on values it sourced
  // (work_schedule, contract_duration_type) and on the amount written above.
  // A SALARY DECREASE'S two attestations fall out of here rather than out of a
  // special case: the form itself carries `if annual_gross_salary <=
  // <current - 1 cent> then required [salary_decrease_reason,
  // was_employee_informed]`, materialised for this employment.
  const conditional = effectiveSchema(countrySchema, payload);
  const extra = conditional.required.slice();
  carry(extra);

  // Fields THIS branch forbids. Live, a full_time payload carrying
  // part_time_salary_confirmation is refused with ["must be empty"] — a value
  // the record legitimately holds is still a rejection, so carrying it through
  // "because we have it" breaks the write.
  conditional.forbidden.forEach((field) => { delete payload[field]; });

  // WHAT IS *REQUIRED*, NOT WHAT WAS CARRIED. The two differ on an open schema,
  // where LEGACY_CARRY adds four keys the form never demanded.
  const effectiveRequired = Array.from(new Set(vocab.required.concat(extra))).filter((f) => !conditional.forbidden.has(f));
  return { payload: payload, unexpressible: unexpressible, underivable: underivable, effectiveRequired: effectiveRequired };
}

// --- schemaValidator.js: validateAgainstSchema() ----------------------------
function validateAgainstSchema(payload, schema) {
  const required = (schema && schema.required) || [];
  const missing = required.filter((field) => {
    const value = payload ? payload[field] : undefined;
    return value === undefined || value === null || value === '';
  });
  return { valid: missing.length === 0, missing };
}

// --- cutoffEngine.js: evaluateCutoff() --------------------------------------
const URGENT_WINDOW_HOURS = 48;

// parseUtcInstant() — ported from cutoffEngine.js (finding F-26a). A zone-less
// timestamp ("2026-09-05 17:00:00") is parsed by `new Date()` in whatever zone
// the executing machine sits in, so the same amendment flipped between blocked
// and approvable across UTC / US Pacific / Tokyo. n8n's own container zone is
// not a payroll fact; pin the zone-less form to UTC, leave an explicit offset
// alone.
function parseUtcInstant(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value.trim();
  if (!text) return NaN;
  const zoneless = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(text);
  if (zoneless) return Date.parse(zoneless[1] + 'T' + zoneless[2] + 'Z');
  return Date.parse(text);
}

function evaluateCutoff(args) {
  const effective = parseUtcInstant(args.requestedEffectiveDate);
  const nowMs = parseUtcInstant(args.now);
  const cycle = (args.payrollCycles || []).find((c) => effective >= parseUtcInstant(c.period_start) && effective <= parseUtcInstant(c.period_end));
  if (!cycle) {
    return { cycle: null, noMatchingCycle: true, cutoffUnknown: false, cutoffAlreadyPassed: false, urgentWithin48h: false, retroactive: false, hoursUntilCutoff: null };
  }
  const cutoffMs = parseUtcInstant(cycle.cutoff_date);
  // An unreadable cutoff fails CLOSED (finding F-26b): NaN comparisons are all
  // false, so "passed" and "urgent" both used to read false and an unknown
  // cutoff looked like a comfortable runway.
  if (Number.isNaN(cutoffMs) || Number.isNaN(nowMs)) {
    return { cycle, noMatchingCycle: false, cutoffUnknown: true, cutoffAlreadyPassed: false, urgentWithin48h: false, retroactive: false, hoursUntilCutoff: null };
  }
  const hoursUntilCutoff = (cutoffMs - nowMs) / (1000 * 60 * 60);
  const cutoffAlreadyPassed = hoursUntilCutoff < 0;
  const urgentWithin48h = !cutoffAlreadyPassed && hoursUntilCutoff <= URGENT_WINDOW_HOURS;
  return { cycle, noMatchingCycle: false, cutoffUnknown: false, cutoffAlreadyPassed, urgentWithin48h, retroactive: cutoffAlreadyPassed, hoursUntilCutoff };
}

// --- the overlapping-cycle ambiguity, which country filtering does NOT fix --
//
// KNOWN AND DELIBERATELY UNRESOLVED. Live, the Netherlands has TWO cycles
// covering the same June period with DIFFERENT cutoffs — a `main` run locking
// 2026-06-20 and a `one_off` run locking 2026-06-10. Country filtering cannot
// separate them: both are NL. `evaluateCutoff()`'s `.find()` therefore returns
// whichever the API happened to list first, and a ten-day difference in a
// payroll lock is the difference between an amendment landing and not landing.
//
// Choosing between them needs a rule over `status`/`type` ("prefer the main
// run", "ignore completed runs") that this repo CANNOT confirm from the API —
// nothing in Remote's reference says a one_off run is not the governing cycle
// for a mid-period change, and inventing that rule would be exactly the
// title-mistaken-for-a-path move that produced the bug above. So the
// ambiguity is REPORTED, not resolved: two covering cycles that disagree about
// the lock escalate to a human, who can look at the actual runs. The reference
// implementation carries the identical pair — see src/uc06/cutoffEngine.js.
//
// Cycles that agree on the cutoff are NOT ambiguous in any consequential
// sense — `.find()` still picks one arbitrarily, but every candidate answers
// the only question this gate asks ("is the lock already passed?") the same
// way, so a human adds nothing.
function cyclesCovering(cycles, requestedEffectiveDate) {
  const effective = parseUtcInstant(requestedEffectiveDate);
  return (cycles || []).filter(
    (c) => effective >= parseUtcInstant(c.period_start) && effective <= parseUtcInstant(c.period_end)
  );
}

function distinctCutoffCount(cycles) {
  const seen = new Set();
  for (let i = 0; i < cycles.length; i++) {
    const ms = parseUtcInstant(cycles[i].cutoff_date);
    // An unreadable cutoff is its own bucket, so "one readable, one unreadable"
    // counts as a disagreement — one of them says escalate and the other does
    // not, which is precisely a decision a coin-flip must not make.
    seen.add(Number.isNaN(ms) ? 'unreadable' : String(ms));
  }
  return seen.size;
}

// --- changeParser.js: draftSummaryTemplate() — the deterministic fallback --
function draftSummaryTemplate(changes, requestedEffectiveDate) {
  const parts = [];
  if (changes.salary) parts.push('salary from ' + changes.salary.oldAmount + ' to ' + changes.salary.newAmount + ' ' + changes.salary.currency);
  if (changes.jobTitle) parts.push('job title from "' + changes.jobTitle.oldValue + '" to "' + changes.jobTitle.newValue + '"');
  if (changes.weeklyHours) parts.push('weekly hours from ' + changes.weeklyHours.oldValue + ' to ' + changes.weeklyHours.newValue);
  const changeText = parts.length ? parts.join('; ') : 'no recognized fields';
  return 'Amendment: change ' + changeText + ', effective ' + requestedEffectiveDate + '.';
}

// --- policyEngine.js: evaluate() — ordered gates, first failure wins -------
const type = amendmentType(request.changes);
let decision, reason;
let flags = [];
let payload = null;
let cutoff = null;

// Gate 0 — the employment read, ahead of every gate that reads it. Note the
// normalizer above fills empRaw's missing fields with defaults ('unknown'
// status, null company_id), so a swallowed fetch produces a plausible-looking
// employment object that fails identity: the failure must be caught here, not
// inferred from the shape of what it left behind.
const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'employment'));
if (employmentFailure) {
  decision = employmentFailure.decision; reason = employmentFailure.reason; flags = employmentFailure.flags;
} else if (!identityVerified) {
  decision = 'escalate'; reason = 'identity_not_verified'; flags = ['identity_not_verified'];
} else if (!employment || employment.status !== 'active') {
  decision = 'escalate'; reason = 'employee_not_active'; flags = ['employee_not_active'];
} else {
  const built = buildAmendmentPayload(employment, request.changes, countrySchema, request.requestedEffectiveDate);
  payload = built.payload;
  // The failure list is checked BEFORE the schema's own shape: a read that
  // failed produced no schema anyone may validate against. This reason already
  // names the upstream problem; the flag adds WHICH call and WHAT status, so a
  // 404 on an unsupported country and a 403 from a scope-less token are told
  // apart in the audit row.
  const schemaFailure = findUpstreamFailure(upstreamFailures, 'country_schema');
  if (schemaFailure || !countrySchema || !Array.isArray(countrySchema.required)) {
    decision = 'escalate'; reason = 'country_schema_unavailable';
    flags = schemaFailure
      ? ['country_schema_unavailable', 'upstream_country_schema_' + (schemaFailure.status ?? 'error')]
      : ['country_schema_unavailable'];
  } else {
  if (built.underivable.length) {
    // A change whose stated value is not a value at all — blank, null, NaN or a
    // quoted amount — is refused FIRST, ahead of every question about which
    // field name the form uses, and it is the more actionable message. This is
    // what used to leave the run with no claim, no record and no audit row.
    decision = 'escalate'; reason = 'change_value_underivable';
    flags = ['change_value_underivable'].concat(built.underivable.map((f) => 'underivable_' + f.replace('.', '_')));
  } else if (built.unexpressible.length) {
    // A requested change the form has no field for is a refusal in its own
    // right, and it is reported BEFORE validation: the payload reaching
    // validateAgainstSchema() no longer carries that change, so a valid verdict
    // on it would be a verdict about a different amendment than the one asked
    // for. Live, this is what employment_basic_information says about a salary
    // change — that form has no salary field at all.
    decision = 'escalate'; reason = 'change_not_expressible';
    flags = ['change_not_expressible'].concat(built.unexpressible.map((f) => 'unexpressible_' + f));
  } else {
  // Validated against the EFFECTIVE required list — the schema's own `required`
  // plus whatever its allOf branches add for this payload, minus what they
  // forbid. Checking only countrySchema.required passes a payload the real
  // write rejects (live: a fixed_term amendment with no contract_end_date is
  // 422 "can't be blank" while satisfying `required` completely).
  const schemaCheck = validateAgainstSchema(payload, { required: built.effectiveRequired || countrySchema.required });
  if (!schemaCheck.valid) {
    decision = 'escalate'; reason = 'schema_invalid';
    flags = ['schema_invalid'].concat(schemaCheck.missing.map((f) => 'missing_' + f));
  } else {
    // The payroll calendar read, checked BEFORE the cutoff engine runs on it:
    // an empty cycle list from a failed fetch is indistinguishable from a
    // company that genuinely has none, and both report `no_matching_payroll_
    // cycle`. Same F-15 shape as the schema gate — "could not fetch" must never
    // become a fact about the data.
    const payrollFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'payroll_runs'));
    if (payrollFailure) {
      decision = payrollFailure.decision; reason = payrollFailure.reason; flags = payrollFailure.flags;
    } else {
      // The ambiguity gate runs BEFORE evaluateCutoff(), because evaluateCutoff()
      // cannot express "I do not know which of these governs" — it returns one
      // cycle, and a recorded cycle is an answer. This gate landed HERE first
      // and lived for a while as a deliberate, one-directional divergence from
      // src/uc06/policyEngine.js, which still took the first covering cycle.
      // That handoff is closed: the reference now has the same gate
      // (cyclesCovering/distinctCutoffCount in src/uc06/cutoffEngine.js), and
      // test/n8nUc06Parity.test.js asserts the two AGREE — decision, reason,
      // flags and recorded candidates alike — where it used to pin the gap.
      const coveringCycles = cyclesCovering(payrollCycles, request.requestedEffectiveDate);
      if (coveringCycles.length > 1 && distinctCutoffCount(coveringCycles) > 1) {
        decision = 'escalate';
        reason = 'ambiguous_payroll_cycle';
        flags = ['ambiguous_payroll_cycle'];
        cutoff = {
          // `cycle: null` on purpose: recording one of the candidates would put
          // a coin-flip cutoff into the amendment row and the audit trail.
          cycle: null,
          noMatchingCycle: false,
          cutoffUnknown: true,
          cutoffAlreadyPassed: false,
          urgentWithin48h: false,
          retroactive: false,
          hoursUntilCutoff: null,
          ambiguousCycles: coveringCycles.map((c) => ({
            id: c.id ?? null,
            type: c.type ?? null,
            status: c.status ?? null,
            cutoff_date: c.cutoff_date ?? null,
          })),
        };
      } else {
      cutoff = evaluateCutoff({ requestedEffectiveDate: request.requestedEffectiveDate, now: request.now, payrollCycles });
      if (cutoff.noMatchingCycle) {
        decision = 'escalate'; reason = 'no_matching_payroll_cycle'; flags = ['no_matching_payroll_cycle'];
      } else if (cutoff.cutoffUnknown) {
        decision = 'escalate'; reason = 'cutoff_date_unknown'; flags = ['cutoff_date_unknown'];
      } else if (cutoff.cutoffAlreadyPassed) {
        decision = 'escalate'; reason = 'cutoff_lock_passed'; flags = ['cutoff_lock_passed', 'retroactive_change'];
      } else {
        flags = cutoff.urgentWithin48h ? ['urgent_cutoff'] : [];
        decision = 'dual_approval_required'; reason = 'all_gates_passed';
      }
      }
    }
  }
  }
  }
}

// amendmentStore.js: the status a created row starts at.
const status = decision === 'dual_approval_required' ? 'pending_dual_approval' : 'escalated';

const summary = draftSummaryTemplate(request.changes, request.requestedEffectiveDate);

// riskEngine.js: UC-06's base tier is "medium"; any flag pushes it to "high".
const riskTier = flags.length > 0 ? 'high' : 'medium';

// `upstreamFailures` is carried so "Append Audit Log" can put WHICH call
// failed and WHAT it answered into `audit_log.details` — triage starts at the
// right service instead of hunting a phantom identity bug.
// `payrollCycles` is carried forward for the same reason `upstreamFailures` is:
// it is the OUTPUT of the ported listPayrollRuns() — paged, deduped and
// narrowed to this employee's country — and without it in the item, nothing
// downstream (or in an execution a human opens at 3am) can tell a calendar
// narrowed to three French cycles from one that silently read all seventeen.
// It is also what test/n8nUc06Parity.test.js feeds to the real policyEngine,
// exactly as it already feeds it this node's `employment` and `countrySchema`.
return [{ json: { ...request, employment, countrySchema, payrollCycles, decision, reason, flags, amendmentType: type, payload, cutoff, summary, status, riskTier, upstreamFailures } }];
