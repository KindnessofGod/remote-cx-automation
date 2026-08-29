// ---------------------------------------------------------------------------
// approvalView.js  —  what each UC-09 role needs before it signs, derived at READ
// ---------------------------------------------------------------------------
// THREE READERS, THREE DIFFERENT DECISIONS. They are NOT one audience.
//
//   requester (Customer Admin)  — "is this the adjustment I meant to ask for?"
//        Turns on: the amount, its currency, gross vs net, the type, the
//        effective date, and the note that will be attached at Remote.
//
//   approver (Remote Payroll specialist) — "should this be paid at all?"
//        Turns on everything the requester needs, PLUS: why this adjustment
//        needs the signature count it does, and who has already signed.
//
//   payment_releaser (only present above the floor) — "should I release it?"
//        Turns on the same facts plus the SPECIFIC risk that summoned them.
//        A third signature exists precisely because a dimension crossed a line;
//        being asked to sign without being told which line is being asked to
//        rubber-stamp. That is the whole failure mode a third pair of eyes is
//        supposed to prevent.
//
// WHAT WAS MISSING
//   1. WHY the third signature. The row said `high_risk_adjustment_needs_triple_
//      approval` and carried the flag `high_amount_risk`. It never said: the
//      amount, the threshold it crossed, by how much, or by what percentage —
//      and the gate cannot raise that flag without knowing all four. This is
//      C-27 (pattern P7, "said less than it knew") on the one use case in this
//      repository where real money moves.
//   2. WHO HAS SIGNED, while the row is still open. `describeSignatures()` in
//      multiApprovalPolicy.js names every signature beautifully — and only on a
//      SETTLED row. An adjustment awaiting approval reported, in full,
//      "Awaiting approval." So the second of three approvers opened the panel
//      and could not see that the first had signed, who they were, or which
//      role was still outstanding.
//   3. THE SEGREGATION-OF-DUTIES CONSTRAINT, before it fires. `evaluateApprovalAction()`
//      refuses `same_person_cannot_fill_multiple_roles` at submit time. Nothing
//      told a reader in advance that the humans already on the row cannot sign
//      again — the four-eyes rule was enforced but invisible.
//
// DERIVED AT READ TIME, from the stored row alone. It works for rows written by
// the n8n graph as well as by the Node app, applies to every row already in
// `uc09_adjustments`, and adds no dependency, no parameter and no route. It
// decides NOTHING: `evaluateApprovalAction()` and `isFullyApproved()` remain the
// only things that gate a signature or an execution, and neither reads this file.
// ---------------------------------------------------------------------------

import { formatMoney, fromRemoteInteger } from "../shared/money.js";
import { isSameApprover } from "../shared/approverIdentity.js";
import { countryLabel } from "../shared/countryNames.js";
import {
  HIGH_AMOUNT_THRESHOLD_CURRENCY,
  HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
  HIGH_TAX_COMPLEXITY_COUNTRIES,
  HIGH_TAX_COMPLEXITY_HEURISTIC,
  highAmountThresholdFor,
  normalizeCurrencyCode,
} from "./policyEngine.js";

const ROLE_ORDER = ["requester", "approver", "payment_releaser"];

/**
 * THE ROLE IN THE READER'S WORDS, AND THE ONLY COPY OF IT.
 *
 * `payment_releaser` is what the row stores and what `evaluateApprovalAction()`
 * compares; it is not what a payroll specialist calls the third signature. This
 * sentence — "1 of 3 required signature(s) recorded (requester: Bob Smith).
 * Still outstanding: payment_releaser." — reached a person about to authorise a
 * payment, and named the role in the store's vocabulary rather than theirs.
 *
 * It lives HERE, beside `ROLE_ORDER` and `SLOT_KEY`, because this file already
 * owns UC-09's role vocabulary; `decisionFacts.js` held a second copy of the
 * same three labels and now imports this one. Three copies of one label map is
 * the drift this repository has already paid for in country codes and in the
 * n8n gate bodies (commit 03df132), and two is where that starts.
 *
 * IT IS A DISPLAY MAP AND NOTHING ELSE. Nothing compares against these values,
 * nothing stores them, and an unmapped role falls back to the role itself
 * rather than to a blank — a role added later reads as a slug, which is ugly,
 * and never disappears from a sentence about who still has to sign.
 */
export const ROLE_LABEL = Object.freeze({
  requester: "Requester",
  approver: "Approver",
  payment_releaser: "Payment releaser",
});

/** The role as a person says it, or the stored value when nothing maps it. */
export const roleLabel = (role) => ROLE_LABEL[role] ?? String(role ?? "");

const SLOT_KEY = {
  requester: "requesterApproval",
  approver: "approverApproval",
  payment_releaser: "paymentReleaserApproval",
};

/**
 * Everything the three roles need, derived from one stored adjustment row.
 *
 * @param {object|null} adjustmentRow
 * @returns {{money: object, approvalRequirement: object, approvalProgress: object}}
 */
export function describeAdjustment(adjustmentRow) {
  const row = adjustmentRow ?? {};
  return {
    money: describeMoney(row),
    approvalRequirement: describeApprovalRequirement(row),
    approvalProgress: describeApprovalProgress(row),
  };
}

// ---------------------------------------------------------------------------
// The money
// ---------------------------------------------------------------------------

/**
 * The figure being signed for, in the terms it will actually be paid in.
 *
 * GROSS VS NET IS PART OF THE AMOUNT, NOT A DETAIL BESIDE IT. Remote's own
 * words: `net` means Remote grosses the figure UP so the employee receives it
 * intact — so the same integer moves a different amount of company money under
 * each reading. policyEngine.js refuses to default the field for exactly that
 * reason and calls it "the only gate in this file whose absence would have been
 * silently paid for in cash". It then did not appear in the one sentence a human
 * reads before signing.
 */
function describeMoney(row) {
  const adjustment = row.adjustment ?? {};
  const amount = adjustment.amount;
  const currency = adjustment.currency ?? null;
  const taxType = adjustment.amountTaxType ?? row.payload?.amount_tax_type ?? null;

  if (!Number.isInteger(amount)) {
    return {
      amountRemoteInteger: null,
      // Never "0.00" and never a bare currency code: an amount nobody could
      // establish is an absence, and this use case pays out on what it is told.
      display: null,
      currency,
      amountTaxType: taxType,
      statement:
        "No amount could be established for this request, so there is no figure to approve. A payroll specialist " +
        "must read the original request and re-submit it with the amount as structured input.",
    };
  }

  const display = currency ? formatMoney(amount, currency) : formatMoney(amount, "").trim();
  const taxClause =
    taxType === "gross"
      ? "GROSS — this is the amount before tax is subtracted; the employee receives less than this."
      : taxType === "net"
        ? "NET — the employee receives this amount intact and Remote grosses it up, so the company pays MORE than this figure."
        : "The gross/net basis is not recorded on this row, so what the company actually pays cannot be stated. Do not sign without it.";

  return {
    amountRemoteInteger: amount,
    display,
    currency,
    amountTaxType: taxType,
    statement: `${display}, ${taxClause}`,
  };
}

// ---------------------------------------------------------------------------
// Why this many signatures
// ---------------------------------------------------------------------------

/**
 * The signature requirement, dimension by dimension, with the numbers.
 *
 * Every dimension is reported whether or not it triggered — `triggered: false`
 * is a fact an approver wants ("the amount is well inside the threshold") and
 * listing only the triggers would leave them unable to tell a dimension that
 * passed from one that was never evaluated.
 */
export function describeApprovalRequirement(row) {
  const adjustment = row.adjustment ?? {};
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const required = Number.isInteger(row.approvalSlotsRequired) ? row.approvalSlotsRequired : null;

  // The workflow records policyEngine's own `riskBasis` on the audit row; where
  // the adjustment row carries it too, the country dimension can name the code
  // it saw. Absent, it says so rather than guessing.
  const recordedCountryBasis = (Array.isArray(row.riskBasis) ? row.riskBasis : []).find(
    (b) => b?.dimension === "jurisdiction_tax_complexity"
  );

  const dimensions = [
    describeAmountDimension(adjustment),
    describeTaxDimension(adjustment),
    describeCountryDimension(flags, recordedCountryBasis),
  ];

  // No approval path at all is a DIFFERENT state from "two signatures needed",
  // and it is the one most easily misread. `approvalSlotsRequired: 0` on an
  // escalated row does not mean the floor was lowered to zero — it means the
  // request never reached the point where a signature could be offered.
  const pathOpen = Boolean(required && required > 0);
  const triggered = dimensions.filter((d) => d.triggered);

  // An unsourced dimension that ACTUALLY FIRED is called out in the headline,
  // not left to be discovered in a nested field. If an invented list is the
  // reason a third human is being summoned, that is the first thing the third
  // human should be told.
  const unsourcedDrivers = triggered.filter((d) => d.basis === "unsourced_heuristic");
  const unsourcedClause = unsourcedDrivers.length
    ? ` ⚠ ${unsourcedDrivers.length} of those dimension(s) rest on an UNSOURCED list with no publishing authority —` +
      " see the provenance on each below before treating it as a compliance finding."
    : "";

  const statement = !pathOpen
    ? "No approval path was opened for this adjustment — it was refused at a gate before any signature could be " +
      "collected. The floor of two is not lowered here; it is never reached."
    : required >= 3
      ? `THREE separate people must sign before any money moves, because ${triggered.length} risk dimension(s) ` +
        `crossed a line: ${triggered.map((d) => d.label).join("; ")}. The floor is two, and risk only ever raises it.` +
        unsourcedClause
      : "TWO separate people must sign before any money moves — the standing floor. No risk dimension raised it " +
        "further. Note what that does NOT mean: the jurisdiction dimension below checks an invented three-country " +
        "list, so a country outside it was never assessed at all.";

  return {
    approvalPathOpen: pathOpen,
    slotsRequired: required,
    floor: 2,
    dimensions,
    statement,
  };
}

/**
 * The amount against its threshold: the figure, the line, the overage, the percent.
 *
 * THE LINE IS PRINTED IN ITS OWN CURRENCY, NEVER IN THE REQUEST'S. This function
 * used to render the threshold as `formatMoney(threshold, theRequestsCurrency)`,
 * so a euro request was told it had been measured against a "€10,000.00
 * high-value threshold" — a denomination the gate did not have and had never
 * checked, printed on the screen a payment releaser signs. Stating a policy
 * figure in a currency nobody denominated it in is a manufactured value with a
 * currency symbol in front of it.
 */
function describeAmountDimension(adjustment) {
  const amount = adjustment.amount;
  const currency = adjustment.currency ?? "";
  const threshold = highAmountThresholdFor(currency);
  // The line always prints in ITS currency; the request's amount always prints
  // in the request's. They are only ever compared when those two agree.
  const thresholdDisplay = formatMoney(
    HIGH_AMOUNT_THRESHOLD_REMOTE_INTEGER,
    HIGH_AMOUNT_THRESHOLD_CURRENCY
  ).trim();

  if (threshold === null) {
    // NOT "under the line" — never measured against a line at all. Reported as
    // `triggered: true` because it really is why a third signature was
    // summoned (policyEngine.js raises the requirement here), and as
    // `comparable: false` so nobody reads it as a finding about the amount.
    return {
      code: "high_amount_threshold_not_comparable",
      label: "adjustment value could not be compared with the high-value threshold",
      triggered: true,
      evaluated: true,
      comparable: false,
      amountRemoteInteger: Number.isInteger(amount) ? amount : null,
      thresholdRemoteInteger: null,
      thresholdCurrency: HIGH_AMOUNT_THRESHOLD_CURRENCY,
      statedCurrency: normalizeCurrencyCode(currency),
      detail:
        `⚠ NOT COMPARED. The high-value line is stated only in ${HIGH_AMOUNT_THRESHOLD_CURRENCY} ` +
        `(${thresholdDisplay}), and this request is denominated in ` +
        `${normalizeCurrencyCode(currency) ?? "no stated currency"}. Converting between them would need an ` +
        "exchange rate this system does not hold and must not invent on a payment gate, so the amount was NOT " +
        "found to be small — it was never measured. A third signature is required because an unmeasured amount " +
        "costs a third pair of eyes rather than buying two. To make this dimension answerable, a stated policy " +
        "figure for this currency has to be added to the threshold table by whoever owns the policy.",
    };
  }

  if (!Number.isInteger(amount)) {
    return {
      code: "high_amount_risk",
      label: "adjustment value",
      triggered: false,
      evaluated: false,
      comparable: true,
      detail:
        `Not evaluated — no usable amount was established, so it could not be compared with the ` +
        `${thresholdDisplay} high-value threshold. This is an unknown, not a figure under the line.`,
    };
  }

  const over = amount - threshold;
  const amountDisplay = formatMoney(amount, currency).trim();
  if (over <= 0) {
    return {
      code: "high_amount_risk",
      label: "adjustment value",
      triggered: false,
      evaluated: true,
      comparable: true,
      amountRemoteInteger: amount,
      thresholdRemoteInteger: threshold,
      thresholdCurrency: HIGH_AMOUNT_THRESHOLD_CURRENCY,
      statedCurrency: normalizeCurrencyCode(currency),
      detail: `${amountDisplay} is at or below the ${thresholdDisplay} high-value threshold, so it does not by itself require a third signature.`,
    };
  }

  // The percentage is of the THRESHOLD, and says so — "50% over" is meaningless
  // until a reader knows over what. Rounded to one decimal because more digits
  // would claim a precision the threshold itself does not have.
  const percentOver = Math.round((fromRemoteInteger(over) / fromRemoteInteger(threshold)) * 1000) / 10;
  return {
    code: "high_amount_risk",
    label: "adjustment value above the high-value threshold",
    triggered: true,
    evaluated: true,
    comparable: true,
    amountRemoteInteger: amount,
    thresholdRemoteInteger: threshold,
    thresholdCurrency: HIGH_AMOUNT_THRESHOLD_CURRENCY,
    statedCurrency: normalizeCurrencyCode(currency),
    overageRemoteInteger: over,
    percentOverThreshold: percentOver,
    detail:
      `${amountDisplay} exceeds the ${thresholdDisplay} high-value threshold by ` +
      `${formatMoney(over, currency).trim()} (${percentOver}% over the threshold).`,
  };
}

/** Whether a human is overriding the tax arithmetic. */
function describeTaxDimension(adjustment) {
  const triggered = Boolean(adjustment.taxAdjustment);
  return {
    code: "manual_tax_adjustment",
    label: "manual tax adjustment",
    triggered,
    evaluated: true,
    detail: triggered
      ? "This request carries a MANUAL tax adjustment, so the statutory withholding is not being computed the " +
        "ordinary way. That is why a third signature is required — nobody automated the tax on this one."
      : "No manual tax adjustment — statutory withholding is left to the ordinary calculation.",
  };
}

/**
 * The employment's country — and, inseparably, the fact that the list it is
 * checked against has no authority behind it.
 *
 * THE DIMENSION THAT MUST NOT READ AS A COMPLIANCE DETERMINATION.
 * `high_tax_compliance_risk` is raised by an invented three-code list
 * (`HIGH_TAX_COMPLEXITY_HEURISTIC` in policyEngine.js, whose own former comment
 * read "Hypothetical"). It raises the signature requirement on the one use case
 * that moves real money, and until this function existed the only record of its
 * basis was a source comment no approver will ever read. `docs/KNOWLEDGE-SOURCES.md`
 * §1 Test B names it as the repository's clearest case of "if this were wrong,
 * nothing would catch it".
 *
 * BOTH BRANCHES CARRY THE PROVENANCE, and the `false` branch matters more.
 * A country absent from an unsourced list has not been assessed and found
 * simple — nothing assessed it. Reporting the absence as a plain "not in the
 * list" would let it read as a clean pass, which is precisely the `passed` /
 * `not_reached` collapse `docs/GATES.md` exists to prevent. So the negative
 * branch says `assessed: false`, not `triggered: false` alone.
 *
 * HONEST LIMIT, STATED RATHER THAN PAPERED OVER: `uc09_adjustments` stores no
 * country column, so this can report WHETHER the gate fired but not which
 * country fired it. Where the row carries the workflow's own `riskBasis` that
 * gap closes; where it does not (an older row, or one written by the n8n path),
 * the code is named as unavailable rather than guessed at.
 */
function describeCountryDimension(flags, recordedBasis) {
  const triggered = flags.includes("high_tax_compliance_risk");
  // NAMES ON THE SCREEN, CODES IN THE FIELDS. `countriesInScope` below still
  // carries the alpha-2 codes, which is what the gate compares and what anyone
  // quoting this row into another system needs; the sentence a payment releaser
  // reads says Germany, France, Italy. See src/shared/countryNames.js — a code
  // asks the reader to be fluent in ISO 3166-1 before they can weigh anything.
  const list = HIGH_TAX_COMPLEXITY_COUNTRIES.map((c) => countryLabel(c)).join(", ");
  const observed = recordedBasis?.observedCountryCode ?? null;
  const whichCountry = observed
    ? `The employment's country is ${countryLabel(observed)}.`
    : "Which country is not recorded on this row — read it from the employment record.";

  return {
    code: "high_tax_compliance_risk",
    label: "jurisdiction on the high-tax-complexity list",
    triggered,
    evaluated: true,
    // The dimension ran; it does not follow that the jurisdiction was assessed.
    // Only a list with an authority behind it could support that claim.
    assessed: false,
    basis: HIGH_TAX_COMPLEXITY_HEURISTIC.basis,
    authority: HIGH_TAX_COMPLEXITY_HEURISTIC.authority,
    provenance: HIGH_TAX_COMPLEXITY_HEURISTIC.provenance,
    requiredForARealVersion: [...HIGH_TAX_COMPLEXITY_HEURISTIC.requiredForARealVersion],
    countriesInScope: [...HIGH_TAX_COMPLEXITY_COUNTRIES],
    observedCountryCode: observed,
    detail: triggered
      ? `⚠ UNSOURCED BASIS. The employment's country is on an invented list (${list}), and that alone raised the ` +
        `signature requirement to three. ${whichCountry} No authority publishes this list and no version or review ` +
        "date exists for it — treat this as an illustration of a jurisdiction risk dimension, not as a finding " +
        "about that country's payroll tax."
      : `⚠ NOT ASSESSED. The employment's country is not on the list (${list}) — which is NOT a finding that its ` +
        `payroll tax is straightforward. ${whichCountry} The list is invented and covers three countries, so a ` +
        "country's absence from it means only that nobody looked, and a genuinely complex jurisdiction outside it " +
        "would collect two signatures rather than three.",
  };
}

// ---------------------------------------------------------------------------
// Who has signed, and who still may
// ---------------------------------------------------------------------------

/**
 * The state of every approval slot, while the row is still open.
 *
 * `blockedApprovers` is the segregation-of-duties rule stated BEFORE it fires
 * rather than only as a 409 afterwards: the people already on this row cannot
 * sign a second slot, and a reader who knows that in advance goes and finds
 * someone else instead of discovering it at submit time.
 */
export function describeApprovalProgress(row) {
  const required = Number.isInteger(row.approvalSlotsRequired) ? row.approvalSlotsRequired : null;

  // Only the roles this adjustment actually needs. A two-signature adjustment
  // that listed payment_releaser as "outstanding" would report a signature that
  // is not required as one that is missing.
  const rolesInScope = required && required >= 3 ? ROLE_ORDER : ROLE_ORDER.slice(0, 2);

  const slots = rolesInScope.map((role) => {
    const slot = row[SLOT_KEY[role]] ?? null;
    return {
      role,
      filled: Boolean(slot),
      approver: slot?.approver ?? null,
      at: slot?.at ?? null,
      note: slot?.note ?? null,
    };
  });

  const filled = slots.filter((s) => s.filled);
  const outstanding = slots.filter((s) => !s.filled).map((s) => s.role);
  const signers = filled.map((s) => s.approver).filter((a) => typeof a === "string" && a.trim());

  // Distinct HUMANS, not filled slots — the same question isFullyApproved() asks,
  // asked the same way (canonicalised comparison), so the two cannot disagree
  // about whether "Bob Smith" and "bob smith" are one person.
  const distinctSigners = signers.reduce((acc, name) => {
    if (!acc.some((seen) => isSameApprover(seen, name))) acc.push(name);
    return acc;
  }, []);

  const statement =
    required === null
      ? "No signature requirement is recorded on this row."
      : outstanding.length === 0
        ? `All ${required} required signature(s) are in.`
        : `${distinctSigners.length} of ${required} required signature(s) recorded` +
          (filled.length
            ? ` (${filled.map((s) => `${roleLabel(s.role)}: ${s.approver ?? "unnamed"}`).join("; ")})`
            : "") +
          `. Still outstanding: ${outstanding.map(roleLabel).join(", ")}.`;

  return {
    slotsRequired: required,
    rolesInScope,
    slots,
    filledCount: filled.length,
    distinctApproverCount: distinctSigners.length,
    outstandingRoles: outstanding,
    // Named, so the constraint is legible before it refuses anyone.
    blockedApprovers: distinctSigners,
    blockedApproversReason:
      distinctSigners.length > 0
        ? "Segregation of duties: nobody listed here may fill a second role on this adjustment. A remaining slot has " +
          "to be signed by someone else."
        : null,
    statement,
  };
}
