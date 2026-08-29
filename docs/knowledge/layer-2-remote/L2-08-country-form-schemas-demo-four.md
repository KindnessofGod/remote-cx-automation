# L2-08 · Per-country form schemas — NLD · PRT · CAN · USA

| | |
|---|---|
| **Catalogue id** | L2-08 — a **demo-scoped extension of L2-04** (`docs/KNOWLEDGE-SOURCES.md` §5). L2-04 records the form list and Remote's do-not-cache instruction; this file records the four countries' actual schemas, and which of them a gate can survive. |
| **Source name** | "Show form schema" — Remote API, live Sandbox responses |
| **Publisher / authority** | Remote Europe Holding, B.V. |
| **Exact URLs** | `https://gateway.remote-sandbox.com/v1/countries/{NLD\|PRT\|CAN\|USA}/{contract_details\|employment_basic_information}` — eight calls, all HTTP 200 |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN` |
| **Byte counts + SHA-256** | see the manifest table below — one line per call |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_countries_country_code_form.md> — HTTP 200, **28,302 bytes**, SHA-256 `531b19c0ae447160ec0bfd3ab4c88d51599e6d028610d1a842093bc484c5a509`, `updatedAt: 2026-05-27T21:26:44.000Z` |
| **Source `updatedAt`** | The live schema JSON carries none. It carries `x-rmt-meta` instead — see "The version signal Remote actually gives" below. |
| **Licence / basis for inclusion** | Remote's public integrator documentation and its live Sandbox. **Field names, types, required-lists, enum members and the numeric bounds a gate reads — described and quoted in the small.** No schema is mirrored: the largest here is 145 KB and Remote's own reference tells integrators to fetch it rather than hold it. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` throughout, except where a line is explicitly marked otherwise. |

## Retrieval manifest

| URL path | HTTP | Bytes | SHA-256 |
|---|---|---|---|
| `/v1/countries/NLD/contract_details` | 200 | 100,273 | `9b9e3beaced999b6b7a3c5e5d0993152f61f2864a0407e2bb24ee710adb86a48` |
| `/v1/countries/PRT/contract_details` | 200 | 110,237 | `74e0b4bc3263f5febb798cc53840bb491ad9ac5304fb2bcd06a11ef1f9b0387b` |
| `/v1/countries/CAN/contract_details` | 200 | 145,112 | `209ff25f26babaffbc6fb82036a6a25e17258d22e134b45c78451ae6e3e50291` |
| `/v1/countries/USA/contract_details` | 200 | 142,624 | `d90a16abcff4c2bf173d2260541a72a4005cc2da61604bccc23064e5154176b2` |
| `/v1/countries/NLD/employment_basic_information` | 200 | 49,709 | `5ea158d64fe8bd29d32fd4472a20843cc4f078031bbf050ba2573425d2e89b0e` |
| `/v1/countries/PRT/employment_basic_information` | 200 | 49,706 | `b56104b891f82a33e9d5c4e93483ebb2b6ba0ef147d0c97f0f14d16322d48f8b` |
| `/v1/countries/CAN/employment_basic_information` | 200 | 49,704 | `bea49dd5153c53145efc5369016784264fb7c6371147a5d6ed495bbf4d3c0238` |
| `/v1/countries/USA/employment_basic_information` | 200 | 49,549 | `fcd1b9a6bec4b9eb26e68b34cffdb790720c5b2adb4454487de7c170524cc018` |
| `/v1/countries/NL/contract_details` (alpha-2 control) | **404** | 31 | `00560f1c13eb5b702c916e49091d7cbf9b8fee744b723fb41eed4c91e6b6e95a` |
| `/v1/countries/US/contract_details` (alpha-2 control) | **404** | 31 | `00560f1c13eb5b702c916e49091d7cbf9b8fee744b723fb41eed4c91e6b6e95a` |

---

## 1. The path is keyed on ALPHA-3, and the negative control proves it

`NLD`, `PRT`, `CAN`, `USA` → HTTP 200.
`NL`, `US` → HTTP **404**, body exactly `{"message":"Country not found"}`.

The two 404 bodies are byte-identical to each other, which is worth saying out
loud: **a country this account cannot see and a country code in the wrong
alphabet return the same thing.** Nothing in the response distinguishes "we do
not support Nauru" from "you sent two letters where three were wanted".

`src/remote/restClient.js#getCountrySchema()` already resolves alpha-2 → alpha-3
from `GET /v1/countries` before calling, and fails closed to `null` when it
cannot. That is the correct shape and this capture does not disturb it.

## 2. `employment_basic_information` has no salary and no hours — on all four

Identical `properties` set across NLD, PRT, CAN and USA — **ten properties**:

```
has_seniority_date, job_title, login_email, name, personal_email,
provisional_start_date, seniority_date, tax_job_category,
tax_servicing_countries, work_email
```

`required` (all four): `has_seniority_date`, `name`, `job_title`,
`provisional_start_date`, `tax_servicing_countries`, `tax_job_category`,
`login_email`. `additionalProperties: false`.

**There is no `annual_gross_salary` property and no `work_hours_per_week`
property anywhere in this form, for any of the four countries.** This is the
independent live re-confirmation of the defect recorded in `CLAUDE.md` §4: a
salary amendment validated against this form could never pass, because the form
cannot express one. The right form is the contract-amendment form — L2-09.

## 3. `contract_details` — the form that does carry money

| | NLD | PRT | CAN | USA |
|---|---|---|---|---|
| properties | 46 | 40 | 46 | 42 |
| `required` entries | 27 | 21 | 22 | 21 |
| `additionalProperties` | `false` | `false` | `false` | `false` |
| conditional `allOf` rules | 15 | 12 | 72 | **81** |
| `x-rmt-meta` | `{"jsfVersion":"1"}` | `{"jsfOldVersion":true}` | `{"jsfOldVersion":true}` | `{"jsfVersion":"1"}` |

Fields a money or hours gate would reach for:

| Field | NLD | PRT | CAN | USA |
|---|---|---|---|---|
| `annual_gross_salary` | `integer`, `minimum: 0`, **required** | `integer`, **required** | `integer`, **required** | `integer`, **NOT in `required`** — conditional, see §5 |
| `hourly_gross_salary` | absent | absent | absent | `integer`, conditional |
| `work_hours_per_week` | `number`, **required** | `number`, *not* required | `number`, **required** | `number`, **required** |
| `notice_period` | `number`, **required** | **absent** | **absent** | absent (`notice_period_weeks`, nullable, optional) |
| `probation_length` | `number`, required | `["number","null"]`, `minimum 0`, `maximum 6`, optional | `["number","null"]`, optional | absent (`probation_length_days`, `["number","null"]`, optional) |
| `available_pto` | `number`, required | `number`, required | `number`, **`minimum: 10`**, required | `number`, required |
| `available_pto_type` | `"unlimited"` \| `"fixed"`, required | same | same | same |
| `wage_type` | absent | absent | absent | `"salary"` \| `"hourly"`, **required** |

**Nullability that a gate depends on**, stated exactly as the schema states it:
`probation_length` on PRT and CAN is typed `["number","null"]` — a schema-legal
`null`, not an absence. `flsa_classification` (USA) is `["string","null"]` with
`null` an explicit `oneOf` member. Both are values a validator that treats
`null` as "missing" will misread; see §7.

## 4. `available_pto_type: "unlimited"` exists on all four — the money trap, located

Every one of the four `contract_details` schemas offers
`available_pto_type ∈ {"unlimited", "fixed"}`, and the property is **required**.
So an unlimited-PTO employment is representable in all four demo countries.

**No employment in this Sandbox currently has one** — see L3-07, which swept all
63 NLD/PRT/CAN/USA employments and found `type: "limited"` on every balance and
a `days` key on every one. The trap is real in the contract, absent from the
data, and therefore *not demonstrable in this demo without fabricating a
record*. Recorded here so nobody concludes from the empty sweep that the schema
does not allow it.

## 5. USA carries state-level jurisdiction rules — and `src/` models none of it

This is the largest single finding of the four-country capture.

**`state_of_residency` is a REQUIRED property of the US `contract_details`
form.** Title, verbatim: *"Employee's US state of residency"*. Type `string`,
**51 `oneOf` members** — the 50 states plus DC, each as a bare two-letter
`const` (`"AL"`, `"AK"`, `"AZ"`, …) with a display `title`. Note the form's
enum is the bare state letter, while `GET /v1/countries`'s
`country_subdivisions` uses the ISO 3166-2 form (`"US-CA"`). **Two different
representations of the same state, in two Remote responses, one demo apart.**

Also required and US-only: `wage_type` (`salary` | `hourly`), `job_code` (a
10-member occupational enum: `senior_managers`, `mid_managers`,
`professionals`, `technicians`, `sales_workers`,
`administrative_support_workers`, `craft_workers`, `operatives`,
`laborers_and_helpers`, `service_workers`), `schedule_type`.

**`annual_gross_salary` is not in the US `required` list.** It becomes required
only through a conditional, and the conditional also *forbids* the other form:

```
if   wage_type == "hourly"
then required [hourly_gross_salary];  annual_gross_salary: false
else required [annual_gross_salary];  hourly_gross_salary: false,
                                      flsa_classification: false
```

A `false` in a `properties` block is a prohibition, not an absence. Carrying a
salary through on an hourly amendment is a rejection, not a harmless extra.

**And the minimum wage is a per-state numeric floor, in minor units.** Of the
81 `allOf` rules, a large family has the shape:

```
if   state_of_residency == "CA" and wage_type == "hourly"
then hourly_gross_salary.minimum = 1990
     description: "In California, the minimum hourly salary is $19.90.
                   We apply the higher of state or city minimum wage."
```

**There are exactly 34 such state minimum-wage rules** (of 60 rules keyed on
`state_of_residency` in total), every floor in ×100 minor units, read from the
payload:

```
WA 2130  CO 1929  AZ 1835  DC 1795  NY 1700  CT 1694  ME 1675  IL 1660
OR 1630  HI 1600  RI 1600  NJ 1592  DE 1500  MA 1500  MD 1500  MO 1500
NE 1500  VT 1442  MI 1373  AK 1300  FL 1300  VA 1277  NM 1200  NV 1200
SD 1185  MN 1141  AR 1100  OH 1100  MT 1085  VI 1050  PR 1050  GU  925
WV  875
```

(33 listed plus CA 1990, held out above as the worked example — 34 in total.
Note `VI`, `PR` and `GU` are territories, which the form's 51-member
`state_of_residency` enum does not contain: **three rules key on a value the
enum cannot hold.**) Plus a federal floor pair: full-time salaried
`annual_gross_salary.minimum = 3556800` (*"Must be greater or equal to
$35,568.00"*) and hourly `minimum = 725` (*"$7.25"*).

**These are Remote's numbers, live-dated, in ×100 minor units, and nothing in
`src/` reads them.** There is no US-state model in this repository at all —
`grep` finds no state table, and `normalizeEmployment()` surfaces no state
field. Two consequences worth naming:

1. A US amendment or incentive built by this system cannot be checked against
   the floor that governs it. The check exists — it is on Remote's side, and it
   will reject on write. So the failure mode is a *refused write late*, not a
   wrong payment: a loud failure, which is the safe direction.
2. The state IS obtainable, but inconsistently. Of the two US employments read
   in full, one (`e818418e-…`, global_payroll) carries
   `address_details: {state: "MN", address, city, postal_code}`; the other
   (`2f7f8210-…`, EOR `employee`) has **no `address_details` key at all**.
   Neither carries `contract_details.state_of_residency`. So "read the state
   off the record" works for some employment types and silently yields
   `undefined` for others.

## 6. The version signal Remote actually gives

There is no `updatedAt` on the live schema. There is `x-rmt-meta`, and it
differs **within the demo set**: NLD and USA report `{"jsfVersion":"1"}`; PRT
and CAN report `{"jsfOldVersion":true}`. Two form-engine generations are in
production simultaneously across four countries. Any staleness monitor should
hash the schema body per (country, form) rather than look for a timestamp that
is not there.

L2-04 records Remote's own instruction not to cache these schemas. Nothing in
this file is a cache: it is a description of what four of them said on one day.

## 7. Mismatches against `src/` — reported, not fixed

Ranked by whether a wrong number or a wrong decision could reach a human.

1. **`src/shared/schemaValidator.js` treats `null` as missing, but these
   schemas make `null` a legal value of a required field.** The validator's
   whole body is `value === undefined || value === null || value === ""` →
   `missing`. On the amendment form (L2-09) `effective_date` is required *and*
   typed `["string","null"]`; on `contract_details`, PRT/CAN
   `probation_length` and USA `flsa_classification` are the same shape. A
   payload that is valid to Remote is reported as invalid here. **Direction is
   safe** — a spurious `schema_invalid` escalates rather than writes — but the
   recorded reason names the wrong cause, which is the failure mode `CLAUDE.md`
   §5's upstream-attribution work exists to remove.
2. **The validator checks presence only; these schemas' real content is in
   `allOf`.** `validateAgainstSchema()` reads `schema.required` and nothing
   else — it cannot see the 81 US rules, the 72 Canadian ones, or a single
   `minimum`. `src/uc06/policyEngine.js#effectiveSchema()` *does* resolve
   `if`/`then`/`else` including numeric bounds, and correctly returns `null`
   for a condition it does not model. So the repo has two schema readers of
   very different depth and the shallow one is the shared/default one. Worth
   knowing before a fifth use case reaches for `validateAgainstSchema`.
3. **`getCountrySchema()` still points at `employment_basic_information`.**
   That is correct for what it says it does (onboarding basic information) and
   its header says so, and UC-06 has moved off it. Recorded only so that the
   ten-property, no-salary shape above is not read as a live defect.
