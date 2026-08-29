// ---------------------------------------------------------------------------
// classifier.js  —  UC-03 request understanding (THE LLM SEAM)
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// A travel/workation inquiry arrives as free text. UC-03 needs to know:
//   - is the employee travelling for passive business (meetings, conferences,
//     site visits) or will they actively perform their normal job duties from
//     the destination? THAT is the UC-03 vs UC-04 boundary — per the research
//     (docs/research/Remote UC-04 ... Deep-Dive Research Specification.md),
//     "Do not define UC-03 and UC-04 purely by duration. The correct first
//     routing question is: will the employee actively perform their normal job
//     duties while physically present in the destination country? NO →
//     potentially UC-03. YES → UC-04." Duration is a RISK VARIABLE, not the
//     classifier.
//   - where are they going (destination country)?
//   - when (start/end dates for the deterministic day-count)?
//   - do they explicitly ask for a formal support letter (HITL) rather than
//     just information (auto-resolve)?
//
// In production THIS is the one place an LLM is used in UC-03 — to read messy
// human language. Everything after this is deterministic (policyEngine.js
// recomputes the day-count from the parsed dates rather than trusting an
// LLM-provided duration — the spec's own §9 "Deterministic day-count over LLM
// parse" failure-mode guard).
//
// classifyTravelInquiry() tries a real OpenAI call first (if OPENAI_API_KEY is
// set), validates the JSON it gets back, and falls back to
// classifyTravelInquiryRuleBased() on ANY failure — missing key, network
// error, malformed JSON, or an invalid response shape. Same seam + source
// tagging discipline as uc01/classifier.js (§4 invariant 8).
// ---------------------------------------------------------------------------

import { askJson, isLlmConfigured, extractUsage } from "../shared/llm.js";
import { withRetry } from "../shared/retry.js";
import { asLowerText } from "../shared/text.js";
import { compileCountryDictionary, resolveDestinationCountry } from "../shared/countryMentions.js";
import { SANCTIONED_OR_RESTRICTED } from "./policyEngine.js";
// ONE DATE RULE FOR BOTH READERS — the employee's keystroke on the request form
// and the model's string are checked by the same function. See statedTrip.js.
import { isIsoCalendarDate } from "./statedTrip.js";

const VALID_INTENTS = new Set(["business_travel", "work_authorization"]);

// A small, deliberately non-exhaustive country lookup — enough to demonstrate
// destination extraction from free text without pretending to a full
// entity-recognition pipeline this repo doesn't have. Covers the foundation's
// curated 9-country scope (GB, IE, DE, PL, IN, PH, MX, CA, PT) plus the
// destination countries the demo/seeds actually use.
//
// Matched at WORD BOUNDARIES via countryMentions.js, never as substrings: this
// map is one `it: "IT"` away from reading the pronoun "it" as Italy, which is
// exactly how UC-07's dossier came to name France for the word "from". The
// compile step refuses bare two-letter keys, so that edit fails loudly here
// instead of quietly routing a trip to the wrong country's rules.
const DEMO_DESTINATIONS = {
  spain: "ES",
  germany: "DE",
  france: "FR",
  portugal: "PT",
  italy: "IT",
  netherlands: "NL",
  ireland: "IE",
  poland: "PL",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  "united states": "US",
  usa: "US",
  canada: "CA",
  india: "IN",
  philippines: "PH",
  mexico: "MX",
  nigeria: "NG",
  estonia: "EE",
};

// ---------------------------------------------------------------------------
// THE SANCTIONS GATE WAS DEAD ON THIS PATH, AND IT FAILED CLOSED, WHICH IS WHY
// NOTHING CAUGHT IT.
// ---------------------------------------------------------------------------
// `policyEngine.SANCTIONED_OR_RESTRICTED` holds ten codes (CU IR KP SY RU BY MM
// VE AF IQ) and `src/uc04/riskMatrix.js` imports the same Set. Not one of those
// ten appeared in the dictionary above — the ONLY thing that turns a country
// NAME in a ticket into a code. So "I'm travelling to Iran next month" resolved
// to `null` and came back `escalate / destination_unknown`: the right outcome,
// carrying a reason that is a statement about THIS DICTIONARY dressed up as a
// statement about the trip. A specialist reading `destination_unknown` goes and
// looks the country up; reading `sanctioned_region` they stop. Those are
// different human behaviours, and the reason string is the only thing that
// selects between them. Every negative test passed throughout, because a gate
// that cannot fire and a gate that is appropriately cautious are
// indistinguishable from outside — the failure mode `docs/BUILD-LOG.md` §3.30
// names, and the reason the positive test in test/uc03.test.js exists.
//
// THE CODES COME FROM THE SET; ONLY THE DISPLAY NAMES ARE LITERAL.
// A second hand-written list of restricted jurisdictions is a restricted
// jurisdiction list that drifts (`src/uc04/riskMatrix.js` says the same thing
// about its own import). So the loop below walks `SANCTIONED_OR_RESTRICTED`
// itself and looks each code UP here: a code added to the set with no name
// written for it throws at module load — every importer and every test — rather
// than becoming silently unresolvable, which is exactly the state this whole
// block exists to end. The reverse mistake is also refused: a name written for
// a code that is NOT in the set is dead weight the loop never reads, so it can
// never quietly widen what the rule path resolves.
//
// Only widely-written forms are listed. "korea" is deliberately absent — it is
// ambiguous between KP and KR, and resolving it either way would be a coin flip
// with a country's rules riding on it. Ambiguous text keeps resolving to `null`,
// which policyEngine.js already escalates honestly.
const RESTRICTED_DESTINATION_NAMES = Object.freeze({
  CU: ["cuba"],
  IR: ["iran"],
  KP: ["north korea", "dprk"],
  SY: ["syria"],
  RU: ["russia", "russian federation"],
  BY: ["belarus"],
  MM: ["myanmar", "burma"],
  VE: ["venezuela"],
  AF: ["afghanistan"],
  IQ: ["iraq"],
});

/**
 * Name -> code entries for every member of `codes`, derived from that set.
 * Exported so a test can assert the derivation directly rather than re-deriving
 * it (a test that retypes the mapping proves only that it can retype it).
 *
 * @param {Iterable<string>} [codes]  defaults to the live sanctions set
 * @returns {Record<string,string>}
 */
export function restrictedDestinationNames(codes = SANCTIONED_OR_RESTRICTED) {
  const dictionary = {};
  for (const raw of codes) {
    const code = String(raw).trim().toUpperCase();
    const names = RESTRICTED_DESTINATION_NAMES[code];
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error(
        `uc03/classifier: no free-text name is written for the restricted destination "${code}". ` +
          `Every member of SANCTIONED_OR_RESTRICTED must be resolvable from the words a requester would ` +
          `actually type, or the sanctions gate silently cannot fire for it on the rule-based path and the ` +
          `request escalates as "destination_unknown" instead — a true refusal with a false reason. ` +
          `Add the name(s) to RESTRICTED_DESTINATION_NAMES in this file (and to the n8n port, ` +
          `workflows/nodes-uc03/travelRouterGates.js, which test/n8nUc03Parity.test.js compares).`
      );
    }
    for (const name of names) dictionary[String(name).toLowerCase()] = code;
  }
  return dictionary;
}

/**
 * The dictionary the rule-based path resolves destinations with: the demo
 * destinations plus every restricted jurisdiction, the latter DERIVED from
 * `SANCTIONED_OR_RESTRICTED` rather than retyped beside it.
 *
 * Widening this can only ever make a refusal MORE specific, never turn one into
 * an approval: every code added here is a member of the sanctions set, the
 * sanctions gate is checked before the registry gate and returns `escalate`
 * unconditionally, and none of these codes appears in Remote's `/v1/countries`
 * registry (pinned by the overlap test in test/uc03.test.js), so the supported
 * gate could not have passed them either.
 */
export const KNOWN_COUNTRIES = { ...DEMO_DESTINATIONS, ...restrictedDestinationNames() };

const COUNTRY_MATCHER = compileCountryDictionary(KNOWN_COUNTRIES);

// ---------------------------------------------------------------------------
// ROUND-6 D-04: the only free-text box in the whole portal sits on the
// travel card, so a request that is not about travel at all still has to
// pass through this classifier — there is nowhere else for it to go. An
// employee asking for a landlord letter wrote, verbatim, "I'm not travelling
// and this isn't for a visa or a border check", and the router answered
// "your travel question" and asked which country they were flying to
// (qa/evidence/UC-01/2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md D-04).
//
// THIS DOES NOT ADD A NEW ROUTE. UC-03 stays a thin router with no gate of
// its own for "what IS this" — the fix is honesty at the one gate that was
// already going to escalate it (`destination_unknown`, since no destination
// was ever stated). `nonTravelSignal` is a second, additional flag on that
// SAME escalation, computed only when the request also matched none of the
// travel-intent patterns above — a real destination or a recognised travel
// verb always wins, because a person going to Spain who also mentions their
// landlord is still going to Spain. See policyEngine.js's rung 5 for where
// the flag is applied, and plainAnswer.js's `escalated` branch for the
// sentence it changes.
const NON_TRAVEL_SIGNAL_PATTERNS = [
  /\blandlord\b/i,
  /\blease\b/i,
  /\brental application\b/i,
  /\bmortgage\b/i,
  /\bapartment application\b/i,
  /\bproof of employment\b/i,
  /\bemployment verification\b/i,
  /\bverify my employment\b/i,
  /\bnot travel(?:l?ing)?\b/i,
];

const MONTHS = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/**
 * Guard against a malformed/hallucinated LLM response before we trust it.
 *
 * ---------------------------------------------------------------------------
 * THE DATES ARE CHECKED FOR SHAPE, AND DELIBERATELY NOT HERE. READ THIS BEFORE
 * "TIGHTENING" THE TWO LINES BELOW.
 * ---------------------------------------------------------------------------
 * `startDate`/`endDate` pass this guard as "a string or null", with no format
 * check, and `docs/TRAVEL-LETTER-INPUTS.md` §3 names the consequence: the travel
 * dates printed on a consular document are a model's string, verbatim. The only
 * thing downstream that objects is `computeDurationDays()`, which needs
 * `Date.parse()` to succeed — and `Date.parse()` accepts `"Sept 14 2026"` and
 * `"09/14/2026"` happily. The second is read in US month-first order, so a
 * September trip becomes a 14th-of-September-to-whatever one on a page a border
 * officer reads. That is the hole, and it is real.
 *
 * WHAT A FAILURE HERE COSTS, which is why the fix is not in this function.
 * Returning `false` fails the WHOLE classification: `withRetry()` calls the
 * model up to three more times, and then the run falls back to
 * `classifyTravelInquiryRuleBased()` — throwing away a correct reading of the
 * intent, the destination and the confidence because one date was written in the
 * wrong notation. The intent read is the one thing on this object that no
 * deterministic reader replaces well (it is what selects between UC-03 and
 * UC-04), and the rule-based date parser will not recover `"Sept 14 2026"`
 * either — it knows full month names only. So the retry buys three LLM calls and
 * loses the good half of the answer.
 *
 * WHAT HAPPENS INSTEAD. The shape rule is applied to each date INDIVIDUALLY at
 * the mapping step below (`usableLlmDate()`): a date that is not a real
 * `YYYY-MM-DD` calendar date is treated as ABSENT and recorded in
 * `dateProblems`, exactly as an unusable value the employee typed is treated in
 * `statedTrip.js`. The rest of the reading survives. The trip then has no
 * computable length, so `evaluate()` refuses `duration_unknown` and a person
 * looks at it — which is a stricter outcome than today's (today it is printed),
 * reached without discarding anything true.
 *
 * The one thing this must never become is a silent repair. Nothing anywhere
 * guesses what `"09/14/2026"` meant.
 */
function isValidClassification(obj) {
  return (
    obj &&
    VALID_INTENTS.has(obj.intent) &&
    (obj.destinationCountry === null || typeof obj.destinationCountry === "string") &&
    (obj.startDate === null || typeof obj.startDate === "string") &&
    (obj.endDate === null || typeof obj.endDate === "string") &&
    typeof obj.formalLetterRequested === "boolean" &&
    // OPTIONAL, AND VALIDATED WHEN PRESENT. Optional because this field was
    // added after the field set was fixed, and a model that omits it must fall
    // back to the deterministic scan rather than failing the whole
    // classification — losing a good intent read over a missing list would make
    // the router worse, not safer. Validated when present because
    // `assessLetterScope()` treats a present-but-unusable list as a FINDING,
    // and it can only do that if the shape reaching it is the model's own.
    (obj.letterSpecialRequests === undefined ||
      (Array.isArray(obj.letterSpecialRequests) && obj.letterSpecialRequests.every((v) => typeof v === "string"))) &&
    // OPTIONAL, same reason as letterSpecialRequests above — added after the
    // field set was fixed (D-04), and a model that omits it must still be
    // trusted for everything else it read.
    (obj.nonTravelSignal === undefined || typeof obj.nonTravelSignal === "boolean") &&
    typeof obj.confidence === "number" &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

/**
 * Extract travel dates from free text, deterministically. Returns ISO
 * YYYY-MM-DD strings or null. Handles "2026-03-01", "March 1", "1 March",
 * "March 1st". Month-name forms get the current year inferred; when a span
 * then reads backwards (a trip crossing a year boundary like "Dec 28 – Jan
 * 4"), the end date is bumped to the following year. Kept honest: this is a
 * small, documented fallback for the rule-based path — a configured LLM is
 * expected to return proper ISO dates, and policyEngine.js only gates on
 * what IT can recompute from those dates.
 * @param {string} text
 * @returns {{startDate: string|null, endDate: string|null}}
 */
export function parseItineraryDates(text) {
  const lower = asLowerText(text);
  let startDate = null;
  let endDate = null;

  // ISO dates first — explicit, no inference needed.
  const iso = [...lower.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map((m) => m[0]);
  if (iso.length >= 1) startDate = iso[0];
  if (iso.length >= 2) endDate = iso[1];

  // Month-name forms ("March 1", "1 March", "March 1st"). Only filled when the
  // ISO pass found nothing, so an explicit ISO date always wins over inference.
  const monthPat = Object.keys(MONTHS).join("|");
  const forward = new RegExp(`\\b(${monthPat})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
  const reverse = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPat})\\b`, "g");
  const found = [];
  for (const m of lower.matchAll(forward)) found.push({ order: m.index, month: m[1], day: m[2] });
  for (const m of lower.matchAll(reverse)) found.push({ order: m.index, month: m[2], day: m[1] });
  found.sort((a, b) => a.order - b.order);

  if (found.length && (startDate === null || endDate === null)) {
    const year = new Date().getFullYear();
    const toIso = ({ month, day }) => `${year}-${MONTHS[month]}-${day.padStart(2, "0")}`;
    if (startDate === null && found.length >= 1) startDate = toIso(found[0]);
    if (endDate === null && found.length >= 2) endDate = toIso(found[1]);
  }

  if (startDate && endDate && endDate < startDate) {
    // A span that reads backwards must cross a year boundary ("Dec 28 – Jan
    // 4"): assume the end is in the following year.
    endDate = `${Number(endDate.slice(0, 4)) + 1}${endDate.slice(4)}`;
  }

  return { startDate, endDate };
}

/**
 * Rule-based classifier — the default, and the fallback when the LLM path
 * fails for any reason. Kept as its own function so both paths are testable
 * and the fallback logic is a straight function call, not duplicated code.
 * @param {object} input
 * @param {string} input.text
 * @returns {{intent:"business_travel"|"work_authorization", destinationCountry:string|null,
 *            startDate:string|null, endDate:string|null, formalLetterRequested:boolean,
 *            confidence:number}}
 */
export function classifyTravelInquiryRuleBased({ text }) {
  const lower = asLowerText(text);

  // WHERE ARE THEY GOING — a question the old code did not ask. It took the
  // first country in the DICTIONARY that appeared anywhere in the text, so
  // "travelling from Spain to Germany" routed on Spain: the country they are
  // leaving. resolveDestinationCountry() takes an explicit "to"/"into" cue when
  // there is one, accepts a single named country when there is not (in UC-03
  // "work from Portugal" names the destination — the ORIGIN is the employment
  // record's country, never something the ticket has to state), and returns
  // null when two countries are named with nothing to separate them. A null
  // destination is not a dead end: policyEngine.js already escalates it as
  // `destination_unknown`, which is the correct outcome for a router that
  // cannot tell which country's rules apply.
  const { destinationCountry } = resolveDestinationCountry(text, COUNTRY_MATCHER);

  // UC-04 boundary: active execution of the employee's normal job duties from
  // abroad. The tell is performing their actual day-to-day work somewhere — not
  // passive business interactions (meetings/conferences/site visits), which
  // stay in UC-03 regardless of the word "work".
  const workFromAbroadPatterns = [
    /\bwork(?:ing)?\s+(?:from|in|at)\s/i,
    /\bwork(?:ing)?\s+abroad\b/i,
    /\bwork(?:ing)?\s+remotely\b/i,
    /\bremote work\b/i,
    /\bcontinue(?: to)?\s+work\b/i,
    /\bextend(?:ing)?\b[^.]*\bwork\b/i,
    /\bdo(?:ing)?\s+my\s+(?:job|work)\b/i,
    /\bcode\s+from\b/i,
    /\bpick up\s+my\s+normal\s+(?:work|duties|job)\b/i,
  ];
  const businessTravelPatterns = [
    /\bclient meeting\b/i,
    /\bconference\b/i,
    /\bbusiness meeting\b/i,
    /\bsite visit\b/i,
    /\boffsite\b/i,
    /\bpartner meeting\b/i,
    /\bnegotiations?\b/i,
    /\bcorporate retreat\b/i,
    /\bindustry event\b/i,
    /\battend(?:ing)?\b/i,
  ];
  // MATCHED vs DEFAULTED, and the difference is a confidence input further
  // down. `business_travel` is both a real reading and the fallback, so the
  // intent alone cannot say whether anything was recognised.
  const intentMatched =
    workFromAbroadPatterns.some((re) => re.test(lower)) || businessTravelPatterns.some((re) => re.test(lower));
  const intent = workFromAbroadPatterns.some((re) => re.test(lower))
    ? "work_authorization"
    : businessTravelPatterns.some((re) => re.test(lower))
      ? "business_travel"
      // Neither signal present: business travel is the safer default for
      // UC-03 — it is what UC-03 exists to handle, and the deterministic
      // gates below still escalate anything genuinely risky.
      : "business_travel";

  // D-04. Computed here, BEFORE confidence, because it feeds `readSomething`
  // below — see that constant's own comment for why. Only when NOTHING
  // travel-shaped was read: a stated destination or a matched intent pattern
  // always wins, on purpose (see this file's header note).
  const nonTravelSignal =
    !destinationCountry && !intentMatched && NON_TRAVEL_SIGNAL_PATTERNS.some((re) => re.test(lower));

  // An explicit request for a document/letter is the HITL signal — the spec's
  // automation boundary is "HITL if a formal travel letter is
  // generated", so this must be its own flag, not folded into intent.
  const formalLetterRequested = /support letter|letter of invitation|invitation letter|travel (support )?letter|letter for (my )?visa|visa application|port-of-entry|visa support/i.test(
    lower
  );

  const { startDate, endDate } = parseItineraryDates(text);

  // A crude but honest confidence signal. A real LLM would return its own.
  //
  // THREE LEVELS, NOT TWO, AND THE THIRD IS THE WHOLE POINT. This used to read
  // `destinationCountry && startDate ? 0.9 : 0.6`, so a request this scan could
  // read NOTHING out of scored exactly 0.6 — and the gate that is supposed to
  // catch that compares `confidence < 0.6`. 0.6 is not below 0.6, so on the
  // rule-based path the confidence gate has never once fired. It looked like a
  // control and was arithmetic that could not fail.
  //
  // Nothing went wrong because of it, which is why it survived: the destination
  // gate refused those requests a few rungs later, for a different stated
  // reason. That cover disappears the moment a requester can state the
  // destination on a form, because then an unreadable request arrives at the
  // gates with a perfectly good destination in it. "Hello." plus a filled-in
  // trip would have auto-resolved.
  //
  // So the two useful signals stay where they were — both facts read is 0.9,
  // one of them is 0.6 and still passes, because "Spain, no dates" is a request
  // we genuinely did read and the day-count gate is the right one to stop it —
  // and TOTAL failure now scores below the floor, where it always belonged.
  // The threshold and its comparison are untouched; only the score for "I read
  // nothing" moved to a value the comparison can actually reject.
  // "Read nothing" means NOTHING — not merely "no itinerary". A first cut of
  // this scored on destination and dates alone, which called
  // "I will be working remotely while I am away" an unreadable request: the
  // intent had been matched, and matching it is the entire basis of the routing
  // gate that request then failed to reach. Recognising a request and being
  // unable to place it are different states and only the second is unreadable.
  // `nonTravelSignal` counts as "read something" too, and it is why it had to
  // be computed above rather than after this line: a request that reads as a
  // landlord letter has been genuinely UNDERSTOOD, just not as a trip, and
  // scoring it identically to text this scan found nothing in at all sent it
  // to `low_confidence` / `human_review` — the same shapeless "somebody
  // decide this" the rest of this comment's history is about, one flag short
  // of naming what was actually read. See policyEngine.js rung 5 for what the
  // higher confidence then reaches instead: still `escalate` /
  // `destination_unknown`, now carrying `possible_non_travel_request`.
  const readSomething = Boolean(destinationCountry) || Boolean(startDate) || intentMatched || nonTravelSignal;
  const confidence = destinationCountry && startDate ? 0.9 : readSomething ? 0.6 : 0.3;

  // NO RULE-BASED LIST HERE, DELIBERATELY. The deterministic scan over the
  // request text lives in `letterScope.js` and runs on EVERY path — including
  // this one — so producing a second copy of it here would be the "exists
  // twice" shape this repository already maintains two guards against. `[]`
  // means "this reader contributed nothing", not "nothing was asked for".
  return {
    intent,
    destinationCountry,
    startDate,
    endDate,
    formalLetterRequested,
    letterSpecialRequests: [],
    confidence,
    nonTravelSignal,
  };
}

const SYSTEM_PROMPT = `You classify inbound travel/workation support inquiries for an Employer-of-Record platform.
Read the ticket text and return ONLY a JSON object with exactly these fields:
{
  "intent": "business_travel" | "work_authorization",
  "destinationCountry": string | null,
  "startDate": string | null,
  "endDate": string | null,
  "formalLetterRequested": boolean,
  "letterSpecialRequests": string[],
  "nonTravelSignal": boolean,
  "confidence": number between 0 and 1
}
Rules:
- "intent" is "work_authorization" ONLY when the employee will ACTIVELY perform their normal job duties from the destination (e.g. "work from Spain", "continue working while on holiday", "remote work", "working remotely from", "extend my trip and keep working", "do my usual job from"). Passive business activities — client meetings, conferences, site visits, negotiations, partner meetings, corporate retreats — are "business_travel".
- You classify the REQUEST, you never decide eligibility or approve anything.
- "formalLetterRequested" is true only when they explicitly ask for a letter/document (e.g. "travel letter", "travel support letter", "support letter for my visa application", "invitation letter", "letter for port-of-entry"). Asking "can I work from Spain for 3 weeks" is informational, not a letter request.
- "destinationCountry" is the ISO 3166-1 alpha-2 code of the destination country, or null if none is stated. Never guess a country the text doesn't name.
- "startDate"/"endDate" are ISO YYYY-MM-DD strings, or null if not stated. Never invent dates.
- "nonTravelSignal" is true ONLY when the message is not about travel or working abroad at all — for example a landlord, lease, rental application, mortgage, or a plain request for proof/verification of employment — AND states or implies no destination. A message that names a destination or an intent to travel/work abroad is never "nonTravelSignal": true, even if it also mentions something else.
- "letterSpecialRequests" lists, in the employee's own terms, anything they ask the letter to say, omit, be addressed to, or be produced in, BEYOND a plain confirmation of employment and travel dates.
- WHY someone wants a letter is NOT a special request. "for my visa application", "for my visa", "for immigration", "for the border", "for a conference" state the PURPOSE; they do not ask the letter to say anything it would not already say, so they belong in [] and NOT in this list. Only include an entry when the employee asks for something that changes the letter's CONTENT, its ADDRESSEE, or its LANGUAGE. "I need a letter for my visa" is []; "I need a letter addressed to the Spanish Consulate stating my passport number" is two entries. Examples of entries: "addressed to the Spanish Consulate General in Amsterdam", "must state my passport number", "confirm the company covers all costs", "needs to be in Portuguese", "leave my salary out". Use [] when they ask for nothing of the kind, and [] when no letter is requested at all. Report what they asked for; do NOT judge whether it is reasonable, and do NOT decide anything about it.
Return strict JSON, no prose, no markdown fences.`;

/**
 * One date off an LLM classification: the value if it is a real `YYYY-MM-DD`
 * calendar date, otherwise `null` with the rejection recorded.
 *
 * `null` and `""` are an ABSENT date, not a bad one — the prompt asks for null
 * when the text states no date, and recording a problem for the model doing
 * exactly as it was told would fill the audit trail with non-events.
 *
 * @param {"startDate"|"endDate"} field
 * @param {unknown} value
 * @param {Array<object>} problems  appended to in place
 * @returns {string|null}
 */
function usableLlmDate(field, value, problems) {
  if (value === null || value === undefined || value === "") return null;
  if (isIsoCalendarDate(value)) return value;
  problems.push({
    field,
    code: "date_not_iso",
    // Echoed so a reader can see WHAT was returned — "the model gave an unusable
    // date" without the string sends them to look for something they cannot find.
    // Bounded because this lands in an append-only table.
    received: String(value).slice(0, 60),
    detail:
      "The classifier returned a date that is not a real YYYY-MM-DD calendar date, so it was not used and was not " +
      "guessed at. The trip therefore has no length that can be counted, and a person decides it.",
  });
  return null;
}

/**
 * Understand a travel/workation inquiry. Uses a real OpenAI call when
 * configured, otherwise (and on any LLM failure) falls back to
 * classifyTravelInquiryRuleBased(). Every result is tagged with which path
 * produced it — `source: "llm"` or `source: "rule_based_fallback"` — so audit
 * rows can show how much of the automation actually rests on model output.
 * @param {object} input
 * @param {string} input.text  the ticket body
 * @param {object} [opts]  test-only seams — default to the real llm module so
 *   callers are unaffected; injectable so either path is testable hermetically
 * @param {typeof askJson} [opts.askJson]
 * @param {typeof isLlmConfigured} [opts.isConfigured]
 * @param {import("../shared/audit.js").AuditLogger} [opts.audit] when set, every
 *   retry attempt is recorded as an audit trace step (per §4 invariant 7) —
 *   success or failure. Trace steps are recorded without a parentId: the
 *   decision row that should own them doesn't exist until the workflow audits
 *   in its STEP 7, and AuditLogger binds them to that row then.
 * @param {(attempt:number) => Promise<void>} [opts.backoff]  test-only seam —
 *   defaults to withRetry()'s real (slow) backoff; inject a no-op in tests.
 * @returns {Promise<{intent:"business_travel"|"work_authorization", destinationCountry:string|null,
 *   startDate:string|null, endDate:string|null, formalLetterRequested:boolean,
 *   confidence:number, source:"llm"|"rule_based_fallback"}>}
 */
export async function classifyTravelInquiry(
  { text },
  { askJson: ask = askJson, isConfigured = isLlmConfigured, audit = null, backoff = undefined } = {}
) {
  if (!isConfigured()) {
    return { ...classifyTravelInquiryRuleBased({ text }), source: "rule_based_fallback" };
  }

  try {
    const userPrompt = `Ticket text:\n"""${text || ""}"""`;
    // See uc01/classifier.js for why usage is captured inside the closure,
    // not off withRetry()'s return value (closes METRICS.md's cost gap).
    let lastUsage = null;
    // Retry the LLM call itself (up to 3 attempts, §4 invariant 10) BEFORE
    // this try/catch's fallback runs — retry supplements the fallback, it
    // never replaces it. A shape failure retries too: it's as likely to be a
    // transient LLM glitch as a network error is.
    const result = await withRetry(
      async () => {
        const r = await ask(SYSTEM_PROMPT, userPrompt);
        lastUsage = extractUsage(r);
        if (!isValidClassification(r)) {
          throw new Error(`LLM returned an invalid classification shape: ${JSON.stringify(r)}`);
        }
        return r;
      },
      {
        ...(backoff ? { backoff } : {}),
        onAttempt: ({ attempt, ok, error }) =>
          audit?.logTraceStep({
            call: "classifyTravelInquiry.askJson",
            attempt,
            ok,
            error,
            details: lastUsage ? { usage: lastUsage, useCase: "UC-03" } : null,
          }),
      }
    );
    // THE MODEL'S DATES, QUARANTINED FIELD BY FIELD. See isValidClassification()
    // above for why the unusable one is dropped here rather than failing the
    // whole reading, and why it is never repaired.
    const dateProblems = [];
    const startDate = usableLlmDate("startDate", result.startDate, dateProblems);
    const endDate = usableLlmDate("endDate", result.endDate, dateProblems);
    return {
      intent: result.intent,
      destinationCountry: result.destinationCountry || null,
      startDate,
      endDate,
      // ONLY WHEN THERE IS ONE, so a clean classification is byte-identical to
      // what this function has always returned and nothing downstream has to
      // learn to ignore an empty array.
      ...(dateProblems.length ? { dateProblems } : {}),
      formalLetterRequested: Boolean(result.formalLetterRequested),
      // THE MODEL'S LIST OF THINGS THE TEMPLATE MAY NOT BE ABLE TO SAY. It can
      // only ever ADD to the deterministic scan in `letterScope.js` — a union,
      // never a replacement, and there is no field anywhere by which a model
      // can say "this one is standard". Normalised to an array here so a model
      // that omitted it is indistinguishable from one that saw nothing, which
      // is safe precisely because the deterministic scan is the floor.
      letterSpecialRequests: Array.isArray(result.letterSpecialRequests) ? result.letterSpecialRequests : [],
      // A stated destination always overrides a model's "nonTravelSignal":
      // true — the same override the rule-based reader applies, kept here
      // rather than trusted blind from the model's own arithmetic.
      nonTravelSignal: Boolean(result.nonTravelSignal) && !result.destinationCountry,
      confidence: result.confidence,
      source: "llm",
    };
  } catch (err) {
    console.error(
      `[uc03-classifier] LLM classification failed after retries, falling back to rules: ${err.message}`
    );
    return { ...classifyTravelInquiryRuleBased({ text }), source: "rule_based_fallback" };
  }
}
