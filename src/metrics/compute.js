// ---------------------------------------------------------------------------
// compute.js  —  Turn case/review rows into the numbers CX leadership decides on
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Building an automation and *knowing whether it should keep running* are two
// different jobs. Every UC spec lists "success metrics" as prose; this file is
// where that prose becomes arithmetic, so the question "what should we iterate
// on, and what should we switch off?" has an answer backed by rows rather than
// by opinion.
//
// Everything here is a PURE function over plain arrays. No database, no clock,
// no network — the row source is somebody else's problem (see source.js). That
// keeps the interesting logic unit-testable without any infrastructure, the
// same way policyEngine.js is testable without an LLM.
//
// THE ONE SUBTLETY WORTH READING
// A high auto-resolution rate is only "good" for 🟢 low-tier use cases. For
// 🟡 medium the human gate is the *design*, and for 🔴 high an auto-resolution
// is not an achievement — it is an integrity violation, because those use cases
// are specified to have no execution path at all. So every judgement in this
// file is tier-aware. A metrics layer that just maximised "% automated" would
// be actively dangerous here, and would reward exactly the behaviour the
// architecture exists to prevent.
// ---------------------------------------------------------------------------

import { USE_CASE_TIERS } from "../shared/riskEngine.js";

// ---------------------------------------------------------------------------
// COST MODEL (closes docs/METRICS.md's "No cost model" gap)
// ---------------------------------------------------------------------------
// Real, documented OpenAI pricing for the model this repo was built against
// (gpt-4o-mini). openai.com itself is blocked by this environment's egress
// proxy, so this was checked 2026-08-09 via a public pricing search —
// https://devtk.ai/en/models/gpt-4o-mini/ and a WebSearch roundup of
// independent aggregators both give the same two figures, which have held
// unchanged since the model's 2024 launch and match the widely published rate
// card. USD is per ONE MILLION tokens — that is the unit OpenAI quotes, not
// per-token — to keep the constants human-readable instead of a string of
// leading zeros.
export const LLM_PRICING_USD_PER_MILLION_TOKENS = {
  "gpt-4o-mini": { input: 0.15, output: 0.6, checkedAt: "2026-08-09" },
  // The DATED id is what the API actually answers with, and it is the value
  // both execution paths record — `tagUsage()` copies the model straight off
  // the response rather than echoing what was requested. Same price: the alias
  // and the dated snapshot are the same model.
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6, checkedAt: "2026-08-17" },
};

// ---------------------------------------------------------------------------
// MODELS THIS REPO KNOWS IT CALLS AND CANNOT PRICE — declared, not guessed
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (found 2026-08-29)
// The table above priced "the one model this repo actually calls", and that
// sentence had quietly stopped being true. The live deployment's own
// /__cx/health reports `"model": "gpt-5-nano"` — set by OPENAI_MODEL on the
// Vercel project — while the repo default (src/shared/config.js) and
// .env.example both still read gpt-4o-mini. So EVERY production trace row
// names a model with no row above, and the previous behaviour (throw) meant
// the metrics report did not degrade, it DIED: `computeMetrics()` calls
// `computeLlmCost()` unconditionally, so one unpriced attempt took the whole
// dashboard down with an error that reads like a bug in the metrics layer
// rather than "the deployed model has no rate on record".
//
// The throw was chosen against ONE alternative — silently excluding real
// spend — and it beat that alternative. It is not the only alternative. What
// replaces it is the same shape this file already uses for `insufficient_data`
// rather than a false `healthy`: the calls are counted, the model is NAMED,
// the report says its own total is a FLOOR, and no number is invented to
// stand in for the missing rate. A verdict that says "unpriced" is louder
// than an exception nobody can read past, because it survives to the screen.
//
// WHY gpt-5-nano HAS NO ROW ABOVE, AND MUST NOT BE GIVEN ONE FROM HERE.
// A WebSearch on 2026-08-29 returns $0.05 / $0.40 per 1M tokens from several
// aggregators (openrouter.ai, pricepertoken.com and others). That figure is
// recorded here so the next reader does not repeat the search — and it is
// deliberately NOT entered above, for two reasons:
//   1. CLAUDE.md §3's substitution ladder forbids fabricating money outright.
//      openai.com is unreachable from this container, so the rate cannot be
//      taken from rung 1, and a rate card is exactly the class of fact where
//      a plausible-looking wrong number gets acted on.
//   2. The id that would need pricing is not this one anyway. `tagUsage()`
//      records the model the API ANSWERED with — a dated snapshot — and
//      nothing here has yet observed which snapshot gpt-5-nano resolves to.
//      Pricing the alias would leave the real rows unpriced regardless.
// Entering a verified rate later is a one-line change; every unpriced call is
// already counted and attributed, so nothing is lost in the meantime.
export const LLM_MODELS_WITH_NO_PUBLISHED_PRICE = {
  "gpt-5-nano": {
    declaredAt: "2026-08-29",
    why:
      "Deployed model per the live /__cx/health, but no rate could be established from a " +
      "source this container can reach, and money is never fabricated (CLAUDE.md §3).",
  },
};

/**
 * Cases that count as "done" for a cost-per-case denominator — same
 * predicate handlingTimesMs() below uses, kept as one function so the two
 * never silently drift apart.
 */
function isTerminalCase(c) {
  return c.status === "resolved" || c.status === "closed";
}

/**
 * Turn the audit trace's per-attempt usage records into an actual dollar
 * figure. Every LLM call site (uc01's classifier through uc08's
 * dossierBuilder) tags its trace entry with
 * `details: { usage: {model, promptTokens, completionTokens, totalTokens},
 * useCase }` — see src/shared/llm.js's tagUsage()/extractUsage(). This is a
 * pure function over that array: no network, no clock, same discipline as
 * the rest of this file.
 *
 * A rule-based-fallback attempt (or any trace step that isn't an LLM call at
 * all) carries no `details.usage` and is silently skipped — no OpenAI call
 * was made, so there is nothing to charge for; that is the fallback working
 * as designed, not a gap in the data.
 *
 * An attempt that DOES carry usage but names a model with no entry in
 * `pricing` is NOT priced at zero and does not stop the report. It is counted
 * into `unpriced`, its model is named, and `totalUsd` becomes a FLOOR rather
 * than a total — `complete` says which. The same "a wrong number gets acted
 * on, a missing one gets investigated" rule this file's header states for
 * storage reads is what forbids the alternative: a missing price must never
 * quietly render as "free" while real money is being spent. See
 * LLM_MODELS_WITH_NO_PUBLISHED_PRICE for why this replaced a throw, and why
 * the currently-deployed model is deliberately not given a made-up rate.
 *
 * A model is reported as `known: true` when it appears in
 * LLM_MODELS_WITH_NO_PUBLISHED_PRICE — "we know we call this and have no rate"
 * — and `known: false` when it appears nowhere at all, which usually means a
 * model changed under the deployment without anyone recording it. Two
 * different remedies, so two different signals, the same way
 * `approver_entitlement_not_configured` is kept apart from
 * `approver_not_entitled`.
 *
 * @param {object[]} traceEntries  audit_trace-shaped rows (see findRedundantCalls)
 * @param {object} [pricing]  model -> {input, output} USD-per-million-tokens
 * @param {object} [declaredUnpriced]  model -> {declaredAt, why}
 * @returns {{
 *   totalUsd: number,
 *   callsPriced: number,
 *   promptTokens: number,
 *   completionTokens: number,
 *   complete: boolean,
 *   unpriced: {calls:number, promptTokens:number, completionTokens:number,
 *              models:{model:string, calls:number, promptTokens:number,
 *                      completionTokens:number, known:boolean, why:(string|null)}[]},
 *   byUseCase: Map<string, {usd:number, calls:number, promptTokens:number,
 *                           completionTokens:number, unpricedCalls:number}>
 * }}
 */
export function computeLlmCost(
  traceEntries,
  pricing = LLM_PRICING_USD_PER_MILLION_TOKENS,
  declaredUnpriced = LLM_MODELS_WITH_NO_PUBLISHED_PRICE
) {
  let totalUsd = 0;
  let callsPriced = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const byUseCase = new Map();
  const unpricedByModel = new Map();

  /** One use case's bucket, created on first sight so the two loops agree. */
  const bucketFor = (useCase) => {
    if (!byUseCase.has(useCase)) {
      byUseCase.set(useCase, {
        usd: 0,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        unpricedCalls: 0,
      });
    }
    return byUseCase.get(useCase);
  };

  for (const t of traceEntries) {
    const usage = t?.details?.usage;
    if (!usage) continue; // rule-based fallback or a non-usage trace step — nothing to price

    const rate = pricing[usage.model];
    if (!rate) {
      // No rate on record. Count the call, name the model, charge nothing —
      // and let the verdict say so. `model` may legitimately be null (the
      // trace collectors record what the API answered with, and a malformed
      // response has no model), which is still an unpriced call.
      const model = usage.model ?? "(model not recorded)";
      if (!unpricedByModel.has(model)) {
        const declared = declaredUnpriced?.[model] ?? null;
        unpricedByModel.set(model, {
          model,
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          known: Boolean(declared),
          why: declared?.why ?? null,
        });
      }
      const entry = unpricedByModel.get(model);
      entry.calls += 1;
      entry.promptTokens += usage.promptTokens ?? 0;
      entry.completionTokens += usage.completionTokens ?? 0;

      // Token totals stay honest: they count what was SENT, which is knowable
      // without a rate. Only the dollars are missing.
      promptTokens += usage.promptTokens ?? 0;
      completionTokens += usage.completionTokens ?? 0;
      bucketFor(t.details.useCase ?? "unknown").unpricedCalls += 1;
      continue;
    }

    const usd =
      ((usage.promptTokens ?? 0) / 1_000_000) * rate.input +
      ((usage.completionTokens ?? 0) / 1_000_000) * rate.output;

    totalUsd += usd;
    callsPriced += 1;
    promptTokens += usage.promptTokens ?? 0;
    completionTokens += usage.completionTokens ?? 0;

    const bucket = bucketFor(t.details.useCase ?? "unknown");
    bucket.usd += usd;
    bucket.calls += 1;
    bucket.promptTokens += usage.promptTokens ?? 0;
    bucket.completionTokens += usage.completionTokens ?? 0;
  }

  const unpricedModels = [...unpricedByModel.values()].sort((a, b) =>
    a.model.localeCompare(b.model)
  );

  return {
    totalUsd,
    callsPriced,
    promptTokens,
    completionTokens,
    // `false` means totalUsd is a floor. Everything downstream that prints a
    // dollar figure has to be able to say so, which is why this rides with
    // the number rather than being re-derived from the models array.
    complete: unpricedModels.length === 0,
    unpriced: {
      calls: unpricedModels.reduce((n, m) => n + m.calls, 0),
      promptTokens: unpricedModels.reduce((n, m) => n + m.promptTokens, 0),
      completionTokens: unpricedModels.reduce((n, m) => n + m.completionTokens, 0),
      models: unpricedModels,
    },
    byUseCase,
  };
}

/**
 * Turn a cost result into the same {verdict, rationale} shape recommend()
 * returns for a use case, for the same reason: a number with no verdict beside
 * it gets read as whatever the reader already believed. Three verdicts, and
 * the middle one is the whole point of this function existing.
 *
 *   "insufficient_data" — no LLM call in the window carried token usage, so
 *       there is nothing to price. NOT "$0 spent": the seeded dashboard run
 *       drives the rule-based classifier on purpose and legitimately makes no
 *       OpenAI call at all (docs/METRICS.md).
 *   "unpriced"          — at least one real call ran on a model with no rate
 *       on record. The dollar figure is a FLOOR, and the models are named so
 *       the remedy is obvious.
 *   "priced"            — every call that carried usage was priced.
 *
 * @param {ReturnType<typeof computeLlmCost>} cost
 * @returns {{verdict:string, rationale:string}}
 */
export function costVerdict(cost) {
  if (cost.callsPriced === 0 && cost.unpriced.calls === 0) {
    return {
      verdict: "insufficient_data",
      rationale:
        "No LLM attempt in this window recorded token usage, so there is nothing to price. " +
        "This is not a measurement of zero spend.",
    };
  }

  if (cost.unpriced.calls > 0) {
    const named = cost.unpriced.models
      .map((m) => `${m.model} (${m.calls} call${m.calls === 1 ? "" : "s"}${m.known ? "" : ", not recognised"})`)
      .join(", ");
    return {
      verdict: "unpriced",
      rationale:
        `${cost.unpriced.calls} of ${cost.unpriced.calls + cost.callsPriced} priced-eligible ` +
        `call(s) ran on a model with no rate on record: ${named}. The dollar figure is a FLOOR, ` +
        "not the bill. Add a verified rate to LLM_PRICING_USD_PER_MILLION_TOKENS — no number is " +
        "guessed here on purpose.",
    };
  }

  return {
    verdict: "priced",
    rationale: `Every one of the ${cost.callsPriced} usage-bearing call(s) has a rate on record.`,
  };
}

/**
 * Thresholds that turn a measurement into a recommendation. Defaults are
 * deliberately conservative; override per deployment.
 *
 * `minAutoRate` only applies to 🟢 low-tier use cases — it is the point below
 * which zero-touch automation is not earning the complexity it costs.
 * `stopAutoRate` is the point below which it should be switched off rather
 * than tuned. `minAcceptRate` applies wherever a human reviews an AI
 * recommendation: if specialists routinely disagree, the recommendation is
 * noise, and a queue of noise is worse than no queue.
 */
export const DEFAULT_THRESHOLDS = {
  minAutoRate: 0.5,
  stopAutoRate: 0.15,
  minAcceptRate: 0.6,
  stopAcceptRate: 0.3,
  /** Below this many resolved cases, report "insufficient data" not a verdict. */
  minSampleSize: 10,
};

const TERMINAL_REVIEW_STATUSES = new Set(["approved", "rejected"]);

/**
 * Detect cases that must never exist. These are invariant breaches, not
 * bad-but-tolerable numbers, so they are reported separately from the rates
 * and any single one is enough to condemn a use case.
 *
 * Two breaches are checked:
 *  1. An `auto_resolve` carrying escalation flags. policyEngine.evaluate()
 *     returns auto_resolve only when no flag was raised, so a flagged
 *     auto-resolution means something bypassed the gates.
 *  2. An `auto_resolve` on a 🔴 high-tier use case. Those specs mandate that
 *     no execution path exists; one appearing in the data means it does.
 *
 * @param {object[]} cases
 * @returns {{caseId:string, useCase:string, kind:string, detail:string}[]}
 */
export function findIntegrityBreaches(cases) {
  const breaches = [];
  for (const c of cases) {
    if (c.decision !== "auto_resolve") continue;

    const flags = c.flags ?? [];
    if (flags.length > 0) {
      breaches.push({
        caseId: c.id,
        useCase: c.useCase,
        kind: "flagged_auto_resolution",
        detail: `auto-resolved despite flags: ${flags.join(", ")}`,
      });
    }
    if (USE_CASE_TIERS[c.useCase] === "high") {
      breaches.push({
        caseId: c.id,
        useCase: c.useCase,
        kind: "auto_resolution_on_high_tier",
        detail: `${c.useCase} is high-tier and must have no execution path`,
      });
    }
  }
  return breaches;
}

// Grouping is by (parentId, call) because that is exactly what a retry
// sequence is defined by — the same call under the same decision row. Two
// different parents firing the same call once each are two single fires, not
// a duplicate, and must never be grouped together. Shared by
// `findRedundantCalls()` and `hasMultiAttemptGroup()` below, which both need
// the same groups and must never be able to disagree about what one is.
function groupTraceEntriesByCall(traceEntries) {
  const byGroup = new Map();
  for (const raw of traceEntries) {
    if (!raw || raw.call == null) continue; // not a trace entry — ignore
    // ACCEPT THE TABLE'S OWN COLUMN NAME, not only the camelCase one.
    //
    // `audit_trace`'s column is `parent_id`. Rows loaded straight from Postgres
    // carry that name, and reading only `parentId` grouped every one of them
    // under `undefined` — one bucket in which unrelated calls look like
    // duplicates of each other and real duplicates hide among them.
    //
    // Same defect class as the alpha-3 country codes and the mock's invented
    // `country_code`: code agreeing with its fixtures while disagreeing with
    // the real store. It was latent only because nothing reads `audit_trace`
    // back from the database yet — and the n8n graphs have just started
    // writing to it, so it would not have stayed latent for long.
    const t = { ...raw, parentId: raw.parentId ?? raw.parent_id ?? null };
    // NUL separator so ("a", "b") can never collide with ("ab", "") in the key.
    const key = `${t.parentId ?? ""}\u0000${t.call}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(t);
  }
  return byGroup;
}

/**
 * Whether the trace holds at least one group of two-or-more entries sharing
 * (parentId, call) — the only shape a retry sequence (or a duplicate call)
 * can take. UC-01 r7 R7-35: a drill-down whose calls each fired once (three
 * DIFFERENT calls, each at attempt 1) has no retry-sequence bookkeeping to
 * describe at all, and rendering "every multi-attempt group below reads as
 * one clean retry sequence" on it is a claim about a shape the data does not
 * have — `findRedundantCalls()` returning `[]` is not evidence a clean group
 * exists, only that no group was OFFENDING. This answers the question `[]`
 * cannot: is there a multi-attempt group here at all.
 *
 * @param {object[]} traceEntries
 * @returns {boolean}
 */
export function hasMultiAttemptGroup(traceEntries) {
  for (const entries of groupTraceEntriesByCall(traceEntries).values()) {
    if (entries.length >= 2) return true;
  }
  return false;
}

/**
 * Flag trace entries that fired the same call more than once for no good
 * reason. The audit trace records one entry per ATTEMPT at an LLM/API call
 * (audit.js's logTraceStep), and the retry wrapper (retry.js's withRetry) is
 * the ONLY legitimate way multiple entries for one call under one parent can
 * exist — it numbers them 1, 2, 3, … through its onAttempt callback. So a
 * group that does not read as one clean 1..n sequence is a genuine duplicate:
 * two entries both claiming attempt 1 (the same call issued twice), or a
 * mangled sequence with a gap or a repeated attempt number.
 *
 * @param {object[]} traceEntries  audit_trace-shaped rows: {id, at, parentId,
 *   call, attempt, ok, error, details}
 * @returns {{kind:string, parentId:string|null, call:string, attempts:number[],
 *   traceIds:string[], detail:string}[]}  one flag per offending group
 */
export function findRedundantCalls(traceEntries) {
  const byGroup = groupTraceEntriesByCall(traceEntries);

  const flags = [];
  for (const entries of byGroup.values()) {
    // A single fire is the normal case; only multi-entry groups can be a
    // retry sequence OR a duplicate, so only they need inspecting.
    if (entries.length < 2) continue;

    const attempts = entries.map((t) => t.attempt);
    if (!isCleanRetrySequence(attempts)) {
      flags.push({
        kind: "redundant_call",
        parentId: entries[0].parentId ?? null,
        call: entries[0].call,
        attempts,
        traceIds: entries.map((t) => t.id),
        detail:
          `call "${entries[0].call}" fired ${entries.length} time(s) under parent ` +
          `${entries[0].parentId ?? "(unbound)"} with attempts [${attempts.join(", ")}] — ` +
          `not one clean retry sequence (expected [1..${entries.length}])`,
      });
    }
  }

  // Deterministic order so a given trace set always renders the same page.
  return flags.sort(
    (a, b) => (a.parentId ?? "").localeCompare(b.parentId ?? "") || a.call.localeCompare(b.call)
  );
}

/**
 * A legitimate retry sequence is exactly the numbers 1..n once each — that is
 * what withRetry() numbers via its onAttempt callback. Any duplicate, gap or
 * missing attempt number means the group is NOT the retry wrapper's
 * bookkeeping, and is therefore a redundant call.
 */
function isCleanRetrySequence(attempts) {
  const sorted = [...attempts].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return false;
  }
  return true;
}

/**
 * Reason strings that were RENAMED in code, mapped old -> current.
 *
 * WHY THIS MAP EXISTS RATHER THAN A BACKFILL. `audit_log` is append-only by
 * design (`00-FOUNDATION.md`: `cases` is mutable current state, `audit_log` is
 * immutable history), so a row written last month records the string the
 * engine actually emitted last month and must keep it. Nothing here rewrites
 * history — this is a read-side fold, applied only when ranking.
 *
 * WHY FOLD AT ALL. The ranking's whole job is that its top row names the next
 * thing worth engineering. One cause split across two labels — because someone
 * renamed a flag, not because anything about the cause changed — reports the
 * problem at half its real size and can push it below a row that matters less.
 * That is a measurement defect, and this dashboard exists to measure.
 *
 * Additions here must be genuine renames of the SAME test: same gate, same
 * inputs, same verdict, different words. A gate whose *meaning* changed needs a
 * new row, because it is then genuinely a different cause.
 *
 * - `unsupported_destination` -> `destination_jurisdiction_excluded`: UC-03's
 *   step-7 gate, renamed 2026-08-17. The predicate is byte-for-byte unchanged
 *   (membership in `GET /v1/countries`); only the claim the name makes was
 *   wrong — see `src/uc03/policyEngine.js` step 7 and
 *   `docs/research/COUNTRY-SUPPORT-SEMANTICS.md` §8.
 */
export const RENAMED_EXCEPTION_REASONS = new Map([
  ["unsupported_destination", "destination_jurisdiction_excluded"],
]);

/**
 * Rank why cases did NOT auto-resolve, most common first.
 *
 * This is the single most actionable table in the dashboard: the top row is,
 * by definition, the next thing worth engineering. It is what turns "the
 * automation only handles 40%" into "the automation only handles 40% *because
 * of this specific cause*".
 *
 * Renamed reasons are folded onto their current name via
 * RENAMED_EXCEPTION_REASONS — see that map for why this happens here and not
 * in the store.
 *
 * @param {object[]} cases
 * @returns {{reason:string, count:number, share:number}[]}
 */
/**
 * The decision that counts as SUCCESS for each tier — "the gates ran and the
 * case reached the outcome this use case exists to produce."
 *
 * It is tier-dependent on purpose, and getting that wrong is how a metric
 * starts lying. For 🟢 low, success is `auto_resolve`: the whole point is that
 * nobody was troubled. For 🟡 medium, success is REACHING A HUMAN — the human
 * gate IS the design, so `ready_for_approval` is the working state, not a
 * near-miss. For 🔴 high the honest answer is that there is no success
 * decision at all: those use cases compile a dossier and escalate, always, and
 * a 🔴 that ever "succeeded" would be an integrity violation, which
 * findIntegrityBreaches() already reports. So 🔴 is excluded below rather than
 * given an impossible target.
 */
const SUCCESS_DECISIONS_BY_TIER = {
  low: new Set(["auto_resolve", "auto_approve"]),
  medium: new Set([
    "human_review",
    "ready_for_approval",
    "prepared_for_signoff",
    "dual_approval_required",
    "triple_approval_required",
    "off_cycle_adjustment_required",
  ]),
};

/**
 * THE "STRUCTURALLY CANNOT SUCCEED" DETECTOR.
 *
 * This repository's most expensive recurring defect is a gate that can never
 * reach its own success outcome — UC-03 shipped for weeks unable to auto-resolve
 * anything, UC-06's payroll gate could not admit any amendment, UC-02's
 * duplicate check returned a constant. Every one of them PASSED THE FULL TEST
 * SUITE throughout, because refusing correctly and being unable to succeed look
 * identical from outside: same decision, same shape, same green run. Only a
 * positive case separates them, and the reason these survived is that nobody
 * had written one.
 *
 * So this checks the property directly against real traffic: a use case with a
 * meaningful number of decisions and ZERO successes is reported. It cannot
 * prove a bug — a genuinely quiet month of hard cases looks the same — which is
 * why the verdict is "look at this", not "this is broken". But it turns an
 * invisible failure into a visible question, which is the whole difference.
 *
 * `minSample` exists because one refusal is not evidence of anything. It is
 * deliberately small: the cost of investigating a false positive is minutes,
 * and the cost of a missed one is a use case that has never worked shipping as
 * though it had.
 *
 * @param {object[]} cases                rows carrying {useCase, decision}
 * @param {object} [opts]
 * @param {number} [opts.minSample]       decisions required before reporting
 * @returns {{useCase:string, tier:string, total:number, topReason:string|null}[]}
 */
export function findNeverSucceeded(cases, { minSample = 5 } = {}) {
  const byUseCase = new Map();
  for (const c of cases) {
    if (!byUseCase.has(c.useCase)) byUseCase.set(c.useCase, []);
    byUseCase.get(c.useCase).push(c);
  }

  const findings = [];
  for (const [useCase, rows] of byUseCase) {
    const tier = USE_CASE_TIERS[useCase] ?? "unknown";
    const successes = SUCCESS_DECISIONS_BY_TIER[tier];
    // 🔴 high and any unknown tier have no success decision to be missing.
    if (!successes) continue;
    if (rows.length < minSample) continue;
    if (rows.some((c) => successes.has(c.decision))) continue;

    // The most common reason is the first thing an investigator wants: it is
    // either the bug's own signature or the honest explanation.
    const reasons = new Map();
    for (const c of rows) {
      const r = c.reason ?? "(no reason recorded)";
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
    const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    findings.push({ useCase, tier, total: rows.length, topReason });
  }
  return findings.sort((a, b) => b.total - a.total);
}

export function rankExceptionReasons(cases) {
  const exceptions = cases.filter((c) => c.decision !== "auto_resolve");
  const counts = new Map();
  for (const c of exceptions) {
    const raw = c.reason ?? "unspecified";
    const reason = RENAMED_EXCEPTION_REASONS.get(raw) ?? raw;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      share: exceptions.length === 0 ? 0 : count / exceptions.length,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Median of a numeric array. Returns null for an empty array. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * How long cases took from creation to their last update, in milliseconds.
 * Only meaningful for cases that actually reached a terminal state — a case
 * still sitting in a queue would otherwise report an artificially short time
 * and flatter the automation.
 */
function handlingTimesMs(cases) {
  return cases
    .filter(isTerminalCase)
    .map((c) => new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
}

/**
 * Turn one use case's numbers into a verdict CX leadership can act on.
 *
 * Returns one of:
 *   "integrity_violation" — an invariant broke; stop and fix, regardless of rates
 *   "insufficient_data"   — too few cases to judge; keep observing
 *   "stop"                — not earning its complexity; switch it off
 *   "iterate"             — working, but a specific number is below target
 *   "healthy"             — leave it alone
 *
 * @returns {{verdict:string, rationale:string}}
 */
export function recommend({ tier, total, autoRate, acceptRate, breaches, thresholds }) {
  if (breaches > 0) {
    return {
      verdict: "integrity_violation",
      rationale: `${breaches} case(s) broke a safety invariant. Fix before tuning anything else.`,
    };
  }
  if (total < thresholds.minSampleSize) {
    return {
      verdict: "insufficient_data",
      rationale: `Only ${total} case(s); need ${thresholds.minSampleSize} before drawing a conclusion.`,
    };
  }

  // 🟡 Medium and 🔴 high are judged on the accept-rate alone — auto-rate is
  // deliberately not a verdict input for them, because the human gate is the
  // design. So zero decided review rows is not a "healthy" for those tiers: it
  // is the same "too little data to judge" state as a small sample, and must
  // never render as 0% either ("everyone rejected it" is a different situation).
  if (tier !== "low" && acceptRate === null) {
    return {
      verdict: "insufficient_data",
      rationale:
        `No specialist decisions on record yet; need decided review rows before the accept-rate can be judged.`,
    };
  }

  // 🟢 Low tier is the only tier where a high auto-rate is the goal.
  if (tier === "low") {
    if (autoRate < thresholds.stopAutoRate) {
      return {
        verdict: "stop",
        rationale:
          `Auto-resolution is ${pct(autoRate)}, below the ${pct(thresholds.stopAutoRate)} floor. ` +
          `Nearly every case reaches a human anyway, so the automation is adding review load, not removing it.`,
      };
    }
    if (autoRate < thresholds.minAutoRate) {
      return {
        verdict: "iterate",
        rationale:
          `Auto-resolution is ${pct(autoRate)}, under the ${pct(thresholds.minAutoRate)} target. ` +
          `Work the top exception reason.`,
      };
    }
  }

  // 🟡 Medium and 🔴 high are judged on whether the human gate is worth staffing:
  // if specialists keep overriding the AI, the preparation is not helping them.
  if (acceptRate !== null) {
    if (acceptRate < thresholds.stopAcceptRate) {
      return {
        verdict: "stop",
        rationale:
          `Specialists accept only ${pct(acceptRate)} of AI recommendations. ` +
          `Below ${pct(thresholds.stopAcceptRate)} the recommendation is noise and the queue costs more than it saves.`,
      };
    }
    if (acceptRate < thresholds.minAcceptRate) {
      return {
        verdict: "iterate",
        rationale:
          `Specialist acceptance is ${pct(acceptRate)}, under the ${pct(thresholds.minAcceptRate)} target. ` +
          `The recommendation quality, not the routing, is the problem.`,
      };
    }
  }

  return { verdict: "healthy", rationale: "Within every configured threshold." };
}

/** Format a 0..1 ratio as a percentage string. */
export function pct(ratio) {
  if (ratio === null || ratio === undefined) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/**
 * The whole report, from rows.
 *
 * @param {object} args
 * @param {object[]} args.cases         `cases` rows (camelCase, as CaseStore emits)
 * @param {object[]} [args.reviewQueue] `review_queue` rows
 * @param {object[]} [args.traces]      `audit_trace`-shaped rows — the per-attempt
 *   trace half of the audit log, checked for redundant calls (see
 *   findRedundantCalls) AND for LLM spend (see computeLlmCost) — the same
 *   `details.usage`/`details.useCase` a trace step already carries feeds
 *   both. Defaults to none.
 * @param {object} [args.thresholds]
 * @returns {object} the full metrics report, now including a top-level
 *   `costs` block and a `cost` block on every `byUseCase` entry
 */
export function computeMetrics({ cases, reviewQueue = [], thresholds = DEFAULT_THRESHOLDS, traces = [] }) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  // review_queue rows carry case_id, so group them by case to attribute a
  // specialist's approve/reject back to the use case that produced it.
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const reviewsByUseCase = new Map();
  for (const r of reviewQueue) {
    const parent = caseById.get(r.caseId);
    if (!parent) continue; // orphan row — ignore rather than guess
    if (!reviewsByUseCase.has(parent.useCase)) reviewsByUseCase.set(parent.useCase, []);
    reviewsByUseCase.get(parent.useCase).push(r);
  }

  const allBreaches = findIntegrityBreaches(cases);
  const duplicateCalls = findRedundantCalls(traces);
  const llmCost = computeLlmCost(traces);
  const useCaseIds = [...new Set(cases.map((c) => c.useCase))].sort();

  const byUseCase = useCaseIds.map((useCase) => {
    const rows = cases.filter((c) => c.useCase === useCase);
    const tier = USE_CASE_TIERS[useCase] ?? "unknown";

    const counts = {
      auto_resolve: rows.filter((c) => c.decision === "auto_resolve").length,
      human_review: rows.filter((c) => c.decision === "human_review").length,
      escalate: rows.filter((c) => c.decision === "escalate").length,
    };
    const total = rows.length;
    const autoRate = total === 0 ? 0 : counts.auto_resolve / total;

    const reviews = reviewsByUseCase.get(useCase) ?? [];
    const decided = reviews.filter((r) => TERMINAL_REVIEW_STATUSES.has(r.status));
    const approved = decided.filter((r) => r.status === "approved").length;
    // null (not 0) when nothing has been decided yet — "no data" and
    // "everyone rejected it" must not render as the same number.
    const acceptRate = decided.length === 0 ? null : approved / decided.length;

    const breaches = allBreaches.filter((b) => b.useCase === useCase);

    const costBucket = llmCost.byUseCase.get(useCase) ?? {
      usd: 0,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      unpricedCalls: 0,
    };
    const resolvedCount = rows.filter(isTerminalCase).length;

    return {
      useCase,
      tier,
      total,
      counts,
      autoRate,
      exceptionRate: 1 - autoRate,
      review: {
        pending: reviews.filter((r) => r.status === "pending").length,
        approved,
        rejected: decided.length - approved,
        acceptRate,
      },
      medianHandlingMs: median(handlingTimesMs(rows)),
      cost: {
        usd: costBucket.usd,
        calls: costBucket.calls,
        promptTokens: costBucket.promptTokens,
        completionTokens: costBucket.completionTokens,
        // null (not 0) mirrors acceptRate above — no resolved cases yet is
        // "no data", not "free."
        perResolvedCase: resolvedCount === 0 ? null : costBucket.usd / resolvedCount,
        // Calls this use case really made on a model with no rate on record.
        // When it is non-zero, `usd` and `perResolvedCase` are FLOORS — which
        // is what `complete` says, so no reader has to infer it from a count.
        unpricedCalls: costBucket.unpricedCalls,
        complete: costBucket.unpricedCalls === 0,
      },
      breaches,
      ...recommend({ tier, total, autoRate, acceptRate, breaches: breaches.length, thresholds: t }),
    };
  });

  // Tier rollup of the same per-use-case cost buckets — one pass over the
  // already-computed byUseCase array rather than a second trace scan.
  const costByTier = {};
  for (const u of byUseCase) {
    if (!costByTier[u.tier]) costByTier[u.tier] = { usd: 0, calls: 0 };
    costByTier[u.tier].usd += u.cost.usd;
    costByTier[u.tier].calls += u.cost.calls;
  }

  const totalCases = cases.length;
  const totalAuto = cases.filter((c) => c.decision === "auto_resolve").length;
  const totalResolved = cases.filter(isTerminalCase).length;
  const neverSucceeded = findNeverSucceeded(cases);

  return {
    generatedAt: new Date().toISOString(),
    thresholds: t,
    totals: {
      cases: totalCases,
      autoResolved: totalAuto,
      autoRate: totalCases === 0 ? 0 : totalAuto / totalCases,
      humanReview: cases.filter((c) => c.decision === "human_review").length,
      escalated: cases.filter((c) => c.decision === "escalate").length,
      integrityBreaches: allBreaches.length,
      duplicateCalls: duplicateCalls.length,
      // Not an error count. A use case here has never once reached its own
      // success outcome, which is the signature of a gate that CANNOT succeed
      // rather than one refusing correctly. See findNeverSucceeded().
      neverSucceeded: neverSucceeded.length,
      medianHandlingMs: median(handlingTimesMs(cases)),
    },
    costs: {
      totalUsd: llmCost.totalUsd,
      callsPriced: llmCost.callsPriced,
      promptTokens: llmCost.promptTokens,
      completionTokens: llmCost.completionTokens,
      // null (not 0) — same "no data" vs. "free" distinction as above.
      perResolvedCase: totalResolved === 0 ? null : llmCost.totalUsd / totalResolved,
      byTier: costByTier,
      pricing: LLM_PRICING_USD_PER_MILLION_TOKENS,
      // Whether `totalUsd` is a total or a floor, which model(s) made it a
      // floor, and a verdict in the same {verdict, rationale} shape every use
      // case already carries. A cost block with no verdict beside it reads as
      // authoritative whether or not it is; this is the `insufficient_data`
      // rule (never a false `healthy`) applied to money.
      complete: llmCost.complete,
      unpriced: llmCost.unpriced,
      declaredUnpriced: LLM_MODELS_WITH_NO_PUBLISHED_PRICE,
      ...costVerdict(llmCost),
    },
    byUseCase,
    exceptionReasons: rankExceptionReasons(cases),
    breaches: allBreaches,
    duplicateCalls,
    neverSucceeded,
  };
}
