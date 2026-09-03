// ---------------------------------------------------------------------------
// remoteui.test.js  —  The UC-06 Remote UI stand-in (issue #30)
// ---------------------------------------------------------------------------
// Three concerns, matching the livedemo/playground test discipline:
//   1. The browser asset compiles and never uses innerHTML — npm test never
//      imports app.js, so a syntax error would otherwise ship silently.
//   2. The HTTP API, driven through the REAL handler against the REAL mock
//      Remote + mock Zendesk servers (hermetic — localhost only). This is
//      what proves "submission runs UC-06's actual gates": handleAmendmentRequest
//      inside src/remoteui/server.js calls the real policyEngine/cutoffEngine/
//      dualApprovalPolicy, and the created ticket is read back out of the mock
//      Zendesk to assert the tags/custom-field/note that land on it.
//   3. A deliberate "gates first, ticket after" ordering test — the amendment
//      row must exist even if the ticket creation then fails.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { startMockServer as startRemoteMock } from "../src/remote/mockServer.js";
import { startMockServer as startZendeskMock } from "../src/zendesk/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { ZendeskClient } from "../src/zendesk/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import { createRemoteUiHandler, MARKER_TAG, OUTCOME_TAGS } from "../src/remoteui/server.js";
import { evaluateConsentAuthorization } from "../src/remoteui/roles.js";
import { REMOTE_UI_EMPLOYEES } from "../src/remoteui/employees.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "remoteui", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

const REMOTE_PORT = 4024; // unused by every other test file
const ZENDESK_PORT = 4025;
const EMPLOYMENT_ID_FIELD_ID = "360000000002";

let remote;
let zendesk;
let amendmentStore;
let audit;
let handler;
let remoteServer;
let zendeskServer;

// The mock fixtures (src/remote/mockServer.js) use a fixed payroll calendar:
// run_2026_06 cutoff 2026-06-10, run_2026_07 cutoff 2026-07-10, run_2026_08
// cutoff 2026-08-10. The fixed `now` values below are chosen against those
// dates so the cutoff outcome is deterministic (see src/uc06/cutoffEngine.js).
// THE DEMO ROSTER IS DUTCH NOW, AND THESE TESTS NO LONGER INJECT A FIXTURE THE
// PRODUCT DOES NOT HAVE.
//
// This block used to open with a finding — every employee in
// `REMOTE_UI_EMPLOYEES` sat in Nigeria, `GET /v1/contract-amendments/schema
// ?country_code=NGA` answers 500 live, so no amendment submitted from the real
// page could EVER be schema-validated — and then worked around it by appending
// a Dutch employee to the injected `employees` list. The tests passed. The
// shipped page could not reach `dual_approval_required` under any input, and
// production agrees: 28 UC-06 `audit_log` rows, 26 refusals, zero successes.
//
// That workaround is the failure mode this project keeps paying for, rotated
// one turn: not a fixture that agreed with the code instead of the API, but a
// TEST that agreed with what the code should do, using data the product does
// not offer. A test that supplies its own subject cannot detect a roster that
// has none.
//
// `src/remoteui/employees.js` now lists the Dutch employments, so the tests
// below submit for employees the real page actually offers, and the injected
// `employees` dependency is passed straight through unmodified.
const ORDINARY = { // now well before the July cutoff -> ordinary dual approval
  employmentId: "emp_nl_amend_001",
  changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "EUR" } },
  requestedEffectiveDate: "2026-07-15",
  now: "2026-06-20",
};
// The consent tests use the employment the demo EMPLOYEE session is signed in
// as (src/remoteui/server.js's DEMO_SESSIONS.employee), because an employee may
// only consent to an amendment of their own contract. That session is now the
// Dutch employment too, so one amendment can be walked through all three roles
// — request, employee consent, employer consent — which is the only thing this
// page exists to demonstrate.
const EMPLOYEE_OWNED = {
  employmentId: "emp_nl_amend_001",
  changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "EUR" } },
  requestedEffectiveDate: "2026-07-15",
  now: "2026-06-20",
};

const WITHIN_48H = { // now 24h before the July cutoff -> urgent, still dual approval
  employmentId: "emp_nl_amend_001",
  changes: { jobTitle: { oldValue: "Senior Software Engineer", newValue: "Lead Software Engineer" } },
  requestedEffectiveDate: "2026-07-15",
  now: "2026-07-09",
};
const AFTER_CUTOFF = { // requested cycle's cutoff already passed -> escalate
  employmentId: "emp_nl_amend_001",
  changes: { jobTitle: { oldValue: "Senior Software Engineer", newValue: "Staff Engineer" } },
  requestedEffectiveDate: "2026-06-15",
  now: "2026-06-20",
};

// Server-owned demo sessions the stand-in exposes (issue #34). The role comes
// from the session, sent as a header the way the page's role tabs do — never
// a claim in the request body.
const ADMIN_SESSION = { "x-remoteui-session": "admin" };
const EMPLOYER_SESSION = { "x-remoteui-session": "employer" };
const EMPLOYEE_SESSION = { "x-remoteui-session": "employee" };

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

// Never a real, retried LLM call from a test — this suite is about the
// gates/ticket-creation flow, not draft prose (same reasoning as the
// identical fakes in test/uc06.test.js — see #31/#32 for why this devcontainer
// specifically needs this: it carries a genuine but unreachable OPENAI_API_KEY).
// Runs the REAL draftSummary() forced into its unconfigured (template)
// branch — see test/uc06.test.js's identical fake for why.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

before(async () => {
  remoteServer = await startRemoteMock(REMOTE_PORT);
  zendeskServer = await startZendeskMock(ZENDESK_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
  zendesk = new ZendeskClient({ baseUrl: `http://localhost:${ZENDESK_PORT}`, email: "test@example.com", apiToken: "test-token" });
  amendmentStore = new AmendmentStore();
  audit = new AuditLogger();
  handler = createRemoteUiHandler({
    remote,
    audit,
    amendmentStore,
    zendesk,
    employees: REMOTE_UI_EMPLOYEES,
    employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID,
    draftSummary: fakeDraftSummary,
    judge: fakeJudge,
  });
});

after(async () => {
  // Close the mock servers so the event loop drains and the file can finish —
  // a test file that keeps listening never lets `node --test` exit.
  await new Promise((resolve) => remoteServer.close(resolve));
  await new Promise((resolve) => zendeskServer.close(resolve));
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test("index.html loads exactly the assets that exist", () => {
  const html = read("index.html");
  for (const asset of ["style.css", "app.js"]) {
    assert.ok(html.includes(asset), `index.html must load ${asset}`);
    assert.ok(existsSync(join(ASSETS, asset)), `${asset} is loaded but missing`);
  }
});

test("app.js compiles", () => {
  assert.doesNotThrow(() => new vm.Script(read("app.js"), { filename: "app.js" }));
});

test("app.js never writes dynamic values with innerHTML", () => {
  const source = read("app.js");
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

// ---------------------------------------------------------------------------
// The API — the real gates, the real mock servers, nothing re-implemented
// ---------------------------------------------------------------------------

test("GET /api/employees returns each known employee with CURRENT contract values, money in human units", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/employees" });
  assert.equal(res.status, 200);
  // Whatever the roster holds — the point is that every entry resolves, not
  // that there are exactly N of them.
  assert.equal(res.body.employees.length, REMOTE_UI_EMPLOYEES.length);

  const amara = res.body.employees.find((e) => e.id === "emp_active_001");
  assert.ok(amara, "emp_active_001 must be listed");
  assert.equal(amara.name, "Amara Okafor");
  assert.equal(amara.companyId, "co_amend_01");
  // The mock stores 5,000,000 (×100); the API must hand back 50,000.00 human units.
  assert.equal(amara.current.salary, 50000);
  assert.equal(amara.current.currency, "USD");
  assert.equal(amara.current.jobTitle, "Senior Engineer");
  assert.equal(amara.current.weeklyHours, 40);
  assert.equal(amara.current.status, "active");
});

// THE REGRESSION GUARD FOR THE BUG THIS FILE USED TO WORK AROUND.
//
// `readCurrentValues()` read only the TOP LEVEL of the employment record, and
// `normalizeEmployment()` carries Remote's own `contract_details` block through
// untouched rather than flattening it. So for every Dutch employment — which
// is now the whole amendable half of the roster — the page showed a blank
// salary, no hours, and a currency of "USD", because the old code ended in
// `emp.currency ?? "USD"`.
//
// That default was not cosmetic. The page submits the prefilled currency as
// `changes.salary.currency`, and src/uc06/policyEngine.js writes it straight
// through to the form's `compensation_currency_code` without ever comparing it
// to the record — so a salary amendment on a EUR contract would have been
// filed in dollars. This asserts the real values arrive, and that an
// unreadable currency is never invented.
test("GET /api/employees reads salary/hours/currency out of contract_details, and never defaults a currency", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/employees" });
  const jan = res.body.employees.find((e) => e.id === "emp_nl_amend_001");
  assert.ok(jan, "the amendable Dutch employment must be on the roster the page offers");
  assert.equal(jan.current.salary, 50000, "50,000.00 from contract_details.annual_gross_salary (5000000 ×100)");
  assert.equal(jan.current.currency, "EUR", "EUR from contract_details.compensation_currency_code — NOT a defaulted USD");
  assert.equal(jan.current.jobTitle, "Senior Software Engineer");
  assert.equal(jan.current.weeklyHours, 40);
  assert.equal(jan.current.status, "active");

  // Remote stores this one as the STRING "24" and the number 40 on another
  // record; the display coerces, and must not surface a string.
  const anna = res.body.employees.find((e) => e.id === "emp_nl_parttime_006");
  assert.ok(anna, "the part-time Dutch employment must be listed");
  assert.equal(anna.current.weeklyHours, 24);
  assert.equal(anna.current.currency, "EUR");
});

test("POST /api/submit (ordinary, before cutoff): real gates pass, ticket created pre-tagged and pre-populated", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "dual_approval_required");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.deepEqual(res.body.flags, []);
  assert.equal(res.body.amendmentType, "SALARY_INCREASE");
  assert.equal(res.body.summary, "Amendment: change salary from 50000 to 60000 EUR, effective 2026-07-15.");
  // ROUTED AS WELL AS TAGGED (contract [A-30], 2026-09-02): the queue tag from
  // the shared routing table rides beside the outcome tag, so the ticket lands
  // in Payroll Ops's view instead of nobody's.
  assert.deepEqual(res.body.tags, [MARKER_TAG, OUTCOME_TAGS.dual_approval_required, "queue_payroll_ops"]);
  assert.equal(res.body.actionable, true);
  assert.ok(res.body.ticketId, "a ticket id must be returned");
  assert.ok(res.body.amendmentId, "an amendment id must be returned");

  // The ticket that landed on the mock Zendesk carries the outcome's tags,
  // the employment custom field, and an internal note pre-populated with the
  // drafted summary + amendment id — so the shared ZAF sidebar can host the
  // dual-approval flow with nothing else to gather.
  const ticket = await zendesk.getTicket(res.body.ticketId);
  assert.equal(ticket.status, "new");
  assert.deepEqual(ticket.tags, [MARKER_TAG, OUTCOME_TAGS.dual_approval_required, "queue_payroll_ops"]);
  assert.deepEqual(ticket.custom_fields, [{ id: Number(EMPLOYMENT_ID_FIELD_ID), value: "emp_nl_amend_001" }]);
  assert.match(ticket.description, /Amendment: change salary from 50000 to 60000 EUR/);
  assert.match(ticket.description, /Decision: dual_approval_required \(all_gates_passed\)/);
  assert.match(ticket.description, new RegExp(`Amendment: ${res.body.amendmentId}`));

  // The amendment row is linked to the ticket (externalRef) for the by-ticket
  // lookup the sidebar uses, and is open for the two-role approval flow.
  const linked = await amendmentStore.findByExternalRef(String(res.body.ticketId));
  assert.equal(linked.id, res.body.amendmentId);
  assert.equal(linked.status, "pending_dual_approval");
  assert.equal(linked.externalRef, String(res.body.ticketId));
  assert.equal(linked.requester, "admin_jane");
  assert.equal(linked.source, "remoteui");
});

test("POST /api/submit within 48h of cutoff: still dual approval, but flagged urgent", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: WITHIN_48H, headers: ADMIN_SESSION });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "dual_approval_required");
  assert.deepEqual(res.body.flags, ["urgent_cutoff"]);
  assert.equal(res.body.amendmentType, "JOB_TITLE_CHANGE");
  assert.equal(res.body.actionable, true);
});

test("POST /api/submit after the cutoff: escalate — visible but not actionable, ticket still carries the decision", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: AFTER_CUTOFF, headers: ADMIN_SESSION });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "cutoff_lock_passed");
  assert.deepEqual(res.body.flags, ["cutoff_lock_passed", "retroactive_change"]);
  assert.equal(res.body.actionable, false); // the REAL dualApprovalPolicy answer
  assert.match(res.body.actionableReason, /no approve\/decline path/);
  assert.deepEqual(res.body.tags, [MARKER_TAG, OUTCOME_TAGS.escalate, "queue_payroll_ops", "escalation_payroll_ops"]);

  const ticket = await zendesk.getTicket(res.body.ticketId);
  assert.deepEqual(ticket.tags, [MARKER_TAG, OUTCOME_TAGS.escalate, "queue_payroll_ops", "escalation_payroll_ops"]);
});

test("POST /api/submit for a terminated employee: the employment-active gate escalates", async () => {
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    body: { employmentId: "emp_terminated_002", changes: { salary: { oldAmount: 60000, newAmount: 65000, currency: "USD" } }, requestedEffectiveDate: "2026-07-15", now: "2026-06-20" },
    headers: ADMIN_SESSION,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "employee_not_active");
  assert.deepEqual(res.body.flags, ["employee_not_active"]);
  assert.equal(res.body.actionable, false);
});

test("POST /api/submit refuses an employee the admin session cannot vouch for", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: { employmentId: "not_a_real_id", changes: { salary: { oldAmount: 1, newAmount: 2, currency: "USD" } } }, headers: ADMIN_SESSION });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_employee");
});

test("POST /api/submit refuses empty changes rather than guessing a change", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: { employmentId: "emp_active_001", changes: {} }, headers: ADMIN_SESSION });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_changes");
});

test("unknown routes 404 rather than guessing", async () => {
  const res = await callApi(handler, { method: "GET", path: "/api/definitely-not-a-route" });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "no_such_route");
});

// ---------------------------------------------------------------------------
// Role gate (issue #34): employee / employer / company-admin are genuinely
// separate, server-side-authorized paths, never a client-side form difference
// ---------------------------------------------------------------------------

test("POST /api/submit without a Remote UI session is refused — fails closed", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "unauthenticated");
});

test("POST /api/submit as the employee is refused — employees do not initiate amendments", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: EMPLOYEE_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "role_not_authorized");
  assert.equal(res.body.role, "employee");
  assert.equal(res.body.action, "submit_amendment_request");
  assert.match(res.body.reason, /customer admin/);
});

test("POST /api/submit as the employer is refused — requesting is the customer admin's act", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: EMPLOYER_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "role_not_authorized");
  assert.equal(res.body.role, "employer");
});

test("POST /api/consent without a Remote UI session is refused — fails closed", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: "whatever", party: "employee" } });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "unauthenticated");
});

test("POST /api/consent refuses an unknown amendment", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: "does-not-exist", party: "employee" }, headers: EMPLOYEE_SESSION });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "amendment_not_found");
});

test("POST /api/consent refuses an unknown party value", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: submit.body.amendmentId, party: "payroll" }, headers: EMPLOYEE_SESSION });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "unknown_party");
});

test("the customer admin cannot consent — their control point is approval in the sidebar, not a signature", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: submit.body.amendmentId, party: "employer" }, headers: ADMIN_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "role_not_authorized");
  assert.equal(res.body.role, "company_admin");
  assert.match(res.body.reason, /approval in the sidebar/);
});

test("an employer-shaped submission attempting the employee-only action is rejected", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  // Employer session trying to consent as the employee party — the employee's act.
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: submit.body.amendmentId, party: "employee" }, headers: EMPLOYER_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "role_not_authorized");
  assert.equal(res.body.role, "employer");
  assert.match(res.body.reason, /Only the employee can consent/);
});

test("an employee-shaped submission attempting the employer-only action is rejected", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  // Employee session trying to consent as the employer party — the employer's act.
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: submit.body.amendmentId, party: "employer" }, headers: EMPLOYEE_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "role_not_authorized");
  assert.equal(res.body.role, "employee");
  assert.match(res.body.reason, /Only the employer can consent/);
});

test("the employee can consent to an amendment of their own contract — audited, visible on the ticket", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: EMPLOYEE_OWNED, headers: ADMIN_SESSION });
  assert.ok(submit.body.amendmentId, "an amendment exists to consent to");

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/consent",
    body: { amendmentId: submit.body.amendmentId, party: "employee", note: "I have reviewed the new terms." },
    headers: EMPLOYEE_SESSION,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.code, "consent_recorded");
  assert.equal(res.body.party, "employee");
  assert.equal(res.body.amendmentId, submit.body.amendmentId);

  // The consent is durably recorded in the audit log — the employee consented.
  const consented = audit.forUseCase("UC-06").filter((e) => e.action === "amendment_employee_consented" && e.details.amendmentId === submit.body.amendmentId);
  assert.equal(consented.length, 1);
  assert.equal(consented[0].actor, "jan.bakker@acme.test"); // the employee's identity, not a claim
  // `medium` — UC-06's own tier — because this amendment PASSED its gates and
  // is awaiting dual approval. It read `high` before the roster fix, and that
  // was not a stricter assertion: classifyRisk raises the tier for an
  // escalation, and every amendment this page could produce was an escalation
  // on `country_schema_unavailable`. The tier is a property of the amendment,
  // not of the consent, which is the point of asserting it here at all.
  assert.equal(consented[0].riskTier, "medium");
  assert.equal(consented[0].details.employmentId, "emp_nl_amend_001");

  // And it lands as an internal note on the real (mock) ticket.
  const ticket = await zendesk.getTicket(submit.body.ticketId);
  assert.ok(ticket.comments.some((c) => c.public === false && /consented to amendment/.test(c.body)));
});

test("the employee cannot consent to someone else's amendment", async () => {
  const other = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    body: { ...ORDINARY, employmentId: "emp_nl_amend_003" },
    headers: ADMIN_SESSION,
  });
  // Guard the setup, not just the assertion: if the roster ever stops offering
  // this employment the submit 400s, `amendmentId` is undefined, and the
  // consent below 404s "no such amendment" — which is a PASS-shaped failure for
  // a test whose whole subject is a 403. Assert the precondition explicitly.
  assert.equal(other.status, 200, "the second employment must be on the roster for this test to mean anything");
  assert.ok(other.body.amendmentId, "the colleague's amendment must exist before we try to consent to it");
  const res = await callApi(handler, { method: "POST", path: "/api/consent", body: { amendmentId: other.body.amendmentId, party: "employee" }, headers: EMPLOYEE_SESSION });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "not_your_amendment");
  assert.match(res.body.reason, /their own contract/);
});

test("the employer can consent on the company's behalf — audited, visible on the ticket", async () => {
  const submit = await callApi(handler, { method: "POST", path: "/api/submit", body: EMPLOYEE_OWNED, headers: ADMIN_SESSION });

  const res = await callApi(handler, {
    method: "POST",
    path: "/api/consent",
    body: { amendmentId: submit.body.amendmentId, party: "employer", note: "Salary committee approved." },
    headers: EMPLOYER_SESSION,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.code, "consent_recorded");
  assert.equal(res.body.party, "employer");

  const consented = audit.forUseCase("UC-06").filter((e) => e.action === "amendment_employer_consented" && e.details.amendmentId === submit.body.amendmentId);
  assert.equal(consented.length, 1);
  assert.equal(consented[0].actor, "company_owner");
  assert.equal(consented[0].details.employmentId, "emp_nl_amend_001");
});

test("the employer may only consent for its own employees — a different company's employment is refused (pure policy)", async () => {
  // Exercised at the pure-function level because every mock employment is
  // under co_amend_01 — the cross-company case needs a fabricated record.
  const verdict = evaluateConsentAuthorization({
    session: { role: "employer", companyId: "co_amend_01" },
    party: "employer",
    amendment: { id: "x", employmentId: "emp_other_co" },
    employment: { id: "emp_other_co", company_id: "co_other" },
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "not_your_amendment");
  assert.equal(verdict.status, 403);
});

test("an employee-shaped submission attempting to consent on the employer's behalf is refused (pure policy)", async () => {
  const verdict = evaluateConsentAuthorization({
    session: { role: "employee", companyId: "co_amend_01", employmentId: "emp_active_001" },
    party: "employer",
    amendment: { id: "x", employmentId: "emp_active_001" },
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "role_not_authorized");
});

// ---------------------------------------------------------------------------
// Ordering: gates first, ticket after
// ---------------------------------------------------------------------------

test("the amendment is recorded BEFORE any Zendesk call — a ticket failure never erases the decision", async () => {
  const store = new AmendmentStore();
  const throwingZendesk = {
    async createTicket() {
      throw new Error("Zendesk unreachable");
    },
  };
  const h = createRemoteUiHandler({
    remote,
    audit: new AuditLogger(),
    amendmentStore: store,
    zendesk: throwingZendesk,
    employees: REMOTE_UI_EMPLOYEES,
    employmentIdFieldId: EMPLOYMENT_ID_FIELD_ID,
    draftSummary: fakeDraftSummary,
    judge: fakeJudge,
  });

  const res = await callApi(h, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  assert.equal(res.status, 500);
  assert.equal(res.body.code, "internal_error");

  // The gate run happened and was recorded before the ticket step failed.
  assert.equal(store.amendments.length, 1);
  assert.equal(store.amendments[0].decision, "dual_approval_required");
  assert.equal(store.amendments[0].externalRef, null); // never linked, since no ticket exists
  assert.ok(audit.forUseCase("UC-06").length >= 0);
});

// ---------------------------------------------------------------------------
// THE POSITIVE TESTS. Their absence is why UC-06 shipped unable to succeed.
// ---------------------------------------------------------------------------
// Every safety assertion in this file passed while the page could not reach
// `dual_approval_required` under ANY input — because refusing correctly and
// being structurally incapable of succeeding are indistinguishable from
// outside, and no amount of negative testing tells them apart. Only a test
// that says "this input MUST succeed" does.
//
// These are deliberately written against the SHIPPED roster
// (`REMOTE_UI_EMPLOYEES`, imported, never a fixture this file invents) so they
// fail the moment the product's own list drifts back to a country Remote
// publishes no contract-amendment form for.

test("POSITIVE: the shipped roster contains at least one employment that reaches dual approval", async () => {
  const reached = [];
  for (const employee of REMOTE_UI_EMPLOYEES) {
    const res = await callApi(handler, {
      method: "POST",
      path: "/api/submit",
      headers: ADMIN_SESSION,
      body: {
        employmentId: employee.id,
        changes: { jobTitle: { oldValue: "any", newValue: "Staff Engineer" } },
        requestedEffectiveDate: "2026-07-15",
        now: "2026-06-20",
      },
    });
    if (res.body && res.body.decision === "dual_approval_required") reached.push(employee.id);
  }
  assert.ok(
    reached.length > 0,
    "NO employment the page offers can reach dual approval — UC-06's success outcome is unreachable from its own UI. " +
      "This is the exact state the use case shipped in: every demo employee sat in a country whose " +
      "contract-amendment form does not exist, so every submission escalated at the schema gate."
  );
});

test("POSITIVE: a successful amendment is actionable, tagged for approval, and carries no flags", async () => {
  const res = await callApi(handler, { method: "POST", path: "/api/submit", body: ORDINARY, headers: ADMIN_SESSION });
  assert.equal(res.body.decision, "dual_approval_required");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.deepEqual(res.body.flags, []);
  // Actionability is what the ZAF sidebar reads to decide whether to render the
  // two-role approval controls at all. `false` here means the dual-approval UI
  // — the entire point of UC-06 — has nothing to act on.
  assert.equal(res.body.actionable, true, "a passed amendment must be open to the sidebar's dual approval");
  assert.ok(res.body.tags.includes(OUTCOME_TAGS.dual_approval_required));
  assert.equal(res.body.explanation, null, "a success has no refusal to explain");
});

test("POSITIVE: each quick-fill scenario reaches the decision AND the reason its label claims", async () => {
  // The page's scenarios, restated here as {label -> expected outcome}.
  // Before the roster fix all three active-employee scenarios escalated
  // `country_schema_unavailable` at a gate two steps ahead of the one they
  // claimed to demonstrate — "After cutoff" never reached the cutoff engine at
  // all. Asserting the REASON, not just the decision, is what catches that: a
  // scenario that escalates for the wrong cause still "escalates".
  const cases = [
    ["Before cutoff", ORDINARY, "dual_approval_required", "all_gates_passed"],
    ["Within 48h of cutoff", WITHIN_48H, "dual_approval_required", "all_gates_passed"],
    ["After cutoff", AFTER_CUTOFF, "escalate", "cutoff_lock_passed"],
  ];
  for (const [label, body, decision, reason] of cases) {
    const res = await callApi(handler, { method: "POST", path: "/api/submit", body, headers: ADMIN_SESSION });
    assert.equal(res.body.decision, decision, `${label}: decision`);
    assert.equal(res.body.reason, reason, `${label}: reason — an escalation for the wrong cause is still an escalation`);
  }

  // And the urgent scenario must actually raise the urgent flag, which is the
  // only thing distinguishing it from the ordinary one.
  const urgent = await callApi(handler, { method: "POST", path: "/api/submit", body: WITHIN_48H, headers: ADMIN_SESSION });
  assert.ok(urgent.body.flags.includes("urgent_cutoff"), "the within-48h scenario must raise urgent_cutoff");
});

test("a refusal for a country with no amendment form explains itself, and a real gate refusal does not borrow that explanation", async () => {
  const noForm = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    headers: ADMIN_SESSION,
    body: {
      employmentId: "emp_active_001", // Nigeria — no contract-amendment form exists
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
  });
  assert.equal(noForm.body.decision, "escalate");
  assert.equal(noForm.body.reason, "country_schema_unavailable");
  assert.match(noForm.body.explanation, /no contract-amendment form for Nigeria/);
  assert.match(noForm.body.explanation, /permanent property of the country/);

  // The explanation is scoped to the reason it explains. A cutoff refusal is a
  // decision about THIS request and must not be dressed up as an environment
  // limitation — that would be the mirror of the bug, hiding a real refusal
  // behind "the form does not exist". Since 2026-09-02 it gets its OWN
  // sentence instead of none: the cycle, the lock, and how late — the same
  // words the payroll specialist reads in the sidebar (describeAmendmentBasis).
  const cutoff = await callApi(handler, { method: "POST", path: "/api/submit", body: AFTER_CUTOFF, headers: ADMIN_SESSION });
  assert.equal(cutoff.body.reason, "cutoff_lock_passed");
  assert.match(cutoff.body.explanation, /run_nl_2026_06/, "names the governing cycle");
  assert.match(cutoff.body.explanation, /closed at 2026-06-10/, "names the lock");
  assert.doesNotMatch(cutoff.body.explanation, /no contract-amendment form/);
  // And the clock the gates ran on is echoed, pinned, so the page can say so.
  assert.equal(cutoff.body.evaluatedAt, AFTER_CUTOFF.now);
  assert.equal(cutoff.body.clockPinned, true);
  assert.deepEqual(cutoff.body.owner, { team: "Payroll Ops", escalated: true });
});

test("a schema read that failed is never recorded as a 404 about the record", async () => {
  // `getContractAmendmentSchema()` returns null for four different reasons —
  // an unresolvable country, a 404, an unusable body, and a THROWN status,
  // because it catches so a 500 cannot take down a decision. Live, NGA and USA
  // answer 500. The workflow used to hard-code `status: 404, kind: not_found`,
  // which records "Remote says this record does not exist" for what is really
  // "Remote's form service is erroring" — the exact distinction
  // src/shared/upstreamFailure.js exists to keep, lost at that one call site.
  const res = await callApi(handler, {
    method: "POST",
    path: "/api/submit",
    headers: ADMIN_SESSION,
    body: {
      employmentId: "emp_active_001",
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
    },
  });
  assert.ok(
    res.body.flags.includes("upstream_country_schema_error"),
    `expected an unattributed-status flag, got ${JSON.stringify(res.body.flags)}`
  );
  assert.ok(
    !res.body.flags.includes("upstream_country_schema_404"),
    "a 500 must never be recorded as a 404 — a human triaging this would go looking for a bad employment id"
  );
});
