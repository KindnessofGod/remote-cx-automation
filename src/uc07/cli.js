// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc07-api`
// ---------------------------------------------------------------------------
// Starts UC-07's read-only dossier API on :4054. Same "live if configured,
// else seeded" pattern as review/cli.js and uc08/cli.js — except there is no
// mock server to start at all, because handleRelocationReview() takes no
// remote/zendesk dependency in the first place (see workflow.js's header).
// "Live" here only ever means "real OpenAI parsing/narrative, real Supabase
// persistence" — never a real write anywhere, because there is nowhere to
// write to.
//
//   SUPABASE_DB_URL set   -> serve real dossiers from the real
//                            uc07_dossiers table (still seeds a couple through
//                            the actual workflow first run, so there's
//                            something to look at immediately)
//   unset                 -> in-memory only
//
// Usage:
//   npm run uc07-api                # auto: live if configured, else seeded
//   npm run uc07-api -- --seeded    # force the offline in-memory run
//   npm run uc07-api -- --port 4054
// ---------------------------------------------------------------------------

import { startUc07Server } from "./server.js";
import { DossierStore } from "./dossierStore.js";
import { AuditLogger } from "../shared/audit.js";
import { handleRelocationReview } from "./workflow.js";
import { parseRelocationRuleBased } from "./relocationParser.js";
import { getPgPool } from "../shared/db.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";

const SEED_RELOCATIONS = [
  {
    label: "feasible relocation — Spain → Netherlands (month-end aligned)",
    externalRef: "9001",
    employmentId: "emp_active_001",
    source: "seed",
    text: "We're permanently relocating our engineer from Spain to the Netherlands. She already has the right to work there. Source last working day June 30, destination start July 1.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 6500000,
      currency: "EUR",
      months: 12,
      minimumVisaSalaryRemoteInteger: 5500000,
      transferFeeRemoteInteger: 150000,
      creationDate: "2026-05-01",
      proposedStartDate: "2026-07-01",
      destinationStartDate: "2026-07-01",
      sourceTerminationDate: "2026-06-30",
      sourceLastWorkingDay: "2026-06-30",
      minimumOnboardingLeadTimeBusinessDays: 20,
      immigrationSupportRequired: false,
      immigrationConfirmed: true,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
      employerPresenceInDestination: true,
      taxTreatyNexusConfirmed: true,
      ptoTransferAllowed: true,
      sourcePtoDays: 12,
      seniorityPreservable: true,
    },
  },
  {
    label: "blocked relocation — destination country unsupported + salary below visa minimum",
    externalRef: "9002",
    employmentId: "emp_active_001",
    source: "seed",
    text: "Moving our contractor to Antarctica full time. The destination isn't on the supported list and the salary offered is below the visa minimum.",
    plan: {
      destinationSupported: false,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 4000000,
      currency: "USD",
      months: 12,
      minimumVisaSalaryRemoteInteger: 5500000,
      creationDate: "2026-05-01",
      proposedStartDate: "2026-06-30",
      destinationStartDate: "2026-06-30",
      sourceTerminationDate: "2026-06-15",
      sourceLastWorkingDay: "2026-06-12",
      minimumOnboardingLeadTimeBusinessDays: 20,
      immigrationSupportRequired: false,
      immigrationConfirmed: false,
      rightToWorkConfirmed: false,
      destinationStartDateConfirmed: false,
      sourceExitPlanValidated: false,
      employerPresenceInDestination: false,
      taxTreatyNexusConfirmed: false,
      ptoTransferAllowed: false,
      sourcePtoDays: 18,
      seniorityPreservable: null,
    },
  },
  {
    label: "review required — immigration + PE risk + PTO liquidation + duplicate-fee risk",
    externalRef: "9003",
    employmentId: "emp_active_001",
    source: "seed",
    text: "Relocating our product manager from France to Germany. She can work there, but the immigration assessment isn't done, dates overlap by two weeks, PTO won't transfer, and we're unsure about seniority continuity.",
    plan: {
      destinationSupported: true,
      destinationEntityActive: true,
      annualGrossSalaryRemoteInteger: 7200000,
      currency: "EUR",
      months: 12,
      minimumVisaSalaryRemoteInteger: 5800000,
      creationDate: "2026-06-01",
      proposedStartDate: "2026-07-01",
      destinationStartDate: "2026-07-01",
      sourceTerminationDate: "2026-07-15",
      sourceLastWorkingDay: "2026-07-14",
      minimumOnboardingLeadTimeBusinessDays: 20,
      immigrationSupportRequired: true,
      immigrationConfirmed: false,
      rightToWorkConfirmed: true,
      destinationStartDateConfirmed: true,
      sourceExitPlanValidated: true,
      employerPresenceInDestination: false,
      taxTreatyNexusConfirmed: false,
      ptoTransferAllowed: false,
      sourcePtoDays: 15,
      seniorityPreservable: null,
    },
  },
];

async function seed(audit, dossierStore, classify) {
  const results = [];
  for (const req of SEED_RELOCATIONS) {
    const { label, ...ticket } = req;
    const result = await handleRelocationReview(ticket, { audit, dossierStore, classify });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC07_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const dossierStore = new DossierStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });
  // Hermetic classify override only when no OpenAI key is configured — same
  // "real if configured, else deterministic fallback" rule as every other
  // LLM seam in this repo. Passing the rule-based path explicitly here keeps
  // this script's own seeding predictable when run with no .env at all.
  const classify = isLlmConfigured() ? undefined : parseRelocationRuleBased;

  console.log(
    pgPool
      ? "▶ Source: Supabase Postgres (real uc07_dossiers)"
      : "▶ Source: seeded in-memory store — nothing is persisted."
  );

  const seeded = await seed(audit, dossierStore, classify);
  if (pgPool) await dossierStore.flush();

  const server = await startUc07Server({ dossierStore }, port);

  console.log(`▶ UC-07 API listening on http://localhost:${port}`);
  console.log(`   GET  /api/dossiers/:id`);
  console.log(`   GET  /api/dossiers/by-ticket/:externalRef`);
  console.log(`   (no POST route exists — this use case has no execution path, see src/uc07/workflow.js)\n`);
  for (const s of seeded) {
    console.log(`   dossier ${s.dossierId} — ${s.label} (decision: ${s.decision}, verdict: ${s.dossier.verdict})`);
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
