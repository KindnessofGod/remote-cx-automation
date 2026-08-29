// ---------------------------------------------------------------------------
// remoteCountries.test.js — the supported-countries list must land on the
// ALPHA-2 axis, or UC-03's support gate is silently dead
// ---------------------------------------------------------------------------
// This is the regression suite for a defect that made UC-03 structurally unable
// to succeed in production: `listCountries()` mapped `c.country_code ?? c.code`,
// the live API returns neither of those as an alpha-2 value, and the resulting
// supported set was compared against 2-letter destinations. Every comparison
// was false, so every destination escalated as `unsupported_destination` — and
// because the system fails closed, a use case that could never succeed looked
// exactly like one being appropriately cautious.
//
// The tests below therefore assert on BOTH axes at once:
//   1. the real shape resolves (a supported country must be recognisable), and
//   2. anything NOT resolvable to a well-formed alpha-2 code is dropped, never
//      smuggled into the set as a 3-letter string that will silently compare
//      false one level further down.
//
// Fixture provenance matters here more than anywhere else in the suite: see
// test/fixtures/remoteCountries.js. Its rows are copied verbatim from a live
// response, because the original bug survived precisely on invented fixtures.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { RemoteClient, countryRowToAlpha2 } from "../src/remote/restClient.js";
import { startMockServer, COUNTRIES } from "../src/remote/mockServer.js";
import { LIVE_COUNTRY_ROWS, LIVE_COUNTRIES_ENVELOPE, LIVE_ALPHA_2 } from "./fixtures/remoteCountries.js";

const MOCK_PORT = 4107; // allocated in src/shared/ports.js TEST_PORTS (was 4094, which three other files bind)

// ---------------------------------------------------------------------------
// countryRowToAlpha2 — the single normalisation point
// ---------------------------------------------------------------------------

test("countryRowToAlpha2: the REAL API row resolves to its alpha-2 code, not its alpha-3", () => {
  const spain = LIVE_COUNTRY_ROWS.find((c) => c.name === "Spain");
  assert.equal(spain.code, "ESP", "fixture really is the live shape: `code` is alpha-3");
  assert.equal(spain.alpha_2_code, "ES");
  assert.equal(countryRowToAlpha2(spain), "ES");
});

test("countryRowToAlpha2: every live fixture row resolves to the expected alpha-2 code", () => {
  assert.deepEqual(LIVE_COUNTRY_ROWS.map(countryRowToAlpha2), LIVE_ALPHA_2);
});

test("countryRowToAlpha2: every mock row resolves to its alpha-2 code", () => {
  // The mock now serves the LIVE row shape (`code` alpha-3, `alpha_2_code`
  // alpha-2) — see src/remote/mockServer.js's COUNTRIES note. This assertion
  // therefore proves the same thing the live-fixture test above does, over the
  // fixture every offline test in the repo actually runs on.
  for (const row of COUNTRIES) {
    assert.equal(countryRowToAlpha2(row), row.alpha_2_code, `mock row ${row.name}`);
    assert.match(row.code, /^[A-Z]{3}$/, `mock row ${row.name}: \`code\` is the alpha-3 form, as live`);
  }
});

test("countryRowToAlpha2: a flat `country_code` row still resolves — the tolerance is kept, the fixture is not", () => {
  // No Remote endpoint and no fixture in this repo emits `country_code` any
  // more. The candidate is kept in countryRowToAlpha2() because it is
  // SHAPE-CHECKED and so cannot produce a wrong value, and because a caller may
  // inject a hand-rolled `remote` double. Pinned with an explicit literal
  // rather than with a fixture, so no fixture is ever tempted back into a shape
  // the real API does not send.
  assert.equal(countryRowToAlpha2({ country_code: "ES", name: "Spain" }), "ES");
});

test("countryRowToAlpha2: a nested country.{alpha_2_code} variant resolves", () => {
  assert.equal(countryRowToAlpha2({ country: { alpha_2_code: "ES", code: "ESP" } }), "ES");
});

test("countryRowToAlpha2: case and padding are normalised, so the set matches the gate's key", () => {
  assert.equal(countryRowToAlpha2({ alpha_2_code: " es " }), "ES");
  assert.equal(countryRowToAlpha2({ country_code: "de" }), "DE");
});

test("countryRowToAlpha2: a row offering ONLY an alpha-3 code is dropped, never returned as-is", () => {
  // THE POINT OF THIS TEST. Returning "ESP" here would move the exact same bug
  // one level down: a 3-letter string sitting in a set that is only ever probed
  // with 2-letter keys, comparing false forever and looking like caution.
  // There is no honest 3->2 conversion without a mapping table this repo does
  // not have and must not invent, so an unplaceable row is not confirmation of
  // support — it is dropped, and the destination escalates. Fail closed.
  assert.equal(countryRowToAlpha2({ code: "ESP", name: "Spain" }), null);
  assert.equal(countryRowToAlpha2({ country: { code: "DEU" } }), null);
});

test("countryRowToAlpha2: junk rows resolve to null rather than throwing", () => {
  for (const junk of [null, undefined, "ES", 42, [], {}, { alpha_2_code: null }, { alpha_2_code: 7 }, { alpha_2_code: "E" }, { alpha_2_code: "E1" }]) {
    assert.equal(countryRowToAlpha2(junk), null, `junk row ${JSON.stringify(junk)}`);
  }
});

// ---------------------------------------------------------------------------
// listCountries() — the client method UC-03's gate reads
// ---------------------------------------------------------------------------

/** A RemoteClient wired to a stub `fetch`-free transport via a fake base URL. */
function clientAnswering(body) {
  const client = new RemoteClient({ baseUrl: "http://unused.invalid" });
  // Stub the one HTTP hop. `#get` is private, so replace the global fetch for
  // the duration of the call — the same hermetic trick restClientRetry uses.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return {
    async run() {
      try {
        return await client.listCountries();
      } finally {
        globalThis.fetch = realFetch;
      }
    },
  };
}

test("listCountries: the LIVE envelope yields alpha-2 codes — Spain is ES, not ESP", async () => {
  const rows = await clientAnswering(LIVE_COUNTRIES_ENVELOPE).run();
  assert.equal(rows.length, LIVE_COUNTRY_ROWS.length);
  assert.deepEqual(
    rows.map((r) => r.country_code),
    LIVE_ALPHA_2
  );
  const spain = rows.find((r) => r.name === "Spain");
  assert.equal(spain.country_code, "ES");
});

test("listCountries: the MOCK now serves the LIVE envelope, and every row still resolves", async () => {
  // Before 2026-08-17 this test read the mock's own invented
  // `{data:{countries:[{country_code}]}}` shape and passed while production was
  // broken. The mock now serves what the API serves, so this is a real
  // end-to-end assertion over the wire instead of a restatement of the mock.
  const server = await startMockServer(MOCK_PORT);
  try {
    const remote = new RemoteClient({ baseUrl: `http://localhost:${MOCK_PORT}` });
    const rows = await remote.listCountries();
    assert.deepEqual(
      rows.map((r) => r.country_code).sort(),
      COUNTRIES.map((c) => c.alpha_2_code).sort()
    );
  } finally {
    server.close();
  }
});

test("listCountries: an unplaceable row is dropped from the list entirely", async () => {
  const rows = await clientAnswering({ data: [{ code: "ESP", name: "Spain" }, { alpha_2_code: "DE", name: "Germany" }] }).run();
  assert.deepEqual(rows, [{ country_code: "DE", name: "Germany" }]);
});

test("listCountries: a non-list body yields NULL — a read that failed, not an empty world", async () => {
  // THIS TEST USED TO ASSERT `[]`, and pinning that was the defect. An empty
  // array is an answer ("Remote lists no countries"); a body we could not read
  // is not an answer at all, and UC-03's only consumer turns the empty set into
  // `destination_jurisdiction_excluded` — a claim about the destination's
  // jurisdiction, manufactured from a failed fetch. Same conflation
  // `listPayrollRuns()` was rewritten to remove; see the note in
  // src/remote/restClient.js and section 4 of test/remoteShapeFidelity.test.js.
  //
  // Still not a throw: null is the convention `getEmployment()` and
  // `listPayrollRuns()` already use, and `src/uc03/workflow.js` records it as an
  // upstream failure so the decision stays fail-closed with an honest reason.
  for (const body of [{ data: null }, { data: { error: "boom" } }, {}, { data: "nope" }]) {
    const rows = await clientAnswering(body).run();
    assert.equal(rows, null, `body ${JSON.stringify(body)}`);
  }
});
