// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc03-api`
// ---------------------------------------------------------------------------
// Starts UC-03's case API (three sign-off write routes; not read-only). Same "live if configured, else seeded"
// pattern as uc06/cli.js (UC-03's workflow needs a Remote read — employment +
// supported countries — so the offline path seeds against the local mock
// server rather than a real account):
//
//   SUPABASE_DB_URL set   -> serve real cases from the real `cases` table
//                            (still seeds a few through the actual workflow
//                            first run, so there's something to look at)
//   unset                 -> in-memory only, seeded against the mock Remote
//
// Usage:
//   npm run uc03-api                # auto: live if configured, else seeded
//   npm run uc03-api -- --seeded    # force the offline in-memory run
//   npm run uc03-api -- --port 4051
// ---------------------------------------------------------------------------

import { startUc03Server } from "./server.js";
import { CaseStore } from "../shared/caseStore.js";
import { AuditLogger } from "../shared/audit.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleTravelInquiry } from "./workflow.js";
import { classifyTravelInquiryRuleBased } from "./classifier.js";
import { getPgPool } from "../shared/db.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { resolveEntitlement } from "../review/approverEntitlement.js";
import { config } from "../shared/config.js";
import { isLlmConfigured } from "../shared/llm.js";
import { PORTS } from "../shared/ports.js";

const SEED_PORT = PORTS.UC03_SEED_MOCK; // registry-allocated; see src/shared/ports.js

const sessionFor = (employmentId) => ({ authenticatedEmploymentId: employmentId });

/** Three inquiries exercising the three outcomes the API must render correctly. */
const SEED_INQUIRIES = [
  {
    label: "short business trip to Spain — auto-resolved with an informational answer",
    externalRef: "9001",
    employmentId: "emp_active_001",
    session: sessionFor("emp_active_001"),
    text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
  },
  {
    label: "workation from Portugal — routed to UC-04 work authorization",
    externalRef: "9002",
    employmentId: "emp_active_001",
    session: sessionFor("emp_active_001"),
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
  },
  {
    label: "formal travel letter for a conference in Germany — awaiting specialist sign-off",
    externalRef: "9003",
    employmentId: "emp_active_001",
    session: sessionFor("emp_active_001"),
    text: "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
  },
];

async function seed(remote, audit, caseStore, classify) {
  const results = [];
  for (const req of SEED_INQUIRIES) {
    const { label, ...ticket } = req;
    const result = await handleTravelInquiry(ticket, { remote, audit, caseStore, classify });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC03_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const caseStore = new CaseStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  let mockServer = null;
  let remote;
  if (pgPool) {
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (real cases) + Remote " + (config.remote.token ? "Sandbox" : "mock"));
  } else {
    mockServer = await startMockServer(SEED_PORT);
    remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
    console.log("▶ Source: seeded in-memory store — nothing is persisted.");
  }

  // Hermetic classify override only when no OpenAI key is configured — same
  // "real if configured, else deterministic fallback" rule as every other
  // LLM seam in this repo (see uc08/cli.js).
  const classify = isLlmConfigured() ? undefined : classifyTravelInquiryRuleBased;

  const seeded = await seed(remote, audit, caseStore, classify);
  if (pgPool) await caseStore.flush(); // confirm the seed rows actually land before serving

  // SAME POSTURE INPUT AS EVERY OTHER APPROVAL API. A durable store attached
  // means the decision outlives this process and names a human, so identity is
  // signed and role entitlement is enforced; a seeded in-memory run keeps the
  // header posture so a credential-free clone still demonstrates the sign-off.
  // One rule, not two — see src/shared/approverAuth.js and
  // src/review/approverEntitlement.js.
  const requireSignedIdentity = signedIdentityRequired(process.env, { persistent: Boolean(pgPool) });
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("uc03-api") : null;
  if (requireSignedIdentity && !zafVerifier) {
    console.warn(
      "⚠ Signed ZAF identity is required here and no verifier is configured — every read and every sign-off will " +
        "be refused until ZAF_SHARED_SECRET is set. That is the loud failure, on purpose."
    );
  }
  const { entitlement, required: entitlementEnforced, source: entitlementSource, warning: entitlementWarning } =
    resolveEntitlement(process.env, { persistent: Boolean(pgPool) });
  if (entitlementWarning) console.warn(`⚠ ${entitlementWarning}`);

  // NO ZENDESK CLIENT IS BUILT HERE, DELIBERATELY. A signed-off letter is posted
  // to the ticket only where a Zendesk client is wired — the deployment
  // (deploy/cx-apis/deps.js) does that. A local `npm run uc03-api` seeds against
  // the mock and its `externalRef`s name no real ticket, so a live client here
  // could only ever post a real letter onto somebody else's ticket id.
  const server = await startUc03Server(
    { caseStore, audit, remote, requireSignedIdentity, zafVerifier, entitlement },
    port
  );

  console.log(`▶ UC-03 API listening on http://localhost:${port}`);
  console.log(`   GET  /api/cases/:id`);
  console.log(`   GET  /api/cases/by-ticket/:externalRef`);
  console.log(`   POST /api/cases/:id/signoff   {note}          — issue the drafted travel letter`);
  console.log(`   POST /api/cases/:id/decline   {note REQUIRED} — refuse it`);
  console.log(
    `   The sign-off is the ONLY write route, and it applies to one decision: a drafted formal travel letter.\n` +
      `   A route_to_uc04 handoff, an escalation and an auto-resolved inquiry are each refused by name.\n` +
      `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}\n`
  );
  for (const s of seeded) {
    console.log(`   case ${s.caseId} — ${s.label} (decision: ${s.decision})`);
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
