// ---------------------------------------------------------------------------
// traceVerdict.js  —  WHY does this decision have no attempts under it?
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// The drill-down's Attempts table used to answer an empty `audit_trace` with
// one line covering every possible cause: "either it predates the trace nodes,
// or it made no LLM/API calls." Technically true, practically useless — it is
// a shrug with two branches, and a reader who opened decision
// 07a11ea4 (UC-02, `expense_auto_approved`) could not tell whether they were
// looking at a defect, a gap in deployment, or a perfectly healthy run.
//
// That row was healthy in TWO ways at once and the message named neither:
//   - it was a FOLLOW-UP EVENT, not the decision (the `auto_approve` row 11ms
//     earlier is the decision, and attempts hang off THAT parent_id); and
//   - the submission ran the rule-based classifier and read Remote through the
//     portal's mock fixtures, so there was no LLM call and no network call for
//     anything to trace.
//
// So this module turns the shrug into a verdict, from evidence that is in the
// data:
//   traced             attempts exist; nothing to explain.
//   sibling_has_trace  a correlated row on the same record HAS attempts —
//                      and this one is named, so the reader can click it.
//   execution_row      this row records a REAL OUTWARD ACT — a write that left
//                      the system and changed something at Remote — performed
//                      after a decision row on the same record. It is empty
//                      for an ordinary reason: performing the write is not an
//                      LLM/API *attempt* in the traced sense, and the traced
//                      work (classify, read the record) sits on the decision.
//                      Kept DISTINCT from follow_up_event because the badge on
//                      the same screen says "Execution", and prose calling it a
//                      follow-up event would contradict the badge beside it —
//                      and because this is the row carrying Remote's own
//                      response, the most consequential row in its group.
//   follow_up_event    this row is a lifecycle event of a decision row that is
//                      also empty. Attempts hang off a decision's parent_id,
//                      never off an event, so the decision is where to look
//                      and its own verdict finishes the explanation.
//   predates_tracing   this decision is older than the oldest audit_trace row
//                      that exists anywhere. Nothing was tracing yet.
//   no_traceable_call  the row itself says which path answered:
//                      `*_source: "rule_based_fallback"` (no LLM call was made
//                      at all) and/or `source: "portal"` (the portal's Remote
//                      reads go to the mock fixtures, not the live API).
//   unexplained        zero attempts and nothing in the row accounts for it.
//                      Deliberately kept as a distinct, visible answer: "we do
//                      not know" is the honest verdict when it is the true
//                      one, and collapsing it into one of the benign codes
//                      above would hide a trace branch that is actually broken.
//
// IT IS A JUDGEMENT, SO IT IS SERVER-SIDE. The page renders `headline`,
// `detail` and `evidence` verbatim and decides nothing (CLAUDE.md §9: the
// shell renders, the API decides). Money formatting stays in the browser
// because that is presentation; "why is this empty" is not.
// ---------------------------------------------------------------------------

/**
 * Fields whose value names WHICH path produced a result. Each one is written
 * by a real call site — see issue #25 / `00-FOUNDATION.md` §4 invariant 8,
 * which requires every LLM-with-fallback function to tag its own source.
 */
const SOURCE_FIELDS = [
  { path: ["classification", "source"], label: "classification.source", what: "request classification" },
  { path: ["categorySource"], label: "categorySource", what: "expense-category classification" },
  { path: ["extractionSource"], label: "extractionSource", what: "resignation-date extraction" },
  { path: ["parseSource"], label: "parseSource", what: "inquiry parsing" },
];

const RULE_BASED = "rule_based_fallback";

/**
 * Build the verdict for one decision's Attempts table.
 *
 * @param {object} input
 * @param {object} input.decision   the full audit_log row (with `details`)
 * @param {object[]} input.trace    its audit_trace rows (may be empty)
 * @param {object[]} [input.siblings]  correlated rows, each with `traceCount`
 * @param {{field: string|null, key: string|null}} [input.correlation]
 * @param {string|null} [input.earliestTraceAt]  oldest audit_trace row anywhere
 * @returns {{code: string, headline: string, detail: string,
 *   evidence: {field: string, value: string, meaning: string}[],
 *   relatedDecisionId: string|null}}
 */
export function traceVerdict({
  decision,
  trace = [],
  siblings = [],
  correlation = { field: null, key: null },
  earliestTraceAt = null,
}) {
  if (trace.length > 0) {
    return verdict("traced", `${trace.length} attempt${trace.length === 1 ? "" : "s"} recorded under this row.`, "");
  }

  // 1. Is the traced work on a sibling? The most useful answer by far, because
  //    it is actionable: there is another row to open.
  const traced = siblings
    .filter((s) => Number(s.traceCount) > 0)
    .sort((a, b) => Number(b.traceCount) - Number(a.traceCount));
  if (traced.length) {
    const best = traced[0];
    return verdict(
      "sibling_has_trace",
      `No attempts under this row — but a related row on the same record has ${best.traceCount}.`,
      `This row is the ${kindWord(decision)} among ${siblings.length + 1} audit_log rows on one record, ` +
        `correlated by ${describeCorrelation(correlation)}. The traced work sits on “${best.action}” ` +
        `(${best.kind === "decision" ? "a decision row" : "another row"}) — open that one to see it.`,
      [],
      best.id
    );
  }

  // 2. No sibling has attempts — but if this row followed a DECISION row of
  //    the same record, that is still the answer to "why is this empty":
  //    attempts hang off the decision's parent_id, never off what came after
  //    it. Pointing there is more useful than explaining this row, and the
  //    decision's own verdict then explains the rest.
  //
  //    An EXECUTION gets its own wording rather than sharing the event's. The
  //    badge beside this text will read "Execution", so prose calling the row a
  //    follow-up event would contradict it on the same screen — and the
  //    substance differs: an event records that something happened internally,
  //    while this row records that a write LEFT the system and carries the
  //    response proving it. Both keep the same "open the row that has the
  //    attempts" affordance, which is the actionable half.
  const siblingDecision = decisionAuthorising(decision, siblings);
  if (decision.kind === "execution" && siblingDecision) {
    return verdict(
      "execution_row",
      "This row records the outward act, not the decision — attempts hang off the decision row.",
      `“${decision.action}” is the write itself: it was appended after the call to Remote returned, and it ` +
        `carries that response, which is what makes it the record that the act really happened. The decision it ` +
        `follows is “${siblingDecision.action}”, the most recent one recorded before it on this record ` +
        `(correlated by ${describeCorrelation(correlation)}), and the LLM/API attempts belong to that row — ` +
        `performing a write is not itself a traced attempt. That row has ${siblingDecision.traceCount} ` +
        `attempt${Number(siblingDecision.traceCount) === 1 ? "" : "s"} — open it to see the run, and its own ` +
        `verdict if it is empty too.`,
      [],
      siblingDecision.id
    );
  }
  if (decision.kind === "event" && siblingDecision) {
    return verdict(
      "follow_up_event",
      "This row is a follow-up event, not the decision — attempts hang off the decision row.",
      `“${decision.action}” records what happened after “${siblingDecision.action}”, the most recent ` +
        `decision recorded before it on this record (correlated by ${describeCorrelation(correlation)}). That row ` +
        `has ${siblingDecision.traceCount} attempt${Number(siblingDecision.traceCount) === 1 ? "" : "s"} — open ` +
        `it to see the run, and its own verdict if it is empty too.`,
      [],
      siblingDecision.id
    );
  }

  // 3. Older than anything that was ever traced.
  if (earliestTraceAt && decision.at && String(decision.at) < String(earliestTraceAt)) {
    return verdict(
      "predates_tracing",
      "This decision predates per-attempt tracing.",
      `It was recorded at ${decision.at}, before the oldest audit_trace row in this store (${earliestTraceAt}). ` +
        `The trace nodes had not been deployed yet, so an empty table here says nothing about the run itself.`
    );
  }

  // 4. Does the row itself account for the absence?
  const evidence = collectEvidence(decision.details);
  if (evidence.length) {
    return verdict(
      "no_traceable_call",
      "This decision made no traceable call — zero attempts is the correct answer.",
      "Every reason below is read off this row's own details, not inferred from the empty table.",
      evidence
    );
  }

  // 5. An execution row whose decision could not be identified — its details
  //    carry no key on CORRELATION_FIELDS, or the decision row is not in this
  //    store. The absence of attempts is STILL fully explained (performing a
  //    write is not a traced attempt), so falling through to "unexplained"
  //    would send a reader to investigate a healthy row, and would contradict
  //    the "Execution" badge beside the text. What is missing is the pointer,
  //    and that is said rather than papered over.
  if (decision.kind === "execution") {
    return verdict(
      "execution_row",
      "This row records the outward act — the write itself, which is not a traced attempt.",
      `“${decision.action}” was appended after the call to Remote returned and carries that response. The LLM/API ` +
        `attempts for this work belong to its decision row, but no decision row recorded before it shares this ` +
        `row's record id (or this row carries no record id at all), so there is nothing to point at. ` +
        `Zero attempts here is the correct answer either way.`
    );
  }

  // 6. Honest ignorance. The one code that means "investigate".
  return verdict(
    "unexplained",
    "No attempts recorded, and nothing in this row explains why.",
    "This decision is not older than tracing, has no correlated row carrying the attempts, and records no " +
      "rule-based fallback or mock transport. Either the writer for this use case has no trace branch, or the " +
      "trace write failed — worth checking against another decision from the same use case."
  );
}

/**
 * The decision row this one FOLLOWS: the most recent decision among the
 * correlated rows that was recorded at or before this row's own timestamp.
 *
 * WHY NOT `siblings.find(s => s.kind === "decision")`. That was correct only
 * while a group could hold at most one decision, and it cannot: UC-02's
 * duplicate gate writes `duplicate_request_ignored` — a decision, because it is
 * the whole of a second submission (readStore.js's DECISION_ACTIONS block) —
 * into the group of the record it declined to re-decide. Live, that row landed
 * two hours AFTER the execution row it now shares a group with. `find()` on an
 * oldest-first array happens to return the right one there, by accident of
 * arrival order; a group whose later decision sorted first would have had the
 * execution row announce that it followed a decision made after it.
 *
 * TIME IS USED HERE ONLY TO ORDER ROWS THAT ARE ALREADY CORRELATED, never to
 * decide that they are related — the distinction this viewer is otherwise
 * strict about (CORRELATION_FIELDS' header: three rows in one millisecond is
 * evidence of nothing). Within one record id, "which decision came before this
 * row" is a question the timestamps genuinely answer.
 *
 * Ties go to the latest such row in the store's oldest-first order: a decision
 * sharing this row's exact millisecond was written by the same invocation, and
 * that is the one being followed.
 *
 * @returns {object|null} null when no decision precedes this row.
 */
function decisionAuthorising(decision, siblings) {
  const at = decision.at ? String(decision.at) : null;
  let best = null;
  for (const s of siblings) {
    if (s.kind !== "decision") continue;
    if (at && s.at && String(s.at) > at) continue; // recorded after this row
    if (!best || !s.at || !best.at || String(s.at) >= String(best.at)) best = s;
  }
  return best;
}

function collectEvidence(details) {
  const bag = details && typeof details === "object" ? details : {};
  const evidence = [];

  for (const field of SOURCE_FIELDS) {
    const value = read(bag, field.path);
    if (value === RULE_BASED) {
      evidence.push({
        field: field.label,
        value: RULE_BASED,
        meaning: `The ${field.what} was answered by the deterministic rules, not the model — so no LLM call was made, and there is no attempt to trace.`,
      });
    }
  }

  // The request portal's Remote reads are dispatched against the mock
  // fixtures, never the live API (src/portal/wiring.js's header; the transport
  // is a local socket or an in-process dispatch, mock fixtures either way).
  // A call that never crossed the network leaves no upstream attempt.
  if (bag.source === "portal") {
    evidence.push({
      field: "source",
      value: "portal",
      meaning:
        "Submitted through the request portal, whose Remote reads are served by the mock fixtures rather than the live API — so there was no upstream API call to trace.",
    });
  }

  return evidence;
}

function describeCorrelation(correlation) {
  const field = correlation?.field ?? null;
  const key = correlation?.key ?? null;
  if (field && key) return `${field} ${key}`;
  return "a shared record id in details";
}

/**
 * The row's kind as a noun phrase that reads inside a sentence. The kind itself
 * is the server's (readStore.js's withKind); this only spells it.
 */
function kindWord(decision) {
  if (decision.kind === "decision") return "decision row";
  if (decision.kind === "execution") return "execution row";
  return "follow-up event";
}

function read(bag, path) {
  let node = bag;
  for (const step of path) {
    if (!node || typeof node !== "object") return undefined;
    node = node[step];
  }
  return node;
}

function verdict(code, headline, detail, evidence = [], relatedDecisionId = null) {
  return { code, headline, detail, evidence, relatedDecisionId };
}
