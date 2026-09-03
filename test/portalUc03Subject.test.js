// ---------------------------------------------------------------------------
// portalUc03Subject.test.js — "i was chris lee, and became admin instantly"
// ---------------------------------------------------------------------------
// THE REPORT, in the project owner's own words, having taken the UC-03 routing
// through to the work-authorization form:
//
//   "i got to this page from uc-03, and now i am finding it hard to fill in the
//    right things that will make this page be a success… i don't know the right
//    combination of visa or dates to make this a success, also i noticed i was
//    chris lee in uc-03 and became admin instantly i was redirected to uc-04."
//
// WHAT WAS ACTUALLY WRONG, AND IT IS NOT WHAT IT LOOKED LIKE. The obvious
// reading is that the subject was dropped — that the request stopped being
// about Chris when the session moved to the company admin, which is the only
// persona in src/portal/personas.js with no employment record at all. Driven
// against the real handler, that reading is false and section 1 is what
// establishes it: the continuation's FIRST prefill is `uc04-employmentId`
// carrying Chris's own employment id, marked `authority: "record"`, and the
// destination comes with it. Nothing was lost in the hand-over.
//
// WHAT WAS LOST WAS THE PERSON. An id carried; an id is not somebody's name.
// The form showed `8ab12460-b568-4c1e-af9d-09b1fabd8f46` in a box while the
// sidebar showed a different human being, and no third thing on the screen said
// the two belonged to one request. A hand-over that kept every promise it made
// looked, to the person reading it, like one that had lost him — and a reader
// who has just been silently swapped reads every empty box afterwards as a
// puzzle rather than as a question, which is the rest of the report.
//
// SO THE FIXES ARE BOTH PRESENTATION, and no gate, decision or carried value is
// touched by any of them:
//   * the change of session is said BEFORE the redirect, on the offer the
//     employee presses (section 2);
//   * the banner they land on names whose trip it is (section 3);
//   * the box holding the id wears the name beside it (section 4).
//
// AND THE THIRD COMPLAINT IS ANSWERED BY MEASUREMENT, NOT BY BUILDING. "I don't
// know the right combination" reads as a missing feature; section 5 drives
// UC-04's own quick-fills through the real handler and shows that several of
// them already succeed. What was missing was not a scenario — it was any reason
// to believe the form was still about him.
//
// HERMETIC: the mock Remote is dispatched in-process, LLM seams are forced into
// their unconfigured branch, no socket is bound.
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
// The roster EXACTLY as the browser is given it — `listPersonas()` is what
// GET /api/context serves, so this test's `context.personas` is the real thing
// rather than a shape written here to match.
import { listPersonas } from "../src/portal/personas.js";
import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(join(__dirname, "..", "src", "portal", "assets", "app.js"), "utf8");

const unconfigured = { isConfigured: () => false };
const LLM = {
  classifyTravel: classifyTravelInquiryRuleBased,
  draftSummary: (args) => draftSummary(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

const PERSONAS = listPersonas();

const WORKATION =
  "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?";

function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM });
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

/** Chris asks about a workation, then presses "continue". */
async function continued(handler, ref) {
  const answered = await call(handler, "/api/requests/uc03", { persona: "chris", text: WORKATION, externalRef: ref });
  assert.equal(answered.body.decision, "route_to_uc04", "this request no longer routes — re-point this test");
  const cont = await call(handler, "/api/requests/uc03/continue", {
    persona: "chris",
    caseId: answered.body.recordId,
  });
  assert.equal(cont.body.ok, true, cont.body.reason);
  return cont.body;
}

const prefillOf = (data, field) => (data.prefill || []).filter((item) => item.field === field)[0];

// ---------------------------------------------------------------------------
// 1. THE SUBJECT SURVIVES THE HAND-OVER — the reading that had to be checked
// ---------------------------------------------------------------------------

test("the continuation carries the employee who asked, as the subject of the next form", async () => {
  const data = await continued(portal(), "subject-1");

  const chris = PERSONAS.find((p) => p.id === "chris");
  assert.ok(chris && chris.employmentId, "the persona roster has changed — re-point this test");

  const subject = prefillOf(data, "uc04-employmentId");
  assert.ok(subject, "the continuation carries no subject employment at all");
  assert.equal(subject.value, chris.employmentId, "the next form is about somebody other than the person who asked");
  // FROM THE RECORD, NOT FROM A READING. The distinction is the server's own
  // and it decides whether the box is marked "check it": a classifier's guess
  // at a country is a reading, the employment the request was filed under is a
  // fact.
  assert.equal(subject.authority, "record");

  // AND THE COMPANY ADMIN IS THE ONLY PERSONA WITH NO EMPLOYMENT, which is why
  // "the session became admin" reads as "the subject was dropped" and is not.
  const admin = PERSONAS.find((p) => p.kind === "company_admin");
  assert.ok(admin && !admin.employmentId, "the admin persona now has an employment — this test's premise has moved");
});

test("the trip carries too, and a value the request never stated arrives empty rather than invented", async () => {
  const data = await continued(portal(), "subject-2");

  const destination = prefillOf(data, "uc04-destinationCountry");
  assert.ok(destination, "the continuation carries no destination");
  assert.equal(destination.value, "PT", "the destination the traveller asked about did not carry across");
  assert.equal(destination.authority, "reading", "a classifier's reading is being presented as a record");

  // THE EMPTY DATE BOXES THE OWNER MET, AND WHY THEY ARE CORRECT HERE. This
  // request's own words are "for a month while on holiday" — no dates in it at
  // all. The continuation carries what was read and refuses to invent the rest,
  // and the same absence is named in `stillNeeded` so the form can mark the two
  // boxes rather than leaving them to be discovered. A carried date on this
  // request would be a date nobody stated.
  for (const field of ["uc04-startDate", "uc04-endDate"]) {
    const carried = prefillOf(data, field);
    assert.ok(carried, `${field} is not carried at all, so nothing marks it`);
    assert.equal(carried.value, null, `${field} arrived with a date this request never named`);
  }
  const named = (data.stillNeeded || []).flatMap((item) => item.fields || []);
  assert.ok(named.includes("uc04-startDate") && named.includes("uc04-endDate"), "the empty date boxes are not named as still needed");
});

// ---------------------------------------------------------------------------
// 2. THERE IS NO SESSION CHANGE LEFT TO WARN ABOUT
// ---------------------------------------------------------------------------
// This section used to assert the OPPOSITE, and the reversal is the point.
//
// Continuing from UC-03 into UC-04 silently swapped the traveller for a company
// admin, because UC-04's identity gate was `session.companyId ===
// employment.company_id` — an admin-only shape. The project owner met it twice
// ("i was chris lee in uc-03 and became admin instantly"), and the first repair
// was a SENTENCE on the offer: "Your employer's admin completes this next part,
// so the form opens signed in as them. It is still your trip, and your name is
// on it." Every word of that was true, and this test guarded it in the
// traveller's vocabulary.
//
// It was a good warning about a defect. Remote's own object has the employee
// SUBMIT (`user`) and the customer's manager APPROVE (`employer_approver`) —
// the gate had the employer's test applied to the employee's act.
// `submissionIdentity.js` now accepts either party to the record, the traveller
// stays themselves, and a warning about something that will not happen is its
// own confusion. So the sentence went with the swap.

test("the offer does not warn about a session change, because there is not one", () => {
  const start = APP.indexOf("  function continuationOffer(payload) {");
  const end = APP.indexOf("\n  }", start);
  assert.ok(start !== -1 && end > start, "continuationOffer() has moved — re-point this test");
  const body = APP.slice(start, end).replace(/\/\/[^\n]*/g, "");
  const spoken = (body.match(/"[^"]*"/g) || []).join(" ");

  assert.ok(!spoken.includes("signed in as them"), "the offer still warns of a swap that no longer happens");
  assert.ok(!/\bsigned in as\b/i.test(spoken), "the offer still describes who the next form is signed in as");

  // The vocabulary rule is UNCHANGED and still worth holding: whatever this
  // offer says, it says in the reader's words, not ours.
  for (const internal of [/\bsession\b/i, /\bgate\b/i, /companyId/, /\bpersona\b/i, /UC-0\d/]) {
    assert.ok(!internal.test(spoken), `the offer is written in our vocabulary (${internal}): ${spoken}`);
  }
});

test("the traveller who files in UC-03 is the one who files in UC-04", () => {
  // The behavioural half of the same claim: nothing between the offer and the
  // UC-04 form touches the persona picker.
  const fn = APP.slice(APP.indexOf("function applyContinuation"), APP.indexOf("function renderContinuationBanner"));
  assert.ok(fn.length > 0, "applyContinuation() has moved — re-point this test");
  assert.ok(!/picker\.value\s*=/.test(fn), "the continuation writes to the persona picker");
  assert.ok(!/company_admin/.test(fn), "the continuation still reaches for a company admin");
});

// ---------------------------------------------------------------------------
// 3. THE BANNER NAMES WHOSE TRIP IT IS
// ---------------------------------------------------------------------------
// The same `node:vm` DOM sandbox test/portalUc03ContinuationForm.test.js uses.
// The banner is pinned there to be A HEADING AND A CLOSED DISCLOSURE, with no
// prose between them — the project owner's own rule. So the name goes IN the
// heading: a heading may carry a fact, and this is the fact a reader who has
// just been signed in as somebody else needs first.

function domSandbox() {
  const make = (tag) => ({
    tag,
    className: "",
    textContent: "",
    childNodes: [],
    appendChild(node) {
      this.childNodes.push(node);
      return node;
    },
    setAttribute() {},
    addEventListener() {},
  });
  const document = {
    createElement: make,
    createTextNode: (text) => Object.assign(make("#text"), { textContent: String(text) }),
    createDocumentFragment: () => make("#fragment"),
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  return { document, el, make };
}

const textOf = (node) => (node.textContent || "") + (node.childNodes || []).map(textOf).join(" ");

/** renderContinuationBanner(), with the roster the server would have sent. */
function banner(data, personas) {
  const source = APP;
  const cut = (name, until) => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${until}(`, start);
    assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
    return source.slice(start, end);
  };
  const sandbox = domSandbox();
  const node = sandbox.make("div");
  const ctx = {
    ...sandbox,
    byId: () => node,
    clear: (target) => {
      target.childNodes.length = 0;
    },
    context: { personas: personas },
    PAYLOAD: data,
  };
  vm.createContext(ctx);
  vm.runInContext(
    cut("renderContinuationBanner", "whyBlank") +
      "\n" +
      cut("whyBlank", "markCarried") +
      "\n" +
      cut("carriedSubjectName", "clearCarriedMarks"),
    ctx
  );
  vm.runInContext("renderContinuationBanner(PAYLOAD)", ctx);
  return node;
}

test("the banner a continuation lands on names the person the request is about", async () => {
  const data = await continued(portal(), "subject-3");
  const words = textOf(banner(data, PERSONAS)).replace(/\s+/g, " ");

  assert.match(words, /Continued from Chris Lee’s travel request/, `the banner does not name the traveller: ${words}`);

  // AND IT DOES NOT PRINT THE ID. The name is the readable half of the pair;
  // the id is still in the box below, which is what gets submitted, and is not
  // something a person reads.
  const chris = PERSONAS.find((p) => p.id === "chris");
  assert.ok(!words.includes(chris.employmentId), "the banner prints the raw employment id at the reader");
});

test("an employment the roster cannot name falls back to the plain heading, never to a guess", async () => {
  const data = await continued(portal(), "subject-4");
  // An admin who typed an id by hand, or a roster that has changed. The page
  // must say less rather than name the wrong person.
  const words = textOf(banner(data, [])).replace(/\s+/g, " ");
  assert.match(words, /Continued from your travel request/);
  assert.ok(!/Chris Lee/.test(words), "a name was composed for an id the server did not name");
});

// ---------------------------------------------------------------------------
// 4. THE BOX HOLDING THE ID WEARS THE NAME
// ---------------------------------------------------------------------------

test("the carried employment box is marked with the person, not only with where it came from", () => {
  const start = APP.indexOf("  function markCarried(item) {");
  const end = APP.indexOf("\n  }", start);
  assert.ok(start !== -1 && end > start, "markCarried() has moved — re-point this test");
  const body = APP.slice(start, end).replace(/\/\/[^\n]*/g, "");

  assert.match(
    body,
    /personaNameForEmployment\(item\.value\)/,
    "the one carried value nobody can read is still marked as if it were readable"
  );
  // The other carried boxes are unchanged: a country and a date need no gloss,
  // and the two existing marks still say which are facts and which are readings.
  assert.match(body, /from your Remote profile/);
  assert.match(body, /from your request — check it/);
});

// ---------------------------------------------------------------------------
// 5. "I DON'T KNOW THE RIGHT COMBINATION" — measured rather than assumed
// ---------------------------------------------------------------------------

test("the work-authorization form offers quick-fills, and more than one of them succeeds", async () => {
  // A form whose only demonstrable outcomes are refusals teaches the wrong
  // thing about the system — it is indistinguishable from one that cannot
  // succeed, which is the failure shape this repository is most expensive at.
  // This drives UC-04's own quick-fills through the real handler and requires
  // at least one to reach an approvable outcome.
  const startS = APP.indexOf("  var SCENARIOS = {");
  const endS = APP.indexOf("\n  };", startS);
  const startB = APP.indexOf("  var BUILDERS = {");
  const endB = APP.indexOf("\n  };", startB);
  let refs = 0;
  const ctx = {
    SCENARIOS: null,
    BUILDERS: null,
    FIELDS: {},
    pendingContinuation: null,
    value: (id) => String(ctx.FIELDS[id] ?? "").trim(),
    orNull: (id) => String(ctx.FIELDS[id] ?? "").trim() || null,
    checked: (id) => ctx.FIELDS[id] === true,
    reference: (typeId) => `${typeId}-subject-${++refs}`,
    freshCopyOf: (id) => id,
  };
  vm.createContext(ctx);
  vm.runInContext(APP.slice(startS, endS + 4).replace("var SCENARIOS =", "SCENARIOS ="), ctx);
  vm.runInContext(APP.slice(startB, endB + 4).replace("var BUILDERS =", "BUILDERS ="), ctx);

  assert.ok(ctx.SCENARIOS.uc04.length >= 5, "the work-authorization form has lost its quick-fills");
  assert.match(
    readFileSync(join(__dirname, "..", "src", "portal", "assets", "index.html"), "utf8"),
    /data-scenarios="uc04"/,
    "the quick-fills exist but the form does not render them"
  );

  const handler = portal();
  const outcomes = [];
  for (const scenario of ctx.SCENARIOS.uc04) {
    ctx.FIELDS = scenario.fields || {};
    const body = vm.runInContext(`BUILDERS["uc04"](${JSON.stringify(scenario.persona ?? "")})`, ctx);
    const res = await call(handler, "/api/requests/uc04", body);
    outcomes.push({ id: scenario.id, decision: res.body && res.body.decision });
  }

  const succeeded = outcomes.filter((o) => o.decision === "ready_for_approval");
  assert.ok(
    succeeded.length >= 2,
    `only ${succeeded.length} of ${outcomes.length} quick-fills reach an approvable outcome: ${outcomes
      .map((o) => `${o.id}=${o.decision}`)
      .join(", ")}`
  );
  // And the refusals are still there, because a form that only ever succeeds
  // teaches the opposite wrong thing.
  assert.ok(outcomes.some((o) => o.decision === "blocked" || o.decision === "escalate"), "no quick-fill demonstrates a refusal");
});
