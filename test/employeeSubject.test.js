// ---------------------------------------------------------------------------
// employeeSubject.test.js  —  the person a decision is about, published by name
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR
//
// The defect it closes was not a crash and no test could have failed on it: the
// nine by-ticket views were CORRECT and complete about the decision and silent
// about the human. A specialist deciding whether to sign a travel letter was
// shown `emp_active_001` where "Amara Okafor" belongs. There is no assertion
// for "said less than it knew", which is the same shape as C-27 (pattern P7)
// one layer over — so the assertions here are about what a view now PUBLISHES,
// and about the four ways it must fail out loud when it cannot.
//
// Both use cases are driven through their REAL handlers against the real mock
// Remote server, not by calling describeEmployee() alone: the question is what
// a sidebar actually receives, and a unit test of the describer cannot answer
// that a server forgot to call it.
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
import {
  describeEmployee,
  EMPLOYEE_FIELD_KEYS,
  SUBJECT_AVAILABLE,
  SUBJECT_NOT_FOUND,
  SUBJECT_NOT_LOOKED_UP,
  SUBJECT_NO_EMPLOYMENT_ID,
  SUBJECT_UNAVAILABLE,
} from "../src/shared/employeeSubject.js";

const TEST_PORT = 4121; // allocated in src/shared/ports.js TEST_PORTS

let remoteServer;
let remote;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});
after(() => remoteServer?.close());

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

// -- UC-03 fixtures ---------------------------------------------------------

let audit;
let caseStore;
let authorizationStore;

beforeEach(() => {
  audit = new AuditLogger();
  caseStore = new CaseStore();
  authorizationStore = new AuthorizationStore();
  resetWorkAuthorizations();
});

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
// The name is there, on both, from the real handler
// ===========================================================================

test("UC-03's by-ticket view names the person the letter would be about, not their uuid", async () => {
  await travelCase();
  const handler = createUc03Handler({ caseStore, audit, remote });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");

  assert.equal(res.status, 200);
  assert.equal(res.body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(res.body.employee.displayName, "Amara Okafor");
  assert.equal(res.body.employee.employmentId, "emp_active_001");
});

test("UC-04's by-ticket view names the person the workation is for", async () => {
  await workation();
  const handler = createUc04Handler({ authorizationStore, audit, remote });
  const res = await callApi(handler, "/api/authorizations/by-ticket/5001");

  assert.equal(res.status, 200);
  assert.equal(res.body.employee.state, SUBJECT_AVAILABLE);
  assert.equal(res.body.employee.displayName, "Amara Okafor");
});

test("UC-04's single-authorization view carries the same block as its by-ticket view — one sidebar, one shape", async () => {
  const created = await workation();
  const handler = createUc04Handler({ authorizationStore, audit, remote });
  const byId = await callApi(handler, "/api/authorizations/" + created.authorizationId);
  const byTicket = await callApi(handler, "/api/authorizations/by-ticket/5001");

  assert.deepEqual(
    byId.body.employee.fields.map((f) => f.key),
    byTicket.body.employee.fields.map((f) => f.key)
  );
  assert.equal(byId.body.employee.displayName, byTicket.body.employee.displayName);
});

// ===========================================================================
// The fields each use case chose, and the argument behind the choice
// ===========================================================================

test("UC-03 publishes exactly the rows the travel letter prints, plus the origin country the handoff carries", async () => {
  await travelCase();
  const handler = createUc03Handler({ caseStore, audit, remote });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");

  // renderTravelLetterHtml() prints Employee / Job title / Employment status /
  // Contract type / Start date. A signature over an assertion nobody was shown
  // is not a control, so the panel shows the same five — and `country_code`,
  // which workflow.js hands to UC-04 as `origin_country` on every route.
  assert.deepEqual(
    res.body.employee.fields.map((f) => f.key),
    ["full_name", "job_title", "status", "contract_type", "start_date", "country_code"]
  );
});

test("UC-04 publishes the record's own country beside the country the request STATED, because nothing else ever compares them", async () => {
  await workation();
  const handler = createUc04Handler({ authorizationStore, audit, remote });
  const res = await callApi(handler, "/api/authorizations/by-ticket/5001");

  const country = res.body.employee.fields.find((f) => f.key === "country_code");
  assert.ok(country, "no country row on UC-04's employee block");
  // The mock employment is Nigerian; the request states DE as the home country.
  // Nothing in riskMatrix.js compares them — basis.requester says so in its own
  // words — so the ONLY place that mismatch can be caught is a human reading
  // both. This assertion exists to stop the row being dropped as redundant.
  assert.match(country.value, /\(NG\)/);
  assert.match(
    res.body.basis.requester.subject.statedHomeCountry.finding,
    /never compared to it/
  );
});

test("UC-04 does not publish a start date — tenure is not one of its four dimensions", async () => {
  await workation();
  const handler = createUc04Handler({ authorizationStore, audit, remote });
  const res = await callApi(handler, "/api/authorizations/by-ticket/5001");
  assert.equal(res.body.employee.fields.find((f) => f.key === "start_date"), undefined);
});

// ===========================================================================
// MONEY IS A DECISION, NOT A DEFAULT  (CLAUDE.md §3)
// ===========================================================================

test("no employee block on either use case can publish pay, hours or currency — the registry has no such field", () => {
  // Structural, not behavioural: a behavioural test only proves this fixture
  // carries no salary. There is no key for a caller to ask for, so no future
  // call site can add one by passing a string.
  for (const key of EMPLOYEE_FIELD_KEYS) {
    assert.doesNotMatch(key, /salary|compensation|pay|wage|hours|currency|bank/i, `registry offers ${key}`);
  }
  assert.rejects(
    () => describeEmployee({ remote, employmentId: "emp_active_001", fields: ["annual_gross_salary"] }),
    /unknown field 'annual_gross_salary'/
  );
});

test("UC-03's travel-letter view publishes no money anywhere in its employee block", async () => {
  await travelCase();
  const handler = createUc03Handler({ caseStore, audit, remote });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");
  const serialized = JSON.stringify(res.body.employee);
  // src/uc01/letter.js renders a verification letter with zero salary and two
  // tests pin it. The signer's SCREEN is held to the same rule: this signature
  // does not turn on what the person is paid.
  assert.doesNotMatch(serialized, /salary|compensation|annual_gross|currency/i);
});

// ===========================================================================
// An absence is never a blank, and never the id relabelled
// ===========================================================================

test("a 404 from Remote reads as an answer ABOUT the record, and shows no name at all", async () => {
  await travelCase();
  const handler = createUc03Handler({ caseStore, audit, remote: { getEmployment: async () => null } });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");

  assert.equal(res.status, 200, "a failed employee read must not take the case down");
  assert.equal(res.body.employee.state, SUBJECT_NOT_FOUND);
  assert.equal(res.body.employee.httpStatus, 404);
  assert.equal(res.body.employee.displayName, null);
  assert.deepEqual(res.body.employee.fields, []);
  // The id is reported as the id, never promoted into the name slot.
  assert.equal(res.body.employee.employmentId, "emp_active_001");
  assert.match(res.body.employee.finding, /does not exist/);
});

test("a 503 is NOT a 404 — 'we could not ask' must never read as 'there is no such person'", async () => {
  await workation();
  const handler = createUc04Handler({
    authorizationStore,
    audit,
    remote: {
      getEmployment: async () => {
        throw Object.assign(new Error("upstream"), { status: 503 });
      },
    },
  });
  const res = await callApi(handler, "/api/authorizations/by-ticket/5001");

  assert.equal(res.status, 200);
  assert.equal(res.body.employee.state, SUBJECT_UNAVAILABLE);
  assert.equal(res.body.employee.httpStatus, 503);
  assert.match(res.body.employee.finding, /failure to read, not a finding about the employee/);
  // The whole point of the distinction: this must not be readable as absence.
  assert.doesNotMatch(res.body.employee.finding, /does not exist/);
});

test("an API wired with no Remote client says so, rather than saying nothing", async () => {
  await travelCase();
  const handler = createUc03Handler({ caseStore });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");

  assert.equal(res.body.employee.state, SUBJECT_NOT_LOOKED_UP);
  assert.match(res.body.employee.finding, /This says nothing about the employee/);
});

test("a row naming no employment is a record with a field missing, not a record about nobody", async () => {
  const subject = await describeEmployee({ remote, employmentId: null, fields: ["full_name"] });
  assert.equal(subject.state, SUBJECT_NO_EMPLOYMENT_ID);
  assert.equal(subject.employmentId, null);
  assert.match(subject.finding, /record with the field missing/);
});

test("all five states carry the same keys, so a renderer branches on `state` and never on the presence of a key", async () => {
  const shapes = [
    await describeEmployee({ remote, employmentId: "emp_active_001", fields: ["full_name"] }),
    await describeEmployee({ remote, employmentId: null, fields: ["full_name"] }),
    await describeEmployee({ remote: null, employmentId: "emp_active_001", fields: ["full_name"] }),
    await describeEmployee({ remote: { getEmployment: async () => null }, employmentId: "x", fields: ["full_name"] }),
    await describeEmployee({
      remote: {
        getEmployment: async () => {
          throw new Error("no status at all");
        },
      },
      employmentId: "x",
      fields: ["full_name"],
    }),
  ];
  const expected = ["state", "employmentId", "displayName", "fields", "readAt", "httpStatus", "finding"];
  for (const shape of shapes) assert.deepEqual(Object.keys(shape).sort(), [...expected].sort());
  // A throw carrying no status is still "we could not ask", and httpStatus is
  // null rather than an invented number.
  assert.equal(shapes[4].state, SUBJECT_UNAVAILABLE);
  assert.equal(shapes[4].httpStatus, null);
});

test("a field the record does not carry renders as a stated absence, not an empty string", async () => {
  const subject = await describeEmployee({
    remote: { getEmployment: async () => ({ id: "e1", full_name: "Pat Doe", job_title: "  ", contract_type: "unknown" }) },
    employmentId: "e1",
    fields: ["full_name", "job_title", "contract_type"],
  });
  const job = subject.fields.find((f) => f.key === "job_title");
  assert.equal(job.value, null);
  assert.match(job.absence, /no job title/);
  // "unknown" is what normalizeEmployment() writes when Remote offered neither
  // an employment model nor a type. Rendering it as a contract type would make
  // a failure to read look like a kind of engagement.
  const contract = subject.fields.find((f) => f.key === "contract_type");
  assert.equal(contract.value, null);
  assert.match(contract.absence, /'unknown'/);
});

test("an unknown field key throws at the call site rather than becoming a silently missing row", async () => {
  // Same rule verify-traces enforces on n8n's probe names: a name nothing
  // recognises is indistinguishable from an absence, forever, without erroring.
  await assert.rejects(
    () => describeEmployee({ remote, employmentId: "emp_active_001", fields: ["fulll_name"] }),
    /unknown field 'fulll_name'/
  );
});

// ===========================================================================
// The read is LIVE, and that is the whole reason it is a read
// ===========================================================================

test("the employee block is read when the panel opens, not frozen at decision time", async () => {
  const decided = await travelCase();
  let reads = 0;
  const handler = createUc03Handler({
    caseStore,
    audit,
    remote: {
      getEmployment: async (id) => {
        reads += 1;
        // The record has CHANGED since the decision: the person left. A name
        // frozen on the row at decision time could not show this, and
        // submitTravelLetterSignoff() re-reads and refuses on exactly it.
        return { id, full_name: "Amara Okafor", status: "inactive", job_title: "Senior Engineer" };
      },
    },
  });
  const res = await callApi(handler, "/api/cases/by-ticket/7001");

  assert.equal(reads, 1, "the view must read the employment exactly once");
  // Compared against what the workflow actually decided, not a literal: the
  // claim is that a LIVE employee read cannot move a STORED decision, and
  // pinning the decision string here would make this test a hostage to UC-03's
  // routing instead.
  assert.equal(res.body.caseRow.decision, decided.decision, "the stored decision is untouched by the fresh read");
  assert.equal(res.body.employee.fields.find((f) => f.key === "status").value, "inactive");
  assert.ok(res.body.employee.readAt, "a live read is timestamped so its freshness is checkable");
});

test("the employee block decides nothing — a failed read changes no decision, flag or actionability", async () => {
  await workation();
  const good = createUc04Handler({ authorizationStore, audit, remote });
  const blind = createUc04Handler({ authorizationStore, audit, remote: { getEmployment: async () => null } });

  const a = await callApi(good, "/api/authorizations/by-ticket/5001");
  const b = await callApi(blind, "/api/authorizations/by-ticket/5001");

  assert.equal(a.body.actionable, b.body.actionable);
  assert.equal(a.body.actionableReason, b.body.actionableReason);
  assert.equal(a.body.authorization.decision, b.body.authorization.decision);
  assert.deepEqual(a.body.authorization.flags, b.body.authorization.flags);
});
