// ---------------------------------------------------------------------------
// portalUc04TravelScenarios.test.js — the day arithmetic, reachable from a form
// ---------------------------------------------------------------------------
// TWO THINGS ARE UNDER TEST, and they are the two halves of one report.
//
// 1. THE PREFILL INVARIANT. A traveller continued a UC-03 routing into the work
//    authorization form and was refused:
//
//      Refused  travel_history_unreadable
//      A prior stay could not be read, so no day count was attempted: prior
//      stay 1: start date missing, end date missing; prior stay 2: start date
//      missing, end date missing.
//
//    The refusal is correct and it is the good kind — buildTravelHistory()
//    NAMES an unreadable row rather than dropping it, because
//    computeCumulativeDays() answers NaN for a stay it cannot read and NaN
//    loses every threshold comparison silently, so one bad row would CLEAR a
//    traveller the same history would otherwise block. The rows should never
//    have looked like that: note the message does not say "no country", so both
//    rows had a country and no dates.
//
//    Driven in a real browser before anything was changed, the leak reproduces
//    whole rather than half: click the "Two counts, two answers" quick-fill,
//    walk to UC-03, submit a workation, continue the routing — and both Spanish
//    stays are still in the form, silently counted into a decision about
//    Portugal that nobody stated them for. The continuation carries five fields
//    (CARRIED_FIELDS) and touched nothing else. The invariant that makes both
//    the whole-row and the half-row case impossible is the one pinned here:
//    AFTER ANY PREFILL, no row is left half-populated, because every box the
//    prefill does not name starts empty.
//
// 2. THE SCENARIOS THAT MAKE THE ARITHMETIC VISIBLE. "I thought we worked on
//    everybody having travel history, whether it is 0 or the required
//    variations of days, so that we can easily demo what this system is
//    supposed to do under several circumstances." UC-04's substance IS the day
//    arithmetic — the Schengen 90/180 window, the 183/365 tax-residency watch,
//    the union-not-sum overlap rule, the refusal on an unreadable stay — and
//    none of it is reachable from the form unless prior stays are filled in.
//
//    EVERY ROW BELOW IS DRIVEN, not described. A quick-fill's label is a claim
//    about what will happen; a claim nobody ran is how a scenario that refuses
//    ends up labelled as one that clears, which is worse than having no
//    scenario at all. The fields come out of app.js's own SCENARIOS object, so
//    a scenario edited without re-running this file fails here.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";

import { ExpenseStore } from "../src/uc02/expenseStore.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { ResignationStore } from "../src/uc05/resignationStore.js";
import { DossierStore as RelocationDossierStore } from "../src/uc07/dossierStore.js";
import { DossierStore as TaxDossierStore } from "../src/uc08/dossierStore.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// Allocated in src/shared/ports.js TEST_PORTS; test/ports.test.js checks that
// this file and that table agree in both directions.
const REMOTE_PORT = 4119;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

let remote;
let remoteServer;

function callApi(h, { method, path, body = null, headers = {} }) {
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
    h(req, res).catch(reject);
  });
}

function buildPortal() {
  return createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: {
      uc02: new ExpenseStore(),
      uc03: new CaseStore(),
      uc04: new AuthorizationStore(),
      uc05: new ResignationStore(),
      uc07: new RelocationDossierStore(),
      uc08: new TaxDossierStore(),
      uc09: new AdjustmentStore(),
    },
    llm: FAKE_LLM,
  });
}

/** The real SCENARIOS object out of app.js — the same lift portalCopy uses. */
function scenarios() {
  const app = read("app.js");
  const start = app.indexOf("  var SCENARIOS = {");
  const end = app.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, "SCENARIOS has moved — re-point this test");
  const context = { SCENARIOS: null };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end + 4).replace("var SCENARIOS =", "SCENARIOS ="), context);
  return context.SCENARIOS;
}

function uc04Scenario(id) {
  const found = scenarios().uc04.find((s) => s.id === id);
  assert.ok(found, `no UC-04 quick-fill called ${id}`);
  return found;
}

/**
 * Submit a quick-fill exactly as the browser's BUILDERS.uc04 would — same
 * fields, same two always-present prior-stay rows. Nothing about the scenario
 * is restated here, so the test cannot agree with a scenario that has changed.
 */
function submitScenario(handler, id, ref) {
  const f = uc04Scenario(id).fields;
  return callApi(handler, {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      persona: "admin",
      employmentId: f["uc04-employmentId"],
      homeCountry: f["uc04-homeCountry"],
      nationality: f["uc04-nationality"],
      destinationCountry: f["uc04-destinationCountry"],
      startDate: f["uc04-startDate"],
      endDate: f["uc04-endDate"],
      visaType: f["uc04-visaType"],
      jobDuties: f["uc04-jobDuties"],
      hasContractSigningAuthority: f["uc04-hasContractSigningAuthority"],
      travelHistory: [
        { country: f["uc04-h1-country"], startDate: f["uc04-h1-startDate"], endDate: f["uc04-h1-endDate"] },
        { country: f["uc04-h2-country"], startDate: f["uc04-h2-startDate"], endDate: f["uc04-h2-endDate"] },
      ],
      reasonText: f["uc04-reasonText"],
      externalRef: ref,
      now: f["uc04-now"],
    },
  });
}

const detail = (body, label) => (body.details || []).find((d) => d.label === label)?.value ?? "";

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. THE FIVE VARIATIONS, EACH DRIVEN TO THE DECISION ITS LABEL PROMISES
// ---------------------------------------------------------------------------

test("no prior stays: a real zero that says it is a floor and not a count", async () => {
  const res = await submitScenario(buildPortal(), "uc04-low", "hist-none");
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.reason, "all_gates_passed");
  // The distinction the whole set is built around: nobody looked anything up,
  // so 0 over 0 trips is the LEAST it could be, not what it is.
  assert.match(detail(res.body, "Cumulative days abroad"), /0 day\(s\) over 0 prior trip\(s\)/);
  assert.match(detail(res.body, "Cumulative days abroad"), /floor, not a count/);
});

test("a count that changes nothing is still a count", async () => {
  const res = await submitScenario(buildPortal(), "uc04-history-clear", "hist-clear");
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.match(detail(res.body, "Cumulative days abroad"), /20 day\(s\) over 1 prior trip\(s\)/);
  assert.match(detail(res.body, "Cumulative days abroad"), /counted from the prior stays stated on this request/);
  // Both windows consulted, both reporting a measurement, neither moving the
  // decision. Without this row, "a number appeared" and "a number mattered"
  // would be indistinguishable across the rest of the set.
  assert.match(detail(res.body, "Schengen 90-in-180"), /34 of 90/);
  assert.match(detail(res.body, "183-in-365 tax-residency watch"), /34 of 183/);
  assert.ok(!res.body.flags.includes("tax_residency_watch"));
  assert.ok(!res.body.flags.includes("schengen_overstay"));
});

test("exactly on the Schengen line: 90 of 90 clears, because the limit is exceeding it", async () => {
  const res = await submitScenario(buildPortal(), "uc04-history-edge", "hist-edge");
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.match(detail(res.body, "Schengen 90-in-180"), /90 of 90/);
  assert.match(detail(res.body, "Schengen 90-in-180"), /0 day\(s\) of headroom/);
  assert.ok(!res.body.flags.includes("schengen_overstay"), "the boundary day itself is allowed");
});

test("two overlapping stays are a union, not a sum — and the difference decides this request", async () => {
  const res = await submitScenario(buildPortal(), "uc04-history-overlap", "hist-overlap");
  const f = uc04Scenario("uc04-history-overlap").fields;

  // The two stays, from the scenario itself, so the arithmetic below is about
  // the dates a demo viewer will actually see in the boxes.
  const span = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  const first = span(f["uc04-h1-startDate"], f["uc04-h1-endDate"]);
  const second = span(f["uc04-h2-startDate"], f["uc04-h2-endDate"]);
  assert.equal(first + second, 86, "the two stays must SUM to more than they cover, or this proves nothing");

  assert.match(detail(res.body, "Cumulative days abroad"), /71 day\(s\) over 2 prior trip\(s\)/);
  assert.match(detail(res.body, "Schengen 90-in-180"), /85 of 90/);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(!res.body.flags.includes("schengen_overstay"));

  // AND THIS IS THE POINT. Summed, the same two stays plus the trip read 100 of
  // 90 and this request is blocked. A traveller refused on days they did not
  // spend is not a stricter system, it is a wrong one — the defect 73920c9
  // fixed, and the row that would go red if the arithmetic regressed.
  assert.ok(first + second + 14 > 90, "the summing bug would have blocked this trip");
});

test("over the Schengen limit: blocked, with the figure it refused on", async () => {
  const res = await submitScenario(buildPortal(), "uc04-history-over", "hist-over");
  assert.equal(res.body.decision, "blocked");
  assert.equal(res.body.reason, "schengen_90_180_exceeded");
  assert.ok(res.body.flags.includes("schengen_overstay"));
  assert.match(detail(res.body, "Schengen 90-in-180"), /OVER THE LIMIT/);
  assert.match(detail(res.body, "Schengen 90-in-180"), /121 of 90/);
  assert.match(detail(res.body, "Schengen 90-in-180"), /over by 31/);
  // NOT REACHED is a different claim from "under the line", and the panel makes
  // it: a hard block decided this before the rolling-window count was taken.
  assert.match(detail(res.body, "183-in-365 tax-residency watch"), /Not reached/);
});

test("over the tax-residency watch line, and still approvable — the two windows disagree", async () => {
  const res = await submitScenario(buildPortal(), "uc04-disagree", "hist-disagree");
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(res.body.flags.includes("tax_residency_watch"));
  assert.match(detail(res.body, "Schengen 90-in-180"), /59 of 90/);
  assert.match(detail(res.body, "183-in-365 tax-residency watch"), /210 of 183/);
});

test("the label on every quick-fill matches the decision it actually produces", async () => {
  // `fails: true` puts a "refused" mark on the button. A scenario that promises
  // to clear and then refuses is worse than no scenario, and vice versa: it
  // teaches a demo viewer that the system is arbitrary.
  const handler = buildPortal();
  let n = 0;
  for (const scenario of scenarios().uc04) {
    if (scenario.persona !== "admin") continue; // the persona-refusal row is about WHO asks, not about days
    const res = await submitScenario(handler, scenario.id, `label-check-${n++}`);
    // "Clears" means the one decision that needs nothing further explained: the
    // request is ready for its single mobility approver. Everything else —
    // `blocked`, `escalate`, or a 4xx before a decision — is a row the button
    // has to admit does not sail through.
    const clears = res.status === 200 && res.body.decision === "ready_for_approval";
    assert.equal(
      clears,
      scenario.fails !== true,
      `${scenario.id} is marked ${scenario.fails ? "refused" : "clearing"} and produced ${res.body.decision ?? res.body.code}`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. THE PREFILL INVARIANT — no row may be left half populated
// ---------------------------------------------------------------------------

/** A form just big enough to hold the boxes a prefill writes into. */
function formSandbox(fields) {
  const nodes = fields.map((f) => ({
    id: f.id,
    tag: f.tag || "input",
    type: f.type || "text",
    value: f.value ?? "",
    checked: f.checked ?? false,
  }));
  const form = { querySelectorAll: () => nodes };
  const document = { createElement: () => ({}) };
  return { form, nodes, document };
}

function runBlankForm(fields) {
  const app = read("app.js");
  const start = app.indexOf("  function blankForm(typeId) {");
  const end = app.indexOf("  function setFieldValue(", start);
  assert.ok(start !== -1 && end > start, "blankForm() has moved — re-point this test");

  const { form, nodes, document } = formSandbox(fields);
  const synced = [];
  const context = { document, byId: () => form, syncRefField: (t) => synced.push(t) };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  vm.runInContext('blankForm("uc04")', context);
  return { nodes, synced };
}

test("a prefill starts from an empty form, so no box can inherit a value nobody chose", () => {
  const { nodes, synced } = runBlankForm([
    { id: "uc04-h1-country", tag: "select", value: "ES" },
    { id: "uc04-h1-startDate", type: "date", value: "2026-07-01" },
    { id: "uc04-h1-endDate", type: "date", value: "2026-08-14" },
    { id: "uc04-jobDuties", tag: "select", value: "sales" },
    { id: "uc04-hasContractSigningAuthority", type: "checkbox", checked: true },
    { id: "uc04-reasonText", tag: "textarea", value: "an earlier trip" },
    // The reference control's two radios. Blanking these would leave the form
    // in NEITHER mode, so they are the one thing skipped — deliberately, and
    // pinned so a later "tidy" cannot fold them in.
    { id: "refmode-uc04-new", type: "radio", checked: true },
    { id: "refmode-uc04-reuse", type: "radio", checked: false },
  ]);

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const id of ["uc04-h1-country", "uc04-h1-startDate", "uc04-h1-endDate", "uc04-jobDuties", "uc04-reasonText"]) {
    assert.equal(byId[id].value, "", `${id} kept a value across the prefill`);
  }
  assert.equal(byId["uc04-hasContractSigningAuthority"].checked, false);
  assert.equal(byId["refmode-uc04-new"].checked, true, "the reference mode must survive — a form in neither mode sends nothing");
  assert.deepEqual(synced, ["uc04"], "the reference field must be re-synced after the boxes are emptied");
});

test("both prefill paths start from the empty form — the quick-fill and the continuation", () => {
  // STRUCTURAL, because the alternative is a second copy of the field list. The
  // choice between "clear what the prefill does not name" and "name every field
  // explicitly" is argued in blankForm()'s header: naming them all is a copy of
  // the form living in a file the form does not import, and a box added next
  // year keeps a stale value with no symptom. Clearing derives the list FROM
  // the form, so a new box is covered by existing.
  const app = read("app.js");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const scenarioFn = code.slice(code.indexOf("function applyScenario("), code.indexOf("function markRequiredFields("));
  assert.match(scenarioFn, /^\s*function applyScenario\(typeId, scenario\) \{\s*blankForm\(typeId\);/m, "a quick-fill must empty the form first");

  const contFn = code.slice(code.indexOf("function applyContinuation("), code.indexOf("function renderContinuationBanner("));
  assert.match(contFn, /^\s*function applyContinuation\(data\) \{\s*blankForm\("uc04"\);/m, "a continuation must empty the form first");

  // And the caller passes the type, rather than blankForm guessing it from a
  // scenario id prefix — an id is a label, not a routing key.
  assert.match(code, /applyScenario\(typeId, scenario\)/);
});

test("a half-populated prior stay is refused BY NAME, which is why the form must not create one", async () => {
  // The server half of the invariant, pinned so the two halves cannot drift:
  // if a half row ever reaches it again, it is named rather than silently
  // completed or dropped. A count that is missing a stay is not a smaller
  // count — it is not a count.
  const res = await callApi(buildPortal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      persona: "admin",
      employmentId: uc04Scenario("uc04-low").fields["uc04-employmentId"],
      homeCountry: "DE",
      nationality: "DE",
      destinationCountry: "ES",
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      visaType: "schengen_short_stay",
      jobDuties: "engineering",
      hasContractSigningAuthority: false,
      travelHistory: [
        { country: "ES", startDate: "", endDate: "" },
        { country: "ES", startDate: "", endDate: "" },
      ],
      externalRef: "half-row",
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, "travel_history_unreadable");
  assert.match(res.body.reason, /prior stay 1: start date missing, end date missing/);
  assert.match(res.body.reason, /prior stay 2: start date missing, end date missing/);
  // The absence in that message is the diagnosis: no "no country", so the rows
  // held a country and no dates.
  assert.ok(!res.body.reason.includes("no country"));
});
