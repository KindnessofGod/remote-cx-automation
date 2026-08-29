// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc08-api`
// ---------------------------------------------------------------------------
// Starts UC-08's read-only dossier API. Same "live if configured, else
// seeded" pattern as review/cli.js and uc06/cli.js — except there is no mock
// server to start at all, because handleTaxInquiry() takes no remote/zendesk
// dependency in the first place (see workflow.js's header). "Live" here only
// ever means "real OpenAI classification/narrative, real Supabase
// persistence" — never a real write anywhere, because there is nowhere to
// write to.
//
//   SUPABASE_DB_URL set   -> serve real dossiers from the real
//                            uc08_dossiers table (still seeds a couple through
//                            the actual workflow first run, so there's
//                            something to look at immediately)
//   unset                 -> in-memory only
//
// Usage:
//   npm run uc08-api                # auto: live if configured, else seeded
//   npm run uc08-api -- --seeded    # force the offline in-memory run
//   npm run uc08-api -- --port 4023
// ---------------------------------------------------------------------------

import { startUc08Server } from "./server.js";
import { DossierStore } from "./dossierStore.js";
import { AuditLogger } from "../shared/audit.js";
import { handleTaxInquiry } from "./workflow.js";
import { parseInquiryRuleBased } from "./inquiryParser.js";
import { getPgPool } from "../shared/db.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";

const SEED_INQUIRIES = [
  {
    label: "dual residency — Germany / Spain",
    externalRef: "8001",
    employmentId: "emp_active_001",
    source: "seed",
    text: "I've been splitting my time between Germany and Spain this year and I think I may be a dual resident of both countries for tax purposes. Can you help?",
  },
  {
    label: "183-day withholding threshold — UK assignment",
    externalRef: "8002",
    employmentId: "emp_active_001",
    source: "seed",
    text: "I've been asked to work from our London office for a few months. Do we need to withhold UK payroll tax for this?",
    presencePeriods: [{ country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" }],
    targetCountry: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  },
  {
    label: "totalization — A1 certificate request",
    externalRef: "8003",
    employmentId: "emp_active_001",
    source: "seed",
    text: "We need an A1 certificate of coverage for a short-term assignment to France so the employee stays on home-country social security.",
  },
];

async function seed(audit, dossierStore, classify) {
  const results = [];
  for (const req of SEED_INQUIRIES) {
    const { label, ...ticket } = req;
    const result = await handleTaxInquiry(ticket, { audit, dossierStore, classify });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC08_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const dossierStore = new DossierStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });
  // Hermetic classify override only when no OpenAI key is configured — same
  // "real if configured, else deterministic fallback" rule as every other
  // LLM seam in this repo. classify=parseInquiry (the default) already does
  // this internally, but passing the rule-based path explicitly here keeps
  // this script's own seeding predictable when run with no .env at all.
  const classify = isLlmConfigured() ? undefined : parseInquiryRuleBased;

  console.log(
    pgPool
      ? "▶ Source: Supabase Postgres (real uc08_dossiers)"
      : "▶ Source: seeded in-memory store — nothing is persisted."
  );

  const seeded = await seed(audit, dossierStore, classify);
  if (pgPool) await dossierStore.flush();

  const server = await startUc08Server({ dossierStore }, port);

  console.log(`▶ UC-08 API listening on http://localhost:${port}`);
  console.log(`   GET  /api/dossiers/:id`);
  console.log(`   GET  /api/dossiers/by-ticket/:externalRef`);
  console.log(`   (no POST route exists — this use case has no execution path, see src/uc08/workflow.js)\n`);
  for (const s of seeded) {
    console.log(`   dossier ${s.dossierId} — ${s.label} (decision: ${s.decision})`);
  }

  const shutdown = () => {
    // Stop accepting new connections; let in-flight requests finish. If any
    // connection is still open after the grace period (e.g. an idle
    // keep-alive), force it closed rather than hang the process forever.
    const forceExit = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, 10_000);
    forceExit.unref();
    server.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
