// ---------------------------------------------------------------------------
// uc03Server.test.js  —  UC-03's case HTTP API (has sign-off write routes)
// ---------------------------------------------------------------------------
// Same request/response-double pattern as uc08Server.test.js: drives the real
// handler with no listening socket.
//
// This file used to headline "the absence of any write route". That absence is
// what `docs/APPROVAL-QUEUE.md` §0 measured, live, as UC-03 cases in the
// category `no_approval_surface`. There is now exactly ONE write route — the
// formal travel letter's sign-off — and the assertions here have moved with it:
// the surface is proved to exist for the one decision that needs it, and proved
// to refuse every other UC-03 outcome by name. The end-to-end sign-off, both
// directions, lives in test/uc03Signoff.test.js.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { createUc03Handler } from "../src/uc03/server.js";

const TEST_PORT = 4094; // test band (4090-4099); never a live API port — see src/shared/ports.js

let remoteServer;
let remote;
let audit;
let caseStore;
let handler;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});

after(() => remoteServer?.close());

beforeEach(() => {
  audit = new AuditLogger();
  caseStore = new CaseStore();
  handler = createUc03Handler({ caseStore });
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

/** Create a real case through the workflow (rule-based classifier — hermetic). */
function createCase(overrides = {}, deps = {}) {
  return handleTravelInquiry(
    { text: "default", employmentId: "emp_active_001", session: { authenticatedEmploymentId: "emp_active_001" }, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, ...deps }
  );
}

/**
 * The posture in which a letter request stops for a specialist, which two tests
 * below need because they are ABOUT the queue entry and the drafted document.
 * On the default posture that request issues the letter and there is neither —
 * see test/uc03AutoIssue.test.js, which asserts that view from this same API.
 */
const SIGNATURE_REQUIRED = { letterAutoIssue: false };

test("GET /api/cases lists every UC-03 case, newest first — the dashboard's queue", async () => {
  await createCase({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
    externalRef: "list-a",
  });
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct createdAt
  await createCase({
    text: "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
    externalRef: "list-b",
  });

  const res = await callApi(handler, { method: "GET", path: "/api/cases" });
  assert.equal(res.status, 200);
  assert.equal(res.body.cases.length, 2);
  assert.equal(res.body.cases[0].externalRef, "list-b"); // newest first
  assert.equal(res.body.cases[1].externalRef, "list-a");
});

test("GET /api/cases returns an empty list, not an error, when nothing has been decided yet", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/cases" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.cases, []);
});

test("GET /api/cases/:id returns the full case with its review entry and documents", async () => {
  const created = await createCase(
    {
      text: "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
      externalRef: "9010",
    },
    SIGNATURE_REQUIRED
  );
  assert.equal(created.decision, "human_review");
  const res = await callApi(handler, { method: "GET", path: "/api/cases/" + created.caseId });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.caseRow.decision, "human_review");
  assert.equal(res.body.caseRow.status, "pending_review");
  assert.ok(res.body.reviewEntry, "the specialist queue entry is surfaced");
  assert.ok(res.body.documents.some((d) => d.type === "travel_support_letter"), "the drafted letter is surfaced");
});

test("GET /api/cases/by-ticket/:externalRef finds the case tied to a ticket", async () => {
  await createCase({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
    externalRef: "ZT-555",
  });
  const res = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/ZT-555" });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.caseRow.externalRef, "ZT-555");
  assert.equal(res.body.caseRow.decision, "auto_resolve");
});

test("GET /api/cases/:id for an unknown id returns 404, not a guess", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/cases/does-not-exist" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("GET /api/cases/by-ticket/:externalRef for a ticket with no case returns 404", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/no-such-ticket" });
  assert.equal(res.status, 404);
  assert.equal(res.body.found, false);
});

test("the only write verbs are signoff and decline — anything else 404s as no_such_route", async () => {
  // The surface is deliberately not a general approve endpoint. `approve` is
  // not a UC-03 verb and must not be quietly accepted as one: a generic
  // approve route is how a router acquires the power to approve things it has
  // no business approving.
  const created = await createCase({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    externalRef: "9011",
  });
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + created.caseId + "/approve",
    body: { approver: "someone", note: "looks fine" },
  });
  // Routed (the segment is not whitelisted, so the legacy `deny` spelling still
  // reaches the policy) and then refused by the policy's own ACTIONS check,
  // which is the check that must hold.
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_action");

  const deeper = await callApi(handler, {
    method: "POST",
    path: "/api/cases/" + created.caseId + "/signoff/extra",
    body: { approver: "someone" },
  });
  assert.equal(deeper.status, 404);
  assert.equal(deeper.body.code, "no_such_route");
});

test("CORS advertises the one write verb the API has, and no more", async () => {
  const res = await callApi(handler, { method: "GET", path: "/healthz" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.headers["access-control-allow-methods"], "GET, POST, OPTIONS");
  assert.doesNotMatch(res.headers["access-control-allow-methods"], /PATCH|PUT|DELETE/);
});

test("the by-ticket route takes precedence over the generic :id route", async () => {
  // A ticket id that looks like a UUID must still match by-ticket, not :id.
  await createCase({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    externalRef: "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000",
  });
  const res = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000" });
  assert.equal(res.status, 200);
  assert.equal(res.body.found, true);
});

test("the case view carries the deciding gate in plain words, and the whole ladder", async () => {
  // Before this, the API handed a caller nothing but
  // `reason: "formal_letter_requested"` — readable only by someone who already
  // knew the gate order. The slug stays (it is what audit_log keys on); the
  // meaning now travels beside it.
  const created = await createCase(
    {
      text: "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
      externalRef: "gate-ladder-uc03",
    },
    SIGNATURE_REQUIRED
  );
  const res = await callApi(handler, { method: "GET", path: "/api/cases/by-ticket/gate-ladder-uc03" });

  assert.equal(res.body.caseRow.reason, created.reason); // the raw slug is still there
  assert.equal(res.body.decidedBy.reason, created.reason);
  // THE GATE'S NAME MOVED WITH ITS JOB. It was `formal_letter` and answered "did
  // they ask for a letter?"; the rung now answers "may this letter be issued
  // automatically, and is there a letterhead for it?", which is a different
  // question and gets a different name.
  assert.equal(res.body.decidedBy.gate, "letter_issuable");
  assert.match(res.body.decidedBy.means, /requires a specialist's signature|no letterhead/);

  assert.equal(res.body.gateLadder.length, res.body.decidedBy.total);
  assert.equal(res.body.gateLadder[res.body.decidedBy.position - 1].status, "decided");
  assert.ok(res.body.gateLadder.slice(0, res.body.decidedBy.position - 1).every((r) => r.status === "passed"));
  assert.equal(res.body.gateLadder.at(-1).status, "not_reached");
});
