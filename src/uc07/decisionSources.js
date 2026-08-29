// ---------------------------------------------------------------------------
// decisionSources.js  —  The instruments behind a permanent-relocation dossier
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-07 is 🔴 and has NO execution path. Nothing is approved here, nothing is
// written, nothing is executed — so the feasibility dossier a Mobility Legal
// Tier-3 specialist opens IS the entire product. If the dossier is thin, this
// use case delivered nothing.
//
// It was thin. `dossierView.js` already ranks what the gates found and names
// every hole; what it could not do was answer the next question a specialist
// asks, which is **says who?** A CA→NL relocation raising
// `UC07_IMMIGRATION_REQUIRED` reached the most senior mobility reader in this
// system carrying six passages this project had written itself from a build
// pack — while `docs/knowledge/layer-1-statutory/` held the Portuguese
// remote-work visa article as enacted in the gazette (D-10), the consular
// network's own conditions for it (D-11), the Canadian regulation on working
// without a permit (D-16), USCIS on the B-1 and State/CBP on the visa waiver
// (D-15, D-14), the EU social-security coordination regulations (D-17, D-18,
// D-19), both bilateral social-security networks (D-20, D-21) and all four
// demo countries' domestic tax-residence tests (D-31 to D-35).
//
// SAME SHAPE, SAME DISCIPLINE, AS src/uc04/decisionSources.js AND
// src/uc05/decisionSources.js — read UC-04's header first; it argues the design
// and this one does not repeat it. Finding key -> the documents somebody read
// when the check was written up. No retrieval engine, no embedding, no ranking,
// no score.
//
// THIS IS NOT `mobilityRetriever.js`. That file SEARCHES its own corpus of
// general mobility principles and can return a nearest match; this one LOOKS UP
// a destination, or a route, and resolves to the instrument that governs it or
// to nothing at all. Portugal's D8 is not a near miss for Canada's IRPR s. 186.
//
// THE ONE THING THIS FILE HAS TO SAY BEFORE ANY OF ITS CITATIONS, and it is the
// reason `NATIONALITY_NOT_HELD` exists: **UC-07 has no nationality field.**
// `grep -rn "nationality\|citizen\|passport" src/uc07/` matches nothing. Every
// immigration instrument below is a route for a THIRD-COUNTRY NATIONAL of the
// destination, and whether any of them applies to this employee depends
// entirely on a nationality this system does not hold and cannot infer. So the
// citations are offered as *the destination's published routes*, never as *this
// person's route*, and the statement of that gap travels with every one of
// them. It is the same defect, one use case over, as UC-08's
// CITIZENSHIP_BASED_TAXATION.
//
// SIX RULES THAT ARE NOT NEGOTIABLE.
//
//   1. NEVER INVENT A CITATION. Every `path` points at a file vendored under
//      `docs/knowledge/`, and `test/uc07DecisionSources.test.js` asserts each
//      one exists on disk and still opens with its catalogue id.
//
//   2. A FINDING WITH NO SOURCE GETS AN EXPLICIT STATEMENT THAT IT HAS NONE.
//      Most of UC-07's flags are about Remote's own product rules — minimum
//      onboarding time, duplicate management fees, entity status, the
//      offboarding sequence — and no jurisdiction publishes anything about any
//      of them. `UNCITED_FINDINGS` says so for each, one at a time, because
//      "there is no source" and "nobody looked" read identically on a screen.
//
//   3. NO RANKING, NO SCORE, NO SIMILARITY NUMBER. `RETRIEVAL_METHOD` says in
//      plain words that a person read these and wrote them down.
//
//   4. NOTHING HERE MAY REACH A GATE. UC-07's decision is `escalate`, always.
//      This module imports nothing, takes no client, no clock and no I/O; no
//      citation id appears in a conditional anywhere in this repository; and
//      the test asserts that neither `transitionGate.js` nor `workflow.js` nor
//      any other module in the decision path imports this file.
//
//   5. QUOTE ONLY WHAT THE DOCUMENT SAYS, WITH ITS LOCATOR — and where a
//      document is SILENT on a question this dossier raises, say **silent**.
//      Not "permitted", not "forbidden". Portugal's art. 61.º-B is the sharpest
//      case in the corpus: it is fifty-two words creating a visa and it
//      contains no income floor, no duration and no insurance requirement, so
//      the honest citation says the article is silent on all three and names
//      where the conditions actually live.
//
//   6. THE LICENCE IS PART OF THE CITATION. OECD Model and BEPS material is
//      **paraphrase-only, never copied** — so permanent-establishment exposure,
//      which is UC-07's `UC07_PE_RISK_REVIEW_REQUIRED` flag, appears in this
//      file exactly once, in `UNCITED_FINDINGS`, saying the governing material
//      has not been read. Commercial databases (IBFD, Bloomberg Tax, Vialto)
//      are excluded entirely and appear nowhere. `support.remote.com` is
//      cite-and-link only and is not an immigration or tax authority, so it is
//      not cited here at all. `docs/knowledge/DOWNLOAD-MANIFEST.md` §3 carries
//      the class per document; every quotation below is drawn from a class (a),
//      (b) or (c) source whose own sidecar already quotes the same passage.
//
// A NUMBER MAY BE QUOTED AND MAY NEVER BE CARRIED. Every threshold here lives
// inside a `quote` or a descriptive string — the authority's own words — and no
// field holds one as a value, so nothing downstream can compare two of them.
// The test pins it: no numeric value appears anywhere in what these lookups
// return.
// ---------------------------------------------------------------------------

const KNOWLEDGE = "docs/knowledge/layer-1-statutory";
const CONTRADICTIONS = `${KNOWLEDGE}/CONTRADICTIONS.md`;

/** Rendered once above the citation block. Not decoration — see rule 4. */
export const SOURCE_FRAMING =
  "These are the instruments this dossier's checks and framing were written from, linked so you can read them. " +
  "Nothing here is advice and no gate consults any of it: a citation says which rule a statement is based on and where the text is, never whether this relocation may proceed. UC-07 reaches one decision — escalate — and no document below can change it.";

/** Rendered once above the caveats, for the same reason. */
export const CAVEAT_FRAMING =
  "Where this system applies a rule one of these documents disputes, the dispute is printed with the finding. " +
  "A contradicted finding is not evidence for the opposite conclusion — it is a finding whose basis you now know the limits of.";

/** How the citations got here. Stated because the alternative is assumed. */
export const RETRIEVAL_METHOD =
  "Hand-curated: each document below is listed against this finding, for this destination or this route, in src/uc07/decisionSources.js, by someone who read it. There is no search, no ranking and no similarity score, so no figure of confidence is quoted. A finding with no entry gets no citation rather than a nearest match.";

/**
 * THE STATEMENT THAT TRAVELS WITH EVERY IMMIGRATION CITATION, and the reason it
 * is a constant rather than a sentence inside one country's entry.
 *
 * Every route below is a destination's published route for a third-country
 * national. Whether it is the route THIS employee needs — or whether they need
 * one at all, as an EU national moving inside the EU would not — turns on a
 * nationality. UC-07's request shape carries none: no field, no parser output,
 * nothing. So the disclosure cannot be conditioned on detecting who it applies
 * to, because detection is precisely what this system cannot do. Conditioning
 * it would rebuild the silence for everyone it failed to spot, which is the
 * defect UC-08's CITIZENSHIP_BASED_TAXATION exists to close one use case over.
 */
export const NATIONALITY_NOT_HELD = Object.freeze({
  key: "nationality_not_held",
  assessed: false,
  statement:
    "This system holds NO nationality, citizenship or passport for this employee — a relocation request here has no such field anywhere in it. Every immigration instrument cited below is the destination's published route for a third-country national, offered as background on what that country requires, NEVER as a statement about this person's route or entitlement. If this employee holds a nationality that gives them a right of entry and work in the destination, none of it applies and nothing here says so; if they do not, which route applies is a question for a specialist with the passport in front of them.",
  whyItIsStatedEveryTime:
    "Because the system cannot detect whom it applies to. There is no nationality input to condition on, so printing this only where a visa looked necessary would reproduce the original silence for every case the absence of a field made invisible.",
  wouldBeSuppliedBy:
    "A nationality on the relocation request, and a source for the destination's rules for that nationality. The first is a data-model change, not a document, which is why no citation below can close this.",
});

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------
// One entry per vendored file (or per closely-bound group). `path` is
// repo-relative because these are FILES; `bytes` is the retrieved original
// where the licence permitted keeping one and null where it did not, and the
// difference is shown rather than smoothed over.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,title:string,instrument:string,publisher:string,path:string,bytes:string|null,evidence:string,licence:string}>>} */
export const SOURCE_LIBRARY = Object.freeze({
  "D-10": {
    id: "D-10",
    title: "Portugal — the article creating the remote-work residence visa (the \"D8\")",
    instrument: "Lei n.º 23/2007 art. 61.º-B, as inserted by Lei n.º 18/2022 of 25 August (in force 2022-08-26), with art. 54.º(1)(i)",
    publisher: "Assembleia da República, via Diário da República Eletrónico",
    path: `${KNOWLEDGE}/D-10-pt-d8-lei-23-2007-art-61b.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute as enacted, retrieved 2026-08-19] — the ENACTING text, not a consolidation; thirteen later amendments to Lei 23/2007 exist and whether any touched this article has not been established.",
    licence: "Quote and cite, no bytes — the statutory text is outside copyright; the gazette edition carries INCM's own terms and the 13 MB issue is not mirrored.",
  },
  "D-11": {
    id: "D-11",
    title: "Portugal — the D8's actual conditions, as the consular network states them",
    instrument: "Type of Visa; Necessary Documentation (Residency and Temporary Stay); Means of subsistence — five pages of the national visa portal",
    publisher: "Ministério dos Negócios Estrangeiros, consular network",
    path: `${KNOWLEDGE}/D-11-pt-d8-consular-requirements.md`,
    bytes: null,
    evidence: "[CONFIRMED — consular authority publication, retrieved 2026-08-19] — none of the five pages prints a version or a last-reviewed date; this is the worst-instrumented source in the Layer-1 set and it is the one supplying the figures.",
    licence: "Cite and link only, no bytes — no reuse terms are stated anywhere on the site.",
  },
  "D-14": {
    id: "D-14",
    title: "United States — the Visa Waiver Program and ESTA",
    instrument: "Visa Waiver Program (Department of State) and the ESTA FAQ (CBP)",
    publisher: "U.S. Department of State and U.S. Customs and Border Protection",
    path: `${KNOWLEDGE}/D-14-us-vwp-esta.md`,
    bytes: `${KNOWLEDGE}/sources/D-14-us-state-visa-waiver-program.txt`,
    evidence: "[CONFIRMED — agency publication, transcribed from a browser 2026-08-19] — a human transcription of a rendered page, not a byte capture: these hosts refuse this container's address outright.",
    licence: "US federal government work — public domain. Transcription committed in full.",
  },
  "D-15": {
    id: "D-15",
    title: "United States — the B-1 temporary business visitor",
    instrument: "B-1 Temporary Business Visitor (USCIS)",
    publisher: "U.S. Citizenship and Immigration Services, Department of Homeland Security",
    path: `${KNOWLEDGE}/D-15-us-b1-business-visitor.md`,
    bytes: `${KNOWLEDGE}/sources/D-15-us-uscis-b1-business-visitor.txt`,
    evidence: "[CONFIRMED — agency publication, transcribed from a browser 2026-08-19] — same transcription caveat as D-14, and the page's own last-updated stamp was not captured.",
    licence: "US federal government work — public domain. Transcription committed in full.",
  },
  "D-16": {
    id: "D-16",
    title: "Canada — working without a work permit, and the business-visitor test",
    instrument: "Immigration and Refugee Protection Regulations, SOR/2002-227, ss. 186 and 187 — current to 2026-06-17",
    publisher: "Department of Justice Canada, Justice Laws Website",
    path: `${KNOWLEDGE}/D-16-ca-work-without-permit-irpr-186.md`,
    bytes: `${KNOWLEDGE}/sources/D-16-ca-irpr-s186.html`,
    evidence: "[CONFIRMED — regulation, retrieved 2026-08-19]",
    licence: "Reproduction of Federal Law Order, SI/97-5. Bytes committed. Reproduction of a Government of Canada enactment — NOT the official version.",
  },
  "D-17": {
    id: "D-17",
    title: "Which single state's social security applies when someone works in another",
    instrument: "Regulation (EC) No 883/2004, consolidated text 02004R0883 — 31.07.2019",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-17-eu-reg-883-2004.md`,
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
    bytes: `${KNOWLEDGE}/sources/D-18-eu-reg-987-2009.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "EUR-Lex reuse (Commission Decision 2011/833/EU); consolidated text additionally CC BY 4.0.",
  },
  "D-20": {
    id: "D-20",
    title: "Status of US totalization agreements, and the detached-worker rule",
    instrument: "Status of Totalization Agreements, with the programme overview",
    publisher: "U.S. Social Security Administration, Office of International Programs",
    path: `${KNOWLEDGE}/D-20-us-ssa-totalization-status.md`,
    bytes: `${KNOWLEDGE}/sources/D-20-us-ssa-totalization-status.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19] — neither page prints a last-updated line, which is a real instrumentation gap in the highest-value US source here.",
    licence: "US federal government work — public domain. Bytes committed.",
  },
  "D-21": {
    id: "D-21",
    title: "Canada's social security agreement network, and the agreement texts behind it",
    instrument: "CRA agreement table and forms CPT63 / CPT55 / CPT56, with the CTS agreement texts (E102196, E102195, E104279, E102185)",
    publisher: "Canada Revenue Agency (CPP/EI Rulings), with Global Affairs Canada's treaty register",
    path: `${KNOWLEDGE}/D-21-D-22-D-23-ca-social-security-agreements.md`,
    bytes: null,
    evidence: "[CONFIRMED — agency publication and treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no bytes: non-commercial reproduction only, and a public career-facing repository is not clearly non-commercial.",
  },
  "D-24": {
    id: "D-24",
    title: "Netherlands–Portugal double taxation convention",
    instrument: "Convention concluded at Oporto 1999-09-20, entry into force 2000-08-11",
    publisher: "Ministerie van Buitenlandse Zaken, via Verdragenbank and wetten.overheid.nl",
    path: `${KNOWLEDGE}/D-24-nl-pt-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "Cite and quote only, no bytes.",
  },
  "D-25": {
    id: "D-25",
    title: "Canada–Netherlands income tax convention",
    instrument: "Convention signed 1986-05-27, consolidated with the Protocols of 1993-03-04 and 1997-08-25",
    publisher: "Department of Finance Canada",
    path: `${KNOWLEDGE}/D-25-ca-nl-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no bytes.",
  },
  "D-26": {
    id: "D-26",
    title: "Canada–Portugal income tax convention",
    instrument: "E103231, Canada Treaty Series 2001/27 — signed 1999-06-14, in force 2001-10-24",
    publisher: "Global Affairs Canada, Canada Treaty Information",
    path: `${KNOWLEDGE}/D-26-ca-pt-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "canada.ca terms of use — cite and extract only, no bytes.",
  },
  "D-27": {
    id: "D-27",
    title: "The three United States income tax conventions (Netherlands, Portugal, Canada)",
    instrument: "US–NL and US–PT arts. 16; US–CA art. XV — the dependent-personal-services articles",
    publisher: "Internal Revenue Service, publishing conventions concluded by the U.S. Department of the Treasury",
    path: `${KNOWLEDGE}/D-27-D-28-D-29-us-tax-conventions.md`,
    bytes: `${KNOWLEDGE}/sources/D-27-us-nl-tax-convention.pdf`,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
    licence: "US federal government work — public domain. All three PDFs committed in full.",
  },
  "D-31": {
    id: "D-31",
    title: "Netherlands — where a person is resident for tax",
    instrument: "Algemene wet inzake rijksbelastingen, artikel 4 (BWBR0002320), consolidation 2026-04-11",
    publisher: "Ministerie van Financiën, via Overheid.nl / wetten.overheid.nl (KOOP)",
    path: `${KNOWLEDGE}/D-31-nl-awr-art-4-residence.md`,
    bytes: `${KNOWLEDGE}/sources/D-31-nl-awr-art-4-residence.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "CC0 1.0 (Basis Wetten Bestand). Bytes committed.",
  },
  "D-32": {
    id: "D-32",
    title: "Portugal — fiscal residence",
    instrument: "Código do IRS, artigo 16.º, in the tax authority's consolidated presentation",
    publisher: "Autoridade Tributária e Aduaneira, Portal das Finanças",
    path: `${KNOWLEDGE}/D-32-pt-cirs-art-16-residence.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute via the administering authority's consolidation, retrieved 2026-08-19]",
    licence: "Quote and cite, no bytes.",
  },
  "D-33": {
    id: "D-33",
    title: "Canada — deemed residence by sojourn",
    instrument: "Income Tax Act, R.S.C. 1985, c. 1 (5th Supp.), s. 250 — Act current to 2026-06-17",
    publisher: "Department of Justice Canada, Justice Laws Website",
    path: `${KNOWLEDGE}/D-33-ca-ita-s250-deemed-resident.md`,
    bytes: `${KNOWLEDGE}/sources/D-33-ca-ita-s250-deemed-resident.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
    licence: "Reproduction of Federal Law Order, SI/97-5. Bytes committed. NOT the official version.",
  },
  "D-34": {
    id: "D-34",
    title: "Canada — the administrative view of residence",
    instrument: "Income Tax Folio S5-F1-C1, Determining an Individual's Residence Status",
    publisher: "Canada Revenue Agency",
    path: `${KNOWLEDGE}/D-34-ca-cra-folio-s5-f1-c1.md`,
    bytes: null,
    evidence: "[CONFIRMED — administrative guidance, retrieved 2026-08-19] — a folio states the agency's administrative view and does NOT have the force of law.",
    licence: "canada.ca terms of use — cite and extract only, no bytes.",
  },
  "D-35": {
    id: "D-35",
    title: "United States — the substantial presence test",
    instrument: "Substantial Presence Test, IRS International Taxpayers guidance",
    publisher: "Internal Revenue Service",
    path: `${KNOWLEDGE}/D-35-us-substantial-presence-test.md`,
    bytes: `${KNOWLEDGE}/sources/D-35-us-substantial-presence-test.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
    licence: "US federal government work — public domain. Bytes committed.",
  },
});

// ---------------------------------------------------------------------------
// The caveats
// ---------------------------------------------------------------------------
// `weight` is three-valued and never numeric — "disputed", "unsupported",
// "incomplete" — exactly as in UC-04's and UC-05's files.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,section:string,path:string,weight:string,headline:string,detail:string}>>} */
export const CAVEAT_LIBRARY = Object.freeze({
  "C-5": {
    id: "C-5",
    section: "C-5",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Canada's own regulations list some two dozen categories who may work without a permit, and the business-visitor test turns on the payer — not on a visa label.",
    detail:
      "IRPR s. 186 and the s. 187(3) test: remuneration sourced outside Canada and the principal place of business and accrual of profits predominately outside Canada. Both limbs are about who pays and where the business is. Nothing in a UC-07 request asks either question — and note the direction of travel here: a PERMANENT relocation onto a destination employment moves the payer INTO the destination, which is the opposite of the fact pattern s. 187(3) describes.",
  },
  "C-6": {
    id: "C-6",
    section: "C-6",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The EU posting rule carries a 24-month limit and a not-a-replacement condition; this system has a field for neither.",
    detail:
      "Article 12(1) of Regulation 883/2004 turns on the ANTICIPATED duration of the work. A permanent relocation has no anticipated end, which is why the posting exception is unlikely to be the article in play at all — art. 11(3)(a) is. Neither condition is checked anywhere here.",
  },
  "C-8": {
    id: "C-8",
    section: "C-8",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "There is no single detachment maximum: 24 months under the EU rule, 5 years for US agreements, and 60 or 24 months for Canada depending on the pair and the vintage of the agreement.",
    detail:
      "The maximum varies per pair within one network, so \"the detachment limit\" is not a fact about a country. On a permanent move none of them applies in the first place — they are exceptions for temporary assignment — and that is worth stating rather than leaving to be inferred from silence.",
  },
  "C-9": {
    id: "C-9",
    section: "C-9",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "Coverage for a pair is five columns, not a boolean — authority, effective date, certificate form, maximum detachment, and which instrument.",
    detail:
      "US–NL, US–PT, US–CA, CA–NL and CA–PT each have their own authority, effective date, certificate form and maximum, and no two rows agree. \"Portugal has a totalization agreement\" is not a fact about Portugal.",
  },
  "C-12": {
    id: "C-12",
    section: "C-12",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The four demo countries' domestic residence tests are four different shapes, and one of them has no day count at all.",
    detail:
      "The Netherlands assesses residence on the circumstances with no threshold; Portugal has a 183 line anchored on the tax year plus a second, count-free limb; Canada's is 183 days of sojourn in a taxation year, deeming residence retroactively to 1 January; the United States uses a weighted three-year computation. On a relocation this matters at both ends at once — the day someone stops being resident in the source is decided by one shape and the day they start being resident in the destination by another, and the two rules can overlap or leave a gap.",
  },
  "C-15": {
    id: "C-15",
    section: "C-15",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "Portugal's remote-work visa is TWO instruments with conditions, not one country-level route.",
    detail:
      "The ministry publishes a temporary-stay route and a residency route, with different durations and different follow-on obligations, both conditioned on proof of income, a contract or employer declaration, and proof of fiscal residence — with the consular post free to demand more. Which of the two a relocation needs is a real question and this system asks neither.",
  },
  "C-17": {
    id: "C-17",
    section: "C-17",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The article that creates Portugal's D8 contains no income floor, no duration and no insurance requirement.",
    detail:
      "Lei n.º 23/2007 art. 61.º-B is one paragraph granting a residence visa for remote work on demonstration of the employment relationship. The conditions live in the general residence-visa article, in a portaria on means of subsistence, and in what the consular network demands. Citing art. 61.º-B for a salary figure would cite a provision that does not contain one — which is why the income floor below is cited to D-11 and never to D-10.",
  },
  "C-24": {
    id: "C-24",
    section: "C-24",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The administering agency's own published table pairs one Canada–Netherlands agreement's date with a different agreement's detachment limit.",
    detail:
      "There are two Canada–Netherlands social security agreements. The 1987 one, in force 1990-10-01, says twenty-four months; the 2001 one that replaced it, in force 2004-04-01, says sixty. The CRA's table carries the earlier date beside the later number. Both halves are real; the pairing is not, and only reading the instruments caught it.",
  },
  "C-26": {
    id: "C-26",
    section: "C-26",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "A visa label is not where either US authority draws the line — both draw it at the activity and who pays for it.",
    detail:
      "USCIS describes the B-1 as permitting business activities in an expressly non-exhaustive list, and names the actual prohibition as local employment or labor for hire in the United States. State's first listed visa-waiver requirement is that the travel purpose be permitted on a visitor (B) visa, which includes the B-1. None of this establishes that any particular arrangement qualifies — the eligibility limbs are officer judgements — only that a check drawn at the label is asking a different question from the one the authority asks.",
  },
  "C-27": {
    id: "C-27",
    section: "C-27",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "Visa-waiver eligibility turns on a status held under a nationality, on travel to third countries, and on dual nationality — none of which this system can carry, because it carries no nationality at all.",
    detail:
      "Travel to or presence in eight named countries since 2011, or Cuba since 2021, removes eligibility; so does dual nationality of six of them; and British citizens need an unrestricted right of abode for the country-level answer to hold. A visa-waiver stay is also capped at ninety days and a short trip to a neighbouring country does not reset it. See NATIONALITY_NOT_HELD — UC-07 holds none of these inputs.",
  },
});

/** Confirmations. A list that only ever reports faults teaches distrust of everything equally. */
export const CONFIRMATION_LIBRARY = Object.freeze({
  "K-3": {
    id: "K-3",
    section: "K-3",
    path: CONTRADICTIONS,
    headline: "A visitor authorisation does not permit local employment, and the authorities say so themselves.",
    detail:
      "Nothing published by CBP or the Department of State permits productive local employment on a visa waiver, and CBP states the limits of the authorisation itself: an approved ESTA is not a visa, and does not determine whether a traveller is admissible — a CBP officer decides that on arrival.",
  },
  "K-4": {
    id: "K-4",
    section: "K-4",
    path: CONTRADICTIONS,
    headline: "Canada–Portugal's 24-month detachment maximum is confirmed by the agreement itself.",
    detail:
      "The CRA's table says 24 months; art. VII(1) of the agreement says \"for a period of up to 24 months\". Two independent sources, same answer — recorded because its Netherlands neighbour did NOT check out (C-24).",
  },
});

// ---------------------------------------------------------------------------
// The destination's own immigration routes
// ---------------------------------------------------------------------------
// KEYED ON THE DESTINATION, AND ONLY THE DESTINATION. Right to work is a
// question the destination answers; the source country has no say in it. Three
// of the four demo countries are here. The Netherlands is deliberately absent
// and gets an explicit "no source" rather than the nearest European instrument
// — see `uncitedFinding()`.
//
// `state` on each route is two-valued and is a judgement about the DOCUMENT,
// never about the case: "stated_in_source" (the cited text says this, and the
// words are quoted) or "source_silent" (the retrieved text does not address it
// — not permitted, not forbidden, unaddressed).
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, object>>} */
export const IMMIGRATION_ROUTES = Object.freeze({
  PT: Object.freeze({
    country: "PT",
    name: "Portugal",
    note:
      "Portugal publishes TWO remote-work routes, not one, and they are different products with different durations. Both are statutory: the same 2022 law created the residence visa and amended the temporary-stay visa.",
    routes: Object.freeze([
      Object.freeze({
        key: "residence_visa_remote_work",
        label: "Residence visa for professional activity performed remotely (the \"D8\")",
        state: "stated_in_source",
        source: "D-10",
        locator: "Lei n.º 23/2007 art. 61.º-B, as inserted by Lei n.º 18/2022 art. 4.º",
        whatTheSourceSays:
          "The entire article is one paragraph of fifty-two words. It grants the visa to employees and independent professionals for activity performed remotely for a person or company domiciled or seated OUTSIDE national territory, on demonstration of the employment relationship or the services contract. Read what that means for a permanent relocation: the article's own condition is that the work is performed for an entity outside Portugal, which is the opposite of moving onto a Portuguese employment. Whether that makes this route inapplicable is a specialist's reading of the article, not this system's.",
        quote:
          "É concedido a trabalhadores subordinados e profissionais independentes visto de residência para o exercício de atividade profissional prestada, de forma remota, a pessoas singulares ou coletivas com domicílio ou sede fora do território nacional, devendo ser demonstrado o vínculo laboral ou a prestação de serviços, consoante o caso.",
        translationNote:
          "Working translation, a reading aid and not a source: employees and independent professionals are granted a residence visa for professional activity performed remotely for natural or legal persons domiciled or seated outside national territory; the employment relationship or provision of services must be demonstrated.",
        silentOn: Object.freeze([
          "Any income floor. The article contains no figure, no index and no reference to one.",
          "Any maximum duration. The article states none; it is the gateway to a residence permit issued by AIMA, whose own instrument this corpus does not hold.",
          "Any insurance requirement. The article states none.",
        ]),
      }),
      Object.freeze({
        key: "temporary_stay_visa_remote_work",
        label: "Temporary-stay visa for professional activity performed remotely",
        state: "stated_in_source",
        source: "D-10",
        locator: "Lei n.º 23/2007 art. 54.º(1)(i) and (4), as amended by Lei n.º 18/2022",
        whatTheSourceSays:
          "The second route, and the only one of the two on which the statute itself sets a duration: the temporary-stay visa permits entry and stay for a period of LESS THAN ONE YEAR. Paragraph 4 requires the same demonstration of the employment relationship or services contract. A stay under a year is by definition not a permanent relocation, which is worth stating explicitly on a UC-07 dossier so that nobody reads the existence of a remote-work route as the existence of a relocation route.",
        quote:
          "O visto de estada temporária destina-se a permitir a entrada e a estada em território nacional por período inferior a um ano para: […] i) Exercício de atividade profissional subordinada ou independente, prestada, de forma remota, a pessoa singular ou coletiva com domicílio ou sede fora do território nacional;",
        silentOn: Object.freeze([
          "Renewal or conversion into a residence route. The article addresses the visa's own duration and nothing beyond it.",
        ]),
      }),
      Object.freeze({
        key: "consular_income_and_documents",
        label: "What the consular network actually requires",
        state: "stated_in_source",
        source: "D-11",
        locator: "Necessary Documentation — Temporary Stay, and Residency; Type of Visa",
        whatTheSourceSays:
          "The conditions the statute does not contain live here, and they are stated by the ministry rather than by the law: proof of average monthly income for the last three months at a minimum equivalent to FOUR monthly minimum guaranteed remunerations, plus a work contract, promise of contract or employer declaration, plus a document attesting fiscal residence. The residency route additionally allows two entries and is valid four months, during which the holder must apply to AIMA for a residence permit. And the post may demand more at its discretion.",
        quote:
          "Proof of average monthly income for the last three months with a minimum value equivalent to four monthly minimum guaranty remuneration;",
        secondQuote:
          "Residency visas allow two entries and is valid for a period of 4 months. During that time, the holder of a residency visa is required to apply for a residency permit with AIMA",
        secondQuoteLocator: "Type of Visa — what a residency visa actually gets you",
        silentOn: Object.freeze([
          "Which index the minimum is a multiple of, beyond naming the guaranteed monthly minimum remuneration. The figure moves when that figure moves and neither page carries a version or a review date.",
        ]),
      }),
    ]),
    caveats: Object.freeze(["C-15", "C-17"]),
  }),
  CA: Object.freeze({
    country: "CA",
    name: "Canada",
    note:
      "The regulation below is about working WITHOUT a work permit. This corpus holds no source for the work-permit route itself, which is the route a permanent relocation onto a Canadian employment would ordinarily take — so what follows is the boundary of the exemption, not the process for the permit.",
    routes: Object.freeze([
      Object.freeze({
        key: "work_without_permit_business_visitor",
        label: "Working without a work permit — the business-visitor category",
        state: "stated_in_source",
        source: "D-16",
        locator: "IRPR ss. 186(a) and 187(1), (3)",
        whatTheSourceSays:
          "s. 186 lists some two dozen categories of foreign national who may work in Canada without a permit, of which the business visitor is the first. s. 187(3) states the test in two limbs, and both are about MONEY and PLACE rather than about a visa label: the primary source of remuneration must be outside Canada, and the principal place of business and actual place of accrual of profits must remain predominately outside Canada. Note the direction this points for a permanent relocation, where the destination entity becomes the payer.",
        quote:
          "a foreign national seeks to engage in international business activities in Canada without directly entering the Canadian labour market only if (a) the primary source of remuneration for the business activities is outside Canada; and (b) the principal place of business and actual place of accrual of profits remain predominately outside Canada.",
        reproductionNotice:
          "Reproduction of a Government of Canada enactment under the Reproduction of Federal Law Order, SI/97-5. NOT the official version.",
        silentOn: Object.freeze([
          "The work-permit process itself. ss. 186 and 187 describe who is exempt; they say nothing about how a permit is obtained, and this corpus holds no source for that.",
          "Whether any particular arrangement meets the s. 187(3) limbs. The regulation states the test; applying it is a judgement, which is why it is corpus material and not a conditional.",
        ]),
      }),
    ]),
    caveats: Object.freeze(["C-5"]),
  }),
  US: Object.freeze({
    country: "US",
    name: "the United States",
    note:
      "Both routes below are VISITOR routes. Neither is an employment route, and the corpus holds no source for a US work visa of any kind — so a permanent relocation onto a US employment is outside everything cited here.",
    routes: Object.freeze([
      Object.freeze({
        key: "b1_business_visitor",
        label: "B-1 temporary business visitor",
        state: "stated_in_source",
        source: "D-15",
        locator: "USCIS, B-1 Temporary Business Visitor — permitted activities, eligibility, and the prohibition",
        whatTheSourceSays:
          "The list of permitted activities is expressly \"including, but not limited to\", so it cannot be turned into a lookup in either direction — an activity's absence from it proves nothing. What USCIS names as actually prohibited is local employment or labor for hire within the United States, and its own discriminator is WHOSE EMPLOYER: a person otherwise in status who works for another employer in the United States is found to have violated it. Eligibility also requires a residence abroad the person has no intention of abandoning, which is difficult to reconcile with a permanent relocation and is a consular judgement rather than a check.",
        quote:
          "Such activities are not considered, for purposes of the B-1 classification, to be prohibited local \"employment\" or \"labor for hire\" within the United States […] Note, however, that if such persons engage in activities outside their B-1 nonimmigrant status, such as working for another employer in the United States, they will be found to have violated their B-1 nonimmigrant status.",
        secondQuote:
          "You have a residence outside the United States that you have no intention of abandoning, as well as other binding ties that will ensure your return abroad at the end of the visit",
        secondQuoteLocator: "one of the eligibility limbs, each of which is an officer judgement",
        silentOn: Object.freeze([
          "Whether remote work for a foreign employer qualifies as B-1 business activity. Nothing on the page says it does, and the eligibility limbs are judgements a consular or CBP officer makes.",
        ]),
      }),
      Object.freeze({
        key: "visa_waiver_esta",
        label: "Visa Waiver Program / ESTA",
        state: "stated_in_source",
        source: "D-14",
        locator: "Department of State, Visa Waiver Program; CBP, ESTA FAQ",
        whatTheSourceSays:
          "Ninety days or less, for tourism OR business, and State's first listed requirement is that the travel purpose be permitted on a visitor (B) visa — which includes the B-1, so this is not a tourist-only authorisation. CBP is equally explicit about what it is not: an approved ESTA is not a visa and does not determine admissibility. Eligibility turns on designated-country nationality, on travel to eight named countries since 2011 or Cuba since 2021, and on dual nationality of six of them — three inputs this system does not hold.",
        quote:
          "An approved ESTA is not a visa. It does not meet the legal or regulatory requirements to serve in lieu of a U.S. visa when a visa is required under U.S. law.",
        secondQuote:
          "Authorization via ESTA does not determine whether a traveler is admissible to the United States. U.S. Customs and Border Protection officers determine admissibility upon travelers' arrival.",
        secondQuoteLocator: "CBP, on the limits of the authorisation itself",
        silentOn: Object.freeze([
          "Any employment route. The programme is capped at ninety days and permits nothing a visitor (B) visa would not.",
        ]),
      }),
    ]),
    caveats: Object.freeze(["C-26", "C-27"]),
    confirmations: Object.freeze(["K-3"]),
  }),
});

// ---------------------------------------------------------------------------
// Tax residence, at BOTH ends of a relocation
// ---------------------------------------------------------------------------
// WHY THIS IS A ROUTE FINDING AND NOT A COUNTRY ONE. A workation asks one
// question about one country. A permanent relocation asks two at once — when
// does residence in the SOURCE end, and when does residence in the DESTINATION
// begin — and the two countries answer with rules of different shapes that can
// overlap or leave a gap. That is why the entry below carries both ends and
// says which document answers which.
//
// `citedFor` states what each instrument says. The full quoted text of these
// four tests lives in src/uc08/decisionSources.js, where residence IS the
// subject; here they are cited with their locator and their shape, because a
// relocation dossier needs to know that the two ends are shaped differently and
// then send the specialist to read them.
// ---------------------------------------------------------------------------

/** The shape of each demo country's domestic residence test — a description, never a value. */
const RESIDENCE_SHAPE = Object.freeze({
  NL: Object.freeze({
    source: "D-31",
    locator: "AWR art. 4(1)",
    shape: "no_day_count",
    says: "eleven words directing that residence be judged on the circumstances. There is no threshold in Dutch domestic law, so there is no date a count crosses and no headroom to have.",
  }),
  PT: Object.freeze({
    source: "D-32",
    locator: "CIRS art. 16.º(1)(a)–(b), with ¶¶2–3",
    shape: "day_count_anchored_on_the_tax_year_plus_a_count_free_limb",
    says:
      "a 183-day line over any 12-month period beginning or ending in the year concerned, PLUS a second limb that makes residence reachable on fewer days through a dwelling held in conditions suggesting an intent to keep it as a habitual residence — and ¶3 back-dates residence to the first day of the stay, or to 1 January where the person was resident on any day of the previous year. A relocation INTO Portugal therefore starts residence earlier than its own arithmetic suggests.",
  }),
  CA: Object.freeze({
    source: "D-33",
    // The statute is cited AND the agency's administrative view of the factual
    // residence it sits on top of, because on a relocation the question is when
    // residence ENDS — and s. 250 is a deeming rule that does not answer it.
    alsoRead: Object.freeze({
      source: "D-34",
      locator: "CRA Income Tax Folio S5-F1-C1, ¶¶1.8, 1.10 and 1.14",
      says:
        "the CRA's administrative view of the factual residence s. 250 is layered on top of, and the document in this corpus that most invites being turned into a grid. It says in its own words why that would be wrong: residence \"can only be determined on a case by case basis after taking into consideration all of the relevant facts\", and secondary ties \"must be looked at collectively\". A folio does not have the force of law.",
    }),
    locator: "Income Tax Act s. 250(1)(a)",
    shape: "day_count_over_a_taxation_year_deeming_residence_throughout_it",
    says:
      "183 days of sojourn in a taxation year, deeming residence throughout that WHOLE year — retroactive to 1 January, not from the 183rd day. And s. 250 sits on top of common-law factual residence, which the CRA's own folio says can only be determined case by case on all the facts, with secondary ties looked at collectively. A relocation OUT of Canada does not end Canadian residence by departure alone.",
  }),
  US: Object.freeze({
    source: "D-35",
    locator: "the substantial presence test, its exclusions and the closer-connection exception",
    shape: "weighted_three_year_computation",
    says:
      "31 days in the current year AND 183 across three years counted at full, one third and one sixth — with named exclusions and an exception that can defeat the test even once met. It is a residence test for non-citizens and says nothing about a person taxed on citizenship.",
  }),
});

// ---------------------------------------------------------------------------
// Social security on a PERMANENT move
// ---------------------------------------------------------------------------
// THE FINDING IS THE DEFAULT, NOT THE EXCEPTION, and it is the opposite of what
// the word "totalization" leads a reader to expect. Every instrument in this
// corpus that a mobility case usually reaches for — the EU posting article, the
// US detached-worker rule, Canada's assignment articles — is an EXCEPTION for
// TEMPORARY assignment, conditioned on an anticipated duration. A permanent
// relocation has no anticipated end, so what applies is the default: the state
// where the activity is pursued. Saying that out loud is worth more to a
// specialist than another table of maxima, because the maxima are the thing
// they will otherwise go looking for.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, object>>} */
export const SOCIAL_SECURITY_ON_RELOCATION = Object.freeze({
  "NL|PT": Object.freeze({
    pair: Object.freeze(["NL", "PT"]),
    network: "EU coordination — not a bilateral agreement",
    cite: Object.freeze([
      {
        source: "D-17",
        locator: "arts. 11(1) and 11(3)(a), with art. 12(1)",
        citedFor:
          "the default, which is what a permanent move engages: a person is subject to a single Member State's legislation only, and — absent a posting — it is the legislation of the state where the activity is pursued, from day one. Art. 12(1)'s posting exception turns on the ANTICIPATED DURATION of the work not exceeding twenty-four months, so it does not describe a move with no anticipated end.",
        quote:
          "Persons to whom this Regulation applies shall be subject to the legislation of a single Member State only. … a person pursuing an activity as an employed or self-employed person in a Member State shall be subject to the legislation of that Member State",
      },
      {
        source: "D-18",
        locator: "art. 19(2)",
        citedFor:
          "what the certificate legally is, for the case where one is nonetheless sought: an attestation that a named state's legislation applies, and until what date and under what conditions. Neither regulation ever uses the name \"A1\".",
        quote:
          "shall provide an attestation that such legislation is applicable and shall indicate, where appropriate, until what date and under what conditions",
      },
    ]),
    caveats: Object.freeze(["C-6"]),
  }),
  "CA|NL": Object.freeze({
    pair: Object.freeze(["CA", "NL"]),
    network: "Canada's bilateral network",
    cite: Object.freeze([
      {
        source: "D-21",
        locator: "CRA agreement table (Netherlands row) and form CPT63, with CTS 1990/14 and CTS 2004/6",
        citedFor:
          "that the pair is covered, and — the reason this is a citation rather than a table row — that there are TWO Canada–Netherlands agreements whose posting maxima differ, and the agency's own published row mixes one's date with the other's number. The maxima govern ASSIGNMENT, so on a permanent relocation the question is not how long a detachment may run but which system the person joins.",
        quote: "provided that such assignment does not exceed sixty months",
        quoteLocator: "E104279 (CTS 2004/6) art. VI(2) — the agreement currently in force",
      },
    ]),
    caveats: Object.freeze(["C-24", "C-8", "C-9"]),
  }),
  "CA|PT": Object.freeze({
    pair: Object.freeze(["CA", "PT"]),
    network: "Canada's bilateral network",
    cite: Object.freeze([
      {
        source: "D-21",
        locator: "CRA agreement table (Portugal row) and form CPT55, with CTS 1981/15 art. VII",
        citedFor:
          "the one Canada–Portugal agreement in the register, its 24-month assignment period, and the mechanism past it — an extension needs the PRIOR CONSENT of both competent authorities. A ceiling with a named bilateral route past it, not a cliff.",
        quote:
          "the legislation of the first Party shall continue to apply to him in respect of that work relationship for a period of up to 24 months",
        quoteLocator: "E102185 (CTS 1981/15) art. VII(1)",
      },
    ]),
    caveats: Object.freeze(["C-8", "C-9"]),
    confirmations: Object.freeze(["K-4"]),
  }),
  "NL|US": Object.freeze({
    pair: Object.freeze(["NL", "US"]),
    network: "The United States' bilateral network",
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Netherlands row, TIAS 03-501), with the territoriality rule",
        citedFor:
          "that the agreement is in force from 1990-11-01 and carries two further Protocols — so \"an agreement exists\" and \"which text governs\" are different questions — and the rule that decides a permanent move: territoriality puts the worker under the coverage laws of the country they are working in. The detached-worker exception is for temporary transfer.",
        quote:
          "Under this basic \"territoriality\" rule, an employee who would otherwise be covered by both the U.S. and a foreign system remains subject exclusively to the coverage laws of the country in which he or she is working.",
      },
    ]),
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
  "PT|US": Object.freeze({
    pair: Object.freeze(["PT", "US"]),
    network: "The United States' bilateral network",
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Portugal row, TIAS 12121), with the territoriality and detached-worker rules",
        citedFor:
          "that the US–Portugal agreement is in force from 1989-08-01 — a different agreement, network and date from Canada–Portugal's 1981-05-01 — and that the exception that would keep a worker on the sending country's system is expressly for TEMPORARY transfer.",
        quote:
          "Under this \"detached-worker\" exception, a person who is temporarily transferred to work for the same employer in another country remains covered only by the country from which he or she has been sent.",
      },
    ]),
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
  "CA|US": Object.freeze({
    pair: Object.freeze(["CA", "US"]),
    network: "Both networks publish this pair, from their own side",
    cite: Object.freeze([
      {
        source: "D-20",
        locator: "Status of Totalization Agreements (Canada row, TIAS 10863)",
        citedFor: "that the agreement is in force from 1984-08-01, with the US detached-worker exception for temporary transfer.",
      },
      {
        source: "D-21",
        locator: "CRA agreement table (United States row) and form CPT56",
        citedFor:
          "the same pair as the CRA publishes it — effective 1984-08-01, certificate CPT56. Two authorities describing one relationship from opposite ends; where they disagree, the agreement text decides (C-24 is the case where they did).",
      },
    ]),
    caveats: Object.freeze(["C-8", "C-9"]),
  }),
});

/** The bilateral tax convention in force for each demo pair, cited without re-quoting UC-08's article text. */
const TAX_CONVENTION_BY_PAIR = Object.freeze({
  "NL|PT": Object.freeze({ source: "D-24", locator: "art. 15 — employment income; art. 4 — resident" }),
  "CA|NL": Object.freeze({ source: "D-25", locator: "art. 15 — employment income; art. 4 — resident" }),
  "CA|PT": Object.freeze({ source: "D-26", locator: "art. 15 — employment income; art. 4 — resident" }),
  "NL|US": Object.freeze({ source: "D-27", locator: "art. 16 — dependent personal services; art. 4 — resident" }),
  "PT|US": Object.freeze({ source: "D-27", locator: "art. 16 — dependent personal services; art. 4 — resident" }),
  "CA|US": Object.freeze({ source: "D-27", locator: "art. XV — dependent personal services; art. IV — residence" }),
});

// ---------------------------------------------------------------------------
// Finding -> sources
// ---------------------------------------------------------------------------
// Keys are the flag codes `transitionGate.js` actually raises, plus two keys
// for states that are findings of a relocation without being flags:
// `tax_residency_change` and `social_security_on_permanent_move`. Both are
// inherent in the request — a permanent relocation always crosses a tax
// boundary and always moves a social-security membership — so they are cited on
// every dossier with a resolved route, not only when a gate happens to fire.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, axis:"destination"|"route", question:string}>>} */
export const FINDING_SOURCES = Object.freeze({
  UC07_RIGHT_TO_WORK_MISSING: {
    label: "Right to work in the destination is not confirmed",
    axis: "destination",
    question: "What does the destination country publish about who may work there, and on what basis?",
  },
  UC07_IMMIGRATION_REQUIRED: {
    label: "Immigration support is required and has not been confirmed",
    axis: "destination",
    question: "Which routes does the destination publish, what does each actually say, and what is it silent on?",
  },
  UC07_SALARY_BELOW_VISA_MINIMUM: {
    label: "The proposed salary does not meet the destination's stated visa minimum",
    axis: "destination",
    question: "Where does that minimum come from, and does the instrument that creates the visa contain it at all?",
  },
  tax_residency_change: {
    label: "Tax residence at both ends of the move",
    axis: "route",
    question: "When does residence in the source end, when does residence in the destination begin, and are the two rules even the same shape?",
  },
  UC07_TAX_RESIDENCY_REVIEW_REQUIRED: {
    label: "Tax-residency nexus between source and destination must be reviewed",
    axis: "route",
    question: "Same question as above, raised as a flag: which instruments decide it, and what does this system not hold?",
  },
  social_security_on_permanent_move: {
    label: "Which state's social-security legislation applies after the move",
    axis: "route",
    question: "Is this pair coordinated or covered by agreement — and does anything in those instruments apply to a move with no end date?",
  },
});

// ---------------------------------------------------------------------------
// The findings with NO source, said out loud
// ---------------------------------------------------------------------------
// MOST OF UC-07'S FLAGS BELONG HERE, and that is the honest shape of this use
// case rather than a gap in the corpus. Minimum onboarding time, duplicate
// management fees, entity status, the offboarding sequence, PTO portability and
// seniority continuity are Remote's own product and commercial rules, or
// properties of the request. No jurisdiction publishes anything about any of
// them, and a citation beside one would be borrowed authority.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, why:string}>>} */
export const UNCITED_FINDINGS = Object.freeze({
  UC07_PE_RISK_REVIEW_REQUIRED: {
    label: "Potential permanent-establishment exposure for the client",
    why:
      // THE SUBSTANCE, NOT THE PATH (docs/UI-AUDIENCES.md). This sentence is
      // read by a Mobility Legal specialist and it used to end by naming two
      // files in this checkout — a directory and a Markdown filename — neither
      // of which they can open and neither of which is the point. What they
      // need is WHICH register, published by WHOM, and that it holds article
      // numbers rather than the articles themselves. That is now said outright;
      // the file it lives in is docs/knowledge/layer-1-statutory/
      // L1-01-L1-11-oecd-citation-register.md, named in this comment for the
      // reader who can actually open it.
      "No source, and the reason is a LICENCE rather than an oversight. The material that governs this is the OECD's Model Tax Convention art. 5 and its Commentary, together with BEPS Action 7 — an OECD copyright publication that this project's reference library may paraphrase with a precise citation and that is never copied, and which this project has NOT read. What this system holds instead is a register of the relevant article NUMBERS, and that register's own evidence tag records that the documents behind them were not retrieved. So the flag that a Mobility Legal specialist is most likely to escalate onward is the least sourced finding this dossier produces, and that is worth knowing before weighing it.",
  },
  UC07_MOT_VIOLATION: {
    label: "The proposed start date does not clear the country's minimum onboarding time",
    why:
      "No statutory source and none is expected. Minimum onboarding time is Remote's own operational lead time for creating an employment in a country — a property of the platform, not of the jurisdiction. Nothing here says the destination's law requires any notice period before a start date.",
  },
  UC07_DUPLICATE_FEE_RISK: {
    label: "Overlapping or misaligned dates risk a duplicate EOR management fee",
    why: "Nothing to cite — a commercial term of Remote's own service, not a rule any authority publishes.",
  },
  UC07_DESTINATION_COUNTRY_UNSUPPORTED: {
    label: "The destination country is not supported for employment",
    why:
      "No external source exists for this and none could: it is a statement about the coverage of Remote's own country list, not about the destination. It means nobody can employ there through this platform — not that the country is closed.",
  },
  UC07_DESTINATION_ENTITY_INACTIVE: {
    label: "The target legal entity in the destination is not active",
    why: "Nothing to cite — a fact about a record in Remote, not a rule any authority publishes.",
  },
  UC07_EMPLOYMENT_GAP: {
    label: "The proposed timeline leaves an unauthorised employment gap",
    why:
      "Nothing to cite as a general rule — the consequences of a gap are jurisdiction-specific (continuity of service, social-security coverage, immigration status) and this corpus holds no instrument that addresses a gap between two employments as such. The gap itself is arithmetic on the supplied dates.",
  },
  UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED: {
    label: "Source offboarding is planned before the destination is confirmed ready",
    why:
      "Nothing to cite — this is a sequencing rule this system applies to protect the employee, derived from this system's own specification for relocation reviews and not from any authority. It is the strongest thing in the dossier and it rests on no external source, which a specialist should know.",
  },
  UC07_PTO_TRANSFER_NOT_ALLOWED: {
    label: "Accrued PTO cannot be transferred and will be liquidated",
    why:
      // Same rewrite, same reason: "docs/knowledge/" and a backticked field
      // name were this repository's vocabulary standing in for two facts the
      // specialist does need — WHAT the library holds and does not, and WHERE
      // the liquidation decision came from. Both are now stated in words. The
      // input behind it is `transferAllowed` on the relocation plan.
      "No source in this corpus. Whether a balance transfers between entities is a question of source and destination local law, and this system's statutory library holds notice and residence statutes for these countries but nothing at all on leave portability. The liquidation decision here rests on the request's own statement that the balance cannot be carried over — not on a read of any law.",
  },
  UC07_SENIORITY_REVIEW_REQUIRED: {
    label: "Seniority continuity needs legal confirmation in the destination",
    why:
      "No source in this corpus. Continuity of service across a change of employing entity is jurisdiction-specific and is exactly the question a Mobility Legal specialist is being escalated to answer. Nothing here answers it, and the flag is a request for that answer rather than a finding about it.",
  },
  UC07_MISSING_TIMELINE: {
    label: "Essential relocation dates are missing from the request",
    why:
      "Nothing to cite — a property of the request, not of any jurisdiction. Worth stating anyway: every date-based check in this dossier (minimum onboarding time, the coverage gap, month-end alignment) is UNEVALUATED rather than passed, and an unevaluated check has approved of nothing.",
  },
  UC07_PTO_CASHOUT_NOT_COMPUTABLE: {
    label: "The liquidated PTO payout could not be derived",
    why:
      "Nothing to cite — an input-quality problem with the figures supplied, not a question any authority answers. Treat it as missing, never as a settlement of zero: the cost estimate carries no settlement line at any value, which is deliberate and is not the same as a settlement costing nothing.",
  },
  UC07_COUNTRIES_NOT_DETERMINED: {
    label: "The source and/or destination country could not be determined",
    why:
      "Nothing to cite — a statement about how this system read the request. Note what it costs: every route-axis citation in this file is unreachable without a route, so an undetermined route is also an unsourced dossier.",
  },
  nationality_not_held: {
    label: "Which immigration route this employee actually needs",
    why:
      "No source can answer this, because the missing input is not a document. A relocation request in this system carries no nationality, citizenship or passport, so the destination's published routes can be shown and this person's route cannot be identified. The dossier states that limit in full, in its own words, beside every immigration citation it carries.",
  },
});

/** The destinations this file holds an immigration source for. */
export const SOURCED_DESTINATIONS = Object.freeze(["CA", "PT", "US"]);

/** The routes this file holds tax and social-security instruments for, as canonical keys. */
export const SOURCED_ROUTES = Object.freeze(["CA|NL", "CA|PT", "CA|US", "NL|PT", "NL|US", "PT|US"]);

// ---------------------------------------------------------------------------
// Lookups. Two of them, pure, neither able to return a nearest match.
// ---------------------------------------------------------------------------

function normalise(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/**
 * The canonical key for a route: both codes, uppercased, sorted. Direction of
 * travel does not change which treaty or agreement is in force between two
 * states — but it very much changes what the instruments MEAN for this case,
 * which is why the returned block always names source and destination
 * separately as well.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string|null}
 */
export function routeKey(a, b) {
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
    path: doc.path,
    bytes: doc.bytes,
    evidence: doc.evidence,
    licence: doc.licence,
  };
}

/**
 * `matchedOn` — the honesty field, copied from mobilityRetriever.js's own. It
 * names the MECHANISM (a person wrote this down, against this finding, for this
 * destination or route) and carries no score, rank or confidence.
 */
function matchedOn(findingKey, scope) {
  return `hand-curated map entry for the finding "${findingKey}" in ${scope}`;
}

function caveatsFor(ids) {
  return (ids ?? []).map((id) => CAVEAT_LIBRARY[id]);
}

function confirmationsFor(ids) {
  return (ids ?? []).map((id) => CONFIRMATION_LIBRARY[id]);
}

function residenceCitations(code, role, findingKey, scope) {
  const shape = RESIDENCE_SHAPE[code];
  const when = role === "source" ? "when residence in the SOURCE country ends" : "when residence in the DESTINATION country begins";
  const base = {
    ...expandDocument(shape.source),
    locator: shape.locator,
    citedFor: `${when} — ${shape.says}`,
    residenceShape: shape.shape,
    quote: null,
    quotedInFull: "src/uc08/decisionSources.js RESIDENCE_TESTS — the full text of all four tests, where residence is the subject",
    matchedOn: matchedOn(findingKey, scope),
  };
  if (!shape.alsoRead) return [base];
  return [
    base,
    {
      ...expandDocument(shape.alsoRead.source),
      locator: shape.alsoRead.locator,
      citedFor: `${when}, and what the statute above does NOT answer — ${shape.alsoRead.says}`,
      residenceShape: shape.shape,
      quote: null,
      quotedInFull: "src/uc08/decisionSources.js RESIDENCE_TESTS.CA.alsoRead",
      matchedOn: matchedOn(findingKey, scope),
    },
  ];
}

/**
 * The reading list for one finding, for one destination or one route.
 *
 * Returns null — never an empty shell and never a nearest match — when the
 * finding has no entry, when the scope is missing, or when this corpus holds
 * nothing for that destination or route.
 *
 * @param {string} findingKey  a UC07_* flag code, or one of the two derived keys
 * @param {object} [scope]
 * @param {string|null} [scope.sourceCountry]
 * @param {string|null} [scope.destinationCountry]
 */
export function sourcesForFinding(findingKey, { sourceCountry = null, destinationCountry = null } = {}) {
  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;

  if (entry.axis === "destination") {
    const destination = normalise(destinationCountry);
    if (!destination || !Object.hasOwn(IMMIGRATION_ROUTES, destination)) return null;
    const country = IMMIGRATION_ROUTES[destination];

    // The salary finding cites ONE route — the consular one — and never the
    // statute, because the statute does not contain a figure (C-17). Citing
    // art. 61.º-B for an income floor would cite a provision that has none, and
    // that is the exact failure this file's rule 5 names.
    const routes =
      findingKey === "UC07_SALARY_BELOW_VISA_MINIMUM"
        ? country.routes.filter((r) => r.key === "consular_income_and_documents")
        : country.routes;
    if (routes.length === 0) return null;

    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "destination",
      scope: destination,
      framing: SOURCE_FRAMING,
      method: RETRIEVAL_METHOD,
      nationality: NATIONALITY_NOT_HELD,
      note: country.note,
      routes,
      citations: routes.map((route) => ({
        ...expandDocument(route.source),
        locator: route.locator,
        citedFor: route.whatTheSourceSays,
        quote: route.quote ?? null,
        secondQuote: route.secondQuote ?? null,
        secondQuoteLocator: route.secondQuoteLocator ?? null,
        translationNote: route.translationNote ?? null,
        reproductionNotice: route.reproductionNotice ?? null,
        silentOn: route.silentOn ?? [],
        matchedOn: matchedOn(findingKey, destination),
      })),
      caveats: caveatsFor(country.caveats),
      confirmations: confirmationsFor(country.confirmations),
    };
  }

  // Route axis.
  const source = normalise(sourceCountry);
  const destination = normalise(destinationCountry);
  const key = routeKey(source, destination);
  if (!key) return null;

  if (findingKey === "tax_residency_change" || findingKey === "UC07_TAX_RESIDENCY_REVIEW_REQUIRED") {
    if (!RESIDENCE_SHAPE[source] || !RESIDENCE_SHAPE[destination]) return null;
    const convention = TAX_CONVENTION_BY_PAIR[key];
    const citations = [
      ...residenceCitations(source, "source", findingKey, key),
      ...residenceCitations(destination, "destination", findingKey, key),
    ];
    if (convention) {
      citations.push({
        ...expandDocument(convention.source),
        locator: convention.locator,
        citedFor:
          "the bilateral convention in force for this pair. Its employment-income article addresses SHORT stays — its relief depends on presence below a day limit and on an employer not resident in the other State, neither of which describes a permanent move onto a destination employment — so the article that matters on a relocation is the residence article, and NOBODY IN THIS CHAIN HAS READ IT. The sidecar quotes only the employment-income article. Cited so the specialist knows the instrument exists and where it is, never as a statement of what its residence article says.",
        quote: null,
        readHere: false,
        matchedOn: matchedOn(findingKey, key),
      });
    }
    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "route",
      scope: key,
      sourceCountry: source,
      destinationCountry: destination,
      framing: SOURCE_FRAMING,
      method: RETRIEVAL_METHOD,
      bothEnds: Object.freeze({
        source: RESIDENCE_SHAPE[source],
        destination: RESIDENCE_SHAPE[destination],
        statement:
          `The source and destination tests are ${RESIDENCE_SHAPE[source].shape === RESIDENCE_SHAPE[destination].shape ? "the same shape" : "DIFFERENT shapes"}, so the day residence ends at one end and the day it begins at the other are decided by different kinds of rule. They can overlap — leaving the person resident in both — or leave a gap. Nothing in this system computes either date.`,
      }),
      citations,
      caveats: caveatsFor(["C-12"]),
      confirmations: [],
    };
  }

  if (findingKey === "social_security_on_permanent_move") {
    const coverage = Object.hasOwn(SOCIAL_SECURITY_ON_RELOCATION, key) ? SOCIAL_SECURITY_ON_RELOCATION[key] : null;
    if (!coverage) return null;
    return {
      finding: findingKey,
      label: entry.label,
      question: entry.question,
      axis: "route",
      scope: key,
      sourceCountry: source,
      destinationCountry: destination,
      framing: SOURCE_FRAMING,
      method: RETRIEVAL_METHOD,
      network: coverage.network,
      // THE SENTENCE THIS WHOLE BLOCK EXISTS FOR.
      statement:
        "Every instrument cited here that carries a maximum — the EU's twenty-four months, the US five years, Canada's twenty-four or sixty — is an EXCEPTION for a TEMPORARY assignment, conditioned on an anticipated duration or an assignment that ends. A permanent relocation has no anticipated end, so the maxima are not the question and the default is: the state where the work is actually pursued. That is stated here because a reader who goes looking for a detachment limit will find one and it will be the wrong answer.",
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
 * Why a finding carries no citation. The same contract in reverse, answering
 * for all three kinds of absence — a finding about Remote's own product or the
 * request, a finding whose material may not be copied, and a finding about a
 * destination or route this corpus does not hold.
 *
 * Null when the key is not one this file knows at all, so a caller can tell
 * "we looked and there is nothing" from "this key is unknown here".
 *
 * @param {string} findingKey
 * @param {object} [scope]
 * @param {string|null} [scope.sourceCountry]
 * @param {string|null} [scope.destinationCountry]
 */
export function uncitedFinding(findingKey, { sourceCountry = null, destinationCountry = null } = {}) {
  const flat = Object.hasOwn(UNCITED_FINDINGS, findingKey) ? UNCITED_FINDINGS[findingKey] : null;
  if (flat) return { finding: findingKey, label: flat.label, why: flat.why, scope: null };

  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;

  if (entry.axis === "destination") {
    const destination = normalise(destinationCountry);
    if (destination && Object.hasOwn(IMMIGRATION_ROUTES, destination)) return null; // cited
    return {
      finding: findingKey,
      label: entry.label,
      scope: destination || null,
      why:
        `No source. This system's statutory library holds an immigration instrument for ${SOURCED_DESTINATIONS.join(", ")} only` +
        (destination ? `, and ${destination} is not among them` : ", and no destination was resolved to look one up for") +
        ". That is not a finding that the destination has no requirements — it is a statement that this system has never looked, so nothing here can be read as a clearance. Another country's visa route is not a substitute for a missing one.",
    };
  }

  const source = normalise(sourceCountry);
  const destination = normalise(destinationCountry);
  const key = routeKey(source, destination);
  const held =
    key &&
    (((findingKey === "tax_residency_change" || findingKey === "UC07_TAX_RESIDENCY_REVIEW_REQUIRED") &&
      Boolean(RESIDENCE_SHAPE[source]) &&
      Boolean(RESIDENCE_SHAPE[destination])) ||
      (findingKey === "social_security_on_permanent_move" && Object.hasOwn(SOCIAL_SECURITY_ON_RELOCATION, key)));
  if (held) return null;

  return {
    finding: findingKey,
    label: entry.label,
    scope: key,
    why:
      `No source. This system's statutory library holds tax-residence and social-security instruments for these routes only: ${SOURCED_ROUTES.map((r) => r.replace("|", "–")).join(", ")}` +
      (key ? `, and ${key.replace("|", "–")} is not among them` : ", and no route was resolved to look one up for") +
      ". A neighbouring route's instruments are not a substitute: the maxima differ per pair and per vintage of the agreement, and the residence tests are different shapes, so the closest match would be wrong in a way nothing downstream could detect.",
  };
}
