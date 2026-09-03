// ---------------------------------------------------------------------------
// sourceJurisdiction.js  —  does this document govern this trip?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (2026-08-30, BUILD-LOG §3.100)
//
// `sourcesForFinding()` took a finding key and NOTHING ELSE, so a finding's
// citations were identical whatever countries the trip involved. Observed, on
// the flagship demo pair, under the "Totalization / treaty coverage" dimension
// of a Portugal → Netherlands workation:
//
//     treaty_coverage_unconfirmed
//       D-20   U.S. Social Security Administration
//       D-21   Canada Revenue Agency (CPP/EI Rulings)
//
// Neither authority has anything to do with a Portuguese employee spending a
// fortnight in the Netherlands, and the same two were the ONLY sources shown
// for Portugal → Iran. UC-05, UC-07 and UC-08 have each taken a jurisdiction
// argument for some time; UC-04 was the one that never did.
//
// WHY IT IS A SEPARATE FILE AND NOT A FEW LINES IN decisionSources.js.
// `test/uc04DecisionSources.test.js` asserts that decisionSources.js imports
// NOTHING — "it is frozen data and must stay that way" — with the sibling
// assertion that policyEngine, riskMatrix, approvalPolicy and workflow must
// never import IT, because "a citation must never be able to change an
// outcome". Reaching the other way, into riskMatrix.js for SCHENGEN, would have
// coupled the source map to the gate engine in exactly the direction that guard
// keeps clear. So the map stays inert and takes a predicate; the knowledge
// lives here.
//
// ---------------------------------------------------------------------------
// THE RULE: IT CAN ONLY EVER REMOVE, AND ONLY ON POSITIVE EVIDENCE
// ---------------------------------------------------------------------------
// An unmapped document is KEPT. An unrecognised scope is KEPT. A request with
// no readable route is KEPT. The asymmetry is deliberate and it is the whole
// safety argument: showing a specialist one document too many costs them a
// moment, while hiding the instrument that governs their case costs them the
// decision. It is the same rule `src/shared/byTicketAccountGuard.js` states for
// its own refusal — refuse only on positive evidence of a mismatch — and the
// same one §3.98b's per-passage narrowing was built on.
//
// NATIONALITY COUNTS AS PART OF THE ROUTE, which also only ever widens: a US
// national on a Portugal → Netherlands trip keeps the US material, because
// their social-security position genuinely does involve the United States.
//
// TWO SCOPES ARE RESOLVED HERE RATHER THAN IN THE KNOWLEDGE MAP.
//   · `schengen` resolves against UC-04's OWN `SCHENGEN` set — the one it
//     already gates on — so there is never a second answer to "which countries
//     are Schengen" sitting in `src/knowledge/`.
//   · `global` is not a country list at all. A sanctions register is asked
//     about whatever destination is in front of it, and scoping D-36/D-39 would
//     be the one filtering mistake here with a real safety cost: it could hide
//     the sanctions basis from the destination it was raised for.
// ---------------------------------------------------------------------------

import { DOCUMENT_JURISDICTIONS } from "../knowledge/documentCountries.js";
import { SCHENGEN } from "./riskMatrix.js";

/**
 * @param {string} documentId  a `SOURCE_LIBRARY` key, e.g. "D-20"
 * @param {{homeCountry?: string|null, destination?: string|null, nationality?: string|null}} route
 * @returns {boolean} false ONLY when the map positively says otherwise
 */
export function documentServesRoute(documentId, route = {}) {
  const entry = DOCUMENT_JURISDICTIONS[documentId];
  if (!entry) return true; // unmapped ⇒ no evidence either way ⇒ keep
  if (entry.scope === "global") return true;

  const involved = [route.homeCountry, route.destination, route.nationality]
    .filter((c) => typeof c === "string" && c.length === 2)
    .map((c) => c.toUpperCase());
  if (involved.length === 0) return true; // nothing to exclude on

  if (entry.scope === "schengen") return involved.some((c) => SCHENGEN.has(c));

  /* AN EU COORDINATION INSTRUMENT NEEDS BOTH ENDS INSIDE THE EU, for the same
     reason a bilateral treaty needs both its parties (2026-08-31). Regulation
     883/2004 coordinates social security BETWEEN Member States; it does not
     govern a trip from a non-member. Tagged with all thirty codes and matched
     with `.some()`, it survived on a United States → Netherlands route because
     the Netherlands is on the list — and once the covered-coverage finding
     started citing it, the page would have named the EU regulation as an
     instrument in force for a pair the United States is one half of. That is
     the "OECD Model on a DE/ES question" defect one level down: the right
     family of document, the wrong jurisdiction, printed with a real publisher
     and a real retrieval date.

     WORK SIDE ONLY, AND NOT NATIONALITY. What 883/2004 keys on is where the
     person works and where they are posted, never what passport they hold —
     art. 11(3)(a) is about "pursuing an activity", and a third-country national
     legally resident in a Member State is inside the coordination, not outside
     it. Testing nationality here would drop the regulation from an intra-EU
     posting made by a US national, which is the opposite error.

     IT STILL ONLY EVER REMOVES, AND ONLY ON POSITIVE EVIDENCE: both endpoints
     have to be READ and one of them positively outside the Union. A route
     missing either end falls through to the membership test below unchanged. */
  if (entry.scope === "eu") {
    const ends = [route.homeCountry, route.destination]
      .filter((c) => typeof c === "string" && c.length === 2)
      .map((c) => c.toUpperCase());
    if (ends.length === 2) return ends.every((c) => entry.countries.includes(c));
  }

  // A BILATERAL INSTRUMENT NEEDS BOTH OF ITS PARTIES, NEVER ONE. This is the
  // rule that takes the US conventions off a Portugal → Netherlands trip: "US"
  // appearing somewhere in the route is not a reason to cite a US treaty, and
  // an `.includes` on a flat country list would have kept every one of them.
  if (Array.isArray(entry.pairs) && entry.pairs.length > 0) {
    return entry.pairs.some((pair) => pair.every((c) => involved.includes(c)));
  }

  if (!Array.isArray(entry.countries) || entry.countries.length === 0) return true;
  return involved.some((c) => entry.countries.includes(c));
}

/**
 * The predicate in the shape `sourcesForFinding()` wants. Bound to one route so
 * a caller cannot pass a different route to different findings on one page.
 *
 * @param {{homeCountry?: string|null, destination?: string|null, nationality?: string|null}} route
 * @returns {(documentId: string) => boolean}
 */
export function servesRoute(route) {
  return (documentId) => documentServesRoute(documentId, route);
}
