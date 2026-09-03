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

// ---------------------------------------------------------------------------
// THE INTERNAL NOTE — composed HERE, interpolated by the four terminal Zendesk
// nodes, and covered by `npm run verify-deployed` because this file is diffed
// byte for byte and a node parameter is not
// ---------------------------------------------------------------------------
// WHY IT MOVED. A Zendesk "update ticket" node carries no `jsCode`, so
// scripts/lib/deployedNodeMappings.mjs's MAPPINGS — which diffs
// `parameters.jsCode` against a repo file — is structurally blind to all four
// of UC-09's terminal nodes. The sentences they wrote onto real customers'
// tickets were typed once into a node parameter and read back by no check.
// test/n8nUc09Parity.test.js cannot see them either, by its own design: it
// compares DECISIONS, and a node that reaches the right verdict and describes
// it in false words passes it every time. Same shape, same fix, as UC-04's
// workflows/nodes-uc04/{flagAwaitingApprovalSpec,terminalZendeskNodesSpec}.js.
//
// WHAT THE FOUR SENTENCES GOT WRONG — read live off WORKFLOW_UC09_ID on
// 2026-08-31 (versionId === activeVersionId === 5d35be9a-aaf8-4e4f-8185-
// 3f3e31fa3273, 18 nodes, active):
//
// 1. "Escalate Adjustment Ticket" — THE SEVERE ONE, and the only one already
//    on real tickets. It read: "…this request needs MANUAL PAYROLL HANDLING,
//    no approval path was offered." That is a true description of exactly ONE
//    reachable escalate reason, `employment_not_active`, whose own rung says
//    the payment "is a different process, handled by Payroll directly". It is
//    FALSE of the reason that has actually fired in production — executions
//    9279 (ticket 135) and 9942 (ticket 5) both recorded
//    `identity_not_verified`, where evaluate() returns
//    `approvalSlotsRequired: 0` under the comment "no approval path for
//    unverified requests" and the ladder's own words are "Money never starts
//    moving on a request whose origin is unverified." So the ticket invited
//    Payroll Ops to move money BY HAND on a request whose origin the gate had
//    just refused to verify — the exact bypass the gate exists to prevent,
//    printed as an instruction. It is equally false of
//    `invalid_adjustment_structure`, `schema_invalid`, `unparseable_amount`,
//    `amount_not_extracted` and the two upstream reasons: each of those says
//    the request could not be READ or the record could not be FETCHED, and
//    none of them is an invitation to pay it another way.
//
// 2. "Flag Awaiting Triple Approval" — asserted "HIGH RISK" unconditionally.
//    Four things raise the floor to three and only TWO of them are risk
//    findings. `HIGH_AMOUNT_THRESHOLDS_BY_CURRENCY` states one line, in USD, so
//    EVERY non-USD adjustment raises the floor via
//    `high_amount_threshold_not_comparable` — which src/uc09/policyEngine.js
//    calls "unmeasured", not large: "an unmeasured amount costs a third
//    signature rather than buying two". A JPY 500 bonus rendered as HIGH RISK.
//    The fourth trigger, `high_tax_compliance_risk` on ['DE','FR','IT'], is
//    called "an UNSOURCED heuristic with no publishing authority behind it" by
//    that same file. `describeThirdSignature()` below names which trigger
//    fired and whether it is a finding or an absence of one. Structurally the
//    same defect as UC-04's "Risk-matrix level: unknown. Blocked by the risk
//    matrix", one use case over.
//
// 3. BOTH "Flag Awaiting …" nodes stated the signature requirement as
//    "(requester + approver)" — two ROLES. Two roles are exactly what the
//    pre-DRIFT-050 code accepted from ONE human: `adjustmentRow.requester` was
//    compared to nothing, so the filer could sign their own request as
//    `approver` and the floor of two still read satisfied. The rule is now
//    live (src/uc09/multiApprovalPolicy.js:171) and the note has to say so,
//    because a note that says "two roles" teaches the reader the old model.
//
// 4. THREE OF THE FOUR SAID "AI". This graph has NO language model node in it
//    — 18 nodes, read live, zero `openai`/`langchain` types — and `summary`
//    below is a fixed template. Calling deterministic arithmetic "AI drafted"
//    inverts prime directive 1 and invites a specialist to distrust the one
//    part of this decision that cannot have hallucinated.
//
// THE COPY IS PORTED, NOT COMPOSED FRESH, and the source is named per constant.
// An n8n Code node has no module resolution (see this file's header), so the
// established pattern in this repository is copy-with-attribution rather than a
// second wording — a second wording is a second thing to drift, which is what
// produced the four sentences above. Sources:
//   src/uc09/policyEngine.js        GATE_SEQUENCE (the `means` per reason)
//   src/shared/settledDecision.js   gateClause()
//   src/uc09/multiApprovalPolicy.js describeNoApprovalPath(), and the
//                                   DRIFT-050 rule at line 171
//   src/portal/server.js            the "no row in this use case's gate
//                                   sequence" sentence, for the four escalate
//                                   reasons that have no rung
//   src/approvalqueue/approvalRoutes.js  the "UC-09" row's surface + verbs
//   docs/use-cases/UC-09.md §1      the Customer Admin has no surface to sign
//
// IT IS EMITTED FOR EVERY DECISION, not only for the two approval branches, so
// all four terminal Zendesk nodes can adopt `internalNote` without this file
// changing again. PURE, AND IT DECIDES NOTHING: it reads a decision already
// made and cannot change what was decided. Nothing on this graph branches on
// it — `Route by Decision` switches on `decision` and must go on doing so.
//
// IT PRINTS NO FIELD OF THE EMPLOYMENT RECORD. UC-01's composer needs a
// WITHHOLD_SUBJECT_REASONS guard because its note names the subject; this one
// never does, so there is no site here for the same guard. The only figures it
// carries ride in via `summary`, and those are the REQUESTER'S OWN submitted
// claim, not something read back off Remote.
// ---------------------------------------------------------------------------

// --- src/uc09/policyEngine.js's GATE_SEQUENCE, `means` ported VERBATIM ------
// `checks` is omitted deliberately: it states each gate's PASSING condition,
// which on a refusal says the opposite of what happened unless the reader
// inverts it (the argument src/portal/assets/app.js makes when it removed the
// same line from the requester's screen). `position`/`gate`/`means` are what a
// specialist needs. Held against the original by
// test/n8nUc09TerminalZendeskNodes.test.js.
const GATE_SEQUENCE = [
  {
    position: 1,
    reason: 'identity_not_verified',
    gate: 'identity',
    means:
      'We could not confirm the requester is authorised for this employment, so no approval path was opened at all — not even the first signature slot. Money never starts moving on a request whose origin is unverified. This is a failure to VERIFY, not a finding that the requester is an impostor.',
  },
  {
    position: 2,
    reason: 'employment_not_active',
    gate: 'employment_status',
    means:
      'The employment record is missing or not active, so there is no live payroll to make an off-cycle payment against. A payment owed to someone who has left is a different process, handled by Payroll directly.',
  },
  {
    position: 3,
    reason: 'invalid_adjustment_structure',
    gate: 'request_completeness',
    means:
      'The adjustment request is incomplete or malformed — the flags recorded with this case name which part. It has not been refused on its merits; it could not be read well enough to have merits assessed.',
  },
  {
    position: 4,
    reason: 'schema_invalid',
    gate: 'payload_schema',
    means:
      'The payment record that would be sent to Remote is missing a required field, so it could never be written even if every approver signed it. Approvals are deliberately not collected for something that cannot be executed — asking three people to sign an unpayable request wastes their time and hides the real problem.',
  },
  {
    position: 5,
    reason: 'high_risk_adjustment_needs_triple_approval',
    gate: 'approval_sizing',
    means:
      'The adjustment is sound but carries a high-risk factor, so it needs THREE separate people before it can be paid: the requester, an approver, and a payment releaser. This is not a refusal — it is the request being routed to a larger signature set. Nothing has been paid.',
  },
  {
    position: 6,
    reason: 'standard_adjustment_needs_dual_approval',
    gate: 'approval_sizing',
    means:
      'The adjustment is in order and needs the standard two people — a requester and an approver — before it can be paid. This is the normal successful outcome, not an objection. Nothing has been paid yet, and the automation itself can never pay it: two named humans have to.',
  },
  {
    position: 7,
    reason: 'adjustment_needs_approval',
    gate: 'outcome',
    means:
      'A placeholder the gates cannot actually produce: the required-approver count is floored at two, so one of the two rungs above always decides first. Seeing this on a real case means the approval floor has been changed and this ladder is out of date — report it rather than explaining it to the requester.',
  },
];

// TRUNCATED ON PURPOSE at position 5. The full `means` for
// `high_risk_adjustment_needs_triple_approval` in src/uc09/policyEngine.js goes
// on to explain all three third-signature triggers and their two health
// warnings in one paragraph. That paragraph is CORRECT and it is also the
// unconditional-assertion defect in a longer form: it recites every trigger on
// every triple case, so the reader still has to work out which one fired.
// `describeThirdSignature()` below answers that from the FLAGS, which is the
// only place the answer actually is. Nothing is lost — the two health warnings
// are reproduced verbatim there, attached to the trigger each one is about.

function describeDecidingGate(reasonSlug) {
  for (let i = 0; i < GATE_SEQUENCE.length; i++) {
    if (GATE_SEQUENCE[i].reason === reasonSlug) {
      const total = new Set(GATE_SEQUENCE.map((r) => r.position)).size;
      return { position: GATE_SEQUENCE[i].position, reason: GATE_SEQUENCE[i].reason, gate: GATE_SEQUENCE[i].gate, means: GATE_SEQUENCE[i].means, total: total };
    }
  }
  return null;
}

// --- src/shared/settledDecision.js: gateClause(), ported verbatim ----------
function gateClause(describe, reasonSlug) {
  const row = describe ? describe(reasonSlug) : null;
  if (!row || row.position === null || row.position === undefined) return { at: '', means: '' };
  return { at: ' at gate ' + row.position + ' (' + row.gate + ')', means: row.means ? ' ' + row.means : '' };
}

// FOUR REACHABLE ESCALATE REASONS HAVE NO RUNG, and that is a fact about the
// ladder rather than about this note. `unparseable_amount` and
// `amount_not_extracted` are produced by workflow.js's money guard AFTER
// evaluate() has returned, and `upstream_record_not_found` /
// `upstream_unavailable` come from shared/upstreamFailure.js BEFORE it — so
// none of the four appears in policyEngine.js's GATE_SEQUENCE and
// describeDecidingGate() returns null for all four. `amount_not_extracted` is
// UC-09's most-ticketed refusal (src/surfaceverify/registries/index.js: "3
// observed, all 3 ticketed"), so this is the common case, not the exotic one.
//
// The sentence below is PORTED VERBATIM from src/portal/server.js's
// specialistDetail("What happened", …) — the reviewed wording this repository
// already uses for exactly this gap, on exactly this reason. It is deliberately
// an admission rather than a guess: inventing a plain-words meaning for a
// reason with no reviewed rung is how a note starts asserting things nobody
// checked, which is the defect this whole file is fixing.
function noRungSentence(reasonSlug) {
  return (
    'No row in this use case\'s gate sequence describes the reason "' +
    reasonSlug +
    '", so what it means in plain words cannot be stated here. The reason slug is the whole of what was recorded.'
  );
}

// --- src/uc09/multiApprovalPolicy.js: describeNoApprovalPath(), ported ------
// It is the sentence the ZAF sidebar and the approval API already give a
// specialist who tries to act on an escalated adjustment, so the ticket and the
// panel now say the same thing instead of two different things. Its closing
// clause — "the floor of two approvals is not lowered, it is never reached" —
// is the load-bearing one and is verbatim.
//
// ONE DEVIATION FROM THE ORIGINAL, and it is a deduplication rather than a
// rewording. The real function interpolates `gate.means` here because it is the
// only place that reason's meaning appears; in this note the same sentence is
// already printed four lines above as the deciding-gate line, and printing it
// twice in one ticket comment reads as though two different things happened.
// So the means is replaced by a pointer to it — and only when there IS a rung,
// because pointing at a line that says "no row describes this reason" would be
// pointing at nothing.
function describeNoApprovalPath(reasonSlug) {
  const gate = gateClause(describeDecidingGate, reasonSlug);
  return (
    'This adjustment was ESCALATED' +
    gate.at +
    ', so no approval path was ever opened.' +
    (gate.means ? ' The deciding gate above says why.' : '') +
    ' There is no route from here to a payment — the floor of two approvals is not lowered, it is never reached.'
  );
}

// --- WHICH trigger asked for the third signature, and is it a FINDING? ------
// assessRisk() above has exactly four ways to reach `minApprovalSlots = 3`.
// Two are risk findings about this adjustment. The other two are absences —
// something that could not be measured, and something measured against a list
// with no authority behind it — and calling either of them "HIGH RISK" on a
// customer's ticket is an assertion nobody made.
//
// `assessed: false` is NOT a claim that the third signature is unnecessary. The
// floor may only ever go UP (`Math.max(2, …)`), and an unknown going up is the
// design: "an unmeasured amount costs a third signature rather than buying
// two". What changes is what the note CLAIMS, not what the gate REQUIRES.
//
// The two `note` strings on the unassessed rows are quoted VERBATIM from
// src/uc09/policyEngine.js's GATE_SEQUENCE position 5 — this repository's own
// health warnings, moved next to the trigger each one is about instead of
// recited on every case.
const THIRD_SIGNATURE_TRIGGERS = [
  {
    flag: 'high_amount_risk',
    assessed: true,
    headline: 'the adjustment value is over the high-value line stated for its currency',
    note: 'A finding about this adjustment: the amount was compared with a stated policy figure and came out above it.',
  },
  {
    flag: 'manual_tax_adjustment',
    assessed: true,
    headline: 'the request carries a manual tax adjustment',
    note: 'A finding about this request: a hand-entered withholding change is the failure mode this use case exists to gate.',
  },
  {
    flag: 'high_amount_threshold_not_comparable',
    assessed: false,
    headline: 'the amount COULD NOT BE COMPARED with the high-value line at all',
    note:
      'the high-value line is stated only in one currency, so a request in any other currency is not judged small or large — it is unmeasured, and an unmeasured amount costs a third signature rather than buying two. This is NOT a finding that the adjustment is large.',
  },
  {
    flag: 'high_tax_compliance_risk',
    assessed: false,
    headline: 'the employment is in a country on the high-tax-complexity list',
    note:
      'The high-tax-complexity country list is an UNSOURCED heuristic with no publishing authority behind it, so read that dimension as an illustration rather than as a compliance determination.',
  },
];

function describeThirdSignature(flags) {
  const set = new Set(Array.isArray(flags) ? flags : []);
  const fired = THIRD_SIGNATURE_TRIGGERS.filter((t) => set.has(t.flag));
  const findings = fired.filter((t) => t.assessed);
  const absences = fired.filter((t) => !t.assessed);
  return { fired: fired, findings: findings, absences: absences };
}

// --- src/approvalqueue/approvalRoutes.js's "UC-09" row, and UC-09.md §1 -----
// `deny`, not `decline` — approvalRoutes.js flags UC-09 as "the one row that
// spells the refusal differently, and a note offering the wrong word sends a
// specialist hunting for a button that is not there."
const SIGNATURE_SURFACE =
  'the UC-09 panel of the Remote CX Review sidebar on this ticket. The verbs there are approve / deny — deny, never decline, on this one use case.';

// UC-09.md §1's own warning, and it is a live gap rather than a caveat: the
// `requester` slot's control renders only in the ZAF sidebar (a Zendesk AGENT
// surface) and in src/uc09/cli.js. The portal "offers no approve/decline
// anywhere". Saying where the signature IS taken, rather than implying the
// named party can reach it, is the whole point of this line.
const REQUESTER_HAS_NO_SURFACE =
  'NOTE ON THE FIRST SLOT: UC-09 names a Customer Admin as the requester, and the Customer Admin has NO SURFACE ON WHICH TO SIGN — that control renders only in this sidebar, which is a Zendesk agent surface, and in the UC-09 CLI. Do not read a waiting requester slot as something the customer has been asked for and not yet done (UC-09.md §1).';

// src/uc09/multiApprovalPolicy.js:171, DRIFT-050. One sentence, because "two
// roles" and "two people" read the same on a ticket and are not the same
// control — before this rule one human could fill two slots and every check
// still reported satisfied.
const SEGREGATION_OF_DUTIES =
  'SEGREGATION OF DUTIES: these are distinct PEOPLE, not just distinct roles. The person who filed this request may sign the requester slot and NO OTHER, and no one person may fill two slots — refused as requester_cannot_approve_own_adjustment and same_person_cannot_fill_multiple_roles respectively, compared on identity rather than on exact bytes.';

/**
 * The internal note the ticket carries. DETERMINISTIC TEXT, never LLM-authored
 * — this graph has no language model node at all, which is the fourth defect
 * listed in this section's header.
 *
 * IT DOES NOT REPRODUCE THE GATE LADDER OR THE APPROVAL SLOTS' STATE. Both are
 * rendered by the ZAF sidebar off the stored row; porting them into a Code node
 * would be a second copy of the longest reasoning in this use case, kept in
 * step by nothing. The note POINTS at the surface that already has them.
 */
function composeInternalNote(args) {
  const decision = args.decision;
  const reasonSlug = args.reason;
  const flags = Array.isArray(args.flags) ? args.flags : [];
  const slots = Number.isInteger(args.approvalSlotsRequired) ? args.approvalSlotsRequired : null;
  const flagText = flags.length ? flags.join(', ') : 'none';
  const decidedBy = describeDecidingGate(reasonSlug);

  const lines = [];
  lines.push(
    'UC-09 off-cycle payroll adjustment. DECIDED BY DETERMINISTIC CODE — this workflow runs no language model at any step, and the summary below is a fixed template, not drafted prose.'
  );
  lines.push('');
  lines.push(args.summary);
  lines.push('');
  lines.push(
    'Assessment: ' +
      decision +
      ' (' +
      reasonSlug +
      '). Flags: ' +
      flagText +
      '. Signatures required before any payment: ' +
      (slots === null ? 'not recorded' : String(slots)) +
      '.'
  );
  lines.push('');
  lines.push(
    decidedBy
      ? 'Decided at gate ' + decidedBy.position + ' of ' + decidedBy.total + ' (' + decidedBy.gate + '): ' + decidedBy.means
      : noRungSentence(reasonSlug)
  );
  lines.push('');

  if (decision === 'triple_approval_required' || decision === 'dual_approval_required') {
    const roles =
      decision === 'triple_approval_required'
        ? 'a requester, an approver and a payment releaser'
        : 'a requester and an approver';
    lines.push('WHO SIGNS, AND WHERE');
    lines.push(
      (slots === null ? 'Several' : String(slots)) +
        ' separate people must sign before any money moves: ' +
        roles +
        '. The automation cannot pay this and never could — the required count is floored at two, so no risk score can take it below two.'
    );
    lines.push(SEGREGATION_OF_DUTIES);
    lines.push('The signatures are taken in ' + SIGNATURE_SURFACE);
    lines.push(REQUESTER_HAS_NO_SURFACE);

    if (decision === 'triple_approval_required') {
      const third = describeThirdSignature(flags);
      lines.push('');
      lines.push('WHY THREE AND NOT TWO');
      if (third.fired.length === 0) {
        // Unreachable through assessRisk() today — every path to 3 sets one of
        // the four flags. Stated rather than assumed, because a note that
        // asserts a trigger it cannot see is the defect being fixed here.
        lines.push(
          'The third signature was required, and no recorded flag says which factor asked for it. The flags on this case are the whole of what was recorded — do not infer a risk finding from the count alone.'
        );
      } else if (third.findings.length === 0) {
        lines.push(
          'NO RISK FINDING WAS MADE. The third signature is here because something could not be assessed, not because this adjustment was judged risky:'
        );
      } else {
        lines.push('A high-value or manual-tax factor was found on this adjustment:');
      }
      for (let i = 0; i < third.fired.length; i++) {
        const t = third.fired[i];
        lines.push(
          '· ' + t.flag + ' — ' + t.headline + '. ' + (t.assessed ? t.note : 'THIS IS NOT A RISK FINDING: ' + t.note)
        );
      }
    }
  } else if (decision === 'escalate') {
    lines.push('NOBODY IS BEING ASKED TO SIGN');
    lines.push(describeNoApprovalPath(reasonSlug));
    lines.push(
      'The sidebar renders no approve/deny control for an escalated adjustment — the approval policy refuses it with not_awaiting_approval before a control could exist. Work this ticket directly using the facts above; whether there is any other route to the money is what the deciding gate above answers, and it is not a question this note assumes an answer to.'
    );
  } else {
    lines.push('NOBODY IS BEING ASKED TO SIGN');
    lines.push(
      'The automation produced a decision this graph does not recognise (' +
        decision +
        '), so this ticket is routed to a human rather than dropped. No approval path was opened, nothing is waiting for a signature, and no payment can be made from here.'
    );
  }

  return lines.join('\n');
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
//
// NO HARD-CODED CURRENCY SIGN, corrected 2026-08-31 in step with
// src/uc09/workflow.js, whose own comment records why: the template was
// `$${displayAmount.toFixed(2)} ${currency}`, so a JPY bonus rendered as
// "$500.00 JPY" — a dollar sign beside a yen code, on the one use case that
// moves money, in the sentence that goes on the approver's ticket and (since
// composeInternalNote() interpolates this summary) into the Zendesk internal
// note. src/uc09/workflow.js fixed it there and this port did not move with it.
// The currency CODE is the denomination; a glyph that contradicts it is worse
// than no glyph, because a reader who trusts the glyph reads the wrong number.
//
// WHAT IS DELIBERATELY *NOT* FIXED HERE, and why — say it at the site rather
// than in a report nobody reads:
//
//  1. `/100` IS WRONG FOR A ZERO-MINOR-UNIT CURRENCY. Remote's ×100 integer
//     convention is what this repository's money axis is built on
//     (src/shared/money.js), and JPY, KRW, VND and others have no minor unit at
//     all — so a JPY amount of 500 is ¥500 and this line renders "5.00 JPY".
//     Fixing it needs a per-currency minor-exponent table (ISO 4217's), which
//     this repository does not have. It is NOT invented here: prime directive 4
//     forbids inventing a schema, and money is the one thing the substitution
//     ladder forbids fabricating outright — a wrong exponent silently moves the
//     decimal point on a real payment by a factor of 100, in either direction,
//     and nothing downstream would notice. A missing table gets investigated; a
//     guessed one gets paid.
//  2. THE GROSS/NET CLAUSE. src/uc09/workflow.js appends "gross" / "net" /
//     "with no gross/net basis stated — do not sign without it" to this
//     sentence, because the same integer moves a different amount of money
//     under each reading. This port does not, and that divergence predates this
//     change. Left alone rather than half-ported: it belongs with the request-
//     text echo the same function adds, as one parity pass over the whole
//     summary template, not folded into a prose fix.
//
// Neither omission changes any DECISION. `summary` is display/audit text; no
// gate on this graph reads it, and test/n8nUc09Parity.test.js compares
// decision/reason/flags/approvalSlotsRequired, none of which this line touches.
const summary = Number.isInteger(parsedAdjustment.amount)
  ? `Off-cycle ${parsedAdjustment.type}: ${fromRemoteInteger(parsedAdjustment.amount).toFixed(2)} ${parsedAdjustment.currency}. ${ticket.reasonText || ''}`.trim()
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

// DISPLAY/AUDIT ONLY. Nothing on this graph branches on `internalNote`, and
// nothing may: `Route by Decision` switches on `decision` and must go on doing
// so. It is consumed by the four terminal Zendesk nodes via
// `={{ $('Adjustment Gates').item.json.internalNote }}` — the same shape UC-01's
// "Compose Internal Note" and UC-04's "Workation Gates" already feed their own
// note nodes.
//
// IT LIVES HERE RATHER THAN IN THE NODE'S PARAMETERS because an inline
// expression is versioned by nothing: `npm run verify-deployed` diffs this
// file's bytes against the deployed body, and it cannot see a hand-typed string
// in a node parameter at all. That blindness is exactly how the four sentences
// this composer retires survived on real tickets.
//
// EMITTED FOR EVERY DECISION, including the unrecognised fallback, so all four
// terminal nodes can adopt it without this file changing again.
const internalNote = composeInternalNote({
  decision: result.decision,
  reason: result.reason,
  flags: result.flags,
  approvalSlotsRequired: result.approvalSlotsRequired,
  summary,
});

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
      internalNote,
      faithfulness,
      status,
      riskTier,
      // Carried so "Append Audit Log" can record WHICH call failed and WHAT it
      // answered in `audit_log.details`.
      upstreamFailures,
    },
  },
];
