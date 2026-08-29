// ---------------------------------------------------------------------------
// relocationGates.js - body of the "Relocation Gates" n8n Code node
// ---------------------------------------------------------------------------
// UC-07's deterministic core in n8n: request understanding -> feasibility
// assessment -> cost estimate -> guidance retrieval -> dossier compilation ->
// escalate, in ONE node so the decision logic stays in one place, exactly as
// src/uc07/workflow.js does. Ports, verbatim:
//   - relocationParser.parseRelocationRuleBased(), including shared/
//     countryMentions.js's directional-cue route resolution
//   - transitionGate.js: every gate, plus reconcilePtoCashout()
//   - costCalculator.runCostCalculator()           (see the QUOTE_REQUIRED note)
//   - mobilityRetriever.js's keyword path + shared/keywordMatch.js
//   - dossierBuilder.draftNarrativeTemplate() and buildDossier()
//   - shared/money.js and shared/disclaimer.js's "mobility" text
//
// WHAT THIS FILE USED TO BE, AND WHY IT MATTERED. Before 2026-08-19 this node
// produced a dossier of a DIFFERENT SHAPE from buildDossier()'s (flat `mot` /
// `coverage` / `alignment` / `transition` instead of `dateChecks` and
// `transitionSafety`), its own invented five-entry mobility corpus with ids and
// titles no citation in src/ has ever carried, its own disclaimer text, its own
// narrative wording, and - the serious one - a hand-rolled cost estimate:
//
//     { monthlyCost, managementFeePercentage: 12, currency, notes: '~12% of salary' }
//
// with NO `QUOTE_REQUIRED` markers anywhere. Those markers are the honesty
// mechanism of this use case's money: the one-off EOR transfer fee and the
// mobility/visa support fee are NEVER computed here - they come from a Remote
// quote, and when absent they are reported as pending quotes rather than
// omitted or guessed (Build Pack Part 32). A dossier without them presents a
// partial figure as a settled cost, on a HIGH-tier permanent relocation, which
// is precisely the failure the tier exists to prevent. It also read
// `structuredPlan.monthlySalaryRemoteInteger` - a key no plan in this repo has
// ever carried - so its one number was `null` in every real run while looking
// computed.
//
// test/n8nUc07Parity.test.js now executes THIS FILE and asserts the WHOLE
// dossier deep-equals buildDossier()'s output (ref/attempts excepted, being
// clock-derived), not just the verdict and the flags. The old test compared
// only the half that agreed, which is how all of the above survived a green
// suite - the same lesson n8nParity.test.js's header records for UC-01.
//
// THE ONE DELIBERATE DIVERGENCE, kept and justified: the mobility retriever
// runs its KEYWORD path. An n8n Code node has no pgPool and no embedding
// client, and src/uc07/mobilityRetriever.js runs the identical keyword path
// whenever unconfigured - so the parity test compares like with like. Do NOT
// "fix" this by pasting MobilityRetriever in; the dependency-free fallback is
// the point (same note as UC-08's buildDossier.js).
//
// Two things the real workflow does that a Code node cannot, both non-decisive:
// draftNarrative()'s LLM path (the node uses the deterministic template, which
// is what the real function also uses when unconfigured), and judgeNarrative()
// (the node emits the same `{verdict:"not_evaluated", reason:null}` sentinel
// the real judge returns unconfigured - never a fabricated verdict either way).
//
// THIS NODE NEVER PRODUCES ANYTHING BUT "escalate". There is no decision branch
// anywhere in this file - that is the point of a HIGH-tier use case, ported
// from handleRelocationReview()'s own header.
//
// MONEY. Values stay Remote x100 integers throughout (money.js), and the salary
// this node is given is ANNUAL GROSS - the period Remote's own
// `annual_gross_salary` uses. Two independent money fixes are live here and
// neither supersedes the other: reconcilePtoCashout() refuses to invent a
// cashout it cannot derive (F-29), and the cashout it DOES derive is in the
// right period (annual / 12 / 22, not annual / 22). See
// src/uc07/costCalculator.js's and transitionGate.js's headers.
// ---------------------------------------------------------------------------

const ticket = $('Normalize Relocation Request').first().json;

// --- shared/money.js -------------------------------------------------------
function toRemoteInteger(humanAmount) {
  if (typeof humanAmount !== "number" || Number.isNaN(humanAmount)) {
    throw new TypeError(`toRemoteInteger expected a number, got ${humanAmount}`);
  }
  return Math.round(humanAmount * 100);
}

function fromRemoteInteger(remoteInteger) {
  if (!Number.isInteger(remoteInteger)) {
    throw new TypeError(`fromRemoteInteger expected an integer, got ${remoteInteger}`);
  }
  return remoteInteger / 100;
}

function formatMoney(remoteInteger, currency = "USD") {
  const human = fromRemoteInteger(remoteInteger);
  return `${human.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

// --- shared/disclaimer.js: the "mobility" disclaimer, verbatim -------------
const MOBILITY_DISCLAIMER =
  "This is a preliminary feasibility summary, not a decision or legal advice. A mobility specialist will review before any action is taken.";

function withMobilityDisclaimer(message) {
  return `${message}\n\n---\n${MOBILITY_DISCLAIMER}`;
}

// --- relocationParser.js: parseRelocationRuleBased() — the deterministic fallback
const RELOCATION_TYPES = [
  "permanent_relocation", "temporary_workation", "business_travel", "address_change", "other"
];
// ⚠ NO BARE ALPHA-2 KEYS, AND NO SUBSTRING MATCHING. This map used to carry
// `de`/`fr`/`pt`/`ca`/`es`/`nl`/`br` and was matched with String.includes, so
// THIS NODE, in production (Zendesk ticket 18, execution 4500), read
// "permanently relocating from Portugal to Germany" as {DE, FR, PT, CA} — "fr"
// inside "from", "ca" inside "relocating" — and then filled source/destination
// from Object.keys() order, publishing "Source country: DE; Destination
// country: FR" to a real ticket. Port of src/shared/countryMentions.js; keep the
// two in step (test/n8nUc07Parity.test.js executes THIS FILE and compares).
const KNOWN_COUNTRIES = {
  spain: "ES", netherlands: "NL", "the netherlands": "NL",
  germany: "DE", france: "FR", portugal: "PT",
  "united kingdom": "GB", uk: "GB", "united states": "US", usa: "US", brazil: "BR",
  canada: "CA", india: "IN", australia: "AU", "new zealand": "NZ",
  nigeria: "NG", japan: "JP", singapore: "SG",
};

const SOURCE_CUE = /(?:^|[^a-z])(?:from|out of|leaving)\s+(?:the\s+)?$/;
const DESTINATION_CUE = /(?:^|[^a-z])(?:to|into)\s+(?:the\s+)?$/;
const CUE_WINDOW = 24;

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every dictionary country mentioned in the text, at word boundaries, in text
// order, each tagged with the direction word in front of it (if any).
// Deliberately not a cue: "in" — "based in Portugal" and "working in Germany"
// sit in the same position and mean opposite things.
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
    const cue = SOURCE_CUE.test(before) ? 'source' : DESTINATION_CUE.test(before) ? 'destination' : null;
    return { code: h.code, index: h.index, cue };
  });
}

function distinctCountryCodes(mentions) {
  const out = [];
  for (const m of mentions) if (out.indexOf(m.code) === -1) out.push(m.code);
  return out;
}

// Direction comes from the CUE WORDS, never from position in a dictionary.
// Anything the text does not make directional resolves to null on BOTH slots —
// a 🔴 dossier that says "not identified" sends a specialist to look; one that
// says "DE" gives them no reason to.
function resolveSourceAndDestination(text) {
  const mentions = findCountryMentions(text);
  const mentionedCountries = distinctCountryCodes(mentions);
  const cuedSourceHit = mentions.find((m) => m.cue === 'source');
  const cuedDestHit = mentions.find((m) => m.cue === 'destination');
  const cuedSource = cuedSourceHit ? cuedSourceHit.code : null;
  const cuedDestination = cuedDestHit ? cuedDestHit.code : null;

  if (cuedSource && cuedDestination) {
    if (cuedSource === cuedDestination) {
      return { sourceCountry: null, destinationCountry: null, mentionedCountries, reason: 'conflicting_directional_cues' };
    }
    return { sourceCountry: cuedSource, destinationCountry: cuedDestination, mentionedCountries, reason: 'directional_cues' };
  }

  if (cuedSource || cuedDestination) {
    const cued = cuedDestination || cuedSource;
    const others = mentionedCountries.filter((c) => c !== cued);
    if (others.length === 1) {
      return cuedDestination
        ? { sourceCountry: others[0], destinationCountry: cuedDestination, mentionedCountries, reason: 'destination_cued_single_other_country' }
        : { sourceCountry: cuedSource, destinationCountry: others[0], mentionedCountries, reason: 'source_cued_single_other_country' };
    }
    if (others.length === 0) {
      return cuedDestination
        ? { sourceCountry: null, destinationCountry: cuedDestination, mentionedCountries, reason: 'destination_cued_only' }
        : { sourceCountry: cuedSource, destinationCountry: null, mentionedCountries, reason: 'source_cued_only' };
    }
    return cuedDestination
      ? { sourceCountry: null, destinationCountry: cuedDestination, mentionedCountries, reason: 'destination_cued_other_ambiguous' }
      : { sourceCountry: cuedSource, destinationCountry: null, mentionedCountries, reason: 'source_cued_other_ambiguous' };
  }

  return {
    sourceCountry: null,
    destinationCountry: null,
    mentionedCountries,
    reason: mentionedCountries.length ? 'no_directional_cue' : 'no_country_named',
  };
}

function parseRelocationRuleBased(text) {
  const lower = (text || "").toLowerCase();

  const route = resolveSourceAndDestination(text);
  const sourceCountry = route.sourceCountry;
  const destinationCountry = route.destinationCountry;
  const requiresVisa = /\bvisa\b|work permit|right to work|work authorization|immigrat/.test(lower);

  let relocationType = "other";
  if (/\baddress change\b|change of address|moving (to a new )?address/.test(lower)) {
    relocationType = "address_change";
  } else if (/\bconference\b|business trip|business travel|\bonsite visit\b/.test(lower)) {
    relocationType = "business_travel";
  } else if (/\bwork(?:ing)? from [a-z ]{2,40}? (?:for|over) (?:two|three|four|five|\d+|a few) (?:day|week)s?\b|worka?tion|work from [a-z ]{2,20} for \d+ (day|week)/.test(lower)) {
    relocationType = "temporary_workation";
  } else if (/relocat|permanent(ly)? (mov|relocat)|transfer(ring)? (him|her|to|between)|moving (permanently|to)|will (now )?(be|work|live) (in|from)/.test(lower)) {
    relocationType = "permanent_relocation";
  }

  return {
    relocationType,
    sourceCountry: sourceCountry ?? null,
    destinationCountry: destinationCountry ?? null,
    mentionedCountries: route.mentionedCountries,
    countryExtractionReason: route.reason,
    requiresVisa,
    immigrationSupportRequired: requiresVisa  // Promotion from "needs visa" to request-level signal
  };
}

// parseRelocation()'s unconfigured branch, exactly: the rule-based result plus
// the request-level immigration signal and the provenance tag (invariant 8).
// parseRelocationRuleBased() itself does NOT set `source` in src/ either - the
// tag is added by its caller, and it is what the dossier's `parseSource` reads.
const ruleBased = parseRelocationRuleBased(ticket.text);
const parsed = {
  ...ruleBased,
  immigrationSupportRequired: ruleBased.requiresVisa,
  source: "rule_based_fallback",
};

// --- transitionGate.js: date arithmetic helpers (diffDays, diffBusinessDays, etc.)
function diffDays(startDate, endDate) {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function diffBusinessDays(startDate, endDate) {
  let count = 0;
  let cursor = new Date(startDate);
  const end = new Date(endDate);
  while (cursor < end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function isLastDayOfMonth(date) {
  const d = new Date(date);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastDay = new Date(next.getTime() - 86400000);
  return d.getUTCDate() === lastDay.getUTCDate();
}

function isFirstDayOfMonth(date) {
  return new Date(date).getUTCDate() === 1;
}

function addBusinessDays(startDate, businessDays) {
  let cursor = new Date(startDate);
  let remaining = businessDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

// --- transitionGate.js: the individual gates -----------------------------------
const SEVERITY = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

const FLAG = {
  DESTINATION_COUNTRY_UNSUPPORTED: "UC07_DESTINATION_COUNTRY_UNSUPPORTED",
  DESTINATION_ENTITY_INACTIVE: "UC07_DESTINATION_ENTITY_INACTIVE",
  MOT_VIOLATION: "UC07_MOT_VIOLATION",
  SALARY_BELOW_VISA_MINIMUM: "UC07_SALARY_BELOW_VISA_MINIMUM",
  RIGHT_TO_WORK_MISSING: "UC07_RIGHT_TO_WORK_MISSING",
  EMPLOYMENT_GAP: "UC07_EMPLOYMENT_GAP",
  SOURCE_OFFBOARDING_NOT_AUTHORIZED: "UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED",
  DUPLICATE_FEE_RISK: "UC07_DUPLICATE_FEE_RISK",
  IMMIGRATION_REQUIRED: "UC07_IMMIGRATION_REQUIRED",
  PE_RISK_REVIEW_REQUIRED: "UC07_PE_RISK_REVIEW_REQUIRED",
  TAX_RESIDENCY_REVIEW_REQUIRED: "UC07_TAX_RESIDENCY_REVIEW_REQUIRED",
  PTO_TRANSFER_NOT_ALLOWED: "UC07_PTO_TRANSFER_NOT_ALLOWED",
  SENIORITY_REVIEW_REQUIRED: "UC07_SENIORITY_REVIEW_REQUIRED",
  MISSING_TIMELINE: "UC07_MISSING_TIMELINE",
  PTO_CASHOUT_NOT_COMPUTABLE: "UC07_PTO_CASHOUT_NOT_COMPUTABLE",
  COUNTRIES_NOT_DETERMINED: "UC07_COUNTRIES_NOT_DETERMINED",
};

const SEVERITY_BY_FLAG = {
  [FLAG.DESTINATION_COUNTRY_UNSUPPORTED]: SEVERITY.HIGH,
  [FLAG.DESTINATION_ENTITY_INACTIVE]: SEVERITY.HIGH,
  [FLAG.MOT_VIOLATION]: SEVERITY.HIGH,
  [FLAG.SALARY_BELOW_VISA_MINIMUM]: SEVERITY.HIGH,
  [FLAG.RIGHT_TO_WORK_MISSING]: SEVERITY.HIGH,
  [FLAG.EMPLOYMENT_GAP]: SEVERITY.HIGH,
  [FLAG.SOURCE_OFFBOARDING_NOT_AUTHORIZED]: SEVERITY.HIGH,
  [FLAG.DUPLICATE_FEE_RISK]: SEVERITY.MEDIUM,
  [FLAG.IMMIGRATION_REQUIRED]: SEVERITY.MEDIUM,
  [FLAG.PE_RISK_REVIEW_REQUIRED]: SEVERITY.MEDIUM,
  [FLAG.TAX_RESIDENCY_REVIEW_REQUIRED]: SEVERITY.MEDIUM,
  [FLAG.PTO_TRANSFER_NOT_ALLOWED]: SEVERITY.LOW,
  [FLAG.SENIORITY_REVIEW_REQUIRED]: SEVERITY.LOW,
  [FLAG.MISSING_TIMELINE]: SEVERITY.LOW,
  [FLAG.PTO_CASHOUT_NOT_COMPUTABLE]: SEVERITY.MEDIUM,
  [FLAG.COUNTRIES_NOT_DETERMINED]: SEVERITY.MEDIUM,
};

const MESSAGES = {
  [FLAG.DESTINATION_COUNTRY_UNSUPPORTED]: "The destination country is not supported for employment.",
  [FLAG.DESTINATION_ENTITY_INACTIVE]: "The target legal entity in the destination country is not active.",
  [FLAG.MOT_VIOLATION]: "The proposed destination start date does not clear the country's minimum onboarding time.",
  [FLAG.SALARY_BELOW_VISA_MINIMUM]: "The proposed salary does not meet the destination's statutory visa minimum.",
  [FLAG.RIGHT_TO_WORK_MISSING]: "Right-to-work for the destination is not confirmed.",
  [FLAG.EMPLOYMENT_GAP]: "The proposed timeline leaves an unauthorized employment gap.",
  [FLAG.SOURCE_OFFBOARDING_NOT_AUTHORIZED]: "Source offboarding is planned before the destination is confirmed ready.",
  [FLAG.DUPLICATE_FEE_RISK]: "Overlapping or misaligned dates risk a duplicate EOR management fee.",
  [FLAG.IMMIGRATION_REQUIRED]: "Immigration support is required and has not yet been confirmed.",
  [FLAG.PE_RISK_REVIEW_REQUIRED]: "Potential permanent-establishment exposure for the client must be reviewed.",
  [FLAG.TAX_RESIDENCY_REVIEW_REQUIRED]: "Tax-residency nexus between source and destination must be reviewed.",
  [FLAG.PTO_TRANSFER_NOT_ALLOWED]: "PTO cannot be transferred; it will be liquidated in final settlement.",
  [FLAG.SENIORITY_REVIEW_REQUIRED]: "Seniority continuity needs legal confirmation in the destination jurisdiction.",
  [FLAG.MISSING_TIMELINE]: "Essential relocation dates are missing from the request.",
  [FLAG.PTO_CASHOUT_NOT_COMPUTABLE]:
    "The liquidated PTO payout could not be derived from the request — confirm the missing figures before relying on this dossier's cost estimate.",
  [FLAG.COUNTRIES_NOT_DETERMINED]:
    "The source and/or destination country could not be determined from the request — confirm the route with the requester before relying on this dossier.",
};

// Minimum Onboarding Time (MOT) gate
function evaluateMOT({ creationDate, proposedStartDate, minimumLeadTimeBusinessDays }) {
  if (!creationDate || !proposedStartDate || minimumLeadTimeBusinessDays == null) {
    return { valid: true, code: "NOT_EVALUATED", requiredLeadTime: minimumLeadTimeBusinessDays ?? null, requestedLeadTime: null, earliestAllowedDate: null };
  }
  const requestedLeadTime = diffBusinessDays(creationDate, proposedStartDate);
  const earliestAllowedDate = addBusinessDays(creationDate, minimumLeadTimeBusinessDays);
  const valid = requestedLeadTime >= minimumLeadTimeBusinessDays;
  return {
    valid,
    code: valid ? "VALID" : "DESTINATION_START_DATE_TOO_EARLY",
    requiredLeadTime: minimumLeadTimeBusinessDays,
    requestedLeadTime,
    earliestAllowedDate,
  };
}

// Month-end alignment gate
function evaluateMonthEndAlignment({ sourceTerminationDate, destinationStartDate }) {
  if (!sourceTerminationDate || !destinationStartDate) {
    return { aligned: null, duplicateManagementFeeRisk: true, reason: "missing dates" };
  }
  const aligned = isLastDayOfMonth(sourceTerminationDate) && isFirstDayOfMonth(destinationStartDate);
  return {
    aligned,
    duplicateManagementFeeRisk: !aligned,
    reason: aligned
      ? "termination on the last day of a month, start on the first of the next — no overlap in management-fee months"
      : "termination/start not aligned to month boundaries — overlapping calendar months can incur a duplicate management fee",
  };
}

// Employment gap/overlap gate
function evaluateCoverageGap({ sourceLastWorkingDay, sourceTerminationDate, destinationStartDate }) {
  if (!sourceLastWorkingDay || !sourceTerminationDate || !destinationStartDate) {
    return { gapDays: null, overlapDays: null, status: "NOT_EVALUATED" };
  }
  const gapDays = diffDays(sourceLastWorkingDay, destinationStartDate);
  const overlapDays = diffDays(destinationStartDate, sourceTerminationDate) + 1;
  if (gapDays > 1) {
    return { gapDays: gapDays - 1, overlapDays: 0, status: "GAP" };
  }
  if (overlapDays > 1) {
    return { gapDays: 0, overlapDays: overlapDays - 1, status: "OVERLAP" };
  }
  return { gapDays: 0, overlapDays: 0, status: "CLEAN" };
}

// Transition safety gate (headline rule: destination ready → source offboard)
function evaluateTransitionSafety({
  destinationContractActive = false,
  rightToWorkConfirmed = false,
  destinationStartDateConfirmed = false,
  sourceExitPlanValidated = false,
} = {}) {
  const authorized =
    destinationContractActive && rightToWorkConfirmed && destinationStartDateConfirmed && sourceExitPlanValidated;
  const missing = [];
  if (!destinationContractActive) missing.push("destination_contract_active");
  if (!rightToWorkConfirmed) missing.push("right_to_work_confirmed");
  if (!destinationStartDateConfirmed) missing.push("destination_start_date_confirmed");
  if (!sourceExitPlanValidated) missing.push("source_exit_plan_validated");
  return {
    sourceOffboardingAuthorized: authorized,
    missing,
    reason: authorized
      ? "destination ready and source exit plan validated — source offboarding may proceed"
      : `source offboarding NOT authorized until: ${missing.join(", ")}`,
  };
}

// Salary vs. statutory visa minimum gate
// Salary vs. statutory visa minimum. BOTH values are ANNUAL GROSS x100 - the
// period Remote's `annual_gross_salary` uses and every statutory visa threshold
// is published in. A comparison is only meaningful if both sides share a period.
function evaluateSalaryVisaMinimum({ annualGrossSalaryRemoteInteger, minimumVisaSalaryRemoteInteger }) {
  if (minimumVisaSalaryRemoteInteger == null) {
    return { meetsMinimum: true, shortfallRemoteInteger: 0, applicable: false };
  }
  if (!Number.isInteger(annualGrossSalaryRemoteInteger)) {
    return { meetsMinimum: null, shortfallRemoteInteger: null, applicable: true, evaluated: false };
  }
  const shortfall = annualGrossSalaryRemoteInteger - minimumVisaSalaryRemoteInteger;
  return {
    meetsMinimum: shortfall >= 0,
    shortfallRemoteInteger: Math.max(0, -shortfall),
    applicable: true,
    evaluated: true,
  };
}

// PTO portability gate
function evaluatePTO({ sourcePtoDays, transferAllowed }) {
  if (transferAllowed) {
    return {
      decision: "TRANSFER",
      destinationOpeningBalance: sourcePtoDays,
      liquidatedDays: 0,
      reason: "Local law permits cross-entity PTO balance transfer.",
    };
  }
  return {
    decision: "LIQUIDATE",
    destinationOpeningBalance: 0,
    liquidatedDays: sourcePtoDays,
    reason: "Statutory PTO transfer not supported between these jurisdictions — accrued balance is paid out in final settlement.",
  };
}

// Seniority continuity gate
function evaluateSeniority({ originalHireDate, destinationStartDate, preservable }) {
  if (preservable === true) {
    // "PRESERVED" without a date is half an answer and must say so - the date
    // is what notice, severance and vesting are counted from. Port of
    // src/uc07/transitionGate.js; no new FLAG either side, because the flag set
    // is compared field-for-field and a parity break is worse than prose.
    return originalHireDate
      ? { status: "PRESERVED", seniorityDate: originalHireDate, reason: "Seniority preserved from original hire date." }
      : {
          status: "PRESERVED",
          seniorityDate: null,
          reason:
            "Seniority is preserved, but the original hire date was not supplied \u2014 the date it is preserved FROM still has to be established before this figure can be used.",
        };
  }
  if (preservable === false) {
    return { status: "RESET", seniorityDate: destinationStartDate, reason: "Seniority resets at destination start." };
  }
  return {
    status: "REQUIRES_LEGAL_REVIEW",
    seniorityDate: null,
    reason: "Seniority continuity must be confirmed by legal review in the destination jurisdiction.",
  };
}

// Uncertainty score computation
function computeUncertaintyScore(flags) {
  const weight = { HIGH: 0.5, MEDIUM: 0.3, LOW: 0.2 };
  return Math.min(1, (flags ?? []).reduce((sum, f) => sum + (weight[f.severity] ?? 0.2), 0));
}

// The composite feasibility evaluation (all gates combined)
function evaluateRelocationFeasibility({
  destinationSupported = false,
  destinationEntityActive = true,
  relocationType = "permanent_relocation",
  annualGrossSalaryRemoteInteger,
  minimumVisaSalaryRemoteInteger = null,
  creationDate = null,
  proposedStartDate = null,
  destinationStartDate = null,
  sourceTerminationDate = null,
  sourceLastWorkingDay = null,
  minimumOnboardingLeadTimeBusinessDays = null,
  immigrationSupportRequired = false,
  immigrationConfirmed = false,
  rightToWorkConfirmed = false,
  destinationStartDateConfirmed = false,
  sourceExitPlanValidated = false,
  employerPresenceInDestination = null,
  taxTreatyNexusConfirmed = false,
  ptoTransferAllowed = false,
  // null, NOT 0 — see src/uc07/transitionGate.js. "Nobody told us the balance"
  // and "the balance is zero" are different facts.
  sourcePtoDays = null,
  seniorityPreservable = null,
  sourceCountry = null,
  destinationCountry = null,
  // Threaded through to evaluateSeniority() so a PRESERVED verdict reports the
  // real date it preserves. src/uc07/transitionGate.js does the same; this copy
  // hardcoded null, which the whole-dossier parity compare now catches.
  originalHireDate = null,
}) {
  const flags = [];
  const requiredActions = [];

  const push = (code) => {
    flags.push({ code, severity: SEVERITY_BY_FLAG[code], message: MESSAGES[code] });
  };

  // Availability gates (spec §7) — inherent, not fixable by date changes.
  if (!destinationSupported) push(FLAG.DESTINATION_COUNTRY_UNSUPPORTED);
  if (!destinationEntityActive) push(FLAG.DESTINATION_ENTITY_INACTIVE);

  // Salary vs. statutory visa minimum (§7, §12 test plan item 3).
  const salaryCheck = evaluateSalaryVisaMinimum({ annualGrossSalaryRemoteInteger, minimumVisaSalaryRemoteInteger });
  if (salaryCheck.applicable && salaryCheck.meetsMinimum === false) push(FLAG.SALARY_BELOW_VISA_MINIMUM);

  // Minimum onboarding time (§7, §12 test plan item "MOT").
  const mot = evaluateMOT({ creationDate, proposedStartDate, minimumLeadTimeBusinessDays: minimumOnboardingLeadTimeBusinessDays });
  if (mot.code === "DESTINATION_START_DATE_TOO_EARLY") push(FLAG.MOT_VIOLATION);

  // Timeline: gap / overlap / month-end alignment. Missing dates are a review
  // gap, not a silent pass — a dossier with no dates would be worthless.
  const coverage = evaluateCoverageGap({ sourceLastWorkingDay, sourceTerminationDate, destinationStartDate });
  const alignment = evaluateMonthEndAlignment({ sourceTerminationDate, destinationStartDate });
  const hasTimeline = Boolean(destinationStartDate && sourceTerminationDate && sourceLastWorkingDay);
  if (!hasTimeline) {
    push(FLAG.MISSING_TIMELINE);
  } else {
    if (coverage.status === "GAP") push(FLAG.EMPLOYMENT_GAP);
    if (coverage.status === "OVERLAP" || alignment.duplicateManagementFeeRisk) push(FLAG.DUPLICATE_FEE_RISK);
  }

  // Route: same family as the missing timeline above — something the REQUEST
  // failed to establish, surfaced as a flag instead of two quiet nulls.
  if (!sourceCountry || !destinationCountry) push(FLAG.COUNTRIES_NOT_DETERMINED);

  // Transition safety — the headline rule (Build Pack Part 9).
  const transition = evaluateTransitionSafety({
    destinationContractActive: Boolean(destinationStartDate && destinationStartDateConfirmed),
    rightToWorkConfirmed,
    destinationStartDateConfirmed,
    sourceExitPlanValidated,
  });
  if (!transition.sourceOffboardingAuthorized) push(FLAG.SOURCE_OFFBOARDING_NOT_AUTHORIZED);

  // Compliance-review flags (spec §9: PE liability, transfer laws).
  if (immigrationSupportRequired && !immigrationConfirmed) {
    push(FLAG.IMMIGRATION_REQUIRED);
    requiredActions.push("IMMIGRATION_ASSESSMENT");
  }
  if (rightToWorkConfirmed === false && !immigrationSupportRequired) push(FLAG.RIGHT_TO_WORK_MISSING);
  if (employerPresenceInDestination !== true) {
    push(FLAG.PE_RISK_REVIEW_REQUIRED);
    requiredActions.push("PE_REVIEW");
  }
  if (!taxTreatyNexusConfirmed) {
    push(FLAG.TAX_RESIDENCY_REVIEW_REQUIRED);
    requiredActions.push("TAX_REVIEW");
  }

  // PTO + seniority — always evaluated, surfaced as dossier content.
  const pto = evaluatePTO({ sourcePtoDays, transferAllowed: ptoTransferAllowed });
  if (pto.decision === "LIQUIDATE") push(FLAG.PTO_TRANSFER_NOT_ALLOWED);

  // F-29. Port of src/uc07/transitionGate.js's reconcilePtoCashout() gate,
  // including WHY it sits here and not beside the salary/visa gate: a
  // derivation gap must not be reported as a statutory salary finding.
  const ptoCashout = reconcilePtoCashout({
    annualGrossSalaryRemoteInteger,
    liquidatedDays: pto.liquidatedDays,
  });
  if (!ptoCashout.computable) push(FLAG.PTO_CASHOUT_NOT_COMPUTABLE);
  const seniority = evaluateSeniority({ originalHireDate, destinationStartDate, preservable: seniorityPreservable });
  if (seniority.status === "REQUIRES_LEGAL_REVIEW") push(FLAG.SENIORITY_REVIEW_REQUIRED);

  const uncertainty = computeUncertaintyScore(flags);
  const verdict = flags.some((f) => f.severity === SEVERITY.HIGH) ? "BLOCK" : flags.length > 0 ? "REVIEW" : "PROCEED";
  const feasible = verdict === "PROCEED";

  return {
    verdict, feasible, flags, requiredActions, mot, coverage, alignment, transition,
    pto: { ...pto, cashout: ptoCashout },
    seniority, uncertainty,
  };
}

// PTO cashout (Remote ×100 integers). Port of reconcilePtoCashout() in
// src/uc07/transitionGate.js — classify BEFORE any arithmetic, refuse what
// cannot be derived, never coerce an absence into a zero. See that function's
// header for the full reasoning (F-29).
//
// This copy had drifted from the real one in two ways at once, and nothing
// caught it because the value it produced was computed and then discarded:
//   - it returned a HUMAN amount, not a ×100 integer — a silent 100× shortfall;
//   - Math.round(NaN) is NaN, so where the real copy threw, this one carried
//     NaN into the dossier and JSON-serialised it as null.
// One derivation site now, inside the gate, so the two cannot drift again.
// The two divisors that take an ANNUAL gross salary down to a daily rate.
// Both are stated repo conventions, not Remote API facts.
const MONTHS_PER_YEAR = 12;
const WORKING_DAYS_PER_MONTH = 22;

function reconcilePtoCashout({ annualGrossSalaryRemoteInteger, liquidatedDays }) {
  const unusable = [];

  const daysKnown = typeof liquidatedDays === "number" && Number.isFinite(liquidatedDays) && liquidatedDays >= 0;
  if (!daysKnown) {
    unusable.push({
      field: "liquidatedDays",
      reason: liquidatedDays == null ? "missing" : "not_a_non_negative_number",
      value: liquidatedDays ?? null,
    });
  }

  // A real zero is a real answer; nothing accrued means nothing owed.
  if (daysKnown && liquidatedDays === 0) {
    return { computable: true, totalRemoteInteger: 0, unusable: [] };
  }

  // A quoted "6500000" divides by 100 perfectly well in JavaScript. That is
  // exactly how a 100× scaling error gets in, so it is refused.
  // The field is named by its CURRENT name for the same reason the refusal
  // exists at all: an escalation naming `monthlySalaryRemoteInteger` would send
  // a specialist looking for a field that no longer exists anywhere.
  if (!Number.isInteger(annualGrossSalaryRemoteInteger)) {
    unusable.push({
      field: "annualGrossSalaryRemoteInteger",
      reason: annualGrossSalaryRemoteInteger == null ? "missing" : "not_an_integer",
      value: annualGrossSalaryRemoteInteger ?? null,
    });
  }

  if (unusable.length > 0) return { computable: false, totalRemoteInteger: null, unusable };

  // annual -> monthly -> daily, with the period explicit at every step. The
  // old copy divided by 22 alone, reading an annual salary as a month's pay.
  const monthlyHuman = fromRemoteInteger(annualGrossSalaryRemoteInteger) / MONTHS_PER_YEAR;
  const dailyHuman = monthlyHuman / WORKING_DAYS_PER_MONTH;
  return { computable: true, totalRemoteInteger: toRemoteInteger(dailyHuman * liquidatedDays), unusable: [] };
}

// --- mobilityRetriever.js: the keyword path ONLY (n8n has no pgPool/embed) --
// The embedding-similarity path needs a pgPool and an embedding client, which a
// Code node has not got; the real function runs this identical keyword path
// whenever unconfigured, so the parity comparison is like-with-like.
//
// Corpus copied VERBATIM from src/uc07/mobilityRetriever.js - ids, titles,
// summaries and keywords. It used to be a different five-entry corpus invented
// here, whose citation ids ("transition-safety", "pe-risk", ...) exist nowhere
// else in this system. A citation id a specialist cannot look up is worse than
// no citation at all.
const MOBILITY_CORPUS = [
  {
    id: "mobility-transition-safety",
    title: "Country transfer \u2014 destination ready, THEN source exit",
    summary:
      "Creating the destination employment record does not make it safe to terminate the source employment. Source offboarding is authorized only once the destination contract is active, right-to-work is confirmed, the destination start date is confirmed, and the source exit plan is validated.",
    keywords: ["offboard", "terminate", "termination", "source exit", "transition", "safe to"],
  },
  {
    id: "mobility-month-end-alignment",
    title: "Month-end alignment and duplicate management fees",
    summary:
      "To avoid paying two monthly EOR management fees in a single calendar month, the source termination date should be the last calendar day of a month and the destination start date the first day of the following month. Overlapping active employment records in the same month trigger a duplicate fee.",
    keywords: ["month", "month-end", "month end", "duplicate", "management fee", "overlap", "aligned", "alignment"],
  },
  {
    id: "mobility-immigration-guidance",
    title: "Immigration status vs. employment status are separate concepts",
    summary:
      "Visa approval is not employment activation, and destination employment creation is not authorization to work. Immigration status, right-to-work status, and employment status must each be verified independently before the employee works in the destination.",
    keywords: ["visa", "immigrat", "right to work", "work authorization", "work permit", "work authorization"],
  },
  {
    id: "mobility-pto-portability",
    title: "PTO portability between source and destination contracts",
    summary:
      "Accrued PTO balances transfer between contracts only where source and destination local law explicitly permits cross-entity vacation-balance transfer. In all other jurisdictions the accrued balance is liquidated and paid out in the source employment's final settlement.",
    keywords: ["pto", "vacation", "holiday", "leave", "cashout", "liquidat", "portab", "transfer of pto"],
  },
  {
    id: "mobility-pe-risk",
    title: "Working in a country can create client permanent-establishment exposure",
    summary:
      "An employee habitually working in a country where the client has no established presence can create corporate permanent-establishment (PE) exposure for the client. Where such exposure is possible, flag PE_REVIEW_REQUIRED rather than concluding whether a PE exists \u2014 that is a professional tax determination.",
    keywords: ["permanent establishment", "pe risk", "pe exposure", "corporate presence", "nexus", "tax"],
  },
  {
    id: "mobility-minimum-onboarding-time",
    title: "Minimum Onboarding Time (MOT) \u2014 destination country lead time",
    summary:
      "Every destination country enforces a minimum onboarding time (MOT): the required lead time, usually in business days, between the destination employment profile being created and the employee's official start date. The start date must clear the country's MOT or the employment request is rejected.",
    keywords: ["mot", "minimum onboarding", "lead time", "start date", "onboarding", "too early"],
  },
];

function escapeKeyword(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary keyword matching, not substring. `includes('mot')` fired on the
// word "reMOTe" - the platform's own name - and `includes('a1')` on any "A123"
// identifier, and then `matchedOn` told the reviewer that was the reason for
// the citation. Trailing LETTERS stay legal because several corpus keywords are
// deliberate stems ("immigrat", "liquidat", "portab"); a trailing digit does
// not. Port of src/shared/keywordMatch.js, including its empty-key guard.
function matchKeywords(lower, keywords) {
  return (keywords || []).filter((kw) => {
    const key = String(kw).toLowerCase().trim();
    if (!key) return false;
    return new RegExp('(?<![a-z0-9])' + escapeKeyword(key) + '(?![0-9])').test(lower);
  });
}

function retrieveMobilityGuidance(text) {
  const lower = (text || '').toLowerCase();
  const matches = [];
  for (const entry of MOBILITY_CORPUS) {
    const matchedOn = matchKeywords(lower, entry.keywords || []);
    if (matchedOn.length > 0) {
      matches.push({ id: entry.id, title: entry.title, summary: entry.summary, matchedOn });
    }
  }
  return matches;
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
// Codes and slugs are the GATES' vocabulary; a Mobility Legal specialist reads
// this string. If you change a wording here, change src/uc07/dossierBuilder.js
// in the same edit - test/n8nUc07Parity.test.js deep-compares the whole dossier
// including this narrative, word for word, and will catch you.
const REQUEST_TYPE_WORDS = {
  permanent_relocation: 'a permanent relocation',
  temporary_workation: 'a temporary workation',
  business_travel: 'business travel',
  address_change: 'a change of address',
  other: 'a request this system could not place in any of its relocation categories',
};

const VERDICT_WORDS = {
  PROCEED: 'The deterministic gates found nothing wrong with the plan as proposed. That is NOT an approval — this use case has no execution path, and a human decides.',
  REVIEW: 'The deterministic gates found no blocking condition, but items below need settling before this can be signed off.',
  BLOCK: 'The deterministic gates found at least one blocking condition: the plan cannot proceed as proposed.',
};

// --- dossierBuilder.js: draftNarrativeTemplate() - the deterministic fallback
function draftNarrativeTemplate({ relocationType, sourceCountry, destinationCountry, verdict, flags, citations }) {
  const from = sourceCountry ? countryLabel(sourceCountry) : null;
  const to = destinationCountry ? countryLabel(destinationCountry) : null;
  // Both limits survive: a reader must be able to see WHICH half of the route is
  // missing, so the four cases are written out rather than hedged into one.
  const routeSentence =
    from && to
      ? `The move is from ${from} to ${to}.`
      : from
        ? `The move is from ${from}; the destination country was not identified in the request.`
        : to
          ? `The move is to ${to}; the country the employee is moving from was not identified in the request.`
          : 'Neither the country the employee is moving from nor the destination country was identified in the request.';

  const parts = [
    `This request reads as ${Object.prototype.hasOwnProperty.call(REQUEST_TYPE_WORDS, relocationType) ? REQUEST_TYPE_WORDS[relocationType] : `an unrecognised request type (${relocationType})`}.`,
    routeSentence,
    Object.prototype.hasOwnProperty.call(VERDICT_WORDS, verdict)
      ? VERDICT_WORDS[verdict]
      : `The deterministic gates returned a verdict this summary has no wording for (${verdict}).`,
  ];
  if (flags.length) {
    // Meanings, not codes. Each flag already carries the sentence
    // transitionGate.js wrote for it; the codes are NOT lost - dossier.flags
    // still carries every one of them.
    parts.push(
      `The deterministic gates raised ${flags.length} point(s) for review. ${flags.map((f) => f.message ?? f.code).join(" ")}`
    );
  } else {
    parts.push("No flags raised by the deterministic gates.");
  }
  if (citations.length) {
    parts.push(`Cross-referenced guidance: ${citations.map((c) => c.title).join("; ")}.`);
  } else {
    parts.push("No matching global-mobility guidance was found in the local reference corpus.");
  }
  parts.push("This is research context for a Mobility Legal specialist's own review, not a relocation decision or a legal determination.");
  return parts.join(" ");
}

// --- costCalculator.js: runCostCalculator(), including the QUOTE_REQUIRED path
// The transfer fee and the mobility/visa fee are NEVER computed - they come
// from a Remote quote, and when absent they are reported QUOTE_REQUIRED and
// listed in `pendingQuotes` rather than dropped or invented. That is what makes
// a partial estimate honestly partial instead of silently understated.
//
// The salary is ANNUAL GROSS (Remote's `annual_gross_salary`, in cents); every
// monthly figure is derived here by dividing, never passed in.
const CALC = { RUNNING: "processing", READY: "ready" };

function runCostCalculator({
  annualGrossSalaryRemoteInteger,
  currency,
  months,
  managementFeeBasisPoints,
  transferFeeRemoteInteger = null,
  mobilityFeeRemoteInteger = null,
  ptoCashoutRemoteInteger = 0,
  maxPollAttempts = 10,
}) {
  if (annualGrossSalaryRemoteInteger != null && !Number.isInteger(annualGrossSalaryRemoteInteger)) {
    throw new TypeError(`runCostCalculator expects an ×100 annual gross salary integer, got ${annualGrossSalaryRemoteInteger}`);
  }
  if (managementFeeBasisPoints == null) {
    throw new TypeError("managementFeeBasisPoints is required (Remote's fee schedule is the source of truth for the rate)");
  }

  const ref = `cc_${Date.now().toString(36)}`;
  let status = CALC.RUNNING;
  let attempts = 0;
  do {
    attempts += 1;
    status = attempts < 2 ? CALC.RUNNING : CALC.READY; // one processing tick, then ready
  } while (status !== CALC.READY && attempts < maxPollAttempts);
  if (status !== CALC.READY) throw new Error(`cost calculator did not become ready after ${maxPollAttempts} polls`);

  const knownComponents = [];
  const quotedComponents = [];
  if (Number.isInteger(annualGrossSalaryRemoteInteger)) {
    const annualFeeRemoteInteger = toRemoteInteger(
      (fromRemoteInteger(annualGrossSalaryRemoteInteger) * managementFeeBasisPoints) / 10000
    );
    const monthlyFeeRemoteInteger = Math.round(annualFeeRemoteInteger / 12);
    const monthlyGrossSalaryRemoteInteger = Math.round(annualGrossSalaryRemoteInteger / 12);
    knownComponents.push({ key: "monthlyManagementFee", label: "Monthly EOR management fee", remoteInteger: monthlyFeeRemoteInteger, currency, status: "CALCULATED" });
    const lifetimeFee = toRemoteInteger(fromRemoteInteger(monthlyFeeRemoteInteger) * Math.max(1, months));
    // `null > 0` is false, so a cashout the gate could not derive adds no line
    // at any value - it is absent, not a fabricated 0.00 (F-29).
    if (ptoCashoutRemoteInteger > 0) {
      knownComponents.push({ key: "ptoCashout", label: "Liquidated PTO payout", remoteInteger: ptoCashoutRemoteInteger, currency, status: "CALCULATED" });
    }
    if (transferFeeRemoteInteger != null) {
      knownComponents.push({ key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: transferFeeRemoteInteger, currency, status: "CALCULATED" });
    } else {
      quotedComponents.push({ key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: 0, currency, status: "QUOTE_REQUIRED" });
    }
    if (mobilityFeeRemoteInteger != null) {
      knownComponents.push({ key: "mobilityFee", label: "Mobility / visa support", remoteInteger: mobilityFeeRemoteInteger, currency, status: "CALCULATED" });
    } else {
      quotedComponents.push({ key: "mobilityFee", label: "Mobility / visa support", remoteInteger: 0, currency, status: "QUOTE_REQUIRED" });
    }

    const knownTotal = knownComponents.reduce((sum, c) => sum + c.remoteInteger, 0);

    // THE TERM TOTAL. `knownTotalRemoteInteger` sums the components as listed,
    // and the management fee is listed at its MONTHLY value - so the "known
    // total" was one month of a twelve-month engagement while being rendered as
    // the total over the term. Recurring fees across the whole term plus every
    // one-off we actually have a figure for, stated explicitly.
    const oneOffKnownTotal = knownComponents
      .filter((c) => c.key !== "monthlyManagementFee")
      .reduce((sum, c) => sum + c.remoteInteger, 0);
    const knownTermTotal = lifetimeFee + oneOffKnownTotal;

    return {
      status: "CALCULATED",
      ref,
      attempts,
      estimate: {
        status: "CALCULATED",
        ref,
        currency,
        months,
        annualGrossSalaryRemoteInteger,
        monthlyGrossSalaryRemoteInteger,
        annualFeeRemoteInteger,
        monthlyFeeRemoteInteger,
        lifetimeMonthlyFeesRemoteInteger: lifetimeFee,
        components: [...knownComponents, ...quotedComponents],
        knownTotalRemoteInteger: knownTotal,
        knownTotalDisplay: formatMoney(knownTotal, currency),
        // Still "known": the QUOTE_REQUIRED components are excluded and
        // `pendingQuotes` names them, so it is never the whole cost.
        knownTermTotalRemoteInteger: knownTermTotal,
        knownTermTotalDisplay: formatMoney(knownTermTotal, currency),
        pendingQuotes: quotedComponents.map((c) => c.key),
      },
    };
  }

  return {
    status: "INCOMPLETE",
    ref,
    attempts,
    estimate: {
      status: "INCOMPLETE",
      ref,
      reason: "salary not provided — an estimate requires the destination annual gross salary",
      currency: currency ?? "USD",
      months: months ?? 12,
      annualGrossSalaryRemoteInteger: null,
      monthlyGrossSalaryRemoteInteger: null,
      annualFeeRemoteInteger: null,
      monthlyFeeRemoteInteger: null,
      lifetimeMonthlyFeesRemoteInteger: null,
      components: [
        { key: "monthlyManagementFee", label: "Monthly EOR management fee", remoteInteger: 0, currency: currency ?? "USD", status: "INPUT_REQUIRED" },
        { key: "eorTransferFee", label: "One-off EOR transfer fee", remoteInteger: 0, currency: currency ?? "USD", status: "QUOTE_REQUIRED" },
        { key: "mobilityFee", label: "Mobility / visa support", remoteInteger: 0, currency: currency ?? "USD", status: "QUOTE_REQUIRED" },
      ],
      // NOT 0 / "0.00 USD". On the INCOMPLETE branch not one component has a
      // value; the sum of nothing known is not zero money, it is no answer, and
      // "0.00 USD" beside status INCOMPLETE reads as a relocation that costs
      // nothing. `null` is what every refusal in this repo returns for a figure
      // it cannot derive.
      knownTotalRemoteInteger: null,
      knownTotalDisplay: null,
      knownTermTotalRemoteInteger: null,
      knownTermTotalDisplay: null,
      pendingQuotes: ["monthlyManagementFee", "eorTransferFee", "mobilityFee"],
    },
  };
}

// --- dossierBuilder.js: buildDossier() - the dossier SHAPE, verbatim --------
// The key ordering and the nesting (`dateChecks`, `transitionSafety`) are part
// of the contract: src/uc07/dossierStore.js persists this object as-is and the
// ZAF sidebar's UC-07 panel reads it back by those exact paths. A flatter shape
// here renders as a half-empty panel with no error anywhere.
function buildDossier({
  relocationType,
  sourceCountry,
  destinationCountry,
  parseSource,
  verdict,
  feasible,
  flags,
  requiredActions,
  mot,
  coverage,
  alignment,
  transition,
  pto,
  seniority,
  uncertainty,
  costEstimate,
  citations,
  narrative,
  faithfulness = null,
}) {
  return {
    relocationType,
    sourceCountry,
    destinationCountry,
    parseSource,
    verdict,
    feasible,
    flags,
    requiredActions,
    dateChecks: { mot, coverage, alignment },
    transitionSafety: transition,
    pto,
    seniority,
    uncertainty,
    costEstimate,
    citations,
    narrative,
    faithfulness,
    framing: "RESEARCH SUPPORT ONLY \u2014 not a relocation decision or a legal, immigration, or tax determination. For review by a qualified Mobility Legal specialist (Tier-3).",
    customerFacingAcknowledgement: withMobilityDisclaimer(
      "Thank you for your relocation request. It has been received and is under review by our Mobility Legal specialist team."
    ),
  };
}

// --- workflow.js: handleRelocationReview()'s body, minus the LLM seams ------
const structuredPlan = ticket.plan || {};

// Apply immigration support requirement from parser, but let plan override
const immigrationSupportRequired = structuredPlan.immigrationSupportRequired ?? parsed.immigrationSupportRequired;

// The route, resolved once and used everywhere below (gate, narrative,
// dossier) - a structured fact from the plan wins over the parse, exactly as
// src/uc07/workflow.js does it.
const sourceCountry = structuredPlan.sourceCountry ?? parsed.sourceCountry ?? null;
const destinationCountry = structuredPlan.destinationCountry ?? parsed.destinationCountry ?? null;

const feasibility = evaluateRelocationFeasibility({
  relocationType: parsed.relocationType,
  ...structuredPlan,
  immigrationSupportRequired,
  sourceCountry,
  destinationCountry,
});

// The PTO cashout comes from the gate that derived it (feasibility.pto.cashout)
// and travels on the dossier. It is not recomputed here: this line used to run a
// second, divergent copy of the arithmetic whose result was never read. `null`
// when the gate could not derive it - runCostCalculator adds no line for it
// rather than a fabricated zero.
const ptoCashoutRemoteInteger = feasibility.pto.cashout.totalRemoteInteger;

const costEstimate = runCostCalculator({
  annualGrossSalaryRemoteInteger: structuredPlan.annualGrossSalaryRemoteInteger,
  currency: structuredPlan.currency ?? "USD",
  months: structuredPlan.months ?? 12,
  managementFeeBasisPoints: structuredPlan.managementFeeBasisPoints ?? 1200,
  transferFeeRemoteInteger: structuredPlan.transferFeeRemoteInteger ?? null,
  mobilityFeeRemoteInteger: structuredPlan.mobilityFeeRemoteInteger ?? null,
  ptoCashoutRemoteInteger,
});

const citations = retrieveMobilityGuidance([ticket.text, parsed.relocationType].join(" "));

const narrative = draftNarrativeTemplate({
  relocationType: parsed.relocationType,
  sourceCountry,
  destinationCountry,
  verdict: feasibility.verdict,
  flags: feasibility.flags,
  citations,
});

// The faithfulness judge cannot run in a Code node. `not_evaluated` is the same
// explicit sentinel the real judge returns when unconfigured - never a
// fabricated "faithful", never a fabricated "not_faithful".
const faithfulness = { verdict: "not_evaluated", reason: null };

const dossier = buildDossier({
  relocationType: parsed.relocationType,
  sourceCountry,
  destinationCountry,
  parseSource: parsed.source,
  verdict: feasibility.verdict,
  feasible: feasibility.feasible,
  flags: feasibility.flags,
  requiredActions: feasibility.requiredActions,
  mot: feasibility.mot,
  coverage: feasibility.coverage,
  alignment: feasibility.alignment,
  transition: feasibility.transition,
  pto: feasibility.pto,
  seniority: feasibility.seniority,
  uncertainty: feasibility.uncertainty,
  costEstimate: costEstimate.estimate,
  citations,
  narrative,
  faithfulness,
});

// The ONLY thing this node's decision ever is. No branch, no other value.
const decision = 'escalate';
const riskTier = 'high';

// `parsed.source` is spread out as `parseSource`, NOT as `source`: the ticket's
// own `source` (the trigger that delivered it) is what the audit row records,
// and letting the parser's provenance tag overwrite it would silently relabel
// every relocation as having arrived from "rule_based_fallback".
return [{
  json: {
    ...ticket,
    relocationType: parsed.relocationType,
    sourceCountry,
    destinationCountry,
    mentionedCountries: parsed.mentionedCountries,
    countryExtractionReason: parsed.countryExtractionReason,
    requiresVisa: parsed.requiresVisa,
    immigrationSupportRequired: parsed.immigrationSupportRequired,
    parseSource: parsed.source,
    feasibility,
    citations,
    narrative,
    dossier,
    decision,
    riskTier,
    costEstimate: costEstimate.estimate,
  },
}];
