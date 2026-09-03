// ---------------------------------------------------------------------------
// reportDelivery.js  —  who may collect the signed-off notice report, and when
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-05 has no Remote write. `resignationStore.js`, `signoffPolicy.js` and
// `workflow.js` all say the same thing in their headers: **the signed-off
// report IS the durable artifact**, because no Remote termination endpoint is
// confirmed to exist. The portal card promises it in as many words — *"HR Ops
// checks the figures and signs them off, and that signed-off summary is the
// record."*
//
// There was no such summary. A UC-05 row that reached `signed_off` showed
// `DOCUMENT: —` in "My requests", and `POST /api/requests/uc05/report`,
// `/letter` and `/record` all answered **404 `no_such_route`**. UC-01 has
// `/uc01/letter` and `/uc01/letter/pdf`; UC-04 has `/uc04/record`. The one use
// case whose entire output is a document produced none.
//
// This is `src/uc04/recordDelivery.js` applied to UC-05's shape — same file for
// the same reason, and with the same one extra condition beyond UC-01's and
// UC-03's letter gates: an ORDERING rule. UC-04's record may not be collected
// before the decisions it records have been taken; this report may not be
// collected before the sign-off that makes it a record at all.
//
// ---------------------------------------------------------------------------
// WHY SIGN-OFF IS THE LINE, AND WHY IT IS NOT NEGOTIABLE
// ---------------------------------------------------------------------------
// Everything in this document — a statutory notice period, a last working day,
// a holiday settlement figure — is a CALCULATION until HR Ops confirms it. A
// prepared report handed over as "the record" would be a number nobody has
// checked, on the document an employee reads to find out when they stop working
// and what they are owed. `evaluateResignationActionability()` in
// ./signoffPolicy.js is what decides whether the sign-off is even open; this
// gate reads the settled STATE, which is the only thing that answers "is this a
// record yet".
//
// So `pending_signoff` is refused, and refused by its own name rather than as a
// general "not available": the employee is waiting on a named person, and the
// difference between *waiting* and *there is nothing here* is the difference
// between coming back tomorrow and phoning somebody.
//
// AN ESCALATED RESIGNATION HAS NO REPORT AND NEVER WILL. It never entered the
// sign-off path (`decision !== "prepared_for_signoff"`), so there is nothing to
// sign and no artifact to withhold — that is a different sentence from "not
// yet", and collapsing the two would tell somebody to wait for a document that
// is not coming.
//
// THE SUBJECT, NOT THE FILER — the identical rule UC-01's, UC-03's and UC-04's
// gates apply. This document names one employee, states when their employment
// ends and what they are owed. It goes to that employee. UC-05 already refuses
// any filer but the resigning employee (`persona.kind !== "employee"` in the
// portal, `requesterType: "self"` in the workflow), so the two agree by
// construction — and this gate still compares rather than assuming, because
// "they agree today" is not a guarantee.
//
// FAILS CLOSED. No session at all is `session_required`, never "probably the
// employee". A missing row is `resignation_not_found`. And the ORDER is every
// other gate's in this repository: request-shaped checks first (is there a
// record, is there a session, is it the right person), then the state of the
// thing being asked for — so a stranger is refused BEFORE they learn whether a
// person has resigned.
//
// PURE. Rows in, a verdict out. No store, no clock, no network.
// ---------------------------------------------------------------------------

import { canonicalDecisionStatus } from "../shared/declineVocabulary.js";
import { NOTICE_REPORT_TYPE, noticeReportFilename, NO_REMOTE_WRITE_NOTICE } from "./noticeReport.js";

export const REPORT_DELIVERY_REFUSALS = {
  resignation_not_found: { status: 404, reason: "No resignation exists with this id." },
  session_required: {
    status: 401,
    reason:
      "A notice and settlement report is about one named employee, so collecting it needs the same authenticated session the resignation was filed under.",
  },
  not_the_employee: {
    status: 403,
    reason: "A notice and settlement report may only be collected by the employee it is about.",
  },
  report_not_signed_off: {
    status: 409,
    reason:
      "There is nothing to collect yet: HR Ops has not signed this report off. Until they do, the notice period and the holiday settlement on it are a calculation rather than a record, and issuing it now would hand over figures nobody has checked.",
  },
  report_declined: {
    status: 409,
    reason:
      "HR Ops did not sign this report off, so there is no record to issue. The decision itself, and any reason they gave, is on your request.",
  },
  report_never_prepared: {
    status: 409,
    reason:
      "This resignation was escalated rather than prepared for sign-off, so no report was ever produced for it and none is coming. A person is working it on its own ticket; what they decide will show on your request.",
  },
};

/** @param {keyof REPORT_DELIVERY_REFUSALS} code */
export function refuseReportDelivery(code, extra = {}) {
  const { status, reason } = REPORT_DELIVERY_REFUSALS[code];
  return { allowed: false, code, reason, status, ...extra };
}

/**
 * May this session collect this resignation's signed-off report, and is there
 * one to collect?
 *
 * @param {object} args
 * @param {object|null} args.resignationRow  the `uc05_resignations` row
 * @param {object|null} args.session  `{authenticatedEmploymentId}` — the employee's own,
 *   from the portal's server-owned persona map, never a body claim about someone else
 * @returns {{allowed:boolean, code:string, reason:string, status:number}}
 */
export function evaluateResignationReportDelivery({ resignationRow, session }) {
  if (!resignationRow) return refuseReportDelivery("resignation_not_found");
  if (!session?.authenticatedEmploymentId) return refuseReportDelivery("session_required");
  if (session.authenticatedEmploymentId !== resignationRow.employmentId) {
    return refuseReportDelivery("not_the_employee");
  }

  // NEVER ENTERED THE SIGN-OFF PATH AT ALL. Checked before the status, because
  // an escalated row's status is `escalated` and reading that as "not signed off
  // yet" would promise a sign-off that cannot happen — ./signoffPolicy.js
  // refuses the action outright with `not_awaiting_signoff`.
  if (resignationRow.decision !== "prepared_for_signoff") {
    return refuseReportDelivery("report_never_prepared");
  }

  // canonicalDecisionStatus() so a row stored as `denied` before the 2026-08-19
  // rename still refuses under the decline sentence rather than falling through
  // to "not signed off yet" — which would tell somebody to wait for a decision
  // that has already been taken against them.
  if (canonicalDecisionStatus(resignationRow.status) === "declined") {
    return refuseReportDelivery("report_declined");
  }
  if (resignationRow.status !== "signed_off") {
    return refuseReportDelivery("report_not_signed_off");
  }

  return {
    allowed: true,
    code: "report_available",
    status: 200,
    reason:
      "HR Ops signed this report off, so it can be collected by the employee it is about. The signed-off report is the record — UC-05 has no Remote write behind it.",
  };
}

/**
 * The report as a surface should hand it over: the bytes, what they are, and —
 * on the response itself, not only inside the HTML — the fact that Remote's own
 * systems hold nothing.
 *
 * WHY THE CAVEAT IS A FIELD AND NOT ONLY PROSE — src/uc04/recordDelivery.js's
 * reasoning, unchanged: a machine caller reads this JSON and never renders the
 * document, and `sentToRemote: false` is assertable where a paragraph is not.
 *
 * @param {object} resignationRow
 * @param {string} html  the rendered report
 */
export function describeIssuedReport(resignationRow, html) {
  // `{approver, note, at}` — the slot recordSignoff() writes. The older flat
  // columns are read as a fallback for a row written before it existed, the
  // same both-shapes discipline describeSettled() applies in ./signoffPolicy.js.
  const signedOff = resignationRow?.signedOffBy ?? null;
  return {
    ok: true,
    code: "report_available",
    status: 200,
    resignationId: resignationRow.id,
    type: NOTICE_REPORT_TYPE,
    contentType: "text/html",
    filename: noticeReportFilename(resignationRow.id),
    issuedAt: new Date().toISOString(),
    signedOffBy:
      (typeof signedOff === "string" ? signedOff : signedOff?.approver) ?? resignationRow?.signedOffBy ?? null,
    signedOffAt: signedOff?.at ?? resignationRow?.signedOffAt ?? null,
    // NEVER TRUE ON ANY PATH — UC-05 has no Remote write endpoint and the
    // workflow takes no client that could make one. Published as a literal so a
    // test can pin the guarantee rather than a sentence.
    sentToRemote: false,
    caveat: NO_REMOTE_WRITE_NOTICE,
    content: html,
  };
}
