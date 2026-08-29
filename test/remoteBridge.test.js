// ---------------------------------------------------------------------------
// remoteBridge.test.js  —  the Sandbox stand-in must never overwrite real data
// ---------------------------------------------------------------------------
// The bridge's whole value rests on one promise: it fills fields the real API
// left EMPTY and touches nothing else. If that promise is not enforced by a
// test, a demo could silently present invented data as Sandbox data — which
// would be worse than having no demo at all.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichEmployment, remainingGaps } from "../src/remotebridge/enrichment.js";
import { createBridge } from "../src/remotebridge/server.js";

const PROFILES = {
  emp_demo: {
    basic_information: { start_date: "2023-06-26" },
    address_details: { address: "1 Demo Street", city: "Austin" },
    custom_fields: { workation_permission: true },
  },
};

test("fills only the fields the upstream record left empty", () => {
  const real = {
    id: "emp_demo",
    full_name: "Alex Morgan",
    basic_information: { name: "Alex Morgan", start_date: null },
    address_details: null,
    custom_fields: null,
  };
  const { employment, enriched } = enrichEmployment(real, PROFILES);

  assert.equal(employment.basic_information.start_date, "2023-06-26");
  assert.equal(employment.address_details.city, "Austin");
  assert.equal(employment.custom_fields.workation_permission, true);
  assert.deepEqual(
    enriched.sort(),
    ["address_details.address", "address_details.city", "basic_information.start_date", "custom_fields.workation_permission"].sort()
  );
});

test("NEVER overwrites a real value, even when a profile has one", () => {
  const real = {
    id: "emp_demo",
    basic_information: { start_date: "2019-01-01" }, // real data
    address_details: { address: "99 Real Road", city: "Dublin" },
    custom_fields: { workation_permission: false }, // real, and the opposite
  };
  const { employment, enriched } = enrichEmployment(real, PROFILES);

  assert.equal(employment.basic_information.start_date, "2019-01-01", "a real start date must survive");
  assert.equal(employment.address_details.address, "99 Real Road");
  assert.equal(employment.custom_fields.workation_permission, false, "a real false must not be replaced by a demo true");
  assert.deepEqual(enriched, [], "nothing was empty, so nothing may be reported as enriched");
});

test("does not mutate the caller's object", () => {
  const real = { id: "emp_demo", basic_information: { start_date: null } };
  const before = JSON.stringify(real);
  enrichEmployment(real, PROFILES);
  assert.equal(JSON.stringify(real), before, "the upstream record must be left untouched");
});

test("an employment with no profile passes through completely unchanged", () => {
  const real = { id: "emp_unknown", basic_information: { start_date: null } };
  const { employment, enriched, profileFound } = enrichEmployment(real, PROFILES);
  assert.equal(profileFound, false);
  assert.deepEqual(enriched, []);
  assert.equal(employment.basic_information.start_date, null, "no profile means no invention");
});

test("remainingGaps reports what is still empty after enrichment", () => {
  const { employment } = enrichEmployment({ id: "emp_unknown" }, PROFILES);
  const gaps = remainingGaps(employment);
  assert.ok(gaps.includes("basic_information.start_date"));
  assert.ok(gaps.includes("custom_fields"));
});

test("the bridge labels every enriched field on the response, and refuses writes", async () => {
  const upstreamBody = {
    data: {
      employment: {
        id: "emp_demo",
        full_name: "Alex Morgan",
        basic_information: { name: "Alex Morgan", start_date: null },
        address_details: null,
        custom_fields: null,
      },
    },
  };
  // Hermetic: the "upstream" is a function, so this test never touches a network.
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(upstreamBody),
  });

  const server = createBridge({ fetchImpl: fakeFetch, quiet: true, profiles: PROFILES });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/v1/employments/emp_demo`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("x-standin-enriched").includes("basic_information.start_date"));
    assert.ok(body._standin, "the response must carry a _standin block");
    assert.ok(body._standin.note.includes("EMPTY"), "the note must state what enrichment means");
    assert.ok(body._standin.enriched.length > 0);
    assert.equal(body.data.employment.basic_information.start_date, "2023-06-26");

    // A stand-in that accepted writes could fake a state change the real API
    // never saw — the one thing it must never be able to do.
    const write = await fetch(`${base}/v1/employments/emp_demo`, { method: "PATCH" });
    assert.equal(write.status, 405);
  } finally {
    server.close();
  }
});

test("an upstream failure is reported, never replaced with invented data", async () => {
  const failing = async () => { throw new Error("ECONNREFUSED"); };
  const server = createBridge({ fetchImpl: failing, quiet: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const res = await fetch(`${base}/v1/employments/emp_demo`);
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.error, "upstream_unreachable");
    assert.ok(!body.data, "a failed upstream call must not yield an employment record");
  } finally {
    server.close();
  }
});
