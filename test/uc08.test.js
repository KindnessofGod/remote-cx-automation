// ---------------------------------------------------------------------------
// uc08.test.js  —  The 5 UC-08 scenarios from docs/use-cases/UC-08.md §12,
// plus the structural proof this 🔴 use case has NO execution path.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AuditLogger } from "../src/shared/audit.js";
import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { computePresenceDays, PRESENCE_COUNTED, PRESENCE_NOT_EVALUATED } from "../src/uc08/presenceCalculator.js";
import { retrieveCitations, TreatyRetriever, cosineSimilarity, EMBEDDING_MATCH_THRESHOLD, TREATY_CORPUS } from "../src/uc08/treatyRetriever.js";
import { DossierStore } from "../src/uc08/dossierStore.js";
import { draftNarrative, buildDossier } from "../src/uc08/dossierBuilder.js";
import {
  describeJurisdictionCoverage,
  JURISDICTION_REGISTER,
  JURISDICTION_REGISTER_PROVENANCE,
  CITIZENSHIP_BASED_TAXATION,
} from "../src/uc08/jurisdictionKnowledge.js";
import { describeDossier } from "../src/uc08/dossierView.js";
import { countryLabel } from "../src/shared/countryNames.js";
import { describeRetrievalMode } from "../src/uc08/treatyRetriever.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// This suite's own scenarios are about the deterministic gates/dossier shape,
// not draft prose — inject the deterministic template directly so no test
// here ever makes a real, retried LLM call just because OPENAI_API_KEY
// happens to be set in its environment (a real hazard in this exact repo's
// own devcontainer — see #31/#32).
const fakeDraftNarrative = async ({ inquiryType }) => ({
  narrative: `Research summary for a ${inquiryType} inquiry.`,
  source: "template",
});
// Same reasoning as fakeDraftNarrative above — never a real, unretried LLM
// call for the faithfulness judge either (issue #27).
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

function run(overrides = {}) {
  return handleTaxInquiry(
    { text: "I need help — I think I'm a dual resident of both Germany and Spain.", ...overrides },
    { audit: new AuditLogger(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
}

// ---------------------------------------------------------------------------
// 1. Dual-residency inquiry -> disclaimer + dossier + escalate
// ---------------------------------------------------------------------------

test("1. dual-residency inquiry -> escalate, with a dossier carrying the mandatory disclaimer", async () => {
  const r = await run();
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.inquiryType, "dual_residency");
  assert.deepEqual(r.dossier.jurisdictions.sort(), ["DE", "ES"]);
  assert.match(r.dossier.customerFacingAcknowledgement, /not tax or legal advice/);
  assert.match(r.dossier.framing, /RESEARCH SUPPORT ONLY/);
});

// ---------------------------------------------------------------------------
// 2. Presence-day calc from mixed travel/time-off data
// ---------------------------------------------------------------------------

test("2. presence-day calc sums multiple periods in-country and within the window, ignoring the rest", async () => {
  const presencePeriods = [
    { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" }, // 10 days, fully inside window
    { country: "DE", startDate: "2026-06-25", endDate: "2026-07-05" }, // straddles window end -> only partial counted
    { country: "ES", startDate: "2026-02-01", endDate: "2026-02-28" }, // different country -> ignored
  ];
  const r = await run({
    text: "How many days have I been present in Germany this tax year?",
    presencePeriods,
    targetCountry: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-06-30",
  });
  // Jan 1-10 = 10 days; Jun 25-30 (clipped at window end) = 6 days. Total 16.
  assert.equal(r.presenceDays.days, 16);
  assert.equal(r.presenceDays.periodsCounted, 2);
});

test("presenceCalculator: pure unit coverage of the overlap arithmetic", () => {
  const periods = [{ country: "DE", startDate: "2026-01-01", endDate: "2026-01-05" }];
  assert.equal(computePresenceDays({ presencePeriods: periods, country: "DE", windowStart: "2026-01-01", windowEnd: "2026-12-31" }).days, 5);
  assert.equal(computePresenceDays({ presencePeriods: periods, country: "FR", windowStart: "2026-01-01", windowEnd: "2026-12-31" }).days, 0);
  assert.equal(computePresenceDays({ presencePeriods: periods, country: "DE", windowStart: "2027-01-01", windowEnd: "2027-12-31" }).days, 0);
});

// ---------------------------------------------------------------------------
// Real defect found and fixed this pass: presence periods were SUMMED, not
// merged into a union, so two overlapping periods reporting the same
// calendar day (a routine shape once presence data arrives from more than
// one upstream source — time-off records AND workation custom fields) roughly
// DOUBLED the true count, in the direction that INVENTS a 183-day treaty
// breach a tax specialist would then act on. See presenceCalculator.js's
// header for the full write-up.
// ---------------------------------------------------------------------------

test("presenceCalculator: two fully-overlapping periods covering one leap year are 366 days, never 732", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" },
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" }, // same days, twice
    ],
    country: "DE",
    windowStart: "2028-01-01",
    windowEnd: "2028-12-31",
  });
  assert.equal(r.days, 366, "2028 is a leap year — a day counted twice by two upstream sources is still one day");
  assert.equal(r.periodsCounted, 2, "both source records are still reported as counted");
  assert.ok(r.days <= 366, "a window can never contain more days than it has");
});

test("presenceCalculator: partially overlapping periods merge into a union, disjoint periods still add up", () => {
  const overlapping = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" }, // 10 days
      { country: "DE", startDate: "2026-01-06", endDate: "2026-01-15" }, // 5 NEW days (6 re-reported)
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(overlapping.days, 15, "Jan 1-15 inclusive, not 20 — the sum before this fix");

  const disjoint = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
      { country: "DE", startDate: "2026-03-01", endDate: "2026-03-05" },
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(disjoint.days, 15, "separate, non-overlapping stays still sum normally");
});

test("presenceCalculator: a fully-contained duplicate period adds nothing — the 183-day line cannot be crossed by duplication", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-06-30" }, // 181 days
      { country: "DE", startDate: "2026-02-01", endDate: "2026-02-28" }, // wholly inside the period above
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.days, 181);
  assert.ok(r.days <= 183, "a duplicated record must not manufacture a treaty breach that isn't real");
});

test("presenceCalculator: country matching is trimmed and case-insensitive — exact matching was the failure direction that HIDES a breach", () => {
  const periods = [
    { country: "de", startDate: "2026-01-01", endDate: "2026-03-31" },
    { country: "DE ", startDate: "2026-04-01", endDate: "2026-06-30" },
  ];
  for (const country of ["DE", "de", " DE "]) {
    const r = computePresenceDays({ presencePeriods: periods, country, windowStart: "2026-01-01", windowEnd: "2026-12-31" });
    assert.equal(r.days, 181, `"${country}" must still match the same two periods regardless of case/whitespace`);
  }
});

test("presenceCalculator: an unparseable date is an explicit null count, never a fabricated number clamped to the window", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "not-a-date", endDate: "2026-06-30" },
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.days, null, "a wrong number gets acted on; a missing one gets investigated");
  assert.ok(r.problems.some((p) => p.includes("not-a-date")), "the offending input is named, not swallowed");

  const badWindow = computePresenceDays({
    presencePeriods: [{ country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" }],
    country: "DE",
    windowStart: "whenever",
    windowEnd: "2026-12-31",
  });
  assert.equal(badWindow.days, null);
});

test("F-22 regression, end to end: an unparseable presence count is narrated as missing, never rendered as a number", async () => {
  const r = await handleTaxInquiry(
    {
      text: "Am I tax resident in Germany? I have been there most of the year.",
      targetCountry: "DE",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
      presencePeriods: [{ country: "DE", startDate: "garbage", endDate: "2026-06-30" }],
    },
    {
      audit: new AuditLogger(),
      classify: parseInquiryRuleBased,
      // The REAL template drafter (forced unconfigured, so no network) — this
      // test is about what the narrative actually SAYS, so it must not be faked out.
      draftNarrative: (args) => draftNarrative(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  assert.equal(r.presenceDays.days, null);
  assert.match(r.dossier.narrative, /could NOT be computed/);
  assert.doesNotMatch(r.dossier.narrative, /Computed physical presence/);
  assert.equal(r.decision, "escalate", "UC-08 has no other outcome, whatever the data says");
});

// ---------------------------------------------------------------------------
// 3. Treaty citations present + relevant
// ---------------------------------------------------------------------------

test("3. citations retrieved are relevant to what was actually asked, with a stated match reason", async () => {
  const r = await run(); // dual-residency text
  assert.ok(r.dossier.citations.some((c) => c.id === "oecd-model-art-4"));
  const match = r.dossier.citations.find((c) => c.id === "oecd-model-art-4");
  assert.ok(match.matchedOn.length > 0, "citation must say what it matched on, not just appear");
});

test("retrieveCitations() answers presence-day and totalization language from the RETRIEVED corpus, and returns nothing for unrelated text", async () => {
  // REWRITTEN 2026-08-30, and the direction matters. This test used to assert
  // that a 183-day question returned `oecd-model-art-15` and a certificate-of-
  // coverage question returned `totalization-general` — the two OECD Model
  // PARAPHRASES. Both assertions passed for months and both were pinning the
  // defect: a specialist was being handed the template a convention is drafted
  // from, in place of the convention, with a real publisher beside it.
  //
  // The corpus is now the 55 admitted passages from docs/knowledge/, so these
  // questions are answered by instruments. The assertions are therefore
  // STRUCTURAL rather than by id — pinning a specific passage id would make
  // this test a mirror of the ranking function, and it would have to be
  // rewritten every time a document is added.
  const presence = await retrieveCitations("Is this employee within the 183 day threshold for withholding?");
  assert.ok(presence.length > 0, "a 183-day question must retrieve something");
  assert.ok(
    presence.every((c) => c.id.startsWith("D-")),
    "a 183-day question must be answered from the retrieved corpus, never from a model paraphrase"
  );

  const totalization = await retrieveCitations("We need an A1 certificate of coverage for social security.");
  assert.ok(totalization.length > 0, "a certificate-of-coverage question must retrieve something");
  assert.ok(
    totalization.some((c) => c.instrument === true),
    "at least one citation must be an instrument in force, not an agency reading of one"
  );

  // The guards below are UNCHANGED and are the reason this test survives at all
  // rather than being replaced: they are the anti-regression half.

  // Same defect class as UC-07's: "a1" is a substring of any "A123"-shaped
  // identifier, so a payslip question carrying an employee reference was cited
  // social-security totalization guidance, "matched on: a1".
  const identifier = await retrieveCitations("My employee id is A123 and I want a payslip.");
  assert.deepEqual(identifier, [], "an identifier containing 'a1' is not a request about A1 certificates");

  const unrelated = await retrieveCitations("Can I get a copy of my payslip?");
  assert.deepEqual(unrelated, []);
});

// ---------------------------------------------------------------------------
// Real defect found and fixed this pass: keywords were matched with plain
// `lower.includes(kw)`, so "a1" (the A1 social-security certificate keyword)
// matched inside any "A123"-shaped identifier and "183" (the 183-day rule
// keyword) matched inside any longer number — and both matches were then
// PUBLISHED to the reviewer in `matchedOn` as the reason for the citation,
// making a false statement about why the document was cited. See
// treatyRetriever.js's header for the full write-up.
// ---------------------------------------------------------------------------

test("retrieveCitations(): an employee id containing 'a1' is not a request about A1 certificates", async () => {
  const identifier = await retrieveCitations("My employee id is A123 and I want a copy of my payslip.");
  assert.deepEqual(identifier, [], "the substring 'a1' inside 'A123' must never be cited as a totalization match");
});

test("retrieveCitations(): a longer ticket number containing '183' is not a request about the 183-day rule", async () => {
  const ticketRef = await retrieveCitations("Following up on ticket #18345, any update on my payslip?");
  assert.deepEqual(ticketRef, [], "the substring '183' inside the digit run '18345' must never be cited as the 183-day article");
});

test("retrieveCitations(): a genuine 183-day mention still matches, hyphenated or not", async () => {
  // The PROPERTY under test is unchanged — a real 183-day mention must retrieve,
  // whichever way it is punctuated, while "18345" must not (the test above).
  // Only the expected citation changed, from a model paraphrase to whatever the
  // retrieved corpus holds, so this is the same guard over a better corpus.
  const hyphenated = await retrieveCitations("Am I under the 183-day threshold for this assignment?");
  assert.ok(hyphenated.length > 0, "a hyphenated 183-day mention must retrieve");

  const plain = await retrieveCitations("Is this employee within the 183 day threshold for withholding?");
  assert.ok(plain.length > 0, "an unhyphenated 183 day mention must retrieve");

  // THE HYPHEN IS ISOLATED, and the first version of this assertion did not
  // isolate it: it compared the two sentences above, which differ in five words
  // as well as the hyphen, and then blamed the difference on punctuation. It
  // failed for a legitimate reason — "withholding" and "assignment" really do
  // retrieve different passages — and a test that names the wrong variable
  // would have been "fixed" by loosening it. Same sentence, one character apart.
  const withHyphen = await retrieveCitations("Am I under the 183-day threshold for this assignment?");
  const withoutHyphen = await retrieveCitations("Am I under the 183 day threshold for this assignment?");
  assert.deepEqual(
    withHyphen.map((c) => c.id),
    withoutHyphen.map((c) => c.id),
    "hyphenation alone must not change which passages are cited"
  );
});

// ---------------------------------------------------------------------------
// 3b. Embedding-similarity retrieval — the issue #29 upgrade. Every query is
// embedded with a FAKE embed function returning fixed vectors, and stored
// vectors are injected as corpus entries carrying embeddings (or as rows from
// a fake pgPool below). No real OpenAI embeddings call or Supabase query is
// ever made from `npm test`.
// ---------------------------------------------------------------------------

const fakeStoredVectors = [
  // `id` mirrors TREATY_CORPUS ids so a specialist reading the dossier still
  // sees the same passage titles; the vectors are what tests control.
  // cos([1,0,0], art-4)=1.0 · cos([1,0,0], art-15)=0.6 · cos([0,1,0], art-15)=0.8
  { id: "oecd-model-art-4", title: "OECD Model Tax Convention, Article 4", summary: "tie-breaker rules", embedding: [1, 0, 0] },
  { id: "oecd-model-art-15", title: "OECD Model Tax Convention, Article 15", summary: "183-day rule", embedding: [0.6, 0.8, 0] },
  { id: "totalization-general", title: "Social Security Totalization Agreements", summary: "coverage certificate", embedding: [0, 0, 1] },
];

test("retrieveCitations() with an embed function returns the expected passage for a known query, ranked by similarity", async () => {
  const retriever = new TreatyRetriever({
    corpus: fakeStoredVectors,
    threshold: EMBEDDING_MATCH_THRESHOLD,
    // Fixed query embedding: nearest to Article 4 (cos 1.0), Article 15 above
    // the threshold (cos 0.6), totalization below it (cos 0).
    embed: () => [1, 0, 0],
  });

  const citations = await retriever.retrieveCitations("resident of both countries");
  assert.deepEqual(citations.map((c) => c.id), ["oecd-model-art-4", "oecd-model-art-15"]);

  // The expected passage comes FIRST, and its match reason is the rank/threshold
  // stated plainly — never an invented precision score.
  assert.equal(citations[0].id, "oecd-model-art-4");
  assert.match(citations[0].matchedOn[0], /embedding similarity/);
  assert.match(citations[0].matchedOn[0], /ranked 1 of 2/);
  assert.match(citations[0].matchedOn[0], new RegExp(String(EMBEDDING_MATCH_THRESHOLD)));
  assert.ok(!citations[0].matchedOn[0].includes("%"), "never an invented percentage score in the match reason");
});

test("embedding retrieval drops passages below the threshold and never invents a match", async () => {
  const retriever = new TreatyRetriever({
    corpus: fakeStoredVectors,
    threshold: EMBEDDING_MATCH_THRESHOLD,
    embed: () => [0, 1, 0], // only the Article 15 vector is close (cos 0.8)
  });

  const citations = await retriever.retrieveCitations("183 day withholding");
  assert.deepEqual(citations.map((c) => c.id), ["oecd-model-art-15"]);

  // Same query, a threshold the Article 15 match cannot clear (cos 0.8 < 0.85):
  // retrieval returns nothing rather than inventing a weak match.
  const strict = new TreatyRetriever({
    corpus: fakeStoredVectors,
    threshold: 0.85,
    embed: () => [0, 1, 0],
  });
  const none = await strict.retrieveCitations("183 day withholding");
  assert.deepEqual(none, []);
});

test("embedding retrieval reads stored vectors from a pgPool query (fake pool), matching the documented table schema", async () => {
  const queries = [];
  const pg = {
    query: async (sql) => {
      queries.push(sql);
      // pgvector `vector` columns come back as strings like "[1,0,0]" —
      // the same shape coerceVector() in treatyRetriever.js handles.
      return { rows: fakeStoredVectors.map(({ id, title, summary, embedding }) => ({ id, title, summary, embedding: JSON.stringify(embedding) })) };
    },
  };
  const retriever = new TreatyRetriever({ pgPool: pg, embed: () => [1, 0, 0] });

  const citations = await retriever.retrieveCitations("dual resident");
  assert.deepEqual(citations.map((c) => c.id), ["oecd-model-art-4", "oecd-model-art-15"]);
  assert.ok(queries.some((sql) => sql.includes("uc08_treaty_citation_vectors")), "retriever reads from the pgvector table");
});

test("an embed function with no stored vectors degrades to the statutory corpus, never fails", async () => {
  // The degrade LADDER is what this pins, and it is unchanged: an embed function
  // with nothing to compare against must not throw and must not return nothing.
  // What it degrades TO changed on 2026-08-30 — from three OECD Model
  // paraphrases to the retrieved statutory corpus. `uc08_treaty_citation_vectors`
  // has held zero rows since the day it was provisioned, so this branch is not a
  // corner case: it is the only branch production has ever taken.
  const retriever = new TreatyRetriever({
    corpus: TREATY_CORPUS, // plain corpus, no entry carries an embedding
    embed: () => [1, 0, 0],
  });
  const citations = await retriever.retrieveCitations("We need an A1 certificate of coverage for social security.");
  assert.ok(citations.length > 0, "the fallback must never be silent");
  assert.ok(
    citations.every((c) => c.id.startsWith("D-")),
    "the fallback is now the retrieved corpus, not the model paraphrases"
  );
});

test("cosineSimilarity is pure and bounded: identical vectors score 1, orthogonal score 0", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([2, 0, 0], [1, 0, 0]), 1); // scale-invariant
  assert.equal(cosineSimilarity([0, 0, 0], [1, 0, 0]), 0); // zero vector is not a match
});

test("an injected TreatyRetriever flows end-to-end through handleTaxInquiry", async () => {
  const retriever = new TreatyRetriever({
    corpus: fakeStoredVectors,
    embed: () => [1, 0, 0],
  });
  const r = await handleTaxInquiry(
    { text: "I think I'm a dual resident of both Germany and Spain.", externalRef: "t-77" },
    { audit: new AuditLogger(), dossierStore: new DossierStore(), classify: parseInquiryRuleBased, treatyRetriever: retriever, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  assert.equal(r.decision, "escalate", "UC-08 still only ever escalates");
  assert.deepEqual(r.dossier.citations.map((c) => c.id), ["oecd-model-art-4", "oecd-model-art-15"]);
});

// ---------------------------------------------------------------------------
// 4. Confirm no customer-facing guidance is auto-sent — the headline test
// ---------------------------------------------------------------------------

test("4a. STRUCTURAL: workflow.js imports no write-capable client and calls no write-shaped method", () => {
  const fullSource = readFileSync(join(__dirname, "..", "src", "uc08", "workflow.js"), "utf8");
  // Strip comments first — the file's own header explains, in prose, exactly
  // why ZendeskClient/RemoteClient are absent, which would otherwise trip a
  // naive substring search on its own explanation.
  const code = fullSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(!/from\s+["'].*(zendesk|remote)\/restClient\.js["']/.test(code), "workflow.js must not import either REST client");
  const forbiddenCalls = ["ZendeskClient", "RemoteClient", "resolveWithLetter", "flagForReview", "createTicket", "patchEmploymentBasicInformation", "updateTicket"];
  for (const name of forbiddenCalls) {
    assert.ok(!code.includes(name), `workflow.js's actual code must never reference ${name} — UC-08 has no execution path`);
  }
});

test("4b. BEHAVIORAL: handleTaxInquiry needs no remote/zendesk dependency at all, and always decides escalate", async () => {
  const scenarios = [
    { text: "I'm a dual resident of Germany and Spain." },
    { text: "How many days can I work in Nigeria before withholding kicks in?" },
    { text: "Do we need an A1 certificate for this assignment?" },
    { text: "Completely unrelated request about my payslip." },
    { text: "" },
  ];
  for (const s of scenarios) {
    // Only `audit` is passed — proving no remote/zendesk write client is even
    // needed, let alone used, for this use case to run to completion.
    const r = await handleTaxInquiry(s, { audit: new AuditLogger(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge });
    assert.equal(r.decision, "escalate", `every UC-08 inquiry must escalate, got ${r.decision} for "${s.text}"`);
  }
});

test("4c. the audit trail records the escalation, never an execution", async () => {
  const audit = new AuditLogger();
  await handleTaxInquiry({ text: "Dual resident of Germany and Spain, need help." }, { audit, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge });
  const entries = audit.forUseCase("UC-08");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "escalate");
  assert.equal(entries[0].riskTier, "high");
  assert.equal(entries[0].details.disclaimerApplied, true);
});

// ---------------------------------------------------------------------------
// Dossier persistence — optional, read-only lookup, never a second copy of
// the "no execution path" guarantee's precondition (see dossierStore.js).
// ---------------------------------------------------------------------------

test("6. with no dossierStore, dossierId is null and nothing is persisted (the default, hermetic path)", async () => {
  const r = await run();
  assert.equal(r.dossierId, null);
});

test("6b. with a dossierStore, the dossier is persisted and findable by externalRef", async () => {
  const dossierStore = new DossierStore();
  const r = await handleTaxInquiry(
    { text: "Dual resident of Germany and Spain.", externalRef: "t-42" },
    { audit: new AuditLogger(), dossierStore, classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  assert.ok(r.dossierId);
  const found = await dossierStore.findByExternalRef("t-42");
  assert.equal(found.id, r.dossierId);
  assert.equal(found.inquiryType, "dual_residency");
});

// ---------------------------------------------------------------------------
// 5. Inquiry parsing (rule-based path, always hermetic)
// ---------------------------------------------------------------------------

test("5. parseInquiryRuleBased classifies inquiry type and extracts named jurisdictions", () => {
  const r1 = parseInquiryRuleBased({ text: "I think I'm a dual resident of Germany and Spain." });
  assert.equal(r1.inquiryType, "dual_residency");
  assert.deepEqual(r1.jurisdictions.sort(), ["DE", "ES"]);

  const r2 = parseInquiryRuleBased({ text: "Do we need to withhold payroll tax for this UK assignment?" });
  assert.equal(r2.inquiryType, "withholding");
  assert.deepEqual(r2.jurisdictions, ["GB"]);

  const r3 = parseInquiryRuleBased({ text: "Need an A1 certificate of coverage for social security." });
  assert.equal(r3.inquiryType, "totalization");
});

// ---------------------------------------------------------------------------
// Real defect found and fixed this pass: the dictionary carried a bare
// `de: "DE"` key matched with plain `String.includes`, so the ordinary
// English words "resident", "under", "considered" and "provided" — words
// that appear in nearly every cross-border tax question — each silently
// added GERMANY to the dossier's jurisdiction list. See inquiryParser.js's
// header for the full write-up.
// ---------------------------------------------------------------------------

test("5b. jurisdictions come from country names, never from substrings of ordinary English words", () => {
  const r = parseInquiryRuleBased({
    text: "I am a resident of two places under the treaty and considered taxable in both, provided the days add up.",
  });
  assert.deepEqual(r.jurisdictions, [], "'resident'/'under'/'considered'/'provided' each contain the letters 'de' — none of them names Germany");
});

test("5c. a real Germany mention still resolves correctly, in the order the text names the countries", () => {
  const r = parseInquiryRuleBased({
    text: "I moved from Portugal to Germany mid-year and I am not sure which country I am resident in.",
  });
  assert.deepEqual(r.jurisdictions, ["PT", "DE"], "text order, not dictionary order, and Germany is still found by its own name");
});

test("5d. word-boundary matching also stops false positives on the other short entries ('uk' inside 'duke')", () => {
  const r = parseInquiryRuleBased({ text: "The Duke of a fictional estate asked about payroll tax." });
  assert.deepEqual(r.jurisdictions, [], "'duke' contains the letters 'uk' but does not name the United Kingdom");
});

// ---------------------------------------------------------------------------
// draftNarrative()'s retry wiring (issue #32, §4 invariant 10) — same
// discipline as classifier.js's classifyRequest(). Fake askJson/isConfigured/
// backoff, never a real network call.
// ---------------------------------------------------------------------------

test("draftNarrative retries a failing LLM call before falling back to the template", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await draftNarrative(
    { inquiryType: "dual_residency", jurisdictions: ["DE", "ES"], presenceDays: null, citations: [] },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        throw new Error("connection refused");
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "template");
  assert.equal(attempts, 3, "3 attempts (§4 invariant 10) before the template fallback");
  const traces = audit.entries.filter((e) => e.call === "dossierBuilder.draftNarrative");
  assert.equal(traces.length, 3, "one trace entry per attempt, a retry is visible in the record");
  assert.ok(traces.every((t) => t.ok === false));
});

test("draftNarrative succeeds on a retry and tags source 'llm', with a 2-attempt trace", async () => {
  const audit = new AuditLogger();
  let attempts = 0;
  const r = await draftNarrative(
    { inquiryType: "dual_residency", jurisdictions: ["DE", "ES"], presenceDays: null, citations: [] },
    {
      isConfigured: () => true,
      askJson: async () => {
        attempts++;
        if (attempts < 2) throw new Error("transient");
        return { narrative: "The employee reports dual residency between Germany and Spain." };
      },
      audit,
      backoff: async () => {},
    }
  );
  assert.equal(r.source, "llm");
  assert.match(r.narrative, /Germany/);
  const traces = audit.entries.filter((e) => e.call === "dossierBuilder.draftNarrative");
  assert.equal(traces.length, 2, "a 2-attempt success produces 2 trace entries, not a hidden single one");
  assert.equal(traces[0].ok, false);
  assert.equal(traces[1].ok, true);
});

// ---------------------------------------------------------------------------
// Narrative-faithfulness judge (issue #27) — attached to the dossier for the
// tax specialist to see next to the narrative; never a second decision input.
// UC-08's only decision stays "escalate, always" regardless of any verdict,
// which is exactly why this is a safe attachment here — there is no gate for
// a verdict to influence even if a future bug tried. Injections follow the
// classifier.js DI shape: a fake `askJson` drives the real judgeNarrative().
// ---------------------------------------------------------------------------

import { judgeNarrative } from "../src/shared/narrativeJudge.js";

function judgedInquiry(fakeAsk, overrides = {}) {
  const judge = (args) => judgeNarrative(args, { askJson: fakeAsk, isConfigured: () => true });
  return handleTaxInquiry(
    { text: "I'm a dual resident of Germany and Spain.", ...overrides },
    { audit: new AuditLogger(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge }
  );
}

test("narrative judge: a 'faithful' verdict is attached to the dossier; UC-08 still only escalates", async () => {
  const fakeAsk = async () => ({ verdict: "faithful", reason: "no drift" });
  const r = await judgedInquiry(fakeAsk);
  assert.equal(r.decision, "escalate", "a faithful verdict changes nothing about the always-escalate decision");
  assert.equal(r.dossier.faithfulness.verdict, "faithful");
  assert.equal(r.dossier.faithfulness.reason, "no drift");
});

test("narrative judge: a 'not_faithful' verdict is surfaced but does not alter, route, or block anything", async () => {
  const fakeAsk = async () => ({
    verdict: "not_faithful",
    reason: "narrative introduces a jurisdiction not present in the structured inputs",
  });
  const r = await judgedInquiry(fakeAsk);
  // The 🔴 use case has exactly one decision — escalate — and the verdict is
  // purely informational. Both must remain true together.
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.faithfulness.verdict, "not_faithful");
  assert.match(r.dossier.faithfulness.reason, /not present/);
  assert.match(r.dossier.framing, /RESEARCH SUPPORT ONLY/, "dossier framing is unchanged — never converted into a conclusion");
});

test("narrative judge: unconfigured attaches an explicit 'not_evaluated' state, never blocks and never fabricates", async () => {
  // Explicitly forced unconfigured — never relies on ambient .env state (this
  // devcontainer happens to carry a real, broken OPENAI_API_KEY; see #31/#32).
  const judge = (args) => judgeNarrative(args, { isConfigured: () => false });
  const r = await handleTaxInquiry(
    { text: "I'm a dual resident of Germany and Spain." },
    { audit: new AuditLogger(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge }
  );
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.faithfulness.verdict, "not_evaluated");
  assert.equal(r.dossier.faithfulness.reason, null);
});

test("narrative judge: an invalid LLM response shape collapses to 'not_evaluated' rather than a fabricated verdict", async () => {
  const fakeAsk = async () => ({ verdict: "maybe", nonsense: true }); // unrecognized verdict
  const r = await judgedInquiry(fakeAsk);
  assert.equal(r.decision, "escalate");
  assert.equal(r.dossier.faithfulness.verdict, "not_evaluated", "judge failure is never treated as a 'not faithful' verdict");
});

// ---------------------------------------------------------------------------
// F-22 — the 183-day figure a tax specialist relies on must be a UNION
// ---------------------------------------------------------------------------
// Presence periods arrive from more than one upstream source (time-off records
// and workation custom fields), so the same calendar day routinely appears
// twice. Summing each period's length reported roughly double the truth — in
// the direction that INVENTS a 183-day breach — while case-sensitive country
// matching silently dropped periods, the direction that HIDES one.

test("F-22: two overlapping periods covering one year are 366 days, not 732", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" },
      { country: "DE", startDate: "2028-01-01", endDate: "2028-12-31" }, // the same days, twice
    ],
    country: "DE",
    windowStart: "2028-01-01",
    windowEnd: "2028-12-31",
  });
  assert.equal(r.status, PRESENCE_COUNTED);
  assert.equal(r.days, 366, "2028 is a leap year — a day counted twice is still one day");
  assert.equal(r.periodsCounted, 2, "both records are still reported as counted");
  assert.ok(r.days <= 366, "a window can never contain more days than it has");
});

test("F-22: partially overlapping periods merge, and disjoint ones still add up", () => {
  const overlapping = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" }, // 10 days
      { country: "DE", startDate: "2026-01-06", endDate: "2026-01-15" }, // 5 new days
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(overlapping.days, 15, "Jan 1–15 inclusive, not 20");

  const disjoint = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
      { country: "DE", startDate: "2026-03-01", endDate: "2026-03-05" },
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(disjoint.days, 15, "separate stays still sum");
});

test("F-22: a fully contained period adds nothing, and the 183-day line cannot be crossed by duplication", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "2026-01-01", endDate: "2026-06-30" }, // 181 days
      { country: "DE", startDate: "2026-02-01", endDate: "2026-02-28" }, // wholly inside
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.days, 181);
  assert.ok(r.days <= 183, "duplicated records must not manufacture a treaty breach");
});

test("F-22: country matching is trimmed and case-insensitive — the failure direction that HIDES a breach", () => {
  const periods = [
    { country: "de", startDate: "2026-01-01", endDate: "2026-03-31" },
    { country: "DE ", startDate: "2026-04-01", endDate: "2026-06-30" },
  ];
  for (const country of ["DE", "de", " DE "]) {
    const r = computePresenceDays({
      presencePeriods: periods,
      country,
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    });
    assert.equal(r.status, PRESENCE_COUNTED);
    assert.equal(r.days, 181, `"${country}" must match the same two periods`);
  }
});

test("F-22: an unparseable date is an explicit NOT_EVALUATED, never a fabricated day count", () => {
  const r = computePresenceDays({
    presencePeriods: [
      { country: "DE", startDate: "not-a-date", endDate: "2026-06-30" },
      { country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" },
    ],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.status, PRESENCE_NOT_EVALUATED);
  assert.equal(r.days, null, "a wrong number gets acted on; a missing one gets investigated");
  assert.ok(r.problems.some((p) => p.includes("not-a-date")), "the offending input is named");

  const badWindow = computePresenceDays({
    presencePeriods: [{ country: "DE", startDate: "2026-01-01", endDate: "2026-01-10" }],
    country: "DE",
    windowStart: "whenever",
    windowEnd: "2026-12-31",
  });
  assert.equal(badWindow.status, PRESENCE_NOT_EVALUATED);
  assert.equal(badWindow.days, null);

  const badCountry = computePresenceDays({
    presencePeriods: [{ country: null, startDate: "2026-01-01", endDate: "2026-01-10" }],
    country: "DE",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(badCountry.status, PRESENCE_NOT_EVALUATED, "an unreadable country is not 'a different country'");
});

test("F-22: a NOT_EVALUATED count is narrated as missing, never rendered as a number", async () => {
  const audit = new AuditLogger();
  const r = await handleTaxInquiry(
    {
      text: "Am I tax resident in Germany? I have been there most of the year.",
      targetCountry: "DE",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
      presencePeriods: [{ country: "DE", startDate: "garbage", endDate: "2026-06-30" }],
    },
    {
      audit,
      classify: parseInquiryRuleBased,
      // The REAL template drafter (forced unconfigured, so no network) — this
      // test is about what the narrative says, so it must not be faked out.
      draftNarrative: (args) => draftNarrative(args, { isConfigured: () => false }),
      judge: fakeJudge,
    }
  );
  assert.equal(r.presenceDays.status, PRESENCE_NOT_EVALUATED);
  assert.match(r.dossier.narrative, /could NOT be computed/);
  assert.doesNotMatch(r.dossier.narrative, /Computed physical presence/);
  assert.equal(r.decision, "escalate", "UC-08 has no other outcome, whatever the data says");
});

// ---------------------------------------------------------------------------
// F-38 — "no records" is not "zero days"
// ---------------------------------------------------------------------------
// Found by driving the portal, not by reading the file: asked to count presence
// in GB over 2026 with no travel records at all, it answered "0 distinct day(s)
// in GB between 2026-01-01 and 2026-12-31", printed beside a citation of the
// 183-day rule, in a dossier whose whole audience is a tax specialist deciding
// withholding. That is a positive claim about where somebody was, computed from
// nothing, and it fails in the direction that HIDES a breach — the same
// direction rule 3 in this file's header exists to close.
// ---------------------------------------------------------------------------

test("F-38. an empty presence-period list is NOT_EVALUATED, never a confident zero", () => {
  const r = computePresenceDays({
    presencePeriods: [],
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.status, "NOT_EVALUATED");
  assert.equal(r.days, null, "days must be null — a specialist chases a blank and acts on a number");
  assert.ok(
    r.problems.some((p) => /no presence records were supplied/.test(p)),
    `the reason must name the absence, got: ${JSON.stringify(r.problems)}`
  );
});

test("F-38. POSITIVE: records that exist and simply do not match are still a genuine zero", () => {
  // The other half, and the reason this is not a blanket refusal on
  // periodsCounted === 0. Five travel records, none of them GB, genuinely IS
  // zero days in GB — that is a finding, and blanking it would destroy real
  // information. Only an empty evidence base becomes NOT_EVALUATED.
  const wrongCountry = computePresenceDays({
    presencePeriods: [{ country: "FR", startDate: "2026-03-01", endDate: "2026-05-31" }],
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(wrongCountry.status, "COUNTED");
  assert.equal(wrongCountry.days, 0);
  assert.equal(wrongCountry.periodsCounted, 0);

  const outsideWindow = computePresenceDays({
    presencePeriods: [{ country: "GB", startDate: "2026-06-01", endDate: "2026-08-31" }],
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
  });
  assert.equal(outsideWindow.status, "COUNTED");
  assert.equal(outsideWindow.days, 0);
});

test("F-38. POSITIVE: a complete period set really does produce a real, correct count", () => {
  // The test that would have failed if the guard above had been written as a
  // blanket refusal. March + April + May 2026 inclusive is 31 + 30 + 31 = 92.
  const r = computePresenceDays({
    presencePeriods: [{ country: "GB", startDate: "2026-03-01", endDate: "2026-05-31" }],
    country: "GB",
    windowStart: "2026-01-01",
    windowEnd: "2026-12-31",
  });
  assert.equal(r.status, "COUNTED");
  assert.equal(r.days, 92);
  assert.equal(r.periodsCounted, 1);
  assert.deepEqual(r.problems, []);
});

test("F-38. end to end: an inquiry with a country and window but no records narrates the absence, not a zero", async () => {
  const r = await handleTaxInquiry(
    {
      text: "Do we need to withhold UK payroll tax for this assignment?",
      presencePeriods: [],
      targetCountry: "GB",
      windowStart: "2026-01-01",
      windowEnd: "2026-12-31",
    },
    { audit: new AuditLogger(), classify: parseInquiryRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  assert.equal(r.presenceDays.status, "NOT_EVALUATED");
  assert.equal(r.presenceDays.days, null);
  assert.equal(r.decision, "escalate", "and it is still the 🔴 escalation it always was");
});

// ---------------------------------------------------------------------------
// F-39 — the structural guarantee, asserted at the seam it actually depends on
// ---------------------------------------------------------------------------

test("F-39. STRUCTURAL: handleTaxInquiry's dependency object has no remote/zendesk parameter at all", () => {
  // Test 4a above greps for imports and for a fixed list of write-shaped method
  // names, which catches the precondition and the known callers. But the claim
  // this file's header actually makes is stronger and different: "no parameter
  // through which a write-capable client could ever be passed in". Nothing
  // asserted that, so adding `remote` to the deps object and calling a method
  // not on 4a's list would have passed the whole suite. The signature is the
  // guarantee, so the signature is what this reads.
  const source = readFileSync(join(__dirname, "..", "src", "uc08", "workflow.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const signature = /export async function handleTaxInquiry\s*\(([\s\S]*?)\)\s*\{/.exec(code);
  assert.ok(signature, "handleTaxInquiry's signature must be findable");
  const params = signature[1];

  for (const forbidden of ["remote", "zendesk", "restClient", "client"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(params),
      `handleTaxInquiry must expose no "${forbidden}" parameter — a 🔴 use case's no-execution-path guarantee is the ABSENCE of the seam, not a check inside it. Got: ${params.replace(/\s+/g, " ")}`
    );
  }
});

test("F-39. STRUCTURAL: the dossier store has exactly one write method and zero mutations", () => {
  // The store is the other half of "persistence does not hand this tier a second
  // execution path": there is no markReviewed/markExecuted/update to ever add a
  // bug to, because no such method exists. Asserted rather than described.
  const source = readFileSync(join(__dirname, "..", "src", "uc08", "dossierStore.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const methods = [...code.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z#][\w]*)\s*\(/gm)].map((m) => m[1]);

  const mutating = methods.filter((m) => /^(mark|update|set|delete|remove|approve|deny|execute|link|release|claim)/i.test(m));
  assert.deepEqual(mutating, [], `UC-08's store must expose no mutation method, found: ${mutating.join(", ")}`);
  assert.ok(methods.includes("createDossier"), "the one write method is createDossier");
  assert.equal(
    methods.filter((m) => /^create/i.test(m)).length,
    1,
    `exactly one create* method, found: ${methods.filter((m) => /^create/i.test(m)).join(", ")}`
  );
});

// ---------------------------------------------------------------------------
// THE DOSSIER AS THE PRODUCT — a day count with its subject and its records
// ---------------------------------------------------------------------------
// Reader: a Remote Tax Operations specialist. Decision: what guidance to author,
// and whether there is a residency / withholding / totalization exposure. UC-08
// has no execution path, so the dossier IS the deliverable — a figure it cannot
// substantiate has failed at the only thing this use case does.
//
// The gap these close: `presenceDays: {days: 92, periodsCounted: 1, status:
// "COUNTED"}` — 92 days in an unstated country over an unstated window, from
// records nobody could see. Every one of those facts was in hand when the count
// was taken (C-27 / pattern P7).
// ---------------------------------------------------------------------------

const PRESENCE_TICKET = {
  text: "How many days was I present in the UK this year?",
  targetCountry: "GB",
  windowStart: "2026-01-01",
  windowEnd: "2026-12-31",
  presencePeriods: [
    // Counted, and clipped at the window edge — it starts in the previous year.
    { country: "GB", startDate: "2025-12-20", endDate: "2026-01-10" },
    // Counted whole.
    { country: "GB", startDate: "2026-03-01", endDate: "2026-03-31" },
    // A different country: a finding, not an absence.
    { country: "FR", startDate: "2026-05-01", endDate: "2026-05-10" },
    // Right country, outside the window entirely.
    { country: "GB", startDate: "2027-02-01", endDate: "2027-02-10" },
  ],
};

test("POSITIVE: a counted dossier states WHERE and OVER WHAT WINDOW, not just a number", async () => {
  const result = await run(PRESENCE_TICKET);
  const evidence = result.dossier.presenceEvidence;

  assert.ok(evidence, "a dossier carrying a day count must carry what the count is a count of");
  assert.equal(evidence.country, "GB");
  assert.equal(evidence.windowStart, "2026-01-01");
  assert.equal(evidence.windowEnd, "2026-12-31");
  assert.equal(evidence.windowLengthDays, 365);
  assert.equal(evidence.recordsSupplied, 4);
  assert.equal(evidence.recordsCounted, 2);

  // And the count itself is unchanged — this adds basis, it does not re-derive.
  assert.equal(result.presenceDays.status, PRESENCE_COUNTED);
  assert.equal(result.presenceDays.days, 10 + 31, "10 days in January (clipped) + 31 in March");
});

test("every supplied record is accounted for: counted with its clipped range, or excluded with a reason", async () => {
  const result = await run(PRESENCE_TICKET);
  const periods = result.dossier.presenceEvidence.periods;
  assert.equal(periods.length, 4, "a record that vanishes silently is F-40 — the defect, not the fix");

  // The stay running in from the previous year contributes only its overlap,
  // and the dossier says which stretch of calendar that was.
  const clipped = periods[0];
  assert.equal(clipped.counted, true);
  assert.equal(clipped.startDate, "2025-12-20", "the record's own dates are preserved");
  assert.equal(clipped.countedStartDate, "2026-01-01", "…beside the range that actually counted");
  assert.equal(clipped.countedEndDate, "2026-01-10");
  assert.equal(clipped.countedDays, 10);

  // Every exclusion NAMES its reason. "Not counted" with no reason is exactly
  // what makes a specialist trust a total they cannot check.
  const french = periods[2];
  assert.equal(french.counted, false);
  assert.match(french.excludedBecause, /FR/);
  assert.match(french.excludedBecause, /GB/);

  const outOfWindow = periods[3];
  assert.equal(outOfWindow.counted, false);
  assert.match(outOfWindow.excludedBecause, /outside the evaluated window/);

  for (const period of periods) {
    assert.ok(
      period.counted || period.excludedBecause,
      "a record is either counted or explained — never both silent"
    );
  }
});

test("the specialist view states the day count WITH its subject and warns the parts do not sum", async () => {
  const result = await run(PRESENCE_TICKET);
  const view = describeDossier({ presenceDays: result.presenceDays, dossier: result.dossier });

  assert.equal(view.presence.status, "COUNTED");
  assert.equal(view.presence.days, 41);
  assert.match(view.presence.statement, /41 distinct day\(s\) in GB between 2026-01-01 and 2026-12-31/);
  // Per-record contributions do not add to the union total when two records
  // cover the same day, and a reader who totals them and disagrees will assume
  // the system is wrong. presenceCalculator.js's rule 1, made legible.
  assert.match(view.presence.statement, /do not add up/);
  assert.match(view.presence.statement, /2 of 4 supplied record/);
});

test("a NOT_EVALUATED count is never rendered as a number, and still names the country and window", async () => {
  const result = await run({ ...PRESENCE_TICKET, presencePeriods: [] });
  const view = describeDossier({ presenceDays: result.presenceDays, dossier: result.dossier });

  assert.equal(view.presence.days, null);
  assert.notEqual(view.presence.days, 0, "0 reads as 'well under 183' — the exact false reassurance F-38 closed");
  assert.match(view.presence.statement, /NOT COUNTED in GB between 2026-01-01 and 2026-12-31/);
  assert.match(view.presence.statement, /never as zero/);
  assert.equal(view.openQuestions[0].code, "presence_not_evaluated", "the missing count outranks everything else");

  // A basis WAS recorded and it was empty — which is a finding ("no travel
  // records were supplied") and a different fact from the basis not having been
  // recorded at all. The next test is the other half of that pair.
  assert.equal(view.presence.evidenceRecorded, true);
  assert.equal(view.presence.evidence.recordsSupplied, 0);
});

test("a dossier with no evidence block says the basis was not recorded, not that no records existed", async () => {
  // Rows written by the n8n execution path carry no `presenceEvidence` — that
  // graph is a separate copy this pass may not edit. "We did not record the
  // basis" and "no records were supplied" are different facts, and only one of
  // them is a finding about the employee's travel.
  const view = describeDossier({
    presenceDays: { days: 92, periodsCounted: 1, status: "COUNTED", problems: [] },
    dossier: { presenceDays: { days: 92 }, citations: [], jurisdictions: [] },
  });

  assert.equal(view.presence.evidenceRecorded, false);
  assert.match(view.presence.statement, /were not recorded on this dossier/);
  assert.ok(
    view.openQuestions.some((q) => q.code === "presence_basis_not_recorded"),
    "an unverifiable figure is an open question, not a silent pass"
  );
});

test("no count requested is distinct from a count that could not be computed", async () => {
  const result = await run({ text: "Do we need to withhold UK tax?" });
  assert.equal(result.presenceDays, null);
  assert.equal(result.dossier.presenceEvidence, null, "no evidence block for a count nobody asked for");

  const view = describeDossier({ presenceDays: null, dossier: result.dossier });
  assert.equal(view.presence.status, "NOT_REQUESTED");
  assert.ok(view.openQuestions.some((q) => q.code === "presence_not_requested"));
  assert.ok(
    !view.openQuestions.some((q) => q.code === "presence_not_evaluated"),
    "'nobody asked' must not be reported as 'we tried and failed'"
  );
});

// ---------------------------------------------------------------------------
// CITATION COVERAGE — the honest finding, made legible rather than fixed
// ---------------------------------------------------------------------------
// The corpus is three passages of general OECD/totalization principle, holds no
// bilateral instrument, and `uc08_treaty_citation_vectors` has never had a row —
// so every citation any production run has ever shown was keyword-matched. None
// of that reached the specialist. The corpus is deliberately NOT expanded here.
// ---------------------------------------------------------------------------

test("the dossier states the corpus's scope, its retrieval mode, and that no bilateral treaty was consulted", async () => {
  const result = await run(); // dual residency, Germany and Spain
  const view = describeDossier({
    jurisdictions: result.dossier.jurisdictions,
    dossier: result.dossier,
  });

  assert.ok(result.dossier.citations.length > 0, "fixture guard: this inquiry does retrieve citations");
  assert.equal(view.citationCoverage.retrievalMode, "keyword_fallback");
  assert.equal(view.citationCoverage.corpusSize, TREATY_CORPUS.length);
  assert.match(view.citationCoverage.scope, /GENERAL principle/);
  assert.match(view.citationCoverage.scope, /No bilateral treaty between DE\/ES was consulted/);
  assert.match(view.citationCoverage.scope, /KEYWORD match, not by meaning/);
  assert.match(view.citationCoverage.scope, /not the governing instrument/);
  assert.ok(view.openQuestions.some((q) => q.code === "citations_keyword_matched"));
});

test("describeRetrievalMode reads the citations' own stated basis, in both directions", () => {
  assert.equal(describeRetrievalMode([]), "none");
  assert.equal(describeRetrievalMode([{ matchedOn: ["dual resident"] }]), "keyword_fallback");
  assert.equal(
    describeRetrievalMode([{ matchedOn: ["embedding similarity — ranked 1 of 3 passage(s), above the 0.3 match threshold"] }]),
    "embedding_similarity"
  );
});

// ---------------------------------------------------------------------------
// THE 🔴 GUARANTEE, RE-VERIFIED AGAINST THE NEW FILES
// ---------------------------------------------------------------------------

test("F-39 (extended): the new read-side modules take no write-capable dependency either", () => {
  // The guarantee is the ABSENCE of the seam, and it has to hold for every file
  // in src/uc08/, not only the two that had it asserted. A view module that
  // accepted a `remote` client would be the execution path this tier forbids,
  // and nothing would have caught it.
  for (const file of ["dossierView.js", "presenceEvidence.js", "jurisdictionKnowledge.js"]) {
    const source = readFileSync(join(__dirname, "..", "src", "uc08", file), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const forbidden of ["RemoteClient", "ZendeskClient", "createIncentive", "updateTicket", "patch", "post("]) {
      assert.ok(
        !code.includes(forbidden),
        `src/uc08/${file} must never reference ${forbidden} — UC-08 has no execution path`
      );
    }
    assert.ok(!/\bimport\b[^\n]*\b(remote|zendesk)\b/i.test(code), `src/uc08/${file} must import no client`);
  }
});

test("the dossier view is a pure read: the same row twice yields the same answer and mutates nothing", () => {
  const row = Object.freeze({
    inquiryType: "dual_residency",
    jurisdictions: Object.freeze(["DE", "ES"]),
    presenceDays: Object.freeze({ days: 41, periodsCounted: 2, status: "COUNTED", problems: [] }),
    dossier: Object.freeze({ citations: Object.freeze([]), presenceEvidence: null }),
  });
  // A frozen row proves it structurally: any write would throw in strict mode
  // (ESM is always strict), which is stronger than comparing two outputs.
  const first = JSON.stringify(describeDossier(row));
  const second = JSON.stringify(describeDossier(row));
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// C-4x. A DAY COUNT MAY NEVER TRAVEL WITHOUT ITS JURISDICTION CONTEXT
// ---------------------------------------------------------------------------
// The defect these tests exist for was found by RUNNING a scenario, not by
// reading code: docs/DEMO-COUNTRIES.md §6.7, case UC08-CANL-1. A CA→NL
// totalization inquiry reached a Tax Ops specialist with a confident 273-day
// presence count and `jurisdictions: []`, because neither `netherlands` nor
// `canada` was in UC-08's nine-entry country dictionary.
//
// WHY NO EXISTING TEST CAUGHT IT, AND WHY THESE ARE SHAPED THE WAY THEY ARE.
// Nothing in that dossier was FALSE, so there was nothing to assert against.
// Every negative assertion in this file ("never invents a country", "never
// renders NOT_EVALUATED as a number") passed throughout. Only a POSITIVE
// assertion — this input MUST produce a named jurisdiction, or MUST say in
// words that it cannot — can tell a dossier that is being appropriately silent
// from one that is silently incomplete. That is the same lesson CLAUDE.md §5
// records from UC-03: refusing correctly and being unable to succeed look
// identical from outside.
// ---------------------------------------------------------------------------

const CANL_TICKET = {
  text:
    "Our employee moved from Canada to the Netherlands and we need to know which country's social security applies — do we need a certificate of coverage?",
  externalRef: "UC08-CANL-1",
  presencePeriods: [{ country: "NL", startDate: "2026-01-01", endDate: "2026-09-30" }],
  targetCountry: "NL",
  windowStart: "2026-01-01",
  windowEnd: "2026-12-31",
};

/** The real template narrative (LLM unconfigured), never a stub — the prose is
 *  part of what is being asserted here, unlike everywhere else in this file. */
const templateDraftNarrative = (args) => draftNarrative(args, { isConfigured: () => false });

function viewOf(result) {
  return describeDossier({
    inquiryType: result.dossier.inquiryType,
    jurisdictions: result.dossier.jurisdictions,
    presenceDays: result.presenceDays,
    dossier: result.dossier,
  });
}

test("POSITIVE (UC08-CANL-1): a CA→NL dossier NAMES its jurisdictions — the 273-day count no longer floats beside an empty list", async () => {
  const r = await handleTaxInquiry(CANL_TICKET, {
    audit: new AuditLogger(),
    classify: parseInquiryRuleBased,
    draftNarrative: templateDraftNarrative,
    judge: fakeJudge,
  });

  assert.equal(r.decision, "escalate");
  assert.equal(r.presenceDays.days, 273, "the arithmetic itself was never the defect");
  // The half that was missing.
  assert.deepEqual(r.dossier.jurisdictions.slice().sort(), ["CA", "NL"]);
  assert.equal(r.dossier.jurisdictionCoverage.presenceCountry, "NL");
  assert.deepEqual(
    r.dossier.jurisdictionCoverage.inPlay.map((j) => j.code).sort(),
    ["CA", "NL"],
    "both countries must be in play — one named by the text, one the subject of the count"
  );
  // And the count's own subject is stated as such, not merely present in a list.
  // The count's own subject is stated as such, by NAME — a code asks the reader
  // to decode `NL` before they can tell whether the figure is about the country
  // they think it is.
  assert.match(r.dossier.jurisdictionCoverage.statement, /the Netherlands \(named in the request, and the country the presence-day count was taken in\)/);
  assert.ok(
    !/\bin NL\b/.test(r.dossier.jurisdictionCoverage.statement),
    "the jurisdictions must be named, not printed as bare alpha-2 codes"
  );
});

test("POSITIVE: the CA→NL dossier states what it does NOT hold, rather than leaving the reader to supply the 183-day frame", async () => {
  const r = await handleTaxInquiry(CANL_TICKET, {
    audit: new AuditLogger(),
    classify: parseInquiryRuleBased,
    draftNarrative: templateDraftNarrative,
    judge: fakeJudge,
  });
  const coverage = r.dossier.jurisdictionCoverage;

  assert.equal(coverage.state, "no_knowledge_held");
  assert.match(coverage.statement, /HOLDS NO RESIDENCE TEST/);
  // The corpus's 183-day article is general, and the dossier now says so where
  // the number is, not only in the citation-scope block.
  assert.match(coverage.statement, /not a rule of any country named here/);
  for (const j of coverage.inPlay) {
    assert.equal(j.knowledge, "no_residence_test_held");
    assert.equal(JURISDICTION_REGISTER[j.code].residenceTest, null);
    assert.match(j.wouldBeSuppliedBy.reference, /DOWNLOAD-MANIFEST\.md/);
  }
  // It reaches the specialist's ranked list, at the top.
  const view = viewOf(r);
  const top = view.openQuestions[0];
  assert.equal(top.code, "no_residence_test_held_for_counted_jurisdiction");
  assert.equal(top.priority, 1);
});

test("THE DURABLE GUARD: a rendered day count ALWAYS carries either named jurisdictions or an explicit statement that it cannot", async () => {
  // The point of the matrix is the LAST two rows: a country the dictionary has
  // never heard of, and a request that names nothing at all. Those are the ~200
  // cases that adding `netherlands` and `canada` to the dictionary does not fix,
  // and they are the reason the guarantee lives in the dossier's shape rather
  // than in the dictionary's contents.
  const scenarios = [
    { name: "CA→NL (the reported case)", ticket: CANL_TICKET },
    {
      name: "PT named, counted in PT",
      ticket: {
        text: "I have been working from Portugal and need to understand withholding.",
        presencePeriods: [{ country: "PT", startDate: "2026-01-01", endDate: "2026-06-30" }],
        targetCountry: "PT",
        windowStart: "2026-01-01",
        windowEnd: "2026-12-31",
      },
    },
    {
      name: "a country no dictionary here knows, counted anyway",
      ticket: {
        text: "We have a payroll tax question about our employee's assignment.",
        presencePeriods: [{ country: "BR", startDate: "2026-01-01", endDate: "2026-08-31" }],
        targetCountry: "BR",
        windowStart: "2026-01-01",
        windowEnd: "2026-12-31",
      },
    },
    {
      name: "nothing named, nothing registered, count still taken",
      ticket: {
        text: "Please advise on the tax position for this assignment.",
        presencePeriods: [{ country: "ZZ", startDate: "2026-01-01", endDate: "2026-12-31" }],
        targetCountry: "ZZ",
        windowStart: "2026-01-01",
        windowEnd: "2026-12-31",
      },
    },
  ];

  for (const { name, ticket } of scenarios) {
    const r = await handleTaxInquiry(ticket, {
      audit: new AuditLogger(),
      classify: parseInquiryRuleBased,
      draftNarrative: templateDraftNarrative,
      judge: fakeJudge,
    });
    const view = viewOf(r);
    assert.equal(view.presence.status, "COUNTED", `${name}: this scenario is only meaningful with a real count`);
    assert.equal(typeof view.presence.days, "number", `${name}: a day count must be present`);

    const coverage = view.jurisdictionKnowledge;
    // NAMED, NOT CODED. The guarantee is unchanged — every jurisdiction in play
    // appears in the sentence the specialist reads — but the sentence now says
    // "the Netherlands" where it said "NL". A code with no name (ZZ) still
    // renders as itself, so the last scenario below is still meaningful.
    const namesAJurisdiction =
      coverage.inPlay.length > 0 &&
      coverage.inPlay.every((j) => coverage.statement.includes(j.name ?? countryLabel(j.code)));
    const saysItCannot = /NO JURISDICTION IS IDENTIFIED/.test(coverage.statement);

    // THE ASSERTION THE DEFECT WOULD HAVE FAILED. One of the two, never neither.
    assert.ok(
      namesAJurisdiction || saysItCannot,
      `${name}: a day count of ${view.presence.days} was rendered with neither named jurisdictions nor a statement that none could be identified — statement was: ${coverage.statement}`
    );
    // And it must travel WITH the number, not in a separate block a reader may
    // never scroll to.
    assert.ok(
      view.presence.statement.includes(coverage.statement),
      `${name}: the presence statement must carry the jurisdiction statement, not merely sit beside it`
    );
    // Whichever branch fired, the not-knowing is explicit in both.
    assert.match(coverage.statement, /HOLDS NO RESIDENCE TEST/);
    assert.equal(coverage.state === "held", false);
  }
});

test("an unregistered country is 'not_in_register' — never silently treated as a country nothing is known to apply to", () => {
  const c = describeJurisdictionCoverage({
    jurisdictions: ["DE"],
    presenceCountry: "BR",
    presenceDays: { days: 200, periodsCounted: 1, status: "COUNTED" },
  });
  const de = c.inPlay.find((j) => j.code === "DE");
  const br = c.inPlay.find((j) => j.code === "BR");
  assert.equal(de.knowledge, "not_in_register");
  assert.equal(br.knowledge, "not_in_register");
  assert.match(br.statement, /has never looked/);
  // The distinction that matters: a REGISTERED country's gap is recorded and
  // routed to a source; an unregistered one's is not, and the two must not read
  // the same. (Same shape as decisionFacts.js's `suppressed` vs `within_limit`.)
  const nl = describeJurisdictionCoverage({ jurisdictions: ["NL"] }).inPlay[0];
  assert.equal(nl.knowledge, "no_residence_test_held");
  assert.equal(nl.wouldBeSuppliedBy.manifestEntry, "D-31");
  assert.notEqual(nl.statement, br.statement);
});

test("the jurisdiction register invents no threshold, no window and no treaty article for any country", () => {
  // The hard rule from this pass's brief: no national threshold may be encoded
  // that cannot be cited, and nothing in this environment could be cited at all
  // (every statutory URL in the manifest is marked NOT VERIFIED). So the correct
  // content is the absence, stated — and this test is what keeps a well-meaning
  // later edit from filling it in from memory.
  const codes = Object.keys(JURISDICTION_REGISTER);
  assert.deepEqual(codes.sort(), ["CA", "NL", "PT", "US"], "the four demo countries");
  for (const code of codes) {
    const e = JURISDICTION_REGISTER[code];
    assert.equal(e.residenceTest, null, `${code}: no residence test may be encoded`);
    assert.equal(e.thresholdDays, null, `${code}: no threshold may be encoded`);
    assert.equal(e.windowDays, null, `${code}: no window may be encoded`);
    assert.equal(e.authority, null);
    assert.match(e.status, /^\[PROPOSED\]/, `${code}: every entry must be marked as unsourced`);
    assert.match(e.statement, /holds no residence test/);
    assert.match(e.wouldBeSuppliedBy.reference, /docs\/knowledge\/DOWNLOAD-MANIFEST\.md/);
    assert.match(e.wouldBeSuppliedBy.caveat, /NOT VERIFIED/);
  }
  // No digit that could be read as a day threshold anywhere in the register.
  const serialized = JSON.stringify(JURISDICTION_REGISTER);
  for (const invented of ["183", "365", "180", "90 days"]) {
    assert.ok(!serialized.includes(invented), `the register must not carry ${invented}`);
  }
  assert.match(JURISDICTION_REGISTER_PROVENANCE.status, /^\[PROPOSED\]/);
  assert.equal(JURISDICTION_REGISTER_PROVENANCE.authority, null);
  assert.equal(JURISDICTION_REGISTER_PROVENANCE.reviewedOn, null);
});

test("citizenship-based taxation is a STATED gap on every dossier, including ones that name no US at all", async () => {
  // docs/DEMO-COUNTRIES.md §6.8 recorded this as a silence. It is stated
  // unconditionally rather than where "US" is spotted, because there is no
  // citizenship field in this use case at all — conditioning on the country
  // dictionary would rebuild the silence for every case the dictionary misses,
  // which is precisely the defect one field over.
  const r = await handleTaxInquiry(CANL_TICKET, {
    audit: new AuditLogger(),
    classify: parseInquiryRuleBased,
    draftNarrative: templateDraftNarrative,
    judge: fakeJudge,
  });
  assert.ok(!r.dossier.jurisdictions.includes("US"), "this dossier names no US anywhere");

  assert.equal(r.dossier.jurisdictionCoverage.citizenship.assessed, false);
  assert.match(r.dossier.jurisdictionCoverage.citizenship.statement, /NOT ASSESSED/);
  assert.match(r.dossier.narrative, /Citizenship-based taxation is NOT ASSESSED/);

  const view = viewOf(r);
  const q = view.openQuestions.find((x) => x.code === "citizenship_basis_not_assessed");
  assert.ok(q, "the specialist's ranked list must carry it");
  assert.match(q.question, /no request field carries a/);

  // It states facts about THIS SYSTEM and cites no law it has not read.
  assert.equal(CITIZENSHIP_BASED_TAXATION.wouldBeSuppliedBy.manifestEntry, null);
  assert.match(CITIZENSHIP_BASED_TAXATION.status, /^\[PROPOSED\]/);
});

test("STRUCTURAL: the coverage block is DERIVED inside buildDossier, so no caller can produce a dossier without it", () => {
  // A parameter can be forgotten; a derivation cannot. buildDossier() is called
  // with no coverage at all here — and with a deliberately hostile attempt to
  // pass a fake one — and both produce the real, computed block.
  const bare = buildDossier({
    inquiryType: "withholding",
    jurisdictions: [],
    presenceDays: { days: 300, periodsCounted: 1, status: "COUNTED", problems: [] },
    citations: [],
    narrative: "n/a",
  });
  assert.ok(bare.jurisdictionCoverage, "a dossier with a day count always carries the coverage block");
  assert.match(bare.jurisdictionCoverage.statement, /NO JURISDICTION IS IDENTIFIED/);

  const spoofed = buildDossier({
    inquiryType: "withholding",
    jurisdictions: ["PT"],
    presenceDays: { days: 300, periodsCounted: 1, status: "COUNTED", problems: [] },
    citations: [],
    narrative: "n/a",
    presenceCountry: "PT",
    // Ignored — not a parameter this function reads.
    jurisdictionCoverage: { state: "held", statement: "Everything is known.", inPlay: [] },
  });
  assert.equal(spoofed.jurisdictionCoverage.state, "no_knowledge_held");
  assert.notEqual(spoofed.jurisdictionCoverage.statement, "Everything is known.");
});

test("the coverage block changes nothing about the decision: UC-08 still escalates, always, and still writes nowhere", async () => {
  for (const ticket of [CANL_TICKET, { text: "Nothing in particular." }]) {
    const r = await handleTaxInquiry(ticket, {
      audit: new AuditLogger(),
      classify: parseInquiryRuleBased,
      draftNarrative: templateDraftNarrative,
      judge: fakeJudge,
    });
    assert.equal(r.decision, "escalate");
  }
  const source = readFileSync(join(__dirname, "..", "src", "uc08", "jurisdictionKnowledge.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // TWO SHARED IMPORTS, BOTH PURE AND BOTH ABOUT COUNTRY CODES: the normaliser
  // that turns a code into its canonical form, and the display module that
  // turns one into a name for the sentence a specialist reads. Neither can
  // reach a client, a store or a gate — which is what this assertion is really
  // protecting, on a 🔴 use case with no execution path.
  const withoutAllowed = code
    .replace(/import \{ normalizeCountryCode \} from "\.\.\/shared\/countryCodes\.js";/, "")
    .replace(/import \{ countryLabel \} from "\.\.\/shared\/countryNames\.js";/, "");
  assert.ok(!/\bimport\b/.test(withoutAllowed),
    "the register may import nothing but the shared country-code normaliser and the shared country-name renderer");
});

test("a dossier row written by the n8n path (no coverage block, no evidence) still gets the statement at read time", () => {
  // The n8n port carries its own copy of this workflow and is NOT deployed by
  // this pass, so rows it writes have no `jurisdictionCoverage` and no
  // `presenceEvidence`. Deriving the view at read time is what gives those rows
  // — and every row written before today — the same statement.
  const view = describeDossier({
    inquiryType: "totalization",
    jurisdictions: [],
    presenceDays: { days: 273, periodsCounted: 1, status: "COUNTED", problems: [] },
    dossier: { citations: [], presenceEvidence: null },
  });
  assert.equal(view.presence.days, 273);
  assert.match(view.presence.statement, /NO JURISDICTION IS IDENTIFIED/);
  assert.match(view.presence.statement, /HOLDS NO RESIDENCE TEST/);
  assert.equal(view.openQuestions[0].code, "no_residence_test_held_for_counted_jurisdiction");
});
