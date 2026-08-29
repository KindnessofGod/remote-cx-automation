// ---------------------------------------------------------------------------
// inquiryParser.js  —  UC-08 request understanding
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Same shape as uc01/classifier.js and uc06/changeParser.js: a real OpenAI
// call when configured, JSON-validated, falling back to a deterministic
// rule-based classifier on any failure or when unconfigured — so `npm test`
// never depends on OPENAI_API_KEY, exactly like every other classifier seam
// in this repo.
//
// WHAT IT MUST NOT DO (docs/use-cases/UC-08.md §6): assert a residency or
// withholding CONCLUSION. It only labels the inquiry TYPE and lists the
// jurisdictions mentioned — both purely descriptive facts about the request,
// never an answer to it.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured } from "../shared/llm.js";
import { asLowerText } from "../shared/text.js";
import { compileCountryDictionary, findCountryMentions, distinctCountryCodes } from "../shared/countryMentions.js";

const VALID_TYPES = new Set(["dual_residency", "withholding", "totalization", "other"]);

// A small, deliberately non-exhaustive country lookup — enough to demonstrate
// jurisdiction extraction from free text without pretending to a full NLP
// entity-recognition pipeline this repo doesn't have.
//
// ⚠ `netherlands` AND `canada` WERE MISSING, AND THAT IS NOT WHY THE FIX IS
// STRUCTURAL. Run as a scenario, a CA→NL totalization inquiry produced
// `jurisdictions: []` beside a confident 273-day presence count
// (docs/DEMO-COUNTRIES.md §6.7). Both are added below — but adding two names
// closes two cases and leaves ~200 countries able to do the same thing, in a
// form that is now HARDER to see because the obvious examples work. The durable
// half lives in jurisdictionKnowledge.js: a day count can no longer be rendered
// without an explicit statement of what is known about the jurisdiction it
// counts days in, and "this country is not in the register, so nobody has
// looked" is one of the things that statement can say.
//
// Anything added here must still be a meaning-bearing word, never a bare
// alpha-2 code — compileCountryDictionary() enforces that, for the reason
// below.
//
// ⚠ THE BARE `de: "DE"` KEY IS GONE. It was matched with `String.includes`, so
// every "resiDEnt", "unDEr", "consiDEred" and "proviDEd" — words that appear in
// practically every cross-border tax question ever written — silently added
// GERMANY to the dossier's jurisdiction list. A 🔴 tax dossier naming a country
// nobody mentioned is a wrong fact in front of a human deciding someone's tax
// position; the same class of defect as UC-07's ticket 18, in a use case where
// the jurisdictions ARE the answer. compileCountryDictionary() now refuses bare
// two-letter keys outright, so this cannot be re-added by accident.
const KNOWN_COUNTRIES = {
  germany: "DE",
  spain: "ES",
  portugal: "PT",
  nigeria: "NG",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
  france: "FR",
  netherlands: "NL",
  canada: "CA",
};

const COUNTRY_MATCHER = compileCountryDictionary(KNOWN_COUNTRIES);

function isValidParse(obj) {
  return obj && VALID_TYPES.has(obj.inquiryType) && Array.isArray(obj.jurisdictions);
}

/**
 * Rule-based parser — the default, and the fallback on any LLM failure.
 * @param {object} input
 * @param {string} input.text
 * @returns {{inquiryType: string, jurisdictions: string[]}}
 */
export function parseInquiryRuleBased({ text }) {
  const lower = asLowerText(text);

  // Word-boundary matches, de-duplicated, in the order the TEXT names them —
  // not the order this file's dictionary literal happens to be typed in. UC-08
  // has no source/destination slots to get backwards, but "which jurisdictions
  // did the person actually name, and in what order" is still the honest
  // answer, and it is what a specialist reads first.
  const jurisdictions = distinctCountryCodes(findCountryMentions(text, COUNTRY_MATCHER));

  let inquiryType = "other";
  if (/dual.?resident|resident of both|two countries.*tax/.test(lower)) {
    inquiryType = "dual_residency";
  } else if (/totali[sz]ation|social security|\ba1\b|certificate of coverage/.test(lower)) {
    inquiryType = "totalization";
  } else if (/withhold|withholding|payroll tax/.test(lower)) {
    inquiryType = "withholding";
  }

  return { inquiryType, jurisdictions };
}

const SYSTEM_PROMPT = `You classify inbound cross-border tax/social-security inquiries for an Employer-of-Record platform.
Read the ticket text and return ONLY a JSON object with exactly these fields:
{
  "inquiryType": "dual_residency" | "withholding" | "totalization" | "other",
  "jurisdictions": string[]  // ISO 3166-1 alpha-2 country codes mentioned or clearly implied
}
Rules:
- You are labeling the REQUEST, not answering it. Never state a residency, withholding, or coverage conclusion.
- "jurisdictions" should list only countries the text actually names or unambiguously implies.
Return strict JSON, no prose, no markdown fences.`;

/**
 * @param {object} input
 * @param {string} input.text
 * @returns {Promise<{inquiryType: string, jurisdictions: string[]}>}
 */
export async function parseInquiry({ text }) {
  if (!isLlmConfigured()) {
    return parseInquiryRuleBased({ text });
  }
  try {
    const result = await askJson(SYSTEM_PROMPT, `Ticket text:\n"""${text || ""}"""`);
    if (!isValidParse(result)) {
      throw new Error(`LLM returned an invalid parse shape: ${JSON.stringify(result)}`);
    }
    return { inquiryType: result.inquiryType, jurisdictions: result.jurisdictions };
  } catch (err) {
    console.error(`[inquiryParser] LLM parse failed, falling back to rules: ${err.message}`);
    return parseInquiryRuleBased({ text });
  }
}
