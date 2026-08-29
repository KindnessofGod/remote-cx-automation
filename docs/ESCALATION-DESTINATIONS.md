# Escalation destinations — who receives each hand-off, and what they get

> **The question this answers**, asked of a UC-05 escalation on the request
> portal:
>
> > **"How exactly will this system help local HR and the Remote CX automation
> > team, especially if it is escalated? *Who is it escalated to?*"**
>
> Answering it for UC-05 turned up a defect: `src/uc05/decisionFacts.js` told
> the reader *"Local HR Legal decides how the shortfall is handled"* while
> `src/shared/escalationRouting.js` sent the ticket to **HR Ops**, and no team
> called "Local HR Legal" existed anywhere in the routing table or in the
> Zendesk account. A separate agent is closing that one. **This document asks
> the same question of the other eight, and of the general shape underneath
> it:** does what a use case *says* about its receiving team match where the
> ticket actually *goes*, does that team exist, and does the person who opens
> the ticket have enough to decide anything.

Three answers up front, because they are the ones that change what somebody
should do next.

1. **Two of the nine contradict themselves about who owns the work, and both
   contradictions are visible on real tickets in the live account today.**
   UC-05 is the known one (ticket **#53**). **UC-03 is the new one** — it tells
   the reader *"Global Mobility owns it"* and routes to **Travel & Mobility
   Support**, and no team named Global Mobility exists in the routing table, in
   the Zendesk account, or in `UC-03.md`.
2. **The n8n graphs in production are running a routing table this repository
   replaced.** All nine deployed `Assign Routing` nodes carry the pre-split
   body — one tag per route, always the `escalation_*` one, and a **UC-04 row
   that sends every UC-04 decision, routine approvals included, to Mobility &
   Legal (Tier-2)**. That is precisely the defect the current file's header
   describes as fixed. The fix is in the file. It is not in production.
3. **Nothing any receiving human is handed tells them where to act or what
   their options are.** The ticket note names the owning team, the decision,
   the reason and the figures. It never names the screen, the endpoint, or the
   verbs. `src/approvalqueue/approvalRoutes.js` holds all three per use case
   and is read by one internal dashboard, never by the ticket.

This document is **analysis**. One prose correction is proposed and *not*
applied (§2.1) because it turns out to be a routing decision rather than a
typo. Nothing in `src/`, `zaf-app/` or `workflows/` was modified to produce it.

---

## 0. How this was established

Everything below was read out of the code or queried live on **2026-08-19**.
Where a fact could not be checked from this container, it says so rather than
being inferred.

**Live Zendesk (`your-subdomain`), read-only.** OAuth `client_credentials`,
`scope: "read write"`, `NODE_USE_ENV_PROXY=1` (without it Node's global `fetch`
bypasses the proxy and every call returns `403 Host not in allowlist` — §6 of
`CLAUDE.md`). Nothing was created, assigned, tagged or updated.

```
POST /oauth/tokens                    -> 200
GET  /api/v2/groups.json              -> 200   8 groups
GET  /api/v2/group_memberships.json   -> 200
GET  /api/v2/tickets/{40..70}.json    -> 200 for #40–#53
GET  /api/v2/tickets/{47,48,51,53}/comments.json -> 200
```

`groups:read` was **not** refused — `GET /api/v2/groups` answered 200. The
scope concern recorded in `docs/APPROVAL-ROUTING.md` §2 and in
`src/review/approverEntitlement.js`'s "REJECTED FOR NOW" reasoning is **stale**:
the broad `read` scope populated on the client in August covers it. That
matters beyond bookkeeping — it removes the stated blocker on resolving
entitlement from Zendesk group membership.

**Live n8n, read-only.** `npm run verify-deployed` (39 nodes) plus a direct
`GET /api/v1/workflows/WORKFLOW_UC01_ID` to read the deployed `Assign Routing`
body. Note `N8N_BASE_URL` in this environment carries a **trailing dot**, which
is a legal DNS root label that fails TLS — a bare `fetch failed` with nothing
pointing at the URL. `scripts/verify-deployed-nodes.mjs` strips it and warns;
an ad-hoc script must do the same.

**Code.** Every human-facing string was found by grepping for team-shaped
names across `src/`, `workflows/` and `zaf-app/`, not by walking a list of
teams that were already known — the point was to find a name nobody had
written down, and that is how "Global Mobility" surfaced.

**Not verifiable from here.** Whether the live ZAF install's nine
`ucNNApiBaseUrl` settings are filled in (the install is a static upload; the
repo's `main.js` is not what is running unless someone ran `zcli apps:update`).
`docs/APPROVAL-ROUTING.md` §2 already says so and it still stands.

**One moving part.** `src/shared/escalationRouting.js` and
`workflows/nodes/assignRouting.js` have **uncommitted working-tree changes**
from the UC-05 agent as this was written. Every claim below states whether it
is about committed `HEAD` or about the working tree.

---

## 1. The nine rows: said, routed, agreed, exists

| UC | Who the code **says** receives it | Where the routing **sends** it | Agree? | Group exists live? |
|---|---|---|---|---|
| **UC-01** Employment verification | *nothing* — no team is named in any string. The sidebar says "any support specialist can decide this one" | **HR Ops** · `queue_hr_ops` · `escalation_hr_ops` | **absence**, not a contradiction | ✅ `6168404929823` |
| **UC-02** Expense & receipt | **Finance Ops**, ~20 strings across `reviewPolicy.js`, `workflow.js`, `requestStatus.js`, `panels.js`, `cli.js`; `UC-02.md` names it 9× | **Finance Ops** · `queue_finance_ops` · `escalation_finance_ops` | ✅ agree | ✅ `6168404929055` — #40–#47 are in it |
| **UC-03** Travel letter / router | **"Global Mobility"** — 4 human-facing strings. Portal copy says only "a specialist" | **Travel & Mobility Support** · `queue_travel_support` · `escalation_travel_support` | ❌ **MISMATCH** — and `UC-03.md` names neither team | ✅ `6168404930335` — #48–#50 are in it. **"Global Mobility" exists nowhere** |
| **UC-04** Work authorization | ordinary: "a mobility specialist" / **Mobility specialist**. escalated: **"Mobility Legal Tier-2"**, "a Mobility Legal reviewer", "a Mobility Legal specialist" — three spellings | ordinary: **Mobility Specialists** · `queue_mobility_specialists`. escalated: **Mobility & Legal (Tier-2)** · `escalation_mobility_legal_t2` | ⚠️ same team, four spellings, none equal to the group's real name | ❌ **`Mobility Specialists` DOES NOT EXIST** — #51 sits in default **Support**. ✅ Tier-2 exists `6168394286495` |
| **UC-05** Resignation notice | **"Local HR Legal"** on the discrepancy path (`decisionFacts.js:170`, `policyEngine.js:318`); **HR Ops** on the sign-off path | `HEAD`: **HR Ops** for both. Working tree: `escalationGroup: "Local HR & Legal"` · `escalation_local_hr_legal` | ❌ **MISMATCH at `HEAD`**, live on ticket **#53**. Being closed by another agent | ✅ HR Ops. ⚠️ **`Local HR & Legal` NOW EXISTS** — `9990000000002`, created by `e4108d6` and read live 2026-08-20; this cell read *"does not exist — verified today"* when written. **The backlog was never repaired**: escalations raised while the group was missing — **#23, #53, #54** — are still in the account default `Support` group. Creating a group fixes the next hand-off and re-queues nothing |
| **UC-06** Contract amendment | roles only — "Customer admin", "Remote payroll specialist". The **team** is never named. ⚠️ **And no UC-06 ticket carries the tag or the group**: neither `src/uc06/` nor `src/remoteui/` references the routing table at all, so every UC-06 ticket in the account is stand-in-authored and unrouted — worse than §2's backlog, which at least carries a tag a backfill could act on. DRIFT-062, decided `[A-30]`…`[A-32]` 2026-08-21, **not yet built** | **Payroll Ops** · `queue_payroll_ops` · `escalation_payroll_ops` | **absence**, not a contradiction | ✅ `6168442797343` |
| **UC-07** Global mobility | **"Mobility Legal specialist (Tier-3)"**, "Mobility Legal Tier-3", and — customer-facing — "our Mobility Legal specialist team" | **Mobility Legal (Tier-3)** · `queue_mobility_legal_t3` · `escalation_mobility_legal_t3` | ✅ agree | ✅ `6168424846751` |
| **UC-08** Cross-border tax | **"Remote Tax Operations specialist"**, "Tax Ops specialist" | **Tax Operations** · `queue_tax_operations` · `escalation_tax_operations` | ✅ agree (one abbreviation) | ✅ `6168394287519` |
| **UC-09** Off-cycle payroll | "Remote payroll specialist" (role); "handled by **Payroll** directly" on the terminated-employment escalation | **Payroll Ops** · `queue_payroll_ops` · `escalation_payroll_ops` | ✅ agree, loosely | ✅ `6168442797343` |

**Two contradictions (UC-03, UC-05), one naming drift (UC-04), two absences
(UC-01, UC-06), four agreements.** Seven of the eight routing teams exist;
`Mobility Specialists` does not, which reconfirms `docs/APPROVAL-QUEUE.md` §0
finding 1 against the account rather than inheriting it. The working tree adds
a **ninth** team name that also does not exist.

---

## 2. The mismatches, named precisely

### 2.1 UC-03 — the reader is told **Global Mobility**; the ticket goes to **Travel & Mobility Support**

> ## ✅ DECIDED 2026-08-20 — remove "Global Mobility". NOT YET BUILT.
>
> This section proposed a correction and deliberately did not apply it, on the
> grounds that substituting the routed team's name makes some of these sentences
> contradict themselves — so it was a routing decision, not a find-and-replace.
> **The decision has now been taken.**
>
> The instruction was *"use the official Remote name, and append the other name for
> understanding."* **Checked, and the premise does not hold: Remote publishes no
> team names, and neither of these is Remote's.** *Travel & Mobility Support* is
> this project's own Zendesk group (`6168404930335`, exists, receives tickets);
> *Global Mobility* names an industry **function** and exists in no routing table,
> no Zendesk account and no spec — which this document established and is the
> reason it exists.
>
> **Decided:** the routed group name wins, because it is the only one that can
> receive a ticket. "Global mobility" may appear lowercase as the *function* where
> it genuinely helps a reader, per the owner's rule that a self-explanatory name
> needs no gloss. And per §7 of this document, the prose is built **from the
> routing row** — UC-05's fix as the model — so the two cannot drift again.
>
> One of the four strings disappears on its own: line 468 and its decision-facts
> twin at 735 describe `duration_over_cap`, an outcome **G-B removes**
> (DRIFT-013). Fix the remaining ones; do not re-word an outcome that is going.
>
> Tracked as **DRIFT-014**. Disposition in `qa/contracts/UC-03-acceptance.md` §17;
> summary in `qa/SPEC-DRIFT-INDEX.md`.


Four human-facing strings, all in `src/uc03/policyEngine.js`:

| Line | Decision | The string a person reads |
|---|---|---|
| 444 | `escalate` / `sanctioned_region` (gate 7 `means`) | "This is not a support question at all — **Global Mobility owns it**, and no extra information from the employee changes that." |
| 667 | same, decision-facts sentence | "…is on the sanctioned or restricted list, so **Global Mobility owns this** and no further information from the employee changes it." |
| 468 | `human_review` / `duration_over_cap` (gate 10 `means`) | "The trip is longer than the cap…, so **Global Mobility weighs it** instead." |
| 735 | same, decision-facts note | "length is a risk signal here, not a refusal — **Global Mobility weighs it**…" |

**These reach the ticket.** `src/portal/server.js:3181` puts the deciding
gate's `means` on the note as the `"What happened"` lead, and
`buildTicketNote()` prints `assignment.intendedGroup` as **"Owning team"** four
lines below it. So a UC-03 sanctioned-destination escalation produces exactly
the shape ticket #53 produces for UC-05, verified live:

Reproduced in-process, no network, from the two modules the note is composed
from (`describeGateLadder("sanctioned_region")` for the lead, `handoffFor()`
for the owning-team row):

```
--- What happened (the ticket note lead) ---
The destination is on the sanctioned or restricted list. This is not a support
question at all — Global Mobility owns it, and no extra information from the
employee changes that.

--- Owning team (four lines below it) ---
Travel & Mobility Support   tags: queue_travel_support, escalation_travel_support
```

**Three facts make this worse than a wording slip.**

1. **`docs/use-cases/UC-03.md` names no owning team at all.** It mentions
   Remote's own "Mobility Team" (§4, about who may create a travel-letter
   request in Remote's UI), "the compliance team" (§7, about who would source
   the sanctions list in production) and "the mobility specialist" (§9, about
   UC-04's approver). None of the three is UC-03's receiving team. So
   **neither** name in play is spec-derived: "Global Mobility" was written into
   the policy engine, and `escalationRouting.js`'s own `source` field for this
   row is a paraphrase of §7.1/§8 — a true summary of what happens, not a quote
   naming a team.
2. **The two decisions have different natures and may not have the same owner.**
   `duration_over_cap` is a long trip somebody should look at — plainly travel
   support's work. `sanctioned_region` is a compliance refusal whose own
   sentence says *"this is not a support question at all"*. Routing both to a
   **Support**-named queue is at least arguable, and the string is arguing
   against it.
3. **Rewriting the prose to say "Travel & Mobility Support" would make the
   sentence contradict itself** — "this is not a support question at all —
   Travel & Mobility Support owns it".

**So this is not the clearly-correct prose fix the brief allows, and it is not
applied.** It is a routing decision: either UC-03's sanctions escalation gets
its own `escalationGroup` (the shape UC-04 already has and the shape the UC-05
agent is adding), or the sentence stops naming a team. Recommendation in §7.1.

### 2.2 UC-04 — one team, four spellings, none of them the group's name

| Where | The words |
|---|---|
| `src/uc04/requestParser.js:79` (on the ticket) | "Escalated to **Mobility Legal Tier-2**; not open to 1-click approval here." |
| `src/uc04/decisionFacts.js:95` (`DECIDER.decides`) | "…what a **Mobility Legal reviewer** has to settle before anyone can." |
| `src/uc04/policyEngine.js:517` (gate `means`) | "…a **Mobility Legal specialist** must handle it directly." |
| `escalationRouting.js` | `escalationGroup: "Mobility & Legal (Tier-2)"` |
| the live account | group **`Mobility & Legal (Tier-2)`**, id `6168394286495` |

Same team throughout — nobody is misdirected — but a specialist told
"Mobility Legal Tier-2" and then searching Zendesk for that name finds nothing
under it. The routed name is the one the account actually uses.
`src/uc04/**` is owned by another agent this session, so no edit was made;
recommendation in §7.2.

**The ordinary path is the serious half.** UC-04's non-escalated decisions
route to **`Mobility Specialists`**, which does not exist. Live proof, read
today: ticket **#51** carries `queue_mobility_specialists` and sits in group
`6151578998431` — **Support**, the account default. The note on it reads
*"Owning team: Mobility Specialists"*. Nothing about the ticket looks wrong.

### 2.3 UC-05 — the original, and it is live

Ticket **#53**, last comment, read today. Both halves of the contradiction are
in the same note, five lines apart:

```
 What happened   … Local HR Legal has to decide how the shortfall is handled …
 Owning team     HR Ops
```

Another agent owns this. Recorded here only so the pattern is documented in one
place, and for one fact their change needs: **`Local HR & Legal` did not exist
in the account** when this was written (8 groups listed that day; it was not
among them), so on landing it took the tag-and-say-so path their
`assignRouting.js` comment already describes. That is the correct fail-visible
behaviour and it is also a second row of §3's standing hole.

> **Updated 2026-08-21: the group now exists** — `9990000000002`, created by
> `e4108d6`, read live 2026-08-20. The fail-visible path was therefore exercised
> for real and worked. **Three UC-05 escalations remain in the default `Support`
> group** (#23, #53, #54) because nothing retro-assigns tickets raised while a
> group was missing — which is the more durable lesson than the group's absence
> was: *creating the destination repairs the next hand-off and none of the
> earlier ones.*

### 2.4 UC-01 and UC-06 — absence, not contradiction, and it is a different bug

Neither names a team anywhere. A reader of a UC-01 exception note or a UC-06
amendment is told the decision, the reason, the figures and — on UC-06 — which
two roles must sign, and is never told **whose queue it is**. That is not a
misdirection; nobody is sent to the wrong place. It means the note cannot be
read as a hand-off at all: the ticket says a person must act and does not say
which team of people. `escalationRouting.js` holds the answer (HR Ops, Payroll
Ops) and neither use case's prose consults it.

### 2.5 UC-01 and UC-03's **Node** execution path applies no routing at all

`src/uc01/workflow.js:321` and `src/uc03/workflow.js:407` are the only two
`workflow.js` files that talk to Zendesk directly, and **neither imports
`escalationRouting.js`.** They apply their own outcome tags only:

```js
// uc01/workflow.js
const tags = outcome.decision === "escalate" ? ["verification_exception"] : [];
// uc03/workflow.js
ZENDESK_TAG_BY_DECISION = { human_review: ["uc03_formal_letter_review"], escalate: ["uc03_escalated"], … }
```

No `queue_*` tag, no `escalation_*` tag, no group. A UC-01 escalation raised
through the Node path (`npm run live`, `npm run livedemo`, the demo scripts)
lands with no owning-team signal of any kind. The n8n graphs and the portal
both do route; this path is the odd one out and is the one the demo scripts
drive.

---

## 3. The live account, as it is today

**Eight groups. Seven of the eight routing teams have one.**

| Group | id | routing team? |
|---|---|---|
| Finance Ops | `6168404929055` | UC-02 |
| HR Ops | `6168404929823` | UC-01, UC-05 |
| Mobility & Legal (Tier-2) | `6168394286495` | UC-04 escalations |
| Mobility Legal (Tier-3) | `6168424846751` | UC-07 |
| Payroll Ops | `6168442797343` | UC-06, UC-09 |
| Tax Operations | `6168394287519` | UC-08 |
| Travel & Mobility Support | `6168404930335` | UC-03 |
| Support *(account default)* | `6151578998431` | — where unrouted work lands |
| **Mobility Specialists** | *— absent —* | **UC-04's ordinary approval path** |
| **Local HR & Legal** | *— absent —* | UC-05 escalations, *working tree only* |

Every id matches `src/shared/escalationGroupIds.js` exactly; that cache is
current.

**Every one of the eight groups contains the same single agent** (`user
6151578966559`), verified via `GET /api/v2/group_memberships`. Not a defect —
this is a one-person demo account — but it is worth stating plainly, because
"routed to Finance Ops" and "reached a Finance Ops specialist" are the same
event here and would not be in production. Nothing in this system distinguishes
a group that exists from a group that is staffed.

**Where the work actually is** (tickets #40–#53, read today):

| Ticket(s) | UC | Group | Routing tags |
|---|---|---|---|
| #40–#46 | UC-02 | Finance Ops ✅ | `queue_finance_ops` |
| #47 | UC-02 | Finance Ops ✅ | `queue_finance_ops`, `escalation_finance_ops` |
| #48–#50 | UC-03 | Travel & Mobility Support ✅ | `queue_travel_support` |
| **#51** | UC-04 | **Support (default)** ❌ | `queue_mobility_specialists` |
| #52 | — | Support (default) | *none* |
| #53 | UC-05 | HR Ops ✅ | `queue_hr_ops`, `escalation_hr_ops` |

The two-tag split **is** working on the portal path — #47 and #53 carry both
tags, #40–#46 and #48–#50 carry only the queue tag. That is the fix behaving
exactly as its header describes, on the path that runs the current code.

---

## 4. The routing that is actually deployed is not the routing in this repo

`npm run verify-deployed`, run live today:

```
39 nodes checked · 18 drifted · 0 workflows with unpublished changes.
```

**All nine `Assign Routing` nodes are among the drifted.** Reading the deployed
body off `WORKFLOW_UC01_ID` directly:

```js
const ROUTES = {
  'UC-01': { group: 'HR Ops',                    tag: 'escalation_hr_ops',            priority: 'normal' },
  'UC-02': { group: 'Finance Ops',               tag: 'escalation_finance_ops',       priority: 'normal' },
  'UC-03': { group: 'Travel & Mobility Support', tag: 'escalation_travel_support',    priority: 'normal' },
  'UC-04': { group: 'Mobility & Legal (Tier-2)', tag: 'escalation_mobility_legal_t2', priority: 'high'   },
  'UC-05': { group: 'HR Ops',                    tag: 'escalation_hr_ops',            priority: 'normal' },
  …
};
```

Three consequences, all live on every Zendesk ticket the nine graphs touch:

1. **`escalationGroup` does not exist in the deployed body**, so **UC-04's
   ordinary `ready_for_approval` is assigned to `Mobility & Legal (Tier-2)`** —
   the queue `UC-04.md` §5 reserves for *"ANY dimension unconfirmed/ambiguous …
   not a simple 1-click"*. This is the exact defect the current
   `escalationRouting.js` header describes in the past tense.
2. **One tag per route, and it is always the `escalation_*` one.** Every
   routine human gate — a UC-02 flagged claim, a UC-05 sign-off, a UC-06 dual
   approval — reaches Zendesk labelled as an escalation. Escalation rate on the
   n8n path is a constant 100%, and any trigger or view keyed on
   `queue_*` matches nothing at all.
3. **The deployed table has no `Mobility Specialists` row**, so the missing
   group never bites on the n8n path. It bites only on the portal path — which
   is exactly what ticket #51 is: portal-raised, tagged
   `queue_mobility_specialists`, unassigned.

So **"where does this go?" has two different answers depending on which path
raised the ticket**, and the repo describes only one of them.
`workflows/README.md` already carries a "Not deployed yet" note for this; it is
re-verified here against the live graphs rather than inherited, and it is worth
promoting out of a blockquote because it is currently the largest gap between
what this repository says about routing and what routing does.

The fix is already sequenced and needs no new design:
`scripts/setup-zendesk-groups.mjs` → `npm run sync-groups` →
`node scripts/deploy-routing-nodes.mjs`. Per §7b of `CLAUDE.md` the deploy is
pre-authorised; the proof is not optional.

---

## 5. What the receiving person actually gets

This is the half of the owner's question that is not about addressing. Read the
last comment on ticket **#51** — a real UC-04 hand-off, in full, as a mobility
specialist receives it:

> **Work authorization / workation — a person has to decide**
> Routine review. This is the human gate working, not an escalation.
> **What a human controls here.** A mobility specialist reads the request and
> approves or declines it. Nothing on this page grants permission by itself.
> **What happened** Every check passed, so a dossier was prepared for a
> mobility specialist to approve. The workation is NOT approved yet…
> Decision `ready_for_approval` · Reason `all_gates_passed` · Flags
> `a1_certificate_recommended` · Owning team **Mobility Specialists** ·
> Priority high · Due — no deadline was produced by this decision
> **What the checks reported** Decided by gate 17 of 17 — outcome… Risk level
> low · Trip length 14 days · Cumulative days abroad 0 day(s) over 0 prior
> trip(s) — *no prior stays were stated and none were read from Remote, so this
> is a floor, not a count* · Remote work-authorization request — *Remote holds
> no pending request for this employee…*

That is a genuinely good hand-off — the decision, the deciding gate, the
figures, and two explicit statements of what was **not** established. It is
also missing the last step: **it never says where to click or what the options
are.** "A mobility specialist reads the request and approves or declines it"
names a verb pair in passing and no surface, no link, no endpoint.

### 5.1 What each use case carries into the hand-off

| UC | Ranked facts | Gate ladder (`means`) | A named decider + *what they decide* | Citations |
|---|---|---|---|---|
| **UC-01** | ✅ `decisionFacts` via `policyEngine` | ✅ | ❌ none | ❌ none |
| **UC-02** | ✅ (16 gates, `describeGateLadder`) | ✅ | ❌ none | ❌ none |
| **UC-03** | ✅ | ✅ | ❌ none | ❌ none |
| **UC-04** | ✅ + explicit unknown-vs-cleared | ✅ | ✅ `DECIDER` — "whether this employee may work from this destination for these dates" | ✅ **24 vendored documents** via `decisionSources.js`, mapped across 13 finding keys, plus 27 recorded contradictions |
| **UC-05** | ✅ | ✅ | ✅ `DECIDER` — "whether this calculation is right, and can be signed" | ⚠️ in flight (`src/uc05/decisionSources.js` is referenced by the working tree and does not exist yet) |
| **UC-06** | ✅ | ✅ | ✅ **two** `DECIDERS`, each with a *different* question | ❌ none |
| **UC-07** | ✅ ranked `dossierView` — blocking vs. settleable flags, every hole named. ⚠️ **but the derivation returns nothing for every dossier actually stored** (DRIFT-072): it reads `dateChecks`/`transitionSafety`, and all seven live rows carry the pre-2026-08-19 flat shape, so `?? {}` renders an unreadable dossier identically to a satisfied one. Decided `R-21`/`R-22` | ❌ n/a (dossier) | ⚠️ named in a file header and in `panels.js`, **not as data** | ⚠️ **6 hand-written corpus entries** — **decided 2026-08-21: this stays** (DRIFT-071); the pgvector table is dropped, because it would take zero rows even from a full seed |
| **UC-08** | ✅ ranked `dossierView` + `jurisdictionKnowledge` + `presenceEvidence` | ❌ n/a (dossier) | ⚠️ same | ⚠️ **3 paraphrased OECD *Model* entries** |
| **UC-09** | ✅ + `approvalView`, which addresses its **three readers separately** | ✅ | ✅ **three** `DECIDERS`, incl. "which dimension fired and on what basis" | ❌ none |

`DECIDER`/`DECIDERS` reaches the wire as `basis.decider(s)` on UC-04/05/06/09's
`GET .../by-ticket/:ref`. UC-01/UC-03 get a weaker equivalent client-side —
`panels.js`'s `approvalRoles().summary`. UC-07/UC-08's reader is named only in a
file header comment and in two sidebar strings; there is no machine-readable
"here is the person and here is their question" for the two use cases where the
dossier **is** the entire product.

### 5.2 The citation asymmetry is the sharpest gap in this table

`docs/knowledge/` holds **29 statutory instruments (`D-*`) plus 18 Remote and
carrier documents**, with a contradictions log of 27 entries. Exactly one use
case reads any of it: UC-04, whose `decisionSources.js` cites **24 of them**
across **13 finding keys**, and prints the three contradictions that qualify
the findings it prints.

Meanwhile the two use cases whose *only* output is a research dossier cite
hand-written summaries:

- **UC-08** cites three entries: OECD Model Art. 4, OECD Model Art. 15,
  and a general totalization principle — all paraphrase, because the OECD
  material is paraphrase-only by licence. Sitting unread in the same repository:
  **`D-24` NL–PT tax convention, `D-25` CA–NL, `D-26` CA–PT, `D-27/28/29` US
  conventions, `D-31`–`D-35` domestic residence tests, `D-17`/`D-18`/`D-19` EU
  Reg 883/2004 + 987/2009 + the A1 practical guide, `D-20`–`D-23`
  totalization status.** A Tax Operations specialist reading a CA→NL dossier is
  handed the OECD **Model** and not the CA–NL convention that is actually in
  force and is on disk twelve directories away.
- **UC-07** cites six entries derived from a build pack. Sitting unread:
  `D-07`/`D-08` Schengen Borders Code, `D-09` visa annexes, `D-10`/`D-11` the
  Portuguese D8, `D-14`/`D-15` US VWP and B-1, `D-16` Canadian IRPR 186.

Neither is a defect in the retrievers — both are honestly labelled, both refuse
to quote a similarity figure, and `treatyRetriever.js`'s word-boundary history
is exemplary. The gap is that the corpus was never pointed at the library.

---

## 6. The two absences, kept apart

`docs/APPROVAL-QUEUE.md` §3 draws this line and it survives every check here.

- **`none_by_design` — UC-07, UC-08.** Nothing may approve a 🔴 dossier, ever.
  One write method, zero mutations, no POST route in either `server.js`, both
  asserted by test. An approve button here is a defect. **They still must reach
  a named human, and they do — on the n8n path.** `escalationRouting.js` names
  Mobility Legal (Tier-3) and Tax Operations, both groups exist, and ticket
  **#34** was read live today sitting in group `6168424846751` — Mobility Legal
  (Tier-3) — tagged `escalation_mobility_legal_t3`, `uc07_escalated`. (Ticket
  **#19** carries the identical tags and sits in default **Support**: it
  predates the routing node, and the pair is the clearest available proof that
  assignment, not tagging, is what makes a hand-off.) On the **portal** path they reach nobody:
  `src/portal/ticketing.js`'s `TICKETABLE_TYPES` excludes them, for the correct
  reason that linking a ticket means writing a ticket id onto a store with no
  mutation method. So a portal-submitted relocation or tax dossier is compiled,
  audited, and in no queue. **That is a missing hand-off, not a missing
  control**, and conflating the two is what the `none_by_design` value exists to
  prevent.
- **`none_missing` — UC-03.** A formal travel letter is drafted, stored, queued
  and correctly assigned to Travel & Mobility Support — and nothing anywhere can
  sign it off. `src/uc03/server.js` has no POST route; the sidebar's `loadUc03`
  sets `actionable: false`. `UC-03.md` §15 says so in its own voice. The ticket
  is in the right queue and opening it achieves nothing.

The difference in one line: **UC-07/08 have a control that must not exist and a
hand-off that partly does not. UC-03 has a hand-off that works and a control
that must exist and does not.**

---

## 7. Ranked — what each receiving team is missing in order to decide

Ordered by how badly it blocks the human at the receiving end.

**1. Mobility Specialists (UC-04) — the queue does not exist, so nothing
arrives.** Live: #51. Everything else about that ticket is right. Fix is
configuration, not code: `scripts/setup-zendesk-groups.mjs` then
`npm run sync-groups`. It is the one team of eight with no group.

**2. All nine teams — production is routing from a superseded table.** §4.
Routine reviews arrive labelled as escalations, UC-04's one-click approvals
arrive in the Tier-2 legal queue, and no `queue_*` tag exists on the n8n path
for a view to filter on. Fix is a redeploy of a body that already exists and is
already parity-tested.

**3. Every team — the hand-off never says where to act or what the verbs are.**
`approvalRoutes.js` already holds `surface`, `endpoint`, `roles` and
`slotsRequired` for all nine and is read only by `npm run queue-ui`. The
portal's ticket note composes `humanControl` and the owning team and stops.
Adding the surface sentence and the option set to `buildTicketNote()` and to the
n8n routing note is small and needs no new fact. Three of the nine cannot be
given a link honestly — UC-03 has no surface, UC-07/UC-08 must not have one —
and for those the honest sentence is the *absence*, which is exactly what
`control: "none_missing"` / `"none_by_design"` already says.

**4. Travel & Mobility Support (UC-03) — told a different team owns the work,
and unable to act when it is theirs.** Two separate problems on one queue: the
`Global Mobility` contradiction (§2.1) and the missing sign-off surface (§6).
The second is the one that leaves a drafted letter unsent.

**5. Tax Operations (UC-08) and Mobility Legal Tier-3 (UC-07) — the dossier is
the entire product and it cites 3 and 6 hand-written summaries while 29
statutory instruments, including the bilateral conventions actually in force,
sit in `docs/knowledge/`.** Also: neither carries a machine-readable "you are the
reader, this is your question", and portal-submitted dossiers reach no queue at
all (§6). The specialist has to know to look.

> **[DECIDED 2026-08-21 — both halves, and the second is now scheduled.]** The
> "reach no queue" half is **DRIFT-109**: both 🔴 use cases join
> `TICKETABLE_TYPES`, with the ticket id travelling **record → ticket only**, so
> each store keeps one write method and zero mutations. **It is one change for
> both use cases** — UC-08's `T-13` is UC-07's `R-24` prerequisite — and building
> it twice would give one hand-off two vocabularies, which is what this document
> exists to prevent. The hand-written-summaries half is **DRIFT-036/DRIFT-046**:
> **do not seed the vectors**; build a country-filtered **lexical** index over the
> 106 real statutory passages instead (`docs/RETRIEVAL.md`, BM25 3/6 against
> embeddings 2/6 at that corpus size). **Neither is built.**

**6. HR Ops (UC-05) — said-vs-routed, live on #53.** Being closed by another
agent; noted here for completeness. **Updated 2026-08-21:** the
`Local HR & Legal` group **now exists** (`9990000000002`, live 2026-08-20). What
survives is the backlog — #23, #53 and #54 are still in the default `Support`
group — and the routing decision itself, which the seventh decision pass did not
disturb: a statutory shortfall goes to Local HR & Legal and a sign-off goes to HR
Ops, because signing off is confirming a calculation and a shortfall is not a
calculation to confirm.

**7. Finance Ops (UC-02) and any UC-01 reviewer — the team is named everywhere
and entitled nowhere.** `USE_CASE_ROLES` in `src/review/approverEntitlement.js`
covers UC-04, UC-05, UC-06 and UC-09 only. On UC-01 and UC-02 any verified
identity can record the decision, so "a Finance Ops specialist approves this" is
a description of what happens, not a constraint on who may. `approverEntitlement.js`'s
own §"REJECTED FOR NOW" reasoning names two blockers on resolving entitlement
from Zendesk group membership — that the groups do not exist, and that the
client has no `groups:read`. **Both are now false**: seven of eight groups exist
and `GET /api/v2/groups` returned 200 today. The seam
(`createEntitlementChecker({ grants })`) is already built for it.

**8. HR Ops (UC-01) and Payroll Ops (UC-06) — never named to the person reading
the ticket.** §2.4. One sentence each, sourced from `escalationRouting.js` so it
cannot drift — the pattern the UC-05 agent is establishing with
`escalationTeamName()`.

**9. Everyone — the demo account's eight groups contain one shared agent.**
Routing correctness and reachability are indistinguishable here. Worth a line
in whatever is presented, so that "assigned to Finance Ops" is not read as
evidence that a Finance Ops person exists.

---

## 8. Recommendations, none applied

Sized and sequenced. Nothing here weakens `view.actionable`, any approval floor,
or the 🔴 no-execution guarantee.

### 8.1 UC-03 — give the sanctions escalation its own `escalationGroup`, or stop naming a team (S, needs a decision)

Two shapes, and the choice is a judgement about Remote's org that this
repository should not make silently:

- **(a)** Add `escalationGroup` to UC-03's row — the shape UC-04 already has and
  UC-05 is gaining — pointing at the mobility/legal desk that a sanctions
  refusal actually belongs to, and derive the four strings from the row rather
  than restating a name. Then `"Global Mobility"` becomes whatever the row says
  and the two halves cannot drift. Needs a group in the account.
- **(b)** Drop the team name from the four strings and let the note's "Owning
  team" row be the single place a team is named. Cheaper, loses nothing true,
  and leaves the sanctions/duration distinction unaddressed.

Not applied because "who owns a sanctions refusal" is a routing decision, and
`escalationRouting.js` is owned by another agent this session.

### 8.2 UC-04 — spell the escalation team the way the account spells it (XS)

Three strings say "Mobility Legal Tier-2" / "Mobility Legal reviewer" /
"Mobility Legal specialist"; the group is `Mobility & Legal (Tier-2)`. Best done
the UC-05 way — read the name off the row — rather than by retyping it in three
places. `src/uc04/**` is owned by another agent; flagged, not touched.

### 8.3 Put the surface and the verbs on the hand-off (S, the highest value per line)

`approvalRoutes.js` already answers "where does a human click" and "what are the
options" for all nine. Nothing that produces a hand-off reads it. Adding those
two facts to `buildTicketNote()` and to `assignRouting.js`'s `routingNote` turns
"a person has to decide" into "a mobility specialist approves or declines this
in the Remote CX Review sidebar on this ticket". For UC-03, UC-07 and UC-08 the
correct sentence is that there is no such control and why — the two absences
must stay two sentences.

### 8.4 Point UC-07 and UC-08 at `docs/knowledge/` (M, design pass)

`decisionSources.js`'s finding-key → documents map is the pattern, and its three
rules transfer unchanged. This is the change that most improves what a 🔴
specialist actually receives. It is a design pass, not a patch: UC-08's corpus
is retrieval-shaped and `decisionSources.js` is map-shaped, and mixing them
without deciding which governs would produce a nearest match for a finding that
has no source.

> **[CORRECTED 2026-08-21.]** ~~embedding similarity over summaries~~ — **the
> running system retrieves by KEYWORD, always.** The embedding class is real and
> is reached by no production entry point (`configureTreatyRetriever()` is called
> from no file under `src/` or `scripts/`), and `uc08_treaty_citation_vectors` has
> held zero rows since it was provisioned. **Decided: do not seed** — the remedy
> is a country-filtered **lexical** index over the 106 real statutory passages,
> as one decision across UC-07 and UC-08. That makes this design pass *simpler*,
> not harder: both sides become map-shaped and country-keyed, and the
> "which governs" question narrows to ranking within a filtered set.
> DRIFT-036 · `T-26`/`T-27`.

### 8.5 Resolve entitlement from Zendesk group membership (M)

Both stated blockers are gone (§7.7). The seam exists and takes a resolved grant
map, so the policy call stays synchronous and pure. UC-01 and UC-02 need a
nominal role first, as `docs/APPROVAL-ROUTING.md` §4 Unit 4 already specifies —
and its warning stands doubled here: **every case needs its positive twin.** An
entitlement gate that refuses everything and one that works are
indistinguishable from outside, and this repository has paid for that confusion
more than once.

### 8.6 Make the Node path route like the other two (S)

`src/uc01/workflow.js` and `src/uc03/workflow.js` should apply `handoffFor()`'s
tags the way the portal and the graphs do. Three paths, one routing table, no
exceptions — and the demo scripts drive the path that currently has none.

### Explicitly out of scope

- Inventing a team. Where the receiving team is genuinely undecided — UC-03's
  sanctions path — that is recorded as the finding, not resolved by picking one.
- Any approve/decline route on UC-03, UC-07 or UC-08. UC-03 needs one and it is
  a design question; UC-07 and UC-08 must never have one.
- Collapsing `none_by_design` and `none_missing`.
