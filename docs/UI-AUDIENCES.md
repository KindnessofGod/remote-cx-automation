# Who each screen is for, and what may go on it

**For anyone about to add, keep or remove a row on any surface in this repo.**

| | |
|---|---|
| **Written** | 2026-08-20 |
| **Verified against** | the code at `27d4b51`, and the commits named in §4 (`58eb1cc`, `af07de0`, `27d4b51`) read out of `git show` |
| **Evidence tags** | `[CONFIRMED]` read from a file or a diff in this repository · `[INFERRED]` argued from something confirmed · `[UNVERIFIED]` stated as an open question, not as a fact |

This is not a style guide and it is not about visual design. It is about **one
decision, made hundreds of times**: this fact is true and I could print it — may
I? [`WHY-THIS-SHAPE.md`](WHY-THIS-SHAPE.md) answers *why the system is built
this way*; [`SIDEBAR-APPROVAL-ROLES.md`](SIDEBAR-APPROVAL-ROLES.md) answers *who
is being asked to act in the sidebar*. This one answers *who is reading, and
what has earned its place in front of them*.

---

## 0. Why this document exists

The project owner has given the same correction **three times, about three
different screens**, in escalating frustration. Verbatim, oldest first:

> **1.** "All your Zendesk bars are made for the person building, not the person
> using it. Look at each from the stakeholder's perspective: what would they need
> in each bar to make their job easier?"

> **2.** "We are supposed to implement it, not tell Remote how they do their
> thing."

> **3.** "This info is useless to the user. Stop littering info all over the UI
> that is useless to my user. I already told you exactly to design all my UI as if
> you were the employee, for employee-facing UI; admin, for admin-facing UI; or
> specialist. The info that you need should be on there, why the ones you don't
> need should be? I don't think that is too hard to ask."

Each time, the **instance** was fixed and the **rule** was not written down, so
the next pass started from zero and re-broke it on a different screen. A rule
given three times and re-broken three times is not a rule anybody forgot — it is
a rule that lived only in a conversation, and this repository's own continuity
rule (`CLAUDE.md`, top) says exactly what happens to those.

The commit that produced the third correction says so in its own message:
*"Each time the instance was fixed and the rule was not written down, so the next
pass started from zero. It is being written down separately, as
docs/UI-AUDIENCES.md."* `[CONFIRMED — git log -1 27d4b51]` This is that file.

**Why the failure is so easy to make.** Every one of the three deletions below
removed something **true**, **sourced**, and **correct**. Nothing was wrong. That
is the whole difficulty: the ordinary defensive habit of this repository — *is
this claim accurate? is it cited? does it overstate?* — passes every one of them.
Accuracy is not the test being failed. **Relevance to the reader is**, and
nothing in the codebase was checking it.

---

## 1. The surfaces, and who reads each one

Established by reading each module's own header, not by assuming. Several state
their audience explicitly; where one does not, the evidence column says what the
row was derived from instead.

| Surface | Reader | How that was established |
|---|---|---|
| **`src/portal/`** (`npm run portal`, `/portal`) | **The employee/requester**, and for two use cases **a company admin** filing on an employee's behalf | `personas.js` holds **8 personas: 7 `kind: "employee"` and 1 `kind: "company_admin"`** ("Jane Doe (company admin)", who "files workation and payroll-adjustment requests for the company's own employees"). `server.js`'s header: *"Every trigger in this system starts as a person asking for something."* `[CONFIRMED]` |
| **`zaf-app/`** (the Zendesk sidebar) | **The specialist**, inside a ticket | `zaf-app/README.md`: *"It is the 🟡 human-in-the-loop gate made clickable: for the ticket an agent is looking at, it shows what the automation decided and why."* `main.js`'s header: *"the 🟡 human-in-the-loop gate, as a thing an agent can actually click."* `[CONFIRMED]` |
| **The Zendesk ticket body** raised by the portal | **The specialist**, before they open the sidebar | `src/portal/server.js` `buildTicketNote()` — its own section headings are *"What a human controls here"*, *"What happened"*, *"The decision so far"*, *"What the checks reported"*, and a separate *"For operators"* block. `[CONFIRMED]` |
| **`src/remoteui/`** (`npm run remoteui`) | **The company admin** who requests an amendment — plus the **employee** and the **employer** who consent to it | `roles.js` `ROLES = {company_admin, employer, employee}`; `server.js`'s header: *"UC-06's real trigger is a customer admin acting inside Remote's own product."* Three separate server-authorized sessions, three separate forms. `[CONFIRMED]` |
| **`src/approvalqueue/`** (`npm run queue-ui`, `/queue`) | **Operations** — the person who owns whether work is moving | `server.js`'s header: *"its headline is deliberately not the queue but the STUCK LIST — the items awaiting a human with no reachable place to be approved."* `[CONFIRMED]` |
| **`src/auditview/`** (`npm run audit-ui`, `/audit`) | **Operations and engineering** — whoever is auditing a decision or a bug | `server.js`'s header: *"a live feed of decisions as they land, a drill-down from any decision to every LLM/API attempt underneath it, a bug-audit lookup by external ref."* `[CONFIRMED]` |
| **`src/uc0N/server.js`** ×9 | **Programs, not people** — the sidebar loaders, the portal, `curl` | `src/uc04/server.js`'s header: *"reachable via curl/Postman/a future panel"*; the sidebar reads these through `apiBaseUrl`/`ucNNApiBaseUrl`. `[CONFIRMED]` |
| **`src/metrics/`** (`npm run metrics`) | **CX leadership** | `compute.js`'s header, first line: *"Turn case/review rows into the numbers CX leadership decides on."* `[CONFIRMED]` |
| **`src/playground/`, `src/chatdemo/`, `src/livedemo/`, `src/dashboard/`** | **Us** — demo and testing aids, honestly labelled as such in `CLAUDE.md` §4 | `dashboard/server.js`'s header describes a viewer over the nine APIs; `CLAUDE.md` §4 calls the chat demo *"a demo/testing aid, not a submission deliverable"* `[CONFIRMED]` |

**The last row is the only one where the builder is the reader**, and it is worth
naming for that reason: those four surfaces are the *only* place in this repo
where "I want to see that the model actually ran" is a legitimate thing to put on
a screen. Everywhere else it is somebody else's screen.

---

## 2. What each reader actually wants to know

Few enough to be usable as a test. Derived from what each surface is **for** —
the module headers quoted above — not from a survey.

**The employee / requester** (portal, and the pop-up on their result)

1. What happened to *my* request — yes, no, or someone is looking at it?
2. Is anything waiting on **me**? Do I have to do something next?
3. If a document was produced for me, where do I get it?
4. Did anything get read wrong, such that I should check it?
5. Who has it now, and roughly when do I hear back?

**The company admin** (portal's admin persona, `src/remoteui/`)

1. Was my request accepted, and what is it now waiting on?
2. Which of my employees is this about, and are the facts about them right?
3. Whose signature is still outstanding?
4. Is there a deadline I am about to miss?

**The specialist** (ZAF sidebar, and the ticket body they open first)

1. **Who is this about?** — a name, not a UUID.
2. What am I being asked to decide, and am I the right person to decide it?
3. What did the system check, what did it conclude, and **on what evidence**?
4. **What did it not check** — what is unverified, unsourced, or absent?
5. What happens the moment I click? What does it change?
6. If I am asked afterwards why I approved this, what do I point at?

**Operations** (approval queue)

1. What is waiting on a human, and for how long?
2. What is waiting on a human **who cannot reach it** — and why not?
3. Whose queue does each stuck item belong in?

**Engineering / audit** (audit viewer, `audit_log`, `audit_trace`)

1. What was decided, by whom or by what, when, and under which reference?
2. Every attempt underneath that decision — what ran, what failed, what retried.
3. Did anything happen twice?

Everything a reader is shown should map to a number on their own list. If you
cannot say which number, that is the finding.

---

## 3. The rule

> **A fact earns its place on a surface by answering one of that reader's
> questions. Being true is not the qualification.**

Two tests. Apply them in this order, because the second one is what stops the
first from doing damage.

### The deletion test

For the row you are about to add or keep, on the surface it will appear on:

> **Would this reader do something different because of it — decide differently,
> check something, act, wait, or defend the decision afterwards?**

If the honest answer is no, it was written for the person building. Two
diagnostic phrasings that catch most of it:

- **"It is here to settle an argument."** If the row exists because *we* wanted
  proof the model was running, the retry fired, or the gate was reached, it is
  our question on their page. `27d4b51`'s comment says it in one line: *"It was
  put there to settle an argument about whether the model was running, which is
  the builder's question, not theirs."* `[CONFIRMED]`
- **"It explains our engineering, or their own product, back to them."** Our API
  surface, our fallback mechanism, our schema, our missing endpoint — and equally,
  a numbered walkthrough of Remote's own product printed for a Remote employee.
  Correction #2 is exactly this, from a support tool, which reads as
  condescension rather than help.

### The routing test — run it **before** deleting anything

> **Is this fact useless to *this* reader, or useless to *everyone*?**

Almost every interesting case is the first. The fix there is **route it, not
delete it**: move it to the surface whose reader has a use for it, and leave it
off the one whose reader does not. §4's first example is exactly this — the same
fact is silent for the requester and still printed for the specialist, out of one
function, so the two can never drift.

**Deleting a fact that some reader needs, in the name of tidiness, is a worse
defect than the litter it removes** — see §5, which is not optional reading.

### The registry version of the rule, already in the code

`src/shared/employeeSubject.js` implements this as a data structure rather than
a habit, and it is the pattern to copy:

> *"EACH USE CASE CHOOSES ITS OWN FIELDS, and that is the point of the registry
> below rather than a fixed block of nine rows everywhere. A travel-letter signer
> and an off-cycle-payment approver need different facts about the same person."*

and, on the same file:

> *"MONEY IS NOT AUTOMATICALLY RELEVANT. No field in this registry reads pay,
> hours or currency, and no caller can ask for one, because the registry is a
> closed set and an unknown key throws at call time."* `[CONFIRMED]`

That is the rule made unbreakable rather than remembered: the fields a reader may
be shown are enumerated, and asking for one outside the set is an error rather
than a paragraph.

---

## 4. The three corrections, as worked examples

The abstract version of this rule is unfalsifiable. These are checkable.

### (a) Correction #3 — a fact the employee could do nothing with

**Surface:** the portal's result pop-up, after a UC-03 travel request.
**Commit:** `27d4b51`, *"An employee was told an AI had read their words, which is
not a fact they can do anything with"*.

**Before** — `describeReader()` returned a sentence for the requester in all three
cases:

| `classification.source` | Sentence shown to the requester |
|---|---|
| `llm` | *"An AI language model read your request in your own words; the trip details below are what it understood."* |
| `rule_based_fallback` | *"The AI model could not be reached, so your request was read by a fixed list of keywords instead; the trip details below are what that reading produced."* |
| anything else | *"This request does not record what read it, so this page will not tell you either way."* |

**After** — two of the three are `null`, and the surviving one says what to **do**:

| `classification.source` | Sentence shown to the requester |
|---|---|
| `llm` | *(none)* |
| `rule_based_fallback` | *"Please check the trip details below — some of them may have been read incorrectly."* |
| anything else | *(none)* |

**The reasoning, in the function's own comment** `[CONFIRMED — src/portal/server.js]`:

> *"`sentence` goes to the requester's pop-up, and for a NORMAL reading it is
> null — deliberately. 'An AI language model read your request' tells an employee
> nothing they can do anything about; the trip details are printed directly
> beneath it either way, and they would check those or not check them regardless
> of what produced them."*

Note what the degraded case keeps and what it drops: it **names no model, no
fallback and no infrastructure**. It is advice, not an incident report. And the
unrecorded case is silent because *our own bookkeeping gap is not their problem*.

**This is also the clearest routing case in the repo.** The same function returns
a second field, `row`, and that one was untouched:

> *"`row` goes to the specialist. It reaches them through the facts table, which
> is also what the Zendesk ticket body renders, and there it earns its place: a
> specialist deciding whether to trust an extracted destination needs to know
> whether a model or a keyword list produced it."*

`row` still reads *"an AI language model"* / *"a fixed list of keywords, because
the AI model could not be reached"* / *"not recorded"*. **One fact, two audiences,
one function, routed rather than deleted** — and because both halves come out of
one place, the requester's wording and the specialist's can never drift.

### (b) Correction #1 — rows on the sidebar that only a builder needed

**Surface:** the ZAF sidebar, all nine panels.
**Commit:** `58eb1cc`, *"The panel opens on a person, not on thirty-six hexadecimal
characters"*. The owner, on the same pass: *"I never even saw any relevant info of
the employee — not even name. That is bad."*

**The test that commit applied to every row on all nine panels**, quoted from its
own message: *"would this row change what the specialist does, or help them defend
the decision afterwards? If neither, it was written for the person building."*
That is the deletion test, and it is question 6 on the specialist's list in §2.

What came off, verbatim from the diff of `zaf-app/assets/panels.js` `[CONFIRMED]`:

| Panel | Rows removed | Why they were litter *here* |
|---|---|---|
| UC-02 | `{ label: "Decision" }`, `{ label: "Reason" }`, `{ label: "Decided by" }`, `{ label: "Flags" }`, `{ label: "State" }` | *"The outcome badge in the header is the decision, the WHY card is the reason in words with the audit slug beneath it, the collapsed provenance block is 'Decided by gate 4 — Expense ownership' AND the flag codes… Every one of them was a second copy that could only ever agree or be wrong."* |
| UC-03 | `Decision`, `Reason`, `Flags` | *"The badge, the WHY card with its slug, and the provenance block each say one of them, and say more than a row can."* |
| UC-05 | `Decision`, `Reason` | same note |
| UC-06 | `{ label: "Admin approval", value: … "Approved by " … : "Pending" }` and its `Payroll approval` twin | *"'Admin approval: Pending' is a fourth statement of a fact three richer ones already carry"* — the role block names the role, what it decides, whether the slot is recorded or outstanding, who filled it and when; the meter counts them. |
| UC-09 | `Approval slots required`, `Decision`, `Flags` | *"This is the payment screen, so a bare number that agrees with three other numbers is worse here than anywhere: a reader who spots the fourth copy has to work out whether it is a fourth fact."* |
| UC-07 · **added 2026-08-21** | — | **Two additions rather than a trim.** Every requester-supplied gate input must be labelled **self-declared, unverified** wherever it is shown, including on the drafted paperwork (`R-15`) — a specialist who retypes a declaration into Remote as though it were verified was misled by our page, not by the requester. And a replayed Sandbox fact must carry its **capture date above the findings**, not beneath them: the 2026-08-20 disclaimer defect is the precedent, where the framing sentence *was* on the page at character 4,735 of 5,293. **Present and unreadable is a different failure from absent, and it is not a better one.** Both are §5 exemption-class statements — limits and absences, never trimmed for relevance. |
| UC-07 | its nine `HIGH · UC07_…` flag chips (kept the rows that carry the **message**) | the chips printed the severity and code with no message, directly under the mandatory research disclaimer — the codes appeared twice and the useless copy was on top. |

One rename in the same commit is the rule applied to a **label** rather than a row:

- **Before:** `{ label: "AI confidence", value: percent(cls.confidence) }`
- **After:** `{ label: "Confidence in the reading of the request", value: percent(cls.confidence) }`
- **Because:** *"Confidence in WHAT was the question a reader had to answer for
  themselves."* Same number, same source; the old label made the reader do work.

And a row that was **added**, because the rule cuts both ways: the panel now opens
on `renderEmployee()` — name, job title, status, contract type, country of
employment — at a measured cost of 180–230px per panel, *"reported rather than
buried"*. The commit's own before/after table shows five of ten panels getting
**longer**. Deletion is not the goal; **answering question 1 is**.

The removal that best shows the difference between litter and noise is the slug
one: `global_mobility_review` and `cross_border_tax_inquiry` were printed as the
lead sentence of the two 🔴 panels — and *"neither of these is in `audit_log`, in
the metrics exception ranking, or in the n8n ports"*, because `main.js` invented
them. Every other panel's slug **stays** beside its prose, precisely because those
are the exact strings somebody searches by. Identical-looking rows; opposite
verdicts; the difference is whether a reader can do anything with it.

### (c) Correction #2 — explaining Remote's product, and our own, to a traveller

**Surface:** the portal's UC-03 result, after a `route_to_uc04` routing.
**Commit:** `af07de0`, *"A routing interrupts, and stops explaining Remote's
product to Remote"*.

**Before** — `FILE_IT_IN_REMOTE` in `src/portal/uc03Continuation.js` `[CONFIRMED —
git show af07de0^]`, rendered in a block headed **"Your next step"** at the very
bottom of the panel, below the gate ladder and the facts table:

> **headline:** "Only you can raise the work authorization itself, and it happens in Remote — not here."
> **steps:**
> 1. "In Remote, go to Requests → New request → Remote Work Authorization, and complete the form."
> 2. "It goes to your HR admin or manager first — that is the employer's approval stage."
> 3. "Only after that does it reach Remote's own team for the immigration, tax and social-security review."
> 4. "File it at least two weeks before you travel; that is Remote's own stated notice period."
>
> **whyNotHere:** "No API creates a work-authorization request — not ours, not anyone's. Remote publishes list, show and update operations for it and no create at all, and the object's own description says it is submitted by an employee. What this page does next is prepare the EMPLOYER's half…"

Every sentence was sourced — steps 1 and 4 from Remote's own words, steps 2 and 3
from the status enum, tagged `[CONFIRMED — schema]`.

**After** — `WORK_AUTHORIZATION_NOTICE`, at the **top**, in a real `<dialog>`:

> **headline:** "Working from another country needs authorization"
> **sentence:** "Continuing carries your trip details across and asks you for the things a travel request never states; nothing is submitted until you send that form."
> **action:** "Start the work authorization" · **dismiss:** "Not now"

**Two separate faults, and the commit separates them** `[CONFIRMED — git log -1 af07de0]`:

1. **Position.** *"A `route_to_uc04` is not a finding about the trip, it is a
   REDIRECTION — and the panel announced it at the very bottom… The one person
   who can unblock the request was the one person who would never scroll to the
   button."*
2. **Content.** *"The steps narrate Remote's own product back to a Remote employee
   who uses it every week, from a support tool, which reads as condescension
   rather than help; the API paragraph is OUR engineering constraint, explained
   to a traveller."*

**The line this draws, and it is the most portable thing in this document:**

> **Statements about *our own* behaviour stay. Instruction about Remote's product,
> and exposition about our API surface, go.**

What survived on the page: no work-authorization case was created, nothing was
sent anywhere, the destination the router read and the confidence it read it with,
what continuing does and does not do — *"those are how a requester knows whether
anything is waiting on them"*, i.e. question 2 in §2.

The same sweep hit `NATIONALITY_IS_ASKED`, which is the clearest small instance:

- **Before:** *"Remote's employment record carries no nationality, citizenship or
  passport field — checked against `GET /v1/employments/{employment_id}`'s schema,
  which has zero occurrences of any of the three, and against Remote's own
  work-authorization object, which has none either. So this is asked rather than
  filled in for you: a guess here would move the visa and permanent-establishment
  assessment without anybody having said it."*
- **After:** *"Your employment record does not hold nationality, so this is asked
  rather than filled in for you — a guess here would move the visa and
  permanent-establishment assessment without anybody having said it."*

The **evidence** — which schema, which endpoint, how many occurrences — moved into
the comment directly above the constant, where the next engineer looks for it. The
**answer to the question a blank box raises** — *nothing was guessed on your
behalf, this one is yours* — stayed on the page. Nothing was lost; it was routed.

And `af07de0` reported three more sentences of the same kind that were outside its
own file boundary rather than reaching across to fix them:
`src/uc03/policyEngine.js`'s routing narration, `src/uc04/requestLink.js` (line 169 as reported by that commit), and
`src/shared/groupAssignment.js` (line 150 as reported), *"which tells a traveller to run a repo
script."* `[CONFIRMED — git log -1 af07de0]` Whether all three are still there is
**[UNVERIFIED]** here: source files are being edited concurrently by other agents
and this pass reads rather than changes them.

---

## 5. What must never be stripped in the name of tidiness

**Read this section before acting on §3.** An over-zealous reading of the deletion
rule does more damage than the litter it removes, because litter is annoying and a
missing limitation is a specialist acting on false completeness — which is the
failure this entire system exists to prevent.

Four classes are **exempt from the deletion test**. They stay on the surface even
when a reader would rather not read them.

### 5.1 Statements of a limit or an absence

*"No source has been read."* *"Nothing here confirms the employee is still active
today."* *"The amount could not be compared."* These look like litter — they add no
value, they answer nothing — and they are the opposite. **A blank is read as
nothing to report; a stated absence is read as nothing to rely on.**

This is already a construction rule in the code, not an aspiration.
`src/shared/employeeSubject.js` `[CONFIRMED]`:

> *"AN ABSENCE IS NEVER A BLANK, AND NEVER THE ID RELABELLED. Five states, not
> two… `not_found` — Remote answered 404, an answer ABOUT the record;
> `unavailable` — 403/5xx/transport, NOTHING about this person is known…
> a specialist reading a name that quietly failed to load is worse served than one
> told it could not be fetched."*

And in `src/uc04/decisionFacts.js`, on the home country stated on a request:

> *"It is not read from the Remote employment record and is never compared to it,
> so a wrong country here is not caught anywhere."* `[CONFIRMED]`

That sentence is pure limitation. It tells the specialist nothing about the trip.
It is also the only thing standing between them and trusting a field nothing
validates — and `58eb1cc` noted that it *"was unusable as a warning while the
record's country was nowhere on the page"*, which is the right fix: **make the
limitation actionable, never quieter.**

`58eb1cc` also names the one legitimate compromise, and its shape matters: on
UC-04 the `basis.requester` notes run to ~1,500 characters and *"five of them state
an ABSENCE, which is the one class this page must not fold away lightly"*. So the
**values stay open** and the **absences go behind a single disclosure that counts
them** — *"every note is still on the page, verbatim, pinned by test."* Collapsing
with a count is a layout decision. Removal is not available.

### 5.2 The mandatory disclaimers

`src/shared/disclaimer.js` holds three, and they are appended in one place *"so no
use case can 'forget' it"* `[CONFIRMED]` — `travel`, `tax` and `mobility`. On the
two 🔴 dossiers the framing sentence is *"verbatim, exactly once, open, never
inside a `<details>`, above every heading of the analysis"*, and `58eb1cc` records
its exact character position before and after that pass to prove it did not move.
The "Who this is about" card was deliberately placed **below** it: *"the framing
says what the document is, the person is who it concerns."* `[CONFIRMED]`

A disclaimer fails the deletion test on its face — no reader acts differently
because of it — and it is not up for the test. It is what stops a preliminary
summary being read as advice.

### 5.3 The named team a case was routed to

`src/shared/escalationRouting.js`: *"An escalation that nobody owns is a slower way
of dropping the case"*, and *"EVERY TEAM BELOW COMES FROM ITS USE CASE'S OWN SPEC,
cited on the row… an owning team invented here would be a fact about Remote's org
that this repository has no standing to assert."* `[CONFIRMED]`

Naming the team answers question 5 for the requester (*who has it now*) and
question 3 for operations (*whose queue*). And the approval queue exists precisely
because **36 correct, durable, audited decisions reached nobody**
(`FOR-CX-LEADERS.md` §3). The team name is the thread that makes that findable.

### 5.4 Anything a reader would use to defend the decision afterwards

Question 6 on the specialist's list. The audit slug, the deciding gate and its
position in the ladder, the flag codes, the source of each finding. `58eb1cc` kept
every panel's slug beside its prose *"precisely because it is the exact string in
`audit_log`, in the metrics exception ranking and in the n8n ports — the thing
somebody searches by"*, and removed only the two slugs **no server emits**. That is
the distinction to hold: a provenance handle a reader can follow is not litter; an
invented one is worse than litter, because it is a dead end wearing a citation's
clothes.

**The compression that is always allowed:** move the *evidence* into the comment
next to the code and keep the *claim* on the page — §4(c)'s nationality note is
the worked example. **The compression that is never allowed:** drop the claim
because the evidence was long.

---

## 6. The structural trap: one array, two audiences

`src/portal/server.js` builds a `details` array — `{label, value}` rows — for every
submission. **It is rendered twice, to two different readers.** `[CONFIRMED]`

1. **On the employee's own result page.** `src/portal/assets/app.js` calls
   `detailTable(withoutRepeatOf(payload.details, …))` — an open table, not
   collapsed.
2. **In the body of the Zendesk ticket a specialist opens.**
   `buildTicketNote()` (`src/portal/server.js`) reads the *same* array:
   `const details = env.details ?? []`.

The file says so about itself, in three separate places:

> *"The same hole reached further than the page: `details` is what
> `buildTicketNote()` writes into the Zendesk internal note, so the specialist
> opening the hand-off got the slug too."* `[CONFIRMED]` — the import comment above the four gate modules in `src/portal/server.js`

**So a row added to `details` lands on both surfaces, and a row deleted from
`details` disappears from both.** Neither is what you usually want, and there is no
compile error either way. This is the single most likely place to break the rule by
accident: an engineer applying §3 for the employee silently removes a fact the
specialist needed, and an engineer adding a fact for the specialist silently
litters the employee's page.

**The routing hooks that already exist**, and they are thin `[CONFIRMED]`:

```js
const OPS_ONLY_DETAILS = new Set(["Narrative faithfulness"]);   // → the "For operators" block only
const LEAD_DETAIL = "What happened";                            // → promoted to the top of the note
```

`buildTicketNote()` then partitions by label:

```js
const lead          = details.find((d) => d.label === LEAD_DETAIL) ?? null;
const forSpecialist = details.filter((d) => d !== lead && !OPS_ONLY_DETAILS.has(d.label));
const forOperators  = details.filter((d) => OPS_ONLY_DETAILS.has(d.label));
```

Three destinations, selected **by label string**. There is no "requester only"
destination at all: every non-ops row reaches the specialist, and every row
whatever its label reaches the employee's page.

**What to do when you touch `details`:**

- Say out loud which of the two readers the row is for, and check the other one
  would not be worse off with it or without it.
- A fact for **operators only** goes in `OPS_ONLY_DETAILS` — that path is built.
- A fact for the **specialist only** currently has nowhere to go except `details`,
  and it will appear on the employee's page. Prefer the pattern in §4(a): compute
  both audiences' wording in **one function**, publish the requester's on the
  envelope (`readBy`) and the specialist's in `details`. That is what
  `describeReader()` does, and it is why the two cannot drift.
- A fact for the **requester only** belongs on the envelope, next to
  `plainAnswer`/`readBy` — not in `details`.

---

## 7. Applying it to a row you are about to add

1. **Name the surface, then name the reader.** §1. If a row goes to two surfaces
   (§6), name both.
2. **Point at the numbered question in §2 it answers.** If you cannot, stop.
3. **Run the deletion test.** Would that reader do anything differently?
4. **If no — run the routing test before deleting.** Is there a reader who *would*?
   Send it there.
5. **Check §5.** Is it a limit, an absence, a disclaimer, a routed team, or a
   provenance handle? Then it stays regardless of steps 3–4. Collapse it with a
   count if it is long; do not remove it.
6. **Check for a second copy.** `58eb1cc`'s most common finding was not litter but
   **duplication** — a fact stated in a badge, a card, a meter *and* a row. Remove
   the weakest copy, keep the richest, and never leave the same number in two
   places where a reader has to work out whether it is two facts.
7. **Say it in the reader's vocabulary.** `rule_based_fallback`, `AI confidence`,
   `approvalSlotsRequired`, `all_gates_passed` are field names. The exception is
   §5.4: a slug kept deliberately *as a search handle*, sitting beside the prose
   rather than instead of it.

---

## 8. Open questions this document does not settle

Recorded rather than papered over, per prime directive #7.

- **The portal result panel serves two readers on one page, by ordering rather
  than by routing.** `src/portal/plainAnswer.js`'s header says the plain answer
  goes on top and *"the machinery stays exactly where it is — a specialist and an
  auditor both need the ladder, the facts and the flags — and it stays BELOW."*
  `[CONFIRMED]` That is a defensible layering, and it is also the one place where
  the justification for keeping builder-shaped content on an employee's page is
  *"another audience needs it"* — while that audience reads the Zendesk note, not
  this page. Whether the facts table and gate ladder have earned their place on the
  **requester's** screen is **[UNVERIFIED]** and is a real question, not a
  rhetorical one. The gate ladder is at least collapsed behind a `<details>`
  summary; the facts table renders open.
- **`src/uc04/server.js`'s header still says *"NOT YET WIRED TO A ZAF PANEL"***
  `[CONFIRMED]`, while `CLAUDE.md` §4 and `zaf-app/assets/panels.js` both say all
  nine panels are registered. A stale comment, not a contradiction of this
  document's rule — flagged because it misdescribes who reads that server.
- **The three sentences `af07de0` reported out of scope** (§4(c)) are not re-checked
  here. **[UNVERIFIED]**
- **A reader this document does not have a row for: the person waiting for an
  answer that never comes.** `[CONFIRMED 2026-08-21]` §1 lists nine surfaces and
  every one of them shows a reader something *now*. Neither 🔴 use case has a
  surface for **afterwards**: UC-07's and UC-08's requesters see *"with a
  specialist"* on the portal's "My requests" for ever, because nothing anywhere
  can change that state, and UC-08's `customerFacingAcknowledgement` — built,
  disclaimed, tested — is rendered by **no surface at all**. The deletion test
  cannot catch this: it asks whether a fact on a page earns its place, and this is
  a page that does not exist. **The routing test comes closer and still misses**,
  because it asks *"useless to this reader, or to everyone?"* and the answer here
  is *"useful to a reader who has no screen."*
  A third question belongs beside those two, and it is the one that found this:
  **when this reader's situation changes, where do they find out?** Decided, not
  built — `qa/contracts/UC-08-acceptance.md` §14 and §0.5 Q4; UC-07's `R-24`.
- **The specialist's sidebar for UC-08 drops six of the seven fields the server
  computes for it.** `[CONFIRMED]` `describeDossier()` returns `presence`,
  `jurisdictionKnowledge`, `citationCoverage`, `sources`, `uncited`, `basis` and
  `openQuestions`; `zaf-app/assets/main.js`'s `loadUc08()` reads **`basis`**. This
  is the inverse of the failure §4 collects — not a fact that fails the deletion
  test and was kept, but facts that **pass** it and never arrive. Worth recording
  here because §4's three worked examples could be read as "the rule is about
  removal", and it is not: **it is about matching what a reader needs to what
  they get, in both directions.** DRIFT-037.
- **Nothing in this document is enforced by a test.** `58eb1cc` and `27d4b51` each
  pinned *their own* removals so they cannot drift back, which is the right unit —
  but the rule itself is a reading discipline. The nearest thing to enforcement is
  the closed-registry pattern in §3's last block, and it is worth copying wherever
  a new set of reader-facing fields is defined.

---

**See also**

- [`WHY-THIS-SHAPE.md`](WHY-THIS-SHAPE.md) §12 — the same defect told as a defect.
- [`SIDEBAR-APPROVAL-ROLES.md`](SIDEBAR-APPROVAL-ROLES.md) — which role a sidebar
  reader is being asked to act as.
- [`ESCALATION-DESTINATIONS.md`](ESCALATION-DESTINATIONS.md) — the named teams of §5.3.
- [`FOR-CX-LEADERS.md`](FOR-CX-LEADERS.md) §3 — what happens when a correct
  decision reaches nobody.
