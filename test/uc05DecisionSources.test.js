// ---------------------------------------------------------------------------
// uc05DecisionSources.test.js
//   Two questions asked of one real escalation: WHO decides this, and WHAT do
//   they decide it from?
// ---------------------------------------------------------------------------
// THE CASE THIS FILE IS BUILT AROUND is the one the owner was looking at: a
// Portuguese employee with 85 months' service proposing a last working day 23
// days inside the statutory 60. It escalated, correctly, and the two things a
// person receiving it needed were both absent:
//
//   1. WHO. The panel said "Local HR Legal decides how the shortfall is
//      handled". `src/shared/escalationRouting.js` sent the ticket to HR Ops,
//      and no team called Local HR Legal existed in the routing table, in the
//      Zendesk groups, or in the setup script. Two sources of truth for one
//      fact, already drifted. Every such sentence is now BUILT from the routing
//      table, and the last test in this file asserts that no second copy of the
//      name can reappear anywhere under src/.
//
//   2. WHAT FROM. "23 days SHORT" is arithmetic and decides nothing. Código do
//      Trabalho art. 401.º — vendored as D-02 on 2026-08-19 — states what an
//      employee who does not serve the notice owes and how it is measured, and
//      art. 400.º(6) states who owes nothing at all. The system held the
//      document and never showed it.
//
// WHAT THIS FILE WILL NOT LET THROUGH, in descending order of how much it would
// cost:
//   * A CITATION THAT RESOLVES TO NOTHING. Every `path` is asserted to exist on
//     disk and to still carry its catalogue id; every caveat is asserted to
//     still be a heading in CONTRADICTIONS.md. A renamed document must break a
//     test, never become authority-shaped text linking nowhere.
//   * A NEAREST MATCH. Eight of the nine countries in the notice table have no
//     statute in this corpus. They must get NO citation and an explicit "we
//     hold nothing for this country" — not Portugal's articles wearing a
//     different flag.
//   * A RECOMMENDATION. The handlings are presented unranked and unscored, and
//     no amount of money is computed from any statute anywhere.
//
// Hermetic and pure: every function under test is a lookup over frozen data,
// and the fixtures come from the REAL policy engine rather than hand-built
// notice objects — the fixtures-agree-with-the-code failure this project keeps
// paying for.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluate as evaluateUc05, describeDecidingGate, GATE_SEQUENCE } from "../src/uc05/policyEngine.js";
import { describeSignoffBasis } from "../src/uc05/decisionFacts.js";
import {
  SOURCE_LIBRARY,
  CAVEAT_LIBRARY,
  FINDING_SOURCES,
  UNCITED_FINDINGS,
  SHORTFALL_HANDLINGS,
  SOURCED_COUNTRIES,
  sourcesForFinding,
  uncitedFinding,
  shortfallHandlings,
  SOURCE_FRAMING,
  HANDLING_FRAMING,
} from "../src/uc05/decisionSources.js";
import { handoffFor, escalationTeamFor, ESCALATION_GROUPS } from "../src/shared/escalationRouting.js";
import { NOTICE_PERIOD_TABLE } from "../src/uc05/noticePeriodTable.js";

const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative) => readFileSync(repoPath(relative), "utf8");

// ---------------------------------------------------------------------------
// The fixture — the owner's actual case, through the real gates
// ---------------------------------------------------------------------------
// 2019-06-25 start against a 2026-07-25 submission is 85 months. PT's second
// bracket gives 60 days, so the statutory end is 2026-09-23 and the proposed
// 2026-08-31 is 23 days short. Nothing here is asserted from a hand-written
// `notice` object: if the calculator changes, this fixture changes with it and
// the assertions below say so instead of agreeing with themselves.
// ---------------------------------------------------------------------------

const PT_EMPLOYMENT = { status: "active", country_code: "PT", start_date: "2019-06-25", company_id: "co_pt_01" };

function ptShortfall({ proposedEndDate = "2026-08-31", now = "2026-07-25", employment = PT_EMPLOYMENT } = {}) {
  const result = evaluateUc05({
    identityVerified: true,
    employment,
    proposedEndDate,
    timeOffBalances: [],
    currency: "EUR",
    now,
  });
  return {
    result,
    row: {
      notice: result.notice,
      payout: result.payout,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
    },
  };
}

// ===========================================================================
// THE TEST THAT MATTERS
// ===========================================================================

test("POSITIVE: PT, 85 months, 23 days short — escalates to a team the routing table names, carrying art. 401.º", () => {
  const { result, row } = ptShortfall();

  // The decision, the gates and the outcome are unchanged by any of this work.
  assert.equal(result.decision, "escalate");
  assert.equal(result.reason, "statutory_discrepancy");
  assert.equal(result.notice.countryCode, "PT");
  assert.equal(result.notice.tenureMonths, 85, "the fixture must be the 85-month case or it proves something else");
  assert.equal(result.notice.noticeDays, 60);
  assert.equal(result.notice.noticeEndDate, "2026-09-23");
  assert.equal(result.notice.discrepancyDays, -23);

  // 1 — WHO. A named team, and one that exists in the routing table rather than
  // only in a sentence.
  const handoff = handoffFor({ useCase: "UC-05", decision: result.decision });
  assert.equal(handoff.escalated, true);
  assert.equal(handoff.group, "Local HR & Legal");
  assert.ok(ESCALATION_GROUPS.includes(handoff.group), "the escalation team must be one the setup script provisions");

  const basis = describeSignoffBasis({ resignationRow: row });
  assert.ok(
    basis.discrepancy.sentence.includes(handoff.group),
    `the screen names a different team from the routing: "${basis.discrepancy.sentence}"`
  );

  // 2 — WHAT FROM. The article that speaks to a shortfall, on the case.
  const cited = basis.discrepancy.sources;
  assert.equal(cited.length, 1);
  assert.equal(cited[0].finding, "statutory_discrepancy");
  assert.equal(cited[0].country, "PT");
  assert.deepEqual(
    cited[0].citations.map((c) => c.sourceId),
    ["D-02"]
  );
  assert.match(cited[0].citations[0].locator, /401/, "art. 401.º is the article that answers 'and then what'");
  assert.ok(existsSync(repoPath(cited[0].citations[0].path)), "the citation links to a file that is not there");

  // And the caveats a person weighing it has to know: the statutory waiver
  // this system cannot see, and the bracket boundary.
  assert.deepEqual(
    cited[0].caveats.map((c) => c.id),
    ["C-19", "C-18"]
  );

  // 3 — the handlings, which is what "how is the shortfall handled" means.
  const handling = basis.discrepancy.handling;
  assert.equal(handling.country, "PT");
  assert.deepEqual(
    handling.options.map((o) => o.key),
    ["serve_full_notice", "indemnity_for_missing_period", "employer_accepts_earlier_date", "agreed_alternative_date"]
  );
  const indemnity = handling.options.find((o) => o.key === "indemnity_for_missing_period");
  assert.equal(indemnity.state, "stated_in_source");
  // The statute's own words, because the measure is the decision-relevant part:
  // base retribution and diuturnidades for the period NOT served.
  assert.match(indemnity.quote, /retribuição base e diuturnidades/);
  assert.match(indemnity.quote, /período em falta/);
  assert.match(indemnity.whatTheSourceSays, /does not estimate/);

  // The exemption is carried and is NOT one of the options — if it applies,
  // there is no shortfall to handle.
  assert.match(handling.exemption.quote, /vítima de violência doméstica/);
  assert.ok(!handling.options.some((o) => o.key === handling.exemption.key));
});

test("the same case says out loud that no money figure for the shortfall exists anywhere", () => {
  // The report carries a PTO payout. A reader who sees money beside "23 days
  // SHORT" will assume the money accounts for the shortfall. It does not, and
  // art. 401.º measures its indemnity on a different base entirely.
  const { row } = ptShortfall();
  const unknown = describeSignoffBasis({ resignationRow: row }).unknowns.find((u) =>
    /shortfall costs/i.test(u.what)
  );
  assert.ok(unknown, "a shortfall with no cost figure must be listed as an unknown, not left blank");
  assert.match(unknown.why, /does not include one/);
  assert.match(unknown.whatItWouldTake, /not a gap to close in code/);
});

// ===========================================================================
// THE MISMATCH THAT WAS FIXED MUST NOT BE ABLE TO COME BACK
// ===========================================================================

test("the team named on the screen and in the gate ladder IS the routed group, derived and never typed", () => {
  const routed = escalationTeamFor("UC-05");
  assert.equal(routed, handoffFor({ useCase: "UC-05", decision: "escalate" }).group);

  // The gate ladder's own words for the deciding rung.
  const rung = describeDecidingGate("statutory_discrepancy");
  assert.ok(rung.means.includes(routed), `the gate ladder names a team the routing does not: "${rung.means}"`);

  // And the panel's sentence.
  const { row } = ptShortfall();
  assert.ok(describeSignoffBasis({ resignationRow: row }).discrepancy.sentence.includes(routed));

  // NOT A COINCIDENCE OF TWO MATCHING LITERALS. The name appears in exactly one
  // file under src/ — the routing table itself. Anywhere else is a second
  // source of truth for a fact that module owns, which is precisely how "Local
  // HR Legal" survived in five places while the tickets went to HR Ops.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(repoPath(dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (
        entry.name.endsWith(".js") &&
        rel !== "src/shared/escalationRouting.js" &&
        // GENERATED, AND NOT A RIVAL SOURCE OF TRUTH. escalationGroupIds.js is
        // a name -> Zendesk group id map regenerated from the live account by
        // `npm run sync-groups`. It has to spell the group's name because that
        // is the key it looks up by, but it never decides WHICH team owns a
        // decision — it only answers "does this account have a group by that
        // name, and what is its id". Deleting the name from it is impossible;
        // exempting it silently would be worse, so the exemption is stated.
        //
        // It first tripped this test on 2026-08-20, the day `Local HR & Legal`
        // was actually created in the account: until then the group did not
        // exist, so the generated map had no row for it and the test passed by
        // accident of the hole it was written about.
        rel !== "src/shared/escalationGroupIds.js"
      ) {
        // The comment in escalationRouting.js's own header is allowed to quote
        // the old wording; nothing else may carry the team name at all.
        const text = read(rel).replace(/^\s*(\/\/.*|\*.*)$/gm, "");
        if (text.includes(routed)) offenders.push(rel);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, [], `these files hard-code the team name instead of reading it from the routing table`);
});

test("a derived team name can never reach the reader as `undefined`", () => {
  // The failure mode the derivation must not introduce: "undefined decides how
  // the shortfall is handled". Asserted against the ladder's actual text and
  // the panel's. (`null` is deliberately NOT in this check — the PTO rung
  // quotes the literal word to explain what a null total would wrongly imply,
  // which is the opposite of a value leaking.)
  for (const rung of GATE_SEQUENCE) {
    assert.ok(!/\bundefined\b/.test(rung.means), `${rung.reason}: a missing value reached the reader`);
  }
  const { row } = ptShortfall();
  const basis = describeSignoffBasis({ resignationRow: row });
  assert.ok(!/undefined/.test(JSON.stringify(basis)));
  // And the deciding rung really does carry a team name, not an empty slot.
  assert.match(describeDecidingGate("statutory_discrepancy").means, /\S+ has to decide how the shortfall is handled/);
});

// ===========================================================================
// THE LINKS, AND THE CAVEATS
// ===========================================================================

test("every document cited exists on disk and still carries its catalogue id", () => {
  for (const [id, doc] of Object.entries(SOURCE_LIBRARY)) {
    assert.equal(doc.id, id);
    assert.ok(existsSync(repoPath(doc.path)), `${id} links to ${doc.path}, which does not exist on disk`);
    const text = read(doc.path);
    assert.ok(text.startsWith(`# ${id} ·`), `${doc.path} no longer opens with the catalogue id ${id}`);
    // The evidence tag is the document's own, not a claim invented here.
    assert.ok(text.includes("[CONFIRMED"), `${id} is cited as confirmed and its sidecar does not say so`);
    if (doc.bytes) assert.ok(existsSync(repoPath(doc.bytes)), `${id} claims bytes at ${doc.bytes}, which are not there`);
  }
});

test("every caveat is still a real heading in CONTRADICTIONS.md", () => {
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
    // invented precision this whole discipline exists to refuse.
    assert.ok(["disputed", "unsupported", "incomplete"].includes(caveat.weight));
  }
});

test("the D-02 sidecar really does contain the article each locator names", () => {
  // Guards against the one failure a path check cannot see: a live link to the
  // right document, cited for something it does not say.
  const d02 = read(SOURCE_LIBRARY["D-02"].path);
  assert.match(d02, /Artigo 400\.º/);
  assert.match(d02, /Artigo 401\.º/);
  // The sidecar wraps and bolds the quoted statute, so match on the words with
  // markdown and line breaks allowed between them rather than on one run of
  // text — the point is that the article is there, not how it is typeset.
  const loose = (phrase) => new RegExp(phrase.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s*>_]+"));
  assert.match(d02, loose("indemnização de valor igual à retribuição base e diuturnidades"));
  assert.match(d02, loose("dispensado do cumprimento do aviso prévio"));
  assert.match(d02, /30 ou 60 dias/);

  const d03 = read(SOURCE_LIBRARY["D-03"].path);
  assert.match(d03, /Artigo 114\.º/);
  assert.match(d03, /Artigo 112\.º/);
});

test("the 60 days this case applied is the article's own figure, and the boundary C-18 disputes is nowhere near it", () => {
  // The prompt's own instruction: 85 months is comfortably past the two-year
  // split either way, so the off-by-one C-18 records cannot be what produced
  // this shortfall. Worth pinning — the caveat travels with the case and a
  // reader must not be able to mistake it for the cause.
  const { result } = ptShortfall();
  assert.equal(result.notice.noticeDays, 60);
  const brackets = NOTICE_PERIOD_TABLE.PT.brackets;
  assert.deepEqual(
    brackets.map((b) => b.noticeDays),
    [30, 60],
    "art. 400.º(1) sets 30 and 60; a third figure here would need its own source"
  );
  assert.ok(result.notice.tenureMonths > 24, "the disputed boundary is 24 months and this case is not near it");
});

// ===========================================================================
// NO NEAREST MATCH — THE EIGHT COUNTRIES WITH NO STATUTE
// ===========================================================================

test("a country whose notice statute this corpus does not hold gets NO citation, and is told so", () => {
  // GB is the fixture the rest of the UC-05 suite uses, and it is the honest
  // case: the Employment Rights Act is not in docs/knowledge/.
  assert.equal(sourcesForFinding("statutory_discrepancy", "GB"), null);
  assert.equal(sourcesForFinding("statutory_notice_rule", "IE"), null);
  assert.equal(sourcesForFinding("statutory_discrepancy", null), null);
  assert.equal(sourcesForFinding("a_finding_that_does_not_exist", "PT"), null);
  // Prototype-chain lookups must not resolve to a "finding".
  assert.equal(sourcesForFinding("constructor", "PT"), null);
  assert.equal(uncitedFinding("constructor", "PT"), null);

  const absent = uncitedFinding("statutory_notice_rule", "GB");
  assert.match(absent.why, /No source/);
  assert.match(absent.why, /GB is not among them/);
  assert.match(absent.why, /noticePeriodTable\.js/, "the reader must be told what the number DOES rest on");
  assert.match(absent.why, /not a finding that the number is wrong/);

  // And the handlings are refused for the same reason — an option list under an
  // unread jurisdiction is a nearest match in disguise.
  assert.equal(shortfallHandlings("GB"), null);
  assert.equal(shortfallHandlings(null), null);
});

test("a GB shortfall reaches the same team with no citation attached, and says why", () => {
  const gb = evaluateUc05({
    identityVerified: true,
    employment: { status: "active", country_code: "GB", start_date: "2019-06-25" },
    proposedEndDate: "2026-08-01",
    timeOffBalances: [],
    currency: "GBP",
    now: "2026-07-25",
  });
  assert.equal(gb.reason, "statutory_discrepancy");

  const basis = describeSignoffBasis({
    resignationRow: { notice: gb.notice, payout: gb.payout, decision: gb.decision, reason: gb.reason, flags: gb.flags },
  });
  assert.deepEqual(basis.discrepancy.sources, []);
  assert.equal(basis.discrepancy.handling, null);
  assert.deepEqual(basis.discrepancy.fields, []);
  assert.equal(basis.discrepancy.uncited.length, 1);
  assert.match(basis.discrepancy.uncited[0].why, /GB is not among them/);
  // The team is still named — routing does not depend on holding a statute.
  assert.ok(basis.discrepancy.sentence.includes(escalationTeamFor("UC-05")));
  // And the unknown says the absence is about the source, not about the law.
  const unknown = basis.unknowns.find((u) => /shortfall costs/i.test(u.what));
  assert.match(unknown.why, /not something this repository holds a source for/);
});

test("the eight uncitable findings are recorded as uncitable rather than left blank", () => {
  for (const [key, entry] of Object.entries(UNCITED_FINDINGS)) {
    const out = uncitedFinding(key, "PT");
    assert.equal(out.finding, key);
    assert.equal(out.label, entry.label);
    assert.ok(out.why.length > 40, `${key}'s reason must actually say something`);
  }
  // The two shapes of absence are different facts and must not be conflated.
  // The phrase pinned here used to be "this system's own nine-country table".
  // The table stopped being nine countries on 2026-08-20 (NL and US were added),
  // so the count was dropped from the assertion rather than kept and quietly
  // falsified in a string a human reads. What the assertion is actually FOR is
  // unchanged and is what remains pinned: this finding must describe OUR
  // coverage, never the country's law — the distinction the whole gate ladder
  // was rebuilt around, now that `no_statutory_notice_period` sits beside it.
  assert.match(uncitedFinding("unsupported_country", "BR").why, /coverage of this system's own table/);
  assert.match(uncitedFinding("unsupported_country", "BR").why, /not about the country's law/);
  assert.match(uncitedFinding("identity_not_verified", "PT").why, /this system's own access rule/);
});

// ===========================================================================
// IT MUST NOT DECIDE, AND MUST NOT COMPUTE
// ===========================================================================

test("the handlings are unranked, unscored, and carry no recommendation", () => {
  const handling = shortfallHandlings("PT");
  assert.match(HANDLING_FRAMING, /no order of preference/);
  assert.match(SOURCE_FRAMING, /never what to decide about this resignation/);

  // KEYS, not prose. The framing sentence says the word "recommends" — in the
  // sentence that promises the block does not do it — so a text scan would
  // fail on the very statement that makes the guarantee. What must not exist is
  // a FIELD a renderer could sort, colour or read a verdict out of.
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
  collect(handling);
  for (const forbidden of ["recommended", "recommendation", "preferred", "score", "confidence", "rank", "ranking", "order", "weight", "bestOption", "advice"]) {
    assert.ok(!keys.has(forbidden), `the handling block carries a "${forbidden}" field`);
  }
  // And no number anywhere in it — a figure in an option list is read as a
  // computed answer whatever it is labelled.
  const numeric = [];
  const scan = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => scan(x, `${path}[${i}]`));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => scan(x, `${path}.${k}`));
    if (typeof v === "number") numeric.push(path);
  };
  scan(handling, "handling");
  assert.deepEqual(numeric, [], "a number reached the handling block");
  for (const option of handling.options) {
    assert.ok(["stated_in_source", "source_silent"].includes(option.state));
    assert.equal(typeof option.locator, "string");
    assert.ok(option.document.path);
  }
  // "Silent" is the honest middle: neither permitted nor forbidden by what we
  // read. Both of those readings would be conclusions this repo cannot reach.
  const waiver = handling.options.find((o) => o.key === "employer_accepts_earlier_date");
  assert.equal(waiver.state, "source_silent");
  assert.match(waiver.whatTheSourceSays, /not as it permitting or forbidding/);
  assert.equal(waiver.quote, null, "a silence must not be quoted as if the article said something");
});

test("no money is computed from a statute anywhere in the module", () => {
  const source = read("src/uc05/decisionSources.js");
  // The indemnity is measured by "the base retribution and diuturnidades for
  // the missing period". That measure is QUOTED and never applied: no
  // arithmetic operator touches a day count or a rate in this file.
  assert.ok(!/formatMoney|InRemoteInteger|\*\s*100|\/\s*100/.test(source), "decisionSources.js touches money");
  assert.ok(!/\bfunction\s+\w*[Cc]alculate/.test(source));
  // And it imports nothing at all — frozen data plus three lookups.
  const imports = source.split("\n").filter((l) => l.trimStart().startsWith("import "));
  assert.deepEqual(imports, [], "decisionSources.js imports something — it is frozen data and must stay that way");
});

test("no gate consults the citations, and no citation id appears in a conditional", () => {
  // docs/knowledge/README.md's structural rule, asserted for UC-05 as it is for
  // UC-04: a citation enters a description, is rendered to a human, and goes
  // nowhere else. A source that could change an outcome is not a source.
  for (const file of ["src/uc05/policyEngine.js", "src/uc05/workflow.js", "src/uc05/noticePeriodCalculator.js", "src/uc05/signoffPolicy.js"]) {
    const reads = read(file)
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import ") && /decisionSources/.test(l));
    assert.deepEqual(reads, [], `${file} imports decisionSources — a citation must never be able to change an outcome`);
  }
  for (const file of ["src/uc05/decisionSources.js", "src/uc05/decisionFacts.js", "src/uc05/policyEngine.js"]) {
    const text = read(file).replace(/^\s*(\/\/.*|\*.*)$/gm, "");
    assert.ok(
      !/(if|while|switch)\s*\([^)]*["'](C|D|K)-\d+["']/.test(text),
      `${file} branches on a citation id`
    );
  }
});

test("every finding in the map is reachable from a real UC-05 outcome, and every country in it is in the notice table", () => {
  // A map entry for a finding no decision produces is a citation nobody will
  // ever see, and reads as coverage this file does not have.
  const reasons = new Set(GATE_SEQUENCE.map((g) => g.reason));
  const derived = new Set(["statutory_notice_rule", "notice_during_probation"]);
  for (const key of Object.keys(FINDING_SOURCES)) {
    assert.ok(reasons.has(key) || derived.has(key), `${key} is cited and no gate or notice state produces it`);
  }
  for (const entry of Object.values(FINDING_SOURCES)) {
    for (const country of Object.keys(entry.byCountry)) {
      assert.ok(NOTICE_PERIOD_TABLE[country], `${country} is cited and is not in the notice table`);
      assert.ok(SOURCED_COUNTRIES.includes(country));
    }
  }
  for (const country of Object.keys(SHORTFALL_HANDLINGS)) {
    assert.ok(NOTICE_PERIOD_TABLE[country], `${country} has handlings and is not in the notice table`);
  }
});

test("a probation case cites who actually owes notice during probation, with the repealed-figure caveat", () => {
  // C-20: the table's PT probation row is the EMPLOYER's 15 days, a number
  // repealed in 2023, modelled as one flat period where the statute is a step.
  // A reader must meet that where the number is shown, not in a document.
  const { row } = ptShortfall({
    employment: { ...PT_EMPLOYMENT, start_date: "2026-06-01", probation_end_date: "2026-09-30" },
    proposedEndDate: "2026-07-30",
  });
  const notice = describeSignoffBasis({ resignationRow: row }).notice;
  assert.equal(notice.onProbation, true);
  const probation = notice.sources.find((s) => s.finding === "notice_during_probation");
  assert.ok(probation, "a probation notice figure reached the reader with nothing said about art. 114.º");
  assert.deepEqual(
    probation.citations.map((c) => c.sourceId),
    ["D-03"]
  );
  assert.deepEqual(
    probation.caveats.map((c) => c.id),
    ["C-20", "C-21"]
  );
  assert.match(probation.caveats[0].headline, /EMPLOYER/);
});

test("`matchedOn` names the mechanism and never a score", () => {
  for (const entry of Object.values(FINDING_SOURCES)) {
    for (const country of Object.keys(entry.byCountry)) {
      for (const citation of sourcesForFinding(Object.keys(FINDING_SOURCES).find((k) => FINDING_SOURCES[k] === entry), country).citations) {
        assert.match(citation.matchedOn, /hand-curated map entry/);
        assert.ok(!/\d+(\.\d+)?%|similarity|score|rank/i.test(citation.matchedOn));
      }
    }
  }
});
