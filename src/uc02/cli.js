// ---------------------------------------------------------------------------
// cli.js  —  `npm run uc02-api`
// ---------------------------------------------------------------------------
// Starts UC-02's expense intake/review API on http://localhost:4050, seeded
// against the mock Remote with three real workflow runs so it's demonstrable
// with zero credentials. `ExpenseStore` now takes an optional Supabase pgPool
// (see expenseStore.js's header) and this command deliberately does NOT pass
// one: the three seeds below include a deliberate duplicate pair, and writing
// invented receipt hashes into the real `uc02_expenses` table would poison the
// corpus the §7 duplicate gate reads. So this command is always the offline,
// seeded run, and the CLI says so rather than implying otherwise. The pooled
// path is exercised by `npm run portal` and the Vercel deployment, which
// submit real expenses rather than fixtures.
//
// Usage:
//   npm run uc02-api                # port 4050, seeded
//   npm run uc02-api -- --port 4050
// ---------------------------------------------------------------------------

import { startUc02Server } from "./server.js";
import { ExpenseStore } from "./expenseStore.js";
import { AuditLogger } from "../shared/audit.js";
import { PORTS } from "../shared/ports.js";
import { RemoteClient } from "../remote/restClient.js";
import { startMockServer } from "../remote/mockServer.js";
import { handleExpenseSubmission } from "./workflow.js";

const SEED_PORT = PORTS.UC02_SEED_MOCK; // registry-allocated; see src/shared/ports.js

const session = { authenticatedEmploymentId: "emp_active_001" };

/** Three submissions exercising the three outcomes the API must render. */
const SEED_SUBMISSIONS = [
  {
    label: "compliant meals expense -> auto-approve",
    expenseId: "exp_auto_101",
    employmentId: "emp_active_001",
    session,
    receiptHash: "hash-seed-001",
    externalRef: "ticket-2001",
    source: "cli-seed",
  },
  {
    label: "over-policy-cap expense -> flagged for Finance Ops",
    expenseId: "exp_over_cap_201",
    employmentId: "emp_active_001",
    session,
    externalRef: "ticket-2002",
    source: "cli-seed",
  },
  {
    label: "duplicate of the first expense -> blocked",
    expenseId: "exp_dup_b_103",
    employmentId: "emp_active_001",
    session,
    receiptHash: "hash-seed-001",
    externalRef: "ticket-2003",
    source: "cli-seed",
  },
];

async function seed(remote, audit, expenseStore) {
  const results = [];
  for (const { label, ...submission } of SEED_SUBMISSIONS) {
    const result = await handleExpenseSubmission(submission, { remote, audit, expenseStore });
    results.push({ label, ...result });
  }
  return results;
}

async function main() {
  const argv = process.argv.slice(2);
  const portIndex = argv.indexOf("--port");
  const port = portIndex !== -1 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : PORTS.UC02_API;

  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const expenseStore = new ExpenseStore();

  console.log("▶ Source: seeded in-memory store against the mock Remote — nothing is persisted.");
  const seeded = await seed(remote, audit, expenseStore);

  // SECURE BY DEFAULT (finding F-08): POST /api/expenses requires a signed
  // identity token unless this is explicitly started in demo mode. The seeded
  // runs above happen in-process and are unaffected, so `npm run uc02-api`
  // still demonstrates all three outcomes over the GET routes with no flag at
  // all; only submitting NEW expenses by hand needs the opt-in below.
  const allowUnauthenticatedDemo =
    process.env.UC02_ALLOW_UNAUTHENTICATED_DEMO === "1" || argv.includes("--allow-unauthenticated-demo");

  const server = await startUc02Server(
    { expenseStore, audit, remote, allowUnauthenticatedDemo },
    port
  );

  console.log(`▶ UC-02 API listening on http://localhost:${port}`);
  if (allowUnauthenticatedDemo) {
    console.log(`   AUTH: DISABLED (demo) — POST trusts the session in the request body.`);
  } else {
    console.log(`   AUTH: POST /api/expenses requires a signed X-ZAF-Token (src/review/zafAuth.js).`);
    console.log(`         For a local hand-submitted demo: npm run uc02-api -- --allow-unauthenticated-demo`);
  }
  console.log(`   POST /api/expenses   body: {expenseId, employmentId, session?, receiptHash?}`);
  console.log(`   GET  /api/expenses`);
  console.log(`   GET  /api/expenses/:id`);
  console.log(`   GET  /api/expenses/by-ticket/:externalRef`);
  console.log(`   POST /api/expenses/:id/approve | /decline | /hold   body: {approver, note}`);
  console.log(`        (UC-02.md §6's Finance Ops decision — decline REQUIRES a note, which`);
  console.log(`         becomes Remote's mandatory \`reason\`. \`hold\` writes nothing to Remote.)\n`);
  for (const s of seeded) {
    console.log(`   ${s.storeId} — ${s.label} (decision: ${s.decision}, category: ${s.categoryId})`);
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
      mockServer.close();
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
