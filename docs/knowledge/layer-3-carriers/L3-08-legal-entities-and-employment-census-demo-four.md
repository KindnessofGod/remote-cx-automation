# L3-08 · Legal entities and the employment census — NLD · PRT · CAN · USA

| | |
|---|---|
| **Catalogue id** | L3-08 — a **demo-scoped extension of L3-06** (`docs/KNOWLEDGE-SOURCES.md` §6). L3-06 flagged an *"armed, not-yet-fired alpha-3 trap"* on `CompanyLegalEntity.country_code`; this file fires the test against live rows and settles it. It also carries the employment census the demo is scoped on, because the two questions share one payload. |
| **Source name** | "List Company Legal Entities" and "List employments" — Remote API, live Sandbox |
| **Publisher / authority** | The customer, carried by Remote |
| **Exact URLs** | `https://gateway.remote-sandbox.com/v1/companies/a9d4ce72-7773-4ea3-830d-c5b36a15e48d/legal-entities` · `…/v1/employments?page_size=100[&page=2]` · `…/v1/employments/{id}` × 8 |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`. All HTTP 200. |
| **Byte counts + SHA-256** | manifest below |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_companies_company_id_legal-entities.md> — HTTP 200, **40,205 bytes**, SHA-256 `9031ab3b40a167d7b2abd57082656c51931e26087f647bee320417d88e72bb49`, `updatedAt: 2026-05-27T21:23:52.000Z` |
| **Source `updatedAt`** | None on the live JSON; the reference page's is above. |
| **Licence / basis for inclusion** | 🔒 **Per-tenant customer data**, from a Sandbox tenant this project owns. Entity **ids, `country_code`, `is_default`, `global_payroll_enabled`** are recorded because the alpha-3 question is about that exact field, and entity **names are recorded only as the auto-generated Sandbox seed strings they are** ("Rempel-Paucek 4C3WAC — Acme Netherlands BV"), which name no real company. **No individual's name, email, address, phone, bank detail or tax identifier is transcribed anywhere in this file** — all were present in the payloads read and all are deliberately omitted. Employments are identified by UUID only. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## Retrieval manifest

| URL | HTTP | Bytes | SHA-256 |
|---|---|---|---|
| `/v1/companies/a9d4ce72-…/legal-entities` | 200 | 1,216 | `4c2742220bd9358214d5c0817d94bb9a35ec211816baa2eb578a91e9b7b6292a` |
| `/v1/legal-entities` (control — is there a top-level route?) | **404** | 11 | `57aefd8046010e86f09187427e21bad3376b25a2f9a46ce20452ac7d5448298d` |
| `/v1/employments?page_size=100` | 200 | 78,021 | `bc4e5c5e90f4156b340d58fa47e4192703ae5a00dfae8f0ceb100c749eba4b7e` |
| `/v1/employments?page_size=100&page=2` | 200 | 9,394 | `03b3088081c859d34522903491cdd8568932f40324047a2f0f833f8cb4515238` |
| `/v1/employments/673a1884-…` (NLD eor) | 200 | 2,934 | `eebe1900cd1fdc726ce66fcea1fac5d74ec48887466d465acc69496690752937` |
| `/v1/employments/293527ed-…` (NLD gpe) | 200 | 5,889 | `98787827ef943097039e37d8ea558f2706543b8189c327541e63fb04cb5512b7` |
| `/v1/employments/378eee6b-…` (PRT eor) | 200 | 3,097 | `d97c844bb64e4176933bcb4fbeea936d59d321ee7f2e21b709c217a572c9d7b7` |
| `/v1/employments/e1898674-…` (PRT contractor) | 200 | 3,217 | `f1ebbbcff7e36694a100c0e0953c83619488a0896461a6d119da2b30ec6fd243` |
| `/v1/employments/20b1346b-…` (CAN gpe) | 200 | 5,635 | `808e4fb47dec5bbcbc290d78bea31a54ec77e07396b13ab05b382d63d050698a` |
| `/v1/employments/3537d9ee-…` (CAN contractor) | 200 | 3,308 | `615a55a6ecd19bcf9117b00352ffa3d898a12eb67e763d299372b8ec84e9ca9f` |
| `/v1/employments/2f7f8210-…` (USA eor) | 200 | 2,989 | `60a9440018c00ce98c7e0cdc44ed534cf59feeb5d915d913dacb11447fa208cd` |
| `/v1/employments/e818418e-…` (USA gpe) | 200 | 4,888 | `984bc0494ca1f6ec5768322bdfd58c615ed36e1b3938720feeb317fdf5f0340e` |

---

## 1. `CompanyLegalEntity.country_code` is ALPHA-3 — confirmed, trap fires

Seven entities, envelope `data.legal_entities[]` with
`{total_count, current_page, total_pages}`. Row keys, all five of them:
`id`, `name`, `country_code`, `is_default`, `global_payroll_enabled`.

| `country_code` | `is_default` | `global_payroll_enabled` | id |
|---|---|---|---|
| **`USA`** | **`true`** | `false` | `30aec65a-28c4-4961-ac70-0e10ad9e81fb` |
| **`USA`** | `false` | `true` | `f216db68-662c-47bd-97ae-c83a5c0ac830` |
| **`CAN`** | `false` | `true` | `7cdd0ba8-eaec-4254-a2be-a4224a2536cd` |
| **`NLD`** | `false` | `true` | `721bdcc0-d433-4eb7-98fb-00deb8f2b560` |
| `FRA` | `false` | `true` | `1b55591c-ca30-496e-ba0f-7f75d38968bd` |
| `DEU` | `false` | `true` | `9484d878-96bd-43ec-aeb6-ee7c6b5f88f7` |
| `SGP` | `false` | `true` | `44b80f28-62e1-4de6-9922-ae119e4537d6` |

**`country_code` here is the ISO alpha-3 form**, despite the field being named
`country_code` — the same name every alpha-2-keyed table in `src/` uses
(`src/uc05/noticePeriodTable.js`, `src/uc03/policyEngine.js`,
`src/uc09/policyEngine.js`). L3-06's flagged trap is real: a set membership test
`ALPHA2_SET.has(entity.country_code)` is false forever, silently.

**There is no PRT legal entity.** Portugal is in the demo four and has no entity
of its own — see §2.

Note also that the route is company-scoped: `/v1/legal-entities` is a **404**,
so a company id is mandatory, and the id must come from an employment record's
`company_id`.

## 2. Entity ≠ employment country, and that is correct, not a bug

Read from the eight full employment records:

| employment | country | model | `engaged_by_legal_entity_id` → entity country |
|---|---|---|---|
| `293527ed-…` | NLD | `global_payroll_employee` | `721bdcc0-…` → **NLD** |
| `20b1346b-…` | CAN | `global_payroll_employee` | `7cdd0ba8-…` → **CAN** |
| `e818418e-…` | USA | `global_payroll_employee` | `f216db68-…` → **USA** |
| `673a1884-…` | NLD | eor `employee` | `30aec65a-…` → **USA** (the default entity) |
| `378eee6b-…` | PRT | eor `employee` | `30aec65a-…` → **USA** |
| `2f7f8210-…` | USA | eor `employee` | `30aec65a-…` → **USA** |
| `e1898674-…` | PRT | `contractor` | `30aec65a-…` → **USA** |
| `3537d9ee-…` | CAN | `contractor` | `30aec65a-…` → **USA** |

`bill_to_legal_entity_id` equalled `engaged_by_legal_entity_id` on all eight.

So **global-payroll employments are engaged by an entity in their own country;
EOR employees and contractors are engaged by the company's default entity,
which here is American.** That is the EOR model working as designed — the whole
point of EOR is that the worker's country needs no entity of the customer's —
and it is exactly why Portugal has four active workers and zero entities.

**The consequence to be careful about:** any rule of the form *"the entity's
country is the employment's country"* is **false for 5 of these 8 records**, and
a permanent-establishment or mobility reading built on that join would place a
Portuguese EOR employee under a US entity. Nothing in `src/` currently makes
that join — `normalizeEmployment()` surfaces `legal_entity_id` and stops there,
and no risk path resolves it. Recorded as a trap to avoid arming, not one
currently firing.

## 3. Employment census — all 112, both pages, live

`data.employments[]` with `{total_count: 112, current_page, total_pages}`.
**Page 1 returns 100; a second page is required.** Anything that reads one page
sees 100 of 112 and cannot tell.

**The four demo countries, by status × type:**

| | NLD | PRT | CAN | USA |
|---|---|---|---|---|
| `active` / `employee` (EOR) | **1** | **1** | 0 | **7** |
| `active` / `global_payroll_employee` | **12** | 0 | **8** | **15** |
| `active` / `contractor` | 0 | **3** | **1** | 0 |
| **active total** | **13** | **4** | **9** | **22** |
| `archived` | 0 | 2 | 3 | 5 |
| other (`invited`/`initiated`/`created`/`created_reserve_paid`) | 0 | 2 | 0 | 3 |
| **grand total** | **13** | **8** | **12** | **30** |

**Two corrections to the census the demo scope was set from**, offered as
observations rather than objections — both readings are of the same account on
the same day, and mine reads both pages:

- **NLD active is 13, not 10** (12 `global_payroll_employee` + 1 EOR
  `employee`). PRT 4 ✅ and CAN 9 ✅ match exactly.
- **USA active is 22, not 21** (15 `global_payroll_employee` + 7 EOR
  `employee`). The US is still comfortably the largest country — 22 of 60
  active across the demo four, and more than twice NLD.

**Employment `type` values across the whole account:** `contractor`,
`employee`, `global_payroll_employee`, `direct_employee`.
**`employment_model`:** `contractor`, `eor`, `global_payroll`, `direct`.

**Does the US expose a `type` the other three do not?** Against *active*
employments, no — the US carries `employee` and `global_payroll_employee`, the
same pair as NLD, so that reading holds. Against the **full** census it does:
USA also has `archived/contractor` (3), `created/employee` (1),
`created_reserve_paid/contractor` (1) and **`initiated/direct_employee`** (1).
`direct_employee` is the type not present in NLD or CAN at all — though **PRT
also has one** (`invited/direct_employee`), so it is not US-exclusive either.
No `hris` employment exists anywhere in the account.

**Statuses observed:** `active`, `archived`, `invited`, `initiated`, `created`,
`created_awaiting_reserve`, `created_reserve_paid`. That last pair matters for
UC-06: Remote's reference restricts
`PUT /v1/employments/{id}/basic-information` to `created`,
`job_title_review`, `created_reserve_paid`, `created_awaiting_reserve` — and
**no active employment is ever in one of those**, which is the third of the
three independent reasons that write could never have served UC-06
(`restClient.js`'s own header). This census confirms the status sets are indeed
disjoint in practice: 0 of the 48 active employments in the demo four is in any
admissible status for that endpoint.

## 4. Employment-record shapes the demo depends on

`GET /v1/employments/{id}` returned **46 top-level keys** for employees and **49** for contractors. Facts checked
against all eight records:

| Question | Answer |
|---|---|
| Is `country` nested? | Yes — `{code: "NLD", alpha_2_code: "NL", name, supported_json_schemas}`. **No top-level `country_code`.** |
| Is there a `custom_fields` key? | **No — absent on all eight.** This is why `src/remotebridge/enrichment.js` injects `workation_permission` for UC-04 and names it in `X-Standin-Enriched`. |
| Is there a `basic_information.start_date`? | **No.** The record carries `provisional_start_date` (top-level *and* inside `basic_information`) and `seniority_date`. `normalizeEmployment()` already falls back `provisional_start_date → seniority_date → null`. |
| `probation_period_end_date`? | Present as a **top-level** field; `null` on both US records read. |
| Is `company_id` present? | Yes — `a9d4ce72-7773-4ea3-830d-c5b36a15e48d` on all eight, one tenant. |
| `active_contract_id`? | Present on all eight. |
| `address_details`? | **Inconsistent.** Present on `global_payroll_employee` records (US one carries `{state:"MN", address, city, postal_code}`); **absent entirely** on the EOR `employee` records. |

**`contract_details` breadth is the demo's real constraint** (see L2-09 §"Payload
derivability"):

| record | model | `contract_details` keys | salary? | `work_hours_per_week`? |
|---|---|---|---|---|
| `293527ed-…` NLD | `global_payroll_employee` | **26** | yes | **yes** |
| `20b1346b-…` CAN | `global_payroll_employee` | **23** | yes | **yes** |
| `e818418e-…` USA | `global_payroll_employee` | **6** | yes | **no** |
| `2f7f8210-…` USA | eor `employee` | **6** | yes | **no** |
| `673a1884-…` NLD | eor `employee` | **4** | yes | **no** |
| `378eee6b-…` PRT | eor `employee` | **4** | yes | **no** |
| `3537d9ee-…` CAN | `contractor` | **2** (`payment_terms`, `service_duration`) | **no** | **no** |
| `e1898674-…` PRT | `contractor` | **2** | **no** | **no** |

**Breadth is a property of the record, not of the model or the country.** Both
US records — one EOR, one global payroll — carry six keys, while the Dutch and
Canadian global-payroll records carry 23–26. So "global payroll employments have
full contract details" is false: it happens to hold for NLD and CAN in this
Sandbox and fails for the US.

A contractor record carries **no salary field of any kind**. Any money gate
reached with a contractor employment has nothing to read, and
`contract-amendments/schema` 404s for them anyway (L2-09).

## 5. Mismatches against `src/` — reported, not fixed

1. **`CompanyLegalEntity.country_code` is alpha-3 while every consuming set in
   `src/` is alpha-2** (§1). Not currently fired — no risk path resolves the
   entity — so it stays exactly what L3-06 called it: armed, not yet fired.
   The instructive part is that the field is *named* `country_code`, which is
   the same name `normalizeEmployment()` deliberately produces in **alpha-2**.
   Two fields, one name, two alphabets.
2. **`normalizeEmployment()` retains the latent alpha-3 fallback**
   `raw.country?.alpha_2_code ?? raw.country_code ?? raw.country?.code`,
   guarded by `pickAlpha2()`'s shape test so an alpha-3 becomes `null` rather
   than a wrong string. Confirmed correct by reading the function. Recorded
   because `CLAUDE.md` §7 standing issue 3 still lists the unguarded form; the
   guard is present in the code today.
3. **No entity → country join exists, and should not be added naively** (§2).
   5 of 8 records would be mis-attributed.
4. **A one-page employment read misses 12 of 112** (§3). `listPayrollRuns()`
   pages properly; the employments read here needed an explicit `page=2`.
