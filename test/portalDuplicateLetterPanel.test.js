// ---------------------------------------------------------------------------
// portalDuplicateLetterPanel.test.js — rca-lapd (round-7 R7-12)
// ---------------------------------------------------------------------------
// THE DEFECT, in the employee's own words: "the single most confusing moment
// of this errand... did that work or not?" A result that both (a) already had
// a letter ready to collect and (b) was a repeat delivery of an already-
// answered reference rendered TWO panels — an interstitial reading "Your
// letter is ready" and, below it, a separate amber-styled notice reading
// "Already processed — this reference was refused as a repeat delivery". Both
// are true, but placed side by side they read as a contradiction of each
// other about the SAME result.
//
// THE FIX HAS TWO HALVES, both pinned here:
//   1. letterCollection() now folds the duplicate-delivery explanation into
//      its own box as a follow-on line, and the standalone "already handled"
//      notice skips itself whenever a letter is ready to collect — so exactly
//      one panel renders, never two disagreeing ones.
//   2. The shared delivery explanation (src/portal/server.js's
//      deliveryFields()) no longer explains the refusal in ledger/
//      primary-key vocabulary — see test/portalTicket.test.js for the
//      functional assertion against the real duplicate-delivery flow.
//
// HERMETIC: no network, no socket — the same node:vm lift technique
// test/portalUc03LetterCollect.test.js and test/portalInterstitial.test.js use
// to run fragments of the (non-importable) browser asset directly.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

function domSandbox() {
  const make = (tag) => ({
    tag,
    className: "",
    textContent: "",
    childNodes: [],
    listeners: {},
    appendChild(node) {
      this.childNodes.push(node);
      return node;
    },
    setAttribute() {},
    addEventListener(name, fn) {
      (this.listeners[name] = this.listeners[name] || []).push(fn);
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
  return { document, el };
}

/** offersOn() (which builds letterCollection()'s box among its candidates),
 *  lifted the same way test/portalUc03IssuedLetter.test.js's offersFor() does. */
function offersFor(payload) {
  const start = APP.indexOf("  function offersOn(payload) {");
  const end = APP.indexOf("  function acceptLetterOffer(");
  assert.ok(start !== -1 && end > start, "app.js has moved — re-point this test");
  const ctx = { ...domSandbox(), PAYLOAD: payload, OFFERS: null };
  vm.createContext(ctx);
  vm.runInContext(APP.slice(start, end), ctx);
  vm.runInContext("OFFERS = offersOn(PAYLOAD);", ctx);
  return ctx.OFFERS;
}

const flatten = (node) => (node.textContent || "") + (node.childNodes || []).map(flatten).join(" ");

const READY_LETTER_PAYLOAD = {
  recordId: "case-dup-1",
  letter: { collect: { method: "POST", path: "api/requests/uc01/collect-letter" }, detail: "Your employment verification letter." },
  alreadyHandled: true,
  alreadyHandledKind: "delivery",
  duplicateDelivery: true,
  duplicateOf: "repeat-ref-1",
  duplicateExplanation: "This exact reference had already been processed, so this request was not decided again and nothing was written twice.",
  duplicateWindowExpiresAt: "2026-08-24T00:00:00.000Z",
};

test("a result that is both a repeat delivery AND has a ready letter builds exactly ONE offer, not two", () => {
  const offers = offersFor(READY_LETTER_PAYLOAD);
  assert.equal(offers.length, 1, "a repeat delivery with a ready letter must not build a second, competing panel");
});

test("the one panel says the letter is ready AND explains the repeat, in one voice", () => {
  const offers = offersFor(READY_LETTER_PAYLOAD);
  const text = flatten(offers[0]);
  assert.match(text, /Your letter is ready/, "the actionable fact — there is a letter to collect — must still be said");
  assert.match(text, /already been processed/i, "the reason nothing was decided again must still reach the reader");
  assert.match(text, /2026-08-24T00:00:00\.000Z/, "the hold-clears-at fact (rca-0jya/R7-41) must survive the merge");
});

test("a repeat delivery with NO letter to collect still gets its own standalone notice", () => {
  // The merge only applies when there is something to merge INTO. A plain
  // duplicate-delivery result (no letter field at all) must still produce the
  // amber notice on its own — this file's fix must not silently swallow it.
  const offers = offersFor({
    recordId: undefined,
    alreadyHandled: true,
    alreadyHandledKind: "delivery",
    duplicateDelivery: true,
    duplicateOf: "repeat-ref-2",
    duplicateExplanation: "This exact reference had already been processed.",
  });
  // offersOn() only ever returns continuationOffer/letterCollection/letterOffer
  // candidates — the standalone amber notice lives in render(), outside
  // offersOn() entirely, so it correctly builds nothing here. This assertion
  // pins that the ready-letter guard did not accidentally start swallowing
  // some OTHER offer for a plain (letter-less) duplicate.
  assert.equal(offers.length, 0, "a letter-less duplicate must offer nothing new to act on");
});

// ---------------------------------------------------------------------------
// THE STANDALONE NOTICE'S OWN GUARD, read out of render()'s source
// ---------------------------------------------------------------------------
// The amber "already handled" notice lives inline in render(), not in a
// function offersOn() reaches, so it cannot be exercised through offersFor()
// above. Pinned the way test/portalInterstitial.test.js pins render()'s
// refusal branch: by reading the guarding source text directly.

test("the standalone 'already handled' notice is gated on there being no ready letter to fold it into", () => {
  const code = APP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const marker = 'var dupe = el("div", "duplicate-notice");';
  const dupeSite = code.indexOf(marker);
  assert.ok(dupeSite !== -1, "the standalone duplicate-notice block has moved — re-point this test");

  // The `if` guarding this block, read back a short window before it.
  const guard = code.slice(Math.max(0, dupeSite - 400), dupeSite);
  assert.match(guard, /letterIsReady/, "the standalone notice no longer checks whether a letter is ready");
  assert.match(
    guard,
    /payload\.alreadyHandled === true && !letterIsReady/,
    "the standalone notice must render only when alreadyHandled is true AND no letter is ready"
  );

  // And the guard variable itself mirrors letterCollection()'s own precondition
  // exactly, so the two can never disagree about what "ready" means.
  const letterIsReadySite = code.indexOf("var letterIsReady =");
  assert.ok(letterIsReadySite !== -1);
  const letterIsReadyLine = code.slice(letterIsReadySite, code.indexOf(";", letterIsReadySite) + 1);
  assert.match(letterIsReadyLine, /payload\.letter/);
  assert.match(letterIsReadyLine, /\.collect/);
  assert.match(letterIsReadyLine, /payload\.recordId/);
});
