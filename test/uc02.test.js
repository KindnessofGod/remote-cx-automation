// ---------------------------------------------------------------------------
// uc02.test.js  —  The 7 UC-02 §12 scenarios + every deterministic gate
// ---------------------------------------------------------------------------
// Same shape as uc06.test.js: run the whole workflow against the mock Remote
// server so the pieces are proven together, not just in isolation. No LLM call
// ever happens here — the classifier is forced into its rule-based branch via
// the injectable `classify` seam (workflow.js), so `npm test` stays hermetic
// regardless of whether OPENAI_API_KEY is set in this environment. That same
// seam is used to prove the classifier's OWN LLM behaviour (retries, fallback,
// source tagging) with a fake askJson, below.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { classifyExpense, classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { evaluate as evaluatePolicy } from "../src/uc02/policyEngine.js";
import { getPolicyCap } from "../src/uc02/policyCaps.js";
import { EXPENSES, EXPENSE_CATEGORIES } from "../src/remote/mockServer.js";

let server;
let remote;

before(async () => {
  // 4028 was this suite's original port but collides with src/uc04/cli.js AND
  // src/uc05/cli.js's SEED_PORT (both literally 4028 — a real, pre-existing
  // duplicate outside this file's scope, flagged for a central fix rather
  // than touched here). 4059 was checked against every `40\d\d` literal in
  // src/ and test/ at the time of this change and found free.
  server = await startMockServer(4059); // test-only port
  remote = new RemoteClient({ baseUrl: "http://localhost:4059" });
});
after(() => server && server.close());

let audit;
let expenseStore;

beforeEach(() => {
  audit = new AuditLogger();
  expenseStore = new ExpenseStore();
});

// The deterministic fallback, injected through workflow.js's `classify` seam
// so no test here ever makes a real, retried LLM call just because the
// environment happens to carry an OPENAI_API_KEY (the exact hazard documented
// in CLAUDE.md §6). Runs the REAL rule-based classifier — never a
// hand-duplicated stub — so production's own fallback is what gets proven.
const fakeClassify = (args) => classifyExpenseRuleBased(args);

const session = { authenticatedEmploymentId: "emp_active_001" };

/**
 * Every gate argument set to its passing value, so a test can vary exactly one
 * thing and know the verdict came from that thing. `expense` defaults to the
 * clean auto-approving fixture; override it to isolate a record-level gate.
 *
 * The cap comes from the REAL getPolicyCap() rather than a literal — a test
 * that hard-codes 50000 would keep passing if the corpus changed underneath it.
 */
// A snapshot taken at MODULE LOAD, before any test runs. `exp_auto_101` is a
// live fixture that the auto-approving tests mutate in place (status ->
// approved, exactly as the real PATCH does), so reading it lazily inside a test
// would hand later tests an already-decided record and every gate below the
// status check would report `blocked` instead of the thing under test.
const CLEAN_EXPENSE = structuredClone(EXPENSES.exp_auto_101);

/**
 * A well-formed expense in the REAL Remote shape, for tests that need to hand a
 * record straight to a fake client rather than go through the mock server.
 *
 * Every one of these used to be written out by hand in the invented shape
 * (`total_amount`, `total_currency`, `lines`, `category_id`, `vat_amount`).
 * That is how the shape bug survived so long: the fixtures AND the hand-rolled
 * test records both agreed with the code, so nothing in the suite ever
 * presented the gates with what Remote actually returns. One factory means the
 * shape is asserted in exactly one place (test 18) and cannot drift per-test.
 */
function realExpense(overrides = {}) {
  return {
    id: "exp_real_1",
    employment_id: "emp_active_001",
    status: "pending",
    title: "Team lunch after the weekly sync",
    amount: 4500,
    currency: { code: "USD", name: "United States Dollar", symbol: "$" },
    converted_amount: 4500,
    converted_currency: { code: "USD", name: "United States Dollar", symbol: "$" },
    tax_amount: 375,
    converted_tax_amount: 375,
    expense_date: "2026-07-02",
    reviewed_at: null,
    reviewer: null,
    category: "meals",
    expense_category: { code: "meals", title: "Meals", slug: "1bc932cd-eab7-431d-826d-15ea748b5b79" },
    receipts: [{ id: "9c1b0f77-aaaa-4bbb-8ccc-0d1e2f3a4b5c", name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }],
    reason: null,
    notes: null,
    invoice_period: null,
    ...overrides,
  };
}

function passingGates(overrides = {}) {
  return {
    identityVerified: true,
    employmentActive: true,
    expense: CLEAN_EXPENSE,
    expenseOwned: true,
    duplicate: null,
    categoryValid: true,
    classification: { categoryId: MEALS_INTERNAL, confidence: 0.9, reason: "test", source: "rule_based_fallback" },
    policyCap: getPolicyCap(MEALS_INTERNAL),
    ...overrides,
  };
}

const MEALS_INTERNAL = "work_meals_and_entertainment.internal_meals_and_entertainment";

function submit(overrides = {}, deps = {}) {
  return handleExpenseSubmission(
    {
      expenseId: "exp_auto_101",
      employmentId: "emp_active_001",
      session,
      ...overrides,
    },
    { remote, audit, expenseStore, classify: fakeClassify, ...deps }
  );
}

// ---------------------------------------------------------------------------
// §12.1  Compliant claim under cap -> auto-approve
// ---------------------------------------------------------------------------

test("1. compliant meals claim under cap -> auto_approve, approved at Remote, audited before the write", async () => {
  const r = await submit(); // exp_auto_101, the fixture dedicated to auto-approving tests
  assert.equal(r.decision, "auto_approve");
  assert.equal(r.reason, "all_gates_passed");
  assert.deepEqual(r.flags, []);
  assert.equal(r.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
  assert.equal(r.categorySource, "rule_based_fallback");
  assert.equal(r.confidence, 0.9);
  assert.equal(r.tier, "low"); // no flags -> the use case's own low tier

  const row = await expenseStore.findById(r.storeId);
  assert.equal(row.status, "auto_approved");
  assert.equal(row.remoteResult.status, "approved"); // the real mock PATCH landed
  assert.ok(row.autoApprovedAt);

  // The durable authorisation row lands BEFORE the write; the post-write row
  // after it (write-ordering tests below pin the order itself).
  const actions = audit.entries.map((e) => e.action);
  assert.deepEqual(actions.slice(0, 3), ["auto_approve", "expense_auto_approved", "expense_approved_write"]);
});

// ---------------------------------------------------------------------------
// §12.2  Over-cap -> HITL (and: confidence never overrides a failed gate)
// ---------------------------------------------------------------------------

test("2. over-policy-cap claim -> human_review, even though classification is confident", async () => {
  // exp_over_cap_201 classifies cleanly (external meals, confidence 0.9) — the cap
  // gate still routes to a human. A confident claim is never a substitute for
  // a deterministic check (prime directive #1).
  const r = await submit({ expenseId: "exp_over_cap_201" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "over_policy_cap");
  assert.deepEqual(r.flags, ["over_policy_cap"]);
  assert.equal(r.tier, "medium"); // any flag pushes low-tier execution up to human handling
});

// ---------------------------------------------------------------------------
// §12.3  Duplicate receipt -> blocked
// ---------------------------------------------------------------------------

test("3. same receipt hash submitted twice -> first auto-approves, second is blocked", async () => {
  const first = await submit({ expenseId: "exp_dup_a_102", receiptHash: "hash-dup-1" });
  assert.equal(first.decision, "auto_approve");

  const second = await submit({ expenseId: "exp_dup_b_103", receiptHash: "hash-dup-1" });
  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "duplicate_submission");
  assert.deepEqual(second.flags, ["duplicate_submission"]);
});

test("3b. no receipt hash -> dedupe STILL runs, on a server-derived fingerprint (F-24)", async () => {
  // Used to read "dedupe does not run". That made the duplicate check opt-in
  // on a field the SUBMITTER controls — an integrity control with an opt-out.
  // A first-time hashless claim still auto-approves...
  const r = await submit({ expenseId: "exp_client_ent_105" });
  assert.equal(r.decision, "auto_approve");
  const row = await expenseStore.findById(r.storeId);
  assert.match(row.derivedReceiptHash, /^derived:[0-9a-f]{32}$/);
  assert.equal(row.receiptHashSource, "derived");
});

test("3c. F-24: the same receipt filed as two expense records, NEITHER carrying a hash -> blocked", async () => {
  // The same receipt (same employee, amount, currency, title, description and
  // line items) filed twice under two different expense ids. With no
  // caller-supplied hash the old code let both through and paid both; the
  // server-derived fingerprint catches the second one.
  // Two DIFFERENT expense records (different ids, and different receipt file
  // ids — a re-upload of the same document gets a new file id) that are
  // otherwise the same real-world claim. That is exactly the material
  // deriveReceiptFingerprint() hashes.
  const sameReceipt = (id) => realExpense({ id, receipts: [{ id: `file-${id}`, name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }] });
  const twinRemote = (id) => ({
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      return sameReceipt(id);
    },
    async getExpenseCategories() {
      return [
        { code: "work_meals_and_entertainment.internal_meals_and_entertainment", title: "Internal meals and entertainment", description: "Meals or gatherings with colleagues for team-building or other work-related purposes.", status: "active", is_selectable: true, parent: { code: "work_meals_and_entertainment" }, scope: "global", slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7", instructions: null, prompt: null },
      ];
    },
    async patchExpenseStatus(expenseId) {
      return { id: expenseId, status: "approved" };
    },
  });

  const first = await submit({ expenseId: "exp_twin_a" }, { remote: twinRemote("exp_twin_a") });
  assert.equal(first.decision, "auto_approve");

  const second = await submit({ expenseId: "exp_twin_b" }, { remote: twinRemote("exp_twin_b") });
  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "duplicate_submission");
});

// ---------------------------------------------------------------------------
// §12.4  Blurry / low-confidence receipt -> review
// ---------------------------------------------------------------------------

test("4. blurry receipt -> human_review, low_confidence", async () => {
  const r = await submit({ expenseId: "exp_low_conf_202" });
  assert.equal(r.confidence, 0.4); // rule-based fallback's honest low-conf tell
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "low_confidence");
});

// ---------------------------------------------------------------------------
// §12.5  Non-English receipt -> review
// ---------------------------------------------------------------------------

test("5. non-English receipt -> human_review, low_confidence", async () => {
  const r = await submit({ expenseId: "exp_non_english_203" });
  assert.equal(r.confidence, 0.5);
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "low_confidence");
});

// ---------------------------------------------------------------------------
// §12.6  "Math mismatch" — WHAT IT BECAME, AND WHY
// ---------------------------------------------------------------------------
// The original gate summed `expense.lines[]` and compared the result to
// `expense.total_amount`. Neither field exists on a real Remote expense: the
// record has NO itemization at all (confirmed against 220 live records and the
// `Expense` schema). The gate could therefore never pass, and every real claim
// stopped at `missing_itemized_breakdown`.
//
// Deleting it was not an option — it was a real integrity control, and a gate
// that cannot fail is worse than no gate. What the line-sum check actually did
// was refuse to auto-approve a stated money figure that nothing independent
// corroborated. The real record still offers exactly that, on the quantities it
// really has, and the tests below pin each replacement AS A FAILING CASE:
//
//   * receipt evidence      — the record's only independent artifact
//   * tax containment       — `tax_amount` is documented as the tax portion OF
//                             `amount`, so it cannot exceed it
//   * conversion identity   — same currency both sides => converted figures
//                             MUST equal the originals (two independently
//                             stored integers that have to reconcile: the
//                             closest structural analogue to the line sum)
// ---------------------------------------------------------------------------

test("6. an expense with NO receipt -> human_review, missing_receipt_evidence (never auto-approved)", async () => {
  const r = await submit({ expenseId: "exp_no_receipt_204" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "missing_receipt_evidence");
  assert.deepEqual(r.flags, ["missing_receipt_evidence"]);
});

test("6b. a receipt row missing its required File fields is not evidence", async () => {
  // `receipts` is non-empty, so a length check alone would pass this. The
  // schema marks id/name/type/inserted_at required; a row without them is a
  // placeholder, not an artifact anyone could re-check.
  const half = { ...CLEAN_EXPENSE, id: "exp_halfreceipt_601", receipts: [{ id: "", name: null, type: "expense" }] };
  const r = evaluatePolicy({ ...passingGates(), expense: half });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "missing_receipt_evidence");
});

test("6c. tax_amount larger than the amount it is a portion OF -> human_review, tax_exceeds_amount", async () => {
  const r = await submit({ expenseId: "exp_tax_exceeds_205" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "tax_exceeds_amount");
});

test("6d. the same containment rule applies to the CONVERTED tax figure", async () => {
  const bad = { ...CLEAN_EXPENSE, id: "exp_convtax_602", converted_tax_amount: 99999 };
  const r = evaluatePolicy({ ...passingGates(), expense: bad });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "tax_exceeds_amount");
});

test("6e. same currency both sides but converted_amount disagrees -> conversion_identity_mismatch", async () => {
  const r = await submit({ expenseId: "exp_conv_mismatch_206" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "conversion_identity_mismatch");
});

test("6f. same currency both sides but converted_TAX disagrees -> conversion_identity_mismatch", async () => {
  const bad = { ...CLEAN_EXPENSE, id: "exp_convtaxid_603", converted_tax_amount: 999 };
  const r = evaluatePolicy({ ...passingGates(), expense: bad });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "conversion_identity_mismatch");
});

test("6g. THE REGRESSION GUARD: a record carrying the old invented fields still fails closed", () => {
  // The pre-fix shape, verbatim. If anyone reintroduces `total_amount`/`lines`
  // handling, this record would start passing — which is precisely the drift
  // that made the whole use case dead while every fail-closed test stayed green.
  const invented = {
    id: "exp_invented_604",
    employment_id: "emp_active_001",
    status: "pending",
    title: "Team lunch",
    total_amount: 4500,
    total_currency: "USD",
    reimbursement_currency: "USD",
    lines: [{ description: "Lunch", amount: 4500 }],
    category_id: "work_meals_and_entertainment.internal_meals_and_entertainment",
    vat_amount: null,
  };
  const r = evaluatePolicy({ ...passingGates(), expense: invented });
  assert.notEqual(r.decision, "auto_approve");
});

// ---------------------------------------------------------------------------
// §12.7  Client-entertainment vs. meal classification
// ---------------------------------------------------------------------------

test("7. a dinner whose purpose is entertaining a client -> Client Entertainment, auto-approves under its cap", async () => {
  const r = await submit({ expenseId: "exp_client_ent_104" });
  assert.equal(r.categoryId, "work_meals_and_entertainment.external_meals_and_entertainment"); // external, not internal — the §6 judgement
  assert.equal(r.decision, "auto_approve");
});

// ---------------------------------------------------------------------------
// The remaining deterministic gates (identity, employment, expense, ownership,
// category, currency, VAT) — the full ordered list from policyEngine.js.
// ---------------------------------------------------------------------------

test("8. no session -> escalate, identity_not_verified (fails closed)", async () => {
  const r = await submit({ session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("8b. session authenticated as a different employee -> escalate, identity_not_verified", async () => {
  const r = await submit({ session: { authenticatedEmploymentId: "emp_active_003" } });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
});

test("9. terminated employee -> escalate, employee_not_active", async () => {
  const r = await submit({
    expenseId: "exp_terminated_210",
    employmentId: "emp_terminated_002",
    session: { authenticatedEmploymentId: "emp_terminated_002" },
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("10. expense id that does not exist -> escalate, expense_not_found", async () => {
  const r = await submit({ expenseId: "exp_nope_999" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "expense_not_found");
});

test("11. an expense belonging to another employee -> escalate, expense_employment_mismatch", async () => {
  // exp_mismatch_209 belongs to emp_active_003; submitted as emp_active_001.
  const r = await submit({ expenseId: "exp_mismatch_209" });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "expense_employment_mismatch");
});

test("12. no category resolvable and none recorded -> human_review, category_unverified", async () => {
  const r = await submit({ expenseId: "exp_no_category_208" });
  assert.equal(r.categoryId, null);
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "category_unverified");
});

test("13. cross-currency claim -> human_review, currency_conversion_unverified", async () => {
  // The real record carries NO conversion rate — confirmed against the Expense
  // schema and all 220 live rows. With only (amount -> converted_amount) any
  // converted figure is consistent with SOME rate, so there is nothing to
  // verify. Flagged, never estimated (UC-02.md §7).
  const r = await submit({ expenseId: "exp_cross_currency_107" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "currency_conversion_unverified");
});

test("13b. a missing currency object is unverified, not 'same currency'", () => {
  // `{}` vs `{}` must not read as "the codes match, no conversion happened".
  const noCur = { ...CLEAN_EXPENSE, id: "exp_nocur_605", currency: null, converted_currency: null };
  const r = evaluatePolicy({ ...passingGates(), expense: noCur });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "currency_conversion_unverified");
});

test("13c. a well-formed claim in a currency the cap corpus is not denominated in -> policy_cap_currency_mismatch", async () => {
  // exp_gbp_215 is a real GBP row: internally consistent, receipted, pending,
  // under 50000 *numerically*. But 10366 GBP pence is not 103.66 of the cap's
  // currency, and comparing them would be a category error that silently
  // mis-enforces policy on every non-USD employee. The live account bills in
  // five currencies, so this is the common case, not an edge case.
  const r = await submit({ expenseId: "exp_gbp_215" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "policy_cap_currency_mismatch");
});

test("13d. the cap gate is only ever reached with the two figures already proven equal", () => {
  // Worth pinning explicitly, because it is what makes the cap gate's choice of
  // figure SAFE rather than arbitrary. By the time the cap runs, gate 11 has
  // established same-currency and gate 10b has established
  // converted_amount === amount — so reading the billing-currency figure cannot
  // silently differ from reading the original. A record where they disagree
  // never gets that far.
  const disagreeing = { ...CLEAN_EXPENSE, id: "exp_capaxis_606", amount: 100, converted_amount: 90000, tax_amount: 0, converted_tax_amount: 0 };
  const r = evaluatePolicy({ ...passingGates(), expense: disagreeing });
  assert.equal(r.reason, "conversion_identity_mismatch", "must stop at reconciliation, never reach the cap");

  // And the cap itself really does bite, in the corpus's currency.
  const overCap = { ...CLEAN_EXPENSE, id: "exp_capaxis_607", amount: 90000, converted_amount: 90000, tax_amount: 0, converted_tax_amount: 0 };
  const over = evaluatePolicy({ ...passingGates(), expense: overCap });
  assert.equal(over.reason, "over_policy_cap");
  assert.ok(getPolicyCap(MEALS_INTERNAL) < 90000);
});

// ---------------------------------------------------------------------------
// VAT (§9 "never auto-assert VAT recovery") — now a STRUCTURAL guarantee
// ---------------------------------------------------------------------------
// The old gate refused any expense whose `vat_amount` was non-zero. That field
// does not exist. The real record has `tax_amount`, which is simply the tax
// portion of the claim — every one of the 220 live rows carries a non-zero one,
// so mapping the old rule onto it would refuse 100% of real claims and leave
// the use case exactly as dead as the `lines` bug did.
//
// The control is preserved by construction instead: the approve write's body is
// a `oneOf` over `{status:"approved"}` and `{status:"declined", reason}`. There
// is no VAT-recovery field on the record OR in the write, so this automation
// structurally CANNOT assert VAT recovery — the same move UC-08 makes by not
// accepting a write-capable client. What remains checkable about tax is its
// arithmetic containment, pinned by tests 6c/6d above.

test("14. the approve write can carry nothing but {status:'approved'} — VAT recovery is unassertable", async () => {
  const bodies = [];
  const spyRemote = {
    getEmployment: (id) => remote.getEmployment(id),
    getExpense: (id) => remote.getExpense(id),
    getExpenseCategories: (o) => remote.getExpenseCategories(o),
    async patchExpenseStatus(id, body) {
      bodies.push(body);
      return { id, status: "approved" };
    },
  };
  const r = await submit({ expenseId: "exp_writebody_216" }, { remote: spyRemote });
  assert.equal(r.decision, "auto_approve");
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], { status: "approved" });
});

test("14b. a real (non-zero) tax portion does NOT block an otherwise clean claim", async () => {
  // The regression this guards: every live expense has tax_amount > 0. A rule
  // that treats "has tax" as "needs review" is indistinguishable from a use
  // case that never approves anything.
  assert.ok(CLEAN_EXPENSE.tax_amount > 0, "fixture must actually carry tax");
  const r = evaluatePolicy(passingGates());
  assert.equal(r.decision, "auto_approve");
});

test("15z. a future expense_date -> human_review (the schema says it must be in the past)", async () => {
  const r = await submit({ expenseId: "exp_future_date_214" });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "expense_date_invalid");
});

// ---------------------------------------------------------------------------
// Write ordering (workflow.js header): durable audit -> Remote PATCH -> store.
// ---------------------------------------------------------------------------

test("15. the durable authorisation row lands BEFORE the Remote write", async () => {
  const fakeRemote = {
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      return realExpense({ id: "exp_local_1" });
    },
    async getExpenseCategories() {
      return [
        { code: "work_meals_and_entertainment.internal_meals_and_entertainment", title: "Internal meals and entertainment", description: "Meals or gatherings with colleagues for team-building or other work-related purposes.", status: "active", is_selectable: true, parent: { code: "work_meals_and_entertainment" }, scope: "global", slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7", instructions: null, prompt: null },
      ];
    },
    // The write refuses to run unless the durable row already exists — this is
    // what pins the ordering: if the workflow PATCHed first, this throws.
    async patchExpenseStatus(id, body) {
      assert.ok(audit.entries.some((e) => e.action === "expense_auto_approved"), "audit row must precede the write");
      return { id, status: "approved" };
    },
  };

  const r = await submit({ receiptHash: "hash-order" }, { remote: fakeRemote });
  assert.equal(r.decision, "auto_approve");
  const row = await expenseStore.findById(r.storeId);
  assert.equal(row.remoteResult.status, "approved");
});

test("15b. a failed Remote write never erases the durable authorisation row", async () => {
  const failingRemote = {
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      return realExpense({ id: "exp_local_2" });
    },
    async getExpenseCategories() {
      return [
        { code: "work_meals_and_entertainment.internal_meals_and_entertainment", title: "Internal meals and entertainment", description: "Meals or gatherings with colleagues for team-building or other work-related purposes.", status: "active", is_selectable: true, parent: { code: "work_meals_and_entertainment" }, scope: "global", slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7", instructions: null, prompt: null },
      ];
    },
    async patchExpenseStatus() {
      throw new Error("Remote API PATCH /v1/expenses/exp_local_2 failed: 500");
    },
  };

  await assert.rejects(
    () => submit({ receiptHash: "hash-order-2" }, { remote: failingRemote }),
    /PATCH \/v1\/expenses\/exp_local_2 failed: 500/
  );

  // "Approval recorded, write unconfirmed" — visible and safely retryable,
  // never "a reimbursement write with no record of who authorised it".
  assert.ok(audit.entries.some((e) => e.action === "expense_auto_approved"));
  assert.ok(!audit.entries.some((e) => e.action === "expense_approved_write"));
  const row = expenseStore.list()[0]; // newest first
  assert.equal(row.remoteResult, null);
  assert.equal(row.autoApprovedAt, null);
});

// ---------------------------------------------------------------------------
// QA findings F-11, F-12, F-23, F-24 — the defects the brute-force simulator
// found on this path. Each block states the defect, then pins the fix.
// ---------------------------------------------------------------------------

/**
 * A remote whose expense record is fully controllable, and whose write COUNTS
 * itself. Counting is the point: several of these findings are "the wrong
 * decision reached the real PATCH", so asserting the decision alone would miss
 * a regression that decided correctly and wrote anyway.
 */
function countingRemote(expenseOverrides = {}) {
  const client = {
    writes: [],
    // Id-aware, so a genuinely different employee can authenticate as
    // themselves and still be refused the expense (see F-24b).
    async getEmployment(employmentId) {
      return { id: employmentId, status: "active", email: `${employmentId}@acme.test` };
    },
    async getExpense(id) {
      return realExpense({ id, ...expenseOverrides });
    },
    async getExpenseCategories() {
      return [
        { code: "work_meals_and_entertainment.internal_meals_and_entertainment", title: "Internal meals and entertainment", description: "Meals or gatherings with colleagues for team-building or other work-related purposes.", status: "active", is_selectable: true, parent: { code: "work_meals_and_entertainment" }, scope: "global", slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7", instructions: null, prompt: null },
        { code: "company_and_office_expenses.personal_occasion_gifts", title: "Personal occasion gifts", description: "Covers gifts for coworkers (e.g. birthday, baby, bereavement, get well soon).", status: "active", is_selectable: true, parent: { code: "company_and_office_expenses" }, scope: "global", slug: "787a79ef-8ce3-482e-807c-6f6ff3562015", instructions: null, prompt: null },
        // Added 2026-08-29 so F-12 has an example of "no cap in the corpus"
        // that CANNOT stop being one. personal_occasion_gifts above used to
        // play that role and gained a $50 cap when the corpus was extended to
        // 26 categories; this one is on MUST_STAY_UNCAPPED in
        // uc02PolicyCapCoverage.test.js, which asserts it stays uncapped.
        { code: "relocation_and_mobility.relocation_and_mobility", title: "Relocation and mobility", description: "Costs of relocating for work, including shipping, temporary housing and mobility support.", status: "active", is_selectable: true, parent: { code: "relocation_and_mobility" }, scope: "global", slug: "0f1e5c2a-6b7d-4e88-9a10-2c3d4e5f6a7b", instructions: null, prompt: null },
      ];
    },
    async patchExpenseStatus(id, body) {
      client.writes.push({ id, body });
      return { id, status: "approved" };
    },
  };
  return client;
}

// --- F-11: an already-decided expense must never be re-approved -------------

for (const status of ["approved", "declined", "paid", "cancelled", "reimbursed"]) {
  test(`F-11. an expense already in status "${status}" -> blocked, expense_not_pending, and NO write`, async () => {
    const remoteWithStatus = countingRemote({ status });
    const r = await submit({ expenseId: `exp_f11_${status}` }, { remote: remoteWithStatus });
    assert.equal(r.decision, "blocked");
    assert.equal(r.reason, "expense_not_pending");
    assert.deepEqual(r.flags, ["expense_not_pending"]);
    assert.equal(remoteWithStatus.writes.length, 0, "a decided expense must never reach the real PATCH");
  });
}

test("F-11b. an expense with no status field at all -> blocked (a whitelist, so unknowns fail closed)", async () => {
  const remoteNoStatus = countingRemote({ status: undefined });
  const r = await submit({ expenseId: "exp_f11_nostatus" }, { remote: remoteNoStatus });
  assert.equal(r.decision, "blocked");
  assert.equal(r.reason, "expense_not_pending");
  assert.equal(remoteNoStatus.writes.length, 0);
});

test("F-11c. the status gate sits with the hard stops, ahead of the duplicate check", async () => {
  // Ordering matters for the reason string an operator reads: the record's own
  // state is a fact about the claim, independent of anything this store has
  // seen before.
  const r = evaluatePolicy({
    identityVerified: true,
    employmentActive: true,
    expense: realExpense({ status: "declined", receipts: [] }),
    expenseOwned: true,
    duplicate: { id: "some-earlier-row" },
    categoryValid: true,
    classification: { categoryId: "work_meals_and_entertainment.internal_meals_and_entertainment", confidence: 0.95, source: "rule_based_fallback" },
    policyCap: 50000,
  });
  assert.equal(r.reason, "expense_not_pending");
});

// --- F-12: an unknown policy cap must fail closed ---------------------------

test("F-12. a valid category with NO cap in the corpus -> human_review, policy_cap_unknown, no write", async () => {
  // relocation_and_mobility is a real, selectable category on the live list
  // that this repo's cap corpus deliberately does not cover — and unlike the
  // fixture this test used until 2026-08-29 (personal_occasion_gifts), it is
  // on the MUST_STAY_UNCAPPED list in uc02PolicyCapCoverage.test.js, so it
  // cannot quietly acquire a cap and turn this test into a different one.
  //
  // THAT IS WHY THE FIXTURE MOVED. The corpus was extended from 8 to 26 of the
  // 32 live categories, personal_occasion_gifts gained a $50 cap, and this
  // test went red on `over_policy_cap` — a real result for its claim of
  // $99.99, and the wrong thing for this test to be measuring. The PROPERTY
  // being pinned never changed: an unknown cap must fail closed. Only the
  // example of "unknown" did, and it is now anchored to a category whose
  // absence from the corpus is itself asserted elsewhere.
  //
  // The old gate read `policyCap != null` as "no cap to enforce" and approved
  // an unbounded amount. The amount below is well within every other gate, so
  // the ONLY thing that can stop it is the missing cap.
  const remoteGifts = countingRemote({
    title: "Relocation and mobility support for my move",
    expense_category: null,
    category: null,
    amount: 9999,
    converted_amount: 9999,
    tax_amount: 0,
    converted_tax_amount: 0,
  });
  const r = await submit({ expenseId: "exp_f12_uncapped" }, { remote: remoteGifts });
  assert.equal(r.categoryId, "relocation_and_mobility.relocation_and_mobility");
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "policy_cap_unknown");
  assert.equal(remoteGifts.writes.length, 0);
});

test("F-12b. getPolicyCap never returns an inherited Object.prototype member", () => {
  // `POLICY_CAPS[categoryId] ?? null` returned a FUNCTION for these keys, and
  // a function is not null — so the gate's `policyCap != null` was true and
  // `statedTotal > policyCap` was false. Every claim in a category called
  // "constructor" approved, whatever the amount.
  for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    assert.equal(getPolicyCap(key), null, `getPolicyCap(${JSON.stringify(key)}) must be null`);
  }
  assert.equal(getPolicyCap(null), null);
  assert.equal(getPolicyCap(""), null);
  assert.equal(getPolicyCap({}), null);
  assert.equal(getPolicyCap("work_meals_and_entertainment.internal_meals_and_entertainment"), 50000); // the real ones still work
});

test("F-12c. a category-shaped prototype key cannot reach auto_approve through the engine", () => {
  const r = evaluatePolicy({
    identityVerified: true,
    employmentActive: true,
    expense: realExpense({ amount: 99999999, converted_amount: 99999999, tax_amount: 0, converted_tax_amount: 0 }),
    expenseOwned: true,
    duplicate: null,
    categoryValid: true,
    classification: { categoryId: "constructor", confidence: 0.99, source: "llm" },
    policyCap: getPolicyCap("constructor"),
  });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "policy_cap_unknown");
});

// --- F-23: amount sanity before any arithmetic or cap comparison ------------

// Each case is ONE field of the real record made insane, everything else left
// well-formed — so the reason string names the field that actually broke.
// `null -> 0` and `true -> 1` survive `Number()`, which is precisely how a
// malformed record used to satisfy an arithmetic check and auto-approve.
const INSANE_AMOUNTS = [
  { label: "amount negative", patch: { amount: -500000, converted_amount: -500000 } },
  { label: "amount zero", patch: { amount: 0, converted_amount: 0 } },
  { label: "amount null", patch: { amount: null, converted_amount: null } },
  { label: "amount boolean true", patch: { amount: true, converted_amount: true } },
  { label: "amount fractional (breaks the minor-unit integer domain)", patch: { amount: 100.5, converted_amount: 100.5 } },
  { label: "amount NaN", patch: { amount: Number.NaN, converted_amount: Number.NaN } },
  { label: "amount Infinity", patch: { amount: Number.POSITIVE_INFINITY, converted_amount: Number.POSITIVE_INFINITY } },
  { label: "amount numeric string", patch: { amount: "4500", converted_amount: "4500" } },
  { label: "converted_amount missing", patch: { converted_amount: undefined } },
  { label: "tax_amount negative", patch: { tax_amount: -1, converted_tax_amount: -1 } },
  { label: "tax_amount fractional", patch: { tax_amount: 10.5, converted_tax_amount: 10.5 } },
  { label: "converted_tax_amount null", patch: { converted_tax_amount: null } },
];

for (const { label, patch } of INSANE_AMOUNTS) {
  test(`F-23. ${label} -> human_review (invalid_amount), never a write`, async () => {
    const remoteBadMoney = countingRemote(patch);
    const r = await submit({ expenseId: `exp_f23_${label.replace(/\W+/g, "_")}` }, { remote: remoteBadMoney });
    assert.equal(r.decision, "human_review");
    assert.equal(r.reason, "invalid_amount");
    assert.equal(remoteBadMoney.writes.length, 0, "an insane amount must never reach the real PATCH");
  });
}

test("F-23b. a cross-currency claim is flagged, not estimated — the record carries no rate", async () => {
  const remoteCross = countingRemote({
    currency: { code: "EUR", name: "European Euro", symbol: "€" },
    converted_currency: { code: "USD", name: "United States Dollar", symbol: "$" },
    converted_amount: 4950,
    converted_tax_amount: 412,
  });
  const r = await submit({ expenseId: "exp_f23_rate" }, { remote: remoteCross });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "currency_conversion_unverified");
  assert.equal(remoteCross.writes.length, 0);
});

test("F-23c. a malformed currency object is unverified, never read as a match", async () => {
  // `{}` on both sides must not compare equal-and-fine. Both codes are absent,
  // so a naive `from === to` would be `undefined === undefined` -> true.
  const remoteNoCode = countingRemote({ currency: {}, converted_currency: {} });
  const r = await submit({ expenseId: "exp_f23_nocode" }, { remote: remoteNoCode });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "currency_conversion_unverified");
  assert.equal(remoteNoCode.writes.length, 0);
});

test("F-23d. a receipt array that is not an array is not evidence", async () => {
  const remoteBadReceipts = countingRemote({ receipts: null });
  const r = await submit({ expenseId: "exp_f23_receipts" }, { remote: remoteBadReceipts });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "missing_receipt_evidence");
  assert.equal(remoteBadReceipts.writes.length, 0);
});

test("F-24. the same submission processed twice issues exactly ONE approval write", async () => {
  const remoteOnce = countingRemote();
  const first = await submit({ expenseId: "exp_f24_retry" }, { remote: remoteOnce });
  assert.equal(first.decision, "auto_approve");
  assert.equal(remoteOnce.writes.length, 1);

  const second = await submit({ expenseId: "exp_f24_retry" }, { remote: remoteOnce });
  assert.equal(second.idempotent, true, "the replay must announce itself as a no-op");
  assert.equal(second.storeId, first.storeId, "and reuse the original decision record");
  assert.equal(second.decision, "auto_approve");
  assert.equal(remoteOnce.writes.length, 1, "no second real approval write");
  assert.equal(expenseStore.list().length, 1, "and no second decision row");

  // The no-op is recorded, so a redelivery storm is visible rather than silent.
  assert.equal(audit.entries.filter((e) => e.action === "duplicate_request_ignored").length, 1);
  assert.equal(audit.entries.filter((e) => e.action === "expense_approved_write").length, 1);
});

test("F-24b. the idempotent replay is scoped to the same employment, and never leaks a decision", async () => {
  const remoteOnce = countingRemote();
  await submit({ expenseId: "exp_f24_scope" }, { remote: remoteOnce });

  // A different employee asking about the same expense id gets the normal
  // gates (and escalates), NOT a replay of somebody else's decision.
  const other = await submit(
    {
      expenseId: "exp_f24_scope",
      employmentId: "emp_active_003",
      session: { authenticatedEmploymentId: "emp_active_003" },
    },
    { remote: remoteOnce }
  );
  assert.notEqual(other.idempotent, true);
  assert.equal(other.decision, "escalate");
  assert.equal(other.reason, "expense_employment_mismatch");
  assert.equal(remoteOnce.writes.length, 1);
});

test("F-24c. an unauthenticated retry never receives the stored decision", async () => {
  const remoteOnce = countingRemote();
  await submit({ expenseId: "exp_f24_unauth" }, { remote: remoteOnce });

  const replay = await submit({ expenseId: "exp_f24_unauth", session: null }, { remote: remoteOnce });
  assert.notEqual(replay.idempotent, true);
  assert.equal(replay.decision, "escalate");
  assert.equal(replay.reason, "identity_not_verified");
  assert.equal(remoteOnce.writes.length, 1);
});

// ---------------------------------------------------------------------------
// Upstream failures — a Remote call the client could NOT complete (403/5xx/
// network error) is not the same thing as a 404 ("record not found", already
// handled above by the ordinary gates). CLAUDE.md's own standing note
// documents the live symptom: the Sandbox token's role lacks access to
// GET /v1/employee/expense-categories and 403s on every call. Before this
// fix, RemoteClient's `#get()` throws on a non-404 non-ok status, and NOTHING
// in workflow.js caught it — the exception propagated straight out of
// handleExpenseSubmission, so the request left no store row and no audit row
// at all. That is the exact "lost request" failure mode CLAUDE.md documents
// as already fixed for UC-05/UC-07 (money arithmetic throwing upstream of the
// audit write) — here it is the same shape one step earlier, on a read.
// ---------------------------------------------------------------------------

test("18. Remote 403 fetching expense categories -> escalate, upstream_unavailable, still audited (the live CLAUDE.md symptom)", async () => {
  // Reason stays the shared, coarse constant (src/shared/upstreamFailure.js,
  // relied on by UC-05/06/09 too) — a 403 is "the call could not complete",
  // the same fact a 5xx or a network error is. The SPECIFIC call+status is
  // the granular part, and it lives in `flags`, not in `reason` — checked
  // below via the flag rather than expected as the top-level reason.
  const forbiddenCategories = {
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      return structuredClone(CLEAN_EXPENSE); // NOT the live EXPENSES.exp_auto_101 — see its own comment on why
    },
    async getExpenseCategories() {
      throw new Error("Remote API /v1/employee/expense-categories failed: 403");
    },
  };

  const r = await submit({}, { remote: forbiddenCategories });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "upstream_unavailable");
  assert.ok(r.flags.includes("upstream_expense_categories_403"), `expected the specific flag, got ${JSON.stringify(r.flags)}`);

  // The whole point: the request left a real, inspectable trace instead of
  // vanishing as an unhandled exception.
  const auditRow = audit.entries.find((e) => e.action === "escalate");
  assert.ok(auditRow, "an upstream failure must still write an audit row");
  assert.equal(auditRow.details.reason, "upstream_unavailable");
  assert.ok(auditRow.details.flags.includes("upstream_expense_categories_403"));

  const row = await expenseStore.findById(r.storeId);
  assert.equal(row.decision, "escalate");
});

test("19. Remote 500 fetching the employment record -> escalate, flagged upstream_employment_500", async () => {
  // HEAD's read pattern does not short-circuit at the call site — every read
  // is attempted, and the GATE ORDER in evaluatePolicy() decides which
  // failure wins (employment is checked first, before expense/categories are
  // even looked at). So the expense/category mocks below are harmless no-ops
  // rather than throwing traps: they may genuinely be called, and that is
  // correct, not a regression — what matters is which failure the gate acts
  // on, which this test still pins.
  const failingEmployment = {
    async getEmployment() {
      throw new Error("Remote API /v1/employments/emp_active_001 failed: 500");
    },
    async getExpense() {
      return structuredClone(CLEAN_EXPENSE); // NOT the live EXPENSES.exp_auto_101 — see its own comment on why
    },
    async getExpenseCategories() {
      return EXPENSE_CATEGORIES;
    },
  };

  const r = await submit({}, { remote: failingEmployment });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "upstream_unavailable");
  assert.ok(r.flags.includes("upstream_employment_500"));
  assert.ok(audit.entries.some((e) => e.action === "escalate" && e.details.flags.includes("upstream_employment_500")));
});

test("20. a network error (no HTTP status) fetching the expense -> escalate, flagged upstream_expense_error", async () => {
  const flaky = {
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      throw new Error("network error calling http://localhost:9999/v1/employee/expenses/exp_auto_101: ECONNREFUSED");
    },
    async getExpenseCategories() {
      return EXPENSE_CATEGORIES;
    },
  };

  const r = await submit({}, { remote: flaky });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "upstream_unavailable");
  assert.ok(r.flags.includes("upstream_expense_error"), `expected an error-status flag, got ${JSON.stringify(r.flags)}`);
});

// ---------------------------------------------------------------------------
// expenseClassifier — the rule-based fallback (its own behaviour)
// ---------------------------------------------------------------------------

test("16. rule-based: resolves the category recorded on the claim when the description is ambiguous", () => {
  const r = classifyExpenseRuleBased({ expense: EXPENSES.exp_auto_101, categoryList: EXPENSE_CATEGORIES });
  assert.equal(r.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
  assert.equal(r.confidence, 0.9);
  assert.equal(r.source, "rule_based_fallback");
});

test("16b. rule-based: token overlap turns a client dinner into Client Entertainment, not Meals", () => {
  const r = classifyExpenseRuleBased({ expense: EXPENSES.exp_client_ent_104, categoryList: EXPENSE_CATEGORIES });
  assert.equal(r.categoryId, "work_meals_and_entertainment.external_meals_and_entertainment");
});

test("16c. rule-based: no match and no recorded category -> null, confidence 0.6", () => {
  const r = classifyExpenseRuleBased({ expense: EXPENSES.exp_no_category_208, categoryList: EXPENSE_CATEGORIES });
  assert.equal(r.categoryId, null);
  assert.equal(r.confidence, 0.6);
});

test("16d. rule-based: non-English and blurry receipts drop confidence below 0.85", () => {
  const nonEnglish = classifyExpenseRuleBased({ expense: EXPENSES.exp_non_english_203, categoryList: EXPENSE_CATEGORIES });
  assert.equal(nonEnglish.confidence, 0.5);
  const blurry = classifyExpenseRuleBased({ expense: EXPENSES.exp_low_conf_202, categoryList: EXPENSE_CATEGORIES });
  assert.equal(blurry.confidence, 0.4);
});

// ---------------------------------------------------------------------------
// expenseClassifier — the LLM seam (fake askJson, never a network call)
// ---------------------------------------------------------------------------

const baseExpense = EXPENSES.exp_auto_101;

test("17. configured LLM returning a valid classification -> source llm, category used", async () => {
  const r = await classifyExpense(
    { expense: baseExpense, categoryList: EXPENSE_CATEGORIES },
    {
      isConfigured: () => true,
      askJson: async () => ({ categoryId: "work_meals_and_entertainment.internal_meals_and_entertainment", reason: "Team meal", confidence: 0.95 }),
      backoff: async () => {},
      audit,
    }
  );
  assert.equal(r.source, "llm");
  assert.equal(r.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
  assert.equal(r.confidence, 0.95);
});

test("17b. an invented category id fails validation -> falls back to rules, tagged honestly", async () => {
  const r = await classifyExpense(
    { expense: baseExpense, categoryList: EXPENSE_CATEGORIES },
    {
      isConfigured: () => true,
      askJson: async () => ({ categoryId: "cat_bogus", reason: "made up", confidence: 0.99 }),
      backoff: async () => {},
      audit,
    }
  );
  assert.equal(r.source, "rule_based_fallback"); // never a hallucinated category
  assert.equal(r.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
  // All three attempts were traced, so a 3am investigation can see them.
  const traces = audit.entries.filter((e) => e.call === "expenseClassifier.classify");
  assert.equal(traces.length, 3);
  assert.ok(traces.every((t) => t.ok === false));
  assert.deepEqual(traces.map((t) => t.attempt), [1, 2, 3]);
});

test("17c. LLM failing on every attempt -> retried 3x, then rule-based fallback", async () => {
  const r = await classifyExpense(
    { expense: baseExpense, categoryList: EXPENSE_CATEGORIES },
    {
      isConfigured: () => true,
      askJson: async () => {
        throw new Error("connection refused");
      },
      backoff: async () => {},
      audit,
    }
  );
  assert.equal(r.source, "rule_based_fallback");
  const traces = audit.entries.filter((e) => e.call === "expenseClassifier.classify");
  assert.equal(traces.length, 3);
  assert.ok(traces.every((t) => t.ok === false));
});

test("17d. transient failures recover: fail twice, succeed on the third attempt", async () => {
  let attempts = 0;
  const r = await classifyExpense(
    { expense: baseExpense, categoryList: EXPENSE_CATEGORIES },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary 500");
        return { categoryId: "work_meals_and_entertainment.internal_meals_and_entertainment", reason: "recovered", confidence: 0.9 };
      },
      backoff: async () => {},
      audit,
    }
  );
  assert.equal(r.source, "llm");
  assert.equal(attempts, 3);
  const traces = audit.entries.filter((e) => e.call === "expenseClassifier.classify");
  assert.deepEqual(traces.map((t) => [t.attempt, t.ok]), [[1, false], [2, false], [3, true]]);
});

test("17e. not configured -> rule-based fallback with no LLM attempt at all", async () => {
  const r = await classifyExpense(
    { expense: baseExpense, categoryList: EXPENSE_CATEGORIES },
    { isConfigured: () => false, audit }
  );
  assert.equal(r.source, "rule_based_fallback");
  assert.equal(audit.entries.filter((e) => e.call === "expenseClassifier.classify").length, 0);
});

// ---------------------------------------------------------------------------
// FIXTURE FIDELITY — the guard against this file's most expensive recurring bug
// ---------------------------------------------------------------------------
// Three production defects in this repo trace to a mock inventing a shape the
// real API does not serve (`country_code`, the category `id`, and this use
// case's entire expense record). A fixture that agrees with the code instead of
// with the API cannot catch a disagreement between them, which is the only
// thing a fixture is for. These tests assert the fixtures match the LIVE
// `Expense` schema — so the next person who "simplifies" a fixture to make a
// test pass breaks these instead of breaking production silently.

test("18. every expense fixture carries the real API's field set, and none of the invented ones", () => {
  const INVENTED = ["total_amount", "total_currency", "reimbursement_currency", "conversion_rate", "category_id", "vat_amount", "lines", "description", "submitted_at"];
  // Required per the Expense schema's own `required` array.
  const REQUIRED = ["id", "title", "employment_id", "amount", "converted_amount", "currency", "converted_currency", "expense_date", "tax_amount", "converted_tax_amount"];
  for (const [id, e] of Object.entries(EXPENSES)) {
    for (const bad of INVENTED) {
      assert.ok(!(bad in e), `${id} carries invented field "${bad}" — not on a real Remote expense`);
    }
    for (const req of REQUIRED) {
      assert.ok(req in e, `${id} is missing schema-required field "${req}"`);
    }
    // Currency is an OBJECT with a code, never a bare string.
    for (const key of ["currency", "converted_currency"]) {
      assert.equal(typeof e[key], "object", `${id}.${key} must be a CurrencyDefinition object, not a string`);
      assert.equal(typeof e[key].code, "string");
      assert.ok(e[key].name && e[key].symbol, `${id}.${key} must carry name and symbol`);
    }
    assert.ok(Array.isArray(e.receipts), `${id}.receipts must be an array`);
    assert.ok(e.receipts.length <= 5, `${id}.receipts exceeds the schema's maxItems: 5`);
    // The status enum, verbatim from the schema.
    assert.ok(["canceled", "pending", "declined", "approved", "processing", "reimbursed"].includes(e.status), `${id}.status "${e.status}" is not in the real enum`);
    // Money is an integer in the currency's minor unit — never a float.
    for (const key of ["amount", "converted_amount", "tax_amount", "converted_tax_amount"]) {
      assert.ok(e[key] === null || Number.isSafeInteger(e[key]), `${id}.${key} must be an integer ×100 (or null in a deliberate malformed fixture)`);
    }
  }
});

test("18b. the record's category namespace is DISJOINT from the categories endpoint's", () => {
  // Confirmed live 2026-08-17: zero overlap. This is why the record's own
  // category can only ever be a text hint to the classifier, never an
  // authoritative selectable code — and why anyone tempted to look
  // `expense.expense_category.code` up in the selectable list will always miss.
  const selectable = new Set(EXPENSE_CATEGORIES.filter((c) => c.is_selectable).map((c) => c.code));
  const recorded = Object.values(EXPENSES).map((e) => e.expense_category?.code).filter(Boolean);
  assert.ok(recorded.length > 0, "fixtures must exercise recorded categories");
  for (const code of recorded) {
    assert.ok(!selectable.has(code), `"${code}" appears in BOTH namespaces — the disjointness assumption is stale, re-verify against the live API`);
  }
});

// ---------------------------------------------------------------------------
// FRESH COPIES OF A FIXTURE CLAIM — re-running a scenario, honestly
// ---------------------------------------------------------------------------
// THE REPORT. A tester ticked "Generate a new reference" on the portal,
// submitted the same expense again, and got "Already decided — the stored
// decision was replayed". They read the reference control as broken. It was
// not: the reference identifies the DELIVERY, and UC-02 separately asks whether
// it has already judged this EXPENSE, which it had. Both behaviours are
// correct, and together they made every scenario on a fixed fixture list a
// one-shot — the first submission was decided and every one after it, forever,
// replayed.
//
// The mock can now mint a genuinely new claim from an existing one
// (`<id>~fresh-<token>`). These tests prove BOTH halves, because either alone
// would be misleading: the replay must still happen for a repeated expense (it
// is what stops a second approval write), and a fresh copy must actually reach
// the gates rather than replaying anyway.

// Every case below files against a FRESH COPY rather than the bare fixture,
// and that is not incidental. `exp_auto_101` is approved at Remote by test 1 of
// this file and the mock's records are process-wide, so a later `submit()` of
// the bare id refuses at the claim-state gate — which is itself the one-shot
// problem these tests are about, reproduced inside the suite.

test("re-submitting the same expense replays the stored decision — no second write", async () => {
  const first = await submit({ expenseId: "exp_auto_101~fresh-replay" });
  assert.equal(first.decision, "auto_approve");
  assert.notEqual(first.idempotent, true);

  // A brand-new reference changes nothing here: the subject is the expense.
  const again = await submit({ expenseId: "exp_auto_101~fresh-replay", externalRef: "a-completely-new-reference" });
  assert.equal(again.idempotent, true);
  assert.equal(again.storeId, first.storeId, "the replay returns the ORIGINAL record, not a new one");
  assert.equal(again.decision, first.decision);
  assert.ok(again.alreadyDecidedAt);
});

test("a fresh copy of that same expense is a NEW claim and runs the gates for real", async () => {
  const first = await submit({ expenseId: "exp_auto_101~fresh-original" });
  assert.equal(first.decision, "auto_approve");

  const fresh = await submit({ expenseId: "exp_auto_101~fresh-testcopy1" });

  // The load-bearing assertion, and the reason this test exists: NOT a replay.
  // A fresh copy that quietly replayed would look identical from the portal to
  // the bug it was built to remove.
  assert.notEqual(fresh.idempotent, true);
  assert.notEqual(fresh.storeId, first.storeId);
  assert.equal(fresh.expenseId, "exp_auto_101~fresh-testcopy1");

  // And it reaches the same verdict, because it is the same claim in every
  // respect a gate reads. A copy that decided differently would mean the
  // minting had changed something material.
  assert.equal(fresh.decision, "auto_approve");
  assert.equal(fresh.reason, "all_gates_passed");
  assert.deepEqual(fresh.flags, []);
});

test("a fresh copy is not caught by the derived receipt fingerprint", async () => {
  // The trap this guards. deriveReceiptFingerprint() hashes employee, amount,
  // currency, tax, date AND title. A copy identical in all six would hash to
  // the base claim's fingerprint and be refused at gate 6 as an
  // already-reimbursed receipt — the fingerprint working exactly as designed,
  // and a fresh copy that could never be used. The title carries the token for
  // this reason alone; no gate reads it.
  const base = await submit({ expenseId: "exp_auto_101~fresh-fingerprint-a" });
  assert.equal(base.decision, "auto_approve");
  const fresh = await submit({ expenseId: "exp_auto_101~fresh-fingerprint-b" });
  assert.notEqual(fresh.reason, "duplicate_submission");
  assert.equal(fresh.decision, "auto_approve");
});

test("two fresh copies of one claim are two separate claims", async () => {
  const a = await submit({ expenseId: "exp_auto_101~fresh-aaa" });
  const b = await submit({ expenseId: "exp_auto_101~fresh-bbb" });
  assert.notEqual(a.storeId, b.storeId);
  assert.notEqual(b.idempotent, true);
  assert.equal(b.decision, "auto_approve");
});

test("the fresh marker mints nothing when there is no real claim behind it", async () => {
  // `~fresh-` is not a licence to invent a record. An unknown base 404s exactly
  // as any other unknown id does, so a typo cannot conjure a claim that is then
  // judged.
  const missing = await submit({ expenseId: "exp_does_not_exist~fresh-xyz" });
  assert.equal(missing.reason, "expense_not_found");

  const noToken = await submit({ expenseId: "exp_auto_101~fresh-" });
  assert.equal(noToken.reason, "expense_not_found");
});

test("a fresh copy of an ALREADY-DECIDED claim is pending again, so the copy is usable", async () => {
  // exp_approved_211 is approved at Remote, so it refuses at the claim-state
  // gate. Inheriting that status would make every fresh copy of a decided
  // fixture refuse for a reason that has nothing to do with the copy.
  const original = await submit({ expenseId: "exp_approved_211", employmentId: "emp_active_001" });
  assert.equal(original.reason, "expense_not_pending");

  const fresh = await submit({ expenseId: "exp_approved_211~fresh-reopened" });
  assert.notEqual(fresh.reason, "expense_not_pending");
});
