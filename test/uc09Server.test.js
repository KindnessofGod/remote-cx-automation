// ---------------------------------------------------------------------------
// uc09Server.test.js  —  The UC-09 multi-approval HTTP API
// ---------------------------------------------------------------------------
// UC-09's server.js had NO dedicated test file before this — only its core
// workflow (test/uc09.test.js) and its n8n parity port were covered. Same
// request/response-double pattern as uc06Server.test.js: drives the real
// handler with no listening socket, so these prove the API wraps
// workflow.js/multiApprovalPolicy.js correctly without adding a second copy
// of any gate — including the floor-of-2 multi-role approval this is the one
// 🔴-framed use case WITH a real execution path behind.
//
// Uses the SAME fake `remote` as test/uc09.test.js, not a real RemoteClient
// against startMockServer() the way uc06Server.test.js does — deliberately.
// policyEngine.evaluate() validates the drafted incentive payload
// (employment_id/type/amount/currency/...) against whatever
// remote.getCountrySchema() returns; the REAL mock server's
// employment_basic_information schema is shaped for a different write
// entirely (UC-06's job_title/salary amendment), so driving this suite
// against the real mock would make every request fail as schema_invalid —
// a genuine, pre-existing gap in UC-09's schema source (no confirmed real
// Remote endpoint describes an incentive's required fields), not something
// to paper over here. See test/uc09.test.js's own fakeRemote.getCountrySchema
// comment for the identical reasoning.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuditLogger } from "../src/shared/audit.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { createUc09Handler } from "../src/uc09/server.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";
import { parseAdjustmentRequest } from "../src/uc09/adjustmentParser.js";

// Same fake as test/uc09.test.js.
const fakeRemote = {
  getEmployment: (id) => {
    if (id === "emp_inactive") return { id, status: "terminated", company_id: "co_test", country_code: "US" };
    return { id, status: "active", company_id: "co_test", country_code: "US", compensation_gross_amount: 10000000 };
  },
  // Required fields an incentive PAYLOAD must carry — prepareIncentivePayload()
  // in policyEngine.js always populates these, unlike an employment-record
  // schema's fields (full_name/address), which don't apply to this write.
  getCountrySchema: () => ({ required: ["employment_id", "type", "amount", "currency"] }),
  askJson: async () => ({ type: "bonus", amount: 5000, currency: "USD", amountTaxType: "gross", description: "Performance bonus" }),
  isLlmConfigured: () => false,
  createIncentive: async (payload) => ({ success: true, incentiveId: "inc_test_" + Math.random().toString(36).slice(2), ...payload }),
};

// handleAdjustmentRequest() calls judge() unconditionally on every run — never
// a real, retried LLM call from a test (this devcontainer's .env carries a
// genuine but unreachable OPENAI_API_KEY). Same fake idiom as test/uc09.test.js.
const fakeJudge = (args) => judgeNarrative(args, { isConfigured: () => false });

// The LLM seam (finding F-10): the parser refuses rather than regex-guessing a
// payment amount, so a free-text fixture needs a model standing behind it. This
// runs the REAL parser against a scripted answer — hermetic, and still covers
// the parser's own shape validation and ×100 scaling.
const fakeParse = (input) => {
  const text = String(input.requestText ?? "");
  const amount = /\$([\d,]+(?:\.\d+)?)/.exec(text);
  return parseAdjustmentRequest(input, {
    isConfigured: () => true,
    backoff: async () => {},
    askJson: async () => ({
      type: text.toLowerCase().includes("relocation") ? "relocation_allowance" : "bonus",
      amount: amount ? Number(amount[1].replace(/,/g, "")) : null,
      currency: "USD",
      description: text,
    }),
  });
};

let audit;
let adjustmentStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  adjustmentStore = new AdjustmentStore();
  handler = createUc09Handler({ adjustmentStore, audit, remote: fakeRemote });
});

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
        resolve({ status: this.statusCode, headers: this.headers, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

const session = { companyId: "co_test", authenticatedAdminId: "admin_1" };

// STRUCTURED, NOT FREE TEXT. This helper used to pass `requestText: "Process
// a $5,000 performance bonus for John Doe"`, relying on the parser's
// rule-based fallback to pull the figure out of the sentence with a regex.
// That fallback no longer exists (see adjustmentParser.js's own header — a
// wrong number here is paid out) and this devcontainer's .env carries a
// genuine but unreachable OPENAI_API_KEY, so `isConfigured()` now reports
// true and every one of these tests was making a real, slow, doomed OpenAI
// call before falling back to a refusal — 600ms+ per test instead of
// sub-millisecond. Structured input is the trusted path and always was.
function createAdjustment(overrides = {}) {
  return handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session,
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", description: "Performance bonus for John Doe" },
      reasonText: "Annual performance bonus",
      ...overrides,
    },
    { remote: fakeRemote, audit, adjustmentStore, judge: fakeJudge, parseAdjustment: fakeParse }
  );
}

test("GET /api/adjustments lists every processed adjustment, newest first — the dashboard's queue", async () => {
  const first = await createAdjustment({ externalRef: "list-9001" });
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createAdjustment({
    externalRef: "list-9002",
    adjustmentRequest: { type: "relocation_allowance", amount: 1_500_000, currency: "USD", amountTaxType: "gross", description: "Relocation top-up for Jane Smith" },
    reasonText: "Relocation assistance",
  });

  const res = await callApi(handler, { method: "GET", path: "/api/adjustments" });
  assert.equal(res.status, 200);
  assert.equal(res.body.adjustments.length, 2);
  assert.equal(res.body.adjustments[0].id, second.adjustmentId); // newest first
  assert.equal(res.body.adjustments[1].id, first.adjustmentId);
});

test("GET /api/adjustments returns an empty list, not an error, when none exist yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/adjustments" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.adjustments, []);
});

test("GET /api/adjustments/:id on a pending adjustment is actionable", async () => {
  const created = await createAdjustment({ externalRef: "9010" });
  assert.equal(created.decision, "dual_approval_required");
  const res = await callApi(handler, { method: "GET", path: "/api/adjustments/" + created.adjustmentId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.actionable, true);
});

test("GET /api/adjustments/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/adjustments/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("GET /api/adjustments/by-ticket/:externalRef finds the adjustment tied to a ticket", async () => {
  const created = await createAdjustment({ externalRef: "9011" });
  const res = await callApi(handler, { method: "GET", path: "/api/adjustments/by-ticket/9011" });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.adjustment.id, created.adjustmentId);
});

test("CONCURRENCY at the HTTP layer: two near-simultaneous approve calls execute the payment exactly ONCE", async () => {
  // Same disaster this pass fixed (test/uc09.test.js has the unit-level
  // version), driven through the real HTTP handler this time: a
  // createIncentive that counts its own calls, hit by two concurrent POSTs.
  let createIncentiveCalls = 0;
  const countingRemote = {
    ...fakeRemote,
    createIncentive: async (payload) => {
      createIncentiveCalls++;
      await new Promise((resolve) => setImmediate(resolve));
      return { success: true, incentiveId: `inc_${createIncentiveCalls}`, ...payload };
    },
  };
  const raceStore = new AdjustmentStore();
  const raceHandler = createUc09Handler({ adjustmentStore: raceStore, audit, remote: countingRemote });
  const created = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session,
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross" },
      reasonText: "test",
      externalRef: "race-http-9001",
    },
    { remote: countingRemote, audit, adjustmentStore: raceStore, judge: fakeJudge }
  );
  assert.equal(created.approvalSlotsRequired, 2);

  const [first, second] = await Promise.all([
    callApi(raceHandler, {
      method: "POST",
      path: "/api/adjustments/" + created.adjustmentId + "/approve",
      body: { role: "requester", approver: "ana" },
    }),
    callApi(raceHandler, {
      method: "POST",
      path: "/api/adjustments/" + created.adjustmentId + "/approve",
      body: { role: "approver", approver: "ben" },
    }),
  ]);

  assert.equal(createIncentiveCalls, 1, `expected exactly one createIncentive call, got ${createIncentiveCalls}`);
  const executedCount = [first, second].filter((r) => r.body.code === "executed").length;
  assert.equal(executedCount, 1, "exactly one of the two concurrent approvals may report executed");
  for (const r of [first, second]) {
    assert.ok(
      ["executed", "approved_awaiting_more", "execution_already_claimed"].includes(r.body.code),
      `unexpected outcome ${r.body.code}`
    );
  }
});

test("the floor-of-2 approval requirement holds: a $5,000 bonus needs exactly two approvals before executing", async () => {
  const created = await createAdjustment({ externalRef: "9012" });
  assert.equal(created.approvalSlotsRequired, 2, "sanity check on the seeded scenario");

  const first = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "requester", approver: "admin_1" },
  });
  assert.equal(first.status, 200);
  assert.notEqual(first.body.code, "executed", "one approval must never be enough");

  const second = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "approver", approver: "approver_amy" },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.code, "executed");

  const after1 = await callApi(handler, { method: "GET", path: "/api/adjustments/" + created.adjustmentId });
  assert.equal(after1.body.actionable, false);
  assert.equal(after1.body.adjustment.status, "executed");
});

test("a high-value adjustment needs a third (payment_releaser) approval — two is not enough", async () => {
  const created = await createAdjustment({
    externalRef: "9013",
    adjustmentRequest: { type: "relocation_allowance", amount: 1_500_000, currency: "USD", amountTaxType: "gross", description: "Relocation top-up for Jane Smith" },
    reasonText: "Relocation assistance",
  });
  assert.equal(created.approvalSlotsRequired, 3, "sanity check on the seeded scenario");

  await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "requester", approver: "admin_1" },
  });
  const second = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "approver", approver: "approver_amy" },
  });
  assert.notEqual(second.body.code, "executed", "two approvals must never be enough when three are required");

  const third = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "payment_releaser", approver: "releaser_ray" },
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.code, "executed");
});

test("POST .../deny by any role stops the adjustment before execution", async () => {
  const created = await createAdjustment({ externalRef: "9014" });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/deny",
    body: { role: "approver", approver: "approver_amy", note: "not approved" },
  });
  assert.equal(res.body.code, "denied");
  const after1 = await callApi(handler, { method: "GET", path: "/api/adjustments/" + created.adjustmentId });
  assert.equal(after1.body.adjustment.status, "denied");
});

test("POST .../approve with an unknown role is refused with 400", async () => {
  const created = await createAdjustment({ externalRef: "9015" });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "ceo", approver: "someone" },
  });
  assert.equal(res.status, 400);
});

test("POST .../approve with no approver identity is refused, not silently accepted", async () => {
  const created = await createAdjustment({ externalRef: "9016" });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/adjustments/" + created.adjustmentId + "/approve",
    body: { role: "requester" },
  });
  assert.notEqual(res.status, 200);
});

test("CORS advertises GET, POST, OPTIONS — matching the real write surface", async () => {
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
});

test("the adjustment view names the deciding gate in plain words, and the whole ladder", async () => {
  // UC-09's successful outcomes are phrased "…needs dual approval", which
  // reads like an objection and is not one. The ladder is what makes that
  // plain: every earlier gate is marked passed.
  const created = await createAdjustment({ externalRef: "gate-ladder-uc09" });
  assert.equal(created.decision, "dual_approval_required");
  const res = await callApi(handler, { method: "GET", path: "/api/adjustments/" + created.adjustmentId });

  assert.equal(res.body.adjustment.reason, "standard_adjustment_needs_dual_approval"); // slug preserved
  assert.equal(res.body.decidedBy.gate, "approval_sizing");
  assert.match(res.body.decidedBy.means, /normal successful outcome, not an objection/);
  assert.match(res.body.decidedBy.means, /Nothing has been paid/);

  assert.equal(res.body.gateLadder.length, res.body.decidedBy.total);
  assert.equal(res.body.gateLadder[res.body.decidedBy.position - 1].status, "decided");
  assert.ok(res.body.gateLadder.slice(0, res.body.decidedBy.position - 1).every((r) => r.status === "passed"));
});

test("a route the API does not expose returns 404, not a wildcard handler", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/nonsense" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

// ---------------------------------------------------------------------------
// F-20 (HIGH) — the approver may not be an unauthenticated string in the body
// ---------------------------------------------------------------------------
// The approval endpoints on uc04/05/06/09 read `body.approver` straight off an
// unauthenticated POST and handed it to the approval policy as the human who
// signed. A curl saying {"approver": "nobody@evil.test"} executed a real write
// and put that name in the audit log. Worse than the default being weak: there
// was no configuration in which it could be strong — the signed path did not
// exist for these services at all. It does now, and it is the same one
// src/review/ uses (src/shared/approverAuth.js).
// ---------------------------------------------------------------------------

/** A verifier bound to one known-good token, standing in for the RS256 one. */
const stubVerifier = {
  verify: (token) =>
    token === "good-token"
      ? { ok: true, approver: "verified.approver@remote.example" }
      : { ok: false, code: "invalid_signature", reason: "Signature did not verify." },
};

test("F-20. with signed identity required, a body-supplied approver is refused outright", async () => {
  const adjustment = await createAdjustment({ externalRef: "auth-9001" });
  const signedHandler = createUc09Handler({
    adjustmentStore,
    audit,
    remote: fakeRemote,
    requireSignedIdentity: true,
    zafVerifier: stubVerifier,
  });

  const res = await callApi(signedHandler, {
    method: "POST",
    path: `/api/adjustments/${adjustment.adjustmentId}/approve`,
    body: { role: "approver", approver: "nobody@evil.test", note: "let me in" },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_required");

  // Nothing was recorded against the claimed name.
  const row = await adjustmentStore.findById(adjustment.adjustmentId);
  assert.equal(row.approverApproval, null);
  assert.equal(row.status, "pending_approval");
});

test("F-20. a bad signature is refused, and a good one attributes the approval to the VERIFIED name", async () => {
  const adjustment = await createAdjustment({ externalRef: "auth-9002" });
  const signedHandler = createUc09Handler({
    adjustmentStore,
    audit,
    remote: fakeRemote,
    requireSignedIdentity: true,
    zafVerifier: stubVerifier,
  });
  const path = `/api/adjustments/${adjustment.adjustmentId}/approve`;

  const forged = await callApi(signedHandler, {
    method: "POST",
    path,
    headers: { "x-zaf-token": "forged" },
    body: { role: "approver", approver: "nobody@evil.test", note: "n" },
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.code, "invalid_signature");

  // A valid token, paired with a SPOOFED display name in the body and header.
  const good = await callApi(signedHandler, {
    method: "POST",
    path,
    headers: { "x-zaf-token": "good-token", "x-zaf-approver": "nobody@evil.test" },
    body: { role: "approver", approver: "nobody@evil.test", note: "n" },
  });
  assert.equal(good.status, 200);

  const row = await adjustmentStore.findById(adjustment.adjustmentId);
  assert.equal(row.approverApproval.approver, "verified.approver@remote.example");
  assert.notEqual(row.approverApproval.approver, "nobody@evil.test");
});

test("F-20. signed identity required with NO verifier configured fails closed, never back to the header", async () => {
  const adjustment = await createAdjustment({ externalRef: "auth-9003" });
  const misconfigured = createUc09Handler({
    adjustmentStore,
    audit,
    remote: fakeRemote,
    requireSignedIdentity: true,
    zafVerifier: null,
  });

  const res = await callApi(misconfigured, {
    method: "POST",
    path: `/api/adjustments/${adjustment.adjustmentId}/approve`,
    headers: { "x-zaf-token": "good-token", "x-zaf-approver": "someone@corp.example" },
    body: { role: "approver", approver: "someone@corp.example", note: "n" },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "signed_identity_not_configured");
  assert.equal((await adjustmentStore.findById(adjustment.adjustmentId)).approverApproval, null);
});

test("F-20. in the demo posture the header beats the body, so a spoofed body cannot shadow the sidebar", async () => {
  const adjustment = await createAdjustment({ externalRef: "auth-9004" });
  const res = await callApi(handler, {
    method: "POST",
    path: `/api/adjustments/${adjustment.adjustmentId}/approve`,
    headers: { "x-zaf-approver": "agent.real@remote.example" },
    body: { role: "approver", approver: "nobody@evil.test", note: "n" },
  });
  assert.equal(res.status, 200);
  assert.equal(
    (await adjustmentStore.findById(adjustment.adjustmentId)).approverApproval.approver,
    "agent.real@remote.example"
  );
});
