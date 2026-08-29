// ---------------------------------------------------------------------------
// portalResultDialog.test.js  —  the answer arrives, and it agrees with the panel
// ---------------------------------------------------------------------------
// WHAT IS UNDER TEST
//
// Every result on the portal now opens with a dialog carrying the ANSWER, and
// the recommendation under it when there is one. The project owner: "I want the
// answer for everything to always be in the pop up, and then in this case a
// recommendation, starting with something like 'Do you need a formal letter for
// your trip?'"
//
// test/portalInterstitial.test.js pins the MECHANISM — one dialog, the answer
// leads it, dismissing takes nothing away — on hand-built and single-driven
// payloads. This file pins the CONTRACT over every quick-fill on all seven
// forms at once, because the failure this change can most easily introduce is
// not mechanical:
//
//   A DIALOG WHOSE ANSWER CONTRADICTS THE PANEL BENEATH IT.
//
// A modal is the one thing a hurried reader is guaranteed to read, and it is
// read APART from the machinery it summarises. A "Yes" over a hand-off, a "No"
// over an approval, or a recommendation restating the answer above it are all
// invisible in a single-scenario test and all obvious in a sweep. So the
// assertions below are almost entirely about what a dialog may never say, run
// over every scenario the page can produce, with each one checked against the
// decision, the reason and the deciding gate it actually came from.
//
// HERMETIC: the mock Remote is dispatched in-process and every LLM seam is
// faked with the repo-standard `(args) => realFn(args, {isConfigured: () =>
// false})` idiom, so this file binds no port and opens no socket.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { REQUEST_TYPES } from "../src/portal/requestTypes.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

const unconfigured = { isConfigured: () => false };
const LLM = {
  classifyExpense: classifyExpenseRuleBased,
  classifyTravel: classifyTravelInquiryRuleBased,
  parseRelocation: parseRelocationRuleBased,
  parseInquiry: parseInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  extract: (args) => extractFromLetter(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

// ---------------------------------------------------------------------------
// THE PAGE, LIFTED — the same node:vm technique every browser-asset test in
// this repo uses, because `npm test` never imports a browser asset.
// ---------------------------------------------------------------------------

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
      return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
    },
    matches(selector) {
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

/** render()'s own four lines for the answer, the offers and the dialog. */
function renderResult(payload) {
  const start = APP.indexOf("  function offersOn(payload) {");
  const end = APP.indexOf("  function acceptLetterOffer(");
  const answerStart = APP.indexOf("  function plainAnswerBlock(payload) {");
  const answerEnd = APP.indexOf("  function shortId(", answerStart);
  assert.ok(start !== -1 && end > start && answerStart !== -1 && answerEnd > answerStart, "app.js has moved — re-point this test");

  const { document, el, make } = domSandbox();
  const context = { document, el, PAYLOAD: payload, WRAP: make("div") };
  vm.createContext(context);
  vm.runInContext(APP.slice(start, end), context);
  vm.runInContext(APP.slice(answerStart, answerEnd), context);
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
  return { wrap: context.WRAP, document, dialogs: document.body.childNodes };
}

const textOf = (node) => node.textContent + (node.childNodes || []).map(textOf).join(" ");
const flat = (node) => textOf(node).replace(/\s+/g, " ").trim();

/**
 * The CONTENT blocks in a dialog's panel — the answer, and the recommendation
 * under it when there is one — with the dialog's own chrome left out.
 *
 * The panel's first child is the close control (presentResultDialog()), which
 * is furniture rather than something the reader was told. Every assertion below
 * about "the first thing in the dialog" or "the block under the answer" means
 * the first and second of THESE, and said so before the chrome existed by
 * indexing the panel directly. Reading it through one helper is what stops the
 * next piece of chrome silently shifting every index in this file.
 */
const blocksIn = (panel) => panel.childNodes.filter((node) => node.getAttribute("data-dialog-close") === null);

/** Every close control in a dialog, of either kind. See the way-out test. */
function waysOut(node, found) {
  const out = found || [];
  if (node.getAttribute && (node.getAttribute("data-dialog-close") !== null || node.getAttribute("data-interstitial-dismiss") !== null)) {
    out.push(node);
  }
  (node.childNodes || []).forEach((child) => waysOut(child, out));
  return out;
}

// ---------------------------------------------------------------------------
// EVERY QUICK-FILL, DRIVEN ONCE
// ---------------------------------------------------------------------------
// SCENARIOS and BUILDERS are lifted out of app.js rather than restated, the
// same way test/portalPlainAnswer.test.js does it and for the same reason: a
// test that wrote its own bodies could never disagree with a scenario that had
// changed.

function liftBlock(opening) {
  const start = APP.indexOf(opening);
  const end = APP.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, `${opening} has moved — re-point this test`);
  return APP.slice(start, end + 4);
}

function browserSandbox() {
  let refs = 0;
  const ctx = {
    SCENARIOS: null,
    BUILDERS: null,
    FIELDS: {},
    pendingContinuation: null,
    value: (id) => String(ctx.FIELDS[id] ?? "").trim(),
    orNull: (id) => String(ctx.FIELDS[id] ?? "").trim() || null,
    checked: (id) => ctx.FIELDS[id] === true,
    reference: (typeId) => `${typeId}-resultdialog-${++refs}`,
    freshCopyOf: (expenseId) => expenseId,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBlock("  var SCENARIOS = {").replace("var SCENARIOS =", "SCENARIOS ="), ctx);
  vm.runInContext(liftBlock("  var BUILDERS = {").replace("var BUILDERS =", "BUILDERS ="), ctx);
  return ctx;
}

function call(handler, { path, body }) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "POST",
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
        let parsed = null;
        try {
          parsed = payload ? JSON.parse(String(payload)) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    handler(req, res).catch(reject);
  });
}

let DRIVEN = null;
async function driveEveryScenario() {
  // Memoised — forty-odd real workflow runs is the expensive part of this file
  // and every test below asks a different question of the same answers.
  if (DRIVEN) return DRIVEN;
  const ctx = browserSandbox();
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const handler = createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM });
  const results = [];
  for (const [typeId, list] of Object.entries(ctx.SCENARIOS)) {
    for (const scenario of list) {
      ctx.FIELDS = scenario.fields || {};
      const body = vm.runInContext(`BUILDERS[${JSON.stringify(typeId)}](${JSON.stringify(scenario.persona ?? "")})`, ctx);
      const res = await call(handler, { path: `/api/requests/${typeId}`, body });
      results.push({ typeId, id: scenario.id, where: `${typeId}/${scenario.id}`, payload: res.body || {} });
    }
  }
  assert.ok(results.length >= 40, `only ${results.length} quick-fills were driven — a form has lost its scenarios`);
  DRIVEN = results;
  return results;
}

const decided = (results) => results.filter((r) => r.payload.ok === true);

// ---------------------------------------------------------------------------
// 1. EVERY DECIDED RESULT OPENS EXACTLY ONE DIALOG, AND THE ANSWER LEADS IT
// ---------------------------------------------------------------------------
// THE MEASUREMENT THIS REPLACED A JUDGEMENT WITH. Two readings of the owner's
// instruction were defensible — a dialog on every result, or only on the ones
// whose answer is not already on screen. Driven in Chromium at `scrollY === 0`,
// the answer's first pixel falls 1153/926/1795/1653/2037/1482/1246px down for
// UC-02…UC-09 at 1180x900, and 2090/1681/3707/3251/3887/2831/2196px at 340x740.
// Fourteen of fourteen below the fold, nearest 26px past it. The condition
// "only when it is off screen" is the same rule with a test that is currently
// always true, so it is written as "always" — and presentResultDialog()'s
// header records the numbers to re-measure against.

test("every decided result opens one dialog; every intake refusal opens none", async () => {
  let dialogs = 0;
  let refusals = 0;
  for (const r of await driveEveryScenario()) {
    const { document } = renderResult(r.payload);
    if (r.payload.ok !== true) {
      refusals += 1;
      assert.equal(document.body.childNodes.length, 0, `${r.where} interrupted a correction loop with a modal`);
      continue;
    }
    dialogs += 1;
    assert.equal(document.body.childNodes.length, 1, `${r.where} opened ${document.body.childNodes.length} dialogs — one per result, maximum`);
    const dialog = document.body.childNodes[0];
    assert.equal(dialog.tag, "dialog", `${r.where} did not use a native <dialog>`);
    assert.equal(dialog.open, true, `${r.where} built a dialog and never showed it`);
  }
  assert.ok(dialogs >= 35, `only ${dialogs} decided results were exercised`);
  assert.ok(refusals >= 3, `only ${refusals} intake refusals were exercised`);
});

test("the dialog is named by the answer, and the answer is the first thing in it", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const { document } = renderResult(r.payload);
    const panel = document.body.childNodes[0].childNodes[0];
    assert.equal(panel.className, "interstitial-panel", `${r.where}'s dialog has no panel`);

    // THE FIRST THING THE READER WAS TOLD, which is not the same node as the
    // first child any more: the panel now opens with the dialog's own close
    // control, so that a way out of the modal is reachable without scrolling a
    // panel that is capped and scrolls. It is chrome, it carries no sentence,
    // and the accessible NAME of the dialog is still the answer's heading —
    // which is what a screen reader announces on open, whatever the DOM order.
    const first = blocksIn(panel)[0];
    assert.ok(first.matches(".plain-answer"), `${r.where}'s dialog does not lead with the answer`);

    // THE ACCESSIBLE NAME IS THE ANSWER'S SENTENCE, exactly — not a paraphrase,
    // not the offer's heading, and not a string this page wrote.
    const heading = first.querySelector(".plain-answer-lead");
    assert.equal(heading.tag, "h3", `${r.where}'s answer is not a heading`);
    assert.equal(heading.textContent, r.payload.plainAnswer.lead, `${r.where}'s dialog title is not the server's answer`);
    assert.equal(
      document.body.childNodes[0].getAttribute("aria-labelledby"),
      heading.id,
      `${r.where}'s dialog is not labelled by its own answer`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. THE DIALOG NEVER CONTRADICTS THE PANEL IT SITS OVER
// ---------------------------------------------------------------------------
// The named failure mode, checked directly. A modal is read apart from the
// machinery beneath it, so an approval that reads as a refusal — or the reverse
// — is acted on rather than checked.

const AFFIRMS = /^Yes\b/;
const REFUSES = /^No\b/;

test("no dialog reads as an answer the decision beneath it did not give", async () => {
  let affirmed = 0;
  let refused = 0;
  for (const r of decided(await driveEveryScenario())) {
    const { document } = renderResult(r.payload);
    const title = blocksIn(document.body.childNodes[0].childNodes[0])[0].querySelector(".plain-answer-lead").textContent;
    const where = `${r.where} (${r.payload.decision})`;

    if (AFFIRMS.test(title)) {
      affirmed += 1;
      assert.ok(["auto_approve", "auto_resolve"].includes(r.payload.decision), `${where} interrupts with a Yes it was not given: ${title}`);
      assert.notEqual(r.payload.executionPath, "none", `${where} interrupts with a Yes on a use case that decides nothing`);
    }
    if (REFUSES.test(title)) {
      refused += 1;
      assert.equal(r.payload.decision, "blocked", `${where} interrupts with a No it was not given: ${title}`);
    }
    // AND THE 🔴 PAIR IS NEITHER, in the loudest place on the page. UC-07 and
    // UC-08 compile a dossier that nobody approves anywhere; a modal reading
    // either way over one would be the most damaging sentence this change could
    // put in front of a person.
    if (r.payload.executionPath === "none") {
      assert.ok(!AFFIRMS.test(title) && !REFUSES.test(title), `${where} reads a dossier as a decision: ${title}`);
      assert.match(flat(document.body.childNodes[0]), /here or anywhere else in this system/, `${where} dropped the no-execution-path guarantee inside the dialog`);
    }
  }
  assert.ok(affirmed >= 3, `only ${affirmed} affirmative dialogs were exercised`);
  assert.ok(refused >= 3, `only ${refused} refusing dialogs were exercised`);
});

test("nothing in a dialog restates the answer above it or the gate below it", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const { document } = renderResult(r.payload);
    const dialog = document.body.childNodes[0];
    const panel = dialog.childNodes[0];
    const words = flat(dialog);

    // The deciding gate's own sentence is the paragraph the reader meets when
    // they close this. src/portal/plainAnswer.js cannot restate it by
    // construction; a recommendation could, and that is what this checks.
    const means = r.payload.decidedBy?.means;
    if (means) assert.ok(!words.includes(means), `${r.where}'s dialog reprints the deciding gate's sentence`);

    // AND THE RECOMMENDATION DOES NOT SAY THE ANSWER AGAIN. Rule 3 of
    // plainAnswer.js at four lines' range instead of a screen's.
    const blocks = blocksIn(panel);
    if (blocks.length > 1) {
      const recommendation = blocks[1];
      assert.ok(
        !flat(recommendation).includes(r.payload.plainAnswer.lead),
        `${r.where}'s recommendation restates the answer directly above it`
      );
      const heading = recommendation.querySelector(".interstitial-title");
      assert.equal(heading.tag, "h4", `${r.where}'s recommendation outranks the answer in the outline`);
      assert.notEqual(heading.textContent, r.payload.plainAnswer.lead);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. DISMISSING TAKES NOTHING AWAY, ON EVERY RESULT
// ---------------------------------------------------------------------------
// The whole design rests on this: a modal whose content vanishes when you leave
// it has removed something from the page, and would make the interruption a net
// loss for anyone who dismisses one. Section 4 of test/portalInterstitial.test.js
// pins it for the letter; this pins it for all of them, in both orders.

test("every dialog carries the dialog's OWN way out, and using it restores every block in place", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const { wrap, document } = renderResult(r.payload);
    const dialog = document.body.childNodes[0];
    const panel = dialog.childNodes[0];
    const blocks = blocksIn(panel).length;

    // A WAY OUT THAT IS THE DIALOG'S OWN, on every result of every use case.
    //
    // "I also noticed your popup had no way to exit it." — the project owner.
    // There WAS one, and this file asserted it: whichever `[data-interstitial-
    // dismiss]` the dialog happened to contain, which was the promoted offer's
    // "Not now" when there was an offer and a "Close" appended after the last
    // block when there was not. Both sat at the BOTTOM of a panel that is
    // capped at `calc(100vh - 48px)` and scrolls, so on a phone, under a tall
    // recommendation, the only exit was below the fold of the modal itself.
    // A control you have to scroll a trap to find is not a way out.
    //
    // So the contract is now stated as two different things rather than one:
    //   * EXACTLY ONE `[data-dialog-close]` — the panel's own chrome, first in
    //     the panel, on every dialog. This is the way out of the DIALOG.
    //   * AT MOST ONE `[data-interstitial-dismiss]` — the promoted offer's, in
    //     the server's own word ("Not now"). This is a decision about the
    //     OFFER, which happens also to close the dialog.
    // The old assertion's worry — "two identical doors" — is what the split
    // answers: they are told apart by attribute here because they read as
    // different things there.
    const chrome = waysOut(dialog).filter((node) => node.getAttribute("data-dialog-close") !== null);
    const offerDismiss = waysOut(dialog).filter((node) => node.getAttribute("data-interstitial-dismiss") !== null);
    assert.equal(chrome.length, 1, `${r.where}'s dialog has ${chrome.length} close controls of its own`);
    assert.ok(offerDismiss.length <= 1, `${r.where}'s dialog has ${offerDismiss.length} offer dismissals`);
    assert.equal(chrome[0].textContent, "Close", `${r.where}'s close control does not say what it does`);
    assert.equal(chrome[0].getAttribute("aria-label"), "Close");
    assert.equal(blocksIn(panel)[0], chrome[0] ? blocksIn(panel)[0] : null);
    assert.equal(panel.childNodes[0], chrome[0], `${r.where}'s close control is not the first thing in the panel`);

    // The action, if there is one, is remembered so it can be checked after.
    const action = panel.querySelector(".r-btn-primary");
    const actionLabel = action ? action.textContent : null;

    chrome[0].listeners.click[0]();

    assert.equal(document.body.childNodes.length, 0, `${r.where} left its dialog in the document`);
    assert.equal(wrap.childNodes.length, blocks, `${r.where} lost a block on dismissal`);
    assert.ok(wrap.childNodes[0].matches(".plain-answer"), `${r.where} restored its blocks out of order`);
    assert.ok(flat(wrap.childNodes[0]).includes(r.payload.plainAnswer.lead), `${r.where}'s answer did not come back`);

    // THE ACTION SURVIVES AND THE WAYS OUT DO NOT. A "Close" button on a page
    // with no dialog to close is a control that does nothing.
    if (actionLabel) assert.ok(flat(wrap).includes(actionLabel), `${r.where} lost the offer's action on dismissal`);
    assert.equal(waysOut(wrap).length, 0, `${r.where} kept a dismiss control that has no dialog to close`);
    assert.equal(wrap.querySelector("[data-dialog-close-row]"), null, `${r.where} kept an empty button row`);
  }
});

// ---------------------------------------------------------------------------
// 3b. THE OTHER TWO WAYS OUT — ESCAPE, AND THE BACKDROP
// ---------------------------------------------------------------------------
// A modal is expected to close three ways and this one closed by one and a
// half. Escape was always there (the browser fires "close", and the restore
// handler is bound to that event rather than to a keydown of our own, so the
// engine's dismissal and ours cannot diverge). The BACKDROP was missing
// outright, and it is the one most people reach for first.
//
// The sandbox models a <dialog> the way the platform behaves: a click on the
// dimmed area outside the card is reported against the DIALOG element, and a
// click on anything in the card is reported against that inner node. So the
// two cases below are the real two, not a stand-in for them.

test("a click on the backdrop closes the dialog; a click on the card does not", async () => {
  for (const r of decided(await driveEveryScenario()).slice(0, 12)) {
    const { wrap, document } = renderResult(r.payload);
    const dialog = document.body.childNodes[0];
    const panel = dialog.childNodes[0];
    const click = dialog.listeners.click[0];

    // Inside the card: nothing happens, and nothing is put back.
    click({ target: panel });
    assert.equal(document.body.childNodes.length, 1, `${r.where} closed on a click INSIDE the dialog`);

    // On the backdrop: the dialog closes and every block returns to the page.
    click({ target: dialog });
    assert.equal(document.body.childNodes.length, 0, `${r.where} did not close on a backdrop click`);
    assert.ok(flat(wrap).includes(r.payload.plainAnswer.lead), `${r.where} lost its answer to a backdrop click`);
  }
});

test("Escape closes the dialog and puts every block back, on every use case", async () => {
  const seen = new Set();
  for (const r of decided(await driveEveryScenario())) {
    const { wrap, document } = renderResult(r.payload);
    const dialog = document.body.childNodes[0];
    const blocks = blocksIn(dialog.childNodes[0]).length;

    // The browser's own dismissal: Escape fires "close" on the element, which
    // is the event the restore handler is bound to.
    dialog.dispatch("close");

    assert.equal(document.body.childNodes.length, 0, `${r.where} survived Escape`);
    assert.equal(wrap.childNodes.length, blocks, `${r.where} lost a block to Escape`);
    assert.ok(flat(wrap).includes(r.payload.plainAnswer.lead), `${r.where} lost its answer to Escape`);
    assert.equal(waysOut(wrap).length, 0, `${r.where} left a spent control on the page after Escape`);
    seen.add(r.typeId);
  }
  // EVERY USE CASE, not the one that was reported. The owner has twice had to
  // say "same for every use case" after a fix landed on one.
  //
  // READ OFF THE REGISTRY rather than restated as a count. This said `7` until
  // 2026-08-28, when UC-01 gained quick-fills and therefore started reaching
  // this loop for the first time — so the assertion failed on COVERAGE GOING
  // UP, printing "Escape was only exercised on" above a list of all eight. A
  // number cannot tell those two directions apart; the registry can, and it
  // also catches the case this was really written for, which is a use case
  // quietly dropping out of the sweep.
  assert.deepEqual(
    [...seen].sort(),
    REQUEST_TYPES.map((type) => type.id).sort(),
    `Escape was only exercised on ${[...seen].join(", ")}`
  );
});
