// ---------------------------------------------------------------------------
// collectTraceSteps.js — the n8n half of the two-level audit (§4 invariant 7)
// ---------------------------------------------------------------------------
// WHAT THIS IS
//
// `audit_log` holds ONE row per decision. `audit_trace` holds one row per
// ATTEMPT at an external call underneath it. The Node app has written both
// since issue #26 (AuditLogger.logTraceStep()); the nine n8n graphs wrote only
// the first, so `audit_trace` had zero rows from the path that actually serves
// customer traffic. This node closes that.
//
// WHY A DECISION-LEVEL SUMMARY IS NOT ENOUGH. `upstreamFailure.js` already
// records swallowed upstream failures into `audit_log.details.upstreamFailures`,
// which answers "the employment read 404'd". It cannot answer "was that one 403
// or forty", "did the LLM answer on the first try", or "which OpenAI call did we
// pay for". Those questions are per-attempt by nature, and at 3am they are the
// questions being asked.
//
// SHAPE. Every row this node emits maps 1:1 onto `audit_trace`'s real columns
// (id/at default in Postgres; parent_id, call, attempt, ok, error, details are
// set here), and onto the fields AuditLogger.logTraceStep() writes from the Node
// path — so the two paths produce rows that can sit in one query. Every row
// carries `details.source: "n8n"` because a trace you cannot attribute to an
// execution path is half a trace.
//
// PARENT. `parent_id` is `audit_trace`'s FK onto `audit_log.id`. n8n's Supabase
// row-create node returns the inserted row, so the audit row's real id is
// available as $('Append Audit Log').first().json.id — which is why this node
// hangs off the audit node and not off the gates. It is the same ordering rule
// the Node path follows for the same FK reason (audit.js #writeToDb chains its
// trace inserts onto the parent's insert): a trace row can never race its
// parent into Postgres, because the parent has already come back with an id.
//
// ONE BODY, NINE GRAPHS, BYTE-IDENTICAL. Nothing here is per-workflow. The use
// case, decision, reason and external ref are read back off the audit row that
// was just written; the workflow and execution ids come from n8n's own globals;
// and the traced calls are looked up from a fixed candidate list, skipping any
// node this graph does not have. That means one file, one parity test, and one
// row in scripts/verify-deployed-nodes.mjs's mapping per workflow — instead of
// nine near-identical bodies drifting apart one edit at a time.
//
// THIS NODE CANNOT AFFECT A DECISION. It sits on a terminal branch hanging off
// `Append Audit Log`, downstream of the audit write and of the idempotency
// claim, with nothing after it. It reads; it never routes. Its own node and the
// Supabase node after it both carry onError: continueRegularOutput, so a failure
// here cannot fail a run, and it returns [] rather than throwing on anything it
// does not recognise.
//
// It does, however, run BEFORE the customer-facing branch — the two nodes sit
// above the rest of the graph, and under executionOrder v1 canvas position is
// execution order. That is deliberate: an error anywhere aborts the run before
// n8n drains its branch queue, so a trace branch queued second is lost on
// exactly the executions that failed. Same principle as the audit write itself
// preceding `Route by Decision`: record first, act second.
//
// WHAT `at` MEANS ON THIS ROW (R7-36). This node sets id/at BY OMISSION —
// neither column is assigned here, so Postgres's own `now()` default fires at
// INSERT time. That is WRITE TIME, not call time: this node hangs off
// `Append Audit Log` (see PARENT, above), so its rows are always inserted
// AFTER the decision row they belong to, even though the calls they describe
// (the classify, the employment read) happened BEFORE it. A reader comparing
// this row's `at` against its parent's `at` will therefore always see the
// attempt "after" the decision on this path — the opposite of what the same
// comparison shows on the Node app path, where AuditLogger.logTraceStep()
// stamps `at` at call time (see src/shared/audit.js's header comment). This
// node cannot do what that one does — it runs after the fact, reading back
// call results it never timed — so instead every row it emits is tagged
// `details.atSemantic: "trace_write"`, the n8n-side counterpart of that
// function's `"call_attempt"`, so the two are never silently compared as if
// they meant the same thing.
// ---------------------------------------------------------------------------

// Every external call any of the nine graphs makes BEFORE its decision is
// durable. A graph that lacks one simply skips it — $() throws for a node that
// does not exist or did not run, and that throw is caught below.
//
// WHAT IS DELIBERATELY NOT HERE, because a trace is only read if it is worth
// reading:
//   * Code nodes (normalizers, gates, renderers, carry-context). Deterministic,
//     no I/O. A failure is a red node and an `ops_alerts` row; a trace row would
//     add "it ran", which the audit row already implies.
//   * Supabase writes (the claim, the record, the audit row itself). Each one IS
//     its own evidence — a row saying "the audit write succeeded" is a child of
//     the row it describes.
//   * Zendesk writes. They happen downstream of the audit write, so covering
//     them would need a collector on every branch end in every graph (~25 nodes)
//     for something already visible as a red node plus an `ops_alerts` row
//     naming the failed node and whether the audit was durable.
const TRACED_CALLS = [
  { node: "Classify Request (LLM)", call: "openai.classify" },
  { node: "Classify Expense (LLM)", call: "openai.classify_expense" },
  { node: "Classify Inquiry (LLM)", call: "openai.classify_inquiry" },
  { node: "Fetch Employment (Remote)", call: "remote.employment" },
  { node: "Fetch Expense (Remote)", call: "remote.expense" },
  { node: "Fetch Expense Categories (Remote)", call: "remote.expense_categories" },
  { node: "Fetch Countries (Remote)", call: "remote.countries" },
  { node: "Fetch Country Schema (Remote)", call: "remote.country_schema" },
  { node: "Fetch Payroll Runs (Remote)", call: "remote.payroll_runs" },
];

// A node that ran more than once in one execution is the interesting case, so
// runs are probed rather than assumed to be one. The cap is a guard against an
// unbounded loop in a node whose whole job is to be harmless.
const MAX_RUNS_PROBED = 5;

const AUDIT_NODE = "Append Audit Log";

/**
 * Recognise the item n8n emits in place of data when a node carries
 * `onError: continueRegularOutput` — the node reports success and passes an
 * error object downstream. Ported from src/shared/upstreamFailure.js's
 * describeUpstreamError(); a Code node cannot import, and test/n8nTraceCollector
 * .test.js pins the two against each other.
 */
function describeFailure(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!("error" in raw)) return null;
  // An envelope carrying real data is not a failed fetch, whatever else is on
  // it. n8n's error item has `error` and nothing else.
  if ("data" in raw) return null;

  const err = raw.error;
  if (typeof err === "string") {
    return { status: null, message: err.slice(0, 200) };
  }
  if (!err || typeof err !== "object") return null;

  const numeric = Number(err.status !== undefined ? err.status : err.httpCode !== undefined ? err.httpCode : err.statusCode);
  return {
    status: Number.isInteger(numeric) ? numeric : null,
    message:
      typeof err.message === "string"
        ? err.message.slice(0, 200)
        : String(err.name !== undefined ? err.name : "upstream call failed"),
  };
}

/**
 * The token usage of an OpenAI chat-completions response, named exactly as
 * src/shared/llm.js's tagUsage() names it — because src/metrics/compute.js's
 * computeLlmCost() reads `details.usage.{model,promptTokens,completionTokens}`
 * and must not need to know which path wrote the row.
 *
 * The model recorded is the one the API ANSWERED with (e.g.
 * "gpt-4o-mini-2024-07-18"), not the one requested, for the same reason
 * tagUsage() does it: the bill is for what ran.
 */
function extractUsage(json) {
  if (!json || typeof json !== "object" || !json.usage) return null;
  return {
    model: json.model || null,
    promptTokens: json.usage.prompt_tokens === undefined ? null : json.usage.prompt_tokens,
    completionTokens: json.usage.completion_tokens === undefined ? null : json.usage.completion_tokens,
    totalTokens: json.usage.total_tokens === undefined ? null : json.usage.total_tokens,
  };
}

/** One run's output for a node, or null when the node is absent/unexecuted. */
function runOutput(nodeName, runIndex) {
  try {
    const items = $(nodeName).all(0, runIndex);
    if (!items || items.length === 0) return null;
    return items[0].json || {};
  } catch (err) {
    return null;
  }
}

// The audit row this trace belongs to. Everything about the decision is read
// back off it rather than off the gates node: it is the record that exists, it
// is what a reader will have in front of them, and reading it needs no
// $('…Gates').item lookup that item pairing could break.
let auditRow = {};
try {
  auditRow = $(AUDIT_NODE).first().json || {};
} catch (err) {
  auditRow = {};
}
const auditDetails = auditRow.details && typeof auditRow.details === "object" ? auditRow.details : {};

// parent_id is nullable on purpose. If the audit insert somehow returned no id,
// an orphan trace row still records that the calls happened — losing the
// evidence because the pointer is missing would be the worse failure.
const parentId = auditRow.id || null;

const base = {
  source: "n8n",
  // R7-36: this row's `at` is a Postgres INSERT-time default, not the time
  // the traced call actually happened — see the header comment above.
  atSemantic: "trace_write",
  useCase: auditRow.use_case || null,
  workflowId: $workflow.id,
  workflowName: $workflow.name,
  executionId: $execution.id,
  externalRef: auditDetails.externalRef === undefined ? null : auditDetails.externalRef,
};

const rows = [];
let failedCalls = 0;

for (const traced of TRACED_CALLS) {
  for (let runIndex = 0; runIndex < MAX_RUNS_PROBED; runIndex++) {
    const json = runOutput(traced.node, runIndex);
    if (json === null) break;

    const failure = describeFailure(json);
    const details = Object.assign({}, base, { node: traced.node });
    if (failure && failure.status !== null) details.httpStatus = failure.status;

    const usage = failure ? null : extractUsage(json);
    if (usage) details.usage = usage;

    if (failure) failedCalls++;

    rows.push({
      json: {
        parent_id: parentId,
        call: traced.call,
        // 1-based, matching logTraceStep()'s "attempt 1 = first try". Derived
        // from the run index rather than hard-coded, so a node that genuinely
        // ran twice produces [1, 2] — which findRedundantCalls() reads as a
        // clean retry sequence, not as a duplicate.
        attempt: runIndex + 1,
        ok: !failure,
        error: failure ? failure.message : null,
        details: details,
      },
      // Set explicitly: a Code node returning bare objects breaks the item
      // pairing that $('Node Name').item resolves through, and the resulting
      // failure surfaces nowhere near this node.
      pairedItem: { item: 0 },
    });
  }
}

// The anchor row. One per execution, on every graph including the ones that
// make no external calls at all (UC-07 is pure Code up to its durable write).
// It is the only thing in Postgres that points BACK at an n8n execution: without
// it, a human reading an audit_log row has no way to find the run that wrote it
// short of searching n8n by timestamp. `ok` is false when any traced call
// failed, so `select … where ok = false` surfaces degraded runs whose decision
// still landed.
rows.unshift({
  json: {
    parent_id: parentId,
    call: "n8n.run",
    attempt: 1,
    ok: failedCalls === 0,
    error: failedCalls === 0 ? null : failedCalls + " traced upstream call(s) failed",
    details: Object.assign({}, base, {
      decision: auditRow.action === undefined ? null : auditRow.action,
      reason: auditDetails.reason === undefined ? null : auditDetails.reason,
      tracedCalls: rows.length,
      failedCalls: failedCalls,
    }),
  },
  pairedItem: { item: 0 },
});

return rows;
