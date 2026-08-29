# Demo-four capture — index (NLD · PRT · CAN · USA)

**Retrieval pass: 2026-08-19.** Method: Node `fetch` against
`https://gateway.remote-sandbox.com` with `NODE_USE_ENV_PROXY=1` and the
bearer in `REMOTE_API_TOKEN`, plus `curl` against
`https://developer.remote.com` for the reference pages. Every file below
carries its own full provenance header — exact URL, HTTP status, byte count,
SHA-256 of the retrieved bytes, the source's `updatedAt` where one exists, the
licence basis, and an evidence tag.

This index is a map, not a source. **Nothing here is a decision input**: the
same structural rule that governs the rest of `docs/knowledge/` applies —
no `policyEngine.js` imports from any of it, and no id in it appears in a
conditional.

## The eight new files

| File | Layer | What it settles |
|---|---|---|
| [`L2-07-countries-registry-demo-four.md`](L2-07-countries-registry-demo-four.md) | 2 | The four `GET /v1/countries` rows, all eleven properties. `data` is a bare array. `code` is alpha-3. |
| [`L2-08-country-form-schemas-demo-four.md`](L2-08-country-form-schemas-demo-four.md) | 2 | `contract_details` and `employment_basic_information` for all four. **The path is alpha-3 only.** **US carries a required `state_of_residency` and 34 live per-state minimum-wage floors that nothing in `src/` models.** |
| [`L2-09-contract-amendment-schemas-demo-four.md`](L2-09-contract-amendment-schemas-demo-four.md) | 2 | `GET /v1/contract-amendments/schema` — **USA 500s on every employment**, contractors 404. Only an NLD or CAN global-payroll amendment can be assembled end to end. |
| [`L2-10-payroll-calendars-demo-four.md`](L2-10-payroll-calendars-demo-four.md) | 2 | **Portugal has no payroll calendar at all.** `cutoff_date` nullability settled against the OpenAPI *and* the data. Duplicate rows; `total_payroll_cost` typed `integer`, returned `string`. |
| [`L2-11-public-holidays-demo-four.md`](L2-11-public-holidays-demo-four.md) | 2 | A subdivision query returns a **disjoint** set, not a superset — Ontario needs the union. An unsupported subdivision and a future year both return `200 {"data":[]}`. Nothing in `src/` reads this endpoint. |
| [`L2-12-expense-categories-demo-four.md`](L2-12-expense-categories-demo-four.md) | 2 | The known 403 is a **wrong-endpoint** condition, not a credential one; the company-side endpoint returns 32–36 rows per country. Two disjoint category vocabularies. |
| [`L3-07-leave-policies-demo-four.md`](../layer-3-carriers/L3-07-leave-policies-demo-four.md) | 3 | **No `{unlimited}` policy exists on any of the 63 employments** — the money trap is in the schema, not in the data. **Nine active US employments carry a negative PTO balance.** Nothing in `src/` reads the Time Off API. |
| [`L3-08-legal-entities-and-employment-census-demo-four.md`](../layer-3-carriers/L3-08-legal-entities-and-employment-census-demo-four.md) | 3 | `CompanyLegalEntity.country_code` is **alpha-3** — L3-06's flagged trap confirmed. **Portugal has no legal entity.** Full 112-employment census, both pages. |

## Which alpha form each Remote surface wants — one table, all verified live

The single most expensive recurring mistake in this repository, collected in
one place. Each row was tested with both forms on 2026-08-19.

| Surface | Wants | Wrong-form result |
|---|---|---|
| `country.code` on a country row or employment | **alpha-3** | — |
| `country.alpha_2_code` | alpha-2 | — |
| `GET /v1/countries/{code}/{form}` | **alpha-3** | `404 {"message":"Country not found"}` |
| `GET /v1/contract-amendments/schema?country_code=` | **alpha-3** | (documented alpha-3; not re-tested with alpha-2) |
| `GET /v1/expenses/categories?country_code=` | **alpha-3** | `422 {"country_code":["is invalid"]}` |
| `CompanyLegalEntity.country_code` | **alpha-3** | — (a field, not a parameter) |
| `GET /v1/countries/{code}/holidays/{year}` | **alpha-3** | (not re-tested with alpha-2) |
| Every country-keyed table in `src/` | **alpha-2** | comparison silently false, forever |

Two of these failures are 404s, one is a 422, and one is not an error at all.
**No two of them look alike**, which is why each has had to be found separately.

## What the demo can and cannot show, on live gateway data

| Use case | NLD | PRT | CAN | USA |
|---|---|---|---|---|
| UC-06 amendment — schema fetch | ✅ 200 | ✅ 200 (EOR only; contractors 404) | ✅ 200 | ❌ **500** |
| UC-06 — payload assemblable from record | ✅ global payroll only | ❌ 5 fields underivable | ✅ global payroll | ❌ n/a |
| UC-06 — a payroll cycle exists | ✅ 5 cycles | ❌ **none at all** | ✅ 3 cycles | ✅ 3 cycles |
| UC-06 — a cycle whose lock is still open | ❌ latest 2026-07-10 | ❌ | ❌ latest 2026-06-20 | ❌ latest 2026-06-20 |
| UC-02 expense categories | ✅ 36 | ✅ 33 | ✅ 32 | ✅ 32 |
| UC-05 PTO — live balances readable | ✅ | ✅ | ✅ | ✅ (9 negative) |
| Public holidays | ✅ 11 | ✅ 13 | ⚠ 5 national + 4 per province, disjoint | ✅ 11 federal, 0 per state |

**The honest summary: every UC-06 path refuses today on live data, for a
different reason per country.** That is four distinct refusals and zero
approvals — and `CLAUDE.md` §4's standing lesson is that a use case which
structurally cannot succeed is indistinguishable from one being appropriately
cautious. If UC-06 is demonstrated, the narration has to name which refusal is
which, or show the approval path through the read-only stand-in and say that is
what it is doing.

## Redaction statement

The Sandbox records read for this pass carry personal data — names (including
the repository owner's), personal and work email addresses, mobile numbers,
postal addresses and bank-account blocks. **None of it is transcribed into any
file in this capture.** Individuals appear only as employment UUIDs, and only
where the record itself is the finding (nine negative PTO balances, eight
representative employments). Legal-entity names are recorded because they are
auto-generated Sandbox seed strings naming no real company. Read the payloads;
do not vendor them.
