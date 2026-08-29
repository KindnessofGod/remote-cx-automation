#!/usr/bin/env node
// ---------------------------------------------------------------------------
// loadtest.mjs — local, in-memory load test harness for every use case's API
// ---------------------------------------------------------------------------
// WHAT THIS MEASURES (READ THIS BEFORE TRUSTING A NUMBER — see also
// docs/LOAD-TEST-RESULTS.md, which is the actual deliverable this script
// produces)
//
// Every server below is started IN THIS PROCESS, seeded exactly the way its
// own `npm run ucNN-api` seeds it (copied from each src/ucNN/cli.js — same
// seed data, same in-memory stores, same local mock Remote server). No real
// network call is ever made: OpenAI, Zendesk, the real Remote Sandbox, and
// real Postgres are never touched. That is not a simplification made for
// convenience — this container's egress is blocked to those hosts, and
// hitting them under autocannon-generated load is explicitly out of scope
// (see the handoff doc this script implements, docs/HANDOFF-2026-08-09.md
// §4 item BA-3).
//
// This measures ONE Node process, ONE OS thread, ONE unbounded in-memory
// array as the store, on this container's hardware. It is a real, honest
// number for exactly that path — and NOT a proxy for what a Supabase-backed
// production deployment would do under the same load. src/shared/db.js's
// `pg.Pool({max: 10})` is never exercised by this script at all (no
// SUPABASE_DB_URL is set here, so every store below runs in-memory-only,
// the same fallback path `caseStore.js` already uses when unconfigured).
// Do not read any number in docs/LOAD-TEST-RESULTS.md as validating a
// "10K+" claim against real infrastructure. It doesn't, and doesn't try to.
//
// WRITE ROUTES: WHY MOST USE CASES ONLY GET A READ-ROUTE TEST
// Only UC-02's POST /api/expenses is safely repeatable at high concurrency —
// it is a genuine "create a new record" intake route with no per-record
// decision limit. Every other use case's only write route (UC-01's
// approve/decline, UC-04/05/06's approve/decline/signoff, UC-09's approve/deny)
// is a SINGLE-DECISION
// GATE on a small, fixed set of seeded ids: the first concurrent request to
// reach the gate decides it, and every request after that legitimately
// 409s ("already_decided" / "not_awaiting_review"). None of these APIs has
// an intake route that mints a fresh decidable case per request. Hammering
// a single-decision gate at 1000 connections would mostly measure how fast
// the store can say "no, already decided" — a real number, but not what
// "write route" is understood to mean here, and not worth the false
// impression that all nine use cases got a comparable write benchmark.
// UC-03/07/08 have no write route in the file at all, by design (see each
// server.js's own header) — there is nothing to load test.
// See docs/LOAD-TEST-RESULTS.md's "Excluded routes" section for the
// per-use-case reasoning, restated next to the numbers.
//
// SAFETY: UC-02's write path forces the RULE-BASED expense classifier
// (classifyExpenseRuleBased) via a wrapped `submit`, regardless of whether
// this machine's environment happens to carry a real OPENAI_API_KEY. Every
// other seeded workflow call below (the one-time seed data, not the load
// test loop) matches its own cli.js exactly, which already gates on
// isLlmConfigured() — but the load test's OWN repeated calls never should
// depend on that gate being correctly configured every time this script is
// run, given this repo's own documented history of a real-but-unreachable
// OPENAI_API_KEY silently turning a "hermetic" run into a slow, failing one
// (see CLAUDE.md §6, issue #32). Belt and suspenders.
//
// USAGE
//   node scripts/loadtest.mjs                      # light default: 10, 50 connections, 3s each
//   node scripts/loadtest.mjs --full                # the real deliverable: 10, 100, 1000 connections, 10s each
//   node scripts/loadtest.mjs --full --duration=5   # override duration (seconds) per run
//   node scripts/loadtest.mjs --only=uc02,uc06      # just these targets (comma-separated ids)
//   node scripts/loadtest.mjs --full --out=/tmp/x.json  # also dump raw results as JSON
//
// `--full` is heavy on purpose (a 1000-connection run against 9 use cases'
// read routes plus one write route takes several minutes) — this is why it
// is NOT the default and NOT wired into any package.json script or `npm
// test`. Run it by hand, locally, when you actually want the numbers.
// ---------------------------------------------------------------------------

import autocannon from "autocannon";
import { writeFileSync } from "node:fs";

// ---- shared pieces ----------------------------------------------------
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";

// ---- review API (UC-01's HITL queue) -----------------------------------
import { startReviewServer } from "../src/review/server.js";
import { InMemoryReviewStore } from "../src/review/store.js";
import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

// ---- uc02 ---------------------------------------------------------------
import { startUc02Server } from "../src/uc02/server.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

// ---- uc03 ---------------------------------------------------------------
import { startUc03Server } from "../src/uc03/server.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

// ---- uc04 ---------------------------------------------------------------
import { startUc04Server } from "../src/uc04/server.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";

// ---- uc05 ---------------------------------------------------------------
import { startUc05Server } from "../src/uc05/server.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";

// ---- uc06 ---------------------------------------------------------------
import { startUc06Server } from "../src/uc06/server.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";

// ---- uc07 ---------------------------------------------------------------
import { startUc07Server } from "../src/uc07/server.js";
import { DossierStore as Uc07DossierStore } from "../src/uc07/dossierStore.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";

// ---- uc08 ---------------------------------------------------------------
import { startUc08Server } from "../src/uc08/server.js";
import { DossierStore as Uc08DossierStore } from "../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";

// ---- uc09 ---------------------------------------------------------------
import { startUc09Server } from "../src/uc09/server.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const durationArg = argv.find((a) => a.startsWith("--duration="));
const DURATION = durationArg ? Number(durationArg.split("=")[1]) : FULL ? 10 : 3;
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.split("=")[1].split(",").map((s) => s.trim()) : null;
const outArg = argv.find((a) => a.startsWith("--out="));
const OUT_JSON = outArg ? outArg.split("=")[1] : null;

const CONCURRENCY_LEVELS = FULL ? [10, 100, 1000] : [10, 50];

// Every port below is written as "the real npm-run-ucNN-api/mock default port
// + PORT_OFFSET", not as a bare literal — confirmed necessary, not
// theoretical: a real run in this shared devcontainer crashed with
// EADDRINUSE on port 4022 because a DIFFERENT concurrent agent session, in
// its own worktree, had `npm run uc06-api` live on that exact default port
// at the same time. This script's own internal servers don't need to be on
// each use case's real default port — that was only ever a convenience for
// matching each cli.js's seed pattern by eye — so shifting the whole block
// onto a dedicated, deliberately unusual range removes the collision risk
// with any concurrently-running dev server (this session's own past/future
// `npm run ucNN-api` calls, OR another agent's, OR a human's) without
// touching the relative uniqueness each build function already has.
const PORT_OFFSET = 43000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull only the real, captured fields out of an autocannon result — never estimated. */
function summarize({ id, name, kind, path, connections, duration, result }) {
  return {
    id,
    name,
    kind, // "read" | "write"
    path,
    connections,
    durationSec: result.duration,
    totalRequests: result.requests.total,
    reqPerSecAvg: result.requests.average,
    latencyMsP50: result.latency.p50,
    latencyMsP90: result.latency.p90,
    latencyMsP97_5: result.latency.p97_5,
    latencyMsP99: result.latency.p99,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    statusCodeStats: result.statusCodeStats,
  };
}

function logSummary(s) {
  console.log(
    `    ${s.connections.toString().padStart(4)} conn -> ${s.reqPerSecAvg.toFixed(0).padStart(7)} req/s avg | ` +
      `p50 ${s.latencyMsP50}ms  p90 ${s.latencyMsP90}ms  p97.5 ${s.latencyMsP97_5}ms  p99 ${s.latencyMsP99}ms | ` +
      `${s.totalRequests} reqs, ${s.errors} errors, ${s.non2xx} non-2xx`
  );
}

// ---------------------------------------------------------------------------
// Target builders — each mirrors its own src/ucNN/cli.js seed data exactly,
// forced onto a fixed port, in-memory only (no SUPABASE_DB_URL is read).
// Run strictly sequentially (one target fully torn down before the next
// starts), so the identical mock-server ports several cli.js files happen
// to share (e.g. uc04 and uc05 both default to SEED_PORT 4028) never
// collide here.
// ---------------------------------------------------------------------------

async function buildReview() {
  const SEED_PORT = 4013 + PORT_OFFSET;
  const PORT = 4020 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const caseStore = new CaseStore({ pgPool: null });
  const audit = new AuditLogger(null, { pgPool: null });

  const SEED_TICKETS = [
    {
      externalRef: "2001",
      text: "This is First Bank, we need to verify this employee's employment.",
      session: null,
      employmentId: "emp_active_001",
      consentOnRecord: true,
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
      employmentId: "emp_terminated_002",
    },
    {
      externalRef: "2004",
      text: "Please send a standard employment verification letter.",
      session: { authenticatedEmploymentId: "emp_active_001" },
      employmentId: "emp_active_001",
    },
  ];
  for (const ticket of SEED_TICKETS) {
    await handleVerificationTicket({ ...ticket, source: "zendesk" }, { remote, audit, caseStore, classify: classifyRequestRuleBased });
  }

  const store = new InMemoryReviewStore(caseStore);
  const server = await startReviewServer({ store, caseStore, audit, remote, zendesk: null }, PORT);

  return {
    id: "uc01-review",
    name: "UC-01 (review API — the HITL queue every human_review/escalate case lands in)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/review/ticket/2004" }, // clean auto_resolve ticket, always 200
    writeRoute: null,
    writeExcludedReason:
      "POST /api/review/ticket/:id/approve|decline is a single-decision gate — the one seeded human_review ticket (2001) can only be decided once; every request after the first legitimately returns 409 already_decided. There is no intake route on this API to mint a fresh decidable ticket per request (tickets only arrive via the real UC-01 workflow). Read-only load tested.",
  };
}

async function buildUc02() {
  const SEED_PORT = 4051 + PORT_OFFSET;
  const PORT = 4050 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const expenseStore = new ExpenseStore();
  const session = { authenticatedEmploymentId: "emp_active_001" };

  const SEED_SUBMISSIONS = [
    { expenseId: "exp_auto_101", employmentId: "emp_active_001", session, receiptHash: "hash-seed-001", externalRef: "ticket-2001", source: "cli-seed" },
    { expenseId: "exp_over_cap_201", employmentId: "emp_active_001", session, externalRef: "ticket-2002", source: "cli-seed" },
    { expenseId: "exp_dup_b_103", employmentId: "emp_active_001", session, receiptHash: "hash-seed-001", externalRef: "ticket-2003", source: "cli-seed" },
  ];
  for (const submission of SEED_SUBMISSIONS) {
    await handleExpenseSubmission(submission, { remote, audit, expenseStore });
  }

  // Force the rule-based classifier for every load-test request — see the
  // file header's SAFETY note. Real seeding above still matches cli.js
  // exactly (default classify, self-gating on isLlmConfigured()).
  const submit = (payload, deps) => handleExpenseSubmission(payload, { ...deps, classify: classifyExpenseRuleBased });
  // allowUnauthenticatedDemo: the load test measures throughput of the intake
  // route on localhost, not authentication (F-08's signed-token path is
  // covered by test/uc02Server.test.js). Naming the flag here is what keeps
  // the API itself secure by default everywhere else.
  const server = await startUc02Server(
    { expenseStore, audit, remote, submit, allowUnauthenticatedDemo: true },
    PORT
  );

  // NOTE on why this doesn't use autocannon's `idReplacement`/`[<id>]` body
  // templating: autocannon 8.0.0's Content-Length reservation for that
  // feature assumes a fixed-width id substitution, but `hyperid` (what it
  // actually substitutes) grows past that reservation as its internal
  // counter passes single digits. The mismatched Content-Length makes the
  // server wait forever for bytes that never arrive — confirmed directly:
  // every write request came back as a server-side "aborted" error with
  // total requests stuck at 0. `setupRequest` sidesteps the whole
  // mechanism by building a fresh, correctly-sized body per request instead
  // of asking autocannon to template one.
  let uc02Counter = 0;
  const buildUc02Body = () =>
    JSON.stringify({
      expenseId: `loadtest-${Date.now()}-${uc02Counter++}`,
      employmentId: "emp_active_001",
      session,
      source: "loadtest",
    });

  return {
    id: "uc02",
    name: "UC-02 (expense intake + review)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/expenses" }, // the one list route in the whole repo
    writeRoute: {
      method: "POST",
      path: "/api/expenses",
      headers: { "content-type": "application/json" },
      buildBody: buildUc02Body,
    },
  };
}

async function buildUc03() {
  const SEED_PORT = 4052 + PORT_OFFSET;
  const PORT = 4051 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const caseStore = new CaseStore({ pgPool: null });
  const sessionFor = (id) => ({ authenticatedEmploymentId: id });

  const SEED_INQUIRIES = [
    {
      externalRef: "9001",
      employmentId: "emp_active_001",
      session: sessionFor("emp_active_001"),
      text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
    },
    {
      externalRef: "9002",
      employmentId: "emp_active_001",
      session: sessionFor("emp_active_001"),
      text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    },
    {
      externalRef: "9003",
      employmentId: "emp_active_001",
      session: sessionFor("emp_active_001"),
      text: "I need a travel support letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
    },
  ];
  for (const ticket of SEED_INQUIRIES) {
    await handleTravelInquiry(ticket, { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased });
  }

  const server = await startUc03Server({ caseStore }, PORT);

  return {
    id: "uc03",
    name: "UC-03 (travel support letter / workation router)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/cases/by-ticket/9001" },
    writeRoute: null,
    writeExcludedReason:
      "src/uc03/server.js defines no POST/PATCH route at all (its own header: the formal travel-letter sign-off is explicitly out of scope for this build). There is nothing to write-load-test.",
  };
}

async function buildUc04() {
  const SEED_PORT = 4028 + PORT_OFFSET;
  const PORT = 4052 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore({ pgPool: null });
  const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

  const SEED_REQUESTS = [
    {
      externalRef: "4001",
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "DE", nationality: "DE", destination: { country: "ES" },
        startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay",
        jobDuties: "engineering", hasContractSigningAuthority: false,
      },
      travelHistory: [],
      now: "2026-08-15",
    },
    {
      externalRef: "4002",
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "NG", nationality: "NG", destination: { country: "NG" },
        startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay",
        jobDuties: "engineering", hasContractSigningAuthority: false,
      },
      travelHistory: [],
      now: "2026-08-15",
    },
    {
      externalRef: "4003",
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "DE", nationality: "DE", destination: { country: "GB" },
        startDate: "2026-09-01", endDate: "2026-09-10", visaType: "business_visa",
        jobDuties: "sales", hasContractSigningAuthority: true,
      },
      travelHistory: [],
      now: "2026-08-15",
    },
  ];
  for (const ticket of SEED_REQUESTS) {
    await handleWorkationRequest(ticket, { remote, audit, authorizationStore });
  }

  const server = await startUc04Server({ authorizationStore, audit, remote }, PORT);

  return {
    id: "uc04",
    name: "UC-04 (workation / work authorization)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/authorizations/by-ticket/4001" },
    writeRoute: null,
    writeExcludedReason:
      "POST /api/authorizations/:id/approve|decline is a single-specialist, single-decision gate on a fixed seeded id — after the first successful call every further request legitimately 409s. No intake route exists to mint a fresh decidable authorization per request. Read-only load tested.",
  };
}

async function buildUc05() {
  const SEED_PORT = 4028 + PORT_OFFSET;
  const PORT = 4053 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const resignationStore = new ResignationStore({ pgPool: null });

  const SEED_REQUESTS = [
    { externalRef: "5001", employmentId: "emp_uk_001", session: { authenticatedEmploymentId: "emp_uk_001" }, proposedEndDate: "2026-09-15", reason: "new opportunity", now: "2026-08-16" },
    { externalRef: "5002", employmentId: "emp_de_001", session: { authenticatedEmploymentId: "emp_de_001" }, proposedEndDate: "2026-10-31", reason: "relocation", now: "2026-08-10" },
    { externalRef: "5003", employmentId: "emp_pl_001", session: { authenticatedEmploymentId: "emp_pl_001" }, proposedEndDate: "2026-08-31", reason: "family reasons", now: "2026-07-25" },
  ];
  for (const ticket of SEED_REQUESTS) {
    await handleResignationRequest(ticket, { remote, audit, resignationStore });
  }

  const server = await startUc05Server({ resignationStore, audit, remote }, PORT);

  return {
    id: "uc05",
    name: "UC-05 (resignation notice calculation)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/resignations/by-ticket/5001" },
    writeRoute: null,
    writeExcludedReason:
      "POST /api/resignations/:id/signoff|decline is a single HR-Ops-sign-off gate on a fixed seeded id — after the first successful call every further request legitimately 409s. No intake route exists to mint a fresh decidable resignation per request, and UC-05 has no Remote write endpoint at all (confirmed absent, see the file's own header). Read-only load tested.",
  };
}

async function buildUc06() {
  const SEED_PORT = 4022 + PORT_OFFSET;
  const PORT = 4021 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const amendmentStore = new AmendmentStore({ pgPool: null });
  const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

  const SEED_REQUESTS = [
    { externalRef: "3001", employmentId: "emp_active_001", session, changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } }, requestedEffectiveDate: "2026-07-15", now: "2026-06-20" },
    { externalRef: "3002", employmentId: "emp_active_001", session, changes: { jobTitle: { oldValue: "Senior Engineer", newValue: "Staff Engineer" } }, requestedEffectiveDate: "2026-06-15", now: "2026-06-20" },
    { externalRef: "3003", employmentId: "emp_active_001", session, changes: { weeklyHours: { oldValue: 40, newValue: 32 } }, requestedEffectiveDate: "2026-07-15", now: "2026-07-09" },
  ];
  for (const ticket of SEED_REQUESTS) {
    await handleAmendmentRequest(ticket, { remote, audit, amendmentStore });
  }

  const server = await startUc06Server({ amendmentStore, audit, remote }, PORT);

  return {
    id: "uc06",
    name: "UC-06 (contract amendment / payroll cutoff, dual approval)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/amendments/by-ticket/3001" },
    writeRoute: null,
    writeExcludedReason:
      "POST /api/amendments/:id/approve|decline needs TWO independently-identified role slots (customer_admin, payroll_specialist) filled on a fixed seeded id before anything executes — after both slots are filled once, every further request legitimately 409s. No intake route exists to mint a fresh decidable amendment per request. Read-only load tested.",
  };
}

async function buildUc07() {
  const PORT = 4054 + PORT_OFFSET;
  const audit = new AuditLogger();
  const dossierStore = new Uc07DossierStore({ pgPool: null });

  const SEED_RELOCATIONS = [
    {
      externalRef: "9001", employmentId: "emp_active_001", source: "seed",
      text: "We're permanently relocating our engineer from Spain to the Netherlands. She already has the right to work there. Source last working day June 30, destination start July 1.",
      plan: {
        destinationSupported: true, destinationEntityActive: true, annualGrossSalaryRemoteInteger: 6500000, currency: "EUR", months: 12,
        minimumVisaSalaryRemoteInteger: 5500000, transferFeeRemoteInteger: 150000, creationDate: "2026-05-01",
        proposedStartDate: "2026-07-01", destinationStartDate: "2026-07-01", sourceTerminationDate: "2026-06-30",
        sourceLastWorkingDay: "2026-06-30", minimumOnboardingLeadTimeBusinessDays: 20, immigrationSupportRequired: false,
        immigrationConfirmed: true, rightToWorkConfirmed: true, destinationStartDateConfirmed: true,
        sourceExitPlanValidated: true, employerPresenceInDestination: true, taxTreatyNexusConfirmed: true,
        ptoTransferAllowed: true, sourcePtoDays: 12, seniorityPreservable: true,
      },
    },
  ];
  const classify = parseRelocationRuleBased;
  for (const ticket of SEED_RELOCATIONS) {
    await handleRelocationReview(ticket, { audit, dossierStore, classify });
  }

  const server = await startUc07Server({ dossierStore }, PORT);

  return {
    id: "uc07",
    name: "UC-07 (global mobility / permanent relocation, no execution path)",
    port: PORT,
    server,
    mockServers: [], // handleRelocationReview takes no remote/zendesk dependency at all
    readRoute: { method: "GET", path: "/api/dossiers/by-ticket/9001" },
    writeRoute: null,
    writeExcludedReason:
      "src/uc07/server.js defines no POST route at all, by design — UC-07 is the 🔴 use case with no execution path (structurally, not just behaviorally: the workflow takes no write-capable client). There is nothing to write-load-test.",
  };
}

async function buildUc08() {
  const PORT = 4023 + PORT_OFFSET;
  const audit = new AuditLogger();
  const dossierStore = new Uc08DossierStore({ pgPool: null });

  const SEED_INQUIRIES = [
    {
      externalRef: "8001", employmentId: "emp_active_001", source: "seed",
      text: "I've been splitting my time between Germany and Spain this year and I think I may be a dual resident of both countries for tax purposes. Can you help?",
    },
  ];
  const classify = parseInquiryRuleBased;
  for (const ticket of SEED_INQUIRIES) {
    await handleTaxInquiry(ticket, { audit, dossierStore, classify });
  }

  const server = await startUc08Server({ dossierStore }, PORT);

  return {
    id: "uc08",
    name: "UC-08 (cross-border tax & social security, no execution path)",
    port: PORT,
    server,
    mockServers: [],
    readRoute: { method: "GET", path: "/api/dossiers/by-ticket/8001" },
    writeRoute: null,
    writeExcludedReason:
      "src/uc08/server.js defines no POST route at all, by design — same no-execution-path guarantee as UC-07. There is nothing to write-load-test.",
  };
}

async function buildUc09() {
  const SEED_PORT = 4056 + PORT_OFFSET;
  const PORT = 4055 + PORT_OFFSET;
  const mockServer = await startMockServer(SEED_PORT);
  const remote = new RemoteClient({ baseUrl: `http://localhost:${SEED_PORT}` });
  const audit = new AuditLogger();
  const adjustmentStore = new AdjustmentStore({ pgPool: null });
  const session = { companyId: "co_adjust_01", authenticatedAdminId: "admin_mike" };

  const SEED_REQUESTS = [
    { externalRef: "9001", employmentId: "emp_active_001", session, requestText: "Process a $5,000 performance bonus for John Doe", reasonText: "Annual performance bonus", now: "2026-06-20" },
    { externalRef: "9002", employmentId: "emp_active_001", session, requestText: "Process a $15,000 relocation top-up for Jane Smith", reasonText: "Relocation assistance", now: "2026-06-20" },
    { externalRef: "9003", employmentId: "emp_active_001", session, requestText: "Process a $2,500 bonus with manual post-tax calculation", reasonText: "Special project bonus with manual tax", now: "2026-06-20" },
  ];
  for (const ticket of SEED_REQUESTS) {
    await handleAdjustmentRequest(ticket, { remote, audit, adjustmentStore });
  }

  const server = await startUc09Server({ adjustmentStore, audit, remote }, PORT);

  return {
    id: "uc09",
    name: "UC-09 (off-cycle payroll adjustment, floor-of-2 multi-approval)",
    port: PORT,
    server,
    mockServers: [mockServer],
    readRoute: { method: "GET", path: "/api/adjustments/by-ticket/9001" },
    writeRoute: null,
    writeExcludedReason:
      "POST /api/adjustments/:id/approve|deny needs 2-3 independently-identified role slots filled on a fixed seeded id before anything executes (real money) — after all slots are filled once, every further request legitimately 409s. No intake route exists to mint a fresh decidable adjustment per request. Read-only load tested.",
  };
}

const BUILDERS = [
  { id: "uc01-review", build: buildReview },
  { id: "uc02", build: buildUc02 },
  { id: "uc03", build: buildUc03 },
  { id: "uc04", build: buildUc04 },
  { id: "uc05", build: buildUc05 },
  { id: "uc06", build: buildUc06 },
  { id: "uc07", build: buildUc07 },
  { id: "uc08", build: buildUc08 },
  { id: "uc09", build: buildUc09 },
];

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
async function main() {
  const selected = ONLY ? BUILDERS.filter((b) => ONLY.includes(b.id)) : BUILDERS;
  if (selected.length === 0) {
    console.error(`--only=${ONLY?.join(",")} matched nothing. Valid ids: ${BUILDERS.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }

  console.log(
    `Load test: ${FULL ? "FULL" : "light"} sweep, concurrency ${CONCURRENCY_LEVELS.join(" -> ")}, ` +
      `${DURATION}s per run, targets: ${selected.map((b) => b.id).join(", ")}\n`
  );

  const results = [];
  const excluded = [];

  for (const { id, build } of selected) {
    console.log(`=== ${id} — starting & seeding (in-memory, local mock only) ===`);
    const target = await build();
    console.log(`  ${target.name}\n  listening on :${target.port}`);

    try {
      for (const connections of CONCURRENCY_LEVELS) {
        if (target.readRoute) {
          process.stdout.write(`  [read]  ${target.readRoute.path} — ${connections} conn, ${DURATION}s ... `);
          const result = await autocannon({
            url: `http://localhost:${target.port}${target.readRoute.path}`,
            method: target.readRoute.method,
            connections,
            duration: DURATION,
          });
          const s = summarize({ id, name: target.name, kind: "read", path: target.readRoute.path, connections, result });
          results.push(s);
          console.log("done");
          logSummary(s);
        }
        if (target.writeRoute) {
          process.stdout.write(`  [write] ${target.writeRoute.path} — ${connections} conn, ${DURATION}s ... `);
          // Each request gets a freshly built, correctly-sized body via
          // setupRequest — see buildUc02()'s comment for why autocannon's
          // own idReplacement templating is not used here.
          const result = await autocannon({
            url: `http://localhost:${target.port}`,
            connections,
            duration: DURATION,
            requests: [
              {
                method: target.writeRoute.method,
                path: target.writeRoute.path,
                headers: target.writeRoute.headers,
                setupRequest: (req) => {
                  req.body = target.writeRoute.buildBody();
                  return req;
                },
              },
            ],
          });
          const s = summarize({ id, name: target.name, kind: "write", path: target.writeRoute.path, connections, result });
          results.push(s);
          console.log("done");
          logSummary(s);
        }
      }
      if (target.writeExcludedReason) {
        excluded.push({ id, name: target.name, reason: target.writeExcludedReason });
      }
    } finally {
      // Grace period before tearing down the downstream mock server(s): a
      // request accepted right as autocannon's duration elapsed can still
      // be mid-flight in its async workflow (e.g. handleExpenseSubmission's
      // own await remote.getEmployment(...)) even after its own socket has
      // already been destroyed and target.server's close() has resolved —
      // socket closure and in-flight handler completion are not the same
      // event. Without this, that handler's next fetch to the mock server
      // throws right as this loop moves on to the next target, which is
      // harmless (outside the measured window, doesn't touch autocannon's
      // captured numbers) but noisy and easy to misread as a real failure.
      await closeServer(target.server);
      if (target.mockServers?.length) await delay(300);
      for (const m of target.mockServers ?? []) await closeServer(m);
      console.log(`  ${id} servers closed.\n`);
    }
  }

  console.log("=== Summary ===");
  console.table(
    results.map((r) => ({
      id: r.id,
      route: r.kind,
      conn: r.connections,
      "req/s": Math.round(r.reqPerSecAvg),
      p50ms: r.latencyMsP50,
      p90ms: r.latencyMsP90,
      "p97.5ms": r.latencyMsP97_5,
      p99ms: r.latencyMsP99,
      requests: r.totalRequests,
      errors: r.errors,
      non2xx: r.non2xx,
    }))
  );

  if (excluded.length) {
    console.log("\nWrite routes excluded from load testing (see docs/LOAD-TEST-RESULTS.md for the full reasoning):");
    for (const e of excluded) console.log(`  - ${e.id}: ${e.reason}`);
  }

  if (OUT_JSON) {
    writeFileSync(OUT_JSON, JSON.stringify({ full: FULL, durationSec: DURATION, concurrencyLevels: CONCURRENCY_LEVELS, results, excluded }, null, 2));
    console.log(`\nRaw results written to ${OUT_JSON}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
