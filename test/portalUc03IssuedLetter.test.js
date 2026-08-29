// ---------------------------------------------------------------------------
// portalUc03IssuedLetter.test.js  —  the letter was issued, so say so, and hand
//                                    it over
// ---------------------------------------------------------------------------
// THE BUG REPORT THIS FILE IS WRITTEN FROM, verbatim, with screenshots. Through
// the deployed portal an employee submitted:
//
//   "I need a travel letter for my visa application for a conference in Germany
//    from September 20 to September 26, 2026."
//
// Everything decided correctly. The classifier read it correctly — intent
// business_travel, Germany, the right dates, `formalLetterRequested: true`,
// confidence 0.9, `source: "llm"`. UC-03 auto-resolved on
// `standard_letter_issued`, which means the formal travel letter WAS written,
// hashed, stored on the case and issued with nobody in the path.
//
// What the page showed them was:
//
//   "Yes — a business trip like this one to Germany needs nothing further from
//    Remote."
//   "Nobody has to approve the trip itself."
//
// and one row, several screens down, reading "Formal letter drafted: yes — held
// for specialist sign-off". They replied: "there is no way i requested visa
// letter and got that kind of answer. i dint even get the letter", and
// concluded that this system contains no model at all and that every output is
// written in advance. They were wrong about the cause and right about every
// symptom.
//
// FOUR DEFECTS, AND EACH ONE HAS A TEST BELOW:
//
//   1. THE ANSWER WAS FALSE. src/portal/plainAnswer.js composes from the
//      decision CLASS, and the class has no shape for "an act was performed" —
//      so `all_gates_passed` (an informational answer, nothing produced) and
//      `standard_letter_issued` (a document written and handed over) rendered
//      as the same sentence. A letter IS something further from Remote, and it
//      is the thing they asked for.
//   2. THE ONE ROW ABOUT THE LETTER WAS STALE. It read
//      `letterHtml ? "held for specialist sign-off" : "no"`, written before the
//      standard letter began issuing itself, so it told the person already
//      holding the document that it was waiting on a signature nobody would
//      ever give.
//   3. THE LETTER WAS UNREACHABLE FROM THE RESULT. It could be collected from
//      "My requests", if the reader thought to go and look; the result that
//      issued it said nothing.
//   4. WHO READ THE REQUEST NEVER REACHED THE POP-UP. The panel has computed it
//      for as long as it has been recorded, in a facts table below the fold.
//      That omission is the whole of why they concluded there was no model.
//
// WHAT THESE TESTS PIN. Properties, not prose — test/portalCopy.test.js's rule.
// Copy gets rewritten; what must not come back is an answer that reports an act
// as a clearance, a row that describes a state the case is not in, an issued
// document with no way to collect it, and a page that knows what read a request
// and does not say.
//
// HERMETIC: the mock Remote is dispatched in-process and every LLM seam is
// faked, so this file binds no port and opens no socket.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createPortalHandler } from "../src/portal/server.js";
import { plainAnswer } from "../src/portal/plainAnswer.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

/** The sentence the bug report was filed with, unchanged. */
const VISA_LETTER_REQUEST =
  "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.";

/**
 * A portal handler whose only model seam is a rule-based reader, optionally
 * tagging itself the way the real classifier does (§4 invariant 8).
 *
 * `source` is a parameter because the fourth defect is about exactly this tag:
 * the page must say "a model read it" when one did, "keywords read it" when the
 * model could not be reached, and neither when nothing recorded it.
 */
function portal({ source = null } = {}) {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const classifyTravel = (args) => {
    const read = classifyTravelInquiryRuleBased(args);
    return source ? { ...read, source } : read;
  };
  return createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: buildPortalStores(),
    llm: { classifyTravel },
  });
}

/** The in-process driver every other portal suite in this repo uses. */
function call(handler, { method = "POST", path, body = null, headers = {} }) {
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

let refs = 0;
async function askForTheLetter(handler) {
  const res = await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text: VISA_LETTER_REQUEST, externalRef: `issued-letter-${++refs}` },
  });
  assert.equal(res.status, 200, `the request was not decided at all: ${JSON.stringify(res.body)}`);
  assert.equal(
    res.body.reason,
    "standard_letter_issued",
    `this fixture no longer issues a letter, so it cannot test one: ${res.body.decision} / ${res.body.reason}`
  );
  return res.body;
}

const row = (payload, label) => (payload.details ?? []).find((d) => d.label === label);

// ---------------------------------------------------------------------------
// 1. THE ANSWER SAYS THE LETTER WAS ISSUED
// ---------------------------------------------------------------------------
// This is the assertion the whole file exists for, and it is written against
// the exact sentence the reader was shown.

test("a letter that was issued is not reported as a trip needing nothing further", async () => {
  const payload = await askForTheLetter(portal());
  const answer = payload.plainAnswer;
  const summary = `${answer.lead} ${answer.next ?? ""}`;

  assert.ok(
    !/nothing further/i.test(summary),
    `an issued letter is reported as needing nothing further from Remote: ${summary}`
  );
  // The document has to be NAMED. "Yes, and something happened" is not an
  // answer to somebody who asked for a letter for a visa appointment.
  assert.match(answer.lead, /letter/i, `the answer never mentions the letter: ${answer.lead}`);
  assert.match(answer.lead, /issued/i, `the answer does not say the letter was issued: ${answer.lead}`);
  // And it is still a yes, and still about Germany.
  assert.match(answer.lead, /^Yes\b/, answer.lead);
  assert.match(answer.lead, /Germany/, `the answer stopped naming the destination: ${answer.lead}`);
  assert.equal(answer.shape, "answered");
});

test("an informational answer is unchanged — the two outcomes are told apart, not merged", () => {
  // The OTHER auto-resolve. UC-03 reaches `auto_resolve` two ways and only one
  // of them produced a document; a fix that made both say "your letter was
  // issued" would be the original defect with the sentences swapped.
  const cleared = plainAnswer({
    useCase: "UC-03",
    decision: "auto_resolve",
    reason: "all_gates_passed",
    executionPath: "auto",
    recordLabel: "Case",
    placeCode: "DE",
  });
  assert.match(cleared.lead, /needs nothing further from Remote/);
  assert.ok(!/letter/i.test(`${cleared.lead} ${cleared.next ?? ""}`), cleared.lead);

  const issued = plainAnswer({
    useCase: "UC-03",
    decision: "auto_resolve",
    reason: "standard_letter_issued",
    executionPath: "auto",
    recordLabel: "Case",
    placeCode: "DE",
  });
  assert.notEqual(issued.lead, cleared.lead, "an issued letter and a bare clearance read identically");
});

test("the answer stays inside its two-sentence budget, and never prints a country code", () => {
  const sentences = (text) =>
    String(text)
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

  for (const placeCode of ["DE", "US", "NL", null]) {
    const answer = plainAnswer({
      useCase: "UC-03",
      decision: "auto_resolve",
      reason: "standard_letter_issued",
      executionPath: "auto",
      recordLabel: "Case",
      placeCode,
    });
    const total = sentences(answer.lead).length + (answer.next ? sentences(answer.next).length : 0);
    assert.equal(sentences(answer.lead).length, 1, `the lead runs to more than one sentence: ${answer.lead}`);
    assert.ok(total <= 2, `the summary runs to ${total} sentences — it has become the thing it replaced`);
    const summary = `${answer.lead} ${answer.next ?? ""}`;
    for (const token of summary.match(/\b[A-Z]{2}\b/g) ?? []) {
      assert.notEqual(token, placeCode, `the summary prints the country code ${token}: ${summary}`);
    }
  }
  // The definite article still applies to the names that take one.
  const us = plainAnswer({
    useCase: "UC-03",
    decision: "auto_resolve",
    reason: "standard_letter_issued",
    executionPath: "auto",
    placeCode: "US",
  });
  assert.match(us.lead, /for the United States\b/);
});

test("a reason this module has no row for composes exactly as it did before", () => {
  // The reason is consulted for MEMBERSHIP and never for meaning, so an
  // unknown one must be inert rather than an escalation, a blank or a throw.
  const withReason = plainAnswer({
    useCase: "UC-04",
    decision: "ready_for_approval",
    reason: "some_new_rung",
    executionPath: "single_approver",
    recordLabel: "Work authorization request",
    placeCode: "PT",
  });
  const withoutReason = plainAnswer({
    useCase: "UC-04",
    decision: "ready_for_approval",
    executionPath: "single_approver",
    recordLabel: "Work authorization request",
    placeCode: "PT",
  });
  assert.deepEqual(withReason, withoutReason);
});

// ---------------------------------------------------------------------------
// 2. THE ROW ABOUT THE LETTER DESCRIBES THE STATE THE CASE IS IN
// ---------------------------------------------------------------------------

test("the letter row never tells the holder of an issued letter that it awaits a signature", async () => {
  const payload = await askForTheLetter(portal());
  const letterRow = row(payload, "Formal travel letter") ?? row(payload, "Formal letter drafted");
  assert.ok(letterRow, `no row on this panel says anything about the letter: ${JSON.stringify(payload.details)}`);
  assert.ok(
    !/sign-?off|signature|specialist/i.test(letterRow.value),
    `an issued letter is reported as waiting on a person: ${letterRow.value}`
  );
  assert.match(letterRow.value, /issued/i, `the row does not say the letter was issued: ${letterRow.value}`);
});

test("a request that produced no letter still says which of the four situations it is", async () => {
  // "No letter" is four different facts (src/uc03/letterDelivery.js's
  // describeNoLetter) and the row must not flatten them back to "no".
  const res = await call(portal(), {
    path: "/api/requests/uc03",
    body: {
      persona: "chris",
      text: "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?",
      externalRef: `no-letter-${++refs}`,
    },
  });
  assert.equal(res.status, 200);
  const letterRow = row(res.body, "Formal travel letter");
  assert.ok(letterRow, "the letter row disappeared on a request that produced no letter");
  assert.ok(letterRow.value.length > 3, `the row fell back to a bare yes/no: ${letterRow.value}`);
  assert.equal(res.body.letter?.collect ?? null, null, "a case with no issued letter offers a way to collect one");
});

// ---------------------------------------------------------------------------
// 3. THE LETTER CAN BE COLLECTED FROM THE RESULT THAT ISSUED IT
// ---------------------------------------------------------------------------

test("the result carries a way to collect the issued letter, and it really returns the letter", async () => {
  const handler = portal();
  const payload = await askForTheLetter(handler);

  assert.ok(payload.letter, "the result says nothing at all about the document it produced");
  assert.equal(payload.letter.state, "issued");
  assert.ok(payload.letter.collect, "an issued letter is offered with no way to collect it");

  // THE ROUTE THE RESULT NAMED, driven exactly as the page drives it: the
  // persona is a KEY and the session behind it is the server's own.
  const collected = await call(handler, {
    method: payload.letter.collect.method,
    path: payload.letter.collect.path,
    body: { persona: "chris", caseId: payload.recordId },
  });
  assert.equal(collected.status, 200, `the offered route refused: ${JSON.stringify(collected.body)}`);
  assert.equal(collected.body.ok, true);
  assert.ok(collected.body.content && collected.body.content.length > 0, "the route handed over no document");
  assert.match(collected.body.filename, /\.html$/);
  // It is the letter for THIS trip and not some other document: the
  // destination the request named is in it. (Unlike UC-01's verification
  // letter, UC-03's travel letter states compensation on purpose — Schengen
  // Visa Code §5.2.2(d)/(e) means of subsistence — so this deliberately does
  // NOT assert its absence. src/uc03/letter.js's header argues that choice.)
  assert.match(collected.body.content, /Germany/i, "the document is not the letter for this trip");
  // The hash travels WITH the bytes, so a holder can check the document
  // against the one history says was issued.
  assert.ok(collected.body.contentHash, "the letter was handed over with no hash to check it against");
});

test("the offer is the delivery gate's, so nobody else's letter can be collected from it", async () => {
  const handler = portal();
  const payload = await askForTheLetter(handler);

  // A different employee, on the same case. src/uc03/letterDelivery.js refuses
  // it — the page never gets to decide, which is the whole point of the offer
  // being a relay of that verdict rather than a control of its own.
  const other = await call(handler, {
    method: payload.letter.collect.method,
    path: payload.letter.collect.path,
    body: { persona: "anna", caseId: payload.recordId },
  });
  assert.notEqual(other.status, 200, "somebody else's travel letter was handed over");
  assert.equal(other.body.ok, false);
  assert.ok(!other.body.content, "a refusal still returned the document");
});

// ---------------------------------------------------------------------------
// 4. THE REQUESTER IS TOLD ABOUT THE READING ONLY WHEN THEY CAN ACT ON IT
// ---------------------------------------------------------------------------
// This block previously asserted the opposite: that the pop-up always names
// what read the request. That was built to settle an argument about whether the
// model was running at all — a builder's question — and it put the answer in
// front of an employee who has nothing to do with it. The project owner's rule
// is that each surface carries what ITS reader needs: employee-facing pages are
// written for the employee, specialist pages for the specialist.
//
// So a normal reading is silent, and a DEGRADED one is not, because only the
// second gives the employee an action. The keyword fallback misses phrasings a
// model catches, so "check these details" is advice; "an AI model read this" is
// trivia. The specialist keeps the full fact in the facts table below, which is
// also the Zendesk note — the test after this one pins that, and the pair is
// the point: same fact, two audiences, one of them served.

test("a normal reading is not mentioned to the requester at all", async () => {
  const payload = await askForTheLetter(portal({ source: "llm" }));
  assert.equal(
    payload.readBy,
    null,
    `the requester is told what read their words when nothing is wrong: ${payload.readBy}`
  );
});

test("a degraded reading tells the requester what to DO, not what ran", async () => {
  const payload = await askForTheLetter(portal({ source: "rule_based_fallback" }));
  assert.ok(payload.readBy, "the one reading worth warning about is silent");
  assert.match(payload.readBy, /check the trip details/i, payload.readBy);
  // It must not explain our infrastructure to them while doing it.
  for (const jargon of ["LLM", "classifier", "fallback", "rule_based", "source", "AI model", "keyword"]) {
    assert.ok(
      !payload.readBy.toLowerCase().includes(jargon.toLowerCase()),
      `the warning explains our plumbing instead of their next step: ${payload.readBy}`
    );
  }
});

test("an unrecorded reading is silent rather than confessing to the requester", async () => {
  const payload = await askForTheLetter(portal());
  assert.equal(
    payload.readBy,
    null,
    `the requester is handed our own bookkeeping gap: ${payload.readBy}`
  );
});

test("what read the request is the SPECIALIST's row, and the requester keeps the advice", async () => {
  const payload = await askForTheLetter(portal({ source: "rule_based_fallback" }));

  // "Request read by: a fixed list of keywords, because the AI model could not
  // be reached" is the row the project owner named when he said to stop
  // littering the page with what is useless to his user. It is exactly what the
  // specialist re-reading the case wants and nothing the traveller can act on,
  // so it is published as a specialistDetail(): on the Zendesk note, off this
  // panel. Its wording still avoids our engineering vocabulary — a specialist
  // is not an engineer either — and that is asserted against the real created
  // ticket in test/portalRequesterFacts.test.js.
  assert.equal(row(payload, "Request read by"), undefined, "the provenance row is still on the requester's panel");
  assert.equal(row(payload, "Confidence in that reading"), undefined, "the confidence score is still on the requester's panel");

  // AND THE HALF THAT IS THEIRS SURVIVES. describeReader() splits this in two:
  // the row above, and a sentence that exists ONLY when the fallback ran and
  // there is therefore something for them to do about it.
  assert.match(payload.readBy, /check the trip details/i, "the degraded reading no longer tells them to check anything");
  assert.ok(!/LLM|rule_based|unconfigured|language model/.test(payload.readBy), `our vocabulary reached the requester: ${payload.readBy}`);
});

// ---------------------------------------------------------------------------
// 5. THE PAGE RENDERS WHAT IT IS GIVEN AND DECIDES NONE OF IT
// ---------------------------------------------------------------------------
// The same `node:vm` technique test/portalResultDialog.test.js uses: the
// browser asset is not importable, so the functions under test are lifted with
// the four-line `el()` helper the file itself defines.

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

const flatten = (node) =>
  (node.textContent || "") + (node.childNodes || []).map(flatten).join(" ");

test("an issued letter builds a control on the page, and a drafted one builds none", () => {
  const issued = offersFor({
    recordId: "case-1",
    letter: {
      state: "issued",
      label: "Ready",
      detail: "The formal travel letter for this trip has been written and issued. It is yours to open or save.",
      collect: { method: "POST", path: "/api/requests/uc03/letter" },
    },
  });
  assert.equal(issued.length, 1, "an issued letter offers nothing on the page");
  const text = flatten(issued[0]).replace(/\s+/g, " ");
  assert.match(text, /letter/i);
  assert.match(text, /Open the letter/);
  assert.match(text, /Save it/);

  // A DRAFTED letter is held by a specialist and there is nothing to hand over.
  // A control here would promise a document the sign-off gate exists to
  // withhold, which is worse than no control.
  //
  // LENGTH AND NOT deepEqual: these arrays come back from a `node:vm` sandbox
  // and are cross-realm, so assert.deepEqual fails on prototype identity even
  // when the contents match (CLAUDE.md §6).
  assert.equal(
    offersFor({
      recordId: "case-2",
      letter: { state: "drafted", label: "With a specialist", detail: "…", collect: null },
    }).length,
    0,
    "a letter held for a specialist offered a control anyway"
  );
  // And a result with no letter at all offers nothing.
  assert.equal(offersFor({ recordId: "case-3" }).length, 0);
});

test("the page holds no rule about which letters may be collected", () => {
  const start = APP.indexOf("  function letterCollection(payload) {");
  const end = APP.indexOf("  /**\n   * Accept the offer.");
  assert.ok(start !== -1 && end > start, "letterCollection() has moved — re-point this test");
  const body = APP.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // No state word, no decision string, no path of its own: whether there is a
  // control and where it posts are both src/uc03/letterDelivery.js's answer,
  // relayed through the server.
  for (const forbidden of ["issued", "drafted", "auto_resolve", "standard_letter", "/api/"]) {
    assert.ok(!body.includes(forbidden), `letterCollection() decides "${forbidden}" for itself`);
  }
  assert.ok(!body.includes("innerHTML"), "letterCollection() writes markup");
});

test("the pop-up prints who read the request, and writes no sentence of its own about it", () => {
  const start = APP.indexOf("  function plainAnswerBlock(payload) {");
  const end = APP.indexOf("  function shortId(", start);
  assert.ok(start !== -1 && end > start, "plainAnswerBlock() has moved — re-point this test");
  const block = APP.slice(start, end);
  assert.match(block, /payload\.readBy/, "the answer block does not carry who read the request");

  const { document, el } = domSandbox();
  const ctx = { document, el, ANSWER_TITLE_ID: "portal-answer-title", OUT: null };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  vm.runInContext(
    `OUT = plainAnswerBlock({ plainAnswer: { lead: "L.", next: "N.", shape: "answered" }, readBy: "WHO READ IT" });`,
    ctx
  );
  assert.ok(flatten(ctx.OUT).includes("WHO READ IT"), "the server's sentence never reaches the page");

  // Absent on a result that carries none — a guess would be the overstatement
  // this whole change exists to remove.
  vm.runInContext(`OUT = plainAnswerBlock({ plainAnswer: { lead: "L.", next: null, shape: "answered" } });`, ctx);
  assert.ok(!/undefined|null/.test(flatten(ctx.OUT)), flatten(ctx.OUT));
});
