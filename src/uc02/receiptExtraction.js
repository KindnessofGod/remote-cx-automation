// ---------------------------------------------------------------------------
// receiptExtraction.js — read what the receipt actually says
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// UC-02 is called "Expense & Receipt Validation" and until now it never opened
// the receipt. Gate 8 checks that a receipt artifact EXISTS; nothing checked
// whether the document behind the number says anything like the number. So a
// claim for $480 with a $12 coffee receipt attached passed every gate that
// could see it, and `qa/contracts/UC-02-acceptance.md` §17 records this as
// [E-1] — a decided change that §18 says was never built.
//
// This file is the reading half. It decides NOTHING.
//
// ---------------------------------------------------------------------------
// THE SPLIT, WHICH IS THE WHOLE POINT (CLAUDE.md §3 directive 1)
//
// An LLM is excellent at reading a crumpled photo of a restaurant bill and
// unfit to be trusted with whether money moves. So:
//
//   - the model INTERPRETS the document and returns claimed facts;
//   - this file VALIDATES that answer against a strict shape and throws it
//     away whole on any deviation;
//   - `policyEngine.js` COMPARES those facts against the expense record and
//     decides. The comparison is integer arithmetic on ×100 money, not a
//     judgement, and it lives with the other gates where it can be tested.
//
// Nothing here may short-circuit a gate, and there is no return value meaning
// "approved". The only outcomes are a validated observation or `null`.
//
// ---------------------------------------------------------------------------
// WHY `null` IS A FIRST-CLASS ANSWER, AND WHY IT IS NOT A REFUSAL
//
// A receipt can be unreadable for reasons that are nobody's fault: a dark
// photo, a foreign-language till roll, a PDF that is one flat scanned image.
// "I could not read this" and "this receipt contradicts the claim" are
// completely different findings with different remedies — the first wants a
// human to look, the second wants the claim corrected — so this file never
// collapses them. It returns `null` with a `reason`, and the gate turns that
// into its own distinct outcome.
//
// The failure that would be unforgivable is the opposite one: returning a
// confident total that the model guessed. Every field is validated, and a
// partial answer is discarded rather than half-used.
// ---------------------------------------------------------------------------

/** Money is ×100 everywhere in this system; a receipt total is no exception. */
const MAX_REASONABLE_MINOR_UNITS = 100_000_000; // $1,000,000.00

/**
 * The shapes we will read. A receipt is a photo or a PDF; anything else is a
 * caller mistake rather than an unreadable receipt, and is reported as such.
 */
export const READABLE_MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
]);

export const EXTRACTION_SOURCES = Object.freeze({
  LLM: "llm",
  UNREAD: "not_attempted",
});

/**
 * Is this something we can even try to read?
 *
 * Separated from the extraction itself so an unsupported file type is answered
 * without spending a paid API call on it.
 */
export function isReadableReceipt(mimeType) {
  return READABLE_MIME_TYPES.includes(String(mimeType ?? "").toLowerCase().trim());
}

const SYSTEM_PROMPT = `You transcribe a receipt for an expense-reimbursement system.
Return ONLY a JSON object with these keys:
{"merchant": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "currency": "ISO-4217 3-letter code"|null, "confidence": number between 0 and 1, "notes": string}
Rules:
- "total" is the FINAL amount payable shown on the receipt, in MINOR UNITS as an integer (e.g. $12.34 -> 1234). Never a subtotal, never a per-item price.
- If the receipt shows no unambiguous final total, return null for "total" rather than guessing or adding numbers up yourself.
- "currency" must be the currency printed on the receipt. If no currency is shown or implied, return null. Never infer it from the merchant's country.
- Return null for any field you cannot read. A null is always better than a guess.
- "confidence" is your certainty that you transcribed the total and currency correctly.
- You are TRANSCRIBING only. Never state whether the expense should be approved, whether it is within policy, or whether it matches any claim. You are not shown the claim.`;

/**
 * Validate a model's answer before anybody is allowed to act on it.
 *
 * Deliberately strict and whole-object: a response with a good total and a
 * nonsense date is discarded entirely rather than partially used, because
 * "the model got some of it right" is not a property we can test for at the
 * point of use.
 */
export function isValidExtraction(obj) {
  if (!obj || typeof obj !== "object") return false;

  const nullableString = (v) => v === null || (typeof v === "string" && v.length <= 200);
  if (!nullableString(obj.merchant)) return false;
  if (!nullableString(obj.notes) && typeof obj.notes !== "string") return false;

  // Money: a non-negative integer in minor units, bounded. A float here means
  // the model returned major units and would understate the total by 100x.
  if (obj.total !== null) {
    if (!Number.isInteger(obj.total)) return false;
    if (obj.total < 0 || obj.total > MAX_REASONABLE_MINOR_UNITS) return false;
  }

  if (obj.currency !== null && !/^[A-Z]{3}$/.test(String(obj.currency))) return false;
  if (obj.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(obj.date))) return false;
  if (obj.date !== null && Number.isNaN(Date.parse(obj.date))) return false;

  return typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1;
}

/**
 * Read a receipt.
 *
 * @param {object} args
 * @param {string} args.mimeType
 * @param {string} [args.fileName]
 * @param {string} args.dataBase64  the receipt's bytes, base64
 * @param {object} deps
 * @param {Function} [deps.readReceipt]  injected transport (see below)
 * @returns {Promise<{extracted: object|null, source: string, reason: string}>}
 *
 * THE TRANSPORT IS INJECTED, FROM DAY ONE. CLAUDE.md §6: "Every new LLM call
 * site needs its own injectable seam from day one, not added after a slow test
 * surfaces the gap." A test that forgets to inject here must fail loudly rather
 * than quietly making a real, billed call, so an absent transport returns
 * `not_attempted` instead of reaching for a default client.
 */
export async function extractReceipt({ mimeType, fileName = null, dataBase64 }, deps = {}) {
  const readReceipt = deps.readReceipt;

  if (!dataBase64) {
    return { extracted: null, source: EXTRACTION_SOURCES.UNREAD, reason: "no_receipt_supplied" };
  }
  if (!isReadableReceipt(mimeType)) {
    return {
      extracted: null,
      source: EXTRACTION_SOURCES.UNREAD,
      reason: "unsupported_receipt_format",
    };
  }
  if (typeof readReceipt !== "function") {
    // Not configured is not the same as unreadable, and the reason says so.
    return { extracted: null, source: EXTRACTION_SOURCES.UNREAD, reason: "extraction_not_configured" };
  }

  let raw;
  try {
    raw = await readReceipt({ systemPrompt: SYSTEM_PROMPT, mimeType, fileName, dataBase64 });
  } catch {
    // The error itself is deliberately not surfaced: this runs on a path that
    // reaches an unauthenticated submitter, and a transport error message can
    // carry internals.
    return { extracted: null, source: EXTRACTION_SOURCES.UNREAD, reason: "receipt_unreadable" };
  }

  const parsed = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isValidExtraction(parsed)) {
    return { extracted: null, source: EXTRACTION_SOURCES.UNREAD, reason: "receipt_unreadable" };
  }

  return {
    extracted: {
      merchant: parsed.merchant,
      date: parsed.date,
      total: parsed.total,
      currency: parsed.currency,
      confidence: parsed.confidence,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : "",
    },
    source: EXTRACTION_SOURCES.LLM,
    reason: "receipt_read",
  };
}

function safeParse(text) {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}
