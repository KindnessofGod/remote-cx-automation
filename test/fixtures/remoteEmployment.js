// ---------------------------------------------------------------------------
// remoteEmployment.js — REAL `GET /v1/employments/:id` records, captured verbatim
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS NOT HAND-WRITTEN
//
// The same failure that killed UC-03's supported-countries gate (finding F-25 —
// see test/fixtures/remoteCountries.js) was sitting, untriggered, one field
// away: `normalizeEmployment()` mapped
//
//     country_code: raw.country?.alpha_2_code ?? raw.country?.code ?? …
//
// and `raw.country.code` is the ALPHA-3 form. Whenever `alpha_2_code` was
// absent, that chain quietly placed a 3-letter string ("DEU", "CAN") into
// `employment.country_code` — a field that is only ever compared against
// 2-letter values, in UC-05's statutory notice table, UC-06's per-country
// schema lookup and UC-09's high-tax-risk list. Every one of those comparisons
// would have been false, silently, forever.
//
// A fixture that agrees with the code instead of with the API cannot fail when
// the code is wrong about the API, so these records are copied verbatim from
// live `GET https://gateway.remote-sandbox.com/v1/employments/:id` responses
// (2026-08-17). The only edits are subtractive: fields irrelevant to
// normalizeEmployment() (files, onboarding_tasks, bank_account_details,
// address blocks, pricing plan …) are removed wholesale. No key was renamed and
// no value was invented. `country` in particular is byte-for-byte what the API
// sent, including the fact that `code` is alpha-3 and there is NO top-level
// `country_code` anywhere on the record.
//
// Sandbox data only — see CLAUDE.md §3 prime directive 5. These are Remote's
// own seeded demo employees (`…@rempel-paucek-….example.com`), not customers.
// ---------------------------------------------------------------------------

/**
 * Alexandre Tremblay — contractor, Canada, active.
 * `id: 3537d9ee-…` is the CURRENT id; the `fde4007b-…` this repo's history
 * names was invalidated when the Sandbox was reseeded (CLAUDE.md §6).
 */
export const LIVE_EMPLOYMENT_CA = {
  "id": "3537d9ee-2017-4a53-952e-9d3b042aeab5",
  "status": "active",
  "full_name": "Alexandre Tremblay",
  "work_email": null,
  "login_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
  "company_id": "a9d4ce72-7773-4ea3-830d-c5b36a15e48d",
  "engaged_by_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
  "bill_to_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
  "country": {
    "code": "CAN",
    "name": "Canada",
    "alpha_2_code": "CA",
    "supported_json_schemas": [
      "additional_documents",
      "administrative_details",
      "contract_details",
      "employment_basic_information",
      "address_details",
      "emergency_contact"
    ]
  },
  "type": "contractor",
  "employment_model": "contractor",
  "job_title": "Financial Manager",
  "provisional_start_date": "2023-06-26",
  "seniority_date": null,
  "probation_period_end_date": null,
  "termination_date": null,
  "short_id": "OJMUH6",
  "user_status": "active",
  "employment_lifecycle_stage": "onboarded",
  "basic_information": {
    "name": "Alexandre Tremblay",
    "email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
    "job_title": "Financial Manager",
    "provisional_start_date": "2023-06-26",
    "seniority_date": null,
    "work_email": null
  }
};

/**
 * Anna Müller — EOR employee, Germany, active.
 *
 * Germany is the one country that appears in ALL THREE alpha-2 consumers at
 * once: UC-05's statutory notice table (`DE`), UC-06's per-country schema
 * lookup (`/v1/countries/DE/employment_basic_information`) and UC-09's
 * high-tax-complexity list (`["DE","FR","IT"]`, which raises the approval floor
 * from 2 to 3). Its live `country.code` is `"DEU"` — so this record is the
 * positive test for the whole fix: `"DEU"` must never be what those gates see.
 */
export const LIVE_EMPLOYMENT_DE = {
  "id": "09b65526-643b-4956-959b-916e6429bd23",
  "status": "active",
  "full_name": "Anna Müller",
  "work_email": null,
  "login_email": "owner+employee-eor-deu-4@rempel-paucek-4c3wac.example.com",
  "company_id": "a9d4ce72-7773-4ea3-830d-c5b36a15e48d",
  "engaged_by_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
  "bill_to_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
  "country": {
    "code": "DEU",
    "name": "Germany",
    "alpha_2_code": "DE",
    "supported_json_schemas": [
      "administrative_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details",
      "contract_details"
    ]
  },
  "type": "employee",
  "employment_model": "eor",
  "job_title": "Financial Advisor",
  "provisional_start_date": "2023-06-26",
  "seniority_date": null,
  "probation_period_end_date": null,
  "short_id": "P1N1AG",
  "user_status": "active",
  "employment_lifecycle_stage": "onboarded",
  "basic_information": {
    "name": "Anna Müller",
    "email": "owner+employee-eor-deu-4@rempel-paucek-4c3wac.example.com",
    "job_title": "Financial Advisor",
    "provisional_start_date": "2023-06-26",
    "seniority_date": null,
    "work_email": null
  }
};

/**
 * The live envelope for a single employment: `{data: {employment: {…}}}`.
 * `RemoteClient.#get()` unwraps `data`; `getEmployment()` then unwraps
 * `employment`. The n8n HTTP node unwraps neither, which is why its Code nodes
 * read `…json.data.employment`.
 */
export function liveEmploymentEnvelope(record) {
  return { data: { employment: record } };
}

/**
 * The SAME real record with `country.alpha_2_code` deleted — nothing else
 * changed, no field invented.
 *
 * This is not a hypothetical. `alpha_2_code` was present on all 224 rows of
 * `GET /v1/countries` and on every employment sampled on 2026-08-17, but the
 * whole point of the defect is that the code had a written-down fallback for
 * its absence, and that fallback produced a WRONG value rather than no value.
 * A fallback that only runs on a shape you never test is a fallback whose
 * behaviour nobody has ever checked — so this fixture checks it.
 */
export function withoutAlpha2(record) {
  const { alpha_2_code, ...country } = record.country;
  return { ...record, country };
}
