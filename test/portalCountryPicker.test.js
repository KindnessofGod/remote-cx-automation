// ---------------------------------------------------------------------------
// portalCountryPicker.test.js — a country is chosen from a list, never typed
// ---------------------------------------------------------------------------
// WHAT WENT WRONG, AND WHY IT IS NOT A COSMETIC BUG
//
// The project owner looked at the UC-04 form's "prior stays abroad" rows and
// said: "the country should be a drop down menu". Those rows took a country as
// free text, and so did seven other boxes across the portal — home country,
// nationality, destination, the tax form's target country and its two presence
// rows.
//
// A free-text country box is the entry point for this repository's most
// expensive recurring defect. UC-03's supported-countries gate compared
// two-letter destinations against a list mapped from `code` — the ALPHA-3 form
// — so `ES` never matched `ESP`, the supported set came back empty after a
// *successful* 224-row fetch, and the use case could not auto-resolve at all.
// It survived for weeks because a use case that structurally cannot succeed
// and one that is appropriately refusing look identical from outside.
// `normalizeEmployment()` carried the same latent fallback, and a lower-case
// "us" once walked past UC-04's US and Canada hard blocks outright.
//
// So these tests are not about a widget. They pin the two properties that make
// the widget a fix:
//
//   1. NOTHING TYPED. No country box on the portal is free text, and the
//      values the picker can emit are exactly the codes the gates compare.
//   2. NOTHING WITHHELD. The list is not filtered to what UC-04's risk matrix
//      knows, nor to Remote's supported-country registry — which omits the
//      sanctioned set, and would therefore have made `blocked /
//      sanctioned_region` unreachable from the form meant to demonstrate it.
//
// AND THE POSITIVE TEST THE REPO'S OWN RULE DEMANDS (CLAUDE.md §4): a picker
// that renders beautifully and emits the wrong shape passes every rendering
// assertion ever written. Section 5 therefore takes the value the picker emits
// for the option labelled "Spain", submits it through the real portal handler
// into the real gates, and asserts a decision came back — and does the same
// for Iran, which must be refused BY NAME.
//
// HERMETIC: the mock Remote is dispatched in-process, every LLM seam is forced
// into its unconfigured branch, and app.js (browser code no test can import)
// is lifted into a `node:vm` sandbox exactly as test/portalCopy.test.js does.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { createPortalHandler } from "../src/portal/server.js";
import { createInProcessFetch, COUNTRIES as MOCK_COUNTRIES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { buildPortalStores } from "../src/portal/wiring.js";
import { PORTAL_COUNTRIES, DEMO_COUNTRY_CODES } from "../src/portal/countries.js";
import { isWellFormedCountryCode } from "../src/shared/countryCodes.js";
import { SANCTIONED_OR_RESTRICTED } from "../src/uc03/policyEngine.js";
import { SCHENGEN, DNV_COUNTRIES, KNOWN_DESTINATIONS } from "../src/uc04/riskMatrix.js";

import { classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { classifyExpenseRuleBased } from "../src/uc02/expenseClassifier.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { draftSummary } from "../src/uc04/requestParser.js";
import { draftNarrative as draftTaxNarrative } from "../src/uc08/dossierBuilder.js";
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
  // Without this seam the UC-08 dossier below makes a real OpenAI call —
  // caught by the 651ms this test took before it was added (CLAUDE.md §6:
  // a fast suite is itself the hermeticity check).
  draftTaxNarrative: (args) => draftTaxNarrative(args, unconfigured),
  judge: (args) => judgeNarrative(args, unconfigured),
};

function portal() {
  const remote = new RemoteClient({ baseUrl: "http://mock.remote.invalid", fetchImpl: createInProcessFetch() });
  return createPortalHandler({ remote, audit: new AuditLogger(), stores: buildPortalStores(), llm: LLM });
}

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
          parsed = null;
        }
        resolve({ status: this.statusCode, headers: this.headers, text, body: parsed });
      },
    };
    handler(req, res).catch(reject);
  });
}

/**
 * The eight boxes that used to take a country as free text — plus the one
 * added after them, which never took text at all.
 *
 * `uc03-destinationCountry` is the newest and it is here for the forward half
 * of the same rule: UC-03's destination reached the letter from a model's
 * reading of prose, and the box that now lets a traveller state it was a
 * picker from its first line. Listing it keeps it one.
 */
const COUNTRY_FIELDS = [
  "uc03-destinationCountry",
  "uc04-homeCountry",
  "uc04-nationality",
  "uc04-destinationCountry",
  "uc04-h1-country",
  "uc04-h2-country",
  "uc08-targetCountry",
  "uc08-p1-country",
  "uc08-p2-country",
];

const CODES = new Set(PORTAL_COUNTRIES.map((c) => c.code));

// ---------------------------------------------------------------------------
// 1. The markup — nothing on this page takes a country as text any more
// ---------------------------------------------------------------------------

test("every country box on the portal is a picker, and none of them is a text input", () => {
  const html = read("index.html");

  for (const id of COUNTRY_FIELDS) {
    const tag = html.match(new RegExp(`<(\\w+)[^>]*\\bid="${id}"`));
    assert.ok(tag, `the form has no ${id} box at all`);
    assert.equal(tag[1], "select", `${id} is still a <${tag[1]}> — a country must be chosen, not typed`);
    const element = html.slice(html.indexOf(tag[0]));
    assert.match(
      element.slice(0, element.indexOf(">") + 1),
      /data-country-select/,
      `${id} is a <select> the renderer will never fill — it needs data-country-select`
    );
  }

  // The general form of the same rule, so a NINTH country box added later
  // cannot quietly arrive as an input. Matches any id naming a country or a
  // nationality; every hit must be a select.
  const inputs = html.match(/<input[^>]*\bid="[^"]*(?:ountry|ationality)[^"]*"[^>]*>/g) || [];
  assert.deepEqual(inputs, [], `a country is being typed again: ${inputs.join(" | ")}`);
});

test("the prior-stay rows still have all six boxes, with the country now a picker", () => {
  // The rows are hours old and their behaviour is pinned elsewhere
  // (test/portalCopy.test.js): an untouched row is dropped server-side, a
  // half-filled one is refused by name. This asserts the shape those tests
  // depend on survived the swap — the ids did not move and the dates are
  // untouched.
  const html = read("index.html");
  for (const id of ["uc04-h1-country", "uc04-h1-startDate", "uc04-h1-endDate", "uc04-h2-country", "uc04-h2-startDate", "uc04-h2-endDate"]) {
    assert.ok(html.includes(`id="${id}"`), `the UC-04 prior-stay row lost ${id}`);
  }
  for (const id of ["uc04-h1-startDate", "uc04-h1-endDate", "uc04-h2-startDate", "uc04-h2-endDate"]) {
    assert.match(html, new RegExp(`<input type="date" id="${id}"`), `${id} must stay a date input`);
  }
});

test("a picker's empty first option is declared by the field, so a blank still means unknown", () => {
  const html = read("index.html");
  for (const id of COUNTRY_FIELDS) {
    const element = html.slice(html.indexOf(`id="${id}"`));
    const openTag = element.slice(0, element.indexOf(">"));
    assert.match(openTag, /data-blank="[^"]+"/, `${id} has no wording for its empty option`);
  }
});

// ---------------------------------------------------------------------------
// 2. The list — served by the server, alpha-2, and complete enough to be honest
// ---------------------------------------------------------------------------

test("the page is sent the country list, and holds no copy of its own", async () => {
  const res = await call(portal(), { path: "/api/context" });
  assert.equal(res.status, 200);
  assert.equal(res.body.countries.length, PORTAL_COUNTRIES.length);
  assert.deepEqual(res.body.demoCountries, DEMO_COUNTRY_CODES);

  // Same rule as the request types: the browser renders what it is given. A
  // list in app.js would be the second copy, and the second copy is the one
  // that drifts.
  const app = read("app.js");
  assert.ok(!/"Netherlands"|"Portugal"|"Germany"/.test(app), "app.js is carrying its own country names");
});

test("every value the picker can emit is a well-formed alpha-2 code, and each appears once", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const seenCodes = new Set();
  const seenNames = new Set();

  for (const country of res.body.countries) {
    assert.ok(
      isWellFormedCountryCode(country.code),
      `${JSON.stringify(country)} is not the two-letter shape every gate in this repo compares`
    );
    assert.equal(country.code, country.code.toUpperCase(), `${country.code} is not upper case — Set.has() is case-sensitive`);
    assert.ok(country.name && country.name !== country.code, `${country.code} has no readable name — a person picks Spain, not ES`);
    assert.ok(!seenCodes.has(country.code), `${country.code} is offered twice`);
    // Duplicate NAMES are the failure mode of building this list from ICU
    // without dropping withdrawn codes: DD and DE both read "Germany".
    assert.ok(!seenNames.has(country.name), `two options both read "${country.name}"`);
    seenCodes.add(country.code);
    seenNames.add(country.name);
  }

  // ISO 3166-1's officially assigned alpha-2 code space.
  assert.equal(seenCodes.size, 249, "the list is no longer the ISO code space — see src/portal/countries.js");
});

test("no country the gates can act on is missing from the picker", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const offered = new Set(res.body.countries.map((c) => c.code));

  // THE LOAD-BEARING ONE. Remote's own registry omits the sanctioned set, so a
  // picker built from `GET /v1/countries` could not offer Iran at all and the
  // hard block below would be unreachable from the form — a control nobody can
  // trigger is a control nobody can check.
  for (const code of SANCTIONED_OR_RESTRICTED) {
    assert.ok(offered.has(code), `${code} is a hard block nobody can select, so nobody can see it refuse`);
  }
  for (const code of SCHENGEN) assert.ok(offered.has(code), `Schengen member ${code} cannot be picked`);
  for (const code of DNV_COUNTRIES) assert.ok(offered.has(code), `digital-nomad-visa country ${code} cannot be picked`);
  for (const code of KNOWN_DESTINATIONS) assert.ok(offered.has(code), `the risk matrix knows ${code} but nobody can pick it`);
  for (const row of MOCK_COUNTRIES) {
    assert.ok(offered.has(row.alpha_2_code), `Remote's registry lists ${row.alpha_2_code} and the picker does not`);
  }
});

test("the picker is deliberately WIDER than anything that could narrow it", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const offered = new Set(res.body.countries.map((c) => c.code));

  // Each of these three would have been a defensible-looking source, and each
  // hides a real behaviour. Asserting the picker is a strict superset is how
  // the next person who "tidies" it finds out.
  assert.ok(offered.size > KNOWN_DESTINATIONS.size, "narrowed to the matrix — the escalate-by-default path would vanish");
  assert.ok(offered.size > MOCK_COUNTRIES.length, "narrowed to the mock's illustrative subset — Canada is not even in it");
  assert.ok(offered.size > 224, "narrowed to Remote's supported registry — the sanctions demo would be unreachable");

  // And the specific consequence, named: an unevaluated destination is still
  // offerable. Antarctica is in no risk table anywhere in this repo.
  assert.ok(offered.has("AQ") && !KNOWN_DESTINATIONS.has("AQ"), "a destination with no rule written for it must still be pickable");
});

// ---------------------------------------------------------------------------
// 3. The renderer — code as value, name as label, nothing decided in the page
// ---------------------------------------------------------------------------

/** A DOM just big enough for a <select> with <optgroup>s. */
function domSandbox(selects) {
  const make = (tag) => ({
    tag,
    className: null,
    textContent: "",
    value: "",
    label: null,
    childNodes: [],
    attrs: {},
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    addEventListener() {},
    // The fake node grew a dispatcher on 2026-08-28, when setFieldValue()
    // started announcing its own writes. Recording listeners rather than
    // discarding them, so a test can assert that a programmatic fill is
    // ANNOUNCED — which is the property that was broken: a quick-fill set
    // .value directly, nothing fired, and the character counter under the box
    // sat at "0/500" above 48 characters of text.
    dispatched: [],
    dispatchEvent(event) {
      this.dispatched.push(event.type);
      return true;
    },
  });
  const document = {
    createElement: make,
    createTextNode: (text) => Object.assign(make("#text"), { textContent: String(text) }),
    querySelectorAll: () => selects,
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  return { document, el, make };
}

/** Lift one function out of app.js by name, up to the next one. */
function cut(name, until) {
  const source = read("app.js");
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${until}(`, start);
  assert.ok(start !== -1 && end > start, `${name}() has moved — re-point this test`);
  return source.slice(start, end);
}

function renderInto(select, countries, demoCodes) {
  const { document, el } = domSandbox([select]);
  const context = { document, el, clear: (node) => (node.childNodes.length = 0) };
  vm.createContext(context);
  vm.runInContext(cut("renderCountrySelects", "setFieldValue"), context);
  vm.runInContext("renderCountrySelects(COUNTRIES, DEMO)", Object.assign(context, { COUNTRIES: countries, DEMO: demoCodes }));
  return select;
}

test("the renderer puts the CODE in the value and the NAME in the label", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const { make } = domSandbox([]);
  const select = make("select");
  select.setAttribute("data-blank", "country");

  renderInto(select, res.body.countries, res.body.demoCountries);

  const [blank, ...groups] = select.childNodes;
  assert.equal(blank.tag, "option");
  assert.equal(blank.value, "", "the first option must submit an empty string — blank still means unknown");
  assert.equal(blank.textContent, "country", "the empty option's wording comes from the field, not the renderer");

  const options = groups.flatMap((group) => group.childNodes);
  const byName = new Map(options.map((o) => [o.textContent, o.value]));
  assert.equal(byName.get("Spain"), "ES");
  assert.equal(byName.get("Netherlands"), "NL");
  assert.equal(byName.get("Iran"), "IR");

  for (const option of options) {
    assert.ok(isWellFormedCountryCode(option.value), `an option submits ${JSON.stringify(option.value)}`);
    assert.notEqual(option.textContent, option.value, "the label must be the country's name, not its code");
  }

  // The demo four are reachable without scrolling, AND still in their
  // alphabetical place — the duplicate is a shortcut, not a second country.
  assert.deepEqual(groups.map((g) => g.label), ["Used in this demo", "All countries"]);
  assert.deepEqual(groups[0].childNodes.map((o) => o.value), DEMO_COUNTRY_CODES);
  assert.equal(groups[1].childNodes.length, res.body.countries.length);
});

test("the renderer holds no policy: it filters nothing and reorders nothing", async () => {
  const res = await call(portal(), { path: "/api/context" });
  const { make } = domSandbox([]);
  const select = make("select");
  renderInto(select, res.body.countries, res.body.demoCountries);

  const all = select.childNodes[select.childNodes.length - 1].childNodes;
  assert.deepEqual(
    all.map((o) => o.value),
    res.body.countries.map((c) => c.code),
    "the page changed the list it was given — the order and the membership are the server's"
  );

  const source = cut("renderCountrySelects", "setFieldValue");
  for (const banned of [/SANCTION/i, /schengen/i, /eor_onboarding/i, /\bblocked\b/]) {
    assert.ok(!banned.test(source), `the renderer mentions ${banned} — it must express no policy`);
  }
});

test("a value the picker has no option for is kept visible, never silently dropped", () => {
  // A <select> given an unknown value lands on "" and reports nothing. A
  // quick-fill or a continuation prefill naming such a code would then submit
  // "no country stated", and the refusal that came back would name the wrong
  // thing. This is the guard.
  const { document, el, make } = domSandbox([]);
  const select = make("select");
  // Behave like a real <select>: only accept a value one of its options has.
  Object.defineProperty(select, "value", {
    get() {
      return this._value || "";
    },
    set(next) {
      this._value = this.childNodes.some((o) => o.value === next) || next === "" ? next : "";
    },
  });
  select.appendChild(Object.assign(el("option", null, "Spain"), { value: "ES" }));

  // `Event` is a browser global the sandbox has to supply, like `document`.
  const context = { document, el, Event: class { constructor(type) { this.type = type; } } };
  vm.createContext(context);
  vm.runInContext(cut("setFieldValue", "renderScenarios"), context);
  vm.runInContext("setFieldValue(SELECT, 'ES')", Object.assign(context, { SELECT: select }));
  assert.equal(select.value, "ES");

  vm.runInContext("setFieldValue(SELECT, 'ZW')", context);
  assert.equal(select.value, "ZW", "an unknown code was swallowed by the picker");
  assert.match(select.childNodes[select.childNodes.length - 1].textContent, /ZW/, "the unknown code must be visible on the form");

  vm.runInContext("setFieldValue(SELECT, '')", context);
  assert.equal(select.value, "", "clearing a picker must not manufacture an option");

  // A PROGRAMMATIC FILL MUST ANNOUNCE ITSELF. Assigning `.value` fires no
  // event, so anything bound to `input` — the character counter, the
  // continuation's gap marks — never learns the box changed. Asserted on the
  // clear as well as the fills: emptying a box is a change too, and a counter
  // left reading the old length is the same defect mirrored.
  assert.deepEqual(
    select.dispatched,
    ["input", "change", "input", "change", "input", "change"],
    "setFieldValue stopped announcing its writes — anything listening for a change will miss a quick-fill"
  );
});

// ---------------------------------------------------------------------------
// 4. The quick-fills — every scenario value is something the picker can hold
// ---------------------------------------------------------------------------

test("no scenario quick-fill names a country the picker cannot select", () => {
  const app = read("app.js");
  const start = app.indexOf("  var SCENARIOS = {");
  const end = app.indexOf("\n  };", start);
  assert.ok(start !== -1 && end > start, "SCENARIOS has moved — re-point this test");
  const context = { SCENARIOS: null };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end + 4).replace("var SCENARIOS =", "SCENARIOS ="), context);

  let checked = 0;
  for (const [typeId, scenarios] of Object.entries(context.SCENARIOS)) {
    for (const scenario of scenarios) {
      for (const [field, value] of Object.entries(scenario.fields || {})) {
        if (!COUNTRY_FIELDS.includes(field)) continue;
        checked += 1;
        if (value === "") continue;
        assert.ok(
          CODES.has(value),
          `${typeId}/${scenario.id} fills ${field} with "${value}", which the picker cannot hold — it would submit blank`
        );
      }
    }
  }
  assert.ok(checked > 0, "no scenario fills a country field — this test is asserting nothing");
});

// ---------------------------------------------------------------------------
// 5. THE POSITIVE TESTS — the emitted shape reaches a real decision
// ---------------------------------------------------------------------------
// A picker that renders correctly and emits the wrong shape passes every
// assertion above. These take the value the picker itself would submit for a
// named country and run it through the real handler into the real gates.

/** Exactly what the browser submits when a person picks this country's name. */
function pick(name) {
  const country = PORTAL_COUNTRIES.find((c) => c.name === name);
  assert.ok(country, `the picker offers no country called ${name}`);
  return country.code;
}

const BASE_TRIP = {
  persona: "admin",
  employmentId: "09b65526-643b-4956-959b-916e6429bd23", // Anna Müller — DE, employee, active
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
  reasonText: "Two weeks with the Madrid team.",
  now: "2026-08-15",
};

test("POSITIVE: picking Germany, Germany and Spain reaches a real decision on a real trip", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "picker-positive-uc04",
      homeCountry: pick("Germany"),
      nationality: pick("Germany"),
      destinationCountry: pick("Spain"),
      travelHistory: [
        { country: "", startDate: "", endDate: "" },
        { country: "", startDate: "", endDate: "" },
      ],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(
    res.body.decision,
    "ready_for_approval",
    `the picker's own value did not reach a decision: ${JSON.stringify(res.body)}`
  );
  // And the gates read the destination the picker sent, not a normalised guess.
  // ASSERTED ON THE NAME, because that is what the panel prints: the picker
  // emits `ES`, every gate compares `ES`, and every sentence a person reads
  // says Spain (src/shared/countryNames.js's division). This assertion used to
  // look for the code and would now pass only by finding one that had escaped
  // the naming.
  //
  // READ OFF THE WHOLE ENVELOPE AND NOT OFF `details`. It used to search the
  // facts table, and the row that carried the name there on an undated trip
  // with no prior stays was the DRAFTED SUMMARY — prose written for the
  // mobility specialist, which is now published as a specialistDetail() and
  // reaches the Zendesk note rather than the requester's panel. The claim this
  // test makes is about what a PERSON READS, so it is asserted against
  // everything the page is given; the sentence that actually carries it now is
  // the plain answer's, which names the destination in words at the top of the
  // panel ("the request to work from Spain is prepared and waiting on...").
  assert.ok(
    JSON.stringify(res.body).includes("Spain"),
    "the decision never names the destination that was picked"
  );
  assert.match(res.body.plainAnswer.lead, /Spain/, "the answer the requester reads does not name where they are going");
});

test("POSITIVE: a prior stay picked from the list reaches the day counts", async () => {
  // The row the project owner pointed at, filled the way it is now filled.
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "picker-positive-uc04-history",
      homeCountry: pick("Germany"),
      nationality: pick("Germany"),
      destinationCountry: pick("Spain"),
      travelHistory: [
        { country: pick("Spain"), startDate: "2026-07-01", endDate: "2026-08-14" },
        { country: pick("Spain"), startDate: "2025-10-01", endDate: "2026-02-28" },
      ],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "ready_for_approval");
  assert.ok(
    res.body.flags.includes("tax_residency_watch"),
    `the picked stays never reached the day counts: ${res.body.flags}`
  );
});

test("NEGATIVE, and it must remain reachable: picking Iran is blocked by name", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "picker-negative-uc04",
      homeCountry: pick("Germany"),
      nationality: pick("Germany"),
      destinationCountry: pick("Iran"),
      travelHistory: [
        { country: "", startDate: "", endDate: "" },
        { country: "", startDate: "", endDate: "" },
      ],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.decision, "blocked");
  assert.match(String(res.body.reason), /sanctioned/i, `Iran was refused for the wrong reason: ${res.body.reason}`);
});

test("POSITIVE: a destination no risk rule covers escalates honestly rather than being unpickable", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc04",
    body: {
      ...BASE_TRIP,
      externalRef: "picker-unevaluated-uc04",
      homeCountry: pick("Germany"),
      nationality: pick("Germany"),
      destinationCountry: pick("Bhutan"), // in no risk table in this repo
      visaType: "business_visa",
      travelHistory: [
        { country: "", startDate: "", endDate: "" },
        { country: "", startDate: "", endDate: "" },
      ],
    },
  });

  assert.equal(res.status, 200);
  assert.ok(
    ["escalate", "blocked", "ready_for_approval", "human_review"].includes(res.body.decision),
    `an unevaluated destination produced no decision at all: ${JSON.stringify(res.body)}`
  );
  assert.notEqual(res.body.decision, "auto_approve", "a destination nobody wrote a rule for must never be auto-approved");
});

test("POSITIVE: the tax form's picked countries reach a real day count", async () => {
  const res = await call(portal(), {
    method: "POST",
    path: "/api/requests/uc08",
    body: {
      persona: "admin",
      text: "I have been splitting my time between Germany and the United Kingdom — am I a dual resident?",
      externalRef: "picker-positive-uc08",
      targetCountry: pick("United Kingdom"),
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
      presencePeriods: [
        { country: pick("United Kingdom"), startDate: "2026-01-01", endDate: "2026-03-31" },
        { country: pick("Germany"), startDate: "2026-04-01", endDate: "2026-04-30" },
      ],
    },
  });

  assert.equal(res.status, 200);
  const presence = res.body.details.find((d) => d.label === "Presence days");
  assert.ok(presence, "the tax dossier reported no presence line at all");
  // Named, not coded: the picker sends `GB`, the calculator normalises and
  // counts against `GB`, and the row a person reads says United Kingdom.
  assert.match(
    presence.value,
    /^90 distinct day\(s\) in United Kingdom\b/,
    `the picked countries were not counted: ${presence.value}`
  );
  assert.match(presence.value, /1 of 2 supplied record\(s\)/, "the German stay must not be counted as UK presence");
});
