// ---------------------------------------------------------------------------
// remoteHolidays.test.js — the calendar that governs an employee is the UNION,
// and every single-call answer is wrong in a way nothing errors on
// ---------------------------------------------------------------------------
// THE DEFECT THIS PINS. `GET /v1/countries/{alpha3}/holidays/{year}` answers a
// different question depending on whether `country_subdivision_code` is
// present, and the two answers are DISJOINT sets:
//
//   CAN/holidays/2026                            -> 5 national days
//   CAN/holidays/2026?country_subdivision_code=CA-ON -> 4 Ontario-only days
//
// Ontario's real answer is the union: **9**. Neither call errors, both return
// a well-formed list, and whichever one a caller happens to make looks
// authoritative. Nothing in `src/` read holidays when this was found, which is
// the cheapest possible moment to fix it and the most dangerous moment to
// leave it — the first consumer picks one call and never learns.
//
// WHY THE POSITIVE TESTS ARE THE POINT. Every assertion in this file that
// matters names a NUMBER. A suite of refusals cannot tell a boundary that
// works from a boundary that is dead: "we could not read the calendar" is
// exactly what a broken path also says, which is the failure shape that hid
// UC-03's alpha-3 defect for the project's whole life. So Ontario must come
// back as 9 days, on the dates listed, or this file fails.
//
// PROVENANCE. Every count and date below was read from the live Sandbox on
// 2026-08-19 (`NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`,
// gateway.remote-sandbox.com) and the mock's fixture rows are copies of those
// same responses. The tests assert against BOTH so the mock cannot drift into
// agreeing with the code instead of with Remote.
//
// PORT 0 ON PURPOSE. This file claims no fixed port: the mock is started on an
// ephemeral port and its real one read back. `src/shared/ports.js` exists
// because 4xxx literals collided between files; a port the OS assigns cannot
// collide with anything, so there is nothing to register.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";
import { mergeHolidayCalendars, holidayDates, observedDate } from "../src/remote/holidays.js";

// --- live counts, 2026-08-19 ------------------------------------------------
// Read directly from gateway.remote-sandbox.com. They are the assertions'
// expected values, not documentation of them.
const LIVE = {
  CAN_NATIONAL: 5,
  CAN_ON: 4,
  CAN_QC: 3,
  CAN_BC: 6,
  USA_NATIONAL: 11, // the FEDERAL days
  USA_ANY_STATE: 0, // US-CA, US-NY, US-TX all answered 200 with zero rows
  NLD_NATIONAL: 11,
  GBR_NATIONAL: 6,
  GBR_SCT: 3,
};
const ONTARIO_UNION = LIVE.CAN_NATIONAL + LIVE.CAN_ON; // 9 — the number this file exists for

async function withMock(fn) {
  const server = await startMockServer(0);
  const { port } = server.address();
  const client = new RemoteClient({ baseUrl: `http://localhost:${port}` });
  try {
    return await fn(client, port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// The union — the positive tests
// ---------------------------------------------------------------------------

test("POSITIVE: an Ontario employee's 2026 calendar is 9 days — the union, not either call", async () => {
  await withMock(async (client) => {
    const result = await client.listHolidayCalendarResult({
      countryCode: "CAN",
      year: 2026,
      subdivisionCode: "CA-ON",
    });

    assert.equal(result.error, null, "a calendar that can be read must actually be read");
    assert.equal(result.holidays.length, ONTARIO_UNION);
    assert.equal(result.holidays.length, 9, "the number, stated: Ontario has 9 public holidays in 2026");
    assert.deepEqual(result.counts, { national: LIVE.CAN_NATIONAL, subdivision: LIVE.CAN_ON });

    // The specific days, so a regression that returns "9 of something" fails.
    assert.deepEqual(result.dates, [
      "2026-01-01", // New Year's Day        national
      "2026-02-16", // Family Day            Ontario only
      "2026-04-03", // Good Friday           national
      "2026-05-18", // Victoria Day          Ontario only
      "2026-07-01", // Canada Day            national
      "2026-09-07", // Labour Day            national
      "2026-10-12", // Thanksgiving          Ontario only
      "2026-12-25", // Christmas Day         national
      "2026-12-28", // Boxing Day, OBSERVED  Ontario only (day is the 26th)
    ]);
  });
});

test("the two calls are disjoint — neither is a subset of the other, so neither alone is the answer", async () => {
  await withMock(async (client) => {
    const national = await client.listHolidaysResult({ countryCode: "CAN", year: 2026 });
    const ontario = await client.listHolidaysResult({ countryCode: "CAN", year: 2026, subdivisionCode: "CA-ON" });

    assert.equal(national.holidays.length, LIVE.CAN_NATIONAL);
    assert.equal(ontario.holidays.length, LIVE.CAN_ON);

    const nationalDays = new Set(national.holidays.map((h) => h.day));
    const overlap = ontario.holidays.filter((h) => nationalDays.has(h.day));
    assert.deepEqual(overlap, [], "the subdivision list is additional days, never a filtered view");

    // And the consequence, named: each single call is short by the other's rows.
    assert.equal(national.holidays.length, ONTARIO_UNION - LIVE.CAN_ON, "the national call loses Family Day");
    assert.equal(ontario.holidays.length, ONTARIO_UNION - LIVE.CAN_NATIONAL, "the subdivision call loses Canada Day");
  });
});

test("the union rule is not a Canada quirk — Quebec, British Columbia and Scotland each union correctly", async () => {
  await withMock(async (client) => {
    const cases = [
      { countryCode: "CAN", subdivisionCode: "CA-QC", national: LIVE.CAN_NATIONAL, sub: LIVE.CAN_QC },
      { countryCode: "CAN", subdivisionCode: "CA-BC", national: LIVE.CAN_NATIONAL, sub: LIVE.CAN_BC },
      { countryCode: "GBR", subdivisionCode: "GB-SCT", national: LIVE.GBR_NATIONAL, sub: LIVE.GBR_SCT },
    ];
    for (const c of cases) {
      const result = await client.listHolidayCalendarResult({ ...c, year: 2026 });
      assert.equal(result.error, null, `${c.subdivisionCode} must resolve`);
      assert.equal(
        result.holidays.length,
        c.national + c.sub,
        `${c.subdivisionCode}: ${c.national} national + ${c.sub} subdivision = ${c.national + c.sub}`
      );
    }
  });
});

test("`observed_day` is what a day-counter must use, and this data exercises it", async () => {
  await withMock(async (client) => {
    const { holidays, dates } = await client.listHolidayCalendarResult({
      countryCode: "CAN",
      year: 2026,
      subdivisionCode: "CA-ON",
    });
    const boxingDay = holidays.find((h) => h.name === "Boxing Day");
    assert.equal(boxingDay.day, "2026-12-26");
    assert.equal(boxingDay.observed_day, "2026-12-28", "live: Ontario observes Boxing Day 2026 on the Monday");

    assert.ok(dates.includes("2026-12-28"), "the observed date is the one the employee does not work");
    assert.ok(!dates.includes("2026-12-26"), "reading `day` would put an employee back at work on a holiday");
  });
});

test("the United States: federal only — a state adds nothing, and that is a fact about Remote, not the state", async () => {
  await withMock(async (client) => {
    const federal = await client.listHolidayCalendarResult({ countryCode: "USA", year: 2026 });
    assert.equal(federal.holidays.length, LIVE.USA_NATIONAL);

    const california = await client.listHolidayCalendarResult({
      countryCode: "USA",
      year: 2026,
      subdivisionCode: "US-CA",
    });
    assert.equal(california.error, null, "a recognised subdivision with no rows is not a failure");
    assert.equal(california.counts.subdivision, LIVE.USA_ANY_STATE);
    assert.equal(california.holidays.length, LIVE.USA_NATIONAL, "the union of the federal days and nothing");

    // counts distinguishes "asked and got none" from "never asked".
    assert.equal(federal.counts.subdivision, null, "no subdivision was requested");
    assert.equal(california.counts.subdivision, 0, "a subdivision was requested and answered zero");
  });
});

// ---------------------------------------------------------------------------
// The failures — each one loud, none of them an empty list
// ---------------------------------------------------------------------------

test("an empty NATIONAL list is a reported failure, never an empty calendar", async () => {
  await withMock(async (client) => {
    // Live: NLD/holidays/2027 answers 200 {"data":[]} — a year Remote has not
    // populated, four months out. No country has zero public holidays.
    const result = await client.listHolidayCalendarResult({ countryCode: "NLD", year: 2027 });
    assert.equal(result.holidays, null);
    assert.equal(result.dates, null);
    assert.equal(result.error.kind, "unreachable");
    assert.equal(result.error.call, "holidays");
    assert.match(result.error.message, /empty national holiday list/);

    // The convenience wrapper must not soften it into [] either — that is the
    // `listPayrollRuns()` 404-coerced-to-`{payroll_runs: []}` defect exactly.
    assert.equal(await client.listHolidays({ countryCode: "NLD", year: 2027 }), null);

    // And the populated year still works, so this is not a dead path.
    const populated = await client.listHolidayCalendarResult({ countryCode: "NLD", year: 2026 });
    assert.equal(populated.holidays.length, LIVE.NLD_NATIONAL);
  });
});

test("a subdivision Remote rejects fails the WHOLE calendar — the national list is not a consolation prize", async () => {
  await withMock(async (client) => {
    const result = await client.listHolidayCalendarResult({
      countryCode: "CAN",
      year: 2026,
      subdivisionCode: "CA-ZZ", // live: 400 {"message":"Country Subdivision is invalid"}
    });
    assert.equal(result.holidays, null, "returning the 5 national days here is the wrong-and-looks-right answer");
    assert.equal(result.error.status, 400);
    assert.equal(result.error.kind, "unreachable", "a 400 says nothing about which days that employee has off");
    assert.equal(result.counts.national, LIVE.CAN_NATIONAL, "the leg that succeeded is still reported");
  });
});

test("an alpha-2 country code never silently becomes a calendar — the path is alpha-3 keyed", async () => {
  await withMock(async (client, port) => {
    // Live: /v1/countries/CA/holidays/2026 -> 404 {"message":"Country not found"}.
    const direct = await fetch(`http://localhost:${port}/v1/countries/CA/holidays/2026`);
    assert.equal(direct.status, 404);
    assert.deepEqual(await direct.json(), { message: "Country not found" }, "Remote's own message, verbatim");

    // WHAT THIS TEST IS ACTUALLY ABOUT, restated 2026-09-02 when Canada joined
    // the mock registry and broke the old version of it.
    //
    // It used to pass "CA" here and rely on Canada being ABSENT, so nothing
    // could resolve it. That conflated two different things: "the client must
    // not GUESS an alpha-3 from an alpha-2" and "this particular country
    // happens to be missing". Resolving CA -> CAN through the registry is a
    // LOOKUP, and it is the behaviour F-27 exists to provide. Both halves are
    // now asserted, so neither can be lost:
    //
    // (a) an alpha-2 the registry does NOT hold is refused before the wire —
    //     no guess, no request. Japan is the fixture (see mockServer.js).
    const unknown = await client.listHolidayCalendarResult({ countryCode: "JP", year: 2026 });
    assert.equal(unknown.holidays, null, "an unresolvable alpha-2 produced a calendar");
    assert.match(unknown.error.message, /never requested/);

    // (b) an alpha-2 the registry DOES hold resolves and is served. Without
    //     this the test would pass just as well against a client that refused
    //     every alpha-2 — which is failing closed by never working, and is not
    //     what "the path is alpha-3 keyed" means.
    const resolved = await client.listHolidayCalendarResult({ countryCode: "CA", year: 2026 });
    assert.ok(Array.isArray(resolved.holidays), "CA no longer resolves through the registry to CAN");
    assert.equal(resolved.error, null);
    assert.ok(resolved.holidays.length > 0, "the resolved calendar came back empty");
  });
});

test("a year, a subdivision or a country the client cannot use is refused BEFORE any request", async () => {
  const attempted = [];
  const client = new RemoteClient({
    baseUrl: "http://localhost:1",
    fetchImpl: async (url) => {
      attempted.push(url);
      throw new Error("this request should never have been made");
    },
  });

  const bad = [
    { countryCode: "CAN", year: "not-a-year" },
    { countryCode: "CAN", year: 26 },
    { countryCode: 42, year: 2026 },
    { countryCode: "CAN", year: 2026, subdivisionCode: "" },
    { countryCode: "CAN", year: 2026, subdivisionCode: 7 },
  ];
  for (const args of bad) {
    const result = await client.listHolidayCalendarResult(args);
    assert.equal(result.holidays, null, JSON.stringify(args));
    assert.equal(result.error.kind, "unreachable");
    assert.match(result.error.message, /never requested/);
  }
  assert.deepEqual(attempted, [], "nothing unusable is guessed at over the wire");
});

test("an unreachable API is an upstream failure, not a quiet empty calendar", async () => {
  const client = new RemoteClient({
    baseUrl: "http://localhost:1",
    retries: 1,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  const result = await client.listHolidayCalendarResult({ countryCode: "CAN", year: 2026 });
  assert.equal(result.holidays, null);
  assert.equal(result.error.kind, "unreachable");
  assert.equal(await client.listHolidays({ countryCode: "CAN", year: 2026 }), null);
});

test("a 404 from Remote is `not_found`, and it is a different fact from unreachable", async () => {
  const client = new RemoteClient({
    baseUrl: "http://localhost:1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: "Country not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
  });
  const result = await client.listHolidaysResult({ countryCode: "ZZZ", year: 2026 });
  assert.equal(result.holidays, null);
  assert.equal(result.error.kind, "not_found");
  assert.equal(result.error.status, 404);
});

test("an envelope this endpoint does not send is an unread calendar, not an empty one", async () => {
  const client = new RemoteClient({
    baseUrl: "http://localhost:1",
    fetchImpl: async () =>
      new Response(JSON.stringify({ data: { holidays: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  // Live, the array sits DIRECTLY under `data`. A `{data:{holidays:[]}}` shape
  // is the mock-invented-envelope mistake this repo has already paid for once.
  const result = await client.listHolidaysResult({ countryCode: "CAN", year: 2026 });
  assert.equal(result.holidays, null);
  assert.match(result.error.message, /shape this endpoint does not send/);
});

// ---------------------------------------------------------------------------
// The mock must answer what Remote answers
// ---------------------------------------------------------------------------

test("the mock reproduces all four live behaviours, including the two that are not errors", async () => {
  await withMock(async (_client, port) => {
    const get = async (path) => {
      const res = await fetch(`http://localhost:${port}${path}`);
      return { status: res.status, body: await res.json() };
    };

    const national = await get("/v1/countries/CAN/holidays/2026");
    assert.equal(national.status, 200);
    assert.ok(Array.isArray(national.body.data), "the array sits DIRECTLY under `data` — no `holidays` key");
    assert.equal(national.body.data.length, LIVE.CAN_NATIONAL);

    const ontario = await get("/v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ON");
    assert.equal(ontario.body.data.length, LIVE.CAN_ON);

    const badYear = await get("/v1/countries/CAN/holidays/notayear");
    assert.equal(badYear.status, 400);
    assert.deepEqual(badYear.body, { message: "Year is invalid" });

    const badSubdivision = await get("/v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ZZ");
    assert.equal(badSubdivision.status, 400);
    assert.deepEqual(badSubdivision.body, { message: "Country Subdivision is invalid" });

    // The two 200s that are not errors and are not the same thing.
    const unpopulatedYear = await get("/v1/countries/NLD/holidays/2027");
    assert.equal(unpopulatedYear.status, 200);
    assert.deepEqual(unpopulatedYear.body.data, []);

    const stateWithNoDays = await get("/v1/countries/USA/holidays/2026?country_subdivision_code=US-CA");
    assert.equal(stateWithNoDays.status, 200, "a RECOGNISED subdivision with no days is a 200, not a 400");
    assert.deepEqual(stateWithNoDays.body.data, []);
  });
});

test("every mock holiday row carries exactly the four keys the live rows carry", async () => {
  await withMock(async (_client, port) => {
    for (const path of [
      "/v1/countries/CAN/holidays/2026",
      "/v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ON",
      "/v1/countries/USA/holidays/2026",
      "/v1/countries/GBR/holidays/2026?country_subdivision_code=GB-SCT",
    ]) {
      const rows = (await (await fetch(`http://localhost:${port}${path}`)).json()).data;
      assert.ok(rows.length > 0, path);
      for (const row of rows) {
        assert.deepEqual(Object.keys(row).sort(), ["day", "name", "note", "observed_day"], `${path}: ${row.name}`);
        assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

test("mergeHolidayCalendars de-duplicates a row present in both lists, and keeps two names on one day", () => {
  const shared = { day: "2026-01-01", name: "New Year's Day", note: null, observed_day: "2026-01-01" };
  const merged = mergeHolidayCalendars([shared], [{ ...shared }, { day: "2026-01-01", name: "Regional Feast" }]);
  assert.equal(merged.length, 2, "one row twice counts once; two different holidays on one day both count");
  assert.deepEqual(holidayDates(merged), ["2026-01-01"], "…but they cost ONE working day, not two");
});

test("holidayDates is sorted, unique, and applies `observed_day ?? day` — null means the day itself", () => {
  const dates = holidayDates([
    { day: "2026-12-26", name: "Boxing Day", observed_day: "2026-12-28" },
    { day: "2026-01-01", name: "New Year", observed_day: null },
    { day: "2026-01-01", name: "New Year (again)", observed_day: null },
  ]);
  assert.deepEqual(dates, ["2026-01-01", "2026-12-28"]);
  assert.equal(observedDate({ day: "2026-05-01", observed_day: null }), "2026-05-01");
  assert.equal(observedDate(null), null);
});
