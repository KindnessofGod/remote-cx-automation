// ---------------------------------------------------------------------------
// signoffPolicy.js  —  Whether a sign-off/decline action is permitted now
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same split, same reasoning as src/review/reviewPolicy.js and
// src/uc06/dualApprovalPolicy.js: policyEngine.js decided whether a
// resignation REPORT should be HITL-prepared, once, when it was created.
// This file decides whether ONE HR Ops action (sign off or decline) is
// permitted RIGHT NOW — a question that gets asked possibly days after the
// report was prepared. Pure function, no I/O, same as its UC-01/UC-06
// counterparts.
//
// SINGLE APPROVER, NOT DUAL
// UC-05 is 🟡 with a single HR Ops sign-off (UC-05.md §1: "HR Ops verifies
// + submits"). It is NOT UC-06's dual-control flow — no money is moving,
// no contract terms are changing. The original sign-off is a verification
// step on a calculation, not an authorisation of a write to a real
// Remote endpoint (the spec confirms no such endpoint exists). One
// approver identity is required; the requester is not barred from signing
// off (in a single-employer scenario, the same HR Ops who prepared a draft
// of the calculation can also sign it off — the segregation-of-duties
// concern only applies when the action is irreversible, which a
// discrepancy report is not).
// ---------------------------------------------------------------------------

import { attribution, noteClause, gateClause } from "../shared/settledDecision.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { describeDecidingGate } from "./policyEngine.js";
import { UC05_ROLE } from "../review/approverEntitlement.js";

// THE POSITIVE VERB STAYS `signoff`; ONLY THE NEGATIVE ONE MOVED (2026-08-19).
// `deny` -> `decline`, because `deny` appears zero times in Remote's corpus
// and `declined` is a member of four of its enums (docs/REMOTE-VOCABULARY.md
// §2.1). `signoff` is deliberately NOT renamed to Remote's `validate`: that
// word already means JSON-Schema validation everywhere in this repository
// (src/shared/schemaValidator.js), so adopting it for a human approval would
// create a collision INSIDE our own codebase to fix one with Remote's — the
// vocabulary audit's own §7 recommendation. `deny` is still accepted on input;
// see src/shared/declineVocabulary.js and workflow.js's entry point.
export const ACTIONS = new Set(["signoff", "decline"]);

export const REFUSALS = {
  resignation_not_found: { status: 404, reason: "No resignation exists with this id." },
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_action: { status: 400, reason: "action must be 'signoff' or 'decline'." },
  not_awaiting_signoff: { status: 403, reason: "This resignation was escalated, not prepared for sign-off — it has no sign-off path here." },
  already_decided: { status: 409, reason: "This resignation has already been signed off or declined." },
  // ^ and the line above it are the GENERIC forms, and both are fallbacks
  //   rather than the normal answer. describeSettled() and
  //   describeNoSignoffPath() below build the specific one from the row:
  //   "signed off or declined" is a list of two when `status`, `signedOffBy`
  //   and `declinedBy` name which, who, when and why, and the escalation
  //   names no gate when `reason` places one. Same defect
  //   src/uc02/reviewPolicy.js fixed one use case over — see
  //   src/shared/settledDecision.js.
  employment_no_longer_active: {
    status: 409,
    reason: "The employment record is no longer active. Re-run the resignation rather than signing off the old report.",
  },
};

/**
 * Is this RESIGNATION open to a human sign-off at all? Split out so a UI
 * can ask "should I show a sign-off button?" without needing a fake approver
 * identity to ask with — same reasoning as evaluateCaseActionability() and
 * evaluateAmendmentActionability().
 * @param {object} args
 * @param {object|null} args.resignationRow
 */
export function evaluateResignationActionability({ resignationRow }) {
  if (!resignationRow) return refuse("resignation_not_found");
  if (resignationRow.decision !== "prepared_for_signoff") {
    return refuse("not_awaiting_signoff", { reason: describeNoSignoffPath(resignationRow) });
  }
  if (resignationRow.status !== "pending_signoff") {
    return refuse("already_decided", { reason: describeSettled(resignationRow) });
  }
  return { allowed: true, code: "actionable", status: 200, reason: "Awaiting HR Ops sign-off." };
}

/**
 * Decide whether `approver` may take `action` on this resignation right now.
 * @param {object} args
 * @param {object|null} args.resignationRow
 * @param {string|null} args.approver
 * @param {"signoff"|"decline"} args.action
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST.
 */
export function evaluateSignoffAction({ resignationRow, approver, action, entitlement = null }) {
  if (!approver || typeof approver !== "string" || !approver.trim()) {
    return refuse("approver_required");
  }
  if (!ACTIONS.has(action)) return refuse("unknown_action");

  const actionability = evaluateResignationActionability({ resignationRow });
  if (!actionability.allowed) return actionability;

  // ENTITLEMENT IS CONSULTED LAST, AND ONLY EVER REFUSES.
  //
  // Like UC-04, this use case has no `role` parameter, so until this line any
  // named identity could sign off an HR Ops report. The role is NOMINAL —
  // `hr_ops`, named once in src/review/approverEntitlement.js and passed here
  // as a constant, never read off the request. Note that UC-05 deliberately
  // does NOT bar the preparer from signing off (see this file's header); this
  // adds nothing to that argument either way. It asks only whether the person
  // signing is HR Ops at all, which nothing asked before.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-05", role: UC05_ROLE, approver });
    if (denial) return denial;
  }

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action}.` };
}

/**
 * A settled resignation, described by what actually happened to it.
 *
 * THERE IS NO REMOTE-WRITE CLAUSE HERE, AND THAT IS NOT AN OMISSION. UC-05 has
 * no execution endpoint — the spec confirms none exists, so the signed-off
 * report IS the durable artifact (see this file's header). There is no second
 * fact about whether a write landed, because there is no write. Saying nothing
 * is correct; borrowing UC-04's clause would invent a doubt about something
 * that was never attempted.
 *
 * Falls back to the generic sentence for a row that cannot say which outcome it
 * got — an honest "we cannot say" beats a guess.
 */
export function describeSettled(resignationRow) {
  const row = resignationRow ?? {};

  if (row.status === "signed_off") {
    const slot = row.signedOffBy ?? {};
    const by = attribution(slot.approver, slot.at ?? row.signedOffAt);
    const note = noteClause(slot.note ?? row.signedOffNote);
    return (
      `Already SIGNED OFF${by}.${note} The signed-off notice report is the durable artifact — UC-05 has no` +
      " Remote write behind it — and it cannot be signed off or declined again."
    );
  }

  // canonicalDecisionStatus() so a row stored as `denied` before the rename
  // still gets its own specific sentence instead of the generic fallback.
  if (canonicalDecisionStatus(row.status) === "declined") {
    // BOTH FIELD NAMES. `declinedBy` is what the store produces now (the
    // Postgres column is still `denied_by`, aliased on read); `deniedBy` is
    // what an in-memory row written before 2026-08-19, or a response from a
    // deployment that has not been redeployed, still carries. Reading only
    // one would drop the approver's name and reason off a real decision.
    const declined = row.declinedBy ?? row.deniedBy ?? {};
    const by = attribution(declined.approver, declined.at);
    const note = noteClause(declined.note, {
      label: "Reason given",
      expected: true,
      missing: "No reason was recorded, which a decline is supposed to carry.",
    });
    return `Already DECLINED${by}.${note} A declined resignation report cannot be re-decided here — it has to be re-run.`;
  }

  return REFUSALS.already_decided.reason;
}

/**
 * A resignation that never reached HR Ops, described by the gate it stopped at
 * and what that gate's refusal MEANT — reusing the per-reason `means` published
 * beside UC-05's own gates rather than restating gate semantics here.
 */
export function describeNoSignoffPath(resignationRow) {
  const row = resignationRow ?? {};
  const gate = gateClause(describeDecidingGate, row.reason);
  if (row.decision === "escalate") {
    return (
      `This resignation was ESCALATED${gate.at}, not prepared for sign-off.${gate.means}` +
      " It has no sign-off path here; the escalation is worked on its own ticket."
    );
  }
  return REFUSALS.not_awaiting_signoff.reason;
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
