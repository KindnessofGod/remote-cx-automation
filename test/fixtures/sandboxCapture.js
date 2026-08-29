// ---------------------------------------------------------------------------
// sandboxCapture.js — payloads the Remote Sandbox actually returned, captured
// verbatim, so tests can compare this repo's mock against the API instead of
// against this repo.
// ---------------------------------------------------------------------------
// PROVENANCE. Every object below was written by scripts/capture-sandbox.mjs
// against https://gateway.remote-sandbox.com on **2026-08-19** and pasted here
// unmodified — no field renamed, no null tidied into a value, no key dropped to
// make an assertion pass. [CONFIRMED]
//
// WHY A COMMITTED CAPTURE AND NOT A LIVE CALL. The suite is hermetic: no test
// may reach the network (CLAUDE.md §3). But "hermetic" is exactly the condition
// under which a fixture can drift from the API forever without anyone noticing,
// which is the defect class BUILD-LOG §3.66 and CLAUDE.md §4 both name as this
// project's most expensive. A capture is the compromise that keeps both
// properties: the assertions run offline, and what they assert came from
// Remote. Re-run the capture script to refresh it; a diff here is a real
// signal, not noise.
//
// SANDBOX ONLY — no real customer data (CLAUDE.md §3 directive 5). Every name,
// email and id below belongs to Remote's demo company
// "Rempel-Paucek 4C3WAC" and its `.example.com` mailboxes.
// ---------------------------------------------------------------------------


/**
 * GET /v1/employments/{id} — THE WHOLE ENVELOPE, not just the record.
 *
 * The record nests under `data.employment`. That second level is the point of
 * keeping the envelope: src/remote/mockServer.js answered `{data: <record>}`
 * for the project's whole life, and because RemoteClient tolerates both, the
 * difference was invisible everywhere except production.
 *
 * 49 top-level keys, and the two absences matter more than any of them:
 * there is NO `custom_fields` key and NO `start_date` key. UC-04's first hard
 * gate requires the first; UC-05's tenure arithmetic once looked for the second.
 */
export const LIVE_EMPLOYMENT_SHOW_ENVELOPE = {
  "data": {
    "employment": {
      "partner_external_id": null,
      "active_contract_id": "883dc9bc-252d-4e3f-b4ad-606918a6565c",
      "basic_information": {
        "name": "Alexandre Tremblay",
        "manager": null,
        "email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
        "job_title": "Financial Manager",
        "login_email": "personal",
        "provisional_start_date": "2023-06-26",
        "personal_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
        "tax_servicing_countries": [],
        "work_email": null,
        "seniority_date": null,
        "tax_job_category": null,
        "has_seniority_date": null
      },
      "department_id": "21a6d946-c81a-4f1e-b020-ceaf00b2f6d9",
      "company_id": "a9d4ce72-7773-4ea3-830d-c5b36a15e48d",
      "billing_address_details": {
        "country_code": "CAN"
      },
      "files": [
        {
          "id": "a0d5da1a-c586-48a4-b276-7c143ac37ee7",
          "name": "2026-06-26_CanadaRemoteTechnologyInc_AlexandreTremblay_Signed.pdf",
          "type": "contract",
          "inserted_at": "2026-06-26T14:51:39Z",
          "sub_type": null
        }
      ],
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
      "seniority_date": null,
      "work_address_details": {},
      "administrative_details": null,
      "bank_account_details": [
        {
          "is_default": true,
          "local_details": {
            "account_holder": "Contractor",
            "account_number": "22561249",
            "account_type": "checking",
            "bank_branch_number": "001",
            "bank_number": "1234",
            "bic_swift": "BUKBGB33",
            "name": "Demo Bank",
            "ownership_type": "PRIVATE"
          }
        }
      ],
      "pricing_plan_details": {
        "frequency": "monthly"
      },
      "employment_lifecycle_stage": "onboarded",
      "personal_details": null,
      "engaged_by_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
      "manager_email": null,
      "expiration_date": null,
      "status": "active",
      "contractor_rate": null,
      "emergency_contact_details": null,
      "work_email": null,
      "user_status": "active",
      "onboarding_tasks": {
        "contract_details": {
          "status": "completed",
          "description": "Employee-specific details for their employment agreement."
        },
        "pricing_plan_details": {
          "status": "completed",
          "description": "How often Remote will bill employers for management fees."
        },
        "billing_address_details": {
          "status": "completed",
          "description": "Address associated with the employee's bank account."
        }
      },
      "personal_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
      "contractor_settings": {
        "requires_work_confirmation": false
      },
      "provisional_start_date": "2023-06-26",
      "manager_employment_id": null,
      "eligible_for_onboarding_cancellation": false,
      "department": "Finance",
      "short_id": "OJMUH6",
      "job_title": "Financial Manager",
      "contractor_type": "cor",
      "full_name": "Alexandre Tremblay",
      "termination_date": null,
      "user_id": "e312fd8f-351f-4a3e-a46c-9783511fcecc",
      "id": "3537d9ee-2017-4a53-952e-9d3b042aeab5",
      "contract_details": {
        "payment_terms": {
          "compensation_currency_code": "USD",
          "compensation_gross_amount": 25000,
          "payment_terms_type": "pay_period",
          "period_unit": "monthly"
        },
        "service_duration": {}
      },
      "manager_id": null,
      "updated_at": "2026-06-26T14:51:39",
      "probation_period_end_date": null,
      "external_id": null,
      "type": "contractor",
      "address_details": null,
      "created_at": "2026-06-26T14:50:42",
      "login_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
      "bill_to_legal_entity_id": "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
      "manager": null,
      "employment_model": "contractor"
    }
  }
};

/**
 * GET /v1/employments — ONE ROW of the collection.
 *
 * 17 keys against the show payload's 49. No `basic_information`, no
 * `contract_details`, no `company_id`, no `probation_period_end_date`,
 * no `status`-adjacent contract data at all. A caller that lists and then reads
 * one of those off a row gets `undefined` in production however complete the
 * show fixture is.
 */
export const LIVE_EMPLOYMENT_LIST_ROW = {
  "id": "3537d9ee-2017-4a53-952e-9d3b042aeab5",
  "status": "active",
  "type": "contractor",
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
  "department": "Finance",
  "external_id": null,
  "full_name": "Alexandre Tremblay",
  "job_title": "Financial Manager",
  "login_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
  "personal_email": "owner+contractor-contractor_of_record-can-19@rempel-paucek-4c3wac.example.com",
  "employment_model": "contractor",
  "short_id": "OJMUH6",
  "partner_external_id": null,
  "work_email": null,
  "department_id": "21a6d946-c81a-4f1e-b020-ceaf00b2f6d9",
  "employment_lifecycle_stage": "onboarded",
  "work_address_details": {}
};

/** The paginated collection envelope's own keys, under `data`. */
export const LIVE_EMPLOYMENT_LIST_ENVELOPE_KEYS = [
  "current_page",
  "employments",
  "total_count",
  "total_pages"
];

/**
 * GET /v1/work-authorization-requests — EMPTY. `total_count: 0`.
 *
 * This is a finding, not a fixture detail: UC-04's real flow has nothing to be
 * demonstrated against on this Sandbox. See docs/BUILD-LOG.md for what
 * provisioning it would take.
 */
export const LIVE_WORK_AUTH_COLLECTION = {
  "data": {
    "total_count": 0,
    "current_page": 1,
    "total_pages": 0,
    "work_authorization_requests": []
  }
};

/**
 * GET /v1/travel-letter-requests — also EMPTY, and also a 200.
 *
 * A 200-with-nothing and a 404 are opposite answers. The mock used to give the
 * second where the API gives the first.
 */
export const LIVE_TRAVEL_LETTER_COLLECTION = {
  "data": {
    "total_count": 0,
    "current_page": 1,
    "total_pages": 0,
    "travel_letter_requests": []
  }
};

/**
 * GET /v1/payroll-runs — one row. Note `total_payroll_cost` is a STRING, the
 * country is an object carrying both ISO forms, and the lock the whole of
 * UC-06 turns on is `cutoff_date`.
 */
export const LIVE_PAYROLL_RUN_ROW = {
  "id": "60855884-dc15-4371-ad8f-5610c3dcd317",
  "status": "completed",
  "type": "main",
  "country": {
    "code": "SGP",
    "name": "Singapore",
    "alpha_2_code": "SG",
    "supported_json_schemas": [
      "employment_basic_information",
      "contract_details",
      "emergency_contact",
      "administrative_details",
      "address_details"
    ]
  },
  "currency_code": "SGD",
  "period_end": "2026-04-26",
  "period_start": "2026-04-01",
  "cutoff_date": "2026-04-06",
  "expected_payout_date": "2026-04-26",
  "approval_date": "2026-04-17",
  "total_payroll_cost": "15103469"
};

/** GET /v1/expenses — the collection envelope's keys. It PAGINATES. */
export const LIVE_EXPENSE_LIST_ENVELOPE_KEYS = [
  "current_page",
  "expenses",
  "total_count",
  "total_pages"
];

/**
 * GET /v1/employments/{id}/custom-fields — HYPHEN, and the shape that settles
 * UC-04's first hard gate.
 *
 * Values are addressed by HUMAN NAME plus a uuid. There is no machine slug on
 * any row, so `employment.custom_fields.workation_permission` — the key
 * src/uc04/policyEngine.js requires to be `true` before it will allow a
 * workation — cannot be produced from this payload under any reading of it.
 *
 * The UNDERSCORE spelling docs/use-cases/UC-04.md §3 records as [CONFIRMED],
 * `/v1/employments/{id}/custom_fields`, answers 404 "Not Found".
 *
 * [CONFIRMED] Remote Sandbox, 2026-08-19.
 */
export const LIVE_EMPLOYMENT_CUSTOM_FIELDS = {
  data: {
    total_count: 4,
    current_page: 1,
    total_pages: 1,
    custom_field_values: [
      { name: "Office Location Code", type: "string", value: "CAN-4F", custom_field_id: "90e2eda1-05f0-42f1-ac75-9135e86dc28f" },
      { name: "Languages", type: "string", value: "Fluent in: German, English, Spanish\n Conversational level in: Spanish", custom_field_id: "d03d8aa0-aa1c-4e72-bf7e-3bfdbdfa5d18" },
      { name: "Monthly Travel Days", type: "integer", value: 4, custom_field_id: "57db6d4b-a5dc-4ad5-8aed-3744373cba83" },
      { name: "Has Company Laptop?", type: "boolean", value: false, custom_field_id: "4d0092a7-c7b2-4049-bc52-9a7f8aeec87b" },
    ],
  },
};

/**
 * The company's custom-field DEFINITIONS — all four of them, and not one is a
 * workation permission.
 *
 * Note the envelope: this endpoint is NOT wrapped in `data`, unlike its own
 * per-employment sibling above. Captured, not tidied.
 *
 * [CONFIRMED] GET /v1/custom-fields, Remote Sandbox, 2026-08-19.
 */
export const LIVE_CUSTOM_FIELD_DEFINITION_NAMES = [
  "Has Company Laptop?",
  "Languages",
  "Monthly Travel Days",
  "Office Location Code",
];

/**
 * GET /v1/contract-amendments — one row of the collection.
 *
 * No amount, no currency, no effective salary — only `job_title` of the amended
 * values. A listing cannot tell you what an amendment proposes to pay anyone.
 *
 * [CONFIRMED] Remote Sandbox, 2026-08-19.
 */
export const LIVE_CONTRACT_AMENDMENT_ROW = {
  id: "18957b7a-f9b5-428b-a40e-264240157235",
  status: "in_review",
  job_title: "Senior Engineer",
  submitted_at: "2026-06-26T14:51:19Z",
  employment_id: "d73cff71-ced7-4bcf-b764-b9899abc6340",
  reason_for_change: null,
  requested_effective_date: "2026-07-26",
  requested_by: "eee7bab1-86e9-417e-ad50-fe66162610f6",
};

/**
 * GET /v1/companies/{companyId}/legal-entities — one row.
 *
 * `country_code` here is the ALPHA-3 form, and there is NO address field on
 * this endpoint at all — while the singular `/v1/legal-entities/{id}` this
 * repo's mock also serves does not exist on Remote (a bare 404).
 *
 * [CONFIRMED] Remote Sandbox, 2026-08-19.
 */
export const LIVE_LEGAL_ENTITY_ROW = {
  id: "30aec65a-28c4-4961-ac70-0e10ad9e81fb",
  name: "Rempel-Paucek 4C3WAC",
  country_code: "USA",
  is_default: true,
  global_payroll_enabled: false,
};

/**
 * Endpoints this project's code names, and what the Sandbox answers for each.
 * Every entry observed on 2026-08-19. [CONFIRMED]
 *
 * The 403s are ROLE refusals, not outages: the token is a company token and
 * `/v1/employee/*` is the employee-session namespace. The 404s are the
 * interesting ones — `/v1/company-payroll-runs` is a URL this repo once called
 * because a doc *title* had been read as a path, and
 * `/v1/employments/{id}/custom_fields` is the same mistake one underscore wide.
 */
export const LIVE_ENDPOINT_STATUSES = {
  "/v1/employments": 200,
  "/v1/employments/{id}": 200,
  "/v1/employments/{id}/custom-fields": 200,
  "/v1/employments/{id}/custom_fields": 404,
  "/v1/custom-fields": 200,
  "/v1/countries": 200,
  "/v1/countries/{alpha3}/employment_basic_information": 200,
  "/v1/work-authorization-requests": 200,
  "/v1/travel-letter-requests": 200,
  "/v1/expenses": 200,
  "/v1/expenses/{id}": 200,
  "/v1/expenses/categories": 422,
  "/v1/expenses/categories?employment_id={id}": 200,
  "/v1/employee/expenses": 403,
  "/v1/employee/expense-categories": 403,
  "/v1/payroll-runs": 200,
  "/v1/company-payroll-runs": 404,
  "/v1/contract-amendments": 200,
  "/v1/incentives": 200,
  "/v1/companies": 200,
  "/v1/companies/{id}/legal-entities": 200,
  "/v1/legal-entities": 404,
  "/v1/timeoff": 200,
};
