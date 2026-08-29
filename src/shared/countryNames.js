// ---------------------------------------------------------------------------
// countryNames.js — the country's NAME, for every surface a person reads
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, AND WHY IT IS NOT `countryCodes.js`
//
// `src/shared/countryCodes.js` normalises and compares codes: it is what the
// gates use, and every rule in this repository is a `Set.has()` over ISO alpha-2
// because a code is unambiguous and a name is not. That stays exactly as it is.
//
// This module is the other direction, and it exists because the project owner
// looked at a decision panel and a Zendesk sidebar and said: "instead of using
// country codes like PT, use the country's full name — you can use codes inside
// the code, not on the UI."
//
// They are right, and it is not only a readability point. A code on screen asks
// the reader to be fluent in ISO 3166-1: `PT` is Portugal, but `PT` is also what
// a hurried reader takes for "part-time", and every one of `NL`/`NO`/`NE` and
// `CA`/`CH`/`CN` is one glance from another country. A specialist deciding
// whether someone may enter a jurisdiction should never be doing that decoding,
// and a requester certainly should not.
//
// THE DIVISION THIS FILE ENFORCES:
//   * codes decide      — gates, tables, sets, audit rows, API payloads
//   * names are read    — every string a human sees
//
// So a surface calls `countryName(code)` at the point of rendering and nowhere
// else. Nothing here is ever compared, and nothing here is ever written into a
// record: a name in a stored field is the alpha-3 defect one alphabet over, and
// it has already cost this repository an 80-day stay that vanished because
// "Netherlands" reached a comparison that only two-letter codes can win.
//
// THE DATA IS NOT A SECOND LIST. It is derived from `src/portal/countries.js`,
// which is generated from CLDR through Node's own ICU and is already the source
// the portal's pickers render. Deriving rather than copying is the whole point:
// two hand-maintained country lists drift, and the drift is invisible until a
// picker offers a country a renderer cannot name.
// ---------------------------------------------------------------------------

import { PORTAL_COUNTRIES } from "../portal/countries.js";
import { normalizeCountryCode, isWellFormedCountryCode } from "./countryCodes.js";

/** @type {Map<string, string>} alpha-2 -> English name, built once. */
const NAMES = new Map(PORTAL_COUNTRIES.map((c) => [c.code, c.name]));

/**
 * The country's name for display, or `null` when there is no name to give.
 *
 * NULL RATHER THAN THE CODE, deliberately. A caller that falls back to the code
 * has decided the reader can cope with a code, and that is a decision for the
 * surface — `countryLabel()` below is the one that makes it. Returning the code
 * silently from here would make an unnameable country indistinguishable from a
 * named one at every call site at once.
 *
 * @param {unknown} code  ISO 3166-1 alpha-2, in any case, with any surrounding space
 * @returns {string|null}
 */
export function countryName(code) {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return null;
  return NAMES.get(normalized) ?? null;
}

/**
 * What a surface should print: the name when there is one, the code when there
 * is not, and an explicit fallback when there is neither.
 *
 * WHY THE CODE SURVIVES AS A FALLBACK. A code this list cannot name is either a
 * user-assigned code (`XK` for Kosovo is the live example) or a defect — and
 * either way the reader is better served by seeing `XK` than by seeing a blank
 * or the word "unknown", because the code is the thing they can go and look up
 * or quote to somebody. What must never happen is a name being invented for it.
 *
 * @param {unknown} code
 * @param {string} [absent]  what to print when there is no code at all
 * @returns {string}
 */
export function countryLabel(code, absent = "not stated") {
  if (typeof code !== "string" || code.trim() === "") return absent;
  const normalized = normalizeCountryCode(code);

  // ONLY A CODE-SHAPED VALUE IS TREATED AS A CODE, and this cost a real defect
  // the day this module was written. `normalizeCountryCode()` upper-cases
  // whatever it is given, so the first version of this function answered
  // `countryLabel("Portugal")` with **"PORTUGAL"** — a country's name shouted
  // back at the reader — and `countryLabel("PRT")` with "PRT". Both look like
  // deliberate output. Neither is.
  //
  // It matters because not every caller holds a code. Some server fields
  // already carry a name, some carry prose, and a display helper is exactly
  // where those meet. A fallback that returns something PLAUSIBLE rather than
  // refusing is the shape this repository keeps paying for: it was the NaN that
  // cleared an overstay, and the "NETHERLANDS" that matched nothing and
  // reported COUNTED.
  //
  // So anything that is not two letters is returned as the caller gave it,
  // trimmed and otherwise untouched — a name stays a name, prose stays prose,
  // and an alpha-3 stays visibly an alpha-3 instead of being dressed up as a
  // rendered value. This function never invents and never re-cases.
  if (!isWellFormedCountryCode(normalized)) return code.trim();
  return NAMES.get(normalized) ?? normalized;
}

/**
 * Name and code together — `"Portugal (PT)"` — for the one place both belong:
 * a reference line somebody may have to quote back to a consulate or paste into
 * another system. Not for prose, where the parenthesis is noise.
 *
 * @param {unknown} code
 * @param {string} [absent]
 * @returns {string}
 */
export function countryNameAndCode(code, absent = "not stated") {
  if (typeof code !== "string" || code.trim() === "") return absent;
  const normalized = normalizeCountryCode(code);
  // Same rule as countryLabel(): a value that is not code-shaped is not a code,
  // and pairing a name with itself ("Portugal (PORTUGAL)") would be worse than
  // either half alone.
  if (!isWellFormedCountryCode(normalized)) return code.trim();
  const name = NAMES.get(normalized);
  return name ? `${name} (${normalized})` : normalized;
}

/** Every code this module can name — for tests, and for a picker that must not
 *  offer a country nothing can render. */
export function nameableCountryCodes() {
  return [...NAMES.keys()];
}
