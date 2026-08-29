// Tests for restClient.js's normalizeEmployment() — the mock-vs-real-API
// shape adapter. Fixture below is a redacted shape of what the real Remote
// Sandbox API actually returned (field names are real; values are not).
// Run with:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmployment } from "../src/remote/restClient.js";

test("normalizeEmployment passes the mock's flat shape through untouched", () => {
  const mockEmployment = {
    id: "emp_active_001",
    email: "amara@acme.test",
    full_name: "Amara Okafor",
    status: "active",
    contract_type: "full_time",
    start_date: "2022-03-01",
    probation: false,
    base_salary: 5000000,
    currency: "USD",
    legal_entity_id: "le_ng_01",
  };
  assert.deepEqual(normalizeEmployment(mockEmployment), mockEmployment);
});

test("normalizeEmployment maps the real API's nested shape to the same flat fields", () => {
  const realEmployment = {
    id: "emp_real_1",
    status: "active",
    type: "contractor",
    employment_model: "contractor",
    full_name: "Alex Example",
    company_id: "company_1",
    engaged_by_legal_entity_id: "le_real_1",
    bill_to_legal_entity_id: "le_real_2",
    work_email: "alex@work.example.com",
    login_email: "alex@login.example.com",
    probation_period_end_date: null,
    provisional_start_date: "2023-06-24",
    basic_information: {
      name: "Alex Example",
      provisional_start_date: "2023-06-24",
      email: "alex@basic.example.com",
    },
    country: { code: "CAN", alpha_2_code: "CA" },
  };
  const normalized = normalizeEmployment(realEmployment);
  assert.equal(normalized.id, "emp_real_1");
  assert.equal(normalized.status, "active");
  assert.equal(normalized.full_name, "Alex Example");
  assert.equal(normalized.email, "alex@work.example.com");
  assert.equal(normalized.contract_type, "contractor");
  assert.equal(normalized.start_date, "2023-06-24");
  assert.equal(normalized.probation, false);
  assert.equal(normalized.legal_entity_id, "le_real_1");
  assert.equal(normalized.company_id, "company_1");
  assert.equal(normalized.country_code, "CA");
});

// Regression test for a real bug: a live n8n execution against the actual
// Remote Sandbox 404'd on GET /v1/countries//employment_basic_information
// (an empty country_code) because normalizeEmployment() never surfaced one
// at all for the real API's nested shape -- only the mock's synthetic flat
// shape happened to carry a top-level country_code, so npm test never
// caught it. Fixture is the real captured Sandbox response shape (field
// names real, values redacted) that triggered the failure.
test("normalizeEmployment surfaces country_code from the real API's nested country object", () => {
  const realEmployment = {
    id: "fde4007b-6257-4504-9467-8d61b5785488",
    status: "active",
    type: "contractor",
    employment_model: "contractor",
    full_name: "Alexandre Tremblay",
    company_id: "af3fdd2a-a818-40ba-9b2e-b84db6f100c1",
    country: { code: "CAN", name: "Canada", alpha_2_code: "CA" },
  };
  assert.equal(normalizeEmployment(realEmployment).country_code, "CA");
});

// This test used to assert the OPPOSITE — that an absent `alpha_2_code` falls
// back to the alpha-3 `code`, so `{country: {code: "DEU"}}` produced
// `country_code: "DEU"`. It was written deliberately and passed for its whole
// life, which is precisely the problem: it pinned finding F-25's twin as
// intended behaviour. `country_code` is only ever compared against 2-letter
// values (UC-05's notice table, UC-06's schema URL, UC-09's `["DE","FR","IT"]`),
// so "DEU" is not a degraded answer — it is a value guaranteed to compare false
// while looking like data. An unusable code must be NULL, which every one of
// those consumers already reads as "not confirmed" and escalates on. See
// test/remoteShapeFidelity.test.js for the consumer-by-consumer proof.
test("normalizeEmployment yields NULL when only the 3-letter code is available — never the alpha-3 value", () => {
  assert.equal(normalizeEmployment({ id: "e", status: "active", country: { code: "DEU" } }).country_code, null);
  assert.equal(normalizeEmployment({ id: "e", status: "active" }).country_code, null);
});

test("normalizeEmployment treats a future probation_period_end_date as on-probation", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const normalized = normalizeEmployment({ id: "e", status: "active", probation_period_end_date: future });
  assert.equal(normalized.probation, true);
});

test("normalizeEmployment treats a past probation_period_end_date as NOT on-probation", () => {
  const past = "2000-01-01";
  const normalized = normalizeEmployment({ id: "e", status: "active", probation_period_end_date: past });
  assert.equal(normalized.probation, false);
});

test("normalizeEmployment passes null through (missing record)", () => {
  assert.equal(normalizeEmployment(null), null);
});
