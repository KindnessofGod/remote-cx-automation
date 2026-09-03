// ---------------------------------------------------------------------------
// workationGates.js — body of the "Workation Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-04's deterministic core in n8n, ported from src/uc04/{policyEngine,
// riskMatrix,requestParser}.js into ONE node, same discipline as UC-01's
// gates.js and UC-06's amendmentGates.js. test/n8nUc04Parity.test.js
// executes THIS FILE and asserts it reaches the same decision/reason/flags/
// riskLevel/factorIssues as policyEngine.evaluate() for every scenario in
// docs/use-cases/UC-04.md §12 — the 9 spec scenarios plus the edge cases
// already covered by test/uc04.test.js.
//
// The LLM seam in this use case is requestParser.draftSummary(). It runs the
// same pattern as UC-06's draftSummary(): an LLM call with a deterministic
// template fallback, where the LLM's output is display/audit prose for the
// specialist's review screen — NEVER read back into a decision. The
// `judgeNarrative()` faithfulness check (issue #27) is the same — purely
// informational, never a gate. So this node uses the template directly
// instead of carrying an HTTP LLM dependency for text that was never
// load-bearing: same "display-prose-never-load-bearing" reasoning as UC-06
// and UC-08's node bodies, not the "validated-shape-so-rules-are-equally-
// valid" pattern UC-01's classifier uses.
//
// UC-04 NEVER EXECUTES the actual PATCH (Remote's "approve the work
// authorization" call) from this graph, and the reason CHANGED on 2026-08-30
// without this file hearing about it. It used to be "the PATCH is the
// specialist's approve, one human action later, in the uc04-api". It is not:
// the PATCH is the CUSTOMER'S OWN MANAGER's approve, made in Remote's own
// product (the /remoteui work-authorizations screen), and no Remote CX agent
// in Zendesk can make it at all. See the stage table below and UC-04.md §1a.
//
// THREE PARTIES DECIDE, AND THIS NODE IS NONE OF THEM. Everything this node
// emits is a PREPARATION of that decision — the gates' verdict, a summary, and
// (since 2026-08-31) a composed internal note that names the actor and the
// surface for each stage. Prime directive 2's shape: the AI prepares, a named
// human decides.
//
// RUNS INSIDE N8N'S SANDBOX: no imports, no network, no module system.
// `$()` and `$input` are provided by n8n (and mocked by the parity test).
// ---------------------------------------------------------------------------

const request = $('Normalize Workation Request').first().json;

// Employment record comes from the immediate predecessor ("Fetch Employment
// (Remote)" HTTP node). The real Remote API nests the resource under
// data.employment; the mock server keeps it flat under data. Support both,
// then normalize to the one shape the rest of the code already uses — same
// pattern as src/uc01/gates.js and src/uc06/amendmentGates.js.
const empRaw = $input.first().json?.data?.employment ?? $input.first().json?.data ?? {};
const employment = {
  // FOR DISPLAY AND FOR CARRYING FORWARD, and it falls back to the id that was
  // ASKED ABOUT so a downstream node always has something to name. That makes
  // it unusable as an identity input — see `recordId` below.
  id: empRaw.id ?? request.employmentId,
  status: empRaw.status ?? 'unknown',
  company_id: empRaw.company_id ?? null,
  custom_fields: empRaw.custom_fields ?? null,
  // The email on the AUTHORITATIVE Remote record. Only used to match the
  // Zendesk-authenticated requester (see the identity block below); never
  // rendered, never returned to a caller.
  email: (() => {
    const e = empRaw.basic_information?.email ?? empRaw.basic_information?.personal_email ?? empRaw.email ?? empRaw.personal_email ?? null;
    return e ? String(e).toLowerCase() : null;
  })(),
};

// --- identity: an authenticated signal, never a claim ----------------------
// Same "companyId matches employment.company_id" rule as UC-06 — Remote's
// own webhook is the authenticated signal (see 00-FOUNDATION.md §2's
// Remote-native-webhook path), but the session still has to identify the
// right company to act on.
// A SECOND authenticated signal was added when this workflow gained a Zendesk
// intake: `session.authenticatedEmail` is the address ZENDESK itself
// authenticated for the ticket requester (the Normalize node reads it from
// ticket.requester.email and NEVER from an address typed into the ticket body —
// a claimed address proves nothing), matched against the email on the
// authoritative Remote record. Identical rule to UC-01's gates.js. Fails
// closed: a missing session, a missing email on either side, or a mismatch all
// leave identityVerified false. This is workflow-layer identity DERIVATION —
// policyEngine.evaluate() still receives one boolean, so parity is unchanged.
// A THIRD accepted signal was added on 2026-08-30, and it is the one Remote's
// own object is built around: a WorkAuthorizationRequest is "submitted by an
// employee who needs authorization to work in a different country", with the
// employee (`user`) and the employer's manager (`employer_approver`) as two
// separate parties. So the EMPLOYEE filing about their own trip verifies —
// `session.authenticatedEmploymentId` against the id on the AUTHORITATIVE
// record. Mirrors src/uc04/submissionIdentity.js, which is where the whole
// argument is written down; keep the two in step. Note that the SCENARIO TABLE
// in test/n8nUc04Parity.test.js cannot catch a divergence here — it feeds
// policyEngine.evaluate() the identity THIS node derived, so that the gates are
// what is compared — which is why that file also carries a block of rows
// driving this derivation directly.
//
// `recordId` IS NOT `employment.id`. The object above defaults its id to
// `request.employmentId` — the id the request ASKED ABOUT — so comparing
// against it would compare a session's claim with a body's claim and call the
// agreement of two claims an authenticated identity. Only what Remote actually
// returned may satisfy an identity gate.
const recordId = empRaw.id ? String(empRaw.id).trim() : '';
const session = request.session;
const sessionEmploymentId =
  session && typeof session.authenticatedEmploymentId === 'string' ? session.authenticatedEmploymentId.trim() : '';
const identityVerified = Boolean(
  session &&
    employment &&
    ((sessionEmploymentId && recordId && sessionEmploymentId === recordId) ||
      (session.companyId && session.companyId === employment.company_id) ||
      (session.authenticatedEmail && employment.email && session.authenticatedEmail === employment.email))
);

// --- riskMatrix.js: the curated VISA_TYPES / JOB_DUTY_CATEGORIES / sets -----
const VISA_TYPES = {
  schengen_short_stay: 'schengen_short_stay',
  esta_usa: 'esta_usa',
  digital_nomad_visa: 'digital_nomad_visa',
  tourist_visa: 'tourist_visa',
  business_visa: 'business_visa',
  work_permit: 'work_permit',
  other: 'other',
};

const JOB_DUTY_CATEGORIES = {
  engineering: 'engineering',
  support: 'support',
  operations: 'operations',
  sales: 'sales',
  legal: 'legal',
  executive: 'executive',
  other: 'other',
};

const SCHENGEN = new Set([
  'AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IS',
  'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SK', 'SI',
  'ES', 'SE', 'CH',
]);

const EU_EEA_FOR_A1 = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO',
]);

const DNV_COUNTRIES = new Set(['EE', 'PT', 'RO', 'CR', 'MX']);

// The curated 9-country scope (UC-04.md §3) plus the US, which has its own
// hard rule. KNOWN_DESTINATIONS is every country this matrix has a rule
// about — anything else is UNEVALUATED, and UC-04.md §3 says unevaluated
// escalates by default (finding F-14). Ported from src/uc04/riskMatrix.js.
const CURATED_SCOPE = new Set(['GB', 'IE', 'DE', 'PL', 'IN', 'PH', 'MX', 'CA', 'PT', 'US']);
const KNOWN_DESTINATIONS = new Set([
  ...SCHENGEN, ...EU_EEA_FOR_A1, ...DNV_COUNTRIES, ...CURATED_SCOPE,
]);

// Country codes are normalised ONCE, at the top of classifyRisk(). Every rule
// below is a case-sensitive Set.has() or === 'US', so a destination of 'us'
// used to walk past BOTH work-permit hard blocks and the Schengen 90/180
// block (finding F-13). Inlined rather than imported — n8n Code nodes have no
// module system; mirrors src/shared/countryCodes.js.
function normalizeCountryCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

// Same reasoning one level up: the SET can arrive from outside too (a caller
// that has read Remote's country registry), so both sides of the lookup are
// normalised, not just the key. Mirrors src/shared/countryCodes.js's
// normalizeCountrySet().
function normalizeCountrySet(codes) {
  const out = new Set();
  for (const c of codes ?? []) {
    const n = normalizeCountryCode(c);
    if (n) out.add(n);
  }
  return out;
}

// --- the restricted-jurisdiction screen ------------------------------------
// Destinations UC-04 refuses outright, whatever the visa, the duties or the
// specialist's opinion. In src/ this set is IMPORTED from UC-03's policy
// engine (SANCTIONED_OR_RESTRICTED) precisely so it cannot exist twice — an
// n8n Code node has no module system, so here it must be inlined, which is
// the one place in this repo where that list genuinely does exist twice.
//
// That copy is not left to vigilance: test/n8nUc04Parity.test.js extracts
// this literal out of this file and asserts it is IDENTICAL to the set src/
// imports, member for member. A divergence here is a sanctions gap that no
// scenario row would ever surface — the two files would keep agreeing on
// every country either of them still blocks.
//
// WHY THIS EXISTS AT ALL. Until 2026-08-18 neither copy had a jurisdiction
// screen, so a workation request to Iran came back with the same decision and
// the same words as one to Montenegro: `destination_out_of_scope`, which
// describes this matrix's own coverage rather than the request. That was not
// cosmetic. `escalate` is one of the two decisions src/uc04/workflow.js
// creates a REAL Remote work-authorization record for (`createWorkAuthorization`,
// status `pending_mobility`); `blocked` is not. So a sanctioned-destination
// request produced a platform write whose `destination_country` Remote's own
// schema — the `Country` object, i.e. a row of `GET /v1/countries` — cannot
// represent, since every code below is absent from that registry (verified
// live 2026-08-18, 224 rows).
const RESTRICTED_JURISDICTIONS = new Set([
  'CU',
  'IR',
  'KP',
  'SY',
  'RU',
  'BY',
  'MM',
  'VE',
  'AF',
  'IQ',
]);

const NON_TREATY_PAIRS = new Set([
  'IN_US', 'PH_US', 'MX_CA', 'IN_CA', 'PH_CA', 'IN_GB', 'PH_GB',
]);

// --- riskMatrix.js: tripDurationDays() and computeCumulativeDays() ----------
// F-32: null, never 0, when no length can be stated. Absent, unreadable or
// reversed dates are not a trip of zero days — and 0 is not a length a real
// trip can even have, since the count is inclusive (shortest trip = 1). Every
// input that yields null also pushes a `reasons` entry, so the blocked return
// below fires before either `+ tripDays` threshold can read it.
function tripDurationDays(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

// THE THREE DAY-ARITHMETIC DEFECTS (fixed 2026-08-20), ported verbatim from riskMatrix.js — read
// that file's "DAY ARITHMETIC" header for the full write-up. In short:
//   1. an unreadable date used to make `days` NaN, and NaN loses BOTH the > 90
//      and the > 183 comparison, so an overstay cleared silently while the row
//      serialised the NaN to `null` and read as "not computed";
//   2. overlapping stays double-counted (63 for 41 distinct days) — days are a
//      union, not a sum;
//   3. the Schengen window was anchored once at the trip start; Reg. (EU)
//      2016/399 art. 6(1) (docs/knowledge/layer-1-statutory/D-07) counts "the
//      180-day period preceding EACH day of stay". See schengenPeakDays().
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_COUNTED = 'COUNTED';
const DAYS_NOT_EVALUATED = 'NOT_EVALUATED';
const SCHENGEN_LIMIT_DAYS = 90;
// W-3. Kept byte-for-byte in step with src/uc04/riskMatrix.js's
// LEAD_TIME_MINIMUM_DAYS — test/n8nUc04Parity.test.js runs this body against
// the real matrix and compares decisions, so a divergence here is a divergence
// in what production tells a specialist. [PROPOSED]: this system's own working
// minimum, not anybody's rule.
const LEAD_TIME_MINIMUM_DAYS = 14;
const SCHENGEN_WINDOW_DAYS = 180;

function wholeDaysBetween(from, to) {
  const a = toDayIndex(from);
  const b = toDayIndex(to);
  if (a === null || b === null) return null;
  return b - a;
}

function toDayIndex(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(`${value}`.trim());
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

function toDateString(dayIndex) {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

function travelHistoryProblems(travelHistory) {
  const problems = [];
  if (travelHistory == null) return problems;
  if (!Array.isArray(travelHistory)) {
    problems.push(`travel history is not a list: ${JSON.stringify(travelHistory)}`);
    return problems;
  }
  travelHistory.forEach((period, i) => {
    const label = `prior stay ${i + 1}`;
    // WELL-FORMED, NOT MERELY NON-EMPTY. `normalizeCountryCode()` trims and
    // upper-cases, so "Netherlands" survives as "NETHERLANDS" — truthy, past
    // this guard, and then compared with a Set of two-letter codes it can never
    // equal. The stay contributed nothing and the run reported COUNTED with no
    // problems: an overstay written in words CLEARED. Mirrors the same fix in
    // src/uc04/riskMatrix.js; test/n8nUc04Parity.test.js holds the two together.
    const rawCountry = period && period.country;
    const country = /^[A-Z]{2}$/.test(normalizeCountryCode(rawCountry)) ? normalizeCountryCode(rawCountry) : '';
    if (!country) {
      problems.push(`${label}: unreadable country ${JSON.stringify(rawCountry)}`);
    }
    const start = toDayIndex(period && period.startDate);
    const end = toDayIndex(period && period.endDate);
    if (start === null || end === null) {
      problems.push(
        `${label}: unreadable dates ${JSON.stringify(period && period.startDate)} → ${JSON.stringify(period && period.endDate)}`
      );
      return;
    }
    if (end < start) {
      problems.push(`${label}: the stay ends (${period.endDate}) before it starts (${period.startDate})`);
    }
  });
  return problems;
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const pair of sorted) {
    const start = pair[0];
    const end = pair[1];
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function daysInWindow(intervals, from, to) {
  let days = 0;
  for (const pair of intervals) {
    const overlapStart = Math.max(pair[0], from);
    const overlapEnd = Math.min(pair[1], to);
    if (overlapStart <= overlapEnd) days += overlapEnd - overlapStart + 1;
  }
  return days;
}

function computeCumulativeDays({ travelHistory, country, windowStart, windowEnd }) {
  const problems = travelHistoryProblems(travelHistory);
  const winStart = toDayIndex(windowStart);
  const winEnd = toDayIndex(windowEnd);
  if (winStart === null) problems.push(`unreadable windowStart: ${JSON.stringify(windowStart)}`);
  if (winEnd === null) problems.push(`unreadable windowEnd: ${JSON.stringify(windowEnd)}`);
  if (winStart !== null && winEnd !== null && winEnd < winStart) {
    problems.push(`window ends before it starts: ${windowStart} → ${windowEnd}`);
  }
  const target = normalizeCountryCode(country);
  if (!target) problems.push(`unreadable country: ${JSON.stringify(country)}`);

  const intervals = [];
  let periodsCounted = 0;
  if (problems.length === 0) {
    for (const p of travelHistory ?? []) {
      if (normalizeCountryCode(p && p.country) !== target) continue;
      const start = Math.max(toDayIndex(p.startDate), winStart);
      const end = Math.min(toDayIndex(p.endDate), winEnd);
      if (end < start) continue;
      intervals.push([start, end]);
      periodsCounted++;
    }
  }

  if (problems.length > 0) {
    return { days: null, periodsCounted: 0, status: DAYS_NOT_EVALUATED, problems };
  }
  const days = daysInWindow(mergeIntervals(intervals), winStart, winEnd);
  return { days, periodsCounted, status: DAYS_COUNTED, problems };
}

function schengenPeakDays({ travelHistory, country, tripStart, tripEnd }) {
  const problems = travelHistoryProblems(travelHistory);
  const target = normalizeCountryCode(country);
  if (!target) problems.push(`unreadable country: ${JSON.stringify(country)}`);
  const start = toDayIndex(tripStart);
  const end = toDayIndex(tripEnd);
  if (start === null) problems.push(`unreadable trip start: ${JSON.stringify(tripStart)}`);
  if (end === null) problems.push(`unreadable trip end: ${JSON.stringify(tripEnd)}`);
  if (start !== null && end !== null && end < start) {
    problems.push(`the trip ends (${tripEnd}) before it starts (${tripStart})`);
  }

  const base = { limit: SCHENGEN_LIMIT_DAYS, windowDays: SCHENGEN_WINDOW_DAYS, problems };
  if (problems.length > 0) {
    return Object.assign({}, base, { status: DAYS_NOT_EVALUATED, peakDays: null, peakDate: null, window: null, breached: false });
  }

  const stays = [[start, end]];
  for (const p of travelHistory ?? []) {
    if (normalizeCountryCode(p && p.country) !== target) continue;
    stays.push([toDayIndex(p.startDate), toDayIndex(p.endDate)]);
  }
  const merged = mergeIntervals(stays);

  // Once D reaches tripStart + 180 the window [D-179, D] lies entirely inside
  // the trip and holds exactly 180 days for the rest of it, so scanning past
  // that point can discover nothing new.
  const scanEnd = Math.min(end, start + SCHENGEN_WINDOW_DAYS);
  let peakDays = 0;
  let peakDay = start;
  for (let day = start; day <= scanEnd; day++) {
    const count = daysInWindow(merged, day - (SCHENGEN_WINDOW_DAYS - 1), day);
    if (count > peakDays) {
      peakDays = count;
      peakDay = day;
    }
  }

  return Object.assign({}, base, {
    status: DAYS_COUNTED,
    peakDays,
    peakDate: toDateString(peakDay),
    window: {
      from: toDateString(peakDay - (SCHENGEN_WINDOW_DAYS - 1)),
      to: toDateString(peakDay),
      spanDays: SCHENGEN_WINDOW_DAYS,
    },
    breached: peakDays > SCHENGEN_LIMIT_DAYS,
  });
}

// --- riskMatrix.js: classifyRisk() — the deterministic matrix, ported -------
function classifyRisk(args) {
  const {
    homeCountry: rawHomeCountry,
    destinationCountry: rawDestinationCountry,
    nationality: rawNationality,
    visaType,
    jobDuties,
    hasContractSigningAuthority,
    startDate,
    endDate,
    now,
    travelHistory = [],
    // Defaulted, and DELIBERATELY NOT read off `request`. src/uc04/policyEngine.js
    // threads a caller-supplied set through this seam so a workflow that has
    // fetched Remote's country registry can pass its real exclusions in — there
    // the caller is trusted Node code. Here the only thing upstream of this node
    // is a webhook body, and a screen a caller can empty is a screen an attacker
    // can empty. The default is the static set; an empty one is unreachable from
    // outside this file.
    restrictedJurisdictions = RESTRICTED_JURISDICTIONS,
  } = args;

  // THE boundary — everything below reads these, never the raw args.
  const homeCountry = normalizeCountryCode(rawHomeCountry);
  const destinationCountry = normalizeCountryCode(rawDestinationCountry);
  const nationality = normalizeCountryCode(rawNationality);

  const reasons = [];
  const flags = [];
  const considerations = [];

  // Hard blocks first — and the jurisdiction screen first among those, because
  // `reasons[0]` is what the decision below reports as the reason. A restricted
  // destination is the headline: "we cannot support work from this jurisdiction"
  // is the answer, and "your dates are the wrong way round" is not, even when
  // both are true.
  if (destinationCountry && normalizeCountrySet(restrictedJurisdictions).has(destinationCountry)) {
    reasons.push('sanctioned_region');
    flags.push('sanctioned_region');
  }

  if (homeCountry === destinationCountry) {
    reasons.push('same_country_workation');
    flags.push('same_country');
  }

  if (visaType === VISA_TYPES.esta_usa || visaType === VISA_TYPES.tourist_visa) {
    reasons.push('visitor_visa_active_work_forbidden');
    flags.push('visitor_visa_blocks_remote_work');
  }

  if (Number.isNaN(new Date(startDate).getTime()) || Number.isNaN(new Date(endDate).getTime())) {
    reasons.push('invalid_date');
    flags.push('invalid_dates');
  } else if (new Date(endDate) < new Date(startDate)) {
    reasons.push('end_before_start');
    flags.push('invalid_dates');
  }

  // An unreadable prior stay is a hard block, not a quiet zero: a `null` day
  // count loses BOTH threshold comparisons and clears the request.
  const historyProblems = travelHistoryProblems(travelHistory);
  if (historyProblems.length > 0) {
    reasons.push('travel_history_unreadable');
    flags.push('travel_history_unreadable');
  }

  if (new Date(startDate) < new Date(now)) {
    reasons.push('start_in_past');
    flags.push('start_in_past');
  }

  const tripDays = tripDurationDays(startDate, endDate);

  if (reasons.length > 0) {
    return { riskLevel: 'blocked', reasons, flags, tripDays, leadTimeDays: null, cumulativeDays: null, schengen: null, travelHistoryProblems: historyProblems, considerations, normalized: { homeCountry, destinationCountry, nationality } };
  }

  // Schengen visa-free 90/180 window (statutory, not invented). The window is
  // the one Reg. (EU) 2016/399 art. 6(1) describes — "the 180-day period
  // preceding EACH day of stay" — not a single window anchored at the trip
  // start. The DNV suppression on the next line is deliberately unchanged.
  let schengen = null;
  if (SCHENGEN.has(destinationCountry) && nationality && !DNV_COUNTRIES.has(destinationCountry)) {
    schengen = schengenPeakDays({ travelHistory, country: destinationCountry, tripStart: startDate, tripEnd: endDate });
    // COUNTED by construction — every input that could make it NOT_EVALUATED
    // has already returned `blocked` above.
    if (schengen.breached) {
      reasons.push('schengen_90_180_exceeded');
      flags.push('schengen_overstay');
    } else if (visaType !== VISA_TYPES.schengen_short_stay && visaType !== VISA_TYPES.business_visa) {
      flags.push('schengen_visa_unverified');
    }
  }

  // US / Canada work-permit gate
  if (destinationCountry === 'US' && visaType !== VISA_TYPES.work_permit) {
    reasons.push('us_requires_work_permit');
    flags.push('us_requires_work_permit');
  }
  if (destinationCountry === 'CA' && visaType !== VISA_TYPES.work_permit) {
    reasons.push('ca_requires_work_permit');
    flags.push('ca_requires_work_permit');
  }

  if (reasons.length > 0) {
    return { riskLevel: 'blocked', reasons, flags, tripDays, leadTimeDays: null, cumulativeDays: null, schengen, travelHistoryProblems: historyProblems, considerations, normalized: { homeCountry, destinationCountry, nationality } };
  }

  // Destination outside everything the matrix knows about: UC-04.md §3's
  // escalate-by-default rule (finding F-14). Not a block — a refusal to
  // present an unevaluated country as a cleared one on a 1-click screen.
  if (!KNOWN_DESTINATIONS.has(destinationCountry)) {
    considerations.push('destination_outside_curated_scope');
    flags.push('destination_out_of_scope');
  }

  // Soft-risk ordering: which consideration pushes the trip from "low" to
  // "medium" or "high". These do NOT block — they escalate for human
  // attention. PE-risk role checks are the most important: contract-signing
  // / executive / sales / legal all push to high.
  if (hasContractSigningAuthority || jobDuties === JOB_DUTY_CATEGORIES.executive) {
    considerations.push('contract_signing_or_executive_role');
    flags.push('pe_risk_dape');
  }
  if (jobDuties === JOB_DUTY_CATEGORIES.sales || jobDuties === JOB_DUTY_CATEGORIES.legal) {
    considerations.push('client_negotiation_role');
    flags.push('pe_risk_dape');
  }

  if (EU_EEA_FOR_A1.has(homeCountry) && EU_EEA_FOR_A1.has(destinationCountry) && homeCountry !== destinationCountry) {
    considerations.push('eu_eea_a1_path');
    flags.push('a1_certificate_recommended');
  }

  const pairKey = `${nationality}_${destinationCountry}`;
  if (NON_TREATY_PAIRS.has(pairKey)) {
    considerations.push('non_treaty_pair');
    flags.push('non_treaty_pair');
  }

  // Trailing-365 cumulative tax-residency watch
  let cumulativeDays = null;
  if (destinationCountry && homeCountry !== destinationCountry) {
    const startMs = new Date(startDate).getTime();
    const winStart = new Date(startMs - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const winEnd = startDate;
    cumulativeDays = computeCumulativeDays({ travelHistory, country: destinationCountry, windowStart: winStart, windowEnd: winEnd });
    if (cumulativeDays.days + tripDays > 183) {
      considerations.push('approaching_tax_residency_threshold');
      flags.push('tax_residency_watch');
    }
  }

  // W-3 — notice before departure. Soft, always: short notice is neither an
  // immigration bar nor a data-quality fault, and UC-04's blocking set is only
  // those two. A trip already under way is `start_in_past`, which returns above.
  let leadTimeDays = null;
  if (!Number.isNaN(new Date(startDate).getTime())) {
    leadTimeDays = wholeDaysBetween(now, startDate);
    if (leadTimeDays !== null && leadTimeDays < LEAD_TIME_MINIMUM_DAYS) {
      considerations.push('short_notice_before_departure');
      flags.push('lead_time_short');
    }
  }

  let riskLevel = 'low';
  if (flags.includes('pe_risk_dape') || flags.includes('destination_out_of_scope')) riskLevel = 'high';
  else if (
    flags.includes('non_treaty_pair') ||
    flags.includes('tax_residency_watch') ||
    flags.includes('schengen_visa_unverified') ||
    flags.includes('lead_time_short')
  )
    riskLevel = 'medium';

  return { riskLevel, reasons, flags, tripDays, leadTimeDays, cumulativeDays, schengen, travelHistoryProblems: historyProblems, considerations, normalized: { homeCountry, destinationCountry, nationality } };
}

// --- policyEngine.js: factorValidationIssues() -----------------------------
const VALID_VISA_TYPES = new Set([
  'schengen_short_stay', 'esta_usa', 'digital_nomad_visa', 'tourist_visa',
  'business_visa', 'work_permit', 'other',
]);

const VALID_JOB_DUTIES = new Set([
  'engineering', 'support', 'operations', 'sales', 'legal', 'executive', 'other',
]);

function factorValidationIssues(factors) {
  if (!factors || typeof factors !== 'object') {
    return ['factors_missing'];
  }
  const issues = [];
  if (!factors.homeCountry || typeof factors.homeCountry !== 'string') issues.push('missing_home_country');
  if (!factors.destination || typeof factors.destination !== 'object' || !factors.destination.country) {
    issues.push('missing_destination_country');
  }
  if (!factors.nationality || typeof factors.nationality !== 'string') issues.push('missing_nationality');
  if (!factors.startDate || !factors.endDate) issues.push('missing_dates');
  if (!factors.visaType || !VALID_VISA_TYPES.has(factors.visaType)) issues.push('invalid_visa_type');
  if (!factors.jobDuties || !VALID_JOB_DUTIES.has(factors.jobDuties)) issues.push('invalid_job_duties');
  if (typeof factors.hasContractSigningAuthority !== 'boolean') issues.push('missing_signing_authority');
  return issues;
}

// --- THE THREE STAGES, AND WHO OWNS EACH ONE ------------------------------
// DISPLAY AND AUDIT ONLY. Nothing below is read back into a decision; no gate
// branches on it. It exists because until 2026-08-31 this node told a Remote
// CX specialist, on a real Zendesk ticket, that a `ready_for_approval` request
// was "awaiting ONE mobility specialist's approval" — a decision
// src/uc04/approvalPolicy.js refuses them, on a screen that offers them no
// button, for a request that is really waiting on somebody outside Remote.
//
// THE WORDS ARE COPIED, NOT COMPOSED FRESH, and the sources are named per
// constant. An n8n Code node has no imports (see this file's header), so a
// shared module cannot be reached from here — the established pattern in this
// repository for that situation is to copy with attribution rather than to
// invent a second wording, because a second wording is a second thing to
// drift. Keep these in step with:
//   src/remoteui/workAuthPolicy.js   STAGES / STAGE_3_NOTE
//   src/uc04/mobilityReview.js       MOBILITY_REVIEW_NOTICE, the clear/decline verbs
//   src/uc04/server.js               CX_SIDEBAR_NO_DECISION
//   src/approvalqueue/approvalRoutes.js  the "UC-04" row's `stages` + `note`
//
// `approvalRoute` BELOW KEEPS THE TOKEN `specialist_approval` ON PURPOSE. It
// is a machine token, it is never rendered, it is not persisted by any node on
// this graph, and src/uc04/workflow.js emits the identical string — renaming
// it here would make the two copies of one decision disagree about a field
// while changing nothing a human reads. What was wrong was the PROSE, and the
// prose is what changed.
const STAGE_2_ACTOR = "the customer's own manager";
const STAGE_2_SURFACE = "Remote's own product (the /remoteui work-authorizations screen)";
const STAGE_3_ACTOR = "Remote's Mobility Team";
const STAGE_3_SURFACE = "the UC-04 panel of the Remote CX Review sidebar on this ticket";

// Copied from src/remoteui/workAuthPolicy.js's STAGE_3_NOTE reasoning and
// src/uc04/mobilityReview.js's MOBILITY_REVIEW_NOTICE. Stated as a fact about
// REMOTE'S API rather than about our permissions: "we cannot do that yet" and
// "Remote publishes no endpoint for it" are different claims.
const STAGE_3_NOT_TRANSMITTED =
  'Remote publishes no endpoint for that stage, so what is recorded there is recorded in this system only: ' +
  'it is never sent to Remote and Remote\'s own systems will not show it.';

// The one line that keeps a reader from mistaking stage 2 for something a
// Zendesk agent does. Copied from src/uc04/server.js's CX_SIDEBAR_NO_DECISION.
const STAGE_2_IS_NOT_OURS =
  'PATCH /v1/work-authorization-requests accepts exactly approved_by_manager and declined_by_manager, and that ' +
  'is the only work-authorization decision Remote\'s API accepts. No Zendesk agent can make it, and nothing ' +
  'on this ticket will.';

/**
 * The internal note the ticket carries. DETERMINISTIC TEXT, never
 * LLM-authored — the same discipline as buildEmployerHandoffNote() in
 * src/remoteui/server.js and composeInternalNote.js on UC-01's graph.
 *
 * IT DOES NOT REPRODUCE THE FOUR DIMENSIONS OR THE GATE LADDER. Both are
 * computed by src/uc04/decisionFacts.js (1,400+ lines) and rendered by the ZAF
 * sidebar off the stored row. Porting them into a Code node would be a second
 * copy of the longest reasoning in this use case, kept in step by nothing. The
 * note POINTS at the surface that already has them instead.
 *
 * IT IS EMITTED FOR EVERY DECISION, not only for ready_for_approval, so the
 * other three Zendesk terminal nodes can adopt `internalNote` without this file
 * changing again. Today only "Flag Awaiting Specialist Approval" reads it —
 * see workflows/nodes-uc04/flagAwaitingApprovalSpec.js.
 */
function composeInternalNote({ decision, reason, summary, flags, riskLevel }) {
  const flagText = flags && flags.length ? flags.join(', ') : 'none';
  const lines = [];
  lines.push('UC-04 work authorization — the automation has PREPARED this case and decided nothing about whether the trip may go ahead.');
  lines.push('');
  lines.push(summary);
  lines.push('');
  lines.push('Assessment: ' + decision + ' (' + reason + '). Risk-matrix level: ' + riskLevel + '. Flags: ' + flagText + '.');
  lines.push('');
  lines.push('WHO DECIDES, AND WHERE');
  lines.push('1 · The employee files the request. Already done — that is what produced this ticket.');
  if (decision === 'ready_for_approval') {
    lines.push('2 · ' + STAGE_2_ACTOR.charAt(0).toUpperCase() + STAGE_2_ACTOR.slice(1) + ' approves or declines it, in ' + STAGE_2_SURFACE + '. ' + STAGE_2_IS_NOT_OURS);
    lines.push('3 · ' + STAGE_3_ACTOR + ' then records its own review of what the employer approved, on ' + STAGE_3_SURFACE + '. The verbs there are clear / decline, never approve — approve is stage 2\'s word for stage 2\'s decision. ' + STAGE_3_NOT_TRANSMITTED);
    lines.push('');
    lines.push('Until the employer has decided, what this ticket is for is the prepared case: the facts, the four dimensions, the risk posture and the gate ladder, on ' + STAGE_3_SURFACE + ', ready for whoever does decide.');
  } else if (decision === 'escalate') {
    // The group as the ACCOUNT spells it. `Mobility Legal Tier-2` is not a
    // group name anywhere in Zendesk; the live group is
    // `Mobility & Legal (Tier-2)` (id 99900000000009,
    // src/shared/escalationGroupIds.js). Proven on ticket 79: this note named
    // the team THREE times in TWO spellings — the summary sentence and the
    // appended routing sentence both correct, this line not — so a specialist
    // searching the string it gave them found no such group.
    // docs/ESCALATION-DESTINATIONS.md §2.2, "one team, four spellings".
    lines.push('2 · Neither stage 2 nor stage 3 is reached. This request was escalated to Mobility & Legal (Tier-2) rather than prepared for the employer, so ' + STAGE_2_ACTOR + ' is not being asked for anything yet.');
    lines.push('');
    lines.push('The prepared case — the facts, the four dimensions, the risk posture and the gate ladder — is on ' + STAGE_3_SURFACE + '.');
  } else if (decision === 'blocked') {
    lines.push('2 · Neither stage 2 nor stage 3 is reached. This request is blocked, which is a hard stop nobody approves — ' + STAGE_2_ACTOR + ' is not being asked for anything and no approval here could override it.');
    lines.push('');
    lines.push('The prepared case — the facts, the four dimensions, the risk posture and the gate ladder — is on ' + STAGE_3_SURFACE + '.');
  } else {
    lines.push('2 · The automation produced a decision this graph does not recognise, so it is routed to a human rather than dropped. Nobody has been asked to approve anything.');
  }
  return lines.join('\n');
}

/**
 * Who this decision is actually waiting on, as data. Display/audit only, and
 * carried so a downstream node or a reader of the run never has to re-derive
 * it from `approvalRoute` — which is exactly the re-derivation that produced
 * the wrong sentence in the first place.
 */
function describeAwaitingDecision(decision) {
  if (decision === 'ready_for_approval') {
    return { stage: 2, actor: STAGE_2_ACTOR, surface: STAGE_2_SURFACE, decidedInZendesk: false, writesToRemote: true };
  }
  if (decision === 'escalate') {
    return { stage: null, actor: 'Mobility & Legal (Tier-2)', surface: 'this Zendesk ticket', decidedInZendesk: true, writesToRemote: false };
  }
  return { stage: null, actor: 'nobody — a blocked or unrecognised request is not open to approval', surface: null, decidedInZendesk: false, writesToRemote: false };
}

// --- requestParser.js: draftSummaryTemplate() — the deterministic fallback.
// Ported verbatim — the LLM call is NOT made here for the same reason UC-06
// doesn't port its draftSummary() as a live HTTP call: the LLM's output is
// display/audit prose for the specialist's review screen, NEVER read back
// into a decision, so the template is an equally-valid summary at the
// intake stage. One fewer HTTP dependency, one fewer thing to keep in
// parity, no behavior change.
function draftSummaryTemplate({ factors, riskLevel, tripDays, approvalRoute, reason }) {
  // Defensive reads, not decoration. A request whose factors are INCOMPLETE is
  // exactly the case that reaches `blocked / factors_invalid` — and it still has
  // to produce a summary for the human who has to read the decision. Dereferencing
  // `factors.destination.country` on such a request threw a TypeError, which in
  // n8n aborts the node BEFORE the audit write and loses the decision entirely.
  const f = factors ?? {};
  const destinationCountry = f.destination?.country ?? 'unknown';
  // F-32: say what is true rather than printing 'null day(s)' — or, as this
  // used to, a fabricated 0 next to dates two weeks apart.
  const durationText = Number.isFinite(tripDays) ? tripDays + ' day(s)' : 'an undetermined number of days';
  const parts = [];
  parts.push(
    'Workation request from ' + (f.homeCountry ?? 'unknown') + ' to ' + destinationCountry + ' for ' + durationText + ' (' + (f.startDate ?? 'unknown') + ' to ' + (f.endDate ?? 'unknown') + ').'
  );
  parts.push('Visa type: ' + (f.visaType ?? 'unknown') + '; job duties: ' + (f.jobDuties ?? 'unknown') + (f.hasContractSigningAuthority ? ' (contract-signing authority)' : '') + '.');
  parts.push('Risk-matrix level: ' + riskLevel + '.');
  if (approvalRoute === 'specialist_approval') {
    // THE SENTENCE THIS REPLACED WAS FALSE, AND IT WAS ON A REAL TICKET:
    // "Awaiting one mobility specialist's approval before the authorization is
    // issued." A `ready_for_approval` request waits on the CUSTOMER'S manager,
    // in Remote's own product. A Remote CX specialist reading that line was
    // being told to make a decision src/uc04/approvalPolicy.js refuses them, on
    // a panel that offers no approve. Corrected 2026-08-31; the DECISION
    // vocabulary above is untouched, so parity with policyEngine.evaluate() is
    // unchanged. src/uc04/requestParser.js still carries the old wording — it
    // is outside this pass's ownership and is named in its report.
    parts.push(
      'Awaiting ' + STAGE_2_ACTOR + ', who approves or declines this trip in ' + STAGE_2_SURFACE + '. ' +
      'That is the only work-authorization decision Remote\'s API accepts, and no Zendesk agent can make it. ' +
      STAGE_3_ACTOR + ' reviews it afterwards, and that review is recorded in this system, never sent to Remote.'
    );
  } else if (reason === 'sanctioned_region') {
    // PORTED 2026-08-31, alongside the sanctions gate above. src/uc04/
    // requestParser.js has special-cased this reason since the gate existed;
    // this file did not, so a sanctions block's stored summary — and, since the
    // composed note interpolates it, the sentence on the customer's ticket —
    // read "Blocked by the risk matrix", naming a computation as the cause of a
    // decision the matrix did not make. The matrix DOES score alongside this
    // block now (see the gate), which makes the misattribution more plausible
    // rather than less: the row really does carry a risk level, and it still is
    // not why the request was refused. Same misattribution class as the three
    // terminal Zendesk nodes' prose, one layer down.
    parts.push('Blocked — ' + destinationCountry + ' is a sanctioned/restricted destination; not open to approval here.');
  } else if (approvalRoute === 'blocked') {
    // CORRECTED 2026-08-31 in step with src/uc04/requestParser.js — read its
    // comment for the full argument. Short form: "Blocked by the risk matrix"
    // is accurate for 5 of the 12 reachable blocked reasons and FALSE for
    // `factors_invalid`, where `risk` is null and the matrix never ran. The old
    // line rendered "Risk-matrix level: unknown. Blocked by the risk matrix" —
    // self-contradicting inside one sentence, and since composeInternalNote()
    // interpolates this summary, that sentence reached a real ticket.
    parts.push(
      riskLevel === 'unknown'
        ? 'Blocked (' + reason + ') — the risk matrix did not run on this request, so nothing was scored and nothing was refused on its merits; not open to approval here.'
        : 'Blocked by the risk matrix (' + reason + ') — not open to approval here.'
    );
  } else if (approvalRoute === 'escalate') {
    // Likewise in step with src. "not open to 1-click approval here" contrasts
    // against a slower approval that exists nowhere in Zendesk, and "Mobility
    // Legal Tier-2" is not a group name — the live group is
    // `Mobility & Legal (Tier-2)`, which the routing sentence appended after
    // this one already spells correctly.
    parts.push(
      'Escalated (' + reason + ') to Mobility & Legal (Tier-2). It has no approve/decline path here; the escalation is worked on its own ticket.'
    );
  } else {
    parts.push('Awaiting review.');
  }
  return parts.join(' ');
}

// --- policyEngine.js: evaluate() — the 6 ordered gates, first failure wins -
// SIX since 2026-08-31, not five: the sanctions gate below sits third, where
// src/uc04/policyEngine.js has had it since 2026-08-18. It was never ported,
// and the omission changed the REASON on a customer's ticket without changing
// the decision — see the gate's own comment for the reproduction.
let decision, reason, flags, risk, factorIssues;

if (!identityVerified) {
  decision = 'escalate';
  reason = 'identity_not_verified';
  flags = ['identity_not_verified'];
  risk = null;
  factorIssues = [];
} else if (!employment || employment.status !== 'active') {
  decision = 'escalate';
  reason = 'employee_not_active';
  flags = ['employee_not_active'];
  risk = null;
  factorIssues = [];
} else if (
  normalizeCountryCode(request.factors?.destination?.country) &&
  normalizeCountrySet(RESTRICTED_JURISDICTIONS).has(normalizeCountryCode(request.factors.destination.country))
) {
  // --- THE SANCTIONS GATE, ported 2026-08-31 (it was missing entirely) ------
  //
  // src/uc04/policyEngine.js has screened the destination HERE — before
  // employer permission and before factor validation — since 2026-08-18. This
  // file never got that gate: its only jurisdiction screen lives INSIDE
  // classifyRisk(), which the chain below reaches four gates later and only on
  // a request that has already cleared permission and factor validation.
  //
  // WHAT THAT COST, reproduced rather than reasoned about. A request to `IR`
  // on an employment whose `workation_permission` is not true:
  //
  //     src/uc04/policyEngine.js         -> blocked / sanctioned_region
  //     workflows/nodes-uc04/...js       -> blocked / employer_permission_not_granted
  //
  // Same DECISION, so nothing goes red and no alert fires — and a different
  // REASON on the customer's ticket, in the one direction that matters. A
  // specialist reading `employer_permission_not_granted` goes looking for a
  // permissions problem and never learns the destination was sanctioned. That
  // is finding F-13 exactly, which policyEngine.js's own header says it fixed
  // "in the one file that had not had it applied" — and then the port stayed
  // unfixed for thirteen days, because F-13 was applied WITHIN src and never
  // BETWEEN the two copies.
  //
  // test/n8nUc04Parity.test.js could not see it: all four of its
  // restricted-jurisdiction rows use a permission-granted employment and
  // well-formed factors, so both copies reach the matrix and agree. A row
  // combining a sanctioned destination with absent permission is added by the
  // same change that adds this gate — the divergence and the blindness are one
  // finding, and fixing only the first would leave the second to re-earn it.
  //
  // WHY THE MATRIX STILL RUNS, and only when it can mean anything: identical
  // reasoning to src's, kept in step deliberately. Returning `risk: null` here
  // manufactures an ABSENCE — `tripDays`/`cumulativeDays`/`riskLevel` all come
  // off `risk`, so the durable row would say "an undetermined number of days"
  // about a trip with two readable dates. So the matrix is scored when the
  // factors are well-formed, and left null when they are not, which is honest
  // because nothing computed it. The DECISION is still made by this gate,
  // before permission and before factors — which is the whole point of the
  // early placement: a sanctioned destination is caught on a request the
  // matrix could never have been run on at all.
  const sanctionsCanScore = factorValidationIssues(request.factors).length === 0;
  risk = sanctionsCanScore
    ? classifyRisk({
        homeCountry: request.factors.homeCountry,
        destinationCountry: request.factors.destination.country,
        nationality: request.factors.nationality,
        visaType: request.factors.visaType,
        jobDuties: request.factors.jobDuties,
        hasContractSigningAuthority: request.factors.hasContractSigningAuthority,
        startDate: request.factors.startDate,
        endDate: request.factors.endDate,
        now: request.now ?? new Date().toISOString(),
        travelHistory: request.travelHistory ?? [],
      })
    : null;
  decision = 'blocked';
  reason = 'sanctioned_region';
  // Prepended when the matrix did not raise it itself. It normally does — its
  // jurisdiction screen reads the same set — but this gate's whole claim is
  // that it does not DEPEND on that one, so it never assumes the flag is there.
  flags =
    risk && risk.flags.includes('sanctioned_region')
      ? risk.flags
      : ['sanctioned_region', ...(risk ? risk.flags : [])];
  factorIssues = [];
} else if (!employment.custom_fields || employment.custom_fields.workation_permission !== true) {
  decision = 'blocked';
  reason = 'employer_permission_not_granted';
  flags = ['employer_permission_not_granted'];
  risk = null;
  factorIssues = [];
} else {
  factorIssues = factorValidationIssues(request.factors);
  if (factorIssues.length > 0) {
    decision = 'blocked';
    reason = 'factors_invalid';
    flags = ['factors_invalid', ...factorIssues];
    risk = null;
  } else {
    const effectiveNow = request.now ?? new Date().toISOString();
    risk = classifyRisk({
      homeCountry: request.factors.homeCountry,
      destinationCountry: request.factors.destination.country,
      nationality: request.factors.nationality,
      visaType: request.factors.visaType,
      jobDuties: request.factors.jobDuties,
      hasContractSigningAuthority: request.factors.hasContractSigningAuthority,
      startDate: request.factors.startDate,
      endDate: request.factors.endDate,
      now: effectiveNow,
      travelHistory: request.travelHistory ?? [],
    });

    if (risk.riskLevel === 'blocked') {
      decision = 'blocked';
      reason = risk.reasons[0] ?? 'risk_matrix_blocked';
      flags = risk.flags;
      factorIssues = [];
    } else if (risk.riskLevel === 'high') {
      decision = 'escalate';
      // An unevaluated destination escalates in its own words, not as a
      // "high risk pair" the matrix never actually found (finding F-14).
      reason = risk.flags.includes('destination_out_of_scope') ? 'destination_out_of_scope' : 'high_risk_pair';
      flags = risk.flags;
      factorIssues = [];
    } else {
      decision = 'ready_for_approval';
      reason = 'all_gates_passed';
      flags = risk.flags;
      factorIssues = [];
    }
  }
}

const approvalRoute =
  decision === 'ready_for_approval'
    ? 'specialist_approval'
    : decision === 'escalate'
      ? 'escalate'
      : 'blocked';

const summary = draftSummaryTemplate({
  factors: request.factors,
  riskLevel: risk?.riskLevel ?? 'unknown',
  // `?? null`, NEVER `?? 0` (F-32) — `risk` is null whenever a gate refused
  // before the matrix ran, and a length that was never derived is not zero.
  tripDays: risk?.tripDays ?? null,
  approvalRoute,
  // The gate's reason, so a sanctions block can name the destination instead of
  // blaming the risk matrix. Mirrors src/uc04/requestParser.js's own argument.
  reason,
});

// riskEngine.js: UC-04's base tier is "medium" — any flag pushes it to "high".
const riskTier = flags.length > 0 ? 'high' : 'medium';

// DISPLAY/AUDIT ONLY, both of them. Nothing on this graph branches on either,
// and nothing may: `Route by Decision` switches on `decision` and must go on
// doing so. `internalNote` is consumed by ONE node — "Flag Awaiting Specialist
// Approval" — via `={{ $('Workation Gates').item.json.internalNote }}`, the
// same shape UC-01's "Compose Internal Note" already feeds its two note nodes.
// It lives here rather than in the Zendesk node's parameters because an inline
// expression is versioned by nothing: `npm run verify-deployed` diffs this
// file's bytes against the deployed body, and it cannot see a hand-typed
// string in a node parameter at all.
const awaitingDecision = describeAwaitingDecision(decision);
const internalNote = composeInternalNote({
  decision,
  reason,
  summary,
  flags,
  riskLevel: risk?.riskLevel ?? 'unknown',
});

return [{
  json: {
    ...request,
    employment,
    decision,
    reason,
    flags,
    risk,
    factorIssues,
    approvalRoute,
    awaitingDecision,
    summary,
    internalNote,
    riskTier,
  },
}];
