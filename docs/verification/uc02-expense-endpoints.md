22
2# UC-02 Expense Endpoints — Live API Verification

Verified against developer.remote.com (first-party, live) on 2026-08-02. This note
resolves two disputed endpoint claims across the three raw UC-02 research docs in
`docs/research/`. It does not re-litigate claims those docs already agree on.

A prior verification pass this session already confirmed the base expense resource
is `GET /v1/employee/expenses` and `POST /v1/employee/expenses` (employee
self-service namespace). This note builds on that and resolves the two remaining
open questions.

---

## Disputed claim 1 — "List expense categories" endpoint

> ### ⚠️ SUPERSEDED 2026-08-17. This section's verdict was wrong, and UC-02 ran
> ### on the wrong endpoint for months because of it.
>
> The verdict below — "neither doc is correct", `GET /v1/employee/expense-categories`
> — named a real endpoint that this service can never call. It 403s with
> `{"message":"Forbidden, invalid role for this endpoint"}` on every request, and
> that was in turn mis-diagnosed as "the Sandbox token lacks the right role" and
> escalated as needing new credentials. **No credential would have fixed it.**
>
> **ChatGPT's `GET /v1/expenses/categories` was RIGHT**, and was marked wrong here.
> The two endpoints are not rival spellings of one resource; they are the
> employee-side and company-side halves of the same data, and they differ in the
> only thing that matters — who may call them:
>
> | | `/v1/employee/expense-categories` | `/v1/expenses/categories` |
> |---|---|---|
> | Title | "…for the authenticated **employee**" | "List expense categories" |
> | `security` (OpenAPI) | `OAuth2Assertion` (employee session) | `CustomerAPIToken`, `OAuth2AuthorizationCode` |
> | Discriminator | implicit (the caller *is* the employee) | **required**: one of `employment_id`, `expense_id`, `country_code` |
> | This service | **403, always** | 200 |
>
> UC-02 is an unattended automation acting as a system actor. It holds a company
> token and structurally cannot hold an employee session — that is the same
> property `00-FOUNDATION.md` cites for preferring REST over Remote's user-OAuth
> MCP. So the employee endpoint was never available to it, at any point, under
> any credential.
>
> **What the original verification did wrong, worth naming because the method is
> reusable:** it verified that an endpoint *exists* and stopped there. Existence
> was never in doubt. The question a client needs answered is *"can the principal
> this service actually holds call it?"*, and the OpenAPI `security` block on each
> page answers it in one line — it was present on both pages the whole time and
> was not read. Cross-checking two documentation routes that agree (as this
> section did, carefully) cannot catch that, because both routes described the
> same correct-but-inapplicable endpoint.
>
> Verified live 2026-08-17 against `gateway.remote-sandbox.com` with the token in
> `REMOTE_API_TOKEN`:
>
> ```
> GET /v1/employee/expense-categories                     -> 403 Forbidden, invalid role for this endpoint
> GET /v1/expenses/categories?employment_id=3537d9ee-…    -> 200  (32 selectable rows)
> GET /v1/expenses/categories?country_code=ESP            -> 200  (32 selectable rows)
> GET /v1/expenses/categories?country_code=ES             -> 422  {"errors":{"country_code":["is invalid"]}}   (alpha-2 refused)
> GET /v1/expenses/categories                             -> 422  (no discriminator)
> GET /v1/expenses/categories?employment_id=<bogus>       -> 404  Employment not found
> ```
>
> **The row shape below was also wrong**, and independently fatal. The gate read
> `categoryList.some(c => c.id === classification.categoryId)`; a real category row
> has **no `id` field at all**. Live shape, verbatim:
>
> ```json
> {
>   "code": "business_travel.accommodation",
>   "parent": { "code": "business_travel", "title": "Business travel", "slug": "cb028040-…" },
>   "scope": "global",
>   "status": "active",
>   "instructions": null,
>   "description": "Hotel or other lodging during your trip.",
>   "title": "Accommodation",
>   "prompt": null,
>   "slug": "17fde76f-a927-4463-84eb-b7a9e69fc8b6",
>   "is_selectable": true
> }
> ```
>
> Envelope is `{"data": [...]}` — a flat array, not `{"data":{"categories":[…]}}`.
> So even had the endpoint answered 200, that comparison could never be true and
> every claim would have reported `category_unverified` forever. Both defects were
> invisible to the whole test suite, because the mock server served the invented
> shape: the fixture agreed with the code instead of with the API.
>
> Current behaviour: `RemoteClient.getExpenseCategories({employmentId, countryCode})`,
> selectability rules in `src/uc02/expenseCategories.js`, live fixture rows in
> `src/remote/mockServer.js`.

**What the raw docs said (original section, retained for the record):**

- `Remote UC-02 Expense Validation Deep-Dive Technical Blueprint.md` (Gemini), line 183:
  `GET /v1/expense-categories`
- `UC-02 ChatGpt Verified Against Gemini.md` (ChatGPT), lines 310 & 345:
  `GET /v1/expenses/categories`
- `UC-02 — BUild Case Chatgpt Expense Category & Receipt Validation Engine.md` (ChatGPT):
  refers only to an abstract "Expense Category API" (line 707), does not cite a
  concrete path — not a party to this specific path dispute.

**Verdict: neither doc is correct.**

The real, current endpoint, confirmed directly from Remote's live API reference page, is:

```
GET /v1/employee/expense-categories
```

Title: "List expense categories for the authenticated employee." Description (quoted
verbatim from the reference page): *"Returns the flat list of expense categories
applicable to the current employee. Only active categories are returned, filtered by
the employee's country / legal-entity visibility rules. Leaf nodes have
`is_selectable: true`; parent nodes are excluded unless `include_parents=true`."*

This sits in the same `/v1/employee/` namespace as the already-confirmed
`GET /v1/employee/expenses` and `POST /v1/employee/expenses` — i.e. the correct
mental model is "expense-categories is a sibling resource under `/v1/employee/`,"
which both raw docs missed: Gemini dropped the `/employee/` segment entirely, and
both ChatGPT docs nested `categories` under `/expenses/` instead of using the
hyphenated `expense-categories` resource name under `/employee/`.

Confirmed by two independent routes that agree exactly:
1. Direct fetch of the reference page itself
   (`https://developer.remote.com/reference/get_v1_employee_expense-categories.md`),
   which states the method/path/title/description above.
2. Cross-checked against `https://developer.remote.com/llms.txt` (Remote's own
   doc-index file), which lists the same page under the same URL and title, and
   lists **no other** expense-category endpoint anywhere in the index (checked via
   several independent substring queries: `"expense"`, `"category"`, and by path
   prefix).

---

## Disputed claim 2 — Approving/declining a submitted expense

**Question:** Is this a PATCH/PUT on `/v1/employee/expenses/{id}` with a status
field, a dedicated action endpoint, or something else?

**What the raw docs said:**

- Gemini doc (`Remote UC-02 Expense Validation Deep-Dive Technical Blueprint.md`,
  lines 246–252): claims write access for status changes is *not* generally
  available — "programmatic write endpoints for directly updating expense approval
  statuses (`PATCH /v1/expenses/{id}/status`) are restricted to web UI actions or
  specific partner OAuth scopes," and that automated systems "must execute state
  changes via authorized webhook callbacks, custom platform extensions, or
  specialist human-in-the-loop review queues."
- ChatGPT doc (`UC-02 ChatGpt Verified Against Gemini.md`, section 3.4, lines
  174–211): claims the opposite — quoting Remote's own "Working with Expenses" guide,
  it states a pending expense can be updated to `approved` or `declined` via
  `PUT /expenses/:id` or `PATCH /expenses/:id`, with a JSON body such as
  `{"status": "declined", "reason": "Expense not refundable"}`, and explicitly says
  this "corrects Gemini's earlier claim that approval status could not be
  programmatically updated."

**Verdict: the ChatGPT doc is correct; the Gemini doc's "restricted to web UI"
claim is wrong.**

Remote's live guide, "Working with Expenses"
(`https://developer.remote.com/docs/working-with-expenses`), states this directly
and unambiguously — quoted verbatim:

> "You can approve or decline a **pending** expense using the `PUT /expenses/:id`
> or `PATCH /expenses/:id` endpoints. The `:id` in the query parameter must be
> replaced with the ID of the expense to be updated."

To approve: update `status` to `approved`. To decline: update `status` to
`declined` and supply a `reason`. So it is a **status field on the existing
expense resource**, not a dedicated `/approve` or `/decline` action endpoint — the
ChatGPT doc's characterization is right in both respects (the path *and* the fact
that it's a status-field PATCH/PUT, not a separate action endpoint). Gemini's
specific dedicated sub-path guess, `PATCH /v1/expenses/{id}/status`, does not
appear anywhere in Remote's live docs and its claim that this is UI-only/partner-only
is contradicted by the guide's plain-language framing as a standard authenticated
API call.

**One open nuance worth flagging for the build docs:** the guide's examples use
un-namespaced paths (`POST /expenses`, `PUT /expenses/:id`, `GET /expenses`,
`GET /expenses/:id`, `GET /expenses/:id/receipt` — curl example shows the full host
as `https://gateway.remote-sandbox.com/v1/expenses`), whereas the auto-generated
`/reference/` pages indexed in `llms.txt` only expose the `/v1/employee/`-namespaced
GET/POST pair (`get_v1_employee_expenses.md`, `post_v1_employee_expenses.md`) plus
`get_v1_employee_expense-categories.md`. No `/reference/*.md` page for a PATCH or
PUT on an expense ID (namespaced or not) appears in the `llms.txt` index under any
of the query variations tried (by URL substring "expense", by `patch_`/`put_` URL
prefix, by title). This likely means the approve/decline path is the
admin/company-side counterpart to the employee self-service `/v1/employee/expenses`
resource (i.e. used by whoever reviews expenses, not the submitting employee) and
currently only has narrative guide documentation, not a dedicated auto-generated
reference page — or the reference page exists but isn't surfaced in `llms.txt`. This
doesn't change the verdict above (the guide is itself a first-party,
developer.remote.com source), but a build implementation should confirm the exact
namespace (`/v1/expenses/:id` vs `/v1/employee/expenses/:id`) against a live sandbox
call before wiring it up, since the guide text alone doesn't spell out the full path
with `/v1/` prefix in the approve/decline sentence (only in the separate `POST`
curl example).

**Dead link found in passing:** the ChatGPT doc cites
`https://developer.remote.com/reference/post_create_expense-1` for expense
creation — this URL now 404s. Use `https://developer.remote.com/reference/post_v1_employee_expenses.md`
instead; Remote appears to have restructured reference page slugs since that doc
was written.

---

## Sources

All URLs below were fetched successfully during this verification pass:

- https://developer.remote.com/llms.txt — Remote's own documentation index (queried
  multiple times with different filters to cross-check completeness of the expense
  endpoint list)
- https://developer.remote.com/reference/get_v1_employee_expense-categories.md —
  live reference page confirming `GET /v1/employee/expense-categories`
- https://developer.remote.com/reference/get_v1_employee_expenses.md — live
  reference page confirming `GET /v1/employee/expenses`
- https://developer.remote.com/reference/post_v1_employee_expenses.md — live
  reference page confirming `POST /v1/employee/expenses`
- https://developer.remote.com/docs/working-with-expenses — live guide confirming
  `PUT /expenses/:id` / `PATCH /expenses/:id` with a `status` field for
  approve/decline, plus `POST /expenses`, `GET /expenses`, `GET /expenses/:id`,
  `GET /expenses/:id/receipt`, and the `expense.submitted` / `expense.updated` /
  `expense.deleted` webhook names
- https://developer.remote.com/docs/working-with-expenses.md — markdown source of
  the same guide, fetched separately to get verbatim quotes
- https://developer.remote.com/reference/welcome-to-remote-api — checked for a
  navigable endpoint index; confirmed it only has a high-level category table
  (no per-endpoint paths), pointing back to `llms.txt` as the real index

URLs checked and found dead (404), noted above for the record, not used as sources:

- https://gateway.remote.com/v1/docs/openapi.html
- https://developer.remote.com/reference/get_index_expense (surfaced by a
  tool-summarization artifact, not an actual llms.txt entry — confirmed 404 on
  direct fetch, flagged here so it isn't mistaken for a real endpoint later)
- https://developer.remote.com/reference/post_create_expense-1 (stale link cited by
  one of the raw ChatGPT docs)
