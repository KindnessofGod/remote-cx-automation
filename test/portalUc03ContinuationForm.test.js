// ---------------------------------------------------------------------------
// portalUc03ContinuationForm.test.js  —  the continuation has to be COMPLETABLE
// ---------------------------------------------------------------------------
// WHAT WENT WRONG, IN ONE PARAGRAPH
//
// A real employee filed a travel request, it routed to UC-04, they continued
// it, they filled in the form, and they got:
//
//   blocked / factors_invalid, flags [factors_invalid, missing_nationality],
//   decided by gate 5 of 18 — request_completeness
//
// Gate 5 was right. Nationality drives the Schengen 90/180 branch and the visa
// question, UC-04's matrix must never guess it, and the gate's own `means`
// sentence says out loud that this is "a request to be completed, not a request
// that was refused". The defect was one layer up: the continuation named the
// still-missing inputs in a paragraph at the top of the page and then rendered
// them as plain empty boxes, indistinguishable from the optional "Evaluate as
// at" beside them — while the boxes that were ALREADY FILLED were the ones
// wearing a marker. The one field that mattered was the only one with nothing
// on it, and nothing stopped the submission that was certain to be refused.
//
// WHY A POSITIVE TEST IS THE POINT OF THIS FILE
//
// CLAUDE.md §4 names this repo's most expensive recurring defect: "refusing
// correctly and being unable to succeed look identical from outside", so only a
// test that says "this input MUST succeed" can tell them apart. Every assertion
// this flow had was a refusal. So the load-bearing test below drives a UC-03
// routing, continues it, submits what a COMPLETED form sends, and asserts the
// request reaches a real risk assessment — decided by a gate LATER than 5, with
// the matrix actually having run. The refusal test is kept beside it, because a
// fix that reached the matrix by loosening gate 5 would be worse than the bug.
//
// EVERY LLM SEAM IS FAKED, the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom: this
// devcontainer carries a genuine but unreachable OPENAI_API_KEY, so a missed
// seam is a real, retried, slow network call (CLAUDE.md §6).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { createPortalHandler } from "../src/portal/server.js";
import { GATE_SEQUENCE as uc04GateSequence } from "../src/uc04/policyEngine.js";

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
import { UC04_FORM_FIELDS, CARRIED_FIELDS } from "../src/portal/uc03Continuation.js";
import { LIVE_EMPLOYMENT_SHOW_ENVELOPE } from "./fixtures/sandboxCapture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

// A literal, and deliberately so: TEST_BAND is reserved for exactly this. It is
// also DECLARED, in src/shared/ports.js's TEST_PORTS under this file's name —
// test/ports.test.js scans the suite and fails if a file binds a port the
// registry does not know about, which is how 4096 (already review.test.js's)
// was caught here rather than as a hung `before()` hook on somebody else's run.
const REMOTE_PORT = 4111;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

/** The exact request shape that routes to UC-04 and states no dates. */
const WORKATION_TEXT =
  "I would like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?";

let remote;
let remoteServer;

function freshStores() {
  return {
    uc02: new ExpenseStore(),
    uc03: new CaseStore(),
    uc04: new AuthorizationStore(),
    uc05: new ResignationStore(),
    uc07: new RelocationDossierStore(),
    uc08: new TaxDossierStore(),
    uc09: new AdjustmentStore(),
  };
}

/** Same in-process handler driver every other server suite in this repo uses. */
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
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: freshStores(), llm: FAKE_LLM });
}

/**
 * Drive a travel request to a routing and open its continuation — i.e. get the
 * page into exactly the state the employee was in when they hit gate 5.
 *
 * Returns the continuation payload AND its prefill collapsed into the
 * field-id -> value map the browser writes into the form, so the tests below
 * submit the values the SERVER supplied rather than values they made up. A test
 * that typed its own home country would pass even if the prefill were broken.
 */
async function openContinuation(handler, externalRef) {
  const routed = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: "chris", text: WORKATION_TEXT, externalRef },
  });
  assert.equal(routed.body.decision, "route_to_uc04", "the fixture request must still route to UC-04");

  const cont = await callApi(handler, {
    method: "POST",
    path: "/api/requests/uc03/continue",
    body: { persona: "chris", caseId: routed.body.recordId },
  });
  assert.equal(cont.body.ok, true, "the continuation must open");

  const prefilled = {};
  (cont.body.prefill || []).forEach((item) => {
    prefilled[item.field] = item.value;
  });
  return { routed, cont, prefilled };
}

/**
 * The body the browser sends once the form has been filled in.
 *
 * The carried half comes from `prefilled`, so it is the server's own answer
 * travelling back; `answers` is what the employee typed into the boxes the
 * server said were empty. Keeping the two apart in the helper is the point —
 * every test below can then say exactly which half it is varying.
 */
function completedForm({ cont, prefilled, answers }) {
  return {
    persona: "admin",
    continuationOf: cont.body.caseId,
    employmentId: prefilled["uc04-employmentId"],
    homeCountry: prefilled["uc04-homeCountry"],
    destinationCountry: prefilled["uc04-destinationCountry"],
    reasonText: cont.body.reasonText,
    externalRef: cont.body.externalRef,
    ...answers,
  };
}

const submitUc04 = (handler, body) => callApi(handler, { method: "POST", path: "/api/requests/uc04", body });

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// 1. THE POSITIVE TEST — the one this whole file exists for
// ---------------------------------------------------------------------------

test("POSITIVE — a continuation whose form is completed reaches a real risk assessment", async () => {
  const handler = buildPortal();
  const { cont, prefilled } = await openContinuation(handler, "form-complete-1");

  const res = await submitUc04(
    handler,
    completedForm({
      cont,
      prefilled,
      // The five things a travel request never states, answered — which is
      // precisely what the form now asks for and marks.
      answers: {
        nationality: "US",
        startDate: "2026-10-05",
        endDate: "2026-10-30",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    })
  );

  assert.equal(res.body.ok, true);

  // THE ASSERTION THAT MATTERS. Not "it did not say factors_invalid" — that is
  // satisfiable by any refusal at all, including a new one — but that the
  // deciding gate is LATER than the completeness gate, which is the only thing
  // that distinguishes "the request could be assessed" from "the request was
  // refused earlier for a different reason".
  assert.ok(
    res.body.decidedBy && res.body.decidedBy.position > 5,
    `a completed continuation must be decided past the completeness gate, was decided at gate ` +
      `${res.body.decidedBy && res.body.decidedBy.position} — ${res.body.reason}`
  );
  assert.notEqual(res.body.reason, "factors_invalid");
  assert.ok(
    !(res.body.flags || []).includes("missing_nationality"),
    "the exact flag the employee hit must not come back"
  );

  // And the matrix genuinely RAN, rather than the request simply surviving
  // longer. `all_gates_passed` is the LAST rung of UC-04's ladder — the one
  // that opens a specialist approval, so this is the full journey, not a longer
  // refusal. Read off GATE_SEQUENCE rather than hard-coded: the number moved
  // from 17 to 18 when the travel-history readability gate was added, and a
  // literal here fails on any future insertion while proving nothing extra.
  assert.equal(res.body.decision, "ready_for_approval");
  assert.equal(res.body.reason, "all_gates_passed");
  assert.equal(res.body.decidedBy.position, uc04GateSequence.length);
  assert.equal(
    uc04GateSequence[uc04GateSequence.length - 1].reason,
    "all_gates_passed",
    "the last rung must be the passing one, or the assertion above means something else"
  );
});

test("POSITIVE — a completed continuation can also reach a SUBSTANTIVE escalation", async () => {
  // The second half of "it can succeed": a fix that only ever produced
  // `ready_for_approval` would have swapped one structural outcome for another,
  // and the flow would still be incapable of half its verdicts. Same completed
  // form, two factors changed — an executive who signs contracts abroad is the
  // matrix's sharpest permanent-establishment input — and the decision becomes
  // an escalation the MATRIX reached, on a finding of its own, far past gate 5.
  const handler = buildPortal();
  const { cont, prefilled } = await openContinuation(handler, "form-complete-2");

  const res = await submitUc04(
    handler,
    completedForm({
      cont,
      prefilled,
      answers: {
        nationality: "US",
        startDate: "2026-10-05",
        endDate: "2026-12-20",
        visaType: "digital_nomad_visa",
        jobDuties: "executive",
        hasContractSigningAuthority: true,
      },
    })
  );

  assert.equal(res.body.ok, true);
  assert.ok(
    res.body.decidedBy && res.body.decidedBy.position > 5,
    `expected a gate past completeness, got gate ${res.body.decidedBy && res.body.decidedBy.position} — ${res.body.reason}`
  );
  assert.notEqual(res.body.reason, "factors_invalid");

  // Escalated to Mobility Legal Tier-2 on the matrix's own high-risk finding —
  // a permanent-establishment risk it could only have computed BECAUSE the five
  // still-needed answers arrived. `pe_risk_dape` is the flag; it is unreachable
  // from a request that stops at gate 5.
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "high_risk_pair");
  assert.ok((res.body.flags || []).includes("pe_risk_dape"), `expected a matrix finding, got ${res.body.flags}`);
});

// ---------------------------------------------------------------------------
// 2. THE GATE IS NOT LOOSENED
// ---------------------------------------------------------------------------

test("NEGATIVE — an incomplete continuation still stops at gate 5, with the same flag", async () => {
  const handler = buildPortal();
  const { cont, prefilled } = await openContinuation(handler, "form-incomplete-1");

  // Exactly what the employee sent: everything filled except the one box that
  // was neither prefilled nor marked.
  const res = await submitUc04(
    handler,
    completedForm({
      cont,
      prefilled,
      answers: {
        nationality: null,
        startDate: "2026-10-05",
        endDate: "2026-10-30",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    })
  );

  assert.equal(res.body.decision, "blocked");
  assert.equal(res.body.reason, "factors_invalid");
  assert.deepEqual(res.body.flags, ["factors_invalid", "missing_nationality"]);
  assert.equal(res.body.decidedBy.position, 5);
  assert.equal(res.body.decidedBy.gate, "request_completeness");
});

test("NEGATIVE — the gate still refuses a request that states only half a date range", async () => {
  // The imprecision src/uc03/uc04Intake.js documents about itself: it reports
  // the date PAIR against the start date alone, so a routing that read a start
  // and no end would report its dates as carried. UC-04 requires both, and this
  // pins that it still does — the page closing that hole must not be mistaken
  // for the gate having stopped caring.
  const handler = buildPortal();
  const { cont, prefilled } = await openContinuation(handler, "form-incomplete-2");

  const res = await submitUc04(
    handler,
    completedForm({
      cont,
      prefilled,
      answers: {
        nationality: "US",
        startDate: "2026-10-05",
        endDate: null,
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
    })
  );

  assert.equal(res.body.reason, "factors_invalid");
  assert.ok((res.body.flags || []).includes("missing_dates"));
  assert.equal(res.body.decidedBy.position, 5);
});

// ---------------------------------------------------------------------------
// 3. NATIONALITY — asked because Remote does not publish it
// ---------------------------------------------------------------------------
//
// Re-checked live on 2026-08-19 rather than inherited: `GET /v1/employments/
// {employment_id}`'s OpenAPI has zero occurrences of nationality, citizenship or
// passport, and so does Remote's work-authorization object — which carries a
// `travel_document_number` and no nationality at all, so even the resource this
// assessment is ABOUT does not record it. The one place the word appears in
// Remote's whole API index is `PUT /v1/employee/personal-details`, whose own
// description names nationality among the fields it UPDATES: a write, on the
// employee-session `/v1/employee/…` family, which a company token is refused
// from with `403 Forbidden, invalid role for this endpoint` (CLAUDE.md §7's
// closed expense-categories finding, the same family, verified live the same
// day). The only read beside it, `GET /v1/employee/personal-information`, types
// its 200 as a bare SuccessResponse — no personal field is documented on it at
// all.
//
// So: the value exists somewhere in Remote, and nothing this system may call
// returns it. That is a stronger reason to ask than "the field does not exist",
// and it is the reason the form asks rather than infers. An employee working in
// the Netherlands is not necessarily Dutch.

test("the live employment capture carries no nationality to be tempted by", () => {
  const captured = JSON.stringify(LIVE_EMPLOYMENT_SHOW_ENVELOPE);
  for (const word of ["nationality", "citizenship", "passport"]) {
    assert.ok(
      !new RegExp(word, "i").test(captured),
      `the Sandbox capture contains "${word}" — if Remote has started returning it, the form should stop asking, ` +
        "and this test is where that conversation starts"
    );
  }
});

// ---------------------------------------------------------------------------
// 4. THE PAGE — what it marks, and what it is not allowed to know
// ---------------------------------------------------------------------------

test("app.js compiles and still writes nothing as markup", () => {
  const source = read("app.js");
  assert.doesNotThrow(() => new vm.Script(source, { filename: "app.js" }));
  assert.ok(!/\.innerHTML\s*=/.test(source), "app.js assigns innerHTML");
  assert.ok(!/insertAdjacentHTML|document\.write/.test(source), "app.js injects raw markup");
});

// The marker is attached to `node.closest(".r-field")`, and `closest()` returns
// null rather than throwing — so a field that is not inside one gets no marker,
// no border and no announcement, silently, in production only. This is the same
// class of silent failure the existing "every field the continuation writes into
// exists" test guards, one level down: the element can exist and still be
// unmarkable.
test("every box a continuation can ask for sits inside a markable field wrapper", () => {
  const html = read("index.html");
  const fields = [...UC04_FORM_FIELDS.flatMap((f) => f.fields), ...CARRIED_FIELDS.map((c) => c.field)];

  for (const id of new Set(fields)) {
    const at = html.indexOf(`id="${id}"`);
    assert.notEqual(at, -1, `index.html has no element with id="${id}"`);

    // Walk back to the nearest enclosing element opening tag that carries the
    // r-field class. A string search is enough here and is deliberately cruder
    // than a parser: it fails loudly if the markup is restructured, which is
    // exactly when a human should look.
    const before = html.slice(0, at);
    const wrapper = before.lastIndexOf('class="r-field');
    const closed = before.lastIndexOf("</label>");
    assert.ok(
      wrapper !== -1 && wrapper > closed,
      `#${id} is not inside an element with class "r-field" — closest(".r-field") would return null ` +
        "and the still-needed marker would silently never appear"
    );
  }
});

// THE ANTI-DRIFT ASSERTION, and the reason the browser half is safe to trust.
// The page marks and checks boxes it is TOLD about. If it held its own list of
// what UC-04 requires, that list would be a second copy of a rule that already
// exists in src/uc04/policyEngine.js and is already mirrored once, in
// src/uc03/uc04Intake.js, under a drift test. A third copy in a file no test
// imports is the one that would go stale unnoticed — and the failure mode is the
// original bug exactly: an input UC-04 requires that the page never asks for.
test("the page derives the boxes it asks for from the server's answer, not a list of its own", () => {
  const source = read("app.js");
  const start = source.indexOf("function gapsFrom(");
  const end = source.indexOf("function clearGapMarks(");
  assert.ok(start !== -1 && end > start, "the gap machinery has been renamed — re-point this test at it");
  const machinery = source.slice(start, end);

  // It reads the payload's two absence lists...
  assert.ok(/data\.stillNeeded/.test(machinery), "gapsFrom must read the server's stillNeeded list");
  assert.ok(/data\.prefill/.test(machinery), "gapsFrom must also read prefill entries with no value");

  // ...and names not one UC-04 field of its own. Checked against the REAL field
  // ids rather than a restated list, so a renamed input cannot make this pass by
  // no longer matching.
  const ids = new Set([...UC04_FORM_FIELDS.flatMap((f) => f.fields), ...CARRIED_FIELDS.map((c) => c.field)]);
  for (const id of ids) {
    assert.ok(
      !machinery.includes(id),
      `the gap machinery names "${id}" directly — that is a second copy of UC-04's requirement list, ` +
        "living in the one place no test imports"
    );
  }
});

// The held-back submission must never leak past the continuation. A UC-04
// request filed straight from the form is a legitimate demonstration of gate 5,
// and swallowing it in the browser would destroy the demonstration AND hide the
// gate — the mistake REQUIRED_FIELDS' own comment warns about, one form down.
test("the submit guard runs only while a continuation is open", () => {
  const source = read("app.js");
  const at = source.indexOf('if (typeId === "uc04" && pendingContinuation)');
  assert.notEqual(at, -1, "the guard must be conditioned on BOTH the form and an open continuation");

  // And it must come to a stop rather than fall through into the POST.
  const body = source.slice(at, at + 400);
  assert.ok(/showGapPrompt\(/.test(body) && /\n\s*return;/.test(body), "the guard must return without posting");

  // It must not render anything decision-shaped. `result-box` and `refused` are
  // the classes the real verdict panel uses; borrowing either would put a page's
  // own opinion in the costume of a gate's verdict.
  const promptStart = source.indexOf("function showGapPrompt(");
  const promptEnd = source.indexOf("function render(", promptStart);
  assert.ok(promptStart !== -1 && promptEnd > promptStart, "showGapPrompt has moved — re-point this test");
  const prompt = source.slice(promptStart, promptEnd);
  assert.ok(!/result-box|"refused"/.test(prompt), "the not-submitted prompt must not dress as a decision");
  for (const word of ["blocked", "escalate", "auto_resolve", "ready_for_approval"]) {
    assert.ok(!prompt.includes(word), `the not-submitted prompt says "${word}" — nothing has been decided`);
  }
});

// A checkbox has no empty state: unchecked is submitted as `false`, `false` is a
// boolean, and gate 5 wants a boolean. Marking it "still needed" would put a
// marker on a box no click can clear and hold back a submission over a question
// already answered "no".
test("the guard treats a checkbox as answered, because it always is", () => {
  const source = read("app.js");
  const start = source.indexOf("function isAnswered(");
  const end = source.indexOf("function refreshGapMarks(", start);
  assert.ok(start !== -1 && end > start, "isAnswered has moved — re-point this test");
  const fn = source.slice(start, end);
  assert.ok(/checkbox/.test(fn) && /return true/.test(fn), "isAnswered must exempt checkboxes");
});

// ---------------------------------------------------------------------------
// 5. THE COPY ABOVE THE FORM — two sentences, and nothing written for us
// ---------------------------------------------------------------------------
//
// WHAT WENT WRONG THE SECOND TIME. The fix in section 4 above worked: the boxes
// are marked and the submission is held back. What it did not do was take
// anything OFF the page — so the employee met twenty lines of prose before the
// first input, including which stage of Remote's approval flow this is, all
// five carried values listed a second time beside the boxes already holding
// them, one sentence per still-needed input of which four were the same
// sentence, a paragraph of schema evidence about nationality, and a paragraph
// about Remote publishing no create endpoint. Every word of it true. None of it
// needed by somebody who has to fill in five boxes, and a page that has to be
// read past is a page that gets skimmed — which is how the box in the middle of
// the grid was missed in the first place.
//
// HONEST IS NOT THE SAME AS VERBOSE. This repo's disclosure discipline is about
// never hiding what the system cannot do; it is not a licence to say it on
// every surface, in every paragraph, in the vocabulary of the people who built
// it. "UC-03", "the classifier" and "GET /v1/employments/{employment_id}" are
// ours, not the employee's. So the tests below pin the SHAPE of the copy —
// two sentences, no internal names, the reasons stated once behind a shut
// disclosure — while section 4's tests go on pinning every control.
//
// These run the REAL renderer over the REAL server payload. app.js is browser
// code no other test can import, so its two copy functions are lifted out and
// executed in a `node:vm` sandbox with the same four-line `el` helper the file
// itself defines — the same technique test/n8nParity.test.js uses on the n8n
// Code node bodies, for the same reason: a string assertion about source cannot
// tell you what a reader ends up looking at.

/** A DOM small enough to render into, and no smaller. */
function domSandbox() {
  const make = (tag) => ({
    tag,
    className: null,
    textContent: "",
    hidden: false,
    open: false,
    childNodes: [],
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    // THE BANNER HOLDS BUTTONS NOW, so the stub element grows the two methods a
    // button needs. Both are recorded rather than ignored: `attrs` lets a test
    // read `aria-pressed`, and the listener map lets one be pressed. A no-op
    // pair would have let a control that never binds its handler pass.
    attrs: {},
    listeners: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
  });
  const document = {
    createElement: make,
    createDocumentFragment: () => make("#fragment"),
    // A text node is a childNode with no tag and no children — exactly what
    // textOf() walks, so it is modelled rather than special-cased.
    createTextNode: (text) => ({ tag: "#text", textContent: String(text), childNodes: [], appendChild() {} }),
  };
  // Byte-for-byte what app.js's own el() does — see its definition at the top
  // of the file. If that helper changes shape, this stub is where it shows.
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  return { document, el, make };
}

/** All the text under a node, in reading order. */
function textOf(node) {
  const own = node.textContent || "";
  return node.childNodes.reduce((acc, child) => acc + textOf(child), own);
}

function findByTag(node, tag) {
  if (node.tag === tag) return node;
  for (const child of node.childNodes) {
    const hit = findByTag(child, tag);
    if (hit) return hit;
  }
  return null;
}

/**
 * Render the banner the way the browser does: the two real functions, the real
 * payload, one stub DOM.
 */
function renderBanner(payload) {
  const source = read("app.js");
  const cut = (name, until) => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${until}(`, start);
    assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
    return source.slice(start, end);
  };

  const { document, el, make } = domSandbox();
  const banner = make("div");
  const context = {
    document,
    el,
    byId: () => banner,
    // The roster /api/context sends. Empty here: this sandbox's subject is the
    // banner's shape, and an unmatched id must fall back to the plain heading
    // rather than to a name this page composed. The named case is driven in
    // test/portalUc03Subject.test.js.
    context: { personas: [] },
    clear: (node) => {
      node.childNodes.length = 0;
    },
  };
  vm.createContext(context);
  // THREE FUNCTIONS NOW, NOT TWO. The banner names the person the continuation
  // is about, and it gets that name by matching the carried employment id
  // against the persona roster the server sent — so carriedSubjectName() and
  // the one-line lookup under it have to come into the sandbox with it. The
  // roster is stubbed as `context` below; an empty one is the honest default
  // and makes the banner fall back to its unnamed heading, which is the case
  // this sandbox exercises unless a test says otherwise.
  vm.runInContext(
    cut("renderContinuationBanner", "whyBlank") +
      "\n" +
      cut("whyBlank", "markCarried") +
      "\n" +
      cut("carriedSubjectName", "clearCarriedMarks"),
    context
  );
  vm.runInContext("renderContinuationBanner(PAYLOAD)", Object.assign(context, { PAYLOAD: payload }));
  return banner;
}

test("the copy above the form is the heading, and nothing after it", async () => {
  // THE ASSERTION IS NOW AN ABSENCE, and that is deliberate. It used to pin
  // "exactly one paragraph, at most two sentences, under 320 characters" —
  // which is a budget, and a budget is a thing prose grows back into. The
  // project owner, on the paragraph that fitted inside it: "remove this part —
  // only the heading is needed. Same for every use case." So the test pins the
  // shape that cannot drift: a heading and a closed disclosure, with no prose
  // between them.
  const handler = buildPortal();
  const { cont } = await openContinuation(handler, "copy-shape-1");
  const banner = renderBanner(cont.body);

  // Everything the reader meets before the disclosure.
  const upFront = banner.childNodes.filter((n) => n.tag !== "details");
  // COUNTED AT EVERY DEPTH, not just at the banner's top level. The completion
  // buttons arrive inside a wrapper div, so a paragraph nested one level down
  // would have slipped past the old top-level filter — and a lead sentence
  // introducing those buttons is exactly the prose this assertion removed.
  // Paragraphs with no text are not prose: the completions' note starts empty
  // and hidden and only says anything once a button has been pressed, which is
  // the same convention as the quick-fill note above the form.
  const paragraphs = [];
  const collectParagraphs = (node) => {
    if (node.tag === "p" && (node.textContent || "").trim()) paragraphs.push(node);
    (node.childNodes || []).forEach(collectParagraphs);
  };
  upFront.forEach(collectParagraphs);
  assert.equal(paragraphs.length, 0, "the banner has started explaining itself again — the heading is the whole message");

  // The heading itself must still be there: cutting the prose is not cutting
  // the banner, and a reader arriving from a travel request has to be told why
  // they are suddenly on a different form.
  const upFrontText = textOf({ ...banner, childNodes: upFront }).trim();
  assert.match(upFrontText, /Continued from your travel request/);

  // And the removed sentences by name, so they cannot come back a clause at a
  // time. The second of them narrated the form the reader is looking at; the
  // form says it about itself, on the boxes, where it can be read against them.
  for (const gone of ["this form is it", "is filled in below", "check those answers"]) {
    assert.ok(!upFrontText.includes(gone), `the banner is narrating the form again: "${gone}"`);
  }

  // The vocabulary test. Each of these is a real thing this page used to say,
  // and every one of them is a name for something the employee has never seen.
  for (const internal of [/UC-0\d/, /\/v1\//, /\bclassifier\b/i, /\bgate\b/i, /\bEMPLOYER'S\b/, /\bschema\b/i, /\bendpoint\b/i, /\bAPI\b/]) {
    assert.ok(!internal.test(upFrontText), `the banner still says ${internal}`);
  }
});

test("the carried values are shown in the boxes that hold them, not listed above the form", async () => {
  const handler = buildPortal();
  const { cont, prefilled } = await openContinuation(handler, "copy-shape-2");
  const banner = renderBanner(cont.body);
  const upFront = textOf({ ...banner, childNodes: banner.childNodes.filter((n) => n.tag !== "details") });

  // The employment id is the clearest case: a 36-character UUID printed above a
  // form that already has it in a box, where nobody can do anything with it.
  for (const [field, value] of Object.entries(prefilled)) {
    if (value === null || value === undefined) continue;
    assert.ok(!upFront.includes(String(value)), `the banner still prints ${field}'s value back at the reader`);
  }
});

test("the reasons are stated once, behind a disclosure that starts closed", async () => {
  const handler = buildPortal();
  const { cont } = await openContinuation(handler, "copy-shape-3");
  const banner = renderBanner(cont.body);

  const details = findByTag(banner, "details");
  assert.ok(details, "the reasons must still be on the page, in a disclosure");
  assert.equal(details.open, false, "the disclosure must start closed — nobody should have to open it to finish");

  const summary = findByTag(details, "summary");
  assert.ok(summary && textOf(summary).trim().length > 0, "the disclosure needs a summary line");

  // ONE LINE PER REASON, not one per field. Four of the five still-needed
  // entries arrive carrying the SAME sentence; printing it four times is most of
  // what made the old section unreadable.
  const reasons = (cont.body.stillNeeded || []).filter((item) => item.why);
  const distinct = new Set(reasons.map((item) => item.why));
  assert.ok(reasons.length > distinct.size, "the fixture no longer has a shared reason — re-point this test");

  const items = [];
  const collect = (node) => {
    if (node.tag === "li") items.push(node);
    node.childNodes.forEach(collect);
  };
  collect(details);
  assert.equal(items.length, distinct.size, `the disclosure prints ${items.length} lines for ${distinct.size} reasons`);

  // And every sentence in there is still the SERVER'S, unedited: a reworded
  // copy in the browser would be a second version of an explanation that
  // belongs to src/portal/uc03Continuation.js.
  const inside = textOf(details);
  for (const why of distinct) assert.ok(inside.includes(why), `the disclosure has dropped or reworded: ${why}`);
  for (const item of reasons) assert.ok(inside.includes(item.label), `the disclosure names no box for: ${item.why}`);
  if (cont.body.nationalityNote) assert.ok(inside.includes(cont.body.nationalityNote), "the nationality note has been dropped");
});

// The banner is not the only place these sentences appear, and the other place
// is the one that matters most: the prompt shown when a submission is held back
// names every empty box in the server's own words. Cutting the prose above the
// form must not have cut it there — that panel is the one a person reads when
// they are stuck.
test("the held-back prompt still says which boxes, in the server's sentences", () => {
  const source = read("app.js");
  const start = source.indexOf("function showGapPrompt(");
  const end = source.indexOf("function render(", start);
  const prompt = source.slice(start, end);
  assert.ok(/gap\.label \|\| gap\.field/.test(prompt), "the prompt must name each box by the server's label");
  assert.ok(/gap\.why/.test(prompt), "the prompt must still carry the server's reason for each box");
  assert.ok(/focus\(\)/.test(prompt), "the prompt must still put the cursor in the first empty box");
});

// A value that arrived with nothing in it is a box being ASKED for, and
// markGaps() is about to say so in red. The carried marker used to speak over
// it: two notes on one label, describing the same empty box from two
// directions, under two different border colours.
test("an empty carried field wears the still-needed mark and nothing else", () => {
  const source = read("app.js");
  const start = source.indexOf("function markCarried(");
  const end = source.indexOf("function clearCarriedMarks(", start);
  assert.ok(start !== -1 && end > start, "markCarried has moved — re-point this test");
  const fn = source.slice(start, end);

  const guard = fn.indexOf("if (item.value === null || item.value === undefined) return;");
  const marks = fn.indexOf('classList.add("is-carried")');
  assert.ok(guard !== -1, "markCarried must return early for a value the server could not supply");
  assert.ok(guard < marks, "the early return must come BEFORE the carried styling, or the box wears both marks");

  // What it says instead is where the value came from — the one thing the box
  // itself cannot show, and the reason these fields are editable rather than
  // locked.
  assert.ok(/item\.authority === "record"/.test(fn), "the mark must distinguish a record value from a read one");
});
