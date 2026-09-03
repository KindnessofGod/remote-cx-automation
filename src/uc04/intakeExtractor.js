// ---------------------------------------------------------------------------
// intakeExtractor.js  —  UC-04's FRONT DOOR: reading a workation request out of
//                        somebody's own words (THE INBOUND LLM SEAM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS NOT requestParser.js
//
// `requestParser.js` is UC-04's OUTBOUND seam: structured facts go in, display
// prose comes out, and nothing it produces is ever read back. This file is the
// mirror image and therefore the dangerous direction — free text goes in and
// CANDIDATE FACTS come out, and those candidates are about to be compared
// against a sanctions list, a Schengen day count and two work-permit hard
// blocks. UC-04 had no such seam at all: every route into it (the portal form,
// the n8n graph, the API) required a human to have already filled in seven
// structured fields, so "somebody texting an AI" was not a supported entry path
// for the one use case people most often describe that way.
//
// THE THREE RULES THIS FILE IS BUILT AROUND (CLAUDE.md §3 directive 1)
//
//   1. NOTHING HERE DECIDES. It returns candidates and a list of what it could
//      not read. `src/uc04/policyEngine.js` remains the only judgment in UC-04,
//      and it sees the same seven factors whichever door the request came in.
//
//   2. A CANDIDATE MUST BE GROUNDED IN THE TEXT, checked deterministically
//      AFTER the model answers. A country code is accepted only if a name that
//      maps to it actually appears in the request, at a word boundary; a date
//      is accepted only if its year appears in the request. So the failure mode
//      that matters — a model quietly naming a country nobody wrote down —
//      cannot survive validation, because the check does not ask the model
//      whether it made the fact up. See isGrounded* below.
//
//   3. AN UNREAD FACT IS AN EXPLICIT GAP, NEVER A DEFAULT. Every field this
//      module could not fill leaves as a `notExtracted` entry naming the exact
//      `policyEngine.js` issue slug it will produce. There is no branch here
//      that supplies a plausible value for a missing one.
//
// WHAT MAY BE EXTRACTED, AND WHAT MAY NEVER BE — and the split is not this
// file's invention. `src/uc03/uc04Intake.js` already wrote down, input by
// input, where a travel request can source each of UC-04's seven required
// facts. Four of them have `source: null` there: nationality, visa type, job
// duties, and contract-signing authority. Those four are exactly the ones a
// person does not put in a message about a trip, and three of them are a closed
// enum or a boolean where "absent" must not silently become a value —
// `hasContractSigningAuthority` most of all, since guessing `false` understates
// permanent-establishment risk. So this module refuses to produce them at all,
// and `test/uc04TextIntake.test.js` pins that refusal against UC04_REQUIRED_INPUTS
// rather than against a second hand-written list.
//
// THE DICTIONARY IS IMPORTED, NOT COPIED. `src/uc03/classifier.js` already owns
// the one country name -> alpha-2 dictionary in this repo that is compiled with
// word-boundary matching and derives its restricted entries from
// `SANCTIONED_OR_RESTRICTED` itself. Copying it here would give UC-04 a second
// list free to drift from the sanctions set — the precise mistake
// `src/uc04/policyEngine.js`'s own import comment refuses one file over. It
// also means every one of the ten sanctioned destinations is nameable in prose
// here, which is what makes the sanctions gate reachable from this door.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { asLowerText } from "../shared/text.js";
import { isRealIsoDate, yearsMentioned, isDateGroundedInText as isGroundedDate } from "../shared/statedDates.js";
import { normalizeCountryCode, isWellFormedCountryCode } from "../shared/countryCodes.js";
import {
  compileCountryDictionary,
  findCountryMentions,
  resolveDestinationCountry,
} from "../shared/countryMentions.js";
import { KNOWN_COUNTRIES } from "../uc03/classifier.js";

/**
 * WHERE A FACTOR'S VALUE CAME FROM. Declared here rather than in
 * `textIntake.js` because `requestParser.js` reads them to decide whether a
 * summary must carry the "read from the requester's own words" caveat, and
 * `textIntake.js` imports `workflow.js`, which imports `requestParser.js` —
 * putting them there would close an import cycle for a pair of string
 * constants.
 */
export const FROM_TEXT = "read_from_request_text";
export const FROM_ANSWER = "supplied_by_requester";
export const FROM_RECORD = "employment_record";
export const NOT_SOURCED = "not_sourced";

/** The one dictionary, compiled once. See the header for why it is imported. */
const COUNTRY_MATCHER = compileCountryDictionary(KNOWN_COUNTRIES);

/** Every alpha-2 code this module is capable of emitting, from that dictionary. */
export const EXTRACTABLE_DESTINATIONS = Object.freeze(
  new Set(Object.values(KNOWN_COUNTRIES).map(normalizeCountryCode))
);

/**
 * The three facts free text may supply, each with the `policyEngine.js` issue
 * slug its absence produces. Exported so the clarification turn can be built
 * from THIS list rather than a second copy of it.
 */
export const EXTRACTABLE_FIELDS = Object.freeze([
  Object.freeze({ field: "destination.country", uc04Issue: "missing_destination_country" }),
  Object.freeze({ field: "startDate", uc04Issue: "missing_dates" }),
  Object.freeze({ field: "endDate", uc04Issue: "missing_dates" }),
]);

/**
 * The four facts this module refuses to produce, and the reason each refusal is
 * a safety property rather than a limitation. Exported for the clarification
 * turn and for the drift test against `src/uc03/uc04Intake.js`.
 */
export const NEVER_EXTRACTED_FIELDS = Object.freeze([
  Object.freeze({
    field: "nationality",
    uc04Issue: "missing_nationality",
    why: "Nationality is not on the employment record and a trip description does not state it. A nationality read out of prose would drive the visa rules in src/uc04/riskMatrix.js from a guess.",
  }),
  Object.freeze({
    field: "visaType",
    uc04Issue: "invalid_visa_type",
    why: "A closed seven-member enum, and the one field that decides the US and Canada work-permit hard blocks. Mapping 'I have a visa' onto a member of that enum is an inference, not a reading.",
  }),
  Object.freeze({
    field: "jobDuties",
    uc04Issue: "invalid_job_duties",
    why: "A closed seven-member enum whose `executive` member is the matrix's highest permanent-establishment risk. A job title in prose is not one of its members, and choosing the nearest one is exactly the kind of judgement a model must not make here.",
  }),
  Object.freeze({
    field: "hasContractSigningAuthority",
    uc04Issue: "missing_signing_authority",
    why: "Must be a real boolean: absent is NOT false, precisely because guessing false understates permanent-establishment risk. Silence in a message is not a denial.",
  }),
]);

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** Is this a real calendar date in ISO form — not just four-two-two digits? */
// MOVED TO src/shared/statedDates.js (2026-08-30), and re-exported here so
// every existing caller and test is unaffected. It moved because UC-03 needs
// the identical rule — its dates reach an issued travel letter and the UC-04
// continuation prefill — and this module cannot be imported from uc03/
// classifier.js without a cycle (intakeExtractor already imports
// KNOWN_COUNTRIES from it). Two copies of a grounding rule is exactly the
// "gates exist twice" shape CLAUDE.md §6 warns about.
export { isRealIsoDate };

/**
 * Read the trip's dates out of free text, deterministically — and REFUSE a date
 * whose year nobody wrote.
 *
 * WHY THIS IS STRICTER THAN `uc03/classifier.js`'s parseItineraryDates(), which
 * fills a missing year in from `new Date().getFullYear()`. UC-03's dates feed a
 * day count on a 🟢 router. UC-04's feed `start_in_past` and the Schengen
 * 90-in-180 hard block, where the year IS the answer: "14 September" resolved to
 * the wrong year moves a legal limit and can turn a refusal into an approval.
 * A year the requester never typed is the textbook plausible default this
 * module exists to refuse.
 *
 * The one inference allowed, and it is an inference about SCOPE rather than
 * about a value: when the text states exactly one year and a month-name date
 * carries none of its own, that single stated year is applied. The year is
 * still grounded — it is written in the request — and there is no second
 * candidate it could have been. Two different years in the text and a bare date
 * between them yields nothing, because then there genuinely is a choice.
 *
 * @param {unknown} text
 * @returns {{startDate: string|null, endDate: string|null, yearless: number}}
 *   `yearless` counts month-name dates dropped for want of a year, so the
 *   caller can say WHY the dates are missing instead of only that they are.
 */
export function parseExplicitDates(text) {
  const lower = asLowerText(text);
  const years = yearsMentioned(lower);
  const sharedYear = years.length === 1 ? years[0] : null;

  const found = [];
  let yearless = 0;

  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (isRealIsoDate(m[0])) found.push({ index: m.index, iso: m[0] });
  }

  const monthPat = Object.keys(MONTHS).join("|");
  // "September 14, 2026" / "September 14" — month first.
  const forward = new RegExp(`\\b(${monthPat})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,)?(?:\\s+(20\\d{2}))?\\b`, "g");
  // "14 September 2026" / "14th September" — day first.
  const reverse = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPat})(?:\\s*,)?(?:\\s+(20\\d{2}))?\\b`, "g");

  const collect = (match, month, day, year) => {
    const useYear = year ?? sharedYear;
    if (!useYear) {
      yearless += 1;
      return;
    }
    const iso = `${useYear}-${MONTHS[month]}-${String(day).padStart(2, "0")}`;
    if (isRealIsoDate(iso)) found.push({ index: match.index, iso });
  };

  for (const m of lower.matchAll(forward)) collect(m, m[1], m[2], m[3]);
  for (const m of lower.matchAll(reverse)) collect(m, m[2], m[1], m[3]);

  // Order by where they appear, and drop a date already found at the same spot
  // (an ISO string and a month-name form cannot overlap, but two regexes over
  // the same phrase can both fire on "14 September 2026").
  found.sort((a, b) => a.index - b.index);
  const isos = [];
  for (const f of found) {
    if (!isos.includes(f.iso)) isos.push(f.iso);
  }

  return { startDate: isos[0] ?? null, endDate: isos[1] ?? null, yearless };
}

/**
 * GROUNDING CHECK — does a country code the MODEL produced correspond to a name
 * actually written in the request? This is the whole defence against the single
 * most dangerous failure this system could have: a hallucinated destination
 * reaching the sanctions gate and the risk matrix. It is deliberately a check
 * on the text rather than a question to the model.
 */
function isGroundedCountry(text, code) {
  const wanted = normalizeCountryCode(code);
  if (!wanted) return false;
  return findCountryMentions(text, COUNTRY_MATCHER).some((m) => m.code === wanted);
}

/* isGroundedDate moved to src/shared/statedDates.js as isDateGroundedInText. */

/**
 * Deterministic extraction — the default, and the fallback whenever the LLM
 * path fails for any reason. Kept as its own exported function so both paths
 * are testable and the fallback is a straight call rather than duplicated code,
 * exactly as `uc01/classifier.js` and `uc03/classifier.js` do it.
 *
 * The destination resolver is UC-03's single-slot one: it takes an explicit
 * "to"/"into" cue when there is one, accepts a single named country when there
 * is not ("I'd like to work from Spain" names the destination — the origin is
 * the employment record's country, never something a message has to state), and
 * returns null when two countries are named with nothing to separate them. A
 * null destination is not a dead end here: it becomes an explicit gap, and the
 * clarification turn asks for it through a picker.
 *
 * @param {object} input
 * @param {string} input.text
 */
export function extractWorkationFactorsRuleBased({ text }) {
  const { destinationCountry, mentionedCountries, reason } = resolveDestinationCountry(text, COUNTRY_MATCHER);
  const { startDate, endDate, yearless } = parseExplicitDates(text);
  return {
    destinationCountry: destinationCountry ?? null,
    startDate,
    endDate,
    // An honest signal, not a model's self-assessment: everything read, or not.
    confidence: destinationCountry && startDate && endDate ? 0.9 : 0.5,
    evidence: {
      destinationReason: reason,
      mentionedCountries,
      yearlessDates: yearless,
    },
  };
}

const SYSTEM_PROMPT = `You read a remote-workation request written in a person's own words and return only the facts the text actually states.
Return ONLY a JSON object with exactly these fields:
{
  "destinationCountry": string | null,
  "startDate": string | null,
  "endDate": string | null,
  "confidence": number between 0 and 1
}
Rules:
- "destinationCountry" is the ISO 3166-1 alpha-2 code of the country the person wants to WORK FROM. Never a country they are leaving, never a country they merely mention, and never a country the text does not name. If the destination is not stated, or two candidates are equally plausible, return null.
- "startDate"/"endDate" are ISO YYYY-MM-DD. Return a date ONLY if the text states its year, or states exactly one year that plainly applies to it. Never infer the current year. Never invent a date.
- You are reading, not deciding. Do not judge whether the trip is allowed, do not assess risk, and do not supply the person's nationality, their visa, their job duties, or whether they can sign contracts — those are asked for separately and must not be guessed here.
- If you are unsure about any field, return null for that field. A null is always safe; a guess is not.
Return strict JSON, no prose, no markdown fences.`;

/** Guard against a malformed/hallucinated response BEFORE anything downstream sees it. */
function isValidExtraction(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    (obj.destinationCountry === null || typeof obj.destinationCountry === "string") &&
    (obj.startDate === null || typeof obj.startDate === "string") &&
    (obj.endDate === null || typeof obj.endDate === "string") &&
    typeof obj.confidence === "number" &&
    Number.isFinite(obj.confidence) &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

/**
 * Apply the two grounding checks and the shape rules to a raw extraction,
 * whichever path produced it. Anything that does not survive becomes a gap
 * naming why — never a silently dropped field and never a corrected one.
 *
 * `destinationCountry` must ALSO be a code this repo's own dictionary can
 * produce. That is not redundant with grounding: it is what guarantees the
 * value reaching `Set.has()` in the sanctions gate is a canonical alpha-2 code
 * from a curated list, rather than whatever two letters a model chose to emit.
 * "Spain" into a field that compares "ES" is the single most expensive
 * recurring defect in this repository's history; an extraction has no picker,
 * so this is the only thing standing there.
 */
function validateAgainstText({ text, destinationCountry, startDate, endDate }) {
  const rejected = [];

  let destination = normalizeCountryCode(destinationCountry);
  if (destination) {
    if (!isWellFormedCountryCode(destination)) {
      rejected.push({ field: "destination.country", why: `"${destinationCountry}" is not an ISO 3166-1 alpha-2 code.` });
      destination = null;
    } else if (!EXTRACTABLE_DESTINATIONS.has(destination)) {
      rejected.push({
        field: "destination.country",
        why: `"${destination}" is not a country this system can name from free text, so it is not accepted from free text. Pick it instead.`,
      });
      destination = null;
    } else if (!isGroundedCountry(text, destination)) {
      rejected.push({
        field: "destination.country",
        why: `"${destination}" does not appear in the request, so it was not read from it.`,
      });
      destination = null;
    }
  } else {
    destination = null;
  }

  const keepDate = (value, field) => {
    if (value === null || value === undefined || value === "") return null;
    if (!isRealIsoDate(value)) {
      rejected.push({ field, why: `"${value}" is not a real calendar date in YYYY-MM-DD form.` });
      return null;
    }
    if (!isGroundedDate(text, value)) {
      rejected.push({ field, why: `The year in "${value}" does not appear in the request, so it was not read from it.` });
      return null;
    }
    return value;
  };

  return {
    destinationCountry: destination,
    startDate: keepDate(startDate, "startDate"),
    endDate: keepDate(endDate, "endDate"),
    rejected,
  };
}

/**
 * Read a workation request out of a person's own words.
 *
 * Returns CANDIDATES and GAPS. It never returns a factor set, never touches
 * Remote, never writes anything, and cannot decide. The caller
 * (`src/uc04/textIntake.js`) is what assembles the seven factors and hands them
 * to the same `policyEngine.evaluate()` a form submission reaches.
 *
 * Every result is tagged `source: "llm"` or `source: "rule_based_fallback"`
 * (00-FOUNDATION.md §4 invariant 8), and the LLM call is retried before the
 * fallback runs (invariant 10) — the same shape as every other seam here.
 *
 * @param {object} input
 * @param {string} input.text  the request, in the requester's own words
 * @param {object} [opts]  test-only seams — default to the real llm module so
 *   callers are unaffected; injectable so hermetic tests never touch the
 *   network and never wait on real backoff delays (§6's "Never let npm test
 *   reach OpenAI", which has bitten this repo twice).
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit]
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{
 *   source: "llm"|"rule_based_fallback",
 *   confidence: number,
 *   candidates: {destinationCountry: string|null, startDate: string|null, endDate: string|null},
 *   read: Array<{field:string, value:string}>,
 *   notExtracted: Array<{field:string, uc04Issue:string, why:string}>,
 *   rejected: Array<{field:string, why:string}>,
 *   evidence: object
 * }>}
 */
export async function extractWorkationFactors(
  { text },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  let raw = null;
  let source = "rule_based_fallback";

  if (isConfigured()) {
    try {
      const userPrompt = `Request text:\n"""${text || ""}"""`;
      // Captured inside the retried closure, not off withRetry()'s return
      // value — an invalid-shape attempt still made (and paid for) a real
      // call. Same reasoning as uc01/classifier.js.
      let lastUsage = null;
      const result = await withRetry(
        async () => {
          const r = await ask(SYSTEM_PROMPT, userPrompt);
          lastUsage = extractUsage(r);
          if (!isValidExtraction(r)) {
            throw new Error(`LLM returned an invalid extraction shape: ${JSON.stringify(r)}`);
          }
          return r;
        },
        {
          ...(backoff ? { backoff } : {}),
          onAttempt: ({ attempt, ok, error }) =>
            audit?.logTraceStep({
              call: "intakeExtractor.askJson",
              attempt,
              ok,
              error,
              details: lastUsage ? { usage: lastUsage, useCase: "UC-04" } : null,
            }),
        }
      );
      raw = {
        destinationCountry: result.destinationCountry,
        startDate: result.startDate,
        endDate: result.endDate,
        confidence: result.confidence,
        evidence: { path: "llm" },
      };
      source = "llm";
    } catch (err) {
      console.error(`[uc04-intake] LLM extraction failed after retries, falling back to rules: ${err.message}`);
      raw = null;
    }
  }

  if (raw === null) {
    raw = { ...extractWorkationFactorsRuleBased({ text }), evidence: { path: "rule_based" } };
    source = "rule_based_fallback";
  }

  // BOTH PATHS ARE VALIDATED, and that is deliberate. The rule-based path can
  // only emit dictionary codes and real dates, so most of this is a no-op for
  // it — but running the check on one path only is how the two come to disagree
  // about what "accepted" means, and the fallback is the path that runs in
  // every offline demo and every LLM outage.
  const checked = validateAgainstText({
    text,
    destinationCountry: raw.destinationCountry,
    startDate: raw.startDate,
    endDate: raw.endDate,
  });

  const read = [];
  const notExtracted = [];
  const push = (field, value, uc04Issue, why) => {
    if (value) read.push({ field, value });
    else notExtracted.push({ field, uc04Issue, why });
  };

  push(
    "destination.country",
    checked.destinationCountry,
    "missing_destination_country",
    "The request does not name a destination this system could read, so no country was taken from it."
  );
  push(
    "startDate",
    checked.startDate,
    "missing_dates",
    "No start date with a stated year was found in the request. A year nobody wrote is not inferred here — it decides the Schengen window and whether the trip is in the past."
  );
  push(
    "endDate",
    checked.endDate,
    "missing_dates",
    "No end date with a stated year was found in the request."
  );

  return {
    source,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    candidates: {
      destinationCountry: checked.destinationCountry,
      startDate: checked.startDate,
      endDate: checked.endDate,
    },
    read,
    notExtracted,
    rejected: checked.rejected,
    evidence: raw.evidence ?? {},
  };
}
