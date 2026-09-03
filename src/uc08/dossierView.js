// ---------------------------------------------------------------------------
// dossierView.js  —  what a Tax Ops specialist needs, ranked, derived at READ
// ---------------------------------------------------------------------------
// THE READER AND THE DECISION
// Reader: a Remote Tax Operations specialist. Decision: what guidance to author
// for this requester, and whether there is a residency / withholding /
// totalization exposure to act on. UC-08 has no execution path, so this dossier
// IS the product — if it omits what the decision turns on, it has failed at the
// only thing it does.
//
// WHY THIS IS DERIVED AT READ TIME AND NOT STORED
// Three reasons, in order of weight.
//   1. It works for BOTH execution paths. `uc08_dossiers` rows are written by
//      the Node app AND by the live n8n graph, and this pass may not edit
//      `workflows/`. Anything computed at write time would exist on half the
//      rows; anything derived from the stored row exists on all of them.
//   2. It adds no dependency, no parameter and no route. The 🔴 guarantee is
//      the ABSENCE of a write seam (see workflow.js / server.js / dossierStore.js
//      headers, and the structural tests that pin all three). A pure function
//      over a row that server.js spreads into a GET response cannot become an
//      execution path, whatever anyone later does to it.
//   3. Old rows gain the view too. A dossier written last month is read by the
//      same specialist as one written today.
//
// WHAT IT REFUSES TO DO
// It never invents and never defaults. Where the row cannot answer, the view
// says so in a sentence — `presenceStatement` on a row with no evidence block
// reports that the basis was not recorded, rather than rendering an empty
// period list as "no records were supplied", which is a different and much
// stronger claim. That distinction is F-38 one layer up.
// ---------------------------------------------------------------------------

import { TREATY_CORPUS, describeRetrievalMode } from "./treatyRetriever.js";
import { corpusStats } from "../knowledge/statutoryRetrieval.js";
import { describeJurisdictionCoverage } from "./jurisdictionKnowledge.js";
import {
  sourcesForFinding,
  uncitedFinding,
  pairKey,
  SOURCE_FRAMING,
  CAVEAT_FRAMING,
  CONFIRMATION_FRAMING,
  SOURCED_PAIRS,
} from "./decisionSources.js";

/**
 * The specialist-facing reading of one stored dossier row.
 *
 * @param {object|null} dossierRow  a row from DossierStore (or its `dossier` blob)
 * @returns {{
 *   presence: object,
 *   jurisdictionKnowledge: object,
 *   citationCoverage: object,
 *   openQuestions: Array<{code:string, question:string, priority:number}>
 * }}
 */
export function describeDossier(dossierRow) {
  const row = dossierRow ?? {};
  const dossier = row.dossier ?? {};
  const presenceDays = row.presenceDays ?? dossier.presenceDays ?? null;
  const evidence = dossier.presenceEvidence ?? null;
  const citations = Array.isArray(dossier.citations) ? dossier.citations : [];
  const jurisdictions = Array.isArray(row.jurisdictions) ? row.jurisdictions : dossier.jurisdictions ?? [];

  // RECOMPUTED AT READ TIME, not read off `dossier.jurisdictionCoverage`, for
  // reason (1) in this file's header: `uc08_dossiers` rows written by the live
  // n8n graph carry no coverage block (that port is a separate copy this pass
  // does not deploy), and rows written before this existed carry none either.
  // Deriving it from the row's own `jurisdictions` + evidence country gives
  // every row the statement, including the ones nobody can go back and rewrite.
  const jurisdictionKnowledge = describeJurisdictionCoverage({
    jurisdictions,
    presenceCountry: evidence?.country ?? null,
    presenceDays,
  });

  // WHICH JURISDICTIONS THIS DOSSIER IS ACTUALLY ABOUT. The country a count was
  // taken IN belongs in the list even when the text parser never named it —
  // that is the whole CA→NL defect (docs/DEMO-COUNTRIES.md §6.7) and the reason
  // this is derived from the evidence block as well as from `jurisdictions`.
  // Order is the request's, with the presence country appended if it is new, so
  // "the pair" is the pair a reader would name.
  const inPlay = [];
  for (const code of [...jurisdictions, evidence?.country ?? null]) {
    const upper = typeof code === "string" ? code.trim().toUpperCase() : "";
    if (upper && !inPlay.includes(upper)) inPlay.push(upper);
  }

  const presence = describePresence({ presenceDays, evidence, jurisdictionKnowledge });
  const statutory = describeStatutorySources({ inPlay, presenceCountry: evidence?.country ?? null });
  const citationCoverage = describeCitationCoverage({ citations, jurisdictions, statutory });

  return {
    presence,
    jurisdictionKnowledge,
    citationCoverage,
    // THE VENDORED INSTRUMENTS, per finding. Flat lists for an API reader and
    // the audit viewer; `basis` below is the same content in the shape the ZAF
    // sidebar's renderNarrativeBlock/renderSources already understand.
    sources: statutory.sources,
    uncited: statutory.uncited,
    basis: statutory.basis,
    openQuestions: collectOpenQuestions({
      presence,
      citationCoverage,
      jurisdictionKnowledge,
      inquiryType: row.inquiryType ?? dossier.inquiryType ?? null,
      jurisdictions,
      statutory,
      faithfulness: dossier.faithfulness ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// The statutory instruments
// ---------------------------------------------------------------------------
// WHY HERE AND NOT IN THE DOSSIER. Same three reasons as everything else in
// this file: `uc08_dossiers` rows written by the live n8n graph carry no
// citation map and never will from this pass, rows written before today carry
// none either, and a pure function of a stored row cannot become an execution
// path. A dossier compiled last month gains the Canada–Netherlands convention
// the moment it is next opened.
//
// WHAT IT WILL NOT DO. It never guesses a pair. Where a dossier names one
// jurisdiction, or none, or three, there is no pair to look a treaty up for and
// the block says so — a treaty picked from the two most likely of three
// countries would be a nearest match with a statute's authority behind it.
// ---------------------------------------------------------------------------

function describeStatutorySources({ inPlay, presenceCountry }) {
  const sources = [];
  const uncited = [];
  const push = (group, absence) => {
    if (group) sources.push(group);
    else if (absence) uncited.push(absence);
  };

  // ONE PER JURISDICTION IN PLAY, in the order the dossier names them. The
  // residence test is a fact about a country, so a country with no entry gets
  // an explicit "this corpus holds nothing for it" rather than a neighbour's.
  const residence = [];
  for (const country of inPlay) {
    const finding = country === presenceCountry ? "presence_day_count" : "residence_test";
    const group = sourcesForFinding(finding, { country });
    if (group) residence.push(group);
    push(group, uncitedFinding(finding, { country }));
  }

  // THE PAIR, AND ONLY IF THERE IS EXACTLY ONE. Two jurisdictions make a pair;
  // one, none or three do not, and inventing one is precisely the failure this
  // whole file refuses.
  const pair = inPlay.length === 2 ? [inPlay[0], inPlay[1]] : null;
  const key = pair ? pairKey(pair[0], pair[1]) : null;

  const treaty = pair ? sourcesForFinding("treaty_employment_article", { pair }) : null;
  push(treaty, pair ? uncitedFinding("treaty_employment_article", { pair }) : null);

  const social = pair ? sourcesForFinding("social_security_coverage", { pair }) : null;
  push(social, pair ? uncitedFinding("social_security_coverage", { pair }) : null);

  // THE THREE ABSENCES THAT ARE STATED ON EVERY DOSSIER, unconditionally.
  // Citizenship, because there is no input to condition on. The treaty
  // residence article, because the instrument is held and the article has not
  // been read. Permanent establishment, because the governing material is
  // paraphrase-only by licence and was never retrieved. All three are silences
  // that read as absences of a problem unless something says otherwise.
  for (const key2 of ["citizenship_based_taxation", "treaty_residence_tie_breaker", "permanent_establishment_exposure"]) {
    uncited.push(uncitedFinding(key2));
  }

  const treatyHeld = Boolean(treaty);
  const pairLabel = key ? key.replace("|", "–") : null;

  return {
    inPlay,
    pair,
    pairKey: key,
    treatyHeld,
    sources,
    uncited,
    // THE SIDEBAR CONTRACT. `basis.<key>` blocks carrying a `sentence`, optional
    // `fields[]` with their own sentences, and `sources` — exactly what
    // zaf-app/assets/main.js's renderNarrativeBlock() and renderSources()
    // already draw for UC-04, UC-05 and UC-06. Nothing new is asked of the
    // browser. See docs/use-cases/UC-08.md §15 for the one line in
    // main.js's loadUc08() that has to pass `basis` through before it renders.
    basis: {
      sources: { framing: SOURCE_FRAMING, caveatFraming: CAVEAT_FRAMING, confirmationFraming: CONFIRMATION_FRAMING },
      residence: {
        sentence: residence.length
          ? `The domestic residence test of ${residence.map((r) => r.scope).join(" and ")}, quoted from the authority that administers it. These are not values of one rule — they are differently shaped rules, and nothing in this system measures anyone against any of them.`
          : "No jurisdiction in this dossier has a domestic residence test in this repository's corpus, so nothing below states what makes a person resident anywhere.",
        fields: residence.map((r) => ({
          label: r.scope,
          sentence: r.residenceTest.whatTheSourceSays,
        })),
        sources: residence,
      },
      treaty: {
        sentence: treatyHeld
          ? `The convention in force between ${pairLabel} governs which of the two states may tax this employment income. Its day-count limb is one of ${treaty.treaty.structure === "alternative_limbs" ? "two alternative limbs" : "three cumulative conditions"}, and it is the only limb this system sees anything of.`
          : pairLabel
            ? `No bilateral convention is held for ${pairLabel}. That is not a finding that none exists — this repository holds six pairs and this is not one of them.`
            : "No single pair of jurisdictions could be identified for this inquiry, so no bilateral convention was looked up. A cross-border question has two sides; this dossier does not name exactly two.",
        fields: treatyHeld
          ? treaty.treaty.limbs.map((limb) => ({
              label: limb.label,
              sentence: limb.coverageNote,
            }))
          : [],
        sources: treatyHeld ? [treaty] : [],
      },
      socialSecurity: {
        sentence: social
          ? `${social.coverage.network}. Coverage for ${pairLabel} is five facts, not a yes: which instrument, from what date, on which certificate, for how long, and published by whom.`
          : pairLabel
            ? `No social-security instrument is held for ${pairLabel}.`
            : "No single pair of jurisdictions could be identified, so no social-security instrument was looked up.",
        fields: social
          ? [
              { label: "Certificate", sentence: social.coverage.certificate },
              { label: "Maximum initial detachment", sentence: social.coverage.maximumInitialDetachment },
            ]
          : [],
        sources: social ? [social] : [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/**
 * The day count WITH its subject, plus the records behind it.
 *
 * A day count is the single fact this use case computes, and until this
 * function existed it travelled alone: `{days: 92, periodsCounted: 1,
 * status: "COUNTED"}` — 92 days in an unstated country over an unstated window,
 * from records nobody could see. "…and then what?" has no answer: the specialist
 * cannot check the arithmetic, cannot tell an evidence-based zero from an empty
 * one, and cannot see that a stay was clipped at the window edge.
 */
function describePresence({ presenceDays, evidence, jurisdictionKnowledge }) {
  // THE ONE SENTENCE THAT MAY NEVER BE OMITTED. Every return below appends it,
  // including the not-counted ones, because a reader who is told a count is
  // missing still needs to know that no jurisdiction rule was available to
  // measure it against had it existed. It is composed by
  // jurisdictionKnowledge.js and is never empty.
  const knows = jurisdictionKnowledge?.statement ? ` ${jurisdictionKnowledge.statement}` : "";
  if (!presenceDays) {
    return {
      status: "NOT_REQUESTED",
      days: null,
      statement:
        "No presence-day count was requested for this inquiry — no country and window were supplied to count over." + knows,
      evidenceRecorded: false,
      evidence: null,
      problems: [],
    };
  }

  const where = evidence?.country ?? null;
  const from = evidence?.windowStart ?? null;
  const to = evidence?.windowEnd ?? null;
  // The subject clause. Omitted entirely rather than half-stated: "92 days in
  // null" is worse than "92 days", because it looks like an answer.
  const subject = where && from && to ? ` in ${where} between ${from} and ${to}` : "";

  const problems = Array.isArray(presenceDays.problems) ? presenceDays.problems : [];

  if (presenceDays.status !== "COUNTED" || presenceDays.days === null) {
    return {
      status: presenceDays.status ?? "NOT_EVALUATED",
      days: null,
      statement:
        `NOT COUNTED${subject}. No day figure exists for this inquiry` +
        (problems.length ? `: ${problems.join("; ")}.` : ".") +
        " Treat this as missing, never as zero — a zero here reads as 'well under 183 days', which nobody computed." +
        knows,
      evidenceRecorded: Boolean(evidence),
      evidence: evidence ?? null,
      problems,
    };
  }

  const counted = evidence ? `${evidence.recordsCounted} of ${evidence.recordsSupplied} supplied record(s)` : null;
  const basis = evidence
    ? ` Counted from ${counted}; the rest are listed with the reason each was excluded.`
    : " The records this count was taken from were not recorded on this dossier, so the arithmetic cannot be checked from here." +
      " (Rows written by the n8n execution path carry no evidence block — see presenceEvidence.js.)";

  return {
    status: "COUNTED",
    days: presenceDays.days,
    // The union caveat travels with the number because it is the thing a reader
    // would otherwise get wrong: per-record contributions do not sum to the
    // total when two records cover the same day, and that is correct.
    statement:
      `${presenceDays.days} distinct day(s)${subject}, across ${presenceDays.periodsCounted ?? 0} contributing period(s).` +
      " Overlapping days are counted once, so the per-record figures below do not add up to this total." +
      basis +
      knows,
    evidenceRecorded: Boolean(evidence),
    evidence: evidence ?? null,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/**
 * What the cited material IS, and — the part that matters — what it is not.
 *
 * A citation with no statement of what it covers acquires authority it has not
 * earned. That was written when the corpus was three passages of GENERAL
 * model-convention and totalization principle holding no bilateral instrument
 * for any pair, and every sentence below was built to stop those three reading
 * as jurisdiction-specific authority.
 *
 * THE GAP IS NOW CLOSED AND THIS FUNCTION HAD NOT NOTICED (fixed 2026-08-30).
 * §3.95 replaced the retrieval leg with a country-filtered lexical index over
 * the 55 retrieved statutory passages in `src/knowledge/`, and the caution
 * survived it verbatim — so on the flagship demo pair the sidebar printed,
 * directly above the IRS's own substantial presence test, Portugal's CIRS
 * art. 16.º and the text of the US–Portugal convention:
 *
 *   "The reference corpus is 3 passage(s) of GENERAL principle — OECD Model
 *    Tax Convention articles … Nothing in the corpus matched this request at
 *    all. … they are not the governing instrument for this request and must
 *    not be cited to the requester as if they were."
 *
 * Three false claims and one dangerous one. "Nothing matched" was the `else`
 * arm of a ternary that had never been given a `statutory_lexical` limb; the
 * count came from TREATY_CORPUS, which is no longer where these passages come
 * from; and the last clause — a disclaimer written to stop a PARAPHRASE being
 * over-trusted — was telling a specialist to discount the instrument in force.
 * A stale caution is not the safe direction of a stale sentence: it spends the
 * credibility of every other caution on this page.
 *
 * SO THE DISCRIMINATOR IS THE CITATION, NOT THE MODE. Each passage carries
 * `authority: "instrument" | "model"`, and the caution is now attached to the
 * model passages only, which is the population it was always about. A mode
 * label alone cannot do this: a `statutory_lexical` result falls back to the
 * OECD Model paraphrases when nothing statutory matched, and that result needs
 * the original warning word for word.
 */
function describeCitationCoverage({ citations, jurisdictions, statutory = null }) {
  const mode = describeRetrievalMode(citations);
  const pair =
    jurisdictions.length >= 2
      ? `${jurisdictions[0]}/${jurisdictions[1]}`
      : jurisdictions.length === 1
        ? `${jurisdictions[0]} and the other jurisdiction involved`
        : null;

  // WHAT THE SPECIALIST WAS ACTUALLY HANDED, counted off the citations rather
  // than inferred from the mode. `instrument` is set by the retriever from the
  // passage's own `authority`; a dossier stored before 2026-08-30 carries
  // neither field, so both counts fall to zero and every sentence below reads
  // exactly as it did then.
  const instrumentsRetrieved = citations.filter((c) => c?.authority === "instrument").length;
  const modelPassagesRetrieved = citations.filter((c) => c?.authority === "model").length;
  const statutory_ = mode === "statutory_lexical";
  const stats = statutory_ ? corpusStats() : null;

  const modeStatement =
    mode === "embedding_similarity"
      ? "Retrieved by embedding similarity over the stored corpus vectors."
      : mode === "statutory_lexical"
        ? "Retrieved by lexical match (BM25) over the retrieved statutory corpus, filtered to the jurisdictions this request names — so a passage from an unrelated country's law cannot surface here."
        : mode === "keyword_fallback"
          ? "Retrieved by KEYWORD match, not by meaning — the embedding path is unconfigured, so a passage surfaced because a literal term appeared in the request text."
          : "Nothing in the corpus matched this request at all.";

  // THIS SENTENCE USED TO BE UNCONDITIONAL AND IS NOW A FACT ABOUT THE PAIR.
  // It said "no bilateral treaty was consulted — none is held", which was true
  // of the whole repository for as long as the only corpus was three passages
  // of general principle. Six conventions are now vendored and cited per pair
  // by decisionSources.js, so leaving the sentence would understate what the
  // specialist has been handed — and a citation block that says the material
  // does not exist, printed above the material, is the same class of staleness
  // as a status line nobody rechecked.
  const bilateralHeld = Boolean(statutory?.treatyHeld);
  // THE TRAILING CLAUSE IS NOW A QUESTION ABOUT THIS RESULT, not a standing
  // fact. It used to end "— it is not one of the passages below, which are
  // general principle only", which was true of every result for as long as the
  // only corpus was the three OECD paraphrases. The statutory index can and
  // does return the convention text itself (D-27/D-28/D-29 on a US pair), so
  // on the flagship demo pair that clause told the specialist the instrument
  // was absent from a list it was sitting in.
  const passagesAreGeneralOnly = instrumentsRetrieved === 0;
  const bilateralStatement = bilateralHeld
    ? `The bilateral convention in force for ${statutory.pairKey.replace("|", "\u2013")} IS held and is cited, with its employment-income article quoted, under the sources block${passagesAreGeneralOnly ? " \u2014 it is not one of the passages below, which are general principle only." : "."}`
    : pair
      ? `No bilateral treaty between ${pair} was consulted — none is held.`
      : "No bilateral treaty was consulted — none is held, and no jurisdiction pair was identified to look one up for.";

  return {
    retrievalMode: mode,
    citationsReturned: citations.length,
    // THE CORPUS THESE CITATIONS CAME FROM, not whichever one this module
    // imported first. Reporting TREATY_CORPUS.length against a statutory result
    // said "3" about a body of 55 passages.
    corpusSize: stats ? stats.byFeed["UC-08"] : TREATY_CORPUS.length,
    corpusDocuments: stats ? stats.documents : null,
    instrumentsRetrieved,
    modelPassagesRetrieved,
    // The vendored instruments are counted separately from the retrieved
    // passages on purpose: they arrive by a different mechanism (a person wrote
    // them down) and carry a different kind of authority (the instrument in
    // force, not a principle it was drafted from).
    statutoryInstrumentsCited: statutory ? statutory.sources.length : 0,
    bilateralInstrumentHeld: bilateralHeld,
    // Stated as a scope, not as a disclaimer to skim. Every clause is a fact a
    // specialist would otherwise have to ask for.
    scope: [
      statutory_
        ? `The reference corpus is ${stats.byFeed["UC-08"]} passage(s) drawn from ${stats.documents} statutory and agency ` +
          "documents retrieved from their own publishers, each carrying its source URL, retrieval date and a SHA-256 of " +
          "the retrieved bytes."
        : `The reference corpus is ${TREATY_CORPUS.length} passage(s) of GENERAL principle — OECD Model Tax Convention ` +
          "articles and the general shape of social-security totalization agreements.",
      bilateralStatement,
      modeStatement,
      // THE CAUTION, ATTACHED TO THE POPULATION IT IS ABOUT. Model paraphrases
      // get it verbatim; retrieved instruments get the different warning that
      // actually applies to them, which is currency rather than authority — the
      // repository holds the text as published on the retrieval date and cannot
      // tell whether it has since been amended.
      modelPassagesRetrieved > 0 || !statutory_
        ? (statutory_
            ? `${modelPassagesRetrieved} of the passage(s) below are GENERAL principle (an OECD Model article or the shape of a totalization agreement) rather than an instrument in force. Those `
            : "These passages are background for the specialist's own analysis; they are not the ") +
          (statutory_ ? "are not " : "") +
          "governing instrument for this request and must not be cited to the requester as if they were."
        : null,
      instrumentsRetrieved > 0
        ? `${instrumentsRetrieved} of the passage(s) below are the publisher's own text, quoted, not a paraphrase — check the retrieval date on each before relying on it, because this system holds the text as published on that date and does not track later amendments.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

// ---------------------------------------------------------------------------
// Open questions
// ---------------------------------------------------------------------------

/**
 * Everything this dossier could NOT establish, ranked by how much the decision
 * turns on it. Ranked rather than dumped: the top row is what the specialist
 * has to go and find before they can answer anything.
 *
 * Priority 1 facts are the ones the tax question itself turns on (how long,
 * where). Priority 2 is what frames the answer (which jurisdictions, which
 * track). Priority 3 is quality signal on the drafted prose, which changes how
 * much of the narrative to trust but never what the answer is.
 */
function collectOpenQuestions({ presence, citationCoverage, jurisdictionKnowledge, inquiryType, jurisdictions, statutory = null, faithfulness }) {
  const questions = [];

  // PRIORITY 1, ABOVE EVERYTHING. A day count exists and no residence test for
  // any jurisdiction it concerns is held here, so there is nothing in this
  // system to measure it against. This outranks even a missing count: a missing
  // count is visibly missing, while a present one measured against nothing
  // looks exactly like a present one measured against something.
  if (presence.status === "COUNTED" && jurisdictionKnowledge && jurisdictionKnowledge.state !== "held") {
    const codes = jurisdictionKnowledge.inPlay.map((j) => j.code);
    questions.push({
      code: "no_residence_test_held_for_counted_jurisdiction",
      priority: 1,
      question:
        (codes.length
          ? `A day count is present for ${codes.join(", ")}, and this system holds no residence test for `
          : "A day count is present, no jurisdiction could be identified for it, and this system holds no residence test for ") +
        (codes.length ? "any of them" : "any jurisdiction") +
        " — no threshold, no window, no rule of any shape, and that is deliberate rather than a gap to fill (see jurisdictionKnowledge.js). What HAS changed is that the primary source is now vendored and is cited on this dossier: read the residence test in the sources block below, quoted from the authority that administers it, before reading the figure as near or far from any line. Three of the four demo countries' tests contain the number 183 and it means something different in each.",
    });
  }

  if (presence.status === "NOT_REQUESTED") {
    questions.push({
      code: "presence_not_requested",
      priority: 1,
      question:
        "No physical-presence count was taken. If this inquiry turns on days present (a 183-day question, a " +
        "tie-breaker, an A1 duration), establish the country and the window and re-run it.",
    });
  } else if (presence.status !== "COUNTED") {
    questions.push({
      code: "presence_not_evaluated",
      priority: 1,
      question:
        "The presence-day count could not be computed" +
        (presence.problems.length ? ` (${presence.problems.join("; ")})` : "") +
        ". Obtain the missing travel records before relying on any day-based conclusion.",
    });
  } else if (!presence.evidenceRecorded) {
    questions.push({
      code: "presence_basis_not_recorded",
      priority: 1,
      question:
        "A day count exists but the records behind it were not recorded on this dossier, so the figure cannot be " +
        "verified from here. Re-run the inquiry through the Node path, or check the travel records directly.",
    });
  }

  if (!jurisdictions.length) {
    questions.push({
      code: "no_jurisdiction_identified",
      priority: 2,
      question:
        "No jurisdiction was identified in the request text. Confirm which countries are involved — every tax track " +
        "in this use case is jurisdiction-specific.",
    });
  } else if (jurisdictions.length === 1) {
    questions.push({
      code: "single_jurisdiction_identified",
      priority: 2,
      question:
        `Only one jurisdiction (${jurisdictions[0]}) was identified. A cross-border question has at least two; ` +
        "confirm the other side before applying any treaty reasoning.",
    });
  }

  if (inquiryType === "other" || !inquiryType) {
    questions.push({
      code: "inquiry_track_not_identified",
      priority: 2,
      question:
        "The request was not classified into a tax track (residency, withholding, totalization). Read the original " +
        "request text — the dossier's structure below assumes a track that was never established.",
    });
  }

  if (citationCoverage.citationsReturned === 0) {
    questions.push({
      code: "no_citations",
      priority: 2,
      question: "Nothing in the reference corpus matched this request, so the dossier carries no background material at all.",
    });
  } else if (
    citationCoverage.retrievalMode === "statutory_lexical" &&
    citationCoverage.instrumentsRetrieved === 0
  ) {
    // THE LAST-RESORT ARM, RAISED AS A QUESTION RATHER THAN LEFT TO THE SCOPE
    // SENTENCE. The statutory index is country-filtered, so returning nothing
    // statutory means it held nothing for the jurisdictions this request names
    // — and what a reader then sees is the OECD Model paraphrase the retriever
    // falls back to. That is precisely the case the original
    // `citations_keyword_matched` warning was written for, and it must keep
    // firing now that the mode label around it has changed.
    questions.push({
      code: "citations_model_only",
      priority: 2,
      question:
        "Nothing STATUTORY matched for the jurisdictions this request names, so the passages below are general " +
        "principle only — an OECD Model article is the template a convention was drafted from, not the convention. " +
        "The governing instrument for this pair is either cited separately in the sources block or is not held here " +
        "at all; treat these passages as a starting point, not as the applicable authority.",
    });
  } else if (citationCoverage.retrievalMode === "keyword_fallback") {
    questions.push({
      code: "citations_keyword_matched",
      priority: 2,
      question:
        "The retrieved passages were matched on literal keywords, not meaning, and that corpus is general principle only — " +
        "it holds no bilateral instrument for any pair. Treat those passages as a starting point, not as the applicable " +
        "authority. (The vendored instruments in the sources block arrive by a different route entirely: a person listed " +
        "them against this jurisdiction pair, and they are the instruments in force.)",
    });
  }

  // UNCONDITIONAL, AND THAT IS THE DESIGN. See CITIZENSHIP_BASED_TAXATION's own
  // comment: there is no citizenship input anywhere in this use case, so a
  // US-connected person can appear in ANY dossier and this system cannot tell.
  // Raising the question only where "US" was matched would rebuild the silence
  // for every case the dictionary missed — which is the defect this whole pass
  // exists to close, one field over.
  if (jurisdictionKnowledge?.citizenship) {
    questions.push({
      code: "citizenship_basis_not_assessed",
      priority: 2,
      question:
        "Citizenship-based taxation is not assessed anywhere in this dossier, and cannot be: no request field carries a " +
        "nationality or citizenship. Everything above is framed as a residence question. If this person holds a citizenship " +
        "whose country taxes on that basis, nothing here addresses it — confirm the citizenship out of band.",
    });
  }

  // THE LIMBS NOBODY CAN SEE. Priority 1 whenever a bilateral article IS held,
  // because this is the question a day count invites a reader to answer and
  // cannot: the article is cumulative, and the two limbs this system has no
  // representation of are the two an Employer-of-Record arrangement usually
  // fails. A dossier that cites the treaty without saying so would have made
  // the misreading easier, not harder.
  if (statutory?.treatyHeld) {
    questions.push({
      code: "treaty_limbs_not_represented",
      priority: 1,
      question:
        `The convention for ${statutory.pairKey.replace("|", "–")} is cited in full below, and its day-count limb is only one of its conditions. ` +
        "Nothing in this system carries the employer's residence or whether the remuneration is borne by a permanent establishment, and under an EOR arrangement those are usually the limbs that decide it. Establish both before reading any day figure as an answer.",
    });
  } else if (statutory && statutory.pair) {
    questions.push({
      code: "no_bilateral_instrument_held",
      priority: 2,
      question:
        `This repository holds no bilateral instrument for ${statutory.pairKey.replace("|", "–")}. Nothing below is the governing convention for this pair — find it before relying on any framing here.`,
    });
  } else if (statutory && statutory.inPlay.length !== 2) {
    questions.push({
      code: "no_single_pair_identified",
      priority: 2,
      question:
        `This dossier names ${statutory.inPlay.length} jurisdiction(s), so no single pair could be resolved and no bilateral instrument was looked up. Picking the two most likely of them would have produced a treaty citation with nothing behind it.`,
    });
  }

  const verdict = faithfulness?.verdict ?? null;
  if (verdict === "not_evaluated" || verdict === null) {
    questions.push({
      code: "narrative_not_checked",
      priority: 3,
      question:
        "The drafted narrative was not checked against the structured facts (the faithfulness judge did not run). " +
        "Read the narrative against the figures above rather than instead of them.",
    });
  } else if (verdict !== "faithful") {
    questions.push({
      code: "narrative_flagged",
      priority: 3,
      question: `The faithfulness judge returned "${verdict}" on the drafted narrative — read the structured facts, not the prose.`,
    });
  }

  return questions.sort((a, b) => a.priority - b.priority);
}
