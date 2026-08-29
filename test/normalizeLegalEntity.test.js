// ---------------------------------------------------------------------------
// normalizeLegalEntity.test.js — the n8n legal-entity fetch and
// RemoteClient#normalizeLegalEntity must agree
// ---------------------------------------------------------------------------
// rca-dy0 / L-16 follow-on / F-27. `workflows/nodes/normalizeLegalEntity.js`
// is the n8n port of RemoteClient's #normalizeLegalEntity +
// #countryIndex/#resolveAlpha2 (src/remote/restClient.js) — the alpha-3 ->
// alpha-2 conversion, because GET /v1/companies/{id}/legal-entities returns
// country_code on the ISO 3166-1 ALPHA-3 axis and every other surface in src/
// speaks ALPHA-2. This executes the ACTUAL node body in a sandbox, the same
// discipline test/n8nParity.test.js applies to the gates.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_PATH = join(__dirname, "..", "workflows", "nodes", "normalizeLegalEntity.js");
const nodeSource = readFileSync(NODE_PATH, "utf8");

/**
 * Run the n8n Code node body with n8n's globals mocked.
 * @param {object} opts
 * @param {object} opts.ctx the "Assign Routing" output — must carry `employment`
 * @param {object} opts.legalEntityResponse raw HTTP response from the
 *   "Fetch Legal Entity (Remote)" node (Remote's own envelope, {data: {...}})
 * @param {object} opts.countriesResponse raw HTTP response from the
 *   "Fetch Countries (Remote)" node ({data: [...]})
 */
function runNode({ ctx, legalEntityResponse, countriesResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Assign Routing") return { first: () => ({ json: ctx }) };
      if (nodeName === "Fetch Legal Entity (Remote)") return { first: () => ({ json: legalEntityResponse }) };
      if (nodeName === "Fetch Countries (Remote)") return { first: () => ({ json: countriesResponse }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const wrapped = `(function () {\n${nodeSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

const CTX = { decision: "auto_resolve", employment: { legal_entity_id: "le_1", company_id: "co_1" } };

/** Remote's real envelope for GET /v1/companies/{id}/legal-entities. */
const legalEntitiesResponse = (rows) => ({
  data: { total_count: rows.length, current_page: 1, total_pages: 1, legal_entities: rows },
});

/** Remote's real envelope for GET /v1/countries — a bare array under `data`. */
const countriesResponse = (rows) => ({ data: rows });

const COUNTRY_ROWS = [
  { code: "USA", alpha_2_code: "US", name: "United States" },
  { code: "CAN", alpha_2_code: "CA", name: "Canada" },
  { code: "NLD", alpha_2_code: "NL", name: "Netherlands" },
];

test("converts the real API's ALPHA-3 country_code to ALPHA-2, matching RemoteClient#normalizeLegalEntity", () => {
  const out = runNode({
    ctx: CTX,
    legalEntityResponse: legalEntitiesResponse([
      { id: "le_other", name: "Not This One", country_code: "CAN" },
      { id: "le_1", name: "Rempel-Paucek 4C3WAC", country_code: "USA", is_default: true },
    ]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.legalEntity.name, "Rempel-Paucek 4C3WAC");
  assert.equal(out.legalEntity.country_code, "US", "the letter must print the alpha-2 axis, not the raw alpha-3");
  assert.equal(out.legalEntity.country_code_alpha3, "USA");
  assert.equal(out.legalEntity.country_name, "United States");
  assert.equal(out.legalEntity.is_default, true, "fields Remote sent are preserved, not just the converted ones");
});

test("matches by engaged_by_legal_entity_id, never the first row or the default entity", () => {
  const out = runNode({
    ctx: { decision: "auto_resolve", employment: { legal_entity_id: "le_2", company_id: "co_1" } },
    legalEntityResponse: legalEntitiesResponse([
      { id: "le_1", name: "Default Entity", country_code: "USA", is_default: true },
      { id: "le_2", name: "The Employment's Actual Entity", country_code: "NLD", is_default: false },
    ]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.legalEntity.name, "The Employment's Actual Entity");
  assert.equal(out.legalEntity.country_code, "NL");
});

test("an unrecognised alpha-3 code fails CLOSED to null — never a guess", () => {
  const out = runNode({
    ctx: CTX,
    legalEntityResponse: legalEntitiesResponse([{ id: "le_1", name: "Some Entity", country_code: "ZZZ" }]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.legalEntity.country_code, null);
  assert.equal(out.legalEntity.country_code_alpha3, "ZZZ");
});

test("a row already on the alpha-2 axis passes through unconverted (safe against either shape)", () => {
  const out = runNode({
    ctx: CTX,
    legalEntityResponse: legalEntitiesResponse([{ id: "le_1", name: "Mock-Shaped Entity", country_code: "US" }]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.legalEntity.country_code, "US");
  assert.equal(out.legalEntity.country_code_alpha3, null, "a code that was never alpha-3 carries no alpha-3 value");
});

test("no matching entity id -> legalEntity is null, so Render Letter's own throw still fires", () => {
  const out = runNode({
    ctx: CTX,
    legalEntityResponse: legalEntitiesResponse([{ id: "le_other", name: "Wrong Entity", country_code: "USA" }]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.legalEntity, null);
});

test("an unreadable countries registry fails every code closed to null, not to a guess", () => {
  const out = runNode({
    ctx: CTX,
    legalEntityResponse: legalEntitiesResponse([{ id: "le_1", name: "Some Entity", country_code: "USA" }]),
    countriesResponse: countriesResponse([]),
  });
  assert.equal(out.legalEntity.country_code, null);
  assert.equal(out.legalEntity.country_code_alpha3, "USA", "the original value survives even when it cannot be converted");
});

test("the rest of the context passes through unchanged — this node adds legalEntity, nothing else", () => {
  const out = runNode({
    ctx: { decision: "auto_resolve", employment: CTX.employment, flags: ["a_flag"], reason: "all_gates_passed" },
    legalEntityResponse: legalEntitiesResponse([{ id: "le_1", name: "Some Entity", country_code: "USA" }]),
    countriesResponse: countriesResponse(COUNTRY_ROWS),
  });
  assert.equal(out.decision, "auto_resolve");
  assert.deepEqual(out.flags, ["a_flag"]);
  assert.equal(out.reason, "all_gates_passed");
});
