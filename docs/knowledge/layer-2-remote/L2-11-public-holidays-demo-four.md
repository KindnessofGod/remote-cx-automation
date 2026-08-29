# L2-11 · `GET /v1/countries/{code}/holidays/{year}` — NLD · PRT · CAN · USA

| | |
|---|---|
| **Catalogue id** | L2-11 — a **demo-scoped extension of L2-03 / L1-10** (`docs/KNOWLEDGE-SOURCES.md`). L2-03 records the `Holiday` schema; this file records the four demo countries' actual 2026 lists and two ways of reading them that silently produce a wrong day count. |
| **Source name** | "List Public Holidays" — Remote API, live Sandbox |
| **Publisher / authority** | The underlying authority is national. **Remote is the carrier**, and the catalogue's own recommendation is to prefer the carrier (L1-10). |
| **Exact URLs** | `https://gateway.remote-sandbox.com/v1/countries/{NLD\|PRT\|CAN\|USA}/holidays/2026`, plus three controls listed below |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN`. Seven calls, all HTTP 200. |
| **Byte counts + SHA-256** | manifest below |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_countries_country_code_holidays_year.md> — HTTP 200, **22,378 bytes**, SHA-256 `eeb682ea33888a4bf3d30b9bf1ea09432d8ca067cfa6f542d3c32d9f23c43f59` (byte-identical to the L2-03 capture, so the page has not moved) |
| **Source `updatedAt`** | `2026-05-27T21:26:44.000Z` on the reference page. The live JSON carries none. |
| **Licence / basis for inclusion** | Public-holiday **dates are facts**; the list is served under Remote's API terms in-integration. Four countries × one year, because that is the demo. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## Retrieval manifest

| URL | HTTP | Bytes | Rows | SHA-256 |
|---|---|---|---|---|
| `/v1/countries/NLD/holidays/2026` | 200 | 1,116 | 11 | `9b6737350c7ea0d0e175e2da5fd92cfc832c1ae7a86b38abba5fa2c4ce57d678` |
| `/v1/countries/PRT/holidays/2026` | 200 | 1,437 | 13 | `a35912aef87ea72b2892e76873c128504b443b9e0c33afa4418fde63101cdae3` |
| `/v1/countries/CAN/holidays/2026` | 200 | 423 | **5** | `4c14bc7215b4cbf5f5f27bf25b4f195bfe985b3f57190935fc5f14621a7c6495` |
| `/v1/countries/USA/holidays/2026` | 200 | 980 | 11 | `2445f71e40c6217a4334520a97ae68c70c6192cf182c36be64030ad66fb5903a` |
| `…/CAN/holidays/2026?country_subdivision_code=CA-ON` | 200 | 389 | **4** | `5b53b4dde9fb2c6821b1f5067d941e5f35aeaa286d3d18877a4777ba13f101d9` |
| `…/USA/holidays/2026?country_subdivision_code=US-CA` | 200 | **11** | **0** | `8fe32e407a1038ee38753b70e5374b3a46d6ae9d5f16cd5b73c53abaca8f5ed0` |
| `…/NLD/holidays/2027` | 200 | **11** | **0** | `8fe32e407a1038ee38753b70e5374b3a46d6ae9d5f16cd5b73c53abaca8f5ed0` |

The last two share a SHA-256 because both bodies are literally `{"data":[]}`.

## Envelope and row shape

`data` is a **bare array of `Holiday` objects** — no `data.holidays` wrapper.
Every row carried exactly four keys:

```json
{"name":"New Year's Day (Nieuwjaarsdag)","day":"2026-01-01",
 "note":null,"observed_day":"2026-01-01"}
```

**Nullability, live**: `note` was `null` on **all 40 rows** across the four
countries. `observed_day` was **non-null on all 40** and equal to `day` on all
40. Per L2-03 both are schema-nullable while `name` and `day` are required, so
the correct read remains `observed_day ?? day` — but the fallback is
**unexercised in this data**, which means a bug in it would not show up in any
demo built from these four countries.

## The four lists (2026)

**NLD — 11.** 01-01 New Year's Day · 04-03 Good Friday · 04-05 Easter ·
04-06 Easter Monday · 04-27 Royal Day · 05-05 Liberation Day · 05-14 Ascension ·
05-24 Pentecost · 05-25 Pentecost Monday · 12-25 Christmas · 12-26 Boxing Day

**PRT — 13.** 01-01 · 04-03 Good Friday · 04-05 Easter · 04-25 Freedom Day ·
05-01 Labor Day · 06-04 Corpus Christi · 06-10 Portugal Day ·
08-15 Assumption · 10-05 Republic Implantation · 11-01 All Saints ·
12-01 Restoration of Independence · 12-08 Immaculate Conception · 12-25 Christmas

**USA — 11**, and they are the **federal** holidays: 01-01 · 01-19 MLK Jr. Day ·
02-16 Washington's Birthday · 05-25 Memorial Day · 06-19 Juneteenth ·
07-04 Independence Day · 09-07 Labor Day · 10-12 Columbus Day ·
11-11 Veterans Day · 11-26 Thanksgiving · 12-25 Christmas

**CAN — 5, and only 5.** 01-01 New Year's Day · 04-03 Good Friday ·
07-01 Canada Day · 09-07 Labour Day · 12-25 Christmas

## The two reads that are silently wrong

### (a) A subdivision query returns a DISJOINT set, not a superset

`CAN/holidays/2026?country_subdivision_code=CA-ON` returns **four rows, none of
which appear in the national five**: 02-16 Family Day · 05-18 Victoria Day ·
10-12 Thanksgiving Day · 12-26 Boxing Day.

So for an Ontario employee the correct answer is the **union — 9 days**.
Querying *with* the subdivision alone yields 4 and loses Canada Day. Querying
*without* it yields 5 and loses Family Day. **Both single calls return a
plausible, well-formed, wrong list**, and neither errors. Any business-day or
notice-end-date arithmetic built on one call is wrong for every Canadian
employee, in a direction that depends on which call you made.

This matters specifically for the demo: **8 of Canada's 9 active employments
are `global_payroll_employee`**, the model whose amendment path *does* work
(L2-09), so Canada is the country most likely to carry a date calculation.

### (b) An unsupported query and an empty year both return `200 {"data":[]}`

`USA?country_subdivision_code=US-CA` → **0 rows**. Not a 404, not an error — an
empty list. So "this country has no per-state holidays in Remote's data" and
"this subdivision code is not one Remote serves" are indistinguishable, and
both read downstream as *"no holidays"*.

`NLD/holidays/2027` → **0 rows**, same body. A future year returns an empty
list rather than a 404. `KNOWLEDGE-SOURCES.md` L1-10 warned of exactly this
(*"the failure mode is an empty or short list that reads as 'no holidays', not
as an error"*) — this is that warning confirmed live, for a year only four
months away.

Fail-closed handling therefore has to distinguish `[]` from a fetched list on
some signal other than the payload: at minimum, refuse to compute a business-day
count from an empty holiday list rather than treating zero holidays as a fact.

## Mismatch against `src/` — reported, not fixed

**Nothing in `src/` calls this endpoint.** `grep -rn "holidays" src/` returns
no consumer, and `src/remote/mockServer.js` does not serve the route either.
So:

- `KNOWLEDGE-SOURCES.md` L1-10 lists public holidays as feeding UC-05 (notice
  end dates and anchor rules), UC-06 (cutoff arithmetic) and UC-07 (onboarding
  lead times). **None of those three reads it.** UC-05's anchor rules —
  Germany's 15th/end-of-month, Poland's 1st-of-month — are computed without any
  holiday input at all.
- That is not currently producing a wrong number, because no code path counts
  business days. It becomes one the moment a path does, and the two traps above
  are waiting for it.

Recorded as an unwired source rather than a defect: the endpoint is real, the
data is good, and the consumer does not exist yet.
