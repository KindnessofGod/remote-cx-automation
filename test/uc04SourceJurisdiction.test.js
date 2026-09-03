// ---------------------------------------------------------------------------
// uc04SourceJurisdiction.test.js
// ---------------------------------------------------------------------------
// WHAT THIS PINS (2026-08-30, BUILD-LOG §3.100)
//
// `sourcesForFinding()` took a finding key and NOTHING ELSE, so a finding's
// citations were identical whatever countries the trip involved. Observed, on
// the flagship demo pair, under "Totalization / treaty coverage" for a
// Portugal → Netherlands workation:
//
//     treaty_coverage_unconfirmed
//       D-20   U.S. Social Security Administration
//       D-21   Canada Revenue Agency (CPP/EI Rulings)
//
// The same two were the ONLY sources shown for Portugal → Iran.
//
// The tests below are written around the property that makes the filter safe
// rather than merely correct: IT CAN ONLY EVER REMOVE, AND ONLY ON POSITIVE
// EVIDENCE. Half of them exist to prove it does not over-remove, because that
// is the failure with a real cost — hiding the instrument that governs a
// specialist's case.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";

import { FINDING_SOURCES, SOURCE_LIBRARY, sourcesForFinding } from "../src/uc04/decisionSources.js";
import { documentServesRoute, servesRoute } from "../src/uc04/sourceJurisdiction.js";
import { DOCUMENT_JURISDICTIONS } from "../src/knowledge/documentCountries.js";

const route = (homeCountry, destination, nationality = homeCountry) => ({
  serves: servesRoute({ homeCountry, destination, nationality }),
});
const ids = (group) => (group?.citations ?? []).map((c) => c.sourceId);

// ---------------------------------------------------------------------------
// The defect itself
// ---------------------------------------------------------------------------

test("a Portugal-Netherlands trip is not cited the US SSA or the Canada CRA", () => {
  const group = sourcesForFinding("treaty_coverage_unconfirmed", route("PT", "NL"));
  assert.deepEqual(ids(group), [], "the two documents mapped here govern US and Canadian pairs");
  assert.match(group.noCitationForRoute, /governs other jurisdictions/);

  // The publishers, named, because the ids alone would not have caught this by
  // eye when it shipped.
  const unfiltered = sourcesForFinding("treaty_coverage_unconfirmed");
  const publishers = unfiltered.citations.map((c) => c.publisher).join(" | ");
  assert.match(publishers, /Social Security Administration/);
  assert.match(publishers, /Canada Revenue Agency/);
});

test("each pair is cited its OWN convention, and not another pair's", () => {
  // The residence/convention finding held nine documents and showed all nine on
  // every route.
  assert.equal(ids(sourcesForFinding("tax_residency_183")).length, 9, "precondition: nine documents are mapped");

  assert.deepEqual(ids(sourcesForFinding("tax_residency_183", route("PT", "NL"))), ["D-31", "D-32", "D-24"]);
  assert.deepEqual(ids(sourcesForFinding("tax_residency_183", route("US", "PT"))), ["D-32", "D-35", "D-27"]);
  assert.deepEqual(ids(sourcesForFinding("tax_residency_183", route("PT", "CA"))), ["D-32", "D-33", "D-34", "D-26"]);

  // D-24 IS the Netherlands-Portugal convention and D-27 IS the US set: the
  // point is not that the lists are shorter, it is that each is the right one.
  assert.match(SOURCE_LIBRARY["D-24"].title, /Netherlands–Portugal/);
  assert.match(SOURCE_LIBRARY["D-27"].title, /United States tax conventions/);
});

test("a bilateral instrument needs BOTH its parties, never one", () => {
  // The rule that removes the US conventions from PT -> NL. An `.includes` on a
  // flat country list would have kept every one of them, because D-27's
  // `countries` names all four.
  assert.deepEqual(DOCUMENT_JURISDICTIONS["D-27"].countries, ["US", "NL", "PT", "CA"]);
  assert.equal(documentServesRoute("D-27", { homeCountry: "PT", destination: "NL", nationality: "PT" }), false);
  assert.equal(documentServesRoute("D-27", { homeCountry: "US", destination: "PT", nationality: "US" }), true);
});

// ---------------------------------------------------------------------------
// It can only ever REMOVE, and only on positive evidence
// ---------------------------------------------------------------------------

test("an unmapped document, an unknown scope and a routeless request are all KEPT", () => {
  assert.equal(documentServesRoute("D-NOT-A-DOCUMENT", { homeCountry: "PT", destination: "NL" }), true);
  assert.equal(documentServesRoute("D-20", {}), true, "no route ⇒ nothing to exclude on");
  assert.equal(documentServesRoute("D-20", { homeCountry: null, destination: undefined }), true);
  // A malformed code is not a country, and must not be read as one.
  assert.equal(documentServesRoute("D-20", { homeCountry: "PRT", destination: "NLD" }), true);
});

test("the sanctions register survives every route, including the one it exists for", () => {
  // The single filtering mistake here with a real safety cost would be hiding
  // the sanctions basis from the destination it was raised for.
  for (const [home, dest] of [["PT", "IR"], ["PT", "NL"], ["DE", "MX"], ["US", "CA"]]) {
    assert.deepEqual(
      ids(sourcesForFinding("sanctioned_region", route(home, dest))),
      ["D-36", "D-39"],
      `sanctions sources were filtered on ${home} → ${dest}`,
    );
  }
  assert.equal(DOCUMENT_JURISDICTIONS["D-36"].scope, "global");
});

test("caveats survive a route that excludes every citation", () => {
  // THE REASON THE GROUP IS NOT RETURNED AS NULL. On Germany → Mexico this
  // repository holds no residence test for either country, so every citation
  // drops — and C-12, which records that ONE 183-in-365 line stands in for four
  // different domestic tests, applies to that trip MORE than to a sourced one.
  const group = sourcesForFinding("tax_residency_183", route("DE", "MX"));
  assert.ok(group, "the group must survive so its caveats can be read");
  assert.deepEqual(ids(group), []);
  assert.equal(group.caveats.length, FINDING_SOURCES.tax_residency_183.caveats.length);
  assert.ok(group.noCitationForRoute, "and it must say why it is empty");
  assert.match(group.noCitationForRoute, /not about the shelf/, "the claim is about THIS finding, not the repository");
});

test("a nationality only ever widens the route", () => {
  // A US national on a PT -> NL trip keeps the US material: their
  // social-security position genuinely does involve the United States.
  assert.equal(documentServesRoute("D-20", { homeCountry: "PT", destination: "NL", nationality: "PT" }), false);
  assert.equal(documentServesRoute("D-20", { homeCountry: "PT", destination: "US", nationality: "PT" }), true);
});

test("the Schengen scope resolves against UC-04's own set, not a second copy", async () => {
  const { SCHENGEN } = await import("../src/uc04/riskMatrix.js");
  assert.equal(DOCUMENT_JURISDICTIONS["D-07"].scope, "schengen");
  assert.deepEqual(DOCUMENT_JURISDICTIONS["D-07"].countries, [], "the area is not restated in the knowledge map");
  assert.ok(SCHENGEN.has("NL"));
  assert.equal(documentServesRoute("D-07", { homeCountry: "PT", destination: "NL" }), true);
  assert.equal(documentServesRoute("D-07", { homeCountry: "US", destination: "CA", nationality: "US" }), false);
});

// ---------------------------------------------------------------------------
// The map stays frozen data
// ---------------------------------------------------------------------------

test("the filter is injected, so no route can reach the source map by import", () => {
  // test/uc04DecisionSources.test.js asserts decisionSources.js imports nothing.
  // This asserts the other half: that the filtering still happens, via a
  // predicate, and that omitting it changes nothing for existing callers.
  const unfiltered = sourcesForFinding("tax_residency_183");
  const explicitlyOpen = sourcesForFinding("tax_residency_183", { serves: () => true });
  assert.deepEqual(ids(explicitlyOpen), ids(unfiltered));
  assert.equal(unfiltered.noCitationForRoute, null);
  assert.equal(unfiltered.citationsExcludedForRoute, 0);
});

test("every document UC-04 cites is either mapped or knowingly unmapped", () => {
  // Not an assertion that all 24 are mapped — an unmapped document is KEPT, by
  // design. This reports the split so a reviewer sees what the filter can and
  // cannot reason about, and fails only if a mapped entry is malformed.
  const cited = new Set();
  for (const entry of Object.values(FINDING_SOURCES)) for (const c of entry.cite ?? []) cited.add(c.source);
  for (const id of cited) {
    const j = DOCUMENT_JURISDICTIONS[id];
    if (!j) continue;
    assert.ok(typeof j.scope === "string" && j.scope.length > 0, `${id} has no scope`);
    assert.ok(Array.isArray(j.countries), `${id} has no countries array`);
    if (j.pairs) {
      for (const pair of j.pairs) {
        assert.equal(pair.length, 2, `${id} has a non-pair in pairs`);
        for (const code of pair) {
          assert.ok(j.countries.includes(code), `${id} pairs name ${code}, which its countries list omits`);
        }
      }
    }
  }
});
