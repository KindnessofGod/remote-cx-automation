// ---------------------------------------------------------------------------
// jurisdictionKnowledge.js  —  what this system knows about the countries a
// dossier is ABOUT, and — the part that matters — what it does not
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-08 is 🔴 and has no execution path, so the dossier IS the deliverable. Run
// as a scenario rather than read as code, a CA→NL totalization inquiry reached a
// Tax Operations specialist carrying a confident **273-day presence count and an
// empty `jurisdictions` array** (docs/DEMO-COUNTRIES.md §6.7, case UC08-CANL-1).
// Nothing in that dossier was false. `inquiryParser.js`'s `KNOWN_COUNTRIES` held
// nine entries and neither `netherlands` nor `canada` was among them, so no
// country was named — and a country nobody named is correctly not listed.
//
// That is the "said less than it knew" pattern (C-27 / P7) in the one use case
// where it does the most damage. A day count with no jurisdiction beside it is
// not a weaker answer than one with jurisdictions; it is an answer to a
// DIFFERENT question, printed in the same shape. "273 days" invites the reader
// to supply the missing half from memory — and the half they supply will be the
// 183-day frame the corpus cites, which is a residence test that may not be the
// test any of the countries in play actually apply.
//
// WHY NOT JUST ADD `netherlands` AND `canada` TO THE DICTIONARY
// Two entries would close two cases and leave the trap armed for the ~200
// countries still missing, in a form that is now harder to see because the
// obvious examples work. The dictionary is widened anyway (it should be — see
// inquiryParser.js), but the durable fix is structural: a day count can no
// longer be rendered without a statement of what is KNOWN about the
// jurisdiction it is a count of, and "nothing is known" is one of the things
// that statement is able to say out loud.
//
// THE MODEL IS src/uc04/decisionFacts.js, and it is deliberate. That file
// separates `unknown` from `cleared` and `suppressed` from `within_limit`
// because a check that never ran approved of nothing. The same distinction
// appears here one level down, at the level of the reference data a check would
// have needed:
//
//   "no_residence_test_held" — the country IS in this register, and what the
//                              register honestly holds for it is NOTHING. A
//                              recorded, deliberate gap, with a named pointer to
//                              the authority that would close it.
//   "not_in_register"        — the country is not in this register at all. Not a
//                              statement that no rule exists; a statement that
//                              this system has never looked.
//   "held"                   — a sourced residence test IS held. NOTHING RETURNS
//                              THIS TODAY. The state exists so that adding real
//                              content later is a data change rather than a
//                              rewrite, and so a reader can see that the empty
//                              case is the empty case rather than the only case.
//
// WHAT THIS FILE MAY NOT DO — and this is the hard rule, not a style note.
// It may not encode a threshold, a window, a treaty article, or a residence
// rule for any country. Not 183. Not 365. Not "a taxation year". Every entry
// below therefore carries `residenceTest: null` and says so in words, and names
// — as an attribution to docs/knowledge/DOWNLOAD-MANIFEST.md, never as an
// assertion of law — which document would supply the real answer. The manifest
// marks its own URLs unverified; this file inherits that and repeats it, because
// a pointer presented as a citation is the same defect one layer removed.
//
// PURE, AND IT DECIDES NOTHING. Same contract as decisionFacts.js: no gate reads
// it, no route consults it, it takes no client of any kind, and it cannot change
// UC-08's one and only decision, which is `escalate`, always.
// ---------------------------------------------------------------------------

import { normalizeCountryCode } from "../shared/countryCodes.js";
import { countryLabel } from "../shared/countryNames.js";

/**
 * What this register IS, in the shape src/uc04/riskMatrix.js's
 * DNV_COUNTRIES_PROVENANCE established — because a table whose limits live only
 * in a code comment is a table whose limits no downstream reader ever sees.
 *
 * `authority`, `version` and `reviewedOn` are null ON PURPOSE. A plausible-
 * looking authority or a placeholder review date is exactly the manufactured
 * value this project has paid for repeatedly.
 */
export const JURISDICTION_REGISTER_PROVENANCE = Object.freeze({
  table: "JURISDICTION_REGISTER",
  status: "[PROPOSED] — no authority; holds no legal content at all",
  authority: null,
  version: null,
  reviewedOn: null,
  effect: "describes",
  effectDetail:
    "Membership adds no rule and removes none. Every entry records the ABSENCE of a residence test for that country plus a pointer to the document that would supply one, so that a dossier can state what it does not know instead of leaving the space blank.",
  basis:
    "A four-entry register covering the demo countries only (docs/DEMO-COUNTRIES.md). It contains no thresholds, no windows and no treaty articles — and the REASON has changed since it was written, without the content changing at all. It used to be that nothing could be cited: every statutory URL in docs/knowledge/DOWNLOAD-MANIFEST.md was marked NOT VERIFIED and this container's egress policy refused every authority. All four are now retrieved, vendored and cited per jurisdiction by src/uc08/decisionSources.js. They are still not encoded here, because the four tests are four different shapes — one of them has no day count at all — and a single number lifted out of one is a number that will be compared against the wrong country.",
  needsForARealRegister: Object.freeze([
    "The residence tests themselves, read from the primary sources docs/knowledge/DOWNLOAD-MANIFEST.md §8 names per country, each stored with its instrument, its publication date and the date it was read.",
    "The bilateral instruments for the pairs a dossier actually reaches (manifest entries D-24 to D-30), so that a jurisdiction PAIR can be described rather than two jurisdictions separately.",
    "A named owner and a review date per entry, with an alert when the review date passes — docs/knowledge/README.md calls this the honest control and notes it is a staffing answer, not an engineering one.",
    "A rule that no citation id and no threshold from this register may ever appear in a conditional: this data is for a human to read, never for a gate to branch on.",
  ]),
  reference: "docs/knowledge/DOWNLOAD-MANIFEST.md §8 (Groups D and E — tax treaties and residence tests)",
});

/**
 * The one gap that is not about any single country's threshold, and the reason
 * it gets its own exported constant rather than a line inside the US entry.
 *
 * docs/DEMO-COUNTRIES.md §6.8 recorded it as a SILENCE: a dossier about a US
 * citizen living in Portugal came back with a presence count, a 183-day
 * citation, and no field, flag or citation anywhere in it mentioning
 * citizenship. `grep -rni "citizen" src/` matched only comments noting that
 * Remote's employment record carries no nationality field.
 *
 * A silence and a considered "not assessed" are indistinguishable to the reader
 * and opposite in meaning, which is the whole subject of this file. So the state
 * is now stated, and it is stated on EVERY dossier rather than only where a US
 * connection was detected — because detection is precisely what this system
 * cannot do. There is no nationality or citizenship input anywhere in UC-08's
 * request shape, so a US person can appear in ANY dossier, including one whose
 * jurisdiction list names no US at all. Conditioning the disclosure on spotting
 * "US" would rebuild the same silence behind a dictionary lookup.
 *
 * NOTE WHAT IS NOT CLAIMED HERE. This does not state a rule of US law. It states
 * two facts about THIS SYSTEM — that it holds no citizenship input and performs
 * no citizenship-based analysis — and attributes the reason the question matters
 * to docs/DEMO-COUNTRIES.md §6.8, which is a document in this repository, not a
 * legal source. The manifest has no entry covering citizenship-based taxation at
 * all; its nearest neighbour (D-35) is the substantial-presence test, which is a
 * RESIDENCE test for non-citizens and does not answer this question.
 */
export const CITIZENSHIP_BASED_TAXATION = Object.freeze({
  key: "citizenship_based_taxation",
  assessed: false,
  status: "[PROPOSED] — no authority; not assessed by this system",
  statement:
    "Citizenship-based taxation is NOT ASSESSED anywhere in this dossier. Every figure and every citation here is framed as a RESIDENCE question — where a person was, for how long. No request field in this use case carries a nationality, citizenship or passport, and no rule here reads one, so a dossier cannot tell a US-connected person from any other and does not try. If this requester holds a citizenship whose country taxes on that basis rather than on residence, nothing above addresses it, and the day count in particular does not.",
  whyItIsStatedOnEveryDossier:
    "Because this system cannot detect who it applies to. There is no citizenship input to condition on, so disclosing only where a US connection was spotted would reproduce the original silence for everyone it failed to spot.",
  wouldBeSuppliedBy: Object.freeze({
    manifestEntry: null,
    reference: "docs/knowledge/DOWNLOAD-MANIFEST.md §8 — no entry covers citizenship-based taxation",
    note:
      "The nearest manifest entry, D-35, is the US substantial-presence test: a residence test for non-citizens, which is a different question. Closing this gap needs both a source for the rule AND a citizenship field on the request, and the second is a data-model change, not a document.",
  }),
  reference: "docs/DEMO-COUNTRIES.md §6.8",
});

function entry({ code, name, manifestEntry, namedSource, manifestNote }) {
  return Object.freeze({
    code,
    name,
    // NEVER a number, NEVER a shape. See this file's header.
    residenceTest: null,
    thresholdDays: null,
    windowDays: null,
    knowledge: "no_residence_test_held",
    status: "[PROPOSED] — no authority",
    authority: null,
    version: null,
    reviewedOn: null,
    statement:
      `This system holds no residence test for ${name}. No day threshold, no measurement window and no test of any shape is encoded here for it, so nothing in this dossier states — or is capable of stating — whether anyone is resident there.`,
    wouldBeSuppliedBy: Object.freeze({
      manifestEntry,
      reference: `docs/knowledge/DOWNLOAD-MANIFEST.md § ${manifestEntry}`,
      // ATTRIBUTION, NOT ASSERTION. The manifest names this source; this file
      // repeats the name and repeats the manifest's own caveat. Nothing here
      // claims to have read it.
      namedSource,
      // ⚠ SUPERSEDED IN PART, AND THE PART THAT SURVIVES IS THE POINT.
      // When this register was written, every statutory URL in the manifest was
      // marked NOT VERIFIED and nobody on this project had read any instrument.
      // The 2026-08-19 retrieval passes closed that: all four demo countries'
      // residence tests are now vendored under docs/knowledge/layer-1-statutory/
      // with a publisher, an exact URL, a retrieval date and — where the licence
      // allowed a copy — a checksum, and src/uc08/decisionSources.js cites them
      // per jurisdiction and quotes them. What has NOT changed, and must not, is
      // this register: it still encodes no threshold, no window and no rule of
      // any shape, because the four tests are four different shapes and a number
      // lifted out of one of them is a number something downstream will compare.
      caveat:
        "The manifest marked this URL NOT VERIFIED when this register was written, and nobody had read the instrument. That is no longer true — it was retrieved on 2026-08-19, is vendored with full provenance, and is quoted on this dossier by src/uc08/decisionSources.js. What this register holds is still nothing: no threshold, no window, no rule, deliberately.",
      ...(manifestNote ? { note: manifestNote } : {}),
    }),
  });
}

/**
 * The register. Four entries, one per demo country (docs/DEMO-COUNTRIES.md),
 * and every one of them records an absence.
 *
 * Deliberately NOT extended to the other five countries `inquiryParser.js`'s
 * dictionary can match (DE, ES, GB, FR, NG). Those resolve to `not_in_register`,
 * which is the honest state: nobody has looked for them either, and a register
 * padded with entries that say nothing would make "in the register" stop meaning
 * anything. `not_in_register` and `no_residence_test_held` differ in exactly one
 * way — whether the gap is RECORDED with a route to closing it — and that
 * difference is worth keeping visible.
 */
export const JURISDICTION_REGISTER = Object.freeze({
  NL: entry({
    code: "NL",
    name: "the Netherlands",
    manifestEntry: "D-31",
    namedSource:
      "Algemene wet inzake rijksbelastingen art. 4 (BWBR0002320), published by Overheid.nl / wetten.overheid.nl",
    manifestNote:
      "The manifest flags this as the entry most likely to change the design's mind: it records that the Dutch domestic rule is not shaped like a day count at all, which is why no number is carried here for it.",
  }),
  PT: entry({
    code: "PT",
    name: "Portugal",
    manifestEntry: "D-32",
    namedSource: "Código do IRS artigo 16.º, published by Diário da República Eletrónico",
    manifestNote:
      "The manifest records that the open question for Portugal is the WINDOW a count is taken over, not the number — and that `computePresenceDays()` takes its window from its caller, tied to no country's rule.",
  }),
  CA: entry({
    code: "CA",
    name: "Canada",
    manifestEntry: "D-33",
    namedSource:
      "Income Tax Act R.S.C. 1985 c. 1 (5th Supp.) s. 250, published by the Justice Laws Website; and CRA Income Tax Folio S5-F1-C1 (manifest entry D-34)",
    manifestNote:
      "D-34 is listed by the manifest as corpus-only material: an administrative residence analysis that looks like a grid and is a facts-and-circumstances judgement. It must never reach a conditional.",
  }),
  US: entry({
    code: "US",
    name: "the United States",
    manifestEntry: "D-35",
    namedSource: "The substantial presence test and Publication 519, published by the Internal Revenue Service",
    manifestNote:
      "D-35 covers a RESIDENCE test for non-citizens. It does not answer the citizenship question — see CITIZENSHIP_BASED_TAXATION, which no manifest entry covers.",
  }),
});

/** Roles a country can hold in one dossier. A country may hold both. */
const ROLE_NAMED = "named_in_request";
const ROLE_PRESENCE_SUBJECT = "presence_count_subject";

function lookup(code) {
  return JURISDICTION_REGISTER[code] ?? null;
}

function describeOne(code, roles) {
  const held = lookup(code);
  if (held) {
    return {
      code,
      name: held.name,
      roles,
      knowledge: held.knowledge, // "no_residence_test_held"
      statement: held.statement,
      status: held.status,
      wouldBeSuppliedBy: held.wouldBeSuppliedBy,
    };
  }
  return {
    code,
    name: null,
    roles,
    knowledge: "not_in_register",
    // The distinction this whole file exists for, spelled out in the sentence a
    // specialist actually reads.
    statement:
      `${countryLabel(code)} is not in this system's jurisdiction register at all. That is not a finding that no residence rule exists there — it is a statement that this system has never looked, holds nothing for it, and cannot say anything about residence in ${countryLabel(code)}.`,
    status: "[PROPOSED] — no authority; country not registered",
    wouldBeSuppliedBy: {
      manifestEntry: null,
      reference: "docs/knowledge/DOWNLOAD-MANIFEST.md §8",
      namedSource: null,
      caveat:
        "The manifest covers the four demo countries (NL, PT, CA, US) only. A source for this country would have to be added to it before anything could be held here.",
    },
  };
}

/**
 * Everything a reader needs in order to know what a jurisdiction figure in this
 * dossier is, and is not, a figure about.
 *
 * `statement` is NEVER empty and never omitted. That is the structural
 * guarantee this function exists to provide: dossierBuilder.js attaches this
 * block to every dossier and dossierView.js appends its statement to every
 * presence figure, so a day count with no jurisdiction context is no longer a
 * shape this system can produce — the worst case is a count travelling with an
 * explicit, legible statement that its jurisdictions are unknown.
 *
 * @param {object} args
 * @param {string[]} [args.jurisdictions]      codes the request text named
 * @param {string|null} [args.presenceCountry] the country a day count was taken IN
 * @param {{status?:string, days?:number|null}|null} [args.presenceDays]
 * @returns {{
 *   state: "none_identified"|"no_knowledge_held"|"partial"|"held",
 *   inPlay: Array<object>,
 *   presenceCountry: string|null,
 *   presenceCountryNamedInRequest: boolean,
 *   dayCountPresent: boolean,
 *   statement: string,
 *   citizenship: typeof CITIZENSHIP_BASED_TAXATION,
 *   provenance: typeof JURISDICTION_REGISTER_PROVENANCE
 * }}
 */
export function describeJurisdictionCoverage({ jurisdictions = [], presenceCountry = null, presenceDays = null } = {}) {
  const named = [];
  for (const j of Array.isArray(jurisdictions) ? jurisdictions : []) {
    const code = normalizeCountryCode(j);
    if (code && !named.includes(code)) named.push(code);
  }
  const subject = normalizeCountryCode(presenceCountry) || null;

  // THE UNION IS THE POINT. The count's subject country arrives as structured
  // input (`targetCountry`), not from the text parser, so it is present even
  // when the parser recognised nothing at all — which is exactly the CA→NL case
  // that started this. A dossier that names no jurisdiction but counts days in
  // one is not a dossier with no jurisdictions.
  const codes = subject && !named.includes(subject) ? [...named, subject] : [...named];

  const inPlay = codes.map((code) => {
    const roles = [];
    if (named.includes(code)) roles.push(ROLE_NAMED);
    if (subject === code) roles.push(ROLE_PRESENCE_SUBJECT);
    return describeOne(code, roles);
  });

  const dayCountPresent = Boolean(presenceDays) && presenceDays.status === "COUNTED" && presenceDays.days !== null;
  const anyHeld = inPlay.some((j) => j.knowledge === "held");
  const state = inPlay.length === 0 ? "none_identified" : anyHeld ? (inPlay.every((j) => j.knowledge === "held") ? "held" : "partial") : "no_knowledge_held";

  return {
    state,
    inPlay,
    presenceCountry: subject,
    presenceCountryNamedInRequest: Boolean(subject) && named.includes(subject),
    dayCountPresent,
    statement: composeStatement({ inPlay, named, subject, dayCountPresent, state }),
    citizenship: CITIZENSHIP_BASED_TAXATION,
    provenance: JURISDICTION_REGISTER_PROVENANCE,
  };
}

/**
 * A country in this dossier, named rather than coded.
 *
 * The register already carries a display name for the four it holds ("the
 * Netherlands"); everything else goes through the shared `countryLabel()`,
 * which passes a value that is not code-shaped through untouched. Codes stay on
 * `code` — they are what a treaty index and a totalization table are keyed by,
 * and the sidebar prints them beside the name in the one row that is a
 * reference line. This is prose, so it gets the name alone.
 */
const jurisdictionName = (entry) => entry?.name ?? countryLabel(entry?.code);

/** "Canada and the Netherlands" — a list a person reads, not a joined array. */
function listOfNames(entries) {
  const names = entries.map(jurisdictionName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One country, and the reason it is in play at all.
 *
 * The two roles are not interchangeable and the difference is the whole subject
 * of this file: a country the REQUEST named is one the requester chose to raise,
 * and the country the day count was taken in arrives as structured input and may
 * never have appeared in the text. A reader who cannot tell them apart cannot
 * tell whether the figure they are looking at is about the country they think.
 */
function jurisdictionInPlayPhrase(entry) {
  const name = jurisdictionName(entry);
  const roles = Array.isArray(entry?.roles) ? entry.roles : [];
  const named = roles.includes(ROLE_NAMED);
  const counted = roles.includes(ROLE_PRESENCE_SUBJECT);
  if (named && counted) return `${name} (named in the request, and the country the presence-day count was taken in)`;
  if (counted) {
    return `${name} (the country the presence-day count was taken in, which the request text did not name — it came from the structured request)`;
  }
  return `${name} (named in the request)`;
}

/**
 * The sentence that travels with the number.
 *
 * Written so that the reader is never left to infer the missing half. Each
 * branch says three things in order: which countries are in play (or that none
 * is), how each of them got there, and what this system holds about them —
 * which today is always "nothing", said plainly.
 */
function composeStatement({ inPlay, named, subject, dayCountPresent, state }) {
  const parts = [];

  if (inPlay.length === 0) {
    parts.push(
      dayCountPresent
        ? "NO JURISDICTION IS IDENTIFIED FOR THIS DOSSIER, and a day count is nonetheless present. The count's own subject country was not recorded either, so the day count in this dossier is a number of days in an unstated country, measured against no country's rule."
        : "No jurisdiction is identified for this dossier: the request text named none, and no country was supplied to count presence days in."
    );
  } else {
    // ONE SENTENCE, NAMING EACH COUNTRY AND HOW IT GOT HERE — and deliberately
    // NOT a second announcement of what the request named. dossierBuilder.js's
    // template opens "This request names Canada, Netherlands." a few sentences
    // earlier; this used to follow it with "Jurisdictions named in the request:
    // CA, NL.", which is the same fact twice, once in a vocabulary the reader
    // does not use. What only this sentence can say is which countries are in
    // play and WHY each of them is — the count's subject country arrives as
    // structured input and may never have been named in the text at all, which
    // is exactly the CA→NL case this file exists for.
    parts.push(`Jurisdictions in play: ${inPlay.map(jurisdictionInPlayPhrase).join("; ")}.`);
    if (!named.length) {
      parts.push(
        "The request text named no jurisdiction that this system's country dictionary recognises — which is not the same as naming none, since that dictionary is a short curated list rather than an entity recogniser."
      );
    }
    if (!subject && dayCountPresent) {
      parts.push("The country the presence-day count was taken in was not recorded, so that figure has no stated subject.");
    }
  }

  // The knowledge half. This is the statement of not-knowing, and it is the
  // reason the block exists — a specialist who reads "273 days" beside a
  // 183-day citation must be told, in the same breath, that no residence test
  // for any country here is held by this system.
  if (state === "no_knowledge_held" || state === "none_identified") {
    const registered = inPlay.filter((j) => j.knowledge === "no_residence_test_held");
    const unregistered = inPlay.filter((j) => j.knowledge === "not_in_register");
    parts.push(
      "THIS SYSTEM HOLDS NO RESIDENCE TEST FOR ANY JURISDICTION IN PLAY — no threshold, no window, no rule of any shape."
    );
    if (registered.length) {
      // NOT a path into this repository. The reader of this sentence is a tax
      // specialist in a Zendesk sidebar; a filename they cannot open is not an
      // answer to "then where would the rule come from?". Each entry above
      // carries the instrument and its publisher in `wouldBeSuppliedBy`, which
      // is a source they can actually go and read.
      parts.push(
        `For ${listOfNames(registered)} the gap is recorded deliberately, and the instrument that would close it is named against each of them, with its publisher.`
      );
    }
    if (unregistered.length) {
      parts.push(
        `For ${listOfNames(unregistered)} not even that much is held: ${unregistered.length > 1 ? "those countries are" : "that country is"} absent from this system's register, so nobody has looked.`
      );
    }
    if (dayCountPresent) {
      parts.push(
        "So the day count is arithmetic over supplied travel records and nothing more. It is NOT measured against any jurisdiction's residence test, and the 183-day figure the reference corpus cites is a general model-convention article, not a rule of any country named here."
      );
    }
  } else {
    parts.push(
      `Residence-test knowledge is held for ${listOfNames(inPlay.filter((j) => j.knowledge === "held"))}; read each entry for its source and its limits.`
    );
  }

  // The citizenship gap is deliberately NOT concatenated here. It is a separate
  // sentence on the same block (`coverage.citizenship.statement`), because it is
  // not a fact about the countries in play — it is a fact about a question this
  // system never asks, and it is true of dossiers whose jurisdiction list is
  // perfect. Callers that render prose render both; the presence figure carries
  // this one, and the open-questions list carries that one.
  return parts.join(" ");
}
