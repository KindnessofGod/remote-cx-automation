// ---------------------------------------------------------------------------
// requesterSubject.test.js  —  who filed this, about whom, and what "verified"
//                              actually proved
// ---------------------------------------------------------------------------
// WHY IT IS A SEPARATE FILE FROM employeeSubject.test.js
//
// They answer two different questions that a panel had collapsed into one row
// reading `Requester: admin_jane`. A request is made by one party ABOUT another,
// and every identity gate in this repository is a COMPARISON between those two
// — so the SUBJECT (employeeSubject) and the FILER (this file) are separate
// facts, and the relationship between them is a third.
//
// The block existed on UC-04 alone since 2026-08-19 and was never rendered.
// These assertions pin the two properties that make it worth rendering: the
// shape is IDENTICAL across use cases (one renderer, not nine) while the
// wording is specific to what each gate actually compared, and "verified" is
// never allowed to read as evidence about the human behind the session.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer, resetWorkAuthorizations } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleTravelInquiry } from "../src/uc03/workflow.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { createUc03Handler } from "../src/uc03/server.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { describeRequesterParties, UNAUTHENTICATED } from "../src/shared/requesterSubject.js";
import { requesterParties } from "../src/uc04/decisionFacts.js";

const TEST_PORT = 4122; // allocated in src/shared/ports.js TEST_PORTS

let remoteServer;
let remote;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});
after(() => remoteServer?.close());

let audit;
let caseStore;
let authorizationStore;

beforeEach(() => {
  audit = new AuditLogger();
  caseStore = new CaseStore();
  authorizationStore = new AuthorizationStore();
  resetWorkAuthorizations();
});

function callApi(handler, path) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: path,
      headers: {},
      on(event, cb) {
        if (event === "end") setImmediate(cb);
        return req;
      },
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

const classify = async (text) => classifyTravelInquiryRuleBased(text);

function travelCase({ externalRef = "7001", employmentId = "emp_active_001", sessionId = "emp_active_001" } = {}) {
  return handleTravelInquiry(
    {
      externalRef,
      source: "zendesk",
      employmentId,
      session: sessionId ? { authenticatedEmploymentId: sessionId } : null,
      text: "I need a formal travel support letter for a business trip to Spain from 2026-09-01 to 2026-09-10.",
    },
    { remote, audit, caseStore, classify }
  );
}

const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function workation({ externalRef = "5001" } = {}) {
  return handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      externalRef,
      source: "portal",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "ES" },
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-15",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
}

// ===========================================================================
// One shape across use cases — the thing that makes one renderer possible
// ===========================================================================

test("UC-03 and UC-04 publish `requester` with identical keys and identical state vocabularies", async () => {
  await travelCase();
  await workation();

  const three = (await callApi(createUc03Handler({ caseStore, audit, remote }), "/api/cases/by-ticket/7001")).body;
  const four = (await callApi(createUc04Handler({ authorizationStore, audit, remote }), "/api/authorizations/by-ticket/5001")).body;

  assert.deepEqual(Object.keys(three.requester).sort(), ["actingFor", "filedBy", "identity", "intake"]);
  assert.deepEqual(Object.keys(three.requester).sort(), Object.keys(four.requester).sort());
  for (const key of ["filedBy", "actingFor", "identity", "intake"]) {
    assert.deepEqual(
      Object.keys(three.requester[key]).sort(),
      Object.keys(four.requester[key]).sort(),
      `${key} differs in shape between UC-03 and UC-04`
    );
  }
});

test("UC-04's top-level `requester` is the same computation as `basis.requester`, not a second one that can drift", async () => {
  await workation();
  const res = (await callApi(createUc04Handler({ authorizationStore, audit, remote }), "/api/authorizations/by-ticket/5001")).body;

  for (const key of ["filedBy", "actingFor", "identity", "intake"]) {
    assert.deepEqual(res.requester[key], res.basis.requester[key], `${key} disagrees between the two placements`);
  }
  // basis.requester stays the UC-04-specific SUPERSET: `subject` and
  // `statedReason` are analysis of the four dimensions and belong beside them.
  assert.ok(res.basis.requester.subject);
  assert.equal(res.requester.subject, undefined);
});

// ===========================================================================
// The three questions, answered rather than assumed
// ===========================================================================

test("UC-03's usual case — the traveller asking about their own trip — is COMPARED, not assumed", async () => {
  await travelCase();
  const res = (await callApi(createUc03Handler({ caseStore, audit, remote }), "/api/cases/by-ticket/7001")).body;

  assert.equal(res.requester.filedBy.state, "authenticated_employee_session");
  assert.equal(res.requester.filedBy.id, "emp_active_001");
  assert.equal(res.requester.actingFor.state, "the_subject_themselves");
  assert.equal(res.requester.intake.source, "zendesk");
  assert.equal(res.requester.intake.externalRef, "7001");
});

test("a UC-03 session naming a DIFFERENT employment says so, and the filedBy sentence does not contradict it", async () => {
  await travelCase({ externalRef: "7002", employmentId: "emp_active_001", sessionId: "emp_active_003" });
  const res = (await callApi(createUc03Handler({ caseStore, audit, remote }), "/api/cases/by-ticket/7002")).body;

  assert.equal(res.found, true);
  assert.equal(res.caseRow.reason, "identity_not_verified");
  assert.equal(res.requester.actingFor.state, "on_behalf_of_the_subject");
  assert.equal(res.requester.identity.state, "not_verified");
  // The first draft of this block asserted in `filedBy` that the filer WAS the
  // traveller, which contradicted `actingFor` the moment a mismatch appeared.
  // Whether they are the same person is one answer, computed once.
  assert.doesNotMatch(res.requester.filedBy.finding, /the filer here is the traveller/);
});

test("UC-04's filer is an administrator acting on someone else's record, and the block says whose", async () => {
  await workation();
  const res = (await callApi(createUc04Handler({ authorizationStore, audit, remote }), "/api/authorizations/by-ticket/5001")).body;

  assert.equal(res.requester.filedBy.state, "authenticated_company_actor");
  assert.equal(res.requester.filedBy.id, "admin_jane");
  assert.equal(res.requester.actingFor.state, "on_behalf_of_the_subject");
  assert.match(res.requester.actingFor.finding, /emp_active_001/);
});

test("`verified` never reads as evidence about the human behind the session — on either use case", async () => {
  await travelCase();
  await workation();
  const three = (await callApi(createUc03Handler({ caseStore, audit, remote }), "/api/cases/by-ticket/7001")).body;
  const four = (await callApi(createUc04Handler({ authorizationStore, audit, remote }), "/api/authorizations/by-ticket/5001")).body;

  assert.equal(three.requester.identity.state, "verified");
  assert.equal(four.requester.identity.state, "verified");
  assert.match(three.requester.identity.finding, /not proof of who was at the keyboard/);
  assert.match(four.requester.identity.finding, /not evidence about who the person behind the session is/);
  // `checks` names what was actually compared, and the two gates compare
  // different things — an employment id against a record's own id, and a
  // session's company id against the employment's.
  assert.match(three.requester.identity.checks, /employment id equals the id on that record/);
  assert.match(four.requester.identity.checks, /company id equals the employment's company id/);
});

// ===========================================================================
// The three filer states, which are three and not two
// ===========================================================================

test("'unauthenticated' is a recorded fact; a missing field is a different one; neither is folded into the other", () => {
  const none = describeRequesterParties({ filerId: UNAUTHENTICATED, subjectEmploymentId: "e1", identityVerified: false });
  assert.equal(none.filedBy.state, "unauthenticated");
  assert.equal(none.filedBy.id, null);

  const missing = describeRequesterParties({ filerId: null, subjectEmploymentId: "e1", identityVerified: false });
  assert.equal(missing.filedBy.state, "not_recorded");
  assert.match(missing.filedBy.finding, /a record with the field missing/);

  // And with no filer at all, the relationship is UNKNOWN — never "on behalf".
  assert.equal(missing.actingFor.state, "unknown");
  assert.equal(none.actingFor.state, "unknown");
});

test("a self-filed request is recognised by comparing the ids, so a future self-service surface is described correctly on day one", () => {
  const self = describeRequesterParties({ filerId: "e1", subjectEmploymentId: "e1", identityVerified: true });
  assert.equal(self.actingFor.state, "the_subject_themselves");
  const other = describeRequesterParties({ filerId: "e2", subjectEmploymentId: "e1", identityVerified: true });
  assert.equal(other.actingFor.state, "on_behalf_of_the_subject");
});

test("it decides nothing: identityVerified is taken from the caller's flag, never recomputed", () => {
  // Handed a filer, a subject and a FALSE verdict, it reports not_verified even
  // though the two ids match perfectly. A describer that could disagree with the
  // gate would be a second gate nobody reviewed.
  const block = describeRequesterParties({ filerId: "e1", subjectEmploymentId: "e1", identityVerified: false });
  assert.equal(block.identity.state, "not_verified");
  assert.equal(block.actingFor.state, "the_subject_themselves");
});

test("requesterParties() returns null for no row, rather than a block describing nobody", () => {
  assert.equal(requesterParties({ authorizationRow: null }), null);
  assert.equal(requesterParties({}), null);
});
