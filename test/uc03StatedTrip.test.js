// ---------------------------------------------------------------------------
// uc03StatedTrip.test.js — the traveller's own words, over the model's reading
// ---------------------------------------------------------------------------
// WHAT IS BEING TESTED, AND WHY THE STRONG TESTS ARE NOT THE HAPPY PATH
//
// `docs/TRAVEL-LETTER-INPUTS.md` §6.1/§6.2 propose three fields — destination,
// first day, last day — plus an optional addressee (§6.3), on the grounds that
// all three are ALREADY the employee's facts and are today inferred from their
// prose by a classifier, then printed on a consular document nobody reads before
// the consulate does. Moving them onto the employee's own keystroke is the whole
// change.
//
// A feature like that is easy to demonstrate and hard to constrain, so the tests
// that matter here are the constraints:
//
//   1. THE OVERRIDE PROPERTY — a stated value beats a differently-read one, and
//      the decision says WHICH of the two it used. A merge that silently agreed
//      with the classifier would pass a happy-path test and fail the only
//      question a specialist has.
//   2. THE NO-OP PROPERTY — with no fields, every existing outcome is
//      byte-identical. §6.1: "The field is an OVERRIDE, not a new precondition —
//      so no request that succeeds today can start failing."
//   3. §6.5's OWN FIRST CHECK — the archived employee still refuses at rung 2
//      with every box filled. "If filling the new fields changes that outcome,
//      the fields have become a gate instead of an override."
//   4. A MALFORMED VALUE IS ABSENT, NEVER COERCED, AND ALWAYS RECORDED — the
//      standing rule (`pickAlpha2()`, `readAnnualGrossSalary()`), applied to the
//      one input in this system that a member of the public types.
//   5. THE ADDRESSEE'S THREE PRECONDITIONS (§6.3), which are ALL, not any:
//      escaping, a capped plain "Attention:" line, and `letterScope.js` still
//      firing on the request TEXT so a compound ask cannot be smuggled past it.
//
// HERMETIC. `createInProcessFetch()` dispatches the real mock server's handler
// in process, so this file binds no socket and cannot collide with a
// concurrently running test file over TEST_BAND — the `EADDRINUSE` failure
// CLAUDE.md §6 records being misread as a logic failure more than once. No test
// here reaches OpenAI: every classifier seam is injected.
// ---------------------------------------------------------------------------

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createInProcessFetch } from "../src/remote/mockServer.js";
import { RemoteClient } from "../src/remote/restClient.js";
import { AuditLogger } from "../src/shared/audit.js";
import { CaseStore } from "../src/shared/caseStore.js";
import { handleTravelInquiry, acceptTravelLetterOffer } from "../src/uc03/workflow.js";
import { classifyTravelInquiry, classifyTravelInquiryRuleBased } from "../src/uc03/classifier.js";
import { renderTravelLetterHtml } from "../src/uc03/letter.js";
import { describeDecisionFacts } from "../src/uc03/policyEngine.js";
import {
  mergeStatedTrip,
  normaliseStatedAddressee,
  isIsoCalendarDate,
  PROVENANCE,
  STATED_ADDRESSEE_MAX_LENGTH,
} from "../src/uc03/statedTrip.js";

const EMPLOYEE = "emp_active_001";
const SESSION = { authenticatedEmploymentId: EMPLOYEE };
const TERMINATED = "emp_terminated_002";

/** Text that names SPAIN and September, so a stated DE/other date is a real override. */
const SPAIN_TEXT = "Client meeting in Spain from 2026-09-14 to 2026-09-20.";
/** The request that reaches the standard letter, per test/uc03AutoIssue.test.js. */
const LETTER_TEXT =
  "I need a travel letter for my visa application for a conference in Germany from 2026-09-20 to 2026-09-26.";

let remote;
let audit;
let caseStore;

beforeEach(() => {
  remote = new RemoteClient({ baseUrl: "http://mock.invalid", fetchImpl: createInProcessFetch() });
  audit = new AuditLogger();
  caseStore = new CaseStore();
});

const ask = (text, overrides = {}) =>
  handleTravelInquiry(
    { text, employmentId: EMPLOYEE, session: SESSION, ...overrides },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
  );

/** The last UC-03 decision row this run wrote. */
const lastDecision = () => audit.forUseCase("UC-03").at(-1);

// ---------------------------------------------------------------------------
// 1. THE OVERRIDE PROPERTY — the person wins, and the record says who spoke
// ---------------------------------------------------------------------------

test("a stated destination beats the one read from the prose, and provenance names each source", async () => {
  const r = await ask(SPAIN_TEXT, {
    externalRef: "stated-override-1",
    stated: { destinationCountry: "DE" },
  });

  // The prose says Spain. The traveller picked Germany. Germany decides.
  assert.equal(r.classification.destinationCountry, "DE", "the stated destination did not override the read one");
  assert.equal(r.decision, "auto_resolve");
  assert.match(r.informationalAnswer, /Germany/);
  assert.doesNotMatch(r.informationalAnswer, /Spain/);

  // AND IT IS ANSWERABLE, PER FIELD, WHICH OF THE TWO SAID IT. This is the
  // honest half of the feature: a specialist and an auditor must be able to tell
  // a fact the traveller asserted from one a model inferred out of prose.
  assert.equal(r.statedTrip.provenance.destinationCountry, PROVENANCE.STATED);
  assert.equal(r.statedTrip.provenance.startDate, PROVENANCE.CLASSIFIED, "the dates were NOT stated on this request");
  assert.equal(r.statedTrip.provenance.endDate, PROVENANCE.CLASSIFIED);
  assert.equal(r.statedTrip.provenance.addressee, PROVENANCE.ABSENT);
  assert.deepEqual(r.statedTrip.problems, []);

  // The same block is in the durable record, at the top of `details` where
  // src/auditview/ reads keys, AND on the classification, which is what
  // `cases.classification` persists and what an accepted letter offer carries
  // forward.
  const logged = lastDecision();
  assert.equal(logged.details.statedTrip.provenance.destinationCountry, PROVENANCE.STATED);
  assert.equal(logged.details.classification.statedTrip.provenance.destinationCountry, PROVENANCE.STATED);
  assert.equal(logged.details.destinationCountry, "DE");
});

test("stated dates beat read ones, and the day count is recomputed from the person's dates", async () => {
  // The prose says a six-day September trip. The traveller states a 40-day one,
  // which is over the 30-day cap — so the OUTCOME changes, which is the point of
  // an override and the reason provenance has to be recorded beside it.
  const r = await ask(SPAIN_TEXT, {
    externalRef: "stated-override-2",
    stated: { startDate: "2026-09-01", endDate: "2026-10-10" },
  });
  assert.equal(r.durationDays, 40);
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_over_cap");
  assert.equal(r.statedTrip.provenance.startDate, PROVENANCE.STATED);
  assert.equal(r.statedTrip.provenance.endDate, PROVENANCE.STATED);

  // The reviewer's facts label them as the traveller's own statement rather than
  // as something read out of their words — "as read" on a value they typed is a
  // false claim about provenance, and it sends the reader looking for a sentence
  // that does not exist.
  const labels = r.decisionFacts.facts.map((f) => f.label);
  assert.ok(labels.includes("Start date as stated"), `dates are still labelled as read: ${labels.join(" | ")}`);
  assert.ok(labels.includes("Destination as read"), "the destination WAS read from the prose and must still say so");
});

test("mergeStatedTrip leaves the classifier's reading of every field nobody stated", () => {
  const classified = { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-09-20", confidence: 0.9 };
  const { classification } = mergeStatedTrip(classified, { startDate: "2026-09-15" });
  assert.equal(classification.destinationCountry, "ES");
  assert.equal(classification.startDate, "2026-09-15");
  assert.equal(classification.endDate, "2026-09-20");
});

// ---------------------------------------------------------------------------
// 2. THE NO-OP PROPERTY — nothing stated, nothing different
// ---------------------------------------------------------------------------
// Not "a merge that changed nothing" but "no merge happened": the four ways of
// saying nothing must produce a result byte-identical to a request that predates
// the fields entirely. Ids are the only thing allowed to differ, because they
// are minted per run.

const IDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/g;
const shape = (value) => JSON.stringify(value, (k, v) => (typeof v === "string" ? v.replace(IDS, "<id>") : v));

test("absent, null, undefined and {} all decide EXACTLY what a request with no fields decides", async () => {
  const baseline = await ask(SPAIN_TEXT, { externalRef: "noop-baseline" });

  for (const [name, stated] of [
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["every field explicitly null", { destinationCountry: null, startDate: null, endDate: null, addressee: null }],
    ["every field an empty string", { destinationCountry: "", startDate: "", endDate: "", addressee: "" }],
  ]) {
    const r = await ask(SPAIN_TEXT, { externalRef: `noop-${name.replace(/\W+/g, "-")}`, stated });
    assert.equal(shape(r), shape(baseline), `"${name}" changed the result`);
    assert.equal("statedTrip" in r, false, `"${name}" added a statedTrip key to the result`);
    assert.equal("statedTrip" in r.classification, false, `"${name}" wrote onto the classification`);
  }

  // And the durable row is unchanged too — a pre-form audit row and a form row
  // with nothing filled in must not be distinguishable, or every consumer of
  // that table learns to branch on a field that means nothing.
  for (const entry of audit.forUseCase("UC-03")) {
    assert.equal("statedTrip" in entry.details, false);
  }
});

test("a classification object handed nothing to merge is returned by IDENTITY, not rebuilt", () => {
  const classified = { destinationCountry: "ES", startDate: null, endDate: null, confidence: 0.6 };
  assert.equal(mergeStatedTrip(classified, undefined).classification, classified);
  assert.equal(mergeStatedTrip(classified, {}).classification, classified);
  assert.equal(mergeStatedTrip(classified, { addressee: "   " }).classification, classified);
  assert.equal(mergeStatedTrip(classified, undefined).statedTrip, null);
});

// ---------------------------------------------------------------------------
// 3. §6.5's OWN FIRST CHECK — the fields must not become a gate
// ---------------------------------------------------------------------------

test("the archived employee still refuses at rung 2 with every field filled in", async () => {
  const r = await handleTravelInquiry(
    {
      text: SPAIN_TEXT,
      employmentId: TERMINATED,
      session: { authenticatedEmploymentId: TERMINATED },
      externalRef: "stated-archived",
      stated: {
        destinationCountry: "ES",
        startDate: "2026-09-14",
        endDate: "2026-10-02",
        addressee: "Consulate General of Spain, Amsterdam",
      },
    },
    { remote, audit, caseStore, classify: classifyTravelInquiryRuleBased }
  );

  // The rung that decides is about the EMPLOYMENT RECORD, and no form anywhere
  // speaks to it. A complete, valid, well-shaped set of fields changes nothing.
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "employee_not_active");
  assert.equal(r.decidedBy.position, 2);
  assert.equal(r.letterHtml, undefined, "an archived employee must never be issued a letter");
  // The fields are still RECORDED — refusing is not a reason to lose what the
  // person told us — they simply decided nothing.
  assert.equal(r.statedTrip.provenance.destinationCountry, PROVENANCE.STATED);
});

test("no request that succeeds without fields fails with well-formed fields agreeing with it", async () => {
  const without = await ask(LETTER_TEXT, { externalRef: "agree-without" });
  assert.equal(without.reason, "standard_letter_issued", "the baseline must be a SUCCESS or this proves nothing");

  const with_ = await ask(LETTER_TEXT, {
    externalRef: "agree-with",
    stated: { destinationCountry: "DE", startDate: "2026-09-20", endDate: "2026-09-26" },
  });
  assert.equal(with_.decision, without.decision);
  assert.equal(with_.reason, without.reason);
  assert.equal(with_.durationDays, without.durationDays);
});

// ---------------------------------------------------------------------------
// 4. A MALFORMED VALUE IS ABSENT, NEVER COERCED, AND ALWAYS RECORDED
// ---------------------------------------------------------------------------

test("an unusable stated value falls back to the read one and is recorded as a problem", async () => {
  const r = await ask(SPAIN_TEXT, {
    externalRef: "stated-malformed",
    // ESP is the alpha-3 form — the single most expensive defect class in this
    // repository (F-25) arriving from a new direction, a form. "09/14/2026"
    // parses under Date.parse() in US month-first order, so it is not rejected
    // anywhere downstream; it is simply a different day from the one meant.
    stated: { destinationCountry: "ESP", startDate: "09/14/2026" },
  });

  // Neither value reached a gate: the classifier's reading of the prose stands.
  assert.equal(r.classification.destinationCountry, "ES");
  assert.equal(r.classification.startDate, "2026-09-14");
  assert.equal(r.statedTrip.provenance.destinationCountry, PROVENANCE.CLASSIFIED);
  assert.equal(r.statedTrip.provenance.startDate, PROVENANCE.CLASSIFIED);

  // And neither was swallowed. A person who typed a value believes the decision
  // was made on it.
  assert.deepEqual(
    r.statedTrip.problems.map((p) => [p.field, p.code, p.received]),
    [
      ["destinationCountry", "destination_not_alpha2", "ESP"],
      ["startDate", "date_not_iso", "09/14/2026"],
    ]
  );
  assert.equal(lastDecision().details.statedTrip.problems.length, 2);
});

test("a stated date that is not a real calendar date is refused, not rolled forward", () => {
  assert.equal(isIsoCalendarDate("2026-02-31"), false, "February 31st rolls into March and must not be accepted");
  assert.equal(isIsoCalendarDate("2026-09-20"), true);
  assert.equal(isIsoCalendarDate("Sept 14 2026"), false);
  assert.equal(isIsoCalendarDate("2026-09-20T00:00:00Z"), false);
  const { classification, statedTrip } = mergeStatedTrip({ startDate: null }, { startDate: "2026-02-31" });
  assert.equal(classification.startDate, null, "an impossible date must not become March 3rd");
  assert.equal(statedTrip.problems[0].code, "date_not_iso");
});

test("a stated pair that runs backwards discards BOTH halves, not the later one", async () => {
  const r = await ask(SPAIN_TEXT, {
    externalRef: "stated-reversed",
    stated: { startDate: "2026-10-02", endDate: "2026-09-14" },
  });
  // Which of the two is the typo is not knowable from here, so neither is
  // trusted and the reading of the prose — which at least came from one sentence
  // — stands for both.
  assert.equal(r.classification.startDate, "2026-09-14");
  assert.equal(r.classification.endDate, "2026-09-20");
  assert.equal(r.statedTrip.problems[0].code, "stated_dates_reversed");
  assert.equal(r.decision, "auto_resolve", "a bad pair must not turn a good request into a refusal by itself");
});

test("one stated half plus one read half that cannot be a trip is refused honestly, not repaired", async () => {
  const r = await ask(SPAIN_TEXT, { externalRef: "stated-merged-reversed", stated: { startDate: "2026-10-01" } });
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_unknown");
  assert.equal(r.statedTrip.problems.at(-1).code, "merged_dates_reversed");
  // …and the specialist is told the dates disagree, rather than being left with
  // "unreadable dates" beside two perfectly readable ones.
  const notes = r.decisionFacts.facts.map((f) => `${f.label}: ${f.note ?? ""}`).join(" | ");
  assert.match(notes, /ends before it begins/);
});

test("an over-long addressee is refused rather than truncated, and the letter opens as it always did", async () => {
  const tooLong = "Consulate General of Spain ".repeat(10);
  assert.ok(tooLong.length > STATED_ADDRESSEE_MAX_LENGTH);
  const r = await ask(LETTER_TEXT, { externalRef: "stated-long-addressee", stated: { addressee: tooLong } });

  assert.equal(r.reason, "standard_letter_issued");
  assert.doesNotMatch(r.letterHtml, /Attention:/, "a truncated consulate name must never reach the document");
  assert.match(r.letterHtml, /To Whom It May Concern/);
  assert.equal(r.statedTrip.problems[0].code, "addressee_too_long");
  assert.equal(normaliseStatedAddressee(tooLong).addressee, null);
});

// ---------------------------------------------------------------------------
// 5. THE ADDRESSEE'S THREE PRECONDITIONS (§6.3) — ALL of them, not any
// ---------------------------------------------------------------------------

test("a stated addressee renders as a plain Attention: line and nothing else changes", async () => {
  const addressee = "Consulate General of Spain, Amsterdam";
  // THE SAME `externalRef` ON BOTH, because it is rendered on the letter as
  // "Our reference" — two different references would make the two documents
  // differ in a second place and the comparison below would prove nothing. The
  // exactly-once ledger is keyed separately via `claimRef`, which exists for
  // exactly this "a second decision about the same reference" case.
  const withField = await ask(LETTER_TEXT, { externalRef: "addressee-cmp", claimRef: "addressee-yes", stated: { addressee } });
  const without = await ask(LETTER_TEXT, { externalRef: "addressee-cmp", claimRef: "addressee-no" });

  assert.equal(withField.reason, "standard_letter_issued");
  assert.ok(
    withField.letterHtml.includes(`<p>Attention: ${addressee}</p>`),
    "the addressee is not rendered as a plain Attention: line"
  );
  // NO OTHER CHANGE TO THE BODY. Removing that one line reproduces the letter
  // that has always been rendered, byte for byte — the salutation, every row,
  // the closing and the disclaimer. `${today}` is the only moving part and both
  // letters were rendered in the same run.
  assert.equal(
    withField.letterHtml.replace(`<p>Attention: ${addressee}</p>\n  `, ""),
    without.letterHtml,
    "the addressee line is not the only difference the field makes to the document"
  );
});

test("an addressee stated on the question survives onto the letter accepted from the offer", async () => {
  // THE PATH THAT ACTUALLY ISSUES THE DOCUMENT, and the reason the provenance
  // block rides on the CLASSIFICATION rather than only beside it. An employee
  // asks a question with the boxes filled, gets an informational answer, and
  // accepts the letter offer — a SECOND decision, taken later, in a process that
  // holds only a case id. `carryClassificationForward()` copies the stored
  // reading; anything kept anywhere else would be gone by then, and the letter
  // would silently open "To Whom It May Concern" for somebody who named their
  // consulate.
  const addressee = "Consulate General of Spain, Amsterdam";
  const answered = await ask(SPAIN_TEXT, { externalRef: "offer-addressee", stated: { addressee } });
  assert.equal(answered.reason, "all_gates_passed");

  const accepted = await acceptTravelLetterOffer(
    { caseId: answered.caseId, session: SESSION },
    { remote, audit, caseStore }
  );
  assert.equal(accepted.code, "letter_issued");
  const letter = caseStore.documents.find((d) => d.type === "travel_support_letter");
  assert.ok(letter, "the accepted offer issued no letter at all");
  assert.ok(letter.content.includes(`<p>Attention: ${addressee}</p>`), "the stated addressee was lost on the offer path");
});

test("the addressee is HTML-escaped in the rendered bytes, not merely passed to a helper", () => {
  // Asserting the BYTES rather than that `escapeHtml()` was called: this is the
  // first untrusted free text the travel letter has ever carried, on a document
  // that issues with nobody in the path, and a test that checks the call site
  // passes just as happily when the call site moves.
  const html = renderTravelLetterHtml({
    employment: { full_name: "Alex Morgan", job_title: "Engineer", status: "active", contract_type: "employee", start_date: "2024-01-01" },
    legalEntity: { name: "Remote Germany EOR GmbH", country_name: "Germany" },
    destinationCountry: "DE",
    startDate: "2026-09-20",
    endDate: "2026-09-26",
    addressee: '<script>alert("x")</script> & "friends"',
  });
  assert.ok(!html.includes("<script>"), "raw markup from a typed field reached the document");
  assert.match(html, /Attention: &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;friends&quot;/);
});

test("a compound ask in the request text still escalates, even when the addressee field is filled", async () => {
  // §6.3's third precondition, and the reason it is not optional: the FIELD may
  // satisfy the addressee, but the scan of the request's own words must keep
  // running unchanged, so a second clause in the same sentence still reaches a
  // person. A field must not become a way to smuggle a compound ask past the
  // scope check.
  const r = await ask(
    "I need a travel letter for a conference in Germany from 2026-09-20 to 2026-09-26 — please address it to the " +
      "Spanish Consulate General in Amsterdam and confirm the company covers all costs.",
    { externalRef: "compound-ask", stated: { addressee: "Consulate General of Spain, Amsterdam" } }
  );

  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "letter_scope_exceeded");
  assert.equal(r.letterHtml, undefined, "no letter may be written for an ask the template cannot serve");
  const codes = r.letterScope.findings.map((f) => f.code);
  assert.ok(codes.includes("cost_responsibility_requested"), "the second clause must still be found");
  assert.ok(codes.includes("addressee_specified"), "the request-text marker must keep firing — do not weaken it");
});

// ---------------------------------------------------------------------------
// 6. THE MODEL'S OWN DATES, held to the same shape rule
// ---------------------------------------------------------------------------
// `docs/TRAVEL-LETTER-INPUTS.md` §3: the travel dates printed on a consular
// document are a model's string, verbatim, with no ISO check anywhere. The fix
// is not to fail the whole classification — see isValidClassification()'s header
// for why that would cost three LLM calls and a correct intent read.

test("an LLM date that is not ISO is dropped and recorded, and the rest of the reading survives", async () => {
  const result = await classifyTravelInquiry(
    { text: "Conference in Germany, mid-September." },
    {
      askJson: async () => ({
        intent: "business_travel",
        destinationCountry: "DE",
        startDate: "Sept 14 2026",
        endDate: "2026-09-26",
        formalLetterRequested: true,
        confidence: 0.95,
      }),
      isConfigured: () => true,
      backoff: async () => {},
    }
  );

  // The whole reading is NOT thrown away: the intent, the destination, the
  // letter flag and the confidence are all still the model's, and the source
  // still says so.
  assert.equal(result.source, "llm");
  assert.equal(result.intent, "business_travel");
  assert.equal(result.destinationCountry, "DE");
  assert.equal(result.formalLetterRequested, true);
  assert.equal(result.endDate, "2026-09-26");

  // The unusable date is absent, never repaired, and says what it received.
  assert.equal(result.startDate, null);
  assert.deepEqual(
    result.dateProblems.map((p) => [p.field, p.code, p.received]),
    [["startDate", "date_not_iso", "Sept 14 2026"]]
  );
});

test("a clean LLM classification carries no dateProblems key at all", async () => {
  const result = await classifyTravelInquiry(
    { text: "Conference in Germany." },
    {
      askJson: async () => ({
        intent: "business_travel",
        destinationCountry: "DE",
        startDate: "2026-09-20",
        endDate: "2026-09-26",
        formalLetterRequested: false,
        confidence: 0.95,
      }),
      isConfigured: () => true,
      backoff: async () => {},
    }
  );
  assert.equal("dateProblems" in result, false);
  assert.equal(result.startDate, "2026-09-20");
});

test("a US-ordered date from the model can no longer reach the document as a six-month error", async () => {
  // "09/14/2026" is what makes this worth a check rather than a comment:
  // `Date.parse()` accepts it, `computeDurationDays()` therefore computes a
  // length, the gates pass and the letter prints the string as it arrived — in
  // an order half the world reads the other way round. Driven through the REAL
  // classifier seam with the model's answer injected, because that is where the
  // quarantine lives; the trip then has no computable length and a person
  // decides it.
  const r = await handleTravelInquiry(
    { text: "I need a travel letter for a conference in Germany.", employmentId: EMPLOYEE, session: SESSION, externalRef: "llm-us-date" },
    {
      remote,
      audit,
      caseStore,
      classify: (args) =>
        classifyTravelInquiry(args, {
          askJson: async () => ({
            intent: "business_travel",
            destinationCountry: "DE",
            startDate: "09/14/2026",
            endDate: "09/20/2026",
            formalLetterRequested: true,
            letterSpecialRequests: [],
            confidence: 0.95,
          }),
          isConfigured: () => true,
          backoff: async () => {},
        }),
    }
  );
  assert.equal(r.classification.source, "llm", "the model's reading of the intent and destination is kept");
  assert.equal(r.classification.destinationCountry, "DE");
  assert.equal(r.classification.startDate, null, "the unusable date must not reach a gate or a document");
  assert.equal(r.decision, "escalate");
  assert.equal(r.reason, "duration_unknown");
  assert.equal(r.letterHtml, undefined);
});

// ---------------------------------------------------------------------------
// 7. THE REVIEWER'S VIEW, rebuilt from a stored case row
// ---------------------------------------------------------------------------

test("describeDecisionFacts reports provenance from the classification alone", () => {
  const { classification } = mergeStatedTrip(
    { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-09-20", confidence: 0.9, source: "llm" },
    { destinationCountry: "DE" }
  );
  const bundle = describeDecisionFacts({ reason: "duration_over_cap", classification });
  const destination = bundle.facts.find((f) => f.label.startsWith("Destination"));
  assert.equal(destination.label, "Destination as stated");
  assert.match(destination.note, /entered this themselves/);

  // A case decided before the fields existed has no provenance block, and its
  // rows must read exactly as they always have rather than claiming an absence.
  const old = describeDecisionFacts({
    reason: "duration_over_cap",
    classification: { destinationCountry: "ES", startDate: "2026-09-14", endDate: "2026-09-20" },
  });
  assert.equal(old.facts.find((f) => f.label.startsWith("Destination")).label, "Destination as read");
});
