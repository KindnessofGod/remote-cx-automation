// ---------------------------------------------------------------------------
// remoteCountries.js — REAL `GET /v1/countries` rows, captured verbatim
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS NOT HAND-WRITTEN
//
// UC-03's supported-countries gate was dead in production for its entire life:
// `listCountries()` mapped `c.country_code ?? c.code`, and the real API returns
// NEITHER `country_code` NOR a 2-letter `code` — it returns the ALPHA-3 form in
// `code` ("ESP") and the alpha-2 form in `alpha_2_code` ("ES"). So the supported
// set was a list of 3-letter codes being tested against a 2-letter destination,
// and every membership test was false. Spain — fully supported, `eor_onboarding:
// true` — escalated as `unsupported_destination`. Live proof: n8n execution
// 4259, whose "Travel Router Gates" node output carried `supportedCountries: []`
// after a successful 224-row fetch.
//
// The bug survived because every fixture in the suite was INVENTED
// (`{country_code: "ES", name: "ES"}`) — a shape no Remote endpoint has ever
// returned. A fixture that agrees with the code instead of with the API cannot
// fail when the code is wrong about the API. So these rows are copied verbatim
// from a live `GET https://gateway.remote-sandbox.com/v1/countries` response
// (2026-08-17, 224 rows total). The ONLY edit is that each row's
// `country_subdivisions` array is truncated to its first two real entries —
// bulk removed, no field name or value invented. Every key below is a key the
// live API actually sent.
//
// Do not "tidy" these into the flat mock shape. The mock's flat
// `{country_code, name}` rows live in src/remote/mockServer.js and are exercised
// separately, on purpose: the mapping has to satisfy BOTH shapes, and only two
// honestly-shaped fixtures can prove that.
// ---------------------------------------------------------------------------

/**
 * Verbatim rows from the live Remote Sandbox `GET /v1/countries`.
 * ESP/DEU/PRT/NGA/CAN are EOR-onboarding countries; ALB is a supported country
 * outside UC-03's usual demo set; ASM (American Samoa) and MNE (Montenegro)
 * are in the list with `eor_onboarding: false`.
 *
 * "In the list" is what UC-03's step-7 gate means, deliberately and now with
 * documentation behind it: Remote states the list holds "the countries where
 * creating a company is allowed" and documents `eor_onboarding` separately as
 * "whether Remote supports EOR onboarding in this country" — an entity
 * footprint, not a travel signal. MNE is the row that makes the difference
 * testable; see docs/research/COUNTRY-SUPPORT-SEMANTICS.md §5.2 and §8.
 */
export const LIVE_COUNTRY_ROWS = [
  {
    "code": "ESP",
    "name": "Spain",
    "region": "Europe",
    "subregion": "Southern Europe",
    "alpha_2_code": "ES",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "ES-AN",
        "name": "Andalusia",
        "subdivision_type": "Autonomous community"
      },
      {
        "code": "ES-AR",
        "name": "Aragon",
        "subdivision_type": "Autonomous community"
      }
    ],
    "supported_json_schemas": [
      "administrative_details",
      "contract_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details",
      "additional_documents"
    ]
  },
  {
    "code": "DEU",
    "name": "Germany",
    "region": "Europe",
    "subregion": "Western Europe",
    "alpha_2_code": "DE",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "DE-BW",
        "name": "Baden-Wurttemberg",
        "subdivision_type": "State"
      },
      {
        "code": "DE-BY",
        "name": "Bayern",
        "subdivision_type": "State"
      }
    ],
    "supported_json_schemas": [
      "administrative_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details",
      "contract_details"
    ]
  },
  {
    "code": "PRT",
    "name": "Portugal",
    "region": "Europe",
    "subregion": "Southern Europe",
    "alpha_2_code": "PT",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "PT-01",
        "name": "Aveiro",
        "subdivision_type": "District"
      },
      {
        "code": "PT-02",
        "name": "Beja",
        "subdivision_type": "District"
      }
    ],
    "supported_json_schemas": [
      "additional_documents",
      "administrative_details",
      "contract_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details"
    ]
  },
  {
    "code": "ALB",
    "name": "Albania",
    "region": "Europe",
    "subregion": "Southern Europe",
    "alpha_2_code": "AL",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "AL-01",
        "name": "Berat",
        "subdivision_type": "County"
      },
      {
        "code": "AL-09",
        "name": "Diber",
        "subdivision_type": "County"
      }
    ],
    "supported_json_schemas": [
      "additional_documents",
      "administrative_details",
      "contract_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details"
    ]
  },
  {
    "code": "ASM",
    "name": "American Samoa",
    "region": "Oceania",
    "subregion": "Polynesia",
    "alpha_2_code": "AS",
    "eor_onboarding": false,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "no_benefits_available",
    "country_subdivisions": [],
    "supported_json_schemas": [
      "employment_basic_information"
    ]
  },
  {
    "code": "NGA",
    "name": "Nigeria",
    "region": "Africa",
    "subregion": "Sub-Saharan Africa",
    "alpha_2_code": "NG",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "NG-AB",
        "name": "Abia",
        "subdivision_type": "State"
      },
      {
        "code": "NG-FC",
        "name": "Abuja Federal Capital Territory",
        "subdivision_type": "Capital territory"
      }
    ],
    "supported_json_schemas": [
      "additional_documents",
      "administrative_details",
      "employment_basic_information",
      "emergency_contact",
      "address_details",
      "contract_details"
    ]
  },
  {
    "code": "CAN",
    "name": "Canada",
    "region": "Americas",
    "subregion": "Northern America",
    "alpha_2_code": "CA",
    "eor_onboarding": true,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "after_first_hire",
    "country_subdivisions": [
      {
        "code": "CA-AB",
        "name": "Alberta",
        "subdivision_type": "Province"
      },
      {
        "code": "CA-BC",
        "name": "British Columbia",
        "subdivision_type": "Province"
      }
    ],
    "supported_json_schemas": [
      "additional_documents",
      "administrative_details",
      "contract_details",
      "employment_basic_information",
      "address_details",
      "emergency_contact"
    ]
  },
  {
    // MONTENEGRO — the row that pins UC-03's step-7 gate to list MEMBERSHIP
    // rather than `eor_onboarding`. It is in the 224 (so travel there is not a
    // jurisdiction problem) and carries `eor_onboarding: false` (so Remote has
    // no employing entity there). Those two facts are only distinguishable
    // with a row that has exactly this combination, which is why this one is
    // here: without it, "in the list" and "EOR-capable" produce identical
    // results on every fixture in the suite, and a later 'tightening' of the
    // gate to the EOR flag would break legitimate travel with nothing failing.
    // Verified live 2026-08-17 against GET /v1/countries.
    // See test/uc03.test.js's Montenegro test and
    // docs/research/COUNTRY-SUPPORT-SEMANTICS.md §5.2.
    "code": "MNE",
    "name": "Montenegro",
    "region": "Europe",
    "subregion": "Southern Europe",
    "alpha_2_code": "ME",
    "eor_onboarding": false,
    "employment_agreement_preview_available": false,
    "contractor_products_available": [
      "standard",
      "plus",
      "cor"
    ],
    "locked_benefits": "no_benefits_available",
    "country_subdivisions": [
      {
        "code": "ME-01",
        "name": "Andrijevica",
        "subdivision_type": "Municipality"
      },
      {
        "code": "ME-02",
        "name": "Bar",
        "subdivision_type": "Municipality"
      }
    ],
    "supported_json_schemas": [
      "employment_basic_information",
      "address_details"
    ]
  }
];

/**
 * The full envelope the live API returns: `{data: [...]}` — the array sits
 * DIRECTLY under `data`, not under `data.countries` as the mock (and this
 * repo's older comments) assumed. RemoteClient.#get() already unwraps `data`,
 * so `listCountries()` receives the bare array; the n8n HTTP node does not
 * unwrap, so the Code node sees this whole object.
 */
export const LIVE_COUNTRIES_ENVELOPE = { data: LIVE_COUNTRY_ROWS };

/** Alpha-2 codes the rows above should resolve to, in order. */
export const LIVE_ALPHA_2 = ["ES", "DE", "PT", "AL", "AS", "NG", "CA", "ME"];
