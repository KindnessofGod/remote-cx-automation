// ---------------------------------------------------------------------------
// humanDecision.js  —  A person's verdict, read out of an audit_log row
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The 🟡 human-in-the-loop tier is the whole point of the medium-risk design:
// the automation prepares and risk-scores, and a NAMED PERSON decides. Live,
// 2026-08-19, that moment looked like this in the viewer:
//
//   04:50:48.103  UC-02  expense_review_release   Follow-up event
//   04:50:48.453  UC-02  expense_released_write   Follow-up event
//
// A Finance Ops specialist authorising a reimbursement rendered exactly like a
// tag update. Neither row was in DECISION_ACTIONS, and the second was not in
// EXECUTION_ACTIONS either, though its four siblings on the automated paths
// (`expense_approved_write`, `workation_executed`, `amendment_executed`,
// `adjustment_executed`) all were. The single most consequential act in the
// system was the least legible row on the page.
//
// This file holds the two judgements that fixes, both derived by READING THE
// WRITERS (src/uc02/workflow.js's submitExpenseReview, src/uc04's
// submitWorkationApproval, src/uc05's, src/uc06's and src/uc09's equivalents,
// and src/review/service.js) rather than from the shape of an action string:
//
//   humanVerdictOf(action)   is this row a person's verdict, and what did they
//                            decide, in plain words?
//   writeOutcome({...})      did the write this DECISION authorised actually
//                            land at Remote — as far as this trail can tell?
//                            Not human-verdicts-only (see writeOutcome()'s own
//                            header: R7-32 / rca-ltja found it skipped every
//                            automated row, which is exactly where a reader is
//                            most likely to trust an unevidenced claim).
//
// BOTH ARE THE SERVER'S JUDGEMENT, not the page's. app.js renders what it is
// sent and re-derives nothing, the rule every browser asset in this repo
// follows.
//
// THE SAFETY DIRECTION IS THE ONE readStore.js ALREADY TAKES. An action this
// file does not recognise is not a human verdict, and writeOutcome() reports
// what the trail HOLDS rather than predicting what should have happened: an
// absent write is stated as absent, with both readings named, never resolved
// into "it failed" or "that is fine".
// ---------------------------------------------------------------------------

/**
 * THE HUMAN-VERDICT VOCABULARY — the actions that record a PERSON's decision,
 * with the plain word for what they decided.
 *
 * THE TEST EACH ONE PASSES, and it is DECISION_ACTIONS' own test: the row is
 * the request's answer, and it is written INSTEAD of a second automated
 * decision row rather than alongside one. Every entry below is appended by an
 * approval handler that a human's click reaches; none of them has a policy
 * engine re-run behind it, so nothing else records that person's verdict.
 *
 * READ OFF THE WRITERS, one call site at a time:
 *
 *   expense_review_release    src/uc02/workflow.js  submitExpenseReview() —
 *   expense_review_decline    logDurable FIRST, before the freshness re-read,
 *   expense_review_hold       the state move and the PATCH. The header there
 *                             says why: "if everything below fails, we still
 *                             know who decided what and when."
 *   workation_approved        src/uc04/workflow.js  submitWorkationApproval()
 *   workation_declined        (was workation_denied before 2026-08-19)
 *   resignation_signed_off    src/uc05/workflow.js  submitResignationSignoff()
 *   resignation_declined      (was resignation_denied before 2026-08-19)
 *   amendment_approved        src/uc06/workflow.js  submitAmendmentApproval()
 *   amendment_declined        (was amendment_denied before 2026-08-19)
 *   adjustment_approved       src/uc09/workflow.js  submitAdjustmentApproval()
 *   adjustment_denied
 *   human_approved            src/review/service.js submitReviewDecision() —
 *   human_declined            the ZAF sidebar's own pair, carrying whichever
 *                             use case the case row names.
 *
 * A SLOT IS STILL A VERDICT. `amendment_approved` and `adjustment_approved`
 * each record ONE role's signature on a request needing two or three; the
 * request is not settled by them. They are still that person's answer, and
 * they are still the only row recording it — so they are decisions, and the
 * word beside them says "one role's slot" rather than implying the request is
 * done. Calling them events made a payroll signature render like a tag update,
 * which is the defect this file exists to close.
 *
 * `hold` IS INCLUDED AND IS NOT AN OVERSIGHT. It is a deferral, and a deferral
 * decided by a person is a verdict: UC-02's handler writes the row and returns
 * (no Remote status exists for a hold), so it is the whole of that invocation.
 *
 * WHAT IS DELIBERATELY ABSENT, each read and rejected:
 *
 *   *_refused                   the SYSTEM refusing to accept an attempted
 *   human_*_refused             verdict — a wrong role, a case already decided,
 *                               an escalation with no review path. No person's
 *                               decision was recorded, so there is no verdict
 *                               to show. (src/uc0N/workflow.js recordRefusal.)
 *   *_execution_blocked         follow-ups OF a verdict that already has its
 *   *_execution_not_claimed     own row: the freshness re-read said no, or
 *   resignation_signoff_blocked another caller won the compare-and-set.
 *   amendment_*_consented       src/remoteui/server.js — consent is an INPUT to
 *                               the amendment (UC-06's signature stage), not an
 *                               answer to it. The answer is the dual approval.
 *   expense_auto_approved       no human anywhere near it.
 *
 * TWO RENAMES HAVE LANDED BESIDE THIS, AND BOTH SPELLINGS STAY PERMANENTLY.
 * UC-02's review verb moved `release` -> `approve`, and on 2026-08-19 the
 * negative verb moved `deny` -> `decline` across UC-01's review, UC-04, UC-05
 * and UC-06 (`deny` appears zero times in Remote's documented corpus; see
 * docs/REMOTE-VOCABULARY.md §2.1). So this map lists `expense_review_release`
 * beside `expense_review_approve`, and the four `*_denied` names beside their
 * `*_declined` successors.
 *
 * `audit_log` is APPEND-ONLY and was not rewritten. The rows already written
 * under an old verb are live history a specialist searches, and a vocabulary
 * that forgot the old spelling would un-classify real rows the day the rename
 * shipped — turning a recorded human decision into an unrecognised event. The
 * old entries are therefore not deprecated and have no removal date.
 *
 * `adjustment_denied` has NO `*_declined` twin because UC-09 was not renamed
 * in that pass; it is the one use case still writing `deny`.
 *
 * @type {Record<string, {word: string, shape: "settles"|"slot"|"defers"}>}
 */
const HUMAN_VERDICTS = Object.freeze({
  human_approved: { word: "approved", shape: "settles" },
  human_declined: { word: "declined", shape: "settles" },
  human_denied: { word: "denied", shape: "settles" }, // pre-2026-08-19 spelling

  // UC-02 — both spellings of the same verb; see the note above.
  expense_review_release: { word: "released for payment", shape: "settles" },
  expense_review_approve: { word: "approved for payment", shape: "settles" },
  expense_review_decline: { word: "declined", shape: "settles" },
  expense_review_hold: { word: "held — still open", shape: "defers" },

  workation_approved: { word: "approved", shape: "settles" },
  workation_declined: { word: "declined", shape: "settles" },
  workation_denied: { word: "denied", shape: "settles" }, // pre-2026-08-19 spelling

  resignation_signed_off: { word: "signed off", shape: "settles" },
  resignation_declined: { word: "declined", shape: "settles" },
  resignation_denied: { word: "denied", shape: "settles" }, // pre-2026-08-19 spelling

  amendment_approved: { word: "approved — one role's slot", shape: "slot" },
  amendment_declined: { word: "declined", shape: "settles" },
  amendment_denied: { word: "denied", shape: "settles" }, // pre-2026-08-19 spelling

  adjustment_approved: { word: "approved — one role's slot", shape: "slot" },
  adjustment_denied: { word: "denied", shape: "settles" },
});

/** Every action this file recognises as a person's verdict. */
export const HUMAN_VERDICT_ACTIONS = Object.freeze(new Set(Object.keys(HUMAN_VERDICTS)));

/**
 * The plain word for what a person decided, or null when this action is not a
 * person's verdict at all. Never a guess — an unknown action is not a human
 * decision here, which is the under-claiming direction.
 *
 * @param {string} action
 * @returns {{word: string, shape: "settles"|"slot"|"defers"}|null}
 */
export function humanVerdictOf(action) {
  if (typeof action !== "string") return null;
  return HUMAN_VERDICTS[action] ?? null;
}

/**
 * The rows that say an execution was STOPPED after a person authorised it.
 *
 * Read off the same handlers: each is written on a path that returns without
 * ever calling `remote.*`, so a record carrying one has a verdict and no
 * write, for a stated reason. Enumerated rather than matched on a suffix,
 * because the suffix lies in both directions — `amendment_execution_blocked`
 * contains "execution" and means nothing was executed, while
 * `resignation_signoff_blocked` contains neither "execution" nor "write".
 */
const EXECUTION_STOPPED_ACTIONS = Object.freeze(
  new Set([
    "expense_review_execution_blocked",
    "workation_execution_blocked",
    "amendment_execution_blocked",
    "amendment_execution_not_claimed",
    "adjustment_execution_blocked",
    "adjustment_execution_not_claimed",
    "resignation_signoff_blocked",
  ])
);

/**
 * Did the write this decision authorised actually land at Remote?
 *
 * `details.remoteResult` IS THE FACT, and its absence is the thing worth
 * seeing: a decision with no execution row beneath it means the request was
 * answered and nothing in this trail records Remote having taken any outward
 * action. That is the distinction the rest of the system works hard to keep
 * visible — the audit write is ordered BEFORE the outward act precisely so
 * the two CAN disagree — and burying it was half of what made a human
 * decision unreadable here.
 *
 * RUNS ON EVERY DECISION ROW, A PERSON'S VERDICT OR A FULLY AUTOMATED ONE
 * ALIKE — this was NOT always true, and the gap cost a real finding (R7-32,
 * rca-ltja). The check used to run only when `humanVerdictOf(decision.action)`
 * held, so an automated `auto_resolve` row — carrying `letterIssued: true`
 * and three attempts (`n8n.run`, `openai.classify`, `remote.employment`), none
 * of which is an outward write — showed no warning at all: the block was
 * simply hidden, because the row was not a human's verdict. Attempts existing
 * is not evidence an outward write happened, and the rows most likely to be
 * trusted at a glance — the fully automated ones — were exactly the ones this
 * check skipped. Now it runs on any row `kind === "decision"` (readStore.js's
 * DECISION_ACTIONS), which is the same "the request's answer" test that
 * vocabulary already passes; `humanVerdictOf` stays as a fallback for a
 * `decision` object built without `kind` (this file's own unit tests do).
 *
 * IT REPORTS, IT DOES NOT PREDICT. Whether a given decision SHOULD produce a
 * write is use-case specific and not always knowable from one row: UC-02
 * writes on a decline as well as a release but never on a hold, UC-04 writes
 * only on an approve, UC-06/UC-09 write only once every slot is filled, UC-01
 * has no execution row for its letter at all (readStore.js's own header names
 * this), and UC-05 has no Remote write endpoint at all (CLAUDE.md §4), so its
 * sign-off correctly produces none. Guessing would paint a red "missing
 * write" over a perfectly correct record. So `no_write_recorded` names both
 * readings and resolves neither — that is exactly why it is also the honest
 * answer for a decision like `escalate` or `blocked`, which never call for a
 * write at all: the wording already says so.
 *
 * SCOPED TO THE RECORD, NOT THE SUBMISSION, and to rows at or after this
 * verdict — the same grouping readStore.js's CORRELATION_FIELDS documents. On
 * a two-slot record the execution follows the SECOND signature, so the first
 * slot's drill-down honestly reports a write on the record, not a write caused
 * by that slot alone. The headline says "on this record" for that reason.
 *
 * @param {object} args
 * @param {object} args.decision   the audit_log row being explained
 * @param {object[]} [args.siblings]  the rows sharing its record id (from the
 *   store, already carrying `kind` and `hasRemoteResult`)
 * @returns {{code: string, headline: string, detail: string}|null}  null when
 *   the row is not a decision at all (an execution or a follow-up event), so
 *   nothing is claimed about it.
 */
export function writeOutcome({ decision, siblings = [] }) {
  if (!decision) return null;
  if (decision.kind !== "decision" && !humanVerdictOf(decision.action)) return null;

  const after = siblings.filter((s) => compareIso(s.at, decision.at) >= 0);

  const executed = after.find((s) => s.kind === "execution");
  if (executed) {
    return executed.hasRemoteResult
      ? {
          code: "remote_confirmed",
          headline: "Remote confirmed the write.",
          detail:
            `"${executed.action}" was recorded on this record after the call to Remote returned, and it carries ` +
            "Remote's own response. That row is the proof the write landed — open it to read what Remote said.",
        }
      : {
          code: "execution_without_response",
          headline: "A write was recorded, but Remote's own response is not on it.",
          detail:
            `"${executed.action}" is on this record and carries no remoteResult. The row that should hold Remote's ` +
            "answer does not, so the write cannot be confirmed from this trail — read it as unconfirmed, not as done.",
        };
  }

  const stopped = after.find((s) => EXECUTION_STOPPED_ACTIONS.has(s.action));
  if (stopped) {
    return {
      code: "execution_stopped",
      headline: "The decision stands; the write was stopped before it fired.",
      detail:
        `"${stopped.action}" was recorded after this verdict, so nothing was sent to Remote. The person's decision ` +
        "is durable either way — that ordering is deliberate — but no state changed at Remote.",
    };
  }

  // rca-8qzr / R7-46: the ops-alerts tiebreak only makes sense beside a row an
  // n8n EXECUTION could have produced. `ops_alerts` is written by the separate
  // "RCX OPS · Error Alerts" graph on a FAILED n8n run; a human's own verdict
  // (approve/decline in the ZAF sidebar, a specialist's sign-off) is never an
  // n8n execution and can never appear there, so offering the tiebreak beside
  // one is advice that is structurally unanswerable. Scoped to automated
  // decisions only — humanVerdictOf() is the same test DECISION_ACTIONS
  // already spreads HUMAN_VERDICT_ACTIONS from, so this reuses it rather than
  // re-deriving "was this a person's verdict" a second way.
  const opsAlertsMayApply = !humanVerdictOf(decision.action);
  return {
    code: "no_write_recorded",
    headline: "No write to Remote is recorded on this record.",
    detail:
      "Nothing sharing this record's id carries Remote's response. Two readings, and this trail does not choose " +
      "between them: the verdict may not call for a Remote write at all (a denial, a hold, a further signature " +
      "still outstanding, or a use case with no write endpoint — UC-05 has none), or the write was attempted and " +
      "never got as far as being recorded." +
      (opsAlertsMayApply ? " Check the ops alerts around this time before assuming the first." : ""),
  };
}

/** ISO/Date-tolerant compare; the store hands back strings, pg hands back Dates. */
function compareIso(a, b) {
  const left = a instanceof Date ? a.toISOString() : String(a ?? "");
  const right = b instanceof Date ? b.toISOString() : String(b ?? "");
  return left.localeCompare(right);
}
