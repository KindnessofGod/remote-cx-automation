// ---------------------------------------------------------------------------
// approvalPolicy.js  —  Which human actions are permitted on an authorization
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same split, same reasoning as src/review/reviewPolicy.js and
// src/uc06/dualApprovalPolicy.js: policyEngine.js decided WHETHER an
// authorization should need approval (once, when it was created). This file
// decides whether ONE approval action is permitted RIGHT NOW — a question
// that gets asked once per authorization and possibly days after creation.
// Pure function, no I/O, same as its UC-01 / UC-06 counterparts.
//
// ONE ROLE, NOT TWO
// UC-04 is 🟡 HITL with a single mobility specialist approving, not UC-06's
// dual control. UC-04.md §1/§8 names "mobility specialist" as the approver,
// and the research file's HITL Workspace section makes a single-specialist
// model explicit (the Tier-2 escalation is what kicks in for high-risk
// pairs, not a second slot). So unlike dualApprovalPolicy.js, this module
// is one role, one slot, fill once. The same kind of identity-required
// rules still apply — an approver must be named, an action must be one of
// the recognized verbs, the case must still be open to approval at all.
// ---------------------------------------------------------------------------

import { humanTime, remoteWriteClause, gateClause, unpunctuated } from "../shared/settledDecision.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { describeDecidingGate } from "./policyEngine.js";
import { UC04_ROLE } from "../review/approverEntitlement.js";

// THE NEGATIVE VERB IS `decline`, NOT `deny` (renamed 2026-08-19).
// `deny` appears zero times in Remote's documented corpus; the enum this use
// case's own record carries is `declined_by_manager` (docs/REMOTE-VOCABULARY.md
// §2.1 / §5.5). `deny` is still ACCEPTED on input — see
// src/shared/declineVocabulary.js for why, and workflow.js for where the
// normalisation happens — and a row stored as `denied` still reads back
// correctly through canonicalDecisionStatus() below.
export const ACTIONS = new Set(["approve", "decline"]);

export const REFUSALS = {
  authorization_not_found: { status: 404, reason: "No authorization exists with this id." },
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_action: { status: 400, reason: "action must be 'approve' or 'decline'." },
  not_awaiting_approval: {
    status: 403,
    reason:
      "This authorization was routed to escalation or block, not specialist approval — it has no approve/decline path here.",
  },
  // ^ and v THE GENERIC FORMS, and both are fallbacks rather than the normal
  //   answer. describeNoApprovalPath() and describeSettled() below build the
  //   specific one from the row. "escalation or block" is a list of two when
  //   `decision` names one, and "approved or declined" is a list of two when
  //   `status`, `approver`, `approvedAt`/`deniedBy` and `remoteResult` between
  //   them name which, who, when, why and whether the Remote write landed. See
  //   src/shared/settledDecision.js for the reasoning; this is the same defect
  //   src/uc02/reviewPolicy.js fixed one use case over.
  already_decided: { status: 409, reason: "This authorization has already been approved or declined." },
  employment_no_longer_active: {
    status: 409,
    reason: "The employment record is no longer active. Re-run the workation request rather than approving it.",
  },
};

/**
 * Is this authorization open to a human decision at all? Split out so a UI
 * can ask "should I show approve/decline controls?" without needing a fake
 * approver identity to ask with — same reasoning as
 * evaluateCaseActionability() / evaluateAmendmentActionability().
 * @param {object} args
 * @param {object|null} args.authorizationRow
 */
export function evaluateAuthorizationActionability({ authorizationRow }) {
  if (!authorizationRow) return refuse("authorization_not_found");
  if (authorizationRow.decision !== "ready_for_approval") {
    return refuse("not_awaiting_approval", { reason: describeNoApprovalPath(authorizationRow) });
  }
  if (authorizationRow.status !== "pending_specialist_approval") {
    return refuse("already_decided", { reason: describeSettled(authorizationRow) });
  }
  return { allowed: true, code: "actionable", status: 200, reason: "Awaiting specialist approval." };
}

/**
 * Decide whether `approver` may take `action` on this authorization right now.
 * @param {object} args
 * @param {object|null} args.authorizationRow
 * @param {string|null} args.approver
 * @param {"approve"|"decline"} args.action
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST.
 */
export function evaluateApprovalAction({ authorizationRow, approver, action, entitlement = null }) {
  if (!approver || typeof approver !== "string" || !approver.trim()) {
    return refuse("approver_required");
  }
  if (!ACTIONS.has(action)) return refuse("unknown_action");

  const actionability = evaluateAuthorizationActionability({ authorizationRow });
  if (!actionability.allowed) return actionability;

  // ENTITLEMENT IS CONSULTED LAST, AND ONLY EVER REFUSES.
  //
  // UC-04 has no `role` parameter — one slot, one approver — and until this
  // line "approver" only had to be a non-empty string, so any identity that
  // could reach POST /api/authorizations/:id/approve issued a work
  // authorization (docs/APPROVAL-ROUTING.md §1.3, proven live). The role is
  // NOMINAL: `mobility_specialist` is named in src/review/approverEntitlement.js
  // and supplied here as a constant, never read off the request. That is the
  // whole point — a use case with no role field is not a use case with no role.
  //
  // Additive by construction: it runs after every refusal above, it returns a
  // refusal or `null`, and `null` falls through to the same `allowed` object
  // this function already returned.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-04", role: UC04_ROLE, approver });
    if (denial) return denial;
  }

  return { allowed: true, code: action, status: 200, reason: `Permitted: ${action}.` };
}

/**
 * A settled authorization, as FACTS rather than as a paragraph.
 *
 * WHY IT IS BUILT FROM THE ROW. "This authorization has already been approved
 * or declined" is true of every settled row and useful for none of them: which of
 * the two decides whether the employee may travel, who decided it decides who
 * to ask, and whether the work-authorization record was actually updated at
 * Remote decides whether the authorization exists or only the approval of it
 * does. `status`, `approver`, `approvedAt`, `approvalNote`, `deniedBy`,
 * `remoteResult` and `workAuthorizationId` are all on the row that this
 * function is handed.
 *
 * WHY IT IS NO LONGER ONE SENTENCE. It used to be, and the project owner read
 * the result and asked, in full: "please explain to me why all this story". Five
 * separate facts — who, when, the note they left, that Remote was not updated,
 * why, and that the decision is final — were run together into a single
 * paragraph, with a raw `Date` object in the middle of it and a doubled full
 * stop where a durable field that already ended in one met a template that added
 * another. Every fact was worth keeping. None of them was worth reading in that
 * shape.
 *
 * HONEST IS NOT THE SAME AS VERBOSE. Nothing is removed here — in particular
 * "the approval is real and recorded; the Remote request it would have updated
 * does not exist" survives verbatim, because softening it would be the exact
 * overstatement this whole family of describers exists to prevent. Each fact is
 * simply said ONCE, in its own field, under a label naming what it is.
 *
 * @param {object|null} authorizationRow
 * @returns {{headline: string, facts: {label: string, value: string}[],
 *            finality: string}|null}  null for a row whose outcome cannot be read
 */
export function settledFacts(authorizationRow) {
  const row = authorizationRow ?? {};

  if (row.status === "executed" || row.approvedAt) {
    const facts = [];
    if (row.approver) facts.push({ label: "Approved by", value: String(row.approver) });
    const when = humanTime(row.approvedAt ?? row.executedAt);
    if (when) facts.push({ label: "Approved on", value: when });
    const note = String(row.approvalNote ?? "").trim();
    if (note) facts.push({ label: "Note left", value: note });
    facts.push({ label: "Sent to Remote", value: remoteOutcome(row) });
    return {
      headline: "Approved.",
      facts,
      finality: "This is final — an approved request cannot be approved or declined again.",
    };
  }

  // canonicalDecisionStatus() so a row stored as `denied` before the rename is
  // described as what it always meant rather than falling through to the
  // generic "already approved or declined" sentence.
  if (canonicalDecisionStatus(row.status) === "declined") {
    // BOTH FIELD NAMES. `declinedBy` is what the store produces now (the
    // Postgres column is still `denied_by`, aliased on read); `deniedBy` is
    // what an in-memory row written before 2026-08-19, or a response from a
    // deployment that has not been redeployed, still carries. Reading only
    // one would drop the approver's name and reason off a real decision.
    const declined = row.declinedBy ?? row.deniedBy ?? {};
    const facts = [];
    const who = declined.approver ?? row.approver;
    if (who) facts.push({ label: "Declined by", value: String(who) });
    const when = humanTime(declined.at ?? row.declinedAt ?? row.deniedAt);
    if (when) facts.push({ label: "Declined on", value: when });
    const reason = String(declined.note ?? row.approvalNote ?? "").trim();
    // A DECLINE IS SUPPOSED TO CARRY A REASON, so silence is reported as a
    // finding rather than left as an absent row somebody has to notice.
    facts.push({
      label: "Reason given",
      value: reason || "None was recorded, which a decline is supposed to carry.",
    });
    return {
      headline: "Declined.",
      facts,
      finality: "This is final — a declined request has to be filed again rather than re-decided here.",
    };
  }

  return null;
}

/**
 * The same facts as one string, for a surface that can only render one.
 *
 * Falls back to the generic sentence for a row that genuinely cannot say which
 * outcome it got — an honest "we cannot say" beats a guess.
 */
export function describeSettled(authorizationRow) {
  const settled = settledFacts(authorizationRow);
  if (!settled) return REFUSALS.already_decided.reason;
  return [settled.headline, ...settled.facts.map((f) => `${f.label}: ${f.value}`), settled.finality].join("\n");
}

/**
 * An authorization that never reached the specialist, described by which
 * outcome it actually got — and what that outcome MEANT, reusing the per-reason
 * `means` published beside UC-04's own gates rather than restating gate
 * semantics here.
 */
export function describeNoApprovalPath(authorizationRow) {
  const row = authorizationRow ?? {};
  const gate = gateClause(describeDecidingGate, row.reason);

  if (row.decision === "blocked") {
    return (
      `This workation request was BLOCKED${gate.at}.${gate.means}` +
      " A block is a hard stop, not an exception for a specialist to weigh — there is nothing to approve."
    );
  }
  if (row.decision === "escalate") {
    return (
      `This workation request was ESCALATED${gate.at}.${gate.means}` +
      " It has no approve/decline path here; the escalation is worked on its own ticket."
    );
  }
  // No fourth branch: evaluate() returns exactly ready_for_approval / escalate
  // / blocked (src/uc04/policyEngine.js), and UC-04 has no auto-approve path at
  // all — every workation goes to a mobility specialist. A branch for a
  // decision the engine cannot produce would be a sentence nobody could ever
  // read, so anything unrecognised falls through to the honest generic.
  return REFUSALS.not_awaiting_approval.reason;
}

/**
 * Whether the decision reached Remote — one short answer, not a paragraph.
 *
 * THREE OUTCOMES, NOT TWO, AND THE THIRD IS THE ONE A TRUTHY CHECK GETS WRONG.
 * `remoteWriteClause()` reads a truthy `remoteResult` as "it landed", which was
 * safe while the only thing ever stored there was Remote's own response. It no
 * longer is: since UC-04 stopped creating the record it decides on (there is no
 * `POST /v1/work-authorization-requests`), an approval with no linked Remote
 * request settles its row with a TRANSMISSION RECORD — `{transmitted: false,
 * reason, detail}` — which is an object, so truthy, and would have been
 * announced as a successful write. That is the exact class of overstatement this
 * function exists to remove, so the honest case is read explicitly and the
 * shared helper is left to handle the two it was written for.
 *
 * The answer also stopped saying "created at Remote". Nothing in this system
 * creates a work authorisation; the write is an UPDATE to a request the employee
 * raised.
 *
 * `unpunctuated()` on the stored detail is what fixed the doubled full stop the
 * owner read. The detail is durable — rows written before this pass still hold
 * text ending in a period — so the trim happens at the join, where it also
 * repairs the decisions already recorded.
 */
function remoteOutcome(row) {
  const result = row.remoteResult;
  if (result && typeof result === "object" && result.transmitted === false) {
    const why = unpunctuated(result.detail) || "no Remote work-authorisation request is linked to it";
    return (
      `No — ${why}. ` +
      "The approval is real and recorded; the Remote request it would have updated does not exist."
    );
  }
  return remoteWriteClause(result ?? row.workAuthorizationId, {
    landed: `Yes — the work-authorisation request was updated at Remote${row.workAuthorizationId ? ` (${row.workAuthorizationId})` : ""}.`,
    artifact: "the work authorisation",
  }).trim();
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
