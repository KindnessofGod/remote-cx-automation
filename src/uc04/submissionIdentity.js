// ---------------------------------------------------------------------------
// submissionIdentity.js  —  who is allowed to SUBMIT a work-authorization
//                            request, as opposed to who represents the company
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (2026-08-30)
//
// UC-04's identity gate used to be one comparison:
//
//     session.companyId === employment.company_id
//
// and only a company-admin session carries a `companyId`. So an employee could
// not file a workation request about their own trip: the gate answered
// `escalate / identity_not_verified`, a refusal that reads as a finding about
// the TRAVELLER while describing our own plumbing. The portal then grew a rule
// on top of it — "a workation request is filed by the company admin on the
// employee's behalf" — which was a consequence of the defect, not a decision
// anybody made. It is the only sentence in this repository that ever claimed
// it, and it contradicted UC-04.md §1/§2 ("Primary actor: Employee") and
// Remote's own object, which describes a WorkAuthorizationRequest as
// "submitted by an employee who needs authorization to work in a different
// country" and carries the employee (`user`) and the employer's manager
// (`employer_approver`) as two separate parties.
//
// THE DEFECT, NAMED: the gate conflated "who may SUBMIT" with "who represents
// the company". It applied the EMPLOYER's test to the EMPLOYEE's act. The
// employer's part of this use case is the APPROVAL, and that is enforced
// somewhere else entirely — `approvalPolicy.js` plus the role entitlement in
// `src/review/approverEntitlement.js`. Widening submission does not widen
// approval by one inch: nothing below can fill an approval slot, and the only
// value this function can return that unblocks anything is `verified: true`,
// which still leaves every other gate (employment status, employer permission,
// the factors, the risk matrix) exactly where it was.
//
// THE RULE. A submitter must be a PARTY TO THE RECORD. Either:
//
//   1. the employee who IS the subject — the session's own authenticated
//      employment id equals the id ON THE AUTHORITATIVE REMOTE RECORD; or
//   2. a company admin whose company matches — the session's company id equals
//      the company id on that record (unchanged, and kept: an admin filing on
//      an employee's behalf is a real support workflow).
//
// Anything else is `identity_not_verified`, exactly as before.
//
// FAIL-CLOSED, AND IT IS THE WHOLE POINT. Every comparison requires BOTH sides
// to be present and non-empty before it is even made. `null === null` once
// passed UC-06's and UC-09's identity gates (CLAUDE.md §4) because a session
// with no company and a record normalised to a null company compared equal;
// `undefined === undefined` would do the same here for two records neither of
// which has an id. Presence is checked first, then equality — never equality
// alone. Ids are compared as trimmed strings so a stray space cannot pass or
// fail a comparison on whitespace.
//
// THE RECORD'S OWN ID, NEVER THE REQUESTED ONE. `employment` here must be what
// Remote answered with. A caller that defaults the id back to the id from the
// request body turns this into a check of a claim against itself — a session
// asserting "I am employment X" would verify against a body asserting the same
// thing, with no record between them. `RemoteClient.getEmployment()` returns
// `null` for a 404 and `normalizeEmployment()` takes `id` off the payload, so
// the Node path is safe by construction; the n8n port (nodes-uc04/
// workationGates.js) has to say so explicitly, because ITS employment object
// deliberately falls back to `request.employmentId` for display.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SubmissionIdentity
 * @property {boolean} verified
 * @property {"employment_subject"|"company_actor"|null} basis
 *   which of the two accepted relationships was proved — null when none was.
 *   Reported so a reader is never shown "verified" without being told what it
 *   verified; no gate branches on it.
 */

/**
 * May this session file a work-authorization request about this employment?
 *
 * @param {object} args
 * @param {object|null} args.session  the authenticated session, or null.
 *   `{authenticatedEmploymentId}` for an employee, `{companyId,
 *   authenticatedAdminId}` for a company admin. Never built from a request body.
 * @param {object|null} args.employment  the employment record AS REMOTE
 *   RETURNED IT. Null (a 404, an unreachable API) verifies nothing.
 * @returns {SubmissionIdentity}
 */
export function verifySubmissionIdentity({ session, employment } = {}) {
  if (!session || !employment) return { verified: false, basis: null };

  // 1. The employee who is the subject. The id on the RECORD, not the one that
  //    was asked about.
  if (sameId(session.authenticatedEmploymentId, employment.id)) {
    return { verified: true, basis: "employment_subject" };
  }

  // 2. The company admin acting for their own company — the original rule,
  //    unchanged.
  if (sameId(session.companyId, employment.company_id)) {
    return { verified: true, basis: "company_actor" };
  }

  return { verified: false, basis: null };
}

/**
 * Equal, and PRESENT ON BOTH SIDES. Two absent values are not a match — that is
 * the `null === null` bug this file's header names, and it is the only reason
 * this is a function rather than a `===`.
 */
function sameId(a, b) {
  const left = idString(a);
  const right = idString(b);
  return Boolean(left) && Boolean(right) && left === right;
}

function idString(value) {
  return typeof value === "string" ? value.trim() : "";
}
