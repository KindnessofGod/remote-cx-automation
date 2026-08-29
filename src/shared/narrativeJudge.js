// ---------------------------------------------------------------------------
// narrativeJudge.js  —  scoped LLM-as-judge faithfulness check (issue #27)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Two use cases (UC-06, UC-08) draft prose FROM already-decided structured
// facts via an LLM seam (`changeParser.draftSummary()`, `dossierBuilder.
// draftNarrative()`). That prose is shown to a specialist. A reasonable
// concern is: did the model add an extra jurisdiction, drop a figure, restate
// a salary as hours, or otherwise drift from the structured inputs it was
// given? This file answers that question — and *only* that question.
//
// WHAT THIS IS NOT
// - NOT a gate, NOT a second decision input, NOT a quality/accuracy benchmark.
//   The decision tree of either use case is untouched by this module's output:
//   `dualApprovalPolicy.js`/`policyEngine.js` read none of this; UC-08's
//   decision is unconditionally "escalate" regardless of any verdict. The
//   wiring points (handleAmendmentRequest, handleTaxInquiry) attach the
//   verdict to the case/dossier record for a human to see — that is the start
//   and end of what it does.
// - NOT a rule-based fallback target the way classifier.js has one. The
//   closest equivalent — "if the judge could not run at all, treat it as
//   faithful" — would be dishonest, AND the opposite ("treat absence as
//   not-faithful") would invent a negative verdict from an absence of one,
//   which the ticket explicitly forbids. So the unconfigured/error path
//   returns the explicit `{verdict: "not_evaluated"}` sentinel that callers
//   surface as-is. Never block, never fabricate.
//
// Same DI/validate-or-fallback discipline as src/uc01/classifier.js: a real
// OpenAI call behind `isLlmConfigured()`, an injectable `askJson` /
// `isConfigured` in opts so tests drive either path hermetically, and a strict
// shape check on the returned JSON before it's trusted — ANY failure (parse
// error, network, missing/invalid field, a verdict string we don't recognise)
// collapses to `not_evaluated`. `npm test` has no `OPENAI_API_KEY`, so by
// default no network is touched from anywhere in the suite.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured } from "./llm.js";

/**
 * @typedef {object} FaithfulnessVerdict
 * @property {"faithful"|"not_faithful"|"not_evaluated"} verdict
 * @property {string|null} reason  plain-English note from the LLM, or null
 *   when the judge never ran. Never empty prose — kept short and factual.
 */

const VALID_VERDICTS = new Set(["faithful", "not_faithful"]);

const SYSTEM_PROMPT = `You are a strict faithfulness judge for a single piece of drafted support prose.
You are given the original structured facts that the prose was drafted from, and the prose itself. Decide ONLY whether the prose restates those facts faithfully — it must not invent figures, jurisdictions, dates, or any statement not derivable from the given facts, and must not omit a material fact from the inputs.
You are NOT judging style, completeness beyond the inputs, accuracy against the real world, or any answer the inputs themselves were not trying to encode.
Return ONLY a JSON object with exactly these fields:
{"verdict": "faithful" | "not_faithful", "reason": string}
The reason must be one short sentence stating the specific drift, or "no drift" when faithful. Never propose a rewrite. Never return anything other than this object.`;

function notEvaluated() {
  return { verdict: "not_evaluated", reason: null };
}

function isValidVerdictShape(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    VALID_VERDICTS.has(obj.verdict) &&
    (typeof obj.reason === "string" || obj.reason === null || obj.reason === undefined)
  );
}

/**
 * Judge one drafted piece of prose for faithfulness to the structured inputs
 * it was drafted from. Purely informational; the caller surfaces the verdict,
 * it never consumes it as a decision input.
 *
 * @param {object} args
 * @param {string} args.narrative           the drafted prose
 * @param {object} args.structuredInputs   the already-decided facts the prose
 *   restates (shape per use case — UC-06 passes {changes, requestedEffectiveDate};
 *   UC-08 passes {inquiryType, jurisdictions, presenceDays, citations})
 * @param {object} [opts]  test-only seams — defaults to the real llm module
 *   so production callers are unaffected; injectable for hermetic tests
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @returns {Promise<FaithfulnessVerdict>}
 */
export async function judgeNarrative(
  { narrative, structuredInputs },
  { askJson: ask = askJson, isConfigured = isLlmConfigured } = {}
) {
  if (!isConfigured()) {
    return notEvaluated();
  }
  try {
    const userPrompt = `Structured facts:\n${JSON.stringify(structuredInputs ?? {})}\n\nDrafted prose:\n"""\n${narrative ?? ""}\n"""`;
    const result = await ask(SYSTEM_PROMPT, userPrompt);
    if (!isValidVerdictShape(result)) {
      throw new Error(`LLM returned an invalid verdict shape: ${JSON.stringify(result)}`);
    }
    return { verdict: result.verdict, reason: typeof result.reason === "string" ? result.reason : null };
  } catch (err) {
    // Attach nothing the caller could mistake for a verdict. Never block the
    // flow; never treat a judge failure as a "not faithful" verdict — that
    // would be inventing a negative judgement from an absence of one.
    console.error(`[narrativeJudge] LLM judgement failed, recording not_evaluated: ${err.message}`);
    return notEvaluated();
  }
}