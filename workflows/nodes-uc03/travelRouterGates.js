// ---------------------------------------------------------------------------
// travelRouterGates.js — body of the "Travel Router Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-03's deterministic core in n8n: classify (rule-based fallback) ->
// verify identity -> route (auto_resolve / human_review / escalate /
// route_to_uc04), in ONE node, exactly as src/uc03/policyEngine.js +
// src/uc03/workflow.js do. UC-03 is the 🟢 "thin router" — it answers simple
// informational travel questions, drafts (never issues) a support letter
// behind a human gate, and hands work-authorization intent to UC-04 as a
// normalized event (neither dispatched nor writable here — this node NEVER
// computes an execution/write payload; there is no write path in UC-03).
//
// test/n8nUc03Parity.test.js executes THIS FILE and asserts its
// decision/reason/flags/durationDays match policyEngine.evaluate() (and its
// route_to_uc04 handoff event matches workflow.js's buildUc04HandoffEvent())
// for every scenario — same discipline as UC-01's gates.js, UC-06's
// amendmentGates.js and UC-08's buildDossier.js. See workflows/README.md for
// the escaping-bug class this file-based pattern exists to avoid.
//
// THE LLM SEAM — which of the two repo patterns applies here:
//   This is pattern (a), "validated-shape so rules are equally valid." The
//   LLM's only job is to understand messy free text into a classification.
//   classifyTravelInquiry() validates every returned field against a strict
//   shape before it is trusted for anything decision-relevant, and falls back
//   verbatim to classifyTravelInquiryRuleBased() on ANY failure (invalid
//   shape, malformed JSON, no LLM). So the deterministic rule-based path IS a
//   fully valid decision input, exactly the reasoning UC-08's buildDossier.js
//   documents — an n8n Code node runs that rule-based path directly, and
//   takes a well-shaped LLM classification when the shared-envelope LLM node
//   (`$input`) hands one in. That is NOT a duplicate LLM call inside this
//   Code body — an n8n Code node has no API key or network for one.
//
// Runs inside n8n's sandbox: no imports, no network, no module system.
// `$()`, `$input` and `$json` are provided by n8n (mocked by the parity
// test). Reminder from workflows/README.md: `\n` in a string stays TWO chars
// here, and every regex below is a real `/\s/` in a real .js file — nothing
// is templated into JS by a builder, so the literals can't silently collapse.
// ---------------------------------------------------------------------------

// --- the normalized ticket (from "Normalize Inquiry") -----------------------
const request = $('Normalize Inquiry').first().json;

/**
 * First candidate that is genuinely ISO 3166-1 ALPHA-2 SHAPED, canonicalised —
 * or null. The single shape check for this whole node: both the employment
 * record's country and every countries-list row go through it, so the two
 * cannot drift apart the way this file and src/remote/restClient.js did.
 * Mirrors pickAlpha2()/isWellFormedCountryCode() in src/remote/restClient.js;
 * inlined because an n8n Code node cannot import.
 */
function alpha2OrNull(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  }
  return null;
}

// --- employment (from "Fetch Employment (Remote)") — id/status/country_code --
// NO RECORD IS NOT AN EMPTY RECORD. This object is the ONLY authoritative
// thing the identity gate below has to match a caller's claim against, so it
// must never contain a value that came from the caller. It used to: when the
// fetch returned nothing usable (404, outage, an error body, an unexpected
// shape) `id` was backfilled from `request.employmentId`, and identity then
// "verified" a caller-supplied session id against a caller-supplied employment
// id — the same string on both sides of the comparison, proving nothing, while
// reporting `verified: true, method: 'session'`. It failed closed only by
// accident, because the NEXT gate (`employment.status !== 'active'`) happened
// to catch the run; an identity control whose correctness depends on a
// downstream gate is not a control (same reasoning as policyEngine.js's
// sanctions-before-supported-list note).
//
// So: an id can only ever come from the API response. If the response carried
// no record, this is `null` — the exact value RemoteClient.getEmployment()
// returns on a 404 (its documented convention) and therefore the exact value
// src/uc03/workflow.js hands to verifyRequester(). Parity is with the
// reference implementation's real behaviour, not with a placeholder shape.
// Every downstream reader of a null employment is on the escalate path only:
// identity cannot verify without a record, so route() returns at gate 1
// before touching `employment.status`, and buildUc04HandoffEvent's port below
// is reachable only after identity verified. test/n8nUc03Parity.test.js pins
// all of this.
const empRaw =
  $('Fetch Employment (Remote)').first().json?.data?.employment ??
  $('Fetch Employment (Remote)').first().json?.data ??
  {};
const employment = empRaw && empRaw.id
  ? {
      id: empRaw.id,
      status: empRaw.status ?? 'unknown',
      // The real API nests country under country.{alpha_2_code,code}; only the
      // mock's synthetic flat shape has a top-level country_code (parity fix,
      // see src/remote/restClient.js normalizeEmployment()).
      //
      // THE SHAPE IS ASSERTED, NOT HOPED FOR — F-27, one field over. This line
      // used to read `country_code ?? country.alpha_2_code ?? country.code`
      // with no check at all, so whenever `alpha_2_code` was absent the chain
      // placed the ALPHA-3 form ("DEU") into a field only ever probed with
      // "DE". Nothing crashes; every comparison is simply false forever and the
      // gates fail closed — indistinguishable from working correctly, exactly
      // as UC-03's own dead registry gate was for this project's whole life.
      // Appending one more fallback is what reproduces the bug a level down.
      //
      // src/remote/restClient.js's normalizeEmployment() was fixed to
      // `pickAlpha2([country.alpha_2_code, country_code, country.code])` and
      // this port was not — leaving the reference implementation MORE correct
      // than its own deployed copy, which is the inversion the parity rule
      // exists to prevent. Mirrored exactly here: same candidate ORDER, same
      // /^[A-Z]{2}$/ shape check (alpha2OrNull below is pickAlpha2, inlined
      // because an n8n Code node cannot import), same null-not-a-wrong-string
      // outcome. An alpha-3 value is not an alpha-2 value we can salvage —
      // converting needs a 249-entry table this repo must not invent (prime
      // directive #4) — and every consumer already reads null as "not
      // confirmed". A missing value gets investigated; a wrong one gets acted
      // on. UC-03 reads this field only as the handoff event's
      // `origin_country`, so a null here is a visibly absent origin rather
      // than a plausible-looking wrong one.
      country_code: alpha2OrNull([
        empRaw.country?.alpha_2_code,
        empRaw.country_code,
        empRaw.country?.code,
      ]),
      // Only used by the Zendesk requester-email identity path below; the real
      // API nests it under basic_information, the mock exposes it flat.
      email:
        empRaw.basic_information?.email ??
        empRaw.basic_information?.personal_email ??
        empRaw.email ??
        empRaw.personal_email ??
        null,
      // --- THE FOUR LETTER-TEMPLATE FIELDS, added 2026-08-31 --------------
      //
      // WHAT THEIR ABSENCE DID. `assessLetterScope()` below checks
      // TEMPLATE_EMPLOYMENT_FIELDS = ['full_name','job_title','status',
      // 'contract_type','start_date'] against this object. Four of the five
      // were never put on it, so `assessLetterScope` reported
      // `letter_missing_full_name`, `letter_missing_job_title`,
      // `letter_missing_contract_type` and `letter_missing_start_date` on
      // EVERY run, for EVERY employee, however complete the Remote record —
      // and a formal-letter request therefore escalated
      // `letter_scope_exceeded` every single time. Measured against src on one
      // employee with all four populated:
      //
      //     src/uc03/policyEngine.js  -> auto_resolve / standard_letter_issued
      //     this file (before)        -> escalate / letter_scope_exceeded
      //
      // A DIFFERENT DECISION, a different terminal Zendesk node and a different
      // queue tag, from the same request. Not a reason mismatch like UC-04's
      // sanctions gate — an outcome mismatch.
      //
      // WHY THE PARITY TEST WAS BLIND, and it is the sharpest instance of this
      // in the repo: test/n8nUc03Parity.test.js built its reference call as
      // `evaluate({ employment: fromN8n.employment, … })` — it fed src THIS
      // NODE'S OWN STRIPPED OBJECT. It compared like with like by construction
      // and could never see a field this file failed to carry. 61/61 green over
      // a live divergence. Fixed in the same change; that test now builds the
      // src-side employment from the raw fixture.
      //
      // Candidate order mirrors src/remote/restClient.js's normalizeEmployment()
      // field for field — `raw.full_name ?? basic_information.name`,
      // `basic_information.job_title ?? raw.job_title`,
      // `employment_model || type`, and start_date's three-step fallback ending
      // at seniority_date. Do not "simplify" these to a single read: each
      // second-choice exists because one of the two Remote shapes omits the
      // first, and the mock and the live API disagree about which.
      full_name: empRaw.full_name ?? empRaw.basic_information?.name ?? null,
      job_title: empRaw.basic_information?.job_title ?? empRaw.job_title ?? null,
      // The flat-shape passthrough first, mirroring normalizeEmployment()'s
      // OWN early return (`if (typeof raw.contract_type === "string" && typeof
      // raw.start_date === "string") return raw; // already the mock's flat
      // shape`). Missing it is not academic: the mock server and every fixture
      // in this repo use the flat shape, so a port that only reads the nested
      // API form resolves `contract_type: 'unknown'` and `start_date: null` on
      // exactly the records the tests are written against — which is a second,
      // quieter version of the bug this block was added to fix.
      contract_type:
        typeof empRaw.contract_type === 'string' && empRaw.contract_type
          ? empRaw.contract_type
          : empRaw.employment_model || empRaw.type || 'unknown',
      start_date:
        typeof empRaw.start_date === 'string' && empRaw.start_date
          ? empRaw.start_date
          : empRaw.basic_information?.provisional_start_date ??
            empRaw.provisional_start_date ??
            empRaw.basic_information?.seniority_date ??
            null,
    }
  : null;

// --- shared/upstreamFailure.js, ported verbatim (a Code node cannot import) --
// FINDING: "could not read the registry" was being recorded as a fact ABOUT THE
// DESTINATION. `Fetch Countries (Remote)` carries `onError:
// continueRegularOutput`, which does NOT mark the node red — it reports
// `executionStatus: "success"` and hands this node `{error: {…, status}}` in
// place of the 224 rows. That lands on the non-array branch below, yields an
// empty supported set, and the gate then escalates
// `destination_jurisdiction_excluded` — a claim about the destination's
// jurisdiction derived from an answer that never arrived. The comment at that
// gate used to call this intended; it was the same F-15/F-25 conflation
// UC-02/06/09 already fixed, one use case over.
//
// src/uc03/policyEngine.js gained step 6b for exactly this. The two execution
// paths diverged on it until this port landed. They still differ in one honest
// way: `RemoteClient.listCountries()` returns null for ANY unreadable registry,
// so the Node path can only ever report `not_found`, while here the real status
// is on the error object and a 503 is correctly `upstream_unavailable`. That is
// a difference in what each path can OBSERVE, not in what either decides.
const UPSTREAM_NOT_FOUND = 'not_found';
const UPSTREAM_UNREACHABLE = 'unreachable';
const REASON_UPSTREAM_NOT_FOUND = 'upstream_record_not_found';
const REASON_UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

function describeUpstreamError(raw, call) {
  if (!raw || typeof raw !== 'object') return null;
  if (!('error' in raw)) return null;
  if ('data' in raw) return null;
  const err = raw.error;
  if (typeof err === 'string') {
    return { call, status: null, kind: UPSTREAM_UNREACHABLE, message: err.slice(0, 200) };
  }
  if (!err || typeof err !== 'object') return null;
  const numeric = Number(err.status ?? err.httpCode ?? err.statusCode);
  const status = Number.isInteger(numeric) ? numeric : null;
  const message =
    typeof err.message === 'string' ? err.message.slice(0, 200) : String(err.name ?? 'upstream call failed');
  return { call, kind: status === 404 ? UPSTREAM_NOT_FOUND : UPSTREAM_UNREACHABLE, status, message };
}

function findUpstreamFailure(failures, call) {
  if (!Array.isArray(failures)) return null;
  for (const failure of failures) {
    if (failure && failure.call === call) return failure;
  }
  return null;
}

function upstreamVerdict(failure) {
  if (!failure) return null;
  const reason = failure.kind === UPSTREAM_NOT_FOUND ? REASON_UPSTREAM_NOT_FOUND : REASON_UPSTREAM_UNAVAILABLE;
  return {
    decision: 'escalate',
    reason,
    flags: [reason, 'upstream_' + failure.call + '_' + (failure.status === null ? 'error' : failure.status)],
  };
}

// --- supported-countries list (from "Fetch Countries (Remote)") — fails
// closed: an absent/empty list means nothing is confirmed supported ----------
//
// FINDING F-27 — THIS GATE WAS DEAD IN PRODUCTION FOR THE NODE'S ENTIRE LIFE.
// The loop below used to accept only `c.country_code`. The live
// `GET /v1/countries` sends no such field: it sends `alpha_2_code` ("ES") and
// `code` ("ESP", the ALPHA-3 form). So a successful 224-row fetch produced an
// EMPTY supported list, every destination failed the membership test, and
// UC-03 could never reach auto_resolve in production. Execution 4259 records it
// verbatim: `"supportedCountries": []` next to a healthy countries fetch, with
// Spain — `eor_onboarding: true` — escalating as `unsupported_destination`
// (the reason string in use at the time; since renamed to
// `destination_jurisdiction_excluded` — see that gate below for why).
//
// It hid because the gate fails closed. A use case that structurally cannot
// succeed looks exactly like one being appropriately cautious, so nothing in
// the run status, the node status, or the audit row ever looked wrong.
//
// NORMALISE ON THE ALPHA-2 AXIS, EXPLICITLY. The destination this list is
// compared against is always alpha-2, so a value that is not alpha-2 must not
// enter the list at all. Merely adding `?? c.code` would put "ESP" in the set
// to compare false against "ES" forever — the same defect one level down.
// `code` is therefore consulted LAST and only accepted when it already matches
// /^[A-Z]{2}$/. A row offering only an alpha-3 code is DROPPED: there is no
// alpha-3 -> alpha-2 table here (nor in src/, deliberately — inventing one
// would be inventing API data), and "a code we cannot compare" honestly means
// "not confirmed supported", which on a 🟢 auto-reply-and-solve path must
// escalate. Mirrors countryRowToAlpha2() in src/remote/restClient.js;
// test/n8nUc03Parity.test.js drives BOTH from the same verbatim live fixture.
//
// The envelope handling below is also live-verified: the real API puts the
// array DIRECTLY under `data`, the mock puts it under `data.countries`, and
// this node's HTTP predecessor (`onError: continueRegularOutput`) passes an
// error object straight through on failure — which lands on the non-array
// branch and yields an empty list. The first two are intended. The THIRD IS
// NOT, and this comment used to say it was: an empty list from a failed read
// is not the same fact as an empty list from a successful one, and step 6b
// above now separates them before this list is ever consulted.
const countriesRaw =
  $('Fetch Countries (Remote)').first().json?.data?.countries ??
  $('Fetch Countries (Remote)').first().json?.data ??
  $('Fetch Countries (Remote)').first().json ??
  [];

// Built BEFORE the list is normalised, off the RAW envelope, because that is
// the only place a failed read is still distinguishable from an empty answer.
const upstreamFailures = [
  describeUpstreamError($('Fetch Countries (Remote)').first().json, 'countries'),
].filter(Boolean);

/** One countries row -> canonical alpha-2 code, or null when unplaceable. */
function countryRowToAlpha2(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return alpha2OrNull([
    row.alpha_2_code,
    row.country && row.country.alpha_2_code,
    row.country_code,
    row.code, // alpha-3 on the live API — accepted ONLY when alpha-2 shaped
    row.country && row.country.code,
  ]);
}

const supportedList = [];
for (const c of Array.isArray(countriesRaw) ? countriesRaw : []) {
  const code = countryRowToAlpha2(c);
  if (code && !supportedList.includes(code)) supportedList.push(code);
}

// ---------------------------------------------------------------------------
// classifier.js — the rule-based fallback, ported verbatim. When the LLM node
// ($input, the immediate predecessor "Classify Inquiry") returns a VALIDATED
// classification we use it; on any failure we fall back to rules. Same
// validate-then-use / else-rule discipline as buildDossier.js.
// ---------------------------------------------------------------------------
// THE RESTRICTED JURISDICTIONS ARE IN HERE FOR A REASON — DO NOT TRIM THEM.
// This dictionary is the ONLY thing that turns a country NAME in a ticket into
// a code, and every destination gate below reads that code. Until 2026-08-19
// not one member of SANCTIONED_OR_RESTRICTED (declared further down) appeared
// here, so on the rule-based path — the one that runs whenever the LLM is
// unconfigured AND on every LLM failure — "travelling to Iran" resolved to null
// and came back `escalate / destination_unknown`. A true refusal carrying a
// reason that describes THIS DICTIONARY rather than the trip, and one a
// specialist acts on differently. Kept in step with src/uc03/classifier.js,
// where the restricted half is DERIVED from the sanctions set rather than
// retyped; test/n8nUc03Parity.test.js compares the two copies, and the
// assertion immediately after SANCTIONED_OR_RESTRICTED below fails this node at
// startup if any code in that set has no name here.
const KNOWN_COUNTRIES = {
  spain: 'ES', germany: 'DE', france: 'FR', portugal: 'PT', italy: 'IT',
  netherlands: 'NL', ireland: 'IE', poland: 'PL',
  'united kingdom': 'GB', uk: 'GB', england: 'GB',
  'united states': 'US', usa: 'US', canada: 'CA', india: 'IN',
  philippines: 'PH', mexico: 'MX', nigeria: 'NG', estonia: 'EE',
  cuba: 'CU', iran: 'IR', 'north korea': 'KP', dprk: 'KP', syria: 'SY',
  russia: 'RU', 'russian federation': 'RU', belarus: 'BY', myanmar: 'MM',
  burma: 'MM', venezuela: 'VE', afghanistan: 'AF', iraq: 'IQ',
};

// --- countryMentions.js port: word-boundary matching + an explicit "to" cue.
// The destination used to be the first key of the map above that appeared
// ANYWHERE in the text (Object.keys order), so "travelling from Spain to
// Germany" routed on Spain — the country being left — and any country name
// hiding inside a longer word ("Indianapolis" → india) became a destination.
// UC-03 routes on this value, so it decides whose rules get applied. Keep in
// step with src/shared/countryMentions.js (test/n8nUc03Parity.test.js compares).
const DESTINATION_CUE = /(?:^|[^a-z])(?:to|into)\s+(?:the\s+)?$/;
const CUE_WINDOW = 24;

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findCountryMentions(text) {
  const lower = (text || '').toLowerCase();
  const hits = [];
  for (const key of Object.keys(KNOWN_COUNTRIES)) {
    const pattern = new RegExp('(?<![a-z0-9])' + escapeRegExp(key) + '(?![a-z0-9])', 'g');
    let m;
    while ((m = pattern.exec(lower)) !== null) {
      hits.push({ code: KNOWN_COUNTRIES[key], index: m.index, length: m[0].length });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  return hits.map((h) => {
    const before = lower.slice(Math.max(0, h.index - CUE_WINDOW), h.index);
    return { code: h.code, cue: DESTINATION_CUE.test(before) ? 'destination' : null };
  });
}

function distinctCountryCodes(mentions) {
  const out = [];
  for (const m of mentions) if (out.indexOf(m.code) === -1) out.push(m.code);
  return out;
}

// One explicit "to X" cue wins; otherwise a single named country is the
// destination ("work from Portugal" — UC-03's origin is the employment record,
// never the ticket); otherwise null, which policyEngine.js already escalates as
// destination_unknown rather than routing on a guess.
function resolveDestinationCountry(text) {
  const mentions = findCountryMentions(text);
  const all = distinctCountryCodes(mentions);
  const cued = distinctCountryCodes(mentions.filter((m) => m.cue === 'destination'));
  if (cued.length === 1) return cued[0];
  if (cued.length > 1) return null;
  return all.length === 1 ? all[0] : null;
}
const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
const VALID_INTENTS = new Set(['business_travel', 'work_authorization']);

// D-04, mirrored verbatim from src/uc03/classifier.js — see that file's
// header comment for why this exists and why it never overrides a real
// destination or a matched travel-intent pattern.
const NON_TRAVEL_SIGNAL_PATTERNS = [
  /\blandlord\b/i,
  /\blease\b/i,
  /\brental application\b/i,
  /\bmortgage\b/i,
  /\bapartment application\b/i,
  /\bproof of employment\b/i,
  /\bemployment verification\b/i,
  /\bverify my employment\b/i,
  /\bnot travel(?:l?ing)?\b/i,
];

function parseItineraryDates(text) {
  const lower = (text || '').toLowerCase();
  let startDate = null;
  let endDate = null;

  // ISO dates first — explicit, no inference needed.
  const iso = [...lower.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map((m) => m[0]);
  if (iso.length >= 1) startDate = iso[0];
  if (iso.length >= 2) endDate = iso[1];

  // Month-name forms ("March 1", "1 March", "March 1st"). Only filled when the
  // ISO pass found nothing, so an explicit ISO date always wins over inference.
  const monthPat = Object.keys(MONTHS).join('|');
  const forward = new RegExp(`\\b(${monthPat})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g');
  const reverse = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPat})\\b`, 'g');
  const found = [];
  for (const m of lower.matchAll(forward)) found.push({ order: m.index, month: m[1], day: m[2] });
  for (const m of lower.matchAll(reverse)) found.push({ order: m.index, month: m[2], day: m[1] });
  found.sort((a, b) => a.order - b.order);

  if (found.length && (startDate === null || endDate === null)) {
    const year = new Date().getFullYear();
    const toIso = ({ month, day }) => `${year}-${MONTHS[month]}-${day.padStart(2, '0')}`;
    if (startDate === null && found.length >= 1) startDate = toIso(found[0]);
    if (endDate === null && found.length >= 2) endDate = toIso(found[1]);
  }

  if (startDate && endDate && endDate < startDate) {
    // A span that reads backwards must cross a year boundary ("Dec 28 – Jan
    // 4"): assume the end is in the following year.
    endDate = `${Number(endDate.slice(0, 4)) + 1}${endDate.slice(4)}`;
  }

  return { startDate, endDate };
}

function classifyTravelRuleBased({ text }) {
  const lower = (text || '').toLowerCase();
  const destinationCountry = resolveDestinationCountry(text);

  const workFromAbroadPatterns = [
    /\bwork(?:ing)?\s+(?:from|in|at)\s/i,
    /\bwork(?:ing)?\s+abroad\b/i,
    /\bwork(?:ing)?\s+remotely\b/i,
    /\bremote work\b/i,
    /\bcontinue(?: to)?\s+work\b/i,
    /\bextend(?:ing)?\b[^.]*\bwork\b/i,
    /\bdo(?:ing)?\s+my\s+(?:job|work)\b/i,
    /\bcode\s+from\b/i,
    /\bpick up\s+my\s+normal\s+(?:work|duties|job)\b/i,
  ];
  const businessTravelPatterns = [
    /\bclient meeting\b/i, /\bconference\b/i, /\bbusiness meeting\b/i,
    /\bsite visit\b/i, /\boffsite\b/i, /\bpartner meeting\b/i,
    /\bnegotiations?\b/i, /\bcorporate retreat\b/i, /\bindustry event\b/i,
    /\battend(?:ing)?\b/i,
  ];
  // MATCHED vs DEFAULTED — see src/uc03/classifier.js. `business_travel` is
  // both a real reading and the fallback, so intent alone cannot say whether
  // anything was recognised, and confidence below needs to know.
  const intentMatched =
    workFromAbroadPatterns.some((re) => re.test(lower)) || businessTravelPatterns.some((re) => re.test(lower));
  const intent = workFromAbroadPatterns.some((re) => re.test(lower))
    ? 'work_authorization'
    : businessTravelPatterns.some((re) => re.test(lower))
      ? 'business_travel'
      : 'business_travel';

  // D-04. Computed here, before confidence — mirrors src/uc03/classifier.js.
  const nonTravelSignal =
    !destinationCountry && !intentMatched && NON_TRAVEL_SIGNAL_PATTERNS.some((re) => re.test(lower));

  const formalLetterRequested = /support letter|letter of invitation|invitation letter|travel (support )?letter|letter for (my )?visa|visa application|port-of-entry|visa support/i.test(
    lower
  );

  const { startDate, endDate } = parseItineraryDates(text);
  //
  // THREE LEVELS, NOT TWO, AND THE THIRD IS THE WHOLE POINT. This used to read
  // `destinationCountry && startDate ? 0.9 : 0.6`, so a request this scan could
  // read NOTHING out of scored exactly 0.6 — and the gate that is supposed to
  // catch that compares `confidence < 0.6`. 0.6 is not below 0.6, so on the
  // rule-based path the confidence gate has never once fired. It looked like a
  // control and was arithmetic that could not fail.
  //
  // Nothing went wrong because of it, which is why it survived: the destination
  // gate refused those requests a few rungs later, for a different stated
  // reason. That cover disappears the moment a requester can state the
  // destination on a form, because then an unreadable request arrives at the
  // gates with a perfectly good destination in it. "Hello." plus a filled-in
  // trip would have auto-resolved.
  //
  // So the two useful signals stay where they were — both facts read is 0.9,
  // one of them is 0.6 and still passes, because "Spain, no dates" is a request
  // we genuinely did read and the day-count gate is the right one to stop it —
  // and TOTAL failure now scores below the floor, where it always belonged.
  // The threshold and its comparison are untouched; only the score for "I read
  // nothing" moved to a value the comparison can actually reject.
  // `nonTravelSignal` counts as "read something" too — mirrors src/uc03/classifier.js.
  const readSomething = Boolean(destinationCountry) || Boolean(startDate) || intentMatched || nonTravelSignal;
  const confidence = destinationCountry && startDate ? 0.9 : readSomething ? 0.6 : 0.3;

  // No rule-based list here — the deterministic scan lives in
  // assessLetterScope() and runs on every path, so a second copy would be the
  // "exists twice" shape. [] means this reader contributed nothing.
  return {
    intent,
    destinationCountry,
    startDate,
    endDate,
    formalLetterRequested,
    letterSpecialRequests: [],
    confidence,
    nonTravelSignal,
  };
}

// ONE DATE RULE FOR BOTH READERS, ported from src/uc03/statedTrip.js's
// isIsoCalendarDate(). `Date.parse()` is not enough anywhere: it accepts
// "Sept 14 2026" and "09/14/2026", and the second is read US month-first, which
// is a six-month error rather than a rejection. The round-trip makes it a
// CALENDAR check — "2026-02-31" matches the pattern and rolls forward to March.
function isIsoCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// One LLM date, quarantined on its own. NOT part of isValidClassification()
// below, deliberately, and src/uc03/classifier.js carries the full argument:
// failing the whole shape would retry the model three times and then throw away
// a correct reading of the intent and the destination over one date written in
// the wrong notation. An unusable date becomes ABSENT — never guessed at — and
// the trip then has no computable length, so the run refuses `duration_unknown`
// and a person decides it.
function usableLlmDate(value) {
  if (value === null || value === undefined || value === '') return null;
  return isIsoCalendarDate(value) ? value : null;
}

function isValidClassification(obj) {
  return (
    obj &&
    VALID_INTENTS.has(obj.intent) &&
    (obj.destinationCountry === null || typeof obj.destinationCountry === 'string') &&
    (obj.startDate === null || typeof obj.startDate === 'string') &&
    (obj.endDate === null || typeof obj.endDate === 'string') &&
    typeof obj.formalLetterRequested === 'boolean' &&
    // Optional, validated when present — src/uc03/classifier.js's reasoning
    // verbatim: a model that omits it falls back to the deterministic scan
    // rather than failing the whole classification, and a present-but-unusable
    // list is a FINDING in assessLetterScope() rather than an ignored value.
    (obj.letterSpecialRequests === undefined ||
      (Array.isArray(obj.letterSpecialRequests) && obj.letterSpecialRequests.every((v) => typeof v === 'string'))) &&
    typeof obj.confidence === 'number' &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

let classification;
try {
  const raw = $input.first().json?.choices?.[0]?.message?.content;
  if (typeof raw === 'string' && raw) {
    const candidate = JSON.parse(raw);
    if (isValidClassification(candidate)) {
      classification = {
        intent: candidate.intent,
        destinationCountry: candidate.destinationCountry || null,
        startDate: usableLlmDate(candidate.startDate),
        endDate: usableLlmDate(candidate.endDate),
        formalLetterRequested: Boolean(candidate.formalLetterRequested),
        letterSpecialRequests: Array.isArray(candidate.letterSpecialRequests) ? candidate.letterSpecialRequests : [],
        confidence: candidate.confidence,
        source: 'llm',
      };
    } else {
      classification = { ...classifyTravelRuleBased({ text: request.text }), source: 'rule_based_fallback' };
    }
  } else {
    classification = { ...classifyTravelRuleBased({ text: request.text }), source: 'rule_based_fallback' };
  }
} catch (e) {
  classification = { ...classifyTravelRuleBased({ text: request.text }), source: 'rule_based_fallback' };
}

// ---------------------------------------------------------------------------
// identity.js: verifyRequest(). An n8n ticket carries no Remote session, and a
// claimed email proves nothing — so identity is derived the same deterministic
// way shared/identity.js does: a session's authenticatedEmploymentId is matched
// against the authoritative employment record, and it fails closed on any gap
// (no session, a non-matching id, or no employment record all mean unverified).
// ---------------------------------------------------------------------------
function verifyRequesterIdentity(session, employment) {
  // THE PRECONDITION THIS WHOLE FUNCTION RESTS ON: `employment` is an
  // authoritative record or it is null — never a placeholder assembled from
  // the request. Enforced at the construction site above, not here, because a
  // check that merely refuses a bad value is one bug away from accepting one
  // (the reasoning UC-08 uses to delete its write parameter outright rather
  // than guard it). Both conditions are kept as defence in depth.
  if (!employment || !employment.id) {
    return { verified: false, method: 'none', reason: 'no_employment_record' };
  }
  if (session && session.authenticatedEmploymentId) {
    if (session.authenticatedEmploymentId === employment.id) {
      return { verified: true, method: 'session', reason: 'authenticated_session' };
    }
    return { verified: false, method: 'session', reason: 'session_employment_mismatch' };
  }
  // Zendesk channel: no Remote session exists, so the next-best AUTHENTICATED
  // signal is the requester Zendesk itself authenticated (set by the normalizer
  // from ticket.requester.email only — never an address typed into the body),
  // matched against the email on the authoritative Remote record. Same rule as
  // UC-01's workflows/nodes/gates.js. Fails closed on any gap. Unreachable
  // unless authenticatedEmail is present, so every session-based fixture is
  // unchanged.
  if (session && session.authenticatedEmail) {
    const recordEmail = employment.email ? String(employment.email).toLowerCase() : null;
    if (!recordEmail) {
      return { verified: false, method: 'email', reason: 'no_email_on_employment_record' };
    }
    return session.authenticatedEmail === recordEmail
      ? { verified: true, method: 'email', reason: 'requester_matches_employment' }
      : { verified: false, method: 'email', reason: 'requester_email_mismatch' };
  }
  return { verified: false, method: 'none', reason: 'unauthenticated_requires_stepup' };
}
const identity = verifyRequesterIdentity(request.session, employment);

// ---------------------------------------------------------------------------
// policyEngine.js — the thin router, ported verbatim (computeDurationDays +
// evaluate, with its two defaults).
// ---------------------------------------------------------------------------
// AF and IQ come from Remote's OWN exclusions, not from anyone's judgement
// here: `GET /v1/countries` returns 224 rows and the 26 alpha-2 codes it omits
// are the sanctions/embargo set plus uninhabited and dependent territories.
// Among sovereign states those exclusions are a strict SUPERSET of the eight
// codes this list originally held — they also omit Afghanistan and Iraq
// (verified live 2026-08-17). Kept here as well as inherited from the registry
// because a control that only works while an upstream list stays correct is
// not a control, and the registry's stated membership rule is about company
// creation, not travel. Strictly more restrictive, so fail-closed-safe.
// See src/uc03/policyEngine.js and docs/research/COUNTRY-SUPPORT-SEMANTICS.md
// §4.2 / §8; test/n8nUc03Parity.test.js enforces that both copies agree.
const SANCTIONED_OR_RESTRICTED = new Set(['CU', 'IR', 'KP', 'SY', 'RU', 'BY', 'MM', 'VE', 'AF', 'IQ']);

// Every restricted code must be REACHABLE from free text, or this gate cannot
// fire on the rule-based path at all and the request escalates as
// `destination_unknown` — a real refusal wearing a reason that is false about
// the trip and true only about the dictionary. Checked here rather than trusted
// because the two lists sit 200 lines apart in one file and in two files
// overall: adding a code to the set above and forgetting the name is exactly
// the edit that reopened nothing visible for months. n8n surfaces the throw as
// a failed node, which is the loud failure this deserves.
{
  const reachable = new Set(Object.keys(KNOWN_COUNTRIES).map((k) => KNOWN_COUNTRIES[k]));
  const unreachable = [...SANCTIONED_OR_RESTRICTED].filter((c) => !reachable.has(c));
  if (unreachable.length) {
    throw new Error(
      'travelRouterGates: restricted destination(s) ' + unreachable.join(', ') +
        ' have no name in KNOWN_COUNTRIES, so the sanctions gate cannot fire for them on the ' +
        'rule-based path. Add the name(s) here and in src/uc03/classifier.js.'
    );
  }
}
const DEFAULT_DURATION_CAP_DAYS = 30;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6; // see src/uc03/policyEngine.js for why this is not UC-01's 0.85

function computeDurationDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// letterScope.js: assessLetterScope() — can the template say what was asked?
// ---------------------------------------------------------------------------
// A VERBATIM PORT of src/uc03/letterScope.js's marker table and assessment,
// kept identical by test/n8nUc03Parity.test.js. Do not "simplify" a pattern
// here: the two copies are compared, and a divergence in either direction is a
// production graph deciding differently from the reference implementation.
//
// It does NOT decide whether a letter may be issued without a human. Remote
// settled that: `TravelLetterRequest.status` documents `approved_by_remote` as
// "Fully approved by both the manager and Remote. The travel letter will be
// generated", and the update body is a closed oneOf over approved_by_manager |
// declined_by_manager, so no client can reach the generating state. What this
// decides is whether the STANDARD TEMPLATE can express the request — because
// renderTravelLetterHtml() has fixed rows and no free-text block, so an
// addressee, a passport number or a required sentence was previously dropped
// from the document in silence.
//
// A MODEL MAY ONLY EVER ADD A FINDING. `standard` is the ABSENCE of findings;
// there is no input field meaning "this is standard", so nothing a model
// returns can produce one. An unusable model list, or an unreadable request
// text, is itself a finding.
const NON_STANDARD_ASKS = [
  {
    code: 'addressee_specified',
    patterns: [
      /\baddress(?:ed|ing)?\s+(?:it|the letter|this)?\s*to\b/i,
      /\bmade?\s+out\s+to\b/i,
      /\bfor the attention of\b/i,
      /\battn\b[.: ]/i,
      /\baddressed\b/i,
    ],
  },
  {
    code: 'identity_document_requested',
    patterns: [
      /\bpassport\s*(?:number|no\b|#)/i,
      /\btravel document number\b/i,
      /\bdate of birth\b/i,
      /\bd\.?o\.?b\.?\b/i,
      /\bid (?:card )?number\b/i,
    ],
  },
  {
    code: 'cost_responsibility_requested',
    patterns: [
      /\b(?:who|company|employer|we|they)\s+(?:will\s+)?(?:pay|pays|is paying|are paying)\b/i,
      /\bcover(?:s|ing|ed)?\s+(?:all\s+|the\s+|my\s+)?(?:cost|costs|expenses|travel|accommodation|meals)\b/i,
      /\bbear(?:s|ing)?\s+the\s+cost/i,
      /\bat (?:the )?company(?:'s)? expense\b/i,
      /\bexpenses? (?:are|is|will be) (?:covered|paid)\b/i,
      /\bsponsor(?:s|ed|ship)?\b/i,
    ],
  },
  {
    code: 'accommodation_address_requested',
    patterns: [
      /\baccommodation address\b/i,
      /\bhotel (?:address|booking|details)\b/i,
      /\baddress (?:where|at which) I(?:'ll| will| am)? ?(?:be )?stay/i,
      /\bwhere I(?:'m| am| will be) staying\b/i,
    ],
  },
  {
    code: 'wording_specified',
    patterns: [
      /\b(?:must|should|needs? to|has to) (?:state|say|mention|include|confirm|read)\b/i,
      /\bplease (?:state|say|include|mention|add|confirm that)\b/i,
      /\bword(?:ed|ing)\b/i,
      /\bexact(?:ly)? (?:wording|phrase|format)\b/i,
      /\b(?:their|this|the attached|enclosed) (?:own )?(?:form|template|pro ?forma)\b/i,
      /\bfill (?:in|out) (?:the|this|their) (?:form|template)\b/i,
      /\bin the following (?:format|wording|terms)\b/i,
    ],
  },
  {
    code: 'omission_requested',
    patterns: [
      /\b(?:do ?n[o']?t|don't|do not|please don't|please do not) (?:include|mention|state|put|show)\b/i,
      /\bleave out\b/i,
      /\bomit\b/i,
      /\bwithout (?:my |the )?(?:salary|compensation|pay|earnings)\b/i,
      /\bno (?:salary|compensation) (?:in|on) the letter\b/i,
    ],
  },
  {
    code: 'language_or_legalisation_requested',
    patterns: [
      /\bin (?:spanish|french|german|dutch|portuguese|italian|polish|the local language)\b/i,
      /\btranslat(?:e|ed|ion)\b/i,
      /\bnotar(?:ise|ize|ised|ized|isation|ization|y)\b/i,
      /\bapostille\b/i,
      /\blegalis(?:e|ed|ation)\b|\blegaliz(?:e|ed|ation)\b/i,
      /\b(?:wet |company |official )?(?:stamp|stamped|seal|sealed)\b/i,
      /\b(?:hand[- ]?)?signed (?:copy|original|in ink)\b/i,
    ],
  },
];

const TEMPLATE_EMPLOYMENT_FIELDS = ['full_name', 'job_title', 'status', 'contract_type', 'start_date'];
const TEMPLATE_ITINERARY_FIELDS = ['destinationCountry', 'startDate', 'endDate'];

function assessLetterScope({ requestText, classification, employment, confidenceThreshold }) {
  const minConfidence = confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const findings = [];
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

  if (typeof requestText !== 'string' || requestText.trim() === '') {
    findings.push({ code: 'request_text_unavailable' });
  } else {
    for (const ask of NON_STANDARD_ASKS) {
      if (ask.patterns.some((re) => re.test(requestText))) findings.push({ code: ask.code });
    }
  }

  const modelAsks = classification && classification.letterSpecialRequests;
  if (modelAsks !== undefined && modelAsks !== null) {
    const usable = Array.isArray(modelAsks) && modelAsks.every((v) => typeof v === 'string');
    if (!usable) {
      findings.push({ code: 'model_reading_unusable' });
    } else {
      for (const raw of modelAsks) {
        if (raw.trim() !== '') findings.push({ code: 'model_flagged_special_request' });
      }
    }
  }

  for (const field of TEMPLATE_EMPLOYMENT_FIELDS) {
    if (!employment || blank(employment[field])) findings.push({ code: `missing_${field}` });
  }
  for (const field of TEMPLATE_ITINERARY_FIELDS) {
    if (!classification || blank(classification[field])) findings.push({ code: `missing_${field}` });
  }

  const confidence = classification && classification.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < minConfidence) {
    findings.push({ code: 'classification_not_trusted' });
  }

  return { standard: findings.length === 0, findings };
}

const UC03_EOR_ENGAGEMENTS = ['eor', 'eor_employee', 'employee', 'full_time', 'part_time'];
const UC03_NON_EOR_ENGAGEMENTS = {
  contractor: 'engagement_not_eor_contractor',
  independent_contractor: 'engagement_not_eor_contractor',
  global_payroll: 'engagement_not_eor_direct',
  global_payroll_employee: 'engagement_not_eor_direct',
  direct: 'engagement_not_eor_direct',
  direct_employee: 'engagement_not_eor_direct',
  hris_employee: 'engagement_not_eor_direct',
  hris: 'engagement_not_eor_direct',
};
const UC03_ONBOARDING_STATUSES = ['created', 'initiated', 'pending', 'invited', 'onboarding', 'pre_hire'];
const UC03_OFFBOARDING_STATUSES = ['offboarding', 'notice', 'serving_notice', 'leaving', 'termination_pending'];
const uc03Lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function classifyEngagementUc03(rec) {
  if (!rec) return { eligible: true, engagement: null };
  const st = uc03Lower(rec.status);
  if (UC03_OFFBOARDING_STATUSES.indexOf(st) !== -1) {
    return { eligible: false, decision: 'escalate', reason: 'engagement_offboarding', flag: 'engagement_status_' + st, engagement: uc03Lower(rec.contract_type) || null };
  }
  const eng = uc03Lower(rec.contract_type);
  if (!eng || eng === 'unknown') {
    return { eligible: false, decision: 'blocked', reason: 'eor_status_unknown', flag: 'engagement_unreadable', engagement: eng || null };
  }
  if (UC03_NON_EOR_ENGAGEMENTS[eng]) {
    return { eligible: false, decision: 'blocked', reason: UC03_NON_EOR_ENGAGEMENTS[eng], flag: 'engagement_' + eng, engagement: eng };
  }
  if (UC03_EOR_ENGAGEMENTS.indexOf(eng) === -1) {
    return { eligible: false, decision: 'blocked', reason: 'eor_status_unknown', flag: 'engagement_unrecognised_' + eng, engagement: eng };
  }
  if (UC03_ONBOARDING_STATUSES.indexOf(st) !== -1) {
    return { eligible: false, decision: 'blocked', reason: 'engagement_onboarding_incomplete', flag: 'engagement_status_' + st, engagement: eng };
  }
  return { eligible: true, engagement: eng };
}

function route({ employment, classification, identity, supportedCountries, upstreamFailures, sanctionedRegions, durationCapDays, confidenceThreshold, requestText, letterheadAvailable, letterAutoIssue }) {
  const supported = supportedCountries ?? new Set();
  const sanctioned = sanctionedRegions ?? SANCTIONED_OR_RESTRICTED;
  const cap = durationCapDays ?? DEFAULT_DURATION_CAP_DAYS;
  const minConfidence = confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const flags = [];

  // ENGAGEMENT ELIGIBILITY, ahead of identity. Port of the gate
  // src/uc03/policyEngine.js added 2026-09-03, which itself imports
  // src/uc01/engagementEligibility.js. INLINED rather than imported for the
  // usual reason (a Code node imports nothing), and the classes and decisions
  // are copied EXACTLY from that module — test/n8nUc03Parity.test.js runs this
  // body against the real one and will fail on any divergence.
  //
  // The offboarding-record read is absent here for the same reason it is
  // absent from the reference implementation's call: UC-03 makes no such call
  // on either path, and this decides on the record's own status, which is what
  // the reference passes `null` to get.
  const engagement = classifyEngagementUc03(employment);
  if (!engagement.eligible) {
    flags.push(engagement.flag);
    return {
      decision: engagement.decision,
      flags,
      reason: engagement.reason,
      engagement: engagement.engagement,
      durationDays: null,
    };
  }

  if (!identity.verified) {
    flags.push(`identity_${identity.reason}`);
    return { decision: 'escalate', flags, reason: 'identity_not_verified', durationDays: null };
  }

  if (employment.status !== 'active') {
    flags.push(`employment_status_${employment.status}`);
    return { decision: 'escalate', flags, reason: 'employee_not_active', durationDays: null };
  }

  // Confidence gate (UC-03.md §7 bullet 1), BEFORE any intent-based routing:
  // every decision below is made ON the classified intent, so an intent we are
  // not confident in must not be acted on. FAILS CLOSED — `undefined < 0.85`
  // and `NaN < 0.85` are both false. Mirrors src/uc03/policyEngine.js step 3
  // (test/n8nUc03Parity.test.js enforces that the two agree).
  const confidence = classification.confidence;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    flags.push('confidence_unknown');
    return { decision: 'human_review', flags, reason: 'confidence_unknown', durationDays: null };
  }
  if (confidence < minConfidence) {
    flags.push('low_confidence');
    return { decision: 'human_review', flags, reason: 'low_confidence', durationDays: null };
  }

  if (classification.intent === 'work_authorization') {
    flags.push('uc04_work_authorization');
    return {
      decision: 'route_to_uc04',
      route: 'uc04_work_authorization',
      flags,
      reason: 'work_authorization_requested',
      durationDays: null,
    };
  }

  // Country codes normalised ONCE here, on both the key and the two sets —
  // `Set.has()` is case-sensitive, so an LLM-emitted "ru" used to miss the
  // sanctions override entirely (UC-04's finding F-13, same defect class).
  // Mirrors src/uc03/policyEngine.js's normalizeCountryCode/normalizeCountrySet
  // boundary; inlined because an n8n Code node cannot import.
  const normCode = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
  const normSet = (codes) => {
    const out = new Set();
    for (const c of codes ?? []) {
      const n = normCode(c);
      if (n) out.add(n);
    }
    return out;
  };
  const destinationCountry = normCode(classification.destinationCountry);

  if (!destinationCountry) {
    flags.push('destination_unknown');
    // D-04, ported from src/uc03/policyEngine.js — same decision, same
    // reason, one additive flag naming a second possibility read from the
    // same text: this may not be a travel request at all.
    if (classification.nonTravelSignal === true) flags.push('possible_non_travel_request');
    return { decision: 'escalate', flags, reason: 'destination_unknown', durationDays: null };
  }

  if (normSet(sanctioned).has(destinationCountry)) {
    flags.push('sanctioned_region');
    return {
      decision: 'escalate',
      flags,
      reason: 'sanctioned_region',
      durationDays: null,
    };
  }

  // 6b. …but FIRST: did we actually READ the registry the next gate consults?
  // An unreadable list and an empty list are the same value by the time
  // `supported` is built, and only one of them is a fact about the destination.
  //
  // POSITION IS DELIBERATE — after the sanctions override, before the registry
  // check. Sanctions are held locally and stay knowable when Remote is
  // unreachable, so a sanctioned destination keeps its own, more actionable
  // reason; everything below this line genuinely depends on the read.
  // `upstreamVerdict()` only ever returns an escalate, so this can change a
  // refusal's recorded REASON and can never turn one into an approval.
  // Mirrors src/uc03/policyEngine.js step 6b exactly.
  const registryFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'countries'));
  if (registryFailure) return Object.assign({}, registryFailure, { durationDays: null });

  // The destination must appear in Remote's own country registry
  // (`GET /v1/countries`). The flag used to read `unsupported_destination`,
  // which asserts "Remote does not support this country" — a claim this test
  // cannot make. Remote's stated membership rule for that list is *"the
  // countries present in the list are the ones where creating a company is
  // allowed"*, so its exclusions are the sanctioned / signup-prevented set, and
  // the honest name says *jurisdiction excluded*. Deliberately NOT
  // `eor_onboarding: true` — that flag is Remote's EOR entity footprint (91 of
  // 224 rows) and gating travel on it would escalate a fortnight in Montenegro
  // and a French employee's trip to Martinique. Full reasoning in
  // src/uc03/policyEngine.js step 7 and
  // docs/research/COUNTRY-SUPPORT-SEMANTICS.md §5/§8. Historical `audit_log`
  // rows keep the old string; nothing rewrites them.
  if (!normSet(supported).has(destinationCountry)) {
    flags.push('destination_jurisdiction_excluded');
    return { decision: 'escalate', flags, reason: 'destination_jurisdiction_excluded', durationDays: null };
  }

  const durationDays = computeDurationDays(classification.startDate, classification.endDate);
  if (durationDays === null) {
    flags.push('duration_unknown');
    return { decision: 'escalate', flags, reason: 'duration_unknown', durationDays };
  }

  if (durationDays > cap) {
    flags.push('duration_over_cap');
    return { decision: 'escalate', flags, reason: 'duration_over_cap', durationDays };
  }

  // A letter was asked for. STANDARD -> one signature on a prepared document;
  // NON-STANDARD -> escalate with the findings and draft nothing, because a
  // template that cannot say what was asked produces a document nobody should
  // sign. Mirrors src/uc03/policyEngine.js rung 10 exactly.
  if (classification.formalLetterRequested) {
    const scope = assessLetterScope({
      requestText: requestText ?? null,
      classification,
      employment,
      confidenceThreshold: minConfidence,
    });
    if (!scope.standard) {
      flags.push('letter_scope_exceeded');
      for (const finding of scope.findings) flags.push(`letter_${finding.code}`);
      return { decision: 'escalate', flags, reason: 'letter_scope_exceeded', durationDays };
    }
    // THE STANDARD LETTER ISSUES WITH NO SIGNATURE, and the only thing that can
    // still send it to a person is the LETTERHEAD. Mirrors
    // src/uc03/policyEngine.js's letter rung exactly — the reasoning is there
    // and in docs/use-cases/UC-03.md §21, and is not repeated here.
    //
    // `letterheadAvailable` DEFAULTS TO FALSE, which is the human path, and on
    // THIS graph it is false unless a `Fetch Legal Entity (Remote)` node exists
    // upstream (see where it is read, below). A deployed graph without that node
    // therefore keeps the behaviour it has today — strictly the more cautious of
    // the two outcomes — rather than issuing letters on a half-built graph.
    if (letterAutoIssue === false) {
      flags.push('formal_letter_requested');
      return { decision: 'human_review', flags, reason: 'formal_letter_requested', durationDays };
    }
    if (!letterheadAvailable) {
      flags.push('formal_letter_requested');
      flags.push('letterhead_unavailable');
      return { decision: 'human_review', flags, reason: 'formal_letter_requested', durationDays };
    }
    // No flag: `classifyRisk()` reads flags as ESCALATION flags, and this is the
    // routine outcome. See the same note in src/uc03/policyEngine.js.
    return { decision: 'auto_resolve', flags, reason: 'standard_letter_issued', durationDays };
  }

  return { decision: 'auto_resolve', flags, reason: 'all_gates_passed', durationDays };
}

/**
 * Does this run have a usable employing entity to write a letter on?
 *
 * MIRRORS src/uc03/workflow.js's STEP 3b: `getLegalEntity()` returns null on a
 * 404 and an entity with no `name` is no letterhead, so both resolve to false.
 * The guard around `$()` is the n8n-specific half — on the reference
 * implementation an absent read is an exception this file cannot have, because
 * a Code node that throws loses the whole decision.
 */
function readLetterheadAvailable() {
  try {
    const json = $('Fetch Legal Entity (Remote)').first().json;
    const entity = json?.data?.legal_entity ?? json?.data ?? json;
    return Boolean(entity && typeof entity.name === 'string' && entity.name.trim());
  } catch {
    return false;
  }
}


// ---------------------------------------------------------------------------
// composeInternalNote() — the Zendesk internal note, composed HERE
// ---------------------------------------------------------------------------
// WHY THIS IS IN THIS FILE AND NOT IN FIVE NODE PARAMETERS.
//
// UC-03's five terminal Zendesk nodes each carried a sentence typed once into a
// node parameter. A Zendesk node has no `jsCode`, so `verify-deployed`'s body
// diff is structurally blind to it and all five sit in
// `scripts/lib/unguarded-node-baseline.json` as accepted debt — prose written
// onto real customers' tickets, versioned by nothing and read back by no check.
// `test/n8nUc03Parity.test.js` cannot see it either, by its own design: it
// compares DECISIONS, and a node that reaches the right verdict and describes it
// in false words passes it every time. Two of the five sentences were measurably
// false; one of them was FALSE ADVICE TO THE CUSTOMER. See
// `workflows/nodes-uc03/terminalZendeskNodesSpec.js`'s header for the evidence
// per node.
//
// Composing here puts the prose in a file `verify-deployed` diffs byte for byte,
// and makes the per-decision difference a branch in reviewed code rather than
// five independent copies that drift. Same move, same reasoning, as
// `workflows/nodes/composeInternalNote.js` (UC-01) and `composeInternalNote()`
// in `workflows/nodes-uc04/workationGates.js`.
//
// IT IS EMITTED FOR EVERY DECISION, including `auto_resolve`, so a node that
// does not consume it today can adopt it without this file changing again.
//
// PURE, AND IT DECIDES NOTHING. It reads an outcome already reached and cannot
// change it. `route()` above is untouched by this addition, which is what keeps
// `test/n8nUc03Parity.test.js` green — the DECISION vocabulary is unchanged.
//
// --- WHY THE `means` TABLE IS PORTED AND NOT WRITTEN ------------------------
//
// `src/uc03/policyEngine.js`'s GATE_SEQUENCE already says, in reviewed prose,
// what each reason MEANS to a person. An n8n Code node cannot import it, so the
// established pattern in this repository is to COPY WITH ATTRIBUTION rather than
// invent a second wording — a second wording is a second thing to drift, and
// UC-01's composeInternalNote.js ports the identical table for the identical
// reason. `test/n8nUc03TerminalZendeskNodes.test.js` reads GATE_SEQUENCE out of
// `src/uc03/policyEngine.js` and asserts every row below is byte-identical to
// it, so a change to the reference wording fails here rather than diverging.
//
// ONE DECLARED REWRITE, AND IT IS NOT COSMETIC. Two of the fourteen `means`
// strings name **Global Mobility** as the owning team (`sanctioned_region`,
// `duration_over_cap`), while UC-03's routing table sends the ticket to
// **Travel & Mobility Support** and `Assign Routing`'s `routingNote` — appended
// to this note by the Zendesk node, a few words later — spells that correctly.
// Porting verbatim would put ONE TEAM, TWICE, IN TWO NAMES, SIX WORDS APART on
// a real ticket: the exact defect already recorded for UC-04 at
// `docs/ESCALATION-DESTINATIONS.md` §2.2, and one a specialist resolves by
// searching Zendesk for a group that does not exist. `docs/ESCALATION-
// DESTINATIONS.md` argues the src-side sentences should NOT simply be renamed
// (it would make them contradict themselves), so this is deliberately not fixed
// upstream by this pass — see this file's terminal-node spec header. Instead the
// substitution is DECLARED, applied to exactly two strings, and the parity test
// applies the SAME substitution to the src side before comparing, so a drift in
// the reference wording still fails.
const NOTE_MEANS_SUBSTITUTIONS = [
  { from: 'Global Mobility', to: 'the team this ticket is routed to' },
];

function applyNoteMeansSubstitutions(text) {
  let out = text;
  for (const s of NOTE_MEANS_SUBSTITUTIONS) out = out.split(s.from).join(s.to);
  return out;
}

// src/uc03/policyEngine.js's GATE_SEQUENCE, ported verbatim (position / reason /
// gate / means). `checks` is deliberately NOT ported: it is the PASSING
// condition, which a note describing the rung that REFUSED does not need, and
// every unported field is one less thing to keep in step.
const NOTE_GATE_SEQUENCE = [
  {
    position: 1,
    reason: 'engagement_not_eor_contractor',
    gate: 'engagement_eligibility',
    checks: "the person is employed through a Remote entity, which is who this product is for",
    means:
      "This person is engaged as an independent contractor. Remote's travel support letter is published for EOR customers only, and Remote states plainly that contractors are not eligible — it is not their legal employer, so it cannot write to an embassy about employment it does not hold. Nothing the employee adds changes that, and no specialist can sign it. Remote also states it cannot assist contractors with sponsored work-permit routes unless the client converts them to full-time employment.",
  },
  {
    position: 2,
    reason: 'engagement_not_eor_direct',
    gate: 'engagement_eligibility',
    checks: "the person is employed through a Remote entity, which is who this product is for",
    means:
      "Remote administers this person's payroll, but the company they work for is their legal employer. The travel support letter is published for EOR customers only, so the letter has to come from their own employer, who is the party that can attest to the employment an embassy is asking about.",
  },
  {
    position: 3,
    reason: 'engagement_onboarding_incomplete',
    gate: 'engagement_eligibility',
    checks: "the person is employed through a Remote entity, which is who this product is for",
    means:
      "Onboarding has not finished, so the employment a travel letter would state as an established fact is not in place yet. This is a wait, not a refusal of the trip.",
  },
  {
    position: 4,
    reason: 'engagement_offboarding',
    gate: 'engagement_eligibility',
    checks: "the person is employed through a Remote entity, which is who this product is for",
    means:
      "This employment is ending. The facts a travel letter would state are changing right now, and there may be a notice period, a severance or a dispute behind that — which is a Lifecycle Support conversation and not a travel one. This is the one class here that goes to a person rather than being refused outright.",
  },
  {
    position: 5,
    reason: 'eor_status_unknown',
    gate: 'engagement_eligibility',
    checks: "the person is employed through a Remote entity, which is who this product is for",
    means:
      "The engagement type could not be read from the employment record, so it could not be established that this is an engagement Remote issues travel letters for. An engagement nobody could read is not an eligible one — this fails closed on purpose, and the flag says whether the value was absent or simply not recognised.",
  },
  {
    position: 6,
    reason: 'identity_not_verified',
    gate: 'identity',
    means:
      'We could not confirm the person asking is the employee this trip is for, so nothing about their employment or travel was answered. This is a failure to VERIFY — it is not a finding that they are someone else.',
  },
  {
    position: 7,
    reason: 'employee_not_active',
    gate: 'employment_status',
    means:
      "The employment record is not active, so there is no live employment to give travel support against. A former or suspended employee's travel is not something this can answer.",
  },
  {
    position: 8,
    reason: 'confidence_unknown',
    gate: 'classification_confidence',
    means:
      'How sure we are about what this request is asking could not be established at all, so the reading of it was not acted on. A person confirms what is being asked before anything is decided. Nothing has been concluded about the trip itself.',
  },
  {
    position: 9,
    reason: 'low_confidence',
    gate: 'classification_confidence',
    means:
      'What this request is asking for could not be read confidently enough to act on, so a person reads it first. A request understood wrongly here would be answered wrongly in every way that follows. This says nothing about whether the trip is allowed.',
  },
  {
    position: 10,
    reason: 'work_authorization_requested',
    gate: 'intent_routing',
    means:
      "Nothing has been submitted on the employee's behalf and nobody is reviewing anything — this answer is the whole of what has happened so far. The next step is a work-authorization request the employee raises themselves in Remote's Request Hub, and it asks for details a travel message never states: the employee's nationality, the visa the employee intends to travel on, the job duties they will perform while away, whether they can sign contracts for the company. Whether working from the destination is allowed is settled on that request, and it has not been settled yet.",
  },
  {
    position: 11,
    reason: 'destination_unknown',
    gate: 'destination_known',
    means:
      'This request does not say which country is the destination, in a form that could be used — so nothing about the destination has been checked. The destination has to be established before anything else about the trip can be.',
  },
  {
    position: 12,
    reason: 'sanctioned_region',
    gate: 'sanctions',
    means: applyNoteMeansSubstitutions(
      'The destination is on the sanctioned or restricted list. This is not a support question at all — Global Mobility owns it, and no extra information from the employee changes that.'
    ),
  },
  {
    position: 13,
    reason: 'destination_jurisdiction_excluded',
    gate: 'supported_destination',
    means:
      "The destination could not be CONFIRMED as a country Remote supports. That may be because Remote does not support it, or because Remote's list of countries could not be read when this was answered — either way it is unconfirmed, which is not the same as confirmed-bad.",
  },
  {
    position: 14,
    reason: 'duration_unknown',
    gate: 'duration_computable',
    means:
      'Usable travel dates could not be read out of the request, so the length of the trip is unknown. The trip is not too long — nobody has established how long it is.',
  },
  {
    position: 15,
    reason: 'duration_over_cap',
    gate: 'duration_cap',
    means: applyNoteMeansSubstitutions(
      'The trip is longer than the cap for an automatic informational answer, so Global Mobility weighs it instead. Length is a risk signal here, not a refusal — a longer trip is allowed to be fine, it just is not decided here.'
    ),
  },
  {
    position: 16,
    reason: 'letter_scope_exceeded',
    gate: 'letter_within_template',
    means:
      'A formal travel letter was asked for, and it is not the standard one. The request asks for something the standard letter cannot express — a named addressee asked for in a sentence, particular wording, an identity document, a statement of who bears the costs, another language, or a row removed — or a row it states has no value behind it. NO LETTER WAS DRAFTED, deliberately: the standard one would have left out what was asked for without saying so, and that is the document somebody would then have been asked to sign. Everything that was asked for is listed with this request, beside what the standard letter cannot carry and why.',
  },
  {
    position: 17,
    reason: 'formal_letter_requested',
    gate: 'letter_issuable',
    means:
      "The standard letter was asked for and the trip qualifies for it, but it was not issued automatically. There are two reasons that can happen and this request is one of them: either every travel letter here needs a specialist's signature, in which case the letter IS drafted and is waiting for one — or the employing entity could not be read, in which case there is no letterhead, NOTHING WAS DRAFTED, and what is owed is a fix to the employing-entity record and a re-run rather than a signature. Every check about the trip itself passed either way.",
  },
  {
    position: 18,
    reason: 'standard_letter_issued',
    gate: 'standard_letter',
    means:
      'The employee asked for the standard travel letter, every check passed, and there was a letterhead to write it on — so it was written and issued to them straight away, with nobody in the path. This is the routine outcome this path is built for: checked, produced and closed in one pass. A letter that is NOT the standard one, a request that could not be read confidently, a traveller who does not qualify, or an employing entity that could not be read each stops earlier, with the document unwritten.',
  },
  {
    position: 19,
    reason: 'all_gates_passed',
    gate: 'outcome',
    means:
      "Every check passed, so the question was answered directly, with the standing note that entry requirements are the destination's to set. No formal travel letter was written — none was asked for, and an answer is not a letter. One is offered for the same trip, and accepting it does not mean describing the trip again.",
  },
];

function describeNoteGate(reasonSlug) {
  const row = NOTE_GATE_SEQUENCE.find((r) => r.reason === reasonSlug);
  if (!row) return null;
  const total = new Set(NOTE_GATE_SEQUENCE.map((r) => r.position)).size;
  return { position: row.position, gate: row.gate, means: row.means, total: total };
}

// THE FOUR INPUTS UC-03 CAN NEVER SOURCE, ported from
// src/uc03/uc04Intake.js's UC04_REQUIRED_INPUTS (the four rows whose `source`
// is null), in that file's own order and its own words. Held against the
// original by test, not by hope — the same reason `Assign Routing` ports the
// routing table rather than restating it.
const UC04_INPUTS_UC03_CANNOT_SOURCE = [
  "the employee's nationality",
  'the visa the employee intends to travel on',
  'the job duties they will perform while away',
  'whether they can sign contracts for the company',
];

// WHAT THIS EXECUTION PATH DOES AND DOES NOT WRITE, stated once.
//
// This graph's only durable writes are `audit_log`, `workflow_claims` and
// `audit_trace` — there is no `cases` insert and no `documents` insert anywhere
// on it. Two consequences reach whoever opens the ticket, and BOTH were
// previously invisible:
//   1. The Remote CX Review sidebar and `GET /uc03/api/cases/by-ticket/:ref`
//      resolve a `cases` row, so for an n8n-decided ticket they answer 404 /
//      `{"found": false}`. The retired note on `Flag For Formal Letter Review`
//      told a specialist the letter's "DRAFTED text is available in the UC-03
//      app" — pointing at a screen that has never held anything for this run.
//   2. Nothing on this graph renders a letter. There is no letter-render node
//      and no `documents` write, so NO DECISION ON THIS PATH PRODUCES A
//      DOCUMENT — including `standard_letter_issued`, whose own ported `means`
//      says a letter "was written and issued straight away" because on the Node
//      path it is. That reason is unreachable here today (it needs a
//      `Fetch Legal Entity (Remote)` node this graph does not have, so
//      `letterheadAvailable` is false and the run lands on
//      `formal_letter_requested` instead) — but "unreachable today" is one node
//      away from "reached and lying", so the note says the true thing on that
//      branch rather than relying on the branch staying dead.
// The FACT, stated once, and the INSTRUCTION built on it separately — because
// an auto-resolved ticket is not outstanding work and must not be told to be.
const NO_CASE_ROW_FACT =
  'This decision was made on the n8n execution path, whose only durable writes are audit_log, workflow_claims and ' +
  'audit_trace — it creates no cases row, so the Remote CX Review sidebar and the UC-03 API answer 404 for this ' +
  'ticket, and the audit_log row is the record.';

const WORKED_BY_HAND_SENTENCE =
  'WHERE THIS IS WORKED: on this ticket, by hand. ' +
  NO_CASE_ROW_FACT +
  ' There is no screen to open and no button to press; everything needed to act on it is in this note.';

const NO_DOCUMENT_SENTENCE =
  'No document exists anywhere for this run: this graph has no letter-render node and writes no documents row.';

/**
 * The internal note the ticket carries. DETERMINISTIC TEXT, never LLM-authored
 * — the same discipline as UC-01's composeInternalNote.js and UC-04's.
 *
 * @param {object} args
 * @param {object} args.outcome        route()'s return
 * @param {object|null} args.employment
 * @param {object} args.classification
 * @param {object} args.identity
 * @param {object|null} args.handoffEvent
 * @returns {string} plain text
 */
function composeInternalNote({ outcome, employment, classification, identity, handoffEvent }) {
  const decision = outcome.decision;
  const reason = outcome.reason;
  const flags = Array.isArray(outcome.flags) ? outcome.flags : [];
  const emp = employment ?? {};
  const lines = [];

  // --- WHO THIS IS ABOUT, withheld where the verdict is that we do not know --
  //
  // Same rule, same reasoning, as UC-01's composeInternalNote.js: when the
  // decision's OWN verdict is that we could not establish who is asking, a note
  // that then prints the subject's name, status and country discloses the record
  // the gate just refused to disclose. The gate meaning and the identity facts
  // below stay — they are what makes the note actionable — and only the
  // subject's own details are withheld.
  lines.push(
    reason === 'identity_not_verified'
      ? 'Regarding this employment — subject details withheld: we could not confirm the requester is the employee this ' +
        'trip is for, so nothing about who this is regarding is disclosed here.'
      : 'Regarding ' +
        (emp.full_name || 'an employee not named on this record') +
        (emp.job_title ? ' (' + emp.job_title + ')' : '') +
        ' — status: ' +
        (emp.status || 'not recorded') +
        ', contract: ' +
        (emp.contract_type || 'not recorded') +
        ', home country: ' +
        (emp.country_code || 'not recorded') +
        '.'
  );
  lines.push('');

  // --- WHO READ THE REQUEST, per run rather than per node --------------------
  //
  // Three of the five retired notes opened "AI summary — ", flatly, on every
  // run. It is defensible on this graph (there IS a real `Classify Inquiry
  // (LLM)` node) and it is still not a fact about any particular run: the model
  // is validated against a strict shape and ANY failure falls back verbatim to
  // the deterministic rules, which is the ordinary case here. `classification
  // .source` already records which one answered, so the note says the true
  // thing per run instead of a blanket claim. It also matters for a reader
  // deciding how much to trust the reading: "a model read this" and "a regex
  // table read this" are different warnings.
  lines.push(
    classification && classification.source === 'llm'
      ? 'AI-ASSISTED: a language model read the request text into a classification on this run (source: llm). Every gate ' +
        'below is deterministic and none of them consults the model again.'
      : 'NO MODEL WAS USED on this run: the request text was read by the deterministic rules (source: ' +
        ((classification && classification.source) || 'unknown') +
        '), which is what happens whenever the model is unreachable or returns a shape that does not validate. Every ' +
        'gate below is deterministic.'
  );
  lines.push('');

  // --- THE DECISION, AND THE RUNG THAT MADE IT -------------------------------
  const decidedBy = describeNoteGate(reason);
  lines.push(
    'Assessment: ' +
      decision +
      ' (' +
      reason +
      '). Flags: ' +
      (flags.length ? flags.join(', ') : 'none') +
      '.' +
      (typeof outcome.durationDays === 'number' ? ' Trip length as read: ' + outcome.durationDays + ' day(s).' : '') +
      (decidedBy
        ? ' Decided at gate ' + decidedBy.position + ' of ' + decidedBy.total + ' (' + decidedBy.gate + '): ' + decidedBy.means
        : ' This reason is not in the gate ladder — that is itself worth reporting, because every reason route() can ' +
          'return has a rung.')
  );
  lines.push('');

  // --- WHAT WAS PRODUCED, AND WHAT WAS NOT -----------------------------------
  //
  // "No letter was issued" was the one retired sentence that was TRUE on every
  // reachable input, and it is kept — moved in here with the rest rather than
  // left typed into a node parameter, which is the whole point of this
  // function. What is added is the same statement for the four decisions that
  // sentence never covered.
  if (decision === 'escalate') {
    lines.push('No letter was issued. ' + NO_DOCUMENT_SENTENCE);
  } else if (decision === 'human_review' && reason === 'formal_letter_requested') {
    // THE PORTED `means` ABOVE OFFERS TWO POSSIBILITIES AND THIS RUN IS ONE OF
    // THEM — resolved from the run's own flags rather than left to the reader.
    // `letterhead_unavailable` is pushed by route() only on the no-letterhead
    // branch, so its presence is the discriminator. On THIS graph it is always
    // present (there is no `Fetch Legal Entity (Remote)` node, so
    // `readLetterheadAvailable()` returns false), and the other branch is
    // written out anyway because a graph that later gains that node must not
    // start telling specialists to sign a document this path never writes.
    lines.push(
      flags.includes('letterhead_unavailable')
        ? 'NO LETTER WAS WRITTEN AND NONE IS WAITING FOR A SIGNATURE. The employing entity could not be read, so there ' +
          'was no letterhead to write on. What is owed here is a fix to the employing-entity record and a re-run — not ' +
          'a signature. ' +
          NO_DOCUMENT_SENTENCE
        : 'NO LETTER WAS WRITTEN. ' +
          NO_DOCUMENT_SENTENCE +
          ' The gate meaning above describes a drafted letter waiting for a signature because that is what happens on ' +
          'the Node execution path; on this one nothing is drafted, so do not go looking for a document to sign.'
    );
  } else if (decision === 'human_review') {
    // low_confidence (and confidence_unknown, which no input on this graph can
    // reach — the validator requires a numeric confidence and the rule-based
    // fallback always emits one). Copied from src/uc03/signoffPolicy.js's
    // describeUnconfirmed(), which refuses a sign-off on exactly this case:
    // what is owed is a READING, not a signature.
    lines.push(
      'NO LETTER WAS DRAFTED, deliberately: a formal letter built from an extraction the router itself refused to trust ' +
        'is not something anybody can responsibly sign. What is owed here is a reading of the request, not a signature — ' +
        'confirm what is being asked and re-run it. ' +
        NO_DOCUMENT_SENTENCE
    );
  } else if (decision === 'route_to_uc04') {
    lines.push(
      'No letter was issued and none was asked for. A travel letter certifies business travel, and this request is not ' +
        'about business travel. ' +
        NO_DOCUMENT_SENTENCE
    );
  } else if (decision === 'auto_resolve' && reason === 'standard_letter_issued') {
    lines.push(
      'THE DECISION SAYS THE STANDARD LETTER WAS ISSUED AND NO LETTER EXISTS. ' +
        NO_DOCUMENT_SENTENCE +
        ' The customer received the informational answer only. Treat this ticket as an unissued letter request and ' +
        'reopen it: this is a graph defect, not a decision about the trip.'
    );
  } else if (decision === 'auto_resolve') {
    lines.push(
      'The employee was answered informationally and the ticket was solved. No letter was written and none was asked ' +
        'for. ' +
        NO_DOCUMENT_SENTENCE
    );
  } else {
    lines.push(
      'The automation produced a decision this graph does not recognise, so the ticket was routed to a human rather ' +
        'than dropped. Nothing was issued and nobody has been asked to approve anything. ' +
        NO_DOCUMENT_SENTENCE
    );
  }
  lines.push('');

  // --- WHO ACTS NEXT, AND WHERE ----------------------------------------------
  if (decision === 'route_to_uc04') {
    // The handoff branch said what HAPPENED and nothing about what now. Its
    // central claim — "recorded for inspection only, never dispatched
    // automatically" — is true in both halves and is kept. What is added is the
    // actor, the surface, and the three things a reader would otherwise assume
    // exist. The wording is copied from src/uc03/workflow.js's review-queue note
    // and src/uc03/signoffPolicy.js's describeNoSignoffPath(), which already say
    // it to the other audience.
    lines.push(
      "WHO ACTS NEXT: the travelling employee, in Remote's own Request Hub. UC-04 decides on a work-authorisation " +
        'request the employee raises themselves; no API creates one on their behalf, so the outstanding work here is an ' +
        'OUTREACH, not a signature.'
    );
    lines.push('');
    lines.push(
      'A handoff event was RECORDED FOR INSPECTION and dispatched to nothing — deterministically built from fields ' +
        'already read, not summarised by a model: ' +
        (handoffEvent ? handoffEvent.event_type : 'none') +
        ' → destination ' +
        (handoffEvent && handoffEvent.destination_country ? handoffEvent.destination_country : 'unknown') +
        '. Three things a reader would reasonably assume exist and do not: this ticket carries no uc04_* tag, so ' +
        "UC-04's own intake trigger cannot fire on it; no uc04_authorizations row was created; and no cases row was " +
        'created on either use case, so both sidebars answer 404 for this ticket. Nobody else has this.'
    );
    lines.push('');
    lines.push(
      'What that request needs and this travel message never states: ' + UC04_INPUTS_UC03_CANNOT_SOURCE.join(', ') + '.'
    );
  } else if (decision === 'auto_resolve' && reason === 'all_gates_passed') {
    lines.push(
      'Nothing is outstanding: the ticket was answered and solved with no person in the path. ' + NO_CASE_ROW_FACT
    );
  } else {
    // Everything else — including `auto_resolve / standard_letter_issued`, which
    // IS outstanding work on this path however the decision reads (see the
    // paragraph above it).
    lines.push(WORKED_BY_HAND_SENTENCE);
  }

  // --- THE IDENTITY FACTS, when identity is what stopped it -------------------
  if (reason === 'identity_not_verified') {
    lines.push('');
    lines.push(
      'Identity signal used: ' +
        ((identity && identity.method) || 'none') +
        '. What was missing: ' +
        ((identity && identity.reason) || 'not recorded') +
        '. Employment record read: ' +
        (employment && employment.id ? 'yes' : 'NO — Remote returned no usable record for the id on this ticket, so ' +
          'there was nothing to check an identity against. Confirm the id resolves before treating this as an identity ' +
          'problem') +
        '.'
    );
  }

  return lines.join('\n');
}

const outcome = route({
  employment,
  classification,
  identity,
  supportedCountries: new Set(supportedList),
  upstreamFailures,
  // The employee's own words — read by the letter-scope gate and by nothing
  // else. Absent or blank makes a requested letter non-standard rather than
  // standard: "we saw nothing unusual" and "we had nothing to look at" are
  // opposite statements.
  requestText: request.text ?? null,
  // WHETHER THERE IS A LETTERHEAD TO WRITE ON. Read from a `Fetch Legal Entity
  // (Remote)` node when the graph has one, and FALSE when it does not —
  // `$(name)` throws for a node that is not on the canvas, so the lookup is
  // guarded and the failure resolves to the cautious answer rather than to an
  // errored run. A graph that has not been given that node still routes every
  // standard letter to a specialist, exactly as it does today.
  letterheadAvailable: readLetterheadAvailable(),
  // THE POLICY, from the graph's own normalized request when it carries one and
  // `true` otherwise — the same default src/uc03/policyEngine.js declares. An
  // explicit `false` restores the signature on every travel letter.
  letterAutoIssue: request.letterAutoIssue !== false,
});

// ---------------------------------------------------------------------------
// workflow.js: buildUc04HandoffEvent() — the normalized UC-03 -> UC-04
// handoff, only ever realized as data (recorded / inspectable), never a live
// UC-04 call. Mirrors the exact event shape; null-safe on employment.
// ---------------------------------------------------------------------------
const handoffEvent =
  outcome.decision === 'route_to_uc04'
    ? {
        event_type: 'CROSS_BORDER_WORK_REQUESTED',
        source_use_case: 'UC-03',
        employee_id: employment?.id ?? null,
        origin_country: employment?.country_code ?? null,
        destination_country: classification.destinationCountry,
        start_date: classification.startDate,
        end_date: classification.endDate,
        will_work_abroad: true,
        purpose: 'temporary_remote_work',
        source_request_id: request.externalRef ?? null,
      }
    : null;

// --- who owns this ticket, when that is not the use case executing ----------
// `route_to_uc04` means "this travel inquiry is really a work-authorization
// case" — the Zendesk note on that branch already says "UC-04 owns its own
// compliance case". So the escalation belongs in UC-04's queue, and this is the
// ONE place in all nine graphs where the responsible team is not a function of
// the executing use case.
//
// It is set HERE, beside the handoff event that already encodes the same
// decision, rather than inferred downstream from the decision string. The
// `Assign Routing` node stays a pure lookup keyed by use case
// (workflows/nodes/assignRouting.js); a second `if (decision === …)` rule
// living there would be a routing table in two places, which is the exact
// defect its parity test exists to prevent.
const handoffUseCase = outcome.decision === 'route_to_uc04' ? 'UC-04' : null;

// --- the internal note, composed rather than typed into a node parameter -----
// See composeInternalNote() above for why this is here and not in five Zendesk
// node parameters. Emitted for EVERY decision, including auto_resolve, so a
// terminal node that does not consume it today can adopt it without this file
// changing again.
const internalNote = composeInternalNote({
  outcome: outcome,
  employment: employment,
  classification: classification,
  identity: identity,
  handoffEvent: handoffEvent,
});

// --- output: the routed decision plus the facts a specialist / UC-04 reads ---
return [
  {
    json: {
      ...request,
      employment,
      supportedCountries: supportedList,
      classification,
      identity,
      decision: outcome.decision,
      route: outcome.route ?? null,
      reason: outcome.reason,
      flags: outcome.flags,
      durationDays: outcome.durationDays,
      upstreamFailures,
      internalNote,
      ...(handoffEvent ? { handoffEvent } : {}),
      ...(handoffUseCase ? { handoffUseCase } : {}),
    },
  },
];