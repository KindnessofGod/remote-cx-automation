// ---------------------------------------------------------------------------
// n8nUc02Parity.test.js — the n8n "Expense Gates" Code node and
// policyEngine.js/policyCaps.js/expenseClassifier.js must agree
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same reasoning as n8nParity.test.js / n8nUc06Parity.test.js / n8nUc08Parity.test.js:
// UC-02's decision logic exists twice — once as the real Node functions
// (src/uc02/{policyEngine,policyCaps,expenseClassifier}.js) and once as the
// "Expense Gates" Code node body (workflows/nodes-uc02/expenseGates.js, the
// port that will live in the UC-02 n8n workflow). This test executes the
// ACTUAL node body in a `node:vm` sandbox with every `$()` lookup mocked, and
// asserts it reaches the same decision/reason/flags/riskTier/category for
// every UC-02.md §12 scenario AND every gate in policyEngine.js's ordered
// list (identity, employment, expense, ownership, duplicate, category,
// itemization, math, currency, policy cap, confidence, VAT).
//
// The expected values are always computed by the REAL functions
// (verifyRequester, classifyExpenseRuleBased, getPolicyCap, evaluate,
// classifyRisk) — never re-derived in test code — so a change to the source
// that the node body does not mirror makes this suite fail. The classification
// fixtures are the mock server's own records (EXPENSES/EXPENSE_CATEGORIES/
// EMPLOYMENTS), so the node is proven against the same data the real workflow
// runs on.
//
// JSON round-trip: the vm result is cross-realm, so both sides are normalized
// through JSON.parse(JSON.stringify(...)) before comparing — the same trap the
// repo hit once (workflows/README.md's parity-test section).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate } from "../src/uc02/policyEngine.js";
import { getPolicyCap } from "../src/uc02/policyCaps.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { isCategoryFileable } from "../src/uc02/expenseCategories.js";
// The REAL derived-fingerprint function. The n8n node computes the same digest
// in hand-written JavaScript (a Code node has no imports), and the two must
// agree byte for byte or one claim filed through each path lands under two
// different dedupe keys and never collides. Compared directly below.
import { deriveReceiptFingerprint } from "../src/uc02/workflow.js";
import { verifyRequester } from "../src/shared/identity.js";
import { classifyRisk } from "../src/shared/riskEngine.js";
import { EXPENSES, EXPENSE_CATEGORIES, EMPLOYMENTS } from "../src/remote/mockServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_PATH = join(__dirname, "..", "workflows", "nodes-uc02", "expenseGates.js");
const gatesSource = readFileSync(GATES_PATH, "utf8");

/**
 * Run the "Expense Gates" Code node body with every n8n `$()` lookup mocked.
 * Mirrors runAmendmentGatesNode() in n8nUc06Parity.test.js.
 */
function runExpenseGatesNode({ request, employmentRes, expenseRes, categoriesRes, duplicateRes, llmRes }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Expense Submission") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: employmentRes }) };
      if (nodeName === "Fetch Expense (Remote)") return { first: () => ({ json: expenseRes }) };
      if (nodeName === "Fetch Expense Categories (Remote)") return { first: () => ({ json: categoriesRes }) };
      if (nodeName === "Check Duplicate Receipt (Supabase)") return { first: () => ({ json: duplicateRes }) };
      if (nodeName === "Classify Expense (LLM)") return { first: () => ({ json: llmRes }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };

  const wrapped = `(function () {\n${gatesSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });

  // Round-trip through JSON — same cross-realm reasoning as every other parity test.
  return JSON.parse(JSON.stringify(result[0].json));
}

const SESSION = { authenticatedEmploymentId: "emp_active_001" };

const requestFor = (over = {}) => ({
  expenseId: "exp_auto_101",
  employmentId: "emp_active_001",
  session: SESSION,
  receiptHash: null,
  externalRef: "2001",
  source: "webhook",
  ...over,
});

// Raw HTTP-node envelopes. "flat" is the mock server's `{data: <record>}`
// shape; "nested" is the real Remote API's `{data: {<resource>: <record>}}`
// shape. The node body normalizes both; the parity suite proves it.
const employmentRes = (employment, envelope = "flat") =>
  envelope === "nested" ? { data: { employment } } : { data: employment };
const expenseRes = (expense, envelope = "flat") =>
  envelope === "nested" ? { data: { expense } } : { data: expense };
// The REAL envelope of GET /v1/expenses/categories is `{data: [...]}` — a flat
// array of rows keyed by `code`, verified live 2026-08-17. It used to be built
// here as `{data:{categories}}` with `{id,name}` rows, which is a shape the API
// has never returned; the node's `c.id === …` comparison agreed with that
// fixture and was permanently false against the real thing.
const categoriesRes = (categories = EXPENSE_CATEGORIES) => ({ data: categories });
// What "Check Duplicate Receipt (Supabase)" emits. It used to be `{duplicate}`
// alone; the node now also carries the F-24 hashes forward, because the gates
// pass them to the persist node and the audit row.
const duplicateRes = (duplicate = null, over = {}) => ({
  duplicate,
  derivedReceiptHash: null,
  dedupeKey: null,
  duplicateMatchedOn: duplicate ? "submitted_receipt_hash" : null,
  ...over,
});

/** No valid LLM response — every default scenario exercises the rule-based
 *  fallback, same hermetic guarantee as every other parity test in this repo. */
const NO_LLM_RESPONSE = { choices: [] };
const llmRes = (content) => ({ choices: [{ message: { content } }] });

const SCENARIOS = [
  {
    name: "§12.1 compliant meals claim under cap -> auto_approve",
    expense: EXPENSES.exp_auto_101,
  },
  {
    name: "§12.2 over-cap claim -> human_review over_policy_cap (confident classification never overrides a failed gate)",
    expense: EXPENSES.exp_over_cap_201,
  },
  {
    name: "§12.3 duplicate receipt hash -> blocked",
    expense: EXPENSES.exp_dup_a_102,
    requestOver: { receiptHash: "hash-dup-1" },
    duplicate: { id: "exp_dup_a_102", receipt_hash: "hash-dup-1" },
  },
  {
    // THIS SCENARIO USED TO ASSERT THE BUG. It read "no receipt hash ->
    // dedupe does not run, even when a lookup row exists upstream", and it
    // passed — against a graph whose lookup node returned `{duplicate: null}`
    // unconditionally and whose gates then discarded the answer anyway
    // whenever the submitter supplied no hash. Both halves were dead, and a
    // test written to agree with them made the deadness look like policy.
    //
    // The submitter does not get to decide whether the duplicate check runs
    // (finding F-24). A claim filed with no hash is dedupe'd on the
    // fingerprint derived from the expense record, so an upstream match MUST
    // now block. This is the positive direction — the only direction that can
    // tell a working gate from an unreachable one.
    name: "§12.3b no submitted hash -> the DERIVED fingerprint still blocks it",
    expense: EXPENSES.exp_dup_a_102,
    duplicate: { id: "exp_dup_a_102" },
  },
  {
    name: "§12.4 blurry receipt -> human_review low_confidence",
    expense: EXPENSES.exp_low_conf_202,
  },
  {
    name: "§12.5 non-English receipt -> human_review low_confidence",
    expense: EXPENSES.exp_non_english_203,
  },
  {
    name: "§12.6 line items do not sum to the stated total -> human_review math_mismatch",
    expense: EXPENSES.exp_math_mismatch_204,
  },
  {
    name: "§12.7 client-entertainment dinner -> auto_approve under its own cap",
    expense: EXPENSES.exp_client_ent_104,
  },
  {
    name: "gate 1 no session -> escalate identity_not_verified (fails closed)",
    expense: EXPENSES.exp_auto_101,
    requestOver: { session: null },
  },
  {
    name: "gate 1b session authenticated as a different employee -> escalate identity_not_verified",
    expense: EXPENSES.exp_mismatch_209,
    employment: EMPLOYMENTS.emp_active_001,
    requestOver: { session: { authenticatedEmploymentId: "emp_active_003" } },
  },
  {
    name: "gate 1c missing employment record -> escalate identity_not_verified",
    expense: EXPENSES.exp_auto_101,
    employment: null,
  },
  {
    name: "gate 2 terminated employee -> escalate employee_not_active",
    expense: EXPENSES.exp_terminated_210,
    employment: EMPLOYMENTS.emp_terminated_002,
    requestOver: { employmentId: "emp_terminated_002", session: { authenticatedEmploymentId: "emp_terminated_002" } },
  },
  {
    name: "gate 3 expense id does not resolve -> escalate expense_not_found",
    expense: null,
  },
  {
    name: "gate 4 expense belonging to another employee -> escalate expense_employment_mismatch",
    expense: EXPENSES.exp_mismatch_209,
    employment: EMPLOYMENTS.emp_active_001,
  },
  {
    name: "gate 6 no category resolvable and none recorded -> human_review category_unverified",
    expense: EXPENSES.exp_no_category_208,
  },
  {
    name: "gate 8 no receipt -> human_review missing_receipt_evidence",
    expense: EXPENSES.exp_no_receipt_204,
  },
  {
    name: "gate 8b a malformed receipt row is not evidence",
    expense: { ...EXPENSES.exp_auto_101, id: "exp_halfreceipt_500", receipts: [{ id: "", name: null, type: "expense" }] },
  },
  {
    name: "gate 10a tax portion exceeds the amount -> human_review tax_exceeds_amount",
    expense: EXPENSES.exp_tax_exceeds_205,
  },
  {
    name: "gate 10b same currency but converted_amount disagrees -> human_review conversion_identity_mismatch",
    expense: EXPENSES.exp_conv_mismatch_206,
  },
  {
    name: "gate 11 cross-currency -> human_review currency_conversion_unverified",
    expense: EXPENSES.exp_cross_currency_107,
  },
  {
    name: "gate 12 a currency the cap corpus is not denominated in -> human_review policy_cap_currency_mismatch",
    expense: EXPENSES.exp_gbp_215,
  },
  {
    name: "gate 14 a future expense_date -> human_review expense_date_invalid",
    expense: EXPENSES.exp_future_date_214,
  },
  {
    name: "a real non-zero tax portion does NOT block a clean claim (the old VAT gate would have)",
    expense: EXPENSES.exp_writebody_216,
  },
  {
    name: "a valid LLM classification is used (source llm) instead of the rule-based fallback",
    expense: EXPENSES.exp_no_category_208,
    llm: llmRes(JSON.stringify({ categoryId: "tech_and_work_equipment.software_and_subscriptions", reason: "Project software licence", confidence: 0.92 })),
    expectedClassification: { categoryId: "tech_and_work_equipment.software_and_subscriptions", reason: "Project software licence", confidence: 0.92, source: "llm" },
  },
  {
    name: "an invented LLM category id fails the strict shape -> falls back to rules -> category_unverified",
    expense: EXPENSES.exp_no_category_208,
    llm: llmRes(JSON.stringify({ categoryId: "business_travel.invented_by_a_model", reason: "made up", confidence: 0.99 })),
  },
  {
    // A REAL code, but one naming a non-selectable parent heading. Both sides
    // must refuse it: an employee cannot file against a parent, so approving
    // into one would approve something the platform itself would reject.
    name: "an LLM proposing a non-selectable PARENT category -> falls back to rules, never validates",
    expense: EXPENSES.exp_no_category_208,
    llm: llmRes(JSON.stringify({ categoryId: "work_meals_and_entertainment", reason: "a heading", confidence: 0.99 })),
  },
  {
    name: "the real Remote `data.employment` nesting shape normalizes identically",
    expense: EXPENSES.exp_auto_101,
    employmentEnvelope: "nested",
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n Expense Gates match policyEngine — ${scenario.name}`, () => {
    const request = requestFor(scenario.requestOver ?? {});
    const employment = scenario.employment === undefined ? EMPLOYMENTS[request.employmentId] : scenario.employment;
    const expense = scenario.expense;

    const fromN8n = runExpenseGatesNode({
      request,
      employmentRes: employmentRes(employment, scenario.employmentEnvelope),
      expenseRes: expenseRes(expense, scenario.expenseEnvelope),
      categoriesRes: categoriesRes(),
      duplicateRes: duplicateRes(scenario.duplicate ?? null),
      llmRes: scenario.llm ?? NO_LLM_RESPONSE,
    });

    // Expected values from the REAL functions — never re-derived in test code.
    const identityVerified = verifyRequester({ session: request.session, employment }).verified;
    const employmentActive = Boolean(employment && employment.status === "active");
    const expenseOwned = Boolean(expense && expense.employment_id === request.employmentId);
    // No `request.receiptHash ? … : null` guard any more, on either side. The
    // node consults the lookup unconditionally because the derived fingerprint
    // always exists, and src/uc02/workflow.js does the same — so re-deriving a
    // guard here would put the deleted bug back into the expectation.
    const duplicate = scenario.duplicate ?? null;
    const classification =
      scenario.expectedClassification ?? classifyExpenseRuleBased({ expense, categoryList: EXPENSE_CATEGORIES });
    // From the REAL function, like every other expected value here. This one
    // line used to be re-derived in test code as
    // `EXPENSE_CATEGORIES.some((c) => c.id === classification.categoryId)`,
    // which quietly broke the discipline the header states — and it was the
    // exact expression carrying the production bug. Re-deriving it here meant
    // the test and the node body could both be wrong in the same way and still
    // agree, so parity passed while neither matched the real API.
    const categoryValid = isCategoryFileable(EXPENSE_CATEGORIES, classification.categoryId);
    const policyCap = getPolicyCap(classification.categoryId);

    const expected = evaluate({
      identityVerified,
      employmentActive,
      expense,
      expenseOwned,
      duplicate,
      categoryValid,
      classification,
      policyCap,
    });
    const expectedTier = classifyRisk("UC-02", expected.flags).tier;

    assert.equal(fromN8n.decision, expected.decision, "decision differs");
    assert.equal(fromN8n.reason, expected.reason, "reason differs");
    assert.deepEqual(fromN8n.flags, expected.flags, "flags differ");
    assert.equal(fromN8n.riskTier, expectedTier, "riskTier differs");
    assert.equal(fromN8n.categoryId, classification.categoryId, "categoryId differs");
    assert.equal(fromN8n.categorySource, classification.source, "categorySource differs");
    assert.equal(fromN8n.confidence, classification.confidence, "confidence differs");

    if (expected.decision === "auto_approve") {
      assert.deepEqual(fromN8n.writePayload, { status: "approved" }, "auto-approve must compute the approve write payload");
    } else {
      assert.equal(fromN8n.writePayload, null, "non-auto-approve paths must not compute a write payload");
    }
  });
}

test("the n8n node body parses and returns n8n's item shape", () => {
  const out = runExpenseGatesNode({
    request: requestFor(),
    employmentRes: employmentRes(EMPLOYMENTS.emp_active_001),
    expenseRes: expenseRes(EXPENSES.exp_auto_101),
    categoriesRes: categoriesRes(),
    duplicateRes: duplicateRes(),
    llmRes: NO_LLM_RESPONSE,
  });
  assert.equal(typeof out.decision, "string");
  assert.ok(Array.isArray(out.flags));
  assert.equal(out.decision, "auto_approve");
  assert.deepEqual(out.writePayload, { status: "approved" });
  assert.equal(out.amount, 12500); // integer minor units, original currency
  assert.equal(out.currency, "USD"); // the CODE off the currency object
  assert.equal(out.convertedAmount, 12500);
  assert.equal(out.convertedCurrency, "USD");
  assert.equal(out.taxAmount, 1050);
  assert.equal(out.receiptCount, 1);
  assert.equal(out.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
});

test("the Prepare Classification Prompt node body compiles, and offers the model the REAL shape", () => {
  // This body lived only inside the live n8n graph until 2026-08-17, so nothing
  // compiled it and nothing could diff it (CLAUDE.md §6 forbids exactly that).
  // It carried the same wrong-shape bug as the gates: it mapped categories to
  // `{id, name}`, fields a real Remote category row does not have, so the model
  // received a list of `{"id":null,"name":null}` objects.
  const src = readFileSync(
    join(__dirname, "..", "workflows", "nodes-uc02", "prepareClassificationPrompt.js"),
    "utf8"
  );
  assert.doesNotThrow(() => new Function(src), "prepareClassificationPrompt.js does not compile");
  // Comments stripped first — the same discipline uc08.test.js's structural
  // check uses, so prose ABOUT the old shape cannot fail a check on the code.
  const code = src.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /\bc\.id\b|\bc\.name\b/, "a real category row has no `id` or `name`");
  assert.match(code, /c\.code/, "categories must be offered to the model by their real `code`");

  // And run it: only the selectable, active leaf may be offered.
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Expense Submission") return { first: () => ({ json: requestFor() }) };
      if (nodeName === "Fetch Expense (Remote)") return { first: () => ({ json: expenseRes(EXPENSES.exp_auto_101) }) };
      if (nodeName === "Fetch Expense Categories (Remote)") return { first: () => ({ json: categoriesRes() }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const out = JSON.parse(
    JSON.stringify(vm.runInNewContext(`(function () {\n${src}\n})()`, sandbox, { timeout: 5000 }))
  );
  const offered = JSON.parse(out[0].json.openaiBody.messages[1].content).categories;
  assert.ok(offered.length > 0, "the model must actually be offered categories");
  assert.deepEqual(
    offered.map((c) => c.code).sort(),
    EXPENSE_CATEGORIES.filter((c) => c.is_selectable && c.status === "active")
      .map((c) => c.code)
      .sort(),
    "exactly the selectable, active leaves — never a parent heading"
  );
  for (const c of offered) {
    assert.equal("id" in c, false);
    assert.equal("name" in c, false);
  }
});

test("the n8n Code node body is syntactically valid", () => {
  // Same guard as the other parity tests — a Code node body is just a string
  // to n8n, so a broken one deploys happily and only fails mid-execution.
  const src = readFileSync(join(__dirname, "..", "workflows", "nodes-uc02", "expenseGates.js"), "utf8");
  assert.doesNotThrow(() => new Function(src), "expenseGates.js does not compile");
});

// ---------------------------------------------------------------------------
// SWALLOWED UPSTREAM FAILURES (src/shared/upstreamFailure.js)
// ---------------------------------------------------------------------------
// The three Remote nodes in this graph carry `onError: continueRegularOutput`,
// so a failed fetch reports success and hands the gates an error item instead
// of a record. These fixtures are the REAL items, copied out of live execution
// 4218 (GET /api/v1/executions/4218?includeData=true) — the run that recorded
// `identity_not_verified` for what was actually two 404s and a 403.
//
// Parity here means the node body's own detection produces the same decision
// the real evaluate() reaches when handed the equivalent `upstreamFailures`.
// ---------------------------------------------------------------------------

const LIVE_404 = {
  error: {
    message: '404 - "{\\"message\\":\\"Employment not found\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 404",
    code: "ERR_BAD_REQUEST",
    status: 404,
  },
};
const LIVE_403 = {
  error: {
    message: '403 - "{\\"message\\":\\"Forbidden, invalid role for this endpoint\\"}"',
    name: "AxiosError",
    stack: "AxiosError: Request failed with status code 403",
    code: "ERR_BAD_REQUEST",
    status: 403,
  },
};

test("parity: execution 4218's three swallowed failures no longer read as an identity refusal", () => {
  const fromN8n = runExpenseGatesNode({
    request: requestFor(),
    employmentRes: LIVE_404,
    expenseRes: LIVE_404,
    categoriesRes: LIVE_403,
    duplicateRes: duplicateRes(),
    llmRes: NO_LLM_RESPONSE,
  });

  // What execution 4218 actually recorded, and why it was wrong: the webhook
  // carried a valid `session.authenticatedEmploymentId`, so identity would
  // have PASSED on a good fetch.
  assert.notEqual(fromN8n.reason, "identity_not_verified");
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_record_not_found");
  assert.deepEqual(fromN8n.flags, ["upstream_record_not_found", "upstream_employment_404"]);

  // The audit node reads this to record WHICH call failed and WHAT it answered.
  assert.deepEqual(
    fromN8n.upstreamFailures.map((f) => [f.call, f.status, f.kind]),
    [
      ["employment", 404, "not_found"],
      ["expense", 404, "not_found"],
      ["expense_categories", 403, "unreachable"],
    ]
  );

  // Parity: the real engine, handed the same failures, reaches the same verdict.
  const real = evaluate({
    identityVerified: false,
    employmentActive: false,
    expense: null,
    expenseOwned: false,
    duplicate: null,
    categoryValid: false,
    classification: { categoryId: null, confidence: 0.6, source: "rule_based_fallback" },
    policyCap: null,
    upstreamFailures: fromN8n.upstreamFailures,
  });
  assert.equal(fromN8n.decision, real.decision);
  assert.equal(fromN8n.reason, real.reason);
  assert.deepEqual(fromN8n.flags, real.flags);
});

test("parity: a 403 on the category list alone is not the classifier's fault", () => {
  const fromN8n = runExpenseGatesNode({
    request: requestFor(),
    employmentRes: employmentRes(EMPLOYMENTS.emp_active_001),
    expenseRes: expenseRes(EXPENSES.exp_auto_101),
    categoriesRes: LIVE_403,
    duplicateRes: duplicateRes(),
    llmRes: NO_LLM_RESPONSE,
  });
  assert.equal(fromN8n.decision, "escalate");
  assert.equal(fromN8n.reason, "upstream_unavailable");
  assert.deepEqual(fromN8n.flags, ["upstream_unavailable", "upstream_expense_categories_403"]);
  assert.equal(fromN8n.writePayload, null, "a failed read must never compute a write payload");

  const real = evaluate({
    identityVerified: true,
    employmentActive: true,
    expense: EXPENSES.exp_auto_101,
    expenseOwned: true,
    duplicate: null,
    categoryValid: false,
    classification: { categoryId: null, confidence: 0.6, source: "rule_based_fallback" },
    policyCap: null,
    upstreamFailures: fromN8n.upstreamFailures,
  });
  assert.equal(fromN8n.reason, real.reason);
  assert.deepEqual(fromN8n.flags, real.flags);
});

test("parity: a healthy run records no upstream failures and still auto-approves", () => {
  // The other half of the guarantee: this change must be invisible when every
  // read succeeds. If detection were over-eager it would show up right here.
  const fromN8n = runExpenseGatesNode({
    request: requestFor(),
    employmentRes: employmentRes(EMPLOYMENTS.emp_active_001, "nested"),
    expenseRes: expenseRes(EXPENSES.exp_auto_101, "nested"),
    categoriesRes: categoriesRes(),
    duplicateRes: duplicateRes(),
    llmRes: NO_LLM_RESPONSE,
  });
  assert.deepEqual(fromN8n.upstreamFailures, []);
  assert.equal(fromN8n.decision, "auto_approve");
});

// ---------------------------------------------------------------------------
// THE DUPLICATE-RECEIPT PATH (docs/BUILD-LOG.md §3.39)
// ---------------------------------------------------------------------------
// The live graph's "Check Duplicate Receipt (Supabase)" node was a Code node
// whose whole body was `return [{ json: { duplicate: null } }]`, on the stated
// premise that no `uc02_expenses` table had been provisioned. The table
// existed, with indexes on exactly this gate's two lookup columns. So the gate
// was not refusing correctly — it could not fire at all, under any input, and
// every negative test in this file passed throughout.
//
// These tests are the positive direction. They execute the two REAL node
// bodies that replaced the placeholder and assert what a negative test cannot
// reach: that the derived fingerprint is byte-identical to the one the Node
// path computes, and that a second filing of the same receipt IS blocked.
// ---------------------------------------------------------------------------

const DERIVE_PATH = join(__dirname, "..", "workflows", "nodes-uc02", "deriveReceiptFingerprint.js");
const CHECK_PATH = join(__dirname, "..", "workflows", "nodes-uc02", "checkDuplicateReceipt.js");
const deriveSource = readFileSync(DERIVE_PATH, "utf8");
const checkSource = readFileSync(CHECK_PATH, "utf8");

/** Run "Derive Receipt Fingerprint" with its two `$()` lookups mocked. */
function runDeriveNode({ request, expenseRes: expRes }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Expense Submission") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Expense (Remote)") return { first: () => ({ json: expRes }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const result = vm.runInNewContext(`(function () {\n${deriveSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

/**
 * Run "Check Duplicate Receipt (Supabase)" over a set of stored rows, exactly
 * as the Supabase node hands them over (each row wrapped as `{json}`).
 * `storedRows: []` is the zero-result case, which the real node sees as ONE
 * EMPTY item because the query node carries `alwaysOutputData: true`.
 */
function runCheckNode({ context, storedRows }) {
  const items = storedRows.length === 0 ? [{ json: {} }] : storedRows.map((row) => ({ json: row }));
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Derive Receipt Fingerprint") return { first: () => ({ json: context }) };
      if (nodeName === "Fetch Receipt Matches (Supabase)") return { all: () => items };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
  };
  const result = vm.runInNewContext(`(function () {\n${checkSource}\n})()`, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

/** A stored `uc02_expenses` row, as PostgREST returns it. */
const storedRow = (over = {}) => ({
  id: "row-0001",
  expense_id: "exp_dup_a_102",
  employment_id: "emp_active_001",
  receipt_hash: null,
  decision: "auto_approve",
  external_ref: "2001",
  created_at: "2026-08-01T09:00:00Z",
  ...over,
});

test("both new Code node bodies are syntactically valid", () => {
  assert.doesNotThrow(() => new Function(deriveSource), "deriveReceiptFingerprint.js does not compile");
  assert.doesNotThrow(() => new Function(checkSource), "checkDuplicateReceipt.js does not compile");
});

test("the n8n derived fingerprint is byte-identical to the Node path's, for EVERY mock expense", () => {
  // The load-bearing parity claim of this fix. If these disagree by one byte, a
  // claim filed through the portal and the same claim filed through the graph
  // land under different keys and never collide — a dedupe that looks live and
  // catches nothing, which is precisely the failure being fixed.
  const ids = Object.keys(EXPENSES);
  assert.ok(ids.length > 5, "the fixture set must be non-trivial");
  for (const id of ids) {
    const expense = EXPENSES[id];
    const out = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(expense) });
    assert.equal(
      out.derivedReceiptHash,
      deriveReceiptFingerprint(expense),
      `derived fingerprint differs for ${id}`
    );
    assert.match(out.derivedReceiptHash, /^derived:[0-9a-f]{32}$/);
  }
});

test("the derived fingerprint ignores the expense id — two records, one receipt, one key", () => {
  // exp_dup_a_102 and exp_dup_b_103 are the same real-world claim filed twice;
  // they differ only by id and receipt file id. Both must fingerprint alike, or
  // §7 cannot catch the case it exists for.
  const a = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const b = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_b_103) });
  assert.equal(a.derivedReceiptHash, b.derivedReceiptHash);
  assert.equal(a.derivedReceiptHash, deriveReceiptFingerprint(EXPENSES.exp_dup_b_103));

  // ...and a genuinely different claim does not collide with them.
  const other = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_client_ent_104) });
  assert.notEqual(other.derivedReceiptHash, a.derivedReceiptHash);
});

test("the persisted key is derived-preferred, matching expenseStore.js's dedupeKey()", () => {
  const withHash = runDeriveNode({
    request: requestFor({ receiptHash: "hash-dup-1" }),
    expenseRes: expenseRes(EXPENSES.exp_dup_a_102),
  });
  assert.equal(withHash.receiptHash, "hash-dup-1");
  assert.equal(withHash.dedupeKey, withHash.derivedReceiptHash, "derived wins over submitted");
  assert.deepEqual(withHash.hashCandidates, ["hash-dup-1", withHash.derivedReceiptHash]);

  // No expense record resolved: nothing to derive, so the submitted hash is the
  // key — and BOTH candidate slots are filled, because the query node's two
  // ORed conditions must never resolve to an empty value.
  const noExpense = runDeriveNode({
    request: requestFor({ receiptHash: "hash-only-1" }),
    expenseRes: expenseRes(null),
  });
  assert.equal(noExpense.derivedReceiptHash, null);
  assert.equal(noExpense.dedupeKey, "hash-only-1");
  assert.deepEqual(noExpense.hashCandidates, ["hash-only-1", "hash-only-1"]);
  assert.equal(noExpense.lookupPossible, true);
});

test("a caller-supplied hash that could break the PostgREST filter is dropped, visibly", () => {
  // The submitted hash is caller-controlled and lands in an `or=(col.eq.X,…)`
  // grammar where `,` `.` `(` `)` are structural. A value that cannot be a
  // receipt fingerprint is not escaped into the query — it is dropped, and the
  // drop is recorded rather than silently widening or breaking the lookup.
  const out = runDeriveNode({
    request: requestFor({ receiptHash: "abc,receipt_hash.neq.zzz" }),
    expenseRes: expenseRes(EXPENSES.exp_dup_a_102),
  });
  assert.equal(out.submittedReceiptHashDropped, true);
  assert.deepEqual(out.hashCandidates, [out.derivedReceiptHash, out.derivedReceiptHash]);
  // Dropping it never disables the check: the derived key still runs.
  assert.match(out.dedupeKey, /^derived:/);

  const clean = runDeriveNode({
    request: requestFor({ receiptHash: "hash-dup-1" }),
    expenseRes: expenseRes(EXPENSES.exp_dup_a_102),
  });
  assert.equal(clean.submittedReceiptHashDropped, false);
});

test("no stored rows -> no duplicate, and the chain's shape is unchanged", () => {
  // The zero-result case `alwaysOutputData` produces. Every healthy run takes
  // it, so it must not lose context.
  const context = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const out = runCheckNode({ context, storedRows: [] });
  assert.equal(out.duplicate, null);
  assert.equal(out.duplicateMatchedOn, null);
  assert.equal(out.receiptMatchCount, 0);
  assert.equal(out.derivedReceiptHash, context.derivedReceiptHash, "context must survive the node");
  assert.equal(out.expenseId, context.expenseId);
});

test("POSITIVE: a second filing of the same receipt IS flagged — derived key, no submitted hash", () => {
  // The assertion this whole fix exists for, and the one no negative test can
  // reach. Claim A is filed and stored under its derived key; claim B is the
  // same receipt on a different expense record with NO submitted hash — the
  // shape every Zendesk-intake claim has.
  const first = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const stored = storedRow({ receipt_hash: first.dedupeKey });

  const secondRequest = requestFor({ expenseId: "exp_dup_b_103", receiptHash: null, externalRef: "2002" });
  const second = runDeriveNode({ request: secondRequest, expenseRes: expenseRes(EXPENSES.exp_dup_b_103) });
  assert.equal(second.receiptHash, null, "the second claim supplies no hash — that must not exempt it");

  const checked = runCheckNode({ context: second, storedRows: [stored] });
  assert.ok(checked.duplicate, "the second filing must find the first");
  assert.equal(checked.duplicateMatchedOn, "derived_receipt_fingerprint");
  assert.equal(checked.duplicateOfId, "row-0001");
  assert.equal(checked.receiptMatchCount, 1);

  // ...and the gates must turn that into a block, not merely record it.
  const gated = runExpenseGatesNode({
    request: secondRequest,
    employmentRes: employmentRes(EMPLOYMENTS.emp_active_001),
    expenseRes: expenseRes(EXPENSES.exp_dup_b_103),
    categoriesRes: categoriesRes(),
    duplicateRes: checked,
    llmRes: NO_LLM_RESPONSE,
  });
  assert.equal(gated.decision, "blocked");
  assert.equal(gated.reason, "duplicate_submission");
  assert.deepEqual(gated.flags, ["duplicate_submission"]);
  assert.equal(gated.writePayload, null, "a blocked duplicate must never compute an approve payload");
  assert.equal(gated.storeStatus, "blocked");

  // Parity: the real engine, given the same duplicate, reaches the same verdict.
  const classification = classifyExpenseRuleBased({
    expense: EXPENSES.exp_dup_b_103,
    categoryList: EXPENSE_CATEGORIES,
  });
  const real = evaluate({
    identityVerified: true,
    employmentActive: true,
    expense: EXPENSES.exp_dup_b_103,
    expenseOwned: true,
    duplicate: checked.duplicate,
    categoryValid: isCategoryFileable(EXPENSE_CATEGORIES, classification.categoryId),
    classification,
    policyCap: getPolicyCap(classification.categoryId),
  });
  assert.equal(gated.decision, real.decision);
  assert.equal(gated.reason, real.reason);
});

test("the FIRST filing of a receipt is not blocked — the negative half of the same proof", () => {
  // Without this, a gate that blocked everything would pass the test above.
  const context = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const checked = runCheckNode({ context, storedRows: [] });
  const gated = runExpenseGatesNode({
    request: requestFor(),
    employmentRes: employmentRes(EMPLOYMENTS.emp_active_001),
    expenseRes: expenseRes(EXPENSES.exp_dup_a_102),
    categoriesRes: categoriesRes(),
    duplicateRes: checked,
    llmRes: NO_LLM_RESPONSE,
  });
  assert.notEqual(gated.reason, "duplicate_submission");
  assert.equal(gated.decision, "auto_approve");
  assert.equal(gated.dedupeKey, context.derivedReceiptHash, "the key the persist node will store");
  assert.equal(gated.receiptHashSource, "derived");
  assert.equal(gated.storeStatus, "auto_approved");
});

test("a submitted hash matching a stored row takes precedence over the derived one", () => {
  // Mirrors src/uc02/workflow.js's `find(submitted) ?? find(derived)` order.
  const context = runDeriveNode({
    request: requestFor({ receiptHash: "hash-dup-1" }),
    expenseRes: expenseRes(EXPENSES.exp_dup_a_102),
  });
  const out = runCheckNode({
    context,
    storedRows: [
      storedRow({ id: "row-derived", receipt_hash: context.derivedReceiptHash, created_at: "2026-08-01T09:00:00Z" }),
      storedRow({ id: "row-submitted", receipt_hash: "hash-dup-1", created_at: "2026-08-02T09:00:00Z" }),
    ],
  });
  assert.equal(out.duplicateOfId, "row-submitted", "submitted hash wins even though it was stored later");
  assert.equal(out.duplicateMatchedOn, "submitted_receipt_hash");
  assert.equal(out.receiptMatchCount, 2);
});

test("the EARLIEST matching claim is the one reported as the original", () => {
  // §7 asks "which claim was this a duplicate OF" — the first one filed. The
  // Supabase node orders created_at.asc, so the first match in the array is it.
  const context = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const out = runCheckNode({
    context,
    storedRows: [
      storedRow({ id: "row-earliest", receipt_hash: context.derivedReceiptHash, created_at: "2026-08-01T09:00:00Z" }),
      storedRow({ id: "row-later", receipt_hash: context.derivedReceiptHash, created_at: "2026-08-05T09:00:00Z" }),
    ],
  });
  assert.equal(out.duplicateOfId, "row-earliest");
});

test("an unrelated stored row never reads as a duplicate", () => {
  const context = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const out = runCheckNode({
    context,
    storedRows: [storedRow({ id: "row-other", receipt_hash: "derived:0000000000000000000000000000dead" })],
  });
  assert.equal(out.duplicate, null);
  assert.equal(out.duplicateMatchedOn, null);
});

test("an errored lookup item is never read as a stored claim", () => {
  // If the query node ever hands this one an error payload, "could not look up"
  // must not silently become "inspected a row and found nothing".
  const context = runDeriveNode({ request: requestFor(), expenseRes: expenseRes(EXPENSES.exp_dup_a_102) });
  const out = runCheckNode({
    context,
    storedRows: [{ error: { message: "500 - upstream", status: 500 } }],
  });
  assert.equal(out.duplicate, null);
  assert.equal(out.receiptMatchCount, 0);
});
