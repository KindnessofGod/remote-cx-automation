// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc04-api`
// ---------------------------------------------------------------------------
// Starts UC-04's specialist-approval API. Same "live if configured, else
// seeded" pattern as uc06/cli.js and uc08/cli.js:
//
//   SUPABASE_DB_URL set   -> serve real authorizations from the real
//                            uc04_authorizations table (still seeds 3
//                            through the actual workflow first run, so
//                            there's something to look at immediately)
//   unset                 -> in-memory only, seeded against the mock Remote
//
// Usage:
//   npm run uc04-api                # auto: live if configured, else seeded
//   npm run uc04-api -- --seeded    # force the offline in-memory run
//   npm run uc04-api -- --port 4052
// ---------------------------------------------------------------------------

import { startUc04Server } from "./server.js";
import { AuthorizationStore } from "./authorizationStore.js";
import { AuditLogger } from "../shared/audit.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleWorkationRequest } from "./workflow.js";
import { getPgPool } from "../shared/db.js";
import { config } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { resolveEntitlement } from "../review/approverEntitlement.js";

const SEED_PORT = PORTS.UC04_SEED_MOCK; // registry-allocated; see src/shared/ports.js

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

// ---------------------------------------------------------------------------
// WHY THREE OF THESE SIX CARRY A TRAVEL HISTORY
// The first three seeds exercise the three STATES the API must render
// (awaiting approval / blocked / escalated) and every one of them sends
// `travelHistory: []`. That is a floor, not a count — nobody counted anything —
// and with it UC-04's two day thresholds could not be seen at work from this
// API at all: the Schengen 90-in-180 immigration limit and the 183-in-365
// tax-residency watch both need prior stays before they can measure anything.
// A threshold that never fires and one that fires correctly look identical
// from a seeded API, which is this repo's most expensive recurring defect
// (CLAUDE.md §4).
//
// So the last three seed both sides of both lines, and the pair that makes the
// distinction worth drawing: 4004 clears the Schengen limit with the figure and
// its headroom stated, 4005 breaches it, and 4006 is comfortably INSIDE the
// Schengen limit while PAST the residency watch — one stated history, two
// windows, two answers. `describeDecisionBasis()` renders each as its own
// measurement row with its own limit and window, which is what a mobility
// specialist opening the sidebar actually reads.
//
// EVERY TRAVEL HISTORY BELOW IS DEMO INPUT — a stay the requester states on the
// form, exactly like the visa type beside it. Nothing here was read from Remote
// and nothing pretends it was; `emp_active_001` is this repo's mock fixture.
//
// The dates are chosen so that both the single-window computation this code
// performs AND the per-day-of-stay computation Reg. (EU) 2016/399 Art. 6(1)
// actually prescribes land on the same verdict — finding C-1 in
// docs/knowledge/layer-1-statutory/CONTRADICTIONS.md is open, and a seed sitting
// near the boundary would demonstrate a number the regulation disputes.
// ---------------------------------------------------------------------------

/** Six workation requests: three decision states, then both sides of both day thresholds. */
const SEED_REQUESTS = [
  {
    label: "low-risk short Schengen trip -> awaiting specialist approval",
    externalRef: "4001",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [],
    now: "2026-08-15",
  },
  {
    label: "same-country workation -> blocked (hard refuse, not open to approval)",
    externalRef: "4002",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "NG",
      nationality: "NG",
      destination: { country: "NG" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay", // doesn't matter — same-country block fires first
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [],
    now: "2026-08-15",
  },
  {
    label: "sales role abroad -> escalated (high PE risk, not 1-click approval)",
    externalRef: "4003",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "GB" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "sales",
      hasContractSigningAuthority: true,
    },
    travelHistory: [],
    now: "2026-08-15",
  },
  {
    label: "Schengen days MEASURED and clear -> awaiting approval, 44 of 90 with 46 days of headroom",
    externalRef: "4004",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    // 30 stated days, inside both the 180-day and the 365-day window.
    travelHistory: [{ country: "ES", startDate: "2026-07-01", endDate: "2026-07-30" }],
    now: "2026-08-15",
  },
  {
    label: "Schengen 90/180 BREACHED -> blocked (141 of 90; no approval can override a hard block)",
    externalRef: "4005",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-21",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    // 120 stated days inside the trailing 180 — over on the trip's first day
    // under either computation, so the seed is not sensitive to finding C-1.
    travelHistory: [{ country: "ES", startDate: "2026-04-01", endDate: "2026-07-29" }],
    now: "2026-08-15",
  },
  {
    label: "THE TWO LIMITS DISAGREE -> awaiting approval: 59 of 90 Schengen days (inside), 210 of 183 residency days (past)",
    externalRef: "4006",
    employmentId: "emp_active_001",
    session,
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ES" },
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
    travelHistory: [
      // Inside BOTH windows.
      { country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" },
      // Inside the 365-day residency window, OUTSIDE the 180-day Schengen one.
      // That single fact is the entire reason the two thresholds answer
      // differently on identical input, and it is why the sidebar renders two
      // measurement rows rather than one number.
      { country: "ES", startDate: "2025-10-01", endDate: "2026-02-28" },
    ],
    now: "2026-08-15",
  },
];

async function seed(remote, audit, authorizationStore) {
  const results = [];
  for (const req of SEED_REQUESTS) {
    const { label, ...ticket } = req;
    const result = await handleWorkationRequest(ticket, { remote, audit, authorizationStore });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC04_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const authorizationStore = new AuthorizationStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  // THE SEED ALWAYS READS THE MOCK, WHATEVER THE SERVER READS (2026-08-30).
  //
  // The seed's six cases name `emp_active_001`, a MOCK fixture. It was being
  // built through whichever client the server uses — so on any machine with a
  // real REMOTE_API_TOKEN (which is every machine this is ever demonstrated
  // on) the Sandbox 404'd that id, `getEmployment()` returned null, and the
  // identity gate refused. All six seeded cases came up
  // `escalate / identity_not_verified`, and the sidebar's UC-04 demo has
  // therefore only ever shown six identity failures.
  //
  // It is the §3.30 shape this repo keeps paying for: "structurally cannot
  // succeed" and "appropriately cautious" look identical from outside, and the
  // gate was working perfectly the whole time. Invisible to the suite, too —
  // a test process has no token, so the mock answers and the seed succeeds.
  //
  // A fixture must be read from the world it belongs to. The server keeps the
  // configured client for real traffic; only the seed is pinned to the mock,
  // which is the same promise the portal already makes about its own personas.
  const mockServer = await startMockServer(SEED_PORT);
  const seedRemote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });

  let remote;
  if (pgPool) {
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (real uc04_authorizations) + Remote " + (config.remote.token ? "Sandbox" : "mock"));
    console.log("   Seed: mock fixtures (the six demo cases name mock employment ids, which a real Sandbox 404s).");
  } else {
    remote = seedRemote;
    console.log("▶ Source: seeded in-memory store — nothing is persisted.");
  }

  const seeded = await seed(seedRemote, audit, authorizationStore);
  if (pgPool) await authorizationStore.flush(); // confirm the seed rows actually land before serving

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
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("uc04-api") : null;
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

  const server = await startUc04Server({ authorizationStore, audit, remote, requireSignedIdentity, zafVerifier, entitlement }, port);

  console.log(`▶ UC-04 API listening on http://localhost:${port}`);
  console.log(
    `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}`
  );
  console.log(`   GET  /api/authorizations/:id`);
  console.log(`   GET  /api/authorizations/by-ticket/:externalRef`);
  console.log(`   POST /api/authorizations/:id/approve|decline   body: {approver, note}`);
  console.log(`        (\`deny\` still accepted — the installed ZAF bundle posts it)`);
  console.log(`   approver: single mobility specialist (UC-04 is single-approver HITL, not dual)\n`);
  for (const s of seeded) {
    console.log(`   authorization ${s.authorizationId} — ${s.label} (decision: ${s.decision})`);
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
