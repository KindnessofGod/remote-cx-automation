// ---------------------------------------------------------------------------
// html.js — escapeHtml(), once, for every renderer that builds HTML by hand
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS. `src/uc01/letter.js` has routed every interpolated
// value through a private `escapeHtml()` since it was written; `src/uc03/
// letter.js` — the travel/visa support letter — interpolated raw for its whole
// life. Two renderers producing customer-facing HTML from the same employment
// record, one of them escaping and one of them not, is not a difference anybody
// decided on. It is drift, and this repository has paid for the same shape
// three times already (CONTRACT_LABELS in three files, the treaty retriever in
// two, the gates in two).
//
// WHY IT MATTERS ON UC-03 SPECIFICALLY, AND WHY IT LANDS BEFORE THE FIELD THAT
// NEEDS IT. Nothing reachable today puts attacker-controlled text into that
// letter: every value comes from a Remote read or from a 249-entry country
// registry. But the standard travel letter is now ISSUED WITH NOBODY IN THE
// PATH — no specialist reads the document between the gates and the consulate —
// and `docs/TRAVEL-LETTER-INPUTS.md` §6.3/§7 proposes putting the employee's
// own words (a named embassy or consulate) on it, naming this escaping gap as
// the FIRST of three preconditions. So this is a precondition, not an exploit
// report, and it is deliberately its own change so the ordering is visible in
// the history rather than buried inside the feature that depends on it.
//
// WHY UC-01 STILL HOLDS ITS OWN COPY, WHICH IS A KNOWN AND TEMPORARY WRONG.
// The right end state is `src/uc01/letter.js` importing this module and its
// private copy being deleted — the same move `src/shared/contractTypes.js` made
// for the three contract-label maps. It was not done in the pass that created
// this file because that file was outside the pass's ownership and its n8n port
// (`workflows/nodes/renderLetter.js`, which mirrors it line for line) was being
// edited concurrently. Two copies with a stated migration are recoverable; a
// half-applied edit across a file and its live-deployed port is not. The same
// applies to the ad-hoc copies in `src/metrics/dashboard.js`,
// `src/simulator/report.js`, `src/approvalqueue/handoffDirections.js` and
// `src/portal/server.js`.
//
// SCOPE — this escapes TEXT for an element body or a double-quoted attribute
// value. It is not a URL escaper, not a JS-string escaper and not a CSS
// escaper; do not use it to build a `href`, a `<script>` body or a `style`
// value from untrusted input, because escaping the five characters below does
// not make `javascript:` safe in an href.
// ---------------------------------------------------------------------------

/**
 * Escape text for interpolation into HTML.
 *
 * `null`/`undefined` become the EMPTY STRING rather than "null"/"undefined",
 * which is load-bearing rather than tidy: `src/uc01/policyEngine.js` and
 * `workflows/nodes/gates.js` both already rely on it so that a record with no
 * start date renders an empty cell instead of printing the word "null" onto a
 * document a third party reads.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
