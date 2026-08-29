// ---------------------------------------------------------------------------
// uc08DecisionSources.test.js
//   One question asked of the 🔴 use case whose dossier IS its whole product:
//   the specialist reads a day count and a treaty framing — SAYS WHO?
// ---------------------------------------------------------------------------
// THE CASE THIS FILE IS BUILT AROUND is the one docs/ESCALATION-DESTINATIONS.md
// §5.2 names as the sharpest gap in the repository. A Tax Operations specialist
// — the most senior tax reader this system escalates to — received a dossier
// citing three passages this project had written itself: a paraphrase of OECD
// Model Article 4, a paraphrase of Article 15, and a paragraph of general
// totalization principle. Sitting unread twelve directories away were the
// Canada–Netherlands convention, both Canada–Netherlands social security
// agreements, the CRA's own table, and all four demo countries' domestic
// residence tests, each with a publisher, an exact URL, a retrieval date and a
// checksum where the licence allowed one.
//
// WHAT THIS FILE WILL NOT LET THROUGH, in descending order of what it would
// cost:
//   * A CITATION THAT RESOLVES TO NOTHING. Every `path` is asserted to exist on
//     disk and to still open with its catalogue id; every caveat is asserted to
//     still be a heading in CONTRADICTIONS.md. A renamed document must break a
//     test, never become authority-shaped text linking nowhere.
//   * A QUOTE THE DOCUMENT DOES NOT CONTAIN. Every `quote` in the module is
//     matched against the sidecar it is attributed to, markdown-tolerantly. A
//     live link to the right document, cited for something it does not say, is
//     the one failure a path check cannot see.
//   * A NEAREST MATCH. Canada–Portugal is not a near miss for Canada–
//     Netherlands: six conventions, six different windows, one of them a
//     different structure entirely. An unheld pair gets NO citation and an
//     explicit statement of what is held instead.
//   * A NUMBER CARRIED AS A VALUE. 183 may be quoted — it is in three of the
//     four residence tests and in six treaty articles, meaning something
//     different in each — and may never be a field, because the moment it is,
//     something compares it.
//   * A CITATION REACHING A GATE. UC-08 escalates, always.
//
// Hermetic and pure: every function under test is a lookup over frozen data,
// and the dossier fixtures come from the REAL workflow rather than hand-built
// rows — the fixtures-agree-with-the-code failure this project keeps paying
// for. The LLM seams are injected, so nothing here reaches the network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { handleTaxInquiry } from "../src/uc08/workflow.js";
import { parseInquiryRuleBased } from "../src/uc08/inquiryParser.js";
import { describeDossier } from "../src/uc08/dossierView.js";
import { AuditLogger } from "../src/shared/audit.js";
import {
  SOURCE_LIBRARY,
  CAVEAT_LIBRARY,
  CONFIRMATION_LIBRARY,
  RESIDENCE_TESTS,
  TREATY_EMPLOYMENT_ARTICLES,
  SOCIAL_SECURITY_COVERAGE,
  FINDING_SOURCES,
  UNCITED_FINDINGS,
  SOURCED_COUNTRIES,
  SOURCED_PAIRS,
  pairKey,
  sourcesForFinding,
  uncitedFinding,
  RETRIEVAL_METHOD,
  SOURCE_FRAMING,
  CAVEAT_FRAMING,
  TREATY_FRAMING,
  RESIDENCE_FRAMING,
} from "../src/uc08/decisionSources.js";

const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative) => readFileSync(repoPath(relative), "utf8");

// The sidecars wrap, bold and blockquote the statutory text, so a quotation is
// matched on its WORDS with markdown and line breaks allowed between them. The
// point of the check is that the article is there, not how it is typeset.
function looselyContains(haystack, phrase) {
  // Built from the phrase's ALPHANUMERIC RUNS only, joined by a permissive
  // separator. The sidecars bold, blockquote, wrap and letter-space the
  // statutory text — D-31's article ends "beoordeeld**." — so anything stricter
  // fails on typography rather than on content, which would make this check
  // noise. A twelve-word run of the same tokens in the same order is not
  // something a wrong document contains by accident.
  const runs = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (runs.length === 0) return false;
  return new RegExp(runs.join("[^\\p{L}\\p{N}]{0,16}"), "iu").test(haystack);
}

const fakeDraftNarrative = async () => ({ narrative: "Dossier narrative (deterministic template).", source: "template" });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// ---------------------------------------------------------------------------
// The fixture — a real demo-country scenario, through the real handler
// ---------------------------------------------------------------------------
// docs/DEMO-COUNTRIES.md UC08-USPT-1: a US→PT withholding question, and the one
// scenario in that table where BOTH jurisdictions resolve from the text. 182
// days is deliberately one day under the figure a reader will reach for, which
// is exactly the situation where a citation has to say which 183 it is.
// ---------------------------------------------------------------------------

const USPT_TICKET = {
  text: "Our employee moved from the United States to Portugal mid-year. Which country do we withhold payroll tax in?",
  employmentId: "emp_uspt_1",
  externalRef: "src-uspt-1",
  targetCountry: "PT",
  windowStart: "2026-01-01",
  windowEnd: "2026-12-31",
  presencePeriods: [
    { country: "PT", startDate: "2026-01-05", endDate: "2026-05-04" },
    { country: "PT", startDate: "2026-07-01", endDate: "2026-08-31" },
  ],
};

const CANL_TICKET = {
  text: "Totalization question: our employee from Canada is working in the Netherlands. Do they need a certificate of coverage?",
  employmentId: "emp_canl_1",
  externalRef: "src-canl-1",
  targetCountry: "NL",
  windowStart: "2026-01-01",
  windowEnd: "2026-12-31",
  presencePeriods: [{ country: "NL", startDate: "2026-01-01", endDate: "2026-09-30" }],
};

async function dossierFor(ticket) {
  const result = await handleTaxInquiry(ticket, {
    audit: new AuditLogger(),
    classify: parseInquiryRuleBased,
    draftNarrative: fakeDraftNarrative,
    judge: fakeJudge,
  });
  const view = describeDossier({
    inquiryType: result.dossier.inquiryType,
    jurisdictions: result.dossier.jurisdictions,
    presenceDays: result.presenceDays,
    dossier: result.dossier,
  });
  return { result, view };
}

// ===========================================================================
// THE TEST THAT MATTERS
// ===========================================================================

test("POSITIVE: a US→PT withholding dossier is handed the convention in force, both residence tests, and the agreement — not a model", async () => {
  const { result, view } = await dossierFor(USPT_TICKET);

  // Unchanged by any of this work: the decision, and the count.
  assert.equal(result.decision, "escalate");
  assert.equal(result.dossier.inquiryType, "withholding");
  assert.deepEqual(result.dossier.jurisdictions, ["US", "PT"]);
  assert.equal(result.presenceDays.days, 182, "the fixture must be the one-day-under case or it proves something else");

  // FOUR SOURCED FINDINGS, each keyed to a jurisdiction or the pair.
  assert.deepEqual(
    view.sources.map((g) => `${g.finding}@${g.scope}`),
    [
      "residence_test@US",
      "presence_day_count@PT",
      "treaty_employment_article@PT|US",
      "social_security_coverage@PT|US",
    ]
  );

  // 1 — THE TREATY THAT IS ACTUALLY IN FORCE, not the model it was drafted from.
  const treaty = view.sources.find((g) => g.finding === "treaty_employment_article");
  assert.equal(treaty.citations[0].sourceId, "D-27");
  assert.match(treaty.citations[0].locator, /art\. 16\(2\)/);
  assert.ok(existsSync(repoPath(treaty.citations[0].path)), "the citation links to a file that is not there");
  assert.match(treaty.treaty.limbs[0].window, /taxable year/i, "this pair's window, not another pair's");

  // AND THE POINT OF THE WHOLE BLOCK: three cumulative limbs, and the day count
  // answers one. `systemCoverage` is three-valued and nothing is ever "full".
  assert.equal(treaty.treaty.structure, "three_cumulative_limbs");
  assert.deepEqual(
    treaty.treaty.limbs.map((l) => `${l.key}:${l.systemCoverage}`),
    ["days_present:partial", "employer_not_resident:none", "not_borne_by_a_permanent_establishment:none"]
  );
  assert.match(TREATY_FRAMING, /CUMULATIVE/);

  // 2 — BOTH JURISDICTIONS' OWN RESIDENCE RULES, quoted from the administering
  // authority, and they are DIFFERENT SHAPES.
  const us = view.sources.find((g) => g.scope === "US");
  const pt = view.sources.find((g) => g.scope === "PT");
  assert.equal(us.residenceTest.shape, "weighted_three_year_computation");
  assert.equal(pt.residenceTest.shape, "day_count_anchored_on_the_tax_year_plus_a_count_free_limb");
  assert.notEqual(us.residenceTest.shape, pt.residenceTest.shape);
  // Portugal's day-counting convention travels with the count, because it is
  // the thing this system gets wrong: a date range is not a night's stay.
  assert.match(pt.residenceTest.secondQuote, /dormida no mesmo/);
  assert.deepEqual(pt.caveats.map((c) => c.id), ["C-12", "C-21"]);

  // 3 — THE AGREEMENT, with its own date, and a caveat saying the number
  // belongs to the pair rather than to Portugal.
  const social = view.sources.find((g) => g.finding === "social_security_coverage");
  assert.equal(social.coverage.certificate, "US certificate of coverage");
  assert.match(social.citations[0].citedFor, /1989-08-01/);
  assert.match(social.citations[0].citedFor, /1981-05-01/, "the reader is told the OTHER Portugal agreement exists");
  assert.ok(social.caveats.some((c) => c.id === "C-9"));

  // 4 — AND THE RANKED QUESTION IT PRODUCES. The limbs nobody can see outrank
  // everything except the residence-test statement.
  const limbs = view.openQuestions.find((q) => q.code === "treaty_limbs_not_represented");
  assert.ok(limbs, "a cited cumulative article must raise the limbs nobody can see");
  assert.equal(limbs.priority, 1);
  assert.match(limbs.question, /permanent establishment/);
});

test("POSITIVE: the CA→NL case counts 273 days in a country whose law has NO day count, and now says so with the statute", async () => {
  // docs/DEMO-COUNTRIES.md UC08-CANL-1. This is the dossier the citation gap
  // was reported on, and the finding underneath it is not "the Netherlands is
  // missing from a dictionary" — it is that 273 days in the Netherlands is a
  // measurement against nothing, because AWR art. 4 contains no threshold.
  const { result, view } = await dossierFor(CANL_TICKET);
  assert.equal(result.decision, "escalate");
  assert.equal(result.presenceDays.days, 273);

  const nl = view.sources.find((g) => g.scope === "NL");
  assert.equal(nl.finding, "presence_day_count", "the counted country gets the count-facing framing");
  assert.equal(nl.residenceTest.shape, "no_day_count");
  assert.equal(nl.residenceTest.systemCoverage, "none");
  assert.match(nl.residenceTest.quote, /naar de omstandigheden beoordeeld/);
  assert.match(nl.residenceTest.silentOn[0], /Any number of days/);
  assert.ok(looselyContains(read(nl.citations[0].path), nl.residenceTest.quote));

  // Canada gets BOTH the statute and the administrative view, and the folio
  // carries its own force-of-law warning rather than borrowing the statute's.
  const ca = view.sources.find((g) => g.scope === "CA");
  assert.deepEqual(ca.citations.map((c) => c.sourceId), ["D-33", "D-34"]);
  assert.match(ca.citations[0].evidence, /statute/);
  assert.match(ca.citations[1].evidence, /does NOT have the force of law/);

  // The pair's own agreement, and the contradiction that only reading the
  // instrument caught.
  const social = view.sources.find((g) => g.finding === "social_security_coverage");
  assert.equal(social.coverage.certificate, "CPT63");
  assert.ok(social.caveats.some((c) => c.id === "C-24"));
  assert.match(social.coverage.maximumInitialDetachment, /60 months/);
  assert.match(social.coverage.maximumInitialDetachment, /24 months/, "both agreements' figures, not the agency's mixed row");
});

// ===========================================================================
// THE LINKS, THE QUOTES, AND THE CAVEATS
// ===========================================================================

test("every document cited exists on disk and still opens with its catalogue id", () => {
  for (const [id, doc] of Object.entries(SOURCE_LIBRARY)) {
    assert.equal(doc.id, id);
    assert.ok(existsSync(repoPath(doc.path)), `${id} links to ${doc.path}, which does not exist on disk`);
    const text = read(doc.path);
    assert.ok(text.startsWith(`# ${id} `), `${doc.path} no longer opens with the catalogue id ${id}`);
    assert.ok(text.includes("[CONFIRMED"), `${id} is cited as confirmed and its sidecar does not say so`);
    if (doc.bytes) assert.ok(existsSync(repoPath(doc.bytes)), `${id} claims bytes at ${doc.bytes}, which are not there`);
    // The licence is part of the citation — rule 6. A document with no licence
    // row is a document somebody may copy without knowing whether they may.
    assert.ok(doc.licence && doc.licence.length > 20, `${id} carries no licence statement`);
  }
});

test("every quotation in the module really is in the document it is attributed to", () => {
  // THE FAILURE A PATH CHECK CANNOT SEE: a live link to the right document,
  // cited for something it does not say. An ellipsis marks an elision, so each
  // side of it is checked separately rather than as one run of text.
  const checked = [];
  const check = (sourceId, quote, where) => {
    if (!quote) return;
    const text = read(SOURCE_LIBRARY[sourceId].path);
    for (const fragment of String(quote).split("…")) {
      const trimmed = fragment.trim().replace(/^[[(]|[\])]$/g, "");
      if (trimmed.length < 12) continue;
      assert.ok(
        looselyContains(text, trimmed),
        `${where}: ${SOURCE_LIBRARY[sourceId].path} does not contain "${trimmed.slice(0, 70)}…"`
      );
      checked.push(where);
    }
  };

  for (const [code, entry] of Object.entries(RESIDENCE_TESTS)) {
    check(entry.source, entry.quote, `RESIDENCE_TESTS.${code}.quote`);
    check(entry.source, entry.secondQuote, `RESIDENCE_TESTS.${code}.secondQuote`);
    if (entry.alsoRead) check(entry.alsoRead.source, entry.alsoRead.quote, `RESIDENCE_TESTS.${code}.alsoRead`);
  }
  for (const [key, entry] of Object.entries(TREATY_EMPLOYMENT_ARTICLES)) {
    for (const limb of entry.limbs) check(entry.source, limb.quote, `TREATY.${key}.${limb.key}`);
  }
  for (const [key, entry] of Object.entries(SOCIAL_SECURITY_COVERAGE)) {
    for (const c of entry.cite) check(c.source, c.quote, `SOCIAL.${key}.${c.source}`);
  }
  assert.ok(checked.length >= 20, `only ${checked.length} quotations were checked — the corpus should be denser than that`);
});

test("every caveat and confirmation is still a real heading in CONTRADICTIONS.md", () => {
  const contradictions = read("docs/knowledge/layer-1-statutory/CONTRADICTIONS.md");
  for (const [id, caveat] of Object.entries(CAVEAT_LIBRARY)) {
    assert.equal(caveat.id, id);
    assert.ok(existsSync(repoPath(caveat.path)));
    assert.match(
      contradictions,
      new RegExp(`^### ${caveat.section} · `, "m"),
      `${id} is cited as a contradiction and no such heading exists any more`
    );
    // Three-valued and never numeric — a severity score here would be the
    // invented precision this whole discipline refuses.
    assert.ok(["disputed", "unsupported", "incomplete"].includes(caveat.weight));
  }
  for (const [id, k] of Object.entries(CONFIRMATION_LIBRARY)) {
    assert.equal(k.id, id);
    assert.match(contradictions, new RegExp(`^### ${k.section} · `, "m"));
  }
});

test("every caveat a finding cites is registered, and every registered document is cited by something", () => {
  const citedDocs = new Set();
  const citedCaveats = new Set();
  for (const entry of Object.values(RESIDENCE_TESTS)) {
    citedDocs.add(entry.source);
    if (entry.alsoRead) citedDocs.add(entry.alsoRead.source);
    (entry.caveats ?? []).forEach((c) => citedCaveats.add(c));
  }
  for (const entry of Object.values(TREATY_EMPLOYMENT_ARTICLES)) {
    citedDocs.add(entry.source);
    (entry.caveats ?? []).forEach((c) => citedCaveats.add(c));
  }
  for (const entry of Object.values(SOCIAL_SECURITY_COVERAGE)) {
    entry.cite.forEach((c) => citedDocs.add(c.source));
    (entry.caveats ?? []).forEach((c) => citedCaveats.add(c));
  }
  for (const id of citedCaveats) assert.ok(CAVEAT_LIBRARY[id], `an entry cites unknown caveat ${id}`);
  // A document in the library that no finding cites is a document nobody
  // checked against anything — the rule src/uc05/decisionSources.js's header
  // states for D-01 and keeps.
  for (const id of Object.keys(SOURCE_LIBRARY)) {
    assert.ok(citedDocs.has(id), `${id} is in the library and no finding cites it`);
  }
});

// ===========================================================================
// NO NEAREST MATCH
// ===========================================================================

test("a jurisdiction or pair this corpus does not hold gets NO citation, and is told what is held instead", () => {
  assert.equal(sourcesForFinding("residence_test", { country: "DE" }), null);
  assert.equal(sourcesForFinding("residence_test", { country: null }), null);
  assert.equal(sourcesForFinding("treaty_employment_article", { pair: ["DE", "ES"] }), null);
  assert.equal(sourcesForFinding("social_security_coverage", { pair: ["NL", "DE"] }), null);
  assert.equal(sourcesForFinding("a_finding_that_does_not_exist", { country: "PT" }), null);
  // Prototype-chain lookups must not resolve to a finding, a country or a pair.
  assert.equal(sourcesForFinding("constructor", { country: "PT" }), null);
  assert.equal(sourcesForFinding("residence_test", { country: "constructor" }), null);
  assert.equal(uncitedFinding("constructor"), null);

  const absentCountry = uncitedFinding("residence_test", { country: "DE" });
  assert.match(absentCountry.why, /No source/);
  assert.match(absentCountry.why, /DE is not among them/);
  assert.match(absentCountry.why, /never looked/);
  assert.match(absentCountry.why, /cannot be read as a clearance|nothing here can be read as a clearance/);

  const absentPair = uncitedFinding("treaty_employment_article", { pair: ["DE", "ES"] });
  assert.match(absentPair.why, /DE–ES is not among them/);
  assert.match(absentPair.why, /A neighbouring pair's treaty is not a substitute/);
  // And it says WHY substituting would be undetectable, which is the argument
  // for a map rather than a similarity search.
  assert.match(absentPair.why, /six different windows/);

  // A pair IS held -> uncitedFinding has nothing to explain.
  assert.equal(uncitedFinding("treaty_employment_article", { pair: ["PT", "US"] }), null);
  assert.equal(uncitedFinding("residence_test", { country: "PT" }), null);
});

test("direction of travel does not change which instrument is in force, and a country is not a pair with itself", () => {
  assert.equal(pairKey("ca", "nl"), "CA|NL");
  assert.equal(pairKey("NL", "CA"), "CA|NL");
  assert.equal(pairKey("NL", "NL"), null, "one country is not a cross-border question");
  assert.equal(pairKey("NL", ""), null);
  assert.equal(pairKey(null, "NL"), null);
  assert.deepEqual(
    sourcesForFinding("treaty_employment_article", { pair: ["CA", "NL"] }).citations.map((c) => c.sourceId),
    sourcesForFinding("treaty_employment_article", { pair: ["NL", "CA"] }).citations.map((c) => c.sourceId)
  );
});

test("all six demo pairs are held, and no two of them state the same window", () => {
  assert.deepEqual(Object.keys(TREATY_EMPLOYMENT_ARTICLES).sort(), [...SOURCED_PAIRS].sort());
  assert.deepEqual(Object.keys(SOCIAL_SECURITY_COVERAGE).sort(), [...SOURCED_PAIRS].sort());
  assert.deepEqual(Object.keys(RESIDENCE_TESTS).sort(), [...SOURCED_COUNTRIES].sort());

  // C-10 IS THE FINDING AND IT IS PINNED HERE, WITH ONE CORRECTION MADE BY
  // WRITING THE TEST. `CONTRADICTIONS.md` C-10 is headed "Six treaties, six
  // different 183-day windows" and D-26's own sidecar calls itself "the sixth
  // formulation". Reading the six quotations side by side, there are SIX
  // INSTRUMENTS and FIVE DISTINCT FORMULATIONS: Canada–Netherlands and
  // Canada–Portugal state theirs in identical words. That is not a defect in
  // either document and it does not weaken C-10's point — it sharpens it, and
  // it is the reason this lookup is keyed on the PAIR rather than on Canada:
  // Canada's two European partners happen to agree, and its US partner does
  // not agree with either, so no per-country answer exists.
  const windows = Object.values(TREATY_EMPLOYMENT_ARTICLES).map(
    (t) => t.limbs.find((l) => l.window)?.window ?? null
  );
  assert.equal(windows.length, 6, "six pairs, six articles");
  assert.equal(
    new Set(windows).size,
    5,
    `the distinct formulations changed — re-read the six articles before editing this number: ${windows.join(" | ")}`
  );
  assert.equal(
    TREATY_EMPLOYMENT_ARTICLES["CA|NL"].limbs[0].window,
    TREATY_EMPLOYMENT_ARTICLES["CA|PT"].limbs[0].window,
    "the two that coincide are Canada's European pair; if that stops being true, C-10's count is right after all"
  );
  // And every other pairing is genuinely distinct, which is the half that
  // matters: a nearest match across any of these is a different rule.
  for (const [a, b] of [["NL|PT", "CA|NL"], ["NL|US", "PT|US"], ["CA|US", "CA|NL"], ["NL|PT", "PT|US"]]) {
    assert.notEqual(
      TREATY_EMPLOYMENT_ARTICLES[a].limbs.find((l) => l.window).window,
      TREATY_EMPLOYMENT_ARTICLES[b].limbs.find((l) => l.window).window,
      `${a} and ${b} state the same window`
    );
  }

  // And the one that is not shaped like the other five.
  assert.equal(TREATY_EMPLOYMENT_ARTICLES["CA|US"].structure, "alternative_limbs");
  const money = TREATY_EMPLOYMENT_ARTICLES["CA|US"].limbs[0];
  assert.match(money.label, /ALTERNATIVE to the day limb/);
  assert.match(money.quote, /ten thousand dollars/);
  // The corrupt parenthetical numeral is elided and the elision is explained,
  // rather than a wrong money figure being printed inside quotation marks.
  assert.ok(!/\$?\(?0,000\)?/.test(money.quote));
  assert.match(money.transcriptionNote, /corrupt/);
});

// ===========================================================================
// IT MUST NOT DECIDE, MUST NOT RANK, AND MUST NOT CARRY A NUMBER
// ===========================================================================

test("no citation carries a score, a rank, or a similarity figure — and `matchedOn` names the mechanism", () => {
  const groups = [
    sourcesForFinding("residence_test", { country: "CA" }),
    sourcesForFinding("presence_day_count", { country: "PT" }),
    sourcesForFinding("treaty_employment_article", { pair: ["CA", "NL"] }),
    sourcesForFinding("social_security_coverage", { pair: ["CA", "PT"] }),
  ];
  for (const group of groups) {
    assert.equal(group.method, RETRIEVAL_METHOD);
    for (const citation of group.citations) {
      assert.match(citation.matchedOn, /hand-curated map entry/);
      assert.ok(!/\d+(\.\d+)?\s*%|similarity|confidence|\brank(ed)?\b|\bscore\b/i.test(citation.matchedOn));
    }
  }
  assert.match(RETRIEVAL_METHOD, /no search, no ranking and no similarity score/);
  assert.match(SOURCE_FRAMING, /never what to conclude/);

  // KEYS, not prose — the framing sentences contain the words they promise not
  // to act on, so a text scan would fail on the guarantee itself. What must not
  // exist is a FIELD a renderer could sort, colour or read a verdict out of.
  const keys = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (v && typeof v === "object") {
      for (const [k, inner] of Object.entries(v)) {
        keys.add(k);
        collect(inner);
      }
    }
  };
  groups.forEach(collect);
  for (const forbidden of ["score", "confidence", "rank", "ranking", "similarity", "recommended", "recommendation", "preferred", "advice", "verdict", "weightValue"]) {
    assert.ok(!keys.has(forbidden), `a citation block carries a "${forbidden}" field`);
  }
});

test("a number may be QUOTED and may never be CARRIED", () => {
  // src/uc08/jurisdictionKnowledge.js already keeps this discipline for the
  // register (`thresholdDays: null`). This is the same rule one file over: 183
  // appears in three of the four residence tests and in six treaty articles and
  // means something different in every one of them, so the moment it becomes a
  // number in a field, something downstream compares it.
  const numeric = [];
  const scan = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => scan(x, `${path}.${k}`));
    if (typeof v === "number") numeric.push(`${path} = ${v}`);
  };
  for (const finding of ["residence_test", "presence_day_count"]) {
    for (const country of SOURCED_COUNTRIES) scan(sourcesForFinding(finding, { country }), `${finding}.${country}`);
  }
  for (const key of SOURCED_PAIRS) {
    const pair = key.split("|");
    scan(sourcesForFinding("treaty_employment_article", { pair }), `treaty.${key}`);
    scan(sourcesForFinding("social_security_coverage", { pair }), `social.${key}`);
  }
  assert.deepEqual(numeric, [], "a number reached a citation block as a value");
});

test("no gate consults the citations, and no citation id appears in a conditional", () => {
  // docs/knowledge/README.md's structural rule, asserted for UC-08 as it is for
  // UC-04 and UC-05: a citation enters a description, is rendered to a human,
  // and goes nowhere else. A source that could change an outcome is not a
  // source. UC-08's decision is `escalate`, always — nothing here may touch it.
  for (const file of readdirSync(repoPath("src/uc08"))) {
    if (!file.endsWith(".js") || file === "decisionSources.js" || file === "dossierView.js") continue;
    const imports = read(`src/uc08/${file}`)
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import ") && /decisionSources/.test(l));
    assert.deepEqual(imports, [], `src/uc08/${file} imports decisionSources — a citation must never reach a decision`);
  }
  for (const file of ["src/uc08/decisionSources.js", "src/uc08/dossierView.js", "src/uc08/workflow.js"]) {
    const text = read(file).replace(/^\s*(\/\/.*|\*.*)$/gm, "");
    assert.ok(
      !/(if|while|switch)\s*\([^)]*["'](C|D|K)-\d+["']/.test(text),
      `${file} branches on a citation id`
    );
  }
  // And the module itself is frozen data plus three lookups: no client, no
  // clock, no I/O, no import of any kind.
  const source = read("src/uc08/decisionSources.js");
  assert.deepEqual(
    source.split("\n").filter((l) => l.trimStart().startsWith("import ")),
    [],
    "decisionSources.js imports something — it is frozen data and must stay that way"
  );
});

test("the dossier still escalates and still writes nowhere, with citations attached", async () => {
  for (const ticket of [USPT_TICKET, CANL_TICKET, { text: "Nothing in particular.", externalRef: "src-none" }]) {
    const { result, view } = await dossierFor(ticket);
    assert.equal(result.decision, "escalate");
    assert.ok(Array.isArray(view.sources));
    assert.ok(Array.isArray(view.uncited));
  }
  // The structural half, extended to the new file: no write-capable client can
  // reach it, because it takes none and imports none.
  const code = read("src/uc08/decisionSources.js").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["RemoteClient", "ZendeskClient", "pgPool", "fetch(", "post(", "patch("]) {
    assert.ok(!code.includes(forbidden), `decisionSources.js references ${forbidden} — UC-08 has no execution path`);
  }
});

// ===========================================================================
// THE ABSENCES, SAID OUT LOUD
// ===========================================================================

test("the three absences that are stated on EVERY dossier are stated on every dossier", async () => {
  // Citizenship, because there is no input to condition on. The treaty
  // residence article, because the instrument is held and the article was never
  // read. Permanent establishment, because the governing material is
  // paraphrase-only by licence and was never retrieved. Each is a silence that
  // reads as the absence of a problem unless something says otherwise.
  for (const ticket of [USPT_TICKET, CANL_TICKET, { text: "Nothing in particular.", externalRef: "src-none-2" }]) {
    const { view } = await dossierFor(ticket);
    const codes = view.uncited.map((u) => u.finding);
    for (const required of ["citizenship_based_taxation", "treaty_residence_tie_breaker", "permanent_establishment_exposure"]) {
      assert.ok(codes.includes(required), `${required} must be stated on every dossier`);
    }
  }
});

test("the OECD material is refused for a LICENCE reason, and appears nowhere else in the module", () => {
  const pe = uncitedFinding("permanent_establishment_exposure");
  assert.match(pe.why, /paraphras/i);
  assert.match(pe.why, /never copying|never copied/);
  assert.match(pe.why, /has NOT read|were not retrieved/);

  // Rule 6, enforced: no OECD text is quoted anywhere, and no commercial
  // database is named at all. A single quoted line from the Model would be a
  // licence breach dressed as a citation.
  const source = read("src/uc08/decisionSources.js");
  for (const id of Object.keys(SOURCE_LIBRARY)) {
    assert.ok(!/oecd/i.test(SOURCE_LIBRARY[id].publisher), `${id} is attributed to the OECD`);
  }
  // THE DATA, NOT THE PROSE. The header names these four in the sentence that
  // says they are excluded — the same trap as scanning for the word
  // "recommended" in a promise not to recommend. What must not exist is a
  // citation to one.
  const code = source.replace(/^\s*(\/\/.*)$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const excluded of ["IBFD", "Bloomberg Tax", "Vialto", "support.remote.com"]) {
    assert.ok(!code.includes(excluded), `${excluded} is excluded entirely and is cited in the module`);
  }
  // The only mentions of the OECD are the two that say it was not read.
  const mentions = source.split("\n").filter((l) => /OECD/.test(l));
  assert.ok(mentions.length > 0);
  for (const line of mentions) {
    assert.ok(
      /paraphras|NOT read|not read|never copied|never copying|Commentary|register|LICENCE/.test(line),
      `an OECD mention that is not a statement of the licence limit: ${line.trim().slice(0, 90)}`
    );
  }
});

test("every uncited finding actually says something, and the two shapes of absence stay distinct", () => {
  for (const [key, entry] of Object.entries(UNCITED_FINDINGS)) {
    const out = uncitedFinding(key);
    assert.equal(out.finding, key);
    assert.equal(out.label, entry.label);
    assert.ok(out.why.length > 60, `${key}'s reason must actually say something`);
  }
  // A finding about THIS SYSTEM reads differently from a finding about a
  // jurisdiction this corpus does not hold. Conflating them is the defect.
  assert.match(uncitedFinding("presence_not_requested").why, /property of the request/);
  assert.match(uncitedFinding("residence_test", { country: "NG" }).why, /never looked/);
});

test("every finding in the map is reachable from a real dossier, and every scope in it is a demo scope", () => {
  // A map entry no dossier can produce is a citation nobody will ever see, and
  // reads as coverage this file does not have.
  assert.deepEqual(
    Object.keys(FINDING_SOURCES).sort(),
    ["presence_day_count", "residence_test", "social_security_coverage", "treaty_employment_article"]
  );
  for (const entry of Object.values(FINDING_SOURCES)) {
    assert.ok(["country", "pair"].includes(entry.axis));
    assert.ok(entry.question.endsWith("?"), "every finding states the question its reader is actually asking");
  }
  for (const key of SOURCED_PAIRS) {
    for (const code of key.split("|")) assert.ok(SOURCED_COUNTRIES.includes(code), `${code} is in a pair and not in the register`);
  }
});

// ===========================================================================
// WHO THIS IS WRITTEN FOR
// ===========================================================================
// The reader of a UC-08 dossier is a CROSS-BORDER TAX SPECIALIST. They are a
// domain expert in tax and a stranger to this codebase, and every sentence on
// their screen has to be actionable from where they are sitting.
//
// THE DEFECT THIS SECTION EXISTS TO CATCH IS AN ADDRESS, NOT A CLAIM. The
// module's epistemic limits — "no source that has been read", "NOT read", "no
// entry covering this at all" — are the most valuable content on the screen and
// none of them is in question here: on a 🔴 dossier a specialist acting on an
// overstated citation is the failure this use case exists to prevent. What was
// wrong was where those sentences POINTED. A reader was told to "see
// UNCITED_FINDINGS" (a JavaScript identifier), that a manifest file in this
// repository "has no entry covering citizenship-based taxation", and that what
// is held is the domestic test "(see `residence_test`)". None of those is a
// thing a tax specialist can open, so each one converted a real limit into an
// instruction they could not follow — and the limit is the half that matters.
//
// A STRUCTURAL SCAN, NOT EQUALITY ON SENTENCES, because the sentences will be
// rewritten again and the next leak should fail before anyone reads it. The
// scan runs over the strings that REACH A READER — internal fields the renderer
// uses for identity and verification (`path`, `bytes`, `url`, `id`, `source`,
// the enum-valued `shape`/`state`/`systemCoverage`) are excluded by key, and
// `codeShaped()` itself is tested in both directions below, because a scanner
// that flags "art. 15(2)" or "Folio S5-F1-C1" would be deleted within a week
// and one that flags nothing is worse than none.
// ===========================================================================

/** Fields the renderer reads for identity, verification or branching — not prose. */
const INTERNAL_KEYS = new Set([
  "id", "section", "source", "sourceId", "path", "bytes", "url",
  "key", "shape", "state", "systemCoverage", "structure", "weight",
  "axis", "finding", "scope", "country", "pair", "caveats", "confirmations", "covered",
]);

const CODE_SHAPED = [
  // A path into this repository. Reachable by whoever cloned it and by nobody else.
  ["a repository path", /(?:^|[\s("'“‘«])(?:docs|src|test|tests|workflows|scripts|deploy|zaf-app)\/[A-Za-z0-9._/-]+/],
  // A source or document FILE. `DOWNLOAD-MANIFEST.md` is not an instrument.
  ["a file name", /\b[A-Za-z0-9_-]+\.(?:js|mjs|cjs|ts|md|json|ya?ml)\b/],
  // Backticks in prose are, in this repository, always a code identifier.
  ["a backticked identifier", /`/],
  // `computePresenceDays()` — a function nobody outside the build can call.
  ["a function name", /\b[A-Za-z_$][A-Za-z0-9_$]*\(\)/],
  // UNCITED_FINDINGS, RETRIEVAL_METHOD, SOURCE_LIBRARY.
  ["a SCREAMING_SNAKE identifier", /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/],
  // residence_test, citizenship_based_taxation, presence_day_count.
  ["a snake_case identifier", /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/],
  // D-35, C-10, K-4 — this project's own catalogue numbering, which a tax
  // specialist has never seen and which collides with a second register of
  // C-N findings elsewhere in this repository. The lookbehind and lookahead
  // are what let the CRA's own folio id S5-F1-C1 through untouched.
  ["an internal catalogue id", /(?<![\w-])[CDK]-\d+(?![\w-])/],
];

function codeShaped(text) {
  return CODE_SHAPED.filter(([, re]) => re.test(text)).map(([name]) => name);
}

function collectVisibleStrings(value, at, out) {
  if (typeof value === "string") {
    if (value.trim()) out.push([at, value]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectVisibleStrings(item, `${at}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, inner] of Object.entries(value)) {
      if (INTERNAL_KEYS.has(k)) continue;
      collectVisibleStrings(inner, `${at}.${k}`, out);
    }
  }
}

/** Everything this module can put in front of a specialist, in one list. */
function everythingAReaderCanSee() {
  const out = [];
  collectVisibleStrings(
    { SOURCE_FRAMING, CAVEAT_FRAMING, RETRIEVAL_METHOD, TREATY_FRAMING, RESIDENCE_FRAMING },
    "framing",
    out
  );
  collectVisibleStrings(SOURCE_LIBRARY, "SOURCE_LIBRARY", out);
  collectVisibleStrings(CAVEAT_LIBRARY, "CAVEAT_LIBRARY", out);
  collectVisibleStrings(CONFIRMATION_LIBRARY, "CONFIRMATION_LIBRARY", out);
  collectVisibleStrings(RESIDENCE_TESTS, "RESIDENCE_TESTS", out);
  collectVisibleStrings(TREATY_EMPLOYMENT_ARTICLES, "TREATY_EMPLOYMENT_ARTICLES", out);
  collectVisibleStrings(SOCIAL_SECURITY_COVERAGE, "SOCIAL_SECURITY_COVERAGE", out);
  collectVisibleStrings(FINDING_SOURCES, "FINDING_SOURCES", out);
  collectVisibleStrings(UNCITED_FINDINGS, "UNCITED_FINDINGS", out);

  // And the assembled output, which is what is actually rendered: the citedFor
  // and matchedOn sentences are built in the lookups and exist nowhere above.
  for (const finding of ["residence_test", "presence_day_count"]) {
    for (const country of SOURCED_COUNTRIES) {
      collectVisibleStrings(sourcesForFinding(finding, { country }), `${finding}(${country})`, out);
    }
  }
  for (const key of SOURCED_PAIRS) {
    const pair = key.split("|");
    for (const finding of ["treaty_employment_article", "social_security_coverage"]) {
      collectVisibleStrings(sourcesForFinding(finding, { pair }), `${finding}(${key})`, out);
    }
  }
  for (const key of Object.keys(UNCITED_FINDINGS)) {
    collectVisibleStrings(uncitedFinding(key), `uncitedFinding(${key})`, out);
  }
  collectVisibleStrings(uncitedFinding("residence_test", { country: "DE" }), "uncited(DE)", out);
  collectVisibleStrings(uncitedFinding("residence_test", {}), "uncited(no country)", out);
  collectVisibleStrings(uncitedFinding("treaty_employment_article", { pair: ["DE", "ES"] }), "uncited(DE|ES)", out);
  collectVisibleStrings(uncitedFinding("social_security_coverage", {}), "uncited(no pair)", out);
  return out;
}

test("the scanner flags code and spares law — it is checked in both directions before it is trusted", () => {
  // MUST FLAG. Each of these is a real sentence this module shipped, or the
  // shape of one.
  const mustFlag = [
    "docs/knowledge/DOWNLOAD-MANIFEST.md §8 has no entry covering citizenship-based taxation",
    "no threshold is encoded anywhere in this repository, deliberately (see src/uc08/jurisdictionKnowledge.js)",
    "`computePresenceDays()` measures date ranges, so it over-counts the first",
    "paraphrase-only by licence and NOT read by this project (see UNCITED_FINDINGS)",
    "What is held is the DOMESTIC residence test of each jurisdiction (see `residence_test`)",
    "its nearest neighbour, D-35, is the US substantial-presence test",
    "its Netherlands neighbour did NOT check out (C-24)",
    "see the uncited finding citizenship_based_taxation",
    "read it from the committed IRS text at docs/knowledge/layer-1-statutory/sources/D-29-us-ca-tax-convention.pdf",
  ];
  for (const bad of mustFlag) {
    assert.ok(codeShaped(bad).length > 0, `the scanner missed a builder-facing address: ${bad}`);
  }

  // MUST SPARE. A legal citation is not a code token, and a scanner that
  // cannot tell them apart would force the citations out of the citations.
  const mustSpare = [
    "OECD Model art. 5 and its Commentary",
    "art. 15(2)",
    "art. 16.º(1)(a)–(b), with ¶¶2–3",
    "CRA Income Tax Folio S5-F1-C1, ¶¶1.8, 1.10 and 1.14",
    "CRA agreement table (Netherlands row) and form CPT63, with CTS 1990/14 and CTS 2004/6",
    "Status of Totalization Agreements (Netherlands row, TIAS 03-501)",
    "Income Tax Act, R.S.C. 1985, c. 1 (5th Supp.), s. 250 — Act current to 2026-06-17",
    "Regulation (EC) No 883/2004, consolidated text 02004R0883 — 31.07.2019",
    "Reproduction of Federal Law Order, SI/97-5. NOT the official version.",
    "E104279 (CTS 2004/6) art. VI(2) — the agreement currently in force",
    "Algemene wet inzake rijksbelastingen, artikel 4 (BWBR0002320), consolidation 2026-04-11",
    "[CONFIRMED — statute, retrieved 2026-08-19]",
  ];
  for (const good of mustSpare) {
    assert.deepEqual(codeShaped(good), [], `the scanner flagged a legitimate legal citation: ${good}`);
  }
});

test("nothing a tax specialist reads points at this repository instead of at the law", () => {
  const offences = [];
  for (const [where, text] of everythingAReaderCanSee()) {
    const kinds = codeShaped(text);
    if (kinds.length) offences.push(`${where}: ${kinds.join(", ")} — "${text.slice(0, 120)}…"`);
  }
  assert.deepEqual(
    offences,
    [],
    `a dossier reader is being pointed at a repo artefact they cannot open:\n  ${offences.join("\n  ")}`
  );
});

test("the epistemic limits survive the rewording, at full strength", () => {
  // THE HALF THAT MUST NOT BE SOFTENED. Rewriting an address is safe; rewriting
  // "NOT read" into "limited source" would be the failure this whole file
  // exists to prevent, and it is the kind of edit a copy pass makes by accident.
  const pe = uncitedFinding("permanent_establishment_exposure").why;
  assert.match(pe, /NOT read|not read|were not retrieved/, "the OECD material is unread and must still say so");
  assert.match(pe, /paraphras/i);
  assert.match(pe, /never copied|never copying/, "the licence limit is a legal constraint, not builder noise");
  assert.ok(!/limited source|partial source|some source/i.test(pe));

  const tie = uncitedFinding("treaty_residence_tie_breaker").why;
  assert.match(tie, /No source that has been read/);
  assert.match(tie, /employment-income article/, "what WAS read is named, so the gap is locatable");
  assert.match(tie, /nobody in this chain has read the residence article/);

  const citizenship = uncitedFinding("citizenship_based_taxation").why;
  assert.match(citizenship, /No source, and no input either/);
  assert.match(citizenship, /substantial[- ]presence test/i, "the nearest material is named in words, not by catalogue id");
  assert.match(citizenship, /different question/);
  assert.match(citizenship, /nationality, citizenship or passport/);

  // The four residence tests still say what this system can see of them, and
  // nothing is ever "full".
  for (const code of SOURCED_COUNTRIES) {
    assert.ok(["none", "partial"].includes(RESIDENCE_TESTS[code].systemCoverage));
  }
  // And limb (c) still says the governing material was not read.
  const limbC = TREATY_EMPLOYMENT_ARTICLES["PT|US"].limbs[2];
  assert.match(limbC.coverageNote, /NOT read|not read/);
  assert.match(limbC.coverageNote, /paraphrase-only by licence/);
});

test("every cited document names a place the reader can actually open it", () => {
  // THE OTHER HALF OF THE FIX. Taking the repo path out of the prose only helps
  // if something reachable replaces it, so every document carries the
  // publisher's own URL — and the URL is asserted against the document's own
  // provenance record rather than trusted, exactly as `path` and `quote` are.
  // An invented link is the same defect as an invented citation.
  for (const [id, doc] of Object.entries(SOURCE_LIBRARY)) {
    assert.ok(doc.url, `${id} carries no URL, so a reader has nowhere to go`);
    const record = read(doc.path);
    const urls = doc.url.match(/https?:\/\/[^\s)»>]+/g) ?? [];
    assert.ok(urls.length > 0, `${id}'s url field holds no URL`);
    for (const url of urls) {
      assert.ok(
        record.includes(url),
        `${id} points a reader at ${url}, which its own provenance record does not name`
      );
    }
  }
  // And it reaches the rendered citation, not just the library.
  const group = sourcesForFinding("treaty_employment_article", { pair: ["PT", "US"] });
  assert.match(group.citations[0].url, /^https:\/\//);
});
