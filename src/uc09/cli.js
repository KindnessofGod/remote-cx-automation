// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc09-api`
// ---------------------------------------------------------------------------
// Starts UC-09's multi-approval API. Same "live if configured, else seeded"
// pattern as review/cli.js:
//
//   SUPABASE_DB_URL set   -> serve real adjustments from the real
//                            uc09_adjustments table (still seeds 3 through the
//                            actual workflow first run, same as review-api,
//                            so there's something to look at immediately)
//   unset                 -> in-memory only, seeded against the mock Remote
//
// Usage:
//   npm run uc09-api                # auto: live if configured, else seeded
//   npm run uc09-api -- --seeded    # force the offline in-memory run
//   npm run uc09-api -- --port 4055
// ---------------------------------------------------------------------------

import { startUc09Server } from "./server.js";
import { AdjustmentStore } from "./adjustmentStore.js";
import { AuditLogger } from "../shared/audit.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleAdjustmentRequest } from "./workflow.js";
import { getPgPool } from "../shared/db.js";
import { config } from "../shared/config.js";
import { PORTS } from "../shared/ports.js";
import { signedIdentityRequired } from "../shared/approverAuth.js";
import { buildZafVerifierFromEnv } from "../shared/zafVerifierFromEnv.js";
import { resolveEntitlement } from "../review/approverEntitlement.js";

const SEED_PORT = PORTS.UC09_SEED_MOCK; // registry-allocated; see src/shared/ports.js

// companyId MUST match the mock Remote employment's own company_id
// (mockServer.js: emp_active_001 -> company_id "co_amend_01") or the
// identity gate in policyEngine.js fails closed and every seeded request
// escalates with approvalSlotsRequired: 0 — found independently by two
// sessions: this one via `npm run walkthrough` exercising the seed over
// real HTTP (all three seeded adjustments escalated instead of
// demonstrating the 2-approval/3-approval flows their own labels promise),
// and the dashboard-verification session via the same symptom on the
// metrics dashboard (see docs/BUILD-LOG.md). "co_adjust_01" was a typo;
// every sibling UC's seed (uc04, uc05, uc06) already uses "co_amend_01"
// for the same employment.
//
// Fixing the company_id alone was NOT sufficient — see policyEngine.js's
// own INCENTIVE_REQUIRED_FIELDS comment for a second, deeper bug this
// session also found and fixed (workflow.js was validating the incentive
// payload against UC-06's employment_basic_information schema, not an
// incentive schema) that kept every seeded adjustment escalating even
// after this fix landed.
const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_mike" };

/**
 * Three adjustments exercising different approval requirements (2 vs 3 person
 * approval).
 *
 * STRUCTURED, NOT FREE TEXT — changed by finding F-10. These seeds used to be
 * `requestText: "Process a $5,000 performance bonus"`, which relied on the
 * parser's rule-based fallback to pull the figure out of the sentence. That
 * fallback no longer exists: an amount that is going to be PAID is never
 * guessed by a regex, and with no OPENAI_API_KEY configured (the normal state
 * for `npm run uc09-api`) the parser now refuses and every seed would escalate
 * with `amount_not_extracted`.
 *
 * Structured input is the trusted path and always was — and it is the path a
 * real Remote-native webhook would use. Amounts here are therefore in Remote's
 * ×100 integer form, exactly as workflow.js's structured branch documents:
 * 500000 = $5,000.00.
 */
const SEED_REQUESTS = [
  {
    label: "Standard bonus - needs 2 approvals",
    externalRef: "9001",
    employmentId: "emp_active_001",
    session,
    adjustmentRequest: {
      type: "bonus",
      amount: 500_000, // $5,000.00
      currency: "USD",
      // GROSS vs NET IS REQUIRED AND IS NEVER DEFAULTED — Remote's
      // `amount_tax_type`, the field that decides whether 500000 is what the
      // company pays or what the employee receives ("Remote will gross this
      // up"). A seed without it escalates `invalid_adjustment_structure`, which
      // is the correct behaviour and would make every seeded scenario a
      // refusal — so the seeds state it, as a real requester must.
      amountTaxType: "gross",
      description: "Annual performance bonus for John Doe",
    },
    reasonText: "Annual performance bonus",
    now: "2026-06-20",
  },
  {
    label: "High-value adjustment - needs 3 approvals",
    externalRef: "9002",
    employmentId: "emp_active_001",
    session,
    adjustmentRequest: {
      // `relocation_allowance`, not `relocation_topup`. The latter is not a
      // member of Remote's `CreateOneTimeIncentiveParams.type` enum and never
      // was; a payload carrying it 422s at the write, after the approvals.
      type: "relocation_allowance",
      amount: 1_500_000, // $15,000.00
      currency: "USD",
      amountTaxType: "gross",
      description: "Relocation top-up for Jane Smith",
    },
    reasonText: "Relocation assistance",
    now: "2026-06-20",
  },
  {
    label: "Manual tax adjustment - needs 3 approvals",
    externalRef: "9003",
    employmentId: "emp_active_001",
    session,
    adjustmentRequest: {
      type: "bonus",
      amount: 250_000, // $2,500.00
      currency: "USD",
      description: "Special project bonus with manual tax handling",
      // NET: the employee is to receive 2,500.00 after tax, so Remote grosses
      // it up and the company pays more than the integer sent. The seed that
      // exercises the third approval slot is deliberately the one where the
      // two readings differ most in cash.
      amountTaxType: "net",
      taxAdjustment: true,
    },
    reasonText: "Special project bonus with manual tax",
    now: "2026-06-20",
  },
  {
    // THE SEED THAT EXISTS TO BE READ, NOT TO BE APPROVED.
    //
    // Seeds 9002 and 9003 both reach three signatures for reasons a person can
    // check: an amount over the high-value line, and a manual tax adjustment
    // the requester stated. The THIRD reason cannot be checked by anybody —
    // `HIGH_TAX_COMPLEXITY_HEURISTIC` in policyEngine.js is three country codes
    // with no publishing authority, no version and no review date, and it
    // raises the signature requirement on the one use case that moves real
    // money. Until this seed there was no way to see that dimension fire: every
    // seeded adjustment used `emp_active_001` (country NG), so the only
    // demonstrable path to three signatures was one of the two sourced ones.
    //
    // `emp_de_001` (Lena Müller, DE, active, same `co_amend_01` company as
    // every other fixture, so the identity gate passes) with an amount well
    // under the high-value line and no tax adjustment isolates it: the ONLY
    // reason this adjustment needs a payment releaser is a list somebody
    // invented. That is exactly what the sidebar's basis panel is there to say
    // out loud — see src/uc09/decisionFacts.js's jurisdiction dimension.
    //
    // STATED IN USD DESPITE A GERMAN EMPLOYMENT, AND THE ODDITY IS THE POINT.
    // This seed said `currency: "EUR"`, which since the high-value threshold
    // became denominated (policyEngine.js) ALSO trips the not-comparable
    // dimension — so the adjustment would reach three signatures for two
    // reasons and the seed would no longer isolate the one it exists to show.
    // `currency` is our own request-record field and Remote ignores it
    // entirely ("Incentives use the currency of the employment"), so stating
    // USD here changes nothing about what would be paid; it only keeps this
    // fixture pointed at a single dimension. Seed 9005 below is the euro case.
    label: "Unsourced jurisdiction heuristic - needs 3 approvals for an uncited reason",
    externalRef: "9004",
    employmentId: "emp_de_001",
    session,
    adjustmentRequest: {
      type: "bonus",
      amount: 300_000, // $3,000.00 — deliberately far under the high-value line
      currency: "USD",
      amountTaxType: "gross",
      description: "Quarterly spot bonus for Lena Müller",
    },
    reasonText: "Quarterly spot bonus",
    now: "2026-06-20",
  },
  {
    // THE SEED FOR A DIMENSION THAT CANNOT ANSWER ITS OWN QUESTION.
    //
    // The high-value line is a stated policy figure denominated in ONE currency
    // (HIGH_AMOUNT_THRESHOLD_CURRENCY). A request in any other currency is not
    // small and not large — it is UNMEASURED, because converting would need an
    // exchange rate this system does not hold and must not invent on a payment
    // gate. An unknown on this dimension costs a third signature rather than
    // buying two, so this €3,000.00 bonus — a quarter of the size of seed 9002,
    // which needs three for genuinely being large — needs three as well.
    //
    // It is seeded because a gate nobody can watch fire is a gate nobody can
    // review, and because the two outcomes must be visibly different: 9002's
    // basis panel names an amount, a line, an overage and a percentage; this
    // one names a currency and says plainly that nothing about the amount was
    // established. `emp_pl_001` is a Polish employment, deliberately NOT on the
    // high-tax-complexity list, so this seed isolates the currency dimension
    // exactly as 9004 isolates the jurisdiction one.
    label: "Currency the high-value line is not stated in - needs 3 approvals for an UNMEASURED amount",
    externalRef: "9005",
    employmentId: "emp_pl_001",
    session,
    adjustmentRequest: {
      type: "bonus",
      amount: 300_000, // €3,000.00 — small, and that is exactly what cannot be established
      currency: "EUR",
      amountTaxType: "gross",
      description: "Quarterly spot bonus for Katarzyna Kowalski",
    },
    reasonText: "Quarterly spot bonus",
    now: "2026-06-20",
  },
];

async function seed(remote, audit, adjustmentStore) {
  const results = [];
  for (const req of SEED_REQUESTS) {
    const { label, ...ticket } = req;
    const result = await handleAdjustmentRequest(ticket, { remote, audit, adjustmentStore });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const forceSeeded = argv.includes("--seeded");
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC09_API;

  const pgPool = forceSeeded ? null : getPgPool();
  const adjustmentStore = new AdjustmentStore({ pgPool });
  const audit = new AuditLogger(null, { pgPool });

  let mockServer = null;
  let remote;
  if (pgPool) {
    remote = new RemoteClient({ baseUrl: config.remote.baseUrl, token: config.remote.token });
    console.log("▶ Source: Supabase Postgres (real uc09_adjustments) + Remote " + (config.remote.token ? "Sandbox" : "mock"));
  } else {
    mockServer = await startMockServer(SEED_PORT);
    remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
    console.log("▶ Source: seeded in-memory store — nothing is persisted.");
  }

  const seeded = await seed(remote, audit, adjustmentStore);
  if (pgPool) await adjustmentStore.flush(); // confirm the seed rows actually land before serving

  // SIGNED IDENTITY (finding F-20). Signed identity is now the default
  // WHENEVER A REAL STORE IS ATTACHED, rather than only when someone
  // remembered to set a flag — an approval that will outlive this process and
  // name a human must have come from a signature. A seeded in-memory run is
  // the demo, and keeps the header posture so a fresh clone still works.
  //
  // Fail-closed either way: with no verifier configured, every approve/deny is
  // refused outright. It never quietly drops back to trusting a name in the
  // request, because a service that downgrades its auth under misconfiguration
  // has no auth.
  const requireSignedIdentity = signedIdentityRequired(process.env, { persistent: Boolean(pgPool) });
  const zafVerifier = requireSignedIdentity ? await buildZafVerifierFromEnv("uc09-api") : null;
  if (requireSignedIdentity && !zafVerifier) {
    console.warn(
      "⚠ Signed approver identity is required here (a durable store is attached) but no " +
        "verifier could be configured — every approve/deny will be refused " +
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

  const server = await startUc09Server({ adjustmentStore, audit, remote, requireSignedIdentity, zafVerifier, entitlement }, port);

  console.log(`▶ UC-09 API listening on http://localhost:${port}`);
  console.log(
    `   role entitlement: ${entitlementEnforced ? `ENFORCED (source: ${entitlementSource})` : "not enforced — seeded demo posture"}`
  );
  console.log(`   GET  /api/adjustments/:id`);
  console.log(`   GET  /api/adjustments/by-ticket/:externalRef`);
  console.log(`   POST /api/adjustments/:id/approve|deny   body: {role, approver, note}`);
  console.log(`   roles: "requester" | "approver" | "payment_releaser" —`);
  console.log(`          2 required for standard cases, 3 for high-risk cases\n`);

  for (const s of seeded) {
    console.log(`   adjustment ${s.adjustmentId} — ${s.label} (decision: ${s.decision}, approvals needed: ${s.approvalSlotsRequired})`);
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