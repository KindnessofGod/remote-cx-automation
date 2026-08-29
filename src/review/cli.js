// ---------------------------------------------------------------------------
// cli.js  —  `npm run review-api`
// ---------------------------------------------------------------------------
// Starts the API that the ZAF sidebar (zaf-app/) calls.
//
// Same "works with nothing configured, uses the real thing when configured"
// pattern as the rest of the app:
//
//   SUPABASE_DB_URL set    → serve the real cases/review_queue from Supabase
//   unset                  → seed an in-memory store from the mock Remote API
//                            and serve that, so the sidebar is demonstrable
//                            with zero credentials
//
// The seeded mode exists because of an ordering problem worth naming: a sidebar
// has nothing to render until some ticket has been through the workflow. Rather
// than requiring a live Zendesk + Supabase round trip before the UI can be
// looked at, `--seeded` runs three real tickets through the REAL
// handleVerificationTicket and serves the resulting rows. The cases are
// genuine — the same gates, the same flags — only the storage is ephemeral.
//
// Usage:
//   npm run review-api                # auto: live if configured, else seeded
//   npm run review-api -- --seeded    # force the offline seeded run
//   npm run review-api -- --port 4020
// ---------------------------------------------------------------------------

import { startReviewServer } from "./server.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { resolveEntitlement } from "./approverEntitlement.js";
import { InMemoryReviewStore, PostgresReviewStore } from "./store.js";
import { AuditLogger } from "../shared/audit.js";
import { CaseStore } from "../shared/caseStore.js";
import { getPgPool } from "../shared/db.js";
import { config, isZendeskConfigured } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { RemoteClient } from "../remote/restClient.js";
import { ZendeskClient } from "../zendesk/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleVerificationTicket } from "../uc01/workflow.js";
import { classifyRequestRuleBased } from "../uc01/classifier.js";

const SEED_PORT = PORTS.UC01_SEED_MOCK; // mock Remote; registry-allocated — see src/shared/ports.js

/**
 * Three tickets that exercise the three states the sidebar must render:
 * a human_review it can action, an escalation it must refuse to action, and an
 * auto_resolve that never needed a human at all. Run through the real workflow.
 */
// G-3/L-8: the old `consentOnRecord: true` boolean is retired — a real,
// readable consent_records row is what verifies a disclosure now (VC-07). See
// `seedGrantedConsentArtifact()` below, called once before the tickets run.
const GRANTED_CONSENT_SEED = Object.freeze({ requestingParty: "First Bank", purpose: "Employment verification" });

const SEED_TICKETS = [
  {
    externalRef: "2001",
    text: "This is First Bank, we need to verify this employee's employment.",
    session: null,
    employmentId: "emp_active_001",
    // Scoped to the artifact `seedGrantedConsentArtifact()` writes — clears
    // identity, still goes to a human — third-party disclosure is never zero-touch.
    requestingParty: GRANTED_CONSENT_SEED.requestingParty,
    purpose: GRANTED_CONSENT_SEED.purpose,
  },
  {
    externalRef: "2002",
    text: "Please complete the attached verification form.",
    session: { authenticatedEmploymentId: "emp_active_001" },
    employmentId: "emp_active_001",
    hasAttachment: true,
  },
  {
    externalRef: "2003",
    text: "I need a standard employment letter.",
    session: { authenticatedEmploymentId: "emp_terminated_002" },
    employmentId: "emp_terminated_002", // terminated → escalate, must NOT be approvable
  },
  {
    externalRef: "2004",
    text: "Please send a standard employment verification letter.",
    session: { authenticatedEmploymentId: "emp_active_001" },
    employmentId: "emp_active_001", // clean auto_resolve — no human needed
  },
];

/**
 * G-3/L-8: writes the one GRANTED, COMPLETE consent_records row ticket 2001
 * needs to find so it still reaches a human (VC-07 — never zero-touch, even
 * with consent). The case it hangs off is not one of the three demonstrable
 * seed cases: it carries no review_queue row, so `GET /api/review/tickets`
 * (scoped by review_queue membership, not by `cases` membership) never shows it.
 */
async function seedGrantedConsentArtifact(caseStore) {
  const seedCase = caseStore.createCase({
    useCase: "UC-01",
    employmentId: "emp_active_001",
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  caseStore.createConsentRecord({
    caseId: seedCase.id,
    consentType: "third_party_verification",
    status: "granted",
    source: "review_seed",
    requestingParty: GRANTED_CONSENT_SEED.requestingParty,
    purpose: GRANTED_CONSENT_SEED.purpose,
    grantedByEmploymentId: "emp_active_001",
    grantedBySignal: "review_seed",
    grantedAt: new Date().toISOString(),
  });
}

async function seed(caseStore, audit, remote) {
  await seedGrantedConsentArtifact(caseStore);
  for (const ticket of SEED_TICKETS) {
    // Rule-based classifier forced, exactly as demo.js does: seeding must not
    // make a billed OpenAI call just because this machine has a real .env.
    await handleVerificationTicket(
      { ...ticket, source: "zendesk" },
      { remote, audit, caseStore, classify: classifyRequestRuleBased }
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC01_REVIEW_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const caseStore = new CaseStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  let store;
  let mockServer = null;
  let remote;

  if (pgPool) {
    store = new PostgresReviewStore(pgPool);
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (live cases/review_queue)");
  } else {
    mockServer = await startMockServer(SEED_PORT);
    remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
    await seed(caseStore, audit, remote);
    store = new InMemoryReviewStore(caseStore);
    console.log(
      `▶ Source: seeded in-memory store — ${caseStore.cases.length} cases ` +
        `(${caseStore.reviewQueue.length} awaiting review). Nothing is persisted.`
    );
  }

  // Zendesk is optional here for the same reason it is in workflow.js: without
  // it the decision is still recorded and audited, it just isn't posted back to
  // a real ticket. That keeps the demo runnable with no Zendesk account.
  const zendesk = isZendeskConfigured()
    ? new ZendeskClient({
        subdomain: config.zendesk.subdomain,
        email: config.zendesk.email,
        apiToken: config.zendesk.apiToken,
        clientId: config.zendesk.oauthClientId,
        clientSecret: config.zendesk.oauthClientSecret,
      })
    : null;

  // SIGNED IDENTITY (finding F-20) — and this file is the one that never got
  // the fix.
  //
  // Commit 39a7e33 moved all four approval APIs off "required only if someone
  // remembered to set a flag" and onto `signedIdentityRequired()`, whose
  // default is: A DURABLE STORE IS ATTACHED, therefore this decision will
  // outlive the process and name a human, therefore it must have come from a
  // signature. UC-04, UC-05, UC-06 and UC-09 all call it. This one kept
  // reading the raw env var, so `npm run review-api` against the live Supabase
  // printed "Trusting the X-ZAF-Approver header" and meant it — the UC-01
  // approval API, the one the installed ZAF sidebar actually drives, accepted
  // an approve or a decline from anyone who could set a header, and wrote it to
  // the real `audit_log` under whatever name that header carried.
  //
  // That is exactly the shape 39a7e33's own note warned about: the secure path
  // EXISTING is not the same claim as the secure path RUNNING. Four services
  // adopting a safe default while the fifth reads the old flag is
  // indistinguishable from all five being fixed, unless you start the fifth
  // one and read its banner.
  //
  // Fail-closed either way: with no verifier configured every approve/decline is
  // refused outright rather than quietly falling back to trusting a name in
  // the request. A seeded in-memory run keeps the header posture, so a fresh
  // clone with no credentials still demonstrates the flow.
  const requireSignedIdentity = signedIdentityRequired(process.env, { persistent: Boolean(pgPool) });
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("review-api") : null;
  if (requireSignedIdentity && !zafVerifier) {
    // Name the reason the requirement is on. It used to say
    // "ZAF_REQUIRE_SIGNED_IDENTITY=true but…", which is now the less common of
    // the two causes and simply wrong on a live deployment — the env var is
    // unset there and the attached store is what turned this on. A warning that
    // misnames its own trigger sends whoever reads it to check the wrong thing.
    const why =
      process.env.ZAF_REQUIRE_SIGNED_IDENTITY === "true"
        ? "ZAF_REQUIRE_SIGNED_IDENTITY=true"
        : "a durable Supabase store is attached, so approvals outlive this process";
    console.warn(
      `⚠ Signed ZAF identity is required here (${why}) but no verifier could be configured — every ` +
        "state-changing call will be refused (signed_identity_not_configured). Set " +
        "ZAF_SHARED_SECRET to the same value as the sidebar's `cxSharedSecret` secure setting " +
        "(HS256 — what zaf-app/ signs with). ZAF_APP_PUBLIC_KEY_PEM / ZAF_APP_ID are the RS256 " +
        "server-side-app mechanism instead, and setting one alongside the shared secret is refused. " +
        "See .env.example."
    );
  }

  // ROLE ENTITLEMENT (docs/APPROVAL-ROUTING.md §1.3, K10). Signed identity
  // answers WHO is approving; this answers whether they may hold the role
  // they are approving as — the gap this file itself sat behind until K10.
  // Same discriminator as requireSignedIdentity above: enforced when a
  // durable store is attached, not enforced for the seeded in-memory demo,
  // so a fresh clone still approves. Required-but-unconfigured refuses by its
  // own name (approver_entitlement_not_configured) rather than falling open.
  const { entitlement, required: entitlementEnforced, source: entitlementSource, warning: entitlementWarning } =
    resolveEntitlement(process.env, { persistent: Boolean(pgPool) });
  if (entitlementWarning) console.warn(`⚠ ${entitlementWarning}`);

  const server = await startReviewServer(
    {
      store,
      caseStore,
      audit,
      remote,
      zendesk,
      allowedOrigin: process.env.ZAF_ALLOWED_ORIGIN || "*",
      requireSignedIdentity,
      zafVerifier,
      entitlement,
    },
    port
  );

  console.log(`▶ Review API listening on http://localhost:${port}`);
  console.log(
    `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}`
  );
  console.log(`   GET  /api/review/tickets`);
  console.log(`   GET  /api/review/ticket/:ticketId`);
  console.log(`   POST /api/review/ticket/:ticketId/approve|decline`);
  console.log(`        (\`deny\` still accepted — the installed ZAF bundle posts it)`);
  if (requireSignedIdentity) {
    console.log(
      zafVerifier
        ? "   ▶ Signed ZAF identity REQUIRED and verifier configured — X-ZAF-Approver is ignored."
        : "   ⚠ Signed ZAF identity REQUIRED but NOT configured — every approve/decline will 401."
    );
  } else {
    // Only reachable on a seeded in-memory run now, since an attached pgPool
    // requires signed identity by default. Say WHICH condition put it here, so
    // the banner cannot go on describing a posture the code has left behind.
    console.log(
      "   (No durable store attached, so the X-ZAF-Approver header is trusted — this is the seeded demo posture. " +
        "Attaching Supabase requires a signed ZAF identity automatically; ZAF_REQUIRE_SIGNED_IDENTITY=true forces it here too.)"
    );
  }
  if (!zendesk) console.log("   (Zendesk not configured — decisions are recorded but not posted to a ticket)");
  for (const t of SEED_TICKETS.filter(() => !pgPool)) {
    console.log(`   seeded ticket ${t.externalRef}`);
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
