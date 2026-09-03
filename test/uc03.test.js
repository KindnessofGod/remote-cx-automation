// ---------------------------------------------------------------------------
// uc03.test.js  —  UC-03: the thin-router workflow, classifier seam, policy
// gates, artifacts, UC-04 handoff, and the no-Zendesk-by-accident guarantee.
// ---------------------------------------------------------------------------
// Everything here is hermetic: the real Remote mock server on a dedicated test
// port, a rule-based (or fully injected) classifier, and an in-memory
// AuditLogger/CaseStore. No test may reach OpenAI even when OPENAI_API_KEY is
// set in the environment (see CLAUDE.md §6 + the fake seams below).
// ---------------------------------------------------------------------------

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Read-only, and only to pin UC-03's declared copy of UC-04's requirements
// against UC-04's real one — see the drift guard at the end of this file.
import { readFile } from "node:fs/promises";

import { startMockServer, EMPLOYMENTS, COUNTRIES, LEGAL_ENTITIES } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry, buildUc04HandoffEvent } from "../src/uc03/workflow.js";
import { evaluate, computeDurationDays, DEFAULT_DURATION_CAP_DAYS, SANCTIONED_OR_RESTRICTED, DEFAULT_CONFIDENCE_THRESHOLD, describeDecidingGate } from "../src/uc03/policyEngine.js";
import { describeUc04Intake, UC04_REQUIRED_INPUTS, UC04_INPUTS_UC03_CANNOT_SOURCE } from "../src/uc03/uc04Intake.js";
import {
  classifyTravelInquiry,
  classifyTravelInquiryRuleBased,
  parseItineraryDates,
  KNOWN_COUNTRIES,
  restrictedDestinationNames,
} from "../src/uc03/classifier.js";
import { renderInformationalAnswer, renderTravelLetterHtml, countryName } from "../src/uc03/letter.js";
import { LIVE_COUNTRY_ROWS, LIVE_COUNTRIES_ENVELOPE } from "./fixtures/remoteCountries.js";

const TEST_PORT = 4093; // test band (4090-4099); never a live API port — see src/shared/ports.js

let server;
let remote;
let audit;
let caseStore;

before(async () => {
  server = await startMockServer(TEST_PORT);
  remote = new RemoteClient({ baseUrl: `http://localhost:${TEST_PORT}` });
});

after(() => {
  server?.close();
});

/** Fresh in-memory state per test. */
function fresh() {
  audit = new AuditLogger();
  caseStore = new CaseStore();
}

const ACTIVE = { authenticatedEmploymentId: "emp_active_001" };

/** Run the workflow with the deterministic classifier — never real OpenAI. */
function run(ticket = {}, deps = {}) {
  return handleTravelInquiry(
    { text: "default", employmentId: "emp_active_001", session: ACTIVE, ...ticket },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased, ...deps }
  );
}

// ---------------------------------------------------------------------------
// 1. parseItineraryDates — deterministic date extraction
// ---------------------------------------------------------------------------

test("parseItineraryDates: explicit ISO dates win over inference, in order", () => {
  assert.deepEqual(parseItineraryDates("from 2026-09-14 to 2026-10-02"), {
    startDate: "2026-09-14",
    endDate: "2026-10-02",
  });
  assert.deepEqual(parseItineraryDates("arriving on 2026-09-14"), {
    startDate: "2026-09-14",
    endDate: null,
  });
});

test("parseItineraryDates: month-name forms infer the current year", () => {
  const year = String(new Date().getFullYear());
  assert.deepEqual(parseItineraryDates("September 14 to October 2"), {
    startDate: `${year}-09-14`,
    endDate: `${year}-10-02`,
  });
  assert.deepEqual(parseItineraryDates("14 September to 2 October"), {
    startDate: `${year}-09-14`,
    endDate: `${year}-10-02`,
  });
  assert.deepEqual(parseItineraryDates("March 1st"), {
    startDate: `${year}-03-01`,
    endDate: null,
  });
});

test("parseItineraryDates: a span reading backwards crosses a year boundary", () => {
  const year = new Date().getFullYear();
  assert.deepEqual(parseItineraryDates("December 28 to January 4"), {
    startDate: `${year}-12-28`,
    endDate: `${year + 1}-01-04`,
  });
});

test("parseItineraryDates: empty text yields null dates", () => {
  assert.deepEqual(parseItineraryDates(""), { startDate: null, endDate: null });
  assert.deepEqual(parseItineraryDates("just a general question"), { startDate: null, endDate: null });
});

// ---------------------------------------------------------------------------
// 2. Rule-based classifier — the boundary is intent, not duration
// ---------------------------------------------------------------------------

test("classifier: passive business travel stays in UC-03", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
  });
  assert.equal(c.intent, "business_travel");
  assert.equal(c.destinationCountry, "ES");
  assert.equal(c.startDate, "2026-09-14");
  assert.equal(c.endDate, "2026-10-02");
  assert.equal(c.formalLetterRequested, false);
});

test("classifier: actively working from the destination is UC-04 intent, whatever the duration", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "I'd like to work remotely from Portugal for a month while on holiday.",
  });
  assert.equal(c.intent, "work_authorization");
  assert.equal(c.destinationCountry, "PT");
});

test("classifier: an explicit letter request is its own HITL flag, not an intent", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "I need a travel support letter for my visa application for a conference in Germany.",
  });
  assert.equal(c.intent, "business_travel");
  assert.equal(c.formalLetterRequested, true);
  assert.equal(c.destinationCountry, "DE");
});

test("classifier: an unnamed destination is null, never guessed", () => {
  const c = classifyTravelInquiryRuleBased({ text: "Just checking the travel policy, thanks." });
  assert.equal(c.destinationCountry, null);
});

// ---------------------------------------------------------------------------
// D-04. The only free-text box in the whole portal sits on the travel card,
// so a request that is not about travel at all has nowhere else to go —
// round 6's employee wrote a landlord letter here, verbatim, and it came back
// "your travel question, destination unknown".
// qa/evidence/UC-01/2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md D-04.
// ---------------------------------------------------------------------------

test("classifier: D-04 — a landlord letter is flagged as possibly not travel, and no destination is invented", () => {
  const c = classifyTravelInquiryRuleBased({
    text:
      "Hi — my landlord won't sign my lease until he has something in writing from my employer saying I actually " +
      "work here. Could you send me a letter confirming my employment? He needs it to say that I'm employed by " +
      "you, my job title, that I'm full-time, and my start date. It is for a rental application — I'm not " +
      "travelling and this isn't for a visa or a border check.",
  });
  assert.equal(c.destinationCountry, null, "there is no destination in this text — one must not be invented");
  assert.equal(c.intent, "business_travel", "the safe default when nothing travel-shaped was read");
  assert.equal(c.nonTravelSignal, true);
});

test("classifier: D-04 — a real destination always overrides the non-travel signal, even mentioning a landlord", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "My landlord also wants proof I work here, but mainly: I have a client meeting in Spain on 2026-09-14.",
  });
  assert.equal(c.destinationCountry, "ES");
  assert.equal(c.nonTravelSignal, false, "a real trip must never be waved off as not-travel");
});

test("classifier: D-04 — recognised travel intent overrides the non-travel signal even with no destination", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "Ignore the landlord stuff for now — I'm attending a conference next month, destination TBD.",
  });
  assert.equal(c.destinationCountry, null);
  assert.equal(c.intent, "business_travel", "the 'attending' pattern matched, so this is a real reading, not a default");
  assert.equal(c.nonTravelSignal, false, "a matched travel-intent pattern must not be overridden by a stray word");
});

test("classifier: D-04 — an ordinary unreadable trip carries no non-travel signal at all", () => {
  const c = classifyTravelInquiryRuleBased({ text: "Just checking the travel policy, thanks." });
  assert.equal(c.nonTravelSignal, false);
});

// ---------------------------------------------------------------------------
// The destination-slot defect (the UC-03 half of UC-07's ticket-18 class).
// The destination used to be `Object.keys(KNOWN_COUNTRIES).find(...)` — the
// FIRST country in the dictionary literal that appears anywhere in the text,
// which is not the same question as "where is this person going". UC-03 routes
// on this value, so it decides which country's rules get applied.
// ---------------------------------------------------------------------------

test("classifier: an origin mentioned before the destination does not become the destination", () => {
  const c = classifyTravelInquiryRuleBased({
    text: "I'm travelling from Spain to Germany for a client meeting on 2026-09-14.",
  });
  assert.equal(c.destinationCountry, "DE", "dictionary order answered ES — the country they are leaving");
});

test("classifier: 'work from X' is still the destination, because UC-03's origin is the employment record", () => {
  const c = classifyTravelInquiryRuleBased({ text: "I'd like to work remotely from Portugal for a month." });
  assert.equal(c.destinationCountry, "PT");
});

test("classifier: two countries with no direction cue is null, so the gates escalate rather than route on a guess", () => {
  const c = classifyTravelInquiryRuleBased({ text: "Client meetings in Spain, then the Netherlands, in September." });
  assert.equal(c.destinationCountry, null);
});

test("classifier: a country name hidden inside an English word is not a destination", () => {
  // "ukulele" contains "uk"; "Indianapolis" contains "india"; neither names a
  // country. Word-boundary matching is what makes the difference.
  assert.equal(classifyTravelInquiryRuleBased({ text: "Bringing my ukulele on the trip." }).destinationCountry, null);
  assert.equal(
    classifyTravelInquiryRuleBased({ text: "Conference in Indianapolis for three days." }).destinationCountry,
    null,
    "a US city must not resolve to India"
  );
});

// ---------------------------------------------------------------------------
// 3. classifyTravelInquiry — the LLM seam: shape-validated, retried, tagged
// ---------------------------------------------------------------------------

test("classifier LLM path: valid response is tagged source llm and traced", async () => {
  const audit2 = new AuditLogger();
  const result = await classifyTravelInquiry(
    { text: "Conference in Germany." },
    {
      askJson: async () => ({
        intent: "business_travel",
        destinationCountry: "DE",
        startDate: "2026-09-20",
        endDate: "2026-09-26",
        formalLetterRequested: true,
        confidence: 0.95,
      }),
      isConfigured: () => true,
      audit: audit2,
      backoff: async () => {},
    }
  );
  assert.equal(result.source, "llm");
  assert.equal(result.intent, "business_travel");
  assert.equal(result.destinationCountry, "DE");
  // The attempt is traced (invariant 7) — one success, attempt 1.
  const trace = audit2.entries.filter((e) => e.call === "classifyTravelInquiry.askJson");
  assert.equal(trace.length, 1);
  assert.equal(trace[0].ok, true);
});

test("classifier LLM path: an invalid shape is retried, then falls back tagged rule_based_fallback", async () => {
  const audit2 = new AuditLogger();
  const result = await classifyTravelInquiry(
    { text: "Client meeting in Spain from 2026-09-14 to 2026-10-02." },
    {
      askJson: async () => ({ intent: "not_a_valid_intent" }),
      isConfigured: () => true,
      audit: audit2,
      backoff: async () => {},
      onAttempt: undefined,
    }
  );
  assert.equal(result.source, "rule_based_fallback");
  assert.equal(result.intent, "business_travel");
  assert.equal(result.destinationCountry, "ES");
  // 3 attempts (invariant 10), all failed — recorded, not hidden.
  const traces = audit2.entries.filter((e) => e.call === "classifyTravelInquiry.askJson");
  assert.equal(traces.length, 3);
  assert.ok(traces.every((t) => t.ok === false));
});

test("classifier LLM path: an askJson throw also falls back after retries", async () => {
  const result = await classifyTravelInquiry(
    { text: "Business meeting in Nigeria." },
    {
      askJson: async () => {
        throw new Error("connection refused");
      },
      isConfigured: () => true,
      backoff: async () => {},
    }
  );
  assert.equal(result.source, "rule_based_fallback");
  assert.equal(result.intent, "business_travel");
  assert.equal(result.destinationCountry, "NG");
});

test("classifier unconfigured: returns the rule-based result directly, tagged", async () => {
  const audit2 = new AuditLogger();
  const result = await classifyTravelInquiry(
    { text: "Client meeting in France from 2026-09-01 to 2026-09-05." },
    { isConfigured: () => false, audit: audit2 }
  );
  assert.equal(result.source, "rule_based_fallback");
  assert.equal(result.destinationCountry, "FR");
  assert.equal(audit2.entries.length, 0, "no LLM attempt happened at all");
});

// ---------------------------------------------------------------------------
// 4. policyEngine — deterministic day-count + every gate
// ---------------------------------------------------------------------------

test("computeDurationDays: inclusive of both endpoints, invalid inputs null", () => {
  assert.equal(computeDurationDays("2026-03-01", "2026-03-22"), 22);
  assert.equal(computeDurationDays("2026-09-14", "2026-10-02"), 19);
  assert.equal(computeDurationDays("2026-09-20", "2026-09-20"), 1);
  assert.equal(computeDurationDays(null, "2026-09-20"), null);
  assert.equal(computeDurationDays("2026-09-20", null), null);
  assert.equal(computeDurationDays("2026-09-20", "2026-09-01"), null, "backwards range is invalid");
});

function baseClassification(overrides = {}) {
  return {
    intent: "business_travel",
    destinationCountry: "ES",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    formalLetterRequested: false,
    confidence: 0.9,
    source: "rule_based_fallback",
    ...overrides,
  };
}

function activeEmployment() {
  return EMPLOYMENTS["emp_active_001"];
}

function verifiedIdentity() {
  return { verified: true, method: "session", reason: "authenticated_session" };
}

test("evaluate: identity must be verified first — fails closed", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification(),
    identity: { verified: false, method: "none", reason: "unauthenticated_requires_stepup" },
    supportedCountries: new Set(["ES"]),
  });
  assert.deepEqual(r, {
    decision: "escalate",
    flags: ["identity_unauthenticated_requires_stepup"],
    reason: "identity_not_verified",
    durationDays: null,
  });
});

test("evaluate: a non-active employee can never be supported or routed", () => {
  const r = evaluate({
    employment: EMPLOYMENTS["emp_terminated_002"],
    classification: baseClassification(),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("evaluate: work-authorization intent routes to UC-04 regardless of dates or destination", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({
      intent: "work_authorization",
      destinationCountry: null,
      startDate: null,
      endDate: null,
    }),
    identity: verifiedIdentity(),
    supportedCountries: new Set([]),
  });
  assert.equal(r.decision, "route_to_uc04");
  assert.equal(r.route, "uc04_work_authorization");
  assert.deepEqual(r.flags, ["uc04_work_authorization"]);
});

test("evaluate: an unknown destination escalates — we can't support what we weren't told", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: null }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "destination_unknown");
  assert.ok(!r.flags.includes("possible_non_travel_request"), "the classifier read nothing suggesting non-travel");
});

test("evaluate: D-04 — the classifier's nonTravelSignal rides as an ADDITIVE flag, same decision, same reason", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: null, nonTravelSignal: true }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "escalate", "still the same decision — this is not a new route");
  assert.equal(r.reason, "destination_unknown", "still the same reason — this is not a new gate");
  assert.deepEqual(r.flags, ["destination_unknown", "possible_non_travel_request"]);
});

test("evaluate: a sanctioned region is a hard escalate even if it appeared on the supported list", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "RU" }),
    identity: verifiedIdentity(),
    // Defense in depth: even a broken/naive supported list containing the code
    // cannot open a sanctioned destination.
    supportedCountries: new Set(["ES", "RU"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "sanctioned_region");
  assert.deepEqual(r.flags, ["sanctioned_region"]);
});

test("evaluate: sanctioned check does not depend on the supported list at all", () => {
  assert.ok(SANCTIONED_OR_RESTRICTED.has("IR"));
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "IR" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set([]),
  });
  assert.equal(r.reason, "sanctioned_region");
});

// F-13's sibling in UC-03: the destination code here comes from an LLM
// extraction, and `Set.has()` is case-sensitive, so a lowercase "ru" used to
// miss the sanctions override entirely. It still escalated — two gates later,
// via the jurisdiction-registry gate — but a sanctions control that only holds
// because a different gate happens to catch the case is not a control.
test("F-13: a lowercase sanctioned code hits the SANCTIONS gate, not the jurisdiction-registry one", () => {
  for (const variant of ["ru", "Ru", " ru ", "\tRU\n"]) {
    const r = evaluate({
      employment: activeEmployment(),
      classification: baseClassification({ destinationCountry: variant }),
      identity: verifiedIdentity(),
      supportedCountries: new Set(["ES", "RU"]),
    });
    assert.equal(r.decision, "escalate", `${JSON.stringify(variant)} escalates`);
    assert.equal(r.reason, "sanctioned_region", `${JSON.stringify(variant)} is caught BY THE SANCTIONS GATE`);
    assert.deepEqual(r.flags, ["sanctioned_region"]);
  }
});

test("F-13: the supported-countries list is normalised too, so a lowercase code is not spuriously unsupported", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "es" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES", "DE"]),
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.reason, "all_gates_passed");
});

test("F-13: a caller-supplied sanctions set in lowercase still bites — both sides are normalised", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "ES" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
    sanctionedRegions: new Set(["es"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "sanctioned_region");
});

test("evaluate: an unsupported destination escalates, and an empty supported list fails closed", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "CA" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES", "DE"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "destination_jurisdiction_excluded");

  const empty = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "ES" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set([]),
  });
  assert.equal(empty.reason, "destination_jurisdiction_excluded", "no supported list = nothing is confirmed");
});

test("evaluate: missing dates mean the duration cannot be confirmed under-cap", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ startDate: null, endDate: null }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_unknown");
});

test("evaluate: over-cap cumulative duration escalates to Global Mobility", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({
      destinationCountry: "IN",
      startDate: "2026-09-01",
      endDate: "2026-10-31",
    }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["IN"]),
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_over_cap");
  assert.equal(r.durationDays, 61);
  assert.ok(r.durationDays > DEFAULT_DURATION_CAP_DAYS);
});

// THIS TEST'S NAME AND ITS ASSERTIONS BOTH MOVED, AND THE OLD ONES ARE QUOTED
// BECAUSE THEY WERE RIGHT. It was called "a formal letter request is the HITL
// boundary, not auto-issue" and asserted `human_review /
// formal_letter_requested` — true of every path in this repository until the
// project owner drew the line differently (docs/use-cases/UC-03.md §23). What
// replaces it is the same request asserted in BOTH directions: it issues on the
// default posture, and it still stops when the deployment says every letter
// needs a signature.
test("evaluate: a STANDARD letter for a qualified traveller issues with no signature", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ formalLetterRequested: true }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
    // WITHOUT THIS THE GATE ESCALATES, and that is the point of the parameter:
    // the letter-scope check cannot say "nothing outside the template was asked
    // for" when it was never shown the request. See src/uc03/letterScope.js.
    requestText: "I need a travel support letter for a client meeting in Spain.",
    // THE OTHER HALF OF WHY THIS IS NOT A WEAKENING. `letterheadAvailable`
    // defaults to FALSE, so a caller that has not established an employing
    // entity still gets the signature path — a letter is never issued by
    // omission.
    letterheadAvailable: true,
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.reason, "standard_letter_issued");
  assert.equal(r.durationDays, 19);
  assert.deepEqual(r.flags, [], "the routine outcome raises no escalation flag");
});

test("evaluate: with no letterhead established, the same request still stops for a person", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ formalLetterRequested: true }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
    requestText: "I need a travel support letter for a client meeting in Spain.",
    // omitted entirely — the default is the cautious answer
  });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "formal_letter_requested");
  assert.ok(r.flags.includes("letterhead_unavailable"), "the flag names the cause, so nobody hunts for a document");
});

test("evaluate: a deployment that requires a signature on every letter still gets one", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ formalLetterRequested: true }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
    requestText: "I need a travel support letter for a client meeting in Spain.",
    letterheadAvailable: true,
    letterAutoIssue: false,
  });
  assert.equal(r.decision, "human_review");
  assert.equal(r.reason, "formal_letter_requested");
  assert.ok(
    !r.flags.includes("letterhead_unavailable"),
    "there IS a letterhead here — the letter is drafted and waiting, which is the opposite job from a record fix"
  );
});

test("evaluate: all gates passed is a zero-touch informational resolve", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification(),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.reason, "all_gates_passed");
  assert.equal(r.durationDays, 19);
});

test("evaluate: a duration exactly at the cap still auto-resolves (cap is not exclusive)", () => {
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.durationDays, 30);
});

// ---------------------------------------------------------------------------
// 5. Workflow end to end — the four decisions, their artifacts + stores
// ---------------------------------------------------------------------------

test("workflow: auto_resolve produces an informational answer, no letter, resolved case", async () => {
  fresh();
  const r = await run({
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02 — is business travel fine?",
    externalRef: "9001",
  });
  assert.equal(r.decision, "auto_resolve");
  assert.ok(r.informationalAnswer.includes("Spain"), "answer names the destination");
  // THE NAME, NOT THE CODE. This asserted `(ES)` because the summary read
  // "Destination: Spain (ES)" — a bare country code on the answer a traveller
  // receives, and the same text that is posted to them as a Zendesk comment.
  // The code stays where codes belong: `r.classification.destinationCountry`
  // still carries it, and the gates still compare it. Asserted both ways so a
  // future edit cannot satisfy this by dropping the destination entirely.
  assert.ok(r.informationalAnswer.includes("Spain"), "the answer no longer names the destination");
  assert.ok(!/\(ES\)/.test(r.informationalAnswer), "the country code is back on the traveller's answer");
  assert.equal(r.classification.destinationCountry, "ES", "the code must still be on the classification");
  assert.equal(r.letterHtml, undefined, "no formal letter on the auto path");
  assert.equal(r.durationDays, 19);
  assert.equal(r.route, null);

  const caseRow = caseStore.cases[0];
  assert.equal(caseRow.status, "resolved");
  assert.equal(caseRow.decision, "auto_resolve");
  assert.equal(caseRow.externalRef, "9001");
  assert.equal(caseStore.reviewQueue.length, 0, "auto-resolved cases need no specialist");

  const doc = caseStore.documents.find((d) => d.type === "travel_informational_response");
  assert.ok(doc, "the informational answer is stored as a document");
  assert.ok(doc.content.includes("does not constitute legal or immigration advice"), "mandatory travel disclaimer is on it");

  const auditEntry = audit.forUseCase("UC-03")[0];
  assert.equal(auditEntry.action, "auto_resolve");
  assert.equal(auditEntry.details.letterIssued, false, "a UC-03 letter is never issued by the automation");
  assert.ok(auditEntry.details.disclaimerApplied);
});

// SIGNATURE-REQUIRED POSTURE. On the default posture this exact request issues
// the letter without a signature — that chain is the headline of
// test/uc03AutoIssue.test.js. This test keeps the other posture honest: a
// deployment that sets `letterAutoIssue: false` gets back exactly the drafted,
// queued, unissued letter every path produced before the split.
test("workflow: with signatures required, human_review drafts the letter but never issues it, and queues a specialist", async () => {
  fresh();
  const r = await run(
    {
      text: "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
      externalRef: "9003",
    },
    { letterAutoIssue: false }
  );
  assert.equal(r.decision, "human_review");
  // The DOCUMENT is titled with Remote's own noun ("travel letter",
  // /v1/travel-letter-requests) — REMOTE-VOCABULARY.md §5.3. The REQUEST text
  // above deliberately still says "travel support letter", which is what
  // employees actually type: the rename is ours to make on what we render, not
  // on what a customer is allowed to ask for, and classifier.js's regex
  // accepts both. Both halves of that are asserted here on purpose.
  assert.ok(r.letterHtml.includes("Travel Letter"));
  assert.ok(!r.letterHtml.includes("Travel Support Letter"));
  assert.ok(r.letterHtml.includes("Amara Okafor"), "letter names the real employee from the Remote record");
  assert.ok(r.letterHtml.includes("Remote Nigeria EOR Ltd"), "letter is on the legal entity's letterhead");
  assert.ok(r.letterHtml.includes("Germany"), "letter names the destination");
  assert.ok(r.letterHtml.includes("50,000.00 USD"), "letter carries compensation in the HITL path only");
  assert.equal(r.informationalAnswer, undefined);
  assert.ok(r.letterHtml.includes("does not constitute legal or immigration advice"), "travel disclaimer appended");

  const caseRow = caseStore.cases[0];
  assert.equal(caseRow.status, "pending_review");
  const q = caseStore.reviewQueue.find((e) => e.caseId === caseRow.id);
  assert.ok(q, "a human_review case enters the specialist queue");
  assert.match(q.notes, /awaiting Travel & Mobility Support sign-off/);
  assert.match(q.notes, /signoff\|decline/, "the queue note names the route that can actually record the sign-off");
  const doc = caseStore.documents.find((d) => d.type === "travel_support_letter");
  assert.ok(doc, "the drafted letter is stored as a document");

  const auditEntry = audit.forUseCase("UC-03")[0];
  assert.equal(auditEntry.details.letterIssued, false, "letter is DRAFTED, never issued");
  assert.equal(auditEntry.details.reason, "formal_letter_requested");
});

test("workflow: route_to_uc04 records a normalized handoff event, never a live call", async () => {
  fresh();
  const r = await run({
    text: "I'd like to work remotely from Portugal for a month while on holiday — can I do my normal job from there?",
    externalRef: "9002",
  });
  assert.equal(r.decision, "route_to_uc04");
  assert.equal(r.route, "uc04_work_authorization");
  assert.deepEqual(r.handoffEvent, {
    event_type: "CROSS_BORDER_WORK_REQUESTED",
    source_use_case: "UC-03",
    employee_id: "emp_active_001",
    origin_country: "NG",
    destination_country: "PT",
    start_date: null,
    end_date: null,
    will_work_abroad: true,
    purpose: "temporary_remote_work",
    source_request_id: "9002",
  });

  const caseRow = caseStore.cases[0];
  assert.equal(caseRow.status, "routed");
  assert.ok(caseStore.reviewQueue.some((e) => e.caseId === caseRow.id), "routed cases are visible to a human");
  const auditEntry = audit.forUseCase("UC-03")[0];
  assert.equal(auditEntry.details.handoffEvent.event_type, "CROSS_BORDER_WORK_REQUESTED");
});

test("workflow: an over-cap business trip escalates to Global Mobility", async () => {
  fresh();
  const r = await run({
    text: "Business meetings in India from 2026-09-01 to 2026-10-31.",
    externalRef: "9004",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_over_cap");
  assert.equal(r.durationDays, 61);
  assert.equal(r.informationalAnswer, undefined);
  assert.equal(r.letterHtml, undefined);
  const caseRow = caseStore.cases[0];
  assert.equal(caseRow.status, "escalated");
  assert.ok(caseStore.reviewQueue.some((e) => e.caseId === caseRow.id));
});

test("workflow: an unsupported destination escalates — the supported list is a gate, not a hint", async () => {
  fresh();
  // A STRUCTURED DESTINATION, NOT A NAME IN THE TEXT — and the reason is worth
  // recording, because it constrains what this rung can ever be tested with.
  //
  // Canada joined the mock registry (2026-09-02) because it is one of the four
  // countries docs/DEMO-COUNTRIES.md promises. This test needs the opposite: a
  // destination the registry does NOT confirm. Every country UC-03's free-text
  // dictionary recognises and the mock omits is a SANCTIONED one — and those
  // are caught by the sanctions rung, which runs FIRST — so after the Canada
  // addition no sentence anybody can type reaches this rung at all. It is
  // reachable only the way the portal actually reaches it: the destination
  // picker, which offers the full ISO list rather than the 32 names the
  // classifier can read out of prose.
  //
  // `classification` is passed directly for that reason, and this is the one
  // place in this file that does it — the rung is real, the path to it is
  // structured, and pretending otherwise would leave it untested.
  const r = await run(
    { text: "Client meeting from 2026-09-01 to 2026-09-05.", externalRef: "9005" },
    { classify: async () => baseClassification({ destinationCountry: "JP" }) }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "destination_jurisdiction_excluded");

  // THE OTHER HALF, AND IT IS WHAT MAKES THIS A GATE RATHER THAN A CONSTANT.
  // The identical request to a CONFIRMED destination must not escalate — else
  // this test would pass just as well against a list that refused everything,
  // which is exactly the state Canada was in before it was added.
  fresh();
  const confirmed = await run(
    { text: "Client meeting from 2026-09-01 to 2026-09-05.", externalRef: "9005-can" },
    { classify: async () => baseClassification({ destinationCountry: "CA" }) }
  );
  assert.notEqual(
    confirmed.reason,
    "destination_jurisdiction_excluded",
    "a demo country is being refused as unsupported — the fixture gap is back"
  );
});

test("workflow: identity fails closed — no session, no support", async () => {
  fresh();
  const r = await run({ text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.", session: null });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
  assert.deepEqual(r.flags, ["identity_unauthenticated_requires_stepup"]);
});

test("workflow: a terminated employee escalates regardless of request", async () => {
  fresh();
  const r = await run({
    employmentId: "emp_terminated_002",
    session: { authenticatedEmploymentId: "emp_terminated_002" },
    text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
  });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
});

test("workflow: the sanctioned gate works end to end when the classifier supplies the code", async () => {
  fresh();
  const fakeClassify = async () => ({
    ...classifyTravelInquiryRuleBased({ text: "Business meetings." }),
    // CONFIDENCE STATED, NOT INHERITED. These doubles spread a classification
    // of text that names no destination and no dates, then override the trip
    // facts — so the inherited `confidence` describes the EMPTY read, not the
    // populated fixture. That was invisible while the rule scan scored every
    // failure at 0.6, which is not below the 0.6 floor; the gate could not
    // fire, so an inconsistent double behaved identically to a consistent one.
    // The scan now scores a total failure at 0.3, and these doubles have to say
    // what they mean: a classifier that supplied a destination and both dates
    // read them.
    confidence: 0.9,
    intent: "business_travel",
    destinationCountry: "RU",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
  });
  const r = await run({ text: "Business meetings in Russia.", externalRef: "9006" }, { classify: fakeClassify });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "sanctioned_region");
  assert.deepEqual(r.flags, ["sanctioned_region"]);
});

test("workflow: a 404 employment read can never be identity-verified by a matching session id", async () => {
  // The security property the n8n port of this logic once lost: identity must
  // be proved against a record from an AUTHENTICATED SOURCE, never against a
  // value echoed back out of the caller's own request. Here the caller controls
  // both sides — `employmentId` and `session.authenticatedEmploymentId` are the
  // same string — and the Remote read returns nothing. RemoteClient's 404 ->
  // null convention is what makes this fail closed at the IDENTITY gate, rather
  // than at the employment-status gate one step later.
  fresh();
  const notFoundRemote = {
    getEmployment: async () => null, // RemoteClient.getEmployment()'s documented 404 answer
    // `listCountries()` returns the CLIENT's normalised `{country_code, name}`
    // rows, not raw API rows — handing back the raw mock fixture here would
    // make the double disagree with the method it is standing in for, which is
    // how a shape defect hides.
    listCountries: async () => COUNTRIES.map((c) => ({ country_code: c.alpha_2_code, name: c.name })),
  };
  const r = await handleTravelInquiry(
    {
      text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.",
      employmentId: "emp_active_001",
      session: { authenticatedEmploymentId: "emp_active_001" },
      externalRef: "9404",
    },
    { remote: notFoundRemote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "identity_not_verified");
  assert.deepEqual(r.flags, ["identity_no_employment_record"]);

  const logged = audit.entries.at(-1);
  assert.equal(logged.details.identity.verified, false);
  assert.equal(logged.details.identity.reason, "no_employment_record");
  assert.notEqual(logged.details.identity.method, "session");
});

test("workflow: a supported-countries read failure propagates — a support check fails closed, not open", async () => {
  fresh();
  const throwingRemote = {
    getEmployment: async () => EMPLOYMENTS["emp_active_001"],
    listCountries: async () => {
      throw new Error("remote unavailable");
    },
  };
  await assert.rejects(
    handleTravelInquiry(
      { text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.", employmentId: "emp_active_001", session: ACTIVE },
      { remote: throwingRemote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    ),
    /remote unavailable/
  );
  assert.equal(caseStore.cases.length, 0, "nothing is recorded when the support check never resolved");
});

// ---------------------------------------------------------------------------
// 6. STEP 8 — Zendesk closing loop (only when a client + a real ticket id exist)
// ---------------------------------------------------------------------------

test("workflow: the Zendesk close-loop call is made with the exact payload", async () => {
  fresh();
  const calls = [];
  const zendesk = {
    updateTicket: async (ref, payload) => calls.push({ kind: "updateTicket", ref, payload }),
    flagForReview: async (ref, payload) => calls.push({ kind: "flagForReview", ref, payload }),
  };

  await run(
    { text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.", source: "zendesk", externalRef: "ZT-1001" },
    { zendesk }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "updateTicket");
  assert.equal(calls[0].ref, "ZT-1001");
  assert.equal(calls[0].payload.status, "solved");
  assert.equal(calls[0].payload.comment.public, true);
  assert.ok(calls[0].payload.comment.body.includes("Spain"));
});

test("workflow: human_review flags the ticket for the specialist with the letter-review tag", async () => {
  fresh();
  const calls = [];
  const zendesk = {
    updateTicket: async () => {},
    flagForReview: async (ref, payload) => calls.push({ ref, payload }),
  };
  await run(
    {
      text: "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.",
      source: "zendesk",
      externalRef: "ZT-1002",
    },
    { zendesk, letterAutoIssue: false }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload.tags, ["uc03_formal_letter_review"]);
  assert.match(calls[0].payload.note, /Travel & Mobility Support signs it off first/);
});

test("workflow: route_to_uc04 flags the ticket with the UC-04 routing tag and names the handoff", async () => {
  fresh();
  const calls = [];
  const zendesk = {
    updateTicket: async () => {},
    flagForReview: async (ref, payload) => calls.push({ ref, payload }),
  };
  await run(
    { text: "I'd like to work remotely from Portugal for a month.", source: "zendesk", externalRef: "ZT-1003" },
    { zendesk }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload.tags, ["uc03_routed_uc04"]);
  assert.match(calls[0].payload.note, /CROSS_BORDER_WORK_REQUESTED/);
});

test("workflow: escalate flags the ticket with the escalate tag", async () => {
  fresh();
  const calls = [];
  const zendesk = {
    updateTicket: async () => {},
    flagForReview: async (ref, payload) => calls.push({ ref, payload }),
  };
  await run(
    { text: "Business meetings in India from 2026-09-01 to 2026-10-31.", source: "zendesk", externalRef: "ZT-1004" },
    { zendesk }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload.tags, ["uc03_escalated"]);
});

test("workflow: no zendesk client supplied means no Zendesk call is ever attempted", async () => {
  fresh();
  const r = await run({ text: "Client meeting in Spain from 2026-09-14 to 2026-10-02." });
  assert.equal(r.decision, "auto_resolve");
});

// ---------------------------------------------------------------------------
// 7. Audit trace binding (invariant 7) — the classifier's attempts end up
//    attached to the decision row that used them
// ---------------------------------------------------------------------------

test("workflow: classifier trace steps bind to the decision's audit row", async () => {
  fresh();
  const tracedClassify = async ({ text }, { audit: a }) => {
    a?.logTraceStep({ call: "classifyTravelInquiry.askJson", attempt: 1, ok: true });
    return { ...classifyTravelInquiryRuleBased({ text }), source: "llm" };
  };
  await run({ text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.", externalRef: "9007" }, { classify: tracedClassify });

  const decisionEntry = audit.forUseCase("UC-03")[0];
  assert.ok(decisionEntry, "the decision row exists");
  const trace = audit.entries.find((e) => e.call === "classifyTravelInquiry.askJson");
  assert.ok(trace, "the trace step exists");
  assert.equal(trace.parentId, decisionEntry.id, "the attempt is bound to the decision it informed");
});

// ---------------------------------------------------------------------------
// 8. CaseStore lookups across the workflow boundary (findById / findByExternalRef)
// ---------------------------------------------------------------------------

test("CaseStore: findById and findByExternalRef find rows created by the workflow", async () => {
  fresh();
  await run({ text: "Client meeting in Spain from 2026-09-14 to 2026-10-02.", externalRef: "9010" });
  const row = caseStore.cases[0];
  assert.equal((await caseStore.findById(row.id)).decision, "auto_resolve");
  const byRef = await caseStore.findByExternalRef("9010");
  assert.equal(byRef.id, row.id);
  assert.equal(await caseStore.findByExternalRef("no-such-ticket"), null);
  assert.equal(await caseStore.findById("no-such-id"), null);
});

test("CaseStore: findByExternalRef returns the newest row for a ticket, not an arbitrary one", async () => {
  fresh();
  const first = caseStore.createCase({
    useCase: "UC-03",
    externalRef: "ZT-2000",
    employmentId: "emp_active_001",
    decision: "escalate",
    status: "escalated",
  });
  caseStore.createCase({
    useCase: "UC-03",
    externalRef: "ZT-2000",
    employmentId: "emp_active_001",
    decision: "auto_resolve",
    status: "resolved",
  });
  const byRef = await caseStore.findByExternalRef("ZT-2000");
  assert.notEqual(byRef.id, first.id, "the newest row wins");
  assert.equal(byRef.decision, "auto_resolve");
});

// ---------------------------------------------------------------------------
// 9. Rendering details worth pinning down
// ---------------------------------------------------------------------------

test("informational answer: no compensation is ever mentioned on the auto path", () => {
  const answer = renderInformationalAnswer({
    destinationCountry: "ES",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    durationDays: 19,
  });
  assert.ok(!/salary|compensation|€|£|\$/.test(answer), "the zero-touch answer carries no money");
  assert.match(answer, /does not constitute legal or immigration advice/);
  // THE OFFER, IN THE ANSWER ITSELF. This line used to read "reply to this
  // ticket and a specialist will review and issue it", which cost the employee
  // a whole second request — and on the n8n path a reply is a redelivery of an
  // already-claimed ticket, so it could be dropped silently. The answer now
  // offers the letter for THIS trip (src/uc03/letterOffer.js), and still says
  // plainly that a specialist signs it before it goes out.
  assert.match(answer, /without describing the trip again/);
  // THIS ASSERTION MOVED, AND IT MOVED BECAUSE THE SENTENCE STOPPED BEING TRUE.
  // It used to read /signs off every one before it goes out/, which was correct
  // of every path when it was written: no code in this repository could issue a
  // UC-03 letter without a specialist. The standard letter now issues on the 🟢
  // path (docs/use-cases/UC-03.md §23), so promising a signature here would be
  // promising a wait that will not happen — and the answer says the one thing
  // that CAN still hold the letter up instead.
  assert.match(answer, /issued to you straight away/);
  assert.ok(
    !/signs off every one before it goes out/.test(answer),
    "the answer must not promise a signature the default posture does not require"
  );
  // …and the money invariant above is untouched on purpose: the rows the letter
  // will contain, base compensation among them, are named on the OFFER
  // (describeLetterOffer()'s `produces`), which is what a surface renders beside
  // the accept control. An informational reply that has learned to say the word
  // "compensation" is one edit away from saying a number.
});

test("countryName(): an untrusted destination string shaped like an Object.prototype key never resolves through the prototype chain", () => {
  // `destinationCountry` originates in LLM/rule-based classification of raw
  // customer text; classifier.js's shape guard only checks `typeof ===
  // "string"`, never the value. Before the fix, `COUNTRY_NAMES["constructor"]`
  // resolved via the prototype chain to `Object` itself, which would
  // stringify into a customer-facing letter/answer as "[Function: Object]"
  // instead of falling through to the raw code.
  assert.equal(countryName("constructor"), "constructor");
  assert.equal(countryName("toString"), "toString");
  assert.equal(countryName("hasOwnProperty"), "hasOwnProperty");
  // A genuinely known code still resolves normally.
  assert.equal(countryName("ES"), "Spain");
  // An unknown-but-ordinary code still falls through to the raw value.
  assert.equal(countryName("ZZ"), "ZZ");
});

test("informational answer never renders a prototype-chain leak even when fed a poisoned destination code", () => {
  const answer = renderInformationalAnswer({
    destinationCountry: "constructor",
    startDate: "2026-09-14",
    endDate: "2026-10-02",
    durationDays: 19,
  });
  assert.ok(!/native code|function Object/.test(answer), "must never leak a stringified native function into customer-facing text");
});

test("travel letter: compensation is present only in the HITL artifact and only from the record", () => {
  const letter = renderTravelLetterHtml({
    employment: EMPLOYMENTS["emp_active_001"],
    legalEntity: LEGAL_ENTITIES["le_ng_01"],
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
  });
  assert.ok(letter.includes("50,000.00 USD"), "×100 base_salary formatted via shared money.js");
  assert.match(letter, /not a work\s+authorization/, "a support letter confirms travel, it never authorizes working");
  assert.ok(letter.includes("does not constitute legal or immigration advice"));
  assert.ok(!letter.includes("work remotely"), "the letter confirms travel, it does not authorize working");
});

test("buildUc04HandoffEvent: always carries the UC-03 source stamp and the ticket ref", () => {
  const ev = buildUc04HandoffEvent({
    employment: EMPLOYMENTS["emp_active_001"],
    classification: baseClassification({ intent: "work_authorization", destinationCountry: "PT" }),
    externalRef: "T-77",
  });
  assert.equal(ev.source_use_case, "UC-03");
  assert.equal(ev.source_request_id, "T-77");
  assert.equal(ev.event_type, "CROSS_BORDER_WORK_REQUESTED");
  assert.equal(ev.destination_country, "PT");
  assert.equal(ev.origin_country, "NG");
  assert.equal(ev.will_work_abroad, true);
});

// ---------------------------------------------------------------------------
// 10. The supported-countries source itself — listCountries() against the real
//     mock envelope, proving the workflow's gate input is wired correctly
// ---------------------------------------------------------------------------

test("RemoteClient.listCountries(): normalizes the mock envelope to {country_code, name}", async () => {
  const list = await remote.listCountries();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  assert.ok(list.every((c) => typeof c.country_code === "string" && typeof c.name === "string"));
  const codes = new Set(list.map((c) => c.country_code));
  assert.ok(codes.has("ES") && codes.has("DE") && codes.has("PT"));
  // CANADA IS NOW PRESENT, AND JAPAN IS THE FIXTURE INSTEAD (2026-09-02).
  //
  // This line used to read `codes.has("CA") === false`, with the note "Canada
  // is deliberately absent so the fail-closed test has a fixture". True, and
  // it collided with a promise: docs/DEMO-COUNTRIES.md declares NL · PT · CA ·
  // US demonstrable, so every UC-03 question about Canada answered
  // `destination_jurisdiction_excluded` — a claim ABOUT THE DESTINATION,
  // produced by the mock never having heard of it. A fixture gap wearing a
  // jurisdiction finding.
  //
  // The test still needs an absent country and now names one nothing promises.
  // BOTH halves are asserted, so the fixture cannot quietly become complete
  // (which would make the fail-closed path undemonstrable) and Canada cannot
  // quietly go missing again.
  assert.ok(codes.has("CA"), "Canada is one of the four demo countries and must be confirmable");
  assert.equal(codes.has("JP"), false, "Japan is deliberately absent so the fail-closed test has a fixture");
  assert.equal(COUNTRIES.length, list.length);
});

test("the sanctioned set and the supported list never overlap — the gate is genuinely independent", () => {
  // `alpha_2_code`, not `country_code` — the mock now serves the live row shape
  // (src/remote/mockServer.js). Mapping the old key here would silently fill
  // this Set with `undefined`, and every assertion below would pass vacuously:
  // a sanctions/support overlap check that can never find an overlap because it
  // is comparing against nothing. That is the same failure mode as F-25 itself,
  // relocated into the test that is supposed to catch it.
  const supportedCodes = new Set(COUNTRIES.map((c) => c.alpha_2_code));
  assert.ok(supportedCodes.size > 0 && [...supportedCodes].every((c) => /^[A-Z]{2}$/.test(c)));
  for (const code of SANCTIONED_OR_RESTRICTED) {
    assert.equal(supportedCodes.has(code), false, `sanctioned ${code} must never appear in the supported list`);
  }
});

// ---------------------------------------------------------------------------
// F-19 — the confidence gate UC-03.md §7 bullet 1 requires, which did not exist
// ---------------------------------------------------------------------------
// `classification.confidence` was produced and shape-validated by the
// classifier, then never read by any gate: a classification the model itself
// scored 0.05 auto-resolved with an informational answer. The spec's rule is
// "low confidence → human review, never a guessed route", and every routing
// decision this engine makes is made ON the classified intent — so the gate
// sits before the intent-based routing, not after it.

function lowConfidenceBase(overrides = {}) {
  return {
    employment: activeEmployment(),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES"]),
    classification: baseClassification(overrides),
  };
}

test("evaluate: a classification the model barely believes is a human's call, not a guessed route", () => {
  const r = evaluate(lowConfidenceBase({ confidence: 0.05 }));
  assert.equal(r.decision, "human_review", "the finding's exact proof case");
  assert.equal(r.reason, "low_confidence");
  assert.deepEqual(r.flags, ["low_confidence"]);
  assert.equal(r.durationDays, null);
});

test("evaluate: low confidence is checked BEFORE the UC-04 route — an unsure intent must not pick a pipeline", () => {
  const r = evaluate(
    lowConfidenceBase({ intent: "work_authorization", confidence: 0.05 })
  );
  assert.equal(r.decision, "human_review", "a route is a decision made ON the intent");
  assert.equal(r.reason, "low_confidence");
  assert.equal(r.route, undefined);
});

test("evaluate: the confidence gate FAILS CLOSED — absent, NaN and non-numeric all go to a human", () => {
  for (const confidence of [undefined, NaN, null, "0.99"]) {
    const r = evaluate(lowConfidenceBase({ confidence }));
    assert.equal(r.decision, "human_review", `confidence ${String(confidence)} must never route or resolve`);
    assert.equal(r.reason, "confidence_unknown");
    assert.deepEqual(r.flags, ["confidence_unknown"]);
  }
});

test("evaluate: the threshold is calibrated to the classifier's own floor, so a date-less inquiry still reaches its own gate", () => {
  // classifier.js scores 0.6 when it read the intent but not the full
  // itinerary. That case has dedicated gates (`duration_unknown`,
  // `destination_unknown`) with far more useful reasons, so the confidence
  // gate must not pre-empt them.
  assert.equal(DEFAULT_CONFIDENCE_THRESHOLD, 0.6);
  const r = evaluate(lowConfidenceBase({ confidence: 0.6, startDate: null, endDate: null }));
  assert.equal(r.reason, "duration_unknown", "not swallowed by the confidence gate");
});

test("evaluate: identity and employment status are still checked before confidence", () => {
  const unverified = evaluate({
    ...lowConfidenceBase({ confidence: 0.05 }),
    identity: { verified: false, method: "none", reason: "unauthenticated_requires_stepup" },
  });
  assert.equal(unverified.reason, "identity_not_verified", "a security gate outranks a quality gate");
});

// ---------------------------------------------------------------------------
// 11. F-25 — the supported-countries gate was DEAD in production
// ---------------------------------------------------------------------------
// `listCountries()` mapped `c.country_code ?? c.code`. The live
// `GET /v1/countries` returns neither as an alpha-2 value: the alpha-3 form is
// in `code` ("ESP") and the alpha-2 form in `alpha_2_code` ("ES"). So the
// supported set held 3-letter codes and the gate probed it with 2-letter
// destinations. Every membership test was false, so UC-03 could NEVER
// auto_resolve in production — Spain, `eor_onboarding: true`, escalated as
// `unsupported_destination` (n8n execution 4259: `supportedCountries: []` after
// a successful 224-row fetch).
//
// It hid because the system fails closed. A use case that structurally cannot
// succeed produces exactly the same observable behaviour as one being
// appropriately cautious — so these tests deliberately assert BOTH directions:
// the supported destination must now genuinely reach `auto_resolve`, AND every
// unreadable/empty/unsupported case must still escalate. Half of this pair
// alone would let the fix become a fail-OPEN regression, which on UC-03 means
// auto-replying to and solving a real customer's ticket about a country the
// platform does not support.
//
// The fixture is the live response, verbatim — see test/fixtures/remoteCountries.js.

/**
 * A tiny HTTP server serving the REAL `GET /v1/countries` envelope (plus enough
 * of `/v1/employments/:id` and `/v1/legal-entities` to drive the workflow), so
 * these tests exercise the ACTUAL RemoteClient mapping over the ACTUAL wire
 * shape — not a hand-mapped fake, which is the class of shortcut that let the
 * bug live. `countriesBody` is whatever the caller wants the endpoint to answer
 * with, including nonsense, so the fail-closed cases are real responses too.
 */
async function liveShapeRemote(countriesBody, { countriesStatus = 200 } = {}) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url.startsWith("/v1/countries")) {
      return countriesStatus === 200 ? send(200, countriesBody) : send(countriesStatus, { error: "upstream" });
    }
    const empMatch = req.url.match(/^\/v1\/employments\/([^/?]+)/);
    if (empMatch) {
      const emp = EMPLOYMENTS[empMatch[1]];
      return emp ? send(200, { data: emp }) : send(404, { error: "not_found" });
    }
    if (req.url.startsWith("/v1/legal-entities")) {
      return send(200, { data: { legal_entities: Object.values(LEGAL_ENTITIES) } });
    }
    return send(404, { error: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  return {
    // `retries: 1` so the fail-closed 5xx case doesn't spend three backoffs.
    remote: new RemoteClient({ baseUrl: `http://localhost:${port}`, retries: 1, backoff: async () => {} }),
    close: () => server.close(),
  };
}

const SPAIN_TRIP = "Client meeting in Spain from 2026-09-14 to 2026-09-20 — is business travel fine?";

test("F-25: the LIVE countries shape now reaches the gate as alpha-2 — a Spain trip auto-resolves", async () => {
  fresh();
  const { remote: live, close } = await liveShapeRemote(LIVE_COUNTRIES_ENVELOPE);
  try {
    const r = await handleTravelInquiry(
      { text: SPAIN_TRIP, employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-ok" },
      { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
    assert.equal(r.decision, "auto_resolve", "Spain is a fully supported Remote country — this was `escalate` before the fix");
    assert.equal(r.reason, "all_gates_passed");
    assert.deepEqual(r.flags, []);
    const logged = audit.forUseCase("UC-03").at(-1);
    assert.ok(
      logged.details.supportedCountriesChecked.includes("ES"),
      "the audit record proves WHICH list was checked, in the form it was checked in"
    );
  } finally {
    close();
  }
});

test("F-25 fail-closed: an EMPTY countries list still escalates — nothing is confirmed supported", async () => {
  fresh();
  const { remote: live, close } = await liveShapeRemote({ data: [] });
  try {
    const r = await handleTravelInquiry(
      { text: SPAIN_TRIP, employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-empty" },
      { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "destination_jurisdiction_excluded");
  } finally {
    close();
  }
});

test("F-25 fail-closed: an UNREADABLE countries body escalates — an unparseable list is not an empty world", async () => {
  // The two bodies below are what a changed API contract or a proxy error page
  // actually looks like after JSON parsing. Neither may be read as "we checked
  // and Spain was fine"; neither may throw, either, because a crash on the
  // 🟢 path is not a customer-safe answer — it must reach a human.
  for (const body of [{ data: { message: "unexpected" } }, { data: null }, { countries: "nope" }]) {
    fresh();
    const { remote: live, close } = await liveShapeRemote(body);
    try {
      const r = await handleTravelInquiry(
        { text: SPAIN_TRIP, employmentId: "emp_active_001", session: ACTIVE, externalRef: `F25-junk-${JSON.stringify(body).length}` },
        { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
      );
      assert.equal(r.decision, "escalate", `body ${JSON.stringify(body)}`);
      // THE REASON MOVED, AND THAT IS THE POINT OF THE FIX. This used to assert
      // `destination_jurisdiction_excluded` — the very reading this test's own
      // comment forbids, since that string claims Spain's jurisdiction was
      // checked and excluded when in fact nothing was ever read. The decision is
      // unchanged (still a fail-closed escalate); only the recorded cause is now
      // true, so a specialist triages the failed read instead of the country.
      assert.equal(r.reason, "upstream_record_not_found", `body ${JSON.stringify(body)}`);
      assert.ok(r.flags.includes("upstream_countries_404"), `flags were ${JSON.stringify(r.flags)}`);
    } finally {
      close();
    }
  }
});

test("F-25 fail-closed: rows carrying ONLY an alpha-3 code confirm nothing — Spain still escalates", async () => {
  // The tempting one-character "fix" is `?? c.code`. It would put "ESP" in the
  // set, which compares false against "ES" forever — the same bug, one level
  // down and much harder to see. An unplaceable row is dropped instead.
  fresh();
  const alpha3Only = { data: LIVE_COUNTRY_ROWS.map(({ code, name }) => ({ code, name })) };
  const { remote: live, close } = await liveShapeRemote(alpha3Only);
  try {
    const r = await handleTravelInquiry(
      { text: SPAIN_TRIP, employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-alpha3" },
      { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "destination_jurisdiction_excluded");
    const logged = audit.forUseCase("UC-03").at(-1);
    assert.deepEqual(logged.details.supportedCountriesChecked, [], "no 3-letter code is ever smuggled into the checked set");
  } finally {
    close();
  }
});

test("F-25 fail-closed: a genuinely unsupported destination still escalates against the live list", async () => {
  fresh();
  // The live fixture has no Cuba row. (Cuba is also sanctioned, so use a
  // neutral absent country: the fixture holds ES/DE/PT/AL/AS/NG/CA only.)
  const { remote: live, close } = await liveShapeRemote(LIVE_COUNTRIES_ENVELOPE);
  try {
    const r = await handleTravelInquiry(
      { text: "Trip to Poland from 2026-09-14 to 2026-09-20 for a client meeting.", employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-unsupported" },
      { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
    );
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "destination_jurisdiction_excluded");
  } finally {
    close();
  }
});

test("F-25 fail-closed: an upstream failure fetching countries propagates — it never becomes an empty list", async () => {
  fresh();
  const { remote: live, close } = await liveShapeRemote(null, { countriesStatus: 503 });
  try {
    await assert.rejects(
      handleTravelInquiry(
        { text: SPAIN_TRIP, employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-503" },
        { remote: live, audit, caseStore, classify: classifyTravelInquiryRuleBased }
      ),
      /countries failed: 503/
    );
    assert.equal(caseStore.cases.length, 0, "nothing recorded when the support check never resolved");
  } finally {
    close();
  }
});

test("F-25: a sanctioned destination is still blocked even when it IS on the supported list", async () => {
  // Defence in depth survives the fix: the sanctions override runs before the
  // supported-list check, so making the list actually work cannot open a hole.
  fresh();
  const withRussia = { data: [...LIVE_COUNTRY_ROWS, { code: "RUS", name: "Russia", alpha_2_code: "RU" }] };
  // The rule-based classifier has no "russia" entry, so supply the code the way
  // the existing end-to-end sanctions test does — the point here is the GATE
  // ordering against a now-working supported list, not the extraction.
  const classifyRussia = async () => ({
    ...classifyTravelInquiryRuleBased({ text: "Business meetings." }),
    // CONFIDENCE STATED, NOT INHERITED. These doubles spread a classification
    // of text that names no destination and no dates, then override the trip
    // facts — so the inherited `confidence` describes the EMPTY read, not the
    // populated fixture. That was invisible while the rule scan scored every
    // failure at 0.6, which is not below the 0.6 floor; the gate could not
    // fire, so an inconsistent double behaved identically to a consistent one.
    // The scan now scores a total failure at 0.3, and these doubles have to say
    // what they mean: a classifier that supplied a destination and both dates
    // read them.
    confidence: 0.9,
    intent: "business_travel",
    destinationCountry: "RU",
    startDate: "2026-09-14",
    endDate: "2026-09-20",
  });
  const { remote: live, close } = await liveShapeRemote(withRussia);
  try {
    const r = await handleTravelInquiry(
      { text: "Business trip to Russia from 2026-09-14 to 2026-09-20.", employmentId: "emp_active_001", session: ACTIVE, externalRef: "F25-sanctioned" },
      { remote: live, audit, caseStore, classify: classifyRussia }
    );
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "sanctioned_region");
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// 12. The POSITIVE test — a listed, non-EOR destination must auto-resolve
// ---------------------------------------------------------------------------
// This is the test that exists to FAIL if someone later "tightens" step 7 from
// list membership to `eor_onboarding: true`. Nothing in the suite would have
// caught that before: every other country fixture is EOR-capable, so the two
// predicates gave identical answers everywhere and the tightening would have
// looked like a no-op while silently refusing legitimate travel.
//
// This project's own hardest-won lesson, from CLAUDE.md §5: "a use case that
// structurally cannot succeed is indistinguishable from one being
// appropriately cautious, and no amount of negative testing will tell them
// apart. Only a positive test — 'this input MUST auto-resolve' — detects it."
// The dead-gate bug (F-25) passed every fail-closed assertion in this file.
//
// MONTENEGRO IS THE CASE THAT SEPARATES THE TWO PREDICATES. Live 2026-08-17:
// present in `GET /v1/countries` (`alpha_2_code: "ME"`, `code: "MNE"`) with
// `eor_onboarding: false`. So the jurisdiction is fine — Remote simply has no
// employing entity there, which is a fact about hiring, not about visiting.
// Remote documents the two things separately and in its own words:
//   - the list holds "the countries where creating a company is allowed"
//     <https://developer.remote.com/reference/get_v1_countries.md>
//   - `eor_onboarding`: "A boolean that indicates whether Remote supports EOR
//     onboarding in this country"
//     <https://developer.remote.com/docs/working-with-countries.md>
// Gating travel on the second would escalate a German employee's fortnight in
// Montenegro and — the case that makes the error undeniable — a FRENCH
// employee's trip to Martinique, an integral part of the French Republic and
// therefore domestic travel. A specialist reading "unsupported destination" on
// either ticket would conclude the automation is broken and would be right.
// Full argument: docs/research/COUNTRY-SUPPORT-SEMANTICS.md §5.2 and §8.

/** The real Montenegro row, straight from the verbatim live fixture. */
const MONTENEGRO_ROW = LIVE_COUNTRY_ROWS.find((r) => r.alpha_2_code === "ME");

test("the Montenegro fixture is genuinely the case this test needs: listed, NOT EOR", () => {
  // Asserted rather than assumed. If someone re-captures the fixture and
  // Montenegro's `eor_onboarding` flips to true, the test below silently stops
  // proving anything — it would pass under BOTH predicates again.
  assert.ok(MONTENEGRO_ROW, "the live fixture must carry a Montenegro row");
  assert.equal(MONTENEGRO_ROW.eor_onboarding, false, "if this is ever true, this whole block proves nothing");
  assert.equal(MONTENEGRO_ROW.code, "MNE", "alpha-3 in `code` — the axis F-25 was about");
});

test("POSITIVE: a listed, non-EOR destination (Montenegro) AUTO-RESOLVES — the gate is membership, not eor_onboarding", async () => {
  fresh();
  // Montenegro is not in the rule-based classifier's small demo country map, so
  // the classification is injected — the same idiom the sanctions test above
  // uses. The point under test is the GATE, not the extraction.
  const classifyMontenegro = async () => ({
    ...classifyTravelInquiryRuleBased({ text: "Client meetings." }),
    // CONFIDENCE STATED, NOT INHERITED. These doubles spread a classification
    // of text that names no destination and no dates, then override the trip
    // facts — so the inherited `confidence` describes the EMPTY read, not the
    // populated fixture. That was invisible while the rule scan scored every
    // failure at 0.6, which is not below the 0.6 floor; the gate could not
    // fire, so an inconsistent double behaved identically to a consistent one.
    // The scan now scores a total failure at 0.3, and these doubles have to say
    // what they mean: a classifier that supplied a destination and both dates
    // read them.
    confidence: 0.9,
    intent: "business_travel",
    destinationCountry: "ME",
    startDate: "2026-09-14",
    endDate: "2026-09-20",
  });
  const { remote: live, close } = await liveShapeRemote(LIVE_COUNTRIES_ENVELOPE);
  try {
    const r = await handleTravelInquiry(
      {
        text: "I have client meetings in Montenegro from 2026-09-14 to 2026-09-20 — is business travel fine?",
        employmentId: "emp_active_001",
        session: ACTIVE,
        externalRef: "ME-positive",
      },
      { remote: live, audit, caseStore, classify: classifyMontenegro }
    );
    assert.equal(r.decision, "auto_resolve", "Montenegro is IN Remote's country registry — travel there is not a jurisdiction problem");
    assert.equal(r.reason, "all_gates_passed");
    assert.deepEqual(r.flags, []);
    const logged = audit.forUseCase("UC-03").at(-1);
    assert.ok(
      logged.details.supportedCountriesChecked.includes("ME"),
      "the audit row proves ME really entered the checked set — an empty set would auto-resolve nothing"
    );
  } finally {
    close();
  }
});

test("POSITIVE (unit): the gate itself accepts a listed non-EOR destination", () => {
  // The workflow-level test above proves the whole chain; this one pins the
  // gate in isolation so a failure says WHICH layer moved.
  const r = evaluate({
    employment: activeEmployment(),
    classification: baseClassification({ destinationCountry: "ME" }),
    identity: verifiedIdentity(),
    supportedCountries: new Set(["ES", "ME"]),
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.reason, "all_gates_passed");
});

// ---------------------------------------------------------------------------
// 13. AF and IQ — the local sanctions list stops being narrower than Remote's
// ---------------------------------------------------------------------------
// `GET /v1/countries` omits 26 alpha-2 codes, and among sovereign states that
// exclusion set is a strict SUPERSET of the eight this repo hand-wrote: Remote
// also omits Afghanistan and Iraq. Verified live 2026-08-17 — AF, IQ and RU
// are all absent from the 224 rows.
//
// Adding them changes WHICH gate fires, not the outcome. Both already
// escalated, because neither is in the registry; but they escalated via the
// membership gate, one gate later, with a reason string that describes a
// registry lookup rather than a sanctions decision. Same defect class as F-13:
// a control whose correctness depends on a downstream gate is not a control,
// and the reason string a specialist reads should name the real cause.
// Strictly more restrictive than before, so it cannot open a hole.

test("AF and IQ are on the local sanctions list, sourced from Remote's own exclusions", () => {
  assert.ok(SANCTIONED_OR_RESTRICTED.has("AF"));
  assert.ok(SANCTIONED_OR_RESTRICTED.has("IQ"));
});

for (const code of ["AF", "IQ"]) {
  test(`${code} is refused BY THE SANCTIONS GATE, even when it is (impossibly) on the registry list`, () => {
    // Supplying it in `supportedCountries` is the whole point: it isolates the
    // sanctions gate. If the override were removed, this would auto_resolve.
    const r = evaluate({
      employment: activeEmployment(),
      classification: baseClassification({ destinationCountry: code }),
      identity: verifiedIdentity(),
      supportedCountries: new Set(["ES", code]),
    });
    assert.equal(r.decision, "escalate");
    assert.equal(r.reason, "sanctioned_region", "not the registry gate — the sanctions gate names the real cause");
    assert.deepEqual(r.flags, ["sanctioned_region"]);
  });
}

// ---------------------------------------------------------------------------
// 11. THE CHECKPOINT — Spain, 3 weeks, against a REAL-API-SHAPED countries
//     response, not the mock's shape. This section exists because the two
//     tests immediately above it give FALSE confidence: they only prove that
//     RemoteClient.listCountries() round-trips whatever `src/remote/
//     mockServer.js`'s COUNTRIES fixture already hands it — and that fixture
//     is `{country_code: "ES", name: "Spain"}`, a flat shape the real Remote
//     API does not use. If the mock agrees with the code, every test built
//     against the mock agrees with the code too, and the whole suite can be
//     green while the live gate is dead. This is not hypothetical — it is
//     exactly the failure mode this project's own CLAUDE.md documents UC-03
//     having shipped with previously.
//
//     `docs/REMOTE-API-INDEX.txt` here does not give a field-level example for
//     `GET /v1/countries`; there is no country-shape research doc in this
//     worktree either. Absent a live, [CONFIRMED] capture, this suite must not
//     assume the mock's shape is the real one — that assumption is the exact
//     hole being closed. So this test builds its OWN tiny local HTTP server
//     (not a shared fixture) that serves the shape ISO 3166-1 country data
//     realistically takes: separate alpha-2 (`alpha_2_code`) and alpha-3
//     (`code`) fields, and — this is the part the mock omits — NO flat
//     `country_code` field at all, which is what `RemoteClient.listCountries()`
//     currently keys off first (`c.country_code ?? c.code`). If the real API
//     ever omits a flat `country_code` the way this synthetic server does,
//     `listCountries()` falls through to `c.code`, the ALPHA-3 form, and hands
//     UC-03 a supported-countries set no alpha-2 destination can ever match —
//     Spain, or any other country, escalates as `unsupported_destination`
//     forever, never auto_resolve. `evaluate()` itself is proven correct
//     immediately above (`baseClassification`-style tests feed it a clean
//     Set(["ES"]) directly); this section is the one thing between here and
//     `RemoteClient.listCountries()` that those tests cannot see.
//
//     THE FIX THIS TEST WAS WRITTEN AGAINST HAD ALREADY LANDED, ONE LAYER UP.
//     This test's own worktree branched before `src/remote/restClient.js`
//     picked up "Finding F-27" — `listCountries()` now prefers `alpha_2_code`,
//     falling back to `code` only when it is already alpha-2 shaped — landed
//     in the same session, on the main working branch, independently of this
//     scoped pass. So this runs as a REAL assertion, not `test.todo`: it is
//     exactly the positive test this project's own history says a fail-closed
//     suite cannot substitute for — "refuses correctly" and "cannot possibly
//     succeed" read identically from outside, and only a case that MUST
//     succeed tells them apart.
// ---------------------------------------------------------------------------

import { createServer as _createServer } from "node:http";

/**
 * A tiny, self-contained HTTP double for the REAL Remote API's shape —
 * deliberately NOT `src/remote/mockServer.js` (out of scope to edit, and
 * changing its COUNTRIES fixture would itself be the shared-file change this
 * test exists to avoid making). Serves only what handleTravelInquiry() needs
 * for the Spain/business-travel path: one active employment, and a countries
 * list shaped `{alpha_2_code, code, name}` — no `country_code` field, matching
 * ISO 3166-1's real alpha-2/alpha-3 split.
 */
function startRealShapedRemoteDouble(port) {
  const employment = {
    ...EMPLOYMENTS["emp_active_001"],
  };
  const countries = [
    { alpha_2_code: "ES", code: "ESP", name: "Spain" },
    { alpha_2_code: "DE", code: "DEU", name: "Germany" },
    { alpha_2_code: "PT", code: "PRT", name: "Portugal" },
  ];
  const srv = _createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/v1/employments/")) {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: { employment } }));
      return;
    }
    if (req.url === "/v1/countries") {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: { countries } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

test(
  "CHECKPOINT: Spain, 3 weeks, reaches auto_resolve against a REAL-API-shaped /v1/countries response",
  async () => {
    const REAL_SHAPE_PORT = 4099;
    const realShapeServer = await startRealShapedRemoteDouble(REAL_SHAPE_PORT);
    try {
      const realShapeRemote = new RemoteClient({ baseUrl: `http://localhost:${REAL_SHAPE_PORT}` });
      fresh();
      const result = await handleTravelInquiry(
        {
          text: "I'm going to Spain for 3 weeks, from 2026-09-01 to 2026-09-21, just visiting, not working.",
          employmentId: "emp_active_001",
          session: ACTIVE,
          externalRef: "checkpoint-spain",
        },
        { remote: realShapeRemote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
      );
      assert.equal(result.decision, "auto_resolve", "Spain must auto_resolve — the single most important assertion in this suite");
    } finally {
      realShapeServer.close();
    }
  }
);

// ---------------------------------------------------------------------------
// The request itself has to survive into the record a human reads
// ---------------------------------------------------------------------------
// FOUND BY FOLLOWING A ROUTED CASE TO ITS END. `cases` has carried a
// `ticket_text` column since UC-01, UC-01 populates it, and UC-03 — the only
// other use case that writes to `cases`, and the one that is entirely free-text
// driven — left it null on every row. The playground's request box reads
// `view.case.ticketText`; the ZAF sidebar's UC-03 panel loads the case row and
// has nothing else to show; the portal's Zendesk hand-off renders the gates'
// report, not the request. So the specialist deciding whether a formal travel
// letter can be issued received a decision, a reason and a flag list with no
// record of what the employee had actually asked for.
test("every UC-03 decision records the request text a human will need to read", async () => {
  for (const [label, text] of [
    ["auto_resolve", "I'm travelling to Spain for a client meeting from 2026-09-14 to 2026-09-20."],
    ["human_review", "I need a travel support letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26."],
    ["escalate", "I'm attending a conference somewhere next month."],
    ["route_to_uc04", "I'd like to work remotely from Portugal from 2026-09-01 to 2026-09-14."],
  ]) {
    fresh();
    const r = await run({ text, externalRef: `text-${label}` });
    const row = caseStore.cases.find((c) => c.id === r.caseId);
    assert.equal(
      row.ticketText,
      text,
      `a ${row.decision} case recorded no request text — the human at the end of it has nothing to check the decision against`
    );
  }
});

// ---------------------------------------------------------------------------
// The classification is an OUTPUT, not only an audit-log entry
// ---------------------------------------------------------------------------
// Every gate in policyEngine.js below the identity/status pair is decided ON
// the classification: `confidence` gates the whole router (gate 3), `intent`
// picks the UC-04 route (gate 4), `destinationCountry` feeds three gates and
// the two dates feed two more. The result object omitted it entirely, so no
// caller could show WHICH READER produced that intent or how sure it was — and
// §4 invariant 8's `source` tag reached the audit table and nowhere a person
// looking at the decision would see it. Driven from the portal with OpenAI
// unreachable, all four scenarios were `rule_based_fallback` and the page said
// nothing at all.
test("handleTravelInquiry returns the classification its gates decided on", async () => {
  fresh();
  // The REAL classifier, forced down its deterministic branch — the repo's
  // standard hermetic idiom. `classifyTravelInquiryRuleBased` alone is NOT
  // equivalent here: the `source` tag is applied by the wrapper, so injecting
  // the bare rule function would test a shape production never produces.
  const r = await run(
    {
      text: "I'd like to work remotely from Portugal from 2026-09-01 to 2026-09-14.",
      externalRef: "classification-out",
    },
    { classify: (args) => classifyTravelInquiry(args, { isConfigured: () => false }) }
  );
  assert.equal(r.decision, "route_to_uc04");
  assert.ok(r.classification, "the decision's own input is missing from its result");
  assert.equal(r.classification.intent, "work_authorization", "the field gate 4 routed on");
  assert.equal(r.classification.destinationCountry, "PT");
  assert.equal(typeof r.classification.confidence, "number", "the field gate 3 gates on");
  assert.equal(
    r.classification.source,
    "rule_based_fallback",
    "invariant 8's tag has to reach the result, not only the audit row"
  );
  // The same object the audit row records and the case row stores — one
  // reading, three places, never three readings.
  const row = caseStore.cases.find((c) => c.id === r.caseId);
  assert.deepEqual(r.classification, row.classification);
});

test("an auto-resolved inquiry returns its classification too", async () => {
  // Not only the interesting branches: a caller that renders provenance has to
  // be able to render it for the zero-touch path as well, which is the one a
  // customer sees.
  fresh();
  const r = await run(
    {
      text: "I'm travelling to Spain for a client meeting from 2026-09-14 to 2026-09-20.",
      externalRef: "classification-auto",
    },
    { classify: (args) => classifyTravelInquiry(args, { isConfigured: () => false }) }
  );
  assert.equal(r.decision, "auto_resolve");
  assert.equal(r.classification.destinationCountry, "ES");
  assert.equal(r.classification.source, "rule_based_fallback");
});

// ---------------------------------------------------------------------------
// 10. "Am I supposed to just go to UC-04 and see what was forwarded to it?"
// ---------------------------------------------------------------------------
// The owner asked exactly that, having been told by the requester-facing
// sentence that the request "has been handed to the work-authorisation case
// (UC-04)". Nothing is handed to anything: `workflow.js` builds a handoff
// event, records it, returns it, and stops. The answer is no — and the system
// said otherwise. See src/uc03/uc04Intake.js's header for why the fix is the
// wording rather than a dispatch, and docs/CORRECTIONS-LOG.md C-31.
// ---------------------------------------------------------------------------

test("the routing sentence never claims the request was handed, sent or forwarded anywhere", () => {
  const rung = describeDecidingGate("work_authorization_requested");
  assert.ok(rung, "the routing reason must have a ladder rung to speak with");

  // The exact overstatement, and the family it belongs to. Every one of these
  // asserts a transfer that does not happen; the sentence used to contain the
  // first.
  for (const claim of [
    /has been handed to/i,
    // A positive transfer claim needs a SUBJECT that is the request. "Nothing
    // was sent anywhere" is the sentence's own true statement, and a guard that
    // caught it would force the correction back out of the text.
    /\b(it|this|the request|the case) (has been|was|is) (handed|sent|forwarded|dispatched|passed|transferred)\b/i,
    /\ba (uc-?04|work[- ]authorisation|work[- ]authorization) (case|record|request) (has been|was) created\b/i,
  ]) {
    assert.ok(!claim.test(rung.means), `the requester-facing sentence asserts a transfer: ${claim}`);
  }

  // And it says positively what DID happen, so the absence above is not the
  // whole of the correction — a sentence can be free of false claims and still
  // leave the reader to guess.
  //
  // WHAT IT ASSERTS CHANGED WHEN THE READER WAS ESTABLISHED, and the assertions
  // moved with it. This used to require the sentence to contain "nothing was
  // sent anywhere", "no work-authorisation case was created" and "no UC-04
  // queue" — every one of them a true statement about OUR pipeline, on a page
  // read by an employee who asked whether they may work from Portugal. The FACT
  // is what the reader needs and it is kept; the bookkeeping that carried it is
  // now on the specialist's surfaces, where `describeUc04Intake()`'s literal
  // `dispatched: false` and workflow.js's Zendesk note both state it.
  // test/uc03GateProse.test.js is the guard that stops it coming back.
  assert.match(rung.means, /[Nn]othing has been submitted/);
  assert.match(rung.means, /nobody is reviewing/i);
});

test("the routing sentence names where the work-authorization request is actually raised, and what it needs", () => {
  const rung = describeDecidingGate("work_authorization_requested");
  // WHERE. Remote's own Request Hub — `POST /v1/work-authorization-requests`
  // does not exist (docs/REMOTE-VOCABULARY.md §13.1), which is the decisive
  // argument against dispatching and therefore has to be the answer given.
  assert.match(rung.means, /Request Hub/);
  // REMOVED FROM THE GATE'S OWN WORDS, DELIBERATELY. "no API can create one on
  // their behalf" is a fact about this system's integration surface, stated to
  // a Remote employee who did not ask about it. The argument still lives in
  // src/uc03/uc04Intake.js and docs/use-cases/UC-03.md, where an engineer is
  // the reader. What a requester needs — who raises the request, and the
  // things it needs that a travel ticket never states — is asserted around it.
  assert.doesNotMatch(rung.means, /no API can create one/i);

  // WHAT IT NEEDS. Named individually, not gestured at: sending someone to a
  // form without telling them what it wants is what produced the question.
  for (const label of UC04_INPUTS_UC03_CANNOT_SOURCE) {
    assert.ok(rung.means.includes(label), `the sentence does not name a required input: ${label}`);
  }
  assert.equal(UC04_INPUTS_UC03_CANNOT_SOURCE.length, 4, "four inputs UC-03 can never source");

  // AND IT COUNTS NONE OF THEM OUT LOUD. The sentence used to say "four things"
  // and then list four. It is a static string, so four is the only number it
  // could ever say — while the portal's continuation page shows the run's OWN
  // still-missing list (`describeUc04Intake().missing`), which is these four
  // PLUS whatever this particular request did not state: five on the Portugal
  // scenario, which carries no dates. Two correct answers to two different
  // questions, printed on two surfaces a reader crosses in one click, and one of
  // them looked wrong. Naming the items and asserting no total is the only shape
  // that cannot go stale.
  assert.doesNotMatch(
    rung.means,
    /\b(four|4|five|5|three|3)\s+(things|inputs|details|items|fields)\b/i,
    "the routing sentence states a count that a run-specific list on the next page can contradict"
  );
});

test("describeUc04Intake: the four inputs UC-03 has no source for are missing even from a complete handoff", () => {
  // A handoff carrying everything UC-03 could possibly know still cannot
  // complete a UC-04 request — which is the whole argument against dispatch.
  const complete = buildUc04HandoffEvent({
    employment: { id: "emp_active_001", country_code: "NG" },
    classification: { destinationCountry: "PT", startDate: "2026-09-01", endDate: "2026-09-14" },
    externalRef: "9002",
  });
  const intake = describeUc04Intake(complete);

  assert.deepEqual(
    intake.carried.map((c) => c.input),
    ["homeCountry", "destination.country", "startDate / endDate"],
    "the three UC-03 can source, and only those"
  );
  assert.deepEqual(
    intake.missing.map((m) => m.uc04Issue),
    ["missing_nationality", "invalid_visa_type", "invalid_job_duties", "missing_signing_authority"],
    "the four UC-04 would refuse on"
  );
  // The home country comes off the employment record, never the ticket text —
  // the one input that is authoritative rather than classifier-read.
  assert.match(intake.carried[0].source, /employment record/);
  for (const m of intake.missing) assert.match(m.why, /UC-03 has no source for this/);
});

test("describeUc04Intake: a routing decided before the destination gate reports destination and dates missing too", async () => {
  // The routing gate is position 5; the destination gate is 6 and the duration
  // gate is 9. So a `route_to_uc04` is decided BEFORE anything checks that a
  // destination or dates were read at all, and the handoff can carry neither.
  // The report must distinguish that from the four UC-03 never asks for.
  fresh();
  const r = await run({ text: "I will be working remotely while I am away — is that OK?", externalRef: "9101" });
  assert.equal(r.decision, "route_to_uc04");
  assert.equal(r.handoffEvent.destination_country, null);
  assert.equal(r.handoffEvent.start_date, null);

  const missing = r.uc04Intake.missing;
  assert.deepEqual(
    missing.map((m) => m.input),
    ["destination.country", "startDate / endDate", "nationality", "visaType", "jobDuties", "hasContractSigningAuthority"]
  );
  // "you did not say" and "we never ask" are different answers with different
  // fixes, and collapsing them would tell the employee to restate something no
  // travel request has ever carried.
  assert.match(missing[0].why, /Not stated in this request/);
  assert.match(missing[2].why, /UC-03 has no source for this/);
  assert.deepEqual(
    r.uc04Intake.carried.map((c) => c.input),
    ["homeCountry"]
  );
});

test("the intake report travels with the handoff event, on the result and in the audit row", async () => {
  fresh();
  const r = await run({
    text: "I'd like to work remotely from Portugal for a month while on holiday.",
    externalRef: "9102",
  });
  assert.equal(r.decision, "route_to_uc04");
  // `dispatched: false` is an ASSERTION in the record, not something a reader
  // infers from the absence of a UC-04 row.
  assert.equal(r.uc04Intake.dispatched, false);
  assert.equal(r.uc04Intake.uc04RecordCreated, false);

  const details = audit.forUseCase("UC-03")[0].details;
  assert.equal(details.uc04Intake.dispatched, false);
  assert.deepEqual(details.uc04Intake.missing, r.uc04Intake.missing, "one reading, recorded and returned");
});

test("no decision other than route_to_uc04 carries an intake report", async () => {
  // The report describes a handoff, so it exists only where a handoff does.
  // A stray `uc04Intake` on an auto-resolved travel answer would imply a
  // work-authorization question that was never asked.
  fresh();
  const r = await run({
    text: "I'm travelling to Spain for a client meeting from 2026-09-14 to 2026-09-20.",
    externalRef: "9103",
  });
  assert.equal(r.decision, "auto_resolve");
  assert.equal("uc04Intake" in r, false);
  assert.equal(audit.forUseCase("UC-03")[0].details.uc04Intake, null);
});

test("the specialist's Zendesk note says the handoff was recorded and NOT dispatched", async () => {
  // The specialist picking this up is the only person who will ever act on it.
  // "Handoff: CROSS_BORDER_WORK_REQUESTED → destination PT" read as a message
  // sent, which is the same overstatement one audience over.
  fresh();
  const calls = [];
  const zendesk = { updateTicket: async () => {}, flagForReview: async (ref, payload) => calls.push(payload) };
  await run(
    { text: "I'd like to work remotely from Portugal for a month.", source: "zendesk", externalRef: "ZT-9104" },
    { zendesk }
  );
  const note = calls[0].note;
  assert.match(note, /NOT DISPATCHED/);
  assert.match(note, /No UC-04 case exists/i);
  assert.match(note, /Request Hub/);
  assert.match(note, /nationality/, "the note names what the request does not carry");
  assert.ok(!/ Handoff: /.test(note), "the bare 'Handoff:' phrasing is what read as a transfer");
});

test("the specialist queue note does not say the request was routed to somebody else", async () => {
  fresh();
  await run({ text: "I'd like to work remotely from Portugal for a month.", externalRef: "9105" });
  const entry = caseStore.reviewQueue[0];
  assert.ok(!/^Routed to UC-04/.test(entry.notes), "nobody else has it — this queue entry is all that exists");
  assert.match(entry.notes, /NOT dispatched/);
});

// ---------------------------------------------------------------------------
// THE DRIFT GUARD. UC-03 declares UC-04's required inputs rather than importing
// them, because UC-04's list lives inside a non-exported function and its
// `evaluate()` runs four other gates before completeness. A declared copy is
// free to go stale, so it is pinned to the real one by reading UC-04's source —
// the same idiom test/uc04Portal.test.js uses against the portal's own form.
// ---------------------------------------------------------------------------
test("UC04_REQUIRED_INPUTS matches every requirement UC-04's completeness gate actually enforces", async () => {
  const src = await readFile(new URL("../src/uc04/policyEngine.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function factorValidationIssues"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
  // Every slug the function can produce, however it produces it: the per-input
  // `issues.push("…")` calls AND the whole-object early `return ["factors_missing"]`.
  // Matching only the pushes would have missed a requirement expressed as a
  // return — which is precisely the drift this guard exists to catch.
  const slugs = [
    ...[...body.matchAll(/issues\.push\("([^"]+)"\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/return \["([^"]+)"\]/g)].map((m) => m[1]),
  ];
  assert.ok(slugs.length > 1, "factorValidationIssues() could not be read — the guard is not guarding");

  // `factors_missing` is the whole-object case, not a per-input requirement,
  // so it is named here rather than silently filtered: a NEW non-input slug
  // must trip this test rather than disappear into an exclusion rule.
  assert.deepEqual(
    [...new Set(slugs)].sort(),
    [...new Set([...UC04_REQUIRED_INPUTS.map((i) => i.uc04Issue), "factors_missing"])].sort(),
    "UC-04's completeness gate and UC-03's account of it have drifted"
  );
});

// ---------------------------------------------------------------------------
// THE SANCTIONS GATE WAS DEAD ON THE RULE-BASED PATH — and it FAILED CLOSED,
// which is exactly why every existing test passed over it.
// ---------------------------------------------------------------------------
// `SANCTIONED_OR_RESTRICTED` holds ten codes and `src/uc04/riskMatrix.js`
// imports the same Set, but not one of those ten appeared in the dictionary
// `classifyTravelInquiryRuleBased()` resolves a destination NAME with. So "I'm
// travelling to Iran" resolved to `null` and came back
// `escalate / destination_unknown`: the right decision, with a reason that is a
// statement about our dictionary wearing the clothes of a statement about the
// trip. A specialist who reads `destination_unknown` goes and looks the country
// up. A specialist who reads `sanctioned_region` stops. The reason string is
// the only thing that selects between those two behaviours.
//
// EVERY TEST IN THIS FILE PASSED WHILE THAT WAS TRUE, and none of them was
// wrong — a gate that cannot fire and a gate that is correctly refusing look
// identical from outside if you only ever assert on refusals. The sanctions
// tests further up this file each hand `evaluate()` a ready-made classification
// carrying `destinationCountry: "IR"`, so they prove the GATE works and say
// nothing about whether anything can reach it. The two tests below are the ones
// that would have caught this: the first asserts a specific reason must be
// PRODUCED from raw customer text, and the second asserts the resolution step
// covers the whole set rather than the one member a test happened to name.
// ---------------------------------------------------------------------------

test("POSITIVE: a request naming Iran in plain text decides escalate / sanctioned_region", async () => {
  fresh();
  const r = await run({
    text: "I need a travel support letter for a trip to Iran from 2026-09-01 to 2026-09-10.",
  });
  // The whole point: not merely "it refused", but that it refused FOR THE
  // SANCTIONS REASON, produced end to end from the sentence a requester typed —
  // no hand-supplied classification anywhere in this test.
  assert.equal(r.decision, "escalate");
  assert.equal(
    r.reason,
    "sanctioned_region",
    "Iran named in free text must reach the sanctions gate. `destination_unknown` here means the rule-based " +
      "classifier could not resolve the name, so the gate never ran — a true refusal with a false reason."
  );
  assert.ok(r.flags.includes("sanctioned_region"));
  // The classification the gates actually decided on — proving the code came
  // out of the sentence, not out of the test.
  assert.equal(r.classification.destinationCountry, "IR");
});

test("every member of SANCTIONED_OR_RESTRICTED is resolvable from free text, so the gate can fire for all ten", () => {
  // THIS IS THE CHECK THAT WOULD HAVE CAUGHT IT. It is driven by the SET, not
  // by a list of countries someone remembered to test, so a code added to
  // `SANCTIONED_OR_RESTRICTED` tomorrow with no name written for it fails here
  // instead of silently escalating as `destination_unknown` forever.
  const names = restrictedDestinationNames();
  const byCode = new Map();
  for (const [name, code] of Object.entries(names)) {
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(name);
  }

  for (const code of SANCTIONED_OR_RESTRICTED) {
    const written = byCode.get(code);
    assert.ok(written?.length, `no free-text name is written for restricted destination ${code}`);

    for (const name of written) {
      // Resolution first — the step that was missing.
      const c = classifyTravelInquiryRuleBased({
        text: `Conference in ${name} from 2026-09-01 to 2026-09-10.`,
      });
      assert.equal(c.destinationCountry, code, `"${name}" must resolve to ${code}`);

      // …and then the decision it produces, because resolving the name is only
      // useful if the gate downstream actually fires on it. `supportedCountries`
      // deliberately CONTAINS the code: the sanctions override must not depend
      // on the registry gate catching it afterwards.
      const r = evaluate({
        // `contract_type` is required to reach this gate at all: the engagement gate
        // added 2026-09-03 sits ahead of it and fails closed on an unreadable
        // engagement. An ordinary EOR employee is what this test is about.
        employment: { status: "active", contract_type: "full_time" },
        classification: { ...c },
        identity: { verified: true },
        supportedCountries: new Set(["ES", code]),
      });
      assert.equal(r.decision, "escalate", `"${name}" must escalate`);
      assert.equal(r.reason, "sanctioned_region", `"${name}" must escalate AS sanctioned, not as something else`);
    }
  }
});

test("the restricted half of the dictionary is DERIVED from the sanctions set, not a second list beside it", () => {
  // A hand-maintained copy would still pass the test above on the day it was
  // written and drift the day after. `restrictedDestinationNames()` takes the
  // codes to cover as an argument, so this drives it with a code the set does
  // not contain and asserts it refuses rather than quietly producing nothing.
  assert.throws(
    () => restrictedDestinationNames(new Set(["ZZ"])),
    /no free-text name is written for the restricted destination "ZZ"/,
    "a code with no name must throw, not vanish — vanishing is the original defect"
  );

  // And every derived entry really is in the live dictionary the classifier uses.
  for (const [name, code] of Object.entries(restrictedDestinationNames())) {
    assert.equal(KNOWN_COUNTRIES[name], code, `KNOWN_COUNTRIES lost the derived entry "${name}"`);
  }
});

test("widening the dictionary cannot turn any refusal into an approval", () => {
  // The safety argument for this change, asserted rather than reasoned about in
  // a comment: every code the dictionary newly resolves is a member of the
  // sanctions set, and that gate returns `escalate` unconditionally — there is
  // no input under which a restricted destination reaches auto_resolve or
  // human_review. Checked across the shapes that DO reach those decisions for
  // an ordinary country (short trip, no letter asked for; letter asked for).
  for (const code of SANCTIONED_OR_RESTRICTED) {
    for (const formalLetterRequested of [false, true]) {
      const r = evaluate({
        // `contract_type` is required to reach this gate at all: the engagement gate
        // added 2026-09-03 sits ahead of it and fails closed on an unreadable
        // engagement. An ordinary EOR employee is what this test is about.
        employment: { status: "active", contract_type: "full_time" },
        classification: {
          intent: "business_travel",
          destinationCountry: code,
          startDate: "2026-09-01",
          endDate: "2026-09-05",
          formalLetterRequested,
          confidence: 0.95,
        },
        identity: { verified: true },
        supportedCountries: new Set([code]),
      });
      assert.equal(r.decision, "escalate", `${code} must never reach an approving decision`);
      assert.equal(r.reason, "sanctioned_region");
    }
  }
});
