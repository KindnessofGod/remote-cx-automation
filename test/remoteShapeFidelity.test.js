// ---------------------------------------------------------------------------
// remoteShapeFidelity.test.js — the code and the fixtures must agree with the
// API, not with each other
// ---------------------------------------------------------------------------
// THE CLASS OF DEFECT THIS FILE EXISTS FOR
//
// UC-03's supported-countries gate was dead for the whole life of the project
// (finding F-25): `listCountries()` mapped `c.country_code ?? c.code`, the live
// API sends neither as an alpha-2 value, and every membership test against a
// 2-letter destination was false. It survived every test run because the mock
// server served `{data:{countries:[{country_code:"ES", …}]}}` — an envelope and
// a row shape no Remote endpoint has ever returned. The fixture agreed with the
// code, so the suite could not fail when the code was wrong about the API.
//
// Three defects of that same class are pinned here:
//
//   1. THE MOCK ITSELF. `src/remote/mockServer.js` now serves the REAL
//      `GET /v1/countries` envelope and row shape. These tests read the mock's
//      raw HTTP response — deliberately NOT through RemoteClient, because
//      RemoteClient is the thing whose tolerance hid the problem — and assert
//      it against the live-captured fixture's own shape.
//
//   2. normalizeEmployment()'s LATENT ALPHA-3 FALLBACK. `raw.country?.
//      alpha_2_code ?? raw.country?.code` silently yields "DEU"/"CAN" into
//      `employment.country_code` whenever alpha_2_code is absent — a field only
//      ever compared against 2-letter values in UC-05, UC-06 and UC-09.
//
//   3. listPayrollRuns()'s SWALLOWED 404. `result ?? {payroll_runs: []}` made a
//      failed fetch indistinguishable from an empty calendar, so UC-06's
//      `no_matching_payroll_cycle` could fire for either reason and the
//      `payroll_runs` upstream gate that already exists in its policy engine
//      was unreachable from the Node path.
//
// EVERY SECTION CARRIES A POSITIVE TEST, not only fail-closed ones. That is the
// methodological lesson of F-25: every fail-closed assertion passed before the
// fix too, because a path that structurally cannot succeed is observationally
// identical to one being appropriately cautious. Only "this input MUST reach
// the successful outcome" can tell them apart.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { RemoteClient, normalizeEmployment, countryRowToAlpha2 } from "../src/remote/restClient.js";
import { startMockServer, COUNTRIES, PAYROLL_RUNS } from "../src/remote/mockServer.js";
import { LIVE_COUNTRY_ROWS } from "./fixtures/remoteCountries.js";
import { LIVE_EMPLOYMENT_CA, LIVE_EMPLOYMENT_DE, withoutAlpha2 } from "./fixtures/remoteEmployment.js";
import { evaluate as evaluateUc05 } from "../src/uc05/policyEngine.js";
import { assessRisk } from "../src/uc09/policyEngine.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
// Rule-based on purpose: UC-03's classifier is an LLM call site, and an
// un-injected one turns these tests into real network failures (CLAUDE.md §6).
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
// Injected with `isConfigured: () => false` at every call site below — the
// repo-wide seam that keeps the suite hermetic (CLAUDE.md §6: this devcontainer
// carries a genuine but unreachable OPENAI_API_KEY, so an un-injected LLM call
// site turns a 1ms test into an 11s network failure).
import { draftSummary as draftSummaryReal } from "../src/uc06/changeParser.js";

// PORT 0 MEANS "THE OS PICKS A FREE ONE", and it is the only way to make this
// robust. A fixed port here failed the whole file with EADDRINUSE the moment
// anything else on the machine held it — which really happened: an unrelated
// scratch process squatted 4098 and twelve tests reported failure while the
// code under test was perfectly fine. A red suite that says nothing about the
// code is worse than a slow one; it trains you to skim failures.
//
// `test/ports.test.js` enforces that no CLI hard-codes a port and that internal
// mocks stay in their reserved band, but it cannot check intra-band uniqueness
// against processes it has never heard of. Not needing a number at all removes
// the question rather than answering it.
const EPHEMERAL = 0;

/** Run `fn` with a mock Remote server listening, then close it. */
async function withMock(fn) {
  const server = await startMockServer(EPHEMERAL);
  try {
    return await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

/** Run `fn` against a one-route stub answering `status`/`body` for any request. */
async function withStub(routes, fn) {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const hit = routes[path] ?? routes["*"] ?? { status: 404, body: "Not Found" };
    // A body may be a function of the full URL, so a stub can answer a paginated
    // endpoint differently per page — required to exercise listPayrollRuns()'s
    // walk without the stub feeding it the same page forever.
    const body = typeof hit.body === "function" ? hit.body(req.url) : hit.body;
    res.writeHead(hit.status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(EPHEMERAL, resolve));
  try {
    return await fn(`http://localhost:${server.address().port}`);
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
// 1. The mock server must not teach a shape the real API never sends
// ---------------------------------------------------------------------------

test("mock GET /v1/countries: the array sits DIRECTLY under `data`, exactly as live", async () => {
  await withMock(async (baseUrl) => {
    const body = await (await fetch(`${baseUrl}/v1/countries`)).json();
    assert.ok(Array.isArray(body.data), "live shape is {data: [...]}, not {data: {countries: [...]}}");
    assert.equal(body.data.countries, undefined, "`data.countries` is the mock's old invention — it must be gone");
  });
});

test("mock GET /v1/countries: no row carries `country_code` — that field does not exist on the real API", async () => {
  // The single assertion that would have caught F-25 at the fixture layer. A
  // row with `country_code` on it makes `listCountries()` look correct while
  // production reads a shape that has never had that key.
  await withMock(async (baseUrl) => {
    const { data } = await (await fetch(`${baseUrl}/v1/countries`)).json();
    for (const row of data) {
      assert.equal("country_code" in row, false, `row ${row.name} still carries the invented country_code field`);
    }
  });
});

test("mock GET /v1/countries: `code` is ALPHA-3 and `alpha_2_code` is alpha-2, per row", async () => {
  await withMock(async (baseUrl) => {
    const { data } = await (await fetch(`${baseUrl}/v1/countries`)).json();
    assert.ok(data.length > 0);
    for (const row of data) {
      assert.match(row.code, /^[A-Z]{3}$/, `row ${row.name}: \`code\` must be the alpha-3 form the live API sends`);
      assert.match(row.alpha_2_code, /^[A-Z]{2}$/, `row ${row.name}: \`alpha_2_code\` must be the alpha-2 form`);
      assert.equal(typeof row.name, "string");
      assert.equal(typeof row.eor_onboarding, "boolean");
    }
  });
});

test("mock GET /v1/countries: every field a mock row uses is a field the LIVE response actually sends", async () => {
  // Structural, not spot-check: the mock may serve a SUBSET of the live keys
  // (it is a mock), but never a key the live API has never sent. That is the
  // exact direction F-25 drifted in.
  const liveKeys = new Set(LIVE_COUNTRY_ROWS.flatMap((r) => Object.keys(r)));
  await withMock(async (baseUrl) => {
    const { data } = await (await fetch(`${baseUrl}/v1/countries`)).json();
    for (const row of data) {
      for (const key of Object.keys(row)) {
        assert.ok(liveKeys.has(key), `mock row ${row.name} invents the field \`${key}\``);
      }
    }
  });
});

test("mock GET /v1/countries: the list is NOT all-EOR — `in the list` and `eor_onboarding` stay distinguishable", async () => {
  // A SEPARATE DEFECT OF THE SAME CLASS, and the reason the mock's row count is
  // not just "15 countries we happened to pick". Live, 91 of 224 rows carry
  // `eor_onboarding: true` and 133 do not. The mock's list was composed
  // entirely of EOR countries, which made two genuinely different gates —
  // "is this country in the supported list" and "does it have eor_onboarding" —
  // produce identical results in every offline test, demo and playground run.
  //
  // That matters because the tightening is WRONG and nothing would have caught
  // it: Martinique (`MTQ`/`MQ`, eor_onboarding false) is an overseas department
  // of France, so a French employee travelling there is travelling domestically;
  // Montenegro and the Bahamas are mainstream workation destinations. UC-03's
  // gate means "present in the list", and this fixture is what keeps a future
  // change to that meaning visible instead of silent. See
  // docs/research/COUNTRY-SUPPORT-SEMANTICS.md for the product question itself.
  await withMock(async (baseUrl) => {
    const { data } = await (await fetch(`${baseUrl}/v1/countries`)).json();
    const nonEor = data.filter((r) => r.eor_onboarding === false);
    assert.ok(nonEor.length > 0, "a list where every row is an EOR country cannot distinguish the two gates");
    const codes = new Set(nonEor.map((r) => r.alpha_2_code));
    assert.ok(codes.has("MQ"), "Martinique — the case where the tightening is affirmatively wrong");
  });
});

test("mock GET /v1/countries: `contractor_products_available` is an ARRAY, and an empty one is present", async () => {
  // Live it is always an array (`["standard","plus","cor"]`), and 13 of the 224
  // rows carry `[]`. An empty array is TRUTHY, so `if (row.contractor_products_
  // available)` reports "contractor products available" for exactly the
  // countries that have none. No code in src/ or workflows/ reads this field
  // today — but a mock that emitted it as a boolean, or omitted the empty case,
  // would let the first consumer to read it inherit that bug invisibly. So the
  // real shape is served, including the row where it is empty.
  await withMock(async (baseUrl) => {
    const { data } = await (await fetch(`${baseUrl}/v1/countries`)).json();
    for (const row of data) {
      assert.ok(Array.isArray(row.contractor_products_available), `row ${row.name}: array, never a boolean`);
    }
    const empty = data.filter((r) => r.contractor_products_available.length === 0);
    assert.ok(empty.length > 0, "the truthy-empty-array trap must be reproducible offline");
    assert.ok(Boolean(empty[0].contractor_products_available), "…and this is why: [] is truthy");
  });
});

test("POSITIVE — listCountries() over the faithful mock still yields alpha-2 codes UC-03 can match", async () => {
  // The direction a purely negative suite cannot see. Making the mock faithful
  // is only a fix if the supported set still RESOLVES: Spain must come back as
  // "ES", so a Spain workation can reach auto_resolve.
  await withMock(async (baseUrl) => {
    const rows = await new RemoteClient({ baseUrl }).listCountries();
    const codes = new Set(rows.map((r) => r.country_code));
    assert.ok(codes.has("ES"), "Spain must resolve to ES — the exact case F-25 got wrong");
    assert.ok(codes.has("DE") && codes.has("PT") && codes.has("NG"));
    assert.equal(rows.length, COUNTRIES.length, "no row is lost in the mapping");
    for (const row of rows) assert.match(row.country_code, /^[A-Z]{2}$/);
    const spain = rows.find((r) => r.name === "Spain");
    assert.equal(spain.country_code, "ES");
  });
});

test("the mock's own rows resolve through the SAME normaliser the live rows do", async () => {
  for (const row of COUNTRIES) {
    assert.equal(countryRowToAlpha2(row), row.alpha_2_code, `mock row ${row.name}`);
  }
});

// ---------------------------------------------------------------------------
// 2. normalizeEmployment() — the alpha-3 value must never reach country_code
// ---------------------------------------------------------------------------

test("POSITIVE — a real employment record yields its ALPHA-2 country code", async () => {
  assert.equal(LIVE_EMPLOYMENT_DE.country.code, "DEU", "fixture really is the live shape: `code` is alpha-3");
  assert.equal(normalizeEmployment(LIVE_EMPLOYMENT_DE).country_code, "DE");
  assert.equal(normalizeEmployment(LIVE_EMPLOYMENT_CA).country_code, "CA");
});

test("an employment whose country offers ONLY an alpha-3 code yields null, never \"DEU\"", () => {
  // The whole defect in one line. The old chain returned "DEU" here, which then
  // compared false against every 2-letter key in UC-05/06/09 — silently,
  // forever, and looking exactly like caution.
  const stripped = withoutAlpha2(LIVE_EMPLOYMENT_DE);
  assert.equal(stripped.country.alpha_2_code, undefined);
  assert.equal(stripped.country.code, "DEU");
  assert.equal(normalizeEmployment(stripped).country_code, null);
});

test("normalizeEmployment: the country code is SHAPE-checked, not merely present", () => {
  const cases = [
    [{ id: "e", country: { code: "CAN" } }, null, "alpha-3 only"],
    [{ id: "e", country: { alpha_2_code: "deu" } }, null, "3 letters, wrong case, still 3 letters"],
    [{ id: "e", country: { alpha_2_code: "D" } }, null, "one letter"],
    [{ id: "e", country: { alpha_2_code: "D1" } }, null, "not both letters"],
    [{ id: "e", country: { alpha_2_code: 49 } }, null, "not a string"],
    [{ id: "e", country: null }, null, "no country block at all"],
    [{ id: "e" }, null, "no country key at all"],
    [{ id: "e", country: { alpha_2_code: " de " }, }, "DE", "normalised, not rejected"],
    [{ id: "e", country_code: "pl" }, "PL", "a flat top-level code is still accepted and normalised"],
  ];
  for (const [raw, expected, why] of cases) {
    assert.equal(normalizeEmployment(raw).country_code, expected, why);
  }
});

test("normalizeEmployment: the mock's flat shape is still passed through untouched", () => {
  // The early-return branch for the mock's own records must not regress — it is
  // what every offline test in the repo runs on.
  const flat = { id: "emp_active_001", contract_type: "full_time", start_date: "2022-03-01", country_code: "NG" };
  assert.deepEqual(normalizeEmployment(flat), flat);
});

// --- what each consuming gate does with a NULL country code ----------------
// Dropping the unusable value is only the right call if every consumer treats
// null as "not confirmed" rather than as "fine". These three tests are that
// check, run against the real policy engines rather than asserted in a comment.

test("null country_code — UC-05's statutory notice gate escalates, it does not guess a rule", () => {
  const employment = { ...normalizeEmployment(withoutAlpha2(LIVE_EMPLOYMENT_DE)), start_date: "2020-01-15" };
  assert.equal(employment.country_code, null);
  const r = evaluateUc05({
    identityVerified: true,
    employment,
    proposedEndDate: "2026-12-01",
    ptoBalanceDays: 0,
    now: "2026-08-17T00:00:00Z",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "unsupported_country");
  assert.ok(r.flags.includes("country_unknown"), `flags were ${JSON.stringify(r.flags)}`);
});

test("POSITIVE — with the alpha-2 code present, UC-05 reaches its ordinary sign-off path", () => {
  // The pair to the test above. Germany IS in the 9-country notice table, so
  // the fix has to make the same record produce a real notice calculation —
  // otherwise "escalates on null" is indistinguishable from "escalates always".
  const employment = { ...normalizeEmployment(LIVE_EMPLOYMENT_DE), start_date: "2020-01-15" };
  assert.equal(employment.country_code, "DE");
  const r = evaluateUc05({
    identityVerified: true,
    employment,
    proposedEndDate: "2026-12-01",
    ptoBalanceDays: 0,
    now: "2026-08-17T00:00:00Z",
  });
  assert.notEqual(r.reason, "unsupported_country", "DE is in the notice table — it must not escalate as unsupported");
  assert.equal(r.notice.countryCode, "DE");
  assert.ok(r.notice.noticeEndDate, "a real statutory notice end date was computed");
});

test("POSITIVE — UC-09's high-tax-complexity floor of 3 approvers actually fires for a German employee", () => {
  // This gate has NEVER fired against a real Remote record: `["DE","FR","IT"].
  // includes("DEU")` is false, so a German off-cycle payroll adjustment got the
  // ordinary two approvers instead of three. The floor of 2 held, so nothing
  // ever looked broken — the money control just quietly under-applied.
  const employment = normalizeEmployment(LIVE_EMPLOYMENT_DE);
  const risk = assessRisk({ type: "bonus", amount: 100000, currency: "EUR" }, employment);
  assert.ok(risk.flags.includes("high_tax_compliance_risk"), `flags were ${JSON.stringify(risk.flags)}`);
  assert.ok(risk.minApprovalSlots >= 3);

  // …and the alpha-3 form must NOT satisfy it, so the flag can never be
  // reintroduced by a stringly-typed "fix".
  const alpha3 = assessRisk({ type: "bonus", amount: 100000, currency: "EUR" }, { ...employment, country_code: "DEU" });
  assert.equal(alpha3.flags.includes("high_tax_compliance_risk"), false);
});

test("null country_code — UC-06's per-country schema lookup cannot be satisfied, so it escalates", async () => {
  // UC-06 reads the schema at `/v1/contract-amendments/schema?country_code=…`.
  // A null code cannot name a country, the endpoint 404s, and getCountrySchema()
  // returns null — which policyEngine.js turns into `country_schema_unavailable`
  // (finding F-15). Asserted against the real mock route, not a stub.
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    assert.equal(await remote.getCountrySchema(null), null);
    // The live `employment_basic_information` form, captured verbatim
    // 2026-08-18 — NOT the invented `{job_title, weekly_hours}` pair this
    // assertion used to pin. UC-06 no longer validates against this form (it
    // has no salary and no hours property, and its write refuses `active`
    // employments); the axis behaviour it demonstrates is unchanged.
    const de = await remote.getCountrySchema("DE");
    assert.equal(de.additionalProperties, false);
    assert.ok(de.required.includes("provisional_start_date"));
    // Same null rule on the form UC-06 DOES use.
    assert.equal(await remote.getContractAmendmentSchema("emp_nl_amend_001", null), null);
  });
});

// ---------------------------------------------------------------------------
// 3. listPayrollRuns() — the right URL, the whole calendar, the right country
// ---------------------------------------------------------------------------
// This method carried the same defect class as the alpha-3 country list, but at
// the URL: it called `/v1/company-payroll-runs`, a path Remote does not have,
// and the mock implemented that path too — so fixture and code agreed and
// neither agreed with the API. Remote's own index names this operation "List
// Company Payroll Runs" with reference id `get_v1_payroll-runs`; the title was
// mistaken for the path.
//
// Verified live 2026-08-18 (gateway.remote-sandbox.com, this container's token):
//   /v1/company-payroll-runs[?company_id=…] -> 404 "Not Found"  (every id)
//   /v1/payroll-runs                        -> 200, 17 real cycles
//   /v1/payroll-runs?company_id=…           -> 422 Unexpected field
//   /v1/payroll-runs?country_code=CA|CAN    -> 422 Unexpected field
//   /v1/payroll-runs?page_size=100          -> 34 rows / 17 unique ids,
//                                              total_count 17, total_pages 1
//   /v1/payroll-runs?page=2                 -> 14 MORE rows despite total_pages 1

test("listPayrollRuns: a 404 returns null — distinguishable from a genuinely empty calendar", async () => {
  // "This company has no cycle" and "we never got a calendar" are opposite
  // claims. Conflated, both leave evaluateCutoff() as `no_matching_payroll_cycle`
  // — a fact about the company, invented from the absence of an answer.
  await withStub({ "*": { status: 404, body: "Not Found" } }, async (baseUrl) => {
    const runs = await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" });
    assert.equal(runs, null, "a 404 must be reported as null, the same convention getEmployment() uses");
  });
});

test("listPayrollRuns: a genuinely empty calendar is still an empty calendar, not null", async () => {
  await withStub(
    { "/v1/payroll-runs": { status: 200, body: { data: { total_count: 0, total_pages: 1, payroll_runs: [] } } } },
    async (baseUrl) => {
      const runs = await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" });
      assert.deepEqual(runs, { payroll_runs: [] });
    }
  );
});

test("listPayrollRuns: a non-404 failure still THROWS rather than answering with an empty calendar", async () => {
  await withStub({ "*": { status: 403, body: { error: "forbidden" } } }, async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl, backoff: async () => {} });
    await assert.rejects(() => remote.listPayrollRuns({ countryCode: "NG" }), /payroll-runs.*403/s);
  });
});

test("POSITIVE — listPayrollRuns over the mock returns the real cycles UC-06 needs", async () => {
  // The half no fail-closed assertion can see. Every refusal test above passed
  // for the whole life of the wrong URL, because a path that 404s and a gate
  // that is being careful are the same observation from outside.
  await withMock(async (baseUrl) => {
    const runs = await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" });
    const expected = PAYROLL_RUNS.filter((r) => r.country.alpha_2_code === "NG");
    assert.equal(runs.payroll_runs.length, expected.length);
    assert.ok(expected.length > 0, "the fixture must actually contain cycles, or this proves nothing");
    assert.ok(runs.payroll_runs.every((r) => typeof r.cutoff_date === "string"));
  });
});

test("POSITIVE — the country filter picks THAT country's cutoff, not whichever cycle sorts first", async () => {
  // The reason repointing the URL was not enough on its own. The live calendar
  // is company-wide and multi-country (SG, FR, CA, NL, US) with 49 overlapping
  // period pairs, and evaluateCutoff() takes the FIRST cycle covering the date.
  // Unfiltered, a German amendment would have been locked to Nigeria's 10 June
  // cutoff. Both directions are asserted, because a filter that returns the
  // same list for every country would satisfy either one alone.
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    const june = (cycles) => cycles.payroll_runs.find((r) => r.period_start === "2026-06-01");

    const ng = june(await remote.listPayrollRuns({ countryCode: "NG" }));
    const de = june(await remote.listPayrollRuns({ countryCode: "DE" }));

    assert.equal(ng.cutoff_date, "2026-06-10", "Nigeria's June lock");
    assert.equal(de.cutoff_date, "2026-06-20", "Germany's June lock — a different date for the same period");
    assert.notEqual(ng.cutoff_date, de.cutoff_date, "if these ever match, this test has stopped proving anything");
  });
});

test("listPayrollRuns: a country it cannot use yields null — never the unfiltered calendar", async () => {
  // Fails closed on the axis that matters. Returning every country's cycles
  // when the country is unknown would be the worst available answer: a
  // confident cutoff drawn from an arbitrary jurisdiction. Null is what every
  // caller already escalates on.
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    for (const bad of [undefined, null, "", "N", "NGA", 42, {}]) {
      assert.equal(await remote.listPayrollRuns({ countryCode: bad }), null, `countryCode ${JSON.stringify(bad)}`);
    }
    assert.equal(await remote.listPayrollRuns(), null, "no argument at all");
    // The legacy positional company-id call (what src/uc06/workflow.js passed
    // for months). The API has no company parameter, so there is nothing to
    // honour — it must fail closed rather than silently return every country.
    assert.equal(await remote.listPayrollRuns("co_amend_01"), null, "legacy positional company id");
  });
});

test("listPayrollRuns: walks past a LYING total_pages instead of trusting it", async () => {
  // Live, `total_pages` reports 1 while page 2 still returns 14 rows. A client
  // that stopped on total_pages would read a truncated calendar, and a missing
  // cycle reads downstream as "no cycle governs this date" — a positive claim
  // manufactured by a short read.
  const page2Only = { id: "run_p2", country: { alpha_2_code: "NG" }, cutoff_date: "2026-09-10" };
  await withStub(
    {
      "/v1/payroll-runs": {
        status: 200,
        body: (url) => {
          const page = Number(new URL(url, "http://x").searchParams.get("page"));
          const rows = page === 1 ? [{ id: "run_p1", country: { alpha_2_code: "NG" }, cutoff_date: "2026-08-10" }] : page === 2 ? [page2Only] : [];
          return { data: { total_count: 1, current_page: page, total_pages: 1, payroll_runs: rows } };
        },
      },
    },
    async (baseUrl) => {
      const runs = await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" });
      assert.equal(runs.payroll_runs.length, 2, "the page-2 cycle must not be lost to total_pages: 1");
      assert.ok(runs.payroll_runs.some((r) => r.id === "run_p2"));
    }
  );
});

test("listPayrollRuns: repeated rows are ONE cycle, not two", async () => {
  // Live, a full walk returns 34 rows for 17 distinct ids. Two copies of a
  // cycle are a transport artifact; counted as two they would misreport the
  // calendar to anything that measures it.
  await withMock(async (baseUrl) => {
    const runs = await new RemoteClient({ baseUrl }).listPayrollRuns({ countryCode: "NG" });
    const ids = runs.payroll_runs.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate cycle ids: ${ids.join(",")}`);
  });
});

test("mock GET /v1/payroll-runs: refuses the filters the live API refuses", async () => {
  // Load-bearing. These 422s are the evidence that the country filter HAS to be
  // client-side; without them someone would "fix" the multi-country calendar by
  // adding a query parameter Remote does not have, and the mock would happily
  // agree with them — which is precisely how this defect happened the first time.
  await withMock(async (baseUrl) => {
    for (const field of ["company_id", "country_code", "country", "status"]) {
      const res = await fetch(`${baseUrl}/v1/payroll-runs?${field}=x`);
      assert.equal(res.status, 422, `?${field} must be refused, exactly as live`);
      const body = await res.json();
      assert.deepEqual(body.errors[field], ["Unexpected field"]);
    }
  });
});

test("mock GET /v1/company-payroll-runs: the invented path is GONE, and 404s like any unknown route", async () => {
  // The regression guard. If this route ever answers 200 again, the fixture has
  // resumed agreeing with a client instead of with Remote.
  await withMock(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/company-payroll-runs?company_id=co_amend_01`);
    assert.equal(res.status, 404);
  });
});

// --- and what UC-06 now records, end to end --------------------------------
// Changing a shared client's contract is only safe if the caller that depends
// on it still fails closed. These two run the REAL workflow against the REAL
// mock — the whole 404 -> null -> upstream-failure -> escalate chain, not a
// hand-stubbed null.

const uc06Session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };
const uc06Changes = { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } };
const uc06Deps = () => ({
  draftSummary: (args) => draftSummaryReal(args, { isConfigured: () => false }),
  judge: async () => ({ verdict: "not_evaluated", reason: null }),
});

test("UC-06: a payroll calendar that could not be read escalates as an UPSTREAM failure, not as an empty calendar", async () => {
  await withMock(async (baseUrl) => {
    const real = new RemoteClient({ baseUrl });
    // The null still comes from the REAL client meeting a REAL 404 — the
    // payroll read alone is pointed at a server that has no calendar, while
    // every other read goes to the mock and succeeds. Hand-stubbing `async () =>
    // null` here would test this test's own stub instead of the 404 -> null ->
    // upstream-failure -> escalate chain it exists to walk.
    await withStub({ "*": { status: 404, body: "Not Found" } }, async (deadUrl) => {
      const dead = new RemoteClient({ baseUrl: deadUrl });
      const remote = {
        getEmployment: (id) => real.getEmployment(id),
        getCountrySchema: (code) => real.getCountrySchema(code),
        getContractAmendmentSchema: (id, code) => real.getContractAmendmentSchema(id, code),
        listPayrollRuns: (opts) => dead.listPayrollRuns(opts),
        createContractAmendment: (args, opts) => real.createContractAmendment(args, opts),
      };
      const r = await handleAmendmentRequest(
        {
          employmentId: "emp_nl_amend_001",
          session: uc06Session,
          changes: uc06Changes,
          requestedEffectiveDate: "2026-08-15",
          now: "2026-08-01",
        },
        { remote, audit: new AuditLogger(), amendmentStore: new AmendmentStore(), ...uc06Deps() }
      );
      assert.equal(r.decision, "escalate", "fails closed — the contract change must not open a path");
      assert.equal(
        r.reason,
        "upstream_record_not_found",
        "the OLD behaviour recorded `no_matching_payroll_cycle` here — a fact about the company, invented from a failed read"
      );
      assert.ok(r.flags.includes("upstream_payroll_runs_404"), `flags were ${JSON.stringify(r.flags)}`);
    });
  });
});

test("POSITIVE — UC-06 with a readable calendar still reaches dual approval", async () => {
  // The half a fail-closed assertion cannot see. If the null were mishandled
  // one step earlier, EVERY amendment would escalate and the test above would
  // still pass.
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    const r = await handleAmendmentRequest(
      {
        employmentId: "emp_nl_amend_001",
        session: uc06Session,
        changes: uc06Changes,
        requestedEffectiveDate: "2026-08-15",
        now: "2026-08-01",
      },
      { remote, audit: new AuditLogger(), amendmentStore: new AmendmentStore(), ...uc06Deps() }
    );
    assert.equal(r.decision, "dual_approval_required");
    assert.equal(r.reason, "all_gates_passed");
  });
});

// ---------------------------------------------------------------------------
// 4. listCountries()'s SWALLOWED 404 — the same conflation as (3), one method
//    over, found while verifying (1)-(3) against the live Sandbox
// ---------------------------------------------------------------------------
// `listCountries()` returned `[]` for BOTH "Remote sent an empty registry" and
// "we never read the registry": `#get()` answers null on a 404, `null?.
// countries` is undefined, and the `if (!Array.isArray(list)) return []` line
// flattened the two into one value. That is defect (3)'s exact shape — a fetch
// that never produced an answer, describing the data.
//
// It is louder here than for the payroll calendar, because of WHAT the only
// consumer does with it. UC-03's step-7 gate escalates a destination absent
// from the set as `destination_jurisdiction_excluded` — a claim ABOUT THAT
// DESTINATION's jurisdiction. With an unreadable registry the set is empty, so
// EVERY destination earns that reason, Spain included. A specialist reading the
// row then investigates a country with nothing wrong with it, while the actual
// cause — the registry read failed — is recorded nowhere. `src/uc03/workflow.js`
// even asserted in a comment that this read failure "PROPAGATES"; it did so
// only for a 5xx (which throws), never for the 404 (which was swallowed).
//
// Same fix as (3), same convention as `getEmployment()`/`listPayrollRuns()`:
// null means "could not be read", and `[]` keeps its literal meaning.

test("listCountries: a 404 returns null — distinguishable from a genuinely empty registry", async () => {
  await withStub({ "*": { status: 404, body: "Not Found" } }, async (baseUrl) => {
    const countries = await new RemoteClient({ baseUrl }).listCountries();
    assert.equal(countries, null, "a 404 must be reported as null, the same convention getEmployment() uses");
  });
});

test("listCountries: an UNRECOGNISABLE envelope is a failed read, not an empty registry", async () => {
  // A 200 whose body is not this endpoint's shape in any recognised form tells
  // us exactly as much about the world as a 404 does: nothing. Coercing it to []
  // would re-teach the conflation one layer up from the 404.
  await withStub({ "/v1/countries": { status: 200, body: { data: { total: 224 } } } }, async (baseUrl) => {
    const countries = await new RemoteClient({ baseUrl }).listCountries();
    assert.equal(countries, null, "a body with no country array anywhere is not a registry we can read");
  });
});

test("listCountries: the LEGACY `{data:{countries:[…]}}` envelope is still read, not treated as a failure", async () => {
  // The deliberate exception, and the reason the null above is not simply
  // "anything that is not the live shape". `listCountries()` keeps reading the
  // envelope the mock served until 2026-08-17 because a stale PINNED n8n dataset
  // still carries it, and a pinned dataset silently failing closed is worse than
  // one being read. It is a recognised shape carrying real rows — so it is an
  // ANSWER, and the empty case below is a genuinely empty answer, not a failure.
  const legacy = { data: { countries: [{ code: "ESP", alpha_2_code: "ES", name: "Spain" }] } };
  await withStub({ "/v1/countries": { status: 200, body: legacy } }, async (baseUrl) => {
    const countries = await new RemoteClient({ baseUrl }).listCountries();
    assert.deepEqual(countries, [{ country_code: "ES", name: "Spain" }]);
  });
});

test("listCountries: a genuinely empty registry is still an empty registry, not null", async () => {
  await withStub({ "/v1/countries": { status: 200, body: { data: [] } } }, async (baseUrl) => {
    const countries = await new RemoteClient({ baseUrl }).listCountries();
    assert.deepEqual(countries, [], "an answer of `no countries` is an answer, and must stay one");
  });
});

test("listCountries: a non-404 failure still THROWS rather than answering with an empty registry", async () => {
  await withStub({ "*": { status: 403, body: { error: "forbidden" } } }, async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl, backoff: async () => {} });
    await assert.rejects(() => remote.listCountries(), /countries.*403/s);
  });
});

test("UC-03: a country registry that could not be read escalates as an UPSTREAM failure, not as a jurisdiction exclusion", async () => {
  // The null comes from the REAL client meeting a REAL 404: the registry read
  // alone is pointed at a server that has none, while the employment read goes
  // to the mock and succeeds. Stubbing `async () => null` here would test the
  // stub instead of the 404 -> null -> upstream-failure -> escalate chain.
  await withMock(async (baseUrl) => {
    const real = new RemoteClient({ baseUrl });
    await withStub({ "*": { status: 404, body: "Not Found" } }, async (deadUrl) => {
      const dead = new RemoteClient({ baseUrl: deadUrl });
      const remote = {
        getEmployment: (id) => real.getEmployment(id),
        listCountries: () => dead.listCountries(),
      };
      const r = await handleTravelInquiry(
        {
          text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
          employmentId: "emp_active_001",
          session: { authenticatedEmploymentId: "emp_active_001" },
        },
        {
          remote,
          audit: new AuditLogger(),
          caseStore: new CaseStore(),
          classify: classifyTravelInquiryRuleBased,
        }
      );
      assert.equal(r.decision, "escalate", "fails closed — an unreadable registry must never open a path");
      assert.equal(
        r.reason,
        "upstream_record_not_found",
        "the OLD behaviour said `destination_jurisdiction_excluded` — a claim about Spain, invented from a failed read"
      );
      assert.ok(r.flags.includes("upstream_countries_404"), `flags were ${JSON.stringify(r.flags)}`);
    });
  });
});

test("POSITIVE — UC-03 with a readable registry still auto_resolves a supported destination", async () => {
  // The half no fail-closed assertion can see, and the exact half missing for
  // the life of finding F-25. If the null were mishandled one step earlier — or
  // if `[]` were passed where null belongs — EVERY destination would escalate
  // and the test above would still pass, indistinguishably.
  await withMock(async (baseUrl) => {
    const remote = new RemoteClient({ baseUrl });
    const r = await handleTravelInquiry(
      {
        text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
      },
      {
        remote,
        audit: new AuditLogger(),
        caseStore: new CaseStore(),
        classify: classifyTravelInquiryRuleBased,
      }
    );
    assert.equal(r.decision, "auto_resolve", `expected Spain to resolve; got ${r.decision}/${r.reason}`);
    assert.ok(r.informationalAnswer, "the successful path must actually produce its artifact");
  });
});
