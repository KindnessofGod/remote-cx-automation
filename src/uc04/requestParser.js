// ---------------------------------------------------------------------------
// requestParser.js  —  UC-04 request understanding (THE LLM SEAM, narrow)
// ---------------------------------------------------------------------------
// WHY THIS IS NARROWER THAN uc01/classifier.js
// The 5 factors (nationality, home country, travel history, visa type, job
// duties) arrive as STRUCTURED INPUT, the same shape UC-06 demands for its
// `changes` object. Letting an LLM parse those out of free text would make
// it the source of a visa-type category or a destination country — exactly
// the rule this whole portfolio is built around ("LLMs interpret;
// deterministic code decides"). So:
//
//   - factors / risk result / travel history are passed in. This module
//     never invents, alters, or re-derives them.
//   - draftSummary() is the one place an LLM may run, and its output is
//     display text ONLY — a human-readable restatement of the structured
//     facts for the specialist. Never read back into any decision or
//     payload, exactly like uc06/changeParser.js's draftSummary().
//
// Same DI / retry / fallback / trace-wiring shape as the other LLM seams
// in this repo (src/uc01/classifier.js, src/uc06/changeParser.js,
// src/uc08/dossierBuilder.js). The same hermetic-test hazard they all hit
// (§4 invariant 10, see #32): this devcontainer's .env carries an
// unreachable OPENAI_API_KEY, so every test that doesn't inject a fake
// `askJson` + `isConfigured` would otherwise make a real, slow, failing
// network call. Established idiom in this repo: the test's fake is
// `draftSummary(args, { isConfigured: () => false })`, which runs the real
// function's own template branch — guaranteed identical to production's
// fallback, never a hand-maintained string that could drift from it.
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { FROM_TEXT } from "./intakeExtractor.js";
import { countryLabel } from "../shared/countryNames.js";

/**
 * WHICH FACTORS A MODEL READ OUT OF PROSE, as a sentence a specialist cannot
 * miss. `src/uc04/textIntake.js` marks every factor with where its value came
 * from; this turns the `read_from_request_text` ones into the caveat that has
 * to travel with them.
 *
 * WHY IT GOES IN THE SUMMARY specifically. `summary` is a real column on
 * `uc04_authorizations`, so it is what the ZAF sidebar and the API view already
 * render — the machine-readable provenance lives in `audit_log.details.extraction`,
 * but nothing in front of a human reads that today. An extracted destination
 * shown identically to a picked one is a value a specialist will approve without
 * knowing it was a reading. Returns "" for every form/webhook submission, which
 * keeps the summary byte-identical to before on every existing path (including
 * the n8n port, which has no text intake and whose parity test compares this
 * template's output).
 *
 * @param {object|null} extraction  the block textIntake.js builds
 */
export function extractedFactorsCaveat(extraction) {
  const provenance = extraction?.provenance;
  if (!provenance || typeof provenance !== "object") return "";
  const fields = Object.entries(provenance)
    .filter(([, v]) => v && v.from === FROM_TEXT)
    .map(([field]) => field);
  if (fields.length === 0) return "";
  const source = extraction.source === "llm" ? "a language model" : "this system's deterministic reader";
  return (
    `NOT STATED ON A FORM: ${fields.join(", ")} ${fields.length === 1 ? "was" : "were"} read out of the ` +
    `requester's own words by ${source} and ${fields.length === 1 ? "is a candidate" : "are candidates"}, ` +
    `not something anybody typed into a field. Confirm ${fields.length === 1 ? "it" : "them"} before approving.`
  );
}

/**
 * Deterministic fallback — always correct, if plain. Used when no LLM is
 * configured or on any failure. Mirrors changeParser.draftSummaryTemplate
 * in shape: a one-sentence statement of the five factors, the
 * risk-matrix's level, and the trip's start/end.
 */
function draftSummaryTemplate({ factors, riskLevel, tripDays, approvalRoute, reason, extraction = null }) {
  // Defensive reads, not decoration. A request whose factors are INCOMPLETE is
  // exactly the case that reaches `blocked / factors_invalid` — and it still has
  // to produce a summary for the human who has to read the decision. Dereferencing
  // `factors.destination.country` on such a request threw a TypeError, which in
  // n8n aborts the node BEFORE the audit write and loses the decision entirely.
  const f = factors ?? {};
  // COUNTRIES REACH THE READER BY NAME. `summary` is a real column on
  // `uc04_authorizations` and it is what the ZAF sidebar and the API view
  // render, so this string is read by a mobility specialist and never by anyone
  // who knows ISO 3166-1 by heart. The standing instruction is CLAUDE.md's:
  // *"instead of using country codes like PT you use the country's full name —
  // you can use codes inside the code, not on UI."* `PT` is Portugal and `PT` is
  // also what a hurried reader takes for "part-time".
  //
  // `countryLabel()` IS SAFE ON A VALUE THAT IS ALREADY A NAME — read its header
  // before touching this. Anything not two letters comes back trimmed and
  // otherwise untouched, so a free-text intake that put "Portugal" in this field
  // is not shouted back as "PORTUGAL" and an alpha-3 stays visibly an alpha-3.
  // That is why it is applied once, here, and must not be wrapped twice.
  //
  // NOTHING BELOW IS EVER COMPARED. The gates read `factors.destination.country`
  // itself — the code — and they still do; this is display only.
  const destinationCountry = countryLabel(f.destination?.country, "a destination the request does not name");
  const homeCountry = countryLabel(f.homeCountry, "a home country the request does not name");
  // F-32: tripDays is null when no length could be derived — the dates were
  // absent, unreadable, or the wrong way round, or a gate refused before the
  // matrix ran at all. Printing the raw value would put "for null day(s)" in
  // front of a specialist; printing 0 (what this used to receive) put a
  // fabricated number there, next to dates two weeks apart. Say what is true.
  const durationText = Number.isFinite(tripDays)
    ? `${tripDays} day(s)`
    : "an undetermined number of days";
  // The same rule one field over: a missing date is stated as missing, in words,
  // and never as the word "unknown" standing in a slot where a date belongs —
  // "(unknown to unknown)" is a reader's puzzle, not a statement.
  const datesText =
    f.startDate && f.endDate
      ? `${f.startDate} to ${f.endDate}`
      : f.startDate
        ? `starting ${f.startDate}, with no end date given`
        : f.endDate
          ? `ending ${f.endDate}, with no start date given`
          : "no travel dates given";
  const parts = [];
  parts.push(
    `Workation request from ${homeCountry} to ${destinationCountry} for ${durationText} (${datesText}).`
  );
  // WRITTEN AS A SENTENCE, NOT A FORM DUMP. This line used to read
  // "Visa type: unknown; job duties: unknown." — a field name, a colon and a
  // null, three times over, leaving the specialist to reassemble the fact that
  // nobody said. The LIMITS ARE NOT SOFTENED by the rewrite: an absent value is
  // still stated as absent and is still attributed to the request rather than
  // to this system's reading of it.
  const visaClause = f.visaType
    ? `The travel document the requester stated is ${f.visaType}`
    : "The requester stated no travel document type";
  const dutiesClause = f.jobDuties
    ? `and the work they describe doing there is ${f.jobDuties}`
    : "and the request does not describe the work they would be doing there";
  parts.push(
    `${visaClause}, ${dutiesClause}.${f.hasContractSigningAuthority ? " They hold contract-signing authority." : ""}`
  );
  // "sanctioned_region" never reaches the risk matrix at all — the
  // policyEngine's sanctions gate returns `blocked` before classifyRisk()
  // runs, so `riskLevel` is "unknown" here and a generic "blocked by the
  // risk matrix" line would misstate why. Named explicitly instead, so the
  // specialist reading this row sees the true cause rather than a phrase
  // implying a computation that never happened. Same defensive `f` read as
  // above — this branch is reachable from exactly the incomplete-factors
  // case the crash-safety fix above exists for.
  if (reason === "sanctioned_region") {
    parts.push(`Blocked — ${destinationCountry} is a sanctioned/restricted destination; not open to approval here.`);
    // The caveat rides on this branch too. A sanctions block decided on an
    // EXTRACTED destination is the one case where a reader most needs to know
    // the country was read rather than picked — it is the strongest claim this
    // system makes about a request, and it is the claim a wrong extraction
    // would most plausibly produce.
    const blockedCaveat = extractedFactorsCaveat(extraction);
    if (blockedCaveat) parts.push(blockedCaveat);
    return parts.join(" ");
  }
  parts.push(`Risk-matrix level: ${riskLevel}.`);
  if (approvalRoute === "specialist_approval") {
    parts.push("Awaiting one mobility specialist's approval before the authorization is issued.");
  } else if (approvalRoute === "blocked") {
    parts.push("Blocked by the risk matrix — not open to approval here.");
  } else if (approvalRoute === "escalate") {
    parts.push("Escalated to Mobility Legal Tier-2; not open to 1-click approval here.");
  } else {
    parts.push("Awaiting review.");
  }
  const caveat = extractedFactorsCaveat(extraction);
  if (caveat) parts.push(caveat);
  return parts.join(" ");
}

const SYSTEM_PROMPT = `You write a short, neutral summary of a remote-workation request for a mobility specialist's review screen.
You are given the exact structured factors already decided (home country, destination, dates, visa type, job duties, contract-signing authority) and the risk-matrix's classification. You must not invent, alter, or add any facts.
Return ONLY a JSON object: {"summary": string}.
The summary must restate only the given factors and the risk-matrix's level, in plain English, with no added facts, no advice, and no conclusion about whether to approve. Keep it under 80 words.`;

/**
 * Draft a human-readable summary for the approval screen. The structured
 * `factors` and `riskLevel` are the ONLY facts allowed in the output —
 * this is display text, never re-parsed into a decision.
 *
 * @param {object} args
 * @param {object} args.factors          the 5 structured factors (see policyEngine.js)
 * @param {string} args.riskLevel        the matrix's verdict: "low" | "medium" | "high" | "blocked"
 * @param {number|null} args.tripDays    duration of the requested workation, inclusive;
 *   null when it could not be derived (F-32) — never coerced to 0
 * @param {"specialist_approval"|"escalate"|"blocked"} args.approvalRoute
 *   what kind of decision the workflow is asking the specialist to make.
 * @param {string} [args.reason]         the policyEngine's own machine reason
 *   code (e.g. "sanctioned_region"). Used only to pick accurate wording for
 *   cases the generic riskLevel/approvalRoute phrasing would misstate — a
 *   sanctioned destination never reaches the risk matrix, so `riskLevel` is
 *   "unknown" for it and a generic "blocked by the risk matrix" line would
 *   be false. Never a new fact, never re-derives the decision.
 * @param {string} [args.reasonText]     free-text context from the requester, surfaced in the prompt
 *   as quoted text — the LLM may not treat it as a source of new facts.
 * @param {object} [opts]  test-only seams — default to the real llm module/no
 *   audit so callers are unaffected; injectable so hermetic tests never touch
 *   the network and never wait on real backoff delays.
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] when set,
 *   every retry attempt is recorded as an audit trace step (§4 invariant 7).
 * @param {(attempt:number) => Promise<void>} [opts.backoff]
 * @returns {Promise<{summary: string, source: "llm"|"template"}>}
 */
export async function draftSummary(
  { factors, riskLevel, tripDays, approvalRoute, reason = null, reasonText = "", extraction = null },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return { summary: draftSummaryTemplate({ factors, riskLevel, tripDays, approvalRoute, reason, extraction }), source: "template" };
  }
  try {
    // "not determined" rather than a bare `null` (F-32): the prompt forbids
    // inventing facts, so the one thing it must never be handed is a value it
    // could read as a number. `null` interpolates as the string "null"; 0 —
    // what this used to receive — reads as a real duration and would be
    // restated as one.
    const tripDaysText = Number.isFinite(tripDays) ? String(tripDays) : "not determined";
    const userPrompt = `Factors: ${JSON.stringify(factors)}\nRisk level: ${riskLevel}\nTrip days: ${tripDaysText}\nApproval route: ${approvalRoute}\nRequester's stated reason: "${reasonText}"`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
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
            call: "requestParser.draftSummary",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-04" } : null,
          }),
      }
    );
    // THE CAVEAT IS APPENDED HERE, NOT ASKED FOR IN THE PROMPT. A model that is
    // told not to add facts must not also be relied on to add this one, and a
    // provenance warning that a model can omit is a provenance warning that will
    // sometimes be omitted. Deterministic text, deterministically attached.
    const caveat = extractedFactorsCaveat(extraction);
    return { summary: caveat ? `${result.summary.trim()} ${caveat}` : result.summary.trim(), source: "llm" };
  } catch (err) {
    console.error(`[requestParser] LLM summary failed after retries, falling back to template: ${err.message}`);
    return { summary: draftSummaryTemplate({ factors, riskLevel, tripDays, approvalRoute, reason, extraction }), source: "template" };
  }
}
