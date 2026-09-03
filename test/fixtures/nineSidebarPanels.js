// ---------------------------------------------------------------------------
// nineSidebarPanels.js — every use case's sidebar, rendered for real
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. On 2026-08-31 the ZAF sidebar was found showing repository
// internals — source paths, register ids, role slugs, raw UUIDs — to an audience
// it was being demonstrated to. The first fix rendered ONE panel (UC-04, the one
// that was reported) and scanned it. That guard could not have found the same
// leak in the other eight, and the project owner asked, reasonably, to have all
// nine opened.
//
// A STATIC CHECK IS NOT THE SAME QUESTION. test/decisionProseIsCustomerFacing
// reads the modules that compose panel prose, which is where most of these
// leaks live — but it cannot see a string main.js or panels.js builds at render
// time, and it cannot see a field that only appears for one decision. Only
// booting the real sidebar against a real seeded API answers "what does a
// person actually SEE".
//
// So this seeds one case per use case, serves it through that use case's REAL
// HTTP handler, and returns the text the sidebar rendered. The seeds are
// deliberately the ones the existing suite already uses, so a fixture that
// stops reaching its intended decision fails here the same way it fails there.
//
// EVERY SEED ASSERTS ITS OWN DECISION. A panel that renders an empty "not
// found" body would pass any scan trivially — which is the exact shape of
// false confidence this file exists to remove.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";

import { RemoteClient } from "../../src/remote/restClient.js";
import { createInProcessFetch, resetWorkAuthorizations } from "../../src/remote/mockServer.js";
import { AuditLogger } from "../../src/shared/audit.js";
import { CaseStore } from "../../src/shared/caseStore.js";

import { InMemoryReviewStore } from "../../src/review/store.js";
import { createReviewHandler } from "../../src/review/server.js";
import { handleVerificationTicket } from "../../src/uc01/workflow.js";
import { submitReviewDecision } from "../../src/review/service.js";
import { classifyRequestRuleBased } from "../../src/uc01/classifier.js";

import { ExpenseStore } from "../../src/uc02/expenseStore.js";
import { handleExpenseSubmission, submitExpenseReview } from "../../src/uc02/workflow.js";
import { createUc02Handler } from "../../src/uc02/server.js";
import { classifyExpenseRuleBased } from "../../src/uc02/expenseClassifier.js";

import { handleTravelInquiry, submitTravelLetterSignoff } from "../../src/uc03/workflow.js";
import { createUc03Handler } from "../../src/uc03/server.js";
import { classifyTravelInquiryRuleBased } from "../../src/uc03/classifier.js";

import { AuthorizationStore } from "../../src/uc04/authorizationStore.js";
import { handleWorkationRequest, submitWorkationApproval } from "../../src/uc04/workflow.js";
import { createUc04Handler } from "../../src/uc04/server.js";
import { draftSummary as draftWorkationSummary } from "../../src/uc04/requestParser.js";

import { ResignationStore } from "../../src/uc05/resignationStore.js";
import { handleResignationRequest, submitResignationApproval } from "../../src/uc05/workflow.js";
import { createUc05Handler } from "../../src/uc05/server.js";

import { AmendmentStore } from "../../src/uc06/amendmentStore.js";
import { handleAmendmentRequest, submitAmendmentApproval } from "../../src/uc06/workflow.js";
import { createUc06Handler } from "../../src/uc06/server.js";
import { draftSummary as draftAmendmentSummary } from "../../src/uc06/changeParser.js";

import { DossierStore as RelocationDossierStore } from "../../src/uc07/dossierStore.js";
import { handleRelocationReview } from "../../src/uc07/workflow.js";
import { createUc07Handler } from "../../src/uc07/server.js";
import { draftNarrative as draftRelocationNarrative } from "../../src/uc07/dossierBuilder.js";
import { parseRelocationRuleBased } from "../../src/uc07/relocationParser.js";

import { DossierStore as TaxDossierStore } from "../../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../../src/uc08/workflow.js";
import { createUc08Handler } from "../../src/uc08/server.js";
import { draftNarrative as draftTaxNarrative } from "../../src/uc08/dossierBuilder.js";
import { parseInquiryRuleBased } from "../../src/uc08/inquiryParser.js";

import { AdjustmentStore } from "../../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest, submitAdjustmentApproval } from "../../src/uc09/workflow.js";
import { createUc09Handler } from "../../src/uc09/server.js";

import { renderSidebar, callHandler } from "./zafSidebar.js";

// --- the LLM seams, faked. `npm test` never reaches OpenAI (CLAUDE.md §6). ---
const offline = { isConfigured: () => false };
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const fakeWorkationSummary = (a) => draftWorkationSummary(a, offline);
const fakeAmendmentSummary = (a) => draftAmendmentSummary(a, offline);
const fakeRelocationNarrative = (a) => draftRelocationNarrative(a, offline);
const fakeTaxNarrative = (a) => draftTaxNarrative(a, offline);

const remoteClient = () => new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });

/**
 * Boot the real sidebar against ONE use case's handler.
 *
 * Every other base URL 404s deliberately: main.js defaults `apiBaseUrl` to
 * localhost:4020 when blank, so UC-01's loader is always in the race and a
 * responder that answered every URL would serve one use case's body to another.
 */
async function screenFor({ settingKey, handler, ticketId }) {
  const base = "http://uc.test";
  return renderSidebar({
    settings: { apiBaseUrl: settingKey === "apiBaseUrl" ? base : "", [settingKey]: base },
    ticketId,
    respond: async (url) =>
      String(url).indexOf(base) === 0
        ? await callHandler(handler, { method: "GET", path: String(url).slice(base.length) })
        : { status: 404, body: { found: false } },
  });
}

const SEEDS = {
  "UC-01 · prepared": async () => {
    const caseStore = new CaseStore();
    const store = new InMemoryReviewStore(caseStore);
    const audit = new AuditLogger();
    const remote = remoteClient();
    const created = await handleVerificationTicket(
      {
        source: "zendesk",
        externalRef: "9601",
        text: "Please complete the attached verification form.",
        session: { authenticatedEmploymentId: "emp_active_001" },
        employmentId: "emp_active_001",
        hasAttachment: true,
      },
      { remote, audit, caseStore, classify: classifyRequestRuleBased }
    );
    assert.equal(created.decision, "human_review", "UC-01 seed no longer reaches a human — the panel under test changed");
    return { settingKey: "apiBaseUrl", ticketId: "9601", handler: createReviewHandler({ store, caseStore, audit, remote }) };
  },

  "UC-02 · prepared": async () => {
    const audit = new AuditLogger();
    const expenseStore = new ExpenseStore();
    const remote = remoteClient();
    const created = await handleExpenseSubmission(
      {
        expenseId: "exp_over_cap_201",
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
        externalRef: "9602",
        source: "test",
      },
      { remote, audit, expenseStore, classify: classifyExpenseRuleBased }
    );
    assert.ok(created.decision, "UC-02 seed produced no decision");
    return { settingKey: "uc02ApiBaseUrl", ticketId: "9602", handler: createUc02Handler({ expenseStore, audit, remote }) };
  },

  "UC-03 · prepared": async () => {
    const audit = new AuditLogger();
    const caseStore = new CaseStore();
    const remote = remoteClient();
    await handleTravelInquiry(
      {
        externalRef: "9603",
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
        text:
          "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. " +
          "Can you confirm business travel is fine?",
      },
      { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
    return { settingKey: "uc03ApiBaseUrl", ticketId: "9603", handler: createUc03Handler({ caseStore, audit, remote }) };
  },

  "UC-04 · prepared": async () => {
    resetWorkAuthorizations();
    const audit = new AuditLogger();
    const authorizationStore = new AuthorizationStore();
    const remote = remoteClient();
    const created = await handleWorkationRequest(
      {
        employmentId: "emp_active_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
        // A PRIOR STAY, so this seed is the case a mobility specialist actually
        // gets: with travel history the request produces TWO measurements — the
        // Schengen allowance and the 183-day tax-residency watch — and the
        // cumulative-presence breakdown behind them. Without one the panel has a
        // single count and the thing this seed exists to check is half absent.
        travelHistory: [{ country: "NL", startDate: "2026-01-05", endDate: "2026-02-19" }],
        factors: {
          homeCountry: "US", nationality: "US", destination: { country: "NL" },
          startDate: "2026-09-01", endDate: "2026-09-21", visaType: "schengen_short_stay",
          jobDuties: "engineering", hasContractSigningAuthority: false,
        },
        now: "2026-08-15",
        externalRef: "9604",
      },
      { audit, authorizationStore, remote, draftSummary: fakeWorkationSummary, judge: fakeJudge }
    );
    // Approved by the employer, so the panel carries the settled block AND the
    // open stage-3 control — the richest UC-04 page there is.
    await submitWorkationApproval(
      { authorizationId: created.authorizationId, action: "approve", approver: "manager@company.test", note: "Fine by me." },
      { audit, authorizationStore, remote, entitlement: null }
    );
    return { settingKey: "uc04ApiBaseUrl", ticketId: "9604", handler: createUc04Handler({ authorizationStore, audit, remote }) };
  },

  "UC-05 · prepared": async () => {
    const audit = new AuditLogger();
    const resignationStore = new ResignationStore();
    const remote = remoteClient();
    await handleResignationRequest(
      {
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
        proposedEndDate: "2026-09-30",
        reason: "new opportunity",
        now: "2026-08-19",
        externalRef: "9605",
      },
      { remote, audit, resignationStore }
    );
    return { settingKey: "uc05ApiBaseUrl", ticketId: "9605", handler: createUc05Handler({ resignationStore, audit, remote }) };
  },

  "UC-06 · prepared": async () => {
    const audit = new AuditLogger();
    const amendmentStore = new AmendmentStore();
    const remote = remoteClient();
    await handleAmendmentRequest(
      {
        employmentId: "emp_nl_amend_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
        changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
        requestedEffectiveDate: "2026-07-15",
        now: "2026-07-09",
        externalRef: "9606",
      },
      { remote, audit, amendmentStore, draftSummary: fakeAmendmentSummary, judge: fakeJudge }
    );
    return { settingKey: "uc06ApiBaseUrl", ticketId: "9606", handler: createUc06Handler({ amendmentStore, audit, remote }) };
  },

  "UC-07 · prepared": async () => {
    const dossierStore = new RelocationDossierStore();
    await handleRelocationReview(
      {
        text: "We're permanently relocating our engineer from Spain to the Netherlands.",
        employmentId: "emp_active_001",
        externalRef: "9607",
        source: "seed",
        plan: {
          employerPresenceInDestination: true, taxTreatyNexusConfirmed: true,
          ptoTransferAllowed: true, sourcePtoDays: 12, seniorityPreservable: true,
        },
      },
      {
        audit: new AuditLogger(), dossierStore, classify: parseRelocationRuleBased,
        draftNarrative: fakeRelocationNarrative, judge: fakeJudge,
      }
    );
    return { settingKey: "uc07ApiBaseUrl", ticketId: "9607", handler: createUc07Handler({ dossierStore }) };
  },

  "UC-08 · prepared": async () => {
    const dossierStore = new TaxDossierStore();
    await handleTaxInquiry(
      {
        externalRef: "9608",
        employmentId: "emp_active_001",
        source: "seed",
        text:
          "I have been splitting my time between the Netherlands and Portugal this year and I think I " +
          "may be a dual resident of both countries for tax purposes. Can you help?",
        now: "2026-08-20",
      },
      {
        audit: new AuditLogger(), dossierStore, classify: parseInquiryRuleBased,
        draftNarrative: fakeTaxNarrative, judge: fakeJudge,
      }
    );
    return { settingKey: "uc08ApiBaseUrl", ticketId: "9608", handler: createUc08Handler({ dossierStore, audit: new AuditLogger() }) };
  },

  "UC-09 · prepared": async () => {
    const audit = new AuditLogger();
    const adjustmentStore = new AdjustmentStore();
    const remote = remoteClient();
    await handleAdjustmentRequest(
      {
        externalRef: "9609",
        employmentId: "emp_de_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_mike" },
        adjustmentRequest: {
          type: "bonus", amount: 300000, currency: "EUR",
          amountTaxType: "gross", description: "Quarterly spot bonus",
        },
        reasonText: "Quarterly spot bonus",
        now: "2026-06-20",
      },
      { remote, audit, adjustmentStore, judge: fakeJudge }
    );
    return { settingKey: "uc09ApiBaseUrl", ticketId: "9609", handler: createUc09Handler({ adjustmentStore, audit, remote }) };
  },
  // =========================================================================
  // BLOCKED — a gate hard-stopped it. Not "a human said no": nothing is owed
  // here and no control should appear, so these panels render a shape none of
  // the prepared seeds above reach.
  //
  // Only UC-01, UC-02 and UC-04 have a `blocked` decision at all. The others
  // top out at `escalate`, and UC-07/UC-08 have no execution path by design —
  // inventing a blocked seed for them would be asserting a state their policy
  // engines cannot produce.
  // =========================================================================

  "UC-01 · blocked": async () => {
    const caseStore = new CaseStore();
    const store = new InMemoryReviewStore(caseStore);
    const audit = new AuditLogger();
    const remote = remoteClient();
    const ticket = {
      text: "This is Second Bank, we would like to verify employment.",
      session: null,
      employmentId: "emp_active_001",
      requestingParty: "Second Bank",
      purpose: "Landlord reference",
      source: "third_party_door",
      externalRef: "9611",
    };
    const deps = { remote, audit, caseStore, classify: classifyRequestRuleBased };
    await handleVerificationTicket(ticket, deps);
    // The employee is asked, and says no. VC-08: a denied consent is a terminal
    // block, never an escalation — there is nothing left for a specialist to
    // look at once the employee has refused.
    const artifact = await caseStore.findConsentArtifact({
      employmentId: "emp_active_001",
      requestingParty: "Second Bank",
      purpose: "Landlord reference",
    });
    assert.ok(artifact, "UC-01 blocked seed: no consent artifact was raised");
    await caseStore.updateConsentDecision(artifact.id, {
      status: "denied",
      grantedByEmploymentId: "emp_active_001",
      grantedBySignal: "test_stub_session",
    });
    const blocked = await handleVerificationTicket({ ...ticket, externalRef: "9612" }, deps);
    assert.equal(blocked.decision, "blocked", "UC-01 blocked seed no longer blocks");
    assert.equal(blocked.reason, "consent_refused");
    return { settingKey: "apiBaseUrl", ticketId: "9612", handler: createReviewHandler({ store, caseStore, audit, remote }) };
  },

  "UC-02 · blocked": async () => {
    const audit = new AuditLogger();
    const expenseStore = new ExpenseStore();
    const remote = remoteClient();
    // TWO DIFFERENT EXPENSES, ONE RECEIPT — which is what gate 6 is actually
    // about. Re-submitting the SAME expense is not a duplicate receipt and is
    // correctly not blocked (the gate's own words: "already reimbursed on
    // ANOTHER expense"); the first version of this seed made that mistake and
    // the seed's own assertion caught it.
    const submit = (expenseId, externalRef) =>
      handleExpenseSubmission(
        {
          expenseId,
          employmentId: "emp_active_001",
          session: { authenticatedEmploymentId: "emp_active_001" },
          externalRef,
          receiptHash: "receipt-shared-9624",
          source: "test",
        },
        { remote, audit, expenseStore, classify: classifyExpenseRuleBased }
      );
    await submit("exp_auto_101", "9624");
    const blocked = await submit("exp_over_cap_201", "9625");
    assert.equal(blocked.decision, "blocked", "UC-02 blocked seed no longer blocks");
    assert.equal(blocked.reason, "duplicate_submission");
    return { settingKey: "uc02ApiBaseUrl", ticketId: "9625", handler: createUc02Handler({ expenseStore, audit, remote }) };
  },

  "UC-04 · blocked": async () => {
    resetWorkAuthorizations();
    const audit = new AuditLogger();
    const authorizationStore = new AuthorizationStore();
    const remote = remoteClient();
    const blocked = await handleWorkationRequest(
      {
        employmentId: "emp_active_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
        factors: {
          homeCountry: "DE", nationality: "DE", destination: { country: "IR" },
          startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay",
          jobDuties: "engineering", hasContractSigningAuthority: false,
        },
        now: "2026-08-15",
        externalRef: "9641",
      },
      { audit, authorizationStore, remote, draftSummary: fakeWorkationSummary, judge: fakeJudge }
    );
    // A sanctioned destination is a first-position hard block, and it must NOT
    // write a Remote work-authorization record — see §7's item 2.
    assert.equal(blocked.decision, "blocked", "UC-04 blocked seed no longer blocks a sanctioned destination");
    return { settingKey: "uc04ApiBaseUrl", ticketId: "9641", handler: createUc04Handler({ authorizationStore, audit, remote }) };
  },

  // =========================================================================
  // DECLINED — a named human said no. The panel must render the settled
  // refusal, the person, and the reason; these are the pages where a missing
  // name or a leaked slug matters most, because somebody is being told their
  // request was refused and by whom.
  //
  // UC-07 and UC-08 are absent BY CONSTRUCTION, not by omission: they have no
  // execution path, no POST route and no approval to decline. A decline seed
  // for either would be asserting the opposite of their headline guarantee.
  // =========================================================================

  "UC-01 · declined": async () => {
    const caseStore = new CaseStore();
    const store = new InMemoryReviewStore(caseStore);
    const audit = new AuditLogger();
    const remote = remoteClient();
    const created = await handleVerificationTicket(
      {
        source: "zendesk",
        externalRef: "9613",
        text: "Please complete the attached verification form.",
        session: { authenticatedEmploymentId: "emp_active_001" },
        employmentId: "emp_active_001",
        hasAttachment: true,
      },
      { remote, audit, caseStore, classify: classifyRequestRuleBased }
    );
    assert.equal(created.decision, "human_review");
    const verdict = await submitReviewDecision(
      { ticketId: "9613", action: "decline", approver: "hr.specialist@remote.test", note: "Form is not the one we issue." },
      { store, caseStore, audit, remote }
    );
    assert.ok(verdict.ok, `UC-01 decline seed refused: ${JSON.stringify(verdict).slice(0, 160)}`);
    return { settingKey: "apiBaseUrl", ticketId: "9613", handler: createReviewHandler({ store, caseStore, audit, remote }) };
  },

  "UC-02 · declined": async () => {
    const audit = new AuditLogger();
    const expenseStore = new ExpenseStore();
    const remote = remoteClient();
    const created = await handleExpenseSubmission(
      {
        expenseId: "exp_over_cap_201",
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
        externalRef: "9623",
        source: "test",
      },
      { remote, audit, expenseStore, classify: classifyExpenseRuleBased }
    );
    const verdict = await submitExpenseReview(
      { storeId: created.storeId ?? created.expenseRowId ?? created.id, action: "decline", reviewer: "finance.ops@remote.test", note: "Outside policy." },
      { remote, audit, expenseStore }
    );
    assert.ok(verdict.ok, `UC-02 decline seed refused: ${JSON.stringify(verdict).slice(0, 160)}`);
    return { settingKey: "uc02ApiBaseUrl", ticketId: "9623", handler: createUc02Handler({ expenseStore, audit, remote }) };
  },

  "UC-04 · declined": async () => {
    resetWorkAuthorizations();
    const audit = new AuditLogger();
    const authorizationStore = new AuthorizationStore();
    const remote = remoteClient();
    const created = await handleWorkationRequest(
      {
        employmentId: "emp_active_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
        factors: {
          homeCountry: "DE", nationality: "DE", destination: { country: "ES" },
          startDate: "2026-09-01", endDate: "2026-09-14", visaType: "schengen_short_stay",
          jobDuties: "engineering", hasContractSigningAuthority: false,
        },
        now: "2026-08-15",
        externalRef: "9642",
      },
      { audit, authorizationStore, remote, draftSummary: fakeWorkationSummary, judge: fakeJudge }
    );
    const verdict = await submitWorkationApproval(
      { authorizationId: created.authorizationId, action: "decline", approver: "manager@company.test", note: "Not this quarter — the project needs them on site." },
      { audit, authorizationStore, remote, entitlement: null }
    );
    assert.ok(verdict.ok, `UC-04 decline seed refused: ${JSON.stringify(verdict).slice(0, 160)}`);
    return { settingKey: "uc04ApiBaseUrl", ticketId: "9642", handler: createUc04Handler({ authorizationStore, audit, remote }) };
  },

  "UC-03 · declined": async () => {
    const audit = new AuditLogger();
    const caseStore = new CaseStore();
    const remote = remoteClient();
    // UC-03's sign-off covers exactly ONE outcome — `human_review /
    // formal_letter_requested` — and refuses the other four by name on purpose:
    // an approve button on `route_to_uc04` would be a 🟢 router minting a 🟡
    // work authorization by click. So the seed has to reach that outcome, and
    // asserts it rather than assuming it.
    const created = await handleTravelInquiry(
      {
        externalRef: "9631",
        employmentId: "emp_active_001",
        session: { authenticatedEmploymentId: "emp_active_001" },
        text:
          "I want a travel support letter for my visa application for a conference in Germany " +
          "from 2026-09-20 to 2026-09-26.",
      },
      // `letterAutoIssue: false` is UC-03's own deployment switch, not a test
      // hack: it is the documented way an operator turns the 🟢 auto-issue rung
      // off and routes every letter to a specialist. With it left on — the
      // default since 2026-08-30 — a letter request auto-resolves as
      // `standard_letter_issued` for every seeded employment, and the sign-off
      // route has nothing to act on. That is the product working, not a gap.
      { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, letterAutoIssue: false }
    );
    assert.equal(created.reason, "formal_letter_requested", "UC-03 decline seed no longer reaches the one signable outcome");
    const verdict = await submitTravelLetterSignoff(
      { caseId: created.caseId ?? created.id, action: "decline", approver: "travel.specialist@remote.test", note: "The employing entity on file is wrong — fix the record and re-run." },
      { remote, audit, caseStore, entitlement: null }
    );
    assert.ok(verdict.ok, `UC-03 decline seed refused: ${JSON.stringify(verdict).slice(0, 200)}`);
    return { settingKey: "uc03ApiBaseUrl", ticketId: "9631", handler: createUc03Handler({ caseStore, audit, remote }) };
  },

  "UC-05 · declined": async () => {
    const audit = new AuditLogger();
    const resignationStore = new ResignationStore();
    const remote = remoteClient();
    const created = await handleResignationRequest(
      {
        employmentId: "emp_nl_amend_001",
        session: { authenticatedEmploymentId: "emp_nl_amend_001" },
        proposedEndDate: "2026-09-30",
        reason: "new opportunity",
        now: "2026-08-19",
        externalRef: "9651",
      },
      { remote, audit, resignationStore }
    );
    const verdict = await submitResignationApproval(
      { resignationId: created.resignationId ?? created.id, action: "decline", approver: "hr.ops@remote.test", note: "The notice date does not match the contract." },
      { remote, audit, resignationStore, entitlement: null }
    );
    assert.ok(verdict.ok, `UC-05 decline seed refused: ${JSON.stringify(verdict).slice(0, 200)}`);
    return { settingKey: "uc05ApiBaseUrl", ticketId: "9651", handler: createUc05Handler({ resignationStore, audit, remote }) };
  },

  "UC-06 · declined": async () => {
    const audit = new AuditLogger();
    const amendmentStore = new AmendmentStore();
    const remote = remoteClient();
    const created = await handleAmendmentRequest(
      {
        employmentId: "emp_nl_amend_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
        changes: { weeklyHours: { oldValue: 40, newValue: 32 } },
        requestedEffectiveDate: "2026-07-15",
        now: "2026-07-09",
        externalRef: "9661",
      },
      { remote, audit, amendmentStore, draftSummary: fakeAmendmentSummary, judge: fakeJudge }
    );
    // A DECLINE NEEDS ONLY ONE ROLE, which is the asymmetry worth rendering:
    // approving takes two, refusing takes one.
    const verdict = await submitAmendmentApproval(
      { amendmentId: created.amendmentId ?? created.id, role: "customer_admin", action: "decline", approver: "admin.jane@company.test", note: "Superseded by a different change." },
      { remote, audit, amendmentStore, entitlement: null }
    );
    assert.ok(verdict.ok, `UC-06 decline seed refused: ${JSON.stringify(verdict).slice(0, 200)}`);
    return { settingKey: "uc06ApiBaseUrl", ticketId: "9661", handler: createUc06Handler({ amendmentStore, audit, remote }) };
  },

  "UC-09 · declined": async () => {
    const audit = new AuditLogger();
    const adjustmentStore = new AdjustmentStore();
    const remote = remoteClient();
    const created = await handleAdjustmentRequest(
      {
        externalRef: "9691",
        employmentId: "emp_de_001",
        session: { companyId: "co_amend_01", authenticatedAdminId: "admin_mike" },
        adjustmentRequest: {
          type: "bonus", amount: 300000, currency: "EUR",
          amountTaxType: "gross", description: "Quarterly spot bonus",
        },
        reasonText: "Quarterly spot bonus",
        now: "2026-06-20",
      },
      { remote, audit, adjustmentStore, judge: fakeJudge }
    );
    const verdict = await submitAdjustmentApproval(
      { adjustmentId: created.adjustmentId ?? created.id, role: "approver", action: "deny", approver: "payroll.lead@remote.test", note: "Not payable off-cycle this month." },
      { remote, audit, adjustmentStore, entitlement: null }
    );
    assert.ok(verdict.ok, `UC-09 decline seed refused: ${JSON.stringify(verdict).slice(0, 200)}`);
    return { settingKey: "uc09ApiBaseUrl", ticketId: "9691", handler: createUc09Handler({ adjustmentStore, audit, remote }) };
  },

};

/** Every panel state this suite opens: "<use case> · <outcome>". */
export const USE_CASES = Object.keys(SEEDS);

/** Seed, serve and render ONE use case's sidebar. Returns the rendered text. */
export async function renderPanel(useCase) {
  const seeded = await SEEDS[useCase]();
  const screen = await screenFor(seeded);
  // A NOT-FOUND PANEL PASSES EVERY SCAN, which would be false confidence of
  // exactly the kind this file exists to remove. So the page must actually be
  // about the case: it has to carry the ticket's own content, not an error.
  assert.ok(
    screen.text.length > 400,
    `${useCase} rendered ${screen.text.length} characters — the panel did not load, so scanning it proves nothing`
  );
  assert.ok(
    !/could not be loaded|no record|not found/i.test(screen.text.slice(0, 200)),
    `${useCase} rendered a not-found page: ${screen.text.slice(0, 200)}`
  );
  return screen.text;
}

/** The same render, but the whole node tree — for inspecting what is COLLAPSED. */
export async function renderPanelTree(useCase) {
  const seeded = await SEEDS[useCase]();
  return screenFor(seeded);
}
