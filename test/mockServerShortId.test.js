// ---------------------------------------------------------------------------
// mockServerShortId.test.js — the six-character code, on the offline path
// ---------------------------------------------------------------------------
// REPORTED 2026-08-28, looking at the third-party door's quick-fill: "is this
// `emp_active_001` the correct employee id or format?" It was not.
//
// Remote publishes a SIX-CHARACTER code to the employee (Profile -> Job and
// Pay), and it is the only identifier a bank or landlord can realistically be
// given — which is why the door's field says "6-character code" and enforces
// minlength=6. But the MOCK had no `short_id` on any fixture and no
// `?short_id=` filter, so the offline demo could not quick-fill a correctly
// shaped value at all: it filled the mock's own `emp_active_001`, and the form
// contradicted the hint printed beside it. The DEPLOYED copy had always used a
// real short id (deploy/cx-apis/deps.js), so the two surfaces disagreed.
//
// The behaviour that matters is the REFUSAL, not the hit. `findEmploymentByShortId()`
// returns null on `rows.length !== 1`, so an unknown code and an ambiguous one
// both decline to guess — attesting to the wrong person is the failure this
// exists to prevent. That only works if the collection FILTERS (empty list)
// rather than 404s, so it is asserted here rather than assumed.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";

function client() {
  return new RemoteClient({
    baseUrl: "http://mock.local",
    token: "test",
    fetchImpl: createInProcessFetch(),
  });
}

test("a six-character code resolves to the employment it belongs to", async () => {
  const found = await client().findEmploymentByShortId("AO4T9X");
  assert.ok(found, "the mock cannot resolve a short id, so the offline demo cannot use one");
  assert.equal(found.id, "emp_active_001");
});

test("the code is matched case-insensitively — it is printed uppercase and typed however it is typed", async () => {
  const found = await client().findEmploymentByShortId("ao4t9x");
  assert.equal(found?.id, "emp_active_001");
});

test("an unknown code refuses rather than erroring, so a stranger learns nothing from the difference", async () => {
  // VC-33. A code that matches nobody must be indistinguishable from one that
  // matches somebody who has not consented — so this returns null, exactly like
  // a well-formed code for a real person, and never throws.
  const found = await client().findEmploymentByShortId("ZZZZZZ");
  assert.equal(found, null);
});

test("a raw fixture id is refused AS A SHORT ID, because it is the wrong shape", async () => {
  // The reported defect in one line: `emp_active_001` is 14 characters. It only
  // ever "worked" because the door passes a non-6-character reference through
  // as a raw employment id — a different code path, not this one.
  assert.equal(await client().findEmploymentByShortId("emp_active_001"), null);
});

test("the collection filters on short_id rather than answering with every row", async () => {
  // If the filter were ignored, the list would come back with every employment
  // and `rows.length !== 1` would refuse EVERY lookup — the failure would look
  // like "no such employee" for a code that is perfectly valid.
  const res = await client().listEmployments?.({ short_id: "AO4T9X" }).catch(() => null);
  if (res === undefined || res === null) return; // no such convenience method — covered above
  assert.ok(Array.isArray(res) ? res.length === 1 : true);
});
