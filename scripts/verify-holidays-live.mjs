#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-holidays-live.mjs — re-run, against the live Sandbox, every claim the
// holiday boundary is built on
// ---------------------------------------------------------------------------
// The suite is hermetic and must stay that way, so nothing in test/ may make
// this call. But every number in src/remote/holidays.js came from somewhere,
// and a fact with no way to re-check it decays into a fixture that agrees with
// the code — which is the mechanism behind every defect this repo has had to
// correct twice. This script is the re-check.
//
//   NODE_USE_ENV_PROXY=1 REMOTE_API_TOKEN=… node scripts/verify-holidays-live.mjs
//
// (`NODE_USE_ENV_PROXY=1` is required in this container: Node's global fetch
// ignores HTTPS_PROXY otherwise and the call fails with a 403 that reads like
// an allowlist problem — CLAUDE.md §4.)
//
// It asserts and exits non-zero on the first disagreement, rather than
// printing for a human to skim: a verification nobody reads is not one.
// ---------------------------------------------------------------------------

import "dotenv/config";   // credentials live in .env; without this these checks
                          // exit 2 on a machine that HAS them, and an exit 2 is
                          // indistinguishable from genuinely being unable to reach
                          // the service — the confusion they exist to prevent
import assert from "node:assert/strict";

const BASE = process.env.REMOTE_BASE_URL || "https://gateway.remote-sandbox.com";
const TOKEN = process.env.REMOTE_API_TOKEN;
if (!TOKEN) {
  console.error("REMOTE_API_TOKEN is not set — this script only talks to the real Sandbox.");
  process.exit(2);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const rows = async (path) => {
  const { status, body } = await get(path);
  assert.equal(status, 200, `${path} -> ${status}`);
  assert.ok(Array.isArray(body.data), `${path}: the array must sit DIRECTLY under \`data\``);
  return body.data;
};

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check("Canada 2026: national 5, Ontario 4, and the two sets are DISJOINT (union = 9)", async () => {
  const national = await rows("/v1/countries/CAN/holidays/2026");
  const ontario = await rows("/v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ON");
  assert.equal(national.length, 5);
  assert.equal(ontario.length, 4);
  const days = new Set(national.map((h) => h.day));
  assert.deepEqual(ontario.filter((h) => days.has(h.day)), [], "the subdivision list must be additional days only");
  assert.equal(new Set([...national, ...ontario].map((h) => h.day)).size, 9);
});

check("Ontario's Boxing Day is OBSERVED on a different date — the `observed_day ?? day` rule is live", async () => {
  const ontario = await rows("/v1/countries/CAN/holidays/2026?country_subdivision_code=CA-ON");
  const boxing = ontario.find((h) => h.name === "Boxing Day");
  assert.equal(boxing.day, "2026-12-26");
  assert.equal(boxing.observed_day, "2026-12-28");
});

check("the union rule is not Canada-specific — QC 3, BC 6, ES-MD 4, DE-BY 4, GB-SCT 3, all disjoint", async () => {
  const cases = [
    ["CAN", "CA-QC", 3],
    ["CAN", "CA-BC", 6],
    ["ESP", "ES-MD", 4],
    ["DEU", "DE-BY", 4],
    ["GBR", "GB-SCT", 3],
  ];
  for (const [country, subdivision, expected] of cases) {
    const national = await rows(`/v1/countries/${country}/holidays/2026`);
    const sub = await rows(`/v1/countries/${country}/holidays/2026?country_subdivision_code=${subdivision}`);
    assert.equal(sub.length, expected, `${subdivision}`);
    const days = new Set(national.map((h) => h.day));
    assert.deepEqual(sub.filter((h) => days.has(h.day)), [], `${subdivision} overlaps the national list`);
  }
});

check("the United States: federal only — every state answers 200 with ZERO rows", async () => {
  assert.equal((await rows("/v1/countries/USA/holidays/2026")).length, 11);
  for (const state of ["US-CA", "US-NY", "US-TX"]) {
    assert.deepEqual(await rows(`/v1/countries/USA/holidays/2026?country_subdivision_code=${state}`), [], state);
  }
});

check("an UNRECOGNISED subdivision is a 400 — which is what makes an empty list readable", async () => {
  for (const bad of ["CA-ZZ", "Ontario"]) {
    const res = await get(`/v1/countries/CAN/holidays/2026?country_subdivision_code=${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.message, "Country Subdivision is invalid", bad);
  }
});

check("the path is ALPHA-3 keyed: CAN 200, CA 404 `Country not found`", async () => {
  assert.equal((await get("/v1/countries/CAN/holidays/2026")).status, 200);
  const alpha2 = await get("/v1/countries/CA/holidays/2026");
  assert.equal(alpha2.status, 404);
  assert.equal(alpha2.body.message, "Country not found");
});

check("an unpopulated YEAR is a 200 with an empty list, not a 404 — why empty national is a failure", async () => {
  const res = await get("/v1/countries/NLD/holidays/2027");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  const badYear = await get("/v1/countries/CAN/holidays/notayear");
  assert.equal(badYear.status, 400);
  assert.equal(badYear.body.message, "Year is invalid");
});

check("CompanyLegalEntity.country_code is ALPHA-3 on every row", async () => {
  const employments = await get("/v1/employments?page_size=1");
  const employmentId = employments.body.data.employments[0].id;
  const one = await get(`/v1/employments/${employmentId}`);
  const companyId = one.body.data.employment.company_id;
  const entities = await get(`/v1/companies/${companyId}/legal-entities`);
  assert.equal(entities.status, 200);
  const list = entities.body.data.legal_entities;
  assert.ok(list.length > 0);
  for (const entity of list) {
    assert.match(entity.country_code, /^[A-Z]{3}$/, `${entity.name}: ${entity.country_code}`);
  }
});

check("total_payroll_cost is documented `integer` and arrives as a quoted STRING", async () => {
  const res = await get("/v1/payroll-runs?page=1&page_size=5");
  assert.equal(res.status, 200);
  const withCost = res.body.data.payroll_runs.filter((r) => r.total_payroll_cost !== null);
  assert.ok(withCost.length > 0, "no cycle carried a cost — the claim cannot be checked from this page");
  for (const run of withCost) {
    assert.equal(typeof run.total_payroll_cost, "string", `${run.id}: ${JSON.stringify(run.total_payroll_cost)}`);
    assert.match(run.total_payroll_cost, /^-?\d+$/, `${run.id}: minor units, unquoted digits inside the quotes`);
  }
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n").join("\n       ")}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} live claims still hold.`);
process.exit(failed === 0 ? 0 : 1);
