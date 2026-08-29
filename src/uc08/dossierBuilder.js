// ---------------------------------------------------------------------------
// dossierBuilder.js  —  Assembling the research dossier for Tax Ops
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/use-cases/UC-08.md §6: the LLM may "draft analytical research dossier
// for tax counsel" but must NOT "assert residency/withholding conclusions."
// The dossier is deliberately framed throughout as RESEARCH SUPPORT for a
// human, never an answer — every fact in it (presence days, citations) is
// computed/retrieved elsewhere by pure, deterministic code; this file's only
// LLM-touching function (draftNarrative) restates those given facts in
// prose, the same "LLM drafts display text from already-decided facts,
// never the other way round" pattern as uc06/changeParser.js's draftSummary().
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withDisclaimer } from "../shared/disclaimer.js";
import { withRetry } from "../shared/retry.js";
import { describeJurisdictionCoverage } from "./jurisdictionKnowledge.js";
import { countryLabel } from "../shared/countryNames.js";

// ---------------------------------------------------------------------------
// THE VOCABULARY A TAX SPECIALIST READS, AS OPPOSED TO THE ONE THE PARSER USES
// ---------------------------------------------------------------------------
// This narrative is the ticket's internal note, read by a Tax Ops specialist.
// It used to open "Inquiry type: dual_residency. Jurisdictions mentioned:
// CA, NL." — a classifier slug and two bare ISO codes, in the first two
// sentences a human sees.
//
// THE WORDINGS ARE NOT INVENTED. They restate what `inquiryParser.js`'s own
// classifier matches on: `dual_residency` fires on "dual resident / resident of
// both / two countries ... tax"; `totalization` on "totalisation / social
// security / A1 / certificate of coverage"; `withholding` on "withhold /
// withholding / payroll tax"; `other` is the real state of having read the text
// and placed it in none of the three. Nothing here states or implies a
// residency, withholding or coverage conclusion — that is the one thing this
// 🔴 use case must never do, and a label for the QUESTION is not an answer to it.
// ---------------------------------------------------------------------------
const INQUIRY_TYPE_WORDS = new Map([
  ["dual_residency", "a dual tax-residency question"],
  ["withholding", "a payroll-withholding question"],
  ["totalization", "a social-security totalisation / certificate-of-coverage question"],
  ["other", "a cross-border tax or social-security question this system could not place in any of its categories"],
]);

function draftNarrativeTemplate({ inquiryType, jurisdictions, presenceDays, citations, presenceCountry = null }) {
  // COMPUTED HERE, NEVER ACCEPTED FROM THE CALLER. A caller that could pass this
  // in is a caller that could omit it, and the whole defect being fixed is a
  // number rendered without it. Same inputs as buildDossier() uses, so the two
  // cannot disagree.
  const coverage = describeJurisdictionCoverage({ jurisdictions, presenceCountry, presenceDays });
  const parts = [
    `This inquiry reads as ${INQUIRY_TYPE_WORDS.get(inquiryType) ?? `an inquiry type this summary has no wording for (${inquiryType})`}.`,
    // NAMES, NOT CODES — CLAUDE.md's standing instruction, and this is a string
    // a Tax Ops specialist reads. `countryLabel()` leaves anything that is not
    // code-shaped exactly as given, so a jurisdiction that arrived as a name
    // stays a name and an alpha-3 stays visibly an alpha-3; do not wrap twice.
    // The parsed `jurisdictions` array on the dossier still carries the codes.
    //
    // THE WORDING IS DELIBERATELY UNLIKE `coverage.statement`'s, which follows a
    // few sentences later. That sentence used to read "Jurisdictions named in
    // the request: CA, NL." — bare codes, and the same list this line already
    // states, so the reader met one fact twice in one paragraph. It now names
    // the countries and says how each of them got into play ("Jurisdictions in
    // play: Canada (named in the request); the Netherlands (named in the
    // request, and the country the presence-day count was taken in)"), which is
    // the half only that sentence can supply: the count's subject arrives as
    // structured input and may never have been named in the text at all.
    //
    // THE LIMIT IS UNCHANGED, WORD FOR WORD. "No specific jurisdiction was
    // identified in the request text" is the sentence that stops a reader
    // supplying a jurisdiction from memory — a day count with no jurisdiction is
    // an answer to a different question printed in the same shape (BUILD-LOG,
    // the CA→NL dossier that reported 273 days against `jurisdictions: []`).
    jurisdictions.length
      ? `This request names ${jurisdictions.map((j) => countryLabel(j)).join(", ")}.`
      : "No specific jurisdiction was identified in the request text.",
  ];
  if (presenceDays && presenceDays.status === "NOT_EVALUATED") {
    // Never render a NOT_EVALUATED result as a number (and never as 0): the
    // specialist must see that the count is MISSING, with the reason, so they
    // investigate the data instead of acting on a fabricated figure.
    parts.push(
      `Physical presence could NOT be computed from the supplied records: ${(presenceDays.problems ?? []).join("; ")}. ` +
        "No day count is available for this inquiry."
    );
  } else if (presenceDays) {
    parts.push(
      `Computed physical presence: ${presenceDays.days} distinct day(s) across ${presenceDays.periodsCounted} recorded period(s) in the evaluated window (overlapping periods counted once).`
    );
  }
  // Immediately after the count, never at the end: the statement of what is
  // known about the jurisdictions the count concerns has to reach the reader in
  // the same breath as the number, or it is read as boilerplate after the fact.
  parts.push(coverage.statement);
  parts.push(coverage.citizenship.statement);
  if (citations.length) {
    parts.push(`Retrieved background: ${citations.map((c) => c.title).join("; ")}.`);
  } else {
    parts.push("No matching background citations were found in the local reference corpus.");
  }
  parts.push("This is research context for a tax specialist's own analysis, not a residency, withholding, or coverage determination.");
  return parts.join(" ");
}

const SYSTEM_PROMPT = `You write a short, neutral research summary for a Remote Tax Operations specialist reviewing a cross-border tax/social-security inquiry.
You are given already-computed facts (the inquiry type already written out in words, the jurisdictions named in full, a presence-day count, and retrieved background citations) — restate them plainly. Use the country NAMES you are given and never print a country code. Do not add any figures, conclusions, or jurisdictions not given to you, and do not state or imply a residency/withholding/coverage determination.
If presenceDays is null, or its "status" is "NOT_EVALUATED", then NO day count exists: say the count could not be computed from the supplied records, and do NOT state any number of days — not even zero. A stated zero reads as "well under the 183-day threshold", which is a conclusion nobody computed.
You are also given "jurisdictionKnowledge" and "citizenshipGap": two statements about what this system does NOT know. If you state a day count you MUST also restate the jurisdictionKnowledge statement — a day count without it is a number about an unstated place measured against no rule. Restate the citizenshipGap statement too. Do not soften either, and do not add a threshold, a window or a country rule of your own.
Return ONLY a JSON object: {"narrative": string}.`;

/**
 * @param {object} args
 * @param {string} args.inquiryType
 * @param {string[]} args.jurisdictions
 * @param {{days:number, periodsCounted:number}|null} args.presenceDays
 * @param {string|null} [args.presenceCountry]  the country the day count was taken IN —
 *   supplied so the drafted prose can say what the number is a number ABOUT
 * @param {Array<{id:string, title:string}>} args.citations
 * @param {object} [opts]  test-only seams — default to the real llm module/no
 *   audit so callers are unaffected; injectable so hermetic tests never touch
 *   the network and never wait on real backoff delays.
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] when set,
 *   every retry attempt is recorded as an audit trace step (§4 invariant 7),
 *   same seam as classifier.js's classifyRequest().
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{narrative: string, source: "llm"|"template"}>}
 */
export async function draftNarrative(
  { inquiryType, jurisdictions, presenceDays, citations, presenceCountry = null },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return {
      narrative: draftNarrativeTemplate({ inquiryType, jurisdictions, presenceDays, citations, presenceCountry }),
      source: "template",
    };
  }
  try {
    // The two not-knowing statements go into the prompt as GIVEN FACTS, exactly
    // like the day count — the model is told to restate them, never to decide
    // whether they are worth mentioning.
    const coverage = describeJurisdictionCoverage({ jurisdictions, presenceCountry, presenceDays });
    // The model is handed the reader's vocabulary, not the parser's: it is told to
    // restate what it is given, so a slug or a bare code passed in here is a slug
    // or a bare code reaching the specialist. Same facts, already decided.
    const userPrompt = `inquiryType: ${INQUIRY_TYPE_WORDS.get(inquiryType) ?? inquiryType}\njurisdictions: ${JSON.stringify(jurisdictions.map((j) => countryLabel(j)))}\npresenceDays: ${JSON.stringify(presenceDays)}\npresenceCountry: ${JSON.stringify(presenceCountry)}\njurisdictionKnowledge: ${JSON.stringify(coverage.statement)}\ncitizenshipGap: ${JSON.stringify(coverage.citizenship.statement)}\ncitations: ${JSON.stringify(citations.map((c) => ({ id: c.id, title: c.title })))}`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    // NOTE: UC-07's dossierBuilder.js uses the identical `call` string below
    // ("dossierBuilder.draftNarrative") — the two are told apart by
    // details.useCase, not by `call`, so the collision is harmless here.
    let lastUsage = null;
    // Retry the LLM call (up to 3 attempts, §4 invariant 10) before this
    // try/catch's template fallback runs — same discipline as classifier.js.
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!r || typeof r.narrative !== "string" || !r.narrative.trim()) {
          throw new Error(`LLM returned an invalid narrative shape: ${JSON.stringify(r)}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "dossierBuilder.draftNarrative",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-08" } : null,
          }),
      }
    );
    return { narrative: result.narrative.trim(), source: "llm" };
  } catch (err) {
    console.error(`[dossierBuilder] LLM narrative failed after retries, falling back to template: ${err.message}`);
    return {
      narrative: draftNarrativeTemplate({ inquiryType, jurisdictions, presenceDays, citations, presenceCountry }),
      source: "template",
    };
  }
}

/**
 * Assemble the full dossier record. Deterministic composition of already-
 * computed facts — the disclaimer is applied here unconditionally, not left
 * to a caller who might forget it (docs/use-cases/UC-08.md §7: "Mandatory
 * disclaimer injection on any customer-facing message").
 * @param {object} args
 * @param {string} args.inquiryType
 * @param {string[]} args.jurisdictions
 * @param {{days:number, periodsCounted:number}|null} args.presenceDays
 * @param {Array<object>} args.citations
 * @param {string} args.narrative
 * @param {object} [args.faithfulness]  the narrative-judge verdict, attached
 *   for the specialist to see (never consumed by any decision/route)
 * @param {object|null} [args.presenceEvidence]  what the day count was a count
 *   OF — the country, the window, and every supplied record with either its
 *   clipped contribution or the reason it was excluded (presenceEvidence.js).
 *   Defaults to null so the n8n port, which does not build one, still produces
 *   a valid dossier; dossierView.js reports the absence rather than reading an
 *   empty basis as "no records were supplied".
 * @param {string|null} [args.presenceCountry]  the country a day count was taken
 *   IN, straight from the structured request (`targetCountry`). It is NOT read
 *   from the parsed text, which is exactly why it survives a request whose
 *   countries the dictionary failed to recognise.
 */
export function buildDossier({
  inquiryType,
  jurisdictions,
  presenceDays,
  citations,
  narrative,
  faithfulness = null,
  presenceEvidence = null,
  presenceCountry = null,
}) {
  // NOT A PARAMETER — DERIVED. `jurisdictionCoverage` is computed here from
  // inputs this function already has, so there is no call site anywhere, now or
  // later, that can produce a dossier carrying a day count without a statement
  // of what is known about the jurisdiction it counts days in. That is the
  // structural half of the CA→NL fix (docs/DEMO-COUNTRIES.md §6.7): a defect
  // that a caller can reintroduce by forgetting an argument has not been fixed,
  // it has been documented. See jurisdictionKnowledge.js's header.
  const jurisdictionCoverage = describeJurisdictionCoverage({
    jurisdictions,
    presenceCountry: presenceCountry ?? presenceEvidence?.country ?? null,
    presenceDays,
  });

  return {
    inquiryType,
    jurisdictions,
    // Beside `jurisdictions`, never instead of it: the raw list is what the
    // parser found, and this is what the dossier is able to SAY about it —
    // including, in every case today, that no residence test is held for any of
    // them.
    jurisdictionCoverage,
    presenceDays,
    // Beside the count, never inside it: `presenceDays` is compared field-for-
    // field against the n8n port's own calculator (test/n8nUc08Parity.test.js),
    // so widening it would break a comparison against a file this pass may not
    // edit. See presenceEvidence.js's header.
    presenceEvidence,
    citations,
    narrative,
    faithfulness,
    framing: "RESEARCH SUPPORT ONLY — not a residency, withholding, or coverage determination. For review by a qualified Remote Tax Operations specialist.",
    customerFacingAcknowledgement: withDisclaimer(
      "Thank you for your inquiry. It has been received and is under review by our tax specialist team.",
      "tax"
    ),
  };
}
