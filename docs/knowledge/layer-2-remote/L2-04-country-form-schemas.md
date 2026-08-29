# L2-04 · `GET /v1/countries/{code}/{form}` — per-country JSON form schemas

> `KNOWLEDGE-SOURCES.md` calls this **"the most important single entry in this
> catalogue"**, because it is the only knowledge source in the project that is
> *authoritative, per-country, versioned by its own publisher, and consumed by a
> write gate.* Every other per-country rule in this repository is our curation.
> This one is Remote's.

| | |
|---|---|
| **Catalogue id** | L2-04 (`docs/KNOWLEDGE-SOURCES.md` §5) |
| **Source name** | "Show form schema" — Remote API reference (country forms), plus the contract-amendment variant |
| **Publisher / authority** | Remote Europe Holding, B.V. |
| **Exact URLs** | <https://developer.remote.com/reference/get_v1_countries_country_code_form.md><br><https://developer.remote.com/reference/get_v1_contract-amendments_schema.md><br><https://developer.remote.com/reference/post_v1_contract-amendments.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200 for all three: 28,302 / 52,917 / 61,951 bytes. |
| **SHA-256 of the retrieved bytes** | `531b19c0ae447160ec0bfd3ab4c88d51599e6d028610d1a842093bc484c5a509`<br>`78ec225e07d05c76c1c466004b1384a7af695d0f24ab7615875b1921693ce661`<br>`ac36985ab0cb41d40476b741ff468396fd68115a3c24b09b047869ee0174b936` |
| **Source `updatedAt`** | `2026-05-27T21:26:44.000Z` (country forms) · `2026-05-27T21:14:24.000Z` (contract amendments) |
| **Licence / basis for inclusion** | Schema facts and short attributed quotations only. **The per-country schemas themselves are not reproduced** — they are the live compliance artefact and Remote instructs integrators to query them dynamically (quoted below). Vendoring a snapshot of a schema Remote tells you not to snapshot would be the exact failure this file exists to warn about. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## The complete list of supported form names, verbatim from the page

```
address_details                        contractor_contract_details
administrative_details                 billing_address_details
bank_account_details                   contract_details
employment_basic_information           emergency_contact
contractor_basic_information           emergency_contact_details
employment_document_details            engagement_agreement_details
personal_details                       pricing_plan_details
company_basic_information              global_payroll_administrative_details
global_payroll_bank_account_details    global_payroll_basic_information
global_payroll_contract_details        global_payroll_federal_taxes
global_payroll_state_taxes             global_payroll_personal_details
benefit_renewal_request                hris_personal_details
```

Plus the separate `contract_amendment` form, reached through
`GET /v1/contract-amendments/schema` rather than the country path.

## Remote's own authentication caveat, verbatim

> Most forms require a company access token, as they are dependent on certain
> properties of companies and their current employments. However, the
> `address_details` and `company_basic_information` forms can be accessed using
> `client_credentials` authentication (without a company).

## Remote's own staleness statement, verbatim — the best in the catalogue

From the **Create Contract Amendment** page:

> This endpoint requires and returns country-specific data. The exact required
> and returned fields will vary depending on which country the employment is in.
> […] Please note that the **compliance requirements for each country are subject
> to change according to local laws**. Given its continual updates, using
> Remote's json-schema-form should be considered in order to avoid compliance
> issues and to have the latest version of a country requirements.
>
> If you are using this endpoint to build an integration, make sure you are
> **dynamically collecting or displaying the latest parameters for each country**
> by querying the *"Show form schema"* endpoint.

That is the publisher instructing integrators not to cache. It is also the
strongest single argument in this whole corpus for **"the correct answer to
'what documents do we need?' is sometimes 'none — query the source.'**"

## The lesson attached to this entry: an authoritative table can still be the wrong table

`CLAUDE.md` §4 records that UC-06 validated against `employment_basic_information`
— *"a form with **no salary and no hours property at all**"* — so a salary
amendment could never validate. The source was authoritative. The **key** was
wrong. Being repointed at `/v1/contract-amendments`.

**Two things follow, and both are cheap:**

1. **The form key can be read rather than guessed.** `GET /v1/countries` returns
   `supported_json_schemas` on each country row — *"The list of JSON schema form
   names available for this country […] Use these with the Show form schema
   endpoint"* (see `L2-02-countries-registry.md`). A form name absent from that
   array for a given country is knowably absent before the call is made.
2. **Only a positive test detects a wrong key.** A validator pointed at a form
   with no salary property refuses every salary amendment, which is
   indistinguishable from correct caution. `CLAUDE.md` §5: *"Only a positive
   test — 'this input MUST succeed' — detects a dead gate."*

## Cadence and staleness

Hash the schema per `(country, form)` and alert on change. **A schema change is
a real compliance event, not noise** — it is the highest signal-to-noise monitor
available anywhere in this catalogue, and Remote's own text above says why.
