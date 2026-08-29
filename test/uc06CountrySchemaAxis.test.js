// ---------------------------------------------------------------------------
// uc06CountrySchemaAxis.test.js
//   F-27, SECOND HALF — the per-country schema gate was keyed on the wrong axis
// ---------------------------------------------------------------------------
// WHAT WAS WRONG
// `GET /v1/countries/{country_code}/employment_basic_information` is keyed on
// ISO 3166-1 **alpha-3**. Remote's own reference for that path says so
// verbatim — *"Country code according to ISO 3-digit alphabetic codes"*,
// `"example": "PRT"` — and a live sweep on 2026-08-17 against
// gateway.remote-sandbox.com agreed without exception:
//
//     DEU CAN ESP USA NGA GBR  -> 200
//     DE  CA  ES  US  NG  GB   -> 404 {"message":"Country not found"}
//
// UC-06 called it with `employment.country_code`, which `normalizeEmployment()`
// deliberately yields as the ALPHA-2 form (correct — that is the axis every
// comparison gate needs: UC-05's notice table, UC-09's high-tax list, UC-03's
// destinations). So the schema fetch 404'd for EVERY country, on every run,
// and the gate escalated `country_schema_unavailable` every single time.
// Confirmed in production: n8n execution 4380, flag `upstream_country_schema_404`.
//
// WHY IT SURVIVED — AND WHY THIS FILE LEADS WITH A POSITIVE TEST
// The gate fails closed, so a gate that could never pass was observationally
// identical to a gate being appropriately cautious. Every fail-closed
// assertion in test/uc06.test.js passed throughout. That is the same mechanism
// that hid UC-03's dead supported-countries gate for the project's whole life,
// pointing the opposite way. Only an assertion of the form "this input MUST
// reach dual_approval_required" can tell the two apart, so that test comes
// first here and the fail-closed cases follow it.
//
// The mock is not evidence on its own: it used to key COUNTRY_SCHEMAS on
// alpha-2 too, agreeing with the caller rather than with Remote. That is the
// third production defect this repo has traced to an invented fixture, so the
// REAL axis and the REAL required-field sets are pinned below from verbatim
// live captures, independently of anything the mock says.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import { validateAgainstSchema } from "../src/shared/schemaValidator.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4068); // test-only port — 4068 is free per the sweep in test/ports.test.js
  remote = new RemoteClient({ baseUrl: "http://localhost:4068" });
});
after(() => server && server.close());

let audit;
let amendmentStore;
beforeEach(() => {
  audit = new AuditLogger();
  amendmentStore = new AmendmentStore();
});

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function submitDutch(overrides = {}) {
  return handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 72000, newAmount: 78000, currency: "EUR" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      ...overrides,
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

function submitGerman(overrides = {}) {
  return handleAmendmentRequest(
    {
      employmentId: "emp_de_001", // country_code "DE" on the mock's flat shape
      session,
      changes: { salary: { oldAmount: 68000, newAmount: 72000, currency: "EUR" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      ...overrides,
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

// ---------------------------------------------------------------------------
// 1. THE POSITIVE TEST — the one that detects a structurally dead gate.
// ---------------------------------------------------------------------------

test("POSITIVE — an amendment RETRIEVES its country schema and validates against it, reaching dual approval", async () => {
  // The Dutch employment, not the German one, and the swap is the finding
  // rather than a convenience. Live 2026-08-18, the DEU contract-amendment form
  // requires `schedule_type` and `required_qualifications`, and NO Sandbox
  // employment record carries either under any name — so a German amendment
  // honestly escalates naming them (asserted in the next test). The Dutch form
  // requires only fields `contract_details` genuinely holds, and a payload
  // sourced exactly this way was accepted live by
  // `POST /v1/contract-amendments/automatable` (200) and then really filed by
  // `POST /v1/contract-amendments` (201, amendment 82f8d1c6-…, since cancelled).
  const r = await submitDutch();

  // The precise regression. Before the fix this was
  // `escalate` / `country_schema_unavailable`, for Germany and for every other
  // country, forever — while every fail-closed test in the suite still passed.
  assert.notEqual(
    r.reason,
    "country_schema_unavailable",
    "the schema gate must not report the country's schema as unavailable when Remote serves one"
  );
  assert.equal(r.decision, "dual_approval_required");
  assert.equal(r.reason, "all_gates_passed");
  assert.deepEqual(r.flags, [], "a fully-validated amendment carries no flags");
});

test("a required field NO record carries is escalated BY NAME, never defaulted", async () => {
  // Germany, against the mock's FLAT fixture — which carries no
  // `contract_details` block at all, exactly like the sparse live records
  // (the live DE employment 09b65526-… holds four contract_details keys:
  // wage_type, annual_gross_salary, compensation_currency_code, available_pto).
  // Every field the DEU form needs beyond those is genuinely absent, so the
  // only honest answers are "escalate" and "here is exactly what is missing".
  // A default here would put a guessed value into a payroll amendment.
  const r = await submitGerman();
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "schema_invalid");
  for (const field of ["role_description", "experience_level", "work_schedule", "contract_duration_type"]) {
    assert.ok(r.flags.includes(`missing_${field}`), `${field} must be named — flags were ${JSON.stringify(r.flags)}`);
  }
});

test("POSITIVE — the client resolves the alpha-2 code an employment record carries to the alpha-3 path the API requires", async () => {
  // `normalizeEmployment()` yields alpha-2 ON PURPOSE, so this is the exact
  // value UC-06 has in hand at the call site.
  const employment = await remote.getEmployment("emp_de_001");
  assert.equal(employment.country_code, "DE", "the employment record is on the alpha-2 axis, as every comparison gate needs");

  const schema = await remote.getCountrySchema(employment.country_code);
  assert.ok(schema, "an alpha-2 code from an employment record must still reach the schema endpoint");
  assert.ok(Array.isArray(schema.required));
});

test("an alpha-3 code passes straight through — callers already holding one need no round-trip", async () => {
  const viaAlpha2 = await remote.getCountrySchema("DE");
  const viaAlpha3 = await remote.getCountrySchema("DEU");
  assert.deepEqual(viaAlpha3, viaAlpha2, "both axes must reach the same country's schema");
});

test("resolution is case- and whitespace-insensitive, and cached rather than refetched per call", async () => {
  for (const form of ["de", " De ", "DE", "deu", "DEU"]) {
    assert.ok(await remote.getCountrySchema(form), `${JSON.stringify(form)} must resolve`);
  }
  // One client, many lookups: the alpha-2 -> alpha-3 map is fetched at most
  // once. Cheap to assert, and it is the whole cost argument for resolving
  // from the API instead of hard-coding a 249-entry table.
  const counting = new RemoteClient({ baseUrl: "http://localhost:4068" });
  let countriesCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    if (String(url).endsWith("/v1/countries")) countriesCalls += 1;
    return realFetch(url, opts);
  };
  try {
    await Promise.all([
      counting.getCountrySchema("DE"),
      counting.getCountrySchema("GB"),
      counting.getCountrySchema("PL"),
      counting.getCountrySchema("NG"),
    ]);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(countriesCalls, 1, "concurrent callers share one countries fetch, not one each");
});

// ---------------------------------------------------------------------------
// 2. FAIL-CLOSED — every way resolution can fail must yield null, never a guess.
// ---------------------------------------------------------------------------

test("FAIL CLOSED — an unknown country resolves to nothing and returns null on BOTH axes", async () => {
  assert.equal(await remote.getCountrySchema("ZZ"), null, "unknown alpha-2");
  assert.equal(await remote.getCountrySchema("ZZZ"), null, "unknown alpha-3 (404s at the endpoint)");
});

test("FAIL CLOSED — a code that is not a country code at all never reaches the endpoint", async () => {
  for (const bad of [null, undefined, "", " ", "D", "GERM", "GERMANY", "D3", 42, {}, ["DE"]]) {
    assert.equal(
      await remote.getCountrySchema(bad),
      null,
      `${JSON.stringify(bad)} must not be interpolated into a country path`
    );
  }
});

test("FAIL CLOSED — a country that genuinely has no schema 404s and returns null, not {required: []}", async () => {
  // Preserves F-15: "this country requires nothing" and "we have no schema"
  // must stay distinguishable. `MX` is a real country in the mock's countries
  // list (so it RESOLVES to MEX) but has no COUNTRY_SCHEMAS entry — which is
  // precisely the case the old alpha-2 keying could not express, because every
  // lookup failed for the same reason.
  assert.equal(await remote.getCountrySchema("MX"), null);
  assert.equal(await remote.getCountrySchema("MEX"), null);
});

test("FAIL CLOSED — an unreadable countries list yields null, and does not poison the client permanently", async () => {
  const brittle = new RemoteClient({ baseUrl: "http://localhost:4068", retries: 1, backoff: async () => {} });
  const realFetch = globalThis.fetch;
  let breakCountries = true;
  globalThis.fetch = async (url, opts) => {
    if (breakCountries && String(url).endsWith("/v1/countries")) {
      return new Response("upstream exploded", { status: 500 });
    }
    return realFetch(url, opts);
  };
  try {
    assert.equal(await brittle.getCountrySchema("DE"), null, "no mapping means no schema — never a guessed code");
    // The failure must not be cached: an outage during one call cannot leave
    // the client answering "no such country" for everything thereafter.
    breakCountries = false;
    assert.ok(await brittle.getCountrySchema("DE"), "the next call retries the mapping and succeeds");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("FAIL CLOSED — an unresolvable country still escalates through the whole workflow", async () => {
  const remoteZZ = {
    getEmployment: async (id) => ({ ...(await remote.getEmployment(id)), country_code: "ZZ" }),
    getCountrySchema: (code) => remote.getCountrySchema(code),
    getContractAmendmentSchema: (id, code) => remote.getContractAmendmentSchema(id, code),
    listPayrollRuns: (companyId) => remote.listPayrollRuns(companyId),
    createContractAmendment: (args, opts) => remote.createContractAmendment(args, opts),
  };
  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_de_001",
      session,
      changes: { salary: { oldAmount: 68000, newAmount: 72000, currency: "EUR" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote: remoteZZ, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "country_schema_unavailable");

  // THIS USED TO ASSERT `upstream_country_schema_404`, and that assertion was
  // pinning a mis-attribution rather than a guarantee.
  //
  // "ZZ" is unresolvable, so `getContractAmendmentSchema()` returns null from
  // `#resolveAlpha3` WITHOUT EVER MAKING THE REQUEST. There is no 404, because
  // there is no call. The same null also comes back from a real 404, from an
  // unusable body, and from a THROWN status — live, NGA and USA answer 500 —
  // and the workflow hard-coded `status: 404, kind: not_found` across all four.
  //
  // A 404 is the one status that means "Remote answered authoritatively that
  // this record is not there" (src/shared/upstreamFailure.js), so recording it
  // for a call that never happened sends whoever triages the row hunting for a
  // bad employment id. The flag must still name WHICH call failed — that part
  // was always right — while refusing to claim a status nobody observed.
  assert.ok(
    r.flags.includes("upstream_country_schema_error"),
    `the flag must still name which call failed, without inventing a status: ${JSON.stringify(r.flags)}`
  );
  assert.ok(
    !r.flags.includes("upstream_country_schema_404"),
    "a call that was never made must never be recorded as a 404 about the record"
  );
});

// ---------------------------------------------------------------------------
// 3. THE REAL API'S AXIS AND FIELD SETS, PINNED FROM VERBATIM LIVE CAPTURES.
//
// Copied from `GET /v1/countries/{code}/employment_basic_information` on
// gateway.remote-sandbox.com, 2026-08-17, unedited. These exist so the mock can
// never again be the only thing asserting what Remote's contract is — the mock
// agreeing with the caller instead of the API is what hid this defect and
// UC-03's, and is now the third such case in this repo.
// ---------------------------------------------------------------------------

/** Verbatim `data.required` from the live responses, 2026-08-17. */
const LIVE_REQUIRED = {
  DEU: [
    "has_seniority_date",
    "mobile_number",
    "name",
    "job_title",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ],
  GBR: [
    "has_seniority_date",
    "name",
    "job_title",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ],
  USA: [
    "has_seniority_date",
    "name",
    "job_title",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ],
};

/** Verbatim `data.properties` key set from the live DEU response, 2026-08-17. */
const LIVE_DEU_PROPERTIES = [
  "has_seniority_date",
  "job_title",
  "login_email",
  "mobile_number",
  "name",
  "personal_email",
  "provisional_start_date",
  "seniority_date",
  "tax_job_category",
  "tax_servicing_countries",
  "work_email",
];

test("LIVE SHAPE — the per-country schema genuinely varies by country, which is why invariant #2 exists", () => {
  // Germany requires a mobile number; the UK and the US do not. That single
  // difference is the whole justification for fetching a schema per country
  // rather than assuming a static field set — and it is unobservable while the
  // gate 404s on every country alike.
  assert.ok(LIVE_REQUIRED.DEU.includes("mobile_number"));
  assert.ok(!LIVE_REQUIRED.GBR.includes("mobile_number"));
  assert.ok(!LIVE_REQUIRED.USA.includes("mobile_number"));
  assert.deepEqual(LIVE_REQUIRED.GBR, LIVE_REQUIRED.USA, "captured verbatim: these two really are identical");
});

test("LIVE SHAPE — the FIXED payload's remaining gap is normalizeEmployment(), not the builder", () => {
  // HISTORY, kept because it is the reason this test exists. When the country-
  // code axis was fixed, `buildAmendmentPayload()` still produced the four
  // fixed keys {job_title, weekly_hours, base_salary, currency}, which against
  // Germany's REAL form is wrong twice over: seven of eight required fields
  // missing, and three of the four keys not properties of the form at all
  // (`additionalProperties: false`). The payload asserted below is that old
  // one, preserved verbatim so the failure it produced stays legible.
  //
  // THAT HALF IS NOW FIXED. The builder is schema-driven (see
  // src/uc06/policyEngine.js and test/uc06AmendmentPayload.test.js): it emits
  // only names the form declares and carries every required field it can source
  // from the employment record. What remains is the OTHER half named here —
  // `normalizeEmployment()` drops `basic_information`, so has_seniority_date,
  // tax_job_category, login_email, tax_servicing_countries and mobile_number
  // have no source on the Node path. Live proof, same NL employment through the
  // production webhook: `schema_invalid` went from six missing fields
  // (payroll-after-nl, 12:57) to two (payload-fix-jobtitle, 13:31).
  const amendmentPayload = { job_title: "Staff Engineer", weekly_hours: 40, base_salary: 7200000, currency: "EUR" };

  const check = validateAgainstSchema(amendmentPayload, { required: LIVE_REQUIRED.DEU });
  assert.equal(check.valid, false);
  assert.deepEqual(check.missing, [
    "has_seniority_date",
    "mobile_number",
    "name",
    "provisional_start_date",
    "tax_servicing_countries",
    "tax_job_category",
    "login_email",
  ]);

  for (const key of ["weekly_hours", "base_salary", "currency"]) {
    assert.ok(!LIVE_DEU_PROPERTIES.includes(key), `${key} is not a field of the employment_basic_information form`);
  }
  assert.ok(LIVE_DEU_PROPERTIES.includes("job_title"), "job_title is the one amendable field the form does define");
});

test("LIVE SHAPE — a next-state basic-information record IS satisfiable, so the gate is not dead, only unmet", () => {
  // The counterpart to the test above: the same real German form validates
  // cleanly once the payload is the record the form actually describes. This
  // is what proves `schema_invalid` above is a statement about the payload,
  // not another structurally-unreachable gate.
  const nextStateBasicInformation = {
    name: "Anna Müller",
    login_email: "anna@example.test",
    mobile_number: "+49 30 123456",
    job_title: "Staff Engineer", // the amended value
    provisional_start_date: "2023-06-26",
    tax_servicing_countries: ["DEU"],
    tax_job_category: "professional",
    has_seniority_date: false,
  };
  assert.deepEqual(validateAgainstSchema(nextStateBasicInformation, { required: LIVE_REQUIRED.DEU }), {
    valid: true,
    missing: [],
  });
});
