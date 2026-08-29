// ---------------------------------------------------------------------------
// contractAmendmentSchemas.js — LIVE CAPTURES, not hand-written fixtures
// ---------------------------------------------------------------------------
// Every schema below was fetched from gateway.remote-sandbox.com on 2026-08-18:
//
//   GET /v1/contract-amendments/schema
//       ?employment_id=75b88008-28f0-4c7a-921b-59498d89ac45
//       &country_code=<ALPHA3>&form=contract_amendment
//
// [CONFIRMED] for NLD, DEU, GBR, POL and CHE — 200 with the exact `required`,
// `properties` and `allOf` reproduced here. The `country_code` parameter, not
// the employment's own country, selects which country's form comes back, so
// one employment id was enough to capture all five.
//
// BUT THE FORM IS PER EMPLOYMENT, NOT PER COUNTRY ALONE, AND THAT IS A REAL
// CAVEAT ON THESE CAPTURES. Remote's reference says so plainly — *"the json
// schema of the contract_amendment form for a SPECIFIC EMPLOYMENT"* — and it
// shows: the DEU form fetched with the Dutch employment above requires eight
// fields, while the same DEU form fetched with the German employment
// 09b65526-… requires TEN, adding `schedule_type` and
// `required_qualifications`. Neither capture is wrong; they are answers to
// different questions. What is reproduced here is the eight-field variant,
// because that is the one actually captured. A caller that needs certainty for
// a particular employment must fetch that employment's own form — which is
// exactly what `RemoteClient.getContractAmendmentSchema()` does at run time,
// passing the real employment id. These fixtures exist so `npm test` can stay
// hermetic, not as a claim that a country has one fixed form.
//
// WHY THIS FILE EXISTS AT ALL. src/remote/mockServer.js's COUNTRY_SCHEMAS used
// to serve `{required: ['job_title', 'weekly_hours']}` — two field names that
// appear in no Remote form anywhere, with no `properties` and no
// `additionalProperties`. The mock agreed with the code, the code agreed with
// the mock, and neither agreed with Remote, so UC-06's payload builder was
// validated for its whole life against a form that could not express the
// amendment it exists to make. A fixture that agrees with the caller instead of
// the API is the bug (docs/BUILD-LOG.md §3.30), so these are captures.
//
// WHAT WAS TRIMMED, AND WHY IT IS SAFE. Presentation-only keys were dropped:
// `title`, `description`, `x-jsf-presentation`, `x-jsf-errorMessage`,
// `x-jsf-order`, `x-rmt-meta`, and the human-readable label on each `oneOf`
// entry (its `const` is kept). Nothing that constrains a payload was removed:
// `type`, `format`, `minimum`/`maximum` (and the exclusive forms), `minLength`,
// `maxLength`, `default`, `required`, `additionalProperties` and the whole
// `if/then/else` rule set are verbatim. Rules whose `then` and `else` say
// nothing about required-ness or allowed-ness — the three NLD rules that only
// attach a presentation `statement` — are dropped, since they cannot change any
// verdict.
//
// THE NUMERIC BOUNDS IN `allOf[].if` ARE MATERIALISED PER EMPLOYMENT, and that
// is the single most important thing to know before reusing this file. Live,
// the Dutch rule reads
//   if   annual_gross_salary <= 7199999
//   then required [salary_decrease_reason, was_employee_informed]
//   else those two are FORBIDDEN
// and 7199999 is one cent below the CURRENT salary of the employment the schema
// was fetched for (7200000). That is how Remote expresses "a decrease needs a
// reason and an informed employee" — not as a special case anywhere in code, but
// as a number computed for this contract. GBR (6158130) and POL (31127687)
// carry the same rule against their own employments' salaries, paired with a
// `compensation_currency_code` const.
//
// So a fixture reused for a DIFFERENT employment would compare against the
// wrong salary. src/remote/mockServer.js therefore re-materialises that bound
// from the employment it is asked about, and says so at the route.
//
// WHAT IS DELIBERATELY ABSENT.
//  - `x-jsf-logic`: JSONLogic computed minimums (the Dutch part-time salary
//    floor). Real, enforced live, and NOT evaluated by this repo — see
//    effectiveSchema() in src/uc06/policyEngine.js. Reproducing the block here
//    would imply support this code does not have.
//  - NGA and USA: live, BOTH answer `500 Internal Server Error` for every
//    employment tried [CONFIRMED]. There is no form to copy, so the mock serves
//    none and answers 500 exactly as the Sandbox does. An amendment for a
//    Nigerian or US employment therefore escalates `country_schema_unavailable`
//    — which is what is true, and inventing a plausible form for either is the
//    precise move this file exists to stop.
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-3 -> the contract_amendment form, as Remote sends it. */
export const CONTRACT_AMENDMENT_SCHEMAS = {
  "NLD": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "annual_gross_salary",
      "effective_date",
      "job_title",
      "role_description",
      "contract_duration_type",
      "work_schedule",
      "work_hours_per_week"
    ],
    "properties": {
      "additional_comments": {
        "type": "string",
        "maxLength": 20000
      },
      "additional_comments_toggle": {
        "type": "boolean"
      },
      "annual_gross_salary": {
        "type": "integer",
        "minimum": 0
      },
      "contract_duration_type": {
        "type": "string",
        "oneOf": [
          {
            "const": "fixed_term"
          },
          {
            "const": "indefinite"
          }
        ],
        "default": "fixed_term"
      },
      "contract_duration_type_ack": {
        "type": "string"
      },
      "contract_end_date": {
        "type": "string",
        "format": "date",
        "maxLength": 255
      },
      "default_weekly_hours": {
        "type": [
          "number",
          "null"
        ],
        "maximum": 40,
        "minimum": 36
      },
      "effective_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date"
      },
      "experience_level": {
        "type": "string",
        "oneOf": [
          {
            "const": "Level 2 - Entry Level - Employees who perform operational tasks with an average level of complexity. They perform their functions with limited autonomy"
          },
          {
            "const": "Level 3 - Associate - Employees who perform independently tasks and/or with coordination and control functions"
          },
          {
            "const": "Level 4 - Mid-Senior level - Employees with high professional functions, executive management responsibilities, who supervise the production with an initiative and operational autonomy within the responsibilities delegated to them"
          },
          {
            "const": "Level 5 - Director - Directors perform functions of an ongoing nature that are of significant importance for the development and implementation of the company's objectives"
          },
          {
            "const": "Level 6 - Executive - An Executive is responsible for running an organization. They create plans to help their organizations grow"
          }
        ]
      },
      "holiday_allowance": {
        "type": "string",
        "oneOf": [
          {
            "const": "On top of salary"
          },
          {
            "const": "Within the salary"
          }
        ]
      },
      "holiday_allowance_payment_frequency": {
        "type": "string",
        "oneOf": [
          {
            "const": "monthly"
          },
          {
            "const": "yearly"
          }
        ]
      },
      "job_title": {
        "type": "string",
        "maxLength": 255
      },
      "job_title_change_ack": {
        "type": [
          "string",
          "null"
        ]
      },
      "non_compete_clause_apply": {
        "type": "string",
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          }
        ]
      },
      "non_compete_clause_halt_period_months": {
        "type": [
          "number",
          "null"
        ],
        "maximum": 12,
        "minimum": 1
      },
      "non_solicitation_clause_halt_period_months": {
        "type": "number",
        "maximum": 12,
        "minimum": 1
      },
      "part_time_salary_confirmation": {
        "type": "string"
      },
      "reason_for_change": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "annual_pay_adjustment"
          },
          {
            "const": "error_correction"
          },
          {
            "const": "job_change_reevaluation"
          },
          {
            "const": "promotion"
          },
          {
            "const": "other"
          },
          {
            "const": null
          }
        ]
      },
      "reason_for_change_description": {
        "type": "string",
        "maxLength": 1000
      },
      "role_description": {
        "type": "string",
        "maxLength": 5000,
        "minLength": 100
      },
      "salary_decrease_reason": {
        "type": "string",
        "oneOf": [
          {
            "const": "change_in_working_hours"
          },
          {
            "const": "trade_salary_for_equity"
          },
          {
            "const": "error_in_initial_salary"
          },
          {
            "const": "role_change_or_demotion"
          },
          {
            "const": "compensation_restructure"
          },
          {
            "const": "other"
          }
        ]
      },
      "salary_decrease_reason_description": {
        "type": [
          "string"
        ],
        "maxLength": 1000
      },
      "was_employee_informed": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          },
          {
            "const": null
          }
        ]
      },
      "work_hours_per_week": {
        "type": "number"
      },
      "work_schedule": {
        "type": "string",
        "oneOf": [
          {
            "const": "full_time"
          },
          {
            "const": "part_time"
          }
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "fixed_term"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "contract_end_date"
          ]
        },
        "else": {
          "properties": {
            "contract_end_date": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "reason_for_change": {
              "const": "other"
            }
          },
          "required": [
            "reason_for_change"
          ]
        },
        "then": {
          "required": [
            "reason_for_change_description"
          ]
        },
        "else": {
          "properties": {
            "reason_for_change_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "salary_decrease_reason": {
              "const": "other"
            }
          },
          "required": [
            "salary_decrease_reason"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason_description"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "default_weekly_hours"
          ]
        },
        "else": {
          "properties": {
            "default_weekly_hours": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "part_time_salary_confirmation"
          ]
        },
        "else": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "holiday_allowance": {
              "const": "Within the salary"
            },
            "work_schedule": {
              "const": "full_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "annual_gross_salary"
          ],
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "holiday_allowance": {
              "const": "On top of salary"
            },
            "work_schedule": {
              "const": "full_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "annual_gross_salary"
          ],
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "non_compete_clause_apply": {
              "const": "yes"
            }
          },
          "required": [
            "non_compete_clause_apply"
          ]
        },
        "then": {
          "required": [
            "non_compete_clause_halt_period_months",
            "non_solicitation_clause_halt_period_months"
          ]
        },
        "else": {
          "properties": {
            "non_compete_clause_halt_period_months": false,
            "non_solicitation_clause_halt_period_months": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "indefinite"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "non_compete_clause_apply",
            "contract_duration_type_ack"
          ]
        },
        "else": {
          "properties": {
            "contract_duration_type_ack": false,
            "non_compete_clause_apply": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "additional_comments_toggle": {
              "const": true
            }
          },
          "required": [
            "additional_comments_toggle"
          ]
        },
        "then": {
          "required": [
            "additional_comments"
          ]
        },
        "else": {
          "properties": {
            "additional_comments": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "role_description": {
              "const": "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise."
            }
          },
          "required": [
            "role_description"
          ]
        },
        "else": {
          "properties": {
            "job_title_change_ack": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 7199999
            }
          },
          "required": [
            "annual_gross_salary"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason": false,
            "was_employee_informed": false
          }
        }
      }
    ]
  },
  "DEU": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "work_hours_per_week",
      "contract_duration_type",
      "annual_gross_salary",
      "effective_date",
      "job_title",
      "role_description",
      "experience_level",
      "work_schedule"
    ],
    "properties": {
      "additional_comments": {
        "type": "string",
        "maxLength": 20000
      },
      "additional_comments_toggle": {
        "type": "boolean"
      },
      "annual_gross_salary": {
        "type": "integer"
      },
      "contract_duration_type": {
        "type": "string",
        "oneOf": [
          {
            "const": "indefinite"
          },
          {
            "const": "fixed_term"
          }
        ]
      },
      "contract_end_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date",
        "maxLength": 255
      },
      "effective_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date"
      },
      "experience_level": {
        "type": "string",
        "oneOf": [
          {
            "const": "Level 2 - Entry Level - Employees who perform operational tasks with an average level of complexity. They perform their functions with limited autonomy"
          },
          {
            "const": "Level 3 - Associate - Employees who perform independently tasks and/or with coordination and control functions"
          },
          {
            "const": "Level 4 - Mid-Senior level - Employees with high professional functions, executive management responsibilities, who supervise the production with an initiative and operational autonomy within the responsibilities delegated to them"
          },
          {
            "const": "Level 5 - Director - Directors perform functions of an ongoing nature that are of significant importance for the development and implementation of the company's objectives"
          },
          {
            "const": "Level 6 - Executive - An Executive is responsible for running an organization. They create plans to help their organizations grow"
          }
        ]
      },
      "job_title": {
        "type": "string",
        "maxLength": 255
      },
      "job_title_change_ack": {
        "type": [
          "string",
          "null"
        ]
      },
      "part_time_salary_confirmation": {
        "type": "string"
      },
      "reason_for_change": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "annual_pay_adjustment"
          },
          {
            "const": "error_correction"
          },
          {
            "const": "job_change_reevaluation"
          },
          {
            "const": "promotion"
          },
          {
            "const": "other"
          },
          {
            "const": null
          }
        ]
      },
      "reason_for_change_description": {
        "type": "string",
        "maxLength": 1000
      },
      "role_description": {
        "type": "string",
        "maxLength": 5000,
        "minLength": 100
      },
      "salary_decrease_reason": {
        "type": "string",
        "oneOf": [
          {
            "const": "change_in_working_hours"
          },
          {
            "const": "trade_salary_for_equity"
          },
          {
            "const": "error_in_initial_salary"
          },
          {
            "const": "role_change_or_demotion"
          },
          {
            "const": "compensation_restructure"
          },
          {
            "const": "other"
          }
        ]
      },
      "salary_decrease_reason_description": {
        "type": [
          "string"
        ],
        "maxLength": 1000
      },
      "was_employee_informed": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          },
          {
            "const": null
          }
        ]
      },
      "work_hours_per_week": {
        "type": "number"
      },
      "work_schedule": {
        "type": "string",
        "oneOf": [
          {
            "const": "full_time"
          },
          {
            "const": "part_time"
          }
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "fixed_term"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "contract_end_date"
          ]
        },
        "else": {
          "properties": {
            "contract_end_date": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "part_time_salary_confirmation"
          ]
        },
        "else": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "reason_for_change": {
              "const": "other"
            }
          },
          "required": [
            "reason_for_change"
          ]
        },
        "then": {
          "required": [
            "reason_for_change_description"
          ]
        },
        "else": {
          "properties": {
            "reason_for_change_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "salary_decrease_reason": {
              "const": "other"
            }
          },
          "required": [
            "salary_decrease_reason"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason_description"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "additional_comments_toggle": {
              "const": true
            }
          },
          "required": [
            "additional_comments_toggle"
          ]
        },
        "then": {
          "required": [
            "additional_comments"
          ]
        },
        "else": {
          "properties": {
            "additional_comments": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "role_description": {
              "const": "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise."
            }
          },
          "required": [
            "role_description"
          ]
        },
        "else": {
          "properties": {
            "job_title_change_ack": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 7199999
            }
          },
          "required": [
            "annual_gross_salary"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason": false,
            "was_employee_informed": false
          }
        }
      }
    ]
  },
  "GBR": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "uk_country",
      "compensation_currency_code",
      "work_hours_per_week",
      "annual_gross_salary",
      "effective_date",
      "job_title",
      "role_description",
      "work_schedule",
      "experience_level"
    ],
    "properties": {
      "additional_comments": {
        "type": "string",
        "maxLength": 20000
      },
      "additional_comments_toggle": {
        "type": "boolean"
      },
      "annual_gross_salary": {
        "type": "integer"
      },
      "compensation_currency_code": {
        "type": "string",
        "oneOf": [
          {
            "const": "GBP"
          },
          {
            "const": "USD"
          }
        ]
      },
      "contract_duration_fixed_term_reason": {
        "type": "string",
        "maxLength": 250,
        "minLength": 15
      },
      "contract_duration_type": {
        "type": "string",
        "oneOf": [
          {
            "const": "indefinite"
          },
          {
            "const": "fixed_term"
          }
        ]
      },
      "contract_end_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date",
        "maxLength": 255
      },
      "effective_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date"
      },
      "experience_level": {
        "type": "string",
        "oneOf": [
          {
            "const": "Level 2 - Entry Level - Employees who perform operational tasks with an average level of complexity. They perform their functions with limited autonomy"
          },
          {
            "const": "Level 3 - Associate - Employees who perform independently tasks and/or with coordination and control functions"
          },
          {
            "const": "Level 4 - Mid-Senior level - Employees with high professional functions, executive management responsibilities, who supervise the production with an initiative and operational autonomy within the responsibilities delegated to them"
          },
          {
            "const": "Level 5 - Director - Directors perform functions of an ongoing nature that are of significant importance for the development and implementation of the company's objectives"
          },
          {
            "const": "Level 6 - Executive - An Executive is responsible for running an organization. They create plans to help their organizations grow"
          }
        ]
      },
      "job_title": {
        "type": "string",
        "maxLength": 255
      },
      "job_title_change_ack": {
        "type": [
          "string",
          "null"
        ]
      },
      "part_time_salary_confirmation": {
        "type": [
          "string",
          "null"
        ]
      },
      "reason_for_change": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "annual_pay_adjustment"
          },
          {
            "const": "error_correction"
          },
          {
            "const": "job_change_reevaluation"
          },
          {
            "const": "promotion"
          },
          {
            "const": "other"
          },
          {
            "const": null
          }
        ]
      },
      "reason_for_change_description": {
        "type": "string",
        "maxLength": 1000
      },
      "role_description": {
        "type": "string",
        "maxLength": 5000,
        "minLength": 100
      },
      "salary_decrease_reason": {
        "type": "string",
        "oneOf": [
          {
            "const": "change_in_working_hours"
          },
          {
            "const": "trade_salary_for_equity"
          },
          {
            "const": "error_in_initial_salary"
          },
          {
            "const": "role_change_or_demotion"
          },
          {
            "const": "compensation_restructure"
          },
          {
            "const": "other"
          }
        ]
      },
      "salary_decrease_reason_description": {
        "type": [
          "string"
        ],
        "maxLength": 1000
      },
      "uk_country": {
        "type": "string",
        "oneOf": [
          {
            "const": "great_britain"
          },
          {
            "const": "northern_ireland"
          }
        ]
      },
      "was_employee_informed": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          },
          {
            "const": null
          }
        ]
      },
      "work_hours_per_week": {
        "type": "number"
      },
      "work_schedule": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "full_time"
          },
          {
            "const": "part_time"
          },
          {
            "const": null
          }
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "fixed_term"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "contract_end_date",
            "contract_duration_fixed_term_reason"
          ]
        },
        "else": {
          "properties": {
            "contract_duration_fixed_term_reason": false,
            "contract_end_date": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "compensation_currency_code": {
              "const": "USD"
            },
            "work_schedule": {
              "const": "full_time"
            }
          },
          "required": [
            "compensation_currency_code",
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "annual_gross_salary"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "compensation_currency_code": {
              "const": "GBP"
            },
            "work_schedule": {
              "const": "full_time"
            }
          },
          "required": [
            "compensation_currency_code",
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "annual_gross_salary"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "part_time_salary_confirmation"
          ]
        },
        "else": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "reason_for_change": {
              "const": "other"
            }
          },
          "required": [
            "reason_for_change"
          ]
        },
        "then": {
          "required": [
            "reason_for_change_description"
          ]
        },
        "else": {
          "properties": {
            "reason_for_change_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "salary_decrease_reason": {
              "const": "other"
            }
          },
          "required": [
            "salary_decrease_reason"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason_description"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "additional_comments_toggle": {
              "const": true
            }
          },
          "required": [
            "additional_comments_toggle"
          ]
        },
        "then": {
          "required": [
            "additional_comments"
          ]
        },
        "else": {
          "properties": {
            "additional_comments": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "role_description": {
              "const": "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise."
            }
          },
          "required": [
            "role_description"
          ]
        },
        "else": {
          "properties": {
            "job_title_change_ack": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 6158130
            },
            "compensation_currency_code": {
              "const": "GBP"
            }
          },
          "required": [
            "annual_gross_salary",
            "compensation_currency_code"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 8342855
            },
            "compensation_currency_code": {
              "const": "USD"
            }
          },
          "required": [
            "annual_gross_salary",
            "compensation_currency_code"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        }
      }
    ]
  },
  "POL": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "compensation_currency_code",
      "effective_date",
      "job_title",
      "annual_gross_salary",
      "role_description",
      "contract_duration_type",
      "work_schedule",
      "work_hours_per_week",
      "experience_level"
    ],
    "properties": {
      "additional_comments": {
        "type": "string",
        "maxLength": 20000
      },
      "additional_comments_toggle": {
        "type": "boolean"
      },
      "annual_gross_salary": {
        "type": "integer"
      },
      "compensation_currency_code": {
        "type": "string",
        "oneOf": [
          {
            "const": "PLN"
          },
          {
            "const": "EUR"
          },
          {
            "const": "USD"
          }
        ]
      },
      "contract_duration_type": {
        "type": "string",
        "oneOf": [
          {
            "const": "indefinite"
          },
          {
            "const": "fixed_term"
          }
        ]
      },
      "contract_end_date": {
        "type": "string",
        "format": "date",
        "maxLength": 255
      },
      "effective_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date"
      },
      "experience_level": {
        "type": "string",
        "oneOf": [
          {
            "const": "Level 2 - Entry Level - Employees who perform operational tasks with an average level of complexity. They perform their functions with limited autonomy"
          },
          {
            "const": "Level 3 - Associate - Employees who perform independently tasks and/or with coordination and control functions"
          },
          {
            "const": "Level 4 - Mid-Senior level - Employees with high professional functions, executive management responsibilities, who supervise the production with an initiative and operational autonomy within the responsibilities delegated to them"
          },
          {
            "const": "Level 5 - Director - Directors perform functions of an ongoing nature that are of significant importance for the development and implementation of the company's objectives"
          },
          {
            "const": "Level 6 - Executive - An Executive is responsible for running an organization. They create plans to help their organizations grow"
          }
        ]
      },
      "job_title": {
        "type": "string",
        "maxLength": 255
      },
      "job_title_change_ack": {
        "type": [
          "string",
          "null"
        ]
      },
      "part_time_salary_confirmation": {
        "type": [
          "string",
          "null"
        ]
      },
      "reason_for_change": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "annual_pay_adjustment"
          },
          {
            "const": "error_correction"
          },
          {
            "const": "job_change_reevaluation"
          },
          {
            "const": "promotion"
          },
          {
            "const": "other"
          },
          {
            "const": null
          }
        ]
      },
      "reason_for_change_description": {
        "type": "string",
        "maxLength": 1000
      },
      "role_description": {
        "type": "string",
        "maxLength": 5000,
        "minLength": 100
      },
      "salary_decrease_reason": {
        "type": "string",
        "oneOf": [
          {
            "const": "change_in_working_hours"
          },
          {
            "const": "trade_salary_for_equity"
          },
          {
            "const": "error_in_initial_salary"
          },
          {
            "const": "role_change_or_demotion"
          },
          {
            "const": "compensation_restructure"
          },
          {
            "const": "other"
          }
        ]
      },
      "salary_decrease_reason_description": {
        "type": [
          "string"
        ],
        "maxLength": 1000
      },
      "was_employee_informed": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          },
          {
            "const": null
          }
        ]
      },
      "work_hours_per_week": {
        "type": "number"
      },
      "work_schedule": {
        "type": "string",
        "oneOf": [
          {
            "const": "full_time"
          },
          {
            "const": "part_time"
          }
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "work_hours_per_week"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "part_time_salary_confirmation"
          ]
        },
        "else": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "fixed_term"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "contract_end_date"
          ]
        },
        "else": {
          "properties": {
            "contract_end_date": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "reason_for_change": {
              "const": "other"
            }
          },
          "required": [
            "reason_for_change"
          ]
        },
        "then": {
          "required": [
            "reason_for_change_description"
          ]
        },
        "else": {
          "properties": {
            "reason_for_change_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "salary_decrease_reason": {
              "const": "other"
            }
          },
          "required": [
            "salary_decrease_reason"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason_description"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "additional_comments_toggle": {
              "const": true
            }
          },
          "required": [
            "additional_comments_toggle"
          ]
        },
        "then": {
          "required": [
            "additional_comments"
          ]
        },
        "else": {
          "properties": {
            "additional_comments": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "role_description": {
              "const": "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise."
            }
          },
          "required": [
            "role_description"
          ]
        },
        "else": {
          "properties": {
            "job_title_change_ack": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 31127687
            },
            "compensation_currency_code": {
              "const": "PLN"
            }
          },
          "required": [
            "annual_gross_salary",
            "compensation_currency_code"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 7199999
            },
            "compensation_currency_code": {
              "const": "EUR"
            }
          },
          "required": [
            "annual_gross_salary",
            "compensation_currency_code"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 8342423
            },
            "compensation_currency_code": {
              "const": "USD"
            }
          },
          "required": [
            "annual_gross_salary",
            "compensation_currency_code"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        }
      }
    ]
  },
  "CHE": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "effective_date",
      "job_title",
      "annual_gross_salary",
      "role_description",
      "contract_duration_type",
      "work_schedule",
      "work_hours_per_week",
      "experience_level"
    ],
    "properties": {
      "additional_comments": {
        "type": "string",
        "maxLength": 20000
      },
      "additional_comments_toggle": {
        "type": "boolean"
      },
      "annual_gross_salary": {
        "type": "integer"
      },
      "contract_duration_type": {
        "type": "string",
        "oneOf": [
          {
            "const": "indefinite"
          },
          {
            "const": "fixed_term"
          }
        ]
      },
      "contract_end_date": {
        "type": "string",
        "format": "date",
        "maxLength": 255
      },
      "effective_date": {
        "type": [
          "string",
          "null"
        ],
        "format": "date"
      },
      "experience_level": {
        "type": "string",
        "oneOf": [
          {
            "const": "Level 2 - Entry Level - Employees who perform operational tasks with an average level of complexity. They perform their functions with limited autonomy"
          },
          {
            "const": "Level 3 - Associate - Employees who perform independently tasks and/or with coordination and control functions"
          },
          {
            "const": "Level 4 - Mid-Senior level - Employees with high professional functions, executive management responsibilities, who supervise the production with an initiative and operational autonomy within the responsibilities delegated to them"
          },
          {
            "const": "Level 5 - Director - Directors perform functions of an ongoing nature that are of significant importance for the development and implementation of the company's objectives"
          },
          {
            "const": "Level 6 - Executive - An Executive is responsible for running an organization. They create plans to help their organizations grow"
          }
        ]
      },
      "job_title": {
        "type": "string",
        "maxLength": 255
      },
      "job_title_change_ack": {
        "type": [
          "string",
          "null"
        ]
      },
      "part_time_salary_confirmation": {
        "type": [
          "string",
          "null"
        ]
      },
      "reason_for_change": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "annual_pay_adjustment"
          },
          {
            "const": "error_correction"
          },
          {
            "const": "job_change_reevaluation"
          },
          {
            "const": "promotion"
          },
          {
            "const": "other"
          },
          {
            "const": null
          }
        ]
      },
      "reason_for_change_description": {
        "type": "string",
        "maxLength": 1000
      },
      "role_description": {
        "type": "string",
        "maxLength": 5000,
        "minLength": 100
      },
      "salary_decrease_reason": {
        "type": "string",
        "oneOf": [
          {
            "const": "change_in_working_hours"
          },
          {
            "const": "trade_salary_for_equity"
          },
          {
            "const": "error_in_initial_salary"
          },
          {
            "const": "role_change_or_demotion"
          },
          {
            "const": "compensation_restructure"
          },
          {
            "const": "other"
          }
        ]
      },
      "salary_decrease_reason_description": {
        "type": [
          "string"
        ],
        "maxLength": 1000
      },
      "was_employee_informed": {
        "type": [
          "string",
          "null"
        ],
        "oneOf": [
          {
            "const": "yes"
          },
          {
            "const": "no"
          },
          {
            "const": null
          }
        ]
      },
      "work_hours_per_week": {
        "type": "number"
      },
      "work_schedule": {
        "type": "string",
        "oneOf": [
          {
            "const": "full_time"
          },
          {
            "const": "part_time"
          }
        ]
      }
    },
    "allOf": [
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "part_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "required": [
            "part_time_salary_confirmation"
          ]
        },
        "else": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "work_schedule": {
              "const": "full_time"
            }
          },
          "required": [
            "work_schedule"
          ]
        },
        "then": {
          "properties": {
            "part_time_salary_confirmation": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "contract_duration_type": {
              "const": "fixed_term"
            }
          },
          "required": [
            "contract_duration_type"
          ]
        },
        "then": {
          "required": [
            "contract_end_date"
          ]
        },
        "else": {
          "properties": {
            "contract_end_date": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "reason_for_change": {
              "const": "other"
            }
          },
          "required": [
            "reason_for_change"
          ]
        },
        "then": {
          "required": [
            "reason_for_change_description"
          ]
        },
        "else": {
          "properties": {
            "reason_for_change_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "salary_decrease_reason": {
              "const": "other"
            }
          },
          "required": [
            "salary_decrease_reason"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason_description"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason_description": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "additional_comments_toggle": {
              "const": true
            }
          },
          "required": [
            "additional_comments_toggle"
          ]
        },
        "then": {
          "required": [
            "additional_comments"
          ]
        },
        "else": {
          "properties": {
            "additional_comments": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "role_description": {
              "const": "Responsible for contributing to team projects, collaborating with colleagues, and achieving business objectives through dedicated work and professional expertise."
            }
          },
          "required": [
            "role_description"
          ]
        },
        "else": {
          "properties": {
            "job_title_change_ack": false
          }
        }
      },
      {
        "if": {
          "properties": {
            "annual_gross_salary": {
              "maximum": 7199999
            }
          },
          "required": [
            "annual_gross_salary"
          ]
        },
        "then": {
          "required": [
            "salary_decrease_reason",
            "was_employee_informed"
          ]
        },
        "else": {
          "properties": {
            "salary_decrease_reason": false,
            "was_employee_informed": false
          }
        }
      }
    ]
  }
};

/**
 * Countries whose contract-amendment form the live Sandbox cannot produce.
 * A 500 is not a 404: it is not "this country has no form", it is "the request
 * was never evaluated". RemoteClient.getContractAmendmentSchema() maps both to
 * null, and UC-06 escalates — but the mock answers the status the API answers,
 * so a client that ever starts treating the two differently fails here first.
 */
export const CONTRACT_AMENDMENT_SCHEMA_ERRORS = { NGA: 500, USA: 500 };
