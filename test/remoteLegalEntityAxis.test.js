// ---------------------------------------------------------------------------
// remoteLegalEntityAxis.test.js — two fields called `country_code`, two
// alphabets, and no way for a reader to tell which one they hold
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS. `CompanyLegalEntity.country_code` is ISO **alpha-3** —
// Remote's reference says so in the field's own description, and the live
// Sandbox returns `USA`, `CAN`, `FRA`, `DEU`, `NLD` for the demo company's
// seven entities [CONFIRMED 2026-08-19]. `normalizeEmployment()`, in the same
// client, deliberately produces `country_code` in **alpha-2**, because that is
// the axis every comparison set in `src/` is written in.
//
// So `ALPHA2_SET.has(entity.country_code)` is false forever, silently, and the
// empty result reads as a reassuring *"this customer operates nowhere
// restricted"*. That is finding F-27's shape exactly, and F-27 left UC-03
// structurally unable to succeed for weeks without a single failing test.
//
// There is no consumer yet. That is the argument for fixing it at the
// boundary now: the first consumer cannot detect the problem, because a set
// membership that never matches looks identical to a customer with nothing to
// flag.
//
// PORT 0 — see the header of test/remoteHolidays.test.js.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer, LEGAL_ENTITIES } from "../src/remote/mockServer.js";
import { isWellFormedCountryCode } from "../src/shared/countryCodes.js";

// The live rows, 2026-08-19, from
// GET /v1/companies/a9d4ce72-…/legal-entities. Names are the Sandbox's own
// generated seed strings; they name no real company.
const LIVE_ENTITY_ROWS = [
  { id: "30aec65a-28c4-4961-ac70-0e10ad9e81fb", name: "Rempel-Paucek 4C3WAC", country_code: "USA", is_default: true, global_payroll_enabled: false },
  { id: "7cdd0ba8-eaec-4254-a2be-a4224a2536cd", name: "Rempel-Paucek 4C3WAC - Acme Canada Inc.", country_code: "CAN", is_default: false, global_payroll_enabled: true },
  { id: "1b55591c-ca30-496e-ba0f-7f75d38968bd", name: "Rempel-Paucek 4C3WAC - Acme France Lda", country_code: "FRA", is_default: false, global_payroll_enabled: true },
];

const LIVE_COUNTRY_REGISTRY = [
  { code: "USA", name: "United States", alpha_2_code: "US" },
  { code: "CAN", name: "Canada", alpha_2_code: "CA" },
  { code: "FRA", name: "France", alpha_2_code: "FR" },
];

/** A client answering the two real endpoints this normalisation reads. */
function clientOverLiveShapes({ entities = LIVE_ENTITY_ROWS, registry = LIVE_COUNTRY_REGISTRY } = {}) {
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return new RemoteClient({
    baseUrl: "http://localhost:1",
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/countries")) return json({ data: registry });
      if (url.includes("/legal-entities")) {
        return json({ data: { total_count: entities.length, current_page: 1, total_pages: 1, legal_entities: entities } });
      }
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    },
  });
}

test("POSITIVE: the live alpha-3 row comes back on the alpha-2 axis, resolved from Remote's own registry", async () => {
  const client = clientOverLiveShapes();
  const usa = await client.getLegalEntity("30aec65a-28c4-4961-ac70-0e10ad9e81fb", "co_1");

  assert.equal(usa.country_code, "US", "the name implies alpha-2, so the value must BE alpha-2");
  assert.ok(isWellFormedCountryCode(usa.country_code));
  assert.equal(usa.country_code_alpha3, "USA", "the axis it arrived on, under a name that says so");
  assert.equal(usa.country_name, "United States", "free from the same registry read");
  assert.equal(usa.name, "Rempel-Paucek 4C3WAC", "every other field is untouched");
  assert.equal(usa.global_payroll_enabled, false);
});

test("a real alpha-2 comparison now MATCHES — the assertion that was false forever", async () => {
  const client = clientOverLiveShapes();
  const footprint = new Set();
  for (const row of LIVE_ENTITY_ROWS) {
    const entity = await client.getLegalEntity(row.id, "co_1");
    footprint.add(entity.country_code);
  }
  // Before the boundary fix this set was {"USA","CAN","FRA"} and every probe of
  // it with an alpha-2 code missed. The point is not that the set is non-empty;
  // it is that a probe written the way every gate in this repo is written hits.
  assert.deepEqual([...footprint].sort(), ["CA", "FR", "US"]);
  assert.ok(footprint.has("US") && footprint.has("CA") && footprint.has("FR"));
  assert.ok(!footprint.has("USA"), "no alpha-3 may survive under a name that implies alpha-2");
});

test("an unresolvable code is NULL, never the alpha-3 string — a missing value gets investigated", async () => {
  // The registry cannot be read, so no conversion is possible. The honest
  // answer is "we could not place this on the alpha-2 axis", not a guess and
  // not the 3-letter value smuggled through under the 2-letter name.
  const client = clientOverLiveShapes({ registry: [] });
  const entity = await client.getLegalEntity(LIVE_ENTITY_ROWS[0].id, "co_1");

  assert.equal(entity.country_code, null);
  assert.equal(entity.country_code_alpha3, "USA", "nothing is lost — it is relabelled");
  assert.equal(entity.country_name, null, "a name this client cannot source is not invented");
});

test("a row that already carries alpha-2 passes through unconverted", async () => {
  // Belt and braces: the shape this repo's own mock served before this pass.
  const client = clientOverLiveShapes({
    entities: [{ id: "le_1", name: "Legacy", country_code: "US" }],
  });
  const entity = await client.getLegalEntity("le_1", "co_1");
  assert.equal(entity.country_code, "US");
  assert.equal(entity.country_code_alpha3, null, "there was no alpha-3 value to record");
});

test("the MOCK serves the alpha-3 form the live endpoint serves — the fixture may not agree with the code", async () => {
  const server = await startMockServer(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/v1/companies/co_amend_01/legal-entities`);
    const rows = (await res.json()).data.legal_entities;
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.match(row.country_code, /^[A-Z]{3}$/, `${row.name}: live serves ALPHA-3 here, so the mock must too`);
    }
    // And the fixtures themselves, so a future edit cannot quietly drop it.
    for (const entity of Object.values(LEGAL_ENTITIES)) {
      assert.match(entity.country_code, /^[A-Z]{3}$/, entity.id);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("through the mock end to end, a mock entity still lands on the alpha-2 axis", async () => {
  const server = await startMockServer(0);
  const { port } = server.address();
  try {
    const client = new RemoteClient({ baseUrl: `http://localhost:${port}` });
    const entity = await client.getLegalEntity("le_de_01", "co_amend_01");
    assert.equal(entity.country_code_alpha3, "DEU");
    assert.equal(entity.country_code, "DE", "resolved through the mock's own /v1/countries registry");
    assert.equal(entity.country_name, "Germany");

    // Brazil is NOT in the mock's illustrative registry, so it cannot be
    // resolved — and that must read as "not confirmed", not as "BRA".
    const brazil = await client.getLegalEntity("le_br_01", "co_amend_01");
    assert.equal(brazil.country_code_alpha3, "BRA");
    assert.equal(brazil.country_code, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
