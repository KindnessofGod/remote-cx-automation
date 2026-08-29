// ---------------------------------------------------------------------------
// uc04Server.test.js  —  The UC-04 specialist-approval HTTP API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as uc06Server.test.js /
// playground.test.js: drives the real handler with no listening socket, so
// these prove the API wraps workflow.js/approvalPolicy.js correctly without
// adding a second copy of any gate.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { draftSummary } from "../src/uc04/requestParser.js";

let server;
let remote;

before(async () => {
  // 4067 — was 4025, which collided with remoteui.test.js's ZENDESK_PORT
  // under node --test's default parallel-file execution.
  server = await startMockServer(4067);
  remote = new RemoteClient({ baseUrl: "http://localhost:4067" });
});
after(() => server && server.close());

let audit;
let authorizationStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  authorizationStore = new AuthorizationStore();
  handler = createUc04Handler({ authorizationStore, audit, remote });
  // A decided request stops being `pending`, and only a `pending` one resolves.
  // Without this every test after the first approve would report "no Remote
  // counterpart" — an absence that reads exactly like the feature being broken.
  resetWorkAuthorizations();
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

const session = { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" };

// Never a real, retried LLM call from a test that only cares about the API
// surface — see test/uc04.test.js's identical fake for why.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function createAuthorization(overrides = {}) {
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session,
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        // ES, and matching the mock's own pending work-authorization request for
        // this employment (src/remote/mockServer.js). This used to be MX, which
        // was fine while the workflow CREATED the record it decided on; now that
        // it RESOLVES one, a destination Remote holds no request for makes every
        // approval here take the "no Remote counterpart" branch — so the API's
        // own execute path would never once be exercised over HTTP.
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
      ...overrides,
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

test("GET /api/authorizations lists every processed authorization, newest first — the dashboard's queue", async () => {
  const first = await createAuthorization();
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createAuthorization({ employmentId: "emp_active_003" }); // blocked

  const res = await callApi(handler, { method: "GET", path: "/api/authorizations" });
  assert.equal(res.status, 200);
  assert.equal(res.body.authorizations.length, 2);
  assert.equal(res.body.authorizations[0].id, second.authorizationId); // newest first
  assert.equal(res.body.authorizations[1].id, first.authorizationId);
});

test("GET /api/authorizations returns an empty list, not an error, when none exist yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.authorizations, []);
});

test("GET /api/authorizations/:id on a ready_for_authorization row is actionable", async () => {
  const created = await createAuthorization();
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.actionable, true);
  assert.equal(res.body.authorization.decision, "ready_for_approval");
});

test("GET /api/authorizations/:id on a blocked row is not actionable here", async () => {
  // emp_active_003 has workation_permission: false — the policy engine
  // returns blocked.
  const created = await createAuthorization({ employmentId: "emp_active_003" });
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(res.body.actionable, false);
  assert.match(res.body.actionableReason, /escalation|block/);
});

test("GET /api/authorizations/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("GET /api/authorizations/by-ticket/:externalRef finds the latest authorization for a Zendesk ticket id", async () => {
  const created = await createAuthorization();
  await authorizationStore.linkTicket(created.authorizationId, "ZD-1");
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/by-ticket/ZD-1" });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.authorization.id, created.authorizationId);
});

test("POST .../approve executes; a subsequent GET shows it decided", async () => {
  const created = await createAuthorization();

  const first = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: { approver: "mobility_sam" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.code, "executed");

  const after1 = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(after1.body.actionable, false);
  assert.equal(after1.body.authorization.status, "executed");
});

test("POST .../decline settles the authorization AND transmits the refusal to Remote", async () => {
  const created = await createAuthorization();
  const before = await remote.getWorkAuthorization(created.workAuthorizationId);
  assert.equal(before.status, "pending");

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/decline",
    body: { approver: "mobility_sam", note: "not approved" },
  });
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(after1.body.authorization.status, "declined");

  // Over real HTTP, end to end: the request the employee raised now carries the
  // employer's answer. A decline recorded only in our own store leaves that
  // request `pending` for ever.
  const after = await remote.getWorkAuthorization(created.workAuthorizationId);
  assert.equal(after.status, "declined_by_manager");
});

// The legacy path over real HTTP. The path segment has to be MATCHED by the
// router — an unmatched segment 404s before reaching any code that would
// normalise it — so this asserts routing, not just the alias map.
test("POST .../deny still routes, and records `declined`", async () => {
  const created = await createAuthorization();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/deny",
    body: { approver: "mobility_sam", note: "legacy bundle" },
  });
  assert.notEqual(res.body.code, "no_such_route", "the legacy path must still be routed");
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(after1.body.authorization.status, "declined");
});

test("POST .../approve with no approver identity is refused with 401", async () => {
  const created = await createAuthorization();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: {},
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "approver_required");
});

test("POST .../approve with an unknown action verb is refused with 400", async () => {
  const created = await createAuthorization();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/maybe",
    body: { approver: "mobility_sam" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_action");
});

test("POST .../approve on a blocked authorization is refused with 403, not silently auto-executed", async () => {
  // emp_active_003 is the fixture with no employer permission.
  const created = await createAuthorization({ employmentId: "emp_active_003" });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: { approver: "mobility_sam" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "not_awaiting_approval");
});

test("POST .../approve on a non-existent authorization id returns 404", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/does-not-exist/approve",
    body: { approver: "mobility_sam" },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "authorization_not_found");
});

// ---------------------------------------------------------------------------
// F-13 / F-14 at the API surface. The findings' proof was end to end — a
// lowercase "us" reaching `ready_for_approval` and then a real PATCH through
// this very API — so the fix is pinned here too, not only in the matrix.
// ---------------------------------------------------------------------------

test("F-13 API: a lowercase 'us' destination is not actionable and its approve is refused with 403", async () => {
  const created = await createAuthorization({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "us" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(created.decision, "blocked");

  const view = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(view.body.actionable, false, "a case-variant spelling must not open the 1-click path");

  const approve = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: { approver: "mobility_sam" },
  });
  assert.equal(approve.status, 403);
  assert.equal(approve.body.code, "not_awaiting_approval");
});

test("F-14 API: an unrecognised destination is escalated, not actionable, and cannot be approved", async () => {
  const created = await createAuthorization({
    factors: {
      homeCountry: "DE",
      nationality: "DE",
      destination: { country: "ZZ" },
      startDate: "2026-09-01",
      endDate: "2026-09-10",
      visaType: "business_visa",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
    },
  });
  assert.equal(created.decision, "escalate");
  assert.equal(created.reason, "destination_out_of_scope");

  const view = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(view.body.actionable, false);

  const approve = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations/" + created.authorizationId + "/approve",
    body: { approver: "mobility_sam" },
  });
  assert.equal(approve.status, 403);
  assert.equal(approve.body.code, "not_awaiting_approval");
});

test("the authorization view names the deciding gate in plain words, and the whole ladder", async () => {
  // emp_active_003 has workation_permission: false, so the blocking rung is
  // the employer-permission gate — position 3, before the risk matrix ever
  // runs. That distinction ("the employer hasn't allowed it" vs. "the trip is
  // unlawful") is invisible in the slug alone and is the whole point here.
  const created = await createAuthorization({ employmentId: "emp_active_003" });
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });

  assert.equal(res.body.authorization.reason, "employer_permission_not_granted"); // slug preserved
  assert.equal(res.body.decidedBy.gate, "employer_permission");
  // Position 4, not 3: the sanctions screen is gate 3 and runs ahead of it —
  // no approval and no extra information turns a sanctioned destination into a
  // yes, so nothing below it is worth asking about one.
  assert.equal(res.body.decidedBy.position, 4);
  assert.match(res.body.decidedBy.means, /employer/i);

  assert.equal(res.body.gateLadder.length, res.body.decidedBy.total);
  assert.deepEqual(
    res.body.gateLadder.slice(0, 5).map((r) => r.status),
    ["passed", "passed", "passed", "decided", "not_reached"]
  );
});

test("a ready_for_approval row's ladder shows every gate passed, decided at the outcome", async () => {
  const created = await createAuthorization();
  const res = await callApi(handler, { method: "GET", path: "/api/authorizations/" + created.authorizationId });
  assert.equal(res.body.decidedBy.reason, "all_gates_passed");
  assert.equal(res.body.gateLadder.at(-1).status, "decided");
  assert.ok(res.body.gateLadder.slice(0, -1).every((r) => r.status === "passed"));
  // A specialist still has to approve — "all gates passed" is not "approved".
  assert.match(res.body.decidedBy.means, /NOT approved yet/);
});

test("a route the API does not expose (e.g. POST /api/authorizations) returns 404, not a wildcard handler", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/authorizations",
    body: {},
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});
