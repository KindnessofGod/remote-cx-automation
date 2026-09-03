// ---------------------------------------------------------------------------
// mobilityReview.js  —  STAGE 3: Remote's own mobility review, recorded HERE
// ---------------------------------------------------------------------------
// WHAT THIS IS, AND THE ONE SENTENCE THAT HAS TO SURVIVE EVERY EDIT
//
// A work authorization has three deciders (UC-04.md §1a, verified against
// developer.remote.com on 2026-08-30):
//
//   1. the EMPLOYEE files          — /portal
//   2. the CUSTOMER'S OWN MANAGER approves or declines — /remoteui, and this is
//      the ONE decision Remote's API accepts: `PATCH` takes exactly
//      `approved_by_manager` / `declined_by_manager`
//   3. REMOTE'S MOBILITY TEAM reviews what the employer approved — the ZAF
//      sidebar
//
// **Remote publishes NO ENDPOINT for stage 3.** Its whole work-authorization
// surface is two GETs and two PATCHes, and neither PATCH accepts
// `approved_by_remote` or `declined_by_remote`. That API fact is unchanged by
// this module and is not negotiable.
//
// So this module records stage 3 **in this system and nowhere else**. Nothing
// here takes a Remote client, builds a Remote payload, or names a Remote status
// value — `submitMobilityReview()` in ./workflow.js has no `remote` parameter at
// all, which is the structural half of that guarantee; the behavioural half is
// that no code path anywhere writes `approved_by_remote`.
//
// WHY THAT IS NOT THE FAILURE THIS REPOSITORY KEEPS PAYING FOR. The failure is
// a control that REPORTS SUCCESS HAVING CHANGED NOTHING (CLAUDE.md §6, "a green
// n8n execution is not evidence that an integration works"). What makes this
// different is not the write — there is none either way — but that the absence
// is SAID, in the reviewer's own words, before they click, in the audit row
// afterwards, on the employee's own status page, and on the document the
// employee collects. A decision recorded honestly in one system is a real
// decision. A decision that lets its reader believe it reached a second system
// is the defect. MOBILITY_REVIEW_NOTICE below is the sentence that keeps the
// two apart, and it is composed here, server-side, so no surface can paraphrase
// it into something softer.
//
// OUT OF ORDER IS REFUSED BY NAME. Stage 3 reviews what the employer approved.
// A clearance on a request no employer has approved is not a stricter review,
// it is a review of nothing — and it would leave a document saying "the
// employer approved" beside a record saying they had not. `evaluateMobilityReview()`
// refuses it as `employer_approval_not_recorded`, and refuses a request the
// employer DECLINED under its own separate code, because those are two
// different afternoons of work for whoever reads the refusal.
//
// PURE. Rows in, a verdict out. No store, no clock, no network. The I/O lives
// in ./mobilityReviewLog.js (the read-back) and ./workflow.js (the write).
// ---------------------------------------------------------------------------

import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { humanTime } from "../shared/settledDecision.js";
import { UC04_ROLE } from "../review/approverEntitlement.js";

/**
 * The two verbs a Remote mobility reviewer may record.
 *
 * `clear`, NOT `approve`, AND THE WORD IS THE POINT. `approve` is already taken
 * on this use case: it is the employer's stage-2 decision, the one that really
 * does PATCH Remote (src/uc04/server.js's `POST /api/authorizations/:id/approve`).
 * Two stages sharing one verb is how a reader — or a future route — comes to
 * believe one performed the other, which is the exact confusion the 2026-08-30
 * correction had to unpick. `decline` is shared with stage 2 deliberately: it
 * is Remote's own negative verb repo-wide (docs/REMOTE-VOCABULARY.md §2.1), and
 * the audit action names below keep the two stages apart anyway.
 */
export const MOBILITY_REVIEW_ACTIONS = new Set(["clear", "decline"]);

/**
 * The `audit_log.action` each verb is recorded under.
 *
 * NEW NAMES, NOT REUSED ONES — checked against every audit action this
 * repository writes (`workation_approved`, `workation_declined`,
 * `workation_executed`, `workation_not_transmitted`,
 * `workation_execution_blocked`, `workation_*_refused`) and colliding with
 * none. That check is the one UC-02's rename found the hard way when a
 * templated name collided with the auto-approve path's own row.
 *
 * PREFIXED `workation_` so a specialist greps UC-04's history with one prefix,
 * and carrying `mobility_review` so the STAGE is legible in the audit viewer's
 * feed without opening the row.
 */
export const MOBILITY_REVIEW_AUDIT_ACTIONS = Object.freeze({
  clear: "workation_mobility_review_cleared",
  decline: "workation_mobility_review_declined",
});

/** The action a refused attempt is recorded under. Attributed refusals only — see workflow.js. */
export const MOBILITY_REVIEW_REFUSED_ACTION = "workation_mobility_review_refused";

/** The action the employee's collected record is issued under. */
export const MOBILITY_REVIEW_RECORD_ISSUED_ACTION = "workation_record_issued";

/** Every action name that IS a stage-3 verdict — what ./mobilityReviewLog.js reads back by. */
export const MOBILITY_REVIEW_VERDICT_ACTIONS = Object.freeze(
  new Set(Object.values(MOBILITY_REVIEW_AUDIT_ACTIONS))
);

/**
 * THE SENTENCE. Composed once, here, and rendered verbatim by the sidebar, the
 * portal and the issued document. Nothing may paraphrase it: every paraphrase
 * of "this is not sent to Remote" that anybody has ever written is shorter and
 * more reassuring than the original, and the reassuring direction is the one
 * that gets believed.
 */
export const MOBILITY_REVIEW_NOTICE =
  "Recorded here as Remote's mobility review. Remote publishes no endpoint for this stage, so this is " +
  "not sent to Remote and Remote's own systems will not show it. What you record is a durable decision " +
  "in this system, under your name, visible to the employee and in the audit log — and nothing more.";

/** The same fact, phrased for the employee reading their own request rather than the reviewer. */
export const MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE =
  "Remote's mobility review is recorded in this system only. Remote publishes no API for this stage, so " +
  "Remote's own systems hold no record of it. Treat it as your employer's and this system's decision, " +
  "written down — not as an immigration clearance and not as anything a Remote product screen will show.";

export const MOBILITY_REVIEW_REFUSALS = {
  authorization_not_found: { status: 404, reason: "No work-authorization record exists with this id." },
  reviewer_required: {
    status: 401,
    reason: "No reviewer identity was supplied. Remote's mobility review is recorded under a named person or not at all.",
  },
  unknown_action: { status: 400, reason: "action must be 'clear' or 'decline'." },
  // THE OUT-OF-ORDER REFUSAL, AND IT HAS ITS OWN NAME ON PURPOSE. Stage 3
  // reviews what stage 2 approved. Recording a clearance before the employer
  // has approved would produce a record — and a document — asserting an
  // employer approval that has not happened.
  employer_approval_not_recorded: {
    status: 409,
    reason:
      "Remote's mobility review comes AFTER the employer's approval, and this request has not been approved by the " +
      "customer's manager yet. There is nothing here for Remote to review — the employer's decision is made in " +
      "Remote's product, and it is the only work-authorization decision Remote's API accepts.",
  },
  employer_declined: {
    status: 409,
    reason:
      "The customer's manager declined this request, so there is nothing for Remote's mobility team to review. " +
      "A declined trip is not re-opened here; the employee files again.",
  },
  mobility_review_already_recorded: {
    status: 409,
    reason: "Remote's mobility review has already been recorded for this request.",
  },
};

/** @param {keyof MOBILITY_REVIEW_REFUSALS} code */
export function refuseMobilityReview(code, extra = {}) {
  const { status, reason } = MOBILITY_REVIEW_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}

/**
 * Did the customer's own manager approve this request?
 *
 * READ OFF `status`, NOT `approvedAt`. `recordApproval()` fills the approval
 * slot BEFORE the freshness re-check, so a row whose employment went inactive
 * between the click and the PATCH carries `approvedAt` and never reached
 * `executed` — the employer's decision was recorded and then stopped. Reading
 * `approvedAt` alone would treat that as an approval; reading `status` treats
 * it as what it is. `approvedAt` is still required, because `executed` with no
 * signature would be a row this system does not understand.
 *
 * @param {object|null} authorizationRow
 */
export function employerApprovalState(authorizationRow) {
  const row = authorizationRow ?? {};
  /* TWO STATUSES MEAN "THE EMPLOYER APPROVED", AND READING ONLY ONE OF THEM
     BROKE THE WHOLE CHAIN (fixed 2026-08-31, found by driving the deployment).

       `executed`             the older path — a single approval recorded through
                              src/uc04/workflow.js, which settles the row to
                              `executed` once the verdict is transmitted (or
                              recorded as untransmittable).
       `approved_by_manager`  what /remoteui/work-authorizations writes. It is
                              REMOTE'S OWN ENUM VALUE, chosen deliberately so the
                              store's status and the status the employer's screen
                              renders are one string rather than two that must be
                              kept in step.

     This function knew only the first, so a request the customer's manager had
     genuinely just approved — status `approved_by_manager`, live on the
     deployment — refused stage 3 with `employer_approval_not_recorded`: a
     message asserting the employer had not approved, beside a record saying they
     had. That is the exact inversion the "out of order is refused by name" rule
     at the top of this file exists to prevent, arriving from the other side.

     IT WAS INVISIBLE TO BOTH HALVES' TESTS because each was internally
     consistent: the stage-2 tests asserted `approved_by_manager` was written and
     the stage-3 tests fed rows carrying `executed`. Neither side was wrong about
     itself. Only driving stage 1 → 2 → 3 in one pass, against the deployment,
     put the two vocabularies in the same sentence.

     `approvedAt` IS STILL REQUIRED on both. A status with no timestamp is a row
     mid-write or a row hand-built by a caller, and "the employer approved" is
     not a claim to make from a status string alone. */
  const EMPLOYER_APPROVED_STATUSES = ["executed", "approved_by_manager"];
  if (EMPLOYER_APPROVED_STATUSES.includes(row.status) && row.approvedAt) {
    return {
      approved: true,
      declined: false,
      approver: row.approver ?? null,
      at: row.approvedAt ?? null,
      note: row.approvalNote ?? null,
      // WHETHER STAGE 2 REACHED REMOTE, which is a different question from
      // whether it happened. `transmitVerdict()` settles the row either way and
      // records `{transmitted:false}` when no Remote request is linked — see
      // src/uc04/workflow.js. Carried here so the document and the panel can
      // both state it without re-deriving it.
      transmittedToRemote: row.remoteResult?.transmitted === true,
    };
  }
  /* AND THE SAME SEAM ON THE REFUSAL SIDE. `canonicalDecisionStatus()` folds
     `denied` into `declined` (the pre-2026-08-19 spelling) but knows nothing of
     `declined_by_manager`, which is what the employer surface writes — measured,
     not assumed: it returns that string unchanged. Left unhandled, an
     employer-DECLINED request would fall through to the neutral state below and
     refuse stage 3 as `employer_approval_not_recorded` — technically true and
     the wrong sentence, since the reviewer needs to know the trip was refused
     rather than that nobody has looked. */
  if (canonicalDecisionStatus(row.status) === "declined" || row.status === "declined_by_manager") {
    const declined = row.declinedBy ?? row.deniedBy ?? {};
    return {
      approved: false,
      declined: true,
      approver: declined.approver ?? row.approver ?? null,
      at: declined.at ?? row.declinedAt ?? row.deniedAt ?? null,
      note: declined.note ?? null,
      transmittedToRemote: false,
    };
  }
  return { approved: false, declined: false, approver: null, at: null, note: null, transmittedToRemote: false };
}

/**
 * May `reviewer` record `action` as Remote's mobility review of this request?
 *
 * ORDER, AND WHY IT IS THIS ORDER. Identity and verb first (they are about the
 * CALL and are cheap), then the record's own state (about the REQUEST), then
 * whether the stage is already closed, then entitlement — which is consulted
 * LAST and can only ever refuse, exactly as `evaluateApprovalAction()` does it,
 * so a refusal never hides the real reason behind a role problem.
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow
 * @param {object|null} [args.existingReview]  the stage-3 verdict already on record, from
 *   ./mobilityReviewLog.js. Passed IN so this function stays pure.
 * @param {string|null} args.reviewer
 * @param {"clear"|"decline"} args.action
 * @param {{check: Function}|null} [args.entitlement]
 */
export function evaluateMobilityReview({ authorizationRow, existingReview = null, reviewer, action, entitlement = null }) {
  if (!reviewer || typeof reviewer !== "string" || !reviewer.trim()) {
    return refuseMobilityReview("reviewer_required");
  }
  if (!MOBILITY_REVIEW_ACTIONS.has(action)) return refuseMobilityReview("unknown_action");
  if (!authorizationRow) return refuseMobilityReview("authorization_not_found");

  const employer = employerApprovalState(authorizationRow);
  if (employer.declined) return refuseMobilityReview("employer_declined");
  if (!employer.approved) return refuseMobilityReview("employer_approval_not_recorded");

  if (existingReview) {
    return refuseMobilityReview("mobility_review_already_recorded", {
      reason: describeRecordedReview(existingReview),
    });
  }

  // ENTITLEMENT LAST, AND IT CAN ONLY REFUSE. Same contract as
  // src/uc04/approvalPolicy.js: `check()` returns a refusal or `null`, there is
  // no return value meaning "approved", so no call site can be written that
  // lets it fill a slot or lower a floor.
  //
  // THE ROLE IS `uc04:mobility_specialist`, THE ROSTER ENTRY THAT ALREADY
  // EXISTS — not a new one. `USE_CASE_ROLES` (src/review/approverEntitlement.js)
  // has granted exactly that token for UC-04 since it shipped, and after the
  // 2026-08-30 correction it fits stage 3 BETTER than it fitted stage 2: a
  // "mobility specialist" is Remote's own reviewer, which is this stage. Adding
  // a second token would mean an operator who rostered UC-04's mobility people
  // finds this refusing those same people — the "gate that refuses the right
  // people" failure that module's header exists to avoid.
  if (entitlement) {
    const denial = entitlement.check({ useCase: "UC-04", role: UC04_ROLE, reviewer, approver: reviewer });
    if (denial) return denial;
  }

  return {
    allowed: true,
    code: action,
    status: 200,
    reason: `Permitted: record Remote's mobility review as ${action === "clear" ? "cleared" : "declined"}.`,
  };
}

/** A recorded stage-3 verdict as one sentence — for a surface that renders only one. */
export function describeRecordedReview(review) {
  if (!review) return MOBILITY_REVIEW_REFUSALS.mobility_review_already_recorded.reason;
  const when = humanTime(review.at);
  const who = review.reviewer ? ` by ${review.reviewer}` : "";
  const on = when ? ` on ${when}` : "";
  const verdict = review.outcome === "cleared" ? "cleared" : "declined";
  return (
    `Remote's mobility review was already recorded${who}${on}: ${verdict}. ` +
    "It is final here — a second review would be a second, unaudited answer to the same question. " +
    MOBILITY_REVIEW_NOTICE
  );
}

/**
 * STAGE 3 IN A HANDFUL OF WORDS, for a status column that has room for a badge
 * and not for a paragraph.
 *
 * WHY THIS EXISTS. "My requests" rendered stage 2 as the row's status badge and
 * stage 3 only as prose at the bottom of a tall cell, below the fold. Read live
 * on the deployment 2026-09-01: a trip the employer had approved AND Remote's
 * mobility team had cleared showed one badge — "Approved by your manager" —
 * over a settled-decision line ending "This is final". The clearance was on the
 * row and the reader could not find it, and the row's own last word said the
 * manager had finished it. Both readings are wrong and both came from stage 3
 * having no presence in the one column a requester scans.
 *
 * NOT A SUMMARY OF THE NOTICE, and it must never become one. This says which
 * STATE the stage is in; MOBILITY_REVIEW_NOTICE says what recording it does and
 * does not mean, is composed once above, and is still rendered verbatim beside
 * it. A short label that started explaining the boundary would be the shorter,
 * more reassuring paraphrase that comment forbids.
 *
 * "Remote's mobility review" is spelled out in each of them rather than left to
 * a heading, because a badge is read on its own.
 */
export const MOBILITY_REVIEW_SHORT_LABELS = Object.freeze({
  cleared: "Remote's mobility review: cleared",
  declined: "Remote's mobility review: declined",
  // NOT "pending" or "in review" — nobody has been asked yet. "Still to do"
  // says a stage remains without implying somebody is working on it.
  open: "Remote's mobility review: still to do",
  // The employer declined, or has not decided. Stage 3 reviews what stage 2
  // approved, so there is nothing here to review — which is a different fact
  // from "still to do" and gets a different word.
  not_reached: "Remote's mobility review: not reached",
  unknown: "Remote's mobility review: unknown",
});

/**
 * The whole of stage 3 as one block, for every surface that has to draw it.
 *
 * ONE DERIVATION. The sidebar, the employee's status page and the delivery gate
 * all ask slightly different questions of the same two facts (did the employer
 * approve; is a stage-3 verdict on record), and three copies of that comparison
 * is how they come to disagree. Everything below is read; nothing is decided
 * that `evaluateMobilityReview()` does not also decide.
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow
 * @param {object|null} [args.review]  the stage-3 verdict on record, or null
 */
export function describeMobilityReview(args) {
  const described = describeMobilityReviewState(args);
  return {
    ...described,
    shortLabel: MOBILITY_REVIEW_SHORT_LABELS[described.state] ?? MOBILITY_REVIEW_SHORT_LABELS.unknown,
  };
}

/**
 * The same derivation without the short label — split out for one reason only:
 * stamping `shortLabel` in a WRAPPER means no branch below can be added
 * without one. Six returns each composing their own would be six chances to
 * forget, and the forgotten one renders as an empty badge in the single column
 * the employee actually reads.
 */
function describeMobilityReviewState({ authorizationRow, review = null }) {
  const employer = employerApprovalState(authorizationRow);
  const base = {
    stage: 3,
    label: "Remote's mobility review",
    // NEVER TRUE, ON ANY PATH, AND PUBLISHED AS A FIELD RATHER THAN LEFT TO THE
    // PROSE. A field can be asserted by a test; a paragraph cannot.
    sentToRemote: false,
    remoteEndpointExists: false,
    notice: MOBILITY_REVIEW_NOTICE,
    employer,
    recorded: review ?? null,
  };

  if (!authorizationRow) {
    return { ...base, state: "unknown", openHere: false, detail: "No work-authorization record was found." };
  }

  if (review) {
    return {
      ...base,
      state: review.outcome === "cleared" ? "cleared" : "declined",
      openHere: false,
      detail: describeRecordedReview(review),
    };
  }

  if (employer.declined) {
    return {
      ...base,
      state: "not_reached",
      openHere: false,
      detail: MOBILITY_REVIEW_REFUSALS.employer_declined.reason,
    };
  }

  if (!employer.approved) {
    return {
      ...base,
      state: "not_reached",
      openHere: false,
      detail: MOBILITY_REVIEW_REFUSALS.employer_approval_not_recorded.reason,
    };
  }

  return {
    ...base,
    state: "open",
    openHere: true,
    detail:
      "The customer's manager has approved this trip. Remote's mobility review is the stage that follows it, and " +
      "it is recorded here. " +
      MOBILITY_REVIEW_NOTICE,
  };
}
