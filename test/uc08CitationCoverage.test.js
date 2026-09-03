// ---------------------------------------------------------------------------
// uc08CitationCoverage.test.js
// ---------------------------------------------------------------------------
// WHAT THIS PINS, AND WHY IT IS ITS OWN FILE (2026-08-30)
//
// §3.95 moved UC-08's retrieval leg off three hand-written OECD Model
// paraphrases and onto a country-filtered lexical index over the 55 retrieved
// statutory passages in src/knowledge/. `describeCitationCoverage()` — the
// function whose entire job is to tell a specialist what the cited material IS
// and what it is NOT — did not move with it, and nothing failed, because every
// sentence it produces is prose and no test read the prose.
//
// The result, on the flagship demo pair, printed directly above the IRS's own
// substantial presence test and the text of the US–Portugal convention:
//
//   "The reference corpus is 3 passage(s) of GENERAL principle … Nothing in
//    the corpus matched this request at all. … they are not the governing
//    instrument for this request and must not be cited to the requester as if
//    they were."
//
// A STALE CAUTION IS NOT THE SAFE DIRECTION OF A STALE SENTENCE. It told the
// specialist to discount the instrument in force, and it spent the credibility
// of every other caution on the page to do it.
//
// So these tests read the sentence, not the shape. Each one is written so it
// FAILS against the pre-fix file — that is the only property that makes a
// prose assertion worth having.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { describeDossier } from "../src/uc08/dossierView.js";
// Read off the same module the retriever indexes, so the size assertions below
// cannot pass by agreeing with a number that has since changed.
import { corpusStats } from "../src/knowledge/statutoryRetrieval.js";

/** A dossier row as the store holds one, with citations of the given shape. */
function rowWith(citations, jurisdictions = ["US", "PT"]) {
  return {
    employmentId: "emp-1",
    inquiryType: "residency",
    jurisdictions,
    createdAt: "2026-08-30T10:00:00Z",
    presenceDays: null,
    dossier: { citations, narrative: "n/a", jurisdictions },
  };
}

/** What the statutory leg emits — the shape retrieveStatutoryCitations returns. */
function statutoryCitation(over = {}) {
  return {
    id: "D-35#0001",
    title: "D-35 · United States — the substantial presence test",
    summary: "You will be considered a United States resident for tax purposes if …",
    matchedOn: ['statutory corpus (lexical) — matched on "united", "states"'],
    documentId: "D-35",
    publisher: "Internal Revenue Service",
    sourceUrl: "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test",
    retrievedOn: "2026-08-19",
    countries: ["US"],
    authority: "instrument",
    instrument: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------

test("a statutory result is never described as nothing having matched", () => {
  const { citationCoverage } = describeDossier(rowWith([statutoryCitation()]));

  assert.equal(citationCoverage.retrievalMode, "statutory_lexical");
  assert.doesNotMatch(
    citationCoverage.scope,
    /Nothing in the corpus matched/,
    "the `else` arm of a ternary with no statutory limb — printed above three real instruments",
  );
  assert.match(
    citationCoverage.scope,
    /lexical match \(BM25\)/,
    "and it must say how they were matched, because that is what the reader weighs",
  );
});

test("the corpus is counted from the corpus these citations came from", () => {
  const { citationCoverage } = describeDossier(rowWith([statutoryCitation()]));

  const stats = corpusStats();

  assert.equal(citationCoverage.corpusSize, stats.byFeed["UC-08"]);
  assert.equal(citationCoverage.corpusDocuments, stats.documents);
  assert.ok(citationCoverage.corpusSize > 3, "TREATY_CORPUS.length was reported against a statutory result");
});

test("the 'must not be cited as the governing instrument' caution does not fall on an instrument", () => {
  const { citationCoverage } = describeDossier(rowWith([statutoryCitation()]));

  assert.equal(citationCoverage.instrumentsRetrieved, 1);
  assert.equal(citationCoverage.modelPassagesRetrieved, 0);
  assert.doesNotMatch(
    citationCoverage.scope,
    /must not be cited to the requester as if they were/,
    "this warning is about a PARAPHRASE; aimed at the publisher's own text it is simply false",
  );
  assert.match(
    citationCoverage.scope,
    /the publisher's own text, quoted, not a paraphrase/,
    "and the caution that DOES apply to a retrieved instrument is currency, not authority",
  );
  assert.match(citationCoverage.scope, /does not track later amendments/);
});

// NEGATIVE CONTROL. The caution above was correct for the population it was
// written about, and the statutory leg still falls back to those paraphrases
// when nothing statutory matches the named jurisdictions. If this test ever
// passes trivially, the fix above has thrown the warning away rather than
// aimed it.
test("a model-only result still carries the original warning, word for word", () => {
  const model = statutoryCitation({
    id: "D-00#0001",
    title: "OECD Model Article 4 — Resident (tie-breaker rules)",
    authority: "model",
    instrument: false,
    publisher: "OECD",
  });
  const { citationCoverage, openQuestions } = describeDossier(rowWith([model]));

  assert.equal(citationCoverage.instrumentsRetrieved, 0);
  assert.equal(citationCoverage.modelPassagesRetrieved, 1);
  assert.match(
    citationCoverage.scope,
    /must not be cited to the requester as if they were/,
    "the warning must survive for the material it was written about",
  );
  assert.doesNotMatch(citationCoverage.scope, /the publisher's own text, quoted/);

  // And it is raised as a ranked question, not left in a scope sentence a
  // reader skims — the same treatment `citations_keyword_matched` always had.
  const question = openQuestions.find((q) => q.code === "citations_model_only");
  assert.ok(question, "a model-only result must raise its own open question");
  assert.match(question.question, /Nothing STATUTORY matched/);
});

test("the bilateral clause stops claiming the instrument is absent from a list it is in", () => {
  // A US pair, so decisionSources holds the convention AND the statutory leg
  // returns the convention text — the case where the old trailing clause
  // ("it is not one of the passages below, which are general principle only")
  // contradicted the passage sitting underneath it.
  const conventionText = statutoryCitation({
    id: "D-27+D-28+D-29#0001",
    title: "D-27 / D-28 / D-29 · The three US income tax conventions",
    documentId: "D-27+D-28+D-29",
  });
  const { citationCoverage } = describeDossier(rowWith([conventionText]));

  assert.equal(citationCoverage.bilateralInstrumentHeld, true, "precondition: the convention is held for US/PT");
  assert.doesNotMatch(
    citationCoverage.scope,
    /which are general principle only/,
    "an instrument was retrieved, so the passages below are not general principle only",
  );
});

test("a dossier stored before the statutory corpus renders exactly as it did", () => {
  // The legacy shape: no authority, no publisher, keyword-stem matchedOn.
  const legacy = {
    id: "treaty-oecd-4",
    title: "OECD Model Article 4 — Resident (tie-breaker rules)",
    summary: "Where an individual is a resident of both Contracting States …",
    matchedOn: ["resident", "tie-break"],
  };
  const { citationCoverage } = describeDossier(rowWith([legacy]));

  assert.equal(citationCoverage.retrievalMode, "keyword_fallback");
  assert.equal(citationCoverage.corpusDocuments, null, "no statutory corpus was involved, so none is claimed");
  assert.match(citationCoverage.scope, /GENERAL principle/);
  assert.match(citationCoverage.scope, /must not be cited to the requester as if they were/);
  assert.match(citationCoverage.scope, /Retrieved by KEYWORD match/);
});
