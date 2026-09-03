// ---------------------------------------------------------------------------
// portalPlainAnswer.test.js  —  the answer is first, it is short, and it is true
// ---------------------------------------------------------------------------
// WHAT THIS IS PROTECTING
//
// A result panel used to open with a status chip and a decision string, then
// the gate ladder, then a facts table, then flags — and the answer to the
// question the person actually asked was somewhere inside it. src/portal/
// plainAnswer.js puts one or two sentences at the top instead.
//
// The defect that change can most easily introduce is a sentence that reads as
// a YES over a decision that was not one. `human_review` is not a yes and
// `escalate` is not a no, and a summary that blurs either is worse than the
// wall of machinery it replaced: a wall of machinery is unhelpful, and a
// confident wrong sentence is acted on. So the assertions below are mostly
// about what a summary may NEVER say, measured over every quick-fill on all
// seven forms driven through the real handlers.
//
// THEY PIN PROPERTIES, NOT PROSE — the rule test/portalCopy.test.js's header
// sets out. Copy gets rewritten; what must not come back is a summary that
// overstates, one that restates the paragraph directly beneath it, one that
// prints a country CODE at a reader, or one that runs to a paragraph.
//
// HERMETIC: every LLM seam is faked with the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom and the mock
// Remote is dispatched in-process, so this file binds no port and opens no
// socket.
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
import { countryLabel } from "../src/shared/countryNames.js";
import { nameableCountryCodes } from "../src/shared/countryNames.js";
import { handoffFor } from "../src/shared/escalationRouting.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, "..", "src", "portal", "assets");
const read = (file) => readFileSync(join(ASSETS, file), "utf8");

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

function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM });
}

/** Same in-process driver every other server suite in this repo uses. */
function call(handler, { method = "GET", path, body = null, headers = {} }) {
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

// ---------------------------------------------------------------------------
// DRIVING EVERY QUICK-FILL THE WAY THE BROWSER WOULD
// ---------------------------------------------------------------------------
// Both SCENARIOS and BUILDERS are lifted out of app.js and run in a `node:vm`
// sandbox, so the body posted here is the body the page posts — the same
// technique test/portalCopy.test.js and test/n8nParity.test.js use, and for the
// same reason: a test that restated a scenario's fields could never disagree
// with a scenario that had changed.
//
// The four form helpers are stubbed rather than lifted because they read the
// DOM and nothing under test depends on their reading it: `value`/`orNull`/
// `checked` answer out of the scenario's own field map, and `reference` mints a
// unique string so no submission is refused as a repeat delivery.

function liftBlock(opening) {
  const app = read("app.js");
  const start = app.indexOf(opening);
  const end = app.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, `${opening} has moved — re-point this test`);
  return app.slice(start, end + 4);
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
    reference: (typeId) => `${typeId}-plainanswer-${++refs}`,
    freshCopyOf: (expenseId) => expenseId,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBlock("  var SCENARIOS = {").replace("var SCENARIOS =", "SCENARIOS ="), ctx);
  vm.runInContext(liftBlock("  var BUILDERS = {").replace("var BUILDERS =", "BUILDERS ="), ctx);
  return ctx;
}

/**
 * Every quick-fill on every form, submitted once, with its response.
 *
 * One handler for the whole run, deliberately: a shared store is what the
 * browser has, and it is what makes the already-decided replays real.
 */
let DRIVEN = null;
async function driveEveryScenario() {
  // Memoised: forty-three real workflow runs is the expensive part of this file
  // and every test below asks the same question of the same answers.
  if (DRIVEN) return DRIVEN;
  const ctx = browserSandbox();
  const handler = portal();
  const results = [];
  for (const [typeId, list] of Object.entries(ctx.SCENARIOS)) {
    for (const scenario of list) {
      ctx.FIELDS = scenario.fields || {};
      const body = vm.runInContext(
        `BUILDERS[${JSON.stringify(typeId)}](${JSON.stringify(scenario.persona ?? "")})`,
        ctx
      );
      const res = await call(handler, { method: "POST", path: `/api/requests/${typeId}`, body });
      // `fields` is carried so a test can read what a scenario SAYS instead of
      // restating it — the same reason SCENARIOS is lifted out of app.js rather
      // than copied. It is the scenario's own data, not a second copy of it.
      results.push({
        typeId,
        id: scenario.id,
        label: scenario.label,
        fields: scenario.fields || {},
        status: res.status,
        payload: res.body || {},
      });
    }
  }
  assert.ok(results.length >= 40, `only ${results.length} quick-fills were driven — a form has lost its scenarios`);
  DRIVEN = results;
  return results;
}

/** Only the ones that reached a decision. A refusal renders no summary — see
 *  the test that says why. */
const decided = (results) => results.filter((r) => r.payload.ok === true);

function sentencesOf(text) {
  return String(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 1. EVERY DECIDED RESULT CARRIES ONE, AND IT IS SHORT
// ---------------------------------------------------------------------------

test("every decided result answers in at most two sentences", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const answer = r.payload.plainAnswer;
    const where = `${r.typeId}/${r.id}`;
    assert.ok(answer && typeof answer.lead === "string" && answer.lead.trim(), `${where} has no plain answer`);

    const lead = sentencesOf(answer.lead);
    const next = answer.next ? sentencesOf(answer.next) : [];
    assert.equal(lead.length, 1, `${where}'s lead is ${lead.length} sentences: ${answer.lead}`);
    assert.ok(next.length <= 1, `${where}'s follow-up is ${next.length} sentences: ${answer.next}`);
    assert.ok(
      lead.length + next.length <= 2,
      `${where} runs to ${lead.length + next.length} sentences — the summary has become the thing it replaced`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. IT NEVER OVERSTATES — the defect this change can most easily introduce
// ---------------------------------------------------------------------------
// A summary is one sentence long and sits above everything else on the panel,
// so it is the one thing a hurried reader is guaranteed to read. A "Yes" over a
// `human_review`, or a "No" over an approval, would be read and acted on.
//
// The assertions are on the OPENING WORD, because that is what a reader takes
// away: "Yes", "No", "Not yet", "Not decided here", "Not answered", "This is
// not a yes or a no".

const AFFIRMS = /^Yes\b/;
const REFUSES = /^No\b/;

test("only a decision that really finished in their favour opens with Yes", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const lead = r.payload.plainAnswer.lead;
    const where = `${r.typeId}/${r.id} (${r.payload.decision})`;
    if (AFFIRMS.test(lead)) {
      assert.ok(
        ["auto_approve", "auto_resolve"].includes(r.payload.decision),
        `${where} reads as a yes and was not one: ${lead}`
      );
      assert.notEqual(r.payload.executionPath, "none", `${where} reads as a yes on a use case that decides nothing`);
    }
  }
});

test("only a hard block opens with No, and an escalation never does", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const lead = r.payload.plainAnswer.lead;
    const where = `${r.typeId}/${r.id} (${r.payload.decision})`;
    if (REFUSES.test(lead)) {
      assert.equal(r.payload.decision, "blocked", `${where} reads as a refusal and was not one: ${lead}`);
    }
    if (r.payload.decision === "escalate" && r.payload.executionPath !== "none") {
      assert.ok(!REFUSES.test(lead), `${where} reads an escalation as a refusal: ${lead}`);
      assert.ok(!AFFIRMS.test(lead), `${where} reads an escalation as an answer: ${lead}`);
    }
  }
});

test("a request waiting on a person is never reported as decided, and names who has it", async () => {
  const waiting = ["human_review", "ready_for_approval", "prepared_for_signoff"];
  let seen = 0;
  for (const r of decided(await driveEveryScenario())) {
    if (!waiting.includes(r.payload.decision) || r.payload.executionPath === "none") continue;
    seen += 1;
    const { lead, shape } = r.payload.plainAnswer;
    const where = `${r.typeId}/${r.id} (${r.payload.decision})`;
    assert.equal(shape, "waiting", `${where} is not reported as waiting`);
    assert.ok(!AFFIRMS.test(lead) && !REFUSES.test(lead), `${where} reads as a decision: ${lead}`);
    // WHO, BY NAME, and out of the routing table rather than out of this
    // sentence. `handoffFor` picks the escalation team over the routine one
    // where a use case draws that line, so this also pins that the summary is
    // reading the same row the Zendesk hand-off is tagged from.
    const team = handoffFor({ useCase: r.payload.useCase, decision: r.payload.decision })?.group;
    assert.ok(team, `${where} has no route in the escalation table`);
    assert.ok(lead.includes(team), `${where} does not name ${team}, the team that has it: ${lead}`);
  }
  assert.ok(seen >= 8, `only ${seen} waiting outcomes were exercised`);
});

// ---------------------------------------------------------------------------
// 3. THE 🔴 GUARANTEE, WHICH THIS SUMMARY INHERITED
// ---------------------------------------------------------------------------
// nextStep() used to carry it: "Nothing here approves this request, and nothing
// anywhere does." That sentence was keyed on `executionPath` alone, which is why
// it could also print "a specialist decides it" over an expense that had already
// been approved at Remote with nobody involved. The guarantee moved; it did not
// go.

test("a dossier says plainly that nothing approves it, here or anywhere", async () => {
  let seen = 0;
  for (const r of decided(await driveEveryScenario())) {
    if (r.payload.executionPath !== "none") continue;
    seen += 1;
    const { lead, next, shape } = r.payload.plainAnswer;
    const where = `${r.typeId}/${r.id}`;
    assert.equal(shape, "compiled", `${where} is not reported as a compiled dossier`);
    assert.ok(!AFFIRMS.test(lead) && !REFUSES.test(lead), `${where} reads as a decision: ${lead}`);
    assert.match(next ?? "", /here or anywhere else in this system/, `${where} dropped the no-execution-path guarantee`);
  }
  assert.ok(seen >= 5, `only ${seen} dossier outcomes were exercised`);
});

// ---------------------------------------------------------------------------
// 4. IT DOES NOT SAY WHAT THE SECTION BELOW IT SAYS
// ---------------------------------------------------------------------------
// The paragraph directly under the summary is the deciding gate's `means` — the
// system's account of WHY. The summary is the answer for the person. A heading
// that says the thing followed by prose that says it again is the defect three
// other changes on this repository were made to remove, and this is the place
// it would come back.

test("no summary repeats the deciding gate's sentence, or a row of the facts table", async () => {
  for (const r of decided(await driveEveryScenario())) {
    const { lead, next } = r.payload.plainAnswer;
    const where = `${r.typeId}/${r.id}`;
    const summary = [lead, next].filter(Boolean).join(" ");

    const means = r.payload.decidedBy?.means;
    if (means) {
      assert.ok(!summary.includes(means), `${where} reprints the deciding gate's sentence`);
      assert.ok(!means.includes(lead), `${where}'s lead is a clause of the gate's own sentence`);
    }
    for (const row of r.payload.details ?? []) {
      const value = String(row.value ?? "");
      if (value.length < 25) continue; // ids, numbers and single words are not prose
      assert.ok(!summary.includes(value), `${where} reprints the "${row.label}" row`);
    }
    // The tracking pointer at the foot of the same panel. It used to open "A
    // person now has to decide this", which is what the summary now says.
    const tracking = r.payload.tracking?.sentence ?? "";
    assert.ok(!/person now has to decide/.test(tracking), `${where}'s tracking line still restates the summary`);
  }
});

// ---------------------------------------------------------------------------
// 5. COUNTRIES ARE NAMED, NEVER CODED
// ---------------------------------------------------------------------------
// "instead of using country codes like PT, use the country's full name — you
// can use codes inside the code, not on the UI" (src/shared/countryNames.js's
// own header). A summary is UI, and it is the most-read line on the panel.

test("a summary names its country and never prints the code", async () => {
  const codes = new Set(nameableCountryCodes());
  let named = 0;
  for (const r of decided(await driveEveryScenario())) {
    const where = `${r.typeId}/${r.id}`;
    // THE TEAM NAME COMES OUT FIRST, and finding out why is the reason this
    // test earns its place: "HR Ops" contains `HR`, which is Croatia. A scan
    // that did not strip the routing table's own names would fail on every
    // UC-05 sign-off and teach the next person to weaken the assertion.
    const team = handoffFor({ useCase: r.payload.useCase, decision: r.payload.decision })?.group ?? "";
    const summary = [r.payload.plainAnswer.lead, r.payload.plainAnswer.next]
      .filter(Boolean)
      .join(" ")
      .split(team || "\u0000")
      .join(" ");
    // What is left: a bare two-letter capitalised token that is a real country
    // code. Every one of these sentences is ordinary prose, so any such token is
    // a code that escaped the naming.
    for (const token of summary.match(/\b[A-Z]{2}\b/g) ?? []) {
      assert.ok(!codes.has(token), `${where} prints the country code ${token}: ${summary}`);
    }
    if (r.payload.subjectCountry || r.payload.letterOffer?.carries?.destinationCountry) named += 1;
  }
  assert.ok(named >= 10, `only ${named} results carried a country at all — the fixture set has changed`);
});

test("the country a UC-03 answer is about reaches the summary by name", async () => {
  // THE EXPECTED NAME IS DERIVED FROM THE SCENARIO, NOT RESTATED. This test
  // hard-coded /Spain/ and /Portugal/, so moving the quick-fills onto the demo
  // countries (2026-08-30) failed it with "the answered trip does not name its
  // destination" — while the answer under test said "the Netherlands" perfectly
  // correctly. A test that restates a value it could read cannot tell a
  // regression from a deliberate change, and blames the wrong one.
  const results = await driveEveryScenario();

  const trip = results.find((r) => r.id === "uc03-trip");
  assert.ok(trip, "the short-business-trip quick-fill has gone");
  const tripCountry = countryLabel(trip.fields["uc03-destinationCountry"]);
  assert.ok(tripCountry, "the quick-fill names no destination to check against");
  assert.ok(
    trip.payload.plainAnswer.lead.includes(tripCountry),
    `the answered trip does not name its destination (${tripCountry}): ${trip.payload.plainAnswer.lead}`
  );

  const workation = results.find((r) => r.id === "uc03-workation");
  assert.ok(workation, "the workation quick-fill has gone");
  assert.equal(workation.payload.plainAnswer.shape, "redirected");
  const workationCountry = countryLabel(workation.fields["uc03-destinationCountry"]);
  assert.ok(
    workation.payload.plainAnswer.lead.includes(workationCountry),
    `the routed trip does not name its destination (${workationCountry}): ${workation.payload.plainAnswer.lead}`
  );
});

// ---------------------------------------------------------------------------
// 5b. ROUND-6 D-04 — a request that never read as travel is not called one
// ---------------------------------------------------------------------------
// The employee wrote, verbatim, "I'm not travelling and this isn't for a visa
// or a border check" on a landlord letter, and was answered "your travel
// question … could not be judged automatically" — the classifier's own escape
// hatch (`nonTravelSignal`) is what tells this branch apart from an ordinary
// unreadable trip.

test("D-04: an escalation the classifier flagged as possibly not travel is never called a travel question", () => {
  const a = plainAnswer({
    useCase: "UC-03",
    decision: "escalate",
    executionPath: "auto",
    reason: "destination_unknown",
    flags: ["destination_unknown", "possible_non_travel_request"],
  });
  assert.equal(a.shape, "escalated");
  assert.ok(!/travel question/i.test(a.lead), `still calls it a travel question: ${a.lead}`);
  assert.match(a.lead, /didn.t read as a travel request/i);
  // THE THING THE EMPLOYEE ACTUALLY NEEDED (FINDINGS.md §10): a pointer to the
  // instant self-service letter, in case that is what this was.
  assert.match(a.next, /employment verification letter/i);
});

test("D-04: an ordinary unreadable trip — no non-travel signal — keeps its original sentence", () => {
  const a = plainAnswer({
    useCase: "UC-03",
    decision: "escalate",
    executionPath: "auto",
    reason: "destination_unknown",
    flags: ["destination_unknown"],
  });
  assert.match(a.lead, /travel question/i, `lost the ordinary wording: ${a.lead}`);
  assert.equal(a.next, null);
});

test("D-04 END TO END: the actual landlord letter from round 6, posted to the real UC-03 route", async () => {
  const handler = portal();
  const res = await call(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: {
      persona: "chris",
      text:
        "Hi — my landlord won't sign my lease until he has something in writing from my employer saying I " +
        "actually work here. Could you send me a letter confirming my employment? He needs it to say that " +
        "I'm employed by you, my job title, that I'm full-time, and my start date. It is for a rental " +
        "application — I'm not travelling and this isn't for a visa or a border check.",
      externalRef: "d04-landlord-letter",
    },
  });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.decision, "escalate");
  assert.equal(res.body.reason, "destination_unknown");
  assert.ok(res.body.flags.includes("possible_non_travel_request"), `flags were: ${res.body.flags}`);
  assert.ok(!/travel question/i.test(res.body.plainAnswer.lead), `still calls it a travel question: ${res.body.plainAnswer.lead}`);
  assert.match(res.body.plainAnswer.next, /employment verification letter/i);
});

// ---------------------------------------------------------------------------
// 6. THE ONE SENTENCE THAT MUST NOT BE WRITTEN FROM A REASON
// ---------------------------------------------------------------------------
// The refusal lead said "<country> is blocked outright" in its first draft, and
// that is false on three of UC-04's four hard blocks: `same_country_workation`
// refuses because home and destination match, and `schengen_90_180_exceeded`
// refuses on a day count. Spain is not blocked in either case. A fabricated
// jurisdiction finding sitting above the real reason is exactly the kind of
// confident wrong sentence this whole file exists to catch.

test("a refusal names what was refused, and never claims the country itself is blocked", async () => {
  let seen = 0;
  for (const r of decided(await driveEveryScenario())) {
    if (r.payload.decision !== "blocked") continue;
    seen += 1;
    const lead = r.payload.plainAnswer.lead;
    assert.ok(
      !/\bis blocked\b/.test(lead),
      `${r.typeId}/${r.id} states a jurisdiction finding the decision did not make: ${lead}`
    );
    assert.match(lead, /refused/, `${r.typeId}/${r.id} does not say the request was refused: ${lead}`);
  }
  assert.ok(seen >= 3, `only ${seen} hard blocks were exercised`);
});

// ---------------------------------------------------------------------------
// 7. A REFUSED SUBMISSION GETS NO SUMMARY, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// An intake refusal already IS one plain sentence — "An expense is filed by the
// employee it belongs to, not by an admin." — rendered directly under the word
// "Refused". A summary above it would be the same thing said twice, which is
// the rule this change is written against. So there is deliberately none.

test("an intake refusal carries no summary, because its reason already is one", async () => {
  const refused = (await driveEveryScenario()).filter((r) => r.payload.ok !== true);
  assert.ok(refused.length >= 3, "no intake refusals were exercised");
  for (const r of refused) {
    assert.equal(r.payload.plainAnswer, undefined, `${r.typeId}/${r.id} renders a summary over a refusal`);
    assert.ok(String(r.payload.reason || "").trim(), `${r.typeId}/${r.id} refuses with no sentence at all`);
  }
});

// ---------------------------------------------------------------------------
// 8. THE PAGE RENDERS IT AND DECIDES NOTHING ABOUT IT
// ---------------------------------------------------------------------------

test("the browser prints the summary it is given and holds no wording of its own", () => {
  const app = read("app.js");
  const start = app.indexOf("function plainAnswerBlock(");
  const end = app.indexOf("function shortId(", start);
  assert.ok(start !== -1 && end > start, "plainAnswerBlock() has moved — re-point this test");
  const body = app.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // No decision string, no shape word, no country. Every one of those would be
  // a second place the answer is written.
  for (const forbidden of [
    "auto_resolve",
    "auto_approve",
    "human_review",
    "escalate",
    "blocked",
    "route_to_uc04",
    "Yes",
    "No —",
    "specialist",
  ]) {
    assert.ok(!body.includes(forbidden), `plainAnswerBlock() contains "${forbidden}" — the page is writing the answer`);
  }
  // Text only. A request body on this page is text a person typed.
  assert.ok(!body.includes("innerHTML"), "plainAnswerBlock() writes markup");
});

test("the summary is rendered above the promoted offer, so a dismissed modal lands beside it", () => {
  const app = read("app.js");
  const summary = app.indexOf("var answerBlock = plainAnswerBlock(payload);");
  const offers = app.indexOf("var offers = offersOn(payload);");
  const reference = app.indexOf("if (sentRef) wrap.appendChild(referenceLine(sentRef));");
  assert.ok(summary !== -1 && offers !== -1 && reference !== -1, "render() has been restructured — re-point this test");
  assert.ok(summary < offers, "an offer is appended above the answer");
  assert.ok(summary < reference, "the reference line is appended above the answer");

  // AND IT LEADS THE DIALOG THAT RESULT OPENS WITH. The same ordering, one
  // level up: the answer is the first block in the modal and the offer — when
  // there is one — is the recommendation under it. The reason the two orderings
  // must agree is dismissal: closing the dialog puts each block back where it
  // was, so a dialog that read answer-then-offer and a panel that read
  // offer-then-answer would reorder themselves in front of the reader.
  const dialog = app.indexOf("presentResultDialog([answerBlock, interstitial])");
  assert.ok(dialog !== -1, "render() no longer opens the result dialog — re-point this test");
  assert.ok(dialog > reference, "the dialog must be opened only once the whole panel is built");
});

test("the answer's sentence is the accessible name of the dialog, and it is a heading", () => {
  // THE ACCESSIBLE NAME CHANGED HANDS, and this is the assertion that says so.
  // fef494b's dialog was named by the OFFER's heading, which was right while the
  // offer was the only thing in it. It is now named by the answer, because a
  // dialog is named by what it is about and this one is about what happened to
  // their request. The name is the element rather than a copy of its text, so
  // the visible title and the accessible name cannot drift apart.
  const app = read("app.js");
  const block = app.slice(app.indexOf("function plainAnswerBlock("), app.indexOf("function shortId("));
  assert.match(block, /el\("h3", "plain-answer-lead", answer\.lead\)/, "the answer's sentence is not a heading");
  assert.match(block, /lead\.id = ANSWER_TITLE_ID;/, "the answer's heading carries no id for the dialog to point at");

  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.match(code, /var title = live\[0\]\.querySelector\("\.plain-answer-lead, \.interstitial-title"\);/);
  assert.match(code, /dialog\.setAttribute\("aria-labelledby", title\.id\)/);

  // Still no wording of its own: a heading is a tag, not a sentence.
  const body = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/"[A-Z][a-z]+ [a-z]/.test(body), `plainAnswerBlock() has grown a sentence of its own: ${body}`);
});

test("nextStep() is gone, and both facts it carried survive", () => {
  const app = read("app.js");
  assert.ok(!/function nextStep\(/.test(app), "nextStep() is back — it cannot tell an auto-approval from a hand-off");

  // Its 🔴 guarantee, now written where the decision is known.
  const answer = plainAnswer({
    useCase: "UC-08",
    decision: "escalate",
    executionPath: "none",
    recordLabel: "Dossier",
  });
  assert.match(answer.next ?? "", /here or anywhere else in this system/);

  // And the case it got wrong: an auto-approval is no longer told a specialist
  // will decide it.
  const approved = plainAnswer({
    useCase: "UC-02",
    decision: "auto_approve",
    executionPath: "auto",
    recordLabel: "Expense record",
  });
  assert.match(approved.lead, /^Yes\b/);
  assert.ok(!/specialist/.test(`${approved.lead} ${approved.next ?? ""}`));
});

// ---------------------------------------------------------------------------
// 9. THE MODULE'S OWN FAIL-CLOSED DIRECTION
// ---------------------------------------------------------------------------

test("a decision this module does not recognise is never reported as an answer", () => {
  for (const decision of ["", null, undefined, "some_new_verdict", "APPROVED"]) {
    const answer = plainAnswer({
      useCase: "UC-04",
      decision,
      executionPath: "single_approver",
      recordLabel: "Work authorization request",
    });
    assert.equal(answer.shape, "escalated", `"${decision}" was not treated as an escalation`);
    assert.ok(!AFFIRMS.test(answer.lead), `"${decision}" produced a yes: ${answer.lead}`);
    assert.ok(!REFUSES.test(answer.lead), `"${decision}" produced a refusal: ${answer.lead}`);
  }
});

test("a country with no name in the list is printed as its code, never invented and never dropped", () => {
  // countryLabel()'s own documented rule, and it is the right one even in
  // prose: Kosovo's `XK` is the live case, and a reader served "this request
  // was refused" with the destination silently removed has been told LESS about
  // which request than one served "for XK", which they can go and look up. What
  // must never happen is a name being made up for it.
  const unnameable = plainAnswer({
    useCase: "UC-04",
    decision: "blocked",
    executionPath: "single_approver",
    recordLabel: "Work authorization request",
    placeCode: "zz",
  });
  assert.match(unnameable.lead, /for ZZ,/, `an unnameable code was dropped or renamed: ${unnameable.lead}`);
  assert.match(unnameable.lead, /^No\b/);

  // And no code at all still drops the clause rather than printing a blank.
  const nowhere = plainAnswer({
    useCase: "UC-04",
    decision: "blocked",
    executionPath: "single_approver",
    recordLabel: "Work authorization request",
  });
  assert.ok(!/for ,|for undefined|for null/.test(nowhere.lead), nowhere.lead);
});

test("the names that take a definite article get one", () => {
  const say = (code) =>
    plainAnswer({
      useCase: "UC-04",
      decision: "ready_for_approval",
      executionPath: "single_approver",
      recordLabel: "Work authorization request",
      placeCode: code,
    }).lead;

  // The two of this project's four demo countries that need it, and the two
  // that must not get one.
  assert.match(say("US"), /from the United States\b/);
  assert.match(say("NL"), /from the Netherlands\b/);
  assert.match(say("PT"), /from Portugal\b/);
  assert.match(say("CA"), /from Canada\b/);
  // The word-boundary cases the pattern would fail on if it were a substring
  // match: none of these is an island group.
  for (const code of ["IS", "IE", "FI", "GL", "TH"]) {
    assert.ok(!/from the /.test(say(code)), `${code} was given an article it does not take: ${say(code)}`);
  }
});

// ---------------------------------------------------------------------------
// A ROUTED QUESTION IS STILL ANSWERED, AND THE ANSWER IS NOT OUR TAXONOMY
// ---------------------------------------------------------------------------
// Reported against the live portal. Someone wrote "I'd like to work remotely
// from Portugal for a month while on holiday — can I do my normal job from
// there?" and the pop-up replied "Not answered — this was read as working from
// Portugal rather than travelling there, and that is a different request from a
// business trip."
//
// Every clause of that is about us: what we read, how we classify, which of our
// request types theirs is not. It also says "not answered" when something WAS
// answered — that working abroad needs permission first — which is the one
// thing the person can act on.
//
// These pin the shape rather than the sentence, so a future rewrite is free to
// change the words and not free to go back to describing the pipeline.
test("a routed travel question is answered, not filed", () => {
  const { lead } = plainAnswer({
    useCase: "UC-03",
    decision: "route_to_uc04",
    reason: "work_authorization_requested",
    placeCode: "PT",
  });

  assert.doesNotMatch(lead, /^Not answered/i, `the answer opens by refusing to answer: ${lead}`);
  // Our own reading, our own categories, our own request types — none of it is
  // the reader's business and none of it tells them what to do.
  for (const ourVocabulary of [
    /this was read as/i,
    /a different request from/i,
    /business trip/i,
    /UC-0\d/,
    /route_to/,
    /classif/i,
  ]) {
    assert.doesNotMatch(lead, ourVocabulary, `the answer describes our pipeline: ${lead}`);
  }

  // It must answer the question that was asked — working abroad needs
  // permission — and it must name the place, because "another country" is
  // vaguer than what they told us.
  assert.match(lead, /permission/i, `the answer never says permission is needed: ${lead}`);
  assert.match(lead, /Portugal/, `the answer does not name the country they asked about: ${lead}`);

  // AND IT MUST NOT PROMISE ONE. This router decides nothing about
  // eligibility; the next stage refuses some destinations outright. "You need
  // permission" read as "you have it" is the worst outcome available here.
});

test("a routed answer qualifies itself without promising an outcome", () => {
  // The qualifier lives in `next`, not in `lead` — the lead is one sentence by
  // this module's own invariant, and the reader is guaranteed to read it. But
  // it MUST be somewhere: "you need permission" read as "you have it" is the
  // worst outcome available on this screen, and this router decides nothing
  // about eligibility — the next stage refuses some destinations outright.
  const { next } = plainAnswer({
    useCase: "UC-03",
    decision: "route_to_uc04",
    reason: "work_authorization_requested",
    placeCode: "PT",
  });
  assert.match(next ?? "", /not been decided/i, `nothing says the decision is still open: ${next}`);
  assert.doesNotMatch(next ?? "", /\bwill be (approved|allowed|granted)\b/i, `the follow-up promises an outcome: ${next}`);
});

// ---------------------------------------------------------------------------
// 10. A REFUSAL SAYS WHICH WALL IT IS, AND WHO — IF ANYONE — CAN MOVE IT
// ---------------------------------------------------------------------------
// The project owner filed a UC-04 request for Portugal and got, in full:
//
//   "No — this request, for Portugal, was refused outright, and nothing was
//    sent to Remote."
//   "Nothing is waiting on anybody: a hard block is never put in a queue for a
//    person to overturn."
//
// "why was this refused tell the user."
//
// The cause was structural. This branch composed from the decision CLASS, and
// `blocked` is one class over three outcomes whose next actions are opposites:
// nobody can lift a sanctioned destination, the EMPLOYER lifts a missing
// workation permission, and the REQUESTER fixes a malformed field themselves,
// on the form in front of them, without a queue or a person. On the third the
// second sentence was not merely unhelpful but false as the reader would hear
// it.
//
// SO THE ASSERTION THAT MATTERS IS DISTINGUISHABILITY, and it is the one
// written first below: the failure being fixed is precisely that all three read
// identically, and a test that only checked each sentence in isolation would
// pass against three copies of the same sentence.

const refusal = (reason, extra = {}) =>
  plainAnswer({
    useCase: "UC-04",
    decision: "blocked",
    executionPath: "full",
    reason,
    placeCode: "PT",
    ...extra,
  });

const whole = (a) => [a.lead, a.next].filter(Boolean).join(" ");

const THE_THREE = ["sanctioned_region", "employer_permission_not_granted", "factors_invalid"];

test("the three UC-04 hard blocks are told apart, which is the whole of the defect", () => {
  const answers = THE_THREE.map((r) => ({ r, a: refusal(r) }));
  for (const { r, a } of answers) {
    assert.equal(a.shape, "refused", `${r} stopped being a refusal`);
    assert.match(a.lead, /refused/, `${r} does not say the request was refused: ${a.lead}`);
    assert.match(a.lead, /Portugal/, `${r} lost the place the request was about`);
  }
  for (const a of answers) {
    for (const b of answers) {
      if (a.r === b.r) continue;
      assert.notEqual(a.a.lead, b.a.lead, `${a.r} and ${b.r} answer with the same sentence`);
      assert.notEqual(a.a.next, b.a.next, `${a.r} and ${b.r} propose the same next step`);
    }
  }
  // And none of them is the sentence that prompted the report.
  for (const { r, a } of answers) {
    assert.ok(!/refused outright/.test(a.lead), `${r} still gives the class's sentence: ${a.lead}`);
    assert.ok(
      !/hard block is never put in a queue/.test(a.next ?? ""),
      `${r} still gives the class's follow-up: ${a.next}`
    );
  }
});

test("a sanctioned destination names the list, and keeps saying nothing changes it", () => {
  const a = refusal("sanctioned_region");
  assert.match(a.lead, /sanctioned or restricted list/, `it does not say why: ${a.lead}`);
  // THE HALF THAT MUST SURVIVE EVERY REWRITE. Softening this into an
  // encouraging vagueness would be worse than the sentence it replaced: this is
  // the one refusal where "there is nobody to ask" is the true and useful
  // answer, and a reader who goes looking for an appeal wastes a day.
  assert.match(a.next, /nobody to ask/i, `the no-recourse statement is gone: ${a.next}`);
  assert.match(a.next, /no approval here can grant it/i);
  // It must not offer the recourse the other two do.
  assert.ok(!/submit it again|correct/i.test(a.next.replace(/nothing to correct/i, "")));
});

test("a missing employer permission names the employer, and promises nothing", () => {
  const a = refusal("employer_permission_not_granted");
  assert.match(a.lead, /employer/i, `it does not name the party who can change it: ${a.lead}`);
  assert.match(a.next, /employer sets that permission/i);
  // THE OVERSTATEMENT THIS MUST NEVER BECOME. Permission is the precondition,
  // not the decision — gate 4 refuses before the destination or the dates are
  // looked at at all, so there is no favourable finding waiting behind it.
  assert.match(a.next, /assessable, not approved/i, `it reads as a promise of approval: ${a.next}`);
  assert.ok(
    !/will be (approved|granted)/i.test(whole(a)),
    `it tells the reader the trip will be approved once permission is set: ${whole(a)}`
  );
});

test("unreadable details name the boxes, and say no person has to overturn it", () => {
  const a = refusal("factors_invalid", {
    flags: [
      "factors_invalid",
      "missing_home_country",
      "missing_nationality",
      "invalid_visa_type",
      "invalid_job_duties",
    ],
  });
  // The fields, in the form's own labels — a requester told "some of your
  // details could not be read" still cannot act.
  for (const box of ["Home country", "Nationality", "Visa / permit", "Duties while abroad"]) {
    assert.ok(a.lead.includes(box), `the refusal does not name the "${box}" box: ${a.lead}`);
  }
  // THE SENTENCE THAT WAS ACTIVELY FALSE. "a hard block is never put in a queue
  // for a person to overturn" is true and it told the reader there was nothing
  // to do; the fix needs neither a queue nor a person, it needs one field.
  assert.match(a.next, /not a refusal a person has to overturn/i);
  assert.match(a.next, /submit it again/i);
  assert.ok(!/nobody to ask/i.test(a.next), "it borrows the sanctioned refusal's dead end");
});

test("without the flags the same refusal degrades honestly rather than inventing fields", () => {
  const a = refusal("factors_invalid");
  assert.match(a.lead, /details it needs could not be read/);
  assert.ok(!/Home country|Visa \/ permit/.test(a.lead), "it named a field nothing told it about");
  // It still carries the thing the reader most needs: they can fix this.
  assert.match(a.next, /not a refusal a person has to overturn/i);
  assert.match(a.next, /submit it again/i);
});

test("a flag outside the factor table never reaches the sentence", () => {
  const a = refusal("factors_invalid", {
    flags: ["factors_invalid", "pe_risk_dape", "schengen_overstay", "missing_home_country"],
  });
  assert.ok(a.lead.includes("Home country"));
  assert.ok(!/pe_risk|schengen_overstay|_/.test(a.lead), `a raw flag reached the reader: ${a.lead}`);
});

test("no refusal names a team, because on a hard block there is no who", () => {
  // Rule 2 of this module's header: the who comes from
  // src/shared/escalationRouting.js, never from a name typed here — and the
  // whole point of these sentences is that nobody is holding the request.
  const TEAMS = /Mobility Legal|Mobility Specialists|Travel & Mobility|HR Ops|Finance Ops|Local HR/i;
  for (const reason of [
    ...THE_THREE,
    "same_country_workation",
    "visitor_visa_active_work_forbidden",
    "us_requires_work_permit",
    "ca_requires_work_permit",
    "schengen_90_180_exceeded",
    "invalid_date",
    "end_before_start",
    "start_in_past",
    "travel_history_unreadable",
  ]) {
    const a = refusal(reason);
    assert.ok(!TEAMS.test(whole(a)), `${reason} hand-types a team name: ${whole(a)}`);
    // And every one of them is still at most two sentences.
    assert.equal(sentencesOf(a.lead).length, 1, `${reason}'s lead is more than a sentence: ${a.lead}`);
    assert.equal(sentencesOf(a.next).length, 1, `${reason}'s follow-up is more than a sentence: ${a.next}`);
  }
});

test("a reason with no row keeps the sentence it always had", () => {
  // UC-02's two hard blocks, and UC-04's `risk_matrix_blocked`, have no row and
  // must not acquire one by accident. The fallback is correct wherever it is
  // reached and it is the safe direction — a refusal described in general terms
  // is unhelpful; one described wrongly is acted on.
  for (const [useCase, reason] of [
    ["UC-02", "duplicate_submission"],
    ["UC-02", "expense_not_pending"],
    ["UC-04", "risk_matrix_blocked"],
  ]) {
    const a = plainAnswer({ useCase, decision: "blocked", executionPath: "full", reason });
    assert.match(a.lead, /was refused outright, and nothing was sent to Remote/);
    assert.match(a.next, /hard block is never put in a queue/);
  }
});

test("the refusals a requester can actually reach on the portal name their reason", async () => {
  const results = await driveEveryScenario();
  const permission = results.find((r) => r.id === "uc04-no-permission");
  assert.ok(permission, "the no-permission quick-fill has gone");
  assert.equal(permission.payload.reason, "employer_permission_not_granted");
  assert.match(permission.payload.plainAnswer.lead, /employer/i);

  const sanctioned = results.find((r) => r.id === "uc04-sanctioned");
  assert.ok(sanctioned, "the sanctioned-destination quick-fill has gone");
  assert.equal(sanctioned.payload.reason, "sanctioned_region");
  assert.match(sanctioned.payload.plainAnswer.lead, /sanctioned or restricted list/);

  const same = results.find((r) => r.id === "uc04-same");
  assert.ok(same, "the same-country quick-fill has gone");
  assert.equal(same.payload.reason, "same_country_workation");
  assert.match(same.payload.plainAnswer.lead, /already works from/);

  // None of the three now reads as the others, on the real driven output.
  const leads = [permission, sanctioned, same].map((r) => r.payload.plainAnswer.lead);
  assert.equal(new Set(leads).size, 3, "two live refusals still read identically");
});
