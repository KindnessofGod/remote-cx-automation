# L3-06 · `GET /v1/companies/{company_id}/legal-entities` — the customer's entity footprint

> Carrier only. **🔒 No customer's entity list appears in this file.**

| | |
|---|---|
| **Catalogue id** | L3-06 (`docs/KNOWLEDGE-SOURCES.md` §6) |
| **Source name** | "List Company Legal Entities" — Remote API reference |
| **Publisher / authority** | Remote (carrier). **Authority is the customer.** |
| **Exact URL** | <https://developer.remote.com/reference/get_v1_companies_company_id_legal-entities.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 40,205 bytes. |
| **SHA-256 of the retrieved bytes** | `9031ab3b40a167d7b2abd57082656c51931e26087f647bee320417d88e72bb49` |
| **Source `updatedAt`** | `2026-05-27T21:23:52.000Z` |
| **Licence / basis for inclusion** | Schema facts and short attributed quotations only. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## Remote's own words

> Lists all **active** legal entities for the authorized company specified in the
> request.

Scope: `company:read` under `company_admin`.

Note "active" — the endpoint does not enumerate dissolved or dormant entities, so
absence from this list is not proof a company never had a presence somewhere.

## The `CompanyLegalEntity` object — complete

| Property | Type | Remote's description |
|---|---|---|
| `id` | string | Company slug |
| `name` | string | The registered name of the legal entity. |
| **`country_code`** | string | **ISO 3166-1 alpha-3 country code (e.g., 'USA', 'GBR', 'DEU')** |
| `global_payroll_enabled` | boolean | Whether Global Payroll services are enabled for this legal entity. |
| `is_default` | boolean | Indicates if this is the default legal entity for the company |

**Required:** `id`, `global_payroll_enabled`, `name`. **`country_code` is
optional** — a legal entity may come back with no country at all, and an absent
country is not "no presence".

## ⚠ Finding: this read carries the alpha-3 trap, and it is not yet triggered

`country_code` here is **alpha-3** — Remote's page says so in the field's own
description. Every risk path that would consume this footprint compares
**alpha-2** destination codes (`SCHENGEN`, `EU_EEA_FOR_A1`,
`RESTRICTED_JURISDICTIONS`, the UC-04 origin→destination matrix are all alpha-2).

This is the **same bug class** that made UC-03 structurally unable to succeed
(`CLAUDE.md` §5: `ES` never matched `ESP`, and `supportedCountries` came back
`[]` after a *successful* 224-row fetch), and the same class flagged as still
latent in `normalizeEmployment()` (Stage 3.5 standing issue 3). It has not fired
here for one reason only: **`GET /v1/companies/{id}/legal-entities` is currently
unwired — no risk path reads it** (`KNOWLEDGE-SOURCES.md` L3-06:
*"Currently **unused by any risk path**"*).

**So the trap is armed and waiting for the first person to wire the read.** It is
recorded here, at the source, rather than in a use-case doc, because that is
where whoever wires it will look. Note the direction of failure: a silent alpha-3
vs alpha-2 mismatch yields **an empty footprint**, which reads as *"the customer
has no entity there"* — the confident-and-wrong answer, not a loud one.

## Why this entry matters more than its five fields suggest

`KNOWLEDGE-SOURCES.md` L3-06: this is **the single fact that most changes a
permanent-establishment assessment.** An employee working from a country where
the customer *already has an established entity* is a materially different
question from one where they do not. Flagging `pe_risk_dape` without knowing
which case applies produces noise a specialist must resolve by hand every time —
the opposite of decision support.

It is named the **highest-leverage unwired read** for UC-07, and it is used by
UC-04, UC-07 and UC-08.

## Staleness

Customer configuration. Entities are created and dissolved rarely; read at
decision time rather than caching, since the cost is one call and the failure
mode of a stale footprint is a wrong PE framing.
