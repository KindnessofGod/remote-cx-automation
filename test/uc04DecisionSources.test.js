// ---------------------------------------------------------------------------
// uc04DecisionSources.test.js
//   Does the approver get the SOURCE behind each finding — and a link that
//   still resolves?
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR
//
// `mediumTierDecisionFacts.test.js` proves the specialist gets the figures a
// decision was made from. This file proves the next thing along: that where a
// check turns on a rule this repository now holds a document for, the document
// is named, linked, and — the part with teeth — STILL THERE.
//
// THE LINK TEST IS THE LOAD-BEARING ONE. A citation whose file has been renamed
// is worse than no citation: it reads as authority and resolves to nothing, and
// nothing else in this repository would catch it, because a dead path throws no
// error and fails no other assertion. Every `path` and every `bytes` value in
// the map is asserted to exist on disk, and every caveat is asserted to still
// be a heading in CONTRADICTIONS.md, so a renumbered contradiction breaks a
// test rather than becoming a caveat citing a section nobody can find.
//
// THE SECOND HALF IS THE OPPOSITE DISCIPLINE, and it is why the map is
// hand-curated: a finding this corpus cannot support must say so. The single
// most escalation-forcing flag UC-04 raises (`pe_risk_dape`) has no source
// here at all, because the material that governs it is OECD and may not be
// copied. That is asserted positively — the absence is a finding, not a gap in
// the tests.
//
// Hermetic and pure: every function under test is a lookup over frozen data.
// No LLM seam exists in either module, which is itself asserted.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describeDecisionBasis, describeRequester } from "../src/uc04/decisionFacts.js";
import {
  SOURCE_LIBRARY,
  CAVEAT_LIBRARY,
  CONFIRMATION_LIBRARY,
  FINDING_SOURCES,
  UNCITED_FINDINGS,
  sourcesForFinding,
  uncitedFinding,
  SOURCE_FRAMING,
} from "../src/uc04/decisionSources.js";
import { evaluate as evaluateUc04 } from "../src/uc04/policyEngine.js";
import { SCHENGEN, DNV_COUNTRIES } from "../src/uc04/riskMatrix.js";

const repoPath = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

// ---------------------------------------------------------------------------
// Fixtures — the REAL policy engine, never a hand-built risk object
// ---------------------------------------------------------------------------
// Same rule as mediumTierDecisionFacts.test.js: a hand-written `risk` lets this
// file agree with itself while disagreeing with the matrix, which is the
// fixtures-agree-with-the-code failure this project keeps paying for.
// ---------------------------------------------------------------------------

const ACTIVE_EMPLOYMENT = { status: "active", company_id: "co_amend_01", custom_fields: { workation_permission: true } };

function uc04Row({ factors, travelHistory = [], now = "2026-08-01", identityVerified = true, row: extra = {} }) {
  const result = evaluateUc04({ identityVerified, employment: ACTIVE_EMPLOYMENT, factors, now, travelHistory });
  return {
    result,
    row: {
      employmentId: "emp_de_001",
      requester: "admin_jane",
      source: "portal",
      externalRef: "PR-2026-0042",
      factors,
      risk: result.risk,
      tripDays: result.risk?.tripDays ?? null,
      cumulativeDays: result.risk?.cumulativeDays ?? null,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
      ...extra,
    },
  };
}

/** The case in the complaint: a German employee, a fortnight in Spain. */
const DE_TO_ES = {
  homeCountry: "DE",
  nationality: "DE",
  destination: { country: "ES" },
  startDate: "2026-09-01",
  endDate: "2026-09-14",
  visaType: "schengen_short_stay",
  jobDuties: "engineering",
  hasContractSigningAuthority: false,
};

// ===========================================================================
// THE TEST THAT MATTERS
// ===========================================================================

test("DE→ES with a1_certificate_recommended surfaces the A1's own regulation, and the link resolves to a file on disk", () => {
  // The exact case the owner was looking at: ready_for_approval, one flag, and
  // — until now — no citation of any kind on the screen where it is approved.
  const { row, result } = uc04Row({ factors: DE_TO_ES });
  assert.equal(result.decision, "ready_for_approval");
  assert.ok(result.flags.includes("a1_certificate_recommended"), "the fixture must raise the flag or this test proves nothing");

  const basis = describeDecisionBasis({ authorizationRow: row });
  const a1 = basis.sources.entries.find((e) => e.finding === "a1_certificate_recommended");
  assert.ok(a1, "the A1 finding reached an approver with no source at all");

  const ids = a1.citations.map((c) => c.sourceId);
  assert.ok(ids.includes("D-17"), "Regulation 883/2004 — the instrument that decides which state's social security applies — was not cited");
  assert.ok(ids.includes("D-18"), "Regulation 987/2009 — where the attestation people call an A1 actually comes from — was not cited");

  for (const citation of a1.citations) {
    // THE ASSERTION THIS FILE EXISTS FOR. A renamed document must fail here,
    // not become a dead link beside an approve button.
    assert.ok(
      existsSync(repoPath(citation.path)),
      `citation ${citation.sourceId} links to ${citation.path}, which does not exist on disk`
    );
    assert.ok(citation.locator, `${citation.sourceId} was cited with no article or section`);
    assert.ok(citation.citedFor.length > 40, `${citation.sourceId} does not say what it is cited FOR`);
  }

  // And the citation is attached to the finding, not only to a sources panel
  // at the bottom of the page — the dimension carries it inline.
  const treaty = basis.dimensions.find((d) => d.key === "treaty_coverage");
  assert.ok(treaty.sources.some((s) => s.finding === "a1_certificate_recommended"));
});

test("a finding resting on a contradicted rule carries the caveat, on the same screen — and drops it when the contradiction is closed", () => {
  // C-1 SAID the Schengen 180-day window was computed once per trip here and
  // per day of stay in the regulation. It is now computed per day of stay
  // (schengenPeakDays(), Reg. (EU) 2016/399 art. 6(1) via D-07), so the caveat
  // is GONE from this screen — a specialist told their figure is disputed when
  // it is not is being misinformed in the other direction, and a caveat that
  // outlives its defect is the same stale-status-line defect this repo keeps
  // paying for.
  const { row } = uc04Row({ factors: DE_TO_ES });
  const basis = describeDecisionBasis({ authorizationRow: row });

  const schengen = basis.measurements.find((m) => m.key === "schengen_90_180");
  assert.ok(schengen, "no Schengen row for a Schengen destination");
  const block = schengen.sources.find((s) => s.finding === "schengen_90_180");
  assert.ok(block, "the Schengen allowance was measured with nothing said about where the rule comes from");

  assert.equal(
    block.caveats.find((c) => c.id === "C-1"),
    undefined,
    "C-1 is implemented; carrying it still would tell the specialist a correct figure is disputed"
  );

  // The two that ARE still open stay on the screen, with their links intact —
  // dropping C-1 must not become dropping the caveat block.
  const c2 = block.caveats.find((c) => c.id === "C-2");
  const c3 = block.caveats.find((c) => c.id === "C-3");
  assert.ok(c2, "the permit-exclusion gap was dropped along with the one that was fixed");
  assert.ok(c3, "the EES single-pool gap was dropped along with the one that was fixed");
  assert.equal(c2.weight, "incomplete");
  assert.ok(existsSync(repoPath(c2.path)), `caveat ${c2.id} links to ${c2.path}, which does not exist`);

  // The balance the corpus itself insists on: the numbers ARE right, and a
  // reader told only about faults learns to distrust everything equally.
  assert.ok(block.confirmations.some((k) => k.id === "K-2"), "the confirmation that 90 and 180 are the statutory numbers was dropped");
});

// ===========================================================================
// The links, exhaustively
// ===========================================================================

test("every document in the library exists on disk and still carries its catalogue id", () => {
  for (const doc of Object.values(SOURCE_LIBRARY)) {
    const full = repoPath(doc.path);
    assert.ok(existsSync(full), `${doc.id} links to ${doc.path}, which does not exist`);
    const firstLine = readFileSync(full, "utf8").split("\n")[0];
    // Not a substring of the path — a document renamed AND renumbered would
    // still pass that. The id has to be in the document's own heading.
    assert.match(
      firstLine,
      new RegExp(`\\b${doc.id}\\b`),
      `${doc.path} no longer announces itself as ${doc.id}; the citation now points at a different document`
    );
  }
});

test("every retrieved-bytes path exists, and a null one is a real statement rather than a missing field", () => {
  for (const doc of Object.values(SOURCE_LIBRARY)) {
    if (doc.bytes === null) continue;
    assert.ok(existsSync(repoPath(doc.bytes)), `${doc.id} claims retrieved bytes at ${doc.bytes}, which does not exist`);
  }
  // At least one of each, or the distinction is decorative: some sources are
  // cite-and-link-only at the publisher and exist here as a provenance sidecar.
  const docs = Object.values(SOURCE_LIBRARY);
  assert.ok(docs.some((d) => d.bytes !== null));
  assert.ok(docs.some((d) => d.bytes === null));
});

test("every caveat and confirmation still exists as its own section of CONTRADICTIONS.md", () => {
  // A renumbered contradiction must break here. Otherwise a caveat goes on
  // citing "C-17" long after C-17 has become something else — which is the
  // exact failure mode the corpus records against the CRA's own table (C-24).
  const seen = new Set();
  for (const entry of [...Object.values(CAVEAT_LIBRARY), ...Object.values(CONFIRMATION_LIBRARY)]) {
    assert.ok(existsSync(repoPath(entry.path)), `${entry.id} links to ${entry.path}, which does not exist`);
    if (!seen.has(entry.path)) seen.add(entry.path);
    const text = readFileSync(repoPath(entry.path), "utf8");
    assert.match(
      text,
      new RegExp(`^### ${entry.section} ·`, "m"),
      `${entry.id} cites section ${entry.section}, which is no longer a heading in ${entry.path}`
    );
  }
  assert.ok(seen.size > 0);
});

test("every citation in the map resolves to a registered document, and every caveat to a registered caveat", () => {
  for (const [key, entry] of Object.entries(FINDING_SOURCES)) {
    assert.ok(entry.cite.length > 0, `${key} has an entry with no citations — that is an uncited finding, not a cited one`);
    for (const c of entry.cite) {
      assert.ok(SOURCE_LIBRARY[c.source], `${key} cites unknown document ${c.source}`);
    }
    for (const id of entry.caveats ?? []) assert.ok(CAVEAT_LIBRARY[id], `${key} cites unknown caveat ${id}`);
    for (const id of entry.confirmations ?? []) assert.ok(CONFIRMATION_LIBRARY[id], `${key} cites unknown confirmation ${id}`);
  }
});

// ===========================================================================
// The honesty discipline, copied from treatyRetriever.js
// ===========================================================================

test("no citation carries an invented precision — matchedOn names the mechanism, never a score", () => {
  // treatyRetriever.js refuses to print "92% similar" beside a passage because
  // a retrieval signal is not a precision figure. There is no signal at all
  // here — a person wrote the map — so anything numeric would be worse.
  for (const key of Object.keys(FINDING_SOURCES)) {
    for (const c of sourcesForFinding(key).citations) {
      assert.equal(c.matchedOn, `hand-curated map entry for the finding "${key}"`);
      assert.doesNotMatch(c.matchedOn, /\d+(\.\d+)?\s*%|score|confidence|similar/i);
      for (const value of Object.values(c)) {
        assert.notEqual(typeof value, "number", `${key} cited ${c.sourceId} with a bare number on the citation object`);
      }
    }
  }
});

test("no citation reads as advice — a source says what a check is based on, never what to do about this request", () => {
  const advice = /\byou (?:may|should|can|must)\b|\bwe recommend\b|\bapprove this\b|\bit is safe to\b/i;
  for (const key of Object.keys(FINDING_SOURCES)) {
    const block = sourcesForFinding(key);
    for (const c of block.citations) {
      assert.doesNotMatch(c.citedFor, advice, `${key}/${c.sourceId} states a conclusion instead of naming a rule`);
    }
  }
  // And the framing rendered above the block says so in words.
  assert.match(SOURCE_FRAMING, /never what to decide about this request/);
});

test("a finding with no map entry gets null, never a nearest match", () => {
  // The whole argument for a hand-curated map over a retriever: over 35
  // documents, a similarity search always returns something.
  assert.equal(sourcesForFinding("pe_risk_dape"), null);
  assert.equal(sourcesForFinding("a_flag_that_does_not_exist"), null);
  assert.equal(sourcesForFinding("constructor"), null, "prototype-chain lookup returned a 'finding'");
  assert.equal(uncitedFinding("constructor"), null);
});

test("the most escalation-forcing flag UC-04 raises is reported as UNSOURCED, and says why", () => {
  // pe_risk_dape alone forces an escalation regardless of every other
  // dimension, and this corpus cannot cite it: the OECD Model and BEPS Action 7
  // are paraphrase-only by licence, and the register naming their articles
  // marks its own source binding [PROPOSED] because they were never read.
  // Silence here would read as "nothing to say"; it is "we have no source".
  const { row } = uc04Row({
    factors: { ...DE_TO_ES, destination: { country: "MX" }, jobDuties: "executive", hasContractSigningAuthority: true },
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  const role = basis.dimensions.find((d) => d.key === "role_pe_sensitivity");
  assert.equal(role.state, "attention");
  assert.deepEqual(role.sources, []);
  const uncited = role.uncited.find((u) => u.finding === "pe_risk_dape");
  assert.ok(uncited, "the PE finding was rendered with no citation AND no explanation of why there is none");
  assert.match(uncited.why, /OECD/);
  assert.match(uncited.why, /paraphrase|copied/i);
  assert.ok(basis.sources.uncited.some((u) => u.finding === "pe_risk_dape"));
});

test("the immigration-document dimension says the gap is this use case's own rule, not an authority's", () => {
  const { row } = uc04Row({ factors: { ...DE_TO_ES, destination: { country: "MX" } } });
  const doc = describeDecisionBasis({ authorizationRow: row }).dimensions.find((d) => d.key === "immigration_document");
  assert.equal(doc.state, "unavailable");
  const uncited = doc.uncited.find((u) => u.finding === "immigration_document_on_file");
  assert.ok(uncited);
  assert.match(uncited.why, /UC-04\.md/);
});

// ===========================================================================
// The three findings whose sources contradict the code
// ===========================================================================

test("the suppressed Schengen check cites the scheme's own statute — which contains none of the conditions claimed for it", () => {
  // C-17. The provenance note asks Portugal's D8 article for an income floor, a
  // duration and an insurance requirement; the article is one paragraph and has
  // none of them. A suppression resting on that is the thing to tell a
  // specialist before they approve on the strength of it.
  assert.ok(SCHENGEN.has("PT") && DNV_COUNTRIES.has("PT"), "PT must be both, or this test proves nothing");
  const { row } = uc04Row({
    factors: { ...DE_TO_ES, destination: { country: "PT" }, visaType: "digital_nomad_visa", endDate: "2026-09-20" },
    travelHistory: [{ country: "PT", startDate: "2026-01-01", endDate: "2026-06-24" }],
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  const suppressed = basis.measurements.find((m) => m.key === "schengen_90_180");
  assert.equal(suppressed.state, "suppressed");

  const block = suppressed.sources.find((s) => s.finding === "schengen_90_180_suppressed");
  assert.ok(block, "a control was waived and nothing said on what authority");
  assert.ok(block.citations.some((c) => c.sourceId === "D-10"));
  const c17 = block.caveats.find((c) => c.id === "C-17");
  assert.ok(c17, "the suppression cited a statute without saying the statute does not contain the conditions");
  assert.equal(c17.weight, "unsupported");
});

test("the US work-permit block carries the contradiction that it is drawn at the visa label, not the activity", () => {
  // C-26, and the confirmation K-3 beside it: the block is right about WORK and
  // wrong about the business visitor. Both halves reach the specialist.
  const { row } = uc04Row({ factors: { ...DE_TO_ES, destination: { country: "US" }, visaType: "business_visa" } });
  const basis = describeDecisionBasis({ authorizationRow: row });
  assert.ok(row.flags.includes("us_requires_work_permit"));

  const block = basis.sources.entries.find((e) => e.finding === "us_requires_work_permit");
  assert.ok(block);
  assert.ok(block.citations.some((c) => c.sourceId === "D-15"), "USCIS's own B-1 page was not cited on a block about the B-1");
  assert.ok(block.caveats.some((c) => c.id === "C-26"));
  assert.ok(block.confirmations.some((k) => k.id === "K-3"));
});

test("the tax-residency watch line carries the four-different-shapes contradiction", () => {
  // C-12: one 183-in-365 line stands in for four domestic tests, one of which
  // has no day count at all. C-11: the treaty day test is one of three
  // cumulative conditions, and for an EOR the other two decide the case.
  const { row } = uc04Row({
    factors: { ...DE_TO_ES, destination: { country: "MX" }, startDate: "2026-09-01", endDate: "2026-09-10" },
    travelHistory: [{ country: "MX", startDate: "2026-01-01", endDate: "2026-07-01" }],
  });
  const basis = describeDecisionBasis({ authorizationRow: row });
  const residency = basis.measurements.find((m) => m.key === "tax_residency_183");
  assert.ok(residency, "no residency measurement for a real travel history");
  const block = residency.sources.find((s) => s.finding === "tax_residency_183");
  assert.ok(block);
  assert.ok(block.caveats.some((c) => c.id === "C-12"));
  assert.ok(block.caveats.some((c) => c.id === "C-11"));
});

// ===========================================================================
// Who is asking, and in what capacity
// ===========================================================================

test("the approver is told who filed this, about whom, and that the two are different people", () => {
  const { row } = uc04Row({ factors: DE_TO_ES });
  const who = describeDecisionBasis({ authorizationRow: row }).requester;
  assert.equal(who.filedBy.state, "authenticated_company_actor");
  assert.equal(who.filedBy.id, "admin_jane");
  assert.equal(who.actingFor.state, "on_behalf_of_the_subject");
  assert.equal(who.subject.employmentId, "emp_de_001");
  assert.equal(who.intake.source, "portal");
  assert.equal(who.intake.externalRef, "PR-2026-0042");
  assert.equal(who.identity.state, "verified");
  // Verified means authorised to act for the company — not proof of who the
  // human is. Saying only the first would overstate the control.
  assert.match(who.identity.finding, /not evidence about who the person behind the session is/);
});

test("the countries on the request are labelled as STATED, because nothing ever compares them to the employment record", () => {
  // The gates read `factors.homeCountry`; no gate reads the country on the
  // Remote record, so a wrong one is caught nowhere. Calling it "the employee's
  // country" would assert a check that does not happen.
  const { row } = uc04Row({ factors: DE_TO_ES });
  const who = describeRequester({ authorizationRow: row });
  assert.equal(who.subject.statedHomeCountry.value, "DE");
  assert.match(who.subject.statedHomeCountry.finding, /never compared to it/);
  assert.match(who.subject.statedNationality.finding, /no document was read/i);
});

test("the employment record is reported as NOT RETAINED — never as facts the row does not hold", () => {
  // The manufactured-zero discipline, one field over: the workflow reads the
  // full employment record and the store keeps none of it. Printing a type or a
  // country here would be inventing one.
  const { row } = uc04Row({ factors: DE_TO_ES });
  const who = describeRequester({ authorizationRow: row });
  assert.equal(who.subject.employmentRecord.state, "not_retained");
  assert.match(who.subject.employmentRecord.finding, /the status active/);
  assert.match(who.subject.employmentRecord.finding, /employee or contractor/);
  assert.ok(who.subject.employmentRecord.whatItWouldTake);
  // The requester's own words are the other thing the row cannot carry.
  assert.equal(who.statedReason.state, "not_retained");
  assert.match(who.statedReason.whatItWouldTake, /audit_log|reason_text/);
});

test("an unauthenticated filer is named as such, and is not confused with a missing field", () => {
  // `workflow.js` writes the literal string "unauthenticated" when no session
  // carried an admin id. A row with no requester at all is a different fact.
  const { row } = uc04Row({ factors: DE_TO_ES, identityVerified: false, row: { requester: "unauthenticated" } });
  const who = describeRequester({ authorizationRow: row });
  assert.equal(who.filedBy.state, "unauthenticated");
  assert.equal(who.filedBy.id, null);
  assert.equal(who.actingFor.state, "unknown");
  assert.equal(who.identity.state, "not_verified");
  assert.match(who.identity.finding, /failure to confirm, not a finding that the filer is unauthorised/);

  const missing = describeRequester({ authorizationRow: { ...row, requester: null } });
  assert.equal(missing.filedBy.state, "not_recorded");
  assert.match(missing.filedBy.finding, /field missing/);
});

test("a filer who IS the subject is reported as such, rather than assumed never to happen", () => {
  const { row } = uc04Row({ factors: DE_TO_ES, row: { requester: "emp_de_001" } });
  assert.equal(describeRequester({ authorizationRow: row }).actingFor.state, "the_subject_themselves");
});

test("describeRequester returns null for no row, like every other describer here", () => {
  assert.equal(describeRequester({}), null);
  assert.equal(describeRequester(), null);
});

// ===========================================================================
// Structural — this must stay a description
// ===========================================================================

test("STRUCTURAL: the source map reaches no service, and no gate reaches the source map", () => {
  const sources = readFileSync(repoPath("src/uc04/decisionSources.js"), "utf8");
  const imports = sources.split("\n").filter((l) => l.trimStart().startsWith("import "));
  assert.deepEqual(imports, [], "decisionSources.js imports something — it is frozen data and must stay that way");

  for (const file of ["src/uc04/policyEngine.js", "src/uc04/approvalPolicy.js", "src/uc04/riskMatrix.js", "src/uc04/workflow.js"]) {
    const text = readFileSync(repoPath(file), "utf8");
    const reads = text.split("\n").filter((l) => l.trimStart().startsWith("import ") && /decisionSources/.test(l));
    assert.deepEqual(reads, [], `${file} imports decisionSources — a citation must never be able to change an outcome`);
  }
});

test("STRUCTURAL: no citation id appears in a conditional anywhere in UC-04", () => {
  // docs/knowledge/README.md's own greppable rule. The map is keyed by FINDING,
  // and the finding keys are the risk matrix's flags — so a document id or a
  // contradiction id being compared to anything would mean a source had started
  // deciding something.
  const forbidden = /[=!]==?\s*["'`](?:D-\d|C-\d|K-\d)|["'`](?:D-\d\d?|C-\d\d?|K-\d)["'`]\s*[=!]==?/;
  for (const file of ["src/uc04/decisionSources.js", "src/uc04/decisionFacts.js", "src/uc04/policyEngine.js", "src/uc04/riskMatrix.js"]) {
    const text = readFileSync(repoPath(file), "utf8");
    assert.doesNotMatch(text, forbidden, `${file} tests a citation id in a conditional`);
  }
});

test("STRUCTURAL: every finding key in the map is a state UC-04 can actually produce", () => {
  // A map entry for a flag the matrix never raises is a citation nobody will
  // ever see, and it would make the coverage of this file look better than it
  // is. The two non-flag keys are states, and are listed explicitly.
  const matrix = readFileSync(repoPath("src/uc04/riskMatrix.js"), "utf8");
  const describer = readFileSync(repoPath("src/uc04/decisionFacts.js"), "utf8");
  const nonFlagStates = new Set(["treaty_coverage_unconfirmed", "schengen_90_180", "schengen_90_180_suppressed", "tax_residency_183"]);
  for (const key of Object.keys(FINDING_SOURCES)) {
    if (nonFlagStates.has(key)) {
      assert.ok(describer.includes(key), `${key} is claimed as a describer state and appears nowhere in decisionFacts.js`);
      continue;
    }
    assert.ok(matrix.includes(`"${key}"`), `${key} is cited but the risk matrix never raises it`);
  }
  // The uncited set spans both producers: the risk matrix's soft flags AND the
  // policy engine's own gate reasons, which never reach the matrix at all.
  const gates = readFileSync(repoPath("src/uc04/policyEngine.js"), "utf8");
  for (const key of Object.keys(UNCITED_FINDINGS)) {
    assert.ok(
      matrix.includes(`"${key}"`) || gates.includes(`"${key}"`) || describer.includes(key),
      `${key} is recorded as uncited but nothing produces it`
    );
  }
});

test("nothing appears in the aggregated reading list that is not attached to a finding above it", () => {
  // The panel at the end of the page must be a summary of what the specialist
  // already saw beside each finding, never an extra list assembled from flags.
  const { row } = uc04Row({ factors: DE_TO_ES });
  const basis = describeDecisionBasis({ authorizationRow: row });
  const inline = new Set([
    ...basis.dimensions.flatMap((d) => d.sources.map((s) => s.finding)),
    ...basis.measurements.flatMap((m) => m.sources.map((s) => s.finding)),
  ]);
  for (const entry of basis.sources.entries) {
    assert.ok(inline.has(entry.finding), `${entry.finding} is in the reading list but beside no finding`);
  }
  // Deduped: one entry per finding, however many places raised it.
  const findings = basis.sources.entries.map((e) => e.finding);
  assert.equal(findings.length, new Set(findings).size);
});

test("a run where no gate assessed anything cites nothing — an unassessed case gets no reading list", () => {
  // The same rule as the four dimensions' `not_assessed`: a check that never
  // ran approved of nothing, and hanging a statutory citation off it would
  // imply a rule had been applied.
  const result = evaluateUc04({
    identityVerified: false,
    employment: ACTIVE_EMPLOYMENT,
    factors: DE_TO_ES,
    now: "2026-08-01",
  });
  const basis = describeDecisionBasis({
    authorizationRow: { factors: DE_TO_ES, risk: result.risk, tripDays: null, cumulativeDays: null, flags: result.flags, requester: "unauthenticated" },
  });
  assert.equal(result.risk, null);
  assert.deepEqual(basis.sources.entries, []);
  assert.deepEqual(basis.measurements, []);
});
