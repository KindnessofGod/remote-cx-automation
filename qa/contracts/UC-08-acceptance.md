# UC-08 — Canonical Acceptance Contract

> **Cross-Border Tax & Social Security Review · 🔴 High tier · Zendesk-native ticket + portal intake · dossier-only, no execution path**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-08.md` (§0–§20, and §16–§19 carry
> the four most recent passes), `docs/00-FOUNDATION.md`, `docs/01-COHERENCY-MAP.md`,
> `docs/research/UC-08 ChatGpt v1 BUILD PACK v1.md`,
> `docs/research/UC-08  ChatGpt V2 BUILD CASE (Zendesk and n8n).md`,
> `docs/research/UC-08_  GEMINI stu … Comprehensive Research and Architecture Foundation.md`,
> `src/uc08/{workflow,dossierBuilder,presenceCalculator,presenceEvidence,treatyRetriever,jurisdictionKnowledge,dossierView,inquiryParser,dossierStore,decisionSources,server,cli}.js`,
> `workflows/nodes-uc08/{buildDossier,normalizeInquiry}.js`, `workflows/README.md`,
> `test/uc08.test.js`, `test/uc08Server.test.js`, `test/uc08DecisionSources.test.js`,
> `test/n8nUc08Parity.test.js`, `docs/RETRIEVAL.md`, `docs/knowledge/README.md`,
> `docs/knowledge/layer-1-statutory/CONTRADICTIONS.md`,
> `docs/ESCALATION-DESTINATIONS.md`, `docs/APPROVAL-ROUTING.md`,
> `docs/APPROVAL-QUEUE.md`, `src/shared/escalationRouting.js`,
> `src/approvalqueue/approvalRoutes.js`, `src/portal/{ticketing,server,requestStatus}.js`,
> `zaf-app/assets/{main,panels}.js`.
>
> **This contract is the intended business truth.** Where it differs from the
> current implementation, §17 says so explicitly. No code and no test was changed
> to produce it.
>
> **A decision pass ran on 2026-08-21. Read §0 first — it is newer than every
> other section and wins where they disagree.** Seven findings were
> dispositioned, four questions answered, four new findings opened
> (`DRIFT-106`…`DRIFT-109`, §17b) and a build queue written (`T-1`…`T-28`, §18).
> The headline is that **Remote publishes a dated, located, employer-approved
> travel history this use case does not read**, while the source the spec names
> cannot produce the figure at all. Nothing in it is built.

---

## 0. DECISIONS — 2026-08-21

> **This section was written during a decision pass with the project owner. It is
> newer than every section below it, and where they disagree it wins.** Eight
> findings were dispositioned, four questions answered, and four new findings
> opened by the answering. **No code and no test was changed to produce it** —
> the changes it decides are queued in §18 as `T-1`…`T-28` and are not built.

### 0.1 The finding that reorganised the pass: Remote publishes a dated, located, employer-approved travel history, and UC-08 does not read it

`UC-08.md` §3 marks the presence-data source
**`[CONFIRMED — capability exists; specific endpoint shape not yet verified]`**,
and DRIFT-039 below rests on that unverified half. **The shape was verified this
pass**, against Remote's own OpenAPI:

```
GET /v1/travel-letter-requests       ?employment_id= &status= &order= &sort_by= &page= &page_size=
GET /v1/work-authorization-requests  ?employment_id= &status= &order= &sort_by= &page= &page_size=
```

Both objects carry, per `TravelLetterRequest` and `WorkAuthorizationRequest`:

| Field | Type | Why it matters here |
|---|---|---|
| `destination_country` | `$ref → Country` | **The place.** The same `Country` object UC-03's `letterScope.js` already reasons about |
| `travel_date_start` | `$ref → Date` | The window's opening edge |
| `travel_date_end` | `$ref → Date` | The window's closing edge |
| `status` | string (`pending`, …) | Lets an approved-only filter exist |
| `work_location` / `travel_address` | string | Sub-national location, where supplied |
| `employment_id` (query) | — | Scopes the collection to one person |

That is a travel history: **dated, located, and approved by the employer.** It is
**rung 2** of the substitution ladder (`docs/00-FOUNDATION.md` §2a) sitting
available for the exact figure this dossier is built around, while the build takes
**rung 4** — a list the requester typed.

`src/remote/restClient.js:1597` already implements
`listWorkAuthorizations({employmentId, status})`. `src/remote/mockServer.js` already
serves both collections (`:3020`, `:3727`). `src/uc03/letterScope.js:20` already
cites `get_v1_travel-letter-requests.md` by name. **UC-08 calls none of it.**

`[CONFIRMED — https://developer.remote.com/reference/get_v1_travel-letter-requests.md
and get_v1_work-authorization-requests.md, OpenAPI blocks fetched 2026-08-21]`

### 0.2 The counter-finding: the source §5 actually names cannot produce the figure at all

§5 specifies *"compute historical physical-presence days (**time-off + workation
custom fields**)"*. Both halves were checked against their schemas this pass, and
**neither can yield a dated, located presence count.**

**`Timeoff`** (`get_v1_timeoff.md`) — required properties are
`id, employment_id, status, start_date, end_date, timeoff_days, total_minutes,
timeoff_type, leave_policy, timezone`, plus optional `approved_at, approver_id,
automatic, cancel_reason, cancelled_at, document, leave_policy_variant_id, notes`.

- **There is no country property and no location property of any kind.**
- `timezone` is *"[TZ identifier](https://www.iana.org/time-zones)"* with the
  example **`Etc/UTC`** — a clock, and in that example not even a place. Many
  countries share a zone; one country spans several. It is not a location.
- `TimeoffDay` is `{day, hours, minutes}`. Per-day granularity, still no location.
- And the **sign is wrong**: a workation is someone *working*. It generates **no
  time-off record at all**. Time off records when a person was not working. It
  never records where they were.

**Custom fields** (`get_v1_employments_employment_id_custom-fields.md`) —
`ListEmploymentCustomFieldValueResponse` is `{custom_field_id, name, type, value}`.
Flat key/value, one value per field per employment. **No dates.** A trip history
cannot be represented in it under any reading. (The committed capture adds a second
independent problem: values are addressed by *human name* plus a uuid, with no
machine slug on any row — `test/fixtures/sandboxCapture.js`, `LIVE_EMPLOYMENT_CUSTOM_FIELDS`.)

**So the specification's own named data source is structurally incapable of
producing the figure the specification asks for.** This is not the build falling
short of the spec. **The spec is wrong and the build is right — for a reason
nobody ever wrote down**, which is why DRIFT-039 reads as a shortfall in the code.
Opened as **DRIFT-106**.

### 0.3 Settled negatively: `/v1/federal_taxes` has no read

§13 task 8 requires *"`/v1/federal_taxes` be verified against the OpenAPI before
use"*, and §3 carries it as `[INFERRED]`. Verified this pass. What exists is:

```
PUT /v1/employments/{employment_id}/federal-taxes      (v1 and v2)
PUT /v1/employee/federal-taxes
```

**There is no GET.** Both are *writes* — W-4 submission, US Global Payroll only,
post-enrollment only, `employment:write` / `personal_detail:write`. It is an
endpoint for a different purpose in a different direction.

**Task 8 closes with a negative answer**, which is a real result and not a
non-answer: it means no future pass should plan a read around it. Opened as
**DRIFT-108** so the `[INFERRED]` tag does not outlive the check.

### 0.4 Three traps that must not be buried

Recorded here rather than only inside a finding, because each has already cost
this repository time somewhere else.

1. **A `200` with `total_count: 0` is not the same answer as a `404`, and it is
   also not a working demo.** The committed capture
   (`test/fixtures/sandboxCapture.js`) records **both** collections in §0.1 as
   `200` with **`total_count: 0`** on the live Sandbox. So a correct, honest read
   of the right endpoint returns **nothing**, and a gate downstream of it can
   never fire. *A gate that cannot fire and a gate being careful are
   indistinguishable from outside* — UC-03's two dead gates, `docs/BUILD-LOG.md`
   §3.30. This is why `M-1` is a Step-0 measurement and why `T-4` exists.
2. **Adding a Remote read must not add a `remote` parameter to
   `handleTaxInquiry()`.** Invariant 1 is *the parameter's absence*, and
   `test/uc08.test.js` proves the no-execution-path guarantee **structurally** by
   stripping comments from the source and asserting no write-method **name**
   appears. A full `RemoteClient` passed in "carefully" names
   `patchExpenseStatus`, `createIncentive`, `patchWorkAuthorization` and the rest
   the moment it is in scope. The remedy is UC-07's `R-1` decision, one door over:
   **a read-only façade of a fixed, small method list**, whose surface names no
   write. `R-1` before `R-6` there; `T-1` before `T-2` here.
3. **Track F would give UC-08 a verdict that blocks something.** v1's build pack
   makes `UC07_EXECUTION_ALLOWED = TRUE` conditional on
   `TAX_CLEARANCE = APPROVED`. That is a 🔴 use case issuing a determination that
   gates another use case's execution — precisely the judgement this tier exists
   to refuse. The safety intuition behind it is sound and is preserved in a
   tier-legal form: *"an unresolved tax question exists for this employment"* is a
   **fact UC-07's dossier can carry**, weighed by a specialist. It is not a gate.

### 0.5 The four questions, answered

**Q1 — Should cross-routing be built from UC-03, UC-04 and UC-07 into UC-08?**

**No routing edges. Reads instead.** This is UC-07's pass rule arriving from the
opposite direction and independently:

> *Use cases connect through shared reference data and through reads of each
> other's records, never by one invoking another.*

A routing edge would let UC-03's keyword classifier **open a 🔴 tax case on a
phrase** — the identical objection that struck the UC-03 → UC-07 edge last pass
(`UC-07-acceptance.md` §5, `[CORRECTED 2026-08-21]`). But the instinct behind
DRIFT-011 and DRIFT-021 is right, and the read form delivers it without the
coupling:

| The neighbour | What it causes to exist in Remote | The read that reaches it |
|---|---|---|
| **UC-03** — travel-letter requests | a `TravelLetterRequest` with destination + dates | `GET /v1/travel-letter-requests?employment_id=` |
| **UC-04** — work-authorization requests | a `WorkAuthorizationRequest` with destination + dates | `GET /v1/work-authorization-requests?employment_id=` |
| **UC-07** — permanent relocation | nothing in Remote's API (`R-2`: UC-07 makes zero Remote calls) | — see below |

The read version is **strictly better than the edge** on three counts: there is no
edge to keep in sync; it works for trips that never went through either use case;
and it is Remote's own system of record rather than a message one of our use cases
chose to send. **DRIFT-011 and DRIFT-021 are resolved by it, not deferred.**

For **UC-07 → UC-08** there is no Remote record to read, because UC-07 makes no
Remote calls at all. The connection there runs the other way and is a *fact*, not
a gate: UC-07's dossier already declares `taxTreatyNexusConfirmed` as a
**self-declared checkbox**, and it should say so and name the open tax question —
which is `R-15`'s marking rule already decided, applied to one more field.

**Q2 — Does the demo need the Sandbox, or anything in it?**

**Today: no — and that is the problem, not the convenience.**

`handleTaxInquiry()` takes no `remote` client; that absence *is* invariant 1. All
seven `UC08-*` scenarios in `docs/DEMO-COUNTRIES.md` §4.10 pass on typed input, so
UC-08 is the **one use case that demonstrates no API skill at all** — on an
application where that is a named criterion.

The two reads in §0.1 fix that. The obstacle is §0.4 trap 1: both collections are
**empty on the live Sandbox**. Two routes out, not exclusive, and `M-1` decides
the weighting rather than the outcome:

- **Provision the Sandbox.** Neither object has a `POST` on the partner API
  (`src/remote/mockServer.js:3710` records this for work authorizations, and it is
  the CREATE-BY-EMPLOYEE / DECIDE-BY-API shape UC-04 and UC-05 both hit). So this
  is a Remote-product action, not an API call we can make.
- **Read live, fall back to a marked capture** — rung 2 with a rung-3 backstop,
  the pattern DRIFT-104 opened for UC-07 and which this use case now shares.
  **Live always wins**; a replayed fact is self-identifying; `sandbox_live` /
  `sandbox_replay` on the trace.

And either way: **the count's provenance goes on the dossier in the same sentence
as the number.** *"Read from Remote's approved travel-letter and
work-authorization records"* and *"supplied with the request; not read from
Remote"* are different classes of evidence, and a specialist reading `189 days`
cannot presently tell which one they hold.

**Q3 — Who receives tax advice: the specialist or the employee?**

**Both, and they are two different artifacts for two different readers.** The
specialist receives the **dossier** — citations, limbs, coverage, open questions,
declared absences. That is correct and does not change. The employee receives the
**outcome**, in their own words, carrying the disclaimer.

**Q4 — After the specialist finishes, what does the employee get?**

Today: **nothing.** And the object built to be that answer already exists and
reaches nobody — `dossier.customerFacingAcknowledgement` is composed, disclaimed
and tested, and is referenced by **no surface anywhere** (DRIFT-038). So §11's
*"disclaimer coverage 100%"* is satisfied **vacuously**, and
`audit.details.disclaimerApplied` is the hardcoded literal `true`
(`src/uc08/workflow.js:201`) — a field that exists to be trusted, *declaring*
rather than *reporting*.

**Decided: build the aftermath, in UC-07's `R-24` shape.** The specialist records
an outcome verb; the requester is told; the dossier leaves the waiting list. The
verbs and the placement are taken from UC-07 deliberately, because these are the
same tier with the same absent surface and two vocabularies would be worse than
one:

- `dossier_read`, then one of `proceeding_offline` / `not_proceeding` /
  `more_information_needed`.
- **Recorded on the TICKET, never on the dossier record.** Adding
  `markReviewed()` to `dossierStore` would delete the structural proof in order to
  record that it worked. `none_by_design` is unchanged; the approval row is
  unchanged; §8's invariants are unchanged.

**Q5 — does UC-07's portal-primary reframing apply here?** *(Not asked this
pass; it is `H4`, left open by UC-07's pass with the check that would answer it
named. The check was run.)*

**No.** `docs/INTAKE-RESEARCH.md` §2 holds the row `H4` asked for:

> *"**Cross-border tax question** (UC-08) | No request object exists → a support
> conversation | Free text | ❌"*

UC-07's decision rested on Remote's **product** having a Country Transfer Service
that our portal stands in for (`INTAKE-RESEARCH.md` §75). **UC-08 has no such
surface at all** — there is no Remote object for a tax question — so **the ticket
genuinely is the request**, and Zendesk here is not a stand-in but the real
channel. Of the four contracts subtitled *"Zendesk-native"*, defined as *"the
ticket **is** the request"*, **only this one earns it**;
`qa/SPEC-DRIFT-INDEX.md`'s second-pass box established that and nothing had picked
it up.

**The portal is not displaced. It is a second door** — a better-shaped form for
the same free-text question, which is why it can collect travel rows and a window
that a ticket cannot. What changes is that its dossier must reach somebody
(§0.6).

**Same tier, same absent approval surface, opposite answer** — which is why this
was left open last week instead of being settled by analogy. *"It obviously
transfers"* is the reasoning that put three endpoints in one sentence of
`00-FOUNDATION.md` and got two of them wrong.

### 0.6 The dependency that blocks three decided things at once

**There is no UC-08 ticket on the portal path, so there is nothing to record an
outcome on.** `src/portal/ticketing.js` derives `TICKETABLE_TYPES` from
`NO_TICKET_DECISIONS`, whose keys are `uc02, uc03, uc04, uc05, uc06, uc09`.
**`uc07` and `uc08` are absent**, and `docs/APPROVAL-ROUTING.md` §2 already states
the consequence — the named specialist *"is never told"* — and calls the result
*"not a hand-off"*.

Three decisions in this section rest on it: **Q4's aftermath**, **DRIFT-067's
outside-the-record metric**, and §12's *"the receiving human must not be left
unaware the case arrived."* **UC-07's `R-24` has the identical blocker.**
Build it once, for both. Opened as **DRIFT-109**, and it is `T-13`, ordered ahead
of `T-14`…`T-16`.

### 0.7 Where a presence fact is allowed to come from

The substitution ladder (§3 directive 6 of `CLAUDE.md`,
`docs/00-FOUNDATION.md` §2a) applied to this use case's one number:

| Rung | Source | Status for UC-08 |
|---|---|---|
| **1** | Remote's documentation | The two collections in §0.1 — **verified 2026-08-21** |
| **2** | The Sandbox | `GET /v1/travel-letter-requests`, `GET /v1/work-authorization-requests` — reachable, **`total_count: 0` at last capture**. `M-1` re-measures |
| **3** | Our own stand-in / a committed capture | The replay backstop. **Loud**, `sandbox_replay` on the trace, live always wins |
| **4** | A named, marked fixture | Today's typed `presencePeriods` — **legitimate, and must be labelled as rung 4** rather than presented in the same shape as a read |

Two constraints, neither negotiable: **a substituted fact is always
self-identifying**, and **money is never fabricated** — which for this use case
generalises to *a day count is never presented without its provenance*, since the
count is this dossier's money.

### 0.8 The `T-` scheme, and why it corresponds to nothing

UC-08's queued changes are prefixed **`T-1`…`T-28`**. The existing schemes are
UC-01 `G-1`…`G-4`, UC-03 `G-A`…`G-C`, UC-02 `E-1`…`E-3`, UC-04 `W-1`…`W-10`,
UC-05 `N-1`…`N-18`, UC-06 `A-1`…`A-32`, UC-07 `R-1`…`R-27`. **Eight schemes, none
corresponding.** `CLAUDE.md` §7 item 20 is the reason: this repository already has
two registers both numbering findings `C-N`, with code citing both, and a reader
following a citation can land on a confident, specific, entirely unrelated
finding.

### 0.9 What this pass did NOT decide

- **DRIFT-046** (both pgvector tables empty since provisioning) is
  **decided-by-recommendation, not closed**: `docs/RETRIEVAL.md`'s case against
  seeding is adopted, and `npm run seed-vectors` **must not be run**. Whether the
  lexical index replaces the three hand-written passages **before or after
  submission** is open — `I3`, and it is one decision with UC-07.
- **DRIFT-041** (no approval anywhere expires) stays open, and MONITORING below
  is deliberately scoped narrower than it.
- **UC-09** has had no decision pass. Nothing here decides anything for it.

---

## 1. Business purpose

An employee has been in two countries in one year and does not know what that
means for their tax. Or a company admin wants to know whether payroll withholding
starts somewhere new, or whether an A1 certificate keeps someone on home-country
social security. These are the questions where a wrong answer costs real money in
back tax, interest and penalties — and where the *shape* of the right answer
differs per country in ways no single rule expresses: three of the four demo
countries' domestic residence tests contain the number 183 and it means something
different in each; the fourth contains no number at all.

UC-08 exists to do the fact-gathering a Remote Tax Operations specialist would
otherwise do by hand — read the request, count the days, name the jurisdictions,
put the instruments in force in front of them — and then to **stop**. It authors
no guidance, decides nothing, and has no approve button anywhere by construction.

**This is the portfolio's most direct demonstration of knowing when not to
automate.** The safety case is unusually clean and the spec says so: Remote's API
exposes no tax-filing or tax-payment action at all, so "no execution path" is not
a design sacrifice here — it is a property that had to be *kept* rather than won.
Keeping it is the work: a persistence layer, an HTTP API, a browser panel and an
n8n graph were all added afterwards, and each is a place the guarantee could have
been lost.

## 2. Primary operator persona

**Role:** the **requester** is an employee or a company admin asking a
cross-border tax or social-security question. The **operator** — the person this
system's entire output is written for — is a **Remote Tax Operations specialist**.

**Experience/knowledge:** reads treaty articles and domestic residence tests for a
living; knows that a day count is one limb of a three-limb test; may have to
defend a position to a tax authority years later and therefore needs to know
where every figure came from.

**Typical working context:** a Zendesk ticket in the Tax Operations queue, with
the ZAF sidebar open. On the portal path, no ticket exists at all — see §11.

**They understand:** tax residency, permanent establishment, totalization,
certificates of coverage, withholding obligations, and the difference between a
model convention and the convention in force.

**They DO NOT know:** that a `dossierStore` exists, that `presenceEvidence` is a
separate function from `presenceCalculator` for parity reasons, what
`no_residence_test_held` or `not_in_register` are as strings, which retrieval leg
the citations came off, or that `handleTaxInquiry()` has a parameter list at all.
They must never be shown a repository path, a function name or a `D-`/`C-`
catalogue number as if it were an address they could open — that rule is enforced
by test in `test/uc08DecisionSources.test.js` and is the reason `decisionSources.js`
carries every instrument's publisher URL.

## 3. Job to be done

*Requester:* "Tell me whether I have a tax problem, and if you can't, tell me who
will and that nobody has answered it yet."

*Tax Operations specialist:* "Hand me the facts I would have spent an afternoon
gathering — how many days, where, over what window, from which records, under
which instrument — and be explicit about every one of them you could not
establish, so I never mistake your silence for a clean result."

> **[EXTENDED 2026-08-21 — §0.1]** The specialist's sentence contains
> *"from which records"*, and until this pass the only honest answer was *"the
> ones the requester typed"*. The job now includes **reading Remote's own
> travel-letter and work-authorization records** for the employment, so that
> *which records* can name an employer-approved source. Their next question —
> *"and how do you know?"* — is answered by provenance on the count, not by the
> count being larger. `T-1`…`T-3`.

## 4. Starting preconditions

- A cross-border tax or social-security question exists, as free text: a Zendesk
  ticket carrying the **Remote Employment ID** custom field (`9990000000001`), or
  a portal submission.
- **Nothing else is required.** There is no gate to fail. An inquiry with no
  country, no dates and no travel records still produces a dossier and still
  escalates — that is the design, not a gap.
- If a day count is wanted, three structured inputs must all be present:
  `targetCountry`, `windowStart`, `windowEnd`. Any one missing and no count is
  taken, and the dossier says a count was **not requested** rather than
  reporting zero.
- Travel history arrives as **supplied records**, not read from Remote. See
  DRIFT-039 — this is a divergence from the spec's §5, and it changes what the
  count is evidence of.
- **No Remote record is read at any point.** `handleTaxInquiry()` never contacts
  Remote, which is why an employment id that does not exist produces a dossier
  rather than a 404.

> **[DECIDED 2026-08-21 · NOT YET BUILT — §0.1, §0.5 Q2]** The last two bullets
> describe what is true today and stop being the intent. Remote publishes
> `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests`,
> both filterable by `employment_id` and both carrying `destination_country`,
> `travel_date_start` and `travel_date_end`. Those become the **preferred**
> source, behind a **read-only façade** — `handleTaxInquiry()` still takes no
> `remote` client, because invariant 1 is the parameter's absence and the
> structural test greps write-method *names* (§0.4 trap 2, `T-1`).
>
> Three things stay true after the change and are not softened by it: a request
> with **no employment id, no records and no Remote match still produces a
> dossier and still escalates**; a Remote read that fails or returns nothing is
> **never** an error the requester sees; and supplied records remain
> legitimate — they are **rung 4** of the ladder and must be **labelled** as
> such rather than presented in the same shape as a read (§0.7, `T-3`).

## 5. Main successful journey

1. Somebody asks a cross-border tax question in their own words — on a ticket, or
   on the portal's tax form where they can also list where they have been and
   over what period.
2. The system reads the question and says back, in plain words, what kind of
   question it took it to be — a dual-residency question, a withholding question,
   a totalisation question, or one it could not place in any of those.
3. It names the countries the request put in play, and says of each one *how* it
   got there: named in the text, or supplied as the country the day count was
   taken in. Those are different facts and a reader who cannot tell them apart
   cannot tell whether the figure in front of them is about the country they think.
3b. **[DECIDED 2026-08-21 · NOT YET BUILT]** Where an employment is identified,
   it asks Remote what travel it already knows about — the approved
   travel-letter and work-authorization requests for that person — and adds
   what it finds to the records it was given. A trip Remote already approved is
   not a trip the employee should have to remember. *(§0.1, `T-2`)*

4. It counts the distinct days spent in the country asked about, over the window
   asked about. Overlapping stays count once. Every supplied record is accounted
   for — either with the stretch of calendar it contributed, clipped to the
   window, or with the reason it contributed nothing.

4b. **[DECIDED 2026-08-21 · NOT YET BUILT]** It says, in the same sentence as the
   number, **where the records came from** — read from Remote's approved
   requests, supplied with the request, or both, naming which rows are which.
   A specialist reading *"189 days"* today cannot tell an employer-corroborated
   measurement from a recollection, and those are different classes of evidence
   for the same figure. *(§0.7, DRIFT-039, `T-3`)*
5. If any record cannot be read, or no records were supplied at all, **no number
   is produced.** The absence is stated with the offending row named.
6. It puts the instruments in force in front of the specialist: both
   jurisdictions' domestic residence tests, quoted from the authority that
   administers each, and — where the dossier names exactly two countries — the
   bilateral convention's employment-income article broken into its cumulative
   limbs, with what this system can see of each limb marked. Never `full`.
6b. **[DECIDED 2026-08-21 · NOT YET BUILT]** Where a bilateral instrument
   resolves, it prints **that instrument's own window** beside the window the
   count was taken over. C-10 records six conventions with **five different
   formulations** — taxable year, calendar year, fiscal year, floating
   twelve-month, and a money-based alternative limb in US–Canada. A requester
   who picked 1 January to 31 December has silently chosen a calendar year for a
   convention that may key on a fiscal one, and 182 against 183 is the whole
   question. The quotation is already on the page in `decisionSources.js`.
   *(DRIFT-039, `T-5`)*

7. It states, on every dossier without exception, three things nobody asked it:
   that citizenship-based taxation is not assessed anywhere and cannot be;
   that the treaty's own residence tie-breaker has not been read; and that
   permanent-establishment exposure rests on material this project holds by
   paraphrase only.
8. It says plainly that the whole thing is **research support, not a
   determination** — as the first sentence on the page, above every finding.
8b. **[DECIDED 2026-08-21 · NOT YET BUILT]** Whenever the dossier is read, it
   says **how old it is** — that this count was taken N days ago and whether its
   window has since closed. It needs nothing new to do this: the record already
   carries its own `createdAt` and its evaluated window. On a use case whose
   entire subject is elapsed days, a stale dossier being indistinguishable from
   a fresh one is the wrong thing to be unable to tell. *(DRIFT-068, `T-18`)*

9. The case is escalated to Remote Tax Operations. Nobody approves anything. A
   specialist reads the dossier, does their own analysis, and authors the guidance
   themselves.
10. The requester is told their question has been received and is with a tax
    specialist. They are given no tax answer by this system, ever.
11. **[DECIDED 2026-08-21 · NOT YET BUILT] The specialist records an outcome, and
    the requester is told.** `dossier_read`, then one of `proceeding_offline` /
    `not_proceeding` / `more_information_needed` — **recorded on the ticket,
    never on the dossier record**, because `markReviewed()` would delete the
    structural proof in order to record that it worked. The requester's status
    moves off *"with a specialist"*, and the outcome carries the disclaimer.
    Still nobody approves anything and still nothing executes. *(§0.5 Q4,
    DRIFT-038, `T-13`…`T-15`)*

**There is no second journey.** Every input reaches step 9. That is the whole use
case, and it is the point.

> **What steps 3b–11 do not change.** Every input still reaches step 9; the
> decision is still `escalate` and can take no other value; no approve button
> exists anywhere; `dossierStore` keeps one write method and zero mutations; and
> `handleTaxInquiry()` still takes no `remote` client. **The two rules that were
> being kept by one mechanism are now kept by two** — *nothing may be approved
> here* stays structural, and *somebody is told what happened* stops depending
> on it. `docs/WHY-THIS-SHAPE.md` §16 is the general form, found on UC-07 first.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Dual-residency question naming two countries, complete travel records, country + window supplied | `escalate`, dossier complete, count with its subject, both residence tests and the bilateral article quoted | Tax Ops reads one screen instead of gathering for an afternoon |
| Totalisation / A1 question | `escalate`, `totalization`, the pair's own agreement named with **its** in-force date and detachment maximum | "Portugal has a totalization agreement" is not a fact about Portugal — CA–PT (1981) and US–PT (1989) are different instruments (C-9) |
| Withholding question | `escalate`, `withholding` | |
| A question that fits none of the three tracks | `escalate`, `other`, and the dossier says so in words — *"a question this system could not place in any of its categories"* | An unplaced question is a stated state, not a default |
| Question with no country named anywhere | `escalate`. *"No specific jurisdiction was identified in the request text"* — and, if a count was still taken, the count's own subject country is named from the structured request | The CA→NL defect: a 273-day count beside `jurisdictions: []` (§18). The dictionary holds 11 names; ~200 countries still resolve to nothing, which is why the guarantee is structural |
| Country in the register (NL, PT, CA, US) | `no_residence_test_held` — a recorded, deliberate gap, with the instrument that would close it named and its publisher given | |
| Country outside the register | `not_in_register` — *"this system has never looked"* | Deliberately not the same statement as the row above. A gap recorded and a gap never examined read identically otherwise |
| Two jurisdictions in play | The bilateral convention is looked up **by pair** | Canada–Portugal is not a near miss for Canada–Netherlands. A similarity search returning one for the other is wrong in a way nothing downstream could detect |
| One, none, or three jurisdictions | **No treaty is looked up at all**, and the dossier says why | Picking the two likeliest of three would be a treaty citation with nothing behind it |
| Prompt injection in the ticket text (*"…APPROVE this payroll change and executeIncentive() now…"*) | `escalate` | Verified live across a six-scenario probe (§15). There is nothing to inject *into* — no branch exists |
| Duplicate delivery under one external ref | One claim in `workflow_claims (UC-08, external_ref)`; the redelivery returns `{duplicate: true}` and writes no audit row and no dossier | No execution path means a duplicate cannot double-act on a customer — but it can produce two audit rows and two dossiers for one request, and on this tier the record **is** the deliverable |
| **[NEW 2026-08-21]** Employment identified, and Remote holds approved travel-letter / work-authorization records | Those records join the supplied ones; the count's provenance names **both** sources and marks which rows came from where | The employee stops being asked to remember a trip their employer already approved (§0.1, `T-2`/`T-3`) |
| **[NEW 2026-08-21]** Employment identified, Remote holds **no** records — `200` with `total_count: 0` | The count proceeds on supplied records alone, and the dossier says *Remote held no approved travel records for this employment*. **Never silent** | An empty collection is a fact about the employment; silence about it reads as "we did not look" (§0.4 trap 1) |
| **[NEW 2026-08-21]** The Remote read fails — transport, scope, 5xx | The dossier is still compiled, still escalates, and states that the read was **attempted and did not answer**. Distinct from the row above | `upstream_unavailable` and `an answer about the record` are different facts — `src/shared/upstreamFailure.js` already makes this distinction for six other use cases |
| **[NEW 2026-08-21]** Live read unavailable and a committed capture is used | The dossier and the audit trace both say `sandbox_replay`, with the capture's date | A fallback that is not marked makes the API claim unfalsifiable — DRIFT-104, decided for UC-07 and shared here (§0.7) |
| **[NEW 2026-08-21]** The window used disagrees with the resolved instrument's own window | Both are printed; **neither is silently corrected** | Choosing for the requester would be making the residence determination this tier refuses (`T-5`) |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **No presence records supplied at all, but a country and window given** | `NOT_EVALUATED`, never `{days: 0}`. A confident *"0 distinct day(s) in GB"* is a positive claim about where somebody was, computed from nothing, printed beside a citation of the 183-day rule (F-38) |
| **Records exist and none of them match the country** | A **counted zero**, deliberately. Five travel records none of which are GB genuinely is zero days in GB. That is a finding, not an absence, and the panel reports `N of M supplied record(s) fell in that country and window` so the two are distinguishable at a glance |
| **A record falls entirely outside the window** | Counted zero for that record, listed with `excludedBecause` |
| **A half-entered record — country and start date, no end date** | Forwarded raw, and the whole count comes back `NOT COUNTED — unparseable period dates for GB: "2026-07-01" → ""`. Not filtered out upstream: F-40 was a portal adapter deleting exactly that row and printing a confident 92-day count from what was left, with nothing saying anything had been discarded |
| **A row the requester never touched** | Still dropped. An empty row is not a stated period |
| **Two records covering the same calendar day** | Counted once. Summing period lengths made two overlapping records covering one leap year report 732 days in a 366-day window — the direction that **invents** a 183-day breach |
| **Country code `"de"` or `"DE "`** | Trimmed and upper-cased on both sides. Exact matching dropped every period silently — the direction that **hides** a breach |
| **End date before start date; unparseable window** | Explicit `NOT_EVALUATED` naming the offending row. Never clamped to the window boundary |
| **The word "resident", "under", "considered" or "provided" in the text** | Must **not** put Germany in the jurisdiction list. The bare `de` dictionary key was matched as a substring and did exactly that; `compileCountryDictionary()` now refuses bare two-letter keys outright |
| **An employee id containing `a1`, or a ticket number containing `183`** | Must not cite the A1 certificate or the 183-day article — and must certainly not tell the reader that is *why* it was cited. Word-boundary matching, because `matchedOn` is a statement about our retrieval that the reader is entitled to trust |
| **LLM parse returns an invalid shape** | Rule-based fallback, silently correct. **The result is not source-tagged** — see DRIFT-069 |
| **LLM narrative fails** | Retried 3× with backoff, then the deterministic template, which composes the same jurisdiction and citizenship statements the prompt instructs the model to restate |
| **Faithfulness judge unconfigured or returns garbage** | An explicit `{verdict: "not_evaluated"}` sentinel, never a fabricated positive **or** negative. Surfaced as a priority-3 open question. Never read by any gate — verified: `faithfulness` is written into the dossier and read only by `collectOpenQuestions()` |
| **A dossier row written by the n8n path** | Carries no `presenceEvidence` block, and the view says *"the records this count was taken from were not recorded on this dossier"* — never renders an empty period list as "no records were supplied", which is a much stronger claim |
| **A dossier written before any of this existed** | Gains the jurisdiction statement, the citation-coverage scope and the statutory sources anyway: they are derived at **read** time, so a dossier compiled last month gains the Canada–Netherlands convention the moment it is next opened |
| **Somebody POSTs to a dossier path** | `404 no_such_route`. Not a runtime refusal — there is no POST route in the file |
| **Somebody GETs a dossier on the public deployment** | `signed_identity_required` unless a verified ZAF token is presented. The read gate matters here because the response carries an employment id and the requester's own words |
| **[NEW 2026-08-21] A `pending` work-authorization request** | Excluded from the count by default, and **said so** — a requested trip is not a taken one. `status` is a query parameter on both collections, so this is a filter and not arithmetic (`T-2`) |
| **[NEW 2026-08-21] A Remote record whose `travel_date_end` is null or unparseable** | The same treatment as a half-entered supplied row: forwarded raw, and the count comes back `NOT_EVALUATED` naming it. **A Remote-sourced row gets no arithmetic privilege over a typed one** |
| **[NEW 2026-08-21] A Remote record and a supplied record covering the same days** | Counted once — they are the same trip described twice. The union rule already handles it; what is new is that the provenance line must not double-count the *sources* either (`T-3`) |
| **[NEW 2026-08-21] A replayed capture older than the staleness horizon** | Still used, still marked, and the dossier says how old the capture is. **Refusing would fail the demo the fallback exists to protect**; concealing the age would be worse than either (`I4`) |
| **[NEW 2026-08-21] A dossier read N days after it was compiled** | The read-time view states its age and whether its window has since closed. Needs no new dependency — `createdAt` and the window are both on the record (`T-18`) |

## 8. Invariants — must never happen

1. **No execution path exists, and its absence is structural rather than
   checked.** `handleTaxInquiry()` accepts `{audit, dossierStore, classify,
   treatyRetriever, draftNarrative, judge}` — there is no parameter through which
   a write-capable client could be passed, so there is no runtime check to have a
   bug in.
2. **No customer-facing tax guidance is ever sent automatically.** The n8n graph's
   single terminal node is a Zendesk *internal note*; the drafted acknowledgement
   is for a human to send.
3. **The store has exactly one write method and zero mutation methods.** No
   approve, no decline, no status to flip. Adding one would give the next bug a
   place to live.
4. **The API has a GET route and no POST route in the file**, so the API layer can
   never become a second execution path.
5. **The n8n graph has no Switch and no IF node anywhere**, and every execution
   ends at the same single Zendesk internal-note update. *(Not verifiable from
   this repository — see §16 item 8.)*
6. **The decision is `escalate`, always, and no input can change it** — not a
   flag, not a risk score, not a faithfulness verdict, not a citation.
7. **A day count is never rendered without a statement of what is known about the
   jurisdiction it counts days in.** `jurisdictionCoverage` is *derived* inside
   `buildDossier()` and is not a parameter, so no call site can omit it. Where
   nothing is known, saying so out loud is the discharge of this invariant.
8. **A day count with no jurisdiction is never printed in the shape of an
   answer.** It is not a weaker answer than one with jurisdictions; it is an
   answer to a different question, and the reader supplies the missing half from
   memory — and the half they supply is the 183-day frame the corpus cites, which
   is a general model-convention article and not a rule of any country in play.
9. **A missing count is never a zero, and never a number.** `NOT_EVALUATED` with
   `days: null` and the offending input named. A stated zero reads as *"well under
   the 183-day threshold"*, which is a conclusion nobody computed.
10. **No threshold, window, treaty article or residence rule is encoded as a
    value anywhere in this use case.** `183`, `365` and `180` appear nowhere in
    `JURISDICTION_REGISTER`, asserted by test; every number in `decisionSources.js`
    lives inside a quotation and is never a field.
11. **Every citation states why it matched, and never invents a precision score.**
    A keyword match quotes the literal keyword; an embedding match states its rank
    and the threshold it cleared, in words. A similarity figure is a retrieval
    signal, not a precision claim, and *"92% similar"* is unearned authority.
12. **A citation is never invented.** Every vendored `path` resolves to a file on
    disk that still opens with its catalogue id — asserted by test — and every
    quotation is matched against the sidecar it is attributed to.
13. **A finding with no source gets an explicit statement that it has none**,
    never the closest thing to hand, and the two absences that read identically on
    a screen stay distinguished: a finding about *this system* no authority will
    ever publish on, and a finding about a jurisdiction this corpus does not hold.
14. **No treaty limb is ever marked `full`.** A day count answers limb (a) of a
    three-limb cumulative test; under an EOR arrangement (b) and (c) are usually
    the limbs that decide it, and they are the two this repository has no
    representation of (C-11).
15. **A treaty is never resolved by nearest match.** The map is keyed on the
    **pair**; one, none or three jurisdictions resolve to nothing.
16. **No citation id, threshold or caveat weight ever appears in a conditional.**
    No module in the decision path imports `decisionSources.js`, asserted by test.
17. **The mandatory framing statement is never skipped and never buried.** It
    renders above every finding, never inside a disclosure, and its wording is
    only ever the server's — both browser assets are asserted to contain no
    hard-coded disclaimer, and a view carrying no `framing` renders no block
    rather than one the browser invented.
18. **Corpus licence constraints hold absolutely.** OECD Model and BEPS material
    is paraphrase-only and never copied; the commercial databases (IBFD, Bloomberg
    Tax, Vialto) are excluded entirely — not fetched, not paraphrased;
    `support.remote.com` is cite-and-link only and is not a tax authority, so it is
    cited here not at all.
19. **The LLM never asserts a residency, withholding or coverage conclusion**, and
    the classifier labels the *question*, never answers it.
20. **One request produces one audit row and one dossier**, guaranteed by the
    `workflow_claims (use_case, external_ref)` primary key rather than by a
    check-then-insert.

**[ADDED 2026-08-21 · DECIDED, NOT YET BUILT — these five are the guardrails on
everything §0 decides. Each is written so a test can fail on it.]**

21. **The Remote read reaches this use case through a read-only façade whose
    surface names no write method.** Not a `RemoteClient` used with discipline —
    the structural test strips comments and greps for write-method **names**, and
    a client that merely *could* write names `patchExpenseStatus`,
    `createIncentive` and `patchWorkAuthorization` the moment it is in scope. The
    façade's method list is fixed and small, and `handleTaxInquiry()`'s signature
    still contains no `remote` parameter. *(§0.4 trap 2, `T-1`)*
22. **A day count is never presented without its provenance.** The count is this
    use case's money, and the substitution ladder's rule for money applies to it:
    read-from-Remote, supplied-by-the-requester and replayed-from-a-capture are
    three different classes of evidence and must be distinguishable **on the page
    the specialist reads**, not only in the API response. *(§0.7, `T-3`)*
23. **A substituted or replayed fact is self-identifying.** A capture used in
    place of a live read says so on the dossier and on the audit trace
    (`sandbox_replay`), with its date. **Live always wins**; a real value is never
    overwritten by a captured one. *(DRIFT-104, `T-4`)*
24. **No UC-08 output ever gates another use case's execution.** v1's Track F —
    `TAX_CLEARANCE = APPROVED` ⇒ `UC07_EXECUTION_ALLOWED = TRUE` — is **not
    built and must not be**. UC-08 may hand another use case a *fact*; it may
    never hand it a *verdict*. *(§0.4 trap 3, DRIFT-068, `T-21`)*
25. **The specialist's outcome is recorded on the ticket and never on the
    dossier record.** Invariants 3 and 4 are unchanged by the aftermath: no
    mutation method is added to `dossierStore`, no POST route is added to
    `src/uc08/server.js`, and the approval row stays `verbs: []` /
    `control: "none_by_design"`. *(§0.5 Q4, `T-14`)*

## 9. AI responsibilities

**The LLM may:** classify the inquiry into one of four tracks (three named plus
an honest `other`); list the countries the text names; and draft the narrative
that restates already-computed facts as prose for the specialist.

**The LLM is instructed, in the narrative prompt, to restate two given
not-knowing statements verbatim** — the jurisdiction-knowledge sentence and the
citizenship gap — and told not to soften either, not to add a threshold, a window
or a country rule of its own, and never to state a number of days when the count
is `NOT_EVALUATED`, *not even zero*.

**The LLM must never be the source of:** a day count, a jurisdiction the text did
not name, a threshold, a window, a treaty article, a residency conclusion, a
withholding conclusion, a coverage conclusion, or the decision. It cannot reach
the decision: there is one.

**A second LLM judges the first**, scoring the drafted narrative's faithfulness to
the structured facts. It is informational only, consulted by nothing, and fails to
an explicit `not_evaluated` rather than to a verdict in either direction.

> **[EXTENDED 2026-08-21]** The Remote reads decided in §0.1 add nothing to this
> list and are **deliberately kept away from it**. The façade's output is
> structured records — country, start, end, status — that go straight into the
> deterministic union arithmetic. **No Remote record is ever put in front of the
> LLM**, not as context and not for summarisation, so the model cannot become
> the source of a date, a destination or a record that Remote did not send.
> Adding the reads makes the deterministic half larger and the LLM's share of
> the dossier smaller, which is the direction this architecture is supposed to
> move in. *(`T-2`)*

## 10. Deterministic responsibilities

Presence-day arithmetic as a **union of calendar days**, UTC-indexed so no
timezone can move a boundary · **[NEW 2026-08-21]** the façade read of Remote's
approved travel-letter and work-authorization requests, its status filter and its
three-state outcome (records / none / unreachable) · **[NEW 2026-08-21]** the
provenance line, the instrument-window comparison and the read-time staleness
statement, all three derived rather than passed · the evidence block naming every
supplied record's contribution or its exclusion · word-boundary country and
keyword matching ·
jurisdiction coverage, derived not passed · the statutory lookup, keyed on
country and on pair, with no ranking and no score · the citation-coverage scope
statement · the ranked open questions · the mandatory framing · the audit row ·
the exactly-once claim.

The deterministic core exists twice — `src/uc08/` and
`workflows/nodes-uc08/buildDossier.js` — and `test/n8nUc08Parity.test.js` executes
the real node body in a sandbox and compares inquiry type, jurisdictions, presence
days and citations field for field, plus the composed jurisdiction sentence word
for word. **The n8n copy carries the F-38 empty-records guard and the parity suite
now pairs a target country with an empty record list** — the divergence §16 of the
spec records as open is closed.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Always. Every inquiry, without exception |
| **Who** | **Nobody approves anything, and no role would change that.** `src/approvalqueue/approvalRoutes.js` classifies UC-08 `control: "none_by_design"`, `hasPostRoute: false`, `verbs: []`, `roles: []` — deliberately distinguished from `none_missing`, which is what four other use cases get. Tax Operations *reads* and authors guidance outside this system |
| **Owning team** | **Tax Operations** · `queue_tax_operations` · `escalation_tax_operations` · Zendesk group `6168394287519`, which exists live. Spelled consistently — the only variation is "Tax Ops" as an abbreviation, and `docs/ESCALATION-DESTINATIONS.md` marks it ✅ agree |
| **Evidence handed over** | The count with its country, window and records; both residence tests quoted from the administering authority; the bilateral article limb by limb with what is visible of each; the totalization instrument with its own in-force date and detachment maximum; the corpus's scope and retrieval mode; and the ranked list of everything that could not be established |
| **Expiry** | **None.** No reminder, no re-check, no staleness policy — and this is worse here than elsewhere, because presence days and treaty status both change under a dossier that is still sitting in a queue. v1's MONITORING/re-assessment architecture is unbuilt (DRIFT-068), and the system-wide gap is DRIFT-041. **[DECIDED 2026-08-21 · NOT YET BUILT]** The narrow, tier-legal form is built first: a **read-time staleness statement** — the dossier says how old its count is and whether its window has closed — needing no new dependency, no parameter and no route, because `createdAt` and the window are already on the record. That is not an expiry policy and does not close DRIFT-041; it makes a stale dossier *visibly* stale, which is the half that is cheap and the half that is missing (`T-18`) |
| **Afterwards** | **[DECIDED 2026-08-21 · NOT YET BUILT]** The specialist records an outcome — `dossier_read`, then one of `proceeding_offline` / `not_proceeding` / `more_information_needed` — **on the ticket, never on the dossier record**, and the requester's status moves off *"with a specialist"*. This is UC-07's `R-24`, adopted verbatim so the two 🔴 use cases share one vocabulary. It adds no approval and no execution: none of these verbs does anything in Remote (§0.5 Q4, `T-14`/`T-15`) |
| **If nobody responds** | On the **Zendesk path**, the ticket sits in the Tax Operations queue, tagged and assigned. On the **portal path there is no ticket at all** — `src/portal/ticketing.js` excludes UC-08 from `TICKETABLE_TYPES` because linking a ticket means writing an id back onto a record whose store has one write method and zero mutations. That reasoning is right and must not be undone; its consequence is that a compiled, audited dossier sits in `uc08_dossiers` with nothing in anybody's queue. *"Where is this approved?"* is **nowhere, and correctly nowhere**. *"Where does the specialist read it?"* is still **they have to know to look**. **[DECIDED 2026-08-21 · NOT YET BUILT]** Two rules were being kept by one mechanism here, and only the first is the invariant: *nothing may be approved* and *nobody may ever be told*. UC-08 joins `TICKETABLE_TYPES` so a portal dossier raises a Tax Operations ticket — **the id travels one way, record → ticket**, leaving the store's one-write-method surface untouched. `docs/WHY-THIS-SHAPE.md` §16; DRIFT-109; `T-13` |

## 12. CROSS_UC_ROUTING

> **[DECIDED 2026-08-21 — §0.5 Q1. This box is newer than the analysis below it
> and settles the three open routing questions in it.]**
>
> **No routing edge is built, in either direction. UC-08 reads the records its
> neighbours cause instead.** The rule is UC-07's, arrived at independently from
> the opposite direction:
>
> > *Use cases connect through shared reference data and through reads of each
> > other's records, never by one invoking another.*
>
> **Why not an edge.** A UC-03 → UC-08 route lets a 🟢 keyword classifier open a
> 🔴 tax case on a phrase — the identical objection that struck UC-03 → UC-07
> last pass. A UC-04 → UC-08 route has the same shape one door over. And an edge
> is a message *one of our use cases chose to send*, which has to be kept in sync
> and is silent about every trip that never went through the sender.
>
> **What replaces it, and why it is strictly better.** Remote's own system of
> record already holds the facts, and the read reaches them whatever caused them:
>
> | Neighbour | What it causes to exist in Remote | The read that reaches it |
> |---|---|---|
> | **UC-03** travel-letter requests | `TravelLetterRequest` — `destination_country`, `travel_date_start`, `travel_date_end`, `status` | `GET /v1/travel-letter-requests?employment_id=` |
> | **UC-04** work-authorization requests | `WorkAuthorizationRequest` — the same four, plus `work_location` | `GET /v1/work-authorization-requests?employment_id=` |
> | **UC-07** permanent relocation | **nothing** — UC-07 makes zero Remote API calls (`R-2`) | none; the connection runs the other way, as a fact |
>
> **DRIFT-011 and DRIFT-021 are resolved by this, not deferred.** Their instinct
> was right and their mechanism was wrong.
>
> **UC-07 → UC-08 specifically.** There is no Remote record to read, so the
> connection is a *fact on UC-07's dossier*, not a route into UC-08:
> `taxTreatyNexusConfirmed` is a **self-declared checkbox** and must be marked as
> one, naming the open tax question. That is `R-15`'s marking rule applied to one
> more field, not new machinery.
>
> **Track F stays unbuilt on merit**, and is now invariant 24. v1 makes
> `UC07_EXECUTION_ALLOWED` conditional on `TAX_CLEARANCE = APPROVED`; that is a
> 🔴 use case issuing a determination that gates another's execution, which is
> the judgement this tier refuses. The safety intuition survives in tier-legal
> form: *"an unresolved tax question exists for this employment"* is a fact a
> specialist weighs, not a gate.

**May receive from**

- **Nothing.** UC-08 is an entry point: a Zendesk ticket, or the portal's tax form.
- **Documented but NOT BUILT — UC-03 → UC-08.** `UC-03.md` §5 routes
  tax-flavoured requests here and its §12 test 4 is *"Explicit tax-residency
  question → route to UC-08."* `src/uc03/policyEngine.js`'s classifier recognises
  exactly two intents, `business_travel` and `work_authorization`, and the only
  cross-UC route built anywhere in this system is UC-03 → UC-04. So an explicit
  tax-residency question submitted through the travel door reaches **Travel &
  Mobility Support**, and the mandatory tax disclaimer — which lives inside
  `buildDossier()` and therefore only exists on a UC-08 dossier — never applies to
  it at all. Recorded by the lead pass as **DRIFT-011**; referenced here, not
  renumbered. **RESOLVED 2026-08-21 by the box above: no route.** The tax
  disclaimer problem is real and separate — a tax-flavoured request reaching
  Travel & Mobility carries no tax framing at all — and it is a UC-03 copy
  question, not a routing one.
- **Arguably should exist and does not — UC-04 → UC-08.** `src/uc04/riskMatrix.js`
  computes cumulative presence and a Schengen per-day window as a matter of
  routine. Accumulated presence crossing a threshold is precisely UC-08's subject,
  and UC-04 has nowhere to send it: it escalates to a mobility queue instead, so a
  tax exposure discovered by the risk matrix reaches a mobility specialist rather
  than Tax Operations. Recorded as **DRIFT-021**; referenced here, not renumbered.
  **RESOLVED 2026-08-21 by the box above: no route — the read.** UC-04's own
  work-authorization requests are the records UC-08 now reads, so the accumulated
  presence UC-04 computes becomes visible to UC-08 **without UC-04 having to
  decide that a tax case exists**, which is the part it is not competent to
  judge.
- **Arguably should exist and does not — UC-07 → UC-08.** A permanent relocation
  is a tax-nexus event on both ends at once. `src/uc07/` handles it with a
  **declared boolean** — `taxTreatyNexusConfirmed`, a checkbox on the request —
  and cites the same six conventions out of its own `decisionSources.js`, while
  the machinery that actually counts days and states what is not known about a
  jurisdiction sits one directory away and is never called. v1's build pack
  designed the dependency in the opposite direction and stronger than a route:
  UC-08's Track F gate (`TAX_CLEARANCE = APPROVED` **and** `SOCIAL_SECURITY =
  RESOLVED` **and** `PE_RISK = ACCEPTABLE` **and** `WORK_AUTH = VALID`, only then
  `UC07_EXECUTION_ALLOWED = TRUE`) exists *"to avoid the dangerous scenario where
  the tax engine approves a move that is legally impossible from an immigration
  perspective."* Neither the gate nor any route exists in either direction. See
  DRIFT-068. **RESOLVED 2026-08-21: the gate is refused on merit and is now
  invariant 24; the dependency survives as a marked self-declaration on UC-07's
  dossier.** Note what this bullet's own comparison misses — UC-07 makes no
  Remote calls at all (`R-2`), so *"the machinery sits one directory away"* is
  true, and the data that machinery would run on does not exist on that side
  either.

**May route to**

- **Nothing.** UC-08 terminates in a dossier and an escalation. This is correct
  and must stay correct: routing onward would require deciding *what* to route,
  which is the judgement this tier refuses to make.

**Routing conditions**

None, inbound or outbound. There is no condition anywhere in `src/uc08/` that
selects between two destinations, because there are not two destinations.

**Context that MUST transfer**

Assessed against the hand-off UC-08 actually performs — compiled dossier →
Tax Operations specialist — since no cross-UC transfer exists.

| | Carried today | Notes |
|---|---|---|
| Customer/user identity | ❌ | The audit actor is `employmentId ?? "unauthenticated"`, and that employment id is a **caller-supplied claim** verified nowhere. The n8n normaliser derives `session.authenticatedEmail` from the Zendesk-authenticated requester and `handleTaxInquiry()` never reads it. See DRIFT-069 |
| Employment/entity identifier | ⚠️ | Present on the row and printed on the sidebar as a **bare 36-character UUID** under the label "Employee". `src/uc08/server.js` is one of exactly three servers that does not import `src/shared/employeeSubject.js` (with `src/review/server.js` and `src/uc07/server.js`); the other six publish a person. `loadUc08()` already reads `data.employee \|\| null`, so the browser half is done and the server half is not. Cross-cutting **DRIFT-042** |
| Zendesk ticket / reference | ⚠️ | On the Zendesk path, `externalRef` is the ticket id and the note lands on that ticket. On the **portal path no ticket exists**, so there is nothing to carry |
| Trace / correlation id | ✅ | One `externalRef` spans the claim, the audit row, the trace rows and the dossier row |
| Evidence already gathered | ⚠️ | Rich on the API and thin on the screen. `describeDossier()` computes the presence statement with its subject and basis, the citation-coverage scope, the ranked open questions and the unconditional absences on **every** read — and the only client that renders any of it drops all but `basis`. See DRIFT-037 |
| Decision / risk information | ✅ | `escalate` / `high`, and there is no other value either could take |
| Approvals already obtained | n/a | None exist, by design |
| Relevant conversation | ✅ | The original request text reaches the classifier and the ticket note |
| Session / persona | ❌ | No persona check on the portal's UC-08 adapter at all, and no session reaches the workflow |
| **Other required state** | ❌ | The count's **window** is chosen by whoever filled the form. C-10 records six bilateral instruments with **five distinct formulations** of the 183-day window — taxable year, calendar year, fiscal year, floating 12-month — and none of them is a window this system asks for or checks. The dossier states the window it used and states, correctly, that the count is measured against no jurisdiction's rule; it does not state which window the applicable instrument would have required. See DRIFT-039 |

**Must NOT happen during handoff**

- ❌ The customer must not repeat what they already said. **Satisfied** on both
  paths — the request text and the supplied records travel with the case.
- ❌ Duplicate work must not be created. **Satisfied structurally** — UC-08
  creates no record in any other use case, and cannot: it holds no client.
- ❌ Audit continuity must not be lost. **Satisfied** — one `externalRef`, one
  claim, one `audit_log` row, per-attempt `audit_trace` rows beneath it. The audit
  row carries `jurisdictionKnowledge.state` deliberately, so that months later
  `jurisdictions: []` is distinguishable from a request about nowhere.
- ❌ Approval state must not be lost. **n/a** — none is ever obtained.
- ❌ Ownership must not become ambiguous. **Satisfied.** Tax Operations is named
  identically in the routing table, the escalation doc, the approval-routes row
  and the use case's own prose. This is the one hand-off in the system with no
  said-versus-routed contradiction.
- ❌ Two use cases must not execute conflicting actions. **Satisfied
  structurally** — this one executes nothing at all.
- ❌ Duplicate Zendesk tickets must not be created. **Satisfied trivially** —
  UC-08 creates no ticket on any path.
- ❌ **The receiving human must not be left unaware the case arrived.**
  ⚠️ **At risk, and this is the sharpest hazard on the list.** On the portal path
  the dossier reaches no queue, no group and no view; `docs/APPROVAL-ROUTING.md`
  §2 states it plainly — *"the specialist named in `escalationRouting.js` … is
  never told"* — and calls the result *"not a hand-off"*.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Portal (requester)** | The tax form: free text, an optional target country chosen from Remote's own list, a window, and travel rows — where a **partly-filled row is forwarded, not deleted**. The result opens with the answer, and carries **no offer**, because there is no next action the requester could take. A hand-off says so in place; it does not interrupt with a button nobody can press |
| **Portal — "My requests"** | The dossier under its own state: `noDecisionPath("cross-border tax dossier", "a tax specialist")`. Never "awaiting approval", because nothing is. **[DECIDED 2026-08-21 · NOT YET BUILT]** That state must also be able to *end*: once the specialist records an outcome, the requester's row moves off *"with a tax specialist"* and shows what was concluded. Today it says the same thing for ever, because nothing can change it (`T-15`) |
| **Portal — the ticket that does not exist** | ⚠️ **Blocking, and it blocks three other decisions.** `src/portal/ticketing.js` derives `TICKETABLE_TYPES` from `NO_TICKET_DECISIONS`, whose keys are `uc02, uc03, uc04, uc05, uc06, uc09`. **`uc07` and `uc08` are absent**, so a portal-submitted dossier reaches no queue, no group and no view — `docs/APPROVAL-ROUTING.md` §2 calls it *"not a hand-off"*. The aftermath (`T-14`), the outside-the-record metric (`T-16`) and §12's *"the receiving human must not be left unaware"* all need something to hang on. **DRIFT-109**, shared with UC-07's `R-24`; `T-13` |
| **Zendesk ticket** | Tagged `uc08` and `queue_tax_operations` (`escalation_tax_operations` on the escalation), assigned to Tax Operations by the shared `Assign Routing` node. **An internal note only** — no public reply is ever posted automatically |
| **ZAF sidebar** | The mandatory framing sentence directly under the header, above every finding, never inside a `<details>` — measured at character ~283 and 253px from the top, on a page where it previously appeared **nowhere at all**. Then the record, which on this panel *is* the analysis: inquiry type in words, jurisdictions by name **with their codes** (the one row where the code earns its place, because a specialist goes on to look the pair up in an index keyed by code), presence days, the retriever's matches labelled *"Reference corpus matched"* rather than "Citations", the narrative, and the statutory `basis` blocks with their quotations, locators and caveats. **No controls at all** — `renderActions` is absent from the panel and `view.actionable` is `false`, set once, server-side |
| **ZAF sidebar — what is missing** | The presence statement with its subject and window; the ranked open questions; the citation-coverage scope; the three unconditional absences. All four are on the wire and none reaches the screen (DRIFT-037). The "Employee" row is a bare UUID (DRIFT-042). The "Presence days" row is a bare number with no country and, on an un-evaluated count, reads `null day(s) across 0 period(s)` |
| **Live Feed / audit viewer** | The escalation and every LLM attempt beneath it: `inquiryType`, `jurisdictions`, `jurisdictionKnowledge.state`, `presenceCountry`, `presenceDays`, `citationIds`, `disclaimerApplied` |
| **Backend/API** | `GET /uc08/api/dossiers`, `/:id`, `/by-ticket/:externalRef`, `/healthz`. **No POST route exists in the file.** CORS advertises `GET, OPTIONS` only. Reads are gated by signed ZAF identity wherever a durable store is attached or the deployment is public |
| **Database** | `uc08_dossiers` (insert only) · `audit_log` (one row, `action: "escalate"`, `riskTier: "high"`) · `audit_trace` · `workflow_claims`. **`uc08_treaty_citation_vectors`: zero rows since it was provisioned on 2026-08-09** |
| **Remote Sandbox** | **Untouched. Not read, not written, not contacted.** UC-08 is the only use case of the nine with no Remote call on any path. **[DECIDED 2026-08-21 · NOT YET BUILT]** *Not written* and *not contacted* were being kept by the same absence, and only the first is the guarantee. Two **reads** arrive behind a read-only façade — `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests`, both by `employment_id` — and the evidence a reader should observe becomes three-valued: records found, `200` with `total_count: 0`, or the read did not answer. Never silence (§0.1, `T-1`/`T-2`) |

## 14. UX_ACCEPTANCE

- **Hierarchy.** The framing sentence first, then what was asked, then who is in
  play and how each got there, then the count with its subject in the same
  breath, then the instruments, then what could not be established — ranked, with
  the top row being what the specialist has to go and find first.
- **Statements of absence are mandatory and are exempt from any relevance trim.**
  On a 🔴 dossier a specialist acting on false completeness is the failure this
  use case exists to prevent. *"This system holds no residence test for any
  jurisdiction in play"*, *"nothing is `full`"*, *"citizenship is not assessed and
  cannot be"*, *"the tie-breaker article has not been read"* and *"the
  permanent-establishment material was never retrieved"* all stay at full
  strength.
- **A limit is stated at full strength and then given an address the reader can
  reach.** The publisher's URL, the instrument and its locator, or the block of
  this same dossier that carries the material — never a repository path, a
  function name or a catalogue number. The limit is never softened to fix the
  address.
- **The number never travels alone.** The jurisdiction statement is appended to
  every presence statement, including the not-counted ones, because a reader told
  a count is missing still needs to know no rule existed to measure it against.
- **No internal language.** `dual_residency` becomes *"a dual tax-residency
  question"*; `no_residence_test_held` never reaches a screen; `NL` becomes *"the
  Netherlands"* in prose and keeps its code only in the reference row.
- **Action clarity.** Exactly one message: *nobody approves anything here, and no
  role would change that.* A specialist must not go looking for a button, and
  must not read the dossier's confidence as a clearance.
- **No modal.** A result earns a dialog when it offers a next action; a hand-off
  says so in place. A modal carrying nothing actionable teaches people to dismiss
  without reading, and the next thing dismissed without reading is a disclaimer.
- **Consistency.** ⚠️ Two readings of the same dossier disagree today: the API
  view states the count with its country, window and record basis, and the sidebar
  states a bare number. The same figure must not read differently depending on
  which door the reader came through.

**[ADDED 2026-08-21 · DECIDED, NOT YET BUILT — three readers, three screens.
`docs/UI-AUDIENCES.md`'s rule: a fact earns its place by answering *this*
reader's question, and being true is not the qualification.]**

- **The employee, after the specialist finishes.** Their question is *"is
  somebody dealing with this, and what came of it?"* — not *"which limb of
  article 15 is unresolved"*. They see: the question they asked, that it went to
  a tax specialist, what the specialist concluded in one of four plain
  outcomes, and the disclaimer. They see **no citation, no limb, no day count
  presented as a finding, and no treaty**. What they must never see is a page
  that has said *"with a specialist"* for six weeks with no way to end
  (`T-14`/`T-15`).
- **The specialist.** Everything `describeDossier()` computes — all seven keys,
  not the one the sidebar reads today (DRIFT-037) — **plus** the count's
  provenance, the instrument's own window beside the window used, and the
  dossier's age. Their question is *"what do I not have to re-derive, and what
  must I go and find?"*, and a fact they cannot tell the source of is a fact
  they must re-derive.
- **The admin who asked on somebody's behalf.** Sees what the employee sees
  about the case they raised, and no more. The dossier carries the requester's
  own free text, and the identity that filed it is a **claim** today
  (DRIFT-069) — which is exactly why `listByOwner()` reads must be scoped to a
  verified subject before this surface widens (`T-24`).
- **Provenance is reader-facing, not an implementation note.** *"Read from
  Remote's approved travel records"* and *"as supplied with the request"* are
  the difference between a measurement and a recollection, and the specialist is
  the reader who acts on the difference. It goes on the page, in the same
  sentence as the number — not in a tooltip and not only in the API response
  (invariant 22).

## 15. Successful business outcome

> **A Remote Tax Operations specialist opens one screen and has the afternoon of
> fact-gathering already done** — how many days, in which country, over which
> window, from which records, and which of them did not count and why; both
> countries' residence tests in the words of the authorities that administer
> them; the convention actually in force between them, broken into the conditions
> it really has; and a ranked list of everything that could not be established.
> They author the guidance themselves, on facts they did not have to assemble and
> did not have to take on trust.
>
> And: no tax advice was ever given to a customer by a machine; no day count was
> ever produced from records the system could not read; no figure was ever printed
> without saying what it was a figure about; no passage was ever cited as the
> governing instrument when it was the model that instrument was drafted from; and
> at no point in the compiling, storing, serving or displaying of any of it did a
> path exist by which this system could act.

## 16. Required evidence for E2E verification

1. **A positive test leads.** A complete inquiry — country, window, overlapping
   and non-matching records — MUST produce a real, correct, checkable number.
   Refusing correctly and being unable to succeed look identical from outside, and
   this repository has shipped at least six gates that could never fire while
   every test passed.
2. **Both zeros, paired.** An empty record list MUST be `NOT_EVALUATED`; records
   that exist and place the person elsewhere MUST be a **counted** zero. Testing
   only the first turns the guard into a blanket refusal and destroys a real
   finding.
3. **The durable guard, matrix-shaped.** Four inputs that each produce a real day
   count — including a country neither dictionary knows and a request naming
   nothing — and each rendered presence statement MUST either name its
   jurisdictions or state explicitly that none could be identified, **carried with
   the number and not beside it**. Asserted today against `describeDossier()`;
   it must additionally be asserted against whatever the specialist actually
   reads (see item 7).
4. **The five no-execution-path assertions, separately.** Which are pinned by a
   test and which are merely true today is stated in §17's preamble; item 8 below
   is the one that is not pinned anywhere.
5. **Citation honesty, in both directions.** An employee id containing `a1` and a
   ticket number containing `183` MUST cite nothing, and a genuine 183-day mention
   MUST still match. `matchedOn` MUST never contain a raw similarity number on
   either retrieval leg — checked on the rendered panel, not only in the source.
6. **Every vendored citation resolves**, still opens with its catalogue id, and
   every quotation matches the sidecar it is attributed to. A renamed document
   must break a test, never become authority-shaped text linking nowhere.
7. **The specialist's actual screen, read end to end**, against the API response
   for the same dossier — every field the server computed either rendered or
   deliberately and visibly not. This is the check that would have caught
   DRIFT-037, and no test in this pass performs it.
8. **The deployed n8n graph, read back from n8n.** That it carries no Switch and
   no IF node, and that every path terminates at the one internal-note update, is
   **asserted by no test in this repository and cannot be** — `workflows/uc-08.json`
   named in §13 build task 1 does not exist; the graph lives only in the n8n
   account. `npm run verify-deployed` diffs Code-node **bodies**, not topology.
9. **A duplicate delivery under one external ref**: one claim row, one dossier
   row, one audit row, and the redelivery writing nothing.
10. **Database, Live Feed, ticket and sidebar all agreeing on one state** for one
    inquiry, including the negative: that the Remote Sandbox shows no call of any
    kind. **[SUPERSEDED IN PART 2026-08-21]** Once `T-2` lands, the Sandbox
    negative becomes *no **write** of any kind* — two **reads** are expected, and
    the audit trace must show them.

**[ADDED 2026-08-21 — the seven the decisions above create. Item 11 leads for the
same reason item 1 does.]**

11. **A positive Remote-read test leads.** An employment for which Remote holds
    approved travel records MUST produce a count that visibly includes them and
    names them as Remote-sourced. Without it the read ships having never
    returned a row, and — because the live collections are empty (§0.4 trap 1) —
    *nothing would fail*. This is the item that makes `T-4`'s fixture
    load-bearing.
12. **The three read outcomes, separately**: records found · `200` with
    `total_count: 0` · the read did not answer. All three MUST be visible on the
    dossier and MUST be distinguishable from one another. Testing only the first
    leaves an empty collection and an outage reading identically.
13. **Provenance survives to the screen.** A dossier built from both sources MUST
    render, on the specialist's own panel, which rows came from Remote and which
    were supplied. Asserting it on `describeDossier()` alone is what let
    DRIFT-037 stand.
14. **A replayed run is marked.** With the live read disabled, the dossier and
    the audit trace MUST both carry `sandbox_replay` and the capture's date, and
    a live read MUST override a captured value where both exist.
15. **The structural no-write assertion still passes with the façade in scope** —
    the source stripped of comments MUST name no write method. This is the test
    that decides whether `T-1` was built as a façade or as a client used
    carefully, and it is the only thing that can tell those apart.
16. **An outcome verb lands on a ticket and changes the requester's status**, and
    `uc08_dossiers` is byte-identical before and after. That pairing is the whole
    claim of `T-14`: somebody was told, and the record was not mutated.
17. **No UC-08 output is read by any other use case's gate.** Grep-level and
    behavioural, in the shape §17's existing structural assertions take. Track F
    must be provably absent rather than merely unbuilt (invariant 24).

## 17. Known SPEC_DRIFT

> **Numbering note.** My allocated range is DRIFT-036 … DRIFT-039. Three findings
> exceed it and take **DRIFT-067, DRIFT-068, DRIFT-069**, per §3 of the shared
> brief ("the next free number above 060"). They were first written as 061–063
> and **reassigned, recorded here rather than applied silently**: the overflow
> block was already taken — 061–062 by UC-06, 064–066 by UC-05, with 063
> deliberately left unused (`qa/SPEC-DRIFT-INDEX.md`), and `UC-07-acceptance.md`
> §17 additionally claims 061–064. 067–069 are the first numbers free of all of
> it. `qa/SPEC-DRIFT-INDEX.md` does not yet carry them and needs the row.
>
> Cross-cutting findings referenced in §12/§13/§17 and **not** renumbered:
> **DRIFT-011** (UC-03 → UC-08 route does not exist), **DRIFT-021** (UC-04 has no
> outbound route), **DRIFT-041** (no approval anywhere expires), **DRIFT-042**
> (the ZAF panel prints a bare UUID) and **DRIFT-046** (both pgvector tables have
> held zero rows since provisioning — DRIFT-036 below is the UC-08-specific and
> strictly stronger form of it: the table's emptiness is not the only thing
> forcing the keyword leg).

> **Verified stale in `docs/use-cases/UC-08.md`, correcting the record rather
> than opening findings.** (a) §16's *"Known divergence — the n8n port still
> answers a confident zero"* is closed: `workflows/nodes-uc08/buildDossier.js`
> carries the empty-records guard, and `test/n8nUc08Parity.test.js` pairs a target
> country with `presencePeriods: []` in both directions. (b) §19.6's *"`loadUc08()`
> does not pass `data.basis` through"* is closed: `zaf-app/assets/main.js` now
> carries `basis: data.basis || null` — but only that one field, which is
> DRIFT-037. (c) §15's n8n row and `test/n8nUc08Parity.test.js`'s header both say
> the graph is *"built but NOT activated"*; it has been active since 2026-08-10.

---

### SPEC_DRIFT · DRIFT-036 · Embedding-similarity treaty retrieval is unreachable from every production entry point, not merely unseeded

**Original/documented behaviour:** `UC-08.md` §3's data-source table marks treaty
retrieval **`[BUILT — issue #29, closing #23]`** as *"embedding-similarity search
over the SAME hand-curated corpus … keyword matching remains the fallback when
unconfigured."* `CLAUDE.md`'s §4 row, `README.md` and `docs/BUILD-LOG.md` §1 all
describe the retriever as embedding similarity.

**Current implementation:** the class is real and correct. Nothing constructs it
with dependencies. `configureTreatyRetriever()` is exported and called from **no
file under `src/` or `scripts/`**; the module-level default is
`new TreatyRetriever()` with `embed = null` and `pgPool = null`, and
`retrieveCitations()` delegates to it; `handleTaxInquiry()`'s `treatyRetriever`
parameter defaults to `null` and every production caller — `src/uc08/cli.js`,
`src/portal/server.js`'s adapter, the n8n Code node — leaves it that way. Separately,
`uc08_treaty_citation_vectors` has held **zero rows since it was provisioned on
2026-08-09**. Either fact alone forces the keyword leg; both are true.

**Current tests assume:** the embedding path works — and it does, in five tests
that construct `new TreatyRetriever({embed, corpus})` or `{pgPool, embed}` by
hand. **No test asserts that any production entry point ever reaches it**, which
is why a permanently-unreachable branch has five passing tests over it.

**Difference:** the status rows are true of the class and false of the running
system. The code is honest about it in one place a specialist can reach —
`describeRetrievalMode()` reads the mode back off the citations' own stated basis,
and `citationCoverage.scope` says *"Retrieved by KEYWORD match, not by meaning —
the embedding path is unconfigured"* — but that sentence is one of the four fields
`loadUc08()` drops (DRIFT-037), so the reader who most needs it does not get it.

**Evidence:** `src/uc08/treatyRetriever.js:246` (`let defaultRetriever = new
TreatyRetriever();`), `:266` (`configureTreatyRetriever`, no caller);
`src/uc08/workflow.js:83` (`treatyRetriever = null`); `docs/RETRIEVAL.md` §1.1
(zero rows, `[CONFIRMED — SQL against the live project, 2026-08-20]`) and §2
(corpus measured at **106 passages** after chunking); `test/uc08.test.js:289–376`;
`CLAUDE.md` §4 UC-08 row.

**Likely reason:** issue #29 built the mechanism and left provisioning as a human
step, documented in `docs/SETUP-CHECKLIST.md` — the same optional-dependency
pattern as `audit.js`'s pgPool. The wiring step was never taken, and because the
fallback is silent by design nothing failed.

**Risk if left as-is:** the smaller risk is a status overclaim. The larger one is
what the fallback can return: **three passages this project wrote itself**, of
general OECD-Model and totalization principle, holding no bilateral instrument
for any pair. `docs/RETRIEVAL.md` drove it live and a plainly-worded Portugal
residency question returned **zero citations**. A specialist handed "OECD Model
Article 4 — Resident (tie-breaker rules)" on a DE/ES question is being handed the
template the governing text was drafted from.

**Recommendation:** HUMAN_DECISION_REQUIRED, and `docs/RETRIEVAL.md` has already
done the work of framing it. It **recommends against seeding** — at 106 passages
the properties that matter are exact-term and citation-locator recall, not
semantic similarity — and proposes a lexical index over the 106 real statutory
passages instead, country-filtered first. Three sub-decisions: (a) do not run
`npm run seed-vectors` without explicit approval; (b) correct the status rows in
`CLAUDE.md`, `README.md` and `BUILD-LOG.md` to *"keyword, with an embedding path
built and not wired"*; (c) decide lexical-index-versus-vectors as one decision
with UC-07, since every document feeding UC-07 also feeds UC-08.
**Confidence:** HIGH on the finding; HIGH on the measurement; MEDIUM on the
remedy, which is a product call.

### DISPOSITION — 2026-08-21

**DECIDED · NOT YET BUILT.** The owner asked for my recommendation. It is
`docs/RETRIEVAL.md`'s, adopted in three parts:

1. **Do not seed the vector tables.** `npm run seed-vectors` must not be run
   without explicit approval. The argument is measured, not aesthetic: after
   chunking, the corpus is **106 passages**, and on a six-query gold set BM25
   beat embeddings (**3/6** against **2/6** recall@5). At that size the
   properties that decide usefulness are exact-term and citation-locator recall,
   which lexical does better, and the corpus is small enough that a specialist
   can hold its shape in mind.
2. **Correct the status rows** in `CLAUDE.md` §4, `README.md` and
   `docs/BUILD-LOG.md` §1 to *"keyword, with an embedding path built and not
   wired."* They are true of the class and false of the running system —
   the same built-versus-deployed gap as the n8n one, wearing different clothes.
   *(`T-27`)*
3. **Replace the three hand-written passages with a country-filtered lexical
   index over the 106 real statutory passages**, as **one decision with UC-07**,
   since every document feeding one feeds the other. *(`T-26`; timing is `I3`)*

**What decided it.** Not the status overclaim — the fallback's *output*. Today's
keyword leg can hand a specialist *"OECD Model Article 4 — Resident (tie-breaker
rules)"* on a DE/ES question: **the template the governing convention was drafted
from, offered where the convention belongs.** `docs/RETRIEVAL.md` drove a plainly
worded Portugal residency question live and got **zero citations**. A retrieval
mechanism that returns nothing is recoverable; one that returns a model in place
of an instrument is not, because it reads exactly like an answer.

**DRIFT-046 is decided-by-recommendation, not closed** — the tables stay empty on
purpose, and that is now a decision rather than an omission. §0.9.

---

### SPEC_DRIFT · DRIFT-037 · The specialist-facing dossier view is computed on every read and dropped by the only client that renders it

**Original/documented behaviour:** `src/uc08/dossierView.js`'s own header states
the contract — *"UC-08 has no execution path, so this dossier IS the product — if
it omits what the decision turns on, it has failed at the only thing it does."*
§17 of the spec was written to close exactly this: a day count that *"cannot be
checked, an evidence-based zero cannot be told from an empty one, and a stay
clipped at the window edge is invisible."*

**Current implementation:** `describeDossier()` returns six keys —
`presence`, `jurisdictionKnowledge`, `citationCoverage`, `sources`, `uncited`,
`basis`, `openQuestions` — and `src/uc08/server.js` spreads all of them into
every `GET` response. `zaf-app/assets/main.js`'s `loadUc08()` reads exactly one
of them, `basis`. `presence`, `jurisdictionKnowledge`, `citationCoverage`,
`sources`, `uncited` and `openQuestions` are parsed and discarded. Grepped
repository-wide: **no file anywhere reads `openQuestions` or `citationCoverage`
outside `dossierView.js` and the test suite.**

What the specialist's panel renders instead, from the raw row:
`{ label: "Presence days", value: presence ? presence.days + " day(s) across " +
presence.periodsCounted + " period(s)" : "Not computed" }` — no country, no
window, no record basis, and **no status guard**, so a `NOT_EVALUATED` count
(`days: null`) renders as **`"null day(s) across 0 period(s)"`**. The panel's own
sparse-case test asserts `!/undefined|null/.test(row.value)`; it never constructs
a `NOT_EVALUATED` presence object, so the assertion never sees it.

Lost with the rest: the ranked open questions, including the two priority-1 ones
— *"no residence test is held for any jurisdiction this count concerns"* and
*"the convention's day-count limb is one of three cumulative conditions, and the
two an EOR arrangement usually fails are the two this system cannot see"* — and
two of the three absences §19.3 says appear on **every** dossier unconditionally.
Only the citizenship one survives, because it is also a sentence in the narrative.

**Current tests assume:** the API view. `test/uc08.test.js`'s durable guard, the
subject-and-window tests and the citation-scope test all call `describeDossier()`
directly. Nothing tests the sidebar against it.

**Difference:** invariant 8 — *"a day count is never printed in the shape of an
answer without its jurisdiction"* — holds on the API and on the portal, and on the
specialist's own screen holds only through the **narrative row**, which on a live
run with OpenAI configured is LLM prose that the system prompt instructs to
restate the statement and that `judgeNarrative()` scores without gating. The
structural guarantee degrades to an unvalidated instruction on the one surface
that matters most.

**Evidence:** `src/uc08/dossierView.js:56–110`; `src/uc08/server.js:98,105`;
`zaf-app/assets/main.js:3219–3271` (`loadUc08`, `basis: data.basis || null` and
nothing else); `zaf-app/assets/panels.js:534–569` (the rows, and `:551` the
unguarded presence row); `test/zafApp.test.js:531–534` (the sparse case that
almost catches it); `UC-08.md` §17, §19.6.

**Likely reason:** §19.6 records the same defect one field narrower — *"the API
now returns it … `loadUc08()` does not pass `data.basis` through … `zaf-app/**`
was owned by another agent this session"* — and says the fix is one line per
loader. One line was added. The other six fields were never in scope, and nothing
records that they exist.

**Risk if left as-is:** the highest-stakes reader in the system gets the thinnest
reading of the dossier. A bare `92` beside a treaty citation is the exact shape
§17 and §18 were written to abolish, and `null day(s) across 0 period(s)` beside a
183-day article is worse than either — it is a rendering failure that looks like
data.

**Recommendation:** RECONCILE. Pass the view through in `loadUc08()` and render
`presence.statement` in place of the composed row, the open questions as the
findings list the panel already knows how to draw, and `citationCoverage.scope`
beside the "Reference corpus matched" row. Then pin item 7 of §16: one test that
reads the API response for a dossier and asserts the panel renders every field the
server computed or visibly declines to. The `null day(s)` render should be fixed
regardless of when the rest lands.
**Confidence:** HIGH

### DISPOSITION — 2026-08-21

**RECONCILE. DECIDED · NOT YET BUILT.** Accepted in full, and the remedy is the
finding's own.

`loadUc08()` reads **one** of the seven keys `describeDossier()` computes. Pass
the view through; render `presence.statement` in place of the hand-composed row;
draw `openQuestions` as the findings list the panel already knows how to make;
put `citationCoverage.scope` beside *"Reference corpus matched"*. *(`T-8`)*

**Two things this pass adds to the remedy.**

- **Fix the `null day(s) across 0 period(s)` render on its own, first, and do not
  wait for the rest** *(`T-9`)*. It is not a thinner reading of the dossier; it is
  **a rendering failure that looks like data**, sitting next to a citation of the
  183-day article. The panel's own sparse-case test asserts
  `!/undefined|null/.test(row.value)` and never constructs a `NOT_EVALUATED`
  presence object, so the assertion has never seen the case it would catch.
- **The test that closes it is §16 item 7, and it must read the API response**
  *(`T-10`)*. Every field the server computed is either rendered or visibly
  declined. Asserting against `describeDossier()` — which is what every existing
  test does — cannot detect a client that drops what the server sent. That is the
  general lesson and it is why this finding outlived §19.6's one-line version:
  **a test of the producer cannot fail on a defect in the consumer.**

The provenance line, the instrument window and the staleness statement decided in
§0 all render through this same path, so `T-8` is a prerequisite for `T-3`,
`T-5` and `T-18` reaching a reader at all.

---

### SPEC_DRIFT · DRIFT-038 · The mandatory disclaimer is attached to a message no surface sends, and its coverage invariant is a hardcoded literal

**Original/documented behaviour:** §5's workflow places *"auto-attach mandatory
disclaimer to customer (this is not tax advice)"* as **step 2 — before the LLM
parse**, and it is the second thing that happens to a request. §6 lists *"skip the
disclaimer"* among the three things the LLM must never do. §7 makes *"mandatory
disclaimer injection on any customer-facing message"* one of two deterministic
responsibilities. §11 makes **disclaimer coverage a bucket-1 integrity invariant
at 100%**.

**Current implementation:** two different things carry a disclaimer and only one
of them reaches anybody.

- `dossier.framing` — *"RESEARCH SUPPORT ONLY — not a residency, withholding, or
  coverage determination"* — is composed in `buildDossier()` and **does** render,
  on the sidebar under the header and on the portal result. Its position,
  presence, single occurrence and verbatim wording are pinned by
  `test/zafLongformDisclosure.test.js`. This half is sound.
- `dossier.customerFacingAcknowledgement = withDisclaimer("Thank you for your
  inquiry…", "tax")` — the disclaimer §5 and §7 actually name — is referenced by
  **no surface at all**. Grepped repository-wide: it appears in
  `src/uc08/dossierBuilder.js`, in `src/uc07/dossierBuilder.js`, and in three
  tests. The portal does not render it, the ZAF panel does not render it, and the
  n8n graph posts an internal note only, with `workflows/README.md` stating the
  acknowledgement is *"drafted for whichever human picks the ticket up to send,
  not for n8n to send unattended."*

Both are composed **last**, inside `buildDossier()`, after the LLM parse, after
the count, after retrieval, after the narrative and after the judge — not first.

And `audit.details.disclaimerApplied` is the **literal `true`**
(`src/uc08/workflow.js:201`), not derived from the dossier. `src/uc03/workflow.js`
derives the same field (`Boolean(informationalAnswer || letterHtml)`); UC-07 and
UC-08 hardcode it.

**Current tests assume:** `test/uc08.test.js:60` asserts the acknowledgement
*string contains* the disclaimer; `:418` asserts the audit row says `true`. Both
pass against a constant. No test asserts the acknowledgement reaches a reader,
because it does not.

**Difference:** three, of increasing weight. The ordering differs from §5 and does
not matter — nothing between step 2 and step 8 can emit a customer message.
Placement is a documentation fix. The second is that **the disclaimer §7 names is
attached to an object nobody sends**, so the invariant is satisfied vacuously.
The third is that the 100% coverage invariant is measured off a hardcoded literal
in the one row an auditor would check — and `src/metrics/compute.js` computes no
disclaimer-coverage figure at all, so nothing reads even that.

**Evidence:** `src/uc08/dossierBuilder.js:243–256`; `src/uc08/workflow.js:201`;
`src/shared/disclaimer.js`; `workflows/nodes-uc08/buildDossier.js:503–516`;
`workflows/README.md` §"UC-08: the node graph"; `UC-08.md` §5/§6/§7/§11;
`grep -rn customerFacingAcknowledgement src/ zaf-app/`.

**Likely reason:** the framing statement was built and hardened (§15's disclaimer
row, `9914403`) and appears to have absorbed the requirement. The acknowledgement
predates it and nothing ever removed it or wired it up. Cannot be established from
the repository which was intended to satisfy §7.

**Risk if left as-is:** low today, because no customer-facing message exists to
carry a disclaimer — which is itself the safe state. It becomes high the moment
anyone adds one, since the object that would carry it is already built, already
tested, and already reported as applied in the audit log. An auditor reading
`disclaimerApplied: true` on a row where nothing was disclaimed is being told
something false by a field that exists to be trusted.

**Recommendation:** RECONCILE. (a) Derive `disclaimerApplied` from the dossier
rather than asserting it, so the field reports rather than declares. (b) Decide
whether the acknowledgement is a deliverable — either render it on the portal
result and in the ticket note, or delete it and restate §7 as *"the framing
statement on every dossier"*, which is what is actually built and is the stronger
control. (c) Correct §5's step ordering to match, or state why the order does not
bind.
**Confidence:** HIGH

### DISPOSITION — 2026-08-21

**RECONCILE, and BUILD the missing half.** The owner's disposition was
*"RECONCILE and do: I thought it was the specialist that gets tax advice, not the
customer. When an employee makes a request, what do they get as an output after
the specialist has finished reviewing and making a decision? I believe this must
be built into the product."*

**On who gets what — the premise is right, and the answer is two artifacts for
two readers.** The **specialist** receives the dossier: citations, limbs,
coverage, declared absences. That does not change and must not. The **employee**
receives the **outcome** — what was concluded, in their own words, carrying the
disclaimer. Neither reader gets the other's document. §14's new per-reader block
and §0.5 Q3 carry it.

**Three parts, decided:**

1. **Derive `disclaimerApplied` from the dossier** rather than asserting the
   literal `true` at `src/uc08/workflow.js:201`, exactly as
   `src/uc03/workflow.js` already derives it. A field that exists to be trusted
   must **report**, never **declare**. *(`T-11`)*
2. **The acknowledgement becomes a deliverable rather than being deleted.**
   `dossier.customerFacingAcknowledgement` is built, disclaimed and tested, and
   is referenced by **no surface anywhere** — so §11's *"disclaimer coverage
   100%"* is satisfied **vacuously**. It renders on the portal result and in the
   ticket note, and it is what the outcome message is built on. *(`T-12`)*
3. **Build the aftermath**, in UC-07's `R-24` shape and vocabulary:
   `dossier_read`, then `proceeding_offline` / `not_proceeding` /
   `more_information_needed`, **recorded on the ticket, never on the dossier
   record**, with the requester's status moving off *"with a specialist"*.
   *(`T-14`, `T-15`)*

**The dependency, and it is the reason this cannot be built first.** There is no
UC-08 ticket on the portal path to record an outcome on — `TICKETABLE_TYPES`
excludes `uc07` and `uc08`. **DRIFT-109**, `T-13`, ordered ahead of all of the
above and shared with UC-07.

**What is NOT decided:** whether the employee is told by email or only by the
portal's status page. That is UC-07's **`H1`**, and it is answered **once, for
both** — a second entry would be a duplicate question with a second answer.

§5's step-ordering complaint is a documentation fix and is made in
`docs/use-cases/UC-08.md` §5, with the reason it does not bind: nothing between
step 2 and step 8 can emit a customer message.

---

### SPEC_DRIFT · DRIFT-039 · The presence-day count is arithmetic over self-declared records in a caller-chosen window, where the spec specifies Remote's own data

**Original/documented behaviour:** §5's workflow: *"deterministic: compute
historical physical-presence days (**time-off + workation custom fields**)"*.
§3's data-source table lists *"Travel/presence data — Custom fields / time-off"*
as **`[CONFIRMED — capability exists; specific endpoint shape not yet verified]`**.
§13 task 4 is *"Presence-day calculator (custom fields + time-off)"*, and task 8
requires **`/v1/federal_taxes` be verified against the OpenAPI before use**.

**Current implementation:** §15 states it plainly — *"Real Remote reads
(time-off/travel custom fields): **Not built** — `presencePeriods` arrives as
structured input."* Confirmed: `handleTaxInquiry()` takes no `remote` client (that
absence is invariant 1 and must not change), the portal's form collects travel
rows from the requester, and the n8n normaliser passes
`body.presencePeriods` straight through. `/v1/federal_taxes` is called nowhere and
is still `[INFERRED]`; §15's own row says verification is *"a prerequisite for
whichever future pass adds real Remote reads, not something to guess at now."*
The evaluation **window** is likewise supplied by whoever filled the form.

**Current tests assume:** structured input throughout. Every presence test
constructs the period list by hand.

**Difference:** the spec and the build disagree about what the count is evidence
*of*. A count over Remote's own time-off and workation records is corroborated by
the employer's system; a count over rows a requester typed is **self-declared** —
the same class as UC-04's declared `visaType` (DRIFT-017), which prime directive
#3 says is a claim and never an authenticated signal. The dossier is scrupulous
about every other property of the figure — its country, its window, its records,
what did not count and why — and says nothing about its **provenance**.

The window compounds it. **C-10** records six bilateral instruments with **five
distinct formulations** of the 183-day window (taxable year, calendar year, fiscal
year, floating 12-month, and a $10,000 money-based alternative limb in US–Canada).
Nothing asks which window applies, nothing checks the supplied one against the
instrument the same dossier goes on to quote, and the requester choosing
1 January – 31 December has silently chosen a calendar year for a pair whose
convention may key on a taxable or fiscal one.

**What is already right, and must not be undone:** the dossier does **not** assert
a window it cannot source. `jurisdictionKnowledge.js` encodes no threshold and no
window at all, and a test asserts `183`, `365` and `180` appear nowhere in it. The
statement carried with every count says the count *"is NOT measured against any
jurisdiction's residence test, and the 183-day figure the reference corpus cites
is a general model-convention article, not a rule of any country named here."*
That is the correct handling of a window with no authority. The gap is that the
dossier never says the window was **chosen by the requester** rather than derived,
and never puts the applicable instrument's own window beside the one that was used
— even though `decisionSources.js` holds it, quoted, on the same page.

**Evidence:** `src/uc08/presenceCalculator.js` (header, *"assumed already resolved
… upstream"*); `src/uc08/workflow.js:96–101`; `src/portal/server.js:3117–3140`;
`workflows/nodes-uc08/normalizeInquiry.js:60–70`;
`docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` C-10, C-12, C-21;
`src/uc08/decisionSources.js` (`limbA({quote, window})`); `UC-08.md` §3/§5/§13/§15.

**Likely reason:** honest and recorded — the endpoint shape was never confirmed,
and this repository's rule is not to invent an unverified fetch. The window being
caller-chosen appears never to have been considered separately from the records.

**Risk if left as-is:** two. A specialist reads a precise figure as an
employer-corroborated measurement when it is a requester's recollection. And a
count taken over the wrong window is wrong by a legally material amount against a
test the same dossier quotes — the US–Portugal article's *"any 12-month period
commencing or ending in the taxable year"* and a calendar year are different
counts of the same travel, and 182 versus 183 is the whole question.

**Recommendation:** RECONCILE for the cheap half, HUMAN_DECISION_REQUIRED for the
rest. (a) State the provenance of the records on the dossier — *"supplied with the
request; not read from Remote's time-off or workation records"* — in the same
sentence as the count, exactly as the jurisdiction statement is. (b) Print the
applicable instrument's own window beside the window used whenever a pair
resolves; the quotation is already on the page. (c) Verify `/v1/federal_taxes` and
the time-off/custom-field shapes against Remote's OpenAPI **before** anyone builds
the fetch, per §13 task 8 — and note that adding a Remote read to this use case
must not add a Remote **client parameter** to `handleTaxInquiry()`, which is
invariant 1.
**Confidence:** HIGH

### DISPOSITION — 2026-08-21

**RECONCILE — and the finding is right about the gap while being wrong about the
remedy, because the source it defers to does not work.** This disposition is the
one that reorganised the pass; §0.1 and §0.2 carry the evidence.

**(a) The spec's named source cannot produce this figure.** *"Time-off + workation
custom fields"* was checked against both schemas. `Timeoff` has **no country and
no location property of any kind** — `timezone` is an IANA identifier whose own
example is `Etc/UTC` — and a workation is someone *working*, so it generates **no
time-off record at all**. Custom fields are `{custom_field_id, name, type, value}`
with **no dates**. So §13 task 4's *"presence-day calculator (custom fields +
time-off)"* describes something that cannot be built. **Opened as DRIFT-106**, and
`UC-08.md` §5 is corrected with the original wording kept visible.

**(b) A source that does work exists, and it is better than the one specified.**
`GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests` are
filterable by `employment_id` and carry `destination_country`,
`travel_date_start`, `travel_date_end` and `status`: **dated, located,
employer-approved.** That is rung 2 of the ladder for a figure currently taken at
rung 4. Build the read behind a **read-only façade** — `handleTaxInquiry()` keeps
no `remote` parameter, because invariant 1 is the parameter's absence.
*(`T-1`, `T-2`)*

**(c) Provenance, which the finding is exactly right about, and which is now
invariant 22.** The dossier is scrupulous about the count's country, window,
records and exclusions and says **nothing about where the records came from**.
That goes in the same sentence as the number: read from Remote, supplied with the
request, or both, marked per row. *(`T-3`)*

**(d) The window, accepted as stated.** Print the resolved instrument's own window
beside the window used; never silently correct one to the other, because choosing
would be making the residence determination this tier refuses. C-10's five
different formulations are the argument. *(`T-5`)*

**(e) `/v1/federal_taxes` — §13 task 8 discharged, negatively.** There is **no
GET**. `PUT /v1/employments/{id}/federal-taxes` (v1 and v2) and
`PUT /v1/employee/federal-taxes` are W-4 *submission*, US Global Payroll,
post-enrollment. A negative is a real result: no future pass should plan a read
around it. **Opened as DRIFT-108** so the `[INFERRED]` tag does not outlive the
check.

**(f) The obstacle, stated rather than discovered later.** Both collections are
**`200` with `total_count: 0`** on the live Sandbox. So the read ships correct,
honest and returning nothing — a gate that cannot fire. `M-1` re-measures, `T-4`
provides the fixture and the marked capture fallback, and **§16 item 11 is a
positive test that leads**. §0.4 trap 1.

---

### SPEC_DRIFT · DRIFT-067 · The use case's headline success metric cannot be computed, by the same guarantee that is its headline artifact

**Original/documented behaviour:** §11 names **dossier accept rate** as the
bucket-2 metric — *"specialist accepts as-is vs. needed substantial rework"* —
with `≥60%` healthy, `<30%` stop, and marks it *"specified, not yet computed by
`compute.js` — tracking issue #20."* Alongside it: presence-day calculation
accuracy, disclaimer coverage at 100%, zero autonomous guidance, and research time
saved pending a baseline.

**Current implementation:** `src/metrics/compute.js` computes none of the five,
and its own comment explains why the accept-rate shape cannot apply: UC-07 and
UC-08 *"compile a dossier and escalate, always"*, so there is no decided review to
compare a recommendation against. Deeper than "not yet built": **there is no
surface anywhere on which a specialist could record acceptance.** No POST route
(invariant 4), no mutation method on the store (invariant 3), `verbs: []` and
`control: "none_by_design"` on the approval row. Recording an accept would require
a status to flip on a record whose defining property is that it has none.

**Current tests assume:** nothing. No test computes or asserts any UC-08 metric.

**Difference:** §11 specifies a metric whose measurement instrument would breach
§15's structural guarantee. Issue #20 frames it as unbuilt work; it is a design
contradiction, and framing it as a backlog item hides that.

**Difference in what it costs:** the job this repository is a portfolio for names
*"define success metrics, track them, and use them to decide what to iterate on
and what to stop"* as the first and scarcest criterion. UC-08 is the use case with
the strongest safety argument and, today, **no measurement of whether it is any
good**. Nothing distinguishes a dossier a specialist used from one they closed and
re-researched from scratch.

**Evidence:** `UC-08.md` §11; `src/metrics/compute.js:335`;
`src/approvalqueue/approvalRoutes.js:194–205`; `src/uc08/server.js` (no POST);
`src/uc08/dossierStore.js` (one write method); `docs/METRICS.md`.

**Likely reason:** §11 reuses `DEFAULT_THRESHOLDS`' accept/reject shape from the
🟡 tier, where a recommendation is paired with a human verdict on the same record.
That pairing does not exist on 🔴 and cannot be created without a write.

**Risk if left as-is:** a 🔴 use case cannot be iterated or stopped on evidence.
Every improvement to the dossier is argued from reasoning rather than from whether
it changed a specialist's work — which is precisely the failure mode the metrics
layer exists to prevent, in the use case where the dossier is the entire product.

**Recommendation:** HUMAN_DECISION_REQUIRED. Three options, and the guarantee
constrains all of them: (a) measure **outside** the record — a Zendesk-side signal
(reopen rate, time from escalation to first specialist comment, whether the
authored guidance cites the instruments the dossier supplied) which touches
`uc08_dossiers` not at all; (b) measure the dossier's own **completeness** rather
than its reception — the distribution of `openQuestions` codes and priorities is
already computed on every read and is a real, tier-legal iteration signal; (c)
accept that this use case is unmeasured and say so in §11 in place of a threshold
that cannot be met. What must not happen is adding a status column to make the
metric computable.
**Confidence:** HIGH

### DISPOSITION — 2026-08-21

**DECIDED · NOT YET BUILT.** The owner asked *"what is best for Remote.com as a
company to ensure they get maximum result, and what do their docs say?"*

**What Remote's docs say: nothing.** This is not a question their API or
documentation speaks to — it is a product measurement question about our own
system, and answering it from Remote's docs would be inventing a citation. Said
plainly rather than left as an implied silence.

**What is best for Remote, argued.** The contradiction is real and must not be
resolved by breaking the guarantee: recording an accept needs a status to flip on
a record whose defining property is that it has none. **Adding a status column to
make a metric computable would trade the strongest safety argument in the system
for a number.** So:

1. **Measure outside the record — the primary.** Once `T-13`'s ticket exists,
   the outcome verbs **are** the accept-rate signal: `proceeding_offline` and
   `not_proceeding` are a specialist who used the dossier;
   `more_information_needed` is one who could not. Add Zendesk-side reopen rate
   and time-from-escalation-to-first-specialist-comment. **`uc08_dossiers` is
   touched not at all.** *(`T-16`)*
2. **Measure completeness as well as reception — free today.** The distribution
   of `openQuestions` codes and priorities is already computed on **every** read.
   It is a real, tier-legal iteration signal and it needs no new write anywhere:
   the top code is the next thing to go and source. *(`T-17`)*
3. **Restate §11's threshold** rather than leaving `≥60% / <30%` against a
   quantity that cannot be produced. A threshold nobody can compute teaches its
   reader that the metrics section is decorative.

**Why this one is weighted above its finding number.** The role this repository
is a portfolio for names *"define success metrics, track them, and use them to
decide what to iterate on and what to stop"* as its first and scarcest criterion.
UC-08 is the use case with the strongest safety argument and **no measurement of
whether it is any good** — every improvement to the dossier is currently argued
from reasoning rather than from whether it changed a specialist's work. Issue #20
frames this as unbuilt work; it is a design contradiction, and framing it as
backlog hides that.

---

### SPEC_DRIFT · DRIFT-068 · Five of the six evaluation tracks, the work-authorization gate and MONITORING do not exist, and the spec's own header calls that architecture the backbone

**Original/documented behaviour:** the first sentence of `UC-08.md` states the
canonical model is *"**v1's** six-tax-track + work-authorization-gating +
MONITORING/staleness-handling architecture (strongest engineering, wrongly labeled
'superseded')"* as **the backbone**. v1 specifies six tracks — A tax residency,
B employment income tax, C payroll, D social security, E permanent establishment,
F work-authorization dependency — plus a case state machine, a clearance model
that *"should not be a single status"*, risk scoring where *"risk score must not
override hard blockers"*, an evidence model with hashing, and MONITORING that
re-assesses on any material change to day counts, certificate expiry, assignment
extension, role change, salary change, host entity change, destination change or
work location.

**Current implementation:** one classifier that labels an inquiry
`dual_residency | withholding | totalization | other`, one presence-day
calculator, one citation lookup, one narrative. Mapping v1's six tracks:

- **A — tax residency:** partially. A day count and a statement that no residence
  test is held for any jurisdiction. No test is applied, deliberately (C-12).
- **B — employment income tax:** ❌ as a track. The bilateral article is now
  *quoted* per pair with its limbs and their coverage (§19), which is the
  strongest thing in the build — but nothing evaluates it.
- **C — payroll withholding:** ❌. A classifier label only.
- **D — social security:** ⚠️. The pair's instrument, date, certificate and
  detachment maximum are quoted; no coverage determination is made.
- **E — permanent establishment:** ❌ **and correctly so, for a stated licence
  reason.** OECD Model art. 5, its Commentary and BEPS Action 7 are paraphrase-only
  and were never retrieved, and this is declared as an unconditional absence on
  every dossier. It matters twice over because limb (c) of every treaty article
  quoted turns on it.
- **F — work authorization:** ❌ entirely. No input, no field, no gate. The v1
  gate that would have made UC-08 a precondition for UC-07 execution does not
  exist, and neither does any route between them (§12).

**MONITORING:** ❌ entirely. No scenario hash, no re-check, no staleness signal,
no expiry on the escalation.

**Current tests assume:** the built shape. Nothing tests for a track that does not
exist, which is correct and is also why nothing records their absence.

**Difference:** §3 and §13 task 9 mark the tracks and MONITORING `[PROPOSED]` and
roadmapped, so this is disclosed — but disclosed **in a table three sections below
a header that calls the same architecture the backbone**. A reader who reads the
opening blockquote and the §15 status table forms two different pictures of what
this use case is.

The consequential half is not the tracks. It is **MONITORING**, and it is a live
gap rather than a roadmap item: a dossier can sit unread while its day count
advances past a threshold, an A1 certificate expires, or an assignment extends —
and nothing anywhere re-checks, reminds, or expires it (see §11, and DRIFT-041 for
the system-wide version).

**Evidence:** `UC-08.md` blockquote, §3, §13 task 9, §15;
`docs/research/UC-08 ChatGpt v1 BUILD PACK v1.md` §5 (six tracks), §10 (Track F
gate), §13 (MONITORING), §14 (clearance model), §15 (risk scoring);
`docs/01-COHERENCY-MAP.md:12` (the recency pick, V2, being overturned);
`src/uc08/inquiryParser.js:21` (`VALID_TYPES`).

**Likely reason:** established and honest. The spec's own header explains the
re-weighting away from V2 and towards v1 on strength rather than recency (tracking
issue #9); the build then followed V2's shape, which is the thin one, and §15
records that. Why the header was not narrowed at the same time cannot be
established from the repository.

**Risk if left as-is:** a reader takes the opening sentence as a description of
the system. Concretely: **a stale dossier is indistinguishable from a fresh one**,
and on a use case whose whole subject is elapsed days that is the wrong thing to
be unable to tell.

**Recommendation:** RECONCILE the header — restate it as *"V2's shape, built;
v1's six-track and MONITORING architecture, roadmapped"* — and treat MONITORING
as a separate HUMAN_DECISION_REQUIRED. The cheapest tier-legal form is a **read-time
staleness statement** in `dossierView.js`: the dossier already knows its own
`createdAt` and its evaluated window, so it can say *"this count was taken N days
ago and its window has since closed"* with no new dependency, no parameter and no
route — the same reasoning that put the statutory sources there. Track F and the
UC-07 gating decision belong with DRIFT-011 and DRIFT-021 as one routing decision
rather than four.
**Confidence:** HIGH on the finding; MEDIUM on the remedy.

### DISPOSITION — 2026-08-21

**RECONCILE the header now; BUILD in a stated order.** The owner's disposition was
*"I feel like you should build out what the original docs said, of course it must
align with Remote's own docs and goals and the JD. What do you think?"* — agreed,
with one carve-out that is a licence constraint rather than a scoping preference,
and one that is a tier constraint.

**First, and not waiting for any build: the header.** `UC-08.md`'s opening
sentence calls v1's six-track + MONITORING architecture **"the backbone"**, while
§15 records that most of it does not exist. A reader who reads the blockquote and
the status table forms two different pictures of the same use case. Restated as
**"V2's shape, built; v1's six-track and MONITORING architecture, roadmapped."**
One line, no dependency. *(`T-22`)*

**Then, in order:**

1. **MONITORING first, and narrowly.** It is a live gap rather than a roadmap
   item: a dossier can sit while the day count crosses a threshold, an A1
   certificate expires, or an assignment extends, and **nothing re-checks,
   reminds or expires it.** On a use case whose entire subject is elapsed days,
   *a stale dossier being indistinguishable from a fresh one* is the wrong thing
   to be unable to tell. The cheapest tier-legal form costs no new dependency,
   no parameter and no route: a **read-time staleness statement** in
   `dossierView.js`, since `createdAt` and the window are already on the record.
   This does **not** close DRIFT-041 and is not claimed to. *(`T-18`)*
2. **Tracks A, C and D, then B.** A has a real count and honest absences; C is a
   classifier label only; D already quotes the pair's instrument, its in-force
   date, its certificate and its detachment maximum and stops short of a coverage
   determination; B has the bilateral article quoted limb by limb with nothing
   evaluating it. B is closest to done and is sequenced last only because A/C/D
   change the dossier's shape. *(`T-19`)*
3. **Track E — permanent establishment — is NOT built, and the reason is stated
   on every dossier.** OECD Model art. 5, its Commentary and BEPS Action 7 are
   **paraphrase-only** under this project's standing licence constraint and were
   never retrieved. It matters twice, because **limb (c) of every treaty article
   this system quotes turns on it**. Declaring it an unconditional absence is the
   correct handling and is already what the build does; this pass **pins** it
   rather than changing it. *(`T-20`)*
4. **Track F is NOT built, and is now invariant 24.** §0.4 trap 3.

**What "align with Remote's goals and the JD" resolves to here.** The JD's second
criterion is being *"as comfortable making the case against automating something
as building it"* — so tracks E and F not being built, **with the reason legible on
the artifact**, is not a shortfall against that criterion. It is the criterion.

---

### SPEC_DRIFT · DRIFT-069 · UC-08 verifies no identity, and the n8n normaliser derives one and discards it

**Original/documented behaviour:** §5's workflow step 1 is **`identity verify`**,
before the disclaimer and before the parse. `00-FOUNDATION.md` §4 and prime
directive #3: *"Identity comes from an authenticated signal, never a claim. Fails
closed: any missing piece means unverified."* §14 lists `identity-service` among
UC-08's foundation dependencies.

**Current implementation:** there is no identity gate anywhere in UC-08.
`handleTaxInquiry()` takes no `session` parameter; `employmentId` is read straight
off the ticket object and used as the audit `actor`, falling back to the string
`"unauthenticated"`. `workflows/nodes-uc08/normalizeInquiry.js` goes to real
trouble to derive `session.authenticatedEmail` from the Zendesk-authenticated
requester — with a comment saying *"NEVER an address typed into the ticket body"* —
and `buildDossier.js` never reads the field. On the portal, the UC-08 adapter is
the only one of the seven with **no persona resolution and no `unauthenticated()`
refusal**: `employmentId: body.employmentId || subjectEmploymentId(body.persona)`,
with the body winning.

**Current tests assume:** no identity. `test/uc08.test.js:395` passes tickets with
no session at all and asserts they complete — which is the correct test for the
behaviour that exists.

**Difference:** §5 names a step that was never built, and the n8n graph computes
the authenticated signal §5 asks for and throws it away. UC-08 has no legitimate
identity *gate* — it discloses nothing about any employment record, reads Remote
not at all, and refusing an unidentified tax question would be refusing the
question — but two things do turn on the id:

1. **Attribution.** The `audit_log` actor is a claim. On the tier whose entire
   deliverable is the durable record, the record names a person nobody proved.
2. **Ownership.** `DossierStore.listByOwner()` scopes on `employment_id`, and
   `src/portal/requestStatus.js` serves "My requests" from it. An id supplied at
   write time and verified nowhere means a dossier — carrying the requester's own
   free text — can be filed under another employee's id and will then be listed as
   that person's request. `matchesOwner()` is carefully fail-closed on the read
   side; the write side is open.

`src/uc07/`'s adapter carries the same shape and an explicit comment defending it
(*"anyone may ask a relocation question, with or without a persona … an admin
asking on somebody's behalf types the subject in"*), so the choice was made
deliberately for the dossier pair. What is not recorded anywhere is its
consequence for attribution and for ownership.

**Evidence:** `src/uc08/workflow.js:74–104,190–207`;
`workflows/nodes-uc08/normalizeInquiry.js:49–70`; `src/portal/server.js:3117–3125`
and `:2219–2226`; `src/uc08/dossierStore.js:162–180`; `src/shared/ownerScope.js`;
`UC-08.md` §5/§14; `docs/00-FOUNDATION.md` §4.

**Likely reason:** the absence of any Remote read made an identity gate look like
it had nothing to protect, which is true of disclosure and false of attribution
and ownership. Cannot be established from the repository whether the discarded
`session` in the n8n normaliser was intended for a gate that was then dropped, or
was copied from UC-01's normaliser and left.

**Risk if left as-is:** a 🔴 audit trail attributes decisions to unverified
subjects, and the portal's "My requests" can be made to show one person another
person's tax question. Both are low-likelihood today — the portal is behind a
shared key and the ids are demo personas — and both are exactly the kind of thing
that stops being low-likelihood at the moment the portal opens.

**Recommendation:** RECONCILE, in the smallest form that keeps the question
answerable by anyone. (a) Where an authenticated signal **is** available — the
Zendesk requester email the normaliser already derives, or a resolved portal
persona — record it beside the claimed employment id and mark the id `verified` or
`claimed` in the audit row and on the dossier. (b) Where none is available, keep
answering the question and record `"unauthenticated"` — do not add a gate, because
refusing a tax question for want of identity is the wrong failure. (c) Scope
`listByOwner()` reads to a verified subject only, so an unverified id can be filed
under but never listed under. (d) Correct §5's step 1 and §14's
`identity-service` dependency to describe what exists.
**Confidence:** HIGH on the finding; MEDIUM on the remedy, since (c) is a product
call about whose requests appear where.

### DISPOSITION — 2026-08-21

**RECONCILE. DECIDED · NOT YET BUILT.** The owner's disposition was *"please
verify identity too, and let's do what is best for the product, customer, employee
and Remote."* Agreed, with one boundary that serves exactly those four.

**No identity GATE.** UC-08 discloses nothing about any employment record and —
until `T-2` — reads Remote not at all. **Refusing a tax question for want of
identity is the wrong failure**: the person most likely to be unable to prove who
they are is the person whose situation is most irregular, which is the person most
likely to need the question answered. A request with no id still produces a
dossier and still escalates.

**But identity is verified where a signal exists, and the id is marked either
way** — because two things do turn on it and neither is disclosure:

1. **Attribution.** The `audit_log` actor is `employmentId ?? "unauthenticated"`,
   a caller-supplied claim. On the tier whose entire deliverable is the durable
   record, **the record names a person nobody proved.**
2. **Ownership.** `listByOwner()` scopes on `employment_id` and the portal's
   "My requests" is served from it. `matchesOwner()` is carefully fail-closed on
   the **read** side; the **write** side is open. A dossier carrying the
   requester's own free text can be filed under another employee's id and will
   then list as that person's request.

**Four parts:**

- **(a)** Where an authenticated signal exists — the Zendesk requester email
  `workflows/nodes-uc08/normalizeInquiry.js` already derives, or a resolved portal
  persona — record it beside the claimed id and mark the id **`verified`** or
  **`claimed`**, in the audit row and on the dossier. *(`T-23`)*
- **(b)** Where none exists, still answer, still record `"unauthenticated"`. No
  gate. *(part of `T-23`)*
- **(c)** Scope `listByOwner()` **reads** to a verified subject, so an unverified
  id can be filed under but never listed under. *(`T-24`)*
- **(d)** Correct §5 step 1 and §14's `identity-service` dependency in
  `UC-08.md` to describe what exists. *(`T-25`)*

**The n8n normaliser is the sharpest detail and is fixed by (a).** It goes to real
trouble to derive `session.authenticatedEmail` from the Zendesk-authenticated
requester — with a comment saying *"NEVER an address typed into the ticket body"*
— and `buildDossier.js` never reads the field. The authenticated signal §5 asks
for is **computed and thrown away**.

**`T-2` raises the stakes and is why (c) is not merely tidy.** Once UC-08 reads
Remote records for a named employment, an unverified id stops being a label on a
dossier and becomes **the key to somebody else's travel history**. `T-23`/`T-24`
are therefore prerequisites of `T-2`, not follow-ups to it.

---

## 17b. New SPEC_DRIFT opened by the 2026-08-21 decision pass

> Four findings, `DRIFT-106`…`DRIFT-109`. `DRIFT-105` was the high-water mark
> before this pass. Three came from checking the *sources* the specification
> names rather than the code that consumes them, which is a place this register
> had not looked before; the fourth came from the aftermath decision colliding
> with a surface that does not exist.

---

### SPEC_DRIFT · DRIFT-106 · The data source §5 specifies for the presence count cannot produce a dated, located count, and never could

**Original/documented behaviour:** `UC-08.md` §5 — *"deterministic: compute
historical physical-presence days (**time-off + workation custom fields**)"*.
§3's data-source table carries *"Travel/presence data — Custom fields / time-off"*
as **`[CONFIRMED — capability exists; specific endpoint shape not yet verified]`**.
§13 task 4 is *"Presence-day calculator (custom fields + time-off)"*.

**Current implementation:** `presencePeriods` arrives as structured input, as
§15 says plainly. DRIFT-039 reads that as a shortfall against the spec.

**What the check found:** the shape was verified this pass, and **the specified
source cannot yield the specified figure**.

- **`Timeoff`** (`get_v1_timeoff.md`) — required properties `id, employment_id,
  status, start_date, end_date, timeoff_days, total_minutes, timeoff_type,
  leave_policy, timezone`; optional `approved_at, approver_id, automatic,
  cancel_reason, cancelled_at, document, leave_policy_variant_id, notes`.
  **No country property. No location property.** `timezone` is
  *"[TZ identifier](https://www.iana.org/time-zones)"*, example **`Etc/UTC`** — a
  clock, and in that example not a place at all; zones neither partition
  countries nor are partitioned by them. `TimeoffDay` is `{day, hours, minutes}`.
- **The sign is also wrong.** A workation is someone *working*. It produces **no
  time-off record**. Time off records when a person was not working; it never
  records where they were.
- **Custom fields**
  (`get_v1_employments_employment_id_custom-fields.md`) —
  `ListEmploymentCustomFieldValueResponse` is
  `{custom_field_id, name, type, value}`. One value per field per employment,
  **no dates**. A trip history is not representable in it. The committed capture
  adds a second, independent obstacle: values are addressed by *human name* plus
  a uuid with **no machine slug on any row**
  (`test/fixtures/sandboxCapture.js`, `LIVE_EMPLOYMENT_CUSTOM_FIELDS`) — the same
  fact that already defeats UC-04's `workation_permission` gate.

**Current tests assume:** structured input, which is correct for what is built.
**No test could have caught this**, because the defect is in a specification's
claim about a third party's API and nothing in this repository compares the two.

**Difference:** the build has been measured against a specification whose named
source is structurally incapable. DRIFT-039 therefore reads as *"the code fell
short of the spec"* when the accurate reading is *"the spec named something that
does not work, and the code is right by accident of never having tried it."*

**Likely reason:** §3's tag says it — *"capability exists; specific endpoint shape
**not yet verified**"*. The capability does exist, in the sense that Remote holds
time-off data. The inference that it therefore holds *presence* data was never
checked, and the honest tag on the row is exactly where the check should have
started.

**Risk if left as-is:** low today and high on the next pass. Nothing is currently
built on it. But §13 task 4 is a **standing work order to build the impossible
thing**, and a future session following the roadmap would spend its time
discovering this rather than reading it.

**Recommendation:** RECONCILE. Correct §5, §3 and §13 task 4, **keeping the
original wording visible**, and point them at the source that does work
(DRIFT-107). Record the reasoning, not just the correction: *a data source named
in a specification is a claim about someone else's API, and it decays exactly like
the negative claims `docs/WHY-THIS-SHAPE.md` §13 already teaches.*
**Confidence:** HIGH — both schemas read this session from Remote's own OpenAPI.

---

### SPEC_DRIFT · DRIFT-107 · Remote publishes a dated, located, employer-approved travel history, and UC-08 does not read it

**Original/documented behaviour:** §15 — *"Real Remote reads
(time-off/travel custom fields): **Not built**"*, recorded as an honest absence
awaiting a verified endpoint shape. §13 task 8 defers verification.

**Current implementation:** `handleTaxInquiry()` takes no `remote` client, and the
count is taken over rows a requester typed — **rung 4** of the substitution
ladder.

**What the check found:** two collections that hold precisely this data, live and
documented:

```
GET /v1/travel-letter-requests       ?employment_id= &status= &page= &page_size=
GET /v1/work-authorization-requests  ?employment_id= &status= &page= &page_size=
```

`TravelLetterRequest` and `WorkAuthorizationRequest` both carry
`destination_country` (`$ref → Country`), `travel_date_start`, `travel_date_end`,
`status`, and `travel_address` / `work_location`. Scopes are
`travel_letter:read` and `work_authorization:read`.

**And most of the plumbing already exists.** `src/remote/restClient.js:1597`
implements `listWorkAuthorizations({employmentId, status})`;
`src/remote/mockServer.js` serves both collections (`:3020`, `:3727`);
`src/uc03/letterScope.js:20` cites `get_v1_travel-letter-requests.md` by name.
**Only UC-08 does not call any of it.**

**Current tests assume:** typed input. Nothing asserts a Remote read, because
there is none.

**Difference:** rung 2 of the ladder is available and unused for the one number
this use case exists to produce, while rung 4 is presented in the same shape a
read would be — with no provenance distinguishing them (DRIFT-039(c)).

**Likely reason:** §3's unverified tag was never discharged, and the search that
would have discharged it looked for *time-off and custom fields* — the names §5
supplied — rather than for *"which Remote object records where somebody was, and
when."* The right records were under a different heading the whole time.

**Risk if left as-is:** two, in different directions. A specialist reads a precise
figure as employer-corroborated when it is a recollection. And the use case that
should best demonstrate API fluency — on an application where that is a named
criterion — is **the only one of the nine that makes no Remote call at all**.

**Recommendation:** RECONCILE, behind a **read-only façade** (invariant 21,
`T-1`), with provenance on the count (invariant 22, `T-3`) and a marked capture
fallback (invariant 23, `T-4`). **Sequence `T-23`/`T-24` first** — reading another
person's travel history on an unverified id is a different exposure from labelling
a dossier with one (DRIFT-069).

**The obstacle, recorded with the finding rather than found later:** both
collections answer **`200` with `total_count: 0`** on the live Sandbox
(`test/fixtures/sandboxCapture.js`, `LIVE_WORK_AUTH_COLLECTION`,
`LIVE_TRAVEL_LETTER_COLLECTION`). A correct read of the right endpoint returns
nothing, and a downstream gate can never fire — §0.4 trap 1. `M-1` re-measures;
§16 item 11 is the positive test that must lead.
**Confidence:** HIGH on the endpoints and their shapes; HIGH on the emptiness at
capture time; the emptiness **now** is `M-1`.

---

### SPEC_DRIFT · DRIFT-108 · `/v1/federal_taxes` has no read endpoint, and §13 task 8 has carried it as a pending verification for months

**Original/documented behaviour:** `UC-08.md` §3 lists *"Federal/local tax schemas
— `/v1/federal_taxes` (per docs)"* as **`[INFERRED — verify in OpenAPI before any
real Remote read]`**, and §13 task 8 makes that verification a build task.

**Current implementation:** called nowhere, correctly, since it was never
verified.

**What the check found:** the endpoint family exists and **has no GET**:

```
PUT /v1/employments/{employment_id}/federal-taxes    (v1 and v2)
PUT /v1/employee/federal-taxes
```

Both are **writes** — W-4 submission, US Global Payroll only, post-enrollment
only, `employment:write` / `personal_detail:write`. Note also the **hyphen**;
`federal_taxes` with an underscore appears only as a *form name*
(`global_payroll_federal_taxes`) on the country form-schema endpoint, which is a
different object entirely.

**Difference:** a row tagged `[INFERRED]` and a task marked pending have carried
an implication that a read might exist. It does not, and the closest thing to it
is a write in the opposite direction — which, on a use case whose defining
guarantee is that no write path exists, is worth naming rather than leaving as a
hopeful `[INFERRED]`.

**Likely reason:** the same one as DRIFT-106 — a doc *title* read as a path.
`CLAUDE.md` §4 records UC-06 calling `/v1/payroll-runs` for exactly this
reason, and the capture pins it as a 404.

**Risk if left as-is:** low, and purely a time cost: the next pass to reach task 8
re-runs a verification that has now been run.

**Recommendation:** RECONCILE. Mark §3's row and §13 task 8 **resolved negative**,
with the three real paths named so nobody re-derives them. A negative result is a
result. *(`T-7`)*
**Confidence:** HIGH — read from Remote's own reference this session.

---

### SPEC_DRIFT · DRIFT-109 · No UC-08 ticket exists on the portal path, and three separately-decided things all need one

**Original/documented behaviour:** §11 — *"If nobody responds… on the portal path
there is no ticket at all"*, recorded as a consequence of a correct design choice.
`docs/APPROVAL-ROUTING.md` §2 states the specialist *"is never told"* and calls the
result *"not a hand-off"*.

**Current implementation:** `src/portal/ticketing.js` derives `TICKETABLE_TYPES`
from `NO_TICKET_DECISIONS`, whose keys are `uc02, uc03, uc04, uc05, uc06, uc09`.
**`uc07` and `uc08` are absent.** The stated reason is sound: linking a ticket
means writing an id back onto the record, and these stores have one write method
and zero mutations.

**What the decision pass found:** the reason is sound and the **conclusion is one
step too wide**, and three decisions taken this session collide with it at once —
the aftermath (§0.5 Q4, `T-14`), the outside-the-record metric (DRIFT-067, `T-16`)
and §12's *"the receiving human must not be left unaware the case arrived."*

**The one step too wide:** *"nothing may be approved here"* and *"nobody may ever
be told"* are two different rules, and only the first is the 🔴 invariant. Both
were being kept by the same absence. **Raising a ticket and linking a ticket are
separable** — the id can travel one way, record → ticket, leaving the store's
one-write-method surface untouched and the structural test passing unchanged.

**Current tests assume:** the current shape. A test of the gap would **pass**,
which is why four review passes did not surface it — the invariant is satisfied.

**Difference:** a compiled, audited, correct dossier sits in `uc08_dossiers` with
nothing in anybody's queue, and the requester is told to wait for a specialist who
was never notified.

**Risk if left as-is:** the tier's whole justification is that a human does the
judging. **A human who is never told is not doing the judging**, and the system
looks safest exactly where it is least effective.

**Recommendation:** RECONCILE. Add `uc08` — and `uc07`, which has the identical
blocker and whose `R-24` is the same decision — to the ticketable set, raising a
Tax Operations ticket **after** the gates and after the record is durable, with
the id travelling record → ticket only. **Build it once for both use cases**;
building it twice would produce two vocabularies for one hand-off.
*(`T-13`; `docs/WHY-THIS-SHAPE.md` §16 is the general form.)*
**Confidence:** HIGH on the finding; HIGH on the remedy, which UC-07's pass
already argued and decided.

---

## 18. Build queue — `T-1` … `T-28`

> **The sixth build queue** (UC-02 §18, UC-04 §18, UC-05 §18, UC-06 §18,
> UC-07 §18 are the others). **Nothing in it is built.** Every change here is
> `DECIDED · NOT YET BUILT`, and the drift each one addresses is still live in
> the code.
>
> **The `T-` prefix corresponds to nothing.** Eight schemes now exist — UC-01
> `G-1`…`G-4`, UC-03 `G-A`…`G-C`, UC-02 `E-1`…`E-3`, UC-04 `W-1`…`W-10`, UC-05
> `N-1`…`N-18`, UC-06 `A-1`…`A-32`, UC-07 `R-1`…`R-27`, UC-08 `T-1`…`T-28` —
> and none of them corresponds to another. `CLAUDE.md` §7 item 20 is why.

### Step 0 — three measurements, before any code

None can be taken from a container without `.env`. **Two of them can change the
plan, so they are measurements and not assumptions.**

| | Measurement | Why it decides something |
|---|---|---|
| **`M-1`** | Do `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests` still answer `200` for the current Sandbox token — and do they hold **any** rows, for **any** employment? | The committed capture says `total_count: 0` for both. **If still zero, `T-4` stops being a backstop and becomes the demo**, and `T-2` ships behind a fixture that has never seen a real row. This is the difference between demonstrating an API and demonstrating a call that returns nothing |
| **`M-2`** | What does `GET /v1/timeoff` actually return for a Sandbox employment? Captured as `200`; **the body was never recorded** | DRIFT-106 says the *shape* cannot carry a location. `M-2` closes it on **observation** as well as on schema, which is the standard §0.2 is held to elsewhere in this repository. It is expected to confirm the finding, not overturn it |
| **`M-3`** | Does **any** Sandbox employment carry travel dates, from any object at all? | If the answer is no anywhere, the fixture in `T-4` is the only path to a positive test, and `T-4` moves ahead of `T-2` |

**Do not skip `M-1` on the grounds that the capture already answers it.** The
capture is dated; a Sandbox that was reseeded once can be reseeded again, and
`CLAUDE.md` records a dead employment id costing a session's first hour for
exactly this reason.

### The changes

| | Change | From | Kind |
|---|---|---|---|
| **`T-1`** | **A read-only façade** for UC-08 — fixed, small method list, **no write-method name in its surface**. Not a `RemoteClient` used with discipline | DRIFT-039 · §0.4 | code |
| **`T-2`** | Read `GET /v1/travel-letter-requests` and `GET /v1/work-authorization-requests` by `employment_id`; approved-only by default; **three outcomes** — records / `total_count: 0` / unreachable | DRIFT-107 | code |
| **`T-3`** | **Provenance on the count**, in the same sentence as the number, marked per row: read from Remote · supplied with the request · replayed | DRIFT-039 | code |
| **`T-4`** | Committed capture + **loud** replay (`sandbox_replay` on dossier and trace, with the capture's date); **live always wins**; a fixture carrying real travel rows | DRIFT-104 · `M-1` | code · fixture |
| **`T-5`** | Print the resolved instrument's **own window** beside the window used. Never silently correct either | DRIFT-039 · C-10 | code |
| **`T-6`** | Correct `UC-08.md` §5, §3 and §13 task 4 — the named source cannot produce the figure. **Original wording kept visible** | DRIFT-106 | docs |
| **`T-7`** | Mark §3's `/v1/federal_taxes` row and §13 task 8 **resolved negative**, naming the three real `PUT` paths | DRIFT-108 | docs |
| **`T-8`** | `loadUc08()` passes the **whole view** through; the panel renders `presence.statement`, `openQuestions`, `citationCoverage.scope`, `sources`, `uncited` | DRIFT-037 | code |
| **`T-9`** | Fix the `null day(s) across 0 period(s)` render. **Ships on its own, ahead of `T-8`** | DRIFT-037 | code |
| **`T-10`** | One test that reads the API response for a dossier and asserts the panel renders **every** field the server computed or visibly declines to | DRIFT-037 · §16.7 | test |
| **`T-11`** | Derive `disclaimerApplied` from the dossier instead of the literal `true` | DRIFT-038 | code |
| **`T-12`** | Render `customerFacingAcknowledgement` — portal result and ticket note — so the disclaimer stops being satisfied vacuously | DRIFT-038 | code |
| **`T-13`** | **Add `uc08` (and `uc07`) to `TICKETABLE_TYPES`.** Ticket raised after the gates and after the record is durable; **id travels record → ticket only** | DRIFT-109 | code |
| **`T-14`** | The aftermath: `dossier_read` → `proceeding_offline` / `not_proceeding` / `more_information_needed`, **on the ticket, never on the store** | §0.5 Q4 | code |
| **`T-15`** | The requester is told; their portal status moves off *"with a tax specialist"* and carries the outcome + disclaimer | §0.5 Q4 | code · copy |
| **`T-16`** | Metrics **outside the record**: outcome verbs, Zendesk reopen rate, escalation → first specialist comment. `uc08_dossiers` untouched | DRIFT-067 | code |
| **`T-17`** | Metrics **of completeness**: the distribution of `openQuestions` codes and priorities, already computed on every read | DRIFT-067 | code |
| **`T-18`** | **Read-time staleness statement** — how old the count is, whether its window has closed. No new dependency, parameter or route | DRIFT-068 | code |
| **`T-19`** | Tracks **A, C, D**, then **B** | DRIFT-068 | code |
| **`T-20`** | **Pin** Track E's unconditional absence and its licence reason by test — it is already the behaviour; nothing asserts it | DRIFT-068 | test |
| **`T-21`** | **Assert Track F absent**: no UC-08 output is read by any other use case's gate, structurally and behaviourally | invariant 24 | test |
| **`T-22`** | Restate `UC-08.md`'s opening blockquote: *"V2's shape, built; v1's six-track and MONITORING architecture, roadmapped"* | DRIFT-068 | docs |
| **`T-23`** | Record the authenticated signal beside the claimed id; mark it **`verified`** / **`claimed`** on the audit row and the dossier. Wire the n8n normaliser's discarded `session` | DRIFT-069 | code |
| **`T-24`** | Scope `listByOwner()` **reads** to a verified subject | DRIFT-069 | code |
| **`T-25`** | Correct `UC-08.md` §5 step 1 and §14's `identity-service` dependency | DRIFT-069 | docs |
| **`T-26`** | Replace the three hand-written passages with a **country-filtered lexical index** over the 106 real statutory passages. One decision with UC-07 | DRIFT-036 · DRIFT-046 | code |
| **`T-27`** | Correct the retrieval status rows in `CLAUDE.md` §4, `README.md`, `docs/BUILD-LOG.md` §1 to *"keyword, with an embedding path built and not wired"* | DRIFT-036 | docs |
| **`T-28`** | Restate §11's metric thresholds against quantities that can actually be produced | DRIFT-067 | docs |

### Ordering — four dependencies that are expensive to get wrong

1. **`T-13` before `T-14`, `T-15` and `T-16`.** All three need something to record
   an outcome on, and no UC-08 ticket exists on the portal path. Building the
   aftermath first produces verbs with nowhere to land.
2. **`T-1` before `T-2`.** The façade before the read — UC-07's `R-1` before `R-6`,
   for the same reason. Wiring the read first and "tightening it later" means the
   structural no-write assertion has already been weakened, and §16 item 15 is the
   only thing that can tell a façade from a client used carefully.
3. **`T-23` and `T-24` before `T-2`.** Reading another person's travel history on
   an unverified id is a materially different exposure from labelling a dossier
   with one. The identity work is a **prerequisite** of the read, not a follow-up.
4. **`T-4`'s fixture before `T-2`'s gate, if `M-1` returns zero.** Both live
   collections were empty at capture. A read that ships having never returned a
   row is a gate that cannot fire, and *a gate that cannot fire and a gate being
   careful are indistinguishable from outside.* **§16 item 11 — the positive test
   — leads.** This is UC-03's dead-gate shape and UC-06's `A-10` ordering, third
   instance.

**One cross-pass dependency.** `T-13` is the same change as UC-07's `R-24`
prerequisite. **Build it once, for both.** Two implementations would give one
hand-off two vocabularies, which is the failure `docs/ESCALATION-DESTINATIONS.md`
exists to prevent.

### What must NOT change

1. **`handleTaxInquiry()` takes no `remote` client parameter.** Invariant 1 is the
   parameter's absence. `T-1` and `T-2` must not touch the signature.
2. **No POST route in `src/uc08/server.js`.** Not one that refuses — one that does
   not exist.
3. **`dossierStore` keeps one write method and zero mutation methods.** The
   aftermath goes on the ticket precisely so this stays true.
4. **`control: "none_by_design"`, `verbs: []`, `roles: []`.** No approve button
   appears anywhere as a result of anything in this queue.
5. **The decision is `escalate`, always.** No input, flag, score, citation,
   Remote read or outcome verb can change it.
6. **The n8n graph keeps no Switch and no IF node.**
7. **Track E stays unbuilt**, and its licence reason stays on every dossier.
   `T-20` pins it; it does not change it.
8. **Track F is never built.** Invariant 24.
9. **No threshold, window, treaty article or residence rule becomes a value.**
   `T-5` prints the instrument's window **as a quotation**, never as a field.
10. **`npm run seed-vectors` is not run.** §0.9.
11. **The LLM never sees a Remote record.** `T-2`'s output goes to deterministic
    arithmetic only.
12. **Tests stay hermetic.** `T-1`'s façade needs an injectable seam from day one,
    not after a slow test surfaces it — `CLAUDE.md` §6 records real credit burned
    for exactly this.

### Open questions this queue does not answer

- **`I1`** — seed the Sandbox with travel records, ship capture-replay, or both?
  `M-1` informs it and does not decide it.
- **`I2`** — tracks A–D built now, or MONITORING (`T-18`) and provenance (`T-3`)
  only, with the tracks after submission?
- **`I3`** — the lexical index (`T-26`) now or after submission? One decision with
  UC-07.
- **`I4`** — the staleness horizon: at what age does a replayed capture stop being
  usable, and what does the page say then?
- **UC-07's `H1`** — email or portal status for the requester notice. **Answered
  once, for both use cases.** Not duplicated here.
