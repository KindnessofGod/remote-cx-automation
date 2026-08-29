// ---------------------------------------------------------------------------
// checkCloseSurfaces.test.js — proves the pure logic behind
// check-close-surfaces.mjs (rca-g34n) before it is trusted anywhere.
// ---------------------------------------------------------------------------
// Hermetic per CLAUDE.md §6: no network, no git, no database — the CLI
// (scripts/check-close-surfaces.mjs) is the only thing that shells out to
// git/npm or opens a pg connection; this file only drives the three pure
// functions it's built from.
//
// The incident this suite exists to make impossible again: 4 of 4
// multi-surface bead closes on 2026-08-22 shipped only their Vercel half and
// were reported closed anyway. A checker with no test proving it catches the
// thing is rca-wqq's C-4, paid for three times already (persona-leak-audit,
// verify-isolation, verify-zaf) before this one.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import { categorizeChangedFiles, parseMigrationColumns, aggregateVerdicts } from "../scripts/lib/closeSurfaces.mjs";

test("categorizeChangedFiles: sorts workflows/, zaf-app/ and migrations/ into their own buckets", () => {
  const cat = categorizeChangedFiles([
    "workflows/nodes-uc03/travelRouterGates.js",
    "zaf-app/assets/panels.js",
    "migrations/0004-something.sql",
    "src/uc03/policyEngine.js",
    "test/uc03.test.js",
    "docs/BUILD-LOG.md",
  ]);
  assert.deepEqual(cat.n8n, ["workflows/nodes-uc03/travelRouterGates.js"]);
  assert.deepEqual(cat.zaf, ["zaf-app/assets/panels.js"]);
  assert.deepEqual(cat.migrations, ["migrations/0004-something.sql"]);
});

test("categorizeChangedFiles: zaf-app/tmp/ (build output) is NOT a zaf-app/ deploy signal", () => {
  // rca-xsbt's exact trap wearing a different hat: including build output
  // would make this fire on every local `zcli apps:package` run.
  const cat = categorizeChangedFiles(["zaf-app/tmp/dist/bundle.js", "zaf-app/tmp/manifest.json"]);
  assert.deepEqual(cat.zaf, []);
});

test("categorizeChangedFiles: a non-.sql file under migrations/ is not treated as a migration", () => {
  const cat = categorizeChangedFiles(["migrations/README.md"]);
  assert.deepEqual(cat.migrations, []);
});

test("categorizeChangedFiles: an empty diff categorizes to three empty buckets", () => {
  const cat = categorizeChangedFiles([]);
  assert.deepEqual(cat, { n8n: [], zaf: [], migrations: [] });
});

test("parseMigrationColumns: extracts table/column pairs from this repo's real migration style", () => {
  const sql = `
alter table public.cases
  add column if not exists manual_send_status text
  check (manual_send_status in ('sent','failed'));

alter table public.cases
  add column if not exists manual_send_at timestamptz;

alter table public.cases
  add column if not exists manual_send_by text;
`;
  const pairs = parseMigrationColumns(sql);
  assert.deepEqual(pairs, [
    { table: "cases", column: "manual_send_status" },
    { table: "cases", column: "manual_send_at" },
    { table: "cases", column: "manual_send_by" },
  ]);
});

test("parseMigrationColumns: a commented-out rollback block is not parsed", () => {
  const sql = `
alter table public.consent_records
  add column if not exists purpose text;

-- rollback:
-- alter table public.consent_records
--   drop column purpose;
`;
  const pairs = parseMigrationColumns(sql);
  assert.deepEqual(pairs, [{ table: "consent_records", column: "purpose" }]);
});

test("parseMigrationColumns: two ALTER TABLEs on different tables in one file both get read", () => {
  const sql = `
alter table public.cases
  add column if not exists return_address text;

alter table public.consent_records
  add column if not exists granted_at timestamptz;
`;
  const pairs = parseMigrationColumns(sql);
  assert.deepEqual(pairs, [
    { table: "cases", column: "return_address" },
    { table: "consent_records", column: "granted_at" },
  ]);
});

test("parseMigrationColumns: SQL with no recognisable ALTER TABLE / ADD COLUMN shape returns zero pairs", () => {
  const pairs = parseMigrationColumns("create table public.something (id uuid primary key);");
  assert.deepEqual(pairs, []);
});

test("RED PROOF — aggregateVerdicts: a single FAIL refuses the close (exit 1)", () => {
  const { code, summary } = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["a.js"], verdict: "fail", detail: "drifted" },
  ]);
  assert.equal(code, 1);
  assert.match(summary, /REFUSED/);
});

test("aggregateVerdicts: a FAIL alongside a clean PASS still refuses (exit 1) — one bad surface is not diluted by a good one", () => {
  const { code } = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["a.js"], verdict: "fail", detail: "drifted" },
    { surface: "zaf-app/", files: ["b.js"], verdict: "pass", detail: "in sync" },
  ]);
  assert.equal(code, 1);
});

test("aggregateVerdicts: an UNKNOWN surface never reads as a pass (exit 2, not 0)", () => {
  const { code, summary } = aggregateVerdicts([
    { surface: "migrations/", files: ["x.sql"], verdict: "unknown", detail: "SUPABASE_DB_URL not set" },
  ]);
  assert.equal(code, 2);
  assert.match(summary, /COULD NOT TELL/);
});

test("aggregateVerdicts: FAIL beats UNKNOWN — a known-bad surface is never masked by an unrelated unreachable one", () => {
  const { code } = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["a.js"], verdict: "fail", detail: "drifted" },
    { surface: "migrations/", files: ["x.sql"], verdict: "unknown", detail: "SUPABASE_DB_URL not set" },
  ]);
  assert.equal(code, 1);
});

test("GREEN PROOF — aggregateVerdicts: every touched surface confirmed PASS -> clean (exit 0)", () => {
  const { code, summary } = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["a.js"], verdict: "pass", detail: "0 drifted" },
    { surface: "zaf-app/", files: ["b.js"], verdict: "pass", detail: "in sync" },
    { surface: "migrations/", files: ["c.sql"], verdict: "pass", detail: "columns present" },
  ]);
  assert.equal(code, 0);
  assert.match(summary, /clean/);
});

test("aggregateVerdicts: nothing touched -> clean (exit 0), the git-push-only case", () => {
  const { code, summary } = aggregateVerdicts([]);
  assert.equal(code, 0);
  assert.match(summary, /git push is the whole duty/);
});
