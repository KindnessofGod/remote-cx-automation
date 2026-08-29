// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc06-api`
// ---------------------------------------------------------------------------
// Starts UC-06's dual-approval API. Same "live if configured, else seeded"
// pattern as review/cli.js:
//
//   SUPABASE_DB_URL set   -> serve real amendments from the real
//                            uc06_amendments table (still seeds 3 through the
//                            actual workflow first run, same as review-api,
//                            so there's something to look at immediately)
//   unset                 -> in-memory only, seeded against the mock Remote
//
// Usage:
//   npm run uc06-api                # auto: live if configured, else seeded
//   npm run uc06-api -- --seeded    # force the offline in-memory run
//   npm run uc06-api -- --port 4021
// ---------------------------------------------------------------------------

import { startUc06Server } from "./server.js";
import { AmendmentStore } from "./amendmentStore.js";
import { AuditLogger } from "../shared/audit.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleAmendmentRequest } from "./workflow.js";
import { getPgPool } from "../shared/db.js";
import { config } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { resolveEntitlement } from "../review/approverEntitlement.js";

const SEED_PORT = PORTS.UC06_SEED_MOCK; // registry-allocated; see src/shared/ports.js

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

/**
 * Three amendments exercising the three states the API must render correctly.
 *
 * `expect` IS PART OF THE SEED, NOT DECORATION. Every one of these used to name
 * a NIGERIAN employment (`emp_active_001`), and Remote publishes no
 * contract-amendment form for NGA — the schema endpoint answers 500 — so all
 * three escalated `country_schema_unavailable` at a gate two steps ahead of the
 * one each label described. The startup banner then printed
 * `"before cutoff, awaiting dual approval (decision: escalate)"` and nobody
 * read the contradiction, so the ZAF sidebar's UC-06 panel had ZERO actionable
 * cases in every demo it has ever been given: the dual-approval controls, which
 * are the entire point of the use case, could not be reached from this API at
 * all. Production agrees — across 28 `audit_log` rows UC-06 has never once
 * recorded `dual_approval_required`.
 *
 * So the seeds now run against Dutch employments, which DO have a form, and
 * `seed()` asserts each one landed on the decision its label claims. A label
 * that disagrees with its row is the exact defect this file shipped; making it
 * crash the startup is the only thing that keeps a label honest, because a
 * label is not checked by anything else.
 */
const SEED_REQUESTS = [
  {
    label: "before cutoff, awaiting dual approval",
    expect: "dual_approval_required",
    externalRef: "3001",
    employmentId: "emp_nl_amend_001",
    session,
    changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "EUR" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-06-20",
  },
  {
    label: "cutoff already passed -> escalated, not actionable here",
    expect: "escalate",
    externalRef: "3002",
    employmentId: "emp_nl_amend_001",
    session,
    changes: { jobTitle: { oldValue: "Senior Software Engineer", newValue: "Staff Engineer" } },
    requestedEffectiveDate: "2026-06-15",
    now: "2026-06-20",
  },
  {
    label: "within 48h of cutoff -> urgent_cutoff flag, still awaiting dual approval",
    expect: "dual_approval_required",
    externalRef: "3003",
    employmentId: "emp_nl_amend_003",
    session,
    changes: { jobTitle: { oldValue: "Product Designer", newValue: "Lead Product Designer" } },
    requestedEffectiveDate: "2026-07-15",
    now: "2026-07-09",
  },
];

async function seed(remote, audit, amendmentStore) {
  const results = [];
  const wrong = [];
  for (const req of SEED_REQUESTS) {
    const { label, expect, ...ticket } = req;
    const result = await handleAmendmentRequest(ticket, { remote, audit, amendmentStore });
    // A seed whose decision contradicts its own label is a demo that lies, and
    // the last time it happened it survived for the whole life of the use case
    // because the banner printed both strings side by side and nobody compared
    // them. Comparing them is one line; failing loudly is what makes the label
    // mean something. `reason` rides along because "escalate" is right for the
    // cutoff seed and wrong for the schema outage, and only the reason says
    // which one actually happened.
    if (expect && result.decision !== expect) {
      wrong.push(`   ${label}\n      expected ${expect}, got ${result.decision} (${result.reason})`);
    }
    results.push({ label, expect, ...result });
  }
  if (wrong.length) {
    throw new Error(
      `UC-06 seeding produced decisions its own labels contradict:\n${wrong.join("\n")}\n` +
        `The seed fixtures and the gates disagree — fix one of them before serving this API.`
    );
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC06_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const amendmentStore = new AmendmentStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  let mockServer = null;
  let remote;
  if (pgPool) {
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (real uc06_amendments) + Remote " + (config.remote.token ? "Sandbox" : "mock"));
  } else {
    mockServer = await startMockServer(SEED_PORT);
    remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
    console.log("▶ Source: seeded in-memory store — nothing is persisted.");
  }

  const seeded = await seed(remote, audit, amendmentStore);
  if (pgPool) await amendmentStore.flush(); // confirm the seed rows actually land before serving

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
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("uc06-api") : null;
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

  const server = await startUc06Server({ amendmentStore, audit, remote, requireSignedIdentity, zafVerifier, entitlement }, port);

  console.log(`▶ UC-06 API listening on http://localhost:${port}`);
  console.log(
    `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}`
  );
  console.log(`   GET  /api/amendments/:id`);
  console.log(`   GET  /api/amendments/by-ticket/:externalRef`);
  console.log(`   POST /api/amendments/:id/approve|decline   body: {role, approver, note}`);
  console.log(`        (\`deny\` still accepted — the installed ZAF bundle posts it)`);
  console.log(`   roles: "customer_admin" | "payroll_specialist" — both required before it executes\n`);
  for (const s of seeded) {
    console.log(`   amendment ${s.amendmentId} — ${s.label} (decision: ${s.decision})`);
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
