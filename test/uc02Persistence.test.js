// ---------------------------------------------------------------------------
// uc02Persistence.test.js  —  UC-02's expense store, with and without a pgPool
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS MOSTLY POSITIVE ASSERTIONS
// `ExpenseStore` was in-memory only while the `uc02_expenses` table it needed
// already existed in Supabase (see expenseStore.js's header). The visible half
// of that defect is a missing row. The serious half is that §7's
// duplicate-receipt gate calls `findByReceiptHash()`, and in a serverless
// function in-process memory lasts exactly one request — so that lookup always
// returned null and the gate could not fire at all. It was not refusing
// correctly; it was incapable of succeeding.
//
// Every negative test in this repo passed throughout that entire period, and
// they had to: "correctly found no duplicate" and "cannot find a duplicate"
// emit byte-identical output. The only test that separates them is a POSITIVE
// one — file the same receipt twice and require the second to be blocked — and
// the second filing has to arrive at a store whose memory is cold, because
// that is what a fresh function invocation is. Test 1 below is that test, and
// it fails against the pre-fix store.
//
// The pool here is a fake that behaves like the real table (17 columns, the
// three real indexes' lookups, jsonb round-trips, NOT NULL on the two id
// columns). Hermetic: no network, no pg, no OpenAI — the classifier comes in
// through workflow.js's `classify` seam as everywhere else.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission, deriveReceiptFingerprint } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { AuditLogger } from "../src/shared/audit.js";

const fakeClassify = (args) => classifyExpenseRuleBased(args);
const session = { authenticatedEmploymentId: "emp_active_001" };

// ---------------------------------------------------------------------------
// A fake `uc02_expenses` (+ `workflow_claims`) that behaves like the real ones
// ---------------------------------------------------------------------------
// Deliberately NOT a `query: async () => ({rows: []})` stub. A stub that always
// answers "nothing here" would reproduce the exact bug under test and pass, so
// it has to actually store what it is given and answer the real WHERE clauses.
// It returns timestamps as Date objects and jsonb as JSON strings, which is the
// awkward end of what node-postgres hands back depending on driver/column
// combination — so normalizeRow()'s coercion is exercised rather than assumed.

function fakePostgres() {
  const expenses = [];
  const claims = new Set();
  const queries = [];

  const project = (row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expenseId: row.expense_id,
    employmentId: row.employment_id,
    storedReceiptHash: row.receipt_hash,
    decision: row.decision,
    reason: row.reason,
    flags: row.flags, // as a JSON string, on purpose — see above
    categoryId: row.category_id,
    categorySource: row.category_source,
    confidence: row.confidence,
    externalRef: row.external_ref,
    source: row.source,
    status: row.status,
    autoApprovedAt: row.auto_approved_at === null ? null : new Date(row.auto_approved_at),
    remoteResult: row.remote_result,
  });

  const pool = {
    async query(sql, params = []) {
      queries.push(sql.replace(/\s+/g, " ").trim());

      if (/^insert into workflow_claims/i.test(sql.trim())) {
        const key = `${params[0]}\u0000${params[1]}`; // escape, never a literal NUL: a raw control character makes git, grep and `file` treat this source as binary (CLAUDE.md §6)
        if (claims.has(key)) return { rows: [], rowCount: 0 }; // the PRIMARY KEY
        claims.add(key);
        return { rows: [{ external_ref: params[1] }], rowCount: 1 };
      }

      if (/^insert into uc02_expenses/i.test(sql.trim())) {
        const [
          id, created_at, updated_at, expense_id, employment_id, receipt_hash,
          decision, reason, flags, category_id, category_source, confidence,
          external_ref, source, status, auto_approved_at, remote_result,
        ] = params;
        // The four real NOT NULL columns without a default.
        for (const [name, value] of [["expense_id", expense_id], ["employment_id", employment_id], ["decision", decision], ["status", status]]) {
          if (value === null || value === undefined) {
            throw new Error(`null value in column "${name}" violates not-null constraint`);
          }
        }
        expenses.push({
          id, created_at, updated_at, expense_id, employment_id, receipt_hash,
          decision, reason, flags, category_id, category_source, confidence,
          external_ref, source, status, auto_approved_at, remote_result,
        });
        return { rows: [], rowCount: 1 };
      }

      if (/^update uc02_expenses/i.test(sql.trim())) {
        const [id, at, remote_result] = params;
        const row = expenses.find((r) => r.id === id);
        if (!row) return { rows: [], rowCount: 0 };
        row.status = "auto_approved";
        row.auto_approved_at = at;
        row.updated_at = at;
        row.remote_result = remote_result;
        return { rows: [], rowCount: 1 };
      }

      // listByOwner()'s query, which is the only one here with a WHERE that
      // grows: `employment_id = $1 [and source = $2] order by created_at desc
      // limit $n`. Answered properly rather than stubbed, for the same reason
      // as everything else in this fake — a stub returning [] would reproduce
      // the exact bug under test (an always-empty "My requests") and pass.
      if (/from uc02_expenses where employment_id = \$1/i.test(sql)) {
        const [employmentId] = params;
        const limit = params[params.length - 1];
        const source = /and source = \$2/i.test(sql) ? params[1] : null;
        const matches = expenses.filter(
          (r) => r.employment_id === employmentId && (source === null || r.source === source)
        );
        return { rows: [...matches].reverse().slice(0, limit).map(project) };
      }

      if (/from uc02_expenses/i.test(sql)) {
        const [value] = params;
        const column = /where id = \$1/i.test(sql) ? "id"
          : /where expense_id = \$1/i.test(sql) ? "expense_id"
          : /where external_ref = \$1/i.test(sql) ? "external_ref"
          : /where receipt_hash = \$1/i.test(sql) ? "receipt_hash"
          : null;
        assert.ok(column, `fake pg does not know this query: ${sql}`);
        const matches = expenses.filter((r) => r[column] === value);
        const ordered = /order by created_at desc/i.test(sql) ? [...matches].reverse() : matches;
        return { rows: ordered.slice(0, 1).map(project) };
      }

      throw new Error(`fake pg does not know this statement: ${sql}`);
    },
  };

  return { pool, expenses, queries };
}

// ---------------------------------------------------------------------------
// A fake Remote returning the same real-world claim under any expense id — the
// shape `deriveReceiptFingerprint()` hashes. Copied in intent from
// test/uc02.test.js's F-24 twin test so the two prove the same thing on the two
// different execution paths (one process vs. two).
// ---------------------------------------------------------------------------

function expenseRecord(id, overrides = {}) {
  return {
    id,
    employment_id: "emp_active_001",
    status: "pending",
    title: "Team lunch after the weekly sync",
    amount: 4500, // ×100-scaled minor units, and never persisted by the store
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
    receipts: [{ id: `file-${id}`, name: "receipt.pdf", type: "expense", inserted_at: "2026-06-26T14:49:21Z", sub_type: null }],
    reason: null,
    notes: null,
    invoice_period: null,
    ...overrides,
  };
}

function fakeRemote(record) {
  return {
    async getEmployment() {
      return { id: "emp_active_001", status: "active", email: "amara@acme.test" };
    },
    async getExpense() {
      return record;
    },
    async getExpenseCategories() {
      return [{
        code: "work_meals_and_entertainment.internal_meals_and_entertainment",
        title: "Internal meals and entertainment",
        description: "Meals or gatherings with colleagues for team-building or other work-related purposes.",
        status: "active", is_selectable: true, parent: { code: "work_meals_and_entertainment" },
        scope: "global", slug: "e2f225f6-05e8-4538-94f0-0c4fe3073ac7", instructions: null, prompt: null,
      }];
    },
    async patchExpenseStatus(expenseId) {
      return { id: expenseId, status: "approved" };
    },
  };
}

/** One submission through the REAL workflow, against one store instance. */
function submit(expenseStore, { expenseId, record = null, ...rest }) {
  return handleExpenseSubmission(
    { expenseId, employmentId: "emp_active_001", session, ...rest },
    {
      remote: fakeRemote(record ?? expenseRecord(expenseId)),
      audit: new AuditLogger(),
      expenseStore,
      classify: fakeClassify,
    }
  );
}

// ---------------------------------------------------------------------------
// 1. THE POSITIVE TEST. The one that detects a gate that cannot fire.
// ---------------------------------------------------------------------------

test("1. the same receipt filed twice, the second by a store with COLD memory -> blocked as a duplicate", async () => {
  const pg = fakePostgres();

  // First invocation: its own store instance, as a serverless function gets.
  const first = await submit(new ExpenseStore({ pgPool: pg.pool }), {
    expenseId: "exp_twin_a",
    receiptHash: "receipt-hash-shared",
  });
  assert.equal(first.decision, "auto_approve");
  assert.equal(pg.expenses.length, 1, "the decision reached the uc02_expenses table");

  // Second invocation: a BRAND NEW store, sharing only the database. Its
  // `expenses` array is empty, exactly as it is on every request to the
  // deployed function — so the only way the duplicate can be seen is a read
  // that goes through to Postgres.
  const cold = new ExpenseStore({ pgPool: pg.pool });
  assert.equal(cold.list().length, 0, "the second invocation starts with no memory of the first");

  const second = await submit(cold, {
    expenseId: "exp_twin_b", // a different expense record carrying the same receipt
    receiptHash: "receipt-hash-shared",
  });

  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "duplicate_submission");
  assert.ok(second.flags.includes("duplicate_submission"));
});

test("1b. and the pre-fix behaviour is the control: with no pool, the cold store cannot see it", async () => {
  // Not a demonstration that the unpooled store is wrong — it is correct for a
  // long-lived process. It is the proof that test 1 passes because of the read
  // -through and nothing else: same inputs, same fresh-instance timing, pool
  // removed, opposite verdict.
  const pg = fakePostgres();
  await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_twin_a", receiptHash: "receipt-hash-shared" });

  const second = await submit(new ExpenseStore(), {
    expenseId: "exp_twin_b",
    receiptHash: "receipt-hash-shared",
  });
  assert.equal(second.decision, "auto_approve", "a claim already paid would have been paid a second time");
});

test("1c. F-24 survives the process boundary: filed once WITH a hash, once WITHOUT -> still blocked", async () => {
  // The derived fingerprint is what the one `receipt_hash` column stores, so
  // the two filings agree on a key even though only one of them supplied one.
  const pg = fakePostgres();
  await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_twin_a", receiptHash: "receipt-hash-shared" });

  const second = await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_twin_b" });
  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "duplicate_submission");
});

test("1d. THE DOCUMENTED GAP, pinned so it stays known: same submitted hash, different claim details", async () => {
  // Two claims whose record fields differ produce different derived
  // fingerprints, and the table has ONE hash column, so cross-process they are
  // matched on nothing. In-process they still collide on the submitted hash
  // (asserted below), which is why this is a narrow gap rather than a hole.
  //
  // Closing it is a provisioning step, not a code change — a
  // `derived_receipt_hash text` column plus an index, after which `receipt_hash`
  // holds the submitted hash and both are queried. See
  // docs/SETUP-CHECKLIST.md and expenseStore.js's header.
  const pg = fakePostgres();
  const differentClaim = expenseRecord("exp_other_b", { amount: 7700, converted_amount: 7700, title: "Client dinner" });

  await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_other_a", receiptHash: "receipt-hash-shared" });
  const crossProcess = await submit(new ExpenseStore({ pgPool: pg.pool }), {
    expenseId: "exp_other_b",
    record: differentClaim,
    receiptHash: "receipt-hash-shared",
  });
  assert.notEqual(crossProcess.decision, "blocked", "known limitation of the single hash column");

  const oneProcess = new ExpenseStore({ pgPool: pg.pool });
  await submit(oneProcess, { expenseId: "exp_other_c", receiptHash: "receipt-hash-shared" });
  const sameProcess = await submit(oneProcess, {
    expenseId: "exp_other_d",
    record: expenseRecord("exp_other_d", { amount: 7700, converted_amount: 7700, title: "Client dinner" }),
    receiptHash: "receipt-hash-shared",
  });
  assert.equal(sameProcess.decision, "blocked", "in one process, the submitted hash still collides");
});

// ---------------------------------------------------------------------------
// 2. Read-through on the lookups a Finance Ops surface actually uses
// ---------------------------------------------------------------------------

test("2. a human_review decision is retrievable by ticket AND by id from a store that never saw it", async () => {
  // The user-reported symptom: an over-policy-cap claim submitted through the
  // deployed portal came back `human_review` and then existed nowhere a
  // specialist could open it.
  const pg = fakePostgres();
  const overCap = expenseRecord("exp_over_cap_9", { amount: 900000, converted_amount: 900000, tax_amount: 0, converted_tax_amount: 0 });

  const submitted = await submit(new ExpenseStore({ pgPool: pg.pool }), {
    expenseId: "exp_over_cap_9",
    record: overCap,
    externalRef: "ticket-9001",
    source: "portal",
  });
  assert.equal(submitted.decision, "human_review");

  const cold = new ExpenseStore({ pgPool: pg.pool });
  const byTicket = await cold.findByExternalRef("ticket-9001");
  assert.ok(byTicket, "GET /api/expenses/by-ticket/:ref can find it");
  assert.equal(byTicket.id, submitted.storeId);
  assert.equal(byTicket.decision, "human_review");
  assert.equal(byTicket.status, "flagged");
  assert.equal(byTicket.employmentId, "emp_active_001");
  assert.deepEqual(byTicket.flags, submitted.flags, "jsonb round-trips back to an array");

  const byId = await cold.findById(submitted.storeId);
  assert.equal(byId.id, submitted.storeId);

  const byExpenseId = await cold.findByExpenseId("exp_over_cap_9");
  assert.equal(byExpenseId.id, submitted.storeId);
});

test("2b. a row read back from Postgres is split into the right hash field, never mislabelled", async () => {
  const pg = fakePostgres();
  const submitted = await submit(new ExpenseStore({ pgPool: pg.pool }), {
    expenseId: "exp_twin_a",
    receiptHash: "receipt-hash-shared",
    externalRef: "ticket-9002",
  });

  const cold = await new ExpenseStore({ pgPool: pg.pool }).findByExternalRef("ticket-9002");
  assert.equal(cold.derivedReceiptHash, deriveReceiptFingerprint(expenseRecord("exp_twin_a")));
  assert.equal(cold.receiptHashSource, "derived");
  assert.equal(cold.receiptHash, null, "the stored value is the derived fingerprint and says so");
  assert.equal(typeof cold.createdAt, "string", "timestamps come back as ISO strings, like an in-memory row");
  assert.equal(cold.autoApprovedAt !== undefined, true);
  assert.equal(submitted.decision, "auto_approve");
});

test("2c. no money is persisted — the store's columns carry ids and verdicts only", async () => {
  // UC-02 amounts are ×100-scaled integers (src/shared/money.js). A value that
  // never passes through this layer can never be rescaled by it, so this is a
  // structural assertion rather than a round-trip one.
  const pg = fakePostgres();
  await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_twin_a" });

  const [row] = pg.expenses;
  const persisted = JSON.stringify(row);
  for (const moneyField of ["4500", "375", "amount", "currency", "tax"]) {
    assert.ok(!persisted.includes(moneyField), `no money reached uc02_expenses (${moneyField})`);
  }
});

// ---------------------------------------------------------------------------
// 3. Write ordering and the unconfigured default
// ---------------------------------------------------------------------------

test("3. the approval UPDATE never overtakes its own INSERT", async () => {
  // Unlike every sibling store, UC-02's later mutation fires microseconds after
  // the fire-and-forget insert, in the SAME request. Without markAutoApproved()
  // flushing first, the UPDATE can match zero rows and the approval silently
  // fails to persist while everything reports success.
  const pg = fakePostgres();
  const store = new ExpenseStore({ pgPool: pg.pool });
  const r = await submit(store, { expenseId: "exp_twin_a" });
  assert.equal(r.decision, "auto_approve");

  const insertAt = pg.queries.findIndex((q) => q.startsWith("insert into uc02_expenses"));
  const updateAt = pg.queries.findIndex((q) => q.startsWith("update uc02_expenses"));
  assert.ok(insertAt !== -1 && updateAt !== -1);
  assert.ok(insertAt < updateAt, "insert is issued before the update");

  const cold = await new ExpenseStore({ pgPool: pg.pool }).findById(r.storeId);
  assert.equal(cold.status, "auto_approved");
  assert.ok(cold.autoApprovedAt, "the approval timestamp is durable");
  assert.deepEqual(cold.remoteResult, { id: "exp_twin_a", status: "approved" });
});

test("4. with no pgPool the store behaves exactly as it always did — hermetic, in-memory, no queries", async () => {
  const store = new ExpenseStore();
  assert.equal(store.pgPool, null);

  const r = await submit(store, { expenseId: "exp_twin_a", receiptHash: "rh-1", externalRef: "ticket-9003" });
  assert.equal(r.decision, "auto_approve");

  assert.equal(store.list().length, 1);
  assert.equal((await store.findById(r.storeId)).id, r.storeId);
  assert.equal((await store.findByExternalRef("ticket-9003")).id, r.storeId);
  assert.equal((await store.findByExpenseId("exp_twin_a")).id, r.storeId);
  assert.equal((await store.findByReceiptHash("rh-1")).id, r.storeId);

  // Misses answer null rather than reaching for a database that is not there.
  assert.equal(await store.findById("nope"), null);
  assert.equal(await store.findByExternalRef("nope"), null);
  assert.equal(await store.findByExpenseId("nope"), null);
  assert.equal(await store.findByReceiptHash("nope"), null);
  assert.equal(await store.findByReceiptHash(null), null);

  // And in-process dedupe is unchanged.
  const second = await submit(store, { expenseId: "exp_twin_b", receiptHash: "rh-1" });
  assert.equal(second.decision, "blocked");
  assert.equal(second.reason, "duplicate_submission");
});

// ---------------------------------------------------------------------------
// 2d — "My requests", from a store whose memory is cold
// ---------------------------------------------------------------------------
// The other half of test 2's user report. A specialist could not find the
// claim; neither could the person who filed it. `GET /api/my-requests` read a
// process-local array, so on the deployment — where a fresh process is built
// per request — it was always empty, and the requester never saw that their
// claim had been decided at all. This is the POSITIVE test for the fix: the
// listing store never saw the submission and must still find it.
// ---------------------------------------------------------------------------

test("2d. a requester's own claims are listed by a store with COLD memory, scoped to them", async () => {
  const pg = fakePostgres();
  const warm = new ExpenseStore({ pgPool: pg.pool });
  const mine = await submit(warm, { expenseId: "exp_mine_1", externalRef: "ticket-9101", source: "portal" });
  await submit(warm, { expenseId: "exp_mine_2", externalRef: "ticket-9102", source: "portal" });

  // Somebody else's claim, and one of the requester's own filed from a
  // different intake surface. Neither belongs in "what I filed here".
  warm.createExpense({
    expenseId: "exp_theirs",
    employmentId: "emp_someone_else",
    decision: "human_review",
    reason: "over_policy_cap",
    flags: [],
    source: "portal",
  });
  warm.createExpense({
    expenseId: "exp_from_zendesk",
    employmentId: "emp_active_001",
    decision: "human_review",
    reason: "over_policy_cap",
    flags: [],
    source: "zendesk",
  });
  await warm.flush();

  const cold = new ExpenseStore({ pgPool: pg.pool });
  assert.equal(cold.expenses.length, 0, "the listing store genuinely never saw any of this");

  const listed = await cold.listByOwner({ employmentId: "emp_active_001", source: "portal", limit: 25 });
  assert.equal(listed.length, 2);
  assert.deepEqual(
    listed.map((r) => r.expenseId),
    ["exp_mine_2", "exp_mine_1"],
    "newest first"
  );
  assert.ok(listed.every((r) => r.employmentId === "emp_active_001"));
  assert.ok(listed.some((r) => r.id === mine.storeId));
  // jsonb and timestamps come back through normalizeRow(), exactly as
  // findById() does — the portal's describeStatus() reads camelCase fields
  // only that function produces.
  assert.ok(Array.isArray(listed[0].flags));
  assert.equal(typeof listed[0].createdAt, "string");

  // Fails closed rather than listing everybody.
  assert.deepEqual(await cold.listByOwner({}), []);
  // And a requester scope matches nothing here: uc02_expenses has no such
  // column, and saying "nothing" is not the same as ignoring the filter.
  assert.deepEqual(await cold.listByOwner({ requester: "admin_jane" }), []);
});

test("5. list() stays process-local, like every sibling store's list()", async () => {
  // Not an oversight: deploy/cx-apis/router.js answers this route on the
  // deployment with an explicit "that list is process-local" message rather
  // than an empty array that reads like an answer.
  const pg = fakePostgres();
  await submit(new ExpenseStore({ pgPool: pg.pool }), { expenseId: "exp_twin_a" });
  assert.equal(new ExpenseStore({ pgPool: pg.pool }).list().length, 0);
});
