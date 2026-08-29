// ---------------------------------------------------------------------------
// enrichment.js  —  what the Sandbox stand-in adds, and what it must never touch
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// Remote's Sandbox returns real, correctly-shaped employment records, but several
// fields on them are simply null — nobody filled them in on the demo tenant.
// Audited live against both demo employments on 2026-08-15:
//
//   basic_information.start_date    null on both  -> UC-01's letter shows a blank
//                                                    start date; UC-05 cannot
//                                                    compute statutory notice at
//                                                    all and escalates every time
//   custom_fields                   null on both  -> UC-04 can never see a
//                                                    workation permission, so it
//                                                    blocks every request
//   address_details                 null on both  -> no employer address on the
//                                                    letter
//   contract_details.annual_gross_salary
//                                   null on the contractor -> UC-09 has no
//                                                    baseline to sanity-check an
//                                                    adjustment against
//
// Those nulls are not bugs in this project — every one of them is handled
// correctly, and the resulting escalate/blocked decisions are the gates doing
// their job. But they mean a demo can only ever show the refusal path, which
// demonstrates half the system.
//
// THE HONESTY RULE, which is the whole design constraint here:
// this module may only ever fill a field the upstream API left EMPTY. It must
// never overwrite a real value, and every field it fills is named in the
// response so nobody can mistake stand-in data for Sandbox data. A demo that
// quietly invented an employee's salary would be worth less than no demo, and
// this project's own directive is that a reviewer who catches one overstatement
// discounts everything else.
// ---------------------------------------------------------------------------

/**
 * Demo-completeness data, keyed by employment id. Only consulted for fields the
 * real record left null. Values are deliberately plausible-but-obviously-demo
 * (a "Demo Street" address) so nobody reading a rendered letter mistakes this
 * for production data.
 */
export const STANDIN_PROFILES = {
  // Alex Morgan — EOR employee, USA. The green-path demo subject.
  "2f7f8210-91fc-47db-803c-77a1cc625781": {
    basic_information: { start_date: "2023-06-26" },
    address_details: {
      address: "1 Demo Street",
      city: "Austin",
      state: "TX",
      postal_code: "73301",
      country_code: "USA",
    },
    custom_fields: { workation_permission: true, employer_permission_granted: true },
  },
  // Alexandre Tremblay — contractor, Canada.
  "3537d9ee-2017-4a53-952e-9d3b042aeab5": {
    basic_information: { start_date: "2023-06-24" },
    address_details: {
      address: "2 Demo Avenue",
      city: "Montreal",
      state: "QC",
      postal_code: "H2X 1Y4",
      country_code: "CAN",
    },
    custom_fields: { workation_permission: true, employer_permission_granted: true },
    contract_details: { annual_gross_salary: 9600000 }, // x100 scaled, per invariant 1
  },
};

/**
 * Fields any employment record needs before this project's gates can reach a
 * decision other than "escalate because I don't know". Used to report coverage,
 * never to invent a value that has no profile entry.
 */
export const DEMO_REQUIRED_PATHS = [
  "basic_information.start_date",
  "address_details",
  "custom_fields",
];

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function isEmpty(v) {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/**
 * Fill only the empty fields of a real employment record from its stand-in
 * profile, and report exactly what was filled.
 *
 * @param {object} employment  the record as the real Sandbox returned it
 * @param {object} [profiles]  injectable for tests
 * @returns {{employment: object, enriched: string[], profileFound: boolean}}
 */
export function enrichEmployment(employment, profiles = STANDIN_PROFILES) {
  if (!employment || typeof employment !== "object") {
    return { employment, enriched: [], profileFound: false };
  }
  const profile = profiles[employment.id];
  if (!profile) return { employment, enriched: [], profileFound: false };

  // Deep-ish clone so the caller's object is never mutated in place — an
  // enrichment that leaked back into a cached upstream response would make the
  // "never overwrite real data" guarantee unverifiable.
  const out = JSON.parse(JSON.stringify(employment));
  const enriched = [];

  for (const [key, value] of Object.entries(profile)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Nested object (basic_information, address_details, contract_details):
      // merge field by field so a real value inside it is never replaced.
      if (isEmpty(out[key])) out[key] = {};
      for (const [subKey, subValue] of Object.entries(value)) {
        if (isEmpty(out[key][subKey])) {
          out[key][subKey] = subValue;
          enriched.push(`${key}.${subKey}`);
        }
      }
      if (Object.keys(out[key]).length === 0) delete out[key];
    } else if (isEmpty(out[key])) {
      out[key] = value;
      enriched.push(key);
    }
  }

  return { employment: out, enriched, profileFound: true };
}

/**
 * Which demo-required fields are still empty after enrichment. Surfaced on every
 * response so an operator can see at a glance why a use case is still
 * escalating, instead of guessing.
 * @param {object} employment
 * @returns {string[]}
 */
export function remainingGaps(employment) {
  return DEMO_REQUIRED_PATHS.filter((p) => isEmpty(getPath(employment, p)));
}
