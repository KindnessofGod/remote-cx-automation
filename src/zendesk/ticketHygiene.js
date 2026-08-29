// ---------------------------------------------------------------------------
// ticketHygiene.js — refuse to write harness vocabulary into a live ticket's
// subject OR tags
// ---------------------------------------------------------------------------
// WHY THIS EXISTS. rca-mk6n / finding N-2
// (qa/orchestration/PERSONA-ISOLATION-REREVIEW-2-2026-08-23.md): the live
// Zendesk queue used to prove the UC-01 personas' isolation held real ticket
// subjects seeded with bead ids and criterion ids —
// "#70 rca-1bk VC-11 live proof — out of scope (2)". A persona reading that
// queue on its OWN authorised surface is told, by the product, that it is
// inside a test harness and which criteria a given ticket exists to prove —
// exactly the fact its own isolation prohibits it from holding, delivered
// through the one surface no sandbox/bead/mail/transcript control can seal.
//
// rca-1qju found the SAME DEFECT ONE FIELD OVER: this file originally only
// guarded `subject` (as subjectHygiene.js), and its own header claimed that
// was "the one place every ticket write in this repo passes through" — false
// as written, because ZendeskClient's TAG-writing calls
// (createTicket's fields.tags, updateTicket's ticketPatch.tags/additional_tags,
// flagForReview's tags/additionalTags) never ran through it. Ticket #72 in the
// live your-subdomain queue carried tag "rca-c73-vc-blocked-proof" — a bead id, in
// a tag, on the exact surface this file exists to seal. Renamed from
// subjectHygiene.js and widened rather than duplicated: two copies of a
// hygiene rule drift, and this bead exists because the first copy only ever
// covered one field.
//
// The audit that measures leaks afterwards cannot fix this: the ingress test
// correctly clears these hits as `own`, because they DID arrive through the
// persona's own authorised surface. The fix has to be upstream of the audit:
// never write the vocabulary into a subject OR a tag in the first place. This
// file is that fix, and ZendeskClient#request (restClient.js) is now the one
// choke point every ticket write actually passes through — subject, tags and
// additional_tags are all checked there, on every create/update/reply/resolve/
// flag call, because they all end in a `{ticket: {...}}` body over #request.
//
// Deliberately narrow, same as before: this does NOT touch
// persona-leak-audit.mjs's term lists or ingress classification (rca-mk6n:
// "Do NOT treat this as closed by any change to the sandbox sealing or the
// term lists"), and it does not scan ticket bodies or comments — only the
// subject and the tags a write actually sets, because those are what a queue
// listing shows without opening the ticket.
//
// `remove_tags` is deliberately NOT checked: it only NAMES a tag being taken
// OFF the ticket, so a harness-vocabulary string there is never written INTO
// the live ticket — checking it would refuse the very call that cleans one up.
// ---------------------------------------------------------------------------

// A subject is prose and a tag is `snake_or-kebab`, so the SAME harness term
// arrives spelled differently on the two fields this file guards: "VC-33" in a
// subject is "vc_33" in a tag, "live proof" is "live_proof". These patterns
// therefore write every internal separator as SEP and every boundary as B/EB
// rather than as a literal `-`, a literal space, or `\b`. See the method note
// below for what happens when they don't — it is how this bead's first two
// sweeps each returned a confident, wrong zero.
const SEP = "[-_\\s]"; // the separators a term may be spelled with
// `\b` is the wrong boundary here: `_` is a word character to JS, so `\bVC`
// never matches the "vc" in "uc01_vc_33" and `\d+\b` never matches the "33" in
// "vc_33_proof". These say "not adjacent to an alphanumeric" instead, which
// makes `_`, `-`, whitespace and the string edges all boundaries.
const B = "(?<![a-z0-9])";
const EB = "(?![a-z0-9])";
const rx = (source) => new RegExp(source, "i");

const HARNESS_PATTERNS = [
  // Internal issue ids from this project's own tracker (rca-*, VC-*, F-*).
  { name: "bead id", pattern: rx(`${B}rca${SEP}[a-z0-9]{3,4}${EB}`) },
  // Acceptance-contract criterion ids: VC-11, VC-33, ...
  { name: "criterion id", pattern: rx(`${B}VC${SEP}\\d+${EB}`) },
  // Review-finding ids, only in the shapes actually observed — "F-7 proof",
  // "(F-11)" — not bare "F-\d+", which collides with real content this
  // project's own domain produces (an F-1 student visa, for one).
  { name: "finding id", pattern: rx(`${B}F${SEP}\\d+${SEP}*proof${EB}`) },
  { name: "finding id", pattern: rx(`\\(F${SEP}\\d+\\)`) },
  { name: '"live proof"', pattern: rx(`${B}live${SEP}proof${EB}`) },
  { name: '"re-eval"', pattern: rx(`${B}re${SEP}eval${EB}`) },
];

// >>> METHOD NOTE — rca-1qju's own warning, and the reason the patterns above
// are written the way they are. This bead was nearly closed TWICE on a
// confident, wrong zero, in opposite directions, and neither was visible from
// inside its own result:
//
//   * The mayor's first sweep normalised `[-_]` to spaces BEFORE matching.
//     That turns "rca-1bk-vc11-proof" into "rca 1bk vc11 proof", which a
//     `rca-` pattern does not match. It reported 0 tag leaks and was wrong.
//   * The first fix for that reported it RAW instead, against `\b`-bounded
//     patterns spelled with literal hyphens and spaces. That catches
//     "rca-c73-vc-blocked-proof" and misses "uc01_live_proof" and
//     "vc_33_proof" — the mirror-image hole, and just as quiet.
//
// The lesson is NOT "test it both ways and OR the results" — that is two
// half-detectors, and this file exists because a hygiene rule kept in two
// places drifts. It is that a separator is not a boundary and must not be
// written as a literal. One separator-agnostic pattern set, one pass, and
// every spelling of a term is one thing again.
//
// So: do not "simplify" SEP/B/EB back to `-`, ` ` and `\b`, and do not
// pre-normalise text before calling findHarnessVocabulary(). Either change
// silently halves the detector, and a false zero from it is indistinguishable
// from a clean queue — which is the whole failure mode this bead closes.
// scripts/verify-ticket-hygiene.mjs negative-controls all of this before it
// believes any sweep; run it rather than trusting a reading of this file.

/**
 * @param {string} text  a subject or a single tag, passed RAW — never
 *   pre-normalise its separators first. The patterns already read `-`, `_` and
 *   whitespace as the same thing; normalising on the way in only destroys the
 *   spellings they were widened to catch. See the method note above.
 * @returns {{name: string, term: string}|null} the first harness term found,
 *   spelled as it appears in `text`, or null if clean
 */
export function findHarnessVocabulary(text) {
  if (!text) return null;
  for (const { name, pattern } of HARNESS_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { name, term: match[0] };
  }
  return null;
}

/**
 * @param {string[]|undefined} tags
 * @returns {{name: string, term: string, tag: string}|null} the first harness
 *   term found in any tag, or null if every tag is clean
 */
export function findHarnessVocabularyInTags(tags) {
  if (!tags || !tags.length) return null;
  for (const tag of tags) {
    const hit = findHarnessVocabulary(tag);
    if (hit) return { ...hit, tag };
  }
  return null;
}

/**
 * Throws if `subject` carries harness vocabulary — a bead id, a criterion or
 * finding id, or a testing-round phrase.
 * @param {string} subject
 */
export function assertNoHarnessVocabulary(subject) {
  const hit = findHarnessVocabulary(subject);
  if (hit) {
    throw new Error(
      `refusing to write a ticket whose subject carries harness vocabulary (${hit.name} "${hit.term}"): ` +
        `"${subject}" — see rca-mk6n / finding N-2. A ticket subject in the live queue is read by personas ` +
        `on their own authorised surface, unfiltered by any isolation control. Write a subject a person would ` +
        `actually type, and keep any bead/criterion reference out of Zendesk entirely — a script-local log line, ` +
        `not the ticket.`,
    );
  }
}

/**
 * Throws if any tag in `tags` carries harness vocabulary. Same reasoning as
 * assertNoHarnessVocabulary above, one field over — see rca-1qju.
 * @param {string[]|undefined} tags
 */
export function assertNoHarnessVocabularyInTags(tags) {
  const hit = findHarnessVocabularyInTags(tags);
  if (hit) {
    throw new Error(
      `refusing to write a ticket tag carrying harness vocabulary (${hit.name} "${hit.term}" in tag "${hit.tag}"): ` +
        `see rca-mk6n / finding N-2 and rca-1qju. A ticket tag in the live queue is read by personas on their own ` +
        `authorised surface, unfiltered by any isolation control. Keep any bead/criterion reference out of Zendesk ` +
        `entirely — a script-local log line, not the ticket.`,
    );
  }
}

/**
 * The single choke-point check: throws if a ticket write body's subject,
 * `tags`, or `additional_tags` carries harness vocabulary. Call this at the
 * one place every ticket write actually happens (ZendeskClient#request),
 * not at each call site that composes a fields/patch object.
 * @param {object|null|undefined} ticketBody  the inner `ticket` object of a
 *   Zendesk API request body — {subject, tags, additional_tags, ...}
 */
export function assertTicketBodyClean(ticketBody) {
  if (!ticketBody) return;
  assertNoHarnessVocabulary(ticketBody.subject);
  assertNoHarnessVocabularyInTags(ticketBody.tags);
  assertNoHarnessVocabularyInTags(ticketBody.additional_tags);
}
