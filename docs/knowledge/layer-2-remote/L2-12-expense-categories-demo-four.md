# L2-12 · Expense categories — the 403 that was never a credential problem

| | |
|---|---|
| **Catalogue id** | L2-12 — **new**. `docs/KNOWLEDGE-SOURCES.md` has no expense-category entry; the nearest is L3-01 ("Expense policy … the customer"), which is the *caps* corpus, not Remote's category taxonomy. This file adds the Remote-side source UC-02 validates against. |
| **Source name** | "List expense categories" — Remote API, live Sandbox; two endpoints, one employee-scoped and one company-scoped |
| **Publisher / authority** | Remote Europe Holding, B.V. |
| **Exact URLs** | `https://gateway.remote-sandbox.com/v1/employee/expense-categories` (403) · `https://gateway.remote-sandbox.com/v1/expenses/categories?country_code={ALPHA3}` (200) |
| **Retrieved** | **2026-08-19**, Node `fetch` via `NODE_USE_ENV_PROXY=1`, bearer `REMOTE_API_TOKEN` |
| **Byte counts + SHA-256** | manifest below |
| **Companion reference page** | <https://developer.remote.com/reference/get_v1_employee_expense-categories.md> — HTTP 200, **17,265 bytes**, SHA-256 `7907d87ab804fdd6b01f0030c03b9c03d8dd869037b3ef606e5416eb0588e899`, `updatedAt: 2026-05-27T21:25:32.000Z` |
| **Source `updatedAt`** | None on the live JSON; the reference page's is above. |
| **Licence / basis for inclusion** | Remote's public integrator documentation and its live Sandbox. **Category `code`s and the row shape** — the identifiers `src/uc02/policyCaps.js` is keyed by — plus short attributed quotations. The category `description` / `instructions` / `prompt` prose is not reproduced. |
| **Evidence tag** | `[CONFIRMED — live, 2026-08-19]` |

## Retrieval manifest

| URL | HTTP | Bytes | Rows | SHA-256 |
|---|---|---|---|---|
| `/v1/employee/expense-categories` | **403** | 55 | — | `1f64eae46586de25e779453a694b8891af497129cae247f8517f828adb20d17f` |
| `/v1/expenses/categories` (no discriminator) | **422** | 133 | — | `b8191a0518303f2ba6ba5cec92b3be6322359379df9134ea04f66201e1fd24a1` |
| `/v1/expenses/categories?country_code=NL` (alpha-2 control) | **422** | 75 | — | `74eaff87266ab6954fb9ed792e4ab9df7a1d72203c851dac02608e44c24185fd` |
| `/v1/expenses/categories?country_code=NLD` | 200 | 16,129 | **36** | `33c489728eec4ada234a1afcff4d3ca37a4c5fdf7c54ec5a3551a3ed70530958` |
| `/v1/expenses/categories?country_code=PRT` | 200 | 14,617 | **33** | `31cf5e3c046b49db778027137926ba46e184b8a38f06dd5cf31e40ef8e545ca1` |
| `/v1/expenses/categories?country_code=CAN` | 200 | 13,912 | **32** | `a3ba32b82b1c3aff13620a413c2a62723074d8ea2cfb549ee79ec696571eb8a5` |
| `/v1/expenses/categories?country_code=USA` | 200 | 13,912 | **32** | `a3ba32b82b1c3aff13620a413c2a62723074d8ea2cfb549ee79ec696571eb8a5` |
| `/v1/expenses?page_size=100` (for the recorded-category question) | 200 | 78,125 | 100 of 220 | `f8f42e33b12eb161d27261d533736a5818a6b801db14a14f6408f6ef5f14dab6` |

Exact bodies of the three refusals:

```
403  {"message":"Forbidden, invalid role for this endpoint"}
422  {"message":"Unprocessable Entity","errors":{"employment_id":
      ["can't be blank when neither expense_id nor country_code is provided"]}}
422  {"message":"Unprocessable Entity","errors":{"country_code":["is invalid"]}}
```

## 1. The 403 is confirmed, and it is confirmed as *not* a credential problem

`CLAUDE.md` §7 standing issue 1 records this as *"needs a token with the right
role."* **That reading is wrong, and the endpoint's own documentation says so.**
Its title is *"List expense categories for the authenticated **employee**"*,
and its description reads *"…applicable to the current employee, filtered by
the employee's country / legal-entity visibility rules."* Its security scheme is
an employee session. UC-02 is an unattended automation holding a company token
and **structurally cannot hold an employee session** — which is the same
argument `docs/00-FOUNDATION.md` uses to prefer REST over Remote's user-OAuth
MCP. No token this service can ever hold opens that URL.

`src/remote/restClient.js#getExpenseCategories()` already draws exactly this
conclusion and calls the company-side endpoint instead. **The source is
therefore available and UC-02's category gate is not blocked** — only
`CLAUDE.md`'s standing-issue note is stale. Recorded here rather than corrected
there, per this capture's file-ownership boundary.

## 2. The company-side endpoint, and its two refusals

`GET /v1/expenses/categories` requires **at least one of** `employment_id`,
`expense_id`, `country_code`; with none it is a 422 naming `employment_id`.

`country_code` is **alpha-3 only** — `NLD` 200, `NL` **422
`{"country_code":["is invalid"]}`**. That is a *different* refusal shape from
the country-form endpoint's 404 (`{"message":"Country not found"}`, L2-08 §1),
so the two alpha-2 mistakes do not even fail alike.

`employment_id` is the better discriminator where one exists: it applies the
employee's real country **and** legal-entity visibility, which is the list the
gate claims to be validating against, and it avoids the alpha axis entirely.
`RemoteClient` prefers it and throws rather than sending a malformed
`country_code`. Both behaviours confirmed correct against the responses above.

## 3. Row shape, and the country differences

`data` is a **bare array**. Ten keys per row:

```json
{"code":"business_travel.accommodation",
 "parent":{"code":"business_travel","title":"Business travel","slug":"cb028040-…"},
 "scope":"global","status":"active","instructions":null,
 "description":"Hotel or other lodging during your trip.",
 "title":"Accommodation","prompt":null,
 "slug":"17fde76f-…","is_selectable":true}
```

**There is no `id` field.** The stable identifier is `code`, a dotted
`parent.leaf` string. `is_selectable` was `true` on **every** row of all four
lists (36/36, 33/33, 32/32, 32/32) because parents are excluded unless
`include_parents=true` is passed.

**CAN and USA returned byte-identical payloads** — same 32 codes, same order,
same SHA-256. NLD is the outlier with 36. Union across the four is **38**
codes; the seven that are not universal:

| code | present in |
|---|---|
| `business_travel.client_prospect_meals` | NLD only |
| `business_travel.parking` | NLD only |
| `business_travel.tolls` | NLD only |
| `learning_and_development.educational_costs_excluding_language_courses` | NLD only |
| `business_travel.personal_meals_excluding_lunch` | PRT only |
| `business_travel.personal_meals_lunch` | PRT only |
| `business_travel.personal_meals_during_business_travel` | NLD, CAN, USA (**not** PRT) |

Note the meals split: Portugal separates lunch from other personal meals, and
the Netherlands both keeps the combined code *and* adds `client_prospect_meals`.
A cap table keyed on one country's meal code silently covers nothing in another.

**All eight `POLICY_CAPS` keys in `src/uc02/policyCaps.js` are present and
selectable in all four demo countries** — checked key by key. So the cap gate
can fire in every demo country; it is the other 30 codes that route to
`policy_cap_unknown`, which `policyCaps.js`'s own header says is the design.

## 4. Two taxonomies exist, and only one of them is on the expense records

`GET /v1/expenses` (220 records in this Sandbox; first 100 read) returns each
expense with **both** a legacy flat `category` string and an
`expense_category` object — and the object's `code` is the **same flat string**,
not a dotted one:

```json
"category": "meals",
"expense_category": {"code":"meals","title":"Meals","slug":"1bc932cd-…"}
```

The 12 distinct values across those 100 records: `meals`, `flight`,
`subscription`, `education_training`, `tech_equipment`, `transport`, `gifts`,
`entertainment`, `lodging`, `parking_toll`, `car_rental`, `home_office`.

**None of these 12 appears in the 38-code selectable list.** The two vocabularies
are disjoint. So a recorded expense's own category code can never be looked up
in the category list, and never matches a `POLICY_CAPS` key.

`src/uc02/` does **not** make that mistake — and it is worth stating why,
because the disjointness looks alarming until you see the design.
`expenseClassifier.js` picks a `categoryId` **from the live selectable list**
and uses `expense_category.title` only as one token in the text it matches on;
`workflow.js` then calls `isCategoryFileable(categoryList, classification.
categoryId)` and `getPolicyCap(classification.categoryId)` against that same
dotted vocabulary. The record's own code is a hint, never a key. That is
self-consistent and correct.

The residual risk is one of *reading*: an operator comparing a Zendesk note
("category: business_travel.accommodation") against the Remote record
("category: lodging") sees two different answers for one expense, and neither
is wrong.

## Mismatches against `src/` — reported, not fixed

1. **`CLAUDE.md` §7 standing issue 1 is stale.** The 403 is a wrong-endpoint
   condition, permanently; `restClient.js` already routes around it and the
   company-side endpoint returns 32–36 rows for every demo country. No token
   change is needed and none would help.
2. **The disjoint taxonomies are a reporting hazard, not a gate defect** (§4).
   The classifier and the caps agree with each other; the expense record
   agrees with neither, by Remote's own design.
