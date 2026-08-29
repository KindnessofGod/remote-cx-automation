// ---------------------------------------------------------------------------
// uc02Categories.test.js — the expense-category gate, against the REAL endpoint
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// UC-02 used to call `GET /v1/employee/expense-categories`, which 403s for this
// service and always will. That endpoint is titled "List expense categories for
// the authenticated EMPLOYEE": its `security` block is `OAuth2Assertion` over
// an employee session. This automation is an unattended system actor holding a
// company `CustomerAPIToken`, so it structurally cannot satisfy that — no
// credential change can fix it. The company-side equivalent is
// `GET /v1/expenses/categories`, whose `security` block is exactly
// `CustomerAPIToken`/`OAuth2AuthorizationCode`.
//
// Verified live 2026-08-17 against gateway.remote-sandbox.com with the token in
// REMOTE_API_TOKEN:
//   GET /v1/employee/expense-categories                    -> 403
//   GET /v1/expenses/categories?employment_id=3537d9ee-…   -> 200, 32 rows
//   GET /v1/expenses/categories?country_code=ESP           -> 200, 32 rows
//   GET /v1/expenses/categories?country_code=ES            -> 422 (alpha-2!)
//   GET /v1/expenses/categories                            -> 422 (no filter)
//
// THE SECOND, DEEPER BUG THIS FILE PINS. The gate read
// `categoryList.some(c => c.id === classification.categoryId)`. Real category
// rows have NO `id` FIELD AT ALL — they are keyed by `code`, and also carry
// `parent`, `scope`, `status` and `is_selectable`. So even had the endpoint
// answered 200, that comparison could never be true: every claim would have
// reported `category_unverified` forever. UC-02 was dead in two independent
// ways, and every fail-closed test still passed — the exact failure mode
// CLAUDE.md §5 names ("only a positive test detects it"). Hence test 1 below.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer, EXPENSE_CATEGORIES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import {
  isSelectableCategory,
  selectableCategories,
  findSelectableCategory,
} from "../src/uc02/expenseCategories.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4091); // test band (4090–4099); see src/shared/ports.js
  remote = new RemoteClient({ baseUrl: "http://localhost:4091" });
});
after(() => server && server.close());

let audit;
let expenseStore;
beforeEach(() => {
  audit = new AuditLogger();
  expenseStore = new ExpenseStore();
});

const fakeClassify = (args) => classifyExpenseRuleBased(args);
const session = { authenticatedEmploymentId: "emp_active_001" };

// A well-formed, in-policy claim. Every field is deliberately valid so that the
// ONLY thing under test is the category gate — if this stops auto-approving,
// something in the category path broke.
// The REAL Remote expense shape (see src/uc02/policyEngine.js's header for why
// `total_amount`/`lines`/`category_id` are gone — none of them exist on a real
// record). Note there is no `category_id` override hook any more: the record's
// own category namespace is disjoint from the selectable list's, so a test that
// wants a particular classification sets the TITLE the matcher reads.
const goodExpense = (over = {}) => ({
  id: "exp_cat_pos",
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
  receipts: [{ id: "9c1b0f77-cccc-4bbb-8ccc-0d1e2f3a4b5c", name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }],
  reason: null,
  notes: null,
  invoice_period: null,
  ...over,
});

/**
 * A fake RemoteClient whose ONLY variable is the category list it serves, so
 * each test below isolates one property of the category gate. Records the
 * arguments getExpenseCategories() was called with, and every write.
 */
function remoteServing(categories, expenseOver = {}) {
  const client = {
    writes: [],
    categoryCalls: [],
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test", country_code: "ESP" };
    },
    async getExpense() {
      return goodExpense(expenseOver);
    },
    async getExpenseCategories(args) {
      client.categoryCalls.push(args ?? null);
      return categories;
    },
    async patchExpenseStatus(id, body) {
      client.writes.push({ id, body });
      return { id, status: "approved" };
    },
  };
  return client;
}

const submit = (deps, over = {}) =>
  handleExpenseSubmission(
    { expenseId: "exp_cat_pos", employmentId: "emp_active_001", session, ...over },
    { remote: deps, audit, expenseStore, classify: fakeClassify }
  );

// A verbatim slice of the LIVE response, so these fixtures cannot drift into
// agreeing with the code instead of with the API.
const LIVE_LEAF = {
  code: "work_meals_and_entertainment.internal_meals_and_entertainment",
  parent: {
    code: "work_meals_and_entertainment",
    title: "Work meals and entertainment",
    slug: "7f655db0-91c1-4b92-ae76-18dc9d3ec883",
  },
  scope: "global",
  status: "active",
  instructions: null,
  description:
    "Meals or gatherings with colleagues for team-building or other work-related purposes.\nAdd reason and list of participants.",
  title: "Internal meals and entertainment",
  prompt: null,
  slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7",
  is_selectable: true,
};

const LIVE_PARENT = {
  code: "work_meals_and_entertainment",
  parent: null,
  scope: "global",
  status: "active",
  instructions: null,
  description: "Meals and gatherings related to work. Include reason and names of participants when applicable.",
  title: "Work meals and entertainment",
  prompt: null,
  slug: "7f655db0-91c1-4b92-ae76-18dc9d3ec883",
  is_selectable: false,
};

// ---------------------------------------------------------------------------
// 1. THE POSITIVE TEST. Non-negotiable — see the file header.
// ---------------------------------------------------------------------------

test("1. a valid, selectable, active category on a well-formed claim reaches auto_approve and a real write", async () => {
  const r = await submit(remoteServing([LIVE_LEAF]));
  assert.equal(r.decision, "auto_approve", `expected auto_approve, got ${r.decision}/${r.reason}`);
  assert.equal(r.reason, "all_gates_passed");
  assert.deepEqual(r.flags, []);
  assert.equal(r.categoryId, LIVE_LEAF.code, "the classification must be keyed by the API's own `code`");
});

test("1b. …and the same claim auto-approves through the MOCK SERVER's category route, not just a fake", async () => {
  // The mock is the fixture the whole suite (and n8n parity) runs on. If it
  // serves an invented shape, every test agrees with the code rather than with
  // the API — how the alpha-3 country bug survived for months.
  const r = await handleExpenseSubmission(
    { expenseId: "exp_auto_101", employmentId: "emp_active_001", session },
    { remote, audit, expenseStore, classify: fakeClassify }
  );
  assert.equal(r.decision, "auto_approve", `expected auto_approve, got ${r.decision}/${r.reason}`);
  assert.equal(r.categoryId, "work_meals_and_entertainment.internal_meals_and_entertainment");
});

// ---------------------------------------------------------------------------
// 2. The endpoint itself — right URL, required discriminator
// ---------------------------------------------------------------------------

test("2. the client calls the COMPANY-side /v1/expenses/categories, never the employee endpoint", async () => {
  const paths = [];
  const recording = new RemoteClient({ baseUrl: "http://localhost:4091", token: "t" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    paths.push(String(url));
    return realFetch(url, init);
  };
  try {
    await recording.getExpenseCategories({ employmentId: "emp_active_001" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\/v1\/expenses\/categories\?employment_id=emp_active_001$/);
  assert.doesNotMatch(paths[0], /employee/, "the employee-authenticated endpoint 403s for a company token, always");
});

test("2b. a call with NEITHER discriminator is impossible by construction — it throws before any HTTP request", async () => {
  // The endpoint REQUIRES one of employment_id / expense_id / country_code and
  // answers 422 without one (verified live). A 422 at runtime would surface as
  // an upstream failure and escalate a claim that had nothing wrong with it, so
  // the call is refused here instead of being made and failing.
  let fetched = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => {
    fetched = true;
    return realFetch(...a);
  };
  try {
    await assert.rejects(
      () => new RemoteClient({ baseUrl: "http://localhost:4091" }).getExpenseCategories({}),
      /employmentId or countryCode/i
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, false, "no request may be issued when no discriminator is available");
});

test("2c. countryCode must be ISO alpha-3 — an alpha-2 is refused here, because the API answers 422", async () => {
  // `?country_code=ES` -> 422 {"errors":{"country_code":["is invalid"]}} live.
  // This repo has already shipped one alpha-2/alpha-3 confusion to production
  // (UC-03's supported-countries gate), and `employment.country_code` is
  // populated by a normalizer that still falls back to the alpha-3 `code`.
  await assert.rejects(
    () => new RemoteClient({ baseUrl: "http://localhost:4091" }).getExpenseCategories({ countryCode: "ES" }),
    /alpha-3/i
  );
});

test("2d. the mock server refuses a discriminator-less call the same way the real API does (422)", async () => {
  const res = await fetch("http://localhost:4091/v1/expenses/categories");
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.errors?.employment_id, "the mock must teach the real contract, not a friendlier one");
});

test("2e. the mock server still 403s the EMPLOYEE endpoint, exactly as the live API does", async () => {
  const res = await fetch("http://localhost:4091/v1/employee/expense-categories");
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { message: "Forbidden, invalid role for this endpoint" });
});

// ---------------------------------------------------------------------------
// 3. The row shape — real fields, and the fixture must match the live response
// ---------------------------------------------------------------------------

test("3. getExpenseCategories returns the flat array the real API returns, not a {categories:[…]} wrapper", async () => {
  const list = await remote.getExpenseCategories({ employmentId: "emp_active_001" });
  assert.ok(Array.isArray(list), "the real envelope is {data:[…]}, so the client hands back an array");
  assert.ok(list.length > 0);
});

test("3b. every mock category row carries exactly the live field set (no invented `id`/`name`)", () => {
  const LIVE_FIELDS = [
    "code",
    "description",
    "instructions",
    "is_selectable",
    "parent",
    "prompt",
    "scope",
    "slug",
    "status",
    "title",
  ];
  for (const row of EXPENSE_CATEGORIES) {
    assert.deepEqual(Object.keys(row).sort(), LIVE_FIELDS, `row ${row.code} does not match the live field set`);
    assert.equal("id" in row, false, "the real API has no `id` on a category row — inventing one is what broke the gate");
    assert.equal("name" in row, false, "the real field is `title`");
  }
});

// ---------------------------------------------------------------------------
// 4. Selectability + status — the fail-closed half
// ---------------------------------------------------------------------------

test("4. a category code that is NOT in the fetched list never validates -> human_review, no write", async () => {
  // The gate's whole purpose: a classifier handing over an invented code must
  // not reach a reimbursement write. Injected directly rather than hoped for
  // from the rule-based path, because this is the LLM-hallucination case and
  // the rule-based classifier cannot produce it by construction.
  const remoteDep = remoteServing([LIVE_LEAF]);
  const r = await handleExpenseSubmission(
    { expenseId: "exp_cat_pos", employmentId: "emp_active_001", session },
    {
      remote: remoteDep,
      audit,
      expenseStore,
      classify: async () => ({
        categoryId: "business_travel.invented_by_a_model",
        reason: "hallucinated",
        confidence: 0.99, // high confidence must not buy its way past a gate
        source: "llm",
      }),
    }
  );
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "category_unverified");
  assert.equal(remoteDep.writes.length, 0, "an invented category must never reach the real PATCH");
});

test("4a. a category the employee cannot select never validates, even at 0.99 confidence", async () => {
  // Same injection, but the code IS real — it just names a parent heading.
  const remoteDep = remoteServing([LIVE_PARENT, LIVE_LEAF]);
  const r = await handleExpenseSubmission(
    { expenseId: "exp_cat_pos", employmentId: "emp_active_001", session },
    {
      remote: remoteDep,
      audit,
      expenseStore,
      classify: async () => ({
        categoryId: LIVE_PARENT.code,
        reason: "a real code, but a heading",
        confidence: 0.99,
        source: "llm",
      }),
    }
  );
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "category_unverified");
  assert.equal(remoteDep.writes.length, 0);
});

test("4b. an INACTIVE category does not validate, even though its code matches -> human_review, no write", async () => {
  const remoteDep = remoteServing([{ ...LIVE_LEAF, status: "inactive" }]);
  const r = await submit(remoteDep);
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "category_unverified");
  assert.equal(remoteDep.writes.length, 0, "a retired category must never reach a reimbursement write");
});

test("4c. a NON-SELECTABLE parent node does not validate -> human_review, no write", async () => {
  // `include_parents=true` returns parent nodes with is_selectable:false. An
  // employee cannot file against one, so approving a claim classified into one
  // would be approving something the platform itself would reject.
  const remoteDep = remoteServing([LIVE_PARENT], { title: LIVE_PARENT.title });
  const r = await submit(remoteDep);
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "category_unverified");
  assert.equal(remoteDep.writes.length, 0);
});

test("4d. a row missing is_selectable or status entirely is NOT selectable (fails closed on an unknown)", () => {
  assert.equal(isSelectableCategory({ code: "a.b", status: "active" }), false);
  assert.equal(isSelectableCategory({ code: "a.b", is_selectable: true }), false);
  assert.equal(isSelectableCategory({ code: "a.b", status: "active", is_selectable: "true" }), false);
  assert.equal(isSelectableCategory({ status: "active", is_selectable: true }), false);
  assert.equal(isSelectableCategory(null), false);
  assert.equal(isSelectableCategory(LIVE_LEAF), true);
});

test("4e. selectableCategories/findSelectableCategory never return a parent or an inactive row", () => {
  const list = [LIVE_PARENT, LIVE_LEAF, { ...LIVE_LEAF, code: "x.y", status: "inactive" }];
  assert.deepEqual(
    selectableCategories(list).map((c) => c.code),
    [LIVE_LEAF.code]
  );
  assert.equal(findSelectableCategory(list, LIVE_PARENT.code), null);
  assert.equal(findSelectableCategory(list, "x.y"), null);
  assert.equal(findSelectableCategory(list, LIVE_LEAF.code)?.code, LIVE_LEAF.code);
  // A prototype key must not resolve through the lookup (the F-12b lesson).
  assert.equal(findSelectableCategory(list, "constructor"), null);
});

test("4f. the classifier is only ever offered categories the employee could actually file against", () => {
  // Defence in depth on the other side of the gate: a model shown a parent node
  // can propose one. Never showing it removes the precondition.
  const r = classifyExpenseRuleBased({
    expense: goodExpense({ title: LIVE_PARENT.title }),
    categoryList: [LIVE_PARENT],
  });
  assert.equal(r.categoryId, null, "a non-selectable parent must never be proposed");
});

// ---------------------------------------------------------------------------
// 5. Upstream failure — a list we never received cannot validate anything
// ---------------------------------------------------------------------------

test("5. a failed category fetch escalates as an upstream failure, never as `category_unverified`", async () => {
  const remoteDep = remoteServing(null); // RemoteClient's 404 convention
  const r = await submit(remoteDep);
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "upstream_record_not_found");
  assert.ok(r.flags.includes("upstream_expense_categories_404"));
  assert.equal(remoteDep.writes.length, 0);
});

test("5b. the workflow passes the employment id as the discriminator (per-employee visibility)", async () => {
  const remoteDep = remoteServing([LIVE_LEAF]);
  await submit(remoteDep);
  assert.deepEqual(remoteDep.categoryCalls, [
    { employmentId: "emp_active_001", countryCode: "ESP" },
  ]);
});
