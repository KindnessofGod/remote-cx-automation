// ---------------------------------------------------------------------------
// decisionSources.js  —  The instruments behind a cross-border tax dossier
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE
//
// UC-08 is 🔴 and has NO execution path. Nothing is approved, nothing is
// written, nothing is executed. The dossier a Tax Operations specialist opens
// IS the entire product of this use case — so if the dossier is thin, the use
// case delivered nothing at all.
//
// It was thin. Until this file existed, a CA→NL totalization dossier reached
// the most senior tax reader in this system carrying three passages that this
// project had written itself: a paraphrase of OECD Model Article 4, a
// paraphrase of Article 15, and a paragraph of general totalization principle.
// Meanwhile `docs/knowledge/layer-1-statutory/` held **the Canada–Netherlands
// income tax convention** (D-25), **both Canada–Netherlands social security
// agreements** (D-22), **the CRA's own table** (D-21), **the Dutch residence
// article** (D-31) and **the Canadian one** (D-33/D-34) — each with a
// publisher, an exact URL, a retrieval date and, where the licence allowed it,
// a SHA-256 of the retrieved bytes. The specialist was handed a model the
// treaty was drafted FROM, and not the treaty that is in force.
//
// SAME SHAPE, SAME DISCIPLINE, AS src/uc04/decisionSources.js AND
// src/uc05/decisionSources.js — read UC-04's header first; it argues the design
// and this one does not repeat it. Finding key -> the documents somebody read
// when the check was written up. No retrieval engine, no embedding, no ranking,
// no score.
//
// THIS IS NOT `treatyRetriever.js`, AND THE TWO MUST NOT BE CONFUSED.
// `treatyRetriever.js` SEARCHES: it takes free text and returns whichever of
// its own general passages matched, by keyword or by embedding similarity, and
// its `matchedOn` says which. It can and does return a nearest match. This file
// LOOKS UP: a jurisdiction, or a jurisdiction PAIR, resolves to the instrument
// that governs it, or resolves to nothing. There is no nearest match in here
// and there cannot be — Canada–Portugal is not a near miss for Canada–
// Netherlands, it is a different treaty with a different window and a different
// posting maximum, and a similarity search that returned one for the other
// would be wrong in a way nobody downstream could detect. That is the reason
// this is a map and not a retriever, and `docs/ESCALATION-DESTINATIONS.md` §8.4
// names the choice as the one that had to be made before anything could be
// built here.
//
// SEVEN RULES THAT ARE NOT NEGOTIABLE.
//
//   1. NEVER INVENT A CITATION. Every `path` points at a file vendored under
//      `docs/knowledge/`, and `test/uc08DecisionSources.test.js` asserts each
//      one exists on disk and still opens with its catalogue id. A renamed
//      document must break a test, never become authority-shaped text linking
//      nowhere.
//
//   2. A FINDING WITH NO SOURCE GETS AN EXPLICIT STATEMENT THAT IT HAS NONE,
//      never the closest thing to hand. `UNCITED_FINDINGS` and
//      `uncitedFinding()` carry those, and they distinguish the two absences
//      that read identically on a screen and mean opposite things: a finding
//      about THIS SYSTEM that no authority will ever publish anything about,
//      and a finding about a jurisdiction this corpus simply does not hold.
//
//   3. NO RANKING, NO SCORE, NO SIMILARITY NUMBER. `RETRIEVAL_METHOD` says in
//      plain words that a person read these and wrote them down. Nothing here
//      may read as more precise than that.
//
//   4. NOTHING HERE MAY REACH A GATE. UC-08's decision is `escalate`, always,
//      and no citation may change it. This module imports nothing, takes no
//      client, no clock and no I/O; per `docs/knowledge/README.md`'s structural
//      rule no citation id appears in a conditional anywhere in this
//      repository; and the test asserts that neither `workflow.js` nor any
//      parser or calculator imports this file.
//
//   5. QUOTE ONLY WHAT THE DOCUMENT SAYS, WITH ITS LOCATOR — and where a
//      document is SILENT on a question this dossier raises, say **silent**.
//      Not "permitted", not "forbidden". Both of those are conclusions this
//      repository has no standing to reach, and a specialist who is told an
//      instrument does not address a question is better served than one shown
//      a confident answer to a different one.
//
//   6. THE LICENCE IS PART OF THE CITATION. OECD Model and BEPS material is
//      **paraphrase-only, never copied** — so it appears in this file exactly
//      once, in `UNCITED_FINDINGS`, saying that the material that governs
//      permanent-establishment exposure has not been read here. Commercial
//      databases (IBFD, Bloomberg Tax, Vialto) are **excluded entirely** and
//      appear nowhere. `support.remote.com` is cite-and-link only and is not a
//      tax authority, so it is not cited here at all.
//      `docs/knowledge/DOWNLOAD-MANIFEST.md` §3 carries the class per document
//      and every quotation below is drawn from a class (a), (b) or (c) source
//      whose own sidecar already quotes the same passage.
//
//   7. THE READER IS A TAX SPECIALIST, NOT A MAINTAINER OF THIS CODE — so no
//      sentence they see may address them in this repository's own vocabulary.
//      A limit is stated at full strength and then given an address the reader
//      can actually reach: the publisher's URL (`url`, on every document), the
//      instrument and its locator, or the block of this same dossier that
//      carries the material. It used to say "see UNCITED_FINDINGS", "see
//      `residence_test`", "`computePresenceDays()` measures date ranges" and
//      "docs/knowledge/DOWNLOAD-MANIFEST.md §8 has no entry" — each a true
//      statement of a real limit, addressed to somebody with a clone of this
//      repository open. THE LIMIT WAS NEVER THE PROBLEM AND MUST NOT BE
//      SOFTENED TO FIX THE ADDRESS: "NOT read", "no source that has been read"
//      and "no entry covering this at all" are the most valuable sentences on
//      the screen, because on a 🔴 dossier a specialist acting on an overstated
//      citation is the failure this use case exists to prevent. `path` and
//      `bytes` stay as data — the suite reads them to prove a citation resolves
//      — and `test/uc08DecisionSources.test.js` scans every string that reaches
//      a reader for repo paths, backticked identifiers, function names,
//      SCREAMING_SNAKE and snake_case keys and this project's own D-/C-/K-
//      catalogue numbers, while proving in the same test that it lets a real
//      legal citation ("art. 15(2)", "Folio S5-F1-C1") through untouched.
//
// A NUMBER MAY BE QUOTED AND MAY NEVER BE CARRIED. Every threshold in this file
// lives inside a `quote` — the authority's own words, in its own language —
// and no field anywhere holds one as a value. `183` is a string inside CIRS
// art. 16.º and inside ITA s. 250(1)(a) and inside six treaty articles, and it
// means something different in every one of them; the moment it becomes a
// number in a field, something downstream will compare it. That is exactly the
// discipline `src/uc08/jurisdictionKnowledge.js` already keeps (`thresholdDays:
// null`), rotated one file over, and the test pins it: no numeric value may
// appear anywhere in what these lookups return.
// ---------------------------------------------------------------------------

const KNOWLEDGE = "docs/knowledge/layer-1-statutory";
const CONTRADICTIONS = `${KNOWLEDGE}/CONTRADICTIONS.md`;

/** Rendered once above the citation block. Not decoration — see rule 4. */
export const SOURCE_FRAMING =
  "These are the instruments this dossier's figures and framing were written from, linked so you can read them. " +
  "Nothing here is advice and no gate consults any of it: a citation says which rule a statement is based on and where the text is, never what to conclude about this person's tax position. UC-08 reaches one decision — escalate — and no document below can change it.";

/** Rendered once above the caveats, for the same reason. */
export const CAVEAT_FRAMING =
  "Where this system applies a rule one of these documents disputes, the dispute is printed with the finding. " +
  "A contradicted finding is not evidence for the opposite conclusion — it is a finding whose basis you now know the limits of.";

/** How the citations got here. Stated because the alternative is assumed. */
export const RETRIEVAL_METHOD =
  "Hand-curated: every document below was listed against this finding, for this jurisdiction or this jurisdiction pair, by a person who had read the document. There is no search, no ranking and no similarity score, so no figure of confidence is quoted. A finding with no entry gets no citation rather than a nearest match — Canada–Portugal is not a near miss for Canada–Netherlands.";

/** Rendered once above the treaty block. The load-bearing sentence in the file. */
export const TREATY_FRAMING =
  "The employment-income article of the convention actually in force for this pair, quoted. Its conditions are CUMULATIVE — the article reads (a) … and (b) … and (c) … — so a day count answers one limb of a three-limb test and nothing more. " +
  "For an Employer-of-Record arrangement limbs (b) and (c) are usually the ones that decide the case, and this system represents neither. Each limb below says what the article states and how much of it this system can see; none of them says what the answer is.";

/** Rendered once above the residence block. */
export const RESIDENCE_FRAMING =
  "The DOMESTIC residence test of each jurisdiction in play, quoted from the authority that administers it. These are four different shapes, not four values of one rule: one of them contains no day count at all, two of them back-date the consequence over days already lived, and three of them contain the number 183 meaning three different things. " +
  "Nothing in this system measures anyone against any of them: not one threshold, window or counting rule out of these four documents is built into any check here, and that is a deliberate refusal rather than an omission — four rules of four different shapes cannot be reduced to one number without that number being compared against the wrong country.";

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------
// One entry per vendored file (or per closely-bound group, matching how
// `docs/knowledge/` groups them). `path` is repo-relative because these are
// FILES: several are cite-and-link-only at the publisher and exist here as a
// provenance sidecar rather than as bytes. `bytes` is the retrieved original
// where the licence permitted keeping one and null where it did not, and the
// difference is shown rather than smoothed over — "we hold the authority's own
// bytes" and "we hold our own note about them" are different strengths of
// evidence and a specialist is entitled to tell them apart.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,title:string,instrument:string,publisher:string,path:string,bytes:string|null,evidence:string,licence:string}>>} */
export const SOURCE_LIBRARY = Object.freeze({
  "D-17": {
    id: "D-17",
    title: "Which single state's social security applies when someone works in another",
    instrument: "Regulation (EC) No 883/2004, consolidated text 02004R0883 — 31.07.2019",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-17-eu-reg-883-2004.md`,
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02004R0883-20190731",
    bytes: `${KNOWLEDGE}/sources/D-17-eu-reg-883-2004.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "EUR-Lex reuse (Commission Decision 2011/833/EU); the consolidated text is additionally CC BY 4.0, attributed and unaltered.",
  },
  "D-18": {
    id: "D-18",
    title: "How the certificate of applicable legislation is actually obtained",
    instrument: "Regulation (EC) No 987/2009, consolidated text 02009R0987 — 01.01.2018",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-18-eu-reg-987-2009.md`,
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0987-20180101",
    bytes: `${KNOWLEDGE}/sources/D-18-eu-reg-987-2009.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "EUR-Lex reuse (Commission Decision 2011/833/EU); consolidated text additionally CC BY 4.0.",
  },
  "D-19": {
    id: "D-19",
    title: "How the issuing institutions apply the posting and multi-state rules",
    instrument: "Practical Guide on the applicable legislation in the EU, EEA and Switzerland (December 2013)",
    publisher: "European Commission, for the Administrative Commission",
    path: `${KNOWLEDGE}/D-19-eu-practical-guide-applicable-legislation.md`,
    url: "https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en",
    bytes: `${KNOWLEDGE}/sources/D-19-eu-practical-guide-applicable-legislation.pdf`,
    evidence: "[CONFIRMED — Administrative Commission guidance, retrieved 2026-08-19]",
    licence: "CC BY 4.0 (Commission legal notice, Decision 2011/833/EU). The authority's own retrieved text is held here in full.",
  },
  "D-20": {
    id: "D-20",
    title: "Status of US totalization agreements, and the detached-worker rule",
    instrument: "Status of Totalization Agreements, with the programme overview",
    publisher: "U.S. Social Security Administration, Office of International Programs",
    path: `${KNOWLEDGE}/D-20-us-ssa-totalization-status.md`,
    url: "https://www.ssa.gov/international/status.html",
    bytes: `${KNOWLEDGE}/sources/D-20-us-ssa-totalization-status.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
    licence: "US federal government work — public domain. The authority's own retrieved text is held here in full.",
  },
  "D-21": {
    id: "D-21",
    title: "Canada's social security agreement network, and the agreement texts behind it",
    instrument: "CRA agreement table and forms CPT63 / CPT55 / CPT56, with the CTS agreement texts (E102196, E102195, E104279, E102185)",
    publisher: "Canada Revenue Agency (CPP/EI Rulings), with Global Affairs Canada's treaty register",
    path: `${KNOWLEDGE}/D-21-D-22-D-23-ca-social-security-agreements.md`,
    url: "https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html",
    bytes: null,
    evidence: "[CONFIRMED — agency publication and treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no copy of the text is held here: non-commercial reproduction only, and a public, career-facing portfolio is not clearly non-commercial.",
  },
  "D-24": {
    id: "D-24",
    title: "Netherlands–Portugal double taxation convention",
    instrument: "Convention concluded at Oporto 1999-09-20, entry into force 2000-08-11 (Treaty Series 1999,180 and 2000,88)",
    publisher: "Ministerie van Buitenlandse Zaken, via Verdragenbank and wetten.overheid.nl",
    path: `${KNOWLEDGE}/D-24-nl-pt-tax-convention.md`,
    url: "https://verdragenbank.overheid.nl/en/Treaty/Details/009217",
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "Cite and quote only, no copy of the text is held here — overheid.nl publishes no reuse-terms page for this material.",
  },
  "D-25": {
    id: "D-25",
    title: "Canada–Netherlands income tax convention",
    instrument: "Convention signed 1986-05-27, as amended by the Protocols of 1993-03-04 and 1997-08-25 (departmental consolidation)",
    publisher: "Department of Finance Canada",
    path: `${KNOWLEDGE}/D-25-ca-nl-tax-convention.md`,
    url: "https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/netherlands-convention-consolidated-1986-1993-1997.html",
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no copy of the text is held here.",
  },
  "D-26": {
    id: "D-26",
    title: "Canada–Portugal income tax convention",
    instrument: "E103231, Canada Treaty Series 2001/27 — signed Ottawa 1999-06-14, in force 2001-10-24",
    publisher: "Global Affairs Canada, Canada Treaty Information (Treaty Law Division)",
    path: `${KNOWLEDGE}/D-26-ca-pt-tax-convention.md`,
    url: "https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=103231",
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no copy of the text is held here.",
  },
  "D-27": {
    id: "D-27",
    title: "The three United States income tax conventions (Netherlands, Portugal, Canada)",
    instrument: "US–NL and US–PT arts. 16(2); US–CA art. XV(2) — the dependent-personal-services articles",
    publisher: "Internal Revenue Service, publishing conventions concluded by the U.S. Department of the Treasury",
    path: `${KNOWLEDGE}/D-27-D-28-D-29-us-tax-conventions.md`,
    url: "https://www.irs.gov/pub/irs-trty/nether.pdf for US–Netherlands, https://www.irs.gov/pub/irs-trty/portugal.pdf for US–Portugal, https://www.irs.gov/pub/irs-trty/canada.pdf for US–Canada",
    bytes: `${KNOWLEDGE}/sources/D-27-us-nl-tax-convention.pdf`,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "US federal government work — public domain. All three PDFs are held here in full; these are the only treaty texts in this collection held as the authority's own text rather than as a note about it.",
  },
  "D-31": {
    id: "D-31",
    title: "Netherlands — where a person is resident for tax",
    instrument: "Algemene wet inzake rijksbelastingen, artikel 4 (BWBR0002320), consolidation 2026-04-11",
    publisher: "Ministerie van Financiën, via Overheid.nl / wetten.overheid.nl (KOOP)",
    path: `${KNOWLEDGE}/D-31-nl-awr-art-4-residence.md`,
    url: "https://wetten.overheid.nl/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken",
    bytes: `${KNOWLEDGE}/sources/D-31-nl-awr-art-4-residence.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "CC0 1.0 (Basis Wetten Bestand, data.overheid.nl). The authority's own retrieved text is held here in full.",
  },
  "D-32": {
    id: "D-32",
    title: "Portugal — fiscal residence",
    instrument: "Código do IRS, artigo 16.º, in the tax authority's consolidated presentation (text no earlier than 2024-01-01)",
    publisher: "Autoridade Tributária e Aduaneira, Portal das Finanças",
    path: `${KNOWLEDGE}/D-32-pt-cirs-art-16-residence.md`,
    url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx",
    bytes: null,
    evidence: "[CONFIRMED — statute via the administering authority's consolidation, retrieved 2026-08-19]",
    licence: "Quote and cite, no copy of the text is held here — no reuse terms are stated on info.portaldasfinancas.gov.pt.",
  },
  "D-33": {
    id: "D-33",
    title: "Canada — deemed residence by sojourn",
    instrument: "Income Tax Act, R.S.C. 1985, c. 1 (5th Supp.), s. 250 — Act current to 2026-06-17",
    publisher: "Department of Justice Canada, Justice Laws Website",
    path: `${KNOWLEDGE}/D-33-ca-ita-s250-deemed-resident.md`,
    url: "https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-250.html",
    bytes: `${KNOWLEDGE}/sources/D-33-ca-ita-s250-deemed-resident.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "Reproduction of Federal Law Order, SI/97-5. The authority's own retrieved text is held here in full. Reproduction of a Government of Canada enactment — NOT the official version.",
  },
  "D-34": {
    id: "D-34",
    title: "Canada — the administrative view of residence",
    instrument: "Income Tax Folio S5-F1-C1, Determining an Individual's Residence Status (page modified 2026-01-20)",
    publisher: "Canada Revenue Agency",
    path: `${KNOWLEDGE}/D-34-ca-cra-folio-s5-f1-c1.md`,
    url: "https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html",
    bytes: null,
    evidence: "[CONFIRMED — administrative guidance, retrieved 2026-08-19] — a folio states the agency's administrative view and does NOT have the force of law, so anything drawn from it is an inference about legal effect and not a statement of law.",
    licence: "canada.ca terms of use — cite and extract only, no copy of the text is held here.",
  },
  "D-35": {
    id: "D-35",
    title: "United States — the substantial presence test",
    instrument: "Substantial Presence Test, IRS International Taxpayers guidance (page reviewed 2026-03-14)",
    publisher: "Internal Revenue Service",
    path: `${KNOWLEDGE}/D-35-us-substantial-presence-test.md`,
    url: "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test",
    bytes: `${KNOWLEDGE}/sources/D-35-us-substantial-presence-test.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
    licence: "US federal government work — public domain. The authority's own retrieved text is held here in full.",
  },
});

// ---------------------------------------------------------------------------
// The caveats
// ---------------------------------------------------------------------------
// `weight` is three-valued and never numeric, exactly as in UC-04's and UC-05's
// files:
//   "disputed"    — a source contradicts the rule as this code applies it.
//   "unsupported" — the code asks a source for something it does not contain.
//   "incomplete"  — the rule is right as far as it goes and the check cannot
//                   see a condition the source attaches to it.
// A percentage or a severity score here would be the invented precision this
// whole discipline exists to refuse.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,section:string,path:string,weight:string,headline:string,detail:string}>>} */
export const CAVEAT_LIBRARY = Object.freeze({
  "C-6": {
    id: "C-6",
    section: "C-6",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The EU posting rule carries a 24-month limit and a not-a-replacement condition; nothing in a request to this system records either.",
    detail:
      "Article 12(1) of Regulation 883/2004. Nothing in a UC-08 request states an anticipated duration or whether the person is replacing another posted worker, so neither condition of the posting exception can be checked here.",
  },
  "C-7": {
    id: "C-7",
    section: "C-7",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "\"Totalization\" stands in for two different articles that lead to different competent states by different tests.",
    detail:
      "Article 12 (posting) and Article 13 (activity in two or more Member States) answer different questions. Article 13's \"substantial part\" test is defined in Regulation 987/2009 art. 14(8), where 25 % is named only as an indicator inside an overall assessment — the corpus is explicit that it must not be encoded as a threshold, and it is not encoded anywhere here.",
  },
  "C-8": {
    id: "C-8",
    section: "C-8",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "There is no single detachment maximum: 24 months under the EU rule, 5 years for US agreements, and 60 or 24 months for Canada depending on the pair and the vintage of the agreement.",
    detail:
      "The maximum varies per pair within one network, so \"the detachment limit\" is not a fact about a country. The SSA states the contrast itself: its 5-year limit is \"substantially longer than the limit normally provided in the agreements of other countries.\"",
  },
  "C-9": {
    id: "C-9",
    section: "C-9",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "Coverage for a pair is five separate facts, not a yes or no — authority, effective date, certificate form, maximum detachment, and which instrument.",
    detail:
      "US–NL, US–PT, US–CA, CA–NL and CA–PT each have their own authority, effective date, certificate form and maximum, and no two rows agree. US–PT is effective 1989 and CA–PT 1981: two different agreements, two networks. \"Portugal has a totalization agreement\" is not a fact about Portugal.",
  },
  "C-10": {
    id: "C-10",
    section: "C-10",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Six bilateral treaties define six different 183-day windows, and the window this system's day count is taken over is none of them.",
    detail:
      "The windows differ on the unit — taxable year, calendar year, fiscal year — and on whether the 12-month period floats at all. The day count on this dossier is taken over whatever window the request supplied and is tied to no country's rule, so a count that clears or breaches a line may have been measured over the wrong period entirely. The US–Canada convention also carries a separate money-based limb that is an alternative to the day count, not a rider on it.",
  },
  "C-11": {
    id: "C-11",
    section: "C-11",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The treaty day test is one of three cumulative conditions, and for an Employer-of-Record arrangement the other two are the ones that decide the case.",
    detail:
      "Each article reads (a) days AND (b) remuneration paid by an employer not resident in the other state AND (c) remuneration not borne by a permanent establishment there. This system has no representation of (b) or (c) at all, so a day count reported alone has answered one third of the question and been rendered in the shape of the whole answer.",
  },
  "C-12": {
    id: "C-12",
    section: "C-12",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The four demo countries' domestic residence tests are four different shapes, and one of them has no day count at all.",
    detail:
      "The Netherlands assesses residence on the circumstances with no threshold; Portugal has a 183 line anchored on the tax year plus a second, count-free limb that can make a person resident below it; Canada's is 183 days of sojourn in a taxation year, deeming residence retroactively to 1 January; the United States uses a weighted three-year computation with named exclusions and a closer-connection exception. Crossing the line in two of them rewrites the status of days already lived, which a headroom figure cannot express.",
  },
  "C-21": {
    id: "C-21",
    section: "C-21",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Portugal counts only days that include an overnight stay; this system counts date ranges.",
    detail:
      "CIRS art. 16.º(2) makes a same-day visit zero days and a partial arrival day with a night in Portugal a whole day. The day count on this dossier measures date ranges, so it over-counts the first and can under-count the second. No other jurisdiction in this corpus counts the same way.",
  },
  "C-22": {
    id: "C-22",
    section: "C-22",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "A fresh posting for the same worker, employer and state needs at least two months to have elapsed since the last one — and no interval between stays is examined anywhere here.",
    detail:
      "The Administrative Commission's Practical Guide, applying art. 12. The day count on this dossier is a total of distinct days, which cannot represent an interval at all: two stays six weeks apart and two stays six months apart are the same number.",
  },
  "C-23": {
    id: "C-23",
    section: "C-23",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The EU assessment window looks FORWARD twelve months, and a second indicative percentage points the opposite way from the first.",
    detail:
      "The guide asks for the assumed future situation over the following 12 calendar months, where every window in this use case is trailing and historical. It also names activity under 5 % as indicative of marginal activity, which takes a person out of Article 13 entirely. Two indicative percentages doing opposite jobs is the strongest argument for encoding neither.",
  },
  "C-24": {
    id: "C-24",
    section: "C-24",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The administering agency's own published table pairs one Canada–Netherlands agreement's date with a different agreement's detachment limit.",
    detail:
      "There are two Canada–Netherlands social security agreements. The 1987 one, in force 1990-10-01, says twenty-four months; the 2001 one that replaced it, in force 2004-04-01, says sixty. The CRA's table carries the earlier date beside the later number. Both halves are real; the pairing is not, and only reading the instruments caught it. Treat the CRA row as a pointer, not as the answer.",
  },
});

/**
 * The confirmation worth carrying. A list that only ever reports faults teaches
 * a reader to distrust everything equally, which is its own failure.
 */
export const CONFIRMATION_LIBRARY = Object.freeze({
  "K-4": {
    id: "K-4",
    section: "K-4",
    path: CONTRADICTIONS,
    headline: "Canada–Portugal's 24-month detachment maximum is confirmed by the agreement itself.",
    detail:
      "The CRA's table says 24 months; art. VII(1) of the agreement says \"for a period of up to 24 months\". Two independent sources, same answer — recorded because the neighbouring Canada–Netherlands pairing did NOT check out (there the agency's table prints one agreement's date beside the other agreement's figure), and a reader needs to know that this pair was checked rather than assumed to fail together.",
  },
});

// ---------------------------------------------------------------------------
// The domestic residence tests
// ---------------------------------------------------------------------------
// FOUR COUNTRIES, FOUR SHAPES, AND NOT ONE THRESHOLD ENCODED.
//
// `shape` is a description of the DOCUMENT and never a value: it says what kind
// of rule the authority wrote, so that a reader who sees "183" in two quotes
// does not read them as the same rule. It is not ordered, not scored, and
// nothing may sort on it.
//
// `systemCoverage` is the honest half: what THIS system can see of the test.
// It is three-valued — "none" / "partial" / "full" — and nothing is "full",
// because nothing in this repository measures anybody against any of these.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, object>>} */
export const RESIDENCE_TESTS = Object.freeze({
  NL: Object.freeze({
    country: "NL",
    name: "the Netherlands",
    source: "D-31",
    locator: "AWR art. 4(1)",
    shape: "no_day_count",
    systemCoverage: "none",
    whatTheSourceSays:
      "Eleven words, and they direct that residence be judged on the circumstances. There is no threshold in Dutch domestic law to be near, so there is no headroom to have — a day count for the Netherlands is an answer to a different question, delivered in the shape of an answer to this one.",
    quote:
      "Waar iemand woont en waar een lichaam gevestigd is, wordt naar de omstandigheden beoordeeld.",
    translationNote:
      "Working translation, a reading aid and not a source: where a person resides is assessed according to the circumstances.",
    silentOn: Object.freeze([
      "Any number of days. The article states no threshold, no window and no count of any kind, so a day figure cannot be read against it either way.",
    ]),
    caveats: Object.freeze(["C-12"]),
  }),
  PT: Object.freeze({
    country: "PT",
    name: "Portugal",
    source: "D-32",
    locator: "CIRS art. 16.º(1)(a)–(b), with ¶¶2–3",
    shape: "day_count_anchored_on_the_tax_year_plus_a_count_free_limb",
    systemCoverage: "partial",
    whatTheSourceSays:
      "There IS a day line, so unlike the Netherlands the number is not fictitious — but its window is any 12-month period beginning or ending in the year concerned, anchored on the tax year rather than on a trip. Limb (b) then makes residence reachable with FEWER days and no count at all, on a dwelling held in conditions suggesting an intent to keep it as a habitual residence. And ¶3 back-dates residence to the first day of the stay, or to 1 January where the person was resident on any day of the previous year.",
    quote:
      "São residentes em território português as pessoas que, no ano a que respeitam os rendimentos: a) Hajam nele permanecido mais de 183 dias, seguidos ou interpolados, em qualquer período de 12 meses com início ou fim no ano em causa; b) Tendo permanecido por menos tempo, aí disponham, num qualquer dia do período referido na alínea anterior, de habitação em condições que façam supor intenção atual de a manter e ocupar como residência habitual;",
    secondQuote:
      "Para efeitos do disposto no número anterior, considera-se como dia de presença em território português qualquer dia, completo ou parcial, que inclua dormida no mesmo.",
    secondQuoteLocator: "art. 16.º(2) — what counts as a day of presence",
    silentOn: Object.freeze([
      "Whether any particular dwelling is held in the conditions limb (b) describes. That is a facts-and-circumstances judgement the article states and this system holds no input for.",
    ]),
    caveats: Object.freeze(["C-12", "C-21"]),
  }),
  CA: Object.freeze({
    country: "CA",
    name: "Canada",
    source: "D-33",
    locator: "Income Tax Act s. 250(1)(a)",
    shape: "day_count_over_a_taxation_year_deeming_residence_throughout_it",
    systemCoverage: "partial",
    whatTheSourceSays:
      "Canada is the one demo country whose domestic law carries the 183 figure over a period that is simply a taxation year. Two features a day-count gate cannot represent: the consequence is deemed residence throughout the WHOLE year, retroactive to 1 January rather than beginning on the 183rd day; and the word is \"sojourned\", not \"was present\" — s. 250(1)(a) is a deeming rule layered on top of common-law factual residence, not a replacement for it.",
    quote:
      "For the purposes of this Act, a person shall, subject to subsection 250(2), be deemed to have been resident in Canada throughout a taxation year if the person (a) sojourned in Canada in the year for a period of, or periods the total of which is, 183 days or more; …",
    reproductionNotice:
      "Reproduction of a Government of Canada enactment under the Reproduction of Federal Law Order, SI/97-5. NOT the official version.",
    alsoRead: Object.freeze({
      source: "D-34",
      locator: "CRA Income Tax Folio S5-F1-C1, ¶¶1.8, 1.10 and 1.14",
      whatTheSourceSays:
        "The agency's administrative view of the factual residence that s. 250 sits on top of, and it is the document in this corpus that most invites being turned into a grid. It says in its own words why that would be wrong: residence \"can only be determined on a case by case basis after taking into consideration all of the relevant facts\", and secondary ties \"must be looked at collectively\", so \"it would be unusual for a single secondary residential tie … to be sufficient on its own\". A folio does not have the force of law.",
      quote:
        "To determine residence status, all of the relevant facts in each case must be considered, including residential ties with Canada and length of time, object, intention and continuity with respect to stays in Canada and abroad.",
    }),
    silentOn: Object.freeze([
      "What makes a stay a \"sojourn\" rather than mere presence. The statute uses the word and does not define it here.",
    ]),
    caveats: Object.freeze(["C-12"]),
  }),
  US: Object.freeze({
    country: "US",
    name: "the United States",
    source: "D-35",
    locator: "Substantial presence test, with its exclusions and the closer-connection exception",
    shape: "weighted_three_year_computation",
    systemCoverage: "none",
    whatTheSourceSays:
      "Not one count over one window but a weighted computation across three calendar years, with a separate 31-day current-year condition that must ALSO be met, a list of days that do not count at all, and an exception that can defeat the test even once it is met. Nothing in this system computes a weighted multi-year figure, and a single-window day count cannot be compared to this one.",
    quote:
      "You will be considered a United States resident for tax purposes if you meet the substantial presence test for the calendar year. To meet this test, you must be physically present in the United States (U.S.) on at least: 31 days during the current year, and 183 days during the 3-year period that includes the current year and the 2 years immediately before that, counting: All the days you were present in the current year, and 1/3 of the days you were present in the first year before the current year, and 1/6 of the days you were present in the second year before the current year.",
    secondQuote:
      "Do not count the following as days of presence in the U.S. for the substantial presence test: Days you commute to work in the U.S. from a residence in Canada or Mexico if you regularly commute from Canada or Mexico. Days you are in the U.S. for less than 24 hours, when you are in transit between two places outside the United States. Days you are in the U.S. as a crew member of a foreign vessel. Days you are unable to leave the U.S. because of a medical condition that develops while you are in the United States. Days you are an exempt individual.",
    secondQuoteLocator: "the excluded days, which are not a footnote",
    silentOn: Object.freeze([
      "Citizenship. The substantial presence test is a RESIDENCE test for non-citizens and does not address a person taxed on the basis of citizenship at all. No document held here covers citizenship-based taxation, and this dossier states that absence among the questions it carries no source for.",
    ]),
    caveats: Object.freeze(["C-12"]),
  }),
});

// ---------------------------------------------------------------------------
// The bilateral employment-income articles, per pair
// ---------------------------------------------------------------------------
// THE CENTRAL FINDING OF THIS FILE IS NOT ANY ONE ARTICLE. It is that the six
// pairs the demo set can produce carry six DIFFERENT windows and, in one case,
// a different structure entirely — and that all six are three-limb tests whose
// day limb is the only one this system can see anything of.
//
// `structure` distinguishes the five conjunctive articles from the US–Canada
// one, which offers a money limb as an ALTERNATIVE to the day limb. Reading
// XV(2) as if it were shaped like the other five would be a real error, and it
// is the kind a uniform data shape quietly produces.
// ---------------------------------------------------------------------------

const LIMB_B = Object.freeze({
  key: "employer_not_resident",
  label: "(b) the employer is not a resident of the other State",
  state: "stated_in_source",
  systemCoverage: "none",
  coverageNote:
    "Nothing in a UC-08 request carries the employer's residence, and under an Employer-of-Record arrangement the employing entity is frequently resident in precisely the State the employee is working in — which is the limb that most often fails. This system cannot see it and does not try.",
});

const LIMB_C = Object.freeze({
  key: "not_borne_by_a_permanent_establishment",
  label: "(c) the remuneration is not borne by a permanent establishment or fixed base in the other State",
  state: "stated_in_source",
  systemCoverage: "none",
  coverageNote:
    "Whether remuneration is borne by a permanent establishment is a question about the employer's presence and its cost allocation. Nothing in a request to this system records either, and the material that defines a permanent establishment is OECD Model art. 5 and its Commentary — paraphrase-only by licence, and NOT read here. This dossier states that absence among the questions it carries no source for.",
});

function limbA({ quote, window }) {
  return Object.freeze({
    key: "days_present",
    label: "(a) days present in the other State, below the article's own limit and over the article's own window",
    state: "stated_in_source",
    systemCoverage: "partial",
    quote,
    window,
    coverageNote:
      "This is the only limb this system produces a figure for, and the figure is measured over whatever window the request supplied — not over the article's. A count that appears to clear or breach the line may have been taken over a different period entirely — the caveat printed with this finding sets out how far the six windows differ.",
  });
}

/** @type {Readonly<Record<string, object>>} */
export const TREATY_EMPLOYMENT_ARTICLES = Object.freeze({
  "NL|PT": Object.freeze({
    pair: Object.freeze(["NL", "PT"]),
    source: "D-24",
    locator: "art. 15(2)",
    structure: "three_cumulative_limbs",
    inForceSince: "2000-08-11",
    concluded: "1999-09-20, Oporto",
    limbs: Object.freeze([
      limbA({
        window: "183 days in any twelve month period commencing or ending in the FISCAL year concerned",
        quote:
          "the recipient is present in the other State for a period or periods not exceeding in the aggregate 183 days in any twelve month period commencing or ending in the fiscal year concerned",
      }),
      LIMB_B,
      LIMB_C,
    ]),
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
  "CA|NL": Object.freeze({
    pair: Object.freeze(["CA", "NL"]),
    source: "D-25",
    locator: "art. 15(2)",
    structure: "three_cumulative_limbs",
    inForceSince: "signed 1986-05-27, consolidated with the 1993 and 1997 Protocols",
    concluded: "1986-05-27",
    limbs: Object.freeze([
      limbA({
        window: "183 days in any twelve month period commencing or ending in the CALENDAR year concerned",
        quote:
          "the recipient is present in the other State for a period or periods not exceeding in the aggregate 183 days in any twelve month period commencing or ending in the calendar year concerned",
      }),
      LIMB_B,
      LIMB_C,
    ]),
    // WHY THE VERSION ROW IS NOT DECORATIVE. This text is a consolidation
    // across an original convention and two protocols, which is exactly the
    // kind of instrument where "which version is in force" is a real question.
    versionNote:
      "The published text is a departmental CONSOLIDATION of the 1986 convention with the Protocols of 1993-03-04 and 1997-08-25. Check which version governs the period in question before relying on the wording.",
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
  "CA|PT": Object.freeze({
    pair: Object.freeze(["CA", "PT"]),
    source: "D-26",
    locator: "art. 15(2)",
    structure: "three_cumulative_limbs",
    inForceSince: "2001-10-24",
    concluded: "1999-06-14, Ottawa",
    limbs: Object.freeze([
      limbA({
        window: "183 days in any twelve month period commencing or ending in the CALENDAR year concerned",
        quote:
          "the recipient is present in the other State for a period or periods not exceeding in the aggregate 183 days in any twelve month period commencing or ending in the calendar year concerned",
      }),
      LIMB_B,
      LIMB_C,
    ]),
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
  "NL|US": Object.freeze({
    pair: Object.freeze(["NL", "US"]),
    source: "D-27",
    locator: "art. 16(2) — Dependent Personal Services",
    structure: "three_cumulative_limbs",
    inForceSince: "as published by the IRS, with later protocols and technical explanations linked from the country page",
    concluded: null,
    limbs: Object.freeze([
      limbA({
        window: "183 days in the TAXABLE year concerned — a fixed year, with no floating twelve-month period at all",
        quote:
          "the recipient is present in the other State for a period or periods not exceeding in the aggregate 183 days in the taxable year concerned",
      }),
      LIMB_B,
      LIMB_C,
    ]),
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
  "PT|US": Object.freeze({
    pair: Object.freeze(["PT", "US"]),
    source: "D-27",
    locator: "art. 16(2) — Dependent Personal Services",
    structure: "three_cumulative_limbs",
    inForceSince: "general effective date under art. 30: 1996-01-01, per the PDF's own header",
    concluded: null,
    limbs: Object.freeze([
      limbA({
        window: "183 days in any 12-month period commencing or ending in the TAXABLE year concerned",
        quote:
          "the recipient is present in the other State for a period or periods not exceeding in the aggregate 183 days in any 12-month period commencing or ending in the taxable year concerned",
      }),
      LIMB_B,
      LIMB_C,
    ]),
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
  "CA|US": Object.freeze({
    pair: Object.freeze(["CA", "US"]),
    source: "D-27",
    locator: "art. XV(2) — Dependent Personal Services",
    // THE ONE THAT IS NOT SHAPED LIKE THE OTHER FIVE, and the reason this field
    // exists. Article XV(2) offers a MONEY limb as an alternative to the day
    // limb — "(a) … or (b) …" — so a stay well past 183 days can still fall to
    // the residence State on remuneration alone, and a short stay can fail on
    // who bears the cost. Flattening it into the (a) and (b) and (c) shape of
    // its neighbours would be a real error about a real treaty.
    structure: "alternative_limbs",
    inForceSince: "as published by the IRS, with protocols",
    concluded: null,
    limbs: Object.freeze([
      Object.freeze({
        key: "de_minimis_remuneration",
        label: "(a) remuneration at or below the article's own money limit, in the currency of the other State — an ALTERNATIVE to the day limb, not a rider on it",
        state: "stated_in_source",
        systemCoverage: "none",
        quote:
          "Such remuneration does not exceed ten thousand dollars … in the currency of that other State",
        // THE ELLIPSIS IS NOT TIDYING. The convention prints the figure again
        // as a parenthetical numeral, and the sidecar's transcription of that
        // parenthetical is corrupt — it renders as "(0,000)", the leading "$1"
        // lost somewhere between the PDF and the markdown. Reproducing a
        // corrupt money figure inside quotation marks in front of a tax
        // specialist is the one thing this file may not do, so the words are
        // quoted and the numeral is elided with a pointer to the bytes.
        transcriptionNote:
          "The article states the figure in words and again as a parenthetical numeral. The numeral is elided above because the transcription held here is corrupt — its leading digit is lost. Read the figure from the IRS's own published text of the convention, https://www.irs.gov/pub/irs-trty/canada.pdf, art. XV(2), before relying on it.",
        coverageNote:
          "No figure in a UC-08 dossier is a remuneration figure. This limb can settle the article on its own and this system sees nothing of it.",
      }),
      Object.freeze({
        key: "days_present_and_cost_not_borne",
        label: "(b) 183 days in that calendar year AND the remuneration not borne by a resident employer or by a permanent establishment there — one limb containing two conditions",
        state: "stated_in_source",
        systemCoverage: "partial",
        window: "183 days in THAT calendar year — and note the article opens on employment exercised \"in a calendar year\"",
        quote:
          "The recipient is present in the other Contracting State for a period or periods not exceeding in the aggregate 183 days in that year and the remuneration is not borne by an employer who is a resident of that other State or by a permanent establishment or a fixed base which the employer has in that other State.",
        coverageNote:
          "This system produces a day figure and nothing else in this limb. The employer-residence and permanent-establishment conditions sit INSIDE limb (b) here rather than as separate limbs, so failing either fails the whole limb even where the day count clears.",
      }),
    ]),
    caveats: Object.freeze(["C-10", "C-11"]),
  }),
});

// ---------------------------------------------------------------------------
// Social-security coverage, per pair
// ---------------------------------------------------------------------------
// TWO NETWORKS, AND THEY ARE NOT INTERCHANGEABLE. The SSA publishes UNITED
// STATES agreements; the CRA and Global Affairs Canada publish CANADIAN ones;
// the EU regulations coordinate between Member States and are not an agreement
// at all. `maximumInitialDetachment` is a STRING throughout — "24 months",
// "60 months", "5 years" — precisely so that nothing can compare two of them.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, object>>} */
export const SOCIAL_SECURITY_COVERAGE = Object.freeze({
  "NL|PT": Object.freeze({
    pair: Object.freeze(["NL", "PT"]),
    network: "EU coordination — not a bilateral agreement",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-17",
        locator: "arts. 11(1), 11(3)(a), 12(1) and 13(1)",
        citedFor:
          "which single Member State's legislation applies. Art. 11(3)(a) is the DEFAULT and it is the opposite of what an unflagged cross-border case implies: absent a posting, the state where the activity is pursued applies from day one. Art. 12(1) is the posting exception; art. 13(1) covers a person working in two or more states.",
        quote:
          "Persons to whom this Regulation applies shall be subject to the legislation of a single Member State only. … a person pursuing an activity as an employed or self-employed person in a Member State shall be subject to the legislation of that Member State",
      },
      {
        source: "D-18",
        locator: "art. 19(2), with arts. 14(8) and 16",
        citedFor:
          "the certificate itself, and the fact that NEITHER regulation ever uses the name \"A1\". The legal object is the art. 19(2) attestation that a named state's legislation applies, and until what date and under what conditions. Art. 16 sets the order — the residence-state institution determines provisionally, and the determination becomes definitive two months after the other institutions are informed, which is longer than many assignments.",
        quote:
          "the competent institution of the Member State whose legislation is applicable pursuant to Title II of the basic Regulation shall provide an attestation that such legislation is applicable and shall indicate, where appropriate, until what date and under what conditions",
      },
      {
        source: "D-19",
        locator: "Practical Guide on the applicable legislation",
        citedFor:
          "how the institutions that actually issue the attestation apply arts. 12 and 13 — including a two-month break required between postings, a forward-looking twelve-month assessment window, and a second indicative percentage that points the opposite way from art. 14(8)'s.",
      },
    ]),
    maximumInitialDetachment: "24 months (Reg. 883/2004 art. 12(1), on the anticipated duration of the work)",
    certificate: "The art. 19(2) attestation, issued as portable document A1",
    caveats: Object.freeze(["C-6", "C-7", "C-22", "C-23"]),
  }),
  "CA|NL": Object.freeze({
    pair: Object.freeze(["CA", "NL"]),
    network: "Canada's bilateral network",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-21",
        locator: "CRA agreement table (Netherlands row) and form CPT63, with CTS 1990/14 and CTS 2004/6",
        citedFor:
          "that the pair IS covered, which certificate applies, and — the reason this entry exists rather than a one-line table row — that there are TWO Canada–Netherlands agreements and the agency's own table mixes them. The 1987 agreement, in force 1990-10-01, allows twenty-four months; the 2001 agreement that replaced it, in force 2004-04-01, allows sixty. Read the instrument, not the row.",
        quote:
          "provided that such assignment does not exceed sixty months",
        quoteLocator: "E104279 (CTS 2004/6) art. VI(2) — the agreement currently in force",
      },
    ]),
    maximumInitialDetachment:
      "60 months under the agreement in force (CTS 2004/6 art. VI(2)); 24 months under the superseded 1987 agreement (CTS 1990/14 art. VI(2)). The CRA's table prints the earlier date beside the later figure.",
    certificate: "CPT63",
    caveats: Object.freeze(["C-24", "C-8", "C-9"]),
  }),
  "CA|PT": Object.freeze({
    pair: Object.freeze(["CA", "PT"]),
    network: "Canada's bilateral network",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-21",
        locator: "CRA agreement table (Portugal row) and form CPT55, with CTS 1981/15 art. VII",
        citedFor:
          "the one Canada–Portugal agreement in the register — signed Toronto 1980-12-15, in force 1981-05-01 — its 24-month posting period, and the mechanism past it: an extension needs the PRIOR CONSENT of both competent authorities. The maximum is a ceiling with a named bilateral route past it, not a cliff, and this system represents neither.",
        quote:
          "the legislation of the first Party shall continue to apply to him in respect of that work relationship for a period of up to 24 months",
        quoteLocator: "E102185 (CTS 1981/15) art. VII(1)",
      },
    ]),
    maximumInitialDetachment: "24 months (CTS 1981/15 art. VII(1)), extendable only with both competent authorities' prior consent (art. VII(3))",
    certificate: "CPT55",
    caveats: Object.freeze(["C-8", "C-9"]),
    confirmations: Object.freeze(["K-4"]),
  }),
  "NL|US": Object.freeze({
    pair: Object.freeze(["NL", "US"]),
    network: "The United States' bilateral network",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Netherlands row, TIAS 03-501), with the territoriality and detached-worker rules",
        citedFor:
          "that the agreement is in force from 1990-11-01, that it carries two further Protocols — so \"an agreement exists\" and \"which text governs\" are different questions — and the two rules that turn coverage into an answer: territoriality puts the worker under the law of the country they are working in, and the detached-worker exception keeps them under the sending country's for assignments expected to last five years or less.",
        quote:
          "Under this basic \"territoriality\" rule, an employee who would otherwise be covered by both the U.S. and a foreign system remains subject exclusively to the coverage laws of the country in which he or she is working.",
      },
    ]),
    maximumInitialDetachment: "generally 5 years, which the SSA itself notes is substantially longer than other networks allow",
    certificate: "US certificate of coverage",
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
  "PT|US": Object.freeze({
    pair: Object.freeze(["PT", "US"]),
    network: "The United States' bilateral network",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Portugal row, TIAS 12121), with the detached-worker rule",
        citedFor:
          "that the US–Portugal agreement is in force from 1989-08-01 — a DIFFERENT agreement, network and date from Canada–Portugal's 1981-05-01 — and the detached-worker exception that keeps a temporarily transferred employee under the sending country's system alone.",
        quote:
          "Under this \"detached-worker\" exception, a person who is temporarily transferred to work for the same employer in another country remains covered only by the country from which he or she has been sent. … The detached-worker rule in U.S. agreements generally applies to employees whose assignments in the host country are expected to last 5 years or less.",
      },
    ]),
    maximumInitialDetachment: "generally 5 years",
    certificate: "US certificate of coverage",
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
  "CA|US": Object.freeze({
    pair: Object.freeze(["CA", "US"]),
    network: "Both networks publish this pair, from their own side",
    covered: true,
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Canada row, TIAS 10863)",
        citedFor: "that the agreement is in force from 1984-08-01, with the US detached-worker limit of generally five years.",
      },
      {
        source: "D-21",
        locator: "CRA agreement table (United States row) and form CPT56",
        citedFor:
          "the same pair as the CRA publishes it — effective 1984-08-01, certificate CPT56, sixty months. Two authorities describing one relationship from opposite ends; where they disagree, the agreement text decides — and for Canada–Netherlands they do disagree, which is printed as a caveat on that pair.",
      },
    ]),
    maximumInitialDetachment: "60 months per the CRA's table; generally 5 years per the SSA",
    certificate: "CPT56 (Canada side) / US certificate of coverage (US side)",
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
});

// ---------------------------------------------------------------------------
// Finding -> sources
// ---------------------------------------------------------------------------
// `axis` says what the finding is a finding ABOUT, and it is the whole shape of
// this file. A UC-08 finding is never free-floating: "the day count" is a
// finding about ONE jurisdiction, and "which state may tax the employment
// income" is a finding about a PAIR. A citation that ignored the axis would be
// the nearest-match failure in its purest form — CIRS art. 16.º printed beside
// a Canadian question.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, axis:"country"|"pair", question:string}>>} */
export const FINDING_SOURCES = Object.freeze({
  residence_test: {
    label: "The domestic rule that decides whether this person is resident in this jurisdiction",
    axis: "country",
    question: "Under this country's own law, what makes somebody resident here — and is it even shaped like a day count?",
  },
  presence_day_count: {
    label: "The presence-day figure, and the rules it would have to be measured against",
    axis: "country",
    question: "This dossier counted days in this country. Against what, exactly, and counted how?",
  },
  treaty_employment_article: {
    label: "Which of the two states may tax this employment income",
    axis: "pair",
    question: "What does the convention actually in force for this pair say, and how many of its limbs does this system see?",
  },
  social_security_coverage: {
    label: "Which state's social-security legislation applies, and what certifies it",
    axis: "pair",
    question: "Is this pair covered, by which instrument, for how long, and on which certificate?",
  },
});

// ---------------------------------------------------------------------------
// The findings with NO source, said out loud
// ---------------------------------------------------------------------------
// A citation block that only ever appears where a citation exists teaches a
// reader that everything unmarked is unsourced-but-fine. Three different
// absences live here and they are three different facts:
//
//   * a finding about THIS SYSTEM or THIS REQUEST, which no authority publishes
//     anything about and never will;
//   * a finding whose governing material EXISTS and may not be copied — the
//     OECD Model and BEPS Action 7, paraphrase-only by licence, and not read;
//   * a finding about a jurisdiction or pair this corpus does not hold, which
//     `uncitedFinding()` answers dynamically rather than by enumeration.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, why:string}>>} */
export const UNCITED_FINDINGS = Object.freeze({
  permanent_establishment_exposure: {
    label: "Whether the arrangement creates a permanent establishment for the employer",
    why:
      "No source, and the reason is a LICENCE rather than an oversight. The material that governs this is OECD Model Tax Convention art. 5 and its Commentary, plus BEPS Action 7 — copyrighted publications that may be paraphrased with a precise citation and never copied, and which nobody in this chain has read. What is held in their place is a register of article numbers, and that register records that the documents themselves were not retrieved. That matters here twice over, because limb (c) of every treaty article above turns on exactly this concept.",
  },
  treaty_residence_tie_breaker: {
    label: "Which state a dual resident is treated as resident of, under the treaty",
    why:
      "No source that has been read. The conventions cited above DO contain a residence article with tie-breaker tests, and all six instruments are held here — but only the employment-income article of each was transcribed and checked, so nobody in this chain has read the residence article's text. Citing it from the shape of the model it was drafted from would be citing a provision nobody here has opened. What IS held is the DOMESTIC residence test of each jurisdiction, quoted in the residence block of this dossier — the question the tie-breaker only arises after both countries have answered yes to.",
  },
  citizenship_based_taxation: {
    label: "Whether this person is taxed on the basis of citizenship rather than residence",
    why:
      "No source, and no input either. No document covering citizenship-based taxation has been retrieved at all; the nearest material held is the US substantial-presence test, which is a residence test for NON-citizens and answers a different question. Separately, nothing a request to this system can carry records a nationality, citizenship or passport, so it cannot tell whom the question would apply to and does not try. Closing this would need both a source AND a change to what a request is allowed to record — and the second of those is not a document.",
  },
  inquiry_track_not_identified: {
    label: "The request was not classified into a tax track",
    why: "Nothing to cite — a statement about how this system read the request text, not about any jurisdiction's law.",
  },
  no_jurisdiction_identified: {
    label: "No jurisdiction was identified in the request",
    why:
      "Nothing to cite — and note what it is NOT: it is not a finding that no country is involved. It is a statement that no country name this system recognises appeared in the text. A jurisdiction nobody named is correctly not listed and is not thereby absent from the facts.",
  },
  presence_not_requested: {
    label: "No presence-day count was taken",
    why: "Nothing to cite — no country and window were supplied to count over, which is a property of the request.",
  },
  presence_not_evaluated: {
    label: "The presence-day count could not be computed from the records supplied",
    why:
      "Nothing to cite — an input-quality problem with the travel records, not a question any authority answers. Treat it as missing rather than as zero: a stated zero reads as well under any threshold, which is a conclusion nobody computed.",
  },
  narrative_not_checked: {
    label: "The drafted narrative was not checked against the structured facts",
    why: "Nothing to cite — a property of the optional check this system runs over its own drafted prose, which is informational and changes no part of the answer.",
  },
});

/** The jurisdictions this file holds a domestic residence test for. */
export const SOURCED_COUNTRIES = Object.freeze(["CA", "NL", "PT", "US"]);

/** The pairs this file holds a bilateral instrument for, as canonical keys. */
export const SOURCED_PAIRS = Object.freeze(["CA|NL", "CA|PT", "CA|US", "NL|PT", "NL|US", "PT|US"]);

// ---------------------------------------------------------------------------
// Lookups. Three of them, all pure, none of which can return a nearest match.
// ---------------------------------------------------------------------------

function normalise(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/**
 * The canonical key for a jurisdiction pair: both codes, uppercased, sorted, so
 * that CA→NL and NL→CA resolve to the same instrument. Direction of travel does
 * not change which treaty is in force between two states.
 *
 * Returns null unless both codes are present and different — a "pair" of one
 * country with itself is not a cross-border question.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string|null}
 */
export function pairKey(a, b) {
  const first = normalise(a);
  const second = normalise(b);
  if (!first || !second || first === second) return null;
  return [first, second].sort().join("|");
}

function expandDocument(id) {
  const doc = SOURCE_LIBRARY[id];
  return {
    sourceId: doc.id,
    title: doc.title,
    instrument: doc.instrument,
    publisher: doc.publisher,
    // WHERE THE READER GOES, AND WHERE THE BUILD GOES. `url` is the publisher's
    // own address — the only one of the two a tax specialist can open. `path`
    // and `bytes` are this repository's provenance copy, kept because the test
    // suite reads them to prove the citation resolves and the quotation is
    // really in the document; they are not an address anybody outside the build
    // can follow, and no sentence in this file may use one as if they were.
    url: doc.url,
    path: doc.path,
    bytes: doc.bytes,
    evidence: doc.evidence,
    licence: doc.licence,
  };
}

/**
 * `matchedOn` — the honesty field, copied from treatyRetriever.js's own. It
 * names the MECHANISM (a person wrote this down, against this finding, for this
 * jurisdiction or pair) and carries no score, rank or confidence, because none
 * was computed. A reader who has seen "embedding similarity — ranked 1 of 3"
 * from the retriever must be able to tell this apart from it at a glance.
 */
function matchedOn(findingKey, scope) {
  // NAMED IN THE READER'S WORDS, NOT IN THE KEY'S. This used to interpolate the
  // finding key itself — `presence_day_count` — and the pair key's pipe form,
  // so the one field whose whole job is to tell a specialist HOW a document got
  // here spoke to them in identifiers instead.
  const label = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey].label : findingKey;
  const where = String(scope).replace("|", "–");
  return `hand-curated map entry: a person read this document and listed it against "${label}" for ${where}. Nothing was searched.`;
}

function caveatsFor(ids) {
  return (ids ?? []).map((id) => CAVEAT_LIBRARY[id]);
}

function confirmationsFor(ids) {
  return (ids ?? []).map((id) => CONFIRMATION_LIBRARY[id]);
}

/**
 * The reading list for one finding, in one jurisdiction or for one pair.
 *
 * Returns null — never an empty shell and never a nearest match — when the
 * finding has no entry, when the scope is missing, or when this corpus holds
 * nothing for that jurisdiction or pair. A caller that renders null renders
 * nothing, which is the honest output for "we hold no source for this".
 *
 * @param {string} findingKey
 * @param {object} [scope]
 * @param {string|null} [scope.country]  ISO 3166-1 alpha-2, for a country-axis finding
 * @param {Array<string>|null} [scope.pair]  two alpha-2 codes, for a pair-axis finding
 */
export function sourcesForFinding(findingKey, { country = null, pair = null } = {}) {
  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;

  if (entry.axis === "country") {
    const code = normalise(country);
    if (!code || !Object.hasOwn(RESIDENCE_TESTS, code)) return null;
    const test = RESIDENCE_TESTS[code];
    const cite = [
      {
        ...expandDocument(test.source),
        locator: test.locator,
        citedFor:
          findingKey === "presence_day_count"
            ? `the rule a day count in ${test.name} would have to be measured against — including whether that country's law is shaped like a day count at all, and what it counts as a day.`
            : `what makes a person resident in ${test.name} under that country's own law, quoted from the authority that administers it.`,
        quote: test.quote,
        matchedOn: matchedOn(findingKey, code),
      },
    ];
    if (test.alsoRead) {
      cite.push({
        ...expandDocument(test.alsoRead.source),
        locator: test.alsoRead.locator,
        citedFor: test.alsoRead.whatTheSourceSays,
        quote: test.alsoRead.quote,
        matchedOn: matchedOn(findingKey, code),
      });
    }
    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "country",
      scope: code,
      framing: RESIDENCE_FRAMING,
      method: RETRIEVAL_METHOD,
      residenceTest: test,
      citations: cite,
      caveats: caveatsFor(test.caveats),
      confirmations: [],
    };
  }

  // Pair axis.
  const key = Array.isArray(pair) ? pairKey(pair[0], pair[1]) : null;
  if (!key) return null;

  if (findingKey === "treaty_employment_article") {
    const treaty = Object.hasOwn(TREATY_EMPLOYMENT_ARTICLES, key) ? TREATY_EMPLOYMENT_ARTICLES[key] : null;
    if (!treaty) return null;
    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "pair",
      scope: key,
      framing: TREATY_FRAMING,
      method: RETRIEVAL_METHOD,
      treaty,
      citations: [
        {
          ...expandDocument(treaty.source),
          locator: treaty.locator,
          citedFor:
            `the employment-income article of the convention in force between ${treaty.pair[0]} and ${treaty.pair[1]}, and the window it measures presence over — which is this pair's own and is not the same as any other pair's.`,
          quote: treaty.limbs.map((limb) => limb.quote).filter(Boolean).join(" … "),
          matchedOn: matchedOn(findingKey, key),
        },
      ],
      caveats: caveatsFor(treaty.caveats),
      confirmations: [],
    };
  }

  if (findingKey === "social_security_coverage") {
    const coverage = Object.hasOwn(SOCIAL_SECURITY_COVERAGE, key) ? SOCIAL_SECURITY_COVERAGE[key] : null;
    if (!coverage) return null;
    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "pair",
      scope: key,
      framing: SOURCE_FRAMING,
      method: RETRIEVAL_METHOD,
      coverage,
      citations: coverage.cite.map((c) => ({
        ...expandDocument(c.source),
        locator: c.locator,
        citedFor: c.citedFor,
        quote: c.quote ?? null,
        quoteLocator: c.quoteLocator ?? null,
        matchedOn: matchedOn(findingKey, key),
      })),
      caveats: caveatsFor(coverage.caveats),
      confirmations: confirmationsFor(coverage.confirmations),
    };
  }

  return null;
}

/**
 * Why a finding carries no citation. The same contract in reverse, and it
 * answers for all three kinds of absence — a finding about this system, a
 * finding whose material may not be copied, and a finding about a jurisdiction
 * or pair this corpus does not hold.
 *
 * Null when the key is not one this file knows at all, so a caller can tell
 * "we looked and there is nothing" from "this key is unknown here".
 *
 * @param {string} findingKey
 * @param {object} [scope]
 * @param {string|null} [scope.country]
 * @param {Array<string>|null} [scope.pair]
 */
export function uncitedFinding(findingKey, { country = null, pair = null } = {}) {
  const flat = Object.hasOwn(UNCITED_FINDINGS, findingKey) ? UNCITED_FINDINGS[findingKey] : null;
  if (flat) return { finding: findingKey, label: flat.label, why: flat.why, scope: null };

  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;

  if (entry.axis === "country") {
    const code = normalise(country);
    if (code && Object.hasOwn(RESIDENCE_TESTS, code)) return null; // it is cited; nothing to explain
    return {
      finding: findingKey,
      label: entry.label,
      scope: code || null,
      why:
        `No source. A domestic residence test is held here for ${SOURCED_COUNTRIES.join(", ")} only` +
        (code ? `, and ${code} is not among them` : ", and no jurisdiction was supplied to look one up for") +
        ". That is not a finding that no residence rule exists there — it is a statement that this system has never looked, so nothing here can be read as a clearance.",
    };
  }

  const key = Array.isArray(pair) ? pairKey(pair[0], pair[1]) : null;
  const held =
    key &&
    ((findingKey === "treaty_employment_article" && Object.hasOwn(TREATY_EMPLOYMENT_ARTICLES, key)) ||
      (findingKey === "social_security_coverage" && Object.hasOwn(SOCIAL_SECURITY_COVERAGE, key)));
  if (held) return null;

  return {
    finding: findingKey,
    label: entry.label,
    scope: key,
    why:
      // The pairs are spelled the way the next clause spells DE–ES. The canonical
      // key form (CA|NL) is how this file indexes them and is not how anybody
      // reads a pair of countries.
      `No source. Bilateral instruments are held here for these pairs only: ${SOURCED_PAIRS.map((k) => k.replace("|", "–")).join(", ")}` +
      (key ? `, and ${key.replace("|", "–")} is not among them` : ", and no pair of jurisdictions was identified to look one up for") +
      ". A neighbouring pair's treaty is not a substitute: the six instruments here define six different windows and one of them is not even the same shape, so the closest match would be wrong in a way nothing downstream could detect.",
  };
}
