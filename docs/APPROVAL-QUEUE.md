# The approval queue (`npm run queue-ui`, `/queue`)

> **The brief, in the owner's words:** *"build this [a cross-use-case queue and
> management view], but I am more concerned about all the places human approvals
> are needed where there is no place to do that approval."*
>
> So the queue is built, and the **stuck list is the headline**. A pretty list
> of the things that work is worth much less than an honest inventory of the
> things nobody can act on.

This is the third read-only surface, after the request portal's intake and the
audit trail viewer. It is **read-only by construction**:
`src/approvalqueue/server.js` has no POST route at all — not one that refuses,
an absence of one — asserted behaviourally (any write-shaped request 404s) and
structurally (the source, stripped of comments, never mentions the method) by
`test/approvalQueue.test.js`. It reports on approvals; a second place to *make*
one would be two approval policies with nothing keeping them in step.

Nothing here re-derives a policy. Whether an item is waiting, where it would be
actioned, and whether anyone can get to it are read out of the stores, the
routing table and Zendesk. Where a fact is not recorded, the view says it is not
recorded rather than computing a rival answer.

---

## 0a. Re-measured 2026-08-20, after the two missing groups were created

`Local HR & Legal` (`9990000000002`) and `Mobility Specialists` (`9990000000003`)
were created in the `your-subdomain` account and `npm run sync-groups` regenerated
the map, closing the standing hole §0 below reports as finding 1. The queue was
then re-run against the same production sources — Supabase for all eight record
places, the live account for every ticket id.

**Reachability did not move. Not by one item.**

| | 2026-08-19 22:0x | 2026-08-20, groups absent | 2026-08-20, groups present |
|---|---|---|---|
| records read | 54 | 60 | 60 |
| waiting on a person | 39 | 43 | 43 |
| **stuck** | 36 | **36** | **36** |
| reachable | 3 | 7 | 7 |
| unknown | 0 | 0 | 0 |

The middle column is the same 60 records and the same live ticket reads, run
against the group map as it stood immediately before provisioning (worktree at
`e4108d6^`), so the two right-hand columns differ **only** in whether the two
groups exist. What changed between them is a category, not a count:

| Category | groups absent | groups present |
|---|---|---|
| `no_ticket` | 22 | 22 |
| `ticket_missing` | 2 | 2 |
| `queue_owner_absent` | **3** | **0** |
| `queued_elsewhere` | 9 | **12** |

The three that moved are UC-05 escalations — tickets **#23, #53, #54**, owned by
`Local HR & Legal` and sitting in `HR Ops`. Before the group existed they were
*unassignable*; now they are *misassigned*. Both are stuck, and the fix is
different for each, which is the entire reason the queue keeps the two verdicts
apart.

**The one sentence worth taking from this: creating a group repairs the next
hand-off and re-queues nothing already raised.** Provisioning is necessary and it
is not remediation. The 15 open tickets described below are the evidence.

**Ticket #51 has left the queue, and not by being re-queued.** The request that
prompted this whole surface was *approved*: `uc04_authorizations`
`5359955c-…` reads `status: executed`, so its record is settled and the queue no
longer counts it. The ticket itself is still `open` and still in `Support` — the
approval happened somewhere other than the ticket, and nothing closed it. That is
its own small finding and it is not the one this section was written to report.

### The backlog in the default group: 15, 12 and 10 are three different questions

A sibling measurement counted **fifteen** where this document previously recorded
ten. Both are right; they count different things, and adopting either number
without its denominator would be wrong.

- **15** — open tickets sitting in the account default `Support` group that carry
  a `queue_*` or `escalation_*` tag: #19, #21, #22, #23, #24, #25, #26, #27, #29,
  #30, #31, #32, #33, #38, #51. A Zendesk-side count: every ticket that was routed
  somewhere and did not get there, whether or not its record still needs a person.
  (Four more sit in the default group with no routing tag at all — #1, #20, #28,
  #52 — which is a different condition and not counted here.)
- **12** — what the queue reports as `queued_elsewhere`: the subset whose record
  is **still waiting on a person**. A ticket in the wrong queue for work that has
  already been decided is untidy; one for work still outstanding is stuck.
- **10** — the same figure on 2026-08-19, before six more tickets existed.

Nothing here was re-assigned. Re-assigning is an outward act on a live account
and a separate decision; this measurement is read-only.

Verified live the same day: `GET /api/v2/groups` returns **10** groups — the nine
the routing table names, each resolving to the id in
`src/shared/escalationGroupIds.js`, plus the account default `Support`. Both new
groups are dated `2026-08-20`.

---

## 0. What it found, the first time it was pointed at production

Run against the real `audit_log`/record tables and the real `your-subdomain` Zendesk
account on **2026-08-19 22:0x UTC**. 54 records read, **39 waiting on a person,
36 of them with no reachable place to be approved, 3 reachable, 0 unknown**
(every ticket-shaped reference was checked).

| Category | Count | What it is |
|---|---|---|
| `no_ticket` | 22 | Waiting on a named person, and nothing in Zendesk represents the request |
| `queued_elsewhere` | 10 | Ticket #19–#33 — real tickets, all sitting in the account's default **Support** group instead of the team that owns them |
| `no_approval_surface` | 3 | UC-03 cases #48/#49/#50 — correctly ticketed, correctly queued to Travel & Mobility Support, and no route anywhere can record a sign-off |
| `ticket_missing` | 1 | UC-03 case `1c42c5d9`, reference `9002` — reads as a ticket id, and no such ticket exists |

Five findings worth acting on, in order:

1. ~~**UC-04's approval queue points at a Zendesk group that does not exist.**~~
   **CLOSED 2026-08-20 — the group was created; see §0a for what that did and
   did not fix.** As found: `escalationRouting.js` names **Mobility Specialists**
   as the team that approves every UC-04 work authorization; `ESCALATION_GROUP_IDS`
   had no id for it and the account had no such group. Ticket **#51** — the very
   request that prompted this work — carried `queue_mobility_specialists` and sat
   in group `6151578998431`, **Support**. Tagged correctly, assigned to an agent,
   and in no specialist's queue. Nothing about the ticket looked wrong.

   The fix was `scripts/setup-zendesk-groups.mjs` plus `npm run sync-groups`, and
   it worked — every routed team now resolves to a group. **It moved nothing that
   was already raised**, #51 included, so the stuck count is unchanged. Read §0a
   before quoting this item as evidence that hand-off is fixed.
2. **Ten escalations are sitting in the default group.** Tickets #19–#33, raised
   by the n8n graphs, carry the right `escalation_*` tag and group `Support`.
   Ticket **#34** is in `Mobility Legal (Tier-3)` correctly — so the assignment
   fix landed between #33 and #34 and the earlier ten were never repaired. They
   are a backlog to re-assign, not a live bug.
3. **22 decisions awaiting a human raised no ticket at all.** Most are
   webhook-driven proof runs (`f29-…`, `f32-…`, `f33-…`, `form-fix-…`), and one
   is not: UC-02 record `293b0f4e`, a real portal submission over the policy cap,
   whose `audit_log` carries **`portal_ticket_creation_failed`**. The decision is
   correct, durable and audited, and Finance Ops has never heard of it. That is
   the failure mode the whole ticketing join exists to prevent, and it has no
   retry.
4. **UC-03's missing sign-off surface is now measurable, not just described.**
   Four cases are queued `pending` in `review_queue`; three have real tickets in
   the right group. There is no POST route in `src/uc03/server.js` and no
   approve path in the sidebar, so all four are stuck at the last step.
5. **A reference that looks like a ticket id is not one.** `9001`, `9002`,
   `2004` and `2007` are mock-server ids that reached the real record tables
   during local runs; `9002`'s case is still open. Anything that treats a
   numeric reference as a link would send a specialist to a 404.

**One correction this owes `docs/APPROVAL-ROUTING.md`.** Its §2 marks UC-02,
UC-04, UC-05 and UC-09's portal path ⚠️ *"sidebar finds it only with Supabase
attached to both processes"*, on the strength of a `404 {"found": false}`. That
observation was made on **localhost**, where the portal and each `ucNN-api` own
separate in-process stores. On the deployment — one function, one pool — the
split does not exist, and the deployed lookup answers `401
signed_identity_required`, which is the route existing and refusing. **Those four
⚠️ rows are a local-development caveat, not a production dead end.** What does
survive, and is worse than the document claimed, is the row it marked ⚠️ for a
different reason: every hand-off is tagged, and assignment is a separate thing
that is still failing — for UC-04 because the group does not exist, and for ten
older escalations because they were raised before assignment worked. The two ❌
rows (UC-03, and 🔴 dossiers reaching no queue) survive unchanged and are
measured above.

---

## 1. What it reads, and from where

Nine use cases keep their state in eight places, and nothing had ever read them
together — which is why "what is waiting on a person right now?" had no answer
short of hand-written SQL plus a Zendesk session.

| Source | What it contributes |
|---|---|
| `uc02_expenses`, `uc04_authorizations`, `uc05_resignations`, `uc06_amendments`, `uc09_adjustments` | the record, its decision and its own `status` column |
| `uc07_dossiers`, `uc08_dossiers` | the 🔴 dossiers, which have no status column at all — a dossier is compiled once and never changes state. **DECIDED 2026-08-21 for UC-07 (DRIFT-073, `R-24`, not yet built):** the record still never changes state, and the completion state lives on the **hand-off ticket** instead — so a dossier can finally leave this queue without the store gaining a mutation. UC-08 is undecided (`H4`) |
| `cases` + `review_queue` | UC-01 and UC-03, whose "is a person still needed" lives in the queue row, not on the case |
| `audit_log` (`portal_reference_relinked` / `_superseded`) | a ticket id stated outright against a record — the strongest evidence a ticket exists |
| Zendesk (`GET /api/v2/tickets/:id`) | whether that ticket is real, and which group it is in |
| `src/shared/escalationRouting.js` + `escalationGroupIds.js` | which team owns the work, and whether this account has a group for them |

The Zendesk client is the shared one at its least-privilege default
(`tickets:read tickets:write`). Group correctness is decided by comparing the
ticket's `group_id` against the **already-synced** name→id map rather than by
listing groups, which would need the wider `read` scope.

---

## 2. The four states a ticket can be in, and why there are four

`GET /uc04/api/authorizations/by-ticket/51` answering `{"found": false}` and
answering `401 signed_identity_required` are different facts. So are these:

| State | Meaning | Renders a link? |
|---|---|---|
| `confirmed` | asked Zendesk; the ticket is there | **yes — only this one** |
| `not_found` | asked Zendesk; there is no such ticket | no |
| `unverified` | the reference *could* be a ticket id and nobody asked | no |
| `none` | the reference is not a ticket id and no audit row records one | no |

**`unverified` is not a synonym for either neighbour, and it is why this
distinction is load-bearing rather than pedantic.** Verified live on
2026-08-19: four records carried the references `9001`, `9002`, `2004`, `2007`.
Every one reads as a Zendesk ticket id. Every one returns *not found* against
the real account — they are ids minted by the mock Zendesk server during local
runs. Meanwhile `40`–`51` are real tickets. Nothing about the strings tells them
apart, so the shape of a reference is **evidence and never a verdict**, and a
link is only rendered for a ticket that has actually been read back.

---

## 3. The stuck list

An item is **stuck** when a person is still needed and there is no reachable
place for that person to act. Six categories, worst first:

| Category | What is wrong |
|---|---|
| `no_ticket` | A decision awaiting a human that raised no ticket at all. Correct, durable, audited — and in nobody's queue. |
| `ticket_missing` | A reference shaped like a ticket id with no ticket behind it. Worse than no ticket: the record reads as handed over. |
| `no_approval_surface` | Something must approve it and nothing anywhere can. |
| `queue_owner_absent` | A ticket exists, tagged for a team whose Zendesk group does not exist, so it sits in the account default. **No members since 2026-08-20** — kept, and tested on pure inputs, because a team added to the routing table is unprovisioned from the moment it is added until somebody runs the setup script. |
| `queued_elsewhere` | A ticket exists and is in some other team's queue. |
| `unqueued` | A ticket exists and belongs to no group. |

### The two absences that must never be conflated

Both render as "no approve button" and they are opposite states:

- **`none_by_design`** — UC-07 and UC-08. Nothing may approve a high-risk
  dossier, ever. **Unchanged by the 2026-08-21 decisions, and deliberately so.**
  What changed for UC-07 — **and, from 2026-08-21, for UC-08 on the same
  reasoning and with the same vocabulary** — is that *"nobody may approve this"*
  and *"nobody may ever be told what happened"* stopped being kept by the same
  mechanism. Both dossiers gain the same four outcome verbs (`dossier_read`,
  `proceeding_offline`, `not_proceeding`, `more_information_needed`), recorded on
  the ticket and never on the store, and both need the same missing ticket first
  (DRIFT-109). This
  document's own `none_by_design` / `none_missing` distinction is the one place
  the repository had already drawn that line correctly, one layer up
  (`docs/WHY-THIS-SHAPE.md` §16). A recorded **outcome** is not an approval, and
  it does not move a dossier out of this category. Their stores have one write method and zero mutations, their
  servers have no POST route, and tests assert both. An approve button here
  would be a defect. Such a dossier is on the stuck list **only** when nothing
  told its team it exists — and then the `why` says plainly that the missing
  thing is the hand-off, not a control.
- **`none_missing`** — UC-03. A formal travel letter is drafted, stored and
  queued, and nothing anywhere can sign it off. `UC-03.md` §15 says so in its
  own words: *"OPEN — `human_review` has no sign-off surface anywhere."* It is
  on the stuck list **even when its ticket is perfectly queued**, because a
  ticket a specialist can open and cannot act on is not a place to approve.

A single boolean would have made these one row. They are two values with two
words, and a test asserts they are not equal.

### `unknown` is a third answer, not a quiet zero

Three places where a two-way branch would have turned "we could not tell" into
"it is fine":

- a **status this view does not recognise** is `unknown`, never `settled` — a
  status added to a store later must not make an item silently vanish from the
  queue while still needing a person;
- an **unverified ticket** makes the item `unknown`, never reachable;
- the rollup keeps **stuck / unknown / reachable** as three separate counts, and
  the page gives "cannot tell" its own tile.

This is the same discipline as `src/uc04/decisionFacts.js`'s unknown-vs-cleared
and `src/auditview/identifierVerdict.js`'s not-found-vs-cannot-tell: a check
that never ran cleared nothing, and a place that was never searched found
nothing. An empty stuck list and a stuck list that could not be computed must
never look the same.

---

## 4. Teams and their queues

A missing Zendesk group is a **standing hole, not an event**: it shows up in the
item list only while something happens to be sitting in it, so on a quiet hour
the page would report everything fine and the next request routed to that team
would land in nobody's queue exactly as the last one did. It is therefore
reported as a property of the account, whether or not anything is waiting on it.

It is also reported in **both** directions. `GET /api/meta` carries
`teamProvisioning`, an account-level verdict the page prints above the table in
every state, so "no gaps" is a result this view produced rather than something a
reader has to infer from a table with no red cells — a surface that can only ever
print faults leaves a clean run and a run that never happened looking identical.
Four states, not a boolean: `all_provisioned`, `gaps` (named), `none_provisioned`
(the synced map resolves nothing — **one** problem with its own fix, `npm run
sync-groups`, not N missing groups) and `no_teams_routed` (a routing table that
names nobody is never cheerfully "all provisioned").

Live, **2026-08-20**: the routing table names **nine** owning teams and **all
nine** have a Zendesk group — `Local HR & Legal` and `Mobility Specialists` were
created that day, and `GET /api/v2/groups` returns those nine plus the account
default `Support`. `teamProvisioningSummary()` reads `all_provisioned`.

Live, 2026-08-19 (what this block was written for): the routing table named
**eight** owning teams, **seven** had a Zendesk group, and the one that did not
was **Mobility Specialists** — the team that approves every UC-04 work
authorization.

---

## 5. Running it

```bash
npm run queue-ui                 # port 4047 (src/shared/ports.js)
npm run queue-ui -- --seeded     # labelled demo rows, zero credentials
```

- **Supabase attached** → real reads of all eight places.
- **Zendesk configured** → ticket ids read back, up to 60 distinct ids per
  refresh; anything past the budget is reported as unverified rather than
  silently skipped.
- **Neither** → a labelled demo dataset with its own fake Zendesk, so a fresh
  clone shows every stuck category. The page banners the mode. The
  **deployment** does the opposite and answers 503, because fabricated rows on a
  public URL are indistinguishable from real work.
- **Access**: the portal's shared key (`PORTAL_ACCESS_KEY`, header
  `x-portal-key`) — one key, now three surfaces. Open on a fresh clone; required
  the moment a durable store is attached or the deployment is public. The page
  itself is ungated because it carries no data and is how an operator is told a
  key is needed.

Mounted on the Vercel function at **`/queue`**, beside `/portal` and `/audit`,
with the same delegation shape: the whole handler, gate included, so one access
rule exists in one place. `vercel.json`'s catch-all rewrite already covers it.

## 6. Screenshots

`docs/screenshots/approval-queue-stuck-list.png` ·
`approval-queue-everything-waiting.png` · `approval-queue-by-use-case.png` ·
`approval-queue-where-approvals-happen.png`
