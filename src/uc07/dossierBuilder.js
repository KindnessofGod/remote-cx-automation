// ---------------------------------------------------------------------------
// dossierBuilder.js  —  Assembling the feasibility dossier for Mobility Legal
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// docs/use-cases/UC-07.md §6: the LLM may "compile a structured feasibility
// dossier + PE-liability flags + uncertainty score" but must NOT "assert legal
// conclusions as fact" or "make the relocation decision." Every fact in the
// dossier is computed by pure, deterministic code elsewhere (transitionGate.js,
// costCalculator.js, mobilityRetriever.js); this file's only LLM-touching
// function (draftNarrative) restates those already-computed facts in prose —
// the same "LLM drafts display text from decided facts, never the other way
// round" pattern as uc06/changeParser.js and uc08/dossierBuilder.js. The
// disclaimer is applied here, unconditionally, so no caller can forget it
// (spec §13 build task 7: `disclaimer-injector`).
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withDisclaimer } from "../shared/disclaimer.js";
import { withRetry } from "../shared/retry.js";
import { countryLabel } from "../shared/countryNames.js";

// ---------------------------------------------------------------------------
// THE VOCABULARY A MOBILITY SPECIALIST READS, AS OPPOSED TO THE ONE THE GATES USE
// ---------------------------------------------------------------------------
// This narrative is the ticket's internal note. It is read by a Mobility Legal
// Tier-3 specialist and by nobody who wrote this code, and it used to hand them
// four pieces of this system's own private vocabulary in a row: a request-type
// slug (`permanent_relocation`), two bare ISO codes (`Source country: DE.`), a
// gate verdict shouted in caps (`BLOCK`) and then a comma-separated list of flag
// CODES (`UC07_MOT_VIOLATION, UC07_EMPLOYMENT_GAP`) — while every one of those
// flags was already carrying a written-out `message` that nothing printed.
//
// NONE OF THE WORDINGS BELOW IS INVENTED. The verdict meanings are condensed
// from `src/uc07/dossierView.js`'s `describeVerdict()`, which already argues
// them at length for the sidebar — in particular that PROCEED is NOT an
// approval, because this use case has no execution path and cannot give one.
// The request types are the five `relocationParser.js` can produce, described in
// the terms its own classifier matches on. The flag meanings are read off each
// flag's `message`, written in `transitionGate.js`'s MESSAGES, never re-worded
// here. Countries are named through `src/shared/countryNames.js`.
// ---------------------------------------------------------------------------

/** The five values `relocationParser.js` can return, in a reader's words. */
const REQUEST_TYPE_WORDS = new Map([
  ["permanent_relocation", "a permanent relocation"],
  ["temporary_workation", "a temporary workation"],
  ["business_travel", "business travel"],
  ["address_change", "a change of address"],
  // A real state, not a gap: the parser read the request and could not place it
  // in any of its four categories. Saying so is the point.
  ["other", "a request this system could not place in any of its relocation categories"],
]);

/** PROCEED / REVIEW / BLOCK, in the terms dossierView.js already established. */
const VERDICT_WORDS = new Map([
  [
    "PROCEED",
    "The deterministic gates found nothing wrong with the plan as proposed. That is NOT an approval — this use case has no execution path, and a human decides.",
  ],
  ["REVIEW", "The deterministic gates found no blocking condition, but items below need settling before this can be signed off."],
  ["BLOCK", "The deterministic gates found at least one blocking condition: the plan cannot proceed as proposed."],
]);

function draftNarrativeTemplate({ relocationType, sourceCountry, destinationCountry, verdict, flags, citations }) {
  // `countryLabel()` names the country and leaves anything that is not
  // code-shaped exactly as given — read its header before touching this, and do
  // not wrap a value twice. Codes still decide everywhere else; only this string
  // is read by a person.
  const from = sourceCountry ? countryLabel(sourceCountry) : null;
  const to = destinationCountry ? countryLabel(destinationCountry) : null;
  // BOTH LIMITS SURVIVE THE REWRITE. The old template stated "Source country not
  // identified." and "Destination country not identified." as two independent
  // sentences; a specialist has to be able to see WHICH half is missing, so the
  // four cases are written out rather than collapsed into one hedged sentence.
  const routeSentence =
    from && to
      ? `The move is from ${from} to ${to}.`
      : from
        ? `The move is from ${from}; the destination country was not identified in the request.`
        : to
          ? `The move is to ${to}; the country the employee is moving from was not identified in the request.`
          : "Neither the country the employee is moving from nor the destination country was identified in the request.";

  const parts = [
    `This request reads as ${REQUEST_TYPE_WORDS.get(relocationType) ?? `an unrecognised request type (${relocationType})`}.`,
    routeSentence,
    VERDICT_WORDS.get(verdict) ?? `The deterministic gates returned a verdict this summary has no wording for (${verdict}).`,
  ];
  if (flags.length) {
    // MEANINGS, NOT CODES. Each flag already carries the sentence
    // `transitionGate.js` wrote for it; printing the code instead asked the
    // specialist to hold a sixteen-entry taxonomy in their head. The codes are
    // NOT lost — `dossier.flags` still carries every one of them, so anything
    // that needs to be quoted or grepped still can be.
    parts.push(
      `The deterministic gates raised ${flags.length} point(s) for review. ${flags.map((f) => f.message ?? f.code).join(" ")}`
    );
  } else {
    parts.push("No flags raised by the deterministic gates.");
  }
  if (citations.length) {
    parts.push(`Cross-referenced guidance: ${citations.map((c) => c.title).join("; ")}.`);
  } else {
    parts.push("No matching global-mobility guidance was found in the local reference corpus.");
  }
  parts.push("This is research context for a Mobility Legal specialist's own review, not a relocation decision or a legal determination.");
  return parts.join(" ");
}

const SYSTEM_PROMPT = `You write a short, neutral research summary for a Remote Mobility Legal Tier-3 specialist reviewing a permanent-relocation request.
You are given already-computed facts (request type, source/destination countries named in full, a deterministic feasibility verdict already written out in words, the flags' written meanings, and retrieved background guidance) — restate them plainly. Use the country NAMES and the flag MEANINGS you are given; never print a country code or a flag code. Do not add any figures, countries, dates, legal conclusions, or a recommendation not given to you, and never state or imply that a relocation is approved, denied, or legal.
Return ONLY a JSON object: {"narrative": string}.`;

/**
 * @param {object} args
 * @param {string} args.relocationType
 * @param {string|null} args.sourceCountry
 * @param {string|null} args.destinationCountry
 * @param {string} args.verdict
 * @param {Array<{code:string,severity:string}>} args.flags
 * @param {Array<{id:string,title:string}>} args.citations
 * @param {object} [opts]  test-only seams — defaults to the real llm module
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] every retry attempt
 *   is recorded as an audit trace step (§4 invariant 7)
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{narrative: string, source: "llm"|"template"}>}
 */
export async function draftNarrative(
  { relocationType, sourceCountry, destinationCountry, verdict, flags, citations },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return {
      narrative: draftNarrativeTemplate({ relocationType, sourceCountry, destinationCountry, verdict, flags, citations }),
      source: "template",
    };
  }
  try {
    // THE MODEL IS HANDED THE READER'S VOCABULARY, NOT THE GATES'. It is told to
    // restate what it is given and nothing else, so giving it `UC07_MOT_VIOLATION`
    // and a bare `DE` guarantees those reach the specialist on the LLM path even
    // though the template path names them. Same facts, already decided — this
    // adds nothing the deterministic code did not compute.
    const userPrompt = `requestType: ${REQUEST_TYPE_WORDS.get(relocationType) ?? relocationType}\nsourceCountry: ${sourceCountry ? countryLabel(sourceCountry) : "not identified"}\ndestinationCountry: ${destinationCountry ? countryLabel(destinationCountry) : "not identified"}\nverdict: ${VERDICT_WORDS.get(verdict) ?? verdict}\nflags: ${JSON.stringify(flags.map((f) => f.message ?? f.code))}\ncitations: ${JSON.stringify(citations.map((c) => ({ id: c.id, title: c.title })))}`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    // NOTE: UC-08's dossierBuilder.js uses the identical `call` string below
    // ("dossierBuilder.draftNarrative") — the two are told apart by
    // details.useCase, not by `call`, so the collision is harmless here.
    let lastUsage = null;
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
            details: lastUsage ? { usage: lastUsage, useCase: "UC-07" } : null,
          }),
      }
    );
    return { narrative: result.narrative.trim(), source: "llm" };
  } catch (err) {
    console.error(`[dossierBuilder] LLM narrative failed after retries, falling back to template: ${err.message}`);
    return {
      narrative: draftNarrativeTemplate({ relocationType, sourceCountry, destinationCountry, verdict, flags, citations }),
      source: "template",
    };
  }
}

/**
 * Assemble the full feasibility dossier. Deterministic composition of already-
 * computed facts; the mandatory mobility disclaimer is applied here, not left
 * to a caller who might forget it (docs/use-cases/UC-07.md §13 build task 7).
 */
export function buildDossier({
  relocationType,
  sourceCountry,
  destinationCountry,
  parseSource,
  verdict,
  feasible,
  flags,
  requiredActions,
  mot,
  coverage,
  alignment,
  transition,
  pto,
  seniority,
  uncertainty,
  costEstimate,
  citations,
  narrative,
  faithfulness = null,
}) {
  return {
    relocationType,
    sourceCountry,
    destinationCountry,
    parseSource,
    verdict,
    feasible,
    flags,
    requiredActions,
    dateChecks: { mot, coverage, alignment },
    transitionSafety: transition,
    pto,
    seniority,
    uncertainty,
    costEstimate,
    citations,
    narrative,
    faithfulness,
    framing: "RESEARCH SUPPORT ONLY — not a relocation decision or a legal, immigration, or tax determination. For review by a qualified Mobility Legal specialist (Tier-3).",
    customerFacingAcknowledgement: withDisclaimer(
      "Thank you for your relocation request. It has been received and is under review by our Mobility Legal specialist team.",
      "mobility"
    ),
  };
}
