# L3-02 · `GET /v1/custom-fields` — the per-tenant policy carrier Remote already provides

> **This file documents a *carrier*, never its contents.** Custom-field *values*
> are customer-confidential Layer 3 data. Nothing in this repository may hold
> them, and no shared store may ever be given one.

| | |
|---|---|
| **Catalogue id** | L3-02 (`docs/KNOWLEDGE-SOURCES.md` §6) |
| **Source name** | "Lists custom fields definitions" / "List custom field value for an employment" — Remote API reference |
| **Publisher / authority** | Remote (carrier). **Authority for the values is the customer.** |
| **Exact URLs** | <https://developer.remote.com/reference/get_v1_custom-fields.md><br><https://developer.remote.com/reference/get_v1_employments_employment_id_custom-fields.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200: 25,065 and 25,097 bytes. |
| **SHA-256 of the retrieved bytes** | `36cd44a69126704c8995d265735ab43b5fd4f9b53b4b0e5aae3f291255daaec8`<br>`3d24dcd42465cabf729f7e24183057232ed552e14b7297b4981257757e075caf` |
| **Source `updatedAt`** | `2026-05-27T21:17:23.000Z` (both) |
| **Licence / basis for inclusion** | Schema facts and short attributed quotations only. **🔒 No customer values, of any tenant, appear here or may ever be vendored.** |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## The sentence the whole tenancy finding rests on, verbatim

`EmploymentCustomField`, Remote's own description:

> A custom field definition that can be applied to employments **within a
> company**. Custom fields allow you to store additional structured data on
> employments beyond the standard fields.

**Company-scoped by construction.** That is the property the repository's own
stores lack — `KNOWLEDGE-SOURCES.md` §2 findings 2a and 2c: neither pgvector
table nor `src/uc02/policyCaps.js` carries a `company_id`.

## The `EmploymentCustomField` object — complete

| Property | Type | Remote's description |
|---|---|---|
| `id` | string | The unique identifier (UUID) of the custom field definition. |
| `name` | string | The display name of the custom field (e.g., "Internal ID", "T-Shirt Size"). |
| `type` | enum | *(enumerated on the page; includes `single_select` and `currency`)* |
| `required` | boolean | Whether this custom field is **required for all employments in the company**. |
| `visibility_scope` | enum | *(who may see the field)* |
| `data_entry_access` | enum | *(who may write the field)* |
| `metadata` | object | Additional configuration for the field. For `single_select` fields, contains the list of selectable options. For `currency` fields, contains the currency code. Null for simple fields. |

**Required:** `id`, `name`, `type`, `required`, `visibility_scope`,
`data_entry_access`, `metadata` — all seven.

Values are read per employment at
`GET /v1/employments/{employment_id}/custom-fields`, and written at
`PATCH /v1/custom-fields/{custom_field_id}/values/{employment_id}`.

## The defect this carrier is the honest home for

`src/uc04/policyEngine.js`'s **first hard gate** reads
`employment.custom_fields.workation_permission` — a property the real employment
record does not have (`docs/research/CROSS-BORDER-FLOW.md` §7 D-1: zero
occurrences on the employment show page's OpenAPI). The deployed workaround
synthesises the field in the read-only stand-in proxy (`src/remotebridge/`), which
keeps the demo green **and the modelling error invisible**. `CLAUDE.md` §6 is
explicit that the stand-in must not be "fixed" away — on raw gateway data UC-04
would block every request with `employer_permission_not_granted`.

The real carrier exists, is already company-scoped, and is quoted above.

**And the naming matters as much as the plumbing.** If a customer configures a
workation-permission switch, output must read it as a **customer** policy and
label it as one — never present it as Remote's rule. `KNOWLEDGE-SOURCES.md` §11
item 2: *"mixed-provenance output is worse than uniformly weak output, because a
reader calibrates their trust to the strongest-looking item on the page."*

## Staleness

Not a poll. The detector is a version or `updated_at` on the **customer's own**
configuration record — it is their data, not a published source. `[INFERRED]`
that Remote exposes such a marker; the two pages retrieved today do not show
one, and the `EmploymentCustomField` object above carries no timestamp field.
That is a real gap in the carrier, recorded rather than papered over.
