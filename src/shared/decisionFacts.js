// ---------------------------------------------------------------------------
// decisionFacts.js  —  The figures a decision was MADE FROM, ranked, with the
//                      unavailable ones stated as unavailable.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `docs/CORRECTIONS-LOG.md` C-27. A Finance Ops specialist was told an expense
// was "above the policy cap" and could not see the amount, the cap, the overage
// or the percentage — every one of which the gate was holding at the instant it
// refused. The sentence was TRUE, which is exactly why no assertion caught it,
// and it named the pattern the log did not have: **P7, said less than it knew**.
//
// C-22 is the same defect one layer earlier: the surface printed the reason slug
// `over_category_cap`, correct and meaningless to the person waiting on the
// money. `gateLadder.js` closed that half by giving every reason a `means`
// sentence. This file closes the other half: `means` says WHAT HAPPENED, and a
// fact list says WHAT IT HAPPENED TO — the numbers, ids, codes and dates the
// reviewer would otherwise go and look up.
//
// THE TEST EVERY FACT HAS TO PASS is the owner's own: **"…and then what?"** If
// the reader must go somewhere else to act on what they were shown, the surface
// is incomplete. A duplicate flag with no pointer to the original fails it. A
// currency mismatch naming neither currency fails it. A confidence threshold
// with no confidence value fails it. An identity refusal that does not say which
// signal was missing fails it.
//
// THREE RULES, and the third is the one that is easy to get backwards.
//
// 1. NEVER INVENT, NEVER DEFAULT. A figure that is not available is an explicit
//    unknown carrying WHY it is unknown — never 0, never "—", never an empty
//    string that reads like a measurement. `unknownFact()` exists so that
//    stating "we do not have this" is as cheap as stating a value, because the
//    moment it is more expensive somebody will default it instead. A defaulted
//    value that looks like a measurement is the worst outcome available: the
//    reviewer acts on it.
//
// 2. RANK, DO NOT DUMP. Forty fields fails the same way a bare slug does, by
//    making the reviewer find the decisive fact themselves. The list is ordered
//    most-decisive first, and it is short — the fields the gate actually
//    compared, not the record it read them off.
//
// 3. DESCRIBE WHAT HAPPENED, NEVER MORE (P9, C-31). A fact list is an
//    opportunity to assert things that are not true: "routed to", "handed off",
//    "queued for". Every sentence here must be true of what the system ACTUALLY
//    did. Where a fact is about something the system did NOT do, it says so as a
//    literal rather than leaving it to be inferred from an absence.
//
// PURE, AND IT DECIDES NOTHING. Like `gateLadder.js`'s two functions, everything
// here describes a decision already made. No gate reads any of it, and no
// function in this file takes a client, a store or a logger — so it is
// structurally incapable of changing an outcome.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DecisionFact
 * @property {string} label   what this figure IS, in a person's words
 * @property {string|null} value  the figure itself, already formatted for
 *   reading. `null` means unavailable — never a placeholder, never a zero.
 * @property {boolean} known  false when `value` is null. Explicit so a renderer
 *   styles an unknown differently rather than having to test for null and
 *   guess whether that was intentional.
 * @property {string} [note]  what qualifies the figure, or — when it is unknown
 *   — WHY it is unknown and where it can be got. An unknown with no note is a
 *   shrug; an unknown with a note is a next step.
 */

/**
 * A figure that IS available.
 *
 * `value` is stringified rather than passed through, because every consumer
 * renders it as text and a raw `0` is falsy in exactly the templates that then
 * silently print nothing. `0` and `"0"` are legitimate values here and must
 * survive; only `null`/`undefined` mean "no figure", and those route to
 * `unknownFact()` instead — passing one here is a caller bug, so it is turned
 * into a visible unknown rather than the string "null".
 *
 * @param {string} label
 * @param {string|number|null|undefined} value
 * @param {string} [note]
 * @returns {DecisionFact}
 */
export function fact(label, value, note) {
  if (value === null || value === undefined || value === "") {
    return unknownFact(label, note ?? "This figure was not available on this run, and is not defaulted to a value that would read as a measurement.");
  }
  return { label, value: String(value), known: true, ...(note ? { note } : {}) };
}

/**
 * A figure that is NOT available, and the reason it is not.
 *
 * The `note` is required by convention rather than by signature — a caller with
 * nothing to say about why should not be emitting the fact at all. Compare
 * `src/portal/server.js`'s cumulative-days line, which prints its number AND
 * says it is a floor rather than a count, because a 0 there means "unknown" and
 * never "confirmed none".
 *
 * @param {string} label
 * @param {string} [note]
 * @returns {DecisionFact}
 */
export function unknownFact(label, note = "Not available.") {
  return { label, value: null, known: false, note };
}

/**
 * Drop the facts a caller decided not to emit, keeping order.
 *
 * Callers build their list with conditional entries (`cond ? fact(...) : null`)
 * because that reads as the gate reads; this is the one place the nulls are
 * removed, so no caller grows its own filter and no renderer has to tolerate a
 * hole in the array.
 *
 * @param {Array<DecisionFact|null|undefined|false>} entries
 * @returns {DecisionFact[]}
 */
export function facts(entries) {
  return entries.filter(Boolean);
}

/**
 * Bundle one decision's facts with the sentence that leads them.
 *
 * `sentence` is the one line a reader gets if they read nothing else, so it
 * carries the decisive figures inline. The list below it carries the rest, in
 * order. `reason` is echoed so a consumer holding only this object can still
 * name the slug — the audit vocabulary is never replaced by prose, only joined
 * by it.
 *
 * @param {string} reason
 * @param {string} sentence
 * @param {Array<DecisionFact|null|undefined|false>} entries
 */
export function decisionFacts(reason, sentence, entries) {
  return { reason, sentence, facts: facts(entries) };
}

/**
 * Render a fact bundle as one line of plain text, for a Zendesk internal note.
 *
 * Zendesk notes are where a specialist actually meets these decisions, and they
 * are text — so the same data that renders as a panel elsewhere has to survive
 * as a sentence here. Unknowns are printed as `label: not available (why)`
 * rather than omitted: a silently absent row is indistinguishable from a figure
 * nobody thought to include, which is how the missing four numbers survived.
 *
 * @param {{sentence:string, facts:DecisionFact[]}|null} bundle
 * @returns {string} "" when there is nothing to say, so callers can concatenate
 *   unconditionally.
 */
export function formatFactsForNote(bundle) {
  if (!bundle) return "";
  const rows = bundle.facts.map((f) =>
    f.known
      ? `${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""}`
      : `${f.label}: NOT AVAILABLE${f.note ? ` — ${f.note}` : ""}`
  );
  return ` ${bundle.sentence}${rows.length ? ` [${rows.join(" | ")}]` : ""}`;
}
