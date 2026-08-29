#!/usr/bin/env node
/**
 * capture-sandbox.mjs — read the Remote Sandbox and write down what it ACTUALLY
 * returns, so `src/remote/mockServer.js` can be corrected against the API rather
 * than against our own code.
 *
 * WHY THIS EXISTS
 * ---------------
 * This project's most expensive recurring defect (CLAUDE.md §4, BUILD-LOG §3.66)
 * is fixtures written to agree with the code and code written to agree with the
 * fixtures, so neither is ever compared to Remote. Every one of the worst
 * defects this repo has found passed the full test suite. The only cure is a
 * capture: a file whose contents came from the API and from nowhere else.
 *
 * It is READ-ONLY by construction: every request below is a GET, and there is
 * no code path in this file that issues any other method. A capture script that
 * could write is a capture script that can corrupt the thing it is measuring.
 *
 * USAGE
 *   NODE_USE_ENV_PROXY=1 node scripts/capture-sandbox.mjs [outDir]
 *
 * Node's global fetch ignores HTTPS_PROXY in this container (CLAUDE.md §6), so
 * NODE_USE_ENV_PROXY=1 is required or every call fails with a 403 that reads
 * like an allowlist problem.
 *
 * Requires REMOTE_API_TOKEN (and optionally REMOTE_BASE_URL, default the
 * Sandbox gateway). Sandbox only — never a production token, never real
 * customer data (CLAUDE.md §3 directive 5).
 */

import "dotenv/config";   // the repo keeps credentials in .env; without this this
                          // script fails with a credentials-shaped error on a
                          // machine that HAS them — see verify-deployed-nodes.mjs
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.REMOTE_BASE_URL || "https://gateway.remote-sandbox.com";
const TOKEN = process.env.REMOTE_API_TOKEN;
const OUT = process.argv[2] || ".sandbox-cap";

if (!TOKEN) {
  console.error("REMOTE_API_TOKEN is not set — nothing to capture.");
  process.exit(1);
}

/**
 * One GET. Records status, headers we care about, and the parsed body — and on
 * a non-2xx records the body anyway, because a 403/404 body is itself the
 * finding (it tells you whether the token lacks a role or the record is gone).
 */
async function get(pathAndQuery) {
  const url = `${BASE}${pathAndQuery}`;
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
  } catch (err) {
    return { path: pathAndQuery, transportError: String(err && err.message) };
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { __unparsed: text.slice(0, 2000) };
  }
  return {
    path: pathAndQuery,
    status: res.status,
    contentType: res.headers.get("content-type"),
    ms: Date.now() - started,
    body,
  };
}

async function save(name, value) {
  await writeFile(path.join(OUT, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
}

function summarise(capture) {
  const s = `${capture.status ?? "ERR"} ${capture.path}`;
  console.log(s);
  return capture;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const index = { capturedAt: new Date().toISOString(), base: BASE, calls: [] };
  const record = (name, cap) => {
    index.calls.push({ name, path: cap.path, status: cap.status ?? null, ms: cap.ms ?? null });
    return cap;
  };

  // 1. Employments — list, then show for each id in the list. The list and the
  //    show endpoints do NOT return the same shape; capturing only one is how a
  //    mock ends up serving list fields on a show route.
  const empList = summarise(await get("/v1/employments?page_size=50"));
  await save("employments-list", record("employments-list", empList));

  const ids = (empList.body?.data?.employments || []).map((e) => e.id).filter(Boolean);
  const shows = [];
  for (const id of ids) {
    const one = summarise(await get(`/v1/employments/${id}`));
    shows.push(one);
    record(`employment-${id}`, one);
  }
  await save("employments-show", shows);

  // 2. Countries + the per-country JSON schema. The countries row shape is the
  //    fixture that hid the UC-03 alpha-2/alpha-3 bug, so it gets captured whole.
  const countries = summarise(await get("/v1/countries"));
  await save("countries", record("countries", countries));

  // Schemas for the countries our use cases actually name, plus whatever the
  // captured employments are actually in.
  const schemaCodes = new Set(["ESP", "PRT", "USA", "CAN", "NLD", "FRA", "SGP", "DEU", "GBR"]);
  for (const s of shows) {
    const code =
      s.body?.data?.employment?.country?.code ||
      s.body?.data?.employment?.country_code;
    if (code) schemaCodes.add(code);
  }
  const schemas = [];
  for (const code of schemaCodes) {
    const sc = summarise(await get(`/v1/countries/${code}/employment_basic_information`));
    schemas.push(sc);
    record(`schema-${code}`, sc);
  }
  await save("country-schemas", schemas);

  // 3. The collections our 🟡/🔴 use cases claim to read or write into.
  for (const [name, p] of [
    ["work-authorization-requests", "/v1/work-authorization-requests"],
    ["travel-letter-requests", "/v1/travel-letter-requests"],
    ["expenses", "/v1/expenses"],
    ["employee-expenses", "/v1/employee/expenses"],
    ["expense-categories-employee", "/v1/employee/expense-categories"],
    ["expense-categories-flat", "/v1/expenses/categories"],
    ["payroll-runs", "/v1/payroll-runs"],
    ["company-payroll-runs", "/v1/company-payroll-runs"],
    ["contract-amendments", "/v1/contract-amendments"],
    ["incentives", "/v1/incentives"],
    ["companies", "/v1/companies"],
    ["legal-entities", "/v1/legal-entities"],
    ["timeoff", "/v1/timeoff"],
  ]) {
    const cap = summarise(await get(p));
    await save(name, record(name, cap));
  }

  await save("_index", index);
  console.log(`\nWrote ${index.calls.length} captures to ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
