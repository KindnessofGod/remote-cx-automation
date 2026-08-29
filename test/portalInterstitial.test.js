// ---------------------------------------------------------------------------
// portalInterstitial.test.js  —  which results interrupt, and which must not
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// The project owner, on UC-03's letter offer sitting at the bottom of a long
// result: "I should not have to scroll up to see this, it should be a popup,
// plus redirect if need be, across all the use cases." And then, on the modal
// that answered it: "I want the answer for everything to always be in the pop
// up, and then in this case a recommendation, starting with something like 'Do
// you need a formal letter for your trip?'"
//
// THE RULE THOSE TWO INSTRUCTIONS ADD UP TO, and the correction the second one
// makes to the first. fef494b wrote the first predicate down: a result earns a
// modal when it OFFERS the reader a next action they would otherwise have to
// scroll to find — and on that reading one use case of seven earned one. The
// reasoning was that an interruption carrying nothing actionable trains people
// to dismiss without reading, and the next thing they dismiss unread is the 🔴
// disclaimer.
//
// That reasoning survives. Its PREMISE does not: AN ANSWER IS NOT NOTHING. It
// is the one thing the requester came for, and it was the thing they had to
// scroll to. So the rule is now:
//
//   THE MODAL CARRIES THE ANSWER, ALWAYS, AND THE RECOMMENDATION WHEN THERE IS
//   ONE. One modal per result, the answer leads it, the answer's heading names
//   it, and dismissing takes nothing away.
//
// WHAT THAT DID NOT CHANGE, and section 1 is still the half worth keeping: WHO
// GETS AN OFFER. Six of the seven request types have nothing to offer and still
// have nothing to offer — UC-02, UC-04, UC-05 and UC-09 are hand-offs by
// construction, and UC-07 and UC-08 are the 🔴 pair whose whole guarantee is
// that nothing can be approved anywhere, so a button there would be a lie.
// Their dialog carries their answer and a way out, and no action. Manufacturing
// five more offers so the pattern looked general would be the wrong reading of
// a correct instruction, and it would be the same wrong reading now as then.
//
// AND AN INTAKE REFUSAL STILL GETS NO DIALOG, which is the one exception and is
// argued rather than assumed — see presentResultDialog()'s header and the test
// in section 2. Its answer is equally below the fold and it is taken to instead
// of interrupted with, because a refused submission is a correction loop whose
// form is still on screen.
//
// EVERY LLM SEAM IS FAKED, the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom: this devcontainer
// carries a genuine but unreachable OPENAI_API_KEY, so a missed seam is a real,
// retried, slow network call (CLAUDE.md §6).
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
const REMOTE_PORT = 4118;

const unconfigured = { isConfigured: () => false };
const FAKE_LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

const TRIP_TEXT =
  "I am travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";
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
  const audit = new AuditLogger();
  const stores = freshStores();
  return createPortalHandler({ remote, audit, stores, llm: FAKE_LLM });
}

const post = (h, type, body) => callApi(h, { method: "POST", path: "/api/requests/" + type, body });

before(async () => {
  remoteServer = await startMockServer(REMOTE_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${REMOTE_PORT}` });
});

after(async () => {
  await new Promise((resolve) => remoteServer.close(resolve));
});

// ---------------------------------------------------------------------------
// The DOM this page's offer code needs, and no more of one than that
// ---------------------------------------------------------------------------
// Browser assets are never imported by `npm test` (CLAUDE.md §6), so the way to
// exercise them is to lift the functions into a `node:vm` context over a fake
// document — the same technique test/portalCountryPicker.test.js already uses
// for the country pickers, widened here to the handful of operations the
// interstitial performs: parent/child moves, one attribute selector, closest(),
// and a dialog whose close() dispatches "close" exactly as a browser's does.

function domSandbox() {
  const make = (tag) => ({
    tag,
    className: null,
    id: null,
    type: null,
    value: "",
    open: false,
    textContent: "",
    childNodes: [],
    parentNode: null,
    attrs: {},
    listeners: {},
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    },
    insertBefore(child, anchor) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      const at = anchor ? this.childNodes.indexOf(anchor) : -1;
      if (at === -1) this.childNodes.push(child);
      else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at !== -1) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    get nextSibling() {
      if (!this.parentNode) return null;
      const at = this.parentNode.childNodes.indexOf(this);
      return this.parentNode.childNodes[at + 1] || null;
    },
    matches(selector) {
      // Comma lists are supported because the dialog looks up its own title
      // with one — ".plain-answer-lead, .interstitial-title", the answer's
      // heading or the offer's, whichever leads. A sandbox that silently
      // matched neither would report a dialog with no accessible name and read
      // as a real defect.
      return String(selector)
        .split(",")
        .map((one) => one.trim())
        .filter(Boolean)
        .some((one) => {
          if (one.startsWith("[") && one.endsWith("]")) return this.getAttribute(one.slice(1, -1)) !== null;
          if (one.startsWith(".")) return String(this.className || "").split(/\s+/).includes(one.slice(1));
          return this.tag === one;
        });
    },
    querySelector(selector) {
      for (const child of this.childNodes) {
        if (child.matches && child.matches(selector)) return child;
        const deeper = child.querySelector ? child.querySelector(selector) : null;
        if (deeper) return deeper;
      }
      return null;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (node.matches && node.matches(selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    addEventListener(name, fn) {
      (this.listeners[name] = this.listeners[name] || []).push(fn);
    },
    dispatch(name) {
      (this.listeners[name] || []).forEach((fn) => fn());
    },
    // The two <dialog> methods, with the browser's own contract: close() fires
    // "close", and so does the Escape key — which is why the test presses
    // Escape by dispatching the same event.
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.dispatch("close");
    },
  });

  const document = {
    createElement: make,
    createTextNode: (text) => Object.assign(make("#text"), { textContent: String(text) }),
    body: make("body"),
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  return { document, el, make };
}

/** The whole offer/dialog region of app.js, plus the answer block, lifted into
 *  one context. plainAnswerBlock() lives at the other end of the file and is
 *  lifted separately rather than copied, for the reason every lift in this repo
 *  exists: a restated copy could never disagree with the original. */
function offerContext() {
  const app = read("app.js");
  const start = app.indexOf("  function offersOn(payload) {");
  const end = app.indexOf("  function acceptLetterOffer(");
  assert.ok(start !== -1 && end > start, "the offer region has moved — re-point this test");

  const answerStart = app.indexOf("  function plainAnswerBlock(payload) {");
  const answerEnd = app.indexOf("  function shortId(", answerStart);
  assert.ok(answerStart !== -1 && answerEnd > answerStart, "plainAnswerBlock() has moved — re-point this test");

  const { document, el, make } = domSandbox();
  const context = { document, el };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  vm.runInContext(app.slice(answerStart, answerEnd), context);
  return { context, document, make };
}

/**
 * render()'s own sequence for the answer and the offers, run over one payload.
 *
 * It mirrors the four lines in render() rather than calling it: render() also
 * builds a head, a reference line, a gate ladder and a facts table, none of
 * which this file is about. The order — answer, then promoted offer, then any
 * unpromoted offer, then the dialog over the first two — is the order render()
 * appends them in, and test/portalUc03Continuation.test.js pins that separately
 * by reading render()'s own source.
 */
function renderOffers(payload) {
  const { context, document, make } = offerContext();
  const wrap = make("div");
  context.PAYLOAD = payload;
  context.WRAP = wrap;
  vm.runInContext(
    `
    var answerBlock = plainAnswerBlock(PAYLOAD);
    if (answerBlock) WRAP.appendChild(answerBlock);
    var offers = offersOn(PAYLOAD);
    var promoted = offers.length ? promoteToInterstitial(offers[0]) : null;
    if (promoted) WRAP.appendChild(promoted);
    offers.slice(1).forEach(function (extra) { WRAP.appendChild(extra); });
    presentResultDialog([answerBlock, promoted]);
  `,
    context
  );
  return { context, document, wrap, offers: context.offers, promoted: context.promoted };
}

/**
 * The CONTENT blocks of a dialog's panel, with the dialog's own chrome left
 * out. The panel's first child is now the close control that presentResultDialog()
 * always adds — furniture, carrying no sentence — so "what is IN the dialog"
 * means these and not every child node. See that function for why the control
 * moved to the top of the panel.
 */
const dialogBlocks = (panel) => panel.childNodes.filter((node) => node.getAttribute("data-dialog-close") === null);

const textOf = (node) =>
  node.textContent + (node.childNodes || []).map(textOf).join("");

// ---------------------------------------------------------------------------
// 1. WHICH RESULTS OFFER SOMETHING — driven, all seven request types
// ---------------------------------------------------------------------------

test("only UC-03 answers carry an offer, and it carries exactly two", async () => {
  const handler = buildPortal();

  const routing = await post(handler, "uc03", { persona: "chris", text: WORKATION_TEXT, externalRef: "int-route-1" });
  assert.equal(routing.body.decision, "route_to_uc04");
  assert.equal(routing.body.continuation.available, true, "a routing must offer the continuation");
  assert.equal(routing.body.letterOffer, null, "a routing must not also offer a letter");

  const answer = await post(handler, "uc03", { persona: "chris", text: TRIP_TEXT, externalRef: "int-letter-1" });
  assert.equal(answer.body.decision, "auto_resolve");
  assert.equal(answer.body.letterOffer.offered, true, "an auto-resolved answer must offer the letter");
  assert.equal(answer.body.continuation.available, false, "an answer that routed nowhere has nothing to continue");

  // THE TWO ARE MUTUALLY EXCLUSIVE ON THE WIRE, which is why "one modal per
  // result" is not a limit anybody has to live with in practice — and why
  // section 3's both-at-once payload is a constructed one.
});

test("the other six request types offer nothing, and the two 🔴 ones must never", async () => {
  const handler = buildPortal();

  // Each of these is a real, accepted submission. The claim is not that they
  // fail — it is that a SUCCESSFUL result on these six carries no offer field
  // at all, so no BUTTON can appear on them however offersOn() grows. Their
  // dialog is the answer and a way out, which the test below this one pins.
  const submissions = [
    ["uc02", { persona: "chris", expenseId: "exp_taxi_lisbon", externalRef: "int-uc02" }],
    [
      "uc04",
      {
        persona: "admin",
        employmentId: "09b65526-643b-4956-959b-916e6429bd23",
        homeCountry: "DE",
        nationality: "DE",
        destinationCountry: "ES",
        startDate: "2026-09-01",
        endDate: "2026-09-14",
        visaType: "schengen_short_stay",
        jobDuties: "engineering",
        hasContractSigningAuthority: false,
        reasonText: "A fortnight in Madrid.",
        externalRef: "int-uc04",
      },
    ],
    ["uc05", { persona: "chris", proposedEndDate: "2026-10-31", reason: "resignation", currency: "EUR", externalRef: "int-uc05" }],
    ["uc07", { persona: "chris", text: "I want to move permanently from Portugal to Canada next year.", externalRef: "int-uc07" }],
    ["uc08", { persona: "chris", text: "Where am I tax resident if I split the year between Portugal and Spain?", externalRef: "int-uc08" }],
    [
      "uc09",
      {
        persona: "admin",
        employmentId: "09b65526-643b-4956-959b-916e6429bd23",
        requestText: "Pay a 500 EUR referral bonus off-cycle.",
        externalRef: "int-uc09",
      },
    ],
  ];

  for (const [type, body] of submissions) {
    const res = await post(handler, type, body);
    assert.equal(res.body.ok, true, `${type} did not submit: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.letterOffer ?? null, null, `${type} carries a letter offer`);
    assert.equal(res.body.continuation ?? null, null, `${type} carries a continuation offer`);

    // And the page agrees: nothing on this payload is promotable, so the dialog
    // it opens holds exactly one block — the answer — and no action at all.
    const { wrap, document } = renderOffers(res.body);
    assert.equal(wrap.childNodes.length, 0, `${type} left a block in the panel while the dialog is open`);
    const dialog = document.body.childNodes[0];
    assert.ok(dialog, `${type} opened no dialog — every decided result answers in one`);
    const panel = dialog.childNodes[0];
    assert.equal(dialogBlocks(panel).length, 1, `${type} put something beside the answer in the dialog`);
    assert.ok(dialogBlocks(panel)[0].matches(".plain-answer"), `${type}'s dialog does not lead with the answer`);
    assert.equal(
      panel.querySelector(".continuation-offer"),
      null,
      `${type} rendered an offer and must not — nobody can act on one there`
    );
  }
});

// ---------------------------------------------------------------------------
// 1b. THE ANSWER IS IN THE DIALOG, AND IT NAMES IT
// ---------------------------------------------------------------------------
// The inversion, pinned on the one result that carries both halves. Before
// this, the dialog opened with "A formal travel letter for this trip" — a
// feature label, asserting that the letter exists — while the answer to the
// question the traveller actually asked sat on the page behind it.

test("a UC-03 answer opens with the answer, and the recommendation is under it", async () => {
  const handler = buildPortal();
  const answer = await post(handler, "uc03", { persona: "chris", text: TRIP_TEXT, externalRef: "int-invert-1" });
  assert.equal(answer.body.decision, "auto_resolve");

  const { document } = renderOffers(answer.body);
  const dialog = document.body.childNodes[0];
  assert.equal(dialog.tag, "dialog");
  assert.equal(dialog.open, true);

  const panel = dialog.childNodes[0];
  assert.equal(panel.className, "interstitial-panel");
  assert.equal(dialogBlocks(panel).length, 2, "the dialog carries the answer and the recommendation, in that order");

  // THE ANSWER FIRST, and it is the server's own sentence — this page holds no
  // wording of its own for it (test/portalPlainAnswer.test.js §8).
  const [answerBlock, offerBlock] = dialogBlocks(panel);
  assert.ok(answerBlock.matches(".plain-answer"), "the dialog does not lead with the answer");
  assert.ok(textOf(answerBlock).includes(answer.body.plainAnswer.lead), "the answer in the dialog is not the server's");

  // THE RECOMMENDATION SECOND, AND IT IS A QUESTION TO THE READER. "A formal
  // travel letter for this trip" told them the feature exists; this asks them
  // the thing they actually have to decide.
  assert.ok(offerBlock.matches(".continuation-offer"), "the recommendation is not under the answer");
  const heading = offerBlock.querySelector(".interstitial-title");
  assert.equal(heading.tag, "h4", "the recommendation must be subordinate to the answer's heading");
  assert.match(heading.textContent, /^Do you need\b.*\?$/, `the recommendation heading is not a question: ${heading.textContent}`);

  // THE DIALOG IS NAMED BY THE ANSWER, not by the offer. This is the whole of
  // the accessibility change: a dialog is named by what it is about.
  const answerHeading = answerBlock.querySelector(".plain-answer-lead");
  assert.equal(answerHeading.tag, "h3");
  assert.equal(dialog.getAttribute("aria-labelledby"), answerHeading.id);
  assert.notEqual(answerHeading.id, heading.id ?? null);

  // AND THE ANSWER IS NOT SAID TWICE. Rule 3 of src/portal/plainAnswer.js, now
  // applied at closer range: inside one dialog, a recommendation that restated
  // the answer above it would be the same defect with a spotlight on it.
  assert.ok(
    !textOf(offerBlock).includes(answer.body.plainAnswer.lead),
    "the recommendation restates the answer directly above it"
  );
});

test("a result with nothing to offer still gets a way out of its own dialog", async () => {
  // A dialog with no way out is a trap — and the project owner reported this
  // one as exactly that ("I also noticed your popup had no way to exit it")
  // while this test was passing, which is why the assertion changed with the
  // code. There WAS a control; it was appended after the last block, at the
  // bottom of a panel that is capped at `calc(100vh - 48px)` and scrolls, so
  // under a tall recommendation the only exit was below the fold of the modal.
  //
  // It is now the panel's own chrome, first child, on every dialog this page
  // opens, carrying `data-dialog-close` to tell it apart from an offer's "Not
  // now" — which declines the OFFER and happens also to close the dialog. The
  // reasoning that put it in the presenter rather than in plainAnswerBlock()
  // is unchanged: a "Close" button on a panel with no dialog to close is a
  // control that does nothing.
  const handler = buildPortal();
  const res = await post(handler, "uc05", {
    persona: "chris",
    proposedEndDate: "2026-10-31",
    reason: "resignation",
    currency: "EUR",
    externalRef: "int-wayout-1",
  });
  assert.equal(res.body.ok, true);

  const { wrap, document } = renderOffers(res.body);
  const dialog = document.body.childNodes[0];
  const dismiss = dialog.querySelector("[data-dialog-close]");
  assert.ok(dismiss, "a dialog with no way out is a trap");
  assert.equal(dismiss.textContent, "Close");
  assert.equal(dismiss.getAttribute("aria-label"), "Close");
  assert.equal(dialog.childNodes[0].childNodes[0], dismiss, "the way out must not be below the panel's own scroll fold");

  dismiss.listeners.click[0]();

  // BACK ON THE PAGE, WITH THE ANSWER INTACT AND THE SPENT CONTROL GONE.
  assert.equal(document.body.childNodes.length, 0, "the dialog must be removed from the document");
  assert.equal(wrap.childNodes.length, 1, "dismissing must put the answer back on the page, not delete it");
  assert.ok(textOf(wrap.childNodes[0]).includes(res.body.plainAnswer.lead));
  assert.equal(wrap.childNodes[0].querySelector("[data-dialog-close]"), null, "the Close button must go with the dialog");
  assert.equal(wrap.childNodes[0].querySelector("[data-interstitial-dismiss]"), null, "no spent dismissal may be left on the page");
  assert.equal(
    wrap.childNodes[0].querySelector("[data-dialog-close-row]"),
    null,
    "the row that only ever held the Close button must go with it"
  );
});

// ---------------------------------------------------------------------------
// 2. A REFUSAL RENDERS NO MODAL — AND IS NOT LEFT WHERE IT FELL EITHER
// ---------------------------------------------------------------------------
// The one outcome that opens no dialog, and the reason is not "it has no
// answer" — its refusal reason IS its answer, one plain sentence, and it was
// measured just as far below the fold as every other result (1152px and 1482px
// against a 900px viewport, 2108px and 2781px against a 740px one). It is a
// CORRECTION LOOP: the form is still on screen with their answers in it and
// their next act is to fix it, so a modal in front of it would be dismissed on
// every attempt. render() scrolls it into view instead — reached without
// scrolling either way, at the loudness that matches what they have to do next.

test("a refusal offers nothing, so nothing interrupts", async () => {
  const handler = buildPortal();

  // A policy refusal from the server, not a constructed object: a UC-04
  // continuation whose prior-stay row is half filled in — the exact refusal the
  // project owner hit, and one that carries no offer of any kind.
  const refused = await post(handler, "uc04", {
    persona: "admin",
    employmentId: "09b65526-643b-4956-959b-916e6429bd23",
    homeCountry: "DE",
    nationality: "DE",
    destinationCountry: "ES",
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    travelHistory: [{ country: "ES", startDate: "", endDate: "" }],
    externalRef: "int-refused",
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "travel_history_unreadable");

  const { wrap, document } = renderOffers(refused.body);
  assert.equal(wrap.childNodes.length, 0, "a refusal must never render an interstitial");
  assert.equal(document.body.childNodes.length, 0, "a refusal must never open a dialog");
});

test("a refusal is taken to rather than interrupted with", () => {
  // Read out of render()'s own source, because the refusal branch returns
  // before any of the machinery this file's sandbox exercises. Two claims: the
  // panel is scrolled to, and the thing that scrolls it moves no focus — the
  // result container is already an aria-live region, so focusing it would
  // announce the refusal twice.
  const app = read("app.js");
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const refusalBranch = code.slice(code.indexOf('el("div", "result-box refused")'), code.indexOf('el("div", "result-head")', code.indexOf("bringIntoView(refusal)")));
  assert.match(refusalBranch, /bringIntoView\(refusal\);/, "a refusal is left wherever it falls on the page");
  assert.ok(!/showModal/.test(refusalBranch), "a refusal must never open a dialog");

  const scroller = code.slice(code.indexOf("function bringIntoView("), code.indexOf("function bringIntoView(") + 400);
  assert.match(scroller, /scrollIntoView/);
  assert.ok(!/\.focus\(\)/.test(scroller), "scrolling to a live region must not also move focus into it");
});

// ---------------------------------------------------------------------------
// 3. ONE MODAL PER RESULT — and the loser is still on the page
// ---------------------------------------------------------------------------

test("two candidate offers render two blocks and exactly one interruption", () => {
  // CONSTRUCTED ON PURPOSE. No UC-03 decision produces both (section 1 pins
  // that), so the only way to prove the rule holds is to hand the page the
  // impossible payload and watch what it does with it. Two stacked modals is a
  // dark pattern and the second is never read; a second offer silently dropped
  // is the very defect this whole change exists to fix, committed by the fix.
  // The rule is therefore: one interrupts, the rest stay on the page.
  const { wrap, document } = renderOffers({
    continuation: {
      available: true,
      caseId: "case-1",
      notice: { headline: "Working from another country needs authorization", sentence: "s", action: "Start", dismiss: "Not now" },
      stillNeeded: [{ label: "Nationality" }],
    },
    letterOffer: {
      offered: true,
      caseId: "case-1",
      accept: { method: "POST", path: "api/requests/uc03/request-letter" },
      produces: "A letter on the employing entity's letterhead.",
      label: "Request a formal travel letter for this trip",
      carries: { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-10-02" },
    },
  });

  // EXACTLY ONE DIALOG. Two stacked modals is the failure this rule exists to
  // prevent, and the second one is never read.
  assert.equal(document.body.childNodes.length, 1, "one dialog, or the second interruption is stacked behind the first");
  const dialog = document.body.childNodes[0];
  assert.equal(dialog.tag, "dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.childNodes.length, 1);

  // The ROUTING is the one that interrupts, and the priority is the order in
  // which a reader can act: a routing is a redirection nothing else about the
  // request can move past, where the letter is an extra on an answer that is
  // already complete.
  assert.match(textOf(dialog), /needs authorization/);
  assert.ok(!textOf(dialog).includes("letterhead"), "the unpromoted offer must not be inside the dialog");

  // AND THE OTHER OFFER IS ON THE PAGE THE WHOLE TIME — not queued behind the
  // dialog, not dropped. The promoted node is inside the dialog while it is
  // open, which is why the panel holds one block and not two right now.
  assert.equal(wrap.childNodes.length, 1, "the unpromoted offer must render in the panel, quieter but never gone");
  assert.match(textOf(wrap.childNodes[0]), /letterhead/);

  // ONE ID, ON THE ONE PROMOTED NODE. Two nodes carrying the dialog's
  // aria-labelledby target would be a duplicate id in the document and an
  // accessible name that resolves to whichever came first.
  const labelled = wrap.childNodes
    .concat(document.body.childNodes)
    .map((n) => n.querySelector(".interstitial-title"))
    .filter((h) => h && h.id);
  assert.equal(labelled.length, 1, "only the promoted offer may carry the id the dialog is labelled by");
  assert.equal(dialog.getAttribute("aria-labelledby"), labelled[0].id);

  // Dismissed, both are in the panel and the promoted one leads it.
  dialog.close();
  assert.equal(wrap.childNodes.length, 2, "dismissing must put the interruption back, above the offer it outranked");
  assert.match(textOf(wrap.childNodes[0]), /needs authorization/);
  assert.match(textOf(wrap.childNodes[1]), /letterhead/);
});

// ---------------------------------------------------------------------------
// 4. DISMISSING TAKES NOTHING AWAY — by both routes
// ---------------------------------------------------------------------------

const LETTER_PAYLOAD = {
  letterOffer: {
    offered: true,
    caseId: "case-9",
    accept: { method: "POST", path: "api/requests/uc03/request-letter" },
    produces: "A letter on the employing entity's letterhead confirming employment.",
    signoffNote: "Nothing is sent to you or to anyone else before that.",
    label: "Request a formal travel letter for this trip",
    carries: {
      destinationCountry: "ES",
      destinationName: "Spain",
      startDate: "2026-09-14",
      endDate: "2026-10-02",
      correction: "If any of these is wrong, send the correction as a new request.",
    },
  },
};

for (const [how, press] of [
  ["the dismiss button", (dialog) => dialog.querySelector("[data-interstitial-dismiss]").listeners.click[0]()],
  // Escape does not call our handler — it fires the browser's own "close" on
  // the dialog. Both paths therefore have to end in the same place, and this is
  // the assertion that they do.
  ["Escape", (dialog) => dialog.dispatch("close")],
]) {
  test(`the letter offer survives being dismissed with ${how}`, () => {
    const { wrap, document } = renderOffers(LETTER_PAYLOAD);
    const dialog = document.body.childNodes[0];
    assert.equal(dialog.open, true, "the letter offer must interrupt — it is an offer, not a hand-off");
    assert.equal(wrap.childNodes.length, 0, "while the dialog is open the node lives inside it");

    press(dialog);

    // BACK WHERE IT WAS, in the result, with every fact still on it.
    assert.equal(document.body.childNodes.length, 0, "the dialog must be removed from the document");
    assert.equal(wrap.childNodes.length, 1, "dismissing must put the offer back on the page, not delete it");
    const back = wrap.childNodes[0];
    const words = textOf(back);
    assert.match(words, /Do you need a formal letter for your trip\?/);
    assert.match(words, /letterhead/);
    // THE NAME, NOT THE PAIR. This line read `/Spain \(ES\)/`. The reader here
    // is a traveller checking, before they accept, that the letter is about
    // their trip — "Spain" is what they check it against, and "ES" is a code
    // this repository compares and audits. The code is still on the payload,
    // still on the audit row, and still printed when the server can name no
    // country for it; it is no longer shown to somebody who cannot use it.
    assert.match(words, /Destination — Spain/);
    assert.ok(!/\(ES\)/.test(words), `the raw country code is still on the traveller's offer: ${words}`);
    assert.match(words, /2026-09-14/);
    assert.match(words, /Nothing is sent to you/);

    // THE ACTION SURVIVES AND THE DISMISS DOES NOT. The button that takes the
    // offer is the whole reason for restoring the node; the button that closes
    // a modal has no modal left to close, and a control that does nothing reads
    // as broken rather than as finished.
    assert.ok(words.includes("Request a formal travel letter for this trip"), "the offer's own action must survive dismissal");
    assert.equal(back.querySelector("[data-interstitial-dismiss]"), null, "the dismiss button must go with the dialog");
  });
}

// ---------------------------------------------------------------------------
// 5. THE STRUCTURE THAT MAKES THE MODAL ALLOWED AT ALL
// ---------------------------------------------------------------------------

test("the interruption is a native <dialog>, or it is not a modal at all", () => {
  // A modal has to trap focus, be labelled, close on Escape, restore focus and
  // make the rest of the page inert. showModal() does all five in the engine;
  // a hand-rolled overlay does none, and the focus traps people write by hand
  // are subtly wrong. An inaccessible dialog is worse than the paragraph it
  // replaces — so the capability check, and the degradation to a plain in-page
  // interstitial when it is missing, are load-bearing rather than defensive.
  const code = read("app.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  assert.match(code, /el\("dialog", "interstitial-dialog"\)/);
  assert.match(code, /typeof document\.createElement\("dialog"\)\.showModal !== "function"\) return null;/);
  assert.match(code, /dialog\.showModal\(\);/);
  assert.ok(!/position:\s*fixed/.test(read("style.css").match(/\.interstitial-dialog\s*\{[^}]*\}/)?.[0] ?? ""), "the dialog must not be positioned by hand");

  // The offer blocks write with textContent and re-derive no policy — the same
  // two rules test/portal.test.js pins for the page as a whole, asserted again
  // here because this region grew a second builder.
  const app = read("app.js");
  const region = app.slice(app.indexOf("  function offersOn(payload) {"), app.indexOf("  function acceptLetterOffer("));
  assert.ok(!/innerHTML/.test(region), "the offer region must not use innerHTML");
  assert.ok(!/=== "(auto_resolve|route_to_uc04|escalate|blocked|ready_for_approval)"/.test(region), "the offer region must not compare a decision string");
});

test("a modal's body does not restate its own title", () => {
  // The editorial rule, applied where it is loudest. `offer.reason` — "Every
  // gate passed, so the same trip can be certified in a formal travel letter…"
  // — used to be the first line under the badge. It is now the heading, twice
  // over: once as the heading itself and once in `signoffNote`, which says the
  // same thing and adds the fact the sentence lacked. So the page prints
  // `produces` and `signoffNote` and drops `reason`.
  const app = read("app.js");
  const region = app.slice(app.indexOf("  function letterOffer(payload) {"), app.indexOf("  function acceptLetterOffer("));
  const code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  assert.ok(!/offer\.reason/.test(code), "the letter offer is printing its heading back at the reader again");
  assert.match(code, /offer\.produces/, "what the letter IS must still be printed — that is a fact, not scaffolding");
  assert.match(code, /offer\.signoffNote/, "what happens after accepting must still be printed");
  assert.match(code, /offer\.label/, "the button must still say what the server says accepting does");

  // And the same rule one file over, on the continuation's own notice.
  const notice = readFileSync(join(__dirname, "..", "src", "portal", "uc03Continuation.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert.ok(
    !notice.includes("This is a different request from a business trip"),
    "the notice has started opening with a paraphrase of its own headline again"
  );
  assert.match(notice, /nothing is submitted until you send that form/, "what the system does NOT do is not editable under this rule");
});
