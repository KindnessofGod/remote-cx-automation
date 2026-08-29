// ---------------------------------------------------------------------------
// uc06Server.test.js  —  The UC-06 dual-approval HTTP API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as review.test.js / playground.test.js:
// drives the real handler with no listening socket, so these prove the API
// wraps workflow.js/dualApprovalPolicy.js correctly without adding a second
// copy of any gate.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { createUc06Handler } from "../src/uc06/server.js";
import { draftSummary } from "../src/uc06/changeParser.js";

let server;
let remote;

before(async () => {
  server = await startMockServer(4095); // test band (4090-4099); never a live API port — see src/shared/ports.js
  remote = new RemoteClient({ baseUrl: "http://localhost:4095" });
});
after(() => server && server.close());

let audit;
let amendmentStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  amendmentStore = new AmendmentStore();
  handler = createUc06Handler({ amendmentStore, audit, remote });
});

function callApi(handler, { method, path, body = null }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: {},
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

// `admin_omar` FILES, `admin_jane` SIGNS slot 1 — see the twin comment in
// test/uc06.test.js. DRIFT-098 `[A-1]`: the requester may sign neither slot, so
// a fixture that files and signs under one identity is now (correctly) refused
// `requester_cannot_approve`.
const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_omar" };

// Never a real, retried LLM call from a test that only cares about the API
// surface — see test/uc06.test.js's identical fake for why.
// Runs the REAL draftSummary() forced into its unconfigured (template)
// branch — see test/uc06.test.js's identical fake for why.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function createAmendment(overrides = {}) {
  return handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      ...overrides,
    },
    { remote, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

test("GET /api/amendments lists every processed amendment, newest first — the dashboard's queue", async () => {
  const first = await createAmendment();
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createAmendment({ requestedEffectiveDate: "2026-06-15" }); // cutoff already passed -> escalated

  const res = await callApi(handler, { method: "GET", path: "/api/amendments" });
  assert.equal(res.status, 200);
  assert.equal(res.body.amendments.length, 2);
  assert.equal(res.body.amendments[0].id, second.amendmentId); // newest first
  assert.equal(res.body.amendments[1].id, first.amendmentId);
});

test("GET /api/amendments returns an empty list, not an error, when none exist yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/amendments" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.amendments, []);
});

test("GET /api/amendments/:id on a dual_approval_required amendment is actionable", async () => {
  const created = await createAmendment();
  const res = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.actionable, true);
  assert.equal(res.body.amendment.decision, "dual_approval_required");
});

test("GET /api/amendments/:id on an escalated amendment is not actionable here", async () => {
  const created = await createAmendment({ requestedEffectiveDate: "2026-06-15" }); // cutoff already passed
  const res = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(res.body.actionable, false);
  assert.equal(res.body.actionableReason, "This amendment was routed to escalation, not dual approval — it has no approve/decline path here.");
});

test("GET /api/amendments/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/amendments/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("POST .../approve as customer_admin then payroll_specialist executes; a third GET shows it decided", async () => {
  const created = await createAmendment();

  const first = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "customer_admin", approver: "admin_jane" },
  });
  assert.equal(first.body.code, "approved_awaiting_second");

  const second = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "payroll_specialist", approver: "payroll_sam" },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.code, "executed");

  const after1 = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(after1.body.actionable, false);
  assert.equal(after1.body.amendment.status, "executed");
});

test("POST .../decline by either role stops the amendment", async () => {
  const created = await createAmendment();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/decline",
    body: { role: "payroll_specialist", approver: "payroll_sam", note: "not approved" },
  });
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(after1.body.amendment.status, "declined");
});

// The legacy path over real HTTP — routing, not just the alias map.
test("POST .../deny still routes, and records `declined`", async () => {
  const created = await createAmendment();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/deny",
    body: { role: "payroll_specialist", approver: "payroll_sam", note: "legacy bundle" },
  });
  assert.notEqual(res.body.code, "no_such_route", "the legacy path must still be routed");
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(after1.body.amendment.status, "declined");
});

test("POST .../approve with an unknown role is refused with 400", async () => {
  const created = await createAmendment();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "ceo", approver: "someone" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_role");
});

test("POST .../approve with no approver identity is refused with 401", async () => {
  const created = await createAmendment();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "customer_admin" },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "approver_required");
});

// ---------------------------------------------------------------------------
// F-15 / F-26 at the API surface. Both findings' proof was a fully-processed
// amendment sitting in this API as approvable — the schema gate having passed
// vacuously on a 404 (F-15), or an unreadable cutoff reading as "not passed"
// (F-26b). So both are pinned here as "not actionable, and approve is
// refused", not only as a policy-engine return value.
// ---------------------------------------------------------------------------

/** The real client against the real mock, with only the country code changed
 *  — so `getCountrySchema` genuinely 404s and returns null, exercising the
 *  whole chain rather than a hand-stubbed value. */
const remoteWithNoCountrySchema = () => ({
  getEmployment: async (id) => ({ ...(await remote.getEmployment(id)), country_code: "ZZ" }),
  getCountrySchema: (code) => remote.getCountrySchema(code),
    getContractAmendmentSchema: (id, code) => remote.getContractAmendmentSchema(id, code),
  listPayrollRuns: (companyId) => remote.listPayrollRuns(companyId),
  createContractAmendment: (args, opts) => remote.createContractAmendment(args, opts),
});

test("F-15 API: an amendment whose country schema could not be fetched is escalated and cannot be approved", async () => {
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote: remoteWithNoCountrySchema(), audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(created.decision, "escalate");
  assert.equal(created.reason, "country_schema_unavailable");

  const view = await callApi(handler, { method: "GET", path: "/api/amendments/" + created.amendmentId });
  assert.equal(view.body.actionable, false, "an unvalidated payload must never be one click from a real PATCH");

  const approve = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "customer_admin", approver: "admin_jane" },
  });
  assert.equal(approve.status, 403);
  assert.equal(approve.body.code, "not_awaiting_approval");
});

test("F-26b API: an amendment against a cycle with an unreadable cutoff is escalated and cannot be approved", async () => {
  const remoteWithBrokenCutoff = {
    getEmployment: (id) => remote.getEmployment(id),
    getCountrySchema: (code) => remote.getCountrySchema(code),
    getContractAmendmentSchema: (id, code) => remote.getContractAmendmentSchema(id, code),
    listPayrollRuns: async () => ({
      payroll_runs: [
        { id: "run_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "TBC" },
      ],
    }),
    createContractAmendment: (args, opts) => remote.createContractAmendment(args, opts),
  };
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session,
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
    { remote: remoteWithBrokenCutoff, audit, amendmentStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  assert.equal(created.decision, "escalate");
  assert.equal(created.reason, "cutoff_date_unknown");

  const approve = await callApi(handler, {
    method: "POST",
    path: "/api/amendments/" + created.amendmentId + "/approve",
    body: { role: "customer_admin", approver: "admin_jane" },
  });
  assert.equal(approve.status, 403);
  assert.equal(approve.body.code, "not_awaiting_approval");
});
