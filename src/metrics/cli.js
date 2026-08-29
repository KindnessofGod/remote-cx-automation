// ---------------------------------------------------------------------------
// cli.js  —  `npm run metrics`
// ---------------------------------------------------------------------------
// Reads live rows from Supabase when SUPABASE_DB_URL is configured, and falls
// back to a seeded offline run otherwise — the same "works with nothing
// configured, uses the real thing when configured" pattern the rest of the app
// follows (see llm.js, audit.js, caseStore.js).
//
// Writes demo/metrics.html and prints a summary, so the command is useful from
// a terminal even without opening the page.
//
// Usage:
//   npm run metrics                 # auto: live if configured, else seeded
//   npm run metrics -- --seeded     # force the offline seeded run
//   npm run metrics -- --days 30    # only cases from the last 30 days (live)
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeMetrics, pct } from "./compute.js";
import { renderDashboardHtml } from "./dashboard.js";
import { loadRowsFromPostgres } from "./source.js";
import { seedCaseHistory } from "./seed.js";
import { getPgPool, closePgPool } from "../shared/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "..", "demo", "metrics.html");

function parseArgs(argv) {
  const forceSeeded = argv.includes("--seeded");
  const daysIndex = argv.indexOf("--days");
  const sinceDays = daysIndex !== -1 && argv[daysIndex + 1] ? Number(argv[daysIndex + 1]) : null;
  return { forceSeeded, sinceDays };
}

async function main() {
  const { forceSeeded, sinceDays } = parseArgs(process.argv.slice(2));
  const pool = forceSeeded ? null : getPgPool();

  let rows;
  let sourceLabel;

  // THE DEPLOYED AUDIT API FIRST, when it is reachable and a key is held.
  // `getPgPool()` needs a raw TCP connection to 5432, which no environment
  // behind an HTTP CONNECT proxy can open — so on the machine where this
  // project is actually developed, `npm run metrics` died on ENETUNREACH and
  // the impact dashboard had NEVER BEEN GENERATED. Not a missing feature: a
  // missing habit, and on the one artifact that most directly shows whether
  // the automation is worth running.
  //
  // Opt-in by env rather than automatic, so nobody with a working database
  // silently gets the narrower decisions-only view instead of the real thing.
  const auditBase = process.env.METRICS_FROM_AUDIT_API;
  const portalKey = process.env.PORTAL_ACCESS_KEY;
  if (!forceSeeded && auditBase) {
    const { loadRowsFromAuditApi } = await import("./source.js");
    rows = await loadRowsFromAuditApi({ baseUrl: auditBase, portalKey });
    // The label carries the limitation, because a reader who does not know
    // these are decisions rather than current state will read an approval rate
    // that is not there. `cases` and `audit_log` are never conflated in this
    // codebase and the dashboard must not be where that rule first breaks.
    sourceLabel = `deployed audit_log via ${auditBase} — DECISIONS AS MADE, not current state; no review outcomes`;
  } else if (pool) {
    rows = await loadRowsFromPostgres(pool, { sinceDays });
    sourceLabel = `Supabase${sinceDays ? ` (last ${sinceDays} days)` : ""}`;

    // An empty live database is a real state, not an error — but rendering a
    // dashboard of zeros helps nobody, so say what happened and use the seed
    // instead of silently showing nothing.
    if (rows.cases.length === 0) {
      console.log("No cases found in Supabase — falling back to a seeded offline run.\n");
      rows = await seedCaseHistory();
      sourceLabel = "seeded (live database was empty)";
    }
  } else {
    rows = await seedCaseHistory();
    sourceLabel = forceSeeded ? "seeded (forced)" : "seeded (no SUPABASE_DB_URL configured)";
  }

  const report = computeMetrics(rows);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, renderDashboardHtml(report));

  printSummary(report, sourceLabel);
  console.log(`\n📊 Dashboard written to ${OUT_PATH}`);

  await closePgPool();
}

function printSummary(report, sourceLabel) {
  const { totals, byUseCase, exceptionReasons } = report;
  const bar = "─".repeat(66);

  console.log(`${bar}\nCX Automation — impact metrics\nSource: ${sourceLabel}\n${bar}`);
  console.log(`  Cases handled          ${totals.cases}`);
  console.log(`  Auto-resolution rate   ${pct(totals.autoRate)}  (${totals.autoResolved} zero-touch)`);
  console.log(`  Human review           ${totals.humanReview}`);
  console.log(`  Escalated              ${totals.escalated}`);
  console.log(
    `  Safety invariants      ${totals.integrityBreaches === 0 ? "✅ holding (0 breaches)" : `❌ ${totals.integrityBreaches} BREACH(ES)`}`
  );
  console.log(
    `  Estimated LLM spend    $${report.costs.totalUsd.toFixed(4)}` +
      (report.costs.perResolvedCase === null
        ? `  (${report.costs.callsPriced} priced call(s), no resolved case yet)`
        : `  ($${report.costs.perResolvedCase.toFixed(4)}/resolved case, ${report.costs.callsPriced} priced call(s))`)
  );

  if (exceptionReasons.length > 0) {
    console.log(`\n  Top reasons cases did NOT auto-resolve:`);
    for (const r of exceptionReasons.slice(0, 5)) {
      console.log(`    ${String(r.count).padStart(4)}  ${r.reason.padEnd(28)} ${pct(r.share)} of exceptions`);
    }
    console.log(`    → the top row is the next thing worth engineering.`);
  }

  console.log(`\n  Verdicts:`);
  for (const u of byUseCase) {
    console.log(`    ${u.useCase} [${u.tier}]  ${u.verdict.toUpperCase()} — ${u.rationale}`);
  }
}

await main();
