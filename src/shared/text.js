// ---------------------------------------------------------------------------
// text.js  —  safe coercion for untrusted free text
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Eight separate classifiers and parsers across UC-01/03/05/07/08 opened with
// the same line:
//
//     const lower = (text || "").toLowerCase();
//
// which looks defensive and is not. `||` only rescues the FALSY cases — null,
// undefined, "". It passes a number, an object, an array or a boolean straight
// through to .toLowerCase(), which does not exist on any of them, so the whole
// request dies with "(text || "").toLowerCase is not a function".
//
// That is not a hypothetical input. Ticket bodies arrive from a Zendesk webhook
// as JSON assembled from placeholders; a numeric-looking description, a missing
// field that serialises as {}, or an array from a multi-value custom field all
// produce a non-string here. The brute-force simulator (src/simulator/) hit it
// on 89 of 10,000 interactions across four use cases — the single most common
// crash in the system, and always on the customer's very first request.
//
// Crashing is the worst available outcome: it happens BEFORE any audit row is
// written, so the request disappears with no record that it ever arrived and no
// human is told. Coercing instead means the request still reaches the gates,
// which then make a normal, logged, conservative decision about it.
// ---------------------------------------------------------------------------

/**
 * Coerce any value into a string safe to run text analysis over.
 *
 * Deliberately NOT `String(value)`: stringifying an object yields
 * "[object Object]" and an array yields comma-joined members, both of which are
 * meaningless text that a classifier would then confidently match keywords
 * against. Anything that is not already a string becomes "" — an empty request,
 * which every gate in this project already handles conservatively — except
 * numbers, which are legitimately meaningful when a customer types only a
 * reference number or an amount.
 *
 * @param {unknown} value
 * @returns {string} always a string, never throws
 */
export function asText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * The lowercased form of asText(), which is what every call site actually
 * wanted. Kept as its own export so the fix reads as one obvious token at each
 * site rather than a nested pair of calls.
 * @param {unknown} value
 * @returns {string}
 */
export function asLowerText(value) {
  return asText(value).toLowerCase();
}
