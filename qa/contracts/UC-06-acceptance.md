# UC-06 — Canonical Acceptance Contract

> **Contract Amendment / Payroll Cutoff Alignment · 🟡 Medium tier · dual control ·
> Remote-native webhook intake, with `src/remoteui/` standing in as the entry point**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-06.md` (§0–§18),
> `docs/00-FOUNDATION.md` §2/§4/§9, `docs/adr/0005-dual-control-segregation-of-duties.md`,
> `docs/verification/uc06-business-case.md`, `docs/verification/uc06-payroll-cutoff-timing.md`,
> `docs/research/{UC-06 ChatGpt v1 Build Specification, UC-06 Chatgpt v2. BUILD PACK, Remote UC-06 … Research Plan}.md`,
> `src/uc06/{policyEngine,workflow,cutoffEngine,changeParser,dualApprovalPolicy,amendmentStore,decisionFacts,slackNotifier,server,cli}.js`,
> `src/remoteui/{server,roles,employees,amendmentStatus,cli}.js`,
> `src/remote/restClient.js`, `src/remotebridge/payrollProjection.js`,
> `src/shared/{approverIdentity,escalationRouting,employeeSubject}.js`,
> `src/approvalqueue/approvalRoutes.js`, `workflows/nodes-uc06/*.js`,
> `workflows/README.md`, `docs/DEMO-COUNTRIES.md` §4.1–§4.3/§6.5/§6.6,
> `docs/INTAKE-RESEARCH.md` §5.1, `test/uc06*.test.js`, `test/remoteui.test.js`,
> `test/n8nUc06Parity.test.js`.
>
> **This contract is the intended business truth.** Where it differs from the
> current implementation, §17 says so explicitly. No code, test or document was
> changed to produce it.

---

---

## Decisions — 2026-08-21 (eighth decision pass)

**Seven findings dispositioned, four opened, three questions from the owner
answered.** Nothing in `src/`, `test/`, `workflows/` or `zaf-app/` was changed to
produce any of this. **A decision does not close a finding**: every item below is
`DECIDED · NOT YET BUILT` unless it says otherwise, and the drift is still live in
the code.

| State | Meaning |
|---|---|
| `DECIDED · BUILT` | The decision is made and the code already matches it |
| `DECIDED · NOT YET BUILT` | The decision is made; the drift is still in the code. **Most items here** |
| `DECIDED · NOTHING TO BUILD` | The decision was to keep current behaviour, or the fix is documentation only |
| `OPEN` | Not decided. Named, not guessed |

### The three decisions that change this use case

**1. Slot 1 is the employer's signature, not the requesting admin's approval.**
The owner's words: *"slot 1 should be reframed as the employer signature (Remote's
own vocabulary) rather than an admin approval."* Today `requester` is captured
(`src/uc06/workflow.js:241`) and persisted (`amendmentStore.js:40/90/147`) and
**never compared to anything**, so the person who typed the salary change can sign
the box confirming they typed it. `dualApprovalPolicy.js:13-29` states the
exemption out loud — *"the admin here IS expected to be one of the two
approvers"* — and it is the only place it is argued. `docs/adr/0005-…` argues the
opposite. UC-01 has `self_approval`; UC-09 has requester ≠ approver ≠
payment_releaser. **UC-06 is the only one of the three dual-control paths that
exempts itself, and it does so in a comment rather than in the ADR that exists to
argue exactly this.** `[A-1]` `[A-2]` `[A-3]`

*A note on the word, because it has confused readers of this file already:*
**"customer admin" is employer-side.** "Customer" means *Remote's* customer — the
client company. `UC-06.md:53` gives it away by contrast: *"Customer Admin +
**Remote** Payroll specialist"*, where only the second is qualified. So the dual
control is cross-organisational either way. What the reframe changes is whether
the employer side is represented by **the requester** or by **an independent
signatory** — and Remote's own status machine already names the second
(`awaiting_employer_signature`, `employer_signed_at`), modelled in
`src/remoteui/roles.js` as `employer`, *"the company representative, distinct from
the admin USER who operates the console."*

**2. The `automatable` pre-check gets wired (DRIFT-027 remedy (a)).** It makes
ADR-0005 true, makes §11's headline metric measurable, and creates nothing. It
also carries a trap that is named in full below and must not be lost. `[A-9]`…`[A-13]`

**3. UC-06's demonstrable countries are NL and CA — two, not four.** `[A-5]` `[A-6]`

### The owner's three questions, answered

**Q. "How can the customer admin both request and approve? Is that not wrong?"**
Yes. Decision 1 above.

**Q. "Do we have the country's own amendment form for our demo countries?"**
Three of four; the approvable path exists on two. Live probe 2026-08-18, one call
per (country, employment_model) across all 81 active Sandbox employments
(`src/remote/restClient.js:799-807`):

| Country | `GET /v1/contract-amendments/schema` | Reaches approval? |
|---|---|---|
| **NL** | 200 — 7 required, 25 properties, 15 `allOf` rules the API enforces | ✅ `UC06-NL-1` |
| **CA** | 200 | ✅ `UC06-CA-3` |
| **PT** | 200 | ❌ every PT record answers `schema_invalid` |
| **US** | **500, both models** — Sandbox-side | ❌ `country_schema_unavailable` |
| *any contractor* | 404 | — n/a: UC-06 does not apply to contractors |

`UC06-US-3` was *predicted* `dual_approval_required` and *observed*
`country_schema_unavailable` — a ⚠️ DIFF row in `docs/DEMO-COUNTRIES.md` since
2026-08-19. The US failure is not ours and it fails closed correctly:
`getContractAmendmentSchema()` returns `null`, never `{required: []}`, because an
empty required list validates any payload at all.

**Q. "I saw a Slack alert in one of the expected business outcomes — am I supposed
to connect Slack for this demo and this role?"**
No, and the recommendation is not to. The alert is **built and safe**
(`src/uc06/slackNotifier.js`, injected at `workflow.js:80`, `SLACK_WEBHOOK_URL`
unset ⇒ true no-op, and `npm test` always runs it unconfigured). Three reasons:
the role's posting names n8n, Zendesk + ZAF, REST, webhooks and MCP — **not
Slack**, so it is not scarce evidence; this repository already demonstrates the
*interesting* version of the claim better, in `RCX OPS · Error Alerts`, which
writes a durable `ops_alerts` row **first** and then pushes, with the push set to
continue-on-error — *the row is the alert, the push is a convenience*; and a
second push channel demonstrates nothing the first does not. **What is genuinely
wrong is the wording**: §11/§15 present the alert as a business *outcome* while
the variable is unset, which is built-vs-provisioned — the exact gap
`APPROVER_ROLES` sat in for two days on the deployment. `[A-7]` `[A-8]`

### The trap inside decision 2, which must not be buried

Wiring the pre-check exactly as §5 specifies ships a branch that **has never
executed and cannot execute anywhere this project can currently reach**:

- the one live capture is `automatable: false`
  (`src/remote/restClient.js:842-860`, 2026-08-18);
- `src/remote/mockServer.js:3222` **hard-codes `false`**.

This repository has paid for that shape three times — UC-03's alpha-3 comparison,
UC-03's unnameable sanctions codes, UC-04's employer-permission block. **A gate
that cannot fire and a gate being careful are indistinguishable from outside**, and
no amount of negative testing separates them. So `[A-10]` — a fixture that answers
`true`, with the **positive test leading** — is not optional decoration on
`[A-9]`; it is the half that makes `[A-9]` verifiable.

Sharper still, and it belongs in the metric rather than in a comment: the live
`message` is a generic UI string — *"By pressing 'Submit amendment request' you
will begin the contract adjustement process for this employee. This does not
automatically result in a contract change."* That reads like a constant, not a
per-amendment compliance verdict. **We cannot distinguish "Remote judged this
amendment not automatable" from "the Sandbox always answers false."** `[A-12]`

### Where a fabricated fixture is allowed to come from

`[A-10]` fabricates a response this project has never captured, and the mock's
standing rule is that it reproduces captured live shapes verbatim — that is why it
404s and 422s the way it does. **This is authorised, and it is authorised by a
rule rather than by an exception.** See §18a, *the substitution ladder*, recorded
here because burying it is how the last three instances each got re-argued from
scratch.

### The eighteen-item... no: the thirty-two-item change list

**Prefix `A-` is new and deliberately does not correspond to any other use case's**
— UC-01 `G-1`…`G-4`, UC-03 `G-A`…`G-C`, UC-02 `E-1`…`E-3`, UC-04 `W-1`…`W-10`,
UC-05 `N-1`…`N-18`, UC-06 `A-1`…`A-32`. **Six schemes, none corresponding.**
`CLAUDE.md` §7 item 20 is why: this repository already carries two registers both
numbering findings `C-N`, with code citing both, and a reader following a citation
can land on a confident, specific, entirely unrelated finding.

| # | Change | From | Kind |
|---|---|---|---|
| `A-1` | The requester may not fill slot 1 — refusal `requester_cannot_approve`, **distinct** from `same_person_cannot_fill_both_roles` (different triage) | DRIFT-098 | code |
| `A-2` | Slot 1 is renamed to the **employer signature**: `customer_admin` → `employer` across `dualApprovalPolicy.ROLES`, the ZAF panel labels, `USE_CASE_ROLES` and `APPROVER_ROLES` keys, and `adminApproval` → `employerApproval` | owner | code |
| `A-3` | Migration: rows and env values already carrying `customer_admin` keep resolving, via a read-alias — the same pattern `denied_by` → `declinedBy` already uses | `A-2` | code |
| `A-4` | Distinguish the employer's **consent** (`src/remoteui/`) from the employer's **signature** (slot 1), or collapse them | `A-2` | **`HUMAN_DECISION`** |
| `A-5` | State that UC-06's demonstrable countries are **NL and CA** | owner Q2 | docs |
| `A-6` | US stays in the demo set as a **labelled refusal**; PT's `schema_invalid` documented, not seeded around | owner Q2 | docs |
| `A-7` | Label the Slack alert **built, unprovisioned**, naming `SLACK_WEBHOOK_URL` | owner Q3 | docs |
| `A-8` | Option: route the urgent-cutoff alert through the existing `ops_alerts`-then-push path rather than a second integration | owner Q3 | **`OPEN`** |
| `A-9` | Call `checkContractAmendmentAutomatable()` in `evaluate()` — after the schema gate, before dual-approval routing | DRIFT-027 | code |
| `A-10` | A mock fixture that answers `automatable: true`, and **the positive test leads** | DRIFT-027 | code |
| `A-11` | An unreachable check is **not** `false` — flag `automatable_check_unavailable` → dual approval (fail-closed) | DRIFT-027 | code |
| `A-12` | §11's metric carries the "cannot distinguish judgement from constant" caveat | DRIFT-027 | docs |
| `A-13` | Spec test 1 gets a test; `test/uc06.test.js`'s header says **7** scenarios, not 6 | DRIFT-027 | code |
| `A-14` | Correct both `00-FOUNDATION.md` sentences claiming the endpoint does not exist | DRIFT-028 | docs |
| `A-15` | Re-probe **UC-07's** atomic country-transfer endpoint — the third absence in the same sentence, never re-checked | DRIFT-028 | research |
| `A-16` | Rewrite three `UC-06.md` §15 rows (the retired `PATCH`, the payload gap marked Open that is closed, the n8n row saying "deliberately NOT activated") | DRIFT-029 | docs |
| `A-17` | Fix two sentences in `workflows/README.md` naming the retired write | DRIFT-029 | docs |
| `A-18` | Rename `test/uc06.test.js` scenarios 1 and 6 — **titles only**; the assertions already assert the correct write | DRIFT-029 | code |
| `A-19` | Record that the payroll projection was **owner-directed demo infrastructure**, with the instruction quoted and dated | DRIFT-030 | docs |
| `A-20` | State that the approvable path is reachable **only** through the projected calendar, and name `STANDIN_PAYROLL_HORIZON_MONTHS=0` as the way to reproduce the refusal through the same URL | DRIFT-030 | docs |
| `A-21` | Every "UC-06 works end to end" claim carries that clause | DRIFT-030 | docs |
| `A-22` | Correct the implication: production is stopped by the **employment roster**, not the calendar — 9 of 26 refusals are `schema_invalid`, only **1** is `no_matching_payroll_cycle` | DRIFT-030 | docs |
| `A-23` | Reframe the stand-in as a **credential-free demonstration of the human's entry point**, in four places (`UC-06.md` §2 and §15, `src/remoteui/server.js`'s header, `BUILD-LOG.md` §3.18) | DRIFT-031 | docs + code comment |
| `A-24` | Note that §2 and §3 of `UC-06.md` already contradicted each other — §3 has carried `contract_amendment.submitted` as `[CONFIRMED]` the whole time | DRIFT-031 | docs |
| `A-25` | Re-run `evaluateCutoff()` inside the freshness block, against a **re-read** calendar | DRIFT-061 | code |
| `A-26` | Distinct refusal `cutoff_lock_passed_since_decision` — never the request-time `cutoff_lock_passed` | DRIFT-061 | code |
| `A-27` | Release the execution claim, exactly as `employment_no_longer_active` does | DRIFT-061 | code |
| `A-28` | A test that advances the clock past a cutoff **between** the two signatures. None exists | DRIFT-061 | code |
| `A-29` | Invariant: a since-decision refusal is **never** silently re-drafted against the next cycle | DRIFT-061 | code + docs |
| `A-30` | `src/remoteui/` applies the shared routing table alongside its outcome tags — **copy `src/portal/server.js:1417+`, do not re-derive** | DRIFT-062 | code |
| `A-31` | A test asserting the `queue_*` tag. The current one asserts `tags === outcomeTags(decision)` — positive-only about tags that exist, therefore silent about the one that does not | DRIFT-062 | code |
| `A-32` | Record that existing UC-06 tickets stay unrouted — creating routing fixes the **next** hand-off, never the backlog (the ticket #51 lesson) | DRIFT-062 | docs |

**Twelve are documentation, eighteen are code, one is research, one is a human
decision.** The documentation half is what this pass performs; everything marked
`code` is queued in §18 and deliberately not built.

### One thing that was checked rather than assumed

`dualApprovalPolicy.js` was read in full before decision 1 was written, because a
missing control and a control that is deliberately scoped narrower look identical
from a finding. It is not missing anything else: `role_already_approved`,
`same_person_cannot_fill_both_roles` (canonicalised via `isSameApprover()`, after
an exact-match check was walked past with a trailing space and a capital letter),
and `entitlement.check()` consulted last and able only ever to refuse, are all
present and all correct. **The requester comparison is the only one absent**, and
`requester` is sitting on the row unused.

---

## 1. Business purpose

A company admin changes somebody's employment terms — pay, title, hours — and
names the day it takes effect. Two things can go wrong, and only one of them is
about the contract.

The first is the **contract** being wrong: the wrong person, the wrong old value,
a change the country's own amendment form cannot even express. The second is the
**calendar**: every payroll run locks before it pays, and a change filed after
that lock does not simply arrive late — it produces a retroactive correction on a
run that has already been costed and, downstream of that, a pay packet that is
wrong. `docs/verification/uc06-payroll-cutoff-timing.md` establishes the deadline
is real rather than an internal buffer (gross-to-net recalculation, IRS deposit
schedules, NACHA settlement windows, the UK's on-or-before-payday RTI filing all
consume time nobody controls) while recording plainly that **why the 5th
specifically stays `[UNCONFIRMED]`** — no source audits that number and this
project does not manufacture one.

UC-06 answers both questions deterministically, drafts the complete next-state
record, and puts it in front of **two different people** who are deciding two
different things. It never decides, and one signature executes nothing.

**Two different people on two different sides.** One signature is the employer's,
accountable for the contract; the other is Remote's, accountable for the run. That
is cross-organisational four-eyes, and it is the stronger form of the control. It
is also, today, defeatable: the employer-side slot may be filled by the very person
who filed the request, so it can never disagree with itself. `[A-1]` `[A-2]` — the
Decisions box above has the reasoning and `docs/adr/0005-…` has the correction.

## 2. Primary operator persona

**Role — three actors, and which side of the relationship each sits on.**
"Customer" throughout this use case means *Remote's* customer, i.e. the client
company, so **two of the three are employer-side**:

| Actor | Side | Act |
|---|---|---|
| `company_admin` (`admin_jane`) | employer — the console operator, company owner or super admin | **files the request** |
| `employer` (`company_owner`) | employer — the signing representative, *"distinct from the admin USER who operates the console"* (`src/remoteui/roles.js:24`) | **signs slot 1** `[A-2]` |
| Remote payroll specialist | Remote | **signs slot 2** |

The employee is a consent party, not an approver. **Today slot 1 is labelled
`customer_admin` and may be filled by the requester** — that is DRIFT-098 and
`[A-1]`/`[A-2]` correct it. Remote's own status machine already names the
signatory this reframe uses: `awaiting_employer_signature` / `employer_signed_at`.
**Experience/knowledge:** the admin knows their own people and what they agreed
to pay them; the payroll specialist knows the run calendar, what a lock means,
and what a retroactive correction costs.
**Typical working context:** the admin acts in Remote's own product (stood in for
by `npm run remoteui`); both approvers act in a Zendesk ticket with the ZAF
sidebar open, often days after the request.
**They understand:** old value, new value, effective date, who it is about, which
payroll run that date falls in, and what happens if it misses.
**They DO NOT know:** `uc06_amendments` and its two approval-slot columns,
`schema_invalid` / `change_not_expressible` / `cutoff_lock_passed` as strings,
the `allOf` if/then/else resolution in `effectiveSchema()`, that a payload is
built from a live JSON Schema at all, that `annual_gross_salary` is ×100 minor
units, or that a cycle id beginning `standin-` was projected rather than read.

## 3. Job to be done

*Admin:* "Change this person's terms from this date, and tell me now — not after
payroll — if that date will not work."
*Payroll specialist:* "Show me whether this lands in a run I can still carry, and
let me sign for the payroll half without also being asked to vouch for the
contract half."
*Employee:* "Tell me what my employer is changing and let me consent to it."

## 4. Starting preconditions

- An employment record exists, is **`active`**, and its `company_id` equals the
  `companyId` on the requester's authenticated session. Both values must be
  present — `null === null` is not a match, and was reachable once.
- The proposed changes arrive as **structured data**: old and new values per
  field. Never text an LLM extracted a figure from.
- The country publishes a contract-amendment form:
  `GET /v1/contract-amendments/schema?employment_id=&country_code=&form=contract_amendment`
  answers 200. Live this holds for `eor` and `global_payroll` models across
  NLD/DEU/GBR/FRA/CAN/SGP/PRT; **every `contractor` 404s and USA answers 500**.
  Against the four demo countries this means **NL, PT and CA have a form; the US
  has none**, and only NL and CA reach an approvable amendment — PT's records fail
  the form they are given. `[A-5]` `[A-6]`
- The assembled payload is **valid before the `automatable` pre-check is called**,
  because `/automatable` takes the identical body as the write and 422s an invalid
  one. So the pre-check sits after the schema gate, never before it. `[A-9]`
- The employment carries the fields that country's form requires. Live this is a
  property of the **employment model, not the country**: `global_payroll_employee`
  records carry 23–28 `contract_details` keys, EOR `employee` records carry 4–6
  and contractors carry 2 (`DEMO-COUNTRIES.md` §6.5).
- A payroll cycle exists whose period covers the requested effective date, and
  its lock has not closed.
- For the write: the employment carries an `active_contract_id`, read at approval
  time and never at request time.

**Not required, and deliberately not sought: a second Remote-side approver.** The
dual control here is cross-organisational by design — employer and Remote — so
adding a second Remote signature would deepen one side and leave the other
unchanged. What `[A-1]` adds is independence *within the employer side*, which is
the side that currently has none.

## 5. Main successful journey

1. A company admin asks to change a named employee's terms from a named date.
2. The system confirms the admin acts for the company that employs that person,
   and that the employment is live.
3. It fetches **that country's own amendment form** and works out what a complete
   amended record has to contain — including the rules that only apply to this
   payload (a fixed-term contract must state an end date; a part-time one must
   state its weekly hours; a full-time one must *not* carry the part-time
   confirmation).
4. It assembles the whole next-state record — the requested changes plus every
   current value carried through unchanged — and checks it against that form. A
   field nothing can supply is named, never guessed.
4b. It asks Remote whether it would apply this amendment itself
   (`POST /v1/contract-amendments/automatable` — a check that creates nothing).
   **If yes**, Remote's own engine amends and sends the updated document, and no
   human is asked: dual control is a deliberate addition on top of Remote's
   automation, not a duplication of it. **If no**, the case continues below. **If
   the check could not be reached, that is not a "no"** — it is no answer, and the
   case continues to dual approval with `automatable_check_unavailable`
   recorded. `[A-9]` `[A-11]`
5. It reads the payroll calendar for that person's country and finds the run the
   effective date falls in. If two runs cover it and they lock at different times,
   it says so and stops rather than picking one.
6. It checks the lock: comfortably ahead, or **within 48 hours** — in which case
   the case is marked urgent and a Slack alert goes to Payroll Ops. *(The alert is
   built and safe; it is **unprovisioned** — `SLACK_WEBHOOK_URL` is unset, so it is
   a true no-op today. `[A-7]`)*
7. The decision is recorded, the amendment is stored, and a Zendesk ticket is
   created carrying the outcome and everything already gathered.
8. Two people sign in the sidebar, in either order: the **employer's signatory** —
   who is **not** the person who filed the request — confirming the contract
   change, and a **Remote payroll specialist** confirming payroll can carry it.
   Neither can be the other, and neither can be the requester. `[A-1]` `[A-2]`
9. On the second signature the system re-reads the employment, confirms it is
   still active, re-reads **the payroll calendar** and confirms the lock it decided
   against has not since closed, reads the contract that is active *now*, and files
   one contract amendment at Remote. `[A-25]`
10. The requester can see, on the page they filed from, what the two humans did.

**On the escalation path:** the amendment is recorded with the deciding gate
named in plain words and the whole ordered ladder shown, no approve control is
offered anywhere, and the ticket says which team owns it.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Structured change, active employment, form satisfied, lock comfortably ahead | `dual_approval_required` / `all_gates_passed`, no flags | Two signatures → one `POST /v1/contract-amendments` → the contract change is filed at Remote |
| Same, but the lock closes within 48h | `dual_approval_required` / `all_gates_passed`, flag `urgent_cutoff`, request risk raised to `high` | Same path, plus a Slack alert to Payroll Ops naming the hours remaining and linking the ticket |
| The covering run's lock has already closed | `escalate` / `cutoff_lock_passed`, flags include `retroactive_change` | No approve control exists. Moving somebody's effective date is a decision, not a re-draft against the next cycle |
| No run covers the effective date | `escalate` / `no_matching_payroll_cycle` | Usually the date is beyond the last published cycle; the contract change may be sound and simply have nowhere yet to be paid from |
| Two runs cover it with **different** locks | `escalate` / `ambiguous_payroll_cycle`, **`cycle: null`**, both candidates listed | The payroll specialist settles it. Recording one candidate would put a coin-flip lock in the audit trail. Live, NL June genuinely has two, ten days apart |
| Two runs cover it that **agree** on the lock | Not ambiguous — proceeds | Every candidate answers the only question this gate asks identically |
| The run exists but its lock timestamp is unreadable | `escalate` / `cutoff_date_unknown` | "Cannot prove" is not "yes". NaN compares false against everything, which used to report a comfortable runway derived from no information |
| A required field no record carries | `escalate` / `schema_invalid` + `missing_<field>` per field | Named, never defaulted. Live: `missing_default_weekly_hours` on a part-time NL record; five named fields on a PT EOR record |
| The form has no field for the requested change | `escalate` / `change_not_expressible` | Reported **before** validation: the payload no longer contains the change, so "valid" would be a verdict about a different amendment |
| The stated new value is blank, null, NaN or a quoted amount | `escalate` / `change_value_underivable` | The most actionable message in the ladder. A quoted amount is refused, not coerced — coercion is how a 100× scaling error reaches payroll |
| Salary decrease | Form requires `salary_decrease_reason` + `was_employee_informed`; absent → `schema_invalid` naming them | Both are human judgements. Live NL: an identical payload 200s as an increase and 422s as a decrease |
| The country publishes no amendment form | `escalate` / `country_schema_unavailable` + `upstream_country_schema_error` | Deliberately **not** treated as a form with no requirements — an empty required list validates any payload |
| Employment not active | `escalate` / `employee_not_active` | Nothing about the change or the calendar was looked at |
| Identity not verified | `escalate` / `identity_not_verified` | A ticket requester legitimately lands here: an authenticated person is not an authenticated company-admin session |
| The employment read itself failed | `escalate` / `upstream_record_not_found` \| `upstream_unavailable`, ahead of identity | A gate that refuses on a record never loaded names the wrong cause |
| Duplicate delivery under one external ref | One claim, one amendment row, one audit row; the second returns `duplicate: true` | The guarantee is `workflow_claims (use_case, external_ref)`'s PRIMARY KEY, not application code |
| **Remote answers `automatable: true`** | `auto_executed` / `remote_engine_applied` — no approval slots offered, no ticket raised for signature | Remote's own engine amends and sends the updated document. This is the zero-touch tier §5 has always specified and the code has never had. **`[A-9]`, and unverifiable without `[A-10]`** — the one live capture and the mock both answer `false` |
| **Remote answers `automatable: false`** | Unchanged: continues to the calendar gates and dual approval | This is every observed response to date, which is exactly why the `true` branch needs a positive test rather than an assumption |
| **The pre-check could not be reached** (transport, 5xx, timeout) | Continues to dual approval, flag `automatable_check_unavailable`, reason unchanged | `false` is Remote's judgement; unreachable is **no judgement**, and reading one as the other is the same class of error as treating a 404 schema as a form requiring nothing. Fail-closed direction: more human review, never less. `[A-11]` |
| **The requester attempts to sign slot 1** | Refused `requester_cannot_approve` (409), refusal audited | Distinct from `same_person_cannot_fill_both_roles` on purpose — one says *you already signed the other slot*, the other says *you asked for this*. Different afternoons of work for whoever triages it. `[A-1]` |
| **A US employment** | `escalate` / `country_schema_unavailable` + `upstream_country_schema_error` | The Sandbox answers **500** for every US employment, both models. Kept in the demo set as a labelled refusal rather than dropped, because a refusal that names its cause is a legitimate beat and dropping it would hide a real limitation. `[A-6]` |
| **A PT employment** | `escalate` / `schema_invalid`, five named missing fields | PT publishes a form no PT record in the Sandbox satisfies. Documented, **not** seeded around — seeding a compliant record is roster work with no code in it. `[A-6]` |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **One approver signs and nobody else ever does** | `approved_awaiting_second`. Status stays `pending_dual_approval`, `executedAt` null, nothing reaches Remote. **No expiry, no reminder, no lapse** — see DRIFT-041 and DRIFT-061 |
| **The cutoff passes while the case waits for its second signature** | ⚠️ **Nothing re-checks it today.** The lock is evaluated once, at request time; the freshness re-check re-reads the employment's status and its active contract, not the calendar. **DECIDED `[A-25]`…`[A-29]`:** re-run `evaluateCutoff()` inside the freshness block against a re-read calendar, refuse with `cutoff_lock_passed_since_decision`, release the claim, and never silently re-draft against the next cycle. This is the most likely path in practice — an `urgent_cutoff` case is by definition inside 48 hours and dual approval routinely takes longer |
| **The requester tries to sign slot 1** | ⚠️ **Permitted today.** `requester` is captured and persisted and never compared to either approver. DECIDED `[A-1]`: refused `requester_cannot_approve` |
| **The pre-check is unreachable at decision time** | Continues to dual approval carrying `automatable_check_unavailable`. Never recorded as `automatable: false` `[A-11]` |
| **An `APPROVER_ROLES` value still says `uc06:customer_admin` after the rename** | Must keep resolving. `[A-3]` adds a read-alias — the same pattern `denied_by` → `declinedBy` already uses. A rename that silently stops recognising a live env value takes the control **down**, which is worse than the defect it fixes |
| **The same person tries to fill both slots** | Refused `same_person_cannot_fill_both_roles` (409), and the refusal is itself audited. Comparison is canonicalised (`isSameApprover()`), because an earlier exact-match check was walked past with a trailing space and a capital letter |
| **One role signs twice** | Refused `role_already_approved` |
| **Approve attempted on an escalated amendment** | Refused `not_awaiting_approval` (403). The safe path must not double as an execute button |
| **Approve attempted on a settled amendment** | Refused `already_decided`, with the *specific* sentence: which outcome, both signatures by name and time, the note, and **whether the write to Remote actually landed** — the last of which decides whether the contract changed or only the record of it |
| **Both approvals land simultaneously** | `claimForExecution()` is a compare-and-set; exactly one caller wins, the loser gets `execution_already_claimed` and an audit row. Pinned by a `Promise.all` test |
| **The employment goes inactive between request and second approval** | `employment_no_longer_active` (409), an `amendment_execution_blocked` audit row, and the execution claim is **released** — nothing was written |
| **The record carries no `active_contract_id`** | `amendment_contract_unavailable` (409). A refusal, never a write with a null |
| **The write fails after the claim** | The claim is deliberately **not** released. An in-doubt write must not hand the retry button back automatically |
| **The audit backend is unavailable at approval** | `logDurable()` runs *before* the write. History may say "both approvals recorded" while the amendment still reads pending — visible and safely retryable; never a real payroll write with no record of who authorised it |
| **Zendesk fails after the decision** | The amendment and audit row already exist. Pinned by a test using a deliberately throwing Zendesk client |
| **Slack is down or unconfigured** | A true no-op. Never awaited, never rejects, never touches `decision` or `flags` |
| **An approver names a role they do not hold** | Refused by entitlement — consulted **last**, able only ever to refuse, applying to `decline` as well as `approve`. `approver_entitlement_not_configured` is deliberately a different refusal from `approver_not_entitled` |
| **`role` is supplied in the request body** | ⚠️ It is. The ZAF token carries no role claim, so the signed identity establishes *who* and the body claims *as what*. `APPROVER_ROLES` is what closes it; where entitlement is unconfigured (seeded in-memory demo) nothing checks the pairing |
| **The requester supplies `now`** | ⚠️ On the stand-in, `POST /api/submit` accepts `body.now` and it decides the cutoff verdict. Intended as a demo affordance for deterministic scenarios; it means the deciding input of the cutoff gate is caller-supplied on that surface |
| **A contractor employment** | The form 404s → `country_schema_unavailable`. Correct, and it means UC-06 does not apply to contractors at all |
| **A US employment** | The form answers **500** → `country_schema_unavailable` + `upstream_country_schema_error`. The reason names the upstream rather than a policy, which is the whole point of `upstreamFailure.js` — and it means UC-06 is undemonstrable on the account's largest country |

## 8. Invariants — must never happen

1. **One signature never executes anything.** Both slots filled, by two different
   people, before any Remote write.
2. **The same identity never fills both slots**, whatever case, spacing or
   confusable characters it is typed with.
3. **An LLM is never the source of a figure.** `changes` arrives structured;
   `draftSummary()` produces display text that is never re-read into a decision
   or a payload.
4. **The narrative-faithfulness verdict is never read by a gate.** It is attached
   for a human to see, and `not_evaluated` is an explicit state rather than a
   fabricated verdict in either direction.
5. **Money crosses the boundary ×100 exactly once**, on the way out, and the
   record's own already-scaled values are carried through unrescaled.
6. **A schema that could not be fetched is never treated as a schema requiring
   nothing.** `{required: []}` validates any payload at all.
7. **A missing value is never defaulted.** Not a currency, not a seniority flag,
   not a decrease reason, not a zero.
8. **A payload never carries a key a closed form does not declare.** Under
   `additionalProperties: false` an extra key is a rejection, not a harmless extra.
9. **A cutoff verdict is never produced from an unreadable timestamp or an
   unreadable clock.**
10. **An ambiguous calendar never records a chosen cycle.**
11. **A retroactive change is never quietly re-drafted against the next cycle.**
12. **The decision is durably recorded before any outward act**, and each
    approval is audited before the state moves.
13. **A projected payroll cycle is never presented as a real one** — the audit row
    carries `cutoffCycleProjected` and the stand-in's own marker verbatim, rather
    than leaving an auditor to infer it from an id prefix.
14. **The n8n graph never executes the write.** It can only reach
    `dual_approval_required` or `escalate`; both branches record and route.
15. **The requester never signs.** Neither slot, whatever role is claimed. UC-01
    (`self_approval`) and UC-09 (requester ≠ approver ≠ payment_releaser) already
    hold this; UC-06 is the one that exempted itself, and did so in a code comment
    rather than in the ADR that exists to argue it. `[A-1]`
16. **An unreachable `automatable` check is never read as `automatable: false`.**
    `false` is Remote's judgement about this amendment; unreachable is no
    judgement at all, and the two select different human behaviour. `[A-11]`
17. **An amendment refused because its lock closed since the decision is never
    silently re-drafted against the next cycle.** Moving somebody's effective date
    is a decision, not a re-draft — §6's request-time row already says this, and
    it applies unchanged at approval time. `[A-29]`
18. **A projected payroll cycle never becomes a real one by being re-read.** The
    freshness re-check must consult the same calendar source the decision used,
    resolved from the row's durable `source`; re-reading a `standin-` decision
    against the raw gateway would refuse every demo amendment for the wrong
    reason. `[A-25]`

## 9. AI responsibilities

**The LLM may:** draft the one-sentence plain-English restatement of the change
for the two approval screens (`draftSummary()`), retried 3× with backoff and
falling back to a deterministic template that is *the same function forced into
its unconfigured branch*, never a hand-maintained string.

**The LLM must never:** supply or alter any figure, classify the amendment type
(`amendmentType()` is pure arithmetic over the structured values — `null >= null`
once typed a figure-less amendment `SALARY_INCREASE`), submit an amendment,
bypass either approval slot, or influence any gate.

**What reaches OpenAI, stated precisely:** the prompt carries the real salary,
title and hours figures and no name or employment id — confidential financial
data reaching a subprocessor, not PII in the regulatory sense. The narrower real
gap is `reasonText`, which is free text and not guaranteed clean of a name
(`docs/adr/0009-sensitive-data-to-llm-policy.md`, issue #21).

## 10. Deterministic responsibilities

Identity and company match · employment status · fetching the country's own
amendment form · sourcing every required field **under its own name** from the
record's own blocks · resolving the form's `if`/`then`/`else` rules against the
candidate payload · money ×100 · completeness validation against the *effective*
required list · payroll-calendar read narrowed by country · ambiguity detection ·
UTC-pinned lock arithmetic · the 48-hour window · both approval slots ·
segregation of duties · the execution claim · the freshness re-check · audit
ordering.

Two things this deliberately does **not** do, each stated rather than hidden:
`x-jsf-logic` computed minimums (the Dutch part-time salary floor) are not
evaluated — the write fails loudly against them rather than this repo
re-implementing a rules engine; and an `if` condition the resolver does not model
returns **`null`, not `false`**, because returning `false` silently selected the
`else` branch, which is where these forms put their prohibitions. Production
execution 5098 passed a 72,000 → 66,000 decrease through the schema gate with
neither statutory attestation because of exactly that.

The gates exist twice — `src/uc06/policyEngine.js` and
`workflows/nodes-uc06/amendmentGates.js`. `test/n8nUc06Parity.test.js` executes
the real node body against the real functions across 11 scenarios.

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Every non-escalated amendment **that Remote itself would not apply**. Today that is every amendment, because the `automatable` pre-check is not called — DRIFT-027, decided `[A-9]` |
| **Who** | **Two named slots, two different people, either order, and neither of them the requester.** `uc06:employer` decides about the *contract* on the company's behalf; `uc06:payroll_specialist` decides about *execution*. `slotsRequired: 2` in `src/approvalqueue/approvalRoutes.js`. ⚠️ **Today the first slot is `uc06:customer_admin` and the requester may fill it** — `[A-1]` `[A-2]` `[A-3]` |
| **Where** | The ZAF sidebar's UC-06 panel — two independently-gated role blocks, each with its own approver field, note and approve/decline pair. `POST /uc06/api/amendments/:id/approve\|decline` |
| **Evidence needed** | Split by decider, deliberately: the admin sees the diff, the delta, the effective date and whether the form can express the change; the specialist sees the governing cycle, its period, its lock instant, hours remaining, and which cycles disagree when they do. Money is formatted against its own currency and the ×100 form is labelled as *what will be sent*, never as a second opinion about the amount |
| **After both approvals** | One `POST /v1/contract-amendments` with the amendment's own id as the idempotency key, then `amendment_executed` and `markExecuted` |
| **After a decline** | Either role's decline ends the amendment for **both** slots; the other is not asked and the request has to be filed again |
| **Escalation owner** | **Payroll Ops** (`queue_payroll_ops` / `escalation_payroll_ops`), the group exists live. UC-06 is the **only** use case the priority engine gives a real due date, because the payroll lock is a genuine clock rather than an invented SLA |
| **Expiry** | **None**, and that stays true — DRIFT-041 is system-wide and is not being solved here. But UC-06's sharper version **is**: the deadline is computed, stored on the row, surfaced to the specialist, used by the priority engine — and never re-checked at the moment it expires. Decided `[A-25]`…`[A-29]` |
| **If nobody responds** | The amendment waits indefinitely. The Slack alert fires **once**, at decision time. Decided: re-alert on the `cutoff_lock_passed_since_decision` refusal rather than on a timer, because that refusal is the moment a human must act and a timer would fire on cases nobody needs to see. `[A-7]` |
| **Consent** | The employee consents to their own contract and the employer consents on the company's behalf, recorded durably in `audit_log` first and then as a best-effort ticket note. It is a **stand-in demonstration of the signature stage and is not a gate** — an amendment executes whether or not either party consented. Stated here because the spec states it, and because a reader of the roles table would otherwise reasonably assume otherwise |
| **Consent vs. signature — `OPEN`, `[A-4]`** | After `[A-2]`, the employer appears twice: once consenting in `src/remoteui/`, once signing slot 1 in the sidebar. **These are treated as different acts** — consent is *"I agree to this change"*, the signature is *"I authorise it to be filed"* — but nothing forces that reading, and collapsing them into one is defensible. Flagged rather than guessed, because a coding agent will guess |

### What the requester is told, per state `[A-2]`

| State | What the requester sees |
|---|---|
| `auto_executed` (Remote applied it) | Remote amended the contract itself and sent the updated document. Nobody was asked. `[A-9]` |
| `dual_approval_required`, no signatures | Two named people must sign, on two different sides. Neither of them is you |
| One signature landed | Which side signed, when, and that the other has not. `approved_awaiting_second` |
| Executed | Both signatures by name and time, **and whether the write to Remote actually landed** — two humans agreeing and Remote accepting are different facts |
| Declined, or refused since the decision | Which gate, in plain words, and that re-filing is required. Never a re-draft offered against the next cycle `[A-29]` |

## 12. CROSS_UC_ROUTING

**May receive from**
- Nothing that is built. **UC-03's spec §5 line 71 says a "payroll/contract-change
  flavoured" request routes here; that route does not exist** — UC-03's classifier
  recognises exactly two intents, `business_travel` and `work_authorization`. This
  is the lead pass's **DRIFT-011**, referenced and not renumbered. From UC-06's
  side the consequence is specific: **an inbound expectation that is never met
  produces no error anywhere**, so nothing in this system would report it.
- Intake in practice is `src/remoteui/` (`POST /api/submit`) and, in the deployed
  graph, `POST /uc-06-amendment`. **Nothing currently feeds that webhook** — no
  Remote subscription and no Zendesk trigger for `uc06_*` exists, so every UC-06
  ticket in the account was authored by the stand-in.

**May route to**
- Nothing. UC-06 terminates in an execution, an escalation to Payroll Ops, or a
  decline.

**Routing conditions**
None built, inbound or outbound.

**Context that MUST transfer**

There is no built hand-off, so the row set below is answered for the one transfer
UC-06 genuinely performs — **request-time decision → approval, days later, in a
different process holding only an `amendmentId`** — because that is where this
use case actually loses context if it loses any.

| | Carried | Notes |
|---|---|---|
| Customer/user identity | ✅ | `requester` is persisted on the row; `unauthenticated` on the Zendesk path is expected and correct, and the surfaces say so rather than implying a defect |
| Employment/entity identifier | ✅ | Re-read at approval, not trusted from the row |
| Zendesk ticket / reference | ✅ | `external_ref` persists on `uc06_amendments` and is repointed at the ticket id by `linkTicket()` after the ticket exists |
| Trace / correlation id | ✅ | `externalRef` + `source` are on every audit row this use case writes, including refusals — `src/auditview/readStore.js` looks a decision up by `details->>'externalRef'` by name |
| Evidence already gathered | ✅ | The full validated payload, the schema verdict and the whole cutoff object are stored, not recomputed |
| Decision / risk information | ✅ | Decision, reason, flags, tier, ladder and per-decider facts all derive from the stored row |
| Approvals already obtained | ✅ | Two independently-identified slots, each with approver, note and timestamp |
| Relevant conversation | ⚠️ Partial | `reasonText` reaches the drafted summary and the prompt; it is **not** persisted as its own column |
| **Other required state** | ⚠️ **The payroll lock does not travel as a live fact.** The cycle object is stored, but nothing re-evaluates it against the clock at approval time — DRIFT-061 |
| **The world the decision was made in** | ✅ | `source` decides which Remote client executes. A record decided against the mock is not executed against the real gateway — resolved from the row's durable `source`, never from the shape of an id, because the portal's personas mirror real employment ids |

**The asymmetry worth naming: UC-06's records are supposed to be *read* by UC-07,
and are not.** `UC-07.md` §5/§12 specifies a conflict check —
*"in-flight contract-amendment on the same employment → conflict flagged"*,
`GET /v1/contract-amendments`, tagged `[CONFIRMED — live]`. **No such read
exists.** `RemoteClient` has no `listContractAmendments()` method, and `src/uc07/`
contains no reference to contract amendments at all. So a relocation dossier can
be compiled for an employee who has a salary amendment mid-flight and say nothing
about it — a hole on UC-07's side, recorded here because UC-06 is the record set
it would read and because neither use case's own tests would ever surface it.

**Must NOT happen during handoff**
- ❌ Customer repeats information. *n/a* — no cross-UC hand-off exists. Within
  UC-06, *satisfied*: neither approver is asked for anything the request supplied.
- ❌ Duplicate work created. *Satisfied* — exactly-once via
  `workflow_claims (use_case, external_ref)`, plus a compare-and-set claim before
  the write. UC-06 recorded one real claim row from a live drive;
  **downstream row counts were never verified for it**, unlike UC-04/05/07.
- ❌ Audit continuity lost. *Satisfied* — `externalRef` and `source` on every row
  including refusals.
- ❌ Approval state lost. *Satisfied* — persisted per slot, read back from
  whichever backing holds the row.
- ❌ Ownership ambiguous. ⚠️ **At risk, and for a different reason from UC-03's.**
  The routing table owns UC-06 to **Payroll Ops** with `queue_payroll_ops`, and
  **neither `src/uc06/` nor `src/remoteui/` references the routing table at all**
  — the stand-in tags a ticket `uc06_amendment` + the outcome and nothing else.
  DRIFT-062. **DECIDED `[A-30]`:** `src/remoteui/` applies the shared table
  alongside its outcome tags, copying `src/portal/server.js:1417+` rather than
  re-deriving it — a second copy of a routing table is a second thing to drift.
  The group exists live: `Payroll Ops` = `6168442797343`
  (`src/shared/escalationGroupIds.js:45`). **`[A-32]`:** this fixes the *next*
  hand-off and nothing retro-assigns the ones already raised — the same lesson
  ticket #51 taught when `Mobility Specialists` was created and #51 stayed in
  `Support`.
- ❌ Two UCs execute conflicting actions. ⚠️ **Unverified, and it is the live one.**
  UC-07's specified conflict check against in-flight amendments is not built, so
  nothing anywhere detects a relocation and an amendment on the same employment.
- ❌ Duplicate Zendesk tickets. *Satisfied for the stand-in* — one ticket per
  submission, created after the gates. Not asserted for the n8n path by any test
  found in this pass.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Remote UI stand-in** (`npm run remoteui`, :4041) | Three role tabs with genuinely different server-side permissions; current contract values read from the record in **human units**, currency never defaulted; the decision, its explanation, and — read-only — what the two approvers later did |
| **Zendesk ticket** | Tagged `uc06_amendment` + `uc06_dual_approval_required` \| `uc06_escalated`, employment id in custom field `9990000000001`, note carrying the drafted summary and the amendment id. ⚠️ **No `queue_payroll_ops` tag and no group assignment** — DRIFT-062, decided `[A-30]` |
| **The zero-touch path** | Nothing. No ticket, no sidebar block, no approval meter — Remote amended the contract and sent the document, and the requester is told exactly that on the page they filed from. **A surface that shows nothing is still a surface**, and a reader who sees the dual-approval blocks absent must be told why rather than left to wonder whether they failed to load. `[A-9]` |
| **ZAF sidebar** | Two role blocks, each independently gated, each naming the role, what it is deciding, who has filled it and who has not. Plus the deciding gate in plain words, the ordered ladder, and each decider's own ordered facts |
| **ZAF sidebar — the employee block** | UC-06 **does** publish `employee` and `requester` (`src/uc06/server.js` → `describeEmployee()` / `describeRequesterParties()`), read live when the panel opens, reporting five states rather than a blank. The cross-cutting **DRIFT-042** ("eight of nine still print a bare UUID; only UC-09 is fixed") is **not true of UC-06** and should be re-counted |
| **Approval queue** (`/queue`) | UC-06 appears with `slotsRequired: 2`, `hasPostRoute: true`, and a surface that exists |
| **Live Feed / audit viewer** | The decision, then every attempt beneath it. `cutoffCycleProjected` and `cutoffCycleStandin` answer "was this cycle real?" directly from `audit_log`, without knowing any id-prefix convention |
| **Slack** | On `urgent_cutoff` only: amendment, employment, type, effective date, cycle, lock date, hours remaining, and a ticket link when a subdomain is configured. Nothing invented. ⚠️ **BUILT, UNPROVISIONED** — `SLACK_WEBHOOK_URL` is unset, so this surface is a true no-op today and every claim of it as a business *outcome* is a built-vs-provisioned overstatement. `[A-7]` |
| **Backend/API** | `GET /uc06/api/amendments`, `.../:id`, `.../by-ticket/:ref` (public reads) · `POST .../:id/approve\|decline\|deny` behind signed identity + role entitlement |
| **Database** | `uc06_amendments` (decision, payload, cutoff blob, two approval slots, `denied_by` aliased to `declinedBy` on read) · `audit_log` (`dual_approval_required`/`escalate`, `amendment_approved`, `amendment_declined`, `amendment_executed`, `amendment_execution_blocked`, `amendment_execution_not_claimed`, `amendment_*_refused`, `amendment_employee_consented`, `amendment_employer_consented`) · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | Reads only until both signatures; then **exactly one** `POST /v1/contract-amendments`. Nothing at all for an escalated amendment |

## 14. UX_ACCEPTANCE

- **Two readers, two screens' worth of facts, and neither is asked to read the
  other's.** Handing both people one undifferentiated blob is a different failure
  from handing them nothing, but it is still a failure — the half that is not
  yours reads as noise.
- **Money is never printed without its scale being unambiguous.** Human units and
  ×100 units sit one field apart on the same row; printing either without saying
  which is a 100× error in front of somebody authorising a pay change.
- **A percentage is guarded.** An old salary of zero makes the ratio undefined —
  not 0%, not Infinity. `percent: null` and a sentence in money only.
- **Statements of absence are mandatory** (`docs/UI-AUDIENCES.md` §5). "This
  country publishes no amendment form", "the payroll calendar was unreadable",
  "no cycle was recorded because two disagreed" all belong on the screen. So does
  the fact that a projected cycle was used.
- **Progressive disclosure.** The eleven-rung ladder is a disclosure under the
  deciding gate, not the headline. `not_reached` is deliberately distinct from
  `passed`.
- **No internal language.** Never `cutoff_lock_passed` alone; the slug stays
  visible beside the prose because it is what somebody greps.
- **Action clarity.** One primary action per role block, and it must be plain that
  a single signature executes nothing.
- **The requester gets no offer, and that is correct** (§17 of the spec). UC-06's
  result is a hand-off in the strongest form this repo has — dual approval by two
  named roles, neither of them the requester. There is nothing to do but wait, and
  a modal carrying an unusable button teaches people to dismiss without reading.
- **A settled amendment says whether the write landed.** Two humans agreeing and
  Remote accepting are different facts, and here the difference is whether the
  employee's terms actually changed.

## 15. Successful business outcome

> **An employee's contract terms change on the day they were meant to, because
> two independent people — one accountable for the contract, one for the payroll
> run — each signed for the half they are actually qualified to judge, on a
> complete record that was validated against the country's own amendment form
> before either of them was asked.**
>
> And: no change was ever filed after its payroll lock had closed; no figure ever
> came from anything but the structured request; no missing value was ever filled
> with a plausible guess; no single person ever cleared a control that exists to
> require two; and where the calendar could not answer, a human was asked rather
> than a cycle chosen.

## 16. Required evidence for E2E verification

1. **A positive test leads.** A clean amendment MUST reach
   `dual_approval_required` / `all_gates_passed` and, on two signatures, produce
   exactly one `POST /v1/contract-amendments`. Every fail-closed assertion in this
   use case passed throughout the period when the write target did not exist, the
   country schema 404'd for every country, and the demo roster could not reach the
   gate its scenarios claimed to demonstrate.
1b. **The `automatable` positive test leads, and it is the harder half of `[A-9]`.**
   An amendment fixture MUST reach the zero-touch outcome, with no approval slots
   offered and no ticket raised. Without it the branch is asserted only by
   negatives, and a negative-only suite passes whether the branch lands correctly,
   lands inverted, or does not land at all. **The fixture is fabricated** — no
   `automatable: true` has ever been captured from Remote — and that is authorised
   by §18a rung 4, not by exception. It must be self-identifying. `[A-10]`
1c. **Segregation of duties, three ways, not two.** The same identity refused on
   the second slot; **the requester refused on the first slot** (`[A-1]`); and a
   different, independent signatory still executing. The third is what separates a
   working control from a dead one, and this use case has never had the second.
2. **State the payroll world the positive test ran in.** This is the sentence that
   must not be omitted: **UC-06's approvable path is reachable only through the
   stand-in's projected calendar.** The Sandbox's last real `period_end` is
   2026-06-30 for SG/FR/CA/US and 2026-07-31 for NL, so no real cycle covers any
   future effective date for any country, and against the raw gateway every
   amendment answers `no_matching_payroll_cycle` — correctly. A projected cycle's
   id begins `standin-`, it carries `_standin {projected, derivedFrom, cadence}`,
   and `total_payroll_cost` / `approval_date` stay null because inventing money is
   forbidden outright. Evidence: the audit row's own `cutoffCycleProjected: true`.
2b. **And which calendar the refusals ran against.** `STANDIN_PAYROLL_HORIZON_MONTHS=0`
   turns projection off and reproduces `no_matching_payroll_cycle` through the same
   URL — that is the check, and it belongs in the evidence rather than in a
   footnote. `[A-20]`
2c. **Do not read the projected calendar as the reason production never
   succeeds.** Across 28 production `audit_log` rows UC-06 has never reached
   `dual_approval_required`, and only **1** refusal was `no_matching_payroll_cycle`
   — **9 of 26 were `schema_invalid`**. Production is stopped two gates earlier, by
   an employment roster whose records cannot satisfy any amendment form. Two
   different problems; the documents currently blur them into one. `[A-22]`
3. **Both refusals on 100% real data.** CA future date →
   `no_matching_payroll_cycle`; CA 2026-06-20 → `cutoff_lock_passed` naming the
   real cycle `1bdb5816…`, `hoursUntilCutoff: -1440`, flag `retroactive_change`.
4. **The employment model, not the country.** The positive case must run on a
   **full-time `global_payroll_employee`**. Three consecutive runs concluded
   "UC-06 fails on the Netherlands" from EOR records; only "UC-06 fails on EOR
   employees" was true, and only a positive test forced the correction.
5. **Segregation of duties, both directions.** The same identity refused on the
   second slot with the refusal itself audited, *and* a different second approver
   still executing. A refusal-only test cannot tell a working control from a dead
   one. Extended by item 1c above.
5b. **The clock moves between the two signatures.** A test that decides an
   amendment with the lock comfortably ahead, advances the clock past that lock,
   and then presents the second signature, MUST produce
   `cutoff_lock_passed_since_decision`, release the claim, and write nothing to
   Remote. **No such test exists today** — the freshness test flips the employment
   to `terminated` and never touches the calendar. `[A-28]`
5c. **Which country the positive test ran in.** UC-06's approvable path exists on
   **NL and CA only**: PT publishes a form no PT record satisfies, and the US
   answers 500 for every employment. A "UC-06 works" claim that does not name the
   country is not checkable. `[A-5]` `[A-6]`
6. **Concurrency.** Two approvals fired with `Promise.all` produce exactly one
   write, and the loser is audited.
7. **Money, end to end.** 60,000 submitted → `annual_gross_salary: 6000000` in the
   stored payload → Remote's response carrying
   `{"compensation.amount": {current: 6000000, previous: 5000000}}`. Asserted on
   what Remote answered, not on the employment record — the record does not change
   until Remote approves the amendment.
8. **Freshness.** An employment that goes inactive between request and second
   approval blocks the execution, releases the claim, and writes nothing.
9. **Exactly-once.** Two deliveries under one external ref → one claim row, one
   `uc06_amendments` row, one `audit_log` row. **Not yet demonstrated for UC-06** —
   one claim row was recorded live with no downstream verification.
10. **The n8n port decides identically** across all eleven parity scenarios, and
    the deployed body matches the file byte for byte.
11. **Database, Live Feed, ticket and sidebar all agree on one state**, including
    which payroll calendar the decision came from.

## 17. Known SPEC_DRIFT

> **Numbering note.** This use case's allocated range is DRIFT-027 … DRIFT-031 and
> all five are used. Two further findings needed numbers; per the brief's overflow
> rule they take the next free numbers above 060 — **DRIFT-061** and **DRIFT-062**.
> DRIFT-011, DRIFT-041 and DRIFT-042 are referenced, not renumbered.

---

### SPEC_DRIFT · DRIFT-027 · The `automatable` pre-check gates nothing, so the zero-touch path the spec branches on does not exist

**Original/documented behaviour:** §5's workflow makes the pre-check *the branch
point of the whole use case*:

```
→ REST: POST /v1/contract-amendments/automatable pre-check
→ AUTOMATABLE = true  → Remote's own engine instantly amends + sends
                         updated document → audit (no dual-control needed)
→ AUTOMATABLE = false → … → ZAF DUAL approval …
```

§3 tags it `[CONFIRMED — live]` and says it *"gates the auto-tier strictly — never
invent our own country/amount thresholds; defer entirely to Remote's own
compliance judgment."* §11's first success metric is *"% amendments cleared by
Remote's own `automatable` check (zero-cost path)"*. §13 build task 3 is
"`automatable` pre-check integration". §12 test 1 is
*"`automatable: true` → Remote's own engine amends instantly, no dual-control
needed."* And `docs/adr/0005-dual-control-segregation-of-duties.md` scopes the
entire dual-control decision to *"the non-automatable path"* — *"the subset
Remote's own `automatable` pre-check has already flagged as needing review."*

**Current implementation:** the client method exists and is real
(`RemoteClient.checkContractAmendmentAutomatable()`,
`src/remote/restClient.js:866–886`, with a live capture:
`200 {"data":{"automatable":false,"message":"By pressing 'Submit amendment
request'…"}}` on NL employment `75b88008-…`, 2026-08-18). **Nothing calls it.**
A repository-wide grep for `automatable` across `src/`, `test/` and `workflows/`
returns the client, the mock server, one comment in `src/uc06/policyEngine.js:102`
using it as *evidence for how field sourcing was validated*, and one comment in a
test. `evaluate()` has no automatable gate and no automatable branch;
`handleAmendmentRequest()` never invokes the check. Every amendment that passes
the gates lands on `dual_approval_required`.

**Current tests assume:** the dual-control path only. `test/uc06.test.js`'s header
claims *"The 6 UC-06 scenarios from docs/use-cases/UC-06.md §12"* — §12 has
**seven**, and the file's numbering starts at the spec's test 2. **Spec test 1 has
no test anywhere**, and could not pass if written.

**Difference:** the specified two-tier design (zero-touch where Remote's own
compliance engine says it can amend instantly; dual control where it cannot) is a
one-tier design. Every amendment, including the ones Remote itself would apply
without review, requires two humans.

**Evidence:** `docs/use-cases/UC-06.md` §3/§5/§11/§12/§13;
`docs/adr/0005-dual-control-segregation-of-duties.md`;
`src/remote/restClient.js:842–886`; `src/uc06/policyEngine.js:102` (comment only),
and the absence of any call site in `src/uc06/workflow.js` or
`workflows/nodes-uc06/amendmentGates.js`.

**Likely reason:** partially establishable. The build order in
`docs/BUILD-LOG.md` §3.9 records UC-06's core as gates-first, and the write target
itself was wrong until `ecdc89c` (2026-08-18) — until that commit there was no
correct payload to submit to `/automatable`, because the payload was being built
against a form that has no salary field. The check became callable at that commit
and was used there **as a verification instrument** ("every active non-contractor
Sandbox employment was driven through `POST /v1/contract-amendments/automatable`
— a CHECK that creates nothing") rather than wired as a gate. Why it was not then
wired: **cannot be established from the repository.**

**Risk if left as-is:** two compounding costs. Operationally, the cheapest
amendments — the ones Remote's own engine would apply instantly — consume two
human approvals each, which is exactly the automation the business case (§0) cites
as *evidence the problem is real*. Rhetorically, worse: the ADR that justifies
dual control as a *deliberate, scoped addition on top of Remote's own automation*
describes a scoping that does not exist in code, so the control reads as
duplication of Remote's engine rather than a complement to it — and §11's headline
metric measures a path that never runs, so it will report zero forever without
that being a signal about anything.

**Recommendation:** HUMAN_DECISION_REQUIRED, and it is one decision with two
defensible answers. Either (a) wire the pre-check as §5 specifies — it is a
non-creating call, the payload is already built and already known to be accepted,
and doing so makes §11's first metric measurable and the ADR true; or (b) decide
that this project deliberately applies dual control to **every** amendment,
delete the automatable branch from §5/§12/§13, rescope ADR-0005, and say plainly
in §8 that the control is broader than Remote's own division. What must not
continue is the current state, where the spec, the metric and the ADR all describe
a branch the code does not have.

**Confidence:** HIGH on the finding; MEDIUM on why.

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · remedy (a), wire it**

The owner chose **(a)**. Call the pre-check as §5 specifies. It makes ADR-0005 true
rather than aspirational, makes §11's headline metric measurable, and the call
creates nothing — it is the same body as the write with a different path.

**The half that is not optional.** Taken literally, (a) ships a branch that has
never executed and cannot execute anywhere this project can reach: the one live
capture answers `automatable: false` (`src/remote/restClient.js:842-860`) and
`src/remote/mockServer.js:3222` **hard-codes `false`**. This repository has already
paid for that shape three times — UC-03's alpha-3 comparison, UC-03's unnameable
sanctions codes, UC-04's employer-permission block — and each time the outcome
looked like caution. So `[A-10]` (a fabricated `automatable: true` fixture, with
the **positive test leading**) is part of the same unit of work as `[A-9]`, not a
follow-up. Fabricating it is authorised by §18a rung 4 and must be
self-identifying.

**A third thing, which belongs in the metric and not in a comment.** The live
`message` — *"By pressing 'Submit amendment request' you will begin the contract
adjustement process for this employee. This does not automatically result in a
contract change."* — reads like a constant, not a per-amendment verdict. **We
cannot distinguish "Remote judged this amendment not automatable" from "the
Sandbox always answers false."** §11's metric says so or it is a number nobody can
read. `[A-12]`

**Also closed by this disposition:** spec test 1 has no test anywhere and could not
pass if written; `test/uc06.test.js`'s header claims 6 of §12's 7 scenarios.
`[A-13]`

**Changes:** `[A-9]` `[A-10]` `[A-11]` `[A-12]` `[A-13]`
**Measurement first:** `M-1` — does *any* Sandbox employment answer
`automatable: true`? If none does, `[A-10]`'s fixture is the only place that branch
will ever be observed, and the contract must say so rather than let the next reader
rediscover it.


---

### SPEC_DRIFT · DRIFT-028 · Two of this project's own documents disagree about whether the `automatable` endpoint exists

**Original/documented behaviour:** `docs/00-FOUNDATION.md` says twice, in the two
places a reader is most likely to trust, that it does not. Its provenance note
(line ~39): *"Where a raw doc's own 'VERIFIED' tag turned out to be wrong on a
live check — it happened repeatedly (UC-05's resignation endpoint, **UC-06's
`automatable` pre-check**, UC-07's atomic country-transfer endpoint all don't
exist) — prefer the fresh check over the inherited confidence label."* And §9,
the evidence hierarchy (line 378): *"UC-05's resignation endpoint, **UC-06's
`/contract-amendments/automatable` pre-check**, UC-07's atomic country-transfer
endpoint all do not exist as claimed."*

**Current implementation:** the endpoint exists. `src/remote/restClient.js:842–860`
records a live probe dated 2026-08-18 against `gateway.remote-sandbox.com`:
`POST /v1/contract-amendments/automatable` with a payload sourced from an active
NL employment answered `200 {"data":{"automatable":false,"message":…}}`, and the
same payload with one undeclared key answered
`422 {"errors":{"base_salary":["is not accepted"]}}`. Both are answers only a
live endpoint gives. `src/remote/mockServer.js:3147–3225` reproduces that capture.
`docs/use-cases/UC-06.md` §3 tags it `[CONFIRMED — live]` and quotes Remote's own
reference verbatim.

**Current tests assume:** neither. No test exercises the endpoint; the mock
implements it and nothing drives it.

**Difference:** `00-FOUNDATION.md` is the shared-invariants document a UC spec
*never overrides*, and on this point it is wrong while the subordinate document is
right. A reader following the hierarchy correctly reaches the false answer.

**Evidence:** `docs/00-FOUNDATION.md` lines ~39–41 and line 378;
`src/remote/restClient.js:842–886`; `src/remote/mockServer.js:3147–3225`;
`docs/use-cases/UC-06.md` §3.

**Likely reason:** establishable with reasonable confidence. `00-FOUNDATION.md`'s
sentence is itself a *record of an earlier live spot-check* — the raw v2 build
pack lists "Automatable amendment" under "Verify official API" (Part 20), and an
early verification pass evidently checked and found nothing. The 2026-08-18 probe
in `restClient.js` is a later, differently-shaped check (correct body, real
`amendment_contract_id`) and it succeeded. Neither sentence was written knowing
about the other; §9's own rule — *prefer the fresh check* — resolves it, and
§9 is the sentence that is stale.

**Risk if left as-is:** direct and already realised. DRIFT-027's remedy (a) is
"wire the pre-check", and the first document an engineer is told to read says the
endpoint does not exist — which turns a half-day of wiring into a decision not to
try. This is also precisely the failure `00-FOUNDATION.md` §9 exists to warn
about, reproduced by §9 itself: a confidence label reflecting what its author
believed at write time, inherited rather than re-checked.

**Recommendation:** RECONCILE. Correct both sentences in `00-FOUNDATION.md` to
name the endpoints that genuinely do not exist and cite the 2026-08-18 probe for
this one. The UC-05 and UC-07 claims in the same two sentences were **not**
re-checked by this pass and should be, for the same reason.

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · RECONCILE**

Correct both sentences in `docs/00-FOUNDATION.md` — the provenance note (~line 39)
and §9's evidence hierarchy (line 378) — in place, with the original wording kept
visible, citing the 2026-08-18 probe. `[A-14]`

**The tail matters more than the fix.** Those two sentences name **three**
absences, and the pass that wrote them checked one thing badly:

| Claimed absent | Status now |
|---|---|
| UC-06's `/contract-amendments/automatable` | **Exists** — live probe 2026-08-18 |
| UC-05's resignation endpoint | **Exists** — proven 2026-08-21, corrected by UC-05's `[N-1]` |
| UC-07's atomic country-transfer endpoint | **Never re-checked** — `[A-15]` |

Two of three were wrong. The third is unverified, and it sits in the same sentence
that has now been wrong twice. Re-probe it **before** UC-07's decision pass, not
during it, because a decision pass that inherits a false absence produces decisions
built on it — which is exactly what happened to UC-05's business case.

**This is also the clearest instance of the rule in §18a.** A Sandbox that refuses
is **rung 2 failing, not rung 1 answering.** All three of these were recorded as
facts about Remote's platform when they were at most facts about one probe against
one Sandbox on one day.

**Changes:** `[A-14]` `[A-15]`


---

### SPEC_DRIFT · DRIFT-029 · §15's build-status table names a write the code retired two days before that row was last edited

**Original/documented behaviour:** `UC-06.md` §15's row *"The actual Remote write
(`PATCH .../basic-information`)"* reads: *"**⚠️ Known drift from this spec (§3),
RE-CONFIRMED STILL PRESENT this session**: `src/remote/restClient.js`'s
`patchEmploymentBasicInformation()` still targets
`PATCH /v1/employments/:id/basic-information`, not the canonical
`POST /v1/contract-amendments` … **Not fixed this session**: `restClient.js` is
shared infrastructure … out of this pass's `src/uc06/`-only scope."*

**Current implementation:** the write is `createContractAmendment()` →
`POST /v1/contract-amendments`, with `{employment_id, amendment_contract_id,
contract_amendment}` and the amendment's own id as the idempotency key
(`src/uc06/workflow.js:566–582`). The old method's header now begins *"NO LONGER
UC-06'S WRITE, AND NOT AN ENDPOINT REMOTE HAS"* and states the three verified
impossibilities: the `PATCH` verb 404s on that path for every status tried; the
documented verb is `PUT` with an enveloped body (`{}` → `422
{"basic_information":["Missing field"]}`); its supported statuses are
`created / job_title_review / created_reserve_paid / created_awaiting_reserve` and
exclude **`active`**, the only status this use case's own gate 2 admits; and the
form it validates against has no salary and no hours property at all
(`src/remote/restClient.js:1272–1298`). `git log` dates the change to `ecdc89c`,
2026-08-18, which also records really filing and then cancelling a real amendment
against active NL employment `75b88008-…`.

**Current tests assume:** the correct write. `test/uc06.test.js` asserts on
`amendment.remoteResult.contract_amendment.status === "submitted"` and on the
`changes` block Remote actually returns. But the test's **title** still reads
*"…then both approve -> executes the PATCH"*, and its scenario headers still say
*"dual approve -> PATCH"* and *"One approver only -> not executed"* with "no PATCH"
in the body.

**Difference:** the single most load-bearing row in the spec's build-status table
describes the previous, impossible write. Two further rows in the same table are
stale in the same direction:
- The *"⚠️ Known gap — the amendment payload does not match this form"* row is
  marked **Open** and argues about `employment_basic_information`'s eight
  onboarding fields. That gap is **closed**: `buildAmendmentPayload()` now sources
  field names *from the schema that arrived* (`schemaVocabulary()`), refuses to
  emit a key a closed form does not declare, resolves `allOf` conditionals
  (`effectiveSchema()`), and reports `change_not_expressible` when a form has no
  field for a requested change. The remaining gap is narrower and different —
  fields no live record carries (`missing_role_description`,
  `missing_default_weekly_hours`), which surface by name.
- The *"n8n workflow"* row says **"deliberately NOT activated"**. `WORKFLOW_UC06_ID`
  has been active since 2026-08-10.

And `workflows/README.md`'s UC-06 section repeats the retired write twice: *"The
actual PATCH never happens in this graph"* and *"The real
`PATCH /v1/employments/:id/basic-information` only fires from …
`submitAmendmentApproval()`."*

**Evidence:** `docs/use-cases/UC-06.md` §15 (write row, payload-gap row, n8n row);
`src/uc06/workflow.js:560–582`; `src/remote/restClient.js:1272–1314` and
`:889–930`; `src/uc06/policyEngine.js:33–110` and `:405–520`;
`workflows/README.md` §"UC-06: the node graph"; `test/uc06.test.js:73` and `:186`;
commit `ecdc89c`.

**Likely reason:** establishable. The §15 rows were written in the pass that
produced `1e9d8a2` ("Build UC-06's payload against the schema Remote sends"), which
correctly identified the write as still wrong. `ecdc89c` fixed it hours later, and
its own commit message says *"1e9d8a2 left that named as still-open"* — the code
moved and the doc row did not.

**Risk if left as-is:** this is exactly the class of overstatement §1 of
`CLAUDE.md` says a reviewer discounts everything else for — except inverted: the
document **understates**, claiming a defect the code fixed, in a table whose whole
purpose is honesty about what runs. A reader is invited to conclude "so the write
still doesn't work", which is the opposite of true and devalues the one commit
that verified the write end to end against a live Sandbox.

**Recommendation:** RECONCILE. Rewrite the three §15 rows against the current code,
keeping the retired-write history as a struck-through record rather than deleting
it (this repository's own convention), fix the two sentences in
`workflows/README.md`, and rename `test/uc06.test.js`'s scenario 1 and 6. **Do not
delete `patchEmploymentBasicInformation()`** — several other use cases' tests use it
to mutate mock fixtures, and its header already says so.

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · RECONCILE**

Rewrite the three stale `UC-06.md` §15 rows against the current code, keeping the
retired write as a struck-through record rather than deleting it — this
repository's own convention, and the history is the reason the row is trustworthy
now. `[A-16]` Fix the two sentences in `workflows/README.md`. `[A-17]` Rename
`test/uc06.test.js`'s scenarios 1 and 6 — **titles only**; the assertions already
assert the correct write. `[A-18]`

**Do not delete `patchEmploymentBasicInformation()`.** Several other use cases'
tests use it to mutate mock fixtures, and its own header already says so.

**Why this one is worth the effort even though nothing is broken.** The document
*understates* — it claims a defect the code fixed, in a table whose entire purpose
is honesty about what runs. `CLAUDE.md` §1 says a reviewer who catches one
overstatement discounts everything else; the inverse costs just as much, because a
reader is invited to conclude *"so the write still doesn't work"* about the one
commit that verified it end to end against a live Sandbox — including really filing
and then cancelling a real amendment.

**Changes:** `[A-16]` `[A-17]` `[A-18]`


---

### SPEC_DRIFT · DRIFT-030 · The success outcome is reachable only through a projected payroll cycle, and has never occurred in production

**Original/documented behaviour:** §12's tests 2, 4 and 6 all assume a reachable
`dual_approval_required`; §5's whole right-hand branch terminates in a real
`POST`; §11's second metric is *"% of the remainder prepared for dual 1-click"*.
Nothing in the spec says the success path depends on demo infrastructure.

**Current implementation:** the gate is correct and the calendar has run out. Live,
`GET /v1/payroll-runs` last covers `period_end` **2026-06-30** for SG/FR/CA/US and
**2026-07-31** for NL. So `evaluateCutoff()` finds no cycle covering any future
effective date, for any country, and every real amendment answers
`no_matching_payroll_cycle` — the gate working exactly as designed.
`src/remotebridge/payrollProjection.js` continues each country's own observed
cadence past its last real cycle: projected ids begin `standin-`, every row carries
`_standin {projected, derivedFrom, cadence}`, one-off runs are never continued
(a one-off is not a cadence), and `total_payroll_cost` / `approval_date` stay null
because inventing money is forbidden outright. `src/uc06/workflow.js` records
`cutoffCycleProjected` and `cutoffCycleStandin` on the audit row so an auditor is
told rather than left inferring from an id prefix.

**Current tests assume:** the mock server's calendar, which has future cycles. Every
positive test in `test/uc06.test.js`, `test/uc06AmendmentPayload.test.js` and
`test/remoteui.test.js` — including the roster guard that fails if no shipped
employment reaches dual approval — passes against the mock and says nothing about
the live calendar.

**Difference:** the spec's success path and the live system's success path are not
the same path. `docs/DEMO-COUNTRIES.md` §4.3 states it plainly and it belongs in
the spec too: `UC06-NL-1` reached `dual_approval_required` / `all_gates_passed`
against cycle `standin-nl-2026-09`; `UC06-NL-2`, the same amendment through the raw
gateway, answered `no_matching_payroll_cycle`. And **in production, across 28
`audit_log` rows, UC-06 has never once recorded `dual_approval_required`** — the
only one of the nine use cases never to reach its own success outcome. The top
refusal is `schema_invalid` (9 of 26); only **1** is `no_matching_payroll_cycle`,
which refutes the obvious suspect: production's amendments were stopped two gates
earlier by an employment roster whose records cannot satisfy any amendment form.

**Evidence:** `src/remotebridge/payrollProjection.js:1–58` and `:243–258`;
`docs/DEMO-COUNTRIES.md` §4.1–§4.3, §6.5, §6.6, and rows `UC06-NL-1`/`NL-2`/`CA-3`;
`docs/use-cases/UC-06.md` §15 (the roster row, which records the 28-row production
finding); `src/uc06/workflow.js:294–340`.

**Likely reason:** the Sandbox stopped seeding cycles; nobody chose this. The
stand-in was built for UC-04/UC-05's empty *fields* and extended to UC-06's empty
*period* on 2026-08-18 under a deliberately narrow honesty rule.

**Risk if left as-is:** the demo's UC-06 success beat depends on the stand-in, and
saying otherwise would be an overstatement — which is the same failure this
repository has already paid for in the other direction, where a gate that could
never pass was indistinguishable from a gate being cautious. Here the mirror image
applies: a positive test that passes only against infrastructure this project
authored proves the gates agree with each other, not that they agree with Remote.

**Recommendation:** KEEP_CURRENT for the projection — it is honestly constructed,
self-identifying, and refuses to invent money — but **RECONCILE the documentation**:
`UC-06.md` §12 and §15 must both state that the approvable path is reachable only
through the stand-in's projected calendar, and every claim that "UC-06 works end to
end" must carry that clause. `STANDIN_PAYROLL_HORIZON_MONTHS=0` reproduces the
refusal through the same URL and should be named in the spec as the way to check.

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED` · KEEP_CURRENT (projection) + RECONCILE (docs)**

**The projection stays**, and the most valuable thing in this finding is a fact
that was recorded nowhere. The owner, 2026-08-21:

> *"i remember telling claude to fabricate or draw from old cycles, so that at
> least we would have something to demo."*

**That instruction is now on the record.** `[A-19]` It converts
`src/remotebridge/payrollProjection.js` from something a reviewer could read as a
fudge into a decision with a named owner, a stated purpose and a date. Worth
noting the build came out *stronger* than the instruction: it continues each
country's own observed **cadence**, never continues a one-off (a one-off is not a
cadence), marks every row `_standin {projected, derivedFrom, cadence}`, prefixes
projected ids `standin-`, and leaves `total_payroll_cost` and `approval_date`
**null**, because inventing money is the one thing forbidden outright. That is
§18a rung 4 with both of its constraints, arrived at before the rule was written.

**The documentation half `[A-20]` `[A-21]`:** §12 and §15 must both state that the
approvable path is reachable **only** through the projected calendar, and
`STANDIN_PAYROLL_HORIZON_MONTHS=0` must be named as the way to reproduce the
refusal through the same URL. Every "UC-06 works end to end" claim carries that
clause or it is an overstatement.

**And a correction the finding itself makes and the documents do not `[A-22]`:**
across 28 production `audit_log` rows UC-06 has never once recorded
`dual_approval_required`, and only **1** refusal was `no_matching_payroll_cycle`
— **9 of 26 were `schema_invalid`**. So the calendar is *not* what stops
production; the employment roster is. "The demo needs a projected cycle" and
"production never gets that far" are two different problems, and blurring them
hides the second one entirely.

**Changes:** `[A-19]` `[A-20]` `[A-21]` `[A-22]`
**Measurement first:** `M-3` — has the Sandbox calendar been reseeded forward? If
it has, the projection stops being load-bearing and `[A-19]`–`[A-21]` shrink to a
historical note.


---

### SPEC_DRIFT · DRIFT-031 · The stand-in's stated reason for existing has been retired, and the specified webhook trigger is now buildable

**Original/documented behaviour:** §2's *"Entry-point gap (issue #17)"* box: *"the
true trigger — a customer admin requesting the change inside Remote's own product
— **has no public API surface**, so `npm run remoteui` (`src/remoteui/`) stands in
for it."* `src/remoteui/server.js`'s own header repeats it: *"Remote has no public
API that produces a 'contract amendment request' event (that's the whole reason
UC-06's Zendesk intake exists in the first place)."* §15's stand-in row and
`docs/BUILD-LOG.md` §3.18 rest on the same sentence.

**Current implementation:** the absence is gone. `docs/INTAKE-RESEARCH.md` §5.1,
verified against `developer.remote.com` on 2026-08-20, records both
`POST /v1/contract-amendments` (*"Creates a Contract Amendment request"*, body
driven by `GET /v1/contract-amendments/schema`) **[CONFIRMED]** and
`contract_amendment.submitted` as a subscribable webhook event alongside
`.review_started`, `.done`, `.canceled`, `.deleted` **[CONFIRMED]**. Sharper still,
`ContractAmendment` carries a native `zendesk_ticket_url` — *"a link to the support
ticket associated with this amendment, if one was created"* — which is
`00-FOUNDATION.md` §2's two-door model confirmed from Remote's own side of the wire
rather than argued by this project. `00-FOUNDATION.md` carries the correction at the
top of the file; **`UC-06.md` §2 and `src/remoteui/`'s header do not.** Note also
that `UC-06.md` §3 has listed `contract_amendment.submitted` as the `[CONFIRMED]`
trigger the whole time — so §2 and §3 of the same document already contradict each
other.

**Current tests assume:** the stand-in. `test/remoteui.test.js` (32 tests) covers it
thoroughly; nothing tests a webhook subscription, and none exists.

**Difference:** the stand-in is described as a **workaround for a missing API**. It
is a **demo surface for a UI** — which is a legitimate and different thing, and the
distinction changes what should be built next. A webhook cannot demonstrate a form
a human fills in; but `contract_amendment.submitted` could drive UC-06's live path
today, and `POST /v1/contract-amendments` means the flow's *originating* act is
reachable from code, not only from Remote's browser UI.

**Evidence:** `docs/use-cases/UC-06.md` §2 and §3; `src/remoteui/server.js:1–20`;
`docs/INTAKE-RESEARCH.md` §5.1; `docs/00-FOUNDATION.md` lines ~15–31;
`docs/BUILD-LOG.md` §3.18.

**Likely reason:** issue #17 predates the 2026-08-20 documentation fetch. No
attempt at concealment — `INTAKE-RESEARCH.md` §5.1 raised it and explicitly says
*"Recommended, not done here — this pass changed no code and no other document."*

**Risk if left as-is:** two. The repository states an absence that is not true of
Remote's API, in a document a reviewer would reasonably check — the single most
damaging kind of error for a portfolio whose §1 says a reviewer who catches one
overstatement discounts everything else. And the stand-in keeps being read as
compensation for a platform limitation, which suppresses the obvious next step:
subscribing the real event so UC-06's live path stops depending on a page nobody
outside this repo can reach.

**Recommendation:** RECONCILE the documentation immediately (§2's box, `UC-06.md`
§15's stand-in row, `src/remoteui/`'s header, `BUILD-LOG.md` §3.18) — reframing the
stand-in as a credential-free demonstration of the human's entry point, which it
genuinely is. Then HUMAN_DECISION_REQUIRED on the follow-on: whether to subscribe
`contract_amendment.submitted` and drive the deployed graph from Remote's own
event. That is the one change that would make UC-06's production intake real, and
it is also what would make DRIFT-062 matter less.

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · RECONCILE; follow-on deferred**

Reframe the stand-in in four places — `UC-06.md` §2's entry-point-gap box and §15's
stand-in row, `src/remoteui/server.js`'s header, and `docs/BUILD-LOG.md` §3.18 — as
a **credential-free demonstration of the human's entry point**, which is what it
genuinely is and a legitimate thing to build. It is **not** a workaround for a
missing API, because the API is not missing. `[A-23]`

Also record that §2 and §3 of the same document already contradicted each other:
§3 has carried `contract_amendment.submitted` as the `[CONFIRMED]` trigger the
whole time. `[A-24]` A document disagreeing with itself is a finding in its own
right — it means neither sentence was written with the other in view, which is the
same mechanism that produced DRIFT-028.

**Deferred, and explicitly not decided here:** whether to subscribe
`contract_amendment.submitted` and drive the deployed graph from Remote's own
event. That is a live-integration commitment with an ongoing cost, and it is the
one change that would make UC-06's production intake real. It should be decided
**together with** `[A-30]`: if the real event is subscribed, the graph's routing
node covers production and the stand-in's tags become a demo detail rather than
the only behaviour anyone observes.

**Note for whoever builds the reframe.** The stand-in does not become less useful
for being unnecessary. A webhook cannot demonstrate a form a human fills in, and
the entry point of this use case *is* a human filling in a form. What changes is
the sentence describing it, not the thing.

**Changes:** `[A-23]` `[A-24]`, and `OPEN`: subscribe the webhook or not


---

### SPEC_DRIFT · DRIFT-061 · The payroll lock is computed once, at request time, and never re-checked at the moment it expires

**Original/documented behaviour:** §9's failure-mode table names the guard
directly — *"Amendment after cutoff lock → retroactive payroll error | Deterministic
cutoff check + block/escalate."* §7 lists *"Effective date vs. active payroll cutoff
(before lock?)"* and *"48-hour urgent-cutoff window detection"* as the deterministic
core. Nothing states when the check runs relative to the approvals.

**Current implementation:** `evaluateCutoff()` is called from exactly one place —
`src/uc06/policyEngine.js:701`, inside `evaluate()`, reached only from
`handleAmendmentRequest()`. `submitAmendmentApproval()` performs a freshness
re-check that re-reads the employment (status) and the contract
(`active_contract_id`) *"because approval can happen days later"*, and does not
re-read the payroll calendar or re-evaluate the lock. So an amendment decided
`dual_approval_required` with the lock 47 hours away, signed by both roles a week
later, executes a `POST /v1/contract-amendments` for a cycle whose lock closed
five days earlier — the exact outcome §9's guard names. The Slack alert has the
same shape: it fires once, at decision time, and never again.

**Current tests assume:** no re-check. `test/uc06.test.js`'s freshness test flips
the employment to `terminated` and asserts `employment_no_longer_active`; no test
advances the clock past a cutoff between the two approvals.

**Difference:** the system holds a strong opinion about the lock at decision time —
strong enough to escalate `cutoff_lock_passed` and flag `retroactive_change` — and
holds no opinion at all at the only moment the write actually happens. This is not
the generic "no approval has an expiry" gap (**DRIFT-041**, which UC-06 also has).
It is narrower and more actionable: **the deadline is already computed, already
stored on the row (`cutoff.cycle.cutoff_date`, `hoursUntilCutoff`), already surfaced
to the payroll specialist by `decisionFacts.js`, and already used by the priority
engine to give UC-06 the only real due date in the system** — and it is the one
piece of state the freshness re-check does not consult.

**Evidence:** `src/uc06/policyEngine.js:701`; `src/uc06/workflow.js:502–520` (the
freshness block re-reads employment and contract only);
`src/shared/escalationRouting.js:340–356` (`urgencyFor()` — *"the only real deadline
this system actually knows about is UC-06's payroll cutoff lock"*);
`src/uc06/workflow.js:342–365` (Slack fired once, on the decision path only);
`docs/use-cases/UC-06.md` §9.

**Likely reason:** the freshness re-check was modelled on `src/review/service.js`'s,
whose question is *"is this employee still active?"* — the right question for UC-01's
letter, and only half of UC-06's. **Cannot be established** whether the calendar
half was considered and rejected.

**Risk if left as-is:** the single failure this use case exists to prevent, arriving
through the approval queue rather than through the request. A retroactive payroll
correction filed by two people who both saw a comfortable runway on a screen, and a
`cutoffCycle` in the audit row that will read as if the lock had not passed. It is
also the most likely path in practice, because a `urgent_cutoff` case is by
definition within 48 hours of the lock and dual approval routinely takes longer.

**Recommendation:** RECONCILE. Re-run `evaluateCutoff()` inside the freshness block,
against a re-read calendar, and refuse with a distinct code
(`cutoff_lock_passed_since_decision`, not the request-time
`cutoff_lock_passed` — they are different afternoons of work for whoever triages it),
releasing the execution claim exactly as `employment_no_longer_active` does. Two
sub-decisions belong to a human: whether an urgent case should be re-alerted rather
than only alerted once, and whether an amendment refused this way should be
re-drafted against the next cycle (it must not be, silently — §9's own reasoning
applies unchanged).

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · RECONCILE**

**This is the sharpest of the seven.** The system holds a strong opinion about the
payroll lock at *decision* time — strong enough to escalate `cutoff_lock_passed`
and flag `retroactive_change` — and holds no opinion at all at the only moment the
write actually happens.

Re-run `evaluateCutoff()` inside the freshness block, against a **re-read**
calendar `[A-25]`; refuse with `cutoff_lock_passed_since_decision`, deliberately
**not** the request-time `cutoff_lock_passed` `[A-26]`; release the execution claim
exactly as `employment_no_longer_active` does `[A-27]`; and add the test that does
not exist — decide with the lock ahead, advance the clock past it, present the
second signature `[A-28]`. Pin as an invariant that such a refusal is never
silently re-drafted against the next cycle `[A-29]`; §6's request-time reasoning
applies unchanged.

**Two codes, not one, and it is not pedantry.** `cutoff_lock_passed` means *you
asked too late*. `cutoff_lock_passed_since_decision` means *you asked in time and
we took too long* — a different conversation with the customer, a different owner
for the failure, and a different fix. Collapsing them would hide the only metric
that would ever show dual approval is too slow.

**One trap in the re-read, and it is new `[A-25]`.** A decision made against a
projected cycle must be re-checked against the **same calendar source**, resolved
from the row's durable `source` — re-reading a `standin-` decision against the raw
gateway would refuse every demo amendment with a true-sounding reason that is
about the wrong calendar. Invariant 18 pins it.

**Sub-decision, answered:** an urgent case is **re-alerted on this refusal**, not
on a timer. The refusal is the moment a human must act; a timer fires on cases
nobody needs to see, and this system's one real deadline deserves better than
noise. `[A-7]`

**Not solved here:** DRIFT-041, the system-wide "no approval has an expiry" gap.
This is the narrower and more actionable half — the deadline is **already
computed, already stored on the row, already surfaced to the specialist, already
used by the priority engine**, and is the one piece of state the freshness
re-check does not consult.

**Changes:** `[A-25]` `[A-26]` `[A-27]` `[A-28]` `[A-29]`


---

### SPEC_DRIFT · DRIFT-062 · Every UC-06 ticket that exists was created without the routing tag or the group its own routing row names

**Original/documented behaviour:** `src/shared/escalationRouting.js:186–193` owns
UC-06 to **Payroll Ops**, `queueTag: "queue_payroll_ops"`,
`escalationTag: "escalation_payroll_ops"`, `priority: "high"`, sourced to
*"UC-06.md §9 — 'Within 48h of cutoff → urgent escalation to Payroll Ops'"*. The
reconciliation brief's routing table records the group as existing live. The
convention is two tags: `queue_*` on **every** ticket, `escalation_*` only when the
automation gave up.

**Current implementation:** neither `src/uc06/` nor `src/remoteui/` references the
routing table at all — a grep for `queue_payroll_ops`, `escalationRouting`,
`groupAssignment` or `routeFor` across both directories returns nothing. The
stand-in tags a ticket `uc06_amendment` plus one outcome tag
(`uc06_dual_approval_required` / `uc06_escalated`,
`src/remoteui/server.js:126–146`) and assigns no group. Routing is applied by the
shared `Assign Routing` node deployed to all nine n8n graphs — **and nothing feeds
UC-06's graph**: its webhook is `POST /uc-06-amendment`, no Remote subscription
exists (DRIFT-031), and no Zendesk trigger keys off `uc06_*`. So in practice every
UC-06 ticket in the account is stand-in-authored and unrouted.

**Current tests assume:** the outcome tags only. `test/remoteui.test.js` asserts
`tags` equals `outcomeTags(decision)` — a positive test for the tags that exist and
therefore no signal about the tags that do not.

**Difference:** a correct, durable, audited amendment that needs two named humans
lands in a ticket carrying no indication of which queue owns it. This is the same
shape as the honest-gaps list's items 7–8 (fifteen tagged tickets sitting in the
account default `Support` group) with one difference that makes it worse: those
tickets at least carry a `queue_*` tag a human or a later backfill could act on.
UC-06's carry none.

**Evidence:** `src/shared/escalationRouting.js:186–193`;
`src/remoteui/server.js:122–146` and `:246–255`; absence of any routing import in
`src/uc06/` and `src/remoteui/`; `workflows/README.md` §"UC-06: the node graph";
`test/remoteui.test.js:253–311`.

**Likely reason:** the stand-in predates the shared routing table, and its own
comment says the tag scheme is *"modeled on UC-01's"* — which is the marker+outcome
scheme, not the queue scheme. The routing table was later applied through n8n, a
path UC-06 does not currently receive traffic on. **Cannot be established** whether
the omission was noticed.

**Risk if left as-is:** the only UC-06 tickets anyone will see in the account are
unrouted, so the routing row for the use case with the system's only real deadline
is untested by anything. And it hides a second fact worth surfacing: UC-06's
production intake does not run — a reader seeing the graph "active" and the routing
node "deployed to all nine" would reasonably conclude UC-06's tickets are routed.

**Recommendation:** RECONCILE — have `src/remoteui/` apply the shared routing table
alongside its outcome tags, exactly as the portal does for the seven use cases it
serves, so the demo surface and the graph produce the same ticket. This should be
decided together with DRIFT-031: if `contract_amendment.submitted` is subscribed,
the graph's routing node covers production and the stand-in's tags become a demo
detail rather than the only behaviour anyone observes.

**Confidence:** HIGH

**DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` · RECONCILE**

`src/remoteui/` applies the shared routing table alongside its outcome tags —
**copying `src/portal/server.js:1417+`, never re-deriving it**, because a second
copy of a routing table is a second thing to drift, which is the whole reason
`src/shared/escalationRouting.js` is shared. `[A-30]` Add a test that asserts the
`queue_*` tag `[A-31]`; the current one asserts `tags === outcomeTags(decision)`,
which is positive-only about the tags that exist and therefore silent about the
one that does not — the same blind spot in miniature that `[A-10]` exists to close
one finding up.

The group exists live: **`Payroll Ops` = `6168442797343`**
(`src/shared/escalationGroupIds.js:45`), so this is wiring, not provisioning.

**And the part that will otherwise be rediscovered `[A-32]`:** applying routing
fixes the **next** hand-off and nothing retro-assigns the ones already raised. That
is exactly what happened when `Mobility Specialists` was created on 2026-08-20 and
ticket #51 stayed sitting in the default `Support` group — a cause and its
consequences are different things, and only a live read finds the difference.

**Decide together with DRIFT-031's follow-on.** If `contract_amendment.submitted`
is subscribed, the deployed graph's `Assign Routing` node covers production and the
stand-in's tags become a demo detail. If it is not, the stand-in's tags are the
only routing UC-06 will ever have, which raises `[A-30]` from tidiness to the
whole of it.

**Changes:** `[A-30]` `[A-31]` `[A-32]`


---

## 17b. Findings opened by this pass

Four. **The register grows when a decision pass works**, and it has grown on every
pass so far — UC-02's five decisions opened two, UC-04's five opened five, UC-05's
nine opened four. Do not read a falling open-count as convergence.

---

### SPEC_DRIFT · DRIFT-098 · The requester may sign the employer-side approval slot, and UC-06 is the only dual-control path that exempts itself

**Original/documented behaviour:** `docs/adr/0005-dual-control-segregation-of-duties.md`
is titled *"Dual control (segregation of duties)"* and defines it as *"requiring two
independent people to jointly authorize a sensitive action, so no single actor —
compromised, careless, or malicious — can unilaterally cause harm."* `UC-06.md` §8
names dual control as the gate.

**Current implementation:** `requester` is captured
(`src/uc06/workflow.js:241`, `session.authenticatedAdminId`) and persisted
(`src/uc06/amendmentStore.js:40`, `:90`, `:110`, `:147` — it has its own column) and
**never compared to anything**. `dualApprovalPolicy.js` enforces
`role_already_approved`, `same_person_cannot_fill_both_roles` (canonicalised via
`isSameApprover()`) and `entitlement.check()`. There is no
`requester_cannot_approve`. So the person who typed the new salary can fill the
`customer_admin` slot confirming they typed it.

The exemption is deliberate and is stated in `dualApprovalPolicy.js:13-29`:
*"Unlike UC-01's segregation-of-duties rule ('the requester of a case may not
approve it'), the admin here IS expected to be one of the two approvers."*

**Current tests assume:** the exemption. `test/uc06.test.js` covers same-identity
and role-reuse refusals thoroughly. No test submits as one identity and approves as
the same identity in slot 1 — it would pass.

**Difference:** the control degrades from four-eyes to **two-eyes plus a reviewer**.
Slot 1 cannot ever disagree with slot 1's own author. Whether that matters depends
entirely on whether "customer admin" denotes a **role** (the employer side, in
which case the cross-organisational split survives and this is defensible) or a
**person** (in which case one signature is a formality). **The code implements the
person reading; the ADR argues the role reading.** Both are live in the repository
simultaneously.

**Evidence:** `src/uc06/dualApprovalPolicy.js:13-29`, `:108-150`;
`src/uc06/workflow.js:241`; `src/uc06/amendmentStore.js:40/90/147`;
`docs/adr/0005-dual-control-segregation-of-duties.md`;
`src/review/reviewPolicy.js` (UC-01's `self_approval`);
`src/uc09/multiApprovalPolicy.js` (requester ≠ approver ≠ payment_releaser);
`src/remoteui/roles.js:18-33`.

**Likely reason:** establishable from the comment itself. `UC-06.md` §5 reads
*"Customer Admin approve → Payroll specialist approve"* as two explicit steps, and
the author read that as *the admin approves*, which it does say. What it does not
say is *the requesting admin*. The distinction between the console operator and the
company's signatory is drawn precisely in `src/remoteui/roles.js` — in a different
file, for a different surface, months later.

**Risk if left as-is:** the exemption is argued in **a code comment**, in the file
that implements the control, and nowhere in the ADR that exists to argue exactly
this. A reader auditing the control reads the ADR, finds "two independent people",
and has no reason to open `dualApprovalPolicy.js`'s header. UC-01 and UC-09 both
hold the requester rule; a reviewer comparing the three would reasonably assume
UC-06 does too.

**Recommendation:** **DECIDED 2026-08-21 by the owner** — slot 1 is reframed as the
**employer's signature**, Remote's own vocabulary (`awaiting_employer_signature`,
`employer_signed_at`), and the requester is refused with a distinct code.
`[A-1]` `[A-2]` `[A-3]`, with `[A-4]` open. Sequencing matters: `[A-1]` before
`[A-2]`, because migrating a name inside a control change leaves the control down
during the migration.

**Confidence:** HIGH on the finding; HIGH on why.

---

### SPEC_DRIFT · DRIFT-099 · UC-07's atomic country-transfer endpoint has never been re-checked, and it sits in a sentence that has now been wrong twice

**Original/documented behaviour:** `docs/00-FOUNDATION.md` names three endpoints as
not existing, twice — in its provenance note (~line 39) and in §9's evidence
hierarchy (line 378): *"UC-05's resignation endpoint, UC-06's
`/contract-amendments/automatable` pre-check, UC-07's atomic country-transfer
endpoint all do not exist as claimed."*

**Current implementation:** two of the three are now known to exist. UC-06's was
probed live on 2026-08-18 (`src/remote/restClient.js:842-860`). UC-05's was proven
on 2026-08-21 and corrected by that use case's `[N-1]`. **UC-07's has never been
re-probed by anyone.**

**Current tests assume:** nothing — no test touches it, in either direction.

**Difference:** a claim with a 2-of-3 known error rate is still being carried as
`[CONFIRMED]`-equivalent in the document a UC spec never overrides.

**Evidence:** `docs/00-FOUNDATION.md` lines ~39-41 and line 378; UC-06's DRIFT-028;
UC-05's `[N-1]` and `docs/BUILD-LOG.md` §3.83.

**Likely reason:** all three were written from one early verification pass, in one
sentence, and inherited together. §9's own rule — *prefer the fresh check* — was
never applied to its own sentence.

**Risk if left as-is:** UC-07 has had no decision pass yet. If it runs while this
absence stands, it will produce decisions built on it — which is precisely what
happened to UC-05, whose §0 business case was **false** because it rested on the
same sentence. The cost is not the wrong line; it is a pass's worth of downstream
reasoning.

**Recommendation:** re-probe **before** UC-07's decision pass, not during it.
`[A-15]`

**Confidence:** HIGH on the gap; the endpoint's actual status is **UNKNOWN** and is
the point.

---

### SPEC_DRIFT · DRIFT-100 · The Slack alert is presented as a business outcome while unprovisioned

**Original/documented behaviour:** `UC-06.md` §11's success metrics and the
contract's §6 both present *"a Slack alert to Payroll Ops naming the hours
remaining and linking the ticket"* as an expected business outcome of the
`urgent_cutoff` path.

**Current implementation:** built, correct, and switched off.
`src/uc06/slackNotifier.js` is injected at `src/uc06/workflow.js:80`, reads
`config.slack.webhookUrl` ← `SLACK_WEBHOOK_URL`, and is a **true no-op when unset**
— never awaited, never rejects, never touches `decision` or `flags`.
`SLACK_WEBHOOK_URL` is unset in `.env.example` and on the deployment.

**Current tests assume:** unconfigured. That is correct and must not change —
`npm test` must never reach a webhook.

**Difference:** the same built-vs-provisioned gap `APPROVER_ROLES` sat in for two
days, where `/__cx/health` read `approverEntitlementEnforced: true` with
`approverEntitlementSource: "unconfigured"` and every approve refused. **"The alert
is built" and "the alert fires" are two claims**, and only the first is true.

**Evidence:** `src/uc06/slackNotifier.js:14`, `:153-164`;
`src/shared/config.js:32-36`; `.env.example:52-59`; `UC-06.md` §11; this contract
§6 and §13.

**Likely reason:** no concealment — every file says "unconfigured" plainly. The
overstatement is only in the *outcome* framing, which is a different register from
the build-status rows and was never cross-checked against them.

**Risk if left as-is:** small in isolation and cumulative in aggregate. It is one
more row where a reader who checks finds less than the document promised, in a
repository whose §1 says a reviewer who catches one overstatement discounts
everything else.

**Recommendation:** **DECIDED 2026-08-21** — label it *built, unprovisioned*, name
the variable, and do **not** connect Slack: the role's posting names n8n, Zendesk +
ZAF, REST, webhooks and MCP, and this repository already demonstrates durable
alerting better in `RCX OPS · Error Alerts` (row first, push second, push
continue-on-error). `[A-7]`, with `[A-8]` open — route the urgent-cutoff alert
through that existing path rather than adding a second integration.

**Confidence:** HIGH

---

### SPEC_DRIFT · DRIFT-101 · UC-06's positive path exists on two of the four demo countries, and the contract says four

**Original/documented behaviour:** `docs/DEMO-COUNTRIES.md` frames the demo set as
**NL · PT · CA · US**, chosen so *"every one of the nine has at least one scenario
that is supposed to succeed on real Sandbox data."* This contract's §12 and §16 name
no country at all.

**Current implementation:** live probe 2026-08-18, one call per
(country, employment_model) across all 81 active Sandbox employments — **NL 200,
PT 200, CA 200, USA 500 both models, every contractor 404**
(`src/remote/restClient.js:799-807`). And of the three with a form, **only NL and
CA reach `dual_approval_required`**: `UC06-PT-1` and `UC06-PT-2` both observe
`schema_invalid`, and all three US rows observe `country_schema_unavailable` —
including `UC06-US-3`, which was *predicted* `dual_approval_required`.

**Current tests assume:** the mock, which has a schema for every country it serves.
Every positive test passes and says nothing about which countries work live.

**Difference:** the demo set's own premise — one succeeding scenario per use case
per country — does not hold for UC-06 on half of it, and the acceptance contract
never states which half.

**Evidence:** `src/remote/restClient.js:799-807`; `docs/DEMO-COUNTRIES.md` rows
`UC06-PT-1/2`, `UC06-US-1/2/3`, §6.5 and §6.6.

**Likely reason:** the observation exists — `DEMO-COUNTRIES.md` has carried these
as ⚠️ DIFF rows since 2026-08-19, which is the matrix working exactly as designed.
It has simply never been promoted into a register finding or into the contract, so
the acceptance criteria do not know it.

**Risk if left as-is:** somebody demonstrates UC-06 on a US employment and gets a
refusal on camera, which is the failure `DEMO-COUNTRIES.md` was built to prevent.
And a "UC-06 works" claim with no country attached is not checkable by anyone.

**Recommendation:** **DECIDED 2026-08-21** — state NL and CA as the demonstrable
pair `[A-5]`; keep the US in the set as a **labelled refusal** rather than dropping
it, because a refusal that names its cause is a legitimate beat and dropping it
hides a real Sandbox limitation; document PT rather than seeding around it. `[A-6]`

**Confidence:** HIGH

---

## 18a. The substitution ladder — where a fact is allowed to come from

> **This is a project-wide rule, stated by the owner on 2026-08-21, recorded here
> because two of this pass's decisions (`[A-10]`, `[A-19]`) depend on it and because
> burying it is exactly how the last three instances each got re-argued from
> scratch.** It is repeated in `CLAUDE.md` §3, `docs/00-FOUNDATION.md` §2a and
> `docs/WHY-THIS-SHAPE.md` §14 rather than cross-referenced, because a rule that
> lives in one file is a rule the next session does not find.

Four rungs. **Always take the highest rung that can answer the question.**

| | Rung | Source | Example in this repository |
|---|---|---|---|
| 1 | **Remote's own documentation is the source of truth** | `developer.remote.com`, its OpenAPI, its `.md` pages | Field names, enums, required lists, verbs, status machines |
| 2 | **Where the Sandbox holds relevant data, use the Sandbox** | `gateway.remote-sandbox.com` | Employment records, countries, real payroll cycles, live schema fetches |
| 3 | **Where the Sandbox refuses or lacks the capability, replicate it in our own stand-in** | `src/remoteui/`, `src/remotebridge/`, `src/remote/mockServer.js` | A resignation the partner API cannot create (UC-05); a work-authorization request with no `POST` (UC-04); an employment field the Sandbox left null (UC-04/05) |
| 4 | **Where no relevant data exists at all, fabricate** | A named, marked fixture | A payroll cycle past the calendar's end (`[A-19]`); an `automatable: true` response never captured live (`[A-10]`) |

**Rung 1 is never overridden by a lower rung.** If Remote's documentation types a
field as an integer, a Sandbox record carrying a quoted number does not make it a
string — it makes that record a thing to handle, not a shape to copy. This is not
hypothetical: live, `work_hours_per_week: "24"` is a value Remote **stores** on some
records and **refuses** on submission.

**Two constraints make rungs 3 and 4 safe. Neither is negotiable.**

1. **A substituted fact is always self-identifying.** A projected cycle's id begins
   `standin-` and carries `_standin {projected, derivedFrom, cadence}`; an enriched
   field is named in an `X-Standin-Enriched` header and a `_standin` body block; the
   audit row carries `cutoffCycleProjected` so an auditor is told rather than left
   inferring from an id prefix. **Nothing fabricated may reach a reader looking like
   something Remote said.**
2. **Money is never fabricated.** `total_payroll_cost` and `approval_date` stay null
   on a projected cycle for exactly this reason. A cadence can be continued; an
   amount cannot be invented. This is the one rung-4 prohibition with no exception.

**And a third, about honesty rather than safety: a real value always wins.** Rung 3
may fill only what rung 2 left empty, and rung 4 only what rung 3 cannot reach.
`src/remotebridge/enrichment.js` fills **only** fields the real Sandbox returned as
null; `payrollProjection.js` never touches a real cycle.

**Why it is written down.** Three separate times this repository recorded a Sandbox
limitation as a fact about Remote's platform — UC-05's resignation endpoint, UC-06's
`automatable` pre-check and UC-07's atomic country-transfer endpoint, all three in
one sentence in `00-FOUNDATION.md`, and **two of the three turned out to exist**.
A Sandbox that refuses is **rung 2 failing, not rung 1 answering.** The ladder makes
substitution a routine, marked, auditable act instead of an exception somebody has
to justify — which is what it had been, one instance at a time.

**What it does not authorise.** It is not permission to skip rung 1. A fabricated
fixture must reproduce a shape Remote's documentation **describes**, even when no
Sandbox response has been captured — `[A-10]`'s `automatable: true` body is
`{"data":{"automatable":true,"message":…}}` because that is the documented envelope,
not because it is convenient.

---

## 18. Build queue

> **2026-09-02 — what the three-persona UI E2E built from this queue.** Step 2's
> LABEL half is built: slot 1 reads *Employer's signatory* on the status page,
> the sidebar, the queue and the settled sentences, with the role id
> `customer_admin` deliberately unchanged (the read-alias question is moot —
> nothing was renamed that an `APPROVER_ROLES` value keys on). Step 6
> (`[A-30]` `[A-31]`) is built: a stand-in-filed ticket carries
> `queue_payroll_ops` (+ `escalation_payroll_ops` on an escalation) and lands in
> group `99900000000009`, asserted by `test/remoteui.test.js`, read back live on
> tickets 284–286. §16 item 9 (exactly-once) is **demonstrated** — executions
> 12038 / 12040. §8 invariant 13 now holds on the n8n path too
> (`workflows/nodes-uc06/appendAuditLogSpec.js`, audit row `ddab7859`).
> Steps 3–5 (`automatable`, the signature-time re-check) are untouched.
> Evidence: `qa/evidence/UC-06/2026-09-02-uc06-e2e/`.


**Nothing below is built.** This pass changed documentation only; `git diff` against
`src/`, `test/`, `workflows/` and `zaf-app/` is empty. Read this section before
starting any UC-06 build work.

### Step 0 — three measurements, before any code

All three can change the plan, and two can change it substantially.

| | Measurement | Why it can change the plan |
|---|---|---|
| `M-1` | Does **any** active Sandbox employment answer `automatable: true`? Drive `POST /v1/contract-amendments/automatable` across the roster, as `ecdc89c` already did once | If none does, `[A-10]`'s fabricated fixture is the **only** place that branch will ever be observed, and §11's metric reads 0% permanently. The contract must say so rather than let the next reader rediscover it as a defect |
| `M-2` | Is `GET /v1/contract-amendments/schema` still **500** for USA? | If Remote has fixed it, the US rejoins the demonstrable set and `[A-5]`/`[A-6]` change |
| `M-3` | Does the Sandbox payroll calendar still end 2026-06-30 (SG/FR/CA/US) and 2026-07-31 (NL)? | If it has been reseeded forward, the projection stops being load-bearing and `[A-19]`–`[A-21]` shrink to a historical note |

**All three are blocked from a container with no `.env`**, and `pg` cannot reach
Supabase through an HTTP CONNECT proxy. They need a live token. **An exit code that
means "I could not tell you" is not an answer about the service** — find a caller
that can, rather than recording the result as unknowable.

### The ten steps

| Step | Changes | Done when |
|---|---|---|
| **1** | `[A-1]` requester refused from slot 1 | A test submits as one identity and is refused `requester_cannot_approve` in slot 1, **and** a different signatory still executes. Both directions, or it is a dead gate |
| **2** | `[A-2]` `[A-3]` slot 1 renamed to the employer signature, with the read-alias | Old `customer_admin` rows and `APPROVER_ROLES` values still resolve; the ZAF panel, `USE_CASE_ROLES` and `approvalRoutes.js` all name `employer`; a test pins the alias |
| **3** | `[A-10]` the `automatable: true` fixture, self-identifying | The mock can answer `true` for one named demo-only fixture, marked, on no real Sandbox id |
| **4** | `[A-9]` `[A-11]` the pre-check is called; unreachable ≠ false | **The positive test leads**: a fixture reaches the zero-touch outcome with no slots offered. Then the refusal, then the unreachable case |
| **5** | `[A-25]`–`[A-29]` the cutoff is re-checked at signature time | The clock-advance test passes, the claim is released, the code is `cutoff_lock_passed_since_decision`, and a `standin-` decision re-reads its own calendar |
| **6** | `[A-30]` `[A-31]` the stand-in routes | A submitted amendment's ticket carries `queue_payroll_ops` and lands in group `6168442797343`, asserted by test |
| **7** | `[A-13]` `[A-18]` test names and coverage | §12's seven scenarios all have tests; scenario titles name the real write |
| **8** | `[A-23]`'s code half | `src/remoteui/server.js`'s header no longer states an absence that is not true |
| **9** | `[A-15]` re-probe UC-07's endpoint | A live result, either way, recorded with its date — **before** UC-07's decision pass |
| **10** | `[A-8]` `[A-4]` the two open questions | Answered by a human, not inferred |

### Dependencies that are easy to get wrong

- **`[A-1]` before `[A-2]`.** Never migrate a name inside a control change: the
  control is down for the duration, and a half-renamed role fails open in the one
  place that must fail closed.
- **`[A-2]` before `[A-3]`, and `[A-3]` before any deployment touch.**
  `APPROVER_ROLES` is a live environment value on Vercel. A rename that stops
  recognising it takes entitlement from *enforced* to *unconfigured*, which refuses
  every approve — recoverable, loud, and still an outage.
- **`[A-10]` before `[A-9]`.** The fixture before the branch, or the branch ships
  unobserved. This ordering is the whole lesson of UC-03's two dead gates.
- **`[A-30]` decided together with DRIFT-031's webhook question.** If the real event
  is subscribed, the graph's routing node covers production and the stand-in's tags
  are a demo detail. If not, they are the only routing UC-06 will ever have.
- **`[A-15]` before UC-07's decision pass.** UC-05's business case was false because
  a decision pass inherited an unchecked absence.

### What must NOT change

1. **`patchEmploymentBasicInformation()` stays.** Other use cases' tests use it to
   mutate mock fixtures; its header says so.
2. **The stand-in stays pointed at the projected calendar.** Repointing it at the
   raw gateway removes UC-06's only positive path (`CLAUDE.md` §6 names UC-04/05/06
   as deliberate, and warns this was nearly "fixed" once).
3. **Entitlement stays consulted last, and stays able only ever to refuse.**
   `check()` returns a refusal or `null`; there is no value meaning "approved".
4. **The pre-check never becomes an approval.** `automatable: true` is Remote
   applying the amendment itself, not this system approving it — the audit action
   must not be `dual_approval_required` with a slot pre-filled.
5. **`{required: []}` is never a substitute for a schema that could not be fetched.**
6. **The n8n graph never executes the write.** Both branches record and route.
7. **Tests never reach a Slack webhook, an OpenAI endpoint, or a real Sandbox.**
8. **`total_payroll_cost` and `approval_date` stay null on projected cycles.**
9. **Do not delete the retired-write history from §15** — struck through, not gone.
10. **Do not renumber `A-*` to match another use case's scheme.** Six schemes, none
    corresponding, on purpose.

### Open questions

| | Question | Why it is not answered here |
|---|---|---|
| `[A-4]` | Is the employer's **consent** (`src/remoteui/`) the same act as the employer's **signature** (slot 1), or two? | A product call. Treated as two — consent is *"I agree"*, signature is *"I authorise it filed"* — but nothing forces that reading, and collapsing them is defensible. **A coding agent will guess** |
| `[A-8]` | Route the urgent-cutoff alert through the existing `ops_alerts`-then-push path instead of Slack? | Trades a second integration for a shared one. Needs the owner |
| — | Subscribe `contract_amendment.submitted`? | A live-integration commitment with ongoing cost. DRIFT-031's follow-on |
| — | Which second employer-side identity for the demo roster, and does `APPROVER_ROLES` need a new entry **on the deployment**? | A provisioning step only the owner can perform, same shape as `APPROVER_ROLES` itself. The requirement is named; the identity is not invented |
