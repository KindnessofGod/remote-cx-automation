# L2-03 (and L1-10) · `GET /v1/countries/{code}/holidays/{year}` — public holiday calendars

| | |
|---|---|
| **Catalogue id** | L2-03, carrying **L1-10** (`docs/KNOWLEDGE-SOURCES.md` §4, §5) |
| **Source name** | "List all holidays of a country" — Remote API reference |
| **Publisher / authority** | **Authority: national.** **Carrier: Remote.** The catalogue deliberately lists this in both layers and recommends the carrier. |
| **Exact URL** | <https://developer.remote.com/reference/get_v1_countries_country_code_holidays_year.md> |
| **Retrieved** | **2026-08-19**, by `curl`. HTTP 200, 22,378 bytes. |
| **SHA-256 of the retrieved bytes** | `eeb682ea33888a4bf3d30b9bf1ea09432d8ca067cfa6f542d3c32d9f23c43f59` |
| **Source `updatedAt`** | `2026-05-27T21:26:44.000Z` |
| **Licence / basis for inclusion** | Schema facts only. **The dates themselves are facts and are not reproduced here** — they are per country per year and must be fetched live (see "never cache across a year boundary" below). Served under Remote's API terms in-integration. |
| **Evidence tag** | `[CONFIRMED — schema, fetched 2026-08-19]` |

## Remote's own words

> List all holidays of a country for a specific year. Optionally, it can be
> filtered by country subdivision.

**Scope required:** `country:read`, under `company_admin`.

## The `Holiday` object — complete

| Property | Type | Nullable | Remote's description |
|---|---|---|---|
| `day` | string (`date`) | no | Date of the holiday |
| `name` | string | no | Name of the holiday |
| `note` | string | **yes** | Notes about the holiday |
| `observed_day` | string (`date`) | **yes** | Date when the holiday is observed |

**Required:** `name`, `day`. `observed_day` is nullable — so the correct read is
`observed_day ?? day`, and a `null` here means "observed on the day itself", not
"missing data".

Remote's own example, verbatim:

```json
{ "day": "2021-01-01", "name": "New Year's Day",
  "note": "The day after New Year's Eve", "observed_day": "2021-01-02" }
```

## Why this matters to three use cases

- **UC-05** — notice-period end dates and the anchor rules (Germany's
  15th/end-of-month, Poland's 1st-of-month) are business-day arithmetic.
- **UC-06** — payroll cutoff arithmetic.
- **UC-07** — minimum-onboarding-time business-day lead times.

`KNOWLEDGE-SOURCES.md` L1-10 puts the failure mode precisely: *"a business-day
count that silently includes a public holiday produces a date that is simply
wrong and looks right."* That is Test B, and it is why this is a TABLE and never
a corpus entry.

## The staleness rule, which is a hard rule and not a preference

**Fetch per country per year. Never cache across a year boundary.** The failure
mode is not an error — it is an **empty or short list that reads as "no
holidays"**. A successful HTTP 200 carrying `[]` for a year Remote has not
populated is indistinguishable, at the call site, from a country with no public
holidays.

This is the same shape as the payroll-calendar exhaustion documented in
`L2-05-payroll-runs-calendar.md`, and the same remedy applies: the check is
**"does this response cover the date I am asking about?"**, not "did the fetch
succeed?"
