// ---------------------------------------------------------------------------
// uc09.test.js  —  UC-09 end-to-end tests: adjustment requests → multi-approval → execution
// ---------------------------------------------------------------------------

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest, submitAdjustmentApproval } from "../src/uc09/workflow.js";
import {
  evaluate as evaluatePolicy,
  HIGH_TAX_COMPLEXITY_COUNTRIES,
} from "../src/uc09/policyEngine.js";
import {
  describeAdjustment,
  describeApprovalRequirement,
  describeApprovalProgress,
} from "../src/uc09/approvalView.js";
import { isFullyApproved, evaluateAdjustmentActionability } from "../src/uc09/multiApprovalPolicy.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { parseAdjustmentRequest, whyInvalid, REFUSED_SOURCE } from "../src/uc09/adjustmentParser.js";

// handleAdjustmentRequest() calls judge() unconditionally on every run (not just
// the free-text/LLM-parse path) — without this fake, every test below would
// make a real, slow, doomed OpenAI call before falling back (this devcontainer's
// .env carries a genuine but unreachable OPENAI_API_KEY). Forcing the real
// judgeNarrative() into its own unconfigured branch keeps the exact fallback
// wording instead of hand-duplicating it — the established idiom in this repo.
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });

// Fake dependencies for testing
const fakeRemote = {
  getEmployment: (id) => {
    if (id === "emp_inactive") return { id, status: "terminated", company_id: "co_test", country_code: "US" };
    if (id === "emp_missing") return null; // simulates a real Remote 404
    return { id, status: "active", company_id: "co_test", country_code: "US", compensation_gross_amount: 10000000 };
  },
  // Required fields an incentive PAYLOAD must carry — prepareIncentivePayload()
  // in policyEngine.js always populates these, unlike an employment-record
  // schema's fields (full_name/address), which don't apply to this write.
  getCountrySchema: () => ({ required: ["employment_id", "type", "amount", "currency"] }),
  createIncentive: async (payload) => ({ success: true, incentiveId: "inc_test_123", ...payload })
};

const fakeAudit = {
  log: () => {},
  logDurable: () => {},
  logTraceStep: () => {}
};

// ---------------------------------------------------------------------------
// The LLM seam (finding F-10). The parser no longer has a rule-based fallback
// that pulls a payment amount out of prose, so a free-text test must either
// stand a model up or assert the refusal. `fakeAskJson` is that stand-in: it
// runs the REAL parseAdjustmentRequest(), including its whyInvalid() shape
// check, against a scripted response — never a network call, and never a
// second copy of the parser's own logic.
// ---------------------------------------------------------------------------
const noBackoff = async () => {};

function llmAnswering(response) {
  return (input) =>
    parseAdjustmentRequest(input, {
      isConfigured: () => true,
      askJson: async () => response,
      backoff: noBackoff,
    });
}

/** The real parser with no LLM available — the refusal path. */
const llmUnavailable = (input) => parseAdjustmentRequest(input, { isConfigured: () => false });

/**
 * A stand-in for a COMPETENT model, so the free-text tests below still cover
 * the LLM branch end to end. It reads the amount and type out of the seeded
 * sentence and hands them to the REAL parseAdjustmentRequest() as the model's
 * answer — so the shape validation, the source tagging and the ×100 scaling
 * under test are all the production ones. It lives in the test file on
 * purpose: something like this used to live in src/ as the fallback, and
 * that is precisely the bug F-10 removed.
 */
const fakeParse = (input) => {
  const text = String(input.requestText ?? "");
  const amount = /\$([\d,]+(?:\.\d+)?)/.exec(text);
  const lower = text.toLowerCase();
  return parseAdjustmentRequest(input, {
    isConfigured: () => true,
    backoff: noBackoff,
    askJson: async () => ({
      type: lower.includes("relocation") ? "relocation_allowance" : "bonus",
      amount: amount ? Number(amount[1].replace(/,/g, "")) : null,
      currency: "USD",
      description: text,
      // A COMPETENT MODEL READS gross/net OUT OF THE TEXT AND OTHERWISE SAYS
      // NOTHING. It is not inferred from the payment type or from convention:
      // `amount_tax_type` decides whether Remote pays the integer we send or
      // grosses it up, so a guess here is a guess about how much money leaves
      // the account. A request that does not say lands `null`, and the real
      // gate then refuses it — which is the behaviour the free-text tests
      // below exercise in both directions.
      amountTaxType: lower.includes("net") ? "net" : lower.includes("gross") ? "gross" : null,
      taxAdjustment: lower.includes("manual"),
    }),
  });
};

test("UC-09: Policy engine evaluates standard adjustment", async () => {
  const employment = { id: "emp_test_1", status: "active", company_id: "co_test", country_code: "US" };
  const adjustment = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" }; // 5000 in Remote format

  const result = evaluatePolicy({
    identityVerified: true,
    employment,
    incentiveSchema: { required: [] },
    adjustment,
    now: new Date().toISOString()
  });

  assert.strictEqual(result.decision, "dual_approval_required");
  assert.strictEqual(result.reason, "standard_adjustment_needs_dual_approval");
  assert.strictEqual(result.approvalSlotsRequired, 2);
  assert.ok(Array.isArray(result.flags));
  assert.ok(result.payload);
});

test("UC-09: Policy engine evaluates high-risk adjustment (requires 3 approvals)", async () => {
  const employment = { id: "emp_test_1", status: "active", company_id: "co_test", country_code: "DE" }; // High-risk country
  const adjustment = { type: "bonus", amount: 1500000, currency: "USD", amountTaxType: "gross", taxAdjustment: true }; // 15000 in Remote format, with tax adjustment

  const result = evaluatePolicy({
    identityVerified: true,
    employment,
    incentiveSchema: { required: [] },
    adjustment,
    now: new Date().toISOString()
  });

  assert.strictEqual(result.decision, "triple_approval_required");
  assert.strictEqual(result.reason, "high_risk_adjustment_needs_triple_approval");
  assert.strictEqual(result.approvalSlotsRequired, 3);
  assert.ok(result.flags.includes("high_amount_risk"));
  assert.ok(result.flags.includes("manual_tax_adjustment"));
  assert.ok(result.flags.includes("high_tax_compliance_risk"));
});

test("UC-09: Rejects unverified identity", async () => {
  const employment = { id: "emp_test_1", status: "active", company_id: "co_test", country_code: "US" };
  const adjustment = { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" };

  const result = evaluatePolicy({
    identityVerified: false,  // Unverified
    employment,
    incentiveSchema: { required: [] },
    adjustment,
    now: new Date().toISOString()
  });

  assert.strictEqual(result.decision, "escalate");
  assert.strictEqual(result.reason, "identity_not_verified");
  assert.strictEqual(result.approvalSlotsRequired, 0);
});

test("UC-09: Workflow creates adjustment and assigns correct approval requirements (structured input)", async () => {
  const adjustmentStore = new AdjustmentStore();
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" }, // $5,000.00
    reasonText: "Annual performance bonus",
    externalRef: "ticket_123"
  };

  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote,
    audit: fakeAudit,
    adjustmentStore,
    judge: fakeJudge,
    parseAdjustment: fakeParse
  });

  assert.strictEqual(result.decision, "dual_approval_required");
  assert.strictEqual(result.approvalSlotsRequired, 2);
  assert.ok(result.adjustmentId);
  assert.ok(result.summary.includes("5000.00 USD"));
});

test("UC-09: Workflow creates high-risk adjustment with 3 approval requirement (structured input)", async () => {
  const adjustmentStore = new AdjustmentStore();
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "relocation_allowance", amount: 1_500_000, currency: "USD", amountTaxType: "gross" }, // $15,000.00
    reasonText: "Relocation assistance",
    externalRef: "ticket_124"
  };

  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote,
    audit: fakeAudit,
    adjustmentStore,
    judge: fakeJudge,
    parseAdjustment: fakeParse
  });

  assert.strictEqual(result.decision, "triple_approval_required");
  assert.strictEqual(result.approvalSlotsRequired, 3);
  assert.ok(result.adjustmentId);
  assert.ok(result.summary.includes("15000.00 USD"));
});

test("UC-09: Multi approval store tracks approval slots correctly", async () => {
  const adjustmentStore = new AdjustmentStore();

  // Create an adjustment requiring 2 approvals
  const adjustment = adjustmentStore.createAdjustment({
    employmentId: "emp_test_1",
    requester: "admin_1",
    adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    adjustmentType: "dual_approval_required",
    decision: "dual_approval_required",
    reason: "standard adjustment",
    flags: [],
    approvalSlotsRequired: 2
  });

  assert.strictEqual(adjustmentStore.isFullyApproved(adjustment), false);
  assert.strictEqual(adjustment.requesterApproval, null);
  assert.strictEqual(adjustment.approverApproval, null);
  assert.strictEqual(adjustment.paymentReleaserApproval, null);

  // Record first approval
  await adjustmentStore.recordApproval(adjustment.id, "approver", "approver_1", "Valid request");
  const afterFirst = await adjustmentStore.findById(adjustment.id);
  assert.strictEqual(afterFirst.approverApproval.approver, "approver_1");
  assert.strictEqual(adjustmentStore.isFullyApproved(afterFirst), false);

  // Record second approval
  await adjustmentStore.recordApproval(adjustment.id, "requester", "requester_1", "Requested by department head");
  const afterSecond = await adjustmentStore.findById(adjustment.id);
  assert.strictEqual(afterSecond.requesterApproval.approver, "requester_1");
  assert.strictEqual(adjustmentStore.isFullyApproved(afterSecond), true); // 2 slots filled, requirement was 2
});

test("UC-09: Multi approval store tracks 3 approval requirement correctly", async () => {
  const adjustmentStore = new AdjustmentStore();

  // Create an adjustment requiring 3 approvals
  const adjustment = adjustmentStore.createAdjustment({
    employmentId: "emp_test_1",
    requester: "admin_1",
    adjustment: { type: "bonus", amount: 1500000, currency: "USD", amountTaxType: "gross", taxAdjustment: true },
    adjustmentType: "triple_approval_required",
    decision: "triple_approval_required",
    reason: "high-risk adjustment",
    flags: ["high_amount_risk"],
    approvalSlotsRequired: 3
  });

  assert.strictEqual(adjustmentStore.isFullyApproved(adjustment), false);

  // Record first approval
  await adjustmentStore.recordApproval(adjustment.id, "approver", "approver_1", "Valid request");
  let current = await adjustmentStore.findById(adjustment.id);
  assert.strictEqual(adjustmentStore.isFullyApproved(current), false);

  // Record second approval
  await adjustmentStore.recordApproval(adjustment.id, "requester", "requester_1", "Requested by department head");
  current = await adjustmentStore.findById(adjustment.id);
  assert.strictEqual(adjustmentStore.isFullyApproved(current), false);

  // Record third approval
  await adjustmentStore.recordApproval(adjustment.id, "payment_releaser", "payer_1", "Payment release approved");
  current = await adjustmentStore.findById(adjustment.id);
  assert.strictEqual(adjustmentStore.isFullyApproved(current), true); // 3 slots filled, requirement was 3
});

test("UC-09: Approval workflow with insufficient approvals does not execute", async () => {
  const adjustmentStore = new AdjustmentStore();

  // Create an adjustment requiring 3 approvals
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "relocation_allowance", amount: 1_500_000, currency: "USD", amountTaxType: "gross" },
    reasonText: "Relocation assistance",
  };

  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote,
    audit: fakeAudit,
    adjustmentStore,
    judge: fakeJudge,
    parseAdjustment: fakeParse
  });

  assert.strictEqual(result.approvalSlotsRequired, 3);
  const adjustmentId = result.adjustmentId;

  // First approval
  const firstApproval = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "approve", approver: "approver_1", note: "Valid request" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(firstApproval.code, "approved_awaiting_more");
  assert.ok(firstApproval.reason.includes("waiting for 3 total approvals (1/3)"));

  // Second approval
  const secondApproval = await submitAdjustmentApproval(
    { adjustmentId, role: "requester", action: "approve", approver: "requester_1", note: "Request confirmed" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(secondApproval.code, "approved_awaiting_more");
  assert.ok(secondApproval.reason.includes("waiting for 3 total approvals (2/3)"));

  // Third approval - should execute now
  const thirdApproval = await submitAdjustmentApproval(
    { adjustmentId, role: "payment_releaser", action: "approve", approver: "payer_1", note: "Payment released" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(thirdApproval.code, "executed");
});

test("UC-09: Same person cannot fill multiple approval roles (segregation of duties)", async () => {
  const adjustmentStore = new AdjustmentStore();

  // Create an adjustment requiring 2 approvals
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" },
    reasonText: "Performance bonus",
  };

  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote,
    audit: fakeAudit,
    adjustmentStore,
    judge: fakeJudge,
    parseAdjustment: fakeParse
  });

  assert.strictEqual(result.approvalSlotsRequired, 2);
  const adjustmentId = result.adjustmentId;

  // First approval by user1
  const firstApproval = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "approve", approver: "user_same", note: "Valid request" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(firstApproval.code, "approved_awaiting_more");

  // Attempt to approve again as the same user in different role - should fail
  const secondApproval = await submitAdjustmentApproval(
    { adjustmentId, role: "requester", action: "approve", approver: "user_same", note: "Also requested by same user" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(secondApproval.code, "same_person_cannot_fill_multiple_roles");
  assert.strictEqual(secondApproval.ok, false);
});

// ---------------------------------------------------------------------------
// Segregation-of-duties bypass (found and fixed this pass). Reproduced live
// before the fix: "Bob Smith" then "  bob   SMITH  " on the two required
// roles both went through and the adjustment executed on one human wearing
// two hats. multiApprovalPolicy.js's same-person check now canonicalises
// (trim, collapse whitespace, lowercase) before comparing.
// ---------------------------------------------------------------------------
test("segregation of duties survives case and whitespace variation, not just byte-identical names", async () => {
  const adjustmentStore = new AdjustmentStore();
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" },
    reasonText: "Performance bonus",
  };
  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge,
  });
  const adjustmentId = result.adjustmentId;
  const deps = { remote: fakeRemote, audit: fakeAudit, adjustmentStore };

  const first = await submitAdjustmentApproval(
    { adjustmentId, role: "requester", action: "approve", approver: "Bob Smith" }, deps
  );
  assert.strictEqual(first.code, "approved_awaiting_more");

  const second = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "approve", approver: "  bob   SMITH  " }, deps
  );
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.code, "same_person_cannot_fill_multiple_roles");

  // A genuinely different person can still fill the second slot.
  const third = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "approve", approver: "Amy Chen" }, deps
  );
  assert.strictEqual(third.code, "executed");
});

test("UC-09: Single approval can still deny the request", async () => {
  const adjustmentStore = new AdjustmentStore();

  // Create an adjustment requiring 3 approvals
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    adjustmentRequest: { type: "relocation_allowance", amount: 1_500_000, currency: "USD", amountTaxType: "gross" },
    reasonText: "Relocation assistance",
  };

  const result = await handleAdjustmentRequest(ticket, {
    remote: fakeRemote,
    audit: fakeAudit,
    adjustmentStore,
    judge: fakeJudge,
    parseAdjustment: fakeParse
  });

  assert.strictEqual(result.approvalSlotsRequired, 3);
  const adjustmentId = result.adjustmentId;

  // Deny the adjustment
  const denial = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "deny", approver: "approver_1", note: "Request denied for compliance reasons" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.strictEqual(denial.code, "denied");
  assert.strictEqual(denial.ok, true);

  // Verify adjustment is marked as denied
  const storedAdjustment = await adjustmentStore.findById(adjustmentId);
  assert.strictEqual(storedAdjustment.status, "denied");
  assert.ok(storedAdjustment.deniedBy);
});

test("UC-09: Approval flow enforces minimum 2-person approval floor (never AI-only execution)", async () => {
  // This test verifies that the policy engine respects the fundamental invariant:
  // AI should never execute alone, minimum floor is always >= 2 people
  const employment = { id: "emp_test_1", status: "active", company_id: "co_test", country_code: "US" };

  // Even with a low-risk adjustment, should require minimum 2 approvals
  const lowRiskAdjustment = { type: "bonus", amount: 100000, currency: "USD", amountTaxType: "gross" }; // 1000 in Remote format

  const result = evaluatePolicy({
    identityVerified: true,
    employment,
    incentiveSchema: { required: [] },
    adjustment: lowRiskAdjustment,
    now: new Date().toISOString()
  });

  // Should be at least 2, never 1 (AI-alone) or 0
  assert.ok(result.approvalSlotsRequired >= 2, "Minimum approval floor should be 2, never less");
  assert.strictEqual(result.decision, "dual_approval_required");
});

// ---------------------------------------------------------------------------
// STRUCTURAL CHECK on the approval floor: no code path — not even a hand-
// built row with a missing/null/zero/one `approvalSlotsRequired` — may let
// isFullyApproved() report true on fewer than 2 distinct human approvals.
// This is the function submitAdjustmentApproval() actually gates the real
// remote.createIncentive() write on, so it is the last line of defence, not
// a restatement of policyEngine.js's own Math.max(2, ...).
// ---------------------------------------------------------------------------
test("INVARIANT: isFullyApproved() never reports true on fewer than 2 distinct approvals, whatever approvalSlotsRequired claims", () => {
  const oneApprovalOnly = { requesterApproval: { approver: "a" }, approverApproval: null, paymentReleaserApproval: null };

  // A missing/null/zero/one requirement must fall back to the floor of two,
  // never be trusted as satisfied by a single approval — the exact bug
  // ("filledCount >= null" coerces to "1 >= 0" => true) reproduced live
  // before this fix.
  for (const approvalSlotsRequired of [undefined, null, 0, 1, NaN, "2", {}]) {
    assert.strictEqual(
      isFullyApproved({ ...oneApprovalOnly, approvalSlotsRequired }),
      false,
      `approvalSlotsRequired=${JSON.stringify(approvalSlotsRequired)} must not let one approval satisfy the floor`
    );
  }

  // Two DISTINCT approvals against an explicit 2 does satisfy it.
  assert.strictEqual(
    isFullyApproved({
      requesterApproval: { approver: "a" },
      approverApproval: { approver: "b" },
      paymentReleaserApproval: null,
      approvalSlotsRequired: 2,
    }),
    true
  );

  // Two slots filled by the SAME (canonicalised) human never counts as two
  // distinct approvals, even if both slots are technically non-null.
  assert.strictEqual(
    isFullyApproved({
      requesterApproval: { approver: "Bob Smith" },
      approverApproval: { approver: "bob smith" },
      paymentReleaserApproval: null,
      approvalSlotsRequired: 2,
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// F-09 (CRITICAL) — concurrent approvals must not double-execute
// ---------------------------------------------------------------------------
// The reproduction that produced the finding fired three approvals with
// Promise.all and got three createIncentive calls: $15,000 disbursed against a
// $5,000 adjustment. These tests fire them the same way. They are genuine
// concurrency tests, not sequential calls dressed up as one — every approval
// starts before any of them finishes, which is exactly the interleaving that
// let all three pass the "are we fully approved?" check.
// ---------------------------------------------------------------------------

/** A remote whose createIncentive records every call it receives. */
function countingRemote() {
  const calls = [];
  return {
    calls,
    getEmployment: fakeRemote.getEmployment,
    getCountrySchema: fakeRemote.getCountrySchema,
    createIncentive: async (payload, opts) => {
      calls.push({ payload, idempotencyKey: opts?.idempotencyKey ?? null });
      // A real network call yields the event loop; without this the whole
      // execution would run inside one turn and the race could not be
      // reproduced even when the bug is present.
      await new Promise((resolve) => setImmediate(resolve));
      return { success: true, incentiveId: `inc_${calls.length}` };
    },
  };
}

/** A structured $5,000 adjustment needing exactly two approvals. */
async function seedAdjustment(remote, adjustmentStore) {
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", description: "Performance bonus" },
      reasonText: "Annual performance bonus",
      externalRef: "race-9001",
    },
    { remote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );
  assert.strictEqual(result.approvalSlotsRequired, 2);
  return result.adjustmentId;
}

test("F-09. three approvals fired with Promise.all execute the payment exactly ONCE", async () => {
  const adjustmentStore = new AdjustmentStore();
  const remote = countingRemote();
  const adjustmentId = await seedAdjustment(remote, adjustmentStore);
  const deps = { remote, audit: fakeAudit, adjustmentStore };

  const results = await Promise.all([
    submitAdjustmentApproval({ adjustmentId, role: "requester", action: "approve", approver: "ana", note: "ok" }, deps),
    submitAdjustmentApproval({ adjustmentId, role: "approver", action: "approve", approver: "ben", note: "ok" }, deps),
    submitAdjustmentApproval({ adjustmentId, role: "payment_releaser", action: "approve", approver: "cara", note: "ok" }, deps),
  ]);

  // THE ASSERTION THE FINDING IS ABOUT: one adjustment, one disbursement.
  assert.strictEqual(remote.calls.length, 1, `expected exactly one createIncentive call, got ${remote.calls.length}`);

  // Exactly one caller may report "executed". The others either recorded their
  // approval and stopped short of the threshold, or lost the claim — never a
  // second execution.
  const executed = results.filter((r) => r.code === "executed");
  assert.strictEqual(executed.length, 1);
  for (const r of results) {
    assert.ok(
      ["executed", "approved_awaiting_more", "execution_already_claimed"].includes(r.code),
      `unexpected outcome ${r.code}`
    );
  }

  // All three approvals were still RECORDED — the fix serialises execution,
  // it does not silently drop a human's signature.
  const row = await adjustmentStore.findById(adjustmentId);
  assert.strictEqual(row.status, "executed");
  assert.ok(row.requesterApproval && row.approverApproval && row.paymentReleaserApproval);
});

test("F-09. the claim is a compare-and-set: only the first caller wins it", async () => {
  const adjustmentStore = new AdjustmentStore();
  const remote = countingRemote();
  const adjustmentId = await seedAdjustment(remote, adjustmentStore);

  const claims = await Promise.all([
    adjustmentStore.claimForExecution(adjustmentId),
    adjustmentStore.claimForExecution(adjustmentId),
    adjustmentStore.claimForExecution(adjustmentId),
  ]);
  assert.strictEqual(claims.filter(Boolean).length, 1);
  assert.strictEqual((await adjustmentStore.findById(adjustmentId)).status, "executing");

  // Releasing puts it back — and only then can it be claimed again.
  await adjustmentStore.releaseExecutionClaim(adjustmentId);
  assert.strictEqual((await adjustmentStore.findById(adjustmentId)).status, "pending_approval");
  assert.ok(await adjustmentStore.claimForExecution(adjustmentId));
});

test("F-09. a failed freshness re-check releases the claim instead of wedging the row", async () => {
  const adjustmentStore = new AdjustmentStore();
  const remote = countingRemote();
  const adjustmentId = await seedAdjustment(remote, adjustmentStore);

  // The employee is terminated between approval and execution.
  remote.getEmployment = async () => ({ id: "emp_test_1", status: "terminated", company_id: "co_test" });

  const deps = { remote, audit: fakeAudit, adjustmentStore };
  await submitAdjustmentApproval({ adjustmentId, role: "requester", action: "approve", approver: "ana", note: "ok" }, deps);
  const second = await submitAdjustmentApproval(
    { adjustmentId, role: "approver", action: "approve", approver: "ben", note: "ok" },
    deps
  );

  assert.strictEqual(second.code, "employment_no_longer_active");
  assert.strictEqual(remote.calls.length, 0);
  assert.strictEqual((await adjustmentStore.findById(adjustmentId)).status, "pending_approval");
});

// ---------------------------------------------------------------------------
// The identity gate must never let two absent company ids look like a match.
// Reproduced live before the fix: session.companyId=null and
// employment.company_id=null both being falsy made `null === null` true, so
// an unverifiable request reached dual_approval_required instead of
// escalating identity_not_verified.
// ---------------------------------------------------------------------------
test("identity gate: two absent company ids are not a match (null === null is not verified)", async () => {
  const adjustmentStore = new AdjustmentStore();
  const remote = {
    getEmployment: async (id) => ({ id, status: "active", company_id: null, country_code: "US" }),
    createIncentive: async () => ({ success: true }),
  };
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_no_company",
      session: { companyId: null, authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" },
      reasonText: "test",
    },
    { remote, audit: fakeAudit, adjustmentStore, judge: fakeJudge }
  );
  assert.strictEqual(result.decision, "escalate");
  assert.strictEqual(result.reason, "identity_not_verified");
  assert.strictEqual(result.approvalSlotsRequired, 0);
});

// ---------------------------------------------------------------------------
// A crash regression: an unresolvable employment id used to throw an
// unhandled TypeError ("Cannot read properties of null (reading 'id')") deep
// inside the payload-building fallback, with NO audit row written — the
// request vanished with no record it had ever arrived, on the one use case
// that moves real money.
// ---------------------------------------------------------------------------
test("an unresolvable employment id escalates instead of crashing, and is audited", async () => {
  const adjustmentStore = new AdjustmentStore();
  const auditCalls = [];
  const auditingFake = {
    log: (entry) => auditCalls.push(entry),
    logDurable: (entry) => auditCalls.push(entry),
    logTraceStep: () => {},
  };

  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_missing", // fakeRemote.getEmployment() returns null
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" },
      reasonText: "test",
    },
    { remote: fakeRemote, audit: auditingFake, adjustmentStore, judge: fakeJudge }
  );

  assert.strictEqual(result.decision, "escalate");
  // The upstream-attribution work (shared/upstreamFailure.js) names a missing
  // record MORE specifically than the identity gate that also fails on it:
  // a null employment is "an answer about the record", not an identity claim.
  assert.strictEqual(result.reason, "upstream_record_not_found");
  assert.strictEqual(result.approvalSlotsRequired, 0);
  assert.ok(auditCalls.length >= 1, "the refusal must be audited, not silently vanish");
});

// ---------------------------------------------------------------------------
// F-10 class — a payment amount is never guessed out of prose
// ---------------------------------------------------------------------------

test("F-10. with no LLM available the parser REFUSES rather than regex-guessing an amount", async () => {
  const refusal = await llmUnavailable({ requestText: "Q3 2024 relocation top-up of $12,500.00" });

  // The exact input from the finding: the old regex took the "3" out of "Q3"
  // and $3.00 was posted for a $12,500.00 adjustment.
  assert.strictEqual(refusal.amount, null);
  assert.strictEqual(refusal.source, REFUSED_SOURCE);
  assert.strictEqual(refusal.refusal, "llm_not_configured");
  assert.notStrictEqual(refusal.amount, 3);
});

test("F-10. a refused parse escalates with its own reason and never reaches an approval slot", async () => {
  const adjustmentStore = new AdjustmentStore();
  const remote = countingRemote();

  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Q3 2024 relocation top-up of $12,500.00",
      externalRef: "refuse-9001",
    },
    { remote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );

  assert.strictEqual(result.decision, "escalate");
  assert.strictEqual(result.reason, "amount_not_extracted");
  assert.ok(result.flags.includes("parser_llm_not_configured"));
  assert.strictEqual(result.approvalSlotsRequired, 0);
  assert.strictEqual(remote.calls.length, 0);
});

test("F-10. the workflow wires a seam that actually exists — the LLM path really runs", async () => {
  const adjustmentStore = new AdjustmentStore();
  const seen = [];
  const parse = (input) =>
    parseAdjustmentRequest(input, {
      isConfigured: () => true,
      backoff: async () => {},
      askJson: async (system, user) => {
        // Positional args, the signature shared/llm.js exports. The old code
        // called askJson({system, user}) against a seam that did not exist.
        seen.push({ system, user });
        // `amountTaxType` is part of a COMPLETE model answer — Remote requires
        // `amount_tax_type` and never defaults it, so a scripted response
        // without one escalates and this test would be asserting the seam runs
        // while actually watching it refuse.
        return {
          type: "relocation_allowance",
          amount: 12_500,
          currency: "usd",
          amountTaxType: "gross",
          description: "relocation top-up",
        };
      },
    });

  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Q3 2024 relocation top-up of $12,500.00",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: parse }
  );

  assert.strictEqual(seen.length, 1);
  assert.ok(typeof seen[0].system === "string" && seen[0].system.includes("payroll adjustment parser"));
  assert.ok(seen[0].user.includes("$12,500.00"));
  // 12,500 human-scale -> 1,250,000 in Remote's ×100 integer form.
  const row = adjustmentStore.list()[0];
  assert.strictEqual(row.adjustment.amount, 1_250_000);
  assert.strictEqual(row.adjustment.source, "llm");
  assert.strictEqual(row.adjustment.currency, "USD");
  assert.notStrictEqual(result.decision, "escalate");
});

test("F-10. an LLM answer that does not validate is refused, never partially trusted", async () => {
  assert.strictEqual(whyInvalid({ amount: 12500, currency: "USD", type: "bonus" }), null);
  assert.strictEqual(whyInvalid(null), "not_an_object");
  assert.strictEqual(whyInvalid({ amount: "12500", currency: "USD", type: "bonus" }), "amount_not_a_number");
  assert.strictEqual(whyInvalid({ amount: 0, currency: "USD", type: "bonus" }), "amount_not_positive");
  assert.strictEqual(whyInvalid({ amount: 12500, type: "bonus" }), "currency_missing_or_malformed");
  assert.strictEqual(whyInvalid({ amount: 12500, currency: "USD" }), "type_missing");

  // …and end to end: three bad answers in a row exhaust the retries and refuse.
  const refused = await llmAnswering({ amount: null, currency: "USD", type: "bonus" })({
    requestText: "pay them the usual amount",
  });
  assert.strictEqual(refused.source, REFUSED_SOURCE);
  assert.strictEqual(refused.refusal, "llm_parse_failed");
  assert.strictEqual(refused.amount, null);
});

// ---------------------------------------------------------------------------
// Money ×100 round-trip, hand-verified: $5,000.00 in, 500000 out to Remote,
// $5,000.00 back out in the human-readable summary. Also proves a free-text
// figure ($15,000.00 via a working LLM stand-in) round-trips identically to
// a structured one — the same scaling rule on both entry paths.
// ---------------------------------------------------------------------------
test("MONEY: $5,000.00 structured in -> 500000 (×100) written to the adjustment payload -> $5000.00 back out in the summary", async () => {
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" }, // caller already ×100
      reasonText: "test",
      externalRef: "money-9001",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge }
  );
  const row = adjustmentStore.list()[0];
  assert.strictEqual(row.adjustment.amount, 500_000, "structured input is trusted as already ×100, never re-scaled");
  assert.strictEqual(row.payload.amount, 500_000, "the drafted Remote payload carries the same ×100 integer");
  // No currency SIGN — the sign was hard-coded to "$" beside whatever code the
  // request carried, which read "$5000.00 EUR" on a euro adjustment. The code
  // is the only currency statement the summary is entitled to make.
  assert.ok(result.summary.includes("5000.00 USD"), `summary should read back 5000.00 USD, got: ${result.summary}`);
  // Scoped to the DRAFTED sentence, not the whole summary: the summary now
  // also echoes the original request verbatim (see the next test), and a
  // person is free to type a "$" of their own — that is not the hard-coded
  // sign this assertion exists to catch.
  assert.ok(
    !result.summary.split("Requested:")[0].includes("$"),
    `summary's drafted sentence must carry no hard-coded currency sign, got: ${result.summary}`
  );
});

test("MONEY: $15,000.00 free text -> 1500000 (×100) via the LLM path, same scaling as structured input", async () => {
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a $15,000 relocation top-up, gross",
      reasonText: "Relocation assistance",
      externalRef: "money-9002",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );
  const row = adjustmentStore.list()[0];
  assert.strictEqual(row.adjustment.amount, 1_500_000, "human $15,000.00 must scale to Remote's 1,500,000 (×100), never 150,000 or 15,000,000");
  assert.strictEqual(row.payload.amount, 1_500_000);
  assert.ok(result.summary.includes("15000.00 USD"), `summary should read back 15000.00 USD, got: ${result.summary}`);
  // Scoped to the DRAFTED sentence, not the whole summary: this request's own
  // text contains "$15,000", now echoed verbatim after "Requested:" per the
  // requirement that the amount-usable path also carries what was asked. That
  // echoed "$" is the requester's own typing, not a hard-coded sign this
  // system added.
  assert.ok(
    !result.summary.split("Requested:")[0].includes("$"),
    `summary's drafted sentence must carry no hard-coded currency sign, got: ${result.summary}`
  );
});

// ---------------------------------------------------------------------------
// F-33 — what the amount guard did to everything downstream of it
// ---------------------------------------------------------------------------
// Every test below was written after reproducing the behaviour through the real
// portal (POST /api/requests/uc09), not from reading the file. The guard
// returned early, and that single `return` reached further than it looked: past
// the reason of the gate that had actually refused, past claimExternalRef(),
// and past createAdjustment(). Three of the four failures it caused were
// invisible to the suite because nothing asserted that a REFUSAL still produces
// a record.
// ---------------------------------------------------------------------------

/** A remote whose employment read 404s, driving gate 0's upstream verdict. */
const upstreamFailingRemote = { ...fakeRemote, getEmployment: () => null };

test("F-33. an upstream 404 with an unparseable amount refuses instead of throwing, and is audited", async () => {
  // THE CRASH: the guard exempted itself whenever gate 0 had already reported an
  // upstream failure, then fell through to fromRemoteInteger() with the very
  // non-integer it had declined to guard. Live, through the portal, this was an
  // HTTP 500 — no audit row, no record, no ticket, request gone. On the one use
  // case that moves money, a mistyped employment id was enough to trigger it.
  const adjustmentStore = new AdjustmentStore();
  const logged = [];
  const audit = { ...fakeAudit, log: (e) => logged.push(e) };

  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_missing",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "pay him the usual",
      externalRef: "f33-upstream-1",
    },
    { remote: upstreamFailingRemote, audit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );

  assert.equal(result.decision, "escalate");
  assert.equal(logged.length, 1, "a refused request must still leave exactly one audit row");
  assert.equal(adjustmentStore.list().length, 1, "a refused request must still leave a record a human can open");
});

test("F-33. ORDERED GATES: an earlier gate's reason survives the amount refusal, and both are flagged", async () => {
  // The guard used to overwrite EVERY earlier verdict. An archived employee's
  // request came back `amount_not_extracted` when the status gate had already
  // refused it — so with no LLM reachable (which is every free-text request when
  // OPENAI_API_KEY is absent, since UC-09 has no rule-based extraction on
  // purpose) the identity and status gates became unobservable. A gate that
  // cannot be observed refusing is indistinguishable from one that never runs.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_inactive",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a final bonus",
      externalRef: "f33-order-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );

  assert.equal(result.reason, "employment_not_active", "the EARLIER gate names the refusal");
  assert.ok(result.flags.includes("inactive_employment"), "the earlier gate's own flag survives");
  assert.ok(result.flags.includes("amount_not_extracted"), "the amount problem is still recorded, not hidden");
  assert.ok(
    result.flags.includes("parser_llm_not_configured"),
    "and it says WHY the parser produced no figure — a refusal to guess is a working control, not a sender bug"
  );
});

test("F-33. when the amount IS the first thing wrong, it names the refusal", async () => {
  // The other half of the ordered-gates rule: with identity and status both
  // clean, the policy engine's generic `invalid_adjustment_structure` is less
  // useful than the parser's specific account, so the specific one wins. Without
  // this the fix above would simply have buried the parser refusal instead of
  // the status gate.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "pay him the usual",
      externalRef: "f33-order-2",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );
  assert.equal(result.reason, "amount_not_extracted");
  assert.equal(result.decision, "escalate");
});

test("F-33. a refused request produces a record, and the record carries the original request text", async () => {
  // "And then what?" The parser's documented remedy for a refusal is that a
  // human reads the request and supplies the figure as structured input. Before
  // this, the request text appeared on no record and on no escalation ticket:
  // Payroll Ops received an urgent ticket naming an adjustment record that did
  // not exist, for a request whose content was nowhere on it.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Please pay Chris the amount we agreed on the call",
      reasonText: "Retention",
      externalRef: "f33-record-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );

  assert.ok(result.adjustmentId, "a refusal must still return a record id for the ticket to point at");
  const row = adjustmentStore.list()[0];
  assert.ok(
    row.summary.includes("Please pay Chris the amount we agreed on the call"),
    `the record must carry the request a human has to read, got: ${row.summary}`
  );
  assert.equal(row.payload, null, "no trustworthy amount means no drafted Remote payload");
});

test("F-33. a record with no amount can never be approved, by anyone, from anywhere", async () => {
  // The record added above must not become a way to sign off a payment with no
  // figure. It is `escalated`, and evaluateAdjustmentActionability() refuses
  // anything whose decision is not an approval — checked here rather than
  // assumed, because "we created a row" and "we created an inert row" are
  // different claims and only one of them is safe.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "pay him the usual",
      externalRef: "f33-inert-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable }
  );

  const row = adjustmentStore.list()[0];
  assert.equal(row.status, "escalated");
  assert.equal(result.approvalSlotsRequired, 0);
  assert.equal(result.approvalPathOpen, false);

  const verdict = evaluateAdjustmentActionability({ adjustmentRow: row });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "not_awaiting_approval");

  const attempt = await submitAdjustmentApproval(
    { adjustmentId: result.adjustmentId, role: "approver", action: "approve", approver: "ana" },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore }
  );
  assert.equal(attempt.ok, false, "an amount-less record must refuse an approval attempt over the real entry point");
  assert.equal(attempt.code, "not_awaiting_approval");
});

test("F-33. a redelivered refusal is claimed once — two deliveries, one record", async () => {
  // The early `return` jumped over claimExternalRef() as well, so the ONE use
  // case that moves money had no exactly-once protection on precisely the path a
  // broken integration retries most. Reproduced before the fix: two deliveries
  // under one externalRef produced two audit rows and, through the portal, two
  // urgent Payroll Ops tickets.
  //
  // The real guarantee is the `workflow_claims` PRIMARY KEY, so this stands a
  // pool in that answers the way the key does; with no pool at all
  // claimExternalRef() proceeds rather than inventing the guarantee in memory.
  const seenKeys = [];
  const adjustmentStore = new AdjustmentStore();
  // ON CONFLICT DO NOTHING: rowCount 1 for the winner, 0 for a redelivery —
  // exactly what the real (use_case, external_ref) PRIMARY KEY produces.
  adjustmentStore.pgPool = {
    query: async (_sql, params) => {
      const key = JSON.stringify((params ?? []).slice(0, 2));
      if (seenKeys.includes(key)) return { rows: [], rowCount: 0 };
      seenKeys.push(key);
      return { rows: [], rowCount: 1 };
    },
  };

  const deps = { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: llmUnavailable };
  const ticket = {
    employmentId: "emp_test_1",
    session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
    requestText: "pay him the usual",
    externalRef: "f33-dup-1",
  };

  const first = await handleAdjustmentRequest({ ...ticket }, deps);
  const second = await handleAdjustmentRequest({ ...ticket }, deps);

  assert.ok(first.adjustmentId, "the first delivery is processed");
  assert.equal(second.duplicate, true, "the redelivery is refused as an already-processed delivery");
  assert.equal(second.adjustmentId, undefined, "and writes no second record");
});

// ---------------------------------------------------------------------------
// F-34 — the column named after the thing it did not contain
// ---------------------------------------------------------------------------

test("F-34. adjustment_type holds the ADJUSTMENT's type, not the decision", async () => {
  // `adjustmentType: result.decision` meant every row in uc09_adjustments said
  // its type was "dual_approval_required" — the decision, stored a second time,
  // in a column named after something else — while the real type sat in the
  // parsed request and was discarded. Meanwhile the value returned to callers
  // read `result.adjustmentType`, which the policy engine never sets, so the
  // portal and the escalation ticket printed "Adjustment type: not classified"
  // directly beneath a summary that names the type in plain English.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a $5,000 performance bonus, gross",
      externalRef: "f34-type-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );

  assert.equal(result.adjustmentType, "bonus");
  const row = adjustmentStore.list()[0];
  assert.equal(row.adjustmentType, "bonus");
  assert.equal(row.decision, "dual_approval_required");
  assert.notEqual(row.adjustmentType, row.decision, "the type column must never be a second copy of the decision");
});

// ---------------------------------------------------------------------------
// F-35 — the drift alarm that fired on every correct payment
// ---------------------------------------------------------------------------

test("F-35. the faithfulness judge is given the amount in the units the prose uses", async () => {
  // The summary states major units; `parsedAdjustment.amount` is Remote's ×100
  // integer by the time it reaches the judge. Handing over the raw record meant
  // the judge compared "5000.00" against 500000 and returned `not_faithful` on
  // every correct adjustment — a verdict printed on the portal panel and on the
  // Payroll Ops ticket, so the only drift alarm on the money path cried wolf
  // 100% of the time. An alarm that always fires is an alarm nobody reads.
  const adjustmentStore = new AdjustmentStore();
  let seen = null;
  const spyJudge = async (args) => {
    seen = args;
    return { verdict: "faithful", reason: "no drift" };
  };

  await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a $5,000 performance bonus, gross",
      externalRef: "f35-judge-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: spyJudge, parseAdjustment: fakeParse }
  );

  assert.equal(seen.structuredInputs.amount, 5000, "the judge sees major units, matching the prose");
  assert.ok(seen.narrative.includes("5000.00"), "and the prose it is judging states the same figure");
  assert.equal(seen.structuredInputs.currency, "USD");
  // The record itself is unchanged: ×100 is still what reaches Remote.
  assert.equal(adjustmentStore.list()[0].payload.amount, 500_000);
});

test("F-35. the summary states the currency ONCE, by its code, with no hard-coded sign", async () => {
  // `$${amount} ${currency}` rendered a euro adjustment as "$5000.00 EUR" — a
  // dollar sign beside a euro code, in the sentence that goes on the approver's
  // ticket. Caught by the faithfulness judge on live input the moment it stopped
  // being drowned in false alarms about scaling.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "EUR", amountTaxType: "gross", description: "Goodwill" },
      externalRef: "f35-eur-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge }
  );
  assert.ok(result.summary.includes("5000.00 EUR"), `got: ${result.summary}`);
  assert.ok(!result.summary.includes("$"), `a euro adjustment must not carry a dollar sign, got: ${result.summary}`);
});

test("F-35. with no amount the judge is not run at all, and never fabricates a verdict", async () => {
  // Nothing was drafted from figures, so there is no drift to judge. Calling it
  // anyway would spend an LLM round-trip to score a fixed template.
  const adjustmentStore = new AdjustmentStore();
  let called = false;
  const spyJudge = async () => {
    called = true;
    return { verdict: "faithful", reason: "no drift" };
  };
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "pay him the usual",
      externalRef: "f35-judge-2",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: spyJudge, parseAdjustment: llmUnavailable }
  );
  assert.equal(called, false);
  assert.equal(result.faithfulness.verdict, "not_evaluated");
});

// ---------------------------------------------------------------------------
// F-36 — the four-eyes floor, and the deliberate absences that protect it
// ---------------------------------------------------------------------------

test("F-36. INVARIANT: a 3-approval adjustment needs THREE distinct humans, not two", () => {
  // The distinctness check read `distinctHumans >= Math.min(required, 2)`, so a
  // high-risk adjustment scored as needing a third pair of eyes executed on two.
  // The approve path cannot produce that shape on its own — but this function's
  // own `filledCount >= null` comment exists because rows also arrive from
  // migrations and hand-inserts, and it is the last thing between those and a
  // real disbursement. It must not relax a requirement it was handed.
  const threeSlotsTwoHumans = {
    requesterApproval: { approver: "Ana Diaz" },
    approverApproval: { approver: "Bob Smith" },
    paymentReleaserApproval: { approver: "ana  diaz" }, // the same human as slot 1
    approvalSlotsRequired: 3,
  };
  assert.equal(isFullyApproved(threeSlotsTwoHumans), false);

  const threeSlotsThreeHumans = {
    requesterApproval: { approver: "Ana Diaz" },
    approverApproval: { approver: "Bob Smith" },
    paymentReleaserApproval: { approver: "Cara Ng" },
    approvalSlotsRequired: 3,
  };
  assert.equal(
    isFullyApproved(threeSlotsThreeHumans),
    true,
    "three genuinely distinct humans DO satisfy a 3-slot requirement — the floor must not become unsatisfiable"
  );
});

test("F-36. POSITIVE: a well-formed request really can reach each approval decision", async () => {
  // A gate that structurally cannot succeed is indistinguishable from one being
  // appropriately cautious, and no amount of negative testing tells them apart.
  // This is the test that would have failed while every refusal test passed.
  const cases = [
    // Each request states gross or net, because Remote requires
    // `amount_tax_type` and nothing in this system will invent one. A "well
    // formed request" is one a real requester could actually have made.
    { text: "Process a $5,000 performance bonus, gross", decision: "dual_approval_required", slots: 2 },
    { text: "Process a $15,000 relocation top-up, gross", decision: "triple_approval_required", slots: 3 },
  ];
  for (const c of cases) {
    const adjustmentStore = new AdjustmentStore();
    const result = await handleAdjustmentRequest(
      {
        employmentId: "emp_test_1",
        session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
        requestText: c.text,
        externalRef: `f36-positive-${c.slots}`,
      },
      { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
    );
    assert.equal(result.decision, c.decision, `"${c.text}" must reach ${c.decision}, got ${result.decision}/${result.reason}`);
    assert.equal(result.approvalSlotsRequired, c.slots);
    assert.equal(result.approvalPathOpen, true);
    assert.equal(result.amountEstablished, true);
    assert.equal(adjustmentStore.list()[0].status, "pending_approval", "and the record is genuinely open for signature");
  }
});

test("F-36. the IN-DOUBT transaction is NOT released: a failed createIncentive leaves the row executing", async () => {
  // A DELIBERATE ABSENCE, pinned so a later cleanup cannot quietly remove it.
  // There is no try/catch around createIncentive() that releases the execution
  // claim, because a throw means we do not know whether the disbursement
  // happened — the classic in-doubt transaction. Releasing would hand the retry
  // button back to exactly the situation where pressing it might pay twice, so
  // the row stays `executing` and a human reconciles it. Nothing tested this.
  const adjustmentStore = new AdjustmentStore();
  const attempts = [];
  const remote = {
    ...fakeRemote,
    createIncentive: async (_payload, opts) => {
      attempts.push(opts?.idempotencyKey ?? null);
      throw new Error("socket hang up"); // we cannot know whether it landed
    },
  };
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a $5,000 performance bonus, gross",
      externalRef: "f36-indoubt-1",
    },
    { remote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );
  const adjustmentId = result.adjustmentId;
  const deps = { remote, audit: fakeAudit, adjustmentStore };

  await submitAdjustmentApproval({ adjustmentId, role: "requester", action: "approve", approver: "ana" }, deps);
  await assert.rejects(
    () => submitAdjustmentApproval({ adjustmentId, role: "approver", action: "approve", approver: "bob" }, deps),
    /socket hang up/,
    "the failure must surface, not be swallowed"
  );

  const row = await adjustmentStore.findById(adjustmentId);
  assert.equal(row.status, "executing", "the row stays claimed for human reconciliation — NEVER released back to retryable");
  assert.equal(row.executedAt, null, "and is not marked executed, because we do not know that it was");

  // And a further approval cannot re-fire the write while it sits in doubt.
  const retry = await submitAdjustmentApproval(
    { adjustmentId, role: "payment_releaser", action: "approve", approver: "cara" },
    deps
  );
  assert.equal(retry.ok, false);
  assert.equal(retry.code, "execution_in_progress");
  assert.equal(attempts.length, 1, "exactly one attempt at the money write, even in doubt");
});

test("F-36. the money write carries the adjustment id as its idempotency key, stably", async () => {
  // F-18. Stable across this call's internal retries AND across a manual
  // re-submission after a crash, so the one money-moving POST in this repo can
  // never be delivered twice.
  const adjustmentStore = new AdjustmentStore();
  const seen = [];
  const remote = {
    ...fakeRemote,
    createIncentive: async (_payload, opts) => {
      seen.push(opts?.idempotencyKey ?? null);
      return { success: true, incentiveId: "inc_1" };
    },
  };
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      requestText: "Process a $5,000 performance bonus, gross",
      externalRef: "f36-idem-1",
    },
    { remote, audit: fakeAudit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );
  const adjustmentId = result.adjustmentId;
  const deps = { remote, audit: fakeAudit, adjustmentStore };
  await submitAdjustmentApproval({ adjustmentId, role: "requester", action: "approve", approver: "ana" }, deps);
  await submitAdjustmentApproval({ adjustmentId, role: "approver", action: "approve", approver: "bob" }, deps);

  assert.deepEqual(seen, [adjustmentId], "the key IS the adjustment id — not a fresh uuid, not the external ref");

  // A re-submission after the fact cannot produce a second, differently-keyed
  // write: the row is already decided.
  const again = await submitAdjustmentApproval(
    { adjustmentId, role: "payment_releaser", action: "approve", approver: "cara" },
    deps
  );
  assert.equal(again.ok, false);
  assert.equal(seen.length, 1);
});

test("F-37. no payload is drafted from an amount that is not a usable integer", async () => {
  // `toRemoteInteger(adjustment.amount || 0)` turned null, undefined and "" into
  // a perfectly well-formed incentive payload for 0.00 on the one code path that
  // POSTs money — the same manufactured zero this repo has already found in
  // three layers at once. And a numeric STRING must never be coerced: silently
  // accepting "500000" is how a 100x scaling error gets in. Driven through the
  // real entry point rather than by reaching into the module.
  for (const amount of [null, undefined, "", "500000", 5000.5, NaN]) {
    const adjustmentStore = new AdjustmentStore();
    const result = await handleAdjustmentRequest(
      {
        employmentId: "emp_test_1",
        session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
        adjustmentRequest: { type: "bonus", amount, currency: "USD", description: "d" },
        externalRef: `f37-${String(amount)}`,
      },
      { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge }
    );
    assert.equal(result.decision, "escalate", `an amount of ${JSON.stringify(amount)} must never open an approval path`);
    assert.equal(result.approvalPathOpen, false);
    const row = adjustmentStore.list()[0];
    assert.equal(row.payload, null, `an amount of ${JSON.stringify(amount)} must yield NO payload, never a zero one`);
  }
});

// ---------------------------------------------------------------------------
// THE APPROVAL VIEW — what each of the three roles is told before it signs
// ---------------------------------------------------------------------------
// Reader/decision, restated because these tests only make sense against it:
// the approver and the payment_releaser are being asked "should this be paid?"
// and "should I release it?" — different questions, both turning on the amount
// (with its gross/net basis), on WHY this many signatures, and on who has
// already signed. Every fact asserted below was already inside the system and
// reported as a flag string or not at all (C-27 / pattern P7).
// ---------------------------------------------------------------------------

test("C-27: the third-signature reason names the amount, the threshold, the overage and the percent", () => {
  // USD, not EUR, and the change is the point rather than a detail. The line is
  // denominated (HIGH_AMOUNT_THRESHOLD_CURRENCY) and a request in any other
  // currency is not compared with it at all, so an overage and a percentage
  // only exist for a request stated in the line's own currency. This test used
  // to print "10,000.00 EUR" as the threshold — a denomination the gate had
  // never checked. The euro case is covered by its own test below.
  const view = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: 1500000, currency: "USD", amountTaxType: "gross" },
    flags: ["high_amount_risk"],
    approvalSlotsRequired: 3,
  });

  const amount = view.dimensions.find((d) => d.code === "high_amount_risk");
  assert.equal(amount.triggered, true);
  // All four figures C-27 named, as data AND in the sentence a human reads.
  assert.equal(amount.amountRemoteInteger, 1500000);
  assert.equal(amount.thresholdRemoteInteger, 1000000);
  assert.equal(amount.overageRemoteInteger, 500000);
  assert.equal(amount.percentOverThreshold, 50);
  assert.equal(amount.thresholdCurrency, "USD");
  assert.match(amount.detail, /15,000\.00 USD/);
  assert.match(amount.detail, /10,000\.00 USD/);
  assert.match(amount.detail, /5,000\.00 USD/);
  assert.match(amount.detail, /50% over/);
});

test("C-27: a request in a currency the line is not stated in reports NOT COMPARED, never an overage", () => {
  // The mirror of the test above, and the reason it had to change. A euro
  // request has no overage against a USD line — computing one would need an
  // exchange rate. The dimension reports that it could not ask the question,
  // and carries no figures pretending it did.
  const view = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: 1500000, currency: "EUR", amountTaxType: "gross" },
    flags: ["high_amount_threshold_not_comparable"],
    approvalSlotsRequired: 3,
  });

  const amount = view.dimensions.find((d) => d.code === "high_amount_threshold_not_comparable");
  assert.ok(amount, "the not-comparable dimension takes the value slot when there is no line to compare with");
  assert.equal(amount.triggered, true, "it really is why the third signature was summoned");
  assert.equal(amount.comparable, false);
  assert.equal(amount.thresholdRemoteInteger, null, "no line was applied, so none may be reported as applied");
  assert.equal(amount.overageRemoteInteger, undefined, "an overage against a line that was never applied is a fiction");
  assert.equal(amount.thresholdCurrency, "USD");
  assert.equal(amount.statedCurrency, "EUR");
  assert.match(amount.detail, /NOT COMPARED/);
  assert.match(amount.detail, /10,000\.00 USD/, "the line is named in ITS currency, never in the request's");
  assert.ok(!/10,000\.00 EUR/.test(amount.detail), "and never in the request's");
});

test("an amount that could not be established is NOT reported as under the threshold", () => {
  // The direction that matters: "we could not compare it" must never render as
  // "it is inside the limit", which is what a bare `triggered: false` would say.
  const view = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: undefined, currency: "USD" },
    flags: [],
    approvalSlotsRequired: 0,
  });
  const amount = view.dimensions.find((d) => d.code === "high_amount_risk");
  assert.equal(amount.triggered, false);
  assert.equal(amount.evaluated, false, "an uncomparable amount is unknown, not below the line");
  assert.match(amount.detail, /Not evaluated/);
});

test("no approval path open is stated as such, never as a lowered floor", () => {
  const view = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    flags: ["unverified_requester"],
    approvalSlotsRequired: 0,
  });
  assert.equal(view.approvalPathOpen, false);
  assert.equal(view.floor, 2, "the floor is a constant of the design, not a function of this row");
  assert.match(view.statement, /never reached/);
});

test("an open adjustment reports who has signed and which roles are still outstanding", () => {
  // Before this, an approver opening a partly-signed row was told, in full,
  // "Awaiting approval." — describeSignatures() only ever ran on SETTLED rows.
  const progress = describeApprovalProgress({
    approvalSlotsRequired: 3,
    requesterApproval: { approver: "Ada Lovelace", at: "2026-08-19T10:00:00Z", note: "requested" },
    approverApproval: null,
    paymentReleaserApproval: null,
  });

  assert.equal(progress.filledCount, 1);
  assert.equal(progress.distinctApproverCount, 1);
  assert.deepEqual(progress.outstandingRoles, ["approver", "payment_releaser"]);
  assert.match(progress.statement, /Ada Lovelace/);
  assert.match(progress.statement, /1 of 3/);

  // Segregation of duties, stated BEFORE it refuses somebody rather than only
  // as a 409 at submit time.
  assert.deepEqual(progress.blockedApprovers, ["Ada Lovelace"]);
  assert.match(progress.blockedApproversReason, /second role/);
});

test("a two-signature adjustment never lists payment_releaser as outstanding", () => {
  // A role that is not required is not a missing signature. Reporting it as one
  // would make every ordinary adjustment look permanently incomplete.
  const progress = describeApprovalProgress({ approvalSlotsRequired: 2 });
  assert.deepEqual(progress.rolesInScope, ["requester", "approver"]);
  assert.ok(!progress.outstandingRoles.includes("payment_releaser"));
});

test("the figure an approver signs states gross vs net, in the data and in the prose", async () => {
  // policyEngine.js: "the same integer pays a different amount under each
  // reading", and it refuses to default the field for that reason — then the
  // one sentence a human signs did not carry it.
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500000, currency: "EUR", amountTaxType: "net" },
      externalRef: "grossnet-1",
    },
    { remote: fakeRemote, audit: fakeAudit, adjustmentStore, judge: fakeJudge }
  );
  assert.match(result.summary, /net/, "the summary must state the gross/net basis of the amount");

  const money = describeAdjustment(adjustmentStore.list()[0]).money;
  assert.equal(money.amountTaxType, "net");
  assert.match(money.statement, /5,000\.00 EUR/);
  assert.match(money.statement, /company pays MORE/);
});

// ---------------------------------------------------------------------------
// THE UNSOURCED HEURISTIC — docs/KNOWLEDGE-SOURCES.md §1 Test B, §12 item 2
// ---------------------------------------------------------------------------
// `HIGH_TAX_COMPLEXITY_HEURISTIC` is three country codes somebody invented,
// deciding how many humans must sign before real money leaves a real account.
// It is not being removed and not being lengthened (a longer invented list is
// the same defect with more rows). What changes is that it can no longer reach
// an approver looking like a compliance determination.
//
// These are POSITIVE tests on purpose: a control that only ever refuses is
// indistinguishable from one that structurally cannot succeed (CLAUDE.md §3.30).
// So the first asserts the third signature IS required AND that the record says
// why — not merely that nothing bad happened.
// ---------------------------------------------------------------------------

test("POSITIVE: a country on the unsourced list reaches three signatures AND the record says why", () => {
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { id: "emp_de", status: "active", company_id: "co_test", country_code: "DE" },
    incentiveSchema: { required: [] },
    adjustment: { type: "bonus", amount: 500000, currency: "EUR", amountTaxType: "gross" },
    now: new Date().toISOString(),
  });

  // The control still works — an amount well under the high-value threshold,
  // no manual tax adjustment, and still three signatures.
  assert.equal(result.approvalSlotsRequired, 3);
  assert.equal(result.reason, "high_risk_adjustment_needs_triple_approval");
  assert.ok(result.flags.includes("high_tax_compliance_risk"));

  // And the record now says on what basis the third was required.
  const basis = result.riskBasis.find((b) => b.dimension === "jurisdiction_tax_complexity");
  assert.equal(basis.triggered, true);
  assert.equal(basis.basis, "unsourced_heuristic", "the basis must be recorded, not left in a source comment");
  assert.equal(basis.authority, null);
  assert.equal(basis.observedCountryCode, "DE");
  assert.match(basis.note, /UNSOURCED/);
  assert.ok(
    basis.requiredForARealVersion.length >= 3,
    "what a real version would need is a recorded requirement, not a comment"
  );
});

test("a country NOT on the list is reported as NOT ASSESSED, never as low-risk", () => {
  // The direction of harm that actually matters: a genuinely complex
  // jurisdiction outside the invented list collects two signatures, silently.
  // `passed` and `not_reached` are different states (docs/GATES.md), and this is
  // that distinction one layer up.
  const result = evaluatePolicy({
    identityVerified: true,
    employment: { id: "emp_ca", status: "active", company_id: "co_test", country_code: "CA" },
    incentiveSchema: { required: [] },
    // USD, so the ONLY dimension in play is the jurisdiction one this test is
    // about. A CAD request would also raise the value dimension (the line is
    // stated only in USD and CAD cannot be compared with it), which would make
    // a two-signature outcome impossible and hide what is being tested.
    adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    now: new Date().toISOString(),
  });
  assert.equal(result.approvalSlotsRequired, 2);

  const basis = result.riskBasis.find((b) => b.dimension === "jurisdiction_tax_complexity");
  assert.equal(basis.triggered, false);
  assert.match(basis.note, /NOT on this list/);

  const dimension = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: 500000, currency: "USD", amountTaxType: "gross" },
    flags: result.flags,
    approvalSlotsRequired: 2,
    riskBasis: result.riskBasis,
  }).dimensions.find((d) => d.code === "high_tax_compliance_risk");

  assert.equal(dimension.assessed, false, "an unsourced list cannot support a finding that a country is low-risk");
  assert.match(dimension.detail, /NOT ASSESSED/);
  assert.match(dimension.detail, /nobody looked/);
  assert.equal(dimension.observedCountryCode, "CA", "the code it saw travels with the verdict");
});

test("an unsourced dimension that fired is called out in the headline the approver reads first", () => {
  const view = describeApprovalRequirement({
    adjustment: { type: "bonus", amount: 500000, currency: "EUR", amountTaxType: "gross" },
    flags: ["high_tax_compliance_risk"],
    approvalSlotsRequired: 3,
  });
  assert.match(view.statement, /UNSOURCED/, "if an invented list is why a third human was summoned, say so first");
});

test("INVARIANT: the unsourced list can raise the signature floor and can never lower it", () => {
  // Math.max(2, …) is the guarantee. Asserted directly against the flags the
  // heuristic raises, so a future edit to the list cannot quietly drop a row
  // below two.
  for (const countryCode of [...HIGH_TAX_COMPLEXITY_COUNTRIES, "CA", "US", null, undefined, "ZZ"]) {
    const result = evaluatePolicy({
      identityVerified: true,
      employment: { id: "emp_x", status: "active", company_id: "co_test", country_code: countryCode },
      incentiveSchema: { required: [] },
      adjustment: { type: "bonus", amount: 100, currency: "USD", amountTaxType: "gross" },
      now: new Date().toISOString(),
    });
    assert.ok(
      result.approvalSlotsRequired >= 2,
      `country ${JSON.stringify(countryCode)} must never produce fewer than two required signatures`
    );
  }
});

test("the audit row carries the risk basis, so a reviewer a year later can see the list was a guess", async () => {
  const rows = [];
  const capturingAudit = { log: (row) => rows.push(row), logDurable: () => {}, logTraceStep: () => {} };
  const adjustmentStore = new AdjustmentStore();
  await handleAdjustmentRequest(
    {
      employmentId: "emp_de_audit",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500000, currency: "EUR", amountTaxType: "gross" },
      externalRef: "riskbasis-audit-1",
    },
    {
      remote: {
        ...fakeRemote,
        getEmployment: () => ({ id: "emp_de_audit", status: "active", company_id: "co_test", country_code: "DE" }),
      },
      audit: capturingAudit,
      adjustmentStore,
      judge: fakeJudge,
    }
  );

  const basis = rows[0].details.riskBasis.find((b) => b.dimension === "jurisdiction_tax_complexity");
  assert.equal(basis.basis, "unsourced_heuristic");
  assert.equal(rows[0].details.approvalSlotsRequired, 3);
});
