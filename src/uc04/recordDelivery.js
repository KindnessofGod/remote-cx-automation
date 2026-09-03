// ---------------------------------------------------------------------------
// recordDelivery.js  —  who may collect the work-authorization record, and when
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-01's and UC-03's letters each have a gate of exactly this shape
// (src/uc01/letterDelivery.js, src/uc03/letterDelivery.js) and UC-04 had none,
// because until stage 3 was recordable UC-04 produced no document at all. This
// is the same module for the same reason, plus one condition neither of theirs
// has: a work-authorization record may not be collected before the decisions it
// records have been taken.
//
// THE SUBJECT, NOT THE FILER. UC-04 is the one use case where a company admin
// may legitimately file on an employee's behalf (src/uc04/submissionIdentity.js,
// src/portal/ownership.js's SELF_OR_ON_BEHALF_OF). That makes filing a
// two-party act and collecting a one-party one: this document names an employee
// and states what was decided about their travel, so it is handed to the
// employee it is about and to nobody else — the identical rule UC-01's and
// UC-03's gates apply, and the reason theirs compare
// `session.authenticatedEmploymentId` to the record's `employmentId`.
//
// An admin who filed the request therefore CANNOT collect it, and that is the
// intended answer rather than an oversight. It fails in the direction that
// withholds a document rather than the one that hands somebody else's travel
// record to an administrator; if the product wants an admin copy later, that is
// a decision with its own reasoning and its own refusal code, not a widening of
// this one.
//
// FAILS CLOSED. No session at all is `session_required`, never "probably the
// employee". A missing row is `authorization_not_found`. And the ORDER is the
// same as every other gate in this repository: request-shaped checks first (is
// there a record, is there a session, is it the right person), then the state of
// the thing being asked for — so a stranger is refused BEFORE they learn whether
// a clearance exists.
//
// PURE. Rows in, a verdict out. No store, no clock, no network.
// ---------------------------------------------------------------------------

import { employerApprovalState, MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE } from "./mobilityReview.js";
import { AUTHORIZATION_RECORD_TYPE, authorizationRecordFilename } from "./authorizationRecord.js";

export const RECORD_DELIVERY_REFUSALS = {
  authorization_not_found: { status: 404, reason: "No work-authorization request exists with this id." },
  session_required: {
    status: 401,
    reason:
      "A work-authorization record is about one named employee, so collecting it needs the same authenticated session the request was filed under.",
  },
  not_the_employee: {
    status: 403,
    reason:
      "A work-authorization record may only be collected by the employee it is about — including when a company admin filed the request on their behalf.",
  },
  employer_approval_not_recorded: {
    status: 409,
    reason:
      "There is no record to collect yet: the customer's manager has not approved this trip. That approval is made in Remote's product and is the first of the two decisions this record states.",
  },
  employer_declined: {
    status: 409,
    reason: "The customer's manager declined this trip, so there is no authorization to record.",
  },
  mobility_review_not_recorded: {
    status: 409,
    reason:
      "The employer has approved this trip and Remote's mobility review has not been recorded yet. The record is issued once that review is on file — issuing it earlier would state a clearance nobody has given.",
  },
  mobility_review_declined: {
    status: 409,
    reason:
      "Remote's mobility review of this trip was recorded as DECLINED, so there is no authorization to issue. The decision itself is on your request; this document is only ever produced for a cleared one.",
  },
};

/** @param {keyof RECORD_DELIVERY_REFUSALS} code */
export function refuseRecordDelivery(code, extra = {}) {
  const { status, reason } = RECORD_DELIVERY_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}

/**
 * May this session collect this request's work-authorization record, and is
 * there one to collect?
 *
 * @param {object} args
 * @param {object|null} args.authorizationRow  the `uc04_authorizations` row
 * @param {object|null} args.session  `{authenticatedEmploymentId}` — the employee's own,
 *   from the portal's server-owned persona map, never a body claim about someone else
 * @param {object|null} [args.review]  the stage-3 verdict (./mobilityReviewLog.js), passed
 *   IN rather than read so this stays pure
 * @returns {{allowed:boolean, code:string, reason:string, status:number}}
 */
export function evaluateAuthorizationRecordDelivery({ authorizationRow, session, review = null }) {
  if (!authorizationRow) return refuseRecordDelivery("authorization_not_found");
  if (!session?.authenticatedEmploymentId) return refuseRecordDelivery("session_required");
  if (session.authenticatedEmploymentId !== authorizationRow.employmentId) {
    return refuseRecordDelivery("not_the_employee");
  }

  const employer = employerApprovalState(authorizationRow);
  if (employer.declined) return refuseRecordDelivery("employer_declined");
  if (!employer.approved) return refuseRecordDelivery("employer_approval_not_recorded");

  if (!review) return refuseRecordDelivery("mobility_review_not_recorded");
  if (review.outcome !== "cleared") return refuseRecordDelivery("mobility_review_declined");

  return {
    allowed: true,
    code: "record_available",
    status: 200,
    reason:
      "The employer approved this trip and Remote's mobility review was recorded as cleared, so the record can be collected by the employee it is about.",
  };
}

/**
 * The record as a surface should hand it over: the bytes, what they are, and —
 * on the response itself, not only inside the HTML — the fact that Remote's own
 * systems hold nothing.
 *
 * WHY THE CAVEAT IS A FIELD AND NOT ONLY PROSE. A machine caller (or a future
 * screen) reads this JSON and never renders the document. `sentToRemote: false`
 * is assertable; a paragraph is not.
 *
 * @param {object} authorizationRow
 * @param {object} review
 * @param {string} html  the rendered record
 */
export function describeIssuedRecord(authorizationRow, review, html) {
  return {
    ok: true,
    code: "record_available",
    status: 200,
    authorizationId: authorizationRow.id,
    type: AUTHORIZATION_RECORD_TYPE,
    contentType: "text/html",
    filename: authorizationRecordFilename(authorizationRow.id),
    issuedAt: new Date().toISOString(),
    reviewedBy: review?.reviewer ?? null,
    reviewedAt: review?.at ?? null,
    // NEVER TRUE ON ANY PATH — see ./mobilityReview.js. Published as a literal
    // so a test can pin the guarantee rather than a sentence.
    sentToRemote: false,
    caveat: MOBILITY_REVIEW_NOTICE_FOR_EMPLOYEE,
    content: html,
  };
}
