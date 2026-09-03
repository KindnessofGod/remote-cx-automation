// ---------------------------------------------------------------------------
// employerPresence.js  —  Does the customer have a company where the employee
//                         is going? (art. 15(2)(b), the limb nothing measured)
// ---------------------------------------------------------------------------
// THE HIGHEST-VALUE SINGLE TAX CHECK AVAILABLE TO THIS USE CASE, and the panel
// has been printing a caveat admitting its absence for weeks:
//
//   "The treaty day test is one of three cumulative conditions... Each article
//    reads (a) days AND (b) remuneration paid by an employer not resident in
//    the other state AND (c) remuneration not borne by a permanent
//    establishment there. This system has no representation of (b) or (c), so
//    a day count reported alone has answered one third of the question."
//
// That caveat renders under the 183-day measurement on every UC-04 case. This
// module answers the reachable half of it.
//
// THE QUESTION, IN THREE LETTERS. Call the employee's country of residence X,
// the customer's country Y, and the destination Z. Where Z is a genuine third
// country, limb (b) holds however the arrangement is structured — neither
// candidate employer is resident in the destination, which is the finding
// `docs/UC04-RESEARCH-FINDINGS.md` §12a establishes across Sweden, Germany and
// the Netherlands. Where **Z = Y** — the destination is a country the customer
// itself has a company in — limb (b) FAILS, and it fails on day one regardless
// of the day count. The treaty exemption is gone before the 183 days are
// reached, and the caveat's "one third of the question" becomes the whole of it.
//
// WHY THIS IS COMPUTABLE WHERE THE REST OF (b) IS NOT. It needs no register, no
// treaty text and no judgement: two country codes this system can already read.
// `GET /v1/companies/{id}/legal-entities` lists the CUSTOMER's entities with
// their countries, and the destination is on the request.
//
// WHAT IT IS NOT, AND THE MISREADING IT MUST NOT INVITE:
//
//   · It is NOT a finding about who employs the person. These are the client's
//     entities. Remote's own employing entity is exposed by no endpoint this
//     project has found, and reading one of these as "the employer" is the
//     defect recorded as K16 in qa/HUMAN-DECISIONS-REQUIRED.md — currently
//     shipping in three customer-facing letters.
//   · It is NOT a conclusion that tax is due. Limb (b) failing removes the
//     treaty exemption; whether anything is actually payable depends on
//     domestic law this system does not model. The finding says "the exemption
//     does not apply", never "tax is owed".
//   · It is NOT a gate. Every tax finding in UC-04 is a work order for a
//     specialist, never a refusal — the blocking set is immigration and data
//     quality only (§5). Nothing here raises a flag or moves a level, and
//     test/uc04EmployerPresence.test.js asserts no gate file imports it.
//
// AND IT FAILS TO UNKNOWN, LOUDLY. A read that did not happen must never render
// as "no entity there" — that is the reassuring answer, produced by a
// comparison that never ran, and it is F-27's exact shape one endpoint over.
// ---------------------------------------------------------------------------

import { normalizeCountryCode } from "../shared/countryCodes.js";
import { countryLabel } from "../shared/countryNames.js";

/** No company id on the record — nothing to look up. */
export const PRESENCE_NO_COMPANY = "no_company";
/** No Remote client wired in — a fact about the deployment. */
export const PRESENCE_NOT_LOOKED_UP = "not_looked_up";
/** The read failed. NEVER rendered as an absence of entities. */
export const PRESENCE_UNAVAILABLE = "unavailable";
/** Read, and the customer has an entity in the destination. Limb (b) fails. */
export const PRESENCE_IN_DESTINATION = "in_destination";
/** Read, and it does not. Limb (b) holds on this ground. */
export const PRESENCE_ELSEWHERE = "elsewhere";

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * @param {object} args
 * @param {object|null} args.remote
 * @param {string|null} args.companyId       employment.company_id
 * @param {string|null} args.destinationCountry  the CANONICAL code the gates judged
 * @returns {Promise<{state:string, destination:string|null,
 *   entityCountries:string[], matched:object[], finding:string}>}
 */
export async function readEmployerPresence({ remote, companyId, destinationCountry }) {
  const destination = normalizeCountryCode(destinationCountry) || null;
  const company = text(companyId);
  const base = { destination, entityCountries: [], matched: [] };

  if (!destination) {
    return {
      ...base,
      state: PRESENCE_UNAVAILABLE,
      finding:
        "No destination could be read from this request, so no comparison was made. Nothing here says anything about " +
        "where the customer has companies.",
    };
  }

  if (!company) {
    return {
      ...base,
      state: PRESENCE_NO_COMPANY,
      finding:
        "This decision names no company, so the customer's legal entities could not be listed. Whether they have one " +
        `in ${countryLabel(destination, "the destination")} is unknown, not answered no.`,
    };
  }

  if (!remote || typeof remote.listLegalEntities !== "function") {
    return {
      ...base,
      state: PRESENCE_NOT_LOOKED_UP,
      finding:
        "No Remote client is wired into this API, so the customer's legal entities were never listed. This is a " +
        "property of the deployment, not a finding about the customer.",
    };
  }

  let entities = null;
  try {
    entities = await remote.listLegalEntities(company);
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : null;
    return {
      ...base,
      state: PRESENCE_UNAVAILABLE,
      finding:
        `The customer's legal entities could not be read from Remote${status ? ` (HTTP ${status})` : ""}. ` +
        "This is a failure to read: it is NOT a finding that they have no company at the destination, and the " +
        "treaty condition below is unanswered rather than satisfied.",
    };
  }

  const rows = Array.isArray(entities) ? entities : [];
  // ALPHA-2 ON BOTH SIDES. `CompanyLegalEntity.country_code` arrives as ISO
  // alpha-3 and RemoteClient normalises it; comparing the raw form against a
  // destination code would be false forever and would render as "no entity
  // there" — the reassuring answer from a comparison that never had a chance
  // (F-27, restClient.js's own note).
  /* AND THE AXIS IS CHECKED, not merely normalised. `normalizeCountryCode()`
     upper-cases and trims; it does NOT reject a three-letter code — measured:
     `normalizeCountryCode("NLD") === "NLD"`. So an un-normalised row reaching
     here would put "NLD" in a set compared against "NL", match nothing, and
     render as "the customer has no entity there" — the reassuring answer from a
     comparison that never had a chance, which is finding F-27 exactly. A row
     whose country is not readable as alpha-2 is counted as UNREADABLE and
     reported, never silently dropped into the "none there" answer. */
  const codeOf = (entity) => {
    const code = normalizeCountryCode(entity?.country_code);
    return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : null;
  };
  const entityCountries = [...new Set(rows.map(codeOf).filter(Boolean))];
  const unreadable = rows.filter((entity) => entity && codeOf(entity) === null).length;
  const matched = rows.filter((entity) => codeOf(entity) === destination);
  const where = countryLabel(destination, "the destination");

  if (matched.length > 0) {
    const names = matched.map((e) => text(e?.name)).filter(Boolean);
    return {
      ...base,
      state: PRESENCE_IN_DESTINATION,
      entityCountries,
      matched: matched.map((e) => ({ id: text(e?.id), name: text(e?.name), country: destination })),
      finding:
        `The customer has a legal entity in ${where}${names.length ? ` (${names.join(", ")})` : ""}. The treaty's ` +
        "employment-income exemption requires that the pay is not borne by a company resident at the destination, " +
        "and with one there the destination's own economic-employer analysis can reach that conclusion — so the " +
        "exemption cannot be assumed from the day count. It does not follow that tax is owed: that turns on " +
        "domestic law this system does not model.",
    };
  }

  return {
    ...base,
    state: PRESENCE_ELSEWHERE,
    entityCountries,
    finding:
      `The customer has no legal entity in ${where}${entityCountries.length ? ` — Remote lists ${entityCountries.length} ` +
      `entit${entityCountries.length === 1 ? "y" : "ies"}, none of them there` : ""}. ` +
      "That is one of the treaty's three conditions holding, not the trip being clear: the day count and the " +
      "permanent-establishment condition are separate, and this system measures only the first of them." +
      // A ROW WE COULD NOT READ IS NOT A ROW SOMEWHERE ELSE. Saying "none
      // there" over an entity whose country was unreadable would be the same
      // false reassurance the axis check above exists to prevent.
      (unreadable
        ? ` ${unreadable} entit${unreadable === 1 ? "y" : "ies"} could not be placed in any country, so ` +
          "the answer is bounded by what was readable."
        : ""),
  };
}
