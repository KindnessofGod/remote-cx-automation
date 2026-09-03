// ---------------------------------------------------------------------------
// statutoryRetrieval.test.js — the dossier cites the instrument that governs
// ---------------------------------------------------------------------------
// WHAT THIS EXISTS TO STOP COMING BACK
//
// Until 2026-08-30 UC-07 and UC-08 — the two use cases whose entire deliverable
// is a dossier for a specialist — searched nine hand-written sentences in their
// own source files and could not reach docs/knowledge/ at all. Measured on the
// four demo country pairs, the UC-08 retriever answered:
//
//   US→PT  a US–Portugal treaty question   -> NOTHING
//   NL→PT  a Netherlands–Portugal question -> the OECD MODEL, article 4
//   US→CA  a US–Canada question            -> the OECD MODEL, article 15
//   CA→NL  a totalization question         -> "Totalization — general principle"
//
// while D-24, D-27/28/29 and D-21/22/23 — the actual conventions and agreements,
// retrieved from the IRS, the Canadian treaty register and the EU — sat in the
// repository with their SHA-256s recorded.
//
// Every assertion below is written so it fails if that state returns.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { CITATION_PASSAGES } from "../src/knowledge/citationCorpus.js";
import { DOCUMENT_JURISDICTIONS } from "../src/knowledge/documentCountries.js";
import { LexicalIndex, countriesNamed, tokenize } from "../src/knowledge/lexicalIndex.js";
import { retrieveStatutoryCitations, corpusStats } from "../src/knowledge/statutoryRetrieval.js";
import { retrieveCitations, describeRetrievalMode } from "../src/uc08/treatyRetriever.js";
import { retrieveMobilityGuidance } from "../src/uc07/mobilityRetriever.js";

// ---------------------------------------------------------------------------
// 1. The corpus is real, and every passage is accounted for
// ---------------------------------------------------------------------------

test("the corpus is non-trivial and every passage carries its provenance", () => {
  const stats = corpusStats();
  // 57 -> 51 on 2026-08-31, and the drop is DELIBERATE: the chunker now refuses
  // a paragraph that names this repository's own source files, because such a
  // paragraph is a maintainer's note about the system rather than a passage of
  // the law, and UC-08 was serving one to a customer beside the Dutch residence
  // article. Six paragraphs went; no document did. The floor stays at 50 and the
  // headroom is now thin ON PURPOSE — a further fall means real coverage is
  // eroding, which is exactly when this should go red.
  assert.ok(stats.passages >= 50, `expected a real corpus, got ${stats.passages} passages`);
  assert.ok(stats.documents >= 12, `expected many documents, got ${stats.documents}`);
  for (const p of CITATION_PASSAGES) {
    assert.ok(p.id && p.documentId, `passage ${p.id} must name its document`);
    assert.ok(p.text && p.text.length > 0, `passage ${p.id} must carry text`);
    assert.ok(p.publisher, `passage ${p.id} must name a publisher — a citation with no publisher is an assertion`);
    assert.ok(p.retrievedOn, `passage ${p.id} must carry a retrieval date`);
    assert.ok(Array.isArray(p.countries) && p.countries.length > 0, `passage ${p.id} must name jurisdictions`);
  }
});

test("every document in the corpus has a hand-written jurisdiction entry", () => {
  // A NEW document with no entry must FAIL here rather than default to "no
  // countries" — an untagged document is silently unreachable by the country
  // filter, which looks identical to "never matched" from the outside.
  const missing = [...new Set(CITATION_PASSAGES.map((p) => p.documentId))].filter(
    (d) => !DOCUMENT_JURISDICTIONS[d]
  );
  assert.deepEqual(missing, [], `add these to src/knowledge/documentCountries.js: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------------------
// 2. The four demo pairs each reach their own governing instrument
// ---------------------------------------------------------------------------

const DEMO_PAIRS = [
  {
    label: "US → PT",
    text: "Our US employee has been living and working full time in Portugal for eight months. Which country taxes their employment income?",
    mustCite: "D-27+D-28+D-29",
    why: "the US–Portugal income tax convention (D-28), published by the IRS",
  },
  {
    label: "NL → PT",
    text: "A Dutch employee is spending 200 days in Portugal. Dual residency — which country taxes their employment income?",
    mustCite: "D-24",
    why: "the Netherlands–Portugal double taxation convention",
  },
  {
    label: "CA → NL",
    text: "A Canadian employee relocated to the Netherlands. Is there a totalization agreement so they keep Canadian social security coverage?",
    mustCite: "D-21+D-22+D-23",
    why: "the Canada–Netherlands Agreement on Social Security",
  },
  {
    label: "US → CA",
    text: "Our US employee is working from Canada for 190 days this year. What are the withholding obligations under the tax convention?",
    mustCite: "D-27+D-28+D-29",
    why: "the US–Canada income tax convention (D-29), published by the IRS",
  },
];

for (const pair of DEMO_PAIRS) {
  test(`${pair.label}: the dossier cites ${pair.why}`, async () => {
    const citations = await retrieveCitations(pair.text);
    assert.ok(citations.length > 0, `${pair.label} retrieved nothing — this is the defect this file exists to stop`);
    assert.ok(
      citations.some((c) => c.documentId === pair.mustCite),
      `${pair.label} must cite ${pair.mustCite}; got ${citations.map((c) => c.documentId).join(", ")}`
    );
  });
}

test("no demo pair is ever answered with a model convention", async () => {
  // The precise harm named in CLAUDE.md §7 item 17: a model offered where an
  // instrument belongs "reads exactly like an answer". A model may still be
  // returned when NOTHING matched — but never alongside, and never instead of,
  // an instrument that did.
  for (const pair of DEMO_PAIRS) {
    const citations = await retrieveCitations(pair.text);
    const models = citations.filter((c) => c.authority === "model" || /^oecd-model/.test(c.id));
    assert.deepEqual(
      models.map((c) => c.id),
      [],
      `${pair.label} was handed a model convention: ${models.map((c) => c.id).join(", ")}`
    );
  }
});

test("a bilateral instrument is not offered to a pair it does not govern", () => {
  // The Netherlands–Portugal convention is a real treaty with a real publisher.
  // Offered on a US–Portugal question it is authoritative-looking and wrong —
  // the same class of harm as a model, one step subtler, and the reason
  // `pairs` exists in documentCountries.js.
  const usPt = retrieveStatutoryCitations(
    "Our US employee has been living in Portugal for eight months. Which country taxes their employment income?",
    { feed: "UC-08", limit: 5 }
  );
  assert.ok(!usPt.some((c) => c.documentId === "D-24"), "the NL–PT convention must not answer a US–PT question");

  const caPt = retrieveStatutoryCitations(
    "A Canadian employee living in Portugal — which income tax convention governs their employment income?",
    { feed: "UC-08", limit: 5 }
  );
  assert.ok(!caPt.some((c) => c.documentId === "D-25"), "the CA–NL convention must not answer a CA–PT question");
});

// ---------------------------------------------------------------------------
// 3. The relevance floor — the negative control, with the measured queries
// ---------------------------------------------------------------------------
// These ten are the queries the floor was calibrated on, kept here verbatim so
// a corpus change that destroys the separation fails the suite. Without a floor,
// "Please reset my password" cited a tax convention: BM25 always ranks
// something, and "please" occurs in statutory prose.
// ---------------------------------------------------------------------------

const RELEVANT = [
  "Our US employee lives in Portugal, which country taxes their employment income?",
  "Canadian employee in the Netherlands, totalization agreement social security coverage?",
  "I have been working from Portugal for seven months, will I owe income tax there?",
  "Do I need a certificate of coverage for social security while on assignment?",
  "183 days in Portugal, am I tax resident?",
];

const IRRELEVANT = [
  "Can I get a copy of my payslip?",
  "My laptop is broken, can I get a new one?",
  "When is the next company holiday?",
  "How do I update my bank details?",
  "Please reset my password.",
];

for (const q of RELEVANT) {
  test(`relevance floor admits: ${q.slice(0, 44)}…`, async () => {
    const citations = await retrieveCitations(q);
    assert.ok(citations.length > 0, "a genuine inquiry must retrieve something");
  });
}

for (const q of IRRELEVANT) {
  test(`relevance floor refuses: ${q.slice(0, 44)}…`, async () => {
    const citations = await retrieveCitations(q);
    assert.deepEqual(
      citations.map((c) => c.id),
      [],
      "an unrelated request must cite nothing — a citation a specialist has to read to discover is irrelevant is worse than none"
    );
  });
}

// ---------------------------------------------------------------------------
// 4. Ranking properties
// ---------------------------------------------------------------------------

test("across the first passage of each document, an instrument outranks an administrative reading", () => {
  // THE GUARANTEE IS DELIBERATELY NARROW, and the first version of this test
  // asserted a wider one that the code does not make. diversifyByDocument()
  // pushes a SECOND passage from an already-seen document into a backfill pass,
  // so an instrument can legitimately land below a first-seen administrative
  // passage. The bounded claim is what lexicalIndex.js documents and what is
  // pinned here; the claim that actually protects a specialist — no model beside
  // an instrument — is pinned by "no demo pair is ever answered with a model
  // convention" above, and is unaffected by diversification.
  const index = new LexicalIndex(CITATION_PASSAGES);
  const hits = index.search("Canada residence sojourn 183 days deemed resident income tax", {
    feed: "UC-08",
    countries: ["CA"],
    limit: 6,
  });
  const rank = { instrument: 0, administrative: 1, model: 2 };
  const seenDocs = new Set();
  const firstPerDocument = [];
  for (const h of hits) {
    if (seenDocs.has(h.passage.documentId)) continue;
    seenDocs.add(h.passage.documentId);
    firstPerDocument.push(rank[h.passage.authority] ?? 3);
  }
  assert.ok(firstPerDocument.length >= 2, "this proves nothing on a single document");
  assert.deepEqual(
    [...firstPerDocument].sort((a, b) => a - b),
    firstPerDocument,
    `authority order violated across first-seen documents: ${firstPerDocument.join(",")}`
  );
});

test("results are spread across documents before a second passage from one is taken", () => {
  const index = new LexicalIndex(CITATION_PASSAGES);
  const hits = index.search(
    "US employee working from Canada 190 days withholding obligations under the tax convention",
    { feed: "UC-08", countries: ["US", "CA"], limit: 3 }
  );
  const docs = hits.map((h) => h.passage.documentId);
  assert.equal(new Set(docs).size, docs.length, `one document filled multiple slots: ${docs.join(", ")}`);
});

test("a citation says which terms matched, never a similarity figure", async () => {
  const citations = await retrieveCitations("Our US employee lives in Portugal, which country taxes their income?");
  for (const c of citations) {
    assert.ok(c.matchedOn.length > 0, "a citation must state why it was returned");
    const joined = c.matchedOn.join(" ");
    assert.match(joined, /^statutory corpus \(lexical\) — matched on /);
    assert.ok(
      !/\b0\.\d+\b/.test(joined),
      `matchedOn must not imply a precision nobody measured: ${joined}`
    );
  }
});

test("describeRetrievalMode reports the statutory index as its own mode", async () => {
  const hit = await retrieveCitations("Our US employee lives in Portugal, which country taxes their income?");
  assert.equal(describeRetrievalMode(hit), "statutory_lexical");
  const miss = await retrieveCitations("Please reset my password.");
  assert.equal(describeRetrievalMode(miss), "none");
});

// ---------------------------------------------------------------------------
// 5. The country reader
// ---------------------------------------------------------------------------

test("countriesNamed reads a country through ordinary punctuation", () => {
  // Both of these were live bugs in the first draft of lexicalIndex.js: a comma
  // after "Portugal" and a full stop after "Portugal." each made the matcher
  // report that the question named no destination. It failed SOFT — an empty
  // list searches everything — so nothing errored and the only symptom was a
  // worse ranking.
  assert.deepEqual(countriesNamed("200 days in Portugal, dual residency?").sort(), ["PT"]);
  assert.deepEqual(countriesNamed("Our employee moved to Portugal.").sort(), ["PT"]);
  assert.deepEqual(countriesNamed("From the United States to Portugal.").sort(), ["PT", "US"]);
  assert.deepEqual(countriesNamed("A U.S. citizen living in Portugal.").sort(), ["PT", "US"]);
});

test("a question naming no recognised country searches everything, rather than nothing", () => {
  // Property 2 of lexicalIndex.js. Filtering to nothing on a parsing miss would
  // turn a bad parse into an empty dossier — the exact state this work removes.
  assert.deepEqual(countriesNamed("I have been working abroad for seven months"), []);
  const hits = retrieveStatutoryCitations(
    "I have been working abroad for seven months, will I owe income tax in two places?",
    { feed: "UC-08" }
  );
  assert.ok(hits.length > 0, "an unparsed country must not silence the retriever");
});

test("a country pair the corpus holds NOTHING for is never answered with another pair's instrument", async () => {
  // THE WORST FAILURE THIS FILE HAS SEEN, and it was introduced BY the fix, not
  // by the code the fix replaced. The first version of countriesNamed() knew
  // only the four demo countries, so "Germany and Spain" named nothing it
  // recognised — which the filter reads as "search everything" — and a
  // Germany–Spain dual-residency question came back with Canada's deemed
  // residence rule, Portugal's CIRS art. 16 and the US substantial presence
  // test. Three real instruments, correctly quoted, about three countries
  // nobody asked about.
  //
  // That is WORSE than the OECD Model paraphrase it replaced: a model is at
  // least not wrong about a jurisdiction. The vocabulary must therefore cover
  // countries the corpus holds nothing for, so the filter can come back empty.
  const deEs = await retrieveCitations(
    "I've been splitting my time between Germany and Spain this year and I think I may be a dual resident of both countries for tax purposes."
  );
  const offBase = deEs.filter((c) =>
    ["D-24", "D-25", "D-26", "D-27+D-28+D-29", "D-31", "D-32", "D-33", "D-34", "D-35", "D-21+D-22+D-23"].includes(
      c.documentId
    )
  );
  assert.deepEqual(
    offBase.map((c) => c.id),
    [],
    `a Germany–Spain question was answered with another pair's instrument: ${offBase.map((c) => c.documentId).join(", ")}`
  );
  // What it MAY return is a multilateral instrument that genuinely reaches both
  // — DE and ES are EU member states, so Regulation 883/2004 and its
  // implementing regulation really do govern their coordination.
  for (const c of deEs) {
    assert.ok(
      (c.countries ?? []).includes("DE") && (c.countries ?? []).includes("ES"),
      `${c.documentId} does not serve both countries named`
    );
  }
});

test("countriesNamed recognises countries the corpus holds nothing about", () => {
  // Recognising a country and holding a document about it are different things,
  // and only the first belongs in the vocabulary — it is what lets the filter
  // return nothing rather than everything.
  assert.deepEqual(countriesNamed("Germany and Spain").sort(), ["DE", "ES"]);
  assert.deepEqual(countriesNamed("Moving from the United Kingdom to Ireland").sort(), ["GB", "IE"]);
});

test("a lower-case 'us' is a pronoun, not the United States", () => {
  // The hand-written vocabulary carried `us: "US"`, so this sentence named a
  // country. `it`, `in`, `no`, `is`, `at`, `be` and `or` are all words and all
  // country codes; the case is the signal.
  assert.deepEqual(countriesNamed("Please tell us about the policy"), []);
  assert.deepEqual(countriesNamed("It is in no way at issue or so"), []);
  assert.deepEqual(countriesNamed("Our US employee"), ["US"]);
});

test("tokenize keeps digits — '183' is a real query term", () => {
  assert.ok(tokenize("183 days").includes("183"));
});

// ---------------------------------------------------------------------------
// 6. UC-07 gains the statutory leg WITHOUT losing its process guidance
// ---------------------------------------------------------------------------

test("UC-07 returns Remote's process guidance first, then the statutory instrument", async () => {
  const hits = await retrieveMobilityGuidance(
    "A US employee is permanently relocating to Portugal. Immigration status, payroll transition and social security coverage?"
  );
  const ids = hits.map((h) => h.id);
  assert.ok(
    ids.some((id) => id.startsWith("mobility-")),
    "Remote's own process knowledge must survive — no statute states Minimum Onboarding Time"
  );
  assert.ok(
    ids.some((id) => id.startsWith("D-")),
    "a permanent relocation must also reach the retrieved social-security instruments"
  );
  assert.ok(
    ids.findIndex((id) => id.startsWith("mobility-")) < ids.findIndex((id) => id.startsWith("D-")),
    "the operational answer comes first; the instrument is context for the second question"
  );
});

test("UC-07 stays silent on an unrelated request", async () => {
  assert.deepEqual(await retrieveMobilityGuidance("Please reset my password."), []);
});

// ---------------------------------------------------------------------------
// A BUNDLED BILATERAL DOCUMENT MUST NOT ANSWER FOR A PAIR IT DOES NOT GOVERN
// ---------------------------------------------------------------------------
// Found 2026-08-30 by rendering the ZAF sidebar for the flagship demo pair.
// D-27+D-28+D-29 is three separate conventions in one file, and jurisdictions
// were mapped per DOCUMENT — so every one of its passages was eligible on any
// of US/NL, US/PT and US/CA. Two failures followed from that, and the second is
// the one no scoring change could have fixed:
//
//   1. the section holding all three quotes was split by size, so a US/PT
//      dossier displayed the US–NETHERLANDS article and, in the next chunk, an
//      unattributed "> …" where the US–Portugal label had fallen on the chunk
//      boundary; and
//   2. the operative clause of a treaty never names its parties ("remuneration
//      derived by a resident of one of the States…"), so no amount of lexical
//      scoring can tell the three apart. The jurisdiction has to come from the
//      structure, not from the words.
//
// Each convention is now its own `###` in the source document, and the
// generator narrows a passage to the single pair its heading names.
// ---------------------------------------------------------------------------

test("each US convention article answers only for its own pair", () => {
  const byPair = (a, b) =>
    retrieveStatutoryCitations("employment income 183 days present in the other State treaty article", {
      feed: "UC-08",
      countries: [a, b],
      limit: 5,
    }).map((c) => c.title);

  const us_pt = byPair("US", "PT");
  assert.ok(
    us_pt.some((t) => /US–Portugal, Article 16\(2\)/.test(t)),
    "a US/PT question must reach the US–Portugal article",
  );
  assert.ok(
    !us_pt.some((t) => /US–Netherlands|US–Canada/.test(t)),
    "and must never be answered with another pair's convention: " + us_pt.join(" | "),
  );

  const us_nl = byPair("US", "NL");
  assert.ok(us_nl.some((t) => /US–Netherlands, Article 16\(2\)/.test(t)));
  assert.ok(!us_nl.some((t) => /US–Portugal|US–Canada/.test(t)), us_nl.join(" | "));

  const us_ca = byPair("US", "CA");
  assert.ok(us_ca.some((t) => /US–Canada, Article XV\(2\)/.test(t)));
  assert.ok(!us_ca.some((t) => /US–Portugal|US–Netherlands/.test(t)), us_ca.join(" | "));
});

test("no convention article is left as an unattributed quote", () => {
  // The chunk-boundary failure, pinned at the corpus rather than at retrieval.
  // The operative quotations are identified by their own CONTENT — all three
  // quote the "in the aggregate **183 days" limb — rather than by the heading
  // shape this test is about to assert, which would make it circular.
  const quotations = CITATION_PASSAGES.filter(
    (p) => p.documentId === "D-27+D-28+D-29" && /in the aggregate \*\*183 days/.test(String(p.text)),
  );
  assert.equal(quotations.length, 3, "precondition: the three quoted articles are each their own passage");

  const pairsSeen = new Set();
  for (const p of quotations) {
    assert.match(
      p.heading ?? "",
      /^US–(Netherlands|Portugal|Canada), Article/,
      `a quoted treaty article with no party in its heading: ${p.id} · "${p.heading}"`,
    );
    assert.equal(p.pairs.length, 1, `${p.id} still answers for every pair in the bundle`);
    pairsSeen.add(p.pairs[0].slice().sort().join("/"));
  }
  assert.equal(pairsSeen.size, 3, "each of the three conventions must be reachable, and only for its own pair");
});

// NEGATIVE CONTROL for the narrowing rule. It must only ever REMOVE reach: a
// heading that names no pair, or names one ambiguously, leaves the passage
// eligible for the whole document's set. A rule that could ADD a jurisdiction
// would be inventing coverage.
test("pair narrowing never widens a passage beyond its document", () => {
  for (const p of CITATION_PASSAGES) {
    const doc = DOCUMENT_JURISDICTIONS[p.documentId];
    assert.ok(doc, `passage ${p.id} has no document jurisdiction entry`);
    for (const code of p.countries) {
      assert.ok(
        doc.countries.includes(code),
        `${p.id} claims ${code}, which its document does not: ${doc.countries.join(",")}`,
      );
    }
    for (const pair of p.pairs ?? []) {
      assert.ok(
        (doc.pairs ?? []).some((dp) => dp.every((c) => pair.includes(c))),
        `${p.id} claims pair ${pair.join("/")}, which its document does not`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// UC-07 SEARCHES THE STATUTORY INDEX ON THE ROUTE, NOT ONLY ON THE PROSE
// ---------------------------------------------------------------------------
// `handleRelocationReview` resolves sourceCountry/destinationCountry and then
// handed the retriever only the request text, so the jurisdiction filter fell
// back to countriesNamed(text). A request whose route came from structured
// intake and whose prose happened to name no country was therefore searched
// with NO filter at all.
//
// It failed CLOSED — no wrong-country citation was ever produced — but it lost
// the right ones SILENTLY: the process-guidance leg still returned hits, so
// `no_citations` never fired and nothing said the statutory index had been
// searched on the prose rather than on the route. UC-08's retriever has taken
// `countries` since §3.95; this is the same seam, one use case later.
// ---------------------------------------------------------------------------

test("UC-07 filters the statutory index by the ROUTE, not only by the prose", async () => {
  const { handleRelocationReview } = await import("../src/uc07/workflow.js");
  const audit = { log: async () => {}, logTraceStep: async () => {} };
  // Deliberately country-free prose. If this sentence is ever edited to name a
  // country the test silently stops testing anything, so it is asserted first.
  const text =
    "The employee is moving permanently next quarter and we need the social security " +
    "coverage position and the certificate of coverage question resolved.";
  assert.equal(countriesNamed(text).length, 0, "the request text must name no country for this test to mean anything");

  const run = async (sourceCountry, destinationCountry) => {
    const { dossier } = await handleRelocationReview(
      { text, employmentId: "emp_active_001", externalRef: `route-${sourceCountry}${destinationCountry}`, sourceCountry, destinationCountry },
      {
        audit,
        // Injected, so nothing here can reach OpenAI.
        classify: async () => ({ relocationType: "permanent", sourceCountry, destinationCountry, confidence: 0.9, source: "rule_based_fallback" }),
        draftNarrative: async () => ({ narrative: "n/a", source: "rule_based_fallback" }),
        judge: async () => ({ verdict: "not_evaluated" }),
      },
    );
    return (dossier.citations ?? []).filter((c) => c.authority);
  };

  // US -> CANADA IS THE CASE THAT DISCRIMINATES, and it is a wrong-jurisdiction
  // failure rather than a missing-citation one. With no route the filter fell
  // back to countriesNamed(text) = [], which means "no filter", so the search
  // ran over the whole feed and returned **Regulation (EC) No 883/2004** — the
  // EU's internal social-security coordination instrument, which binds neither
  // the United States nor Canada — as the top hit for a US->CA relocation.
  const usCa = await run("US", "CA");
  assert.ok(usCa.length > 0, "the route must still reach the statutory index");
  for (const c of usCa) {
    assert.ok(
      (c.countries ?? []).some((code) => ["US", "CA"].includes(code)),
      `cited for neither US nor CA: ${c.title} (${(c.countries ?? []).slice(0, 6).join(",")})`,
    );
  }
  assert.ok(!usCa.some((c) => c.documentId === "D-17"), "the EU coordination regulation was cited on a US-Canada move");

  // The EU pair must still get it — the filter narrows, it does not suppress.
  const nlPt = await run("NL", "PT");
  assert.ok(nlPt.some((c) => c.documentId === "D-17"), "an intra-EU move lost Regulation (EC) No 883/2004");
});
