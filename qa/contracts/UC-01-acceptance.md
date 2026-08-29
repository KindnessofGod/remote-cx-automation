# UC-01 — Canonical Acceptance Contract

> **Employment Verification Letter · 🟢 Low tier · Remote-native request,
> reaching us through Zendesk**
>
> Reconciled 2026-08-20 from `docs/use-cases/UC-01.md`, `docs/00-FOUNDATION.md`,
> `src/uc01/{policyEngine,workflow,classifier,letter}.js`,
> `workflows/nodes/{gates,validateClassification,renderLetter,assignRouting}.js`,
> `src/review/`, `zaf-app/`, `test/uc01*.test.js`, `test/n8nParity.test.js`,
> `docs/ESCALATION-DESTINATIONS.md`, `docs/LIVE-PATH-STATUS.md`.
>
> **Second pass, 2026-08-20**, against sources the first pass did not consult:
> `docs/INTAKE-RESEARCH.md`, `docs/REMOTE-API-INDEX.txt` (Remote's own
> `llms.txt`), `docs/research/Remote UC-01 …Deep-Dive Research.md`,
> `src/portal/requestTypes.js`, `src/shared/identity.js`,
> `src/zendesk/normalizeTicket.js`, `src/remote/mockServer.js`, and Remote's
> published support articles. That pass established **how Remote actually
> collects each of the three verification channels**, and produced DRIFT-074 to
> DRIFT-077 — one of which is a live compliance defect rather than a
> documentation gap.
>
> **This contract is the intended business truth.** Where it differs from the
> current implementation, §17 says so explicitly. It has not been used to change
> any code or any test.

---

> ## Decisions — fourth pass, 2026-08-20. UC-01 is now decided
>
> The first two passes **found** UC-01's drift. This one **resolved** most of it.
> Eight findings carried a disposition from the owner (`DRIFT-001`…`DRIFT-005`,
> `DRIFT-074`, `DRIFT-075`, `DRIFT-076`); one new finding was opened by the
> session itself (`DRIFT-085`); ~~two~~ **four** remain open and say so:
> `DRIFT-003`, `DRIFT-004`, `DRIFT-085` and `DRIFT-086` — every **unstruck** row of
> the *What is still OPEN* table below, which is where a later reader should
> re-derive this count rather than trusting the number written here.
> *(Corrected 2026-08-21. The count read "two" from 2026-08-20 and was already
> wrong then: the table has carried more than two rows since the day this box was
> written, and `DRIFT-077` leaving it on 2026-08-21 did not make the sentence
> right. A count that is asserted rather than derived goes stale the first time
> the thing it counts moves.)*
>
> **Why the dispositions are written into the finding rather than replacing it.**
> Same rule as UC-03's third pass. Nothing is deleted. A resolved finding that
> vanishes comes back — a later reader re-derives the disagreement, re-argues it,
> and often decides it the other way. `CLAUDE.md` §6 records this repository
> paying for that in both directions **on the same day**: an issue open in one
> status file and closed in another.
>
> | State | Means |
> |---|---|
> | `DECIDED · BUILT` | Chosen, and the code matches. Nothing outstanding |
> | `DECIDED · NOT YET BUILT` | Chosen, and the code still does the old thing. **The drift is still real** — a decision does not close a finding |
> | `OPEN` | Nobody has chosen |
>
> **Exactly one finding below is `DECIDED · BUILT`** — DRIFT-001, whose entire fix
> is deleting a paragraph that says a gap exists which was closed months ago.
> Leaving a known-false paragraph in place while writing "DECIDED: delete it"
> would be the precise failure this register exists to prevent. Everything else
> is `DECIDED · NOT YET BUILT`: **this pass changed no code and no test.**
>
> ### The four gate-behaviour changes, named separately
>
> UC-01's gate changes are **numbered** (`G-1`…`G-4`). UC-03's are **lettered**
> (`G-A`…`G-C`). They are different sets in different documents and do not
> correspond — the numbering is deliberate, because this repository already has
> two registers both numbering their findings `C-N` and code citing both
> (`CLAUDE.md` §7 item 20).
>
> Each of these changes **what the system decides**, not only what it says. Each
> therefore needs the same treatment: the gate in `src/uc01/policyEngine.js`, the
> matching edit to the n8n port `workflows/nodes/gates.js`, `test/n8nParity.test.js`
> green across both, and then a **republish** of graph `WORKFLOW_UC01_ID`. A gate
> changed in one of the two places is a gate that disagrees with itself.
>
> | # | Change | From | To | Source |
> |---|---|---|---|---|
> | **G-1** | **Engagement eligibility**, first position, fails closed | Engagement type is never consulted; a contractor receives a letter saying Remote employs them | Four refusal classes — contractor, direct/HRIS (non-EOR), onboarding incomplete, offboarding/notice — refused with a reason naming the engagement, **and no `documents` row written** | DRIFT-074 |
> | **G-2** | **Self-service deflection** | An eligible EOR employee asking for the plain standard letter is issued a second, parallel letter | Deflected to Remote's own Requests-tab flow, which serves it in seconds. Auto-issue **stays**, as the fallback for everyone that flow refuses | DRIFT-076 |
> | **G-3** | **Consent is read, not claimed** | `consentOnRecord` is a boolean passed in on the ticket, hard-coded `false` on **both** production paths | A lookup against `consent_records` returning an **artifact**; a new pending state `awaiting_employee_consent`; consent granted by the named employee through a surface of their own | DRIFT-075 |
> | **G-4** | **Letter language** | No language handling anywhere; a confidently-misread non-English request auto-resolves in English | The classifier returns the request's language; a language we hold no reviewed template for goes to a human. **We never machine-translate the letter** | DRIFT-004 *(recommended, not yet chosen)* |
>
> **G-1 and G-2 read the same data twice**, which is why they are cheap together
> and incoherent apart. "Is this person eligible for a letter at all?" (G-1) and
> "could this person have served themselves?" (G-2) are the same engagement,
> status and onboarding facts asked two ways. Building G-1 without G-2 leaves the
> duplication; building G-2 without G-1 deflects the very people who cannot
> self-serve straight back into the flow that refused them.
>
> ### What is still OPEN
>
> | # | Question | Why it is still open |
> |---|---|---|
> | ~~**DRIFT-003**~~ | ~~Should an `out_of_scope` refusal leave a trace?~~ | ~~Explained in the finding below at the owner's request. A recommendation is stated; nobody has chosen it~~ · **DECIDED AND BUILT (rca-1bk, 2026-08-22) — left this list.** Then **REVERSED** by a loop-guard fix (`rca-qdc`, commit `93884e7`) that added a tag and a claim row the original decision said not to write, and **RATIFIED** by the owner the same day (bead `rca-jsv`): the tag and claim row stay; §6 and VC-11 amended to permit them. See the finding below and `qa/SPEC-DRIFT-INDEX.md` DRIFT-003 for the full chain |
> | **DRIFT-004** | Multilingual — build it, or state the non-goal? | Answered in the finding below with a recommendation (**G-4**: detect and route, never translate). Nobody has chosen it |
> | ~~**DRIFT-077**~~ | ~~UC-01 has no Remote-side and no third-party intake surface~~ | ~~**No disposition was given.** DRIFT-075's answer forces part of it — a consent surface *is* a third-party-adjacent surface — but the Requests-tab branch is undecided~~ · **ANSWERED 2026-08-21 — left this list. See the note below the table.** |
> | **DRIFT-085** | The two execution paths issue materially different letters | Opened by this pass, then **confirmed against the live graph**. Three-step recommendation stated, not chosen |
> | **DRIFT-086** | **The live path posts the letter and stores no copy of it** | Found by reading the deployed graph once n8n was reconnected. `documents` appears **zero times** in the workflow JSON. Recommendation stated, not chosen |
>
> **Correction, 2026-08-21 — DRIFT-077 is no longer open.** This table was written
> on 2026-08-20 and was accurate that day. The owner answered DRIFT-077 the
> following day: **build both surfaces, with a free-text compose box for the
> third-party channel**, and the third-party door as **its own unauthenticated
> surface rather than a persona on the existing portal**
> (`../HUMAN-DECISIONS-REQUIRED.md` §G3, line 2839). Its gate, `G1`/DRIFT-075, was
> answered 2026-08-20 at line 2701 of the same file, so the gate is satisfied and
> the decision stands. Full disposition: §17 DRIFT-077. **It moves to
> `DECIDED · NOT YET BUILT`, not to closed** — neither surface exists, and §13
> still records both as absent.
>
> The row is struck rather than deleted for the reason stated above: a resolved
> finding that vanishes comes back. **This correction exists because the stale row
> was read as current** — the UC-01 Validator pass escalated it as a possible
> `HUMAN_DECISION_REQUIRED` on exactly this premise, and only the Builder pass
> caught it by opening the register. That is `CLAUDE.md` §6's stale-status-file
> gotcha, live, inside a document marked authoritative.
>
> ### Two things changed after this box was first written, both the same day
>
> **1 · n8n was reconnected, and the check ran.** `npm run verify-deployed`:
> **39 nodes · 0 drifted · 0 unpublished**, exit `0`; graph `WORKFLOW_UC01_ID`
> active with `versionId === activeVersionId`. DRIFT-002's standing rule — *report
> missing n8n access at the top of the reply, never bury it* — earned its keep
> inside a single turn: the gap was reported, the server was reconnected, the
> check ran, and it immediately produced **DRIFT-086**, which no hermetic test
> could have found.
>
> **2 · The format decision was inverted, and the inversion is an improvement.**
> DRIFT-005 first made the **PDF** the artifact of record and the HTML a preview.
> It now reads the other way: **HTML is the artifact of record; the PDF is a
> rendering of it, produced at download.** Three reasons, in the disposition:
> both execution paths can produce HTML (a Code node cannot launch Chromium),
> HTML is byte-deterministic where Chromium's `/CreationDate` and `/ID` are not,
> and `documents.content` already holds HTML. The principle it settles, so no
> later use case re-argues it:
>
> > **The artifact of record is whatever a human signed. Where nobody signed, it
> > is whatever both execution paths can produce identically.**
>
> **UC-03 keeps PDF and that is the same rule, not a contradiction** — its travel
> letter carries a specialist's signature, so there the delivered file must be the
> signed file.

---

## 1. Business purpose

Third parties — banks, landlords, immigration offices — demand proof of
employment on their own timeline, not the employer's. **Remote automated the
standard case years ago**, and UC-01 must not compete with it. What reaches
support is what falls *out* of that path.

Remote runs verification through three channels, and only two of them produce
work:

| Channel | How it is collected | Shape | Outcome |
|---|---|---|---|
| **Standard letter** | Requests tab → New request → **Employment letter** → pick a language template | Form, closed dropdown | **Instant download, no human.** Outside UC-01's scope |
| **Customized letter** | **The same form**, Templates → *"None of these templates fits my needs"*, plus an optional upload of the third party's own form | Form envelope, **free-text payload** | ~~1–3 business days~~ **no published turnaround**, CX + Lifecycle Support |
| **Third-party direct** | **`lifecycle-support@remote.com`** — an email address | A mailbox | ~~1–15 business days~~ **no published turnaround**, Lifecycle Support, **consent-gated** |

> **Correction, 2026-08-28 — the two turnaround figures struck through above
> were never Remote's, and they carried this table's citation.** Every article
> named here was re-fetched live from `support.remote.com`'s Help Center API
> today. Article `19201215338509` ("How to get employment verification via 3rd
> party") contains **no "business day" anywhere**; its only "15" is *"15+
> different languages"*. Article `8429086541325` (customized letter) contains
> none either.
>
> The numbers came from Remote's **background-check** articles — *"Express
> Employment and Global Sanctions checks are completed within 1–2 business
> days"* and *"Employment and Education checks… may take up to 15 business
> days"* (`34566185236237`) — which describe the **opposite direction**: Remote
> asking a *previous* employer about a candidate, not Remote answering a bank
> about an employee. "1–15" is not even a quotation of those; it is two
> separate figures fused into a range that appears in no Remote source at all.
>
> **What Remote does publish for this path**, verbatim and confirmed today:
> a mailbox (`lifecycle-support@remote.com`), a callback telephone option, and
> one condition — *"We will be able to provide email employment verification
> directly with the company **after receiving permission from you (the
> employee)**."* No field list, no required id, no name, no turnaround.
>
> Kept struck rather than deleted because the failure mode is the transferable
> part: a figure lifted from a sibling article and stamped with the
> neighbour's `[CONFIRMED]` tag reads as rung-1 evidence for as long as nobody
> re-fetches the page it names. The tag was the error, not the research.

The standard and customized branches are **the same form, one dropdown value
apart** — one resolves instantly, the other goes to a human queue. Identical
intake, opposite outcome: proof that the bottleneck is not the shape of the
intake. A form *collects*; it does not *fulfil*. The dropdown gives the request
**type**; the field that matters is free text whose defining property is that it
does not fit the template.

**The two slow channels are slow because of queue time, not work time.** An SLA
quoted in days for a task measured in minutes is queue-dominated by definition.
So UC-01's value is not "issue letters faster". It is three things:

1. **Deflect instantly** what Remote cannot serve at all (§6's four ineligibility
   classes) — today those cost a queue slot, and a human's time, to deliver a *no*.
2. **Prepare** the custom letter so the specialist's minutes go to the one row
   that needs a human — *does this wording commit a Remote entity to something it
   should not?*
3. **Remove Remote-side latency** from the third-party consent round-trip. The
   employee's own response time is irreducible; the three agent-side waits around
   it are not.

At Remote's scale the argument is capacity and consistency, not seconds: a
verification letter always loses priority to a payroll incident, so automating
the low-complexity category stops it competing for the same attention as the
high-complexity one — and a deterministic eligibility gate does not forget a rule
that a tired specialist, in a new timezone, on their fourth month, can.

**It is a request-routing and resolution problem, not a PDF generator.**

## 2. Primary operator persona

**Role:** the **employee** is the requester. The **operator** is any HR Ops
support specialist working the exception.
**Experience/knowledge:** knows Remote's employment records and what a
verification letter is for; handles many tickets a day.
**Typical working context:** inside a Zendesk ticket, with the ZAF sidebar open.
**They understand:** employment status, contract type, **which engagements Remote
is legally the Employer of Record for**, what may and may not be disclosed to a
third party, consent.
**On the third-party channel the operator is Lifecycle Support**, not general CX,
and their working context is a shared mailbox rather than a ticket queue.
**They DO NOT know:** the `cases`/`review_queue`/`documents` schema, gate slugs,
the classifier's model name, workflow or execution ids, or that a "policy engine"
exists.

## 3. Job to be done

*Requester:* "Get me a document that proves I work here, for the party that is
asking."
*Third party:* "Confirm this person works there, so I can approve their mortgage,
tenancy or background check."
*Operator:* three jobs, not one — **deflect** what Remote cannot issue at all,
**prepare** what needs a human signature, and **run** the consent round-trip
without adding Remote's own latency to the employee's.

## 4. Starting preconditions

**Where the request starts, which is not where it currently reaches us.** The
business event begins in one of three places, all of them Remote-side or
outside it entirely — **never in Zendesk**:

| Channel | Where the person actually is | Emits an API event? |
|---|---|---|
| Standard letter | Remote's **Requests tab** | ❌ (and it never needs to — it self-serves) |
| Customized letter | The **same form**, custom branch | ❌ |
| Third-party direct | **The third party's own process**, landing in a mailbox | ❌ — there is no object and no requester account |

**Why it reaches us through Zendesk today.** Remote's API has no
employment-verification-letter resource at all: no create, no read, no decide, no
webhook. The absence is meaningful precisely because **sibling letter types have
all of it** — the probation completion letter carries `POST`, `GET` and three
webhooks; the travel letter request carries `GET`, `PATCH` and five. No object ⇒
no lifecycle ⇒ no webhook ⇒ **nothing for any automation to subscribe to**,
Remote's own or a CX team's. So Zendesk is the only surface in this flow that
emits an event, and that is a fact about Remote's API rather than a design choice
of ours — it replaces the earlier reading of the Zendesk entry point as a legacy
accident. [CONFIRMED — `docs/REMOTE-API-INDEX.txt`, Remote's own `llms.txt`.]

**And it is the same absence this repository has already answered twice.**
`src/remoteui/` stands in for the amendment surface Remote publishes no API for;
`src/portal/` stands in for the Requests tab for the seven use cases with no event
of their own. **The intended entry points for UC-01 are the same shape**: a
Requests-tab branch for the two letter channels, and a deliberately
unauthenticated **third-party stand-in** in place of `lifecycle-support@remote.com`
— each running the real gates and then creating the pre-tagged Zendesk ticket, the
ordering `src/remoteui/` already establishes, so a ticket failure can never erase a
decision already made.

**Neither surface exists yet, and building them is decided** — DRIFT-077,
collected as **G3** in `../HUMAN-DECISIONS-REQUIRED.md`, **ANSWERED 2026-08-21 at
line 2839**: build both, with a **free-text compose box** for the third-party
channel rather than a structured form, and the third-party door as **its own
unauthenticated surface, not a persona on the existing portal** — because the
portal authenticates a persona and the whole point of that door is that the person
on the other side is not authenticated. The Remote-side branch lands as a new type
in `src/portal/requestTypes.js`. It was gated on `G1` because a third-party
surface has nothing to succeed at while the consent path is unreachable; `G1` was
itself answered 2026-08-20 (line 2701), so the gate is satisfied, and the build
order is `G-3`'s consent lookup first, then the third-party door. Full
disposition: §17 DRIFT-077. *(An earlier revision of this paragraph read
"building them is an open decision", which was true on 2026-08-20 and stopped
being true the next day.)*

**The decision changes nothing about the tree today: neither surface is built.**
**Until they exist, Zendesk is the only implemented entry point**, and every
precondition below is written against it. That gap between where the request
starts and where this system first sees it is the single largest thing this
contract records about UC-01.

**The request is one of the three non-standard classes**, never the standard
self-service letter:

- the requester is **ineligible** for self-service (§6's four classes) and was
  told by Remote's own product to contact support;
- the standard template **does not fit** what the requesting party needs;
- a **third party** is asking directly.

If an eligible EOR employee asks for the standard letter, the correct outcome is
to point them at Remote's own instant flow — **not** to issue one. UC-01 as built
issues one; that is DRIFT-076, and it is ~~an open product decision, not settled
here~~ **DECIDED 2026-08-20 · NOT YET BUILT · `G-2` · option (b)**: deflect the
self-servable to Remote's own Requests-tab flow, and keep the letter for the
ineligible-but-serviceable cases. The owner set a rule rather than picking an
option — *"i dont want to solve what remote has already solved. but if it will
cost nothing, and it is not the main focus of this project you can leave the
auto-issue there. else just remove it."* Full disposition: **§17 DRIFT-076** of
this file (line ~1278, its `DISPOSITION` paragraph at ~1309) and
**`../HUMAN-DECISIONS-REQUIRED.md` §G2** (line ~2756). Line numbers are as of
2026-08-21 and drift with every edit; the headings are the durable handles.

**`NOT YET BUILT` means the drift is still real.** The tree auto-issues today, on
both execution paths. The paragraph above states the **target**, not the tree, and
recording the decision here neither closes DRIFT-076 nor licenses removing the
auto-issue behaviour from this contract's expectations — §6's table and §5's
journey still describe what is built, and say so at each site.

*(An earlier revision of this paragraph read "it is an open product decision, not
settled here", which was true on 2026-08-20 and stopped being true later the same
day. It was read as current afterwards — the same stale-status failure this
document already records against DRIFT-077, and which `CLAUDE.md` §6 records this
repository paying for in both directions on one day. Corrected 2026-08-21.)*

**Then, per channel:**

- A Zendesk ticket exists carrying the **Remote Employment ID** custom field
  (`9990000000001` on the live account).
- The employment id resolves to a real record at Remote.
- The requester's identity is available as an **authenticated signal** — a
  session, or the Zendesk-authenticated requester email matched against the
  employment record. A claimed email in the ticket body is never sufficient.
- **On the third-party channel there is no authenticated signal at all, and there
  cannot be.** The initiator has no Remote account, no session and no tenant; they
  can only ever make a claim. **The employee's recorded consent is the only
  authenticated signal that flow will ever have** — which is why the channel
  exists in that shape, and why it is the slow one. A consent record exists or it
  does not; both are legitimate starting states with different outcomes.

**Sources for the channel description.** Article existence [CONFIRMED] from the
search index; article **content [INFERRED]**, because `support.remote.com`
answers an automated fetch with a 403 — the split rule is
`docs/INTAKE-RESEARCH.md` §1.
[Standard letter](https://support.remote.com/hc/en-us/articles/4422684040461-How-to-generate-a-standard-employment-verification-letter-on-Remote) ·
[Customized letter](https://support.remote.com/hc/en-us/articles/8429086541325-How-to-request-a-customized-employment-letter) ·
[Third-party verification](https://support.remote.com/hc/en-us/articles/19201215338509-How-to-get-employment-verification-via-3rd-party) ·
[Why it is unavailable on my profile](https://support.remote.com/hc/en-us/articles/17537524163853-Why-is-the-employment-verification-letter-request-not-available-on-my-Remote-profile)

## 5. Main successful journey

1. The employee has already tried Remote's own self-service letter and it did not
   serve them — it was unavailable on their profile, or no template fitted. They
   ask, in their own words, for proof of employment.
2. The system confirms who is asking, and that they are the person the letter
   would be about.
3. It reads the employment record from Remote — never from the ticket text.
4. **It confirms Remote is legally able to issue this letter at all** — that the
   engagement is one Remote is the Employer of Record for. A contractor, a
   direct/HRIS employee, an unfinished onboarding, or an employment serving
   notice is refused *here*, and told what they can have instead. See invariant 12
   and DRIFT-074.
5. It confirms the employment is active, the request is for the standard letter,
   nothing outside the standard fields was asked for, it understood the request
   confidently, and the record states every fact the letter prints.
6. The letter is produced and posted to the requester's own ticket, which is
   resolved. **No compensation appears in it** — a property of the template.
7. The requester sees the answer on their ticket. Nobody was involved.
8. The decision is durably recorded *before* the letter is posted.

~~**This journey is contested, and deliberately left contested.**~~
**This journey was contested. It was decided on 2026-08-20 and is not yet built.**
If Remote's own product already issues the standard letter instantly, a
support-side system that issues a second one is duplicating it rather than
absorbing the tail this use case exists for. Steps 5–7 may therefore be the wrong
success condition. That is DRIFT-076, and ~~resolving it is a product decision
recorded in `../HUMAN-DECISIONS-REQUIRED.md`, not a reconciliation this contract
may make on its own~~ **it was resolved by the owner as option (b) — `G-2`,
deflect the self-servable** (`../HUMAN-DECISIONS-REQUIRED.md` §G2; §17 DRIFT-076
below).

**Steps 1–8 above stand exactly as written until `G-2` is built**, because
`NOT YET BUILT` means the tree still auto-issues and this section records what the
system does. They stop being the success condition the day `G-2` lands: after it,
the happy path is a **deflection** and the letter is what an *exception* gets, and
§16's evidence list moves with it. *(Correction 2026-08-21: the struck sentences
described the question as still open, which it stopped being on 2026-08-20.)*

**On the third-party path:**

1. A bank, landlord or screening vendor writes to Remote. They are not a Remote
   user and nothing they say about themselves can be believed.
2. **Nothing is disclosed — not even that the person exists.** Confirming
   existence is itself a disclosure.
3. The employee is asked for consent, and told who is asking and for what.
4. The employee grants or refuses. A grant is recorded as a durable artifact that
   can be produced afterwards, not a boolean.
5. Only with consent on record does the request reach a specialist, who decides
   what may be disclosed. **Never zero-touch, even with consent.**
6. The disclosure is logged against the consent artifact.

Steps 3–6 cannot currently happen — see DRIFT-075.

**On the exception path:** the specialist opens the ticket, sees in one screen
what was asked for, what the system compared, which check stopped it, and what
they are being asked to decide — then approves or declines with a reason, and the
letter (if approved) is rendered through the *same* template, so a human cannot
approve a wider disclosure than the automation is permitted to make.

## 6. Valid variations

**The four ineligibility classes come first**, because Remote cannot issue this
document for any of them at any speed. Its own product blocks each at the
self-service branch and tells the person to contact support — which is how they
arrive here. [Content INFERRED, per §4's sources; the rule itself is stated by
Remote and independently corroborated.]

| Input / condition | Expected behaviour | Expected business outcome |
|---|---|---|
| **Independent contractor** (`contract_type` / `type` / `employment_model` = `contractor`) | **`blocked`** / ~~`not_eor_engagement`~~ **`engagement_not_eor_contractor`** | Refused in seconds with what they *can* get — a contract or invoice history, not an employment letter. **Remote is not their legal employer and must not say it is.** No letter, no queue slot |
| **Direct / HRIS / Global Payroll employee** (`global_payroll_employee`, `direct_employee`) | **`blocked`** / ~~`not_eor_engagement`~~ **`engagement_not_eor_direct`** | Same. Their employer is the customer, not Remote. Directed to their own employer |
| **Onboarding not finalised** | **`blocked`** / ~~`onboarding_incomplete`~~ **`engagement_onboarding_incomplete`** | Refused with what is outstanding. A letter attesting facts not yet established is a false attestation |
| **Serving notice / offboarding in progress** | **`escalate`** / ~~`employment_winding_down`~~ **`engagement_offboarding`** | Lifecycle Support, never automated. May involve an active severance or a dispute |
| Active **EOR** employee, standard request, own session, complete record, confident read | `auto_resolve` / `all_gates_passed` | Letter posted publicly to the ticket; ticket solved and tagged; case, document and audit rows written; nobody involved |
| Third party with consent on record | `human_review` / `third_party_request` | Specialist decides what may be disclosed. Never zero-touch, even with consent |
| Attached form to complete | `human_review` / `artifact_present`, flag `has_attachment` | Specialist reads the form; the standard letter is not what was asked for |
| Link to an external verification portal | `human_review` / `artifact_present`, flag `external_url` | Specialist handles the portal submission |
| Request understood but not for the standard letter | `human_review` / `non_standard_request` | Specialist writes what is actually needed |
| Requester asks for salary, manager name, home address | `human_review` / `over_scope_request`, over-scope field **names** carried, **never values** | Specialist decides the disclosure. Nothing is silently redacted and sent |
| Classifier confidence below `0.85` | `human_review` / `low_confidence` | Specialist confirms the reading before a factual document goes to a bank |
| Not an employment-verification request at all | `out_of_scope` | Polite boundary reply. **No case row, no review-queue row, no audit row.** ~~No ticket tag~~ · **AMENDED 2026-08-22 (owner ruling, bead `rca-jsv`, DRIFT-003) — permits the tag `uc01_out_of_scope_replied` and one `workflow_claims` row.** Both are the loop guard: the live Zendesk trigger's `not_includes` list keys off that tag, and the claim row is what makes the branch idempotent — without them an unbounded reply loop returns (a real customer received 21 replies in 39 seconds, stopped only by Zendesk's own 429). The struck text is the original, superseded rule, kept visible rather than deleted |
| Employment not `active` | `escalate` / `employee_not_active` | HR Ops; a letter about a past employment is a different document a person writes |
| Identity not provable | `escalate` / `identity_not_verified` | Nothing about the employment is disclosed. This is a failure to *verify*, not a finding of impersonation |
| **Third party asking, no consent yet** | `awaiting_employee_consent` | Consent is requested from the employee. **Nothing is disclosed, including whether the person exists.** Not a refusal — a pending state, which UC-01 does not currently have (DRIFT-075) |
| **Third party asking, employee refused consent** | `blocked` / `consent_refused` | The third party is told Remote cannot confirm, without being told why. The refusal is recorded against the employee's own instruction |
| **Eligible EOR employee asking for the plain standard letter** | ~~Contested — today `auto_resolve`; arguably should be `deflected_to_self_service`~~ · **DECIDED 2026-08-20 · NOT YET BUILT · `G-2`** — target `deflected_to_self_service`; **today, and until `G-2` ships, `auto_resolve`**, which is the row a test written against the tree must still match | They already have this instantly inside Remote. Issuing a second copy duplicates a solved flow. **DRIFT-076** |

**The four refusal slugs above were superseded, and this is not a rename.**
The struck slugs are this table's own first-pass invention. The scheme that
governs is the one in **§17 DRIFT-074's disposition**, because a disposition
outranks an earlier table, and it is the scheme both the build queue and the code
implement — `L-3` in `../handoffs/UC-01/0001-builder-to-validator.md` (line 312)
specifies *"four reason slugs from DRIFT-074's own table plus
`eor_status_unknown`"*, and that is what was built. Three distinct slugs became
**four**:
`not_eor_engagement` **split** into `engagement_not_eor_contractor` and
`engagement_not_eor_direct`. Read as a rename, that distinction is lost — and it
is the whole point of the split. A contractor is told *Remote is not your legal
employer, here is your contract and invoice history*; a direct/HRIS employee is
told *your own employer issues this, Remote only administers*. One slug cannot
carry two different sentences to two different people.

**Verified against the code on 2026-08-21, not taken from either document.**
The slugs in the right-hand column above are the ones that exist:

| Slug | Where it is produced | Also |
|---|---|---|
| `engagement_not_eor_contractor` | `src/uc01/engagementEligibility.js:72–73` | `workflows/nodes/gates.js:97–98` · `refusalCopy.js:47` · `policyEngine.js:261` |
| `engagement_not_eor_direct` | `src/uc01/engagementEligibility.js:74–78` | `workflows/nodes/gates.js:99–103` · `refusalCopy.js:53` · `policyEngine.js:269` |
| `engagement_onboarding_incomplete` | `src/uc01/engagementEligibility.js:200` | `workflows/nodes/gates.js:126` · `refusalCopy.js:59` · `policyEngine.js:277` |
| `engagement_offboarding` | `src/uc01/engagementEligibility.js:149` | `workflows/nodes/gates.js:113` · `refusalCopy.js:65` · `policyEngine.js:285` |

**No line of the tree produces the struck slugs.** Across `src/`, `workflows/`,
`zaf-app/` and `test/`, `not_eor_engagement` and `employment_winding_down` appear
on exactly one line between them — a comment, `src/uc01/refusalCopy.js:9`, quoting
`not_eor_engagement` as an example of what a refused person used to be shown — and
`onboarding_incomplete` appears only as a **substring** of
`engagement_onboarding_incomplete`, never as a slug of its own. So a reader
searching §6's column for a reason code found either nothing or a near-miss, and
could reasonably have concluded the implementation was wrong.

**Two things this correction deliberately does not change.** The **decisions** are
untouched — three `blocked` and one `escalate`, exactly as the table already had
them: `engagementEligibility.js:148` returns `escalate` for offboarding, `:175`
returns `blocked` for both non-EOR classes, `:199` returns `blocked` for
incomplete onboarding. And the gate returns a **fifth** slug these four do not
cover: `eor_status_unknown`, the
fail-closed case for an absent or unrecognised engagement type
(`engagementEligibility.js:165` and `:190`, `policyEngine.js:293`). It is already
recorded one section down in §7's *"Engagement type absent or unreadable"* row and
is listed here so *four* is not read as the whole gate — `GATE_SEQUENCE` carries
five rows at position 1.

**Status unchanged: DRIFT-074 is `DECIDED · NOT YET BUILT` at the contract level.**
Correcting the slugs records what the gate is called; it does not close the
finding. *(Correction 2026-08-21, from a discrepancy the UC-01 Builder reported
rather than silently reconciling.)*

## 7. Edge cases and failure conditions

| Case | Expected behaviour |
|---|---|
| **Duplicate webhook / trigger fires 3× for one ticket** | Exactly one claim in `workflow_claims (use_case, external_ref)`; redeliveries stop silently at `Duplicate Delivery — Stop`. **Exactly one audit row, one case row, one letter.** This is a real historical defect: ticket #5 produced two audit rows 30µs apart and a duplicate public letter |
| **Request with no external reference** | Claimed under `unreferenced:<execution id>` rather than dropped |
| **Employment id 404s at Remote** | `identity_not_verified` with the record problem named — *"Remote returned no record for this id, so there was nothing to verify against. This is a record problem before it is an identity one."* Never a silent pass |
| **Remote read 403/5xx** | Distinguished from a 404: `upstream_unavailable` — the request was never evaluated. Escalate |
| **Classifier returns no `requestedFields` key** | `over_scope_undetermined` — **not** read as "nothing was asked for". Fails closed |
| **Classifier returns no confidence, or `NaN`** | `confidence_unknown`. Both `undefined < 0.85` and `NaN < 0.85` are false; the bare comparison was a real defect |
| **LLM unreachable / invalid JSON** | Retry 3× with backoff, then the rule-based classifier answers and the result is tagged `source: "rule_based_fallback"`. The tag is never implicit |
| **Employment record missing `full_name`, `start_date` or `contract_type`** | `incomplete_employment_record`. `escapeHtml()` maps null to `""`, so rendering anyway produced a silently blank row in a document going to an immigration officer |
| **Zendesk write fails after the decision** | The decision survives: `audit.logDurable()` runs before any customer-facing action. The ticket is not updated and that must be visible, not silent |
| **Audit backend unavailable** | The customer-facing action is **refused**, not orphaned |
| **Approval arrives days after the decision** | The employment record is re-read at approve time; a no-longer-active employee is refused then |
| **Second approval attempt on a decided case** | Refused `already_decided` (409). One decision per case |
| **Approve attempted on an `escalate` case** | Refused `no_review_path` (403). The safe path must not double as a dismiss button |
| **Approval with no reason** | Refused `reason_required` |
| **Two specialists act simultaneously** | One wins; the second is refused as already decided |
| **Zendesk group `HR Ops` missing from the account** | Tags still applied; the note carries `ASSIGNMENT SKIPPED — the group … does not exist`. Never silently unassigned, never auto-created |
| **`out_of_scope` ticket** | ~~Nothing is recorded anywhere — deliberately.~~ **AMENDED 2026-08-22 (owner ruling, bead `rca-jsv`, DRIFT-003)** — one `audit_trace` row is recorded (built earlier, `rca-1bk`), and now also one `workflow_claims` row and the Zendesk tag `uc01_out_of_scope_replied`, both serving as the loop guard the live trigger relies on. `cases`, `review_queue` and `documents` still stay empty. See DRIFT-003 for the full history and the reason the "nothing tagged" rule was reversed |
| **Employee never answers a consent request** | ~~The third party is told Remote could not obtain permission, after a defined window. **No such window is defined anywhere today** — see §11 and DRIFT-041~~ **DECIDED 2026-08-21 · BUILT (G-4)** — DRIFT-041 (`qa/SPEC-DRIFT-INDEX.md:1090, 748`): *"age and warn everywhere, lapse nowhere"*. The consent record's `status` never transitions on elapsed time alone; the window (`CONSENT_AGE_WARN_DAYS`, `src/shared/consentPolicy.js`) only ever produces a warn/notice, never a state change. After the window, the third party is told the same word-identical message (`src/thirdparty/agedNotice.js`) regardless of whether the request is genuinely unanswered, was declined, or names nobody Remote has a record of — VC-32 Amendment 2's own requirement, so the notice itself cannot become an existence disclosure |
| **Consent granted long ago, request arrives now** | Consent is scoped to a named requesting party and a purpose, and is re-checked at disclosure time. A standing "yes to anyone, forever" is not consent |
| **Third party cannot be identified at all** | Refused. An unauthenticated claim is never upgraded by persistence, plausibility or letterhead |
| **Third party asks by phone** | **Human-led entirely.** No automated path exists or may exist: verbal exchange carries no text log and the fraud exposure is one-sided |
| **Letter requested about a past employment** | Not this use case. A different document, written by a person |
| **Engagement type absent or unreadable on the record** | `blocked` / `eor_status_unknown`. Fails **closed** — an unknown engagement is never read as an EOR one |

## 8. Invariants — must never happen

1. **No letter is ever issued for a non-`active` employment.**
2. **No letter ever states compensation**, on either the automated or the
   human-approved path — the template's row list is the guarantee.
3. **A human approval cannot widen disclosure** beyond the standard field set.
4. **No customer-facing action precedes the durable audit write.**
5. **A 🔴-tier case can never be approved from this sidebar**, whatever its
   `decision` column says.
6. **A decided case cannot be decided twice.**
7. **An `escalate` case has no approve control at all** — not a disabled one.
8. **One delivery ⇒ one decision, one record, one outward action.**
9. **An absent classifier answer is never read as a negative answer.**
10. **The over-scope exception panel never carries a compensation value.**
11. **Identity is never taken from a claim in the ticket body.**
12. **No letter ever asserts an Employer-of-Record relationship that does not
    exist.** A contractor or a direct/HRIS employee must never receive a document
    naming a Remote entity as their employer. Testable against the record's
    engagement type, and **currently violated** — see DRIFT-074.
13. **No disclosure reaches a third party without a consent artifact that can be
    produced afterwards.** A boolean is not evidence. The artifact names who
    consented, to whom, to what, and when.
14. **The existence of a person is itself a disclosure.** A third-party request
    with no consent is answered without confirming or denying that the employee
    is employed by Remote.

## 9. AI responsibilities

**The LLM may:** classify intent (`standard_letter` / `non_standard` /
`out_of_scope`); detect an attachment or external URL; extract which fields the
requester asked to have included; score its own confidence; summarise the request;
parse an uploaded third-party form into the fields it is asking to have filled.

**Where a form already carries the answer, the LLM does not supply it.** Remote's
Requests tab hands over the request *type* as a closed dropdown value. Classifying
what a dropdown already states is a model guessing at a fact the intake knows —
the same error `docs/INTAKE-RESEARCH.md` §9.2 flags for UC-03's `travel_reason`.
The LLM's real work here is the **free-text ask** and the **uploaded form**, which
is the whole reason those two branches are slow.

**The LLM must never be the source of truth for:** whether the employee is
active, **whether Remote is the Employer of Record for this engagement**, what the
employment record says, whether a letter may issue, what the letter states,
whether consent exists, who granted it, or whether a disclosure is permitted.
Every LLM result is validated against a strict shape, tagged with its source, and
consumed only as an *input to* deterministic gates.

## 10. Deterministic responsibilities

**EOR-engagement eligibility** · identity verification · employment-status gate ·
third-party gate · **consent verification against a stored artifact** · scope
classification · **disclosure whitelist** · confidence threshold comparison ·
record-completeness check · letter population from fetched fields · idempotency
claim · audit ordering · routing tag and group assignment.

Eligibility and consent are listed first because they are the two that decide
whether the request may be served **at all**, before any question of how well.

The gates are the decision. They exist in two places — `src/uc01/policyEngine.js`
and `workflows/nodes/gates.js` — and `test/n8nParity.test.js` executes the n8n
body in a sandbox and asserts identical decisions. **Edit one, edit both.**

## 11. Human approval / escalation

| | |
|---|---|
| **When approval is required** | `human_review` outcomes only |
| **Who approves** | An HR Ops specialist entitled under `uc01:hr_ops` — the same roster row UC-05 shares (K10, `qa/HUMAN-DECISIONS-REQUIRED.md`, 2026-08-23; `src/review/approverEntitlement.js`'s `USE_CASE_ROLES["UC-01"]`). Deliberately not a UC-01-only token: it would let an operator roster HR Ops for UC-05 and still have UC-01 refuse those same people. The sidebar names the role and refuses an unrostered specialist server-side rather than letting them click through |
| **Evidence they need** | The employee (name, status, country), what was asked for, the deciding gate in plain words, the figures compared, and what was *not* checked |
| **After approval** | The letter is re-rendered through `letter.js` and posted; the case resolves; `human_approved` is appended to `audit_log` carrying the AI's recommendation, the human's verdict and the reason |
| **After decline** | `human_declined` with the reason; the case closes without a letter |
| **Expiry** | **None defined.** There is no timeout, no reminder and no expiry policy anywhere in this use case — see DRIFT-041 in `../SPEC-DRIFT-INDEX.md` |
| **If nobody responds** | The item sits in `review_queue` indefinitely. The approval queue reports it as waiting; nothing escalates it |
| **Consent expiry** | ~~**Undefined, and it is a gap.** The third-party path needs a window after which an unanswered consent request is closed and the third party told Remote could not obtain permission. Nothing implements or specifies one~~ **DECIDED 2026-08-21 · BUILT (G-4) · not a CLOSE.** The window (`CONSENT_AGE_WARN_DAYS`) triggers a notice, never a closure — A5 forbids closing (a state change) but not telling (a message). `src/thirdparty/agedNotice.js` sends the same fixed sentence to every past-window third-party request that is still awaiting a person, regardless of what it turns out to be about; the consent record itself is never touched by it |

**Three postures that may never be automated**, taken from Remote's own
operational risk model and adopted here as contract:

| Activity | Posture | Why |
|---|---|---|
| **Custom wording** | Human-in-the-loop, mandatory sign-off before release | The wording may create legal obligations under a specific entity in a specific country. AI drafts; a human releases. Never auto-issued |
| **Third-party phone callback** | **Human-led entirely** | Verbal, no text log, one-sided fraud exposure |
| **Offboarding / disputed record** | **Human-led entirely** | May involve an active severance or a dispute. Remote blocks these in its own product for the same reason |

This is the boundary in one line: **automate the retrieval, the eligibility, the
routing, the consent round-trip and the record-keeping — never the legal judgement
or the release.**

## 12. CROSS_UC_ROUTING

**May receive from**
- Nothing today. UC-01's only implemented entry point is a Zendesk ticket —
  which is a limitation of Remote's API surface, not a statement that the request
  is Zendesk-native. It is not; see §4.
- *(Intended but unbuilt: UC-03 classifies letter requests and could hand a
  pure employment-verification ask here. It does not — see DRIFT-043.)*

**May route to**
- Nothing. UC-01 has no outbound cross-use-case route.

**Routing conditions**
- n/a.

**Context that must transfer** — n/a today. If UC-03 → UC-01 is ever built, the
inbound context must carry: employment id, the Zendesk ticket id as
`external_ref`, the requester's authenticated identity, the classification and
its confidence with its source tag, and the correlation ref, so the receiving
case is one continued case rather than a second one.

**Must not happen during handoff** — n/a today.

**One open question, recorded as a question rather than a route.** An employee
serving notice who asks for a verification letter is refused here
(`employment_winding_down`) and is simultaneously the subject UC-05 owns. Whether
that is a route, a shared lookup, or correctly two unrelated things has not been
established, and this contract does not assert one. Raised in
`../HUMAN-DECISIONS-REQUIRED.md` alongside DRIFT-074.

## 13. Surface coverage

| Surface | What the reader should observe |
|---|---|
| **Zendesk ticket (customer-facing)** | On auto-resolve: the rendered letter as a public HTML comment, then the ticket `solved` and tagged `uc01_auto_resolved` + `queue_hr_ops`. On exception: no public reply, an internal note only |
| **Zendesk internal note** | Who this is about (name, status, country) · what happened, in the deciding gate's own words · the figures compared · the owning team · where the decision is actioned and with what verbs · assignment-skipped if the group is missing |
| **ZAF sidebar** | The employee, the decision, the deciding gate, the gate ladder behind a disclosure, the decision facts, and — only on `human_review` — approve/decline with a required reason |
| **Live Feed (`/audit`)** | The decision row as it lands, drilling down to every LLM/API attempt, with a duplicate-call banner |
| **Remote-side intake (the Requests tab stand-in)** | **BUILT (`L-14`).** `src/portal/requestTypes.js` now holds UC-01 as its own `"uc01"` entry — "Get your standard employment verification letter" — issuing through `src/uc01/selfServiceLetter.js`, deliberately separate from the ticket-driven path (see that file's header). **DRIFT-077 is resolved by this**, not merely tracked |
| **Third-party entry surface (the `lifecycle-support@` stand-in)** | **BUILT (`L-12`).** `npm run thirdparty` (:4048) — its own unauthenticated surface, a free-text compose box, never a persona on the existing portal |
| **Requests ("My requests")** | **BUILT, round-6 D-01 pass (2026-08-22).** UC-01 is a portal request type (row above) and its case IS scoped in `src/portal/ownership.js` (`SELF_SERVICE`, `SHARED_TABLE_USE_CASE`) — the "No ownership rule exists for uc01" refusal round 6 evidenced is closed. The requester's own history now lists it, with a status (`src/portal/requestStatus.js`'s `uc01` describer) and, since a self-service letter is issued the instant the case is created, an **open/save control on the document itself** (`src/uc01/letterDelivery.js`, `src/portal/letterAccess.js#describeUc01LetterForRequester`, `POST /api/requests/uc01/letter`) — the same shape UC-03's issued travel letter already had. It is ALSO where an employee sees and answers a consent request (`L-13`), unchanged by this pass |
| **Backend/API** | `GET /uc01/api/review/ticket/:ref` behind signed identity |
| **Database** | `cases` (one row, always, except `out_of_scope`) · `review_queue` (only when a human is needed) · `documents` (only when a letter was rendered, with sha256) · `audit_log` · `audit_trace` · `workflow_claims` |
| **Remote Sandbox** | **Unchanged.** UC-01 makes no write to Remote, ever |

**The three absences above were recorded as observations on 2026-08-21 and are
no longer current.** DRIFT-077 was **ANSWERED** — build both the Requests-tab
stand-in and the third-party door, the latter with a **free-text compose box**
and as **its own unauthenticated surface rather than a persona on the existing
portal** (`../HUMAN-DECISIONS-REQUIRED.md` §G3 line 2839; §17 DRIFT-077 here).
The Remote-side branch landed as a new type in `src/portal/requestTypes.js`,
alongside UC-06 per `D10`. **All three rows are now `BUILT`** (above) — the
third, *"My requests"*, was left at `DECIDED · NOT YET BUILT` for longer than
the other two: `L-14` shipped the request type and the self-service issuance,
but nothing registered it in `src/portal/ownership.js`, so every attempt to
list it answered `"No ownership rule exists for uc01"` and the letter that had
already been issued was unreachable from the one surface the result panel
pointed the employee at. Evidenced live in round 6 (`qa/evidence/UC-01/
2026-08-22-uc01-e2e-6/OPEN-DEFECTS.md` D-01, D-03) and closed in the pass that
built the ownership rule, the status describer and the collection route
alongside it (2026-08-22).

**VC-27, as frozen in `qa/handoffs/UC-01/0001-builder-to-validator.md`, is
stale in the same direction and for the same reason.** It still instructs a
completion handoff to record *"Requests ('My requests') — not applicable,
UC-01 is not a portal request type (§13)"* — a sentence V-13's own countersigned
response (same handoff, §5b/§5c) already said would stop being true once `L-14`
landed, and it has now stopped being true. A completion handoff written after
this pass must NOT cite that N/A reason; it should cite the surface as built
and evidenced instead. The handoff document's own negotiated text is left
unedited here — amending a jointly countersigned record is its own unit of
work — but a reader relying on VC-27's literal words without this note would
repeat D-03.

## 14. UX_ACCEPTANCE

- **Hierarchy.** The specialist's first screen answers *who is this about* and
  *what am I deciding*, in that order. The employee's ticket shows the letter,
  not a decision narrative.
- **Minimal information.** Nothing on the sidebar that does not serve one of the
  specialist's six questions. The classifier's model name, the execution id and
  the gate slug alone all fail this.
- **Progressive disclosure.** Gate ladder and trace behind a disclosure; the
  deciding gate's plain sentence is what shows.
- **No internal language.** `over_scope_request` never renders alone.
- **Text discipline.** One heading, then the content. No paragraph restating a
  heading.
- **Action clarity.** One approve, one decline, a required reason, and a sentence
  saying the approval posts a letter to the customer and resolves the ticket.
  On `escalate`, no controls and one sentence explaining why.
- **Consistency.** The ticket note, the sidebar and the Live Feed must agree on
  the decision, the reason and the owning team. The owning team is built from
  `escalationRouting.js`, never retyped.
- **Practicality.** A specialist must not need to open Remote to decide. The
  over-scope panel names the fields asked for; it deliberately does **not** show
  the compensation value, and says so.
- **A refusal must be actionable.** An ineligible requester is told what they
  *can* get, in one sentence, in their own words — not that a gate refused. A
  contractor reads *"Remote is not your legal employer, so we cannot issue an
  employment letter; here is what we can provide instead"*, never
  `not_eor_engagement`. This is the highest-volume message UC-01 will ever send
  and it is the one currently not written.
- **A consent request must be legible to someone who did not start anything.**
  The employee gave a bank Remote's address weeks ago and has moved on. The
  message must say who is asking, what they want confirmed, what will be sent if
  they agree, and what happens if they do nothing — without assuming they
  remember the context.

**Known UX defect carried into this contract:** UC-01's view is served by
`src/review/server.js`, which does **not** import `src/shared/employeeSubject.js` —
so the sidebar answers the specialist's first question, *who is this about*, with
an employment id. Six of the nine use-case servers do publish it; UC-01, UC-07 and
UC-08 do not.
See DRIFT-042 in `../SPEC-DRIFT-INDEX.md`.

## 15. Successful business outcome

> **The person who asked has, in their hands, a correct document that proves
> their employment — issued without a human touching it — and the bank,
> landlord or immigration officer accepts it.**
>
> Or: a specialist has decided an exception the automation was right to refuse,
> with everything they needed on one screen, and the requester was answered.
>
> Or: someone Remote **cannot** serve was told so within seconds, in words they
> can act on, and never occupied a queue slot to be told it by a person later.
>
> Or: a bank got its answer as fast as the employee was willing to permit it —
> Remote's own latency removed from a round-trip whose only irreducible delay is a
> person deciding whether to consent.
>
> And in every case: the decision is durably recorded, attributable, and
> reconstructable; **no letter asserted an employment relationship that does not
> exist**; no letter was issued for an inactive employee; **no disclosure reached a
> third party without a consent artifact**; no compensation left the building; and
> nobody received the same letter twice.

**The measures that follow from this**, and the reason they are not
"letters issued": **deflection rate** (what share of arriving requests Remote
cannot serve, answered instantly), **first-response time** rather than resolution
time on the two slow channels, and **Remote-side latency** on the third-party
path measured separately from the employee's own response time — because only one
of those two is ours to fix.

## 16. Required evidence for E2E verification

An E2E run may not claim success unless **all** of the following were observed:

1. **Browser/UI** — the ZAF sidebar rendered the employee's name (not a UUID),
   the decision, and the controls appropriate to the decision.
2. **Zendesk** — the public comment rendered as **HTML, not escaped source**
   (`comment.html_body`; `publicReply` silently escapes and this shipped once);
   ticket status `solved`; the exact tag set; the assigned group, or the
   assignment-skipped note.
3. **Remote Sandbox** — the employment record read, and **no write of any kind**.
4. **API** — the by-ticket view returns the decision and refuses without a signed
   identity.
5. **Database** — exactly one `cases` row; one `documents` row with a sha256 on
   auto-resolve; one `review_queue` row on human paths; one `audit_log` row with
   `classification.source` and `identity`; `audit_trace` rows for each attempt;
   exactly one `workflow_claims` row.
6. **Execution count** — the same external ref delivered twice yields **1** of
   each of the above, and the second delivery ends at the NoOp having written
   nothing.
7. **Audit trace** — the durable audit row's timestamp precedes the Zendesk
   comment's.
8. **Live Feed** — the decision appears, and drills down to its attempts.
9. **Node status, never run status.** An n8n run marked `error` may be fully
   correct; a pinned node reports success having done nothing.
10. **An eligibility refusal is observable** — a contractor and a
    global-payroll employee each drove a request and each was refused with a
    reason naming the engagement, **and no `documents` row was written**. Until
    this is observed, invariant 12 is asserted and untested.
11. **A consent artifact is observable** — a third-party request produced a
    readable `consent_records` row naming who consented, to whom, to what and
    when, and the disclosure references it. A `consentOnRecord: true` flag with no
    row behind it does not satisfy this.
12. **A positive third-party run exists.** The refusal path alone proves nothing:
    a use case that structurally cannot succeed and one being appropriately
    cautious are indistinguishable from outside. This repository has paid for that
    three times (UC-03's alpha-3 comparison, UC-03's unnameable sanctions codes,
    UC-04's dead gate) and DRIFT-075 is the fourth.

## 17. Known SPEC_DRIFT

---

### SPEC_DRIFT · DRIFT-001 · UC-01 audit-timing claim contradicts itself inside one document

**Original/documented behaviour:** `UC-01.md` §10 states a *"Known gap … not yet
fixed"*: `audit.log()` fires once at the very end of `handleVerificationTicket()`,
so a failed attempt leaves no `audit_log` row.
**Current implementation:** `src/uc01/workflow.js` STEP 7 calls
`audit.logDurable()` **before** the letter render and before any Zendesk action,
and the classifier's LLM attempt is traced independently via `logTraceStep()`.
**Current tests assume:** the durable-before-customer-facing ordering (write-
ordering tests) and per-attempt tracing.
**Difference:** §10's "known gap" paragraph is stale and is contradicted by §15's
own "Write ordering — **Real** (F-25)" row four screens below it.
**Evidence:** `docs/use-cases/UC-01.md` §10 vs. §15; `src/uc01/workflow.js` STEP 7.
**Likely reason:** F-25 was fixed and §15 updated; §10 was not.
**Risk if left as-is:** a reader trusts §10, believes failures are untraceable,
and re-investigates or re-builds tracing that exists.
**Recommendation:** RECONCILE — delete §10's stale paragraph.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · BUILT · recommendation taken.**
The paragraph beginning *"Known gap, tracked in `00-FOUNDATION.md` §4 invariant 7
(tracking issue #18), not yet fixed"* is **deleted from `docs/use-cases/UC-01.md`
§10 by this pass**, and replaced with a statement of what the code actually does,
naming the line that does it.

**This is the only finding in the UC-01 set that this pass closed in the code
tree, and the reason is worth stating.** Every other disposition here changes
behaviour and belongs in a build with its own tests. This one deletes a sentence
that says a gap exists which was closed months ago — verified, not assumed:
`src/uc01/workflow.js:247` calls `audit.logDurable()` at STEP 7, **before** the
letter render at STEP 7a and before any Zendesk action, and
`src/uc01/classifier.js:226` records `logTraceStep()` on **every** LLM attempt,
success or failure. So a failed attempt does leave a row, which is the exact
opposite of what §10 told its reader. Writing "DECIDED: delete it" while leaving
it in place is the failure mode this register exists to prevent.

---

### SPEC_DRIFT · DRIFT-002 · The n8n half of the live path is unverified, and the spec reads as if it is proven

**Original/documented behaviour:** §15 lists n8n orchestration as **Real**, and
`CLAUDE.md` records UC-01 fully green end to end (ticket #6).
**Current implementation:** unchanged code; the *deployed graph's* state is the
question. The Sandbox was reseeded and the employment id that green run used
(`fde4007b-…`) now 404s.
**Current tests assume:** nothing about deployment — the suite is hermetic.
**Difference:** `docs/LIVE-PATH-STATUS.md` marks three links **UNKNOWN**: the
deployed graph, the ticket→trigger→webhook hop, and therefore the n8n-written
`audit_log` row. The Node half is re-verified; the n8n half is not.
**Evidence:** `docs/LIVE-PATH-STATUS.md` §2; `CLAUDE.md` §4 "THAT GREEN RUN'S
EMPLOYMENT ID IS DEAD".
**Likely reason:** the Sandbox reseed invalidated the proof without invalidating
the code.
**Risk if left as-is:** a demo recorded against an unknown chain fails on camera;
worse, a real inbound ticket may be processed by a graph nobody has read back.
**Recommendation:** HUMAN_DECISION_REQUIRED — needs a session with live n8n
access (`npm run verify-live-uc01`, `npm run verify-deployed`), which this
container does not have.
**Confidence:** HIGH that the status is unknown; LOW on what is actually deployed.
**DISPOSITION — DECIDED 2026-08-20 · STANDING RULE · STILL UNVERIFIED.**
The n8n MCP **is** authorised on the owner's account. The finding is therefore not
"we lack access"; it is "a given session may not have it, and when that happens it
must not be absorbed into the work."

**Standing rule, from the owner: when n8n access is missing in a session, say so
at the top of the reply. Never bury it, never work around it, never record the
result as unknowable.**

**It came up in this session, which is why the rule exists.** The n8n MCP server
required authorisation here and its tools were unavailable, so neither
`npm run verify-deployed` nor `npm run verify-live-uc01` could be run, and the
three links `docs/LIVE-PATH-STATUS.md` §2 marks UNKNOWN stay UNKNOWN: the deployed
graph, the ticket→trigger→webhook hop, and the n8n-written `audit_log` row.

This is the third distinct way this repository has lost time to the same shape.
`CLAUDE.md` §4 records a `403` from n8n diagnosed twice wrongly — once as a
refused key, once as an absent key — before the real cause turned out to be
`NODE_USE_ENV_PROXY=1` missing from the invocation. **A tool that cannot reach a
service says nothing about the service.** An exit `2` means *I could not tell
you*, and the right response is to find a caller who can. The four `verify-*`
scripts exit `2` rather than `0` for exactly this reason — a skipped check must
never be readable as a passing one.

**PARTLY CLOSED 2026-08-20, minutes later — the owner reconnected n8n and the
first half ran.** `npm run verify-deployed`: **39 nodes checked · 0 drifted · 0
workflows with unpublished changes**, exit `0`. Graph `WORKFLOW_UC01_ID` reads
back **active**, with `versionId === activeVersionId` — the only comparison that
answers *"is this live?"*. So **every deployed Code node matches its `.js` file**,
including UC-01's `Render Letter`.

**That is the standing rule working, and it earned its keep inside one turn.**
The finding was reported at the top of a reply instead of absorbed; the owner
reconnected the server; the check ran. It also immediately produced two findings
that no hermetic test could have produced — DRIFT-085's evidence stopped being
inferred and became read back from the live graph, and **DRIFT-086 was found by
reading that graph's node list**.

**Still outstanding, and still not a build:** `verify-live-uc01`, and one real
ticket driven end to end. `docs/LIVE-PATH-STATUS.md` §2's three UNKNOWN links are
about the ticket→trigger→webhook hop and the n8n-written `audit_log` row, which a
node-body diff cannot answer. Every one of G-1…G-4 enlarges this, because each
requires a republish.

---

### SPEC_DRIFT · DRIFT-003 · `out_of_scope` is unobservable by design

**Original/documented behaviour:** §5d — *"reply with a polite boundary message,
create no case, write no audit."*
**Current implementation:** matches exactly (`workflow.js` STEP 5 returns before
any store or audit call).
**Current tests assume:** the same — a test asserts no case is created.
**Difference:** none between spec and code. The drift is between the design and
§11's metrics: an out-of-scope refusal rate cannot be measured, and a classifier
that starts wrongly labelling real requests `out_of_scope` would silently refuse
them with **no trace anywhere**.
**Evidence:** `src/uc01/workflow.js:125-130`; `UC-01.md` §11.
**Likely reason:** deliberate — "don't create records for things that aren't ours".
**Risk if left as-is:** a whole class of wrong refusals is invisible to the
metrics layer and to the audit viewer.
**Recommendation:** HUMAN_DECISION_REQUIRED — a counter or a trace-only row would
close it without creating a case; that is a design decision about what "create no
case" means.
**Confidence:** HIGH
**EXPLAINED 2026-08-20 · STILL OPEN.** The owner asked what this finding means.
Written plainly, without the term:

When the classifier decides a ticket is not a verification request at all — a
payroll question, a password reset, spam — UC-01 replies with a polite *"this
isn't something we handle here"* and then **stops**. It writes nothing. No case
row, no audit row, no ticket in any queue. That is deliberate and, for a genuine
password reset, it is right: creating a permanent record every time somebody
knocks on the wrong door would fill the tables with noise.

**The cost is that we cannot see it happen.**

Suppose the classifier starts getting it wrong — a prompt change, a model
upgrade, an unusual phrasing — and begins labelling real verification requests as
not-ours. Those people are refused. Correctly-formatted, polite, instant
refusals. And **there is no record anywhere that any of it occurred**: nothing in
the metrics dashboard, nothing in the audit viewer, nothing to count. The
exception-reason ranking in §11 cannot rank a reason that is never written down.
Nobody would find out from the system. They would find out from a complaint,
weeks later, and then have no trail to measure how many others there were.

Every other decision UC-01 makes is visible. This one is not, and it is the only
one that is invisible **by design** rather than by defect.

**Recommendation — write the refusal down without creating a case.** The two are
different things and the spec conflates them. A `case` says *somebody owns this
and it has a status that will change*; that is genuinely wrong for a password
reset. An `audit_trace` row says *this happened*; that is right for anything the
system decides. The concrete shape: one `logTraceStep({call: "uc01.out_of_scope",
…})` carrying the classifier's confidence and the first ~200 characters of the
ticket text, with **no** `cases` row, **no** `review_queue` row and **no**
`documents` row. §5d's *"create no case, write no audit"* becomes *"create no
case, write no decision row — trace it."*

The cost is one line in `src/uc01/workflow.js` before the STEP 5 return, its
mirror in `workflows/nodes/gates.js`, and a rate that can then be plotted. A
sudden climb in that rate is the alarm that does not exist today.

**Not decided.** It writes a row where the spec says write nothing, and the
owner's word decides whether that trade is worth making.

**DECIDED AND BUILT, 2026-08-22 (`rca-1bk`).** The trace-only row above is
exactly what shipped: `logStandaloneTraceStep({call:"uc01.out_of_scope"})` on
both paths, still zero `cases`/`review_queue`/`documents` rows.

**Then REVERSED for an unrelated reason, and then RATIFIED, both 2026-08-22.**
A separate defect surfaced once this branch existed: without a tag or a claim
row on `out_of_scope`, a misfiring Zendesk trigger could re-fire the same reply
indefinitely, and did — a real customer received 21 replies in 39 seconds,
stopped only by Zendesk's own 429. `rca-qdc`'s fix (commit `93884e7`) closed
that loop by moving the branch downstream of `Claim Ticket` and having
`Reply Out of Scope` apply the tag `uc01_out_of_scope_replied`, which the live
Zendesk trigger's `not_includes` list now names as its loop guard, plus one
`workflow_claims` row that makes the branch idempotent. That is a **reversal**
of this finding's own "still create no case, but write nothing tagged" answer,
not a refinement of it.

Put to the owner as bead `rca-jsv`, because reversing a decided-and-built
disposition is not something a builder may do unilaterally: **ratified as
filed.** The tag and the claim row stay — one tag and one claim row is a far
smaller cost than the loop they prevent. §6's decision-table row and the
`out_of_scope` row in this section's invariant table (above) are amended to
permit both; `qa/SPEC-DRIFT-INDEX.md`'s DRIFT-003 disposition carries the full
chain with the original decision left visible.

---

### SPEC_DRIFT · DRIFT-004 · The spec's §12.6 "non-English request" scenario has no distinct mechanism

**Original/documented behaviour:** §12 scenario 6 — *"Non-English / ambiguous
request → low confidence → review."*
**Current implementation:** there is no language detection anywhere. A non-English
request is handled only insofar as the classifier happens to return a lower
confidence.
**Current tests assume:** the ambiguous case, via a synthesised low confidence.
**Difference:** the scenario is stated as a capability and is really a hoped-for
side effect of the confidence gate.
**Evidence:** `src/uc01/classifier.js` — no locale handling; `test/uc01.test.js`.
**Likely reason:** never built; the confidence gate was assumed to cover it.
**Risk if left as-is:** a confidently-misread non-English request auto-resolves.
**Recommendation:** RECONCILE — restate §12.6 as "ambiguous request", and record
multilingual handling as unbuilt.
**Confidence:** MEDIUM
**ANSWERED 2026-08-20 · RECOMMENDATION STATED · STILL OPEN.** The owner asked
whether multilingual should simply be built, or whether this project does not
need it. It is two questions wearing one word, and they have opposite answers.

**Reading a request in another language: cheap, and worth doing.** The classifier
is already one LLM call returning structured JSON. One more field on that JSON
costs nothing measurable — no new call, no new dependency, no new service. It
closes this finding's actual stated risk, which is not that we cannot serve a
Dutch speaker; it is that **a confidently-misread non-English request
auto-resolves**. Today a Dutch request either happens to score low confidence, or
it does not, and if it does not the system issues an English letter to somebody
who did not ask in English. Nothing anywhere notices.

**Writing the letter in another language: expensive, and we should not.** The
letter is a legal attestation naming a Remote legal entity. A machine translation
of it is a legal attestation nobody has read. Remote's own standard-letter flow
offers **reviewed language templates** — a human-approved document per language,
which is the correct way to do this and is precisely the part we cannot
manufacture. Generating our own translations would put a second, unreviewed
wording of the same attestation into the world, which is DRIFT-076's problem
(two sources of one truth) with a liability attached.

**Recommendation — G-4: detect and route, never translate.**

1. `classifyRequest()` returns `language` (a BCP-47 primary subtag). One field on
   the existing JSON, plus the same field on the n8n port
   `workflows/nodes/validateClassification.js`, held by `test/n8nParity.test.js`.
2. A gate: if the language is **known** and we hold no reviewed template for it →
   `human_review / letter_language_unavailable`, and the ticket is tagged with the
   language so it routes to a specialist who reads it.
3. If the language is **unknown** — the rule-based fallback returns none — the
   language gate stays silent. It must not fire here: an LLM outage would
   otherwise stop every auto-resolution at once, which converts a degraded service
   into an outage. The confidence gate already owns the fallback case.
4. `LETTER_LANGUAGES` is `["en"]` today, because `src/uc01/letter.js` holds one
   template. Say that in §5 rather than implying more.

**The position this states is the interesting half**, and it is the one worth
defending in an interview: the system can *tell* it has been asked in Dutch, and
declines to *answer* in Dutch, because the thing being produced is a legal
document and we hold no Dutch text a lawyer has read. Knowing which half of a
capability to automate is the point.

**Not decided.** It adds a refusal reason, so it is a gate-behaviour change.

---

### SPEC_DRIFT · DRIFT-005 · PDF is specified, HTML is built

**Original/documented behaviour:** §5a and §13 task 5 — render the letter to PDF
via `pdf-service`.
**Current implementation:** `letter.js` renders HTML. `src/pdf/render.js` exists
and is injectable (`renderPdf`), but nothing in the live path passes it.
**Current tests assume:** HTML.
**Difference:** the customer receives HTML in a ticket comment, not a PDF
attachment. §15 says so honestly; §5 does not.
**Evidence:** `src/uc01/workflow.js` `renderPdf = undefined`; `src/pdf/`.
**Likely reason:** deliberate staging.
**Risk if left as-is:** low operationally; a bank asking for a PDF is a real
scenario the letter cannot satisfy.
**Recommendation:** KEEP_CURRENT and reconcile §5's wording.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · move to PDF, with the
boundary stated.** The owner's condition was *"if it will not cost a lot of
infrastructural changes."* It was measured rather than estimated, and the answer
splits: **cheap on one execution path, expensive on the other.**

**Cheap, and already sitting there.** `src/pdf/render.js` exports
`renderPdfFromHtml(html) -> Buffer`, deliberately generic and already tested.
`src/uc01/workflow.js:280` already has the injection seam — `renderPdf`, defaulting
to `undefined`. Chromium is pre-installed. `npm run pdf-demo` renders a real UC-01
letter today. Wiring it on the Node path is passing a function that exists into a
parameter that exists: **no new service, no new dependency, no new deployment.**

**Three real costs, and only the first is infrastructure.**

1. **The n8n path cannot render a PDF, and that is the expensive one.**
   `workflows/nodes/renderLetter.js` is a Code node assembling an HTML string. An
   n8n Code node cannot launch Playwright. Closing this needs either a deployed
   render service the graph calls over HTTP — genuinely new infrastructure — or
   the Node app as a hard dependency inside the ticket-intake path, which
   `CLAUDE.md` §5 already rejected for UC-06 and UC-08 on the grounds that it puts
   a singly-instanced process in the way of live traffic. **Neither is worth it
   for a file format.**
2. **Delivery.** `ZendeskClient` has no upload method — every call in
   `src/zendesk/restClient.js` is JSON. A PDF is an attachment:
   `POST /api/v2/uploads.json` with a binary body, then the returned token on the
   comment. One method with a content type unlike its neighbours. Bounded, and
   not infrastructure.
3. **Determinism, which is the one that would slip through.** `documents` stores
   `content` with a sha256 `content_hash`. Chromium stamps `/CreationDate` and a
   `/ID` into every PDF it emits, so rendering the same letter twice yields
   **different bytes**. If the PDF becomes the delivered artifact and is rendered
   on demand, *"the bytes delivered are the bytes recorded"* silently stops being
   true — while every test still passes, because the tests hash the HTML. **Render
   once, store the bytes, hash the bytes, serve the stored copy.** Never
   re-render for delivery.

**DECISION AMENDED 2026-08-20, later the same day — HTML is the artifact of
record; the PDF is a rendering of it, produced at download.** The first version of
this disposition made the **PDF** the artifact of record and the HTML a preview.
That was the wrong way round, and it was reversed after reading the live graph
(see DRIFT-086 below) and on the owner's prompt — *"if html will do better than
pdf, lets use it."* The inversion is recorded rather than quietly substituted,
because the reasoning for it is the useful part.

**Three reasons HTML is better here, none of them convenience:**

1. **Both execution paths can produce it.** An n8n Code node cannot launch
   Chromium. With PDF as the artifact of record, the live path is permanently
   incapable of producing the thing of record — and the content-parity test
   DRIFT-085 asks for could never pass in both directions, because one side would
   have nothing to compare.
2. **It is byte-deterministic.** Hash HTML and the hash is stable. Chromium stamps
   `/CreationDate` and a `/ID` into every PDF it emits, so a PDF artifact puts the
   integrity claim on bytes that change on every render — *"the bytes delivered
   are the bytes recorded"* would break silently while every test passed. Making
   the PDF **derived** removes the problem instead of managing it: nobody signs a
   derivative, so its unstable bytes stop mattering.
3. **`documents.content` is already a text column holding HTML.** No schema
   change, no new dependency, no new deployment.

**What gets built.** The letter is rendered as HTML, stored in `documents`,
hashed there, and posted as the ticket comment. A requester who needs a file for a
bank **downloads** it, and that is the only place `renderPdfFromHtml()` runs — on
the Node path, where Chromium already exists. The PDF is derived from the stored
HTML, never authoritative, and never the thing the hash is over.

**The principle this settles, stated once so the next use case does not
re-litigate it:**

> **The artifact of record is whatever a human signed. Where nobody signed, it is
> whatever both execution paths can produce identically.**

**So UC-03 is genuinely different, and its opposite decision stands.** DRIFT-016
chose PDF for the travel support letter because that letter carries a
**specialist's signature** — there the delivered file must be the signed file, and
the *"render once, store the bytes, hash the bytes, never re-render"* rule applies
to it exactly as written above. UC-01's standard letter is **auto-issued and
unsigned**, so it takes the other branch of the same rule. Two formats, one
principle, not an inconsistency.

**One argument that is not an argument for PDF.** `CLAUDE.md` records a real
production incident where `publicReply` silently escaped the letter and a customer
received literal `&lt;!doctype html&gt;` source. That was a **delivery** bug in one
Zendesk node parameter, already fixed with `jsonParameters: true` and
`comment.html_body`. It says nothing about which format should be stored.

**Still true, and unchanged by the inversion:** `src/pdf/render.js` stays generic
and serves both use cases; its header note that *"UC-03 was considered and
rejected: it's a thin router with no letter of its own"* is **stale** — UC-03 has
a letter now.

---

### SPEC_DRIFT · DRIFT-074 · No EOR-engagement gate: the letter asserts an employment relationship that does not exist

**Original/documented behaviour:** Remote blocks four classes from verification
letters — independent contractors, direct/HRIS (non-EOR) workers, incomplete
onboarding, and active offboarding/notice — because for the first two **Remote is
not the legal employer** and cannot attest to employment. The rule is stated in
Remote's own support documentation and independently corroborated; it is recorded
in `docs/research/Remote UC-01 …Deep-Dive Research.md` §1 as the platform's
programmatic blocking rules.
**Current implementation:** **no such gate exists.** `grep -i contractor
src/uc01/` returns nothing. `GATE_SEQUENCE` (`src/uc01/policyEngine.js:200`) runs
identity → employment status → third party → scope → artifacts → confidence →
completeness. Engagement type is never consulted. `src/uc01/letter.js:190` renders
*"This letter confirms that **X** is **employed by** \<entity\>"* and a row
*"Employer of Record: \<entity\>"* for whatever record it is handed.
**Current tests assume:** the gate does not exist; no test drives a contractor and
asserts a refusal.
**Difference:** for a contractor or a global-payroll employee the system issues a
document asserting an Employer-of-Record relationship that does not legally exist
— the precise outcome Remote's own product blocks.
**Evidence:** `src/uc01/policyEngine.js` `GATE_SEQUENCE`; `src/uc01/letter.js`
lines 190–205; `src/remote/mockServer.js:542–546` — Alexandre Tremblay,
`contract_type: "contractor"`, the file's own comment reading *"no employing
entity"*; three further fixtures typed `global_payroll_employee`. **This shipped
on the live path**: `CLAUDE.md` records ticket #6 auto-resolving and posting a
public letter for `fde4007b-…` — Tremblay, a contractor.
**Likely reason:** UC-01 was built from the *request-shape* taxonomy (standard /
custom / artifact / third party) and never from the *eligibility* taxonomy. The
demo employee was chosen for being alive in the Sandbox, not for being eligible,
and the two questions were never connected.
**Risk if left as-is:** a false attestation of legal employment sent to a bank,
landlord or immigration office, under a named Remote legal entity, with no human
in the loop. The letter is internally contradictory — the prose says *"employed
by"* while the table says *"Contract type: Contractor"* — which is worse for a
reader than either alone. This is the highest-severity finding in the UC-01 set
and it is a compliance defect, not a documentation gap.
**Recommendation:** RECONCILE — add the gate. Deterministic, first position,
fails closed on an unreadable engagement type. **But it changes live behaviour**
(requests that auto-resolve today would begin refusing), so the go-ahead is a
human decision, recorded in `../HUMAN-DECISIONS-REQUIRED.md`.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · G-1 · behaviour follows
Remote's documentation.** The owner's words: *"Let behaviour stick to Remote's
documentation."* That is the go-ahead this finding needed, and it settles the
question in the only direction that was ever defensible — Remote publishes which
engagements it will and will not attest to, and this system does not get its own
opinion about who Remote employs.

**What gets built.** A deterministic gate in **first position** in
`GATE_SEQUENCE`, ahead of identity, because eligibility is a property of the
record rather than of the requester and refusing it early means no employment
facts are read at all. Four refusal reasons, one per class Remote blocks, because
a single `not_eligible` would tell the specialist nothing:

| Class | Reason slug | Why Remote blocks it |
|---|---|---|
| Independent contractor | `engagement_not_eor_contractor` | Remote is not the legal employer; there is no employment to attest to |
| Direct / HRIS (non-EOR) employee | `engagement_not_eor_direct` | The client company employs them; Remote administers only |
| Onboarding incomplete | `engagement_onboarding_incomplete` | The relationship does not exist yet |
| Offboarding / notice | `engagement_offboarding` | Status is changing; a letter would be stale on arrival |

**Fails closed on an unreadable engagement type** — an absent or unrecognised
`contract_type` refuses rather than defaulting to eligible, for the reason
`normalizeEmployment()` already established: an unusable value must become a
refusal, never a guess.

**And no `documents` row is written on a refusal.** This is the actual control.
Refusing to *send* a bad letter still leaves the bad letter rendered, hashed and
stored — invariant 12 exists to stop that, and §16 evidence item 10 is what proves
it.

**One correction to this finding's own evidence, found while deciding it.** The
line *"This shipped on the live path"* is true that a contractor was auto-resolved
on ticket #6, and **wrong about what that letter said**. The live path runs
`workflows/nodes/renderLetter.js`, not `src/uc01/letter.js`, and the two render
materially different documents — the n8n one carries no *"is employed by"* prose
and no *Employer of Record* row at all. The false-attestation exposure on the
**Node** path is exactly as described here; on the **live** path it is smaller and
different. That divergence is itself a finding and is opened below as
**DRIFT-085**. The gate is required either way — issuing any verification document
for a contractor is what Remote blocks — but the severity sentence should name the
path it applies to.

**Gate-behaviour change.** `workflows/nodes/gates.js` moves with
`src/uc01/policyEngine.js` under `test/n8nParity.test.js`, then graph
`WORKFLOW_UC01_ID` is republished. Requests that auto-resolve today will begin
refusing — which is the point.

---

### SPEC_DRIFT · DRIFT-075 · The third-party consent path cannot succeed: `consent_records` is write-only and the live path hard-codes `false`

**Original/documented behaviour:** §12.5 of `docs/use-cases/UC-01.md` and the
identity service both specify a third party proceeding **only** on recorded
consent — `verifyRequester()` returns `third_party_with_consent` when
`consentOnRecord` is true and `third_party_missing_consent` when it is not.
Remote's own third-party channel works the same way: verification is provided
*"after receiving permission from the employee."*
**Current implementation:** `consentOnRecord` is a **boolean passed in on the
ticket**, never read from anywhere. `consent_records` exists as a Supabase table
and `caseStore.js:227` inserts into it, but **`grep "from consent_records"` across
`src/` returns zero hits — nothing ever reads it back.** The live Zendesk
normalizer hard-codes it: `src/zendesk/normalizeTicket.js:56`
`consentOnRecord: false, // no consent_records table yet — see BUILD-LOG.md
roadmap` — a comment that stopped being true when the table was provisioned. The
only callers that can set it `true` are the playground checkbox, the chat-demo
checkbox, `src/metrics/seed.js` and `src/review/cli.js`.
**Current tests assume:** the flag is an input. Both branches are tested, and both
pass, because tests supply the flag directly.
**Difference:** on the only production path, **no third-party request can ever
have consent.** Every real one escalates `third_party_missing_consent`, and the
consented branch — the one that produces the letter — is unreachable.
**Evidence:** `src/zendesk/normalizeTicket.js:56`; `src/shared/identity.js:33–54`;
`src/shared/caseStore.js:218–227`; absence of any `select` against
`consent_records`.
**Likely reason:** the flag was built as a seam for the demo surfaces before the
table existed; the table was added later for a different reason, and nothing
connected them. The stale comment then made the gap look already-known and
already-explained.
**Risk if left as-is:** the same failure shape this repository has paid for three
times — **a gate that refuses correctly and cannot succeed looks identical, from
outside, to a gate being appropriately cautious.** No negative test detects it. It
also means invariant 13 is unenforceable: there is no artifact to produce, because
a boolean is not evidence of consent.
**Recommendation:** RECONCILE — consent must be read from `consent_records`, and
the flag replaced by a lookup returning an artifact. **Product code**, so gated on
a human decision.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · G-3 · build the consent
surface, and consent comes from the employee themselves.** The owner's words:
*"there should be a UI where the employee can provide consent just for the
purposes of this demo. consent must come from the particular employee in
question."*

**That second sentence is the whole design, and it is stricter than the finding
asked for.** The recommendation above was "read the record instead of the flag" —
a storage fix. The owner's condition is an **identity** condition, and it is
prime directive #3 applied to a party the directive was never pointed at:
*identity comes from an authenticated signal, never a claim.* A checkbox someone
ticks on a form is a claim. Today the only surfaces that can set consent `true`
are a playground checkbox, a chat-demo checkbox, `src/metrics/seed.js` and
`src/review/cli.js` — **not one of them is the employee**. So consent, as
currently modelled, is a third party asserting that the person they are asking
about agreed. That is the shape of the problem, not a missing table.

**What gets built, in four parts:**

1. **A consent surface the employee signs in to**, on the same argument
   `src/remoteui/` already makes for UC-06: the employee authenticates as
   themselves, sees exactly what is being asked, by whom, about what, and grants
   or refuses. Only the named employee on the employment record can grant it —
   an employee cannot consent on another's behalf, which is the crossing
   `src/remoteui/roles.js` already refuses for its own three parties and is the
   pattern to copy rather than reinvent.
2. **A durable artifact, not a boolean.** `caseStore.js:227` already writes
   `consent_records`; **nothing reads it back** — `grep "from consent_records"`
   across `src/` returns zero. The lookup returns the row: who consented, to whom,
   to what and when. §16 evidence item 11 is what proves it, and it says
   explicitly that `consentOnRecord: true` with no row behind it does not satisfy
   the requirement.
3. **A pending state UC-01 does not have.** `awaiting_employee_consent` is not a
   refusal — the request is alive and waiting on a person. §6 already carries the
   row; the state machine does not. **Nothing is disclosed while it is pending,
   including whether the person exists**, because confirming that someone is an
   employee is itself a disclosure.
4. **Both normalizers, and this is the parity half that would be missed.** The
   hard-code is in **two** places, not one: `src/zendesk/normalizeTicket.js:56`
   and `workflows/nodes/normalizeTicket.js:47`, both `consentOnRecord: false`.
   Fixing only the first leaves the live path exactly as broken as it is now,
   and no hermetic test would notice.

**The comment attached to the hard-code is its own lesson.**
*"// no consent_records table yet — see BUILD-LOG.md roadmap"* stopped being true
when the table was provisioned, and then made the gap look already-known and
already-explained to every reader who passed it. A stale comment naming a reason
is worse than no comment: it stops the next person asking.

**Why this is the fourth instance of the repository's most expensive failure
shape.** A gate that refuses correctly and a gate that *cannot succeed* are
indistinguishable from outside. Both branches of the consent gate are tested and
both pass, because the tests supply the flag directly. Only a **positive**
production run detects it — §16 evidence item 12 — which is why that item exists
and why the refusal path alone proves nothing. UC-03's alpha-3 comparison,
UC-03's unnameable sanctions codes and UC-04's dead gate were the first three.

**Overlaps DRIFT-077**, ~~which has no disposition~~ **which was ANSWERED
2026-08-21** — build both surfaces, free-text compose box for the third-party
channel (`../HUMAN-DECISIONS-REQUIRED.md` §G3 line 2839; §17 DRIFT-077 here). The
overlap is unchanged by that answer: a consent surface is a third-party-adjacent
surface, and it does not by itself give UC-01 the Requests-tab branch that finding
also asks for. **The dependency runs the other way too, and it is the load-bearing
half** — DRIFT-077's answer is *gated* on this one, because until consent can be
read there is nothing for a third-party surface to succeed at. Build `G-3` first.

---

### SPEC_DRIFT · DRIFT-076 · UC-01 auto-issues the standard letter, duplicating a flow Remote already automated

**Original/documented behaviour:** `docs/use-cases/UC-01.md` §1's own framing
paragraph — *"Remote already lets employees self-generate a standard letter; the
CX automation opportunity is the operational handling of requests that enter
support"* — and `docs/INTAKE-RESEARCH.md` §6.5: *"UC-01 is not 'automate
employment verification letters', which Remote automated years ago."*
**Current implementation:** the `auto_resolve` branch renders and posts a
standard letter. It is the most-built, most-tested and only live-proven path in
the use case.
**Current tests assume:** auto-issue is the success condition. §16's evidence list
is built around it.
**Difference:** the spec says the standard case is out of scope; the build makes
it the headline. A request that could have been self-served instantly is
answered by a second, parallel letter-issuing system.
**Evidence:** `docs/use-cases/UC-01.md` §1; `docs/INTAKE-RESEARCH.md` §2 and §6.5;
`src/uc01/workflow.js`'s auto-resolve branch.
**Likely reason:** the auto-issue path is what makes a compelling demo, and it was
built first. The framing paragraph was written to guard against exactly this and
did not survive contact with the build.
**Risk if left as-is:** the portfolio's most visible claim is that it automated
something already automated. A reviewer who reads Remote's own help centre finds
this in a minute. Operationally it also means the letter Remote's product would
have issued and the letter this system issues can differ — two sources of the same
attestation.
**Recommendation:** HUMAN_DECISION_REQUIRED. Three live options: (a) keep
auto-issue and defend it as the fallback for people the self-serve path refused;
(b) deflect an eligible standard request to Remote's own flow and keep the letter
only for ineligible-but-serviceable cases; (c) keep auto-issue for the demo and
say plainly in the contract and README that it duplicates a solved flow.
**Confidence:** HIGH
**DISPOSITION — DECIDED 2026-08-20 · NOT YET BUILT · G-2 · option (b), which is
(a) once the deflection exists.** The owner set a rule rather than picking an
option: *"i dont want to solve what remote has already solved. but if it will cost
nothing, and it is not the main focus of this project you can leave the auto-issue
there. else just remove it."* Applied literally, and the two halves point the same
way once the condition is measured.

**Half one — does keeping it cost anything?** Nearly nothing. The auto-issue path
is built, tested, and the only live-proven path in the repository. Deleting it
would cost more than keeping it, and would remove the one thing that has ever run
end to end.

**Half two — is it the main focus?** Today, yes, and that is the finding. It is
the headline of the use case, the centre of §16's evidence list, and the thing a
reviewer sees first. So the owner's own condition — *keep it if it is not the main
focus* — is not satisfied by the system as it stands. **The condition is met by
demoting the path, not by deleting it.**

**What gets built: a deflection ahead of the letter, not a deletion of it.** An
eligible EOR employee asking for the **plain standard letter** is answered with
Remote's own Requests-tab flow, which serves them in seconds rather than issuing a
second parallel copy. Everyone that flow refuses — and everyone asking for
anything other than the plain standard letter — reaches the auto-issue path
exactly as today. New outcome: `deflected_to_self_service`.

**This is why G-1 and G-2 are one piece of work.** "Is this person eligible for a
letter at all?" and "could this person have served themselves?" are the *same*
engagement, status and onboarding facts asked twice. G-1 reads them to refuse;
G-2 reads them to redirect. Building either alone is incoherent: G-1 without G-2
leaves the duplication untouched, and G-2 without G-1 deflects the very people who
**cannot** self-serve back into the flow that just refused them — which would be a
worse outcome than today's.

**And the result is a better argument than the one it replaces.** Auto-issue
stops being *"we automated employment letters"*, which Remote automated years ago
and any reviewer finds in a minute in Remote's help centre, and becomes *"we
detect the requests Remote's own flow will not serve, and serve exactly those."*
That is `docs/INTAKE-RESEARCH.md` §6.5's position built rather than asserted, and
it is the JD's second criterion — being as comfortable making the case against
automating something as building it — expressed as a gate instead of a paragraph.

**Gate-behaviour change**, with the same n8n parity and republish obligation as
G-1. The demo consequence is worth stating plainly: after this lands, the
happy-path demo is a **deflection**, and the letter is what an *exception* gets.
§16's evidence list moves with it.

---

### SPEC_DRIFT · DRIFT-077 · UC-01 has no Remote-side intake surface, so it cannot be demonstrated from where it starts

**Original/documented behaviour:** `src/portal/README.md` §1 states the principle
the portal exists for — *"in the real product those requests begin **inside
Remote**, not inside Zendesk"* — and `docs/INTAKE-RESEARCH.md` §2 documents
UC-01's true starting points precisely: the Requests tab for both letter branches,
and `lifecycle-support@remote.com` for the third-party one.
**Current implementation:** `src/portal/requestTypes.js` holds **seven** types —
UC-02, 03, 04, 05, 07, 08, 09. UC-01 and UC-06 are absent; UC-06 has
`src/remoteui/` instead. UC-01 has no Remote-side surface of any kind, and no
third-party surface at all. Its demo surfaces (`playground`, `chatdemo`,
`livedemo`) all begin at a Zendesk ticket, i.e. at step 3 of a three-step flow.
**Current tests assume:** nothing — there is no surface to test.
**Difference:** the use case with the best-documented real-world intake is the one
that cannot be shown starting. UC-03 issues a *travel* letter and has a portal
form; UC-01 issues an *employment* letter and does not.
**Evidence:** `src/portal/requestTypes.js:59–226`; `src/portal/README.md` §1;
`docs/INTAKE-RESEARCH.md` §2.
**Likely reason:** the portal was built to give the seven use cases with **no
entry point** one; UC-01 was excluded because it already had three. But all three
begin downstream of where the request is actually made.
**Risk if left as-is:** the argument the repository makes about two-door intake is
demonstrated for eight use cases and asserted for the ninth. It also means the
consent round-trip (DRIFT-075) has nowhere to be shown even once it works.
**Recommendation:** HUMAN_DECISION_REQUIRED — build a Requests-tab branch for
UC-01 and a deliberately unauthenticated third-party surface standing in for the
mailbox, on the same argument `src/remoteui/` already makes for UC-06; or accept
the gap and say so in §13. A design question sits inside the first option: the
real third-party channel is a **mailbox**, so a clean structured form would
flatter reality and hand the classifier input the real channel never provides.
**Confidence:** HIGH
~~**STILL OPEN 2026-08-20 · NO DISPOSITION GIVEN.** The owner dispositioned
`DRIFT-001`…`DRIFT-005`, `DRIFT-074`, `DRIFT-075` and `DRIFT-076`. This one was not
in that list, and it is recorded as open rather than inferred from its
neighbours.~~ **Superseded 2026-08-21 by the disposition below.** Kept struck
rather than deleted: it records the state this contract was written in, and the
reason the answer was not inferred from its neighbours at the time.

**DISPOSITION — DECIDED 2026-08-21 · NOT YET BUILT · build both surfaces, with a
free-text compose box for the third-party channel.** The recommendation above was
taken in full. Recorded in `../HUMAN-DECISIONS-REQUIRED.md` §G3, line 2839 —
*"✅ ANSWERED 2026-08-21 — the recommendation, taken: build both, with the
free-text compose box for the third-party channel. Still gated on `G1`."* **Its
gate is satisfied:** `G1`/DRIFT-075 was itself answered 2026-08-20, at line 2701
of the same file — build a consent surface, consent must come from the named
employee, and the pending state discloses nothing while pending. So the decision
stands rather than waiting on anything.

**What was decided, in four parts.**

1. **Both surfaces are built** — a Requests-tab branch for the two letter channels,
   and a third-party door standing in for `lifecycle-support@remote.com` — on the
   same argument `src/remoteui/` already makes for UC-06. That argument is
   **stronger here than it was there**: `docs/INTAKE-RESEARCH.md` §6.5.1 records the
   employment verification letter as `❌` in all four columns — no create, no read,
   no decide, **zero** webhooks — where UC-06's `POST /v1/contract-amendments`
   turned out to exist after all. Where Remote publishes nothing at all, a stand-in
   is the only way to demonstrate the flow from where it really starts — rung 3 of
   the substitution ladder, and self-identifying about what it stands in for.
2. **The third-party channel gets a free-text compose box, not a structured form**,
   and this is the more interesting half. A form *"quietly flatters reality"*: it
   hands the classifier structured input the real channel never provides, so the
   demo proves an easier problem than the one that exists. The real channel is a
   **mailbox**, and a bank's verification request is prose written by someone with
   no knowledge of our schema. Exercising the classifier against that is exercising
   it against the actual job.
3. **The third-party door is its own surface, not a persona on the existing
   portal.** The portal authenticates a persona; the whole point of this door is
   that the person on the other side is **not** authenticated. It is also what
   makes the identity problem visible: on a structured form the refusal looks like
   validation, and in a compose box it looks like what it is — prime directive #3
   refusing an unauthenticated stranger's claim about someone else's employment.
4. **Where the Remote-side branch lands:** `src/portal/requestTypes.js` gains
   UC-01, and UC-06 alongside it per `D10` in the same register.

**`G1` genuinely gates the third-party half, and the gate is not a formality.**
Until the consent lookup `G-3` specifies exists, there is nothing for that surface
to *succeed* at: every request would refuse, correctly, and the surface would
demonstrate only its own failure path. That is the dead-gate shape this repository
has now met four times, and the same trap `[M-2]` and `[A-10]` were written to
avoid elsewhere — **the positive path must be reachable before the surface is
worth building.** So the order is `G-3` first, then the third-party door.

**What it demonstrates that nothing else in this repository does**, and it is a
demo asset rather than only a gap closed: a genuinely two-sided flow — the bank
asks → **nothing is disclosed, not even that the person exists** → the employee is
asked for consent in *My requests* → they grant or refuse → only then does a
specialist decide. **The refusal case is the more instructive of the two**, and it
is the one a reviewer will remember, because the system's correct behaviour there
is to produce nothing at all.

**This carries no gate-behaviour number of its own, and a later reader should not
mint one.** `G-1`…`G-4` are changes to what the system *decides*; this is a surface
that runs the gates already specified and then creates the pre-tagged Zendesk
ticket, in the ordering `src/remoteui/` establishes so a ticket failure can never
erase a decision already made. The gate it depends on is **`G-3`**, already
numbered.

**The design argument that was open is now closed, and is kept here because it is
the reasoning, not the verdict.** The real channel is a **mailbox** —
`lifecycle-support@remote.com`. A clean structured form would hand the classifier
well-formed input the real channel never provides, and the resulting demo would
prove the system works on exactly the input it will never receive. That is the
same shape as fixtures written to agree with the code, which `CLAUDE.md` §4 records
as the reason twenty-one defects stayed invisible through a green suite. The
compose box is what the answer chose.

**Part of it was already forced by G-3, and that half is unchanged.** DRIFT-075's
answer requires a surface where the **employee** authenticates and grants consent,
which is a Remote-side surface UC-01 does not have today. So the "UC-01 has no
Remote-side surface" half stops being true the moment G-3 is built.

**And the Requests-tab branch matters more after `G-2` than before it** — the
argument was made while this finding was still open and it survives the answer
unchanged, now as a reason the decision was the right one rather than a reason to
decide. `G-2` deflects an eligible employee to Remote's own Requests-tab flow.
**A deflection whose destination cannot be shown is a deflection a demo cannot
demonstrate**, so building `G-2` without this surface would leave the new happy
path ending off-screen.

**Still `NOT YET BUILT`, and a decision does not close a finding.** Neither surface
exists. §13's two *"does not exist"* rows and §4's statement that Zendesk is the
only implemented entry point are both still true of the tree today; the drift is
live.

---

## 17b. Opened by the decision session

---

### SPEC_DRIFT · DRIFT-085 · The two execution paths issue materially different letters, and no test compares them

**Original/documented behaviour:** one letter. §5a, §13 and every reader of this
contract treat *the* verification letter as a single document with a single
field list, and `docs/N8N-MAPPING.md` presents the n8n graph as a 1:1 port of
`src/uc01/workflow.js`.
**Current implementation:** two documents.

| | `src/uc01/letter.js` (Node path) | `workflows/nodes/renderLetter.js` (live Zendesk path) |
|---|---|---|
| Attestation prose | *"This letter confirms that **X** is **employed by** \<entity\>… issued upon the employee's request"* | none — *"To whom it may concern,"* and straight into the table |
| Employing entity | named, twice | **absent** |
| Employer of Record row | present | **absent** |
| Job title | present when known | absent |
| On probation | present | absent |
| Confidentiality paragraph | present | absent |
| Closing | signature block | *"Issued automatically on \<date\>."* |
| Rows | 7 | 4 |

**Current tests assume:** nothing about this. `test/n8nParity.test.js` holds the
**gates** in parity and compiles `renderLetter.js`; it never compares the two
rendered documents. The suite is green and has always been green.
**Difference:** the letter every reviewer reads, every test exercises and this
contract describes is **not** the letter a real customer received. Ticket #6's
public reply came from the four-row body.
**Evidence:** `src/uc01/letter.js:185–215`; `workflows/nodes/renderLetter.js`
lines 16–28; `test/n8nParity.test.js:290` (a compile check in a filename list, not
a content comparison). `verify-deployed` reports 39 nodes and 0 drifted, so the
deployed body **is** this file.
**Likely reason:** the n8n node was written first, as a minimal port to get a
graph running, and `letter.js` grew afterwards — the entity, the attestation
sentence, the confidentiality paragraph and the probation row are all additions
the port never received. The parity test was built for the gates, where
divergence changes a *decision*, and a letter's wording did not look like the
same category of risk.
**Risk if left as-is:** three, and they compound.
1. **The contract describes a document the live path does not produce.** Anyone
   reasoning about what a customer received is reasoning about the wrong file.
2. **It moves DRIFT-074's severity between paths.** The Node letter asserts
   *"employed by \<entity\>"* and carries an *Employer of Record* row — the false
   attestation exactly as that finding states. The live letter asserts neither: it
   prints *"Contract type: Contractor"* and stops. The Node path's exposure is as
   written; the live path's is smaller and of a different kind. A finding that
   cites one file and then says "this shipped live" conflates two documents.
3. **The no-salary guarantee is enforced twice, independently.** Both bodies are
   whitelists and neither can leak compensation — so the guarantee holds. But it
   holds by two separate mechanisms that nothing compares, which is the same shape
   as the gates before `n8nParity` existed.

**Evidence upgraded 2026-08-20 — this is now read back from the live graph, not
inferred.** `npm run verify-deployed` reports **39 nodes · 0 drifted**, so the
deployed `Render Letter` node is byte-identical to
`workflows/nodes/renderLetter.js`. The four-row document is what production sends.

**RECOMMENDATION — RECONCILE, in three steps, and the order is load-bearing.**

| | Step | Why here |
|---|---|---|
| **1** | Extend `test/n8nParity.test.js` to render **both** bodies from one fixture and compare their **facts** — the same field set, the same whitelist, the same absences. Not byte equality: the markup differs legitimately | **It fails on day one, and that failure is the finding made mechanical.** Without it, any convergence drifts again the first time somebody edits one file and not the other — which is exactly how the two got here |
| **2** | Add the missing `documents` write to the graph: `Render Letter → Persist Document → Reply + Solve Ticket` | **The bigger half, and not what this finding originally said.** See DRIFT-086 — the live path stores no copy of the document it sends. Placed *before* the outward action, the same ordering rule `Append Audit Log` already follows |
| **3** | Bring the four-row node up to `letter.js`'s content | It cannot be a paste: the Code node has no template literals, no imports and no entity lookup. Which is precisely why step 1 comes first |

**Do step 3 after G-1.** Once the engagement gate lands, a contractor reaches
neither renderer — which removes the sharpest instance of the divergence and
changes what the two documents need to agree about.

**Step 1 is worth doing whatever else is decided.** Steps 2 and 3 depend on the
format decision and on G-1; a test that compares two documents' facts depends on
neither, and it is the only thing that stops this recurring.

**And the format decision makes step 3 reachable rather than harder.** With HTML
as the artifact of record (DRIFT-005, amended), both renderers produce the same
kind of thing and a fact-level comparison is meaningful. Had the PDF stayed the
artifact of record, one side of this parity test would have had nothing to
produce.
**Confidence:** HIGH on the divergence; HIGH that no test compares them; **HIGH
that the deployed body is the one described** (read back 2026-08-20).

---

### SPEC_DRIFT · DRIFT-086 · The live path posts the letter to a customer and stores no copy of it

**Original/documented behaviour:** §10 of `docs/use-cases/UC-01.md` names
`documents` as one of four tables and describes it as *"one row per generated
artifact (currently just the letter): `case_id`, `type`, `content` (the HTML), a
sha256 `content_hash`, `created_at`."* §8's invariant 12 and §16's evidence item
10 both turn on that row existing — the control is that a refusal writes **no**
`documents` row, which presupposes that a success writes one.
**Current implementation:** true on the Node path, **false on the live one.**
`src/uc01/workflow.js` STEP 7b writes the row and hashes the content. The
deployed n8n graph does not.

**Read live from graph `WORKFLOW_UC01_ID` on 2026-08-20** (active,
`versionId === activeVersionId`), 24 nodes. Five Supabase nodes, and their tables:

| Node | Table |
|---|---|
| `Claim Ticket (Idempotency)` | `workflow_claims` |
| `Append Audit Log` | `audit_log` |
| `Append Audit Trace` | `audit_trace` |
| `Persist Case` | `cases` |
| `Queue for Specialist Review` | `review_queue` |

`documents` appears **zero times in the entire deployed workflow JSON.** The
auto-resolve branch is `Route by Decision → Render Letter → Reply + Solve Ticket`
— nothing between those two nodes and nothing after.

**Current tests assume:** the Node path's behaviour. `test/n8nParity.test.js`
compares **gates**, so no test anywhere asserts that the graph persists what it
sends.
**Difference:** on the only path that has ever run in production, UC-01 renders a
document asserting a person's employment, **posts it publicly to a customer, and
keeps no copy, no hash and no row.** The document exists in exactly one place
afterwards: a Zendesk comment.
**Evidence:** live `get_workflow_details` on `WORKFLOW_UC01_ID`, 2026-08-20 —
node list, Supabase `tableId` parameters, and `Render Letter`'s single outgoing
connection to `Reply + Solve Ticket`. `src/uc01/workflow.js` STEP 7b for the
contrast. `docs/use-cases/UC-01.md` §10 for the promise.
**Likely reason:** the graph was built branch by branch, and the auto-resolve
branch's obvious job is *reply and solve*. `Persist Case` and `Queue for
Specialist Review` were added later — `CLAUDE.md` records that the graph *"never
wrote the two tables the sidebar reads"* until it was fixed — and `documents` was
not in that pass because nothing in the sidebar reads it.
**Risk if left as-is:** three, in increasing order of seriousness.
1. **The audit trail is incomplete for the one artifact that leaves the
   building.** `audit_log` records that a letter was issued; nothing records
   *what it said*. Reconstructing a disputed letter means reading a Zendesk
   comment, if it still exists.
2. **Invariant 12 is half-enforceable.** *"No `documents` row on a refusal"* is
   trivially satisfied by a path that writes no `documents` row on **anything**.
   The control passes for the wrong reason, which is the same shape as a gate
   that refuses correctly and cannot succeed.
3. **It is the sharper half of DRIFT-085.** That finding asks which of two
   documents is right. This one observes that the one production actually sends
   is not kept at all — so there is nothing to compare it against after the fact,
   and no hash that could prove what a customer received.

**Recommendation:** RECONCILE — `Render Letter → Persist Document → Reply + Solve
Ticket`, a Supabase row-create against `documents` carrying `case_id`, `type`,
`content` and a sha256 of the content, placed **before** the outward action for
the same reason `Append Audit Log` is: a Zendesk failure must never erase the
record of what was produced. This is step 2 of DRIFT-085's recommendation and is
listed there too, so neither can be built without meeting the other.

**Do it after the format decision, not before.** With HTML as the artifact of
record (DRIFT-005, amended), the row stores exactly the bytes the comment
carries and the hash is stable — the Code node needs no Chromium and no new
infrastructure. Had the PDF stayed the artifact of record, this node could not
have been built in n8n at all, which is the strongest single argument the format
decision produced.
**Confidence:** HIGH — read from the deployed graph, not from the repository.

---

## 18. Build queue

**Everything decided in §17 and §17b, in the order it should be built, with the
files, the tests and the done-criterion for each.** §1–§16 describe the target;
this section is how you get there. **Nothing here is built.**

**Why this section exists, written 2026-08-21.** UC-01 and UC-03 were the last
two decided use cases without one. Their changes were numbered inside their §17
dispositions — `G-1`…`G-4` here, `G-A`…`G-C` there — which is enough to know
*what* was decided and not enough to know *in what order*, and the ordering in
this use case turns out to carry the single most consequential fact in the queue:
**after Step 3 lands, the only end-to-end demo this repository has ever run in
production stops working.** That is not a reason to reorder anything; it is a
reason to know it before it happens rather than on camera.

### Numbering

The gate changes keep their existing names `G-1`…`G-4` — they are cited from
`docs/use-cases/UC-01.md`, `qa/SPEC-DRIFT-INDEX.md` and this contract's own
decision box, and renaming them would break every one of those citations for no
gain. **The build items are prefixed `V-`**, and where a `V-` item *is* a gate
change it names the `G-` it carries. `V-` is a tenth scheme and corresponds to
none of the other nine, for the reason `CLAUDE.md` §7 item 20 gives: this
repository already has two registers both numbering findings `C-N` with code
citing both, and a reader following a citation into the wrong register lands on a
confident, specific, entirely unrelated finding.

> **Standing rules that apply to every step below**, so they are not repeated in
> each one:
>
> - **The gates exist twice.** `src/uc01/policyEngine.js` and
>   `workflows/nodes/gates.js`. `test/n8nParity.test.js` executes the n8n body in
>   a `node:vm` sandbox against the **real** functions. A gate changed in one
>   place is a gate that disagrees with itself.
> - **The normalizers exist twice too**, and that is the half this use case
>   actually loses: `src/zendesk/normalizeTicket.js` and
>   `workflows/nodes/normalizeTicket.js` both hard-code `consentOnRecord: false`.
>   Nothing hermetic compares them.
> - **Every gate change ends in a republish** of graph `WORKFLOW_UC01_ID`, and
>   the only thing that answers *"is this live?"* is `versionId ===
>   activeVersionId`. `mcp__n8n__update_workflow` writes a **draft**; REST `PUT`
>   publishes in place. `npm run verify-deployed` afterwards. §7b's standing
>   authorisation covers the deploy; it does not cover skipping the proof.
> - **A green n8n execution proves nothing** if a node was pinned. Check the
>   destination table, never the run status.
> - **Positive tests, not only negative ones.** For every step, one test that
>   says *this input MUST succeed*. G-3's consent gate is this repository's
>   **fourth** structurally-dead gate; both its branches are tested today and
>   both pass, because the tests supply the flag directly.
> - **No real customer data.** Sandbox and mock only, consent artifacts included.

---

### Step 0 · Three measurements, before any code

All three are read-only and two of them **change the plan**, which is why they
are first. All three need credentials this container does not hold.

| # | Question | How | What it decides |
|---|---|---|---|
| **M-1** | How many live Sandbox employments carry each engagement class — EOR, contractor, direct/HRIS, onboarding-incomplete, offboarding? | `GET /v1/employments`, group by `contract_type` and `status` | Whether each of `G-1`'s **four** refusal branches can be demonstrated at all. Two are already known to exist (Alex Morgan, EOR/USA; Alexandre Tremblay, `contractor_of_record`/CAN). **If the Sandbox holds no direct/HRIS, no onboarding-incomplete and no offboarding record, those three branches ship having never executed** — the dead-gate shape for the fifth time, and the answer is a marked rung-4 fixture per the substitution ladder, not a branch nobody ran |
| **M-2** | Does `consent_records` hold a single row? | `select count(*) from consent_records` | Whether `G-3`'s lookup can be built against real data or whether the surface must come first. `caseStore.js:191–195` writes the table and **nothing anywhere reads it back** |
| **M-3** | What does Remote publish about the Requests-tab self-serve letter flow — is there a URL, a deep link, or a documented entry point a deflection can **name**? | Rung 1: `developer.remote.com`, Remote's `llms.txt`, `support.remote.com` (cite-and-link only) | Whether `G-2` is a deflection or a refusal wearing a friendlier word. **A deflection that cannot name its destination is the second thing.** If Remote publishes no addressable entry point, `G-2`'s copy has to say *"your Requests tab"* in words rather than link, and §16's evidence item for it changes shape |

**Done when:** all three answers are written into DRIFT-074, DRIFT-075 and
DRIFT-076 with the date they were measured, and `M-1`'s per-class counts are in
the table above rather than in a commit message.

---

### Step 1 · `V-1` — the letter fact-parity test, before anything else

**This is DRIFT-085 step 1, and it is worth doing whatever else is decided.** It
depends on no decision in this queue, it fails on day one, and it is the only
thing that stops the divergence recurring the first time somebody edits one
renderer and not the other — which is exactly how the two got here.

| | |
|---|---|
| **Behaviour** | No product behaviour changes. A test renders **both** bodies from one fixture and compares their **facts**: the same field set, the same whitelist, the same absences. Not byte equality — the markup differs legitimately |
| **Files** | `test/n8nParity.test.js` only. Today `:290` compiles `renderLetter.js` inside a filename list; it never compares output |
| **Tests** | The new comparison **must fail on the first run** — 7 rows against 4, an attestation sentence on one side and not the other, an *Employer of Record* row on one side and not the other. A version of this test that passes immediately is testing the wrong thing |
| **Done when** | The test exists, fails, and its failure output is the DRIFT-085 table rendered by machine rather than by hand. Mark it skipped with the finding id in the skip reason if it must not block CI before Step 5 |

**Do not "fix" the failure by deleting fields from `letter.js`.** The convergence
direction is decided in Step 5 and it is upward, not downward.

---

### Step 2 · `V-2` — the live path stores the letter it sends

**DRIFT-086, which is DRIFT-085's step 2 and the sharper half of it.** The
deployed graph posts a document asserting a person's employment to a customer and
keeps no copy, no hash and no row. `documents` appears **zero times** in the
entire deployed workflow JSON.

| | |
|---|---|
| **Behaviour** | `Render Letter → Persist Document → Reply + Solve Ticket`. A Supabase row-create against `documents` carrying `case_id`, `type`, `content` and a sha256 of the content, placed **before** the outward action — the same ordering rule `Append Audit Log` already follows, for the same reason: a Zendesk failure must never erase the record of what was produced |
| **Files** | The n8n graph `WORKFLOW_UC01_ID` (a new Supabase node and two connection edits). No `src/` change — `src/uc01/workflow.js` STEP 7b already does this on the Node path |
| **Canvas position** | The new node sits **on the spine**, not below it. §6's fan-out gotcha: n8n orders a fan-out by canvas position and a must-not-lose write placed downstream of a branch that can fail is a write that silently does not happen |
| **Tests** | Hermetic tests cannot see this. The proof is a **real unpinned execution** with a row count of exactly 1 in `documents` for that `case_id`, and the stored `content_hash` matching a sha256 of the posted comment body |
| **Done when** | Invariant 12 (*no `documents` row on a refusal*) stops being satisfied vacuously by a path that writes no `documents` row on **anything**, and §16 evidence item 10 is provable on the live path |

**Reachable only because HTML is the artifact of record.** Had the PDF stayed
authoritative (DRIFT-005 before its amendment), this node could not have been
built in n8n at all — a Code node cannot launch Chromium. That is the strongest
single argument the format decision produced, and it is why this step sits after
the decision and not before it.

---

### Step 3 · `V-3` + `V-4` — `G-1` and `G-2` together, as one unit of work

**They read the same data twice and are incoherent apart.** *"Is this person
eligible for a letter at all?"* (`G-1`) and *"could this person have served
themselves?"* (`G-2`) are the same engagement, status and onboarding facts asked
two ways. `G-1` alone leaves the duplication untouched; `G-2` alone deflects the
very people who **cannot** self-serve straight back into the flow that refused
them, which is worse than today.

#### `V-3` · `G-1` — engagement eligibility, first position, fails closed

| | |
|---|---|
| **Behaviour** | A deterministic gate in **first position** in `GATE_SEQUENCE` (`src/uc01/policyEngine.js:200`), ahead of identity — eligibility is a property of the record, not of the requester, and refusing early means no employment facts are read at all. Four refusal reasons: `engagement_not_eor_contractor`, `engagement_not_eor_direct`, `engagement_onboarding_incomplete`, `engagement_offboarding`. A single `not_eligible` would tell the specialist nothing |
| **Fails closed** | An absent or unrecognised `contract_type` **refuses**, never defaults to eligible — the rule `normalizeEmployment()` already established: an unusable value becomes a refusal, never a guess |
| **And writes no `documents` row** | This is the actual control. Refusing to *send* a bad letter still leaves the bad letter rendered, hashed and stored |
| **Files** | `src/uc01/policyEngine.js` (gate, four reasons, gate-ladder entries, plain-language strings) · `workflows/nodes/gates.js` · `src/uc01/workflow.js` (the no-`documents`-on-refusal path) · `docs/ESCALATION-DESTINATIONS.md` if any of the four routes somewhere new |
| **Tests** | `test/uc01*.test.js` — **one positive test per class** (this contractor MUST refuse with *this* slug), plus an eligible EOR record that MUST still reach the letter · `test/n8nParity.test.js` green across both bodies · a test that a refusal writes no `documents` row |
| **Done when** | A contractor cannot obtain any verification document by any path, each of the four classes refuses under its own name, parity is green, and graph `WORKFLOW_UC01_ID` is republished and verified |

#### `V-4` · `G-2` — deflect the plain standard letter to Remote's own flow

| | |
|---|---|
| **Behaviour** | An **eligible EOR employee** asking for the **plain standard letter** is answered with Remote's own Requests-tab flow, which serves them in seconds. New outcome: `deflected_to_self_service`. Everyone that flow refuses — and everyone asking for anything other than the plain standard letter — reaches auto-issue exactly as today |
| **Auto-issue is demoted, not deleted** | The owner's rule was *"i dont want to solve what remote has already solved. but if it will cost nothing, and it is not the main focus of this project you can leave the auto-issue there."* Both halves point the same way: keeping it costs nothing and it **is** the main focus today, so the condition is met by demoting the path |
| **Files** | `src/uc01/policyEngine.js` · `workflows/nodes/gates.js` · the reply copy on both paths (`src/uc01/letter.js`'s caller and `workflows/nodes/renderLetter.js`'s branch) · `zaf-app/assets/panels.js` if the sidebar shows the new outcome |
| **Copy depends on `M-3`** | If Remote publishes an addressable entry point, name it. If not, the copy describes the destination in the employee's own words and the deflection still stands — but say which, rather than implying a link exists |
| **Tests** | A positive test that an eligible EOR standard request is **deflected**; a positive test that an eligible EOR *non-standard* request still reaches the letter; a test that a `G-1` refusal is **never** deflected |
| **Done when** | The happy path is a deflection, the letter is what an exception gets, and no request refused by `G-1` is redirected into the flow that refused it |

#### The demo consequence, stated plainly because it lands on camera

**Both live-proven demo tickets used a contractor.** `CLAUDE.md` records tickets
#3–#6 auto-resolving for Alexandre Tremblay — `contract_type:
contractor_of_record`, and `src/livedemo/employees.js:55–61` still lists him.
After `V-3`, that request **refuses**, correctly. After `V-4`, the other listed
employee — Alex Morgan, EOR/USA, `:48–52` — asking for the plain standard letter
is **deflected**, also correctly. So the auto-issue demo needs a **third** shape:
an eligible EOR employee asking for something the self-serve flow will not serve.

That shape is exactly what `docs/INTAKE-RESEARCH.md` §6.5 says the use case is
*for*, so the demo gets better rather than worse — but it has to be built, and
§16's evidence list moves with it. **Do this in the same unit of work as
`V-4`**, not after: a queue that lands a correct behaviour change and leaves the
demo broken has produced a regression by every measure a reviewer applies.

---

### Step 4 · `V-5` — `G-3`, consent read from an artifact the employee signed

**The finding asked for a storage fix; the owner's condition made it an identity
condition**, and that is prime directive #3 applied to a party the directive was
never pointed at. Today the only surfaces that can set `consentOnRecord: true`
are a playground checkbox, a chat-demo checkbox, `src/metrics/seed.js` and
`src/review/cli.js` — **not one of them is the employee.**

Four parts, and part 4 is the one that gets missed:

| | Part | Files |
|---|---|---|
| **1** | **A consent surface the employee signs in to** — authenticates as themselves, sees who is asking, about what, and grants or refuses. Only the named employee on the employment record may grant it. `src/remoteui/roles.js` already refuses exactly this crossing for its own three parties and is the pattern to copy, not reinvent | new surface, modelled on `src/remoteui/` |
| **2** | **A durable artifact, not a boolean.** The lookup returns the row: who consented, to whom, to what, when | `src/shared/caseStore.js` (a read against `consent_records` — there is none today) · `src/shared/identity.js:33–54` |
| **3** | **A pending state UC-01 does not have** — `awaiting_employee_consent`, not a refusal: the request is alive and waiting on a person. **Nothing is disclosed while it is pending, including whether the person exists**, because confirming that someone is an employee is itself a disclosure | `src/uc01/policyEngine.js` · `workflows/nodes/gates.js` · `src/uc01/workflow.js` |
| **4** | **Both normalizers.** `src/zendesk/normalizeTicket.js:56` and `workflows/nodes/normalizeTicket.js:47`. Fixing only the first leaves the live path exactly as broken as it is now, **and no hermetic test would notice** | both files |

| | |
|---|---|
| **Tests** | A **positive** test: a third-party request with a real `consent_records` row MUST reach the letter. The refusal path alone proves nothing — both branches pass today and the consented branch is unreachable in production · a test that `consentOnRecord: true` with **no row behind it** does not satisfy the gate · a test that an employee cannot consent on another's behalf · parity across both normalizers |
| **Done when** | §16 evidence items 11 and 12 are provable, and a real third-party request has completed the consent round-trip end to end at least once |

**Delete the comment, not just the value.** *"// no consent_records table yet —
see BUILD-LOG.md roadmap"* stopped being true when the table was provisioned, and
then made the gap look already-known and already-explained to every reader who
passed it. **A stale comment naming a reason is worse than no comment: it stops
the next person asking.**

**This forces half of DRIFT-077.** A surface where the employee authenticates
*is* a Remote-side surface, so *"UC-01 has no Remote-side surface"* stops being
true here. The Requests-tab branch and the third-party mailbox stand-in remain
undecided — see Step 7.

---

### Step 5 · `V-6` — converge the two renderers, after `G-1`

**DRIFT-085 step 3, and it is placed here deliberately.** Once the engagement
gate lands, a contractor reaches neither renderer — which removes the sharpest
instance of the divergence and changes what the two documents need to agree
about.

| | |
|---|---|
| **Behaviour** | The four-row n8n body comes up to `src/uc01/letter.js`'s content: attestation prose, employing entity, Employer of Record row, job title, probation, confidentiality paragraph, signature block |
| **Not a paste** | The Code node has no template literals, no imports and no entity lookup. Which is precisely why `V-1` comes first: without a fact-level comparison there is no definition of "converged" |
| **Files** | `workflows/nodes/renderLetter.js` · graph republish |
| **Tests** | `V-1`'s comparison goes green, and is un-skipped if it was skipped |
| **Done when** | Both paths render the same facts, the no-salary guarantee is still enforced by **both** whitelists independently, and `verify-deployed` reports 0 drifted |

---

### Step 6 · `V-7` — the PDF, at download only

**DRIFT-005 as amended: HTML is the artifact of record; the PDF is a rendering of
it, produced at download.**

| | |
|---|---|
| **Behaviour** | The letter is rendered as HTML, stored in `documents`, hashed there, posted as the ticket comment. A requester who needs a file for a bank **downloads** it, and that is the only place `renderPdfFromHtml()` runs — on the Node path, where Chromium already exists |
| **Files** | `src/uc01/workflow.js:280` already has the seam (`renderPdf`, defaulting to `undefined`) · `src/pdf/render.js` is already generic and tested · a download route · `src/zendesk/restClient.js` **only if** the PDF is ever delivered as an attachment, which needs `POST /api/v2/uploads.json` and a binary body unlike every other call in that file |
| **The trap** | Chromium stamps `/CreationDate` and a `/ID` into every PDF, so the same letter rendered twice yields **different bytes**. The PDF is **derived** — nobody signed it, so its unstable bytes stop mattering. **Never hash the PDF, never make it the thing of record** |
| **Done when** | A stored letter can be downloaded as a PDF whose content matches the stored HTML, and the `content_hash` is still over the HTML |
| **Correction owed in the same unit of work** | `src/pdf/render.js`'s header note that *"UC-03 was considered and rejected: it's a thin router with no letter of its own"* is **stale** — UC-03 has a letter now |

---

### Step 7 · What is still OPEN and must be decided before it can be queued

None of these has a disposition. They are listed so a builder does not mistake
silence for permission.

| # | Question | State |
|---|---|---|
| **DRIFT-003** | Should an `out_of_scope` refusal leave a trace? | Recommendation stated in the finding. **Nobody has chosen** |
| **DRIFT-004** / `G-4` | Letter language — detect and route, or state the non-goal? | Recommendation stated (**detect and route, never machine-translate**). **Nobody has chosen.** If chosen, it is a gate change with the same parity-and-republish obligation as `V-3` |
| **DRIFT-077** | The Requests-tab branch, and the third-party surface | Half forced by `V-5`. The sharper half is undecided and is a **design** question: the real third-party channel is a **mailbox**, so a clean structured form would flatter reality and hand the classifier well-formed input the real channel never provides — the same shape as fixtures written to agree with the code |

---

### Step 8 · Sync the status, last

Only after each step lands, and **in the same unit of work as the step**:

- §17's dispositions here gain a `BUILT` line, dated, naming the commit.
- `qa/SPEC-DRIFT-INDEX.md` rows move from *not yet built* to *done*, and the
  count line is **re-measured, not incremented** — that headline has already
  drifted once, by twenty-five rows.
- `docs/use-cases/UC-01.md` §5, §6, §12 and §15 move with the behaviour;
  §16's evidence list moves with `V-4`.
- `docs/BUILD-LOG.md` gains a §3.x write-up, and `CLAUDE.md` §4/§5/§7 are synced
  in the **same** unit of work — the continuity rule at the top of `CLAUDE.md`,
  which this repository has already paid for twice.

---

### What must NOT change, and why a builder might reasonably think otherwise

1. **Do not delete the auto-issue path** as part of `V-4`. The decision was
   option (b), which is option (a) once the deflection exists — auto-issue stays
   as the fallback for everyone Remote's own flow refuses. It is also the only
   thing in this repository that has ever run end to end.
2. **Do not move the engagement gate out of first position** to "save an API
   call". Eligibility is a property of the record; refusing early is what
   guarantees no employment facts are read for someone not entitled to have them
   read.
3. **Do not satisfy `G-3` with a checkbox on a nicer form.** A checkbox someone
   ticks is a claim. The whole content of the decision is that consent comes from
   an authenticated employee, not from the party asking about them.
4. **Do not make the PDF the artifact of record**, however much a bank wants a
   file. That inversion was live for part of one day and was reversed for three
   reasons, and the second one — byte-determinism — breaks silently while every
   test passes.
5. **Do not "fix" `V-1`'s day-one failure by trimming `letter.js`.** The
   convergence direction is upward. The n8n body is the one missing content.
6. **Do not subscribe UC-01 to a Remote intake event.** There is none — that is
   DRIFT-077's premise and it is the *opposite* of UC-03's DRIFT-084, where the
   door exists and we are not standing at it. The two look identical in a status
   table and are different findings.
