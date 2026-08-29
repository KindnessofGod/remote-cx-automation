// ---------------------------------------------------------------------------
// portalUc03LetterCollect.test.js — "so now, how do i get my letter?"
// ---------------------------------------------------------------------------
// THE DEFECT, IN THE PROJECT OWNER'S OWN WORDS. He submitted the short business
// trip on the portal, took the offer on the answer, and read the green sentence
// the server sent back: "Your travel letter has been written and issued — it is
// attached to this request and posted to the ticket." Then: "so now, how do i
// get my letter?"
//
// He could not. The letter was rendered, hashed, stored and issued, and the
// panel that announced it carried nothing to press. This repository's most
// expensive recurring shape — correct, durable, audited, and reaching nobody —
// with the document already written and the person it is about looking straight
// at the sentence saying so.
//
// WHY EVERY EXISTING TEST PASSED THROUGH IT. `letterCollection()` builds the
// two controls and is pinned by test/portalUc03IssuedLetter.test.js — but it is
// built from the INTAKE response, and this letter came into existence on the
// ACCEPT response, on a panel that never re-renders. A letter created between
// the two was in a state no builder ran for. When acceptLetterOffer() was
// written, accepting produced a draft held for a signature and there was
// nothing to collect; the 🟢 path began issuing the standard letter with nobody
// in the path and no test noticed, because a panel that shows no button and a
// panel that has no letter look identical from outside. That is §7 of
// docs/WHY-THIS-SHAPE.md, one layer up from the gates.
//
// SO THE TESTS HERE ARE POSITIVE ONES. Section 1 drives intake → accept →
// collect against the real handler and requires the bytes to come back.
// Section 2 builds the controls the accept panel now renders and asserts the
// BUTTONS, not the heading — a heading can be right while nothing is pressable.
// Section 3 pins the two things that came off the panel, and section 4 the
// ordering argument in offersOn() that was resting on a false premise.
//
// HERMETIC: the mock Remote is dispatched in-process, the classifier seam is
// the rule-based one, no socket is bound.
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
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

const TRIP =
  "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026. Can you confirm business travel is fine?";

function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({
    remote,
    audit: new AuditLogger(),
    stores: buildPortalStores(),
    llm: { classifyTravel: classifyTravelInquiryRuleBased },
  });
}

function call(handler, path, body) {
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
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

/** The path the server sends is relative; the in-process driver wants it rooted. */
const rooted = (path) => (String(path).startsWith("/") ? String(path) : "/" + path);

// ---------------------------------------------------------------------------
// 1. THE WHOLE JOURNEY, ENDING IN THE DOCUMENT
// ---------------------------------------------------------------------------

test("accepting the offer answers with a way to collect the letter it just issued", async () => {
  const handler = portal();

  const answered = await call(handler, "/api/requests/uc03", {
    persona: "chris",
    text: TRIP,
    externalRef: "collect-e2e-1",
  });
  assert.equal(answered.body.decision, "auto_resolve");
  assert.equal(answered.body.letterOffer.offered, true, "the trip no longer offers a letter — re-point this test");

  const accepted = await call(handler, rooted(answered.body.letterOffer.accept.path), {
    persona: "chris",
    caseId: answered.body.letterOffer.caseId,
  });
  assert.equal(accepted.body.ok, true, accepted.body.reason);
  // THE PRECONDITION THIS TEST IS ABOUT. If accepting ever stops issuing and
  // goes back to drafting-for-a-signature, there is correctly nothing to
  // collect and the assertions below would be wrong to demand one — so the
  // state is asserted rather than assumed.
  assert.equal(accepted.body.letterIssued, true, "accepting no longer issues — the collect assertions below need re-thinking");

  // THE TWO FIELDS THE PANEL NEEDS, and neither existed on this response.
  assert.ok(accepted.body.recordId, "the accept response names no record to collect against");
  assert.ok(
    accepted.body.letterAccess && accepted.body.letterAccess.collect,
    "the accept response carries no way to collect the letter it just issued"
  );

  // AND THE ROUTE IT NAMES REALLY HANDS THE DOCUMENT OVER. A `collect` block
  // pointing at a path that 404s would satisfy every assertion above and leave
  // the reader exactly where they started, which is the failure this file
  // exists for — so the bytes are fetched.
  const letter = await call(handler, rooted(accepted.body.letterAccess.collect.path), {
    persona: "chris",
    caseId: accepted.body.recordId,
  });
  assert.equal(letter.status, 200, `collecting was refused: ${JSON.stringify(letter.body)}`);
  assert.equal(letter.body.ok, true);
  assert.ok(letter.body.content && letter.body.content.length > 500, "the collected letter is empty");
  assert.match(letter.body.content, /Spain|ES/, "the collected document is not about the trip that was asked");
});

test("the collect route the accept response names refuses somebody else, exactly as the gate does", async () => {
  // THE OFFER IS NOT A KEY. The new field hands the page a path and a record
  // id, and neither is an authorisation: `evaluateLetterDelivery()` decides,
  // against the reader's own server-held session. A second persona holding the
  // same two strings gets nothing.
  const handler = portal();
  const answered = await call(handler, "/api/requests/uc03", {
    persona: "chris",
    text: TRIP,
    externalRef: "collect-e2e-2",
  });
  const accepted = await call(handler, rooted(answered.body.letterOffer.accept.path), {
    persona: "chris",
    caseId: answered.body.letterOffer.caseId,
  });

  const stolen = await call(handler, rooted(accepted.body.letterAccess.collect.path), {
    persona: "emma",
    caseId: accepted.body.recordId,
  });
  assert.notEqual(stolen.status, 200, "another employee collected a letter about somebody else");
  assert.equal(stolen.body.ok, false);
  assert.ok(!stolen.body.content, "the refusal handed over the document anyway");
});

// ---------------------------------------------------------------------------
// 2. THE CONTROLS THEMSELVES — built, and pressable
// ---------------------------------------------------------------------------
// The same `node:vm` DOM sandbox test/portalUc03IssuedLetter.test.js uses. The
// assertion is on the BUTTONS: a panel can carry a correct heading, a correct
// sentence and a correct state and still be unpressable, which is precisely
// what it did.

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

/** letterCollectionControls(), lifted and run. */
function controlsFor(letter, recordId) {
  const start = APP.indexOf("  function letterCollectionControls(letter, recordId, status) {");
  const end = APP.indexOf("\n  }", start);
  assert.ok(start !== -1 && end > start, "letterCollectionControls() has moved — re-point this test");
  const ctx = { ...domSandbox(), COLLECTED: null, collectLetter() {}, showLetter() {}, saveLetter() {} };
  vm.createContext(ctx);
  vm.runInContext(APP.slice(start, end + 4), ctx);
  return vm.runInContext(
    `letterCollectionControls(${JSON.stringify(letter)}, ${JSON.stringify(recordId)}, {})`,
    ctx
  );
}

test("an issued letter builds two pressable controls, and each is wired to the fetch", () => {
  const buttons = controlsFor({ collect: { method: "POST", path: "api/requests/uc03/letter" } }, "case-1");
  const labels = buttons.childNodes.map((node) => node.textContent);
  assert.deepEqual([...labels], ["Open the letter", "Save it"], `the collect controls are ${labels.join(" | ")}`);
  for (const node of buttons.childNodes) {
    assert.equal(node.tag, "button", "a control that is not a button cannot be pressed");
    assert.ok((node.listeners.click || []).length === 1, `"${node.textContent}" is a button that does nothing`);
  }
});

test("the accept panel builds those controls from the server's verdict, and from no rule of its own", () => {
  // SOURCE-LEVEL, and the trade is the one test/portalRequesterFacts.test.js
  // states for the same function: lifting acceptLetterOffer() into the sandbox
  // means lifting its fetch, its dialog and its status element with it. What is
  // checked is the two properties that matter — that the controls are built at
  // all, and that whether they are built is the SERVER's answer.
  const start = APP.indexOf("  function acceptLetterOffer(offer, button, status, box) {");
  const end = APP.indexOf("  /** Ask the server for the continuation.", start);
  assert.ok(start !== -1 && end > start, "acceptLetterOffer() has moved — re-point this test");
  const body = APP.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  assert.match(
    body,
    /letterCollectionControls\(body\.letterAccess, body\.recordId, status\)/,
    "the accept panel announces an issued letter and offers no way to reach it"
  );
  assert.match(body, /body\.letterAccess && body\.letterAccess\.collect/, "the page decides for itself that a letter is collectable");

  // NO STATE WORD AND NO DECISION STRING. Whether there is anything to collect
  // is src/uc03/letterDelivery.js's verdict, relayed; a drafted letter yields
  // no `collect` and therefore no button, which is the sign-off gate working
  // rather than this page being polite about it.
  for (const forbidden of ["issued", "drafted", "auto_resolve", "standard_letter", "awaitingSignoff"]) {
    assert.ok(!body.includes(forbidden), `the accept panel decides "${forbidden}" for itself`);
  }
});

// ---------------------------------------------------------------------------
// 3. WHAT CAME OFF THE PANEL, AND WHY IT IS NOT A DELETION
// ---------------------------------------------------------------------------

test("the accept panel no longer restates the server's own sentence in our field names", () => {
  const app = APP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // "Letter drafted — yes" and "Waiting on a specialist signature — no",
  // printed directly beneath "Your travel letter has been written and issued …
  // no signature was needed". The same fact three times, twice in the names
  // src/uc03/workflow.js records it under. Both are still on the response and
  // in the specialist's ticket.
  assert.ok(!/label: "Letter drafted"/.test(app), "the panel prints `letterDrafted` at the traveller again");
  assert.ok(!/label: "Waiting on a specialist signature"/.test(app), "the panel prints `awaitingSignoff` at the traveller again");
});

test("a ticket nobody needed is no longer reported to the requester, and a failed hand-off still is", () => {
  const app = APP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // "No Zendesk ticket: this decision needs no human, so raising one would be
  // noise in a real queue." Our queue hygiene, on an employee's result.
  assert.ok(!/"No Zendesk ticket"/.test(app), "the requester is told again about a ticket we chose not to raise");
  // AND THE ABSENCE THAT IS THEIRS SURVIVES. A hand-off that FAILED means their
  // request may be sitting where nobody will see it — a limit on their own
  // request, which docs/UI-AUDIENCES.md §5 exempts from the deletion test.
  assert.match(app, /ticketError/, "a failed hand-off is no longer reported to the person whose request it was");
  assert.match(app, /"Not handed over"/, "a failed hand-off has no visible marker");
});

// ---------------------------------------------------------------------------
// 4. THE ORDER, AND THE PREMISE IT USED TO REST ON
// ---------------------------------------------------------------------------

test("a letter that exists outranks the offer to ask for one", () => {
  // The order used to be [continuation, offer, collection], justified by the
  // claim that the last two "cannot co-occur" and then by the conclusion that
  // if they ever did, the offer should win because the letter is "already
  // sitting in their hands". The premise holds today and is checked live in the
  // test below; the conclusion was wrong, and it is the one that would decide
  // what a reader sees. You do not ask somebody whether they would like a
  // document you have already written for them.
  const start = APP.indexOf("  function offersOn(payload) {");
  const end = APP.indexOf("\n  }", start);
  assert.ok(start !== -1 && end > start, "offersOn() has moved — re-point this test");
  const order = APP.slice(start, end).match(/\[(continuationOffer[^\]]*)\]/);
  assert.ok(order, "offersOn() no longer lists its builders in one array");
  const names = order[1].split(",").map((name) => name.trim());
  assert.deepEqual(names, ["continuationOffer", "letterCollection", "letterOffer"], `the priority order is ${names.join(" > ")}`);
});

test("the premise that pair rests on is checked against the server, not assumed", async () => {
  // A result carrying an issued letter must not ALSO offer to write one. This
  // is src/uc03/letterOffer.js's answer and this test is what would notice if
  // it changed — the comment in offersOn() states it as observed behaviour
  // rather than as a property of the page, and this is the observation.
  const answered = await call(portal(), "/api/requests/uc03", {
    persona: "chris",
    text: "I need a travel letter for my visa application for a conference in Germany from September 20 to September 26, 2026.",
    externalRef: "collect-premise-1",
  });
  assert.equal(answered.body.decision, "auto_resolve");
  assert.ok(answered.body.letter && answered.body.letter.collect, "this request no longer issues a letter — re-point this test");
  assert.equal(
    answered.body.letterOffer.offered,
    false,
    "a result carrying an issued letter is also offering to write one — offersOn()'s premise has changed"
  );
});
