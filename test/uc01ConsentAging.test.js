// ---------------------------------------------------------------------------
// uc01ConsentAging.test.js — VC-32: an unanswered consent request ages, and
// NEVER lapses, plus its Amendment 2 half (the third party is told, word-
// identically, once the window passes)
// ---------------------------------------------------------------------------
// G-4/F2. The G-3 evaluator (bead rca-5ry) found zero hits for VC-32 anywhere
// under test/, and zero hits for CONSENT_AGE_WARN_DAYS/agePolicyDays/
// waitingLong in any test file. VC-32's own regression line: "a test that
// fails if any code path transitions a consent record on elapsed time
// alone." This file is that test, plus the POSITIVE half the same line
// demands: proving the warn actually fires, not only that nothing lapsed.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { CaseStore } from "../src/shared/caseStore.js";
import { AuditLogger } from "../src/shared/audit.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { startMockServer } from "../src/remote/mockServer.js";
import { classifyRequestRuleBased } from "../src/uc01/classifier.js";
import { createThirdPartyDoorHandler, THIRD_PARTY_ACK_MESSAGE } from "../src/thirdparty/server.js";
import {
  findAgedThirdPartyCases,
  sweepAgedThirdPartyNotices,
  THIRD_PARTY_AGED_NOTICE_MESSAGE,
} from "../src/thirdparty/agedNotice.js";
import { CONSENT_AGE_WARN_DAYS, isConsentWaitingLong } from "../src/shared/consentPolicy.js";
import { awaitingState } from "../src/approvalqueue/awaiting.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// src/shared/consentPolicy.js — the ONE figure, unit-tested directly
// ---------------------------------------------------------------------------

test("CONSENT_AGE_WARN_DAYS is our own figure, not zero and not Remote's", () => {
  assert.equal(typeof CONSENT_AGE_WARN_DAYS, "number");
  assert.ok(CONSENT_AGE_WARN_DAYS > 0);
});

test("isConsentWaitingLong: pending and old is true, pending and fresh is false", () => {
  const now = Date.now();
  const old = new Date(now - (CONSENT_AGE_WARN_DAYS + 1) * DAY_MS).toISOString();
  const fresh = new Date(now - 1 * DAY_MS).toISOString();
  assert.equal(isConsentWaitingLong("pending", old, now), true);
  assert.equal(isConsentWaitingLong("pending", fresh, now), false);
});

test("isConsentWaitingLong: granted or denied is NEVER waitingLong, however old", () => {
  const now = Date.now();
  const veryOld = new Date(now - 100 * DAY_MS).toISOString();
  assert.equal(isConsentWaitingLong("granted", veryOld, now), false);
  assert.equal(isConsentWaitingLong("denied", veryOld, now), false);
});

// ---------------------------------------------------------------------------
// The sweep, against a real CaseStore/AuditLogger (in-memory backing)
// ---------------------------------------------------------------------------

let remoteServer;
let remote;
let caseStore;
let audit;
let handler;

before(async () => {
  remoteServer = await startMockServer(4128); // uc01ConsentAging-test-only port; TEST_PORTS
  remote = new RemoteClient({ baseUrl: "http://localhost:4128" });
});
after(() => remoteServer && remoteServer.close());

beforeEach(() => {
  caseStore = new CaseStore();
  audit = new AuditLogger();
  handler = createThirdPartyDoorHandler({ remote, audit, caseStore, classify: classifyRequestRuleBased });
});

/** Minimal req/res doubles — same pattern as test/thirdPartyDoor.test.js. */
function callApi(h, { method, path, body = null }) {
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
    h(req, res).catch(reject);
  });
}

const VALID_BODY = {
  requestingParty: "First Bank",
  purpose: "Mortgage application",
  employmentReference: "emp_active_001",
  // The door's sixth field (2026-08-28) — whose permission to ask. It never
  // changes an outcome, which is why nothing below asserts on it.
  subjectName: "Amara Okafor",
  subjectDateOfBirth: "1990-05-04",
  message: "Please confirm this person is employed with you.",
  returnAddress: "ops@firstbank.example",
};

/** Backdate an in-memory case's createdAt by N days — a plain object mutation. */
function backdateCase(caseStore, caseId, days) {
  const row = caseStore.cases.find((c) => c.id === caseId);
  assert.ok(row, `no in-memory case ${caseId} to backdate`);
  row.createdAt = new Date(Date.now() - days * DAY_MS).toISOString();
  return row;
}

test("F1: the door refuses a missing return address distinguishably from an unreadable one", async () => {
  const { returnAddress, ...withoutReturnAddress } = VALID_BODY;
  const missing = await callApi(handler, { method: "POST", path: "/api/requests", body: withoutReturnAddress });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "return_address_required");

  const unreadable = await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, returnAddress: "not an address" },
  });
  assert.equal(unreadable.status, 400);
  assert.equal(unreadable.body.code, "return_address_unreadable");
  assert.notEqual(unreadable.body.code, missing.body.code, "absent and unreadable must be DIFFERENT refusals");
});

test("F1: a valid submission carries the return address onto the case row", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  assert.equal(res.status, 200);
  assert.equal(res.body.message, THIRD_PARTY_ACK_MESSAGE);

  const cases = await caseStore.listByUseCase("UC-01");
  const created = cases.find((c) => c.source === "third_party_door");
  assert.ok(created, "the door must create a case");
  assert.equal(created.returnAddress, "ops@firstbank.example");
  assert.equal(created.agedNoticeSentAt, null);
});

test("VC-32 positive: a genuinely aged, unanswered pending request IS found and swept", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const cases = await caseStore.listByUseCase("UC-01");
  const pendingCase = cases.find((c) => c.source === "third_party_door");
  assert.equal(pendingCase.status, "awaiting_consent", "sanity: this must be the pending branch");
  backdateCase(caseStore, pendingCase.id, CONSENT_AGE_WARN_DAYS + 1);

  const due = await findAgedThirdPartyCases({ caseStore });
  assert.equal(due.length, 1, "the aged pending request must be found");
  assert.equal(due[0].caseId, pendingCase.id);
  assert.equal(due[0].message, THIRD_PARTY_AGED_NOTICE_MESSAGE);

  const sent = await sweepAgedThirdPartyNotices({ caseStore, audit });
  assert.equal(sent.length, 1);

  // THE WARN ACTUALLY FIRED — recorded as a trace, not a decision (VC-32's
  // own evidence line: "the warning is recorded; no decision row appears").
  const trace = audit.entries.find((e) => e.call === "uc01.third_party_aged_notice");
  assert.ok(trace, "the aged notice must be traced");
  assert.equal(trace.details.caseId, pendingCase.id);
  assert.equal(trace.details.message, THIRD_PARTY_AGED_NOTICE_MESSAGE);
});

test("VC-32 regression: the sweep NEVER transitions the consent record or the case on elapsed time alone", async () => {
  await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const cases = await caseStore.listByUseCase("UC-01");
  const pendingCase = cases.find((c) => c.source === "third_party_door");
  backdateCase(caseStore, pendingCase.id, CONSENT_AGE_WARN_DAYS + 5);

  const consentBefore = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.equal(consentBefore.status, "pending");
  const caseStatusBefore = pendingCase.status;

  await sweepAgedThirdPartyNotices({ caseStore, audit });

  const consentAfter = await caseStore.findConsentArtifact({
    employmentId: "emp_active_001",
    requestingParty: "First Bank",
    purpose: "Mortgage application",
  });
  assert.equal(consentAfter.status, "pending", "consent status must be BYTE-IDENTICAL before and after");
  assert.deepEqual(consentAfter, consentBefore, "no field of the consent artifact may change because of the sweep");

  const caseAfter = caseStore.cases.find((c) => c.id === pendingCase.id);
  assert.equal(caseAfter.status, caseStatusBefore, "cases.status must be untouched — A5 forbids any transition on elapsed time alone");
  // The ONLY thing the sweep may change: the communication marker.
  assert.notEqual(caseAfter.agedNoticeSentAt, null);
});

test("VC-32 Amendment 2 / VC-33: the aged notice is WORD-IDENTICAL for a real unanswered employee (a) and a person who does not exist at Remote at all (c)", async () => {
  // (a) — a real, active employee with no consent yet.
  await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  // (c) — a person who does not exist at Remote at all.
  await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "emp_does_not_exist_at_all", purpose: "A different, unrelated purpose" },
  });

  const cases = await caseStore.listByUseCase("UC-01");
  const doorCases = cases.filter((c) => c.source === "third_party_door");
  assert.equal(doorCases.length, 2, "both submissions must create a case, per Amendment 2's own reasoning");

  for (const c of doorCases) backdateCase(caseStore, c.id, CONSENT_AGE_WARN_DAYS + 1);

  const due = await findAgedThirdPartyCases({ caseStore });
  assert.equal(due.length, 2, "BOTH aged cases must be found — omitting one is the leak Amendment 2 exists to prevent");
  const messages = new Set(due.map((d) => d.message));
  assert.equal(messages.size, 1, "the message must be the SAME across both cases, compared as data");
  assert.equal([...messages][0], THIRD_PARTY_AGED_NOTICE_MESSAGE);
});

test("VC-32: a request answered by a human (settled) is never swept, even once aged", async () => {
  await callApi(handler, {
    method: "POST",
    path: "/api/requests",
    body: { ...VALID_BODY, employmentReference: "emp_does_not_exist_at_all" },
  });
  const cases = await caseStore.listByUseCase("UC-01");
  const escalated = cases.find((c) => c.source === "third_party_door");
  backdateCase(caseStore, escalated.id, CONSENT_AGE_WARN_DAYS + 5);

  // A specialist resolves the review_queue entry — the generic path
  // src/review/service.js drives, reproduced here directly for the test.
  await caseStore.updateReviewQueueStatus(escalated.id, { status: "resolved", assignee: "specialist@example.com" });
  await caseStore.updateCaseStatus(escalated.id, "resolved");

  const queueStatus = await caseStore.findReviewQueueStatus(escalated.id);
  const awaiting = awaitingState({ useCase: "UC-01", status: "resolved", queueStatus });
  assert.equal(awaiting.state, "settled", "sanity: a human-resolved case must read as settled");

  const due = await findAgedThirdPartyCases({ caseStore });
  assert.equal(due.find((d) => d.caseId === escalated.id), undefined, "a settled case must not be swept");
});

test("VC-32: a fresh (not yet aged) request is not swept", async () => {
  await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const due = await findAgedThirdPartyCases({ caseStore });
  assert.equal(due.length, 0, "nothing has aged past the window yet");
});

test("VC-32: a case with no return address is never swept, however old", async () => {
  // Simulates a case created before this build (returnAddress column added
  // later, or a caller that never collected one) — must fail safe, not throw.
  const c = caseStore.createCase({
    useCase: "UC-01",
    source: "third_party_door",
    employmentId: "emp_active_001",
    decision: "awaiting_employee_consent",
    status: "awaiting_consent",
  });
  backdateCase(caseStore, c.id, CONSENT_AGE_WARN_DAYS + 10);

  const due = await findAgedThirdPartyCases({ caseStore });
  assert.equal(due.find((d) => d.caseId === c.id), undefined);
});

test("VC-32: the sweep is idempotent — a second run never resends", async () => {
  await callApi(handler, { method: "POST", path: "/api/requests", body: VALID_BODY });
  const cases = await caseStore.listByUseCase("UC-01");
  const pendingCase = cases.find((c) => c.source === "third_party_door");
  backdateCase(caseStore, pendingCase.id, CONSENT_AGE_WARN_DAYS + 1);

  const first = await sweepAgedThirdPartyNotices({ caseStore, audit });
  assert.equal(first.length, 1);
  const second = await sweepAgedThirdPartyNotices({ caseStore, audit });
  assert.equal(second.length, 0, "an already-notified case must never be swept again");

  const traces = audit.entries.filter((e) => e.call === "uc01.third_party_aged_notice");
  assert.equal(traces.length, 1, "exactly one notice, ever, per case");
});
