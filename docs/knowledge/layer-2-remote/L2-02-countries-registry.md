# L2-02 · `GET /v1/countries` — Remote's supported-country registry

| | |
|---|---|
| **Catalogue id** | L2-02 (`docs/KNOWLEDGE-SOURCES.md` §5) |
| **Source name** | "List countries" — Remote API reference |
| **Publisher / authority** | Remote Europe Holding, B.V. ("Remote") |
| **Exact URL** | <https://developer.remote.com/reference/get_v1_countries.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 28,455 bytes. |
| **SHA-256 of the retrieved bytes** | `81e97af364b8cac815e013ab1d192ac7b3d70a9d84bf68f719fee88559154f33` |
| **Source `updatedAt`** | `2026-05-27T21:26:44.000Z` (front-matter on the fetched page) |
| **Licence / basis for inclusion** | Remote's public integrator documentation. **Schema facts and short attributed quotations only**, for the fields this repository actually reads — not the page, not the 224-row dataset. Reproducing Remote's country list as a standalone dataset is not ours to grant (`KNOWLEDGE-SOURCES.md` L2-02: *"Do not republish as a standalone dataset"*), and it is unnecessary: the registry is live-queryable. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## Remote's own words about what this list means

Quoted verbatim from the page, because this repository has already made one
expensive mistake about exactly this sentence:

> Returns a list of all countries that are supported by Remote API alphabetically
> ordered. The supported list accounts for creating employment with basic
> information and it does not imply fully onboarding employment via JSON Schema.
> **The countries present in the list are the ones where creating a company is
> allowed.**

And the `Country` schema's own one-line description:

> A supported country on Remote

## The `Country` object — every property, with Remote's own description

| Property | Type | Remote's description |
|---|---|---|
| `alpha_2_code` | string | The ISO 3166-1 alpha-2 country code (e.g., "PT"). |
| `code` | string | The ISO 3166-1 alpha-3 country code (e.g., "PRT"). **This is the primary code used across the Remote API.** |
| `name` | string | The country's full English name. |
| `eor_onboarding` | boolean | Whether EOR (Employer of Record) onboarding is available in this country. |
| `contractor_products_available` | array | Contractor product names available for this country |
| `country_subdivisions` | array | Administrative subdivisions of the country (e.g., states, provinces, districts). Null if the country has no subdivisions relevant to Remote's services |
| `supported_json_schemas` | array | The list of JSON schema form names available for this country (e.g., "address_details", "contract_details"). Use these with the Show form schema endpoint. |
| `employment_agreement_preview_available` | boolean | Whether an Employment Agreement preview is available for this country. |
| `locked_benefits` | string | When benefit plan selections become locked for this country (e.g., "after_first_hire"…) |
| `region` | string | The geographic region the country belongs to (e.g., "Europe", "Asia", "Americas"). |
| `subregion` | string | The geographic subregion (e.g., "Southern Europe", "Southeast Asia"). Null for some countries. |

**Required:** `alpha_2_code`, `code`, `name` — and *nothing else*. `eor_onboarding`
is **optional**, which matters: a row may omit it entirely, and an absent flag is
not `false`.

## Why this page is vendored at all — three things it settles

**1. `code` is alpha-3, and the page says so in the field's own description.**
`CLAUDE.md` §5 records the defect this caused: UC-03's supported-countries gate
compared 2-letter destinations against a list mapped from `code`, so `ES` never
matched `ESP` and `supportedCountries` came back `[]` after a *successful*
224-row fetch — a use case that structurally could not succeed. The description
above ("**the primary code used across the Remote API**") is also why the same
trap keeps reappearing: alpha-3 is the API's default, so any new read that
reaches for "the country code" gets alpha-3 unless it asks for `alpha_2_code`.
See `docs/research/COUNTRY-SUPPORT-SEMANTICS.md`.

**2. Registry membership is not a travel predicate, and neither is
`eor_onboarding`.** Membership means *creating a company is allowed*; the EOR
flag means Remote can *employ* someone there. Neither answers "may this person
spend three weeks here." `src/uc04/riskMatrix.js` carries a positive test that
fails if anyone later "tightens" the jurisdiction screen to the EOR flag.

**3. `supported_json_schemas` is on this object.** The per-country list of
available forms rides on the country row itself, so the L2-04 form-name key can
be *read* rather than guessed. That is directly relevant to the UC-06 defect in
`CLAUDE.md` §4 — validating against a form with no salary property. See
`L2-04-country-form-schemas.md`.

## Cadence and staleness

224 rows on two captures on two separate days, agreeing exactly
(`KNOWLEDGE-SOURCES.md` L2-02, `[CONFIRMED — live]`). Detection is a row count
plus a set diff on each poll. Cheap and reliable; no curation obligation at all,
which is why the catalogue names this the model entry for what to prefer.
