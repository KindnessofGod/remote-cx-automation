# L2-07 · `GET /v1/countries` — the four demo rows (NLD · PRT · CAN · USA)

| | |
|---|---|
| **Catalogue id** | L2-07 — a **demo-scoped extension of L2-02** (`docs/KNOWLEDGE-SOURCES.md` §5). L2-02 documents the `Country` schema; this file records the four rows the narrowed demo actually depends on. |
| **Source name** | "List countries" — Remote API, live Sandbox response |
| **Publisher / authority** | Remote Europe Holding, B.V. ("Remote") |
| **Exact URL** | `https://gateway.remote-sandbox.com/v1/countries?page_size=250` |
| **Retrieved** | **2026-08-19**, by Node `fetch` through this container's egress proxy (`NODE_USE_ENV_PROXY=1`), bearer `REMOTE_API_TOKEN`. HTTP 200, **340,515 bytes**, 224 rows. |
| **SHA-256 of the retrieved bytes** | `ea7bfbf8c07201da8124ee56fe94b1b133e0982d685028491d4dca393fd75936` |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_countries.md> — see L2-02 for its own checksum and `updatedAt`. |
| **Source `updatedAt`** | The live JSON API carries none. The reference page it implements does: `2026-05-27T21:26:44.000Z` (L2-02). |
| **Licence / basis for inclusion** | Remote's data, read inside a Remote integration. **Four rows of 224, because four is what the demo needs.** `KNOWLEDGE-SOURCES.md` L2-02 says *"Do not republish as a standalone dataset"*, and the registry is live-queryable, so mirroring it buys nothing. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

---

## Envelope shape — one thing checked rather than assumed

`data` is a **bare array of country objects**. There is no `data.countries`
wrapper and no flat `country_code` property on a row.

```
Object.keys(response)      -> ["data"]
Array.isArray(data)        -> true
data.length                -> 224
```

This is the shape `src/remote/restClient.js`'s `listSupportedCountries()`
already reads. It is **not** the shape `src/remote/mockServer.js` serves — see
the mismatch note at the foot of this file.

## The four rows, in full — every property the object carries

Long `country_subdivisions` arrays are summarised by count and type rather than
listed: they are the bulkiest part of the payload and the demo reads none of
them except the US `state_of_residency` question handled in L2-08.

| Property | **NLD** | **PRT** | **CAN** | **USA** |
|---|---|---|---|---|
| `code` (alpha-3) | `NLD` | `PRT` | `CAN` | `USA` |
| `alpha_2_code` | `NL` | `PT` | `CA` | `US` |
| `name` | Netherlands | Portugal | Canada | United States |
| `region` | Europe | Europe | Americas | Americas |
| `subregion` | Western Europe | Southern Europe | Northern America | Northern America |
| `eor_onboarding` | `true` | `true` | `true` | `true` |
| `employment_agreement_preview_available` | `false` | `false` | `false` | **`true`** |
| `contractor_products_available` | `["standard","plus","cor"]` | same | same | same |
| `locked_benefits` | `after_first_hire` | `after_first_hire` | `after_first_hire` | `after_first_hire` |
| `country_subdivisions` | 12 × `Province` | 18 × `District` + 2 × `Autonomous region` | 10 × `Province` + 3 × `Territory` | 50 × `State` + 1 × `District` |
| `supported_json_schemas` | 5 forms | 6 forms | 6 forms | 5 forms |

`supported_json_schemas`, verbatim, because L2-08 depends on it:

- **NLD** — `administrative_details`, `contract_details`, `employment_basic_information`, `emergency_contact`, `address_details`
- **PRT** — `additional_documents`, `administrative_details`, `contract_details`, `employment_basic_information`, `emergency_contact`, `address_details`
- **CAN** — `additional_documents`, `administrative_details`, `contract_details`, `employment_basic_information`, `address_details`, `emergency_contact`
- **USA** — `administrative_details`, `employment_basic_information`, `emergency_contact`, `contract_details`, `address_details`

**`contract_amendment` is on none of these lists.** The amendment form is not
a country form; it is served by a different endpoint with a different key
(L2-08). Reading this list as the inventory of forms available for an
amendment is how UC-06 came to validate a salary change against
`employment_basic_information`.

## What `eor_onboarding: true` does and does not say

All four are `true`, so the flag distinguishes nothing inside this demo set —
which makes it a safe place to restate the semantics without an argument riding
on it. `eor_onboarding` says **Remote can employ someone in this country**. It
is not a statement that an employed person may *travel* there, and registry
membership itself means only that *creating a company is allowed*
(`docs/research/COUNTRY-SUPPORT-SEMANTICS.md`; L2-02 quotes Remote's own
sentence). `src/uc04/riskMatrix.js` carries a positive test that fails if
anyone later "tightens" a jurisdiction screen onto this flag.

Also unchanged from L2-02 and worth repeating because it is a nullability
claim: only `alpha_2_code`, `code` and `name` are **required**.
`eor_onboarding` may be absent, and **absent is not `false`.** All four demo
rows happen to carry it; a fifth country might not.

## Which alpha form each surface wants — verified, not inferred

| Surface | Wants | Evidence |
|---|---|---|
| `country.code` on this row | **alpha-3** | `NLD` / `PRT` / `CAN` / `USA` in the payload above |
| `country.alpha_2_code` on this row | alpha-2 | `NL` / `PT` / `CA` / `US` |
| `GET /v1/countries/{code}/{form}` path | **alpha-3 only** | `…/NLD/contract_details` → 200; `…/NL/contract_details` → **404 `{"message":"Country not found"}`** (31 bytes, sha `00560f1c…`). Same for `US`. |
| `GET /v1/expenses/categories?country_code=` | **alpha-3 only** | `NLD` → 200; `NL` → **422 `{"errors":{"country_code":["is invalid"]}}`** (L2-12) |
| Every country-keyed table in `src/` | alpha-2 | `src/uc05/noticePeriodTable.js`, `src/uc03/policyEngine.js`, `src/uc09/policyEngine.js` |

## Mismatch against `src/` — reported, not fixed

**`src/remote/mockServer.js` teaches a shape the live API does not use.** It
serves `{data:{countries:[…]}}` with flat `{country_code}` rows. The live API
serves `{data:[…]}` with `{code, alpha_2_code}`. This is already named as
standing issue 4 in `CLAUDE.md` §7, and this capture re-confirms it live: the
fixture agrees with an older reading of the code rather than with Remote.
Nothing here changes it.

## Cadence and staleness

224 rows, matching the two prior captures recorded in `KNOWLEDGE-SOURCES.md`
L2-02 exactly. Detection remains a row count plus a set diff per poll.
