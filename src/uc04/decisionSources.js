// ---------------------------------------------------------------------------
// decisionSources.js  —  Where the rule behind each finding can be read
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `decisionFacts.js` put the four dimensions back in front of the mobility
// specialist. It answers "what did the system find, and from which figures".
// It cannot answer the next question a person asks, which is "says who?" — and
// until 2026-08-19 nothing in this repository could, because it held no
// sources. It holds 35 of them now (`docs/knowledge/`), and none of them
// reached the screen where somebody clicks approve. A specialist deciding a
// German employee's fortnight in Spain saw the flag `a1_certificate_recommended`
// and no instrument, no article, and no way to read either.
//
// THIS FILE IS A HAND-CURATED MAP, AND THAT IS THE DESIGN, NOT A SHORTCUT.
// Finding key -> the documents that were read when the check was written up.
// There is no retrieval engine here, no embedding, no ranking, no score. Over
// 35 documents a similarity search would claim infrastructure this repository
// does not have and would produce a nearest match for findings that have no
// source at all — which is the precise failure `src/uc08/treatyRetriever.js`'s
// own history warns about, and the reason its `matchedOn` field exists. The
// discipline is copied from it verbatim:
//
//   EVERY CITATION SAYS EXACTLY WHY IT IS HERE, AND NOTHING IN THAT STATEMENT
//   MAY READ AS MORE PRECISE THAN IT IS. `matchedOn` names the map entry, so a
//   reader knows a person put it there. It never carries a similarity figure,
//   a confidence, or a rank, because none was computed.
//
// THREE RULES THAT ARE NOT NEGOTIABLE.
//
//   1. NEVER INVENT A CITATION. Every `path` below points at a file vendored
//      under `docs/knowledge/`, and `test/uc04DecisionSources.test.js` asserts
//      each one exists on disk and still carries its catalogue id. A renamed
//      document must break a test, not become a dead link on a decision screen.
//      Nothing is cited from memory: no OECD material appears here at all,
//      because it is paraphrase-only by licence and the register that names its
//      articles (`L1-01-L1-11-oecd-citation-register.md`) says in its own
//      evidence tag that the documents were NOT read in that pass.
//
//   2. NEVER PRESENT A CITATION AS ADVICE. A source is a thing a specialist
//      reads. This module never says "the regulation permits this trip"; it
//      says "this is the rule the check was written from, and here is where to
//      read it." `SOURCE_FRAMING` is rendered beside the block for the same
//      reason `disclaimer.js` exists.
//
//   3. WHERE A CHECK RESTS ON A RULE THE SOURCE CONTRADICTS, SAY SO ON THE
//      SCREEN WHERE THE DECISION HAPPENS. `docs/knowledge/layer-1-statutory/
//      CONTRADICTIONS.md` records 27 of these. Three of them sit directly under
//      findings UC-04 prints today: the Schengen window is computed once per
//      trip where the regulation computes it per day of stay (C-1); the DNV
//      suppression rests on conditions the article creating the scheme does not
//      contain (C-17); and the US work-permit block is drawn at the visa label
//      where both authorities draw it at activity and payer (C-26). A caveat is
//      not a reason to ignore a finding and is not evidence for the opposite
//      conclusion — it is what a specialist needs in order to know how much
//      weight the finding carries.
//
// IT DECIDES NOTHING, AND STRUCTURALLY CANNOT. Pure data plus two lookups. No
// client of any kind, no clock, no I/O, and — per `docs/knowledge/README.md`'s
// own structural rule — **no citation id ever appears in a conditional**
// anywhere in this repository. Citations enter a description, get rendered to a
// human, and go nowhere else. `test/uc04DecisionSources.test.js` asserts that
// no policy engine imports this file.
// ---------------------------------------------------------------------------

const KNOWLEDGE = "docs/knowledge/layer-1-statutory";
const CONTRADICTIONS = `${KNOWLEDGE}/CONTRADICTIONS.md`;

/** Rendered once above the citation block. Not decoration — see rule 2. */
export const SOURCE_FRAMING =
  "These are the sources the checks above were written from, linked so you can read them. " +
  "Nothing here is a recommendation and no gate consults any of it: a citation says which rule a check is based on and where the text is, never what to decide about this request.";

/** Rendered once above the caveats, for the same reason. */
export const CAVEAT_FRAMING =
  "Where a check applies a rule one of these documents disputes, the dispute is printed with the finding. " +
  "A contradicted finding is not evidence for the opposite conclusion — it is a finding whose basis you now know the limits of.";

/** How the citations got here. Stated because the alternative is assumed. */
export const RETRIEVAL_METHOD =
  "Hand-curated: each document below is listed against this finding in src/uc04/decisionSources.js, by someone who read it. There is no search, no ranking and no similarity score, so no figure of confidence is quoted. A finding with no entry gets no citation rather than a nearest match.";

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------
// One entry per vendored file (or per closely-bound group, matching how
// `docs/knowledge/` groups them). `path` is repo-relative because these are
// FILES, not URLs — several of them are cite-and-link-only at the publisher and
// exist here as a sidecar with the provenance header, not as bytes. `bytes` is
// the retrieved original where the licence permitted keeping one, and null
// where it did not; the difference is worth showing, because "we hold the
// authority's own bytes" and "we hold our own note about them" are different
// strengths of evidence.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,title:string,instrument:string,publisher:string,path:string,bytes:string|null,evidence:string}>>} */
export const SOURCE_LIBRARY = Object.freeze({
  "D-07": {
    id: "D-07",
    title: "Schengen Borders Code — entry conditions and the 90/180 rule",
    instrument: "Regulation (EU) 2016/399, consolidated text 02016R0399 — 12.10.2025",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-07-eu-schengen-borders-code-2016-399.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-08": {
    id: "D-08",
    title: "Bulgaria and Romania — the two Council decisions that date the Schengen set",
    instrument: "Council Decisions (EU) 2024/210 and (EU) 2024/3212",
    publisher: "Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-08-eu-schengen-bg-ro-accession.md`,
    bytes: `${KNOWLEDGE}/sources/D-08-eu-schengen-bg-ro-decision-2024-210.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-09": {
    id: "D-09",
    title: "Visa requirement and exemption — Annexes I and II",
    instrument: "Regulation (EU) 2018/1806, consolidated text 02018R1806 — 30.12.2025",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-09-eu-visa-annexes-2018-1806.md`,
    bytes: `${KNOWLEDGE}/sources/D-09-eu-visa-annexes-2018-1806.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-10": {
    id: "D-10",
    title: "Portugal — the article creating the remote-work residence visa (the \"D8\")",
    instrument: "Lei n.º 23/2007 art. 61.º-B, as inserted by Lei n.º 18/2022 (Diário da República)",
    publisher: "Assembleia da República, via Diário da República Eletrónico",
    path: `${KNOWLEDGE}/D-10-pt-d8-lei-23-2007-art-61b.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute as enacted, retrieved 2026-08-19]",
  },
  "D-11": {
    id: "D-11",
    title: "Portugal — the D8's actual conditions, as the consular network states them",
    instrument: "Visa portal of the Ministério dos Negócios Estrangeiros (five pages)",
    publisher: "Ministério dos Negócios Estrangeiros, consular network",
    path: `${KNOWLEDGE}/D-11-pt-d8-consular-requirements.md`,
    bytes: null,
    evidence: "[CONFIRMED — consular authority publication, retrieved 2026-08-19]",
  },
  "D-14": {
    id: "D-14",
    title: "United States — Visa Waiver Program and ESTA",
    instrument: "Department of State, Visa Waiver Program · CBP, VWP/ESTA FAQ",
    publisher: "U.S. Department of State, Bureau of Consular Affairs · U.S. Customs and Border Protection",
    path: `${KNOWLEDGE}/D-14-us-vwp-esta.md`,
    bytes: `${KNOWLEDGE}/sources/D-14-us-state-visa-waiver-program.txt`,
    evidence: "[CONFIRMED — agency publication, transcribed from a browser 2026-08-19]",
  },
  "D-15": {
    id: "D-15",
    title: "United States — B-1 temporary business visitor",
    instrument: "USCIS, B-1 Temporary Business Visitor",
    publisher: "U.S. Citizenship and Immigration Services",
    path: `${KNOWLEDGE}/D-15-us-b1-business-visitor.md`,
    bytes: `${KNOWLEDGE}/sources/D-15-us-uscis-b1-business-visitor.txt`,
    evidence: "[CONFIRMED — agency publication, transcribed from a browser 2026-08-19]",
  },
  "D-16": {
    id: "D-16",
    title: "Canada — working without a work permit",
    instrument: "Immigration and Refugee Protection Regulations, SOR/2002-227, ss. 186 and 187",
    publisher: "Department of Justice Canada, Justice Laws Website",
    path: `${KNOWLEDGE}/D-16-ca-work-without-permit-irpr-186.md`,
    bytes: `${KNOWLEDGE}/sources/D-16-ca-irpr-s186.html`,
    evidence: "[CONFIRMED — regulation, retrieved 2026-08-19]",
  },
  "D-17": {
    id: "D-17",
    title: "Which state's social security applies to a person working in another",
    instrument: "Regulation (EC) No 883/2004, consolidated text 02004R0883 — 31.07.2019",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-17-eu-reg-883-2004.md`,
    bytes: `${KNOWLEDGE}/sources/D-17-eu-reg-883-2004.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-18": {
    id: "D-18",
    title: "How the certificate people call an \"A1\" is actually obtained",
    instrument: "Regulation (EC) No 987/2009, consolidated text 02009R0987 — 01.01.2018",
    publisher: "European Parliament and Council of the European Union (EUR-Lex)",
    path: `${KNOWLEDGE}/D-18-eu-reg-987-2009.md`,
    bytes: `${KNOWLEDGE}/sources/D-18-eu-reg-987-2009.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-19": {
    id: "D-19",
    title: "Practical Guide on the applicable legislation in the EU, the EEA and Switzerland",
    instrument: "Administrative Commission for the Coordination of Social Security Systems, December 2013",
    publisher: "European Commission, DG Employment, Social Affairs and Inclusion",
    path: `${KNOWLEDGE}/D-19-eu-practical-guide-applicable-legislation.md`,
    bytes: `${KNOWLEDGE}/sources/D-19-eu-practical-guide-applicable-legislation.pdf`,
    evidence: "[CONFIRMED — agreed administrative guidance, retrieved 2026-08-19] — guidance, NOT statute",
  },
  "D-20": {
    id: "D-20",
    title: "Status of US totalization agreements, and the detached-worker rule",
    instrument: "SSA, Office of International Programs — Status of Totalization Agreements",
    publisher: "U.S. Social Security Administration",
    path: `${KNOWLEDGE}/D-20-us-ssa-totalization-status.md`,
    bytes: `${KNOWLEDGE}/sources/D-20-us-ssa-totalization-status.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
  },
  "D-21": {
    id: "D-21",
    title: "Canada's social security agreement network, and the Netherlands and Portugal cells",
    instrument: "CRA agreement table, plus the CTS agreement texts and forms CPT63 / CPT55",
    publisher: "Canada Revenue Agency (CPP/EI Rulings), with Global Affairs Canada's treaty register",
    path: `${KNOWLEDGE}/D-21-D-22-D-23-ca-social-security-agreements.md`,
    bytes: null,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
  },
  "D-24": {
    id: "D-24",
    title: "Netherlands–Portugal tax convention",
    instrument: "Convention art. 15(2) — the employment-income article",
    publisher: "The contracting states' own published text",
    path: `${KNOWLEDGE}/D-24-nl-pt-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
  },
  "D-25": {
    id: "D-25",
    title: "Canada–Netherlands tax convention",
    instrument: "Convention art. 15(2) — the employment-income article",
    publisher: "Department of Finance Canada / Global Affairs Canada treaty register",
    path: `${KNOWLEDGE}/D-25-ca-nl-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
  },
  "D-26": {
    id: "D-26",
    title: "Canada–Portugal tax convention",
    instrument: "Convention art. 15(2) — the employment-income article",
    publisher: "Department of Finance Canada / Global Affairs Canada treaty register",
    path: `${KNOWLEDGE}/D-26-ca-pt-tax-convention.md`,
    bytes: null,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
  },
  "D-27": {
    id: "D-27",
    title: "The three United States tax conventions (Netherlands, Portugal, Canada)",
    instrument: "Conventions arts 16(2) / XV(2) — the employment-income articles",
    publisher: "U.S. Department of the Treasury",
    path: `${KNOWLEDGE}/D-27-D-28-D-29-us-tax-conventions.md`,
    bytes: `${KNOWLEDGE}/sources/D-27-us-nl-tax-convention.pdf`,
    evidence: "[CONFIRMED — treaty text, retrieved 2026-08-19]",
  },
  "D-31": {
    id: "D-31",
    title: "Netherlands — where a person is resident for tax",
    instrument: "Algemene wet inzake rijksbelastingen, artikel 4",
    publisher: "Overheid.nl / wetten.overheid.nl",
    path: `${KNOWLEDGE}/D-31-nl-awr-art-4-residence.md`,
    bytes: `${KNOWLEDGE}/sources/D-31-nl-awr-art-4-residence.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-32": {
    id: "D-32",
    title: "Portugal — fiscal residence",
    instrument: "Código do IRS, artigo 16.º",
    publisher: "Autoridade Tributária e Aduaneira, Portal das Finanças",
    path: `${KNOWLEDGE}/D-32-pt-cirs-art-16-residence.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute via the administering authority's consolidation, retrieved 2026-08-19]",
  },
  "D-33": {
    id: "D-33",
    title: "Canada — deemed residence by sojourn",
    instrument: "Income Tax Act, R.S.C. 1985, c. 1 (5th Supp.), s. 250",
    publisher: "Department of Justice Canada, Justice Laws Website",
    path: `${KNOWLEDGE}/D-33-ca-ita-s250-deemed-resident.md`,
    bytes: `${KNOWLEDGE}/sources/D-33-ca-ita-s250-deemed-resident.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-34": {
    id: "D-34",
    title: "Canada — the administrative view of residence",
    instrument: "Income Tax Folio S5-F1-C1, Determining an Individual's Residence Status",
    publisher: "Canada Revenue Agency",
    path: `${KNOWLEDGE}/D-34-ca-cra-folio-s5-f1-c1.md`,
    bytes: null,
    evidence: "[CONFIRMED — administrative guidance, retrieved 2026-08-19]",
  },
  "D-35": {
    id: "D-35",
    title: "United States — the substantial presence test",
    instrument: "IRS International Taxpayers guidance",
    publisher: "Internal Revenue Service",
    path: `${KNOWLEDGE}/D-35-us-substantial-presence-test.md`,
    bytes: `${KNOWLEDGE}/sources/D-35-us-substantial-presence-test.html`,
    evidence: "[CONFIRMED — agency publication, retrieved 2026-08-19]",
  },
  "D-36": {
    id: "D-36",
    title: "Three sanctions regimes, one register, and deliberately no vendored list",
    instrument: "OFAC country programmes · EU Sanctions Map regime register · Canada's autonomous list",
    publisher: "U.S. Treasury (OFAC) · Council of the EU / European Commission · Global Affairs Canada",
    path: `${KNOWLEDGE}/D-36-D-37-D-38-sanctions-register.md`,
    bytes: null,
    evidence: "[CONFIRMED — regime register, retrieved 2026-08-19] — a register of regimes, not a list of countries",
  },
  "D-39": {
    id: "D-39",
    title: "UN Security Council Consolidated List — the register entry, and no list bytes",
    instrument: "United Nations Security Council Consolidated List",
    publisher: "United Nations Security Council, Security Council Affairs Division",
    path: `${KNOWLEDGE}/D-39-un-consolidated-list.md`,
    bytes: null,
    evidence: "[CONFIRMED — register description, retrieved 2026-08-19]",
  },
});

// ---------------------------------------------------------------------------
// The caveats
// ---------------------------------------------------------------------------
// Each one is a section of CONTRADICTIONS.md, quoted down to the sentence a
// specialist needs and no further. `section` is the heading id, so a renumbered
// or deleted contradiction breaks a test instead of leaving a caveat citing a
// section that no longer exists.
//
// `weight` is deliberately three-valued and never numeric:
//   "disputed"    — a source contradicts the rule as this code applies it.
//   "unsupported" — the code asks a source for something it does not contain.
//   "incomplete"  — the rule is right as far as it goes and the check cannot
//                   see a condition the source attaches to it.
// A percentage or a severity score here would be exactly the invented precision
// `treatyRetriever.js` refuses to print for a similarity.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,section:string,path:string,weight:string,headline:string,detail:string}>>} */
export const CAVEAT_LIBRARY = Object.freeze({
  "C-1": {
    id: "C-1",
    section: "C-1",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The 180-day window here is computed once per trip; the regulation computes it per day of stay.",
    detail:
      "Article 6(1) says the 90 days are counted \"in any 180-day period, which entails considering the 180-day period preceding each day of stay\". This system anchors one trailing window on the trip's start date. The difference is not conservative in a fixed direction — it can refuse a compliant stay and clear a non-compliant one — and it is largest for exactly the multi-week trips this use case exists for.",
  },
  "C-2": {
    id: "C-2",
    section: "C-2",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "Entry and exit days both count, and time spent under a residence permit or long-stay visa does not count at all.",
    detail:
      "Article 6(2). The day count here measures date ranges and carries no representation of a permit-covered stay, so a traveller holding one may be counted against an allowance the regulation excludes them from.",
  },
  "C-3": {
    id: "C-3",
    section: "C-3",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The 90 days are a single pool across the states operating the Entry/Exit System, and separate for those that do not.",
    detail:
      "Article 6(1a). The count here is taken per destination country, which is the non-EES behaviour. Nothing in the record says which was intended.",
  },
  "C-4": {
    id: "C-4",
    section: "C-4",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "Visa-free is not work-free: a Member State may withdraw the exemption for a person carrying out a paid activity.",
    detail:
      "Article 6(3) of Regulation (EU) 2018/1806. Annex II membership is necessary and not sufficient, and whether the exemption survives for a working traveller is a per-Member-State question no EU-level list answers.",
  },
  "C-5": {
    id: "C-5",
    section: "C-5",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Canada's own regulations list some two dozen categories who may work without a permit; this check asks about none of them.",
    detail:
      "IRPR s. 186, and the business-visitor test in s. 187: remuneration sourced outside Canada and the principal place of business predominately outside Canada. Both limbs are typically satisfied by a remote worker paid by a foreign employer — which is not the same as saying such a trip qualifies, because s. 187 also requires the person not to be entering the Canadian labour market, and that is a judgement. The point is that this check asks neither question.",
  },
  "C-6": {
    id: "C-6",
    section: "C-6",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The posting rule carries a 24-month limit and a not-a-replacement condition; this system has a field for neither.",
    detail:
      "Article 12(1) of Regulation 883/2004. A 27-month assignment raises the same flag as a three-week one, and whether the employee is replacing another posted person is not asked anywhere.",
  },
  "C-7": {
    id: "C-7",
    section: "C-7",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "One flag stands in for two different articles that lead to different competent states by different tests.",
    detail:
      "Article 12 (posting) and Article 13 (activity in two or more Member States). Article 13's \"substantial part\" test is defined in Regulation 987/2009 art. 14(8), where 25 % is named only as an indicator within an overall assessment — the corpus is explicit that it must not be encoded as a threshold.",
  },
  "C-8": {
    id: "C-8",
    section: "C-8",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "There is no single detachment maximum: 24 months under the EU rule, 5 years for US agreements, and 60 or 24 months for Canada depending on the pair.",
    detail:
      "The maximum varies per pair within one network, so \"the detachment limit\" is not a fact about a country.",
  },
  "C-9": {
    id: "C-9",
    section: "C-9",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "Four country pairs this system reports as unknown are in fact covered by named agreements — and coverage is five columns, not a boolean.",
    detail:
      "US–NL, US–PT, US–CA, CA–NL and CA–PT each have an authority, an effective date, a certificate form and a maximum detachment, and no two rows agree. \"Portugal has a totalization agreement\" is not a fact about Portugal.",
  },
  "C-10": {
    id: "C-10",
    section: "C-10",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Six bilateral treaties define six different 183-day windows, and a rolling 365 days from a trip start is none of them.",
    detail:
      "The windows differ on the unit — taxable year, calendar year, fiscal year — and on whether the 12-month period floats at all. The US–Canada convention also carries a separate money-based limb ($10,000) that is an alternative to the day count, not a rider on it.",
  },
  "C-11": {
    id: "C-11",
    section: "C-11",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The treaty day test is one of three cumulative conditions, and for an Employer-of-Record arrangement the other two are the ones that decide the case.",
    detail:
      "Each article reads (a) days AND (b) remuneration paid by an employer not resident in the other state AND (c) remuneration not borne by a permanent establishment there. This system has no representation of (b) or (c), so a day count reported alone has answered one third of the question.",
  },
  "C-12": {
    id: "C-12",
    section: "C-12",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The single 183-in-365 watch line stands in for four domestic residence tests that are four different shapes, and one of them has no day count at all.",
    detail:
      "The Netherlands assesses residence on the circumstances with no threshold; Portugal has a 183 line anchored on the tax year plus a second, count-free limb that can make a person resident below it; Canada's is 183 days of sojourn in a taxation year, deeming residence retroactively to 1 January; the United States uses a weighted three-year computation. Crossing the line in two of them rewrites the status of days already lived, which \"headroom remaining\" cannot express.",
  },
  "C-15": {
    id: "C-15",
    section: "C-15",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The digital-nomad-visa exemption is two instruments with conditions, not a country-level boolean.",
    detail:
      "Portugal publishes a temporary-stay route and a residency route, both conditioned on proof of income, a contract or employer declaration, and proof of fiscal residence, with the consular post free to demand more. The suppression fires for an applicant who might not qualify for either.",
  },
  "C-17": {
    id: "C-17",
    section: "C-17",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The article that creates Portugal's D8 contains no income floor, no duration and no insurance requirement — which is exactly what this system's provenance note asks it for.",
    detail:
      "Lei n.º 23/2007 art. 61.º-B is one paragraph granting a residence visa for remote work on demonstration of the employment relationship. The conditions live in the general residence-visa article, in a portaria on means of subsistence, and in what the consular network demands. Citing art. 61.º-B for a figure would cite a provision that does not contain one.",
  },
  "C-16": {
    id: "C-16",
    section: "C-16",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The restricted-jurisdiction list matches no authority's register, and flattening the EU register into one would block the United States.",
    detail:
      "The EU regime attached to the United States is the Blocking Statute — a measure protecting against another country's sanctions, not a sanction on it. OFAC states plainly that it \"does not maintain a specific list of countries that U.S. persons cannot do business with\". The list this check uses is illustrative and is not any authority's compliance list.",
  },
  "C-21": {
    id: "C-21",
    section: "C-21",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "Portugal counts only days that include an overnight stay; the Borders Code counts entry and exit days both. One day counter serves both.",
    detail:
      "CIRS art. 16(2) makes a same-day visit zero and a late arrival one. A counter that measures date ranges over-counts the first and can under-count the second.",
  },
  "C-22": {
    id: "C-22",
    section: "C-22",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "A fresh posting for the same worker, employer and state needs at least two months to have elapsed since the last one — and the gap between trips is never examined here.",
    detail:
      "The Administrative Commission's Practical Guide, applying art. 12. Travel history is summed into a scalar day count, which cannot represent an interval at all. Two three-week trips six weeks apart is the exact pattern the rule addresses.",
  },
  "C-23": {
    id: "C-23",
    section: "C-23",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The EU assessment window looks forward twelve months, and a second indicative percentage points the opposite way from the first.",
    detail:
      "The guide asks for the assumed future situation over the following 12 calendar months, where every window in this use case is trailing. It also names activity under 5 % as indicative of marginal activity, which takes a person out of Article 13 entirely. Two indicative percentages doing opposite jobs is the strongest argument for encoding neither.",
  },
  "C-24": {
    id: "C-24",
    section: "C-24",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The administering agency's own published table pairs one Canada–Netherlands agreement's date with a different agreement's detachment limit.",
    detail:
      "There are two Canada–Netherlands social security agreements. The 1990 one says 24 months; the 2004 one that replaced it says 60. The CRA table's row carries the earlier date with the later number. Both halves are real; the pairing is not. Only reading the instruments caught it.",
  },
  "C-25": {
    id: "C-25",
    section: "C-25",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The UN's two-letter regime codes are not ISO country codes — in that scheme GB is the Guinea-Bissau regime.",
    detail:
      "A pipeline that ingested those prefixes as country codes would put the United Kingdom in the restricted list. A register of regimes is not a blocklist of destinations, and there is more than one way for the conversion to go wrong.",
  },
  "C-26": {
    id: "C-26",
    section: "C-26",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "This block is drawn at the visa label; both immigration authorities draw the line at the activity and who pays for it.",
    detail:
      "USCIS describes the B-1 as permitting business activities in a non-exhaustive list, and names the actual prohibition as local employment or labor for hire in the United States. State's first listed VWP requirement is that the travel purpose be permitted on a visitor (B) visa, which includes the B-1. So a business visa to the US is blocked here although the authority describes it as the business visa. None of this establishes that a workation qualifies — the eligibility limbs are officer judgements — only that this check asks none of them.",
  },
  "C-27": {
    id: "C-27",
    section: "C-27",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "Visa-waiver eligibility turns on a status held under a nationality, on travel to third countries, and on dual nationality — none of which a single nationality field can carry.",
    detail:
      "Travel to or presence in eight named countries since 2011, or Cuba since 2021, removes eligibility; so does dual nationality of six of them. Travel history is consulted here only by the Schengen day count. A visa-waiver stay is also capped at 90 days, and a short trip to a neighbouring country does not reset it.",
  },
});

/** The one confirmation worth carrying: a list of faults teaches distrust of everything equally. */
export const CONFIRMATION_LIBRARY = Object.freeze({
  "K-3": {
    id: "K-3",
    section: "K-3",
    path: CONTRADICTIONS,
    headline: "The visitor-visa block is right about work, and the authorities say so themselves.",
    detail:
      "Nothing published by CBP or the Department of State permits productive local employment on a visa waiver, and CBP states the limits of the authorisation itself: an approved ESTA is not a visa, and does not determine whether a traveller is admissible.",
  },
  "K-2": {
    id: "K-2",
    section: "K-2",
    path: CONTRADICTIONS,
    headline: "The 90 and the 180 are the right numbers.",
    detail:
      "Article 6(1) of the Borders Code: no more than 90 days in any 180-day period. The numbers are statutory. How they are applied is the caveat above.",
  },
  "K-1": {
    id: "K-1",
    section: "K-1",
    path: CONTRADICTIONS,
    headline: "The 29-code Schengen set matches the Council's own enumeration, and now has its dates.",
    detail:
      "Air and sea borders from 2024-03-31, land borders from 2025-01-01, with Cyprus and Ireland correctly absent.",
  },
});

// ---------------------------------------------------------------------------
// The map itself — finding -> what to read
// ---------------------------------------------------------------------------
// Keys are the flag strings the risk matrix actually produces, plus two keys
// for states that are a finding without being a flag (`treaty_coverage_
// unconfirmed`, `schengen_90_180_suppressed`). Nothing here is derived: if a
// finding is not written down below it gets no citation, which is why
// UNCITED_FINDINGS exists beside it and is rendered too.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} FindingSources
 * @property {string} label      the finding in a specialist's words
 * @property {Array<{source:string, locator:string, citedFor:string}>} cite
 * @property {string[]} [caveats]
 * @property {string[]} [confirmations]
 */

/** @type {Readonly<Record<string, FindingSources>>} */
export const FINDING_SOURCES = Object.freeze({
  a1_certificate_recommended: {
    label: "EU/EEA country pair — a certificate of applicable legislation (the \"A1\") is recommended",
    cite: [
      {
        source: "D-17",
        locator: "Articles 11(3)(a), 12(1) and 13(1)",
        citedFor:
          "which single Member State's social-security legislation applies when someone works in another. Art. 11(3)(a) makes the destination state's legislation apply by default; art. 12(1) is the posting exception that keeps the home state's; art. 13(1) covers a person working in two or more states.",
      },
      {
        source: "D-18",
        locator: "Article 19(2), with Articles 14(8) and 16",
        citedFor:
          "the certificate itself. Neither regulation ever uses the name \"A1\" — the legal object is the art. 19(2) attestation that a named state's legislation applies, and until what date and under what conditions.",
      },
      {
        source: "D-19",
        locator: "Practical Guide, applicable legislation",
        citedFor: "how the institutions that actually issue the attestation apply articles 12 and 13.",
      },
    ],
    caveats: ["C-6", "C-7", "C-22", "C-23"],
  },

  treaty_coverage_unconfirmed: {
    label: "Social-security and tax coverage for this country pair is unconfirmed",
    cite: [
      {
        source: "D-20",
        locator: "Status of Totalization Agreements; detached-worker rule",
        citedFor: "which US agreements are in force, and the 5-year detached-worker limit the SSA itself contrasts with other networks.",
      },
      {
        source: "D-21",
        locator: "CRA agreement table, with the CTS agreement texts and forms CPT63 / CPT55",
        citedFor: "Canada's agreement network, the certificate form per country, and the maximum detachment each agreement allows.",
      },
    ],
    caveats: ["C-9", "C-8", "C-24"],
  },

  non_treaty_pair: {
    label: "No totalization or tax agreement is on record for this pair",
    cite: [
      {
        source: "D-20",
        locator: "Status of Totalization Agreements",
        citedFor: "the authority's own list of which US agreements exist and when each entered into force — the register a claimed gap has to be checked against.",
      },
      {
        source: "D-21",
        locator: "CRA agreement table, with the CTS agreement texts",
        citedFor: "the same question for Canada, where the agreement text and the agency's table do not always agree.",
      },
    ],
    caveats: ["C-9", "C-8", "C-24"],
  },

  schengen_90_180: {
    label: "Schengen short-stay allowance — 90 days in any 180",
    cite: [
      {
        source: "D-07",
        locator: "Article 6(1), 6(1a) and 6(2)",
        citedFor:
          "the allowance this check measures against, and the three things the article says about how to measure it: the window runs backwards from each day of stay — which is how this check now measures it — entry and exit days both count, and time under a residence permit or long-stay visa is excluded, which it still does not model.",
      },
      {
        source: "D-08",
        locator: "Council Decisions (EU) 2024/210 and 2024/3212",
        citedFor: "which states the allowance is counted across, and from what dates.",
      },
    ],
    // C-1 IS NOT LISTED, and its absence is the point. It said the 180-day
    // window here was computed once per trip where art. 6(1) computes it per
    // day of stay. That is now implemented — schengenPeakDays() in
    // riskMatrix.js measures every day of the trip against its own trailing
    // 180 days and reports the peak — so carrying the caveat would tell a
    // specialist their figure is disputed when it is not, which is the same
    // defect as a stale status line, pointed the other way. C-2 (permit-covered
    // stay is excluded from the count) and C-3 (single pool across the EES
    // states) are still open and still listed.
    caveats: ["C-2", "C-3"],
    confirmations: ["K-2", "K-1"],
  },

  schengen_overstay: {
    label: "This trip would take the employee past the Schengen 90/180 allowance",
    cite: [
      {
        source: "D-07",
        locator: "Article 6(1), 6(1a) and 6(2)",
        citedFor: "the allowance and the counting rules the overrun is measured against.",
      },
    ],
    // C-1 dropped for the same reason as on `schengen_90_180` above: the
    // per-day-of-stay window is what this overrun was measured with.
    caveats: ["C-2", "C-3"],
    confirmations: ["K-2"],
  },

  schengen_visa_unverified: {
    label: "The stated travel document is not one this check recognises for a Schengen stay",
    cite: [
      {
        source: "D-09",
        locator: "Articles 3(1), 4(1) and 6(3), with Annexes I and II",
        citedFor:
          "who needs a visa for a short stay and who is exempt — and art. 6(3), which lets a Member State withdraw the exemption for a person carrying out a paid activity during the stay.",
      },
    ],
    caveats: ["C-4"],
  },

  schengen_90_180_suppressed: {
    label: "The Schengen allowance governed this trip and was not applied, because the destination is treated as running a digital-nomad-visa scheme",
    cite: [
      {
        source: "D-10",
        locator: "Lei n.º 23/2007 art. 61.º-B (inserted by Lei n.º 18/2022), with art. 54.º(1)(i)",
        citedFor:
          "the article that creates Portugal's remote-work residence visa, and the separate temporary-stay route capped at under a year — the two instruments the single suppression stands for.",
      },
      {
        source: "D-11",
        locator: "Necessary Documentation (Residency and Temporary Stay); Means of subsistence",
        citedFor: "the conditions the consular network actually applies to those routes, none of which this check tests.",
      },
      {
        source: "D-07",
        locator: "Article 6(2)",
        citedFor:
          "the principled basis a carve-out could rest on: the regulation excludes stay authorised under a residence permit or long-stay visa from the count. That exclusion attaches to the traveller holding the permit, not to the destination running a scheme.",
      },
    ],
    caveats: ["C-17", "C-15", "C-2"],
  },

  us_requires_work_permit: {
    label: "United States destination without a work permit",
    cite: [
      {
        source: "D-14",
        locator: "Department of State, Visa Waiver Program; CBP VWP/ESTA FAQ",
        citedFor: "what a visa waiver authorises, its 90-day cap, and the fact that an approved ESTA is not a visa and does not determine admissibility.",
      },
      {
        source: "D-15",
        locator: "USCIS, B-1 Temporary Business Visitor",
        citedFor:
          "the business activities the B-1 permits, expressly as a non-exhaustive list, and the prohibition the authority actually names: local employment or labor for hire in the United States.",
      },
    ],
    caveats: ["C-26", "C-27"],
    confirmations: ["K-3"],
  },

  visitor_visa_blocks_remote_work: {
    label: "The stated document is a visitor authorisation, which does not permit working at the destination",
    cite: [
      {
        source: "D-14",
        locator: "Department of State, Visa Waiver Program; CBP VWP/ESTA FAQ",
        citedFor: "the limits of a visa waiver, stated by the agencies that issue and enforce it.",
      },
      {
        source: "D-15",
        locator: "USCIS, B-1 Temporary Business Visitor",
        citedFor: "where the same authority draws the line between permitted business activity and prohibited local employment.",
      },
    ],
    caveats: ["C-26", "C-27"],
    confirmations: ["K-3"],
  },

  ca_requires_work_permit: {
    label: "Canadian destination without a work permit",
    cite: [
      {
        source: "D-16",
        locator: "IRPR ss. 186 and 187",
        citedFor:
          "the categories of foreign national who may work in Canada without a permit, and the business-visitor test — remuneration sourced outside Canada, and the principal place of business predominately outside Canada.",
      },
    ],
    caveats: ["C-5"],
  },

  tax_residency_183: {
    label: "Cumulative presence against a tax-residency watch line",
    cite: [
      {
        source: "D-31",
        locator: "AWR artikel 4",
        citedFor: "the Netherlands' residence test, which is assessed on the circumstances and contains no day count at all.",
      },
      {
        source: "D-32",
        locator: "CIRS artigo 16.º(1)(a), (1)(b), (2) and (3)",
        citedFor:
          "Portugal's test: more than 183 days in any 12-month period beginning or ending in the year concerned, a second limb that needs no day count, and the rule that a day counts only if it includes an overnight stay.",
      },
      {
        source: "D-33",
        locator: "Income Tax Act s. 250(1)(a)",
        citedFor: "Canada's deemed residence at 183 days of sojourn in a taxation year, effective throughout that year.",
      },
      {
        source: "D-34",
        locator: "Income Tax Folio S5-F1-C1",
        citedFor: "how the Canadian authority administers residence in practice, beside the statute.",
      },
      {
        source: "D-35",
        locator: "Substantial Presence Test",
        citedFor: "the United States' weighted three-year computation, its 31-day current-year limb, and its named exclusions.",
      },
      {
        source: "D-27",
        locator: "Employment-income articles, arts 16(2) and XV(2)",
        citedFor: "the treaty side of the same question for the three US pairs, where the day test is one of three cumulative conditions.",
      },
      {
        source: "D-24",
        locator: "Article 15(2)",
        citedFor: "the Netherlands–Portugal employment-income article and the window it defines.",
      },
      {
        source: "D-25",
        locator: "Article 15(2)",
        citedFor: "the Canada–Netherlands employment-income article and the window it defines.",
      },
      {
        source: "D-26",
        locator: "Article 15(2)",
        citedFor: "the Canada–Portugal employment-income article and the window it defines.",
      },
    ],
    caveats: ["C-12", "C-10", "C-11", "C-21"],
  },

  tax_residency_watch: {
    label: "Adding this trip would pass the tax-residency watch line this system applies",
    cite: [
      {
        source: "D-31",
        locator: "AWR artikel 4",
        citedFor: "the Netherlands' residence test — assessed on the circumstances, with no day count to be near or far from.",
      },
      {
        source: "D-32",
        locator: "CIRS artigo 16.º",
        citedFor: "Portugal's 183-day limb, its second count-free limb, and its overnight-stay counting rule.",
      },
      {
        source: "D-33",
        locator: "Income Tax Act s. 250(1)(a)",
        citedFor: "Canada's 183 days of sojourn in a taxation year, and that the consequence is backdated to 1 January.",
      },
      {
        source: "D-35",
        locator: "Substantial Presence Test",
        citedFor: "the United States' weighted three-year test, which no single trailing window approximates.",
      },
    ],
    caveats: ["C-12", "C-10", "C-11", "C-21"],
  },

  sanctioned_region: {
    label: "The destination is on this system's restricted-jurisdiction list",
    cite: [
      {
        source: "D-36",
        locator: "OFAC country programmes; EU Sanctions Map regime register; Canada's autonomous list",
        citedFor:
          "what the three authorities actually publish — regime registers, not destination blocklists — and OFAC's own statement that it maintains no list of countries US persons may not do business with.",
      },
      {
        source: "D-39",
        locator: "Consolidated List, permanent reference number scheme",
        citedFor: "the UN's own register, and its two-letter regime codes, which are not ISO country codes.",
      },
    ],
    caveats: ["C-16", "C-25"],
  },
});

// ---------------------------------------------------------------------------
// The findings with NO source, said out loud
// ---------------------------------------------------------------------------
// A citation block that only ever appears where a citation exists teaches a
// reader that everything unmarked is unsourced-but-fine. These are the findings
// UC-04 can produce that this corpus does not cover, each with the reason —
// because "we have no source for this" and "we did not think to look" read
// identically on a screen, and they are opposite facts.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, why:string}>>} */
export const UNCITED_FINDINGS = Object.freeze({
  pe_risk_dape: {
    label: "Permanent-establishment / dependent-agent exposure",
    why:
      "No source. The material that governs this is the OECD Model Tax Convention art. 5 and its Commentary, plus BEPS Action 7 — a copyrighted publication that may be paraphrased with a precise citation but never copied here, and which this repository has not read: docs/knowledge/layer-1-statutory/L1-01-L1-11-oecd-citation-register.md is a register of article numbers whose own evidence tag marks the source binding [PROPOSED] because the documents could not be retrieved. So this flag — the one that alone forces an escalation regardless of every other dimension — is the least sourced finding UC-04 produces, and that is worth knowing before weighing it.",
  },
  destination_out_of_scope: {
    label: "Destination outside the curated risk matrix",
    why:
      "No external source exists for this and none could: it is a statement about the coverage of this system's own table, not about the destination. It means nobody has evaluated this country here — not that the country is risky.",
  },
  employer_permission_not_granted: {
    label: "The employer has not granted workation permission",
    why:
      "No statutory source. This is a company's own setting on the employment record in Remote, so the authority is the customer, not a jurisdiction.",
  },
  immigration_document_on_file: {
    label: "Immigration authorization on file",
    why:
      "No source, and the absence is the finding. The requirement never to infer the document from the destination comes from this use case's own specification (UC-04.md §5 and §9), not from any authority — and no document is read from Remote at all, so there is nothing to cite about a particular traveller's entitlement.",
  },
  same_country: {
    label: "Destination is the employee's own work country",
    why: "Nothing to cite — a property of the request, not of any jurisdiction.",
  },
  invalid_dates: {
    label: "The dates could not be read as a real range",
    why: "Nothing to cite — a property of the request, not of any jurisdiction.",
  },
  travel_history_unreadable: {
    label: "A stated prior stay could not be read, so no day count was taken",
    why:
      "Nothing to cite — a property of the request, not of any jurisdiction. Worth knowing anyway: this is not a finding that the traveller is over any limit, it is a refusal to report a count that is missing a stay. Both day counts on this screen are absent for that reason, and neither absence is evidence in either direction.",
  },
  start_in_past: {
    label: "The trip starts in the past",
    why: "Nothing to cite — a property of the request, not of any jurisdiction.",
  },
  factors_invalid: {
    label: "The request is incomplete or malformed",
    why: "Nothing to cite — a property of the request, not of any jurisdiction.",
  },
  identity_not_verified: {
    label: "The requester could not be confirmed as an actor for this company",
    why: "Nothing to cite — this system's own access rule, not a jurisdiction's.",
  },
  employee_not_active: {
    label: "The employment is not active",
    why: "Nothing to cite — a fact about the Remote record, not a rule any authority publishes.",
  },
});

/**
 * The reading list for one finding, resolved against the libraries above.
 *
 * Returns null — never an empty shell and never a nearest match — when the
 * finding has no map entry. A caller that renders null renders nothing, which
 * is the honest output for "we hold no source for this".
 *
 * @param {string} findingKey
 * @returns {{
 *   finding: string,
 *   label: string,
 *   method: string,
 *   citations: Array<{sourceId:string,title:string,instrument:string,publisher:string,path:string,bytes:string|null,evidence:string,locator:string,citedFor:string,matchedOn:string}>,
 *   caveats: Array<{id:string,section:string,path:string,weight:string,headline:string,detail:string}>,
 *   confirmations: Array<{id:string,section:string,path:string,headline:string,detail:string}>
 * }|null}
 */
export function sourcesForFinding(findingKey) {
  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;

  return {
    finding: findingKey,
    label: entry.label,
    method: RETRIEVAL_METHOD,
    citations: entry.cite.map((c) => {
      const doc = SOURCE_LIBRARY[c.source];
      return {
        sourceId: doc.id,
        title: doc.title,
        instrument: doc.instrument,
        publisher: doc.publisher,
        // The link. A repo-relative path, because these are files: several of
        // the documents are cite-and-link-only at the publisher and exist here
        // as a provenance sidecar rather than as bytes.
        path: doc.path,
        bytes: doc.bytes,
        evidence: doc.evidence,
        locator: c.locator,
        citedFor: c.citedFor,
        // The honesty field, copied from treatyRetriever.js's `matchedOn`. It
        // names the mechanism — a person wrote this down — and carries no
        // score, rank or confidence, because none was computed.
        matchedOn: `hand-curated map entry for the finding "${findingKey}"`,
      };
    }),
    caveats: (entry.caveats ?? []).map((id) => CAVEAT_LIBRARY[id]),
    confirmations: (entry.confirmations ?? []).map((id) => CONFIRMATION_LIBRARY[id]),
  };
}

/**
 * Why a finding carries no citation. Same contract in reverse: null when the
 * finding is not one we have deliberately recorded as uncited, so a caller can
 * tell "we looked and there is nothing" from "this key is unknown here".
 *
 * @param {string} findingKey
 * @returns {{finding:string, label:string, why:string}|null}
 */
export function uncitedFinding(findingKey) {
  const entry = Object.hasOwn(UNCITED_FINDINGS, findingKey) ? UNCITED_FINDINGS[findingKey] : null;
  return entry ? { finding: findingKey, label: entry.label, why: entry.why } : null;
}
