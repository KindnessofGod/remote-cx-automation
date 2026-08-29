# UC-05 — Canonical Acceptance Contract

> **Offboarding & Resignation Notice Period Calculation · 🟡 Medium tier · Remote-native webhook intake (specified) — Zendesk ticket + portal (built)**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-05.md` (§0–§17, including §7a and
> §15a–§15d),
> `src/uc05/{policyEngine,workflow,noticePeriodTable,noticePeriodCalculator,ptoPayout,signoffPolicy,letterExtractor,decisionFacts,decisionSources,resignationStore,server}.js`,
> `src/remote/leaveBalances.js`, `src/remote/restClient.js`,
> `workflows/nodes-uc05/{normalizeResignationRequest,noticePeriodGates}.js`,
> `test/uc05.test.js`, `test/uc05NoticeCountries.test.js`,
> `test/uc05TimeOff.test.js`, `test/uc05Server.test.js`,
> `test/uc05DecisionSources.test.js`, `test/n8nUc05Parity.test.js`,
> `test/portalUc05Success.test.js`, `src/portal/server.js`,
> `src/shared/escalationRouting.js`, `src/approvalqueue/approvalRoutes.js`,
> `zaf-app/assets/panels.js`, and all three raw research packs (v1 Research Plan,
> V2 Research Specification, CHATGOT Build Specification).
>
> **Intended business truth.** §17 records the divergences. No code, test or
> document outside this file was changed to produce it.

---

## Decisions taken — 2026-08-21 (seventh pass)

**Nine findings dispositioned with the owner. Two product decisions were taken
that change what this use case *is*, not how it behaves.** Every not-yet-true
sentence added to §1–§16 below is tagged `[N-n]` and points at §18's build
queue, so a reader can tell a description from a promise. **No code, test or
workflow was changed to produce this pass.**

### The four finding states

| State | Meaning |
|---|---|
| `DECIDED · BUILT` | The disposition is already true of the tree. |
| `DECIDED · NOT YET BUILT` | The call is made; the drift is **still live in the code**. Most rows are here. |
| `DECIDED · NOTHING TO BUILD` | Resolved by a wording or scoping change, no behaviour moves. |
| `OPEN` | Not dispositioned. |

### The two decisions that change the use case

**1 · Remote already computes the notice period. The product is the
disagreement, not the number.** Fetched live 2026-08-21 from Remote's own
OpenAPI: `days_of_notice` is *"The number of calendar days of notice required
**based on the contract terms and local labor laws**"*, and `proposed_last_day`
is *"calculated based on the notice period and local labor laws."*

§0 of `UC-05.md` says Remote *"performs no computation of what the legally
correct notice period should be — that gap is the actual value-add."* That does
not survive those two sentences. What survives is sharper: `days_of_notice`
blends **contract** and **statute**, and nothing in the description says which
wins when they disagree. A contract can name 30 days where the statute requires
60. **The valuable output is an independent statute-derived figure held against
Remote's blended one, with the disagreement surfaced before an employer answers
`accepts_proposed_notice`.** `[N-5]`

**2 · The employee sees nothing until sign-off.** The owner's ruling, verbatim:
*"the employee should just see the final output after everything has been
concluded and signed off internally by the specialist."* Today the portal
returns the statutory line, the rule, the tenure, the comparison and the payout
to the resigning employee **at submission**, which is the ordering §8 exists to
prevent. `[N-14]` `[N-15]`

### Two questions the owner asked, and their answers

**"Do we have a contract for the demo? Who creates one?"** — **Nobody creates
one, and none is fetched.** "Contract" is two things and neither is reachable
as an artifact: the API index carries a contract-document **create** for
*contractors only* (`POST /v1/contractors/employments/{id}/contract-documents`,
`document:write`) and **no read endpoint anywhere for an EOR employment
agreement**; and whether the per-country `contract_details` form carries a
notice-period property is `[UNKNOWN]` — form schemas need a company token, and
nothing in this repository has ever captured that form's property list, only its
`allOf` count. **The decision is to read `days_of_notice` and not go looking**,
because Remote has already folded the contract term into it. One consequence is
recorded so it is not rediscovered: probing `contract_details` was a candidate
Step 0 measurement and **has been dropped** by this decision.

> **The line that must hold.** A contract *document* must never be manufactured
> and presented as Remote data. For a US resignation the contract **is** the
> operative source, so a fabricated one does not fabricate a fixture — it
> fabricates the answer. This is the fixtures-agreeing-with-the-code failure
> named in `CLAUDE.md` §4, at the one place where it would be least visible.

**"How do we get the labour law for the US?"** — **There is nothing further to
retrieve, and that is the finding rather than a gap.** No federal statute
imposes notice on a *resigning employee*; US employment is at-will by default.
WARN (D-06) runs the other way — 60 days, employers of 100+, mass layoffs of
50+ — and delimits the federal field without creating an employee duty. State
mini-WARN statutes are employer-side too. **`[INFERRED — argument from scope]`
is therefore the correct tag, not a weak one**: a negative cannot be upgraded to
`[CONFIRMED]` by retrieving one more document, which is what "argument from
scope" means. The decision is to **bound the claim** rather than chase it
`[N-8]`, and to let `days_of_notice` be the operative figure for the US, since
the contract governs there. **The US keeps refusing to compute.** `[N-8]` is
wording and scope only.

### The changes, by group

| | Change | Findings |
|---|---|---|
| **N-1** | Correct the record before building on it — the endpoints are documented and live | DRIFT-063 |
| **N-2** | Read the resignation record (`getResignation`, `getResignationLetter`) | DRIFT-022, DRIFT-096 |
| **N-3** | Remote-native intake: `offboarding.submitted` + type filter + poll fallback; the portal and Zendesk doors relabelled **stand-ins** | DRIFT-022, DRIFT-094 |
| **N-4** | Provenance on the date — **stated** vs `[CONFIRMED]`, on every surface | DRIFT-022 |
| **N-5** | **Reconcile** Remote's `days_of_notice` against the statute figure | DRIFT-063, DRIFT-095 |
| **N-6** | Invariant: our figure never stands alone when Remote supplied one | DRIFT-095 |
| **N-7** | Canada → sourced absence; demo matrix regenerated in the same commit | DRIFT-023 |
| **N-8** | Bound the US claim (wording and scope; behaviour unchanged) | DRIFT-023 |
| **N-9** | Reframe the notice table as a **sourced cross-check**, not an engine | DRIFT-023, DRIFT-066 |
| **N-10** | Prefer `seniority_date`; record which field answered | DRIFT-024 |
| **N-11** | Delete the "HR acting with the employee's consent" clause | DRIFT-025 |
| **N-12** | Parity scenarios for the two date classes — **tests first** | DRIFT-026 |
| **N-13** | Fix the n8n date parser; give `unparseable_date` a gate rung | DRIFT-026 |
| **N-14** | The employee sees nothing while `pending_signoff` | DRIFT-064 |
| **N-15** | Sign-off releases the figures; the n8n Zendesk nodes move off decision-time | DRIFT-064 |
| **N-16** | Metrics second source over `audit_log` — **cross-cutting, flagged** | DRIFT-065 |
| **N-17** | Stale prose, and a guard against hard-coded country counts | DRIFT-066 |
| **N-18** | Refuse a resignation dated before the start date instead of clamping tenure to zero | DRIFT-097 |

> **The queue was seventeen items when it was agreed and is eighteen now.**
> `N-18` was opened by *writing this contract*: Remote's separate
> before-start-date variant prompted a read of `tenureMonthsBetween()`, which
> ends `Math.max(0, months)` and therefore answers **zero** for a future start
> date rather than refusing. It is recorded as growth rather than folded in
> silently, for the same reason the fifth and sixth passes recorded theirs — a
> queue that only ever shrinks means nobody is checking it against the code.

**The scheme is `N-1`…`N-17`, and it corresponds to nothing else.** UC-01's are
`G-1`…`G-4`, UC-03's `G-A`…`G-C`, UC-02's `E-1`…`E-3`, UC-04's `W-1`…`W-10`.
**Five schemes, none overlapping** — `CLAUDE.md` §7 item 20 is the reason: this
repository already has two registers both numbering findings `C-N`, with code
citing both.

### What Remote's own documentation settled, fetched live 2026-08-21

Five pages, all HTTP 200, read out of the OpenAPI rather than recalled:
`docs/offboarding-an-employee`, `reference/post_v1_offboardings`,
`reference/get_v1_offboardings`, `reference/offboardingsubmitted-1`, and the two
resignation reference pages already cited by DRIFT-063.

1. **A resignation cannot be created through the partner API.**
   `CreateOffboardingParams.type` is `enum: ["termination"]`, described *"For
   now, only `termination` is allowed."* The guide says the same in prose. This
   is **CREATE-BY-EMPLOYEE, DECIDE-BY-API — the second instance**, after UC-04's
   work-authorization requests. `00-FOUNDATION.md` §2 was right to place UC-05
   in the Remote-native column. `[N-3]` and DRIFT-094.
2. **The webhook does split by type**, which §3 flagged as *"needing
   confirmation at build time"* and nobody confirmed. The `Offboarding` wrapper
   is *"either a termination (employer-initiated) or a resignation
   (employee-initiated)"*, and the resignation variant carries `type` with
   `enum: ["resignation"]`. `GET /v1/offboardings` also has a `type` query
   filter, so §5's documented **poll fallback is available**. `[N-3]`
3. **Remote's model has no file-on-behalf path for a resignation**, stated three
   independent ways: `ResignationOffboarding` is *"An offboarding request
   **initiated by the employee**"*; `requested_by` is *"the UUID of the
   **employee who submitted the resignation**"*; and `type` reads *"Always
   `resignation` for **employee-initiated** resignations."* The employer's role
   exists on the other side of the transaction — `agrees_to_pto_amount` is
   glossed *"Whether the **employer** agrees."* This settles DRIFT-025 against
   the clause. `[N-11]`
4. **Remote publishes three things this use case reconstructs from caller
   input** — the resignation letter (`GET /v1/resignations/{id}/resignation-letter`),
   `paid_timeoffs_breakdown_labels` (Remote's own human-readable PTO breakdown),
   and `contract_probation_period_end_date` + `contract_proabtion_period_passed`.
   `[N-2]` and DRIFT-096.
5. **Remote models a resignation *before* the start date as a distinct
   variant**, `ResignationBeforeStartDateRequestParams`, whose entire validate
   shape is one boolean — `proposed_resignation_accepted`. No notice arithmetic
   applies to it at all. DRIFT-097.

### One thing that was checked rather than assumed

`tenureMonthsBetween()` ends `return Math.max(0, months)`. A start date in the
future therefore **clamps to zero months and selects the shortest statutory
bracket**, indistinguishable from a genuine day-one employee — it does not
refuse. That was read out of `noticePeriodCalculator.js:169–177`, not inferred
from the variant above. DRIFT-097.

## 1. Business purpose

Somebody resigns. Two numbers then have to be right: the last day they must
work, and the money owed for leave they never took. Both are jurisdiction-
specific, both are computed from records the employee cannot see, and both go
onto a document the employee reads as final.

> **This paragraph used to end differently, and the sentence it ended with is
> false.** It read: *"Remote's platform stores the employee's proposed last
> working day and computes nothing about what the law requires — that gap is the
> whole use case."* Remote's resignation record carries `days_of_notice`,
> described by Remote as *"the number of calendar days of notice required based
> on the contract terms and local labor laws"*, and `proposed_last_day`,
> *"calculated based on the notice period and local labor laws."* The gap this
> use case was justified by does not exist as stated. The original wording is
> kept here because five other documents inherited it and a reader tracing them
> needs to recognise it. See DRIFT-063 claim 4 and DRIFT-095.

**The business purpose as decided.** `days_of_notice` blends **contract terms**
and **local labour law**, and Remote's description does not say which prevails
when they disagree — a contract can name 30 days where the statute requires 60.
UC-05 computes an **independent, statute-derived** figure and holds it against
Remote's blended one. The product is the **disagreement**: surfaced to an HR Ops
specialist *before* anyone answers `accepts_proposed_notice`, with both figures
and both provenances on the screen. Where the two agree, the case is cheap and
uncontroversial; where they diverge, this is the only place in the system that
would notice. `[N-5]` `[N-6]`

UC-05 does not offboard anybody, and as built **it writes nothing to Remote**:
the durable artifact is a signed-off report. Every layer of the implementation
states the reason for that as a fact about Remote's API — no `PATCH` or `PUT` on
`/offboardings` of either type, and `POST /offboardings` accepting only
`type: "termination"`.

**The narrow half of that is right and the load-bearing half is wrong.**
`/offboardings` really does carry no update verb. But Remote documents a
separate resignation resource with three endpoints, one of them a write —
`PUT /v1/resignations/{offboarding_request_id}/validate` — whose request body is
shaped almost exactly like this use case's sign-off form. So "no write path"
is a **design choice this project should make deliberately**, not a
consequence of the API's shape, and until it is made deliberately the whole
chain of reasoning beneath it rests on a premise nobody re-checked. See
DRIFT-063.

## 2. Primary operator persona

**Role:** the **employee** resigns. The **operator** is an **HR Ops specialist**
who confirms the calculation. A statutory shortfall goes to a different desk
entirely — **Local HR & Legal**.
**Experience/knowledge:** knows notice periods exist and vary by country, knows
what accrued leave is worth, has signed final settlements before. Not a lawyer,
and not the person who wrote the notice table.
**Typical working context:** a Zendesk ticket with the ZAF sidebar open, days
after the resignation was filed, holding a record id and nothing else.
**They understand:** length of service, probation, a last working day, accrued
and used leave, an hourly rate, and what it means to sign something.
**They DO NOT know:** that a `NOTICE_PERIOD_TABLE` exists or which countries are
in it, what `statutoryMinimumExists: null` versus `false` encodes, that
`noticeDays: 0` is a known-wrong inert field on two branches, what
`earlier_than_statutory` or `not_comparable` are, that money is stored ×100, or
that two of the figures on their screen were read from Remote while a third was
typed into a form by the person resigning.

**What the specialist is actually being asked, as decided.** Not *"is this
number right?"* but *"Remote says N days and the statute we hold says M — which
governs, and what should the last working day be?"* That is a materially
different question and it needs both figures, both provenances and the
disagreement named on the screen. `[N-5]` `[N-6]`

**Three readers, not two.** `docs/UI-AUDIENCES.md`'s rule applies here and the
employee's row changes with this pass:

| Reader | Sees | Decided change |
|---|---|---|
| **Employee** (resigning) | Today: the statutory line, the rule, tenure, the comparison and the payout — **at submission, before any human has looked** | An acknowledgement only, until sign-off releases the figures `[N-14]` `[N-15]` |
| **HR Ops specialist** | The derivation, the gate ladder, the citations, the "what is not known" block | Gains Remote's `days_of_notice` beside our figure, and the reconciliation verdict `[N-5]` |
| **Local HR & Legal** | A shortfall, the statute, the handlings — never a computed answer | Unchanged. `[N-7]` gives Canada a real reason to reach this desk instead of a fabricated number that never does |

## 3. Job to be done

*Employee:* "I have resigned. Tell me the last day I actually have to work and
what I am owed, and do not tell me a number that later turns out to be wrong."
> **Decided:** the second half of that sentence outranks the first. The employee
> is told a calculation is being checked, and gets the figures when they are
> confirmed — never before. `[N-14]`
*HR Ops:* "Show me the derivation, not the verdict — which rule, over which
tenure, producing which date, against which proposal, and what money — so I can
sign it in one screen without opening Remote or a statute."
*Local HR & Legal:* "Tell me what the shortfall is, what the statute says
happens because of it, and what my options are — and do not compute the answer
for me."

## 4. Starting preconditions

- An employment record exists at Remote and is **`active`**. A resignation
  against a terminated record is a record-keeping problem, not a notice problem.
- The record carries a **start date**. Every statutory notice period is measured
  from length of service; without it nothing can be computed. (What actually
  fills this field is a *provisional* start date in preference to the seniority
  date — see DRIFT-024.)
- The employment's country resolves to a **two-letter** code. An alpha-3 code
  becomes `null` rather than a wrong string, and `null` escalates.
- The filer's identity comes from an **authenticated session carrying their own
  employment id** (Node path) or a **Zendesk-authenticated requester email
  matched against the email on the Remote record** (n8n path). Never an address
  in the letter text — a resignation letter is free text an impersonator controls
  end to end.
- **For the PTO figure: an hourly rate supplied with the request**, as an integer
  in Remote's ×100 form. Remote publishes no hourly or daily rate on any endpoint
  this repository has found, so the rate can never be sourced by reading harder.
- The employee's accrued balance is **read from Remote** when the caller supplies
  none (`GET /v1/leave-policies/summary/{employment_id}`); the payout base is
  Remote's own `balance`, never re-derived.
- **For the reconciliation: Remote's own `days_of_notice`**, read from the
  resignation record. It is `required` on Remote's after-start-date variant, so
  it is present whenever the record is. Absent — because the record was not read,
  or the resignation predates the start date — the reconciliation reports
  `not_compared` and says which side was missing, never a silent one-sided
  answer. `[N-2]` `[N-5]`
- **An `offboarding_request_id`**, which is the key the whole resignation family
  is addressed by. **Not a resignation id** — that mistake is how these endpoints
  came to be recorded as non-existent (DRIFT-063), and a wrong id returns a `404`
  indistinguishable from an absent route. `[N-2]`
- **Not required as built:** nothing about a Remote write endpoint. The stated
  reason — that none exists — is false (DRIFT-063); the *requirement* would be
  an `offboarding_request_id` and a token holding `resignation:read` /
  `resignation:write`, neither of which this system obtains today.
- **Not required, and deliberately not sought: a contract.** No contract
  document is fetched and none is manufactured. The API index carries a
  contract-document *create* for **contractors only** and no read route for an
  EOR employment agreement; whether `contract_details` carries a notice-period
  property is `[UNKNOWN]` and was **dropped as a measurement** when the owner
  chose to read `days_of_notice` instead. See the decisions box.

## 5. Main successful journey

1. An employee resigns and states when they intend to leave — in a form, or in
   the words of a resignation letter.
2. The system confirms the person filing is the employee the resignation is
   about.
3. It confirms the employment is still active and that the record says when they
   started.
4. It looks up what that country's law requires of a *resigning employee* — not
   of the employer — and works out the last day the notice period ends, applying
   the country's own calendar rule for where a notice period may end. **This
   figure is one of two.** `[N-5]`
4b. It reads Remote's own `days_of_notice` off the resignation record and holds
   the two against each other, producing one of three verdicts — they agree,
   Remote's is longer, ours is longer — and carrying **both** figures forward
   with **both** provenances. Neither number is presented as *the* notice period
   on its own. `[N-5]` `[N-6]`
5. It compares the governing date against the day the employee proposed. Later
   than the statutory end is fine. Exactly on it is fine.
6. It reads the employee's accrued leave from Remote and turns it into money,
   naming the currency the contract is denominated in.
7. HR Ops opens one screen: who is leaving, from which country, how long they
   have been there, which statute was applied, what date it produces, **what
   Remote's own figure is and whether the two agree**, how the proposal compares,
   what the payout comes to, and what is **not** known. `[N-5]`
8. HR Ops signs it off. That signature is the outcome. **Nothing is filed with
   Remote, nobody is terminated, and no part of this system ends an employment.**
   *(Remote has an endpoint that records exactly this confirmation against the
   resignation itself — `accepts_proposed_notice`, `agrees_to_pto_amount`, a
   counter-proposed last day. Whether the signature should also travel there is
   DRIFT-063, and it is a product decision, not a bug.)*

9. **The employee is told.** Until this point they have seen an acknowledgement
   and no figures. Sign-off releases the confirmed figures to the surface they
   submitted from, and to the ticket where one exists. `[N-14]` `[N-15]`

**On the escalation path:** the case reaches Local HR & Legal carrying the
shortfall in days, the statute that governs it, the handlings available, the
exemption that exists and cannot be seen from here, and an explicit statement
that no figure for what the shortfall costs exists anywhere on the case and that
computing one is not a gap to close in code.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Active employee, country in the table, tenure matches a bracket, proposed date on or after the statutory end, a readable balance with a rate | `prepared_for_signoff` / `all_gates_passed` | One HR Ops signature. `uc05_resignations` row moves `pending_signoff → signed_off`; the signed report is the artifact |
| No proposed date stated at all | `prepared_for_signoff`, `discrepancy: no_proposed_date` | The statutory end is the only date, and that is a complete answer |
| Proposed date exactly on the statutory end | `prepared_for_signoff`, `discrepancy: match (0 days)` | |
| Proposed date **later** than statutory | `prepared_for_signoff`, `later_than_statutory` | The conservative direction. Serving more notice than owed is not a problem to escalate |
| Proposed date **earlier** than statutory | `escalate` / `statutory_discrepancy`, flags carry the day count | **Local HR & Legal**, not HR Ops. The arithmetic is agreed and is what creates the problem |
| Netherlands | One month, **flat**, anchored to the end of a calendar month | BW art. 7:672 lid 4 with lid 1. The 1/2/3/4-month ladder at the top of that article is the **employer's** (lid 2); modelling it would report the wrong party's duty as the employee's — the identical mistake this table already made once for Portugal (C-20) |
| Portugal, exactly 24 months' service | 30 days, not 60 | Art. 400.º(1) splits on *"até dois anos"* inclusive. The table split at 23 and was **double, against the employee** (C-18) |
| United States | `escalate` / `no_statutory_notice_period`, flag `contractual_notice_not_held` | A **sourced finding about the law**, not a gap in our table, and never a notice period of zero. What is owed comes from the contract, which this system does not hold. See §7a for the three-part argument for escalating rather than signing off |
| Country not in the table | `escalate` / `unsupported_country` | We hold no rule. The work order is *add the country* — nothing here says that country requires no notice |
| Country in the table, no bracket covers this tenure | `escalate` / `no_matching_notice_bracket` | The work order is *extend the table's low end*. A UK employee three weeks in was once told the United Kingdom is unsupported, on a panel citing the UK statute one line above |
| Employee inside a probation period the country has a rule for | The probation bracket **replaces** the ordinary one | Every probation bracket was dead code for every real record until 2026-08-19: `normalizeEmployment()` collapsed `probation_period_end_date` to a boolean and dropped the date, so a Portuguese employee on probation was told they owed 30 or 60 days instead of 15 — and their lawful leaving date was then escalated as a shortfall |
| Caller supplies balances **and** Remote holds some | The caller's numbers win, unchanged, tagged `caller_supplied` | A read that silently overrode a form would make the form a lie |
| Caller supplies none, Remote answers | `remote_leave_policy_summary` | Payout base is Remote's `balance`, **read never recomputed**: on one live record `annual_entitlement − used` is 25 days where `balance` is 13.75 |
| A balance of `{days: 13, hours: 6}` | 13.75 days at that row's own `working_hours_per_day` | Days and hours are **one quantity**. 24 of 117 live policies carry a remainder; reading `days` alone underpays, quietly |
| **Remote's `days_of_notice` agrees with the statute figure** | `prepared_for_signoff`, reconciliation `agree`, **both** figures shown | The cheap, uncontroversial majority. It is still shown as two figures — an agreement the reader cannot see is not evidence to them `[N-5]` `[N-6]` |
| **Remote's figure is *longer* than the statute figure** | `prepared_for_signoff`, reconciliation `remote_longer`, flagged | The conservative direction, and the same reasoning as `later_than_statutory`: more notice than the statute demands is not a problem to escalate. The likely cause is a contract term above the floor, which is lawful `[N-5]` |
| **The statute figure is *longer* than Remote's** | `escalate` / `statutory_discrepancy`, reconciliation `statute_longer` | **Local HR & Legal.** This is the case the reconciliation exists for: a contract or a blended figure that sits **below** the statutory floor. Nothing else in this system would notice it `[N-5]` |
| **The record was not read, or carries no `days_of_notice`** | reconciliation `not_compared`, naming **which side** was missing | Never a silent one-sided answer presented as a comparison. An absence is not an agreement `[N-5]` `[N-6]` |
| **Canada** | `escalate` / `no_statutory_notice_period`, flag `contractual_notice_not_held` | **Changed by this pass.** Today Canada computes `0 / 7 / 14` days from an unsourced `basis: "customary"` row and reaches a signature. D-04 (Canada Labour Code s. 230) puts notice **entirely on the employer**, exactly as WARN does, so on the employee side Canada and the United States are the same fact and get the same treatment `[N-7]` |
| **Resignation dated before the employment start date** | `escalate` / `resignation_before_start_date` | **Changed by this pass.** Today tenure clamps to zero and the *shortest* bracket is applied, indistinguishable from a genuine day-one employee. Remote models this as a wholly separate variant with no notice arithmetic at all — its validate shape is one boolean `[N-18]` |
| Employment not active | `escalate` / `employee_not_active` | |
| Identity not verified | `escalate` / `identity_not_verified` | A failure to **verify**, never a finding that the filing is fraudulent |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate webhook delivery** | One claim in `workflow_claims (use_case, external_ref)`, one `uc05_resignations` row, one audit row. Proven live: two independent pairs, 12/12 row counts of exactly 1 |
| **A balance line with no hourly rate** | `escalate` / `pto_balance_unusable` + `pto_missing_hourlyRateInRemoteInteger`. The report says in words that **no further read of Remote can answer it** |
| **A balance line with a blank `daysAccrued`** | Refused, not treated as zero. `Number(undefined) \|\| 0` produced a confident `$0` settlement on an employee whose accrual nobody had — indistinguishable from "we checked, nothing is owed" |
| **A negative accrual (−8 days)** | Refused by name. `Math.max(0, −8 − 0)` produced a computable `0.00` with `computable: true`, no flag, and a live sign-off button. **13 live employments carry a negative balance, 9 of them active US records** |
| **A negative `daysUsed`** | Refused for the sharper reason: it **overpays**. `Math.max(0, 10 − (−5))` yields 15 days out of a 10-day accrual, and the clamp cannot see it because the number is positive and plausible |
| **One unusable line among several usable ones** | The **whole** computation refuses. A partial sum presented as a total is a wrong number; the usable lines are still shown so nothing is hidden |
| **`accrued 4 / used 6`, or a typed `0`** | Computes to a real `0.00`. Leave taken in advance is a legitimate situation and a stated zero is the requester's answer — refusing these would be the mirror-image defect, a gate that refuses everything and therefore passes every fail-closed assertion |
| **An unlimited-PTO policy** | Refused for its own missing figure. Employment `7b769e51` has `annual_entitlement: {type: "unlimited"}` while its `balance` is an ordinary limited **zero** — reading `balance` alone produces a confident `0.00` final settlement |
| **The Time Off read fails** | One balance line carrying **no figure**, not an empty list, tagged `remote_leave_policy_summary_unreadable` → gate 6 escalates. An empty list reads downstream as "nothing was mentioned" and lets the money column go quietly absent |
| **A statutory discrepancy *and* an unusable balance** | `statutory_discrepancy` owns the recorded reason; `pto_balance_unusable` still rides in `flags`. Both escalate, so routing is identical and only the reason differs — relabelling a legal discrepancy as a data problem sends the case to the wrong desk |
| **A date that is not a real calendar date (29 Feb 2026)** | Node path: a durable `escalate` / `unparseable_date`. **n8n path: the run throws and the resignation is lost** — see DRIFT-026 |
| **Employee terminated between preparation and sign-off** | Freshness re-read refuses `employment_no_longer_active` (409). Verified live by flipping the mock record mid-flight |
| **Second decision on a decided report** | Refused `already_decided` (409), with the specific sentence naming who signed, when and why |
| **Sign-off attempted on an escalated report** | Refused `not_awaiting_signoff` (403), naming the gate that stopped it and what that gate's refusal meant |
| **`deny` posted instead of `decline`** | Still routes. The installed ZAF bundle posts the old verb; it is canonicalised once, at the edge |
| **Approver not entitled** | Refused **last**, after every refusal the policy already had, by `uc05:hr_ops`. It can only ever refuse — there is no return value meaning "approved" |
| **Zendesk group `Local HR & Legal` missing** | Tagged and unassigned, with the note naming the intended team. The group now exists (`9990000000002`); the escalations raised while it did not — **#23, #53, #54** — are still in the account default `Support` group. Creating a group repairs the next hand-off and re-queues nothing |
| **A reader-facing sentence counting the notice table** | Still says **nine** countries. There are eleven — see DRIFT-066 |
| **A start date in the future** | Today: `Math.max(0, months)` returns **0**, the shortest bracket is selected, and nothing flags it. Decided: refuse by name `[N-18]` |
| **Remote's record read succeeds but the employment read fails** | The reconciliation must report `not_compared`, not fall back to the one figure it has. Two half-answers are not a comparison `[N-5]` |
| **A `403` on the resignation read** | A **scope** answer (`resignation:read` absent), not an absent endpoint. Recorded as `upstream_unavailable`, never as evidence the route does not exist — that conflation is what produced DRIFT-063 `[N-2]` |
| **The employee reloads their result page while `pending_signoff`** | An acknowledgement and a state, never the figures. Decided `[N-14]` |

## 8. Invariants — must never happen

1. **Nothing is ever written to Remote** — as built, and this is the one
   invariant in the list whose *stated justification* has been falsified. No
   `POST`, `PATCH`, `PUT` or `DELETE`, on any path, for any outcome. The rule
   itself stands and must not be relaxed by accident; what changes is why it
   holds. It is **not** "there is no endpoint to call" — there is
   (`PUT /v1/resignations/{offboarding_request_id}/validate`, DRIFT-063). It is
   that this system has never obtained the scope, the id, or a human decision to
   use it. **No endpoint may be invented, and this one may not be adopted
   silently either**: adding a write turns a 🟡 report into a 🟡 execution and
   changes what an HR Ops signature means.
2. **No resignation is ever auto-resolved.** Every case reaches a human — HR Ops
   or Local HR & Legal — and there is no third outcome.
3. **A notice period is never produced by an LLM.** The model may read a date and
   a reason out of a letter; the date it produces is one side of a comparison and
   never a decision.
4. **"We hold no rule" and "there is no rule" are never the same outcome, and
   neither is ever a notice period of zero.** `unsupported_country` /
   `no_statutory_notice_period` / `no_matching_notice_bracket` are three findings
   with three different work orders, kept apart by a three-valued
   `statutoryMinimumExists` rather than by a boolean or a day count.
5. **A day figure is never printed for a rule the statute states in months.** NL
   carries `noticeMonths: 1` and `noticeDays: null`; prose reads
   `noticeQuantity`.
6. **A day count is never rendered where no notice end date was produced.** Two
   branches still return the known-wrong `noticeDays: 0`; every consumer keys off
   `noticeEndDate === null` so the number is inert rather than displayed.
7. **A payout is never computed from a figure that cannot be trusted** — missing,
   non-integer, or negative. And a partial sum is never presented as a total.
8. **A money value never reaches a screen as a raw ×100 integer**, and the
   currency is always named beside it.
9. **The employee's stated date never becomes the statutory date.** The
   calculator is the only source of the statutory end.
10. **The team named on the screen is the team the ticket is routed to.** The
    escalation team is read from `escalationRouting.js`, never typed —
    `test/uc05DecisionSources.test.js` asserts the string appears in no other
    file under `src/`.
11. **No citation is invented, ranked, or scored.** A finding with no entry gets
    no citation rather than a nearest match, and no citation id ever appears in a
    conditional.
12. **A tenure figure is never zeroed because the country is unknown.** Length of
    service is a fact about the person; a Brazilian employee with five years'
    service was once recorded durably as having served 0 months.
13. **Our statutory figure never stands alone when Remote supplied one.** Both
    numbers, both provenances, and the verdict that compares them — or
    `not_compared` naming the missing side. A single number on the screen is a
    claim that only one exists. `[N-5]` `[N-6]`
14. **No notice figure, payout figure or comparison reaches an employee-facing
    surface while the report is `pending_signoff`.** This is the ordering §5 step
    7 and §9's first guard both already assert and which nothing enforces; it is
    stated here as an invariant precisely because it is **testable** and its
    absence is not. `[N-14]`
15. **Tenure is never clamped to hide an impossible input.** A start date in the
    future is refused by name, not floored to zero — a clamp turns an anomaly
    into the shortest lawful bracket and removes every trace that it happened.
    `[N-18]`
16. **A refusal to reach a service is never recorded as a fact about that
    service.** A `403`, a `404` on a wrong id, and a genuinely absent route are
    three different findings; conflating them is the mechanism that produced
    DRIFT-063 and it must not be repeated by the client that closes it. `[N-2]`

## 9. AI responsibilities

**The LLM may:** extract the employee's **stated** last working day and a
one-line reason from free-text resignation letter prose (`letterExtractor.js`,
the single LLM seam in UC-05), returning `null` for either rather than guessing.
Every result is tagged `source: "llm" | "rule_based_fallback"`; the call is
retried 3× with backoff before falling back; a structured submission skips it
entirely and is tagged `structured_input`.

**The LLM must never:** decide the notice period, assert a country's statutory
rule, compute or influence the PTO payout, produce any date other than the one
the employee wrote, or have its `reason` string re-parsed into a decision. It has
no role at all in the escalation, the sign-off, or the citations.

**Not wired here, deliberately:** the narrative-faithfulness judge. There is no
LLM-drafted customer-facing prose in UC-05 to judge.

**Worth knowing:** the deployed n8n graph runs the deterministic extractor
directly and makes **no LLM call at all**, so the model participates on the Node
path only.

**Shrinking, by decision.** `letterExtractor.js` exists to read a date and a
reason out of prose a requester pasted. Remote publishes the resignation letter
itself (`GET /v1/resignations/{offboarding_request_id}/resignation-letter`) and
the structured `resignation_reason` beside it. Once the record is read `[N-2]`,
the model's job narrows to letters that arrive through a stand-in surface, and
the **stated** date it produces is labelled as such against the `[CONFIRMED]`
one from the record `[N-4]`. **The seam is not removed** — the stand-in surfaces
remain the demo path, and an extractor that only runs on real inbound traffic is
an extractor nobody can test. DRIFT-096.

## 10. Deterministic responsibilities

Identity · employment status · the presence of a start date · the country lookup
· bracket selection including probation · calendar-day **and** calendar-month
arithmetic with a day-of-month clamp · the four anchor rules (`continuous`,
`month_15`, `month_1st`, `month_end`) · the discrepancy comparison and its
direction · balance classification before any multiplication · the ×100 payout ·
the sign-off policy, the freshness re-read and role entitlement · audit-before-
state-move ordering · the exactly-once claim.

The gates exist twice (`src/uc05/policyEngine.js` and
`workflows/nodes-uc05/noticePeriodGates.js`) and `test/n8nUc05Parity.test.js`
executes the n8n body in a `node:vm` sandbox against the real functions. **It
compares the gates only** — it feeds both copies the identity the n8n node
derived, so the two identity implementations are never compared, and it feeds
both copies date-only fixtures, so the two date parsers are never compared
either. Parity proves two implementations match; it has never proved either is
right about an input neither was given.

*Internal inconsistency, not a defect:* `policyEngine.js`'s header says "The five
gates" and then lists six; `UC-05.md` §15 also says five; `GATE_SEQUENCE`
publishes nine rungs because it is keyed by **reason**, not by gate. The ladder
is the authority a reader sees.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Every case. There is no unattended outcome |
| **Who — ordinary path** | **One HR Ops signature**, one slot, filled once (`uc05:hr_ops`). Not dual control: no money moves, no contract term changes, and the act is confirming an arithmetic result. The preparer is deliberately **not** barred from signing — segregation of duties applies to irreversible acts, and a report is not one |
| **Who — escalation** | **Local HR & Legal**, the second of only two rows in the routing table with a separate escalation owner. Signing off is confirming a calculation; a statutory shortfall is not a calculation to confirm — the arithmetic is agreed and it is what creates the problem, and Código do Trabalho art. 401.º attaches a money consequence to how it is answered |
| **Verbs** | `signoff` / `decline`. `signoff` is deliberately **not** renamed to Remote's `validate`: that word already means JSON-Schema validation throughout this repository |
| **Evidence needed** | Who is leaving (name, status, contract type, country, start date — read live when the panel opens), the rule applied and the statute behind it, the tenure, the statutory date, the proposal and the gap, the payout with its currency and **where its days came from**, and the explicit list of what is not known |
| **What is being confirmed** | **Changed by this pass.** Not *"is this number right?"* but *"Remote says N days, the statute we hold says M — which governs, and what is the last working day?"* Both figures, both provenances, and the reconciliation verdict `[N-5]` `[N-6]` |
| **After sign-off** | Today: an audit row is written **before** the state moves, then the row becomes `signed_off`, and **nothing else happens anywhere** — not at Remote, and not toward the employee (DRIFT-063, DRIFT-064). Decided: sign-off **releases the confirmed figures** to the surface the employee submitted from, and to the ticket where one exists `[N-15]` |
| **After decline** | `resignation_declined` audited with the reason, row marked declined, and the report has to be re-run |
| **Expiry** | **None.** No expiry, no reminder, no lapse — DRIFT-041 |
| **If nobody responds** | The report sits at `pending_signoff` indefinitely and nothing chases it — DRIFT-041. **The second half of this row changes with `[N-14]`**: today the employee has *already been shown* figures nobody confirmed, so silence reads as confirmation. After `[N-14]` they have been shown an acknowledgement, so silence reads as *still waiting* — which is true. That does not fix the absence of a chaser; it stops the absence from being actively misleading |

### What the employee is told, per state — decided 2026-08-21

The owner's ruling, applied. Today's column is what `src/portal/server.js`
renders now; the decided column is `[N-14]` / `[N-15]`.

| Report state | Today | Decided |
|---|---|---|
| Submitted, `pending_signoff` | The statutory line, the rule applied, tenure, the proposed-vs-statutory comparison and the PTO payout — **all of it, before any human has looked** | An acknowledgement: received, being checked by HR Ops, what happens next. **No figures of any kind** |
| `escalate` (any reason) | The same figures, plus a routing line | Received, and a specialist team is looking at it. No figures, and **no statement of what the problem is** — the shortfall is Local HR & Legal's to raise, not ours to disclose mid-review |
| `signed_off` | Nothing. Sign-off is invisible to the employee | The confirmed figures, marked confirmed, with the date and the fact a specialist confirmed them |
| `declined` | Nothing | Received, being re-checked. The decline reason is internal |

**Why the escalation row withholds the reason.** A statutory shortfall is a
finding about the *employer's* obligation that Local HR & Legal has not yet
resolved. Telling the employee *"your notice period may be 30 days short"* while
that is still under review states a disputed legal position as fact, from the
party that would owe it. `[N-14]`

## 12. CROSS_UC_ROUTING

**May receive from**
- **Nothing.** UC-05 is the endpoint of no route in this system. No use case
  hands a case to it, and its spec claims none.
- Its three real intakes are all direct: the portal's resignation form (employee
  persona only — a non-employee is refused `persona_cannot_resign`), a Zendesk
  ticket webhook through the n8n graph, and a direct call to
  `handleResignationRequest()`.
- The **specified** intake — an `offboarding.submitted` webhook filtered to
  `type: "resignation"` — does not exist anywhere in the repository. See
  DRIFT-022.

**May route to**
- **Nothing.** UC-05 terminates in a signature or an escalation to a named team.
  There is no onward route, and no other use case reads `uc05_resignations`.

**Routing conditions**
- None exist, inbound or outbound. Stated as an answer, not as an omission: the
  one cross-UC route built anywhere in this system is UC-03 → UC-04.

**Context that MUST transfer**

n/a — no hand-off to another use case exists. The columns below record what
*would* have to travel, and whether the record could supply it today, because
that is the useful answer for anyone building the route DRIFT-022 and the
asymmetry below imply.

| | Available on the record | Notes |
|---|---|---|
| Customer/user identity | ✅ | `requester` is the filer's authenticated employment id, or the literal `"unauthenticated"` |
| Employment/entity identifier | ✅ | `employment_id`, persisted |
| Zendesk ticket / reference | ⚠️ Sometimes | `external_ref` is `null` when the caller supplied none, never defaulted. A ref-less delivery is claimed under `unreferenced:<execution id>` rather than dropped |
| Trace / correlation id | ✅ | One `external_ref` spans the decision, the sign-off and every audit row; sign-off recovers it from the row because it runs in a different process days later |
| Evidence already gathered | ✅ | The whole notice calculation and payout reconciliation are persisted, with the source of the days |
| Decision / risk information | ✅ | Decision, reason, flags, and the risk tier |
| Approvals already obtained | ✅ | `signed_off_by` / `denied_by` (aliased `declinedBy` on read) |
| Relevant conversation | ⚠️ Partial | The LLM's extraction is stored; the letter text itself is not |
| Session / persona | ✅ | Does not change — UC-05 has one persona throughout |
| Other required state | ❌ | Nothing about an in-flight relocation or amendment. See the asymmetry below |

**The one real asymmetry, reported rather than resolved.** UC-07 holds an opinion
about offboarding — `UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED` is a HIGH-severity
flag asserting that *"source offboarding is authorized only once the destination
contract is active, right-to-work is confirmed, the destination start date is
confirmed, and the source exit plan is validated"*
(`src/uc07/transitionGate.js`). That opinion is about the relocation's **own**
plan dates. It does not query `uc05_resignations`, and UC-05 knows nothing about
an in-flight relocation or an in-flight UC-06 amendment. **So the relationship
exists conceptually in one direction and as data in neither.** A resignation
filed mid-relocation reaches HR Ops with no indication that a mobility case is
open, and a relocation dossier is compiled with no indication that the person has
resigned. Neither is detected today and neither should be built by inference —
this is a routing decision to take deliberately, alongside DRIFT-021's.

**Must NOT happen during handoff**
- ❌ The customer must not repeat what they already said. *n/a — no hand-off
  exists.*
- ❌ Duplicate work must not be created. *Satisfied* — UC-05 creates no record in
  any other use case's store.
- ❌ Audit continuity must not be lost. *Satisfied* — one `external_ref` spans
  every row, and it is recovered from the persisted record at sign-off rather
  than carried in memory.
- ❌ Approval state must not be lost. *Satisfied* — the sign-off slot is on the
  row, and the audit row precedes the state move.
- ❌ Ownership must not become ambiguous. *Satisfied, and it is the one place in
  this repository where this hazard was found and closed properly:* the panel
  once said "Local HR Legal decides" while every escalation went to HR Ops and no
  such team existed. Both halves now read `escalationTeamFor("UC-05")`, and a
  test asserts the name appears in no other file under `src/`.
- ❌ Identity or persona must not silently change. *Satisfied* — one persona
  throughout; the portal refuses a non-employee outright.
- ❌ Two UCs must not execute conflicting actions. *Satisfied structurally* —
  UC-05 executes nothing.
- ❌ Duplicate Zendesk tickets must not be created without a business reason.
  ⚠️ **Unverified** by any test found in this pass. `NO_TICKET_DECISIONS.uc05`
  is empty, so **both** outcomes raise a ticket, and nothing asserts that a
  re-filed resignation re-uses the first.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Portal (employee)** | Today: the resignation form, then the result — statutory line, rule applied, tenure, comparison, payout — **all of it at submission, before any human has looked**, which is the ordering §8 exists to prevent (DRIFT-064). Decided: an acknowledgement at submission, figures on sign-off `[N-14]` `[N-15]`. **The portal is also relabelled a stand-in** — a resignation cannot be created through Remote's partner API at all, so this form stands in for Remote's own employee self-service, exactly as `src/remoteui/` does for UC-06 `[N-3]` |
| **Remote-native intake (specified, not built)** | `offboarding.submitted` → filter `type: "resignation"` → `GET /v1/resignations/{offboarding_request_id}` → `GET .../resignation-letter`, with `GET /v1/offboardings?type=` as the poll fallback. All four confirmed to exist from Remote's OpenAPI on 2026-08-21; **none of them is called by any code in this repository** `[N-2]` `[N-3]` |
| **Zendesk ticket** | Tagged `uc05` plus `queue_hr_ops` on **every** ticket, and `escalation_local_hr_legal` **only** when the automation gave up. The note names the person, the outcome, the owning team and where to act — or `ASSIGNMENT SKIPPED — …` naming the missing group rather than silently leaving it unassigned |
| **ZAF sidebar** | One `Sign off` / `Decline` pair on a prepared report, and **no controls at all** on an escalation, with the reason why. The gate ladder with each rung marked passed / decided / not_reached, the decision basis (rule, tenure, date, gap, money), the citations where this repository holds the statute, and the explicit "what is not known" block. The `Employee` row still prints a **bare UUID** despite the API view publishing a display name — DRIFT-042 |
| **Approval queue** | UC-05 listed with `control: exists`, one `hr_ops` slot, endpoint `POST /uc05/api/resignations/:id/:action`, and the note that the sign-off **is** the outcome rather than a step before one |
| **Live Feed / audit viewer** | `prepared_for_signoff` or `escalate` at decision time, then `resignation_signed_off` / `resignation_declined` / `resignation_signoff_blocked` / `resignation_<action>_refused`, each carrying `externalRef`, `source` and `ptoSource` |
| **Backend/API** | `GET /uc05/api/resignations`, `/:id`, `/by-ticket/:externalRef` — all behind the **same** signed identity a write requires, because the read returns an employment id, a requester and a full decision. `POST /:id/signoff\|decline\|deny`. **No intake route and no write route exist in the file** |
| **Database** | `uc05_resignations` (`pending_signoff → signed_off \| declined`) · `audit_log` · `audit_trace` · `workflow_claims`. **No `cases` row and no `review_queue` row** — which is why the dashboard cannot see this use case at all (DRIFT-065) |
| **Remote Sandbox** | Today exactly two reads: `GET /v1/employments/{id}` and `GET /v1/leave-policies/summary/{id}`, plus one re-read of the employment at sign-off. **No write, ever, on any outcome** — that half is unchanged and load-bearing. Decided: two **reads** are added, the resignation record and its letter `[N-2]`. Adding a read does not weaken the negative; adding a write is a separate decision that has not been taken |

## 14. UX_ACCEPTANCE

- **Hierarchy.** Who is leaving, when the law says they may, how that compares to
  what they asked for — then the money, then the derivation.
- **Statements of absence are mandatory and are the best thing on this screen.**
  "The pay rate is missing and no further read of Remote can answer it." "No
  figure for what the shortfall costs exists anywhere on this case." "This system
  does not hold contracts and has not read one." "We hold the notice statute for
  three of the countries in this table and not for this one." Each of these is
  exempt from the deletion test and must survive any compression.
  **Two are added by this pass**, and they are of the same class: *"Remote's own
  figure was not available, so these two numbers were not compared"* `[N-5]`, and
  — on any Canadian or American case — *"no employee-side statutory notice was
  found; what is owed comes from the contract, which this system does not hold"*
  `[N-7]` `[N-8]`.
- **Two figures, never one.** Where Remote supplied `days_of_notice`, the screen
  shows both it and the statutory figure, each labelled with where it came from,
  and the verdict that compares them. A single number is a claim that only one
  exists. `[N-6]`
- **A finding with no source says so.** A citation block that appears only where
  a citation exists teaches a reader that everything unmarked is
  unsourced-but-fine.
- **Never a raw slug.** `earlier_than_statutory`, `not_comparable`,
  `pto_balance_unusable` and `statutoryMinimumExists` are internal; the sidebar's
  `Discrepancy` row still prints the slug verbatim.
- **Never a bare number where a quantity is uncertain.** No `0` days on a
  no-rule branch, no ×100 integer, no day figure for a month-denominated statute.
- **Action clarity.** The primary action is `Sign off`, and the sentence beside it
  has to say what it is not: nothing is filed with Remote, and signing does not
  end the employment. A signatory who believes they have offboarded somebody has
  been misled.
- **A count in a sentence is a liability.** The calculator removed "the 9-country
  table" from its own reader-facing string for exactly this reason and
  `decisionSources.js` still renders "the nine countries in the notice table" for
  a table of eleven (DRIFT-066).
- **Consistency.** One name for the escalation team, derived from the routing
  table — already achieved here, and the model the other use cases should copy.

## 15. Successful business outcome

> **An employee who has resigned is told the correct last day they must work and
> the correct value of the leave they never took — and is told it only after a
> named HR Ops person has checked the arithmetic and put their name to it.**
>
> **"Only after" is decided, not aspirational, as of 2026-08-21.** It was written
> here while the portal disclosed every figure at submission. `[N-14]`
>
> And where **Remote's figure and the statute disagree**, a human sees the
> disagreement — with both numbers and both sources — before anyone accepts a
> proposed notice period. That comparison is the use case; the number on its own
> is something Remote already computes. `[N-5]`
>
> And where the law and the employee's plan genuinely conflict, the case reaches
> the local legal desk carrying the statute, the options and the honest statement
> that this system has not priced the shortfall and will not — rather than
> reaching HR Ops as a number to wave through.
>
> Nothing was filed with Remote, nobody was offboarded by this system, no payout
> was invented from a figure it could not read, and no country's law was guessed.

## 16. Required evidence for E2E verification

1. **A positive test leads.** A clean resignation in each of the four demo
   countries MUST reach its stated outcome —
   `NL prepared_for_signoff` · `PT prepared_for_signoff` ·
   `CA prepared_for_signoff` · `US escalate / no_statutory_notice_period` — and
   the last of those must be distinguishable in the stored row from
   `unsupported_country`. A dead gate and a cautious gate look identical from
   outside.
   **`CA` changes to `escalate / no_statutory_notice_period` with `[N-7]`**, which
   leaves **NL and PT** carrying the positive path. That is the whole reason the
   Canadian change is now affordable: C-30 deferred it because demo scenarios
   depended on the CA row, and since NL joined the table on 2026-08-20 the demo
   set no longer loses its happy path when Canada stops computing.
1b. **The reconciliation's positive test leads too**, and for the same reason. A
   case where Remote's `days_of_notice` and the statutory figure **agree** must
   reach `prepared_for_signoff` carrying both. Without it, a reconciler that
   never fires, one that is wired inverted, and one that was never wired at all
   are indistinguishable — the failure this repository has now shipped three
   times (UC-03's alpha-3 comparison, UC-03's unnameable sanctions codes, UC-06's
   dead payroll URL). `[N-5]`
1c. **A resignation dated before the start date must refuse**, and the refusal
   must be distinguishable from a day-one employee's shortest bracket. `[N-18]`
2. **The three no-date outcomes, side by side**, with the stored `reason`, the
   stored `statutoryMinimumExists`, and the words a human reads for each. They
   must not be equal in any of the three.
3. **The boundary cases the table got wrong once**: PT at 23, 24 and 25 months;
   NL notice filed on the 1st of a 31-day month, proving one calendar month and
   30 days diverge by a full month under the end-of-month anchor; a probation
   case that **must** produce the short bracket, driven through a record carrying
   `probation_period_end_date`.
4. **Money, hand-verified independently of the code**, in Remote's integer form,
   with the currency taken from the contract rather than defaulted, and a
   `{days, hours}` remainder proving days and hours are one quantity.
5. **Every refusal the payout can make**, each producing an escalation naming the
   field: no rate, blank accrual, negative accrual, negative used, unlimited
   policy, unreadable read. Plus the positives that prove the refusals are not
   blanket: `accrued 4 / used 6` and a typed `0` both compute.
6. **The `unparseable_date` path, on both execution paths**, because today it
   exists on one, has no gate rung, and has no test anywhere (DRIFT-026).
7. **Idempotency** — two deliveries under one external ref, one of everything.
8. **The sign-off chain end to end**: the freshness re-read refusing a
   mid-flight termination; a second decision refused; an unentitled approver
   refused by a name distinct from "not configured"; and the audit row landing
   **before** the status moves.
9. **The escalation as a hand-off, not a filing**: the ticket tagged
   `queue_hr_ops` + `escalation_local_hr_legal`, assigned to a group that exists,
   carrying the statute, the handlings and the unknowns.
10. **Proof of the negative**: no Remote write is attempted on any outcome, and
    the reads made are only the reads named in §13. **Assert it as a policy, not
    as an impossibility** — the structural test's own message says *"the spec confirms
    no such write endpoint exists"*, which is now known to be false, and a guard
    whose stated reason is wrong is a guard the next engineer deletes.

## 17. Known SPEC_DRIFT

> Findings DRIFT-022 … DRIFT-026 use this contract's allocated range. UC-05
> produced four more than the range allows; per the brief and the coordinator's
> 2026-08-20 sync they take the next free numbers above 062 —
> **DRIFT-063, DRIFT-064, DRIFT-065, DRIFT-066**.
>
> **The most consequential finding in this contract is DRIFT-063**, and it
> arrived from outside it: the coordinator asked whether
> `00-FOUNDATION.md`'s claim that *"UC-05's resignation endpoint … doesn't
> exist"* is right, after the UC-06 agent falsified the neighbouring example in
> the same sentence. It is not right. Remote documents three resignation
> endpoints, one of them a write, and the write's body is shaped like this use
> case's sign-off form. Read DRIFT-063 before DRIFT-022, and before treating
> §8's first invariant as settled.
>
> **Renumbered by the lead pass after the fact.** This contract was written with
> 061–063; the UC-06 agent, working in parallel, claimed 061 and 062 first. Both
> agents applied the overflow rule correctly and neither could see the other's
> file. Recorded rather than silently corrected, because a numbering scheme that
> quietly reassigns is exactly the hazard DRIFT-044 describes one level up.
>
> Two cross-cutting findings apply here unchanged and are **not** renumbered:
> **DRIFT-041** (no approval anywhere has an expiry, a reminder, or a
> no-response policy — true of `pending_signoff`) and **DRIFT-042** (the ZAF
> panel prints a bare UUID under "Employee"; `zaf-app/assets/panels.js:943`
> renders `show(r.employmentId)` while `src/uc05/server.js` publishes
> `employee.displayName` from a live read).

---

### SPEC_DRIFT · DRIFT-022 · UC-05 never reads a resignation record, and the trigger it is specified to react to does not exist

**Original/documented behaviour:** §1 — *"An employee's resignation record appears
in Remote (`type: "resignation"` on the offboarding resource)"*. §3 names
`GET /offboardings` / `GET /offboardings/{id}` filtered to that type as the first
data source, returning `resignation_reason`, `proposed_last_working_day` and
`employer_awareness`, all `[CONFIRMED — live]`. §5 specifies
`offboarding.submitted webhook → identity verify → filter to type: "resignation"`
with an explicit **fallback poll** of `GET /offboardings?type=resignation` if the
webhook does not split by type, and §9 lists that fallback as a named guard. §12
test 6 tests it.
**Current implementation:** the string `offboarding` appears **nowhere** in
`src/uc05/`, `workflows/nodes-uc05/`, or any script. Nothing reads
`/offboardings`. There is no type filter, no poll, and no
`offboarding.submitted` handler. `RemoteClient` has no offboarding method for
UC-05 to call. The two facts the spec sources from that record arrive instead as:
`proposedEndDate` — supplied by the caller, or extracted from free text by the
LLM/rule-based `letterExtractor.js`; and `reason` — the same. The three real
intakes are the portal form (`src/portal/server.js:2964`), a **Zendesk ticket
webhook** (`workflows/nodes-uc05/normalizeResignationRequest.js`, branch A), and
a generic structured webhook (branch B) that no Remote event produces.
**Current tests assume:** the caller-supplied and letter-extracted shapes only.
No test references an offboarding record.
**Difference:** the use case named *"an employee's resignation record appears in
Remote"* never looks at that record. `proposed_last_working_day` — the single
value the whole discrepancy gate compares against — is a **claim**, either typed
into a form or read out of prose by a model, where the spec has it as a
`[CONFIRMED]` API field. That is the same class of substitution as DRIFT-017's
self-declared `visaType`, and prime directive #3's rule about claims applies to
it. The Zendesk intake is additionally a **second door the spec does not
describe**: `00-FOUNDATION.md` §2 places UC-05 in the Remote-native column, and
the deployed graph's primary path is a ticket.
**Evidence:** `grep -rn offboarding src/ workflows/` → no UC-05 hit;
`docs/use-cases/UC-05.md` §1/§3/§5/§9/§12;
`workflows/nodes-uc05/normalizeResignationRequest.js:47–83`;
`src/uc05/server.js:11–17` (*"No intake route — UC-05's intake is the
Remote-native webhook path… When the Remote product surfaces one, the workflow is
the entry point"*).
**Likely reason:** partially establishable. `src/uc05/server.js`'s header states
the webhook "has not been confirmed to exist yet, the same way UC-06's amendment
endpoint hasn't" — and `docs/INTAKE-RESEARCH.md` has since found UC-06's
equivalent assumption **stale**, with `contract_amendment.submitted` live on
`developer.remote.com`. Whether `offboarding.submitted` splits by type was
flagged in §3 as *"needing confirmation at build time"* and no record of that
confirmation being attempted exists. **Why the fallback poll was never built
cannot be established from the repository.**
**Read this finding together with DRIFT-063**, which establishes that the
resignation resource this trigger would deliver — `GET /v1/resignations/
{offboarding_request_id}`, carrying `proposed_last_day`, `days_of_notice`,
`contract_start_date`, `contract_probation_period_end_date` and a PTO breakdown
— is documented and live, and is the record §3 says the whole spec is shaped by.
The six `offboarding.*` webhooks are in Remote's index too.
**Risk if left as-is:** the statutory comparison is made against a date nobody
verified against Remote's own record, on a use case whose entire value
proposition is that the date matters legally. A real `offboarding.submitted`
delivery today reaches nothing.
**Recommendation:** HUMAN_DECISION_REQUIRED, and it needs the same live check
`INTAKE-RESEARCH.md` ran for UC-06: does `offboarding.submitted` exist, does it
split by type, and does the record expose `proposed_last_working_day`? If it
does, this is a build task and the spec is right. If it does not, §1/§3/§5 must
be rewritten to describe the ticket-and-form intake that actually exists, and
`proposedEndDate` must be labelled a **stated** date on every surface.
**Confidence:** HIGH on the finding; MEDIUM on why.

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-2]` `[N-3]` `[N-4]`**

**Build the read. The spec was right, and the confirmation it asked for has now
been done.** Every open question this finding raised was answered from Remote's
own OpenAPI on 2026-08-21:

- `offboarding.submitted` exists, and **it does split by type** — §3's *"not
  confirmed whether they split by type — flagged as needing confirmation at build
  time"* is now confirmed. The `Offboarding` wrapper is *"either a termination
  (employer-initiated) or a resignation (employee-initiated)"*, and the
  resignation variant carries `type` with `enum: ["resignation"]`.
- The **poll fallback §5 documents is available**: `GET /v1/offboardings` takes a
  `type` query parameter.
- The record carries `proposed_last_working_day`, `resignation_reason`,
  `employer_awareness` and `requested_by`; the richer
  `GET /v1/resignations/{offboarding_request_id}` carries ten more required
  fields.

**What is decided beyond "build it":**

1. **Both intakes survive.** The record read becomes the truth path; the portal
   and Zendesk doors stay as **stand-ins** and are labelled as such — a
   resignation cannot be created through the partner API, so a demo needs a
   surface standing in for Remote's own. UC-04's `W-4` shape, second instance.
   DRIFT-094.
2. **`proposedEndDate` is labelled by origin on every surface** — **stated** when
   it came from a form or a letter, `[CONFIRMED]` when it came from the record —
   carried on the row as `dateSource` rather than re-derived per screen. Prime
   directive #3's rule about claims is what makes this non-optional: the whole
   discrepancy gate compares against this value.
3. **The read is addressed by `offboarding_request_id`**, and a `403` is recorded
   as a scope answer, never as evidence the route is absent. That conflation is
   what produced DRIFT-063.

**Not decided here:** whether anything is ever written back. See DRIFT-063.


---

### SPEC_DRIFT · DRIFT-023 · Canada's notice figure is invented, and it can reach a signature

**Original/documented behaviour:** §5 — *"country notice rule not confirmable with
high confidence → escalate, never guess a formula"*. §7 — *"Country/rule not
confirmable → escalate rather than compute with low confidence."* §9's guard for
an unmaintained rule is *"Escalate, never guess a formula."* §11's integrity
metric is *"**Zero** communicated notice dates that later prove statutorily
wrong."*
**Current implementation:** `noticePeriodTable.js`'s `CA` row carries
`basis: "customary"` and three brackets producing **0 / 7 / 14 days** by tenure,
with `sourceCitation: "Common-law customary notice (no statutory employee
minimum; varies by province)"` and — alone among the rows this pass looked at —
**no `evidence` tag**, whose absence the file's own header says is informative. A
Canadian resignation reaches `prepared_for_signoff` carrying one of those
figures. `UC05-CA-1` and `UC05-CA-2` in `docs/DEMO-COUNTRIES.md` are both
observed doing exactly that, live.
**Current tests assume:** the CA figures are correct.
`test/uc05.test.js` pins `CA 14` among the nine countries' distinct outputs, and
`test/uc05NoticeCountries.test.js` treats CA as a passing country.
**Difference:** the US row and the CA row describe, as far as this repository's
own corpus can see, the **same fact** — Canada Labour Code s. 230 (D-04) imposes
notice entirely on the *employer*, exactly as WARN does. After the 2026-08-20
pass the US states that fact and refuses to compute, while CA computes a number
with no retrieved source and carries it to a sign-off form. `UC-05.md` §7a says
this in its own words: *"a fabricated figure on a sign-off form, which is
strictly worse than the collapse just closed"*, and calls it **"the highest-value
follow-up in UC-05."** A second instance sits beside it: PT's probation bracket
*"is still the employer's obligation, with a number repealed in 2023, in the
wrong shape"* (C-20) — art. 114.º(1) gives the employee **zero** notice during
probation, and the table gives 15 days.
**Evidence:** `src/uc05/noticePeriodTable.js` `CA` row and `PT.probation`;
`docs/use-cases/UC-05.md` §7a "Known and deliberately not fixed";
`docs/knowledge/layer-1-statutory/CONTRADICTIONS.md` C-30 and C-20;
`docs/DEMO-COUNTRIES.md` §4.7.
**Likely reason:** established, and honest. §7a records two grounds for leaving
it: the provincial half of the evidence is genuinely missing (D-05, Ontario ESA
2000, could not be retrieved — e-Laws is JavaScript-only), and changing a live
demo country's behaviour mid-flight would have broken demo scenarios being built
against the table in parallel.
**Risk if left as-is:** an HR Ops specialist signs, and an employee is told, a
number for which no authority was ever read. It is the one failure §11's
integrity metric names, and it is the failure the whole three-outcome redesign
was built to stop — surviving in the one country that was not looked at while the
redesign happened.
**Recommendation:** HUMAN_DECISION_REQUIRED. Three options, and the choice is a
product one: (a) give CA the US treatment — `noStatutoryMinimum: true`, escalate,
say the notice comes from the contract; (b) keep the customary figures but stop
them reaching `prepared_for_signoff`, so a human always sees them; (c) retrieve
the provincial statutes and make the row real. **What must not happen is (a) or
(b) being applied silently while demo scenarios depend on the current
behaviour** — the deferral was reasoned, and reversing it needs the same reasoning
in the other direction.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-7]` `[N-8]` `[N-9]`**

**Option (a), and the deferral's own stated reason has expired.**

**Canada gets the US treatment** — a sourced absence, `escalate` /
`no_statutory_notice_period`, flagged `contractual_notice_not_held`, saying the
figure comes from the contract. The corpus already supports it: D-04 puts notice
**entirely on the employer**, exactly as WARN does, so on the employee side
Canada and the United States are the same fact, and C-30 says so in those words.

**Why now, when C-30 deliberately left it.** C-30 gave two grounds. The first —
that the provincial half of the evidence is missing (D-05, Ontario ESA, is
retrieval-blocked) — is **an argument for escalating, not for computing**: an
unsourced number is a worse answer to an unsourced question than a refusal is.
The second — that changing a live demo country breaks scenarios being built in
parallel — **has expired**: NL joined the table on 2026-08-20 and reaches
`prepared_for_signoff`, so PT and NL carry the positive path and the demo set
loses nothing when Canada stops computing. The demo matrix is regenerated in the
**same commit**, not afterwards.

**The United States: bound the claim, do not chase it.** The owner asked how to
get the US labour law. **There is nothing further to retrieve, and that is the
finding.** No federal statute imposes notice on a *resigning employee*; US
employment is at-will by default. WARN (D-06) runs the other way and delimits
the federal field without creating an employee duty; state mini-WARN statutes are
employer-side too. A negative cannot be upgraded from
`[INFERRED — argument from scope]` to `[CONFIRMED]` by fetching one more
document — that is what "argument from scope" means. So the assertion is
**narrowed in wording**: *no federal statute imposes employee-side notice; state
law was not surveyed; the operative term is the contract.* **Behaviour does not
change — the US still refuses to compute.**

**The consequence for the table, and it is the real decision.** Eleven rows,
three sourced, after a dedicated retrieval pass. That is the measurement, and it
says a statutory notice table cannot be the **primary** source at Remote's scale
— maintaining notice law across a hundred-plus jurisdictions is a standing legal
function, not a data file. The table is reframed as a **sourced cross-check**
`[N-9]`, and the operative figure becomes Remote's own `days_of_notice` `[N-5]`.
Three sourced countries is a perfectly good cross-check; three sourced countries
presented as a notice engine is not.

**PT's probation bracket (C-20) is NOT closed by this disposition** — art.
114.º(1) gives the employee zero notice during probation and the table gives 15
days. It is a second, independent instance and needs its own unit of work.


---

### SPEC_DRIFT · DRIFT-024 · Tenure — the input that selects the statutory bracket — is measured from a *provisional* start date in preference to the seniority date

**Original/documented behaviour:** §3 names the source as *"Employment basic info
(**seniority**/start date) — `GET /v1/employments/{id}`"*. §7 — *"Notice end-date
= f(**seniority date**, tenure, statutory notice table)"*. §10 logs *"seniority/
tenure inputs"*. Every statutory bracket in the table is a bracket of continuous
service.
**Current implementation:** `src/remote/restClient.js:1745` —
`start_date: basicInfo.provisional_start_date ?? raw.provisional_start_date ??
basicInfo.seniority_date ?? null`. The **provisional** start date is preferred and
`seniority_date` is reached only when neither provisional field is present.
`policyEngine.js` gate 3 checks `employment.start_date`, and
`computeNoticePeriod()` measures `tenureMonthsBetween(startDate, now)` from it.
**Current tests assume:** a flat `start_date` on the mock's own shape, which
short-circuits `normalizeEmployment()` entirely
(`if (typeof raw.contract_type === "string" && typeof raw.start_date === "string") return raw`).
**No test in `test/uc05*.test.js` drives a record carrying both
`provisional_start_date` and a different `seniority_date`**, so the precedence is
never exercised.
**Difference:** a provisional start date is what the onboarding record proposed;
a seniority date is what the employment is credited with. They diverge exactly in
the cases that matter — a transferred entity, a converted contractor, a rehire
with recognised service — and the divergence moves the employee across a bracket
boundary. GB's ladder has eight brackets, PT's splits at two years, IN's at six
months and two years. A resignation is not the moment to under-state somebody's
service.
**Evidence:** `src/remote/restClient.js:1729–1745`;
`src/uc05/policyEngine.js` gate 3 and the `computeNoticePeriod` call;
`src/uc05/noticePeriodCalculator.js` `tenureMonthsBetween()`;
`docs/use-cases/UC-05.md` §3, §7, §10; `docs/DEMO-COUNTRIES.md` §6.11 (which
records the fallback being *added* so UC-05 could run against the raw gateway,
without addressing which field is correct).
**Likely reason:** partially establishable. §6.11 shows the provisional fallback
was added to make UC-05 runnable against a Sandbox where
`basic_information.start_date` was `undefined` — a **reachability** fix. That the
ordering also decides a legal question appears nowhere. Whether `seniority_date`
is populated on live records could not be checked from this container.
**Risk if left as-is:** a wrong statutory notice period, produced confidently,
from a plausible field, on a document an employee signs — with no flag, because
nothing compares the two dates. It is the same shape as F-36's dead probation
gate: correct-looking output from the wrong input.
**Recommendation:** RECONCILE. `seniority_date` should be preferred where present
and the provisional date used only as the fallback it is, **and the record should
carry which field answered**, so the sign-off screen can say so. Because
`normalizeEmployment()` is shared with UC-06 and UC-09, this needs the owning
pass rather than a UC-05 edit.
**Confidence:** HIGH on the ordering; MEDIUM on the live impact, which could not
be measured from here.

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-10]`**

**Recommendation accepted as written.** `seniority_date` is preferred where
present; the provisional date is used as the fallback it was added as; and the
row records **which field answered**, so the sign-off screen can say so rather
than leaving a reader to assume.

**Two things constrain how it is built.** It lives in `normalizeEmployment()`,
shared with UC-06 and UC-09, so it belongs to that module's owning pass and not
to a UC-05 edit — changing precedence silently for two other use cases is the
hazard, not the fix. And it needs a test that drives a record carrying **both**
fields with **different values**, because no test in `test/uc05*.test.js` does
today: the mock's flat `start_date` short-circuits `normalizeEmployment()`
entirely, so the precedence has never been exercised in either direction.

**It gets smaller once `[N-2]` lands.** The resignation record carries
`contract_start_date`, `contract_probation_period_end_date` and
`contract_proabtion_period_passed` **on the same object as the resignation
date** — so for a record-sourced case, tenure, probation and the proposed day all
come from one read, and the field-precedence question narrows to records that
arrive through a stand-in. It does not disappear: the employment read still
supplies the country and the status.


---

### SPEC_DRIFT · DRIFT-025 · The identity gate offers "HR acting with the employee's consent" on three screens and can never perform it

**Original/documented behaviour:** `policyEngine.js`'s own gate-1 rung publishes
`checks: "the person filing the resignation is the employee it is about, **or HR
acting with their consent**"` and a `means` sentence repeating it.
`src/uc05/server.js`'s `identityChecks` string repeats it a third time, and
`onBehalfFinding` tells the reader *"UC-05's gate admits HR acting with the
employee's consent, and this row does not record a consent artifact — so which of
the two this is cannot be read back here."*
**Current implementation:** `src/uc05/workflow.js:227` calls
`verifyRequester({ session, employment, requesterType: "self" })`. In
`src/shared/identity.js` the consent branch is reachable **only** when
`requesterType === "third_party"`, and `consentOnRecord` defaults to `false`.
With `"self"` hard-coded, a session whose `authenticatedEmploymentId` differs from
the employment returns `session_employment_mismatch` → `verified: false`. No
`consentOnRecord` is ever passed, no consent artifact is ever read, and
`consent_records` is never consulted by UC-05. The portal independently refuses a
non-employee persona with `403 persona_cannot_resign`.
**Current tests assume:** the self path only. `test/uc05.test.js` §6.2 asserts a
mismatched session escalates — which is the correct behaviour for an impostor and
is **indistinguishable** from the correct behaviour for HR filing legitimately on
someone's behalf.
**Difference:** three reader-facing strings — one of them the sentence a resigning
employee reads on the portal's "what happened" row — describe a capability that
does not exist and cannot be exercised. The outcome is fail-closed, so nothing is
unsafe; what is wrong is the promise. An HR specialist filing for an employee who
cannot access the portal gets `identity_not_verified`, a reason that says *we
could not confirm you are the employee* when the system's own screen has just told
them they did not need to be.
**Evidence:** `src/uc05/policyEngine.js` `GATE_SEQUENCE` position 1;
`src/uc05/server.js` `identityChecks` / `onBehalfFinding`;
`src/uc05/workflow.js:227`; `src/shared/identity.js:33–58`;
`test/uc05.test.js` §6.1/§6.2.
**Likely reason:** cannot be established from the repository. The consent
vocabulary is UC-01's, where a third party with recorded consent is a real path,
and the prose reads as though it was written from that shape.
**Risk if left as-is:** a documented path nobody can walk, and an escalation whose
recorded reason misdescribes what happened — the same class as the
`unsupported_country` collapse this use case has already fixed twice. It also
leaves an employee who is off sick, or has already lost portal access, with no
way to file at all.
**Recommendation:** HUMAN_DECISION_REQUIRED. Either build it — an HR session plus
a consent artifact recorded on the row, which is a real piece of work with its own
audit shape — or delete the clause from all three strings and say plainly that
only the employee may file. **Do not "fix" it by passing `requesterType:
"third_party"`**: that would open the consent branch with `consentOnRecord`
defaulting to false and change nothing except which false sentence is printed.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-11]`**

**Delete the clause. Remote's own documentation settles it, three independent
ways**, all read from the OpenAPI on 2026-08-21:

- `ResignationOffboarding` — *"An offboarding request **initiated by the
  employee** (a resignation)."*
- `requested_by` — *"The unique identifier (UUID) of the **employee who submitted
  the resignation**."*
- `type` — *"Always `resignation` for **employee-initiated** resignations."*

And the partner API cannot create one at all (`CreateOffboardingParams.type` is
`enum: ["termination"]`). **Remote's model has no file-on-behalf path for a
resignation.** The employer's role exists, on the other side of the transaction:
`PUT .../validate`, whose `agrees_to_pto_amount` is glossed *"Whether the
**employer** agrees with the employee's PTO balance."*

So all three strings are corrected to say plainly that **only the employee files,
and the employer validates**. This is not a limitation being accepted — it is
Remote's model, and building a consent path around it would be telling Remote how
their own product works, which `docs/UI-AUDIENCES.md` records the owner
correcting once already.

**The finding's own warning stands, repeated because it is the tempting fix:** do
**not** resolve this by passing `requesterType: "third_party"`. That opens the
consent branch with `consentOnRecord` defaulting to `false` and changes nothing
except which false sentence is printed.

**What is knowingly not solved.** An employee who is off sick, or who has already
lost portal access, still cannot file. That is real, and it is Remote's product
problem rather than ours to route around — recorded here so the next reader knows
it was seen and not missed.


---

### SPEC_DRIFT · DRIFT-026 · The n8n copy accepts a date the Node copy exists to refuse, and `unparseable_date` exists on one path, with no gate rung and no test

**Original/documented behaviour:** `src/uc05/noticePeriodCalculator.js:196–206`
states the rule outright — *"`Date.UTC` happily rolls 2026-02-29 into 2026-03-01…
A silently shifted date is far more dangerous here than a rejected one: it would
produce a confident, wrong notice-period answer that reads entirely plausible.
Round-tripping catches every such rollover."* It also accepts a full ISO
timestamp by slicing the date part, because *"the simulator crashed real
resignation requests on exactly that shape."* `src/uc05/workflow.js:262–276`
converts the resulting `RangeError` into a durable `escalate` /
`unparseable_date`, because *"a crash loses it before any audit row exists."*
**Current implementation, n8n side:**
`workflows/nodes-uc05/noticePeriodGates.js:380–385` —

```js
function fromIsoDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('Invalid YYYY-MM-DD date: ' + iso);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
```

**No round-trip check** and **no `.trim().slice(0, 10)`**. So on the deployed
graph: `2026-02-29` is silently accepted as **1 March 2026** and the discrepancy
is computed against a date the employee never wrote; and a `proposedEndDate` of
`"2026-09-15T00:00:00.000Z"` throws out of the Code node. There is no `try/catch`
anywhere in the file and no `unparseable_date` outcome — a throw ends the run,
which is upstream of `Create Resignation Record` and `Append Audit Log`, so **the
resignation leaves no record at all**. That is F-28's exact shape.
**Current tests assume:** neither input class exists.
`grep -rn "02-29\|unparseable_date" test/` returns nothing.
`test/n8nUc05Parity.test.js` feeds both copies date-only `proposedEndDate`
fixtures, so the two parsers agree perfectly on the only inputs they are given —
the failure mode `test/uc05.test.js:850` already writes down: *"Parity proves two
implementations MATCH; it never proves either is right about an input neither was
given."*
**Difference:** three at once. (1) The two execution paths disagree on the one
input class the Node parser was written to refuse. (2) The n8n path loses the
request rather than escalating it. (3) `unparseable_date` has **no rung in
`GATE_SEQUENCE`**, so `describeDecidingGate()` returns `null` and
`describeGateLadder()` returns `[]` — an escalated case whose sidebar can say
nothing about why, even though `decisionSources.js:519` already holds a written
explanation for that exact key.
**Evidence:** `src/uc05/noticePeriodCalculator.js:190–207`;
`workflows/nodes-uc05/noticePeriodGates.js:380–385`;
`src/uc05/workflow.js:262–276`; `src/uc05/policyEngine.js` `GATE_SEQUENCE`
(nine rungs, none for `unparseable_date`); `src/shared/gateLadder.js:69–105`;
`test/n8nUc05Parity.test.js:344–360`.
**Likely reason:** establishable for the divergence, not for the missing rung.
The round-trip check and the timestamp slice were both added to the Node copy
after live failures (a simulator crash, and the n8n `now` timestamp), and each
was fixed where it bit. The n8n `fromIsoDate` was never revisited, and no parity
scenario would have flagged it.
**Risk if left as-is:** on the deployed graph, a wrong statutory comparison
computed from a date the employee did not write — and, for a timestamp-shaped
input, a resignation that vanishes with nobody told.
**Recommendation:** RECONCILE. Port the round-trip check and the slice into the
n8n copy, add a parity scenario for each (a rollover date and a timestamp), give
`unparseable_date` a `GATE_SEQUENCE` rung, and decide what the n8n path does with
a refused date — it has no `workflow.js` to catch it, so the guard has to be in
the node.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-12]` `[N-13]`**

**Recommendation accepted, with the ordering made explicit because it is the part
that gets skipped.**

1. **`[N-12]` — the two parity scenarios land FIRST**: a rollover date
   (`2026-02-29`) and a full ISO timestamp (`2026-09-15T00:00:00.000Z`). Against
   today's code they must **fail**, and fail on the n8n side only. Written after
   the fix they prove nothing — both copies currently agree perfectly because
   they are only ever fed date-only fixtures, which is the failure mode
   `test/uc05.test.js:850` already writes down.
2. **`[N-13]` — then the parser**, and the guard goes **in the node**: there is
   no `workflow.js` on the n8n path to convert a `RangeError` into a durable
   escalate, and a throw today ends the run upstream of both `Create Resignation
   Record` and `Append Audit Log`, so the resignation vanishes with nobody told.
   That is F-28's shape.
3. **The same change gives `unparseable_date` a `GATE_SEQUENCE` rung**, so
   `describeDecidingGate()` stops returning `null` and the sidebar can explain an
   escalation it currently cannot describe at all. The text already exists at
   `decisionSources.js:519` and is simply unreachable.

**One thing not to do:** do not fix this by making the Node parser lenient to
match n8n. The Node copy's strictness is the correct behaviour and its reason is
written in the file — a silently rolled-over date produces *"a confident, wrong
notice-period answer that reads entirely plausible."*


---

### SPEC_DRIFT · DRIFT-063 · The resignation endpoints this repository and `00-FOUNDATION.md` both say do not exist are documented, live, and include a write shaped like UC-05's sign-off

**Original/documented behaviour:** `docs/00-FOUNDATION.md` asserts twice — in its
provenance note (~line 39) and again in §9's evidence hierarchy (line 378) — that
live spot-checks falsified several raw docs' self-declared "VERIFIED" claims,
naming three examples: *"UC-05's resignation endpoint, UC-06's
`/contract-amendments/automatable` pre-check, UC-07's atomic country-transfer
endpoint all do not exist as claimed."* `UC-05.md`'s own header repeats it in the
first person: *"**Endpoints below override all three raw docs**, live-verified
against `developer.remote.com` — none of the three docs' assumed
`/v1/resignations/{id}` endpoint or `PUT .../validate` write path exists."*
§1 turns it into the use case's defining property: *"Read + compute + inform,
never write. This is a **structural consequence of the API's shape, not a policy
choice**."*
**Current implementation:** every layer inherits the premise and cites it as the
reason for its own shape — `workflow.js`'s "THERE IS NO EXECUTION WRITE",
`resignationStore.js`'s deliberate absence of a `markExecuted()`,
`server.js`'s "NO REMOTE WRITE ROUTE — BY DESIGN", `signoffPolicy.js`'s "there is
no second fact about whether a write landed, because there is no write",
`noticePeriodGates.js`'s "the spec itself (§3) and the ticket confirm
`PUT /v1/resignations/{id}/validate` does not exist", `UC-05.md` §15's reason for
not building the spec's Tier 1, and the structural test's assertion message.
**What the check actually returns.** `docs/REMOTE-API-INDEX.txt` — Remote's own
official `llms.txt`, the artifact prime directive #4 names as authoritative —
lists **three** resignation endpoints at lines 328–330, and each one's reference
page was fetched live from `developer.remote.com` during this pass (both pages
stamped `updatedAt: 2026-05-27`):

| Endpoint | Scope | What it carries |
|---|---|---|
| `GET /v1/resignations/{offboarding_request_id}` — *Show Resignation* | `resignation:read` | `proposed_last_day`, `days_of_notice`, `resignation_date`, `resignation_reason_label`, `contract_start_date`, `contract_probation_period_end_date`, `contract_proabtion_period_passed` [sic], `contract_currency_code`, `paid_timeoffs_breakdown_labels` — all ten **required** on the after-start-date variant |
| `GET /v1/resignations/{offboarding_request_id}/resignation-letter` | `resignation_letter:read` | The resignation letter itself — the free text `letterExtractor.js` exists to read |
| `PUT /v1/resignations/{offboarding_request_id}/validate` — *Validate resignation request* | `resignation:write` | `accepts_proposed_notice` · `agrees_to_pto_amount` (+notes) · `agrees_to_resignation_reason` (+notes) · `proposed_last_date: {date, notes}` · `is_owed_outstanding_reimbursements` / `owed_outstanding_reimbursements: {amount, notes}` · `will_take_more_pto` · `has_more_salary_info` · `has_additional_information`. Responses `200/400/401/404/422/429` |

**Current tests assume:** the premise. `test/uc05.test.js:814` greps `workflow.js`
for `validateResignation`, `postResignation`, `createOffboarding` and
`validateOffboarding` and asserts each is absent *"— the spec confirms no such
write endpoint exists"*. The test is a good guard with a false reason attached.
**Difference:** four separate claims, and they do not all fail together.
1. *"UC-05's resignation endpoint … does not exist"* (Foundation, twice) —
   **wrong.** Three endpoints, with their own OAuth scopes.
2. *"none of the three docs' assumed `/v1/resignations/{id}` endpoint or
   `PUT .../validate` write path exists"* (`UC-05.md` header) — **wrong**, and
   the raw docs it overrode were right. The CHATGOT pack's §2.1 headings *Show
   resignation* / *Validate resignation* name the two real operations.
3. *"There is no `PATCH`/`PUT` for offboardings, of either type"* (`UC-05.md` §3)
   — **right.** The index carries List / Create / Show / v2 List / v2 Show /
   List-for-employment and no update verb on `/offboardings`. The resource that
   takes the update is `/v1/resignations`, not `/offboardings`.
4. *"Remote's own platform … performs no computation of what the legally correct
   notice period should be — that gap is the actual value-add"* (§0) — **not
   safe as written.** Remote describes `days_of_notice` as *"The number of
   calendar days of notice required based on the contract terms and local labor
   laws"* and `proposed_last_day` as *"calculated based on the notice period and
   local labor laws."* Whether that figure is contractual, statutory, or a blend
   is genuinely ambiguous from the description — and reconciling a contractual
   figure against a statutory one is the *sharper* version of this use case, not
   the end of it. What cannot survive is the sentence as it stands.
**Evidence:** `docs/00-FOUNDATION.md` ~line 39 and line 378;
`docs/use-cases/UC-05.md` header, §0, §1, §3, §15;
`docs/REMOTE-API-INDEX.txt:322–330`;
`https://developer.remote.com/reference/get_v1_resignations_offboarding_request_id.md`
and `…put_v1_resignations_offboarding_request_id_validate.md`, both fetched live
2026-08-20 (OpenAPI `paths`, `required` lists and parameter names read out of the
documents, not recalled);
`src/uc05/{workflow,server,signoffPolicy,resignationStore}.js` headers;
`workflows/nodes-uc05/noticePeriodGates.js:32–41`; `test/uc05.test.js:814–833`.
**Likely reason:** the mechanism is establishable and it is the same trap this
repository has documented three times. The real path is keyed by
**`offboarding_request_id`**, not by a resignation id; the raw docs wrote
`/v1/resignations/{id}`, and a probe with the wrong id — or with a token lacking
`resignation:read` — returns a `404` or a `403` indistinguishable from "no such
endpoint". `CLAUDE.md` §6 records exactly this for `fde4007b-…` (*"a dead id
produces a 404 that looks like a credential, host, or permission problem and is
none of them"*), and §7's UC-02 item records a `403 "invalid role"` that named
the credential and was an endpoint problem. **How the falsification was actually
performed cannot be established from the repository**: unlike the UC-06 example
in the same sentence — whose probe is written into `src/remote/restClient.js`
lines 842–860 with both the `200` and the `422` body — no probe of
`/v1/resignations` is recorded anywhere in `src/`, `scripts/`, or `docs/`. The
example that was written down turned out to be right; the two that were not are
now one-for-one wrong.
**Not established, and the reason matters:** whether these endpoints answer for
*this* account. There is **no `.env` in this container**, so no
`REMOTE_API_TOKEN`, so no Sandbox probe was possible — and per this repository's
own rule, a tool that cannot reach a service says nothing about the service. What
is established is documentary, at the top of §9's own hierarchy: Remote's
published OpenAPI, read today.
**Risk if left as-is:** three compounding. (a) Foundation's standing rule
*"prefer the fresh check over the inherited confidence label"* is stated on a
list of three examples of which two are now wrong — the rule is right and its
evidence is discrediting it. (b) UC-05's headline design property is presented
as forced by the API when it is a choice, so nobody ever weighs it: the human
gate this use case is built around has a Remote endpoint that records precisely
that gate's outcome, including a **counter-proposed last working day**, which is
the one thing Local HR & Legal decides and currently has nowhere to put. (c) §0's
business case may be aimed at a gap Remote partly fills, which is the kind of
claim a reviewer checks first.
**Recommendation:** HUMAN_DECISION_REQUIRED, in this order and not collapsed.
1. **Correct the record before anything is built.** Both `00-FOUNDATION.md`
   statements, the `UC-05.md` header, §1's "structural consequence", §3's row,
   and the structural test's message. Keep §3's `/offboardings` sentence — it is
   right — and stop it standing in for a claim about `/v1/resignations`.
2. **Probe, with an id from `GET /v1/offboardings` and a token carrying
   `resignation:read`**, and write the result into the code the way the
   `automatable` probe was written down — including a `403`, which would be a
   *scope* answer and not an endpoint one.
3. **Then decide the boundary on its merits.** Reading the record (DRIFT-022) is
   nearly free and strictly improves the inputs. Writing is a different decision:
   `PUT .../validate` would make an HR Ops signature an execution, which changes
   the tier's meaning, the store's shape (`markExecuted`), the audit ordering and
   what the sidebar must say. **Reading first, writing later, is available and is
   probably right** — but nothing in this repository has ever put the question.
**Confidence:** HIGH that the endpoints are documented and that claims 1 and 2
are wrong; HIGH that claim 3 is right; MEDIUM on claim 4, which needs the live
`days_of_notice` value on a real record to settle; and explicitly UNKNOWN on
whether the endpoints answer for this account.

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-1]` `[N-2]` `[N-5]`
· the write is deliberately DEFERRED**

Taken in the order the finding asks for, and not collapsed.

**1 · Correct the record first `[N-1]`.** Both `00-FOUNDATION.md` statements, the
`UC-05.md` header, §0's business case, §1's *"structural consequence"*, §3's row,
and the structural test's **message**. Nothing may be built while six files still
assert the premise is false. §3's `/offboardings` sentence is **kept** — it is
right, and it has been standing in for a claim about `/v1/resignations` that is
not.

**2 · Probe, and write the probe down `[N-2]`.** With an `offboarding_request_id`
from `GET /v1/offboardings` and a token carrying `resignation:read`, recorded in
`restClient.js` the way the `automatable` probe was — **including the failure
body**. A `403` is a scope answer and a `404` on a wrong id is an id answer;
neither is an answer about the route. That conflation is the mechanism that
produced this finding, and the client that closes it must not repeat it.

**3 · Claim 4 is upgraded from MEDIUM to HIGH, and it is the largest thing in
this pass.** The finding said §0's business case was *"not safe as written"* and
wanted a live `days_of_notice` value to settle it. It does not need one — the
**description settles it**. `days_of_notice` is *"the number of calendar days of
notice required based on the contract terms and local labor laws"*, and
`proposed_last_day` is *"calculated based on the notice period and local labor
laws."* Remote computes the notice period. §0's *"performs no computation of what
the legally correct notice period should be — that gap is the actual value-add"*
is **false**, not merely unsafe.

What replaces it is better, and is now this use case's purpose: `days_of_notice`
blends **contract** and **statute** and Remote does not say which prevails, so an
independent statute-derived figure held against it — with the **disagreement**
surfaced to a human before anyone answers `accepts_proposed_notice` — is the
product. `[N-5]`, and DRIFT-095 records the absence of that step.

**4 · The write is DEFERRED, on its own decision.** `PUT .../validate` is not
merely *shaped like* our sign-off; it **is** the employer sign-off, and
`proposed_last_date: {date, notes}` is exactly where a `statutory_discrepancy`
should go — today it escalates and dies with no counter-proposal anywhere.
Adopting it remains a separate decision because it converts a 🟡 report into a 🟡
**execution**: `markExecuted` on a store that deliberately has no mutation
method, a re-read before the write, the audit row before the call, entitlement,
and a sidebar that says the button *sends something to Remote*. It would also
satisfy `[N-15]` for free, because Remote's own offboarding flow would then
inform the employee and no notification channel need be built at all.

**Reading first, writing later, is the decision.** The read is in this queue; the
write is not, and §18 records what it would take.


---

### SPEC_DRIFT · DRIFT-064 · Sign-off is defined by a communication to the employee that no surface performs — and the unconfirmed figures reach the employee first

**Original/documented behaviour:** §5 — *"specialist confirms the math (or the
discrepancy flag) **before it is communicated to the employee**"*. §8 —
*"**Mandatory** specialist confirmation of the AI's notice-period math and any
discrepancy flag **before communication to the employee** — redefined from
'submits to Remote' (impossible, no write path) to '**confirms what gets said**.'"*
§9's first guard: *"Wrong statutory notice communicated | Deterministic tables +
mandatory specialist confirmation **before anything reaches the employee**."* §10
logs *"final communicated figures."* The confirmation is the whole point of the
human gate, and the thing being gated is a communication.
**Current implementation:** `submitResignationApproval()` writes one audit row and
moves one status. There is **no Zendesk client, no comment, no email, no
notification and no "communicated figures" record** anywhere in `src/uc05/` —
`grep -n zendesk src/uc05/*.js` returns only comments. The n8n graph's sign-off
branch does not exist at all; its two Zendesk nodes (`Flag Awaiting HR Ops
Sign-off`, `Escalate Resignation Ticket`) fire at **decision** time, before any
human has looked. And the portal returns the statutory notice line, the rule
applied, the tenure, the proposed-vs-statutory comparison and the PTO payout to
the **resigning employee** as ordinary `detail(...)` rows on their own result page
at submission (`src/portal/server.js:2992–3026`) — only *"Date came from"* is a
`specialistDetail`.
**Current tests assume:** the store transition and the audit row.
`test/portalUc05Success.test.js` asserts the employee-facing result renders. No
test asserts anything is communicated after sign-off, because nothing is.
**Difference:** the ordering is inverted. The unconfirmed figures reach the
employee immediately; the confirmed ones reach nobody. HR Ops's signature
currently changes a database column and a Zendesk ticket's state, and changes
nothing about what the employee has been told — which was already everything.
**Evidence:** `docs/use-cases/UC-05.md` §5, §8, §9, §10;
`src/uc05/workflow.js` `submitResignationApproval()`;
`src/portal/server.js:2992–3026`; `workflows/README.md` §"UC-05: the node graph";
`grep -rn "zendesk" src/uc05/`.
**Likely reason:** partially establishable. §16 argues, correctly, that a UC-05
result *"is a hand-off"* and *"nothing on a UC-05 result is the employee's to take
up"* — which explains why the result page carries no **offer**. It does not
address whether the figures themselves should be there before a human has checked
them, and no commit or note found in this pass makes that decision.
**Risk if left as-is:** the exact liability §0 says the use case exists to prevent
— *"a wrong date reaching an employee"* — is reachable without any specialist
having looked, because the specialist gate sits after the disclosure rather than
before it. And a correct, signed-off report reaches the employee never.
**Recommendation:** HUMAN_DECISION_REQUIRED, and it is one decision with two
halves. (a) Should the employee see the statutory figures at submission at all —
or should the result state that a calculation has been prepared and is being
checked, with the figures released on sign-off? (b) What does sign-off *do*
outwardly — a public ticket comment, a portal state change, an email? Until (b)
is answered, §8's "confirms what gets said" describes a step this system does not
have, and `UC-05.md` should say so rather than assert it.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-14]` `[N-15]`**

**The owner's ruling, verbatim:** *"the employee should just see the final output
after everything has been concluded and signed off internally by the
specialist."* Both halves of the finding are answered by it.

**(a) The employee sees no figures at submission `[N-14]`.** The portal returns
an acknowledgement — received, being checked by HR Ops, what happens next. No
statutory line, no tenure, no comparison, no payout. §11's new table gives the
wording per state, including the escalation row, which withholds the **reason**
as well: telling an employee *"your notice period may be 30 days short"* while
Local HR & Legal is still deciding states a disputed legal position as fact, from
the party that would owe it.

**(b) Sign-off releases the figures `[N-15]`** to the surface the employee
submitted from, plus a public comment on the ticket where one exists. **No email
and no new channel** — inventing one is a new integration, and it is the wrong
one to build if DRIFT-063's write is ever adopted, because Remote's own
offboarding flow would then do the informing.

**The same change moves the n8n graph's two Zendesk nodes.** `Flag Awaiting HR
Ops Sign-off` and `Escalate Resignation Ticket` currently fire at **decision**
time, before any human has looked — the same inversion, one layer down.

**This produces §8's new invariant 14**, and the reason it is written as an
invariant rather than a description is that it is **testable**: *no notice
figure, payout figure or comparison reaches an employee-facing surface while the
report is `pending_signoff`.* §5, §8 and §9 have all asserted this ordering since
the contract was written, and nothing has ever enforced it.

**Known and not solved by this disposition:** a portal-only submission has portal
state as its only channel, so the employee must return and look. Named in §18 as
an open question rather than papered over.


---

### SPEC_DRIFT · DRIFT-065 · None of §11's four metrics is computed, and UC-05 writes no row the dashboard reads

**Original/documented behaviour:** §11 specifies four: the **specialist-
confirmation rate** (bucket 2, `≥60%` healthy/iterate, `<30%` stop, against
`DEFAULT_THRESHOLDS`) — annotated *"Specified, not yet computed by `compute.js`
— tracking issue #20"*; the **discrepancy-catch rate**; **confirmation time vs. a
manual baseline**; and the integrity check, **zero** communicated notice dates
that later prove statutorily wrong.
**Current implementation:** still true, and broader than issue #20 records.
`src/metrics/source.js` reads `cases` and `review_queue`;
`computeMetrics()` derives `acceptRate` from `review_queue` rows joined to
`cases` by `case_id`. **UC-05 writes neither table.** `grep -rn caseStore
src/uc05/` returns nothing; the only stores it touches are `uc05_resignations`,
`audit_log`, `audit_trace` and `workflow_claims`. So `useCaseIds` — derived from
`cases.useCase` — never contains `"UC-05"`, and the use case does not appear in
the dashboard at all: no decision counts, no accept rate, no
`insufficient_data` verdict, and **no integrity-breach check**, even though
`SUCCESS_DECISIONS_BY_TIER.medium` explicitly lists `prepared_for_signoff` and
`findIntegrityBreaches()` is written to catch exactly this tier's violations.
**Current tests assume:** nothing about UC-05 metrics.
**Difference:** issue #20 reads as "one metric is pending". The true state is that
**all four are uncomputable as the pipeline stands**, and the reason is
structural rather than a missing function: the dashboard's two source tables do
not contain this use case's rows. `sign-off` and `decline` are recorded as
`audit_log` actions (`resignation_signed_off` / `resignation_declined`), which is
where the confirmation rate would have to be derived from.
**Evidence:** `docs/use-cases/UC-05.md` §11;
`src/metrics/source.js:50–67`; `src/metrics/compute.js:560–624`;
`src/metrics/compute.js:340–350` (`SUCCESS_DECISIONS_BY_TIER`);
`grep -rln caseStore src/uc0*/` → UC-01 and UC-03 only.
**Likely reason:** establishable by construction. Each use case built after UC-03
got its own dedicated store — `uc05_resignations` mirrors `uc06_amendments` and
`uc08_dossiers`, and `resignationStore.js`'s header argues at length for **not**
overloading `review_queue`, on grounds that are correct. Nothing in that argument
addresses the metrics layer, which reads only the two tables the argument moved
away from.
**Risk if left as-is:** §1 of `CLAUDE.md` names measuring impact as the
differentiator, and `docs/METRICS.md` is the artifact that demonstrates it. A
dashboard covering two of nine use cases, silently, is worse than one that says
which seven it cannot see. Concretely: nobody can answer "does HR Ops accept what
this calculates?", which is the only question that tells you whether to keep
building UC-05.
**Recommendation:** RECONCILE — and it is almost certainly **cross-cutting rather
than UC-05's**. The same is true of UC-02, UC-04, UC-06 and UC-09, all of which
write their own store. The choices are to give `computeMetrics()` a second source
(the per-use-case stores or `audit_log`'s decision actions), or to have each
store also write a thin `cases`/`review_queue` row. Until one is done, §11 should
say **"not computed"** for all four rather than for one.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-16]` · CROSS-CUTTING**

**Give `computeMetrics()` a second source over `audit_log`'s decision actions** —
not the alternative of having each per-use-case store also write a thin
`cases`/`review_queue` row. Three reasons, in order of weight:

1. `audit_log` already carries **every decision on both execution paths**,
   including the n8n graphs, which never touch `caseStore` at all. A `cases`-row
   approach would have to be built twice and would still miss anything deciding
   outside the Node app.
2. It is **append-only**, so it cannot drift from the decision it records. A
   parallel `cases` row can.
3. Adding a write to seven stores adds seven new failure modes **on the durable-
   write path** — the exact path UC-05's audit-before-state-move ordering exists
   to protect. Measurement must never be able to lose a decision.

**This is not UC-05's to own.** UC-02, UC-04, UC-06 and UC-09 are in the same
position for the same reason: `resignationStore.js`'s header argues correctly for
not overloading `review_queue`, and nothing in that argument addressed the
metrics layer, which reads only the two tables the argument moved away from. It
should be its own pass.

**Interim, and cheap:** §11 of `UC-05.md` says *"Specified, not yet computed —
tracking issue #20"* against **one** metric. All four are uncomputable as the
pipeline stands, and it should say so for all four. A dashboard covering two of
nine use cases silently is worse than one that names the seven it cannot see.


---

### SPEC_DRIFT · DRIFT-066 · Reader-facing sentences still describe a system that changed underneath them

**Original/documented behaviour:** the rule is written in this use case's own
code. `noticePeriodCalculator.js:381` on the unsupported-country citation string:
*"NO COUNT IN THIS STRING. It read 'the 9-country statutory notice table' until
2026-08-20, when the table stopped being nine countries — a number baked into a
sentence a human reads, in the one branch that exists to say we do not cover
something."* And `decisionSources.js:527` exports `SOURCED_COUNTRIES`
*"so a caller can say 'one of nine' honestly rather than counting."*
**Current implementation:** two live sentences contradict it.

1. `src/uc05/decisionSources.js:604` — `uncitedFinding()` renders
   *"This repository holds the statutory notice text for NL, PT, US only, **out of
   the nine countries in the notice table**, and GB is not among them."*
   `NOTICE_PERIOD_TABLE` has **eleven** keys (GB, IE, DE, PL, IN, PH, MX, CA, PT,
   NL, US). The count is hard-coded in the sentence beside the exported constant
   that exists to prevent exactly that. The same file's header is stale in the
   other direction: *"the notice table covers nine countries and `docs/knowledge/`
   holds the notice statute for exactly ONE of them, Portugal"* — it is now three
   — and *"the Netherlands is not in UC-05's notice table, so no UC-05 finding can
   be made from it"*, immediately above a `FINDING_SOURCES.statutory_notice_rule.
   byCountry.NL` block citing D-01 and D-40.
2. `src/uc05/decisionFacts.js:536` — the "what is not known" block tells HR Ops
   *"No balances were supplied with the request, and **this system does not read
   Remote's time-off records itself**."* It does, since §15c:
   `readTimeOffBalances()` calls `remote.listLeavePolicySummary()`, which
   `RemoteClient` implements at `restClient.js:383`. Against the real client that
   branch is now reached when Remote answered with **no policies** — so both
   halves of the sentence are wrong precisely when it renders, and the
   `whatItWouldTake` line under it asks for a read that already happened.

Also stale, for the same reason and outside `src/`: `docs/DEMO-COUNTRIES.md`
rows `UC05-NL-1` and `UC05-US-1` record both countries as
`escalate / unsupported_country` citing *"Country not in the 9-country statutory
notice table"*, an outcome §7a replaced.
**Current tests assume:** nothing about either sentence.
`test/uc05DecisionSources.test.js` asserts the citation paths exist on disk and
that no gate imports the module; it does not assert any rendered count.
**Difference:** small in isolation, and it is the class this repository has
decided matters: a fact stated to a reader that is not true of the system. The
first sentence renders on the panel of every resignation in the eight uncited
countries; the second renders on the "what is not known" block, which §14 marks
as the content most protected from compression.
**Evidence:** `src/uc05/decisionSources.js:34–45` (header), `:527`, `:600–608`;
`src/uc05/noticePeriodCalculator.js:373–388`;
`src/uc05/decisionFacts.js:533–539`; `src/remote/restClient.js:383`;
`src/uc05/workflow.js` `readTimeOffBalances()`;
`docs/DEMO-COUNTRIES.md` §UC-05 rows.
**Likely reason:** establishable. Both sentences were true when written and were
overtaken by later passes that changed the thing they describe — the NL/US rows
(2026-08-20) and the Time Off read (2026-08-19) — neither of which had reason to
open the file holding the prose.
**Risk if left as-is:** low individually; the pattern is the risk. A specialist
who catches one wrong statement discounts the rest of the screen, and this screen
is carrying the statements that most need to be believed.
**Recommendation:** RECONCILE. Derive the count from
`supportedCountryCodes().length` rather than writing it; correct the two header
paragraphs; and make the empty-balance sentence branch on `ptoSource`, which the
row already carries and which distinguishes `not_read` from `caller_supplied`
from an empty Remote answer.
**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · `[N-17]`**

**Recommendation accepted, plus a guard, because this is the second occurrence.**

- Derive the count from `supportedCountryCodes().length` rather than writing it —
  `SOURCED_COUNTRIES` was exported for exactly this, and the sentence beside it
  hard-codes "nine" for a table of eleven.
- Correct the two stale header paragraphs in `decisionSources.js`, including the
  one asserting *"the Netherlands is not in UC-05's notice table"* directly above
  a `byCountry.NL` block citing D-01 and D-40.
- Branch the empty-balance sentence on `ptoSource`, which the row already carries
  and which distinguishes `not_read` from `caller_supplied` from *Remote answered
  with no policies* — today both halves of that sentence are wrong precisely when
  it renders.
- **New: a test that no reader-facing string under `src/uc05/` carries a
  hard-coded country count.** `noticePeriodCalculator.js:381` already removed one
  such count and wrote down why; the count reappeared one file over. A rule
  recorded in a comment binds only the file it is in.

**The `DEMO-COUNTRIES.md` rows are regenerated, never hand-edited.** That file's
value is that its columns are **observed** rather than expected; hand-correcting
an observation destroys the only property that makes it worth keeping. Its UC-05
rows are stale now and `[N-7]` will stale them again, so the regeneration belongs
in that commit.


---

## 17b. SPEC_DRIFT opened by this pass — DRIFT-094 … DRIFT-097

Four findings, and **not one of them came from reading this repository's code
first.** Three came from fetching Remote's own OpenAPI, and the fourth came from
a schema shape prompting a read of a function nobody had reason to open. That
is the same pattern the fifth and sixth passes recorded: deciding a finding
opens findings, and a pass that only ever closes rows means nobody was checking
the dispositions against anything.

---

### SPEC_DRIFT · DRIFT-094 · Two intake surfaces create a record Remote forbids creating, and neither is labelled a stand-in

**Original/documented behaviour:** `00-FOUNDATION.md` §2 places UC-05 in the
Remote-native column. `UC-05.md` §2 says *"there is no API path for this
automation, or any third party, to originate that action"*, and `src/uc05/
server.js`'s header says *"No intake route — UC-05's intake is the Remote-native
webhook path."*
**Current implementation:** two surfaces originate resignations anyway. The
portal (`src/portal/server.js:2964`) presents a resignation form to an employee
persona and creates a `uc05_resignations` row from it; the deployed n8n graph's
**primary** path is a Zendesk ticket
(`workflows/nodes-uc05/normalizeResignationRequest.js`, branch A). Neither says
anywhere that it is standing in for a Remote surface.
**What Remote's documentation says**, fetched live 2026-08-21:
`CreateOffboardingParams.type` is `enum: ["termination"]`, described *"For now,
only `termination` is allowed."* The guide repeats it in prose. `requested_by` is
*"the UUID of the employee who submitted the resignation."* **A resignation can
only be created by the employee, inside Remote's product.**
**Current tests assume:** the portal and ticket shapes are ordinary intakes.
`test/portalUc05Success.test.js` asserts the employee-facing result renders.
Nothing asserts either surface is a stand-in, and nothing asserts the mock
refuses to create a resignation-type offboarding.
**Difference:** this is exactly UC-04's shape — **CREATE-BY-EMPLOYEE,
DECIDE-BY-API** — and UC-04 has already had the decision (`W-4`) and the
structural guard. UC-05 has neither. The consequence is not a bug today, because
neither surface calls Remote to create anything; it is that a reader of the
portal cannot tell a demonstration from an integration, and a future engineer has
nothing stopping them from "completing" the flow with a `POST` Remote does not
accept.
**Evidence:** `reference/post_v1_offboardings.md` and
`docs/offboarding-an-employee.md`, fetched 2026-08-21;
`src/portal/requestTypes.js`; `src/portal/server.js:2964`;
`workflows/nodes-uc05/normalizeResignationRequest.js:47–83`;
`src/uc05/server.js:11–17`. Compare `src/remote/mockServer.js:3702–3730`, which
does carry this guard **for UC-04**.
**Likely reason:** establishable. `UC-05.md` §3 has recorded the create
restriction as `[CONFIRMED — live]` since the spec was written; the portal and
the Zendesk path were added later, to make the use case demonstrable, and nothing
connected the two facts.
**Risk if left as-is:** low today, and the same class as UC-04's before `W-4` —
a demo surface indistinguishable from a product surface, on a use case whose
architecture document says the surface does not exist.
**Recommendation:** `[N-3]`. Label both as stand-ins in their own headers and on
the page, and add the structural assertion the mock already carries for UC-04 —
a resignation-type create is refused with Remote's bare `"Not Found"`.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-095 · There is no reconciliation step, and reconciliation is what this use case becomes once Remote's own figure is read

**Original/documented behaviour:** none. No document specifies a reconciliation,
because every document inherits §0's premise that Remote computes nothing.
**Current implementation:** `computeNoticePeriod()` produces a single figure and
`policyEngine.js` compares it against the employee's *proposed* date. Remote's
own `days_of_notice` is never read, never shown, and never compared — the string
`days_of_notice` appears nowhere in `src/`.
**What Remote's documentation says:** `days_of_notice` is *"The number of
calendar days of notice required based on the contract terms and local labor
laws"*, `required` on the after-start-date resignation variant.
**Current tests assume:** one figure. Every UC-05 assertion is written against a
single `noticeDays` / `noticeMonths`.
**Difference:** the comparison this system performs is *statute vs. what the
employee asked for*. The comparison that carries the risk is *statute vs. what
the employer is about to accept* — because `days_of_notice` blends contract and
statute, Remote does not say which prevails, and a contract term below the
statutory floor is precisely the failure §11's integrity metric names. **Nothing
in this system would notice it.**
**Evidence:** `grep -rn days_of_notice src/` → no hit;
`src/uc05/noticePeriodCalculator.js`; `src/uc05/policyEngine.js`;
`reference/get_v1_resignations_offboarding_request_id.md`.
**Likely reason:** fully establishable, and it is DRIFT-063's. The endpoints were
recorded as non-existent, so the field was never seen.
**Risk if left as-is:** the use case keeps computing a number Remote already
computes, and keeps missing the one comparison that would justify computing it.
**Recommendation:** `[N-5]` `[N-6]`. Three verdicts — `agree`, `remote_longer`,
`statute_longer` — plus `not_compared` naming the missing side. `statute_longer`
escalates to Local HR & Legal; `remote_longer` prepares with a flag, on the same
reasoning as `later_than_statutory`. **The positive test leads.**
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-096 · Remote publishes the letter, the PTO breakdown and the probation verdict on the resignation record, and UC-05 reconstructs all three from caller input

**Original/documented behaviour:** §3 names the resignation record as the first
data source and lists three fields from it.
**Current implementation:** the record is never read (DRIFT-022), so three
separate mechanisms substitute for it. `letterExtractor.js` — the single LLM seam
in UC-05 — parses a **pasted** resignation letter for a date and a reason. PTO is
reconstructed from caller-supplied `daysAccrued` / `daysUsed`, or from
`GET /v1/leave-policies/summary/{id}`. Probation is computed from
`probation_period_end_date` on the employment record.
**What Remote publishes on the same object:**
`GET /v1/resignations/{offboarding_request_id}/resignation-letter` (its own OAuth
scope, `resignation_letter:read`); `paid_timeoffs_breakdown_labels`, Remote's own
human-readable breakdown (*"Used until today: 60 days"*, *"Waiting for approval:
0 days"*); `contract_probation_period_end_date` **and**
`contract_proabtion_period_passed` — Remote's own probation verdict, not a date
to re-derive one from. All are `required` on the after-start-date variant.
**Current tests assume:** the substitutes.
**Difference:** an LLM seam exists to read prose that Remote will hand over as a
document, and a probation boolean is computed where Remote states one. Neither is
wrong today — the record is not read — but each is a place where this system's
answer can diverge from Remote's on the same underlying fact, with no way to see
that it has.
**Note for whoever binds to it:** `contract_proabtion_period_passed` is
misspelled **in Remote's own required list**. It must be reproduced exactly, and
a comment should say why so nobody "fixes" it.
**Evidence:** `reference/get_v1_resignations_offboarding_request_id.md`
(`ResignationAfterStartDate`, `required` list of ten);
`src/uc05/letterExtractor.js`; `src/uc05/ptoPayout.js`;
`src/remote/restClient.js:383`.
**Likely reason:** DRIFT-063's, again.
**Risk if left as-is:** modest and cumulative — three independent derivations of
facts the authority already states, on a record nobody reads.
**Recommendation:** `[N-2]`. Read all three where the record is available; keep
the extractor for stand-in traffic, and label the **stated** result against the
`[CONFIRMED]` one. Do not delete the seam — an extractor that only runs on real
inbound traffic is an extractor nobody can test.
**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-097 · A resignation dated before the start date clamps tenure to zero and computes a notice period; Remote models it as a different thing entirely

**Original/documented behaviour:** §4 requires a start date because *"every
statutory notice period is measured from length of service"*. Nothing anywhere
contemplates a resignation filed before that date.
**Current implementation:** `noticePeriodCalculator.js:169–177` —

```js
export function tenureMonthsBetween(startDate, now) {
  ...
  return Math.max(0, months);
}
```

A start date in the future yields a negative month count, which the clamp turns
into **0**. `pickBracket(rule, 0, onProbation)` then selects the **shortest**
bracket, and the case proceeds to `prepared_for_signoff` exactly as a genuine
day-one employee would — same decision, same reason, same signature, no flag.
**What Remote's documentation says:** the resignation resource has **two
variants**, and the employer's validate form differs completely between them.
`ResignationAfterStartDateRequestParams` carries seven required booleans
including `accepts_proposed_notice`. `ResignationBeforeStartDateRequestParams`
carries **one** — `proposed_resignation_accepted`. **Remote applies no notice
arithmetic before the start date at all**, and does not ask the employer to
accept a notice period, because there is none to accept.
**Current tests assume:** the case does not exist.
`grep -rn "before.*start_date\|future start" test/uc05*.test.js` → nothing.
**Difference:** an input Remote treats as a different kind of object is treated
here as an ordinary one, and the mechanism that hides it is a clamp. This is the
shape §7's other clamp findings already document — `Math.max(0, −8 − 0)` produced
a computable `$0.00` settlement with `computable: true` and a live sign-off
button. A clamp converts an anomaly into a plausible answer and removes every
trace that it happened.
**Evidence:** `src/uc05/noticePeriodCalculator.js:169–177` and `:490`;
`reference/offboardingsubmitted-1.md` components
`ResignationBeforeStartDateRequestParams` / `ResignationAfterStartDateRequestParams`,
read 2026-08-21.
**Likely reason:** establishable and benign. The clamp guards the ordinary
direction — a `null` or unparseable date producing a negative — and the
before-start-date case was never in anyone's mind because Remote's own modelling
of it had not been read.
**Risk if left as-is:** an employee who resigns before starting is told they owe
the shortest statutory notice in their country, on a signed report, computed from
service they have not begun. Low frequency; the failure is silent and confident,
which is the class this repository weights heavily.
**Recommendation:** `[N-18]`. Refuse by name — `escalate` /
`resignation_before_start_date` — distinguishable in the stored row from a
day-one employee's shortest bracket, with its own `GATE_SEQUENCE` rung. Do **not**
extend the notice table with a zero-tenure bracket: the answer is not "zero days
of notice", it is "notice does not apply to this yet."
**Confidence:** HIGH

---

## 18. Build queue — the decided changes, in order

**Read this before starting any UC-05 build work.** Eighteen changes behind a
**Step 0 of two measurements**, both of which can change the plan. Same pattern
as `qa/contracts/UC-02-acceptance.md` §18 and `UC-04-acceptance.md` §18.

Nothing in this section has been built. Every item is `DECIDED · NOT YET BUILT`
and the drift each one addresses is **still live in the code**.

---

### Step 0 — measure first. Two items, no code.

| | Measurement | Command / method | What a bad answer changes |
|---|---|---|---|
| **M-1** | Does `GET /v1/resignations/{offboarding_request_id}` answer **for this account**? | An id from `GET /v1/offboardings`, a token carrying `resignation:read`. Record the status **and the body**. | A `403` is a **scope** answer — request the scope, do not conclude the route is absent. A `404` on an id from the same list is an **id** answer. Only a `404` on a well-formed id from `/v1/offboardings` would be evidence about the route, and even then see §6's proxy note in `CLAUDE.md`. This distinction *is* DRIFT-063. |
| **M-2** | Does the Sandbox hold **any** offboarding with `type: "resignation"`? | `GET /v1/offboardings?type=resignation` | **If zero, `[N-2]`/`[N-3]` cannot be proven against real data at all.** The stand-in surfaces become load-bearing rather than illustrative, `[N-3]`'s done-criterion drops from *proven live* to *proven against the mock and honestly labelled*, and `docs/DEMO-COUNTRIES.md` must say so rather than leaving a reader to assume the Remote-native path was exercised. |

> **`M-3` was dropped, deliberately.** Probing `GET /v1/countries/USA/form?form=contract_details`
> for a notice-period property was a candidate measurement and is **not needed**:
> the owner chose to read Remote's `days_of_notice`, which already folds the
> contract term in. Recorded so it is not rediscovered as an oversight.

> **Both measurements need a live token this container does not hold** — there is
> no `.env` here, and `pg` cannot reach Supabase through an HTTP CONNECT proxy.
> Neither can be taken from a documentation session. **A tool that cannot reach a
> service says nothing about the service**; record `[UNKNOWN]` and why, never a
> guess.

---

### The nine steps

Each names its files, its tests and a done-criterion. Steps 1–3 are ordered by
dependency; 4–9 are ordered by value.

**Step 1 · `[N-1]` — correct the record.** ✅ **The documentation half was done
by the seventh pass itself, 2026-08-21.** `docs/00-FOUNDATION.md` (both
statements) and `docs/use-cases/UC-05.md` (header, §0, §1's automation-boundary
row, §3) now carry the correction, with the original wording kept visible in each
place because five documents inherited it and a reader tracing them needs to
recognise it. §3's `/offboardings` sentence was **kept** — it is right — and §3
gained three new rows for the resignation endpoints.

**What remains is one string in a test.** `test/uc05.test.js:814`'s assertion
**message** still reads *"the spec confirms no such write endpoint exists"*.
**Keep the assertion; change only the message** — it is a good guard with a false
reason attached, and a guard whose stated reason is wrong is a guard the next
engineer deletes.

**Why this step was allowed to run ahead of the queue.** Every other item here
changes behaviour and waits its turn. This one removes a **false statement about
a third party's API** from documents other work would otherwise be built on — and
DRIFT-063's own recommendation puts it first for that reason. Correcting it is
not the same act as building on it.
**Done when:** the test message no longer asserts a falsehood. *(The
documentation criterion — no document asserting the endpoints do not exist — is
already met.)*

**Step 2 · `[N-2]` `[N-4]` — read the record.** *Depends on M-1.*
`RemoteClient.getResignation(offboardingRequestId)` and
`getResignationLetter(...)`, with M-1's probe written into the file the way the
`automatable` probe was — including the failure body. `dateSource` on the
`uc05_resignations` row. `src/remote/mockServer.js` gains both routes in Remote's
real envelope shape.
**Injectable seam from the first commit**, not after a slow test surfaces it —
`CLAUDE.md` §6 records this being paid for twice.
**Done when:** a record-sourced case shows `[CONFIRMED]` provenance on the date
and a stand-in case shows **stated**, on the portal, the sidebar and the API view,
from one field rather than three derivations.

**Step 3 · `[N-3]` — Remote-native intake, and label the stand-ins.** *Depends on
M-2.*
The `offboarding.submitted` handler, the `type: "resignation"` filter, and the
`GET /v1/offboardings?type=` poll fallback. `src/portal/` and
`workflows/nodes-uc05/` headers and page copy say they stand in for Remote's own
employee self-service. **`src/remote/mockServer.js` refuses a resignation-type
create with Remote's bare `"Not Found"`, asserted structurally**, exactly as it
already does for UC-04.
**Done when:** a delivery carrying `type: "termination"` is ignored, one carrying
`type: "resignation"` is processed, and a test asserts the create refusal from
the source rather than from behaviour alone.

**Step 4 · `[N-5]` `[N-6]` — reconcile. This is the use case.**
A `reconcile()` producing `agree` / `remote_longer` / `statute_longer` /
`not_compared`, carrying **both** figures and **both** provenances. `statute_longer`
→ `escalate` / `statutory_discrepancy` → Local HR & Legal. `remote_longer` →
`prepared_for_signoff`, flagged. `not_compared` names the missing side.
Invariant 13 enforced by test. The sidebar's decision-basis block and the
approval queue view both carry the pair.
**The positive test leads**, and it is not optional: an agreeing case reaching
`prepared_for_signoff` with both figures is the only thing that distinguishes a
working reconciler from one wired inverted or never wired at all. This repository
has shipped that failure three times.
**Done when:** a `statute_longer` case escalates on a country whose statute we
hold, an `agree` case prepares, and a case with no record reports `not_compared`
rather than presenting one figure as a comparison.

**Step 5 · `[N-7]` `[N-8]` `[N-9]` — the table becomes a cross-check.**
Canada to the sourced-absence shape. The US claim narrowed in wording, behaviour
unchanged. `noticePeriodTable.js`'s header reframed. **`docs/DEMO-COUNTRIES.md`
regenerated in this same commit** — `npm run` the matrix, never hand-edit an
observed column.
**Done when:** `UC05-CA-1` and `UC05-CA-2` are observed at
`escalate / no_statutory_notice_period`, `NL` and `PT` still reach
`prepared_for_signoff`, and no row in the table carries a computed figure without
an `evidence:` tag.

**Step 6 · `[N-14]` `[N-15]` — the employee sees nothing until sign-off.**
`src/portal/server.js`'s UC-05 result becomes an acknowledgement; the figures
move behind the report's state. Sign-off releases them to the portal and to the
ticket where one exists. The n8n graph's `Flag Awaiting HR Ops Sign-off` and
`Escalate Resignation Ticket` nodes move off decision-time. **Invariant 14
enforced by test.**
**No email, and no new channel.**
**Done when:** a test drives a submission and asserts no notice figure, payout
figure or comparison appears in the employee-facing payload while the row is
`pending_signoff` — and asserts they do appear after sign-off.

**Step 7 · `[N-12]` `[N-13]` `[N-18]` — the two date defects.**
`[N-12]` first and alone: a rollover date and an ISO timestamp as parity
scenarios, **failing** against today's n8n copy. Then `[N-13]`: the round-trip
check and the slice ported, the guard in the node, `unparseable_date` given a
rung. Then `[N-18]`: `resignation_before_start_date` refused by name with its own
rung, replacing the `Math.max(0, months)` clamp's silent zero.
**Done when:** both parity scenarios pass, an n8n delivery carrying `2026-02-29`
produces a durable escalate rather than a lost run, and a future start date
refuses distinguishably from a day-one employee.

**Step 8 · `[N-11]` `[N-17]` — the sentences.**
The consent clause deleted from all three strings. The country count derived. The
two `decisionSources.js` header paragraphs corrected. The empty-balance sentence
branched on `ptoSource`. **A test that no reader-facing string under `src/uc05/`
carries a hard-coded country count.**
**Done when:** no string in `src/uc05/` offers a capability the code cannot
perform, and the guard test fails against a deliberately reinserted count.

**Step 9 · `[N-10]` `[N-16]` — the two that belong to other owners.**
`[N-10]` is `normalizeEmployment()`'s, shared with UC-06 and UC-09; it needs a
test driving a record with **both** date fields set differently, which no test
does today. `[N-16]` is the metrics layer's and covers five use cases.
**Neither should be smuggled into a UC-05 commit.** Listed here so they are not
lost, with the interim recorded: `UC-05.md` §11 says *"not computed"* for **all
four** metrics rather than for one.

---

### Dependencies, stated because they are easy to miss

- **Step 1 before everything.** Six documents currently deny the premise the rest
  of the queue is built on.
- **M-1 → Step 2 → Step 4.** You cannot reconcile a figure you cannot read.
- **Step 2 before Step 4** for a second reason: `[N-4]`'s provenance is what turns
  a disagreement into something a specialist can act on rather than two numbers.
- **`[N-12]` strictly before `[N-13]`.** Written afterwards, the parity scenarios
  prove nothing.
- **Steps 5 before the reframe is true.** `[N-9]`'s sentence is only honest once
  Canada and the US both are.
- **Step 4 before Step 6.** `[N-5]` changes *what* gets released, so decide it
  before deciding when.
- **No cross-pass dependency this time.** Unlike UC-04's `W-4`, which needs
  UC-03's `G-A`, nothing in this queue waits on another use case's decision.

### What must NOT change

1. **The mock keeps refusing to create a resignation-type offboarding.**
   Structurally asserted, same rule and same reason as UC-04's create refusal.
2. **`resignationStore` keeps having no mutation method** until the write in
   DRIFT-063 §4 is decided separately. Adding `markExecuted` speculatively is how
   a 🟡 report acquires an execution path nobody agreed to.
3. **The structural no-write test's assertion stays.** Only its message changes.
4. **Do not resolve `[N-11]` by passing `requesterType: "third_party"`.**
5. **Audit row before any state move and before any outward act**, unchanged.
6. **The US keeps refusing to compute.** `[N-8]` is wording and scope only.
7. **Tests stay hermetic.** `[N-2]`'s seam is injectable from the first commit.
8. **`docs/DEMO-COUNTRIES.md` columns are regenerated, never hand-edited.** Their
   only value is that they are observed.
9. **No contract document is fetched or manufactured.** For a US resignation the
   contract is the operative source; fabricating one fabricates the answer.

### Open questions the queue does not settle

1. **The `PUT .../validate` write.** Deferred with reasons, DRIFT-063 §4. It
   would give `statutory_discrepancy` a counter-proposal to carry and would let
   Remote inform the employee, satisfying `[N-15]` for free — and it converts the
   tier. Its own decision.
2. **What `[N-15]` does when there is no ticket.** A portal-only submission
   leaves portal state as the only channel, so the employee must come back and
   look. That may be acceptable; it is a product call, not an engineering one.
3. **Whether UC-05 owns `[N-16]` at all**, or the metrics second source becomes
   its own cross-cutting pass covering UC-02, 04, 05, 06 and 09.
4. **PT's probation bracket (C-20)** — 15 days where art. 114.º(1) gives zero. A
   second instance of `[N-7]`'s class, explicitly **not** closed by it, and it has
   had no decision pass.
