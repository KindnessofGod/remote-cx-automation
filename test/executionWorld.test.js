// ---------------------------------------------------------------------------
// executionWorld.test.js — a record is executed in the world it was decided in
// ---------------------------------------------------------------------------
// THE DEFECT (found live 2026-08-19, by a human clicking Release in the ZAF
// sidebar):
//
//   Remote API PATCH /v1/expenses/exp_sandbox_over_cap_402~fresh-0425041sf1
//   failed: 404
//
// The request portal DECIDES against this repo's mock Remote — deliberately,
// so a publicly reachable page can never write into a real account — and the
// nine review APIs EXECUTED against the real gateway. A portal-originated
// claim therefore addressed an `exp_*` fixture id the real Sandbox has never
// heard of (its expenses are UUIDs, a wholly disjoint set), and no
// portal-originated UC-02 claim could ever be released or declined.
//
// WHY EVERY EXISTING TEST PASSED. Refusing correctly and being structurally
// unable to succeed produce identical output from outside. This repository's
// most expensive recurring lesson (CLAUDE.md §4/§5), and the only thing that
// detects it is a MUST-SUCCEED test. So the load-bearing tests here are the
// POSITIVE ones: a portal-originated record MUST be executable end to end,
// reaching the mock and producing a real `remoteResult`.
//
// AND THE CONVERSE, WHICH MATTERS JUST AS MUCH. An ordinary record must still
// execute against the real client. Both directions are proven with an injected
// fake that RECORDS WHICH CLIENT IT WAS HANDED — never by asserting on the
// shape of an id, because the portal's personas MIRROR real Sandbox employment
// ids (Chris Lee `8ab12460-…` is the genuine Sandbox id), so an id heuristic
// would be right about employments and wrong about every sub-record, and wrong
// invisibly.
//
// Hermetic throughout: the "mock world" here is createInProcessFetch(), which
// dispatches into src/remote/mockServer.js's route table in-process — no
// socket, no network. The "real world" is a recording fake, so no test here can
// reach a real gateway even if one were configured.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { sourceAwareRemote, mockRemoteClient } from "../deploy/cx-apis/deps.js";
import { PORTAL_SOURCE } from "../src/portal/server.js";
import { remoteFor } from "../src/shared/remoteWorld.js";

import { EXPENSES } from "../src/remote/mockServer.js";
import { AuditLogger } from "../src/shared/audit.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission, submitExpenseReview } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";

import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { handleWorkationRequest, submitWorkationApproval } from "../src/uc04/workflow.js";
import { draftSummary as uc04DraftSummary } from "../src/uc04/requestParser.js";
import { VISA_TYPES, JOB_DUTY_CATEGORIES } from "../src/uc04/riskMatrix.js";

import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest, submitAmendmentApproval } from "../src/uc06/workflow.js";
import { draftSummary as uc06DraftSummary } from "../src/uc06/changeParser.js";

import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest, submitAdjustmentApproval } from "../src/uc09/workflow.js";

// The mock world, as a client — the same constructor deps.js gives the portal
// and gives any portal-originated record at execution time.
const mock = mockRemoteClient();

// Never a real, retried LLM call from a suite that does not care about prose
// (CLAUDE.md §6). Each runs the REAL drafter forced into its unconfigured
// branch, so the wording is production's own fallback, not a copy.
const fakeUc04Draft = (args) => uc04DraftSummary(args, { isConfigured: () => false });
const fakeUc06Draft = (args) => uc06DraftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });
const classify = (args) => classifyExpenseRuleBased(args);

/**
 * A stand-in for the REAL Remote client that records every call made on it.
 *
 * This is the whole discriminator of this suite. Asserting "the write went to
 * the mock" by looking at the id would re-implement the very heuristic that is
 * wrong here; asserting on WHICH OBJECT was called cannot be fooled.
 *
 * `getEmployment` answers with an active record so the non-portal cases reach
 * their write instead of stopping at the freshness gate — the freshness gate
 * is not what is under test.
 */
function recordingRealRemote({ activeContractId = "ctr_real_001" } = {}) {
  const calls = [];
  const record = (name, result) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(typeof result === "function" ? result(...args) : result);
  };
  return {
    calls,
    names: () => calls.map((c) => c.name),
    getEmployment: record("getEmployment", (id) => ({
      id,
      status: "active",
      company_id: "co_amend_01",
      country_code: "US",
      active_contract_id: activeContractId,
    })),
    patchExpenseStatus: record("patchExpenseStatus", { __from: "real" }),
    patchWorkAuthorization: record("patchWorkAuthorization", { __from: "real" }),
    createContractAmendment: record("createContractAmendment", { __from: "real" }),
    createIncentive: record("createIncentive", { __from: "real" }),
  };
}

// The mock's expense fixtures are MUTATED by a real PATCH — correctly, a PATCH
// is a state change — but EXPENSES is one module-level object shared by every
// mock dispatcher in this process. Snapshot the three fields a PATCH writes and
// restore them per test, or test 1's release leaves the fixture non-pending and
// every later submission fails for a reason that points at the wrong thing.
const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

let audit;
beforeEach(() => {
  audit = new AuditLogger();
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

// ---------------------------------------------------------------------------
// 0. The resolver itself
// ---------------------------------------------------------------------------

test("0a. sourceAwareRemote is ADDITIVE — every existing method still reaches the default client", async () => {
  const real = recordingRealRemote();
  const rc = sourceAwareRemote(real);
  await rc.getEmployment("emp_x");
  assert.deepEqual(real.names(), ["getEmployment"]);
});

test("0b. forSource is one-directional — only the portal tag yields the mock, and nothing yields the mock for anything else", () => {
  const real = recordingRealRemote();
  const rc = sourceAwareRemote(real);
  assert.notEqual(rc.forSource(PORTAL_SOURCE), real, "a portal record must not get the real client");
  for (const source of [null, undefined, "", "webhook", "zaf", "remoteui", "PORTAL", "portal ", "seed"]) {
    assert.equal(rc.forSource(source), real, `source ${JSON.stringify(source)} must resolve to the real client`);
  }
});

test("0c. the mock client is built ONCE per request, so a freshness read and the write it guards are the same client", () => {
  const rc = sourceAwareRemote(recordingRealRemote());
  assert.equal(rc.forSource(PORTAL_SOURCE), rc.forSource(PORTAL_SOURCE));
});

test("0d. remoteFor() degrades to the plain client — no signature change for any existing caller", () => {
  const plain = recordingRealRemote();
  assert.equal(remoteFor(plain, PORTAL_SOURCE), plain);
  assert.equal(remoteFor(plain, null), plain);
  // And a resolver that answers with nothing usable never yields undefined.
  const broken = { forSource: () => null };
  assert.equal(remoteFor(broken, PORTAL_SOURCE), broken);
});

test("0e. sourceAwareRemote returns a non-object caller's value untouched — wrapping must never be the thing that throws", () => {
  assert.equal(sourceAwareRemote(null), null);
  assert.equal(sourceAwareRemote(undefined), undefined);
});

// ---------------------------------------------------------------------------
// UC-02 — the use case the live 404 came from
// ---------------------------------------------------------------------------

async function submitPortalExpense(expenseStore, { source = PORTAL_SOURCE } = {}) {
  // Submitted through the MOCK, exactly as buildPortalHandler() does. This is
  // the "decided in the mock world" half of the defect.
  const r = await handleExpenseSubmission(
    {
      expenseId: "exp_sandbox_over_cap_402",
      employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
      session: { authenticatedEmploymentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46" },
      source,
    },
    { remote: mock, audit, expenseStore, classify }
  );
  assert.equal(r.decision, "human_review", "fixture must FLAG, or there is nothing for a human to release");
  return r;
}

test("1. POSITIVE — a portal-originated UC-02 claim IS releasable end to end, reaching the mock and producing a real remoteResult", async () => {
  const expenseStore = new ExpenseStore();
  const submitted = await submitPortalExpense(expenseStore);

  const real = recordingRealRemote();
  const result = await submitExpenseReview(
    { storeId: submitted.storeId, action: "approve", reviewer: "finance_fran" },
    { remote: sourceAwareRemote(real), audit, expenseStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "approved");
  // A REAL result from the mock, not a refusal and not a fabricated shape.
  assert.equal(result.remoteResult.status, "approved");
  // And the mock's own state really moved — the proof the write landed
  // somewhere rather than being swallowed.
  assert.equal(EXPENSES["exp_sandbox_over_cap_402"].status, "approved");
  // The real client was never touched. THIS is the assertion the id-shape
  // heuristic could not make.
  assert.deepEqual(real.names(), [], "a portal record must never reach the real gateway");
});

test("2. CONVERSE — a non-portal UC-02 claim still executes against the REAL client", async () => {
  const expenseStore = new ExpenseStore();
  const submitted = await submitPortalExpense(expenseStore, { source: "webhook" });

  const real = recordingRealRemote();
  const result = await submitExpenseReview(
    { storeId: submitted.storeId, action: "approve", reviewer: "finance_fran" },
    { remote: sourceAwareRemote(real), audit, expenseStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(real.names(), ["getEmployment", "patchExpenseStatus"]);
  assert.equal(result.remoteResult.__from, "real");
  // The mock's fixture was NOT touched — the two worlds stayed separate.
  assert.equal(EXPENSES["exp_sandbox_over_cap_402"].status, "pending");
});

test("3. an UNTAGGED (source: null) UC-02 claim executes against the real client — the documented fallback", async () => {
  const expenseStore = new ExpenseStore();
  const submitted = await submitPortalExpense(expenseStore, { source: null });

  const real = recordingRealRemote();
  const result = await submitExpenseReview(
    { storeId: submitted.storeId, action: "decline", reviewer: "finance_fran", note: "out of policy" },
    { remote: sourceAwareRemote(real), audit, expenseStore }
  );
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(real.names(), ["getEmployment", "patchExpenseStatus"]);
});

// ---------------------------------------------------------------------------
// UC-04 — the sub-record id here belongs to a request the MOCK holds
// ---------------------------------------------------------------------------
// It used to be a `war_*` id the mock MINTED on submit, from a create endpoint
// Remote does not have. It is now the id of a checked-in fixture the resolver
// matched on employment + destination — but the property this file is about is
// unchanged and is the reason the tests still belong here: the id exists only
// inside the mock, so executing the approval against the real gateway would 404.

async function submitPortalWorkation(authorizationStore, { source = PORTAL_SOURCE } = {}) {
  // Only a `pending` request resolves, and an approve settles it — so without a
  // reset the SECOND test in this file finds nothing and fails for a reason
  // that points at the wrong thing entirely.
  resetWorkAuthorizations();
  const r = await handleWorkationRequest(
    {
      employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
      // FILER `admin_omar`, SIGNATORY `admin_jane` (DRIFT-098 `[A-1]`,
      // 2026-08-29). These fixtures used to file and sign slot 1 under one
      // identity; UC-06's requester may now sign neither slot, so that
      // combination is refused `requester_cannot_approve`. The approver
      // strings below are unchanged — slot 1 belongs to the employer's signing
      // representative, not to the admin USER who operates the console.
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" },
      factors: {
        homeCountry: "US",
        nationality: "US",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: VISA_TYPES.schengen_short_stay,
        jobDuties: JOB_DUTY_CATEGORIES.engineering,
        hasContractSigningAuthority: false,
      },
      travelHistory: [],
      now: "2026-08-15",
      source,
    },
    { remote: mock, audit, authorizationStore, draftSummary: fakeUc04Draft, judge: fakeJudge }
  );
  assert.equal(r.decision, "ready_for_approval", r.reason);
  assert.ok(r.workAuthorizationId, "the mock holds a pending work-authorization request that only exists in the mock");
  return r;
}

test("4. POSITIVE — a portal-originated UC-04 authorization IS approvable end to end, reaching the mock", async () => {
  const authorizationStore = new AuthorizationStore();
  const submitted = await submitPortalWorkation(authorizationStore);

  const real = recordingRealRemote();
  const result = await submitWorkationApproval(
    { authorizationId: submitted.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote: sourceAwareRemote(real), audit, authorizationStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "executed");
  assert.equal(result.remoteResult.status, "approved_by_manager");
  // `approved_by` is not a property of `WorkAuthorizationRequest` at all —
  // Remote reads the approver back as `employer_approver`, and both update
  // schemas are `additionalProperties: false` (docs/REMOTE-VOCABULARY.md §5.6).
  // The mock's fixtures are transcribed from Remote's schema, so the field is
  // absent rather than present-and-null.
  assert.equal("approved_by" in result.remoteResult, false);
  assert.deepEqual(real.names(), []);
});

test("5. CONVERSE — a non-portal UC-04 authorization still executes against the REAL client", async () => {
  const authorizationStore = new AuthorizationStore();
  const submitted = await submitPortalWorkation(authorizationStore, { source: "webhook" });

  const real = recordingRealRemote();
  const result = await submitWorkationApproval(
    { authorizationId: submitted.authorizationId, action: "approve", approver: "mobility_sam" },
    { remote: sourceAwareRemote(real), audit, authorizationStore }
  );
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(real.names(), ["getEmployment", "patchWorkAuthorization"]);
  assert.equal(result.remoteResult.__from, "real");
});

// ---------------------------------------------------------------------------
// UC-06 — no portal intake exists for it TODAY (src/portal/server.js has
// adapters for 02/03/04/05/07/08/09 and no uc06). The resolver is wired anyway,
// and pinned here, because the alternative is a use case that silently acquires
// the defect on the day its intake is added. The row is created through the
// real submission path with the source set, which is exactly what a portal
// adapter would do.
// ---------------------------------------------------------------------------

async function submitPortalAmendment(amendmentStore, { source = PORTAL_SOURCE } = {}) {
  const r = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "EUR" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      source,
    },
    { remote: mock, audit, amendmentStore, draftSummary: fakeUc06Draft, judge: fakeJudge }
  );
  assert.equal(r.decision, "dual_approval_required", r.reason);
  return r;
}

test("6. POSITIVE — a portal-originated UC-06 amendment IS executable end to end, reaching the mock", async () => {
  const amendmentStore = new AmendmentStore();
  const submitted = await submitPortalAmendment(amendmentStore);

  const real = recordingRealRemote();
  const deps = { remote: sourceAwareRemote(real), audit, amendmentStore };
  const first = await submitAmendmentApproval(
    { amendmentId: submitted.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    deps
  );
  assert.equal(first.code, "approved_awaiting_second");
  const second = await submitAmendmentApproval(
    { amendmentId: submitted.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    deps
  );

  assert.equal(second.ok, true, second.reason);
  assert.equal(second.code, "executed");
  const row = await amendmentStore.findById(submitted.amendmentId);
  assert.equal(row.remoteResult.contract_amendment.status, "submitted");
  assert.deepEqual(real.names(), []);
});

test("7. CONVERSE — a non-portal UC-06 amendment still executes against the REAL client", async () => {
  const amendmentStore = new AmendmentStore();
  const submitted = await submitPortalAmendment(amendmentStore, { source: "remoteui" });

  // The contract id comes off the record the freshness re-read just returned,
  // so the fake must answer with the id the mock's own fixture carries or the
  // amendment would refuse for an unrelated reason.
  const real = recordingRealRemote({ activeContractId: "ctr_nl_amend_001" });
  const deps = { remote: sourceAwareRemote(real), audit, amendmentStore };
  await submitAmendmentApproval(
    { amendmentId: submitted.amendmentId, role: "customer_admin", action: "approve", approver: "admin_jane" },
    deps
  );
  const second = await submitAmendmentApproval(
    { amendmentId: submitted.amendmentId, role: "payroll_specialist", action: "approve", approver: "payroll_sam" },
    deps
  );
  assert.equal(second.ok, true, second.reason);
  assert.deepEqual(real.names(), ["getEmployment", "createContractAmendment"]);
});

// ---------------------------------------------------------------------------
// UC-09 — the DANGEROUS direction, and the opposite of UC-02's.
// Its write is `POST /v1/recurring-incentives`, a CREATE keyed on an employment
// id — and the portal's personas mirror real Sandbox employment ids. So a
// portal-originated adjustment sent to the real gateway would not 404; it would
// SUCCEED, and move real money in a real account. A refusal is loud; this is
// silent. It is the strongest argument for resolving by origin.
// ---------------------------------------------------------------------------

async function submitPortalAdjustment(adjustmentStore, { source = PORTAL_SOURCE } = {}) {
  const r = await handleAdjustmentRequest(
    {
      employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" },
      adjustmentRequest: { type: "bonus", amount: 500, currency: "USD", amountTaxType: "gross", description: "Spot bonus" },
      now: "2026-08-15",
      source,
    },
    { remote: mock, audit, adjustmentStore, judge: fakeJudge }
  );
  assert.ok(String(r.decision).includes("approval_required"), `expected an approval path, got ${r.decision} / ${r.reason}`);
  return r;
}

test("8. POSITIVE — a portal-originated UC-09 adjustment IS executable end to end, reaching the mock", async () => {
  const adjustmentStore = new AdjustmentStore();
  const submitted = await submitPortalAdjustment(adjustmentStore);

  const real = recordingRealRemote();
  const deps = { remote: sourceAwareRemote(real), audit, adjustmentStore };
  await submitAdjustmentApproval(
    { adjustmentId: submitted.adjustmentId, role: "requester", action: "approve", approver: "req_rita" },
    deps
  );
  const last = await submitAdjustmentApproval(
    { adjustmentId: submitted.adjustmentId, role: "approver", action: "approve", approver: "app_alan" },
    deps
  );

  assert.equal(last.ok, true, last.reason);
  assert.equal(last.code, "executed");
  const row = await adjustmentStore.findById(submitted.adjustmentId);
  assert.ok(row.remoteResult && row.remoteResult.id, "the mock created a real incentive record");
  assert.deepEqual(real.names(), [], "a portal-originated payment must never reach a real account");
});

test("9. CONVERSE — a non-portal UC-09 adjustment still executes against the REAL client", async () => {
  const adjustmentStore = new AdjustmentStore();
  const submitted = await submitPortalAdjustment(adjustmentStore, { source: "zaf" });

  const real = recordingRealRemote();
  const deps = { remote: sourceAwareRemote(real), audit, adjustmentStore };
  await submitAdjustmentApproval(
    { adjustmentId: submitted.adjustmentId, role: "requester", action: "approve", approver: "req_rita" },
    deps
  );
  const last = await submitAdjustmentApproval(
    { adjustmentId: submitted.adjustmentId, role: "approver", action: "approve", approver: "app_alan" },
    deps
  );
  assert.equal(last.ok, true, last.reason);
  assert.deepEqual(real.names(), ["getEmployment", "createIncentive"]);
});
