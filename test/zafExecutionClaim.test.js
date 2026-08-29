// ---------------------------------------------------------------------------
// zafExecutionClaim.test.js  —  the sidebar may never claim a use case has no
// execution path when it has one
// ---------------------------------------------------------------------------
// WHAT THIS PINS, AND WHY IT NEEDED A NEW FILE
//
// The ZAF sidebar rendered this, in a red rail at the very top of a
// Schengen-to-Schengen workation (DE→PT):
//
//     🔴 High risk — no execution path exists — this can only be escalated
//
// and, at the bottom of the same screen, a working Approve button. The case was
// `ready_for_approval`, `actionable: true`, and carried exactly one advisory
// flag. UC-04 is a 🟡 use case: a named human approving in ZAF IS its execution
// path (CLAUDE.md §3 prime directive 2). The sentence in that rail is the 🔴
// tier's architectural guarantee — the one UC-07 and UC-08 enforce
// structurally — and printing it above a functioning control is the class of
// overstatement CLAUDE.md §1 calls fatal.
//
// The cause was one word carrying two meanings: the API sent the ESCALATED case
// risk (`classifyRisk()` raises any flagged case) under the key `tier`, and the
// sidebar's copy was written for the use case's own architectural tier. See
// src/shared/riskEngine.js's header.
//
// BOTH DIRECTIONS, IN THE SAME FILE, DELIBERATELY. This repo's most expensive
// recurring defect is that a control which cannot succeed looks identical to
// one refusing correctly, and only a positive test separates them. Suppressing
// the 🔴 sentence everywhere would pass a negative test and destroy the one
// claim UC-07/UC-08 exist to make. So: a 🟡 actionable case must NOT render it,
// and a real 🔴 case MUST — and must still render no controls at all.
//
// THESE RENDER. They do not read the source for a phrase; they boot the actual
// zaf-app/assets/main.js in a vm against a fake DOM, serve it the responses the
// REAL server handlers produce for real seeded cases, and then read the words
// that ended up on the screen. `npm test` never imports a browser asset, which
// is exactly how a rail nothing asserted came to ship a false claim — the whole
// point is to be able to ask "what does the screen say?" in a test.
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { startMockServer } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { AuthorizationStore } from "../src/uc04/authorizationStore.js";
import { handleWorkationRequest } from "../src/uc04/workflow.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { createUc04Handler } from "../src/uc04/server.js";
import { DossierStore } from "../src/uc08/dossierStore.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftNarrative } from "../src/uc08/dossierBuilder.js";
import { createUc08Handler } from "../src/uc08/server.js";
import { AdjustmentStore } from "../src/uc09/adjustmentStore.js";
import { handleAdjustmentRequest } from "../src/uc09/workflow.js";
import { createUc09Handler } from "../src/uc09/server.js";

const MAIN = new URL("../zaf-app/assets/main.js", import.meta.url);
const PANELS = new URL("../zaf-app/assets/panels.js", import.meta.url);
// The generated country map and the one file that reads it, in iframe.html's
// order. This harness predates them; without them the shell falls back to
// printing codes, so every assertion below would be made against a page the
// live bundle does not produce.
const COUNTRY_NAMES = new URL("../zaf-app/assets/countryNames.js", import.meta.url);
const COUNTRY = new URL("../zaf-app/assets/country.js", import.meta.url);

// The three LLM seams, faked the way every other test in this suite fakes them
// (invariant 10): a genuine but unreachable OPENAI_API_KEY in a devcontainer
// turns an un-injected call into a real, slow, failing network request.
const fakeDraftSummary = (args) => draftSummary(args, { isConfigured: () => false });
const fakeDraftNarrative = (args) => draftNarrative(args, { isConfigured: () => false });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// ---------------------------------------------------------------------------
// A FAKE DOM, ONLY AS BIG AS main.js ACTUALLY USES
// ---------------------------------------------------------------------------
// Deliberately not a DOM library: the assertions below are about words and
// about whether a <button> exists, and a dependency would put a third party
// between the test and the screen it is describing.

function createNode(tagName) {
  return {
    tagName: String(tagName).toLowerCase(),
    className: "",
    textContent: "",
    childNodes: [],
    attributes: {},
    get firstChild() {
      return this.childNodes[0] || null;
    },
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener() {},
  };
}

/** Every word on the screen, in document order — text nodes are set via textContent. */
function textOf(node) {
  const own = node.textContent ? String(node.textContent) : "";
  const kids = node.childNodes.map(textOf).join(" ");
  return (own + " " + kids).replace(/\s+/g, " ").trim();
}

/**
 * The value rendered beside a <dt> label — i.e. what one row of the case card
 * actually says. Asserting on the whole page's text cannot tell the summary
 * card apart from the basis panel below it, and on the money path those two
 * disagreeing by 100× is the entire defect.
 */
function rowValue(node, label) {
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child.tagName === "dt" && String(child.textContent).trim() === label) {
      const value = node.childNodes[i + 1];
      return value ? String(value.textContent).trim() : null;
    }
    const found = rowValue(child, label);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

function collect(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  node.childNodes.forEach((child) => collect(child, predicate, found));
  return found;
}

/**
 * Boot the real sidebar against the real handlers and return what it rendered.
 *
 * `routes` maps a base URL onto a handler, so the fetch below reaches the same
 * createUc04Handler()/createUc08Handler() an operator's browser would — which
 * is what makes this a test of the API's meaning and the shell's rendering
 * TOGETHER. The seam between them is precisely where the defect lived.
 */
async function renderSidebar({ settings, routes, ticketId }) {
  const root = createNode("div");
  const document = {
    getElementById: (id) => (id === "root" ? root : null),
    createElement: createNode,
    body: { scrollHeight: 800 },
  };

  const context = {
    window: {},
    document,
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Promise,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Date,
    Math,
    RegExp,
    encodeURIComponent,
    isNaN,
    parseInt,
    parseFloat,
    Error,
    fetch: async (url, init) => {
      const base = Object.keys(routes).find((prefix) => String(url).indexOf(prefix) === 0);
      if (!base) return { status: 404, ok: false, json: async () => ({ found: false }) };
      const res = await callHandler(routes[base], {
        method: (init && init.method) || "GET",
        path: String(url).slice(base.length),
      });
      return { status: res.status, ok: res.status >= 200 && res.status < 300, json: async () => res.body };
    },
  };
  context.window.document = document;
  context.window.ZAFClient = {
    init: () => ({
      metadata: async () => ({ settings }),
      get: async () => ({
        "ticket.id": ticketId,
        "currentUser.email": "specialist@example.com",
        "currentUser.name": "A Specialist",
        "currentUser.id": 7,
      }),
      invoke: () => {},
    }),
  };
  vm.createContext(context);
  // panels.js first — main.js calls window.CXPanelFor() during render.
  new vm.Script(readFileSync(COUNTRY_NAMES, "utf8"), { filename: "countryNames.js" }).runInContext(context);
  new vm.Script(readFileSync(COUNTRY, "utf8"), { filename: "country.js" }).runInContext(context);
  new vm.Script(readFileSync(PANELS, "utf8"), { filename: "panels.js" }).runInContext(context);
  new vm.Script(readFileSync(MAIN, "utf8"), { filename: "main.js" }).runInContext(context);

  /* Let the boot chain settle: metadata → get → nine parallel loads → render.
     THIS WAS A FIXED 60-TICK LOOP, and that was the bug (rca-hwr). A fixed
     count of setImmediate cycles is a guess at how long the fetch/JSON round
     trips inside load() take — right most of the time on a quiet machine,
     wrong under load, where the assertions below then ran against
     renderLoading()'s placeholder ("Loading this ticket's case…") instead of
     the resolved case. main.js already has an unambiguous completion signal:
     render() and finish()'s error/no-case branches both clear `root` and
     rebuild it in one synchronous pass, and only render() ever removes
     `aria-busy` (renderLoading() is the only place that sets it) — so
     "root has content AND aria-busy is gone" cannot be observed mid-render
     from outside (the rebuild has no `await` in it), and is true if and only
     if load() has reached a terminal state. Poll for that instead of hoping a
     tick count was enough. */
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (root.childNodes.length > 0 && !("aria-busy" in root.attributes)) break;
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { root, text: textOf(root), buttons: collect(root, (n) => n.tagName === "button") };
}

/** The request/response double every server test in this repo uses. */
function callHandler(handler, { method, path, body = null }) {
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
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const THE_CLAIM = /no execution path exists/i;

let mock;
let remote;
before(async () => {
  mock = await startMockServer(0);
  remote = new RemoteClient({ baseUrl: "http://localhost:" + mock.address().port });
});
after(() => mock && mock.close());

/** The exact case in docs/screenshots/uc04-suppressed-schengen.png. */
async function seedUc04Workation() {
  const audit = new AuditLogger();
  const authorizationStore = new AuthorizationStore();
  const result = await handleWorkationRequest(
    {
      employmentId: "emp_active_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_jane" },
      factors: {
        homeCountry: "DE",
        nationality: "DE",
        destination: { country: "PT" },
        startDate: "2026-09-01",
        endDate: "2026-09-21",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
      },
      now: "2026-08-19",
      externalRef: "21",
    },
    { remote, audit, authorizationStore, draftSummary: fakeDraftSummary, judge: fakeJudge }
  );
  return { result, handler: createUc04Handler({ authorizationStore, audit, remote }) };
}

async function seedUc08Dossier() {
  const audit = new AuditLogger();
  const dossierStore = new DossierStore();
  await handleTaxInquiry(
    {
      inquiry: {
        employmentId: "emp_active_001",
        homeCountry: "NL",
        hostCountry: "PT",
        presencePeriods: [{ country: "PT", from: "2026-01-01", to: "2026-06-30" }],
        question: "Do I owe tax in Portugal?",
      },
      externalRef: "31",
    },
    { audit, dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  return { handler: createUc08Handler({ dossierStore }) };
}

/** Seed 9004 from `npm run uc09-api`: a €3,000 German bonus that needs a THIRD
 *  signature purely because DE sits on an invented three-country list. */
async function seedUc09Adjustment() {
  const audit = new AuditLogger();
  const adjustmentStore = new AdjustmentStore();
  const result = await handleAdjustmentRequest(
    {
      externalRef: "9004",
      employmentId: "emp_de_001",
      session: { companyId: "co_amend_01", authenticatedAdminId: "admin_mike" },
      adjustmentRequest: {
        type: "bonus",
        amount: 300000,
        currency: "EUR",
        amountTaxType: "gross",
        description: "Quarterly spot bonus for Lena Müller",
      },
      reasonText: "Quarterly spot bonus",
      now: "2026-06-20",
    },
    { remote, audit, adjustmentStore, judge: fakeJudge }
  );
  return { result, handler: createUc09Handler({ adjustmentStore, audit, remote }) };
}

// ---------------------------------------------------------------------------

test("🟡 UC-04: an actionable workation never claims there is no execution path", async () => {
  const { result, handler } = await seedUc04Workation();

  // THE PRECONDITION IS HALF THE TEST. If this case were not actionable, the
  // absence of the claim below would prove nothing — a screen with no controls
  // is entitled to say a great deal more. This is the exact shape from the
  // screenshot: approvable, and escalated to `high` case risk by one flag.
  assert.equal(result.decision, "ready_for_approval");
  assert.deepEqual(result.flags, ["a1_certificate_recommended"]);

  const api = await callHandler(handler, { method: "GET", path: "/api/authorizations/by-ticket/21" });
  assert.equal(api.body.actionable, true, "the fixture stopped being approvable");
  assert.equal(api.body.useCaseTier, "medium", "UC-04's architectural tier is 🟡 and cannot be escalated");
  assert.equal(api.body.executionModel, "single_approval");
  assert.equal(api.body.caseRisk, "high", "one flag still escalates THIS REQUEST — that fact is not being hidden");

  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc04ApiBaseUrl: "http://uc04.test" },
    routes: { "http://uc04.test": handler },
    ticketId: "21",
  });

  // The defect, asserted directly. This fails on the pre-fix sidebar.
  assert.doesNotMatch(
    screen.text,
    THE_CLAIM,
    "the sidebar claimed a 🟡 use case has no execution path — while rendering its Approve button"
  );

  // And the control it would have been contradicting is really there.
  const approve = screen.buttons.filter((b) => /approve/i.test(b.textContent));
  assert.equal(approve.length, 1, "the approve control is missing — the contradiction test proves nothing without it");

  /* BOTH FACTS STILL REACH THE SPECIALIST, each in its own sentence. Neither is
     suppressed to resolve the contradiction; they were never in conflict, only
     conflated.

     WHERE THEY REACH THEM MOVED, TWICE. The tier's NAME used to be a headline
     directly above "This request: high risk" (2026-08-19 fix) and a reader
     took the two as rival verdicts on the same thing. It was then moved,
     unchanged, into the case record below the controls — which a round-6
     specialist STILL read as a second, competing risk statement alongside the
     tier glyph's colour (rca-iih7 / D-31). It is gone outright now, not moved
     again: the baseline is named exactly once, inside the request's own risk
     sentence below (`this use case's medium baseline`), asserted directly. */
  assert.doesNotMatch(screen.text, /Classified as a /, "the tier's name still repeats the risk sentence's own baseline");
  assert.match(screen.text, /Nothing in this use case is written until a named human approves it/);
  assert.match(screen.text, /This request: high risk/);
  assert.match(screen.text, /raised above this use case's medium baseline by 1 flag raised on this request/);
});

test("🔴 UC-08: a dossier still makes the guarantee, and still offers nothing to click", async () => {
  // The positive direction. A fix that merely deleted the sentence would pass
  // the test above and quietly destroy the only claim UC-07/UC-08 exist to
  // make — the 🔴 tier's whole value is that the guarantee is stated where it
  // is true, structurally (no write dep, no POST route, no branch) and on
  // screen.
  const { handler } = await seedUc08Dossier();

  const api = await callHandler(handler, { method: "GET", path: "/api/dossiers/by-ticket/31" });
  assert.equal(api.body.found, true);
  assert.equal(api.body.useCaseTier, "high");
  assert.equal(api.body.executionModel, "none");
  assert.equal(api.body.actionable, false);

  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc08ApiBaseUrl: "http://uc08.test" },
    routes: { "http://uc08.test": handler },
    ticketId: "31",
  });

  // rca-iih7 / D-31: "Classified as a high-risk use case" is gone; the
  // baseline is named inside the request's own risk sentence instead.
  assert.doesNotMatch(screen.text, /Classified as a /);
  assert.match(screen.text, /this use case's (own )?high baseline/, "the tier's baseline must still reach the specialist somewhere");
  assert.match(screen.text, THE_CLAIM, "the 🔴 guarantee stopped being stated where it is actually true");
  assert.match(screen.text, /can only be escalated/);
  assert.equal(screen.buttons.length, 0, "a 🔴 dossier rendered a control");
});

test("the guarantee is reachable only from a use case whose API says its execution model is `none`", async () => {
  // THE MECHANISM, not just the two outcomes. The sentence is keyed to
  // `executionModel`, a property of the USE CASE that no request can change —
  // never to a risk level, which is what made it derivable from a bad day.
  //
  // UC-09 is why it cannot go back to being derived: it is 🔴-framed and it
  // DOES have an execution path, behind a floor-of-2 multi-role approval. Any
  // rule of the form "high ⇒ no execution path" is false for a third of the
  // high tier.
  const main = readFileSync(MAIN, "utf8");

  const table = objectLiteral(main, "EXECUTION_MODELS");
  const carriers = Object.keys(table).filter((key) => new RegExp(THE_CLAIM.source, "i").test(table[key]));
  assert.deepEqual(carriers, ["none"], "the 🔴 guarantee is spelled under an execution model that is not `none`");

  // Every other model promises an execution path of some kind, so none of them
  // can be mistaken for the guarantee.
  for (const key of Object.keys(table)) {
    if (key === "none") continue;
    assert.doesNotMatch(table[key], /no execution path/i, key + " reads as the 🔴 guarantee");
  }

  // The rail takes the tier from `useCaseTier` and the sentence from
  // `executionModel`, and reads the legacy `tier` for neither.
  // The rail takes the tier from `useCaseTier` and the sentence from
  // `executionModel`, and reads the legacy `tier` for neither. It now also
  // carries the request's own risk line, which is the one verdict that belongs
  // beside the glyph — see renderTierRail's header.
  assert.match(main, /function renderTierRail\(useCaseTier, executionModel, riskLine\)/);
  assert.match(main, /var means = EXECUTION_MODELS\[executionModel\];\n\s*if \(means\) body\.appendChild/);
  assert.match(
    main,
    /if \(view\.useCaseTier\) header\.appendChild\(renderTierRail\(view\.useCaseTier, view\.executionModel, renderCaseRisk\(view\)\)\);/
  );

  // An unknown or absent model prints NOTHING rather than falling through to a
  // claim — the safe direction for a sentence that promises what may happen.
  const rail = main.slice(main.indexOf("function renderTierRail("), main.indexOf("function renderCaseRisk("));
  assert.ok(!/tier ===|useCaseTier ===|"high"/.test(rail), "the rail branches on a risk level again");

  // And the shell still decides nothing about what is allowed: `actionable` is
  // never consulted here, and no server-side gate is re-derived.
  assert.ok(!/actionable/.test(rail), "the rail reaches for actionable — controls are gated server-side, in one place");
});

/**
 * Evaluate a top-level `var NAME = { ... };` literal out of a browser asset, so
 * a lookup table is asserted as DATA and not as text. Same helper as
 * test/zafApp.test.js's; duplicated rather than exported because these two
 * files are read independently and a shared import would hide the coupling.
 */
function objectLiteral(source, name) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const start = code.indexOf("var " + name + " = {");
  assert.ok(start !== -1, name + " is missing from the asset");
  const open = code.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return vm.runInNewContext("(" + code.slice(open, i + 1) + ")");
}

test("🔴 UC-09 is high-tier AND has an execution path — the third case, and the trap", () => {
  // Neither of the two tests above would catch a fix that keyed the guarantee
  // to the tier instead of the execution model: 🟡 UC-04 would be quiet and 🔴
  // UC-08 would speak, both correctly, and UC-09 — 🔴-framed, with a real
  // execution path behind a floor-of-2 multi-role approval — would print "no
  // execution path exists" over three sets of Approve/Deny controls that
  // release actual money. This is the assertion that makes the rule "the model,
  // never the level" testable rather than merely stated.
  //
  // Kept as its own test because it is about the RULE, not about UC-09: any
  // future use case that is high-tier and executable inherits it for free.
  const main = readFileSync(MAIN, "utf8");
  const models = objectLiteral(main, "EXECUTION_MODELS");
  assert.ok(models.multi_role_approval, "UC-09's execution model has no wording at all");
  assert.doesNotMatch(models.multi_role_approval, THE_CLAIM);
  assert.match(models.multi_role_approval, /approve/i, "the money path's rail says nothing about who must sign");
});

test("🔴 UC-09: the money path states its tier, its risk and its controls without contradiction", async () => {
  const { result, handler } = await seedUc09Adjustment();
  assert.equal(result.decision, "triple_approval_required");

  const api = await callHandler(handler, { method: "GET", path: "/api/adjustments/by-ticket/9004" });
  assert.equal(api.body.useCaseTier, "high");
  assert.equal(api.body.executionModel, "multi_role_approval", "UC-09 has an execution path and must say so");
  assert.equal(api.body.actionable, true);

  const screen = await renderSidebar({
    settings: { apiBaseUrl: "", uc09ApiBaseUrl: "http://uc09.test" },
    routes: { "http://uc09.test": handler },
    ticketId: "9004",
  });

  assert.doesNotMatch(
    screen.text,
    THE_CLAIM,
    "the money path claimed it has no execution path — above the controls that release the payment"
  );
  // rca-iih7 / D-31: "Classified as a high-risk use case" is gone; the
  // baseline is named inside the request's own risk sentence instead.
  assert.doesNotMatch(screen.text, /Classified as a /);
  assert.match(screen.text, /this use case's (own )?high baseline/, "the tier's baseline must still reach the specialist somewhere");
  // The subject of the sentence is now the USE CASE, named — it used to read
  // "at least two named humans ... must approve before any money moves", which
  // is true of the use case and was read as a promise about the request.
  assert.match(screen.text, /No money moves in this use case until at least two named humans in separate roles approve/);
  // A 🔴 use case cannot be escalated ABOVE high — the line has to say what the
  // flags did without claiming a rise that did not happen.
  assert.match(screen.text, /This request: high risk/);
  assert.doesNotMatch(screen.text, /raised above this use case's high baseline/);
  assert.match(screen.text, /already the top of the scale/);
  assert.ok(screen.buttons.length >= 3, "the three signature controls are missing");

  // THE ×100 SCALE, ON THE CARD AND IN THE BASIS, AGREEING. The summary card
  // printed the raw Remote integer, so €3,000.00 read "300000 EUR" directly
  // above these controls while the basis below said 3,000.00 — two figures for
  // one payment, differing by 100, the larger one first.
  assert.equal(rowValue(screen.root, "Amount"), "3,000.00 EUR", "the payment card is not at human scale");

  // And the basis panel reaches this screen at all — loadUc09 was the one
  // loader of nine dropping `basis`, so the money path was the only approval
  // screen with no account of what the signature turns on. Its heading is now
  // "What needs weighing", which is the question a signature answers.
  assert.match(screen.text, /What needs weighing/i);
  assert.match(screen.text, /UNSOURCED BASIS/i);

  /* AND THE SIGNATURE COUNT IS SAID ONCE (2026-08-20). `approval_floor`'s
     evidence table published four rows — "Signatures required", "Distinct
     people recorded", "Already signed", "Still outstanding" — every one of
     which the Decision card restates a few inches lower with more in it: the
     meter draws the count as filled and empty slots, and the capacity card
     names each role, what it decides and whether its slot is outstanding.
     Counting to three four times on a payment screen is what the project owner
     read as the panel repeating itself.

     THE DIMENSION ITSELF IS ASSERTED PRESENT, because suppressing the ROWS and
     suppressing the FINDING are different acts and only one of them is safe:
     its sentence carries the two guarantees nothing else on this page states. */
  assert.match(screen.text, /The floor is 2 and risk can only ever raise it/);
  assert.match(screen.text, /0 of 3 approvals recorded/, "the meter is the surviving statement of the count and it is gone");
  assert.match(screen.text, /Still to sign: Requester, Approver, Payment Releaser/);
  for (const gone of ["Signatures required", "Distinct people recorded", "Already signed", "Still outstanding"]) {
    assert.equal(
      rowValue(screen.root, gone),
      null,
      `the "${gone}" evidence row is back — the Decision card already says it, and says who`
    );
  }
});
