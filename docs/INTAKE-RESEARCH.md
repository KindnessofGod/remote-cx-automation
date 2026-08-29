# How a request actually reaches a human at Remote today

> **Research date: 2026-08-20.** Scope: the intake surface for the seven
> request situations this repo automates — workation / temporary cross-border
> work (UC-04), travel support letter (UC-03), employment verification letter
> (UC-01), permanent relocation (UC-07), contract amendment (UC-06), expense
> query (UC-02), resignation notice (UC-05) — plus cross-border tax (UC-08) for
> completeness. Written to answer one question the project owner asked
> directly: *"Go and find out how they do it currently. I don't know if they
> use a form intake or how they do it."*
>
> **No code was changed by this pass.** This file is the whole deliverable.

---

## 0. The answer, in one sentence

**Form.** Remote's intake for every one of these request types is a
**structured in-product form** — a typed request object with enums, dates,
country references, booleans and file uploads — carrying **one or two
free-text boxes bolted on to explain the structured values**, never the other
way round; the free-text-only channel (a Zendesk ticket at
`support.remote.com`) exists alongside it and is what you fall back to when no
request object models what you want.

So this repo's portal, which is entirely forms, **models the real world.** It
does not diverge. What it gets wrong is smaller and more specific, and §6 names
it.

---

## 1. How to read the evidence tags in this file

This repo's rule (`CLAUDE.md` §3, prime directive 4) is that every claim
carries its provenance. Two of the sources here have different reliability, and
collapsing them would be exactly the kind of overstatement the rule exists to
prevent, so they are tagged differently:

| Tag | Means |
|---|---|
| **[CONFIRMED]** | I fetched the bytes myself and read them. In practice this is always `developer.remote.com` — the `.md` twin of a docs page, whose OpenAPI block I parsed locally. URL and fetch date given. |
| **[INFERRED]** | Reasoned from something adjacent, **or** taken from a search engine's summary of a page whose body this container could not fetch. See the split rule immediately below. |
| **[UNKNOWN]** | Could not establish. §8 lists every one of these. |

**The split rule for `support.remote.com`.** That host answers this container
with a Cloudflare challenge (§7). So for a help-centre article, two different
things are known to two different standards, and this file keeps them apart:

- **That the article exists, at that URL, with that title** — **[CONFIRMED]**,
  from the search index, which returns URLs and titles verbatim.
- **What the article says** — **[INFERRED]**, because it reached me through a
  search engine's rendering of the page, not from the page. Every such claim is
  paraphrased in one sentence and never quoted at length, per the sourcing
  constraint on this research.

No commercial database (IBFD, Bloomberg Tax, Vialto) was fetched or cited.

---

## 2. What Remote does today, per request type

The short version. Detail and field lists follow in §3–§5.

| Request | Where it starts | Shape | API-addressable? |
|---|---|---|---|
| **Employment verification letter** (UC-01) | Requests tab → New request → **Employment letter** → pick a language template → downloads **immediately**, no human | Structured, self-service, zero-touch | ❌ no endpoint at all |
| ↳ *customized / "none of these templates fits my needs"* | Same tab, different branch: a form plus an optional **upload of the third party's own form** | Structured form + attachment + prose | ❌ |
| ↳ *third-party (bank) verification* | An **email address** — `lifecycle-support@remote.com` | Free text, a mailbox | ❌ |
| **Travel support letter** (UC-03) | Requests / **Request Hub** — a distinct request type from RWA | Structured form, category picker + prose detail | Read + employer-decision only (`GET`, `PATCH`/`PUT`) — **no `POST`** |
| **Remote Work Authorization / workation** (UC-04) | Request Hub, **submitted separately** from a travel letter | Structured form | Read + employer-decision only — **no `POST`** |
| **Contract amendment** (UC-06) | Requests tab, **company owner / super admins only** | Structured form, country-specific JSON schema | ✅ **`POST /v1/contract-amendments`** *and* a `contract_amendment.submitted` webhook |
| **Expense** (UC-02) | Expenses page → Add expense → pick type → **upload receipt → "Scan receipt"** auto-fills → human reviews → Submit | Structured, with OCR pre-fill behind a human confirmation | ✅ `POST /v1/employee/expenses` (employee session) |
| **Resignation** (UC-05) | Requests tab → New Request → **Resignation** | Structured form, 24-value reason enum | ❌ no `POST`; read + `PUT …/validate` only |
| **Termination** (UC-05's employer mirror) | Offboarding flow | Structured form — the largest in the API, with legal-risk multi-select | ✅ `POST /v1/offboardings` |
| **Permanent relocation** (UC-07) | Employee profile → **Country Transfer Service** → relocation form (new country, entity, start date; mostly pre-filled) | Structured form, employer-driven | ❌ nothing in `llms.txt` |

> ### PICKED UP — 2026-08-21, ninth decision pass
>
> **This one row decided two things in UC-07's pass, and turned a third from a
> preference into a finding.** It is the clearest case yet of research paying off
> in a place nobody wrote it for.
>
> 1. **The portal becomes UC-07's primary intake** (DRIFT-034). The owner's
>    argument — *"how exactly are customers supposed to access Zendesk? That is
>    why we use our own UI"* — was sound on its own but was an argument about our
>    convenience until this row showed that **Remote's own product solves it the
>    same way**. Our portal stands in for the Country Transfer Service, which is
>    the `W-4` precedent restated: **the stand-in stands in for Remote's product,
>    never for the partner API.**
> 2. **The company admin is UC-07's default filer**, not the employee — because
>    **"employer-driven"** is Remote's own shape, not this repository's taste.
> 3. **`00-FOUNDATION.md`'s surviving "does not exist" claim gained a word.** The
>    absent thing is an **API**; the *capability* exists as a product surface.
>    Writing *"Remote has no country transfer"* overstates in Remote's disfavour
>    and is the identical over-reach that made the other two-thirds of that
>    sentence wrong.
>
> **The transferable lesson:** the `❌ nothing in llms.txt` column and the product
> column answer **different questions**, and a claim about one is not a claim
> about the other. Reading the row as *"Remote can't do this"* is available and
> wrong.
| **Cross-border tax question** (UC-08) | No request object exists → a support conversation | Free text | ❌ |

> **[PICKED UP 2026-08-21 — this row answered a question left open in another
> document, and it took a week for anyone to read it.]** UC-07's decision pass
> left `H4` open: *does the portal-primary decision apply to UC-08 too?* It named
> this exact check as the thing that would settle it. **The answer is NO.**
> UC-07's reframing rested on §75 — Remote's product **has** a Country Transfer
> Service that our portal stands in for. **UC-08 has no such surface at all**, so
> the ticket genuinely *is* the request and Zendesk here is the real channel, not
> a stand-in. Of the four contracts subtitled *"Zendesk-native"* — defined as
> *"the ticket **is** the request"* — **only UC-08 earns it**, which
> `qa/SPEC-DRIFT-INDEX.md`'s second-pass box had already established. The portal
> stays a **second door**, a better-shaped form for the same free-text question.
> Same tier as UC-07, same absent approval surface, **opposite answer** — which is
> why it was left open rather than settled by analogy.
>
> **A second thing this section settles, from the opposite direction.** UC-08's
> §5 has named *"time-off + workation custom fields"* as its presence-data source
> for months. Both schemas were read on 2026-08-21: `Timeoff` carries **no
> country and no location property**, a workation generates **no time-off record
> at all**, and custom fields carry **no dates**. What does carry the fact is
> `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests` —
> `destination_country`, `travel_date_start`, `travel_date_end`, `status`,
> filterable by `employment_id`. **The same lesson as the box above, rotated:**
> the `❌` column and the product column answer different questions, and so do
> *"Remote holds time-off data"* and *"this object carries where somebody was"*.
> DRIFT-106 / DRIFT-107.

**The pattern that runs through the whole table:** a request type gets a form
the moment Remote has an *object* for it. When there is no object — "what
about my taxes", "can I get a letter your template doesn't cover" — it falls
through to the ticket. That is precisely the two-entry-path split
`docs/00-FOUNDATION.md` §2 already asserts, and this research confirms it from
Remote's side rather than from ours.

### 2.1 Sources for the table

`developer.remote.com`, all fetched **2026-08-20**, all **[CONFIRMED]**:

- Absence of `POST` for travel letters, work authorizations, resignations, and
  of any relocation/country-transfer resource at all: zero matches for
  `post_v1_travel`, `post_v1_work`, `post_v1_resignations`,
  `country-transfer`, `relocation` in `docs/REMOTE-API-INDEX.txt`, which is
  Remote's own `llms.txt`.
- Absence of any employment-verification-letter endpoint: the API has
  `probation-completion-letter` and `travel-letter-requests` resources and no
  verification-letter resource. UC-01's founding premise — that this request
  has no API — is **[CONFIRMED] by absence**, and the absence is meaningful
  because sibling letter types *do* have endpoints.

`support.remote.com`, **article existence [CONFIRMED], content [INFERRED]**:

- [How to generate a standard employment verification letter on Remote](https://support.remote.com/hc/en-us/articles/4422684040461-How-to-generate-a-standard-employment-verification-letter-on-Remote)
- [How to request a customized employment letter](https://support.remote.com/hc/en-us/articles/8429086541325-How-to-request-a-customized-employment-letter)
- [How to get employment verification via 3rd party](https://support.remote.com/hc/en-us/articles/19201215338509-How-to-get-employment-verification-via-3rd-party)
- [Why is the employment verification letter request not available on my Remote profile?](https://support.remote.com/hc/en-us/articles/17537524163853-Why-is-the-employment-verification-letter-request-not-available-on-my-Remote-profile)
- [Travel Support Letters: What are they and How to request one](https://support.remote.com/hc/en-us/articles/37802056865933-Travel-Support-Letters-What-are-they-and-How-to-request-one)
- [Remote Work Authorization: What it is and How to request it](https://support.remote.com/hc/en-us/articles/37802834593805-Remote-Work-Authorization-What-it-is-and-How-to-request-it)
- [Using the Request Hub](https://support.remote.com/hc/en-us/sections/6737356914957-Using-the-Request-Hub) · [What is the Requests section?](https://support.remote.com/hc/en-us/articles/6738702420877-What-is-the-Requests-section)
- [Request amendment to employee agreement](https://support.remote.com/hc/en-us/articles/4421460474637-Request-amendment-to-employee-agreement) · [How automated amendments for salary increases work](https://support.remote.com/hc/en-us/articles/14651634208525-How-automated-amendments-for-salary-increases-work)
- [[Employee] How to add an expense](https://support.remote.com/hc/en-us/articles/4411238221965--Employee-How-to-add-an-expense)
- [How do I resign from my position?](https://support.remote.com/hc/en-us/articles/4406932251021-How-do-I-resign-from-my-position) · [Understanding the resignation acceptance process](https://support.remote.com/hc/en-us/articles/36408832409229-Understanding-the-resignation-acceptance-process)
- [How does employee transfer from one entity to another work?](https://support.remote.com/hc/en-us/articles/26871222438925-How-does-employee-transfer-from-one-entity-to-another-work) · [What if I want to transfer to another country?](https://support.remote.com/hc/en-us/articles/4410444314381-What-if-I-want-to-transfer-to-another-country)
- [How do I contact Remote for support?](https://support.remote.com/hc/en-us/articles/13279781622669-How-do-I-contact-Remote-for-support) · [How do I manage and track my support tickets?](https://support.remote.com/hc/en-us/articles/32839589364365-How-do-I-manage-and-track-my-support-tickets)

---

## 3. The finding that matters most: Remote's own request objects *are* the form spec

This is the part that could not have been guessed, and it is why fetching the
OpenAPI was worth more than reading a hundred help articles.

Remote's API does not just *accept* these requests — it **types every field**
of them, with human-facing help text sitting in the OpenAPI `description`
strings. Those descriptions are not written for an integrator. They are written
for a person filling a form in ("Remote advises not to inform the employee of
their termination until we review your request for legal risks"). **The API
schema is the intake form, serialized.**

That makes the field lists below the closest thing that exists to a
specification of what Remote's own decision actually needs — which is exactly
what the project owner asked for.

### 3.1 `TravelLetterRequest` — UC-03's real intake

[CONFIRMED] — `GET https://developer.remote.com/reference/get_v1_travel-letter-requests.md`, fetched 2026-08-20; schema `TravelLetterRequest`, all 20 properties `required`.

| Structured | Free text |
|---|---|
| `destination_country` → the full `Country` object | `reason` — "The purpose of the travel (e.g. business meeting, conference, client visit)" |
| `travel_date_start`, `travel_date_end` (`date`) | `travel_reason_details` — "Detailed explanation of the travel reason provided by the employee" |
| `travel_reason` — **"The category of travel reason selected by the employee"** | `additional_information` |
| `travel_document_number` — passport number | `embassy_address`, `travel_address` |
| `requires_travel_address` (bool) | `employer_special_instructions` |
| `responsible_for_travel_cost` / `_meal_cost` / `_accommodation_cost` — enum `employee`\|`employer`, **"Set by the employer during approval"** | |
| `status` — enum: `pending`, `cancelled`, `declined_by_manager`, `declined_by_remote`, `approved_by_manager`, `approved_by_remote` | |
| `user`, `employer_approver` — UUID + name + email | |

**Read the two rows together and the design is unmistakable: a category picker
with a prose box underneath it.** `travel_reason` is the dropdown;
`travel_reason_details` is the "tell us more". That single pairing is the whole
answer to "structured or free text" — it is *both*, deliberately, with the
structured half load-bearing and the prose half explanatory.

### 3.2 `WorkAuthorizationRequest` — UC-04's real intake

[CONFIRMED] — `GET https://developer.remote.com/reference/get_v1_work-authorization-requests.md`, fetched 2026-08-20.

Described by Remote as *"A work authorization request submitted by an employee
who needs authorization to work in a different country."*

| Structured | Free text |
|---|---|
| `destination_country` (`Country`) | `reason` |
| `travel_date_start`, `travel_date_end` | `additional_information` |
| `travel_document_number` | `work_location` |
| **`will_negotiate_or_sign_contracts` (boolean)** | `employer_special_instructions` |
| `status` — same six-value enum as travel letters | |
| `user`, `employer_approver` | |

**`will_negotiate_or_sign_contracts` is the single most useful field found in
this entire pass.** It is the permanent-establishment question — will this
person create a taxable presence by binding the company in the destination —
asked as a first-class boolean **on intake, by Remote itself**. UC-04's PE-risk
gate is therefore not an invention of this repo; the platform asks the same
question, in the same place, of the same person. This repo's portal already
collects it as `uc04-hasContractSigningAuthority`
(`src/portal/assets/app.js:397`).

### 3.3 `ContractAmendment` — UC-06's real intake, and the Zendesk seam

[CONFIRMED] — `GET https://developer.remote.com/reference/post_v1_contract-amendments.md`, fetched 2026-08-20.

| Structured | Free text |
|---|---|
| `employment_id`, `amendment_contract_id`, `requested_by` (UUIDs) | `request_details.additional_comments` |
| `changes` — a map of field path → `{previous, current}`, e.g. `compensation.amount: {previous: 400000, current: 500000}` | `request_details.reason_for_change_description` — **"This is filled when the reason_for_change is `other`"** |
| `request_details.effective_date` (`date`) | `salary_decrease_details.salary_decrease_reason_description` |
| `request_details.reason_for_change` — enum: `annual_pay_adjustment`, `country_rule_change`, `error_correction`, `job_change_reevaluation`, `promotion`, `other` | |
| `salary_decrease_details.salary_decrease_reason` — enum: `change_in_working_hours`, `trade_salary_for_equity`, `error_in_initial_salary`, `role_change_or_demotion`, `compensation_restructure`, `other`; plus `was_employee_informed` | |
| `status` — enum: `submitted`, `in_review`, `done`, `canceled`, `deleted` | |
| `contract_amendment` — **country-specific**, shape fetched from `GET /v1/contract-amendments/schema` | |

Three things here are worth more than the field list:

1. **`zendesk_ticket_url`** — a required property on every `ContractAmendment`,
   described as *"A link to the support ticket associated with this amendment,
   if one was created. Null otherwise."* The published example value is
   literally `https://zendesk.com/ticket-23333`. **Remote's own structured
   request object carries a pointer to a Zendesk ticket the platform opened on
   its behalf.** That is `00-FOUNDATION.md` §2's "the automation creates the
   ticket itself, pre-tagged, to host the review surface" — confirmed from
   Remote's side of the wire, not argued from ours. [CONFIRMED]
2. **The money is already scaled.** `compensation.amount` moves `400000 →
   500000` in Remote's own example. The ×100 invariant in `src/shared/money.js`
   is the platform's convention, not a defensive choice. [CONFIRMED]
3. **The `other` + `*_description` pattern.** Both enums carry an `other`
   value, and only `other` unlocks the prose field. §6.3 explains why this is
   the most important design detail in the whole document for this project.

### 3.4 Offboarding — UC-05, both directions

[CONFIRMED] — `GET https://developer.remote.com/reference/post_v1_offboardings.md`, fetched 2026-08-20.

**Employee-initiated (`ResignationOffboarding`).** `resignation_reason` is a
**24-value enum** (`other_job_opportunity`, `remuneration_and_benefits`,
`relocation_leaving_remote`, `transfer_between_remote_customer`, … and
`other`), plus `proposed_last_working_day`, `agrees_to_pto_amount` (bool),
`termination_date`, `status`. Free text: `reason_description`,
`additional_comments`, `employer_awareness` ("a description of how and when the
employer was made aware").

**Employer-initiated (`TerminationDetailsParams`)** is the biggest form in the
API and reads like one:

- `termination_reason` — **21-value enum**, prefaced with *"Choose an accurate
  termination reason to avoid unfair or unlawful dismissal claims."*
- `risk_assessment_reasons` — a **multi-select, `minItems: 1`**, of
  `pregnant_or_breastfeeding`, `family_leave`, `sick_leave`,
  `member_of_union_or_works_council`, `disabled_or_health_condition`,
  `reported_concerns_with_workplace`, … and `none_of_these`. Note the
  `none_of_these` option: Remote will not let you leave the legal-risk question
  blank; you must answer it, even to say "none".
- `confidential`, `customer_informed_employee`, `acknowledge_termination_procedure`,
  `agrees_to_pto_amount`, `will_challenge_termination` — booleans
- `proposed_termination_date`, `personal_email`
- `termination_reason_files`, `timesheet_file` — base64 uploads
- Free text: `reason_description` (**required**), `additional_comments`,
  `will_challenge_termination_description`, `agrees_to_pto_amount_notes`,
  `employee_awareness.note`

**Extended 2026-08-21, and this section already knew something two other
documents were denying.** The table at §2 recorded *"❌ no `POST`; read +
`PUT …/validate` only"* for resignation on **2026-08-20**. On the same date and
for a further day, `docs/00-FOUNDATION.md` and `docs/use-cases/UC-05.md` both
still asserted that UC-05's resignation endpoint **did not exist**. Two documents
in this repository held opposite answers to the same question and neither cited
the other. That is `CLAUDE.md` §6's *"a closed issue can stay open in one status
file and closed in another"* in its live form, and it is why the seventh decision
pass corrected the record before anything else.

What that pass added, read from the OpenAPI on 2026-08-21:

- **`POST /v1/offboardings` types `type` as `enum: ["termination"]`** — *"For
  now, only `termination` is allowed."* So the ❌ above is not an omission in the
  docs; it is the model. **A resignation is created by the employee inside
  Remote's product and cannot be created through the partner API at all.** This
  is the same **CREATE-BY-EMPLOYEE, DECIDE-BY-API** shape as
  `WorkAuthorizationRequest` in §3.2 — the second instance, and the reason UC-05's
  portal and Zendesk intakes are being relabelled **stand-ins** (DRIFT-094).
- **The `offboarding.*` webhooks split by type.** The payload wrapper is *"either
  a termination (employer-initiated) or a resignation (employee-initiated)"*, and
  the resignation variant carries `type` with `enum: ["resignation"]`.
  `GET /v1/offboardings` also takes a `type` filter. `UC-05.md` §3 had flagged
  this as *"not confirmed … needing confirmation at build time"* since the spec
  was written.
- **`GET /v1/resignations/{offboarding_request_id}` carries `days_of_notice`** —
  *"The number of calendar days of notice required based on the contract terms
  and local labor laws"* — and `proposed_last_day`, *"calculated based on the
  notice period and local labor laws."* **Remote computes the notice period.**
  UC-05's §0 business case said it does not; that claim is now retired, and the
  use case's product becomes the **disagreement** between Remote's blended figure
  and an independent statutory one (DRIFT-095).
- **`PUT .../validate` is the employer's sign-off form**, with seven required
  booleans including `accepts_proposed_notice` and a counter-proposal
  `proposed_last_date: {date, notes}`. Deliberately not adopted — adopting it
  converts a 🟡 report into a 🟡 execution (DRIFT-063 §4).
- **Two variants, not one.** `ResignationBeforeStartDateRequestParams` carries a
  single boolean, `proposed_resignation_accepted`. **Remote applies no notice
  arithmetic before the start date at all** (DRIFT-097).

### 3.5 Expenses — UC-02, and the one place Remote already ships AI extraction

[CONFIRMED] for the schema — `GET https://developer.remote.com/reference/post_v1_employee_expenses.md`, fetched 2026-08-20:
`expense_date`, `title`, `amount` (**integer, in cents**), `currency` and
optionally `expense_category_slug`, `tax_amount` (cents), `receipt`/`receipts`
(base64), `timezone`. Required: `expense_date`, `title`, `amount`, `currency`.
`title` — "A short description of the expense (e.g. 'New keyboard', 'Team
dinner')" — is the **only** free-text field, and it is a label, not a
narrative.

[INFERRED], from the search summary of
[[Employee] How to add an expense](https://support.remote.com/hc/en-us/articles/4411238221965--Employee-How-to-add-an-expense):
the employee picks an expense type, uploads a receipt, presses **Scan
receipt**, the fields are auto-filled from the scan, and the employee then
**reviews the details before pressing Submit**.

**Remote already puts a model between a document and a record — and it already
puts a human between the model and the record.** The extraction is a
convenience that pre-fills a form; the form is still what gets submitted, by a
person who confirmed it. That is prime directive 1 implemented as UX, by the
platform this project is built against. It is the single best external
validation of this repo's architecture found in the whole pass, and it is worth
citing in the case study.

---

## 4. Structured vs. free text, stated plainly

**Structured, with prose attached — never prose alone, wherever an object
exists.**

Across five independently-specified Remote request objects, the ratio holds
without exception:

| Object | Structured fields | Free-text fields |
|---|---|---|
| `TravelLetterRequest` | 14 | 6 |
| `WorkAuthorizationRequest` | 6 | 4 |
| `ContractAmendment` | ~8 (+ a country-specific schema) | 3 |
| `TerminationDetailsParams` | ~14 | 5 |
| Employee expense | 7 | 1 |

And every prose field in that right-hand column is **subordinate** — it
explains, qualifies, or elaborates a structured value that already exists. Not
one of them is the thing being decided on. The decision inputs are dates,
country references, enums, booleans and money-in-cents.

**The consequence for this project, stated as plainly as the question was
asked:**

> The portal in `src/portal/` is a form per request type. Remote's intake is a
> form per request type. **The portal is not a simplification of reality — it
> is the same shape as reality.** The seam this project has to build is not
> "turn prose into structure". It is narrower and more interesting: **turn the
> one or two prose boxes hanging off an already-structured request into a
> recommendation a specialist can act on.**

The free-text-only channel does exist — a Zendesk ticket — but §2 shows exactly
when it is used: when Remote has no object for what you are asking. Tax
questions (UC-08), letters no template covers (UC-01's tail), "can I work from
Spain" asked before anyone has filed anything (UC-03's routing job). Those are
the four use cases `00-FOUNDATION.md` §2 already routes through Zendesk. The
match is exact.

---

## 5. What is API-addressable, and one correction to this repo's own record

All [CONFIRMED] from `docs/REMOTE-API-INDEX.txt` (Remote's `llms.txt`) and the
`.md` pages fetched 2026-08-20.

| Resource | Create | Read | Decide | Webhook |
|---|---|---|---|---|
| Travel letter request | ❌ none | ✅ `GET /v1/travel-letter-requests[/{id}]` | ✅ `PATCH`/`PUT /{id}` — `oneOf` **`ApprovedTravelLetter`** \| **`DeclinedTravelLetter`** | ✅ `travel_letter.requested`, `.approved_by_manager`, `.approved_by_remote`, `.declined_by_manager`, `.declined_by_remote` |
| Work authorization request | ❌ none | ✅ `GET /v1/work-authorization-requests[/{id}]` | ✅ `PATCH /{id}` | ✅ `work_authorization.requested` + 5 more |
| Contract amendment | ✅ **`POST /v1/contract-amendments`** (+ `POST …/automatable`) | ✅ `GET`, `GET /{id}`, `GET …/schema` | (Remote reviews) | ✅ **`contract_amendment.submitted`**, `.review_started`, `.done`, `.canceled`, `.deleted` |
| Offboarding / termination | ✅ `POST /v1/offboardings` | ✅ v1 + v2 list/show | — | ✅ `offboarding.submitted`, `.review_started`, `.submitted_to_payroll`, `.completed` |
| Resignation | ❌ none | ✅ `GET /v1/resignations/{id}`, letter download | ✅ `PUT …/validate` | (via `offboarding.*`) |
| Expense | ✅ `POST /v1/employee/expenses` | ✅ | ✅ | ✅ `expense.submitted`, `.approved`, `.declined`, `.reimbursed`, … |
| Employment verification letter | ❌ **nothing** | ❌ | ❌ | ❌ |
| Country transfer / relocation | ❌ **nothing** | ❌ | ❌ | ❌ |
| **Incentive / off-cycle payment (UC-09)** | ✅ **`POST /v1/incentives`** (+ `POST /v1/incentives/recurring`) | ✅ `GET /v1/incentives`, `GET /{id}`, `GET /v1/employee/incentives` | ✅ `PATCH /{id}`, `DELETE /{id}` — **while `pending` only** | ✅ **`incentive.created`, `.updated`, `.paid`, `.processing_started`, `.deleted`** |

> **Added 2026-08-21, and it corrects this document rather than extending it.**
> This table and §2 previously carried **no incentive row at all**, and DRIFT-051
> in `qa/contracts/UC-09-acceptance.md` cited that absence when rating its own
> confidence **MEDIUM** on *"whether a Remote incentive webhook exists"*. Five do.
> A false negative about a third party's API, written here and propagated into a
> finding's confidence rating in another file — **DRIFT-117**, and the plain case
> of what §13 of `docs/WHY-THIS-SHAPE.md` describes.
>
> **Likely why it was missed rather than got wrong:** this section's subject was
> *request objects and their events*, and an incentive is not a request object —
> it is the **payment itself**. It was plausibly never searched for. That is a
> reason, not an excuse: the sentence said *"names none for incentives"*, which is
> an assertion about Remote, not about this document's scope.
>
> **The decide column needs its own warning.** `PATCH` and `DELETE` are **not an
> approval surface.** Remote's lifecycle: *"When the incentive is created and it
> is not yet associated to a payroll cycle, its status is `pending`"* — and
> *"incentives are paid out through payroll on the next applicable cycle after the
> effective date."* **`pending` means scheduled, not awaiting approval.** A
> created incentive is already going to be paid; `DELETE` cancels it while it is
> still cancellable, and *"it is not possible to cancel a one-time incentive if
> its status is `paid` or `processing`."*
>
> **So the webhooks are not an intake for UC-09** — they are a **bypass
> detector**. An admin creating an incentive in Remote's own UI moves money with
> zero signatures, and `incentive.created` is the only thing that can see it.
> `qa/contracts/UC-09-acceptance.md` §0.1–§0.2, `[P-28]`…`[P-32]`.

### 5.1 Correction: issue #17 is now stale

`CLAUDE.md` records issue #17 as establishing that **no amendment-request event
API exists**, and several places in this repo (`docs/use-cases/UC-06.md` §15,
`src/remoteui/`'s reason for existing) rest on that. As of the documentation
fetched **2026-08-20**, that is **no longer true**:

- **`POST /v1/contract-amendments`** — "Creates a Contract Amendment request",
  country-specific body driven by `GET /v1/contract-amendments/schema`.
  [CONFIRMED]
- **`contract_amendment.submitted`** — a subscribable webhook event, present in
  the events enum alongside `.review_started`, `.done`, `.canceled`,
  `.deleted`. [CONFIRMED]

This does **not** invalidate `src/remoteui/` — that stand-in demonstrates the
*human's* entry point (a company admin filling a form in Remote's product),
which is still a UI, and a webhook cannot demonstrate a UI. But the sentence
"no amendment-request event API exists" should be retired, and UC-06's live
path could now be driven by a real `contract_amendment.submitted` subscription
rather than by a stand-in creating a ticket. **Recommended, not done here** —
this pass changed no code and no other document.

> **PICKED UP 2026-08-21 by UC-06's decision pass** (DRIFT-031, `[A-23]` `[A-24]`;
> `qa/contracts/UC-06-acceptance.md` §17, `docs/BUILD-LOG.md` §3.84). **The
> documentation half is decided and queued**: the sentence *"no amendment-request
> event API exists"* is retired from `UC-06.md` §2, §15's stand-in row,
> `src/remoteui/server.js`'s header and `BUILD-LOG.md` §3.18, and the stand-in is
> reframed as a **credential-free demonstration of the human's entry point** —
> which is the reading this section reached first, and it was right.
>
> Found while doing it: **`UC-06.md` §2 and §3 had contradicted each other the
> whole time.** §3 has carried `contract_amendment.submitted` as the `[CONFIRMED]`
> trigger since it was written, while §2 asserted the absence. Neither sentence was
> written with the other in view.
>
> **The subscription itself stays deliberately open** — a live-integration
> commitment with an ongoing cost. Decide it together with `[A-30]` (DRIFT-062): if
> the real event is subscribed, the deployed graph's `Assign Routing` node covers
> production and the stand-in's tags become a demo detail; if not, those tags are
> the only routing UC-06 will ever have.

### 5.2 Two structural facts worth carrying into the build

1. **The API can only make the *employer's* half of the decision.**
   `UpdateTravelLetterRequestParams` is a `oneOf` over exactly two schemas:
   `ApprovedTravelLetter` (`status` enum with the single value
   `approved_by_manager`; requires all three cost-responsibility enums) and
   `DeclinedTravelLetter` (`status: declined_by_manager`; requires a `reason`
   string). `approved_by_remote` / `declined_by_remote` are readable statuses
   that **no client can set**. Remote's own second-stage review is structurally
   out of reach. [CONFIRMED] — this is Remote enforcing the human gate in its
   schema, not this project enforcing it in policy, and UC-04.md §1 already
   says so correctly.
2. **At least some webhooks are pointers, not payloads.**
   `employment.contractor_of_record_termination.cancelled` states plainly:
   *"The payload is stateless. Use the termination request ID and employment ID
   to retrieve the current details."* [CONFIRMED]. So even on the Remote-native
   path, the **structured record fetched from the API** — not the webhook body
   — is the source of the facts a gate acts on. Whether every event family
   follows this rule is **[UNKNOWN]** (§8).

---

## 6. What this means for the seam

### 6.1 The seam is narrower than the project assumed, and that is good news

If real intake were prose, this project would need a general-purpose
prose→structure extractor sitting in front of every gate, and every gate's
correctness would rest on it. It is not prose. Every gate input that matters —
`destination_country`, `travel_date_start`, `travel_date_end`, `effective_date`,
`amount`, `currency`, `reason_for_change`, `will_negotiate_or_sign_contracts`,
`proposed_last_working_day`, `risk_assessment_reasons` — **arrives already
typed, from an authenticated session, in a field Remote itself defined.**

So the LLM's job is not extraction-for-gating. It is:

- **classify** the one or two prose boxes (what is this person actually asking
  for, which of nine processes owns it) — UC-03's whole job;
- **retrieve** the context a specialist would otherwise go and find;
- **draft** the recommendation and the dossier prose;
- **flag** what looks inconsistent between the prose and the structure.

All four are read-only, all four are recoverable from, and none of them
produces a number.

### 6.2 What must NOT be derived by a model, now with names

Prime directive 1 is absolute, and this research turns it from a principle into
a concrete field list. **An LLM may never supply any of these**, because Remote
already supplies them and a model re-deriving one would be manufacturing a fact
the platform already knows:

`destination_country` · `travel_date_start` · `travel_date_end` ·
`effective_date` · `proposed_last_working_day` · `proposed_termination_date` ·
`amount` · `tax_amount` · `currency` · `expense_date` ·
`changes.{previous,current}` · `will_negotiate_or_sign_contracts` ·
`agrees_to_pto_amount` · `reason_for_change` · `salary_decrease_reason` ·
`termination_reason` · `resignation_reason` · `risk_assessment_reasons` ·
`expense_category_slug` · `status` · `employment_id` · `requested_by`

The rule that generates that list, stated once so it survives the list going
stale: **if Remote types the field, the model does not get to write it.** A
model may read `travel_reason_details` and observe that the trip sounds
client-facing; it may not conclude that the trip starts on 3 September.

The one salary figure in this whole domain that a model could plausibly be
asked to read out of prose — the new compensation in an amendment request — is
exactly the case `docs/BUILD-LOG.md` §4 already records UC-06 refusing to
build, on the grounds that it would make an LLM the source of a number reaching
a payroll write. This research says the refusal was right for a second,
independent reason: **that number is not in prose in the real world either.**
It is `changes["compensation.amount"].current`, an integer in cents, in a
country-schema-validated body.

### 6.3 The `other` escape hatch is the one real seam, and Remote already shows how to hold it

`reason_for_change`, `salary_decrease_reason`, `termination_reason` and
`resignation_reason` each carry an `other` value, and `other` is the only value
that unlocks a `*_description` prose field. So there **is** a path by which a
gate's input becomes prose — and Remote's own design handles it in a way this
project should copy verbatim:

> `other` is itself a structured value. It does not mean "look in the text
> box"; it means **"not classifiable by the enum"** — which is a definite,
> machine-readable statement that a human is needed.

Therefore: an LLM reading `reason_for_change_description` may produce a
**recommendation** ("this reads like a promotion; consider
`job_change_reevaluation`"), attached to the case for the specialist, audited
as `source: "llm"`. It may **never overwrite `other`** with the enum value it
guessed. Collapsing `other` into a category is precisely the state change
prime directive 1 forbids, and it would be invisible — the gate would pass, the
record would look tidy, and the human who was supposed to look at it never
would. This is the same failure shape `CLAUDE.md` §4 names as the most
expensive one in this project's history: *"refusing correctly and being unable
to succeed look identical from outside"* — here rotated, *approving wrongly and
approving rightly look identical too, once the `other` is gone.*

### 6.4 Where this project's forms diverge from Remote's — the actual gap

Comparing `src/portal/assets/app.js`'s UC-04 form (lines 389–410) against
`WorkAuthorizationRequest`:

| Remote's field | Portal's field | Verdict |
|---|---|---|
| `destination_country` | `uc04-destinationCountry` | ✅ match |
| `travel_date_start` / `_end` | `uc04-startDate` / `uc04-endDate` | ✅ match |
| `will_negotiate_or_sign_contracts` | `uc04-hasContractSigningAuthority` | ✅ **match, and the important one** |
| `reason` | `uc04-reasonText` | ✅ match |
| `travel_document_number` | — | ⚠️ not collected |
| `work_location` | — | ⚠️ not collected |
| `additional_information` | — | ⚠️ not collected |
| — | `uc04-homeCountry` | ⚠️ **portal-only** |
| — | `uc04-nationality` | ⚠️ **portal-only** |
| — | `uc04-visaType` | ⚠️ **portal-only** |
| — | `uc04-jobDuties` | ⚠️ **portal-only** |
| — | `uc04-h1/h2-*` prior-travel history | ⚠️ **portal-only** |

The right-hand block is the finding. **Five of UC-04's gate inputs are facts
Remote's own work-authorization request does not collect.** `homeCountry` is
recoverable from the employment record. The other four — nationality, visa
type, duty category, prior travel days — are not in any Remote object this
research located, which means in the real world they are either asked as a
follow-up, held by the specialist, or simply not part of Remote's
employer-stage decision at all. **[INFERRED]**, and it is the most actionable
open question in this document: a gate whose input has no source is a gate that
can only ever escalate, which is exactly the "structurally cannot succeed"
failure `CLAUDE.md` §4 says costs the most to find. Worth checking against a
real Sandbox work-authorization record before treating any of the four as real.

### 6.5 One scope correction for UC-01

[INFERRED], from the two verification-letter articles cited in §2.1: the
**standard** employment verification letter is instant, templated,
self-service, offered in roughly eleven languages, and never touches a human.
Only the *"none of these templates fits my needs"* branch — and the branch
where a third party sends a form of its own to be filled in — produces work.

That does not weaken UC-01. It **sharpens** it: UC-01 is not "automate
employment verification letters", which Remote automated years ago. UC-01 is
*"automate the non-standard tail that falls out of an already-automated
self-service flow"* — which is a better story, a more honest one, and the one
`docs/use-cases/UC-01.md` should tell. It also explains why no API endpoint
exists: for the standard case the platform is the endpoint.

### 6.5.1 Why UC-01's entry point is Zendesk — the reason, not the accident

*Added 2026-08-20, from `docs/REMOTE-API-INDEX.txt` — Remote's own `llms.txt`,
fetched and parsed locally, so **[CONFIRMED]**.*

The §5 table records the verification letter as `❌ nothing` across create, read,
decide and webhook. What that table does not draw out is that **the absence is
meaningful because the siblings are not absent**:

| Letter type | Create | Read | Decide | Webhooks |
|---|---|---|---|---|
| Probation completion letter | ✅ `POST /v1/probation-completion-letter` | ✅ `GET /{id}` | — | ✅ **3** — `.submitted`, `.completed`, `.cancelled` |
| Travel letter request | — | ✅ `GET` list + show | ✅ `PATCH /{id}` | ✅ **5** — `.requested`, `.approved_by_manager`, `.approved_by_remote`, `.declined_by_*` |
| Resignation letter | — | ✅ download | — | via `offboarding.*` |
| **Employment verification letter** | ❌ | ❌ | ❌ | ❌ **zero** |

Remote has built the request-object-with-a-lifecycle-and-webhooks machinery
**twice**, for two other letter types. It has not built it for the
highest-frequency one. So this is not a capability gap; it is a choice, and the
most likely explanation is §6.5's own finding — the standard case *succeeded*, and
the success hid the tail. On a product dashboard "employment verification letters"
reads as solved: instant, 11–24 languages, zero touch. The tail leaves through a
different door, into a support queue owned by a different team with different
numbers.

**The operational consequence, which is the transferable part:**

> **No object ⇒ no lifecycle ⇒ no webhook ⇒ nothing for any automation to
> subscribe to** — Remote's own, or a CX team's.

Which answers a question this repository had been treating as a historical
accident: **UC-01 starts from Zendesk because Zendesk is the only surface in this
flow that emits an event.** That is a defensible architectural reason and it
replaces "it was the first use case built, and it got the live trigger."

The same test applied to the two branches that *do* produce work sharpens §2's
table further. The standard and customized branches are **the same form, one
dropdown value apart** — one resolves in five seconds, the other in one to three
business days. Identical intake, opposite outcome, which is the cleanest available
proof that **a form collects and does not fulfil**. The dropdown supplies the
request *type*; the field that decides the outcome is free text whose defining
property is that it does not fit the template. And the third-party channel is a
**mailbox** rather than a form for a structural reason worth stating plainly: the
requester is a bank, has no Remote account, no session and no tenant, and can only
ever make a claim — so the employee's recorded consent is the only authenticated
signal that flow will ever have.

Four findings in `qa/` follow from this section: **DRIFT-074** (no EOR-engagement
gate), **DRIFT-075** (the consent path cannot succeed), **DRIFT-076** (UC-01
duplicates the self-service letter) and **DRIFT-077** (no Remote-side or
third-party intake surface). See `qa/SPEC-DRIFT-INDEX.md`.

---

## 7. What the requester is told, and the stated SLAs

All **[INFERRED]** (article existence [CONFIRMED]) — from search summaries of
the articles listed in §2.1.

| Situation | What the requester is told |
|---|---|
| Travel support letter | Submit **at least 2 weeks** before the trip starts; the letter lands in the **Files tab** of the Remote profile with a notification |
| Remote Work Authorization | Submit **3–8 weeks** before departure for assessment and compliance review; if travel is **under 2 weeks** away, contact support via **live messaging** instead |
| Travel letter *and* working during the trip | These are **two separate requests** — the RWA must be filed separately from the letter |
| Contract amendment | Details must reach Remote **by the 5th of the month** for that month's payroll, else it lands next month; status moves **Processing → Fully executed**; only **company owner and super admins** may submit or view |
| Support ticket (any) | A ticket number, a confirmation email with the transcript, and a tracking link; trackable in a **Support Monitor**; Remote states it aims to respond **within 24 hours** |

Two of these are worth carrying into the code. The **5th-of-the-month** cutoff
is a stated, deterministic, time-based rule — precisely the kind UC-06's
`cutoffEngine.js` exists to enforce, and it should be checked against what that
engine currently believes. And the **"under 2 weeks → live messaging"**
instruction is Remote explicitly routing an urgent case *away* from the
structured form and into a conversation, which is a real-world instance of the
"know when not to automate" judgement this repo is graded on.

---

## 8. How comparable EOR platforms do it

Intake shape only, one or two sentences each, as context for whether form-first
is the norm. All **[INFERRED]** from search summaries — none of these help
centres is reachable from this container (§9).

- **Deel** — **Conversation-first.** Support runs through an in-product
  *Communication Center* (Help `?` → Contact us) whose first control is an
  **"Ask AI anything"** input that starts a chat; a Zendesk help centre sits
  behind it at `help.letsdeel.com/hc/en-gb/requests/new`. Payroll clients get a
  structured ticket type with a stated **1 business day** response. Mobility /
  visa requests are their own in-product flow — request visa support, get a
  path recommendation and a quote back **within 2 days**.
  [Contacting Deel support](https://help.letsdeel.com/hc/en-gb/articles/4420302814353-How-to-Contact-Deel-for-Customer-Support) ·
  [Payroll support](https://help.letsdeel.com/hc/en-gb/articles/31006956883985-About-Payroll-Support-for-Deel-Clients) ·
  [Deel Mobility](https://www.deel.com/solutions/mobility/)
- **Oyster HR** — **Ticket-first, in-product.** Log in → *Support Center* in the
  main navigation → **Submit a request**; replies come back to a *Requests*
  view inside the platform. Stated resolution target **72 hours**, routed to a
  Lifecycle Support Specialist by topic (HR / payroll / benefits).
  [How do I request support?](https://support.oysterhr.com/hc/en-us/articles/10497440906641-How-do-I-request-support) ·
  [Customer Experience](https://www.oysterhr.com/how-it-works/customer-experience)
- **Papaya Global** — **Multi-channel, worker-facing.** An in-platform Help
  Center plus **WhatsApp**, email, and an account manager; workers use the
  *Papaya Personal* app or web portal to read FAQs or **open a ticket**
  directly. [Support](https://www.papayaglobal.com/support/) ·
  [Employee portal](https://www.papayaglobal.com/employee-portal/)
- **G-P (Globalization Partners)** — **Ticket-based.** Reviewers describe a
  ticketing system as the mechanism for processing HR-documentation requests.
  Thin evidence — third-party review aggregation, not G-P's own documentation.
  **[INFERRED, weak]**
- **Velocity Global** — **[UNKNOWN].** Nothing located describing the intake
  surface. Their public material covers EOR / payroll / immigration services,
  not how a request is filed.

**Read together:** the industry is **ticket-or-chat first for support**, and
**form-first only where the vendor has modelled the underlying object.** Deel
and Papaya lead with a conversation; Oyster leads with a ticket. Remote is the
one in this set whose *documented, typed request objects* cover this many
request types — which is a genuine differentiator, and it is what makes this
project's form-based portal defensible rather than a simplification.

---

## 9. What could not be established

Following the shape of `docs/knowledge/layer-1-statutory/RETRIEVAL-BLOCKED.md`,
including its failure-class taxonomy, because the remedies differ by class.

### 9.1 Blocked sources

| Host | Class | Symptom | Remedy |
|---|---|---|---|
| `support.remote.com` | **B — bot protection** | `HTTP/1.1 200 Connection Established` **then** origin `HTTP/2 403`, `server: cloudflare`, `cf-mitigated: challenge`. Probed 2026-08-20 on `/hc/en-us` and `/hc/en-us/requests/new`. The tunnel worked; Cloudflare refused this address. | A real browser session. **Cite-and-link only regardless** — the constraint on this research forbids mirroring these bodies into the repo even if reachable. |
| `help.letsdeel.com`, `support.oysterhr.com`, `support.velocityglobal.com`, `support.papayaglobal.com`, `support.globalization-partners.com` | **A — egress policy** | Bare `HTTP/1.1 403 Forbidden` from the proxy with **no** `200 Connection Established` line. Nothing reached the origin. | Ask for the hosts to be allowlisted. **Do not retry, do not route around** — `CLAUDE.md` §6's standing rule. |

Note the diagnostic that separates them, because it is the same one
`CLAUDE.md` §6 already paid for: **a proxy denial never prints `HTTP/1.1 200
Connection Established`; an allowed host always does, even when the site then
answers 403.** Remote's help centre printed it. The five competitor help
centres did not.

### 9.2 Open questions, by how easily a human could close them

**One click, from a logged-in Remote account** — these are the high-value ones:

1. **The exact field list of the Request Hub's RWA and travel-letter forms as
   rendered.** §3.1–3.2 give the *API's* view of the object. Whether the form
   asks anything more (nationality? role? prior trips? — see §6.4) is
   **[UNKNOWN]**. *Check: log in as an employee → Requests → New request →
   Remote Work Authorization, and screenshot the form before submitting.*
2. **The option list behind `travel_reason`.** The OpenAPI types it as a bare
   `string` described as "the category ... selected by the employee" — so a
   closed list exists in the UI and is **not published**. **[UNKNOWN]**. *Check:
   open the same form and read the dropdown.* This matters: UC-03's classifier
   is guessing at a taxonomy Remote has already fixed.
3. **The full request-type dropdown on the Requests tab.** Confirmed members:
   Employment letter, Resignation, contract extension/renewal, probation
   extension, cancel hiring before start date, contract amendment
   ([INFERRED], §2.1). Whether that is the complete list is **[UNKNOWN]**.
4. **What a specialist actually sees.** Every source here describes the
   *requester's* surface. The reviewer-side view — what a Remote mobility or
   lifecycle specialist reads when deciding — is **[UNKNOWN]** and is not
   publicly documented anywhere located. This is the closest thing to a direct
   answer to the owner's question ("the specialist reads the recommendation..."),
   and no public source answers it.

**Answerable from the Sandbox, by this project, without a human:**

5. **Whether a real `WorkAuthorizationRequest` in the Sandbox carries anything
   beyond the documented properties.** *Check: `GET
   /v1/work-authorization-requests` against the Sandbox and diff the returned
   keys against §3.2.* Would settle §6.4's five portal-only fields.
6. **Whether `work_authorization.requested` and `contract_amendment.submitted`
   carry full payloads or bare ids.** Only the COR-termination event
   *documents* itself as stateless (§5.2). Generalizing from one event to all
   of them is exactly the fixtures-agree-with-the-code failure `CLAUDE.md` §4
   warns about. **[UNKNOWN]** — *check by subscribing and reading one real
   delivery.*

**Not established at all:**

7. **Remote's internal routing and per-queue SLAs.** The public "within 24
   hours" figure is an aim stated to customers, not a routing spec. How a
   travel-letter request reaches a *mobility* specialist rather than a
   *lifecycle* one, and what the internal target is, is **[UNKNOWN]**.
8. **Whether the Request Hub forms are Zendesk ticket forms or native Remote
   product UI.** The evidence points to native product (they produce typed API
   objects with webhooks, which a Zendesk form would not), and the Zendesk
   layer sits alongside for genuine inquiries — reinforced by
   `zendesk_ticket_url` being a *link out* from the amendment object rather
   than the object living in Zendesk. Strong **[INFERRED]**, not confirmed.
9. **Velocity Global's intake surface** — nothing located (§8).
10. **Whether `POST /v1/contract-amendments` is generally available or gated**
    to particular partners/plans. The docs describe it plainly with no access
    note, unlike `POST /v1/documents` and `GET /v1/billing-documents/{id}`,
    which both carry *"contact api-support@remote.com to request access"*. The
    absence of such a note is suggestive but not proof. **[INFERRED]**.

---

## 10. Recommended follow-ups (none performed by this pass)

1. **Retire the "no amendment-request event API exists" claim** wherever it
   appears (issue #17, `docs/use-cases/UC-06.md` §15, `src/remoteui/README`),
   replacing it with §5.1's finding. Keep `src/remoteui/` — its job is to show
   the human's entry point, which a webhook cannot.
2. **Check `cutoffEngine.js` against the stated 5th-of-the-month rule** (§7).
3. **Resolve §6.4's five portal-only UC-04 fields** against a real Sandbox
   record before any of them is treated as a live gate input.
4. **Re-frame UC-01** per §6.5 — the non-standard tail, not verification
   letters in general.
5. **Cite §3.5 in the case study.** Remote shipping receipt OCR *behind a human
   confirmation step* is external validation of prime directive 1 from the
   platform this project is built against, and it is more persuasive than any
   argument this repo can make about itself.
