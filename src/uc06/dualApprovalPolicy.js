import { isSameApprover, canonicalizeApprover } from "../shared/approverIdentity.js";
// ---------------------------------------------------------------------------
// dualApprovalPolicy.js  —  Which human actions are permitted on an amendment
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same split, same reasoning as src/review/reviewPolicy.js: policyEngine.js
// decided WHETHER an amendment should auto-execute or need approval, once,
// when it was created. This file decides whether ONE approval action is
// permitted RIGHT NOW — a question that gets asked twice per amendment
// (once per required role) and possibly days apart. Pure function, no I/O,
// same as its UC-01 counterpart.
//
// TWO ROLES, TWO OTHER PEOPLE
// UC-06's dual control is two DIFFERENT people on two sides of the
// relationship: the employer's signatory (the `customer_admin` slot) and an
// independent Remote payroll specialist. What can't happen: the SAME role slot
// filled twice, either slot filled by nobody (approver identity required, same
// as UC-01), the SAME approver identity filling BOTH slots — found live while
// driving this flow through `npm run uc06-api`, see docs/BUILD-LOG.md — or,
// since 2026-08-29, EITHER slot filled by the person who FILED the amendment.
// Nothing authenticates `approver` today (it is a free-text field on the
// request body, unlike UC-01's ZAF-signed header), so without these checks one
// person could type their own name into both role fields and single-handedly
// clear a "dual" control that exists specifically to require two people.
//
// SUPERSEDED 2026-08-29 (DRIFT-098 `[A-1]`) — the paragraph that used to stand
// here is kept in summary because it is the argument the defect rested on, and
// a reader who finds only its conclusion will reintroduce it. It said: "Unlike
// UC-01's segregation-of-duties rule ('the requester of a case may not approve
// it'), the admin here IS expected to be one of the two approvers", citing
// docs/use-cases/UC-06.md §5's "Customer Admin approve → Payroll specialist
// approve".
//
// That is not what §5 says. It says *the admin approves*; it does not say *the
// REQUESTING admin*. UC-06.md §8 says the opposite in as many words — "two
// people on two sides of the relationship, and neither of them the person who
// filed the request" — and docs/adr/0005-dual-control-segregation-of-duties.md,
// which exists to argue exactly this, requires "two independent people". So
// slot 1 is the EMPLOYER'S SIGNATURE (Remote's own
// `awaiting_employer_signature` / `employer_signed_at`), filled by the
// company's signing representative, whom src/remoteui/roles.js already models
// as "distinct from the admin USER who operates the console". The requesting
// admin is the console operator. They are not the signatory.
//
// The cost of the old reading was that slot 1 could never disagree with its own
// author: four-eyes degraded to two-eyes plus a reviewer, and UC-06 was the only
// dual-control path in the repository that exempted itself (UC-01 holds
// `self_approval`; UC-09 holds requester ≠ approver ≠ payment_releaser).
//
// UC-06 DIFFERS FROM UC-09 HERE, AND THE DIFFERENCE IS THE DOMAIN, NOT A
// STRICTER MOOD. UC-09's filer owns a slot named `requester` — that slot IS
// their signature — so there the exclusion covers every slot EXCEPT their own.
// UC-06 has no such slot: both of its slots belong to somebody else by
// construction (the employer's signatory, and a Remote-side specialist on the
// far side of the customer relationship), so the filer is excluded from BOTH.
// Do not "align" this with UC-09 by carving out an exemption for
// `customer_admin` — that carve-out is the defect, restated.
// ---------------------------------------------------------------------------

import { attribution, noteClause, remoteWriteClause } from "../shared/settledDecision.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
// The one definition of the "no session was present" marker the workflows
// write into `requester`. Imported rather than re-spelled, because a second
// copy of a sentinel is a second thing to keep in step, and the guard below
// turns on recognising it.
import { UNAUTHENTICATED } from "../shared/requesterSubject.js";

export const ROLES = new Set(["customer_admin", "payroll_specialist"]);

// THE NEGATIVE VERB IS `decline` (renamed 2026-08-19, docs/BUILD-LOG.md §3.61).
// `deny` occurs zero times in Remote's documented corpus. `deny` is still
// accepted on input for the installed ZAF bundle — see
// src/shared/declineVocabulary.js — and normalised once at workflow.js's entry.
//
// THESE TWO STATUSES ARE OURS AND ARE NOT MAPPED ONTO ContractAmendmentStatus.
// That enum tracks REMOTE'S review of an amendment; claiming our `approved` is
// their `done` would assert the contract had been amended when only a slot had
// been signed. Our `declined` is a decision about our own approval workflow.
export const ACTIONS = new Set(["approve", "decline"]);

export const REFUSALS = {
  amendment_not_found: { status: 404, reason: "No amendment exists with this id." },
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_role: { status: 400, reason: "role must be 'customer_admin' or 'payroll_specialist'." },
  unknown_action: { status: 400, reason: "action must be 'approve' or 'decline'." },
  not_awaiting_approval: { status: 403, reason: "This amendment was routed to escalation, not dual approval — it has no approve/decline path here." },
  already_decided: { status: 409, reason: "This amendment has already been executed or declined." },
  // ^ THE GENERIC FORM, and it is a fallback rather than the normal answer.
  //   describeSettled() below builds the specific one from the row. "executed
  //   or declined" is a list of two when `status`, `adminApproval`,
  //   `payrollApproval`, `declinedBy`, `executedAt` and `remoteResult` between
  //   them name which, who signed each slot, when, why, and whether the
  //   PUT to Remote actually landed — which on a contract amendment is the
  //   difference between the contract having changed and only the record of it
  //   having changed. See src/shared/settledDecision.js.
  execution_in_progress: {
    status: 409,
    reason: "This amendment is being applied right now by another approval, or a previous attempt is unresolved.",
  },
  same_person_cannot_fill_both_roles: {
    status: 409,
    reason: "The other approval slot is already filled by this same person. Dual approval requires two different people.",
  },
  // DRIFT-098 `[A-1]`. Deliberately NOT folded into
  // `same_person_cannot_fill_both_roles`: that one means "you already signed
  // the OTHER slot on this amendment" and is fixed by finding a second person;
  // this one means "you are the person who ASKED for the change" and is fixed
  // by finding a DIFFERENT second person. Two problems, two remedies —
  // collapsing them sends whoever triages the audit row after the wrong one,
  // the same reason `approver_entitlement_not_configured` is kept apart from
  // `approver_not_entitled`. The name and the 409 are pinned by
  // qa/contracts/UC-06-acceptance.md §6/§7 (`[A-1]`), which is why this is not
  // spelled `requester_cannot_approve_own_amendment` to rhyme with UC-09's
  // `requester_cannot_approve_own_adjustment`.
  requester_cannot_approve: {
    status: 409,
    reason:
      "The person who filed this amendment cannot approve it. Slot 1 is the employer's signature, filled by the " +
      "company's signing representative, and slot 2 is a Remote payroll specialist — dual control requires two " +
      "people who are neither of them the requester.",
  },
  role_already_approved: { status: 409, reason: "This role has already approved this amendment." },
  same_approver_both_roles: {
    status: 409,
    reason: "The other role on this amendment was already approved by this same approver identity — dual control requires two different people.",
  },
  employment_no_longer_active: {
    status: 409,
    reason: "The employment record is no longer active. Re-run the amendment rather than approving it.",
  },
};

/**
 * Is this AMENDMENT open to a human decision at all? Split out so a UI can
 * ask "should I show approve/decline controls?" without needing a fake approver
 * identity to ask with — same reasoning as evaluateCaseActionability().
 * @param {object} args
 * @param {object|null} args.amendmentRow
 */
export function evaluateAmendmentActionability({ amendmentRow }) {
  if (!amendmentRow) return refuse("amendment_not_found");
  if (amendmentRow.decision !== "dual_approval_required") return refuse("not_awaiting_approval");
  // "executing" is the F-09 execution claim, not a decision — say so rather
  // than reporting it as "already executed or declined", which would send an
  // operator looking for a completed write that may not exist.
  if (amendmentRow.status === "executing") return refuse("execution_in_progress");
  if (amendmentRow.status !== "pending_dual_approval") {
    return refuse("already_decided", { reason: describeSettled(amendmentRow) });
  }
  return { allowed: true, code: "actionable", status: 200, reason: "Awaiting dual approval." };
}

/**
 * Decide whether `approver` may take `action` as `role` on this amendment
 * right now.
 * @param {object} args
 * @param {object|null} args.amendmentRow
 * @param {"customer_admin"|"payroll_specialist"} args.role
 * @param {string|null} args.approver
 * @param {"approve"|"decline"} args.action
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST — see the
 *   comment at the bottom of this function. Absent means not enforced here,
 *   which is the seeded-demo posture; it is never a way to grant anything.
 */
export function evaluateApprovalAction({ amendmentRow, role, approver, action, entitlement = null }) {
  if (!approver || typeof approver !== "string" || !approver.trim()) {
    return refuse("approver_required");
  }
  if (!ROLES.has(role)) return refuse("unknown_role");
  if (!ACTIONS.has(action)) return refuse("unknown_action");

  const actionability = evaluateAmendmentActionability({ amendmentRow });
  if (!actionability.allowed) return actionability;

  if (action === "approve") {
    const existingSlot = role === "customer_admin" ? amendmentRow.adminApproval : amendmentRow.payrollApproval;
    if (existingSlot) return refuse("role_already_approved");

    // SEGREGATION OF DUTIES. This check did not exist, and its absence made the
    // dual-approval control decorative: an authorized penetration test approved
    // as customer_admin and then as payroll_specialist under one identity, and
    // the real Remote write fired with a single human behind it. Two approvals
    // are only a control if they come from two PEOPLE — comparing roles alone
    // counts signatures, not signatories.
    //
    // Identity comparison is delegated to shared/approverIdentity.js rather than
    // done with === here, because the same test also walked past an exact-match
    // check using nothing more exotic than a trailing space and a capital
    // letter. That module is the single definition of "a different human" for
    // both this use case and UC-09.
    const otherSlot = role === "customer_admin" ? amendmentRow.payrollApproval : amendmentRow.adminApproval;
    if (otherSlot && isSameApprover(otherSlot.approver, approver)) {
      return refuse("same_person_cannot_fill_both_roles");
    }

    // THE PERSON WHO FILED IT MAY SIGN NEITHER SLOT.
    //
    // DRIFT-098 `[A-1]`. Until this block, segregation of duties was enforced
    // only ACROSS THE TWO APPROVAL SLOTS — `adminApproval` against
    // `payrollApproval` above — and `amendmentRow.requester`, the column
    // recording WHO ASKED FOR THE CHANGE, was captured
    // (src/uc06/workflow.js), given its own column (src/uc06/amendmentStore.js)
    // and never compared to anything. So the admin who typed the new salary
    // could sign the slot confirming they typed it, and every existing control
    // still reported satisfied: two roles, two names, one of which belonged to
    // the author of the change.
    //
    // BOTH SLOTS, not all-but-one. See the header: UC-09's filer owns the
    // `requester` slot and is excluded from the other two; UC-06's filer owns
    // no slot at all, because slot 1 is the employer's SIGNATORY (a different
    // person from the console operator who filed) and slot 2 is Remote-side.
    // UC-06.md §8: "neither of them the person who filed the request".
    //
    // `unauthenticated` is skipped explicitly. It is a real recorded value with
    // a real meaning — the workflow writes that literal string when no session
    // was present, which is the EXPECTED state on the Zendesk intake path (a
    // ticket carries an authenticated person, not an authenticated
    // company-admin session) — but it names nobody. Comparing it would refuse
    // an approver whose free-text identity happened to be that word, and would
    // still exclude no actual human. A row that cannot say who filed it cannot
    // have this guard applied to it; that is a gap in the record, and the
    // remedy is upstream, not a refusal invented here.
    //
    // Identity goes through isSameApprover() rather than ===, for the same
    // reason the slot comparison above does: an exact string compare answers
    // "are these the same bytes", which is only the same question as "is this
    // the same person" when nobody is trying. A pen test walked past an
    // exact-match check with a trailing space and a capital letter.
    //
    // IT CAN ONLY EVER REFUSE. There is no branch here that fills a slot,
    // counts as an approval, or relaxes the pair requirement — like the
    // entitlement check below, it has no return value meaning yes.
    // canonicalizeApprover() on the sentinel too, so " Unauthenticated " is
    // recognised as the marker rather than treated as somebody's name — the
    // same canonicalisation isSameApprover() applies to the comparison itself.
    const filer = canonicalizeApprover(amendmentRow.requester);
    if (filer !== UNAUTHENTICATED && isSameApprover(amendmentRow.requester, approver)) {
      return refuse("requester_cannot_approve");
    }
  }

  // ENTITLEMENT IS CONSULTED LAST, AND ONLY EVER REFUSES.
  //
  // Everything above answers "is this amendment open to this action right now",
  // and it answers it identically whether or not entitlement is enforced. This
  // asks the one question none of it asked: `role` arrived in the request body
  // and the ZAF token carries no role claim, so until this line the dual
  // control required two different PEOPLE and never an ENTITLED one — two
  // support agents could clear a payroll amendment (docs/APPROVAL-ROUTING.md
  // §1.3).
  //
  // Placed here, after every existing refusal, for two reasons. It must not be
  // able to mask a more specific refusal with a vaguer one. And it must be
  // structurally incapable of turning a refusal INTO an approval: check()
  // returns a refusal or `null`, `null` falls through to the same `allowed`
  // object this function already returned, and no earlier `return refuse(...)`
  // is reachable from here. It applies to `decline` as well as `approve` —
  // a decline ends the amendment for both roles, so claiming a role you do not
  // hold is the same defect whichever verb follows it.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-06", role, approver });
    if (denial) return denial;
  }

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action} as ${role}.` };
}

/**
 * A settled amendment, described by what actually happened to it.
 *
 * BOTH SIGNATURES ARE NAMED, not just the fact that two were collected. Dual
 * control exists to require two PEOPLE (see the segregation-of-duties check
 * above), so "who" is two answers here, and a reader auditing a dual-approval
 * decision needs both of them — a sentence saying "already executed" hides
 * exactly the thing the control is for.
 *
 * THE REMOTE CLAUSE IS THE LOAD-BEARING ONE. `remoteResult` is written only
 * after the amendment PUT returns. Two humans agreeing and Remote accepting the
 * change are different facts, and on a contract amendment the difference is
 * whether the employee's terms actually changed.
 *
 * Falls back to the generic sentence for a row that cannot say which outcome it
 * got — an honest "we cannot say" beats a guess.
 */
export function describeSettled(amendmentRow) {
  const row = amendmentRow ?? {};

  // canonicalDecisionStatus() so a row stored as `denied` before the rename
  // gets this sentence rather than the generic "executed or declined" fallback.
  if (canonicalDecisionStatus(row.status) === "declined") {
    // BOTH FIELD NAMES. `declinedBy` is what the store produces now (the
    // Postgres column is still `denied_by`, aliased on read); `deniedBy` is
    // what an in-memory row written before 2026-08-19, or a response from a
    // deployment that has not been redeployed, still carries. Reading only
    // one would drop the approver's name and reason off a real decision.
    const declined = row.declinedBy ?? row.deniedBy ?? {};
    const who = declined.role ? `${declined.approver ?? "an unnamed approver"} (${declined.role})` : declined.approver;
    const by = attribution(who, declined.at);
    const note = noteClause(declined.note, {
      label: "Reason given",
      expected: true,
      missing: "No reason was recorded, which a decline is supposed to carry.",
    });
    return (
      `Already DECLINED${by}.${note} A decline ends the amendment for both roles — the other slot is not asked` +
      " and the request has to be filed again."
    );
  }

  if (row.status === "executed" || row.executedAt) {
    const admin = row.adminApproval ?? null;
    const payroll = row.payrollApproval ?? null;
    const signatures =
      admin || payroll
        ? ` Approved by ${describeSlot("Customer Admin", admin)} and ${describeSlot("Payroll Specialist", payroll)}.`
        : "";
    const wrote = remoteWriteClause(row.remoteResult, {
      landed: "The amendment was applied at Remote.",
      artifact: "the amended contract",
    });
    return `Already EXECUTED${attribution(null, row.executedAt)}.${signatures}${wrote} It cannot be approved or declined again.`;
  }

  return REFUSALS.already_decided.reason;
}

/** One approval slot as a phrase — never a name this file invented. */
function describeSlot(label, slot) {
  if (!slot) return `${label} (no signature recorded)`;
  const who = String(slot.approver ?? "").trim() || "an unnamed approver";
  return `${label} ${who}${slot.at ? ` on ${slot.at}` : ""}`;
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
