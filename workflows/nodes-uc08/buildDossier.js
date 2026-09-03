// ---------------------------------------------------------------------------
// buildDossier.js — body of the "Build Dossier" n8n Code node
// ---------------------------------------------------------------------------
// UC-08's deterministic core in n8n, ported from src/uc08/{
// inquiryParser,presenceCalculator,treatyRetriever,dossierBuilder}.js into
// ONE node, same discipline as UC-01's gates.js and UC-06's amendmentGates.js.
// test/n8nUc08Parity.test.js executes THIS FILE and asserts its parsed type/
// jurisdictions/presenceDays/citations match the real Node functions.
//
// treatyRetriever.js became embedding-similarity retrieval against a pgvector
// table (issue #29). This node deliberately keeps the keyword path, which is
// also what the real retrieveCitations() runs whenever no embed function and
// no stored vectors are configured: an n8n Code node has neither a pgPool nor
// an embedding client, so a real pgvector search belongs in separate n8n nodes
// (an HTTP embeddings call + a Supabase query), not in this Code body. The
// parity test keeps comparing the two, and both produce the keyword results —
// see treatyRetriever.js's header for the full reasoning.
//
// The LLM's output is validated against a strict shape and falls back to the
// rule-based classifier on ANY failure — same pattern as every other
// LLM-with-fallback seam in this repo. The one thing this node does NOT
// duplicate from an LLM call is dossierBuilder.draftNarrative()'s LLM path:
// the narrative is display/audit prose that's never read back into a
// decision (this use case has exactly one decision: escalate, always), so
// n8n uses the deterministic template directly — one fewer HTTP dependency,
// one fewer thing to keep in parity, for text that was never load-bearing.
//
// THIS NODE NEVER PRODUCES ANYTHING BUT "escalate". There is no decision
// branch anywhere in this file — that is the point of a 🔴 use case, ported
// from workflow.js's own header.
// ---------------------------------------------------------------------------

const ticket = $('Normalize Inquiry').first().json;

// --- inquiryParser.js: rule-based fallback + strict LLM-shape validation ---
// ⚠ The bare `de: 'DE'` key is gone, and matching is at word boundaries. With
// String.includes, "resiDEnt"/"unDEr"/"consiDEred" each added GERMANY to the
// jurisdiction list of a cross-border TAX dossier — a country nobody named,
// stated as fact to a human deciding someone's tax position. Same defect class
// as UC-07's ticket 18. Port of src/shared/countryMentions.js; keep in step
// (test/n8nUc08Parity.test.js executes this file and compares).
// ⚠ `netherlands` and `canada` were BOTH missing here and in the Node
// dictionary. A CA→NL totalization inquiry therefore reached a Tax Ops
// specialist with a confident 273-day count and `jurisdictions: []`
// (docs/DEMO-COUNTRIES.md §6.7). Adding two names fixes two cases; the durable
// half is JURISDICTION_REGISTER below, ported from
// src/uc08/jurisdictionKnowledge.js.
const KNOWN_COUNTRIES = {
  germany: 'DE', spain: 'ES', portugal: 'PT', nigeria: 'NG',
  'united kingdom': 'GB', uk: 'GB', 'united states': 'US', usa: 'US', france: 'FR',
  netherlands: 'NL', canada: 'CA',
};

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Distinct country codes in the order the TEXT names them — not the order this
// file's dictionary literal happens to be typed in.
function findJurisdictions(text) {
  const lower = (text || '').toLowerCase();
  const hits = [];
  for (const key of Object.keys(KNOWN_COUNTRIES)) {
    const pattern = new RegExp('(?<![a-z0-9])' + escapeRegExp(key) + '(?![a-z0-9])', 'g');
    let m;
    while ((m = pattern.exec(lower)) !== null) hits.push({ code: KNOWN_COUNTRIES[key], index: m.index });
  }
  hits.sort((a, b) => a.index - b.index);
  const out = [];
  for (const h of hits) if (out.indexOf(h.code) === -1) out.push(h.code);
  return out;
}
const VALID_TYPES = ['dual_residency', 'withholding', 'totalization', 'other'];

function parseInquiryRuleBased(text) {
  const lower = (text || '').toLowerCase();
  const jurisdictions = findJurisdictions(text);

  let inquiryType = 'other';
  if (/dual.?resident|resident of both|two countries.*tax/.test(lower)) {
    inquiryType = 'dual_residency';
  } else if (/totali[sz]ation|social security|\ba1\b|certificate of coverage/.test(lower)) {
    inquiryType = 'totalization';
  } else if (/withhold|withholding|payroll tax/.test(lower)) {
    inquiryType = 'withholding';
  }
  return { inquiryType, jurisdictions };
}

function isValidParse(obj) {
  return obj && VALID_TYPES.indexOf(obj.inquiryType) !== -1 && Array.isArray(obj.jurisdictions);
}

let parsed;
try {
  const raw = $input.first().json?.choices?.[0]?.message?.content;
  const candidate = JSON.parse(raw);
  parsed = isValidParse(candidate)
    ? { inquiryType: candidate.inquiryType, jurisdictions: candidate.jurisdictions }
    : parseInquiryRuleBased(ticket.text);
} catch (e) {
  parsed = parseInquiryRuleBased(ticket.text);
}

// --- presenceCalculator.js: computePresenceDays() — a NUMBER, never a conclusion
// Ported verbatim from src/uc08/presenceCalculator.js (see that file's header
// for the three bugs this shape exists to prevent): days are the UNION of
// calendar days, not the sum of period lengths, so a day recorded by two
// upstream sources counts once; country codes are trimmed + upper-cased so
// "de"/"DE " cannot silently drop a period and hide a 183-day breach; and an
// unparseable date returns an explicit NOT_EVALUATED with days: null instead of
// clamping to the window boundary and fabricating a count.
// test/n8nUc08Parity.test.js enforces that this copy and the real one agree.
var MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDayIndex(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  var ms = value instanceof Date ? value.getTime() : Date.parse(String(value).trim());
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

function normalizeCountry(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : null;
}

function computePresenceDays(args) {
  var problems = [];
  var winStart = toDayIndex(args.windowStart);
  var winEnd = toDayIndex(args.windowEnd);
  if (winStart === null) problems.push('unparseable windowStart: ' + JSON.stringify(args.windowStart));
  if (winEnd === null) problems.push('unparseable windowEnd: ' + JSON.stringify(args.windowEnd));
  if (winStart !== null && winEnd !== null && winEnd < winStart) {
    problems.push('window ends before it starts: ' + args.windowStart + ' → ' + args.windowEnd);
  }

  var target = normalizeCountry(args.country);
  if (target === null) problems.push('unparseable country: ' + JSON.stringify(args.country));

  // RULE 4 — NO RECORDS IS NOT ZERO DAYS. Ported from the real calculator's
  // own guard, which this node body was missing: asked to count presence in DE
  // with an empty `presencePeriods`, it returned `{days: 0, status: COUNTED}`
  // and the dossier narrated "0 distinct day(s) ... in the evaluated window".
  // That is a positive claim — this person was not in Germany — derived from no
  // evidence at all, printed beside a citation of the 183-day rule, in a
  // dossier whose entire purpose is to inform a tax specialist. It fails in the
  // direction that HIDES a breach.
  //
  // Note what this does NOT refuse: records that exist and simply do not match.
  // Five travel records, none of them DE, genuinely IS zero days in DE, and a
  // period outside the window genuinely contributes nothing to that window.
  // Those stay a counted zero, because they are a finding. Only an empty
  // evidence base becomes NOT_EVALUATED.
  var suppliedPeriods = args.presencePeriods || [];
  if (suppliedPeriods.length === 0) {
    problems.push('no presence records were supplied, so no days could be counted');
  }

  var intervals = [];
  var periodsCounted = 0;
  var periods = suppliedPeriods;
  for (var i = 0; i < periods.length; i++) {
    var period = periods[i] || {};
    var periodCountry = normalizeCountry(period.country);
    if (periodCountry === null) {
      problems.push('unparseable period country: ' + JSON.stringify(period.country));
      continue;
    }
    var start = toDayIndex(period.startDate);
    var end = toDayIndex(period.endDate);
    if (start === null || end === null) {
      problems.push(
        'unparseable period dates for ' + periodCountry + ': ' +
        JSON.stringify(period.startDate) + ' → ' + JSON.stringify(period.endDate)
      );
      continue;
    }
    if (end < start) {
      problems.push('period ends before it starts for ' + periodCountry + ': ' + period.startDate + ' → ' + period.endDate);
      continue;
    }
    if (periodCountry !== target) continue;
    if (winStart === null || winEnd === null) continue;
    var overlapStart = Math.max(start, winStart);
    var overlapEnd = Math.min(end, winEnd);
    if (overlapStart > overlapEnd) continue;
    intervals.push([overlapStart, overlapEnd]);
    periodsCounted += 1;
  }

  if (problems.length > 0) {
    return { days: null, periodsCounted: periodsCounted, status: 'NOT_EVALUATED', problems: problems };
  }

  intervals.sort(function (a, b) { return a[0] - b[0]; });
  var days = 0;
  var curStart = null;
  var curEnd = null;
  for (var j = 0; j < intervals.length; j++) {
    var s = intervals[j][0];
    var e = intervals[j][1];
    if (curStart === null) {
      curStart = s; curEnd = e;
    } else if (s <= curEnd + 1) {
      if (e > curEnd) curEnd = e;
    } else {
      days += curEnd - curStart + 1;
      curStart = s; curEnd = e;
    }
  }
  if (curStart !== null) days += curEnd - curStart + 1;

  return { days: days, periodsCounted: periodsCounted, status: 'COUNTED', problems: problems };
}

const presenceDays = (ticket.targetCountry && ticket.windowStart && ticket.windowEnd)
  ? computePresenceDays({ presencePeriods: ticket.presencePeriods, country: ticket.targetCountry, windowStart: ticket.windowStart, windowEnd: ticket.windowEnd })
  : null;

// ---- BEGIN GENERATED: statutory corpus · scripts/build-citation-corpus.mjs ----
// Generated — do not edit inside these markers. Mirrors src/knowledge/citationCorpus.js
// and the ranking in src/knowledge/lexicalIndex.js. 51 passages,
// filtered at query time to UC-08 — the index statistics must span the whole
// corpus or BM25 scores diverge from src/.
const CITATION_PASSAGES = [{"id":"D-17#0000","documentId":"D-17","heading":"The three articles the A1 question turns on","text":"The three articles the A1 question turns on\n\n> **Article 11 — General rules**\n>\n> 1. Persons to whom this Regulation applies shall be subject to the\n> legislation of **a single Member State only**. …\n>\n> 3. Subject to Articles 12 to 16: (a) **a person pursuing an activity as an\n> employed or self-employed person in a Member State shall be subject to the\n> legislation of that Member State**; …\n\n> **Article 12 — Special rules**\n>\n> 1. A person who pursues an activity as an employed person in a Member State\n> on behalf of an employer which normally carries out its activities there and\n> who is **posted** by that employer to another Member State to perform work on\n> that employer's behalf shall continue to be subject to the legislation of the\n> first Member State, **provided that the anticipated duration of such work does\n> not exceed 24 months** and that he/she **is not sent to replace another posted\n> person**.","title":"D-17 · Regulation (EC) No 883/2004 — which state's social security applies","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-07","UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02004R0883-20190731","retrievedOn":"2026-08-19","sourceSha256":"fb050b619017607446f71f799f06cba455b52ffc04a144ee7c5748b50eac233c"},{"id":"D-17#0001","documentId":"D-17","heading":"The three articles the A1 question turns on","text":"The three articles the A1 question turns on\n\n> **Article 13 — Pursuit of activities in two or more Member States**\n>\n> 1. A person who normally pursues an activity as an employed person in two or\n> more Member States shall be subject: (a) to the legislation of the Member\n> State of residence **if he/she pursues a substantial part of his/her activity\n> in that Member State**; or (b) if he/she does not … (i) to the legislation of\n> the Member State in which the registered office or place of business of the\n> undertaking or employer is situated …","title":"D-17 · Regulation (EC) No 883/2004 — which state's social security applies","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-07","UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02004R0883-20190731","retrievedOn":"2026-08-19","sourceSha256":"fb050b619017607446f71f799f06cba455b52ffc04a144ee7c5748b50eac233c"},{"id":"D-17#0002","documentId":"D-17","heading":"What this settles","text":"What this settles\n\nThe article that governs is **not** one flag. `docs/KNOWLEDGE-SOURCES.md` L1-04\nalready sorts this **SPLIT** — membership is a TABLE, *which article applies* is\nCORPUS — and the retrieved text confirms why: Article 12 turns on an\n*anticipated duration* and a *not-a-replacement* condition, Article 13 on a\n*substantial part* assessment whose meaning lives in the implementing\nregulation (D-18, Article 14(8)). Neither is a lookup.","title":"D-17 · Regulation (EC) No 883/2004 — which state's social security applies","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-07","UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02004R0883-20190731","retrievedOn":"2026-08-19","sourceSha256":"fb050b619017607446f71f799f06cba455b52ffc04a144ee7c5748b50eac233c"},{"id":"D-18#0000","documentId":"D-18","heading":"The three provisions a dossier needs","text":"The three provisions a dossier needs\n\n**What \"substantial part\" means** — Article 14(8), quoted verbatim:\n\n> For the purposes of the application of Article 13(1) and (2) of the basic\n> Regulation, a 'substantial part of employed or self-employed activity' pursued\n> in a Member State shall mean a quantitatively substantial part of all the\n> activities … **without this necessarily being the major part** of those\n> activities. To determine whether a substantial part of the activities is\n> pursued in a Member State, the following indicative criteria shall be taken\n> into account: (a) in the case of an employed activity, **the working time\n> and/or the remuneration**; … In the framework of an overall assessment, **a\n> share of less than 25 % in respect of the criteria mentioned above shall be an\n> indicator that a substantial part of the activities is not being pursued** in\n> the relevant Member State.\n\n**Who decides, and in what order** — Article 16(1)–(3), abridged and quoted:","title":"D-18 · Regulation (EC) No 987/2009 — how the A1 is actually obtained","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0987-20180101","retrievedOn":"2026-08-19","sourceSha256":"6ea2c7c9da2ebcc6d2aafe5e884ba380b01825b34c369408981290f1bb0e5dfe"},{"id":"D-18#0001","documentId":"D-18","heading":"The three provisions a dossier needs","text":"The three provisions a dossier needs\n\n> 1. A person who pursues activities in two or more Member States shall **inform\n> the institution designated by the competent authority of the Member State of\n> residence** thereof.\n> 2. The designated institution of the place of residence shall **without delay\n> determine the legislation applicable** … That initial determination shall be\n> **provisional**. …\n> 3. The provisional determination … shall become **definitive within two\n> months** of the institutions designated by the competent authorities of the\n> Member States concerned being informed of it …\n\n**What the \"A1\" legally is** — Article 19(2), quoted in full:\n\n> At the request of the person concerned or of the employer, the competent\n> institution of the Member State whose legislation is applicable pursuant to\n> Title II of the basic Regulation shall provide **an attestation that such\n> legislation is applicable** and shall indicate, where appropriate, **until\n> what date and under what conditions**.","title":"D-18 · Regulation (EC) No 987/2009 — how the A1 is actually obtained","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0987-20180101","retrievedOn":"2026-08-19","sourceSha256":"6ea2c7c9da2ebcc6d2aafe5e884ba380b01825b34c369408981290f1bb0e5dfe"},{"id":"D-18#0002","documentId":"D-18","heading":"The three provisions a dossier needs","text":"The three provisions a dossier needs\n\n**Note that neither regulation ever uses the name \"A1.\"** \"A1\" is the portable\ndocument designation given by the Administrative Commission; the legal object is\nthe Article 19(2) attestation. A dossier that says \"A1 required\" is naming a form\nrather than the instrument, which is fine for a specialist and wrong for a\ncitation.","title":"D-18 · Regulation (EC) No 987/2009 — how the A1 is actually obtained","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"European Parliament and Council of the European Union, via the Publications Office (EUR-Lex)","sourceUrl":"https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02009R0987-20180101","retrievedOn":"2026-08-19","sourceSha256":"6ea2c7c9da2ebcc6d2aafe5e884ba380b01825b34c369408981290f1bb0e5dfe"},{"id":"D-19#0000","documentId":"D-19","heading":"What this document is, in its own words — and why the tag is weaker","text":"What this document is, in its own words — and why the tag is weaker\n\n> This practical guide was prepared and agreed by the Administrative Commission\n> for the Coordination of Social Security Systems. This Guide is intended to\n> provide a working instrument to assist institutions, employers and citizens in\n> the area of determining which Member State's legislation should apply in given\n> circumstances. **It does not reflect the official position of the European\n> Commission.**\n\nSo it is agreed guidance from the Member States' own coordinating body, not law\nand not a Commission position. Where it and Regulation 883/2004 (**D-17**) or\n987/2009 (**D-18**) differ in emphasis, the regulations govern; this document's\nvalue is that it says how the administering institutions read them.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0001","documentId":"D-19","heading":"What this document is, in its own words — and why the tag is weaker","text":"What this document is, in its own words — and why the tag is weaker\n\n**Its date is itself a finding.** The Commission's live FAQ, retrieved the same\nday, links a guide last revised in **December 2013** — while its own social\nsecurity coordination hub currently advertises a *\"Revision of EU social security\ncoordination rules\"* factsheet dated **29 April 2026**. Anything taken from this\ndocument is `[CONFIRMED — as at December 2013]`, and that limitation is the\n`Source updatedAt` row doing exactly the job the manifest says it is for:\n*\"a checksum detects a re-publication; only a version date detects a re-reading.\"*","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0002","documentId":"D-19","heading":"1 · The 24-month posting limit is a ceiling with one lawful way past it","text":"1 · The 24-month posting limit is a ceiling with one lawful way past it\n\n> The Regulations provide that a posting period may not last any longer than 24\n> months. However, **Article 16 of Regulation 883/2004 permits the competent\n> authorities of two or more Member States to reach agreements providing for\n> exceptions** […] if it is known that the anticipated duration of a posting for\n> a worker will extend beyond 24 months, an Article 16 agreement **must** be\n> reached […] If a request for an extension of the posting period beyond 24\n> months is not submitted or if […] the States concerned do not make an\n> agreement […] **the legislation of the Member State where the person is\n> actually working will become applicable as soon as the posting period ended.**\n\n`a1_certificate_recommended` fires with no reference to duration (**C-6**). The\nguide adds the consequence of ignoring it, which is not \"escalate\" but a\n**change in the competent state by operation of law** on the day the posting\nends.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0003","documentId":"D-19","heading":"2 · A two-month break before a fresh posting — a rule with no analogue in the code","text":"2 · A two-month break before a fresh posting — a rule with no analogue in the code\n\n> Once a worker has ended a period of posting, **no fresh period of posting for\n> the same worker, the same undertakings and the same Member State can be\n> authorized until at least two months have elapsed** from the date of expiry of\n> the previous posting period.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0004","documentId":"D-19","heading":"3 · Holidays and sickness do not extend a posting","text":"3 · Holidays and sickness do not extend a posting\n\n> Suspension of work during the posting period, **whatever the reason (holidays,\n> illness, training at the posting undertaking etc.) does not constitute a reason\n> which would justify an extension** […] In case of sickness of 1 month a posting\n> period which was initially programmed to take 24 months **cannot be extended to\n> 25 months**.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0005","documentId":"D-19","heading":"4 · The 25 % figure, in context — and a 5 % one beside it","text":"4 · The 25 % figure, in context — and a 5 % one beside it\n\n> A '**substantial part of the activity**' pursued in a Member State means that a\n> quantitatively substantial part of all the activities of the worker is pursued\n> there, **without this necessarily being the major part** […] If in the context\n> of carrying out an **overall assessment** it emerges that at least **25 %** of\n> the person's working time is carried out in the Member State of residence\n> and/or at least 25 % of the person's remuneration is earned there **this shall\n> be an indicator** […] **this is not an exhaustive list and other criteria may\n> also be taken into account.**\n\n> **Marginal activities** are activities that are permanent but insignificant in\n> terms of time and economic return. **It is suggested that, as an indicator,\n> activities accounting for less than 5 %** of the worker's regular working time\n> and/or less than 5 % of his/her overall remuneration should be regarded as\n> marginal activities. Also the nature of the activities, such as activities that\n> are of a supporting nature, that lack independence, **that are performed from\n> home** or in the service of the main activity, can be an indicator that they\n> concern marginal activities.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0006","documentId":"D-19","heading":"4 · The 25 % figure, in context — and a 5 % one beside it","text":"4 · The 25 % figure, in context — and a 5 % one beside it\n\n> In addition to the above criteria […] **the assumed future situation in the\n> following 12 calendar months must also be taken into account.** However, past\n> performance is also a reliable measure of future behaviour […]\n\nThree things follow, and only the first was already known:","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-19#0007","documentId":"D-19","heading":"Not extracted, deliberately","text":"Not extracted, deliberately\n\nThe guide's Part II worked examples are extensive and specific to named Member\nState pairs that are not in the NL/PT/CA/US demo set. They are in the committed\nPDF; nothing here paraphrases them.","title":"D-19 · EU — Practical Guide on the applicable legislation in the EU, the EEA and Switzerland","countries":["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Prepared and agreed by the Administrative Commission for the Coordination of Social Security Systems; published by the European Commission, DG Employment, Social Affairs and Inclusion","sourceUrl":"https://ec.europa.eu/social/BlobServlet?docId=11366&langId=en","retrievedOn":"2026-08-19","sourceSha256":"ad237a4ce2e25c71e8c7e8718f806832df730f704fd6cf4f20efdce92d317f6a"},{"id":"D-20#0000","documentId":"D-20","heading":"The three demo pairs, read from the status table","text":"The three demo pairs, read from the status table\n\n| Country | Agreement | Date of signing | **Effective date** | Legal citation |\n|---|---|---|---|---|\n| **Canada** | Agreement with Respect to Social Security | March 11, 1981 | **Aug. 1, 1984** | TIAS 10863 |\n| **Netherlands** | Agreement on Social Security | Dec. 8, 1987 | **Nov. 1, 1990** | TIAS 03-501 |\n| **Portugal** | Agreement on Social Security | March 30, 1988 | **Aug. 1, 1989** | TIAS 12121 |\n\nAll three of **US↔CA, US↔NL and US↔PT are in force.** Each also carries an\nAdministrative Arrangement at the same effective date; the Netherlands row\ncarries two further Protocols (Dec. 7, 1989 → Nov. 1, 1990; Aug. 30, 2001 →\nMay 1, 2003), which is why \"does an agreement exist\" and \"which text governs\"\nare different questions.\n\nThe full table is in the committed bytes. It is not transcribed here, because a\ntranscription is a second copy that goes stale on its own schedule.","title":"D-20 · SSA — status of US totalization agreements, and the detached-worker rule","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"administrative","feeds":["UC-07","UC-08"],"publisher":"U.S. Social Security Administration, Office of International Programs","sourceUrl":"https://www.ssa.gov/international/status.html","retrievedOn":"2026-08-19","sourceSha256":"369a0265dc920920f6b8f31884255f7b98d780ccac93448f50ee92c87e1f6809"},{"id":"D-20#0001","documentId":"D-20","heading":"The rule that turns coverage into an answer","text":"The rule that turns coverage into an answer\n\nQuoted verbatim from the overview page:\n\n> **Territoriality Rule.** … Under this basic \"territoriality\" rule, an employee\n> who would otherwise be covered by both the U.S. and a foreign system remains\n> subject exclusively to the coverage laws of the country in which he or she is\n> working.\n>\n> **Detached-worker Rule.** Each agreement (except the one with Italy) includes\n> an exception to the territoriality rule … Under this \"detached-worker\"\n> exception, a person who is temporarily transferred to work for the same\n> employer in another country **remains covered only by the country from which\n> he or she has been sent.** … The detached-worker rule in U.S. agreements\n> generally applies to employees whose assignments in the host country are\n> **expected to last 5 years or less**. The 5-year limit on exemptions for\n> detached workers is substantially longer than the limit normally provided in\n> the agreements of other countries.","title":"D-20 · SSA — status of US totalization agreements, and the detached-worker rule","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"administrative","feeds":["UC-07","UC-08"],"publisher":"U.S. Social Security Administration, Office of International Programs","sourceUrl":"https://www.ssa.gov/international/status.html","retrievedOn":"2026-08-19","sourceSha256":"369a0265dc920920f6b8f31884255f7b98d780ccac93448f50ee92c87e1f6809"},{"id":"D-20#0002","documentId":"D-20","heading":"What this settles","text":"What this settles\n\n`docs/use-cases/UC-04.md` §3 has carried ssa.gov as a\n`[PROPOSED — build-time task]` since UC-04 was written. It is now\n`[CONFIRMED]`. Concretely: `NON_TREATY_PAIRS` produces **no finding** for\n`NL_US`, `PT_US` or `CA_US` today, and the code is explicit that absence\nmeans \"we have not looked.\" For these three pairs we have now looked, and the\nanswer is *covered, with a named agreement, effective date and citation.*\n\n**Do not let this list stand in for D-21/D-22/D-23, or the reverse.** SSA\npublishes **US** agreements; Canada publishes **Canadian** ones. The retrieved\ndata makes the point concrete: SSA gives US–Portugal an effective date of\n**1989-08-01**; the CRA gives Canada–Portugal **1981-05-01**. Two networks, two\nauthorities, two tables.","title":"D-20 · SSA — status of US totalization agreements, and the detached-worker rule","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"administrative","feeds":["UC-07","UC-08"],"publisher":"U.S. Social Security Administration, Office of International Programs","sourceUrl":"https://www.ssa.gov/international/status.html","retrievedOn":"2026-08-19","sourceSha256":"369a0265dc920920f6b8f31884255f7b98d780ccac93448f50ee92c87e1f6809"},{"id":"D-21+D-22+D-23#0000","documentId":"D-21+D-22+D-23","heading":"The three rows that matter, extracted from the CRA's own table","text":"The three rows that matter, extracted from the CRA's own table\n\nThe table has **61 country rows** and four columns: *Country · Effective date ·\nForm number · Maximum period of initial detachment*. Only the rows this\nrepository's demo set reaches are extracted here; the rest stays at the URL.\n\n| Country | Effective date | Certificate form | **Maximum period of initial detachment** |\n|---|---|---|---|\n| **Netherlands** | October 1, 1990 | **CPT63** | **60 months** |\n| **Portugal** | May 1, 1981 | **CPT55** | **24 months** |\n| **United States** | August 1, 1984 | **CPT56** | **60 months** |","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0001","documentId":"D-21+D-22+D-23","heading":"Why the CRA table and the SSA table are not interchangeable","text":"Why the CRA table and the SSA table are not interchangeable\n\nThe manifest warned about this; the retrieved data makes it concrete.\n\n| Pair | Authority | Effective date |\n|---|---|---|\n| **US**–Portugal | SSA (D-20) | **1989-08-01** |\n| **Canada**–Portugal | CRA (D-21) | **1981-05-01** |\n\nTwo separate bilateral networks, two publishing authorities, two tables, two\nsets of dates and two certificate regimes. \"Portugal has a totalization\nagreement\" is not a fact about Portugal; it is a fact about a **pair**.","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0002","documentId":"D-21+D-22+D-23","heading":"What this closes for src/uc04/","text":"What this closes for src/uc04/\n\n`docs/knowledge/DOWNLOAD-MANIFEST.md` §7 records that `NL_CA`, `PT_CA`, `NL_US`\nand `PT_US` appear in **neither** `EU_EEA_FOR_A1` **nor** `NON_TREATY_PAIRS`, so\nneither branch fires and those trips produce **no social-security finding of any\nkind** — a silence that reads to a specialist as \"nothing to consider.\"\n\nFor the two Canadian pairs, the answer is now: **covered**, by a named\nagreement, with an effective date, a certificate form and a maximum initial\ndetachment. CPT63 and CPT55 are the exact Canadian analogues of the EU's A1\nattestation (D-18 art. 19(2)) — and, as the table shows, they are **not\ninterchangeable with each other**.\n\n---\n\n# D-22 and D-23 · the agreement **texts**, retrieved 2026-08-19","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0003","documentId":"D-21+D-22+D-23","heading":"What this closes for src/uc04/","text":"What this closes for src/uc04/\n\n> **This supersedes the \"What was not retrieved\" note that closed the previous\n> version of this file.** `www.treaty-accord.gc.ca` was added to the container's\n> allowlist and the three instruments below were read from Global Affairs\n> Canada's own treaty register. Everything above — the CRA administrative table —\n> is unchanged and still accurate as a description of what the CRA publishes.\n> **The point of this section is that the CRA's Netherlands row and the\n> agreements do not agree.**","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0004","documentId":"D-21+D-22+D-23","heading":"What this closes for src/uc04/","text":"What this closes for src/uc04/\n\n| | |\n|---|---|\n| **Catalogue id** | D-22 (Canada–Netherlands), D-23 (Canada–Portugal) |\n| **Source name** | **E102196** *Agreement on Social Security Between Canada and the Kingdom of the Netherlands*, CTS **1990 No. 14** · **E102195** *Supplementary Agreement Amending* the same, CTS 1990 No. 14 · **E104279** *Agreement on Social Security Between the Government of Canada and the Government of the Kingdom of the Netherlands*, CTS **2004/6** · **E102185** *Agreement between Canada and Portugal with respect to Social Security*, CTS **1981/15** |\n| **Publisher / authority** | **Global Affairs Canada**, Canada Treaty Information (Treaty Law Division) |\n| **Exact URL** | <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102196> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102195> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=104279> · <https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=102185> (details pages at `details.aspx?lang=eng&id=<same id>`) |\n| **Retrieved** | **2026-08-19**, by `curl` with a full browser header set. HTTP 200 for all four: 41,352 / 13,696 / 54,164 / 43,844 bytes. |\n| **SHA-256 of the retrieved bytes** | `b5bf116f60bc11a0447ac259947b097d8a56ccbfe3a3387e9eafd74c67c67f29` (102196) · `01d8d5d5a6a00ce8c47650363969cfeff948a33dc4314e1c3787b2c6bf4362ce` (102195) · `8ea8d1000d11106fe9f13d496ee63afce4b376b262c2bc1d86d35822a97236e0` (102185) · `65ff7ad317368c23ba9237b3dffb3713d7f40577b2f530ea4071ff9c0ca328e8` (104279) |\n| **Source `updatedAt`** | Each register entry prints its own signature and entry-into-force dates, quoted below. The site's home page prints *\"Date modified: 2019-03-01\"*. |\n| **Licence / basis for inclusion** | **Cite and extract only — no bytes.** `treaty-accord.gc.ca` links the same canada.ca terms of use as the CRA pages above (<https://www.canada.ca/en/transparency/terms.html>), which permit **non-commercial** reproduction only. Unchanged from the licence reasoning already recorded in this file. |\n| **Evidence tag** | `[CONFIRMED — treaty text, retrieved 2026-08-19]` |","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0005","documentId":"D-21+D-22+D-23","heading":"The finding: there are two Canada–Netherlands agreements, and the CRA's row mixes them","text":"The finding: there are two Canada–Netherlands agreements, and the CRA's row mixes them\n\n| Instrument | Signed | In force | Posting maximum, in the text |\n|---|---|---|---|\n| **E102196** + **E102195** — the 1987 agreement as amended in 1989 | The Hague, 1987-02-26 (supplement: Ottawa, 1989-07-26) | **1990-10-01** | Article VI(2): *\"provided that such assignment does not exceed **twenty-four months**\"* |\n| **E104279** — a new agreement | Brantford, **2001-06-27** | **2004-04-01** | Article VI(2): *\"provided that such assignment does not exceed **sixty months**\"* |\n\nThe 2004 agreement defines *\"previous Agreement\"* as the 1987 one *\"as amended\nby the Supplementary Agreement … signed at Ottawa on 26 July 1989\"*, and carries\nan express transition:","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL"],"pairs":[["CA","NL"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0006","documentId":"D-21+D-22+D-23","heading":"The finding: there are two Canada–Netherlands agreements, and the CRA's row mixes them","text":"The finding: there are two Canada–Netherlands agreements, and the CRA's row mixes them\n\n> In the application of this paragraph in regard to a person who, on the date of\n> entry into force of this Agreement, is already on assignment in the territory\n> of the other Party and subject to the legislation of the former Party by virtue\n> of **Article VI(2) of the previous Agreement**, the reference to **sixty\n> months** in sub-paragraph (a) shall be read to refer to the total period during\n> which that person may remain subject only to the legislation of the former\n> Party […] inclusive of the period already completed before the entry into force\n> of this Agreement […]\n\nThe **Supplementary Agreement (E102195) does not touch Article VI at all** — it\nreplaces Article X(3)(a) and Article XIV(2) and (3), on Old Age Security payment\nabroad and on pre-1957 Netherlands creditable periods. It was read in full to\nestablish that, because \"an amending instrument exists\" is not the same fact as\n\"the amending instrument changed this article.\"","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL"],"pairs":[["CA","NL"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0007","documentId":"D-21+D-22+D-23","heading":"Canada–Portugal: the text agrees with the CRA, and adds the mechanism","text":"Canada–Portugal: the text agrees with the CRA, and adds the mechanism\n\nThere is exactly **one** Canada–Portugal social security agreement in the\nregister (E102185, CTS 1981/15, signed Toronto 1980-12-15, in force\n**1981-05-01** — the CRA's date exactly). Its posting article:\n\n> **Article VII**\n>\n> **1** — Where […] a worker […] who is subject to the legislation of a Party and\n> employed by an employer having his place of business in the territory of that\n> Party, is assigned by that employer to work in the territory of the other\n> Party, the legislation of the first Party shall continue to apply to him in\n> respect of that work relationship **for a period of up to 24 months**.\n>\n> **3** — **The prior consent of the competent authorities of both Parties**, or\n> of the authorities whom they have delegated for that purpose, **is required for\n> any extension** of the application of the legislation of the first Party […]\n> **when the assignment extends beyond 24 months.**\n\nThat last paragraph is the Canadian analogue of the EU's Article 16 agreement\n(**D-19**): the maximum is a ceiling with a named, bilateral way past it, not a\ncliff. The repository has no representation of either.","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","PT"],"pairs":[["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0008","documentId":"D-21+D-22+D-23","heading":"What this does to C-8 and C-9","text":"What this does to C-8 and C-9\n\nThe C-8 table read *\"Canada → Netherlands: 60 months\"* and *\"Canada → Portugal:\n24 months\"* on the CRA's authority, and C-9 used that pair as its example of a\nmaximum varying **per pair within one network**. The conclusion survives and its\nevidence is now stronger and differently shaped: the maximum varies per pair\n**and per vintage of the agreement**, so a table keyed `(pair → months)` is still\nunder-specified. The honest key is\n`(pair, instrument, in-force date → maximum, extension mechanism)`.\n\n**And the general lesson is the one this corpus keeps paying for.** The CRA table\nis the administering agency's own record, it was retrieved from the authority, it\nwas not a mirror, and it is still wrong in one cell. *\"Get it from the body that\nhas a reason to maintain it\"* is a much better rule than the alternatives and it\nis not a guarantee. Only reading the instrument caught this.","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-21+D-22+D-23#0009","documentId":"D-21+D-22+D-23","heading":"A retrieval note worth keeping: the register's search is down","text":"A retrieval note worth keeping: the register's search is down\n\n`www.treaty-accord.gc.ca` is reachable and serves `index.aspx`, the first page of\n`result-resultat.aspx` (50 of *\"4425 Treaties found\"*), `details.aspx?id=<n>` and\n`text-texte.aspx?id=<n>`. **Every POST fails with an IIS `500`** — the search\nform, and the *\"Show More Treaties\"* pagination button alike. The site says so\nitself, in a message its own markup carries but does not display: *\"The data you\nare trying to access is not currently available. Please try again later.\"* So the\nthree instruments were located by enumerating `details.aspx?id=` over the id range\nthe register occupies (~101,000–105,845) and reading the titles.\n\n**That enumeration is the reason the 2004 agreement was found at all.** A search\nfor \"Canada Netherlands social security\" would have returned the agreement the\nCRA's date points at; walking the register returned all three, and the third is\nthe one that mattered. Filed under classification **E** in\n[`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md) §1 — *the host answers, the\ndocument is there, and the site's own index cannot reach it.*","title":"D-21 / D-22 / D-23 · Canada's social security agreement network, and the NL and PT cells","countries":["CA","NL","PT"],"pairs":[["CA","NL"],["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Canada Revenue Agency (CPP/EI Rulings)","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/canada-pension-plan-cpp-employment-insurance-ei-rulings/international-social-security-agreements-canada-pension-plan.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-24#0000","documentId":"D-24","heading":"Article 15(2) — the employment-income condition, quoted from the English text","text":"Article 15(2) — the employment-income condition, quoted from the English text\n\n> Notwithstanding the provisions of paragraph 1, remuneration derived by a\n> resident of a Contracting State in respect of an employment exercised in the\n> other Contracting State shall be taxable only in the first-mentioned State if:\n>\n> a) the recipient is present in the other State for a period or periods not\n> exceeding in the aggregate **183 days in any twelve month period commencing or\n> ending in the fiscal year concerned**, and\n>\n> b) the remuneration is paid by, or on behalf of, an employer who is **not a\n> resident of the other State**, and\n>\n> c) the remuneration is **not borne by a permanent establishment or a fixed\n> base** which the employer has in the other State.","title":"D-24 · Netherlands–Portugal double taxation convention","countries":["NL","PT"],"pairs":[["NL","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Ministerie van Buitenlandse Zaken, via Verdragenbank and wetten.overheid.nl (Overheid.nl)","sourceUrl":"https://verdragenbank.overheid.nl/en/Treaty/Details/009217","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-25#0000","documentId":"D-25","heading":"Article 15(2) — quoted","text":"Article 15(2) — quoted\n\n> a) the recipient is present in the other State for a period or periods not\n> exceeding in the aggregate **183 days in any twelve month period commencing or\n> ending in the calendar year concerned**, and\n>\n> b) the remuneration is paid by, or on behalf of, an employer who is **not a\n> resident of the other State**, and\n>\n> c) the remuneration is **not borne by a permanent establishment or a fixed\n> base** which the employer has in the other State.","title":"D-25 · Canada–Netherlands income tax convention","countries":["CA","NL"],"pairs":[["CA","NL"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Department of Finance Canada","sourceUrl":"https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/netherlands-convention-consolidated-1986-1993-1997.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-25#0001","documentId":"D-25","heading":"What this settles","text":"What this settles\n\n> **Canada–Portugal (D-26) was not retrieved.** The Finance Canada index does\n> **not** host that text: its Portugal entry reads *\"The Convention between\n> Canada and the Portuguese Republic, as signed on June 14, 1999 **(GAC web\n> site)**\"*, pointing at `treaty-accord.gc.ca`, which this container's egress\n> policy refuses. The **signature date, 1999-06-14, is confirmed** from Finance\n> Canada; the text is not. See [`RETRIEVAL-BLOCKED.md`](RETRIEVAL-BLOCKED.md).","title":"D-25 · Canada–Netherlands income tax convention","countries":["CA","NL"],"pairs":[["CA","NL"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Department of Finance Canada","sourceUrl":"https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/netherlands-convention-consolidated-1986-1993-1997.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-26#0000","documentId":"D-26","heading":"Article 15(2) — the sixth formulation of the same test","text":"Article 15(2) — the sixth formulation of the same test\n\n> **2.** Notwithstanding the provisions of paragraph 1, remuneration derived by a\n> resident of a Contracting State in respect of an employment exercised in the\n> other Contracting State shall be taxable **only in the first-mentioned State\n> if**:\n>\n> **(a)** the recipient is present in the other State for a period or periods not\n> exceeding in the aggregate **183 days in any twelve month period commencing or\n> ending in the calendar year concerned**, **and**\n>\n> **(b)** the remuneration is paid by, or on behalf of, an employer **who is not\n> a resident** of the other State, **and**\n>\n> **(c)** the remuneration is **not borne by a permanent establishment** or a\n> fixed base which the employer has in the other State.","title":"D-26 · Canada–Portugal income tax convention","countries":["CA","PT"],"pairs":[["CA","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Global Affairs Canada, Canada Treaty Information (Treaty Law Division)","sourceUrl":"https://www.treaty-accord.gc.ca/text-texte.aspx?lang=eng&id=103231","retrievedOn":"2026-08-19","sourceSha256":"53a5c0625c815c5fb4f9c8d57d66f638a336ee4308c2451d3cb8d73a11a81af9"},{"id":"D-27+D-28+D-29#0000","documentId":"D-27+D-28+D-29","heading":"The instruments, and which article carries employment income","text":"The instruments, and which article carries employment income\n\n| Pair | Instrument as published | Employment-income article |\n|---|---|---|\n| US–NL (D-27) | Convention … together with a Protocol, plus later protocols and technical explanations linked from the country page | **Article 16 — Dependent Personal Services** |\n| US–PT (D-28) | Convention … together with a related Protocol. The PDF's own header: *\"GENERAL EFFECTIVE DATE UNDER ARTICLE 30: 1 JANUARY 1996\"* | **Article 16 — Dependent Personal Services** |\n| US–CA (D-29) | Convention with respect to taxes on income and on capital, with protocols | **Article XV — Dependent Personal Services** |","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-27+D-28+D-29#0001","documentId":"D-27+D-28+D-29","heading":"The 183-day condition, quoted from each text","text":"The 183-day condition, quoted from each text\n\n> **Each convention is a `###` of its own, and that is a retrieval decision\n> rather than a formatting one (2026-08-30).** These three quotes used to sit\n> under this one heading as bold labels. The corpus chunker splits on headings\n> and then on paragraph boundaries when a section runs long, so this section\n> came out as two passages: the first led with the **Netherlands** text and the\n> second opened with an unattributed `> …` — the `US–Portugal` label had fallen\n> on the chunk boundary. A specialist reading a US/PT dossier in the ZAF sidebar\n> was therefore shown the Netherlands convention, and the Portuguese one with no\n> country on it. Not one word of quoted treaty text is changed by this edit; the\n> SHA-256s above are of the retrieved PDFs and are unaffected.","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-27+D-28+D-29#0002","documentId":"D-27+D-28+D-29","heading":"US–Netherlands, Article 16(2)","text":"US–Netherlands, Article 16(2)\n\n> … remuneration derived by a resident of one of the States in respect of an\n> employment exercised in the other State shall be taxable only in the\n> first-mentioned State if (a) the recipient is present in the other State for a\n> period or periods not exceeding in the aggregate **183 days in the taxable\n> year concerned**; (b) the remuneration is paid by, or on behalf of, an\n> employer who is **not a resident of the other State**; and (c) the\n> remuneration is **not borne by a permanent establishment or a fixed base**\n> which the employer has in the other State.","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","NL"],"pairs":[["US","NL"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-27+D-28+D-29#0003","documentId":"D-27+D-28+D-29","heading":"US–Portugal, Article 16(2)","text":"US–Portugal, Article 16(2)\n\n> … (a) the recipient is present in the other State for a period or periods not\n> exceeding in the aggregate **183 days in any 12-month period commencing or\n> ending in the taxable year concerned**; and (b) … not a resident of the other\n> State; and (c) … not borne by a permanent establishment or a fixed base …","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","PT"],"pairs":[["US","PT"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-27+D-28+D-29#0004","documentId":"D-27+D-28+D-29","heading":"US–Canada, Article XV(2)","text":"US–Canada, Article XV(2)\n\n> … remuneration derived by a resident of a Contracting State in respect of an\n> employment exercised **in a calendar year** in the other Contracting State\n> shall be taxable only in the first-mentioned State if: (a) Such remuneration\n> does **not exceed ten thousand dollars (0,000)** in the currency of that\n> other State; **or** (b) The recipient is present in the other Contracting\n> State for a period or periods not exceeding in the aggregate **183 days in\n> that year** and the remuneration is not borne by an employer who is a resident\n> of that other State or by a permanent establishment or a fixed base which the\n> employer has in that other State.","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","CA"],"pairs":[["US","CA"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-27+D-28+D-29#0005","documentId":"D-27+D-28+D-29","heading":"What this settles, and the two things it breaks","text":"What this settles, and the two things it breaks\n\n- **C-10** — the three treaties use **three different 183-day windows**, none of\n  which is the repository's trailing 365 days from the trip start.\n- **C-11** — the treaty 183-day test is **one of three cumulative conditions**,\n  and for an Employer-of-Record arrangement the other two are the ones that\n  usually fail. A day count on its own does not answer the question the code\n  renders it as answering.\n\n> **⚠ Reading note carried forward from the manifest, and now confirmed by the\n> texts.** These conventions are *based on* the OECD Model and their article\n> numbering is nearly identical to it. Quoting the bilateral text is free;\n> quoting the OECD Model or its Commentaries is not (licence class (d)). The\n> quotations above are all from the IRS-published bilateral texts.","title":"D-27 / D-28 / D-29 · The three US income tax conventions — the only quotable treaty texts here","countries":["US","NL","PT","CA"],"pairs":[["US","NL"],["US","PT"],["US","CA"]],"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service, publishing texts of conventions concluded by the U.S. Department of the Treasury","sourceUrl":"https://www.irs.gov/businesses/international-businesses/netherlands-tax-treaty-documents","retrievedOn":"2026-08-19","sourceSha256":"337c5b3ee9da65ddc5a2ee9fc988553f716b92f6898370bb0da8f602c99e75ad"},{"id":"D-31#0000","documentId":"D-31","heading":"The provision, quoted in full","text":"The provision, quoted in full\n\n> **Artikel 4**\n>\n> **1** Waar iemand woont en waar een lichaam gevestigd is, wordt **naar de\n> omstandigheden beoordeeld**.\n>\n> **2** Voor de toepassing van het eerste lid worden schepen en luchtvaartuigen\n> welke in Nederland hun thuishaven hebben, ten opzichte van de bemanning als\n> deel van Nederland beschouwd.\n\n*Working translation, a reading aid and not a source: where a person resides is\n**assessed according to the circumstances**.*","title":"D-31 · Netherlands — where a person is resident for tax, AWR art. 4","countries":["NL"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Ministerie van Financiën / Ministerie van Justitie en Veiligheid, via Overheid.nl / wetten.overheid.nl","sourceUrl":"https://wetten.overheid.nl/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken","retrievedOn":"2026-08-19","sourceSha256":"f51eeeb0ce6e6d17d2eb514acaef05197073dadc111ad25beed8250ee317a257"},{"id":"D-31#0001","documentId":"D-31","heading":"Why this is the entry most likely to change someone's mind","text":"Why this is the entry most likely to change someone's mind\n\n**The Dutch domestic rule contains no day count at all.** Article 4(1) is eleven\nwords and they direct that residence be judged on the circumstances. There is no\nthreshold to be near, so there is no headroom to have. For a Dutch destination\nthe system currently prints a precise number of days remaining against a line\nthat does not exist — which is not an off-by-a-few-days error, it is an answer\nto a different question, delivered in the format of an answer to this one.\n\nThat is the shape `docs/KNOWLEDGE-SOURCES.md` Test B names: a well-formed number\nrendered beside a citation, which nothing downstream can contradict.","title":"D-31 · Netherlands — where a person is resident for tax, AWR art. 4","countries":["NL"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Ministerie van Financiën / Ministerie van Justitie en Veiligheid, via Overheid.nl / wetten.overheid.nl","sourceUrl":"https://wetten.overheid.nl/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken","retrievedOn":"2026-08-19","sourceSha256":"f51eeeb0ce6e6d17d2eb514acaef05197073dadc111ad25beed8250ee317a257"},{"id":"D-31#0002","documentId":"D-31","heading":"Postscript — the licence, resolved 2026-08-19","text":"Postscript — the licence, resolved 2026-08-19\n\nThe header row above records the answer; this note records why it matters. The\nprevious pass wrote *\"no bytes committed\"* and gave the reason honestly: the\nsite's own reuse terms lived on a host our egress refused, so half the licence\nbasis was unread and the safe default applied. That was the right call on the\ninformation available.\n\nWhat the allowlist opening actually produced was **not** the missing terms page.\n`https://www.overheid.nl/copyright` answers **HTTP 410 Gone** (with a body that\nreads \"404 Pagina niet gevonden\"), and the surviving *Informatie hergebruiken*\npage is about the SRU search API. Overheid.nl no longer publishes a copyright\nstatement. Had the search stopped there, the conservative default would still\nhave applied — for a **better** reason than before, but the same answer.\n\nThe answer came from a different authority publishing the same corpus: KOOP's own\nentry for the **Basis Wetten Bestand** in the Dutch national open-data register,\nwhich states **CC0 1.0**. Worth keeping as a method note: *the licence for a\ndocument is not always stated where the document is served.*","title":"D-31 · Netherlands — where a person is resident for tax, AWR art. 4","countries":["NL"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Ministerie van Financiën / Ministerie van Justitie en Veiligheid, via Overheid.nl / wetten.overheid.nl","sourceUrl":"https://wetten.overheid.nl/BWBR0002320/2026-04-11/0/HoofdstukI/Artikel4/afdrukken","retrievedOn":"2026-08-19","sourceSha256":"f51eeeb0ce6e6d17d2eb514acaef05197073dadc111ad25beed8250ee317a257"},{"id":"D-32#0000","documentId":"D-32","heading":"Article 16.º, ¶¶ 1–5 — the operative provisions, quoted","text":"Article 16.º, ¶¶ 1–5 — the operative provisions, quoted\n\n> **1** — São residentes em território português as pessoas que, no ano a que\n> respeitam os rendimentos:\n> **a)** Hajam nele permanecido **mais de 183 dias, seguidos ou interpolados, em\n> qualquer período de 12 meses com início ou fim no ano em causa**;\n> **b)** Tendo permanecido **por menos tempo**, aí disponham, num qualquer dia do\n> período referido na alínea anterior, de **habitação em condições que façam\n> supor intenção atual de a manter e ocupar como residência habitual**;\n> **c)** Em 31 de dezembro, sejam tripulantes de navios ou aeronaves […];\n> **d)** Desempenhem no estrangeiro funções ou comissões de carácter público, ao\n> serviço do Estado Português.\n>\n> **2** — Para efeitos do disposto no número anterior, considera-se como **dia de\n> presença** em território português **qualquer dia, completo ou parcial, que\n> inclua dormida no mesmo**.\n>\n> **3** — As pessoas que preencham as condições previstas nas alíneas *a)* ou\n> *b)* do n.º 1 tornam-se residentes **desde o primeiro dia do período de\n> permanência** em território português, salvo quando tenham aí sido residentes\n> em qualquer dia do ano anterior, caso em que se consideram residentes **desde o\n> primeiro dia do ano** […]\n>\n> **4** — A perda da qualidade de residente ocorre a partir do **último dia de\n> permanência** […]\n>\n> **5** — A residência fiscal é aferida **em relação a cada sujeito passivo do\n> agregado**.","title":"D-32 · Portugal — fiscal residence, CIRS art. 16.º","countries":["PT"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Autoridade Tributária e Aduaneira (AT), Portal das Finanças","sourceUrl":"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx","retrievedOn":"2026-08-19","sourceSha256":"a06b333ef079eb42a41ad0cdd480fa73eebd303e68bfd33622b21fe7350131dd"},{"id":"D-32#0001","documentId":"D-32","heading":"Article 16.º, ¶¶ 1–5 — the operative provisions, quoted","text":"Article 16.º, ¶¶ 1–5 — the operative provisions, quoted\n\nParagraphs 14–16 add a whole-year rule in the year of departure where the person\nboth spent more than 183 days in Portugal that year **and** afterwards earned\nincome that would have been taxable had they stayed, subject to a\ncomparable-taxation carve-out in ¶15.","title":"D-32 · Portugal — fiscal residence, CIRS art. 16.º","countries":["PT"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Autoridade Tributária e Aduaneira (AT), Portal das Finanças","sourceUrl":"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx","retrievedOn":"2026-08-19","sourceSha256":"a06b333ef079eb42a41ad0cdd480fa73eebd303e68bfd33622b21fe7350131dd"},{"id":"D-32#0002","documentId":"D-32","heading":"What this closes, and what it opens","text":"What this closes, and what it opens\n\n- **There is a 183-day line**, so unlike the Netherlands the number is not\n  fictitious — but its window is *\"any 12-month period beginning or ending in\n  the year concerned\"*, which is anchored on the **tax year**, not on a trip.\n  `RESIDENCY_WINDOW_DAYS = 365` counted back from a trip start is a different\n  computation that can be wrong in either direction.\n- **A day is counted only if it includes an overnight stay** (¶2), and it is\n  counted whether complete or partial. `computePresenceDays()` counts date\n  ranges. A same-day trip in and out is zero days in Portugal and one day to the\n  code; conversely a partial arrival day with a night in Portugal is a **whole**\n  day.\n- **¶1(b) makes residence reachable with fewer days and no count at all** — a\n  dwelling held in conditions suggesting an intent to keep it as a habitual\n  residence. So \"N days of headroom below 183\" is not a safe statement even\n  where the 183 line exists. It is the *Dutch* problem (**C-12**) hiding inside\n  a country that does have a threshold.\n- **¶3 back-dates residence to the first day of the stay**, and to 1 January if\n  the person was resident on any day of the previous year. Canada's s. 250(1)(a)\n  also back-dates, to 1 January of the taxation year — **two retroactivity rules\n  with different anchors**, and the repo has neither.\n- **¶5 assesses residence per taxpayer, not per household** — worth recording\n  because a dossier that reasons about \"the family\" would be reasoning about the\n  wrong unit.\n\nRecorded as **C-12** (rewritten to a complete four-country table) and **C-21**\n(the day-counting convention).","title":"D-32 · Portugal — fiscal residence, CIRS art. 16.º","countries":["PT"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Autoridade Tributária e Aduaneira (AT), Portal das Finanças","sourceUrl":"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs16.aspx","retrievedOn":"2026-08-19","sourceSha256":"a06b333ef079eb42a41ad0cdd480fa73eebd303e68bfd33622b21fe7350131dd"},{"id":"D-33#0000","documentId":"D-33","heading":"The provision","text":"The provision\n\n> **250 (1)** For the purposes of this Act, a person shall, subject to\n> subsection 250(2), be deemed to have been resident in Canada **throughout a\n> taxation year** if the person (a) **sojourned in Canada in the year for a\n> period of, or periods the total of which is, 183 days or more**; …","title":"D-33 · Canada — deemed residence by sojourn, Income Tax Act s. 250","countries":["CA"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Department of Justice Canada, Justice Laws Website","sourceUrl":"https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-250.html","retrievedOn":"2026-08-19","sourceSha256":"8251af5b7e5716a7aa6dcab4b8eece87128db59dce80583f4de4d322207e0acd"},{"id":"D-33#0001","documentId":"D-33","heading":"What this settles","text":"What this settles\n\nCanada is the **one** demo country in which a 183-day figure genuinely appears\nin domestic law — and the window it is measured over is a **taxation year**,\nnot a rolling 365 days from a trip start. Those two windows give different\nanswers for the same travel, and the gap is widest for exactly the split-year\ntrips a workation produces.\n\nTwo further features of the text that a day-count gate cannot represent:\n\n- The consequence is **deemed residence throughout the whole year**, not\n  residence from the 183rd day. Crossing the line is retroactive to 1 January.\n- The word is **\"sojourned\"**, not \"was present\". s. 250(1)(a) is a deeming rule\n  layered on top of common-law factual residence, not a replacement for it — the\n  CRA's administrative view of the latter is D-34, and it is a\n  facts-and-circumstances analysis that must never reach a conditional.","title":"D-33 · Canada — deemed residence by sojourn, Income Tax Act s. 250","countries":["CA"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Department of Justice Canada, Justice Laws Website","sourceUrl":"https://laws-lois.justice.gc.ca/eng/acts/I-3.3/section-250.html","retrievedOn":"2026-08-19","sourceSha256":"8251af5b7e5716a7aa6dcab4b8eece87128db59dce80583f4de4d322207e0acd"},{"id":"D-34#0000","documentId":"D-34","heading":"Corpus, deliberately — and this is the file that proves the rule","text":"Corpus, deliberately — and this is the file that proves the rule\n\nThis document exists in the catalogue as the Canadian instance of the trap\n`docs/KNOWLEDGE-SOURCES.md` §1 names as the most tempting in the whole domain:\n**a residence analysis that looks like a grid and is a facts-and-circumstances\njudgement.**\n\nRead what it actually says, quoted:","title":"D-34 · Canada — the administrative view of residence, CRA Folio S5-F1-C1","countries":["CA"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Canada Revenue Agency","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-34#0001","documentId":"D-34","heading":"Corpus, deliberately — and this is the file that proves the rule","text":"Corpus, deliberately — and this is the file that proves the rule\n\n> **1.8** To determine residence status, **all of the relevant facts in each\n> case must be considered**, including residential ties with Canada and length\n> of time, object, intention and continuity with respect to stays in Canada and\n> abroad.\n>\n> **1.10** The most important factor … is whether the individual **maintains\n> residential ties** with Canada while abroad. While the residence status of an\n> individual **can only be determined on a case by case basis** after taking\n> into consideration all of the relevant facts, generally, unless an individual\n> severs all significant residential ties with Canada upon leaving Canada, the\n> individual will continue to be a factual resident of Canada …\n>\n> **1.14** Generally, **secondary residential ties must be looked at\n> collectively** in order to evaluate the significance of any one such tie. For\n> this reason, **it would be unusual for a single secondary residential tie …\n> to be sufficient on its own** …","title":"D-34 · Canada — the administrative view of residence, CRA Folio S5-F1-C1","countries":["CA"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Canada Revenue Agency","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-34#0002","documentId":"D-34","heading":"Corpus, deliberately — and this is the file that proves the rule","text":"Corpus, deliberately — and this is the file that proves the rule\n\nThe folio then enumerates significant ties, secondary ties and \"other\" ties.\nThat enumeration is exactly what a lookup table would be built out of — and\n¶1.14 is the sentence explaining why building one produces a confident,\nwell-formed, wrong answer. A weighted tie-counter would be the most\nplausible-looking thing this repository could ship and one of the least\ndefensible.","title":"D-34 · Canada — the administrative view of residence, CRA Folio S5-F1-C1","countries":["CA"],"pairs":null,"authority":"administrative","feeds":["UC-08"],"publisher":"Canada Revenue Agency","sourceUrl":"https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax/income-tax-folios-index/series-5-international-residency/folio-1-residency/income-tax-folio-s5-f1-c1-determining-individual-s-residence-status.html","retrievedOn":"2026-08-19","sourceSha256":null},{"id":"D-35#0000","documentId":"D-35","heading":"The test, quoted verbatim","text":"The test, quoted verbatim\n\n> You will be considered a United States resident for tax purposes if you meet\n> the substantial presence test **for the calendar year**. To meet this test,\n> you must be physically present in the United States (U.S.) on at least:\n>\n> - **31 days during the current year**, and\n> - **183 days during the 3-year period** that includes the current year and the\n>   2 years immediately before that, counting:\n>   - All the days you were present in the current year, and\n>   - **1/3** of the days you were present in the first year before the current\n>     year, and\n>   - **1/6** of the days you were present in the second year before the current\n>     year.\n>\n> **Example:** You were physically present in the U.S. on 120 days in each of\n> the years 2023, 2024 and 2025. To determine if you meet the substantial\n> presence test for 2025, count the full 120 days of presence in 2025, 40 days\n> in 2024 (1/3 of 120), and 20 days in 2023 (1/6 of 120). Since the total for\n> the 3-year period is 180 days, you are not considered a resident under the\n> substantial presence test for 2025.\n\nAnd the exclusions, which are not a footnote — quoted:","title":"D-35 · United States — the substantial presence test","countries":["US"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service","sourceUrl":"https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test","retrievedOn":"2026-08-19","sourceSha256":"8d7a5d5d977e2f5353d3335bbd869b8fc4ca8980089ca40de3458fe8d727e8d4"},{"id":"D-35#0001","documentId":"D-35","heading":"The test, quoted verbatim","text":"The test, quoted verbatim\n\n> Do not count the following as days of presence in the U.S. for the substantial\n> presence test: Days you **commute to work in the U.S. from a residence in\n> Canada or Mexico** if you regularly commute from Canada or Mexico. Days you\n> are in the U.S. for **less than 24 hours**, when you are in transit between two\n> places outside the United States. Days you are in the U.S. as a **crew member\n> of a foreign vessel**. Days you are **unable to leave the U.S. because of a\n> medical condition** that develops while you are in the United States. Days you\n> are an **exempt individual**.\n\nPlus a relief the code has no concept of:\n\n> **Closer connection exception to the substantial presence test.** Even if you\n> met the substantial presence test you can still be treated as a nonresident of\n> the United States for U.S. tax purposes if you qualify for one of the\n> following exceptions …","title":"D-35 · United States — the substantial presence test","countries":["US"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service","sourceUrl":"https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test","retrievedOn":"2026-08-19","sourceSha256":"8d7a5d5d977e2f5353d3335bbd869b8fc4ca8980089ca40de3458fe8d727e8d4"},{"id":"D-35#0002","documentId":"D-35","heading":"What this settles","text":"What this settles\n\nNote the discipline the code already gets right and must not lose:\n`computePresenceDays()` returns `NOT_EVALUATED` with `days: null` rather than\na fabricated zero. The fix this document enables is the same discipline applied\nto the **threshold** rather than the count — a 183 that is right for Canada and\nwrong for the other three is a well-formed number rendered beside a citation.","title":"D-35 · United States — the substantial presence test","countries":["US"],"pairs":null,"authority":"instrument","feeds":["UC-08"],"publisher":"Internal Revenue Service","sourceUrl":"https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test","retrievedOn":"2026-08-19","sourceSha256":"8d7a5d5d977e2f5353d3335bbd869b8fc4ca8980089ca40de3458fe8d727e8d4"}];
const CITATION_FEED = "UC-08";
const STOP_TERMS = new Set(['the','a','an','of','to','in','and','or','is','are','be','for','on','as','by','that','this','it','with','from','at','which','we','our','i','my','they','their','you','your','if','not','no','any','was','were','has','have','had','do','does','did','can','will']);
const BM25_K1 = 1.5, BM25_B = 0.75;
const MIN_MATCHED_TERMS = 3, RARE_TERM_MAX_DF = 0.15, MIN_RARE_TERMS = 2;
// Generated from src/shared/countryNames.js + the alias table in
// src/knowledge/lexicalIndex.js, longest name first. It must cover countries
// this corpus holds NOTHING for — that is what lets the filter come back empty
// and fall through to the labelled model paraphrase, instead of answering a
// Germany-Spain question with Canada's residence rule.
const NAME_TO_CODE = [["south georgia & south sandwich islands","GS"],["british indian ocean territory","IO"],["french southern territories","TF"],["central african republic","CF"],["heard & mcdonald islands","HM"],["northern mariana islands","MP"],["st. vincent & grenadines","VC"],["united states of america","US"],["cocos (keeling) islands","CC"],["palestinian territories","PS"],["british virgin islands","VG"],["turks & caicos islands","TC"],["caribbean netherlands","BQ"],["st. pierre & miquelon","PM"],["u.s. outlying islands","UM"],["bosnia & herzegovina","BA"],["svalbard & jan mayen","SJ"],["united arab emirates","AE"],["congo - brazzaville","CG"],["hong kong sar china","HK"],["são tomé & príncipe","ST"],["u.s. virgin islands","VI"],["dominican republic","DO"],["antigua & barbuda","AG"],["equatorial guinea","GQ"],["st. kitts & nevis","KN"],["trinidad & tobago","TT"],["christmas island","CX"],["congo - kinshasa","CD"],["falkland islands","FK"],["french polynesia","PF"],["marshall islands","MH"],["papua new guinea","PG"],["pitcairn islands","PN"],["macao sar china","MO"],["myanmar (burma)","MM"],["north macedonia","MK"],["solomon islands","SB"],["wallis & futuna","WF"],["american samoa","AS"],["cayman islands","KY"],["norfolk island","NF"],["st. barthélemy","BL"],["united kingdom","GB"],["western sahara","EH"],["åland islands","AX"],["bouvet island","BV"],["côte d’ivoire","CI"],["faroe islands","FO"],["french guiana","GF"],["guinea-bissau","GW"],["liechtenstein","LI"],["new caledonia","NC"],["united states","US"],["burkina faso","BF"],["cook islands","CK"],["saudi arabia","SA"],["sierra leone","SL"],["sint maarten","SX"],["south africa","ZA"],["turkmenistan","TM"],["vatican city","VA"],["afghanistan","AF"],["el salvador","SV"],["isle of man","IM"],["netherlands","NL"],["new zealand","NZ"],["north korea","KP"],["philippines","PH"],["puerto rico","PR"],["south korea","KR"],["south sudan","SS"],["switzerland","CH"],["timor-leste","TL"],["antarctica","AQ"],["azerbaijan","AZ"],["bangladesh","BD"],["cape verde","CV"],["costa rica","CR"],["guadeloupe","GP"],["kazakhstan","KZ"],["kyrgyzstan","KG"],["luxembourg","LU"],["madagascar","MG"],["martinique","MQ"],["mauritania","MR"],["micronesia","FM"],["montenegro","ME"],["montserrat","MS"],["mozambique","MZ"],["san marino","SM"],["seychelles","SC"],["st. helena","SH"],["st. martin","MF"],["tajikistan","TJ"],["uzbekistan","UZ"],["portuguese","PT"],["argentina","AR"],["australia","AU"],["gibraltar","GI"],["greenland","GL"],["guatemala","GT"],["indonesia","ID"],["lithuania","LT"],["mauritius","MU"],["nicaragua","NI"],["singapore","SG"],["sri lanka","LK"],["st. lucia","LC"],["venezuela","VE"],["norwegian","NO"],["brazilian","BR"],["anguilla","AI"],["barbados","BB"],["botswana","BW"],["bulgaria","BG"],["cambodia","KH"],["cameroon","CM"],["colombia","CO"],["djibouti","DJ"],["dominica","DM"],["eswatini","SZ"],["ethiopia","ET"],["guernsey","GG"],["honduras","HN"],["kiribati","KI"],["malaysia","MY"],["maldives","MV"],["mongolia","MN"],["pakistan","PK"],["paraguay","PY"],["portugal","PT"],["slovakia","SK"],["slovenia","SI"],["suriname","SR"],["tanzania","TZ"],["thailand","TH"],["zimbabwe","ZW"],["canadian","CA"],["american","US"],["filipino","PH"],["austrian","AT"],["japanese","JP"],["albania","AL"],["algeria","DZ"],["andorra","AD"],["armenia","AM"],["austria","AT"],["bahamas","BS"],["bahrain","BH"],["belarus","BY"],["belgium","BE"],["bermuda","BM"],["bolivia","BO"],["burundi","BI"],["comoros","KM"],["croatia","HR"],["curaçao","CW"],["czechia","CZ"],["denmark","DK"],["ecuador","EC"],["eritrea","ER"],["estonia","EE"],["finland","FI"],["georgia","GE"],["germany","DE"],["grenada","GD"],["hungary","HU"],["iceland","IS"],["ireland","IE"],["jamaica","JM"],["lebanon","LB"],["lesotho","LS"],["liberia","LR"],["mayotte","YT"],["moldova","MD"],["morocco","MA"],["namibia","NA"],["nigeria","NG"],["réunion","RE"],["romania","RO"],["senegal","SN"],["somalia","SO"],["tokelau","TK"],["tunisia","TN"],["türkiye","TR"],["ukraine","UA"],["uruguay","UY"],["vanuatu","VU"],["vietnam","VN"],["holland","NL"],["spanish","ES"],["italian","IT"],["british","GB"],["england","GB"],["mexican","MX"],["belgian","BE"],["swedish","SE"],["finnish","FI"],["angola","AO"],["belize","BZ"],["bhutan","BT"],["brazil","BR"],["brunei","BN"],["canada","CA"],["cyprus","CY"],["france","FR"],["gambia","GM"],["greece","GR"],["guinea","GN"],["guyana","GY"],["israel","IL"],["jersey","JE"],["jordan","JO"],["kuwait","KW"],["latvia","LV"],["malawi","MW"],["mexico","MX"],["monaco","MC"],["norway","NO"],["panama","PA"],["poland","PL"],["russia","RU"],["rwanda","RW"],["serbia","RS"],["sweden","SE"],["taiwan","TW"],["tuvalu","TV"],["uganda","UG"],["zambia","ZM"],["german","DE"],["french","FR"],["polish","PL"],["indian","IN"],["danish","DK"],["aruba","AW"],["benin","BJ"],["chile","CL"],["china","CN"],["egypt","EG"],["gabon","GA"],["ghana","GH"],["haiti","HT"],["india","IN"],["italy","IT"],["japan","JP"],["kenya","KE"],["libya","LY"],["malta","MT"],["nauru","NR"],["nepal","NP"],["niger","NE"],["palau","PW"],["qatar","QA"],["samoa","WS"],["spain","ES"],["sudan","SD"],["syria","SY"],["tonga","TO"],["yemen","YE"],["dutch","NL"],["irish","IE"],["swiss","CH"],["greek","GR"],["chad","TD"],["cuba","CU"],["fiji","FJ"],["guam","GU"],["iran","IR"],["iraq","IQ"],["laos","LA"],["mali","ML"],["niue","NU"],["oman","OM"],["peru","PE"],["togo","TG"],["usa","US"],["uk","GB"]];
const NAMEABLE_CODES = new Set(NAME_TO_CODE.map((e) => e[1]));
function lxTokenize(text) {
  if (typeof text !== 'string') return [];
  return text.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP_TERMS.has(t));
}
function lxCountriesNamed(text) {
  if (typeof text !== 'string') return [];
  const found = new Set();
  const hay = ' ' + text.toLowerCase().replace(/\bu\.s\.a?\.?/g, ' usa ').replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (let i = 0; i < NAME_TO_CODE.length; i += 1) {
    if (hay.indexOf(' ' + NAME_TO_CODE[i][0] + ' ') !== -1) found.add(NAME_TO_CODE[i][1]);
  }
  // Bare codes UPPER CASE ONLY — lower-cased, 'us' is a pronoun and 'it', 'in',
  // 'no', 'is', 'at', 'be', 'or' are all words as well as country codes.
  const upper = text.match(/\b[A-Z]{2}\b/g) || [];
  for (let i = 0; i < upper.length; i += 1) {
    if (NAMEABLE_CODES.has(upper[i])) found.add(upper[i]);
  }
  return Array.from(found);
}
function lxServes(p, wanted) {
  if (Array.isArray(p.pairs) && p.pairs.length > 0 && wanted.length >= 2) {
    return p.pairs.some((pair) => pair.every((c) => wanted.indexOf(c) !== -1));
  }
  return wanted.some((c) => (p.countries || []).indexOf(c) !== -1);
}
const LX_DOCS = CITATION_PASSAGES.map((p) => lxTokenize((p.heading || '') + ' ' + (p.title || '') + ' ' + (p.text || '')));
const LX_LEN = LX_DOCS.map((t) => t.length);
const LX_AVG = LX_LEN.length ? LX_LEN.reduce((a, b) => a + b, 0) / LX_LEN.length : 0;
const LX_DF = new Map();
const LX_TF = LX_DOCS.map((terms) => {
  const counts = new Map();
  for (const t of terms) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of counts.keys()) LX_DF.set(t, (LX_DF.get(t) || 0) + 1);
  return counts;
});
const LX_N = CITATION_PASSAGES.length;
function lxIdf(term) {
  const n = LX_DF.get(term) || 0;
  return Math.max(1e-6, Math.log(1 + (LX_N - n + 0.5) / (n + 0.5)));
}
function lxClearsFloor(matchedOn) {
  if (matchedOn.length >= MIN_MATCHED_TERMS) return true;
  return matchedOn.filter((t) => (LX_DF.get(t) || 0) / (LX_N || 1) <= RARE_TERM_MAX_DF).length >= MIN_RARE_TERMS;
}
function lxSummarize(p) {
  const heading = p.heading ? String(p.heading) : '';
  let body = String(p.text || '');
  if (heading && body.indexOf(heading) === 0) body = body.slice(heading.length);
  body = body.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
  if (body.length <= 480) return body;
  return body.slice(0, 480).replace(/\s+\S*$/, '') + ' \u2026';
}
function lxTitle(p) {
  const title = p.title ? String(p.title) : p.documentId;
  const heading = p.heading ? String(p.heading).trim() : '';
  if (!heading || title.indexOf(heading) !== -1) return title;
  return title + ' \u2014 ' + heading;
}
function retrieveStatutoryCitations(text, limit, countries) {
  const terms = Array.from(new Set(lxTokenize(text || '')));
  if (terms.length === 0) return [];
  // An explicit list wins; null means "read the text".
  const wanted = Array.isArray(countries) ? countries : lxCountriesNamed(text || '');
  const scored = [];
  for (let i = 0; i < CITATION_PASSAGES.length; i += 1) {
    const p = CITATION_PASSAGES[i];
    if ((p.feeds || []).indexOf(CITATION_FEED) === -1) continue;
    if (wanted.length > 0 && !lxServes(p, wanted)) continue;
    let score = 0;
    const matchedOn = [];
    for (const t of terms) {
      const f = LX_TF[i].get(t);
      if (!f) continue;
      score += lxIdf(t) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * LX_LEN[i]) / (LX_AVG || 1))));
      matchedOn.push(t);
    }
    if (score > 0 && lxClearsFloor(matchedOn)) scored.push({ passage: p, score: score, matchedOn: matchedOn });
  }
  const rank = { instrument: 0, administrative: 1, model: 2 };
  scored.sort((a, b) => {
    const ra = rank[a.passage.authority] === undefined ? 3 : rank[a.passage.authority];
    const rb = rank[b.passage.authority] === undefined ? 3 : rank[b.passage.authority];
    if (ra !== rb) return ra - rb;
    if (b.score !== a.score) return b.score - a.score;
    return a.passage.id.localeCompare(b.passage.id);
  });
  const seen = new Set(), first = [], rest = [];
  for (const hit of scored) {
    if (seen.has(hit.passage.documentId)) rest.push(hit);
    else { seen.add(hit.passage.documentId); first.push(hit); }
  }
  return first.concat(rest).slice(0, limit === undefined ? 3 : limit).map((h) => ({
    id: h.passage.id,
    title: lxTitle(h.passage),
    summary: lxSummarize(h.passage),
    matchedOn: ['statutory corpus (lexical) — matched on ' + h.matchedOn.slice(0, 6).map((t) => '"' + t + '"').join(', ')],
    documentId: h.passage.documentId,
    publisher: h.passage.publisher,
    sourceUrl: h.passage.sourceUrl,
    retrievedOn: h.passage.retrievedOn,
    sourceSha256: h.passage.sourceSha256,
    countries: h.passage.countries,
    authority: h.passage.authority,
    instrument: h.passage.authority === 'instrument',
  }));
}
// ---- END GENERATED ----

// --- treatyRetriever.js: the STATUTORY path first, the OECD Model paraphrases
// only if it finds nothing. Port of statutoryLeg() in src/uc08/treatyRetriever.js
// (see that function's header for why the model corpus was demoted). The block
// above this comment is GENERATED — do not edit inside its markers.
const TREATY_CORPUS = [
  {
    id: 'oecd-model-art-4',
    title: 'OECD Model Tax Convention, Article 4 — Resident (tie-breaker rules)',
    summary: 'Where an individual would otherwise be a resident of both Contracting States, tie-breaker tests apply in order: permanent home available, then centre of vital interests, then habitual abode, then nationality, then mutual agreement between the states.',
    keywords: ['dual resident', 'dual residency', 'tie-breaker', 'tie breaker', 'residency', 'resident of both'],
  },
  {
    id: 'oecd-model-art-15',
    title: 'OECD Model Tax Convention, Article 15 — Income from Employment (the "183-day rule")',
    summary: 'Employment remuneration may be taxed only in the state of residence if: the employee is present in the other state for 183 days or less in any 12-month period; the employer is not a resident of that other state; and the remuneration is not borne by a permanent establishment there.',
    keywords: ['183', 'physical presence', 'presence day', 'withholding', 'short-term assignment', 'short term assignment'],
  },
  {
    id: 'totalization-general',
    title: 'Social Security Totalization Agreements — general principle',
    summary: 'Totalization agreements generally assign social-security coverage to a single country at a time for a temporary assignment, and allow a certificate of coverage (e.g. an EU A1 certificate) to certify continued home-country coverage while working abroad.',
    keywords: ['totalization', 'totalisation', 'social security', 'a1', 'certificate of coverage'],
  },
];

function escapeKeyword(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary keyword matching, not substring. `includes('mot')` fired on the
// word "reMOTe" — the platform's own name — and `includes('a1')` on any "A123"
// identifier, and then `matchedOn` told the reviewer that was the reason for
// the citation. Trailing LETTERS stay legal because several corpus keywords are
// deliberate stems ("immigrat", "liquidat", "portab"); a trailing digit does
// not. Port of src/shared/keywordMatch.js.
function matchKeywords(lower, keywords) {
  return (keywords || []).filter((kw) =>
    new RegExp('(?<![a-z0-9])' + escapeKeyword(String(kw).toLowerCase()) + '(?![0-9])').test(lower)
  );
}

function retrieveByKeywords(text) {
  const lower = (text || '').toLowerCase();
  const matches = [];
  for (const entry of TREATY_CORPUS) {
    const matchedOn = matchKeywords(lower, entry.keywords);
    if (matchedOn.length > 0) matches.push({ id: entry.id, title: entry.title, summary: entry.summary, matchedOn });
  }
  return matches;
}

function retrieveCitations(text, countries) {
  const statutory = retrieveStatutoryCitations(text, 3, countries);
  if (statutory.length > 0) return statutory;
  return retrieveByKeywords(text).map((c) => Object.assign({}, c, {
    authority: 'model',
    instrument: false,
    matchedOn: c.matchedOn.concat([
      'no passage in the retrieved statutory corpus matched this inquiry — this is a MODEL convention, not the instrument governing this country pair',
    ]),
  }));
}

// Countries from the PARSE, not the prose — port of the same choice in
// src/uc08/workflow.js. An empty list is passed as null, because null means
// "read the text" and [] would mean "restrict to nothing".
const retrievalCountries = Array.from(new Set(
  (parsed.jurisdictions || []).concat(ticket.targetCountry ? [ticket.targetCountry] : [])
));
const citations = retrieveCitations(
  [ticket.text, parsed.inquiryType].join(' '),
  retrievalCountries.length > 0 ? retrievalCountries : null
);

// --- jurisdictionKnowledge.js: the statement that travels with a day count ---
// PORT — keep in step with src/uc08/jurisdictionKnowledge.js; the parity test
// compares the composed narrative string, so a divergence here fails the suite
// rather than reaching a specialist. It encodes NO threshold, NO window and NO
// treaty article for any country, because none has been read from a primary
// source (every statutory URL in docs/knowledge/DOWNLOAD-MANIFEST.md is marked
// NOT VERIFIED). Every entry records an absence and names where the answer
// would come from.
const JURISDICTION_REGISTER = {
  NL: { name: 'the Netherlands' },
  PT: { name: 'Portugal' },
  CA: { name: 'Canada' },
  US: { name: 'the United States' },
};
const CITIZENSHIP_STATEMENT =
  'Citizenship-based taxation is NOT ASSESSED anywhere in this dossier. Every figure and every citation here is framed as a RESIDENCE question — where a person was, for how long. No request field in this use case carries a nationality, citizenship or passport, and no rule here reads one, so a dossier cannot tell a US-connected person from any other and does not try. If this requester holds a citizenship whose country taxes on that basis rather than on residence, nothing above addresses it, and the day count in particular does not.';

function describeJurisdictionCoverage(jurisdictions, presenceCountry, presenceDaysArg) {
  const named = [];
  for (const j of jurisdictions || []) {
    const code = typeof j === 'string' ? j.trim().toUpperCase() : '';
    if (code && named.indexOf(code) === -1) named.push(code);
  }
  const subject = typeof presenceCountry === 'string' && presenceCountry.trim() ? presenceCountry.trim().toUpperCase() : null;
  const codes = subject && named.indexOf(subject) === -1 ? named.concat([subject]) : named.slice();
  const dayCountPresent = Boolean(presenceDaysArg) && presenceDaysArg.status === 'COUNTED' && presenceDaysArg.days !== null;

  // PORT of jurisdictionName()/listOfNames()/jurisdictionInPlayPhrase() in
  // src/uc08/jurisdictionKnowledge.js. The register's own display name wins;
  // everything else goes through the countryLabel() port below, against the
  // generated 249-entry table this node carries. Codes still travel on the
  // dossier — this is the sentence a tax specialist reads.
  const nameOf = (code) =>
    Object.prototype.hasOwnProperty.call(JURISDICTION_REGISTER, code) ? JURISDICTION_REGISTER[code].name : countryLabel(code);
  const listOfNames = (list) => {
    const names = list.map(nameOf);
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  };
  const inPlayPhrase = (code) => {
    const isNamed = named.indexOf(code) !== -1;
    const isCounted = subject === code;
    if (isNamed && isCounted) return nameOf(code) + ' (named in the request, and the country the presence-day count was taken in)';
    if (isCounted) {
      return nameOf(code) + ' (the country the presence-day count was taken in, which the request text did not name — it came from the structured request)';
    }
    return nameOf(code) + ' (named in the request)';
  };

  const parts = [];
  if (codes.length === 0) {
    parts.push(
      dayCountPresent
        ? "NO JURISDICTION IS IDENTIFIED FOR THIS DOSSIER, and a day count is nonetheless present. The count's own subject country was not recorded either, so the day count in this dossier is a number of days in an unstated country, measured against no country's rule."
        : 'No jurisdiction is identified for this dossier: the request text named none, and no country was supplied to count presence days in.'
    );
  } else {
    parts.push('Jurisdictions in play: ' + codes.map(inPlayPhrase).join('; ') + '.');
    if (!named.length) {
      parts.push(
        "The request text named no jurisdiction that this system's country dictionary recognises — which is not the same as naming none, since that dictionary is a short curated list rather than an entity recogniser."
      );
    }
    if (!subject && dayCountPresent) {
      parts.push('The country the presence-day count was taken in was not recorded, so that figure has no stated subject.');
    }
  }

  const registered = codes.filter((c) => Object.prototype.hasOwnProperty.call(JURISDICTION_REGISTER, c));
  const unregistered = codes.filter((c) => !Object.prototype.hasOwnProperty.call(JURISDICTION_REGISTER, c));
  parts.push('THIS SYSTEM HOLDS NO RESIDENCE TEST FOR ANY JURISDICTION IN PLAY — no threshold, no window, no rule of any shape.');
  if (registered.length) {
    parts.push(
      'For ' + listOfNames(registered) + ' the gap is recorded deliberately, and the instrument that would close it is named against each of them, with its publisher.'
    );
  }
  if (unregistered.length) {
    parts.push(
      'For ' + listOfNames(unregistered) + ' not even that much is held: ' +
      (unregistered.length > 1 ? 'those countries are' : 'that country is') +
      " absent from this system's register, so nobody has looked."
    );
  }
  if (dayCountPresent) {
    parts.push(
      'So the day count is arithmetic over supplied travel records and nothing more. It is NOT measured against any jurisdiction\'s residence test, and the 183-day figure the reference corpus cites is a general model-convention article, not a rule of any country named here.'
    );
  }
  return { statement: parts.join(' '), citizenshipStatement: CITIZENSHIP_STATEMENT };
}

// ---------------------------------------------------------------------------
// PORT of src/shared/countryNames.js — countries reach a person BY NAME
// ---------------------------------------------------------------------------
// CLAUDE.md's standing instruction: *"instead of using country codes like PT you
// use the country's full name — you can use codes inside the code, not on UI."*
// The narrative this node composes IS the ticket's internal note, so it is one
// of the surfaces that rule is about.
//
// THIS IS A SECOND COPY OF A TABLE, WHICH THIS REPOSITORY OTHERWISE FORBIDS
// (CLAUDE.md §6), AND IT IS DELIBERATE — an n8n Code node has no imports, so the
// only alternatives were a bare code on the specialist's screen or a PARTIAL
// hand-written list. A partial list is the worse of the two: `structuredPlan`
// can carry any alpha-2 straight off the webhook, so a short list would name
// some countries and print codes for the rest, and nothing would say which was
// which.
//
// IT IS GENERATED, NOT TYPED, and it is GUARDED. Every row below was emitted
// from `nameableCountryCodes()` / `countryName()` in src/shared/countryNames.js,
// which derives from src/portal/countries.js (CLDR via Node's own ICU).
// `test/n8nCountryNameParity.test.js` reads this object back out of this file
// and asserts it agrees with that module for every code it can name — so a
// divergence fails the suite instead of reaching a specialist.
//
// Regenerate with:
//   node -e 'import("./src/shared/countryNames.js").then(m=>{for(const c of m.nameableCountryCodes().sort())process.stdout.write(c+":"+JSON.stringify(m.countryName(c))+",")})'
// ---------------------------------------------------------------------------
const COUNTRY_NAMES = {
  AD:"Andorra",AE:"United Arab Emirates",AF:"Afghanistan",AG:"Antigua & Barbuda",AI:"Anguilla",
  AL:"Albania",AM:"Armenia",AO:"Angola",AQ:"Antarctica",AR:"Argentina",AS:"American Samoa",
  AT:"Austria",AU:"Australia",AW:"Aruba",AX:"Åland Islands",AZ:"Azerbaijan",
  BA:"Bosnia & Herzegovina",BB:"Barbados",BD:"Bangladesh",BE:"Belgium",BF:"Burkina Faso",
  BG:"Bulgaria",BH:"Bahrain",BI:"Burundi",BJ:"Benin",BL:"St. Barthélemy",BM:"Bermuda",BN:"Brunei",
  BO:"Bolivia",BQ:"Caribbean Netherlands",BR:"Brazil",BS:"Bahamas",BT:"Bhutan",BV:"Bouvet Island",
  BW:"Botswana",BY:"Belarus",BZ:"Belize",CA:"Canada",CC:"Cocos (Keeling) Islands",
  CD:"Congo - Kinshasa",CF:"Central African Republic",CG:"Congo - Brazzaville",CH:"Switzerland",
  CI:"Côte d’Ivoire",CK:"Cook Islands",CL:"Chile",CM:"Cameroon",CN:"China",CO:"Colombia",
  CR:"Costa Rica",CU:"Cuba",CV:"Cape Verde",CW:"Curaçao",CX:"Christmas Island",CY:"Cyprus",
  CZ:"Czechia",DE:"Germany",DJ:"Djibouti",DK:"Denmark",DM:"Dominica",DO:"Dominican Republic",
  DZ:"Algeria",EC:"Ecuador",EE:"Estonia",EG:"Egypt",EH:"Western Sahara",ER:"Eritrea",ES:"Spain",
  ET:"Ethiopia",FI:"Finland",FJ:"Fiji",FK:"Falkland Islands",FM:"Micronesia",FO:"Faroe Islands",
  FR:"France",GA:"Gabon",GB:"United Kingdom",GD:"Grenada",GE:"Georgia",GF:"French Guiana",
  GG:"Guernsey",GH:"Ghana",GI:"Gibraltar",GL:"Greenland",GM:"Gambia",GN:"Guinea",GP:"Guadeloupe",
  GQ:"Equatorial Guinea",GR:"Greece",GS:"South Georgia & South Sandwich Islands",GT:"Guatemala",
  GU:"Guam",GW:"Guinea-Bissau",GY:"Guyana",HK:"Hong Kong SAR China",HM:"Heard & McDonald Islands",
  HN:"Honduras",HR:"Croatia",HT:"Haiti",HU:"Hungary",ID:"Indonesia",IE:"Ireland",IL:"Israel",
  IM:"Isle of Man",IN:"India",IO:"British Indian Ocean Territory",IQ:"Iraq",IR:"Iran",
  IS:"Iceland",IT:"Italy",JE:"Jersey",JM:"Jamaica",JO:"Jordan",JP:"Japan",KE:"Kenya",
  KG:"Kyrgyzstan",KH:"Cambodia",KI:"Kiribati",KM:"Comoros",KN:"St. Kitts & Nevis",
  KP:"North Korea",KR:"South Korea",KW:"Kuwait",KY:"Cayman Islands",KZ:"Kazakhstan",LA:"Laos",
  LB:"Lebanon",LC:"St. Lucia",LI:"Liechtenstein",LK:"Sri Lanka",LR:"Liberia",LS:"Lesotho",
  LT:"Lithuania",LU:"Luxembourg",LV:"Latvia",LY:"Libya",MA:"Morocco",MC:"Monaco",MD:"Moldova",
  ME:"Montenegro",MF:"St. Martin",MG:"Madagascar",MH:"Marshall Islands",MK:"North Macedonia",
  ML:"Mali",MM:"Myanmar (Burma)",MN:"Mongolia",MO:"Macao SAR China",MP:"Northern Mariana Islands",
  MQ:"Martinique",MR:"Mauritania",MS:"Montserrat",MT:"Malta",MU:"Mauritius",MV:"Maldives",
  MW:"Malawi",MX:"Mexico",MY:"Malaysia",MZ:"Mozambique",NA:"Namibia",NC:"New Caledonia",
  NE:"Niger",NF:"Norfolk Island",NG:"Nigeria",NI:"Nicaragua",NL:"Netherlands",NO:"Norway",
  NP:"Nepal",NR:"Nauru",NU:"Niue",NZ:"New Zealand",OM:"Oman",PA:"Panama",PE:"Peru",
  PF:"French Polynesia",PG:"Papua New Guinea",PH:"Philippines",PK:"Pakistan",PL:"Poland",
  PM:"St. Pierre & Miquelon",PN:"Pitcairn Islands",PR:"Puerto Rico",PS:"Palestinian Territories",
  PT:"Portugal",PW:"Palau",PY:"Paraguay",QA:"Qatar",RE:"Réunion",RO:"Romania",RS:"Serbia",
  RU:"Russia",RW:"Rwanda",SA:"Saudi Arabia",SB:"Solomon Islands",SC:"Seychelles",SD:"Sudan",
  SE:"Sweden",SG:"Singapore",SH:"St. Helena",SI:"Slovenia",SJ:"Svalbard & Jan Mayen",
  SK:"Slovakia",SL:"Sierra Leone",SM:"San Marino",SN:"Senegal",SO:"Somalia",SR:"Suriname",
  SS:"South Sudan",ST:"São Tomé & Príncipe",SV:"El Salvador",SX:"Sint Maarten",SY:"Syria",
  SZ:"Eswatini",TC:"Turks & Caicos Islands",TD:"Chad",TF:"French Southern Territories",TG:"Togo",
  TH:"Thailand",TJ:"Tajikistan",TK:"Tokelau",TL:"Timor-Leste",TM:"Turkmenistan",TN:"Tunisia",
  TO:"Tonga",TR:"Türkiye",TT:"Trinidad & Tobago",TV:"Tuvalu",TW:"Taiwan",TZ:"Tanzania",
  UA:"Ukraine",UG:"Uganda",UM:"U.S. Outlying Islands",US:"United States",UY:"Uruguay",
  UZ:"Uzbekistan",VA:"Vatican City",VC:"St. Vincent & Grenadines",VE:"Venezuela",
  VG:"British Virgin Islands",VI:"U.S. Virgin Islands",VN:"Vietnam",VU:"Vanuatu",
  WF:"Wallis & Futuna",WS:"Samoa",YE:"Yemen",YT:"Mayotte",ZA:"South Africa",ZM:"Zambia",
  ZW:"Zimbabwe"
};

/**
 * PORT of countryLabel(): the name when there is one, the code when there is
 * not, and `absent` when there is no code at all. Only a two-letter value is
 * TREATED as a code — anything else is returned trimmed and otherwise untouched,
 * so a field already holding "Portugal" is not shouted back as "PORTUGAL" and an
 * alpha-3 stays visibly an alpha-3. Never invents, never re-cases.
 */
function countryLabel(code, absent = 'not stated') {
  if (typeof code !== 'string' || code.trim() === '') return absent;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return code.trim();
  return Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, normalized) ? COUNTRY_NAMES[normalized] : normalized;
}

// --- dossierBuilder.js: the reader's vocabulary, ported verbatim -------------
// A classifier slug is the PARSER's vocabulary; a Tax Ops specialist reads this
// string. Change a wording here and change src/uc08/dossierBuilder.js in the
// same edit — test/n8nUc08Parity.test.js compares this narrative word for word.
const INQUIRY_TYPE_WORDS = {
  dual_residency: 'a dual tax-residency question',
  withholding: 'a payroll-withholding question',
  totalization: 'a social-security totalisation / certificate-of-coverage question',
  other: 'a cross-border tax or social-security question this system could not place in any of its categories',
};

// --- dossierBuilder.js: draftNarrativeTemplate() — the deterministic fallback
function draftNarrativeTemplate(inquiryType, jurisdictions, presenceDaysArg, citationsArg, presenceCountry) {
  const coverage = describeJurisdictionCoverage(jurisdictions, presenceCountry, presenceDaysArg);
  const parts = [];
  parts.push(
    'This inquiry reads as ' +
      (Object.prototype.hasOwnProperty.call(INQUIRY_TYPE_WORDS, inquiryType)
        ? INQUIRY_TYPE_WORDS[inquiryType]
        : 'an inquiry type this summary has no wording for (' + inquiryType + ')') +
      '.'
  );
  // Names, not codes. The LIMIT below is unchanged word for word: it is the
  // sentence that stops a reader supplying a jurisdiction from memory.
  parts.push(
    jurisdictions.length
      ? 'This request names ' + jurisdictions.map((j) => countryLabel(j)).join(', ') + '.'
      : 'No specific jurisdiction was identified in the request text.'
  );
  if (presenceDaysArg && presenceDaysArg.status === 'NOT_EVALUATED') {
    parts.push(
      'Physical presence could NOT be computed from the supplied records: ' +
      (presenceDaysArg.problems || []).join('; ') + '. No day count is available for this inquiry.'
    );
  } else if (presenceDaysArg) {
    parts.push('Computed physical presence: ' + presenceDaysArg.days + ' distinct day(s) across ' + presenceDaysArg.periodsCounted + ' recorded period(s) in the evaluated window (overlapping periods counted once).');
  }
  // In the same breath as the number, never appended at the end.
  parts.push(coverage.statement);
  parts.push(coverage.citizenshipStatement);
  if (citationsArg.length) {
    parts.push('Retrieved background: ' + citationsArg.map((c) => c.title).join('; ') + '.');
  } else {
    parts.push('No matching background citations were found in the local reference corpus.');
  }
  parts.push('This is research context for a tax specialist\'s own analysis, not a residency, withholding, or coverage determination.');
  return parts.join(' ');
}

const narrative = draftNarrativeTemplate(parsed.inquiryType, parsed.jurisdictions, presenceDays, citations, ticket.targetCountry || null);
const jurisdictionCoverage = describeJurisdictionCoverage(parsed.jurisdictions, ticket.targetCountry || null, presenceDays);

// --- disclaimer.js: withDisclaimer(..., "tax") — mandatory, unconditional --
const TAX_DISCLAIMER = 'This is general information only and not tax or legal advice. Your specific situation must be reviewed by a qualified tax specialist.';
const customerFacingAcknowledgement = 'Thank you for your inquiry. It has been received and is under review by our tax specialist team.\n\n---\n' + TAX_DISCLAIMER;

// --- dossierBuilder.js: buildDossier() ---------------------------------------
const dossier = {
  inquiryType: parsed.inquiryType,
  jurisdictions: parsed.jurisdictions,
  jurisdictionCoverage,
  presenceDays,
  citations,
  narrative,
  framing: 'RESEARCH SUPPORT ONLY — not a residency, withholding, or coverage determination. For review by a qualified Remote Tax Operations specialist.',
  customerFacingAcknowledgement,
};

// The ONLY thing this node's decision ever is. No branch, no other value.
const decision = 'escalate';
const riskTier = 'high';

return [{ json: { ...ticket, inquiryType: parsed.inquiryType, jurisdictions: parsed.jurisdictions, presenceDays, citations, narrative, dossier, decision, riskTier } }];
