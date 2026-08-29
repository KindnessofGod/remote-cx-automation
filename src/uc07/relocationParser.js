// ---------------------------------------------------------------------------
// relocationParser.js  —  UC-07 request understanding (THE LLM SEAM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A relocation request arrives as free text ("we're permanently relocating
// Ana from our Madrid team to the Netherlands, she'll need visa support"). The
// dossier needs to know, as descriptive facts about the REQUEST:
//   - relocationType: is this actually UC-07's territory? (Build Pack Part 4:
//     permanent relocation ≠ workation ≠ business travel ≠ address change)
//   - sourceCountry / destinationCountry (ISO alpha-2)
//   - immigrationSupportRequired / requiresVisa
// Like every classifier in this repo, parseRelocation() tries a real OpenAI
// call when configured, validates the JSON it gets back, and falls back to a
// deterministic rule-based parser on ANY failure — missing key, network error,
// malformed JSON, or a shape that doesn't validate. Every result is tagged
// `source: "llm"` or `source: "rule_based_fallback"` (00-FOUNDATION.md §4
// invariant 8), and the LLM call itself is retried up to 3x with backoff
// (invariant 10) before the fallback runs, with each attempt recorded as an
// audit trace step (invariant 7). Same seams as uc01/classifier.js.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { asLowerText } from "../shared/text.js";
import { compileCountryDictionary, resolveSourceAndDestination } from "../shared/countryMentions.js";
import { isWellFormedCountryCode, normalizeCountryCode } from "../shared/countryCodes.js";

export const RELOCATION_TYPES = [
  "permanent_relocation",
  "temporary_workation",
  "business_travel",
  "address_change",
  "other",
];
const VALID_TYPES = new Set(RELOCATION_TYPES);

// Small, deliberately non-exhaustive country lookup — enough to demonstrate
// source/destination extraction without pretending to a full entity-recognition
// pipeline this repo doesn't have (same honest scope as uc08/inquiryParser.js).
//
// ⚠ THE BARE ALPHA-2 KEYS ARE GONE, ON PURPOSE. This map used to carry `de`,
// `fr`, `pt`, `ca`, `es`, `nl`, `br` alongside the full names, matched with
// `String.includes`. In production (Zendesk ticket 18 / n8n execution 4500)
// "permanently relocating from Portugal to Germany" therefore matched FR inside
// "from" and CA inside "relocating", and the dossier told a mobility specialist
// the route was DE → FR. What dropping them costs: a ticket whose only mention
// of a country is the bare code ("PT → DE") no longer resolves, and now reports
// `null` + UC07_COUNTRIES_NOT_DETERMINED instead. That is the right trade for a
// 🔴 dossier — a human writing a relocation request says "Portugal", and every
// two-letter code that hides inside an English word is a false positive waiting
// for the next ticket. compileCountryDictionary() enforces it: adding one back
// throws at module load. "uk" survives as an explicitly-allowed short form (see
// countryMentions.js) because it is not an English word and is how people write.
const KNOWN_COUNTRIES = {
  spain: "ES",
  netherlands: "NL",
  "the netherlands": "NL",
  germany: "DE",
  france: "FR",
  portugal: "PT",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
  brazil: "BR",
  canada: "CA",
  india: "IN",
  australia: "AU",
  "new zealand": "NZ",
  nigeria: "NG",
  japan: "JP",
  singapore: "SG",
};

const COUNTRY_MATCHER = compileCountryDictionary(KNOWN_COUNTRIES);

// The prompt below asks for `string | null` on both country fields, so `null`
// is a VALID answer — it is the model saying "the text does not name one",
// which is exactly the answer this use case must be able to accept. Requiring a
// string here (as this did) threw that honest answer away and fell through to
// the rules, which then had to produce something.
function isCountryField(value) {
  return value === null || typeof value === "string";
}

function isValidParse(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    VALID_TYPES.has(obj.relocationType) &&
    isCountryField(obj.sourceCountry) &&
    isCountryField(obj.destinationCountry) &&
    typeof obj.requiresVisa === "boolean"
  );
}

/**
 * An LLM-supplied country is only usable if it is actually an alpha-2 code.
 * "Germany", "DEU" and "" are all things a model returns under pressure; any of
 * them landing in the dossier's country slot would be a fact nobody can act on
 * (every downstream comparison in this repo is a two-letter `Set.has`). Anything
 * that is not well-formed becomes `null` — unknown, and visibly so.
 */
function usableCountryCode(value) {
  return isWellFormedCountryCode(value) ? normalizeCountryCode(value) : null;
}

/**
 * Rule-based parser — the default, and the fallback on any LLM failure.
 * Precedence matters: per Build Pack Part 4, workation/travel/address-change
 * phrasings must be recognised BEFORE "relocat"-ish language, or a "travel"
 * request that merely mentions a country would be misread as UC-07's territory.
 *
 * SOURCE AND DESTINATION COME FROM DIRECTION WORDS, NOT FROM ORDER. They used
 * to be `const [sourceCountry, destinationCountry] = found`, where `found` was
 * ordered by the dictionary literal — so the slots were filled by how this file
 * happened to be typed. `resolveSourceAndDestination()` reads "from X"/"to Y"
 * instead, in either word order, and returns `null` for both when the text
 * gives no direction. `countryExtractionReason` records which rule answered, so
 * the audit row says how the route was reached, not just what it was.
 *
 * @param {object} input
 * @param {string} input.text
 * @returns {{relocationType:string, sourceCountry:string|null, destinationCountry:string|null,
 *            mentionedCountries:string[], countryExtractionReason:string, requiresVisa:boolean}}
 */
export function parseRelocationRuleBased({ text }) {
  const lower = asLowerText(text);

  const {
    sourceCountry,
    destinationCountry,
    mentionedCountries,
    reason: countryExtractionReason,
  } = resolveSourceAndDestination(text, COUNTRY_MATCHER);
  const requiresVisa = /\bvisa\b|work permit|right to work|work authorization|immigrat/.test(lower);

  let relocationType = "other";
  if (/\baddress change\b|change of address|moving (to a new )?address/.test(lower)) {
    relocationType = "address_change";
  } else if (/\bconference\b|business trip|business travel|\bonsite visit\b/.test(lower)) {
    relocationType = "business_travel";
  } else if (/\bwork(?:ing)? from [a-z ]{2,40}? (?:for|over) (?:two|three|four|five|\d+|a few) (?:day|week)s?\b|worka?tion|work from [a-z ]{2,20} for \d+ (day|week)/.test(lower)) {
    relocationType = "temporary_workation";
  } else if (/relocat|permanent(ly)? (mov|relocat)|transfer(ring)? (him|her|to|between)|moving (permanently|to)|will (now )?(be|work|live) (in|from)/.test(lower)) {
    relocationType = "permanent_relocation";
  }

  return {
    relocationType,
    sourceCountry: sourceCountry ?? null,
    destinationCountry: destinationCountry ?? null,
    mentionedCountries,
    countryExtractionReason,
    requiresVisa,
  };
}

const SYSTEM_PROMPT = `You read inbound permanent-relocation requests for an Employer-of-Record platform.
Read the ticket text and return ONLY a JSON object with exactly these fields:
{
  "relocationType": "permanent_relocation" | "temporary_workation" | "business_travel" | "address_change" | "other",
  "sourceCountry": string | null,        // ISO 3166-1 alpha-2 of the employee's current work country, if named
  "destinationCountry": string | null,   // ISO 3166-1 alpha-2 of the country they will work from, if named
  "requiresVisa": boolean
}
Rules:
- "relocationType" describes the REQUEST, not the employee's intent to stay. A permanent move of the habitual work country is "permanent_relocation". A short stay ("work from X for two weeks") is "temporary_workation". A short business trip or conference is "business_travel". A change of home address within the same country is "address_change".
- Use only the country names the text actually mentions; never guess.
Return strict JSON, no prose, no markdown fences.`;

/**
 * Understand a relocation request. Uses a real OpenAI call when configured,
 * otherwise (and on any LLM failure) falls back to parseRelocationRuleBased().
 * @param {object} input
 * @param {string} input.text
 * @param {object} [opts]  test-only seams — same shape as classifier.js's
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] records every retry
 *   attempt as an audit trace step (success or failure); no LLM call, no trace
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{relocationType:string, sourceCountry:string|null, destinationCountry:string|null, requiresVisa:boolean, immigrationSupportRequired:boolean, source:"llm"|"rule_based_fallback"}>}
 */
export async function parseRelocation(
  { text },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  const fallback = parseRelocationRuleBased({ text });
  if (!isConfigured()) {
    return { ...fallback, immigrationSupportRequired: fallback.requiresVisa, source: "rule_based_fallback" };
  }

  try {
    const userPrompt = `Ticket text:\n"""${text || ""}"""`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!isValidParse(r)) {
          throw new Error(`LLM returned an invalid relocation parse: ${JSON.stringify(r)}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "relocationParser.askJson",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-07" } : null,
          }),
      }
    );
    const sourceCountry = usableCountryCode(result.sourceCountry);
    const destinationCountry = usableCountryCode(result.destinationCountry);
    return {
      relocationType: result.relocationType,
      sourceCountry,
      destinationCountry,
      mentionedCountries: [...new Set([sourceCountry, destinationCountry].filter(Boolean))],
      countryExtractionReason: "llm_extraction",
      requiresVisa: result.requiresVisa,
      // Immigration support is a service decision downstream of "needs a visa",
      // so the LLM's boolean is promoted to the request-level signal unchanged
      // (it is a description of the request, never a decision).
      immigrationSupportRequired: result.requiresVisa,
      source: "llm",
    };
  } catch (err) {
    console.error(`[relocationParser] LLM parse failed after retries, falling back to rules: ${err.message}`);
    return { ...fallback, immigrationSupportRequired: fallback.requiresVisa, source: "rule_based_fallback" };
  }
}
