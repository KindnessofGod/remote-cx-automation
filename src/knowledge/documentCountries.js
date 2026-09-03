// ---------------------------------------------------------------------------
// documentCountries.js — which jurisdictions does each retrieved document speak
//                        for, stated once and by hand
// ---------------------------------------------------------------------------
// WHY THIS IS HAND-WRITTEN AND NOT DERIVED
//
// It would be easy to infer a document's countries from its filename ("D-24-nl-
// pt-tax-convention" → NL, PT) and it would be wrong twice over. Three sidecars
// cover MORE than one instrument each — `D-21+D-22+D-23` is Canada's social
// security agreements with three partners, `D-27+D-28+D-29` is the US
// conventions with the Netherlands, Portugal AND Canada — and the EU
// regulations speak for every member state without naming one in the filename.
// A filename heuristic would silently under-tag the first class and drop the
// second entirely, and an under-tagged document is invisible to a country
// filter: it does not error, it just never comes back.
//
// So the map is written out, one line per document, and a test asserts every
// document in the corpus has an entry. A NEW document with no entry FAILS the
// test rather than defaulting to "no countries" — because "no countries" is
// indistinguishable from "never matched" at the point a specialist reads the
// dossier, which is the failure this whole file exists to remove.
//
// MULTILATERAL IS NOT A COUNTRY LIST. `scope: "eu"` and `scope: "model"` are
// their own thing: an EU regulation genuinely governs an NL↔PT question, and
// the OECD Model genuinely governs nothing at all — it is the template real
// conventions are drafted from. Both are admitted to a query, and the second is
// ranked below any real instrument, because CLAUDE.md §7 item 17 records the
// precise harm: "a model in place of an instrument ... reads exactly like an
// answer."
// ---------------------------------------------------------------------------

/** EU/EEA member states whose questions an EU regulation genuinely answers. */
export const EU_MEMBER_STATES = Object.freeze([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO",
]);

/**
 * @typedef {object} DocumentJurisdiction
 * @property {string[]} countries  ISO-3166-1 alpha-2 codes this document speaks for
 * @property {"bilateral"|"domestic"|"eu"|"model"|"register"} scope
 * @property {"instrument"|"administrative"|"model"} authority
 *   `instrument` = a treaty or statute in force. `administrative` = an agency's
 *   own reading of one. `model` = a template that governs nothing. The
 *   retriever ranks in that order, so a convention always outranks a model.
 * @property {string} note  why these codes and not others
 */

/** @type {Record<string, DocumentJurisdiction>} */
export const DOCUMENT_JURISDICTIONS = Object.freeze({
  // --- social security coordination -----------------------------------------
  "D-17": {
    countries: EU_MEMBER_STATES, scope: "eu", authority: "instrument",
    note: "Regulation 883/2004 coordinates social security across every EU/EEA state; it names no pair, so it is tagged with all of them.",
  },
  "D-18": {
    countries: EU_MEMBER_STATES, scope: "eu", authority: "instrument",
    note: "Regulation 987/2009 is 883/2004's implementing regulation — same reach.",
  },
  "D-19": {
    countries: EU_MEMBER_STATES, scope: "eu", authority: "administrative",
    note: "The Commission's practical guide reads the two regulations; it is guidance, not the instrument.",
  },
  "D-20": {
    countries: ["US", "NL", "PT", "CA"], scope: "bilateral", authority: "administrative",
    pairs: [["US", "NL"], ["US", "PT"], ["US", "CA"]],
    note: "The SSA's totalization status table. Tagged with the US plus the demo partners whose rows it carries.",
  },
  "D-21+D-22+D-23": {
    countries: ["CA", "NL", "PT"], scope: "bilateral", authority: "instrument",
    pairs: [["CA", "NL"], ["CA", "PT"]],
    note: "One sidecar, three instruments: Canada's agreements with the Netherlands (E102196/E102195 and its successor) and Portugal (E102185). CA is on every row; NL and PT each on their own.",
  },

  // --- income tax conventions -----------------------------------------------
    // -------------------------------------------------------------------------
  // ADDED 2026-08-30 FOR UC-04's CURATED CITATION MAP (§3.100)
  // -------------------------------------------------------------------------
  // These twelve are NOT in the citation corpus — `DOWNLOAD-MANIFEST.md` routes
  // them to no feed, so the generator never looks them up and CITATION_PASSAGES
  // is unchanged by their presence. They are here because
  // `src/uc04/decisionSources.js` cites them by hand and had no way to ask which
  // jurisdictions a document governs, so it cited the U.S. Social Security
  // Administration and the Canada Revenue Agency on a Portugal → Netherlands
  // trip, and on Portugal → Iran.
  //
  // THE MAP IS DOCUMENT-CENTRIC AND THAT IS THE POINT. A jurisdiction is a
  // property of the instrument, not of the use case reading it, so it lives
  // once, here, beside the corpus entries — the same reasoning that made UC-04
  // import UC-03's restricted-destination set rather than copy it (CLAUDE.md §7
  // item 2: "two copies drift").
  //
  // TWO SCOPES ARE DELIBERATELY LEFT UNRESOLVED HERE. `schengen` names an area
  // whose membership this file would otherwise have to restate — and
  // `src/uc04/riskMatrix.js` already holds that set and GATES on it, so a second
  // copy would be a second answer. `global` is not a list at all: a sanctions
  // register applies to whatever destination is asked about. The consuming
  // filter resolves both against its own sets; see documentServesRoute().

  "D-07": { countries: [], scope: "schengen", authority: "instrument",
    note: "Schengen Borders Code, Regulation (EU) 2016/399 — entry conditions and the 90/180 rule. Governs entry INTO the Schengen area; it says nothing about a route that does not touch it." },
  "D-08": { countries: [], scope: "schengen", authority: "instrument",
    note: "Council Decisions (EU) 2024/210 and 2024/3212 — what dates Bulgaria and Romania into the Schengen set. Only ever relevant where the Schengen set is." },
  "D-09": { countries: [], scope: "schengen", authority: "instrument",
    note: "Regulation (EU) 2018/1806 Annexes I and II — visa requirement and exemption for entry to the Schengen area." },

  "D-10": { countries: ["PT"], scope: "domestic", authority: "instrument",
    note: "Lei n.º 23/2007 art. 61.º-B — the article creating Portugal's remote-work residence visa (the D8). Portuguese law." },
  "D-11": { countries: ["PT"], scope: "domestic", authority: "administrative",
    note: "The D8's conditions as Portugal's own consular network states them. Portuguese administrative practice." },
  "D-14": { countries: ["US"], scope: "domestic", authority: "administrative",
    note: "US Visa Waiver Program and ESTA — Department of State and CBP. About admission to the United States." },
  "D-15": { countries: ["US"], scope: "domestic", authority: "administrative",
    note: "USCIS on the B-1 temporary business visitor. About admission to the United States." },
  "D-16": { countries: ["CA"], scope: "domestic", authority: "instrument",
    note: "Immigration and Refugee Protection Regulations ss. 186 and 187 — working without a work permit in Canada." },

  // BILATERAL, AND THE PAIRS ARE THE WHOLE POINT. Canada's agreement network is
  // wider than three cells; what is asserted here is only that each listed pair
  // IS covered by this document, which is what the filter needs. A pair absent
  // from this list is not thereby declared uncovered — it is declared not
  // answered BY THIS DOCUMENT, which is a statement about our shelf, not about
  // the world.
  "D-21": { countries: ["CA", "NL", "PT", "US"], scope: "bilateral", authority: "administrative",
    pairs: [["CA", "NL"], ["CA", "PT"], ["CA", "US"]],
    note: "The CRA's agreement table with the Netherlands and Portugal cells, plus forms CPT63/CPT55. Every cell is a pair involving Canada." },
  // UC-04 cites the three US conventions under the bare id `D-27`; the citation
  // corpus chunks the same file under `D-27+D-28+D-29`. Same pairs, deliberately
  // — if these two ever disagree, one of them is wrong about the instrument.
  "D-27": { countries: ["US", "NL", "PT", "CA"], scope: "bilateral", authority: "instrument",
    pairs: [["US", "NL"], ["US", "PT"], ["US", "CA"]],
    note: "The three US income tax conventions, employment-income articles 16(2) / XV(2)." },

  // GLOBAL, AND FAILING OPEN IS CORRECT HERE. A sanctions register is asked
  // about whatever destination is in front of it; scoping these to a country
  // list would be the one filtering mistake with a real safety cost, because it
  // could hide the sanctions basis from the destination it was raised for.
  "D-36": { countries: [], scope: "global", authority: "administrative",
    note: "OFAC country programmes, the EU Sanctions Map regime register and Canada's autonomous list. Consulted for ANY destination." },
  "D-39": { countries: [], scope: "global", authority: "administrative",
    note: "UN Security Council Consolidated List — the register entry. Consulted for ANY destination." },

  "D-24": {
    countries: ["NL", "PT"], scope: "bilateral", authority: "instrument",
    pairs: [["NL", "PT"]],
    note: "The Netherlands–Portugal convention. The one pair both non-US demo countries share.",
  },
  "D-25": {
    countries: ["CA", "NL"], scope: "bilateral", authority: "instrument",
    pairs: [["CA", "NL"]],
    note: "The Canada–Netherlands convention.",
  },
  "D-26": {
    countries: ["CA", "PT"], scope: "bilateral", authority: "instrument",
    pairs: [["CA", "PT"]],
    note: "The Canada–Portugal convention.",
  },
  "D-27+D-28+D-29": {
    countries: ["US", "NL", "PT", "CA"], scope: "bilateral", authority: "instrument",
    pairs: [["US", "NL"], ["US", "PT"], ["US", "CA"]],
    note: "One sidecar, three conventions: US–NL (D-27), US–PT (D-28), US–CA (D-29). The US is on every one; the partner differs per chunk, which is why the lexical rank — not this map — picks between them.",
  },

  // --- domestic residence rules ---------------------------------------------
  "D-31": {
    countries: ["NL"], scope: "domestic", authority: "instrument",
    note: "Algemene wet inzake rijksbelastingen art. 4 — the Dutch domestic residence rule.",
  },
  "D-32": {
    countries: ["PT"], scope: "domestic", authority: "instrument",
    note: "Codigo do IRS artigo 16 — the Portuguese domestic residence rule.",
  },
  "D-33": {
    countries: ["CA"], scope: "domestic", authority: "instrument",
    note: "Income Tax Act s. 250 — Canada's deemed-resident rule.",
  },
  "D-34": {
    countries: ["CA"], scope: "domestic", authority: "administrative",
    note: "CRA Income Tax Folio S5-F1-C1. The manifest marks it corpus-only: a facts-and-circumstances judgement that must never reach a conditional, so it is admitted to READING and ranked as administrative.",
  },
  "D-35": {
    countries: ["US"], scope: "domestic", authority: "instrument",
    note: "The substantial presence test and Publication 519. A residence test for non-citizens — it does not answer the citizenship question (see CITIZENSHIP_BASED_TAXATION in src/uc08/jurisdictionKnowledge.js).",
  },
});

/**
 * Does this document speak for any of the countries a question named?
 *
 * PERMISSIVE ON PURPOSE. An empty `wanted` (a question that named no country we
 * recognise) admits everything — filtering to nothing there would turn a parsing
 * miss into an empty dossier, and an empty dossier is the state this work exists
 * to remove. The filter narrows a question that DID name countries; it never
 * manufactures a refusal out of an absence.
 */
export function documentServesCountries(documentId, wanted) {
  const entry = DOCUMENT_JURISDICTIONS[documentId];
  if (!entry) return false;
  if (!Array.isArray(wanted) || wanted.length === 0) return true;
  const want = wanted.map((c) => String(c).toUpperCase());

  // A BILATERAL INSTRUMENT NEEDS BOTH OF ITS PARTIES, and this is the whole
  // reason `pairs` exists. Tagging D-24 as {NL, PT} and asking "does it serve
  // any wanted country?" makes the Netherlands–Portugal convention answer a
  // US→Portugal question, because Portugal is on both. It is a real treaty, it
  // is not THIS pair's treaty, and it reads as authoritative — the same class
  // of harm as offering a model where an instrument belongs, one step subtler.
  //
  // Three sidecars carry more than one instrument (Canada's two social-security
  // agreements; the three US conventions), so the parties cannot be read off
  // `countries` — a doc covering US–NL, US–PT and US–CA has four codes and no
  // way to say which go together. `pairs` says it explicitly.
  if (Array.isArray(entry.pairs) && want.length >= 2) {
    return entry.pairs.some((pair) => pair.every((c) => want.includes(c)));
  }
  return want.some((c) => entry.countries.includes(c));
}

/** Rank order for `authority`. Lower sorts first: an instrument beats a model. */
export const AUTHORITY_RANK = Object.freeze({ instrument: 0, administrative: 1, model: 2 });
