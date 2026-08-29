# UC-07 — Canonical Acceptance Contract

> **Global Mobility / Permanent Relocation Compliance · 🔴 High tier · dossier-only · Zendesk-native ticket + portal intake**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-07.md` (§0–§18),
> `docs/verification/uc07-business-case.md`,
> `docs/research/UC-07 Build Pack By Chatgpt…`, `…ChatGPT v1…`, `…Research Plan…`,
> `src/uc07/{workflow,transitionGate,dossierBuilder,dossierView,costCalculator,relocationParser,mobilityRetriever,dossierStore,decisionSources,server,cli}.js`,
> `workflows/nodes-uc07/{normalizeRelocationRequest,relocationGates}.js`,
> `test/uc07.test.js`, `test/uc07Server.test.js`, `test/uc07DecisionSources.test.js`,
> `test/n8nUc07Parity.test.js`, `docs/RETRIEVAL.md`,
> `src/shared/escalationRouting.js`, `src/approvalqueue/{approvalRoutes,awaiting,stuck}.js`,
> `src/portal/{ticketing,requestStatus,server}.js`, `zaf-app/assets/{main,panels}.js`,
> and a read-only query against the live `uc07_dossiers`, `audit_log` and
> `uc07_mobility_citation_vectors` tables (project `your-project-ref`,
> 2026-08-20).
>
> **Intended business truth.** §17 records the divergences. No code or test was
> changed to produce this.

---

---

## Decisions — 2026-08-21 (ninth decision pass)

**Eight findings dispositioned, four opened, five questions from the owner
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

---

### 0. The precondition, discharged before anything else

`qa/contracts/UC-06-acceptance.md` §18's **`[A-15]`** — registered as **DRIFT-099** —
required that UC-07's decision pass **must not start** until one sentence was
re-probed. `docs/00-FOUNDATION.md` names three endpoints as not existing, in one
breath: *"UC-05's resignation endpoint, UC-06's `/contract-amendments/automatable`
pre-check, UC-07's atomic country-transfer endpoint all do not exist as claimed."*
**Two of the three turned out to exist**, and UC-05's whole §0 business case had
already been falsified for exactly that reason.

Probed 2026-08-21 against `docs/REMOTE-API-INDEX.txt` — Remote's own `llms.txt`,
468 lines, **rung 1 of the substitution ladder**:

| Term searched | Matches |
|---|---|
| `relocat` | 0 |
| `country transfer` / `country-transfer` | 0 |
| `entity transfer` / `internal transfer` | 0 |
| `mobilit` | 0 |

**UC-07's third of that sentence HOLDS.** It is the one that survived. This is the
first decision pass in the register to begin on a checked foundation rather than
an inherited one, and it is recorded here as a confirmation rather than a
contradiction for the same reason `CONTRADICTIONS.md` keeps its four `K-` entries:
a register that only ever reports faults teaches its reader to distrust
everything equally.

**But one word has to be added to the claim, and the word is load-bearing.**
`docs/INTAKE-RESEARCH.md:75` records that Remote's **product** has a
**Country Transfer Service** — *Employee profile → Country Transfer Service →
relocation form (new country, entity, start date; mostly pre-filled)*, marked
**"Structured form, employer-driven"**, with *"❌ nothing in `llms.txt`"* against
the API column. So the true statement is:

> **No atomic country-transfer *API* exists.** The *capability* does exist, as a
> product surface, and it is employer-driven and structured.

Saying "no country-transfer endpoint exists" without the word **API** reads as
*Remote cannot do this*, which is false — and is the identical over-reach that
made the other two-thirds of that sentence wrong. **Rung 1 is never overridden by
a lower rung, and a limit of the partner API is not a limit of the platform.**

That single row decides two things below on merit rather than on convenience:
the portal's status as primary intake (decision 2), and who files (question 1).

---

### The three decisions that change the use case

**1. UC-07 gets a Remote API client, and it is structurally read-only.**
Today `handleRelocationReview()` takes no `remote` parameter and no file in
`src/uc07/` imports `RemoteClient` — *zero Remote calls, on any path, ever*. That
is the strongest available form of the 🔴 guarantee and **it removed the reads
along with the writes**; `workflow.js`'s own header argues the removal for writes
and never addresses reads. The consequence is that every gate input is a fact the
requester typed about their own case. The decision is a **read-only façade**, not
the full client used with discipline — see the trap section below.

**2. The portal becomes the primary intake; Zendesk stops producing a verdict.**
The owner's framing, and it is stronger than the finding's own: *"I don't think it
makes sense for Zendesk to originate this workflow — how exactly are customers
supposed to access Zendesk? That is why we use our own UI. Isn't that all we are
trying to resolve?"* A customer does not *access* Zendesk; Zendesk is the agent's
console, and a ticket exists because somebody emailed. An emailed relocation
request in free prose is precisely what produces `plan: {}` and the **seven
identical `BLOCK` verdicts** now sitting in production.

**3. The aftermath is built — and it is not an approve button.**
The owner's question was *"when the specialist reaches a conclusion, what will
they now do? Nothing? Should the demo not include an aftermath instead of saying
no button at all, because the employee who filed is expecting feedback."* Correct,
and it exposes a conflation this repository has half-noticed once and never fixed.

---

### The trap inside decision 3, which must NOT be buried

> **"Nothing may be approved here" and "nobody may ever be told what happened"
> are two different rules. Only the first is the 🔴 invariant. They are currently
> satisfied by the same mechanism, and that is why removing the second looks like
> weakening the first.**

`src/approvalqueue/stuck.js:43–48` is the **only** place in the entire repository
that already states the distinction correctly, and it states it exactly:

> *"a UC-07 dossier sitting in Mobility Legal's queue is NOT on this list, and one
> with no ticket IS — under `no_ticket`, with a `why` that says plainly that the
> missing thing is the hand-off and not a control."*

Everywhere else the two are welded together. `uc07_dossiers` has no status column,
so `awaitingState()` answers `awaiting / reading` **in perpetuity**; combined with
DRIFT-041 (no expiry, no reminder anywhere in the system) a UC-07 dossier can
never leave the waiting list by any means the system possesses. The employee who
filed receives one `customerFacingAcknowledgement` at submission and then silence,
permanently.

**The shape that resolves it without touching the guarantee** — three constraints,
none optional:

1. **The specialist records an OUTCOME, not a DECISION.** The verbs are
   `dossier_read`, then one of `proceeding_offline` / `not_proceeding` /
   `more_information_needed`. **Not one of them executes anything in Remote.** The
   relocation is still performed by a human in Remote's own product, step by step
   — which is the invariant, intact and unweakened.
2. **The outcome lives on the TICKET, never on the dossier record.** The store's
   *one write method, zero mutation methods* property **is** the structural proof;
   adding `markReviewed()` deletes the proof in order to record that the proof
   worked. DRIFT-073 already names the mechanism — *a ticket may be **raised**
   without being **linked***, the id travelling one way (record → ticket) — and
   this runs it exactly one step further.
3. **The requester is told.** Employee sees it in "My requests"; an admin sees it
   against the subject they filed for. A 🔴 case with no approve button still owes
   the person who asked an answer.

**Why this is also the better demo.** The obvious challenge to a 🔴 use case is
*"you built something with no buttons — isn't that just an unfinished feature?"*
With the aftermath the answer becomes: **there is a button; it executes nothing.
It closes the loop with the human who asked.** That is the difference between a
control and an omission, made visible on screen.

---

### The trap inside decision 1, which must NOT be buried either

**The façade is the decision. "The full client, used carefully" is not the same
decision and must not be substituted for it during the build.**

UC-07's guarantee is currently argued from a **parameter that does not exist**:
`test/uc07.test.js` proves it structurally (source stripped of comments, then
asserted never to reference either REST client's write methods) and behaviourally
(the decision is always `escalate`). Handing `handleRelocationReview()` a
`RemoteClient` re-opens the parameter the guarantee is argued from, and **nothing
fails when it does** — the structural test greps for write-method *names*, and a
client that merely *could* write names nothing.

So the built shape is a `ReadOnlyRemoteClient` **façade** exposing exactly the six
methods this use case needs, on which a write is *unnameable* — the identical
reasoning that gave `dossierStore` one write method and zero mutation methods
rather than a store that refuses to mutate. And the structural test extends in
two ways before the façade ships:

- the façade's own method list is pinned at exactly those six, so a seventh
  cannot be added without a test failing;
- `src/uc07/` is asserted never to import `RemoteClient` directly.

**Ordering, and it is not negotiable:** the façade lands **before** the conflict
gate that uses it. Building the gate against the full client "for now" is how the
guarantee dies quietly — the same shape as `[A-1]`-before-`[A-2]` in UC-06, where
migrating a name inside a control change leaves the control down for the duration.

---

### The owner's five questions, answered

#### Q1 — "In the demo are we using employee and/or company admin?"

**Today: both, and neither is checked.** `src/portal/server.js:3047` takes
`body.employmentId || subjectEmploymentId(body.persona)`, and its own comment
says so in as many words: *"No kind check and no refusal is added: anyone may ask
a relocation question, with or without a persona."*

**Decided: both — but they are not the same request and must not produce the same
dossier.** A permanent relocation is bilateral: one employment ends and another
begins. An employee can *ask*; only the employer can *propose*. Remote's own
Country Transfer Service is **employer-driven** (`INTAKE-RESEARCH.md:75`), which
settles the default rather than leaving it to taste.

| Filer | The request is | Subject comes from | Identity comparison |
|---|---|---|---|
| **Employee** | an enquiry about **their own** move | the session, **never typed** | session employment id vs. the Remote record |
| **Company admin** | a **proposal** about an employee | typed into the form | session `companyId` vs. the record's `company_id` |

The portal holds ten employee personas and one company admin (Jane Doe / Acme),
and `docs/use-cases/UC-07.md` already carries six demo country pairs — enough to
show both shapes on real Sandbox ids without inventing a persona.

#### Q2 — "When the specialist reaches a conclusion, what will they now do?"

Answered in full by decision 3 and its trap section above. Short form: **today,
nothing, permanently** — and that is a hand-off gap wearing a control's clothes.

#### Q3 — "When you say escalate, to who? e.g. in case of duplicate request"

**The word is doing two jobs, and one of the two is false.**

*The normal case.* `src/shared/escalationRouting.js` → **Mobility Legal (Tier-3)**,
tag `queue_mobility_legal_t3`, group `6168424846751`, live in the account. This
works on the **Zendesk path** — ticket #34 is sitting in that group right now. It
does **not** work on the **portal path**: `src/portal/ticketing.js` excludes UC-07
from `TICKETABLE_TYPES`, so no ticket, no group, no queue entry, no notification.
That is DRIFT-073.

*The duplicate case — the owner picked the exact spot.* `src/uc07/workflow.js:238–240`:

```js
if (!claim.claimed) {
  return { decision: "escalate", duplicate: true, duplicateOf: externalRef, dossierId: null };
}
```

Nothing was compiled. **No audit row was written** — the claim check sits *above*
`audit.log()`. No dossier, no ticket, and nobody escalated to. And the caller
receives **the same `decision` string as a successful compile**. A portal
requester who submits twice gets a success-shaped response with nothing behind
it. Registered as **DRIFT-102**.

**And two different things are being called "duplicate":**

| | Handled? |
|---|---|
| The same **delivery** arriving twice (webhook redelivery) | ✅ `workflow_claims`, correctly — and returning quietly *is* right, because redelivery is normal webhook traffic |
| The same **employee filing a second relocation request** | ❌ **Not at all.** Two dossiers, two verdicts, possibly contradictory, both waiting forever |

`dossierStore.listByOwner({employmentId})` already exists (`dossierStore.js:161`)
and **no caller uses it for this**. Registered as **DRIFT-103**.

#### Q4 — "I don't think we need to route 03 to 07"

**Agreed, and the code already agrees.** `docs/use-cases/UC-07.md:91` specifies
*"Ticket (routed from UC-03, or direct)"*. `src/uc03/policyEngine.js`'s decision
union is `auto_resolve | human_review | escalate | route_to_uc04` — there is no
UC-07 branch anywhere in `src/uc03/`. The route is **spec-only and has never
existed**. Registered as **DRIFT-105** and struck.

**Struck on merit, not for tidiness.** UC-03 answers *"may I work from X for three
weeks."* A permanent relocation is not a longer workation — it is a different
legal event. A routing edge would let a 🟢 router's classifier open a 🔴 case on a
keyword, which is a defect UC-03 has already paid for once (its parser reading
`fr` inside *from* and `ca` inside *relocating*, published live on ticket 18).
The correct precedence already exists and is already in the right place:
`src/uc07/relocationParser.js` recognises workation / business-travel /
address-change phrasings **before** "relocat"-ish language, per Build Pack Part 4.
**The specific use case declines the general one; the general one never guesses.**

#### Q5 — "Explain how UC-07 really connects to UC-04 / UC-03, and whether we should build it"

Three connections exist. **They are three different kinds, and the only one that
is control flow is the only one not to build.**

| # | Connection | Kind | Build? |
|---|---|---|---|
| **a** | **Shared reference data.** §7 specifies *"the same 4-dimension coverage/risk gate as UC-04 … reusing UC-04's maintained tables"*. Reality: `src/uc07/` imports nothing from `src/uc04/`, and its four dimensions are four checkboxes on the requester's own form | a shared **module** | ✅ **Yes** |
| **b** | **A real-world sequence.** An employee often workations first (UC-04), then asks to move. Prior approved workations in the destination bear on **PE exposure** and **tax residency** — both of which UC-07 already flags | an **evidential read** | ✅ **Yes, as a read.** Never a trigger |
| **c** | **The conflict check.** An in-flight contract amendment (UC-06's object) or offboarding (UC-05's object) on the same employment | a **read of Remote's** records | ✅ **Yes** — this is DRIFT-032 |

**(a) has a precedent that settles how to build it.** UC-03's sanctions set is
*imported* by UC-04 rather than copied, and the pass that did it wrote the rule
down: *"a jurisdiction property is not a use-case property, and two copies
drift."* Same rule, one dimension over.

**(c) is where "one use case genuinely impacts another" is literally true and
currently invisible by construction.** A dossier compiled for an employee who
already has an offboarding submitted is **byte-identical** to one for an employee
who does not. That is the same defect as UC-08's *"273 presence days with
`jurisdictions: []`"* — an answer to a different question, printed in the same
shape, with the reader supplying the missing half from memory.

**The rule that falls out, and it generalises past this use case:**

> **Use cases connect through shared reference data and through reads of each
> other's records — never by one deciding to invoke another.** A routing edge
> makes the caller's classifier the gate of the callee's tier, and a 🟢
> classifier must never be able to open a 🔴 case.

**Flagged, not fixed here:** permanent-move language *already* misroutes today —
*"I'm moving to Portugal permanently and will keep working"* classifies as
`work_authorization` and lands in UC-04's 🟡 temporary-workation risk matrix,
where its start date sits in the past on the day the move completes and its
"trip" has no end date. That is **DRIFT-011**, it is live, and it belongs to
UC-03/UC-04's build queues rather than to this pass. §12 carries it.

---

### Where a captured fact is allowed to come from

The owner's DRIFT-032 instruction has two halves: *"if there is a way to leverage
Remote Sandbox and get the details we need, let's do that"*, **and** *"for
fallback so that the demo won't fail live, extract all the info we need from
Remote Sandbox, so that when we make API calls and they say our sandbox time has
expired we are not stuck."*

The second half is a **rung 2 → rung 3** move on the substitution ladder
(`CLAUDE.md` §3 directive 6, `docs/00-FOUNDATION.md` §2a,
`docs/WHY-THIS-SHAPE.md`), so the ladder's constraints apply verbatim and none of
them is negotiable:

| Rule | Applied to the capture/replay layer |
|---|---|
| **A substituted fact is always self-identifying** | Every replayed response carries `X-Sandbox-Replay: <capture-date>` and a `_replay` body block, and the screen says *this figure came from a capture taken on `<date>`, not from a live call* |
| **A real value always wins** | Replay is consulted **only** when the live call fails. It is a fallback, never a cache-first |
| **Money is never fabricated** | Unchanged, and it is why DRIFT-070's 12% default is being removed in the same pass |
| **Provenance is recorded** | Each captured file carries the SHA-256 of the retrieved bytes and the capture timestamp — the `docs/knowledge/` header discipline, which already exists and works |
| **Read-only on both legs** | `scripts/capture-sandbox.mjs` is already GET-only *by construction* and says so; the replay layer must be too |
| **The trace says which leg answered** | `source: "sandbox_live" | "sandbox_replay"` on the `audit_trace` row — the same discipline invariant 8 already established for `"llm" | "rule_based_fallback"` |

**Why the loudness rule is not decoration.** A demo that silently falls back is
**worse** than a demo that fails, because the reviewer cannot tell which one they
watched — and neither can we, afterwards. An unmarked replay converts a claim
about our API competence into an unfalsifiable one.

**And the claim becomes checkable, which is the point.** A reviewer can ask *"show
me the call"*, and the honest answer has to be a real request with a real
`sandbox_live` trace row behind it.

**What exists today, and why it produces nothing durable.**
`scripts/capture-sandbox.mjs` already exists, is GET-only, and already captures
`/v1/contract-amendments`. It writes to `.sandbox-cap/` — **which is gitignored**
(`.gitignore:44`). So the repository's single defence against its own most
expensive recurring defect (*fixtures written to agree with the code and code
written to agree with the fixtures, so neither is ever compared to Remote*)
produces an artifact that is thrown away, and there is **no fallback at all** if
the Sandbox expires mid-demo. Registered as **DRIFT-104**, cross-cutting rather
than UC-07-only.

---

### What the API index settled, recorded because §3 got two of them wrong

Probed 2026-08-21 against `docs/REMOTE-API-INDEX.txt`:

| Need | Published path | Scope | §3's version |
|---|---|---|---|
| In-flight **offboardings** for one employment | **`GET /v1/offboardings/employments/{employment_id}`** — *"Lists Offboarding requests for a specific employment"* | `offboarding:read` | `GET /offboardings` — **not a published path**: no version prefix, no per-employment form |
| In-flight **contract amendments** | `GET /v1/contract-amendments` | `contract_amendment:read` | ✅ correct |
| Pushed rather than polled | `offboarding.submitted`, `contract_amendment.submitted` webhooks | — | not mentioned |

The real offboarding path is **better than the one we specified** — it is
per-employment, so there is no client-side filtering to get wrong. Neither
endpoint appears anywhere in `src/`: `RemoteClient` has three contract-amendment
methods and all three serve UC-06's *write*, and **the string `offboarding` does
not appear in `src/` at all**.

---

### The change queue — `R-1` … `R-27`

**Seventh scheme, and none of the seven correspond.** UC-01 `G-1…G-4`, UC-03
`G-A…G-C`, UC-02 `E-1…E-3`, UC-04 `W-1…W-10`, UC-05 `N-1…N-18`, UC-06 `A-1…A-32`,
UC-07 **`R-1…R-27`**. Deliberately non-corresponding, for the reason in
`CLAUDE.md` §7 item 20: this repository already has two registers both numbering
findings `C-N`, with code citing both, and a reader following a citation can land
on a confident, specific, entirely unrelated finding.

| # | Change | From | Kind |
|---|---|---|---|
| **R-1** | `ReadOnlyRemoteClient` façade — exactly six methods, write unnameable | DRIFT-032 | code |
| **R-2** | Structural test extended: façade method list pinned; `src/uc07/` never imports `RemoteClient` | DRIFT-032 | test |
| **R-3** | `listOffboardingsForEmployment()` on `RemoteClient`, at the published per-employment path | DRIFT-032 | code |
| **R-4** | `listContractAmendments({employmentId})` on `RemoteClient` | DRIFT-032 | code |
| **R-5** | Mock fixtures for both — **none exists; the string `offboarding` is absent from `src/`** | DRIFT-032 | fixture |
| **R-6** | The conflict gate: amendments + offboardings, three outcomes (none / found / unreachable) | DRIFT-032 | code |
| **R-7** | **Positive fixture** for the conflict gate — an employment with an in-flight action | DRIFT-032 | fixture · rung 3/4 |
| **R-8** | Identity gate, three paths, failing closed on `null` | DRIFT-033 | code |
| **R-9** | `identity: "not_verified_no_authoritative_record"` as a **named** state on the dossier and the audit row | DRIFT-033 | code |
| **R-10** | Employee may only file about themselves; admin verified against `company_id` | Q1 | code |
| **R-11** | Zendesk path stops producing a verdict: `verdict: NOT_ASSESSABLE`, `planSource: "none"` | DRIFT-034 | code |
| **R-12** | Zendesk path + façade → `INCOMPLETE` with a **named list** of what is missing | DRIFT-034 | code |
| **R-13** | Portal named primary intake; the Zendesk reply carries the portal link | DRIFT-034 | code · copy |
| **R-14** | Drafted paperwork — **rendered documents**, reusing `src/pdf/` | DRIFT-035 | code |
| **R-15** | Self-declared fields marked as such **on the document itself** | DRIFT-035 | code |
| **R-16** | No-execution assertions extended to cover the paperwork **before it ships** | DRIFT-035 | test |
| **R-17** | Management fee → `QUOTE_REQUIRED`; the 12% default **deleted**; portal rate box ships blank | DRIFT-070 | code |
| **R-18** | `?? "USD"` removed from the `INCOMPLETE` branch | DRIFT-070 | code |
| **R-19** | `minimumOnboardingLeadTimeBusinessDays: 20` **marked** as a repo-wide stand-in, or promoted to rung 2 | DRIFT-070 | code |
| **R-20** | Retrieval descriptions corrected everywhere; `uc07_mobility_citation_vectors` **dropped** | DRIFT-071 | doc · db |
| **R-21** | `dossierView` tolerates both dossier shapes; unknown shape is a **stated** unknown, not `?? {}` | DRIFT-072 | code |
| **R-22** | One test whose fixture is a **stored** flat-shape row, not a freshly built dossier | DRIFT-072 | test |
| **R-23** | Ticket **raised** without being **linked** on the portal path; id travels record → ticket only | DRIFT-073 | code |
| **R-24** | The aftermath: outcome verbs on the ticket, requester told, dossier leaves the waiting list | DRIFT-073 · Q2 | code |
| **R-25** | Duplicate delivery stops returning `decision: "escalate"` | DRIFT-102 | code |
| **R-26** | Second relocation request for the same employment is detected via `listByOwner()` | DRIFT-103 | code |
| **R-27** | Capture committed with provenance; replay layer, loud, live-wins | DRIFT-104 | code · fixture |

---

### One thing that was checked rather than assumed

`docs/INTAKE-RESEARCH.md:75` was read before decision 2 was written, and it
**changed the argument from a preference into a finding**. The reasoning that
*"customers cannot access Zendesk"* is sound on its own, but it is an argument
about our own convenience until you can show that **Remote's own product solves
it the same way** — a structured, employer-driven relocation form on the employee
profile. Our portal stands in for **that**, which is the `W-4` precedent from
UC-04 stated once more: *the stand-in stands in for Remote's product, never for
the partner API*.

Had that row not existed, decision 2 would have been the right call for a weaker
reason, and this contract would have said so.

---

## 1. Business purpose

An employee employed through Remote's entity in Country A wants to move to
Country B permanently and keep the same job. Remote's partner API has no atomic
"country transfer" — the move is **two separate legal employment actions**: end the
Country A relationship, start a Country B one. If they are sequenced wrongly a
real person is left, for a real number of days, with no employer, no benefits and
no income, and possibly no lawful immigration status.

UC-07 compiles the research a Mobility Legal Tier-3 specialist would otherwise
gather by hand — feasibility gates, sequencing checks, a cost estimate, the
statutory instruments in force — and stops. **It executes nothing, and it is
built so that it could not be made to.** The business case
(`docs/verification/uc07-business-case.md` §4) rejects the execution engine both
raw research documents proposed, and rejects it on the numbers before safety
enters: the volume is plausibly low double digits a year, the downside per error
is a person's legal status, and the part that takes the time is the specialist's
judgement, which no orchestration saves.

> **The gap is in the API, not in the platform — and that distinction IS the
> business case, stated precisely for the first time on 2026-08-21.** Remote's
> *product* does have a **Country Transfer Service** (`docs/INTAKE-RESEARCH.md`
> §75: *Employee profile → Country Transfer Service → relocation form (new
> country, entity, start date; mostly pre-filled)*, **"Structured form,
> employer-driven"**), while Remote's `llms.txt` publishes **no** relocation,
> country-transfer, entity-transfer or mobility endpoint at all — re-probed
> 2026-08-21, zero matches on all six terms. So what UC-07 automates is not a
> capability Remote lacks; it is the **research a specialist does before opening
> that form**, which no API exposes and no product screen assembles. Saying
> "Remote has no country transfer" without the word **API** overstates in
> Remote's disfavour, and is the identical over-reach that made two-thirds of
> `00-FOUNDATION.md`'s three-endpoint sentence wrong.

## 2. Primary operator persona

**Three people, and the contract is written for the third.** This section said
"two" until 2026-08-21; the requester was one row covering two actors whose
requests are not the same request, which is how the portal came to apply no kind
check at all.

| Actor | Files what | Subject comes from | Verified against |
|---|---|---|---|
| **Employee** | an **enquiry** about their own move | the **session** — never typed | session employment id vs. the Remote record |
| **Company admin** | a **proposal** about an employee | typed into the form | session `companyId` vs. the record's `company_id` |
| **Mobility Legal Tier-3** | nothing. **Reads**, and now **records an outcome** | — | — |

*Why the split, and why the admin is the default.* A permanent relocation is
bilateral — one employment ends and another begins. An employee can **ask**; only
the employer can **propose**. That is not this repository's opinion: Remote's own
Country Transfer Service is **"Structured form, employer-driven"**
(`docs/INTAKE-RESEARCH.md` §75), which settles the default rather than leaving it
to taste.

*The state this replaces, quoted so the change is visible.*
`src/portal/server.js:3047` takes `body.employmentId || subjectEmploymentId(body.persona)`,
and its own comment says: *"No kind check and no refusal is added: anyone may ask
a relocation question, with or without a persona."* Decided 2026-08-21 — Q1,
`R-10`.

*The requester* — an employee planning the move, or a company admin filing on
their behalf. They describe the move in their own words and, on the portal, fill
a structured plan.

*The reader and the operator* — a **Remote Mobility Legal Tier-3 specialist**.
**Experience:** senior; one of the two most senior destinations this system
escalates to. Reads statute, knows what a totalization certificate is, knows the
difference between a residence permit and a work permit.
**Working context:** a Zendesk ticket in the **Mobility Legal (Tier-3)** group
with the Remote CX Review sidebar open; or, for portal submissions, nothing at
all — see §12.
**They understand:** that this is research, that nothing here is an approval,
that they will execute every step themselves in Remote's own product.
**They DO NOT know, and must never be shown:** `UC07_SOURCE_OFFBOARDING_NOT_AUTHORIZED`
as a bare code, `NOT_EVALUATED`, `verdict: PROCEED` without its meaning,
`uncertainty: 0.6` as a bare number, `annualGrossSalaryRemoteInteger`, the
difference between `dateChecks` and `transitionSafety`, or that the employee's
identity in `d.employmentId` is a UUID because six of nine servers publish a
person and this one does not (DRIFT-042).

## 3. Job to be done

*Requester:* "Tell me whether this move can be done, and what has to be settled
first — and be honest about what you could not work out."

*Specialist:* "Hand me one page that contains everything I would have spent a day
gathering, tell me which findings block the plan and which merely need settling,
tell me what you could **not** establish, cite the instruments rather than your
own summary of them, and do not put a button on any of it."

*Specialist, the half that does not exist:* "And hand me the paperwork already
filled in, so I retype it rather than assemble it." §1, §5, §6, §8, §10 and §13.7
all describe drafted, never-submitted paperwork as one of **two** deliverables.
It does not exist — DRIFT-035, **decided 2026-08-21: build it.** The business
case rests on specialist research time saved, and the paperwork is the half of
that time the dossier does not touch.

*Requester, the half that does not exist:* "And tell me what happened." A 🔴 case
with no approve button still owes the person who asked an answer. DRIFT-073 and
decision 3.

## 4. Starting preconditions

- A relocation request exists as free text — a Zendesk ticket carrying the Remote
  Employment ID custom field, or a portal submission.
- **On the portal only:** a structured plan accompanies the text — destination
  supported, entity active, the four dates, annual gross salary, statutory visa
  minimum, right-to-work, PTO transferability, seniority preservability,
  original hire date, term and fee rate.
- **On the Zendesk path there is no plan at all**, deliberately (nothing in a
  ticket body may be read as a destination start date). The consequence is
  DRIFT-034.
- **No precondition requires a Remote record to exist, be active, or belong to
  the requester's company, and none requires the employee to be free of an
  in-flight contract amendment or offboarding.** UC-07 makes no Remote API call of
  any kind — that is simultaneously the strongest form of its safety guarantee and
  DRIFT-032/033. The spec's *"cross-checked against in-flight contract-amendments
  AND offboardings"* is a precondition on paper and nowhere in code.
- The disclaimer, the audit logger and the dossier store need no credentials; a
  fresh clone runs the whole use case offline.

**Added 2026-08-21 by the ninth decision pass — preconditions the built system
will acquire, listed here because a precondition invented at build time is a
precondition nobody agreed to:**

- **Identity is verified before the dossier is compiled**, by a path-specific
  comparison against the authoritative Remote record (`R-8`, DRIFT-033). Failing
  closed is not optional: an unreadable record yields `employment = null`, and
  `null` never satisfies a comparison. The UC-06/UC-09 defect where
  `session.companyId === record.company_id` passed because both were `null` is
  the precedent, and it must not be repeated one use case later.
- **A read-only Remote client is configured, OR a dated capture is present.**
  Exactly one of the two, never neither — and a replay-only run is a **named
  state on the dossier**, not a silent substitution (`R-27`, DRIFT-104).
- **The employee is not the subject of an in-flight contract amendment or
  offboarding** — and where that could not be checked, the dossier says the
  check could not be run rather than omitting it (`R-6`, DRIFT-032). An omitted
  conflict and an absent conflict must not render identically.
- **On the Zendesk path, no plan is still no plan** — but it now yields
  `NOT_ASSESSABLE`, not a verdict (`R-11`, DRIFT-034).

## 5. Main successful journey

1. Someone describes a permanent move — "we're relocating Ana from Spain to the
   Netherlands on 1 October" — in a ticket, or on the portal's relocation form
   alongside the dates, salary and confirmations they hold.
2. The system reads the request: is this actually a permanent relocation, or a
   workation, a business trip, or a change of home address? It says which, and it
   says whether a person or a model made that reading.
2b. **It establishes who is asking, and refuses if it cannot.** The employee's
   session names them; the admin's session names their company; a ticket names a
   Zendesk-authenticated requester whose email is compared to the one on the
   Remote record. Where no authoritative record can be read, the dossier carries
   `identity: "not_verified_no_authoritative_record"` **by name** — an absence is
   never a blank, and a silent `actor` reads like an attribution. *(`R-8`/`R-9`,
   DRIFT-033 — decided 2026-08-21, not yet built.)*
3. It reads the **route** from the direction words in the sentence — "from X to
   Y", in either order — never from the order two country names happen to appear
   in. If the sentence gives no directional cue, both ends stay unknown and the
   dossier says so.
4. It runs the deterministic checks over the plan: is the destination available,
   does the start date clear the destination's onboarding lead time, does the
   salary clear the statutory visa minimum, do the dates leave a gap or an
   overlap, are termination and start aligned to month boundaries, is PTO
   portable or liquidated, does seniority carry.
4b. **It asks Remote what it already knows about this employment.** Availability
   and entity status come from Remote rather than from a checkbox the requester
   ticked about their own case, and — the check the spec has always named and the
   code has never had — **in-flight contract amendments and in-flight
   offboardings for the same employment**. Three outcomes, and all three are
   distinguishable on the page: no conflict; a conflict, named; or the check
   could not be run, said in those words. **An omitted conflict must never render
   identically to an absent one** — that is UC-08's `jurisdictions: []` defect
   arriving by a different route. *(`R-1`…`R-7`, DRIFT-032 — decided 2026-08-21,
   not yet built.)*
5. It applies **the rule the whole use case exists for**: the source employment
   may not be ended until the destination is ready — contract active,
   right-to-work confirmed, start date confirmed, exit plan validated. Creating
   the destination record is not readiness.
6. It estimates the employer cost, and marks every component it could not derive
   as needing a quote rather than filling it with a number.
7. It writes one dossier: the verdict and what that verdict does **not** mean,
   what blocks the plan and what merely needs settling, one ranked list of
   everything it could not establish, and the statutory instruments each finding
   rests on — quoted, with the caveats the corpus records against them, and with
   an explicit statement where no instrument was found.
8. Before anything else on the page, the reader is told this is research support
   only and not a legal, immigration or tax determination.
9. **It drafts the paperwork it will never submit** — a pre-filled source-country
   offboarding request and a destination new-employment request, rendered as
   documents a human reads and retypes, never as serialised API payloads, with
   every field that came from a self-declaration marked as one. *(`R-14`…`R-16`,
   DRIFT-035 — decided 2026-08-21, not yet built.)*
10. The case is handed to Mobility Legal (Tier-3) — **on both paths**, which
   today is true only on the Zendesk one. **Nothing is approved, here or
   anywhere.** The specialist reads it, decides, and executes every step
   themselves in Remote's own product.
11. **The specialist records an outcome, and the requester is told.**
   `dossier_read`, then one of `proceeding_offline` / `not_proceeding` /
   `more_information_needed` — **recorded on the ticket, never on the dossier
   record**, because the store's one-write-method-zero-mutations property *is*
   the structural proof and `markReviewed()` would delete the proof in order to
   record that it worked. Not one of those verbs executes anything in Remote.
   *(`R-23`/`R-24`, DRIFT-073 + Q2 — decided 2026-08-21, not yet built.)*

> **Steps 10 and 11 are the hand-off, not the control.** "Nothing may be approved
> here" and "nobody may ever be told what happened" are two different rules and
> only the first is the 🔴 invariant; until 2026-08-21 they were satisfied by the
> same mechanism, which is why closing the second reads like weakening the first.
> It is not. See the Decisions box.

## 6. Valid variations

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| Complete plan, supported destination, active entity, dates clean and month-end aligned, salary above the visa minimum, right-to-work confirmed, exit plan validated, PTO portable, seniority preserved with a hire date, employer already present in the destination, treaty nexus confirmed | `escalate` · verdict **PROCEED**, zero flags | The specialist is told the gates found nothing wrong with the **plan**, and told in the same sentence that this is not an approval |
| Destination not on the curated list | `escalate` · **BLOCK** · `DESTINATION_COUNTRY_UNSUPPORTED` | Escalate-by-default outside the nine curated countries is the design, not a gap |
| Destination legal entity inactive | **BLOCK** · `DESTINATION_ENTITY_INACTIVE` | |
| Start date inside the destination's minimum onboarding time | **BLOCK** · `MOT_VIOLATION`, with the earliest allowed date named | Counted in **business** days |
| Salary below the destination's statutory visa minimum | **BLOCK** · `SALARY_BELOW_VISA_MINIMUM`, shortfall stated | Both sides ANNUAL gross ×100 — a comparison across two periods is not a comparison |
| Salary **absent** | No visa-minimum flag at all | Unknown is never "below". Inventing a deficit from an absence is the error this gate refuses |
| Source last working day before destination start | **BLOCK** · `EMPLOYMENT_GAP` | The days a person would be unemployed |
| Overlapping dates, or termination/start not on month boundaries | `DUPLICATE_FEE_RISK` (MEDIUM) | A duplicate month of EOR management fee |
| Any of the four sequencing confirmations missing | **BLOCK** · `SOURCE_OFFBOARDING_NOT_AUTHORIZED`, naming each outstanding condition | The headline rule |
| Immigration support needed and not confirmed | `IMMIGRATION_REQUIRED` + required action `IMMIGRATION_ASSESSMENT` | |
| Employer not already present in the destination | `PE_RISK_REVIEW_REQUIRED` + `PE_REVIEW` | Raised whenever presence is anything other than an explicit `true` |
| Treaty nexus not confirmed | `TAX_RESIDENCY_REVIEW_REQUIRED` + `TAX_REVIEW` | |
| PTO not transferable | `PTO_TRANSFER_NOT_ALLOWED` (LOW) + a liquidation cashout line | |
| PTO liquidated but salary or day count unknown | `PTO_CASHOUT_NOT_COMPUTABLE` (MEDIUM), **no figure at any value** | A settlement of `0.00` gets signed off; a missing one gets investigated |
| PTO balance is a real, typed `0` | Cashout **0**, computable | A counted zero is an answer. An uncounted one is not |
| Seniority preservability unknown | `SENIORITY_REVIEW_REQUIRED` · `REQUIRES_LEGAL_REVIEW` | Never conflated with `RESET` |
| Seniority preserved but no original hire date | Status stays `PRESERVED`, and the dossier says in words that the date it is preserved **from** is still unestablished | Notice, severance and vesting are all counted from that date |
| Two countries named with no directional cue | Both ends `null` · `COUNTRIES_NOT_DETERMINED` (MEDIUM) · narrative prints "not identified" | A confident wrong "DE" gives a specialist no reason to check |
| Request is a workation, a business trip or an address change | Classified as such, **and still compiled as a relocation dossier and escalated to Mobility Legal Tier-3** | See §12 — there is nowhere to send it |
| No transfer fee / mobility fee supplied | Component listed `QUOTE_REQUIRED`, excluded from every total, named in `pendingQuotes` | Remote Pricing is the source of truth for a price; this system may not invent one |
| No salary at all | Estimate `INCOMPLETE`, every total `null` (not `0.00`) | A sum of nothing known is not zero money |
| Any input whatsoever, including the most favourable plan the form can express | **`escalate`** | This is the invariant, not a variation |

**Added 2026-08-21 by the ninth decision pass — decided, not yet built:**

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| **An employee files about their own move** | Subject forced from the session; a typed `employmentId` naming anyone else is refused | An employee may ask about themselves and nobody else. Today no kind check exists at all (Q1, `R-10`) |
| **A company admin files about an employee** | Subject typed; the admin's session `companyId` compared to the record's `company_id`, **failing closed on `null`** | The employer-driven shape Remote's own Country Transfer Service uses. `null === null` must never pass — the UC-06/UC-09 defect, one use case later |
| **A Zendesk-originated request (no plan)** | `verdict: NOT_ASSESSABLE`, `planSource: "none"` — **not a verdict about the relocation** | "We could not assess this" stops being printed in the vocabulary of "this is blocked". The specialist's first act is to send the portal link (DRIFT-034, `R-11`/`R-13`) |
| **A Zendesk-originated request, with the read-only client configured** | `INCOMPLETE`, with a **named list** of what is still missing | Remote's own facts fill themselves; only what a human alone knows — dates, PTO intent — stays open. Nine identical flags become a short specific list (`R-12`) |
| **The Sandbox is unreachable and a dated capture exists** | The dossier compiles from the capture and **says so on its face** — `X-Sandbox-Replay`, a `_replay` block, and the date on screen | A live value always wins; a replayed one is never silent. An unmarked fallback is worse than a failure, because nobody can tell afterwards which they watched (DRIFT-104, `R-27`) |
| **A second relocation request for the same employment** | Detected via `dossierStore.listByOwner({employmentId})` and named on both dossiers | Two contradictory verdicts waiting forever is the current behaviour (DRIFT-103, `R-26`) |

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate delivery of the same request** | One claim on `workflow_claims (use_case, external_ref)`; the second returns `{decision:"escalate", duplicate:true}` and writes **no audit row and no dossier**. There is no execution to double, but the audit log is this tier's deliverable and a clean record is the point |
| **A ticket with no Remote employment id** | The n8n normalizer throws by name rather than guessing. Refusing to guess is correct; note that nothing then verifies the id it does accept (DRIFT-033) |
| **A quoted salary (`"6500000"`)** | Refused, not coerced. A string that divides by 100 correctly is exactly how a ×100 scaling error enters |
| **A non-integer salary that is present** | `runCostCalculator` **throws**. Present-but-malformed is a bug; absent is an honest incompleteness. The two must not collapse into each other |
| **An underivable PTO cashout** | Was a `NaN` thrown ~90 lines **before** the audit write, so the whole request vanished — no dossier, no audit row, the one outcome fail-closed is meant to prevent. Now a flag, a `null`, and a named missing field |
| **A blank currency box** | The workflow passes `null` rather than defaulting to `"USD"` — and the `INCOMPLETE` branch of `costCalculator.js` then re-applies `?? "USD"` to the estimate and to all three components. The defect the workflow's own comment forbids is reintroduced one module later, on precisely the branch where nothing is known |
| **A dossier the specialist cannot find** | `list()` reads Postgres, not this process's memory. On Vercel a process lasts one request, and this route once answered `{dossiers: []}` over five real rows |
| **A dossier written by the n8n path** | Read-time derivation is supposed to apply identically. It does not — see DRIFT-072 |
| **The dossier is read twice, a month apart** | Nothing changes and nothing can. There is no status column: `awaitingState()` returns `awaiting / reading` forever |
| **A relocation that is really a workation** | Compiled as a relocation, escalated to Tier-3. No route exists to UC-04 or UC-03 |
| **A dead employment id** (`fde4007b-…`, retired in the Sandbox reseed) | Recorded as the audit `actor` without complaint. Live: two rows in `audit_log` carry it |
| **The employee already has a contract amendment or an offboarding in flight** | **Must be flagged before the dossier compiles** (§7, §9). It is not — neither read exists, so the dossier is silent, and a dossier that omits a conflict is byte-identical to one where there was no conflict. DRIFT-032 |
| **PE-risk material** | `UC07_PE_RISK_REVIEW_REQUIRED` — the flag most likely to be escalated onward — is the **least sourced finding the dossier produces**. OECD Model art. 5 and BEPS Action 7 are paraphrase-only by licence and were never retrieved. It is recorded as uncitable, not paraphrased |
| **Nationality** | There is no such field anywhere in `src/uc07/`. Every immigration route cited is a destination's route for a *third-country national*, and whether it is **this person's** route turns on a passport the system does not hold. `NATIONALITY_NOT_HELD` is attached unconditionally to every immigration citation and raises a priority-1 open question |
| **A destination with no instrument in the corpus** (NL) | An explicit absence, in words: another country's visa route is not a substitute for a missing one. Never a neighbour's |

**Added 2026-08-21 by the ninth decision pass — decided, not yet built:**

| Case | Expected behaviour |
|---|---|
| **Duplicate delivery, from the caller's side** | The row above is right about the ledger and wrong about the caller. `workflow.js:238–240` returns **`decision: "escalate"`** — the same string a successful compile returns — with `dossierId: null`, no audit row and no ticket. **Nobody is escalated to.** A portal requester who submits twice receives a success-shaped response with nothing behind it. Must become its own outcome, distinguishable by the caller without inspecting `duplicate` (DRIFT-102, `R-25`) |
| **The Sandbox answers, but refuses the scope** | A `403 "invalid role"` and an absent route must be told apart, and told apart **by name**. This exact conflation produced DRIFT-063 and left UC-02's expense-category gap filed for weeks as "needs a better token" when no token could ever have opened that endpoint. `M-1` in §18 exists to settle it before any code is written |
| **The Sandbox is reachable, the capture is stale** | A capture older than the agreed horizon still answers, still self-identifies, and says its age. Whether it should refuse instead is **`G2`, open** — named rather than guessed |
| **The conflict check cannot be run at all** | The dossier says the check could not be run, in words, in the same place a found conflict would appear. **Silence is the one forbidden outcome**: a dossier that omits a conflict and a dossier where there was none must never render identically (DRIFT-032, `R-6`) |

## 8. Invariants — must never happen

1. **No execution path exists.** Not a policy that declines to call a write
   method — no write-capable client can reach this code. Five independent
   properties, and **which of them a test actually asserts matters more than the
   claim**:

   | Property | Asserted by test? |
   |---|---|
   | `handleRelocationReview()`'s parameter list admits no `remote`/`zendesk` | ✅ `test/uc07.test.js` "F-38: handleRelocationReview's own parameter list…" — parsed out of the real signature, not a comment |
   | `DossierStore`'s method surface is exactly `createDossier` + five reads | ✅ **allow-list**: `deepEqual` against the enumerated set, so a sixth method fails until someone widens it deliberately. It was a **blocklist of five names** until F-38; `linkTicket` — the method `src/portal/ticketing.js` worries about by name — would have passed |
   | `src/uc07/server.js` contains no write route of any verb | ✅ all four of POST/PUT/PATCH/DELETE, plus a behavioural 404 test in `test/uc07Server.test.js` |
   | The module's source, comments stripped, references no write-capable client method | ⚠️ **partially.** `test/uc07.test.js` 6a is a **blocklist of ten names over `workflow.js` alone**. `transitionGate.js`, `dossierBuilder.js`, `costCalculator.js`, `dossierView.js` and `dossierStore.js` are not scanned by it, and an eleventh method name would pass |
   | The n8n graph has no Switch/IF node | ❌ **not asserted anywhere, and not verifiable from the repository** — there is no `workflows/uc-07.json`; the graph exists only in the n8n instance (`WORKFLOW_UC07_ID`). `workflows/README.md` claims it, and in the same paragraph claims "no write node of any kind" while its own diagram lists two Supabase inserts and a Zendesk ticket update |

2. **The decision is always `escalate`.** No input, however favourable, produces
   anything else — asserted behaviourally, including against a maximally
   favourable plan.
3. **The mandatory framing statement is on every dossier, exactly once, above
   every finding.** It is a literal in `buildDossier()`'s return object on both
   execution paths, so coverage is 100% **by construction, not by rate**. Position,
   presence, single-occurrence and verbatim wording are pinned in
   `test/zafLongformDisclosure.test.js`. Note: the audit row's
   `disclaimerApplied: true` is a **hardcoded literal, not an observation** — it
   asserts the invariant rather than measuring it.
4. **The LLM is never the source of a fact.** It may read a request and restate
   decided facts as prose. The narrative is validated to have produced text and
   is never read back into a gate. The faithfulness judge's verdict is attached
   for a human and is consumed by nothing.
5. **A figure that cannot be derived is `null`, never `0`, and never carries a
   currency.** A partial total is never offered as a total.
6. **A component that was not quoted is `QUOTE_REQUIRED` and contributes to no
   total.** (See DRIFT-070 for the one component that is presented as
   `CALCULATED` on a rate nobody quoted.)
7. **A retrieval signal is never a precision claim.** `matchedOn` never quotes a
   similarity percentage.
8. **A citation never carries a number.** A statute may be *quoted*; no numeric
   value may be returned as a field, because the moment `183` is a field
   something compares it.
9. **An absence is never a blank.** `NOT_EVALUATED`, `null` seniority date,
   `unusable[]`, `pendingQuotes`, `uncited` — each is collected into one ranked
   list of open questions rather than left for a reader to notice.
10. **`PROCEED` is never printed without the sentence saying it is not an
    approval.**
11. **A dossier is written once and never mutated.** No status, no approve, no
    deny, no `markReviewed`.
12. **Nothing may approve this — `none_by_design`, deliberately a different value
    from `none_missing`.** Both render as "no approve button" and they mean
    opposite things: one is the guarantee working, the other is a request nobody
    can reach. Returned as a word rather than a boolean precisely so no caller can
    test `!hasControl` and treat UC-07 and UC-03 as the same state.

**Added 2026-08-21 by the ninth decision pass. Every one of these is a property
the BUILD must not lose, and four of the five are properties that would fail
silently — nothing in the current suite would catch their loss.**

13. **The Remote client UC-07 holds exposes exactly six methods, and a write is
    unnameable on it.** Not "a client used with discipline" — a **façade**, the
    same reasoning that gave `dossierStore` one write method and zero mutation
    methods rather than a store that declines to mutate. Pinned two ways: the
    façade's method list is asserted exactly, and `src/uc07/` is asserted never to
    import `RemoteClient` directly. **The existing structural test would not catch
    the loss** — it greps for write-method *names*, and a client that merely
    *could* write names nothing (`R-1`/`R-2`).
14. **The drafted paperwork is a rendered document, never a serialised API
    payload.** A pre-filled `POST /v1/employments` body sitting on a 🔴 dossier is
    one accidental wiring away from being the execution path this tier forbids,
    and the current assertions — a parameter list, a store's method surface, a
    route list — would not see it. **The invariant is satisfied vacuously today**
    (there is nothing to submit, which is not the same as something preventing
    submission) and must be re-derived *before* the generator ships (`R-16`).
15. **A substituted fact is always self-identifying.** No replayed value ever
    reaches a reader looking like something Remote said in that moment:
    `X-Sandbox-Replay`, a `_replay` block, the date on screen, and
    `source: "sandbox_live" | "sandbox_replay"` on the trace row. **A real value
    always wins** — replay is consulted only when the live call fails, never
    cache-first (`R-27`, and `CLAUDE.md` §3 directive 6).
16. **Money is never fabricated.** Already the rule; DRIFT-070 is the live
    violation. A rate this repository invented, supplied as a default by every
    caller and emitted as `CALCULATED`, is a fabricated number wearing the one
    status that means the opposite (`R-17`).
17. **The outcome record lives on the ticket, never on the dossier store.**
    `uc07_dossiers` keeps one write method and zero mutation methods **after** the
    aftermath is built. Anyone reaching for `markReviewed()` has misread which
    rule the aftermath closes (`R-23`/`R-24`, and invariant 11, which stands
    unchanged and unweakened).

## 9. AI responsibilities

**The LLM may:** classify the request type (permanent relocation vs. workation
vs. business travel vs. address change), extract the source and destination and
whether visa support was asked for, and draft the dossier narrative as prose
restating facts the gates already decided.

**Every LLM result is tagged** `source: "llm" | "rule_based_fallback"`, retried
3× with backoff with a per-attempt audit trace, and shape-validated before use —
an LLM-supplied country must be a well-formed alpha-2 code or it becomes `null`.

**The LLM must never:** decide feasibility, produce or alter any flag, produce
any money figure, assert a legal conclusion, decide whether the relocation should
proceed, or submit anything. It is not the source of the route when a structured
fact supplies one — the plan wins over the classifier's reading, always.

**The one seam that is narrower than it looks:** the parser's
`immigrationSupportRequired` does feed a gate, but only where the plan does not
already state it, and it can only ever *raise* a review flag.

**The seam the drafted paperwork adds, and the line it must not cross
(2026-08-21, `R-14`/`R-16`).** The LLM may draft **prose**: the covering summary
on a rendered document, restating fields the gates already decided. It may
**not** populate a field, choose a reason code, or emit anything with the shape
of an API request body. The distinction is not stylistic — §6 of
`docs/use-cases/UC-07.md` already lists drafting under what the LLM *does* and
submitting under what it must **not**, and a serialised payload collapses the gap
between those two into one accidental wiring. **The correct artifact is a
document a human reads and retypes**, and prime directive #1 is the reason: an
LLM may never be the source of a value that reaches a state change, and a
pre-filled payload is a value that has already been formatted for one.

## 10. Deterministic responsibilities

Everything else, and it is all pure: request-type precedence · route resolution
from direction words · destination availability and entity status · minimum
onboarding time in business days · salary vs. statutory visa minimum · gap and
overlap · month-end alignment · the four-condition transition-safety rule · PTO
liquidation and its cashout · seniority continuity · the flag severities · the
verdict (`BLOCK` if any HIGH, `REVIEW` if any flag, else `PROCEED`) · the
uncertainty score and its per-flag breakdown · the cost components and both
totals · the citation lookup · the disclaimer · the exactly-once claim · the
audit row.

The gates exist twice. `test/n8nUc07Parity.test.js` (26 tests) `deepEqual`s the
**whole dossier and the whole feasibility object** across 16 scenarios — it
compared only `verdict`/`feasible`/flag codes until 2026-08-19, which is the half
that had never diverged, and is how a differently-shaped dossier, a different
citation corpus, a different disclaimer and a cost estimate **with no
`QUOTE_REQUIRED` markers at all** survived a green suite on the live path.

`workflows/nodes-uc07/normalizeRelocationRequest.js` is the exception: it is
**syntax-checked and nothing else**. No test drives it, which is how DRIFT-034
survived.

**Added 2026-08-21 by the ninth decision pass — deterministic work the build
acquires, listed because each one is a gate and none of them is a judgement:**

- **The identity comparison**, per path, failing closed on `null` (`R-8`). It is
  deterministic in every use case that has one, and this is the only one of the
  nine with no gate at all to compare against.
- **The conflict check** over in-flight contract amendments and offboardings
  (`R-6`) — a set membership test on data Remote returns, never an inference.
- **Which leg answered.** `source: "sandbox_live" | "sandbox_replay"` is recorded
  the way `classification.source` already is, and for the same reason: invariant
  8 exists because a reference implementation should never be less observable
  than its own copy, and a fallback that cannot be distinguished from a live call
  is exactly that failure one system over (`R-27`).
- **Second-request detection** via `dossierStore.listByOwner({employmentId})`,
  which already exists at `dossierStore.js:161` and which no caller uses for this
  (`R-26`).

## 11. Human approval / escalation

| | |
|---|---|
| **When** | Always. Every UC-07 request escalates, at every verdict |
| **Who** | **Nobody approves.** A **Mobility Legal Tier-3** specialist *reads* the dossier and executes each step themselves in Remote's own product. `approvalRoutes.js`: `control: "none_by_design"`, `surface: null`, `endpoint: null`, `verbs: []`, `roles: []`, `slotsRequired: null` |
| **Evidence needed** | The whole dossier: who and where, the verdict and what it does not mean, blockers separated from review items, the sequencing conditions still outstanding, the cost with its pending quotes, the ranked open questions, and the instruments each finding rests on — with the explicit absences where there are none |
| **After "approval"** | **Changed 2026-08-21.** It was *"n/a. Nothing in this system changes state, ever"* — true of the relocation and false of the hand-off. The specialist now records an **outcome**: `dossier_read`, then one of `proceeding_offline` / `not_proceeding` / `more_information_needed`. **None of them executes anything in Remote**, and the record lives **on the ticket**, never on `uc07_dossiers`. Invariant 11 is unchanged: the dossier is still written once and never mutated (`R-23`/`R-24`) |
| **Expiry** | **None** — DRIFT-041, **still open and not closed by this pass**. A dossier compiled against a proposed start date is still "current" after that date has passed, and nothing re-checks it. What the aftermath changes is only that a dossier can now *leave* the list by being acted on; it still cannot leave by growing stale, and those are different mechanisms. Recording the second as fixed because the first landed would be the error this register exists to prevent |
| **If nobody responds** | **Changed 2026-08-21, in one half only.** It read: *"Nothing happens, and nothing can detect it."* With the outcome verbs on the ticket, a dossier that has been read is now distinguishable from one that has not, so the queue's stuck list starts meaning something again. **A dossier nobody ever opens is still undetectable** — that needs DRIFT-041's expiry, which this pass did not decide. Original text follows, kept because the mechanism it describes is still live for the unread case: Nothing happens, and **nothing can detect it**. There is no status column, so `awaitingState()` answers `awaiting / reading` in perpetuity: *"waiting to be read until the team it was compiled for says otherwise, somewhere this system cannot see."* On the Zendesk path the ticket is at least in the right group; on the portal path there is no ticket and the item lands in the approval queue's **`no_ticket`** category — the stuck category whose `why` says plainly that the missing thing is the hand-off, not a control |

**What the requester is told, per state — added 2026-08-21, because until now the
answer was "one acknowledgement at submission, then silence, permanently."**

| State | Employee who filed | Company admin who filed |
|---|---|---|
| Dossier compiled | The acknowledgement, with its disclaimer — **unchanged**, and it is already good | The same, against the subject they named |
| Handed to Mobility Legal | *"A mobility legal specialist has it."* Today, on the portal path, **nobody has it** (DRIFT-073) | The same |
| `dossier_read` | *"A specialist has read it."* | The same |
| `proceeding_offline` | *"A specialist is taking this forward in Remote directly."* Never *"approved"* — nothing was approved | The same |
| `not_proceeding` | *"This is not being taken forward. The specialist will explain."* The system does not author the reason; a 🔴 refusal is a person's to give | The same |
| `more_information_needed` | *"A specialist needs more from you"*, with the ranked open questions the dossier already computes | The same |

**Two rules govern this table.** The wording never uses approval vocabulary,
because no approval occurred and a requester who reads "approved" will act on it.
And the system never authors the substance of a `not_proceeding` — it reports
that a person decided, and leaves the reason to the person, which is the same
boundary `docs/UI-AUDIENCES.md` §5 draws around a 🔴 dossier's disclaimers.

## 12. CROSS_UC_ROUTING

> **UC-07's own §5 opens `Ticket (routed from UC-03, or direct)`. That inbound
> route does not exist** — recorded by the lead pass as **DRIFT-011**, referenced
> here, not renumbered. UC-03's classifier recognises exactly two intents,
> `business_travel` and `work_authorization` (`src/uc03/classifier.js:42`), and
> the word "relocat" appears nowhere in `src/uc03/` outside a comment in
> `uc04Intake.js`. **"I'm moving to Portugal permanently and will keep working"
> classifies as `work_authorization` and routes to UC-04** — a 🟡 temporary-
> workation risk matrix — where its start date sits in the past on the day the
> move completes and its "trip" has no end date. Permanent-move language reaches
> a travel-letter team by design of a router that was never told this use case
> exists.

> ### DISPOSITION — 2026-08-21 · the inbound route from UC-03 is STRUCK
>
> **`DECIDED · NOT YET BUILT`** (documentation only — `docs/use-cases/UC-07.md`
> §5's `Ticket (routed from UC-03, or direct)` is deleted). Registered separately
> as **DRIFT-105**, because a spec line describing a route that has never existed
> is its own finding and not a footnote to DRIFT-011.
>
> The owner's decision: *"I don't think we need to route 03 to 07."* The code
> already agrees — `src/uc03/policyEngine.js`'s decision union is
> `auto_resolve | human_review | escalate | route_to_uc04` and there is no UC-07
> branch anywhere in `src/uc03/`.
>
> **It is struck on merit, not for tidiness.** UC-03 answers *"may I work from X
> for three weeks."* A permanent relocation is not a longer workation — it is a
> different legal event, two employment actions rather than none. A routing edge
> would let a 🟢 router's classifier open a 🔴 case on a keyword, and this
> repository has already paid for that once: UC-03's parser read `fr` inside
> *from* and `ca` inside *relocating*, and published *"Source country: DE;
> Destination country: FR"* on live ticket 18 for a request that said Portugal to
> Germany.
>
> **The precedence that replaces it already exists, and is already in the right
> place.** `src/uc07/relocationParser.js` recognises workation, business-travel
> and address-change phrasings **before** "relocat"-ish language, per Build Pack
> Part 4. **The specific use case declines the general one; the general one never
> guesses.**
>
> **What is NOT closed by this, and does not belong to UC-07:** the misroute in
> the box above is live. Permanent-move language classifies as
> `work_authorization` and lands in UC-04's 🟡 temporary-workation matrix. That is
> **DRIFT-011**, and it is UC-03's and UC-04's to fix — noted here so that a
> reader who sees the inbound route struck does not conclude the traffic stopped.

---

### How UC-07 actually connects to UC-04 and UC-03 — decided 2026-08-21

The owner: *"I don't just want to push this under the bus. Kindly explain how in
reality UC-07 connects to UC-04 / UC-03 and if it is something we should build,
because now I feel one use case can genuinely impact others here."*

**Three connections exist. They are three different kinds, and the only one that
is control flow is the only one not to build.**

| # | Connection | Kind | Build? |
|---|---|---|---|
| **a** | **Shared reference data.** §7 specifies *"the same 4-dimension coverage/risk gate as UC-04 … reusing UC-04's maintained tables"*. Reality: `src/uc07/` imports nothing from `src/uc04/`, and the four dimensions are four **checkboxes on the requester's own form** | a shared **module** | ✅ **Yes** |
| **b** | **A real-world sequence.** An employee often workations first (UC-04), likes it, then asks to move. Prior approved workations in the destination bear on **PE exposure** and **tax residency** — both of which UC-07 already flags | an **evidential read** | ✅ **Yes, as a read.** Never a trigger |
| **c** | **The conflict check.** An in-flight contract amendment (UC-06's object) or offboarding (UC-05's object) on the same employment | a **read of Remote's own records** | ✅ **Yes** — this is DRIFT-032 |

**(a) has a precedent that settles how to build it.** UC-03's restricted-country
set is *imported* by UC-04 rather than copied, and the pass that did it wrote the
rule down: *"a jurisdiction property is not a use-case property, and two copies
drift."* Same rule, one dimension over. Note the vocabulary collision to avoid
while doing it: UC-07's `coverage` key means the **employment gap/overlap** check,
not the treaty coverage §7's "entity coverage" names.

**(b) is a sequence, not a dependency.** Two requests, months apart, decided by
different people under different law. UC-07 may **read** UC-04's authorizations
for the employment and cite them as findings. It must never be **triggered** by
one, and UC-04 must never learn to emit a relocation.

**(c) is where "one use case genuinely impacts another" is literally true, and it
is currently invisible by construction.** A dossier compiled for an employee who
already has an offboarding submitted is **byte-identical** to one for an employee
who does not. That is UC-08's *"273 presence days with `jurisdictions: []`"*
defect arriving by a different route — an answer to a different question, printed
in the same shape, with the reader supplying the missing half from memory. It is
also precisely the scenario the transition-safety rule exists to prevent,
arriving where that rule cannot see it: `sourceExitPlanValidated` is a checkbox,
and **an offboarding somebody else already submitted does not tick it.**

> **The rule that falls out, and it generalises past this use case:**
>
> **Use cases connect through shared reference data, and through reads of each
> other's records — never by one deciding to invoke another.** A routing edge
> makes the caller's classifier the gate of the callee's tier, and a 🟢
> classifier must never be able to open a 🔴 case.
>
> The existing `route_to_uc04` is not a counter-example and is worth
> understanding as the boundary case: UC-03 does not *invoke* UC-04: it records a
> normalized hand-off event, tags it, and stops — and `src/uc03/signoffPolicy.js`
> refuses to let anyone sign it, precisely because a 🟢 router must not mint a 🟡
> work authorization by click. What it hands over is a **request**, not a
> decision.

**May receive from**
- **A Zendesk ticket, directly** — the real inbound path. `POST /uc-07-relocation`.
- **The portal's relocation form** (`src/portal/server.js` `uc07()`), one of the
  seven types the portal serves.
- *(Documented and NOT BUILT: UC-03. See DRIFT-011.)*
- *(Not documented and arguably required: **UC-04 → UC-07**. UC-04 routinely
  computes exactly the signals that mean "this is not a trip, it is a move" and
  has nowhere to send them — the lead pass recorded that direction as
  **DRIFT-021**. Referenced, not renumbered.)*

**May route to**
- **Nothing.** UC-07 terminates in a dossier and a hand-off to a human.
- *(Arguably required and absent: **UC-07 → UC-08.** A permanent relocation is a
  tax-nexus event by definition — `dossierView.js` says so itself, treating tax
  residence at both ends and social-security membership as findings a relocation
  raises **by existing rather than by failing a gate**. UC-08 is the use case
  whose entire subject that is, and the two do not connect. UC-07 instead carries
  its own `TAX_RESIDENCY_REVIEW_REQUIRED` flag to Mobility Legal, where UC-08's
  mandatory tax disclaimer and Tax Operations' queue do not apply.)*
- *(Also absent: **UC-07 → UC-04 / UC-03.** UC-07's parser explicitly recognises
  `temporary_workation` and `business_travel` — Build Pack Part 4 precedence, so
  those readings win over "relocat"-ish language on purpose — and then compiles a
  **permanent-relocation dossier** for them anyway and escalates it to the most
  senior mobility queue in the system. The classification is made and then
  discarded.)*

**A cross-UC dependency that is not a route, and is specified rather than built**

§5 and §7 require UC-07 to **read the records two other use cases own** before it
compiles anything: in-flight **contract amendments** (UC-06's object) and in-flight
**offboardings** (the object behind UC-05's resignations). That is a genuine
one-directional data dependency — UC-06 and UC-05 never read UC-07's dossiers, and
should not — and it is the only cross-UC coupling this use case has. **Neither read
exists** (DRIFT-032). The practical consequence is that the two use cases most
able to invalidate a relocation plan mid-flight can do so invisibly: UC-06 can
approve a salary amendment that moves the employee below the destination's
statutory visa minimum the day after this dossier cleared it, and nothing
re-checks; UC-05 can put an offboarding in flight that the dossier's own
sequencing rule exists to order, and the dossier will not mention it.

**Routing conditions**
None exist in either direction. The only conditional hand-off UC-07 performs is
to a human, and it is unconditional.

**Context that MUST transfer** — evaluated against the one hand-off that exists,
**UC-07 → the Mobility Legal Tier-3 specialist**:

| | Carried | Notes |
|---|---|---|
| Customer/user identity | ⚠️ **An identifier, not an identity** | The employment id is carried and **never verified against anything** (DRIFT-033). On the portal path it may be `null` where no persona is set |
| Employment/entity identifier | ⚠️ | The employment id reaches the panel as a **bare UUID** — `src/uc07/server.js` does not import `src/shared/employeeSubject.js`, which six of the nine servers do. UC-07 is one of exactly three that still answer the specialist's first question with an id rather than a person (**DRIFT-042**, cross-cutting, referenced not renumbered). `zaf-app/assets/main.js`'s `loadUc07` already reads `data.employee` — the loader is ready and the server publishes nothing. `src/uc07/dossierView.js` does **not** supply the subject by another route: it carries countries by name and the employee by nothing |
| Zendesk ticket / reference | ⚠️ **Path-dependent, and this is the whole finding.** Zendesk path: the ticket already exists, the graph adds an internal note and `workflows/nodes/assignRouting.js` assigns **Mobility Legal (Tier-3)** with `queue_mobility_legal_t3`. **Portal path: no ticket is raised at all**, by design — `src/portal/ticketing.js` excludes UC-07 and UC-08 from `TICKETABLE_TYPES` because linking a ticket means writing an id back onto a record, and these stores have one write method and zero mutations |
| Trace / correlation id | ✅ | `externalRef` on the audit row, the claim row and the dossier row |
| Evidence already gathered | ✅ | The dossier **is** the evidence: sixteen sections, plus read-time blockers/reviewItems, the uncertainty breakdown, the ranked open questions and the statutory `sources`/`uncited`/`basis` |
| Decision / risk information | ✅ | Verdict, every flag with severity and message, required actions, uncertainty with its per-flag contributions and whether it hit the cap |
| Approvals already obtained | n/a | None exist, correctly |
| Relevant conversation | ✅ | The request text drives the parse; the parse source is on the dossier |
| **Other required state** | ❌ **Nationality has no field anywhere**, and every immigration route cited is a route for a third-country national. ❌ **`coverage` and `alignment` report a gap or an overlap without the dates they were computed between** — the plan is not stored on the dossier row, so neither the gate nor a read-time derivation can supply them |

**Must NOT happen during handoff**

- ❌ **The customer must not repeat what they already said.** *Satisfied on the
  portal* (one form, one submission). ⚠️ **At risk on the Zendesk path** — the
  ticket arrives with `plan: {}` and every date, salary and confirmation the
  gates need must be asked for again, by a human, off-system. See DRIFT-034.
- ❌ **Duplicate work must not be created.** *Satisfied* — one claim per
  `(UC-07, externalRef)`; a redelivery writes nothing.
- ❌ **Audit continuity must not be lost.** *Satisfied* — one `externalRef` spans
  the claim, the audit row and the dossier row. 21 `audit_log` rows exist against
  7 dossier rows, which is consistent (runs without a store still audit).
- ❌ **Approval state must not be lost.** *n/a — none exists, and none may.*
- ❌ **Ownership must not become ambiguous.** *Satisfied* — uniquely among the
  nine, UC-07's spoken name, its routing-table team and its live Zendesk group
  agree: **Mobility Legal (Tier-3)**, group `6168424846751`
  (`docs/ESCALATION-DESTINATIONS.md` line 106). This is the one row with no
  said-vs-routed contradiction.
- ❌ **Two use cases must not execute conflicting actions.** *Satisfied
  structurally* — UC-07 executes nothing at all.
- ❌ **Duplicate Zendesk tickets must not be created without a business reason.**
  *Satisfied vacuously* — UC-07 creates no ticket on any path.
- ❌ **The receiving team must not be left unaware.** ⚠️ **At risk, and it is
  live.** On the portal path the dossier is compiled, audited, durably stored —
  and **nobody is told**. No ticket, no group, no queue entry, no notification.
  "Where is this approved?" is *nowhere, and correctly nowhere*; "where does the
  specialist **read** it?" is *they have to know to look*. See DRIFT-073.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Portal (requester) — after 2026-08-21** | Everything in the row below, plus: the form is **role-shaped** (an employee files about themselves, an admin names a subject); the result carries the **self-declared** marking on every input Remote did not confirm; "My requests" stops saying `no_decision_path` forever and shows the specialist's outcome when one is recorded (`R-10`, `R-24`) |
| **Portal (requester)** | The relocation form: free text plus the structured plan, countries chosen from Remote's own list, both salary boxes labelled **ANNUAL**, seniority as a tri-state (yes/no/unknown), a PTO-days box that stays **unset** when blank. The result opens with the **answer** in a dialog and carries **no offer** — there is no next action for anyone to take, and a modal with a button nobody can act on teaches people to dismiss without reading. "My requests" shows `no_decision_path`: the dossier went to a Mobility Legal specialist and nothing in this system is waiting on anybody |
| **Zendesk ticket — after 2026-08-21** | Raised on the **portal path too**, unlinked: the ticket carries the dossier id, the dossier record does not carry the ticket id, so the store keeps one write method and zero mutations (`R-23`). Carries the specialist's outcome verbs (`R-24`). A Zendesk-**originated** request shows `NOT_ASSESSABLE` with the portal link, never a verdict (`R-11`/`R-13`) |
| **Zendesk ticket** | Tagged `queue_mobility_legal_t3`, assigned to **Mobility Legal (Tier-3)**, an internal note only — never a public reply. The `escalation_*` tag never appears alone on a UC-07 ticket because every decision is an escalation |
| **ZAF sidebar, UC-07 panel** | Read-only, no `renderActions`, `actionable: false` set **server-side**. The mandatory framing sentence renders **under the header, above every finding, exactly once** — it was row 34 of 40, labelled "Standing", at character 4,735 of a 5,293-character page, under the confident green facts it exists to qualify. `recordIsTheAnalysis: true` and `statesItsOwnFlags: true` are data the shell reads; the shell still owns what renders. Rows: employee, type, route **by name**, who read the request, verdict **in words**, one line per flag **with its message**, required actions, transition safety with each outstanding condition, the dates, PTO, seniority, uncertainty, every cost component **with its status**, every citation with what matched it, and the `basis` block |
| **Approval queue** (`/queue`) — after 2026-08-21 | Still `none_by_design`, unchanged and unweakened — **nothing may approve a UC-07 dossier**. What changes is that a **read** dossier is now distinguishable from an unread one, so the stuck list stops growing monotonically and starts meaning something again (`R-24`) |
| **Approval queue** (`/queue`) | UC-07 appears under `none_by_design` with `awaiting / reading`. A Zendesk-path dossier sitting in Mobility Legal's queue is **not** on the stuck list; a portal-path dossier with no ticket **is**, under `no_ticket` |
| **Audit / Live Feed** | One `escalate` row per request: `riskTier: "high"`, external ref, relocation type, both countries, parse source, **`countryExtractionReason`** (how the route was reached, not only what it was), the flag codes, uncertainty, cost-calculator ref, citation ids, `disclaimerApplied` |
| **Backend/API** | `GET /uc07/api/dossiers`, `/dossiers/:id`, `/dossiers/by-ticket/:externalRef`, `/healthz`, `OPTIONS`. **No write verb of any kind exists in the file.** Reads are gated by the same signed identity a write would be — the route returns an employment id and a full decision record over sequential ticket ids |
| **Database** | `uc07_dossiers` (one row, never updated) · `audit_log` · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | **Today: nothing. Not one call, on any path, ever** — which was read as the guarantee and is really the guarantee *and* DRIFT-032 welded together. **Decided 2026-08-21:** a read-only façade of exactly six methods, so the reader sees availability, entity status and the employment facts **as Remote reports them** rather than as the requester ticked them — plus the conflict check. Every requester-supplied input that survives is labelled **self-declared, unverified** on every surface. Each response says which leg answered, `sandbox_live` or `sandbox_replay` (`R-1`…`R-7`, `R-27`) |

## 14. UX_ACCEPTANCE

- **Hierarchy.** The framing sentence, then who and where, then the verdict and
  what it does not mean, then what blocks and what merely needs settling, then
  what could not be established, then the sources.
- **Statements of absence are mandatory and are exempt from any "would this
  reader act differently?" trim.** On a 🔴 dossier a specialist acting on false
  completeness is the failure the whole system exists to prevent. This use case
  has four that must be on the page: no nationality is held; PE risk is the
  least-sourced finding it produces; the Netherlands has no immigration
  instrument in the corpus; and `coverage`/`alignment` cannot show the dates they
  were computed between.
- **A capped uncertainty score is a floor, not a ceiling.** Two plans reading
  `1.0` can be far apart, and the breakdown must say so.
- **No internal language.** `BLOCK`/`REVIEW`/`PROCEED` are mapped, not
  lowercased — `PROCEED` is the dangerous one and merely tidying it leaves the
  misreading exactly where it was. Flag **messages** lead; codes survive only as
  a fallback. Countries by name, never `US → PT`.
- **Action clarity.** There is no action, and the panel says so rather than
  leaving the absence to be inferred from a missing button.
- **⚠️ Consistency defect.** The specialist's first question — *who is this
  about?* — is answered with a UUID (**DRIFT-042**).
- **Practicality.** One read, not five browser tabs. The panel omitted the flags,
  the sequencing dates, transition safety, PTO, seniority, uncertainty and the
  entire cost estimate until 2026-08-19, which is the same outcome as not
  compiling the dossier at all.

**Added 2026-08-21 by the ninth decision pass:**

- **A self-declared fact is marked wherever it appears — including on the drafted
  paperwork.** A specialist who retypes a declaration into Remote as though it
  were verified has been misled by our page, not by the requester. This is the
  exemption class in `docs/UI-AUDIENCES.md` §5 — *a statement of a limit or an
  absence is never trimmed for relevance* — applied to a new surface.
- **The replay banner names the date and sits above the findings, not beneath
  them.** The disclaimer defect of 2026-08-20 is the precedent and it must not be
  repeated: the framing sentence *was* on the page, at character 4,735 of 5,293
  and 3,876px down, under the confident green facts it existed to qualify.
  **Present and unreadable is a different failure from absent, and it is not a
  better one.**
- **The outcome control is not an approve button and must not read like one.**
  Its verbs are `dossier_read` / `proceeding_offline` / `not_proceeding` /
  `more_information_needed`. The words "approve", "authorise" and "sign" appear
  nowhere near it. A control that executes nothing but is *labelled* like one that
  does is worse than no control, because it teaches the specialist that this
  screen can act.
- **The requester's wording never borrows approval vocabulary**, for the same
  reason one layer out: a requester who reads "approved" will act on it, and
  nothing was approved.

## 15. Successful business outcome

> **A senior Mobility Legal specialist opens one page and knows, without opening
> anything else, whether this person's permanent move can be attempted, what
> would have to be settled first, what nobody has yet established, and which
> published instrument each of those rests on — including the ones where the
> honest answer is that no instrument was found.**
>
> They then execute the move themselves, in the right order, in Remote's own
> product. Nobody is ever left without an employer between two contracts because
> a system terminated a source employment on the strength of a destination record
> merely existing.
>
> And: nothing was ever executed, nothing was approved, no figure was presented
> as derived that was estimated, and no employee's move was cleared on facts the
> system could not read.

**Amended 2026-08-21 — two halves of that outcome were being claimed and are not
delivered:**

> **The specialist also gets the paperwork already filled in, and the person who
> asked eventually learns what happened.**

**On the paperwork.** §0 and §11 both rest the business case on *specialist
research time saved per case, not ticket-volume deflection* — and drafting the
two payloads is the half of that time the dossier does not touch. A specialist
still hand-assembles both. So the ROI claim as written is roughly **halved**, and
was never marked as such: §15's own status table has no row for the generator at
all — it is neither listed as built nor listed as missing (DRIFT-035, `R-14`).

**On the requester.** The last clause of the outcome above — *nobody is ever left
without an employer between two contracts* — is a promise about the **employee**.
Today that same employee submits a request, receives one acknowledgement, and is
never told anything again by any mechanism the system possesses. The outcome
statement is true about the relocation and silent about the person, and this
contract was silent in the same way until asked (DRIFT-073, `R-24`, Q2).

## 16. Required evidence for E2E verification

1. **The positive test leads.** A complete, favourable plan MUST reach
   `verdict: PROCEED` with **zero flags** — and the dossier must still decide
   `escalate`. UC-07's decision is constant, so no assertion about the decision
   can ever fail; **only an assertion that the dossier SUCCEEDS at being complete
   can detect a use case that is structurally incapable of it.**
2. **A positive test through the Zendesk intake shape.** Drive
   `normalizeRelocationRequest.js` with a real ticket payload and assert that the
   resulting dossier can be something other than `BLOCK`. No such test exists
   today, and its absence is DRIFT-034's mechanism.
3. **Remote state: proof of absence.** Assert that a full run makes **zero**
   outbound calls to Remote and Zendesk from the Node path — by injecting clients
   that throw on any method, not by reading the parameter list.
4. **The conflict check, in both directions, as a positive test.** An employment
   with an in-flight contract amendment MUST produce a flagged dossier; one with
   an in-flight offboarding MUST produce a flagged dossier; and a clean employment
   MUST produce one without those flags. The third assertion is the one that
   matters — without it, "no conflict found" and "no conflict looked for" are the
   same output. Neither half can be tested today: `RemoteClient` has no read for
   either, and `src/remote/mockServer.js` has no offboarding fixture at all.
5. **The store's method surface as an allow-list**, not a blocklist. Already
   done; keep it that way, and extend the same treatment to the source scan
   (§8, invariant 1, row 4) which is still a blocklist of ten names over one file.
6. **Every write verb 404s on every route**, behaviourally, including
   `/api/dossiers/:id/approve`.
7. **The whole dossier deep-compared** between `src/uc07/` and
   `workflows/nodes-uc07/relocationGates.js` — verified load-bearing by a
   reverting mutation, which is how the current parity test was proven to bite
   (flattening `dateChecks` turns 10 of 16 scenarios red).
8. **The honesty markers, positively.** Every unquoted component is
   `QUOTE_REQUIRED`; an `INCOMPLETE` estimate carries `null` totals and no
   currency-suffixed placeholder; the term total covers the term and counts
   one-offs once.
9. **The money period.** €72,000/yr, 15 liquidated days → **4,090.91**, not
   49,090.91. Pinned by exact figure, because the previous test pinned the wrong
   number as correct — the fixture agreeing with the code rather than with the API.
10. **Every quotation matched against the sidecar it is attributed to** — the
   failure a path check cannot see is a live link to the right document, cited for
   something it does not say. And: no numeric value in anything a lookup returns.
11. **Every flag `transitionGate.js` can raise is either cited or explicitly
    recorded as uncitable**, so a flag added later cannot reach a specialist with
    a silent blank where a source belongs.
12. **The framing statement**, verbatim, once, above every finding, at both
    1180×900 and 340×740.
13. **Idempotency** — two deliveries under one `externalRef`, one claim row, one
    dossier row, one audit row.
14. **The read-time derivation against a row of the shape that is actually in the
    table** (see DRIFT-072), not only against one the current builder produces.
15. **The hand-off** — for a portal submission, assert what a Mobility Legal
    specialist could do to discover it exists. Today the honest answer is
    `GET /uc07/api/dossiers` and nothing else.

**Added 2026-08-21 by the ninth decision pass. Item 16 is the one that decides
whether any of the rest mean anything.**

16. **The conflict check in BOTH directions**, and the positive one leads. An
    employment **with** an in-flight amendment or offboarding must produce a named
    conflict; one without must produce a stated absence. **A negative-only suite
    passes whether the gate lands correctly, lands inverted, or does not land at
    all** — this repository has now paid for that three times (UC-03's alpha-3
    comparison, UC-03's unnameable sanctions codes, UC-06's `automatable`
    pre-check), and the rule out of `[A-10]` applies unchanged: *a gate that
    cannot fire and a gate being careful are indistinguishable from outside.*
17. **Identity refused in both directions** — an employee filing about somebody
    else, an admin filing across companies, and the positive case for each. Plus
    the `null` case explicitly: an unreadable record must **not** satisfy the
    comparison. Assert it against a record that genuinely cannot be read, not
    against a mocked `null`, because `null === null` passing is the exact defect
    UC-06 and UC-09 shipped.
18. **A live call visible in `audit_trace` with `source: "sandbox_live"`** — the
    claim "this system calls Remote's API" must be demonstrable from the trail,
    not from the source. A reviewer is entitled to ask *show me the call*.
19. **The same request served from a capture**, producing `sandbox_replay` in the
    trace, the `X-Sandbox-Replay` header, the `_replay` block, **and the date
    visible on the rendered page**. Assert the page, not only the payload: an
    unmarked replay is the failure, and the payload is not what the reviewer
    reads.
20. **A dossier leaving the waiting list.** Record an outcome, then assert the
    approval queue no longer reports it as `awaiting / reading` — and assert in
    the same test that `uc07_dossiers` was **not** mutated, so the two halves of
    the guarantee are pinned against each other rather than separately.
21. **The drafted documents rendered**, both of them, with every self-declared
    field marked — plus the structural assertion that neither is, or contains, a
    serialised API payload.
22. **A duplicate delivery distinguishable by the caller** without inspecting a
    `duplicate` boolean, and asserted to have written no audit row and no dossier
    (DRIFT-102).

## 17. Known SPEC_DRIFT

> **Numbering note.** UC-07's allocated range is DRIFT-032 … DRIFT-035 and is
> exhausted. Per §3 of the reconciliation brief, the remaining four findings take
> the next free numbers above 060: **DRIFT-070 … DRIFT-073**.
>
> **Renumbered by the lead pass after the fact.** This contract was written
> claiming 063–066. Three agents overflowed their ranges in parallel and none
> could see the others' files: UC-06 took 061–062, UC-05 took 064–066, UC-08
> took 067–069. This contract moved to 070–073, the first block free of all of
> it. **063 is left permanently unused** rather than backfilled, so a later
> reader does not mistake a gap for a deleted finding. Recorded rather than
> applied silently — a numbering scheme that quietly reassigns is the hazard
> DRIFT-044 describes one level up.

---

### SPEC_DRIFT · DRIFT-032 · UC-07 makes no Remote API call at all, so every gate input is a claim — and neither half of the specified conflict check exists

**Original/documented behaviour:** §3 lists six read sources, five of them tagged
`[CONFIRMED — live]`: `GET /v1/employments/{id}`, `GET /v1/contract-amendments`
for the same employment, `GET /offboardings` for the same employment,
`GET /v1/companies/{id}/legal-entities`, `GET /v1/countries`, and
`POST /v1/cost-calculator/estimation`. §5's pipeline reads *"REST: current
employment facts, cross-checked against in-flight contract-amendments AND
offboardings for the same employment (catches an already-in-flight conflicting
action)"*. §7 makes it the first deterministic item. §9 names *"Already-in-flight
conflicting action missed"* as one of four failure modes and its guard as *"Conflict
check against contract-amendments AND offboardings before dossier compiles"*.
§12 test-plan items 3 and 4 are that check in both directions. §13 build task 3
is to build it. §7 also specifies *"the same 4-dimension coverage/risk gate as
UC-04 (entity coverage, treaty/totalization, role/PE-sensitivity, immigration
document) — never collapsed into one score"*, reusing UC-04's maintained tables.

**Current implementation:** zero Remote calls. `handleRelocationReview()` takes
no `remote` parameter (`src/uc07/workflow.js:79`), `transitionGate.js` is pure by
its own header, and no file in `src/uc07/` imports `RemoteClient`. The cost
calculator is a local simulation and says so.

**The conflict check does not exist, and its two halves are absent in different
ways — checked separately, because they differ and the difference decides what it
costs to build them.**

| Half | Endpoint, as Remote publishes it | In `RemoteClient` | Anywhere in `src/`, `workflows/`, `scripts/` | Mock fixture |
|---|---|---|---|---|
| **In-flight contract amendments** | `GET /v1/contract-amendments` — *"List Contract Amendment requests"*, scope `contract_amendment:read`. §3's path is **correct** | ❌ **No list and no show.** The client has three contract-amendment methods and all three serve UC-06's *write*: `getContractAmendmentSchema()`, `checkContractAmendmentAutomatable()` (`restClient.js:866`), `createContractAmendment()` (`:914`). Neither `GET /v1/contract-amendments` nor `GET /v1/contract-amendments/{id}` is called | ❌ | ⚠️ partial — the amendment family is mocked for UC-06's write path only |
| **In-flight offboardings** | `GET /v1/offboardings`, `GET /v2/offboardings`, and — the one this use case actually wants — **`GET /v1/offboardings/employments/{employment_id}`**, *"Lists Offboarding requests for a specific employment"*, scope `offboarding:read`. §3's path, `GET /offboardings`, is **not a published path**: it carries no version prefix and no per-employment form | ❌ | ❌ **the string `offboarding` does not appear at all** | ❌ **none.** Not in `src/remote/mockServer.js`, not in a fixture. A local test could not be written without building the mock first |

§12 test-plan items 3 and 4 have no test, and neither does the `src/uc06/` side —
this finding was independently reached by the UC-06 reconciliation pass from the
opposite direction (no `listContractAmendments()` on the client) and is recorded
here with both halves separated.

**One [CONFIRMED] claim in §3 that DOES survive re-checking, recorded because its
neighbours did not.** §3's last row — *"No atomic 'country transfer' API exists …
`[CONFIRMED — live, both raw docs' hedges on this were correct]`"* — holds:
`docs/REMOTE-API-INDEX.txt` (Remote's own `llms.txt`, 468 lines) contains no
match for `relocat`, `country transfer`, `country-transfer`, `entity transfer` or
`internal transfer`. `docs/00-FOUNDATION.md:378` groups that claim with two others
in one sentence, and **at least one of the other two is wrong** — the same line
says UC-06's `/contract-amendments/automatable` pre-check "does not exist as
claimed", while the index publishes it at line 203 and `restClient.js:866` calls
it. UC-07's half of that sentence is sound; it should not be inherited on the
strength of the sentence, which is how it was checked here.

The four dimensions are not UC-04's and nothing imports `src/uc04/`:
- *Entity coverage* → `destinationSupported` and `destinationEntityActive`, two
  **booleans supplied by the caller**. On the portal they are checkboxes on the
  requester's own form (`src/portal/server.js:3596`).
- *Treaty/totalization* → `taxTreatyNexusConfirmed`, a supplied boolean defaulting
  to `false`.
- *Role/PE-sensitivity* → `employerPresenceInDestination`, a supplied tri-state.
  There is no role, no duties field, and no category table.
- *Immigration document* → `rightToWorkConfirmed` / `immigrationConfirmed`,
  supplied booleans. This is the **same substitution DRIFT-017 records for
  UC-04**: a document-presence check replaced by a declaration.

Note also a vocabulary collision: UC-07's `coverage` key means the **employment
gap/overlap** check, not the treaty coverage §7's "entity coverage" names.

**Current tests assume:** structured plan input. `test/uc07.test.js` and
`test/n8nUc07Parity.test.js` construct plans by hand; no test asserts a Remote
read, and no test asserts its absence except by reading the parameter list.

**Difference:** the deterministic core the 🔴 tier's value rests on is a function
of facts the requester supplies about their own case. `docs/use-cases/UC-07.md`
§15 states this in one row — *"Real Remote reads (legal entities, countries,
salary-vs-visa-minimum) — **Not built**"* — but §3, §5, §7, §9, §12 and §13 all
describe the built system as if they were, and three of those rows carry
`[CONFIRMED — live]`, which is a claim about the endpoint, not about this code
calling it.

**Evidence:** `src/uc07/workflow.js:79` (signature), `:99–:165` (the whole
pipeline, no read); `src/uc07/transitionGate.js:433–472` (the parameter list that
*is* the fact set); `src/portal/server.js:235–242` (`UC07_PLAN_DEFAULTS`),
`:3595–3607` (booleans read from the form body); `docs/use-cases/UC-07.md`
§3/§5/§7/§9/§12/§13 and §15's "Not built" row.

**Likely reason:** partially establishable. The structural guarantee was
implemented by removing the write-capable client entirely — which is the
strongest available form of it, and **removed the reads with it**. `workflow.js`'s
own header argues the removal for writes and never addresses reads. Whether the
conflict check was consciously deferred cannot be established from the
repository: no commit, ADR or BUILD-LOG entry found in this pass mentions it.

**Risk if left as-is:** two distinct risks. (1) A specialist reads
"Destination supported: yes, entity active" and reasonably believes Remote was
asked; nobody asked. (2) The conflict check is the guard for a failure mode the
spec itself names, and **its absence is invisible by construction**: a dossier
compiled for an employee who has a salary amendment mid-flight, or an offboarding
already submitted, says nothing about it — and a dossier that omits a conflict is
byte-identical to a dossier where there was no conflict. Nothing in either use
case's tests can distinguish them. That is the shape of UC-08's "273 presence days
with `jurisdictions: []`" defect: an answer to a different question, printed in
the same shape, with the reader supplying the missing half from memory. It is also
precisely the scenario the transition-safety rule exists to prevent, arriving by a
route the transition-safety rule cannot see — `sourceExitPlanValidated` is a
checkbox, and an offboarding somebody else already submitted does not tick it.

**Recommendation:** HUMAN_DECISION_REQUIRED, and it needs one decision, not four.
The question is whether a 🔴 dossier may hold a **read-only** Remote client. It
can be done safely — a client built from a token with the four read scopes only
(`employments`, `contract_amendment:read`, `offboarding:read`, countries), or a
read-only façade exposing only the six methods — but it re-opens the parameter
this use case's guarantee is argued from, so it is a deliberate architectural
choice with a test to write, not a wiring task.

Until it is taken, three things are owed regardless: (a) every requester-supplied
gate input labelled **self-declared, unverified** on every surface; (b) §3's six
rows re-tagged to say the endpoint exists and *this code does not call it* —
`[CONFIRMED]` is a claim about Remote, not about us; (c) §3's offboarding path
corrected to `GET /v1/offboardings/employments/{employment_id}`, which is both the
real path and a better one than specified. If the client decision goes the other
way and no Remote read is ever added, then §3, §5, §7, §9, §12.3 and §12.4 and
§13.3 must all be rewritten to drop the conflict check, and **§9's fourth failure
mode must be restated as unguarded** rather than left with a guard that does not
exist.

**Confidence:** HIGH on the finding; MEDIUM on the reason.

### DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT`

**Decision: yes to the Remote client, and yes to a captured fallback beside it.**
The owner: *"One of the important things for the job is the ability to use APIs.
So if there is a way to leverage Remote Sandbox and get the details or info we
need, then please let's do that. Also for fallback so that the demo won't fail
live, extract all the info we need from Remote Sandbox, so that when we make API
calls and they say our sandbox time has expired we are not stuck. Then make sure
this is well documented, so that anybody reading our documentation will be able
to see it."*

**The client is a façade, and that is the decision — not "the full client, used
carefully."** UC-07's guarantee is currently argued from a **parameter that does
not exist**. Passing a `RemoteClient` re-opens the parameter the guarantee is
argued from, and **nothing fails when it does**: the structural test greps for
write-method *names*, and a client that merely *could* write names nothing. So:
`ReadOnlyRemoteClient`, exactly six methods, a write unnameable on the surface —
the same reasoning that gave `dossierStore` one write method and zero mutation
methods rather than a store that declines to mutate (`R-1`). The structural test
extends **before** the façade ships: the method list is pinned exactly, and
`src/uc07/` is asserted never to import `RemoteClient` directly (`R-2`).

**Ordering, non-negotiable:** `R-1` lands before `R-6`. Building the conflict gate
against the full client "for now" is how the guarantee dies quietly — the
`[A-1]`-before-`[A-2]` constraint from UC-06, one use case over.

**The two endpoints, at the paths Remote publishes** (re-probed 2026-08-21):
`GET /v1/offboardings/employments/{employment_id}` (`offboarding:read`) — **which
is better than §3's `GET /offboardings`**, a string that is not a published path
at all — and `GET /v1/contract-amendments` (`contract_amendment:read`). Neither
appears anywhere in `src/`; the string `offboarding` does not appear in `src/` at
all, so **the mock has to be built before a local test can be written** (`R-3`,
`R-4`, `R-5`).

**The fallback is a rung 2 → rung 3 move**, so the ladder's constraints apply
verbatim: self-identifying (`X-Sandbox-Replay`, a `_replay` block, the date on the
page), a live value always wins, GET-only on both legs, provenance headers
carrying the SHA-256 of the retrieved bytes, and
`source: "sandbox_live" | "sandbox_replay"` on the trace row (`R-27`). The
existing `scripts/capture-sandbox.mjs` is already GET-only by construction and
already captures `/v1/contract-amendments` — **it writes to `.sandbox-cap/`,
which is gitignored** (`.gitignore:44`), which is DRIFT-104.

**Owed regardless, and all three were owed by the finding itself:** every
requester-supplied gate input labelled **self-declared, unverified** on every
surface; §3's six rows re-tagged to say the endpoint exists and *this code does
not call it* (`[CONFIRMED]` is a claim about Remote, never about us); and §3's
offboarding path corrected.

**Not decided here:** whether the four coverage/risk dimensions become a shared
module with UC-04. That is §12's connection (a) — decided in principle, unscoped,
and it is a refactor of two use cases rather than a wiring task.

---

### SPEC_DRIFT · DRIFT-033 · Identity is never verified, on either path, and a retired employment id is accepted as the actor

**Original/documented behaviour:** §5's pipeline is
`Ticket → n8n → **identity verify** → REST: current employment facts…`.
`00-FOUNDATION.md` §4 and CLAUDE.md prime directive #3: *"Identity comes from an
authenticated signal, never a claim. Fails closed: any missing piece means
unverified."*

**Current implementation:** there is no identity gate anywhere in UC-07. No flag
code exists for it, no gate function, no refusal. `workflow.js` records
`actor: employmentId ?? "unauthenticated"` (`:245`) and proceeds identically
either way. The n8n normalizer does one honest thing — it throws rather than
guess when a ticket carries no employment-id custom field, and it reads the
requester's email from the field Zendesk itself authenticated — but **nothing
downstream ever compares that email to anything**, because there is no Remote
record to compare it against (DRIFT-032). `requesterEmail` is normalised and then
never read again. The portal takes `body.employmentId || subjectEmploymentId(body.persona)`
and its own comment states plainly that no kind check and no refusal is applied:
*"anyone may ask a relocation question, with or without a persona."*

**Current tests assume:** no identity gate. `test/uc07.test.js` 6c drives the
workflow with `{text}` and nothing else and asserts success.

**Difference:** four of the nine use cases had identity gates that could verify a
claim against itself, and all four were fixed at the construction site in
`c295ef1`'s pass. UC-07 was not among them because it has no gate to fix. A
dossier about the wrong person, compiled from a plan the requester typed, is
indistinguishable from a correct one.

**Evidence:** `src/uc07/workflow.js:79–99, :242–245`;
`workflows/nodes-uc07/normalizeRelocationRequest.js:41–56` (`requesterEmail`
computed, never consumed); `src/portal/server.js:3035–3050`; live `audit_log`,
2026-08-20 — five distinct actors across 21 `UC-07` rows, of which
**`fde4007b-6257-4504-9467-8d61b5785488` appears twice**. That id is the retired
Sandbox employment recorded in CLAUDE.md §6 as dead: *"a dead id produces a 404
that looks like a credential, host, or permission problem."* Here it produces
nothing at all, because nothing looks it up.

**Risk if left as-is:** the audit log's attribution is decorative. `actor` names
whoever the request said it was about, and the one 🔴 tier whose product is a
research dossier about a named person cannot say whose person it is. It is also
the reason the API's read gate exists — the route returns an employment id and a
full decision record — so the system authenticates the *reader* and not the
*subject*.

**Likely reason:** a consequence of DRIFT-032, not an independent decision.
Identity verification in this repository is *always* implemented as "compare an
authenticated signal to the authoritative Remote record", and there is no Remote
record here. No document states the trade.

**Recommendation:** HUMAN_DECISION_REQUIRED, and it should be decided **with**
DRIFT-032 rather than separately, because a read-only Remote client resolves both
and nothing else does. If the answer is no client, then the honest interim is a
named non-verification state on the dossier and in the audit row — `identity:
"not_verified_no_authoritative_record"` — rather than a silent `actor` that reads
like an attribution.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT`

**Decision: verify identity. The owner: *"I think it is best if identity is
verified."*** Agreed without qualification — it is prime directive #3, and UC-07
is the only one of the nine with no gate at all.

**It became buildable only because DRIFT-032 was decided the same day**, which is
what that finding's own recommendation asked for: *"it should be decided WITH
DRIFT-032 rather than separately, because a read-only Remote client resolves both
and nothing else does."* Identity verification in this repository is always
"compare an authenticated signal to the authoritative Remote record", and until
`R-1` there is no record to compare against.

**Three paths, three comparisons** (`R-8`, `R-10`):

| Path | Authenticated signal | Compared to |
|---|---|---|
| Employee (portal) | session employment id | the Remote record — and the subject is **forced from the session**, never typed |
| Company admin (portal) | session `companyId` | the record's `company_id` |
| Zendesk | the requester's email, which Zendesk itself authenticated | the email on the Remote record |

**The Zendesk half needs no new plumbing.**
`workflows/nodes-uc07/normalizeRelocationRequest.js:41–56` already computes
`requesterEmail` from the field Zendesk authenticated, and **nothing downstream
has ever read it**. It becomes the comparison.

**Fail closed on `null`, and assert it against a record that genuinely cannot be
read.** `RemoteClient.getEmployment()` returns `null` on a 404, and
`null === null` passing is exactly the defect UC-06 and UC-09 shipped —
`session.companyId` compared to a defaulted `null` `company_id`. Both failed
closed only by *accident* of a later status gate. **An identity control whose
correctness depends on a downstream gate is not a control.**

**The honest state stays after the client lands** (`R-9`):
`identity: "not_verified_no_authoritative_record"`, named, on the dossier and in
the audit row — because a replay-only run and an unreadable record both still
occur, and a silent `actor` reads like an attribution. Live `audit_log` currently
shows five distinct actors across 21 UC-07 rows, of which the **retired**
employment `fde4007b-…` appears **twice**: it produces nothing at all here,
because nothing looks it up.

---

### SPEC_DRIFT · DRIFT-034 · Every Zendesk-originated dossier is BLOCK, from an empty plan — verified on all seven rows in production

**Original/documented behaviour:** §1 names the trigger as *"Admin/employee
requests permanent relocation A→B"*; §5's pipeline begins at a ticket. Zendesk is
the primary intake for this use case (`00-FOUNDATION.md` §2's two-door model puts
UC-07 in the Zendesk-native set). The dossier's verdict — `BLOCK` / `REVIEW` /
`PROCEED` — is the headline a specialist orients by.

**Current implementation:** `workflows/nodes-uc07/normalizeRelocationRequest.js`
sets `plan: {}` for **every** Zendesk-originated request, deliberately and with a
correct reason stated in its own header: an invented destination start date would
silently change a feasibility verdict. But `evaluateRelocationFeasibility()`'s
defaults then guarantee the outcome. With an empty plan:
`destinationSupported=false` → `DESTINATION_COUNTRY_UNSUPPORTED` (**HIGH**);
no timeline → `MISSING_TIMELINE`; `sourceExitPlanValidated=false` →
`SOURCE_OFFBOARDING_NOT_AUTHORIZED` (**HIGH**); `rightToWorkConfirmed=false` →
`RIGHT_TO_WORK_MISSING` (**HIGH**); `employerPresenceInDestination!==true` →
`PE_RISK_REVIEW_REQUIRED`; `taxTreatyNexusConfirmed=false` →
`TAX_RESIDENCY_REVIEW_REQUIRED`; `ptoTransferAllowed=false` →
`PTO_TRANSFER_NOT_ALLOWED` and `PTO_CASHOUT_NOT_COMPUTABLE`;
`seniorityPreservable=null` → `SENIORITY_REVIEW_REQUIRED`. Any HIGH flag makes the
verdict `BLOCK`, and the uncertainty score is pinned at its cap of `1`.

**Current tests assume:** a populated plan. `test/n8nUc07Parity.test.js` drives
the gates node directly with a synthetic `{text, plan}` and never routes through
the normalizer; `normalizeRelocationRequest.js` is covered by exactly one
assertion in the whole suite — *"both n8n Code node bodies are syntactically
valid"* (`test/n8nUc07Parity.test.js:701`). Its behaviour is untested.

**Difference:** on its primary intake the deterministic core cannot produce a
finding **about the relocation**. It produces the same nine findings about the
absence of a plan, every time, wearing the vocabulary of findings about the plan
— `RIGHT_TO_WORK_MISSING` reads as "we checked and there is none", and means
"nobody told us".

**Evidence:** live `uc07_dossiers`, project `your-project-ref`, read
2026-08-20 — **7 rows, 7 `BLOCK`, all `source: "webhook"`, uncertainty `1` on
every one**, flag sets identical apart from two early rows predating
`PTO_CASHOUT_NOT_COMPUTABLE` and `DESTINATION_COUNTRY_UNSUPPORTED` reaching the
deployed node. Routes vary (ES→NL, NG→PT) and the verdict does not.
`workflows/nodes-uc07/normalizeRelocationRequest.js:47–56`;
`src/uc07/transitionGate.js:433–472` (the defaults), `:480–530` (the pushes).

**Likely reason:** establishable and defensible in each half. Refusing to infer
plan facts from prose is right; defaulting an unstated fact to its unsafe value is
right for a gate. The two together were never evaluated as one path, because no
test drives them as one.

**Risk if left as-is:** a specialist who reads two UC-07 tickets learns the
verdict carries no information, and then does not read the third. That is the
`docs/WHY-THIS-SHAPE.md` §7 failure exactly — *a gate that cannot fire and a gate
being careful are indistinguishable from outside* — with the sign reversed: a
gate that can only ever block. It also means the one flag that would matter most
if it fired on real data, `SOURCE_OFFBOARDING_NOT_AUTHORIZED`, fires on all seven
rows for the trivial reason and would look identical on the real one.

**Recommendation:** RECONCILE. The plan facts must come from somewhere on the
Zendesk path, and there are exactly two candidates, both cheap: (a) the read-only
Remote client of DRIFT-032, which supplies availability, entity status and the
employment facts and leaves only the dates; or (b) a distinct dossier state —
`verdict: NOT_ASSESSABLE` with `planSource: "none"` — so that "we could not
assess this" is visibly a different answer from "this is blocked". (b) is a
half-day and closes the misreading; (a) closes the gap. Do not do neither.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `RECONCILE` · `DECIDED · NOT YET BUILT`

**Both remedies, in the order (b) then (a) — and the owner's framing makes (b)
the principled answer rather than the cheap one.**

The owner: *"I don't think it makes sense for Zendesk to originate this workflow.
How exactly are customers supposed to access Zendesk? That is why we use our own
UI. Isn't that all we are trying to resolve?"*

**This is right, and it is a bigger statement than the finding.** A customer does
not *access* Zendesk — Zendesk is the **agent's** console. A ticket exists because
somebody emailed. And an emailed relocation request in free prose is precisely
what produces `plan: {}` and the seven identical `BLOCK` verdicts now in
production.

**(b) first — the correctness fix.** A Zendesk-originated request stops producing
a verdict: `verdict: NOT_ASSESSABLE`, `planSource: "none"`, and the specialist's
first action is to send the requester the portal link (`R-11`, `R-13`). This
separates *"we could not assess this"* from *"this is blocked"*, which is the
whole defect: nine findings about the **absence of a plan**, wearing the
vocabulary of findings **about the plan**. `RIGHT_TO_WORK_MISSING` reads as "we
checked and there is none" and means "nobody told us".

**(a) second — the value.** With the façade, Remote's own facts fill themselves
and the state becomes `INCOMPLETE` with a **named list** of what is still
outstanding — only what a human alone knows (dates, PTO intent) stays open
(`R-12`). Nine identical flags become a short specific list, which is a far better
specialist artifact.

**Neither half is optional. The finding said "do not do neither"; this pass says
do both.**

**And the intake reframing is now evidenced, not merely reasoned.**
`docs/INTAKE-RESEARCH.md` §75 records that Remote's own product solves this the
same way: **Country Transfer Service → relocation form**, *"Structured form,
employer-driven"*. Our portal stands in for **that** — the `W-4` precedent from
UC-04 stated once more: **the stand-in stands in for Remote's product, never for
the partner API.** Without that row, decision 2 would have been the right call
for a weaker reason.

**Deliberately NOT generalised.** This touches `00-FOUNDATION.md` §2's two-door
model for **UC-07 only**. UC-08 is the same tier with the same absent surface and
the same argument would appear to apply — deciding it here would be deciding
UC-08's pass without running it, which is the exact error that put three
endpoints in one sentence and got two of them wrong. Recorded as **`G4`, open**,
in `qa/HUMAN-DECISIONS-REQUIRED.md`.

---

### SPEC_DRIFT · DRIFT-035 · The drafted, never-submitted paperwork — one of the two things this use case ships — does not exist

**Original/documented behaviour:** §1's automation boundary: *"AI compiles a
dossier **+ drafts (never submits) paperwork**"*. §5: *"drafted, never-submitted
paperwork: pre-filled termination request + new-employment payload (reason codes,
dates, fields formatted correctly) for the specialist to review and file
themselves"*. §6 lists drafting the pre-filled fields under what the LLM **does**,
and submitting them under what it must **not**. §10 requires
*"drafted-paperwork content"* in the audit record. §13 build task 7 is the
generator. §8's whole human-control argument is that *"a specialist executes every
step … using the drafted paperwork as a starting point."*

**Current implementation:** it does not exist.
`grep -rni "paperwork|prefill|pre-filled|terminationRequest|draftedPaperwork"
src/uc07/ workflows/nodes-uc07/ test/uc07*.test.js` returns **nothing**.
`buildDossier()`'s return object has no such key. The audit row's `details` has
no such field. No test asserts its presence or its absence.

**Current tests assume:** its absence, silently — the parity test `deepEqual`s
the whole dossier, so both copies agree on not having it.

**Difference:** the spec describes two deliverables and one exists. The
"drafted-paperwork content" line in §10 is auditing a field that has never been
written.

**The invariant is satisfied vacuously, and that is worth stating separately:**
"nothing may submit the drafted paperwork" is currently true because there is
nothing to submit, not because anything prevents submission. If the generator is
built, the guarantee needs re-deriving — a pre-filled `POST /v1/employments`
payload sitting on a dossier is one accidental wiring away from being the
execution path this tier forbids, and the current structural assertions (a
parameter list, a store's method surface, a route list) would not catch it. The
correct shape is almost certainly a rendered **document** for a human to read and
retype, not a serialised API payload.

**Evidence:** `docs/use-cases/UC-07.md` §1, §5, §6, §8, §10, §13.7;
`src/uc07/dossierBuilder.js:205–233` (the full return object);
`src/uc07/workflow.js:242–262` (the full audit `details`). §15's status table has
no row for it either — it is not listed as built, and it is not listed as
missing.

**Likely reason:** Cannot be established from the repository. No commit,
BUILD-LOG section or ticket found in this pass records a decision to drop it.

**Risk if left as-is:** the ROI claim is halved. §0 and §11 both put the business
case on *"specialist research time saved per case, not ticket-volume deflection"*,
and paperwork drafting is the half of that time the dossier does not touch. A
specialist still hand-assembles both payloads. Separately, §10's audit spec
describes a field that is never written, which is a status claim that reads as
true and is not.

**Recommendation:** HUMAN_DECISION_REQUIRED — build it or strike it. If built, it
must be a human-readable draft, and the no-execution assertions must be extended
to cover it before it ships. If struck, §1, §5, §6, §8, §10 and §13.7 all need
correcting, and §15's table needs the row it never had.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT` — BUILD IT

**The owner: *"Build it, we can't claim to have something and not ship."***
Agreed. §1, §5, §6, §8, §10 and §13.7 all describe two deliverables and one
exists; §15's status table has no row for it in **either** direction, which is
worse than a missing feature — it is a missing feature that no status document
admits to.

**Four constraints, and the second is the one a build will lose first** (`R-14`,
`R-15`, `R-16`):

1. **Two documents:** a pre-filled source-country offboarding/termination request
   and a destination new-employment request. Reuse `src/pdf/` (Playwright/
   Chromium, already built for UC-01's letter).
2. **Rendered documents, never serialised API payloads.** A pre-filled
   `POST /v1/employments` body sitting on a 🔴 dossier is one accidental wiring
   away from being the execution path this tier forbids — and **the current
   structural assertions would not catch it**, because they check a parameter
   list, a store's method surface and a route list, none of which sees a
   payload-shaped object on a dossier. The right artifact is something a human
   **reads and retypes**.
3. **The no-execution assertions extend BEFORE the generator ships.** Today the
   invariant is satisfied **vacuously**: nothing may submit the paperwork because
   there is nothing to submit, which is not the same as something preventing
   submission. That distinction is the whole finding.
4. **Every field sourced from a self-declared checkbox is marked as such on the
   document itself** — otherwise a specialist retypes a declaration into Remote as
   though it were verified, and our page misled them, not the requester.

**The LLM's line, restated because this is where it would be crossed:** it may
draft the covering **prose**; it may not populate a field, choose a reason code,
or emit anything shaped like a request body (§9).

**And §15's table gets the row it never had** — listed as **not built**, not
quietly added to the built column when the generator lands.

---

### SPEC_DRIFT · DRIFT-070 · The management fee is presented as CALCULATED on a rate this repository invented

**Original/documented behaviour:** `costCalculator.js`'s own header, quoting
Build Pack Part 32: *"Do not hard-code the exact transfer price. Remote Pricing /
Quote should be the source of truth."* It applies that rule to the transfer fee
and the mobility fee, which are reported `QUOTE_REQUIRED` when absent, and states
the reason for the management fee too: *"the management fee is derived from a
basis-point rate the CALLER supplies, because a rate this repo invented would be a
fabricated number."*

**Current implementation:** every caller supplies the same invented rate.
`src/portal/server.js:238` — `managementFeeBasisPoints: 1200, // 12% of the
ANNUAL gross salary — the fee shape, not a quote`. `src/uc07/workflow.js:159` —
`managementFeeBasisPoints: plan.managementFeeBasisPoints ?? 1200`. The resulting
component is emitted with `status: "CALCULATED"`, sits in `knownComponents`, and
is multiplied across the term into `knownTermTotalRemoteInteger` — which is the
headline figure a specialist weighs when deciding whether a relocation is
affordable.

**Current tests assume:** 12%. `test/uc07.test.js`'s F-37 tests pin exact term
totals derived from it.

**Difference:** the module's discipline is that a figure with no quote behind it
is `QUOTE_REQUIRED`. Three cost components are subject to that rule and two obey
it. The third — the only recurring one, and therefore the one that dominates the
term total — obeys the letter (the caller supplied a rate) and not the substance
(the caller is a default constant in this repository). The comment beside the
constant is candid — *"the fee shape, not a quote"* — and that candour reaches no
screen: the panel prints the component with its status, and the status is
`CALCULATED`.

**Evidence:** `src/portal/server.js:238`; `src/uc07/workflow.js:159`;
`src/uc07/costCalculator.js:120–135` (component construction, `status:
"CALCULATED"`), `:165–176` (`knownTermTotal`).

Two adjacent instances of the same shape, worth fixing together: the `INCOMPLETE`
branch re-applies `currency: currency ?? "USD"` to the estimate and to all three
components (`costCalculator.js:212–222`), reinstating exactly the default
`workflow.js:151–157` deliberately refuses one module earlier — *"a blank currency
box used to become USD here … as though it had been derived."* And
`UC07_PLAN_DEFAULTS` supplies `minimumOnboardingLeadTimeBusinessDays: 20` for
every country, so the MOT gate compares against a repo-wide constant rather than
the destination's own lead time.

**Likely reason:** establishable. The parameterisation was the fix for the
fabricated-rate problem, and the default was added so the portal form would work
without asking a requester for a basis-point rate. The default then became the
value in every run.

**Risk if left as-is:** a Mobility Legal specialist is handed a twelve-month
employer cost, labelled calculated, resting on a rate nobody quoted — beside two
components correctly marked as needing a quote, which is what makes the third
read as settled. This is the same class as the 12× period error the module has
already paid for: a number that is right in form and wrong in provenance, on a
screen where numbers get acted on.

**Recommendation:** RECONCILE. Emit the management fee as
`status: "ESTIMATED_RATE"` — a third status beside `CALCULATED` and
`QUOTE_REQUIRED` — carrying the basis points and the sentence that the rate is an
illustrative default, and exclude it from `knownTermTotal` or state the total as
rate-dependent. Same treatment for the 20-business-day MOT default. The
`?? "USD"` on the `INCOMPLETE` branch should simply be removed.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `RECONCILE` · `DECIDED · NOT YET BUILT`

**The owner: *"Let's stick with Remote's documentation."* That resolves it more
strictly than the finding's own recommendation, and the stricter answer is the
right one.**

The finding proposed a third status, `ESTIMATED_RATE`. Remote's own guidance —
quoted in `costCalculator.js`'s own header from Build Pack Part 32 — is *"Do not
hard-code the exact transfer price. Remote Pricing / Quote should be the source
of truth."* Under that, no third status is needed:

**The 12% default is deleted.** The management fee becomes `QUOTE_REQUIRED` like
its two siblings unless a caller supplies a genuinely quoted rate (`R-17`). The
module already had the right vocabulary; the default was the only thing breaking
it. `knownTermTotal` then correctly excludes it, and the specialist reads *three
components, three need a quote* — which is the true state.

**This is invariant 16 — money is never fabricated — applied to the one component
that was evading it on a technicality.** The rule was obeyed in letter (the caller
supplied a rate) and broken in substance (the caller is a default constant in this
repository, `portal/server.js:238` and `workflow.js:159`, and every caller
supplies the same one). The comment beside the constant is candid — *"the fee
shape, not a quote"* — **and that candour reaches no screen**: the panel prints
the component with its status, and the status is `CALCULATED`.

**Known cost, stated rather than discovered later:** `test/uc07.test.js`'s F-37
tests pin exact term totals derived from 12% and change with it. The portal's rate
box ships **blank** — a blank box is the honest state, and pre-filling it is how
the default became the value in every run in the first place.

**Two riders from the same finding, both decided:**
- `?? "USD"` is **removed** from the `INCOMPLETE` branch (`R-18`). It reinstates,
  on precisely the branch where nothing is known, the default `workflow.js:151–157`
  deliberately refuses one module earlier.
- `minimumOnboardingLeadTimeBusinessDays: 20` is a **repo-wide constant standing
  in for a per-country lead time** (`R-19`). Under the ladder that is rung 4
  material and must be **marked as a stand-in**, or promoted to rung 2 if the
  Sandbox can answer it. It is not kept silently.

---

### SPEC_DRIFT · DRIFT-071 · "Embedding-similarity retrieval" runs on its keyword leg in every environment, and its table would take zero rows even from a full seed

**Original/documented behaviour:** `CLAUDE.md` §4 describes UC-08's sibling
retriever as *"embedding-similarity treaty retriever"* and UC-07's status table
(§15) as *"Embedding-similarity retrieval over a `uc07_mobility_citation_vectors`
pgvector table is built and tested but requires a human-provisioned table +
`embed` function."* `README.md` and `docs/BUILD-LOG.md` carry the same
description.

**Current implementation:** the keyword leg, always, everywhere.
`MobilityRetriever` degrades to `retrieveByKeywords` when `this.embed` is unset
(`src/uc07/mobilityRetriever.js:159`), and **no caller anywhere constructs one
with an `embed` function or a `pgPool`** — `workflow.js`'s `mobilityRetriever`
dependency defaults to `null` and `src/portal/`, `src/uc07/cli.js` and the n8n
node all take the module-level `retrieveMobilityGuidance()`. The n8n Code node
cannot have either, by construction.

**Current tests assume:** both legs. The embedding path is tested with injected
fakes and passes; it is unreachable in production.

**Difference:** three status documents describe a mechanism that has never run.
The table is not merely unseeded: `uc07_mobility_citation_vectors` is
`count(*) = 0` (queried live 2026-08-20) and `docs/RETRIEVAL.md` establishes that
it **would receive zero rows even from a full seed** — *"Every document that feeds
UC-07 (D-17, D-20) also feeds UC-08, and a treaty document belongs in the treaty
table. The mobility table is not under-seeded; it has no documents of its own in
the corpus at all."*

**Evidence:** `src/uc07/mobilityRetriever.js:147–178`; `src/uc07/workflow.js:85,
:166–168`; `docs/RETRIEVAL.md` §1.1 and its closing note; live count, 2026-08-20.

**Likely reason:** establishable, and it is a defensible sequence rather than a
mistake. The embedding path was built to a real design; `docs/RETRIEVAL.md`
(`2aef4da`) then measured the corpus at **106 passages** and recommended *not*
seeding — arguing that at that size the properties that matter are not the ones
embeddings supply, and keeping `scripts/seed-citation-vectors.mjs` unrun and in
the repository as the evidence for a pipeline that was built, measured and
deliberately not run. That is good judgement. What was not done is telling the
status documents.

**Risk if left as-is:** a reviewer who checks one claim and finds it true of the
code and false of the running system discounts the rest, which is the exact
failure `CLAUDE.md` §3 directive 7 exists to prevent. Operationally the risk is
small — UC-07's citations are background for a human and are consumed by no gate,
and `src/uc07/decisionSources.js` (which is a **lookup, not a retriever**, and is
the thing that actually cites statute now) is unaffected.

**Recommendation:** KEEP_CURRENT on the mechanism; RECONCILE the description.
Every row describing UC-07 retrieval as embedding similarity should read
*"keyword matching over a six-entry curated corpus; an embedding path exists,
is tested, and is deliberately not run — see `docs/RETRIEVAL.md`."* And
`uc07_mobility_citation_vectors` should be dropped or documented as permanently
empty by design, since a table that can never hold a row invites someone to try
to fill it.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `KEEP_CURRENT` on the mechanism · `RECONCILE` the description

**Recommendation accepted as written.** Keyword matching stays; every status line
calling it embedding similarity is corrected; and the table is **dropped** rather
than documented as empty (`R-20`).

**Why keeping the mechanism is the right call and not a deferral.**
`docs/RETRIEVAL.md` (`2aef4da`) measured the corpus at **106 passages** and
recommended against seeding — arguing that at that size the properties that matter
are not the ones embeddings supply. That is good judgement and it stands. What was
never done is **telling the status documents**, and a reviewer who checks one
claim, finds it true of the code and false of the running system, discounts
everything else — which is precisely what `CLAUDE.md` §3 directive 7 exists to
prevent.

**Why drop the table rather than annotate it.** `uc07_mobility_citation_vectors`
is not merely unseeded: `docs/RETRIEVAL.md` establishes it **would receive zero
rows even from a full seed** — *"Every document that feeds UC-07 (D-17, D-20) also
feeds UC-08, and a treaty document belongs in the treaty table. The mobility table
is not under-seeded; it has no documents of its own in the corpus at all."* **A
table that can never hold a row invites someone to try to fill it.**

**Nothing is lost by dropping it.** `scripts/seed-citation-vectors.mjs` and
`docs/RETRIEVAL.md` remain in the repository as the durable evidence that the
pipeline was built, measured, and deliberately not run — which is the story worth
telling, and an empty table is not part of it.

**Operational risk of the whole finding is low and should be said plainly:**
UC-07's citations are background for a human and feed **no gate**, and
`src/uc07/decisionSources.js` — which is a **lookup, not a retriever**, and is the
thing that actually cites statute now — is unaffected.

---

### SPEC_DRIFT · DRIFT-072 · The read-time derivation returns nothing for every dossier that exists

**Original/documented behaviour:** `src/uc07/dossierView.js`'s header gives three
reasons for deriving the specialist's view at read time rather than adding keys to
the dossier, and the second is decisive: *"it applies identically to rows written
by the n8n path, **and to every dossier already in `uc07_dossiers`**."* §16 of
`UC-07.md` repeats it.

**Current implementation:** `collectOpenQuestions()` reads
`dossier.dateChecks` and `dossier.transitionSafety`
(`src/uc07/dossierView.js:357–358`). **No row in `uc07_dossiers` has either key.**
All seven carry the pre-2026-08-19 flat shape — `mot`, `coverage`, `alignment`,
`transition` — because they were written by the n8n node before its parity fix
(latest row `2026-08-19 02:34:29Z`; the fix landed later that day). So on every
stored dossier the four questions those keys feed — the priority-1
`source_offboarding_not_authorized` question naming each outstanding sequencing
condition, and the three priority-2 `NOT_EVALUATED` questions — are **silently
absent**. `?? {}` makes their absence indistinguishable from their being fine.
The ZAF panel reads the same two keys (`zaf-app/assets/panels.js:1062–1067`), so
every dossier in the account renders its sequencing and date rows empty.

**Current tests assume:** the current builder's shape. Every `dossierView` test
constructs its input by running `handleRelocationReview()`, so no test has ever
seen the shape that is in the table.

**Difference:** a derivation designed specifically to reach existing rows reaches
none of them, and the mechanism by which it fails is the one this repository
names as its worst — an absence that renders as a satisfied condition.

**Evidence:** live `uc07_dossiers`, 2026-08-20 — `jsonb_object_keys` on
`external_ref='34'` returns `mot, pto, flags, framing, verdict, coverage,
feasible, alignment, citations, narrative, seniority, transition, parseSource,
uncertainty, costEstimate, faithfulness, sourceCountry, relocationType,
requiredActions, destinationCountry, customerFacingAcknowledgement` — 21 keys,
**no `dateChecks`, no `transitionSafety`**; `dossier ? 'dateChecks'` is `false` on
all seven. `src/uc07/dossierView.js:355–430`;
`src/uc07/dossierBuilder.js:219–220`.

**Likely reason:** establishable. `dateChecks`/`transitionSafety` were introduced
by the parity fix; nothing migrated the rows written before it, and no test could
notice because every test's fixture comes from the new builder.

**Risk if left as-is:** low today in absolute terms — the seven rows are test and
proof traffic, not customer cases — and high in kind, because the first real
relocation dossier to be read will be read through a view whose behaviour on
stored data has never been exercised. It also falsifies, in the code's own words,
the reason the module was placed where it was.

**Recommendation:** RECONCILE, cheaply and in two parts. (a) Make the reader
tolerate both shapes: `dossier.dateChecks ?? {mot: dossier.mot, coverage:
dossier.coverage, alignment: dossier.alignment}`, same for `transitionSafety ??
dossier.transition` — a shape a reader cannot recognise should be a *stated*
unknown, not an empty object. (b) Add one test whose fixture is a stored flat-shape
row rather than a freshly built dossier. Backfilling the seven rows is optional;
tolerating both shapes is not, because the n8n node can be redeployed and rolled
back independently of this file.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `RECONCILE` · `DECIDED · NOT YET BUILT`

**Both parts, and (a) is not optional.**

(a) **The reader tolerates both shapes** (`R-21`) —
`dossier.dateChecks ?? {mot, coverage, alignment}`, and `transitionSafety ??
dossier.transition`. **A shape a reader cannot recognise must be a *stated*
unknown, not an empty object.** `?? {}` currently makes an unreadable dossier
indistinguishable from a satisfied one, on all seven stored rows and in the ZAF
panel — which is the mechanism this repository names as its worst: *an absence
that renders as a satisfied condition.*

(b) **One test whose fixture is a stored flat-shape row** (`R-22`), not a freshly
built dossier.

**Backfilling the seven rows is optional; tolerating both shapes is not** — the
n8n node can be redeployed and rolled back independently of `src/`, so the old
shape can reappear at any time without a commit to this file.

**The class-level lesson, which is larger than this bug and belongs in the
engineers' doc:** *every fixture in this use case is produced by the current
builder, so no test has ever seen the shape that is in the table.* That applies
anywhere a read-time derivation meets rows written by an independently-deployable
node — which is six of the nine use cases. The module's own header gives the
reason it was placed where it is: *"it applies identically to rows written by the
n8n path, **and to every dossier already in `uc07_dossiers`**."* It reaches none
of them. **A derivation designed specifically to reach existing rows reaches
zero, and its own justification is what falsifies it.**

---

### SPEC_DRIFT · DRIFT-073 · A portal-submitted dossier reaches nobody, and nothing anywhere can record that it was read

**Original/documented behaviour:** §5 ends *"→ escalate to Mobility Legal →
audit"*. §9: *"Always compiles dossier → assigns Mobility Legal. No branch leads
anywhere else."* `src/shared/escalationRouting.js` holds the row —
**Mobility Legal (Tier-3)**, `queue_mobility_legal_t3`, group `6168424846751`,
live in the account.

**Current implementation:** path-dependent, and only one path assigns.
- **Zendesk path:** the ticket already exists; `workflows/nodes/assignRouting.js:80`
  carries the UC-07 row and the graph assigns the group and tags. This works —
  ticket #34 sits in Mobility Legal (Tier-3).
- **Portal path:** `src/portal/ticketing.js` excludes UC-07 and UC-08 from
  `TICKETABLE_TYPES`, for a reason that is correct and must not be undone —
  linking a ticket means `linkTicket()` writing an id back onto the record, and
  these stores' defining property is one write method and zero mutations. The
  consequence is that the dossier is compiled, audited, durably stored, and **no
  ticket, no group, no queue entry and no notification** results. The named
  specialist is never told.

**Beyond the hand-off, there is no completion state at all.** `uc07_dossiers` has
no status column, so `awaitingState()` returns `awaiting / reading` forever
(`src/approvalqueue/awaiting.js:76–95`): *"there is no column that could say it
had been dealt with."* Combined with DRIFT-041 (no expiry, no reminder anywhere in
the system), a UC-07 dossier can never leave the waiting list by any means the
system possesses.

**Current tests assume:** the exclusion. `test/uc07.test.js`'s F-38 store test
names `linkTicket` in its reasoning as the mutation that must not appear.

**Difference:** "nothing may approve this" and "nobody is told this exists" are
being satisfied by the same mechanism, and only the first is the invariant.
`src/approvalqueue/stuck.js:43–48` states the distinction correctly and is the
only thing in the system that does: *"a UC-07 dossier sitting in Mobility Legal's
queue is NOT on this list, and one with no ticket IS — under `no_ticket`, with a
`why` that says plainly that the missing thing is the hand-off and not a
control."*

**Evidence:** `src/portal/ticketing.js:33–50, :70–72`;
`workflows/nodes/assignRouting.js:80`; `src/shared/escalationRouting.js:194–204`;
`src/approvalqueue/awaiting.js:76–95`; `src/approvalqueue/stuck.js:43–48`;
`docs/APPROVAL-ROUTING.md:214`; `docs/ESCALATION-DESTINATIONS.md:484`. Live: all
seven `uc07_dossiers` rows are `source: "webhook"` — **no portal-submitted
relocation exists in production**, so the gap is real and has not yet been paid
for.

**Likely reason:** fully establishable and already written down twice. The
exclusion is deliberate and argued in the file that implements it; the
consequence is recorded in `docs/APPROVAL-ROUTING.md` and
`docs/ESCALATION-DESTINATIONS.md` as an open item. What is missing is a
resolution, not an understanding.

**Risk if left as-is:** the 🔴 deliverable is compiled for a specialist who has no
way to learn it exists. The nearest thing to a discovery route is
`GET /uc07/api/dossiers`, which requires knowing the API and holding the read key
— and which itself once answered `{dossiers: []}` over five real rows because it
read process memory. This is the last unclosed door of the three that
`docs/use-cases/UC-07.md` §15a enumerates.

**Recommendation:** HUMAN_DECISION_REQUIRED, and the constraint makes the shape
almost self-selecting. A ticket may be **raised** without being **linked**: the
dossier does not need to know the ticket id for the ticket to carry the dossier
id, so the id can travel one way — record → ticket — leaving the store's write
surface untouched. `docs/APPROVAL-ROUTING.md` §"Unit 5 (🔴 hand-off, shape (b))"
already names this as needing a design pass. Whatever is chosen must also answer
the second half: **something must be able to say a dossier has been read**, or
the queue grows monotonically and its stuck list stops meaning anything. That
almost certainly belongs on the ticket, not on the record.

**Confidence:** HIGH

### DISPOSITION — 2026-08-21 · `DECIDED · NOT YET BUILT`

**Decision: raise a ticket without linking it, and build the aftermath.** This
finding and the owner's Q2 are the same question reached from two ends —
*"when the specialist reaches a conclusion, what will they now do? Nothing? Should
the demo not include an aftermath instead of saying no button at all, because the
employee who filed is expecting feedback."*

**Part 1 — the hand-off** (`R-23`). The dossier does not need to know the ticket
id for the ticket to carry the dossier id, so **the id travels one way, record →
ticket**, leaving `uc07_dossiers`'s write surface untouched. `ticketing.js`'s
exclusion was correct in its reasoning and wrong in its consequence: it prevented
`linkTicket()` — a real mutation — by preventing the ticket, which is not the same
thing. `docs/APPROVAL-ROUTING.md` §"Unit 5 (🔴 hand-off, shape (b))" already names
this as needing a design pass; this is that pass.

**Part 2 — the completion state** (`R-24`). The verbs are `dossier_read`, then one
of `proceeding_offline` / `not_proceeding` / `more_information_needed`. **None
executes anything in Remote.** They live **on the ticket**, never on the dossier
record — because the store's *one write method, zero mutation methods* property
**is** the structural proof, and `markReviewed()` would delete the proof in order
to record that it worked. Invariant 11 stands unchanged; invariant 17 pins the
new half.

**Part 3 — the requester is told.** §11's new per-state table. A 🔴 case with no
approve button still owes the person who asked an answer, and the wording never
borrows approval vocabulary.

**The distinction this rests on, which must not be lost in the build:**

> **"Nothing may be approved here" and "nobody may ever be told what happened"
> are two different rules, and only the first is the 🔴 invariant.**

`src/approvalqueue/stuck.js:43–48` is the **only** place in the repository that
already says this. Everywhere else the two are welded together, which is why
closing the second reads like weakening the first. It is not: `none_by_design` is
unchanged, no approve route is added, and the API keeps having no write verb of
any kind.

**Not closed by this:** DRIFT-041. A dossier can now leave the waiting list by
being **acted on**; it still cannot leave by growing **stale**, and those are
different mechanisms. §11's `Expiry` row says so.

---

## 17b. SPEC_DRIFT opened by the ninth decision pass (2026-08-21)

Four findings that did not exist before this pass. Three came out of the owner's
own questions; one came out of checking the tooling behind DRIFT-032's remedy.
**DRIFT-104 is cross-cutting and is not UC-07's to close alone.**

---

### SPEC_DRIFT · DRIFT-102 · A duplicate delivery returns `decision: "escalate"` to a caller nobody escalated anything for

**Original/documented behaviour:** §7 records the duplicate case as *"one claim on
`workflow_claims (use_case, external_ref)`; the second returns
`{decision:"escalate", duplicate:true}` and writes no audit row and no dossier."*
That is accurate about the **ledger**. `escalate` in this use case means, in §5's
words, *"the case is handed to Mobility Legal (Tier-3)."*

**Current implementation:** `src/uc07/workflow.js:238–240`:

```js
if (!claim.claimed) {
  return { decision: "escalate", duplicate: true, duplicateOf: externalRef, dossierId: null };
}
```

Nothing is compiled. **No audit row is written** — the claim check sits *above*
`audit.log()` at `:242`. No dossier is stored, no ticket is raised, no group is
assigned. **Nobody is escalated to.** And the caller receives the same `decision`
string a successful compile returns.

**Current tests assume:** the ledger's behaviour, not the caller's. No test
asserts what a *caller* can distinguish.

**Difference:** one decision string is doing two jobs — *a dossier is waiting for
Mobility Legal* and *nothing happened*. A portal requester who submits twice gets
a success-shaped response with nothing behind it; `src/portal/` reads the decision
string and has no reason to inspect `duplicate`.

**Evidence:** `src/uc07/workflow.js:232–240` (the claim), `:242` (the audit write
it precedes), `:280` (the successful return, same `decision` value);
`src/uc07/workflow.js:3` — *"→ escalate. NOTHING ELSE."*

**Likely reason:** establishable and defensible in its own frame. The claim guard
was written for **webhook redelivery**, where returning quietly is exactly right —
erroring would page a human every time Zendesk behaved normally (§6 of
`CLAUDE.md`). The value chosen was the use case's only decision, which is
reasonable until a **portal** caller reaches the same line, which it now does.

**Risk if left as-is:** small in production today — the seven live rows are
webhook traffic — and structurally the same class as DRIFT-034: an answer to a
different question printed in the same shape. It also makes the exactly-once
guarantee **unobservable from outside**, which is the property that guarantee is
supposed to have.

**Recommendation:** RECONCILE. A distinct outcome the caller can read without
inspecting a boolean — `decision: "duplicate_delivery"`, or an explicit
`{accepted: false}` — plus the §16.22 assertion. Do **not** make it an error: the
quiet stop is correct and is the reason the claim node exists.

**Confidence:** HIGH

**Disposition — 2026-08-21:** `DECIDED · NOT YET BUILT`, `R-25`.

---

### SPEC_DRIFT · DRIFT-103 · A second relocation request for the same employment is not detected at all

**Original/documented behaviour:** §9's failure modes name *"already-in-flight
conflicting action"* and guard it with a conflict check against Remote's
contract-amendments and offboardings. Nothing in any document addresses a second
**UC-07 request** for the same person.

**Current implementation:** nothing checks. `claimExternalRef()` keys on
`(use_case, external_ref)`, so two requests with different refs — which two
genuine submissions always have — both proceed. Two dossiers are compiled, two
verdicts recorded, and since neither has a status column both wait forever.
`DossierStore.listByOwner({employmentId})` exists at `dossierStore.js:161` and
**no caller uses it for this purpose.**

**Current tests assume:** one request per employment. No test drives two.

**Difference:** the conflict check the spec names is scoped to *Remote's* records
and misses **our own**. A specialist can be handed two dossiers about one person
whose verdicts disagree, with nothing on either saying the other exists.

**Evidence:** `src/uc07/workflow.js:232–240`; `src/uc07/dossierStore.js:161`
(`listByOwner`, present, unused for this); live `uc07_dossiers` — seven rows, no
repeated `employment_id`, so **the case has not yet occurred in production** and
the gap is unpaid rather than harmless.

**Likely reason:** establishable. Idempotency was designed against **delivery**
duplication, which is a transport concern, and request duplication is a business
concern. The two were never separated because only the first had ever happened.

**Risk if left as-is:** two contradictory 🔴 dossiers about one person's legal
status, both live, neither aware of the other — and the newer one is not
necessarily the one that gets read. It is the cheapest half of DRIFT-032's
conflict check and needs no Remote call at all.

**Recommendation:** RECONCILE. On compile, `listByOwner({employmentId})`; if a
prior dossier exists, name it on the new one as a finding, and — since the store
is immutable — surface the pair through the hand-off ticket rather than editing
the older row.

**Confidence:** HIGH

**Disposition — 2026-08-21:** `DECIDED · NOT YET BUILT`, `R-26`.

---

### SPEC_DRIFT · DRIFT-104 · The Sandbox capture is written to a gitignored directory, so the one defence against fixture-vs-code circularity produces nothing durable — and there is no live-demo fallback at all

**Cross-cutting. Not UC-07's alone**, recorded here because UC-07's remedy is the
first thing that needs it.

**Original/documented behaviour:** `scripts/capture-sandbox.mjs`'s own header
states the purpose exactly: *"This project's most expensive recurring defect
(CLAUDE.md §4, BUILD-LOG §3.66) is fixtures written to agree with the code and
code written to agree with the fixtures, so neither is ever compared to Remote.
Every one of the worst defects this repo has found passed the full test suite.
The only cure is a capture: a file whose contents came from the API and from
nowhere else."*

**Current implementation:** the script is real, is GET-only **by construction**
(and says so), and already captures `/v1/employments`, `/v1/countries`,
country schemas, `/v1/contract-amendments` and eleven more. It writes to
`.sandbox-cap` — `const OUT = process.argv[2] || ".sandbox-cap"` — and
**`.gitignore:44` ignores `.sandbox-cap/`**. Nothing captured has ever been
committed; `src/remote/fixtures/` holds one file, `contractAmendmentSchemas.js`.

**Current tests assume:** the mock, which is the artifact the capture exists to
correct. No test compares anything to a captured byte.

**Difference:** two, and they are different in kind.
1. **The cure is applied and then discarded.** The capture corrected the mock by
   hand in `58bad0a` and left no artifact, so the next divergence has to be found
   the same expensive way — and *"neither is ever compared to Remote"* is true
   again the moment the Sandbox changes.
2. **There is no fallback.** If the Sandbox token expires, the account is
   reseeded, or egress fails during a live demo, **every path that reads Remote
   fails**, and the demo fails with it. This has already half-happened once: the
   reseed that killed `fde4007b-…` invalidated every "known good employee" payload
   in this repository's history.

**Evidence:** `scripts/capture-sandbox.mjs:36` (`OUT`), `:97–:145` (the endpoint
list); `.gitignore:44`; `ls src/remote/fixtures/` → one file; `CLAUDE.md` §6's
dead-id gotcha.

**Likely reason:** establishable. The script was written to *diagnose* a specific
divergence, and diagnostic output is correctly gitignored. Nobody asked it to be a
fallback until the demo constraint was stated on 2026-08-21.

**Risk if left as-is:** the demo is one expiry away from failing on camera, and
the repository's stated cure for its own worst defect class leaves no evidence
that it was ever applied.

**Recommendation:** RECONCILE. Committed captures with provenance headers
(SHA-256 of the retrieved bytes + capture timestamp, the `docs/knowledge/`
discipline), a replay layer that is **loud** (`X-Sandbox-Replay`, a `_replay`
block, the date on the page), **live always wins**, GET-only on both legs, and
`source: "sandbox_live" | "sandbox_replay"` on the trace row. **The loudness is
not decoration:** an unmarked fallback makes the API-competence claim
unfalsifiable, and a demo that silently falls back is worse than one that fails,
because nobody can tell afterwards which they watched.

**Confidence:** HIGH

**Disposition — 2026-08-21:** `DECIDED · NOT YET BUILT`, `R-27`. **The staleness
horizon is `G2`, open.**

---

### SPEC_DRIFT · DRIFT-105 · UC-07's spec names an inbound route from UC-03 that has never existed in code

**Original/documented behaviour:** `docs/use-cases/UC-07.md:91` — the §5 pipeline
opens *"Ticket (routed from UC-03, or direct) → n8n → identity verify"*.

**Current implementation:** no such route, and none has ever existed.
`src/uc03/policyEngine.js:183`'s decision union is
`"auto_resolve"|"human_review"|"escalate"|"route_to_uc04"`. The only hand-off UC-03
emits is `route_to_uc04`, built in `src/uc03/uc04Intake.js`. The word "relocat"
appears nowhere in `src/uc03/` outside one comment.

**Current tests assume:** its absence, silently — no test asserts either
direction.

**Difference:** a spec line describing an intake path that no code implements,
carried in the section a reader consults to learn how requests arrive. Recorded
separately from **DRIFT-011** (which is about the *misroute that does happen*)
because they need opposite remedies: DRIFT-011 is a defect to fix in UC-03/UC-04,
DRIFT-105 is a sentence to delete in UC-07.

**Evidence:** `docs/use-cases/UC-07.md:91`; `src/uc03/policyEngine.js:183, :275`;
`src/uc03/workflow.js:79, :85`; `src/uc03/signoffPolicy.js:53`.

**Likely reason:** establishable. The line is inherited from the Build Pack, which
described a router feeding a mobility desk. Nothing in the register had ever asked
whether the code implemented it, because §12's DRIFT-011 box addressed the
*inverse* question — what UC-03 does with relocation language — and the two look
like one topic.

**Risk if left as-is:** low operationally, high as a reading. §5 is where a fresh
session learns the intake model, and this line teaches an edge that must not be
built. A future agent asked to "finish the UC-03 → UC-07 route" would be
implementing a defect.

**Recommendation:** RECONCILE — strike the phrase, and record **why** it is being
struck rather than deleting it silently, because "we simply never built it" and
"it must not be built" are different statements and only the second is true.

**Confidence:** HIGH

**Disposition — 2026-08-21:** `DECIDED · NOT YET BUILT` (documentation only).
Struck, with the reasoning in §12.

---

## 18. Build queue — `R-1` … `R-27`

**The fifth build queue in the register**, after UC-02 (`E-`), UC-04 (`W-`),
UC-05 (`N-`) and UC-06 (`A-`). Read this section before starting any UC-07 build
work. Nothing here has been built; **a decision does not close a finding**.

---

### Step 0 — three measurements, before any code

**All three are blocked from a container with no `.env`**, and all three can
change the plan. Taking them is the first unit of work, not a formality.

| | Question | Why it can change the plan |
|---|---|---|
| **M-1** | Does the Sandbox answer `GET /v1/offboardings/employments/{id}`, and if it refuses, **is that a scope `403` or an absent route?** | These are different failures that read identically in a log line. Conflating them is what produced **DRIFT-063** and left UC-02's expense-category gap filed for weeks as *"needs a token with the right role"* when **no company token could ever have opened that endpoint** — it was the wrong endpoint the whole time. Record the response **body**, not just the status |
| **M-2** | Does `GET /v1/contract-amendments` list, and can it be **filtered by employment**? | If it cannot, `R-4` becomes list-and-filter client-side, which is a different method with a different failure mode on large accounts |
| **M-3** | Does **any** Sandbox employment carry an in-flight amendment or offboarding? | **The one that decides whether `R-7` exists.** If none does, the conflict gate's positive case cannot be shown against real data and a marked rung-3/4 fixture becomes load-bearing |

> **`M-3` is the important one, and the reason is `[A-10]` restated.** Without a
> positive fixture, the conflict branch ships **having never executed** — and *a
> gate that cannot fire and a gate being careful are indistinguishable from
> outside.* This repository has paid for that shape three times: UC-03's alpha-3
> comparison (a supported-countries gate that could never pass), UC-03's sanctions
> codes (a set whose members no dictionary could resolve), and UC-06's
> `automatable` pre-check. **Every one of them passed the full suite.**

**If `M-3` returns nothing**, the fixture is authorised by **rung 4** of the
substitution ladder — not by exception — and carries rung 4's obligations: it is
self-identifying, it is named as fabricated, and **no money is invented in it**.

---

### The ordered steps

**Step 1 — the façade, before anything uses it.**
`R-1` `ReadOnlyRemoteClient`, exactly six methods · `R-2` the structural test
extended (method list pinned exactly; `src/uc07/` asserted never to import
`RemoteClient`).
*Done when:* the test fails if a seventh method is added, and fails if
`RemoteClient` is imported. **Not** when the façade merely exists.

**Step 2 — the two reads and their fixtures.**
`R-3` `listOffboardingsForEmployment()` · `R-4` `listContractAmendments()` ·
`R-5` mock fixtures for both — **neither exists; the string `offboarding` does not
appear in `src/` at all**, so a local test cannot be written until this lands.

**Step 3 — the conflict gate, positive test leading.**
`R-7` the positive fixture **first** · then `R-6` the gate, with all three
outcomes distinguishable on the page: no conflict, a conflict named, or the check
could not be run. **Silence is the one forbidden outcome.**

**Step 4 — identity.**
`R-8` the gate, three paths, failing closed on `null` · `R-9` the named
non-verification state · `R-10` employee-files-for-self, admin-verified-by-company.
*Done when:* the `null` case is asserted against a record that genuinely cannot be
read — not a mocked `null`.

**Step 5 — the Zendesk path stops lying.**
`R-11` `NOT_ASSESSABLE` / `planSource: "none"` · `R-13` the portal link in the
reply · then `R-12` `INCOMPLETE` with a named gap list once Step 2 is in.
*Order matters:* `R-11` is the correctness fix and lands first; `R-12` is the
value and needs the façade.

**Step 6 — money.**
`R-17` delete the 12% default, fee becomes `QUOTE_REQUIRED`, portal box blank ·
`R-18` remove `?? "USD"` from the `INCOMPLETE` branch · `R-19` mark or promote the
20-business-day MOT default.
*Expect* `test/uc07.test.js`'s F-37 term totals to change; that is the fix
working.

**Step 7 — the hand-off and the aftermath.**
`R-23` ticket raised without being linked, id travelling record → ticket only ·
`R-24` the outcome verbs on the ticket, the requester told, the queue able to see
a dossier leave.
*Done when:* one test proves the dossier left the waiting list **and** that
`uc07_dossiers` was not mutated. Pinned against each other, never separately.

**Step 8 — the paperwork.**
`R-16` extend the no-execution assertions **first** · then `R-14` the two rendered
documents · `R-15` self-declared fields marked on the document.
*Order matters and is the same shape as Step 3:* the assertion that would catch a
payload-shaped object must exist **before** the thing that could be one.

**Step 9 — the two duplicates.**
`R-25` duplicate delivery gets its own caller-visible outcome · `R-26`
second-request detection via `listByOwner()`.

**Step 10 — retrieval and the reader.**
`R-20` descriptions corrected, table dropped · `R-21` `dossierView` tolerates both
shapes · `R-22` a test whose fixture is a **stored** row.

**Step 11 — capture and replay.**
`R-27` committed captures with provenance, loud replay, live-wins,
`sandbox_live`/`sandbox_replay` on the trace.
*Cross-cutting:* it serves all nine use cases, and UC-07 is only the first caller.

---

### Dependencies — the four that are easy to get wrong

1. **`R-1` before `R-6`.** Building the conflict gate against the full
   `RemoteClient` "for now" re-opens the parameter the 🔴 guarantee is argued
   from, and **nothing fails when it does**.
2. **`R-7` before `R-6`.** No positive fixture, no evidence the gate can fire.
3. **`R-16` before `R-14`.** The assertion precedes the artifact it must catch.
4. **`R-11` before `R-12`.** The correctness fix is not held hostage to the
   façade landing.

**One cross-pass dependency:** `R-19`'s decision on the 20-business-day default
touches `UC07_PLAN_DEFAULTS`, which the portal also reads. It is not UC-04's
`W-4`-shaped problem, but it is the same file.

---

### What must NOT change

1. **`handleRelocationReview()` never receives a write-capable client**, and no
   caller can hand it one. The façade is the whole point; a `RemoteClient` used
   carefully is not the same decision.
2. **`uc07_dossiers` keeps one write method and zero mutation methods.** After the
   aftermath. Anyone reaching for `markReviewed()` has misread which rule it
   closes.
3. **No POST route appears in `src/uc07/server.js`** — absent, not refused.
4. **No Switch/IF node appears in the n8n graph.** Every execution still ends at
   the same single internal-note update.
5. **`control: "none_by_design"`** stays, and stays a word rather than a boolean,
   so no caller can test `!hasControl` and treat UC-07 and UC-03 as one state.
6. **The decision is always `escalate`** for every compiled request, at every
   verdict. `R-25` adds an outcome for a request that was **not** compiled; it does
   not add a second decision for one that was.
7. **The framing sentence stays under the header, above every finding, exactly
   once**, at both viewports. It is pinned by `test/zafLongformDisclosure.test.js`
   and it was already wrong once in the direction of *present but unreadable*.
8. **Money is never fabricated**, and after `R-17` no component evades that on the
   technicality of a caller-supplied default.
9. **A replayed fact is never silent.** If the banner is dropped for space, the
   replay is dropped with it.
10. **`route_to_uc04` is not touched.** UC-03's hand-off is a different mechanism
    and is correct; DRIFT-105 strikes an inbound route to UC-07 that never
    existed, and nothing about UC-03's outbound one.

---

### Open questions — named, not guessed

| | Question | Where |
|---|---|---|
| **G1** | Does the aftermath outcome need to reach the requester by **email**, or is the portal status enough? | `qa/HUMAN-DECISIONS-REQUIRED.md` §G |
| **G2** | At what age does a capture stop being acceptable — does it **refuse** or **warn**? | same |
| **G3** | Does Zendesk remain an intake for UC-07 at all, or become read-only once the portal is primary? | same |
| **G4** | Does the portal-primary reframing apply to **UC-08**? **Deliberately not decided here** — it belongs to UC-08's own pass | same |

