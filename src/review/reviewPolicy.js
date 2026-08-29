// ---------------------------------------------------------------------------
// reviewPolicy.js  —  Which human actions are permitted on a case, and why not
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// policyEngine.js answers "how should the automation handle this request?".
// This file answers a DIFFERENT question: "is this human, right now, allowed to
// take this action on this case?" The two are not the same gate and must not be
// collapsed into one — the first runs once when the ticket arrives, the second
// runs every time somebody clicks a button in the sidebar, possibly days later.
//
// It is a pure function over plain rows — no database, no HTTP, no clock. Same
// pattern as policyEngine.js and metrics/compute.js: the interesting judgement
// is unit-testable with object literals, and service.js does the I/O.
//
// THE TWO REFUSALS THAT MATTER MOST
//
// 1. An ESCALATED case has no buttons at all. workflow.js puts both
//    `human_review` and `escalate` outcomes into review_queue, so an escalation
//    is visible here — but visible is all it is. An escalation is the system
//    saying "this needs a specialist working it properly"; letting whoever
//    opened the ticket clear it with one click would turn the safe path into a
//    dismiss button. The sidebar reads escalations, it never closes them.
//
// 2. A 🔴 HIGH-TIER case can never be executed from here, whatever its
//    `decision` column says. UC-07/08/09 are specified to have NO execution
//    path; if one of those ever reached the review queue with an approvable
//    decision, that would be a bug upstream, and this gate is the backstop that
//    stops the bug from becoming a state change. It is checked independently of
//    gate 1 rather than being implied by it, because it must keep holding if
//    somebody later decides some high-tier case is "fine to approve".
// ---------------------------------------------------------------------------

import { classifyRisk } from "../shared/riskEngine.js";
import { normalizeDecisionAction } from "../shared/declineVocabulary.js";
import { UC01_ROLE } from "./approverEntitlement.js";

/**
 * What each action does to the two mutable rows, plus the audit verb it
 * records. `reviewStatus` uses the exact vocabulary src/metrics/compute.js
 * counts ("approved" / "rejected") — that is what makes the HITL accept-rate
 * metric a measurement rather than a definition.
 */
// A MAP, NOT A PLAIN OBJECT — deliberately (QA finding F-21, HIGH).
// `action` arrives as a raw URL segment (src/review/server.js reads
// `parts[4]` straight off the path), and `REVIEW_ACTIONS[action]` on a plain
// object resolves through Object.prototype. So
// `POST /api/review/ticket/123/constructor` found `Object` — a truthy
// "spec" — walked past `if (!spec) return refuse("unknown_action")`, and
// answered 200 while writing `nextReviewStatus: undefined` to the review
// queue: the case ended up in a status no gate recognises, permanently
// unactionable, with an audit row whose action verb was undefined. Same for
// `toString`, `valueOf`, `__proto__`, `hasOwnProperty`.
//
// A Map has no prototype chain to walk: Map.get("constructor") is undefined,
// full stop. That is a structural fix rather than a blocklist of the names
// that happen to exist on Object.prototype today, which is why it is
// preferred here over an Object.hasOwn() guard at the call site — a second
// call site added later inherits the safety instead of having to remember it.
// THE NEGATIVE VERB IS `decline` (renamed 2026-08-19, docs/BUILD-LOG.md §3.61).
// `deny` occurs zero times in Remote's documented corpus against 648 of
// `decline`/`declined`; UC-02 already said `decline` because Remote's own
// `DeclineExpenseParams` forced it to. `deny` is still accepted on input and
// normalised in evaluateReviewAction() below — the installed ZAF bundle
// (installation `9990001`) keeps posting `/deny` until it is re-uploaded.
//
// `reviewStatus` DELIBERATELY STILL SAYS `rejected`, and that is not an
// oversight. src/metrics/compute.js counts exactly the strings "approved" and
// "rejected" out of `review_queue`, so the HITL accept rate is defined by them;
// moving that word is its own change with its own metrics update
// (docs/REMOTE-VOCABULARY.md §12 step 11), and doing it in the same commit as
// the verb rename would make one number's history silently discontinuous while
// several other things also moved.
export const REVIEW_ACTIONS = new Map([
  ["approve", { caseStatus: "resolved", reviewStatus: "approved", auditAction: "human_approved" }],
  ["decline", { caseStatus: "declined", reviewStatus: "rejected", auditAction: "human_declined" }],
]);

/** The only case decision the sidebar may action. See gate 1 in the header. */
const ACTIONABLE_DECISION = "human_review";

/**
 * Refusal codes, each with the HTTP status the API should answer with. Kept
 * here rather than in server.js so the mapping is part of the policy and can
 * be asserted in a unit test without starting a server.
 */
export const REFUSALS = {
  approver_required: { status: 401, reason: "No approver identity was supplied." },
  unknown_action: { status: 400, reason: "Action must be 'approve' or 'decline'." },
  case_not_found: { status: 404, reason: "No case exists for this ticket." },
  review_entry_missing: { status: 409, reason: "Case is awaiting review but has no review-queue entry." },
  no_review_path: {
    status: 403,
    reason: "Escalated cases are worked by a specialist, not closed from the sidebar.",
  },
  not_awaiting_review: { status: 409, reason: "This case was not routed to human review." },
  already_decided: { status: 409, reason: "A specialist has already decided this case." },
  high_tier_no_execution: {
    status: 403,
    reason: "High-risk use cases have no execution path. Escalate instead.",
  },
  self_approval: { status: 403, reason: "The requester of a case may not approve it." },
  reason_required: {
    status: 400,
    reason: "A reason for the decision is required and is recorded in the audit log.",
  },
  // Raised by service.js, not by the pure gate below — it needs a live read of
  // the employment record, which this file deliberately cannot do. Registered
  // here anyway so every refusal the API can return has exactly one definition
  // of its status code and wording.
  employment_no_longer_active: {
    status: 409,
    reason: "The employment record is no longer active. Re-run the case rather than approving it.",
  },
};

/**
 * @typedef {object} ReviewVerdict
 * @property {boolean} allowed
 * @property {string} code             refusal code, or the action name when allowed
 * @property {string} reason           human-readable, shown in the sidebar
 * @property {number} status           HTTP status the API should answer with
 * @property {string} [nextCaseStatus]
 * @property {string} [nextReviewStatus]
 * @property {string} [auditAction]
 * @property {string} [tier]           risk tier the case resolves to
 */

/**
 * Is this CASE open to a human decision at all — regardless of who is asking?
 *
 * Split out from evaluateReviewAction so the sidebar can ask "should I even
 * render buttons on this ticket?" without inventing a fake approver identity to
 * ask with. The UI must not re-derive this rule from the case fields itself:
 * that would be a second copy of the policy in browser JavaScript, which is the
 * exact failure docs/BUILD-LOG.md records for the duplicated n8n gates.
 *
 * @param {object} args
 * @param {object|null} args.caseRow    the `cases` row (camelCase, see review/store.js)
 * @param {object|null} args.reviewRow  the matching `review_queue` row, if any
 * @returns {ReviewVerdict}
 */
export function evaluateCaseActionability({ caseRow, reviewRow }) {
  if (!caseRow) return refuse("case_not_found");

  // Gate 2 (see header) — checked before the decision gate, deliberately. A
  // high-tier case must be refused on tier grounds even if some upstream bug
  // has also given it an approvable decision.
  const risk = classifyRisk(caseRow.useCase, caseRow.flags ?? []);
  const tier = risk.tier;
  if (tier === "high") return refuse("high_tier_no_execution", { tier });

  // Gate 1 — escalations are read-only here; anything else never reached a human.
  if (caseRow.decision === "escalate") return refuse("no_review_path", { tier });
  if (caseRow.decision !== ACTIONABLE_DECISION) return refuse("not_awaiting_review", { tier });

  if (!reviewRow) return refuse("review_entry_missing", { tier });
  if (reviewRow.status !== "pending") return refuse("already_decided", { tier });

  return { allowed: true, code: "actionable", reason: "Awaiting a specialist decision.", status: 200, tier };
}

/**
 * Decide whether `approver` may take `action` on this case right now.
 * @param {object} args
 * @param {object|null} args.caseRow      the `cases` row (camelCase, see review/store.js)
 * @param {object|null} args.reviewRow    the matching `review_queue` row, if any
 * @param {string} args.action            "approve" | "decline" (`deny` accepted, legacy)
 * @param {string|null} args.approver     the Zendesk-authenticated agent's identity
 * @param {{check: Function}|null} [args.entitlement]  role-entitlement checker
 *   (src/review/approverEntitlement.js). Optional and consulted LAST, exactly
 *   as src/uc05/signoffPolicy.js's evaluateSignoffAction() does — see K10
 *   (qa/HUMAN-DECISIONS-REQUIRED.md, 2026-08-23).
 * @returns {ReviewVerdict}
 */
export function evaluateReviewAction({ caseRow, reviewRow, action: rawAction, approver, note = "", entitlement = null }) {
  // Request-shaped checks first, so a malformed or unauthenticated call is
  // never answered with information about a case it had no business naming.
  if (!approver || typeof approver !== "string" || !approver.trim()) {
    return refuse("approver_required");
  }
  // Normalised HERE rather than at the server, because this is the one place
  // an action becomes a spec and every caller (server.js, the playground,
  // src/review/service.js) reaches the decision through it. The map returns
  // unknown input unchanged, so `POST …/constructor` still refuses.
  //
  // `typeof action === "string"` first: Map.get(non-string) is undefined
  // anyway, but a JSON body could supply an object and the explicit check
  // keeps the refusal reason honest.
  const action = normalizeDecisionAction(rawAction);
  const spec = typeof action === "string" ? REVIEW_ACTIONS.get(action) : undefined;
  if (!spec) return refuse("unknown_action");

  const caseVerdict = evaluateCaseActionability({ caseRow, reviewRow });
  if (!caseVerdict.allowed) return caseVerdict;

  // Segregation of duties: the person a case is ABOUT cannot sign it off. Today
  // the two identities live in different namespaces (a Remote employment id vs.
  // a Zendesk agent), so this only fires if they are ever unified — which is
  // exactly when it would start mattering, and when nobody would remember to
  // add it. UC-06's dual approval extends this rule rather than replacing it.
  if (caseRow.requester && caseRow.requester === approver.trim()) {
    return refuse("self_approval", { tier: caseVerdict.tier });
  }

  if (!note || typeof note !== "string" || !note.trim()) {
    return refuse("reason_required", { tier: caseVerdict.tier });
  }

  // ENTITLEMENT IS CONSULTED LAST, AND ONLY EVER REFUSES (K10).
  //
  // UC-01 has no `role` parameter in the request — like UC-04/UC-05, the role
  // is NOMINAL: `hr_ops`, named once in approverEntitlement.js and passed here
  // as a constant, never read off the request. Until this line, any Zendesk
  // identity that could authenticate could clear a case, which is the exact
  // gap UC-03/04/05/06/09 already closed. This asks only whether the person
  // deciding is HR Ops at all — it adds nothing to, and cannot override, any
  // refusal above.
  if (entitlement) {
    const denial = entitlement.check({ useCase: caseRow.useCase, role: UC01_ROLE, approver: approver.trim() });
    if (denial) return { ...denial, tier: caseVerdict.tier };
  }

  return {
    allowed: true,
    code: action,
    reason: `Permitted: ${action}.`,
    status: 200,
    nextCaseStatus: spec.caseStatus,
    nextReviewStatus: spec.reviewStatus,
    auditAction: spec.auditAction,
    tier: caseVerdict.tier,
  };
}

/**
 * Build a refusal verdict from a registered code. Exported so service.js can
 * emit its one I/O-dependent refusal in the identical shape — the API then has
 * a single way of describing "no", wherever the "no" was decided.
 * @param {keyof REFUSALS} code
 * @param {object} [extra]
 * @returns {ReviewVerdict}
 */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
