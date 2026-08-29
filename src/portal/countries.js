// ---------------------------------------------------------------------------
// countries.js  —  the list behind every country picker on the portal
// ---------------------------------------------------------------------------
// WHY A PICKER EXISTS AT ALL, AND WHY THIS FILE IS THE ANSWER TO A BUG CLASS
//
// Eight boxes on this portal used to take a country as FREE TEXT. That is the
// entry point for the single most expensive recurring defect in this
// repository, and the record of it is not short:
//
//   * UC-03's supported-countries gate compared two-letter destinations
//     against a list mapped from `code`, which is the ALPHA-3 form. `ES` never
//     matched `ESP`, so `supportedCountries` came back empty after a
//     *successful* 224-row fetch and the use case could not auto-resolve at
//     all. It was invisible for weeks, because a use case that structurally
//     cannot succeed and one that is appropriately refusing look identical
//     from outside (CLAUDE.md §5, finding F-27).
//   * `normalizeEmployment()` carried the same latent alpha-3 fallback.
//   * `"us"` in lower case walked straight past UC-04's US and Canada
//     work-permit hard blocks, because every rule is a case-sensitive
//     `Set.has()` (finding F-13; the fix is src/shared/countryCodes.js).
//   * And no two of these failures look alike from the API side: the form-
//     schema endpoint answers `404 "Country not found"` for a wrong-alphabet
//     code while the expense-categories endpoint answers
//     `422 {"country_code":["is invalid"]}` for the same underlying mistake.
//
// Every one of those is a WRONG CODE REACHING A COMPARISON. A picker whose
// value is the code and whose label is the country's name removes the failure
// at the source: there is no longer a keystroke between a person's intent and
// the string the gates compare.
//
// WHAT SHAPE THE VALUES ARE — ALPHA-2, and it was checked per field, not
// assumed. Every consumer of every country box on this portal compares
// alpha-2: src/uc03/policyEngine.js's `SANCTIONED_OR_RESTRICTED` (which
// src/uc04 imports rather than copies), src/uc04/riskMatrix.js's `SCHENGEN`,
// `DNV_COUNTRIES`, `CURATED_SCOPE` and `KNOWN_DESTINATIONS`, and
// src/uc08/presenceCalculator.js, which is code-agnostic but must agree with
// the target country beside it. The ALPHA-3 form is what Remote's own API
// wants on a path (`GET /v1/countries/{PRT}/{form}`) and what its `code` field
// carries — it is deliberately NOT in this file, because nothing on this
// portal submits one and a column nothing reads is a column the first reader
// gets wrong. `RemoteClient` does that conversion at its own boundary.
//
// WHY 249 ROWS AND NOT REMOTE'S 224
// `GET /v1/countries` returns 224 rows and this picker could have been built
// from them — the portal already reads that endpoint through the in-process
// mock. It would have been wrong in a way that hides a real behaviour:
//
//   1. REMOTE'S REGISTRY OMITS THE SANCTIONED SET. Its stated membership rule
//      is "the countries present in the list are the ones where creating a
//      company is allowed", and the 26 alpha-2 codes it leaves out are the
//      sanctions/embargo set plus uninhabited and dependent territories —
//      AF, IQ and RU among them, verified live 2026-08-17
//      (docs/knowledge/layer-2-remote/L2-02-countries-registry.md,
//      docs/research/COUNTRY-SUPPORT-SEMANTICS.md §4.2). Sourcing the picker
//      from that list would make `blocked / sanctioned_region` — a hard block
//      this system is judged on, and the loudest refusal it can produce —
//      literally unreachable from the form that is supposed to demonstrate it.
//      A control nobody can trigger is a control nobody can check.
//   2. THE MOCK'S OWN FIXTURE IS 21 ROWS, an "illustrative subset" that has no
//      Canada in it — one of the four demo countries — and no Iran.
//   3. NARROWING TO WHAT UC-04's MATRIX KNOWS WOULD BE WORSE STILL.
//      `KNOWN_DESTINATIONS` is bounded on purpose and everything outside it is
//      UNEVALUATED, NOT CLEARED — the request escalates to a mobility
//      specialist rather than being approved or refused by a rule nobody
//      wrote. Offering only evaluable destinations would delete that path from
//      the demonstration while leaving it in the code. Offering a country the
//      matrix has no rules for, and letting it escalate honestly, shows the
//      system doing the more difficult and more interesting thing.
//
// So the picker offers the world, and the gates decide. Which is the
// architecture's own claim, made clickable.
//
// PROVENANCE — THIS IS DATA, DERIVED, NOT COMPOSED
// The rows below are the 249 officially assigned ISO 3166-1 alpha-2 codes with
// their English display names, taken from the Unicode CLDR data that ships
// inside Node's own ICU (`Intl.DisplayNames`) — not typed out from memory, and
// not copied from Remote. Remote's registry is explicitly not ours to
// republish as a standalone dataset (docs/KNOWLEDGE-SOURCES.md, L2-02), and
// this file is not that list: it is the ISO standard's code space, which is
// the superset the registry is a selection from.
//
// Generated on 2026-08-19 with Node v22.22.2 / ICU 78.2 / CLDR 48.0, by:
//
//   node -e '
//     const dn = new Intl.DisplayNames(["en"], {type: "region"});
//     const NOT_ISO = new Set(["AC","CP","DG","EA","EU","EZ","IC","QO","TA",
//                              "UN","XA","XB","ZZ","CQ","XK"]);
//     const rows = [];
//     for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
//       const c = String.fromCharCode(a) + String.fromCharCode(b);
//       if (NOT_ISO.has(c)) continue;
//       let n; try { n = dn.of(c); } catch { continue; }
//       if (!n || n === c) continue;
//       // ICU also answers for WITHDRAWN codes (DD -> "Germany", AN, SU, UK,
//       // YU, ZR and eleven more). Canonicalisation rewrites each to its
//       // successor, so a code that does not canonicalise to itself is a
//       // historical alias and is dropped — without this the list is 267 rows
//       // with duplicate names, i.e. two options both reading "Germany".
//       if (Intl.getCanonicalLocales("und-" + c)[0] !== "und-" + c) continue;
//       rows.push({code: c, name: n});
//     }
//     rows.sort((x, y) => x.name.localeCompare(y.name, "en"));
//   '
//
// The 15 `NOT_ISO` codes are ICU regions that are not ISO 3166-1 country
// assignments: the exceptionally reserved ones (AC, CP, DG, EA, IC, TA, CQ),
// the groupings (EU, EZ, QO, UN), the test placeholders (XA, XB, ZZ) and the
// user-assigned XK (Kosovo, which ISO has not assigned).
//
// Names are LABELS ONLY — nothing compares them, ever. If a future ICU renames
// a country the picker's wording changes and not one decision does, because
// every comparison in this repository is on `code`.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PortalCountry
 * @property {string} code  ISO 3166-1 alpha-2, upper case — the value submitted
 * @property {string} name  English display name — the label a person reads
 */

/**
 * The four countries every use case's demo scenarios were actually run against
 * (docs/DEMO-COUNTRIES.md, run 2026-08-19 against the live Sandbox). They are
 * offered at the TOP of every picker as well as in their alphabetical place,
 * because a person demonstrating this system reaches for them a hundred times
 * and should not scroll to "N" for the Netherlands each time.
 *
 * This is a CONVENIENCE ORDERING AND NOTHING ELSE. No gate reads it, no
 * country is excluded by not being in it, and a destination picked from the
 * long list behaves identically to the same destination picked from the short
 * one. Sorted the way the demo document lists them, not alphabetically.
 * @type {string[]}
 */
export const DEMO_COUNTRY_CODES = ["NL", "PT", "CA", "US"];

/** @type {PortalCountry[]} */
export const PORTAL_COUNTRIES = [
  { code: "AF", name: "Afghanistan" },
  { code: "AX", name: "Åland Islands" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AS", name: "American Samoa" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AI", name: "Anguilla" },
  { code: "AQ", name: "Antarctica" },
  { code: "AG", name: "Antigua & Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AW", name: "Aruba" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BM", name: "Bermuda" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia & Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BV", name: "Bouvet Island" },
  { code: "BR", name: "Brazil" },
  { code: "IO", name: "British Indian Ocean Territory" },
  { code: "VG", name: "British Virgin Islands" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CV", name: "Cape Verde" },
  { code: "BQ", name: "Caribbean Netherlands" },
  { code: "KY", name: "Cayman Islands" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CX", name: "Christmas Island" },
  { code: "CC", name: "Cocos (Keeling) Islands" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo - Brazzaville" },
  { code: "CD", name: "Congo - Kinshasa" },
  { code: "CK", name: "Cook Islands" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d’Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CW", name: "Curaçao" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FK", name: "Falkland Islands" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GF", name: "French Guiana" },
  { code: "PF", name: "French Polynesia" },
  { code: "TF", name: "French Southern Territories" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GU", name: "Guam" },
  { code: "GT", name: "Guatemala" },
  { code: "GG", name: "Guernsey" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HM", name: "Heard & McDonald Islands" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong SAR China" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IM", name: "Isle of Man" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JE", name: "Jersey" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macao SAR China" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MQ", name: "Martinique" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "YT", name: "Mayotte" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MS", name: "Montserrat" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar (Burma)" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NC", name: "New Caledonia" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "NU", name: "Niue" },
  { code: "NF", name: "Norfolk Island" },
  { code: "KP", name: "North Korea" },
  { code: "MK", name: "North Macedonia" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestinian Territories" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PN", name: "Pitcairn Islands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "QA", name: "Qatar" },
  { code: "RE", name: "Réunion" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "São Tomé & Príncipe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SX", name: "Sint Maarten" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "GS", name: "South Georgia & South Sandwich Islands" },
  { code: "KR", name: "South Korea" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "BL", name: "St. Barthélemy" },
  { code: "SH", name: "St. Helena" },
  { code: "KN", name: "St. Kitts & Nevis" },
  { code: "LC", name: "St. Lucia" },
  { code: "MF", name: "St. Martin" },
  { code: "PM", name: "St. Pierre & Miquelon" },
  { code: "VC", name: "St. Vincent & Grenadines" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SJ", name: "Svalbard & Jan Mayen" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TK", name: "Tokelau" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad & Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Türkiye" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TC", name: "Turks & Caicos Islands" },
  { code: "TV", name: "Tuvalu" },
  { code: "UM", name: "U.S. Outlying Islands" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "WF", name: "Wallis & Futuna" },
  { code: "EH", name: "Western Sahara" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },];
