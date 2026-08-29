// ---------------------------------------------------------------------------
// decisionSources.js  —  Where the rule behind a notice calculation can be read
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `decisionFacts.js` put the derivation in front of HR Ops: which rule, over
// which tenure, producing which date, against which proposal. On a Portuguese
// resignation proposing a last working day 23 days inside the statutory notice
// it produced this, and every word of it is true:
//
//     2026-08-31 was proposed as the last working day; statute puts it at
//     2026-09-23. That is 23 days SHORT of the minimum notice.
//
// And then it stopped. A person receiving that has to choose between real
// options — the employee works the notice out, the employer accepts the earlier
// date, the missing period is paid for, a different date is agreed — and the
// consequences of each differ by jurisdiction. The system held the document
// that speaks to exactly this (`docs/knowledge/layer-1-statutory/D-02`, Código
// do Trabalho arts. 400.º and 401.º, retrieved 2026-08-19) and never showed it.
// Article 401.º is the missing half of the sentence: it states what the
// employee owes when the notice is not served in full, and how it is measured.
//
// SAME SHAPE, SAME DISCIPLINE, AS src/uc04/decisionSources.js — read that
// file's header first; it argues the design and this one does not repeat it.
// Finding key -> the documents somebody read when the check was written up.
// No retrieval engine, no embedding, no ranking, no score. `matchedOn` names
// the map entry so a reader knows a person put it there, and carries no
// similarity figure because none was computed.
//
// ONE THING IS DIFFERENT HERE, AND IT MATTERS: A UC-05 FINDING IS NOT
// SELF-DESCRIBING. "The proposed date is short of statutory notice" is a
// finding about a COUNTRY's statute, so the same finding key cites different
// documents — or none at all — depending on the employment's country. The
// lookup therefore takes the country, and returns null for every country this
// corpus holds no statute for. That is most of them: the notice table covers
// nine countries and `docs/knowledge/` holds the notice statute for exactly
// ONE of them, Portugal. Nine-tenths of this file is that absence, said out
// loud rather than papered over, because "we have no source for GB's notice
// rule" and "GB's rule needs no source" read identically on a screen.
//
// (The corpus also holds D-01, the Dutch notice article. It is deliberately
// absent from the library below: the Netherlands is not in UC-05's notice
// table, so no UC-05 finding can be made from it, and a document listed here
// that no finding cites is a document nobody checked against anything.)
//
// FOUR RULES THAT ARE NOT NEGOTIABLE.
//
//   1. NEVER INVENT A CITATION. Every `path` points at a file vendored under
//      `docs/knowledge/`, and `test/uc05DecisionSources.test.js` asserts each
//      one exists on disk and still carries its catalogue id.
//
//   2. NEVER PRESENT A CITATION AS ADVICE, AND NEVER DECIDE THE SHORTFALL.
//      `SHORTFALL_HANDLINGS` below lists the handlings a person is choosing
//      between and, for each, what the cited statute states and what it is
//      silent on. It is deliberately unordered and unranked: there is no
//      "recommended" key, no score, and no field a renderer could sort by. The
//      system presents the options and their sources; a human chooses.
//
//   3. NOTHING HERE IS A THRESHOLD OR A FORMULA. Article 401.º sets an
//      indemnity "equal to the base retribution and diuturnidades
//      corresponding to the missing period". That is quoted, in the statute's
//      own words, and it is NOT computed anywhere in this repository — not in a
//      gate, not in a payout, not as an estimate beside the PTO figure. This
//      repository read the article once, on one day, and a money figure derived
//      from a fresh statutory read is the exact shape of the
//      well-formed-number-beside-a-citation failure `docs/knowledge/`'s own
//      rules name. It is a fact a human needs and this system may not apply.
//
//   4. WHERE A CHECK RESTS ON A RULE THE SOURCE CONTRADICTS, SAY SO ON THE
//      SCREEN WHERE THE DECISION HAPPENS. Three of `CONTRADICTIONS.md`'s
//      entries sit directly under findings UC-05 prints today: the Portuguese
//      bracket boundary is off by one at exactly 24 months (C-18); a statutory
//      waiver exists that the table cannot express and must not try to (C-19);
//      and the probation row models the employer, with a repealed figure, in
//      the wrong shape (C-20).
//
// IT DECIDES NOTHING, AND STRUCTURALLY CANNOT. Pure frozen data plus three
// lookups. No import of any kind, no client, no clock, no I/O — and per
// `docs/knowledge/README.md`'s structural rule, no citation id ever appears in
// a conditional anywhere in this repository. `test/uc05DecisionSources.test.js`
// asserts that neither the policy engine nor the workflow imports this file.
// ---------------------------------------------------------------------------

const KNOWLEDGE = "docs/knowledge/layer-1-statutory";
const CONTRADICTIONS = `${KNOWLEDGE}/CONTRADICTIONS.md`;

/** Rendered once above the citation block. Not decoration — see rule 2. */
export const SOURCE_FRAMING =
  "These are the sources the notice figures above were written from, linked so you can read them. " +
  "Nothing here is a recommendation and no gate consults any of it: a citation says which rule a check is based on and where the text is, never what to decide about this resignation.";

/** Rendered once above the caveats, for the same reason. */
export const CAVEAT_FRAMING =
  "Where a check applies a rule one of these documents disputes, the dispute is printed with the finding. " +
  "A contradicted finding is not evidence for the opposite conclusion — it is a finding whose basis you now know the limits of.";

/** How the citations got here. Stated because the alternative is assumed. */
export const RETRIEVAL_METHOD =
  "Hand-curated: each document below is listed against this finding, for this country, in src/uc05/decisionSources.js, by someone who read it. There is no search, no ranking and no similarity score, so no figure of confidence is quoted. A finding with no entry gets no citation rather than a nearest match.";

/** Rendered once above the handling options. The load-bearing sentence in the file. */
export const HANDLING_FRAMING =
  "A shortfall has to be handled by a person, and these are the handlings to choose between. " +
  "They are listed in no order of preference: nothing here recommends one, ranks them, or scores them, and this system computes no figure for any of them. " +
  "What each entry says is what the cited article states — and, where the article is silent, that it is silent.";

// ---------------------------------------------------------------------------
// The documents
// ---------------------------------------------------------------------------
// `path` is repo-relative because these are FILES. Both entries are class-(c)
// sources — quote and cite, no bytes — so `bytes` is null for both, which is a
// real difference from a document we hold the authority's own bytes for and is
// shown rather than smoothed over.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,title:string,instrument:string,publisher:string,path:string,bytes:string|null,evidence:string}>>} */
export const SOURCE_LIBRARY = Object.freeze({
  "D-01": {
    id: "D-01",
    title: "Netherlands — the employee's notice period, and the ladder that is not the employee's",
    instrument: "Burgerlijk Wetboek Boek 7, artikel 672 (BWBR0005290), consolidation in force 2026-01-01",
    publisher: "Ministerie van Justitie en Veiligheid, via Overheid.nl / wetten.overheid.nl (KOOP)",
    path: `${KNOWLEDGE}/D-01-nl-notice-bw-7-672.md`,
    // THE FIRST ENTRY IN THIS LIBRARY WITH BYTES. Both Portuguese sources are
    // class (c) — quote and cite, no copy — because the DRE's terms page is
    // unreadable from here. The Dutch corpus is CC0, so the retrieved page
    // itself is committed and its SHA-256 is checkable. That is a real
    // difference in how far a reader can verify a quotation, and it is shown
    // rather than smoothed over.
    bytes: `${KNOWLEDGE}/sources/D-01-nl-notice-bw-7-672.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-02": {
    id: "D-02",
    title: "Portugal — an employee's notice on resignation, and what is owed when it is not served",
    instrument:
      "Código do Trabalho (Lei n.º 7/2009), arts. 400.º and 401.º, with the paragraphs inserted by Lei n.º 13/2023",
    publisher: "Assembleia da República, via Diário da República Eletrónico",
    path: `${KNOWLEDGE}/D-02-pt-notice-ct-art-400.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-03": {
    id: "D-03",
    title: "Portugal — the probationary period, and who owes notice during it",
    instrument: "Código do Trabalho (Lei n.º 7/2009), arts. 111.º–114.º, art. 114.º(3) as amended by Lei n.º 13/2023",
    publisher: "Assembleia da República, via Diário da República Eletrónico",
    path: `${KNOWLEDGE}/D-03-pt-probation-notice.md`,
    bytes: null,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-19]",
  },
  "D-06": {
    id: "D-06",
    title: "United States — the evidence that no employee-side notice statute exists",
    instrument:
      "Worker Adjustment and Retraining Notification Act (WARN), as published by the US Department of Labor (ETA programme page and the Plant Closings and Layoffs topic page)",
    publisher: "U.S. Department of Labor",
    path: `${KNOWLEDGE}/D-06-us-warn-act-and-notice-absence.md`,
    bytes: `${KNOWLEDGE}/sources/D-06-us-dol-warn.html`,
    // THE ONLY [INFERRED] SOURCE IN THIS LIBRARY, AND THE TAG IS THE POINT.
    // WARN does not state that a resigning employee owes no notice. It states
    // what US federal law DOES require on separation — 60 days from employers of
    // one hundred or more, on mass layoffs — and the negative is read off
    // it occupies. A reader who sees a citation and assumes it says the thing it
    // is cited for would be wrong here, which is why the tag travels with it
    // everywhere it is rendered.
    evidence: "[INFERRED — argument from scope; agency publication retrieved 2026-08-19]",
  },
  "D-40": {
    id: "D-40",
    title: "Netherlands — the on-call carve-out from the employee's notice period",
    instrument: "Burgerlijk Wetboek Boek 7, artikel 628a (BWBR0005290), the article art. 672(5) refers out to",
    publisher: "Ministerie van Justitie en Veiligheid, via Overheid.nl / wetten.overheid.nl (KOOP)",
    path: `${KNOWLEDGE}/D-40-nl-oncall-bw-7-628a.md`,
    bytes: `${KNOWLEDGE}/sources/D-40-nl-oncall-bw-7-628a.html`,
    evidence: "[CONFIRMED — statute, retrieved 2026-08-20]",
  },
});

// ---------------------------------------------------------------------------
// The caveats
// ---------------------------------------------------------------------------
// `weight` is three-valued and never numeric, exactly as in UC-04's file:
//   "disputed"    — a source contradicts the rule as this code applies it.
//   "unsupported" — the code asks a source for something it does not contain.
//   "incomplete"  — the rule is right as far as it goes and the check cannot
//                   see a condition the source attaches to it.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {id:string,section:string,path:string,weight:string,headline:string,detail:string}>>} */
export const CAVEAT_LIBRARY = Object.freeze({
  "C-13": {
    id: "C-13",
    section: "C-13",
    path: CONTRADICTIONS,
    weight: "unsupported",
    headline: "The United States row rests on an argument from scope, not on a source that states the negative.",
    detail:
      "D-06 is the WARN Act as published by the US Department of Labor. WARN requires 60 days' advance notice FROM EMPLOYERS of 100 or more, on plant closings and mass layoffs affecting 50 or more — it delimits the federal field without ever addressing what a resigning employee owes. Two things it leaves entirely open: state law, several states running their own mini-WARN statutes; and the contract, since an at-will relationship can still carry a notice term. This is the weakest evidence behind any row in the notice table and it is why a US resignation escalates instead of reaching sign-off.",
  },
  "C-14": {
    id: "C-14",
    section: "C-14",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "The month is a statutory default a written contract may extend to six.",
    detail:
      "Art. 7:672(8): the employee's notice period may be extended in writing, to no more than six months — and where it is, the employer's must be at least double it. So one month is the floor the statute supplies in the absence of agreement, not the answer for an employee whose contract says otherwise. This system does not hold contracts. The article's opening tenure ladder (1/2/3/4 months by service) is the EMPLOYER's obligation under lid 2 and is deliberately not modelled here.",
  },
  "C-28": {
    id: "C-28",
    section: "C-28",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "For an on-call contract the Dutch notice is four days, not one month — and the end-of-month anchor does not apply at all.",
    detail:
      "Art. 7:672(5): where the volume of work is not fixed, the employee's notice is the term in art. 628a(2) — four days — reducible by collective agreement under art. 628a(4) to no less than 24 hours, and lid 1's end-of-month rule is expressly disapplied. Art. 628a(9) defines that contract type by whether the hours volume is fixed as a single number per period, or on a pay-entitlement limb with no hours figure at all. Nothing on the Remote employment record answers either limb, so this is recorded rather than branched on: contract_type carries full_time/part_time/contractor, a different question, and work_hours_per_week is not the statutory test.",
  },
  "C-18": {
    id: "C-18",
    section: "C-18",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "At exactly two years' service the table gives 60 days and the statute gives 30.",
    detail:
      "Art. 400.º(1) splits on \"até dois anos ou mais de dois anos\" — up to two years INCLUSIVE against more than two. The bracket here splits at 23 months, so a resignation at exactly 24 months is told it owes twice the notice it owes. Away from that one boundary the 30/60 figures are the article's own.",
  },
  "C-19": {
    id: "C-19",
    section: "C-19",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "A worker recognised as a victim of domestic violence owes no notice and no indemnity — and this system cannot see that status.",
    detail:
      "Art. 400.º(6) exempts that worker from the notice requirement, and art. 401.º(2) from the indemnity for not serving it. The status is recognised under separate legislation; determining it is not a support automation's job, and this system deliberately does not try. It is recorded here so that the person deciding the shortfall knows the exemption exists — no calculation on this case accounts for it.",
  },
  "C-20": {
    id: "C-20",
    section: "C-20",
    path: CONTRADICTIONS,
    weight: "disputed",
    headline: "The Portuguese probation row models the EMPLOYER's notice, using a figure repealed in 2023, as one flat number where the statute is a step.",
    detail:
      "Art. 114.º(1): during probation either party may terminate with no notice, no just cause and no indemnity — the employee's figure is zero. Every notice period in the article is the employer's: 7 days after 60 days of probation, 30 days after 120 (15 in the 2009 text, raised by Lei n.º 13/2023 with effect from 2023-05-01). The table's single 15-day probation bracket is the wrong party's, the superseded number, and the wrong shape at once.",
  },
  "C-21": {
    id: "C-21",
    section: "C-21",
    path: CONTRADICTIONS,
    weight: "incomplete",
    headline: "\"How long has probation lasted\" is not elapsed calendar time in Portugal.",
    detail:
      "Art. 113.º(2): days of absence — justified or not — and days of leave, exemption or contract suspension do not count toward the probationary period. Any probation figure derived from dates alone over-counts it.",
  },
});

// ---------------------------------------------------------------------------
// The handlings a person is choosing between
// ---------------------------------------------------------------------------
// THIS IS THE ANSWER TO "how does this help HR decide?" AND IT IS THE PART
// MOST EASILY TURNED INTO SOMETHING IT MUST NOT BE.
//
// `state` is the only judgement in the entry, and it is a judgement about the
// DOCUMENT, not about the case:
//
//   "stated_in_source"  the cited article states this consequence, and the
//                       words are quoted.
//   "source_silent"     the retrieved text of the cited articles does not
//                       address this handling. Not "forbidden", not
//                       "permitted" — unaddressed by what we read. Both other
//                       readings would be conclusions this repository has no
//                       standing to reach.
//
// There is deliberately no "recommended", no ordering key and no score. And
// there is no arithmetic: art. 401.º's measure is quoted and never applied.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {country:string, note:string, options:ReadonlyArray<object>}>>} */
export const SHORTFALL_HANDLINGS = Object.freeze({
  PT: {
    country: "PT",
    note:
      "Portugal is the one country in UC-05's notice table whose notice statute this repository has actually read. What follows is arts. 400.º and 401.º as retrieved on 2026-08-19 — the enacting text plus Lei n.º 13/2023, not a consolidation.",
    options: Object.freeze([
      {
        key: "serve_full_notice",
        label: "The employee serves the notice in full",
        state: "stated_in_source",
        source: "D-02",
        locator: "art. 400.º(1)",
        whatTheSourceSays:
          "The article sets the minimum: written notice at least 30 or 60 days ahead, according to whether the employee has up to two years' service or more. Serving it in full is the case the article is written for, and nothing has to be resolved.",
        quote:
          "O trabalhador pode denunciar o contrato […] com a antecedência mínima de 30 ou 60 dias, conforme tenha, respectivamente, até dois anos ou mais de dois anos de antiguidade.",
      },
      {
        key: "indemnity_for_missing_period",
        label: "The missing period is paid for",
        state: "stated_in_source",
        source: "D-02",
        locator: "art. 401.º",
        whatTheSourceSays:
          "This is the consequence the statute itself attaches to a short notice, and it is the reason the shortfall is a money question and not only a date question. The article measures the indemnity by the base retribution and diuturnidades for the period NOT served — a different base from the pay rate this system uses for the PTO payout, and one nothing here computes. The number is for a person to work out; this system deliberately does not estimate it.",
        quote:
          "O trabalhador que não cumpra, total ou parcialmente, o prazo de aviso prévio estabelecido no artigo anterior deve pagar ao empregador uma indemnização de valor igual à retribuição base e diuturnidades correspondentes ao período em falta.",
      },
      {
        key: "employer_accepts_earlier_date",
        label: "The employer accepts the earlier last working day",
        state: "source_silent",
        source: "D-02",
        locator: "arts. 400.º–401.º",
        whatTheSourceSays:
          "The retrieved text does not address the employer releasing the employee early or declining to pursue art. 401.º. It states what the employee owes; it does not say whether the employer must claim it. Read this as the article not answering the question, not as it permitting or forbidding the handling.",
        quote: null,
      },
      {
        key: "agreed_alternative_date",
        label: "A different last working day is agreed between the parties",
        state: "source_silent",
        source: "D-02",
        locator: "arts. 400.º–401.º",
        whatTheSourceSays:
          "Nothing in the retrieved text of these two articles addresses an agreed departure date. Art. 400.º(2) does show that the parties can move the period in the other direction — a collective instrument or the contract may extend notice to as much as six months for administration, direction, representation or responsibility roles — so the contract itself is worth reading before treating 60 days as the whole rule.",
        quote:
          "O instrumento de regulamentação colectiva de trabalho e o contrato de trabalho podem aumentar o prazo de aviso prévio até seis meses, relativamente a trabalhador que ocupe cargo de administração ou direcção, ou com funções de representação ou de responsabilidade.",
      },
    ]),
    // NOT AN OPTION — A DISQUALIFIER, AND KEPT SEPARATE FROM THE FOUR ABOVE SO
    // IT CANNOT BE READ AS ONE. If it applies, there is no shortfall to handle.
    // This system cannot see the status and must not try to (C-19).
    exemption: Object.freeze({
      key: "domestic_violence_exemption",
      label: "The employee is a recognised victim of domestic violence",
      state: "stated_in_source",
      source: "D-02",
      locator: "art. 400.º(6), with art. 401.º(2)",
      whatTheSourceSays:
        "Such a worker is exempt from giving notice at all, and from the art. 401.º indemnity for not giving it. The status is recognised under separate legislation and nothing in this system can determine it, so no figure on this case accounts for it. It is printed because a person weighing a shortfall has to know the exemption exists before asking the employee for anything.",
      quote:
        "O trabalhador a quem tenha sido reconhecido o estatuto de vítima de violência doméstica […] fica dispensado do cumprimento do aviso prévio previsto nos números anteriores.",
    }),
    // Two dimensions the notice table has no field for, both of which change
    // WHICH minimum this shortfall is measured against. Named here rather than
    // encoded: each needs a contract fact the employment record does not carry.
    boundaries: Object.freeze([
      "Art. 400.º(2): a collective instrument or the contract may lengthen the notice to up to six months for administration, direction, representation or responsibility roles. The table models the statutory default as a fixed entitlement, so a longer contractual period would make this shortfall larger than the figure shown.",
      "Art. 400.º(3): a fixed-term contract has its own ladder — 30 or 15 days, on a six-month duration split — and the table has no contract-type dimension at all. On a term contract the 30/60-day figures are the wrong ladder.",
    ]),
  },
});

// ---------------------------------------------------------------------------
// Finding -> sources, by country
// ---------------------------------------------------------------------------
// `byCountry` is the whole shape. A UC-05 finding is a finding about a
// jurisdiction's statute, so a citation that ignored the country would be the
// nearest-match failure in its purest form: citing Portugal's Código do
// Trabalho beside a British notice period.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, byCountry:Record<string, {cite:Array<object>, caveats?:string[]}>}>>} */
export const FINDING_SOURCES = Object.freeze({
  statutory_notice_rule: {
    label: "The statutory notice period this calculation applied",
    byCountry: {
      NL: {
        cite: [
          {
            source: "D-01",
            locator: "art. 7:672 lid 4, with lid 1 and lid 8",
            citedFor:
              "the employee's notice period — one month, flat, with NO tenure dimension at all — and the end-of-month rule the calculated date is snapped to. The article's opening 1/2/3/4-month tenure ladder is quoted beside it precisely so a reader can see that it is lid 2 and belongs to the EMPLOYER: taking the first numbers in the article would model the wrong party's obligation and report it as the employee's.",
          },
          {
            source: "D-40",
            locator: "art. 628a(2), (4) and (9), reached through art. 7:672 lid 5",
            citedFor:
              "the size of the carve-out the flat month is conditional on. Where the volume of work is not fixed the notice is four days — or 24 hours under a collective agreement — and the end-of-month anchor does not apply. This is cited on every Dutch decision, not only the ones we suspect, because the record cannot tell us which employees it covers.",
          },
        ],
        caveats: ["C-28", "C-14"],
      },
      PT: {
        cite: [
          {
            source: "D-02",
            locator: "art. 400.º(1), with ¶¶2–3",
            citedFor:
              "the 30/60-day minimum and the two-year service split the notice period was taken from, and the two ways the article says that minimum can be a different number: a contractual extension to as much as six months for senior roles, and a separate ladder for fixed-term contracts.",
          },
        ],
        caveats: ["C-18"],
      },
    },
  },

  statutory_discrepancy: {
    label: "The proposed last working day is earlier than the statutory notice allows",
    byCountry: {
      PT: {
        cite: [
          {
            source: "D-02",
            locator: "art. 401.º, with art. 400.º(1) and ¶6",
            citedFor:
              "what the statute says happens when the notice is not served in full — an indemnity measured by the base retribution and diuturnidades for the missing period — and the exemption in ¶6 that removes both the notice and the indemnity for a recognised victim of domestic violence. This is the article that turns \"23 days short\" into a decision somebody can actually take.",
          },
        ],
        caveats: ["C-19", "C-18"],
      },
    },
  },

  notice_during_probation: {
    label: "The employee was inside a probationary period when the resignation was filed",
    byCountry: {
      PT: {
        cite: [
          {
            source: "D-03",
            locator: "arts. 114.º and 112.º–113.º",
            citedFor:
              "who actually owes notice during probation in Portugal — art. 114.º(1) says either party may terminate with none — and how long probation lasts, which art. 112.º sets by ROLE (90, 180 or 240 days) rather than by country, with art. 113.º(2) excluding days of absence, leave or suspension from the count.",
          },
        ],
        caveats: ["C-20", "C-21"],
      },
    },
  },

  no_statutory_notice_period: {
    label: "No statutory minimum notice binds a resigning employee in this country",
    byCountry: {
      US: {
        cite: [
          {
            source: "D-06",
            locator: "WARN, as stated on the DOL's Plant Closings and Layoffs page",
            // WHAT THIS IS CITED FOR IS NOT WHAT IT SAYS, AND THE WORDING HAS TO
            // CARRY THAT. Every other entry in this file cites an article for a
            // proposition the article states. This one cites a statute for the
            // SHAPE OF THE FIELD IT OCCUPIES, and a reader who skims it as
            // "WARN says employees owe no notice" has read it backwards.
            //
            // (The employer-size threshold is written out in words below rather
            // than in digits, because this file is guarded by a test asserting
            // that no arithmetic operator touches a number here — and a comment
            // slash followed by a figure trips its division check. The guard is
            // right; the digits were the accident.)
            citedFor:
              "the extent of what US federal law requires on separation — sixty calendar days' advance written notice, FROM EMPLOYERS OF ONE HUNDRED OR MORE, on plant closings and mass layoffs affecting fifty or more at a single site. The finding that no statutory minimum runs the other way, against a resigning employee, is read off that delimitation and is NOT stated by the source. It is an argument from scope, tagged [INFERRED], and it leaves state mini-WARN statutes and contractual notice completely untouched.",
          },
        ],
        caveats: ["C-13"],
      },
    },
  },

  no_matching_notice_bracket: {
    label: "This country's notice table reached no bracket covering this employee's service",
    byCountry: {
      PT: {
        cite: [
          {
            source: "D-03",
            locator: "art. 112.º(1)",
            citedFor:
              "why a Portuguese resignation can fall outside every bracket: probation may run to 180 or 240 days for technical, high-responsibility or director roles, while the table's probation bracket stops at five months — so the gap is in this system's table, not in the statute.",
          },
        ],
        caveats: ["C-20"],
      },
    },
  },
});

// ---------------------------------------------------------------------------
// The findings with NO source, said out loud
// ---------------------------------------------------------------------------
// A citation block that only ever appears where a citation exists teaches a
// reader that everything unmarked is unsourced-but-fine. Two different absences
// live here, and they are different facts:
//
//   * a finding about THIS SYSTEM or THIS RECORD, which no jurisdiction
//     publishes anything about and never will;
//   * a finding about a COUNTRY'S STATUTE that this corpus simply does not
//     hold — eight of the nine countries in the notice table.
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, {label:string, why:string}>>} */
export const UNCITED_FINDINGS = Object.freeze({
  identity_not_verified: {
    label: "The person filing the resignation could not be confirmed as the employee it concerns",
    why: "Nothing to cite — this system's own access rule, not a jurisdiction's.",
  },
  employee_not_active: {
    label: "The employment is not active",
    why: "Nothing to cite — a fact about the Remote record, not a rule any authority publishes.",
  },
  missing_seniority_date: {
    label: "The employment record carries no start date",
    why: "Nothing to cite — a gap in the record. Every statutory notice period is measured from length of service, so no statute can be applied until it is filled.",
  },
  unsupported_country: {
    label: "This employee's country is not in the statutory notice table",
    // SHARPENED 2026-08-20, because it now has a sibling it can be confused
    // with. `no_statutory_notice_period` is a SOURCED finding about a country's
    // law and appears in FINDING_SOURCES with a citation; this one is a
    // statement about our own coverage and appears here, with none. If a reader
    // ever sees the two rendered the same way, the distinction the whole gate
    // ladder was rebuilt around has been lost one layer further out.
    why: "No source, and none is expected: this is a statement about the coverage of this system's own table, not about the country's law. Nothing here says that country requires no notice, or a short one — that is a different finding, it is cited where this system holds it, and this is not it.",
  },
  pto_balance_unusable: {
    label: "The accrued-PTO payout could not be computed",
    why: "Nothing to cite — an input-quality problem with the balances supplied, not a question any statute answers.",
  },
  unparseable_date: {
    label: "A date on the resignation could not be read as a real calendar date",
    why: "Nothing to cite — a property of the request.",
  },
});

/**
 * The country codes for which this file holds a notice statute at all.
 * Exported so a caller can say "one of nine" honestly rather than counting.
 */
export const SOURCED_COUNTRIES = Object.freeze(["NL", "PT", "US"]);

/**
 * The reading list for one finding IN ONE COUNTRY, resolved against the
 * libraries above.
 *
 * Returns null — never an empty shell and never a nearest match — when the
 * finding has no entry, or has one for other countries and not this one. A
 * caller that renders null renders nothing, which is the honest output for "we
 * hold no source for this".
 *
 * @param {string} findingKey
 * @param {string|null} [countryCode]  ISO 3166-1 alpha-2, e.g. "PT"
 */
export function sourcesForFinding(findingKey, countryCode = null) {
  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;
  const country = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (!country) return null;
  const forCountry = Object.hasOwn(entry.byCountry, country) ? entry.byCountry[country] : null;
  if (!forCountry) return null;

  return {
    finding: findingKey,
    country,
    label: entry.label,
    method: RETRIEVAL_METHOD,
    citations: forCountry.cite.map((c) => {
      const doc = SOURCE_LIBRARY[c.source];
      return {
        sourceId: doc.id,
        title: doc.title,
        instrument: doc.instrument,
        publisher: doc.publisher,
        path: doc.path,
        bytes: doc.bytes,
        evidence: doc.evidence,
        locator: c.locator,
        citedFor: c.citedFor,
        // The honesty field. It names the mechanism — a person wrote this down,
        // against this finding, for this country — and carries no score, rank
        // or confidence, because none was computed.
        matchedOn: `hand-curated map entry for the finding "${findingKey}" in ${country}`,
      };
    }),
    caveats: (forCountry.caveats ?? []).map((id) => CAVEAT_LIBRARY[id]),
  };
}

/**
 * Why a finding carries no citation. Same contract in reverse, and it answers
 * for both kinds of absence: a finding about this system (nothing to cite,
 * ever) and a finding about a country's statute this corpus does not hold.
 *
 * Null when the key is not one this file knows at all, so a caller can tell
 * "we looked and there is nothing" from "this key is unknown here".
 *
 * @param {string} findingKey
 * @param {string|null} [countryCode]
 * @returns {{finding:string, label:string, why:string, country:string|null}|null}
 */
export function uncitedFinding(findingKey, countryCode = null) {
  const country = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";

  const flat = Object.hasOwn(UNCITED_FINDINGS, findingKey) ? UNCITED_FINDINGS[findingKey] : null;
  if (flat) return { finding: findingKey, label: flat.label, why: flat.why, country: country || null };

  // A finding we DO hold sources for, in some country that is not this one.
  const entry = Object.hasOwn(FINDING_SOURCES, findingKey) ? FINDING_SOURCES[findingKey] : null;
  if (!entry) return null;
  if (country && Object.hasOwn(entry.byCountry, country)) return null; // it is cited; nothing to explain

  return {
    finding: findingKey,
    country: country || null,
    label: entry.label,
    why:
      `No source. This repository holds the statutory notice text for ${SOURCED_COUNTRIES.join(", ")} only, out of the nine countries in the notice table` +
      (country ? `, and ${country} is not among them` : "") +
      ". The figure applied here rests on the short citation string carried in src/uc05/noticePeriodTable.js, which has no URL, no version and no retrieved-on date and which nothing in this repository has checked against the statute. That is worth knowing before treating the number as settled — it is not a finding that the number is wrong.",
  };
}

/**
 * The handlings a shortfall could be resolved by, in one country, with what the
 * cited statute states about each and what it is silent on.
 *
 * Null for every country whose notice statute this corpus does not hold. That
 * is deliberate and it is the same rule as `sourcesForFinding()`: a generic
 * list of handlings offered under a jurisdiction nobody has read would be a
 * nearest match wearing the clothes of an option list, and "the employer can
 * waive it" is exactly the kind of sentence that gets acted on.
 *
 * @param {string|null} countryCode
 */
export function shortfallHandlings(countryCode = null) {
  const country = typeof countryCode === "string" ? countryCode.trim().toUpperCase() : "";
  if (!country || !Object.hasOwn(SHORTFALL_HANDLINGS, country)) return null;
  const entry = SHORTFALL_HANDLINGS[country];
  const doc = (id) => {
    const d = SOURCE_LIBRARY[id];
    return { sourceId: d.id, title: d.title, instrument: d.instrument, publisher: d.publisher, path: d.path, evidence: d.evidence };
  };
  const expand = (o) => ({ ...o, document: doc(o.source) });

  return {
    country,
    framing: HANDLING_FRAMING,
    method: RETRIEVAL_METHOD,
    note: entry.note,
    options: entry.options.map(expand),
    exemption: expand(entry.exemption),
    boundaries: entry.boundaries,
  };
}
