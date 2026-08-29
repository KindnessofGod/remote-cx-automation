// ---------------------------------------------------------------------------
// transitionGate.js  —  UC-07 deterministic relocation gates (the decision core)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// UC-07's whole point (docs/use-cases/UC-07.md §1/§7, Build Pack Part 9) is
// that a permanent relocation is a *coordinated transition between two legal
// employment relationships*, not "move the employee's address field." Before
// any human can decide whether a relocation is safe to attempt, the dossier
// must answer deterministic questions that no LLM should guess at:
//
//   - is the destination country/entity even available?   (§7 availability)
//   - will the start date clear the destination's Minimum Onboarding Time?
//   - does the salary meet the destination's statutory visa minimum?  (§7)
//   - does the plan leave an employment gap or an overlap?
//   - is the month-end alignment right (no duplicate EOR management fee)?
//   - is source offboarding authorized ONLY after the destination is ready?
//     (Build Pack Part 9: destination.created ≠ transfer.safe_to_offboard —
//     this is the single most important rule in the whole use case)
//   - how is PTO handled (portable vs. liquidated) and seniority preserved?
//   - what is a defensible, deterministic uncertainty score for the dossier?
//
// This file is 100% pure: every function takes structured values and returns
// structured verdicts. No I/O, no LLM, no Remote/Zendesk client — exactly the
// shape of presenceCalculator.js in UC-08, so `npm test` covers the decision
// logic hermetically. All money values are Remote ×100 integers (money.js).
// ---------------------------------------------------------------------------

import { toRemoteInteger, fromRemoteInteger } from "../shared/money.js";

/** Severity labels used across every flag this module raises. */
export const SEVERITY = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

// ---------------------------------------------------------------------------
// Flag codes — the Build Pack's error taxonomy (Part 36) subset this use case
// can actually raise BEFORE execution. Codes that only make sense mid-execution
// (onboarding failed, offboarding failed, rollback…) have no home here,
// deliberately: this module compiles a pre-execution feasibility dossier.
// ---------------------------------------------------------------------------
export const FLAG = {
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
  // MEDIUM, for the same reason COUNTRIES_NOT_DETERMINED is: a payout we
  // cannot derive is a hole in the dossier, not a statement that the
  // relocation is infeasible. HIGH would make it BLOCK the plan, which would
  // be this gate claiming something it does not know.
  [FLAG.PTO_CASHOUT_NOT_COMPUTABLE]: SEVERITY.MEDIUM,
  // MEDIUM, deliberately: not knowing the jurisdictions is not the same as the
  // relocation being infeasible (that is a HIGH/BLOCK statement about the plan),
  // but it is more than a footnote — every other gate in this file reasons
  // about a route, so an unresolved route is a review-required gap in the
  // dossier itself. It also lifts the uncertainty score, which is exactly the
  // number a specialist weighs when deciding how much of this to re-check.
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

// ---------------------------------------------------------------------------
// Pure date arithmetic helpers (mirroring presenceCalculator.js's discipline)
// ---------------------------------------------------------------------------

/** Whole calendar days between two "YYYY-MM-DD" dates (end-exclusive, ≥0). */
export function diffDays(startDate, endDate) {
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/** Whole business days (Mon–Fri) between two "YYYY-MM-DD" dates (end-exclusive). */
export function diffBusinessDays(startDate, endDate) {
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

/** True if `date` is the last calendar day of its month ("YYYY-MM-DD"). */
export function isLastDayOfMonth(date) {
  const d = new Date(date);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastDay = new Date(next.getTime() - 86400000);
  return d.getUTCDate() === lastDay.getUTCDate();
}

/** True if `date` is the first calendar day of its month ("YYYY-MM-DD"). */
export function isFirstDayOfMonth(date) {
  return new Date(date).getUTCDate() === 1;
}

// ---------------------------------------------------------------------------
// The individual gates (each pure, each one Build Pack rule)
// ---------------------------------------------------------------------------

/**
 * Minimum Onboarding Time (Build Pack Part 15, docs/use-cases/UC-07.md §7).
 * Lead time in business days between the destination profile creation and the
 * official start date. Returns the Build Pack's requested error shape rather
 * than a bare "422".
 */
export function evaluateMOT({ creationDate, proposedStartDate, minimumLeadTimeBusinessDays }) {
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

/** Add N business days to a "YYYY-MM-DD" date (skipping weekends). */
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

/**
 * Month-end alignment (Build Pack Part 14): Remote avoids duplicate monthly
 * EOR management fees when the source termination is the last calendar day of
 * a month and the destination start is the first day of the following month.
 * This is a financial *optimization* that depends on the same date arithmetic,
 * so it lives with the date engine rather than the cost calculator.
 */
export function evaluateMonthEndAlignment({ sourceTerminationDate, destinationStartDate }) {
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

/**
 * Employment-gap / overlap check (Build Pack Part 3 goals: no unauthorized
 * gap, no overlap). Both directions are problems: a gap is unauthorized
 * non-employment, an overlap is duplicate-fee exposure.
 */
export function evaluateCoverageGap({ sourceLastWorkingDay, sourceTerminationDate, destinationStartDate }) {
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

/**
 * THE headline UC-07 rule (Build Pack Part 9):
 *   destination.contract_active + right_to_work_confirmed +
 *   destination_start_date_confirmed + source_exit_plan_validated
 *   = source_offboarding_authorized
 * Never terminate the source employment merely because the destination record
 * was created. This is asserted as the safety gate, and the workflow that
 * consumes this dossier has no way to act on it anyway — the dossier simply
 * tells the Mobility Legal specialist whether the plan's sequencing is sound.
 */
export function evaluateTransitionSafety({
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

/**
 * Salary vs. statutory visa minimum (docs/use-cases/UC-07.md §7).
 *
 * BOTH values are ANNUAL GROSS in Remote ×100 integers — the same period and
 * scaling as Remote's own `annual_gross_salary` ("the annual gross salary …
 * in cents", `POST /v1/cost-calculator/estimation`, [CONFIRMED] 2026-08-19),
 * and the period every statutory visa threshold is published in. Stated here
 * because a comparison is only meaningful if both sides share a period, and
 * this repo has already paid once for the same value being read as annual by
 * this gate and as monthly by the cost calculator (see costCalculator.js's
 * header). A null minimum means no statutory threshold applies. A MISSING
 * salary is "unknown", never "below" — flagging a below-minimum without a
 * salary to compare would be inventing a deficit from an absence.
 */
export function evaluateSalaryVisaMinimum({ annualGrossSalaryRemoteInteger, minimumVisaSalaryRemoteInteger }) {
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

/**
 * PTO portability (Build Pack Part 18). Portable only where local law allows;
 * otherwise liquidated into final settlement. Deterministic over the given
 * `transferAllowed` fact — never a guess about either country's law.
 */
export function evaluatePTO({ sourcePtoDays, transferAllowed }) {
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

/**
 * Seniority continuity (Build Pack Part 19). Never assume destination start =
 * seniority date. `preservable` (true/false/null) is a structured fact from
 * legal/contract review; null = unknown = review required.
 */
export function evaluateSeniority({ originalHireDate, destinationStartDate, preservable }) {
  if (preservable === true) {
    // "PRESERVED" WITHOUT A DATE IS HALF AN ANSWER, AND IT MUST SAY SO.
    //
    // The date is the whole substance of this verdict: preserved seniority is
    // what statutory notice, severance and vesting are all counted from, so
    // "preserved from <nothing>" gives a Mobility Legal specialist nothing to
    // act on. This function was already fixed once to thread `originalHireDate`
    // through "so a PRESERVED verdict can report an actual date rather than
    // null" — and every caller still passes nothing, so every PROCEED dossier
    // says PRESERVED with `seniorityDate: null`. The threading existing is not
    // the same claim as the threading being fed.
    //
    // The status stays PRESERVED, because that IS the legal answer and it is
    // the answer the caller gave us. What changes is that the reason names the
    // gap instead of asserting a date we never had, so the absence is legible
    // in the dossier, in the audit row and on the page rather than showing up
    // as a quiet null a reader skims past. No new FLAG is raised: the flag set
    // is compared field-for-field against the n8n port
    // (test/n8nUc07Parity.test.js), which cannot raise one, and a parity break
    // is a worse outcome than a prose difference.
    return originalHireDate
      ? { status: "PRESERVED", seniorityDate: originalHireDate, reason: "Seniority preserved from original hire date." }
      : {
          status: "PRESERVED",
          seniorityDate: null,
          reason:
            "Seniority is preserved, but the original hire date was not supplied — the date it is preserved FROM still has to be established before this figure can be used.",
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

/**
 * Deterministic uncertainty score (docs/use-cases/UC-07.md §5: "uncertainty
 * score" in the dossier). Computed from the actual flags the gates raised —
 * never an LLM guess — because prime directive #1 ("deterministic code
 * decides") applies to a number a specialist may weigh. HIGH=0.5, MEDIUM=0.3,
 * LOW=0.2 per flag, capped at 1. A clean case scores exactly 0.
 */
export function computeUncertaintyScore(flags) {
  return Math.min(1, (flags ?? []).reduce((sum, f) => sum + severityWeight(f.severity), 0));
}

/**
 * The per-severity contribution to the uncertainty score, and the cap.
 *
 * EXPORTED SO NOTHING HAS TO RESTATE IT. These three numbers used to live only
 * inside computeUncertaintyScore(), so anything explaining the score to a human
 * had to hard-code a second copy — and a second copy of a weight table is a
 * copy that drifts silently, because a wrong explanation of a right number
 * looks exactly like a right one.
 */
export const UNCERTAINTY_WEIGHT = Object.freeze({ HIGH: 0.5, MEDIUM: 0.3, LOW: 0.2 });
export const UNCERTAINTY_CAP = 1;
/** An unrecognised severity contributes the LOW weight — never zero. */
export const UNCERTAINTY_DEFAULT_WEIGHT = UNCERTAINTY_WEIGHT.LOW;

function severityWeight(severity) {
  return UNCERTAINTY_WEIGHT[severity] ?? UNCERTAINTY_DEFAULT_WEIGHT;
}

/**
 * The uncertainty score, taken apart.
 *
 * WHY. `uncertainty: 0.6` is a bare number in a dossier whose whole purpose is
 * to let a Mobility Legal specialist decide how much of the plan to re-check —
 * and it is the number that answers exactly that question. Printed alone it
 * says nothing about which flags drove it, whether it hit the cap, or whether
 * 0.6 is one HIGH plus one LOW or three MEDIUMs. This is the C-27 pattern
 * (P7, "said less than it knew"): every input was in hand and only the total
 * was reported.
 *
 * `capped` matters more than it looks. Once the raw total passes 1 the score
 * stops moving, so two plans scoring 1.0 can be a long way apart, and a
 * specialist reading 1.0 as "the maximum" rather than "at least the maximum"
 * is reading a floor as a ceiling.
 *
 * Pure, and deliberately NOT part of any gate's return: `evaluateRelocationFeasibility()`
 * is compared field-for-field against `workflows/nodes-uc07/relocationGates.js`
 * (test/n8nUc07Parity.test.js), so this is derived on read instead — which also
 * means it applies to dossiers written by either execution path.
 *
 * @param {Array<{code:string, severity:string}>} flags
 * @returns {{score:number, rawTotal:number, capped:boolean, cap:number, weights:object, contributions:Array<{code:string,severity:string,weight:number}>}}
 */
export function explainUncertainty(flags) {
  const list = Array.isArray(flags) ? flags : [];
  const contributions = list.map((f) => ({
    code: f?.code ?? null,
    severity: f?.severity ?? null,
    weight: severityWeight(f?.severity),
  }));
  const rawTotal = contributions.reduce((sum, c) => sum + c.weight, 0);
  // Rounded only for display: floating-point addition of 0.3s produces
  // 0.8999999999999999, and a dossier that reports that has invented precision
  // it does not have. The SCORE itself stays the same value the gate computed.
  const round = (n) => Math.round(n * 100) / 100;
  return {
    score: round(Math.min(UNCERTAINTY_CAP, rawTotal)),
    rawTotal: round(rawTotal),
    capped: rawTotal > UNCERTAINTY_CAP,
    cap: UNCERTAINTY_CAP,
    weights: { ...UNCERTAINTY_WEIGHT },
    contributions,
  };
}

/**
 * Compose every gate into the feasibility verdict the dossier carries.
 *   verdict: "PROCEED" (no flags) | "REVIEW" (fixable plan gaps) | "BLOCK" (infeasible as proposed)
 *   feasible: true only for PROCEED.
 * High-severity flags block; medium/low flags force review. This is the
 * MobilityDecisionEngine from Build Pack Part 35, expressed as a pure function.
 */
export function evaluateRelocationFeasibility({
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
  // null, NOT 0. "Nobody told us the balance" and "the balance is zero" are
  // different facts, and defaulting the first to the second is how a dossier
  // came to state a confident 0.00 payout on a balance nobody had counted
  // (F-29). reconcilePtoCashout() below refuses the unknown; a real 0 still
  // computes to a real 0.
  sourcePtoDays = null,
  seniorityPreservable = null,
  // The route the request was understood to describe. Passed in (rather than
  // re-parsed here) because this module is pure and the parse is the
  // classifier's job — but it is checked here so an unresolved route is a
  // FLAG on the dossier, like a missing timeline, instead of two quiet nulls a
  // reader can mistake for "not relevant". See relocationParser.js's header for
  // why an unresolved route is now a real, common outcome.
  sourceCountry = null,
  destinationCountry = null,
  // The employee's real hire date, threaded through to evaluateSeniority()
  // so a PRESERVED verdict can report an actual date rather than null —
  // previously hardcoded to null here regardless of what the plan carried.
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

  // Route: same family as the timeline gap above — something the REQUEST failed
  // to establish, surfaced rather than absorbed.
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

  // The money that liquidation decision implies. It lives HERE, in the PTO
  // section, and deliberately not beside the salary/visa gate above, even
  // though both read `annualGrossSalaryRemoteInteger`. Those two gates ask different
  // questions and must not be allowed to answer for each other:
  // evaluateSalaryVisaMinimum() already refuses to call an ABSENT salary
  // "below minimum" (unknown is not below), and this gate must equally refuse
  // to call an absent salary a statutory problem — it is a derivation gap, and
  // a derivation gap routed to the immigration desk as a visa-minimum finding
  // is the right escalation sent to the wrong specialist. Raised as MEDIUM so
  // it can lift the uncertainty score and force REVIEW, but can never soften
  // or outrank a HIGH flag's BLOCK.
  //
  // The flag is pushed before the single return below, so an underivable
  // payout is on `flags` — and therefore in the audit row's flagCodes and on
  // the dossier — no matter which way the verdict falls.
  const ptoCashout = reconcilePtoCashout({
    annualGrossSalaryRemoteInteger,
    liquidatedDays: pto.liquidatedDays,
  });
  if (!ptoCashout.computable) push(FLAG.PTO_CASHOUT_NOT_COMPUTABLE);
  // originalHireDate threaded through from the plan (not hardcoded null) —
  // a PRESERVED seniority verdict can now report the real date it preserves.
  const seniority = evaluateSeniority({ originalHireDate, destinationStartDate, preservable: seniorityPreservable });
  if (seniority.status === "REQUIRES_LEGAL_REVIEW") push(FLAG.SENIORITY_REVIEW_REQUIRED);

  const uncertainty = computeUncertaintyScore(flags);
  const verdict = flags.some((f) => f.severity === SEVERITY.HIGH) ? "BLOCK" : flags.length > 0 ? "REVIEW" : "PROCEED";
  const feasible = verdict === "PROCEED";

  // `pto` carries its own cashout rather than the workflow recomputing it: one
  // derivation site, so the Node and n8n copies cannot drift apart on a money
  // figure (they had, by exactly 100×, while nothing consumed the value).
  return {
    verdict, feasible, flags, requiredActions, mot, coverage, alignment, transition,
    pto: { ...pto, cashout: ptoCashout },
    seniority, uncertainty,
  };
}

// The two divisors that take an ANNUAL gross salary down to a daily rate.
// Both are stated repo conventions, not Remote API facts (see
// reconcilePtoCashout's header) — kept as named constants so neither can be
// re-typed as a bare number at a second call site and drift.
const MONTHS_PER_YEAR = 12;
/** Remote's working-day divisor for one month's pay — the daily-rate basis. */
const WORKING_DAYS_PER_MONTH = 22;

/**
 * The destination-side PTO cashout the liquidation decision implies, in Remote
 * integer form (money.js ×100).
 *
 * TWO INDEPENDENT DEFECTS LIVED IN THIS ONE FUNCTION, AND BOTH FIXES ARE HERE.
 * They are easy to mistake for one another and neither supersedes the other:
 * F-29 is about what happens when the number CANNOT be derived; the period fix
 * is about the number being twelve times wrong when it CAN.
 *
 * ---- F-29: WHY THIS CLASSIFIES BEFORE IT CALCULATES (same class as UC-05's F-28)
 * This used to be four lines of arithmetic with no guard. An absent salary
 * became `undefined / 100` = NaN, NaN reached toRemoteInteger, and toRemoteInteger
 * — correctly — refused it by THROWING. The throw left evaluateRelocationFeasibility
 * and then handleRelocationReview, which computes the cashout ~90 lines BEFORE it
 * writes the audit row. So the request produced no dossier row and no audit row
 * at all: it vanished. Every other refusal in this system fails closed to a
 * durable, audited escalate; this one failed open into silence, which is the one
 * outcome the architecture exists to prevent (CLAUDE.md §3 "Audit everything").
 * It is reachable from the portal with no unusual input: leave the salary box
 * blank, leave "PTO transfer allowed" unchecked, type a day count.
 *
 * WHY THE ANSWER IS A REFUSAL, NOT A ZERO
 * `return 0` would have been the one-character fix and is the wrong one. Note
 * what the days side already did: `sourcePtoDays` defaulted to 0 in
 * evaluateRelocationFeasibility, so a plan that says "PTO is not transferable"
 * while carrying no day count produced a dossier reading "LIQUIDATE, 0 days,
 * 0.00 owed" — a confident underpayment a specialist signs off on. A wrong
 * number gets acted on; a missing one gets investigated (§9). So an amount we
 * cannot derive is null and names the field it was missing, never a coerced 0.
 *
 * A QUOTED NUMBER IS NOT A NUMBER. `"6500000"` divides by 100 perfectly well in
 * JavaScript and is exactly how a 100× scaling error gets in (prime directive 1:
 * deterministic code decides). Number.isInteger refuses it.
 *
 * ---- THE PERIOD: THE SALARY IS ANNUAL, AND THE RATE MUST SAY SO
 * This function's parameter used to be named `monthlySalaryRemoteInteger` while
 * every caller passed the plan's salary — the SAME value the visa-minimum gate
 * compares against an annual statutory threshold, and the value every fixture,
 * seed and portal form in this repo authors as an annual figure. Remote's own
 * cost-calculator input is `annual_gross_salary`, "the annual gross salary … in
 * cents" ([CONFIRMED] against `post_v1_cost-calculator_estimation.md`). Dividing
 * an annual salary by 22 as though it were a month's pay made a €72,000/yr
 * employee's 15 liquidated days read €49,090.91 instead of €4,090.91 — twelve
 * times over, on a settlement figure.
 *
 * So the parameter is named for its period, and the monthly figure the daily
 * rate needs is DERIVED here, inside, where the arithmetic needs it. A
 * parameter still called `monthlySalary*` while being fed an annual value is
 * exactly the substitution that caused this, and renaming it is what stops the
 * substitution being made again silently: a monthly figure passed under the new
 * name now arrives as `undefined` and is refused by the ladder below, loudly
 * and durably, rather than under-paying by a factor of twelve.
 *
 * `unusable[]` names the field by its CURRENT name for the same reason the
 * refusal exists at all — an escalation that tells a specialist to go and find
 * `monthlySalaryRemoteInteger` sends them looking for a field that no longer
 * exists anywhere in this system.
 *
 * The 22 working days and the 12 months are stated repo conventions, NOT Remote
 * API facts — Remote publishes no working-days-per-month figure, and inventing
 * a statutory one would be exactly the fabrication costCalculator.js refuses
 * for the transfer fee.
 *
 * @returns {{computable: boolean, totalRemoteInteger: number|null, unusable: Array<{field: string, reason: string, value: *}>}}
 */
export function reconcilePtoCashout({ annualGrossSalaryRemoteInteger, liquidatedDays }) {
  const unusable = [];

  // Days first: whether anything is owed at all is a question about the
  // BALANCE, and it is answerable without knowing the salary.
  const daysKnown = typeof liquidatedDays === "number" && Number.isFinite(liquidatedDays) && liquidatedDays >= 0;
  if (!daysKnown) {
    unusable.push({
      field: "liquidatedDays",
      reason: liquidatedDays == null ? "missing" : "not_a_non_negative_number",
      value: liquidatedDays ?? null,
    });
  }

  // A REAL zero is a real answer — nothing accrued, so nothing is owed, and the
  // salary is irrelevant to that. Only a balance with days in it needs a rate.
  if (daysKnown && liquidatedDays === 0) {
    return { computable: true, totalRemoteInteger: 0, unusable: [] };
  }

  if (!Number.isInteger(annualGrossSalaryRemoteInteger)) {
    unusable.push({
      field: "annualGrossSalaryRemoteInteger",
      reason: annualGrossSalaryRemoteInteger == null ? "missing" : "not_an_integer",
      value: annualGrossSalaryRemoteInteger ?? null,
    });
  }

  // Partial totals are not offered. A sum presented as a total while one of its
  // inputs is unknown is a wrong number wearing a right number's clothes.
  if (unusable.length > 0) return { computable: false, totalRemoteInteger: null, unusable };

  // The arithmetic, with the period made explicit: annual -> monthly -> daily.
  // toRemoteInteger's rounding at the end keeps it integer-safe instead of
  // letting floating-point drift accumulate.
  const monthlyHuman = fromRemoteInteger(annualGrossSalaryRemoteInteger) / MONTHS_PER_YEAR;
  const dailyHuman = monthlyHuman / WORKING_DAYS_PER_MONTH;
  return { computable: true, totalRemoteInteger: toRemoteInteger(dailyHuman * liquidatedDays), unusable: [] };
}
