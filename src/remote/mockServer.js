// ---------------------------------------------------------------------------
// mockServer.js  —  A fake Remote API for local development & testing
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// You cannot (and should not) build against a real customer's live Remote
// account. So we run a small server that returns data shaped like Remote's real
// responses, for just the endpoints UC-01 needs. This is your "test harness":
// the whole automation can run end-to-end against it with no external accounts.
//
// When you later get Remote Sandbox credentials, you point the REST client at
// the real sandbox instead of this — the rest of the code doesn't change.
//
// Uses only Node's built-in http module, so there is nothing to install.
// Run it with:  npm run mock     (listens on http://localhost:4010)
// ---------------------------------------------------------------------------

import { createServer } from "node:http";
import { Readable } from "node:stream";
import {
  CONTRACT_AMENDMENT_SCHEMAS,
  CONTRACT_AMENDMENT_SCHEMA_ERRORS,
} from "./fixtures/contractAmendmentSchemas.js";

// A tiny in-memory "database" of employees, shaped like Remote records.
// Note money is stored as integers ×100, exactly like the real API.
export const EMPLOYMENTS = {
  "emp_active_001": {
    id: "emp_active_001",
    // Remote publishes a SIX-CHARACTER code to the employee (Profile -> Job
    // and Pay) and it is the only identifier a third party can realistically
    // be given. The fixture ids here are this mock's own invention and are
    // the wrong SHAPE, so a demo that quick-filled one contradicted the
    // "6-character code" hint printed beside the field.
    short_id: "AO4T9X",
    email: "amara@acme.test",
    full_name: "Amara Okafor",
    status: "active",
    contract_type: "full_time",
    start_date: "2022-03-01",
    probation: false,
    base_salary: 5000000, // 50,000.00 (×100)
    currency: "USD",
    legal_entity_id: "le_ng_01",
    // UC-06 fields — added alongside the existing UC-01 fields rather than a
    // second fixture, since nothing in UC-01's tests compares the whole object.
    company_id: "co_amend_01",
    country_code: "NG",
    job_title: "Senior Engineer",
    weekly_hours: 40,
    // UC-04 fields: the employer's workation permission gate.
    //
    // THIS COMMENT USED TO SAY these come from "GET /v1/employments/{id}/
    // custom_fields, a [CONFIRMED] endpoint per UC-04.md §3". Both halves of
    // that are wrong, checked against the Sandbox on 2026-08-19:
    //
    //   - That path (UNDERSCORE) answers 404. The real one is
    //     `/v1/employments/{id}/custom-fields` (HYPHEN).
    //   - The real one returns values addressed by HUMAN NAME —
    //     `{name,type,value,custom_field_id}` — with no machine slug anywhere,
    //     and this Sandbox company's four custom fields are "Has Company
    //     Laptop?", "Languages", "Monthly Travel Days" and "Office Location
    //     Code". None is a workation permission.
    //   - `GET /v1/employments/{id}` carries no `custom_fields` key at all: 0
    //     occurrences across all 50 employments captured.
    //
    // So `custom_fields.workation_permission` is a shape THIS REPO invented,
    // and it is kept here only because src/uc04/policyEngine.js reads it and
    // this file may not change a use case in passing. It is the same field
    // src/remotebridge/enrichment.js synthesises and names in
    // `X-Standin-Enriched` — deliberate and documented there, and the reason
    // the modelling error stays invisible on the live path too. See
    // test/sandboxCaptureFidelity.test.js and docs/BUILD-LOG.md §3.71 for what
    // UC-04 would have to change for the gate to be answerable from the API.
    // `nationality` IS NOT A FIELD REMOTE RETURNS, and it used to sit here.
    // Zero occurrences of `nationality`, `citizenship` or `passport` in
    // `GET /v1/employments/{id}`'s live OpenAPI (captured 2026-08-19,
    // test/fixtures/sandboxCapture.js) and none on the work-authorization
    // object either. It was removed rather than kept, and the difference from
    // `custom_fields.workation_permission` two lines up is the whole rule:
    // that one is READ by src/uc04/policyEngine.js, so deleting it would move
    // UC-04 from "blocked for a reason someone must look at" to "blocked
    // everywhere", which this file may not do in passing. This one was read by
    // NOTHING — every consumer takes `factors.nationality` off the REQUEST,
    // where a human supplies it, which is correct because Remote cannot supply
    // it. So its only possible future was as a trap: `normalizeEmployment()`
    // returns the mock's flat shape untouched, so the first person to reach for
    // `employment.nationality` would have got a working value offline, forever,
    // against a field production never returns. That nearly happened while
    // building the UC-03 continuation (BUILD-LOG §3.72).
    custom_fields: { workation_permission: true },
  },
  "emp_terminated_002": {
    id: "emp_terminated_002",
    short_id: "KM8R2D",
    email: "kofi@acme.test",
    full_name: "Kofi Mensah",
    status: "terminated",
    contract_type: "full_time",
    start_date: "2020-01-15",
    probation: false,
    base_salary: 6000000,
    currency: "USD",
    legal_entity_id: "le_ng_01",
    company_id: "co_amend_01",
    country_code: "NG",
    job_title: "Support Specialist",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  // Dedicated to tests that PATCH (mutate) state — e.g. uc06.test.js's
  // execution and freshness-recheck scenarios. Keeping those off
  // emp_active_001 means every other test can rely on that record staying
  // pristine regardless of test execution order within the same process.
  "emp_active_003": {
    id: "emp_active_003",
    email: "priya@acme.test",
    full_name: "Priya Nair",
    status: "active",
    contract_type: "full_time",
    start_date: "2023-01-10",
    probation: false,
    base_salary: 5000000,
    currency: "USD",
    legal_entity_id: "le_ng_01",
    company_id: "co_amend_01",
    country_code: "NG",
    job_title: "Product Manager",
    weekly_hours: 40,
    // Permission explicitly FALSE so the "missing permission" scenario in
    // UC-04.md §12 can flip it on without disturbing other tests.
    custom_fields: { workation_permission: false },
  },
  // UC-05 fixtures — one per jurisdiction in the 9-country statutory notice
  // table (see src/uc05/noticePeriodTable.js), so workflow-level tests can
  // exercise each country rule through the real Mock Remote + workflow path
  // rather than hand-rolling employment records in test code. Each has a
  // start_date that lands the employee in a specific tenure bracket.
  "emp_uk_001": {
    id: "emp_uk_001",
    email: "oliver@london.test",
    full_name: "Oliver Hughes",
    status: "active",
    contract_type: "full_time",
    start_date: "2023-01-10", // ~3.5 years by 2026-08 -> UK 4-week notice bracket
    probation: false,
    base_salary: 7200000,
    currency: "GBP",
    legal_entity_id: "le_uk_01",
    company_id: "co_amend_01",
    country_code: "GB",
    job_title: "Backend Engineer",
    weekly_hours: 40,
  },
  "emp_de_001": {
    id: "emp_de_001",
    email: "lena@berlin.test",
    full_name: "Lena Müller",
    status: "active",
    contract_type: "full_time",
    start_date: "2022-06-01", // ~4 years by 2026-08 -> DE 4-week statutory
    probation: false,
    base_salary: 6800000,
    currency: "EUR",
    legal_entity_id: "le_de_01",
    company_id: "co_amend_01",
    country_code: "DE",
    job_title: "Engineering Manager",
    weekly_hours: 40,
  },
  "emp_de_probation_001": {
    id: "emp_de_probation_001",
    email: "marcus@berlin.test",
    full_name: "Marcus Becker",
    status: "active",
    contract_type: "full_time",
    start_date: "2026-06-01", // ~2.5 months by 2026-08 -> still in DE probation
    probation: true,
    probation_end_date: "2026-12-01", // explicitly future -> calculator treats as on probation
    base_salary: 5500000,
    currency: "EUR",
    legal_entity_id: "le_de_01",
    company_id: "co_amend_01",
    country_code: "DE",
    job_title: "Junior Engineer",
    weekly_hours: 40,
  },
  "emp_pl_001": {
    id: "emp_pl_001",
    email: "katarzyna@warsaw.test",
    full_name: "Katarzyna Kowalski",
    status: "active",
    contract_type: "full_time",
    start_date: "2020-01-15", // >6 years by 2026-08 -> PL 3-month notice bracket
    probation: false,
    base_salary: 5400000,
    currency: "PLN",
    legal_entity_id: "le_pl_01",
    company_id: "co_amend_01",
    country_code: "PL",
    job_title: "Senior QA",
    weekly_hours: 40,
  },
  // Country NOT in the 9-country statutory notice table — proves the
  // policy engine's `unsupported_country` escalation gate actually fires.
  "emp_unsupported_country_001": {
    id: "emp_unsupported_country_001",
    email: "someone@nowhere.test",
    full_name: "Test Person",
    status: "active",
    contract_type: "full_time",
    start_date: "2023-01-10",
    probation: false,
    base_salary: 5000000,
    currency: "CHF",
    legal_entity_id: "le_ch_01",
    company_id: "co_amend_01",
    country_code: "CH", // Switzerland — not in the 9-country scope
    job_title: "Engineer",
    weekly_hours: 40,
  },

  // -------------------------------------------------------------------------
  // MIRRORED SANDBOX RECORDS — REAL employment ids, mock data behind them
  // -------------------------------------------------------------------------
  // The three below are keyed by employment ids that genuinely exist in the
  // project owner's Remote Sandbox, confirmed live 2026-08-18 against
  // gateway.remote-sandbox.com (`GET /v1/employments/:id` →
  // `data.employment.basic_information.name`; the LIST endpoint omits names,
  // which is why each was fetched individually). Everything mirrored is exactly
  // what that read returned:
  //
  //   Chris Lee      8ab12460-b568-4c1e-af9d-09b1fabd8f46  US  employee    active
  //   Emma Thompson  d73cff71-ced7-4bcf-b764-b9899abc6340  GB  employee    active
  //   Carlos Silva   c2cd77da-d576-423f-b4f1-f9e40b313353  BR  contractor  active
  //
  // WHY MIRROR AT ALL, RATHER THAN POINT THE PORTAL AT THE SANDBOX. The request
  // portal (src/portal/) is a publicly reachable page, and its Remote reads are
  // dispatched into THIS file in-process on purpose: a page anyone can open must
  // not read or write a real account (deploy/cx-apis/deps.js records the whole
  // argument). But the previous consequence of that was a persona list of
  // `emp_active_001`-style ids nobody testing the system recognised. Mirroring
  // keeps the safety property exactly as it was — every read still comes from
  // this file — while the name and the id on screen are ones the Sandbox owner
  // knows, and the id is the genuine one, so the same persona would resolve if a
  // surface with real credentials ever pointed at the live gateway.
  //
  // WHAT IS *NOT* MIRRORED, AND MUST NOT BE READ AS SANDBOX FACT. Only the four
  // facts listed above (name, id, country, employment type + status) were
  // captured. Email, salary, start date, job title, legal entity, company id and
  // custom fields are this file's own, written to the same shape as the `emp_*`
  // fixtures beside them so the gates have something coherent to run on. They are
  // deliberately `.test` addresses and round numbers — no figure here should ever
  // be quoted as something the Sandbox returned. (Salaries are ×100 integers,
  // like every other money value in this file and in the real API.)
  //
  // WHAT EACH ONE IS FOR — a persona nobody can drive to a SUCCESS is useless for
  // testing, and "refuses correctly" is indistinguishable from "structurally
  // cannot succeed" without one (CLAUDE.md §4). So each was given a record that
  // reaches at least one green path:
  //   - Chris Lee (US)      — UC-02 (owns the two expense fixtures below),
  //                           UC-03, UC-04 as traveller, UC-09 as payee.
  //   - Emma Thompson (GB)  — UC-05's happy path: GB is in the 9-country
  //                           statutory notice table and her start date lands
  //                           her in the 61–72-month (5-week) bracket.
  //   - Carlos Silva (BR)   — the contractor case: `contract_type` is genuinely
  //                           "contractor", so UC-01/UC-03's letters render the
  //                           contractor label rather than the employee one. BR
  //                           is NOT in UC-05's notice table, so a resignation
  //                           from him escalates `unsupported_country` — which is
  //                           the correct answer, and a useful one to be able to
  //                           demonstrate.
  //
  // They all sit in `co_amend_01`, the same company as every other fixture here,
  // so the EXISTING `admin` persona (Jane Doe) can file UC-04 and UC-09 requests
  // on their behalf. A second admin persona scoped to a second company id would
  // have been a company nobody could interact with, and the real Sandbox company
  // id was not captured, so inventing one would be exactly the "fixture agreeing
  // with itself" habit this file's other comments keep warning about.
  "8ab12460-b568-4c1e-af9d-09b1fabd8f46": {
    id: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
    email: "chris.lee@acme.test", // NOT the Sandbox address — see the block header
    full_name: "Chris Lee",
    status: "active",
    contract_type: "full_time",
    start_date: "2021-09-06",
    probation: false,
    base_salary: 9500000, // 95,000.00 (×100)
    currency: "USD",
    legal_entity_id: "le_us_01",
    company_id: "co_amend_01",
    country_code: "US",
    job_title: "Staff Engineer",
    weekly_hours: 40,
    // UC-04 refuses every request without this (policyEngine.js:120), so a
    // traveller fixture without it can only ever demonstrate the refusal.
    custom_fields: { workation_permission: true },
  },
  "d73cff71-ced7-4bcf-b764-b9899abc6340": {
    id: "d73cff71-ced7-4bcf-b764-b9899abc6340",
    email: "emma.thompson@acme.test", // NOT the Sandbox address
    full_name: "Emma Thompson",
    status: "active",
    contract_type: "full_time",
    // ~5.5 years by 2026-08 -> the GB 61–72-month bracket, 35 days' notice
    // (Employment Rights Act 1996 §86, src/uc05/noticePeriodTable.js).
    start_date: "2021-02-15",
    probation: false,
    base_salary: 8100000, // 81,000.00 (×100)
    currency: "GBP",
    legal_entity_id: "le_uk_01",
    company_id: "co_amend_01",
    country_code: "GB",
    job_title: "Customer Experience Manager",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "c2cd77da-d576-423f-b4f1-f9e40b313353": {
    id: "c2cd77da-d576-423f-b4f1-f9e40b313353",
    email: "carlos.silva@acme.test", // NOT the Sandbox address
    full_name: "Carlos Silva",
    status: "active",
    // Genuinely a contractor in the Sandbox, and the only contractor among the
    // flat fixtures — src/uc01/letter.js and src/uc03/letter.js both label the
    // engagement from this field, so it is the one that exercises that branch.
    contract_type: "contractor",
    start_date: "2024-04-01",
    probation: false,
    base_salary: 4200000, // 42,000.00 (×100)
    currency: "BRL",
    legal_entity_id: "le_br_01",
    company_id: "co_amend_01",
    country_code: "BR",
    job_title: "Frontend Developer",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },

  // --- second mirroring pass, 2026-08-18 -----------------------------------
  // Added when the request portal's roster was cut to the project owner's own
  // Sandbox people. Four demonstrations had been resting on mock-only personas
  // (a German notice bracket, a non-active employment, an expense ownership
  // mismatch, and a longer statutory bracket clashing with a short leaving
  // date). Rather than delete the demonstrations, each subject was REPLACED by a
  // real Sandbox person, confirmed live against gateway.remote-sandbox.com the
  // same day:
  //
  //   Anna Müller    09b65526-643b-4956-959b-916e6429bd23  DE  employee  active
  //   Thomas Weber   9927057d-c8bc-4c71-940d-a5bc4ccf877e  DE  employee  archived
  //   James Wilson   7ec6a5e4-909d-47c1-a442-0688c5cc1f2b  GB  employee  active
  //   João Silva     378eee6b-c6db-4484-ba32-7283bd0e2de9  PT  employee  active
  //
  // The same honesty rule as the block above applies without exception: those
  // five facts per person (name, id, country, type, status) are the ONLY ones
  // captured. Email, salary, start date, job title, entity and company are this
  // file's own, written to sit in the bracket each demonstration needs, and no
  // figure below may be quoted as something the Sandbox returned.
  //
  // ONE SUBSTITUTION IS NOT LIKE-FOR-LIKE, AND IS MARKED RATHER THAN HIDDEN.
  // The Poland demonstration has no Sandbox subject — there is no Polish
  // employment in the account at all. Portugal is the substitute because PT is
  // in UC-05's table (src/uc05/noticePeriodTable.js) with a 60-calendar-day
  // bracket at >=2 years' tenure, which is long enough to clash with a short
  // proposed leaving date the way PL's three-month bracket did. It is PT's own
  // rule, not PL's relabelled: the portal's scenario says Portugal and 60 days.
  "09b65526-643b-4956-959b-916e6429bd23": {
    id: "09b65526-643b-4956-959b-916e6429bd23",
    email: "anna.mueller@acme.test", // NOT the Sandbox address
    full_name: "Anna Müller",
    status: "active",
    contract_type: "full_time",
    // Any tenure lands in DE's single 28-day bracket; the demonstration is the
    // 15th/end-of-month ANCHOR, not the bracket (BGB §622).
    start_date: "2020-03-02",
    probation: false,
    base_salary: 7800000, // 78,000.00 (×100)
    currency: "EUR",
    legal_entity_id: "le_de_01",
    company_id: "co_amend_01",
    country_code: "DE",
    job_title: "Product Designer",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "9927057d-c8bc-4c71-940d-a5bc4ccf877e": {
    id: "9927057d-c8bc-4c71-940d-a5bc4ccf877e",
    email: "thomas.weber@acme.test", // NOT the Sandbox address
    full_name: "Thomas Weber",
    // GENUINELY "archived" IN THE SANDBOX — mirrored verbatim, not normalised to
    // the "terminated" string the mock-only fixture used. Every status gate here
    // tests `status !== "active"` (uc02/policyEngine.js:189,
    // uc03/policyEngine.js:175, uc05/policyEngine.js:93), so `archived` refuses
    // through exactly the same branch, and UC-03's flag names the real status
    // (`employment_status_archived`) rather than a status this record does not
    // have. Verified by running, not by reading.
    status: "archived",
    contract_type: "full_time",
    start_date: "2022-01-10",
    probation: false,
    base_salary: 6900000, // 69,000.00 (×100)
    currency: "EUR",
    legal_entity_id: "le_de_01",
    company_id: "co_amend_01",
    country_code: "DE",
    job_title: "Support Specialist",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b": {
    id: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b",
    email: "james.wilson@acme.test", // NOT the Sandbox address
    full_name: "James Wilson",
    status: "active",
    contract_type: "full_time",
    start_date: "2023-05-15",
    probation: false,
    base_salary: 7200000, // 72,000.00 (×100)
    currency: "GBP",
    legal_entity_id: "le_uk_01",
    company_id: "co_amend_01",
    country_code: "GB",
    job_title: "Account Manager",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "378eee6b-c6db-4484-ba32-7283bd0e2de9": {
    id: "378eee6b-c6db-4484-ba32-7283bd0e2de9",
    email: "joao.silva@acme.test", // NOT the Sandbox address
    full_name: "João Silva",
    status: "active",
    contract_type: "full_time",
    // >=2 years by 2026-08 -> PT's 60-calendar-day bracket (Código do Trabalho
    // art. 400), the one a short proposed leaving date has to clash with.
    start_date: "2019-06-03",
    probation: false,
    base_salary: 5400000, // 54,000.00 (×100)
    currency: "EUR",
    legal_entity_id: "le_pt_01",
    company_id: "co_amend_01",
    country_code: "PT",
    job_title: "Backend Developer",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },

  // --- third mirroring pass, 2026-08-20 ------------------------------------
  // WHY A THIRD PASS. Driven through the real workflows, the seven mirrored
  // people above produce ONE refusal between them, and one person produces all
  // of it: Thomas Weber is archived, so every use case refuses him
  // `employee_not_active`. Everybody else auto-resolves a travel letter,
  // clears UC-04's permission gate and reaches a UC-05 outcome. So the portal
  // could demonstrate a refusal only by TYPING something unusual — a sanctioned
  // destination, a 90-day trip, an expense that is not yours — and never by
  // BEING somebody. That is the wrong lesson to teach about a system whose
  // first prime directive is that identity comes from the record, and it is
  // also the failure mode this repository has paid for repeatedly: a gate that
  // nothing in the demo can reach is indistinguishable from a gate that cannot
  // fire (CLAUDE.md §4, the UC-03 alpha-3 defect).
  //
  // Each of the three below therefore carries exactly ONE record fact that no
  // other persona has, and each fact turns a specific gate the other way:
  //
  //   Lars van der Berg  673a1884-…  NL  eor employee   -> a DIFFERENT company
  //   Alexandre Tremblay 3537d9ee-…  CA  contractor     -> no employing entity
  //   Amanda J Walker    e818418e-…  US  global payroll -> no workation permission
  //
  // PROVENANCE, and it is stronger for these three than for the seven above.
  // All three ids are Sandbox ids this repository has read live and written
  // down, with a source for each:
  //
  //   673a1884-86fb-4101-83d3-b6c544d93bca  Lars van der Berg, NLD, EOR
  //     `employee`. Named and driven live in docs/DEMO-COUNTRIES.md
  //     (UC01-NL-1/NL-2, UC05-NL-1, UC06-NL-4) and read in full in
  //     docs/knowledge/layer-3-carriers/L3-08 §2.
  //   3537d9ee-2017-4a53-952e-9d3b042aeab5  Alexandre Tremblay, CAN,
  //     `contractor` / contractor_of_record. The single strongest record in the
  //     repo: its whole `GET /v1/employments/{id}` envelope is committed
  //     verbatim in test/fixtures/sandboxCapture.js, and it is re-confirmed
  //     live in src/livedemo/employees.js (2026-08-19).
  //   e818418e-1db7-431d-a663-9f477addb8bd  Amanda J Walker, USA,
  //     `global_payroll_employee`. Live-verified in CLAUDE.md §4's id list
  //     (2026-08-17), read in full in L3-08 §2/§4, and driven live in
  //     DEMO-COUNTRIES.md (UC06-US-3).
  //
  // AND THE SAME HONESTY RULE, WITHOUT EXCEPTION. Only id, name, country and
  // employment type + status are captured facts. Email, salary, start date,
  // job title, legal entity, company id and custom fields are this file's own —
  // written to sit where each demonstration needs them — exactly as the two
  // blocks above say of their own records. No figure below may be quoted as
  // something the Sandbox returned.
  //
  // ONE DEPARTURE FROM THE BLOCKS ABOVE, AND IT IS AN IMPROVEMENT.
  // `contract_type` here carries the value a LIVE read would produce rather
  // than the `full_time` those records use. `normalizeEmployment()` builds the
  // field as `employment_model || type || "unknown"` (restClient.js), and
  // L3-08 §3 read both vocabularies off this account: models are `contractor` /
  // `eor` / `global_payroll` / `direct`, types are `contractor` / `employee` /
  // `global_payroll_employee` / `direct_employee`. So the MODEL is what
  // production holds, and it is what is written below. `full_time` is not an
  // engagement model at all — it is a `work_schedule` value that reaches
  // `contract_type` only through this file's own flat fixtures
  // (src/shared/contractTypes.js says so at length). The seven records above
  // are left alone rather than corrected in passing: they are what a dozen
  // other test files render.
  "673a1884-86fb-4101-83d3-b6c544d93bca": {
    id: "673a1884-86fb-4101-83d3-b6c544d93bca",
    email: "lars.vanderberg@northwind.test", // NOT the Sandbox address
    full_name: "Lars van der Berg",
    status: "active",
    // `employment_model: "eor"` live; `type` is `employee`. See the block note.
    contract_type: "eor",
    // Any tenure lands in NL's single flat bracket; the demonstration is the
    // company boundary, not the notice figure.
    start_date: "2021-11-01",
    probation: false,
    base_salary: 7400000, // 74,000.00 (×100)
    currency: "EUR",
    legal_entity_id: "le_nl_01",
    // THE ONE FACT THIS RECORD EXISTS FOR — a company that is NOT Acme.
    //
    // Every other fixture in this file sits in `co_amend_01`, so the portal's
    // one company-admin persona could act for all of them and UC-04's and
    // UC-09's identity gate — `session.companyId === employment.company_id`
    // (src/uc04/workflow.js:145, src/uc09/workflow.js) — was true in every
    // demonstrable case. A control that is true in every reachable case is not
    // being demonstrated; it is being assumed. Acting for Lars, Jane Doe is
    // refused `identity_not_verified`, which is prime directive #3 doing its
    // job on a screen rather than in a comment.
    //
    // A SECOND COMPANY ID IS THIS FILE'S OWN, and it has to be: the Sandbox
    // account is a single tenant — all 112 employments carry
    // `company_id: a9d4ce72-…` (L3-08 §4) — so there is no real second company
    // to mirror. `co_amend_01` is equally this file's invention, so this is the
    // same class of composed value, not a new one.
    //
    // IT DOES NOT COST HIM THE SELF-SERVICE PATHS. UC-02/03/05 verify identity
    // against the EMPLOYMENT id, not the company, so Lars still files his own
    // expense, travel letter and resignation exactly like anybody else. Only a
    // request filed FOR him by Acme's admin is refused, which is precisely the
    // boundary being demonstrated.
    company_id: "co_northwind_02",
    country_code: "NL",
    job_title: "Data Engineer",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "3537d9ee-2017-4a53-952e-9d3b042aeab5": {
    id: "3537d9ee-2017-4a53-952e-9d3b042aeab5",
    email: "alexandre.tremblay@acme.test", // NOT the Sandbox address
    full_name: "Alexandre Tremblay",
    status: "active",
    // `employment_model` AND `type` both read `contractor` on the committed
    // envelope capture (test/fixtures/sandboxCapture.js).
    contract_type: "contractor",
    start_date: "2023-06-26",
    probation: false,
    // A CONTRACTOR RECORD CARRIES NO SALARY FIELD OF ANY KIND, live — its
    // `contract_details` holds two keys, `payment_terms` and `service_duration`
    // (L3-08 §4). Left null here rather than given a round number, because a
    // salary is the one thing this file's own header forbids inventing, and
    // nothing UC-02/03/04/05 does with this record reads it.
    base_salary: null,
    currency: "CAD",
    // THE ONE FACT THIS RECORD EXISTS FOR — no employing entity on file.
    //
    // WHAT IT TURNS. `handleTravelInquiry()` reads the entity BEFORE the gates
    // and hands `letterheadAvailable` to rung 11 (src/uc03/workflow.js STEP 3b),
    // which then chooses between issuing the standard letter and stopping for a
    // person. With no entity there is no letterhead to write on, so a formal
    // travel-letter request from Alexandre lands `human_review` /
    // `formal_letter_requested` with the flag `letterhead_unavailable` naming
    // the CAUSE — a record to fix, not a document to sign. Chris Lee asks for
    // the same letter and it is issued. That is the pair the whole roster was
    // missing: same request, same words, different person, opposite outcome,
    // and the difference is a fact on the record.
    //
    // IT IS A POLICY OUTCOME, NOT A CORRUPT FIELD, and the distinction is the
    // reason this and not something else was chosen. `normalizeEmployment()`
    // ends its legal-entity line `?? null` (restClient.js:1776) — null is the
    // documented answer for a record naming neither `engaged_by_legal_entity_id`
    // nor `bill_to_legal_entity_id`, not a parse failure — and UC-03's own
    // header calls this outcome out by name: *"letter with no letterhead ->
    // human_review: asked for, allowed, and nowhere to write it — a record
    // problem"*. A specialist reading it knows what to do; that is the test.
    //
    // WHAT IS COMPOSED HERE, SAID PLAINLY. No Sandbox record this project has
    // read lacks an employing entity: L3-08 §2 read eight records in full and
    // all eight carry `engaged_by_legal_entity_id`, Alexandre's among them
    // (`30aec65a-…`, the company's default entity). So the ABSENCE below is
    // this file's own, like every other legal-entity value here — the block
    // header lists legal entity among the fields that are never Sandbox fact —
    // and it is composed because the `?? null` branch and UC-03's rung-11
    // refusal are otherwise unreachable from the portal at all.
    legal_entity_id: null,
    company_id: "co_amend_01",
    country_code: "CA",
    job_title: "Financial Manager",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },
  "e818418e-1db7-431d-a663-9f477addb8bd": {
    id: "e818418e-1db7-431d-a663-9f477addb8bd",
    email: "amanda.walker@acme.test", // NOT the Sandbox address
    full_name: "Amanda J Walker",
    status: "active",
    // `type: "global_payroll_employee"` live; the MODEL is `global_payroll`,
    // and the model is what `normalizeEmployment()` yields. See the block note.
    contract_type: "global_payroll",
    start_date: "2022-08-15",
    probation: false,
    base_salary: 8800000, // 88,000.00 (×100)
    currency: "USD",
    legal_entity_id: "le_us_01",
    company_id: "co_amend_01",
    country_code: "US",
    job_title: "Operations Analyst",
    weekly_hours: 40,
    // THE ONE FACT THIS RECORD EXISTS FOR — permission withheld.
    //
    // UC-04's first substantive gate is `employment.custom_fields
    // .workation_permission !== true` -> `blocked` / `employer_permission_not_
    // granted` (src/uc04/policyEngine.js:272). Every mirrored persona carried
    // `true`, and `emp_active_003` — the only fixture carrying `false` — is not
    // on the portal's roster, so the gate that stops a workation could not be
    // reached by choosing a person. It can now: Chris Lee clears it, Amanda is
    // blocked, and `blocked` is the decision that touches Remote not at all.
    //
    // NOTHING CONTRADICTS A CAPTURE HERE, WHICH IS WHY THIS FIELD WAS THE ONE
    // CHOSEN. `custom_fields` is absent from the live employment payload
    // entirely — 0 occurrences across all eight records read in full (L3-08 §4,
    // test/sandboxCaptureFidelity.test.js) — so EVERY value of it in this file
    // is this repo's own, on every fixture, and `false` is no more composed
    // than the `true` beside it. It is also the field
    // src/remotebridge/enrichment.js synthesises for the live path; there is
    // deliberately no stand-in profile for this id, so nothing on the live path
    // disagrees with the refusal shown here.
    custom_fields: { workation_permission: false },
  },

  // --- fourth mirroring pass, 2026-08-22 (round-6 D-02) ---------------------
  // WHY THIS ONE, AND WHY IT DIFFERS FROM THE THREE PASSES ABOVE. The other
  // mirrored people exist to turn a GATE. Alex Morgan exists to turn an
  // IDENTITY: round 6's isolated employee persona was handed this exact id —
  // "the employment reference on your own paperwork" — by the evaluation
  // itself, and the portal's roster had no such person, so every letter that
  // employee could obtain named Chris Lee instead (D-02,
  // qa/evidence/UC-01/2026-08-22-uc01-e2e-6/employee/FINDINGS.md §2). This id
  // is not this file's invention: it is `src/livedemo/employees.js`'s
  // Alex Morgan, re-confirmed live against the Sandbox 2026-08-19 — "EOR
  // employee (USA), status active, job title 'Content Writer Wizard'" — so
  // this record's provenance is a second file's live-verified capture, not a
  // fresh one taken for the portal.
  //
  // Same honesty rule as the three passes above without exception: only id,
  // name, country, and employment type + status are the captured facts (per
  // livedemo/employees.js). Email, salary, start date, legal entity and
  // company id are this file's own, written to the shape every other fixture
  // here already uses so the letter gates have something coherent to run on
  // — `le_us_01`/`co_amend_01`, the same pairing Chris Lee's record sits in,
  // because no second real US entity/company id was ever captured either.
  "2f7f8210-91fc-47db-803c-77a1cc625781": {
    id: "2f7f8210-91fc-47db-803c-77a1cc625781",
    email: "alex.morgan@acme.test", // NOT the Sandbox address — see the block header
    full_name: "Alex Morgan",
    status: "active",
    // livedemo/employees.js calls him "EOR employee (USA)" — the model, not
    // the `full_time` schedule value the seven flat fixtures above use.
    contract_type: "eor",
    start_date: "2022-03-01",
    probation: false,
    base_salary: 7200000, // 72,000.00 (×100)
    currency: "USD",
    legal_entity_id: "le_us_01",
    company_id: "co_amend_01",
    country_code: "US",
    job_title: "Content Writer Wizard",
    weekly_hours: 40,
    custom_fields: { workation_permission: true },
  },

  // -------------------------------------------------------------------------
  // UC-06's amendment fixtures — THE REAL RECORD SHAPE, not this file's flat one
  // -------------------------------------------------------------------------
  // Every fixture above is flat (`base_salary`, `weekly_hours`, `country_code`
  // at the top level). The live API returns none of those: it nests the
  // amendment-relevant data under `basic_information` and `contract_details`,
  // and the country under `country: {code, alpha_2_code}`. The two below are
  // shaped like the LIVE record — modelled field for field on
  // `GET /v1/employments/75b88008-28f0-4c7a-921b-59498d89ac45` (an active
  // Dutch global-payroll employee), with names and ids replaced.
  //
  // WHY THEY ARE NEW RECORDS RATHER THAN A RESHAPE OF THE EXISTING ONES: the
  // flat fixtures are shared with UC-01/03/04/05/09, whose gates read
  // `country_code`, `contract_type` and `start_date` at the top level.
  // Reshaping them would be a cross-use-case change made in passing. So the
  // real shape arrives as an addition, and `normalizeEmployment()`'s
  // mock-passthrough branch (a string `contract_type` + `start_date`) does not
  // fire for these — they take the same normalization path a live record does,
  // which is the point of them.
  //
  // NETHERLANDS BECAUSE NIGERIA HAS NO FORM. Live, `GET
  // /v1/contract-amendments/schema?country_code=NGA` answers 500 for every
  // employment, as does USA — so the flat fixtures' countries genuinely cannot
  // produce a contract-amendment form and no amount of fixture-writing may
  // pretend otherwise. NLD can, and a payload sourced from exactly these fields
  // was accepted live by `POST /v1/contract-amendments/automatable` (200).
  //
  // `contract_details.work_hours_per_week` is the STRING "24" on
  // `emp_nl_parttime_006` on purpose: that is Remote's own representation on
  // one live NL record, while another carries the NUMBER 40 — and the API
  // refuses the string, so the coercion in uc06/policyEngine.js has a fixture
  // that actually exercises it.
  "emp_nl_amend_001": {
    id: "emp_nl_amend_001",
    status: "active",
    type: "global_payroll_employee",
    employment_model: "global_payroll",
    full_name: "Jan Willem Bakker",
    job_title: "Senior Software Engineer",
    company_id: "co_amend_01",
    country: { code: "NLD", name: "Netherlands", alpha_2_code: "NL" },
    active_contract_id: "ctr_nl_amend_001",
    engaged_by_legal_entity_id: "le_nl_01",
    provisional_start_date: "2023-10-01",
    probation_period_end_date: "2023-10-31",
    work_email: null,
    personal_email: "jan.bakker@acme.test",
    basic_information: {
      name: "Jan Willem Bakker",
      manager: null,
      email: "jan.bakker@acme.test",
      mobile_number: "+31612345678",
      job_title: "Senior Software Engineer",
      login_email: "personal",
      provisional_start_date: "2023-10-01",
      tax_servicing_countries: [],
      personal_email: "jan.bakker@acme.test",
      seniority_date: null,
      work_email: null,
      // null on EVERY one of the 81 active Sandbox employments — kept null so
      // no test can accidentally depend on a value the real data never has.
      tax_job_category: null,
      has_seniority_date: null,
    },
    contract_details: {
      wage_type: "salary",
      // 50,000.00 (×100). THE ONE FIELD NOT COPIED FROM THE LIVE RECORD (which
      // carries 7200000), and deliberately: every UC-06 scenario in the suite
      // states `oldAmount: 50000`, and the amendment form materialises its
      // decrease rule as `if annual_gross_salary <= <current - 1 cent>`. A
      // record that disagreed with the scenario's own stated old amount would
      // make a "raise" arrive as a decrease and demand two attestations — a
      // fixture disagreeing with its tests, which is the failure mode this whole
      // pass is about, only pointed the other way.
      annual_gross_salary: 5000000,
      compensation_currency_code: "EUR",
      available_pto: 20,
      contract_duration_type: "fixed_term",
      contract_end_date: "2028-06-26",
      holiday_allowance: "On top of salary",
      holiday_allowance_payment_frequency: "monthly",
      number_of_working_days_per_week: 5,
      part_time_percentage: 100,
      probation_length: 1,
      role_description:
        "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise.",
      salary_rate: "yearly",
      type_of_work_relation: "employment_contract",
      work_hours_per_week: 40,
      work_schedule: "full_time",
    },
  },
  // A MUTABLE twin of emp_nl_amend_001, for tests that flip a status and flip
  // it back (the same role emp_active_003 plays among the flat fixtures).
  // Keeping mutation off emp_nl_amend_001 lets every other test rely on that
  // record staying pristine regardless of execution order in one process.
  "emp_nl_amend_003": {
    id: "emp_nl_amend_003",
    status: "active",
    type: "global_payroll_employee",
    employment_model: "global_payroll",
    full_name: "Sanne de Groot",
    job_title: "Product Designer",
    company_id: "co_amend_01",
    country: { code: "NLD", name: "Netherlands", alpha_2_code: "NL" },
    active_contract_id: "ctr_nl_amend_003",
    engaged_by_legal_entity_id: "le_nl_01",
    provisional_start_date: "2021-05-04",
    probation_period_end_date: "2021-06-04",
    work_email: null,
    personal_email: "sanne.degroot@acme.test",
    basic_information: {
      name: "Sanne de Groot",
      email: "sanne.degroot@acme.test",
      mobile_number: "+31611223344",
      job_title: "Product Designer",
      login_email: "personal",
      provisional_start_date: "2021-05-04",
      tax_servicing_countries: [],
      personal_email: "sanne.degroot@acme.test",
      seniority_date: null,
      work_email: null,
      tax_job_category: null,
      has_seniority_date: null,
    },
    contract_details: {
      wage_type: "salary",
      annual_gross_salary: 5000000, // 50,000.00 (×100) — see emp_nl_amend_001
      compensation_currency_code: "EUR",
      // FIXED TERM, not indefinite, and that is not cosmetic. Live, an
      // `indefinite` Dutch amendment additionally requires
      // `contract_duration_type_ack` ("you acknowledge … the risks associated
      // with an indefinite agreement") and `non_compete_clause_apply` —
      // reproduced exactly by the schema's own `allOf`, and confirmed live on
      // employment a262cda1-… which answered
      // `422 {"contract_duration_type_ack":["can't be blank"],
      //       "non_compete_clause_apply":["can't be blank"]}`.
      // Both are human decisions no record can supply, so an indefinite Dutch
      // contract genuinely cannot be amended from record data alone. That is a
      // true and useful escalation — it just is not the happy path, so the
      // fixture that exercises the happy path is fixed_term.
      contract_duration_type: "fixed_term",
      contract_end_date: "2029-05-04",
      holiday_allowance: "On top of salary",
      holiday_allowance_payment_frequency: "monthly",
      role_description:
        "Designing product interfaces, running usability research, and maintaining the design system alongside engineering.",
      salary_rate: "yearly",
      work_hours_per_week: 40,
      work_schedule: "full_time",
    },
  },
  // Part-time + a STRING hours value: the branch where `allOf` adds
  // `default_weekly_hours` and `part_time_salary_confirmation` as required,
  // and the record carries neither — so this one must escalate naming them.
  "emp_nl_parttime_006": {
    id: "emp_nl_parttime_006",
    status: "active",
    type: "global_payroll_employee",
    employment_model: "global_payroll",
    full_name: "Anna van Vliet",
    job_title: "Content Writer",
    company_id: "co_amend_01",
    country: { code: "NLD", name: "Netherlands", alpha_2_code: "NL" },
    active_contract_id: "ctr_nl_amend_006",
    engaged_by_legal_entity_id: "le_nl_01",
    provisional_start_date: "2022-10-03",
    probation_period_end_date: "2022-11-02",
    work_email: null,
    personal_email: "anna.vanvliet@acme.test",
    basic_information: {
      name: "Anna van Vliet",
      email: "anna.vanvliet@acme.test",
      mobile_number: "+31623498765",
      job_title: "Content Writer",
      login_email: "personal",
      provisional_start_date: "2022-10-03",
      tax_servicing_countries: [],
      personal_email: "anna.vanvliet@acme.test",
      seniority_date: null,
      work_email: null,
      tax_job_category: null,
      has_seniority_date: null,
    },
    contract_details: {
      wage_type: "salary",
      annual_gross_salary: 3600000,
      compensation_currency_code: "EUR",
      contract_duration_type: "fixed_term",
      contract_end_date: "2028-11-01",
      holiday_allowance: "On top of salary",
      holiday_allowance_payment_frequency: "yearly",
      part_time_percentage: "60",
      role_description:
        "Creating content for website, social media, and marketing materials. Writing blog posts, product descriptions, and email campaigns.",
      salary_rate: "yearly",
      work_hours_per_week: "24", // live shape: a STRING on this record
      work_schedule: "part_time",
    },
  },
};

// rca-bdz: `GET /v1/offboardings/employments/:id` fixtures, keyed by
// employment id. Every id NOT listed here answers a genuinely empty list —
// matching the live measurement (`HTTP 200 {"offboardings":[]}` for a real,
// currently-active Sandbox employee, 2026-08-21) — so no EXISTING test that
// never mentions this map changes behaviour. Tests that need an in-progress
// offboarding to be VISIBLE to G-1 despite an `active` employment status
// assign into this object directly, the same convention `EMPLOYMENTS` uses.
export const OFFBOARDINGS = {};

// ---------------------------------------------------------------------------
// UC-04 work-authorization requests — TRANSCRIBED FROM REMOTE, NOT FROM US
// ---------------------------------------------------------------------------
// These fixtures are written from developer.remote.com's own OpenAPI for
// `WorkAuthorizationRequest` (fetched 2026-08-19), field for field, and NOTHING
// here is imported from `src/uc04/`. That is the whole point: this file's
// previous UC-04 block implemented a `POST /v1/work-authorization-requests` that
// Remote does not have, in a record shape Remote does not use
// (`employment_id`, `start_date`, `end_date`, a bare-string `destination_country`
// — none of which are properties of the real object). The suite then agreed with
// the code because the fixture had been written from the code. A mock built from
// our own constants can only ever agree with us.
//
// The real object, transcribed:
//   id, status, submitted_at, reason, additional_information,
//   travel_date_start, travel_date_end, travel_document_number, work_location,
//   will_negotiate_or_sign_contracts, employer_special_instructions,
//   destination_country (a full `Country` object, not a code),
//   user + employer_approver (each `{id, name, email}` or null)
//
// There is NO employment reference on the wire. Remote's list endpoint
// nevertheless documents an `employment_id` query filter, which its server
// resolves internally — so the index below lives OUTSIDE the record, exactly
// where Remote's does, and the served shape stays free of a field the real API
// has never returned.
//
// NO MINTING, NO RECONSTRUCTION. The previous version encoded a record inside
// the id it minted, so a serverless cold start between a create and a PATCH
// could rebuild it. That machinery existed only because this file created
// records; with the create gone, every request a caller can address is one
// checked in right here, and a fresh module load has it already. What a cold
// start still loses is an earlier PATCH — which is a mock's ordinary limitation
// and is not a double-execution hole: the guard on a second approval is the
// durable `uc04_authorizations` row (approvalPolicy.js refuses anything not
// `pending_specialist_approval`), never this map.

/** `WorkAuthorizationRequest.status`, verbatim from Remote's enum. */
export const MOCK_WORK_AUTHORIZATION_STATUSES = [
  "pending",
  "cancelled",
  "declined_by_manager",
  "declined_by_remote",
  "approved_by_manager",
  "approved_by_remote",
];

/**
 * `UpdateWorkAuthorizationRequestParams` — `additionalProperties: false`, a
 * `oneOf` over exactly two branches. Transcribed, including Remote's own typo
 * in the schema titles ("Authozation").
 */
const WORK_AUTHORIZATION_UPDATE_BRANCHES = {
  // ApprovedWorkAuthozation
  approved_by_manager: { required: ["status"], optional: ["employer_special_instructions"] },
  // DeclinedWorkAuthozation
  declined_by_manager: { required: ["status", "reason"], optional: ["employer_special_instructions"] },
};

const PT_COUNTRY = {
  alpha_2_code: "PT",
  code: "PRT",
  name: "Portugal",
  region: "Europe",
  subregion: "Southern Europe",
  eor_onboarding: true,
};
const ES_COUNTRY = {
  alpha_2_code: "ES",
  code: "ESP",
  name: "Spain",
  region: "Europe",
  subregion: "Southern Europe",
  eor_onboarding: true,
};

/**
 * Requests an employee raised in Remote's Request Hub, as Remote serves them.
 *
 * Ids are UUIDs because `WorkAuthorizationRequest.id` is `format: uuid`. The
 * old `war_*` prefix was ours.
 *
 * THE TEMPLATE, NOT THE LIVE MAP. `WORK_AUTHORIZATIONS` below is a deep copy,
 * and `resetWorkAuthorizations()` restores it. A PATCH mutates a request in
 * place — that is what a PATCH is — so without a reset the first test to approve
 * one leaves it `approved_by_manager` for every test after it, and the second
 * test's request simply stops resolving. That failure presents as an ABSENCE
 * ("no pending request for this employee"), which is indistinguishable from the
 * feature not working, and is the same reading problem this whole change is
 * about.
 */
const WORK_AUTHORIZATION_FIXTURES = {
  // Amara Okafor's pending trip to Spain — the one the repo's standard UC-04
  // scenario (`emp_active_001`, ES, 2026-09-01 -> 2026-09-14) is about. Its
  // dates and destination MATCH that scenario on purpose: a request link is
  // established by employment AND destination, so a fixture that agreed on
  // neither would make every positive test unlinkable and prove nothing.
  "3f2c5b90-9a41-4d0e-8b7d-2f1a6c0e4d21": {
    id: "3f2c5b90-9a41-4d0e-8b7d-2f1a6c0e4d21",
    status: "pending",
    submitted_at: "2026-08-10T09:14:00Z",
    reason: "Workation",
    additional_information: "Working alongside the Madrid team for two weeks.",
    travel_date_start: "2026-09-01",
    travel_date_end: "2026-09-14",
    travel_document_number: "FC123456",
    work_location: "Coworking space, Madrid",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    destination_country: ES_COUNTRY,
    user: { id: "usr_amara", name: "Amara Okafor", email: "amara@acme.test" },
    employer_approver: null,
  },
  // Chris Lee — one of the MIRRORED SANDBOX RECORDS above, and the persona the
  // portal / cold-start tests drive. Same destination, so the portal's own
  // scenario links too.
  "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3": {
    id: "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3",
    status: "pending",
    submitted_at: "2026-08-11T11:02:00Z",
    reason: "Workation",
    additional_information: "Two weeks working from Madrid.",
    travel_date_start: "2026-09-01",
    travel_date_end: "2026-09-14",
    travel_document_number: "US998877",
    work_location: "Madrid",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    destination_country: ES_COUNTRY,
    user: { id: "usr_chris_lee", name: "Chris Lee", email: "chris.lee@acme.test" },
    employer_approver: null,
  },
  // Already settled — present so a test can prove the decide path refuses a
  // request that is no longer awaiting a manager. Deliberately a DIFFERENT
  // destination from the pending row above it, so a lookup by employment can
  // never confuse the two.
  "b0d9a3e2-4f17-4c86-9a55-1e6b7c8d90aa": {
    id: "b0d9a3e2-4f17-4c86-9a55-1e6b7c8d90aa",
    status: "approved_by_manager",
    submitted_at: "2026-07-02T08:00:00Z",
    reason: "Conference",
    additional_information: "Attending a conference in Lisbon.",
    travel_date_start: "2026-07-20",
    travel_date_end: "2026-07-24",
    travel_document_number: "FC000111",
    work_location: "Lisbon",
    will_negotiate_or_sign_contracts: false,
    employer_special_instructions: null,
    destination_country: PT_COUNTRY,
    user: { id: "usr_amara", name: "Amara Okafor", email: "amara@acme.test" },
    employer_approver: { id: "usr_sam", name: "Mobility Sam", email: "sam@acme.test" },
  },
};

/**
 * The `employment_id` -> request-id index Remote's list filter implies but its
 * response body does not carry. Deliberately a SEPARATE structure: putting an
 * `employment_id` on the record would be this file teaching a field the real API
 * has never returned, which is exactly the class of defect the block above
 * exists to stop repeating.
 */
/**
 * The live map the routes read and write. Seeded from the template above.
 * `structuredClone` so a PATCH can never reach back into the fixture.
 */
export const WORK_AUTHORIZATIONS = structuredClone(WORK_AUTHORIZATION_FIXTURES);

/** Restore every request to the state Remote's schema describes. Tests only. */
export function resetWorkAuthorizations() {
  for (const key of Object.keys(WORK_AUTHORIZATIONS)) delete WORK_AUTHORIZATIONS[key];
  Object.assign(WORK_AUTHORIZATIONS, structuredClone(WORK_AUTHORIZATION_FIXTURES));
}

export const WORK_AUTHORIZATION_EMPLOYMENT_INDEX = {
  "3f2c5b90-9a41-4d0e-8b7d-2f1a6c0e4d21": "emp_active_001",
  "6b8e1d47-0c53-4a92-bf10-77d4c2e8a5f3": "8ab12460-b568-4c1e-af9d-09b1fabd8f46", // Chris Lee
  "b0d9a3e2-4f17-4c86-9a55-1e6b7c8d90aa": "emp_active_001",
};

// ---------------------------------------------------------------------------
// CUSTOM FIELDS — the block UC-04's first hard gate reads, and the one place
// this mock has been furthest from the API.
//
// WHAT THE SANDBOX ACTUALLY HOLDS [CONFIRMED live 2026-08-19, capture in
// scripts/capture-sandbox.mjs]:
//
//   GET /v1/employments/{id}/custom_fields   -> 404 "Not Found"   (UNDERSCORE)
//   GET /v1/employments/{id}/custom-fields   -> 200               (HYPHEN)
//     {data:{total_count,current_page,total_pages,
//            custom_field_values:[{name,type,value,custom_field_id}]}}
//   GET /v1/custom-fields                    -> 200 (definitions, no `data`)
//
// Two things follow, and both matter more than the spelling:
//
//   1. A custom field is addressed by its HUMAN NAME and a uuid — there is no
//      machine slug anywhere in either payload. So `employment.custom_fields
//      .workation_permission`, which src/uc04/policyEngine.js requires to be
//      `true` before it will allow a workation, is a shape no real Remote
//      response can produce, under any spelling of the path.
//   2. `GET /v1/employments/{id}` itself carries NO `custom_fields` key at all
//      — 0 occurrences across all 50 employments captured. Whatever fills that
//      block on the live path is not Remote.
//
// The four definitions below are the REAL ONES on this Sandbox company, copied
// verbatim. None of them is a workation permission, and that is the finding:
// such a field would have to be provisioned by a company admin in Remote's own
// UI before it could exist, and would then arrive as
// `{name:"Workation Permission", type:"boolean", value:true}` — by name, in a
// list, not as a key on the employment.
//
// [CONFIRMED] GET /v1/custom-fields, Remote Sandbox, 2026-08-19.
export const CUSTOM_FIELD_DEFINITIONS = [
  {
    id: "4d0092a7-c7b2-4049-bc52-9a7f8aeec87b",
    name: "Has Company Laptop?",
    type: "boolean",
    metadata: null,
    required: false,
    visibility_scope: "everyone",
    data_entry_access: "company_admin_only",
  },
  {
    id: "d03d8aa0-aa1c-4e72-bf7e-3bfdbdfa5d18",
    name: "Languages",
    type: "string",
    metadata: null,
    required: false,
    visibility_scope: "everyone",
    data_entry_access: "everyone",
  },
  {
    id: "57db6d4b-a5dc-4ad5-8aed-3744373cba83",
    name: "Monthly Travel Days",
    type: "integer",
    metadata: null,
    required: false,
    visibility_scope: "everyone",
    data_entry_access: "company_admin_only",
  },
  {
    id: "90e2eda1-05f0-42f1-ac75-9135e86dc28f",
    name: "Office Location Code",
    type: "string",
    metadata: null,
    required: false,
    visibility_scope: "everyone",
    data_entry_access: "company_admin_only",
  },
];

/**
 * The `custom_field_values` rows for one fixture, in the live shape.
 *
 * Values are the real Sandbox ones for the three fields every employment there
 * carries. The fixture's own `custom_fields` object — an invented shape kept on
 * the flat records because src/uc04 reads it and this file may not change that
 * use case — is projected here as EXTRA named rows so the two representations
 * cannot silently disagree, and so anyone reading this route sees exactly which
 * rows have no counterpart on the real Sandbox.
 *
 * @param {object} emp one EMPLOYMENTS fixture
 * @returns {{name:string,type:string,value:unknown,custom_field_id:string}[]}
 */
function employmentCustomFieldValues(emp) {
  const rows = [
    { name: "Office Location Code", type: "string", value: "CAN-4F", custom_field_id: "90e2eda1-05f0-42f1-ac75-9135e86dc28f" },
    { name: "Monthly Travel Days", type: "integer", value: 4, custom_field_id: "57db6d4b-a5dc-4ad5-8aed-3744373cba83" },
    { name: "Has Company Laptop?", type: "boolean", value: false, custom_field_id: "4d0092a7-c7b2-4049-bc52-9a7f8aeec87b" },
  ];
  // NOT [CONFIRMED] — no such field exists on the Sandbox. Emitted only when a
  // fixture carries the invented block, so that a reader of this route can see
  // the difference between the three rows above (real) and this one (ours).
  const permission = emp?.custom_fields?.workation_permission;
  if (permission !== undefined) {
    rows.push({
      name: "Workation Permission",
      type: "boolean",
      value: permission,
      custom_field_id: "00000000-0000-4000-8000-fixture000001",
    });
  }
  return rows;
}

/**
 * Project a fixture onto the LIST row shape.
 *
 * [CONFIRMED live 2026-08-19] `GET /v1/employments` returns 19 keys per row and
 * `GET /v1/employments/{id}` returns 49. The list omits `basic_information`,
 * `contract_details`, `company_id` and `probation_period_end_date` entirely —
 * so a caller that lists and then reads one of those off a row gets `undefined`
 * in production no matter how complete the show fixture is.
 *
 * @param {object} emp one EMPLOYMENTS fixture
 */
function toEmploymentListRow(emp) {
  return {
    id: emp.id,
    status: emp.status ?? null,
    type: emp.type ?? emp.contract_type ?? null,
    country: emp.country ?? null,
    department: emp.department ?? null,
    external_id: emp.external_id ?? null,
    full_name: emp.full_name ?? null,
    job_title: emp.job_title ?? null,
    login_email: emp.login_email ?? emp.email ?? null,
    personal_email: emp.personal_email ?? emp.email ?? null,
    employment_model: emp.employment_model ?? null,
    short_id: emp.short_id ?? null,
    partner_external_id: null,
    work_email: emp.work_email ?? null,
    department_id: emp.department_id ?? null,
    employment_lifecycle_stage: emp.employment_lifecycle_stage ?? "onboarded",
    work_address_details: emp.work_address_details ?? {},
  };
}

/**
 * The five contract amendments the Sandbox actually holds, copied verbatim.
 *
 * [CONFIRMED] GET /v1/contract-amendments, Remote Sandbox, 2026-08-19.
 *
 * Kept as the real rows rather than rewritten onto this file's own employment
 * ids, because the point of them is the SHAPE and the status vocabulary, and a
 * fixture rewritten to agree with our ids is one edit closer to a fixture
 * rewritten to agree with our code. Observed `status` values across these five:
 * `in_review`, `submitted`, `canceled` (one "l"), `done`. Note `reason_for_change`
 * is null on every one, and there is no amount field anywhere on the row.
 */
export const CONTRACT_AMENDMENT_LIST = [
  {
    id: "18957b7a-f9b5-428b-a40e-264240157235",
    status: "in_review",
    job_title: "Senior Engineer",
    submitted_at: "2026-06-26T14:51:19Z",
    employment_id: "d73cff71-ced7-4bcf-b764-b9899abc6340",
    reason_for_change: null,
    requested_effective_date: "2026-07-26",
    requested_by: "eee7bab1-86e9-417e-ad50-fe66162610f6",
  },
  {
    id: "7f441d79-6c33-48a1-98c0-15e5ee2f555a",
    status: "submitted",
    job_title: "Staff Engineer",
    submitted_at: "2026-06-26T14:51:19Z",
    employment_id: "73231ab8-0f62-487f-bc08-c94932b22b5c",
    reason_for_change: null,
    requested_effective_date: "2026-08-10",
    requested_by: "eee7bab1-86e9-417e-ad50-fe66162610f6",
  },
  {
    id: "074c8043-f9e8-4933-affb-d5d9795819bc",
    status: "canceled",
    job_title: "Lead Engineer",
    submitted_at: "2026-06-26T14:51:19Z",
    employment_id: "e2305143-c354-4d44-a71d-992e13a0c645",
    reason_for_change: null,
    requested_effective_date: "2026-07-11",
    requested_by: "eee7bab1-86e9-417e-ad50-fe66162610f6",
  },
  {
    id: "3551835e-e97b-47e2-908e-b818e84bf69f",
    status: "done",
    job_title: "Principal Engineer",
    submitted_at: "2026-06-26T14:51:19Z",
    employment_id: "378eee6b-c6db-4484-ba32-7283bd0e2de9",
    reason_for_change: null,
    requested_effective_date: "2026-06-12",
    requested_by: "eee7bab1-86e9-417e-ad50-fe66162610f6",
  },
  {
    id: "82f8d1c6-1cde-456f-b5c6-ec16e992469a",
    status: "canceled",
    job_title: "Senior Software Engineer",
    submitted_at: "2026-08-18T14:16:58Z",
    employment_id: "75b88008-28f0-4c7a-921b-59498d89ac45",
    reason_for_change: null,
    requested_effective_date: "2026-11-01",
    requested_by: "428501a0-0cfc-4d65-80f2-dcb325b30a6d",
  },
];

// LEGAL ENTITIES.
//
// `country_code` HERE IS THE ALPHA-3 FORM, and that is not a style choice —
// it is what `GET /v1/companies/{id}/legal-entities` actually returns:
// `"country_code":"USA"`, `"CAN"`, `"FRA"`, `"DEU"`, `"NLD"` across all seven
// entities of the demo company [CONFIRMED live 2026-08-19]. Remote's own
// reference says so too: *"ISO 3166-1 alpha-3 country code (e.g., 'USA',
// 'GBR', 'DEU')"*.
//
// These fixtures carried NO `country_code` at all until this pass, so the mock
// served `null` where the API serves an alpha-3 string — which meant the one
// place the alpha-3/alpha-2 collision could have been noticed offline was the
// one place it could not happen. That is the fixture-agrees-with-the-code
// mechanism this file has already been corrected for twice (the invented
// `{data:{countries:[…]}}` envelope, the invented `/v1/company-payroll-runs`
// path), and it is why `RemoteClient#normalizeLegalEntity()`'s conversion is
// now exercised by the mock rather than only by the live API.
//
// `address` is the opposite case and is labelled as such below: this endpoint
// has NO address field live. It is kept because the letter renderer reads it,
// and it is named here rather than left to read as API data.
export const LEGAL_ENTITIES = {
  "le_ng_01": {
    id: "le_ng_01",
    country_code: "NGA", // ALPHA-3, as the live endpoint sends it
    name: "Remote Nigeria EOR Ltd",
    address: "12 Marina Road, Lagos, Nigeria",
  },
  "le_uk_01": {
    id: "le_uk_01",
    country_code: "GBR", // ALPHA-3, as the live endpoint sends it
    name: "Remote UK EOR Ltd",
    address: "1 Finsbury Avenue, London, United Kingdom",
  },
  "le_de_01": {
    id: "le_de_01",
    country_code: "DEU", // ALPHA-3, as the live endpoint sends it
    name: "Remote Germany EOR GmbH",
    address: "Friedrichstraße 68, 10117 Berlin, Germany",
  },
  "le_pl_01": {
    id: "le_pl_01",
    country_code: "POL", // ALPHA-3, as the live endpoint sends it
    name: "Remote Poland EOR Sp. z o.o.",
    address: "ul. Marszałkowska 89, 00-024 Warsaw, Poland",
  },
  "le_ch_01": {
    id: "le_ch_01",
    country_code: "CHE", // ALPHA-3, as the live endpoint sends it
    name: "Remote Switzerland EOR AG",
    address: "Bahnhofstrasse 1, 8001 Zurich, Switzerland",
  },
  // The two entities the MIRRORED SANDBOX RECORDS below sit in (see the block
  // headed "MIRRORED SANDBOX RECORDS" in EMPLOYMENTS). Named in this file's
  // existing convention rather than copied from the Sandbox — the entity a real
  // Sandbox employment is engaged by was NOT captured, and this file does not
  // invent a fact it can pass off as verified.
  "le_us_01": {
    id: "le_us_01",
    country_code: "USA", // ALPHA-3, as the live endpoint sends it
    name: "Remote US EOR Inc.",
    address: "300 Delaware Avenue, Wilmington, DE, United States",
  },
  "le_br_01": {
    id: "le_br_01",
    country_code: "BRA", // ALPHA-3, as the live endpoint sends it
    name: "Remote Brazil EOR Ltda.",
    address: "Av. Paulista 1000, São Paulo, Brazil",
  },
  "le_pt_01": {
    id: "le_pt_01",
    country_code: "PRT", // ALPHA-3, as the live endpoint sends it
    name: "Remote Portugal EOR Unipessoal Lda.",
    address: "Avenida da Liberdade 110, 1250-146 Lisbon, Portugal",
  },
  // The entity the third mirroring pass's Dutch record is engaged by. Named in
  // this file's own convention like every entry above it — the real Sandbox
  // account has a Dutch entity (`721bdcc0-…`, `global_payroll_enabled: true`,
  // docs/knowledge/layer-3-carriers/L3-08 §1) but its NAME was never captured,
  // and this file does not pass an invented name off under a real id.
  //
  // IT EXISTS SO THAT ONE PERSONA'S REFUSAL STAYS THE REFUSAL IT CLAIMS TO BE.
  // Lars van der Berg sits in a second company on purpose, and UC-03 reads his
  // letterhead through `getLegalEntity(legal_entity_id, company_id)`. Without a
  // resolvable entity his travel letter would ALSO stop as
  // `letterhead_unavailable`, and a persona that refuses for two reasons at once
  // demonstrates neither — the reader cannot tell which gate they are looking
  // at. (The company-scoped route here serves every entity regardless of the
  // company id, so this is belt-and-braces against a future tightening.)
  "le_nl_01": {
    id: "le_nl_01",
    country_code: "NLD", // ALPHA-3, as the live endpoint sends it
    name: "Northwind Netherlands B.V.",
    address: "Herengracht 500, 1017 CB Amsterdam, Netherlands",
  },
};

// UC-03 fixture — the supported-countries list behind `GET /v1/countries` (the
// spec's §3 data source). Deliberately a small illustrative subset, not the
// full 224-row list. Sanctioned/restricted codes are NOT here on purpose: the
// sanctioned-region gate (policyEngine.js step 5) is checked BEFORE and
// independently of this list, so this fixture being "merely" the supported
// list is exactly the defence-in-depth relationship the tests assert.
//
// THESE ROWS ARE COPIED FROM THE LIVE API, NOT COMPOSED. This file used to
// serve `{country_code, name}` — a row shape no Remote endpoint has ever
// returned — inside a `{data: {countries: […]}}` envelope the real API does not
// use either. That invention is HOW finding F-27 survived: `listCountries()`
// mapped `c.country_code ?? c.code`, the mock obligingly supplied
// `country_code`, every test passed, and in production the supported set was a
// list of ALPHA-3 codes ("ESP") being probed with 2-letter destinations ("ES").
// Every membership test was false, so UC-03 could never auto_resolve — and
// because the gate fails closed, a use case that structurally could not succeed
// was indistinguishable from one being appropriately cautious.
//
// A mock's whole contract is "swap the base URL and nothing else changes." A
// mock that emits a shape only this repo has ever produced breaks that contract
// in the one direction no test can see. So every field below is a field the
// live `GET /v1/countries` sent on 2026-08-17, with its live value: `code` is
// the ALPHA-3 form, `alpha_2_code` is the alpha-2 form, and there is no
// `country_code` anywhere, because that field does not exist on the real API.
// (`United Kingdom (UK)` is genuinely what the API calls GBR. Left as sent.)
// Fields the live rows also carry but nothing here reads —
// `country_subdivisions`, `supported_json_schemas`, `locked_benefits`,
// `employment_agreement_preview_available` — are omitted rather than stubbed: a
// mock may serve a SUBSET of the real keys, never a key the real API has never
// sent. `test/remoteShapeFidelity.test.js` enforces exactly that asymmetry.
//
// TWO THINGS THIS LIST DELIBERATELY CONTAINS, both verified against the live
// 224-row response on 2026-08-17:
//
// 1. ROWS WITH `eor_onboarding: false`. Live, only 91 of 224 rows are EOR
//    countries. This fixture used to be 15 rows that were ALL EOR — which made
//    "is this country in the supported list" (what UC-03's gate actually means)
//    and "does this country have eor_onboarding: true" produce identical
//    results in every offline test, demo and playground run. Nothing in the
//    suite would have failed if someone silently tightened the gate from the
//    first to the second, and that tightening is affirmatively wrong:
//    Martinique (MTQ/MQ, `eor_onboarding: false`) is an overseas department of
//    France, so a French employee travelling there is travelling domestically,
//    and Montenegro and the Bahamas are mainstream workation destinations. The
//    semantics question itself is a product call, recorded in
//    docs/research/COUNTRY-SUPPORT-SEMANTICS.md; what this fixture guarantees
//    is only that the two readings stop being observationally equivalent.
//
// 2. A ROW WHOSE `contractor_products_available` IS EMPTY (Kuwait). The field
//    is an ARRAY live — never a boolean — and 13 rows carry `[]`. An empty
//    array is truthy, so `if (row.contractor_products_available)` says
//    "contractor products available" for precisely the countries where none
//    are. Nothing in src/ or workflows/ reads this field today; serving its
//    real shape, empty case included, is what stops the first consumer that
//    does from inheriting that bug invisibly.
//
// EVERY ROW STILL CARRIES A REAL `alpha_2_code`, because all 224 live rows do.
// countryRowToAlpha2()'s alpha-3-only drop path is real and is tested — with
// explicit literals, in test/remoteCountries.test.js — but putting such a row
// HERE would mean inventing a shape the API has never emitted, which is the
// exact mistake this whole rewrite exists to undo.
export const COUNTRIES = [
  { code: "DEU", name: "Germany", region: "Europe", subregion: "Western Europe", alpha_2_code: "DE", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "EST", name: "Estonia", region: "Europe", subregion: "Northern Europe", alpha_2_code: "EE", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "ESP", name: "Spain", region: "Europe", subregion: "Southern Europe", alpha_2_code: "ES", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "FRA", name: "France", region: "Europe", subregion: "Western Europe", alpha_2_code: "FR", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "GBR", name: "United Kingdom (UK)", region: "Europe", subregion: "Northern Europe", alpha_2_code: "GB", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "IRL", name: "Ireland", region: "Europe", subregion: "Northern Europe", alpha_2_code: "IE", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "IND", name: "India", region: "Asia", subregion: "Southern Asia", alpha_2_code: "IN", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "ITA", name: "Italy", region: "Europe", subregion: "Southern Europe", alpha_2_code: "IT", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "MEX", name: "Mexico", region: "Americas", subregion: "Latin America", alpha_2_code: "MX", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "NGA", name: "Nigeria", region: "Africa", subregion: "Sub-Saharan Africa", alpha_2_code: "NG", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "NLD", name: "Netherlands", region: "Europe", subregion: "Western Europe", alpha_2_code: "NL", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "PHL", name: "Philippines", region: "Asia", subregion: "South-eastern Asia", alpha_2_code: "PH", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "POL", name: "Poland", region: "Europe", subregion: "Eastern Europe", alpha_2_code: "PL", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "PRT", name: "Portugal", region: "Europe", subregion: "Southern Europe", alpha_2_code: "PT", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "USA", name: "United States", region: "Americas", subregion: "Northern America", alpha_2_code: "US", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  // Switzerland is here because a mock EMPLOYMENT fixture sits in CH, and this
  // list is now what `RemoteClient.getCountrySchema()` resolves alpha-2 through
  // to reach the alpha-3 path the schema endpoint requires (finding F-27,
  // second half). Without the row, that employee's amendments would escalate
  // on the mock's own incompleteness rather than on anything the gates decided
  // — the exact failure the COUNTRY_SCHEMAS note below warns about. Fields
  // copied verbatim from the live 2026-08-17 `GET /v1/countries` row.
  { code: "CHE", name: "Switzerland", region: "Europe", subregion: "Western Europe", alpha_2_code: "CH", eor_onboarding: true, contractor_products_available: ["standard", "plus", "cor"] },
  // --- present in the list, but NOT EOR-onboarding countries ----------------
  // Live values, unedited. Montenegro and the Bahamas are ordinary workation
  // destinations; Martinique is an overseas department of France, so for a
  // French employee it is domestic travel. All three are `eor_onboarding:
  // false`, which is exactly why reading that flag as "supported destination"
  // would be wrong — see the note above.
  { code: "MNE", name: "Montenegro", region: "Europe", subregion: "Southern Europe", alpha_2_code: "ME", eor_onboarding: false, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "BHS", name: "Bahamas", region: "Americas", subregion: "Caribbean", alpha_2_code: "BS", eor_onboarding: false, contractor_products_available: ["standard", "plus", "cor"] },
  { code: "MTQ", name: "Martinique", region: "Americas", subregion: "Caribbean", alpha_2_code: "MQ", eor_onboarding: false, contractor_products_available: ["standard", "plus", "cor"] },
  // The empty-array case: truthy, and means the opposite of what it reads as.
  { code: "KWT", name: "Kuwait", region: "Asia", subregion: "Western Asia", alpha_2_code: "KW", eor_onboarding: false, contractor_products_available: [] },
];

// PUBLIC HOLIDAYS — `GET /v1/countries/{alpha3}/holidays/{year}`.
//
// THE MOCK HAD NO ROUTE HERE AT ALL until now, and `src/` had no caller, so
// the first consumer would have written its arithmetic against nothing. What
// it would have got wrong is not a shape but an ANSWER: the national and the
// subdivision call return DISJOINT sets, so an Ontario employee's real 2026
// calendar is the union — 9 days — while either single call returns a
// plausible, well-formed, wrong list and neither errors. `src/remote/holidays.js`
// carries the full evidence; this fixture is what makes it testable offline.
//
// EVERY ROW BELOW IS COPIED FROM THE LIVE SANDBOX, 2026-08-19, unedited —
// names, `note: null`, and Ontario's Boxing Day `observed_day: "2026-12-28"`
// (the one live row in this repo's captures where `observed_day !== day`, and
// therefore the only thing that can prove the `observed_day ?? day` rule is
// wired). Row counts: CAN 5 national / ON 4 / QC 3 / BC 6, USA 11 federal /
// every state 0, NLD 11 / NL-ZH 0, GBR 6 / GB-SCT 3.
//
// THE UNITED STATES CASE IS DELIBERATELY INCLUDED AND IS DELIBERATELY EMPTY.
// Remote serves federal days only; US-CA, US-NY and US-TX each answer 200 with
// zero rows [CONFIRMED live]. Keeping the empty subdivisions here — rather than
// omitting the states, which would make them 400 — is what keeps "a state with
// no extra days in Remote's data" distinguishable from "a subdivision code
// Remote does not recognise".
//
// COUNTRIES: only four, and Canada is NOT in the mock's COUNTRIES registry
// above (its absence is load-bearing for UC-03's unsupported-destination
// fixture). That is faithful in its own way — it means a caller must pass
// "CAN" rather than "CA" against this mock, exactly as a caller must against
// the live API when the registry read fails. The route below keys on alpha-3
// and does not consult COUNTRIES, because the live endpoint does not either.
const HOLIDAYS = {
  CAN: {
    national: [
      { name: "New Year's Day", day: "2026-01-01", note: null, observed_day: "2026-01-01" },
      { name: "Good Friday", day: "2026-04-03", note: null, observed_day: "2026-04-03" },
      { name: "Canada Day", day: "2026-07-01", note: null, observed_day: "2026-07-01" },
      { name: "Labour Day", day: "2026-09-07", note: null, observed_day: "2026-09-07" },
      { name: "Christmas Day", day: "2026-12-25", note: null, observed_day: "2026-12-25" },
    ],
    subdivisions: {
      "CA-ON": [
        { name: "Family Day (Family Day)", day: "2026-02-16", note: null, observed_day: "2026-02-16" },
        { name: "Victoria Day (Victoria Day)", day: "2026-05-18", note: null, observed_day: "2026-05-18" },
        { name: "Thanksgiving Day (Thanksgiving Day)", day: "2026-10-12", note: null, observed_day: "2026-10-12" },
        { name: "Boxing Day", day: "2026-12-26", note: null, observed_day: "2026-12-28" },
      ],
      "CA-QC": [
        { name: "National Patriotes Day", day: "2026-05-18", note: null, observed_day: "2026-05-18" },
        { name: "Saint John the Baptist Day (Saint John the Baptist Day)", day: "2026-06-24", note: null, observed_day: "2026-06-24" },
        { name: "Thanksgiving Day (Thanksgiving Day)", day: "2026-10-12", note: null, observed_day: "2026-10-12" },
      ],
      "CA-BC": [
        { name: "Family Day (Family Day)", day: "2026-02-16", note: null, observed_day: "2026-02-16" },
        { name: "Victoria Day (Victoria Day)", day: "2026-05-18", note: null, observed_day: "2026-05-18" },
        { name: "British Columbia Day (August Civic Holiday)", day: "2026-08-03", note: null, observed_day: "2026-08-03" },
        { name: "National Day for Truth and Reconciliation (National Day for Truth and Reconciliation)", day: "2026-09-30", note: null, observed_day: "2026-09-30" },
        { name: "Thanksgiving Day (Thanksgiving Day)", day: "2026-10-12", note: null, observed_day: "2026-10-12" },
        { name: "Remembrance Day (Armistice Day)", day: "2026-11-11", note: null, observed_day: "2026-11-11" },
      ],
    },
  },
  USA: {
    national: [
      { name: "New Year's Day", day: "2026-01-01", note: null, observed_day: "2026-01-01" },
      { name: "Martin Luther King Jr. Day", day: "2026-01-19", note: null, observed_day: "2026-01-19" },
      { name: "Washington’s Birthday", day: "2026-02-16", note: null, observed_day: "2026-02-16" },
      { name: "Memorial Day", day: "2026-05-25", note: null, observed_day: "2026-05-25" },
      { name: "Juneteenth National Independence Day", day: "2026-06-19", note: null, observed_day: "2026-06-19" },
      { name: "Independence Day", day: "2026-07-04", note: null, observed_day: "2026-07-03" },
      { name: "Labor Day", day: "2026-09-07", note: null, observed_day: "2026-09-07" },
      { name: "Columbus Day", day: "2026-10-12", note: null, observed_day: "2026-10-12" },
      { name: "Veterans Day", day: "2026-11-11", note: null, observed_day: "2026-11-11" },
      { name: "Thanksgiving Day", day: "2026-11-26", note: null, observed_day: "2026-11-26" },
      { name: "Christmas Day", day: "2026-12-25", note: null, observed_day: "2026-12-25" },
    ],
    subdivisions: {
      "US-CA": [

      ],
      "US-NY": [

      ],
    },
  },
  NLD: {
    national: [
      { name: "New Year's Day (Nieuwjaarsdag)", day: "2026-01-01", note: null, observed_day: "2026-01-01" },
      { name: "Good Friday (Goede Vrijdag)", day: "2026-04-03", note: null, observed_day: "2026-04-03" },
      { name: "Easter (Pasen)", day: "2026-04-05", note: null, observed_day: "2026-04-05" },
      { name: "Easter Monday (Paasmaandag)", day: "2026-04-06", note: null, observed_day: "2026-04-06" },
      { name: "Royal Day (Koningsdag)", day: "2026-04-27", note: null, observed_day: "2026-04-27" },
      { name: "Liberation Day (Bevrijdingsdag)", day: "2026-05-05", note: null, observed_day: "2026-05-05" },
      { name: "Feast of the Ascension of Jesus Christ (Hemelvaartsdag)", day: "2026-05-14", note: null, observed_day: "2026-05-14" },
      { name: "Pentecost (Eerste Pinksterdag)", day: "2026-05-24", note: null, observed_day: "2026-05-24" },
      { name: "Pentecost Monday (Tweede Pinksterdag)", day: "2026-05-25", note: null, observed_day: "2026-05-25" },
      { name: "Christmas Day (Kerstmis)", day: "2026-12-25", note: null, observed_day: "2026-12-25" },
      { name: "Boxing Day (Tweede Kerstdag)", day: "2026-12-26", note: null, observed_day: "2026-12-26" },
    ],
    subdivisions: {
      "NL-ZH": [

      ],
    },
  },
  GBR: {
    national: [
      { name: "New Year's Day", day: "2026-01-01", note: null, observed_day: "2026-01-01" },
      { name: "Good Friday", day: "2026-04-03", note: null, observed_day: "2026-04-03" },
      { name: "Early May Bank Holiday", day: "2026-05-04", note: null, observed_day: "2026-05-04" },
      { name: "Spring Bank Holiday", day: "2026-05-25", note: null, observed_day: "2026-05-25" },
      { name: "Christmas Day", day: "2026-12-25", note: null, observed_day: "2026-12-25" },
      { name: "Boxing Day", day: "2026-12-26", note: null, observed_day: "2026-12-28" },
    ],
    subdivisions: {
      "GB-SCT": [
        { name: "Second Day of the New Year", day: "2026-01-02", note: null, observed_day: "2026-01-02" },
        { name: "Summer Bank Holiday", day: "2026-08-03", note: null, observed_day: "2026-08-03" },
        { name: "Saint Andrew's Day", day: "2026-11-30", note: null, observed_day: "2026-11-30" },
      ],
    },
  },
};

// The subdivision codes Remote RECOGNISES for each country, whether or not it
// has any days for them. Live, an unrecognised code is a **400
// `{"message":"Country Subdivision is invalid"}`** (`CA-ZZ`, `Ontario` — both
// [CONFIRMED]) while a recognised one with no extra days is a **200 `[]`**.
// That difference is the only thing that makes an empty subdivision list
// readable as a fact rather than as a maybe, so the mock has to reproduce it —
// a mock that answered `[]` for every unknown code would teach the opposite.
const HOLIDAY_SUBDIVISIONS = Object.fromEntries(
  Object.entries(HOLIDAYS).map(([code, entry]) => [code, new Set(Object.keys(entry.subdivisions))])
);

// UC-06 fixtures — the dynamic per-country schema (00-FOUNDATION.md invariant
// #2) and the payroll cutoff calendar. Fixed calendar dates (not relative to
// "today") so tests stay reproducible; cutoffEngine.js takes `now` as an
// explicit argument rather than reading the system clock, so tests choose
// whichever "now" makes sense against these fixed cycles.
// One entry per country this mock has an EMPLOYMENT fixture in. That is not
// decoration: since finding F-15, a country the schema endpoint 404s for
// escalates instead of validating vacuously, so a mock that serves employees
// in DE/GB/PL/CH but no schemas for them would make every amendment for those
// employees escalate on the mock's own incompleteness rather than on anything
// the gates decided. The real API serves a schema for every country it
// supports; this mirrors that. A country with NO entry here still 404s — which
// is exactly how test/uc06.test.js exercises the escalate-on-missing path.
//
// KEYED ON ALPHA-3, BECAUSE THE REAL ENDPOINT IS (finding F-27, second half).
// These keys used to be alpha-2 ("DE"), which agreed with the code that called
// them and disagreed with Remote. Remote's reference for
// `GET /v1/countries/{country_code}/{form}` says the path parameter is a
// "Country code according to ISO 3-digit alphabetic codes" (example "PRT"),
// and live 2026-08-17 every alpha-2 form answered `404 {"message":"Country not
// found"}` while every alpha-3 form answered 200. A fixture that agrees with
// the caller instead of the API is how UC-03's dead gate survived; it is the
// same mechanism that hid this one, so the keys are the API's axis now and
// `RemoteClient.getCountrySchema()` resolves alpha-2 -> alpha-3 before calling.
//
// The `required` LISTS below remain the mock's own simplified contract, NOT
// copies of Remote's real forms — the real DEU form requires eight
// onboarding-shaped fields (name, login_email, mobile_number, …) that the mock's
// flat employment fixtures do not carry at all. Which fields the real forms
// require is pinned separately, against verbatim live captures, in
// test/uc06CountrySchemaAxis.test.js — see the payload gap recorded there.
// Employment statuses `PUT /v1/employments/{id}/basic-information` accepts.
// VERBATIM from Remote's own reference for that endpoint: *"Supported
// employment statuses: `created`, `job_title_review`, `created_reserve_paid`,
// `created_awaiting_reserve`"* [CONFIRMED, developer.remote.com 2026-08-18].
// `active` is absent, and `active` is the only status UC-06's gate 2 admits —
// which is why that endpoint was never UC-06's write, however it was called.
const BASIC_INFORMATION_WRITABLE_STATUSES = new Set([
  "created",
  "job_title_review",
  "created_reserve_paid",
  "created_awaiting_reserve",
]);

// alpha-2 -> alpha-3, built FROM THE COUNTRIES LIST ABOVE rather than
// hand-written. The same rule the real client follows (prime directive #4: this
// repo does not invent a 249-entry mapping table); here the list is already in
// the file, so the map is derived from it and cannot drift from it.
/**
 * Re-materialise the salary bounds in a captured amendment form for the
 * employment being asked about.
 *
 * THE LIVE ENDPOINT DOES THIS, which is why it takes an `employment_id` at all.
 * The Dutch rule arrives as
 *   if   annual_gross_salary <= 7199999      // one cent below the CURRENT salary
 *   then required [salary_decrease_reason, was_employee_informed]
 *   else those two are FORBIDDEN
 * — 7199999 because the employment the fixture was captured from earns
 * 7200000. That is how Remote states "a decrease needs a reason and an informed
 * employee": not as a rule in anyone's code, but as a number computed for this
 * contract. GBR and POL carry the same rule against their own salaries.
 *
 * Serving the captured number to a DIFFERENT employment would therefore say
 * something false about that employment — a raise could read as a decrease, or
 * a decrease as a raise. So the bound is recomputed here from the record's own
 * `contract_details.annual_gross_salary`, which is the rule the capture
 * demonstrates rather than a rule invented for the mock. Bounds on any other
 * field, and every other part of the form, are left exactly as captured.
 */
function materializeForEmployment(schema, employment) {
  const current = employment?.contract_details?.annual_gross_salary;
  if (typeof current !== "number") return schema;
  const clone = JSON.parse(JSON.stringify(schema));
  for (const rule of clone.allOf ?? []) {
    const spec = rule?.if?.properties?.annual_gross_salary;
    if (spec && typeof spec.maximum === "number") spec.maximum = current - 1;
  }
  return clone;
}

const ALPHA2_TO_ALPHA3 = Object.fromEntries(
  COUNTRIES.filter((c) => c.alpha_2_code && c.code).map((c) => [c.alpha_2_code, c.code])
);

export const COUNTRY_SCHEMAS = (() => {
  // LIVE CAPTURE, 2026-08-18, gateway.remote-sandbox.com [CONFIRMED]:
  //   GET /v1/countries/{NGA,POL,CHE,NLD,GBR,USA}/employment_basic_information
  // all return the identical form below. DEU adds `mobile_number` to both
  // `required` and `properties`; FRA adds `ack_non_eligible_job_titles`.
  //
  // WHAT THIS REPLACES, AND WHY IT MATTERS. This map used to be
  // `{required: ["job_title", "weekly_hours"]}` per country — with no
  // `properties` and no `additionalProperties`. Neither name is a field of any
  // Remote form, and the absent `properties`/`additionalProperties` are what
  // made a payload of invented keys look acceptable: an open schema accepts
  // anything. So the fixture agreed with `buildAmendmentPayload()`, and both
  // disagreed with Remote, for the life of the use case.
  //
  // READ THE HEADER OF src/remote/fixtures/contractAmendmentSchemas.js BEFORE
  // REACHING FOR THIS ONE. This form has no salary property and no hours
  // property, so it CANNOT express UC-06's amendment; it is the ONBOARDING
  // basic-information form, and its only write verb refuses `active`
  // employments. It is served here because `getCountrySchema()` still exists
  // and other code may legitimately ask for it — not because UC-06 uses it.
  const base = {
    type: "object",
    additionalProperties: false,
    required: [
      "has_seniority_date",
      "name",
      "job_title",
      "provisional_start_date",
      "tax_servicing_countries",
      "tax_job_category",
      "login_email",
    ],
    properties: {
      has_seniority_date: { type: "string" },
      job_title: { type: "string" },
      login_email: { type: "string" },
      name: { type: "string" },
      personal_email: { type: "string" },
      provisional_start_date: { type: "string", format: "date" },
      seniority_date: { type: "string", format: "date" },
      tax_job_category: { type: "string" },
      tax_servicing_countries: { type: "array" },
      work_email: { type: "string" },
    },
  };
  const withExtra = (field) => ({
    ...base,
    required: [...base.required, field],
    properties: { ...base.properties, [field]: { type: "string" } },
  });
  return {
    NGA: base,
    USA: base,
    GBR: base,
    POL: base,
    CHE: base,
    NLD: base,
    DEU: withExtra("mobile_number"),
    FRA: withExtra("ack_non_eligible_job_titles"),
  };
})();


// UC-05 fixture — the Time Off API behind `GET /v1/leave-policies/summary/:id`.
//
// SHAPE IS [CONFIRMED], copied from live responses read off
// gateway.remote-sandbox.com on 2026-08-19 — every key below is a key the live
// endpoint sent, with a live value, and no key it has never sent. That rule is
// the whole reason this fixture is here: `src/remote/leaveBalances.js` exists
// because UC-05's payout days had no source at all, and a fixture that invented
// a friendlier shape would put the days back on a source only this repo has
// (the mistake `country_code` and the payroll `process_date` both were).
//
// THE TWO TRAPS THE ROWS BELOW REPRODUCE ON PURPOSE, both live-observed:
//
//   1. `balance` is NOT `annual_entitlement − used` — that figure is
//      `annual_balance`. `balance` is the accrued-to-date remaining figure, and
//      on `emp_uk_001` below the two differ by 11.25 days on the same record
//      (annual_balance 25, balance 13d 6h). A reconciler that recomputes the
//      payout base instead of reading `balance` overpays by that difference,
//      and every arithmetic check it runs on itself still passes.
//   2. `days` and `hours` are COMPONENTS OF ONE QUANTITY. `{days: 13, hours: 6}`
//      is 13.75 days at this row's own `working_hours_per_day: 8`. Reading
//      `days` alone truncates, quietly, in the employer's favour.
//
// A NEGATIVE `balance` IS REAL AND IS HERE (`emp_pl_001`). Live, 4 of the 46
// leave policies on the Sandbox's 112 employments carry one — an employee who
// has taken more leave than has accrued. It is not a payout of zero: it is a
// question for HR Ops, which is why `unusableFields()` refuses it by name
// rather than clamping (finding F-33).
//
// NO `type: "unlimited"` ROW EXISTS HERE, and that is deliberate. All 46 live
// policies read `limited`. `quantityToDays()` handles the unlimited shape and
// is tested against an explicit literal; manufacturing an instance in the mock
// would be serving a payload Remote has never sent.
export const LEAVE_POLICY_SUMMARIES = {
  // The straightforward one: whole days, nothing carried, nothing over-taken.
  "emp_active_001": [
    {
      used: { type: "limited", hours: 0, days: 4 },
      balance: { type: "limited", hours: 0, days: 12 },
      taken: { type: "limited", hours: 0, days: 4 },
      leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 0, days: 16 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 0, days: 20 },
      annual_balance: { type: "limited", hours: 0, days: 16 },
      working_hours_per_day: 8,
    },
  ],
  // The hours-remainder case, copied value-for-value from the live CA record
  // 33db8dbb: entitlement 30, used 5, annual_balance 25, and a `balance` of
  // 13 days 6 hours because only 18d 6h has accrued so far this year.
  "emp_uk_001": [
    {
      used: { type: "limited", hours: 0, days: 5 },
      balance: { type: "limited", hours: 6, days: 13 },
      taken: { type: "limited", hours: 0, days: 5 },
      leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 6, days: 18 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 0, days: 30 },
      annual_balance: { type: "limited", hours: 0, days: 25 },
      working_hours_per_day: 8,
    },
  ],
  // Two policies on one employment, which is what the French records look like
  // live — a localised display name over a stable `leave_type`. Nothing here
  // filters by leave type; see normalizeLeaveBalances()'s header for why.
  "emp_de_001": [
    {
      used: { type: "limited", hours: 0, days: 0 },
      balance: { type: "limited", hours: 4, days: 5 },
      taken: { type: "limited", hours: 0, days: 0 },
      leave_policy: { name: "Cong\u00e9s N", unit: "days", description: null, leave_type: "paid_time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 4, days: 5 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 4, days: 5 },
      annual_balance: { type: "limited", hours: 4, days: 5 },
      working_hours_per_day: 8,
    },
    {
      used: { type: "limited", hours: 0, days: 0 },
      balance: { type: "limited", hours: 0, days: 0 },
      taken: { type: "limited", hours: 0, days: 0 },
      leave_policy: { name: "Time off", unit: "days", description: null, leave_type: "time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 0, days: 0 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 0, days: 0 },
      annual_balance: { type: "limited", hours: 0, days: 0 },
      working_hours_per_day: 8,
    },
  ],
  // Over-taken leave. Live shape of 09b65526: entitlement 10, used 19,
  // balance -9. The reconciler must refuse this, not settle it at 0.00.
  "emp_pl_001": [
    {
      used: { type: "limited", hours: 0, days: 19 },
      balance: { type: "limited", hours: 0, days: -9 },
      taken: { type: "limited", hours: 0, days: 19 },
      leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 0, days: 10 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 0, days: 10 },
      annual_balance: { type: "limited", hours: 0, days: -9 },
      working_hours_per_day: 8,
    },
  ],
  // UNLIMITED PTO. Copied from live employment 7b769e51, and it is the reason
  // `normalizeLeaveBalances()` consults the ENTITLEMENT and not only the
  // balance: `annual_entitlement`/`annual_balance` are `{type: "unlimited"}`
  // with no `days` key at all, while `balance` is an ordinary `limited` ZERO.
  // Read `balance` alone and an unanswerable question becomes a confident 0.00
  // final settlement. A handoff note into this work said the shape existed in
  // the schema but had no live instance; sweeping all 112 employments found
  // this one, which is why it is a fixture rather than a defensive branch.
  "emp_unsupported_country_001": [
    {
      used: { type: "limited", hours: 0, days: 0 },
      balance: { type: "limited", hours: 0, days: 0 },
      taken: { type: "limited", hours: 0, days: 0 },
      leave_policy: { name: "Paid time off", unit: "days", description: null, leave_type: "paid_time_off" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 0, days: 0 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "unlimited" },
      annual_balance: { type: "unlimited" },
      working_hours_per_day: 8,
    },
  ],
  // AN HOURS-UNIT POLICY. Live, `leave_policy.unit` reads "hours" on the Italian
  // `ex_festivita` and `rol` entitlements — and those rows STILL express their
  // balance as a {days, hours} pair (1 day 5 hours = 1.625 days at 8 h/day).
  // Here so that a consumer which starts branching on `unit` fails a test
  // rather than inventing a second shape for data that only has one.
  "emp_de_probation_001": [
    {
      used: { type: "limited", hours: 0, days: 0 },
      balance: { type: "limited", hours: 5, days: 1 },
      taken: { type: "limited", hours: 0, days: 0 },
      leave_policy: { name: "Ex Festività", unit: "hours", description: null, leave_type: "ex_festivita" },
      upcoming_requested: { type: "limited", hours: 0, days: 0 },
      upcoming_approved: { type: "limited", hours: 0, days: 0 },
      pending_approval: { type: "limited", hours: 0, days: 0 },
      current_entitlement: { type: "limited", hours: 5, days: 1 },
      booked: { type: "limited", hours: 0, days: 0 },
      annual_entitlement: { type: "limited", hours: 5, days: 1 },
      annual_balance: { type: "limited", hours: 5, days: 1 },
      working_hours_per_day: 8,
    },
  ],
  // A genuinely empty policy list. `{"data": []}` is the empty case of a list
  // endpoint — an ANSWER, distinct from the 404 that means the record is not
  // there. Both have to be reachable through the mock or UC-05's "confirmed
  // nil" and "never read" branches cannot be told apart. NOTE: no live Sandbox
  // employment answered this way (all 112 carried at least one policy), so this
  // row is the empty case and not a mirrored record.
  "emp_active_003": [],
};

// UC-06 fixture — the payroll cycle calendar behind `GET /v1/payroll-runs`
// ("List Company Payroll Runs" in Remote's own reference; the path is
// `/v1/payroll-runs`, NOT `/v1/company-payroll-runs`, which 404s — see
// RemoteClient.listPayrollRuns()).
//
// SHAPE IS [CONFIRMED], verified live 2026-08-18 against
// gateway.remote-sandbox.com. This used to be a MAP KEYED BY COMPANY ID whose
// rows carried `process_date` and `pay_date`. The live endpoint takes no
// company parameter at all (`?company_id=…` -> 422 "Unexpected field"; the
// company comes from the token) and no live row has ever had a `process_date`
// or a `pay_date`. So the old fixture invented both the addressing scheme and
// two fields — the third time this file has invented a shape, after
// `country_code` and the category `id`.
//
// A FLAT ARRAY, because that is what the API returns: one company-wide,
// MULTI-COUNTRY calendar. Live it spans SG, FR, CA, NL and US at once.
//
// THE OVERLAPS BELOW ARE DELIBERATE AND ARE THE POINT. Live, 49 pairs of runs
// from different countries cover overlapping periods, so "the cycle containing
// this date" is not unique until you filter by country. NG, DE and GB here
// share June/July periods with DIFFERENT cutoff dates for exactly that reason:
// a caller that forgets the country gets a demonstrably wrong cutoff out of
// this fixture, in a test, instead of out of production.
//
// Row keys are the live ones: id, status, type, country{code,name,alpha_2_code},
// currency_code, period_start, period_end, cutoff_date, expected_payout_date,
// approval_date, total_payroll_cost. Amounts are integer minor units, as
// strings, exactly as the live API sends them.
const NG = { code: "NGA", name: "Nigeria", alpha_2_code: "NG" };
const DE = { code: "DEU", name: "Germany", alpha_2_code: "DE" };
const GB = { code: "GBR", name: "United Kingdom", alpha_2_code: "GB" };
const NL = { code: "NLD", name: "Netherlands", alpha_2_code: "NL" };

export const PAYROLL_RUNS = [
  // Nigeria — the amendment fixtures' own country (EMPLOYMENTS emp_active_001
  // et al). Periods and cutoffs preserved from the previous fixture so UC-06's
  // existing cutoff expectations still describe the same calendar.
  { id: "run_ng_2026_06", status: "completed", type: "main", country: NG, currency_code: "NGN", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-10", expected_payout_date: "2026-06-30", approval_date: "2026-06-20", total_payroll_cost: "15103469" },
  { id: "run_ng_2026_07", status: "processing", type: "main", country: NG, currency_code: "NGN", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10", expected_payout_date: "2026-07-31", approval_date: "2026-07-20", total_payroll_cost: "15220100" },
  { id: "run_ng_2026_08", status: "preparing", type: "main", country: NG, currency_code: "NGN", period_start: "2026-08-01", period_end: "2026-08-31", cutoff_date: "2026-08-10", expected_payout_date: "2026-08-31", approval_date: null, total_payroll_cost: "15330000" },
  // Germany — SAME June and July periods, LATER cutoffs. A country-blind
  // `.find()` over this calendar hands a German amendment Nigeria's 10 June
  // lock (or a Nigerian one Germany's 20 June lock), depending only on array
  // order. That is the live hazard reproduced at fixture scale.
  { id: "run_de_2026_06", status: "completed", type: "main", country: DE, currency_code: "EUR", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-20", expected_payout_date: "2026-06-30", approval_date: "2026-06-25", total_payroll_cost: "8801200" },
  { id: "run_de_2026_07", status: "processing", type: "main", country: DE, currency_code: "EUR", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-20", expected_payout_date: "2026-07-31", approval_date: null, total_payroll_cost: "8815400" },
  // United Kingdom — a mid-month period, like the live CA cycles.
  { id: "run_gb_2026_06", status: "completed", type: "main", country: GB, currency_code: "GBP", period_start: "2026-06-15", period_end: "2026-06-30", cutoff_date: "2026-06-18", expected_payout_date: "2026-06-30", approval_date: "2026-06-22", total_payroll_cost: "4410000" },
  // Netherlands — the calendar for the two live-shaped amendment fixtures
  // (emp_nl_amend_001, emp_nl_parttime_006). PERIODS AND CUTOFFS ARE
  // DELIBERATELY IDENTICAL TO NIGERIA'S above: those dates are what every
  // existing UC-06 cutoff scenario is written against, and the use case moved
  // to a Dutch employment for a reason that has nothing to do with the
  // calendar (NLD has a contract-amendment form; NGA and USA answer 500 for
  // one). Reusing the dates keeps "before cutoff", "within 48h" and "after
  // cutoff" meaning exactly what they meant before.
  { id: "run_nl_2026_06", status: "completed", type: "main", country: NL, currency_code: "EUR", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-10", expected_payout_date: "2026-06-30", approval_date: "2026-06-20", total_payroll_cost: "9103469" },
  { id: "run_nl_2026_07", status: "processing", type: "main", country: NL, currency_code: "EUR", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10", expected_payout_date: "2026-07-31", approval_date: "2026-07-20", total_payroll_cost: "9220100" },
  { id: "run_nl_2026_08", status: "preparing", type: "main", country: NL, currency_code: "EUR", period_start: "2026-08-01", period_end: "2026-08-31", cutoff_date: "2026-08-10", expected_payout_date: "2026-08-31", approval_date: null, total_payroll_cost: "9330000" },
];

// UC-02 fixtures — the expense categories and a set of expense records covering
// every §12 scenario. The approve/decline path is a status-field PATCH on the
// expense resource (`{status: "approved"|"declined", reason}`).
//
// THE EXPENSE RECORD SHAPE IS NOW [CONFIRMED] AND COPIED FROM THE LIVE SANDBOX
// (GET /v1/expenses?page_size=20 across all 11 pages, 220 records, 2026-08-17),
// cross-checked field-by-field against the `Expense` schema in
// developer.remote.com/reference/patch_v1_expenses_id.md. It previously served
// an INVENTED shape — `total_amount`, `total_currency`,
// `reimbursement_currency`, `conversion_rate`, `category_id`, `vat_amount`,
// `description`, `submitted_at`, and a `lines[]` itemization array. **Not one
// of those fields exists on a real Remote expense.** The real record is:
//
//   id, title, employment_id, status, expense_date,
//   amount, currency:{code,name,symbol},                    // original currency
//   converted_amount, converted_currency:{code,name,symbol},// billing currency
//   tax_amount, converted_tax_amount,                       // TAX PORTION OF amount
//   expense_category:{code,title,slug}|null,                // hierarchical
//   category: string|null,                                  // DEPRECATED flat enum
//   receipts:[{id,name,type,inserted_at,sub_type}],         // maxItems 5
//   reason|null, reviewer|null, reviewed_at|null, notes|null, invoice_period|null
//
// This is the THIRD production defect this fixture has caused by inventing a
// shape (after `country_code` and the category `id`). Because the mock agreed
// with the code rather than with the API, every UC-02 test passed while the
// gates read `expense.lines` — a field that has never existed — and refused
// every real claim with `missing_itemized_breakdown`. A fixture that agrees
// with the code cannot catch a disagreement between code and API, which is the
// only thing a fixture is for.
//
// Every amount is an integer in the currency's minor unit ("in cents", per the
// schema's own description) — `amount: 4647` is £46.47, exactly like the real
// API. See src/uc02/policyEngine.js for what is cross-checkable in this model.
//
// PROVENANCE OF EACH ROW BELOW. Rows tagged [LIVE] are copied verbatim from a
// real sandbox response (only `id` and `employment_id` are rewritten to this
// mock's own ids, so the fixture stays self-consistent with EMPLOYMENTS).
// Rows tagged [LIVE-VARIANT] take a real row and change exactly one thing to
// produce a case the sandbox's seed data does not contain — an empty receipts
// array, a converted currency differing from the original, a tax larger than
// its amount. Those are marked because they are NOT observed live: the sandbox
// happens to carry a receipt on all 220 rows, the same currency on both sides
// of all 220, and tax_amount: 10 on all 220. A gate that only ever sees clean
// data is a gate nobody has watched fail, so the variants exist to make each
// one demonstrably failable.
//
// THE CATEGORY ROWS BELOW ARE [CONFIRMED] AND COPIED VERBATIM FROM THE LIVE
// SANDBOX (GET /v1/expenses/categories?employment_id=3537d9ee-…&include_parents
// =true, 2026-08-17). Not paraphrased, not "shaped like" — copied, including
// the real slugs and the real description text.
//
// WHY THAT MATTERS MORE THAN IT LOOKS. This fixture used to serve an invented
// shape: rows keyed `{id, name}` under a `{data:{categories:[…]}}` envelope.
// The real API has no `id` and no `name` on a category row, and no `categories`
// wrapper. Because the mock agreed with the code, every test passed while the
// production gate was comparing `c.id` (undefined) against a classification —
// permanently false. That is the same failure the alpha-3 country bug had: a
// fixture that agrees with the code instead of with the API cannot catch a
// disagreement between them, which is the only thing a fixture is for.
//
// The list is deliberately a SUBSET (12 of the live 41 rows) and includes the
// non-selectable parent nodes, so the selectability rule in
// src/uc02/expenseCategories.js is exercised by the same data the rest of the
// suite runs on rather than only by hand-built rows.
// `CreateOneTimeIncentiveParams.type`, all 21 members, copied from Remote's
// OpenAPI on developer.remote.com/reference/post_v1_incentives
// [CONFIRMED 2026-08-19]. DELIBERATELY NOT IMPORTED from
// src/uc09/policyEngine.js, even though that file now holds the same list.
// This server stands in for Remote, and a stand-in that reads its rules out of
// the code under test cannot ever disagree with it — which is exactly how the
// invented `/v1/recurring-incentives` path and the four dead payload fields
// went unnoticed. Two independent transcriptions of one published schema can
// disagree, and their disagreeing is the signal.
const INCENTIVE_TYPE_ENUM = new Set([
  "acting_up_allowance",
  "allowance",
  "car_allowance",
  "health_and_wellness_allowance",
  "internet_allowance",
  "meal_allowance",
  "on_call_allowance",
  "parenthood_allowance",
  "phone_allowance",
  "relocation_allowance",
  "travel_allowance",
  "work_from_home_allowance",
  "bonus",
  "holiday_bonus",
  "referral_bonus",
  "retention_bonus",
  "commission",
  "other",
  "overtime",
  "stipend",
  "signing_bonus",
]);

export const EXPENSE_CATEGORIES = [
  {
    code: "business_travel",
    parent: null,
    scope: "global",
    status: "active",
    instructions: null,
    description: "For all work-related trips.",
    title: "Business travel",
    prompt: null,
    slug: "cb028040-76d2-4e36-b67f-bd10949abbf9",
    is_selectable: false,
  },
  {
    code: "business_travel.accommodation",
    parent: { code: "business_travel", title: "Business travel", slug: "cb028040-76d2-4e36-b67f-bd10949abbf9" },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Hotel or other lodging during your trip.",
    title: "Accommodation",
    prompt: null,
    slug: "17fde76f-a927-4463-84eb-b7a9e69fc8b6",
    is_selectable: true,
  },
  {
    code: "business_travel.local_transportation",
    parent: { code: "business_travel", title: "Business travel", slug: "cb028040-76d2-4e36-b67f-bd10949abbf9" },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Local transport during your trip (such as taxis, ride apps, or public transit)",
    title: "Local transportation",
    prompt: null,
    slug: "fe9f58ef-8189-42c8-86d8-5075aced6d21",
    is_selectable: true,
  },
  {
    code: "business_travel.travel_long_distance",
    parent: { code: "business_travel", title: "Business travel", slug: "cb028040-76d2-4e36-b67f-bd10949abbf9" },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Any long-distance transport to/from your business trip destination.",
    title: "Travel (long-distance)",
    prompt: null,
    slug: "24fe445f-7449-459b-a9d1-74e14b03def2",
    is_selectable: true,
  },
  {
    code: "company_and_office_expenses",
    parent: null,
    scope: "global",
    status: "active",
    instructions: null,
    description: "General business or team expenses paid on behalf of the company.",
    title: "Company and office expenses",
    prompt: null,
    slug: "38058b6a-003f-4d9c-bc09-53bb40425575",
    is_selectable: false,
  },
  {
    code: "company_and_office_expenses.office_supplies_and_shipping",
    parent: {
      code: "company_and_office_expenses",
      title: "Company and office expenses",
      slug: "38058b6a-003f-4d9c-bc09-53bb40425575",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Office supplies or courier costs for work-related needs.",
    title: "Office supplies and shipping",
    prompt: null,
    slug: "9d0b087a-8fbf-48cc-b4e9-73fa3a7d8ea5",
    is_selectable: true,
  },
  {
    code: "company_and_office_expenses.personal_occasion_gifts",
    parent: {
      code: "company_and_office_expenses",
      title: "Company and office expenses",
      slug: "38058b6a-003f-4d9c-bc09-53bb40425575",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Covers gifts for coworkers (e.g. birthday, baby, bereavement, get well soon).",
    title: "Personal occasion gifts",
    prompt: null,
    slug: "787a79ef-8ce3-482e-807c-6f6ff3562015",
    is_selectable: true,
  },
  {
    code: "home_office_and_co_working",
    parent: null,
    scope: "global",
    status: "active",
    instructions: null,
    description: "For remote work expenses.",
    title: "Home office and co-working",
    prompt: null,
    slug: "616d12ab-4f1a-4d1d-bb3d-ce89b7ef4f81",
    is_selectable: false,
  },
  {
    code: "home_office_and_co_working.co_working_part_time_or_daily",
    parent: {
      code: "home_office_and_co_working",
      title: "Home office and co-working",
      slug: "616d12ab-4f1a-4d1d-bb3d-ce89b7ef4f81",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Co-working space memberships or drop-in passes",
    title: "Co-working (part-time or daily)",
    prompt: null,
    slug: "0aaf8a1d-5e92-468e-b60a-26ae1a56caec",
    is_selectable: true,
  },
  {
    code: "tech_and_work_equipment",
    parent: null,
    scope: "global",
    status: "active",
    instructions: null,
    description: "Work-related tools and subscriptions necessary for your role.",
    title: "Tech and work equipment",
    prompt: null,
    slug: "7bae891e-4ec8-479f-a1bf-f2f9673f1366",
    is_selectable: false,
  },
  {
    code: "tech_and_work_equipment.software_and_subscriptions",
    parent: {
      code: "tech_and_work_equipment",
      title: "Tech and work equipment",
      slug: "7bae891e-4ec8-479f-a1bf-f2f9673f1366",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description: "Paid tools or software required for your daily work.",
    title: "Software and subscriptions",
    prompt: null,
    slug: "22d3b7c9-2e85-44c4-87e6-2e4ff4bec611",
    is_selectable: true,
  },
  {
    code: "work_meals_and_entertainment",
    parent: null,
    scope: "global",
    status: "active",
    instructions: null,
    description:
      "Meals and gatherings related to work. Include reason and names of participants when applicable.",
    title: "Work meals and entertainment",
    prompt: null,
    slug: "7f655db0-91c1-4b92-ae76-18dc9d3ec883",
    is_selectable: false,
  },
  {
    code: "work_meals_and_entertainment.external_meals_and_entertainment",
    parent: {
      code: "work_meals_and_entertainment",
      title: "Work meals and entertainment",
      slug: "7f655db0-91c1-4b92-ae76-18dc9d3ec883",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description:
      "Meals or entertainment with clients, partners, or external contacts. Add reason and list of participants.",
    title: "External meals and entertainment",
    prompt: null,
    slug: "baa1d2f6-7289-4e3e-8c89-22cae228aa8c",
    is_selectable: true,
  },
  {
    code: "work_meals_and_entertainment.internal_meals_and_entertainment",
    parent: {
      code: "work_meals_and_entertainment",
      title: "Work meals and entertainment",
      slug: "7f655db0-91c1-4b92-ae76-18dc9d3ec883",
    },
    scope: "global",
    status: "active",
    instructions: null,
    description:
      "Meals or gatherings with colleagues for team-building or other work-related purposes.\nAdd reason and list of participants.",
    title: "Internal meals and entertainment",
    prompt: null,
    slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7",
    is_selectable: true,
  },
];

// Currency objects, copied VERBATIM from live sandbox responses. Note the real
// API returns an OBJECT here, not a currency-code string — `currency: "USD"`
// was one of the invented fields, and code that read `expense.total_currency`
// as a string compared an object to a string and silently never matched.
const USD = { code: "USD", name: "United States Dollar", symbol: "$" };
const EUR = { code: "EUR", name: "European Euro", symbol: "€" };
const GBP = { code: "GBP", name: "United Kingdom Pound Sterling", symbol: "£" };

// `expense_category` objects, copied VERBATIM from live rows (including the
// real per-account slugs).
//
// ⚠ THE RECORD'S CATEGORY NAMESPACE IS NOT THE CATEGORIES ENDPOINT'S. These
// codes (`meals`, `tech_equipment`, …) are the DEPRECATED flat enum, and they
// are disjoint from the 32 hierarchical codes `GET /v1/expenses/categories`
// returns (`work_meals_and_entertainment.internal_meals_and_entertainment`, …).
// Confirmed live 2026-08-17: zero overlap between the two sets, and on all 220
// live rows `category === expense_category.code`. So the record's own category
// can never be used as an authoritative selectable code — it is a TEXT HINT
// fed to the classifier, and the classifier's answer is validated against the
// real selectable list. See src/uc02/expenseClassifier.js.
const CAT_MEALS = { code: "meals", title: "Meals", slug: "1bc932cd-eab7-431d-826d-15ea748b5b79" };
const CAT_LODGING = { code: "lodging", title: "Lodging", slug: "33ab5fc8-f957-4b62-8809-33de0c8198e3" };
const CAT_TECH = { code: "tech_equipment", title: "Tech / Work Equipment", slug: "a2bd9629-280c-41f4-bc12-0c659255e8ca" };
const CAT_COWORKING = { code: "coworking_office", title: "Coworking / Office", slug: "f927edcd-ce7c-4277-b6f3-1120af824249" };
const CAT_WELLNESS = { code: "wellness", title: "Wellness", slug: "beb3eb71-db25-4323-9684-48cb3d006647" };

/**
 * A receipt File row in the real shape. 218 of the 220 live rows use
 * `type: "expense"` and 2 use `"document_scan"`; `sub_type` is null on every
 * one. `id`, `name`, `type` and `inserted_at` are all schema-required.
 */
const receipt = (id) => ({ id, name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null });

export const EXPENSES = {
  // --- Clean, auto-approvable claims ---------------------------------------
  // Dedicated to tests/CLI seeds that APPROVE (mutate) state — same rule as
  // emp_active_003 above: keeping mutations off any shared fixture means the
  // rest of the suite can rely on its records staying pristine regardless of
  // test order within the same process.
  //
  // [LIVE] shape copied from expense ae93eeeb-e26f-49a1-976c-d6280d5a4d18
  // ("Team Lunch", USD, meals). Same currency on both sides and a receipt
  // present — which is what every one of the 220 live rows looks like.
  "exp_auto_101": {
    id: "exp_auto_101", employment_id: "emp_active_001", status: "pending",
    title: "Team dinner during the Q3 planning offsite",
    amount: 12500, currency: USD,
    converted_amount: 12500, converted_currency: USD,
    tax_amount: 1050, converted_tax_amount: 1050,
    expense_date: "2026-07-01", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000101")],
    reason: null, notes: null, invoice_period: null,
  },

  // --- The mirrored Sandbox persona's own claims ---------------------------
  // Chris Lee (8ab12460-…) is one of the three MIRRORED SANDBOX RECORDS in
  // EMPLOYMENTS above. Without expenses of his own, UC-02's picker would offer
  // him nothing but claims belonging to `emp_active_001`, every one of which
  // fails the ownership gate — so the use case would be untestable as him while
  // looking, from outside, exactly like a working refusal.
  //
  // One clean and one over-cap, mirroring exp_auto_101 / exp_over_cap_201 field
  // for field so the pair demonstrates BOTH directions: a green auto-approve and
  // a real refusal from the same person. Same currency on both sides and a
  // receipt present, which is what all 220 live rows look like.
  "exp_sandbox_clean_401": {
    id: "exp_sandbox_clean_401", employment_id: "8ab12460-b568-4c1e-af9d-09b1fabd8f46", status: "pending",
    title: "Team dinner with the platform squad after the release",
    amount: 14200, currency: USD,
    converted_amount: 14200, converted_currency: USD,
    tax_amount: 1180, converted_tax_amount: 1180,
    expense_date: "2026-07-08", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000401")],
    reason: null, notes: null, invoice_period: null,
  },
  // Over the internal-meals cap (50000), same as exp_over_cap_201.
  "exp_sandbox_over_cap_402": {
    id: "exp_sandbox_over_cap_402", employment_id: "8ab12460-b568-4c1e-af9d-09b1fabd8f46", status: "pending",
    title: "Whole-department dinner at the New York offsite",
    amount: 88000, currency: USD,
    converted_amount: 88000, converted_currency: USD,
    tax_amount: 7040, converted_tax_amount: 7040,
    expense_date: "2026-07-09", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000402")],
    reason: null, notes: null, invoice_period: null,
  },
  // JAMES WILSON'S TWO CLAIMS. Both are deliberately CLEAN — correct category,
  // under the cap, receipt attached — so the only thing that can refuse either is
  // the OWNERSHIP gate. If one also breached a cap, a refusal would not prove
  // which gate fired and the demonstration would be worthless.
  //
  // WHY TWO RATHER THAN ONE. The portal shows this pair of buttons: the claim
  // submitted by somebody else (must refuse) and a claim submitted by James
  // himself (must auto-approve). Pointing both at ONE expense looks tidier and is
  // broken — UC-02's duplicate gate fires on the second submission of the same
  // expense, so whichever button is clicked second returns
  // `blocked / duplicate_submission` instead of the outcome its label promises.
  // Caught by driving both buttons in one session; a single-button test would
  // never have shown it.
  // BOTH ARE USD, THOUGH JAMES IS GB, AND THAT IS DELIBERATE. The policy cap is
  // denominated in USD and this file does not fake conversion rates, so a
  // non-USD claim is refused outright as `policy_cap_currency_mismatch`
  // (uc02/policyEngine.js:330 — an honest refusal, not a workaround). A GBP
  // claim here would therefore come back `human_review` for a reason that has
  // nothing to do with ownership, and the pair would no longer differ only in
  // who submitted it. Claims filed in USD by a UK employee travelling to the US
  // are ordinary, so the titles say that rather than quietly leaving it odd.
  "exp_sandbox_other_owner_403": {
    id: "exp_sandbox_other_owner_403", employment_id: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b", status: "pending",
    title: "Client lunch in New York during the account review trip",
    amount: 9600, currency: USD,
    converted_amount: 9600, converted_currency: USD,
    tax_amount: 800, converted_tax_amount: 800,
    expense_date: "2026-07-10", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000403")],
    reason: null, notes: null, invoice_period: null,
  },
  // The same shape, so the pair differs only in who submits it.
  "exp_sandbox_own_404": {
    id: "exp_sandbox_own_404", employment_id: "7ec6a5e4-909d-47c1-a442-0688c5cc1f2b", status: "pending",
    title: "Client lunch in Boston during the account review trip",
    amount: 8800, currency: USD,
    converted_amount: 8800, converted_currency: USD,
    tax_amount: 730, converted_tax_amount: 730,
    expense_date: "2026-07-11", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000404")],
    reason: null, notes: null, invoice_period: null,
  },

  // --- Duplicate pair (§12.3) ----------------------------------------------
  // Byte-identical on every field the receipt fingerprint is derived from
  // (employment, amount, currency, tax, date, title) — two filings of one
  // real-world claim, which is exactly what the dedupe check exists to catch.
  // They differ only by id, as two separate Remote records would.
  "exp_dup_a_102": {
    id: "exp_dup_a_102", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch after the weekly sync",
    amount: 4500, currency: USD,
    converted_amount: 4500, converted_currency: USD,
    tax_amount: 375, converted_tax_amount: 375,
    expense_date: "2026-07-02", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000102")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_dup_b_103": {
    id: "exp_dup_b_103", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch after the weekly sync",
    amount: 4500, currency: USD,
    converted_amount: 4500, converted_currency: USD,
    tax_amount: 375, converted_tax_amount: 375,
    expense_date: "2026-07-02", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000103")],
    reason: null, notes: null, invoice_period: null,
  },

  // --- Client entertainment vs. internal meal (§12.7) ----------------------
  // Deliberately NOT a duplicate pair: different amounts and dates, so the
  // dedupe check cannot fire and the classification is the only thing under
  // test. `expense_category: null` is a real possibility — the schema marks it
  // `nullable: true` — and it forces the classifier onto the title text.
  "exp_client_ent_104": {
    id: "exp_client_ent_104", employment_id: "emp_active_001", status: "pending",
    title: "Dinner entertaining a prospective client at a restaurant",
    amount: 20000, currency: USD,
    converted_amount: 20000, converted_currency: USD,
    tax_amount: 1600, converted_tax_amount: 1600,
    expense_date: "2026-07-03", reviewed_at: null, reviewer: null,
    category: null, expense_category: null,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000104")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_client_ent_105": {
    id: "exp_client_ent_105", employment_id: "emp_active_001", status: "pending",
    title: "Dinner entertaining a prospective client at a restaurant",
    amount: 18500, currency: USD,
    converted_amount: 18500, converted_currency: USD,
    tax_amount: 1480, converted_tax_amount: 1480,
    expense_date: "2026-07-04", reviewed_at: null, reviewer: null,
    category: null, expense_category: null,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000105")],
    reason: null, notes: null, invoice_period: null,
  },

  // --- Shared, read-only fixtures: none of these can reach auto-approve ----

  // [LIVE-VARIANT] A cross-currency claim: EUR spent, USD billed. NOT observed
  // in the sandbox — all 220 rows carry the same currency on both sides — and
  // constructed here precisely because the real record has NO conversion-rate
  // field, so a cross-currency conversion cannot be verified from the record.
  // The gate flags it rather than guessing a rate.
  "exp_cross_currency_107": {
    id: "exp_cross_currency_107", employment_id: "emp_active_001", status: "pending",
    title: "Berlin hotel, two nights",
    amount: 20000, currency: EUR,
    converted_amount: 22000, converted_currency: USD,
    tax_amount: 1900, converted_tax_amount: 2090,
    expense_date: "2026-07-05", reviewed_at: null, reviewer: null,
    category: "lodging", expense_category: CAT_LODGING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000107")],
    reason: null, notes: null, invoice_period: null,
  },

  // Over the internal-meals cap (50000).
  "exp_over_cap_201": {
    id: "exp_over_cap_201", employment_id: "emp_active_001", status: "pending",
    title: "Team dinner for the whole department",
    amount: 75000, currency: USD,
    converted_amount: 75000, converted_currency: USD,
    tax_amount: 6000, converted_tax_amount: 6000,
    expense_date: "2026-07-06", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000201")],
    reason: null, notes: null, invoice_period: null,
  },
  // Low OCR/classification confidence (§12.4) — the title carries the signal.
  "exp_low_conf_202": {
    id: "exp_low_conf_202", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch receipt — image is blurry, scan quality poor",
    amount: 3000, currency: USD,
    converted_amount: 3000, converted_currency: USD,
    tax_amount: 250, converted_tax_amount: 250,
    expense_date: "2026-07-07", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000202")],
    reason: null, notes: null, invoice_period: null,
  },
  // Non-English receipt (§12.5).
  "exp_non_english_203": {
    id: "exp_non_english_203", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch",
    notes: "Receipt is in German — Rechnung auf Deutsch, Mehrwertsteuer ausgewiesen",
    amount: 4000, currency: USD,
    converted_amount: 4000, converted_currency: USD,
    tax_amount: 330, converted_tax_amount: 330,
    expense_date: "2026-07-08", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000203")],
    reason: null, invoice_period: null,
  },

  // [LIVE-VARIANT] NO RECEIPT. Not observed live (all 220 rows carry exactly
  // one), and the single most important variant in this file: the receipt is
  // the only independent artifact backing the amount, so a claim without one
  // has nothing to re-check and must never auto-approve. `receipts` is
  // `nullable: false` with `maxItems: 5` — an EMPTY array is representable.
  "exp_no_receipt_204": {
    id: "exp_no_receipt_204", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch with no receipt attached",
    amount: 4000, currency: USD,
    converted_amount: 4000, converted_currency: USD,
    tax_amount: 330, converted_tax_amount: 330,
    expense_date: "2026-07-09", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [],
    reason: null, notes: null, invoice_period: null,
  },

  // [LIVE-VARIANT] Tax portion larger than the amount it is a portion OF —
  // arithmetically impossible, and the schema is explicit that `tax_amount` is
  // "the tax portion of the expense amount". Not observed live (every row
  // carries tax_amount: 10 against amounts of 4647-1138127).
  "exp_tax_exceeds_205": {
    id: "exp_tax_exceeds_205", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch with an impossible tax portion",
    amount: 4000, currency: USD,
    converted_amount: 4000, converted_currency: USD,
    tax_amount: 9000, converted_tax_amount: 9000,
    expense_date: "2026-07-10", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000205")],
    reason: null, notes: null, invoice_period: null,
  },

  // [LIVE-VARIANT] Same currency on both sides, but the converted figures
  // disagree with the originals. When no currency conversion happened, the
  // conversion is the identity map, so these MUST be equal — this is the
  // closest real analogue to the old line-sum check: two independently stored
  // integers that have to reconcile. Not observed live (all 220 agree).
  "exp_conv_mismatch_206": {
    id: "exp_conv_mismatch_206", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch whose converted amount disagrees with itself",
    amount: 4000, currency: USD,
    converted_amount: 4400, converted_currency: USD,
    tax_amount: 330, converted_tax_amount: 330,
    expense_date: "2026-07-11", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000206")],
    reason: null, notes: null, invoice_period: null,
  },

  // No category resolvable from the title, and none recorded.
  "exp_no_category_208": {
    id: "exp_no_category_208", employment_id: "emp_active_001", status: "pending",
    title: "Sundry item",
    amount: 2500, currency: USD,
    converted_amount: 2500, converted_currency: USD,
    tax_amount: 200, converted_tax_amount: 200,
    expense_date: "2026-07-12", reviewed_at: null, reviewer: null,
    category: null, expense_category: null,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000208")],
    reason: null, notes: null, invoice_period: null,
  },
  // Belongs to a DIFFERENT employment than the one that will submit it.
  "exp_mismatch_209": {
    id: "exp_mismatch_209", employment_id: "emp_active_003", status: "pending",
    title: "Team lunch after the weekly sync",
    amount: 4500, currency: USD,
    converted_amount: 4500, converted_currency: USD,
    tax_amount: 375, converted_tax_amount: 375,
    expense_date: "2026-07-13", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000209")],
    reason: null, notes: null, invoice_period: null,
  },
  // Belongs to a terminated employment.
  "exp_terminated_210": {
    id: "exp_terminated_210", employment_id: "emp_terminated_002", status: "pending",
    title: "Office supplies before departure",
    amount: 9000, currency: USD,
    converted_amount: 9000, converted_currency: USD,
    tax_amount: 750, converted_tax_amount: 750,
    expense_date: "2026-07-14", reviewed_at: null, reviewer: null,
    category: "tech_equipment", expense_category: CAT_TECH,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000210")],
    reason: null, notes: null, invoice_period: null,
  },

  // [LIVE] Already-decided records. 129 of the 220 live rows are `approved`
  // and 17 are `declined`; a decided claim is somebody's finished decision and
  // re-approving it either overturns a human or pays twice (finding F-11).
  // Note the real shape of a decided record: `reviewed_at` is set, and
  // `reason` carries the decline text.
  "exp_approved_211": {
    id: "exp_approved_211", employment_id: "emp_active_001", status: "approved",
    title: "Coffee",
    amount: 4647, currency: GBP,
    converted_amount: 4647, converted_currency: GBP,
    tax_amount: 10, converted_tax_amount: 10,
    expense_date: "2026-04-25", reviewed_at: "2026-04-25", reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [{ id: "05bca2c0-8f81-47d1-a7c6-781d5dbf6199", name: "receipt.pdf", type: "document_scan", inserted_at: "2026-06-26T14:49:56Z", sub_type: null }],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_declined_212": {
    id: "exp_declined_212", employment_id: "emp_active_001", status: "declined",
    title: "Personal gym membership",
    amount: 8500, currency: USD,
    converted_amount: 8500, converted_currency: USD,
    tax_amount: 700, converted_tax_amount: 700,
    expense_date: "2026-05-02", reviewed_at: "2026-05-04", reviewer: null,
    category: "wellness", expense_category: CAT_WELLNESS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000212")],
    reason: "Not covered by the company expense policy.", notes: null, invoice_period: null,
  },

  // [LIVE-VARIANT] A null amount. Every live row carries an integer, and the
  // schema marks `amount` required — but `null` coerces to 0 through
  // `Number()`, which is exactly how a malformed record once satisfied an
  // arithmetic check (finding F-23). The sanity gate rejects it by type.
  "exp_null_amount_213": {
    id: "exp_null_amount_213", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch with a missing amount",
    amount: null, currency: USD,
    converted_amount: null, converted_currency: USD,
    tax_amount: 0, converted_tax_amount: 0,
    expense_date: "2026-07-15", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000213")],
    reason: null, notes: null, invoice_period: null,
  },

  // [LIVE-VARIANT] A future expense date. The schema says `expense_date` "Must
  // be in the past"; none of the 220 live rows breaks that. A claim for money
  // not yet spent is not something to reimburse automatically.
  "exp_future_date_214": {
    id: "exp_future_date_214", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch booked for next year",
    amount: 4000, currency: USD,
    converted_amount: 4000, converted_currency: USD,
    tax_amount: 330, converted_tax_amount: 330,
    expense_date: "2099-01-15", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000214")],
    reason: null, notes: null, invoice_period: null,
  },

  // [LIVE] A perfectly well-formed GBP claim — 4 of the 220 live rows are GBP,
  // and the live account bills in five different currencies. The policy-cap
  // corpus is denominated in ONE currency (POLICY_CAP_CURRENCY), so this claim
  // is internally consistent yet still cannot be measured against the cap.
  // That is a human review, not an approval.
  "exp_gbp_215": {
    id: "exp_gbp_215", employment_id: "emp_active_001", status: "pending",
    title: "Team lunch in London",
    amount: 10366, currency: GBP,
    converted_amount: 10366, converted_currency: GBP,
    tax_amount: 10, converted_tax_amount: 10,
    expense_date: "2026-01-22", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [{ id: "d5f61419-dec3-4ce6-8a69-fcdba47db86c", name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }],
    reason: null, notes: null, invoice_period: null,
  },

  // Dedicated to the write-body test: auto-approving tests mutate their record
  // (status -> approved), and the engine refuses anything not `pending`, so
  // each one needs its own.
  "exp_writebody_216": {
    id: "exp_writebody_216", employment_id: "emp_active_001", status: "pending",
    title: "Team dinner during the Q3 planning offsite",
    amount: 12500, currency: USD,
    converted_amount: 12500, converted_currency: USD,
    tax_amount: 1050, converted_tax_amount: 1050,
    expense_date: "2026-07-21", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000216")],
    reason: null, notes: null, invoice_period: null,
  },

  // --- Server-test-only fixtures -------------------------------------------
  // Separate process from uc02.test.js, so ids may repeat across the two files
  // — never within one file. Each auto-approving test gets its OWN record:
  // the approve PATCH mutates status in place and the engine refuses anything
  // not `pending` (F-11), so a shared one would fail on execution order.
  "exp_srv_auto_301": {
    id: "exp_srv_auto_301", employment_id: "emp_active_001", status: "pending",
    title: "Co-working day pass while travelling",
    amount: 6000, currency: USD,
    converted_amount: 6000, converted_currency: USD,
    tax_amount: 500, converted_tax_amount: 500,
    expense_date: "2026-07-16", reviewed_at: null, reviewer: null,
    category: "coworking_office", expense_category: CAT_COWORKING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000301")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_srv_overcap_302": {
    id: "exp_srv_overcap_302", employment_id: "emp_active_001", status: "pending",
    title: "Team dinner for the whole department",
    amount: 60000, currency: USD,
    converted_amount: 60000, converted_currency: USD,
    tax_amount: 4800, converted_tax_amount: 4800,
    expense_date: "2026-07-17", reviewed_at: null, reviewer: null,
    category: "meals", expense_category: CAT_MEALS,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000302")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_srv_dup_a_303": {
    id: "exp_srv_dup_a_303", employment_id: "emp_active_001", status: "pending",
    title: "Co-working day pass",
    amount: 2500, currency: USD,
    converted_amount: 2500, converted_currency: USD,
    tax_amount: 200, converted_tax_amount: 200,
    expense_date: "2026-07-18", reviewed_at: null, reviewer: null,
    category: "coworking_office", expense_category: CAT_COWORKING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000303")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_srv_dup_b_304": {
    id: "exp_srv_dup_b_304", employment_id: "emp_active_001", status: "pending",
    title: "Co-working day pass",
    amount: 2500, currency: USD,
    converted_amount: 2500, converted_currency: USD,
    tax_amount: 200, converted_tax_amount: 200,
    expense_date: "2026-07-18", reviewed_at: null, reviewer: null,
    category: "coworking_office", expense_category: CAT_COWORKING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000304")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_srv_demo_305": {
    id: "exp_srv_demo_305", employment_id: "emp_active_001", status: "pending",
    title: "Co-working day pass while travelling",
    amount: 6000, currency: USD,
    converted_amount: 6000, converted_currency: USD,
    tax_amount: 500, converted_tax_amount: 500,
    expense_date: "2026-07-19", reviewed_at: null, reviewer: null,
    category: "coworking_office", expense_category: CAT_COWORKING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000305")],
    reason: null, notes: null, invoice_period: null,
  },
  "exp_srv_idem_306": {
    id: "exp_srv_idem_306", employment_id: "emp_active_001", status: "pending",
    title: "Co-working day pass, second desk",
    amount: 2500, currency: USD,
    converted_amount: 2500, converted_currency: USD,
    tax_amount: 200, converted_tax_amount: 200,
    expense_date: "2026-07-20", reviewed_at: null, reviewer: null,
    category: "coworking_office", expense_category: CAT_COWORKING,
    receipts: [receipt("f1a0c8d2-1111-4a01-9c11-a10000000306")],
    reason: null, notes: null, invoice_period: null,
  },
};

// ---------------------------------------------------------------------------
// FRESH COPIES OF A FIXTURE CLAIM — `exp_sandbox_clean_401~fresh-<token>`
// ---------------------------------------------------------------------------
// WHAT PROBLEM THIS SOLVES. UC-02 asks "have I already decided this expense?"
// before its gates run, and replays the stored decision when it has. That is
// correct — an expense is decided once, and a second decision would mean a
// second approval write. But the fixtures above are a FIXED set, so from a
// testing surface every scenario is a one-shot: the first submission of
// `exp_sandbox_clean_401` is decided, and every submission after it, forever,
// replays. A tester who generated a new request reference and expected a new
// decision got the replay instead, and reasonably read the reference control
// as broken. It was not — the reference identifies the delivery, and the
// expense is the subject.
//
// So the mock can mint a genuinely NEW claim from an existing one: same
// employee, same money, same category, same receipt evidence, new identity.
// This is a property of the MOCK, not of the use case — nothing in src/uc02/
// knows this id form exists, and the real API has no such thing. It is the
// fixture equivalent of the employee filing another dinner.
//
// THE TITLE CARRIES THE TOKEN, AND THAT IS THE POINT, NOT AN ORNAMENT.
// deriveReceiptFingerprint() (src/uc02/workflow.js) hashes employee, amount,
// currency, tax, date and TITLE. A clone identical in all six would hash to the
// base claim's fingerprint and be refused at gate 6 as a duplicate receipt —
// which is the fingerprint working exactly as intended, and would make a fresh
// copy useless. Varying the title is the one field in that material that no
// gate reads, so the copy differs where "a different real-world claim" differs
// and nowhere a decision could turn on.
//
// Minted lazily on read and remembered, so the PATCH that follows an approval
// in the same request finds the same object the GET returned.
const MINTED_EXPENSES = new Map();
const FRESH_MARKER = "~fresh-";

function resolveExpense(id) {
  if (typeof id !== "string") return null;
  if (EXPENSES[id]) return EXPENSES[id];
  if (MINTED_EXPENSES.has(id)) return MINTED_EXPENSES.get(id);

  const at = id.indexOf(FRESH_MARKER);
  if (at === -1) return null;
  const base = EXPENSES[id.slice(0, at)];
  const token = id.slice(at + FRESH_MARKER.length);
  // A marker with no base claim, or no token after it, is not a fresh copy of
  // anything — it must 404 like any other unknown id rather than mint an empty
  // record that would then be judged.
  if (!base || !token) return null;

  const copy = {
    ...base,
    id,
    title: `${base.title} (fresh copy ${token})`,
    // A copy of a DECIDED claim is still a new claim awaiting a decision;
    // inheriting `approved` would make every fresh copy fail the claim-state
    // gate and reproduce the one-shot problem this exists to remove.
    status: "pending",
    reviewed_at: null,
    reviewer: null,
    reason: null,
  };
  MINTED_EXPENSES.set(id, copy);
  return copy;
}

// ---------------------------------------------------------------------------
// UC-04 work authorizations — the two helpers the routes need
// ---------------------------------------------------------------------------
// WHAT USED TO BE HERE, AND WHY IT IS GONE. This block held
// `mintWorkAuthorizationId()` / `decodeWorkAuthorizationId()` /
// `resolveWorkAuthorization()`: an id that carried its own record, base64url
// encoded, so a serverless cold start between a CREATE and the specialist's
// PATCH could rebuild what the create had written. Careful machinery, and every
// line of it existed only because this mock implemented a create Remote does not
// have. With that create gone (see the fixture block above), the only ids a
// caller can address are the ones checked into this file, and a fresh module
// load already has them. Deleting the machinery is therefore not a loss of
// capability — it is the capability's whole justification disappearing.
//
// A cold start still loses a PATCH applied in an earlier invocation. That is a
// mock's ordinary limitation, and it is NOT a double-execution hole: the guard
// on a second approval is the durable `uc04_authorizations` row, which
// approvalPolicy.js refuses to act on unless its status is
// `pending_specialist_approval`. Nothing re-judges this map.

/** The request with this id, or null. No reconstruction, no invention. */
function resolveWorkAuthorization(id) {
  if (typeof id !== "string" || !id) return null;
  return WORK_AUTHORIZATIONS[id] ?? null;
}

/**
 * The 404 the real API returns for a routed path with no such record: an
 * OBJECT `{"message":"Not Found"}`.
 *
 * That shape is load-bearing and was confirmed live against the Sandbox
 * (REMOTE-VOCABULARY §13.0(a)): this API answers "route exists, record missing"
 * with the object form and "no route for this method+path" with a BARE JSON
 * STRING `"Not Found"`. A mock that blurs the two teaches a distinction away
 * that is the only read-only way to tell an endpoint that exists from one that
 * does not — which is precisely the question this whole change is about.
 */
function workAuthorizationNotFound(res) {
  return send(res, 404, { message: "Not Found" });
}

/**
 * Validate a PATCH body against `UpdateWorkAuthorizationRequestParams`.
 *
 * Enforced here rather than in `RemoteClient` on purpose: the client is a thin
 * deliverer (so is `patchExpenseStatus`), and a mock that accepts whatever the
 * caller sends can only ever agree with the caller. This is the mock's one job
 * that a fixture cannot do.
 *
 * @returns {{ok: true, branch: object} | {ok: false, errors: object}}
 */
function validateWorkAuthorizationUpdate(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, errors: { base: ["must be an object"] } };
  }
  const branch = WORK_AUTHORIZATION_UPDATE_BRANCHES[patch.status];
  if (!branch) {
    // Every other member of `WorkAuthorizationRequest.status` is reachable only
    // by the employee (`cancelled`) or by Remote itself (`declined_by_remote`,
    // `approved_by_remote`) — and `pending` is where the record starts. A
    // caller may set exactly two of the six.
    return {
      ok: false,
      errors: {
        status: [
          `is invalid — a caller may only set "approved_by_manager" or "declined_by_manager"`,
        ],
      },
    };
  }
  const allowed = new Set([...branch.required, ...branch.optional]);
  const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
  if (unknown.length) {
    // `additionalProperties: false`, on both branches.
    return { ok: false, errors: Object.fromEntries(unknown.map((k) => [k, ["is not allowed"]])) };
  }
  const missing = branch.required.filter(
    (key) => patch[key] === undefined || patch[key] === null || patch[key] === ""
  );
  if (missing.length) {
    return { ok: false, errors: Object.fromEntries(missing.map((k) => [k, ["can't be blank"]])) };
  }
  return { ok: true, branch };
}

// Route the request to the right piece of mock data.
export function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["v1","employments","emp_active_001"]

  res.setHeader("Content-Type", "application/json");

  // GET /v1/employments — the collection. [CONFIRMED live 2026-08-19]
  //
  // The LIST ROW IS NOT THE SHOW ROW, and that is the whole reason this route
  // exists here. Live, the show payload carries 49 top-level keys and the list
  // row carries 19 — no `basic_information`, no `contract_details`, no
  // `probation_period_end_date`, no `company_id`. A mock that answered the list
  // with its show payload would let a caller read a field off a list row that
  // production will never put there, and the suite would agree with it.
  //
  // The envelope is `{data:{total_count,current_page,total_pages,employments}}`
  // — the same paginated collection shape every other Remote list uses, and one
  // this mock previously had no example of at all.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "employments" && parts.length === 2) {
    let rows = Object.values(EMPLOYMENTS).map(toEmploymentListRow);
    // `?short_id=` — how a caller resolves the six-character code Remote gives
    // the EMPLOYEE into the uuid every other route wants. Filtered rather than
    // routed, because that is what the real collection does: an unknown code is
    // an EMPTY LIST, never a 404, and `findEmploymentByShortId()` depends on
    // that distinction (it refuses on `rows.length !== 1`, so zero and two both
    // decline to guess). Case-insensitive: the code is printed uppercase and
    // typed however the enquirer typed it.
    const shortId = url.searchParams.get("short_id");
    if (shortId) {
      const wanted = shortId.trim().toUpperCase();
      rows = rows.filter((row) => (row.short_id ?? "").toUpperCase() === wanted);
    }
    return send(res, 200, {
      data: { total_count: rows.length, current_page: 1, total_pages: 1, employments: rows },
    });
  }

  // GET /v1/employments/:id/custom-fields — HYPHEN. [CONFIRMED live 2026-08-19]
  //
  // Placed ABOVE the show route on purpose: the show route used to match on
  // `parts[2]` alone and ignore everything after it, so EVERY sub-resource path
  // under an employment answered 200 with the whole employment record. That is
  // the worst possible mock behaviour — a caller asking a question the API has
  // no route for got a plausible answer instead of the 404 that would have told
  // it so. `/v1/employments/{id}/custom_fields` (UNDERSCORE, the spelling
  // docs/use-cases/UC-04.md §3 records as [CONFIRMED]) is one such path, and it
  // 404s live. The show route below now requires `parts.length === 3`.
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "employments" &&
    parts[2] &&
    parts[3] === "custom-fields" &&
    parts.length === 4
  ) {
    const emp = EMPLOYMENTS[parts[2]];
    if (!emp) return send(res, 404, { message: "Employment not found" });
    const values = employmentCustomFieldValues(emp);
    return send(res, 200, {
      data: {
        total_count: values.length,
        current_page: 1,
        total_pages: 1,
        custom_field_values: values,
      },
    });
  }

  // GET /v1/custom-fields — the company's custom-field DEFINITIONS.
  // [CONFIRMED live 2026-08-19] Note the envelope: this one is NOT wrapped in
  // `data` at all, unlike its own per-employment sibling above. Captured, not
  // tidied — a mock that normalised the inconsistency away would hide it.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "custom-fields" && parts.length === 2) {
    return send(res, 200, {
      total_count: CUSTOM_FIELD_DEFINITIONS.length,
      custom_fields: CUSTOM_FIELD_DEFINITIONS,
      current_page: 1,
      total_pages: 1,
    });
  }

  // GET /v1/employments/:id
  //
  // ENVELOPE [CONFIRMED live 2026-08-19]: the record nests under
  // `data.employment`, not directly under `data`. This route served `{data:
  // emp}` for the project's whole life, which is a level of nesting the real
  // API does not use anywhere on this resource — and the cost was not the
  // envelope itself (RemoteClient#getEmployment unwraps `result?.employment ??
  // result`, and both n8n ports read either shape) but what the flat answer
  // let the suite skip. `normalizeEmployment()` returns its argument untouched
  // when it sees a string `contract_type` + `start_date`, so the mock's flat
  // records took the passthrough branch and NOT ONE TEST drove the nested
  // normalization path production always takes. Every fix that path has needed
  // — `probation_end_date`, `custom_fields`, the alpha-2 `country_code`,
  // carrying `basic_information`/`contract_details` through — was invisible to
  // the mock by construction.
  //
  // The record itself is still whatever the fixture holds (flat or live-shaped;
  // see the two families above). Only the envelope is corrected here, because
  // reshaping the flat fixtures is a cross-use-case change and this is not the
  // place to make it in passing.
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "employments" &&
    parts[2] &&
    parts.length === 3
  ) {
    const emp = EMPLOYMENTS[parts[2]];
    if (!emp) return send(res, 404, { message: "Employment not found" });
    return send(res, 200, { data: { employment: emp } });
  }

  // GET /v1/offboardings/employments/:id — rca-bdz. [CONFIRMED — live,
  // 2026-08-21]: `HTTP 200 {"total_count":0,…,"offboardings":[]}` for a real,
  // currently-active Sandbox employment. Reproduced here the same way: a
  // genuinely empty list by default, from `OFFBOARDINGS` above.
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "offboardings" &&
    parts[2] === "employments" &&
    parts[3] &&
    parts.length === 4
  ) {
    const list = OFFBOARDINGS[parts[3]] ?? [];
    return send(res, 200, {
      data: { total_count: list.length, current_page: 1, total_pages: list.length ? 1 : 0, offboardings: list },
    });
  }

  // GET /v1/companies/:companyId/legal-entities — THE REAL ONE.
  // [CONFIRMED live 2026-08-19] 200, envelope
  // `{data:{total_count,current_page,total_pages,legal_entities:[…]}}`, rows
  // `{id,name,country_code,is_default,global_payroll_enabled}` — note
  // `country_code` here is the ALPHA-3 form ("USA"), and note there is NO
  // address field on this endpoint at all.
  //
  // RemoteClient#getLegalEntity() prefers this path whenever the employment
  // carries a `company_id` — which every real record does — and only falls back
  // to the singular lookup below when it does not. Until now the mock had no
  // such route, so the real branch 404'd here and only the fallback was ever
  // exercised: the letter path production takes was untested, and the path it
  // never takes was the only one with coverage.
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "companies" &&
    parts[2] &&
    parts[3] === "legal-entities" &&
    parts.length === 4
  ) {
    const rows = Object.values(LEGAL_ENTITIES).map((le, index) => ({
      id: le.id,
      name: le.name,
      country_code: le.country_code ?? null,
      is_default: index === 0,
      global_payroll_enabled: false,
      // NOT a live field — see the note on the singular route below. Carried so
      // the letter renderer keeps working through the real branch; named here
      // rather than left to look like API data.
      address: le.address ?? null,
    }));
    return send(res, 200, {
      data: { total_count: rows.length, current_page: 1, total_pages: 1, legal_entities: rows },
    });
  }

  // GET /v1/legal-entities/:id — NOT A REAL REMOTE ENDPOINT.
  // [CONFIRMED live 2026-08-19] `GET /v1/legal-entities` answers a bare 404
  // "Not Found"; there is no singular get-by-id sibling either. Kept because
  // RemoteClient#getLegalEntity() falls back to it for records with no
  // `company_id` (only mock fixtures), and because deleting it would change a
  // use case from this file. It is the one route here that is knowingly not the
  // API, and it says so rather than reading as verified.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "legal-entities" && parts[2]) {
    const le = LEGAL_ENTITIES[parts[2]];
    if (!le) return send(res, 404, { error: "not_found" });
    return send(res, 200, { data: le });
  }

  // GET /v1/travel-letter-requests — UC-03's own collection.
  // [CONFIRMED live 2026-08-19] 200 with `total_count: 0` — the Sandbox holds
  // no travel-letter requests at all. The mock had no route here, so it
  // answered `no_such_route`, and a 404 and an empty collection are opposite
  // answers: one says the endpoint is not there, the other says the endpoint is
  // there and nothing has been filed. Serving the real empty collection is what
  // lets a caller tell "we cannot read this" from "there is nothing to read".
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "travel-letter-requests" &&
    parts.length === 2
  ) {
    return send(res, 200, {
      data: { total_count: 0, current_page: 1, total_pages: 0, travel_letter_requests: [] },
    });
  }

  // GET /v1/contract-amendments — the collection UC-06 amends into.
  // [CONFIRMED live 2026-08-19] 200, 5 rows, envelope
  // `{data:{total_count,current_page,total_pages,contract_amendments}}`, row
  // `{id,status,job_title,submitted_at,employment_id,reason_for_change,
  //   requested_effective_date,requested_by}`.
  //
  // Worth reading that row twice: it carries NO salary, NO currency and NO
  // effective amount — only `job_title` of the amended values. So the listing
  // cannot tell you what an amendment proposes to pay anyone, and a status
  // check that hoped to compare a listed amount against a request has nothing
  // to compare. `status` values observed live: `in_review`, `submitted`.
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "contract-amendments" &&
    parts.length === 2
  ) {
    return send(res, 200, {
      data: {
        total_count: CONTRACT_AMENDMENT_LIST.length,
        current_page: 1,
        total_pages: 1,
        contract_amendments: CONTRACT_AMENDMENT_LIST,
      },
    });
  }

  // GET /v1/countries — the supported-countries list (UC-03 §3).
  // REAL ENVELOPE, verified live 2026-08-17: the array sits DIRECTLY under
  // `data`. This route used to answer `{data: {countries: […]}}`, an envelope
  // that exists nowhere but this file — see the note on COUNTRIES above for the
  // use case it silently killed.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "countries" && parts.length === 2) {
    return send(res, 200, { data: COUNTRIES });
  }

  // GET /v1/countries/:code/holidays/:year — public holidays.
  //
  // FOUR BEHAVIOURS, ALL COPIED FROM THE LIVE API RATHER THAN CHOSEN
  // [all CONFIRMED 2026-08-19, same token, same container]:
  //   /CAN/holidays/2026                       -> 200, 5 national rows
  //   /CAN/holidays/2026?…=CA-ON               -> 200, 4 rows, DISJOINT from
  //                                               the national five
  //   /CA/holidays/2026   (alpha-2)            -> 404 {"message":"Country not found"}
  //   /CAN/holidays/notayear                   -> 400 {"message":"Year is invalid"}
  //   /CAN/holidays/2026?…=CA-ZZ               -> 400 {"message":"Country Subdivision is invalid"}
  //   /NLD/holidays/2027                       -> 200 {"data":[]} — a year not
  //                                               populated, NOT an error
  // The message strings are Remote's own, verbatim. A caller that switches on
  // them must see the same text here as in production, or the mock is teaching
  // its own dialect — which is how the shapes this file has already had to be
  // corrected for got in.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "countries" && parts[2] && parts[3] === "holidays" && parts.length === 5) {
    const code = String(parts[2]).toUpperCase();
    const year = String(parts[4]);
    const entry = HOLIDAYS[code];
    // Unknown country — which INCLUDES every alpha-2 form, on purpose.
    if (!entry) return send(res, 404, { message: "Country not found" });
    if (!/^\d{4}$/.test(year)) return send(res, 400, { message: "Year is invalid" });
    const subdivision = url.searchParams.get("country_subdivision_code");
    if (subdivision !== null) {
      if (!HOLIDAY_SUBDIVISIONS[code].has(subdivision)) {
        return send(res, 400, { message: "Country Subdivision is invalid" });
      }
      // Only 2026 is captured; any other year is an unpopulated calendar, which
      // the live API answers with an empty list rather than a 404.
      return send(res, 200, { data: year === "2026" ? entry.subdivisions[subdivision] : [] });
    }
    return send(res, 200, { data: year === "2026" ? entry.national : [] });
  }

  // GET /v1/countries/:code/employment_basic_information
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "countries" && parts[2] && parts[3] === "employment_basic_information") {
    const schema = COUNTRY_SCHEMAS[parts[2]];
    if (!schema) return send(res, 404, { error: "not_found" });
    return send(res, 200, { data: schema });
  }

  // GET /v1/contract-amendments/schema — THE form UC-06 validates against.
  //
  // Live 2026-08-18 [CONFIRMED]: query is `employment_id` (required),
  // `country_code` (required, ISO alpha-3), optional `form` (enum
  // `contract_amendment`) and `json_schema_version`. The COUNTRY CODE selects
  // the form — the employment's own country does not — which is how five
  // countries' forms were captured from one employment id.
  //
  // The two failure modes are faithful, not conveniences:
  //   unknown employment id -> 404 {"message":"Employment not found"}
  //   NGA / USA             -> 500, exactly as the live Sandbox answers
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "contract-amendments" &&
    parts[2] === "schema" &&
    parts.length === 3
  ) {
    const employmentId = url.searchParams.get("employment_id");
    const countryCode = url.searchParams.get("country_code");
    if (!employmentId) return send(res, 422, { errors: { employment_id: ["can't be blank"] } });
    if (!countryCode) return send(res, 422, { errors: { country_code: ["can't be blank"] } });
    if (!EMPLOYMENTS[employmentId]) return send(res, 404, { message: "Employment not found" });
    if (CONTRACT_AMENDMENT_SCHEMA_ERRORS[countryCode]) {
      return send(res, CONTRACT_AMENDMENT_SCHEMA_ERRORS[countryCode], "Internal Server Error");
    }
    const schema = CONTRACT_AMENDMENT_SCHEMAS[countryCode];
    if (!schema) return send(res, 404, { message: "Not Found" });
    return send(res, 200, { data: materializeForEmployment(schema, EMPLOYMENTS[employmentId]) });
  }

  // POST /v1/contract-amendments[/automatable] — UC-06's write, and its
  // read-only preflight.
  //
  // BODY IS [CONFIRMED] against Remote's OpenAPI `CreateContractAmendmentParams`:
  // `{employment_id, amendment_contract_id, contract_amendment}`, all three
  // required, `additionalProperties: false`. `/automatable` takes the identical
  // body and CREATES NOTHING — it answers whether the amendment would apply
  // instantly. Live it returned
  // `{"data":{"automatable":false,"message":"By pressing 'Submit amendment
  // request' you will begin the contract adjustement process for this
  // employee. This does not automatically result in a contract change."}}`.
  //
  // THE VALIDATION BELOW IS THE POINT OF THIS ROUTE. Each refusal reproduces a
  // real live response, verbatim, because a mock that accepts anything is how
  // the last four field-shape bugs survived:
  //   unknown amendment_contract_id -> 404 {"message":"amended_contract_not_found"}
  //   undeclared key                -> 422 {"errors":{"<key>":["is not accepted"]}}
  //   missing required field        -> 422 {"errors":{"<f>":["can't be blank"]}}
  //   wrong type                    -> 422 "Type mismatch. Expected Number but got String."
  // The type check matters most: live, `work_hours_per_week: "24"` (which is
  // literally the value Remote stores on some records) is REFUSED, and
  // `annual_gross_salary` must be an Integer — a float and a quoted number are
  // both rejected. That is the money ×100 invariant enforced by the API itself.
  if (
    req.method === "POST" &&
    parts[0] === "v1" &&
    parts[1] === "contract-amendments" &&
    (parts.length === 2 || (parts.length === 3 && parts[2] === "automatable"))
  ) {
    const preflightOnly = parts.length === 3;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return send(res, 422, { message: "Unprocessable Entity" });
      }
      const emp = EMPLOYMENTS[payload.employment_id];
      if (!emp) return send(res, 404, { message: "Employment not found" });
      if (!payload.amendment_contract_id || payload.amendment_contract_id !== emp.active_contract_id) {
        return send(res, 404, { message: "amended_contract_not_found" });
      }
      const alpha3 = emp.country?.code ?? ALPHA2_TO_ALPHA3[emp.country_code] ?? null;
      const schema = alpha3 ? CONTRACT_AMENDMENT_SCHEMAS[alpha3] : null;
      if (!schema) return send(res, 500, "Internal Server Error");

      const amendment = payload.contract_amendment ?? {};
      const errors = {};
      for (const key of Object.keys(amendment)) {
        if (schema.additionalProperties === false && !(key in schema.properties)) {
          errors[key] = ["is not accepted"];
        }
      }
      for (const field of schema.required) {
        const value = amendment[field];
        if (value === undefined || value === null || value === "") errors[field] = ["can't be blank"];
      }
      for (const [field, value] of Object.entries(amendment)) {
        const spec = schema.properties[field];
        if (!spec || value === undefined || value === null) continue;
        const types = Array.isArray(spec.type) ? spec.type : [spec.type];
        if (types.includes("integer") && !types.includes("number")) {
          if (typeof value !== "number") {
            errors[field] = [`Type mismatch. Expected Integer but got ${typeof value === "string" ? "String" : "Number"}.`];
          } else if (!Number.isInteger(value)) {
            errors[field] = ["Type mismatch. Expected Integer but got Number."];
          }
        } else if (types.includes("number") && typeof value !== "number") {
          errors[field] = ["Type mismatch. Expected Number but got String."];
        }
      }
      if (Object.keys(errors).length) return send(res, 422, { message: "Unprocessable Entity", errors });

      if (preflightOnly) {
        return send(res, 200, {
          data: {
            automatable: false,
            message:
              "By pressing 'Submit amendment request' you will begin the contract adjustement process for this employee. This does not automatically result in a contract change.",
          },
        });
      }
      // RESPONSE IS A LIVE CAPTURE [CONFIRMED 2026-08-18]. A real amendment was
      // created against active NL employment 75b88008-… and then cancelled via
      // the Sandbox-only `PUT /v1/sandbox/contract-amendments/{id}/cancel`
      // (200 `{"data":{"status":"ok"}}`). It answered **201**, not 200 — the
      // published OpenAPI documents 200, the API sends 201 — with:
      //   {data:{contract_amendment:{id, status:"submitted",
      //     changes:{"compensation.amount":{current:7500000, previous:7200000}},
      //     submitted_at, employment_id, amendment_contract_id,
      //     request_details:{effective_date, reason_for_change,
      //       additional_comments, reason_for_change_description,
      //       salary_decrease_details},
      //     zendesk_ticket_url, requested_by}}}
      //
      // `changes` is keyed by DOTTED DOMAIN PATH ("compensation.amount"), not
      // by form field name, and carries previous/current pairs — so it is
      // Remote's own diff, not an echo of the submitted form. Only the salary
      // path is reproduced here, because that is the only pair the live
      // response actually contained; a job-title or hours amendment's key is
      // NOT known and is therefore not guessed. `requested_by` is the calling
      // token's user id and has no mock equivalent, so it is null.
      const previousSalary = emp.contract_details?.annual_gross_salary ?? null;
      const changes = {};
      if (typeof amendment.annual_gross_salary === "number" && amendment.annual_gross_salary !== previousSalary) {
        changes["compensation.amount"] = { current: amendment.annual_gross_salary, previous: previousSalary };
      }
      return send(res, 201, {
        data: {
          contract_amendment: {
            id: `amd_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            status: "submitted",
            changes,
            submitted_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
            employment_id: payload.employment_id,
            amendment_contract_id: payload.amendment_contract_id,
            request_details: {
              effective_date: amendment.effective_date ?? null,
              reason_for_change: amendment.reason_for_change ?? null,
              additional_comments: amendment.additional_comments ?? null,
              reason_for_change_description: amendment.reason_for_change_description ?? null,
              salary_decrease_details: null,
            },
            zendesk_ticket_url: null,
            requested_by: null,
          },
        },
      });
    });
    return;
  }

  // GET /v1/leave-policies/summary/:employmentId — the Time Off read UC-05
  // needs. `GET /v1/timeoff-balances/:id` is Remote's DEPRECATED name for the
  // same numbers (deprecated Feb 2025 in favour of this path) and is not
  // implemented here: serving a deprecated alias would let a caller build on it
  // without ever finding out.
  //
  // A 404 for an unknown employment, an empty array for an employment with no
  // policies. Those are different answers and the client turns them into
  // different facts — see RemoteClient.listLeavePolicySummary().
  if (
    req.method === "GET" &&
    parts[0] === "v1" &&
    parts[1] === "leave-policies" &&
    parts[2] === "summary" &&
    parts[3] &&
    parts.length === 4
  ) {
    if (!EMPLOYMENTS[parts[3]]) return send(res, 404, { error: "not_found" });
    // AN EMPLOYMENT WITH NO FIXTURE ANSWERS WITH AN EMPTY LIST, AND THAT IS A
    // KNOWN GAP RATHER THAN A CLAIM. Live, every employment probed on the
    // Sandbox carried at least one leave policy, so `[]` is the empty case of a
    // list endpoint and not a payload Remote has been observed to send. It is
    // used here only for the employments this fixture does not yet mirror —
    // including the mirrored demo personas, whose REAL balances were captured
    // (Anna Müller's live `balance` is **-9 days**: entitlement 10, used 19, an
    // employee who has over-taken leave). Mirroring those would change two
    // documented portal demo scenarios from a sign-off to an escalation, which
    // is a call for whoever owns that scenario matrix, not a change to make in
    // passing. Recorded here so the gap is read as a gap.
    const summary = LEAVE_POLICY_SUMMARIES[parts[3]] ?? [];
    // The array sits DIRECTLY under `data` — no `leave_policies` key, no
    // `summary` key. Verified live 2026-08-19.
    return send(res, 200, { data: summary });
  }

  // GET /v1/payroll-runs — the company payroll calendar.
  //
  // This route used to be `/v1/company-payroll-runs?company_id=…`, a path that
  // exists nowhere but this file and the client that called it. It answered a
  // per-company list, so the mock and the client agreed with each other and
  // both disagreed with Remote — and because the real path 404s, UC-06's
  // payroll gate escalated on every live run while every test stayed green.
  //
  // Everything below is [CONFIRMED] against gateway.remote-sandbox.com on
  // 2026-08-18, INCLUDING the two behaviours that look like mock bugs:
  //
  //   1. `total_pages` LIES. Live it reports 1 while `?page=2` still returns
  //      14 rows, and `total_count` reports 17 against a 34-row full walk. It
  //      is echoed here just as wrongly, on purpose: a client that terminates
  //      pagination on `total_pages` must FAIL A TEST here rather than read a
  //      truncated calendar in production, where a missing cycle silently
  //      becomes "no cycle governs this date".
  //   2. ROWS REPEAT ACROSS PAGES. Live, a full walk returns 34 rows for 17
  //      distinct ids. The last fixture row is repeated on the first page here
  //      so a client that does not dedupe by id is likewise caught.
  //
  // Filters are refused exactly as the live API refuses them — `company_id`,
  // `country_code`, `country` and `status` all answer 422 "Unexpected field".
  // That refusal is load-bearing: it is what proves the country filter has to
  // live in the client, and it stops anyone "fixing" the multi-country calendar
  // by adding a query parameter Remote does not have.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "payroll-runs" && parts.length === 2) {
    for (const field of ["company_id", "country_code", "country", "status"]) {
      if (url.searchParams.has(field)) {
        return send(res, 422, { errors: { [field]: ["Unexpected field"] } });
      }
    }
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const pageSize = Number.parseInt(url.searchParams.get("page_size") ?? "20", 10) || 20;
    // The duplicate the live API also serves: one row repeated, so the deduping
    // requirement is exercised by the same data every other test runs on.
    const rows = [...PAYROLL_RUNS, PAYROLL_RUNS[0]];
    const start = (page - 1) * pageSize;
    return send(res, 200, {
      data: {
        total_count: PAYROLL_RUNS.length,
        current_page: page,
        total_pages: 1, // deliberately wrong, exactly as live — see note above
        payroll_runs: rows.slice(start, start + pageSize),
      },
    });
  }

  // PUT /v1/employments/:id/basic-information — the REAL endpoint, reproduced
  // so nothing in this repo can quietly rediscover what it is.
  //
  // Live 2026-08-18 [CONFIRMED]: the body is ENVELOPED. `{}` answers
  // `422 {"errors":{"basic_information":["Missing field"]}}`, and
  // `{basic_information: {}}` answers a 422 naming that country's required
  // fields. Remote's own reference states the supported employment statuses
  // are `created`, `job_title_review`, `created_reserve_paid` and
  // `created_awaiting_reserve` — NOT `active`.
  //
  // The status refusal below is [INFERRED] IN ITS EXACT WIRE FORM: the live
  // Sandbox validates the form BEFORE it checks status, so a live capture of
  // the refusal would require sending a complete, valid payload to a live
  // active employment — i.e. performing the write. The RESTRICTION is
  // [CONFIRMED] from Remote's reference; only the status code and message
  // shape here are chosen (409, `unsupported_employment_status`) rather than
  // copied. Refusing is the faithful part; the wording is not evidence.
  if (req.method === "PUT" && parts[0] === "v1" && parts[1] === "employments" && parts[2] && parts[3] === "basic-information") {
    const emp = EMPLOYMENTS[parts[2]];
    if (!emp) return send(res, 404, { message: "Employment not found" });
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return send(res, 422, { message: "Unprocessable Entity" });
      }
      if (!payload || typeof payload.basic_information !== "object" || payload.basic_information === null) {
        return send(res, 422, { errors: { basic_information: ["Missing field"] } });
      }
      if (!BASIC_INFORMATION_WRITABLE_STATUSES.has(emp.status)) {
        return send(res, 409, {
          message: "unsupported_employment_status",
          errors: { status: [`Supported employment statuses: ${[...BASIC_INFORMATION_WRITABLE_STATUSES].join(", ")}`] },
        });
      }
      emp.basic_information = { ...(emp.basic_information ?? {}), ...payload.basic_information };
      return send(res, 200, { data: emp });
    });
    return;
  }

  // PATCH /v1/employments/:id/basic-information
  //
  // [MOCK-ONLY — THIS VERB DOES NOT EXIST ON REMOTE.] Live it answers
  // `404 "Not Found"` on every employment and every status [CONFIRMED
  // 2026-08-18]. It is kept because several use cases' tests use it as a
  // fixture-mutation hook (flipping a status to `terminated` and back), which
  // is a test concern with no production counterpart. It is NOT a model of any
  // Remote behaviour, and nothing in `src/` calls it — UC-06 writes through
  // `POST /v1/contract-amendments`. Do not build anything on this route.
  if (req.method === "PATCH" && parts[0] === "v1" && parts[1] === "employments" && parts[2] && parts[3] === "basic-information") {
    const emp = EMPLOYMENTS[parts[2]];
    if (!emp) return send(res, 404, { error: "not_found" });
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const patch = JSON.parse(body || "{}");
      Object.assign(emp, patch);
      send(res, 200, { data: emp });
    });
    return;
  }
  
  // ---------------------------------------------------------------------
  // /v1/recurring-incentives — 404, EXACTLY as the live Sandbox answers it.
  //
  // This route exists to REFUSE. The path is invented; it has never been part
  // of Remote's API. `[CONFIRMED-LIVE 2026-08-19]` `GET /v1/recurring-incentives`
  // → 404 with the body `"Not Found"` (a bare JSON string, not an object).
  // This mock used to SERVE that path and accept almost anything posted to it,
  // which is the entire reason UC-09's money write survived: the fixture had
  // been written to agree with the code instead of with the API, so every
  // test, every walkthrough and every demo confirmed a URL that could only
  // ever 404 in production. Kept as an explicit route rather than left to the
  // catch-all so that the refusal is deliberate and testable — and so nobody
  // "restores" it thinking a 404 here is a gap in the mock.
  // ---------------------------------------------------------------------
  if (parts[0] === "v1" && parts[1] === "recurring-incentives") {
    return send(res, 404, "Not Found");
  }

  // ---------------------------------------------------------------------
  // POST /v1/incentives — Remote's real one-time incentive resource, and the
  // one write UC-09 makes. Modelled on `CreateOneTimeIncentiveParams`
  // [CONFIRMED 2026-08-19 against the OpenAPI on Remote's own
  // post_v1_incentives page], not on what our own payload builder happens to
  // send. It REFUSES what Remote refuses, because a mock that accepts a
  // payload the real API rejects is not a test double — it is a second, more
  // forgiving API that only this repository has.
  //
  // NOT the recurring resource. `POST /v1/incentives/recurring` is documented
  // as "a monthly paid incentive"; an off-cycle adjustment is a single event,
  // so posting one there would turn one approved adjustment into a standing
  // monthly payment.
  // ---------------------------------------------------------------------
  if (req.method === "POST" && parts[0] === "v1" && parts[1] === "incentives" && !parts[2]) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let incentive;
      try {
        incentive = JSON.parse(body);
      } catch {
        return send(res, 400, { message: "invalid_json" });
      }
      if (typeof incentive !== "object" || incentive === null || Array.isArray(incentive)) {
        return send(res, 422, { message: "body must be a JSON object" });
      }

      // Unknown fields are refused. STRICTER THAN THE PUBLISHED SCHEMA, and
      // deliberately so: `CreateOneTimeIncentiveParams` declares no
      // `additionalProperties: false`, so it is [INFERRED], not [CONFIRMED],
      // that the live API rejects an extra key rather than ignoring it. But
      // the four dead fields this repo shipped for months — `currency`,
      // `description`, `processing_date`, `tax_calculation_method` — were
      // invisible precisely because something accepted them silently. A mock
      // that ignores an unknown key teaches that sending one is free, and on
      // this endpoint the unknown key was carrying the tax reading that
      // decides how much money leaves the account. Fail loud here; the cost of
      // being stricter than Remote is a red test, and the cost of being
      // laxer was this defect.
      const ALLOWED = new Set([
        "type",
        "amount",
        "amount_tax_type",
        "employment_id",
        "effective_date",
        "note",
        "period_start",
        "period_end",
      ]);
      const unknown = Object.keys(incentive).filter((k) => !ALLOWED.has(k));
      if (unknown.length) {
        return send(res, 422, {
          message: `unknown incentive fields: ${unknown.sort().join(", ")}`,
        });
      }

      // Remote's own `required` array, in Remote's own order.
      const REQUIRED = ["type", "amount", "amount_tax_type", "employment_id", "effective_date"];
      const missing = REQUIRED.filter(
        (f) => incentive[f] === undefined || incentive[f] === null || incentive[f] === ""
      );
      if (missing.length) {
        return send(res, 422, { message: `missing required fields: ${missing.join(", ")}` });
      }

      // `AmountTaxType` — the enum that decides whether the integer below is
      // paid before or after tax. "automatic" is not a member of it.
      if (!["gross", "net"].includes(incentive.amount_tax_type)) {
        return send(res, 422, {
          message: `amount_tax_type must be one of gross, net (got ${JSON.stringify(incentive.amount_tax_type)})`,
        });
      }

      if (!INCENTIVE_TYPE_ENUM.has(incentive.type)) {
        return send(res, 422, {
          message: `type is not a supported incentive type (got ${JSON.stringify(incentive.type)})`,
        });
      }

      // "the Remote API only accepts currencies and their fractional amounts
      // as integers" — a float or a numeric string is a money bug, not a
      // formatting preference.
      if (!Number.isInteger(incentive.amount) || incentive.amount <= 0) {
        return send(res, 422, { message: "amount must be a positive integer in minor units" });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(incentive.effective_date))) {
        return send(res, 422, { message: "effective_date must be a YYYY-MM-DD date" });
      }

      if (!EMPLOYMENTS[incentive.employment_id]) {
        return send(res, 404, "Not Found");
      }

      // Remote answers 201 with `{data: {incentive: {...}}}` and echoes the
      // full `Incentive` shape — the 12 properties, no more. `status` is
      // `pending`: creating an incentive is not paying it. "When the incentive
      // is created and it is not yet associated to a payroll cycle, its status
      // is `pending`", which is why UC-09's own `executed` means "we filed it",
      // never "the money moved".
      const created = {
        id: `inc_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        status: "pending",
        type: incentive.type,
        amount: incentive.amount,
        amount_tax_type: incentive.amount_tax_type,
        employment_id: incentive.employment_id,
        effective_date: incentive.effective_date,
        note: incentive.note ?? null,
        period_start: incentive.period_start ?? null,
        period_end: incentive.period_end ?? null,
        expected_payout_date: null,
        recurring_incentive_id: null,
      };
      send(res, 201, { data: { incentive: created } });
    });
    return;
  }

  // UC-02 routes — the employee self-service expense namespace (verified:
  // docs/verification/uc02-expense-endpoints.md). GET reads, and the
  // approve/decline PATCH, which follows the "Working with Expenses" guide's
  // un-namespaced path (`https://gateway.remote-sandbox.com/v1/expenses`).

  // GET /v1/employee/expense-categories — 403, EXACTLY as the live API answers
  // it for this service's token. Kept as a route rather than deleted so the
  // mock records WHY that endpoint is not ours: it is the employee-authenticated
  // resource (`security: OAuth2Assertion`), and an unattended system actor
  // holding a company token can never satisfy it. A mock that 404'd here would
  // read as "not implemented yet"; a mock that served data would re-teach the
  // exact mistake that put this call in the workflow for months.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "employee" && parts[2] === "expense-categories") {
    return send(res, 403, { message: "Forbidden, invalid role for this endpoint" });
  }

  // GET /v1/expenses/categories — the company-side endpoint UC-02 really uses.
  // "At least one of employment_id, expense_id, or country_code must be
  // provided"; without one the live API answers 422, and so does this, because
  // a mock that is more forgiving than the API hides the caller bug it exists
  // to catch. Response envelope is the real `{data: [...]}` — a FLAT array, not
  // a `{categories: [...]}` wrapper.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "expenses" && parts[2] === "categories") {
    const employmentId = url.searchParams.get("employment_id");
    const countryCode = url.searchParams.get("country_code");
    const includeParents = url.searchParams.get("include_parents") === "true";
    if (!employmentId && !countryCode && !url.searchParams.get("expense_id")) {
      return send(res, 422, {
        message: "Unprocessable Entity",
        errors: { employment_id: ["can't be blank when neither expense_id nor country_code is provided"] },
      });
    }
    if (countryCode && !/^[A-Za-z]{3}$/.test(countryCode)) {
      // The live 422 for an alpha-2 code, verbatim. This is the mock's record
      // of the alpha-2/alpha-3 trap that already broke UC-03 once.
      return send(res, 422, { message: "Unprocessable Entity", errors: { country_code: ["is invalid"] } });
    }
    if (employmentId && !EMPLOYMENTS[employmentId]) {
      return send(res, 404, { message: "Employment not found" });
    }
    // Default response is selectable leaves only, matching the documented
    // behaviour ("parent nodes are excluded unless include_parents=true").
    const rows = includeParents
      ? EXPENSE_CATEGORIES
      : EXPENSE_CATEGORIES.filter((category) => category.is_selectable === true);
    return send(res, 200, { data: rows });
  }

  // The `/v1/employee/*` expense namespace is EMPLOYEE-SESSION-ONLY, and this
  // service holds a company token. Verified live 2026-08-17: the list 403s
  // ("Forbidden, invalid role for this endpoint") and the single-resource read
  // returns a bare `"Not Found"` 404 for an id that provably exists under
  // `/v1/expenses/:id`. That 404 is the nastier of the two — it is
  // indistinguishable from "this claim does not exist", which is exactly what
  // the gate recorded for months. Both are served here so the mock reproduces
  // the real refusals instead of quietly answering questions the API will not.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "employee" && parts[2] === "expenses" && parts.length === 3) {
    return send(res, 403, { message: "Forbidden, invalid role for this endpoint" });
  }
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "employee" && parts[2] === "expenses" && parts[3]) {
    return send(res, 404, "Not Found");
  }

  // GET /v1/expenses — the company-side list (the employee-namespace sibling
  // 403s). Unlike the categories endpoint, no discriminator is required.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "expenses" && parts.length === 2) {
    const employmentId = url.searchParams.get("employment_id");
    const rows = Object.values(EXPENSES).filter(
      (expense) => !employmentId || expense.employment_id === employmentId
    );
    // PAGINATED, like every other Remote collection. [CONFIRMED live
    // 2026-08-19: 220 expenses over 11 pages, `{data:{total_count,current_page,
    // total_pages,expenses}}`.] This route used to answer `{data:{expenses}}`
    // with no page metadata at all, which reads as "there is nothing more" — so
    // a caller written against the mock would take the first page for the whole
    // set and be wrong by 200 records on the real API, silently.
    return send(res, 200, {
      data: { total_count: rows.length, current_page: 1, total_pages: rows.length ? 1 : 0, expenses: rows },
    });
  }

  // GET /v1/expenses/:id — the company-side single-resource read UC-02 uses.
  // The real envelope nests under its own key (`{data:{expense:…}}`), the same
  // convention `GET /v1/employments/:id` uses; RemoteClient unwraps both.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "expenses" && parts[2] && parts[2] !== "categories") {
    const expense = resolveExpense(parts[2]);
    if (!expense) return send(res, 404, { message: "Not Found" });
    return send(res, 200, { data: { expense } });
  }

  // PATCH /v1/expenses/:id  — approve/decline a pending expense by setting its
  // status field (guide's un-namespaced path, see header on the fixtures).
  if (req.method === "PATCH" && parts[0] === "v1" && parts[1] === "expenses" && parts[2]) {
    const expense = resolveExpense(parts[2]);
    if (!expense) return send(res, 404, { error: "not_found" });
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const patch = JSON.parse(body || "{}");
      // The real endpoint's body is a `oneOf` over exactly two shapes —
      // ApproveExpenseParams `{status:"approved"}` and DeclineExpenseParams
      // `{status:"declined", reason}` (reason REQUIRED) — and it answers 422
      // for anything else. Verified live 2026-08-17 against a real pending
      // expense: `{"status":"bogus_not_a_real_status"}` returns
      // `422 {"message":{"code":"parameter_value_invalid", …}}` on BOTH PUT and
      // PATCH, while POST to the same path is a 404.
      //
      // Enforced here rather than merged blindly because a mock that accepts
      // any body cannot catch a caller sending the wrong one — the same
      // fixture-agrees-with-the-code failure that let the invented record shape
      // survive. `Object.assign(expense, patch)` in particular would happily
      // write an arbitrary attacker-chosen field onto the fixture.
      if (patch.status !== "approved" && patch.status !== "declined") {
        return send(res, 422, {
          message: {
            code: "parameter_value_invalid",
            message: `Value \`${patch.status}\` is invalid for parameter \`status\``,
            param: "status",
          },
        });
      }
      if (patch.status === "declined" && typeof patch.reason !== "string") {
        return send(res, 422, { message: { code: "parameter_required", message: "reason is required", param: "reason" } });
      }
      expense.status = patch.status;
      expense.reason = patch.status === "declined" ? patch.reason : null;
      // The real API stamps the review on approve/decline; `reviewer` is
      // populated from the acting credential, which a mock cannot know.
      expense.reviewed_at = new Date().toISOString().slice(0, 10);
      send(res, 200, { data: { expense } });
    });
    return;
  }

  // --- UC-04: work-authorization-requests ---------------------------------
  // Remote exposes GET (collection), GET (by id), PUT and PATCH on this
  // resource and NOTHING ELSE. The POST this file used to serve is answered
  // below exactly the way the live API answers an unrouted method — with a bare
  // JSON string, not an object — because that difference is the only read-only
  // signal that separates "this endpoint does not exist" from "this record does
  // not exist" (REMOTE-VOCABULARY §13.0(a)).

  // POST /v1/work-authorization-requests — NOT A ROUTE ON THE REAL API.
  //
  // Answered explicitly rather than left to the catch-all at the bottom of this
  // function, because the catch-all's `{error:"no_such_route"}` is a MOCK's
  // vocabulary. A caller that hits this must see what Remote would actually
  // send, or the mock is once again teaching a shape the API does not use.
  //
  // Anyone about to re-add a create here: read `docs/REMOTE-VOCABULARY.md` §13.1
  // first. A `WorkAuthorizationRequest` is "submitted by an employee" inside
  // Remote's Request Hub; the partner API's role is to DECIDE one, not raise it.
  if (req.method === "POST" && parts[0] === "v1" && parts[1] === "work-authorization-requests") {
    return send(res, 404, "Not Found");
  }

  // GET /v1/work-authorization-requests — the collection.
  // `employment_id` and `status` are documented query filters; anything else is
  // ignored, which is what the real API does with an unknown query param.
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "work-authorization-requests" && parts.length === 2) {
    const wantedEmployment = url.searchParams.get("employment_id");
    const wantedStatus = url.searchParams.get("status");
    if (wantedStatus && !MOCK_WORK_AUTHORIZATION_STATUSES.includes(wantedStatus)) {
      // Remote validates a closed-enum filter rather than silently dropping it.
      return send(res, 422, {
        message: {
          code: "parameter_value_invalid",
          message: `Value \`${wantedStatus}\` is invalid for parameter \`status\``,
          param: "status",
        },
      });
    }
    const rows = Object.values(WORK_AUTHORIZATIONS).filter((row) => {
      if (wantedStatus && row.status !== wantedStatus) return false;
      if (wantedEmployment && WORK_AUTHORIZATION_EMPLOYMENT_INDEX[row.id] !== wantedEmployment) return false;
      return true;
    });
    return send(res, 200, {
      data: {
        current_page: 1,
        total_pages: 1,
        total_count: rows.length,
        work_authorization_requests: rows,
      },
    });
  }

  // GET /v1/work-authorization-requests/:id
  if (req.method === "GET" && parts[0] === "v1" && parts[1] === "work-authorization-requests" && parts[2] && parts.length === 3) {
    const row = resolveWorkAuthorization(parts[2]);
    if (!row) return workAuthorizationNotFound(res);
    return send(res, 200, { data: { work_authorization_request: row } });
  }

  // PATCH /v1/work-authorization-requests/:id — the ONE write UC-04 makes.
  //
  // The body is checked against `UpdateWorkAuthorizationRequestParams`, not
  // merged blindly as this route used to do (`Object.assign(row, patch)`), which
  // is how `{status:"approved_by_remote", approved_by, approved_at,
  // decision_reason}` — three fields Remote refuses and a status only Remote may
  // set — passed every test in this repo for months.
  if (req.method === "PATCH" && parts[0] === "v1" && parts[1] === "work-authorization-requests" && parts[2] && parts.length === 3) {
    const row = resolveWorkAuthorization(parts[2]);
    if (!row) return workAuthorizationNotFound(res);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let patch;
      try {
        patch = JSON.parse(body || "{}");
      } catch (err) {
        return send(res, 400, { error: "invalid_json", reason: err.message });
      }
      const verdict = validateWorkAuthorizationUpdate(patch);
      if (!verdict.ok) {
        return send(res, 422, { message: "Unprocessable Entity", errors: verdict.errors });
      }
      // Only a `pending` request is awaiting a manager. Remote's own gloss for
      // every other member names an actor that is not us.
      if (row.status !== "pending") {
        return send(res, 422, {
          message: "Unprocessable Entity",
          errors: { status: [`cannot be changed — the request is already ${row.status}`] },
        });
      }
      row.status = patch.status;
      if ("employer_special_instructions" in patch) {
        row.employer_special_instructions = patch.employer_special_instructions;
      }
      // `reason` on the object is the EMPLOYEE's stated reason for travelling
      // (Remote: "The reason for the work authorization request"), and the
      // decline branch's `reason` is the MANAGER's. They are two different
      // things wearing one name, so the decline reason is NOT written over the
      // employee's — it comes back on `employer_special_instructions` when the
      // caller sent one, and is otherwise simply accepted and not echoed. Making
      // the mock overwrite `reason` would invent a round-trip the schema does
      // not promise.
      return send(res, 200, { data: { work_authorization_request: row } });
    });
    return;
  }

  send(res, 404, { error: "no_such_route", path: req.url });
}

function send(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

/**
 * Dispatch one request into `handle()` WITHOUT a socket, and answer with a real
 * `Response`.
 *
 * WHY THIS EXISTS. The request portal is honest about its Remote wiring: it
 * always talks to this mock, never a real account (src/portal/cli.js's header).
 * `npm run portal` gets that by starting this server on a loopback port. A
 * serverless function cannot listen on one, and the two alternatives were both
 * worse than a socketless dispatch:
 *
 *   - Point the deployed portal at the real Sandbox. Every persona in
 *     src/portal/personas.js is one of THIS file's fixtures (`emp_active_001`),
 *     so every submission would 404 upstream and fail closed — a portal that
 *     refuses everything correctly and can never succeed, which is precisely
 *     the failure mode docs/BUILD-LOG.md §3.30 records as the most expensive
 *     one on this project. It would also mean an internet-reachable page
 *     writing work-authorization records into a real Remote account.
 *   - Re-implement the fixtures behind a hand-written client. That is a second
 *     copy of every shape, i.e. the "the gates exist twice" hazard of
 *     CLAUDE.md §6 applied to test data.
 *
 * So the deployment runs the SAME `handle()` the mock server runs, reached
 * through the same RemoteClient, with the transport removed. `handle` only
 * ever touches `req.method`, `req.url`, `req.on("data"/"end")`,
 * `res.statusCode`, `res.setHeader` and `res.end` — the whole surface the
 * stand-ins below provide.
 *
 * @returns {(input: string|URL, init?: object) => Promise<Response>}
 */
export function createInProcessFetch() {
  return function mockFetch(input, init = {}) {
    // The base is irrelevant — `handle` reads pathname/search only — but URL
    // needs one, and RemoteClient always passes an absolute URL anyway.
    const url = new URL(String(input), "http://mock.remote.invalid");
    const raw = init.body == null ? null : Buffer.from(init.body);

    const req = Readable.from(raw && raw.length ? [raw] : []);
    req.method = (init.method || "GET").toUpperCase();
    req.url = url.pathname + url.search;
    req.headers = headersToObject(init.headers);

    return new Promise((resolve, reject) => {
      const chunks = [];
      const headers = {};
      const res = {
        statusCode: 200,
        setHeader(name, value) {
          headers[String(name).toLowerCase()] = value;
        },
        end(chunk) {
          if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk));
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
        },
      };
      try {
        handle(req, res);
      } catch (err) {
        reject(err);
      }
    });
  };
}

/** Whatever shape of headers fetch() accepts, as a plain lower-cased object. */
function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
    const out = {};
    headers.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

export function startMockServer(port = 4010) {
  const server = createServer(handle);
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

// If run directly (`npm run mock`), start listening.
if (import.meta.url === `file://${process.argv[1]}`) {
  startMockServer().then(() => console.log("Mock Remote API listening on http://localhost:4010"));
}
