// ---------------------------------------------------------------------------
// uc05Server.test.js  —  The UC-05 sign-off HTTP API
// ---------------------------------------------------------------------------
// Same request/response-double pattern as test/uc06Server.test.js and
// test/uc08Server.test.js: drives the real handler with no listening
// socket, so these prove the API wraps workflow.js/signoffPolicy.js
// correctly without adding a second copy of any gate.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { createUc05Handler } from "../src/uc05/server.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";

let server;
let remote;

before(async () => {
  // 4066 — was 4024, which collided with remoteui.test.js's REMOTE_PORT and
  // uc04.test.js's own (also-4024) port under node --test's default
  // parallel-file execution.
  server = await startMockServer(4066);
  remote = new RemoteClient({ baseUrl: "http://localhost:4066" });
});
after(() => server && server.close());

let audit;
let resignationStore;
let handler;

beforeEach(() => {
  audit = new AuditLogger();
  resignationStore = new ResignationStore();
  handler = createUc05Handler({ resignationStore, audit, remote });
});

// Default to the real extractFromLetter forced into its unconfigured
// (rule-based) branch — same hermetic guarantee as test/uc05.test.js.
const fakeExtract = (args) => extractFromLetter(args, { isConfigured: () => false });

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

const session = { authenticatedEmploymentId: "emp_uk_001" };

function createResignation(overrides = {}) {
  return handleResignationRequest(
    {
      session,
      employmentId: "emp_uk_001",
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
      now: "2026-08-16",
      // THE CONTRACTUAL HOURLY RATE, in Remote's x100 form (40.00/hour).
      // UC-05 now READS the accrued days from Remote's Time Off API
      // (GET /v1/leave-policies/summary/{id}) instead of taking whatever a
      // requester typed, and Remote publishes NO pay rate anywhere — see
      // src/remote/leaveBalances.js. So the rate is the one figure a request
      // still has to carry, and a request without it is refused at gate 7
      // rather than settled against an assumed 40-hour week. Supplying it here
      // is what makes the default path a POSITIVE exercise of the whole chain:
      // Remote's own balance x a stated rate = a real payout on the report.
      hourlyRateInRemoteInteger: 4000,
      ...overrides,
    },
    { remote, audit, resignationStore, extract: fakeExtract }
  );
}

test("GET /api/resignations lists every processed resignation, newest first — the dashboard's queue", async () => {
  const first = await createResignation();
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  const second = await createResignation({
    session: { authenticatedEmploymentId: "emp_pl_001" },
    employmentId: "emp_pl_001",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
  });

  const res = await callApi(handler, { method: "GET", path: "/api/resignations" });
  assert.equal(res.status, 200);
  assert.equal(res.body.resignations.length, 2);
  assert.equal(res.body.resignations[0].id, second.resignationId); // newest first
  assert.equal(res.body.resignations[1].id, first.resignationId);
});

test("GET /api/resignations returns an empty list, not an error, when none exist yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/resignations" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.resignations, []);
});

test("GET /api/resignations/:id on a prepared_for_signoff resignation is actionable", async () => {
  const created = await createResignation();
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.actionable, true);
  assert.equal(res.body.resignation.decision, "prepared_for_signoff");
  assert.equal(res.body.tier, "medium");
});

test("GET /api/resignations/:id on an escalated resignation is not actionable here", async () => {
  const created = await createResignation({
    session: { authenticatedEmploymentId: "emp_pl_001" },
    employmentId: "emp_pl_001",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
  });
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });
  assert.equal(res.body.actionable, false);
  // NAMES THE GATE AND WHAT IT MEANT, not "it was escalated". The row carries
  // `reason`, and UC-05's GATE_SEQUENCE carries a per-reason `means` beside the
  // gates themselves — this used to assert the generic REFUSALS string, which
  // was true of every escalated resignation and told a reader nothing about
  // this one.
  const reason = res.body.actionableReason;
  // Gate 7, not 6, since 2026-08-20: `no_statutory_notice_period` was inserted
  // into GATE_SEQUENCE between `unsupported_country` and
  // `no_matching_notice_bracket`, so every rung below it moved down one. The
  // number is pinned as a literal rather than derived from GATE_SEQUENCE on
  // purpose — deriving it would make this assertion tautological, and the
  // position IS the claim: this prose tells a human WHICH gate decided, and a
  // silently drifting number would misattribute the decision to its neighbour.
  assert.match(reason, /ESCALATED at gate 7 \(discrepancy\)/);
  assert.match(reason, /EARLIER than the statutory minimum notice allows/);
  // And the generic must NOT be what got rendered — the fallback still exists
  // for a row that cannot say which outcome it got, and it has to stay rare.
  assert.notEqual(reason, "This resignation was escalated, not prepared for sign-off — it has no sign-off path here.");
});

test("GET /api/resignations/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("GET /api/resignations/by-ticket/:externalRef finds the resignation tied to a ticket", async () => {
  await createResignation({ externalRef: "t-5001" });
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/by-ticket/t-5001" });
  assert.equal(res.status, 200);
  assert.equal(res.body.resignation.externalRef, "t-5001");
});

test("GET /api/resignations/by-ticket/:externalRef for a ticket with no resignation returns 404", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/by-ticket/no-such-ticket" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("POST /api/resignations/:id/signoff by HR Ops signs the report off; a third GET shows it decided", async () => {
  const created = await createResignation();
  const first = await callApi(handler, {
    method: "POST",
    path: "/api/resignations/" + created.resignationId + "/signoff",
    body: { approver: "hr_ops_jane", note: "looks correct" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.code, "signed_off");

  const after1 = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });
  assert.equal(after1.body.actionable, false);
  assert.equal(after1.body.resignation.status, "signed_off");
});

test("POST /api/resignations/:id/decline by HR Ops declines the report", async () => {
  const created = await createResignation();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/resignations/" + created.resignationId + "/decline",
    body: { approver: "hr_ops_jane", note: "wrong tenure" },
  });
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });
  assert.equal(after1.body.resignation.status, "declined");
});

// THE LEGACY ROUTE PATH, over real HTTP. The path segment has to be MATCHED by
// the router — an unmatched segment 404s before reaching any code that would
// normalise it — so this asserts routing, not just the alias map.
test("POST /api/resignations/:id/deny still routes, and records `declined`", async () => {
  const created = await createResignation();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/resignations/" + created.resignationId + "/deny",
    body: { approver: "hr_ops_jane", note: "legacy bundle" },
  });
  assert.notEqual(res.body.code, "no_such_route", "the legacy path must still be routed");
  assert.equal(res.body.code, "declined");
  const after1 = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });
  assert.equal(after1.body.resignation.status, "declined");
});

test("POST .../signoff with no approver identity is refused with 401", async () => {
  const created = await createResignation();
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/resignations/" + created.resignationId + "/signoff",
    body: {},
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "approver_required");
});

test("POST .../signoff on an escalated resignation is refused with 403", async () => {
  const created = await createResignation({
    session: { authenticatedEmploymentId: "emp_pl_001" },
    employmentId: "emp_pl_001",
    proposedEndDate: "2026-08-31",
    now: "2026-07-25",
  });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/resignations/" + created.resignationId + "/signoff",
    body: { approver: "hr_ops_jane" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "not_awaiting_signoff");
});

test("the resignation view names the deciding gate in plain words, and the whole ladder", async () => {
  const created = await createResignation({ externalRef: "gate-ladder-uc05" });
  assert.equal(created.decision, "prepared_for_signoff");
  const res = await callApi(handler, { method: "GET", path: "/api/resignations/" + created.resignationId });

  assert.equal(res.body.resignation.reason, "all_gates_passed"); // slug preserved
  assert.equal(res.body.decidedBy.gate, "outcome");
  assert.equal(res.body.decidedBy.position, res.body.decidedBy.total);
  // The one thing a reader most needs to know about a UC-05 success: signing
  // off records the report, it does not terminate anybody. That CLAIM is what
  // is pinned, not the sentence it was first written in — this used to read
  // /does not execute a termination/ and the same fact is now said in the words
  // the person reading it uses.
  assert.match(res.body.decidedBy.means, /does not end the employment/);
  // AND THE HALF THAT WAS ABOUT US IS GONE. The sentence used to finish "— UC-05
  // has no write path to Remote at all", which is true, is a statement about our
  // architecture, and was on the screen of somebody who wanted to know what had
  // become of their resignation (docs/UI-AUDIENCES.md). The architectural fact is
  // still recorded in docs/use-cases/UC-05.md and is not a fact for this reader.
  assert.ok(
    !/write path|UC-0\d/.test(res.body.decidedBy.means),
    `the success rung is talking about this system's shape again: ${res.body.decidedBy.means}`
  );

  assert.equal(res.body.gateLadder.length, res.body.decidedBy.total);
  assert.equal(res.body.gateLadder.at(-1).status, "decided");
  assert.ok(res.body.gateLadder.slice(0, -1).every((r) => r.status === "passed"));
});

test("CORS does not advertise any verb the API does not actually accept", async () => {
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.match(res.headers["access-control-allow-methods"], /^GET, POST, OPTIONS$/);
});
