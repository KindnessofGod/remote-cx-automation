# L2-09 · `GET /v1/contract-amendments/schema` — the form UC-06 actually writes through

| | |
|---|---|
| **Catalogue id** | L2-09 — **new**. `docs/KNOWLEDGE-SOURCES.md` has no entry for the contract-amendment form; L2-04 covers only the country forms, which cannot express a salary change (L2-08 §2). This file adds the missing source. |
| **Source name** | "Show form schema" (Contract Amendments) — Remote API, live Sandbox |
| **Publisher / authority** | Remote Europe Holding, B.V. |
| **Exact URL** | `https://gateway.remote-sandbox.com/v1/contract-amendments/schema?employment_id={id}&country_code={ALPHA3}&form=contract_amendment` |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`. Six calls: 4 × 200, 1 × 404, 2 × 500. |
| **Byte counts + SHA-256** | manifest below |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_contract-amendments_schema.md> — HTTP 200, **52,917 bytes**, SHA-256 `78ec225e07d05c76c1c466004b1384a7af695d0f24ab7615875b1921693ce661`, `updatedAt: 2026-05-27T21:14:24.000Z` |
| **Source `updatedAt`** | None on the live JSON. `x-rmt-meta` is `{"jsfOldVersion":true}` on all four 200s. |
| **Licence / basis for inclusion** | Remote's public integrator documentation and its live Sandbox. Required-lists, property names, enum members and the numeric bounds a gate reads — **in the small.** No schema mirrored. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## Retrieval manifest — the failures are findings, so they are listed first

| Country | employment | model | HTTP | Bytes | SHA-256 |
|---|---|---|---|---|---|
| **USA** | `2f7f8210-91fc-47db-803c-77a1cc625781` | eor `employee` | **500** | 23 | `b86737d295c063056074b2bcae7f0051e0aab7e5e48107fcf9ad8dbc5536454c` |
| **USA** | `e818418e-1db7-431d-a663-9f477addb8bd` | `global_payroll_employee` | **500** | 23 | `b86737d295c063056074b2bcae7f0051e0aab7e5e48107fcf9ad8dbc5536454c` |
| **PRT** | `e1898674-e124-412a-abea-fe9ecab8a6e8` | `contractor` | **404** | 23 | `8fd54eee4277f1327015cc0bcaed8a878bf44d1804364cd5d93dfab9e2d1a5af` |
| NLD | `293527ed-b8af-4fc2-a4ad-1cb87cda1641` | `global_payroll_employee` | 200 | 31,337 | `f4e69fc2960de67e4121601cccba75bcd502ddb65b3272d1422896e2831d504d` |
| NLD | `673a1884-86fb-4101-83d3-b6c544d93bca` | eor `employee` | 200 | 31,762 | `2d14aa5f3c02a36c47caf0040cdea817dad212c4647105d7b9efdd3a61c19211` |
| PRT | `378eee6b-c6db-4484-ba32-7283bd0e2de9` | eor `employee` | 200 | 14,457 | `6cc356034bcb23d48898d433edcb2ea75b0b07f8ac39a2780b19d158518d9f27` |
| CAN | `20b1346b-4673-4227-8261-ba51d10f6b4b` | `global_payroll_employee` | 200 | 60,455 | `36f050ef563d176b03940148a98d1a98de3bf7e2b13d37dfa50f743de660c7a5` |

Exact bodies: 500 → `"Internal Server Error"`. 404 → `{"message":"Not Found"}`.

**The USA 500 is the headline.** Every US employment tried returns a Sandbox
500 on this endpoint, both employment models. `src/remote/restClient.js`
already records the same result from 2026-08-18 across all 81 then-active
employments, so this is a reproducing, week-old condition rather than a blip.
**UC-06 therefore has no working write path for the United States in this
Sandbox**, and adding the US to the demo does not change that. The client
handles it correctly — a 500 is caught and turned into `null`, which the gate
reads as "no schema" and escalates — so the behaviour is right and only the
capability is absent. Recorded so the demo does not stage a US amendment and
discover this on camera.

**The PRT contractor 404 is a different thing and must not be read as the same
thing.** Contract amendments are a form for employment contracts; a contractor
engagement has none. Every `contractor` returns 404 here. So of the four demo
countries, PRT's amendment demo has to use its one active EOR `employee`
(`378eee6b-…`), not one of its three contractors.

## The schemas that answered — what they require

| | NLD (eor) | NLD (gpe) | PRT (eor) | CAN (gpe) |
|---|---|---|---|---|
| properties | 25 | 25 | 18 | 21 |
| `required` | 7 | 7 | 8 | 9 |
| `allOf` rules | 15 | 15 | 12 | **72** |
| `additionalProperties` | `false` | `false` | `false` | `false` |

`required`, verbatim:

- **NLD** — `annual_gross_salary`, `effective_date`, `job_title`, `role_description`, `contract_duration_type`, `work_schedule`, `work_hours_per_week`
- **PRT** — the NLD seven **plus** `experience_level`
- **CAN** — the NLD seven **plus** `experience_level` **plus** `compensation_currency_code`

Types of the three fields a money gate touches, identical across all four:

| Field | Type | Note |
|---|---|---|
| `annual_gross_salary` | `integer` (NLD eor also `minimum: 0`) | ×100 minor units |
| `work_hours_per_week` | `number` | |
| `effective_date` | **`["string","null"]`**, `format: date` | **required AND nullable** — see the mismatch in L2-08 §7.1 |

CAN-only properties worth naming: `compensation_currency_code` (required),
`payout_currency_code`, `province_of_residency`. Canada is the one demo country
whose amendment form carries a subdivision field — and, like the US
`state_of_residency` (L2-08 §5), nothing in `src/` models it.

## The conditional rules are real, employment-specific and live

The `allOf` block is not decoration. Read from `293527ed-…` (NLD
global_payroll, current salary **3,600,000 EUR minor units = €36,000.00**):

```
if   annual_gross_salary.maximum = 3599999        (one cent below current)
then required [salary_decrease_reason, was_employee_informed]
else salary_decrease_reason: false,
     was_employee_informed:  false
```

Note what that `else` says: on an **increase**, those two attestations are
*forbidden*, not merely unnecessary. A resolver that fails to understand
`maximum` and silently takes one branch gets the inverse of Remote's rule in
both directions. `src/uc06/policyEngine.js#effectiveSchema()` returns `null`
for an unmodelled condition rather than picking a branch, which is the correct
handling and is documented in that file at length.

Further live NLD rules, quoted for their numbers:

```
if   holiday_allowance == "Within the salary" and work_schedule == "full_time"
then annual_gross_salary.minimum = 3380305
     "In the Netherlands, full-time employees are entitled to a minimum
      annual salary of €33,803.05 INCLUDING holiday pay"

if   holiday_allowance == "On top of salary" and work_schedule == "full_time"
then annual_gross_salary.minimum = 3129912   (€31,299.12 EXCLUDING holiday pay)

if   work_schedule == "part_time"
then work_hours_per_week.minimum = 1,  maximum = 35
else work_hours_per_week.minimum = 36, maximum = 40,  default_weekly_hours: false
```

Two thresholds also carry `x-jsf-presentation.statement` warnings at ±15% of
current salary (`maximum: 3060000` / `minimum: 4140000` against a €36,000
base) — advisory text, not a constraint. **They are not a gate and must not be
turned into one**: they are a UI warning, and reading a warning as a refusal
would invent a policy Remote did not state.

## Payload derivability — which demo amendments can actually be assembled

The write payload has to be a **complete valid next state**, not a diff
(`CLAUDE.md` §5). So every required field must be either supplied by the
requester or carried through from the employment record. Checked field by field
against each employment's own `contract_details` + `basic_information`
(`effective_date` excluded — the requester always supplies it):

| Country / model | required | derivable | **underivable** |
|---|---|---|---|
| **CAN** `global_payroll_employee` `20b1346b-…` | 9 | **8 of 8** | **none** ✅ |
| **NLD** `global_payroll_employee` `293527ed-…` | 7 | **6 of 6** | **none** ✅ |
| NLD eor `employee` `673a1884-…` | 7 | 2 of 6 | `role_description`, `contract_duration_type`, `work_schedule`, `work_hours_per_week` |
| PRT eor `employee` `378eee6b-…` | 8 | 2 of 7 | `role_description`, `experience_level`, `contract_duration_type`, `work_schedule`, `work_hours_per_week` |
| USA either model | — | — | endpoint 500s; question does not arise |

Cause: the NLD and PRT EOR `employee` records carry a **four-key**
`contract_details` — `wage_type`, `annual_gross_salary`,
`compensation_currency_code`, `available_pto` — while the **NLD and CAN**
`global_payroll_employee` records carry 26 and 23 keys respectively, including
every field the amendment form wants. This is a property of the *record*, not
of the country and not of the employment model: **both US records, EOR and
global payroll alike, carry only six keys** and would be equally underivable if
the endpoint answered at all (L3-08 §4).

**Conclusion for the demo, stated plainly: the only amendment that can be
carried end to end today is a `global_payroll_employee` in NLD or CAN.** PRT
and USA can each demonstrate a correct refusal, and refusals are worth showing
— but only if the demo says which is which, because `CLAUDE.md` §4's standing
lesson is that "structurally cannot succeed" and "appropriately cautious" look
identical from outside.

## Mismatches against `src/` — reported, not fixed

1. **`effective_date` is required and nullable; `validateAgainstSchema()` calls
   `null` missing.** Same defect as L2-08 §7.1, restated here because this is
   the form UC-06 validates against in production. Fails safe (escalate), names
   the wrong reason.
2. **No US state / CA province model exists.** `province_of_residency` (CAN)
   and `state_of_residency` (USA, L2-08) are live schema fields with no
   counterpart anywhere in `src/`. Not currently reachable for the US because
   of the 500, and not currently *required* for CAN — but it is the field a
   Canadian employment-standards rule would key on.
3. **`RemoteClient.getContractAmendmentSchema()` is correct as written** — it
   sends `form=contract_amendment` explicitly, resolves alpha-3, catches the
   500 and returns `null` rather than `{required: []}`. Confirmed against every
   response above. No change needed; recorded so a future reader does not
   "fix" the try/catch that the US 500 depends on.
