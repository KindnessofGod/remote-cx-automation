// ---------------------------------------------------------------------------
// uc04TreatyCoverage.test.js — the dimension that said "Unknown" over its own
// citation, and the job-title row it sat next to
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// The project owner read a UC-04 sidebar page and asked two things: "how can
// the relevant doc be absent" and, on the next pass, "our demo is not meant to
// have unknown". Both were about the same finding. It reported
// `Totalization / treaty coverage: Unknown` for United States → Netherlands,
// directly above a citation to D-20 — the SSA's own status table, which
// carries the US–Netherlands row — and above caveat C-9, which names that pair
// as covered with its authority and effective date.
//
// The data had been in the repository the whole time, one use case over each:
// `SOCIAL_SECURITY_COVERAGE` in src/uc08/decisionSources.js (six pairs, with a
// network, a certificate and a maximum initial detachment) and
// `TAX_CONVENTION_BY_PAIR` in src/uc07/decisionSources.js (the bilateral tax
// convention for the same six). UC-04 read neither.
//
// WHAT IS PINNED HERE, AND WHY EACH ONE
//
//   · The covered case reports the instruments — with the bound that an
//     agreement in force is not a certificate obtained.
//   · The two absences SURVIVE. A change that answers a question by making the
//     honest "I do not know" unreachable has not answered it. Both gap
//     branches are driven on pairs the registers genuinely do not hold.
//   · The two registers agree on which pairs they hold. `cleared` requires
//     BOTH, so a pair added to one alone would silently stop being reported at
//     all rather than being half-reported — a regression with no symptom.
//   · Nothing about the DECISION moved. This is a describer, and a citation
//     must never be able to change an outcome.
//   · The jurisdiction filter keeps the EU regulation off a route with a
//     non-member on one end.
//   · The duty category says where it came from, because the page printed
//     "Data Scientist" and "Engineering" six inches apart and explained
//     neither.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describeDecisionBasis } from "../src/uc04/decisionFacts.js";
import { classifyRisk } from "../src/uc04/riskMatrix.js";
import { documentServesRoute } from "../src/uc04/sourceJurisdiction.js";
import { SOCIAL_SECURITY_COVERAGE } from "../src/uc08/decisionSources.js";
import { TAX_CONVENTION_BY_PAIR } from "../src/uc07/decisionSources.js";

const repoPath = (rel) => fileURLToPath(new URL("../" + rel, import.meta.url));

/** Drive the real matrix and the real describer for one route. */
function basisFor(homeCountry, nationality, destinationCountry, extra = {}) {
  const factors = {
    homeCountry,
    nationality,
    destination: { country: destinationCountry },
    startDate: "2026-09-01",
    endDate: "2026-09-14",
    visaType: "schengen_short_stay",
    jobDuties: "engineering",
    hasContractSigningAuthority: false,
    priorTravel: [],
    ...extra,
  };
  const risk = classifyRisk({
    sourceCountry: homeCountry,
    homeCountry,
    nationality,
    destinationCountry,
    startDate: factors.startDate,
    endDate: factors.endDate,
    visaType: factors.visaType,
    jobDuties: factors.jobDuties,
    hasContractSigningAuthority: factors.hasContractSigningAuthority,
    priorTravel: [],
  });
  return {
    risk,
    basis: describeDecisionBasis({
      authorizationRow: { factors, risk, flags: (risk.flags ?? []).map((f) => f.code ?? f), tripDays: 14 },
    }),
  };
}

const coverageOf = (...route) => basisFor(...route).basis.dimensions.find((d) => d.key === "treaty_coverage");

// ---------------------------------------------------------------------------
// The covered case
// ---------------------------------------------------------------------------

test("a pair both registers hold reports its instruments instead of Unknown", () => {
  const coverage = coverageOf("US", "US", "NL");
  assert.equal(coverage.state, "cleared");
  assert.match(coverage.finding, /Both limbs are covered for United States → Netherlands/);

  // The five columns, out of the register rather than out of this file.
  const evidence = Object.fromEntries(coverage.evidence.map((e) => [e.label, e.value]));
  assert.equal(evidence["Social-security network"], SOCIAL_SECURITY_COVERAGE["NL|US"].network);
  assert.equal(evidence["Certificate that evidences it"], SOCIAL_SECURITY_COVERAGE["NL|US"].certificate);
  assert.equal(evidence["Maximum initial detachment"], SOCIAL_SECURITY_COVERAGE["NL|US"].maximumInitialDetachment);
  assert.equal(evidence["Tax convention articles"], TAX_CONVENTION_BY_PAIR["NL|US"].locator);
});

test("the covered finding does not let 'an agreement exists' pass for 'a certificate was obtained'", () => {
  // The distinction the whole finding turns on. An instrument in force settles
  // which country's scheme applies; obtaining the A1 or the certificate of
  // coverage is a separate act, and this system checks neither.
  const coverage = coverageOf("US", "US", "NL");
  assert.match(coverage.finding, /No certificate of coverage is confirmed for this trip/);
  assert.match(coverage.finding, /obtain the one named below/);
});

test("every pair in the demo matrix is answered, and the answer names an instrument", () => {
  // The owner's actual complaint: "our demo is not meant to have unknown".
  // DEMO-COUNTRIES.md's four are NL · PT · CA · US, which is six pairs.
  const demo = ["NL", "PT", "CA", "US"];
  for (const a of demo) {
    for (const b of demo) {
      if (a === b) continue; // same-country trips are refused a gate earlier
      const coverage = coverageOf(a, a, b);
      assert.equal(coverage.state, "cleared", `${a} → ${b} still reports ${coverage.state}`);
      assert.match(coverage.finding, /Both limbs are covered for/);
    }
  }
});

// ---------------------------------------------------------------------------
// The absences, which must survive
// ---------------------------------------------------------------------------

test("a pair neither register holds still reports Unknown, in the words it always used", () => {
  // ANSWERING A QUESTION BY MAKING "I DO NOT KNOW" UNREACHABLE IS NOT AN
  // ANSWER. If this ever goes green because every route reports covered, the
  // register has stopped being a register.
  const coverage = coverageOf("DE", "DE", "MX");
  assert.equal(coverage.state, "unknown");
  assert.match(coverage.finding, /absence of a recorded gap, not a record of coverage/);
  // "A citation is not a gate" was the panel arguing its own design. What the
  // specialist needs from the same sentence is where to look next, so that is
  // what is pinned now (W-5b).
  assert.match(coverage.finding, /Where the sources below name an instrument for this pair, read it there/);
});

test("an intra-EU pair outside the register still says the tax side is unsettled", () => {
  const coverage = coverageOf("DE", "DE", "ES");
  assert.equal(coverage.state, "unknown");
  assert.match(coverage.finding, /is coordinated for social security by Regulation \(EC\) No 883\/2004/);
  assert.match(coverage.finding, /The tax side is a separate bilateral instrument and is not on record here/);
});

test("a pair on the known-gap list is still reported as a gap, not as unanswered", () => {
  // On a work permit — with a Schengen short-stay document the US work-permit
  // gate blocks first, so the country-pair rule never runs and the dimension
  // correctly reports that it was not reached rather than that it found a gap.
  const coverage = basisFor("IN", "IN", "US", { visaType: "work_permit" }).basis.dimensions.find(
    (d) => d.key === "treaty_coverage"
  );
  assert.equal(coverage.state, "attention");
  assert.match(coverage.finding, /No totalization or tax agreement is on record for India → United States/);
});

// ---------------------------------------------------------------------------
// Structural — the guards that keep the above true after the next edit
// ---------------------------------------------------------------------------

test("STRUCTURAL: the two registers hold the same pairs, so 'covered' is never half an answer", () => {
  // `cleared` requires an entry in BOTH, because the dimension's own question
  // names social security AND tax and they are different instruments. That
  // makes a pair added to one register alone silently fall back to `unknown` —
  // correct, and invisible. This is the guard that makes it visible.
  assert.deepEqual(
    Object.keys(SOCIAL_SECURITY_COVERAGE).sort(),
    Object.keys(TAX_CONVENTION_BY_PAIR).sort(),
    "one register grew and the other did not; the pairs in only one now report Unknown with no symptom"
  );
});

test("STRUCTURAL: reading the registers changed no gate, no flag and no risk level", () => {
  // A CITATION MUST NEVER BE ABLE TO CHANGE AN OUTCOME. The registers are read
  // by the describer only; `NON_TREATY_PAIRS` remains the sole country-pair
  // rule with any effect on the decision. Asserted two ways: the matrix cannot
  // even name the covered state, and a covered route raises no flag from it.
  const matrix = readFileSync(repoPath("src/uc04/riskMatrix.js"), "utf8");
  const gates = readFileSync(repoPath("src/uc04/policyEngine.js"), "utf8");
  for (const source of [matrix, gates]) {
    assert.doesNotMatch(source, /SOCIAL_SECURITY_COVERAGE|TAX_CONVENTION_BY_PAIR|treaty_coverage_confirmed/);
  }
  const { risk } = basisFor("US", "US", "NL");
  const flags = (risk.flags ?? []).map((f) => f.code ?? f);
  assert.deepEqual(flags, [], "a covered pair raised a flag; this dimension is meant to decide nothing");
});

test("STRUCTURAL: the EU regulation is not cited on a route with a non-member on one end", () => {
  // Reg. 883/2004 coordinates BETWEEN Member States. Tagged with all thirty
  // codes and matched with `.some()`, it survived a United States →
  // Netherlands route because the Netherlands is on the list — and the covered
  // finding cites it, so the page would have named the EU regulation as an
  // instrument in force for a pair the United States is one half of.
  for (const documentId of ["D-17", "D-18"]) {
    assert.equal(documentServesRoute(documentId, { homeCountry: "US", destination: "NL", nationality: "US" }), false);
    assert.equal(documentServesRoute(documentId, { homeCountry: "NL", destination: "PT", nationality: "NL" }), true);
    // Only ever removes on positive evidence: an unreadable route is kept.
    assert.equal(documentServesRoute(documentId, { destination: "NL" }), true);
  }
  // Nationality is not what the regulation keys on — a US national posted
  // between two Member States is inside the coordination, not outside it.
  assert.equal(documentServesRoute("D-17", { homeCountry: "NL", destination: "PT", nationality: "US" }), true);
});

test("the covered finding cites the pair's own instruments and none of the others", () => {
  const coverage = coverageOf("US", "US", "NL");
  const group = (coverage.sources ?? []).find((g) => g.finding === "treaty_coverage_confirmed");
  assert.ok(group, "the covered state renders no citation group at all");
  const cited = group.citations.map((c) => c.sourceId).sort();
  assert.deepEqual(cited, ["D-20", "D-27"], "the route filter let another jurisdiction's instrument through");
  // Six of the eight listed instruments govern other jurisdictions — Canada's
  // network and the three non-US conventions and the two EU regulations. The
  // key lists all eight on purpose, so the jurisdiction decision lives in the
  // filter that is tested for it rather than in frozen data nobody re-reads.
  assert.equal(group.citationsExcludedForRoute, 6);

  // C-9 said "four country pairs this system reports as unknown are in fact
  // covered". UC-04 no longer makes that claim, so the caveat retires with it.
  // C-8 and C-24 do NOT retire: both are about the detachment column this
  // finding now prints, and neither was discharged by anything.
  const caveats = group.caveats.map((c) => c.id).sort();
  assert.deepEqual(caveats, ["C-24", "C-8"]);
  assert.deepEqual(group.confirmations.map((c) => c.id), ["K-4"]);
});

// ---------------------------------------------------------------------------
// The job title beside it
// ---------------------------------------------------------------------------

test("the duty category says it was chosen by the requester, not read from the record", () => {
  // "Job title: Data Scientist" and "Duties are 'Engineering'" appeared six
  // inches apart, both correct, with nothing saying they come from different
  // places. The stated home country a few rows up has carried exactly this
  // disclosure for weeks; the duties never did, so the one row where the
  // record offers an independent check read as though it WERE the record.
  const cleared = basisFor("US", "US", "NL").basis.dimensions.find((d) => d.key === "role_pe_sensitivity");
  assert.equal(cleared.state, "cleared");
  assert.match(cleared.finding, /selected by the requester/);
  assert.match(cleared.finding, /not read from the job title/);
  assert.match(cleared.finding, /nothing compares the two/);
  assert.ok(
    cleared.evidence.some((e) => e.label === "Job duties, as stated on the request"),
    "the evidence row still labels a self-declared category as though it were a fact about the employment"
  );
});

test("the same disclosure rides on the branch that ESCALATES, where a wrong category costs more", () => {
  // A miscategorised 'executive' escalates a routine trip on its own. That is
  // the branch where the reader most needs to know the category was typed by
  // the person filing, not read off their record.
  const escalated = basisFor("US", "US", "NL", { jobDuties: "executive" }).basis.dimensions.find(
    (d) => d.key === "role_pe_sensitivity"
  );
  assert.equal(escalated.state, "attention");
  assert.match(escalated.finding, /permanent-establishment exposure/i);
  assert.match(escalated.finding, /selected by the requester/);
});

// ---------------------------------------------------------------------------
// The filer, when this page holds no name for them
// ---------------------------------------------------------------------------

test("an unresolved filer is drawn as an identifier, not as a name", async () => {
  // "Filed by admin_jane" appeared in the same slot that reads "Filed by Chris
  // Lee" when the filer IS the subject. Both are correct; only one is a name.
  // The substitution that resolves an employee deliberately does NOT fire for
  // a company admin — nothing here has read a record for them, and inventing
  // one would be worse — so what is fixed is the row no longer LOOKING like a
  // resolved name. The explanatory note already said what the value is; the
  // row now agrees with it at a glance.
  const { renderSidebar, servedBy, collect, textOf } = await import("./fixtures/zafSidebar.js");
  const BASE = "http://uc04.filedby.test";

  async function filedByNode(view) {
    const r = await renderSidebar({
      settings: { apiBaseUrl: "", uc04ApiBaseUrl: BASE },
      ticketId: 8405,
      respond: servedBy(BASE, view),
    });
    const rows = collect(r.root, (n) => String(n.className || "").indexOf("r-fact") === 0);
    return rows.find((row) => /^Filed by/.test(textOf(row))) || null;
  }

  const base = {
    found: true,
    employee: { state: "available", employmentId: "emp-1", displayName: "Chris Lee", fields: [] },
    authorization: { decision: "ready_for_approval", reason: "all_gates_passed", flags: [], externalRef: "8405" },
    basis: { dimensions: [], measurements: [] },
  };
  // `requester` hangs off `basis`, which is where the server publishes it.
  const withFiler = (filedBy) => ({ ...base, basis: { ...base.basis, requester: { filedBy } } });

  const admin = await filedByNode(
    withFiler({ id: "admin_jane", finding: "Filed by admin_jane, an authenticated actor for the company." })
  );
  assert.ok(admin, "no Filed by row rendered at all");
  assert.match(textOf(admin), /admin_jane/);
  assert.ok(
    collect(admin, (n) => String(n.className || "").indexOf("r-fact-id") !== -1).length > 0,
    "a raw session id is still drawn in the same face as a person's name"
  );

  // And the resolved case is untouched: a real name must NOT be dressed as an id.
  const employee = await filedByNode(withFiler({ id: "emp-1", finding: "Filed by the employee themselves." }));
  assert.match(textOf(employee), /Chris Lee/);
  assert.equal(
    collect(employee, (n) => String(n.className || "").indexOf("r-fact-id") !== -1).length,
    0,
    "a resolved name is being drawn as an identifier"
  );
});
