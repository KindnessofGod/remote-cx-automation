// ---------------------------------------------------------------------------
// n8nUc08Parity.test.js — the n8n "Build Dossier" Code node and
// inquiryParser.js/presenceCalculator.js/treatyRetriever.js must agree
// ---------------------------------------------------------------------------
// Same reasoning as n8nParity.test.js / n8nUc06Parity.test.js: UC-08's
// deterministic pieces exist twice — once as the real Node functions, once as
// the "Build Dossier" Code node in workflows/uc-08 (n8n workflow, built but
// NOT activated). This executes the ACTUAL node body
// (workflows/nodes-uc08/buildDossier.js) in a sandbox and asserts it computes
// the same inquiryType/jurisdictions/presenceDays/citations as the real
// functions — the facts a human specialist will actually read.
//
// The narrative TEXT itself is not byte-compared: it is display prose, never
// read back into a decision (see buildDossier.js's own header), the same
// "not parity-critical" reasoning n8nUc06Parity.test.js applies to the
// drafted summary. What's asserted about it is only that it's present and
// non-empty.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { computePresenceDays } from "../src/uc08/presenceCalculator.js";
import { retrieveCitations } from "../src/uc08/treatyRetriever.js";
import { draftNarrative } from "../src/uc08/dossierBuilder.js";
import { describeJurisdictionCoverage } from "../src/uc08/jurisdictionKnowledge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOSSIER_PATH = join(__dirname, "..", "workflows", "nodes-uc08", "buildDossier.js");
const dossierSource = readFileSync(DOSSIER_PATH, "utf8");

/** Run the "Build Dossier" Code node body with n8n's globals mocked. */
function runBuildDossierNode({ ticket, llmResponse }) {
  const sandbox = {
    $: (nodeName) => {
      if (nodeName === "Normalize Inquiry") return { first: () => ({ json: ticket }) };
      throw new Error(`Unexpected $() lookup for "${nodeName}"`);
    },
    // $input.first().json — the immediate predecessor: Classify Inquiry (LLM)
    $input: { first: () => ({ json: llmResponse }) },
  };
  const wrapped = `(function () {\n${dossierSource}\n})()`;
  const result = vm.runInNewContext(wrapped, sandbox, { timeout: 5000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

/** No valid LLM response — every scenario here exercises the rule-based fallback,
 * same hermetic guarantee as every other parity test in this repo. */
const NO_LLM_RESPONSE = { choices: [] };

const ticketFor = (text, over = {}) => ({
  text,
  employmentId: "emp_active_001",
  externalRef: "8001",
  source: "webhook",
  presencePeriods: [],
  targetCountry: null,
  windowStart: null,
  windowEnd: null,
  ...over,
});

const SCENARIOS = [
  { name: "dual residency, two jurisdictions", text: "I think I may be a dual resident of both Germany and Spain for tax purposes." },
  { name: "withholding, UK assignment", text: "I've been asked to work from London for a few months. Do we need to withhold UK payroll tax?" },
  { name: "totalization, A1 certificate", text: "We need an A1 certificate of coverage for a short-term assignment to France." },
  { name: "unrelated request -> other, no citations", text: "Can I get a copy of my payslip?" },
  { name: "empty text -> other", text: "" },
  // The substring defect, in the copy that actually runs in production. `de`
  // was a dictionary key matched with String.includes, so these words alone
  // put GERMANY in a tax dossier's jurisdiction list. Parity would not have
  // caught it — both copies were wrong the same way and agreed perfectly.
  {
    name: "no jurisdiction named — words that merely contain 'de'",
    text: "I am a resident of two places under the treaty and considered taxable in both, provided the days add up.",
    expectJurisdictions: [],
  },
  {
    name: "jurisdictions in the order the text names them",
    text: "I moved from Portugal to Spain mid-year and I am not sure which country I am resident in.",
    expectJurisdictions: ["PT", "ES"],
  },
  // docs/DEMO-COUNTRIES.md §6.7: this exact request produced `jurisdictions: []`
  // beside a confident 273-day count, on BOTH copies — which parity alone could
  // never have caught, because both copies were missing the same two dictionary
  // entries and agreed perfectly. Hence the explicit expectation.
  {
    name: "CA→NL, the pair both dictionaries used to drop",
    text: "Our employee moved from Canada to the Netherlands and we need a certificate of coverage.",
    expectJurisdictions: ["CA", "NL"],
  },
];

for (const scenario of SCENARIOS) {
  test(`n8n Build Dossier matches inquiryParser/treatyRetriever — ${scenario.name}`, async () => {
    const ticket = ticketFor(scenario.text);
    const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
    const expectedParse = parseInquiryRuleBased({ text: scenario.text });

    assert.equal(fromN8n.inquiryType, expectedParse.inquiryType, "inquiryType differs");
    assert.deepEqual(fromN8n.jurisdictions.slice().sort(), expectedParse.jurisdictions.slice().sort(), "jurisdictions differ");

    // The real function runs the keyword fallback here (no embed function is
    // configured in the suite), which is exactly the path the Code node runs —
    // see treatyRetriever.js's header for why the node intentionally stays
    // keyword-based and the parity is still meaningful.
    const expectedCitations = await retrieveCitations([scenario.text, expectedParse.inquiryType].join(" "));
    assert.deepEqual(
      fromN8n.citations.map((c) => c.id).sort(),
      expectedCitations.map((c) => c.id).sort(),
      "citations differ"
    );

    // Parity proves the two copies agree; only this proves they are RIGHT.
    if (scenario.expectJurisdictions) {
      assert.deepEqual(fromN8n.jurisdictions, scenario.expectJurisdictions, "jurisdictions are not the countries the text names");
    }

    assert.equal(fromN8n.decision, "escalate", "UC-08 must always escalate");
    assert.equal(fromN8n.riskTier, "high");
    assert.ok(fromN8n.narrative.length > 0, "narrative must be non-empty display text");
    assert.match(fromN8n.dossier.customerFacingAcknowledgement, /not tax or legal advice/);
    assert.match(fromN8n.dossier.framing, /RESEARCH SUPPORT ONLY/);
  });
}

test("presence-day computation matches presenceCalculator.js exactly", () => {
  const presencePeriods = [
    { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
    { country: "DE", startDate: "2026-06-25", endDate: "2026-07-05" },
    { country: "ES", startDate: "2026-02-01", endDate: "2026-02-28" },
  ];
  const ticket = ticketFor("How many days have I been present in Germany this tax year?", {
    presencePeriods,
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
  const expected = computePresenceDays({ presencePeriods, country: "DE", windowStart: "2026-01-01", windowEnd: "2026-06-30" });

  assert.deepEqual(fromN8n.presenceDays, expected);
});

// ---------------------------------------------------------------------------
// "We did not count" must never be reported as "we counted zero."
// ---------------------------------------------------------------------------
// MERGE NOTE (2026-08-19). This branch and trunk found this defect
// independently. Trunk fixed it in src/uc08/presenceCalculator.js (its RULE 4)
// and added the F-22 parity cases below — but NOT in the n8n Code node body,
// which still answered `{days: 0, status: "COUNTED"}` for an empty
// `presencePeriods` while the real function answered NOT_EVALUATED. A
// differential run of the two over 28 shaped inputs found 6 divergences, all
// of them this one. Rule 4 is now ported into the node body too.
//
// The reason it survived trunk's own parity suite is worth keeping: every
// F-22 case below supplies records. None asks what happens when there are
// none, so the one input that diverged was the one input never tried. These
// tests are that input.
//
// Why it matters: with no records, a confident 0 is a positive claim — this
// person was not in the country — derived from no evidence, printed beside a
// citation of the 183-day rule, in a dossier whose entire framing is that it
// draws no conclusions. It fails in the direction that HIDES a breach.
// ---------------------------------------------------------------------------

test("NEGATIVE: no presence records -> NOT_EVALUATED with days null, never a confident zero", () => {
  const ticket = ticketFor("Am I tax resident in Germany this year?", {
    presencePeriods: [],
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
  const expected = computePresenceDays({ presencePeriods: [], country: "DE", windowStart: "2026-01-01", windowEnd: "2026-06-30" });

  assert.deepEqual(fromN8n.presenceDays, JSON.parse(JSON.stringify(expected)), "the node and the real calculator must agree that nothing was counted");
  assert.equal(fromN8n.presenceDays.status, "NOT_EVALUATED");
  assert.equal(fromN8n.presenceDays.days, null, "a day count nobody computed must not be reported as a number");
  assert.notEqual(fromN8n.presenceDays.days, 0, "0 reads as 'under the threshold' — the exact false reassurance this prevents");
  assert.ok(
    (fromN8n.presenceDays.problems ?? []).some((p) => /no presence records/.test(p)),
    "the reason must be named, not just the absence"
  );

  // And the prose a specialist actually reads must say so too: a dossier that
  // fixes the number but still narrates "0 distinct day(s)" has fixed nothing.
  assert.match(fromN8n.narrative, /could NOT be computed/);
  assert.doesNotMatch(fromN8n.narrative, /0 distinct day\(s\)/);
});

test("NEGATIVE: an absent presencePeriods field behaves the same as an empty one", () => {
  const ticket = ticketFor("Dual residency question", {
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  delete ticket.presencePeriods;
  const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
  assert.equal(fromN8n.presenceDays.status, "NOT_EVALUATED");
  assert.equal(fromN8n.presenceDays.days, null);
});

test("POSITIVE: records that exist but place the person elsewhere ARE a counted zero", () => {
  // The distinction the fix turns on, and the one it must not over-reach past.
  // The travel log WAS consulted and it answers the question — this zero is a
  // finding, not a gap, and it must still come back as the number 0 with
  // status COUNTED. Calling every zero "unknown" would be just as dishonest in
  // the other direction.
  const presencePeriods = [{ country: "ES", startDate: "2026-02-01", endDate: "2026-02-28" }];
  const ticket = ticketFor("How long was I in Germany?", {
    presencePeriods,
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
  const expected = computePresenceDays({ presencePeriods, country: "DE", windowStart: "2026-01-01", windowEnd: "2026-06-30" });

  assert.deepEqual(fromN8n.presenceDays, JSON.parse(JSON.stringify(expected)));
  assert.equal(fromN8n.presenceDays.status, "COUNTED");
  assert.equal(fromN8n.presenceDays.days, 0);
  assert.match(fromN8n.narrative, /0 distinct day\(s\)/);
});

test("POSITIVE: a real presence count MUST still reach the dossier as a number", () => {
  // The must-succeed counterpart. A calculator that answered NOT_EVALUATED to
  // everything would satisfy every honesty assertion above and be useless —
  // only demanding a real figure on real data tells the two apart.
  const presencePeriods = [
    { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
    { country: "DE", startDate: "2026-03-01", endDate: "2026-03-31" },
  ];
  const ticket = ticketFor("Presence days in Germany please", {
    presencePeriods,
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
  const expected = computePresenceDays({ presencePeriods, country: "DE", windowStart: "2026-01-01", windowEnd: "2026-06-30" });

  assert.deepEqual(fromN8n.presenceDays, JSON.parse(JSON.stringify(expected)));
  assert.equal(fromN8n.presenceDays.days, 41, "10 days in January + 31 in March");
  assert.equal(fromN8n.presenceDays.periodsCounted, 2);
  assert.equal(fromN8n.presenceDays.status, "COUNTED");
  assert.equal(fromN8n.dossier.presenceDays.days, 41, "the figure must survive into the dossier the specialist reads");
  assert.match(fromN8n.narrative, /41 distinct day\(s\)/);
  assert.equal(fromN8n.decision, "escalate", "and it is still 🔴: a number never buys an execution path");
});

// F-22 — the union/normalisation/NOT_EVALUATED rules must be identical in both
// copies, or the n8n graph would report a doubled 183-day figure the Node path
// no longer does. Each case is compared against the real function, not against
// a hard-coded number, so the two can never drift.
const F22_CASES = [
  {
    name: "overlapping periods are a union, not a sum",
    presencePeriods: [
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" },
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" },
    ],
    country: "DE",
    windowStart: "2028-01-01",
    windowEnd: "2028-12-31",
  },
  {
    name: "country codes are trimmed and case-insensitive",
    presencePeriods: [
      { country: "de", startDate: "2026-01-01", endDate: "2026-03-31" },
      { country: "DE ", startDate: "2026-04-01", endDate: "2026-06-30" },
    ],
    country: " DE ",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  },
  {
    name: "an unparseable date is NOT_EVALUATED in both copies",
    presencePeriods: [{ country: "DE", startDate: "not-a-date", endDate: "2026-06-30" }],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  },
];

for (const c of F22_CASES) {
  test(`presence-day parity (F-22) — ${c.name}`, () => {
    const ticket = ticketFor("How many days was I present?", {
      presencePeriods: c.presencePeriods,
      targetCountry: c.country,
      windowStart: c.windowStart,
      windowEnd: c.windowEnd,
    });
    const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });
    const expected = computePresenceDays({
      presencePeriods: c.presencePeriods,
      country: c.country,
      windowStart: c.windowStart,
      windowEnd: c.windowEnd,
    });
    assert.deepEqual(fromN8n.presenceDays, JSON.parse(JSON.stringify(expected)));
  });
}

test("a valid LLM response is used instead of the rule-based fallback", () => {
  const ticket = ticketFor("Some ambiguous inquiry text.");
  const llmResponse = { choices: [{ message: { content: JSON.stringify({ inquiryType: "totalization", jurisdictions: ["FR"] }) } }] };
  const fromN8n = runBuildDossierNode({ ticket, llmResponse });
  assert.equal(fromN8n.inquiryType, "totalization");
  assert.deepEqual(fromN8n.jurisdictions, ["FR"]);
});

test("an invalid LLM response shape falls back to rule-based, never crashes", () => {
  const ticket = ticketFor("I think I'm a dual resident of Germany and Spain.");
  const llmResponse = { choices: [{ message: { content: JSON.stringify({ inquiryType: "not_a_real_type" }) } }] };
  const fromN8n = runBuildDossierNode({ ticket, llmResponse });
  assert.equal(fromN8n.inquiryType, "dual_residency");
});

test("both n8n Code node bodies are syntactically valid", () => {
  const bodies = ["normalizeInquiry.js", "buildDossier.js"];
  for (const file of bodies) {
    const src = readFileSync(join(__dirname, "..", "workflows", "nodes-uc08", file), "utf8");
    assert.doesNotThrow(() => new Function(src), `${file} does not compile`);
  }
});

// ---------------------------------------------------------------------------
// The jurisdiction-knowledge statement, in the copy that actually runs live
// ---------------------------------------------------------------------------
// src/uc08/jurisdictionKnowledge.js makes a day count structurally incapable of
// travelling without a statement of what is known about the jurisdiction it
// counts days in. The n8n Code node carries its own port of that composer, and
// the narrative it produces is what a Tax Ops specialist reads as the ticket's
// internal note — so the port is not cosmetic, and a drift in its wording is a
// specialist reading a different dossier depending on which path ran.
//
// This compares the composed NARRATIVE STRING, not just the fields: it is the
// only assertion that fails if either copy's statement changes without the
// other. `draftNarrative` with `isConfigured: () => false` returns exactly the
// deterministic template, with no network call.
// ---------------------------------------------------------------------------

const KNOWLEDGE_SCENARIOS = [
  {
    name: "CA→NL with a real count — the reported case",
    text: "Our employee moved from Canada to the Netherlands and we need a certificate of coverage.",
    over: {
      presencePeriods: [{ country: "NL", startDate: "2026-01-01", endDate: "2026-09-30" }],
      targetCountry: "NL",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    },
  },
  {
    name: "a count in a country neither dictionary knows",
    text: "Please advise on the tax position for this assignment.",
    over: {
      presencePeriods: [{ country: "BR", startDate: "2026-01-01", endDate: "2026-08-31" }],
      targetCountry: "BR",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    },
  },
  { name: "no count requested at all", text: "I have a general question about withholding in Portugal.", over: {} },
];

for (const scenario of KNOWLEDGE_SCENARIOS) {
  test(`n8n Build Dossier states the same jurisdiction knowledge as the Node path — ${scenario.name}`, async () => {
    const ticket = ticketFor(scenario.text, scenario.over);
    const fromN8n = runBuildDossierNode({ ticket, llmResponse: NO_LLM_RESPONSE });

    const parsed = parseInquiryRuleBased({ text: scenario.text });
    const presenceDays =
      ticket.targetCountry && ticket.windowStart && ticket.windowEnd
        ? computePresenceDays({
            presencePeriods: ticket.presencePeriods,
            country: ticket.targetCountry,
            windowStart: ticket.windowStart,
            windowEnd: ticket.windowEnd,
          })
        : null;
    const citations = await retrieveCitations([scenario.text, parsed.inquiryType].join(" "));
    const expected = await draftNarrative(
      {
        inquiryType: parsed.inquiryType,
        jurisdictions: parsed.jurisdictions,
        presenceDays,
        presenceCountry: ticket.targetCountry,
        citations,
      },
      { isConfigured: () => false }
    );

    assert.equal(fromN8n.narrative, expected.narrative, "the two copies must compose the same narrative, word for word");
    assert.equal(
      fromN8n.dossier.jurisdictionCoverage.statement,
      describeJurisdictionCoverage({ jurisdictions: parsed.jurisdictions, presenceCountry: ticket.targetCountry, presenceDays }).statement
    );
    // Whatever else drifts, these two may not: the not-knowing and the
    // citizenship gap reach the specialist on the n8n path too.
    assert.match(fromN8n.narrative, /HOLDS NO RESIDENCE TEST/);
    assert.match(fromN8n.narrative, /Citizenship-based taxation is NOT ASSESSED/);
  });
}
