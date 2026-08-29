// ---------------------------------------------------------------------------
// letterScope.js  —  Can the template say what this request asked for?
// ---------------------------------------------------------------------------
// THE QUESTION THIS FILE ANSWERS, AND THE ONE IT DELIBERATELY DOES NOT
//
// It answers: *is this a STANDARD travel letter — the template exactly as it
// stands, for a trip every gate above has already cleared — or did the
// requester ask for something the template cannot express?*
//
// It does NOT answer "may this be issued without a human". That question was
// settled by Remote, not by this repository, and the evidence is in
// `docs/use-cases/UC-03.md` §18. `TravelLetterRequest.status` documents its own
// enum in Remote's words:
//
//     pending             "Submitted by the employee and awaiting manager review."
//     approved_by_manager "Approved by the employer manager, awaiting Remote's review."
//     approved_by_remote  "Fully approved by both the manager and Remote.
//                          THE TRAVEL LETTER WILL BE GENERATED."
//
// [CONFIRMED — https://developer.remote.com/reference/get_v1_travel-letter-requests.md,
// fetched 2026-08-20.] Generation is conditioned on the SECOND of two human
// approvals, and `UpdateTravelLetterRequestParams` is a closed `oneOf` over
// `approved_by_manager` | `declined_by_manager` — so no API client can even
// reach the state that generates the document. A travel letter is not the
// employment-verification letter, which Remote hands out instantly from a
// template with nobody in the loop (`docs/INTAKE-RESEARCH.md` §6.5); it is the
// most gated member of Remote's letter family. **So the specialist sign-off
// stays, and this file does not touch it.**
//
// ---------------------------------------------------------------------------
// WHAT THE SPLIT IS FOR, THEN
// ---------------------------------------------------------------------------
// Before this file existed, EVERY letter request drafted the same template and
// put it in front of a specialist. A request saying "address it to the Spanish
// Consulate General in Amsterdam, state my passport number, and confirm the
// company covers the costs" produced a letter opening "To Whom It May Concern"
// with none of those three things in it — and the specialist was asked to sign
// THAT. Nothing anywhere recorded that three things had been asked for and
// silently dropped.
//
// That is the failure shape this repository keeps paying for, rotated once
// more: a correctly-drafted standard letter and a silently-truncated
// non-standard one are indistinguishable from outside. The specialist cannot
// see the request's own words in the document, so the omission is invisible at
// exactly the moment it matters.
//
// So:
//   STANDARD      -> `human_review / formal_letter_requested`. Drafted, queued,
//                    one signature — unchanged behaviour, now with the case
//                    stating positively that nothing outside the template was
//                    asked for, so the signer knows what they are checking.
//   NON-STANDARD  -> `escalate / letter_scope_exceeded`. NO letter is drafted,
//                    because a template that cannot say what was asked produces
//                    a document nobody should sign. The findings travel with
//                    the case: what was asked, which part the template cannot
//                    carry, and the source that says the field exists.
//
// Both land with the same team (`src/shared/escalationRouting.js` routes UC-03
// to Travel & Mobility Support for queue and escalation alike). What changes is
// what that team is being asked to DO — put a signature on a prepared document,
// or write one this system cannot prepare.
//
// ---------------------------------------------------------------------------
// PRIME DIRECTIVE 1: A MODEL MAY ROUTE **INTO** THE HUMAN PATH, NEVER OUT OF IT
// ---------------------------------------------------------------------------
// Classifying "standard vs non-standard" is interpretation, and interpretation
// is exactly what an LLM is for. But `standard` opens a drafting path, so a
// model's opinion must never be able to produce one. The asymmetry is built in,
// not asserted:
//
//   * `standard` is never a value anything reports — it is the ABSENCE of
//     findings. There is no field, on any input to this module, that means
//     "this is standard". A model cannot set one because none exists.
//   * the model's contribution is a LIST OF PROBLEMS (`letterSpecialRequests`),
//     unioned with the deterministic scan. A union can only grow the
//     non-standard set.
//   * a model list that is present but not an array of strings is itself a
//     finding (`model_reading_unusable`), not a reason to ignore it. An
//     unparseable reading cannot clear anything.
//   * the request's own words must be available to scan. Absent or blank text
//     is a finding (`request_text_unavailable`) — "we saw nothing unusual" and
//     "we had nothing to look at" are opposite statements and this module is
//     not allowed to confuse them.
//   * the confidence floor is re-applied here, from `policyEngine.js`'s own
//     constant. `evaluate()` already refuses a low-confidence request several
//     rungs earlier, so this is belt-and-braces — and it is the guard that
//     makes the property testable in isolation: no classification the router
//     would not trust can be assessed standard, whoever calls this function.
//
// PURE. No store, no clock, no network, no LLM. Same discipline as
// `letterOffer.js` and `signoffPolicy.js`.
// ---------------------------------------------------------------------------

import { DEFAULT_CONFIDENCE_THRESHOLD } from "./confidenceFloor.js";

/** The reason `evaluate()` returns when the template cannot express the ask. */
export const LETTER_SCOPE_EXCEEDED = "letter_scope_exceeded";

/**
 * WHAT THE TEMPLATE ACTUALLY ASSERTS, and where each value comes from.
 *
 * Read out of `renderTravelLetterHtml()` rather than described from memory —
 * every `field` below is a property that renderer reads. This is the list the
 * completeness check runs over, and it is the left-hand column of
 * `docs/use-cases/UC-03.md` §18's comparison table.
 *
 * `required` marks a row the letter cannot honestly go out without. A missing
 * required value is a finding, NOT a silent placeholder: the template used to
 * print "—" for an absent job title and "to be confirmed" for absent dates, on
 * a page written for a consulate. A dash on a consular document is not a
 * neutral rendering choice — it is the letter declining to answer a question it
 * appears to answer.
 */
export const TEMPLATE_ASSERTIONS = Object.freeze([
  Object.freeze({ field: "full_name", label: "Employee name", from: "employment record", required: true }),
  Object.freeze({ field: "job_title", label: "Job title", from: "employment record", required: true }),
  Object.freeze({ field: "status", label: "Employment status", from: "employment record", required: true }),
  Object.freeze({ field: "contract_type", label: "Contract type", from: "employment record", required: true }),
  Object.freeze({ field: "start_date", label: "Employment start date", from: "employment record", required: true }),
]);

/** The classification-side values the template prints. Same rule, other source. */
export const TEMPLATE_ITINERARY = Object.freeze([
  Object.freeze({ field: "destinationCountry", label: "Destination country", from: "the classified request", required: true }),
  Object.freeze({ field: "startDate", label: "Travel start date", from: "the classified request", required: true }),
  Object.freeze({ field: "endDate", label: "Travel end date", from: "the classified request", required: true }),
]);

/**
 * THE NON-STANDARD ASKS, each tied to a source rather than to an intuition.
 *
 * Six of the seven correspond to a property on Remote's OWN `TravelLetterRequest`
 * object that this system does not collect — which is the strongest available
 * evidence that the ask is real and that the template genuinely cannot serve it.
 * The seventh (language / legalisation) comes from the Commission's Visa Code
 * Handbook, which sets translation and legalisation per location rather than
 * centrally. Full citations in `docs/use-cases/UC-03.md` §18.
 *
 * PATTERNS ARE NARROW ON PURPOSE, IN ONE DIRECTION ONLY. A false positive is
 * safe here (it routes a letter to a person who can write it) and a false
 * negative is not (it signs a document that omits what was asked). But an
 * over-broad pattern has its own failure, and it is the expensive one this
 * repository has a name for: if `standard` becomes unreachable, "cannot succeed"
 * and "appropriately cautious" look identical from outside. So each pattern
 * requires a REQUESTING construction, not merely the topic. "for my visa
 * appointment at the consulate" names a consulate and asks for nothing; "please
 * address it to the consulate" asks. `test/uc03LetterScope.test.js` pins both
 * halves — the positive one first.
 */
export const NON_STANDARD_ASKS = Object.freeze([
  Object.freeze({
    code: "addressee_specified",
    label: "A named addressee for the letter",
    patterns: [
      /\baddress(?:ed|ing)?\s+(?:it|the letter|this)?\s*to\b/i,
      /\bmade?\s+out\s+to\b/i,
      /\bfor the attention of\b/i,
      /\battn\b[.: ]/i,
      /\baddressed\b/i,
    ],
    cannot:
      "The template opens \"To Whom It May Concern\" and has no addressee row. Remote's own travel-letter request " +
      "carries a required `embassy_address`; this system never asks for one, so there is no value to put there.",
    source: "TravelLetterRequest.embassy_address (required) — developer.remote.com, fetched 2026-08-20",
  }),
  Object.freeze({
    code: "identity_document_requested",
    label: "A passport number, date of birth or other identity anchor",
    patterns: [
      /\bpassport\s*(?:number|no\b|#)/i,
      /\btravel document number\b/i,
      /\bdate of birth\b/i,
      /\bd\.?o\.?b\.?\b/i,
      /\bid (?:card )?number\b/i,
    ],
    cannot:
      "The template carries no identity anchor, and this system holds none to carry: the employment record has no " +
      "passport or date-of-birth field, and Remote's own travel-letter request collects `travel_document_number` " +
      "on a surface UC-03 does not read. It must come from the employee; it must never be inferred.",
    source:
      "TravelLetterRequest.travel_document_number (required) — developer.remote.com, fetched 2026-08-20; " +
      "UC-03.md §17 (zero occurrences of passport/date-of-birth on the employment schema, re-verified live 2026-08-19)",
  }),
  Object.freeze({
    code: "cost_responsibility_requested",
    label: "A statement of who bears the cost of the trip",
    patterns: [
      /\b(?:who|company|employer|we|they)\s+(?:will\s+)?(?:pay|pays|is paying|are paying)\b/i,
      /\bcover(?:s|ing|ed)?\s+(?:all\s+|the\s+|my\s+)?(?:cost|costs|expenses|travel|accommodation|meals)\b/i,
      /\bbear(?:s|ing)?\s+the\s+cost/i,
      /\bat (?:the )?company(?:'s)? expense\b/i,
      /\bexpenses? (?:are|is|will be) (?:covered|paid)\b/i,
      /\bsponsor(?:s|ed|ship)?\b/i,
    ],
    cannot:
      "Cost responsibility is the EMPLOYER's answer, not the employee's — Remote types it as three separate enums " +
      "and documents each as \"Set by the employer during approval\". Nothing in UC-03 asks the employer, so the " +
      "template cannot state it and must not guess it.",
    source:
      "TravelLetterRequest.responsible_for_travel_cost / _meal_cost / _accommodation_cost (required, employer-set) " +
      "— developer.remote.com, fetched 2026-08-20; Visa Code Handbook I §5.2.2 (whether the stay is covered by a " +
      "sponsor is weighed for means of subsistence)",
  }),
  Object.freeze({
    code: "accommodation_address_requested",
    label: "The accommodation address at the destination",
    patterns: [
      /\baccommodation address\b/i,
      /\bhotel (?:address|booking|details)\b/i,
      /\baddress (?:where|at which) I(?:'ll| will| am)? ?(?:be )?stay/i,
      /\bwhere I(?:'m| am| will be) staying\b/i,
    ],
    cannot:
      "Proof of accommodation is a separate evidential head from proof of employment, and this letter is the second. " +
      "Remote collects `requires_travel_address` / `travel_address`; UC-03 collects neither.",
    source:
      "TravelLetterRequest.requires_travel_address / travel_address (required) — developer.remote.com, fetched " +
      "2026-08-20; Visa Code Handbook I §5.2 (accommodation is its own evidential head)",
  }),
  Object.freeze({
    code: "wording_specified",
    label: "Particular wording, or a third party's own form to be filled in",
    patterns: [
      /\b(?:must|should|needs? to|has to) (?:state|say|mention|include|confirm|read)\b/i,
      /\bplease (?:state|say|include|mention|add|confirm that)\b/i,
      /\bword(?:ed|ing)\b/i,
      /\bexact(?:ly)? (?:wording|phrase|format)\b/i,
      /\b(?:their|this|the attached|enclosed) (?:own )?(?:form|template|pro ?forma)\b/i,
      /\bfill (?:in|out) (?:the|this|their) (?:form|template)\b/i,
      /\bin the following (?:format|wording|terms)\b/i,
    ],
    cannot:
      "The template's rows are fixed and it has no free-text block. Remote's request object carries " +
      "`employer_special_instructions` for exactly this — text an employer adds to the letter — and it is set " +
      "during the employer's approval, by a person.",
    source: "TravelLetterRequest.employer_special_instructions (required, employer-set) — developer.remote.com, fetched 2026-08-20",
  }),
  Object.freeze({
    code: "omission_requested",
    label: "Something removed from the letter",
    patterns: [
      /\b(?:do ?n[o']?t|don't|do not|please don't|please do not) (?:include|mention|state|put|show)\b/i,
      /\bleave out\b/i,
      /\bomit\b/i,
      /\bwithout (?:my |the )?(?:salary|compensation|pay|earnings)\b/i,
      /\bno (?:salary|compensation) (?:in|on) the letter\b/i,
    ],
    cannot:
      "Removing a row is an edit to the document, and the same fixed template is the reason it cannot be made here. " +
      "This one matters more than it looks: base compensation is the letter's most sensitive row, and an employee " +
      "asking for it to be left out is asking a question about their own data that a person should answer.",
    source: "TravelLetterRequest.employer_special_instructions (required, employer-set) — developer.remote.com, fetched 2026-08-20",
  }),
  Object.freeze({
    code: "language_or_legalisation_requested",
    label: "Another language, a translation, or notarisation / apostille / a stamp",
    patterns: [
      /\bin (?:spanish|french|german|dutch|portuguese|italian|polish|the local language)\b/i,
      /\btranslat(?:e|ed|ion)\b/i,
      /\bnotar(?:ise|ize|ised|ized|isation|ization|y)\b/i,
      /\bapostille\b/i,
      /\blegalis(?:e|ed|ation)\b|\blegaliz(?:e|ed|ation)\b/i,
      /\b(?:wet |company |official )?(?:stamp|stamped|seal|sealed)\b/i,
      /\b(?:hand[- ]?)?signed (?:copy|original|in ink)\b/i,
    ],
    cannot:
      "The template renders English HTML, unstamped and unsigned by a named person. Which documents must be " +
      "translated, into which language, and whether legalisation is required are set PER CONSULATE by harmonised " +
      "lists, not centrally — so there is no universal answer this system could hard-code even if it wanted to.",
    source:
      "Visa Code Handbook I §5.1.2 (translation set locally) and §5.1.3 (legalisation only in individual cases), " +
      "Commission Implementing Decision C(2024) 4319 Annex, fetched 2026-08-20",
  }),
]);

/**
 * Findings from the request's own words. Deterministic: a regex table, run in
 * a fixed order, with no model and no state.
 *
 * @param {string} text  the employee's own words
 * @returns {Array<{code:string, label:string, detail:string, source:string, foundBy:"request_text"}>}
 */
export function detectNonStandardAsks(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const findings = [];
  for (const ask of NON_STANDARD_ASKS) {
    const matched = ask.patterns.find((re) => re.test(text));
    if (!matched) continue;
    findings.push({
      code: ask.code,
      label: ask.label,
      detail: ask.cannot,
      source: ask.source,
      foundBy: "request_text",
    });
  }
  return findings;
}

/**
 * Findings for template rows with no value behind them.
 *
 * Separate from the asks above because they are the opposite kind of problem:
 * nobody asked for anything unusual, the template simply has a hole. The
 * remedy is a record fix, not a specialist writing prose — and the case says
 * which.
 *
 * @param {object} args
 * @param {object|null} [args.employment]
 * @param {object|null} [args.classification]
 */
export function missingTemplateInputs({ employment = null, classification = null } = {}) {
  const findings = [];
  const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

  for (const row of TEMPLATE_ASSERTIONS) {
    if (!row.required) continue;
    if (!employment || blank(employment[row.field])) {
      findings.push({
        code: `missing_${row.field}`,
        label: row.label,
        detail:
          `The template states ${row.label.toLowerCase()} and the ${row.from} carries no value for it. The letter ` +
          "would print a placeholder where a consulate reads a fact.",
        source: "renderTravelLetterHtml() — the row exists in the template",
        foundBy: "template_completeness",
      });
    }
  }
  for (const row of TEMPLATE_ITINERARY) {
    if (!row.required) continue;
    if (!classification || blank(classification[row.field])) {
      findings.push({
        code: `missing_${row.field}`,
        label: row.label,
        detail:
          `The template states ${row.label.toLowerCase()} and ${row.from} did not yield one. A letter certifying a ` +
          "trip has to name the trip.",
        source: "renderTravelLetterHtml() — the row exists in the template",
        foundBy: "template_completeness",
      });
    }
  }
  return findings;
}

/**
 * The whole assessment. `standard` is the absence of findings and nothing else.
 *
 * @param {object} args
 * @param {string|null|undefined} args.requestText  the employee's own words
 * @param {object|null} [args.classification]
 * @param {object|null} [args.employment]
 * @param {number} [args.confidenceThreshold]
 * @returns {{standard:boolean, findings:Array<object>, checked:string[]}}
 */
export function assessLetterScope({
  requestText,
  classification = null,
  employment = null,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
}) {
  const findings = [];
  const checked = [];

  // 1. THE WORDS. Without them nothing below can claim "nothing unusual was
  //    asked for" — it could only claim "we did not look".
  checked.push("request_text_present");
  if (typeof requestText !== "string" || requestText.trim() === "") {
    findings.push({
      code: "request_text_unavailable",
      label: "The words of the request",
      detail:
        "The request's own text is not available on this decision, so it cannot be established that nothing " +
        "outside the template was asked for. This is not a finding about the trip — it is a finding about what " +
        "we can check.",
      source: "assessLetterScope() — fail-closed on an unreadable request",
      foundBy: "scope_check",
    });
  } else {
    checked.push("non_standard_asks_scan");
    findings.push(...detectNonStandardAsks(requestText));
  }

  // 2. THE MODEL'S CONTRIBUTION, which can only ever ADD. Absent is fine —
  //    the rule-based classifier supplies nothing and the deterministic scan
  //    above is the floor. Present-but-malformed is NOT fine: a reading we
  //    cannot parse has not cleared anything.
  const modelAsks = classification?.letterSpecialRequests;
  if (modelAsks !== undefined && modelAsks !== null) {
    checked.push("model_reported_special_requests");
    const usable = Array.isArray(modelAsks) && modelAsks.every((v) => typeof v === "string");
    if (!usable) {
      findings.push({
        code: "model_reading_unusable",
        label: "The classifier's list of special requests",
        detail:
          "The classifier reported special requests in a shape this gate cannot read, so what it saw is unknown. " +
          "An unreadable reading clears nothing.",
        source: "assessLetterScope() — fail-closed on an unusable model list",
        foundBy: "scope_check",
      });
    } else {
      for (const raw of modelAsks) {
        const asked = raw.trim();
        if (asked === "") continue;
        findings.push({
          code: "model_flagged_special_request",
          label: "Something the classifier read as outside the template",
          detail: asked,
          // NAMED AS A READING, NEVER AS A FACT. `00-FOUNDATION.md` §4
          // invariant 8's rule, applied to a finding rather than to a
          // classification: a specialist has to be able to tell what a model
          // thought from what a pattern matched.
          source: "the LLM's reading of the request — a recommendation, not a fact",
          foundBy: "classifier",
        });
      }
    }
  }

  // 3. TEMPLATE COMPLETENESS.
  checked.push("template_completeness");
  findings.push(...missingTemplateInputs({ employment, classification }));

  // 4. THE CONFIDENCE FLOOR, RE-APPLIED. `evaluate()` refuses a low-confidence
  //    request at rung 3, long before this runs — so in the workflow this can
  //    never fire. It is here so the property holds for ANY caller of this
  //    function, which is what makes it testable as a property rather than as
  //    a consequence of gate ordering. This repository has fixed four identity
  //    gates whose correctness rested on a later gate; the same reasoning
  //    applies to a gate that opens a drafting path.
  checked.push("confidence_floor");
  const confidence = classification?.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < confidenceThreshold) {
    findings.push({
      code: "classification_not_trusted",
      label: "Confidence in the reading of the request",
      detail:
        `The reading of this request scored ${
          typeof confidence === "number" && !Number.isNaN(confidence) ? confidence : "no usable confidence"
        } against a floor of ${confidenceThreshold}. A letter is never built from a reading the router does not trust.`,
      source: "policyEngine.js DEFAULT_CONFIDENCE_THRESHOLD",
      foundBy: "scope_check",
    });
  }

  return { standard: findings.length === 0, findings, checked };
}

/**
 * The findings as a sentence, for a Zendesk note or a queue entry.
 * Presentation only — it decides nothing and is consulted by no gate.
 */
export function summariseLetterScope(scope) {
  if (!scope || scope.standard) {
    return "Nothing outside the standard template was asked for.";
  }
  return scope.findings.map((f) => `${f.label}: ${f.detail}`).join(" ");
}
