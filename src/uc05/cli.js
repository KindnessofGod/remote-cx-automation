// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc05-api`
// ---------------------------------------------------------------------------
// Starts UC-05's HTTP API on port 4053 (per the ticket's "use exactly this
// port" requirement). Same "live if configured, else seeded" pattern as
// review/cli.js, uc06/cli.js, uc08/cli.js:
//
//   SUPABASE_DB_URL set   -> serve real resignations from the real
//                            uc05_resignations table (still seeds 3 through
//                            the actual workflow first run, so there's
//                            something to look at immediately)
//   unset                 -> in-memory only, seeded against the mock Remote
//
// There is no Zendesk/Remote write to invoke on sign-off (the spec confirms
// no such endpoint exists), so the CLI's "live if configured" only ever
// means "real OpenAI classification/letter extraction, real Supabase
// persistence" — never a real write anywhere, same posture as UC-08.
//
// Usage:
//   npm run uc05-api                # auto: live if configured, else seeded
//   npm run uc05-api -- --seeded    # force the offline in-memory run
//   npm run uc05-api -- --port 4053
// ---------------------------------------------------------------------------

import { startUc05Server } from "./server.js";
import { ResignationStore } from "./resignationStore.js";
import { AuditLogger } from "../shared/audit.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleResignationRequest } from "./workflow.js";
import { getPgPool } from "../shared/db.js";
import { config } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { resolveEntitlement } from "../review/approverEntitlement.js";

const SEED_PORT = PORTS.UC05_SEED_MOCK; // registry-allocated; see src/shared/ports.js

/** Three resignations exercising the three states the API must render correctly. */
const SEED_REQUESTS = [
  {
    label: "UK standard resignation, proposed LWD within statute -> prepared for HR Ops sign-off",
    externalRef: "5001",
    employmentId: "emp_uk_001",
    session: { authenticatedEmploymentId: "emp_uk_001" },
    proposedEndDate: "2026-09-15",
    reason: "new opportunity",
    now: "2026-08-16",
  },
  {
    label: "DE mid-month submit, statutory 4-week notice with month_15 anchor -> anchored end date",
    externalRef: "5002",
    employmentId: "emp_de_001",
    session: { authenticatedEmploymentId: "emp_de_001" },
    proposedEndDate: "2026-10-31",
    reason: "relocation",
    now: "2026-08-10",
  },
  {
    label: "PL standard resignation, proposed LWD shorter than statutory 3-month notice -> discrepancy escalates",
    externalRef: "5003",
    employmentId: "emp_pl_001",
    session: { authenticatedEmploymentId: "emp_pl_001" },
    proposedEndDate: "2026-08-31",
    reason: "family reasons",
    now: "2026-07-25",
  },
];

async function seed(remote, audit, resignationStore) {
  const results = [];
  for (const req of SEED_REQUESTS) {
    const { label, ...ticket } = req;
    const result = await handleResignationRequest(ticket, { remote, audit, resignationStore });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC05_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const resignationStore = new ResignationStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  let mockServer = null;
  let remote;
  if (pgPool) {
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (real uc05_resignations) + Remote " + (config.remote.token ? "Sandbox" : "mock"));
  } else {
    mockServer = await startMockServer(SEED_PORT);
    remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
    console.log("▶ Source: seeded in-memory store — nothing is persisted.");
  }

  const seeded = await seed(remote, audit, resignationStore);
  if (pgPool) await resignationStore.flush(); // confirm the seed rows actually land before serving

  // SIGNED IDENTITY (finding F-20). Signed identity is now the default
  // WHENEVER A REAL STORE IS ATTACHED, rather than only when someone
  // remembered to set a flag — an approval that will outlive this process and
  // name a human must have come from a signature. A seeded in-memory run is
  // the demo, and keeps the header posture so a fresh clone still works.
  //
  // Fail-closed either way: with no verifier configured, every approve/decline is
  // refused outright. It never quietly drops back to trusting a name in the
  // request, because a service that downgrades its auth under misconfiguration
  // has no auth.
  const requireSignedIdentity = signedIdentityRequired(process.env, { persistent: Boolean(pgPool) });
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("uc05-api") : null;
  if (requireSignedIdentity && !zafVerifier) {
    console.warn(
      "⚠ Signed approver identity is required here (a durable store is attached) but no " +
        "verifier could be configured — every approve/decline will be refused " +
        "(signed_identity_not_configured). Provision the ZAF verifier, or set " +
        "ZAF_ALLOW_UNSIGNED_IDENTITY=true to accept the demo posture deliberately. See .env.example."
    );
  }

  // ROLE ENTITLEMENT (docs/APPROVAL-ROUTING.md §1.3). Signed identity answers
  // WHO is approving; this answers whether they may hold the role they are
  // approving as, which nothing asked before. Same discriminator, deliberately:
  // enforced when a durable store is attached, not enforced for the seeded
  // in-memory demo, so a fresh clone still approves. Required-but-unconfigured
  // refuses by its own name (approver_entitlement_not_configured) rather than
  // falling open.
  const { entitlement, required: entitlementEnforced, source: entitlementSource, warning: entitlementWarning } =
    resolveEntitlement(process.env, { persistent: Boolean(pgPool) });
  if (entitlementWarning) console.warn(`⚠ ${entitlementWarning}`);

  const server = await startUc05Server({ resignationStore, audit, remote, requireSignedIdentity, zafVerifier, entitlement }, port);

  console.log(`▶ UC-05 API listening on http://localhost:${port}`);
  console.log(
    `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}`
  );
  console.log(`   GET  /api/resignations/:id`);
  console.log(`   GET  /api/resignations/by-ticket/:externalRef`);
  console.log(`   POST /api/resignations/:id/signoff   body: {approver, note}`);
  console.log(`   POST /api/resignations/:id/decline   body: {approver, note}`);
  console.log(`        (\`deny\` still accepted — the installed ZAF bundle posts it)`);
  console.log(`   (no Remote write route — UC-05.md §3 confirms no confirmed Remote write endpoint exists)\n`);
  for (const s of seeded) {
    console.log(`   resignation ${s.resignationId} — ${s.label} (decision: ${s.decision})`);
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
      mockServer?.close();
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
