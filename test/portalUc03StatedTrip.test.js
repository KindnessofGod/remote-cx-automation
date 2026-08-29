// ---------------------------------------------------------------------------
// portalUc03StatedTrip.test.js — the trip, stated instead of read out of prose
// ---------------------------------------------------------------------------
// WHAT THIS COVERS AND WHY IT EXISTS
//
// docs/TRAVEL-LETTER-INPUTS.md §2 reads the travel letter row by row and finds
// that three of its rows — the destination and the two travel dates — reach the
// document from a model's reading of a free-text box, on a path with no human
// between the render and a consulate. §6 proposes exactly three additions to
// the form and no more: a country PICKER, two DATE inputs, and an optional
// addressee. This file is the portal half of that change.
//
// THE PROPERTY THE WHOLE FILE IS ABOUT IS "OPTIONAL", and it is asserted as a
// behaviour rather than accepted as a promise. A field described as optional in
// a comment and enforced as required by a marker, a `required` attribute, or a
// server-side refusal is the ordinary way this goes wrong, so:
//
//   * section 2 builds the body with every box untouched and requires the four
//     members to be null — not "" — and requires the decision that comes back
//     to be byte-for-byte the decision a body with no `stated` key at all gets;
//   * section 4 requires the boxes to be absent from REQUIRED_FIELDS and to
//     carry no `required` attribute;
//   * section 3 drives the archived-employee quick-fill WITH all three boxes
//     filled and requires it to still be refused for being archived. §6.5 names
//     that row as the one to check first: if filling these boxes moves it, they
//     have stopped being an override and become a gate.
//
// WHAT IT DELIBERATELY DOES NOT COVER. Whether a stated value is USED, and
// which wins where the traveller and the classifier disagree, is src/uc03/'s —
// a second agent is building that half against the same contract. This file
// asserts the shape that crosses the boundary and stops there. The pass-through
// onto the ticket is checked structurally (section 5) because the workflow is
// imported directly by the adapter and there is nothing to inject: a
// behavioural assertion would be an assertion about the other half.
//
// HERMETIC: the mock Remote is dispatched in-process, every LLM seam is faked
// with the repo-standard `(args) => realFn(args, {isConfigured: () => false})`
// idiom, no socket is bound.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createPortalHandler, buildStatedTrip } from "../src/portal/server.js";
import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { countryLabel } from "../src/shared/countryNames.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { extractFromLetter } from "../src/uc05/letterExtractor.js";
import { judgeNarrative } from "../src/shared/narrativeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(__dirname, "..", "src", "portal", "assets", name), "utf8");
const APP = read("app.js");
const HTML = read("index.html");
/** The markup as a reader meets it: our own comments are not on the page. */
const VISIBLE = HTML.replace(/<!--[\s\S]*?-->/g, "");

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
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(String(payload)) : null });
      },
    };
    handler(req, res).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// SCENARIOS and BUILDERS, lifted out of app.js rather than restated
// ---------------------------------------------------------------------------
// The same technique test/portalRequesterFacts.test.js uses, for the same
// reason: a test that wrote its own body could never disagree with the builder
// that has changed. The sandbox supplies the four DOM helpers the builder
// calls, so what runs here is the real function, not a copy of it.

function liftBlock(opening) {
  const start = APP.indexOf(opening);
  const end = APP.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, `${opening} has moved — re-point this test`);
  return APP.slice(start, end + 4);
}

function browserSandbox(fields = {}) {
  let refs = 0;
  const ctx = {
    SCENARIOS: null,
    BUILDERS: null,
    FIELDS: fields,
    value: (id) => String(ctx.FIELDS[id] ?? "").trim(),
    orNull: (id) => String(ctx.FIELDS[id] ?? "").trim() || null,
    checked: (id) => ctx.FIELDS[id] === true,
    reference: (typeId) => `${typeId}-stated-${++refs}`,
    freshCopyOf: (expenseId) => expenseId,
    pendingContinuation: null,
  };
  vm.createContext(ctx);
  vm.runInContext(liftBlock("  var SCENARIOS = {").replace("var SCENARIOS =", "SCENARIOS ="), ctx);
  vm.runInContext(liftBlock("  var BUILDERS = {").replace("var BUILDERS =", "BUILDERS ="), ctx);
  return ctx;
}

/** The real BUILDERS.uc03, run over one set of form values. */
function buildUc03(fields, persona = "chris") {
  const ctx = browserSandbox(fields);
  const body = vm.runInContext(`BUILDERS["uc03"](${JSON.stringify(persona)})`, ctx);
  // JSON ROUND-TRIP, and it is not cosmetic: a value out of node:vm carries the
  // sandbox's prototypes, so assert.deepEqual fails on prototype identity
  // rather than on content (CLAUDE.md §6). Round-tripping is also what actually
  // happens to this body — it is serialised onto the wire.
  return JSON.parse(JSON.stringify(body));
}

const uc03Scenarios = () => browserSandbox().SCENARIOS.uc03;

// ---------------------------------------------------------------------------
// 1. THE CONTRACT — the exact body a filled form sends
// ---------------------------------------------------------------------------

test("all three boxes filled sends the contract shape, values verbatim", () => {
  const body = buildUc03({
    "uc03-text": "I need a travel letter for a conference in Germany.",
    "uc03-destinationCountry": "DE",
    "uc03-startDate": "2026-09-20",
    "uc03-endDate": "2026-09-26",
    "uc03-addressee": "Spanish Consulate General, Amsterdam",
    "uc03-externalRef": "",
  });

  // THE ASSERTION IS ON THE BUILT BODY, not on the DOM. What crosses the wire
  // is what the two halves agreed on; a DOM assertion would prove the boxes
  // exist and say nothing about what is sent.
  assert.deepEqual(body.stated, {
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
    addressee: "Spanish Consulate General, Amsterdam",
  });

  // Exactly four members, and no fifth arriving quietly later — the other half
  // reads this object by name.
  assert.deepEqual(Object.keys(body.stated).sort(), [
    "addressee",
    "destinationCountry",
    "endDate",
    "startDate",
  ]);

  // ALPHA-2, from the picker's value. A country name here would be the defect
  // src/portal/countries.js exists to have ended.
  assert.equal(body.stated.destinationCountry, "DE");
  // THE PAIR: the code is what is submitted, the name is what a person reads.
  // Nothing on this form ever prints "DE" at the traveller — the picker's
  // option label is the country's name, and countryLabel() is what the result
  // prints. This asserts the two halves are the same country.
  assert.equal(countryLabel(body.stated.destinationCountry), "Germany");

  // The rest of the body is untouched: this is one added property, not a
  // rewritten request.
  assert.equal(body.text, "I need a travel letter for a conference in Germany.");
  assert.equal(body.persona, "chris");
});

test("a date box can only ever produce YYYY-MM-DD, so the format problem is fixed at the control", () => {
  // §6.2's second reason for a date input: prose reaches the document as
  // whatever a model returned. The input type is the guarantee, so it is the
  // thing asserted.
  for (const id of ["uc03-startDate", "uc03-endDate"]) {
    assert.match(
      VISIBLE,
      new RegExp(`<input type="date" id="${id}"`),
      `${id} is not a date input — a typed date can arrive in any format`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. OPTIONAL, PROVED — an empty form sends today's request and gets today's answer
// ---------------------------------------------------------------------------

test("every box untouched sends null for each member — never an empty string", () => {
  const body = buildUc03({ "uc03-text": "Can I travel to Spain for a client meeting?" });

  assert.deepEqual(body.stated, {
    destinationCountry: null,
    startDate: null,
    endDate: null,
    addressee: null,
  });

  // "" is a STATED value of nothing; null is "they did not say". The two are
  // different answers everywhere in this repository, and a box nobody touched
  // means the second.
  for (const [name, value] of Object.entries(body.stated)) {
    assert.notEqual(value, "", `${name} sent an empty string, which reads as a stated blank`);
  }
});

test("a request that fills nothing gets exactly the decision it got before these boxes existed", async () => {
  const handler = portal();
  const text = "I'm travelling to Spain for a client meeting from September 14 to October 2, 2026.";

  // TODAY'S BODY — no `stated` key at all, which is also what every non-browser
  // caller sends.
  const before = await call(handler, {
    path: "/api/requests/uc03",
    body: { persona: "chris", text, externalRef: "stated-none-a" },
  });

  // THE FORM'S BODY with every new box untouched.
  const after = await call(handler, {
    path: "/api/requests/uc03",
    body: {
      persona: "chris",
      text,
      externalRef: "stated-none-b",
      stated: { destinationCountry: null, startDate: null, endDate: null, addressee: null },
    },
  });

  assert.equal(before.status, 200);
  assert.equal(after.status, after.status && before.status);
  assert.equal(after.body.decision, before.body.decision, "an untouched box changed the decision");
  assert.equal(after.body.reason, before.body.reason, "an untouched box changed the recorded reason");
  assert.deepEqual(after.body.flags ?? [], before.body.flags ?? [], "an untouched box changed the flags");
});

test("the boxes are an override, not a gate: the archived employee is still refused for being archived", async () => {
  // §6.5's own instruction — "the last row is the one to check first after
  // building". A perfectly stated trip must not buy a way past rung 2.
  const scenario = uc03Scenarios().find((s) => s.id === "uc03-terminated");
  assert.ok(scenario, "the archived-employee quick-fill has gone");
  const body = buildUc03(scenario.fields, scenario.persona);
  body.externalRef = "stated-archived-1";

  assert.ok(body.stated.destinationCountry, "this scenario is meant to be driven WITH the boxes filled");
  const res = await call(portal(), { path: "/api/requests/uc03", body });

  assert.equal(res.body.reason, "employee_not_active", `the fields moved the outcome: ${res.body.reason}`);
});

test("the boxes cannot stand in for the request itself — a blank question is still refused", async () => {
  // THE ONE "CANNOT" THAT IS THIS FILE'S TO HOLD. Whether a stated destination
  // is USED, and what it clears, belongs to src/uc03/ — the second half of this
  // contract, built by another agent, and an assertion here about it would be
  // an assertion about somebody else's gates. What the INTAKE owes is that the
  // three new boxes are an addition to a request and never a substitute for
  // one: the adapter's `text_required` refusal is the thing every UC-03
  // submission starts at, and a fully stated trip must not walk past it.
  //
  // (This test replaced one that asserted a stated trip must not auto-resolve a
  // request whose text said nothing. That was a claim about the other half's
  // policy, it was made before that half landed, and the half that landed
  // decided otherwise — which is exactly the kind of opinion this file said in
  // its own header it would not hold.)
  const res = await call(portal(), {
    path: "/api/requests/uc03",
    body: {
      persona: "chris",
      text: "   ",
      externalRef: "stated-textless-1",
      stated: {
        destinationCountry: "ES",
        startDate: "2026-09-14",
        endDate: "2026-09-20",
        addressee: "Spanish Consulate General, Amsterdam",
      },
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, "text_required", `a stated trip filed a request with no question in it: ${JSON.stringify(res.body)}`);
});

// ---------------------------------------------------------------------------
// 3. THE QUICK-FILLS — self-consistent with their own text, blanks included
// ---------------------------------------------------------------------------

test("every UC-03 quick-fill names all four trip boxes, so none inherits the last one clicked", () => {
  // blankForm() clears the form first, but the equality rule in
  // test/portalCopy.test.js is what makes that true for the NEXT scenario
  // somebody adds. This is the same rule stated about the four boxes by name,
  // where a miss is worst: an inherited destination is a different trip.
  for (const scenario of uc03Scenarios()) {
    for (const id of ["uc03-destinationCountry", "uc03-startDate", "uc03-endDate", "uc03-addressee"]) {
      assert.ok(id in scenario.fields, `${scenario.id} does not name ${id}`);
    }
  }
});

test("each quick-fill's stated trip agrees with its own text", () => {
  // The values in docs/TRAVEL-LETTER-INPUTS.md §6.5 are READ OUT OF each
  // scenario's text, so this checks the two against each other rather than
  // against a copy of the table: a scenario whose text is rewritten and whose
  // boxes are not now fails here.
  const EXPECTED = {
    "uc03-trip": { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-10-02", addressee: null },
    "uc03-workation": { destinationCountry: "PT", startDate: null, endDate: null, addressee: null },
    "uc03-letter": { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", addressee: null },
    "uc03-letter-no-entity": { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26", addressee: null },
    "uc03-terminated": { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-10-02", addressee: null },
  };

  const scenarios = uc03Scenarios();
  assert.equal(scenarios.length, Object.keys(EXPECTED).length, "a UC-03 quick-fill was added or lost");

  for (const scenario of scenarios) {
    const expected = EXPECTED[scenario.id];
    assert.ok(expected, `${scenario.id} has no expected trip — add it, and read the values out of its text`);
    assert.deepEqual(buildUc03(scenario.fields, scenario.persona).stated, expected, scenario.id);

    // THE TEXT IS THE SOURCE, so the country the boxes name has to be the
    // country the sentence names. This is what "self-consistent" means, and it
    // is checkable without any policy: the reader's own label for the code.
    const name = countryLabel(expected.destinationCountry);
    assert.ok(
      scenario.fields["uc03-text"].includes(name),
      `${scenario.id} states ${name} in its boxes and never mentions it in its text`
    );
  }
});

test("the workation quick-fill leaves the dates empty, and says why on the page", () => {
  // §6.5's deliberate blank. This scenario's text contains no dates at all;
  // inventing a fortnight for it would put a duration in front of the reader
  // that the request never named, and hide the routing the scenario exists to
  // demonstrate. A blank on purpose and a blank by mistake look identical on a
  // form, so app.js's existing per-scenario note is required here.
  const scenario = uc03Scenarios().find((s) => s.id === "uc03-workation");
  assert.ok(scenario, "the workation quick-fill has gone");
  assert.equal(scenario.fields["uc03-startDate"], "");
  assert.equal(scenario.fields["uc03-endDate"], "");
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(scenario.fields["uc03-text"]), "its text now names a date — restate the blank");
  assert.ok(
    scenario.note && /date/i.test(scenario.note),
    "the empty date boxes are deliberate and nothing tells the reader so — it reads as a broken quick-fill"
  );
});

test("the two same-words letter quick-fills differ only in who is asking", () => {
  // The pair's whole point (app.js's own comment): the same request, word for
  // word, from two people. If one carries a stated trip and the other does not,
  // the person is no longer the only difference.
  const scenarios = uc03Scenarios();
  const a = scenarios.find((s) => s.id === "uc03-letter");
  const b = scenarios.find((s) => s.id === "uc03-letter-no-entity");
  assert.ok(a && b, "the letter pair has changed");
  assert.equal(a.fields["uc03-text"], b.fields["uc03-text"], "the pair no longer shares its words");
  assert.deepEqual(
    buildUc03(a.fields, a.persona).stated,
    buildUc03(b.fields, b.persona).stated,
    "the same words now state a different trip"
  );
  assert.notEqual(a.persona, b.persona, "the pair no longer differs in the person");
});

// ---------------------------------------------------------------------------
// 4. THE FORM — optional in the markup, and written for the person filling it
// ---------------------------------------------------------------------------

test("nothing added to the UC-03 form is marked or enforced as required", () => {
  const start = VISIBLE.indexOf('<form id="form-uc03">');
  const form = VISIBLE.slice(start, VISIBLE.indexOf("</form>", start));
  assert.ok(start !== -1 && form, "the UC-03 form has moved");

  for (const id of ["uc03-destinationCountry", "uc03-startDate", "uc03-endDate", "uc03-addressee"]) {
    assert.ok(form.includes(`id="${id}"`), `the UC-03 form has no ${id} box`);
    const element = form.slice(form.indexOf(`id="${id}"`));
    const openTag = element.slice(0, element.indexOf(">"));
    assert.ok(!/\brequired\b/.test(openTag), `${id} carries a required attribute — the browser would block the submit`);
  }

  // REQUIRED_FIELDS is what paints the marker and what the gap-marking reads.
  // A box named there is required in every sense the page has.
  const required = APP.slice(APP.indexOf("var REQUIRED_FIELDS = ["), APP.indexOf("];", APP.indexOf("var REQUIRED_FIELDS = [")));
  for (const id of ["uc03-destinationCountry", "uc03-startDate", "uc03-endDate", "uc03-addressee"]) {
    assert.ok(!required.includes(id), `${id} is listed as required — §6 says all three are an override`);
  }
});

test("the addressee box is length-capped in the markup and offers the blank as advice", () => {
  // §6.3's second precondition. The cap is the markup's job; the advice is the
  // one hint on this group that earns its place, because "leave it blank" is
  // genuinely what a person would otherwise get wrong — an addressee named
  // wrongly is worse than none.
  const element = VISIBLE.slice(VISIBLE.indexOf('id="uc03-addressee"'));
  const openTag = element.slice(0, element.indexOf(">"));
  const cap = openTag.match(/maxlength="(\d+)"/);
  assert.ok(cap, "the addressee box has no length cap");
  assert.ok(Number(cap[1]) > 0 && Number(cap[1]) <= 200, `the cap is ${cap[1]} — a cap that large is not one`);

  const start = VISIBLE.indexOf('<form id="form-uc03">');
  const form = VISIBLE.slice(start, VISIBLE.indexOf("</form>", start));
  assert.match(form, /To Whom It May Concern/, "the blank-is-fine advice is gone, and it is the only hint here that earns its place");
});

test("the three questions are asked in the words the research settled on", () => {
  const start = VISIBLE.indexOf('<form id="form-uc03">');
  const form = VISIBLE.slice(start, VISIBLE.indexOf("</form>", start)).replace(/\s+/g, " ");
  for (const question of [
    "Which country are you travelling to?",
    "First day of the trip",
    "Last day of the trip",
    "If you already know which embassy or consulate you will hand this to, name it here.",
  ]) {
    assert.ok(form.includes(question), `the form no longer asks: ${question}`);
  }
});

test("the new copy is written for the traveller, not about the machinery behind it", () => {
  // The standing rule (docs/UI-AUDIENCES.md), applied to the three boxes this
  // change adds: the reader is the person whose trip it is. They have no use
  // for what is done with the value, for what overrides what, or for any name
  // this repository gave a thing.
  const start = VISIBLE.indexOf('<form id="form-uc03">');
  const form = VISIBLE.slice(start, VISIBLE.indexOf("</form>", start)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const pattern of [
    /\bgates?\b/i,
    /\boverride\b/i,
    /\bclassifier\b/i,
    /\bmodel\b/i,
    /UC-0\d/,
    /\bfallback\b/i,
    /\b[a-z]+_[a-z_]+\b/,
  ]) {
    assert.ok(!pattern.test(form), `the UC-03 form now says ${pattern}: ${form.match(pattern)}`);
  }
});

// ---------------------------------------------------------------------------
// 5. THE SEAM — normalisation, and the one line that carries it to the workflow
// ---------------------------------------------------------------------------

test("buildStatedTrip keeps four members, trims them, and turns a blank into null", () => {
  assert.deepEqual(buildStatedTrip({ destinationCountry: "  DE ", startDate: "2026-09-20", endDate: "", addressee: "   " }), {
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: null,
    addressee: null,
  });
});

test("a body with no stated trip at all is four nulls, not a missing object", () => {
  // One shape for the reader downstream and no branch to forget. Every
  // non-browser caller — the walkthrough, a curl, the tests above — sends no
  // `stated` key, and "they did not say" is the correct reading of that.
  for (const raw of [undefined, null, "DE", 7, []]) {
    assert.deepEqual(buildStatedTrip(raw), {
      destinationCountry: null,
      startDate: null,
      endDate: null,
      addressee: null,
    });
  }
});

test("a fifth field cannot ride into the ticket on the back of this one", () => {
  const out = buildStatedTrip({ destinationCountry: "DE", passportNumber: "X1234567", employmentId: "not-yours" });
  assert.deepEqual(Object.keys(out).sort(), ["addressee", "destinationCountry", "endDate", "startDate"]);
  assert.ok(!("passportNumber" in out), "an unnamed field reached the ticket — §6.4 keeps a passport number off this form");
});

test("the adapter carries the stated trip onto the ticket and forms no opinion about it", () => {
  // STRUCTURAL, on purpose. handleTravelInquiry() is imported directly by the
  // adapter, so there is nothing to inject and nothing observable to read back
  // until the other half of the contract lands; asserting the outcome here
  // would be asserting somebody else's build. What IS this file's to hold is
  // that the value is passed and not judged.
  const source = readFileSync(join(__dirname, "..", "src", "portal", "server.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const start = source.indexOf("async uc03(body)");
  const adapter = source.slice(start, source.indexOf("async uc04(body)", start));
  assert.ok(start !== -1 && adapter, "the UC-03 adapter has moved — re-point this test");

  assert.match(adapter, /stated:\s*buildStatedTrip\(body\.stated\)/, "the stated trip no longer reaches the workflow");

  // NO POLICY IN THE ADAPTER. It must not decide that a stated destination is
  // acceptable, compare the two dates, or prefer one source over the other —
  // every one of those is a gate, and gates live one directory over.
  for (const pattern of [/body\.stated[\s\S]{0,400}?(?:SANCTIONED|SCHENGEN|KNOWN_DESTINATIONS)/, /stated[A-Za-z]*\s*[<>]=?\s*/]) {
    assert.ok(!pattern.test(adapter), `the UC-03 adapter is deciding something about the stated trip: ${pattern}`);
  }
});

// ---------------------------------------------------------------------------
// 6. THE ASSET RULES THIS PAGE HAS ALWAYS HELD
// ---------------------------------------------------------------------------

test("app.js still compiles, and the change added no innerHTML and no second country list", () => {
  // The standing guard from test/portal.test.js, re-run here because a browser
  // asset is never imported by the suite: a syntax error in it ships while
  // every test stays green.
  new vm.Script(APP, { filename: "app.js" });
  assert.ok(!/\.innerHTML\s*=/.test(APP), "app.js assigns innerHTML");
  assert.ok(
    !/"(?:Germany|Spain|Portugal)"\s*[,:)]/.test(liftBlock("  var BUILDERS = {")),
    "a country name is being written into the body — the picker sends the code and the server owns the names"
  );
});
