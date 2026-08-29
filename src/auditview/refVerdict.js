// ---------------------------------------------------------------------------
// refVerdict.js  —  WHAT does this reference actually let you trace?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The bug-audit tab took a reference, ran lookupRef(), and rendered three
// tables. When one of them came back empty it printed a bare "No decision rows
// carry this ref." — a sentence that is true of four completely different
// situations and distinguishes none of them:
//
//   * the reference was never used at all (a typo, or the wrong string);
//   * the reference WAS processed, the exactly-once ledger holds it and the
//     verdict it reached, and the decision row simply does not carry the
//     reference — so the reference cannot find it, and nothing about that is
//     the reader's mistake;
//   * the reference reached `audit_log` but never the ledger, because the path
//     that answered it returns BEFORE claiming (UC-02's application-level
//     duplicate gate does exactly that, readStore.js's DECISION_ACTIONS
//     explains why) — or because it predates the ledger existing at all;
//   * everything is present and the trace is complete.
//
// The second one is the one that matters and the one the old sentence hid
// hardest, because it reads to a requester as "your request left no record".
// Live, 2026-08-19, thirteen real portal submissions sat in exactly that
// state: `workflow_claims` held each reference AND the decision each run
// reached, and not one `audit_log` row carried the reference, so the answer
// the tables gave was an empty panel under a claim row. The request was fully
// decided and fully recorded; only the JOIN was missing.
//
// THIS MODULE DOES NOT FIX THAT — it names it. The fix belongs in the writer
// (each use case's own `audit.log({ details })`), which is one layer down and
// is where a repair stays repaired. A viewer that reconstructed the missing
// link by guessing — nearest row in time, matching decision word — would be
// the third copy of a value that has one true source, which is the failure
// mode CLAUDE.md §4 names ("the same manufactured zero appeared in three
// layers"). So: state what the store holds, state what it does not, and say
// which of the two you are looking at.
//
// IT IS A JUDGEMENT, SO IT IS SERVER-SIDE — the same division of labour
// traceVerdict.js follows. The page renders `headline`, `detail` and `notes`
// verbatim and decides nothing.
//
// rca-8mmd / R7-30: "Fully traceable" used to fire whenever a claim row AND
// a decision row both existed under the reference, regardless of what that
// decision WAS. A third-party door reference whose only decision was
// `human_review` — the request still sitting in review, its eventual
// approval recorded under a different reference issued at the hand-off —
// got the same "Fully traceable" headline as a reference whose decision was
// `auto_resolve`. Both claims were true (the ledger claimed the string,
// audit_log carries it); only one of them reached an outcome.
// `decisionReachesOutcome()` names the difference.
// ---------------------------------------------------------------------------

import { decisionReachesOutcome } from "./readStore.js";

/**
 * The verdict on one reference lookup.
 *
 * @param {object} input
 * @param {string} input.externalRef       the reference that was looked up
 * @param {object[]} [input.claims]        workflow_claims rows for it
 * @param {object[]} [input.decisions]     audit_log rows carrying it
 * @param {object[]} [input.alerts]        ops_alerts near its activity
 * @returns {{code: string, tone: "ok"|"warn"|"neutral", headline: string,
 *   detail: string, notes: string[], useCases: string[]}}
 */
export function refVerdict({ externalRef, claims = [], decisions = [], alerts = [] }) {
  const ref = String(externalRef ?? "");
  const useCases = [...new Set([...claims, ...decisions].map((r) => r.useCase).filter(Boolean))].sort();

  const notes = [];

  // ONE REFERENCE, MORE THAN ONE USE CASE — legitimate, and worth saying out
  // loud before a reader reads two claim rows as a double-processing bug.
  // `workflow_claims` is keyed (use_case, external_ref) precisely so that one
  // ticket reaching two use cases claims once in each: UC-03 routing a travel
  // request on to UC-04 is the designed case, and keying on the reference
  // alone would have silently dropped the second, which is worse than the
  // duplicate it would prevent (CLAUDE.md §4). So more than one use case here
  // is a hand-off, not a repeat; a repeat is more than one row under ONE pair,
  // which is what the duplicate-delivery banner above reports.
  if (useCases.length > 1) {
    notes.push(
      `This reference appears under ${useCases.length} use cases (${useCases.join(", ")}). That is a hand-off, ` +
        "not a repeat: workflow_claims is keyed (use case, reference), so one request reaching two use cases " +
        "claims once in each — UC-03 routing on to UC-04 is the designed case. A repeat would be two rows under " +
        "one use case, which the duplicate-delivery banner reports separately."
    );
  }

  if (!claims.length && !decisions.length) {
    return {
      code: "not_found",
      tone: "neutral",
      headline: "Nothing in the trail carries this reference.",
      detail:
        `Neither the exactly-once ledger (workflow_claims) nor audit_log holds "${ref}". Either it was never ` +
        "submitted, or the string differs from the one that was — references are matched exactly here, not by " +
        "prefix. Check it against the reference the portal reported after the submission.",
      notes,
      useCases,
    };
  }

  if (claims.length && !decisions.length) {
    // The claim row is not a consolation prize: it carries the use case, the
    // instant the delivery was claimed, and the decision the run reached. That
    // is the request's outcome, from the one table that recorded it under this
    // reference. Say so, rather than leaving the reader to read an empty
    // decisions panel as a lost request.
    const outcomes = claims
      .map((c) => `${c.useCase} → ${c.decision ?? "(no decision recorded on the claim)"}`)
      .join("; ");
    return {
      code: "claimed_not_audited",
      tone: "warn",
      headline: "This reference WAS processed — but no audit_log row carries it, so the reference alone cannot reach the decision.",
      detail:
        `The exactly-once ledger holds it and the verdict each run reached: ${outcomes}. The decision itself is ` +
        "in audit_log and is not missing; its `details` simply does not repeat the reference, so no lookup keyed " +
        "on the reference can find it. This is a gap in the WRITER, not in the trail and not in what you typed.",
      notes: notes.concat([
        "To reach the decision rows meanwhile: open the use case's own record for this request (the portal's " +
          '"My requests" table shows its record id), then paste that record id into this same box — the lookup ' +
          "searches every identifier these tables carry, not the reference alone, so a record id reaches the " +
          "rows the reference cannot. The feed's free-text filter matches it too.",
      ]),
      useCases,
    };
  }

  if (decisions.length && !claims.length) {
    return {
      code: "audited_not_claimed",
      tone: "neutral",
      headline: "Decisions carry this reference, but the exactly-once ledger has no claim for it.",
      detail:
        "Two ordinary causes, and neither is an error. A path may answer and RETURN before claiming — UC-02's " +
        "duplicate gate replays a stored decision without ever reaching the ledger — or the run predates the " +
        "ledger existing. A missing claim row is only suspicious when a run wrote a record it should have " +
        "claimed first.",
      notes,
      useCases,
    };
  }

  // WHICH of the decision-kind rows under this reference is the most
  // recent, and did IT settle the request? A claim row and a decision row
  // both existing says the JOIN works — it says nothing about whether the
  // decision itself was the request's last word. `human_review` and
  // `auto_resolve` are both decisions; only one of them is an answer.
  const decisionRows = decisions.filter((d) => decisionReachesOutcome(d.action) !== null);
  const latestDecision = decisionRows.length ? decisionRows[decisionRows.length - 1] : null;

  if (latestDecision && decisionReachesOutcome(latestDecision.action) === false) {
    return {
      code: "traced_pending",
      tone: "warn",
      headline:
        `This reference reaches the trail, but not yet an outcome — the most recent decision under it is ` +
        `"${latestDecision.action}", a hand-off still awaiting a further step, not the request's answer.`,
      detail:
        `${claims.length} claim row${claims.length === 1 ? "" : "s"} and ${decisions.length} decision ` +
        `row${decisions.length === 1 ? "" : "s"} under "${ref}". The ledger claimed the string and audit_log ` +
        "carries it — that part is not in question — but if this request was later approved, declined, or " +
        "otherwise settled, that verdict may be recorded under a DIFFERENT reference issued at the hand-off " +
        "(a Zendesk ticket id, for one), which this lookup does not follow. Click the decision row to see what " +
        "it handed off to.",
      notes,
      useCases,
    };
  }

  return {
    code: "traced",
    tone: "ok",
    headline: "Fully traceable: the ledger claimed this reference and audit_log rows carry it.",
    detail:
      `${claims.length} claim row${claims.length === 1 ? "" : "s"} and ${decisions.length} decision ` +
      `row${decisions.length === 1 ? "" : "s"} under "${ref}"` +
      (alerts.length
        ? `, with ${alerts.length} ops alert${alerts.length === 1 ? "" : "s"} inside the ±15-minute window around them.`
        : ". No ops alert landed near it.") +
      " Click any decision row to open its attempts.",
    notes,
    useCases,
  };
}
