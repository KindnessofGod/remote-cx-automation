// ---------------------------------------------------------------------------
// metrics.test.js  —  the metrics layer
// ---------------------------------------------------------------------------
// Hermetic like the rest of the suite: compute.js is pure, so none of this
// needs a database. The cases below are hand-built rows rather than seeded
// runs, because these tests are about the ARITHMETIC and the VERDICT logic —
// seed.js already exercises the real workflow.
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMetrics,
  findIntegrityBreaches,
  findRedundantCalls,
  hasMultiAttemptGroup,
  findNeverSucceeded,
  rankExceptionReasons,
  RENAMED_EXCEPTION_REASONS,
  median,
  recommend,
  computeLlmCost,
  costVerdict,
  LLM_PRICING_USD_PER_MILLION_TOKENS,
  DEFAULT_THRESHOLDS,
} from "../src/metrics/compute.js";
import { renderDashboardHtml } from "../src/metrics/dashboard.js";

const caseRow = (over = {}) => ({
  id: over.id ?? `c_${Math.random().toString(36).slice(2)}`,
  useCase: "UC-01",
  decision: "auto_resolve",
  reason: "all_gates_passed",
  flags: [],
  status: "resolved",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:05.000Z",
  ...over,
});

// An audit_trace-shaped row, exactly as AuditLogger.logTraceStep() emits it:
// {id, at, parentId, call, attempt, ok, error, details}.
const trace = (over = {}) => ({
  id: over.id ?? `t_${Math.random().toString(36).slice(2)}`,
  at: "2026-07-01T10:00:01.000Z",
  parentId: "audit_1",
  call: "classify.askJson",
  attempt: 1,
  ok: true,
  error: null,
  details: null,
  ...over,
});

// A trace entry that carries token usage — exactly the shape every LLM call
// site's onAttempt closure produces (details.usage from
// src/shared/llm.js's tagUsage()/extractUsage(), details.useCase set by the
// call site itself). See src/uc01/classifier.js etc.
const usageTrace = (over = {}) =>
  trace({
    details: {
      useCase: "UC-01",
      usage: { model: "gpt-4o-mini", promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
    },
    ...over,
  });

test("median handles odd, even and empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("a clean auto-resolution raises no integrity breach", () => {
  assert.deepEqual(findIntegrityBreaches([caseRow()]), []);
});

test("auto-resolving WITH flags is an integrity breach", () => {
  // policyEngine.evaluate() only returns auto_resolve when no flag was raised,
  // so this combination means something bypassed the gates.
  const breaches = findIntegrityBreaches([caseRow({ id: "c1", flags: ["has_attachment"] })]);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].kind, "flagged_auto_resolution");
  assert.equal(breaches[0].caseId, "c1");
});

test("ANY auto-resolution on a high-tier use case is an integrity breach", () => {
  // UC-08 is specified to have no execution path at all. Zero flags does not
  // make this acceptable — the tier itself forbids it.
  const breaches = findIntegrityBreaches([caseRow({ id: "c2", useCase: "UC-08", flags: [] })]);
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].kind, "auto_resolution_on_high_tier");
});

test("a single trace entry is never flagged — one fire is the normal case", () => {
  assert.deepEqual(findRedundantCalls([trace({ id: "t1" })]), []);
});

test("a legitimate retry sequence is not flagged, whether it succeeds or exhausts", () => {
  // Exactly what withRetry()'s onAttempt produces: attempts 1, 2, 3.
  const succeeded = [
    trace({ id: "t1", attempt: 1, ok: false, error: "connection refused" }),
    trace({ id: "t2", attempt: 2, ok: false, error: "connection refused" }),
    trace({ id: "t3", attempt: 3, ok: true }),
  ];
  assert.deepEqual(findRedundantCalls(succeeded), []);

  const exhausted = [
    trace({ id: "t1", attempt: 1, ok: false, error: "connection refused" }),
    trace({ id: "t2", attempt: 2, ok: false, error: "connection refused" }),
    trace({ id: "t3", attempt: 3, ok: false, error: "connection refused" }),
  ];
  assert.deepEqual(findRedundantCalls(exhausted), []);
});

test("two entries both claiming attempt 1 are a genuine duplicate", () => {
  // The canonical redundant call: the same call fired twice, neither entry a
  // retry of the other, so the attempts do not read as one clean 1..n run.
  const flags = findRedundantCalls([
    trace({ id: "t1", attempt: 1 }),
    trace({ id: "t2", attempt: 1 }),
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "redundant_call");
  assert.equal(flags[0].parentId, "audit_1");
  assert.equal(flags[0].call, "classify.askJson");
  assert.deepEqual(flags[0].attempts, [1, 1]);
  assert.deepEqual(flags[0].traceIds, ["t1", "t2"]);
  assert.match(flags[0].detail, /attempts \[1, 1\]/);
});

test("two clean retry sequences for the same call under one parent are a duplicate", () => {
  // [1,2] + [1,2] sorted is not [1,2,3,4]: the call was issued twice, and no
  // single retry relationship links the four entries.
  const flags = findRedundantCalls([
    trace({ id: "t1", attempt: 1 }),
    trace({ id: "t2", attempt: 2 }),
    trace({ id: "t3", attempt: 1 }),
    trace({ id: "t4", attempt: 2 }),
  ]);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0].attempts, [1, 2, 1, 2]);
});

test("the same call under two different parents is two single fires, not a duplicate", () => {
  // Grouping is by (parentId, call); a shared call name across separate
  // decision rows is expected and must never be grouped into one sequence.
  assert.deepEqual(
    findRedundantCalls([
      trace({ id: "t1", parentId: "audit_1", attempt: 1 }),
      trace({ id: "t2", parentId: "audit_2", attempt: 1 }),
    ]),
    []
  );
});

test("a gapped or missing attempt number is flagged, not treated as a clean retry", () => {
  const gapped = findRedundantCalls([
    trace({ id: "t1", attempt: 1 }),
    trace({ id: "t2", attempt: 3 }),
  ]);
  assert.equal(gapped.length, 1);
  assert.match(gapped[0].detail, /attempts \[1, 3\]/);

  const missing = findRedundantCalls([
    trace({ id: "t1", attempt: 1 }),
    trace({ id: "t2" }), // no attempt field at all
  ]);
  assert.equal(missing.length, 1);
});

// UC-01 r7 R7-35 (rca-2xsl): `findRedundantCalls() === []` alone does not mean
// a multi-attempt group read as a clean retry — it is also `[]` when there is
// no multi-attempt group at all. `hasMultiAttemptGroup()` is what tells those
// two apart, and it is what the audit-trail drill-down must gate its "reads as
// one clean retry sequence" blurb on instead of an empty flag list.
test("hasMultiAttemptGroup is false when every call fired exactly once — no group exists to call clean", () => {
  // Three DIFFERENT calls, each at attempt 1 — the exact R7-35 shape (rows
  // 60-63: n8n.run, openai.classify, remote.employment, one fire apiece).
  assert.equal(
    hasMultiAttemptGroup([
      trace({ id: "t1", call: "n8n.run", attempt: 1 }),
      trace({ id: "t2", call: "openai.classify", attempt: 1 }),
      trace({ id: "t3", call: "remote.employment", attempt: 1 }),
    ]),
    false
  );
  assert.equal(hasMultiAttemptGroup([]), false, "no trace at all is also no group");
});

test("hasMultiAttemptGroup is true for a clean retry sequence and for a genuine duplicate alike", () => {
  // A real (parentId, call) group of 2+ exists in both cases — whether it is
  // CLEAN (this test) or OFFENDING (findRedundantCalls's job to say which) is
  // a separate question from whether a group exists at all.
  assert.equal(
    hasMultiAttemptGroup([trace({ id: "t1", attempt: 1 }), trace({ id: "t2", attempt: 2 })]),
    true,
    "a clean 1..2 retry sequence is still a group"
  );
  assert.equal(
    hasMultiAttemptGroup([trace({ id: "t1", attempt: 1 }), trace({ id: "t2", attempt: 1 })]),
    true,
    "a genuine duplicate is still a group — hasMultiAttemptGroup does not judge cleanliness"
  );
});

test("hasMultiAttemptGroup groups by (parentId, call) exactly like findRedundantCalls", () => {
  // The same call under two different parents is two single fires, never a
  // group — must agree with findRedundantCalls's own grouping rule.
  assert.equal(
    hasMultiAttemptGroup([
      trace({ id: "t1", parentId: "audit_1", attempt: 1 }),
      trace({ id: "t2", parentId: "audit_2", attempt: 1 }),
    ]),
    false
  );
});

test("exception reasons rank by volume and exclude auto-resolutions", () => {
  const ranked = rankExceptionReasons([
    caseRow(),
    caseRow({ decision: "human_review", reason: "artifact_present" }),
    caseRow({ decision: "human_review", reason: "artifact_present" }),
    caseRow({ decision: "escalate", reason: "identity_not_verified" }),
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].reason, "artifact_present");
  assert.equal(ranked[0].count, 2);
  // Share is of EXCEPTIONS (3), not of all cases (4) — the auto-resolution
  // must not dilute the denominator.
  assert.equal(Math.round(ranked[0].share * 100), 67);
});

// A reason string that was RENAMED in code must not read as two separate
// causes. `audit_log` is append-only, so historical rows keep the string the
// engine actually emitted; the fold happens on the read side only. If it did
// not, one engineering problem would be reported at half its real size and
// could rank below something that matters less — a measurement defect in the
// one table whose whole job is to name the next thing worth engineering.
test("a renamed exception reason folds onto its current name — history is not rewritten", () => {
  const ranked = rankExceptionReasons([
    // Three of the SAME UC-03 gate: two rows written before the rename, one
    // after. UC-03's step-7 predicate did not change — only its name did.
    caseRow({ decision: "escalate", reason: "unsupported_destination" }),
    caseRow({ decision: "escalate", reason: "unsupported_destination" }),
    caseRow({ decision: "escalate", reason: "destination_jurisdiction_excluded" }),
    caseRow({ decision: "escalate", reason: "identity_not_verified" }),
  ]);
  assert.equal(ranked.length, 2, "two distinct causes, not three");
  assert.equal(ranked[0].reason, "destination_jurisdiction_excluded", "reported under the CURRENT name");
  assert.equal(ranked[0].count, 3, "all three rows are the same cause");
  assert.ok(
    !ranked.some((r) => r.reason === "unsupported_destination"),
    "the retired name never appears in the ranking"
  );
});

test("the rename map is explicit — an unknown reason passes through untouched", () => {
  assert.equal(RENAMED_EXCEPTION_REASONS.get("unsupported_destination"), "destination_jurisdiction_excluded");
  const ranked = rankExceptionReasons([caseRow({ decision: "escalate", reason: "some_future_reason" })]);
  assert.equal(ranked[0].reason, "some_future_reason");
});

test("a low-tier use case below the stop threshold is told to stop", () => {
  const { verdict } = recommend({
    tier: "low",
    total: 100,
    autoRate: 0.1,
    acceptRate: null,
    breaches: 0,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "stop");
});

test("a low-tier use case under target but above the floor is told to iterate", () => {
  const { verdict } = recommend({
    tier: "low",
    total: 100,
    autoRate: 0.35,
    acceptRate: null,
    breaches: 0,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "iterate");
});

test("a medium-tier use case is NOT judged on auto-rate", () => {
  // The human gate is the design for 🟡 medium. A 0% auto-rate is correct
  // there, and must not be reported as a failure the way it would for 🟢 low.
  const { verdict } = recommend({
    tier: "medium",
    total: 100,
    autoRate: 0,
    acceptRate: 0.9,
    breaches: 0,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "healthy");
});

test("low specialist acceptance means the recommendation is noise — stop", () => {
  const { verdict } = recommend({
    tier: "medium",
    total: 100,
    autoRate: 0,
    acceptRate: 0.2,
    breaches: 0,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "stop");
});

test("an integrity breach outranks every rate", () => {
  const { verdict } = recommend({
    tier: "low",
    total: 100,
    autoRate: 0.99,
    acceptRate: 1,
    breaches: 1,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "integrity_violation");
});

test("a small sample reports insufficient_data rather than a verdict", () => {
  const { verdict } = recommend({
    tier: "low",
    total: 3,
    autoRate: 0,
    acceptRate: null,
    breaches: 0,
    thresholds: DEFAULT_THRESHOLDS,
  });
  assert.equal(verdict, "insufficient_data");
});

test("computeMetrics aggregates rates, reviews and totals", () => {
  const cases = [
    caseRow({ id: "a", decision: "auto_resolve" }),
    caseRow({ id: "b", decision: "auto_resolve" }),
    caseRow({ id: "c", decision: "human_review", reason: "artifact_present", flags: ["has_attachment"], status: "pending_review" }),
    caseRow({ id: "d", decision: "escalate", reason: "employee_not_active", flags: ["employment_status_terminated"], status: "escalated" }),
  ];
  const reviewQueue = [
    { id: "r1", caseId: "c", status: "approved" },
    { id: "r2", caseId: "d", status: "rejected" },
    { id: "r3", caseId: "c", status: "pending" },
  ];

  const report = computeMetrics({ cases, reviewQueue });

  assert.equal(report.totals.cases, 4);
  assert.equal(report.totals.autoResolved, 2);
  assert.equal(report.totals.autoRate, 0.5);
  assert.equal(report.totals.integrityBreaches, 0);

  const uc01 = report.byUseCase.find((u) => u.useCase === "UC-01");
  assert.equal(uc01.tier, "low");
  assert.equal(uc01.counts.human_review, 1);
  // Pending rows must not count in the denominator: 1 approved of 2 decided.
  assert.equal(uc01.review.acceptRate, 0.5);
  assert.equal(uc01.review.pending, 1);
});

test("computeMetrics surfaces a duplicate call as a zero-tolerance total", () => {
  const report = computeMetrics({
    cases: [caseRow()],
    reviewQueue: [],
    traces: [trace({ id: "t1", attempt: 1 }), trace({ id: "t2", attempt: 1 })],
  });
  assert.equal(report.totals.duplicateCalls, 1);
  assert.equal(report.duplicateCalls.length, 1);
  assert.equal(report.duplicateCalls[0].kind, "redundant_call");
  assert.equal(report.duplicateCalls[0].call, "classify.askJson");
});

test("computeMetrics reports zero duplicate calls for a clean retry trace", () => {
  const report = computeMetrics({
    cases: [caseRow()],
    traces: [trace({ id: "t1", attempt: 1, ok: false }), trace({ id: "t2", attempt: 2, ok: true })],
  });
  assert.equal(report.totals.duplicateCalls, 0);
  assert.deepEqual(report.duplicateCalls, []);
});

test("computeMetrics without trace data reports zero duplicate calls", () => {
  const report = computeMetrics({ cases: [caseRow()] });
  assert.equal(report.totals.duplicateCalls, 0);
  assert.deepEqual(report.duplicateCalls, []);
});

// -----------------------------------------------------------------------
// Cost model (docs/METRICS.md's "No cost model" gap)
// -----------------------------------------------------------------------

test("computeLlmCost prices a single usage-bearing trace at the documented gpt-4o-mini rate", () => {
  // 1000 prompt tokens @ $0.15/1M + 200 completion tokens @ $0.60/1M
  const expected = (1000 / 1_000_000) * 0.15 + (200 / 1_000_000) * 0.6;
  const result = computeLlmCost([usageTrace()]);
  assert.equal(result.callsPriced, 1);
  assert.ok(Math.abs(result.totalUsd - expected) < 1e-12, `${result.totalUsd} !== ${expected}`);
  assert.equal(result.promptTokens, 1000);
  assert.equal(result.completionTokens, 200);
  assert.equal(result.byUseCase.get("UC-01").calls, 1);
});

test("computeLlmCost skips a rule-based-fallback trace entry — no OpenAI call, nothing to price", () => {
  const result = computeLlmCost([trace({ details: null }), trace({ details: { useCase: "UC-01" } })]);
  assert.equal(result.callsPriced, 0);
  assert.equal(result.totalUsd, 0);
  assert.equal(result.byUseCase.size, 0);
});

test("computeLlmCost reports a model with no price on record instead of pricing it at zero", () => {
  // This used to throw. It stopped, on 2026-08-29, for a reason recorded in
  // compute.js: the DEPLOYED model (gpt-5-nano, per the live /__cx/health) has
  // no rate on record, computeMetrics() calls computeLlmCost() unconditionally,
  // and so one unpriced attempt took the entire dashboard down with an error
  // that read like a metrics bug. What must never happen is the OTHER thing —
  // an unpriced call rendering as free — and that is what these assertions pin.
  const badTrace = usageTrace({ details: { useCase: "UC-01", usage: { model: "gpt-9-ultra", promptTokens: 10, completionTokens: 5 } } });
  const result = computeLlmCost([badTrace]);
  assert.equal(result.callsPriced, 0);
  assert.equal(result.totalUsd, 0, "no rate means no dollars — never an invented one");
  assert.equal(result.complete, false, "and the result says its total is a floor");
  assert.equal(result.unpriced.calls, 1);
  assert.equal(result.unpriced.models.length, 1);
  assert.equal(result.unpriced.models[0].model, "gpt-9-ultra");
  assert.equal(result.unpriced.models[0].known, false, "nothing declares this model — it is a surprise, not a known gap");
  assert.equal(result.byUseCase.get("UC-01").unpricedCalls, 1, "and it is attributed to the use case that spent it");
});

test("an unpriced call produces an `unpriced` verdict naming the model, never a silent total", () => {
  const badTrace = usageTrace({ details: { useCase: "UC-01", usage: { model: "gpt-5-nano", promptTokens: 10, completionTokens: 5 } } });
  const { verdict, rationale } = costVerdict(computeLlmCost([badTrace, usageTrace()]));
  assert.equal(verdict, "unpriced");
  assert.match(rationale, /gpt-5-nano/, "the verdict names the model, because that is the remedy");
  assert.match(rationale, /FLOOR/, "and says the dollar figure is not the bill");
});

test("gpt-5-nano is DECLARED unpriced — a known gap reads differently from an unrecognised model", () => {
  // Two remedies, so two signals: `known: true` means "we know we call this and
  // have no rate"; `known: false` means "a model changed under the deployment
  // and nobody recorded it". Same reason approver_entitlement_not_configured is
  // kept apart from approver_not_entitled.
  const declared = computeLlmCost([
    usageTrace({ details: { useCase: "UC-01", usage: { model: "gpt-5-nano", promptTokens: 1, completionTokens: 1 } } }),
  ]);
  assert.equal(declared.unpriced.models[0].known, true);
  assert.ok(declared.unpriced.models[0].why, "and it says WHY there is no rate");
  assert.ok(
    !Object.keys(LLM_PRICING_USD_PER_MILLION_TOKENS).includes("gpt-5-nano"),
    "no rate may be invented for the deployed model — money is never fabricated (CLAUDE.md §3)"
  );
});

test("costVerdict says insufficient_data, not $0, when nothing carried usage at all", () => {
  // The seeded dashboard run drives the rule-based classifier on purpose and
  // legitimately makes no OpenAI call. "Nothing to price" and "we measured zero
  // spend" are different claims and must not render as the same one.
  const { verdict, rationale } = costVerdict(computeLlmCost([trace({ details: null })]));
  assert.equal(verdict, "insufficient_data");
  assert.match(rationale, /not a measurement of zero spend/i);
});

test("costVerdict says priced when every usage-bearing call has a rate", () => {
  assert.equal(costVerdict(computeLlmCost([usageTrace()])).verdict, "priced");
});

test("computeMetrics carries the cost verdict rather than only the number", () => {
  const report = computeMetrics({
    cases: [{ id: "c1", useCase: "UC-01", decision: "auto_resolve", status: "resolved", flags: [] }],
    traces: [usageTrace({ details: { useCase: "UC-01", usage: { model: "gpt-5-nano", promptTokens: 10, completionTokens: 5 } } })],
  });
  assert.equal(report.costs.verdict, "unpriced");
  assert.equal(report.costs.complete, false);
  assert.equal(report.costs.unpriced.calls, 1);
  assert.equal(report.byUseCase[0].cost.complete, false, "and the per-use-case block says so too");
  assert.equal(report.byUseCase[0].cost.unpricedCalls, 1);
});

test("computeLlmCost accumulates multiple attempts under the same use case", () => {
  const result = computeLlmCost([usageTrace({ id: "t1" }), usageTrace({ id: "t2" })]);
  assert.equal(result.callsPriced, 2);
  const bucket = result.byUseCase.get("UC-01");
  assert.equal(bucket.calls, 2);
  assert.equal(bucket.promptTokens, 2000);
});

test("computeMetrics wires LLM spend into totals.costs and each use case's cost block", () => {
  const cases = [caseRow({ id: "a", status: "resolved" }), caseRow({ id: "b", status: "resolved" })];
  const report = computeMetrics({ cases, traces: [usageTrace({ id: "t1" })] });

  assert.ok(report.costs.totalUsd > 0);
  assert.equal(report.costs.callsPriced, 1);
  // 2 resolved cases share the one priced call's spend.
  assert.equal(report.costs.perResolvedCase, report.costs.totalUsd / 2);
  assert.equal(report.costs.byTier.low.calls, 1);
  assert.equal(report.costs.pricing["gpt-4o-mini"].input, 0.15);

  const uc01 = report.byUseCase.find((u) => u.useCase === "UC-01");
  assert.equal(uc01.cost.calls, 1);
  assert.equal(uc01.cost.perResolvedCase, uc01.cost.usd / 2);
});

test("computeMetrics reports null (not 0) cost-per-resolved-case when nothing has resolved yet", () => {
  const report = computeMetrics({
    cases: [caseRow({ status: "pending_review" })],
    traces: [usageTrace()],
  });
  assert.equal(report.costs.perResolvedCase, null);
  assert.ok(report.costs.totalUsd > 0, "spend is still tracked even with no resolved case yet");
});

test("computeMetrics reports zero spend, not an error, when no trace carries usage", () => {
  const report = computeMetrics({ cases: [caseRow()], traces: [trace()] });
  assert.equal(report.costs.totalUsd, 0);
  assert.equal(report.costs.callsPriced, 0);
  // Every use case still gets a (zero) tier bucket — "no spend" is a real
  // measured zero, not the tier's absence from the report.
  assert.deepEqual(report.costs.byTier, { low: { usd: 0, calls: 0 } });
});

test("acceptRate is null (not 0) when nothing has been decided", () => {
  // "No data" and "every specialist rejected it" are opposite situations and
  // must not both render as 0%.
  const report = computeMetrics({
    cases: [caseRow({ id: "a", decision: "human_review", status: "pending_review" })],
    reviewQueue: [{ id: "r1", caseId: "a", status: "pending" }],
  });
  assert.equal(report.byUseCase[0].review.acceptRate, null);
});

test("review rows pointing at an unknown case are ignored, not guessed at", () => {
  const report = computeMetrics({
    cases: [caseRow({ id: "a" })],
    reviewQueue: [{ id: "r1", caseId: "does_not_exist", status: "approved" }],
  });
  assert.equal(report.byUseCase[0].review.acceptRate, null);
});

const nCases = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => caseRow({ id: `c${i}`, ...over }));

test("every use case with review rows gets its own accept rate, not just UC-01", () => {
  const cases = [
    caseRow({ id: "a", useCase: "UC-01", decision: "auto_resolve" }),
    caseRow({ id: "b", useCase: "UC-04", decision: "human_review", status: "pending_review" }),
    caseRow({ id: "c", useCase: "UC-06", decision: "human_review", status: "pending_review" }),
    caseRow({ id: "d", useCase: "UC-06", decision: "human_review", status: "pending_review" }),
    caseRow({ id: "e", useCase: "UC-07", decision: "escalate", status: "escalated" }),
    caseRow({ id: "f", useCase: "UC-08", decision: "escalate", status: "escalated" }),
  ];
  const reviewQueue = [
    { id: "r1", caseId: "b", status: "approved" }, // UC-04: 1/1 = 1.0
    { id: "r2", caseId: "c", status: "approved" }, // UC-06: 1/2 = 0.5
    { id: "r3", caseId: "d", status: "rejected" },
    { id: "r4", caseId: "e", status: "approved" }, // UC-07: 1/1 = 1.0
    { id: "r5", caseId: "f", status: "rejected" }, // UC-08: 0/1 = 0.0 (real rejections)
  ];

  const report = computeMetrics({ cases, reviewQueue });
  const byName = Object.fromEntries(report.byUseCase.map((u) => [u.useCase, u]));

  assert.equal(byName["UC-01"].review.acceptRate, null);
  assert.equal(byName["UC-04"].review.acceptRate, 1);
  assert.equal(byName["UC-06"].review.acceptRate, 0.5);
  assert.equal(byName["UC-07"].review.acceptRate, 1);
  assert.equal(byName["UC-08"].review.acceptRate, 0);
});

test("a non-UC-01 accept rate drives the verdict through DEFAULT_THRESHOLDS", () => {
  // UC-06 is judged on the accept-rate alone, with the unchanged defaults.
  const runWith = (approvedCount) => {
    const cases = nCases(10, { useCase: "UC-06", decision: "human_review", status: "pending_review" });
    const reviewQueue = cases.map((c, i) => ({
      id: `r_${c.id}`,
      caseId: c.id,
      status: i < approvedCount ? "approved" : "rejected",
    }));
    return computeMetrics({ cases, reviewQueue }).byUseCase[0];
  };

  assert.equal(runWith(6).review.acceptRate, 0.6); // ≥ minAcceptRate → healthy
  assert.equal(runWith(6).verdict, "healthy");
  assert.equal(runWith(5).verdict, "iterate"); // below minAcceptRate, above stop
  assert.equal(runWith(2).verdict, "stop"); // below stopAcceptRate
});

test("a use case with zero review rows reports insufficient data, not a false zero", () => {
  // Enough cases to clear minSampleSize — but no specialist decided anything.
  // UC-06's only judgement is the accept-rate, so the verdict must be
  // "insufficient data", and the accept rate must be null, not 0%.
  const cases = [
    ...nCases(10, { useCase: "UC-06", decision: "human_review", status: "pending_review" }),
    ...nCases(10, { useCase: "UC-08", decision: "escalate", status: "escalated" }),
  ];
  const report = computeMetrics({ cases, reviewQueue: [] });
  const byName = Object.fromEntries(report.byUseCase.map((u) => [u.useCase, u]));

  assert.equal(byName["UC-06"].review.acceptRate, null);
  assert.equal(byName["UC-06"].verdict, "insufficient_data");
  assert.equal(byName["UC-08"].review.acceptRate, null);
  assert.equal(byName["UC-08"].verdict, "insufficient_data");
});

test("reviews that are all still pending are insufficient data, not a verdict", () => {
  const cases = nCases(10, { useCase: "UC-06", decision: "human_review", status: "pending_review" });
  const reviewQueue = cases.map((c) => ({ id: `r_${c.id}`, caseId: c.id, status: "pending" }));
  const report = computeMetrics({ cases, reviewQueue });
  const uc06 = report.byUseCase[0];

  assert.equal(uc06.review.acceptRate, null);
  assert.equal(uc06.verdict, "insufficient_data");
});

test("the dashboard renders a standalone document with both themes", () => {
  const report = computeMetrics({ cases: [caseRow()], reviewQueue: [] });
  const html = renderDashboardHtml(report);

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /\[data-theme="dark"\]/);
  // Self-contained: no external stylesheet, script or image may be referenced.
  assert.doesNotMatch(html, /<script\s+src=|<link\s+rel="stylesheet"|https?:\/\/(?!www\.w3)/);
});

test("dashboard escapes values rather than interpolating them raw", () => {
  const report = computeMetrics({
    cases: [caseRow({ decision: "human_review", reason: '<img src=x onerror="alert(1)">', status: "pending_review" })],
    reviewQueue: [],
  });
  const html = renderDashboardHtml(report);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("the dashboard renders a duplicate call as a breached invariant", () => {
  const report = computeMetrics({
    cases: [caseRow()],
    traces: [trace({ id: "t1", attempt: 1 }), trace({ id: "t2", attempt: 1 })],
  });
  const html = renderDashboardHtml(report);
  assert.match(html, /classify\.askJson/);
  assert.match(html, /invariant breach\(es\)/);
  assert.match(html, /Duplicate calls/);
});

test("the dashboard shows the duplicate-call tile holding for a clean trace", () => {
  const report = computeMetrics({
    cases: [caseRow()],
    traces: [trace({ id: "t1", attempt: 1, ok: true })],
  });
  const html = renderDashboardHtml(report);
  assert.match(html, /Duplicate calls/);
  assert.match(html, /must be zero/);
  assert.match(html, /<i>●<\/i>Holding/);
});

test("the dashboard renders the estimated LLM spend tile and cost-per-case", () => {
  const report = computeMetrics({
    cases: [caseRow({ status: "resolved" })],
    traces: [usageTrace()],
  });
  const html = renderDashboardHtml(report);
  assert.match(html, /Estimated LLM spend/);
  assert.match(html, /per resolved case/);
  assert.match(html, /LLM cost/);
  assert.match(html, /Cost\/resolved/);
  // The documented rate and its check date are visible, never a bare unsourced number.
  assert.match(html, /checked 2026-08-09/);
});

test("the dashboard renders a real zero (not a blank) when nothing has resolved yet", () => {
  const report = computeMetrics({
    cases: [caseRow({ status: "pending_review" })],
    traces: [usageTrace()],
  });
  const html = renderDashboardHtml(report);
  assert.match(html, /no resolved case yet/);
});

// ---------------------------------------------------------------------------
// The two shapes that reach these functions from PRODUCTION, not from a fixture
// ---------------------------------------------------------------------------
// Both defects below were latent purely because nothing read `audit_trace` back
// from Postgres yet. The n8n graphs now write to it, so "latent" had a deadline.

test("trace rows straight from Postgres group correctly, snake_case and all", () => {
  // `audit_trace`'s column is `parent_id`. Reading only `parentId` put every
  // database-loaded row in one `undefined` bucket, where unrelated calls look
  // like duplicates of each other and real duplicates hide among them.
  const rows = [
    { id: "t1", parent_id: "a1", call: "remote.employment", attempt: 1, ok: true },
    { id: "t2", parent_id: "a2", call: "remote.employment", attempt: 1, ok: true },
  ];
  assert.deepEqual(
    findRedundantCalls(rows),
    [],
    "two different parents calling the same thing once each are two single fires"
  );

  const duplicated = [
    { id: "t3", parent_id: "a3", call: "openai.classify", attempt: 1, ok: true },
    { id: "t4", parent_id: "a3", call: "openai.classify", attempt: 1, ok: true },
  ];
  const flags = findRedundantCalls(duplicated);
  assert.equal(flags.length, 1, "the same call twice under one parent is a duplicate");
  assert.equal(flags[0].parentId, "a3", "the flag names the parent by its real id");
});

test("the model id the API actually answers with is priced, not just the alias", () => {
  // Both execution paths record what the response carried — the dated snapshot
  // — never the alias that was requested. Pricing only the alias would leave
  // every real row unpriced, which is exactly the state gpt-5-nano is in.
  const dated = computeLlmCost([
    { details: { usage: { model: "gpt-4o-mini-2024-07-18", promptTokens: 1_000_000, completionTokens: 0 } } },
  ]);
  const alias = computeLlmCost([
    { details: { usage: { model: "gpt-4o-mini", promptTokens: 1_000_000, completionTokens: 0 } } },
  ]);
  assert.deepEqual(dated, alias, "the alias and its dated snapshot are the same model at the same price");
});

// ---------------------------------------------------------------------------
// findNeverSucceeded — the "structurally cannot succeed" detector
// ---------------------------------------------------------------------------
// These tests are written around the REAL production shape that motivated the
// function: UC-06 had 26 refusals, 28 rows, and had never once recorded
// `dual_approval_required`, because the Sandbox's payroll calendar had stopped
// and no cycle could ever cover a future effective date. Nothing was red. The
// suite was green. Only the absence of a success said anything was wrong.

test("reports a medium-tier use case that has never reached a human gate", () => {
  const cases = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    useCase: "UC-06",
    decision: "escalate",
    reason: "noMatchingCycle",
  }));

  const found = findNeverSucceeded(cases);
  assert.equal(found.length, 1);
  assert.equal(found[0].useCase, "UC-06");
  assert.equal(found[0].total, 8);
  // The top reason is the investigator's first clue — it is either the bug's
  // signature or the honest explanation, and either way it must be carried.
  assert.equal(found[0].topReason, "noMatchingCycle");
});

test("stays silent once even ONE success exists — the positive case is the whole point", () => {
  const cases = Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    useCase: "UC-06",
    decision: "escalate",
    reason: "noMatchingCycle",
  }));
  cases.push({ id: "ok", useCase: "UC-06", decision: "dual_approval_required", reason: "all_gates_passed" });

  assert.deepEqual(findNeverSucceeded(cases), []);
});

test("reaching a human IS success for medium tier, not a near-miss", () => {
  // UC-04 refusing most of the time is fine; what matters is that
  // `ready_for_approval` is reachable at all. Counting only auto_resolve here
  // would report every correctly-designed medium-tier use case as broken.
  const cases = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, useCase: "UC-04", decision: "blocked", reason: "x" })),
    { id: "ok", useCase: "UC-04", decision: "ready_for_approval", reason: "all_gates_passed" },
  ];
  assert.deepEqual(findNeverSucceeded(cases), []);
});

test("never reports a high-tier use case — escalate-always is its correct behaviour", () => {
  // UC-07/UC-08 have no execution path by construction, so they have no success
  // decision to be missing. Reporting them would train the reader to ignore
  // this list, which is how a real finding gets skipped.
  const cases = Array.from({ length: 30 }, (_, i) => ({
    id: `d${i}`,
    useCase: "UC-07",
    decision: "escalate",
    reason: "always",
  }));
  assert.deepEqual(findNeverSucceeded(cases), []);
});

test("does not report on too small a sample", () => {
  const cases = [
    { id: "a", useCase: "UC-06", decision: "escalate", reason: "noMatchingCycle" },
    { id: "b", useCase: "UC-06", decision: "escalate", reason: "noMatchingCycle" },
  ];
  assert.deepEqual(findNeverSucceeded(cases, { minSample: 5 }), []);
});

test("computeMetrics surfaces it as a count and as the findings themselves", () => {
  const cases = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    useCase: "UC-06",
    decision: "escalate",
    reason: "noMatchingCycle",
    flags: [],
    status: "resolved",
  }));

  const report = computeMetrics({ cases });
  assert.equal(report.totals.neverSucceeded, 1);
  assert.equal(report.neverSucceeded[0].useCase, "UC-06");
});
