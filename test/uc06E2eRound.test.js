// ---------------------------------------------------------------------------
// uc06E2eRound.test.js — the defects three personas found driving UC-06's
// live surfaces on 2026-09-02, each pinned so it cannot come back quietly.
// ---------------------------------------------------------------------------
// Evidence: qa/evidence/UC-06/2026-09-02-uc06-e2e/{admin,approvers,expert}/.
// Every test here names the finding it closes. Negative controls are included
// where the fix is a rule rather than a string, because a guard that only
// checks the new spelling is one careless edit from checking nothing.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { evaluateConsentAuthorization } from "../src/remoteui/roles.js";
import { describeAmendmentStatus } from "../src/remoteui/amendmentStatus.js";
import { explainRefusal } from "../src/remoteui/server.js";
import { settledFacts, describeSettled } from "../src/uc06/dualApprovalPolicy.js";
import { describeAmendmentBasis, DECIDERS } from "../src/uc06/decisionFacts.js";
import { draftSummary } from "../src/uc06/changeParser.js";
import { createEntitlementChecker, parseRoster } from "../src/review/approverEntitlement.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const strip = (src) => src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// The Remote-product stand-in (admin persona, defects 1–9)
// ---------------------------------------------------------------------------

test("A-1: the stand-in page carries the same access gate the portal does, and its script sends the key on every call", () => {
  const html = strip(read("src/remoteui/assets/index.html"));
  const js = strip(read("src/remoteui/assets/app.js"));
  assert.match(html, /id="access-gate"/, "the prompt exists");
  assert.match(html, /id="access-key"/);
  assert.match(js, /X-Portal-Key/, "the key header is sent");
  assert.match(js, /portal\.accessKey/, "the same sessionStorage slot workauth.js uses, so one unlock serves both screens");
  // Every fetch goes through api(): no bare fetch() of an api route survives.
  const bare = js.match(/fetch\("api\//g) || [];
  assert.equal(bare.length, 0, "no API call may bypass the key-carrying wrapper");
});

test("A-3: the employee-session caption is the server's answer, never a name literal in the HTML", () => {
  const html = strip(read("src/remoteui/assets/index.html"));
  assert.doesNotMatch(html, /Amara Okafor|Jan Willem Bakker|emp_active_001|emp_nl_amend_001/, "no persona is hard-coded into the page");
  assert.match(html, /id="employee-session-caption"/);
  assert.match(strip(read("src/remoteui/assets/app.js")), /api\/session/, "the caption is read from GET /api/session");
});

test("A-4: the evaluation clock is a visible, editable field; nothing pins it invisibly", () => {
  const html = strip(read("src/remoteui/assets/index.html"));
  const js = strip(read("src/remoteui/assets/app.js"));
  assert.match(html, /id="evaluate-now"/);
  assert.doesNotMatch(js, /scenarioNow/, "the hidden variable is gone");
  assert.match(js, /setField\("evaluate-now", opts\.now/, "quick-fills write the visible field");
});

test("A-2 / A-9: slot 1 is labelled the employer's signatory, and no id is truncated to eight characters", () => {
  const status = describeAmendmentStatus({ status: "pending_dual_approval", adminApproval: null, payrollApproval: null });
  assert.deepEqual(
    status.signatures.map((s) => [s.role, s.label]),
    [["customer_admin", "Employer's signatory"], ["payroll_specialist", "Remote payroll specialist"]],
    "role ids unchanged (they are entitlement keys); labels name the people meant"
  );
  assert.match(status.awaitingRole, /Employer's signatory and Remote payroll specialist/);
  assert.doesNotMatch(strip(read("src/remoteui/assets/app.js")), /slice\(0, 8\)/, "the full amendment id is shown wherever it is needed");
});

test("A-6: consent on an escalated amendment is refused by name — after ownership, so a stranger learns nothing", () => {
  const employee = { role: "employee", employmentId: "emp_x", companyId: "co" };
  const escalated = { id: "a1", employmentId: "emp_x", decision: "escalate", reason: "employee_not_active" };
  const verdict = evaluateConsentAuthorization({ session: employee, party: "employee", amendment: escalated, employment: null });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.status, 409);
  assert.equal(verdict.code, "amendment_not_open_for_consent");
  // Negative control: the same amendment, open, still consents.
  const open = { ...escalated, decision: "dual_approval_required", reason: "all_gates_passed" };
  assert.equal(evaluateConsentAuthorization({ session: employee, party: "employee", amendment: open, employment: null }).allowed, true);
  // Ownership first: somebody else's escalated amendment says "not yours", not "escalated".
  const stranger = { role: "employee", employmentId: "emp_other", companyId: "co" };
  assert.equal(evaluateConsentAuthorization({ session: stranger, party: "employee", amendment: escalated, employment: null }).code, "not_your_amendment");
});

test("A-7 / A-8: the customer-facing page names no internal surface and no longer claims the amendment API is absent", () => {
  const html = strip(read("src/remoteui/assets/index.html"));
  const js = strip(read("src/remoteui/assets/app.js"));
  for (const word of [/\bZAF\b/, /UC-0\d/, /has no public API/]) {
    assert.doesNotMatch(html, word, `index.html must not show ${word}`);
  }
  // Strings the page RENDERS (not comments) must not name the ZAF app.
  const rendered = js.match(/"[^"\n]*"/g).join(" ");
  assert.doesNotMatch(rendered, /ZAF/, "app.js renders no 'ZAF'");
  assert.match(html, /demonstration stand-in/, "it says what it is");
});

test("A-5: a cutoff refusal explains itself from the row's own basis; a schema refusal names the fields in words and says whether this page can supply them", () => {
  const cutoffRow = {
    requestedEffectiveDate: "2026-06-15",
    cutoff: {
      cutoffAlreadyPassed: true,
      hoursUntilCutoff: -240,
      cycle: { id: "run_nl_2026_06", period_start: "2026-06-01", period_end: "2026-06-30", cutoff_date: "2026-06-10", pay_date: "2026-06-30" },
    },
    payload: {},
    flags: ["cutoff_lock_passed"],
  };
  const cutoff = explainRefusal({ decision: "escalate", reason: "cutoff_lock_passed" }, "emp_nl_amend_001", cutoffRow);
  assert.match(cutoff, /run_nl_2026_06/);
  assert.match(cutoff, /closed at 2026-06-10/);
  assert.match(cutoff, /00:00 UTC at the start of that day/, "expert D5: the lock-instant reading is stated");

  const decreaseRow = { payload: { annual_gross_salary: 4500000 }, flags: ["schema_invalid", "missing_salary_decrease_reason", "missing_was_employee_informed"] };
  const decrease = explainRefusal({ decision: "escalate", reason: "schema_invalid" }, "emp_nl_amend_001", decreaseRow);
  assert.match(decrease, /why the salary is being reduced/);
  assert.match(decrease, /confirmation that the employee has been told/);
  assert.match(decrease, /'If this is a decrease' box/, "points at the box this page now has");

  const partTimeRow = { payload: {}, flags: ["schema_invalid", "missing_default_weekly_hours", "missing_part_time_salary_confirmation"] };
  const partTime = explainRefusal({ decision: "escalate", reason: "schema_invalid" }, "emp_nl_parttime_006", partTimeRow);
  assert.match(partTime, /cannot be filed from here/, "a field this page has no box for is stated as such");

  // Negative controls: a success has nothing to explain; the no-form text is not borrowed.
  assert.equal(explainRefusal({ decision: "dual_approval_required", reason: "all_gates_passed" }, "emp_nl_amend_001", cutoffRow), null);
  assert.doesNotMatch(cutoff, /no contract-amendment form/);
});

// ---------------------------------------------------------------------------
// The sidebar (approver personas, D-1 … D-9)
// ---------------------------------------------------------------------------

test("D-1: the sidebar's employee read resolves the row's own world before asking Remote", () => {
  const src = read("src/uc06/server.js");
  const fn = src.slice(src.indexOf("async function employeeAndRequester"));
  assert.match(fn, /remoteFor\(remote, row\.source\)/, "the same resolver the approve path uses");
  assert.match(fn.slice(0, fn.indexOf("describeRequesterParties")), /remote: remoteForRow/, "and the employee is read through it");
});

test("D-1 (execution world): a stand-in-sourced row resolves to the mock, exactly like a portal row", async () => {
  const { sourceAwareRemote } = await import("../deploy/cx-apis/deps.js");
  const real = { getEmployment: async () => ({ id: "real" }) };
  const rc = sourceAwareRemote(real);
  assert.notEqual(rc.forSource("remoteui"), real);
  assert.equal(rc.forSource("remoteui"), rc.forSource("portal"));
  assert.equal(rc.forSource("zendesk"), real, "a ticket-driven row still executes for real");
});

test("D-2: an executed or declined amendment publishes settled facts with a badge that overrides the request-time decision", () => {
  const executed = {
    status: "executed",
    decision: "dual_approval_required",
    adminApproval: { approver: "alice.signatory@acme.test", at: "2026-09-02T16:54:20.418Z" },
    payrollApproval: { approver: "bob.payroll@remote.test", at: "2026-09-02T16:54:24.745Z" },
    executedAt: "2026-09-02T16:54:24.900Z",
    remoteResult: { contract_amendment: { id: "amd_123", status: "submitted" } },
  };
  const s = settledFacts(executed);
  assert.equal(s.state, "executed");
  assert.match(s.badge, /Applied/);
  const sent = s.facts.find((f) => f.label === "Sent to Remote");
  assert.match(sent.value, /amd_123/, "the write is a fact — Remote's own amendment id — not a claim");
  assert.match(sent.value, /submitted/);
  // D-9: one timestamp format, humanised, on every row.
  for (const f of s.facts) assert.doesNotMatch(f.value, /T\d\d:\d\d:\d\d/, `raw ISO leaked into "${f.label}"`);
  assert.doesNotMatch(describeSettled(executed), /T\d\d:\d\d:\d\d\.\d{3}Z/, "the string form is humanised too");

  const declined = { status: "declined", declinedBy: { approver: "carol.payroll@remote.test", role: "payroll_specialist", at: "2026-09-02T17:00:00Z", note: "Lock too close." } };
  const d = settledFacts(declined);
  assert.equal(d.state, "declined");
  assert.equal(d.badge, "Declined");
  assert.match(d.facts.find((f) => f.label === "Declined by").value, /Remote payroll specialist/);
  assert.match(d.facts.find((f) => f.label === "Sent to Remote").value, /Nothing/);

  // Negative control: an open amendment has nothing settled.
  assert.equal(settledFacts({ status: "pending_dual_approval" }), null);
  // A write with no id is not reported as landed.
  assert.match(settledFacts({ ...executed, remoteResult: null }).facts.find((f) => f.label === "Sent to Remote").value, /No Remote write is recorded/);
});

test("D-2 (wiring): both UC-06 read routes publish `settled` and `handoff`", () => {
  const src = read("src/uc06/server.js");
  assert.equal((src.match(/settled: settledFacts\(amendmentRow\)/g) || []).length, 2);
  assert.equal((src.match(/handoff: handoffFor\(\{ useCase: "UC-06"/g) || []).length, 2);
});

test("D-3: the ×100 figure that will be sent is a labelled row on the panel", () => {
  const panels = read("zaf-app/assets/panels.js");
  const uc06 = panels.slice(panels.indexOf('"UC-06": {'), panels.indexOf('"UC-08": {'));
  assert.match(uc06, /Will be sent as/);
  assert.match(uc06, /f\.writesAs \+ " = " \+ String\(f\.writesValue\)/);
  assert.match(uc06, /×100 minor units of/);
});

test("D-4: the effective date leaves the store as a calendar day, on both stores", () => {
  assert.match(read("src/uc06/amendmentStore.js"), /requested_effective_date::text as "requestedEffectiveDate"/);
});

test("D-5: the requester block reaches renderEmployee, and D-6: an escalation names its owning team instead of two empty slots", () => {
  const main = read("zaf-app/assets/main.js");
  const loader = main.slice(main.indexOf("function loadUc06"), main.indexOf("function loadUc08"));
  assert.match(loader, /requester: data\.basis\.requester \|\| data\.requester/);
  assert.match(loader, /handoff: data\.handoff \|\| null/);
  const panels = read("zaf-app/assets/panels.js");
  const uc06 = panels.slice(panels.indexOf('"UC-06": {'), panels.indexOf('"UC-08": {'));
  assert.match(uc06, /a\.decision === "escalate"/);
  assert.match(uc06, /team \+ " owns it/);
  assert.match(uc06, /roles: \[\]/, "no slot is offered on an escalation");
});

test("D-7: the entitlement refusal names its code and what would clear it, cites no document path, and is verb-neutral", () => {
  const entitlement = createEntitlementChecker({ grants: parseRoster("alice@acme.test=uc06:payroll_specialist"), source: "APPROVER_ROLES" });
  const refusal = entitlement.check({ approver: "probe@gatehouse.test", useCase: "UC-06", role: "customer_admin" });
  assert.ok(refusal, "an unlisted identity is refused");
  assert.match(refusal.reason, /approver_not_entitled/);
  assert.match(refusal.reason, /What clears it/);
  assert.match(refusal.reason, /uc06:customer_admin/);
  assert.doesNotMatch(refusal.reason, /docs\//);
  assert.doesNotMatch(refusal.reason, /^.*Approving requires/);
  // Negative control: the listed identity in its own slot is not refused.
  assert.equal(entitlement.check({ approver: "alice@acme.test", useCase: "UC-06", role: "payroll_specialist" }), null);
});

test("D-8: the risk rail no longer calls a contract amendment a trip", () => {
  assert.doesNotMatch(read("zaf-app/assets/main.js"), /assessment of this trip/);
});

test("labels agree across the describer, the status page and the panel", () => {
  assert.equal(DECIDERS[0].label, "Employer's signatory");
  assert.equal(DECIDERS[1].label, "Remote payroll specialist");
  const panels = read("zaf-app/assets/panels.js");
  assert.match(panels, /label: "Employer's signatory"/);
  assert.match(panels, /roleBlock\("customer_admin", "Employer's signatory"/);
});

// ---------------------------------------------------------------------------
// The expert review (D1, D5, D7)
// ---------------------------------------------------------------------------

test("expert D7: a summary never prints null or a quoted amount as a figure", async () => {
  const nullAmount = await draftSummary(
    { changes: { salary: { oldAmount: 50000, newAmount: null, currency: "EUR" } }, requestedEffectiveDate: "2026-07-15" },
    { isConfigured: () => false }
  );
  assert.doesNotMatch(nullAmount.summary, /null/);
  assert.match(nullAmount.summary, /an unstated amount/);
  const quoted = await draftSummary(
    { changes: { salary: { oldAmount: 50000, newAmount: "60000", currency: "EUR" } }, requestedEffectiveDate: "2026-07-15" },
    { isConfigured: () => false }
  );
  assert.match(quoted.summary, /an unstated amount/, "a string is not a figure");
  assert.doesNotMatch(quoted.summary, /to 60000/);
});

test("expert D5: the payroll sentence states the lock-instant reading whenever the lock is date-only", () => {
  const basis = describeAmendmentBasis({
    amendmentRow: {
      requestedEffectiveDate: "2026-07-15",
      cutoff: { hoursUntilCutoff: 480, cycle: { id: "run_nl_2026_07", period_start: "2026-07-01", period_end: "2026-07-31", cutoff_date: "2026-07-10" } },
      payload: {},
      flags: [],
    },
  });
  assert.match(basis.payroll.sentence, /00:00 UTC at the start of that day/);
  // Negative control: a lock stated as an instant is not re-described.
  const instant = describeAmendmentBasis({
    amendmentRow: {
      requestedEffectiveDate: "2026-07-15",
      cutoff: { hoursUntilCutoff: 480, cycle: { id: "run_x", cutoff_date: "2026-07-10T17:00:00Z" } },
      payload: {},
      flags: [],
    },
  });
  assert.doesNotMatch(instant.payroll.sentence, /00:00 UTC at the start/);
});

test("expert D1: UC-06's n8n audit row is specified to disclose a projected cycle, and the pre-fix live expression is refused", async () => {
  const { DETAILS_EXPRESSION, REQUIRED_DETAIL_KEYS, appendAuditLogParamIssues, NODE_TYPE, TABLE_ID } = await import(
    "../workflows/nodes-uc06/appendAuditLogSpec.js"
  );
  for (const key of ["cutoffCycleProjected", "cutoffCycleStandin", "source"]) {
    assert.ok(REQUIRED_DETAIL_KEYS.includes(key), `${key} is required`);
    assert.match(DETAILS_EXPRESSION, new RegExp(`${key}:`), `${key} is written`);
  }
  // The expression the live node carried on 2026-09-02, before this spec existed.
  const liveBefore =
    "={{ ({ amendmentId: $('Create Amendment Record').item.json.id, externalRef: $('Amendment Gates').item.json.externalRef, cutoffCycle: $('Amendment Gates').item.json.cutoff && $('Amendment Gates').item.json.cutoff.cycle ? $('Amendment Gates').item.json.cutoff.cycle.id : null }) }}";
  const issues = appendAuditLogParamIssues({
    type: NODE_TYPE,
    parameters: { tableId: TABLE_ID, fieldsUi: { fieldValues: [{ fieldId: "details", fieldValue: liveBefore }] } },
  });
  assert.ok(issues.some((i) => i.includes("cutoffCycleProjected")), issues.join("; "));
  // And the spec itself passes its own check.
  assert.deepEqual(
    appendAuditLogParamIssues({ type: NODE_TYPE, parameters: { tableId: TABLE_ID, fieldsUi: { fieldValues: [{ fieldId: "details", fieldValue: DETAILS_EXPRESSION }] } } }),
    []
  );
});
