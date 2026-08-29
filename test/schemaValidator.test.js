// ---------------------------------------------------------------------------
// schemaValidator.test.js — `null` is present; `undefined` is absent
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// `validateAgainstSchema()` used to collapse `undefined`, `null` and `""` into
// one verdict: missing. Remote's live form schemas disagree — `effective_date`
// on the contract-amendment form is in `required` AND typed `["string","null"]`
// on every demo country whose schema answers, so a payload Remote accepts was
// reported `schema_invalid` here. Safe direction, wrong recorded reason.
//
// EVERY TEST BELOW COMES IN A PAIR, and the pair is the whole point. A test
// that only proves "a legal null validates" cannot tell a fix from a
// loosening: `return {valid: true, missing: []}` passes it. The partner test —
// "the same field genuinely absent must NOT validate" — is what makes the
// first one mean something.
//
// Schema fragments are quoted from this repo's own live captures, hashed and
// dated, not invented:
//   docs/knowledge/layer-2-remote/L2-09-contract-amendment-schemas-demo-four.md
//   docs/knowledge/layer-2-remote/L2-08-country-form-schemas-demo-four.md
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema, permitsNull } from "../src/shared/schemaValidator.js";

// ---------------------------------------------------------------------------
// The live fragments. Field names, types and required-lists only — the same
// "in the small" rule the knowledge layer follows. No schema is mirrored.
// ---------------------------------------------------------------------------

/**
 * GET /v1/contract-amendments/schema — NLD, eor `employee` 673a1884-…,
 * live 2026-08-19, sha256 2d14aa5f3c02a36c47caf0040cdea817dad212c4647105d7b9efdd3a61c19211.
 * Seven required fields; `effective_date` is the required-AND-nullable one.
 */
const AMENDMENT_SCHEMA_NLD = Object.freeze({
  required: [
    "annual_gross_salary",
    "effective_date",
    "job_title",
    "role_description",
    "contract_duration_type",
    "work_schedule",
    "work_hours_per_week",
  ],
  properties: {
    annual_gross_salary: { type: "integer", minimum: 0 },
    effective_date: { type: ["string", "null"], format: "date" },
    job_title: { type: "string" },
    role_description: { type: "string" },
    contract_duration_type: { type: "string" },
    work_schedule: { type: "string" },
    work_hours_per_week: { type: "number" },
  },
});

/** A complete, valid next state for the form above — every field but the one under test. */
function amendmentPayload(overrides = {}) {
  return {
    annual_gross_salary: 7_200_000,
    effective_date: "2026-10-01",
    job_title: "Staff Engineer",
    role_description: "Builds and operates the platform",
    contract_duration_type: "indefinite",
    work_schedule: "full_time",
    work_hours_per_week: 40,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PAIR 1 — the live defect, in both directions
// ---------------------------------------------------------------------------

test("POSITIVE: a required field typed [\"string\",\"null\"] validates when it IS null", () => {
  // This is the payload Remote accepts and this validator used to refuse.
  const check = validateAgainstSchema(amendmentPayload({ effective_date: null }), AMENDMENT_SCHEMA_NLD);

  assert.deepEqual(check, { valid: true, missing: [] });
});

test("NEGATIVE: the same field genuinely absent still fails, on the same schema", () => {
  // The partner. Without it, the test above is satisfied by a validator that
  // has stopped validating.
  const payload = amendmentPayload();
  delete payload.effective_date;

  assert.deepEqual(validateAgainstSchema(payload, AMENDMENT_SCHEMA_NLD), {
    valid: false,
    missing: ["effective_date"],
  });
});

test("NEGATIVE: explicitly undefined is absent too — a key with no value is not a value", () => {
  const check = validateAgainstSchema(amendmentPayload({ effective_date: undefined }), AMENDMENT_SCHEMA_NLD);

  assert.deepEqual(check, { valid: false, missing: ["effective_date"] });
});

test("NEGATIVE: a blank string is still refused, even though JSON Schema would allow it", () => {
  // Deliberately stricter than the spec: Remote answers `422 "can't be blank"`,
  // so accepting it here would only move the refusal later and further away.
  const check = validateAgainstSchema(amendmentPayload({ effective_date: "" }), AMENDMENT_SCHEMA_NLD);

  assert.deepEqual(check, { valid: false, missing: ["effective_date"] });
});

// ---------------------------------------------------------------------------
// PAIR 2 — nullability is opt-in, and the opt-in is the SCHEMA's word
// ---------------------------------------------------------------------------

test("NEGATIVE: null in a field the schema types as a plain string is still missing", () => {
  // `job_title` is `{"type": "string"}` live. Nothing permits null, so nothing
  // changed for it — the fix is scoped to what the schema actually says.
  const check = validateAgainstSchema(amendmentPayload({ job_title: null }), AMENDMENT_SCHEMA_NLD);

  assert.deepEqual(check, { valid: false, missing: ["job_title"] });
});

test("NEGATIVE: null in a required field of a schema with NO properties is still missing", () => {
  // The call sites that matter. `src/uc02/server.js` passes a hand-written
  // `{required: [...]}`; `src/uc06/policyEngine.js` passes
  // `{required: effectiveRequired}` — a synthesized object that drops the
  // properties it came from. If "the schema is silent" meant "null is fine", a
  // null expenseId would sail through UC-02's submission gate.
  const check = validateAgainstSchema(
    { expenseId: null, employmentId: "emp-1" },
    { required: ["expenseId", "employmentId"] }
  );

  assert.deepEqual(check, { valid: false, missing: ["expenseId"] });
});

test("REGRESSION GUARD: the behaviour every existing caller relies on is unchanged", () => {
  // Nine callers pass `{required: [...]}` and nothing else. This is the exact
  // pre-change contract for that shape, pinned so a later widening of the
  // silent-schema default has to break a test rather than a production gate.
  const bare = { required: ["a", "b", "c", "d"] };

  assert.deepEqual(validateAgainstSchema({ a: 1, b: null, c: "", d: undefined }, bare), {
    valid: false,
    missing: ["b", "c", "d"],
  });
  assert.deepEqual(validateAgainstSchema({ a: 1, b: 2, c: 3, d: 4 }, bare), { valid: true, missing: [] });
  assert.deepEqual(validateAgainstSchema({}, { required: [] }), { valid: true, missing: [] });
  assert.deepEqual(validateAgainstSchema(null, { required: ["a"] }), { valid: false, missing: ["a"] });
  assert.deepEqual(validateAgainstSchema({ a: 1 }, null), { valid: true, missing: [] });
});

test("the return shape stays exactly {valid, missing} — callers deep-equal it", () => {
  // test/uc06CountrySchemaAxis.test.js asserts deepEqual against the whole
  // object. A third key, however informative, breaks that file.
  const check = validateAgainstSchema(amendmentPayload({ effective_date: null }), AMENDMENT_SCHEMA_NLD);

  assert.deepEqual(Object.keys(check).sort(), ["missing", "valid"]);
});

// ---------------------------------------------------------------------------
// PAIR 3 — the other live nullable shapes, and an honest note about them
// ---------------------------------------------------------------------------

test("POSITIVE/NEGATIVE: the contract_details nullable shapes, IF a rule ever requires them", () => {
  // PRT/CAN `probation_length` is `["number","null"]` and USA
  // `flsa_classification` is `["string","null"]` with null an explicit `oneOf`
  // member (L2-08 §3, §5). NEITHER is in its form's top-level `required` list,
  // so today neither reaches the loop at all. They become reachable the moment
  // an `allOf` branch requires them — which is the depth this validator does
  // not have. Pinned here so the handling is already right when it does.
  const contractDetails = {
    required: ["probation_length", "flsa_classification"],
    properties: {
      probation_length: { type: ["number", "null"], minimum: 0, maximum: 6 },
      flsa_classification: { oneOf: [{ type: "string" }, { type: "null" }] },
    },
  };

  assert.deepEqual(validateAgainstSchema({ probation_length: null, flsa_classification: null }, contractDetails), {
    valid: true,
    missing: [],
  });
  assert.deepEqual(validateAgainstSchema({}, contractDetails), {
    valid: false,
    missing: ["probation_length", "flsa_classification"],
  });
});

// ---------------------------------------------------------------------------
// permitsNull() — the predicate, on its own
// ---------------------------------------------------------------------------

test("permitsNull recognises every null spelling the live schemas use", () => {
  assert.equal(permitsNull({ type: "null" }), true);
  assert.equal(permitsNull({ type: ["string", "null"] }), true);
  assert.equal(permitsNull({ type: ["number", "null"], minimum: 0 }), true);
  assert.equal(permitsNull({ oneOf: [{ type: "string" }, { type: "null" }] }), true);
  assert.equal(permitsNull({ anyOf: [{ type: "null" }] }), true);
  assert.equal(permitsNull({ nullable: true }), true, "OpenAPI 3.0's spelling");
  assert.equal(permitsNull({ enum: ["a", null] }), true);
  assert.equal(permitsNull({ const: null }), true);
});

test("permitsNull answers false for anything it does not understand — including allOf", () => {
  // `oneOf`/`anyOf` are satisfied by ONE branch, so a null-typed member is a
  // permission. `allOf` requires EVERY branch, so the same member proves
  // nothing. Reading them alike would be a loosening dressed as symmetry.
  assert.equal(permitsNull({ allOf: [{ type: "null" }, { type: "string" }] }), false);

  assert.equal(permitsNull({ type: "string" }), false);
  assert.equal(permitsNull({ type: ["string", "integer"] }), false);
  assert.equal(permitsNull({ $ref: "#/definitions/date" }), false, "an unresolved ref is not an answer");
  assert.equal(permitsNull({ enum: ["a", "b"] }), false);
  assert.equal(permitsNull({ const: "fixed" }), false);
  assert.equal(permitsNull({}), false);
  assert.equal(permitsNull(undefined), false, "a field the schema never describes");
  assert.equal(permitsNull(null), false);
  assert.equal(permitsNull("null"), false, "a string is not a schema");
});

// ---------------------------------------------------------------------------
// The depth gap, asserted rather than described
// ---------------------------------------------------------------------------

test("KNOWN LIMIT: this validator sees neither `allOf` nor `minimum` — recorded, not silently absent", () => {
  // Live, the USA `contract_details` form carries 81 conditional rules and
  // Canada's 72, and 34 of the US ones are per-state hourly minimum-wage floors
  // in ×100 minor units (L2-08 §5). None of that is visible here. The gate that
  // does resolve conditionals is `src/uc06/policyEngine.js#effectiveSchema()`.
  //
  // This test exists so the limit fails loudly if someone assumes otherwise:
  // a payload one cent under a live floor, and a payload a conditional rule
  // forbids outright, both come back valid.
  const schemaWithDepth = {
    required: ["hourly_gross_salary"],
    properties: { hourly_gross_salary: { type: "integer", minimum: 725 } },
    allOf: [
      {
        if: { properties: { wage_type: { const: "hourly" } } },
        then: { required: ["hourly_gross_salary"], properties: { annual_gross_salary: false } },
      },
    ],
  };

  assert.deepEqual(validateAgainstSchema({ hourly_gross_salary: 1, wage_type: "hourly" }, schemaWithDepth), {
    valid: true,
    missing: [],
  });
  assert.deepEqual(
    validateAgainstSchema({ hourly_gross_salary: 725, annual_gross_salary: 3_556_800, wage_type: "hourly" }, schemaWithDepth),
    { valid: true, missing: [] },
    "a field this branch FORBIDS is not seen either"
  );
});
