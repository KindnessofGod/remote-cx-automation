// ---------------------------------------------------------------------------
// sandboxCaptureFidelity.test.js — the mock answers what the Sandbox answers
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, AND WHY IT IS NOT remoteShapeFidelity.test.js
//
// Its sibling pins three specific historical defects (the countries envelope,
// the alpha-3 fallback, the swallowed payroll 404) against hand-transcribed
// live rows. This file does something narrower and more mechanical: it drives
// `src/remote/mockServer.js` over its own HTTP surface and compares the answers
// to `test/fixtures/sandboxCapture.js`, which is a verbatim capture written by
// `scripts/capture-sandbox.mjs` on 2026-08-19 and edited by nobody.
//
// The distinction that matters is WHERE THE EXPECTED VALUE CAME FROM. An
// assertion written from the code cannot fail when the code is wrong about the
// API — that is the whole mechanism behind every defect CLAUDE.md §4 lists, and
// each of those passed the full suite. An assertion written from a capture can.
//
// THREE THINGS ARE CHECKED, in increasing order of how much they cost when
// wrong:
//
//   1. ENVELOPES. What level the payload nests at, and whether a collection
//      paginates. Cheap to get wrong, and invisible: RemoteClient tolerates
//      both employment envelopes, so the mock disagreed with the API here for
//      the whole life of the project without one test noticing.
//
//   2. ABSENT ROUTES vs. EMPTY ONES. A 404 and a 200-with-nothing are opposite
//      answers — "we cannot read this" against "there is nothing to read" — and
//      only the second is a fact about the business. The mock used to give the
//      first where the API gives the second, on two collections.
//
//   3. FIELDS A GATE READS. The expensive one. `custom_fields` and
//      `custom-fields` differ by a character and by their whole data model, and
//      the difference decides whether UC-04 can ever allow a workation.
//
// NOTHING HERE REACHES THE NETWORK. The capture is committed precisely so these
// assertions stay hermetic while still being answerable by Remote.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createInProcessFetch, EMPLOYMENTS, CUSTOM_FIELD_DEFINITIONS } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import {
  LIVE_EMPLOYMENT_SHOW_ENVELOPE,
  LIVE_EMPLOYMENT_LIST_ROW,
  LIVE_EMPLOYMENT_LIST_ENVELOPE_KEYS,
  LIVE_EMPLOYMENT_CUSTOM_FIELDS,
  LIVE_CUSTOM_FIELD_DEFINITION_NAMES,
  LIVE_WORK_AUTH_COLLECTION,
  LIVE_TRAVEL_LETTER_COLLECTION,
  LIVE_CONTRACT_AMENDMENT_ROW,
  LIVE_EXPENSE_LIST_ENVELOPE_KEYS,
  LIVE_ENDPOINT_STATUSES,
} from "./fixtures/sandboxCapture.js";

const fetchMock = createInProcessFetch();

/** One GET against the in-process mock. No socket, no network. */
async function get(path) {
  const res = await fetchMock(`http://mock${path}`, { headers: {} });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const sortedKeys = (o) => Object.keys(o ?? {}).sort();

// ---------------------------------------------------------------------------
// 1. ENVELOPES
// ---------------------------------------------------------------------------

test("GET /v1/employments/:id nests the record under data.employment, like the API", async () => {
  const live = sortedKeys(LIVE_EMPLOYMENT_SHOW_ENVELOPE.data);
  assert.deepEqual(live, ["employment"], "capture itself must show the nesting");

  const { status, body } = await get("/v1/employments/emp_active_001");
  assert.equal(status, 200);
  assert.deepEqual(sortedKeys(body.data), live);
  assert.equal(body.data.employment.id, "emp_active_001");
});

test("GET /v1/employments paginates, and its ROW is the list row, not the show record", async () => {
  const { status, body } = await get("/v1/employments");
  assert.equal(status, 200);
  assert.deepEqual(sortedKeys(body.data), LIVE_EMPLOYMENT_LIST_ENVELOPE_KEYS);

  const row = body.data.employments[0];
  assert.deepEqual(sortedKeys(row), sortedKeys(LIVE_EMPLOYMENT_LIST_ROW));

  // The four keys the live LIST row does not carry, spelled out rather than
  // left to the deepEqual above — these are the ones a caller is most likely to
  // reach for after listing, and each returns undefined in production.
  for (const absent of ["basic_information", "contract_details", "company_id", "probation_period_end_date"]) {
    assert.equal(row[absent], undefined, `list row must not carry ${absent}`);
    assert.equal(LIVE_EMPLOYMENT_LIST_ROW[absent], undefined, `capture disagrees about ${absent}`);
  }
});

test("GET /v1/expenses paginates — a first page must not read as the whole set", async () => {
  const { status, body } = await get("/v1/expenses");
  assert.equal(status, 200);
  assert.deepEqual(sortedKeys(body.data), LIVE_EXPENSE_LIST_ENVELOPE_KEYS);
  assert.equal(typeof body.data.total_count, "number");
});

// ---------------------------------------------------------------------------
// 2. AN ABSENT ROUTE IS NOT AN EMPTY ONE
// ---------------------------------------------------------------------------

test("the two empty collections answer 200-with-nothing, exactly as the Sandbox does", async () => {
  for (const [path, capture, key] of [
    ["/v1/work-authorization-requests", LIVE_WORK_AUTH_COLLECTION, "work_authorization_requests"],
    ["/v1/travel-letter-requests", LIVE_TRAVEL_LETTER_COLLECTION, "travel_letter_requests"],
  ]) {
    const { status, body } = await get(path);
    assert.equal(status, 200, `${path} must not 404 — the API answers 200`);
    assert.deepEqual(sortedKeys(body.data), sortedKeys(capture.data), path);
    assert.ok(Array.isArray(body.data[key]), `${path} must carry ${key}[]`);
  }
  // And the capture must genuinely be empty, or the assertion above is testing
  // nothing about the Sandbox's actual emptiness.
  assert.equal(LIVE_WORK_AUTH_COLLECTION.data.total_count, 0);
  assert.equal(LIVE_TRAVEL_LETTER_COLLECTION.data.total_count, 0);
});

test("GET /v1/contract-amendments serves the live row shape, which carries no amount", async () => {
  const { status, body } = await get("/v1/contract-amendments");
  assert.equal(status, 200);
  const row = body.data.contract_amendments[0];
  assert.deepEqual(sortedKeys(row), sortedKeys(LIVE_CONTRACT_AMENDMENT_ROW));
  // The absence is the finding: no listing of amendments can tell you what any
  // of them proposes to pay anyone.
  for (const money of ["amount", "annual_gross_salary", "compensation_currency_code", "currency"]) {
    assert.equal(row[money], undefined, `contract-amendment row must not carry ${money}`);
  }
});

test("GET /v1/companies/:id/legal-entities exists, so the branch production takes is the branch tested", async () => {
  const { status, body } = await get("/v1/companies/co_amend_01/legal-entities");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.legal_entities));

  // POSITIVE TEST, and the reason this one is here at all. RemoteClient prefers
  // this path whenever the employment carries a company_id — which every real
  // record does — and falls back to the singular lookup only when it does not.
  // With no route here the real branch 404'd and only the fallback was ever
  // exercised, so the letter path production takes had no coverage and the one
  // it never takes had all of it.
  const client = new RemoteClient({ baseUrl: "http://mock", token: null, fetchImpl: fetchMock });
  const entity = await client.getLegalEntity("le_ng_01", "co_amend_01");
  assert.equal(entity.id, "le_ng_01");
  assert.ok(entity.name, "the letter needs a name off this branch");
});

// ---------------------------------------------------------------------------
// 3. THE FIELD UC-04's FIRST HARD GATE READS
// ---------------------------------------------------------------------------

test("a real employment payload carries NO custom_fields key at all", () => {
  const employment = LIVE_EMPLOYMENT_SHOW_ENVELOPE.data.employment;
  assert.equal(
    Object.prototype.hasOwnProperty.call(employment, "custom_fields"),
    false,
    "the Sandbox capture must not contain custom_fields — if it does, this finding is stale"
  );
  // And nowhere in the whole 49-key record does the string appear under any
  // nesting, which is what rules out "it moved" as an explanation.
  assert.equal(JSON.stringify(employment).includes("custom_fields"), false);
  assert.equal(JSON.stringify(employment).includes("workation"), false);
});

test("the custom-fields sub-resource is addressed by NAME — there is no key to read a permission off", async () => {
  const { status, body } = await get("/v1/employments/emp_active_001/custom-fields");
  assert.equal(status, 200);
  assert.deepEqual(sortedKeys(body.data), sortedKeys(LIVE_EMPLOYMENT_CUSTOM_FIELDS.data));

  const liveRow = LIVE_EMPLOYMENT_CUSTOM_FIELDS.data.custom_field_values[0];
  assert.deepEqual(sortedKeys(body.data.custom_field_values[0]), sortedKeys(liveRow));

  // THE LOAD-BEARING ASSERTION. Every row is {name, type, value,
  // custom_field_id}. No row carries a machine slug, so there is no spelling of
  // `custom_fields.workation_permission` that a real response can satisfy —
  // which is what makes UC-04's first hard gate unsatisfiable from the API
  // rather than merely unsatisfied by this Sandbox's data.
  for (const row of LIVE_EMPLOYMENT_CUSTOM_FIELDS.data.custom_field_values) {
    assert.deepEqual(sortedKeys(row), ["custom_field_id", "name", "type", "value"]);
    assert.equal(row.slug, undefined);
    assert.equal(row.code, undefined);
  }
  assert.equal(
    LIVE_CUSTOM_FIELD_DEFINITION_NAMES.some((n) => /workation|permission/i.test(n)),
    false,
    "no custom field on this Sandbox company is a workation permission"
  );
});

test("the UNDERSCORE spelling 404s, and no sub-resource path leaks the employment record", async () => {
  // `/v1/employments/{id}/custom_fields` is what docs/use-cases/UC-04.md §3
  // records as [CONFIRMED]. Live it is a 404. The mock used to match the show
  // route on the id alone and ignore everything after it, so this path — and
  // every other invented sub-resource — answered 200 with the whole employment.
  // A caller asking a question the API has no route for got a plausible answer
  // instead of the refusal that would have told it so.
  for (const path of [
    "/v1/employments/emp_active_001/custom_fields",
    "/v1/employments/emp_active_001/contracts",
    "/v1/employments/emp_active_001/anything-at-all",
  ]) {
    const { status, body } = await get(path);
    assert.equal(status, 404, `${path} must 404`);
    assert.equal(body.id, undefined, `${path} must not answer with an employment record`);
    assert.equal(body.data?.employment, undefined, `${path} must not answer with an employment record`);
  }
  assert.equal(LIVE_ENDPOINT_STATUSES["/v1/employments/{id}/custom_fields"], 404);
  assert.equal(LIVE_ENDPOINT_STATUSES["/v1/employments/{id}/custom-fields"], 200);
});

test("the mock's custom-field DEFINITIONS are the Sandbox's four, and none is invented", () => {
  assert.deepEqual(
    CUSTOM_FIELD_DEFINITIONS.map((f) => f.name).sort(),
    [...LIVE_CUSTOM_FIELD_DEFINITION_NAMES].sort()
  );
});

// ---------------------------------------------------------------------------
// 4. THE MOCK MAY SERVE A SUBSET OF THE API'S KEYS, NEVER A KEY IT INVENTED
// ---------------------------------------------------------------------------
// This is the asymmetry `src/remote/mockServer.js`'s COUNTRIES note states in
// prose and remoteShapeFidelity.test.js enforces for that one route. Extended
// here to the routes added from the 2026-08-19 capture. A missing key makes a
// consumer fail loudly against the mock and work in production; an invented one
// makes it pass against the mock and fail in production, which is strictly
// worse and is the direction every defect in CLAUDE.md §4 ran.

test("no route added from the capture serves a key the live payload does not have", async () => {
  const checks = [
    ["/v1/employments", (b) => b.data.employments[0], LIVE_EMPLOYMENT_LIST_ROW],
    ["/v1/contract-amendments", (b) => b.data.contract_amendments[0], LIVE_CONTRACT_AMENDMENT_ROW],
    [
      "/v1/employments/emp_active_001/custom-fields",
      (b) => b.data.custom_field_values[0],
      LIVE_EMPLOYMENT_CUSTOM_FIELDS.data.custom_field_values[0],
    ],
  ];
  for (const [path, pick, live] of checks) {
    const { body } = await get(path);
    const invented = sortedKeys(pick(body)).filter((k) => !(k in live));
    assert.deepEqual(invented, [], `${path} invents ${invented.join(", ")}`);
  }
});

test("every fixture the mock can serve survives the list projection", async () => {
  // Not a shape check — a coverage one. The list route projects every fixture,
  // so a fixture family that the projection cannot handle (the flat records and
  // the live-shaped ones are genuinely different objects) would throw here
  // rather than in whichever demo happened to list first.
  const { status, body } = await get("/v1/employments");
  assert.equal(status, 200);
  assert.equal(body.data.employments.length, Object.keys(EMPLOYMENTS).length);
  for (const row of body.data.employments) {
    assert.equal(typeof row.id, "string");
    assert.deepEqual(sortedKeys(row), sortedKeys(LIVE_EMPLOYMENT_LIST_ROW));
  }
});
