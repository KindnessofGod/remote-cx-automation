// ---------------------------------------------------------------------------
// noticePeriodGates.js — body of the "Notice Period Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-05's deterministic core in n8n, ported from src/uc05/{noticePeriodTable,
// noticePeriodCalculator,ptoPayout,policyEngine,letterExtractor}.js into ONE
// node, same discipline as UC-01's gates.js, UC-06's amendmentGates.js, and
// UC-08's buildDossier.js.
//
// LLM-SEAM PATTERN (the load-bearing question for this node body):
// The single LLM call in UC-05 is letterExtractor.extractFromLetter() — it
// pulls two facts out of a free-text resignation letter: the EMPLOYEE'S
// STATED last working day (proposedEndDate) and a one-line reason string.
// Both are validated against a strict shape (proposedEndDate must be a
// YYYY-MM-DD string or null; reason must be a string or null). Neither is
// the source of any decision on its own — the decision is the comparison
// of proposedEndDate against the STATUTORY end date, which the calculator
// derives deterministically from country rule + tenure. The `reason` field
// is short subject-line prose that the HR Ops sidebar displays, never
// re-parsed into a decision. So the LLM seam here matches the same pattern
// UC-06/UC-08 used: the node body uses the deterministic rule-based
// fallback directly. Same reason as UC-08's treaty retriever: a real LLM
// call in the node would add an HTTP dependency and one more thing to keep
// in parity for an extraction the deterministic path already covers for
// every common format (ISO + long-form "15 September 2026" + US "September
// 15, 2026" + short "15 Sep 2026"). When the rule-based path can't find a
// date, it returns null — which the policy engine already handles
// correctly (the report is still prepared for sign-off with the statutory
// end as the only date; only an EMPLOYEE-PROPOSED date EARLIER than statute
// escalates). See letterExtractor.js's header and policyEngine.js's
// discrepancy branch for the full reasoning.
//
// WHAT THIS NODE NEVER DOES
// UC-05 has NO Remote write endpoint — the spec itself (§3) and the ticket
// confirm PUT /v1/resignations/{id}/validate does not exist. The durable
// artifact is the HR Ops-signed-off discrepancy report. This node body
// therefore computes the decision and the (proposedEndDate-vs-statutory
// discrepancy) figures, and nothing else — no remote.post/patch/put/delete
// calls, no write payload to construct. The real src/uc05/workflow.js's
// own structural test asserts the same.
//
// It lives as a real .js file rather than a string inside the workflow
// builder for two reasons documented at the top of every other node body
// in this repo: (1) escaping — the first deployed version of UC-01's gates
// turned /https?:\/\// into /https?:/// and a boolean became a RegExp, and
// every ticket routed to human review; a real file cannot have that class
// of bug. (2) testability — test/n8nUc05Parity.test.js executes THIS FILE
// in a node:vm sandbox and asserts its decision/reason/flags/notice/payout
// match the real Node functions across every §12 scenario, so the n8n copy
// and the Node copy cannot drift apart unnoticed.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` and `$input` are
// provided by n8n (and mocked by the parity test).
// ---------------------------------------------------------------------------

const request = $('Normalize Resignation Request').first().json;

// NO RECORD IS NOT AN EMPTY RECORD. This object is the ONLY authoritative
// thing the identity gate below has to match a caller's claim against, so it
// must never contain a value that came from the caller. It used to: when the
// fetch returned nothing usable — an error body, an outage page, a 200 in an
// unexpected envelope, a 404 reaching this node — `id` was backfilled from
// `request.employmentId`, and identity then "verified" a caller-supplied
// session id against a caller-supplied employment id: the same string on both
// sides of the comparison, proving nothing.
//
// It failed closed only by ACCIDENT, because the NEXT gate
// (`employment.status !== 'active'`) read the synthesized record's 'unknown'
// default and caught the run. Live execution 4273 is exactly that: a 200
// carrying no employment record, identity satisfied, and `employee_not_active`
// — not `identity_not_verified` — as the recorded reason. An identity control
// whose correctness depends on a downstream gate is not a control.
//
// So: an id can only ever come from the API response. If the response carried
// no usable record, this is `null` — the exact value RemoteClient.getEmployment()
// returns on a 404 (its documented convention) and therefore the exact value
// src/uc05/workflow.js hands to verifyRequester(). Parity is with the reference
// implementation's real behaviour, not with a placeholder shape only the port
// had. Every downstream reader of a null employment is on the escalate path
// only: identity cannot verify without a record, so the gate chain returns at
// gate 1 before touching `employment.status`/`start_date`/`country_code`, and
// no sibling node in the graph dereferences this object at all (they read
// `employmentId` off the request). test/n8nUc05Parity.test.js pins all of it.
const empRaw = $('Fetch Employment (Remote)').first().json?.data?.employment ?? $('Fetch Employment (Remote)').first().json?.data ?? {};

// --- shared/countryCodes.js + restClient.js's pickAlpha2(), INLINED --------
// An n8n Code node cannot import, so this helper is copied into all three
// gate bodies — workflows/nodes-uc05/noticePeriodGates.js,
// nodes-uc06/amendmentGates.js and nodes-uc09/adjustmentGates.js. It MIRRORS
// src/remote/restClient.js's pickAlpha2() (which composes
// shared/countryCodes.js's normalizeCountryCode() + isWellFormedCountryCode())
// and is kept BYTE-IDENTICAL in all three so the ports cannot drift apart.
//
// WHY A SHAPE CHECK AND NOT ONE MORE `??` FALLBACK — finding F-27. The live
// API nests `country: {code: "DEU", name: "Germany", alpha_2_code: "DE"}`:
// `code` is the ALPHA-3 form, and there is NO top-level `country_code` on the
// record at all (confirmed against a live GET /v1/employments/{id} on
// 2026-08-17; the one flat `country_code` the record does carry, on
// billing_address_details, is alpha-3 too). The old chain
// `country_code ?? country.alpha_2_code ?? country.code` therefore placed
// "DEU"/"CAN" into a field that is only ever compared against two-letter
// values — UC-05's statutory notice table, UC-06's
// /v1/countries/{code}/employment_basic_information lookup, UC-09's
// ["DE","FR","IT"] high-tax list, which raises the approval floor from 2 to 3.
// Nothing crashes: every such comparison is simply false, forever, and the gate
// fails closed — indistinguishable from working correctly, which is exactly how
// UC-03's dead supported-countries gate survived the project's whole life.
//
// An alpha-3 code is not an alpha-2 code we can salvage: converting needs a
// 249-entry table this repo does not have and must not invent (prime directive
// #4). So an unusable code becomes NULL, never a wrong string — and null is
// what every consumer already reads as "not confirmed": UC-05 escalates
// unsupported_country, UC-06 escalates country_schema_unavailable, UC-09 keeps
// its approval floor at two. A missing value gets investigated; a wrong one
// gets acted on.
function pickAlpha2(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  }
  return null;
}

const employment = empRaw && empRaw.id
  ? {
      id: empRaw.id,
      status: empRaw.status ?? 'unknown',
      // Candidate ORDER matches src/remote/restClient.js's normalizeEmployment()
      // exactly (`alpha_2_code` first, `country.code` last), with this node's own
      // extra mock/flat shapes in between. Every candidate is shape-checked, so
      // an alpha-3 `code` is skipped rather than accepted — see pickAlpha2().
      country_code: pickAlpha2([
        empRaw.country?.alpha_2_code,
        empRaw.country_code,
        empRaw.basic_information?.country_code,
        empRaw.country?.code,
      ]),
      start_date: empRaw.start_date ?? empRaw.basic_information?.start_date ?? null,
      probation_end_date: empRaw.probation_end_date ?? empRaw.probation_period_end_date ?? null,
      // The email on the AUTHORITATIVE Remote record. Only used to match the
      // Zendesk-authenticated requester (see the identity block below).
      email: (() => {
        const e = empRaw.basic_information?.email ?? empRaw.basic_information?.personal_email ?? empRaw.email ?? empRaw.personal_email ?? null;
        return e ? String(e).toLowerCase() : null;
      })(),
    }
  : null;

// --- shared/identity.js: verifyRequester() — self only for UC-05 -----------
// A third party cannot file a resignation on someone's behalf — that's the
// whole point of the rule. The session is the only trustworthy signal.
// A SECOND authenticated signal was added when this workflow gained a Zendesk
// intake: `session.authenticatedEmail` is the address ZENDESK authenticated for
// the ticket requester (the Normalize node reads it from ticket.requester.email,
// NEVER from an address typed into the letter text — a resignation letter is
// exactly the kind of free text an impersonator controls), matched against the
// email on the authoritative Remote record. Identical rule to UC-01's gates.js,
// and still "self only": the matched employment IS the employment the request is
// about. Fails closed on any missing piece.
//
// THE PRECONDITION THIS GATE RESTS ON: `employment` is an authoritative record
// or it is null — never a placeholder assembled from the request. That is
// enforced at the CONSTRUCTION SITE above, not here, because a check that
// merely refuses a bad value is one bug away from accepting one (the same
// reasoning UC-08 uses to delete its write parameter outright rather than
// guard it). The `employment &&` and `employment.id` conditions below are kept
// as defence in depth, not as the fix.
const session = request.session;
const identityVerified = Boolean(
  session &&
    employment &&
    ((session.authenticatedEmploymentId && employment.id && session.authenticatedEmploymentId === employment.id) ||
      (session.authenticatedEmail && employment.email && session.authenticatedEmail === employment.email))
);

// --- letterExtractor.js: rule-based fallback (see file header for why n8n
// uses the deterministic path directly) ------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function ruleBasedExtraction(text) {
  const lower = (text || '').toLowerCase();
  let proposedEndDate = null;
  let confidence = 0.4;
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    proposedEndDate = isoMatch[1];
    confidence = 0.9;
  } else {
    const longForm = lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/);
    const longFormUs = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/);
    const shortForm = lower.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b/);
    let day, mon, year;
    if (longForm) { day = Number(longForm[1]); mon = monthMap[longForm[2].slice(0, 3)]; year = Number(longForm[3]); }
    else if (longFormUs) { day = Number(longFormUs[2]); mon = monthMap[longFormUs[1].slice(0, 3)]; year = Number(longFormUs[3]); }
    else if (shortForm) { day = Number(shortForm[1]); mon = monthMap[shortForm[2].slice(0, 3)]; year = Number(shortForm[3]); }
    if (Number.isInteger(mon)) {
      const mm = String(mon + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      proposedEndDate = year + '-' + mm + '-' + dd;
      confidence = 0.8;
    }
  }

  let reason = null;
  const reasonPatterns = [
    /\bfor personal reasons\b/,
    /\bto (pursue|take|accept|join|start) (a|an|my) (new|other)?\s*(opportunity|role|position|job)\b/,
    /\brelocation\b/,
    /\bfamily reasons\b/,
    /\bhealth reasons\b/,
    /\bbetter opportunity\b/,
    /\bfurther studies\b/,
    /\bgoing back to school\b/,
  ];
  for (let i = 0; i < reasonPatterns.length; i++) {
    const m = lower.match(reasonPatterns[i]);
    if (m) {
      reason = m[0].trim();
      break;
    }
  }
  if (reason) confidence = Math.max(confidence, 0.7);

  return { proposedEndDate, reason, confidence, source: 'rule_based_fallback' };
}

// --- noticePeriodTable.js: 9-country statutory table -----------------------
const NOTICE_PERIOD_TABLE = {
  GB: {
    countryCode: 'GB', countryName: 'United Kingdom', basis: 'statutory', unit: 'calendar',
    brackets: [
      { tenureMinMonths: 1, tenureMaxMonths: 24, noticeDays: 7 },
      { tenureMinMonths: 25, tenureMaxMonths: 36, noticeDays: 14 },
      { tenureMinMonths: 37, tenureMaxMonths: 48, noticeDays: 21 },
      { tenureMinMonths: 49, tenureMaxMonths: 60, noticeDays: 28 },
      { tenureMinMonths: 61, tenureMaxMonths: 72, noticeDays: 35 },
      { tenureMinMonths: 73, tenureMaxMonths: 84, noticeDays: 42 },
      { tenureMinMonths: 85, tenureMaxMonths: 120, noticeDays: 56 },
      { tenureMinMonths: 121, tenureMaxMonths: null, noticeDays: 84 },
    ],
    probation: null,
    anchorRule: 'continuous',
    sourceCitation: 'Employment Rights Act 1996 \u00a786 (sliding scale)',
  },
  IE: {
    countryCode: 'IE', countryName: 'Ireland', basis: 'statutory', unit: 'calendar',
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 2, noticeDays: 0 },
      { tenureMinMonths: 3, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: 'continuous',
    sourceCitation: 'Minimum Notice and Terms of Employment Act 1973 \u00a74',
  },
  DE: {
    countryCode: 'DE', countryName: 'Germany', basis: 'statutory', unit: 'calendar',
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 28 }],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 14 },
    anchorRule: 'month_15',
    sourceCitation: 'BGB \u00a7622 (4 weeks, 15th/end of month; 2 weeks during probation)',
  },
  PL: {
    countryCode: 'PL', countryName: 'Poland', basis: 'statutory', unit: 'calendar',
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 14 },
      { tenureMinMonths: 6, tenureMaxMonths: 35, noticeDays: 30 },
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeDays: 90 },
    ],
    probation: null,
    anchorRule: 'month_1st',
    sourceCitation: 'Kodeks Pracy art. 36 \u00a71 (tenure-bracketed, 1st-of-month anchor for monthly notices)',
  },
  IN: {
    countryCode: 'IN', countryName: 'India', basis: 'statutory', unit: 'calendar',
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 1 },
      { tenureMinMonths: 6, tenureMaxMonths: 23, noticeDays: 7 },
      { tenureMinMonths: 24, tenureMaxMonths: 59, noticeDays: 14 },
      { tenureMinMonths: 60, tenureMaxMonths: null, noticeDays: 28 },
    ],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 7 },
    anchorRule: 'continuous',
    sourceCitation: 'Industrial Employment (Standing Orders) defaults (apply only absent a contract notice)',
  },
  PH: {
    countryCode: 'PH', countryName: 'Philippines', basis: 'statutory', unit: 'calendar',
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 30 }],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 15 },
    anchorRule: 'continuous',
    sourceCitation: 'Labor Code of the Philippines Art. 297 (30 days, 15 days during probation)',
  },
  MX: {
    countryCode: 'MX', countryName: 'Mexico', basis: 'statutory', unit: 'calendar',
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeDays: 30 }],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 6, noticeDays: 15 },
    anchorRule: 'continuous',
    sourceCitation: 'Ley Federal del Trabajo Art. 161 (30 days, reduced during probation)',
  },
  CA: {
    countryCode: 'CA', countryName: 'Canada', basis: 'customary', unit: 'calendar',
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 2, noticeDays: 0 },
      { tenureMinMonths: 3, tenureMaxMonths: 35, noticeDays: 7 },
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeDays: 14 },
    ],
    probation: null,
    anchorRule: 'continuous',
    sourceCitation: 'Common-law customary notice (no statutory employee minimum; varies by province)',
  },
  PT: {
    countryCode: 'PT', countryName: 'Portugal', basis: 'statutory', unit: 'calendar',
    brackets: [
      // CONTRADICTIONS.md C-18: art. 400.º(1) splits on "até dois anos ou mais
      // de dois anos" — up to two years INCLUSIVE. This split at 23, so exactly
      // 24 months got 60 days where the statute gives 30.
      { tenureMinMonths: 0, tenureMaxMonths: 24, noticeDays: 30 },
      { tenureMinMonths: 25, tenureMaxMonths: null, noticeDays: 60 },
    ],
    probation: { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 15 },
    anchorRule: 'continuous',
    sourceCitation: 'C\u00f3digo do Trabalho art. 400 (30 / 60 days by tenure; probation reduced)',
  },
  // NL — one month FLAT (BW art. 7:672 lid 4), end-of-month anchor (lid 1).
  // The tenure ladder at the top of art. 672 is the EMPLOYER's (lid 2) and is
  // deliberately not modelled. `noticeMonths`, not `noticeDays`: see the real
  // table's NoticeBracket note — 30 days under a month_end anchor lands a
  // resignation filed on the 1st of a 31-day month inside that same month.
  NL: {
    countryCode: 'NL', countryName: 'Netherlands', basis: 'statutory', unit: 'calendar',
    brackets: [{ tenureMinMonths: 0, tenureMaxMonths: null, noticeMonths: 1 }],
    probation: null, anchorRule: 'month_end',
    sourceCitation: 'Burgerlijk Wetboek art. 7:672 lid 4 (one month, flat) with lid 1 (end-of-month anchor)',
    evidence: '[CONFIRMED — statute, retrieved 2026-08-19; D-01, D-40]',
  },
  // US — a SOURCED absence. Not a zero-day period and not an absent row: the
  // country is covered, and what the table holds for it is the finding that no
  // statutory minimum binds a resigning employee. See CONTRADICTIONS.md C-29.
  US: {
    countryCode: 'US', countryName: 'United States', basis: 'none', unit: 'none',
    noStatutoryMinimum: true,
    brackets: [],
    probation: null, anchorRule: null,
    sourceCitation: 'No federal statutory minimum notice runs against a resigning employee; WARN (29 U.S.C. ch. 23) binds employers of 100+ on mass layoffs only. Notice owed is contractual, and this system does not hold the contract.',
    evidence: '[INFERRED — argument from scope; D-06, US DOL, retrieved 2026-08-19]',
  },
};

function hasNoStatutoryMinimum(rule) {
  return Boolean(rule && rule.noStatutoryMinimum === true);
}

function getNoticeRule(countryCode) {
  if (!countryCode) return null;
  return NOTICE_PERIOD_TABLE[countryCode.toUpperCase()] || null;
}

function pickBracket(rule, tenureMonths, onProbation) {
  if (!rule) return null;
  const pool = (onProbation && rule.probation) ? [rule.probation] : rule.brackets;
  for (let i = 0; i < pool.length; i++) {
    const b = pool[i];
    const min = b.tenureMinMonths == null ? -Infinity : b.tenureMinMonths;
    const max = b.tenureMaxMonths == null ? Infinity : b.tenureMaxMonths;
    if (tenureMonths >= min && tenureMonths <= max) return b;
  }
  return null;
}

// --- noticePeriodCalculator.js: date arithmetic ----------------------------
function tenureMonthsBetween(startDate, now) {
  const start = new Date(startDate);
  const ref = new Date(now);
  let months = (ref.getUTCFullYear() - start.getUTCFullYear()) * 12 + (ref.getUTCMonth() - start.getUTCMonth());
  if (ref.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function toIsoDate(d) { return d.toISOString().slice(0, 10); }

function fromIsoDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('Invalid YYYY-MM-DD date: ' + iso);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addCalendarDays(isoDate, days) {
  const d = fromIsoDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

function applyAnchor(rawEnd, anchorRule) {
  if (!anchorRule || anchorRule === 'continuous') return { date: rawEnd, adjusted: false };
  const d = fromIsoDate(rawEnd);
  if (anchorRule === 'month_15') {
    const day = d.getUTCDate();
    if (day < 15) return { date: toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15))), adjusted: true };
    if (day === 15) return { date: toIsoDate(d), adjusted: false };
    const lastDayOfNextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
    return { date: toIsoDate(lastDayOfNextMonth), adjusted: true };
  }
  if (anchorRule === 'month_1st') {
    return { date: toIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))), adjusted: true };
  }
  if (anchorRule === 'month_end') {
    // BW art. 7:672 lid 1. The last day of the month the raw end falls in — NOT
    // the month after: the calendar month required by lid 4 was already added
    // upstream, and adding another here would double the notice period.
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const date = toIsoDate(lastDay);
    return { date: date, adjusted: date !== rawEnd };
  }
  return { date: rawEnd, adjusted: false };
}

// Add N CALENDAR months, CLAMPING the day-of-month to the target month's last
// day. setUTCMonth() rolls 31 October into 1 December instead of clamping to 30
// November, and under a month_end anchor that is a whole extra month of notice.
function addCalendarMonths(isoDate, months) {
  const d = fromIsoDate(isoDate);
  const targetYear = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfTarget);
  return toIsoDate(new Date(Date.UTC(targetYear, targetMonth, day)));
}

// The statutory quantity as words, so prose never prints a day count for a rule
// the statute states in months.
function quantityText(bracket) {
  if (bracket && Number.isFinite(bracket.noticeMonths)) {
    return bracket.noticeMonths + ' month' + (bracket.noticeMonths === 1 ? '' : 's');
  }
  if (bracket && Number.isFinite(bracket.noticeDays)) {
    return bracket.noticeDays + ' day' + (bracket.noticeDays === 1 ? '' : 's');
  }
  return null;
}

function toCalendarDay(now) {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new TypeError('toCalendarDay received an invalid Date');
    return now.toISOString().slice(0, 10);
  }
  if (typeof now === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(now.trim());
    if (match) return match[1];
    throw new TypeError('toCalendarDay could not read a date from ' + JSON.stringify(now));
  }
  const coerced = new Date(now);
  if (Number.isNaN(coerced.getTime())) {
    throw new TypeError('toCalendarDay could not read a date from ' + JSON.stringify(now));
  }
  return coerced.toISOString().slice(0, 10);
}

// Ported VERBATIM from src/uc05/noticePeriodCalculator.js's
// unmeasuredDiscrepancy(): how to label the comparison when there is no
// statutory end date to measure against. "The employee named no leaving date"
// and "the employee named one and we could not produce a statutory end to
// compare it to" are facts about different people and must never share a
// label — a result carrying proposedEndDate: '2026-09-01' alongside
// discrepancy: 'no_proposed_date' contradicts itself in one object.
function unmeasuredDiscrepancy(proposedEndDate) {
  return proposedEndDate ? 'not_comparable' : 'no_proposed_date';
}

function computeNoticePeriod({ countryCode, startDate, probationEndDate, proposedEndDate, now }) {
  const rule = getNoticeRule(countryCode);
  if (!rule) {
    return {
      countryCode: (countryCode == null ? '' : String(countryCode)).toUpperCase(),
      basis: 'unknown', unit: 'unknown',
      sourceCitation: 'Country not in the statutory notice table this system holds.',
      tenureMonths: 0, onProbation: false, noticeDays: 0,
      noticeStartDate: null, noticeEndDate: null,
      // No rule for this country at all — see the real calculator's typedef.
      noticeRuleFound: false,
      // NULL, not false: we hold no rule, so we do not KNOW whether a statutory
      // minimum exists. `false` is reserved for the sourced finding that none
      // does. CONTRADICTIONS.md C-29.
      statutoryMinimumExists: null, noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
    };
  }

  // NO STATUTORY MINIMUM — a sourced finding, branched BEFORE any bracket work
  // because `brackets` is empty and the no-bracket branch below would report
  // `no_matching_notice_bracket`, sending someone to extend a table that is
  // already complete for this country. noticeDays is null, NOT 0: zero is a
  // quantity a reader can act on and it would say the employee owes nothing,
  // which is a claim about their contract that no source here supports.
  if (hasNoStatutoryMinimum(rule)) {
    return {
      countryCode: rule.countryCode, basis: rule.basis, unit: rule.unit,
      sourceCitation: rule.sourceCitation,
      tenureMonths: startDate ? tenureMonthsBetween(startDate, toCalendarDay(now)) : 0,
      onProbation: false,
      noticeDays: null, noticeStartDate: null, noticeEndDate: null,
      noticeRuleFound: true, statutoryMinimumExists: false,
      noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
    };
  }

  // See src/uc05/noticePeriodCalculator.js's toCalendarDay() for the full
  // story. Short version: this used to pass a string straight through, and the
  // Normalize node upstream sets `now` to a FULL ISO timestamp, which then
  // reached fromIsoDate() and threw. Unreachable until every earlier gate
  // stopped firing, so both copies were parity-tested with date-only fixtures
  // and agreed with each other while both being wrong about real input.
  const nowIso = toCalendarDay(now);
  const tenureMonths = startDate ? tenureMonthsBetween(startDate, nowIso) : 0;
  const onProbation = Boolean(probationEndDate && new Date(probationEndDate) > new Date(nowIso));
  const bracket = pickBracket(rule, tenureMonths, onProbation);
  if (!bracket) {
    return {
      countryCode: rule.countryCode, basis: rule.basis, unit: rule.unit,
      sourceCitation: rule.sourceCitation, tenureMonths, onProbation,
      noticeDays: 0, noticeStartDate: nowIso, noticeEndDate: null,
      // The country's rule EXISTS; no bracket in it covers this tenure.
      noticeRuleFound: true, statutoryMinimumExists: true,
      noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
    };
  }

  const rawStart = nowIso;
  // A bracket states its period in days OR in months, and which one is a fact
  // about the statute. Only NL is month-denominated today.
  const rawEnd = Number.isFinite(bracket.noticeMonths)
    ? addCalendarMonths(rawStart, bracket.noticeMonths)
    : addCalendarDays(rawStart, bracket.noticeDays);
  const anchor = applyAnchor(rawEnd, rule.anchorRule);

  let discrepancyDays = null;
  let discrepancy = 'no_proposed_date';
  if (proposedEndDate) {
    const proposed = fromIsoDate(proposedEndDate);
    const statutory = fromIsoDate(anchor.date);
    discrepancyDays = Math.round((proposed.getTime() - statutory.getTime()) / (1000 * 60 * 60 * 24));
    if (discrepancyDays < 0) discrepancy = 'earlier_than_statutory';
    else if (discrepancyDays > 0) discrepancy = 'later_than_statutory';
    else discrepancy = 'match';
  }

  return {
    countryCode: rule.countryCode, basis: rule.basis, unit: rule.unit,
    sourceCitation: rule.sourceCitation, tenureMonths, onProbation,
    noticeDays: Number.isFinite(bracket.noticeDays) ? bracket.noticeDays : null,
    noticeMonths: Number.isFinite(bracket.noticeMonths) ? bracket.noticeMonths : null,
    noticeQuantity: quantityText(bracket),
    noticeStartDate: rawStart, noticeEndDate: anchor.date,
    noticeRuleFound: true, statutoryMinimumExists: true,
    proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
    discrepancyDays, discrepancy, anchorAdjusted: anchor.adjusted,
  };
}

// --- shared/money.js: ×100 scaling -----------------------------------------
function toRemoteInteger(humanAmount) {
  if (typeof humanAmount !== 'number' || Number.isNaN(humanAmount)) {
    throw new TypeError('toRemoteInteger expected a number, got ' + humanAmount);
  }
  return Math.round(humanAmount * 100);
}

function fromRemoteInteger(remoteInteger) {
  if (!Number.isInteger(remoteInteger)) {
    throw new TypeError('fromRemoteInteger expected an integer, got ' + remoteInteger);
  }
  return remoteInteger / 100;
}

// --- ptoPayout.js: reconcilePtoPayout() ------------------------------------
// THIS IS WHERE EXECUTION 4975 DIED. The webhook delivered
// `timeOffBalances: [{type: "vacation", balanceDays: 8}]` — a plausible Time Off
// shape carrying none of the four fields this function multiplies — and
// fromRemoteInteger(undefined) threw a TypeError out of this Code node. The node
// runs BEFORE `Append Audit Log`, so the request vanished: no claim, no
// uc05_resignations row, no audit_log row, no human told. Every other gate
// failure in this graph fails closed to a durable, audited escalate; this one
// failed open into silence.
//
// The refusal is deliberate and is NOT "treat the missing rate as zero". Note
// the days side already did exactly that — `(Number(b.daysAccrued) || 0)` turns
// an absent accrual into 0 — so this balance would have produced a confident
// 0.00 EUR payout on 8 genuinely accrued days even with a valid rate. A zero
// payout on a real balance is an underpayment a human signs off on. See
// src/uc05/ptoPayout.js's header for the full reasoning; this is its port.
// F-33: a NEGATIVE day count is a balance we cannot read, not a zero balance.
// It has to be refused here because the Math.max(0, ...) clamp below cannot
// tell the two apart — a stated -8 accrued days became a computable 0.00
// payout with no flag, and a stated -5 days USED became 15 payable days out of
// a 10-day accrual. The clamp itself stays: `accrued 4 / used 6` is leave
// taken in advance, a real answer that genuinely pays zero.
// A LINE CARRYING REMOTE'S OWN NETTED BALANCE IS JUDGED ON THAT FIGURE.
// `src/remote/leaveBalances.js` reads `balance` off
// GET /v1/leave-policies/summary/{id} — the accrued-to-date remaining days a
// final settlement pays — and passes it as `daysAvailable` rather than as a
// fabricated accrued/used pair, because it is not one: live, the same record
// reports `annual_entitlement - used` = 25 days and `balance` = 13.75. The
// PRESENCE of the key selects the rule; a null value is refused for its own
// missing figure rather than falling through to components it does not have.
// F-33's rule is unchanged either way: a negative is a balance we cannot read.
function unusableFields(balance) {
  const missing = [];
  if (!balance || typeof balance !== 'object') return ['balance'];
  if (!Number.isInteger(balance.hourlyRateInRemoteInteger)) missing.push('hourlyRateInRemoteInteger');
  if (Object.prototype.hasOwnProperty.call(balance, 'daysAvailable')) {
    const available = Number(balance.daysAvailable);
    if (
      balance.daysAvailable === null ||
      balance.daysAvailable === undefined ||
      balance.daysAvailable === '' ||
      !Number.isFinite(available) ||
      available < 0
    ) {
      missing.push('daysAvailable');
    }
    return missing;
  }
  if (
    !Number.isFinite(Number(balance.daysAccrued)) ||
    balance.daysAccrued === null ||
    balance.daysAccrued === undefined ||
    balance.daysAccrued === '' ||
    Number(balance.daysAccrued) < 0
  ) {
    missing.push('daysAccrued');
  }
  const used = balance.daysUsed;
  if (used !== null && used !== undefined && (!Number.isFinite(Number(used)) || used === '' || Number(used) < 0)) {
    missing.push('daysUsed');
  }
  return missing;
}

function reconcilePtoPayout({ balances, currency, hoursPerDay, reportedBalanceInRemoteInteger }) {
  const hoursPerDayFinal = hoursPerDay == null ? 8 : hoursPerDay;
  const reportedBalance = reportedBalanceInRemoteInteger == null ? null : reportedBalanceInRemoteInteger;
  if (!Array.isArray(balances) || balances.length === 0) {
    return {
      lines: [], totalInRemoteInteger: 0, currency: currency == null ? 'USD' : currency,
      hasDiscrepancy: false,
      reportedBalanceInRemoteInteger: reportedBalance,
      computedBalanceInRemoteInteger: 0,
      computable: true,
      unusableLines: [],
      source: 'no_time_off_records',
    };
  }

  // Classify BEFORE multiplying.
  const unusableLines = [];
  const usable = [];
  balances.forEach((b, index) => {
    const missing = unusableFields(b);
    if (missing.length > 0) {
      unusableLines.push({
        index,
        timeOffType: b && typeof b === 'object' && typeof b.timeOffType === 'string' ? b.timeOffType : null,
        missing,
        // WHY, when the reader knows why — a field name alone sends a
        // specialist looking for a value to type, and for an unlimited policy
        // or an unpublished pay rate there is no such value.
        reason: b && typeof b === 'object' && typeof b.unavailable === 'string' ? b.unavailable : null,
        source: b && typeof b === 'object' && typeof b.source === 'string' ? b.source : null,
      });
    } else {
      usable.push(b);
    }
  });

  const lines = usable.map((b) => {
    // Remote's own netted balance when the line carries one, the accrued-minus-
    // used derivation when it does not. Never both: see unusableFields().
    const daysAvailable = Object.prototype.hasOwnProperty.call(b, 'daysAvailable')
      ? Number(b.daysAvailable)
      : Math.max(0, (Number(b.daysAccrued) || 0) - (Number(b.daysUsed) || 0));
    // The leave-policy row's own `working_hours_per_day` when Remote sent one.
    // The 8 above is a convention; this is a fact about that policy.
    const rowHoursPerDay = Number(b.workingHoursPerDay);
    const effectiveHoursPerDay =
      Number.isFinite(rowHoursPerDay) && rowHoursPerDay > 0 ? rowHoursPerDay : hoursPerDayFinal;
    const hours = daysAvailable * effectiveHoursPerDay;
    const hourlyRateAsHuman = fromRemoteInteger(b.hourlyRateInRemoteInteger);
    const linePayoutHuman = hours * hourlyRateAsHuman;
    const linePayoutInteger = toRemoteInteger(linePayoutHuman);
    return {
      timeOffType: b.timeOffType,
      daysAvailable,
      payoutInRemoteInteger: linePayoutInteger,
      currency: currency == null ? 'USD' : currency,
      // Where the days came from, carried onto the line that gets signed.
      daysSource: typeof b.source === 'string' ? b.source : null,
      hoursPerDay: effectiveHoursPerDay,
    };
  });

  // A partial sum is a wrong sum, and a discrepancy asserted against an
  // incomplete figure is our own missing data dressed up as the employee's error.
  const computable = unusableLines.length === 0;
  const totalInRemoteInteger = computable ? lines.reduce((sum, l) => sum + l.payoutInRemoteInteger, 0) : null;
  const hasDiscrepancy = computable && reportedBalance !== null && reportedBalance !== totalInRemoteInteger;

  return {
    lines,
    totalInRemoteInteger,
    currency: currency == null ? 'USD' : currency,
    hasDiscrepancy,
    reportedBalanceInRemoteInteger: reportedBalance,
    computedBalanceInRemoteInteger: totalInRemoteInteger,
    computable,
    unusableLines,
    source: computable ? 'time_off_records' : 'unusable_time_off_records',
  };
}

// --- policyEngine.js: 5 ordered gates, first failure wins ------------------
// The extraction is always computed (it's audit-attached either way) — when
// the caller supplied an explicit proposedEndDate/reason via the request, we
// use those as if the LLM had returned them with source: "structured_input".
// Otherwise we run the rule-based extractor on request.letterText.
const explicitProposedEndDate = request.proposedEndDate == null ? null : request.proposedEndDate;
const explicitReason = request.reason == null ? null : request.reason;
const extraction = (explicitProposedEndDate || explicitReason)
  ? { proposedEndDate: explicitProposedEndDate, reason: explicitReason, confidence: 1.0, source: 'structured_input' }
  : ruleBasedExtraction(request.letterText || '');

let decision, reason;
let flags = [];
let notice = null;
let payout = null;

if (!identityVerified) {
  decision = 'escalate'; reason = 'identity_not_verified'; flags = ['identity_not_verified'];
} else if (!employment || employment.status !== 'active') {
  decision = 'escalate'; reason = 'employee_not_active'; flags = ['employee_not_active'];
} else if (!employment.start_date) {
  decision = 'escalate'; reason = 'missing_seniority_date'; flags = ['missing_seniority_date'];
} else {
  notice = computeNoticePeriod({
    countryCode: employment.country_code,
    startDate: employment.start_date,
    probationEndDate: employment.probation_end_date,
    proposedEndDate: extraction.proposedEndDate,
    now: request.now,
  });

  if (!notice.noticeEndDate) {
    // Ported from policyEngine.js gate 4: "no rule for this country" and "this
    // country's rule has no bracket for this tenure" are different facts and
    // must not share a reason string — a UK employee with three weeks' service
    // was being told the United Kingdom is an unsupported country.
    // Ported from policyEngine.js gate 4. `tenure_months_N` rides along on the
    // bracket branch only: on that branch the tenure IS the thing a human has
    // to look at, and on the unsupported-country branch it is noise.
    // A THIRD reason, ported from policyEngine.js: `statutoryMinimumExists ===
    // false` is a SOURCED finding that this country sets no statutory notice on
    // a resigning employee. Checked FIRST because the other two are trivially
    // true of it (no bracket, no end date) and whichever branch runs first owns
    // the recorded reason. It escalates rather than passing to sign-off because
    // what is owed comes from a contract this system does not hold — see
    // UC-05.md §7a.
    if (notice.statutoryMinimumExists === false) {
      decision = 'escalate';
      reason = 'no_statutory_notice_period';
      flags = [
        'no_statutory_notice_period',
        'country_' + (notice.countryCode || 'unknown'),
        'contractual_notice_not_held',
      ];
    } else {
    const ruleFound = notice.noticeRuleFound === true;
    decision = 'escalate';
    reason = ruleFound ? 'no_matching_notice_bracket' : 'unsupported_country';
    flags = ruleFound
      ? ['no_matching_notice_bracket', 'country_' + (notice.countryCode || 'unknown'), 'tenure_months_' + (notice.tenureMonths == null ? 'unknown' : notice.tenureMonths)]
      : ['unsupported_country', 'country_' + (notice.countryCode || 'unknown')];
    }
  } else {
    payout = reconcilePtoPayout({
      balances: request.timeOffBalances || [],
      currency: request.currency || 'USD',
      reportedBalanceInRemoteInteger: null,
    });

    // Flagged before ANY branch returns, so an unusable balance is recorded
    // even when an earlier gate owns the decision — never invisible.
    if (payout && payout.computable === false) {
      flags.push('pto_balance_unusable');
      for (let i = 0; i < (payout.unusableLines || []).length; i++) {
        const missing = payout.unusableLines[i].missing || [];
        for (let j = 0; j < missing.length; j++) {
          const flag = 'pto_missing_' + missing[j];
          if (flags.indexOf(flag) === -1) flags.push(flag);
        }
      }
    }

    if (notice.discrepancy === 'earlier_than_statutory') {
      flags.push('discrepancy_earlier_than_statutory', 'discrepancy_days_' + notice.discrepancyDays);
      decision = 'escalate'; reason = 'statutory_discrepancy';
    } else {
      if (notice.anchorAdjusted) flags.push('anchor_rule_applied');
      if (payout.hasDiscrepancy) flags.push('pto_discrepancy');

      // Gate 6 — is the PTO payout actually computable? (finding F-28)
      // Placed after the discrepancy gate: "ordered gates, first failure wins",
      // and a real statutory discrepancy must not be relabelled a data problem
      // and sent to the wrong desk. Decisive on the previously-passing path —
      // a report reaching HR Ops with a null payout total reads as "no payout
      // due" when the truth is "we could not work it out".
      if (payout && payout.computable === false) {
        decision = 'escalate'; reason = 'pto_balance_unusable';
      } else {
        decision = 'prepared_for_signoff'; reason = 'all_gates_passed';
      }
    }
  }
}

// resignationStore.js: the status a created row starts at.
const status = decision === 'prepared_for_signoff' ? 'pending_signoff' : 'escalated';

// riskEngine.js: UC-05 is 🟡; any flag pushes it to "high".
const riskTier = flags.length > 0 ? 'high' : 'medium';

return [{ json: {
  ...request,
  employment,
  extraction,
  decision,
  reason,
  flags,
  notice,
  payout,
  status,
  riskTier,
} }];
