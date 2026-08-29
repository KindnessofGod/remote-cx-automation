# UC-04 — Canonical Acceptance Contract

> **Remote Work Authorization / Workation · 🟡 Medium tier · Remote-native request + portal + free-text intake**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-04.md` (§1–§17),
> `src/uc04/{policyEngine,riskMatrix,workflow,approvalPolicy,requestLink,requestParser,intakeExtractor,textIntake,decisionFacts,decisionSources,authorizationStore,server}.js`,
> `src/uc03/uc04Intake.js`, `src/portal/uc03Continuation.js`,
> `workflows/nodes-uc04/workationGates.js`, `test/uc04*.test.js`.
>
> **Intended business truth.** §17 records the divergences. No code or test was
> changed to produce this.

---

> ## DECISIONS — 2026-08-21. Read this before §1.
>
> **All five UC-04 findings are now dispositioned** (`DRIFT-017`…`DRIFT-021`),
> **five new findings were opened by the decisions themselves**
> (`DRIFT-089`…`DRIFT-093`), and §18 is the build queue. **No code, test,
> workflow or ZAF asset was changed to produce this revision.**
>
> ### The four states a finding can be in
>
> | State | Means |
> |---|---|
> | `DECIDED · BUILT` | Chosen, code matches. Nothing outstanding |
> | `DECIDED · NOT YET BUILT` | Chosen, code still does the old thing. **The drift is still live** |
> | `DECIDED · NOTHING TO BUILD` | Chosen, and the tree already agreed — verified here, not accepted from the finding |
> | `OPEN` | Nobody has chosen |
>
> Every UC-04 finding below is **`DECIDED · NOT YET BUILT`**. Marking any of them
> built would be the overstatement `CLAUDE.md` §1 says discounts everything else.
>
> ### The three gate changes are prefixed `W-`
>
> UC-01's are numbered `G-1`…`G-4`, UC-03's lettered `G-A`…`G-C`, UC-02's
> prefixed `E-1`…`E-3`. UC-04's are **`W-1`…`W-3`**. **They do not correspond.**
> §7 item 20 of `CLAUDE.md` records this repository already carrying two registers
> that both number findings `C-N`, with code citing both; one collision of that
> kind is enough.
>
> | # | Change | Source |
> |---|---|---|
> | **W-1** | **A `business_visa` to the United States stops being an outright block** and escalates instead. The operative test is local employment vs. business activity, and who pays — not visa status | C-26 |
> | **W-2** | **An approval re-checks the dates.** A start date that has passed since the decision refuses the approval by its own name | DRIFT-020 |
> | **W-3** | **`travel_document_number` is captured** — Remote's own required field — displayed as identity evidence and **never read by a gate** | DRIFT-092 |
>
> `W-1` and `W-2` exist **twice**: `workflows/nodes-uc04/workationGates.js` is the
> n8n port, held by `test/n8nUc04Parity.test.js`. Neither is done until graph
> `WORKFLOW_UC04_ID` is republished and `versionId === activeVersionId` is verified.
>
> **`W-1` is the only change in this queue that LOOSENS a control**, and it needs
> a **positive test leading** — this repository's most expensive recurring defect
> is that a gate which cannot fire and a gate being careful are indistinguishable
> from outside (`CLAUDE.md` §5, three separate sessions). A negative-only suite
> passes either way.
>
> ### Seven surface changes, prefixed `W-4`…`W-10`
>
> | # | Change | Source |
> |---|---|---|
> | **W-4** | **A new employee-facing surface** — the Request Hub stand-in. The employee files, sees `pending`, and later sees the outcome **including the decline reason** | DRIFT-018, DRIFT-089 |
> | **W-5** | The admin form is **relabelled as the employer's assessment**. Today it is titled *"Request permission to work from another country"* — the employee's own sentence, on a form that refuses employees | DRIFT-018 |
> | **W-6** | `visaType` labelled **self-declared, unverified** on every surface | DRIFT-017(b) |
> | **W-7** | Dimension 1 stated on-screen as a **known-gap screen** — membership means "we know there is no treaty", absence means nothing | DRIFT-017(a) |
> | **W-8** | Travel history stated as **supplied, not retrieved** | DRIFT-090 |
> | **W-9** | An escalation **names the UC-07/UC-08 finding** the matrix computed, and the team that would own it. No route is built | DRIFT-021 |
> | **W-10** | **One spelling** of the escalation team, sourced from `escalationRouting.js` | §12/§14 |
>
> ### What Remote's own documentation settled, fetched live 2026-08-21
>
> `developer.remote.com/reference/get_v1_work-authorization-requests_id.md` and
> its `patch_…` sibling were fetched and transcribed. Four things follow, and two
> of them corrected this contract rather than confirming it:
>
> 1. **`will_negotiate_or_sign_contracts` is Remote's own field**, with Remote's
>    own rationale — *"Whether the employee will negotiate or sign contracts on
>    behalf of the company in the destination country. **This may affect the type
>    of work authorization required.**"* One of our seven factors is literally
>    Remote's field. That is the strongest available vindication of the factor
>    model and it is recorded here because a register that only ever reports
>    faults teaches its reader to distrust everything equally.
> 2. **There is no visa field and no permit field anywhere on the object.** What
>    Remote carries is `travel_document_number` — *"The employee's travel document
>    (**passport**) number"*. So DRIFT-017's claim that the document check was
>    *"replaced by a declared `visaType`"* **understates it**: `visaType` is not a
>    substitution for a Remote field, because Remote has no such field. It is ours.
> 3. **The two-stage model is stated by Remote**, on the travel-letter sibling:
>    *"The request goes through a **two-stage approval**: first by the employer
>    manager, then by Remote."* `approved_by_manager` is the **employer's**
>    signature, not an authorisation.
> 4. **A decline must carry a reason.** `DeclinedWorkAuthozation` requires
>    `["status", "reason"]` — the API stating that a refusal must carry one. The
>    workflow already honours this, and its fallback text invents no rationale.
>
> ### One thing that was checked rather than assumed
>
> **Neither Remote object carries a file, URL or document field.** Not the work
> authorization, and not the travel letter — a thing that is a letter by name.
> The lifecycle terminates at `approved_by_remote`, glossed *"Fully approved by
> both manager and Remote"*. So **the outcome of this use case is a status, not an
> artifact**, and §15 previously implied otherwise. Corrected below; opened as
> DRIFT-093 so the correction is not mistaken for something that was always true.

---

## 1. Business purpose

An employee wants to work — not merely travel — from another country for a
while. That creates real exposure: permanent-establishment risk from what they do
there, immigration illegality from working on the wrong permission, and
accumulated presence that can cross a threshold nobody was counting.

UC-04 gathers the facts across independent dimensions, scores the risk, and puts
a **single, well-evidenced decision** in front of a mobility specialist. It never
decides. Remote's own Mobility Team performs a second approval this automation
structurally cannot touch.

## 2. Primary operator persona

**Three readers, three surfaces, and they are not interchangeable** — this is
Remote's own two-stage model, not a shape this build invented. Remote's schema:
*"The request goes through a **two-stage approval**: first by the employer
manager, then by Remote."*

| | Who | Where | What they do | What they must never be shown |
|---|---|---|---|---|
| **1** | **The employee** | The Request Hub (Remote's own; **the stand-in** here) `[W-4]` | Files the request; later reads the outcome **and the reason** | Risk-matrix internals. They are not being assessed on a score |
| **2** | **The company admin** | The portal's UC-04 form | **Assesses** a request the employee already filed `[W-5]` | Nothing about *their own* entitlement — they do not approve |
| **3** | **The mobility specialist** | The ZAF sidebar on the ticket | Makes the **employer-side** call, in one click | A decision string in place of the figures compared |

**Experience/knowledge:** the specialist knows immigration categories, PE risk,
and what a mobility escalation looks like. **The employee knows none of that**,
and is the one person in the chain whose own travel is the subject.

**They DO NOT know** (all three): the risk-matrix internals, `factors_invalid`,
`high_risk_pair`, or which of seven structured fields was malformed.

**The persona split is the fix for DRIFT-018, and the identity gate was already
decided.** `G-A` (DRIFT-078, third pass) accepts **an employee filing for
themselves, or an admin whose company matches**. This contract's §5 assumes that
gate; without it the employee surface would file and then be refused by the
system's own identity check.

## 3. Job to be done

*Employee:* "Get permission to work from there, and tell me quickly if I can't."
*Specialist:* "Make the employer-side call in one click, on evidence I did not
have to gather, and be told plainly when the case is not mine to one-click."

## 4. Starting preconditions

- An employment record exists, is `active`, and belongs to the company on the
  session — `session.companyId` must match the employment's `company_id`.
- The employment carries `custom_fields.workation_permission` as a real boolean.
- **Seven structured factors are present and well-formed**: home country,
  destination country, nationality, start and end dates, visa type, job duties,
  and contract-signing authority. **Four of the seven have no source in any
  Remote object** (`docs/INTAKE-RESEARCH.md` §6.4) and are therefore *declared*
  rather than *read* — see §14's mandatory statements of absence.
- **`travel_document_number` is captured where the employee supplied it** `[W-3]`
  — Remote's own required field, the employee's **passport** number. It is
  identity evidence, never permission evidence, and **no gate reads it**.
- The destination is not sanctioned and is a jurisdiction Remote's registry knows.
- For the write: a **real** work-authorisation request exists at Remote, created
  by the employee in Remote's own Request Hub. This automation cannot originate
  one — there is no `POST`.

## 5. Main successful journey

1. **The employee files** the request in Remote's Request Hub — or, for the
   demo, in the stand-in `[W-4]`. The request exists at Remote as `pending`,
   glossed by Remote as *"Submitted and awaiting manager review"*. **This
   automation cannot originate one**: there is no `POST` on the resource, and a
   create that existed here once was removed for that reason.
   Alternatively the case arrives from a travel conversation (UC-03), or somebody
   describes the trip in a sentence.
2. The system confirms who is asking and that they act for this employment's
   company.
3. It confirms the employment is active and the employer has granted workation
   permission — a recorded fact, never an assumption.
4. It screens the destination: sanctioned destinations are **blocked outright**,
   not escalated.
5. It confirms all seven factors are present and well-formed. Anything missing or
   malformed stops the case — an incomplete assessment is not an assessment.
6. It checks the dates make sense: end after start, start not in the past, and the
   destination is not the home country.
7. It runs the deterministic risk matrix over the country pair, the visa
   permission, the duties, the signing authority and the accumulated presence.
8. Everything clears: `ready_for_approval`. A mobility specialist sees one screen
   and approves. **The approval re-reads the employment AND re-checks the dates**
   `[W-2]`: a start date that has passed since the decision refuses the approval
   by its own name rather than executing a trip that has already begun.
9. On approval the automation `PATCH`es the **existing** Remote request to
   `approved_by_manager` — the only transition the API allows a client to make.
   This is the **employer's** signature, not the authorisation.
10. Remote's own Mobility Team performs the final approval, outside this system,
    moving the request to `approved_by_remote` — *"Fully approved by both manager
    and Remote"*.
11. **The employee sees the outcome where they filed it** `[W-4]`. On a decline
    they see the reason, because Remote's `DeclinedWorkAuthozation` schema
    requires one.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| All seven factors clean, destination in scope, low-risk pair, ordinary duties, no signing authority, permission granted | `ready_for_approval` / `all_gates_passed` | One specialist click → `PATCH approved_by_manager` on the real request |
| Executive or contract-signing authority | `escalate` / `high_risk_pair` (or the duty-driven escalation) | Tier-2 Mobility & Legal — PE exposure is not a one-click call |
| Destination requires a work permit and the traveller holds none — **`esta_usa`, `tourist_visa`, `digital_nomad_visa`, `other`** to US or CA | `blocked` / `us_requires_work_permit` \| `ca_requires_work_permit` | Hard stop. No Remote record touched |
| **`business_visa` to the United States** `[W-1]` | **`escalate`** / `us_business_visa_activity_unassessable` — **not `blocked`** | The B-1 **is** the business visa, and USCIS lists permitted business activities *"including, but not limited to"* — expressly non-exhaustive, so it cannot become a lookup in either direction. The operative prohibition is *"local 'employment' or 'labor for hire'"*, discriminated by **activity and who pays** (finding C-26; Canada's IRPR s.187 draws the same line). Neither is a fact this system holds, so it is a specialist's call — and today it is a **false refusal** |
| **Approval attempted after the start date has passed** `[W-2]` | Refused by its own name; **no `PATCH`** | The decision gate already holds the opinion that a past start date is invalid. Holding no opinion at approval time was the inconsistency |
| Visitor visa, but the trip is *work* | `blocked` / `visitor_visa_active_work_forbidden` | Hard stop |
| Schengen 90/180 exceeded | `blocked` / `schengen_90_180_exceeded` | Hard stop, measured **per day of stay** against its own trailing 180 days |
| Travel history unreadable | `blocked` / `travel_history_unreadable` | Never a silent clearance. Fixed defect — the calculator used to clear a traveller on an unreadable date |
| **Travel history EMPTY** | `COUNTED`, `days: 0` — proceeds normally | **Deliberately not the same as unreadable**, and deliberately unlike UC-08. A dossier asserting "0 days in GB" from no evidence is a claim about where somebody was; a workation with no prior stays is the ordinary case, and `NOT_EVALUATED` here would block every request anyone ever files |
| Country pair outside the curated matrix | `escalate` / `destination_out_of_scope` | Escalate-by-default is correct behaviour, not a gap |
| Sanctioned destination | `blocked` / `sanctioned_region` | **First position.** Iran and Montenegro were once indistinguishable, and `escalate` creates a Remote record — so a sanctioned destination produced a real work-authorisation record whose country the schema cannot represent |
| Employer permission not recorded | `escalate` / `employer_permission_not_granted` | |
| Any of the seven factors missing/malformed | `blocked` / `factors_invalid` | The specific issue is named |
| End before start / start in the past / same country | `blocked` with the specific reason | |
| Employment not active | `escalate` / `employee_not_active` | |
| Identity not verified | `escalate` / `identity_not_verified` | |
| Free-text intake, reading incomplete | **Clarify, not escalate** | Escalating would hand a specialist a case whose deciding gate describes *our reading* rather than the employee's trip |
| No linkable Remote request found | A `ready_for_approval` is **downgraded to `escalate`** | An `escalate` never moves the other way; a `blocked` was never resolved at all |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate webhook** | One claim, one `uc04_authorizations` row, one audit row. Proven live: two independent pairs, 12/12 row counts of exactly 1 |
| **Blocked request** | Touches Remote **not at all** — no lookup, no record, no `PATCH` |
| **Remote request exists but is not `pending`** | The `PATCH` must not be attempted; the only allowed transitions from `pending` are `approved_by_manager` / `declined_by_manager` |
| **Model output from free text is mistaken for what the person typed** | Must not happen — the extracted reading is presented as a reading, distinguishable from the requester's own words |
| **Country typed by hand** | Chosen from Remote's own 249-entry list, never typed |
| **A quick-fill overwrites the traveller carried from UC-03** | Refused `continuation_subject_mismatch`. A completion may only fill still-empty fields |
| **Nationality unknown** | It has **no source in any Remote object**. The portal offers the home country as a starting point and says on the screen that it is a guess |
| **Remote read 403/5xx vs 404** | `upstream_unavailable` vs `upstream_record_not_found` — different sentences |
| **Approval days after the decision** | Freshness re-check before the write |
| **Two specialists approve simultaneously** | One decision stands |
| **The `PATCH` fails** | A durable `workation_execution_blocked` audit row; the approval is not reported as executed |
| **Approver not entitled** | Refused **last**, after every refusal the policy already had, by its own name; `approver_entitlement_not_configured` is deliberately a different refusal from `approver_not_entitled` |
| **The employee files through the stand-in and nothing seeds a Remote record** `[W-4]` | The stand-in seeds **in-process only**. `POST /v1/work-authorization-requests` over the wire must keep answering Remote's bare `"Not Found"` string — asserted structurally, not by comment |
| **A `blocked` or `escalate` outcome** | **The employee is told nothing.** A block touches Remote not at all (invariant 3), so their request stays `pending` at Remote forever. This is a live gap, narrowed but not closed by `[W-4]` — see DRIFT-089 |
| **An escalation reaches Tier-2** | Tagged and assigned, and **that is the end of this system's involvement**. No SLA, no reminder, no re-entry, no return path — see DRIFT-091 |

## 8. Invariants — must never happen

1. **This use case never auto-executes.** Every case reaches a human, at every
   risk score.
2. **A sanctioned destination never produces a Remote record.**
3. **A `blocked` decision never touches Remote.**
4. **The automation never originates a work-authorisation request** — there is no
   `POST` and inventing the record it then decides on was a real, fixed defect.
5. **The automation can only forward-approve or decline.** Remote's own Mobility
   Team performs an approval this system structurally cannot reach.
6. **The four/seven dimensions are never collapsed into one score** that decides.
7. **Immigration legality is never inferred from a destination's enforcement
   patterns.**
8. **An incomplete factor set never produces an assessment.**
9. **`ready_for_approval` can be downgraded to `escalate`, never the reverse.**
10. **A day count is never produced from an unreadable travel history.**
11. **The approver must be an entitled `uc04:mobility_specialist`**, checked last
    and able only ever to refuse.
12. **`travel_document_number` never reaches a gate** `[W-3]`. A passport number
    proves who somebody is; it proves nothing about what they may do. Capturing
    it and then comparing it would be the document-presence check this system
    cannot perform, wearing the name of one it can.
13. **A cap, a limit or a coverage claim never appears without naming who holds
    it** `[W-6]` `[W-7]`. `visaType` is self-declared and says so; the treaty
    screen is a **known-gap list** and says so — membership means "we know there
    is no treaty", absence means nothing at all.
14. **The Request Hub stand-in never gains a partner-API create** `[W-4]`. It
    stands in for Remote's **product**, which genuinely does create these; the
    partner API does not, and a stand-in that blurred the two would re-introduce
    the fabricated `POST` that `src/remote/mockServer.js:3720` exists to refuse.

## 9. AI responsibilities

**The LLM may:** extract structured facts from free-text trip descriptions
(destination, dates, stated reason, duties); compile the dimension summary for the
specialist; draft the plain-language explanation of *why* a dimension escalated;
ask a clarifying question when its reading is incomplete.

**The LLM must never be the source of truth for:** tax residency, PE exposure as a
fact, role sensitivity without the maintained category table, the risk score, the
approval, or the `PATCH`. It may not collapse the dimensions into one number.

## 10. Deterministic responsibilities

Identity and company match · employment status · employer permission · the
sanctions screen (first) · factor completeness · date sanity · the country-pair
risk matrix · the visa/duties/signing-authority rules · the Schengen per-day
window and cumulative presence · the approval floor · the request link · the
`PATCH` · audit ordering.

Gates exist twice; `test/n8nUc04Parity.test.js` compares against the real
functions. The deployed graph carries all ten restricted codes, verified from the
live graph rather than from the repo's copy.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Every case. `ready_for_approval` is a one-click specialist decision; `escalate` is a Tier-2 case; `blocked` is a hard stop nobody decides |
| **Who** | **One role, one slot, fill once** — `uc04:mobility_specialist`. Not dual control: UC-04.md §1 names one mobility specialist. Ordinary work → **Mobility Specialists**; escalations → **Mobility & Legal (Tier-2)**, the only routing row with two teams |
| **Evidence needed** | Who is travelling (name, status, country), where, when, on what permission, to do what, whether the employer agreed, what the matrix compared, **and which facts are unsourced** — `decisionFacts.js` states plainly that a wrong country here is not caught anywhere |
| **After approval** | `PATCH approved_by_manager` on the existing request; Remote's Mobility Team decides finally. **This is the employer's signature, and the screen must say so** — a specialist who believes they granted the authorisation has been misled |
| **After decline** | `PATCH declined_by_manager` **with a reason**. `DeclinedWorkAuthozation` requires `["status", "reason"]` — Remote's API stating that a refusal must carry one. The fallback when no note was given states what happened and invents no rationale |
| **Expiry** | **The approval re-checks the dates** `[W-2]`. A start date that has passed since the decision refuses by its own name. Previously: none defined |
| **If nobody responds** | The case waits, and **nothing chases it**. Ticket #51 waited in the account default group because its owning group did not exist; the group now exists and #51 is still in `Support`, because creating a group fixes the *next* hand-off and retro-assigns nothing |

### What the employee is told, per outcome `[W-4]`

The row that did not exist before this revision, and the one DRIFT-089 is about.
**Today only one of four outcomes reaches the person whose trip it is.**

| Outcome | Reaches the employee? | How |
|---|---|---|
| **Declined**, on a linked Remote request | ✅ Yes, with the reason | `PATCH declined_by_manager` + `reason`; Remote emits `work_authorization.declined_by_manager`, and it lands in the Request Hub where they filed |
| **Approved** | ✅ Yes | `PATCH approved_by_manager`; the request moves on to Remote's own review |
| **Blocked** | ❌ **No** | Invariant 3: a block touches Remote **not at all**. Their request stays `pending` forever. The admin sees the block; nobody tells the employee |
| **Escalated** | ❌ **No** | No Remote write. It becomes a Tier-2 ticket the employee cannot see |
| **Filed via the portal with no linkable Remote request** | ❌ **No** | There is nothing to `PATCH` |

`[W-4]` makes the first two **visible on a screen the employee owns**, which is
what makes them demonstrable rather than merely true. It does **not** close rows
three to five: those need a decision about whether a refusal this system reaches
alone should be transmitted at all, and there is no Remote transition that
expresses "we blocked this before asking you".

## 12. CROSS_UC_ROUTING

**May receive from**
- **UC-03 — Travel Support Router.** The only inbound cross-UC route, and the
  only one built anywhere in this system.
- Remote's own `travel_letter.requested` webhook (the specified primary trigger).
- The portal's own work-authorisation form, and the free-text intake.

**May route to**
- Nothing. UC-04 terminates in an approval, an escalation, or a block. **No route
  is being built** — DRIFT-021 stays a human decision, to be settled together with
  DRIFT-011 as one routing decision rather than four.
- **But the finding is named** `[W-9]`. When the matrix computes a
  presence-threshold crossing (UC-08's subject) or a signal that the trip is
  really a move (UC-07's), the escalation **says so and names the team that would
  own it**. A computed finding that reaches nobody is the cheap half of the
  problem and it is fixable without a route. Creating no cross-UC record is the
  point, not an omission.

**Routing conditions (inbound, UC-03 → UC-04)**
UC-03 classified the request as `work_authorization`, and its identity, status,
confidence, sanctions, registry and duration gates all passed first.

**Context that MUST transfer (inbound)**

| | Carried | Notes |
|---|---|---|
| Customer/user identity | ✅ | The traveller's employment id, **verified on submission** |
| Employment/entity identifier | ✅ | |
| Zendesk ticket / reference | ✅ | The UC-03 case reference is carried and linked |
| Trace / correlation id | ✅ | One reference spans both decisions |
| Evidence already gathered | ⚠️ Partial | Home country, destination, and dates **when stated** |
| Decision / risk information | ✅ | UC-03's decision and reason ride along |
| Approvals already obtained | n/a | |
| Relevant conversation | ✅ | |
| **Session / persona** | ⚠️ **Deliberately changes.** UC-04 refuses `persona_cannot_request` for a non-admin, so the continuation moves the session to the company admin. This is a real, intended discontinuity and must be visible to the requester — not a silent identity swap |
| **Other required state** | ❌ **Four of seven inputs have no source in UC-03**: nationality, visa type, job duties, signing authority |

**Must NOT happen during handoff**
- ❌ Customer repeats information. *Satisfied* — carried fields pre-fill and two
  worked completions fill the rest.
- ❌ Duplicate work created. *Satisfied* — UC-03 creates no UC-04 record.
- ❌ Audit continuity lost. *Satisfied* — one reference.
- ❌ Approval state lost. *n/a.*
- ❌ Ownership ambiguous. ⚠️ **At risk, and being fixed** `[W-10]` — UC-04's own
  strings say "a mobility specialist", "Mobility Legal Tier-2", "a Mobility Legal
  reviewer" and "a Mobility Legal specialist": **four spellings, none equal to the
  group's real name, `Mobility & Legal (Tier-2)`**. The fix sources the name from
  `escalationRouting.js` rather than retyping it, because a fifth hand-typed
  spelling is the same defect with a different string.
- ❌ Two UCs execute conflicting actions. *Satisfied* — UC-03 has no write here.
- ❌ Duplicate Zendesk tickets. ⚠️ **Unverified** by any test found in this pass.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Request Hub stand-in (employee)** `[W-4]` | Their own request, in their own words: where, when, the status Remote holds, and — on a decline — **the reason**. Never a risk score, never a matrix internal. It stands in for a Remote **product** surface and says so on the page |
| **Portal (admin)** | The form, **titled as the employer's assessment of a request the employee already filed** `[W-5]`, with countries chosen from Remote's list; the continuation banner when arriving from a travel request; the answer first |
| **Free-text intake** | The system's *reading* of the sentence, clearly marked as a reading, with a clarifying question where incomplete |
| **Zendesk ticket** | Tagged `uc04`, `queue_mobility_specialists` (ordinary) or `escalation_mobility_legal_t2` (escalations). Note names the traveller, the trip, the deciding gate, the owning team, and where to act |
| **ZAF sidebar** | One approve/decline pair, the dimension summary, the figures compared, **and what was not verified** |
| **Live Feed** | The decision and every attempt beneath it |
| **Requests** | The requester's own state |
| **Backend/API** | `POST /uc04/api/authorizations/:id/approve\|decline` behind signed identity + role entitlement |
| **Database** | `uc04_authorizations` · `audit_log` (decision, pre-write, post-write or `workation_execution_blocked`) · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | Exactly one `PATCH` to `approved_by_manager`/`declined_by_manager` on an **existing** request. **Nothing at all** for a `blocked` decision |

## 14. UX_ACCEPTANCE

- **Hierarchy.** Who, where, when, on what permission — then the decision, then
  the evidence.
- **Statements of absence are mandatory**, and there are now **five**, not two.
  All five must be on the screen (§5 of `docs/UI-AUDIENCES.md`, which exempts
  statements of a limit or an absence from the deletion test):

  | | Statement | |
  |---|---|---|
  | 1 | **Nationality is a guess** — it has no source in any Remote object; the home country is offered as a starting point | existing |
  | 2 | **A wrong country is caught nowhere** — `decisionFacts.js` says so plainly | existing |
  | 3 | **The visa type is self-declared and unverified.** Nothing checked a document, and Remote has no visa or permit field to check one against | `[W-6]` |
  | 4 | **The treaty screen is a known-gap list.** Membership means "we know there is no treaty"; **absence means nothing** — not "no concern raised" | `[W-7]` |
  | 5 | **Prior stays were supplied, not retrieved.** Remote has no travel-history field on either object, so every day count rests on what somebody typed | `[W-8]` |

  Items 3–5 are the difference between a specialist believing a check happened
  and knowing one did not. On a screen that authorises somebody to work in a
  foreign jurisdiction, acting on false completeness is the failure the whole
  system exists to prevent.
- **Progressive disclosure.** The 22-rung ladder is a disclosure.
- **No internal language.** Never `high_risk_pair` alone.
- **Action clarity.** One primary action, and a sentence saying the approval is
  the *employer-side* call — Remote's Mobility Team still decides finally. A
  specialist who thinks they have granted the authorisation has been misled.
- **Practicality.** A specialist must not open Remote to see the trip.
- **Consistency.** ⚠️ Four spellings of the escalation team is a defect, fixed by
  `[W-10]` at the source rather than by retyping.
- **The employee's screen is written for the employee** `[W-4]`. Not a smaller
  copy of the specialist's. They need: what I asked for, what state it is in, who
  has it, and — if the answer is no — **why**. They need none of the matrix.

## 15. Successful business outcome

> **An employee's own request carries the employer's approval to Remote's
> Mobility Team, on evidence that was gathered for the specialist rather than by
> them, in one click** — and the employee can see that it did.
>
> And: nothing was ever auto-approved; no sanctioned destination produced a
> record; no assessment was made on an incomplete factor set; no day count was
> produced from data we could not read; and no figure was presented as checked
> that nobody checked.

**What this outcome is NOT, corrected in this revision.** It is **not** an
authorisation document, and this section previously implied one. Verified against
Remote's own OpenAPI on 2026-08-21: **neither `WorkAuthorizationRequest` nor
`TravelLetterRequest` carries a file, URL, or document field** — not even the one
that is a letter by name. The lifecycle terminates in a **status**,
`approved_by_remote`, glossed *"Fully approved by both manager and Remote"*.

So this system cannot hand anybody an authorisation document, and the reason is
not that it was never built. If Remote produces one it is produced inside their
product, with no endpoint to fetch it and no field pointing at one. A demo that
promises the document will fail on camera. Opened as **DRIFT-093** so this
correction is not later mistaken for something that was always understood.

## 16. Required evidence for E2E verification

1. **A positive test leads** — a clean case MUST reach `ready_for_approval` and,
   on approval, produce exactly one `PATCH`.
2. **Remote state** — the request read back as `approved_by_manager`; and for a
   `blocked` case, **proof that Remote was not called at all**.
3. **The sanctions test paired with a positive** — Montenegro must not be blocked,
   so the screen can never be silently re-pointed at `eor_onboarding`.
4. **Schengen arithmetic** — the peak window, the day it falls on, and the window
   itself, asserted per day of stay, not per trip.
5. **Unreadable travel history** → `blocked / travel_history_unreadable`, asserted
   at the calculator **and** at the gate, because the n8n path and any direct API
   caller reach the arithmetic unguarded.
6. **Continuation from UC-03**, end to end, with the traveller unchanged and both
   worked completions reaching their stated outcomes through the real gates.
7. **Idempotency** — two deliveries, one of everything.
8. **Entitlement** — an unentitled approver refused, and the refusal named
   distinctly from "not configured".
9. **Database + Live Feed + ticket + sidebar** all agreeing on one state.
10. **The employee sees the decline and its reason** `[W-4]`, on the surface they
    filed from — not asserted from a `PATCH` body, but read back off the screen.
11. **`POST /v1/work-authorization-requests` still answers Remote's bare
    `"Not Found"`** after the stand-in exists — a **structural** assertion that no
    HTTP path in the mock creates one, not a behavioural spot-check.
12. **`business_visa` to the US escalates, and the three visitor types still
    block** `[W-1]` — the positive and the three negatives in one suite, because
    a loosened gate and a correctly-permissive one are indistinguishable without
    both halves.
13. **An approval attempted after the start date has passed refuses**, and the
    refusal names the date rather than the employment `[W-2]`.
14. **`travel_document_number` changes no decision** `[W-3]` — the same case
    decided identically with it present and absent, asserted structurally.

## 17. Known SPEC_DRIFT

---

### SPEC_DRIFT · DRIFT-017 · The specified four dimensions are not the implemented seven factors

**Original/documented behaviour:** §5 and §7 specify a *"deterministic 4-dimension
gate, each independently confirmed or escalated"*: (1) totalization/treaty
coverage for the country pair, (2) role/activity PE-sensitivity, (3) cumulative
days in a rolling 12-month window, (4) **immigration-authorisation document on
file**. §13 task 2 requires the coverage table be *"sourced live from ssa.gov +
the EU portable-document registry"*.
**Current implementation:** seven structured *factors* (home country, destination,
nationality, dates, visa type, job duties, signing authority) feeding one
`riskMatrix.js`. Mapping to the four dimensions:
- (1) **Partially.** `riskMatrix.js` holds a `non_treaty_pair` list that is
  explicitly *"a KNOWN-GAP LIST, NOT A COVERAGE LIST"* — membership means "we know
  there is no treaty"; absence means nothing. There is no ssa.gov/EU-sourced
  coverage table and no independent gate.
- (2) ✅ via `jobDuties` + `hasContractSigningAuthority`.
- (3) ✅ via travel history and the Schengen window.
- (4) ❌ **Replaced by a declared `visaType`** — a value the requester supplies,
  not a document read from a store.
**Current tests assume:** the seven factors.
**Difference:** two of the four specified dimensions are not implemented as
specified, and dimension 4's substitution changes its character: §7 says
*"immigration legality is a **document-presence check**, never an
enforcement-likelihood guess"*, and a self-declared visa type is neither — it is a
**claim**, which prime directive #3 says is never an authenticated signal.
**Evidence:** `src/uc04/policyEngine.js:88–104` (`factorValidationIssues`);
`src/uc04/riskMatrix.js:241–248`; `UC-04.md` §5/§7/§13.
**Likely reason:** cannot be established. `docs/INTAKE-RESEARCH.md` §6.4 records
that five of UC-04's gate inputs have **no source in any Remote object**, which is
a plausible forcing reason for taking them as declared input — but no commit or
ADR found in this pass states it.
**Risk if left as-is:** a specialist reading "visa type: digital nomad visa"
reasonably believes a document was checked. Nothing checked one. On the PE side,
absence from the known-gap list is silently treated as "no concern raised" when it
means "we do not know".
**Recommendation:** HUMAN_DECISION_REQUIRED. Three sub-decisions: (a) build the
sourced coverage table, or restate dimension 1 as a known-gap screen and say so on
the screen; (b) label `visaType` on every surface as **self-declared, unverified**;
(c) decide whether a document-presence check is achievable at all given Remote's
object model.
**Confidence:** HIGH on the finding; LOW on why.

**DISPOSITION — 2026-08-21 · `RECONCILE`, in three parts, and the finding
understated one of them.** `DECIDED · NOT YET BUILT`.

**(a) The coverage table is NOT built.** Dimension 1 stays a **known-gap screen**
and says so on the screen `[W-7]`. Building the ssa.gov + EU-portable-document
table would put a live compliance dataset under this repository's ownership that
it could neither verify nor keep current, and a stale coverage table is worse
than no coverage table — it converts "we do not know" into "no concern raised",
which is the exact misreading this finding identifies. The honest move is to name
the limit where a reader would otherwise supply the missing half from memory.

**(b) `visaType` is labelled self-declared and unverified on every surface**
`[W-6]` — portal, sidebar, ticket note, dossier.

**(c) A document-presence check is NOT achievable, and the finding's framing was
too generous.** Remote's own `WorkAuthorizationRequest`, fetched live 2026-08-21,
has **no visa field and no permit field**. What it has is `travel_document_number`
— *"The employee's travel document (**passport**) number"* — which is identity
evidence, not permission evidence. So `visaType` did not *replace* a Remote
field; **there is no Remote field it could have replaced.** It is ours entirely,
consistent with `docs/INTAKE-RESEARCH.md` §6.4.

The available half-step is taken instead: **capture `travel_document_number`**
`[W-3]`, display it as what it is, and let **no gate read it** (invariant 12).
Capturing it and then comparing it would be this system performing the
document-presence check it cannot perform, under the name of one it can.

**And the half of this finding that is good news, recorded because a register
that only reports faults teaches its reader to distrust everything equally:**
`will_negotiate_or_sign_contracts` is **Remote's own field**, with Remote's own
note — *"This may affect the type of work authorization required."* One of the
seven factors is literally Remote's, independently justified by Remote. The
seven-factor model is not an invention throughout; it is two-thirds sourced and
one-third declared, and now says which is which.

---

### SPEC_DRIFT · DRIFT-018 · An employee cannot file the request this use case is named after

**Original/documented behaviour:** Remote's own OpenAPI describes a
`WorkAuthorizationRequest` as *"submitted by an employee who needs authorization
to work in a different country"*, and `pending` means *"awaiting manager
review"* [CONFIRMED — schema]. §1's actor row reads *"Employee (via Remote's own
UI) → Mobility specialist"*.
**Current implementation:** the portal's UC-04 form refuses a non-admin persona
with `403 persona_cannot_request`, and the identity gate compares
`session.companyId` to the employment's company — so an employee session can only
ever produce `identity_not_verified`.
**Current tests assume:** the admin-filed model.
**Difference:** the built form is **the employer's assessment stage**, not the
employee's filing. Both are legitimate objects; they are different objects. The
spec's actor row describes the employee filing in *Remote's* UI and this
automation reacting — which is coherent — but the portal presents the same
activity to an employee and refuses them.
**Evidence:** `src/portal/server.js` ~2650–2700; `docs/UI-AUDIENCES.md:305`;
`docs/REMOTE-VOCABULARY.md` §13.1.
**Likely reason:** the identity gate was modelled on UC-06's company-admin shape.
**Risk if left as-is:** an employee arriving from a travel request (the one built
cross-UC route) is silently switched to an admin persona to proceed. That is a
real identity discontinuity in the middle of a hand-off.
**Recommendation:** HUMAN_DECISION_REQUIRED — this is a product decision, not a
bug. Either (a) keep admin-filing and say so plainly on the form and in the
continuation, or (b) add an employee-filing path that creates the *request* and
leaves the assessment to the admin, matching Remote's own object model.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · option (b), the owner's call: build the employee
path.** `DECIDED · NOT YET BUILT`.

*"for demo sake, let there be employee ui, and separate employee or admin ui, so
that we can visually simulate the process."*

**Both halves ship, and the order matters.** `[W-5]` relabels the admin form
**before** `[W-4]` adds the employee surface. Today that form is titled
*"Request permission to work from another country"* — the employee's own
sentence, on a form that answers an employee with `403 persona_cannot_request`.
Shipping the employee UI while that title stands would leave two surfaces
claiming to be the same thing, and the demo would teach the confusion instead of
resolving it.

**The constraint that shapes `[W-4]`, and why it is not a re-introduction.**
`src/remote/mockServer.js:3720` refuses `POST /v1/work-authorization-requests`
and answers with Remote's bare `"Not Found"`, above a comment that says why: that
`POST` was fabricated once, the fixtures were written to agree with it, and the
suite then agreed with both. It must stay refused.

The resolution is a distinction Remote's own product makes: **Remote's Request
Hub genuinely does create these** — it is where an employee files. What Remote
does not offer is a **partner-API** create. So the stand-in stands in for the
*product* surface and seeds **in-process only**; the wire route keeps answering
`Not Found`, asserted structurally (§16 item 11). A stand-in that blurred those
two would be the fabricated create wearing a demo's clothes.

**This decision rests on one already taken.** `G-A` (DRIFT-078, third pass)
accepts *an employee filing for themselves, or an admin whose company matches*.
Without it the employee surface would file and then be refused by the system's
own identity gate — so `G-A` is a **prerequisite of `[W-4]`**, not a neighbour.

**Confidence:** HIGH that this is buildable. **LOW** on whether the one-click
path can be shown against the **real** Sandbox: §18 Step 0's measurement **M-1**
asks whether any `pending` work-authorization requests exist there at all. If
none do, `requestLink` downgrades every `ready_for_approval` to `escalate` and
the stand-in is carrying more of the demo than planned. That is measured before
Step 3, not discovered during it.

---

### SPEC_DRIFT · DRIFT-019 · "No duration threshold, anywhere" versus a live Schengen calculation

**Original/documented behaviour:** §7, emphatically — *"**No duration threshold,
anywhere.** Confirmed wrong by every primary source checked."*
**Current implementation:** `schengen_90_180_exceeded` is a **hard block**, and
cumulative presence feeds the risk matrix.
**Current tests assume:** the Schengen block.
**Difference:** arguably none in substance — §7's target was a *PE-risk
administrative day cap*, and Schengen 90/180 is a statutory immigration limit, a
different thing. But the sentence as written is absolute, and a reader applying it
literally would remove a correct control.
**Evidence:** `UC-04.md` §7; `src/uc04/riskMatrix.js`;
`docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` C-1.
**Likely reason:** §7 was written against PE research; the Schengen gate came from
the statutory corpus later.
**Risk if left as-is:** low, but it is a live contradiction between a spec's most
emphatic sentence and a hard-block gate, and it is what DRIFT-013 (UC-03's 30-day
cap) cites in its own defence.
**Recommendation:** RECONCILE — narrow §7's sentence to "no *invented*
administrative duration cap; statutory limits with a named source are gates."
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `RECONCILE`, as recommended.**
`DECIDED · NOT YET BUILT`.

§7's sentence narrows to: **"no *invented* administrative duration cap; a
statutory limit with a named source is a gate."** The Schengen 90/180 block stays
exactly as it is.

The reason this is worth the edit rather than a shrug: the sentence as written is
absolute and emphatic — *"**No duration threshold, anywhere.** Confirmed wrong by
every primary source checked"* — and a reader applying it literally would delete
a correct statutory control sourced to Reg. (EU) 2016/399 art. 6(1) via D-07.
DRIFT-013 already cites this sentence in its own defence, so it is load-bearing
in a second contract. A spec's most emphatic line contradicting a live gate is a
trap set for whoever reads it next.

---

### SPEC_DRIFT · DRIFT-020 · An approval never expires, and a trip start date never lapses

**Original/documented behaviour:** not addressed anywhere in §8 or §9.
**Current implementation:** no expiry, no reminder, no lapse. A case approved
today is still approved when its start date passes.
**Current tests assume:** no expiry.
**Difference:** the spec is silent, so this is a gap rather than a contradiction —
but the gate itself checks `start_in_past`, so the system already holds the
opinion that a past start date is invalid **at decision time** and holds no
opinion **at approval time**.
**Evidence:** `src/uc04/policyEngine.js` (`start_in_past`);
`src/uc04/approvalPolicy.js` (no time dimension).
**Likely reason:** never specified.
**Risk if left as-is:** a stale approval executes a `PATCH` for a trip that has
already begun or ended.
**Recommendation:** HUMAN_DECISION_REQUIRED — the freshness re-check re-reads the
employment; whether it should also re-check the dates is a policy call.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · re-check the dates at approval time.**
`DECIDED · NOT YET BUILT`. `[W-2]`

The freshness re-check already re-reads the employment before the write, on the
principle that a gate answered "is this employee active?" when the ticket arrived
and approval can be days later. **The dates are the same question and were not
being asked.**

The argument that settles it is internal consistency rather than a new policy:
the decision gate already refuses `start_in_past`, so this system **already holds
the opinion** that a past start date is invalid — it just held no opinion at the
only moment that produces a `PATCH`. A stale approval executing a trip that has
already begun is not a new risk the check invents; it is the existing rule
failing to apply at the second point it obviously should.

Refuse-only and additive, in the shape `approverEntitlement.js` established:
there is no return value meaning "approved", so no call site can be written that
lets it fill a slot or lower a floor. It refuses by its own name — naming the
**date**, not the employment, because "this employment is no longer valid" for a
date problem sends a specialist to look at the wrong record.

---

### SPEC_DRIFT · DRIFT-021 · UC-04 has no outbound route, in a system where its findings imply two

**Original/documented behaviour:** none — §5 terminates at approve/escalate.
**Current implementation:** the same.
**Current tests assume:** the same.
**Difference:** UC-04 routinely computes exactly the two findings that define its
sibling use cases — accumulated presence crossing a threshold (**UC-08**) and
signals that a trip is really a move (**UC-07**) — and has nowhere to send either.
Both escalate to a mobility queue instead.
**Evidence:** `src/uc04/riskMatrix.js`; `UC-07.md` §5 and `UC-08.md` §5 both expect
inbound routing that does not exist.
**Likely reason:** never specified.
**Risk if left as-is:** a tax exposure discovered here reaches a mobility
specialist, not Tax Operations, and the mandatory tax disclaimer never applies.
**Recommendation:** HUMAN_DECISION_REQUIRED, and it should be decided together
with DRIFT-011 as one routing decision rather than four.
**Confidence:** MEDIUM

**DISPOSITION — 2026-08-21 · split.** `DECIDED · NOT YET BUILT`.

**The routing stays HUMAN_DECISION_REQUIRED and no route is built.** The finding
already says it should be settled together with DRIFT-011 as one routing
decision; deciding it from inside UC-04 would set cross-UC policy from the wrong
end, which is the same objection §17c raises about the three cross-cutting
findings sitting on UC-03.

**But the cheap half is taken now** `[W-9]`: when the matrix computes a
presence-threshold crossing or a signal that the trip is really a move, **the
escalation names the finding and the team that would own it.** No cross-UC
record is created, in either direction.

The distinction is the same one this repository has paid for repeatedly — the
difference between an outcome and the reason printed beside it. A mobility
specialist reading *"escalated — high risk pair"* on a case whose real content is
a tax-residency threshold has been handed the right ticket with the wrong
question on it. Naming the finding costs a sentence and changes which human reads
it properly; building the route is a week and changes which queue it lands in.

---

## 17b. Findings opened BY the decisions — 2026-08-21

Five, and **not one came from reading more code.** Three came from fetching
Remote's own OpenAPI in order to honour DRIFT-017's *"be true to Remote's
documentation"*; two came from following a disposition far enough to see what it
did not cover. That is the same pattern the fifth pass recorded on UC-02, and it
is now twice in a row — **the productive move is to check the disposition against
the product, not against the source tree.**

---

### SPEC_DRIFT · DRIFT-089 · The employee is told nothing in three of four outcomes

**Original/documented behaviour:** not addressed. §1's actor row names the
employee as the person who wants the authorisation and the spec never returns to
them.
**Current implementation:** exactly one outcome reaches them. A **decline on a
linked Remote request** `PATCH`es `declined_by_manager` with the reason Remote's
schema requires, and Remote emits `work_authorization.declined_by_manager` into
the Request Hub where they filed. **`blocked` touches Remote not at all**
(invariant 3), **`escalate` writes nothing**, and a portal filing with no
linkable request has nothing to `PATCH`. In all three the employee's request sits
`pending` at Remote indefinitely while a decision about it exists in our store.
**Current tests assume:** the decline transmission only.
**Difference:** the person whose travel is the subject is, in the majority of
outcomes, the only participant who learns nothing.
**Evidence:** `src/uc04/workflow.js:478–497` (the decline, correct); `:159–163`
and `:227` (blocked touches Remote not at all); `src/uc04/approvalPolicy.js:228`
(*"the escalation is worked on its own ticket"*).
**Likely reason:** a direct consequence of the admin-filing model in DRIFT-018 —
the admin files, so the admin gets the answer, and nothing in the design ever
needed a second recipient.
**Risk if left as-is:** an employee plans, books or cancels a trip against a
request that is silently dead. Worse for a `blocked`, where the answer is
**final** and there is no appeal route anywhere in this system.
**Recommendation:** `[W-4]` makes the two transmitted outcomes **visible on a
surface the employee owns**, which is what makes them demonstrable rather than
merely true. It does **not** close this finding. The remaining question is a
product decision and is stated rather than assumed: **there is no Remote
transition that expresses "we refused this before asking you"** — `cancelled` is
glossed *"Cancelled by the employee"* and taking it would put words in their
mouth. So the choice is between a Zendesk-side notification, a Request Hub
annotation with no API behind it, and leaving it. **Do not decide it under
deadline.**
**Confidence:** HIGH on the finding. MEDIUM on the remedy.

---

### SPEC_DRIFT · DRIFT-090 · Every travel history in this system was typed by somebody, and no screen says so

**Original/documented behaviour:** §5's dimension 3 is *"cumulative days in a
rolling 12-month window"*, phrased as a measurement.
**Current implementation:** a measurement over **supplied input**. Verified
2026-08-21: **neither `WorkAuthorizationRequest` nor the employment record
carries a travel-history field**, so there is nothing to retrieve from Remote and
nothing to reconcile against. All fourteen UC-04 quick-fills manufacture it
(`uc04-h1-country`, `uc04-h1-startDate`, …).
**Current tests assume:** supplied input, correctly.
**Difference:** none in behaviour. The gap is that a specialist reading *"90 of
90 — 0 days of headroom"* is reading a confident, precise, **entirely
self-reported** figure, and nothing on the screen distinguishes it from a count
taken from a record.
**Evidence:** `src/uc04/riskMatrix.js` `computeCumulativeDays()`;
`src/portal/assets/app.js` scenarios `uc04-history-*`; the fetched schema.
**Likely reason:** never specified, because the spec assumed a source that does
not exist.
**Risk if left as-is:** this is the same shape as DRIFT-017's dimension 1 — a
figure whose provenance the reader supplies from memory, and memory says
"the system counted it". A Schengen block is a **hard stop**; being wrong about
its input is being wrong in the direction nobody investigates.
**Recommendation:** `[W-8]`. State it on the screen, in §14's mandatory-absence
list beside nationality. **Do not** attempt to source it — Remote does not hold
it and inventing a source would be worse than naming the absence.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-091 · An escalation has no lifecycle

**Original/documented behaviour:** §5 terminates at *"escalate to Mobility/Legal
Tier-2, stronger safe-escalation treatment"*. What happens next is not addressed
anywhere in the spec.
**Current implementation:** the ticket is tagged `escalation_mobility_legal_t2`
and assigned to **Mobility & Legal (Tier-2)** (`6168394286495`), and that is the
end of this system's involvement. `describeNoApprovalPath()` states it plainly —
*"It has no approve/decline path here; the escalation is worked on its own
ticket."* **No SLA, no reminder, no re-entry, no return path, and no mechanism
by which this system ever learns what Tier-2 decided.**
**Current tests assume:** the same.
**Difference:** a gap, not a contradiction — but the metrics layer depends on it.
`docs/METRICS.md`'s specialist-accept-rate cannot see an escalation's outcome, so
the one measurement that would say whether escalating was the right call is
structurally unavailable for the decisions that escalate.
**Evidence:** `src/uc04/approvalPolicy.js:228`; `src/shared/escalationRouting.js`
`"UC-04"`; `CLAUDE.md` §7 items 10–11, which record the same shape on UC-03 and
UC-07/08.
**Likely reason:** never specified, on any of the nine.
**Risk if left as-is:** ticket #51 is the worked example and it is still true —
raised while its owning group did not exist, sitting in `Support`, and the group
being created later retro-assigned nothing.
**Recommendation:** this is **cross-cutting, not UC-04's to settle** — the same
absence exists on UC-03, UC-05, UC-07 and UC-08. Record it here, decide it once,
alongside DRIFT-021 and DRIFT-011. Building an SLA into one use case would set
policy for the other four by accident.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-092 · A required field on Remote's real object is not collected anywhere

**Original/documented behaviour:** §5's dimension 4 is an *"immigration-
authorisation document on file"* check.
**Current implementation:** seven factors, none of which is a document, and a
declared `visaType` standing in for one.
**Difference:** Remote's object carries **`travel_document_number`** — listed in
its `required` array, described as *"The employee's travel document (**passport**)
number"* — and this system neither collects it, displays it, nor mentions it.
It is the closest thing to dimension 4 that exists on the wire.
**Evidence:** `get_v1_work-authorization-requests_id.md`, fetched 2026-08-21;
`src/uc04/policyEngine.js` `factorValidationIssues` (seven factors, no document).
**Likely reason:** the factor list was derived from the risk matrix's inputs
rather than from Remote's object, so a field no gate needed was never noticed.
**Risk if left as-is:** low on its own. It matters because it is the only
available **half-step** on dimension 4, and its absence makes "we cannot check a
document" sound more absolute than it is — Remote does capture *a* document
reference, just not one that proves permission.
**Recommendation:** `[W-3]`. Capture and display it as **identity evidence, never
permission evidence**, and let **no gate read it** (invariant 12). A passport
number proves who somebody is and proves nothing about what they may do;
comparing it would be this system performing the check it has just finished
explaining it cannot perform.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-093 · §15 promised an outcome Remote's API cannot produce

**Original/documented behaviour:** §15 read *"An employee is **authorised** to
work from another country"*, and the owner's own question — *"why can't this just
be autoprocessed and authorization document provided and given to the person"* —
reads it exactly that way. So did this contract.
**Current implementation:** the lifecycle terminates in a **status**.
**Difference:** verified 2026-08-21 against both objects — **neither
`WorkAuthorizationRequest` nor `TravelLetterRequest` carries a file, URL or
document field.** Not even the one that is a letter by name. The terminal state
is `approved_by_remote`, glossed *"Fully approved by both manager and Remote"*.
If Remote produces a document it is produced inside their product, with no
endpoint to fetch it and no field pointing at one.
**Evidence:** the two fetched schemas, field lists transcribed in full;
`docs/REMOTE-API-INDEX.txt` (no travel/workation guide page exists).
**Likely reason:** *authorization* names both a permission and the paper that
evidences one, and the spec used the word without choosing.
**Risk if left as-is:** a demo that promises the document fails on camera, and a
reviewer who asks "so where is the letter?" gets a worse answer than "Remote does
not expose one" — they get a silence that reads as an unbuilt feature.
**Recommendation:** corrected in §15 **in this revision**, and kept as a finding
so the correction is not later mistaken for something that was always understood.
Note the useful contrast: **UC-03's travel support letter IS a document this
system produces**, because a letter stating facts we hold is a different object
from a permission we are not granting. That distinction is the tier boundary
between UC-03 and UC-04, and it is worth stating out loud on both screens.
**Confidence:** HIGH

---

## 18. BUILD QUEUE

The second build queue in the register, after `UC-02-acceptance.md` §18, and the
same shape: ordered steps, each naming its **files**, its **tests** and its
**done-criterion**; a *what must NOT change* list; and the dependencies that are
load-bearing rather than tidy called out separately.

**Standing rules for every step below.**

- **Update the status lines in the same unit of work as the step**, never batched
  at the end. `CLAUDE.md`'s continuity rule exists because this project has twice
  had an issue open in one status file and closed in another on the same day.
- **A gate exists twice.** `workflows/nodes-uc04/workationGates.js` is the n8n
  port, held by `test/n8nUc04Parity.test.js`. A half-done change fails parity; a
  done one is still not live until graph `WORKFLOW_UC04_ID` is republished and
  **`versionId === activeVersionId`** is verified. A REST `PUT` publishes in
  place; the MCP `update_workflow` writes only a draft (`CLAUDE.md` §6).
- **A pinned n8n node reports success having done nothing.** Check the
  destination table, never the run status.
- **`npm test` currently runs 225 UC-04 tests across 10 files.** An `EADDRINUSE`
  in `TEST_BAND` is an environment collision, not a regression — read the
  `failureType` before quoting a failure count.

---

### Step 0 — Three measurements, before any code

Not code changes, and **two of them can change the plan.**

| | Measure | Why it could change the plan |
|---|---|---|
| **M-1** | Does the **live Sandbox hold any `work_authorization_requests` at all** for the demo employments? `listWorkAuthorizations({employmentId, status: "pending"})` across the ten personas in `src/portal/personas.js` | If it returns zero everywhere, `requestLink` downgrades **every** `ready_for_approval` to `escalate`, and the one-click path **cannot be demonstrated against the real Sandbox at all** — only against the stand-in. That changes what Step 3 is carrying and what §16 can honestly demand |
| **M-2** | How many `uc04_authorizations` rows are `blocked` with `us_requires_work_permit` where the declared visa was `business_visa` | C-26's live false-refusal count. Zero ⇒ `W-1` is a correctness fix with no backlog. Non-zero ⇒ real requests were wrongly refused and somebody must decide whether they are revisited |
| **M-3** | Decision mix across all `uc04_authorizations` — `ready_for_approval` / `escalate` / `blocked` | If nearly everything escalates, the dimension-1 known-gap screen (`W-7`) is the headline of this queue rather than a footnote |

**Done when:** all three are numbers written into this section with the date
taken. `pg` cannot reach Supabase from a container behind an HTTP CONNECT proxy,
so M-2/M-3 need the Supabase MCP or a live session.

---

### Step 1 — `W-5` · Relabel the admin form

**Must precede Step 2.**

- **Files:** `src/portal/requestTypes.js` (the `uc04` entry's `title`,
  `description`, `humanControl`), `src/portal/assets/index.html` (UC-04 card copy)
- **Today:** `title: "Request permission to work from another country"` — the
  employee's own sentence, on the form that answers an employee with
  `403 persona_cannot_request` (`src/portal/server.js:2667`)
- **Tests:** `test/portalCopy.test.js`, `test/uc04Portal.test.js`
- **Done when:** the form names itself the **employer's assessment of a request
  the employee already filed**, and says where the employee filed it

---

### Step 2 — `W-4` · The Request Hub stand-in

The employee surface. **Port 4048** (4045 is browser-blocked, 4046/4047 taken);
companion Remote mock **4088**, inside `SEED_MOCK_BAND` (4070–4089).
`npm run requesthub`.

- **Files:** new `src/requesthub/{server,cli,roles}.js` + `assets/`;
  `src/shared/ports.js`; `package.json`
- **Pattern to copy:** `src/remoteui/roles.js` — the role is chosen **server-side**
  from a session header, never a role claim in the body
- **Seeding:** **in-process only.** `POST /v1/work-authorization-requests` over
  the wire keeps answering Remote's bare `"Not Found"` string
- **Prerequisite:** `G-A` (DRIFT-078) — the identity gate must accept an employee
  filing for themselves, or the surface files and is then refused by our own check
- **Tests:** new `test/requesthub.test.js`; a **structural** test that no HTTP
  path in `src/remote/mockServer.js` creates a work-authorization request;
  `test/ports.test.js` passes unchanged; the browser asset compiles under
  `node:vm` with no `innerHTML` and no re-derived policy, like every other asset
- **Done when:** employee files → sees `pending` → admin assesses on the portal →
  specialist decides in the sidebar → **the employee's own screen shows
  `approved_by_manager`, or `declined_by_manager` with the reason**

That last clause is the point of the step. It is DRIFT-089's two answerable rows
made visible instead of documented.

---

### Step 3 — `W-10` · One spelling of the escalation team

- **Files:** `src/uc04/{decisionFacts,decisionSources,requestLink,server}.js`
- **Rule:** the name comes from `src/shared/escalationRouting.js`. A fifth
  hand-typed spelling is the same defect with a different string
- **Tests:** `test/uc04RefusalWords.test.js` gains a check that no UC-04 module
  spells a team name literally
- **Done when:** grepping `src/uc04/` for "Mobility Legal Tier-2", "a Mobility
  Legal reviewer" and "a Mobility Legal specialist" returns nothing

---

### Step 4 — `W-6` + `W-7` + `W-8` · The three statements of limit

One pass — they touch the same describers, and splitting them would mean three
reviews of one file.

- **Files:** `src/uc04/decisionFacts.js`, `src/uc04/decisionSources.js`,
  `zaf-app/assets/panels.js`, the portal result copy, the ticket note builder
- **Tests:** `test/uc04DecisionSources.test.js`,
  `test/portalRequesterFacts.test.js` — each of the three assertable, so none can
  be removed silently
- **Done when:** all three appear on the specialist's screen **and** in the ticket
  note, joining nationality and the wrong-country warning as §14's five mandatory
  statements of absence

---

### Step 5 — `W-3` · Capture the passport number

- **Files:** `src/uc04/policyEngine.js` (carry, never compare),
  `src/uc04/decisionFacts.js`, the Request Hub form, the admin form
- **Tests:** `test/uc04.test.js` — a **structural** assertion that no gate reads
  it, plus a behavioural one that the same case decides identically with the
  field present and absent
- **Done when:** it displays as identity evidence, never permission evidence, and
  invariant 12 is pinned rather than asserted in prose

---

### Step 6 — `W-2` · Approval-time date re-check

- **Files:** `src/uc04/approvalPolicy.js`, `src/uc04/workflow.js`,
  `workflows/nodes-uc04/workationGates.js`
- **Shape:** refuse-only and additive, following `src/review/approverEntitlement.js`
  — no return value means "approved", so no call site can be written that lets it
  fill a slot or lower a floor
- **Tests:** `test/uc04.test.js`, `test/n8nUc04Parity.test.js`
- **Deploy:** republish `WORKFLOW_UC04_ID`; verify `versionId === activeVersionId`
- **Done when:** a case approved after its start date has passed refuses **by its
  own name**, and the refusal names the **date** rather than the employment — a
  date problem reported as an employment problem sends a specialist to the wrong
  record

---

### Step 7 — `W-1` · `business_visa` to the US stops blocking outright

**The positive test leads. This is the only step in the queue that loosens a
control.**

- **Order within the step:** write the failing positive test → change
  `src/uc04/riskMatrix.js` → port to `workflows/nodes-uc04/workationGates.js` →
  parity → republish → verify
- **Behaviour:** `business_visa` + US → **`escalate`**, not `blocked`, because the
  operative test is local employment vs. business activity and who pays, and
  neither is a fact this system holds. **`esta_usa`, `tourist_visa`,
  `digital_nomad_visa` and `other` keep blocking.**
- **Also in this step:** correct the `VISA_TYPES.esta_usa` comment. *"tourist, NOT
  work"* describes a **narrower** permission than CBP grants — ESTA carries what a
  visitor (B) visa carries, business included, capped at 90 days (C-26,
  consequence 2)
- **Tests, all four, in one suite:** `business_visa`→US escalates ·
  `tourist_visa`→US still blocks · `esta_usa`→US still blocks · `work_permit`→US
  still clears
- **Done when:** all four pass, parity holds, the deployed graph is verified
  current, and `docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` C-26 carries
  the commit that acted on it — the corpus's own rule is that a finding is a work
  order with its own tests, never a number swapped inside an unrelated commit

**Why the positive test is not optional here.** This repository's most expensive
recurring defect is that a gate which **cannot fire** and a gate **being careful**
are indistinguishable from outside. UC-03's alpha-3 comparison, UC-03's
unnameable sanctions codes and UC-06's dead payroll URL were each invisible for
exactly this reason, and each passed the full suite. A negative-only suite would
pass whether `W-1` landed correctly, landed inverted, or did not land at all.

---

### Step 8 — `W-9` · The escalation names the finding

- **Files:** `src/uc04/decisionFacts.js`, the ticket-note builder
- **Not built:** any route. DRIFT-021 stays HUMAN_DECISION_REQUIRED, to be
  settled with DRIFT-011 as one routing decision
- **Done when:** the ticket names the computed finding (presence threshold /
  relocation signal) and the team that would own it, and **no cross-UC record is
  created in either direction**

---

### Step 9 — Reconciliation

`docs/use-cases/UC-04.md` §15, `qa/SPEC-DRIFT-INDEX.md` counts,
`docs/BUILD-LOG.md`, `CLAUDE.md` §4/§5/§7. **This is the final reconciliation,
not the first time any of it is written** — each step above already updated its
own status line.

---

### Dependencies that are load-bearing

1. **Step 1 before Step 2.** Two surfaces claiming to be the same thing teaches
   the confusion rather than resolving it.
2. **Step 7's positive test before Step 7's code.** It is the only thing that can
   detect a wrongly-loosened gate.
3. **M-1 before Step 2.** If the Sandbox holds no `pending` requests, the stand-in
   is carrying more of the demo than planned and §16 must say so rather than
   implying a Sandbox proof it cannot give.
4. **`G-A` (DRIFT-078) before Step 2.** Not a UC-04 change, and Step 2 does not
   work without it.
5. **Steps 6 and 7 both republish n8n.** Neither is done at the commit; both are
   done at the verified `activeVersionId`.

### What must NOT change

1. **No `POST` on work-authorization-requests** — not in `src/remote/restClient.js`,
   not in `src/remote/mockServer.js`, not over any wire, not from the stand-in.
   Guarded structurally, because a method that refuses is one edit from being
   called and a method that does not exist has no such edit.
2. **No auto-execute path.** Every case reaches a human at every risk score.
3. **The sanctions screen stays in first position**, and `blocked` still touches
   Remote not at all.
4. **`will_negotiate_or_sign_contracts` is untouched.** It is Remote's own field
   with Remote's own rationale, and the strongest vindication the seven-factor
   model has.
5. **No coverage table is built.** Dimension 1 stays a known-gap screen, with the
   gap stated on the screen.
6. **No cross-UC route** to UC-07 or UC-08.
7. **`escalate` never becomes `ready_for_approval`.** The downgrade is
   one-directional and stays that way.
8. **`travel_document_number` never reaches a gate.**

### One question this queue does not answer for itself

**DRIFT-089's remaining three rows.** `W-4` shows the employee the two outcomes
that are already transmitted; it does not decide whether a `blocked` or an
`escalate` should reach them at all. The obstacle is stated rather than assumed:
**Remote has no transition meaning "we refused this before asking you."**
`cancelled` is glossed *"Cancelled by the employee"*, so using it would put words
in their mouth and corrupt the one field a later reader would trust.

Three options, with the recommendation named:

| | Option | Consequence |
|---|---|---|
| **a** | **Zendesk-side notification to the employee** *(recommended)* | Uses a channel that already exists and already has the employee's address. Does not touch the Remote record, so nothing false is written to it |
| **b** | Annotate the Request Hub stand-in only | Honest in the demo, **zero effect in production** — the stand-in is not where a real employee looks |
| **c** | Leave it, and say so on the admin's screen: *"you must tell them"* | Cheapest, and at least stops the admin assuming the employee was notified. It is a workflow instruction, not a fix |

**The option to refuse is using `cancelled`.** Writing a status that attributes
our refusal to the employee is worse than the silence it replaces.
