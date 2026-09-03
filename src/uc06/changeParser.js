// ---------------------------------------------------------------------------
// changeParser.js  —  UC-06 request understanding (THE LLM SEAM, deliberately narrow)
// ---------------------------------------------------------------------------
// WHY THIS IS SHAPED DIFFERENTLY FROM uc01/classifier.js
// UC-01's LLM classifies a request; nothing it returns is money or a fact
// about the employment record. UC-06 is different: an amendment changes
// comp/title/hours, and letting an LLM be the SOURCE of a salary figure from
// free text would violate the one rule this whole portfolio is built around
// ("LLMs interpret; deterministic code decides"). So:
//
//   - `proposedChanges` (the actual new values) MUST arrive as structured
//     data — the equivalent of a real amendment form's fields, not something
//     parsed out of a paragraph. This module never invents or edits them.
//   - amendmentType() is a PURE, DETERMINISTIC function over those structured
//     changes — SALARY_INCREASE vs SALARY_DECREASE is a fact derivable from
//     old/new values, not something to ask an LLM to guess.
//   - draftSummary() is the one place an LLM may run, and its output is
//     display/audit text ONLY — a human-readable sentence for the specialist
//     screens. It is never read back into any decision or payload.
//
// Same DI/fallback shape as classifier.js: real OpenAI when configured,
// deterministic template on any failure or when unconfigured. Tests always
// get the deterministic path, same hermetic guarantee as UC-01.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";

const CHANGE_FIELDS = ["salary", "jobTitle", "weeklyHours"];

/**
 * Deterministic — NOT an LLM call. Which fields changed, and (for salary)
 * whether it's an increase or decrease, are facts already present in the
 * structured input.
 * @param {object} changes  e.g. {salary: {oldAmount, newAmount, currency}, jobTitle: {oldValue, newValue}}
 * @returns {string} one of SALARY_INCREASE | SALARY_DECREASE | SALARY_CHANGE_UNDETERMINED
 *   | JOB_TITLE_CHANGE | WORKING_HOURS_CHANGE | COMPOSITE | OTHER
 */
export function amendmentType(changes) {
  const present = CHANGE_FIELDS.filter((f) => changes && changes[f] !== undefined);
  if (present.length === 0) return "OTHER";
  if (present.length > 1) return "COMPOSITE";

  const field = present[0];
  if (field === "salary") {
    // INCREASE-VS-DECREASE IS ONLY A FACT WHEN BOTH AMOUNTS ARE REAL NUMBERS
    // (finding F-31). `null >= null` is `0 >= 0` — true — so an amendment
    // stating no figures at all used to be typed SALARY_INCREASE: a comparison
    // operator answering a question it was never asked. Quoted amounts are
    // refused for a second reason: `>=` on strings compares lexically, so
    // `"9" >= "10"` is true, and accepting one here is also how a 100x scaling
    // error gets into money (same rule buildAmendmentPayload() applies).
    const { oldAmount, newAmount } = changes.salary;
    const real = (v) => typeof v === "number" && Number.isFinite(v);
    if (!real(oldAmount) || !real(newAmount)) return "SALARY_CHANGE_UNDETERMINED";
    return newAmount >= oldAmount ? "SALARY_INCREASE" : "SALARY_DECREASE";
  }
  if (field === "jobTitle") return "JOB_TITLE_CHANGE";
  if (field === "weeklyHours") return "WORKING_HOURS_CHANGE";
  return "OTHER";
}

/** Deterministic fallback — always correct, if plain. Used when no LLM is configured or on any failure. */
// A figure that is not a finite number is said to be UNSTATED, never printed.
// "salary from 50000 to null EUR" reached a real ticket (2026-09-02, ticket
// 271), and a quoted "60000" was restated by the LLM as a real increase above
// a `change_value_underivable` refusal (ticket 281). The template is the floor
// under both: it names the absence, and the value-refusal short-circuits to it.
const amountOrUnstated = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "an unstated amount");

function draftSummaryTemplate({ changes, requestedEffectiveDate }) {
  const parts = [];
  if (changes.salary) {
    parts.push(
      `salary from ${amountOrUnstated(changes.salary.oldAmount)} to ${amountOrUnstated(changes.salary.newAmount)}` +
        `${changes.salary.currency ? ` ${changes.salary.currency}` : ""}`
    );
  }
  if (changes.jobTitle) {
    parts.push(`job title from "${changes.jobTitle.oldValue}" to "${changes.jobTitle.newValue}"`);
  }
  if (changes.weeklyHours) {
    parts.push(`weekly hours from ${changes.weeklyHours.oldValue} to ${changes.weeklyHours.newValue}`);
  }
  const changeText = parts.length ? parts.join("; ") : "no recognized fields";
  return `Amendment: change ${changeText}, effective ${requestedEffectiveDate}.`;
}

const SYSTEM_PROMPT = `You write a one-sentence, plain-English summary of an employment contract amendment for a specialist review screen.
You are given the exact structured changes already decided — you must not invent, alter, or add any figures or values.
Return ONLY a JSON object: {"summary": string}.
The summary must restate only the given changes and effective date, in plain English, with no added facts.`;

/**
 * Draft a human-readable summary for the approval screens. Structured
 * `changes`/`requestedEffectiveDate` are the ONLY facts allowed in the
 * output — this is display text, never re-parsed into a decision.
 * @param {object} args
 * @param {object} args.changes
 * @param {string} args.requestedEffectiveDate
 * @param {string} [args.reasonText]  optional free-text context from the requester
 * @param {object} [opts]  test-only seams — default to the real llm module/no
 *   audit so callers are unaffected; injectable so hermetic tests never touch
 *   the network and never wait on real backoff delays.
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] when set,
 *   every retry attempt is recorded as an audit trace step (§4 invariant 7),
 *   same seam as classifier.js's classifyRequest().
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{summary: string, source: "llm"|"template"}>}
 */
export async function draftSummary(
  { changes, requestedEffectiveDate, reasonText = "" },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return { summary: draftSummaryTemplate({ changes, requestedEffectiveDate }), source: "template" };
  }
  try {
    const userPrompt = `Changes: ${JSON.stringify(changes)}\nEffective date: ${requestedEffectiveDate}\nRequester's stated reason: "${reasonText}"`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
    // Retry the LLM call (up to 3 attempts, §4 invariant 10) before this
    // try/catch's template fallback runs — same discipline as classifier.js.
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!r || typeof r.summary !== "string" || !r.summary.trim()) {
          throw new Error(`LLM returned an invalid summary shape: ${JSON.stringify(r)}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "changeParser.draftSummary",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-06" } : null,
          }),
      }
    );
    return { summary: result.summary.trim(), source: "llm" };
  } catch (err) {
    console.error(`[changeParser] LLM summary failed after retries, falling back to template: ${err.message}`);
    return { summary: draftSummaryTemplate({ changes, requestedEffectiveDate }), source: "template" };
  }
}
