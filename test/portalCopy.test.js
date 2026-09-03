// ---------------------------------------------------------------------------
// portalCopy.test.js  —  the portal's forms are readable by the person filing one
// ---------------------------------------------------------------------------
// WHAT WENT WRONG
//
// Commit 112f1e5 cut fifty rendered lines of prose off ONE block on ONE page —
// the UC-04 continuation banner — after the project owner looked at it and
// said: "this section is useless to the user. just fill in the forms, and give
// the user two line summary of why they are on the page. anybody should be able
// to understand it immediately."
//
// The same defect was everywhere else on the portal, on every request type. The
// blurb under the UC-04 title read "A deterministic origin→destination risk
// matrix: permanent-establishment exposure, Schengen and US/Canada hard blocks,
// cumulative day counts…"; the note above the form named a ZAF sidebar and
// argued about single versus dual approval; the badge in the corner said
// "Medium risk · UC-04"; and the reference block — on all seven forms,
// including a work-authorization one — spent five dense lines on delivery
// semantics, one clause of which was about what UC-02 separately asks
// concerning an expense.
//
// "UC-01" through "UC-09", "ZAF sidebar", "risk matrix", "gate", "durable
// write", "/v1/…" and "the classifier" are OUR vocabulary. A person asking to
// work from Portugal for three weeks has never seen any of it.
//
// WHY THESE TESTS PIN PROPERTIES AND NOT STRINGS
//
// Copy gets rewritten, and a test that pins a sentence makes the next rewrite
// harder while proving nothing about the one after it. What must not come back
// is the SHAPE: more than two sentences before the first input, our own names
// for our own components, and one request type's explanation printed on another
// one's form. So the assertions below are budgets and vocabulary bans measured
// over the REAL rendered output — the same technique 112f1e5 used, and the same
// one test/n8nParity.test.js uses on the n8n Code node bodies: app.js is
// browser code no other test can import, so the functions under test are lifted
// into a `node:vm` sandbox with the same four-line `el()` helper the file
// itself defines. A string assertion about source cannot tell you what a reader
// ends up looking at.
//
// HONEST IS NOT THE SAME AS VERBOSE. Nothing here tests that a disclosure was
// removed; the repo's rule is that what the system cannot do is stated plainly,
// and section 4 below still asserts every such statement is present. It tests
// that those statements are made once, for the group, in words the reader
// knows.
//
// HERMETIC: every LLM seam is faked with the repo-standard
// `(args) => realFn(args, {isConfigured: () => false})` idiom, and the mock
// Remote is reached through createInProcessFetch(), so this file binds no port
// and opens no socket.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

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
import { fakeZendesk, lastNoteRows } from "./portalNoteHelpers.js";

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
  // UC-05's letter extractor. Without this seam the two letter scenarios below
  // make a real, retried OpenAI call (CLAUDE.md §6) — and the offline path is
  // also the one those scenarios are written for.
  extract: (args) => extractFromLetter(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

/** The real portal handler, with the mock Remote dispatched in-process. */
// [N-14] The most recent handler's Zendesk double, so UC-05's specialist-only
// rows can be read off the note they reach (test/portalNoteHelpers.js).
let lastZendesk = null;
function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  lastZendesk = fakeZendesk();
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM, zendesk: lastZendesk });
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
        const text = payload === undefined || payload === null ? null : String(payload);
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null; // an asset, not JSON
        }
        resolve({ status: this.statusCode, headers: this.headers, text, body: parsed });
      },
    };
    handler(req, res).catch(reject);
  });
}

// OUR WORDS FOR OUR OWN THINGS. Every one of these was on the page, in copy a
// person filling a form was expected to read. `\bgate\b` is here rather than
// `gates` alone because "twelve deterministic gates" and "the identity gate"
// are the same defect; the RESULT panel may still use the word, because by then
// the reader has been shown the ladder that gives it a meaning (docs/GATES.md).
const INTERNAL = [
  /UC-0\d/,
  /\/v1\//,
  /\bZAF\b/i,
  /\bclassifier\b/i,
  /\bgates?\b/i,
  /\bdeterministic\b/i,
  /\brisk matrix\b/i,
  /\bendpoint\b/i,
  /\bschema\b/i,
  /\bidempoten/i,
  /\bdurable\b/i,
  /\bOCR\b/,
  /\bwebhook\b/i,
  /\bSupabase\b/i,
  /\bpermanent[- ]establishment\b/i,
  /\bhandle[A-Z]\w*\(\)/,
  /Math\.max/,
];

function sentencesOf(text) {
  return String(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertPlain(where, text) {
  for (const pattern of INTERNAL) {
    assert.ok(!pattern.test(text), `${where} still says ${pattern}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// 1. The blurb — what a person meets above the form, for all seven types
// ---------------------------------------------------------------------------
// These two strings are the FIRST things read on any request page:
// `description` under the title and on the home tile, `humanControl` in the
// callout beneath it. They are served by GET /api/context from
// src/portal/requestTypes.js, so this asserts against what the browser is
// actually sent rather than against the module — the page has no copy of its
// own and a duplicate would be the one place these could drift.

test("every request type's blurb is at most two sentences, in the reader's words", async () => {
  const res = await call(portal(), { path: "/api/context" });
  assert.equal(res.status, 200);
  assert.equal(res.body.requestTypes.length, 8, "the eight types must all still describe themselves");

  for (const type of res.body.requestTypes) {
    for (const field of ["description", "humanControl"]) {
      const copy = type[field];
      const sentences = sentencesOf(copy);
      assert.ok(
        sentences.length <= 2,
        `${type.id}'s ${field} runs to ${sentences.length} sentences — the whole blurb is meant to be two lines: ${copy}`
      );
      assert.ok(copy.length < 260, `${type.id}'s ${field} runs to ${copy.length} characters: ${copy}`);
      assertPlain(`${type.id}'s ${field}`, copy);
    }
  }
});

test("no request type's blurb explains a different request type", async () => {
  // The reference block used to talk about expenses on a work-authorization
  // form. This is the same mistake one layer up, and the cheapest guard against
  // it is that each blurb's subject nouns belong to its own use case.
  const res = await call(portal(), { path: "/api/context" });
  const SUBJECTS = {
    uc01: /\bletter|verif|employment\b/i,
    uc02: /\bexpense|receipt|claim\b/i,
    uc03: /\btrip|travel|letter\b/i,
    uc04: /\bcountry|work\b/i,
    uc05: /\bleav|notice|holiday\b/i,
    uc07: /\bmove|relocat|visa\b/i,
    uc08: /\btax|social security|resident\b/i,
    uc09: /\bpay|bonus|money\b/i,
  };
  for (const type of res.body.requestTypes) {
    const copy = type.description + " " + type.humanControl;
    assert.ok(SUBJECTS[type.id].test(copy), `${type.id}'s blurb never names its own subject: ${copy}`);
  }
  // And the one crossing that was actually on the page: an expense explained on
  // six forms that have nothing to do with expenses.
  for (const type of res.body.requestTypes) {
    if (type.id === "uc02") continue;
    assert.ok(!/\bexpense\b/i.test(type.description + type.humanControl), `${type.id} explains an expense`);
  }
});

// ---------------------------------------------------------------------------
// 2. The rendered card head — the real renderer, over the real payload
// ---------------------------------------------------------------------------

/** A DOM small enough to render into, and no smaller. */
function domSandbox() {
  const make = (tag) => ({
    tag,
    className: null,
    textContent: "",
    hidden: false,
    open: false,
    type: null,
    childNodes: [],
    attrs: {},
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener() {},
    insertBefore(child) {
      this.childNodes.push(child);
      return child;
    },
  });
  const document = {
    createElement: make,
    createTextNode: (text) => Object.assign(make("#text"), { textContent: String(text) }),
    createDocumentFragment: () => make("#fragment"),
  };
  // Byte-for-byte what app.js's own el() does — see its definition at the top
  // of that file. If that helper changes shape, this stub is where it shows.
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  return { document, el, make };
}

function textOf(node) {
  const own = node.textContent || "";
  return node.childNodes.reduce((acc, child) => acc + " " + textOf(child), own);
}

/** Lift one function out of app.js by name, up to the next one. */
function cut(name, until) {
  const source = read("app.js");
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${until}(`, start);
  assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
  return source.slice(start, end);
}

test("the tile a reader picks from says the risk in words, and no use-case code", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const { document, el, make } = domSandbox();
  const grid = make("div");
  const context = {
    document,
    el,
    byId: () => grid,
    clear: (node) => {
      node.childNodes.length = 0;
    },
    // The one map app.js keeps for this, lifted with the renderer so the words
    // under test are the words the browser prints.
    TIER_WORD: { low: "Low risk", medium: "Medium risk", high: "High risk" },
    activate: () => {},
  };
  vm.createContext(context);
  vm.runInContext(cut("renderHomeTiles", "showHome"), context);
  vm.runInContext("renderHomeTiles(TYPES)", Object.assign(context, { TYPES: res.body.requestTypes }));

  assert.equal(grid.childNodes.length, 8, "one tile per request type");
  const rendered = textOf(grid);
  assert.ok(!/UC-0\d/.test(rendered), `the tiles still print a use-case code: ${rendered}`);
  assertPlain("a home tile", rendered);

  // The badge is the corner label the project owner named: "Medium risk · UC-04".
  for (const tile of grid.childNodes) {
    const badges = [];
    const walk = (node) => {
      if (typeof node.className === "string" && node.className.indexOf("r-tier") === 0) badges.push(node);
      node.childNodes.forEach(walk);
    };
    walk(tile);
    assert.equal(badges.length, 1, "each tile carries exactly one risk badge");
    assert.ok(
      ["Low risk", "Medium risk", "High risk"].includes(badges[0].textContent),
      `the badge says "${badges[0].textContent}" rather than the risk word alone`
    );
  }

  // And the copy on the tile is the SERVER'S, unedited — the page has none.
  for (const type of res.body.requestTypes) {
    assert.ok(rendered.includes(type.description), `${type.id}'s tile does not render the server's description`);
  }
});

// ---------------------------------------------------------------------------
// 3. The reference control — one sentence, on seven forms
// ---------------------------------------------------------------------------

/**
 * Render the reference block the way the browser does.
 *
 * `syncRefField` is stubbed rather than lifted: it hides and shows the text box
 * and nothing under test here depends on it. Everything that produces COPY —
 * the heading, the hint, the two choices — is the real function.
 */
function renderReferenceControl(types) {
  const { document, el, make } = domSandbox();
  const inputs = {};
  const parents = {};
  types.forEach((type) => {
    const parent = make("div");
    const label = make("label");
    label.parentNode = parent;
    const input = make("input");
    input.closest = () => label;
    inputs[type.id + "-externalRef"] = input;
    parents[type.id] = parent;
  });
  const context = {
    document,
    el,
    byId: (id) => inputs[id] || null,
    syncRefField: () => {},
  };
  vm.createContext(context);
  vm.runInContext(cut("upgradeReferenceFields", "freshCopyOf"), context);
  vm.runInContext("upgradeReferenceFields(TYPES)", Object.assign(context, { TYPES: types }));
  return parents;
}

test("the reference block is one sentence, and it is about this form only", () => {
  const parents = renderReferenceControl(REQUEST_TYPES);

  for (const type of REQUEST_TYPES) {
    const rendered = textOf(parents[type.id]);

    // The hint is the paragraph the project owner counted five lines of.
    const hints = [];
    const walk = (node) => {
      if (typeof node.className === "string" && node.className.includes("ref-hint")) hints.push(node);
      node.childNodes.forEach(walk);
    };
    walk(parents[type.id]);
    assert.equal(hints.length, 1, `${type.id}'s reference block renders ${hints.length} hints`);

    const hint = textOf(hints[0]).trim();
    assert.ok(sentencesOf(hint).length <= 2, `${type.id}'s reference hint runs to ${sentencesOf(hint).length} sentences: ${hint}`);
    assert.ok(hint.length < 200, `${type.id}'s reference hint runs to ${hint.length} characters`);
    assertPlain(`${type.id}'s reference hint`, hint);

    // THE SPECIFIC CROSSING. This block explained, on every form, what UC-02
    // separately asks about an expense. A work-authorization page must not
    // mention an expense at all; the expense-specific half is said on UC-02's
    // own form, beside the control that acts on it.
    if (type.id !== "uc02") {
      assert.ok(!/\bexpense\b/i.test(rendered), `${type.id}'s reference block still explains an expense`);
    }

    // Both behaviours are still offered — this is copy, not a control change.
    assert.ok(/Generate a new reference/.test(rendered), `${type.id} lost the "new reference" choice`);
    assert.ok(/Reuse a reference/.test(rendered), `${type.id} lost the "reuse" choice`);
  }
});

// ---------------------------------------------------------------------------
// 4. The static form copy — every label, hint and note on all seven cards
// ---------------------------------------------------------------------------
// The scan is over the seven request cards only. The home page's disclosure is
// deliberately excluded: it starts CLOSED, nobody has to open it to file
// anything, and it is where the portal's full honesty statement belongs.

/** Visible text of one card: comments dropped, tags dropped, placeholders kept. */
function cardText(id) {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  const match = html.match(new RegExp(`<section class="r-card uc-card"[^>]*id="card-${id}"([\\s\\S]*?)</section>`));
  assert.ok(match, `no card for ${id}`);
  const placeholders = [...match[1].matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]).join(" ");
  const text = match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
  return (text + " " + placeholders).trim();
}

test("no form label, hint or note on any card is written in our vocabulary", () => {
  for (const type of REQUEST_TYPES) {
    assertPlain(`${type.id}'s form`, cardText(type.id));
  }
});

test("no card prints a raw identifier at the reader", () => {
  // `no_time_off_records`, `QUOTE_REQUIRED`, `annual_gross_salary` — every one
  // of these was on a form, as itself. They are real names of real things and
  // they belong in the result, in the audit record and in docs/, where
  // something has already given them a meaning.
  const IDENTIFIER = /\b[a-z]+_[a-z_]+\b|\b[A-Z]{3,}_[A-Z_]+\b/;
  for (const type of REQUEST_TYPES) {
    const text = cardText(type.id);
    const hit = text.match(IDENTIFIER);
    assert.ok(!hit, `${type.id}'s form prints the identifier "${hit && hit[0]}" at the reader`);
  }
});

test("a note explaining why something is blank is short, and there is at most one per group", () => {
  const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
  const notes = [...html.matchAll(/<p class="r-hint field-note">([\s\S]*?)<\/p>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, '"').replace(/\s+/g, " ").trim()
  );
  assert.ok(notes.length > 0, "the notes that say why a value is missing must still be on the page");
  for (const note of notes) {
    assert.ok(sentencesOf(note).length <= 3, `a field note runs to ${sentencesOf(note).length} sentences: ${note}`);
    assert.ok(note.length < 400, `a field note runs to ${note.length} characters: ${note}`);
  }
});

test("what the system does NOT know is still said — cutting words did not cut the honesty", () => {
  // The point of the whole pass was that honest is not the same as verbose. If
  // a rewrite ever drops one of these, it has crossed from one to the other.
  const uc04 = cardText("uc04");
  assert.ok(/nothing is looked up|you tell us/i.test(uc04), "UC-04 must still say prior stays are stated, not looked up");
  assert.ok(/floor|not a confirmed/i.test(uc04), "UC-04 must still say a blank is not a confirmed zero");
  assert.ok(/not a smaller count/i.test(uc04), "UC-04 must still say an unreadable stay is refused, not dropped");

  const uc05 = cardText("uc05");
  assert.ok(/unknown/i.test(uc05), "UC-05 must still say a missing balance is unknown rather than zero");

  const uc07 = cardText("uc07");
  assert.ok(/quote/i.test(uc07), "UC-07 must still say an unquoted fee is not counted as nothing");

  const uc08 = cardText("uc08");
  assert.ok(/not a smaller count/i.test(uc08), "UC-08 must still say a count missing a stay is not a smaller count");

  const uc09 = cardText("uc09");
  assert.ok(/stops there and says so|cannot be reached/i.test(uc09), "UC-09 must still say it stops when the model is unreachable");
});

// ---------------------------------------------------------------------------
// 5. The UC-04 prior-stays rows — the copy describes a control that works
// ---------------------------------------------------------------------------
// The note this pass replaced said prior trips were sent empty because the
// portal had no source of travel history. The form now has one, so the note is
// about the boxes rather than their absence — and a note is only honest if the
// boxes behind it do what it says. These are the positive tests CLAUDE.md §4
// asks for: a refusal and an inability to succeed look identical from outside.

const BASE_TRIP = {
  persona: "admin",
  employmentId: "09b65526-643b-4956-959b-916e6429bd23", // Anna Müller — DE, employee, active
  homeCountry: "DE",
  nationality: "DE",
  destinationCountry: "ES",
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  reasonText: "Two weeks with the Madrid team.",
  now: "2026-08-15",
};

test("prior stays reach the day counts: the two windows can disagree, and both answers survive", async () => {
  // One stay sits inside both counting windows; the other inside the 365-day
  // one and outside the 180-day one. So the Schengen count is still inside its
  // allowance while the tax-residency count is already past its threshold —
  // two windows measuring different things, which is not a contradiction to be
  // reconciled away. This is the quick-fill scenario `uc04-disagree`.
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "copy-prior-stays-1",
      travelHistory: [
        { country: "ES", startDate: "2026-07-01", endDate: "2026-08-14" },
        { country: "ES", startDate: "2025-10-01", endDate: "2026-02-28" },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(res.body.flags.includes("tax_residency_watch"), `the tax window's answer was lost: ${res.body.flags}`);
});

test("two untouched rows send exactly what the hard-coded empty history used to", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "copy-prior-stays-2",
      travelHistory: [
        { country: "", startDate: "", endDate: "" },
        { country: "", startDate: "", endDate: "" },
      ],
    },
  });
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(!res.body.flags.includes("tax_residency_watch"), "a blank history must not manufacture a day count");
});

test("a stay that cannot be read is refused by name, which is what the note promises", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "copy-prior-stays-3",
      travelHistory: [
        { country: "ES", startDate: "2026-07-01", endDate: "" },
        { country: "", startDate: "", endDate: "" },
      ],
    },
  });
  assert.notEqual(res.status, 200);
  assert.match(String(res.body.reason || res.body.error || ""), /prior stay 1/i);
});

test("the form has the rows, the builder sends them, and no quick-fill leaves one behind", () => {
  const html = read("index.html");
  for (const id of ["uc04-h1-country", "uc04-h1-startDate", "uc04-h1-endDate", "uc04-h2-country", "uc04-h2-startDate", "uc04-h2-endDate"]) {
    assert.ok(html.includes(`id="${id}"`), `the UC-04 form has no ${id} box`);
  }

  const app = read("app.js");
  assert.match(app, /travelHistory: \[/, "the UC-04 builder must send the rows the form collects");

  // A quick-fill only sets the keys it names, so a scenario that leaves the
  // rows out inherits whatever the previously clicked one typed into them —
  // silently changing its own day counts. Every UC-04 scenario names all six,
  // blank or not; the general rule is the test below.
  for (const scenario of scenarios().uc04) {
    for (const key of ["uc04-h1-country", "uc04-h1-startDate", "uc04-h1-endDate", "uc04-h2-country", "uc04-h2-startDate", "uc04-h2-endDate"]) {
      assert.ok(key in scenario.fields, `scenario ${scenario.id} does not name ${key}, so it inherits the previous fill`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5b. EVERY quick-fill names EVERY key — for all seven request types
// ---------------------------------------------------------------------------
// The rule above was written for UC-04's prior-stay rows and left everywhere
// else on trust. Trust lost, on the next form somebody used: UC-05's "Already
// archived" named six of its ten boxes, so clicking "Portugal, notice too
// short" and then it left Portugal's holiday type, days used, hourly rate and
// currency in the form — values that scenario never chose, that nobody could
// see were stale, and that go on to be submitted. UC-04's own persona-gate row
// had the same shape with sixteen boxes.
//
// "Remember to list them all" is not checkable. This is: within one request
// type, every scenario's key set must be IDENTICAL. It is deliberately
// equality and not a superset test — a key one scenario names and another
// omits is exactly the leak, whichever direction it points.

/** The real SCENARIOS object out of app.js, all seven types. */
function scenarios() {
  const app = read("app.js");
  const start = app.indexOf("  var SCENARIOS = {");
  const end = app.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, "SCENARIOS has moved — re-point this test");
  const context = { SCENARIOS: null };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end + 4).replace("var SCENARIOS =", "SCENARIOS ="), context);
  return context.SCENARIOS;
}

test("within a request type, every quick-fill names exactly the same fields", () => {
  const all = scenarios();

  // AGAINST THE REGISTRY, NOT AGAINST A NUMBER. This line read `7` from the day
  // it was written until 2026-08-28, when UC-01 gained the quick-fills it had
  // never had — and a literal count cannot tell "a type lost its scenarios"
  // (the thing this guards) from "a type gained some" (the thing that just
  // happened). Both arrive here as an inequality, and the message printed the
  // wrong one of the two.
  //
  // Comparing to REQUEST_TYPES makes the assertion say what it always meant,
  // and makes it stricter at the same time: every type the portal SERVES must
  // have a way to demonstrate itself. A type added to the registry with no
  // scenarios now fails here on its own account, which is exactly the hole
  // UC-01 sat in — its card rendered a "Quick-fill a scenario" heading above an
  // empty row for as long as the number said 7 and meant it.
  assert.deepEqual(
    Object.keys(all).sort(),
    REQUEST_TYPES.map((type) => type.id).sort(),
    "every request type the portal serves needs quick-fills, and only those types may have them"
  );

  for (const [typeId, list] of Object.entries(all)) {
    const union = new Set();
    for (const scenario of list) for (const key of Object.keys(scenario.fields || {})) union.add(key);

    for (const scenario of list) {
      const named = new Set(Object.keys(scenario.fields || {}));
      const missing = [...union].filter((key) => !named.has(key));
      assert.deepEqual(
        missing,
        [],
        `${typeId}/${scenario.id} does not name ${missing.join(", ")} — those boxes keep whatever the previously clicked scenario put in them`
      );
    }
  }
});

test("the letter path is demonstrated, in both directions, by scenarios that can only work one way", () => {
  // UC-05's textarea is the second thing on the form and no quick-fill ever
  // filled it, so src/uc05/letterExtractor.js was never exercised from this
  // page at all. Which way the two scenarios have to be built is decided by
  // src/uc05/workflow.js, not by preference: an explicit proposedEndDate OR an
  // explicit reason skips the extractor entirely. So the letter can only be
  // read when BOTH of those boxes are empty.
  const uc05 = scenarios().uc05;
  const withLetter = uc05.filter((s) => (s.fields["uc05-letterText"] || "").trim());
  assert.ok(withLetter.length >= 2, "no quick-fill pastes a resignation letter, so the letter path is undemonstrated");

  const readsTheLetter = withLetter.filter(
    (s) => !s.fields["uc05-proposedEndDate"] && !s.fields["uc05-reason"]
  );
  assert.ok(
    readsTheLetter.length >= 1,
    "every letter scenario also fills a date or a reason, which skips the extractor — the letter is never read"
  );

  const ignoresTheLetter = withLetter.filter((s) => s.fields["uc05-proposedEndDate"]);
  assert.ok(
    ignoresTheLetter.length >= 1,
    "no scenario shows the typed date winning over the letter, which is the rule people get wrong"
  );

  // A stated date the rule-based extractor can actually read, so the scenario
  // works with no OpenAI key — the same posture the whole suite runs in.
  for (const scenario of readsTheLetter) {
    assert.match(
      scenario.fields["uc05-letterText"],
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/,
      `${scenario.id}'s letter states no date the offline extractor can read, so it demonstrates nothing`
    );
  }
});

test("a scenario that deliberately leaves a box empty says so, and the chosen one is named", () => {
  // Two things reported in the same minute: a reader could not tell which
  // quick-fill was loaded, and read a deliberately empty box as the quick-fill
  // having failed. Both are answered by one line under the row.
  const app = read("app.js");
  assert.match(app, /function showScenarioNote\(/, "the line naming the loaded scenario is gone");
  assert.match(app, /is-chosen/, "nothing marks which quick-fill is currently loaded");

  const all = scenarios();
  for (const [typeId, list] of Object.entries(all)) {
    for (const scenario of list) {
      if (!scenario.note) continue;
      assertPlain(`${typeId}/${scenario.id}'s note`, scenario.note);
      assert.ok(
        sentencesOf(scenario.note).length <= 2,
        `${typeId}/${scenario.id}'s note runs to ${sentencesOf(scenario.note).length} sentences: ${scenario.note}`
      );
    }
  }

  // The specific ones the reader tripped over: a scenario that empties a box
  // ON PURPOSE has to say which and why, or it is indistinguishable from one
  // that forgot.
  const BLANK_ON_PURPOSE = ["uc05-nl", "uc05-sandbox-br", "uc05-terminated", "uc05-letter"];
  for (const id of BLANK_ON_PURPOSE) {
    const scenario = all.uc05.find((s) => s.id === id);
    assert.ok(scenario, `${id} has gone`);
    assert.ok(scenario.note, `${id} empties boxes on purpose and never says so — it reads as a broken quick-fill`);
  }
});

// ---------------------------------------------------------------------------
// The nav is the ONE place the use-case code belongs, and it is here on
// purpose. The rest of this file bans "UC-0x" from anything a requester reads,
// because nobody asking to work abroad knows what UC-04 means. The left rail
// is different: it is the builder's own navigation surface, and the codes are
// how the specs, the tests and the audit rows are named. It was asked for
// explicitly after the copy pass removed it everywhere.
//
// This test exists so the NEXT jargon sweep cannot quietly take it away again.
// A sweep that greps for /UC-0\d/ and deletes the hits would pass every other
// assertion in this file.
// ---------------------------------------------------------------------------
test("the nav keeps the use-case code as a sub-label, and hides it from screen readers", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const types = res.body.requestTypes;

  const { document, el, make } = domSandbox();
  const nav = make("nav");
  const context = {
    document,
    el,
    byId: () => nav,
    clear: (node) => {
      node.childNodes.length = 0;
    },
    TIER_WORD: { low: "Low risk", medium: "Medium risk", high: "High risk" },
    TIER_GROUPS: ["low", "medium", "high"],
    activate: () => {},
    showMyRequests: () => {},
    showConsentRequests: () => {},
  };
  vm.createContext(context);
  vm.runInContext(cut("renderNav", "applyDescriptions"), context);
  vm.runInContext("renderNav(TYPES)", Object.assign(context, { TYPES: types }));

  const rendered = textOf(nav);
  for (const type of types) {
    assert.ok(
      rendered.includes(type.useCase),
      `the nav no longer shows ${type.useCase} (${type.label}). It is deliberate: ` +
        "the codes are how this project's specs, tests and audit rows are named, and " +
        "the left rail is the one surface where that is what the reader wants."
    );
  }

  // aria-hidden, because a screen reader running the list of request types
  // should hear seven names, not seven names each followed by a code.
  const codes = [];
  (function walk(node) {
    if (node.className === "nav-subcode") codes.push(node);
    for (const child of node.childNodes || []) walk(child);
  })(nav);
  assert.equal(codes.length, types.length, "one sub-code per request type");
  for (const code of codes) {
    assert.equal(
      code.attrs["aria-hidden"],
      "true",
      `the sub-code "${code.textContent}" is not aria-hidden, so a screen reader reads it aloud`
    );
  }
});

// ---------------------------------------------------------------------------
// 5c. THE LETTER SCENARIOS, DRIVEN — a claim on a button, checked against a run
// ---------------------------------------------------------------------------
// Both new quick-fills make a factual claim in their own note: one says the
// date is read out of the letter, the other says the typed box wins and the
// letter is not read at all. Rendering assertions cannot tell either apart
// from the opposite behaviour. These send the scenario's OWN field values
// through the real handler and read which path answered.

/** The body app.js's UC-05 builder sends for one scenario's fields. */
function uc05Body(scenario, externalRef) {
  const f = scenario.fields;
  return {
    persona: scenario.persona,
    letterText: f["uc05-letterText"],
    proposedEndDate: f["uc05-proposedEndDate"] || null,
    reason: f["uc05-reason"] || null,
    ptoType: f["uc05-ptoType"] || null,
    ptoDaysAccrued: f["uc05-ptoDaysAccrued"],
    ptoDaysUsed: f["uc05-ptoDaysUsed"],
    ptoHourlyRate: f["uc05-ptoHourlyRate"],
    currency: f["uc05-currency"] || null,
    now: f["uc05-now"],
    externalRef,
  };
}

// WHERE THE DATE CAME FROM IS THE SPECIALIST'S ROW NOW, so this reads the
// requester's payload expecting to find NOTHING. `structured_input` /
// `rule_based_fallback` tell the HR Ops signatory whether the date they are
// confirming was typed or extracted from a pasted letter; the employee did one
// or the other themselves and knows which. The row still exists and still
// reaches the Zendesk note — test/portalRequesterFacts.test.js drives a real
// hand-off and reads it back out of the created ticket. Here it is asserted as
// ABSENT, so the routing cannot quietly reverse.
const dateSource = (body) => (body.details.find((d) => d.label === "Date came from") || {}).value;
// [N-14] The comparison is the specialist's row now — read off the note.
const proposed = () => lastNoteRows(lastZendesk)["Proposed vs. statutory"];

test("POSITIVE: the letter-only quick-fill is really read, and reaches a sign-off", async () => {
  const scenario = scenarios().uc05.find((s) => s.id === "uc05-letter");
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc05",
    body: uc05Body(scenario, "copy-letter-only"),
  });

  assert.equal(res.status, 200);
  // The date is nowhere in the submitted fields — only in the prose.
  //
  // THE EXTRACTOR RAN, PROVED BY WHAT IT PRODUCED rather than by its source tag.
  // Nothing in the submitted body carries a date — `uc05-proposedEndDate` is
  // empty on this quick-fill — so a comparison that names 2026-10-15 can only
  // have got it out of the prose. That is a stronger statement than the tag
  // was: it survives the tag being renamed, and it fails if the extractor
  // silently stops running.
  assert.match(String(proposed()), /2026-10-15/, `the letter's date never reached the comparison: ${proposed()}`);
  assert.equal(dateSource(res.body), undefined, "the extraction-source slug is on the requester's panel");
  assert.equal(res.body.decision, "prepared_for_signoff", `a readable letter must be able to succeed: ${res.body.reason}`);
});

test("the clash quick-fill shows the typed box winning — which is what its note claims", async () => {
  const scenario = scenarios().uc05.find((s) => s.id === "uc05-letter-clash");
  const f = scenario.fields;
  assert.match(f["uc05-letterText"], /15 October 2026/, "the clash scenario's letter no longer states the later date");
  assert.equal(f["uc05-proposedEndDate"], "2026-09-15", "the clash scenario no longer types the earlier date");

  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc05",
    body: uc05Body(scenario, "copy-letter-clash"),
  });

  assert.equal(res.status, 200);
  assert.match(String(proposed()), /2026-09-15/, "the box did not win");
  assert.ok(!/2026-10-15/.test(String(proposed())), "the letter's date reached the comparison after all");
  // The typed box winning IS the two assertions above — the date it holds is in
  // the comparison and the letter's is not. The source tag said the same thing
  // in this system's vocabulary and is now the signatory's row, not theirs.
  assert.equal(dateSource(res.body), undefined, "the extraction-source slug is on the requester's panel");
  // THE DECISION IS NOT THIS TEST'S SUBJECT, and asserting one made it fail for
  // a reason that has nothing to do with it (2026-09-02). This asserted
  // `escalate`, which held only because the UK notice period was
  // service-scaled: the typed 2026-09-15 was short of a 21-day statutory end.
  // ERA 1996 s.86(2) gives a resigning employee ONE WEEK flat, so that same date
  // is now comfortably LATER than the statutory end and the case passes.
  //
  // What this test is about is which DATE won — the typed box or the letter —
  // and that is the two assertions above, which are unchanged and still pass.
  // The decision is asserted as a real one rather than a specific one, so a
  // future change to the notice table cannot break a test about date precedence
  // while a change to date precedence still can.
  assert.ok(
    ["prepared_for_signoff", "escalate"].includes(res.body.decision),
    `the clash produced no decision at all: ${res.body.decision}`
  );
});

// ---------------------------------------------------------------------------
// THE PERSONA CARRIES THE DEMONSTRATION
// ---------------------------------------------------------------------------
// The project owner: "I would love a prefilled scenario where another person
// won't get the same [outcome]. You can make it easier: for positive outcomes I
// can act as one particular employee, for negative ones I can act as another —
// just need to switch from the sidebar, so it is just prefilled. There can be
// nuanced ones that don't depend on the employee's details; we can work with
// that."
//
// Two kinds of scenario, then, and a reader has to be able to tell them apart —
// because "you are not eligible" and "what you asked for needs a person" are
// different things to be told, and the second reads as the first if the page
// does not say which it is. `turnsOn` is that distinction, printed in the note
// under the quick-fill row when one is clicked.
//
// WHAT THESE TESTS PIN, AND WHY IT IS NOT THE LABELS. A scenario's words will
// be rewritten. What must keep holding is that the PAIRS REALLY DIVERGE: the
// same request, sent twice, differing only in who is asking, must come back
// with two different outcomes for reasons that are on those two people's own
// records. A test that only checked the label would pass through a fixture
// change that quietly made both sides agree, which is exactly the failure that
// would make the demo pointless while looking finished.

test("every quick-fill says which kind of demonstration it is", () => {
  for (const [typeId, list] of Object.entries(scenarios())) {
    for (const scenario of list) {
      assert.ok(
        scenario.turnsOn === "who" || scenario.turnsOn === "what",
        `${typeId}/${scenario.id} does not say whether its outcome turns on who is asking or on what is asked`
      );
    }
  }
});

test("at least one request type demonstrates BOTH kinds, and the page has words for each", () => {
  const all = scenarios();
  const kinds = new Set();
  for (const list of Object.values(all)) for (const s of list) kinds.add(s.turnsOn);
  assert.deepEqual([...kinds].sort(), ["what", "who"], "the page now only ever shows one kind of scenario");

  // UC-03 and UC-04 each carry a pair whose only difference is the person, so
  // the switch in the sidebar is the whole of the demonstration on both.
  for (const typeId of ["uc03", "uc04"]) {
    const who = all[typeId].filter((s) => s.turnsOn === "who");
    assert.ok(who.length >= 2, `${typeId} has no persona-driven pair — ${who.length} scenario(s) turn on who is asking`);
  }

  // AND THE SENTENCE EXISTS FOR BOTH. The note is rendered from a two-entry
  // table; a `turnsOn` value with no words is a marker nobody ever sees.
  const app = read("app.js");
  assert.match(app, /var TURNS_ON = \{/, "the sentences that explain the two kinds have gone");
  assert.match(app, /who: "The answer here depends on WHO is asking/);
  assert.match(app, /what: "The answer here depends on WHAT is asked/);
  assert.match(
    app,
    /if \(TURNS_ON\[scenario\.turnsOn\]\) \{/,
    "the note no longer prints which kind of scenario was clicked"
  );
  // OUR VOCABULARY MUST NOT COME BACK IN IT. Same ban as every other sentence
  // on these forms.
  const table = app.slice(app.indexOf("var TURNS_ON = {"), app.indexOf("};", app.indexOf("var TURNS_ON = {")));
  assert.doesNotMatch(table, /UC-0\d|gate|policy engine|persona|classifier/i, `our vocabulary reached the reader: ${table}`);
});

test("UC-03: the same letter request succeeds for one person and stops for another", async () => {
  const all = scenarios();
  const issued = all.uc03.find((s) => s.id === "uc03-letter");
  const stopped = all.uc03.find((s) => s.id === "uc03-letter-no-entity");
  assert.ok(issued && stopped, "the UC-03 persona pair has gone");

  // THE ONLY DIFFERENCE IS THE PERSON. Asserted rather than described: the
  // request text is identical, and if somebody edits one of them this fails
  // instead of the pair quietly becoming a demonstration of different typing.
  assert.equal(stopped.fields["uc03-text"], issued.fields["uc03-text"], "the pair no longer sends the same words");
  assert.notEqual(stopped.persona, issued.persona);

  const handler = portal();
  const a = await call(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: issued.persona, text: issued.fields["uc03-text"], externalRef: "pair-uc03-a" },
  });
  const b = await call(handler, {
    method: "POST",
    path: "/api/requests/uc03",
    body: { persona: stopped.persona, text: stopped.fields["uc03-text"], externalRef: "pair-uc03-b" },
  });

  assert.equal(a.body.decision, "auto_resolve", `the positive half no longer succeeds: ${a.body.reason}`);
  assert.equal(a.body.reason, "standard_letter_issued");
  assert.equal(b.body.decision, "blocked", `the negative half no longer stops: ${b.body.reason}`);
  assert.equal(b.body.reason, "engagement_not_eor_contractor");

  // AND THE REQUESTER IS TOLD WHICH IT WAS, in a sentence, without reading a
  // decision string. The positive half says the letter exists and where it is;
  // the negative half says it was refused outright and that nothing went to
  // Remote — it used to say "Not yet", which was right while this pair turned
  // on a missing letterhead and a specialist really was going to look. It turns
  // on the engagement now, and there is nobody for a contractor to wait for.
  assert.match(a.body.plainAnswer.lead, /travel letter/i);
  // The `because` clause is folded into the lead rather than published as its
  // own field, so both halves of the sentence are asserted here.
  assert.match(b.body.plainAnswer.lead, /refused/i);
  assert.match(b.body.plainAnswer.lead, /contractor/i, "the refusal must name the fact it turned on");
  assert.match(b.body.plainAnswer.next, /invoice|payment history/i, "a refusal must name what the person CAN get");
});

/* =============================================================================
   NO UC-04 SCENARIO MAY STATE A HOME COUNTRY ITS SUBJECT'S RECORD CONTRADICTS
   =============================================================================
   THIS DEFECT HAS NOW HAPPENED TWICE, IN BOTH DIRECTIONS. First a Nigerian
   subject under a form saying DE; then, when eleven rows were swept onto João
   Silva (PT), four rows that name SOMEBODY ELSE kept the PT the sweep wrote —
   so Chris Lee (US), Amanda J Walker (US), Lars van der Berg (NL) and Anna
   Müller (DE) were all filed as Portuguese. Nothing failed either time, because
   the country a scenario states and the country its subject works in were never
   compared anywhere.

   AND THEY ARE NOT COMPARED IN PRODUCTION EITHER — deliberately, and the
   sidebar says so beside the value: "it is not read from the Remote employment
   record and is never compared to it, so a wrong country here is not caught
   anywhere" (src/uc04/decisionFacts.js). That disclosure is the reason this
   guard belongs on the DEMO DATA rather than in a gate: a demo whose rows
   exercise exactly the hole the product discloses teaches the wrong lesson
   twice, and the screen is telling the truth both times when it prints "Stated
   home country: Portugal" over a US employment.

   THE COUNTRY IS READ OUT OF THE MOCK, through the same client the portal uses.
   A table restated here would be a second copy of the fixtures and would agree
   with a scenario that had drifted — which is how both instances of this
   survived review.

   NATIONALITY IS DELIBERATELY NOT ASSERTED. The employment record carries no
   nationality field (docs/INTAKE-RESEARCH.md §6.4 — one of the five UC-04 gate
   inputs with no source in any Remote object), so there is nothing to compare
   against, and asserting one would be this file inventing the fact whose
   absence it is documenting.
   ========================================================================== */
test("every UC-04 quick-fill states the home country its subject actually works in", async () => {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  const rows = scenarios().uc04;
  assert.ok(rows.length >= 10, "the UC-04 scenario set has shrunk — this guard may be passing vacuously");

  for (const scenario of rows) {
    const employmentId = scenario.fields["uc04-employmentId"];
    const stated = scenario.fields["uc04-homeCountry"];
    const record = await remote.getEmployment(employmentId);
    assert.ok(record, `${scenario.id} names an employment the mock does not hold: ${employmentId}`);
    assert.equal(
      stated,
      record.country_code,
      `${scenario.id} says the traveller works in ${stated}, but ${record.full_name}'s record says ` +
        `${record.country_code}. A quick-fill may not state a fact about a real fixture person that the ` +
        `fixture contradicts — nothing downstream compares the two, so nothing else will catch it.`
    );
  }
});

/* A workation has to GO somewhere, and after the rule above that is a second
   thing a row can get wrong: a subject whose record country equals the
   destination is a same-country request, which is nonsense on its face. It is
   allowed only where that IS the demonstration. */
test("no UC-04 quick-fill sends its subject to the country they already work in, except the one that means to", async () => {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  for (const scenario of scenarios().uc04) {
    const record = await remote.getEmployment(scenario.fields["uc04-employmentId"]);
    const sameCountry = record.country_code === scenario.fields["uc04-destinationCountry"];
    assert.equal(
      sameCountry,
      scenario.id === "uc04-same",
      `${scenario.id}: destination ${scenario.fields["uc04-destinationCountry"]} against a record in ` +
        `${record.country_code}. Only "uc04-same" may be a same-country trip, because that is the gate it shows.`
    );
  }
});

test("UC-04: the same trip is prepared for one traveller, blocked for a second, refused for a third", async () => {
  const all = scenarios();
  const ok = all.uc04.find((s) => s.id === "uc04-low");
  const noPermission = all.uc04.find((s) => s.id === "uc04-no-permission");
  const otherCompany = all.uc04.find((s) => s.id === "uc04-other-company");
  assert.ok(ok && noPermission && otherCompany, "the UC-04 persona trio has gone");

  /* WHAT IS IDENTICAL, AND WHY IT IS NO LONGER EVERYTHING (2026-08-31).
     This loop used to require every field but the subject to match, as the
     claim behind the words "the same trip". It cannot: a workation's origin is
     where the person WORKS, and the three subjects work in three countries.
     Requiring identity here is what kept Amanda J Walker (US) and Lars van der
     Berg (NL) filed as Portuguese for weeks — the guard was pinning the defect
     in place, which is the worst thing a guard can do.

     So the trip is still identical in everything the FORM is free to vary —
     the dates, the visa type, the duties, the signing authority, the prior
     stays — and the subject's own country moves with the subject. The
     destination is exempt for one row and one reason, named below. */
  const SUBJECT_FIELDS = ["uc04-employmentId", "uc04-homeCountry", "uc04-nationality"];
  for (const other of [noPermission, otherCompany]) {
    for (const key of Object.keys(ok.fields)) {
      if (key === "uc04-externalRef" || key === "uc04-reasonText") continue;
      if (SUBJECT_FIELDS.includes(key)) continue;
      /* THE ONE DESTINATION EXEMPTION, and it exists because the alternative is
         a self-contradictory request on screen. Lars works in the Netherlands,
         so leaving the destination at NL would make his row a same-country
         workation — nonsense on its face, and NOT what it refuses on, since
         identity is checked first. His trip is João's mirrored: NL → PT. */
      if (key === "uc04-destinationCountry" && other.id === "uc04-other-company") continue;
      assert.deepEqual(
        other.fields[key],
        ok.fields[key],
        `${other.id} differs from ${ok.id} on ${key} — the pair no longer turns on who is travelling`
      );
    }
    assert.notEqual(other.fields["uc04-employmentId"], ok.fields["uc04-employmentId"]);
  }

  const handler = portal();
  const send = (scenario, ref) =>
    call(handler, {
      method: "POST",
      path: "/api/requests/uc04",
      body: {
        persona: scenario.persona,
        employmentId: scenario.fields["uc04-employmentId"],
        homeCountry: scenario.fields["uc04-homeCountry"],
        nationality: scenario.fields["uc04-nationality"],
        destinationCountry: scenario.fields["uc04-destinationCountry"],
        startDate: scenario.fields["uc04-startDate"],
        endDate: scenario.fields["uc04-endDate"],
        visaType: scenario.fields["uc04-visaType"],
        jobDuties: scenario.fields["uc04-jobDuties"],
        hasContractSigningAuthority: scenario.fields["uc04-hasContractSigningAuthority"],
        reasonText: scenario.fields["uc04-reasonText"],
        now: scenario.fields["uc04-now"],
        externalRef: ref,
      },
    });

  const a = await send(ok, "pair-uc04-a");
  const b = await send(noPermission, "pair-uc04-b");
  const c = await send(otherCompany, "pair-uc04-c");

  assert.equal(a.body.decision, "ready_for_approval", `the positive half no longer succeeds: ${a.body.reason}`);
  // TWO DIFFERENT NEGATIVES, and they must stay different: a hard block that
  // nobody can overturn is not the same outcome as a request the filer had no
  // standing to make, and a demo that collapsed them would teach the wrong
  // thing about both.
  assert.equal(b.body.decision, "blocked");
  assert.equal(b.body.reason, "employer_permission_not_granted");
  assert.equal(c.body.decision, "escalate");
  assert.equal(c.body.reason, "identity_not_verified");
  assert.notEqual(b.body.decision, c.body.decision, "the two refusals have collapsed into one outcome");
});
