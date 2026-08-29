// ---------------------------------------------------------------------------
// letterExtractor.js  —  UC-05 request understanding (THE LLM SEAM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT'S NARROWER THAN UC-01'S CLASSIFIER
// UC-01's classifier decides WHAT KIND of request a ticket is. UC-05 is
// different: the request type is always "resignation", but the body of the
// resignation letter usually contains the employee's STATED departure
// date and reason. Those are the two facts the calculator needs to
// compare against the statutory end date. The LLM's job here is EXTRACTION
// only — pulling a structured pair out of free text. The DECISION of
// whether the proposed date is within statute is the calculator's
// (deterministic), the same "LLM interprets; deterministic code decides"
// split every other LLM seam in this repo enforces
// (00-FOUNDATION.md invariant #1).
//
// Same DI/validate-or-fallback discipline as uc01/classifier.js, uc06/
// changeParser.js, uc08/inquiryParser.js: real OpenAI when configured,
// shape-validated JSON, rule-based fallback on any failure or when
// unconfigured. `npm test` never depends on OPENAI_API_KEY.
//
// Every result is tagged with which path produced it —
// `source: "llm"` or `source: "rule_based_fallback"` — same discipline
// as the others (00-FOUNDATION.md invariant #8).
//
// WHAT IT MUST NOT DO (UC-05.md §6)
// Decide the legal notice period — that's noticePeriodTable.js +
// noticePeriodCalculator.js. Compute the PTO payout — that's ptoPayout.js.
// Output any date other than the one the EMPLOYEE stated, or any "reason"
// beyond a short subject-line string the HR Ops can read.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { asLowerText } from "../shared/text.js";

/**
 * @typedef {object} ExtractedLetter
 * @property {string|null} proposedEndDate   "YYYY-MM-DD" if the letter states a
 *   specific last working day, otherwise null
 * @property {string|null} reason            short subject-line string the HR Ops
 *   will see in the sidebar, otherwise null
 * @property {number} confidence             0..1 — how certain the extraction is
 * @property {"llm"|"rule_based_fallback"} source
 */

const SYSTEM_PROMPT = `You extract structured facts from an employee's voluntary resignation letter for an Employer-of-Record platform.
Read the letter text and return ONLY a JSON object with exactly these fields:
{
  "proposedEndDate": string | null,  // "YYYY-MM-DD" if the letter states a specific last working day, else null
  "reason": string | null,           // one short sentence stating the reason (e.g. "personal", "relocation", "new opportunity") if the letter states one, else null
  "confidence": number between 0 and 1
}
Rules:
- Return the EMPLOYEE'S STATED last working day, not a date you compute.
- If the letter does not state a specific date (only "in due course", "as soon as possible", etc.), set proposedEndDate to null — do not guess.
- If the letter does not state a reason, set reason to null — do not invent one.
- "confidence" is your honest self-assessment of how unambiguously the date and reason were stated.
- Never invent a date that is not in the text. Never decide whether the date is acceptable — that is not your job.
Return strict JSON, no prose, no markdown fences.`;

/** @param {unknown} obj */
function isValidExtraction(obj) {
  return (
    obj &&
    (obj.proposedEndDate === null || typeof obj.proposedEndDate === "string") &&
    (obj.reason === null || typeof obj.reason === "string") &&
    typeof obj.confidence === "number" &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function ruleBasedExtraction({ text }) {
  const lower = asLowerText(text);

  // "my last working day will be <date>" / "effective <date>" / "my final day is <date>"
  let proposedEndDate = null;
  let confidence = 0.4;
  // ISO date pattern, e.g. "2026-09-15"
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    proposedEndDate = isoMatch[1];
    confidence = 0.9;
  } else {
    // "15 September 2026" / "September 15, 2026" / "15 Sep 2026" — a deliberately
    // narrow regex; the LLM is the proper path for less standard formats. We
    // return null rather than guess when this regex misses, exactly the
    // discipline the spec calls for: "If the letter does not state a specific
    // date, set proposedEndDate to null — do not guess."
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
    const longForm = lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/);
    const longFormUs = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/);
    const shortForm = lower.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{4})\b/);
    let day, mon, year;
    if (longForm) { day = Number(longForm[1]); mon = monthMap[longForm[2].slice(0, 3)]; year = Number(longForm[3]); }
    else if (longFormUs) { day = Number(longFormUs[2]); mon = monthMap[longFormUs[1].slice(0, 3)]; year = Number(longFormUs[3]); }
    else if (shortForm) { day = Number(shortForm[1]); mon = monthMap[shortForm[2].slice(0, 3)]; year = Number(shortForm[3]); }
    if (Number.isInteger(mon)) {
      const mm = String(mon + 1).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      proposedEndDate = `${year}-${mm}-${dd}`;
      confidence = 0.8;
    }
  }

  let reason = null;
  const reasonPatterns = [
    /\bfor personal reasons\b/,
    /\bto (pursue|take|accept|join|start) (a|an|my) (new|other)?\s*(opportunity|role|position|job)\b/,
    /\brelocation\b/,
    /\bfamily reasons\b/,
    /\bhealth reasons\b/,
    /\bbetter opportunity\b/,
    /\bfurther studies\b/,
    /\bgoing back to school\b/,
  ];
  for (const re of reasonPatterns) {
    const m = lower.match(re);
    if (m) {
      reason = m[0].trim();
      break;
    }
  }
  if (reason) confidence = Math.max(confidence, 0.7);

  return { proposedEndDate, reason, confidence, source: "rule_based_fallback" };
}

/**
 * @param {object} input
 * @param {string} input.text         the resignation letter text
 * @param {object} [opts]  test-only seams — defaults to the real llm module/no
 *   audit so production callers are unaffected; injectable so hermetic tests
 *   never touch the network and never wait on real backoff delays.
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit]  every retry attempt
 *   is recorded as an audit trace step (§4 invariant 7)
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<ExtractedLetter>}
 */
export async function extractFromLetter(
  { text },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return ruleBasedExtraction({ text });
  }
  try {
    const userPrompt = `Resignation letter text:\n"""${text || ""}"""`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!isValidExtraction(r)) {
          throw new Error(`LLM returned an invalid extraction shape: ${JSON.stringify(r)}`);
        }
        // Defensive: never trust an ISO-shaped string that isn't actually
        // shaped like a date — a hallucinated "2026-99-99" would otherwise
        // slip through the regex check. We don't try to be a date library;
        // we just refuse to return an invalid one.
        if (r.proposedEndDate !== null && !ISO_DATE.test(r.proposedEndDate)) {
          throw new Error(`LLM returned a non-ISO proposedEndDate: ${r.proposedEndDate}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "letterExtractor.extractFromLetter",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-05" } : null,
          }),
      }
    );
    return { ...result, source: "llm" };
  } catch (err) {
    console.error(`[letterExtractor] LLM extraction failed after retries, falling back to rules: ${err.message}`);
    return ruleBasedExtraction({ text });
  }
}
