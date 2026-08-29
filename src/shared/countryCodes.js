// ---------------------------------------------------------------------------
// countryCodes.js  —  ONE place that normalises an ISO 3166-1 alpha-2 code
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Country codes arrive from four different directions — a Remote employment
// record, a Zendesk ticket field, an LLM extraction, and a hand-typed demo
// form — and only the first is guaranteed uppercase. Every compliance gate in
// this repo is a `Set.has(code)` or a `code === "US"`, both of which are
// case-sensitive, so an un-normalised `"us"` walks straight past a rule that
// `"US"` correctly enforces. That is not a cosmetic defect: on UC-04 it was a
// full bypass of the US and Canada work-permit hard blocks and of the Schengen
// 90/180 overstay block (simulator finding F-13 — `destination.country = "us"`
// reached `ready_for_approval` and a real PATCH while `"US"` was blocked).
//
// The fix has to live in ONE function that every consumer calls at its
// boundary, never a `.toUpperCase()` sprinkled at each comparison: a rule
// added later would silently be added without it, and the bypass would be
// back. Same reasoning as money.js — a global invariant belongs in the shared
// layer, applied once on the way in.
// ---------------------------------------------------------------------------

/**
 * Normalise anything that claims to be a country code into the canonical form
 * every set/comparison in this repo is written in: trimmed, upper-cased.
 * Non-strings (null, numbers, objects — all of which real hostile input
 * carries) normalise to "" rather than throwing, so a caller's gate sees an
 * unmistakably invalid value instead of a crash.
 * @param {unknown} value
 * @returns {string} canonical code, or "" when there is nothing usable
 */
export function normalizeCountryCode(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

/**
 * Is this a well-formed ISO 3166-1 alpha-2 code *shape*? Deliberately a shape
 * check, not a membership check against a country list — "is ZZ a real
 * country" is a different question from "is this two letters", and conflating
 * them is how a legitimate-but-unlisted country gets silently mishandled.
 * @param {unknown} value
 */
export function isWellFormedCountryCode(value) {
  return /^[A-Z]{2}$/.test(normalizeCountryCode(value));
}

/**
 * Normalise every member of a country-code Set (or any iterable of codes).
 * Used where the SET itself comes from outside — `remote.listCountries()`, a
 * caller-supplied sanctions list — so the lookup and the lookee are in the
 * same case, not just the lookup key.
 * @param {Iterable<unknown>|null|undefined} codes
 * @returns {Set<string>}
 */
export function normalizeCountrySet(codes) {
  const out = new Set();
  for (const c of codes ?? []) {
    const n = normalizeCountryCode(c);
    if (n) out.add(n);
  }
  return out;
}
