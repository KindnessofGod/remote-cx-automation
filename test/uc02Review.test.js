// ---------------------------------------------------------------------------
// uc02Review.test.js  —  UC-02.md §6's Finance Ops decision on a flagged claim
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS FOR, AND WHY THE POSITIVE TESTS COME FIRST
//
// Before this pass, a flagged UC-02 claim was unresolvable. `view()` reported
// `actionable: false` unconditionally, no approve/deny route existed, and the
// spec's own §6 flow ("route to Finance Ops (ZAF) -> PATCH status: declined
// (with reason) or hold") had no implementation. Every fail-closed assertion in
// test/uc02.test.js passed throughout — because refusing correctly and being
// structurally unable to succeed produce identical output from outside. That is
// this repository's most expensive recurring lesson (CLAUDE.md §4/§5), and the
// only thing that detects it is a MUST-SUCCEED test.
//
// So tests 1 and 2 are the load-bearing ones: a flagged claim MUST be
// releasable and MUST be declinable by a properly-identified reviewer, and each
// must produce the real Remote write with the exact body Remote's own `oneOf`
// accepts — proven against the mock server's live `oneOf` validator, not
// against a fake that would agree with whatever we sent it.
//
// The refusals (tests 5-13) matter too, but on their own they would prove
// nothing at all.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { startMockServer, EXPENSES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission, submitExpenseReview } from "../src/uc02/workflow.js";
import { createUc02Handler } from "../src/uc02/server.js";
import {
  evaluateExpenseActionability,
  evaluateReviewAction,
  statusForAction,
  ACTIONS,
  TERMINAL_ACTIONS,
  REFUSALS,
  describeSettled,
  describeNoReviewPath,
  describeOutcome,
} from "../src/uc02/reviewPolicy.js";
import { describeDecidingGate, describeGateLadder, describeCapComparison, GATE_SEQUENCE, CONFIDENCE_GATE_POSITION } from "../src/uc02/policyEngine.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { classifyRisk } from "../src/shared/riskEngine.js";

let server;
let remote;

before(async () => {
  // 4103 — this file's own port, allocated in src/shared/ports.js TEST_PORTS.
  // It was 4092 until that was found to be restClientRetry.test.js's zendeskFlaky
  // socket as well — see test/ports.test.js.
  // (4070-4089 is reserved for the CLIs' seed mocks, so a test must stay out).
  server = await startMockServer(4103);
  remote = new RemoteClient({ baseUrl: "http://localhost:4103" });
});
after(() => server && server.close());

let audit;
let expenseStore;

// THE MOCK'S EXPENSE FIXTURES ARE MUTATED BY A REAL PATCH, and that is correct
// — `PATCH /v1/expenses/:id` is a state change, and a mock that pretended
// otherwise could not prove the state changed. But EXPENSES is one module-level
// object shared by every mock server in this process, so once test 1 approves
// `exp_over_cap_201` the fixture is no longer `pending` and every later
// submission is `blocked / expense_not_pending` — a cascade of failures whose
// stated reason ("this claim must be flagged") points at the wrong thing
// entirely. Snapshot the three fields PATCH writes, and restore them per test.
const FIXTURE_SNAPSHOT = new Map(
  Object.entries(EXPENSES).map(([id, e]) => [id, { status: e.status, reason: e.reason, reviewed_at: e.reviewed_at }])
);

beforeEach(() => {
  audit = new AuditLogger();
  expenseStore = new ExpenseStore();
  for (const [id, snap] of FIXTURE_SNAPSHOT) Object.assign(EXPENSES[id], snap);
});

// The rule-based classifier, injected — never a real, retried OpenAI call from
// a suite that does not care what the category is (CLAUDE.md §6).
const classify = (args) => classifyExpenseRuleBased(args);

const session = { authenticatedEmploymentId: "emp_active_001" };

/**
 * Submit a claim that the gates flag for a human. `exp_over_cap_201` breaches
 * the internal-meals policy cap, which is §8's "amount over policy cap -> HITL"
 * — a `human_review` decision, not a hard stop.
 */
async function flaggedClaim({ expenseId = "exp_over_cap_201", employmentId = "emp_active_001", ...rest } = {}) {
  const result = await handleExpenseSubmission(
    {
      expenseId,
      employmentId,
      session: { authenticatedEmploymentId: employmentId },
      externalRef: `ticket-review-${expenseId}`,
      source: "test",
      ...rest,
    },
    { remote, audit, expenseStore, classify }
  );
  assert.equal(result.decision, "human_review", "fixture precondition: this claim must be flagged");
  return result;
}

/**
 * A Remote double that records every write, so a test can assert the EXACT
 * body sent rather than merely that something was sent. `getEmployment` is
 * answerable per-test, which is how the freshness re-check is exercised
 * without needing a fixture whose status changes mid-suite.
 */
function fakeRemote({ employmentStatus = "active" } = {}) {
  const calls = [];
  return {
    calls,
    async getEmployment(id) {
      calls.push({ call: "getEmployment", id });
      return employmentStatus === null ? null : { id, status: employmentStatus, company_id: "co_1" };
    },
    async patchExpenseStatus(id, body) {
      calls.push({ call: "patchExpenseStatus", id, body });
      return { id, status: body.status, reason: body.reason ?? null, reviewed_at: "2026-08-19" };
    },
  };
}

// ---------------------------------------------------------------------------
// 1 + 2 — THE POSITIVE TESTS. Read the file header before changing either.
// ---------------------------------------------------------------------------

test("POSITIVE: a flagged claim CAN be released by an identified reviewer, and Remote really approves it", async () => {
  const claim = await flaggedClaim();

  // Precondition, stated rather than assumed: the claim is open to a human.
  const beforeRow = await expenseStore.findById(claim.storeId);
  assert.equal(beforeRow.status, "flagged");
  assert.equal(evaluateExpenseActionability({ expenseRow: beforeRow }).allowed, true);

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com", note: "Offsite pre-approved by the VP." },
    { remote, audit, expenseStore }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.code, "approved");

  // The REAL Remote record moved — checked by reading it back through the same
  // client, not by trusting the return value of the call that changed it.
  const expense = await remote.getExpense("exp_over_cap_201");
  assert.equal(expense.status, "approved");
  assert.equal(expense.reviewed_at !== null, true);

  // The store row carries who decided, what, and when.
  const row = await expenseStore.findById(claim.storeId);
  assert.equal(row.status, "approved");
  assert.equal(row.reviewAction, "approve");
  assert.equal(row.reviewer, "fin.ops@remote.com");
  assert.equal(row.reviewNote, "Offsite pre-approved by the VP.");
  assert.equal(typeof row.reviewedAt, "string");

  // And it is no longer actionable — a released claim cannot be re-decided.
  assert.equal(evaluateExpenseActionability({ expenseRow: row }).allowed, false);
});

test("POSITIVE: a flagged claim CAN be declined with a reason, and Remote really declines it", async () => {
  const claim = await flaggedClaim({
    expenseId: "exp_sandbox_over_cap_402",
    employmentId: "8ab12460-b568-4c1e-af9d-09b1fabd8f46",
  });

  const result = await submitExpenseReview(
    {
      storeId: claim.storeId,
      action: "decline",
      reviewer: "fin.ops@remote.com",
      note: "Whole-department dinner is not reimbursable under the meals policy.",
    },
    { remote, audit, expenseStore }
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, "declined");

  // The mock enforces Remote's real `oneOf`: a decline WITHOUT `reason` is a
  // 422 there. Reaching `status: "declined"` therefore proves the reason was
  // actually sent, not merely that we asked to decline.
  const expense = await remote.getExpense("exp_sandbox_over_cap_402");
  assert.equal(expense.status, "declined");
  assert.equal(expense.reason, "Whole-department dinner is not reimbursable under the meals policy.");

  const row = await expenseStore.findById(claim.storeId);
  assert.equal(row.status, "declined");
  assert.equal(row.reviewAction, "decline");
});

// ---------------------------------------------------------------------------
// 3 + 4 — hold: the third verb, and the one that writes nothing to Remote
// ---------------------------------------------------------------------------

test("hold parks the claim, makes NO Remote write, and leaves it still actionable", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "hold", reviewer: "fin.ops@remote.com", note: "Waiting on the attendee list." },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, "held");
  // NOTHING was called on Remote — not even the freshness read, because there
  // is nothing to gate. Remote's status enum has no "held" member, so a hold
  // deliberately leaves the claim `pending` exactly where it was.
  assert.deepEqual(rc.calls, []);

  const row = await expenseStore.findById(claim.storeId);
  assert.equal(row.status, "held");
  assert.equal(row.reviewer, "fin.ops@remote.com");
  // NON-TERMINAL: still open to a later decision.
  assert.equal(evaluateExpenseActionability({ expenseRow: row }).allowed, true);
});

test("POSITIVE: a held claim can still be released afterwards", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  await submitExpenseReview(
    { storeId: claim.storeId, action: "hold", reviewer: "fin.ops@remote.com", note: "chasing" },
    { remote: rc, audit, expenseStore }
  );
  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com", note: "list received" },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "approved");
  const write = rc.calls.find((c) => c.call === "patchExpenseStatus");
  // The approve body is EXACTLY `{status:"approved"}` and nothing else —
  // UC-02.md §7's structural VAT guarantee, restated at the review write.
  assert.deepEqual(write.body, { status: "approved" });
});

// ---------------------------------------------------------------------------
// 5-13 — the refusals
// ---------------------------------------------------------------------------

test("a decline with no reason is refused before any Remote call", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "decline", reviewer: "fin.ops@remote.com", note: "   " },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.code, "decline_reason_required");
  assert.deepEqual(rc.calls, []);
  assert.equal((await expenseStore.findById(claim.storeId)).status, "flagged");
});

test("an unidentified reviewer is refused with 401 and nothing is recorded", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "  ", note: "" },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.status, 401);
  assert.equal(result.code, "reviewer_required");
  assert.deepEqual(rc.calls, []);
  // An unattributed refusal is NOT audited — an append-only row naming nobody
  // is worse than no row (same rule as uc04/workflow.js's recordRefusal).
  assert.equal(
    audit.entries.filter((e) => e.action.startsWith("expense_review_")).length,
    0
  );
});

test("an auto-approved claim has no review path (403), and the reason says so", async () => {
  const auto = await handleExpenseSubmission(
    { expenseId: "exp_auto_101", employmentId: "emp_active_001", session, receiptHash: "h-auto", source: "test" },
    { remote, audit, expenseStore, classify }
  );
  assert.equal(auto.decision, "auto_approve", "fixture precondition");

  const result = await submitExpenseReview(
    { storeId: auto.storeId, action: "decline", reviewer: "fin.ops@remote.com", note: "changed my mind" },
    { remote: fakeRemote(), audit, expenseStore }
  );

  assert.equal(result.status, 403);
  assert.equal(result.code, "not_awaiting_review");
});

test("a blocked (duplicate) claim has no review path either — it is a refusal, not an exception to weigh", async () => {
  await handleExpenseSubmission(
    { expenseId: "exp_auto_101", employmentId: "emp_active_001", session, receiptHash: "dupe-key", source: "test" },
    { remote, audit, expenseStore, classify }
  );
  const blocked = await handleExpenseSubmission(
    { expenseId: "exp_dup_b_103", employmentId: "emp_active_001", session, receiptHash: "dupe-key", source: "test" },
    { remote, audit, expenseStore, classify }
  );
  assert.equal(blocked.decision, "blocked", "fixture precondition");

  const result = await submitExpenseReview(
    { storeId: blocked.storeId, action: "approve", reviewer: "fin.ops@remote.com" },
    { remote: fakeRemote(), audit, expenseStore }
  );
  assert.equal(result.status, 403);
  assert.equal(result.code, "not_awaiting_review");
});

test("a claim cannot be decided twice (409), and the second attempt makes no Remote write", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  const first = await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com" },
    { remote: rc, audit, expenseStore }
  );
  assert.equal(first.ok, true);
  const writesAfterFirst = rc.calls.filter((c) => c.call === "patchExpenseStatus").length;

  const second = await submitExpenseReview(
    { storeId: claim.storeId, action: "decline", reviewer: "someone.else@remote.com", note: "no" },
    { remote: rc, audit, expenseStore }
  );
  assert.equal(second.status, 409);
  assert.equal(second.code, "already_decided");
  assert.equal(rc.calls.filter((c) => c.call === "patchExpenseStatus").length, writesAfterFirst);
});

test("an unknown store id is a 404, and is not audited (nothing to attribute it to)", async () => {
  const result = await submitExpenseReview(
    { storeId: "no-such-row", action: "approve", reviewer: "fin.ops@remote.com" },
    { remote: fakeRemote(), audit, expenseStore }
  );
  assert.equal(result.status, 404);
  assert.equal(result.code, "expense_not_found");
  assert.equal(audit.entries.length, 0);
});

test("an unrecognised verb is refused", () => {
  const verdict = evaluateReviewAction({
    expenseRow: { decision: "human_review", status: "flagged", flags: [] },
    reviewer: "fin.ops@remote.com",
    action: "sign_off", // UC-02's verbs are approve/decline/hold — see reviewPolicy.js
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "unknown_action");
});

// ---------------------------------------------------------------------------
// 14 — the freshness re-read, and its deliberate asymmetry
// ---------------------------------------------------------------------------

test("release is BLOCKED when the employment is no longer active, and the claim stays open", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote({ employmentStatus: "terminated" });

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com" },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "employment_no_longer_active");
  // No money moved.
  assert.equal(rc.calls.some((c) => c.call === "patchExpenseStatus"), false);
  // And the claim is NOT stranded — it is still exactly where it was, so the
  // reviewer can decline or hold it instead.
  const row = await expenseStore.findById(claim.storeId);
  assert.equal(row.status, "flagged");
  assert.equal(evaluateExpenseActionability({ expenseRow: row }).allowed, true);
});

test("POSITIVE: decline is NOT blocked by an inactive employment — a claim must never be un-closable", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote({ employmentStatus: "terminated" });

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "decline", reviewer: "fin.ops@remote.com", note: "Employment ended; not reimbursable." },
    { remote: rc, audit, expenseStore }
  );

  assert.equal(result.ok, true, result.reason);
  assert.equal(result.code, "declined");
  const write = rc.calls.find((c) => c.call === "patchExpenseStatus");
  assert.deepEqual(write.body, { status: "declined", reason: "Employment ended; not reimbursable." });
});

// ---------------------------------------------------------------------------
// 15 — audit: ordering, and the AI recommendation recorded beside the verdict
// ---------------------------------------------------------------------------

test("the human's verdict is durably audited BEFORE the Remote write, and carries the AI's recommendation", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();

  await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com", note: "approved out of band" },
    { remote: rc, audit, expenseStore }
  );

  const verdictIdx = audit.entries.findIndex((e) => e.action === "expense_review_approve");
  const writeIdx = audit.entries.findIndex((e) => e.action === "expense_review_approved_write");
  assert.ok(verdictIdx !== -1, "the verdict must be audited");
  assert.ok(writeIdx !== -1, "the write result must be audited");
  assert.ok(verdictIdx < writeIdx, "the verdict must be durable before the outward act");

  const verdictRow = audit.entries[verdictIdx];
  assert.equal(verdictRow.actor, "fin.ops@remote.com");
  // The tier on the verdict row must be the one the SHARED risk engine assigns
  // to this claim's flags — not UC-02's headline 🟢, which is the use case's
  // tier and not this row's. An over-cap claim escalates, which is the whole
  // reason it reached a human.
  const row = await expenseStore.findById(claim.storeId);
  assert.equal(verdictRow.riskTier, classifyRisk("UC-02", row.flags ?? []).tier);
  // The pairing that makes the Finance-Ops accept rate (UC-02.md §11) a
  // measurement rather than a restatement of its own definition.
  assert.equal(verdictRow.details.aiDecision, "human_review");
  assert.equal(typeof verdictRow.details.aiReason, "string");
  assert.equal(verdictRow.details.reviewAction, "approve");
});

test("a blocked release records why it was blocked, naming the status actually observed", async () => {
  const claim = await flaggedClaim();
  await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com" },
    { remote: fakeRemote({ employmentStatus: "terminated" }), audit, expenseStore }
  );

  const blockedRow = audit.entries.find((e) => e.action === "expense_review_execution_blocked");
  assert.ok(blockedRow, "the block must be recorded");
  assert.equal(blockedRow.details.observedStatus, "terminated");
});

// ---------------------------------------------------------------------------
// 16-20 — the HTTP surface, including the identity gate
// ---------------------------------------------------------------------------

function callApi(handler, { method, path, body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers,
      on(event, cb) {
        if (event === "data" && body) cb(Buffer.from(JSON.stringify(body)));
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

test("POSITIVE over HTTP: POST /api/expenses/:id/approve releases a flagged claim", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();
  const handler = createUc02Handler({ expenseStore, audit, remote: rc });

  // The GET view offers the control...
  const before = await callApi(handler, { method: "GET", path: `/api/expenses/${claim.storeId}` });
  assert.equal(before.body.actionable, true);

  // ...and the POST honours it.
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/approve`,
    body: { approver: "fin.ops@remote.com", note: "ok" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.code, "approved");

  // The view and the route agree afterwards — the same pure function decides
  // both, so a sidebar can never show a button the API would refuse.
  const after = await callApi(handler, { method: "GET", path: `/api/expenses/${claim.storeId}` });
  assert.equal(after.body.actionable, false);
  assert.equal(after.body.expense.reviewer, "fin.ops@remote.com");
});

test("POSITIVE over HTTP: POST .../decline carries the note through as Remote's required reason", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();
  const handler = createUc02Handler({ expenseStore, audit, remote: rc });

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/decline`,
    body: { approver: "fin.ops@remote.com", note: "Over cap and not pre-approved." },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, "declined");
  const write = rc.calls.find((c) => c.call === "patchExpenseStatus");
  assert.deepEqual(write.body, { status: "declined", reason: "Over cap and not pre-approved." });
});

test("a review route with a verb the policy does not recognise is not a route at all", async () => {
  const claim = await flaggedClaim();
  const handler = createUc02Handler({ expenseStore, audit, remote: fakeRemote() });

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/reimburse`,
    body: { approver: "fin.ops@remote.com" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

test("with signed reviews required and no token, the review routes refuse — they never fall back to the body", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();
  const handler = createUc02Handler({
    expenseStore,
    audit,
    remote: rc,
    // The deployment posture: readPosture() ORs "durable store attached" with
    // "publicly reachable", and deps.js passes the SAME value here that it
    // passes to uc04/05/06/09.
    requireSignedReviews: true,
    reviewVerifier: null,
    requireSignedReads: false,
  });

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/approve`,
    body: { approver: "attacker@evil.test" },
  });

  assert.equal(res.status, 401);
  // It refuses for the FIRST missing thing (no token), and it does NOT degrade
  // to trusting the name in the body at any point.
  assert.equal(res.body.code, "signed_identity_required");
  assert.deepEqual(rc.calls, []);
  assert.equal((await expenseStore.findById(claim.storeId)).status, "flagged");
});

test("requireSignedReviews DEFAULTS to the deployment's read posture, never to something laxer", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();
  // Only `requireSignedReads` is set — `requireSignedReviews` is omitted, and
  // must inherit it. If it ever defaulted to `false` on its own, this POST
  // would succeed and UC-02 would be the one use case with a weaker gate.
  const handler = createUc02Handler({
    expenseStore,
    audit,
    remote: rc,
    requireSignedReads: true,
    readVerifier: null,
  });

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/approve`,
    body: { approver: "attacker@evil.test" },
  });
  assert.equal(res.status, 401);
  assert.deepEqual(rc.calls, []);
});

// ---------------------------------------------------------------------------
// 21 — the policy module's own vocabulary, pinned
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 22-24 — the sidebar panel, driven through a minimal DOM double
// ---------------------------------------------------------------------------
// test/zafApp.test.js compiles the browser assets and checks that a panel
// SUPPLIES a renderActions; it has no DOM, so it cannot check WHAT that
// function renders. A missing third verb, or a Decline button that always 400s
// because the note is optional in the browser and mandatory at Remote, would
// pass every existing assertion. So this suite brings a tiny DOM double.
// ---------------------------------------------------------------------------

function loadPanels() {
  const context = { window: {} };
  vm.createContext(context);
  const source = readFileSync(new URL("../zaf-app/assets/panels.js", import.meta.url), "utf8");
  new vm.Script(source, { filename: "panels.js" }).runInContext(context);
  return context.window;
}

/** Just enough DOM for panels.js: elements, classes, text, and click. */
function fakeCtx({ post }) {
  function el(tag, className, text) {
    const node = {
      tag,
      className: className || "",
      textContent: text === undefined ? "" : String(text),
      children: [],
      attrs: {},
      disabled: false,
      value: "",
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      addEventListener(event, handler) {
        if (event === "click") this.onClick = handler;
      },
      focus() {},
    };
    return node;
  }
  function labelledField(tag, className, labelText, opts) {
    const wrap = el("div", "field");
    const control = el(tag, className);
    control.label = labelText;
    if (opts && opts.rows) control.setAttribute("rows", String(opts.rows));
    wrap.appendChild(el("label", "field-label", labelText));
    wrap.appendChild(control);
    return { wrap, control };
  }
  return {
    el,
    labelledField,
    resize() {},
    reload() {},
    approvalMeter: () => el("div", "meter"),
    view: { post },
  };
}

/** Depth-first walk, so an assertion does not depend on the DOM's nesting. */
function flatten(node, out = []) {
  out.push(node);
  (node.children || []).forEach((child) => flatten(child, out));
  return out;
}

test("the UC-02 panel renders all THREE Finance Ops verbs, not an approve/deny pair", () => {
  const { CXPanelFor } = loadPanels();
  const calls = [];
  const ctx = fakeCtx({ post: async (...args) => (calls.push(args), { ok: true, code: "approved" }) });
  const view = { actionable: true, case: {}, post: ctx.view.post };

  const tree = CXPanelFor("UC-02").renderActions(view, ctx);
  const labels = flatten(tree)
    .filter((n) => n.tag === "button")
    .map((n) => n.textContent);

  assert.deepEqual(labels, ["Approve", "Decline", "Hold"]);
});

test("the panel's Decline button refuses locally when the note is empty — and posts nothing", async () => {
  const { CXPanelFor } = loadPanels();
  const calls = [];
  const ctx = fakeCtx({ post: async (...args) => (calls.push(args), { ok: true, code: "declined" }) });
  const view = { actionable: true, case: {}, post: ctx.view.post };
  const tree = CXPanelFor("UC-02").renderActions(view, ctx);

  const nodes = flatten(tree);
  const approver = nodes.find((n) => n.label === "Your name or email");
  const note = nodes.find((n) => n.tag === "textarea");
  const decline = nodes.find((n) => n.tag === "button" && n.textContent === "Decline");

  approver.value = "fin.ops@remote.com";
  note.value = "   ";
  decline.onClick();
  await new Promise((r) => setImmediate(r));

  // The server would refuse this anyway (400 decline_reason_required) — the
  // browser check exists so the agent is told before the round trip, and this
  // asserts it is a check and not decoration.
  assert.deepEqual(calls, []);
  const status = nodes.find((n) => n.attrs.role === "status");
  assert.match(status.textContent, /needs a reason/i);
});

test("the panel's note field is labelled as the reason, because a decline needs one", () => {
  const { CXPanelFor } = loadPanels();
  const ctx = fakeCtx({ post: async () => ({ ok: true }) });
  const tree = CXPanelFor("UC-02").renderActions({ actionable: true, case: {}, post: ctx.view.post }, ctx);
  const note = flatten(tree).find((n) => n.tag === "textarea");
  assert.equal(note.label, "Reason / note");

  // And the hint the agent reads never again claims there is no surface here.
  const hint = CXPanelFor("UC-02").approveHint({});
  assert.doesNotMatch(hint, /no approve\/deny surface/i);
  assert.match(hint, /Approve/);
  assert.match(hint, /Decline/);
  assert.match(hint, /Hold/);
});

// ---------------------------------------------------------------------------
// 25-28 — WHICH GATE DECIDED, and the misreading it fixes
// ---------------------------------------------------------------------------
// A tester submitted an expense belonging to somebody else, got
// `escalate / expense_employment_mismatch`, saw "Classifier confidence 0.9" in
// the same panel, and asked why the system escalates at 0.9 confidence. It does
// not: ownership is gate 4, confidence is gate 13, first failure wins, and that
// run never reached gate 13. The confidence describes the LLM's certainty about
// the CATEGORY — prime directive #1's separation, working exactly as intended
// and rendered as though it were causal.
// ---------------------------------------------------------------------------

test("an ownership refusal reports gate 4, and says the confidence was NOT consulted", () => {
  const gate = describeDecidingGate("expense_employment_mismatch");
  assert.equal(gate.position, 4);
  assert.equal(gate.gate, "Ownership");
  assert.equal(gate.confidenceConsulted, false);
  assert.match(gate.note, /stopped at gate 4/);
  assert.match(gate.note, /BEFORE gate 13/);
  assert.match(gate.note, /CATEGORY/);
  assert.match(gate.note, /played no part in this outcome/);
});

test("a low-confidence refusal DOES report the confidence as consulted", () => {
  const gate = describeDecidingGate("low_confidence");
  assert.equal(gate.position, CONFIDENCE_GATE_POSITION);
  assert.equal(gate.confidenceConsulted, true);
  assert.match(gate.note, /was consulted/);
});

test("EVERY reason evaluate() can return is described — checked against the source, not a list", () => {
  // The drift this guards against is real: GATE_SEQUENCE is a second statement
  // of the gate order, and a gate added without a row here would report
  // "unknown" forever without erroring. So the reasons are scraped out of the
  // policy engine itself rather than restated in the test — a local copy would
  // share any omission and compare equal.
  const source = readFileSync(new URL("../src/uc02/policyEngine.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function evaluate("));
  const reasons = new Set([...body.matchAll(/reason:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));
  assert.ok(reasons.size >= 15, `expected to scrape the gates' reasons, found ${reasons.size}`);

  const described = new Set(GATE_SEQUENCE.map((g) => g.reason));
  for (const reason of reasons) {
    assert.ok(described.has(reason), `GATE_SEQUENCE has no row for the reason "${reason}"`);
  }
});

test("an unrecognised reason says so rather than guessing a gate", () => {
  const gate = describeDecidingGate("a_reason_that_does_not_exist");
  assert.equal(gate.position, null);
  assert.equal(gate.gate, "unknown");
  assert.equal(gate.confidenceConsulted, false);
  assert.match(gate.note, /cannot be stated/);
});

test("the API's view carries the deciding gate, so the sidebar never re-derives gate order", async () => {
  const claim = await flaggedClaim();
  const handler = createUc02Handler({ expenseStore, audit, remote: fakeRemote() });
  const res = await callApi(handler, { method: "GET", path: `/api/expenses/${claim.storeId}` });

  assert.equal(res.body.decidedBy.position, 12);
  assert.equal(res.body.decidedBy.gate, "Policy cap");
  assert.equal(res.body.decidedBy.confidenceConsulted, false);

  // And the panel prints what it is given rather than deciding.
  const panels = readFileSync(new URL("../zaf-app/assets/panels.js", import.meta.url), "utf8");
  assert.match(panels, /view\.decidedBy/);
  assert.match(panels, /Confidence in the CATEGORY/);
  // No gate order in the browser — checked against the CODE, with comments
  // stripped first: the panel's comment explains the misreading it fixes and
  // has to name the gate numbers to do so. Forbidding the words would push the
  // explanation out of the file that most needs it.
  const panelCode = panels.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(panelCode, /GATE_SEQUENCE|CONFIDENCE_GATE/);
  assert.doesNotMatch(panelCode, /position\s*[<>=]{1,3}\s*\d/, "the panel must not compare gate positions itself");
});

// ---------------------------------------------------------------------------
// THE LADDER ITSELF — "decided by gate 15" cites an order nobody could see
// ---------------------------------------------------------------------------
// A tester read "Decided by gate 15 — All gates" on the portal and asked what
// gates 1 to 14 were. Nothing anywhere named them, so the number was a citation
// to a missing document. describeGateLadder() is that document, and these tests
// pin the two properties a reader depends on: that the ladder is the SAME order
// the gates run in (scraped from GATE_SEQUENCE, never restated here), and that
// "not reached" stays distinct from "passed".

// ---------------------------------------------------------------------------
// SAYING WHAT HAPPENED, NOT WHAT THE GATE CHECKS
// ---------------------------------------------------------------------------
// A tester read `over_policy_cap` above a gate line phrased as the PASSING
// condition ("the converted amount is within the category cap") and had to
// invert the sentence to learn what had happened. They asked for it to say
// plainly that the expense is above the policy cap. `means` is that sentence,
// and it is per-REASON because one gate refuses several ways.

test("every gate row says in plain words what it MEANS when that reason fires", () => {
  for (const entry of GATE_SEQUENCE) {
    assert.equal(typeof entry.means, "string", `${entry.reason} has no plain-words meaning`);
    assert.ok(entry.means.length > 20, `${entry.reason}'s meaning is too short to be one`);
    // A meaning that is just the slug back again explains nothing.
    assert.ok(!entry.means.includes(entry.reason), `${entry.reason} restates its own slug`);
  }
});

test("the three refusals at the policy-cap gate MEAN three different things", () => {
  // The reason `means` is per-reason and not per-gate: one gate, three
  // outcomes, and telling somebody "the policy cap gate refused" would be true
  // and useless for two of them.
  const cap = GATE_SEQUENCE.filter((g) => g.position === 12);
  assert.equal(cap.length, 3);
  assert.equal(new Set(cap.map((g) => g.means)).size, 3);
  assert.match(describeDecidingGate("over_policy_cap").means, /above the spend cap/i);
  assert.match(describeDecidingGate("policy_cap_unknown").means, /no spend cap could be found/i);
});

test("the portal leads with the words, and the slug goes where a specialist looks", () => {
  const app = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /payload\.decidedBy\.means/);
  // THE SLUG NO LONGER APPEARS ON THE REQUESTER'S PAGE, and the claim this
  // line used to make has moved rather than been dropped. It still must
  // survive somewhere — `audit_log`, the metrics exception ranking and the n8n
  // ports all carry it, so it is what a person searches by — but the person
  // who searches by it is a specialist, and the requester who filed an expense
  // can do nothing with `over_policy_cap` printed beside a sentence that
  // already says it in words. It is now routed to the Zendesk ticket the
  // hand-off raises, and `test/portalRequesterFacts.test.js` §3 asserts it
  // arrives there by reading it back off the created ticket — a stronger check
  // than this one ever was, since it proves delivery rather than the presence
  // of a CSS class name.
  assert.doesNotMatch(app, /reason-slug/, "the requester's page is printing decision slugs again");
  assert.match(app, /payload\.reason/);
});

test("the ladder is the whole order, one rung per position, in order", () => {
  const ladder = describeGateLadder("all_gates_passed");
  const positions = ladder.map((rung) => rung.position);

  // Derived from the sequence itself: a hand-written expectation would drift
  // silently the moment a gate is inserted, which is the one thing that must
  // not happen quietly.
  const expected = [...new Set(GATE_SEQUENCE.map((g) => g.position))].sort((a, b) => a - b);
  assert.deepEqual(positions, expected);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(new Set(positions).size, positions.length, "one rung per position");
});

test("every refusal a gate can produce is listed on that gate's rung", () => {
  const ladder = describeGateLadder("all_gates_passed");
  const listed = new Set(ladder.flatMap((rung) => rung.refusals));
  for (const entry of GATE_SEQUENCE) {
    assert.ok(listed.has(entry.reason), `the ladder drops the refusal "${entry.reason}"`);
  }
  // Position 12 is the one that proves the collapse is real rather than
  // incidental: three reasons, one gate.
  const cap = ladder.find((rung) => rung.position === 12);
  assert.equal(cap.gate, "Policy cap");
  assert.equal(cap.refusals.length, 3);
});

test("first failure wins, so above the deciding rung is passed and below it is NOT REACHED", () => {
  const ladder = describeGateLadder("expense_employment_mismatch");
  const decided = ladder.filter((rung) => rung.status === "decided");
  assert.equal(decided.length, 1);
  assert.equal(decided[0].position, 4);

  for (const rung of ladder) {
    const expected = rung.position < 4 ? "passed" : rung.position === 4 ? "decided" : "not_reached";
    assert.equal(rung.status, expected, `gate ${rung.position} (${rung.gate})`);
  }

  // The distinction that matters: gate 13 read no confidence on this run, and
  // saying it "passed" would claim it approved of something it never saw.
  const confidence = ladder.find((rung) => rung.position === CONFIDENCE_GATE_POSITION);
  assert.equal(confidence.status, "not_reached");
});

test("a clean run marks every rung passed except the last, which decided", () => {
  const ladder = describeGateLadder("all_gates_passed");
  const last = ladder[ladder.length - 1];
  assert.equal(last.status, "decided");
  assert.equal(last.gate, "All gates");
  assert.ok(ladder.slice(0, -1).every((rung) => rung.status === "passed"));
});

test("an unrecognised reason cannot place the run, so no rung claims to know", () => {
  const ladder = describeGateLadder("a_reason_that_does_not_exist");
  assert.ok(ladder.length > 0);
  assert.ok(ladder.every((rung) => rung.status === "unknown"));
});

test("the portal sends the ladder, and the page prints it without knowing the order", () => {
  const app = readFileSync(new URL("../src/portal/assets/app.js", import.meta.url), "utf8");
  assert.match(app, /payload\.gateLadder/);
  // Same rule the ZAF panel follows: no gate order in the browser. Comments are
  // stripped first because they legitimately explain the numbers.
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /GATE_SEQUENCE/);
  assert.doesNotMatch(code, /rung\.position\s*[<>]/, "the page must not compare gate positions itself");
});

// ---------------------------------------------------------------------------
// A REFUSAL MUST NAME WHAT HAPPENED, NOT LIST WHAT MIGHT HAVE
// ---------------------------------------------------------------------------
// A specialist opened a settled claim and the whole panel read: "This claim has
// already been released or declined." Every word true, and it answers none of
// the questions the reader has. WHICH of the two decides whether the employee
// is owed money; WHO decides who to ask; the note is the content of the
// decision; and whether the Remote write landed decides whether the
// reimbursement exists or only the record of it does. All five were on the row
// and all five were being discarded.

test("an approved claim says who approved it, when, with what note — and whether Remote took the write", () => {
  const reason = describeSettled({
    status: "approved",
    reviewAction: "approve",
    reviewer: "Dana",
    reviewedAt: "2026-08-19T05:02:11Z",
    reviewNote: "valid",
    remoteResult: { status: "approved" },
  });
  assert.match(reason, /APPROVED/);
  // The generic fallback, matched exactly — the tail "cannot be approved or
  // declined again" is a legitimate use of the same words and must not trip it.
  assert.notEqual(reason, REFUSALS.already_decided.reason, "it must not fall back to listing both possibilities");
  assert.match(reason, /Dana/);
  assert.match(reason, /2026-08-19T05:02:11Z/);
  assert.match(reason, /valid/);
  assert.match(reason, /approved at Remote/);
});

test("an approval with NO Remote result says so rather than implying the money moved", () => {
  // The distinction that matters most here: a human saying yes and Remote
  // accepting the write are different facts, and `remoteResult` is written only
  // after the PATCH returns. Conflating them is how "approved" comes to mean
  // two things.
  const reason = describeSettled({ status: "approved", reviewAction: "approve", reviewer: "Dana", remoteResult: null });
  assert.match(reason, /APPROVED/);
  assert.match(reason, /may not have reached Remote/);
});

test("a declined claim gives the reason, and says plainly when none was recorded", () => {
  const withReason = describeSettled({ status: "declined", reviewAction: "decline", reviewer: "Ada", reviewNote: "over cap, no approval" });
  assert.match(withReason, /DECLINED/);
  assert.match(withReason, /over cap, no approval/);

  const without = describeSettled({ status: "declined", reviewAction: "decline", reviewer: "Ada", reviewNote: "" });
  assert.match(without, /No reason was recorded/, "a decline is supposed to carry one — silence is not the same as none");
});

test("a claim that never reached Finance Ops names WHICH outcome it got, and what that meant", () => {
  // "auto-approved, blocked or escalated" was a list of three when the row
  // names one — the same shape of defect, one door over.
  const auto = describeNoReviewPath({ decision: "auto_approve", reason: "all_gates_passed", autoApprovedAt: "2026-08-19T04:00:00Z" });
  assert.match(auto, /AUTO-APPROVED/);
  assert.match(auto, /2026-08-19T04:00:00Z/);
  assert.doesNotMatch(auto, /blocked or escalated/);

  const esc = describeNoReviewPath({ decision: "escalate", reason: "expense_employment_mismatch" });
  assert.match(esc, /ESCALATED/);
  assert.match(esc, /gate 4 \(Ownership\)/);
  // The plain-words meaning, so a specialist is not left to translate the slug.
  assert.match(esc, /belongs to a different employee/);

  const blocked = describeNoReviewPath({ decision: "blocked", reason: "duplicate_submission" });
  assert.match(blocked, /BLOCKED/);
  assert.match(blocked, /already reimbursed/);
});

test("the actionability verdict carries the specific reason, not the generic one", () => {
  // The whole point: this is the string the sidebar renders. A specific
  // describe* that nothing calls would be worth nothing.
  const settled = evaluateExpenseActionability({
    expenseRow: { decision: "human_review", status: "approved", reviewAction: "approve", reviewer: "Dana", remoteResult: {} },
  });
  assert.equal(settled.allowed, false);
  assert.equal(settled.code, "already_decided");
  assert.match(settled.reason, /APPROVED by Dana/);

  const never = evaluateExpenseActionability({ expenseRow: { decision: "escalate", reason: "expense_employment_mismatch" } });
  assert.equal(never.code, "not_awaiting_review");
  assert.match(never.reason, /ESCALATED/);
});

test("a row that cannot say which outcome it got falls back to the generic wording", () => {
  // An honest "we cannot say which" beats a confident guess. It should be rare,
  // which is why it is asserted rather than assumed.
  const r = describeSettled({ status: "something_else", reviewAction: null });
  assert.equal(r, REFUSALS.already_decided.reason);
});

test("the sidebar's Why card leads with the words, and no longer prints the slug", () => {
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  assert.match(main, /view\.decidedBy && view\.decidedBy\.means/);
  // THE SLUG WAS REMOVED ON 2026-08-31 and this assertion was inverted with it.
  // It used to read `assert.match(main, /reason-slug/)`, defended as "the exact
  // string in audit_log, so prose that REPLACED it would make the card readable
  // and the system harder to trace". That reasoning holds for a specialist with
  // database access and not for this surface: the ZAF panel is shown to
  // customers, and `all_gates_passed` beside a sentence that already says the
  // same thing in English is an internal code on a customer-facing page.
  // Traceability is not lost — the slug is on the `audit_log` row, which is
  // where a searchable identifier belongs. See test/zafNoDeveloperArtifacts.
  assert.ok(!/reason-slug/.test(main), "the internal decision slug is back on a customer-facing panel");
});

test("the three verbs, and which of them end the review", () => {
  assert.deepEqual([...ACTIONS].sort(), ["approve", "decline", "hold"]);
  // `hold` is deliberately NOT terminal: Remote has no "held" status, so a
  // hold is a local parking state that must stay reversible.
  assert.deepEqual([...TERMINAL_ACTIONS].sort(), ["approve", "decline"]);
  assert.equal(statusForAction("approve"), "approved");
  assert.equal(statusForAction("decline"), "declined");
  assert.equal(statusForAction("hold"), "held");
});

// ---------------------------------------------------------------------------
// THE release -> approve RENAME, AND THE TWO THINGS IT MUST NOT BREAK
// ---------------------------------------------------------------------------
// UC-02's positive verb was `release` — alone among nine use cases, with no
// reason recorded anywhere. Four words named one act: the button said RELEASE,
// the row said `released`, the audit row said `expense_review_release`, and
// Remote — whose vocabulary is not ours to choose — said `approved`.
//
// A rename is cheap to write and expensive to get wrong, because both of the
// things it can break are INVISIBLE to every test that existed before it:
//
//   1. A DEPLOYED CALLER STILL SENDS THE OLD WORD. The ZAF app is a bundle
//      uploaded into a Zendesk account; between deploying this API and
//      re-uploading that bundle, the old bundle posts `/release`. Without the
//      alias, every Finance Ops approval in that window 400s — the rename
//      taking the approve button offline, which is exactly the "structurally
//      cannot succeed" failure this repo keeps paying for. Only a POSITIVE
//      test detects it, because a refusal and an outage read identically.
//   2. LIVE ROWS STILL CARRY THE OLD WORD. `uc02_expenses` holds two rows with
//      `status: 'released'` (verified against project your-project-ref on
//      2026-08-19). If those stop rendering, a claim that WAS approved starts
//      reporting as unknown — worse than the inconsistent word ever was.
//
// So both directions are pinned here, and both are must-succeed tests.
// ---------------------------------------------------------------------------

test("BACKWARD COMPAT: the legacy verb `release` still approves, and records the canonical word", async () => {
  const claim = await flaggedClaim({ expenseId: "exp_over_cap_201" });
  const rc = fakeRemote();

  const result = await submitExpenseReview(
    { storeId: claim.storeId, action: "release", reviewer: "fin.ops@remote.com", note: "legacy bundle" },
    { remote: rc, audit, expenseStore }
  );

  // It SUCCEEDS — the load-bearing half. A 400 here is the deployed sidebar
  // losing its approve button.
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.code, "approved", "the response speaks the canonical vocabulary, not the caller's");

  // And it performs the REAL write, with Remote's own body.
  const patch = rc.calls.find((c) => c.call === "patchExpenseStatus");
  assert.ok(patch, "the legacy verb must still reach Remote");
  assert.deepEqual(patch.body, { status: "approved" });
  assert.ok(result.remoteResult, "and must produce a remoteResult");

  // Nothing downstream of the entry point learns that the alias exists.
  const row = await expenseStore.findById(claim.storeId);
  assert.equal(row.status, "approved");
  assert.equal(row.reviewAction, "approve");
  const verdict = audit.entries.find((e) => e.action === "expense_review_approve");
  assert.ok(verdict, "the audit row names the canonical verb");
  assert.equal(verdict.details.reviewAction, "approve");
  assert.equal(
    audit.entries.filter((e) => e.action === "expense_review_release").length,
    0,
    "nothing may still WRITE the legacy action name — it is accepted on input only"
  );
});

test("BACKWARD COMPAT over HTTP: POST /api/expenses/:id/release still routes", async () => {
  // The path segment has to be matched by the ROUTER, not just normalised by
  // the handler — an unmatched segment 404s as `no_such_route` and never
  // reaches the code that would have canonicalised it.
  const claim = await flaggedClaim();
  const handler = createUc02Handler({ expenseStore, audit, remote: fakeRemote() });

  const res = await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/release`,
    body: { approver: "fin.ops@remote.com", note: "posted by a bundle that predates the rename" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.code, "approved");
  assert.equal(res.body.expense.reviewAction, "approve");
});

test("BACKWARD COMPAT: an unknown verb is still refused — the alias map is not a blanket pass", () => {
  // normalizeAction() returns its input unchanged when it is not an alias, so
  // an unknown verb still fails the ACTIONS check. A map that rewrote anything
  // it did not recognise into a valid verb would be a very quiet disaster.
  const verdict = evaluateReviewAction({
    expenseRow: { decision: "human_review", status: "flagged", flags: [] },
    reviewer: "fin.ops@remote.com",
    action: "unleash",
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "unknown_action");
  assert.match(REFUSALS.unknown_action.reason, /'approve'/);
});

test("BACKWARD COMPAT: a legacy `released` row still reads as approved everywhere", () => {
  // The row shape two live rows actually have.
  const legacy = {
    decision: "human_review",
    status: "released",
    reviewAction: "release",
    reviewer: "Dana",
    reviewedAt: "2026-08-19T05:02:11Z",
    reviewNote: "receipt checked",
    remoteResult: { status: "approved" },
    flags: [],
  };

  // 1. It is settled, not open — and it says WHICH outcome, not "one of two".
  const verdict = evaluateExpenseActionability({ expenseRow: legacy });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "already_decided");
  assert.match(verdict.reason, /APPROVED by Dana/);
  assert.notEqual(verdict.reason, REFUSALS.already_decided.reason);

  // 2. describeSettled() renders it in the new vocabulary — a reader is never
  //    shown a word the rest of the system no longer uses.
  assert.match(describeSettled(legacy), /Already APPROVED/);
  assert.doesNotMatch(describeSettled(legacy), /RELEASED/);

  // 3. And the outcome badge reports Remote's own status for it.
  const outcome = describeOutcome(legacy);
  assert.equal(outcome.label, "APPROVED");
  assert.equal(outcome.remoteStatus, "approved");
  assert.equal(outcome.writeConfirmed, true);
});

test("BACKWARD COMPAT: a legacy row read back from Postgres is canonicalised by the store", async () => {
  // The one layer that knows the old spellings existed. A pool that returns a
  // row written before the rename — which is what the live table holds.
  const pool = {
    async query(sql) {
      if (!/^select/i.test(sql.trim())) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            id: "legacy-row-1",
            createdAt: new Date("2026-08-18T10:00:00Z"),
            updatedAt: new Date("2026-08-18T10:05:00Z"),
            expenseId: "exp_over_cap_201",
            employmentId: "emp_active_001",
            storedReceiptHash: null,
            decision: "human_review",
            reason: "over_policy_cap",
            flags: "[]",
            categoryId: null,
            categorySource: null,
            confidence: null,
            externalRef: "ticket-legacy",
            source: "portal",
            status: "released",
            autoApprovedAt: null,
            remoteResult: '{"status":"approved"}',
            reviewAction: "release",
            reviewer: "Dana",
            reviewNote: "receipt checked",
            reviewedAt: new Date("2026-08-18T10:05:00Z"),
          },
        ],
        rowCount: 1,
      };
    },
  };

  const store = new ExpenseStore({ pgPool: pool });
  const row = await store.findById("legacy-row-1");

  assert.equal(row.status, "approved", "the stored `released` is canonicalised on the way out");
  assert.equal(row.reviewAction, "approve");
  // Everything else about the row is untouched — this is a vocabulary map, not
  // a rewrite.
  assert.equal(row.reviewer, "Dana");
  assert.deepEqual(row.remoteResult, { status: "approved" });
});

// ---------------------------------------------------------------------------
// THE OUTCOME BADGE
// ---------------------------------------------------------------------------
// The DECISION card used to show either the buttons or a paragraph, so once a
// claim was settled its OUTCOME — the fact a reader opens the card for — was
// only findable by reading that paragraph to its end. The badge states it, in
// Remote's own status vocabulary.
//
// The two ways a badge like this lies, both asserted below:
//   * calling a HELD claim decided, when a hold is explicitly non-terminal and
//     its buttons are still on screen underneath;
//   * calling a claim APPROVED when a human approved it and the PATCH never
//     landed — the most consequential over-claim available on this surface.
// ---------------------------------------------------------------------------

test("BADGE: an approved claim whose write landed reads APPROVED, in Remote's own word", async () => {
  const claim = await flaggedClaim();
  await submitExpenseReview(
    { storeId: claim.storeId, action: "approve", reviewer: "fin.ops@remote.com", note: "within policy" },
    { remote: fakeRemote(), audit, expenseStore }
  );

  const outcome = describeOutcome(await expenseStore.findById(claim.storeId));
  assert.equal(outcome.label, "APPROVED");
  assert.equal(outcome.remoteStatus, "approved", "a member of Remote's own expense status enum");
  assert.equal(outcome.tone, "settled");
  assert.equal(outcome.terminal, true);
  assert.equal(outcome.writeConfirmed, true);
  assert.equal(outcome.decidedBy, "fin.ops@remote.com");
});

test("BADGE: a HELD claim is not decided — no terminal badge, and its controls still render", async () => {
  const claim = await flaggedClaim();
  const rc = fakeRemote();
  await submitExpenseReview(
    { storeId: claim.storeId, action: "hold", reviewer: "fin.ops@remote.com", note: "need the attendee list" },
    { remote: rc, audit, expenseStore }
  );

  const row = await expenseStore.findById(claim.storeId);
  const outcome = describeOutcome(row);

  assert.equal(outcome.terminal, false, "a hold is not a verdict");
  assert.equal(outcome.tone, "waiting");
  assert.equal(outcome.label, "PENDING", "Remote's own word for a claim nothing was written against");
  assert.equal(outcome.remoteStatus, "pending");
  assert.doesNotMatch(outcome.label, /APPROVED|DECLINED/);

  // The badge and the buttons must agree. This is the assertion that catches a
  // badge contradicting the controls sitting under it.
  assert.equal(evaluateExpenseActionability({ expenseRow: row }).allowed, true);
  assert.deepEqual(rc.calls.filter((c) => c.call === "patchExpenseStatus"), [], "and nothing was written to Remote");
});

test("BADGE: a human approval whose Remote write never landed does NOT read APPROVED", () => {
  // `remoteResult` is written only after the PATCH returns, so this row is a
  // real decision that may never have left the system. describeSettled()
  // already refuses to conflate the two in prose; the badge is the most
  // prominent element on the card and must not undo that.
  const outcome = describeOutcome({
    decision: "human_review",
    status: "approved",
    reviewAction: "approve",
    reviewer: "Dana",
    remoteResult: null,
    flags: [],
  });

  assert.equal(outcome.writeConfirmed, false);
  assert.match(outcome.label, /NOT CONFIRMED AT REMOTE/);
  assert.equal(outcome.remoteStatus, null, "we cannot name a Remote status we have no response for");
  assert.equal(outcome.tone, "waiting", "not the settled tone — nothing is settled at Remote");
  assert.match(outcome.detail, /may still be pending at Remote/);
});

test("BADGE: a declined claim reads DECLINED, and a blocked one claims no Remote status at all", () => {
  const declined = describeOutcome({
    status: "declined",
    reviewAction: "decline",
    reviewer: "Dana",
    remoteResult: { status: "declined" },
  });
  assert.equal(declined.label, "DECLINED");
  assert.equal(declined.remoteStatus, "declined");
  assert.equal(declined.tone, "stopped");
  assert.equal(declined.terminal, true);

  // A hard stop wrote nothing, so naming the claim `pending` would report a
  // state we observed rather than one we simply never changed.
  const blocked = describeOutcome({ status: "blocked", reason: "duplicate_submission" });
  assert.equal(blocked.remoteStatus, null);
  assert.equal(blocked.tone, "stopped");
  assert.match(blocked.label, /NO REMOTE WRITE/);
});

test("BADGE: an unrecognised status is reported verbatim, never rounded to the nearest outcome", () => {
  const outcome = describeOutcome({ status: "quarantined" });
  assert.equal(outcome.label, "QUARANTINED");
  assert.equal(outcome.remoteStatus, null);
  assert.equal(outcome.terminal, false);
  assert.match(outcome.detail, /does not recognise/);
});

test("BADGE: the API serves it, and the browser is never asked to derive it", async () => {
  const claim = await flaggedClaim();
  const handler = createUc02Handler({ expenseStore, audit, remote: fakeRemote() });

  const before = await callApi(handler, { method: "GET", path: `/api/expenses/${claim.storeId}` });
  assert.equal(before.body.outcome.label, "PENDING");
  assert.equal(before.body.outcome.terminal, false);

  await callApi(handler, {
    method: "POST",
    path: `/api/expenses/${claim.storeId}/approve`,
    body: { approver: "fin.ops@remote.com", note: "ok" },
  });

  const after = await callApi(handler, { method: "GET", path: `/api/expenses/${claim.storeId}` });
  assert.equal(after.body.outcome.label, "APPROVED");
  assert.equal(after.body.outcome.remoteStatus, "approved");
  assert.equal(after.body.outcome.writeConfirmed, true);

  // And the shell prints what it was given. `main.js` renders `view.outcome`
  // and holds no rule of its own about which status means approved — the same
  // discipline `actionable` follows, checked the same way test/zafApp.test.js
  // checks the rest of this file.
  const main = readFileSync(new URL("../zaf-app/assets/main.js", import.meta.url), "utf8");
  assert.match(main, /function renderOutcomeBadge\(outcome\)/);
  assert.match(main, /outcome\.label/);
  assert.match(main, /view\.outcome && view\.outcome\.label/);
});

// ---------------------------------------------------------------------------
// THE CAP REFUSAL SHOWS ITS ARITHMETIC
// ---------------------------------------------------------------------------
// A tester read a Zendesk note saying their expense was "above the policy cap"
// and asked what the amount was, what the cap was, and by how much and what
// percentage it was over. Gate 12 held all four figures at the instant it
// refused and reported only the verdict.
//
// A WORKED EXAMPLE WITH REAL NUMBERS, deliberately: `exp_sandbox_over_cap_402`
// is 88000 (×100 integers, so $880.00) against the internal-meals cap of 50000
// ($500.00). 88000 - 50000 = 38000 ($380.00), and 38000 / 50000 = 0.76 = 76%.
// Every one of those is asserted below as the exact rendered string, so the
// next reader can check the arithmetic by eye rather than trusting the code
// that produced it.
// ---------------------------------------------------------------------------

const OVER_CAP_CATEGORY = "work_meals_and_entertainment.internal_meals_and_entertainment";

test("cap refusal: the exact figures for exp_sandbox_over_cap_402, formatted through money.js", () => {
  const described = describeCapComparison({
    reason: "over_policy_cap",
    // The fixture's own fields. `converted_amount` is what gate 12 compares —
    // the amount in the company's billing currency — never `amount`.
    expense: { converted_amount: 88000, converted_currency: { code: "USD" }, currency: { code: "USD" } },
    policyCap: 50000,
    categoryId: OVER_CAP_CATEGORY,
  });

  assert.equal(described.amount, "880.00 USD");
  assert.equal(described.cap, "500.00 USD");
  assert.equal(described.overage, "380.00 USD");
  assert.equal(described.percentOver, 76);
  assert.equal(described.currency, "USD");
  assert.equal(
    described.sentence,
    "880.00 USD claimed against a 500.00 USD cap for " +
      OVER_CAP_CATEGORY +
      " — over by 380.00 USD (76% over)."
  );

  // THE 100x CHECK. These are x100 integers; the failure mode this guards
  // against is a raw integer rendered as currency in front of somebody
  // authorising a payment. "88000" must appear nowhere in the sentence.
  assert.ok(!described.sentence.includes("88000"), "the raw x100 integer must never be rendered");
  assert.ok(!described.sentence.includes("50000"), "the raw x100 cap must never be rendered");
});

test("cap refusal: a zero cap yields no percentage rather than Infinity, NaN or a fabricated 0", () => {
  const described = describeCapComparison({
    reason: "over_policy_cap",
    expense: { converted_amount: 100, converted_currency: { code: "USD" } },
    policyCap: 0,
    categoryId: "some.category",
  });

  // The overage is still real money and is still stated. Only the RATIO is
  // undefined, and it says so rather than printing a number nobody can defend.
  assert.equal(described.overage, "1.00 USD");
  assert.equal(described.percentOver, null);
  assert.ok(!/Infinity|NaN/.test(described.sentence));
  assert.match(described.sentence, /percentage is undefined/);
});

test("cap refusal: policy_cap_unknown shows no arithmetic, because there is nothing to be over", () => {
  const described = describeCapComparison({
    reason: "policy_cap_unknown",
    expense: { converted_amount: 88000, converted_currency: { code: "USD" } },
    policyCap: null,
    categoryId: "some.category",
  });

  assert.equal(described.amount, null);
  assert.equal(described.cap, null);
  assert.equal(described.overage, null);
  assert.equal(described.percentOver, null);
  assert.match(described.sentence, /No spend cap is on record/);
  // No percentage, no overage, no comparison — the whole point of this branch.
  assert.ok(!/%/.test(described.sentence));
});

test("cap refusal: a currency mismatch names both currencies and computes no percentage", () => {
  const described = describeCapComparison({
    reason: "policy_cap_currency_mismatch",
    expense: { converted_amount: 88000, converted_currency: { code: "GBP" } },
    policyCap: 50000,
    categoryId: "some.category",
  });

  assert.equal(described.currency, "USD");
  assert.equal(described.expenseCurrency, "GBP");
  assert.equal(described.percentOver, null);
  assert.match(described.sentence, /USD/);
  assert.match(described.sentence, /GBP/);
  // A percentage across two currencies is exactly the comparison gate 12
  // refuses to make; computing one here would contradict the refusal.
  assert.ok(!/%/.test(described.sentence));
});

test("cap refusal: a non-cap decision gets no cap description at all", () => {
  for (const reason of ["all_gates_passed", "identity_not_verified", "duplicate_submission"]) {
    assert.equal(
      describeCapComparison({
        reason,
        expense: { converted_amount: 88000, converted_currency: { code: "USD" } },
        policyCap: 50000,
      }),
      null,
      `${reason} is not a cap decision and must produce no cap sentence`
    );
  }
});

test("cap refusal: the figures reach the portal panel AND the Zendesk note, from one row", () => {
  // Both surfaces are fed by the same `details` array — buildTicketNote()
  // writes every detail row into the internal note (src/portal/server.js), and
  // the page renders the same array. So one row covers the specialist reading
  // the ticket and the requester reading the result, and neither can drift
  // from the other.
  const source = readFileSync(new URL("../src/portal/server.js", import.meta.url), "utf8");
  assert.match(source, /result\.capComparison/, "the uc02 adapter must render the cap comparison");
  assert.match(source, /detail\("Cap comparison", result\.capComparison\.sentence\)/);
  // And the note builder still writes every detail into the note, which is what
  // makes the assertion above cover the Zendesk surface too. The note is HTML
  // now and the details are split into the specialist's table and the
  // operators' one — so this pins the SPLIT (both halves come from `details`,
  // and nothing is dropped) rather than the old single loop.
  assert.match(source, /const forSpecialist = details\.filter/);
  assert.match(source, /const forOperators = details\.filter/);
  assert.match(source, /OPS_ONLY_DETAILS/);
});
