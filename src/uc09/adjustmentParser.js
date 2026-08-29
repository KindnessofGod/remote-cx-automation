// ---------------------------------------------------------------------------
// adjustmentParser.js  —  UC-09's ONE LLM seam: free text -> a proposed amount
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Maps an unstructured adjustment request ("relocation top-up post-tax, twelve
// and a half thousand") to the structured shape policyEngine.js can gate. It
// is the only LLM touchpoint in UC-09, and it never executes anything: prime
// directive #1 — the LLM interprets, deterministic code decides.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE REFUSES INSTEAD OF FALLING BACK (QA finding F-10, HIGH — money)
// ---------------------------------------------------------------------------
// Every other classifier in this repo falls back to a rule-based path when the
// LLM is unavailable, and that is right for them: the worst a wrong
// classification does is route a ticket to the wrong queue, where a human sees
// it. This one is different in kind. Its output is a NUMBER THAT GETS PAID.
//
// The fallback here used to be a regex — `/\$?([\d,]+\.?\d*)/`, the FIRST
// number anywhere in the text. On "Q3 2024 relocation top-up of $12,500.00"
// it matched the `3` in "Q3" and the pipeline posted $3.00 for a $12,500.00
// adjustment: a 4,000x error, with every downstream gate passing happily
// because $3.00 is a small, low-risk, entirely plausible amount. Two people
// approved it. Nothing in the audit trail said "this figure was guessed."
//
// The seam was ALSO mis-wired — workflow.js passed `remote.askJson` and
// `remote.isLlmConfigured`, neither of which exists on RemoteClient — so
// `isConfigured` was `undefined` on EVERY request and the regex ran EVERY
// time. The real LLM path had never once executed in production.
//
// So: no rule-based amount extraction exists in this file any more. When the
// LLM is unconfigured, errors out, or returns something that does not
// validate, this returns an explicit REFUSAL that workflow.js turns into an
// escalation with a durable audit row. A human then reads the request and
// supplies the figure as structured input — the path that has always been the
// trusted one (see workflow.js's structured branch). Refusing is a worse
// demo and a better payroll system.
//
// Every result is still tagged with its source (invariant 8): "llm" or
// "refused_no_llm_parse". The LLM call is retried up to 3x with backoff
// (invariant 10) and each attempt is an audit trace step (invariant 7).
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { AMOUNT_TAX_TYPES, INCENTIVE_TYPES } from "./policyEngine.js";

/** The one value `source` takes when no figure could be trusted. */
export const REFUSED_SOURCE = "refused_no_llm_parse";

// The `type` list is Remote's own `CreateOneTimeIncentiveParams.type` enum,
// imported rather than restated so the prompt cannot drift from the gate that
// checks its answers. It used to offer `relocation_topup` and
// `retroactive_pay`, neither of which Remote has ever accepted — an LLM
// obediently returning the name we asked for would have produced a payload
// that 422s AFTER two or three people had signed it.
const SYSTEM_PROMPT = `You are a payroll adjustment parser. Extract structured information from the user's request.

Respond with a JSON object containing:
- type: string (one of ${INCENTIVE_TYPES.map((t) => `"${t}"`).join(", ")})
- amount: number (the adjustment amount in HUMAN-READABLE major units, e.g. 12500.00 for twelve thousand five hundred — never in cents)
- currency: string, ISO 4217 (e.g. "USD", "EUR")
- description: string (brief description of the adjustment)
- effectiveDate: string (optional, YYYY-MM-DD)
- processingDate: string (optional, YYYY-MM-DD)
- amountTaxType: "gross" if the amount stated is BEFORE tax, "net" if it is the
  amount the employee should actually receive AFTER tax. Respond with null if
  the request does not say which. Do NOT infer it from the type of payment or
  from convention — the two readings pay out different sums of money.
- taxAdjustment: boolean (true if a manual tax override is requested)

If the request does not state an unambiguous amount and currency, respond with
{"amount": null} rather than guessing. A wrong number here is paid out.`;

/**
 * Parse an unstructured adjustment request into the structured shape
 * policyEngine.js gates.
 *
 * @param {object} input
 * @param {string} input.requestText   free-text request
 * @param {object} [input.context]     extra context (e.g. the employment record)
 * @param {object} [deps]
 * @param {typeof askJson} [deps.askJson]           injectable LLM call; defaults to the real one
 * @param {typeof isLlmConfigured} [deps.isConfigured]  injectable; defaults to the real check
 * @param {object} [deps.audit]        optional AuditLogger for trace steps
 * @param {Function} [deps.backoff]    test seam — inject a no-op to keep tests instant
 * @returns {Promise<object>} either a parsed adjustment tagged `source: "llm"`,
 *   or a refusal: `{amount: null, source: REFUSED_SOURCE, refusal: <code>}`.
 */
export async function parseAdjustmentRequest(
  input,
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit, backoff } = {}
) {
  const requestText = typeof input?.requestText === "string" ? input.requestText : "";
  const excerpt = requestText.slice(0, 100);

  if (!isConfigured()) {
    return refuseToGuess({ audit, excerpt, refusal: "llm_not_configured", attempt: 1 });
  }

  let attemptCount = 0;
  const onAttempt = ({ attempt, ok, error }) => {
    attemptCount = attempt;
    audit?.logTraceStep({
      step: "parse_adjustment_request",
      call: "parseAdjustmentRequest.askJson",
      attempt,
      success: ok,
      error,
      details: { requestText: excerpt },
    });
  };

  try {
    return await withRetry(
      async () => {
        // Positional (systemPrompt, userPrompt) — the signature shared/llm.js
        // actually exports. The previous code called `askJson({system, user})`,
        // which even with a correctly wired seam would have sent `undefined`
        // as the system prompt and an object as the user prompt.
        const response = await ask(
          SYSTEM_PROMPT,
          `Parse this adjustment request: "${requestText}"\n\nContext: ${JSON.stringify(input?.context ?? {}, null, 2)}`
        );
        const invalid = whyInvalid(response);
        // Thrown, not returned, so withRetry gets its remaining attempts at a
        // model that answered badly once — and so a persistently bad answer
        // lands in the catch below as a refusal, never as a usable number.
        if (invalid) throw new Error(`LLM adjustment parse rejected: ${invalid}`);

        return {
          type: response.type,
          amount: response.amount,
          currency: String(response.currency).toUpperCase(),
          description: typeof response.description === "string" ? response.description : requestText.slice(0, 200),
          effectiveDate: response.effectiveDate ?? null,
          processingDate: response.processingDate ?? null,
          // Never coerced to a member. `AMOUNT_TAX_TYPES.includes(...)` or
          // null — a model that answers "automatic", "n/a" or nothing at all
          // leaves this unset, and validateAdjustment() then refuses the
          // request rather than the pipeline picking gross or net on the
          // requester's behalf. The old line did the opposite of this: any
          // value other than the literal "manual" silently became
          // "automatic", so the field could not fail.
          amountTaxType: AMOUNT_TAX_TYPES.includes(response.amountTaxType) ? response.amountTaxType : null,
          taxAdjustment: response.taxAdjustment === true,
          source: "llm",
        };
      },
      { onAttempt, backoff }
    );
  } catch (error) {
    return refuseToGuess({
      audit,
      excerpt,
      refusal: "llm_parse_failed",
      attempt: attemptCount + 1,
      error: error.message,
    });
  }
}

/**
 * Why this LLM response cannot be trusted to carry a payment amount, or null
 * if it can. Pure, so the exact acceptance rule is unit-testable without any
 * LLM at all. Deliberately strict:
 *   - `amount` must be a finite number > 0. `null` is the model's own
 *     documented "I could not tell" answer; a numeric STRING is rejected
 *     rather than coerced — silently accepting "500000" is how a 100x error
 *     gets in, the same rule workflow.js applies to structured input.
 *   - `currency` must be a 3-letter code. A missing currency next to a
 *     number is exactly the ambiguity that must not be resolved by a default.
 * @param {unknown} response
 * @returns {string|null}
 */
export function whyInvalid(response) {
  if (typeof response !== "object" || response === null) return "not_an_object";
  if (typeof response.amount !== "number" || !Number.isFinite(response.amount)) return "amount_not_a_number";
  if (response.amount <= 0) return "amount_not_positive";
  if (typeof response.currency !== "string" || !/^[A-Za-z]{3}$/.test(response.currency.trim())) {
    return "currency_missing_or_malformed";
  }
  if (typeof response.type !== "string" || !response.type.trim()) return "type_missing";
  return null;
}

/**
 * The refusal. `amount: null` is deliberate and load-bearing: workflow.js's
 * `Number.isInteger(amount)` money guard already refuses to proceed on it, so
 * even a caller that ignores `refusal` cannot end up paying a guessed figure.
 * @param {object} args
 * @returns {object}
 */
function refuseToGuess({ audit, excerpt, refusal, attempt, error = null }) {
  audit?.logTraceStep({
    step: "parse_adjustment_request",
    call: "parseAdjustmentRequest.refuse",
    attempt,
    success: false,
    error: error ?? refusal,
    details: { method: REFUSED_SOURCE, refusal, requestText: excerpt },
  });

  return {
    type: null,
    amount: null,
    currency: null,
    description: excerpt,
    amountTaxType: null,
    taxAdjustment: false,
    source: REFUSED_SOURCE,
    refusal,
  };
}
