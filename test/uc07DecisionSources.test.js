// ---------------------------------------------------------------------------
// uc07DecisionSources.test.js
//   One question asked of the other 🔴 use case whose dossier IS its whole
//   product: the specialist reads "immigration support required" — SAYS WHO?
// ---------------------------------------------------------------------------
// THE CASE THIS FILE IS BUILT AROUND is the one docs/ESCALATION-DESTINATIONS.md
// §5.2 and §7.5 name. A Mobility Legal Tier-3 specialist — the most senior
// mobility reader this system escalates to — received a relocation dossier
// citing six passages this project had written itself from a build pack, while
// `docs/knowledge/layer-1-statutory/` held the Portuguese remote-work visa as
// enacted in the gazette, the consular network's own conditions for it, the
// Canadian regulation on working without a permit, USCIS on the B-1, State and
// CBP on the visa waiver, the EU coordination regulations, both bilateral
// social-security networks, and all four demo countries' residence tests.
//
// AND THE FINDING THAT ONLY APPEARED WHILE WIRING THEM UP: UC-07 has no
// nationality field. `grep -rn "nationality\|citizen\|passport" src/uc07/`
// matches nothing. Every immigration instrument in the corpus is a route for a
// third-country national of the destination, so which one applies — or whether
// any is needed at all — turns on an input this system does not hold. Printing
// a route without saying that would hand a specialist "Portugal's D8" as though
// it were this employee's route. That statement is now attached to every
// dossier carrying an immigration citation, and this file pins it.
//
// WHAT THIS FILE WILL NOT LET THROUGH, in descending order of what it would
// cost:
//   * A CITATION THAT RESOLVES TO NOTHING, or a quote the document does not
//     contain. Both are checked against the vendored sidecars.
//   * A NEAREST MATCH. The Netherlands has no immigration instrument in this
//     corpus and must get an explicit absence, never Portugal's or Canada's.
//   * A CITATION UNDER A FLAG THAT HAS NO SOURCE. Most of UC-07's flags are
//     Remote's own product rules; each is recorded as uncited, one at a time.
//   * A FIGURE CITED TO A PROVISION THAT DOES NOT CONTAIN ONE. The Portuguese
//     income floor is cited to the consular pages and never to art. 61.º-B,
//     which is C-17's whole point.
//   * A CITATION REACHING A GATE. UC-07 escalates, always.
//
// Hermetic and pure: the dossier fixtures come from the REAL workflow, with the
// LLM seams injected, so nothing here reaches the network.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { handleRelocationReview } from "../src/uc07/workflow.js";
import { parseRelocationRuleBased } from "../src/uc07/relocationParser.js";
import { describeDossier } from "../src/uc07/dossierView.js";
import { FLAG } from "../src/uc07/transitionGate.js";
import { AuditLogger } from "../src/shared/audit.js";
import {
  SOURCE_LIBRARY,
  CAVEAT_LIBRARY,
  CONFIRMATION_LIBRARY,
  IMMIGRATION_ROUTES,
  SOCIAL_SECURITY_ON_RELOCATION,
  FINDING_SOURCES,
  UNCITED_FINDINGS,
  NATIONALITY_NOT_HELD,
  SOURCED_DESTINATIONS,
  SOURCED_ROUTES,
  routeKey,
  sourcesForFinding,
  uncitedFinding,
  RETRIEVAL_METHOD,
  SOURCE_FRAMING,
} from "../src/uc07/decisionSources.js";

const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative) => readFileSync(repoPath(relative), "utf8");

// Built from the phrase's alphanumeric runs only, joined by a permissive
// separator: the sidecars bold, blockquote and wrap the statutory text, so
// anything stricter fails on typography rather than on content.
function looselyContains(haystack, phrase) {
  const runs = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (runs.length === 0) return false;
  return new RegExp(runs.join("[^\\p{L}\\p{N}]{0,16}"), "iu").test(haystack);
}

const fakeDraftNarrative = async () => ({ narrative: "Dossier narrative (deterministic template).", source: "template" });
const fakeJudge = async () => ({ verdict: "not_evaluated", reason: null });

// A relocation with visa support outstanding — the shape that raises the
// immigration flag every demo scenario in docs/DEMO-COUNTRIES.md §UC-07 raises.
function planFor(sourceCountry, destinationCountry) {
  return {
    destinationSupported: true,
    destinationEntityActive: true,
    annualGrossSalaryRemoteInteger: 6500000,
    currency: "EUR",
    months: 12,
    minimumVisaSalaryRemoteInteger: 5500000,
    creationDate: "2026-05-01",
    proposedStartDate: "2026-07-01",
    destinationStartDate: "2026-07-01",
    sourceTerminationDate: "2026-06-30",
    sourceLastWorkingDay: "2026-06-30",
    minimumOnboardingLeadTimeBusinessDays: 20,
    immigrationSupportRequired: true,
    immigrationConfirmed: false,
    rightToWorkConfirmed: false,
    destinationStartDateConfirmed: true,
    sourceExitPlanValidated: true,
    employerPresenceInDestination: false,
    taxTreatyNexusConfirmed: false,
    ptoTransferAllowed: false,
    sourcePtoDays: 12,
    seniorityPreservable: true,
    sourceCountry,
    destinationCountry,
  };
}

async function dossierFor(sourceCountry, destinationCountry, planOverrides = {}) {
  const plan = { ...planFor(sourceCountry, destinationCountry), ...planOverrides };
  const result = await handleRelocationReview(
    {
      text: "We are permanently relocating an employee and will need visa support.",
      employmentId: "emp_1",
      externalRef: `src-uc07-${sourceCountry}-${destinationCountry}`,
      plan,
    },
    { audit: new AuditLogger(), classify: parseRelocationRuleBased, draftNarrative: fakeDraftNarrative, judge: fakeJudge }
  );
  const view = describeDossier({ sourceCountry, destinationCountry, dossier: result.dossier });
  return { result, view };
}

// ===========================================================================
// THE TEST THAT MATTERS
// ===========================================================================

test("POSITIVE: an NL→PT relocation is handed the gazette article, the consular conditions, both residence tests and the EU default", async () => {
  const { result, view } = await dossierFor("NL", "PT");

  // Unchanged by any of this work.
  assert.equal(result.decision, "escalate");
  assert.ok(result.dossier.flags.some((f) => f.code === FLAG.IMMIGRATION_REQUIRED));

  const findings = view.sources.map((g) => `${g.finding}@${g.scope}`);
  assert.ok(findings.includes("UC07_IMMIGRATION_REQUIRED@PT"));
  assert.ok(findings.includes("UC07_TAX_RESIDENCY_REVIEW_REQUIRED@NL|PT"));
  assert.ok(findings.includes("social_security_on_permanent_move@NL|PT"));

  // 1 — THE STATUTE, AND WHAT IT DOES NOT CONTAIN. C-17's whole point: art.
  // 61.º-B is fifty-two words creating a visa, with no income floor, no
  // duration and no insurance requirement in it.
  const immigration = view.sources.find((g) => g.axis === "destination");
  const d8 = immigration.routes.find((r) => r.key === "residence_visa_remote_work");
  assert.equal(d8.source, "D-10");
  assert.match(d8.locator, /61\.º-B/);
  assert.ok(looselyContains(read(SOURCE_LIBRARY["D-10"].path), d8.quote));
  assert.equal(d8.silentOn.length, 3);
  assert.ok(d8.silentOn.some((s) => /income floor/i.test(s)));
  assert.ok(d8.silentOn.some((s) => /maximum duration/i.test(s)));
  assert.ok(immigration.caveats.some((c) => c.id === "C-17"));

  // TWO ROUTES, NOT ONE — C-15 — and the second one carries the only duration
  // the statute states, which is under a year and therefore not a relocation.
  assert.equal(immigration.routes.length, 3);
  const temporary = immigration.routes.find((r) => r.key === "temporary_stay_visa_remote_work");
  assert.match(temporary.whatTheSourceSays, /LESS THAN ONE YEAR/);
  assert.ok(immigration.caveats.some((c) => c.id === "C-15"));

  // 2 — THE FIGURE, CITED TO THE BODY THAT PUBLISHES IT AND NOT TO THE STATUTE.
  const consular = immigration.routes.find((r) => r.key === "consular_income_and_documents");
  assert.equal(consular.source, "D-11");
  assert.match(consular.quote, /four monthly minimum guaranty remuneration/);
  assert.ok(looselyContains(read(SOURCE_LIBRARY["D-11"].path), consular.quote));

  // 3 — BOTH ENDS OF THE MOVE, AND THEY ARE DIFFERENT SHAPES.
  const tax = view.sources.find((g) => g.finding === "UC07_TAX_RESIDENCY_REVIEW_REQUIRED");
  assert.equal(tax.bothEnds.source.shape, "no_day_count");
  assert.match(tax.bothEnds.statement, /DIFFERENT shapes/);
  assert.deepEqual(tax.citations.map((c) => c.sourceId), ["D-31", "D-32", "D-24"]);
  // The convention is cited as an instrument that EXISTS and was not read —
  // never as a statement of what its residence article says.
  const convention = tax.citations.find((c) => c.sourceId === "D-24");
  assert.equal(convention.readHere, false);
  assert.equal(convention.quote, null);
  assert.match(convention.citedFor, /NOBODY IN THIS CHAIN HAS READ IT/);

  // 4 — THE SOCIAL-SECURITY ANSWER, WHICH IS THE DEFAULT AND NOT A MAXIMUM.
  const social = view.sources.find((g) => g.finding === "social_security_on_permanent_move");
  assert.match(social.statement, /EXCEPTION for a TEMPORARY assignment/);
  assert.match(social.statement, /the state where the work is actually pursued/);
  assert.match(social.citations[0].quote, /single Member State only/);
  assert.ok(social.caveats.some((c) => c.id === "C-6"));

  // 5 — AND THE INPUT THAT DECIDES ALL OF IT, WHICH IS NOT HELD.
  assert.equal(immigration.nationality, NATIONALITY_NOT_HELD);
  const question = view.openQuestions.find((q) => q.code === "nationality_not_held");
  assert.ok(question, "an immigration citation without the nationality statement reads as this person's route");
  assert.equal(question.priority, 1);
});

test("POSITIVE: a US→CA relocation cites the regulation whose own test is about the payer, and says which way it points", async () => {
  const { result, view } = await dossierFor("US", "CA");
  assert.equal(result.decision, "escalate");

  const immigration = view.sources.find((g) => g.axis === "destination");
  assert.equal(immigration.scope, "CA");
  const irpr = immigration.routes[0];
  assert.equal(irpr.source, "D-16");
  assert.match(irpr.quote, /primary source of remuneration for the business activities is outside Canada/);
  assert.ok(looselyContains(read(SOURCE_LIBRARY["D-16"].path), irpr.quote));
  // A Canadian enactment carries its own reproduction notice, always.
  assert.match(irpr.reproductionNotice, /NOT the official version/);
  // The direction of travel is stated and the conclusion is refused.
  assert.match(irpr.whatTheSourceSays, /the destination entity becomes the payer/);
  assert.ok(irpr.silentOn.some((s) => /judgement/.test(s)));
  assert.ok(immigration.caveats.some((c) => c.id === "C-5"));
  // And the corpus's own boundary is stated rather than implied.
  assert.match(immigration.note, /no source for the work-permit route itself/);

  // The US residence test is the source end here, and it is a weighted
  // three-year computation — a different shape from Canada's sojourn rule.
  const tax = view.sources.find((g) => g.axis === "route");
  assert.equal(tax.bothEnds.source.shape, "weighted_three_year_computation");
  assert.equal(tax.bothEnds.destination.shape, "day_count_over_a_taxation_year_deeming_residence_throughout_it");
});

test("POSITIVE: a US destination cites both visitor routes, and says plainly that neither is an employment route", () => {
  const group = sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { sourceCountry: "PT", destinationCountry: "US" });
  assert.equal(group.routes.length, 2);
  assert.match(group.note, /Both routes below are VISITOR routes/);
  const b1 = group.routes.find((r) => r.key === "b1_business_visitor");
  assert.match(b1.whatTheSourceSays, /including, but not limited to/);
  assert.ok(looselyContains(read(SOURCE_LIBRARY["D-15"].path), b1.quote));
  const vwp = group.routes.find((r) => r.key === "visa_waiver_esta");
  assert.ok(looselyContains(read(SOURCE_LIBRARY["D-14"].path), vwp.quote));
  assert.ok(group.caveats.some((c) => c.id === "C-26"));
  assert.ok(group.caveats.some((c) => c.id === "C-27"));
  // The confirmation travels too — a list of only faults teaches distrust of
  // everything equally.
  assert.deepEqual(group.confirmations.map((k) => k.id), ["K-3"]);
});

// ===========================================================================
// NO NEAREST MATCH
// ===========================================================================

test("the Netherlands has no immigration instrument here and gets an explicit absence, never a neighbour's", async () => {
  // The demo set's CA→NL relocation. This is the honest half of the corpus: an
  // absence stated is a fact a specialist can act on; a nearest match is not.
  const { view } = await dossierFor("CA", "NL");
  assert.equal(view.sources.some((g) => g.axis === "destination"), false);
  assert.equal(view.basis.immigration.sources.length, 0);
  // The country is NAMED in the sentence a specialist reads; the code is still
  // what the citation map is keyed by.
  assert.match(view.basis.immigration.sentence, /no immigration instrument for Netherlands/);
  assert.ok(!/\bfor NL\b/.test(view.basis.immigration.sentence), "the destination must not be a bare alpha-2 code");
  assert.match(view.basis.immigration.sentence, /nobody has looked/);

  const absence = view.uncited.find((u) => u.finding === FLAG.IMMIGRATION_REQUIRED);
  assert.ok(absence, "the flag fired and no source exists — that must be stated, not left blank");
  assert.match(absence.why, /NL is not among them/);
  assert.match(absence.why, /Another country's visa route is not a substitute/);

  // And the nationality question is NOT raised, because nothing was cited that
  // could be misread as this person's route.
  assert.equal(view.openQuestions.some((q) => q.code === "nationality_not_held"), false);
});

test("a route or destination this corpus does not hold gets NO citation at all", () => {
  assert.equal(sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: "DE" }), null);
  assert.equal(sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: null }), null);
  assert.equal(sourcesForFinding("tax_residency_change", { sourceCountry: "DE", destinationCountry: "PT" }), null);
  assert.equal(sourcesForFinding("social_security_on_permanent_move", { sourceCountry: "NL", destinationCountry: "DE" }), null);
  assert.equal(sourcesForFinding("tax_residency_change", { sourceCountry: "NL", destinationCountry: "NL" }), null);
  assert.equal(sourcesForFinding("not_a_finding", { destinationCountry: "PT" }), null);
  // Prototype-chain lookups resolve to nothing.
  assert.equal(sourcesForFinding("constructor", { destinationCountry: "PT" }), null);
  assert.equal(sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: "constructor" }), null);
  assert.equal(uncitedFinding("constructor"), null);

  const absentRoute = uncitedFinding("social_security_on_permanent_move", { sourceCountry: "DE", destinationCountry: "PT" });
  assert.match(absentRoute.why, /DE–PT is not among them/);
  assert.match(absentRoute.why, /per pair and per vintage/);
  assert.equal(uncitedFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: "PT" }), null, "a held destination has nothing to explain");
});

test("direction of travel does not change which instrument is in force, and one country is not a route", () => {
  assert.equal(routeKey("nl", "pt"), "NL|PT");
  assert.equal(routeKey("PT", "NL"), "NL|PT");
  assert.equal(routeKey("PT", "PT"), null);
  assert.equal(routeKey(null, "PT"), null);
  // …but the block still names which end is which, because the instruments
  // mean different things at each end of a permanent move.
  const out = sourcesForFinding("tax_residency_change", { sourceCountry: "PT", destinationCountry: "NL" });
  const back = sourcesForFinding("tax_residency_change", { sourceCountry: "NL", destinationCountry: "PT" });
  assert.equal(out.scope, back.scope);
  assert.notDeepEqual(
    out.citations.map((c) => c.citedFor),
    back.citations.map((c) => c.citedFor),
    "the same two documents must be cited for opposite halves of the move"
  );
  assert.match(out.citations[0].citedFor, /SOURCE country ends/);
  assert.match(back.citations[0].citedFor, /SOURCE country ends/);
  assert.equal(out.citations[0].sourceId, "D-32");
  assert.equal(back.citations[0].sourceId, "D-31");
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
    assert.ok(doc.licence && doc.licence.length > 20, `${id} carries no licence statement`);
  }
});

test("every quotation in the module really is in the document it is attributed to", () => {
  const checked = [];
  const check = (sourceId, quote, where) => {
    if (!quote) return;
    const text = read(SOURCE_LIBRARY[sourceId].path);
    for (const fragment of String(quote).split("…")) {
      const trimmed = fragment.trim();
      if (trimmed.replace(/[^\p{L}\p{N}]/gu, "").length < 20) continue;
      assert.ok(looselyContains(text, trimmed), `${where}: ${SOURCE_LIBRARY[sourceId].path} does not contain "${trimmed.slice(0, 70)}…"`);
      checked.push(where);
    }
  };
  for (const [code, country] of Object.entries(IMMIGRATION_ROUTES)) {
    for (const route of country.routes) {
      check(route.source, route.quote, `IMMIGRATION.${code}.${route.key}.quote`);
      check(route.source, route.secondQuote, `IMMIGRATION.${code}.${route.key}.secondQuote`);
    }
  }
  for (const [key, entry] of Object.entries(SOCIAL_SECURITY_ON_RELOCATION)) {
    for (const c of entry.cite) check(c.source, c.quote, `SOCIAL.${key}.${c.source}`);
  }
  assert.ok(checked.length >= 12, `only ${checked.length} quotations were checked — the corpus should be denser than that`);
});

test("every caveat and confirmation is still a real heading in CONTRADICTIONS.md", () => {
  const contradictions = read("docs/knowledge/layer-1-statutory/CONTRADICTIONS.md");
  for (const [id, caveat] of Object.entries(CAVEAT_LIBRARY)) {
    assert.equal(caveat.id, id);
    assert.ok(existsSync(repoPath(caveat.path)));
    assert.match(contradictions, new RegExp(`^### ${caveat.section} · `, "m"), `${id} no longer exists in CONTRADICTIONS.md`);
    assert.ok(["disputed", "unsupported", "incomplete"].includes(caveat.weight), `${id}: weight must be three-valued and never numeric`);
  }
  for (const [id, k] of Object.entries(CONFIRMATION_LIBRARY)) {
    assert.equal(k.id, id);
    assert.match(contradictions, new RegExp(`^### ${k.section} · `, "m"));
  }
});

test("every registered document is cited by something, and every cited caveat is registered", () => {
  const citedDocs = new Set();
  const citedCaveats = new Set();
  for (const country of Object.values(IMMIGRATION_ROUTES)) {
    country.routes.forEach((r) => citedDocs.add(r.source));
    (country.caveats ?? []).forEach((c) => citedCaveats.add(c));
  }
  for (const entry of Object.values(SOCIAL_SECURITY_ON_RELOCATION)) {
    entry.cite.forEach((c) => citedDocs.add(c.source));
    (entry.caveats ?? []).forEach((c) => citedCaveats.add(c));
  }
  // The tax-residence documents are reached through the route lookup rather
  // than through a literal, so they are collected by driving it.
  for (const key of SOURCED_ROUTES) {
    const [a, b] = key.split("|");
    for (const c of sourcesForFinding("tax_residency_change", { sourceCountry: a, destinationCountry: b }).citations) {
      citedDocs.add(c.sourceId);
    }
    for (const c of sourcesForFinding("tax_residency_change", { sourceCountry: a, destinationCountry: b }).caveats) {
      citedCaveats.add(c.id);
    }
  }
  for (const id of citedCaveats) assert.ok(CAVEAT_LIBRARY[id], `an entry cites unknown caveat ${id}`);
  for (const id of Object.keys(SOURCE_LIBRARY)) {
    assert.ok(citedDocs.has(id), `${id} is in the library and no finding cites it`);
  }
});

// ===========================================================================
// IT MUST NOT DECIDE, MUST NOT RANK, AND MUST NOT CARRY A NUMBER
// ===========================================================================

test("no citation carries a score, a rank or a similarity figure — and `matchedOn` names the mechanism", () => {
  const groups = [
    sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: "PT" }),
    sourcesForFinding("UC07_RIGHT_TO_WORK_MISSING", { destinationCountry: "CA" }),
    sourcesForFinding("tax_residency_change", { sourceCountry: "CA", destinationCountry: "US" }),
    sourcesForFinding("social_security_on_permanent_move", { sourceCountry: "CA", destinationCountry: "PT" }),
  ];
  for (const group of groups) {
    assert.equal(group.method, RETRIEVAL_METHOD);
    for (const citation of group.citations) {
      assert.match(citation.matchedOn, /hand-curated map entry/);
      assert.ok(!/\d+(\.\d+)?\s*%|similarity|confidence|\brank(ed)?\b|\bscore\b/i.test(citation.matchedOn));
    }
  }
  assert.match(RETRIEVAL_METHOD, /no search, no ranking and no similarity score/);
  assert.match(SOURCE_FRAMING, /never whether this relocation may proceed/);

  // KEYS, not prose — the framing sentences contain the words they promise not
  // to act on. What must not exist is a FIELD a renderer could sort or read a
  // verdict out of.
  const keys = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (v && typeof v === "object") for (const [k, inner] of Object.entries(v)) { keys.add(k); collect(inner); }
  };
  groups.forEach(collect);
  for (const forbidden of ["score", "confidence", "rank", "ranking", "similarity", "recommended", "recommendation", "preferred", "advice", "verdict", "severity"]) {
    assert.ok(!keys.has(forbidden), `a citation block carries a "${forbidden}" field`);
  }
});

test("a number may be QUOTED and may never be CARRIED", () => {
  const numeric = [];
  const scan = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => scan(x, `${path}.${k}`));
    if (typeof v === "number") numeric.push(`${path} = ${v}`);
  };
  for (const destination of SOURCED_DESTINATIONS) {
    scan(sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: destination }), `immigration.${destination}`);
    scan(sourcesForFinding("UC07_SALARY_BELOW_VISA_MINIMUM", { destinationCountry: destination }), `salary.${destination}`);
  }
  for (const key of SOURCED_ROUTES) {
    const [a, b] = key.split("|");
    scan(sourcesForFinding("tax_residency_change", { sourceCountry: a, destinationCountry: b }), `tax.${key}`);
    scan(sourcesForFinding("social_security_on_permanent_move", { sourceCountry: a, destinationCountry: b }), `social.${key}`);
  }
  assert.deepEqual(numeric, [], "a number reached a citation block as a value");
});

test("no gate consults the citations, and no citation id appears in a conditional", () => {
  for (const file of readdirSync(repoPath("src/uc07"))) {
    if (!file.endsWith(".js") || file === "decisionSources.js" || file === "dossierView.js") continue;
    const imports = read(`src/uc07/${file}`)
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import ") && /decisionSources/.test(l));
    assert.deepEqual(imports, [], `src/uc07/${file} imports decisionSources — a citation must never reach a decision`);
  }
  for (const file of ["src/uc07/decisionSources.js", "src/uc07/dossierView.js", "src/uc07/transitionGate.js"]) {
    const text = read(file).replace(/^\s*(\/\/.*|\*.*)$/gm, "");
    assert.ok(!/(if|while|switch)\s*\([^)]*["'](C|D|K)-\d+["']/.test(text), `${file} branches on a citation id`);
  }
  const source = read("src/uc07/decisionSources.js");
  assert.deepEqual(
    source.split("\n").filter((l) => l.trimStart().startsWith("import ")),
    [],
    "decisionSources.js imports something — it is frozen data and must stay that way"
  );
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of ["RemoteClient", "ZendeskClient", "pgPool", "fetch(", "post(", "patch("]) {
    assert.ok(!code.includes(forbidden), `decisionSources.js references ${forbidden} — UC-07 has no execution path`);
  }
});

// ===========================================================================
// THE ABSENCES, SAID OUT LOUD
// ===========================================================================

test("every flag transitionGate can raise is either cited or explicitly recorded as uncitable", () => {
  // THE GAP THIS CATCHES: a flag added later with no entry in either map would
  // reach a specialist with a silent blank where a source or a stated absence
  // belongs, and a blank reads as "nothing to say" rather than "nothing to
  // cite".
  const unaccounted = Object.values(FLAG).filter(
    (code) => !Object.hasOwn(FINDING_SOURCES, code) && !Object.hasOwn(UNCITED_FINDINGS, code)
  );
  assert.deepEqual(unaccounted, [], "these flags have neither a citation entry nor a recorded absence");
});

test("the sequencing rule with the most weight in the dossier is the one with no source, and says so", () => {
  const offboarding = uncitedFinding(FLAG.SOURCE_OFFBOARDING_NOT_AUTHORIZED);
  assert.match(offboarding.why, /not from any authority/);
  assert.match(offboarding.why, /strongest thing in the dossier/);
  // And the PE flag, which is the one most likely to be escalated onward.
  const pe = uncitedFinding(FLAG.PE_RISK_REVIEW_REQUIRED);
  assert.match(pe.why, /paraphras/i);
  assert.match(pe.why, /never copying|never copied/);
  assert.match(pe.why, /has NOT read|were not retrieved/);
  for (const [key, entry] of Object.entries(UNCITED_FINDINGS)) {
    assert.ok(uncitedFinding(key).why.length > 60, `${key}'s reason must actually say something`);
    assert.ok(entry.label.length > 10);
  }
});

test("the OECD material is refused for a LICENCE reason, and no excluded source is ever cited", () => {
  const source = read("src/uc07/decisionSources.js");
  for (const id of Object.keys(SOURCE_LIBRARY)) {
    assert.ok(!/oecd/i.test(SOURCE_LIBRARY[id].publisher), `${id} is attributed to the OECD`);
  }
  // The DATA, not the prose: the header names the excluded sources in the
  // sentence that excludes them.
  const code = source.replace(/^\s*(\/\/.*)$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const excluded of ["IBFD", "Bloomberg Tax", "Vialto", "support.remote.com"]) {
    assert.ok(!code.includes(excluded), `${excluded} is excluded entirely and is cited in the module`);
  }
});

test("the nationality gap is stated on every dossier that cites an immigration route, and cannot be conditioned away", () => {
  // There is no nationality field to condition on — that is the whole point, and
  // this is the assertion that keeps somebody from adding a condition later.
  assert.equal(NATIONALITY_NOT_HELD.assessed, false);
  assert.match(NATIONALITY_NOT_HELD.statement, /NEVER as a statement about this person's route/);
  assert.match(NATIONALITY_NOT_HELD.whyItIsStatedEveryTime, /cannot detect whom it applies to/);
  for (const destination of SOURCED_DESTINATIONS) {
    const group = sourcesForFinding("UC07_IMMIGRATION_REQUIRED", { destinationCountry: destination });
    assert.equal(group.nationality, NATIONALITY_NOT_HELD, `${destination}: an immigration citation without the nationality statement`);
  }
  // And the source of truth for the absence is the code, not a comment. The two
  // citation modules are excluded because they are where the absence is STATED
  // — the scan is for an INPUT appearing on the request or a gate, which is the
  // event that would make NATIONALITY_NOT_HELD stale.
  for (const file of readdirSync(repoPath("src/uc07"))) {
    if (!file.endsWith(".js") || file === "decisionSources.js" || file === "dossierView.js") continue;
    const code = read(`src/uc07/${file}`).replace(/^\s*(\/\/.*|\*.*)$/gm, "");
    assert.ok(
      !/\b(nationality|citizenship|passport)\b/i.test(code),
      `src/uc07/${file} now carries a nationality field — NATIONALITY_NOT_HELD must be revisited, not left standing`
    );
  }
});

test("the Portuguese income floor is cited to the body that publishes it, never to the article that has no figure", () => {
  // C-17, enforced. `UC07_SALARY_BELOW_VISA_MINIMUM` resolves to the consular
  // pages ALONE — citing art. 61.º-B for a euro figure would cite a provision
  // that does not contain one, which is the exact failure rule 5 names.
  const salary = sourcesForFinding("UC07_SALARY_BELOW_VISA_MINIMUM", { destinationCountry: "PT" });
  assert.deepEqual(salary.citations.map((c) => c.sourceId), ["D-11"]);
  assert.ok(salary.caveats.some((c) => c.id === "C-17"));
  // No other destination in the corpus publishes a visa salary minimum, so the
  // finding resolves to nothing there rather than to the nearest document.
  assert.equal(sourcesForFinding("UC07_SALARY_BELOW_VISA_MINIMUM", { destinationCountry: "CA" }), null);
  assert.equal(sourcesForFinding("UC07_SALARY_BELOW_VISA_MINIMUM", { destinationCountry: "US" }), null);
  assert.match(uncitedFinding("UC07_SALARY_BELOW_VISA_MINIMUM", { destinationCountry: "DE" }).why, /never looked/);
});

test("the two inherent findings are cited on every routed dossier, flag or no flag", async () => {
  // A permanent relocation always crosses a tax boundary and always moves a
  // social-security membership. Neither is a flag because there is nothing to
  // flag — they are what the move IS — so neither may depend on a gate firing.
  const { view } = await dossierFor("PT", "CA", {
    immigrationSupportRequired: false,
    immigrationConfirmed: true,
    rightToWorkConfirmed: true,
    employerPresenceInDestination: true,
    taxTreatyNexusConfirmed: true,
    ptoTransferAllowed: true,
  });
  const findings = view.sources.map((g) => g.finding);
  assert.ok(findings.includes("tax_residency_change"), "tax residence must be cited even with no tax flag raised");
  assert.ok(findings.includes("social_security_on_permanent_move"));
  assert.ok(view.sources.find((g) => g.finding === "social_security_on_permanent_move").confirmations.some((k) => k.id === "K-4"));
});

test("the dossier still escalates and still writes nowhere, with citations attached", async () => {
  for (const [from, to] of [["NL", "PT"], ["CA", "NL"], ["US", "CA"], ["ZZ", "YY"]]) {
    const { result, view } = await dossierFor(from, to);
    assert.equal(result.decision, "escalate");
    assert.ok(Array.isArray(view.sources));
    assert.ok(Array.isArray(view.uncited));
  }
  // An unknown route resolves to nothing and says so, rather than to whatever
  // is nearest.
  const { view } = await dossierFor("ZZ", "YY");
  assert.deepEqual(view.sources, []);
  assert.match(view.basis.taxResidence.sentence, /not covered on both ends/);
});

test("every finding in the map is a real flag or one of the two inherent findings", () => {
  const flagCodes = new Set(Object.values(FLAG));
  const inherent = new Set(["tax_residency_change", "social_security_on_permanent_move"]);
  for (const key of Object.keys(FINDING_SOURCES)) {
    assert.ok(flagCodes.has(key) || inherent.has(key), `${key} is cited and no gate or relocation state produces it`);
  }
  for (const entry of Object.values(FINDING_SOURCES)) {
    assert.ok(["destination", "route"].includes(entry.axis));
    assert.ok(entry.question.endsWith("?"), "every finding states the question its reader is actually asking");
  }
  assert.deepEqual(Object.keys(IMMIGRATION_ROUTES).sort(), [...SOURCED_DESTINATIONS].sort());
  assert.deepEqual(Object.keys(SOCIAL_SECURITY_ON_RELOCATION).sort(), [...SOURCED_ROUTES].sort());
});
