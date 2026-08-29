// ---------------------------------------------------------------------------
// n8nUc03Parity.test.js — the n8n "Travel Router Gates" Code node must agree
// with policyEngine.js, the classifier's rule fallback, and
// workflow.js's buildUc04HandoffEvent()
// ---------------------------------------------------------------------------
// Same reasoning as n8nUc06Parity.test.js / n8nUc08Parity.test.js: UC-03's
// decision logic exists twice — once as src/uc03/policyEngine.js (plus the
// classifier's deterministic fallback and the UC-04 handoff builder), and once
// as the "Travel Router Gates" Code node in workflows/nodes-uc03/. This
// executes the ACTUAL node body (workflows/nodes-uc03/travelRouterGates.js) in
// a sandbox and asserts it reaches the same decision/reason/flags/durationDays
// as policyEngine.evaluate() — and, on route_to_uc04, emits the same handoff
// event as buildUc04HandoffEvent() — for every scenario in
// docs/use-cases/UC-03.md §12, mapped onto the real built gates.
//
// Honesty note: §12's two "route elsewhere" intentions (tax-residency -> UC-08,
// permanent-move -> UC-07) are NOT built as routes in this repository — see
// docs/use-cases/UC-03.md §15. The built router only routes work-authorization
// intent to UC-04; everything else goes through escalate per policyEngine.js.
// The node does not invent a UC-08/UC-07 gate that the real evaluate() does
// not have. Those two §12 items therefore resolve to escalate here, marked as
// such in their scenario names.
//
// Everything here is hermetic: nothing touches the network, OpenAI, or any
// live service. The node body is run inside a `node:vm` sandbox with `$()` and
// `$input` mocked; both sides are JSON-round-tripped before comparison because
// node:vm results are cross-realm (a real bug the project hit once already).
// ---------------------------------------------------------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { evaluate, computeDurationDays } from "../src/uc03/policyEngine.js";
import { classifyTravelInquiryRuleBased, KNOWN_COUNTRIES, restrictedDestinationNames } from "../src/uc03/classifier.js";
import { verifyRequester } from "../src/shared/identity.js";
import { buildUc04HandoffEvent } from "../src/uc03/workflow.js";
import { LIVE_COUNTRY_ROWS, LIVE_COUNTRIES_ENVELOPE, LIVE_ALPHA_2 } from "./fixtures/remoteCountries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_PATH = join(__dirname, "..", "workflows", "nodes-uc03", "travelRouterGates.js");
const nodeSource = readFileSync(NODE_PATH, "utf8");

/**
 * Run the "Travel Router Gates" Code node with n8n's globals mocked.
 * Mirrors runUc06AmendmentGatesNode / runBuildDossierNode in the sibling
 * parity tests. `classification` is the RAW output of the predecessor
 * "Classify Inquiry" node (an empty shape = no LLM result).
 */
function runTravelRouterNode({ request, employment, countries, countriesEnvelope, classification }) {
  // `countriesEnvelope` is the ESCAPE HATCH for the real wire shape: the live
  // API answers `{data: [...]}` (array directly under `data`), the mock answers
  // `{data: {countries: [...]}}`, and an n8n HTTP node passes whichever it got
  // through untouched. Tests that care about the SHAPE supply the whole
  // envelope; the rest keep using the mock-shaped `countries` convenience.
  const countriesJson = countriesEnvelope ?? { data: { countries } };
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Inquiry") return { first: () => ({ json: request }) };
      if (nodeName === "Fetch Employment (Remote)") return { first: () => ({ json: { data: { employment } } }) };
      if (nodeName === "Fetch Countries (Remote)") return { first: () => ({ json: countriesJson }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // $input.first().json — the immediate predecessor: "Classify Inquiry".
    $input: { first: () => ({ json: classification }) },
  };
  const wrapped = `(function () {\n${nodeSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  // Round-trip through JSON — the cross-realm reasoning from n8nParity.test.js.
  return JSON.parse(JSON.stringify(result[0].json));
}

// The real mock-supported codes (mockServer.js COUNTRIES). Canada ("CA") is
// deliberately absent — the fail-closed fixture the unsupported test relies on.
const SUPPORTED_CODES = [
  "DE", "EE", "ES", "FR", "GB", "IE", "IN", "IT", "MX", "NG", "NL", "PH", "PL", "PT", "US",
];
const supportedCountries = (codes = SUPPORTED_CODES) => codes.map((c) => ({ country_code: c, name: c }));

const countriesAll = () => supportedCountries();
const countriesNoCA = () => supportedCountries(); // SUPPORTED_CODES has no CA by design

// THE ROWS THE LETTER TEMPLATE ASSERTS ARE ON THIS FIXTURE ON PURPOSE. It was a
// four-field stub until the letter-scope gate landed, which meant every letter
// scenario failed template completeness and the STANDARD outcome could not be
// reached from this file at all — a fixture that cannot render a letter cannot
// test the gate that decides whether one may be drafted.
const ACTIVE_EMP = {
  id: "emp_active_001",
  status: "active",
  country_code: "NG",
  full_name: "Amara Okafor",
  job_title: "Senior Engineer",
  contract_type: "full_time",
  start_date: "2022-03-01",
};
const TERMINATED_EMP = { id: "emp_terminated_002", status: "terminated", country_code: "NG" };
const ACTIVE_SESSION = { authenticatedEmploymentId: "emp_active_001" };

// No LLM result — the default, so scenarios exercise the rule-based fallback.
const NO_LLM_RESPONSE = () => ({ choices: [] });
const llmResponseFor = (classification) => ({
  choices: [{ message: { content: JSON.stringify(classification) } }],
});

const SCENARIOS = [
  {
    // §12.1 simple business-travel request -> auto_resolve (built as the
    // informational answer, not an auto-issued letter — see §15).
    name: "§12.1 business travel, supported, under cap -> auto_resolve",
    request: {
      text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
    },
  },
  {
    // §12.2 an explicit formal-letter request -> human_review (the HITL
    // boundary built here; UC-03 has no separate "personal no-objection" letter
    // type, so any explicit letter request goes behind the human gate).
    name: "§12.2 explicit travel support letter -> human_review",
    request: {
      text: "I want a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
    },
  },
  {
    // §12.3 actively working from abroad -> UC-04, whatever the duration.
    name: "§12.3 work remotely from abroad -> route_to_uc04",
    request: {
      text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    },
  },
  {
    // §12.4 explicit tax-residency question: NO UC-08 route is built — see the
    // header. The built router escalates (here: destination_unknown).
    name: "§12.4 explicit tax-residency question -> escalate (no UC-08 route exists)",
    request: { text: "Can you tell me my tax-residence rules if I travel abroad?" },
  },
  {
    // §12.5 permanent-move language. NO UC-07 route is built — see the header.
    name: "§12.5 permanent-move language -> escalate (no UC-07 route exists)",
    request: { text: "I'm moving permanently abroad to live." },
  },
  {
    // §12.6 ambiguous phrasing: no destination named -> cannot route -> escalate.
    name: "§12.6 ambiguous phrasing, no destination -> escalate",
    request: { text: "Can I travel for work somewhere next month?" },
  },
  {
    // §12.7 restricted-destination letter request -> blocked, never auto-issued.
    // The sanctioned code arrives here via a VALIDATED LLM classification, which
    // is the point of this scenario: it exercises the LLM-used path. The
    // rule-based path now resolves "russia" too (it did not until 2026-08-19,
    // which is how the sanctions gate came to be dead on that path) and is
    // covered separately by the free-text scenario further down and by the
    // per-name behavioural test at the end of this file.
    name: "§12.7 restricted-destination letter request -> escalate (sanctioned_region)",
    request: { text: "I need a travel support letter for a trip abroad next month." },
    classify: {
      intent: "business_travel",
      destinationCountry: "RU",
      startDate: null,
      endDate: null,
      formalLetterRequested: true,
      confidence: 0.9,
    },
  },
  {
    // §12.8 an inactive employee -> exception, never supported or routed.
    name: "§12.8 inactive employee -> escalate (employee_not_active)",
    request: {
      text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
      employmentId: "emp_terminated_002",
      session: { authenticatedEmploymentId: "emp_terminated_002" },
    },
    employment: TERMINATED_EMP,
  },
  {
    name: "duration_over_cap -> escalate",
    request: { text: "Business meetings in India from 2026-09-01 to 2026-10-31." },
  },
  {
    name: "destination_jurisdiction_excluded -> escalate",
    request: { text: "Client meeting in Canada from 2026-09-01 to 2026-09-05." },
  },
  {
    name: "duration_unknown -> escalate",
    request: { text: "Client meeting in France — can I travel?" },
  },
  {
    name: "at-cap duration (30d) auto-resolves",
    request: { text: "Client meeting in Spain from 2026-09-01 to 2026-09-30." },
  },
  // The destination-slot defect, in the copy that runs in production. The
  // destination used to be the first dictionary key found anywhere in the text,
  // so the country being LEFT won whenever it was typed first in the map.
  // Parity alone would never have caught it: both copies picked the same wrong
  // country. Only an absolute expectation does.
  {
    name: "origin named before destination -> the destination is the cued country",
    request: { text: "I'm travelling from Spain to Germany for a client meeting from 2026-09-14 to 2026-09-20." },
    expectDestination: "DE",
  },
  {
    name: "'work from X' is still the destination (UC-03's origin is the employment record)",
    request: { text: "I'd like to work remotely from Portugal from 2026-09-01 to 2026-09-20." },
    expectDestination: "PT",
  },
  {
    name: "a country name inside a longer word is not a destination",
    request: { text: "Conference in Indianapolis from 2026-09-01 to 2026-09-05." },
    expectDestination: null,
  },
  // The dead sanctions gate, in the copy that runs in production, driven from
  // RAW TEXT with no classification supplied. Parity alone would not have caught
  // this either — both copies resolved Iran to null and both said
  // `destination_unknown`, agreeing perfectly on the wrong reason. Only an
  // absolute expectation on the destination and the reason does.
  {
    name: "POSITIVE: a sanctioned destination named in free text escalates AS sanctioned",
    request: { text: "Client meeting in Iran from 2026-09-01 to 2026-09-05." },
    expectDestination: "IR",
    expectReason: "sanctioned_region",
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n Travel Router Gates match policyEngine — ${scenario.name}`, () => {
    const request = {
      employmentId: "emp_active_001",
      session: ACTIVE_SESSION,
      source: "zendesk",
      externalRef: "3001",
      ...scenario.request,
    };
    const employment = scenario.employment ?? ACTIVE_EMP;
    const classification = scenario.classify ? llmResponseFor(scenario.classify) : NO_LLM_RESPONSE();

    const fromN8n = runTravelRouterNode({
      request,
      employment,
      countries: countriesNoCA(),
      classification,
    });

    // Expected classification: rule-based when the node saw no validated LLM
    // classification, else that validated classification — the node's own
    // validate-then-use/-fallback choice, reproduced for the expectation.
    const expectedClassification = scenario.classify
      ? { ...scenario.classify }
      : classifyTravelInquiryRuleBased({ text: request.text });

    const expectedIdentity = verifyRequester({
      session: request.session ?? null,
      employment: fromN8n.employment,
      requesterType: "self",
    });

    const expected = evaluate({
      employment: fromN8n.employment,
      classification: expectedClassification,
      identity: expectedIdentity,
      supportedCountries: new Set(SUPPORTED_CODES),
      // The node reads `request.text` for the letter-scope gate, so the
      // reference must be given the same words or the two copies are being
      // asked different questions. Omitting it here would have shown up as a
      // parity failure — which it did, and this is the fix.
      requestText: request.text ?? null,
    });

    // Parity proves the two copies agree; only this proves they are both RIGHT.
    if ("expectDestination" in scenario) {
      assert.equal(
        fromN8n.classification.destinationCountry,
        scenario.expectDestination,
        `destinationCountry is not the country the text names (${scenario.name})`
      );
    }

    // Same reasoning one field over: parity would happily agree on
    // `destination_unknown` for a country neither copy can resolve. A scenario
    // that names the reason it must produce is the only thing that separates a
    // gate that fired from a gate that could not.
    if ("expectReason" in scenario) {
      assert.equal(
        fromN8n.reason,
        scenario.expectReason,
        `the node refused for the wrong reason (${scenario.name})`
      );
    }

    assert.equal(fromN8n.decision, expected.decision, `decision differs (${scenario.name})`);
    assert.equal(fromN8n.reason, expected.reason, `reason differs (${scenario.name})`);
    assert.deepEqual(fromN8n.flags, expected.flags, `flags differ (${scenario.name})`);
    assert.equal(fromN8n.durationDays, expected.durationDays, `durationDays differ (${scenario.name})`);
    if (expected.route) assert.equal(fromN8n.route, expected.route, `route differs (${scenario.name})`);
  });
}

test("the n8n node body parses and returns n8n's zero-touch item shape", () => {
  const request = {
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "3111",
  };
  const out = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: NO_LLM_RESPONSE() });
  assert.equal(out.decision, "auto_resolve");
  assert.equal(out.reason, "all_gates_passed");
  assert.equal(out.durationDays, 19);
  assert.deepEqual(out.flags, []);
  assert.equal(out.identity.verified, true);
  assert.equal(out.classification.source, "rule_based_fallback");
});

test("route_to_uc04 produces buildUc04HandoffEvent's exact handoff event", () => {
  const request = {
    text: "I'd like to work remotely from Portugal for a month while on holiday.",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "ZT-3002",
  };
  const from = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: NO_LLM_RESPONSE() });
  assert.equal(from.decision, "route_to_uc04");
  assert.equal(from.route, "uc04_work_authorization");
  const expectedEvent = buildUc04HandoffEvent({
    employment: from.employment,
    classification: from.classification,
    externalRef: "ZT-3002",
  });
  assert.deepEqual(from.handoffEvent, expectedEvent);
});

test("a valid validated LLM classification is used instead of the rule fallback", () => {
  const request = {
    text: "Some ambiguous travel text.",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "3222",
  };
  const llm = llmResponseFor({
    intent: "business_travel",
    destinationCountry: "ES",
    startDate: "2026-09-01",
    endDate: "2026-09-05",
    formalLetterRequested: false,
    confidence: 0.95,
  });
  const from = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: llm });
  assert.equal(from.classification.source, "llm");
  assert.equal(from.classification.destinationCountry, "ES");
  assert.equal(from.decision, "auto_resolve");
});

test("an invalid LLM classification falls back to rules, never crashes", () => {
  const request = {
    text: "Business meetings in Spain from 2026-09-14 to 2026-10-02.",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "3333",
  };
  const llm = { choices: [{ message: { content: JSON.stringify({ intent: "not_a_real_intent" }) } }] };
  const from = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: llm });
  assert.equal(from.classification.source, "rule_based_fallback");
  assert.equal(from.classification.destinationCountry, "ES");
  assert.equal(from.decision, "auto_resolve");
});

test("identity fails closed — no session, no support", () => {
  const request = {
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    employmentId: "emp_active_001",
    session: null,
    source: "zendesk",
    externalRef: "3444",
  };
  const from = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: NO_LLM_RESPONSE() });
  assert.equal(from.decision, "escalate");
  assert.equal(from.reason, "identity_not_verified");
  assert.deepEqual(from.flags, ["identity_unauthenticated_requires_stepup"]);
});

// ---------------------------------------------------------------------------
// IDENTITY MUST NEVER BE PROVED AGAINST AN ECHO OF THE CALLER'S OWN REQUEST
// ---------------------------------------------------------------------------
// The node builds its `employment` object from the "Fetch Employment (Remote)"
// response. When that fetch returns nothing usable (404, outage, an error
// branch, a body in an unexpected shape) the node used to BACKFILL the record's
// `id` from `request.employmentId` — a caller-supplied value — and then verify
// identity by comparing `session.authenticatedEmploymentId` against it. A
// caller who sends the same id in both places therefore "verified" against
// itself: `verified: true, method: "session"`, having proved nothing at all.
// That is prime directive #3 inverted ("identity comes from an authenticated
// signal, never a claim"), and it failed closed only by accident — the NEXT
// gate (`employment.status !== 'active'`) happened to catch the run.
//
// The reference implementation has no such hole: RemoteClient.getEmployment()
// returns `null` on a 404, so src/uc03/workflow.js hands `null` to
// verifyRequester(), which answers `no_employment_record`. These tests pin the
// node to that same behaviour — at the IDENTITY gate, not at a later one.
const NO_EMPLOYMENT_FIXTURES = [
  ["a 404 (no record at all)", undefined],
  ["an empty body", {}],
  ["a body with no id", { status: "active", country_code: "NG" }],
];

for (const [label, employment] of NO_EMPLOYMENT_FIXTURES) {
  test(`identity fails closed on ${label}, even when the session id matches the requested employmentId`, () => {
    const request = {
      text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
      employmentId: "emp_active_001",
      // The attack shape: the caller controls BOTH sides of the comparison.
      session: { authenticatedEmploymentId: "emp_active_001" },
      source: "zendesk",
      externalRef: "3666",
    };
    const from = runTravelRouterNode({
      request,
      employment,
      countries: countriesAll(),
      classification: NO_LLM_RESPONSE(),
    });

    assert.equal(from.identity.verified, false, "a caller-supplied id must never verify against itself");
    assert.equal(from.identity.reason, "no_employment_record");
    assert.notEqual(from.identity.method, "session", "there was no authenticated record to match a session against");

    // And it must be the IDENTITY gate that stops it — not the employment-status
    // gate downstream. Relying on a later gate to compensate for an unsound
    // identity signal is the "one bug away" shape this codebase rejects.
    assert.equal(from.decision, "escalate");
    assert.equal(from.reason, "identity_not_verified");
    assert.deepEqual(from.flags, ["identity_no_employment_record"]);

    // Parity with the reference implementation's own answer for "no record".
    // G-3 added a `pending` field to EVERY branch of verifyRequester()'s
    // return shape (UC-01's third-party consent regime needs to distinguish
    // "pending" from "refused" — see identity.js's header); UC-03's own n8n
    // port was not touched by that build and never produces the field, so
    // it is added here for the comparison rather than to the node itself.
    assert.deepEqual(
      { ...from.identity, pending: false },
      verifyRequester({ session: request.session, employment: null, requesterType: "self" })
    );
  });
}

test("a failed employment fetch is represented as no record — never a placeholder echoing the request", () => {
  const request = {
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    employmentId: "emp_active_001",
    session: { authenticatedEmploymentId: "emp_active_001" },
    source: "zendesk",
    externalRef: "3777",
  };
  const from = runTravelRouterNode({
    request,
    employment: {},
    countries: countriesAll(),
    classification: NO_LLM_RESPONSE(),
  });
  // The reference implementation's value for this case is literally `null`
  // (RemoteClient.getEmployment()'s documented 404 convention). The node emits
  // the same value, so no downstream reader can mistake a synthesized record
  // for an authoritative one.
  assert.equal(from.employment, null);
});

test("the email identity path also fails closed when no employment record came back", () => {
  // The Zendesk channel's path: without a record there is no authoritative
  // email to match the authenticated requester against either.
  const request = {
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
    employmentId: "emp_active_001",
    session: { authenticatedEmail: "alexandre@example.com" },
    source: "zendesk",
    externalRef: "3888",
  };
  const from = runTravelRouterNode({
    request,
    employment: {},
    countries: countriesAll(),
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(from.identity.verified, false);
  assert.equal(from.identity.reason, "no_employment_record");
  assert.equal(from.decision, "escalate");
});

test("computeDurationDays parity — the node recomputes, it never trusts an LLM number", () => {
  const request = {
    text: "business trip",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "3555",
  };
  const llm = llmResponseFor({
    intent: "business_travel",
    destinationCountry: "ES",
    startDate: "2026-03-01",
    endDate: "2026-03-22",
    formalLetterRequested: false,
    confidence: 0.9,
  });
  const from = runTravelRouterNode({ request, employment: ACTIVE_EMP, countries: countriesAll(), classification: llm });
  assert.equal(from.durationDays, computeDurationDays("2026-03-01", "2026-03-22"));
  assert.equal(from.durationDays, 22);
});

test("the n8n node body parses and the source compiles", () => {
  // Same guard as n8nParity.test.js's equivalent — a Code node body is a string
  // to n8n, so a broken one deploys happily and only fails mid-execution.
  assert.doesNotThrow(() => new Function(nodeSource), "travelRouterGates.js does not compile");
});

// ---------------------------------------------------------------------------
// F-25 — the supported-countries gate was dead in BOTH copies
// ---------------------------------------------------------------------------
// The Code node accepted only `c.country_code`; the live `GET /v1/countries`
// sends `alpha_2_code` ("ES") and `code` ("ESP") and no `country_code` at all,
// so `supportedList` came back EMPTY from a successful 224-row fetch (n8n
// execution 4259, verbatim: `"supportedCountries": []`). Every destination then
// escalated as `unsupported_destination`, which is indistinguishable from the
// gate working — the failure mode this whole block exists to make visible.
//
// The parity discipline is what makes this a pair of tests rather than one:
// `src/remote/restClient.js` and this node normalise the same wire shape
// independently, so both are driven from the same verbatim live fixture here.
//
// The countries envelope below is the REAL one — the array sits directly under
// `data`, not under `data.countries`. That difference is load-bearing: the n8n
// HTTP node does not unwrap anything, so the node body sees exactly this.

const SPAIN_REQUEST = {
  text: "Client meeting in Spain from 2026-09-14 to 2026-09-20 — is business travel fine?",
  employmentId: "emp_active_001",
  session: ACTIVE_SESSION,
  source: "zendesk",
  externalRef: "3925",
};

test("F-25: the node reads the LIVE countries shape — Spain is supported, so the trip auto-resolves", () => {
  const from = runTravelRouterNode({
    request: SPAIN_REQUEST,
    employment: ACTIVE_EMP,
    countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
    classification: NO_LLM_RESPONSE(),
  });
  assert.deepEqual(from.supportedCountries.slice().sort(), LIVE_ALPHA_2.slice().sort(), "alpha-2 codes, never the alpha-3 `code` field");
  assert.equal(from.decision, "auto_resolve", "this was `escalate`/`unsupported_destination` in production");
  assert.equal(from.reason, "all_gates_passed");

  // Parity: the reference engine, given the same normalised list, agrees.
  const expected = evaluate({
    employment: from.employment,
    classification: from.classification,
    identity: from.identity,
    supportedCountries: new Set(LIVE_ALPHA_2),
  });
  assert.equal(from.decision, expected.decision);
  assert.equal(from.reason, expected.reason);
  assert.deepEqual(from.flags, expected.flags);
});

test("F-25: the node still reads the MOCK's flat country_code shape", () => {
  const from = runTravelRouterNode({
    request: SPAIN_REQUEST,
    employment: ACTIVE_EMP,
    countries: countriesAll(),
    classification: NO_LLM_RESPONSE(),
  });
  assert.deepEqual(from.supportedCountries.slice().sort(), SUPPORTED_CODES.slice().sort());
  assert.equal(from.decision, "auto_resolve");
});

// --- fail-closed: the half of the pair that keeps the fix from opening a hole.
// UC-03's auto_resolve posts a PUBLIC reply and solves a real ticket, so each
// of these is a customer-visible wrong answer if it regresses, not a log line.
const FAIL_CLOSED_ENVELOPES = [
  ["an empty list", { data: [] }],
  ["an empty mock-shaped list", { data: { countries: [] } }],
  ["a null body", { data: null }],
  ["a string where the list should be", { data: "unavailable" }],
  ["an object where the list should be", { data: { message: "unexpected" } }],
  ["rows with no placeable code at all", { data: [{ name: "Spain" }, { name: "Germany" }] }],
  ["rows carrying ONLY the alpha-3 code", { data: [{ code: "ESP", name: "Spain" }, { code: "DEU", name: "Germany" }] }],
];

for (const [label, envelope] of FAIL_CLOSED_ENVELOPES) {
  test(`F-25 fail-closed: ${label} confirms nothing supported — Spain still escalates`, () => {
    const from = runTravelRouterNode({
      request: SPAIN_REQUEST,
      employment: ACTIVE_EMP,
      countriesEnvelope: envelope,
      classification: NO_LLM_RESPONSE(),
    });
    assert.deepEqual(from.supportedCountries, [], `${label}: nothing may enter the supported set`);
    assert.equal(from.decision, "escalate", label);
    assert.equal(from.reason, "destination_jurisdiction_excluded", label);
  });
}

test("F-25 fail-closed: a genuinely unsupported destination still escalates against the live list", () => {
  const from = runTravelRouterNode({
    request: { ...SPAIN_REQUEST, text: "Trip to Poland from 2026-09-14 to 2026-09-20 for a client meeting.", externalRef: "3926" },
    employment: ACTIVE_EMP,
    countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(from.classification.destinationCountry, "PL");
  assert.equal(from.decision, "escalate");
  assert.equal(from.reason, "destination_jurisdiction_excluded");
});

test("F-25: the sanctions override still outranks a now-working supported list", () => {
  const from = runTravelRouterNode({
    request: { ...SPAIN_REQUEST, externalRef: "3927" },
    employment: ACTIVE_EMP,
    countriesEnvelope: { data: [...LIVE_COUNTRY_ROWS, { code: "RUS", name: "Russia", alpha_2_code: "RU" }] },
    classification: llmResponseFor({
      intent: "business_travel",
      destinationCountry: "RU",
      startDate: "2026-09-14",
      endDate: "2026-09-20",
      formalLetterRequested: false,
      confidence: 0.95,
    }),
  });
  assert.ok(from.supportedCountries.includes("RU"), "the fixture really does list Russia as supported");
  assert.equal(from.decision, "escalate");
  assert.equal(from.reason, "sanctioned_region", "a sanctions gate must not depend on the supported list");
});

test("F-25: a lowercase alpha_2_code from the API still matches the gate's uppercase key", () => {
  const from = runTravelRouterNode({
    request: { ...SPAIN_REQUEST, externalRef: "3928" },
    employment: ACTIVE_EMP,
    countriesEnvelope: { data: [{ code: "ESP", name: "Spain", alpha_2_code: "es" }] },
    classification: NO_LLM_RESPONSE(),
  });
  assert.deepEqual(from.supportedCountries, ["ES"]);
  assert.equal(from.decision, "auto_resolve");
});

// ---------------------------------------------------------------------------
// The three 2026-08-17 changes, checked in BOTH copies
// ---------------------------------------------------------------------------
// The gates exist twice (CLAUDE.md §6). Each block below drives the node and
// then re-derives the same verdict from the reference engine, so a one-sided
// edit fails here rather than in production.

const LLM_TRIP = (destinationCountry) =>
  llmResponseFor({
    intent: "business_travel",
    destinationCountry,
    startDate: "2026-09-14",
    endDate: "2026-09-20",
    formalLetterRequested: false,
    confidence: 0.95,
  });

test("POSITIVE parity: Montenegro — listed, `eor_onboarding: false` — auto-resolves in the node too", () => {
  // The mirror of test/uc03.test.js's Montenegro test. Its job is to fail if
  // anyone tightens the node's step-7 gate to the EOR flag; the node has no
  // access to `eor_onboarding` at all today, and this pins that it stays that
  // way, driven from the verbatim live row.
  const from = runTravelRouterNode({
    request: { ...SPAIN_REQUEST, text: "Client meetings in Montenegro from 2026-09-14 to 2026-09-20.", externalRef: "3930" },
    employment: ACTIVE_EMP,
    countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
    classification: LLM_TRIP("ME"),
  });
  assert.ok(from.supportedCountries.includes("ME"), "ME must reach the checked set from the real row");
  assert.equal(from.decision, "auto_resolve");
  assert.equal(from.reason, "all_gates_passed");

  const expected = evaluate({
    employment: from.employment,
    classification: from.classification,
    identity: from.identity,
    supportedCountries: new Set(LIVE_ALPHA_2),
  });
  assert.equal(from.decision, expected.decision);
  assert.equal(from.reason, expected.reason);
  assert.deepEqual(from.flags, expected.flags);
});

for (const code of ["AF", "IQ"]) {
  test(`parity: ${code} hits the node's SANCTIONS gate, not its registry gate`, () => {
    // Listed in the envelope on purpose — that isolates the sanctions override
    // from the membership test, exactly as the reference-side test does.
    const from = runTravelRouterNode({
      request: { ...SPAIN_REQUEST, externalRef: `393-${code}` },
      employment: ACTIVE_EMP,
      countriesEnvelope: { data: [...LIVE_COUNTRY_ROWS, { code: `${code}X`, name: code, alpha_2_code: code }] },
      classification: LLM_TRIP(code),
    });
    assert.ok(from.supportedCountries.includes(code), "the fixture really does list it");
    assert.equal(from.decision, "escalate");
    assert.equal(from.reason, "sanctioned_region");

    const expected = evaluate({
      employment: from.employment,
      classification: from.classification,
      identity: from.identity,
      supportedCountries: new Set(from.supportedCountries),
    });
    assert.equal(from.reason, expected.reason, "both copies name the same gate");
    assert.deepEqual(from.flags, expected.flags);
  });
}

// --- the employment country_code axis: F-27 one field over -----------------
// src/remote/restClient.js's normalizeEmployment() asserts the alpha-2 SHAPE
// (`pickAlpha2`) before accepting any candidate; this node's port did not, so
// the reference implementation was MORE correct than its own deployed copy —
// the inversion the parity rule exists to prevent. These pin the mirrored
// behaviour on both sides, including the deliberate null.
import { normalizeEmployment } from "../src/remote/restClient.js";

const EMP_COUNTRY_SHAPES = [
  ["nested alpha_2_code (the real API)", { country: { code: "DEU", alpha_2_code: "DE" } }, "DE"],
  ["ONLY the alpha-3 `code` — unusable, so null, never \"DEU\"", { country: { code: "DEU" } }, null],
  ["flat country_code (the mock's synthetic shape)", { country_code: "NG" }, "NG"],
  ["lowercase is canonicalised, not rejected", { country: { alpha_2_code: "pt" } }, "PT"],
  ["no country information at all", {}, null],
  ["a non-string where a code should be", { country: { alpha_2_code: 42 } }, null],
];

for (const [label, countryFields, expected] of EMP_COUNTRY_SHAPES) {
  test(`employment country_code parity: ${label}`, () => {
    const employment = { id: "emp_active_001", status: "active", ...countryFields };
    const from = runTravelRouterNode({
      request: { ...SPAIN_REQUEST, externalRef: `394-${label.length}` },
      employment,
      countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
      classification: NO_LLM_RESPONSE(),
    });
    assert.equal(from.employment.country_code, expected, `node: ${label}`);

    // The reference normaliser, given the same raw record, must agree. It is
    // fed the real-API-shaped record (basic_information present) so it takes
    // the nesting branch rather than the "already flat" early return.
    const reference = normalizeEmployment({
      id: "emp_active_001",
      status: "active",
      basic_information: {},
      ...countryFields,
    });
    assert.equal(reference.country_code, expected, `restClient: ${label}`);
  });
}

test("employment country_code parity: an alpha-3-only record yields a NULL origin in the UC-04 handoff", () => {
  // Where this field is actually read. A wrong-but-plausible "DEU" would be
  // handed to UC-04 as an origin country and acted on; a null is a visibly
  // absent one that gets investigated. Same reasoning as normalizeEmployment().
  const from = runTravelRouterNode({
    request: {
      ...SPAIN_REQUEST,
      text: "I'd like to work remotely from Portugal for a month — can I do my normal job from there?",
      externalRef: "3940",
    },
    employment: { id: "emp_active_001", status: "active", country: { code: "DEU" } },
    countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(from.decision, "route_to_uc04");
  assert.equal(from.handoffEvent.origin_country, null, "never the alpha-3 string");

  const expected = buildUc04HandoffEvent({
    employment: from.employment,
    classification: from.classification,
    externalRef: "3940",
  });
  assert.deepEqual(from.handoffEvent, JSON.parse(JSON.stringify(expected)));
});

// ---------------------------------------------------------------------------
// "Could not read the registry" is not a fact about the destination
// ---------------------------------------------------------------------------
// `Fetch Countries (Remote)` carries `onError: continueRegularOutput`. That does
// NOT mark the node red: it reports success and hands the gates
// `{error: {…, status}}` in place of 224 rows. The list then normalises to `[]`,
// and the membership gate escalated `destination_jurisdiction_excluded` — a
// claim about the DESTINATION'S JURISDICTION derived from an answer that never
// arrived. `src/uc03/policyEngine.js` gained step 6b for this; until the port
// below landed, the two execution paths DISAGREED on this input and no test
// covered it. The error-body row that used to sit in FAIL_CLOSED_ENVELOPES
// asserted the old conflation — it moved here rather than being deleted,
// because the fail-closed property still holds and only the reason changed.

const UPSTREAM_ENVELOPES = [
  {
    label: "a 404 — an authoritative answer that the registry is not there",
    envelope: { error: { message: '404 - "{\"message\":\"Not found\"}"', status: 404 } },
    reason: "upstream_record_not_found",
    flag: "upstream_countries_404",
  },
  {
    label: "a 503 — the request was never evaluated, so nothing about it is knowable",
    envelope: { error: { message: "Remote API 503", status: 503 } },
    reason: "upstream_unavailable",
    flag: "upstream_countries_503",
  },
  {
    label: "a transport error with no status at all",
    envelope: { error: { message: "Remote API 503" } },
    reason: "upstream_unavailable",
    flag: "upstream_countries_error",
  },
];

for (const { label, envelope, reason, flag } of UPSTREAM_ENVELOPES) {
  test(`upstream attribution: ${label} escalates as ${reason}, NOT as a jurisdiction claim`, () => {
    const from = runTravelRouterNode({
      request: SPAIN_REQUEST,
      employment: ACTIVE_EMP,
      countriesEnvelope: envelope,
      classification: NO_LLM_RESPONSE(),
    });

    // Still fails closed — that never changed, and is the half worth keeping.
    assert.equal(from.decision, "escalate", label);
    assert.equal(from.reason, reason, label);
    assert.deepEqual(from.flags, [reason, flag], label);
    assert.notEqual(
      from.reason,
      "destination_jurisdiction_excluded",
      "Spain's jurisdiction was never in question; the registry read failed"
    );
    // The provenance survives onto the item, so the audit row can say which
    // call failed and with what — which `reason` alone cannot.
    assert.equal(from.upstreamFailures.length, 1, label);
    assert.equal(from.upstreamFailures[0].call, "countries", label);
  });
}

test("upstream attribution parity: the node and policyEngine.evaluate() agree on an unreadable registry", () => {
  const envelope = { error: { message: "gone", status: 404 } };
  const from = runTravelRouterNode({
    request: SPAIN_REQUEST,
    employment: ACTIVE_EMP,
    countriesEnvelope: envelope,
    classification: NO_LLM_RESPONSE(),
  });

  // `src/uc03/workflow.js` builds this exact descriptor when
  // `RemoteClient.listCountries()` returns null. The two paths observe
  // different amounts (that client collapses every failure to a 404-shaped
  // null), so the FAILURE LIST is the fair comparison point, not the raw
  // envelope — what must agree is the decision made from it.
  const expected = evaluate({
    employment: from.employment,
    classification: from.classification,
    identity: from.identity,
    supportedCountries: new Set(),
    upstreamFailures: [
      { call: "countries", status: 404, kind: "not_found", message: "Remote returned no usable country registry" },
    ],
  });

  assert.equal(from.decision, expected.decision);
  assert.equal(from.reason, expected.reason);
  assert.deepEqual(from.flags, expected.flags);
});

test("upstream attribution: a SUCCESSFUL but empty registry keeps the jurisdiction reason", () => {
  // The distinction is the whole point. An empty list that Remote really sent
  // is an answer about the world; an empty list produced by a failed fetch is
  // not. Only a positive control on this side proves 6b did not simply swallow
  // the original gate.
  const from = runTravelRouterNode({
    request: SPAIN_REQUEST,
    employment: ACTIVE_EMP,
    countriesEnvelope: { data: [] },
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(from.decision, "escalate");
  assert.equal(from.reason, "destination_jurisdiction_excluded");
  assert.deepEqual(from.upstreamFailures, []);
});

test("upstream attribution: the sanctions override still outranks an unreadable registry", () => {
  // 6b sits AFTER sanctions deliberately — a sanctioned destination is knowable
  // locally, so it must keep its own, more actionable reason even when Remote
  // is unreachable.
  const from = runTravelRouterNode({
    request: { ...SPAIN_REQUEST, externalRef: "3929" },
    employment: ACTIVE_EMP,
    countriesEnvelope: { error: { message: "Remote API 503", status: 503 } },
    classification: llmResponseFor({
      intent: "business_travel",
      destinationCountry: "RU",
      startDate: "2026-09-14",
      endDate: "2026-09-20",
      formalLetterRequested: false,
      confidence: 0.95,
    }),
  });
  assert.equal(from.reason, "sanctioned_region");
});

// ---------------------------------------------------------------------------
// The handoff key — whose QUEUE, which is not always whose workflow
// ---------------------------------------------------------------------------

test("handoffUseCase is set only on route_to_uc04, so the escalation lands in UC-04's queue", () => {
  const routed = runTravelRouterNode({
    request: {
      text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
      employmentId: "emp_active_001",
      session: ACTIVE_SESSION,
      source: "zendesk",
      externalRef: "3930",
    },
    employment: ACTIVE_EMP,
    countries: countriesAll(),
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(routed.decision, "route_to_uc04");
  assert.equal(routed.handoffUseCase, "UC-04");
  // It travels beside the handoff event that encodes the same decision.
  assert.equal(routed.handoffEvent.event_type, "CROSS_BORDER_WORK_REQUESTED");

  const ordinary = runTravelRouterNode({
    request: SPAIN_REQUEST,
    employment: ACTIVE_EMP,
    countriesEnvelope: LIVE_COUNTRIES_ENVELOPE,
    classification: NO_LLM_RESPONSE(),
  });
  assert.equal(ordinary.decision, "auto_resolve");
  assert.equal(ordinary.handoffUseCase, undefined, "no handoff, no override — UC-03 keeps its own team");
});

// --- the two country dictionaries must be the SAME dictionary --------------
// `KNOWN_COUNTRIES` exists twice: src/uc03/classifier.js and this node's
// `workflows/nodes-uc03/travelRouterGates.js`. Nothing compared them. The
// parity scenarios above only notice a difference if some scenario's free text
// happens to name a country one copy knows and the other does not — and every
// scenario that cares about an exotic destination supplies an explicit LLM
// classification, which bypasses the rule fallback entirely. So the two lists
// could diverge indefinitely with the suite green.
//
// WHAT THAT DICTIONARY DECIDES. It is the only thing that turns free text into
// a destination code, and every destination gate in policyEngine.js reads that
// code: the sanctions override, the registry membership test, and (via the
// dates) the duration cap. A country absent from it becomes
// `destination_unknown` — a statement about the DICTIONARY dressed as a
// statement about the trip. So a divergence here means the same customer
// sentence gets a different recorded reason depending on which execution path
// happened to serve it, and the rule path is not the exotic case: it runs
// whenever the LLM is unconfigured AND on every LLM failure.
//
// THE GAP THIS COMMENT USED TO RECORD IS CLOSED (2026-08-19). Neither copy
// contained a single member of `SANCTIONED_OR_RESTRICTED`, so UC-03's sanctions
// gate could not fire on the rule path at all: "I'm travelling to Iran" and
// "I'm travelling to Japan" both resolved to null and both came back
// `destination_unknown` — a true refusal with a false reason, on the path that
// runs whenever the LLM is unconfigured AND on every LLM failure. Both copies
// now carry the ten restricted jurisdictions (derived from the sanctions set in
// src/uc03/classifier.js; asserted reachable at node startup in the port), and
// the behavioural test below drives the ACTUAL node body for each name rather
// than only comparing the two literals.
test("the n8n node's country dictionary is IDENTICAL to src/uc03/classifier.js's", () => {
  const nodeDict = {};
  const block = nodeSource.slice(
    nodeSource.indexOf("const KNOWN_COUNTRIES = {"),
    nodeSource.indexOf("};", nodeSource.indexOf("const KNOWN_COUNTRIES = {"))
  );
  for (const m of block.matchAll(/'?([a-z][a-z ]*)'?\s*:\s*'([A-Z]{2})'/g)) {
    nodeDict[m[1].trim()] = m[2];
  }
  assert.ok(Object.keys(nodeDict).length > 5, "failed to parse the node's KNOWN_COUNTRIES at all");
  assert.deepEqual(
    nodeDict,
    KNOWN_COUNTRIES,
    "the two copies of the free-text country dictionary have drifted — the same sentence would " +
      "resolve to a different destination (or to none) depending on which execution path served it"
  );
});

// ---------------------------------------------------------------------------
// The dictionary comparison above reads the node's LITERAL. This one runs it.
// ---------------------------------------------------------------------------
// Two things a literal diff cannot see, both of which have bitten this file's
// subject already:
//   - the literal could be right while the MATCHING logic diverges (the node
//     ports countryMentions.js by hand — word-boundary lookarounds, the "to"
//     cue, the single-country fallback), and
//   - the src copy is now DERIVED from `SANCTIONED_OR_RESTRICTED` while the
//     node's is written out, so "they are the same object" and "the node can
//     actually reach the sanctions gate" have become separate claims.
// So this drives the ACTUAL node body once per restricted name and asserts the
// destination code AND the reason, which is the pair the specialist reads.
test("the n8n node resolves every restricted jurisdiction from free text and escalates it AS sanctioned", () => {
  const restricted = restrictedDestinationNames();
  assert.ok(Object.keys(restricted).length >= 10, "no restricted names to check — the guard is not guarding");

  for (const [name, code] of Object.entries(restricted)) {
    const out = runTravelRouterNode({
      request: {
        text: `Client meeting in ${name} from 2026-09-01 to 2026-09-05.`,
        employmentId: "emp_active_001",
        session: ACTIVE_SESSION,
        source: "zendesk",
        externalRef: "3201",
      },
      employment: ACTIVE_EMP,
      // The registry deliberately CONTAINS the code: the sanctions override must
      // fire on its own, not be rescued by the jurisdiction gate two rungs below.
      countries: supportedCountries([...SUPPORTED_CODES, code]),
      classification: NO_LLM_RESPONSE(),
    });
    assert.equal(out.classification.destinationCountry, code, `the node could not resolve "${name}"`);
    assert.equal(out.decision, "escalate", `"${name}" must escalate`);
    assert.equal(
      out.reason,
      "sanctioned_region",
      `"${name}" escalated as "${out.reason}" — a true refusal with a false reason is the defect this test exists for`
    );
  }
});

// ---------------------------------------------------------------------------
// THE MODEL'S DATES ARE HELD TO THE SAME SHAPE RULE IN BOTH COPIES
// ---------------------------------------------------------------------------
// `docs/TRAVEL-LETTER-INPUTS.md` §3: neither copy's `isValidClassification()`
// checked the FORMAT of `startDate`/`endDate` — "a string or null" was the whole
// test — so a model returning "09/14/2026" produced a date `Date.parse()` reads
// in US month-first order, a day count computed from it, and (in the reference
// implementation) that string printed verbatim on a consular document.
//
// The fix is a per-field quarantine rather than a whole-shape rejection, and
// src/uc03/classifier.js's `isValidClassification()` header carries the
// argument: failing the shape retries the model three times and then discards a
// correct reading of the intent and the destination over one badly-written date.
//
// IT HAD TO LAND IN BOTH COPIES ON THE SAME DAY. The port is the graph the
// production webhook actually runs; leaving it unquarantined would mean the same
// model answer auto-resolving on one execution path and stopping for a person on
// the other — the "exists twice" drift this file exists to catch, in the one
// place where the divergence is a DECISION rather than a label.
test("an LLM date that is not a real ISO calendar date is dropped by the node, not printed", () => {
  const request = {
    text: "I need a travel letter for a conference in Germany.",
    employmentId: "emp_active_001",
    session: ACTIVE_SESSION,
    source: "zendesk",
    externalRef: "3926",
  };
  const from = runTravelRouterNode({
    request,
    employment: ACTIVE_EMP,
    countries: countriesAll(),
    classification: llmResponseFor({
      intent: "business_travel",
      destinationCountry: "DE",
      startDate: "09/14/2026",
      endDate: "2026-02-31", // matches the pattern; rolls forward to March
      formalLetterRequested: true,
      confidence: 0.95,
    }),
  });

  // The rest of the reading survives — this is a quarantine, not a rejection.
  assert.equal(from.classification.source, "llm");
  assert.equal(from.classification.destinationCountry, "DE");
  assert.equal(from.classification.formalLetterRequested, true);
  // Neither date reached a gate, and neither was guessed at.
  assert.equal(from.classification.startDate, null);
  assert.equal(from.classification.endDate, null);
  assert.equal(from.decision, "escalate");
  assert.equal(from.reason, "duration_unknown");

  // Parity: the reference engine, given the node's own classification, agrees.
  const expected = evaluate({
    employment: from.employment,
    classification: from.classification,
    identity: from.identity,
    supportedCountries: new Set(SUPPORTED_CODES),
    requestText: request.text,
  });
  assert.equal(from.decision, expected.decision);
  assert.equal(from.reason, expected.reason);
});

// ---------------------------------------------------------------------------
// THE CONFIDENCE THE RULE SCAN ITSELF PRODUCES
// ---------------------------------------------------------------------------
// Every fixture above hands the node a `classification` with an explicit
// `confidence` (0.9, 0.95), so this file has never once exercised the port's
// OWN rule-based scoring. The two copies could disagree about what a request is
// worth and every parity test would stay green.
//
// That is not hypothetical. The scan used to score an unreadable request at
// exactly 0.6 against a 0.6 floor compared with `<`, so the confidence gate
// could not fire; fixing it in src/uc03/classifier.js and not in the port would
// have made the same words auto-resolve on the n8n path and stop for a person
// on the Node path — a DECISION divergence, which is the one thing this file
// exists to prevent.
//
// These drive the node with NO classification at all, which is what forces it
// down its own rule-based branch, and compare the score it reaches with the
// real function's.
test("the port's own rule-based confidence matches the real scan's, including the unreadable case", () => {
  const texts = [
    "Hello.", // reads nothing: must land BELOW the floor
    "thanks!", // same
    "I will be working remotely while I am away — is that OK?", // intent matched, no itinerary
    "Can I go to Spain for a client meeting?", // destination only
    "Conference in Germany from 2026-09-20 to 2026-09-26.", // destination + dates
  ];

  for (const text of texts) {
    const expected = classifyTravelInquiryRuleBased({ text });
    const fromN8n = runTravelRouterNode({
      request: { text, employmentId: ACTIVE_EMP.id, externalRef: `conf-${texts.indexOf(text)}` },
      employment: ACTIVE_EMP,
      countries: countriesNoCA(),
      classification: null, // the whole point: make the node score it itself
    });

    assert.equal(
      fromN8n.classification.confidence,
      expected.confidence,
      `the deployed node scores ${JSON.stringify(text)} at ${fromN8n.classification.confidence} ` +
        `and the real scan at ${expected.confidence} — the two paths would decide this request differently`
    );
    // The intent read has to agree too, since it is now an input to the score.
    assert.equal(fromN8n.classification.intent, expected.intent, `intent diverged on ${JSON.stringify(text)}`);
  }
});
