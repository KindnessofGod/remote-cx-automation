// ---------------------------------------------------------------------------
// countryMentions.js  —  ONE place that reads country names out of free text
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Three parsers (UC-03's travel classifier, UC-07's relocation parser, UC-08's
// tax-inquiry parser) each opened with the same two lines:
//
//     const found = Object.keys(KNOWN_COUNTRIES)
//       .filter((name) => lower.includes(name))            // (1)
//       .map((name) => KNOWN_COUNTRIES[name]);
//     const [sourceCountry, destinationCountry] = found;   // (2)
//
// Both lines are wrong, and they compound.
//
// (1) `String.includes` matches INSIDE ordinary English words. The dictionaries
//     were keyed by full names AND bare ISO alpha-2 codes, so `fr` matched
//     inside "from", `ca` inside "relocating", `de` inside "resident" and
//     "under", `pt` inside "opt". Reproduced in production on Zendesk ticket 18
//     (n8n execution 4500): "permanently relocating from Portugal to Germany"
//     yielded the country set {DE, FR, PT, CA} — France and Canada were never
//     mentioned by anyone. This is the same false-positive class UC-02's
//     expenseClassifier.js already had to close ("the" matching inside "other"),
//     and it is closed the same way: match meaning-bearing units, not
//     substrings.
//
// (2) The source/destination slots came from `Object.keys()` INSERTION ORDER —
//     the order the dictionary literal happens to be typed in — not from where
//     the countries appear in the text or from any directional word. So even a
//     perfectly-matched pair landed in the wrong slots. Ticket 18's dossier
//     told a mobility specialist "Source country: DE; Destination country: FR"
//     for a request that plainly said Portugal to Germany.
//
// WHY A WRONG ANSWER IS WORSE THAN NO ANSWER HERE
// UC-07 and UC-08 are 🔴: they have no execution path, so a wrong extraction
// cannot cause a wrong write. It can do something one step removed and just as
// bad — cause a wrong HUMAN decision. A dossier that names jurisdictions
// confidently gives its reader no cue to doubt them. `null` renders as "not
// specified", which sends the reviewer to look; "DE" does not. So every
// function here fails to `null` on ambiguity rather than picking a candidate.
//
// WHAT THIS MODULE IS NOT: a named-entity-recognition pipeline. It is a curated
// dictionary matched at word boundaries, with the direction of travel taken
// from explicit English cue words. Everything it cannot resolve, it says it
// cannot resolve.
// ---------------------------------------------------------------------------

import { asLowerText } from "./text.js";
import { normalizeCountryCode } from "./countryCodes.js";

/**
 * Dictionary keys shorter than this are rejected by compileCountryDictionary()
 * unless explicitly allowed. Two letters is exactly the length at which a
 * country key stops being a word and starts being a fragment of other words:
 * `de`, `fr`, `ca`, `br`, `es`, `pt`, `in`, `is`, `it`, `at`, `no`, `so`, `to`,
 * `be`, `us`, `me`, `do`, `id`, `pe`, `ne`, `al` are all live ISO alpha-2 codes
 * AND all hide inside (or are) common English words.
 */
const MIN_KEY_LENGTH = 3;

/**
 * The only short forms allowed, and why each one is safe.
 *
 * "uk" — not an English word in any inflection, and it IS how people write the
 * United Kingdom in a support ticket. Word-boundary matching keeps it out of
 * "Ukraine".
 *
 * Deliberately NOT here: "us". It is the second-most common English pronoun
 * ("let us know", "contact us"), so even at a word boundary it would read a
 * pronoun as the United States. "united states" and "usa" cover the real usage.
 */
const DEFAULT_ALLOWED_SHORT_FORMS = ["uk"];

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a `{name: "XX"}` country dictionary into a matcher.
 *
 * THIS IS THE CONSTRUCTION SITE, and that is the point. The bare-alpha-2 check
 * throws at module load, so a future edit that re-adds `it: "IT"` or `in: "IN"`
 * to any dictionary in this repo fails immediately and loudly — every importing
 * module and every test that touches it — instead of silently re-opening the
 * defect on a live dossier. A comment asking people not to do it cannot be
 * checked; this can.
 *
 * @param {Record<string,string>} dictionary  country name (or accepted short
 *   form) → ISO 3166-1 alpha-2 code. Keys are matched case-insensitively.
 * @param {object} [options]
 * @param {string[]} [options.allowShortForms]  keys under MIN_KEY_LENGTH that
 *   are nevertheless safe — see DEFAULT_ALLOWED_SHORT_FORMS for the standard.
 * @returns {{entries: {key:string, code:string, pattern:RegExp}[]}}
 */
export function compileCountryDictionary(dictionary, { allowShortForms = DEFAULT_ALLOWED_SHORT_FORMS } = {}) {
  const allowed = new Set(allowShortForms.map((s) => String(s).toLowerCase()));
  const entries = [];
  for (const [name, code] of Object.entries(dictionary ?? {})) {
    const key = String(name).toLowerCase().trim();
    if (!key) continue;
    if (key.length < MIN_KEY_LENGTH && !allowed.has(key)) {
      throw new Error(
        `countryMentions: refusing the dictionary key "${key}" (→ ${code}). Bare two-letter codes match inside ordinary ` +
          `English words ("fr" in "from", "ca" in "relocating", "de" in "resident"), which is how a relocation dossier ` +
          `came to name France and Canada for a Portugal→Germany request. Spell the country out, or add the key to ` +
          `allowShortForms with a written reason it cannot collide.`
      );
    }
    entries.push({
      key,
      code: normalizeCountryCode(code),
      // Lookarounds rather than \b so multi-word keys ("the netherlands") and
      // future hyphenated ones behave the same as single words: a match must
      // not be flanked by another letter or digit.
      pattern: new RegExp(`(?<![a-z0-9])${escapeRegExp(key)}(?![a-z0-9])`, "g"),
    });
  }
  return { entries };
}

/** Directional cue immediately before a mention. */
const SOURCE_CUE = /(?:^|[^a-z])(?:from|out of|leaving)\s+(?:the\s+)?$/;
const DESTINATION_CUE = /(?:^|[^a-z])(?:to|into)\s+(?:the\s+)?$/;
const CUE_WINDOW = 24;

/**
 * Deliberately NOT a cue: "in". "Based in Portugal" is a source and "working in
 * Germany" is a destination, in the same grammatical position — so treating it
 * as either would be a coin flip dressed up as a rule. Text whose only
 * preposition is "in" therefore resolves to `null`, which is the honest answer.
 */
function cueFor(lowerText, index) {
  const before = lowerText.slice(Math.max(0, index - CUE_WINDOW), index);
  if (SOURCE_CUE.test(before)) return "source";
  if (DESTINATION_CUE.test(before)) return "destination";
  return null;
}

/**
 * Every mention of a dictionary country in `text`, in the order they appear,
 * each tagged with its directional cue (if any). Multiple mentions of the same
 * country are all returned — a later mention may be the cued one ("Germany is
 * the plan; relocating from Portugal to Germany in June").
 *
 * @param {unknown} text  free text; non-strings coerce safely via asLowerText()
 * @param {{entries: {key:string, code:string, pattern:RegExp}[]}} compiled
 * @returns {{code:string, matched:string, index:number, cue:"source"|"destination"|null}[]}
 */
export function findCountryMentions(text, compiled) {
  const lower = asLowerText(text);
  const hits = [];
  for (const entry of compiled.entries) {
    entry.pattern.lastIndex = 0;
    let m;
    while ((m = entry.pattern.exec(lower)) !== null) {
      hits.push({ code: entry.code, matched: entry.key, index: m.index, length: m[0].length });
      if (m[0].length === 0) entry.pattern.lastIndex += 1; // defensive: never loop forever
    }
  }
  // Longer match first at the same position so "the netherlands" wins over
  // "netherlands" — they carry the same code, but the longer one is the honest
  // record of what was matched.
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  return hits.map((h) => ({ code: h.code, matched: h.matched, index: h.index, cue: cueFor(lower, h.index) }));
}

/** Distinct country codes, in the order they first appear in the text. */
export function distinctCountryCodes(mentions) {
  const seen = new Set();
  const out = [];
  for (const m of mentions) {
    if (seen.has(m.code)) continue;
    seen.add(m.code);
    out.push(m.code);
  }
  return out;
}

function firstCodeWithCue(mentions, cue) {
  const hit = mentions.find((m) => m.cue === cue);
  return hit ? hit.code : null;
}

/**
 * Resolve a source→destination PAIR from free text.
 *
 * The rules, in order, and what each one refuses to do:
 *
 *  1. Both directions cued ("from Portugal to Germany", "to Germany from
 *     Portugal") → both slots filled from the cues. Word order is irrelevant,
 *     which is the whole reason cues beat position.
 *  2. One direction cued and exactly one OTHER country named ("relocating to
 *     Germany; she is currently employed in Portugal") → the cued country takes
 *     its slot and the single remaining country takes the opposite one. With
 *     two countries and one explicit direction there is only one reading.
 *  3. One direction cued and no other country → that slot only; the other stays
 *     null. A half-answer is not an ambiguity, it is a half-answer.
 *  4. Anything else — no cue at all, conflicting cues, or a cued slot plus two
 *     or more candidates for the other — → BOTH slots null. Position alone
 *     ("Portugal ... Germany") is not evidence of direction; it is the coin
 *     flip that produced the original defect, just with a different bias.
 *
 * @param {unknown} text
 * @param {{entries: object[]}} compiled
 * @returns {{sourceCountry:string|null, destinationCountry:string|null,
 *            mentionedCountries:string[], reason:string}}
 *   `reason` is a short machine-readable token describing HOW the answer was
 *   reached (or why it could not be), for the audit trail and for the flag a
 *   caller raises when the countries could not be determined.
 */
export function resolveSourceAndDestination(text, compiled) {
  const mentions = findCountryMentions(text, compiled);
  const mentionedCountries = distinctCountryCodes(mentions);
  const cuedSource = firstCodeWithCue(mentions, "source");
  const cuedDestination = firstCodeWithCue(mentions, "destination");

  const answer = (sourceCountry, destinationCountry, reason) => ({
    sourceCountry,
    destinationCountry,
    mentionedCountries,
    reason,
  });

  if (cuedSource && cuedDestination) {
    if (cuedSource === cuedDestination) {
      // "from Germany to Germany" — one of the two cues is describing something
      // that is not the route. Nothing here is safe to report.
      return answer(null, null, "conflicting_directional_cues");
    }
    return answer(cuedSource, cuedDestination, "directional_cues");
  }

  if (cuedDestination || cuedSource) {
    const cued = cuedDestination ?? cuedSource;
    const others = mentionedCountries.filter((c) => c !== cued);
    if (others.length === 1) {
      return cuedDestination
        ? answer(others[0], cuedDestination, "destination_cued_single_other_country")
        : answer(cuedSource, others[0], "source_cued_single_other_country");
    }
    if (others.length === 0) {
      return cuedDestination
        ? answer(null, cuedDestination, "destination_cued_only")
        : answer(cuedSource, null, "source_cued_only");
    }
    // Three or more countries with one cue: the cued slot is still evidence,
    // the other is a guess between candidates. Fill the first, refuse the second.
    return cuedDestination
      ? answer(null, cuedDestination, "destination_cued_other_ambiguous")
      : answer(cuedSource, null, "source_cued_other_ambiguous");
  }

  return answer(null, null, mentionedCountries.length ? "no_directional_cue" : "no_country_named");
}

/**
 * Resolve a SINGLE destination country — UC-03's shape, which has one slot
 * (where is the employee going?) rather than a pair.
 *
 * Why this is not just `resolveSourceAndDestination().destinationCountry`: in a
 * travel/workation inquiry "from" usually marks the DESTINATION, not the origin
 * ("I'd like to work from Portugal for a month"), because the origin is already
 * known — it is the country on the employment record, never something the
 * ticket has to state. So a "from" cue is not read as a source here.
 *
 *  1. Exactly one "to"/"into"-cued country → that one ("travelling from Spain
 *     to Germany" → DE, which insertion order got backwards).
 *  2. No such cue but exactly one country named anywhere → that one ("work
 *     remotely from Portugal" → PT).
 *  3. Otherwise → null. Two countries with no explicit destination cue is a
 *     genuine ambiguity, and UC-03's policy engine already handles a null
 *     destination properly: it escalates with `destination_unknown` rather than
 *     routing on a guess.
 *
 * @param {unknown} text
 * @param {{entries: object[]}} compiled
 * @returns {{destinationCountry:string|null, mentionedCountries:string[], reason:string}}
 */
export function resolveDestinationCountry(text, compiled) {
  const mentions = findCountryMentions(text, compiled);
  const mentionedCountries = distinctCountryCodes(mentions);
  const cued = distinctCountryCodes(mentions.filter((m) => m.cue === "destination"));

  if (cued.length === 1) return { destinationCountry: cued[0], mentionedCountries, reason: "destination_cued" };
  if (cued.length > 1) return { destinationCountry: null, mentionedCountries, reason: "multiple_destinations_cued" };
  if (mentionedCountries.length === 1) {
    return { destinationCountry: mentionedCountries[0], mentionedCountries, reason: "single_country_named" };
  }
  return {
    destinationCountry: null,
    mentionedCountries,
    reason: mentionedCountries.length ? "multiple_countries_no_cue" : "no_country_named",
  };
}
