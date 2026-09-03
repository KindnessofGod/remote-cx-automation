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
// WHAT THIS NODE NEVER DOES, AND WHY — CORRECTED 2026-08-31
// This node body computes the decision and the notice/payout figures and
// nothing else: no remote.post/patch/put/delete calls, no write payload to
// construct. The real src/uc05/workflow.js's own structural test asserts the
// same.
//
// THE REASON THIS PARAGRAPH USED TO GIVE WAS FALSE AND IS RETRACTED. It read:
// "UC-05 has NO Remote write endpoint — the spec itself (§3) and the ticket
// confirm PUT /v1/resignations/{id}/validate does not exist." That endpoint
// DOES exist — `PUT /v1/resignations/{offboarding_request_id}/validate`, scope
// `resignation:write`, in Remote's own llms.txt (docs/REMOTE-API-INDEX.txt:330)
// and on developer.remote.com, read 2026-08-21 — and its body is shaped almost
// exactly like this use case's sign-off form. docs/use-cases/UC-05.md §1 has
// carried the correction since: *"The stated reason is false and the rule still
// stands … It is a policy choice."*
//
// The RULE is unchanged: this system writes nothing. What changed is why. It
// holds no `resignation:write` scope, has no offboarding_request_id to call it
// with, and has taken no decision to adopt it — adopting it would convert a
// prepared report into an execution. The signed-off report is the durable
// artifact because we chose that, not because Remote left a gap.
//
// This is CLAUDE.md §3's substitution ladder failing at rung 1, and it is the
// third instance in this repository: two of the three endpoints recorded here
// as absent turned out to exist (00-FOUNDATION.md §2a). A Sandbox — or a
// spec pack — that refuses is rung 2 failing, not rung 1 answering.
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
      // THE REAL SANDBOX RECORD CARRIES `provisional_start_date`, NOT `start_date`.
      // This line read only `start_date` / `basic_information.start_date` — the
      // stand-in's ENRICHED shape, filled for exactly two hard-coded employment
      // ids (src/remotebridge/enrichment.js STANDIN_PROFILES) — so every other
      // real employee escalated `missing_seniority_date` on this graph while
      // src/remote/restClient.js normalizeEmployment() read the date fine one
      // path over. Measured 2026-09-02: executions 11936 and 11939, two real
      // Portuguese records with provisional_start_date 2023-06-26, both
      // refused. Same precedence as normalizeEmployment() and UC-01's gates.js.
      start_date:
        empRaw.basic_information?.provisional_start_date ??
        empRaw.provisional_start_date ??
        empRaw.basic_information?.seniority_date ??
        empRaw.start_date ??
        empRaw.basic_information?.start_date ??
        null,
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
    // s.86(2), NOT s.86(1). The ladder here was the EMPLOYER's; an employee owes
    // one week flat from one month's continuous employment. At 121 months this
    // asked for 84 days against a statutory 7. D-41, legislation.gov.uk.
    // Mirrors src/uc05/noticePeriodTable.js.
    brackets: [
      { tenureMinMonths: 1, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: 'continuous',
    sourceCitation: "Employment Rights Act 1996 s. 86(2) - one week, flat, from one month's continuous employment. s. 86(1)'s sliding scale is the EMPLOYER's and does not bind a resigning employee.",
  },
  IE: {
    countryCode: 'IE', countryName: 'Ireland', basis: 'statutory', unit: 'calendar',
    // s.6, NOT s.4 -- s.4 is the employer's ladder. The number was right and the
    // citation was not. THIRTEEN WEEKS is 91 days and is not three months, so
    // the threshold is stated in days. D-42, irishstatutebook.ie.
    brackets: [
      { tenureMinMonths: 3, tenureMinDays: 91, tenureMaxMonths: null, noticeDays: 7 },
    ],
    probation: null,
    anchorRule: 'continuous',
    sourceCitation: "Minimum Notice and Terms of Employment Act 1973 s. 6 - one week, from thirteen weeks' continuous service. s. 4 is the EMPLOYER's ladder and does not bind a resigning employee.",
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
    // Months as MONTHS (30 days is not one month), and month_1st -> month_end:
    // art. 30 par 2-1 ends a monthly notice period on the LAST DAY of a calendar
    // month, so every Polish answer was one day past a date that cannot be a
    // last working day. The two-week bracket overrides the row with
    // `week_saturday`, because a weekly period ends on a SATURDAY -- the other
    // half of the same subsection, built 2026-09-02. D-43,
    // api.sejm.gov.pl. Mirrors src/uc05/noticePeriodTable.js.
    brackets: [
      { tenureMinMonths: 0, tenureMaxMonths: 5, noticeDays: 14, anchorRule: 'week_saturday' },
      { tenureMinMonths: 6, tenureMaxMonths: 35, noticeMonths: 1 },
      { tenureMinMonths: 36, tenureMaxMonths: null, noticeMonths: 3 },
    ],
    probation: null,
    anchorRule: 'month_end',
    sourceCitation: 'Kodeks pracy art. 36 par 1, mutual under art. 32 par 1 - two weeks / one month / three months at under six months, six months, and three years service. art. 30 par 2-1 ends a notice period stated in months on the LAST DAY of a calendar month, and one stated in weeks on the following SATURDAY; both are applied.',
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
    // THE FABRICATED 0 / 7 / 14 BRACKETS ARE GONE (2026-09-02). They were
    // invented figures on a document HR Ops signs, and a six-week employee
    // rendered as "0 days notice ... running 2026-09-02 to 2026-09-02" beside a
    // citation saying there is no statutory minimum. CONTRADICTIONS.md C-30
    // decided this removal on 2026-08-21 and it stayed unbuilt for twelve days.
    // Mirrors src/uc05/noticePeriodTable.js -- these two decide together or
    // n8nUc05Parity goes red.
    //
    // THE REFUSAL WORDING GAINED A QUEBEC VARIANT 2026-09-02, and without one it
    // was false for a whole province. The old string said the notice owed "is
    // contractual or common-law reasonable notice". D-44: Quebec is CIVIL law,
    // Code civil art. 2091 binds CHACUNE DES PARTIES -- either party -- so the
    // resigning employee owes a delai de conge under ENACTED law, and art. 2092
    // makes the remedy for an insufficient one non-renounceable, so it is not
    // even a term a contract may bargain away. What art. 2091 does not state is
    // a NUMBER, which is why this stays a refusal rather than becoming a
    // bracket. The province is not read anywhere in this system, so both
    // regimes are stated rather than one being guessed at. C-35.
    countryCode: 'CA', countryName: 'Canada', basis: 'none', unit: 'none',
    noStatutoryMinimum: true,
    // The field that keeps Canada from being DESCRIBED as the United States.
    // Both rows carry noStatutoryMinimum; only this one means "at least one
    // jurisdiction inside this country binds the employee by statute and states
    // no quantity". Read off the rule, never keyed on the country code.
    noticeStandardWithoutNumber: true,
    brackets: [],
    probation: null,
    anchorRule: null,
    sourceCitation: 'No statutory minimum notice PERIOD runs against a resigning employee under the Canada Labour Code or the provincial employment standards Acts - those notice provisions bind the EMPLOYER on termination (Ontario ESA 2000 s. 54/57 is expressly "No employer shall terminate"). What the resigning employee owes then depends on the province, which this system does not read: in the COMMON-LAW provinces it is contractual or common-law reasonable notice, and this system does not hold the contract; in QUEBEC it is statutory and mutual - Code civil art. 2091 requires either party to give a delai de conge in reasonable time, judged on the nature of the employment, its circumstances and the duration of service, and art. 2092 makes the employee remedy for insufficient notice non-renounceable. Neither regime states a number of days, which is why this is a refusal rather than a figure.',
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
    // During probation art. 114 par 1 lets either party terminate SEM AVISO
    // PREVIO, so a resigning employee owes NOTHING. The 15 here was the
    // employer's figure, and Lei 13/2023 raised that to 30 in any case. The old
    // citation pointed at art. 400, which contains no probation rule at all.
    probation: null,
    noStatutoryProbationNotice: true,
    anchorRule: 'continuous',
    sourceCitation: 'Codigo do Trabalho art. 400(1) - 30 or 60 days, split on ate dois anos ou mais de dois anos. DURING PROBATION art. 114(1) lets either party terminate sem aviso previo, so a resigning employee owes NOTHING and no statutory end date is computed; the 7/15/30-day figures in art. 114 are the employer\'s. The article says "salvo acordo escrito em contrario", so a written contract may require notice where the statute does not - and this system holds no contract, which is why a probationer is escalated rather than told they may leave today.',
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

// Mirrors src/uc05/noticePeriodTable.js's pickBracket(). `tenureMonths` here is
// the EXACT (fractional) value -- see tenureMonthsExactBetween below. Walking
// the upper bounds in order is what keeps 24.5 months from falling into the gap
// between a bracket ending at 24 and one starting at 25.
function pickBracket(rule, tenureMonths, onProbation, tenureDays) {
  if (!rule) return null;
  const pool = (onProbation && rule.probation) ? [rule.probation] : rule.brackets;
  if (!pool || !pool.length) return null;
  const floorDays = pool[0].tenureMinDays;
  if (typeof floorDays === 'number') {
    if (!Number.isFinite(tenureDays) || tenureDays < floorDays) return null;
  } else {
    const tableFloor = pool[0].tenureMinMonths == null ? -Infinity : pool[0].tenureMinMonths;
    if (Math.floor(tenureMonths) < tableFloor) return null;
  }
  for (let i = 0; i < pool.length; i++) {
    const max = pool[i].tenureMaxMonths == null ? Infinity : pool[i].tenureMaxMonths;
    if (tenureMonths <= max) return pool[i];
  }
  return null;
}

// Months WITHOUT flooring, for bracket boundaries only. Every tenureMaxMonths is
// an inclusive upper bound, so a floored count puts "two years and fifteen days"
// inside "up to two years" -- Portugal art. 400.o(1), which gave such an
// employee HALF the notice they owe. Rendered prose keeps the whole number.
// Mirrors tenureMonthsExactBetween() in src/uc05/noticePeriodCalculator.js.
function tenureMonthsExactBetween(startDate, now) {
  const whole = tenureMonthsBetween(startDate, now);
  if (!Number.isFinite(whole)) return whole;
  const start = new Date(startDate);
  const ref = new Date(now);
  const anniversary = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + whole, start.getUTCDate()));
  const elapsedDays = Math.round((ref.getTime() - anniversary.getTime()) / 86400000);
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return whole;
  const nextAnniversary = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + whole + 1, start.getUTCDate()));
  const monthDays = Math.round((nextAnniversary.getTime() - anniversary.getTime()) / 86400000) || 30;
  return whole + Math.min(elapsedDays / monthDays, 0.999999);
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
    // THE END OF THIS MONTH, NOT THE NEXT. BGB 622(1) permits termination on
    // the 15th or the end of a calendar month, so the date to snap to is the
    // next permitted one ON OR AFTER the raw end. Going to the FOLLOWING
    // month's end overshoots by up to 31 days and made the result
    // non-monotonic: a German employee resigning on 4 October left sixteen days
    // EARLIER than one resigning on 3 October. Mirrors the same correction in
    // src/uc05/noticePeriodCalculator.js -- these two bodies decide together or
    // test/n8nUc05Parity.test.js goes red.
    const lastDayOfThisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { date: toIsoDate(lastDayOfThisMonth), adjusted: toIsoDate(lastDayOfThisMonth) !== toIsoDate(d) };
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
  if (anchorRule === 'week_saturday') {
    // Kodeks pracy art. 30 par 2-1 (D-43): a notice period comprising a week or
    // a multiple of weeks ends ON A SATURDAY -- the same sentence, and the same
    // statutory force, as the month_end rule its Polish siblings use. Poland's
    // two-week bracket carried `continuous` and a comment saying it was
    // unanchored because this value did not exist; it does now.
    //
    // FORWARD ONLY: a notice period may be lengthened to reach its statutory
    // landing day and never shortened to it. getUTCDay() is 6 on Saturday, so
    // the distance is 0 on a Saturday and an already-landing date is untouched.
    // Mirrors src/uc05/noticePeriodCalculator.js -- these two bodies decide
    // together or test/n8nUc05Parity.test.js goes red.
    const daysToSaturday = (6 - d.getUTCDay() + 7) % 7;
    if (daysToSaturday === 0) return { date: rawEnd, adjusted: false };
    d.setUTCDate(d.getUTCDate() + daysToSaturday);
    return { date: toIsoDate(d), adjusted: true };
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

// --- noticeReconciliation.js: Remote's own days_of_notice against ours -------
// Ported from src/uc05/noticeReconciliation.js. The sentences are byte-identical
// to that file's and test/n8nUc05Parity.test.js compares the whole block with
// deepEqual, so a paraphrase here fails rather than drifting onto a screen.
//
// WHY IT IS HERE AT ALL. Remote publishes `days_of_notice` on every resignation
// record -- "The number of calendar days of notice required based on the
// contract terms and local labor laws" -- and nothing in this repository read it
// until 2026-09-02. It BLENDS contract and statute in one integer with no field
// saying which produced it; ours is statute-only and names its statute. The
// product is the disagreement, not a better number, so neither figure is
// preferred here and three of `governing`'s four values are not a choice at all.
//
// This node does not fetch it either: `Normalize Resignation Request` passes
// whatever the caller supplied, and absent that the block reports
// `not_compared / remote_figure_absent` -- never silence, because an absence
// read as an agreement is the one failure this whole block exists to prevent.
const REMOTE_PROVENANCE =
  'Remote\'s own resignation record (`days_of_notice`) — Remote states this is the notice required ' +
  'based on the CONTRACT TERMS AND local labour law together. Remote publishes no field saying which ' +
  'of the two produced it.';

const STATUTE_PROVENANCE =
  'This system\'s own statutory notice table, derived from the statute named beside it and from ' +
  'length of service alone. It has read no contract.';

function isDayCount(v) {
  return Number.isInteger(v) && v >= 0;
}

function reconcileNoticeFigures(args) {
  const a = args || {};
  const statuteDays = a.statuteDays == null ? null : a.statuteDays;
  const statuteMonths = a.statuteMonths == null ? null : a.statuteMonths;
  const statuteQuantity = a.statuteQuantity == null ? null : a.statuteQuantity;
  const statuteCitation = a.statuteCitation == null ? null : a.statuteCitation;
  const remoteDaysOfNotice = a.remoteDaysOfNotice === undefined ? null : a.remoteDaysOfNotice;
  const remoteRecordRef = a.remoteRecordRef == null ? null : a.remoteRecordRef;

  const remoteSide = {
    daysOfNotice: isDayCount(remoteDaysOfNotice) ? remoteDaysOfNotice : null,
    provenance: REMOTE_PROVENANCE,
    recordRef: remoteRecordRef,
  };
  const statuteSide = {
    days: isDayCount(statuteDays) ? statuteDays : null,
    months: Number.isFinite(statuteMonths) ? statuteMonths : null,
    quantity: statuteQuantity,
    provenance: statuteCitation ? STATUTE_PROVENANCE + ' Statute applied: ' + statuteCitation : STATUTE_PROVENANCE,
  };

  function notCompared(notComparedReason, missingSide, sentence) {
    return {
      compared: false,
      verdict: 'not_compared',
      notComparedReason: notComparedReason,
      missingSide: missingSide,
      remote: remoteSide,
      statute: statuteSide,
      differenceDays: null,
      governing: null,
      sentence: sentence,
    };
  }

  // Order is the order of blame: our own missing figure first, so a specialist
  // is never pointed at Remote for a gap on this side.
  if (statuteSide.days === null && statuteSide.months === null) {
    return notCompared(
      'no_statutory_figure',
      'statute',
      'No statutory notice figure was produced, so there is nothing to hold Remote\'s own figure against. ' +
        'This is not a finding that the two agree.'
    );
  }
  if (statuteSide.days === null) {
    return notCompared(
      'statute_figure_not_a_day_count',
      null,
      'The statute states this notice period as ' + (statuteSide.quantity == null ? 'a number of months' : statuteSide.quantity) + ', not as a number of days, ' +
        'and a month is not thirty days — so it cannot be subtracted from Remote\'s day count without inventing a figure ' +
        'neither source states. Both figures are shown; the comparison is deliberately not made.'
    );
  }
  if (remoteDaysOfNotice === null || remoteDaysOfNotice === undefined) {
    return notCompared(
      'remote_figure_absent',
      'remote',
      'Remote\'s own notice figure (`days_of_notice`) was not read for this resignation, so the statutory figure ' +
        'shown here stands alone. It has NOT been checked against the notice Remote and the contract between them ' +
        'require, and an absence is not an agreement.'
    );
  }
  if (remoteSide.daysOfNotice === null) {
    return notCompared(
      'remote_figure_unreadable',
      'remote',
      'Remote\'s resignation record carried a `days_of_notice` value this system could not read as a number of days ' +
        '(' + JSON.stringify(remoteDaysOfNotice) + '), so no comparison was made. This is a failed read, not a finding that the ' +
        'two figures agree.'
    );
  }

  const differenceDays = remoteSide.daysOfNotice - statuteSide.days;
  const both = 'Remote\'s record requires ' + remoteSide.daysOfNotice + ' days of notice; the statute this system applied requires ' + (statuteSide.quantity == null ? statuteSide.days + ' days' : statuteSide.quantity) + '.';

  if (differenceDays === 0) {
    return {
      compared: true,
      verdict: 'agree',
      notComparedReason: null,
      missingSide: null,
      remote: remoteSide,
      statute: statuteSide,
      differenceDays: 0,
      governing: 'agreed',
      sentence: both + ' They agree, and both are shown because an agreement nobody can see is not evidence of one.',
    };
  }
  if (differenceDays > 0) {
    return {
      compared: true,
      verdict: 'remote_longer',
      notComparedReason: null,
      missingSide: null,
      remote: remoteSide,
      statute: statuteSide,
      differenceDays: differenceDays,
      governing: 'remote_notice_satisfies_both',
      sentence:
        both + ' Remote\'s is ' + differenceDays + ' days LONGER — most likely a contractual notice period above the statutory ' +
        'floor, which is lawful. Serving Remote\'s longer period also serves the statutory minimum, so there is nothing ' +
        'here to choose between: the statutory figure is a floor, not a ceiling, and it is not the answer on its own.',
    };
  }
  return {
    compared: true,
    verdict: 'statute_longer',
    notComparedReason: null,
    missingSide: null,
    remote: remoteSide,
    statute: statuteSide,
    differenceDays: differenceDays,
    governing: 'undetermined',
    sentence:
      both + ' Remote\'s is ' + Math.abs(differenceDays) + ' days SHORTER than the statutory minimum this system computed. ' +
      'The two cannot both be satisfied. Which instrument governs is a question of law, and this system does not answer ' +
      'it: it holds no contract, and Remote\'s figure does not say whether the contract or the statute produced it.',
  };
}

function computeNoticePeriod({ countryCode, startDate, probationEndDate, proposedEndDate, now, remoteDaysOfNotice, remoteRecordRef }) {
  // One closure so no branch can return a notice object with NO reconciliation
  // block on it -- which is the shape a reader would take for "the figures
  // agree" by absence. Mirrors src/uc05/noticePeriodCalculator.js.
  function reconcile(bracketish) {
    return reconcileNoticeFigures({
      statuteDays: bracketish && Number.isFinite(bracketish.noticeDays) ? bracketish.noticeDays : null,
      statuteMonths: bracketish && Number.isFinite(bracketish.noticeMonths) ? bracketish.noticeMonths : null,
      statuteQuantity: bracketish ? quantityText(bracketish) : null,
      statuteCitation: bracketish && bracketish.sourceCitation ? bracketish.sourceCitation : null,
      remoteDaysOfNotice: remoteDaysOfNotice === undefined ? null : remoteDaysOfNotice,
      remoteRecordRef: remoteRecordRef === undefined ? null : remoteRecordRef,
    });
  }

  const rule = getNoticeRule(countryCode);
  if (!rule) {
    return {
      countryCode: (countryCode == null ? '' : String(countryCode)).toUpperCase(),
      basis: 'unknown', unit: 'unknown',
      sourceCitation: 'Country not in the statutory notice table this system holds.',
      tenureMonths: 0, onProbation: false, noticeDays: 0,
      // THE DATES TENURE WAS MEASURED BETWEEN — start date as the calculation saw it, and the day it counted to.
      // The sidebar re-reads the record when it opens; if that record's start date differs, a signer must see both.
      tenureMeasuredFrom: startDate ?? null,
      tenureMeasuredTo: toCalendarDay(now),
      noticeStartDate: null, noticeEndDate: null,
      // No rule for this country at all — see the real calculator's typedef.
      noticeRuleFound: false,
      // NULL, not false: we hold no rule, so we do not KNOW whether a statutory
      // minimum exists. `false` is reserved for the sourced finding that none
      // does. CONTRADICTIONS.md C-29.
      statutoryMinimumExists: null, noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
      reconciliation: reconcile(null),
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
      noticeDays: null, tenureMeasuredFrom: startDate ?? null, tenureMeasuredTo: toCalendarDay(now), noticeStartDate: null, noticeEndDate: null,
      noticeRuleFound: true, statutoryMinimumExists: false,
      // Canada is not the United States. Both rows say `noStatutoryMinimum`; only
      // Canada's means "at least one province binds the employee by ENACTED law
      // and states no quantity" (Quebec, CCQ art. 2091, D-44). Carried from the
      // rule so no consumer has to learn a country code to describe it.
      noticeStandardWithoutNumber: rule.noticeStandardWithoutNumber === true,
      noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
      reconciliation: reconcile(null),
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

  // THE STATUTE SAYS ZERO DURING PROBATION -- branched BEFORE pickBracket(),
  // which sees `probation: null` and falls through to the ordinary bracket. That
  // is how a Portuguese probationer was answered with 30 days beside a citation,
  // in the same object, saying they owed nothing. Codigo do Trabalho art. 114(1):
  // "qualquer das partes pode denunciar o contrato sem aviso previo".
  //
  // No end date is produced, and NOT `noticeDays: 0` -- art. 114(1) opens "salvo
  // acordo escrito em contrario", unless otherwise agreed in writing, so the
  // statutory zero is a default a written contract may displace and this system
  // holds no contract. Same shape as the US and Canadian rows. Mirrors
  // src/uc05/noticePeriodCalculator.js.
  if (onProbation && rule.noStatutoryProbationNotice === true) {
    return {
      countryCode: rule.countryCode, basis: rule.basis, unit: rule.unit,
      sourceCitation: rule.sourceCitation, tenureMonths, onProbation: true,
      noticeDays: null, tenureMeasuredFrom: startDate ?? null, tenureMeasuredTo: toCalendarDay(now), noticeStartDate: null, noticeEndDate: null,
      // TRUE: Portugal HAS a statutory regime -- art. 400(1) applies the day
      // probation ends. `false` is reserved for a country whose law imposes none
      // on a resigning employee at all.
      noticeRuleFound: true, statutoryMinimumExists: true,
      noStatutoryProbationNotice: true,
      noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
      reconciliation: reconcile(null),
    };
  }

  // Whole months for the prose, exact months for the boundary.
  const tenureMonthsExact = startDate ? tenureMonthsExactBetween(startDate, nowIso) : 0;
  const tenureDays = startDate
    ? Math.round((new Date(nowIso).getTime() - new Date(startDate).getTime()) / 86400000)
    : 0;
  const bracket = pickBracket(rule, tenureMonthsExact, onProbation, tenureDays);
  if (!bracket) {
    return {
      countryCode: rule.countryCode, basis: rule.basis, unit: rule.unit,
      sourceCitation: rule.sourceCitation, tenureMonths, onProbation,
      noticeDays: 0, tenureMeasuredFrom: startDate ?? null, tenureMeasuredTo: toCalendarDay(now), noticeStartDate: nowIso, noticeEndDate: null,
      // The country's rule EXISTS; no bracket in it covers this tenure.
      noticeRuleFound: true, statutoryMinimumExists: true,
      noticeMonths: null, noticeQuantity: null,
      proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
      discrepancyDays: null, discrepancy: unmeasuredDiscrepancy(proposedEndDate), anchorAdjusted: false,
      reconciliation: reconcile(null),
    };
  }

  const rawStart = nowIso;
  // A bracket states its period in days OR in months, and which one is a fact
  // about the statute. Only NL is month-denominated today.
  const rawEnd = Number.isFinite(bracket.noticeMonths)
    ? addCalendarMonths(rawStart, bracket.noticeMonths)
    : addCalendarDays(rawStart, bracket.noticeDays);
  // A bracket may override its row's anchor -- Poland ends a MONTHLY notice at a
  // month end and a WEEKLY one on a Saturday, two rules inside one country.
  // Mirrors src/uc05/noticePeriodCalculator.js.
  const anchor = applyAnchor(rawEnd, bracket.anchorRule == null ? rule.anchorRule : bracket.anchorRule);

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
    // THE DATES TENURE WAS MEASURED BETWEEN — start date as the calculation saw it, and the day it counted to.
    // The sidebar re-reads the record when it opens; if that record's start date differs, a signer must see both.
    tenureMeasuredFrom: startDate ?? null,
    tenureMeasuredTo: toCalendarDay(now),
    noticeStartDate: rawStart, noticeEndDate: anchor.date,
    noticeRuleFound: true, statutoryMinimumExists: true,
    proposedEndDate: proposedEndDate == null ? null : proposedEndDate,
    discrepancyDays, discrepancy, anchorAdjusted: anchor.adjusted,
    reconciliation: reconcile(Object.assign({}, bracket, { sourceCitation: rule.sourceCitation })),
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
function unusableFields(balance, statedCurrency) {
  const missing = [];
  if (!balance || typeof balance !== 'object') return ['balance'];
  // NO CURRENCY, NO MONEY — mirrors src/uc05/ptoPayout.js. This body used to
  // default to 'USD' in four places and the normalize node in two more, so a
  // ticket-filed Portuguese resignation settled in dollars on every run.
  if (!statedCurrency) missing.push('currency');
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

function payoutCurrencyFor(stated, employment) {
  // Stated by the caller, else Remote's own compensation_currency_code, else
  // nothing. Same precedence as src/uc05/ptoPayout.js payoutCurrencyFor().
  const norm = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
  const emp = employment && typeof employment === 'object' ? employment : {};
  const fromContract = emp.contract_details && typeof emp.contract_details === 'object' ? emp.contract_details.compensation_currency_code : null;
  return norm(stated) || norm(fromContract) || norm(emp.currency) || null;
}

function reconcilePtoPayout({ balances, currency, hoursPerDay, reportedBalanceInRemoteInteger }) {
  const hoursPerDayFinal = hoursPerDay == null ? 8 : hoursPerDay;
  const reportedBalance = reportedBalanceInRemoteInteger == null ? null : reportedBalanceInRemoteInteger;
  const statedCurrency = typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : null;
  if (!Array.isArray(balances) || balances.length === 0) {
    return {
      lines: [], totalInRemoteInteger: 0, currency: statedCurrency,
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
    const missing = unusableFields(b, statedCurrency);
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
      currency: statedCurrency,
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
    currency: statedCurrency,
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
// A REASON ALONE DOES NOT SILENCE THE LETTER — mirrors src/uc05/workflow.js.
// The typed DATE is what makes extraction unnecessary; a typed reason is merged
// with whatever the letter says. (Found live 2026-09-02, ticket 227.)
let extraction;
if (explicitProposedEndDate) {
  extraction = { proposedEndDate: explicitProposedEndDate, reason: explicitReason, confidence: 1.0, source: 'structured_input' };
} else {
  const extracted = ruleBasedExtraction(request.letterText || '');
  extraction = Object.assign({}, extracted, { reason: explicitReason == null ? (extracted && extracted.reason != null ? extracted.reason : null) : explicitReason });
}

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
    // Remote's own `days_of_notice`, when the caller read one. Nothing on this
    // graph fetches it -- there is no `resignation:read` scope and no
    // offboarding_request_id anywhere in this system -- so it is normally absent
    // and the block says so rather than letting one figure read as checked.
    remoteDaysOfNotice: request.remoteDaysOfNotice == null ? null : request.remoteDaysOfNotice,
    remoteRecordRef: request.offboardingRequestId == null ? null : request.offboardingRequestId,
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
    // A FOURTH reason, ported from policyEngine.js and checked FIRST because it
    // is the most specific: the statute POSITIVELY provides that no notice runs
    // during probation (Codigo do Trabalho art. 114(1)). The other three would
    // each describe it wrongly -- extend the table, the country sets none, we do
    // not cover the country. It escalates because art. 114(1) defers to a written
    // agreement this system has not read.
    if (notice.noStatutoryProbationNotice === true) {
      decision = 'escalate';
      reason = 'no_statutory_notice_during_probation';
      flags = [
        'no_statutory_notice_during_probation',
        'country_' + (notice.countryCode || 'unknown'),
        'on_probation',
        'contractual_notice_not_held',
      ];
    } else if (notice.statutoryMinimumExists === false) {
      decision = 'escalate';
      reason = 'no_statutory_notice_period';
      flags = [
        'no_statutory_notice_period',
        'country_' + (notice.countryCode || 'unknown'),
        'contractual_notice_not_held',
      ];
      // Canada carries one more flag than the United States, off the table row
      // rather than off the country code: at least one province binds the
      // employee by statute and states no number (Quebec, CCQ art. 2091), so
      // "contractual_notice_not_held" alone is false there.
      if (notice.noticeStandardWithoutNumber === true) flags.push('notice_standard_not_a_number');
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
      // Never 'USD'. Stated on the request, else Remote's own currency off the
      // employment record this graph already fetched, else nothing — and
      // nothing refuses the line.
      currency: payoutCurrencyFor(request.currency, empRaw),
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

      // Gate 5b -- Remote's own days_of_notice against the statute's. Ported
      // from policyEngine.js; see noticeReconciliation.js above for why neither
      // figure is preferred. Only `statute_longer` decides: a longer contractual
      // notice is lawful and is the ordinary case in EOR work, and `agree` /
      // `not_compared` add no flag, because flagging every case would put a row
      // in the exception ranking for every resignation this system ever sees.
      //
      // It does NOT reuse `statutory_discrepancy`: that rung's own sentence
      // opens "The end date proposed in the resignation is EARLIER than the
      // statutory minimum notice allows", and no employee proposal is involved
      // here. Same desk, different finding, its own name.
      const reconciliation = notice.reconciliation == null ? null : notice.reconciliation;
      if (reconciliation && reconciliation.verdict === 'remote_longer') {
        flags.push('remote_notice_longer_than_statutory', 'remote_notice_days_' + reconciliation.remote.daysOfNotice);
      }

      // Gate 6 — is the PTO payout actually computable? (finding F-28)
      // Placed after the discrepancy gate: "ordered gates, first failure wins",
      // and a real statutory discrepancy must not be relabelled a data problem
      // and sent to the wrong desk. Decisive on the previously-passing path —
      // a report reaching HR Ops with a null payout total reads as "no payout
      // due" when the truth is "we could not work it out".
      if (reconciliation && reconciliation.verdict === 'statute_longer') {
        flags.push(
          'remote_notice_below_statutory',
          'notice_shortfall_days_' + Math.abs(reconciliation.differenceDays),
          'remote_notice_days_' + reconciliation.remote.daysOfNotice
        );
        decision = 'escalate'; reason = 'remote_notice_below_statutory';
      } else if (payout && payout.computable === false) {
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

// ---------------------------------------------------------------------------
// composeInternalNote() — the Zendesk internal note, composed HERE
// ---------------------------------------------------------------------------
// WHY THE NOTE MOVED INTO THIS FILE
//
// Until 2026-08-31 UC-05's three terminal Zendesk nodes each carried a
// hand-typed sentence in `updateFields.internalNote`. A Zendesk "update
// ticket" node has no `jsCode`, so `npm run verify-deployed` — which diffs
// `parameters.jsCode` against a repo file — is STRUCTURALLY BLIND to it, and
// `test/n8nUc05Parity.test.js` cannot see it either: parity compares
// DECISIONS, and a node that reaches the right verdict and describes it in
// false words passes every time. So the prose on real customers' tickets was
// versioned by nothing and read back by no check.
//
// Composing it here puts it inside a file that IS byte-diffed against the
// deployed node, exactly as UC-01 (workflows/nodes/composeInternalNote.js) and
// UC-04 (workflows/nodes-uc04/workationGates.js) already do. The node's job
// shrinks to interpolating one field.
//
// THREE THINGS THE OLD SENTENCES GOT WRONG. Each is a claim, not a style
// preference, and each was live on this graph.
//
// 1. "No Remote write exists for resignations — the signed-off report IS the
//    durable artifact."  ("Flag Awaiting HR Ops Sign-off")
//
//    THE SECOND HALF IS TRUE. THE FIRST HALF IS A RETRACTED CLAIM ABOUT
//    REMOTE'S PLATFORM. `PUT /v1/resignations/{offboarding_request_id}/validate`
//    exists, scope `resignation:write`, and its request body is shaped almost
//    exactly like this use case's own sign-off form — Remote's own `llms.txt`
//    (docs/REMOTE-API-INDEX.txt:330) and developer.remote.com, read
//    2026-08-21. docs/use-cases/UC-05.md §1 has carried the correction banner
//    since that date: *"The stated reason is false and the rule still stands
//    … It is a policy choice."*
//
//    This is CLAUDE.md §3's substitution ladder failing at rung 1 — three
//    times this project recorded a Sandbox or documentation limitation as a
//    fact about Remote's platform, and TWO OF THE THREE turned out to exist
//    (00-FOUNDATION.md §2a). The behaviour is right and unchanged: this system
//    writes nothing. What changes is the stated reason, from a false claim
//    about Remote's API to a true claim about our own capability and choice —
//    same operational outcome, and a specialist can no longer repeat the false
//    half of it to a customer.
//
//    The alternative — deleting the sentence — would have cost the reader the
//    only line that says why a signed-off report is the end of the road here,
//    which is the question the sign-off screen raises.
//
// 2. "AI prepared discrepancy report" / "AI summary — ESCALATED".
//
//    NEITHER IS AI. This graph has 16 nodes and ONE http call, to Remote —
//    there is no LLM node anywhere on it. The figures come from
//    computeNoticePeriod()/reconcilePtoPayout() above (a statutory table and
//    arithmetic), and the letter reading is `ruleBasedExtraction()`, regex
//    date matching, which tags itself `source: 'rule_based_fallback'`.
//    Calling deterministic arithmetic "AI" inverts prime directive 1 — *LLMs
//    interpret; deterministic code decides* — and invites a specialist to
//    distrust a statutory notice table because they were told a model wrote
//    it. The note now says which reader produced the extraction, by name.
//
// 3. "discrepancy report", on the node reached ONLY when there is no
//    discrepancy.
//
//    `Flag Awaiting HR Ops Sign-off` sits on `prepared_for_signoff`, which is
//    the `else` of `if (notice.discrepancy === 'earlier_than_statutory')`
//    above. The word appeared exactly where a discrepancy is guaranteed
//    ABSENT, and was missing from the escalate note where one is guaranteed
//    PRESENT. It is a notice-period report.
//
// 4. "No report was prepared for sign-off" on EVERY escalation.
//
//    True of six of the eight escalate reasons and MISLEADING for two of
//    them. On `statutory_discrepancy` and `pto_balance_unusable` the notice
//    period is fully computed before the branch, and `Create Resignation
//    Record` writes the `notice` and `payout` columns on every decision (read
//    live off the node, 2026-08-31) — so the arithmetic is durable and in the
//    row. What is absent is the sign-off PATH, not the figures. Those are
//    precisely the two escalations where the specialist most needs to know the
//    numbers are already there. FIGURES_ON_RECORD below is that distinction as
//    data, one row per reason, so the count in this header is checkable rather
//    than assertable.
//
// PURE, AND IT DECIDES NOTHING. Same contract as describeDecidingGate() in
// src/uc05/policyEngine.js: it reads a decision already made and cannot change
// what was decided. It is called AFTER every gate, on every branch, and its
// output is one more field on the item — `internalNote` — that no gate reads.
//
// THE WORDS ARE COPIED, NOT COMPOSED FRESH. An n8n Code node cannot import
// (see this file's header), so the established pattern here is to copy with
// attribution rather than invent a second wording that then drifts. Sources,
// per constant:
//   src/uc05/policyEngine.js   GATE_SEQUENCE's `means`, verbatim
//   src/uc05/signoffPolicy.js  REFUSALS.not_awaiting_signoff / describeNoSignoffPath()
//   src/shared/escalationRouting.js  the UC-05 row's escalationGroup
//   docs/use-cases/UC-05.md §1  the corrected automation-boundary sentence
// test/n8nUc05TerminalZendeskNodes.test.js holds the ported `means` strings
// against the originals by reading BOTH, rather than restating either.
// ---------------------------------------------------------------------------

// src/shared/escalationRouting.js's UC-05 row: `escalationGroup: "Local HR &
// Legal"`, which `escalationTeamFor("UC-05")` returns in preference to
// `group`. Inlined because a Code node cannot import it; held against the real
// table by the hermetic test rather than trusted. It is the LOCAL desk and not
// HR Ops on purpose — signing off is confirming a calculation, and a
// shortfall against statute is a legal question about one jurisdiction.
const ESCALATION_TEAM = 'Local HR & Legal';

// src/uc05/policyEngine.js's GATE_SEQUENCE, ported VERBATIM. `checks` is
// dropped (the note states the outcome, not the passing condition); `means` is
// byte-identical and is what the test compares.
const GATE_SEQUENCE = [
  {
    position: 1,
    reason: 'identity_not_verified',
    gate: 'identity',
    means:
      'We could not confirm the person filing this resignation is the employee it concerns (or HR acting for them), so no notice period was calculated. This is a failure to VERIFY — it is not a finding that the filing is fraudulent.',
  },
  {
    position: 2,
    reason: 'employee_not_active',
    gate: 'employment_status',
    means:
      'The employment record is missing or has already ended. A resignation against a record that is no longer active is a record-keeping question for HR, not a notice-period calculation.',
  },
  {
    position: 3,
    reason: 'missing_seniority_date',
    gate: 'seniority_date',
    means:
      'The employment record has no start date, so length of service — which every statutory notice period is calculated from — cannot be worked out. The record has to be corrected before any notice period can be produced. Nothing here says the notice would have been short or long.',
  },
  {
    position: 4,
    reason: 'unsupported_country',
    gate: 'country_rule',
    means:
      'This employee\'s country is not one of the countries whose statutory notice rules this system holds, so no notice period was calculated. That is a gap in our own table — it says nothing about what that country\'s law actually requires, which is exactly why it goes to a person rather than being guessed.',
  },
  {
    position: 5,
    reason: 'no_statutory_notice_period',
    gate: 'country_rule',
    means:
      'This country sets NO statutory minimum notice on a resigning employee — that is a sourced finding about the law, not a gap in our table, and it is the opposite of "unsupported country". What notice is owed comes from the employee\'s CONTRACT, and this system does not hold contracts and has not read one. Nobody should read this as "no notice is owed": the statute is silent, the contract may not be. Somebody has to open the contract.',
  },
  {
    position: 6,
    reason: 'no_statutory_notice_during_probation',
    gate: 'country_rule',
    means:
      'This employee is still inside their probationary period, and their country\'s own statute says that during it either side may end the contract WITHOUT notice — so there is no statutory notice period to calculate and no last working day to compute from one. That is a finding about the law, not a gap. It is not the same as saying nothing is owed: the article that gives the exemption gives it "unless otherwise agreed in writing", and this system holds no contract and has read none. Somebody has to open the contract before telling this person they can leave.',
  },
  {
    position: 7,
    reason: 'no_matching_notice_bracket',
    gate: 'notice_rule',
    means:
      'We DO hold statutory notice rules for this country — none of its brackets covers this employee\'s tenure. That is the opposite of "unsupported country", and the two used to be reported identically: a UK employee three weeks in was told the United Kingdom is unsupported, on a panel citing the UK statute one line above. Someone has to extend the table\'s low end, not add the country.',
  },
  {
    position: 8,
    reason: 'statutory_discrepancy',
    gate: 'discrepancy',
    // The one rung whose text is built rather than literal: src/uc05/
    // policyEngine.js interpolates ESCALATION_TEAM into it from the routing
    // table for the same reason it is a constant here — a hand-typed team name
    // is a second source of truth for a fact the table already owns, and the
    // last time this file's siblings carried one the screen said "Local HR
    // Legal" while every ticket went to HR Ops.
    means:
      ESCALATION_TEAM +
      ' has to decide how the shortfall is handled — the flags on the case carry how many days short it is, and where a source for that country\'s own notice statute has been read into this system, the case also carries what the statute itself says about serving short notice. This is not an arithmetic error; it is a real conflict between what was proposed and what the law requires.',
    // The sentence src/uc05/policyEngine.js opens this rung with, kept
    // separate so the interpolated half above can be compared with the
    // original by simple containment rather than by re-deriving the template.
    prefix: 'The end date proposed in the resignation is EARLIER than the statutory minimum notice allows. ',
  },
  {
    position: 9,
    reason: 'remote_notice_below_statutory',
    gate: 'notice_reconciliation',
    // The SECOND rung whose text is built rather than literal, for the same
    // reason as the one above it: the desk is the routing table's answer, and a
    // hand-typed team name is a second source of truth for a fact the table
    // owns. test/n8nUc05TerminalZendeskNodes.test.js checks both of these
    // against the RENDERED note rather than against a contiguous string here.
    means:
      'Remote\'s own record for this resignation states a notice period SHORTER than the statutory minimum this system computed from the statute. Remote states that its figure is built from the employment contract and local labour law together, and it does not say which of the two produced it — so this is the case where a contractual notice period may be sitting below the floor the law sets, and nothing else in this system would notice it. Both figures and both sources are on the case, and neither is presented as the answer. ' +
      ESCALATION_TEAM +
      ' decides which instrument governs: that is a question of law, and this system does not answer it.',
    // The literal half, kept separate so the interpolated one can be compared
    // with policyEngine.js's original by containment rather than by re-deriving
    // the template — the same shape the statutory_discrepancy rung uses.
    prefix: 'Remote\'s own record for this resignation states a notice period SHORTER than the statutory minimum this system computed from the statute. Remote states that its figure is built from the employment contract and local labour law together, and it does not say which of the two produced it — so this is the case where a contractual notice period may be sitting below the floor the law sets, and nothing else in this system would notice it. Both figures and both sources are on the case, and neither is presented as the answer. ',
  },
  {
    position: 10,
    reason: 'pto_balance_unusable',
    gate: 'pto_computable',
    means:
      'The PTO payout could not be worked out from the balance we were handed. It sits AFTER the statutory check deliberately: a legal discrepancy is a finding about the REQUEST, this is a problem with the DATA, and both escalate — so only the recorded reason differs, and mislabelling one as the other sends the case to the wrong desk. Signing off a report that simply left the figure blank would invite exactly the reading the money rules exist to prevent: "nothing is owed", when the truth is "we could not work it out".',
  },
  {
    position: 11,
    reason: 'all_gates_passed',
    gate: 'outcome',
    means:
      'Every check passed, so a notice-period and PTO-payout report has been prepared for HR Ops to sign off. Nothing has been filed with Remote on anyone\'s behalf: signing off records the report — it does not end the employment, and no part of this system does.',
  },
];

function describeDecidingGate(reasonSlug) {
  const row = GATE_SEQUENCE.filter((r) => r.reason === reasonSlug)[0];
  if (!row) return null;
  const positions = {};
  for (let i = 0; i < GATE_SEQUENCE.length; i++) positions[GATE_SEQUENCE[i].position] = true;
  return {
    position: row.position,
    gate: row.gate,
    total: Object.keys(positions).length,
    means: (row.prefix || '') + row.means,
  };
}

/**
 * WHAT IS ACTUALLY ON THE `uc05_resignations` ROW WHEN THIS REASON DECIDES.
 * One entry per reason evaluate() above can produce, as DATA rather than as a
 * paragraph, so "misleading for 2 of 8" is a count a test can take.
 *
 * `notice` is true when computeNoticePeriod() ran AND produced a
 * `noticeEndDate`; the three country-rule reasons reach it and it comes back
 * without one, which is not the same as having figures. `payout` is true when
 * reconcilePtoPayout() produced a usable total — deliberately FALSE for
 * `pto_balance_unusable`, whose whole finding is that the total could not be
 * computed, and where claiming a payout figure is on the row would be the
 * exact "nothing is owed" reading the money rules exist to prevent.
 *
 * Nothing here is read by a gate. It is evidence for a prose change, kept next
 * to the prose it justifies.
 */
const FIGURES_ON_RECORD = [
  { reason: 'identity_not_verified', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'employee_not_active', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'missing_seniority_date', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'unsupported_country', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'no_statutory_notice_period', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'no_statutory_notice_during_probation', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'no_matching_notice_bracket', notice: false, payout: false, retiredSentenceAccurate: true },
  { reason: 'statutory_discrepancy', notice: true, payout: true, retiredSentenceAccurate: false },
  // The notice period, its end date and the tenure are all computed before this
  // branch and Create Resignation Record writes them, so "no report was prepared
  // for sign-off" is misleading here for the same reason it is on the rows
  // around it. This is the escalation where BOTH figures matter most.
  { reason: 'remote_notice_below_statutory', notice: true, payout: true, retiredSentenceAccurate: false },
  { reason: 'pto_balance_unusable', notice: true, payout: false, retiredSentenceAccurate: false },
  { reason: 'all_gates_passed', notice: true, payout: true, retiredSentenceAccurate: false },
];

function figuresFor(reasonSlug) {
  return FIGURES_ON_RECORD.filter((r) => r.reason === reasonSlug)[0] || { reason: reasonSlug, notice: false, payout: false, retiredSentenceAccurate: false };
}

function moneyText(minorUnits, currencyCode) {
  if (typeof minorUnits !== 'number' || !isFinite(minorUnits)) return null;
  // shared/money.js's scaling, one direction only: Remote's integer minor
  // units back to a human figure. Never the reverse — nothing here is written
  // anywhere, and a note is not a payment instruction.
  // A figure with no currency is not a figure. Never pad one with 'USD'.
  if (typeof currencyCode !== 'string' || !currencyCode) return null;
  return (minorUnits / 100).toFixed(2) + ' ' + currencyCode;
}

/**
 * WHY THE SUBJECT LINE READS `empRaw` AND NOT `employment`.
 *
 * `employment` above is deliberately NARROW — id, status, country_code,
 * start_date, probation_end_date, email — because every field on it is an
 * input to a gate and nothing caller-supplied may reach it (see its own
 * comment: an identity control that compares a caller's claim against a
 * caller's claim proves nothing). A name and a job title are not gate inputs
 * and must not be added there just to be printed.
 *
 * So the subject line reads the RAW Remote response, DISPLAY ONLY, and is
 * gated on `employment` being non-null — i.e. on a usable record having come
 * back. Nothing here is compared, stored or branched on; if it renders
 * "not recorded" the note is thinner and no decision changes. The alternative,
 * widening the normalized object, would have put two more caller-reachable
 * fields next to the ones the identity gate reads, for a cosmetic gain.
 */
function subjectFacts() {
  if (!employment) return null;
  const raw = empRaw && typeof empRaw === 'object' ? empRaw : {};
  const basic = raw.basic_information && typeof raw.basic_information === 'object' ? raw.basic_information : {};
  return {
    fullName: raw.full_name ?? basic.name ?? basic.full_name ?? null,
    jobTitle: raw.job_title ?? basic.job_title ?? null,
    contractType: raw.contract_type ?? raw.type ?? null,
  };
}

function composeInternalNote(args) {
  const d = args.decision;
  const r = args.reason;
  const noticeRow = args.notice;
  const payoutRow = args.payout;
  const extractionRow = args.extraction;
  const flagList = args.flags && args.flags.length ? args.flags.join(', ') : 'none';
  const decidedBy = describeDecidingGate(r);
  const lines = [];

  // THE OPENING LINE IS DECISION-AWARE, and it has to be. The first draft of
  // this function said "has COMPUTED a statutory notice period and PREPARED a
  // report" on every branch — which is FALSE on identity_not_verified,
  // employee_not_active and missing_seniority_date, where no notice period was
  // computed at all. That is the same class of defect this whole change exists
  // to retire (a sentence that is true of one branch, applied to all of them),
  // and it was caught by rendering the note rather than by reading the code.
  if (d === 'prepared_for_signoff') {
    lines.push(
      'UC-05 resignation notice — this automation has COMPUTED a statutory notice period and PREPARED a report for ' +
        'sign-off. It has decided nothing about the resignation itself and has filed nothing with Remote.'
    );
  } else if (d === 'escalate') {
    lines.push(
      'UC-05 resignation notice — this automation has ESCALATED. It has decided nothing about the resignation ' +
        'itself and has filed nothing with Remote. What it did and did not manage to compute is below.'
    );
  } else {
    lines.push(
      'UC-05 resignation notice — this automation produced a decision this workflow does not recognise. It has ' +
        'decided nothing about the resignation itself and has filed nothing with Remote.'
    );
  }
  lines.push('');

  // WHO THIS IS ABOUT — withheld on identity_not_verified, the same scoping
  // UC-01's composer applies (E4-F14) and for the same reason: when the run's
  // own verdict is that we could not establish who is asking, printing the
  // subject's name, status and country into a durable ticket comment discloses
  // exactly what the failed check was protecting. On this graph `employment`
  // is already null on that branch, so this is defence in depth rather than
  // the only thing withholding it — which is the direction a disclosure guard
  // should fail.
  const who = r === 'identity_not_verified' ? null : subjectFacts();
  if (r === 'identity_not_verified') {
    lines.push(
      'Regarding this employment — subject details withheld: the filer could not be confirmed as the employee ' +
        'this resignation concerns, so nothing about who it is regarding is disclosed here.'
    );
  } else if (who) {
    lines.push(
      'Regarding ' +
        (who.fullName || 'an employee whose name is not carried on this decision') +
        (who.jobTitle ? ' (' + who.jobTitle + ')' : '') +
        ' — employment ' +
        (employment.id || 'not recorded') +
        ', status: ' +
        (employment.status || 'not recorded') +
        (who.contractType ? ', contract: ' + who.contractType : '') +
        ', country: ' +
        (employment.country_code || 'not recorded — the record carried no usable two-letter country code') +
        '.'
    );
  } else {
    lines.push('Regarding this employment — Remote returned no usable employment record for the id on this ticket.');
  }
  lines.push('');

  lines.push('Decision: ' + (d || 'unknown') + ' (' + (r || 'unknown') + '). Flags: ' + flagList + '.');
  if (decidedBy) {
    lines.push(
      'Decided at gate ' + decidedBy.position + ' of ' + decidedBy.total + ' (' + decidedBy.gate + '): ' + decidedBy.means
    );
  }
  lines.push('');

  // THE FIGURES, AND WHERE THERE ARE NONE, WHY. This block is what replaces
  // "No report was prepared for sign-off" — it says what is on the row rather
  // than asserting an absence that is wrong for two of the eight escalations.
  //
  // IT READS THE OBJECTS, NOT FIGURES_ON_RECORD. That table is EVIDENCE for
  // the prose change and is asserted against real runs by the test; driving
  // the rendering from it would restate a fact the row already holds, which is
  // the second-copy-drifts failure this repository keeps paying for. The first
  // draft did drive it from the table and printed
  // "PTO payout: not computed (from unusable_time_off_records)" on a
  // statutory_discrepancy — the table said a payout was present, the row said
  // otherwise, and the row was right.
  lines.push('FIGURES ON THE RECORD');
  if (noticeRow && noticeRow.noticeEndDate) {
    lines.push(
      'Statutory notice end: ' +
        noticeRow.noticeEndDate +
        '. Notice required: ' +
        (noticeRow.noticeDays == null ? 'not recorded' : noticeRow.noticeDays + ' calendar day(s)') +
        '. Tenure at notice: ' +
        (noticeRow.tenureMonths == null ? 'not recorded' : noticeRow.tenureMonths + ' month(s)') +
        '. Country rule applied: ' +
        (noticeRow.countryCode || 'not recorded') +
        '.'
    );
    if (noticeRow.discrepancy === 'earlier_than_statutory') {
      // THE TWO DATES, NOT THE SIGNED DIFFERENCE. `discrepancyDays` is
      // `proposed - statutory` and is therefore NEGATIVE on this branch — the
      // first draft rendered "-55 day(s) EARLIER", which reads as 55 days LATE
      // to anyone who does not know the sign convention. The dates cannot be
      // misread, and the flags (`discrepancy_days_-55`) still carry the raw
      // figure for anyone grepping.
      lines.push(
        'DISCREPANCY: the resignation proposes ' +
          (noticeRow.proposedEndDate || 'a last working day that is not recorded here') +
          ', which is EARLIER than the statutory notice end above. Both dates are on the record; the ' +
          'discrepancy_days_ flag carries the difference as a signed number of days.'
      );
    }
  } else if (noticeRow) {
    lines.push(
      'No statutory notice end could be produced — the country rule did not reach a bracket for this employment. ' +
        'Nothing here says the notice would have been long or short.'
    );
  } else {
    lines.push(
      'No notice period was computed — the run stopped before the country rule could be applied. Nothing here says ' +
        'the notice would have been long or short.'
    );
  }

  if (payoutRow && payoutRow.source === 'no_time_off_records') {
    // ARITHMETICALLY ZERO, AND NOT A FINDING. The record carries
    // totalInRemoteInteger: 0 for an empty balance list, and this note used to
    // print "PTO payout: 0.00 USD (from no_time_off_records)" — a settlement of
    // nothing, in a currency nobody stated, with the reason hidden in an enum
    // no HR Ops reader decodes. Same defect the sidebar row had (panels.js
    // ptoPayoutValue), same words as the portal.
    lines.push(
      'PTO payout: not known — no time-off balances were supplied with this resignation, and this graph does not ' +
        'read Remote\'s time-off records. This is not a finding that nothing is owed.'
    );
  } else if (payoutRow && payoutRow.computable === true) {
    const total = moneyText(payoutRow.totalInRemoteInteger, payoutRow.currency);
    lines.push('PTO payout: ' + (total || 'no total recorded') + (payoutRow.source ? ' (from ' + payoutRow.source + ')' : '') + '.');
  } else if (payoutRow) {
    // Said in full rather than left blank, because a blank payout is read as
    // "nothing is owed" — policyEngine.js's own pto_computable rung says so.
    lines.push(
      'PTO payout: NOT COMPUTED. The balance we were handed could not be turned into a figure, so no total is on ' +
        'the record. That is "we could not work it out", not "nothing is owed" — the pto_missing_ flags name which ' +
        'field was absent.'
    );
  } else {
    lines.push('PTO payout: not computed — the run stopped before the balance was reconciled.');
  }

  if (extractionRow) {
    // WHICH READER PRODUCED THE DATE, BY NAME. This is the line that replaces
    // "AI prepared": the extraction is the only non-arithmetic input here and
    // it is deterministic on this graph.
    lines.push(
      'Employee\'s proposed last working day, as read from the resignation: ' +
        (extractionRow.proposedEndDate || 'none stated') +
        ' (read by: ' +
        (extractionRow.source || 'not recorded') +
        '; "rule_based_fallback" is deterministic date matching and "structured_input" is a value the form ' +
        'supplied — no language model runs on this workflow).'
    );
  }
  lines.push('');

  lines.push('WHO ACTS, AND WHERE');
  if (d === 'prepared_for_signoff') {
    lines.push(
      'HR Ops signs off this notice-period report in the UC-05 panel of the Remote CX Review sidebar on this ticket. ' +
        'Signing off records the report — it does not end the employment, and no part of this system does.'
    );
  } else if (d === 'escalate') {
    // src/uc05/signoffPolicy.js's own refusal text, quoted rather than
    // paraphrased, so the ticket and the sidebar say the same thing about the
    // same case instead of two different things.
    lines.push(
      'This resignation was escalated, not prepared for sign-off — it has no sign-off path here; the escalation is ' +
        'worked on its own ticket. ' +
        ESCALATION_TEAM +
        ' owns a statutory shortfall or an unconfirmable country rule; HR Ops owns everything else. The routing ' +
        'sentence below names the team this ticket was actually assigned to.'
    );
    if (noticeRow && noticeRow.noticeEndDate) {
      lines.push(
        'Note that the figures above are already computed and durable on the resignation record — Create Resignation ' +
          'Record writes the notice and payout columns on every decision, including this one. This escalation is ' +
          'about what to DO about them, not about arithmetic nobody has done yet.'
      );
    }
  } else {
    lines.push(
      'The automation produced a decision this graph does not recognise, so it is routed to a human rather than ' +
        'dropped. Nobody has been asked to sign anything.'
    );
  }
  lines.push('');

  // THE CAPABILITY STATEMENT THAT REPLACES A RETRACTED CLAIM ABOUT REMOTE.
  // Read this against the header's item 1 before editing a word of it.
  lines.push('WHAT THIS SYSTEM DOES NOT DO');
  lines.push(
    'Nothing on this ticket writes to Remote. Remote does publish a resignation write — ' +
      'PUT /v1/resignations/{offboarding_request_id}/validate, scope resignation:write, shaped almost exactly like ' +
      'this sign-off form. This system holds no such scope and deliberately does not call it: the boundary is a ' +
      'policy choice, not an absence in Remote\'s API, and adopting it would turn a report into an execution. ' +
      'The signed-off report is this system\'s durable artifact.'
  );

  return lines.join('\n');
}

// `employment` and `empRaw` are read from the enclosing scope by
// subjectFacts() rather than passed in — they are the two objects whose
// SEPARATION is the point (one is gate input, one is display only), and
// passing them through one argument bag is how that separation gets forgotten.
const internalNote = composeInternalNote({
  decision,
  reason,
  flags,
  notice,
  payout,
  extraction,
});

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
  internalNote,
} }];
