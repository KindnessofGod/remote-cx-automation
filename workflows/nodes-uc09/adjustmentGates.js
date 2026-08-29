// ---------------------------------------------------------------------------
// adjustmentGates.js — body of the "Adjustment Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-09's deterministic core in n8n, ported from src/uc09/{policyEngine,
// adjustmentParser,workflow}.js, same discipline as UC-06's amendmentGates.js.
// test/n8nUc09Parity.test.js executes THIS FILE and asserts it reaches the
// same decision/reason/flags/approvalSlotsRequired as policyEngine.evaluate()
// for every scenario.
//
// THE INCENTIVE-SCHEMA FIX (docs/BUILD-LOG.md, "UC-09 incentive-schema bug
// found via walkthrough"): src/uc09/workflow.js used to validate the
// incentive payload against remote.getCountrySchema() — UC-06's
// employment_basic_information schema (job_title/weekly_hours), a completely
// different Remote write than this use case's `POST /v1/incentives`.
// Every real incentive payload failed schema_invalid on fields it has no
// business carrying. workflow.js now validates against its own fixed
// INCENTIVE_REQUIRED_FIELDS list instead — ported VERBATIM here. This graph
// therefore has NO "Fetch Country Schema (Remote)" node at all (unlike
// UC-06's graph, which genuinely needs one for its own different write) —
// removing it isn't a simplification for n8n's sake, it's removing a fetch
// that was never the right schema to begin with.
//
// The floor-of-2 invariant ("AI never executes unilaterally" — a risk score
// may only raise the required approval count above 2, never below it) is
// ported VERBATIM as `Math.max(2, ...)`, the same expression as the real
// policyEngine.js. This node never computes anything that reaches 1 or 0
// required approvals except on an escalate path, and even those make no write.
//
// THE FREE-TEXT PATH REFUSES (finding F-10). An n8n Code node has no LLM to
// call, and this is the one use case whose parsed number can reach a real
// payroll write, so there is no rule-based amount extractor here at all —
// see the REFUSED_SOURCE block below for the $12,500 -> $3.00 bug the deleted
// regex actually produced. A free-text request escalates with a durable audit
// row; the trusted path for a figure is structured input.
//
// The narrative-faithfulness judge (judgeNarrative(), workflow.js) is
// PURELY INFORMATIONAL and never gates anything (see narrativeJudge.js's own
// header) — an n8n Code node has no LLM to call, so this node records the
// same `{verdict: "not_evaluated", reason: null}` sentinel judgeNarrative()
// itself returns whenever unconfigured, rather than inventing a verdict.
//
// `adjustmentType` is WHAT KIND of adjustment this is — bonus, commission,
// relocation_topup — which is what a column called `adjustment_type` means to
// anyone reading it. This node used to write `result.decision` there, so every
// n8n-written row said its type was "dual_approval_required": the decision,
// stored twice, in a column named after something else, while the real type sat
// unused in `parsedAdjustment.type`. The header here even justified it as
// parity with workflow.js, which was true when it was written and stopped being
// true when workflow.js fixed itself — a port pinned to a defect that the
// reference implementation had already corrected. Now derived from the parsed
// adjustment, matching src/uc09/workflow.js exactly, including its null (never
// undefined) when the parser could not classify the request.
//
// Runs inside n8n's sandbox: no imports, no network. `$()` is provided by
// n8n (and mocked by the parity test).
// ---------------------------------------------------------------------------

const ticket = $('Normalize Adjustment Request').first().json;

// --- shared/upstreamFailure.js, ported verbatim (a Code node cannot import) --
// "Fetch Employment (Remote)" carries `onError: continueRegularOutput`, so a
// failed fetch reports success and hands THIS node an error object instead of
// the record. In live execution 4238 a 404 was swallowed and the recorded
// reason was `identity_not_verified` / `unverified_requester` — on the one use
// case where money moves, a decision filed under the wrong cause. See
// src/shared/upstreamFailure.js; test/n8nUc09Parity.test.js proves this copy
// agrees with it.
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

const upstreamFailures = [
  describeUpstreamError($('Fetch Employment (Remote)').first().json, 'employment'),
].filter(Boolean);

// --- employment (from "Fetch Employment (Remote)") — id/status/company_id/country_code --
const empRaw =
  $('Fetch Employment (Remote)').first().json?.data?.employment ??
  $('Fetch Employment (Remote)').first().json?.data ??
  {};

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

// NO USABLE RECORD MEANS `null`, NOT A PLACEHOLDER.
//
// This block used to build an employment object unconditionally, backfilling
// `id` from `ticket.employmentId` — the caller's own request. Combined with
// `company_id: empRaw.company_id ?? null` that produced a working identity
// bypass: the Zendesk intake path's normalizer emits `session.companyId: null`
// on purpose (so the company-match gate fails closed), a failed or empty
// employment read leaves `company_id: null` too, and `null === null` passed the
// gate while the backfilled `id` satisfied its `employment.id &&` guard. The
// run then stopped one gate later on `employment_not_active` — an ACCIDENTAL
// fail-closed, where a status gate compensates for an identity signal that was
// never sound. Reproduced in a sandbox before this fix (UC-03 had the same
// defect by a slightly different route).
//
// `null` is exactly what `RemoteClient.getEmployment()` returns on a 404, so
// this is parity with the reference implementation's real behaviour rather
// than an invented shape. Nothing downstream in this graph dereferences
// `$json.employment` (checked node by node: the record, audit and Zendesk
// nodes all read `employmentId`/`payload`), and `evaluate()` below already
// handles a null employment at its status gate.
const employment = empRaw && empRaw.id
  ? {
      id: empRaw.id,
      status: empRaw.status ?? 'unknown',
      company_id: empRaw.company_id ?? null,
      // Candidate ORDER and shape-checking match src/remote/restClient.js's
      // normalizeEmployment() exactly. THIS IS THE MONEY PATH: a "DEU" landing
      // here made `["DE","FR","IT"].includes(country_code)` false, so the
      // third approver — the whole point of the high-tax-complexity rule —
      // had never once engaged against a real Remote record. See pickAlpha2().
      country_code: pickAlpha2([empRaw.country?.alpha_2_code, empRaw.country_code, empRaw.country?.code]),
    }
  : null;

// Defence in depth on top of the construction fix: BOTH sides must carry a
// real company id. Two absent values matching proves nothing, and an identity
// control that reads a null-vs-null match as success is not a control.
const identityVerified = Boolean(
  ticket.session &&
    ticket.session.companyId &&
    employment &&
    employment.company_id &&
    ticket.session.companyId === employment.company_id
);

// --- policyEngine.js: INCENTIVE_REQUIRED_FIELDS, ported verbatim ---
// Remote's own `CreateOneTimeIncentiveParams.required`, in Remote's own order
// [CONFIRMED 2026-08-19]. It used to read
// `['employment_id','type','amount','currency']`, which required a field
// Remote has no property for and omitted two Remote demands — a validator that
// green-lit a payload the API would reject.
const INCENTIVE_REQUIRED_FIELDS = ['type', 'amount', 'amount_tax_type', 'employment_id', 'effective_date'];

// --- policyEngine.js: AMOUNT_TAX_TYPES / INCENTIVE_TYPES, ported verbatim ---
// gross vs net is a MONEY field: the same integer pays a different sum under
// each reading ("Remote will gross this up"). Never defaulted, here or there.
const AMOUNT_TAX_TYPES = ['gross', 'net'];
const INCENTIVE_TYPES = [
  'acting_up_allowance', 'allowance', 'car_allowance', 'health_and_wellness_allowance',
  'internet_allowance', 'meal_allowance', 'on_call_allowance', 'parenthood_allowance',
  'phone_allowance', 'relocation_allowance', 'travel_allowance', 'work_from_home_allowance',
  'bonus', 'holiday_bonus', 'referral_bonus', 'retention_bonus', 'commission', 'other',
  'overtime', 'stipend', 'signing_bonus',
];

// --- adjustmentParser.js: THE REFUSAL, ported verbatim (finding F-10) ------
// There is deliberately NO rule-based amount extractor here any more. The one
// that used to live at this spot took the FIRST number in the text
// (/\$?([\d,]+\.?\d*)/), which on "Q3 2024 relocation top-up of $12,500.00"
// matched the `3` in "Q3" and prepared a $3.00 payment for a $12,500.00
// request — a 4,000x error that every downstream gate waves through, because
// $3.00 is small, low-risk and entirely plausible. An n8n Code node has no
// LLM to call, so the free-text path here can only ever REFUSE: it returns
// `amount: null` tagged with its source, the money guard below turns that
// into an escalation with a durable audit row, and a human supplies the
// figure as structured input. Refusing is a worse demo and a better payroll
// system. Mirrors src/uc09/adjustmentParser.js's refuseToGuess().
const REFUSED_SOURCE = 'refused_no_llm_parse';

function refuseToGuess(requestText) {
  return {
    type: null,
    amount: null,
    currency: null,
    description: (requestText || '').substring(0, 100),
    amountTaxType: null,
    taxAdjustment: false,
    source: REFUSED_SOURCE,
    refusal: 'llm_not_configured',
  };
}

// --- money.js: toRemoteInteger()/fromRemoteInteger(), ported verbatim ---
function toRemoteInteger(humanAmount) {
  return Math.round(humanAmount * 100);
}
function fromRemoteInteger(remoteInteger) {
  return remoteInteger / 100;
}

// NOTE: no scaleFreeTextAmount() here any more. It existed to convert the
// human-scale figure the (now removed) free-text extractor produced. Structured
// input arrives already Remote-scaled — the caller's responsibility, the same
// convention every sibling use case follows — and is NEVER re-scaled here: no
// magnitude-based guessing on the one use case where money actually moves.

// --- policyEngine.js: validateAdjustment(), ported verbatim ---
function validateAdjustment(adjustment) {
  const errors = [];
  if (!adjustment) {
    errors.push('missing_adjustment_object');
    return errors;
  }
  if (!adjustment.type) errors.push('missing_adjustment_type');
  if (!adjustment.amount || typeof adjustment.amount !== 'number' || adjustment.amount <= 0) errors.push('invalid_amount');
  if (adjustment.type && !INCENTIVE_TYPES.includes(adjustment.type)) errors.push('unsupported_incentive_type');
  if (!adjustment.currency) errors.push('missing_currency');
  if (!adjustment.amountTaxType) errors.push('missing_amount_tax_type');
  else if (!AMOUNT_TAX_TYPES.includes(adjustment.amountTaxType)) errors.push('invalid_amount_tax_type');
  if (adjustment.processingDate) {
    const date = new Date(adjustment.processingDate);
    if (isNaN(date.getTime())) errors.push('invalid_processing_date');
  }
  return errors;
}

// --- policyEngine.js: the high-value threshold, ported verbatim ------------
// THE LINE IS DENOMINATED. It used to be a bare `1000000` compared against a
// bare `adjustment.amount`, so one line meant "10,000 of whatever unit
// arrived" — 10,000 JPY (~USD 65) and 10,000 USD summoned the same number of
// signatures. Two integers in different units are not comparable, and a
// comparison that runs anyway does not fail loudly: it returns false and
// waves the request through with two signatures.
//
// ONE ENTRY, BECAUSE ONE POLICY FIGURE EXISTS. A row may only ever be a STATED
// POLICY FIGURE for that currency — never `1000000 / someRate` and never the
// same numeral copied across currencies, which is an exchange rate of 1.0 in
// disguise. Every entry must be <= HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER: a
// higher one would let an amount that used to need three signatures need only
// two, which is the one direction this gate may never move.
const HIGH_AMOUNT_THRESHOLD_CURRENCY = 'USD';
const HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER = 1000000;
const HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY = { USD: 1000000 };
const HIGH_AMOUNT_THRESHOLDS_MAP = new Map(Object.entries(HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY));

function normalizeCurrencyCode(currency) {
  if (typeof currency !== 'string') return null;
  const code = currency.trim().toUpperCase();
  return code ? code : null;
}

// null means CANNOT BE COMPARED, never "no line to clear" — assessRisk() below
// reads a null as an unknown and raises the requirement to three.
function highAmountThresholdFor(currency) {
  const code = normalizeCurrencyCode(currency);
  if (!code) return null;
  const threshold = HIGH_AMOUNT_THRESHOLDS_MAP.get(code);
  return Number.isInteger(threshold) ? threshold : null;
}

// --- policyEngine.js: assessRisk(), ported verbatim ---
function assessRisk(adjustment, employment) {
  const flags = [];
  let minApprovalSlots = 2;

  // An unknown goes UP: a currency with no stated policy figure costs a third
  // signature rather than buying a cheaper approval. Mirrors UC-02's
  // `policy_cap_currency_mismatch`, which refuses to enforce a cap it cannot
  // denominate. The stated currency is a REQUESTER'S LABEL — Remote pays in the
  // employment's currency and ignores ours — and that limit is recorded on the
  // real engine's `riskBasis` rather than guessed around here.
  const statedCurrency = normalizeCurrencyCode(adjustment.currency);
  const highAmountThreshold = highAmountThresholdFor(statedCurrency);

  if (highAmountThreshold === null) {
    flags.push('high_amount_threshold_not_comparable');
    minApprovalSlots = 3;
  } else if (adjustment.amount > highAmountThreshold) {
    flags.push('high_amount_risk');
    minApprovalSlots = 3;
  }

  if (adjustment.taxAdjustment) {
    flags.push('manual_tax_adjustment');
    minApprovalSlots = 3;
  }

  const sensitiveTypes = ['bonus', 'commission', 'relocation_allowance', 'relocation_topup', 'retroactive_pay'];
  if (sensitiveTypes.includes(adjustment.type)) {
    flags.push(`sensitive_type_${adjustment.type}`);
  }

  const highRiskCountries = ['DE', 'FR', 'IT'];
  if (highRiskCountries.includes(employment.country_code)) {
    flags.push('high_tax_compliance_risk');
    if (minApprovalSlots < 3) minApprovalSlots = 3;
  }

  return { minApprovalSlots, flags };
}

// --- schemaValidator.js: validateAgainstSchema(), ported verbatim ---
function validateAgainstSchema(payload, schema) {
  const required = (schema && schema.required) || [];
  const missing = required.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || value === '';
  });
  return { valid: missing.length === 0, missing };
}

// --- policyEngine.js: prepareIncentivePayload(), ported verbatim ---
// The wire shape is Remote's `CreateOneTimeIncentiveParams`, field for field.
// `currency`, `description`, `processing_date` and `tax_calculation_method`
// are gone — the first three are not properties of the resource at all, and
// the fourth stood where the REQUIRED `amount_tax_type` belongs, carrying a
// value ("automatic") that is not a member of any Remote enum.
function prepareIncentivePayload(adjustment, employment) {
  if (!employment || !employment.id) return null;
  if (!Number.isInteger(adjustment.amount)) return null;
  if (!AMOUNT_TAX_TYPES.includes(adjustment.amountTaxType)) return null;
  const payload = {
    employment_id: employment.id,
    type: adjustment.type || 'bonus',
    amount: adjustment.amount,
    amount_tax_type: adjustment.amountTaxType,
    effective_date: adjustment.effectiveDate || new Date().toISOString().split('T')[0],
    note: adjustment.description || `Off-cycle ${adjustment.type}`,
  };
  if (adjustment.periodStart) payload.period_start = adjustment.periodStart;
  if (adjustment.periodEnd) payload.period_end = adjustment.periodEnd;
  return payload;
}

// --- policyEngine.js: evaluate(), ported verbatim ---
function evaluate({ identityVerified, employment, incentiveSchema, adjustment, upstreamFailures = [] }) {
  // Gate 0 — the employment read, ahead of identity. Note the normalizer above
  // defaults empRaw's missing fields ('unknown' status, null company_id), so a
  // swallowed fetch leaves a plausible-looking object that fails identity: the
  // failure has to be caught here, not inferred from that wreckage. Returns
  // `approvalSlotsRequired: 0` and `payload: null` like every other refusal —
  // a failed read can never open an approval slot on the money path.
  const employmentFailure = upstreamVerdict(findUpstreamFailure(upstreamFailures, 'employment'));
  if (employmentFailure) {
    return { ...employmentFailure, approvalSlotsRequired: 0, payload: null };
  }

  if (!identityVerified) {
    return { decision: 'escalate', reason: 'identity_not_verified', flags: ['unverified_requester'], approvalSlotsRequired: 0, payload: null };
  }
  if (!employment || employment.status !== 'active') {
    return { decision: 'escalate', reason: 'employment_not_active', flags: ['inactive_employment'], approvalSlotsRequired: 0, payload: null };
  }

  const validationErrors = validateAdjustment(adjustment);
  if (validationErrors.length > 0) {
    return { decision: 'escalate', reason: 'invalid_adjustment_structure', flags: ['invalid_structure', ...validationErrors], approvalSlotsRequired: 0, payload: null };
  }

  const payload = prepareIncentivePayload(adjustment, employment);
  const schemaCheck = validateAgainstSchema(payload, incentiveSchema);
  if (!schemaCheck.valid) {
    return {
      decision: 'escalate',
      reason: 'schema_invalid',
      flags: ['schema_invalid', ...schemaCheck.missing.map((f) => `missing_${f}`)],
      approvalSlotsRequired: 0,
      payload,
    };
  }

  const riskEvaluation = assessRisk(adjustment, employment);

  // The floor is ALWAYS >= 2 (requester + approver) — never let AI execute
  // alone. Risk may increase this to 3, never decrease below 2.
  const approvalSlotsRequired = Math.max(2, riskEvaluation.minApprovalSlots);

  let decision = 'off_cycle_adjustment_required';
  let reason = 'adjustment_needs_approval';
  if (approvalSlotsRequired >= 3) {
    decision = 'triple_approval_required';
    reason = 'high_risk_adjustment_needs_triple_approval';
  } else if (approvalSlotsRequired === 2) {
    decision = 'dual_approval_required';
    reason = 'standard_adjustment_needs_dual_approval';
  }

  return { decision, reason, flags: [...riskEvaluation.flags], approvalSlotsRequired, payload };
}

// --- workflow.js: assemble ticket -> evaluate() input, ported verbatim ---
let parsedAdjustment;
if (ticket.requestText && ticket.requestText.trim()) {
  parsedAdjustment = refuseToGuess(ticket.requestText);
} else {
  parsedAdjustment = { ...ticket.adjustmentRequest, source: 'structured_input' };
}

let result = evaluate({
  identityVerified,
  employment,
  incentiveSchema: { required: INCENTIVE_REQUIRED_FIELDS },
  adjustment: parsedAdjustment,
  upstreamFailures,
});

// --- workflow.js's money guard, ported verbatim: never carry a figure we do
// not trust past this line. `amount: null` (a parser refusal) and a numeric
// STRING like "500000" (a payload that quoted its numbers) both land here and
// both produce an escalation with a reason a human can read, never a coerced
// value. A refusal is reported separately from a malformed payload — the first
// is a working control, the second is somebody's integration bug. ---
// FIRST FAILURE WINS, AND IT IS NOT ONLY GATE 0 THAT COUNTS.
// This guard used to overwrite the reason for EVERY non-upstream refusal, so a
// request that was already refused for a reason PRECEDING the amount had that
// reason replaced by the amount's. Measured against src/uc09/workflow.js over a
// generated grid (40,960 cases) after the 2026-08-19 merge:
//
//   unverified requester + a quoted amount -> node said `unparseable_amount`
//                                             real said `identity_not_verified`
//   terminated employee  + a quoted amount -> node said `unparseable_amount`
//                                             real said `employment_not_active`
//
// Both record a security- or status-relevant refusal as somebody's integration
// bug. That is not cosmetic: `reason` is what the metrics dashboard ranks its
// exception table by, so the two execution paths would point a team at "fix the
// payload format" for runs that were actually unauthenticated. The upstream
// skip above was the same insight applied to exactly one earlier gate; the real
// function applies it to all of them, via `amountIsFirstFailure`.
//
// Flags are UNIONED for the same reason — the node used to replace them, which
// silently dropped `unverified_requester` / `inactive_employment` from the row.
// Deduplicated because the `invalid_adjustment_structure` path already flags
// `invalid_amount`, and a repeated flag makes the dashboard count one problem
// twice. Ported verbatim from workflow.js so the two cannot drift again.
//
// The explicit `!isUpstreamReason(result.reason)` skip this replaced is now
// redundant AND was costing a flag: `amountIsFirstFailure` is already false for
// an upstream refusal (its decision is `escalate` and its reason is not
// `invalid_adjustment_structure`), so the upstream reason is protected either
// way — but skipping the block wholesale also dropped `amount_not_an_integer`
// from the row, so a 404 that ALSO carried a malformed payload recorded only
// half of what went wrong. The real function has no such skip.
const parseRefusal = typeof parsedAdjustment.refusal === 'string' ? parsedAdjustment.refusal : null;
if (!Number.isInteger(parsedAdjustment.amount)) {
  // The policy engine runs identity, employment status and schema BEFORE its
  // own adjustment-structure check, so anything it refused for a reason other
  // than `invalid_adjustment_structure` refused for a reason that PRECEDES the
  // amount. That reason stands; the amount problem rides along as a flag.
  const amountIsFirstFailure =
    result.decision !== 'escalate' || result.reason === 'invalid_adjustment_structure';
  const amountFlags = parseRefusal
    ? ['amount_not_extracted', 'parser_' + parseRefusal]
    : ['amount_not_an_integer'];
  result = {
    decision: 'escalate',
    reason: amountIsFirstFailure
      ? (parseRefusal ? 'amount_not_extracted' : 'unparseable_amount')
      : result.reason,
    flags: [...new Set([...(result.flags ?? []), ...amountFlags])],
    approvalSlotsRequired: 0,
    payload: null,
  };
}

// workflow.js's adjustmentType, ported verbatim: the PARSED type, or null when
// the parser could not classify the request. Never the decision, and never
// undefined — a column that reads "not classified" is honest, a column that
// reads "dual_approval_required" is a category error a human then reasons from.
const adjustmentType = typeof parsedAdjustment.type === 'string' && parsedAdjustment.type.trim()
  ? parsedAdjustment.type
  : null;

// --- workflow.js: the deterministic drafted summary (no LLM — the same
// numbers the audit row and Zendesk note both read) ---
const summary = Number.isInteger(parsedAdjustment.amount)
  ? `Off-cycle ${parsedAdjustment.type}: $${fromRemoteInteger(parsedAdjustment.amount).toFixed(2)} ${parsedAdjustment.currency}. ${ticket.reasonText || ''}`.trim()
  : `Off-cycle adjustment request received with NO trustworthy amount (${result.reason}). No figure was guessed; a human must supply the amount as structured input. ${ticket.reasonText || ''}`.trim();

// narrativeJudge.js's own unconfigured sentinel — no LLM available in an n8n
// Code node, so this reports the SAME "not evaluated" shape the real
// judgeNarrative() returns when unconfigured, never an invented verdict.
const faithfulness = { verdict: 'not_evaluated', reason: null };

// A Remote-product submission carries an authenticated admin id; a Zendesk
// ticket only ever carries the requester email Zendesk itself authenticated
// (see the Normalize node). Either is an authenticated signal; a body-text
// claim is not, and never reaches here.
const requester = ticket.session
  ? ticket.session.authenticatedAdminId ?? ticket.session.authenticatedEmail ?? 'unauthenticated'
  : 'unauthenticated';
const status = result.decision.includes('approval_required') ? 'pending_approval' : 'escalated';

// riskEngine.js: classifyRisk('UC-09', flags) — UC-09's base tier is 'high',
// and escalating a 'high' base still resolves to 'high' either way (see
// riskEngine.js's own ternary), so this is always 'high' for UC-09
// regardless of flags. Ported as the constant it actually evaluates to,
// not re-implemented as a branch that can only ever take one path.
const riskTier = 'high';

return [
  {
    json: {
      ...ticket,
      employment,
      parsedAdjustment,
      requester,
      decision: result.decision,
      reason: result.reason,
      flags: result.flags,
      approvalSlotsRequired: result.approvalSlotsRequired,
      payload: result.payload,
      adjustmentType,
      summary,
      faithfulness,
      status,
      riskTier,
      // Carried so "Append Audit Log" can record WHICH call failed and WHAT it
      // answered in `audit_log.details`.
      upstreamFailures,
    },
  },
];
