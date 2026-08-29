// ---------------------------------------------------------------------------
// demo-countries-matrix.mjs  —  run every NL / PT / CA / US demo scenario for real
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/DEMO-COUNTRIES.md claims an outcome for every scenario in the demo
// matrix. A claimed outcome is a prediction; this script turns each one into an
// OBSERVATION by calling the real workflow entry point in src/ucNN/workflow.js
// against real Remote Sandbox employment ids, and printing what actually came
// back.
//
// It exists because of this repo's most expensive recurring defect (CLAUDE.md
// §4, BUILD-LOG §3.30): a use case that STRUCTURALLY CANNOT SUCCEED is
// indistinguishable from one that is appropriately refusing. Every fail-closed
// assertion passes in both cases. So every use case below carries at least one
// scenario whose expected outcome is a SUCCESS, and the run reports
// expected-vs-observed per row rather than pass/fail overall.
//
// NOT A TEST. It reaches the network on purpose and must never be imported by
// `npm test`. Run it explicitly:
//
//     NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs
//     NODE_USE_ENV_PROXY=1 node scripts/demo-countries-matrix.mjs --json out.json
//
// Every LLM seam is injected with the REAL function forced into its
// unconfigured branch (`(args) => realFn(args, {isConfigured: () => false})`),
// the idiom every test file in this repo uses — so no scenario here ever makes
// a real, retried OpenAI call just because .env carries a key (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import "dotenv/config";

import { RemoteClient } from "../src/remote/restClient.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";

import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";

import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { draftSummary as uc04DraftSummary } from "../src/uc04/requestParser.js";
import { VISA_TYPES, JOB_DUTY_CATEGORIES } from "../src/uc04/riskMatrix.js";

import { handleResignationRequest } from "../src/uc05/workflow.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";

import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { draftSummary as uc06DraftSummary } from "../src/uc06/changeParser.js";

import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";

import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";

import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

// ---------------------------------------------------------------------------
// Hosts. Two, and the difference is load-bearing (CLAUDE.md §6).
//   GATEWAY  — the raw Remote Sandbox. Ground truth, and what UC-01/02/03/07/
//              08/09 use.
//   STANDIN  — the read-only enriching proxy the live n8n graphs point UC-04,
//              UC-05 and UC-06 at. It fills ONLY fields the Sandbox left null
//              (UC-04's custom_fields.workation_permission) and continues each
//              country's own observed payroll cadence past its last real cycle
//              (UC-06). It never invents money.
// Both are exercised for UC-04 and UC-06 on purpose: the difference between
// them IS the finding.
// ---------------------------------------------------------------------------
const GATEWAY = process.env.REMOTE_API_BASE_URL || "https://gateway.remote-sandbox.com";
const STANDIN = process.env.REMOTE_STANDIN_BASE_URL || "https://your-sandbox-standin.vercel.app";
const TOKEN = process.env.REMOTE_API_TOKEN;

const gateway = new RemoteClient({ baseUrl: GATEWAY, token: TOKEN });
const standin = new RemoteClient({ baseUrl: STANDIN, token: TOKEN });
// The checked-in mock fixtures, dispatched in-process (no socket, no port) —
// used ONLY where the live Sandbox structurally cannot produce a success and
// the question is whether the success path exists at all.
const mock = new RemoteClient({ baseUrl: "http://mock.local", fetchImpl: createInProcessFetch() });

// ---------------------------------------------------------------------------
// The cast. Every id re-verified live on 2026-08-19 — `fde4007b-…` from this
// repo's history is DEAD (the Sandbox was reseeded), so nothing here is copied
// from an older file.
// ---------------------------------------------------------------------------
const NL_LARS = "673a1884-86fb-4101-83d3-b6c544d93bca";      // Netherlands, employee (EOR), active
const NL_ANNA = "293527ed-b8af-4fc2-a4ad-1cb87cda1641";      // Netherlands, global_payroll_employee, active
const NL_MAX = "5d27f768-782c-43ae-888f-cd3ecaa7649a";       // Netherlands, global_payroll_employee, active
const NL_EMMA = "ce76d3ed-7d1e-4f4d-a8ce-d7b8259e344d";      // Netherlands, global_payroll_employee, active, FULL-TIME
const PT_JOAO = "378eee6b-c6db-4484-ba32-7283bd0e2de9";      // Portugal, employee (EOR), active
const PT_INES = "e1898674-e124-412a-abea-fe9ecab8a6e8";      // Portugal, contractor, active
const CA_ALEX = "3537d9ee-2017-4a53-952e-9d3b042aeab5";      // Canada, contractor, active
const CA_DAVID = "20b1346b-4673-4227-8261-ba51d10f6b4b";     // Canada, global_payroll_employee, active
const US_ALEX = "2f7f8210-91fc-47db-803c-77a1cc625781";      // United States, employee (EOR), active
const US_AMANDA = "e818418e-1db7-431d-a663-9f477addb8bd";    // United States, global_payroll_employee, active
const US_JAMES = "99596ef8-8fad-4b3c-abd0-c22ae933b111";     // United States, global_payroll_employee, active

// THE TWO IDS THE STAND-IN HAS AN ENRICHMENT PROFILE FOR (src/remotebridge/
// enrichment.js STANDIN_PROFILES). Only these two carry
// `custom_fields.workation_permission`, which is UC-04's second gate — so only
// these two can reach a UC-04 decision other than `blocked`. Named as a
// constant rather than reused silently, because a UC-04 scenario "on NL" that
// is carried by a Canadian record is a thing a reader has to be told.
const PROFILED_CA = CA_ALEX;
const PROFILED_US = US_ALEX;

const NOW = process.env.DEMO_NOW || new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// LLM seams — the real functions, forced unconfigured. Never a hand-rolled stub.
// ---------------------------------------------------------------------------
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const uc04Draft = (a) => uc04DraftSummary(a, { isConfigured: () => false });
const uc06Draft = (a) => uc06DraftSummary(a, { isConfigured: () => false });
const uc05Extract = (a) => extractFromLetter(a, { isConfigured: () => false });
const fakeNarrative = async () => ({ narrative: "Dossier narrative (deterministic template).", source: "template" });
const noSlack = async () => ({ delivered: false, reason: "not_configured" });

const fresh = () => ({ audit: new AuditLogger(), caseStore: new CaseStore() });

// ---------------------------------------------------------------------------
// The scenario table. `expect` is the PREDICTION. It is never written into the
// deliverable as though it were observed — the runner prints both, side by side.
// ---------------------------------------------------------------------------
const SCENARIOS = [];
const S = (spec) => SCENARIOS.push(spec);

// ======================= UC-01 — employment verification (🟢) ===============
S({
  id: "UC01-NL-1", uc: "UC-01", country: "NL", host: "gateway",
  label: "NL employee asks for a standard employment verification letter (authenticated as self)",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "Hi, I need an employment verification letter for my mortgage application.",
        employmentId: NL_LARS, session: { authenticatedEmploymentId: NL_LARS },
        source: "demo", externalRef: "demo-uc01-nl-1" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});
S({
  id: "UC01-PT-1", uc: "UC-01", country: "PT", host: "gateway",
  label: "PT employee asks for a standard verification letter (authenticated as self)",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "Please send me an employment verification letter for my landlord.",
        employmentId: PT_JOAO, session: { authenticatedEmploymentId: PT_JOAO },
        source: "demo", externalRef: "demo-uc01-pt-1" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});
S({
  id: "UC01-CA-1", uc: "UC-01", country: "CA", host: "gateway",
  label: "CA contractor asks for a standard verification letter (authenticated as self)",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "Please send me a standard employment verification letter for my visa appointment.",
        employmentId: CA_ALEX, session: { authenticatedEmploymentId: CA_ALEX },
        source: "demo", externalRef: "demo-uc01-ca-1" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});
S({
  id: "UC01-NL-2", uc: "UC-01", country: "NL", host: "gateway",
  label: "NL: letter request that ALSO asks for salary — over-scope disclosure",
  expect: { decision: "human_review", reason: "over_scope_request" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "Please issue an employment verification letter and include my current salary.",
        employmentId: NL_LARS, session: { authenticatedEmploymentId: NL_LARS },
        source: "demo", externalRef: "demo-uc01-nl-2" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});
S({
  id: "UC01-CA-2", uc: "UC-01", country: "CA", host: "gateway",
  label: "CA: session belongs to a DIFFERENT employee than the record requested",
  expect: { decision: "escalate", reason: "identity_not_verified" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "I need an employment verification letter.",
        employmentId: CA_DAVID, session: { authenticatedEmploymentId: CA_ALEX },
        source: "demo", externalRef: "demo-uc01-ca-2" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});

S({
  id: "UC01-US-1", uc: "UC-01", country: "US", host: "gateway",
  label: "US employee asks for a standard employment verification letter (largest active pool: 22 records)",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "Could you send me a standard employment verification letter for my mortgage lender?",
        employmentId: US_ALEX, session: { authenticatedEmploymentId: US_ALEX },
        source: "demo", externalRef: "demo-uc01-us-1" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});
S({
  id: "UC01-US-2", uc: "UC-01", country: "US", host: "gateway",
  label: "US: the SAME request in wording the deterministic fallback does not recognise as standard",
  expect: { decision: "human_review", reason: "non_standard_request" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleVerificationTicket(
      { text: "I need a letter confirming my engagement for a visa appointment.",
        employmentId: US_ALEX, session: { authenticatedEmploymentId: US_ALEX },
        source: "demo", externalRef: "demo-uc01-us-2" },
      { remote: gateway, audit, caseStore, classify: classifyRequestRuleBased }
    );
  },
});

// ======================= UC-02 — expense validation (🟢) ====================
S({
  id: "UC02-NL-1", uc: "UC-02", country: "NL", host: "gateway",
  label: "NL: real PENDING expense (tech_equipment, EUR 221.81) submitted by its own employee",
  expect: { decision: "auto_approve", reason: "all_gates_passed" },  // predicted from the 🟢 tier, BEFORE running
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "e4b8ea57-4d84-4e13-b6bf-ca666ad0ab70", employmentId: NL_ANNA,
        session: { authenticatedEmploymentId: NL_ANNA }, source: "demo", externalRef: "demo-uc02-nl-1" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-CA-1", uc: "UC-02", country: "CA", host: "gateway",
  label: "CA: real PENDING expense (utilities, CAD 1,396.07) submitted by its own employee",
  expect: { decision: "human_review", reason: "over_policy_cap" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "45e77e12-9b8f-4152-bdcf-25b6e286b79c", employmentId: CA_DAVID,
        session: { authenticatedEmploymentId: CA_DAVID }, source: "demo", externalRef: "demo-uc02-ca-1" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-NL-2", uc: "UC-02", country: "NL", host: "gateway",
  label: "NL: an ALREADY-APPROVED expense resubmitted — must refuse, not re-approve",
  expect: { decision: "blocked", reason: "expense_not_pending" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "6f1ffe6b-6662-4bd8-b44d-f53d6d791c81", employmentId: NL_ANNA,
        session: { authenticatedEmploymentId: NL_ANNA }, source: "demo", externalRef: "demo-uc02-nl-2" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-NL-3", uc: "UC-02", country: "NL", host: "gateway",
  label: "NL: expense that belongs to a DIFFERENT employment than the submitter",
  expect: { decision: "escalate", reason: "expense_employment_mismatch" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "e4b8ea57-4d84-4e13-b6bf-ca666ad0ab70", employmentId: NL_MAX,
        session: { authenticatedEmploymentId: NL_MAX }, source: "demo", externalRef: "demo-uc02-nl-3" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-MOCK-1", uc: "UC-02", country: "(mock)", host: "mock fixtures",
  label: "REACHABILITY CONTROL: the same handler on the checked-in fixtures — proves auto_approve exists",
  expect: { decision: "auto_approve", reason: "all_gates_passed" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "exp_auto_101", employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" }, source: "demo", externalRef: "demo-uc02-mock-1" },
      { remote: mock, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});

S({
  id: "UC02-US-1", uc: "UC-02", country: "US", host: "gateway",
  // ⚠ CONSUMED. This scenario's auto_approve is a REAL `PATCH /v1/expenses/:id`
  // against the Sandbox, so the expense is now `approved` and re-running this
  // row reports `blocked / expense_not_pending` (which UC02-US-1b already
  // proves is the correct second-submission answer). The positive was observed
  // on 2026-08-19; to re-observe it, file a NEW pending USD expense under an
  // internal-meals category below USD 500.
  label: "THE POSITIVE TEST. US pending expense, Team Building USD 327.54 — under the USD 500 internal-meals cap",
  expect: { decision: "auto_approve", reason: "all_gates_passed" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "5949669c-d23a-4e23-b34d-7f58b4d02445", employmentId: "e3d8f86a-2780-4073-b6c8-4596db5dc877",
        session: { authenticatedEmploymentId: "e3d8f86a-2780-4073-b6c8-4596db5dc877" },
        source: "demo", externalRef: "demo-uc02-us-1" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-US-1b", uc: "UC-02", country: "US", host: "gateway",
  label: "THE SAME EXPENSE, submitted a second time — auto_approve is a real PATCH, so it is one-shot by design",
  expect: { decision: "blocked", reason: "expense_not_pending" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "5949669c-d23a-4e23-b34d-7f58b4d02445", employmentId: "e3d8f86a-2780-4073-b6c8-4596db5dc877",
        session: { authenticatedEmploymentId: "e3d8f86a-2780-4073-b6c8-4596db5dc877" },
        source: "demo", externalRef: "demo-uc02-us-1b" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-US-2", uc: "UC-02", country: "US", host: "gateway",
  label: "US pending expense, Office Supplies USD 319.30 — ABOVE the USD 150 office-supplies cap",
  expect: { decision: "human_review", reason: "over_policy_cap" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "2c18ec6d-6308-43c2-8d13-a9f3b89d768a", employmentId: US_JAMES,
        session: { authenticatedEmploymentId: US_JAMES }, source: "demo", externalRef: "demo-uc02-us-2" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-US-3", uc: "UC-02", country: "US", host: "gateway",
  label: "US pending expense, Standing Desk USD 600.36 — a real category the cap corpus does not cover",
  expect: { decision: "human_review", reason: "policy_cap_unknown" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "3138969b-f407-48ee-b088-2e6a026590ff", employmentId: "9ac2c03c-ae44-402a-9d3b-04cbe786bd47",
        session: { authenticatedEmploymentId: "9ac2c03c-ae44-402a-9d3b-04cbe786bd47" },
        source: "demo", externalRef: "demo-uc02-us-3" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-CA-2", uc: "UC-02", country: "CA", host: "gateway",
  label: "CA pending expense, Coworking CAD 693.72 — a cap EXISTS for co-working, but it is denominated in USD",
  expect: { decision: "human_review", reason: "policy_cap_currency_mismatch" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "04715fab-6b6f-4384-b621-31f4f4822930", employmentId: CA_DAVID,
        session: { authenticatedEmploymentId: CA_DAVID }, source: "demo", externalRef: "demo-uc02-ca-2" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});
S({
  id: "UC02-NL-4", uc: "UC-02", country: "NL", host: "gateway",
  label: "NL pending expense, Hotel Stay EUR 557.70 — accommodation HAS a cap, in USD, so the two cannot be compared",
  expect: { decision: "human_review", reason: "policy_cap_currency_mismatch" },
  run: async () => {
    const audit = new AuditLogger();
    return handleExpenseSubmission(
      { expenseId: "69705e94-cb91-41ec-96bf-fd9994b25ac3", employmentId: NL_MAX,
        session: { authenticatedEmploymentId: NL_MAX }, source: "demo", externalRef: "demo-uc02-nl-4" },
      { remote: gateway, audit, expenseStore: new ExpenseStore(), classify: classifyExpenseRuleBased }
    );
  },
});

// ======================= UC-03 — travel letter / router (🟢) ================
S({
  id: "UC03-NL-1", uc: "UC-03", country: "NL", host: "gateway",
  label: "NL employee: informational question about a 10-day trip to Portugal",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I'm travelling to Portugal from 2026-09-07 to 2026-09-16 to visit family. Anything I need to know?",
        employmentId: NL_LARS, session: { authenticatedEmploymentId: NL_LARS },
        source: "demo", externalRef: "demo-uc03-nl-1" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-PT-1", uc: "UC-03", country: "PT", host: "gateway",
  label: "PT employee: informational question about a 12-day trip to Canada",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I'll be in Canada from 2026-09-07 to 2026-09-18 on holiday. Any travel considerations?",
        employmentId: PT_JOAO, session: { authenticatedEmploymentId: PT_JOAO },
        source: "demo", externalRef: "demo-uc03-pt-1" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-CA-1", uc: "UC-03", country: "CA", host: "gateway",
  label: "CA contractor: destination is a SANCTIONED jurisdiction (Iran)",
  expect: { decision: "escalate", reason: "destination_jurisdiction_excluded" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I'm travelling to Iran from 2026-09-07 to 2026-09-16. Anything I should know?",
        employmentId: CA_ALEX, session: { authenticatedEmploymentId: CA_ALEX },
        source: "demo", externalRef: "demo-uc03-ca-1" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-NL-2", uc: "UC-03", country: "NL", host: "gateway",
  label: "NL employee asks for a FORMAL travel support letter (not just information)",
  expect: { decision: "human_review", reason: "formal_letter_requested" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "Please issue a travel support letter for my visa appointment. I travel to Portugal 2026-09-07 to 2026-09-16.",
        employmentId: NL_LARS, session: { authenticatedEmploymentId: NL_LARS },
        source: "demo", externalRef: "demo-uc03-nl-2" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-PT-2", uc: "UC-03", country: "PT", host: "gateway",
  label: "PT employee: an explicit WORKATION intent — must hand off to UC-04, not answer",
  expect: { decision: "route_to_uc04" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I want to work remotely from the Netherlands from 2026-09-07 to 2026-10-16. Can I do my job from there?",
        employmentId: PT_JOAO, session: { authenticatedEmploymentId: PT_JOAO },
        source: "demo", externalRef: "demo-uc03-pt-2" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});

S({
  id: "UC03-NL-3", uc: "UC-03", country: "NL→US", host: "gateway",
  label: "NL employee: informational question about a 9-day trip to the United States",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I'm going to the United States from 2026-09-07 to 2026-09-15 for a family wedding. Anything to know?",
        employmentId: NL_LARS, session: { authenticatedEmploymentId: NL_LARS },
        source: "demo", externalRef: "demo-uc03-nl-3" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-US-1", uc: "UC-03", country: "US→PT", host: "gateway",
  label: "US employee: informational question about a 10-day trip to Portugal",
  expect: { decision: "auto_resolve", reason: "all_gates_passed" },
  run: async () => {
    const { audit, caseStore } = fresh();
    return handleTravelInquiry(
      { text: "I'm travelling to Portugal from 2026-09-07 to 2026-09-16 on holiday. Anything I need to know?",
        employmentId: US_ALEX, session: { authenticatedEmploymentId: US_ALEX },
        source: "demo", externalRef: "demo-uc03-us-1" },
      { remote: gateway, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
  },
});
S({
  id: "UC03-CA-2", uc: "UC-03", country: "CA→IR", host: "gateway",
  label: "CA contractor to Iran, with a classifier that DOES resolve the destination — the sanctions gate itself",
  expect: { decision: "escalate", reason: "sanctioned_region" },
  run: async () => {
    const { audit, caseStore } = fresh();
    // A stand-in for a COMPETENT classifier: the rule-based fallback's country
    // dictionary has 18 entries and Iran is not one of them, so the real
    // policy gate below can never be reached through it. This injects the
    // answer an LLM would give and runs the REAL policyEngine on it — the
    // gate under test is unchanged.
    const classifyKnowsIran = () => ({
      intent: "travel_notification", destinationCountry: "IR",
      startDate: "2026-09-07", endDate: "2026-09-16",
      formalLetterRequested: false, confidence: 0.95, source: "injected_for_demo",
    });
    return handleTravelInquiry(
      { text: "I'm travelling to Iran from 2026-09-07 to 2026-09-16.",
        employmentId: CA_ALEX, session: { authenticatedEmploymentId: CA_ALEX },
        source: "demo", externalRef: "demo-uc03-ca-2" },
      { remote: gateway, audit, caseStore, classify: classifyKnowsIran }
    );
  },
});

// ======================= UC-04 — workation / work authorization (🟡) ========
// TWO KINDS OF ROW HERE, and the difference matters.
//   "carrier: <id>" rows use one of the TWO Sandbox records the stand-in has an
//   enrichment profile for. UC-04's second gate reads
//   `employment.custom_fields.workation_permission`, a key the raw Sandbox does
//   not return for ANY employment, and the stand-in only supplies it for
//   PROFILED_CA and PROFILED_US. So every other record — every NL and PT one —
//   stops at `blocked / employer_permission_not_granted` before the risk matrix
//   runs at all. The origin country is `factors.homeCountry`, an input, not the
//   record's own country, so a profiled carrier changes nothing about the branch
//   being exercised; it only makes the branch REACHABLE.
//   The "un-profiled" rows below are kept deliberately, because that blocked
//   result is itself the finding.
const uc04 = (employmentId, factors, remote, extra = {}) => async () => {
  const audit = new AuditLogger();
  return handleWorkationRequest(
    { employmentId, session: { companyId: "a9d4ce72-7773-4ea3-830d-c5b36a15e48d", authenticatedAdminId: "admin_demo" },
      factors, travelHistory: extra.travelHistory ?? [], now: NOW,
      source: "demo", externalRef: extra.ref },
    { remote, audit, authorizationStore: new AuthorizationStore(), draftSummary: uc04Draft, judge: fakeJudge }
  );
};
const BASE_FACTORS = {
  startDate: "2026-09-07", endDate: "2026-09-27",
  visaType: VISA_TYPES.schengen_short_stay, jobDuties: JOB_DUTY_CATEGORIES.engineering,
  hasContractSigningAuthority: false,
};

S({
  id: "UC04-NLPT-1", uc: "UC-04", country: "NL→PT", host: "standin, carrier PROFILED_CA",
  label: "NL national working from Portugal — PT is in DNV_COUNTRIES, so the Schengen 90/180 check is SUPPRESSED",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "PT" },
    visaType: VISA_TYPES.digital_nomad_visa }, standin, { ref: "demo-uc04-nlpt-1" }),
});
S({
  id: "UC04-USPT-1", uc: "UC-04", country: "US→PT", host: "standin, carrier PROFILED_US",
  label: "US national working from Portugal — does the DESTINATION-keyed DNV suppression fire regardless of origin?",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "US", nationality: "US", destination: { country: "PT" },
    visaType: VISA_TYPES.digital_nomad_visa }, standin, { ref: "demo-uc04-uspt-1" }),
});
S({
  id: "UC04-CANL-1", uc: "UC-04", country: "CA→NL", host: "standin, carrier PROFILED_CA",
  label: "CA national entering Schengen (Netherlands) — the 90/180 check IS applied",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "CA", nationality: "CA", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-canl-1" }),
});
S({
  id: "UC04-USNL-1", uc: "UC-04", country: "US→NL", host: "standin, carrier PROFILED_US",
  label: "US national entering Schengen — the direct comparison against CA→NL. Identical, or a finding?",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "US", nationality: "US", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-usnl-1" }),
});
S({
  id: "UC04-CANL-2", uc: "UC-04", country: "CA→NL", host: "standin, carrier PROFILED_CA",
  label: "CA national into Schengen with 85 prior Schengen days in the trailing 180 — 90/180 breached",
  expect: { decision: "blocked", reason: "schengen_90_180_exceeded" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "CA", nationality: "CA", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-canl-2",
      travelHistory: [{ country: "NL", startDate: "2026-06-01", endDate: "2026-08-24" }] }),
});
S({
  id: "UC04-USNL-2", uc: "UC-04", country: "US→NL", host: "standin, carrier PROFILED_US",
  label: "US national, IDENTICAL travel history — the twin of UC04-CANL-2",
  expect: { decision: "blocked", reason: "schengen_90_180_exceeded" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "US", nationality: "US", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-usnl-2",
      travelHistory: [{ country: "NL", startDate: "2026-06-01", endDate: "2026-08-24" }] }),
});
// --- THE TWO DAY THRESHOLDS, BOTH SIDES OF EACH ----------------------------
// UC04-CANL-1 (no history) and UC04-CANL-2 (85 prior days) already bracket the
// Schengen limit. The four rows below add what neither could show: a MEASURED
// figure with stated headroom, the 183-in-365 tax-residency watch on both
// sides of its own line, and the one case that makes the pair worth having —
// a traveller comfortably inside one limit and past the other, from a single
// stated history. Two limits, two windows, two questions.
//
// EVERY DATE HERE WAS CHOSEN TO BE INSENSITIVE TO FINDING C-1
// (docs/knowledge/layer-1-statutory/CONTRADICTIONS.md), and that choice has now
// been paid off. C-1 said this matrix computed ONE trailing 180-day window
// anchored at the trip start where Reg. (EU) 2016/399 art. 6(1) evaluates the
// 180 days preceding EACH day of stay. The per-day-of-stay computation is
// IMPLEMENTED as of 2026-08-20 (schengenPeakDays() in src/uc04/riskMatrix.js,
// sourced from the vendored D-07), together with two arithmetic fixes in the
// same function: an unreadable prior stay now refuses instead of returning NaN
// and silently clearing both thresholds, and overlapping stays now count
// distinct days instead of being summed.
//
// EVERY ROW BELOW WAS RE-EVALUATED UNDER BOTH COMPUTATIONS AND NONE MOVED —
// which is what the insensitivity was for. The figures the labels state are
// unchanged and are now the PEAK across the trip rather than a start-anchored
// total: CANL-3 peaks at 51 of 90, CANL-4 at 66 of 90 (and 217 of 183 on the
// residency window), CANL-2 and USNL-2 at 106 of 90. Pinned as a standing
// guard in test/uc04.test.js so a future change to the window cannot move a
// demo figure without a test saying so. A worked divergence example lives in
// the finding and in that test, not here.
//
// The travel history is a STATED input, the same kind of claim as the visa
// type beside it. Nothing is read from Remote and nothing is invented as
// though it had been.
S({
  id: "UC04-CANL-3", uc: "UC-04", country: "CA→NL", host: "standin, carrier PROFILED_CA",
  label: "CA national into Schengen with 30 prior NL days — the 90/180 check MEASURES and clears (51 of 90)",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "CA", nationality: "CA", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-canl-3",
      travelHistory: [{ country: "NL", startDate: "2026-07-20", endDate: "2026-08-18" }] }),
});
S({
  id: "UC04-CANL-4", uc: "UC-04", country: "CA→NL", host: "standin, carrier PROFILED_CA",
  label: "THE TWO LIMITS DISAGREE: 66 of 90 Schengen days (inside) and 217 of 183 residency days (past) — one history, two windows",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "CA", nationality: "CA", destination: { country: "NL" } },
    standin, { ref: "demo-uc04-canl-4",
      travelHistory: [
        // Inside BOTH windows.
        { country: "NL", startDate: "2026-07-05", endDate: "2026-08-18" },
        // Inside the 365-day residency window, OUTSIDE the 180-day Schengen
        // one — which is the whole reason the two answers differ.
        { country: "NL", startDate: "2025-10-01", endDate: "2026-02-28" },
      ] }),
});
S({
  id: "UC04-CACA-1", uc: "UC-04", country: "CA→CA(work permit)", host: "standin, carrier PROFILED_CA",
  label: "NON-SCHENGEN destination, 100 prior days — the 183 watch measured and CLEAR (121 of 183), no Schengen row at all",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "GB", nationality: "GB", destination: { country: "CA" },
    visaType: VISA_TYPES.work_permit }, standin, { ref: "demo-uc04-caca-1",
      travelHistory: [{ country: "CA", startDate: "2026-01-05", endDate: "2026-04-14" }] }),
});
S({
  id: "UC04-CACA-2", uc: "UC-04", country: "CA→CA(work permit)", host: "standin, carrier PROFILED_CA",
  label: "THE POSITIVE OTHER SIDE: 200 prior days on the same route — 221 of 183, so tax_residency_watch fires (check `flags`, not the decision: a watch is a finding for the specialist, not a refusal)",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "GB", nationality: "GB", destination: { country: "CA" },
    visaType: VISA_TYPES.work_permit }, standin, { ref: "demo-uc04-caca-2",
      travelHistory: [{ country: "CA", startDate: "2025-11-01", endDate: "2026-05-19" }] }),
});
S({
  id: "UC04-USPT-2", uc: "UC-04", country: "US→PT", host: "standin, carrier PROFILED_US",
  label: "THE SUPPRESSION, WITH A REAL NUMBER BEHIND IT: 85 prior PT days would be 106 of 90, and the Schengen check is skipped anyway",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "US", nationality: "US", destination: { country: "PT" },
    visaType: VISA_TYPES.digital_nomad_visa }, standin, { ref: "demo-uc04-uspt-2",
      travelHistory: [{ country: "PT", startDate: "2026-05-26", endDate: "2026-08-18" }] }),
});

S({
  id: "UC04-NLUS-1", uc: "UC-04", country: "NL→US", host: "standin, carrier PROFILED_US",
  label: "NL employee working from the US on an ESTA — a visitor authorisation that FORBIDS active work",
  expect: { decision: "blocked", reason: "visitor_visa_active_work_forbidden" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "US" },
    visaType: VISA_TYPES.esta_usa }, standin, { ref: "demo-uc04-nlus-1" }),
});
S({
  id: "UC04-NLUS-2", uc: "UC-04", country: "NL→US", host: "standin, carrier PROFILED_US",
  label: "NL employee working from the US on a BUSINESS visa — plausible-looking, still not a work permit",
  expect: { decision: "blocked", reason: "us_requires_work_permit" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "US" },
    visaType: VISA_TYPES.business_visa }, standin, { ref: "demo-uc04-nlus-2" }),
});
S({
  id: "UC04-NLUS-3", uc: "UC-04", country: "NL→US", host: "standin, carrier PROFILED_US",
  label: "THE CRITICAL POSITIVE. NL employee working from the US WITH a work permit — the gate must NOT fire",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_US, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "US" },
    visaType: VISA_TYPES.work_permit }, standin, { ref: "demo-uc04-nlus-3" }),
});
S({
  id: "UC04-PTCA-1", uc: "UC-04", country: "PT→CA", host: "standin, carrier PROFILED_CA",
  label: "PT employee working from Canada on a BUSINESS visa — the twin of the US rule, one country over",
  expect: { decision: "blocked", reason: "ca_requires_work_permit" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "PT", nationality: "PT", destination: { country: "CA" },
    visaType: VISA_TYPES.business_visa }, standin, { ref: "demo-uc04-ptca-1" }),
});
S({
  id: "UC04-PTCA-2", uc: "UC-04", country: "PT→CA", host: "standin, carrier PROFILED_CA",
  label: "PT employee working from Canada WITH a work permit — the positive twin of UC04-NLUS-3",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "PT", nationality: "PT", destination: { country: "CA" },
    visaType: VISA_TYPES.work_permit }, standin, { ref: "demo-uc04-ptca-2" }),
});
S({
  id: "UC04-NLIR-1", uc: "UC-04", country: "NL→IR", host: "standin, carrier PROFILED_CA",
  label: "NL employee requesting a workation in Iran — a restricted jurisdiction, refused ahead of everything",
  expect: { decision: "blocked", reason: "sanctioned_region" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "IR" } },
    standin, { ref: "demo-uc04-nlir-1" }),
});
S({
  id: "UC04-NLPT-UN", uc: "UC-04", country: "NL→PT", host: "standin, UN-PROFILED NL record",
  label: "FINDING ROW: the same request carried by a real NL employment, which has no stand-in profile",
  expect: { decision: "ready_for_approval", reason: "all_gates_passed" },  // what the demo NEEDS; not what happens
  run: uc04(NL_LARS, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "PT" },
    visaType: VISA_TYPES.digital_nomad_visa }, standin, { ref: "demo-uc04-nlpt-un" }),
});
S({
  id: "UC04-NLPT-GW", uc: "UC-04", country: "NL→PT", host: "gateway",
  label: "CONTROL: identical request against the RAW gateway, which returns no custom_fields block for anyone",
  expect: { decision: "blocked", reason: "employer_permission_not_granted" },
  run: uc04(PROFILED_CA, { ...BASE_FACTORS, homeCountry: "NL", nationality: "NL", destination: { country: "PT" },
    visaType: VISA_TYPES.digital_nomad_visa }, gateway, { ref: "demo-uc04-nlpt-gw" }),
});

// ======================= UC-05 — resignation notice (🟡) ====================
const uc05 = (employmentId, ticket, remote = gateway) => async () => {
  const audit = new AuditLogger();
  return handleResignationRequest(
    { employmentId, session: { authenticatedEmploymentId: employmentId }, now: NOW, source: "demo", ...ticket },
    { remote, audit, resignationStore: new ResignationStore(), extract: uc05Extract }
  );
};
S({
  id: "UC05-PT-1", uc: "UC-05", country: "PT", host: "gateway",
  label: "PT employee, tenure > 2 years, proposed last working day comfortably beyond the 60-day statutory notice",
  expect: { decision: "prepared_for_signoff", reason: "all_gates_passed" },
  run: uc05(PT_JOAO, { proposedEndDate: "2026-11-30", reason: "new opportunity", externalRef: "demo-uc05-pt-1" }),
});
S({
  id: "UC05-PT-2", uc: "UC-05", country: "PT", host: "gateway",
  label: "PT employee, same tenure, proposed last working day EARLIER than the statutory notice end",
  expect: { decision: "escalate", reason: "statutory_discrepancy" },
  run: uc05(PT_JOAO, { proposedEndDate: "2026-09-01", reason: "new opportunity", externalRef: "demo-uc05-pt-2" }),
});
S({
  id: "UC05-PT-3", uc: "UC-05", country: "PT", host: "gateway",
  label: "PT contractor, tenure > 2 years — the 60-day bracket again, from a different engagement type",
  expect: { decision: "prepared_for_signoff", reason: "all_gates_passed" },
  run: uc05(PT_INES, { proposedEndDate: "2026-11-30", reason: "personal", externalRef: "demo-uc05-pt-3" }),
});
S({
  id: "UC05-CA-1", uc: "UC-05", country: "CA", host: "gateway",
  label: "CA employee — the table's basis is CUSTOMARY, not statutory. The system must SAY so, not invent a statute",
  expect: { decision: "prepared_for_signoff", reason: "all_gates_passed" },
  run: uc05(CA_DAVID, { proposedEndDate: "2026-09-30", reason: "new opportunity", externalRef: "demo-uc05-ca-1" }),
});
S({
  id: "UC05-CA-2", uc: "UC-05", country: "CA", host: "gateway",
  label: "CA contractor — same customary basis, different engagement type",
  expect: { decision: "prepared_for_signoff", reason: "all_gates_passed" },
  run: uc05(CA_ALEX, { proposedEndDate: "2026-09-30", reason: "new opportunity", externalRef: "demo-uc05-ca-2" }),
});
S({
  id: "UC05-NL-1", uc: "UC-05", country: "NL", host: "gateway",
  label: "NL employee — the Netherlands is NOT in NOTICE_PERIOD_TABLE, so this must escalate legibly",
  expect: { decision: "escalate", reason: "unsupported_country" },
  run: uc05(NL_LARS, { proposedEndDate: "2026-10-31", reason: "new opportunity", externalRef: "demo-uc05-nl-1" }),
});

S({
  id: "UC05-US-1", uc: "UC-05", country: "US", host: "gateway",
  label: "US employee — the United States is NOT in NOTICE_PERIOD_TABLE either. Same refusal as NL, and it must READ right",
  expect: { decision: "escalate", reason: "unsupported_country" },
  run: uc05(US_ALEX, { proposedEndDate: "2026-10-31", reason: "new opportunity", externalRef: "demo-uc05-us-1" }),
});

// ======================= UC-06 — contract amendment / payroll cutoff (🟡) ===
const uc06 = (employmentId, ticket, remote) => async () => {
  const audit = new AuditLogger();
  return handleAmendmentRequest(
    { employmentId, session: { companyId: "a9d4ce72-7773-4ea3-830d-c5b36a15e48d", authenticatedAdminId: "admin_demo" },
      now: NOW, source: "demo", ...ticket },
    { remote, audit, amendmentStore: new AmendmentStore(), draftSummary: uc06Draft, judge: fakeJudge, slack: noSlack }
  );
};
const SALARY_CHANGE = { salary: { oldAmount: 8100000, newAmount: 8600000, currency: "EUR" } };
const SALARY_CHANGE_CAD = { salary: { oldAmount: 9000000, newAmount: 9500000, currency: "CAD" } };
const SALARY_CHANGE_USD = { salary: { oldAmount: 10399748, newAmount: 11000000, currency: "USD" } };
// THE CARRIER MATTERS MORE THAN THE COUNTRY HERE, and finding that out cost a
// whole run. UC-06 validates a full next-state payload against the country's
// contract-amendment form, sourcing each required field from the employment's
// own `contract_details`. That block is RICH on `global_payroll_employee`
// records (23-28 keys, live) and THIN on `employee` (EOR) and `contractor`
// ones (2-6 keys) — a difference in employment TYPE, not in country. Every
// UC-06 row below therefore names the carrier's type, because "UC-06 fails on
// the Netherlands" and "UC-06 fails on EOR employees" are different claims and
// only the second one is true.
S({
  id: "UC06-NL-1", uc: "UC-06", country: "NL", host: "standin, full-time global_payroll_employee",
  label: "THE POSITIVE TEST. NL salary amendment effective 2026-09-15, full-time carrier with a complete contract_details block",
  expect: { decision: "dual_approval_required", reason: "all_gates_passed" },
  run: uc06(NL_EMMA, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-nl-1" }, standin),
});
S({
  id: "UC06-NL-2", uc: "UC-06", country: "NL", host: "gateway, global_payroll_employee",
  label: "NL, SAME request against the raw gateway — the real NL calendar stops at 2026-07-31",
  expect: { decision: "escalate", reason: "no_matching_payroll_cycle" },
  run: uc06(NL_EMMA, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-nl-2" }, gateway),
});
S({
  id: "UC06-NL-3", uc: "UC-06", country: "NL", host: "gateway, global_payroll_employee",
  label: "NL, effective 2026-06-15 — TWO real cycles cover it (a main run and a one_off) with different cutoffs",
  expect: { decision: "escalate", reason: "ambiguous_payroll_cycle" },
  run: uc06(NL_EMMA, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-06-15", externalRef: "demo-uc06-nl-3" }, gateway),
});
S({
  id: "UC06-NL-5", uc: "UC-06", country: "NL", host: "standin, PART-TIME global_payroll_employee",
  label: "NL, identical request, PART-TIME carrier — the NL form's allOf branch adds a field the record does not carry",
  expect: { decision: "escalate", reason: "schema_invalid" },
  run: uc06(NL_ANNA, { changes: { salary: { oldAmount: 3600000, newAmount: 3900000, currency: "EUR" } },
    requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-nl-5" }, standin),
});
S({
  id: "UC06-NL-4", uc: "UC-06", country: "NL", host: "standin, EOR employee",
  label: "NL, identical request, carried by an EOR `employee` record — the thin contract_details block",
  expect: { decision: "escalate", reason: "schema_invalid" },
  run: uc06(NL_LARS, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-nl-4" }, standin),
});
S({
  id: "UC06-CA-1", uc: "UC-06", country: "CA", host: "gateway, global_payroll_employee",
  label: "CA, effective 2026-09-15 — the last real CA cycle ended 2026-06-30, so nothing covers it",
  expect: { decision: "escalate", reason: "no_matching_payroll_cycle" },
  run: uc06(CA_DAVID, { changes: SALARY_CHANGE_CAD, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-ca-1" }, gateway),
});
S({
  id: "UC06-CA-2", uc: "UC-06", country: "CA", host: "gateway, global_payroll_employee",
  label: "CA, effective 2026-06-20 — a REAL cycle covers it (2026-06-15→06-30) whose cutoff has passed",
  expect: { decision: "escalate", reason: "cutoff_lock_passed" },
  run: uc06(CA_DAVID, { changes: SALARY_CHANGE_CAD, requestedEffectiveDate: "2026-06-20", externalRef: "demo-uc06-ca-2" }, gateway),
});
S({
  id: "UC06-CA-3", uc: "UC-06", country: "CA", host: "standin, global_payroll_employee",
  label: "CA against the stand-in — the projected cycle makes the success path reachable here too",
  expect: { decision: "dual_approval_required", reason: "all_gates_passed" },
  run: uc06(CA_DAVID, { changes: SALARY_CHANGE_CAD, requestedEffectiveDate: "2026-09-20", externalRef: "demo-uc06-ca-3" }, standin),
});
S({
  id: "UC06-PT-1", uc: "UC-06", country: "PT", host: "gateway, EOR employee",
  label: "PT — Portugal has NO payroll calendar in the Sandbox, AND no global_payroll_employee record to carry a full form",
  expect: { decision: "escalate", reason: "no_matching_payroll_cycle" },
  run: uc06(PT_JOAO, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-pt-1" }, gateway),
});
S({
  id: "UC06-PT-2", uc: "UC-06", country: "PT", host: "standin, EOR employee",
  label: "PT against the stand-in — projection continues an OBSERVED cadence, and PT has none to continue",
  expect: { decision: "escalate", reason: "no_matching_payroll_cycle" },
  run: uc06(PT_JOAO, { changes: SALARY_CHANGE, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-pt-2" }, standin),
});

S({
  id: "UC06-US-1", uc: "UC-06", country: "US", host: "gateway",
  label: "US, effective 2026-09-15 — the last real US cycle ended 2026-06-30, same calendar situation as CA",
  expect: { decision: "escalate", reason: "no_matching_payroll_cycle" },
  run: uc06(US_ALEX, { changes: SALARY_CHANGE_USD, requestedEffectiveDate: "2026-09-15", externalRef: "demo-uc06-us-1" }, gateway),
});
S({
  id: "UC06-US-2", uc: "UC-06", country: "US", host: "gateway",
  label: "US, effective 2026-06-20 — a REAL cycle covers it (2026-06-01→06-30) whose cutoff has passed",
  expect: { decision: "escalate", reason: "cutoff_lock_passed" },
  run: uc06(US_ALEX, { changes: SALARY_CHANGE_USD, requestedEffectiveDate: "2026-06-20", externalRef: "demo-uc06-us-2" }, gateway),
});
S({
  id: "UC06-US-3", uc: "UC-06", country: "US", host: "standin, global_payroll_employee",
  label: "US against the stand-in, carried by a global_payroll_employee — does the schema read succeed for anyone in the US?",
  expect: { decision: "dual_approval_required", reason: "all_gates_passed" },
  run: uc06(US_AMANDA, { changes: SALARY_CHANGE_USD, requestedEffectiveDate: "2026-09-20", externalRef: "demo-uc06-us-3" }, standin),
});

// ======================= UC-07 — permanent relocation (🔴, no execution) ====
const FEASIBLE_PLAN = {
  destinationSupported: true, destinationEntityActive: true,
  annualGrossSalaryRemoteInteger: 8000000, currency: "EUR", months: 12,
  minimumVisaSalaryRemoteInteger: 5500000, transferFeeRemoteInteger: 150000,
  creationDate: "2026-08-01", proposedStartDate: "2026-11-01",
  destinationStartDate: "2026-11-01", sourceTerminationDate: "2026-10-31",
  sourceLastWorkingDay: "2026-10-31", minimumOnboardingLeadTimeBusinessDays: 20,
  immigrationSupportRequired: false, immigrationConfirmed: true,
  rightToWorkConfirmed: true, destinationStartDateConfirmed: true,
  sourceExitPlanValidated: true, employerPresenceInDestination: true,
  taxTreatyNexusConfirmed: true, ptoTransferAllowed: true, sourcePtoDays: 12,
  seniorityPreservable: true,
};
S({
  id: "UC07-NLPT-1", uc: "UC-07", country: "NL→PT", host: "n/a (no Remote dependency)",
  label: "COMPLETENESS TEST: NL→PT permanent relocation with a clean plan — escalate with a FULL dossier",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: async () =>
    handleRelocationReview(
      { text: "We're permanently relocating our engineer from the Netherlands to Portugal. Visa support needed.",
        employmentId: NL_LARS, externalRef: "demo-uc07-nlpt-1", source: "demo", plan: FEASIBLE_PLAN },
      { audit: new AuditLogger(), classify: parseRelocationRuleBased, draftNarrative: fakeNarrative, judge: fakeJudge }
    ),
});
S({
  id: "UC07-CANL-1", uc: "UC-07", country: "CA→NL", host: "n/a (no Remote dependency)",
  label: "CA→NL relocation with an unconfirmed right to work and a coverage gap — dossier must FLAG, still escalate",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: async () =>
    handleRelocationReview(
      { text: "We are permanently relocating an employee from Canada to the Netherlands. Visa support required.",
        employmentId: CA_DAVID, externalRef: "demo-uc07-canl-1", source: "demo",
        plan: { ...FEASIBLE_PLAN, immigrationSupportRequired: true, immigrationConfirmed: false,
          rightToWorkConfirmed: false, sourceLastWorkingDay: "2026-10-15",
          sourceTerminationDate: "2026-10-15", destinationStartDate: "2026-11-01" } },
      { audit: new AuditLogger(), classify: parseRelocationRuleBased, draftNarrative: fakeNarrative, judge: fakeJudge }
    ),
});

S({
  id: "UC07-USPT-1", uc: "UC-07", country: "US→PT", host: "n/a (no Remote dependency)",
  label: "US→PT permanent relocation, clean plan — the US half of the pair, and a check that the parser resolves both ends",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: async () =>
    handleRelocationReview(
      { text: "We are permanently relocating our engineer from the United States to Portugal. Visa support needed.",
        employmentId: US_ALEX, externalRef: "demo-uc07-uspt-1", source: "demo",
        plan: { ...FEASIBLE_PLAN, currency: "USD" } },
      { audit: new AuditLogger(), classify: parseRelocationRuleBased, draftNarrative: fakeNarrative, judge: fakeJudge }
    ),
});

// ======================= UC-08 — cross-border tax (🔴, no execution) ========
const uc08 = (ticket) => async () =>
  handleTaxInquiry(ticket, {
    audit: new AuditLogger(), classify: parseInquiryRuleBased,
    draftNarrative: fakeNarrative, judge: fakeJudge,
  });
S({
  id: "UC08-NLPT-1", uc: "UC-08", country: "NL→PT", host: "n/a (no Remote dependency)",
  label: "COMPLETENESS TEST: NL employee, 190 presence-days in Portugal in one window — OVER the 183-day line",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "I think I might be a dual resident of the Netherlands and Portugal this year — what happens to my taxes?",
    employmentId: NL_LARS, externalRef: "demo-uc08-nlpt-1", source: "demo",
    targetCountry: "PT", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [
      { country: "PT", startDate: "2026-01-01", endDate: "2026-04-30" },  // 120
      { country: "PT", startDate: "2026-09-01", endDate: "2026-11-08" },  // 69  -> 189
      { country: "NL", startDate: "2026-05-01", endDate: "2026-08-31" },
    ],
  }),
});
S({
  id: "UC08-NLPT-2", uc: "UC-08", country: "NL→PT", host: "n/a (no Remote dependency)",
  label: "The same shape, JUST UNDER: 182 presence-days in Portugal",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "I think I might be a dual resident of the Netherlands and Portugal this year — what happens to my taxes?",
    employmentId: NL_LARS, externalRef: "demo-uc08-nlpt-2", source: "demo",
    targetCountry: "PT", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [
      { country: "PT", startDate: "2026-01-01", endDate: "2026-04-30" },  // 120
      { country: "PT", startDate: "2026-09-01", endDate: "2026-11-01" },  // 62  -> 182
    ],
  }),
});
S({
  id: "UC08-CANL-1", uc: "UC-08", country: "CA→NL", host: "n/a (no Remote dependency)",
  label: "CA→NL social-security question — outside the EU A1 regime, so a bilateral totalization agreement is the instrument",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "Our Canadian employee is spending most of the year in the Netherlands. Which country's social security applies — is there a totalization agreement?",
    employmentId: CA_DAVID, externalRef: "demo-uc08-canl-1", source: "demo",
    targetCountry: "NL", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [{ country: "NL", startDate: "2026-02-01", endDate: "2026-10-31" }],
  }),
});
S({
  id: "UC08-PT-1", uc: "UC-08", country: "PT", host: "n/a (no Remote dependency)",
  label: "PT withholding question with NO presence data supplied — the dossier must say so, not compute a zero",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "Which country should we be withholding income tax in for our Portugal-based employee?",
    employmentId: PT_JOAO, externalRef: "demo-uc08-pt-1", source: "demo", targetCountry: "PT",
  }),
});

S({
  id: "UC08-USNL-1", uc: "UC-08", country: "US→NL", host: "n/a (no Remote dependency)",
  label: "US employee, 200 presence-days in the Netherlands — a treaty pair with an IRS-published text",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "Our US employee has been living in the Netherlands most of this year — could they be a dual resident of the United States and the Netherlands?",
    employmentId: US_ALEX, externalRef: "demo-uc08-usnl-1", source: "demo",
    targetCountry: "NL", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [
      { country: "NL", startDate: "2026-01-01", endDate: "2026-05-31" },   // 151
      { country: "NL", startDate: "2026-09-01", endDate: "2026-10-18" },   // 48 -> 199
      { country: "US", startDate: "2026-06-01", endDate: "2026-08-31" },
    ],
  }),
});
S({
  id: "UC08-USPT-1", uc: "UC-08", country: "US→PT", host: "n/a (no Remote dependency)",
  label: "US employee, 182 presence-days in Portugal — just UNDER, the twin of UC08-NLPT-2",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "Our US employee spent a long stretch in Portugal — is there a withholding or dual-residency issue between the United States and Portugal?",
    employmentId: US_ALEX, externalRef: "demo-uc08-uspt-1", source: "demo",
    targetCountry: "PT", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [
      { country: "PT", startDate: "2026-01-01", endDate: "2026-04-30" },   // 120
      { country: "PT", startDate: "2026-09-01", endDate: "2026-11-01" },   // 62 -> 182
    ],
  }),
});
S({
  id: "UC08-US-CIT", uc: "UC-08", country: "US", host: "n/a (no Remote dependency)",
  label: "GAP PROBE: a US CITIZENSHIP-based taxation question. Does the dossier say anything about citizenship at all?",
  expect: { decision: "escalate", reason: "(no reason key — 🔴 always escalates)" },
  run: uc08({
    text: "Our employee is a US citizen living full-time in Portugal. The US taxes its citizens on worldwide income regardless of residence — does that change what we withhold?",
    employmentId: US_ALEX, externalRef: "demo-uc08-us-cit", source: "demo",
    targetCountry: "PT", windowStart: "2026-01-01", windowEnd: "2026-12-31",
    presencePeriods: [{ country: "PT", startDate: "2026-01-01", endDate: "2026-12-31" }],
  }),
});

// ======================= UC-09 — off-cycle payroll adjustment (🔴 w/ exec) ==
const uc09 = (employmentId, adjustmentRequest, ref) => async () => {
  const audit = new AuditLogger();
  return handleAdjustmentRequest(
    { employmentId, session: { companyId: "a9d4ce72-7773-4ea3-830d-c5b36a15e48d", authenticatedAdminId: "admin_demo" },
      adjustmentRequest, now: NOW, source: "demo", externalRef: ref },
    { remote: gateway, audit, adjustmentStore: new AdjustmentStore(), judge: fakeJudge }
  );
};
S({
  id: "UC09-NL-1", uc: "UC-09", country: "NL", host: "gateway",
  label: "THE POSITIVE TEST. NL bonus of EUR 5,000 — under the amount threshold, so the FLOOR of 2 approvers applies",
  expect: { decision: "dual_approval_required", reason: "standard_adjustment_needs_dual_approval" },
  run: uc09(NL_LARS, { type: "bonus", amount: 500000, currency: "EUR", amountTaxType: "gross",
    description: "Q3 performance bonus" }, "demo-uc09-nl-1"),
});
S({
  id: "UC09-CA-1", uc: "UC-09", country: "CA", host: "gateway",
  label: "CA bonus of CAD 25,000 — ABOVE the sourced amount threshold, so a third approver is required",
  expect: { decision: "triple_approval_required", reason: "high_risk_adjustment_needs_triple_approval" },
  run: uc09(CA_DAVID, { type: "bonus", amount: 2500000, currency: "CAD", amountTaxType: "gross",
    description: "Retention bonus" }, "demo-uc09-ca-1"),
});
S({
  id: "UC09-PT-1", uc: "UC-09", country: "PT", host: "gateway",
  label: "PT commission of EUR 2,000 flagged as a MANUAL TAX ADJUSTMENT — third approver on the tax dimension",
  expect: { decision: "triple_approval_required", reason: "high_risk_adjustment_needs_triple_approval" },
  run: uc09(PT_JOAO, { type: "commission", amount: 200000, currency: "EUR", amountTaxType: "gross",
    taxAdjustment: true, description: "Q3 commission with a manual tax correction" }, "demo-uc09-pt-1"),
});
S({
  id: "UC09-PT-2", uc: "UC-09", country: "PT", host: "gateway",
  label: "PT bonus of EUR 1,000 — plain, under threshold, floor of 2",
  expect: { decision: "dual_approval_required", reason: "standard_adjustment_needs_dual_approval" },
  run: uc09(PT_JOAO, { type: "bonus", amount: 100000, currency: "EUR", amountTaxType: "gross",
    description: "Spot bonus" }, "demo-uc09-pt-2"),
});
S({
  id: "UC09-NL-2", uc: "UC-09", country: "NL", host: "gateway",
  label: "NL bonus with a QUOTED amount (\"500000\") — a number the system does not trust",
  expect: { decision: "escalate", reason: "unparseable_amount" },
  run: uc09(NL_LARS, { type: "bonus", amount: "500000", currency: "EUR", amountTaxType: "gross",
    description: "Bonus with a stringified amount" }, "demo-uc09-nl-2"),
});

S({
  id: "UC09-US-1", uc: "UC-09", country: "US", host: "gateway",
  label: "US bonus of USD 7,500 — under the amount threshold, floor of 2 approvers",
  expect: { decision: "dual_approval_required", reason: "standard_adjustment_needs_dual_approval" },
  run: uc09(US_ALEX, { type: "bonus", amount: 750000, currency: "USD", amountTaxType: "gross",
    description: "Q3 performance bonus" }, "demo-uc09-us-1"),
});
S({
  id: "UC09-US-2", uc: "UC-09", country: "US", host: "gateway",
  label: "US retention bonus of USD 40,000 — the SOURCED amount dimension, well above the ×100 threshold",
  expect: { decision: "triple_approval_required", reason: "high_risk_adjustment_needs_triple_approval" },
  run: uc09(US_AMANDA, { type: "bonus", amount: 4000000, currency: "USD", amountTaxType: "gross",
    description: "Retention bonus" }, "demo-uc09-us-2"),
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function summarise(uc, r) {
  const out = {
    decision: r?.decision ?? null,
    reason: r?.reason ?? null,
    flags: r?.flags ?? null,
  };
  if (uc === "UC-04") {
    out.riskLevel = r?.riskLevel ?? null;
    out.tripDays = r?.tripDays ?? null;
    out.cumulativeDays = r?.cumulativeDays ?? null;
    // The Schengen row lives in `basis.measurements` (src/uc04/decisionFacts.js).
    // `state` is the whole point: "suppressed" must never be readable as "passed".
    const schengen = (r?.basis?.measurements ?? []).find((m) => m.key === "schengen_90_180");
    out.schengenState = schengen?.state ?? "(no schengen row)";
    out.schengenNote = schengen?.note ?? null;
    out.schengenBasis = schengen?.basis ?? null;
    out.decidingDimension = r?.basis?.deciding?.key ?? null;
    out.decidingFinding = r?.basis?.deciding?.finding ?? null;
  }
  if (uc === "UC-05") {
    out.notice = r?.notice
      ? { countryCode: r.notice.countryCode, basis: r.notice.basis, noticeDays: r.notice.noticeDays,
          noticeEndDate: r.notice.noticeEndDate, tenureMonths: r.notice.tenureMonths,
          onProbation: r.notice.onProbation, discrepancy: r.notice.discrepancy,
          sourceCitation: r.notice.sourceCitation, noticeRuleFound: r.notice.noticeRuleFound }
      : null;
  }
  if (uc === "UC-06") out.cutoff = r?.cutoff ?? null;
  if (uc === "UC-07") {
    out.verdict = r?.dossier?.verdict ?? null;
    out.flags = r?.dossier?.flags ?? null;
    out.sourceCountry = r?.dossier?.sourceCountry ?? null;
    out.destinationCountry = r?.dossier?.destinationCountry ?? null;
    out.costStatus = r?.costEstimate?.status ?? null;
    out.dossierId = r?.dossierId ?? null;
  }
  if (uc === "UC-08") {
    out.inquiryType = r?.dossier?.inquiryType ?? null;
    out.jurisdictions = r?.dossier?.jurisdictions ?? null;
    out.presenceDays = r?.presenceDays ?? null;
    out.citations = (r?.dossier?.citations ?? []).map((c) => c.id ?? c.title);
    out.hasDisclaimer = Boolean(r?.dossier?.customerFacingAcknowledgement);
  }
  if (uc === "UC-09") {
    out.approvalSlotsRequired = r?.approvalSlotsRequired ?? null;
    out.riskFlags = r?.riskFlags ?? r?.flags ?? null;
    out.riskBasis = (r?.riskBasis ?? []).map((b) => `${b.dimension}=${b.triggered}`);
  }
  return out;
}

const argJson = process.argv.indexOf("--json");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

const results = [];
for (const s of SCENARIOS) {
  if (only && !s.id.startsWith(only)) continue;
  let observed = null;
  let error = null;
  const t0 = Date.now();
  try {
    observed = summarise(s.uc, await s.run());
  } catch (err) {
    error = `${err.name}: ${err.message}`;
  }
  const ms = Date.now() - t0;
  const match =
    !error &&
    observed.decision === s.expect.decision &&
    (!s.expect.reason || s.expect.reason.startsWith("(") || observed.reason === s.expect.reason);
  results.push({ ...s, run: undefined, observed, error, ms, match });
  const mark = error ? "ERR " : match ? " ok " : "DIFF";
  console.log(
    `[${mark}] ${s.id.padEnd(13)} ${String(s.uc).padEnd(6)} ${String(s.country).padEnd(7)} ${String(s.host).padEnd(28)} ` +
      `expected ${s.expect.decision}/${s.expect.reason ?? "-"}  ->  observed ${error ?? `${observed.decision}/${observed.reason}`}  (${ms}ms)`
  );
}

const ran = results.length;
const matched = results.filter((r) => r.match).length;
console.log(`\n${matched}/${ran} scenarios matched their predicted outcome.`);
const diffs = results.filter((r) => !r.match);
if (diffs.length) {
  console.log("\nDISCREPANCIES (observed wins):");
  for (const d of diffs) {
    console.log(`  ${d.id}: expected ${d.expect.decision}/${d.expect.reason} — observed ${d.error ?? `${d.observed.decision}/${d.observed.reason}`}`);
  }
}

if (argJson !== -1) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.argv[argJson + 1], JSON.stringify(results, null, 2));
  console.log(`\nwrote ${process.argv[argJson + 1]}`);
}
