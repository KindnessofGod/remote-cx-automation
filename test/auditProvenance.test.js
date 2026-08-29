// ---------------------------------------------------------------------------
// auditProvenance.test.js  —  every audit_log row the Node path writes must be
// findable by the reference its requester was actually shown
// ---------------------------------------------------------------------------
// THE DEFECT THIS EXISTS TO CLOSE (measured against the live Supabase project,
// 2026-08-19). Of 13 portal-generated references sitting in `workflow_claims`,
// ZERO had any `audit_log` row carrying that reference in
// `details->>'externalRef'`. The decision rows were all there — written 100-200ms
// after the claim, with `externalRef` null. So the one id handed to a human was
// the one id the Execution & Audit Trail viewer could not search.
//
// The worked example is the whole argument: reference
// `uc02-20260819033052-4mdzn` produced a `human_review` decision at 03:30:52.207
// and a `portal_ticket_creation_failed` row at 03:30:53.003 — the Zendesk
// hand-off failed, so no human will ever see that request. NEITHER row could be
// found by the reference the requester holds. The trail broke precisely where a
// request silently fell on the floor.
//
// WHY IT SURVIVED, AND WHY THIS TEST IS SHAPED THE WAY IT IS. The identical
// omission was found and fixed once already — in UC-02's *n8n node expression*
// (commit 761cd79). The Node app path, which is what the request portal and
// every `ucNN-api` actually run, was never touched, and nothing compared the
// two. Per-row assertions inside each use case's own suite would not have
// caught that either: each file would have kept asserting whatever its own
// workflow happened to write. So the test that matters is CROSS-CUTTING —
// one table, every use case, the same assertion — plus a source-level sweep
// that reaches the branches a behavioural test cannot drive (a Remote write
// refusing, an approval arriving on an already-claimed row).
//
// Coverage in `audit_log` before this pass, per use case: UC-01 73%, UC-02 30%,
// UC-03 81%, UC-04 100%, UC-05 94%, UC-06 83%, UC-07 71%, UC-08 100%,
// UC-09 100% — and `details->>'source'` on 20 rows out of 212.
//
// HERMETIC. Remote is the repo's own mock, dispatched in-process (no port, no
// network); every LLM seam (classify / extract / draftSummary / draftNarrative
// / parseAdjustment / judge) is injected. This devcontainer carries a genuine
// but unreachable OPENAI_API_KEY, so a missed seam is a slow real call, not a
// silent pass — see CLAUDE.md §6.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createInProcessFetch, EXPENSES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";

import { CaseStore } from "../src/shared/caseStore.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { DossierStore as Uc07DossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as Uc08DossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { handleVerificationTicket } from "../src/uc01/workflow.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { handleExpenseSubmission, submitExpenseReview } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { handleWorkationRequest, submitWorkationApproval } from "../src/uc04/workflow.js";
import { handleResignationRequest, submitResignationApproval } from "../src/uc05/workflow.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { handleAmendmentRequest, submitAmendmentApproval } from "../src/uc06/workflow.js";
import { draftSummary as uc06DraftSummary } from "../src/uc06/changeParser.js";
import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { handleAdjustmentRequest, submitAdjustmentApproval } from "../src/uc09/workflow.js";
import { parseAdjustmentRequest } from "../src/uc09/adjustmentParser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The recording double
// ---------------------------------------------------------------------------
// Deliberately NOT AuditLogger: this test is about what a workflow ASKS to be
// recorded, so the double keeps the caller's own event object untouched rather
// than the enriched entry AuditLogger builds. `logTraceStep` is answered but
// its entries are kept apart — a trace step is an `audit_trace` row, a
// different table with a different shape, and folding the two together would
// make the assertion below claim more than it proves.
// ---------------------------------------------------------------------------
class RecordingAudit {
  constructor() {
    this.rows = [];
    this.traces = [];
  }
  log(event) {
    this.rows.push(event);
    return { id: `row_${this.rows.length}`, at: new Date().toISOString(), ...event };
  }
  async logDurable(event) {
    return this.log(event);
  }
  logTraceStep(trace) {
    this.traces.push(trace);
    return { id: `trace_${this.traces.length}`, ...trace };
  }
  async flush() {}
}

/**
 * The one assertion. Every row, no exceptions, no allow-list: a use case that
 * needs an exception has found a real gap in what its store persists, and that
 * is a finding to report rather than a row to excuse.
 */
function assertEveryRowIsFindable(audit, { ref, source, label }) {
  assert.ok(audit.rows.length > 0, `${label}: wrote no audit rows at all — the driver is not exercising the workflow`);
  for (const row of audit.rows) {
    const details = row.details ?? {};
    const where = `${label}: audit row "${row.action}"`;
    assert.ok(
      Object.hasOwn(details, "externalRef"),
      `${where} has no externalRef key at all — src/auditview/readStore.js selects details->>'externalRef' BY NAME, so this row is invisible to the viewer`
    );
    assert.equal(
      details.externalRef,
      ref,
      `${where} carries externalRef ${JSON.stringify(details.externalRef)}, not the reference the requester was shown (${ref})`
    );
    assert.ok(Object.hasOwn(details, "source"), `${where} has no source key — "which surface produced this decision" is unanswerable`);
    assert.equal(details.source, source, `${where} carries source ${JSON.stringify(details.source)}, not ${JSON.stringify(source)}`);
  }
}

// ---------------------------------------------------------------------------
// Hermetic dependencies
// ---------------------------------------------------------------------------

const remote = new RemoteClient({
  baseUrl: "http://mock.remote.invalid",
  fetchImpl: createInProcessFetch(),
});

// Every LLM seam, forced into its own deterministic branch — never a hand-copied
// stand-in that could drift from what production falls back to.
const uc01Classify = classifyRequestRuleBased;
const uc02Classify = (args) => classifyExpenseRuleBased(args);
const uc03Classify = classifyTravelInquiryRuleBased;
const uc05Extract = (args) => extractFromLetter(args, { isConfigured: () => false });
const uc06Draft = (args) => uc06DraftSummary(args, { isConfigured: () => false });
const fakeDraftSummary = async () => ({ summary: "Deterministic summary.", source: "template" });
const fakeDraftNarrative = async () => ({ narrative: "Deterministic narrative.", source: "template" });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

/**
 * UC-09's parser refuses to guess an amount without a model, and the decision
 * under test needs one — so the REAL parser runs, with a scripted model answer
 * in place of the network. Shape validation, source tagging and ×100 scaling
 * are all production's own.
 */
const uc09Parse = (input) =>
  parseAdjustmentRequest(input, {
    isConfigured: () => true,
    backoff: async () => {},
    askJson: async () => ({
      type: "bonus",
      amount: 5000,
      currency: "USD",
      amountTaxType: "gross",
      confidence: 0.9,
      reason: "scripted for the provenance test",
    }),
  });

/** UC-09 drives a real execution, which the mock has no incentive route for. */
const uc09Remote = {
  getEmployment: async (id) => ({
    id,
    status: "active",
    company_id: "co_prov",
    country_code: "US",
    compensation_gross_amount: 10_000_000,
  }),
  getCountrySchema: async () => ({ required: ["employment_id", "type", "amount", "currency"] }),
  createIncentive: async (payload) => ({ success: true, incentiveId: "inc_prov_1", ...payload }),
};

// The mock's expense fixtures are mutated in place by a real PATCH (that is the
// point of a mock that can prove a state change). Snapshot the three columns the
// write touches so this file cannot leave a decided record behind for another
// test in the same process.
const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);
function restoreExpenseFixtures() {
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
}

// ---------------------------------------------------------------------------
// The table: one driver per use case, submission AND — where one exists — the
// human decision that lands days later in a different process.
// ---------------------------------------------------------------------------
const USE_CASES = [
  {
    id: "UC-01",
    async drive({ ref, source, audit }) {
      await handleVerificationTicket(
        {
          text: "Please send me a standard employment verification letter.",
          session: { authenticatedEmploymentId: "emp_active_001" },
          employmentId: "emp_active_001",
          externalRef: ref,
          source,
        },
        { remote, audit, caseStore: new CaseStore(), classify: uc01Classify }
      );
    },
  },

  {
    id: "UC-02",
    async drive({ ref, source, audit }) {
      restoreExpenseFixtures();
      const expenseStore = new ExpenseStore();

      // (a) the auto-approve path: decision row, the durable pre-write row, and
      //     the money-moving `expense_approved_write`.
      const auto = await handleExpenseSubmission(
        {
          expenseId: "exp_auto_101",
          employmentId: "emp_active_001",
          session: { authenticatedEmploymentId: "emp_active_001" },
          externalRef: ref,
          source,
        },
        { remote, audit, expenseStore, classify: uc02Classify }
      );
      assert.equal(auto.decision, "auto_approve", "fixture precondition: this claim must auto-approve");

      // (b) the human's verdict, taken in a different call with only a storeId
      //     in hand — the reference has to come off the stored row or not at all.
      const flagged = await handleExpenseSubmission(
        {
          expenseId: "exp_over_cap_201",
          employmentId: "emp_active_001",
          session: { authenticatedEmploymentId: "emp_active_001" },
          externalRef: ref,
          source,
        },
        { remote, audit, expenseStore, classify: uc02Classify }
      );
      assert.equal(flagged.decision, "human_review", "fixture precondition: this claim must be flagged");

      const reviewed = await submitExpenseReview(
        { storeId: flagged.storeId, action: "approve", reviewer: "finance_ops_jane", note: "checked" },
        { remote, audit, expenseStore }
      );
      assert.equal(reviewed.ok, true, reviewed.reason);

      // (c) a refusal: the same row cannot be decided twice.
      const second = await submitExpenseReview(
        { storeId: flagged.storeId, action: "decline", reviewer: "finance_ops_jane", note: "changed my mind" },
        { remote, audit, expenseStore }
      );
      assert.equal(second.ok, false, "fixture precondition: a settled expense must refuse a second verdict");

      restoreExpenseFixtures();
    },
  },

  {
    id: "UC-03",
    async drive({ ref, source, audit }) {
      await handleTravelInquiry(
        {
          text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
          employmentId: "emp_active_001",
          session: { authenticatedEmploymentId: "emp_active_001" },
          externalRef: ref,
          source,
        },
        { remote, audit, caseStore: new CaseStore(), classify: uc03Classify }
      );
    },
  },

  {
    id: "UC-04",
    async drive({ ref, source, audit }) {
      const authorizationStore = new AuthorizationStore();
      const created = await handleWorkationRequest(
        {
          employmentId: "emp_active_001",
          // FILER `admin_omar`, SIGNATORY `admin_jane` — see the twin comment
          // in test/executionWorld.test.js. DRIFT-098 `[A-1]`: UC-06's
          // requester may sign neither approval slot.
          session: { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" },
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
          reasonText: "Two weeks alongside the Madrid team.",
          externalRef: ref,
          source,
          now: "2026-08-15",
        },
        { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
      );

      const approved = await submitWorkationApproval(
        { authorizationId: created.authorizationId, action: "approve", approver: "mobility_sam" },
        { remote, audit, authorizationStore }
      );
      assert.equal(approved.ok, true, approved.reason);

      // A second approval on a settled row — the refusal path.
      const again = await submitWorkationApproval(
        { authorizationId: created.authorizationId, action: "approve", approver: "mobility_sam" },
        { remote, audit, authorizationStore }
      );
      assert.equal(again.ok, false, "fixture precondition: a settled authorization must refuse a second verdict");
    },
  },

  {
    id: "UC-05",
    async drive({ ref, source, audit }) {
      const resignationStore = new ResignationStore();
      const created = await handleResignationRequest(
        {
          employmentId: "emp_uk_001",
          session: { authenticatedEmploymentId: "emp_uk_001" },
          proposedEndDate: "2026-09-15",
          reason: "new opportunity",
          // The contractual hourly rate, in Remote's x100 form. UC-05 now READS
          // the accrued days from Remote's Time Off API, and Remote publishes
          // no pay rate anywhere — so a request that omits this one is refused
          // at gate 7 rather than settled against an assumed working week. This
          // row has to reach sign-off for the provenance assertion below to
          // mean anything, so the rate is supplied.
          hourlyRateInRemoteInteger: 4000,
          externalRef: ref,
          source,
          now: "2026-08-16",
        },
        { remote, audit, resignationStore, extract: uc05Extract }
      );

      const signed = await submitResignationApproval(
        { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane", note: "looks correct" },
        { remote, audit, resignationStore }
      );
      assert.equal(signed.ok, true, signed.reason);

      const again = await submitResignationApproval(
        { resignationId: created.resignationId, action: "signoff", approver: "hr_ops_jane" },
        { remote, audit, resignationStore }
      );
      assert.equal(again.ok, false, "fixture precondition: a signed-off report must refuse a second verdict");
    },
  },

  {
    id: "UC-06",
    async drive({ ref, source, audit }) {
      const amendmentStore = new AmendmentStore();
      const created = await handleAmendmentRequest(
        {
          employmentId: "emp_nl_amend_003",
          session: { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" },
          changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
          requestedEffectiveDate: "2026-07-15",
          externalRef: ref,
          source,
          now: "2026-06-20",
        },
        { remote, audit, amendmentStore, draftSummary: uc06Draft, judge: fakeJudge, slack: async () => {} }
      );
      assert.equal(created.decision, "dual_approval_required", "fixture precondition: this amendment needs both roles");

      const first = await submitAmendmentApproval(
        { amendmentId: created.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
        { remote, audit, amendmentStore }
      );
      assert.equal(first.ok, true, first.reason);

      const second = await submitAmendmentApproval(
        { amendmentId: created.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
        { remote, audit, amendmentStore }
      );
      assert.equal(second.code, "executed", second.reason);

      const again = await submitAmendmentApproval(
        { amendmentId: created.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
        { remote, audit, amendmentStore }
      );
      assert.equal(again.ok, false, "fixture precondition: an executed amendment must refuse a further verdict");
    },
  },

  {
    id: "UC-07",
    async drive({ ref, source, audit }) {
      await handleRelocationReview(
        {
          text: "We're permanently relocating our engineer from Spain to the Netherlands. We'll need visa support.",
          employmentId: "emp_active_001",
          externalRef: ref,
          source,
          plan: {},
        },
        { audit, dossierStore: new Uc07DossierStore(), classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
      );
    },
  },

  {
    id: "UC-08",
    async drive({ ref, source, audit }) {
      await handleTaxInquiry(
        {
          text: "I need help — I think I'm a dual resident of both Germany and Spain.",
          employmentId: "emp_active_001",
          externalRef: ref,
          source,
        },
        { audit, dossierStore: new Uc08DossierStore(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
      );
    },
  },

  {
    id: "UC-09",
    async drive({ ref, source, audit }) {
      const adjustmentStore = new AdjustmentStore();
      const created = await handleAdjustmentRequest(
        {
          employmentId: "emp_prov_09",
          session: { companyId: "co_prov", authenticatedAdminId: "admin_1" },
          requestText: "Please pay a $5,000 performance bonus off-cycle.",
          reasonText: "Annual performance bonus",
          externalRef: ref,
          source,
        },
        { remote: uc09Remote, audit, adjustmentStore, parseAdjustment: uc09Parse, judge: fakeJudge }
      );
      assert.equal(created.approvalSlotsRequired, 2, "fixture precondition: two approval slots");

      const first = await submitAdjustmentApproval(
        { adjustmentId: created.adjustmentId, role: "requester", action: "approve", approver: "requester_1" },
        { remote: uc09Remote, audit, adjustmentStore }
      );
      assert.equal(first.ok, true, first.reason);

      const second = await submitAdjustmentApproval(
        { adjustmentId: created.adjustmentId, role: "approver", action: "approve", approver: "approver_1" },
        { remote: uc09Remote, audit, adjustmentStore }
      );
      assert.equal(second.code, "executed", second.reason);

      const again = await submitAdjustmentApproval(
        { adjustmentId: created.adjustmentId, role: "approver", action: "approve", approver: "approver_1" },
        { remote: uc09Remote, audit, adjustmentStore }
      );
      assert.equal(again.ok, false, "fixture precondition: an executed adjustment must refuse a further verdict");
    },
  },
];

// ---------------------------------------------------------------------------
// The cross-cutting test
// ---------------------------------------------------------------------------

for (const useCase of USE_CASES) {
  test(`${useCase.id}: every audit row it writes carries the requester's own reference and the surface that produced it`, async () => {
    // Shaped like the real thing the portal mints (`ucNN-YYYYMMDDhhmmss-token`),
    // because that is the string a human is actually shown and later types into
    // the audit viewer's search box.
    const ref = `${useCase.id.toLowerCase().replace("-", "")}-20260819120000-prov1`;
    const source = "portal";
    const audit = new RecordingAudit();

    await useCase.drive({ ref, source, audit });

    assertEveryRowIsFindable(audit, { ref, source, label: useCase.id });
  });
}

test("all nine use cases are in the table — a tenth cannot be added without one", () => {
  assert.deepEqual(
    USE_CASES.map((u) => u.id),
    ["UC-01", "UC-02", "UC-03", "UC-04", "UC-05", "UC-06", "UC-07", "UC-08", "UC-09"]
  );
});

// ---------------------------------------------------------------------------
// The source-level sweep
// ---------------------------------------------------------------------------
// The behavioural table above cannot reach every branch: a Remote write refusing,
// an approval landing on a row another approval already claimed, a letter
// renderer throwing. Those are exactly the rows an investigation needs most, and
// exactly the rows nobody drives on a good day. So this reads every
// audit.log()/logDurable() call site in src/uc01..uc09 and asserts its details
// object names both keys.
//
// It is a text check on purpose — it makes no attempt to prove the VALUE is
// right, which is the behavioural test's job. What it proves is that no call
// site was simply forgotten, which is the failure mode that actually occurred.
// ---------------------------------------------------------------------------

/** Every `audit.log({...})` / `audit.logDurable({...})` block, verbatim. */
function auditCallSites(sourceText) {
  const lines = sourceText.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const opener = lines[i].match(/^(\s*)(?:await\s+)?audit\.(log|logDurable)\(\{\s*$/);
    if (!opener) continue;
    const closer = `${opener[1]}});`;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] === closer) break;
      body.push(lines[j]);
    }
    const text = body.join("\n");
    const action = (text.match(/^\s*action:\s*(.+?),?\s*$/m) || [])[1] ?? "(unknown)";
    blocks.push({ line: i + 1, method: opener[2], action, text });
  }
  return blocks;
}

test("no audit call site in any use case omits externalRef or source", () => {
  const missing = [];
  let checked = 0;
  for (const n of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
    const path = join(__dirname, "..", "src", `uc${n}`, "workflow.js");
    const sites = auditCallSites(readFileSync(path, "utf8"));
    assert.ok(sites.length > 0, `src/uc${n}/workflow.js: found no audit call sites — the parser has drifted from the code`);
    for (const site of sites) {
      checked += 1;
      // Shorthand (`externalRef,`) and explicit (`externalRef: row.externalRef ?? null,`)
      // both count; a parallel NAME does not, because readStore.js selects by name.
      const hasRef = /(^|[{,\s])externalRef\s*[:,]/m.test(site.text);
      const hasSource = /(^|[{,\s])source\s*[:,]/m.test(site.text);
      if (!hasRef || !hasSource) {
        missing.push(`src/uc${n}/workflow.js:${site.line} (${site.action}) missing ${[!hasRef && "externalRef", !hasSource && "source"].filter(Boolean).join(" + ")}`);
      }
    }
  }
  assert.ok(checked >= 41, `expected to sweep every call site, only saw ${checked}`);
  assert.deepEqual(missing, [], `audit rows that cannot be found by the requester's reference:\n  ${missing.join("\n  ")}`);
});
