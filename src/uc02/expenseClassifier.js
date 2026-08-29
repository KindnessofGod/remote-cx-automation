// ---------------------------------------------------------------------------
// expenseClassifier.js  —  UC-02 request understanding (THE LLM SEAM, narrow)
// ---------------------------------------------------------------------------
// WHY THIS IS SHAPED THE WAY IT IS
// UC-02.md §5's n8n diagram shows a Vision LLM extracting "vendor, date,
// currency, line items, total, tax header" from a receipt image. Building it
// that way would make an LLM the SOURCE of monetary figures (the total, line
// item amounts) that could reach a real reimbursement write — exactly what
// prime directive #1 exists to prevent, the same reason UC-06's changeParser
// forbids an LLM from producing salary figures. So the extraction side is
// structured input: Remote's expense record already carries the amounts (in
// integer ×100), and this module never invents or edits them.
//
// What the LLM MAY do here is the QUALITATIVE half of §6: classify the expense
// against the employee's real, fetched category list (including the
// client-entertainment vs. personal-meal judgement). It returns a category id
// — never money — and the deterministic gates in policyEngine.js decide what
// that classification is allowed to mean.
//
// Same DI/fallback shape as classifier.js/changeParser.js: real OpenAI when
// configured, deterministic rule-based fallback on any failure, every result
// tagged `source: "llm"` or `source: "rule_based_fallback"`, and the LLM call
// itself retried up to 3x with backoff (§4 invariant 10) with each attempt
// recorded as an audit trace step (invariant 7). Tests always get the
// rule-based path, same hermetic guarantee as every other seam.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { selectableCategories, isCategoryFileable } from "./expenseCategories.js";

// Confidence floor from UC-02.md §8 — below this an expense goes to a human.
export const CONFIDENCE_THRESHOLD = 0.85;

// Receipt-quality signals the rule-based fallback can *honestly* detect from
// the expense's own text. A real vision pipeline would produce its own
// confidence; without one, these are the crude-but-honest tells (same spirit
// as classifier.js's rule-based confidence). "Below threshold -> review" is
// the load-bearing behaviour, not the exact number.
const LOW_CONF_SIGNALS = [
  /\b(blurr(?:y|ied)?|illegible|unreadable|faded|damaged|out[- ]of[- ]focus)\b/,
  /\bpoor (scan|image) quality\b/,
];

const NON_ENGLISH_SIGNALS = [
  /\bnon[- ]english\b/,
  /\bforeign language\b/,
  /\b(in german|in french|in spanish|in japanese|in chinese|in mandarin)\b/,
  /\b(german|french|spanish|japanese|chinese|mandarin) (receipt|invoice)\b/,
];

/**
 * Stopwords, and a 4-character floor, for the token-overlap match below.
 *
 * WHY THESE EXIST NOW AND DID NOT BEFORE. The match used to run against the
 * mock's invented two-word category names ("Meals", "Client Entertainment").
 * Real Remote categories carry a prose `description` ("Meals or gatherings with
 * colleagues for team-building or other work-related purposes."), and matching
 * an expense's tokens as SUBSTRINGS of prose makes "the" match "other" and "for"
 * match "information" — pure grammar scoring as if it were meaning. Measured on
 * this repo's own fixtures, that gave "General item — no clear category" a
 * confident 0.9 match to Internal Meals, which is not a harmless imprecision:
 * a false category resolves a false cap, and 0.9 clears the confidence gate.
 *
 * Substring matching is kept (it is what lets "client" match "clients"); only
 * the tokens that carry no meaning are removed.
 */
const MATCH_MIN_TOKEN_LENGTH = 4;
const MATCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "was", "were", "are", "during", "after",
  "other", "any", "all", "its", "our", "your", "when", "have", "has", "had", "not", "but", "per",
  "via", "into", "onto", "over", "out", "off", "one", "two", "add", "list", "also", "such", "than",
  "then", "them", "they", "their", "some", "more", "most", "each", "just", "only", "very", "been",
  "being", "will", "would", "can", "could", "should", "about", "under", "above", "between",
  "because", "while", "where", "which", "what", "who", "whom", "whose",
]);

/** The meaning-bearing tokens of a piece of text, deduplicated. */
function matchTokens(text) {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= MATCH_MIN_TOKEN_LENGTH && !MATCH_STOPWORDS.has(token))
    ),
  ];
}

/**
 * The text a category is matched against: its `code`, `title` and
 * `description` — all three REAL fields of a Remote category row. There is no
 * `name` field; reading one (as this did) yields `undefined` for every row, so
 * every score is zero and the matcher silently never matches.
 */
function categoryHaystack(category) {
  return `${category?.code ?? ""} ${category?.title ?? ""} ${category?.description ?? ""}`.toLowerCase();
}

/**
 * Deterministic fallback — the default, and what runs on any LLM failure.
 *
 * THE SIGNAL IS TOKEN OVERLAP, AND ONLY THAT. A token-overlap match of the
 * expense's own text against the code/title/description of the categories Remote
 * returned — crude string similarity, stated as such, never a fabricated score.
 *
 * ⚠ WHY THE RECORD'S OWN CATEGORY IS NOT USED AS A CODE. This function used to
 * look `expense.category_id` up in the selectable list and trust it as the
 * platform's own assignment. Two things were wrong. `category_id` is not a
 * field on a real expense — it is `expense_category: {code,title,slug}`. And
 * more importantly, THE TWO CATEGORY NAMESPACES ARE DISJOINT: an expense record
 * carries the DEPRECATED flat enum (`meals`, `tech_equipment`, …) while
 * `GET /v1/expenses/categories` returns 32 hierarchical codes
 * (`work_meals_and_entertainment.internal_meals_and_entertainment`, …).
 * Confirmed live 2026-08-17 — zero overlap between the sets. So the lookup
 * could never succeed, and "fixing" it by mapping one namespace onto the other
 * would mean INVENTING a 26-to-32 correspondence Remote does not publish, on
 * the path to a real reimbursement write.
 *
 * The record's category is therefore used as what it honestly is: a TEXT HINT.
 * `expense_category.title` ("Meals") joins the haystack the tokens are matched
 * against, so it can raise the right category's score, and the answer is still
 * validated against the real selectable list before it can mean anything.
 * Confidence starts at 0.9 when a category resolved, 0.6 when it did not, and
 * drops on the receipt-quality signals above (0.5 non-English, 0.4 blurry).
 *
 * Only SELECTABLE, ACTIVE categories are ever candidates (see
 * expenseCategories.js). A parent node is a heading an employee cannot file
 * against, so proposing one would produce a classification the gate must then
 * refuse — better never to propose it.
 *
 * @param {object} args
 * @param {object|null} args.expense       expense record (amounts are Remote's
 *   integer ×100 — never read into any category decision)
 * @param {object[]} [args.categoryList]   categories from Remote, raw
 * @returns {{categoryId: string|null, reason: string, confidence: number, source: "rule_based_fallback"}}
 */
export function classifyExpenseRuleBased({ expense, categoryList = [] }) {
  const list = selectableCategories(categoryList);
  // The real record's text fields: `title` (schema-required, always present)
  // and `notes` (nullable — null on all 220 live rows, but real). There is no
  // `description` field; reading one silently contributed nothing. The recorded
  // category's TITLE joins them as a hint — see the note above on why its
  // `code` cannot be used as a code.
  const text = [expense?.title, expense?.notes, expense?.expense_category?.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tokens = matchTokens(text);

  let best = null;
  let bestScore = 0;
  for (const category of list) {
    const haystack = categoryHaystack(category);
    const score = tokens.filter((token) => haystack.includes(token)).length;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  const categoryId = (bestScore > 0 ? best : null)?.code ?? null;

  let confidence = categoryId ? 0.9 : 0.6;
  if (NON_ENGLISH_SIGNALS.some((re) => re.test(text))) confidence = 0.5;
  if (LOW_CONF_SIGNALS.some((re) => re.test(text))) confidence = 0.4;

  const reason = categoryId
    ? "Rule-based token overlap between the expense's title (plus its recorded category name) and this category's own text."
    : "No category could be resolved from the expense's title or its recorded category name.";

  return { categoryId, reason, confidence, source: "rule_based_fallback" };
}

/**
 * Guard against a malformed/hallucinated LLM classification before trusting
 * it: the proposed category must be null (no fit) or a real, SELECTABLE code
 * from the fetched list, and the confidence must be a number in 0..1. A code
 * invented by the model — or a real one naming a non-selectable parent node —
 * fails this and falls back to rules.
 */
function isValidClassification(obj, categoryList) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.categoryId !== null && !isCategoryFileable(categoryList, obj.categoryId)) return false;
  return (
    typeof obj.reason === "string" &&
    typeof obj.confidence === "number" &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

const SYSTEM_PROMPT = `You classify an employee expense for an Employer-of-Record platform.
You are given the expense's title, its notes, the category name recorded on the record, and the employee's selectable expense category list (code + title + description).
Return ONLY a JSON object: {"categoryId": <a category CODE from the list, or null>, "reason": string, "confidence": number between 0 and 1}.
Rules:
- Pick the category that best fits the expense. For example, a meal whose purpose is entertaining a client or prospect is external meals and entertainment, not an internal team meal.
- Use the exact "code" string from the list. Never invent a code, and never return a category that is not in the list.
- Return null for categoryId when no listed category fits.
- "confidence" is your certainty in the classification; below 0.85 the expense goes to a human reviewer.
- You are CLASSIFYING only. Never produce, repeat or decide any money amount, total, or reimbursement eligibility.`;

/**
 * Classify an expense against the employee's active category list. Uses a real
 * OpenAI call when configured; otherwise (and on any failure) falls back to
 * classifyExpenseRuleBased(). The result is display/audit classification only —
 * never a figure, and never a decision (policyEngine.js decides).
 * @param {object} input
 * @param {object|null} input.expense      expense record
 * @param {object[]} [input.categoryList]  active categories from Remote
 * @param {object} [opts]  test-only seams — default to the real llm module so
 *   callers are unaffected; injectable so hermetic tests never touch the
 *   network and never wait on real backoff delays.
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] when set,
 *   every retry attempt is recorded as an audit trace step (§4 invariant 7).
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{categoryId: string|null, reason: string, confidence: number, source: "llm"|"rule_based_fallback"}>}
 */
export async function classifyExpense(
  { expense, categoryList = [] },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return classifyExpenseRuleBased({ expense, categoryList });
  }

  try {
    // Only categories the employee could actually file against are shown to the
    // model — see selectableCategories()'s note. A model never offered a parent
    // node cannot propose one.
    const offered = selectableCategories(categoryList);
    // The REAL text fields of a Remote expense. `description` is not one of
    // them — sending it meant the model received `"description": null` on every
    // single expense and classified from the title alone while appearing to have
    // more. `recordedCategory` is the record's own (deprecated, disjoint-
    // namespace) category name, passed as a labelled hint the model may weigh,
    // never as a code it may return.
    const userPrompt = `Expense: ${JSON.stringify({
      title: expense?.title ?? null,
      notes: expense?.notes ?? null,
      recordedCategory: expense?.expense_category?.title ?? null,
    })}\nCategory list: ${JSON.stringify(offered.map((c) => ({ code: c.code, title: c.title, description: c.description })))}`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
    // Retry the LLM call itself (up to 3 attempts, §4 invariant 10) BEFORE
    // this try/catch's fallback runs — same discipline as classifier.js.
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!isValidClassification(r, categoryList)) {
          throw new Error(`LLM returned an invalid classification shape: ${JSON.stringify(r)}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "expenseClassifier.classify",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-02" } : null,
          }),
      }
    );
    return { categoryId: result.categoryId, reason: result.reason, confidence: result.confidence, source: "llm" };
  } catch (err) {
    console.error(`[expenseClassifier] LLM classification failed after retries, falling back to rules: ${err.message}`);
    return classifyExpenseRuleBased({ expense, categoryList });
  }
}
