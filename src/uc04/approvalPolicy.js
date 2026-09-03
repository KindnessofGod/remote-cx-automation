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
import { shortReference } from "../shared/publicReference.js";
import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { describeDecidingGate } from "./policyEngine.js";
import { UC04_ROLE } from "../review/approverEntitlement.js";
import { EMPLOYER_DECISION_STATUSES } from "./authorizationStore.js";

/**
 * The two statuses recordEmployerDecision() writes — and nothing else does.
 *
 * That function takes no Remote client and makes no Remote call, so a row in
 * either state provably had no write attempted against it. Derived from the
 * store's own map rather than restated, so a third verb cannot be added there
 * and silently miss this. See remoteOutcome().
 */
const EMPLOYER_SETTLED_STATUSES = new Set(Object.values(EMPLOYER_DECISION_STATUSES));

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
 * WHO decided, in the terms a person reading this needs.
 *
 * THE SESSION ID IS NOT AN ANSWER. This used to print `row.approver` —
 * "admin_jane" — and the project owner's objection was exactly right: Remote
 * has many client companies, so a session id says nothing about who the person
 * is, what standing they had to approve an employee's work authorization, or
 * which of those companies they belong to. The three rows below answer those
 * three questions, and each is omitted rather than guessed when it was not
 * recorded.
 *
 * THE ID IS STILL PRINTED, beside the name, because it is what the audit trail
 * is keyed on and what the Zendesk hand-off note already carries — the two
 * surfaces must agree. It is only demoted from being the whole answer.
 *
 * `approverTitle` and `approverCompany` have no column on
 * `uc04_authorizations`; they ride on the append-only audit row and are read
 * back by ./employerDecisionLog.js. A row that never recorded them yields a
 * name alone, which is still better than an id alone.
 *
 * @param {{approver?:string|null, approverName?:string|null, approverTitle?:string|null, approverCompany?:string|null}} row
 * @param {"Approved"|"Declined"} verb
 * @returns {{label:string, value:string}[]}
 */
function approverFacts(row, verb) {
  const facts = [];
  const name = row.approverName ? String(row.approverName) : null;
  const id = row.approver ? String(row.approver) : null;
  if (name && id) facts.push({ label: `${verb} by`, value: `${name} (${id})` });
  else if (name || id) facts.push({ label: `${verb} by`, value: String(name ?? id) });

  // "Their role" and not "Job title": this is the standing the decision was
  // made in, which is the question a reviewer is actually asking, and it is not
  // necessarily the employee-facing job title on any record.
  if (row.approverTitle) facts.push({ label: "Their role", value: String(row.approverTitle) });
  // THE EMPLOYER, NEVER REMOTE. Stage 2 is the customer's own decision; naming
  // the company is what tells a Remote specialist which client this is.
  if (row.approverCompany) {
    facts.push({ label: "Acting for", value: `${row.approverCompany} — the employer, not Remote` });
  }
  return facts;
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
 * @returns {{headline: string, state: "approved"|"declined", badge: string,
 *            facts: {label: string, value: string}[],
 *            finality: string}|null}  null for a row whose outcome cannot be read
 */
export function settledFacts(authorizationRow) {
  const row = authorizationRow ?? {};

  if (row.status === "executed" || row.approvedAt) {
    const facts = [];
    // NAME FIRST, ID ALWAYS. `approver` is the session id — audit-grade, and
    // not an answer to "who approved this trip", which is what a specialist
    // reading the sidebar is actually asking. `approverName` is Remote's own
    // `employer_approver.name`; it has no column on `uc04_authorizations`, so
    // on a pooled deployment it arrives from the append-only audit row instead
    // (./employerDecisionLog.js). The id is never dropped — it is what the
    // audit trail is keyed on, and the two together are exactly what the
    // Zendesk hand-off note already prints, so the two surfaces agree.
    facts.push(...approverFacts(row, "Approved"));
    const when = humanTime(row.approvedAt ?? row.executedAt);
    if (when) facts.push({ label: "Approved on", value: when });
    const note = String(row.approvalNote ?? "").trim();
    if (note) facts.push({ label: "Note left", value: note });
    facts.push({ label: "Sent to Remote", value: remoteOutcome(row) });
    return {
      headline: "Approved.",
      // THE BADGE THE PANEL PUTS AT THE TOP OF THE SCREEN, composed here rather
      // than derived in the browser from `headline`.
      //
      // WHAT WENT WRONG WITHOUT IT. The sidebar's header badge reads
      // `case.decision` — the AUTOMATION's verdict, `ready_for_approval`,
      // which is a historical fact and correctly never changes — and falls
      // through to the shared review queue's status only when there is one.
      // UC-04 has none: its settlement is on its own record, not in
      // `review_queue`. So a trip the customer's manager approved at 17:02 was
      // still headed "Awaiting specialist approval" above a settled block
      // naming the approver and the minute — read live on the deployment
      // 2026-09-01, on record 0531c363. That is the SAME defect rca-il7 fixed
      // for the review-queue path in zaf-app/assets/main.js, arriving by the
      // one route that path does not cover.
      //
      // "BY THE EMPLOYER", NOT "APPROVED". A bare "Approved" on this use case
      // is the ambiguity the whole 2026-08-30 three-stage rework exists to
      // remove: three parties decide, and stage 3 is still outstanding at the
      // moment this badge first appears. It names WHICH approval happened.
      state: "approved",
      badge: "Approved by the employer",
      facts,
      // WHICH DECISION IS FINAL, SAID OUT LOUD. This read "This is final — an
      // approved request cannot be approved or declined again." True, and
      // routinely misread: it is the last line of the employee's own row in
      // "My requests", and a work authorization has a THIRD decider after this
      // one. The owner read their own approved trip on the deployment
      // 2026-09-01 and reported that "the page makes you look as if approval by
      // the manager is the final approval". Naming the employer's decision as
      // the thing that is final costs three words and closes that reading,
      // without weakening the sentence's real job — refusing a second stage-2
      // verdict on a request that already has one.
      finality: "The employer's decision is final — an approved request cannot be approved or declined again.",
    };
  }

  // canonicalDecisionStatus() so a row stored as `denied` before the rename is
  // described as what it always meant rather than falling through to the
  // generic "already approved or declined" sentence.
  // `|| row.declinedAt` MIRRORS THE APPROVE BRANCH ABOVE, and its absence was a
  // defect (2026-08-31). The approve branch accepts a row on `approvedAt`
  // precisely because the EMPLOYER's stored status is Remote's own
  // `approved_by_manager` rather than `executed`; the decline branch tested only
  // the status word, and `declined_by_manager` is not an alias of `declined`
  // (STATUS_ALIASES maps `denied` and nothing else). So an employer decline fell
  // through to null and the panel showed no settled facts at all — losing the
  // decliner, the date AND the reason, on the outcome where a reason is
  // mandatory. Asymmetric handling of two halves of one decision is how a
  // negative outcome comes to be less well recorded than a positive one.
  if (canonicalDecisionStatus(row.status) === "declined" || row.declinedAt) {
    // BOTH FIELD NAMES. `declinedBy` is what the store produces now (the
    // Postgres column is still `denied_by`, aliased on read); `deniedBy` is
    // what an in-memory row written before 2026-08-19, or a response from a
    // deployment that has not been redeployed, still carries. Reading only
    // one would drop the approver's name and reason off a real decision.
    const declined = row.declinedBy ?? row.deniedBy ?? {};
    const facts = [];
    // Same rule as the approve branch above. The decline slot is jsonb, so it
    // DOES carry `approverName` on a stored row — but a row written before
    // 2026-08-31, or one whose slot is absent, falls back the same way.
    facts.push(
      ...approverFacts(
        {
          approver: declined.approver ?? row.approver,
          approverName: declined.approverName ?? row.approverName,
          approverTitle: declined.approverTitle ?? row.approverTitle,
          approverCompany: declined.approverCompany ?? row.approverCompany,
        },
        "Declined"
      )
    );
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
      // Same reasoning as the approve branch. Not "declined by the employer" —
      // a decline ends the chain outright, so there is no second decline this
      // could be confused with, and the shorter word is the one the other
      // eight use cases' badges use.
      state: "declined",
      badge: "Declined",
      facts,
      // NOT SCOPED THE WAY THE APPROVE BRANCH ABOVE IS, and deliberately so: a
      // decline really does end the whole chain. Stage 3 reviews what the
      // employer approved, so on a declined request it is `not_reached` and
      // there is no later decider for this sentence to be mistaken for.
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
  // THE THIRD OUTCOME'S OWN THIRD CASE — NO RESULT AND NOTHING TO WRITE TO.
  //
  // `recordEmployerDecision()` — what /remoteui's screen calls — writes NO
  // `remoteResult` at all, because it makes no Remote call: Remote holds no such
  // request, there being no `POST /v1/work-authorization-requests` that could
  // have created one. So an employer approval fell straight through to
  // `remoteWriteClause()`'s no-result fallback, which reads "No Remote write is
  // recorded against it, so the approval MAY NOT HAVE REACHED REMOTE — check the
  // audit trail before assuming the work authorisation exists."
  //
  // That sentence is right for UC-02, UC-06 and UC-09, where a write really is
  // attempted and silence really does mean "we do not know". Here it is FALSE
  // in the direction that costs the most: it tells a manager who has just
  // approved a trip to doubt whether their approval landed, and sends them to an
  // audit trail to look for a write that could never have existed. Read live on
  // the deployment 2026-09-01, four lines above the panel's own sentence saying
  // Remote publishes no endpoint for this at all.
  //
  // GATED ON WHICH PATH SETTLED THE ROW, NOT ON WHETHER AN ID IS PRESENT.
  //
  // The first draft of this keyed on `!row.workAuthorizationId` and was wrong
  // for a reason src/portal/requestStatus.js had already written down: an
  // `executed` row is settled by transmitVerdict(), which DOES attempt a Remote
  // write and records what it found. An `executed` row holding no result is
  // therefore an anomaly where a write may have been attempted and its outcome
  // lost — "we do not know" is the honest answer and the fallback below is
  // right to give it. Keying on the absent id folded that case in and silently
  // turned "the result went missing" into "nothing was attempted".
  //
  // `approved_by_manager` / `declined_by_manager` are written ONLY by
  // recordEmployerDecision(), which takes no Remote client and makes no Remote
  // call — so on those two statuses "no write was attempted" is a fact about
  // the code path, not an inference from a missing field. Imported rather than
  // spelled, so the two halves cannot drift.
  //
  // This narrows an overstatement; it must never widen into reporting an
  // unknown as a success.
  if (!result && EMPLOYER_SETTLED_STATUSES.has(row.status)) {
    return (
      "No — no Remote work-authorisation request is linked to this decision, so there was nothing at Remote " +
      "to update and no write was attempted. The approval is real and recorded here."
    );
  }
  // `result` ALONE — NOT `result ?? row.workAuthorizationId`.
  //
  // THE FALLBACK THAT WAS HERE ASSERTED A REMOTE WRITE THAT HAD NOT HAPPENED,
  // and it is the more serious of the two defects in this function. With no
  // recorded result it passed `row.workAuthorizationId` in the result's place,
  // and `remoteWriteClause()` reads any truthy value as "it landed" — so a row
  // answered "Yes — the work-authorisation request was updated at Remote
  // (reference wa_…)" on the strength of an id and nothing else.
  //
  // THAT ID IS NOT EVIDENCE OF A WRITE. `src/uc04/workflow.js:207` sets it at
  // LINK time — `link?.state === LINK_LINKED ? link.id : null` — when the
  // employee's request is matched to a Remote request that already existed. The
  // write comes later and separately (`patchWorkAuthorization()` at :718) and
  // records its own result. So the id proves the TARGET exists, never that
  // anything reached it, and an approval recorded through /remoteui — which
  // makes no Remote call at all — could produce a linked row claiming a
  // successful Remote update.
  //
  // Found 2026-09-01 by a test written for the case directly above; the two are
  // opposite errors on the same line, one under-claiming and one over-claiming,
  // and prime directive 7 is why the over-claim is the one that had to go first.
  //
  // Now three honest answers and no fourth: transmitted:false says so, a
  // recorded success says so, no target says nothing was attempted, and a live
  // target with no recorded result says WE DO NOT KNOW — which is
  // remoteWriteClause()'s own sentence, doing its own job.
  return remoteWriteClause(result, {
    landed: `Yes — the work-authorisation request was updated at Remote${row.workAuthorizationId ? ` (reference ${shortReference(row.workAuthorizationId)})` : ""}.`,
    artifact: "the work authorisation",
  }).trim();
}

/** @param {keyof REFUSALS} code */
export function refuse(code, extra = {}) {
  const { status, reason } = REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}
