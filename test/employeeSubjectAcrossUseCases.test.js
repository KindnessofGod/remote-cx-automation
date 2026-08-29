// ---------------------------------------------------------------------------
// employeeSubjectAcrossUseCases.test.js  —  six views, one shape, six different
//                                           arguments about what belongs on it
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, AND WHY IT IS NOT PART OF employeeSubject.test.js
//
// That file proves the mechanism: five states, an absence that is never a
// blank, a live read that decides nothing. This one proves the two claims the
// SIDEBAR depends on and no single use case can establish alone:
//
//   1. THE SHAPE IS THE SAME on every view that publishes it, so the panel
//      needs one renderer and not six. A per-use-case shape would put the
//      branching in the browser, which is the exact inversion of this repo's
//      rule that the server decides and the shell renders.
//   2. THE FIELDS ARE NOT. Each use case chose its own, argued from the
//      decision that view exists to support — and the differences are asserted
//      HERE, where they can be read side by side, rather than being six
//      separate facts nobody ever compares.
//
// MONEY IS THE LINE THIS FILE DRAWS HARDEST. UC-06's decision genuinely turns
// on salary and UC-09's on a payment amount; both publish that money from their
// OWN row, where it is the subject of the decision. Neither publishes the
// employee's pay as a fact about the person, and the registry has no field that
// would let them. The test for this is structural, because a behavioural one
// only ever proves that today's fixture happened to carry no salary.
// ---------------------------------------------------------------------------

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { handleExpenseSubmission } from "../src/uc02/workflow.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { createUc02Handler } from "../src/uc02/server.js";

import { ResignationStore } from "../src/uc05/resignationStore.js";
import { handleResignationRequest } from "../src/uc05/workflow.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { createUc05Handler } from "../src/uc05/server.js";

import { AmendmentStore } from "../src/uc06/amendmentStore.js";
import { handleAmendmentRequest } from "../src/uc06/workflow.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import { createUc06Handler } from "../src/uc06/server.js";

import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { createUc09Handler } from "../src/uc09/server.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

import { EMPLOYEE_FIELD_KEYS, SUBJECT_AVAILABLE } from "../src/shared/employeeSubject.js";

const TEST_PORT = 4123; // allocated in src/shared/ports.js TEST_PORTS

let remoteServer;
let remote;
let audit;

before(async () => {
  remoteServer = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});
after(() => remoteServer?.close());

beforeEach(() => {
  audit = new AuditLogger();
});

function callApi(handler, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: path,
      headers,
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

// -- one seeded row per use case, through each one's REAL handler ------------

async function uc02View() {
  const expenseStore = new ExpenseStore();
  const created = await handleExpenseSubmission(
    { expenseId: "exp_compliant_001", employmentId: "emp_active_001", session: { authenticatedEmploymentId: "emp_active_001" }, externalRef: "2101" },
    { remote, audit, expenseStore, classify: classifyExpenseRuleBased }
  );
  const handler = createUc02Handler({
    expenseStore,
    audit,
    remote,
    // The write gate is irrelevant here and defaults to ON; this file only ever
    // GETs, and the read gate defaults OFF exactly so a credential-free clone
    // still reads.
    allowUnauthenticatedDemo: true,
  });
  return (await callApi(handler, "/api/expenses/" + created.storeId)).body;
}

async function uc05View() {
  const resignationStore = new ResignationStore();
  const created = await handleResignationRequest(
    {
      session: { authenticatedEmploymentId: "emp_uk_001" },
      employmentId: "emp_uk_001",
      proposedEndDate: "2026-09-15",
      reason: "new opportunity",
      now: "2026-08-16",
      hourlyRateInRemoteInteger: 4000,
      externalRef: "5101",
    },
    { remote, audit, resignationStore, extract: (args) => extractFromLetter(args, { isConfigured: () => false }) }
  );
  const handler = createUc05Handler({ resignationStore, audit, remote });
  return (await callApi(handler, "/api/resignations/" + created.resignationId)).body;
}

async function uc06View() {
  const amendmentStore = new AmendmentStore();
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      externalRef: "6101",
    },
    {
      remote,
      audit,
      amendmentStore,
      draftSummary: (args) => draftSummary(args, { isConfigured: () => false }),
      judge: async () => ({ verdict: "not_evaluated", reason: null }),
    }
  );
  const handler = createUc06Handler({ amendmentStore, audit, remote });
  return (await callApi(handler, "/api/amendments/" + created.amendmentId)).body;
}

// UC-09's own server tests drive a fake Remote rather than the mock, because its
// workflow needs `createIncentive`. Kept here, with a real display name on the
// record so the block has something to publish.
const uc09Remote = {
  getEmployment: (id) => ({
    id,
    full_name: "Amara Okafor",
    status: "active",
    company_id: "co_test",
    country_code: "US",
    contract_type: "employee",
    start_date: "2022-03-01",
    job_title: "Senior Engineer",
  }),
  getCountrySchema: () => ({ required: ["employment_id", "type", "amount", "currency"] }),
  isLlmConfigured: () => false,
  createIncentive: async (payload) => ({ success: true, incentiveId: "inc_test", ...payload }),
};

async function uc09View() {
  const adjustmentStore = new AdjustmentStore();
  const created = await handleAdjustmentRequest(
    {
      employmentId: "emp_test_1",
      session: { companyId: "co_test", authenticatedAdminId: "admin_1" },
      adjustmentRequest: { type: "bonus", amount: 500_000, currency: "USD", amountTaxType: "gross", description: "Performance bonus" },
      reasonText: "Annual performance bonus",
      externalRef: "9101",
    },
    {
      remote: uc09Remote,
      audit,
      adjustmentStore,
      judge: (args) => judgeNarrative(args, { isConfigured: () => false }),
    }
  );
  const handler = createUc09Handler({ adjustmentStore, audit, remote: uc09Remote });
  return (await callApi(handler, "/api/adjustments/" + created.adjustmentId)).body;
}

// ===========================================================================
// One shape
// ===========================================================================

test("all four views publish `employee` and `requester` with identical keys — one renderer, not four", async () => {
  const views = { "UC-02": await uc02View(), "UC-05": await uc05View(), "UC-06": await uc06View(), "UC-09": await uc09View() };

  const employeeKeys = ["displayName", "employmentId", "fields", "finding", "httpStatus", "readAt", "state"];
  const requesterKeys = ["actingFor", "filedBy", "identity", "intake"];
  for (const [name, view] of Object.entries(views)) {
    assert.ok(view.employee, `${name} publishes no employee block`);
    assert.deepEqual(Object.keys(view.employee).sort(), employeeKeys, `${name}'s employee block`);
    assert.ok(view.requester, `${name} publishes no requester block`);
    assert.deepEqual(Object.keys(view.requester).sort(), requesterKeys, `${name}'s requester block`);
    // And every row inside `fields` is the same triple, whichever field it is.
    for (const row of view.employee.fields) {
      assert.deepEqual(Object.keys(row).sort(), ["absence", "key", "label", "value"], `${name}: ${row.key}`);
    }
  }
});

test("every view names the person — the defect this whole change exists to close", async () => {
  for (const view of [await uc02View(), await uc05View(), await uc06View(), await uc09View()]) {
    assert.equal(view.employee.state, SUBJECT_AVAILABLE);
    assert.ok(view.employee.displayName, "a view still shows no name");
    assert.notEqual(view.employee.displayName, view.employee.employmentId, "the id was relabelled as the name");
  }
});

// ===========================================================================
// Different fields, each argued from its own decision
// ===========================================================================

test("each use case chose its own fields, and the differences are the argument", async () => {
  const chose = (view) => view.employee.fields.map((f) => f.key);

  // Finance Ops reimbursing a claim: who, are they still employed, and which
  // country's category caps applied. Nothing about seniority.
  assert.deepEqual(chose(await uc02View()), ["full_name", "status", "country_code"]);

  // HR Ops signing a notice calculation: the country selects the statutory
  // table, the start date selects the bracket inside it, and the engagement
  // type decides whether a statute applies at all.
  assert.deepEqual(chose(await uc05View()), ["full_name", "status", "contract_type", "country_code", "start_date"]);

  // Two approvers on a contract change: the title is the FROM side of the
  // change, and the country selects the schema every gate validates against.
  assert.deepEqual(chose(await uc06View()), ["full_name", "job_title", "status", "contract_type", "country_code"]);

  // The money path: who is paid, are they still employed, are they even on
  // payroll, and in which jurisdiction. Not their title, not their tenure.
  assert.deepEqual(chose(await uc09View()), ["full_name", "status", "contract_type", "country_code"]);
});

test("UC-05 publishes the start date and UC-09 does not — tenure decides a notice bracket and nothing on the payment path", async () => {
  const five = (await uc05View()).employee.fields.map((f) => f.key);
  const nine = (await uc09View()).employee.fields.map((f) => f.key);
  assert.ok(five.includes("start_date"));
  assert.ok(!nine.includes("start_date"));
});

// ===========================================================================
// Money: the subject of a decision, never a fact about the person
// ===========================================================================

test("no view can publish the employee's pay, because the registry has no field for it", () => {
  for (const key of EMPLOYEE_FIELD_KEYS) {
    assert.doesNotMatch(key, /salary|compensation|pay|wage|hours|currency|bank/i, `registry offers ${key}`);
  }
});

test("UC-06 and UC-09 DO publish money — from their own row, where it is what is being decided", async () => {
  const six = await uc06View();
  const nine = await uc09View();

  // The amendment's own figures are the subject of the change.
  assert.ok(JSON.stringify(six.amendment).match(/50000|60000/), "UC-06 no longer publishes the amounts it is amending");
  assert.doesNotMatch(JSON.stringify(six.employee), /salary|compensation|currency/i);

  // The adjustment's amount is the payment being approved.
  assert.ok(JSON.stringify(nine.adjustment).match(/500000|5000/), "UC-09 no longer publishes the amount it is paying");
  assert.doesNotMatch(JSON.stringify(nine.employee), /salary|compensation|currency/i);
});

// ===========================================================================
// The requester block says what each gate actually compared
// ===========================================================================

test("UC-02 reports its requester as not_recorded, and says why that is correct rather than missing", async () => {
  const view = await uc02View();
  // expenseStore.js has no requester column BY DESIGN: an expense belongs to the
  // employee who incurred it, and the identity gate's whole job is to confirm
  // the submitter IS that employee. Copying the employment id into the slot
  // would manufacture a second party that does not exist.
  assert.equal(view.requester.filedBy.state, "not_recorded");
  assert.match(view.requester.filedBy.finding, /deliberate rather than missing/);
  assert.match(view.requester.identity.checks, /the submitter is the employee on the record/);
});

test("the two employee-session use cases and the two admin-session use cases are described as what they are", async () => {
  const five = await uc05View();
  const six = await uc06View();
  const nine = await uc09View();

  assert.equal(five.requester.filedBy.state, "authenticated_employee_session");
  assert.equal(five.requester.actingFor.state, "the_subject_themselves");

  assert.equal(six.requester.filedBy.state, "authenticated_company_actor");
  assert.equal(nine.requester.filedBy.state, "authenticated_company_actor");
  assert.equal(six.requester.actingFor.state, "on_behalf_of_the_subject");
  assert.equal(nine.requester.actingFor.state, "on_behalf_of_the_subject");
});

test("UC-09's requester block names the four-eyes floor as the reason a verified identity is not enough", async () => {
  const view = await uc09View();
  // The single most load-bearing sentence on the money path: an authenticated
  // company actor is authorised to ASK, and that is precisely why a second,
  // different, entitled approver is required regardless.
  assert.match(view.requester.identity.finding, /a second, different approver is required regardless/);
  assert.match(view.requester.filedBy.finding, /requester can never also be the approver/);
});

test("UC-06's unauthenticated case is EXPECTED on the Zendesk path, and the block says so instead of implying a defect", async () => {
  const amendmentStore = new AmendmentStore();
  const created = await handleAmendmentRequest(
    {
      employmentId: "emp_nl_amend_001",
      session: null, // a Zendesk ticket carries no company-admin session
      changes: { salary: { oldAmount: 50000, newAmount: 60000, currency: "USD" } },
      requestedEffectiveDate: "2026-07-15",
      now: "2026-06-20",
      externalRef: "6102",
    },
    {
      remote,
      audit,
      amendmentStore,
      draftSummary: (args) => draftSummary(args, { isConfigured: () => false }),
      judge: async () => ({ verdict: "not_evaluated", reason: null }),
    }
  );
  const handler = createUc06Handler({ amendmentStore, audit, remote });
  const view = (await callApi(handler, "/api/amendments/" + created.amendmentId)).body;

  assert.equal(view.requester.filedBy.state, "unauthenticated");
  assert.match(view.requester.filedBy.finding, /EXPECTED and correct/);
  assert.equal(view.requester.actingFor.state, "unknown");
});

// ===========================================================================
// A failed read degrades the block and never the case — on all four
// ===========================================================================

test("a Remote outage changes no decision, flag or actionability on any of the four", async () => {
  const blind = { getEmployment: async () => { throw Object.assign(new Error("down"), { status: 502 }); } };

  // UC-02
  const expenseStore = new ExpenseStore();
  const expense = await handleExpenseSubmission(
    { expenseId: "exp_compliant_001", employmentId: "emp_active_001", session: { authenticatedEmploymentId: "emp_active_001" }, externalRef: "2102" },
    { remote, audit, expenseStore, classify: classifyExpenseRuleBased }
  );
  const good = (await callApi(createUc02Handler({ expenseStore, audit, remote, allowUnauthenticatedDemo: true }), "/api/expenses/" + expense.storeId)).body;
  const bad = (await callApi(createUc02Handler({ expenseStore, audit, remote: blind, allowUnauthenticatedDemo: true }), "/api/expenses/" + expense.storeId)).body;

  assert.equal(bad.employee.state, "unavailable");
  assert.equal(bad.employee.httpStatus, 502);
  assert.equal(good.actionable, bad.actionable);
  assert.equal(good.actionableReason, bad.actionableReason);
  assert.deepEqual(good.expense.flags, bad.expense.flags);
  assert.equal(good.expense.decision, bad.expense.decision);
  // "we could not ask" must never read as "there is no such person".
  assert.doesNotMatch(bad.employee.finding, /does not exist/);
});
