#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-close-surfaces.mjs — refuses to call a close clean while a surface
// the commit touched is still undeployed (rca-g34n)
// ---------------------------------------------------------------------------
// THE PROBLEM THIS CLOSES
//
// 4 of 4 multi-surface bead closes on the night of 2026-08-22 shipped only
// their Vercel half (git push) and were reported closed anyway — twice after
// being told the four-surface rule IN THE BEAD NOTES. Every close had
// everything it needed to catch this: the commit sha, and the answer is one
// `git show --name-only` matched against three path prefixes. It just never
// looked. This script is that look, run explicitly rather than trusted to
// prose a worker reads once at the start of a session.
//
// WHAT IT DOES
//   1. Reads the file list touched by a commit (default HEAD — the commit a
//      close is about to be reported against).
//   2. Splits it into the three surfaces that owe MORE than `git push`:
//        workflows/**            -> npm run verify-deployed (real n8n check)
//        zaf-app/** (not tmp/)    -> npm run verify-zaf (real Zendesk check)
//        migrations/**.sql        -> query information_schema.columns live
//   3. Runs the real, existing checker for each surface actually touched —
//      it does not re-implement drift detection, it drives the tools that
//      already do (verify-deployed-nodes.mjs, deploy-zaf-app.mjs --check),
//      plus a small migration-column reader for the one surface with no
//      existing checker at all.
//   4. Refuses to report clean if any touched surface is not confirmed
//      deployed.
//
// USAGE
//   npm run check-close-surfaces                    # HEAD's own commit
//   npm run check-close-surfaces -- --commit=<sha>   # a specific commit
//   npm run check-close-surfaces -- --self-test      # offline proof, no
//                                                     #   git/network/db —
//                                                     #   proves the REFUSE
//                                                     #   and PASS paths both
//                                                     #   fire correctly
//
// EXIT CODES (same three-way shape every other verify-* script in this repo
// uses, so a caller — human or another script — never has to special-case
// this one):
//   0  clean — nothing touched owes more than `git push`, or everything
//      owed was confirmed deployed. SAFE to report the close as shipped.
//   1  REFUSED — a touched surface is confirmed NOT deployed. DO NOT report
//      this bead/commit as closed until it is.
//   2  COULD NOT TELL — a touched surface could not be verified (missing
//      credentials, unreachable network/db). NEVER read as a pass — see
//      CLAUDE.md §6 for why an unreadable check must never default to 0.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { categorizeChangedFiles, parseMigrationColumns, aggregateVerdicts } from "./lib/closeSurfaces.mjs";
import { getPgPool, closePgPool } from "../src/shared/db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

function changedFiles(commit) {
  const out = execFileSync("git", ["show", "--name-only", "--format=", commit], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Runs an existing `npm run <script>` verify tool and folds its 0/1/2 exit into a SurfaceVerdict. */
function runChecker(npmScript) {
  try {
    const out = execFileSync("npm", ["run", "--silent", npmScript], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { verdict: "pass", detail: tail(out) || `${npmScript} exited 0` };
  } catch (err) {
    const output = String(err.stdout || "") + String(err.stderr || "");
    const detail = `${npmScript} exited ${err.status}:\n${tail(output)}`;
    if (err.status === 2) return { verdict: "unknown", detail };
    return { verdict: "fail", detail };
  }
}

function tail(text, lines = 6) {
  return text.trim().split("\n").slice(-lines).join("\n");
}

async function checkMigrations(commit, files) {
  const pool = getPgPool();
  if (!pool) {
    return { surface: "migrations/", files, verdict: "unknown", detail: "SUPABASE_DB_URL not set — cannot query information_schema" };
  }

  const pairs = [];
  for (const f of files) {
    let text;
    try {
      text = execFileSync("git", ["show", `${commit}:${f}`], { cwd: ROOT, encoding: "utf8" });
    } catch {
      continue; // file deleted by this commit — nothing to verify
    }
    pairs.push(...parseMigrationColumns(text).map((p) => ({ ...p, file: f })));
  }
  if (pairs.length === 0) {
    return {
      surface: "migrations/", files, verdict: "unknown",
      detail: "no `alter table ... add column if not exists` pairs recognised in the changed file(s) — "
        + "this migration's shape isn't the one this checker parses (see parseMigrationColumns); verify by hand",
    };
  }

  const missing = [];
  try {
    for (const { table, column, file } of pairs) {
      const { rows } = await pool.query(
        "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2",
        [table, column],
      );
      if (rows.length === 0) missing.push(`${file}: public.${table}.${column}`);
    }
  } catch (err) {
    return { surface: "migrations/", files, verdict: "unknown", detail: `could not query information_schema: ${err.message}` };
  }

  if (missing.length > 0) {
    return { surface: "migrations/", files, verdict: "fail", detail: `NOT applied to the live schema:\n  ${missing.join("\n  ")}` };
  }
  return { surface: "migrations/", files, verdict: "pass", detail: `all ${pairs.length} column(s) confirmed present in information_schema` };
}

async function fullRun() {
  const commit = opt("commit", "HEAD");
  const files = changedFiles(commit);
  const { n8n, zaf, migrations } = categorizeChangedFiles(files);

  console.log(`Checking close-owed surfaces for ${commit} (${files.length} file(s) changed)`);

  const verdicts = [];

  if (n8n.length > 0) {
    console.log(`\n=== workflows/ touched (${n8n.length} file(s)) — running npm run verify-deployed ===`);
    verdicts.push({ surface: "workflows/ (n8n)", files: n8n, ...runChecker("verify-deployed") });
  }
  if (zaf.length > 0) {
    console.log(`\n=== zaf-app/ touched (${zaf.length} file(s)) — running npm run verify-zaf ===`);
    verdicts.push({ surface: "zaf-app/", files: zaf, ...runChecker("verify-zaf") });
  }
  if (migrations.length > 0) {
    console.log(`\n=== migrations/ touched (${migrations.length} file(s)) — querying information_schema ===`);
    verdicts.push(await checkMigrations(commit, migrations));
  }

  console.log("\n=== Verdicts ===");
  for (const v of verdicts) {
    console.log(`\n[${v.verdict.toUpperCase()}] ${v.surface}`);
    console.log(`  files: ${v.files.join(", ")}`);
    console.log(`  ${v.detail.split("\n").join("\n  ")}`);
  }
  if (verdicts.length === 0) {
    console.log("\n(no workflows/, zaf-app/, or migrations/ files in this commit)");
  }

  const { code, summary } = aggregateVerdicts(verdicts);
  console.log(`\n${summary} — exit ${code}`);
  if (code !== 0) {
    console.log("DO NOT report this bead/commit as closed/shipped until every surface above reads PASS.");
  }

  await closePgPool();
  return code;
}

// ---------------------------------------------------------------------------
// SELF-TEST: proves the REFUSE path fires (not just the clean path) before
// this is trusted anywhere — same discipline as scripts/verify-surfaces.mjs's
// self-test-exit2 / self-test-positive-lead. Entirely offline: no git, no
// npm subprocess, no database. Exercises categorizeChangedFiles() and
// aggregateVerdicts() against a synthetic file list and synthetic verdicts —
// the two pure functions this whole mechanism stands on.
// ---------------------------------------------------------------------------
function selfTest() {
  console.log("=== SELF-TEST: categorization + aggregation, offline ===\n");
  let allOk = true;

  console.log("(a) a commit touching workflows/ and zaf-app/tmp/ (build output) categorizes correctly");
  const cat = categorizeChangedFiles([
    "workflows/nodes-uc03/travelRouterGates.js",
    "zaf-app/tmp/dist/bundle.js", // build output — must NOT count as a zaf-app/ deploy surface
    "zaf-app/assets/panels.js",
    "src/uc03/policyEngine.js", // unrelated — must not appear anywhere
    "migrations/0004-something.sql",
  ]);
  if (cat.n8n.length === 1 && cat.zaf.length === 1 && cat.migrations.length === 1) {
    console.log(`   ok — n8n=${JSON.stringify(cat.n8n)} zaf=${JSON.stringify(cat.zaf)} migrations=${JSON.stringify(cat.migrations)}`);
  } else {
    console.log(`   FAIL — got ${JSON.stringify(cat)}`);
    allOk = false;
  }

  console.log("\n(b) a REFUSED surface forces exit code 1, even alongside a clean one");
  const refused = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["x"], verdict: "fail", detail: "drift" },
    { surface: "zaf-app/", files: ["y"], verdict: "pass", detail: "in sync" },
  ]);
  if (refused.code === 1) console.log(`   ok — ${refused.summary}`);
  else { console.log(`   FAIL — expected code 1, got ${refused.code}`); allOk = false; }

  console.log("\n(c) an UNKNOWN surface never reads as a pass — exit code 2, not 0");
  const unknown = aggregateVerdicts([
    { surface: "migrations/", files: ["z"], verdict: "unknown", detail: "no db creds" },
  ]);
  if (unknown.code === 2) console.log(`   ok — ${unknown.summary}`);
  else { console.log(`   FAIL — expected code 2, got ${unknown.code}`); allOk = false; }

  console.log("\n(d) a FAIL still wins over an UNKNOWN elsewhere — a known-bad surface is never masked");
  const mixed = aggregateVerdicts([
    { surface: "workflows/ (n8n)", files: ["x"], verdict: "fail", detail: "drift" },
    { surface: "migrations/", files: ["z"], verdict: "unknown", detail: "no db creds" },
  ]);
  if (mixed.code === 1) console.log(`   ok — ${mixed.summary}`);
  else { console.log(`   FAIL — expected code 1, got ${mixed.code}`); allOk = false; }

  console.log("\n(e) nothing touched -> clean, exit 0");
  const clean = aggregateVerdicts([]);
  if (clean.code === 0) console.log(`   ok — ${clean.summary}`);
  else { console.log(`   FAIL — expected code 0, got ${clean.code}`); allOk = false; }

  console.log("\n(f) a migration ADD COLUMN pair is parsed from this repo's real style");
  const pairs = parseMigrationColumns(`
alter table public.cases
  add column if not exists manual_send_status text
  check (manual_send_status in ('sent','failed'));
alter table public.cases
  add column if not exists manual_send_at timestamptz;
-- alter table public.cases
--   drop column manual_send_status; -- commented-out rollback, must NOT be parsed
`);
  const wanted = JSON.stringify([{ table: "cases", column: "manual_send_status" }, { table: "cases", column: "manual_send_at" }]);
  if (JSON.stringify(pairs) === wanted) console.log(`   ok — ${JSON.stringify(pairs)}`);
  else { console.log(`   FAIL — got ${JSON.stringify(pairs)}`); allOk = false; }

  console.log(`\n${allOk ? "SELF-TEST PASSED" : "SELF-TEST FAILED"}`);
  return allOk ? 0 : 1;
}

async function main() {
  const code = flag("self-test") ? selfTest() : await fullRun();
  process.exit(code);
}

main();
