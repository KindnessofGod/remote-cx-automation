# Travel / visa support letter — what Remote already holds, and what has to be asked

**Written 2026-08-20 by a research agent. It changed no code, no test and no
other document.** Every claim below is tagged `[CONFIRMED]` / `[INFERRED]` /
`[PROPOSED]` / `[UNKNOWN]` and says which of three sources it rests on:
**(1)** what `src/uc03/letter.js` puts in the letter today, **(2)** where each of
those values comes from in this codebase, **(3)** what a real travel/visa support
letter is expected to contain, from primary sources listed in §8.

---

## 1. The verdict, in one sentence

**No — a travel/visa support letter is not writable purely from what Remote
already holds, and Remote's own product says so: `TravelLetterRequest` makes the
employee supply nine fields, of which the passport number, the embassy or
consulate address, the accommodation address and the trip's stated purpose are
facts that exist nowhere in the employment record.** `[CONFIRMED]` —
<https://developer.remote.com/reference/get_v1_travel-letter-requests.md>,
fetched 2026-08-20.

Three qualifications, because the flat answer is more alarming than the position
actually is:

1. **The letter this system renders today is very nearly Remote-sourced.** Six of
   its nine rows come from the employment record and the legal entity; the three
   that do not are the destination and the two travel dates — and those already
   come from the employee, just not as fields. They are read out of free prose by
   the classifier (§3). So the owner's assumption is *right about the employee
   facts* and *wrong about the mechanism*: the trip details are already the
   employee's, and today the system infers them instead of asking.
2. **One row the letter promises is unreachable on live Remote data.** The base
   compensation row renders from `employment.base_salary`, a field
   `normalizeEmployment()` does not produce for a real API response — only the
   mock's flat fixtures carry it (§4.1). That is a plumbing gap, not a
   "must ask the employee" gap: Remote does hold the figure.
3. **The gap that matters is not a gap in *this* letter — it is the gap between
   a generic employment statement and a letter a *particular* consulate will
   accept.** The Portuguese Ministry of Foreign Affairs states plainly that the
   listed documents are the initial ones and *"the consular post [may request]
   additional documents"* `[CONFIRMED — live 2026-08-20, §8]`. That is why
   `letterScope.js`'s escalation exists and why widening the form is the wrong
   instinct beyond the three fields in §6.

---

## 2. What the letter says today, row by row

Read out of `renderTravelLetterHtml()` in `src/uc03/letter.js`, not from memory.
`[CONFIRMED — source read 2026-08-20]`

| Row rendered | Expression | Ultimate source |
|---|---|---|
| Letter date | `new Date()` | the clock at draft time |
| Our reference | `ticket.externalRef` | the requester's own ticket/case reference (omitted entirely when absent) |
| Employee name | `employment.full_name` | Remote — `GET /v1/employments/{id}` → `full_name` (or `basic_information.name`) |
| Job title | `employment.job_title` | Remote — `basic_information.job_title` |
| Employment status | `employment.status` | Remote — top-level `status` |
| Contract type | `contractTypeLabel(employment.contract_type)` | Remote — `employment_model` / `type` |
| Employment start date | `employment.start_date` | Remote — `basic_information.provisional_start_date` (or `seniority_date`) |
| Employer registered in | `legalEntity.country_name \|\| country_code` | Remote — `GET /v1/companies/{id}/legal-entities` + the country registry |
| Employer name (salutation + sign-off) | `legalEntity.name` | Remote — same call |
| Destination country | `classification.destinationCountry` | **the employee's free text, read by the classifier** |
| Travel dates | `classification.startDate` / `endDate` | **the employee's free text, read by the classifier** |
| Base compensation | `employment.base_salary` + `employment.currency` | **nominally Remote; unreachable in production — see §4.1** |
| Not-a-work-authorization statement + travel disclaimer | template literal / `withDisclaimer()` | this project |

`TEMPLATE_ASSERTIONS` and `TEMPLATE_ITINERARY` in `src/uc03/letterScope.js`
already encode this split — five employment rows `from: "employment record"`,
three itinerary rows `from: "the classified request"`, all eight `required`.
Base compensation is in **neither** list, so a letter missing it produces **no
finding** and goes out silently one row short. `[CONFIRMED — source read]`

---

## 3. The three rows that already come from the employee, and how

`handleTravelInquiry(ticket, …)` takes `ticket.text` and nothing else structured
(`src/uc03/workflow.js` STEP 1). The portal's UC-03 form is a single textarea
plus an optional reference (`src/portal/assets/index.html`, `#form-uc03`).
`[CONFIRMED — both files read 2026-08-20]`

So `destinationCountry`, `startDate` and `endDate` are produced by
`classifyTravelInquiry()` — the LLM path, or a regex/date-scan fallback. The
LLM's output is validated for **type only**: `destinationCountry`, `startDate`
and `endDate` each pass if they are `string` or `null`
(`src/uc03/classifier.js` ~line 174-176). There is no ISO-shape check on either
date. `[CONFIRMED]`

Two consequences worth stating precisely, neither of them hypothetical:

- **The travel dates printed on a consular document are a model's string,
  verbatim.** The only downstream constraint is that `Date.parse()` must succeed
  on both (`computeDurationDays()`, rung 9), so garbage is refused —
  but "Sept 14 2026" and "2026-09-14T00:00:00Z" both pass and both get printed
  as they arrived. `[CONFIRMED]`
- **`letterScope.js` cannot catch a *misread* trip**, only an absent one. Its
  itinerary check tests for blank, not for correctness, which is right — nothing
  in the system can know the employee meant October. `describeLetterOffer()`
  compensates by showing `carries: {destinationCountry, startDate, endDate}`
  beside the accept control with *"If any of these is wrong, send the correction
  as a new request"*. That is a read-back, not an input. `[CONFIRMED]`

This is the strongest argument for the owner's instinct. **Asking for the two
dates and the destination as fields does not add a question the employee is not
already answering — it moves the answer off a model's reading and onto the
employee's own keystroke, on the one path where nobody reads the document before
the consulate does.**

---

## 4. Two live defects found while checking. Neither is fixed here.

### 4.1 The compensation row cannot render against a real Remote employment `[CONFIRMED]`

`renderTravelLetterHtml()` prints the row only when
`typeof employment.base_salary === "number"`. The production read is
`getEmployment()` → `normalizeEmployment(raw)`, and that function:

- returns the input untouched only when `raw.contract_type` **and**
  `raw.start_date` are both strings — the **mock's** flat shape;
- otherwise builds an explicit object that contains **no `base_salary` and no
  `currency` key at all**. Its own comment says so and says why: *"NO flat
  `base_salary`/`currency`/`weekly_hours` alias is introduced here — UC-03's
  travel letter prints `employment.base_salary` when it is a number, and
  silently starting to print salaries on a customer-facing letter is not a side
  effect a normalizer gets to have. That gap is real and is recorded as a
  handoff item rather than fixed in passing."*
  (`src/remote/restClient.js`, `normalizeEmployment()`)

The live payload committed in `test/fixtures/sandboxCapture.js` (captured from
`gateway.remote-sandbox.com` on 2026-08-19) has no top-level `contract_type` and
no `start_date`, so production always takes the second path.

**Effect:** on real Remote data the letter is issued **without** the base
compensation row, no finding fires, and `describeLetterOffer()`'s `produces`
text has already told the employee the letter *"states … your base
compensation"*. Offline it renders, because `src/remote/mockServer.js`'s
fixtures carry a flat `base_salary`, and `test/uc03AutoIssue.test.js`'s
`assert.match(issued.letterHtml, /Base compensation/)` passes against them.
**This is the fixture-agrees-with-the-code shape CLAUDE.md §4 names as the
project's most expensive recurring failure, sitting on the row `letter.js`'s own
header argues hardest to keep.**

**Remote does hold the figure**, so this is not a field to ask the employee for:

| Engagement | Where the money is | Evidence |
|---|---|---|
| Contractor | `contract_details.payment_terms.compensation_gross_amount` + `compensation_currency_code` (with `payment_terms_type: "pay_period"`, `period_unit: "monthly"`) | `[CONFIRMED]` — live capture, `test/fixtures/sandboxCapture.js` (2026-08-19) |
| EOR employee | `contract_details.annual_gross_salary` + `compensation_currency_code` | `[CONFIRMED]` — `normalizeEmployment()`'s field-by-field note, verified on NL/DE/GB/FR/CA/SG/PT employments 2026-08-18 |

Two reasons it is **not** a one-line alias, which is why it is reported and not
recommended as a quick fix:

- **The two shapes are different facts.** One is an annual salary, the other a
  monthly contractor rate. A row labelled "Base compensation" that silently
  prints either is the letter answering a means-of-subsistence question without
  saying over what period — worse than omitting it.
- **The scale is `[UNKNOWN]`.** `formatMoney()` assumes Remote's ×100 minor
  units. The captured value is `25000`. Whether that is €250.00 or €25,000.00 is
  not established anywhere I could check from this container, and printing the
  wrong one on a consular document is the failure this repository's money
  invariant exists to prevent.

### 4.2 The travel letter interpolates into HTML without escaping ~~`[CONFIRMED]`~~ **— CLOSED 2026-08-20, verified again 2026-08-29**

> **This finding is FIXED and is kept, struck, rather than deleted.** It
> understated a control that exists, which is the dangerous direction for a
> safety finding: a reader auditing this letter's output would conclude the
> template escapes nothing and could set out to "fix" what is already fixed.
> Verified by reading `src/uc03/letter.js` on 2026-08-29 — it imports
> `escapeHtml` from `src/shared/html.js` (line 99, the SHARED helper rather than
> a second copy) and every interpolation in `renderTravelLetterHtml()` routes
> through it: `full_name`, `job_title`, `status`, contract type, start date,
> `legalEntity.name`, the entity jurisdiction, the destination and its code, the
> travel window, the reference, the compensation row and the addressee line.
> Landed as its own commit (`beec724`) specifically so the ordering below is
> legible in the history rather than buried inside the feature that needed it.
>
> **One deliberate exception, which is not a gap:**
> `renderInformationalAnswer()` in the same file does NOT escape and must not
> start — it returns PLAIN TEXT posted as a Zendesk comment body, where
> `&amp;` would be shown to the customer literally. Two functions in one file
> with opposite rules; `letter.js`'s own header says so.

~~`src/uc01/letter.js` routes every interpolated value through its own
`escapeHtml()`. `src/uc03/letter.js` has no such helper and escapes nothing —
`full_name`, `job_title`, `legalEntity.name`, the destination and the date
strings all go into the template raw.~~ Today's inputs are Remote-sourced or
constrained by later gates, so this was never an exploit report; it was a
**precondition**. Any new employee-typed free-text field added to this template
(§6.3 is the only candidate) would be the first genuinely untrusted string on a
document that, on the auto-issue path, no human reads before the consulate does.
That precondition is now met, which is what unblocked §6.3.

---

## 5. The table: what a travel/visa letter plausibly needs

Sources for the "expected" column: the Commission's Visa Code Handbook I as
cited in `src/uc03/letter.js` and `docs/use-cases/UC-03.md` §18.4 (the Handbook
itself is **not** in `docs/knowledge/` — §8 records this); Remote's own
`TravelLetterRequest`, re-fetched live 2026-08-20; and the Portuguese MFA visa
portal, re-fetched live 2026-08-20.

"Remote holds it" means: reachable by this system through an endpoint it is
permitted to call, with the field named.

| Fact | Does Remote hold it? (field · endpoint) | In our letter today? | If it must be asked — why Remote cannot know it |
|---|---|---|---|
| Employee's legal name | **Yes** — `full_name` / `basic_information.name` · `GET /v1/employments/{id}` | ✅ | — |
| Job title | **Yes** — `basic_information.job_title` · same | ✅ | — |
| Employment status (active) | **Yes** — `status` · same | ✅ | — |
| Contract / engagement type | **Yes** — `employment_model` \| `type` · same | ✅ | — |
| Employment start date | **Yes** — `basic_information.provisional_start_date` · same | ✅ | — |
| Employing entity's name | **Yes** — `name` · `GET /v1/companies/{id}/legal-entities` | ✅ | — |
| Employing entity's jurisdiction | **Yes** — `country_code` (alpha-3) → registry name · same + `GET /v1/countries` | ✅ | — |
| Employing entity's registered **address** | **No** — the endpoint exposes no address field; only the mock fixture has one, and it says so about itself | ❌ | Not the employee's to supply either. A Remote data gap, `[INFERRED]` on whether consulates expect it |
| Base compensation / means of subsistence | **Yes**, but not on the path production takes — see §4.1 | ❌ **in production**, ✅ against the mock | Not an employee field. Plumbing + a period label + a scale decision |
| Destination country | **No** | ✅ (classifier's reading) | Remote learns a trip only when the employee files one; the employment record describes where they *work*, not where they are *going* |
| Travel start / end dates | **No** — Remote's own `travel_date_start` / `travel_date_end` are **employee-supplied** on `TravelLetterRequest` | ✅ (classifier's reading) | Same. A future trip is not a fact about an employment |
| Purpose of the trip, in the traveller's words | **No** — `reason`, `travel_reason` (category), `travel_reason_details` are all employee-supplied `[CONFIRMED]` | Partly — the letter asserts "the professional nature of their business travel"; the employee's own words are captured in `ticket.text` but never rendered | Only the traveller knows why they are going |
| **Embassy / consulate the letter is for** | **No** — `embassy_address`, *"The address of the embassy or consulate where the travel letter will be submitted"*, **required**, employee-supplied `[CONFIRMED]` | ❌ — "To Whom It May Concern"; asking triggers `addressee_specified` → escalate | Remote cannot know which post the employee booked. §7 |
| Passport / travel document number | **No** — `travel_document_number` is required on `TravelLetterRequest` and employee-supplied; **zero** occurrences of `passport`/`nationality`/`citizenship` on `GET /v1/employments/{id}` (UC-03 §17, re-verified live 2026-08-19; the committed capture agrees, and `personal_details` is `null`) | ❌ — triggers `identity_document_requested` → escalate | Remote's only nationality/identity surface is the **employee-session** `/v1/employee/…` family, which returns `403 invalid role` to the company token this system holds |
| Date of birth | **No** — same absence | ❌ | Personal data; no source located requiring it *of the employer's letter* `[UNKNOWN]` |
| Accommodation address at destination | **No** — `requires_travel_address` / `travel_address`, employee-supplied `[CONFIRMED]` | ❌ — triggers `accommodation_address_requested` → escalate | The employee's booking. Also a *separate evidential head* from proof of employment |
| Who bears travel / meal / accommodation costs | **No, and it is not the employee's answer either** — three enums, each documented *"Set by the employer during approval"* `[CONFIRMED]` | ❌ — triggers `cost_responsibility_requested` → escalate | It is a commitment by the employer, made by a person at approval time. **Must not be added to an employee form** |
| Employer's special instructions / particular wording | **No** — `employer_special_instructions`, employer-set at approval `[CONFIRMED]` | ❌ — triggers `wording_specified` → escalate | Same: an employer's undertaking, not an employee's statement |
| Free-text extra information | **No** — `additional_information`, employee-supplied `[CONFIRMED]` | Captured in `ticket.text`; never rendered | — |
| Named human signatory + their title | **No** — the sign-off records an approver, but whether a support specialist is an authorised representative of the employing entity is established nowhere | ❌ ("Sincerely, *entity*") | Not an employee field. A `[Stated gap]` inherited from UC-03 §18.4 |
| Another language / notarisation / apostille / wet stamp | **No** — set per consulate, not centrally `[CONFIRMED]` | ❌ — triggers `language_or_legalisation_requested` → escalate | There is no universal answer to hard-code. §8's PT source: the consular post may require more, at its discretion |
| Company registration / VAT number | **No** | ❌ | `[INFERRED]` only — no primary source located requiring it |

**Read the middle column as the answer to the owner's question.** Everything the
letter *asserts about the employment* is Remote's. Everything that makes the
letter *about a specific trip to a specific post* is the employee's, and Remote's
own request object is the proof: it asks the employee for all of it.

---

## 6. What to add to the UI — three fields, and no more

Scope rule applied throughout: **a field earns its place only if the letter
already prints it, or if a primary source says the document is expected to carry
it and the template can carry it without a human.** Everything else stays with
`letterScope.js` and escalates. Two fields are therefore explicitly *not*
proposed (§6.4).

### 6.1 Where you are going `[PROPOSED]`

- **Question on the form:** *"Which country are you travelling to?"*
- **Control:** the existing 249-entry picker (`PORTAL_COUNTRIES`,
  `src/portal/countries.js`) — value alpha-2, label the country name. Not a text
  box: that file exists because free-text countries produced the single most
  expensive defect class in this repository.
- **Required?** Optional *as a field*, because the free-text box may already say
  it. **Required as a fact** — the gates already refuse `destination_unknown`.
- **When absent:** change nothing. The classifier's reading is used exactly as
  today, and the gate refuses if it read nothing. The field is an *override*, not
  a new precondition — so no request that succeeds today can start failing.
- **Why it earns its place:** the letter prints this row today from a model's
  reading of prose, on a path with no human before the consulate.

### 6.2 When you are going `[PROPOSED]`

- **Questions:** *"First day of the trip"* and *"Last day of the trip"*
- **Control:** two `<input type="date">`. This also fixes the *format* problem in
  §3: a date input yields `YYYY-MM-DD` and nothing else.
- **Required?** Same shape as §6.1 — optional as fields, already required as
  facts (rung 9 refuses `duration_unknown`, rung 10 the 30-day cap).
- **When absent:** fall back to the classifier's reading, unchanged.
- **Why:** identical argument, and dates are the row a misreading damages most —
  a letter certifying the wrong fortnight is worse than no letter.

### 6.3 Who the letter is for — *optional, and read §7 before building it* `[PROPOSED]`

- **Question:** *"If you already know which embassy or consulate you will hand
  this to, name it here. Leave it blank and the letter will say 'To Whom It May
  Concern', which most posts accept."*
- **Required?** **Optional, always.**
- **When absent:** the letter renders exactly as it does today. Nothing changes,
  no finding, no escalation.
- **Preconditions before this one ships** — all three, not any:
  1. §4.2 (escaping) is closed, because this is the first untrusted free text on
     the document;
  2. the value is length-capped and rendered as a plain "Attention:" line, with
     no other change to the body;
  3. `letterScope.js`'s `addressee_specified` markers keep firing on the
     *request text*, so *"address it to X and confirm we pay the costs"* still
     escalates on the second clause. A field must not become a way to smuggle a
     compound ask past the scope check.

### 6.4 Two fields deliberately NOT proposed

- **Passport number.** Remote requires it on its own request object, so the
  temptation is real. But the template has no identity row, adding one means
  putting a passport number on an auto-issued document, and this project's
  directive 5 keeps personal data out. `identity_document_requested` escalating
  to a person who can write the letter by hand is the right answer.
- **Who pays for the trip.** Remote types this three ways and documents each as
  *"Set by the employer during approval"*. Asking the **employee** to state it
  would put an employer's financial undertaking on a consular document on the
  strength of the beneficiary's own claim. It is the clearest example in this
  whole file of a field that must never move onto an employee form.

### 6.5 Prefills for the existing scenarios

`src/portal/assets/app.js`'s `SCENARIOS.uc03` already carries four. The values
below are read out of each scenario's own text, so a quick-fill leaves the form
self-consistent rather than half-filled. `[PROPOSED]`

| Scenario | Destination | First day | Last day | Addressee | Expected outcome (unchanged) |
|---|---|---|---|---|---|
| Short business trip | `ES` Spain | 2026-09-14 | 2026-10-02 | *(blank)* | `auto_resolve / all_gates_passed` — informational answer + letter offer |
| Workation from Portugal | `PT` Portugal | *(blank)* | *(blank)* | *(blank)* | `route_to_uc04` — deliberately left blank: this scenario has no dates in its text, and inventing them would hide the routing this scenario exists to show |
| Visa support letter | `DE` Germany | 2026-09-20 | 2026-09-26 | *(blank)* | `auto_resolve / standard_letter_issued`, or `human_review / formal_letter_requested` where the letterhead is unreadable |
| Asked by an archived employee | `ES` Spain | 2026-09-14 | 2026-10-02 | *(blank)* | refused at rung 2, `employee_not_active` — the fields must **not** make this scenario pass |

The last row is the one to check first after building: if filling the new fields
changes that outcome, the fields have become a gate instead of an override.

---

## 7. The addressee question, answered on its own terms

**Is a plain, unadorned addressee genuinely something the template cannot carry?**

**No — the template could carry it, and the honest finding is that
`addressee_specified` is currently doing two jobs and only one of them is
load-bearing.** The evidence, in order of weight:

1. **Remote itself treats the addressee as routine intake, not as a special
   request.** `embassy_address` is a plain `string`, listed in
   `TravelLetterRequest`'s `required` array alongside the destination and the
   travel dates, described as *"The address of the embassy or consulate where the
   travel letter will be submitted."* It is not in the employer-set group — that
   group is the three cost enums plus `employer_special_instructions`.
   `[CONFIRMED — fetched 2026-08-20]` **Every** travel letter Remote generates
   has an addressee behind it. Ours has one only by escalating.
2. **`letterScope.js` says the same thing about itself.** Its `cannot` text for
   this marker reads: *"The template opens 'To Whom It May Concern' and has no
   addressee row … this system never asks for one, so there is no value to put
   there."* That is a statement about **intake**, not about the document. Compare
   `cost_responsibility_requested`, whose `cannot` is a statement about
   **authority** — *"the EMPLOYER's answer, not the employee's"* — which no field
   can fix. The two markers are not the same kind of refusal.
3. **The letter's own header lists the addressee among things it "deliberately
   does not assert", and gives one reason: the value is not held.** No source in
   this repository or in §8 says a business-travel employment statement must
   *not* be addressed.

**The trade-off, stated against the change rather than for it.** The auto-issue
path writes a letter with no human in it, which raises the bar for anything that
alters the document's content, and there are three real costs:

- **It is the first untrusted free text on the page.** ~~§4.2: nothing in
  `src/uc03/letter.js` escapes. This is cheap to fix and must be fixed first, not
  alongside.~~ **DONE, and done in the required order** — escaping landed on its
  own in `beec724` (2026-08-20) BEFORE the addressee field, exactly as this cost
  demanded; re-verified 2026-08-29. The addressee is now carried, and
  `letter.js`'s own comment at the interpolation site lists this as condition 1
  of the three §6.3 required, all of which it states must be met before the
  field is present rather than any of them.
- **A wrong addressee is worse than none.** A letter headed to the wrong post is
  a letter that reads as prepared for someone else's application; "To Whom It May
  Concern" is never wrong. The employee is the only one who can get it right, and
  they are also the one who typed it, which is the argument for making it
  optional and for showing it back in the offer's `carries` block before they
  accept.
- **It moves a class of request from a person to a machine.** Today somebody
  asking for an addressee gets a specialist who reads the whole request. Some of
  those requests carry a second ask in the same sentence. This is why §6.3's
  third precondition is not optional: the *field* may satisfy the addressee, but
  the *scan of the request text* must keep running unchanged, so a compound ask
  still escalates on its other clause.

**Recommendation `[PROPOSED]`, and it is a narrow one:** add the optional field
and the "Attention:" line **after** §4.2 is closed and **without** touching
`NON_STANDARD_ASKS`. Do not relax the marker. The result is that a plain
addressee stops being a reason to escalate *because the value can now be
supplied*, while every ask that genuinely changes the document — wording,
omissions, cost undertakings, language, legalisation, identity anchors — still
reaches a person. If the escaping work is not being done, **do not add this
field**; the demo smoothness is not worth being the first to put unescaped
employee text on an unreviewed consular document.

---

## 8. Sources

**Primary, fetched live from this container on 2026-08-20:**

- Remote API — `TravelLetterRequest` schema, its `required` array and its
  `status` enum:
  <https://developer.remote.com/reference/get_v1_travel-letter-requests.md>
  (HTTP 200, 75,046 bytes). All `[CONFIRMED]` claims about `embassy_address`,
  `travel_document_number`, `travel_address` / `requires_travel_address`,
  `reason` / `travel_reason` / `travel_reason_details`, `additional_information`
  and the three `responsible_for_*_cost` enums rest on this fetch, not on a
  quotation of it elsewhere in the repo. Note the sibling paths
  `post_v1_travel-letter-request(.md)` and `get_v1_travel-letter-requests-id.md`
  both return **404**; only the collection page resolves.
- Portugal, Ministry of Foreign Affairs — *Necessary Documentation: Temporary
  Stay*:
  <https://vistos.mne.gov.pt/en/national-visas/necessary-documentation/temporary-stay>
  (HTTP 200). Paraphrased: for subordinate work it accepts a work contract, a
  promise of one, **or a declaration by the employer confirming the labour
  link**; and the listed documents are the ones to be presented *without
  prejudice of the consular post requesting additional documents*. This is the
  live confirmation of both halves of §1: an employer's declaration is a
  recognised document, and the post can always ask for more.

**Repository-held, with provenance, read 2026-08-20:**

- `docs/knowledge/layer-1-statutory/D-11-pt-d8-consular-requirements.md` — the
  same PT ministry pages captured 2026-08-19 by an earlier session; my live fetch
  agrees with it word for word on the passage quoted above.
- `test/fixtures/sandboxCapture.js` — `GET /v1/employments/{id}` as
  `gateway.remote-sandbox.com` returned it on **2026-08-19**. The basis for
  §4.1's field names and for the absence of `custom_fields`, `start_date`,
  `personal_details`, nationality and passport.
- `docs/use-cases/UC-03.md` §17 (nationality is unreachable through any endpoint
  this system may call) and §18.1 / §18.4 / §18.5.
- Commission Implementing Decision **C(2024) 4319** Annex — the Visa Code
  Handbook I — cited by `src/uc03/letter.js` and UC-03 §18.4 with sha256
  `f671a0c…`, fetched 2026-08-20 by that pass. **It is not in `docs/knowledge/`**
  and I did not re-fetch it: `eur-lex.europa.eu` answers `HTTP 202` with zero
  bytes from this container, and `home-affairs.ec.europa.eu` is refused by the
  egress proxy outright. Everything in this file resting on the Handbook is
  therefore **second-hand within this repository** and is tagged where it
  appears.

**Refused by this container's network on 2026-08-20** — recorded, not routed
around, per CLAUDE.md §6: `home-affairs.ec.europa.eu` and `travel.state.gov`
(egress proxy, explicit block); `ind.nl`, `france-visas.gouv.fr`,
`www.exteriores.gob.es`, `www.netherlandsworldwide.nl`, `www.canada.ca`,
`nl.usembassy.gov` (no connection at all, `000`); `www.uscis.gov` (`403` — the
same Akamai refusal `D-15`'s header describes); `eur-lex.europa.eu` (`202`, empty
body). **No commercial immigration site, aggregator or mirror was consulted.**

---

## 9. What I could not establish

| Question | Status |
|---|---|
| Whether `contract_details.payment_terms.compensation_gross_amount: 25000` is in minor units (×100) or major units | `[UNKNOWN]`. Decides whether the letter would print €250.00 or €25,000.00. Must be settled from the live API before any compensation-row repair |
| Whether consulates in practice require the employer's **registered address** or a **company registration number** on such a letter | `[INFERRED]` at best. Every per-consulate source that would answer it is in the blocked list in §8. This is the class UC-03 §18.5 already flags as *where the real specificity lives* |
| Whether a **date of birth** is expected of the employer's letter (as opposed to of the applicant's own documents) | `[UNKNOWN]` — no primary source located, in this pass or the previous one |
| The closed vocabulary behind Remote's `travel_reason` category picker | `[UNKNOWN]` — the property is documented as *"The category of travel reason selected by the employee"* with no enum; `docs/INTAKE-RESEARCH.md` §9.2 records the same absence |
| Whether the **deployed** UC-03 n8n graph renders the same letter as `src/` | `[UNKNOWN]` from here. `workflows/nodes-uc03/travelRouterGates.js` holds a port of the gates; `npm run verify-deployed` is the check and it needs live n8n access. **Any field added to the portal reaches the Node path only** — the n8n path takes `ticket.text` |
| Whether the compensation gap in §4.1 has ever been observed in production | `[UNKNOWN]`. `docs/LIVE-PATH-STATUS.md` records UC-01's letter rendering *"with zero salary"* against records carrying `25000` — a different letter, which is pay-free by design. I found no record of a UC-03 letter being rendered against a live employment at all |


---

## 10. The contractor scale, settled after the fact (2026-08-20)

§9 recorded the scale of `contract_details.payment_terms.compensation_gross_amount`
as `[UNKNOWN]`, on the grounds that the field lives only inside the per-country
`contractor_contract_details` form and no token was available to fetch it. **A
token was available** — `REMOTE_API_TOKEN` is set in the session environment;
the check that concluded otherwise looked for a `.env` file rather than the
variable. Recording that, because "I could not reach it" and "it is not
reachable" are different claims, and this project has now confused them three
times.

Fetched live 2026-08-20, `GET /v1/countries/CAN/contractor_contract_details`
(HTTP 200), the field is declared:

```json
{
  "title": "Gross compensation amount",
  "type": "integer",
  "minimum": 1,
  "x-jsf-errorMessage": { "type": "Please, use US standard currency format. Ex: 1024.12" },
  "x-jsf-presentation": { "inputType": "money" }
}
```

**`[INFERRED — strong]`: minor units.** An `integer` field whose own validation
example is `1024.12` cannot be storing what the user typed; it stores that value
×100. This agrees with `annual_gross_salary`, which Remote's cost-calculator
reference states as *"in cents"* outright, and with the money ×100 invariant
this repository applies to every value crossing the API.

So the live contractor record's `compensation_gross_amount: 25000`
(`period_unit: "monthly"`, USD) reads as **$250.00 per month** — a Sandbox test
figure, not a plausible salary, which is worth knowing before anyone uses that
record to eyeball whether a rendered amount "looks right".

**This does NOT reverse the decision in `src/uc03/letter.js` to omit the
contractor row, and the distinction matters.** The blocker was never only the
scale; it is that the field is a *rate over a period* while the row it would
occupy is an annual salary, and the letter's own header argues that an
unlabelled-period figure answers the means-of-subsistence question without
saying over what period — worse than saying nothing. Rendering it needs a row
that states the period, which is a template change rather than a scale lookup.
The evidence is recorded here so that work starts from a measurement instead of
from an unknown. `[CONFIRMED]` for `annual_gross_salary`; `[INFERRED]` here.
