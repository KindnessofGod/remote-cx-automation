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

// --- treatyRetriever.js: the keyword path (see header — the real function's
// safe default when no pgPool/embed are configured, which an n8n Code node
// never has) -------------------------------------------------------------
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

function retrieveCitations(text) {
  const lower = (text || '').toLowerCase();
  const matches = [];
  for (const entry of TREATY_CORPUS) {
    const matchedOn = matchKeywords(lower, entry.keywords);
    if (matchedOn.length > 0) matches.push({ id: entry.id, title: entry.title, summary: entry.summary, matchedOn });
  }
  return matches;
}

const citations = retrieveCitations([ticket.text, parsed.inquiryType].join(' '));

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
