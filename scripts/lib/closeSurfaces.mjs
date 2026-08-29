// ---------------------------------------------------------------------------
// closeSurfaces.mjs — pure logic for "does this commit owe a deploy verb
// beyond git push, and did it pay it?" (rca-g34n)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Four of five multi-surface bead closes on 2026-08-22/23 shipped only their
// Vercel half (git push) and reported themselves closed anyway — the close
// path never read the diff it had just committed. rca-g34n names the
// cheapest fix in its own words: "one git show --name-only against three
// path prefixes." This file is that check, split pure so it is testable
// without git, npm, or a database — see ../check-close-surfaces.mjs for the
// CLI that wires it to real subprocesses and a real Postgres connection.
//
// Three surfaces, three deploy verbs, per CLAUDE.md §6/§7's close-duty table:
//   workflows/**            -> npm run deploy-node / deploy-routing (n8n)
//   zaf-app/** (not tmp/)    -> bump manifest.json, npm run deploy-zaf
//   migrations/**.sql        -> nothing runs it automatically; verify by
//                               reading the live schema back
// A file under none of these owes only `git push`, which every worker
// already does as part of closing a bead — the whole point of this file is
// to name the THREE cases where that is not enough, not to re-litigate the
// fourth.
// ---------------------------------------------------------------------------

const N8N_PREFIX = "workflows/";
const ZAF_PREFIX = "zaf-app/";
const ZAF_BUILD_PREFIX = "zaf-app/tmp/"; // build output, gitignored — never a deploy signal
const MIGRATIONS_PREFIX = "migrations/";

/**
 * @param {string[]} files repo-relative paths, e.g. from `git show --name-only`
 * @returns {{n8n: string[], zaf: string[], migrations: string[]}}
 */
export function categorizeChangedFiles(files) {
  const n8n = [];
  const zaf = [];
  const migrations = [];
  for (const f of files) {
    if (f.startsWith(N8N_PREFIX)) n8n.push(f);
    else if (f.startsWith(ZAF_PREFIX) && !f.startsWith(ZAF_BUILD_PREFIX)) zaf.push(f);
    else if (f.startsWith(MIGRATIONS_PREFIX) && f.endsWith(".sql")) migrations.push(f);
  }
  return { n8n, zaf, migrations };
}

/**
 * Parses `alter table [public.]<table> ... add column if not exists <col>
 * ...` pairs out of a migration file's text. Deliberately narrow: it matches
 * this repo's own migration style (0001-0003, all three follow it), not
 * general SQL DDL — a migration that doesn't follow the pattern falls out as
 * zero pairs, and the CALLER must treat zero pairs as "unknown", never as
 * "nothing to verify" (an unparseable migration is exactly the case this
 * checker cannot silently wave through).
 * @param {string} sql
 * @returns {{table: string, column: string}[]}
 */
export function parseMigrationColumns(sql) {
  const pairs = [];
  let currentTable = null;
  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("--")) continue; // a commented-out example block, e.g. every migration's rollback note
    const alterMatch = line.match(/^alter\s+table\s+(?:public\.)?(\w+)/i);
    if (alterMatch) {
      currentTable = alterMatch[1];
    }
    if (currentTable) {
      const colMatch = line.match(/add\s+column\s+if\s+not\s+exists\s+(\w+)/i);
      if (colMatch) pairs.push({ table: currentTable, column: colMatch[1] });
    }
    if (line.endsWith(";")) currentTable = null; // statement closed; next `alter table` re-sets it
  }
  return pairs;
}

/**
 * @typedef {{surface: string, files: string[], verdict: "pass"|"fail"|"unknown", detail: string}} SurfaceVerdict
 * @param {SurfaceVerdict[]} verdicts
 * @returns {{code: 0|1|2, summary: string}}
 */
export function aggregateVerdicts(verdicts) {
  if (verdicts.length === 0) {
    return { code: 0, summary: "no deploy-owed surfaces touched — git push is the whole duty" };
  }
  // FAIL beats UNKNOWN here, deliberately the OPPOSITE precedence from
  // src/surfaceverify/runner.js's overallExitCode (where any stale/unreadable
  // evidence downgrades the whole run to "could not tell", even past a fresh
  // confirmed fail). That precedent fits a fact-finding tool, where an
  // uncertain verdict might just be flaky evidence and shouldn't be read as a
  // finding. This is a gate, not a fact-finder: a KNOWN-bad surface must
  // never be masked by an unrelated surface this checker couldn't reach —
  // reporting "could not tell" when one surface is already confirmed
  // undeployed would be strictly more dangerous than today's no-check
  // baseline, which at least fails loudly by omission.
  if (verdicts.some((v) => v.verdict === "fail")) {
    return { code: 1, summary: "REFUSED — at least one touched surface is not deployed" };
  }
  if (verdicts.some((v) => v.verdict === "unknown")) {
    return { code: 2, summary: "COULD NOT TELL — at least one touched surface could not be verified" };
  }
  return { code: 0, summary: "clean — every touched surface is deployed" };
}
