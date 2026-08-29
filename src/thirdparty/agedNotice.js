// ---------------------------------------------------------------------------
// agedNotice.js — G-4/F1: the notification path VC-32 Amendment 2 requires
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Owner answer A5 / DRIFT-041: "age and warn everywhere, lapse nowhere" — no
// consent record may transition on elapsed time alone. VC-32 as first drafted
// implemented that for OUR OWN queue only; the Validator's Amendment 2 caught
// that the acceptance contract's own §11 states a second, human-approved
// requirement A5 does not reach: "the third-party path needs a window after
// which an unanswered consent request is closed and the third party told
// Remote could not obtain permission." A5 forbids the first half (closing is
// a state change); it says nothing about the second, because telling a
// waiting counterparty something is a MESSAGE, not a decision.
//
// THE ONE INVARIANT THIS FILE EXISTS TO HOLD (Amendment 2, invariant 14)
// If this message reaches a real employee's unanswered request but not a
// request about nobody Remote has ever heard of, the MESSAGE ITSELF is an
// existence disclosure — breaching invariant 14 in the act of satisfying §11.
// So this file follows src/thirdparty/server.js's own discipline exactly:
// THIRD_PARTY_AGED_NOTICE_MESSAGE is a constant with no parameters, and
// eligibility is decided by ONE re-derived judgement
// (src/approvalqueue/awaiting.js's awaitingState(), already built and tested
// for exactly this question — "is a person still waiting on this?") rather
// than by asking "was this case about a real, unanswered employee" — which is
// precisely the question invariant 14 forbids answering out loud.
//
// WHY EVERY THIRD-PARTY-DOOR CASE CARRIES A returnAddress, NOT ONLY THE
// PENDING ONES
// A `consent_records` row only ever exists for the awaiting_employee_consent
// branch — never for a request about someone who does not exist at Remote at
// all (that reaches `escalate`/`identity_not_verified`, which still creates a
// `cases` row, just no consent artifact). Keying this sweep off
// `consent_records` would therefore be asymmetric BY CONSTRUCTION: a real
// unanswered employee could eventually get the notice and a nonexistent one
// never would, which is exactly the leak this file exists to prevent. `cases`
// is written for every third-party-door submission regardless of outcome
// (src/uc01/workflow.js STEP 6a returns early only for `out_of_scope`, which
// a third-party door submission does not reach), so it is the row all three
// of VC-33's cases share, and `returnAddress` is carried onto it uniformly by
// src/uc01/workflow.js.
//
// WHAT "ELIGIBLE" MEANS, PRECISELY
// A case is due for the notice when: it came from the third-party door, it
// carries a return address, nobody has been notified yet
// (`agedNoticeSentAt` is null), it is at least CONSENT_AGE_WARN_DAYS old, AND
// awaitingState() still reports it "awaiting" — a human closing the case
// (approving or declining a disclosure through the ordinary review path)
// takes it out of "awaiting" and out of this sweep's reach, on the reasoning
// that a human who resolved it has already communicated something, by
// whatever channel that review used. A case answered by GRANTING consent is
// no different from one answered by REFUSING it or one an operator simply
// closed — all three stop being "awaiting" and all three stop being
// eligible, which is what keeps this file from ever having to ask which one
// happened.
// ---------------------------------------------------------------------------

import { CONSENT_AGE_WARN_DAYS } from "../shared/consentPolicy.js";
import { awaitingState } from "../approvalqueue/awaiting.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * THE ONE SENTENCE EVERY AGED THIRD-PARTY REQUEST EVER RECEIVES.
 *
 * A constant, not a function of anything about the specific case — same
 * discipline as `THIRD_PARTY_ACK_MESSAGE` (src/thirdparty/server.js), and for
 * the same reason: nothing here may branch on what was actually found.
 */
export const THIRD_PARTY_AGED_NOTICE_MESSAGE =
  "Following up on the request you sent us: we were not able to obtain the employee's permission in time to share anything further. If that changes, we will be in touch — there's nothing further for you to do right now.";

/**
 * Every third-party-door case due for the aged notice, right now.
 * @param {object} args
 * @param {import("../shared/caseStore.js").CaseStore} args.caseStore
 * @param {number} [args.now]  epoch ms, injectable for tests
 * @returns {Promise<{caseId: string, returnAddress: string, message: string}[]>}
 */
export async function findAgedThirdPartyCases({ caseStore, now = Date.now() }) {
  const cases = await caseStore.listByUseCase("UC-01");
  const due = [];
  for (const c of cases) {
    if (c.source !== "third_party_door") continue;
    if (!c.returnAddress) continue;
    if (c.agedNoticeSentAt) continue;

    const ageMs = now - new Date(c.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < CONSENT_AGE_WARN_DAYS * DAY_MS) continue;

    const queueStatus = await caseStore.findReviewQueueStatus(c.id);
    const awaiting = awaitingState({ useCase: "UC-01", status: c.status, queueStatus });
    if (awaiting.state !== "awaiting") continue;

    due.push({ caseId: c.id, returnAddress: c.returnAddress, message: THIRD_PARTY_AGED_NOTICE_MESSAGE });
  }
  return due;
}

/**
 * Record the aged notice for every case due right now, and mark each one
 * notified so a repeated sweep never resends it. NEVER touches `cases.status`
 * or any `consent_records` row — Amendment 2's own wording: "the consent
 * record's status is unchanged; the request remains open and answerable."
 *
 * Recorded via `logStandaloneTraceStep()` rather than `logDurable()` on
 * purpose — VC-32's own evidence line: "the warning is recorded; no decision
 * row appears." A communication is traced, not decided.
 *
 * @param {object} args
 * @param {import("../shared/caseStore.js").CaseStore} args.caseStore
 * @param {import("../shared/audit.js").AuditLogger} args.audit
 * @param {number} [args.now]
 * @returns {Promise<{caseId: string, returnAddress: string, message: string}[]>} what was sent
 */
export async function sweepAgedThirdPartyNotices({ caseStore, audit, now = Date.now() }) {
  const due = await findAgedThirdPartyCases({ caseStore, now });
  const sentAt = new Date(now).toISOString();
  for (const item of due) {
    await audit.logStandaloneTraceStep({
      call: "uc01.third_party_aged_notice",
      ok: true,
      details: { caseId: item.caseId, message: THIRD_PARTY_AGED_NOTICE_MESSAGE },
    });
    await caseStore.markAgedNoticeSent(item.caseId, sentAt);
  }
  return due;
}
