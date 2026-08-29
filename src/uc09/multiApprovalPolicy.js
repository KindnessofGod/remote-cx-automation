import { isSameApprover, countDistinctApprovers } from "../shared/approverIdentity.js";
import { attribution, noteClause, remoteWriteClause, gateClause } from "../shared/settledDecision.js";
import { describeDecidingGate } from "./policyEngine.js";
// ---------------------------------------------------------------------------
// multiApprovalPolicy.js  —  N-role approval policy for UC-09 (requester + approver + releaser)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Extends UC-06's dual approval pattern to support N roles (specifically 2-3).
// UC-09 requires at least 2 approvals (requester + approver) but may require
// 3 (requester + approver + payment_releaser) for high-risk cases. The key
// invariant: AI never executes alone (floor is always >= 2), risk only
// increases the count above this floor, never decreases it below.
// ---------------------------------------------------------------------------

export const ROLES = new Set(["requester", "approver", "payment_releaser"]);

export const REFUSALS = {
  adjustment_not_found: { status: 404, reason: "No adjustment exists with this id." },
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_role: { status: 400, reason: "Role must be 'requester', 'approver', or 'payment_releaser'." },
  unknown_action: { status: 400, reason: "Action must be 'approve' or 'deny'." },
  // DRIFT-050. Deliberately NOT folded into
  // `same_person_cannot_fill_multiple_roles`: that one means "you already
  // signed a different slot on this adjustment" and is fixed by finding a
  // second person, this one means "you are the person who asked for the money"
  // and is fixed by finding a DIFFERENT second person. Two problems, two
  // remedies — collapsing them sends whoever reads the audit row after the
  // wrong one, the same reason `approver_entitlement_not_configured` is kept
  // apart from `approver_not_entitled`.
  requester_cannot_approve_own_adjustment: {
    status: 403,
    reason:
      "The person who requested this adjustment cannot also approve it. They may sign the requester slot, " +
      "which is their own confirmation of the request; every other slot needs somebody else.",
  },
  not_awaiting_approval: { 
    status: 403, 
    reason: "This adjustment was routed to escalation, not approval — it has no approve/deny path here." 
  },
  already_decided: { status: 409, reason: "This adjustment has already been executed or denied." },
  // ^ and `not_awaiting_approval` above are the GENERIC forms, and both are
  //   fallbacks rather than the normal answer. describeSettled() and
  //   describeNoApprovalPath() below build the specific one from the row.
  //   On the one use case in this repo that really moves money, "executed or
  //   denied" is the worst possible place for a list of two: `status`,
  //   `requesterApproval`/`approverApproval`/`paymentReleaserApproval`,
  //   `deniedBy`, `executedAt` and `remoteResult` between them name which,
  //   who signed each slot, when, why, and — the one that actually matters —
  //   whether the payment write reached Remote. See
  //   src/shared/settledDecision.js.
  execution_in_progress: {
    status: 409,
    reason: "This adjustment is being executed right now by another approval, or a previous attempt is unresolved.",
  },
  role_already_approved: { status: 409, reason: "This role has already approved this adjustment." },
  same_person_cannot_fill_multiple_roles: { 
    status: 409, 
    reason: "The same person cannot fill multiple approval roles (segregation of duties)." 
  },
  insufficient_approvals_for_execution: { 
    status: 409, 
    reason: "Insufficient approvals for execution - this adjustment requires more approval slots to be filled." 
  },
  employment_no_longer_active: {
    status: 409,
    reason: "The employment record is no longer active. Re-run the adjustment rather than approving it.",
  },
};

/**
 * Is this ADJUSTMENT open to a human decision at all? Split out so a UI can
 * ask "should I show approve/deny controls?" without needing a fake approver
 * identity to ask with — same reasoning as evaluateCaseActionability().
 * @param {object} args
 * @param {object|null} args.adjustmentRow
 */
export function evaluateAdjustmentActionability({ adjustmentRow }) {
  if (!adjustmentRow) return refuse("adjustment_not_found");
  if (!adjustmentRow.decision.includes("approval_required")) {
    return refuse("not_awaiting_approval", { reason: describeNoApprovalPath(adjustmentRow) });
  }
  // "executing" is the F-09 execution claim, not a decision — see the twin
  // comment in uc06/dualApprovalPolicy.js.
  if (adjustmentRow.status === "executing") return refuse("execution_in_progress");
  if (adjustmentRow.status !== "pending_approval") {
    return refuse("already_decided", { reason: describeSettled(adjustmentRow) });
  }
  return { allowed: true, code: "actionable", status: 200, reason: "Awaiting approval." };
}

/**
 * Decide whether `approver` may take `action` as `role` on this adjustment
 * right now.
 * @param {object} args
 * @param {object|null} args.adjustmentRow
 * @param {"requester"|"approver"|"payment_releaser"} args.role
 * @param {string|null} args.approver
 * @param {"approve"|"deny"} args.action
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST — see the
 *   comment at the bottom of this function.
 */
export function evaluateApprovalAction({ adjustmentRow, role, approver, action, entitlement = null }) {
  if (!approver || typeof approver !== "string" || !approver.trim()) {
    return refuse("approver_required");
  }
  if (!ROLES.has(role)) return refuse("unknown_role");
  if (action !== "approve" && action !== "deny") return refuse("unknown_action");

  const actionability = evaluateAdjustmentActionability({ adjustmentRow });
  if (!actionability.allowed) return actionability;

  if (action === "approve") {
    // Check if this role has already approved
    const existingSlot = getApprovalSlot(adjustmentRow, role);
    if (existingSlot) return refuse("role_already_approved");
    
    // Check segregation of duties: same person can't fill multiple roles
    const allApprovals = [
      adjustmentRow.requesterApproval,
      adjustmentRow.approverApproval,
      adjustmentRow.paymentReleaserApproval
    ].filter(approval => approval);

    // Identity comparison is delegated to shared/approverIdentity.js. This was
    // `approval.approver === approver`, and an authorized penetration test
    // filled all three slots on a real payment as one human using nothing more
    // than "Bob Smith" / "bob smith" / "BOB SMITH". An exact string comparison
    // does not answer "is this the same person"; it answers "are these the same
    // bytes", and those are only the same question when nobody is trying.
    for (const approval of allApprovals) {
      if (isSameApprover(approval.approver, approver)) {
        return refuse("same_person_cannot_fill_multiple_roles");
      }
    }

    // THE PERSON WHO FILED IT MAY SIGN THE REQUESTER SLOT AND NOTHING ELSE.
    //
    // DRIFT-050. Until this block, segregation of duties was enforced only
    // ACROSS THE THREE APPROVAL SLOTS — `allApprovals` above is built from
    // requesterApproval / approverApproval / paymentReleaserApproval, and
    // `adjustmentRow.requester`, the column recording WHO ASKED FOR THE MONEY,
    // was never compared to anything. So the filer could walk up to their own
    // request and sign it off as `approver` or `payment_releaser`, and the
    // floor of two was still satisfied — two slots, two names, one of which
    // belonged to the person the payment was for.
    //
    // This is the only use case in the repository that moves real money
    // (submitAdjustmentApproval -> remote.createIncentive), which is why it is
    // the slot that mattered least to get right by accident and most to get
    // right on purpose.
    //
    // WHY IT IS ITS OWN REFUSAL CODE, and deliberately NOT
    // `same_person_cannot_fill_multiple_roles`: those are two different
    // afternoons of work for whoever reads the audit row. That code means "you
    // already signed another slot" and is fixed by a second person; this one
    // means "you cannot approve your own request" and is fixed by a DIFFERENT
    // second person. Collapsing them would send the reader after the wrong
    // remedy, the same reason `approver_entitlement_not_configured` is not
    // `approver_not_entitled`.
    //
    // Identity comparison goes through isSameApprover() for the same reason the
    // loop above does: an exact string compare answers "are these the same
    // bytes", which is only the same question as "is this the same person" when
    // nobody is trying. A pen test filled all three slots as
    // "Bob Smith" / "bob smith" / "BOB SMITH".
    //
    // It can only ever REFUSE. There is no branch here that fills a slot,
    // counts as an approval, or lowers the floor — like the entitlement check
    // below, it has no return value meaning yes.
    if (role !== "requester" && isSameApprover(adjustmentRow.requester, approver)) {
      return refuse("requester_cannot_approve_own_adjustment");
    }
  }

  // ENTITLEMENT IS CONSULTED LAST, AND ONLY EVER REFUSES.
  //
  // This is the payment path — submitAdjustmentApproval() calls
  // remote.createIncentive() once isFullyApproved() is satisfied — and until
  // this line `role` was a string in the request body while the ZAF token
  // carried no role claim at all. The floor of two held (Math.max(2, …), and
  // isSameApprover() across every filled slot), so two different PEOPLE were
  // genuinely required; neither of them had to be entitled to the slot they
  // filled. See docs/APPROVAL-ROUTING.md §1.3.
  //
  // NOTHING ABOUT THE FLOOR IS TOUCHED HERE. check() returns a refusal or
  // `null`; it cannot fill a slot, count as an approval, or lower
  // approvalSlotsRequired, because it has no return value that means yes. It
  // runs after every existing refusal so it can never mask a more specific one,
  // and it covers `deny` as well as `approve` — claiming a role you do not hold
  // is the same defect whichever verb follows it.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-09", role, approver });
    if (denial) return denial;
  }

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action} as ${role}.` };
}

/**
 * Check if the adjustment has enough approvals to execute
 * @param {object} adjustmentRow
 * @returns {boolean}
 */
export function isFullyApproved(adjustmentRow) {
  // Count DISTINCT HUMANS, not filled slots. Three slots signed by one person
  // is one pair of eyes, and this function is the last thing standing between
  // that and a real disbursement.
  const approvers = [
    adjustmentRow.requesterApproval,
    adjustmentRow.approverApproval,
    adjustmentRow.paymentReleaserApproval,
  ].filter(Boolean).map((a) => a.approver);

  const filledCount = approvers.length;
  const distinctHumans = countDistinctApprovers(approvers);

  // `filledCount >= adjustmentRow.approvalSlotsRequired` evaluated `1 >= null`
  // as TRUE, because JavaScript coerces null to 0 in a relational comparison.
  // `approval_slots_required` is a nullable column, so any row where it was not
  // set — a partially-migrated table, a hand-inserted row, a store that forgot
  // the field — executed a payment on a single approval. A missing requirement
  // must never read as a satisfied requirement, so anything that is not a
  // usable integer falls back to the floor of two rather than to zero.
  // A ROW THAT SAYS triple_approval_required MUST NOT EXECUTE ON TWO.
  // `approvalSlotsRequired` is not coerced by normalizeRow(), so a null column
  // or a pg driver handing back the string "3" both failed Number.isInteger and
  // fell to the FLOOR of 2 — silently releasing a payment one signature short
  // while the row's own `decision` field still read triple_approval_required.
  // The floor is still a floor; it just no longer overrides a stated higher
  // requirement, and the decision text is consulted as a last resort.
  const statedSlots = Number(adjustmentRow.approvalSlotsRequired);
  const slotsFromDecision =
    String(adjustmentRow.decision ?? "").includes("triple_approval") ? 3 : 2;
  const required = Number.isFinite(statedSlots) && Number.isInteger(statedSlots)
    ? Math.max(2, statedSlots)
    : Math.max(2, slotsFromDecision);

  // DISTINCT HUMANS MUST MEET THE REQUIREMENT, NOT A FLOOR OF TWO BELOW IT.
  // This was `distinctHumans >= Math.min(required, 2)`, which on a high-risk
  // adjustment requiring THREE approvals asked only for two distinct people —
  // so three filled slots signed by two humans executed a payment that had been
  // scored as needing a third pair of eyes. The approve path cannot produce
  // that combination on its own (evaluateApprovalAction refuses
  // same_person_cannot_fill_multiple_roles, using this same canonicalisation),
  // but the approve path is not the only way slots get filled: this function's
  // own `filledCount >= null` comment is there precisely because rows arrive
  // from migrations, hand-inserts and stores that forgot a field, and it is the
  // last thing standing between those rows and a real disbursement. It must not
  // relax a requirement it was given.
  return filledCount >= required && distinctHumans >= required;
}

/**
 * Get the approval slot for a specific role
 * @param {object} adjustmentRow
 * @param {string} role
 * @returns {object|null} approval object or null
 */
function getApprovalSlot(adjustmentRow, role) {
  switch (role) {
    case "requester":
      return adjustmentRow.requesterApproval;
    case "approver":
      return adjustmentRow.approverApproval;
    case "payment_releaser":
      return adjustmentRow.paymentReleaserApproval;
    default:
      return null;
  }
}

/**
 * A settled adjustment, described by what actually happened to it.
 *
 * WHETHER THE MONEY MOVED IS THE WHOLE QUESTION, and it is a different fact
 * from whether the humans agreed. `remoteResult` is written only after the
 * incentive POST returns, so an `executed` row with no result recorded is
 * exactly the state a reader must not mistake for a completed payment. Every
 * signature is named too: the floor of two exists to require two people, and a
 * sentence saying "already executed" hides the thing the floor is for.
 *
 * Falls back to the generic sentence for a row that cannot say which outcome it
 * got — an honest "we cannot say" beats a guess.
 */
export function describeSettled(adjustmentRow) {
  const row = adjustmentRow ?? {};

  if (row.status === "denied") {
    const denied = row.deniedBy ?? {};
    const who = denied.role ? `${denied.approver ?? "an unnamed approver"} (${denied.role})` : denied.approver;
    const by = attribution(who, denied.at);
    const note = noteClause(denied.note, {
      label: "Reason given",
      expected: true,
      missing: "No reason was recorded, which a denial is supposed to carry.",
    });
    return (
      `Already DENIED${by}.${note} A denial ends the adjustment for every role — no payment was made and the` +
      " request has to be filed again."
    );
  }

  if (row.status === "executed" || row.executedAt) {
    const wrote = remoteWriteClause(row.remoteResult, {
      landed: "The off-cycle payment was created at Remote.",
      artifact: "the payment",
    });
    return (
      `Already EXECUTED${attribution(null, row.executedAt)}.${describeSignatures(row)}${wrote}` +
      " It cannot be approved or denied again."
    );
  }

  return REFUSALS.already_decided.reason;
}

/** The filled approval slots, named. Never counts a slot it cannot see. */
function describeSignatures(row) {
  const slots = [
    ["requester", row.requesterApproval],
    ["approver", row.approverApproval],
    ["payment_releaser", row.paymentReleaserApproval],
  ].filter(([, slot]) => Boolean(slot));
  if (!slots.length) return " No approval slots are recorded on the row.";
  const named = slots
    .map(([role, slot]) => `${role} ${String(slot.approver ?? "").trim() || "an unnamed approver"}${slot.at ? ` on ${slot.at}` : ""}`)
    .join("; ");
  return ` Signed by ${named} (${slots.length} of ${row.approvalSlotsRequired ?? slots.length} required).`;
}

/**
 * An adjustment that never opened an approval path, described by the gate it
 * stopped at and what that gate's refusal MEANT — reusing the per-reason
 * `means` published beside UC-09's own gates rather than restating gate
 * semantics here.
 *
 * This is also the state that produced the "0 approvals required" reading the
 * portal had to correct: no approval path opened is the OPPOSITE of the floor
 * being lowered, and the sentence says so.
 */
export function describeNoApprovalPath(adjustmentRow) {
  const row = adjustmentRow ?? {};
  const gate = gateClause(describeDecidingGate, row.reason);
  if (row.decision === "escalate") {
    return (
      `This adjustment was ESCALATED${gate.at}, so no approval path was ever opened.${gate.means}` +
      " There is no route from here to a payment — the floor of two approvals is not lowered, it is never reached."
    );
  }
  return REFUSALS.not_awaiting_approval.reason;
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}